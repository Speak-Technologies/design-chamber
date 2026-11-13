// The one pipeline every hand edit runs through (Phase 2 technical design §2.4, AD-1 to AD-7;
// PS E1 to E12).
//
//   apply(slug, body):
//     design resolved (404 "no longer in your Designs folder") → request shape (400/413)
//     → versions.userEdit (the per-slug chain):
//         precheck: the op module plans from the bytes on disk (stale check against the
//                   request's stamps, caps, link refusal, verify); every step checked against
//                   the writable set (07-7). Nothing written, no version.
//         version first ("Before your edits", or coalesced, AD-4)
//         apply:    the steps in order, each a compare-and-swap or a no-replace move, the
//                   self-write recorded right before its rename; a failed multi-step op rolls
//                   back the steps done (§2.9); the user's events (origin "user"); the undo
//                   record and ledger entry appended through the edits.json queue.
//   undo(slug, id): the recorded reverse steps through the same chain, each guarded by the hash
//                   or stamp this edit left (E9).
//
// E1: nothing here is reachable from a frame. The only callers are the routes, which only the
// page and the rail call, from Design Chamber's own controls (§2.11).

import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import type { EditRequest, EditResponse, EditStamps, EditTarget, FileStamp, TokensResponse, TweakValue, UndoEditResponse } from '../../shared/api.ts';
import { DESIGN_JSON_FILE, ENTRY_FILE } from '../../shared/design-json.ts';
import {
  DIRECTION_OPTIONS_MAX,
  EDIT_ID_PATTERN,
  EDIT_PROBE_ID_MAX,
  EDIT_PROBE_SCAN_MAX,
  SCREEN_ID_PATTERN,
  SCREENS_MAX,
  SHA256_PATTERN,
  TEXT_EDIT_MAX,
  TWEAK_VAR_PATTERN,
  TWEAKS_MAX,
  BRIDGE_TAG_MAX,
} from '../../shared/limits.ts';
import type { ChangeHub, DesignRecord, DesignStore, Logger, SelfWrites, ServiceContext, SettingsStore, WriteHooks } from '../context.ts';
import { ApiError } from '../http.ts';
import { atomicTempPath, moveNoReplace, replaceFileIfHashUnchanged, resolvePlainTarget } from '../paths.ts';
import { folderErrorSentence } from '../root.ts';
import { screensStampOf } from '../store.ts';
import { ensureVersionsService, toSummary, type UserEditReason, type VersionsService, type WrittenFile } from '../versions.ts';
import { applyUndone, appendEdit, clearLedger, createEditsFile, findUndo, isEditableRel, screenIdOfFile, type EditsFileStore, type UndoRecord, type UndoStep } from './file.ts';
import type { OpInput, OpModules, OpPlan, PlannedStep } from './op-module.ts';
import { screensOp } from './ops-screens.ts';
import { textOp } from './ops-text.ts';
import { readTokens, tokensOp } from './ops-tokens.ts';
import { ensureTrashDir, isOwnTrashPlace, nextTrashPlace, trashPlaceOf, trashStampOf, TRASH_PREFIX } from './trash.ts';

// ---- the fixed op map (T3, T4, T5 replace only their module, never this table) ----

export const DEFAULT_OPS: OpModules = {
  text: textOp,
  tokens: tokensOp,
  reorder: screensOp,
  duplicate: screensOp,
  'trash-screen': screensOp,
  'keep-direction': screensOp,
};

// ---- sentences (§2.8) ----

export const GONE_MESSAGE = 'That design is no longer in your Designs folder.';
export const BAD_EDIT_MESSAGE = "Design Chamber couldn't read that edit. Nothing was saved.";
export const TOO_LONG_MESSAGE = "That's too long to edit here. Ask the agent instead.";
export const BUSY_MESSAGE = 'Another program is using this file. Close it and try again.';
export const ROLLED_BACK_MESSAGE = 'Something went wrong, so nothing was changed.';
export const UNDO_STALE_MESSAGE = "This file changed after your edit, so it can't be undone here. Restore the version 'Before your edits' from Versions.";
export const UNDO_GONE_MESSAGE = "This edit can't be undone any more.";

const SCREEN_LIST_STALE = 'The screen list changed while you were working. Nothing was changed.';

/** Each op's stale sentence: a stamp or hash that moved, a lost compare-and-swap, or a torn version first. */
export const STALE_MESSAGES: Readonly<Record<EditRequest['op'], string>> = {
  text: 'This file changed while you were editing. Nothing was saved.',
  tokens: 'tokens.css changed since you started. Your values are still shown.',
  reorder: SCREEN_LIST_STALE,
  duplicate: SCREEN_LIST_STALE,
  'trash-screen': SCREEN_LIST_STALE,
  'keep-direction': SCREEN_LIST_STALE,
};

const VERSION_LABELS: Readonly<Record<UserEditReason, string>> = { 'user-edit': 'Before your edits', 'keep-direction': 'Before keeping a direction' };

export const partWayMessage = (reason: UserEditReason): string =>
  `Something went wrong part way. The version '${VERSION_LABELS[reason]}' holds everything as it was; restore it from Versions.`;

// ---- request shape (pure, §10.2) ----

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const bad = (): never => {
  throw new ApiError('bad-request', BAD_EDIT_MESSAGE);
};
const sha = (value: unknown): string => (typeof value === 'string' && SHA256_PATTERN.test(value) ? value : bad());
const screenId = (value: unknown): string => (typeof value === 'string' && SCREEN_ID_PATTERN.test(value) ? value : bad());
const count = (value: unknown, max: number): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : bad());
/** Editor text: a string; over `TEXT_EDIT_MAX` is the 413 sentence (content rules are the text op's, §3.4). */
const editorText = (value: unknown): string => {
  if (typeof value !== 'string') return bad();
  if (value.length > TEXT_EDIT_MAX) throw new ApiError('too-large', TOO_LONG_MESSAGE);
  return value;
};

const fileStamp = (value: unknown): FileStamp => {
  if (!isObj(value)) return bad();
  const size = count(value.size, Number.MAX_SAFE_INTEGER);
  const { mtime } = value;
  if (mtime !== null && !(typeof mtime === 'string' && mtime.length <= 40 && Number.isFinite(Date.parse(mtime)))) return bad();
  return { size, mtime };
};

const editTarget = (value: unknown): EditTarget => {
  if (!isObj(value)) return bad();
  const { tag, id, text } = value;
  if (typeof tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(tag) || tag.length > BRIDGE_TAG_MAX) return bad();
  if (!(id === null || (typeof id === 'string' && id.length >= 1 && id.length <= EDIT_PROBE_ID_MAX))) return bad();
  if (typeof text !== 'string' || text.length > TEXT_EDIT_MAX + 1) return bad();
  const sameCount = count(value.sameCount, EDIT_PROBE_SCAN_MAX);
  const sameIndex = count(value.sameIndex, EDIT_PROBE_SCAN_MAX);
  if (sameCount > 0 && sameIndex >= sameCount) return bad();
  return { tag, id, text, sameIndex, sameCount };
};

const uniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

/**
 * The request as a fresh, fully typed object (only known keys), or 400 with one sentence. Rules
 * that need the design (the exact screen set, a knob's range) are the op module's.
 */
export const parseEditRequest = (body: unknown): EditRequest => {
  if (!isObj(body)) return bad();
  switch (body.op) {
    case 'text': {
      const screen = body.screen === null ? null : screenId(body.screen);
      return { op: 'text', screen, base: sha(body.base), target: editTarget(body.target), before: editorText(body.before), after: editorText(body.after) };
    }
    case 'tokens': {
      if (!Array.isArray(body.values) || body.values.length === 0 || body.values.length > TWEAKS_MAX) return bad();
      const values: TweakValue[] = body.values.map((entry: unknown): TweakValue => {
        if (!isObj(entry) || typeof entry.var !== 'string' || !TWEAK_VAR_PATTERN.test(entry.var)) return bad();
        const { value } = entry;
        if (typeof value === 'number' && Number.isFinite(value)) return { var: entry.var, value };
        if (typeof value === 'string' && value.length >= 1 && value.length <= 100) return { var: entry.var, value };
        return bad();
      });
      if (!uniqueIds(values.map((entry) => entry.var))) return bad();
      return { op: 'tokens', base: sha(body.base), values };
    }
    case 'reorder': {
      if (!Array.isArray(body.order) || body.order.length === 0 || body.order.length > SCREENS_MAX) return bad();
      const order = body.order.map(screenId);
      if (!uniqueIds(order)) return bad();
      return { op: 'reorder', screens: sha(body.screens), order };
    }
    case 'duplicate':
      return { op: 'duplicate', screens: sha(body.screens), id: screenId(body.id), file: fileStamp(body.file) };
    case 'trash-screen':
      return { op: 'trash-screen', screens: sha(body.screens), id: screenId(body.id), file: body.file === null ? null : fileStamp(body.file) };
    case 'keep-direction': {
      if (!Array.isArray(body.files) || body.files.length < 2 || body.files.length > DIRECTION_OPTIONS_MAX + 1) return bad();
      const files = body.files.map((entry: unknown) => {
        if (!isObj(entry)) return bad();
        return { id: screenId(entry.id), file: entry.file === null ? null : fileStamp(entry.file) };
      });
      if (!uniqueIds(files.map((entry) => entry.id))) return bad();
      return { op: 'keep-direction', screens: sha(body.screens), of: screenId(body.of), keep: screenId(body.keep), files };
    }
    default:
      return bad();
  }
};

// ---- writable set (pure, §2.3, 07-7) ----

const listedScreen = (record: DesignRecord, rel: string): boolean => {
  const id = screenIdOfFile(rel);
  return id !== null && record.design.screens.some((screen) => screen.id === id);
};

/**
 * Whether an op may take this step on this design. A module that plans anything else is a bug:
 * the pipeline refuses the whole plan before the version, so no op can reach assets, DESIGN.md,
 * `.chamber`, `.versions`, another design's trash or a path outside the design.
 */
export const stepAllowed = (op: EditRequest['op'], record: DesignRecord, slug: string, step: PlannedStep): boolean => {
  const screenOp = op === 'reorder' || op === 'duplicate' || op === 'trash-screen' || op === 'keep-direction';
  switch (step.kind) {
    case 'write':
      if (op === 'text') return record.design.kind === 'page' ? step.rel === ENTRY_FILE : record.design.kind === 'canvas' && listedScreen(record, step.rel);
      return op === 'tokens' && step.rel === 'tokens.css';
    case 'create':
      return op === 'duplicate' && record.design.kind === 'canvas' && screenIdOfFile(step.rel) !== null && !listedScreen(record, step.rel);
    case 'move':
      if (record.design.kind !== 'canvas' || !listedScreen(record, step.from)) return false;
      if (op === 'trash-screen') return isOwnTrashPlace(step.to, slug);
      if (op === 'keep-direction') return isOwnTrashPlace(step.to, slug) || listedScreen(record, step.to);
      return false;
    case 'screens':
      return screenOp && record.design.kind === 'canvas';
    case 'comments':
      return op === 'keep-direction' && record.design.kind === 'canvas';
  }
};

// ---- the service ----

export type EditService = {
  /** Brand so `ensureEditService` recognises an already-wired instance. */
  __dcEditService?: true;
  apply(slug: string, body: unknown): Promise<EditResponse>;
  undo(slug: string, id: string): Promise<UndoEditResponse>;
  /** Ledger entries with `seq ≤ upTo` removed (idempotent); 400 for a position never handed out. */
  clearHandEdits(slug: string, upTo: number): Promise<void>;
  readTokens(slug: string): Promise<TokensResponse>;
  /** The design's edits.json queue (T6 reads the ledger through it). */
  editsFile: EditsFileStore;
};

export type EditServiceDeps = {
  store: DesignStore;
  versions: VersionsService;
  hub: ChangeHub;
  selfWrites: SelfWrites;
  settings: SettingsStore;
  log: Logger;
  now?: () => Date;
  /** The op map (tests pass fakes); `DEFAULT_OPS` otherwise. */
  ops?: OpModules;
  editsFile?: EditsFileStore;
  /** The GET /tokens reader; `readTokens` from ops-tokens.ts otherwise. */
  readTokens?: (record: DesignRecord, dir: string) => Promise<TokensResponse>;
  /** Pause before a busy retry (40/80/120 ms outside tests). */
  pause?: (ms: number) => Promise<void>;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** `e_` + 20 hex characters (inside `EDIT_ID_PATTERN`). */
const mintEditId = (): string => `e_${randomBytes(10).toString('hex')}`;

/** Busy retries for a Windows lock: three more tries after the first, then the conflict sentence (§2.5). */
const BUSY_PAUSES_MS: readonly number[] = [40, 80, 120];

/** What one run of steps (forward or reverse) left: for the events, the answer and the coalescing tree. */
type Run = {
  slug: string;
  dir: string;
  staleMessage: string;
  trashDir: () => Promise<string>;
  hooks: WriteHooks;
  written: WrittenFile[];
  files: Set<string>;
  designJson: boolean;
  stamps: EditStamps;
};

export const createEditService = (deps: EditServiceDeps): EditService => {
  const { store, versions, hub, selfWrites, settings, log } = deps;
  const now = deps.now ?? (() => new Date());
  const ops = deps.ops ?? DEFAULT_OPS;
  const editsFile = deps.editsFile ?? createEditsFile({ log });
  const tokensReader = deps.readTokens ?? readTokens;
  const pause = deps.pause ?? ((ms: number) => delay(ms));

  const stale = (run: Run): ApiError => new ApiError('stale', run.staleMessage);

  /** The design as it is now; gone → the edit routes' own 404 sentence. */
  const recordOf = async (slug: string): Promise<DesignRecord> => {
    try {
      return await store.get(slug);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not-found') throw new ApiError('not-found', GONE_MESSAGE);
      throw error;
    }
  };

  /** A `not-found` from anywhere is the gone sentence only when the design really is gone (a missing screen is not). */
  const goneOr = async (slug: string, error: unknown): Promise<unknown> => {
    if (!(error instanceof ApiError) || error.code !== 'not-found' || error.message === UNDO_GONE_MESSAGE || error.message === GONE_MESSAGE) return error;
    const present = await store.dir(slug).then(
      () => true,
      () => false,
    );
    return present ? error : new ApiError('not-found', GONE_MESSAGE);
  };

  const newRun = (slug: string, dir: string, staleMessage: string): Run => {
    let trash: Promise<string> | null = null;
    const run: Run = {
      slug,
      dir,
      staleMessage,
      trashDir: () => (trash ??= ensureTrashDir(settings.root())),
      hooks: { beforeRename: (bytes) => selfWrites.record(slug, DESIGN_JSON_FILE, sha256(bytes), bytes.length) },
      written: [],
      files: new Set(),
      designJson: false,
      stamps: {},
    };
    return run;
  };

  /** A place's absolute path: design-relative editable files under the design, own trash names under `<root>/.trash`. */
  const resolvePlace = async (run: Run, place: string, allowAbsent: boolean): Promise<{ abs: string; rel: string | null }> => {
    if (place.startsWith(TRASH_PREFIX)) {
      if (!isOwnTrashPlace(place, run.slug)) throw new ApiError('internal', ROLLED_BACK_MESSAGE);
      return { abs: await resolvePlainTarget(await run.trashDir(), [place.slice(TRASH_PREFIX.length)], { allowAbsent }), rel: null };
    }
    if (!isEditableRel(place)) throw new ApiError('internal', ROLLED_BACK_MESSAGE);
    return { abs: await resolvePlainTarget(run.dir, place.split('/'), { allowAbsent }), rel: place };
  };

  /** The sha256 of a place's bytes now, or null when it is absent. */
  const shaOnDisk = async (run: Run, place: string): Promise<string | null> => {
    const { abs } = await resolvePlace(run, place, true);
    try {
      return sha256(await readFile(abs));
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return null;
      throw error;
    }
  };

  const noteWrite = (run: Run, rel: string | null, bytes: Uint8Array | null): void => {
    if (rel === null) return;
    run.written.push([rel, bytes]);
    run.files.add(rel);
    if (bytes !== null) {
      if (rel === 'tokens.css') run.stamps.tokens = sha256(bytes);
      else run.stamps.file = sha256(bytes);
    }
  };

  /** Compare-and-swap with the busy retries; the self-write is recorded first and forgotten again when nothing was written. */
  const casWrite = async (run: Run, abs: string, rel: string, expectSha: string, bytes: Uint8Array): Promise<void> => {
    selfWrites.record(run.slug, rel, sha256(bytes), bytes.length);
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await replaceFileIfHashUnchanged(abs, expectSha, bytes);
      if (outcome === 'replaced') return noteWrite(run, rel, bytes);
      if (outcome === 'changed' || attempt >= BUSY_PAUSES_MS.length) {
        selfWrites.forget(run.slug, rel);
        throw outcome === 'changed' ? stale(run) : new ApiError('conflict', BUSY_MESSAGE);
      }
      await pause(BUSY_PAUSES_MS[attempt] ?? 0);
    }
  };

  /** `moveNoReplace` with the busy retries; `exists` is the caller's to answer. */
  const moveRetry = async (from: string, to: string): Promise<'moved' | 'exists'> => {
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await moveNoReplace(from, to);
      if (outcome !== 'busy') return outcome;
      if (attempt >= BUSY_PAUSES_MS.length) throw new ApiError('conflict', BUSY_MESSAGE);
      await pause(BUSY_PAUSES_MS[attempt] ?? 0);
    }
  };

  /**
   * Move a file to `to` without replacing anything; a trash name taken meanwhile moves on to the
   * next `-n` (then 409 conflict). Answers the place actually used.
   */
  const movePlace = async (run: Run, from: { abs: string; rel: string | null }, to: string, bytes: Buffer): Promise<string> => {
    for (let candidate: string | null = to; candidate !== null; candidate = candidate.startsWith(TRASH_PREFIX) ? nextTrashPlace(candidate) : null) {
      const target = await resolvePlace(run, candidate, true);
      if (from.rel !== null) selfWrites.record(run.slug, from.rel, null, null);
      if (target.rel !== null) selfWrites.record(run.slug, target.rel, sha256(bytes), bytes.length);
      const outcome = await moveRetry(from.abs, target.abs).catch((error: unknown) => {
        if (from.rel !== null) selfWrites.forget(run.slug, from.rel);
        if (target.rel !== null) selfWrites.forget(run.slug, target.rel);
        throw error;
      });
      if (outcome === 'moved') {
        noteWrite(run, from.rel, null);
        noteWrite(run, target.rel, bytes);
        return candidate;
      }
      if (from.rel !== null) selfWrites.forget(run.slug, from.rel);
      if (target.rel !== null) selfWrites.forget(run.slug, target.rel);
      if (!candidate.startsWith(TRASH_PREFIX)) throw stale(run);
    }
    throw new ApiError('conflict', BUSY_MESSAGE);
  };

  /** The source of a move, still as the module saw it: its hash, or the size and mtime the wall showed. */
  const readMoveSource = async (run: Run, from: string, expect: { sha: string } | FileStamp): Promise<{ abs: string; rel: string | null; bytes: Buffer }> => {
    const source = await resolvePlace(run, from, true);
    let bytes: Buffer;
    try {
      if (!('sha' in expect)) {
        const info = await lstat(source.abs);
        if (info.size !== expect.size || info.mtime.toISOString() !== expect.mtime) throw stale(run);
      }
      bytes = await readFile(source.abs);
    } catch (error) {
      if (codeOf(error) === 'ENOENT') throw stale(run);
      throw error;
    }
    if ('sha' in expect && sha256(bytes) !== expect.sha) throw stale(run);
    return { ...source, bytes };
  };

  // ---- forward steps ----

  const runStep = async (run: Run, step: PlannedStep): Promise<UndoStep> => {
    switch (step.kind) {
      case 'write': {
        const { abs } = await resolvePlace(run, step.rel, false);
        await casWrite(run, abs, step.rel, step.expectSha, step.bytes);
        return step.undo;
      }
      case 'create': {
        const { abs } = await resolvePlace(run, step.rel, true);
        const temp = atomicTempPath(abs);
        await writeFile(temp, step.bytes);
        selfWrites.record(run.slug, step.rel, sha256(step.bytes), step.bytes.length);
        let outcome: 'moved' | 'exists';
        try {
          outcome = await moveRetry(temp, abs);
        } catch (error) {
          selfWrites.forget(run.slug, step.rel);
          await rm(temp, { force: true });
          throw error;
        }
        if (outcome === 'exists') {
          selfWrites.forget(run.slug, step.rel);
          await rm(temp, { force: true });
          throw stale(run);
        }
        noteWrite(run, step.rel, step.bytes);
        return step.undo;
      }
      case 'move': {
        const source = await readMoveSource(run, step.from, step.expect);
        const used = await movePlace(run, source, step.to, source.bytes);
        // The undo names the trash entry actually used, never the one first planned.
        return step.undo.kind === 'move' && step.undo.to === step.to && used !== step.to ? { ...step.undo, to: used } : step.undo;
      }
      case 'screens': {
        const result = await store.writeScreens(run.slug, step.expectStamp, step.mutate, run.hooks);
        run.written.push([DESIGN_JSON_FILE, result.bytes]);
        run.files.add(DESIGN_JSON_FILE);
        run.designJson = true;
        run.stamps.screens = result.stamp;
        return step.undo(result.stamp);
      }
      case 'comments': {
        const result = await store.moveComments(run.slug, step.moves, run.hooks);
        if (result.bytes !== null) {
          run.written.push([DESIGN_JSON_FILE, result.bytes]);
          run.files.add(DESIGN_JSON_FILE);
          run.designJson = true;
        }
        return step.undo(result.moved);
      }
    }
  };

  // ---- reverse steps (undo, and the rollback of a failed multi-step op) ----

  const runReverse = async (run: Run, step: UndoStep): Promise<void> => {
    switch (step.kind) {
      case 'splice': {
        const { abs } = await resolvePlace(run, step.file, false);
        const current = await readFile(abs).catch((error: unknown) => {
          throw codeOf(error) === 'ENOENT' ? stale(run) : error;
        });
        if (sha256(current) !== step.afterSha) throw stale(run);
        const text = current.toString('utf8');
        if (step.start + step.inserted > text.length) throw new ApiError('invalid', UNDO_GONE_MESSAGE);
        const restored = Buffer.from(`${text.slice(0, step.start)}${step.removed}${text.slice(step.start + step.inserted)}`, 'utf8');
        if (sha256(restored) !== step.beforeSha) throw new ApiError('invalid', UNDO_GONE_MESSAGE);
        await casWrite(run, abs, step.file, step.afterSha, restored);
        return;
      }
      case 'screens': {
        const before = step.before;
        const result = await store.writeScreens(run.slug, step.afterStamp, () => structuredClone(before), run.hooks);
        run.written.push([DESIGN_JSON_FILE, result.bytes]);
        run.files.add(DESIGN_JSON_FILE);
        run.designJson = true;
        run.stamps.screens = result.stamp;
        return;
      }
      case 'move': {
        const source = await readMoveSource(run, step.to, { sha: step.sha });
        await movePlace(run, source, step.from, source.bytes);
        return;
      }
      case 'create': {
        const source = await readMoveSource(run, step.file, { sha: step.sha });
        const id = screenIdOfFile(step.file);
        if (id === null) throw new ApiError('invalid', UNDO_GONE_MESSAGE);
        await movePlace(run, source, trashPlaceOf(run.slug, id, trashStampOf(now())), source.bytes);
        return;
      }
      case 'comments': {
        // The reverse of each pair that moved, limited to the comment ids that moved: a comment
        // that was already on the destination before the edit stays there.
        const pairs = new Map<string, { from: string; to: string; ids: string[] }>();
        for (const move of step.moves) {
          const key = `${move.to}\0${move.from}`;
          const pair = pairs.get(key);
          if (pair === undefined) pairs.set(key, { from: move.to, to: move.from, ids: [move.id] });
          else pair.ids.push(move.id);
        }
        if (pairs.size === 0) return;
        const result = await store.moveComments(run.slug, [...pairs.values()], run.hooks);
        if (result.bytes !== null) {
          run.written.push([DESIGN_JSON_FILE, result.bytes]);
          run.files.add(DESIGN_JSON_FILE);
          run.designJson = true;
        }
        return;
      }
    }
  };

  /**
   * Every undo guard checked before the first change, walking the reverse order over a virtual
   * view of what the earlier reverse steps leave: hashes, screen stamps, destinations absent.
   */
  const checkUndoGuards = async (run: Run, record: UndoRecord): Promise<void> => {
    const virtual = new Map<string, string | null>();
    const shaAt = async (place: string): Promise<string | null> => (virtual.has(place) ? (virtual.get(place) ?? null) : shaOnDisk(run, place));
    let stamp: string | null | undefined;
    for (const step of [...record.steps].reverse()) {
      switch (step.kind) {
        case 'splice':
          if ((await shaAt(step.file)) !== step.afterSha) throw stale(run);
          virtual.set(step.file, step.beforeSha);
          break;
        case 'screens':
          stamp ??= (await recordOf(run.slug)).screensStamp;
          if (stamp !== step.afterStamp) throw stale(run);
          stamp = screensStampOf({ screens: step.before });
          break;
        case 'move':
          if ((await shaAt(step.to)) !== step.sha || (await shaAt(step.from)) !== null) throw stale(run);
          virtual.set(step.to, null);
          virtual.set(step.from, step.sha);
          break;
        case 'create':
          if ((await shaAt(step.file)) !== step.sha) throw stale(run);
          virtual.set(step.file, null);
          break;
        case 'comments':
          break;
      }
    }
  };

  const announce = (run: Run): void => {
    const files = [...run.files].filter((rel) => rel !== DESIGN_JSON_FILE).sort();
    if (files.length > 0) hub.emit({ slug: run.slug, kind: 'files', files, origin: 'user' });
    if (run.designJson) hub.emit({ slug: run.slug, kind: 'design', origin: 'user' });
  };

  /** A raw filesystem error as the user's sentence (logged with its code only, never content). */
  const asUserError = async (slug: string, dir: string, op: string, error: unknown): Promise<unknown> => {
    if (error instanceof ApiError) return error;
    if (codeOf(error) === 'ENOENT') {
      const left = await stat(dir).then((info) => info.isDirectory(), () => false);
      if (!left) return new ApiError('not-found', GONE_MESSAGE);
    }
    log.error('edits.write-failed', { slug, op, code: codeOf(error) ?? 'error' });
    return new ApiError('internal', folderErrorSentence(error, dir));
  };

  /** The steps in order; on a failure, the done steps undone newest first (§2.9). */
  const runForward = async (run: Run, op: EditRequest['op'], reason: UserEditReason, steps: readonly PlannedStep[]): Promise<UndoStep[]> => {
    const done: UndoStep[] = [];
    for (const step of steps) {
      try {
        done.push(await runStep(run, step));
      } catch (error) {
        const cause = await asUserError(run.slug, run.dir, op, error);
        if (done.length === 0) throw cause;
        for (const undoStep of [...done].reverse()) {
          try {
            await runReverse(run, undoStep);
          } catch {
            log.error('edits.rollback-failed', { slug: run.slug, op, step: undoStep.kind });
            announce(run);
            throw new ApiError('internal', partWayMessage(reason));
          }
        }
        log.warn('edits.rolled-back', { slug: run.slug, op, step: step.kind, code: cause instanceof ApiError ? cause.code : 'error' });
        if (cause instanceof ApiError && (cause.code === 'stale' || cause.code === 'conflict')) throw cause;
        throw new ApiError('internal', ROLLED_BACK_MESSAGE);
      }
    }
    return done;
  };

  const planOf = (base: Omit<OpInput, 'request'>, request: EditRequest): Promise<OpPlan> => {
    switch (request.op) {
      case 'text':
        return ops.text.plan({ ...base, request });
      case 'tokens':
        return ops.tokens.plan({ ...base, request });
      case 'reorder':
        return ops.reorder.plan({ ...base, request });
      case 'duplicate':
        return ops.duplicate.plan({ ...base, request });
      case 'trash-screen':
        return ops['trash-screen'].plan({ ...base, request });
      case 'keep-direction':
        return ops['keep-direction'].plan({ ...base, request });
    }
  };

  const service: EditService = {
    __dcEditService: true,
    editsFile,

    async apply(slug, body) {
      await recordOf(slug);
      const request = parseEditRequest(body);
      const { op } = request;
      const reason: UserEditReason = op === 'keep-direction' ? 'keep-direction' : 'user-edit';
      const editId = mintEditId();
      try {
        const result = await versions.userEdit(slug, reason, {
          staleMessage: STALE_MESSAGES[op],
          precheck: async () => {
            // Read again inside the chain: an edit queued behind another sees what that one left.
            const record = await recordOf(slug);
            const run = newRun(slug, record.path, STALE_MESSAGES[op]);
            const plan = await planOf({ slug, record, dir: record.path, store, trashDir: run.trashDir, now }, request).catch(async (error: unknown) => {
              throw await asUserError(slug, record.path, op, error);
            });
            if (!plan.steps.every((step) => stepAllowed(op, record, slug, step))) {
              log.error('edits.plan-refused', { slug, op });
              throw new ApiError('internal', ROLLED_BACK_MESSAGE);
            }
            return { plan, run };
          },
          apply: async ({ plan, run }) => {
            const undoSteps = await runForward(run, op, reason, plan.steps);
            announce(run);
            let undoable = false;
            if (plan.steps.length > 0) {
              try {
                const at = now();
                const after = await editsFile.update(slug, run.dir, (file) =>
                  appendEdit(file, { editId, at: at.toISOString(), label: plan.label, body: plan.ledger, steps: undoSteps }, at.getTime()),
                );
                undoable = after.undo.some((record) => record.id === editId);
              } catch (error) {
                // The edit stands; the notice just has no Undo.
                log.warn('edits.record-failed', { slug, op, code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
              }
            }
            const response: Omit<EditResponse, 'version' | 'coalesced'> = {
              edit: { id: editId, label: plan.label, ...(plan.detail ? { detail: plan.detail } : {}), files: [...run.files].sort(), undoable },
              stamps: run.stamps,
              ...(plan.created ? { created: plan.created } : {}),
            };
            return { response, written: run.written };
          },
        });
        log.info('edits.applied', { slug, op, coalesced: result.coalesced });
        return { ...result.response, version: result.version === null ? null : toSummary(result.version), coalesced: result.coalesced };
      } catch (error) {
        throw await goneOr(slug, error);
      }
    },

    async undo(slug, id) {
      if (!EDIT_ID_PATTERN.test(id)) throw new ApiError('bad-request', 'That is not an edit id.');
      await recordOf(slug);
      try {
        const result = await versions.userEdit(slug, 'user-edit', {
          staleMessage: UNDO_STALE_MESSAGE,
          precheck: async () => {
            const design = await recordOf(slug);
            const file = await editsFile.read(slug, design.path);
            const record = findUndo(file, id, now().getTime());
            if (record === null) throw new ApiError('not-found', UNDO_GONE_MESSAGE);
            const run = newRun(slug, design.path, UNDO_STALE_MESSAGE);
            await checkUndoGuards(run, record).catch(async (error: unknown) => {
              throw await asUserError(slug, design.path, 'undo', error);
            });
            return { record, run };
          },
          apply: async ({ record, run }) => {
            let reversed = 0;
            for (const step of [...record.steps].reverse()) {
              try {
                await runReverse(run, step);
                reversed += 1;
              } catch (error) {
                if (reversed === 0) throw await asUserError(slug, run.dir, 'undo', error);
                log.error('edits.undo-failed', { slug, step: step.kind });
                announce(run);
                throw new ApiError('internal', partWayMessage('user-edit'));
              }
            }
            announce(run);
            try {
              const at = now();
              await editsFile.update(slug, run.dir, (file) => {
                const still = file.undo.find((one) => one.id === record.id);
                return still === undefined ? file : applyUndone(file, still, at.toISOString(), at.getTime());
              });
            } catch (error) {
              // The files are back; a later undo of this id is refused by its guards.
              log.warn('edits.record-failed', { slug, op: 'undo', code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
            }
            const response: Omit<UndoEditResponse, 'version'> = { files: [...run.files].sort(), stamps: run.stamps };
            return { response, written: run.written };
          },
        });
        log.info('edits.undone', { slug });
        return { ...result.response, version: result.version === null ? null : toSummary(result.version) };
      } catch (error) {
        throw await goneOr(slug, error);
      }
    },

    async clearHandEdits(slug, upTo) {
      const record = await recordOf(slug);
      await editsFile.update(slug, record.path, (file) => clearLedger(file, upTo));
    },

    async readTokens(slug) {
      const record = await recordOf(slug);
      return tokensReader(record, record.path);
    },
  };
  return service;
};

// ---- wiring (the routes share one instance per context) ----

const instances = new WeakMap<ServiceContext, EditService>();

export const ensureEditService = (ctx: ServiceContext): EditService => {
  const existing = instances.get(ctx);
  if (existing) return existing;
  const created = createEditService({
    store: ctx.store,
    versions: ensureVersionsService(ctx),
    hub: ctx.hub,
    selfWrites: ctx.selfWrites,
    settings: ctx.settings,
    log: ctx.log,
  });
  instances.set(ctx, created);
  return created;
};
