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

import { buildInstructions } from '../shared/agent/instructions.ts';
import type { HostCalls, Logger, SettingsStore } from './context.ts';

export type InstructionsDeps = {
  /** The launcher's check command for `root` with the literal `<slug>`, or `null` when it is not in place. */
  commandFor: (root: string) => Promise<string | null>;
  /** The watcher's baseline: the first text is sent after it. */
  ready: Promise<void>;
  /** Test seam; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
};

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

  const trigger = (): void => {
    queue = queue.then(sendCurrent).catch((error: unknown) => ctx.log.error('instructions.send-failed', { error: errorText(error) }));
  };

  void deps.ready.then(
    () => trigger(),
    (error: unknown) => ctx.log.warn('instructions.start-skipped', { error: errorText(error) }),
  );
  const offRoot = ctx.settings.onRootChange(() => trigger());

  return () => {
    stopped = true;
    offRoot();
  };
};
