// Loose HTML files in the designs root (documentation/specs/agent-guidance-and-pages.md §3.5,
// §9, §10). An agent without Design Chamber's instructions sometimes saves a page straight into
// the root as `<root>/pricing.html`; only folders are designs, so it would never show up. This
// module lists those files (bounded) and imports one: its bytes become `index.html` of a new
// page folder, then the original is moved into `<root>/.trash/`. Nothing is ever deleted, and a
// failure between the two steps leaves both copies, never neither.
//
// Trust: a request name only selects among the root's own entries. It must pass the name rule
// AND appear in a fresh `readdir(root)` as a regular-file Dirent (symlinks, folders and devices
// never qualify); the read then goes through `resolveInside` and an O_NOFOLLOW descriptor whose
// fstat is re-checked, so a file swapped for a symlink after the listing is not followed. The
// bytes are copied as bytes, never decoded (only the title scan decodes a copy of the head).

import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type { ImportLooseResponse } from '../shared/api.ts';
import { ENTRY_FILE } from '../shared/design-json.ts';
import { LOOSE_IMPORT_MAX_BYTES, LOOSE_LIST_MAX, LOOSE_SCAN_MAX, LOOSE_TITLE_SCAN_BYTES } from '../shared/limits.ts';
import type { LooseHtmlFile } from '../shared/types.ts';
import type { DesignStore, Logger, SettingsStore } from './context.ts';
import { ApiError } from './http.ts';
import { resolveInside, writeFileAtomic } from './paths.ts';
import { extractTitle } from './render-cache.ts';

/** Longest file name most filesystems accept (NTFS, ext4, APFS: 255). */
export const LOOSE_NAME_MAX = 255;

/** Trash names add `-<yyyymmddhhmmss>[-n]`; the stem is cut so the name stays under the limit. */
const TRASH_STEM_MAX = 200;

/** Collision suffixes tried in `.trash/` before giving up (the move then fails, the copy stays). */
const TRASH_SUFFIX_MAX = 1000;

const NOT_HERE = 'That file is no longer in your designs folder.';
const BAD_NAME = 'That is not the name of an HTML file in your designs folder.';
const BUSY = 'That file is being imported already.';
const TOO_LARGE = `That file is over ${LOOSE_IMPORT_MAX_BYTES / (1024 * 1024)} MB, so it can't be imported. Move it into a design folder by hand.`;

/**
 * The import name rule (§2): 1–255 characters, no `/`, `\`, NUL or other control character, not
 * dot-first (hidden files, `.trash`), ending in `.html` or `.htm` in any case. A name with no
 * separator can only ever mean an entry directly in the root.
 */
export const isLooseHtmlName = (name: unknown): name is string =>
  typeof name === 'string' &&
  name.length >= 1 &&
  name.length <= LOOSE_NAME_MAX &&
  !name.startsWith('.') &&
  !/[\\/\u0000-\u001f\u007f]/.test(name) &&
  /\.html?$/i.test(name);

const errorCode = (error: unknown): string => String((error as NodeJS.ErrnoException | null)?.code ?? '');

const isMissingFolder = (error: unknown): boolean => errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR';

/** Names of the root's regular files that pass the name rule, sorted; a missing root has none. */
const looseNamesIn = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFolder(error)) return [];
    throw error;
  });
  // Dirent.isFile() is false for a symlink (it describes the link, not its target).
  return entries
    .filter((entry) => entry.isFile() && isLooseHtmlName(entry.name))
    .map((entry) => entry.name)
    .sort();
};

export type LooseList = { files: LooseHtmlFile[]; total: number };

/**
 * The loose HTML files in `root`: `total` counts every one, `files` holds the newest
 * `LOOSE_LIST_MAX` among the first `LOOSE_SCAN_MAX` names (by name), newest first. At most
 * `LOOSE_SCAN_MAX` entries are `lstat`ed, so a root full of files costs one readdir.
 */
export const listLooseHtml = async (root: string): Promise<LooseList> => {
  const names = await looseNamesIn(root);
  const found: (LooseHtmlFile & { ms: number })[] = [];
  let vanished = 0;
  for (const name of names.slice(0, LOOSE_SCAN_MAX)) {
    // A Dirent name from the root's own listing has no separator, and lstat reads only the
    // entry's metadata without following a link: nothing here can leave the root.
    const info = await lstat(path.join(root, name)).catch(() => null);
    if (info === null || !info.isFile()) {
      vanished += 1; // removed or replaced since the readdir
      continue;
    }
    found.push({ name, bytes: info.size, mtime: new Date(info.mtimeMs).toISOString(), ms: info.mtimeMs });
  }
  found.sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name));
  return {
    files: found.slice(0, LOOSE_LIST_MAX).map(({ name, bytes, mtime }) => ({ name, bytes, mtime })),
    total: names.length - vanished,
  };
};

/** `pricing-v2.html` → "Pricing v2"; the bare stem when nothing readable is left. */
export const humaniseStem = (name: string): string => {
  const stem = name.replace(/\.html?$/i, '');
  const words = stem.replace(/[-_.\s]+/g, ' ').trim();
  if (words === '') return stem;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/** The page title: the file's `<title>` within its first `LOOSE_TITLE_SCAN_BYTES`, else the humanised stem. */
export const looseTitleOf = (name: string, bytes: Uint8Array): string => {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, LOOSE_TITLE_SCAN_BYTES)).toString('utf8');
  const title = extractTitle(head);
  return title !== '' ? title : humaniseStem(name);
};

const timestampOf = (date: Date): string => {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
};

/** True when anything (file, folder, dangling link) already holds `target`. */
const taken = async (target: string): Promise<boolean> => (await lstat(target).catch(() => null)) !== null;

// O_NOFOLLOW makes opening a symlink fail (ELOOP) instead of reading its target; O_NONBLOCK keeps
// a FIFO swapped in after the checks from blocking the open. Neither exists on Windows (`?? 0`),
// where the Dirent and fstat checks still refuse links and non-files.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** All bytes of the loose file, refused (404/413) unless the opened entry is a regular file ≤ the cap. */
const readLooseFile = async (source: string, name: string): Promise<Buffer> => {
  let handle: FileHandle;
  try {
    handle = await open(source, READ_FLAGS);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'EISDIR' || code === 'ENOTDIR') throw new ApiError('not-found', NOT_HERE);
    if (code === 'EACCES' || code === 'EPERM') {
      throw new ApiError('internal', `Design Chamber isn't allowed to read ${name}. Check the file's permissions, then try again.`);
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new ApiError('not-found', NOT_HERE);
    if (info.size > LOOSE_IMPORT_MAX_BYTES) throw new ApiError('too-large', TOO_LARGE);
    const bytes = await handle.readFile();
    if (bytes.byteLength > LOOSE_IMPORT_MAX_BYTES) throw new ApiError('too-large', TOO_LARGE); // grew while being read
    return bytes;
  } finally {
    await handle.close();
  }
};

export type LooseImporterOptions = {
  settings: Pick<SettingsStore, 'root'>;
  store: Pick<DesignStore, 'create' | 'trash'>;
  log: Logger;
  /** Clock for the trash name; tests pin it. */
  now?: () => Date;
};

export type LooseImporter = {
  /** `POST /loose/import`: validates `name` (unknown request input) itself. */
  importFile(name: unknown): Promise<ImportLooseResponse>;
};

export const createLooseImporter = (options: LooseImporterOptions): LooseImporter => {
  const { settings, store, log } = options;
  const now = options.now ?? (() => new Date());
  /** Names being imported right now: a second click (rail and page both open) gets 409. */
  const inFlight = new Set<string>();

  /** Move the original into `<root>/.trash/<stem>-<stamp>[-n].<ext>`; answers the new absolute path. */
  const moveToTrash = async (root: string, source: string, name: string): Promise<string> => {
    const trashRoot = await resolveInside(root, ['.trash']);
    await mkdir(trashRoot, { recursive: true });
    const ext = path.extname(name); // `.html` / `.htm` in the file's own case (the name rule guarantees one)
    const stem = name.slice(0, name.length - ext.length).slice(0, TRASH_STEM_MAX);
    const stamp = timestampOf(now());
    for (let suffix = 1; suffix <= TRASH_SUFFIX_MAX; suffix += 1) {
      const target = path.join(trashRoot, `${stem}-${stamp}${suffix === 1 ? '' : `-${suffix}`}${ext}`);
      if (await taken(target)) continue;
      await rename(source, target);
      return target;
    }
    throw new Error(`No free name in .trash for ${name}.`);
  };

  const importLocked = async (name: string): Promise<ImportLooseResponse> => {
    const root = settings.root();
    // A fresh listing, not the one the banner showed: the file must still be here, as a regular file.
    if (!(await looseNamesIn(root)).includes(name)) throw new ApiError('not-found', NOT_HERE);
    const source = await resolveInside(root, [name]);
    const bytes = await readLooseFile(source, name);

    const record = await store.create({ kind: 'page', title: looseTitleOf(name, bytes), brief: '' });
    try {
      // record.path is the store's contained folder (resolveInside at create time).
      await writeFileAtomic(path.join(record.path, ENTRY_FILE), bytes);
    } catch (error) {
      log.warn('loose.copy-failed', { name, slug: record.slug, code: errorCode(error), error: error instanceof Error ? error.message : String(error) });
      // The half-made page goes to .trash like any deleted design; the original was never touched.
      await store.trash(record.slug).catch((trashError: unknown) =>
        log.warn('loose.cleanup-failed', { slug: record.slug, error: trashError instanceof Error ? trashError.message : String(trashError) }),
      );
      throw new ApiError('internal', `Design Chamber couldn't copy ${name} into a new page, so the original is still in your designs folder. Try again.`);
    }

    let originalMovedTo: string | null = null;
    try {
      originalMovedTo = await moveToTrash(root, source, name);
    } catch (error) {
      // The page exists and the original stays put: two copies, nothing lost. The UI says so.
      log.warn('loose.trash-failed', { name, slug: record.slug, code: errorCode(error), error: error instanceof Error ? error.message : String(error) });
    }
    log.info('loose.imported', { name, slug: record.slug, moved: originalMovedTo !== null });
    return { slug: record.slug, title: record.design.title, originalMovedTo };
  };

  return {
    async importFile(name) {
      if (!isLooseHtmlName(name)) throw new ApiError('bad-request', BAD_NAME);
      // Taken synchronously, before the first await, so two calls in the same tick cannot both pass.
      if (inFlight.has(name)) throw new ApiError('conflict', BUSY);
      inFlight.add(name);
      try {
        return await importLocked(name);
      } finally {
        inFlight.delete(name);
      }
    },
  };
};
