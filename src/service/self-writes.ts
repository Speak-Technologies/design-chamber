// Telling the user's writes from the agent's (Phase 2 technical design §2.6, E10): the last
// bytes the service itself left at each `(slug, rel)`. The watcher drops a file event whose
// current bytes equal the recorded ones — the echo of a hand edit, a restore or a screen write.
//
// No clock and no consumption: Windows can report one rename as two events in separate
// debounce flushes, and the OneDrive/network poll backstop can see the change ~30 s later;
// both must still read as the echo. The entry lives until the watcher sees other bytes
// (`forget`), the design is removed (`forgetDesign`) or the root changes (`clear`).

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { SELF_WRITES_MAX, SOURCE_TEXT_MAX } from '../shared/limits.ts';
import type { SelfWrites } from './context.ts';

type Entry = { sha256: string | null; size: number | null };

/** A slug can never hold NUL (it is pattern-validated), so this key cannot collide across designs. */
const keyOf = (slug: string, rel: string): string => `${slug}\0${rel}`;

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const createSelfWrites = (): SelfWrites => {
  /** Insertion order is the record order: the first key is the least recently recorded. */
  const entries = new Map<string, Entry>();

  const remember = (key: string, entry: Entry): void => {
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > SELF_WRITES_MAX) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
  };

  return {
    record(slug, rel, sha256, size) {
      // No edit writes a file over the source cap, so such a file is never the service's echo.
      if (size !== null && size > SOURCE_TEXT_MAX) return;
      remember(keyOf(slug, rel), { sha256, size });
    },

    async isEcho(slug, rel, dir) {
      const entry = entries.get(keyOf(slug, rel));
      if (entry === undefined) return false;
      // `dir` is the design's contained folder and `rel` a design-relative path the service
      // itself wrote or the watcher derived under it — never request input.
      const file = path.join(dir, rel);
      if (entry.sha256 === null) {
        // Removed or moved away: the echo is the file being absent.
        return stat(file).then(
          () => false,
          (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
        );
      }
      let info;
      try {
        info = await stat(file);
      } catch {
        return false;
      }
      // A different size is not an echo: no read needed.
      if (entry.size !== null && info.size !== entry.size) return false;
      try {
        return sha256Of(await readFile(file)) === entry.sha256;
      } catch {
        return false;
      }
    },

    forget(slug, rel) {
      entries.delete(keyOf(slug, rel));
    },

    forgetDesign(slug) {
      const prefix = `${slug}\0`;
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },

    clear() {
      entries.clear();
    },
  };
};