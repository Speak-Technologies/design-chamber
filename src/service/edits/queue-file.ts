// One service-owned JSON file per folder, read and rewritten on a per-key queue (Phase 2 technical
// design §2.1, §7.1; extracted for Phase 2.5 §5.3 with no behaviour change for designs). A design's
// `.chamber/edits.json` and a design system's `.chamber/edits.json` both live behind it.
//
// Everything read back is untrusted (anything that can write the folder can write the file): the
// owner's `parse` keeps only what validates. A file that is too large, not JSON or a link reads as
// `empty`; the next write replaces it, and a link is never written through. `update` runs on the
// key's promise chain and re-reads the file inside it, so no caller ever writes a copy it read
// earlier.

import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from '../context.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE, resolvePlainTarget, writeFileAtomic } from '../paths.ts';

export type QueueFileStore<T> = {
  /** The validated file (`empty` when absent, damaged, too large or a link). No queue: the file is replaced atomically. */
  read(key: string, dir: string): Promise<T>;
  /** Read-modify-write on the key's queue; `mutate` sees the file as it is inside the queue. Answers the file as written. */
  update(key: string, dir: string, mutate: (file: T) => T): Promise<T>;
};

export type QueueFileOptions<T> = {
  log: Logger;
  /** Path segments under the folder, e.g. `['.chamber', 'edits.json']`; the parent is made without recursion. */
  segments: readonly string[];
  maxBytes: number;
  empty: () => T;
  /** The file as far as it validates; `damaged` counts what was dropped (logged, never the content). */
  parse: (value: unknown, key: string) => { file: T; damaged: number };
  /** The text written, and the file it holds (it may drop entries to fit `maxBytes`). */
  serialize: (file: T) => { text: string; file: T };
  /** The 404 sentence when the folder itself is gone at write time. */
  goneMessage: string;
  /** Log event prefix (`edits` → `edits.file-link`, `edits.file-unreadable`). */
  logPrefix: string;
  /** The log field naming the key (`slug` for a design, `system` for a system). */
  keyField: string;
};

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

export const createQueueFile = <T>(options: QueueFileOptions<T>): QueueFileStore<T> => {
  const { log, segments, maxBytes, empty, parse, serialize, goneMessage, logPrefix, keyField } = options;
  const parentSegments = segments.slice(0, -1);
  const chains = new Map<string, Promise<unknown>>();
  const chained = <R>(key: string, fn: () => Promise<R>): Promise<R> => {
    const previous = chains.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, settled);
    void settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });
    return run;
  };

  /** The lexical file path, or null when a folder on the way or the file is a link (or not a regular file). */
  const targetOf = async (key: string, dir: string): Promise<string | null> => {
    try {
      return await resolvePlainTarget(dir, segments, { allowAbsent: true });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      log.warn(`${logPrefix}.file-link`, { [keyField]: key });
      return null;
    }
  };

  const read = async (key: string, dir: string): Promise<T> => {
    let target: string | null;
    try {
      target = await targetOf(key, dir);
    } catch (error) {
      log.warn(`${logPrefix}.file-unreadable`, { [keyField]: key, code: codeOf(error) ?? 'error' });
      return empty();
    }
    if (target === null) return empty();
    try {
      const info = await stat(target);
      if (info.size > maxBytes) {
        log.warn(`${logPrefix}.file-unreadable`, { [keyField]: key, code: 'too-large' });
        return empty();
      }
      const parsed = parse(JSON.parse(await readFile(target, 'utf8')) as unknown, key);
      if (parsed.damaged > 0) log.warn(`${logPrefix}.file-unreadable`, { [keyField]: key, code: 'entries-dropped', dropped: parsed.damaged });
      return parsed.file;
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return empty();
      log.warn(`${logPrefix}.file-unreadable`, { [keyField]: key, code: codeOf(error) ?? 'not-json' });
      return empty();
    }
  };

  const write = async (key: string, dir: string, text: string): Promise<void> => {
    if (parentSegments.length > 0) {
      try {
        // Not recursive: a folder removed meanwhile is never re-created.
        await mkdir(path.join(dir, ...parentSegments));
      } catch (error) {
        if (codeOf(error) !== 'EEXIST') {
          const folderLeft = await stat(dir).then((info) => info.isDirectory(), () => false);
          throw folderLeft ? error : new ApiError('not-found', goneMessage);
        }
      }
    }
    // Resolved after the mkdir, so a link that was already there is refused, never written through.
    const target = await targetOf(key, dir);
    if (target === null) throw new ApiError('invalid', LINK_SENTENCE);
    await writeFileAtomic(target, text, { createDirs: false });
  };

  return {
    read,
    update: (key, dir, mutate) =>
      chained(key, async () => {
        const current = await read(key, dir);
        const next = mutate(current);
        if (next === current) return current;
        const { text, file } = serialize(next);
        await write(key, dir, text);
        return file;
      }),
  };
};
