// The Design Chamber note in every agent's instructions (documentation/specs/phase-1-5-sdk-2-7.md
// §U2.3): built from the current root and sent with `hostCalls.setInstructions` (directory
// `null`, so every session) at two moments only: after the watcher baseline, and on every root
// change. No timer, no retry loop: a call the host did not save waits for the next trigger.
//
// The host stores the text and reads it before every message, and keeps it across service
// restarts. Nothing is cleared on dispose: the host drops the text when the extension is turned
// off or removed.
//
// Known gap, accepted (§U2.3): nothing stores the text until the service first runs, and the
// service starts only on a request (the rail, a Work Status frame, an @ search, a session event).
// So the very first message in the first chat after install, or after the text was dropped by a
// disable, may go without the note. The skill is there from the start, and from the next message
// on the note is too. A resident service only to close that gap would cost a process for one message.
//
// Phase 2.5 (§8.6, AD-12, SP-2): per-project pins. A project pinned to a Ready system gets one line
// of its own, sent with `setInstructions(text, directory)`; the host adds it to the global note for
// sessions in that folder (additive, SP-2), so the global text is never touched by a pin. What was
// sent is kept in `instructions.json` beside settings.json (directory → sha256 of the text), so a
// restart neither resends an unchanged line nor forgets a directory whose pin went away (it is sent
// `""`, which removes it). Each directory is keyed by its resolved path, the same on write and
// removal. A refusal or `unavailable` is logged and tried again on the next trigger only. Triggers:
// the baseline, a root change, a settings change, and `system` events that may change a pinned
// system's name or status (coalesced, 1 s).

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildInstructions, buildPinInstruction } from '../shared/agent/instructions.ts';
import { SYSTEM_PINS_MAX } from '../shared/limits.ts';
import type { ChangeEvent, SettingsFile, SystemSummary } from '../shared/types.ts';
import type { HostCalls, Logger, SettingsStore } from './context.ts';
import { isInsideOrEqual, writeFileAtomic } from './paths.ts';

export type InstructionsDeps = {
  /** The launcher's check command for `root` with the literal `<slug>`, or `null` when it is not in place. */
  commandFor: (root: string) => Promise<string | null>;
  /** The watcher's baseline: the first text is sent after it. */
  ready: Promise<void>;
  /** Test seam; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Phase 2.5 per-project pins; absent → only the global note is kept. */
  pins?: PinSyncDeps;
};

/** What the pin sync reads and listens to (§8.6). */
export type PinSyncDeps = {
  /** The pins and the default, as last saved. */
  settings: () => Pick<SettingsFile, 'systemDefault' | 'systemPins'>;
  /** Every system in the current root (read now, not the index: an index still loading would remove every pin). */
  systems: () => Promise<readonly Pick<SystemSummary, 'id' | 'name' | 'status' | 'unreadable'>[]>;
  /** `instructions.json`. */
  file: string;
  onSettingsChange: (listener: () => void) => () => void;
  subscribe: (listener: (event: ChangeEvent) => void) => () => void;
  /** `system` events are coalesced this long (test seam, 1 s outside tests). */
  coalesceMs?: number;
};

/** `instructions.json` beside the settings file (§2.9). */
export const instructionsFileOf = (settingsFile: string): string => path.join(path.dirname(settingsFile), 'instructions.json');

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** directory → sha256 of the text the host saved there. */
export type PinRecord = Map<string, string>;

/** A missing, damaged or foreign file reads as empty (nothing was sent, as far as we know). */
export const parsePinRecord = (text: string | null): PinRecord => {
  const out: PinRecord = new Map();
  if (text === null) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return out;
  const dirs = (raw as { dirs?: unknown }).dirs;
  if (typeof dirs !== 'object' || dirs === null || Array.isArray(dirs)) return out;
  for (const [directory, hash] of Object.entries(dirs)) {
    if (out.size >= SYSTEM_PINS_MAX) break;
    if (path.isAbsolute(directory) && typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) out.set(directory, hash);
  }
  return out;
};

const serializePinRecord = (record: PinRecord): string => `${JSON.stringify({ v: 1, dirs: Object.fromEntries(record) }, null, 2)}\n`;

/**
 * The text each pinned project should have (§8.6): a pin whose effective target (§2.9: `system`
 * names one, `default` follows the default) is a Ready, readable system of this root. A pin on the
 * designs folder or inside it is skipped (it is not a project, as in `effectiveSystemChoice`).
 * Keys are resolved paths.
 */
export const desiredPinTexts = (input: {
  settings: Pick<SettingsFile, 'systemDefault' | 'systemPins'>;
  systems: readonly Pick<SystemSummary, 'id' | 'name' | 'status' | 'unreadable'>[];
  designsRoot: string;
}): Map<string, string> => {
  const out = new Map<string, string>();
  const fallback = input.settings.systemDefault;
  for (const pin of input.settings.systemPins ?? []) {
    const directory = path.resolve(pin.directory);
    if (out.has(directory) || isInsideOrEqual(input.designsRoot, directory)) continue;
    const target = pin.choice === 'system' ? pin.id : pin.choice === 'follow-default' && fallback?.choice === 'system' ? fallback.id : undefined;
    const system = target === undefined ? undefined : input.systems.find((one) => one.id === target && one.status === 'ready' && one.unreadable === null);
    if (system !== undefined) out.set(directory, buildPinInstruction(system.name));
  }
  return out;
};

const PIN_COALESCE_MS = 1000;

export type InstructionsContext = {
  settings: Pick<SettingsStore, 'root' | 'onRootChange'>;
  hostCalls: HostCalls;
  log: Logger;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Start keeping the instructions current; answers the stop function. Never throws. */
export const startInstructions = (ctx: InstructionsContext, deps: InstructionsDeps): (() => void) => {
  const platform = deps.platform ?? process.platform;
  let stopped = false;
  /** The last text the host saved; an identical text is not sent again. */
  let lastSaved: string | null = null;
  /** Sends run one at a time, in trigger order, so a quick second root change can never be overtaken by the first. */
  let queue: Promise<void> = Promise.resolve();

  const sendCurrent = async (): Promise<void> => {
    if (stopped) return;
    const root = ctx.settings.root();
    let checkCommand: string | null = null;
    try {
      checkCommand = await deps.commandFor(root);
    } catch (error) {
      ctx.log.warn('instructions.command-failed', { error: errorText(error) });
    }
    let text: string;
    try {
      text = buildInstructions({ root, platform, checkCommand });
    } catch (error) {
      // A root with a control character or an absurd length: the note is not sent rather than sent wrong.
      ctx.log.warn('instructions.build-failed', { error: errorText(error) });
      return;
    }
    if (stopped || text === lastSaved) return;
    const result = await ctx.hostCalls.setInstructions(text);
    if (result === 'saved') {
      lastSaved = text;
      ctx.log.info('instructions.saved', { characters: text.length });
      return;
    }
    ctx.log.info('instructions.not-saved', { result });
  };

  const syncPins = async (pins: PinSyncDeps): Promise<void> => {
    if (stopped) return;
    let systems: Awaited<ReturnType<PinSyncDeps['systems']>>;
    try {
      systems = await pins.systems();
    } catch (error) {
      // Without the list nothing is known to be gone: change nothing rather than remove every pin.
      ctx.log.warn('instructions.pins-skipped', { error: errorText(error) });
      return;
    }
    const desired = desiredPinTexts({ settings: pins.settings(), systems, designsRoot: ctx.settings.root() });
    const record = parsePinRecord(await readFile(pins.file, 'utf8').catch(() => null));
    let changed = false;
    const send = async (directory: string, text: string): Promise<boolean> => {
      if (stopped) return false;
      const result = await ctx.hostCalls.setInstructions(text, directory);
      if (result !== 'saved') ctx.log.info('instructions.pin-not-saved', { result, removing: text === '' });
      return result === 'saved';
    };
    for (const [directory, text] of desired) {
      const hash = sha256(text);
      if (record.get(directory) === hash) continue;
      if (await send(directory, text)) {
        record.set(directory, hash);
        changed = true;
      }
    }
    for (const directory of [...record.keys()]) {
      if (desired.has(directory)) continue;
      if (await send(directory, '')) {
        record.delete(directory);
        changed = true;
      }
    }
    if (!changed) return;
    try {
      await writeFileAtomic(pins.file, serializePinRecord(record));
      ctx.log.info('instructions.pins-saved', { pinned: desired.size });
    } catch (error) {
      // The next trigger compares against the old record and sends the same texts again: harmless.
      ctx.log.warn('instructions.pins-record-failed', { error: errorText(error) });
    }
  };

  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work).catch((error: unknown) => ctx.log.error('instructions.send-failed', { error: errorText(error) }));
  };
  const trigger = (): void => {
    enqueue(sendCurrent);
    triggerPins();
  };
  const { pins } = deps;
  function triggerPins(): void {
    if (pins !== undefined) enqueue(() => syncPins(pins));
  }

  let baseline = false;
  void deps.ready.then(
    () => {
      baseline = true;
      trigger();
    },
    (error: unknown) => ctx.log.warn('instructions.start-skipped', { error: errorText(error) }),
  );
  const offRoot = ctx.settings.onRootChange(() => trigger());

  // Pins: a settings change at once; a system event that may rename, ready, unready, add or remove a
  // system, coalesced. Nothing before the baseline: the first sync runs with it.
  let pinTimer: ReturnType<typeof setTimeout> | null = null;
  const offSettings = pins?.onSettingsChange(() => {
    if (baseline) triggerPins();
  });
  const offSystems = pins?.subscribe((event) => {
    if (!baseline || event.kind !== 'system' || pinTimer !== null) return;
    if (event.systemChange !== 'state' && event.systemChange !== 'added' && event.systemChange !== 'removed') return;
    pinTimer = setTimeout(() => {
      pinTimer = null;
      triggerPins();
    }, pins.coalesceMs ?? PIN_COALESCE_MS);
  });

  return () => {
    stopped = true;
    offRoot();
    offSettings?.();
    offSystems?.();
    if (pinTimer !== null) clearTimeout(pinTimer);
  };
};
