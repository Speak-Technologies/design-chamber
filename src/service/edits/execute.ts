// The step executor every hand edit runs through (Phase 2 technical design §2.4, §2.5, §2.9;
// extracted for Phase 2.5 §5.3, AD-4, with no behaviour change for designs).
//
// One run works on one folder (a design, or a design system) through the caller's `resolve`,
// which contains every place before it is touched. The executor owns the file mechanics only:
//   - a write is a compare-and-swap: it lands only while the file still hashes to what the op read;
//   - a create and a move never replace anything (`moveNoReplace`);
//   - the self-write is recorded right before each rename (the watcher's echo filter) and
//     forgotten again when nothing was written;
//   - a Windows lock is retried three times (40/80/120 ms), then the busy sentence;
//   - `executeSteps` runs the steps in order and, on a failure, undoes the done ones newest first.
// What a step means (which files an op may touch, the design.json screen list, the ledger) stays
// with the caller: the design pipeline (`pipeline.ts`) and the system edits (`systems/edits.ts`).

import { createHash } from 'node:crypto';
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';

import type { FileStamp } from '../../shared/api.ts';
import type { SelfWrites } from '../context.ts';
import { ApiError } from '../http.ts';
import { atomicTempPath, moveNoReplace, replaceFileIfHashUnchanged } from '../paths.ts';

export const BUSY_MESSAGE = 'Another program is using this file. Close it and try again.';
export const ROLLED_BACK_MESSAGE = 'Something went wrong, so nothing was changed.';

/** Busy retries for a Windows lock: three more tries after the first, then the conflict sentence (§2.5). */
export const BUSY_PAUSES_MS: readonly number[] = [40, 80, 120];

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** A place resolved by the run's owner: the absolute path, and the folder-relative file (null for a trash entry). */
export type ExecPlace = { abs: string; rel: string | null };

/** One run of steps (forward, reverse or rollback) on one folder. */
export type ExecRun = {
  /** The self-writes key: a design's slug, or `systemSelfWritesKey(id)`. */
  key: string;
  /** The stale sentence of this op (a lost compare-and-swap, a moved source, a taken destination). */
  staleMessage: string;
  /** A place's contained absolute path; throws for anything outside the folder's writable set. */
  resolve(place: string, allowAbsent: boolean): Promise<ExecPlace>;
  /** Called for every file a step left: its new bytes, or null when it moved away. */
  noteWrite(rel: string | null, bytes: Uint8Array | null): void;
};

/** The splice undo step (`edits/file.ts` `UndoStep`), the one reverse kind both designs and systems use. */
export type SpliceStep = { file: string; start: number; inserted: number; removed: string; afterSha: string; beforeSha: string };

export const UNDO_GONE_MESSAGE = "This edit can't be undone any more.";

export type StepExecutor = {
  stale(run: ExecRun): ApiError;
  /** The sha256 of a place's bytes now, or null when it is absent. */
  shaOnDisk(run: ExecRun, place: string): Promise<string | null>;
  /** Compare-and-swap with the busy retries; the self-write is recorded first and forgotten again when nothing was written. */
  casWrite(run: ExecRun, abs: string, rel: string, expectSha: string, bytes: Uint8Array): Promise<void>;
  /** A new file published without replacing anything; a file there already is stale. */
  createFile(run: ExecRun, rel: string, bytes: Uint8Array): Promise<void>;
  /**
   * Move a file to `to` without replacing anything; a destination taken meanwhile moves on to
   * `next(to)` while `renamable(to)` (then 409 conflict), else it is stale. Answers the place used.
   */
  movePlace(run: ExecRun, from: ExecPlace, to: string, bytes: Buffer, alternatives: MoveAlternatives): Promise<string>;
  /** The source of a move, still as the op saw it: its hash, or the size and mtime the wall showed. */
  readMoveSource(run: ExecRun, from: string, expect: { sha: string } | FileStamp): Promise<ExecPlace & { bytes: Buffer }>;
  /** Put a splice's removed text back while the file still hashes to what the edit left. */
  reverseSplice(run: ExecRun, step: SpliceStep): Promise<void>;
};

export type MoveAlternatives = { renamable(place: string): boolean; next(place: string): string | null };

export type StepExecutorDeps = {
  selfWrites: SelfWrites;
  /** Pause before a busy retry. */
  pause: (ms: number) => Promise<void>;
};

export const createStepExecutor = (deps: StepExecutorDeps): StepExecutor => {
  const { selfWrites, pause } = deps;

  const stale = (run: ExecRun): ApiError => new ApiError('stale', run.staleMessage);

  const shaOnDisk = async (run: ExecRun, place: string): Promise<string | null> => {
    const { abs } = await run.resolve(place, true);
    try {
      return sha256(await readFile(abs));
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return null;
      throw error;
    }
  };

  const casWrite = async (run: ExecRun, abs: string, rel: string, expectSha: string, bytes: Uint8Array): Promise<void> => {
    selfWrites.record(run.key, rel, sha256(bytes), bytes.length);
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await replaceFileIfHashUnchanged(abs, expectSha, bytes);
      if (outcome === 'replaced') return run.noteWrite(rel, bytes);
      if (outcome === 'changed' || attempt >= BUSY_PAUSES_MS.length) {
        selfWrites.forget(run.key, rel);
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

  const createFile = async (run: ExecRun, rel: string, bytes: Uint8Array): Promise<void> => {
    const { abs } = await run.resolve(rel, true);
    const temp = atomicTempPath(abs);
    await writeFile(temp, bytes);
    selfWrites.record(run.key, rel, sha256(bytes), bytes.length);
    let outcome: 'moved' | 'exists';
    try {
      outcome = await moveRetry(temp, abs);
    } catch (error) {
      selfWrites.forget(run.key, rel);
      await rm(temp, { force: true });
      throw error;
    }
    if (outcome === 'exists') {
      selfWrites.forget(run.key, rel);
      await rm(temp, { force: true });
      throw stale(run);
    }
    run.noteWrite(rel, bytes);
  };

  const movePlace = async (run: ExecRun, from: ExecPlace, to: string, bytes: Buffer, alternatives: MoveAlternatives): Promise<string> => {
    for (let candidate: string | null = to; candidate !== null; candidate = alternatives.renamable(candidate) ? alternatives.next(candidate) : null) {
      const target = await run.resolve(candidate, true);
      if (from.rel !== null) selfWrites.record(run.key, from.rel, null, null);
      if (target.rel !== null) selfWrites.record(run.key, target.rel, sha256(bytes), bytes.length);
      const outcome = await moveRetry(from.abs, target.abs).catch((error: unknown) => {
        if (from.rel !== null) selfWrites.forget(run.key, from.rel);
        if (target.rel !== null) selfWrites.forget(run.key, target.rel);
        throw error;
      });
      if (outcome === 'moved') {
        run.noteWrite(from.rel, null);
        run.noteWrite(target.rel, bytes);
        return candidate;
      }
      if (from.rel !== null) selfWrites.forget(run.key, from.rel);
      if (target.rel !== null) selfWrites.forget(run.key, target.rel);
      if (!alternatives.renamable(candidate)) throw stale(run);
    }
    throw new ApiError('conflict', BUSY_MESSAGE);
  };

  const readMoveSource = async (run: ExecRun, from: string, expect: { sha: string } | FileStamp): Promise<ExecPlace & { bytes: Buffer }> => {
    const source = await run.resolve(from, true);
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

  const reverseSplice = async (run: ExecRun, step: SpliceStep): Promise<void> => {
    const { abs } = await run.resolve(step.file, false);
    const current = await readFile(abs).catch((error: unknown) => {
      throw codeOf(error) === 'ENOENT' ? stale(run) : error;
    });
    if (sha256(current) !== step.afterSha) throw stale(run);
    const text = current.toString('utf8');
    if (step.start + step.inserted > text.length) throw new ApiError('invalid', UNDO_GONE_MESSAGE);
    const restored = Buffer.from(`${text.slice(0, step.start)}${step.removed}${text.slice(step.start + step.inserted)}`, 'utf8');
    if (sha256(restored) !== step.beforeSha) throw new ApiError('invalid', UNDO_GONE_MESSAGE);
    await casWrite(run, abs, step.file, step.afterSha, restored);
  };

  return { stale, shaOnDisk, casWrite, createFile, movePlace, readMoveSource, reverseSplice };
};

// ---- running a plan ----

export type ExecuteHooks<S, U> = {
  /** One step forward; answers how it is undone. */
  forward(step: S): Promise<U>;
  /** One undo step (the rollback of a failed multi-step op). */
  reverse(undo: U): Promise<void>;
  /** A raw failure as the user's error (an `ApiError` passes through). */
  asUserError(error: unknown): Promise<unknown>;
  /** The rollback itself failed: log, announce what was written, and answer the part-way sentence. */
  rollbackFailed(undo: U): ApiError;
  /** The done steps were undone after `step` failed (for the log). */
  rolledBack(step: S, cause: unknown): void;
};

/**
 * The steps in order; on a failure, the done steps undone newest first (§2.9). A stale or busy
 * failure keeps its own sentence once rolled back; anything else becomes "nothing was changed".
 */
export const executeSteps = async <S, U>(steps: readonly S[], hooks: ExecuteHooks<S, U>): Promise<U[]> => {
  const done: U[] = [];
  for (const step of steps) {
    try {
      done.push(await hooks.forward(step));
    } catch (error) {
      const cause = await hooks.asUserError(error);
      if (done.length === 0) throw cause;
      for (const undo of [...done].reverse()) {
        try {
          await hooks.reverse(undo);
        } catch {
          throw hooks.rollbackFailed(undo);
        }
      }
      hooks.rolledBack(step, cause);
      if (cause instanceof ApiError && (cause.code === 'stale' || cause.code === 'conflict')) throw cause;
      throw new ApiError('internal', ROLLED_BACK_MESSAGE);
    }
  }
  return done;
};
