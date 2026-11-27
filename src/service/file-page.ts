// "Open as page in Design Chamber" on a Files row (documentation/specs/native-extras.md §3.3 to
// §3.6): `POST /pages/from-file` copies one project HTML file, and the local files it uses from
// its own folder, into a new page design. Always a copy, never a live link (owner decision 4).
//
// Trust: this is the first route whose body names a file outside the designs root. The body is
// checked here (`parseFromFileBody`), the path normalised by the pure `resolveFileTarget` (posix
// and win32, UNC refused), and then only these reads happen:
//   - the entry: `readRegularFile` (O_NOFOLLOW, regular file, LOOSE_IMPORT_MAX_BYTES), once;
//   - its local files: every one through `createLiveFileSource(folder)` → `resolveInside(folder, …)`,
//     so a reference, or a link inside the folder, that leaves the HTML's own folder is refused
//     (`RefBlocked`) and never read. Only CSS and HTML are read for the scan; other files are
//     only stat'ed until the copy, which reads each through `resolveInside` + `readRegularFile`.
// Writes go only into the new design folder (`store.create`), every path through
// `resolveInside(designDir, …)` and `writeFileAtomic`. A copy that fails, runs over the byte cap
// or over FILE_PAGE_COPY_BUDGET_MS moves the half-made design to `.trash`. The bytes are copied
// as bytes; nothing is decoded or rewritten (only the title scan decodes a copy of the head).

import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type { FromFileBody, FromFileResponse } from '../shared/api.ts';
import { ENTRY_FILE } from '../shared/design-json.ts';
import { FILE_PAGE_COPY_BUDGET_MS, FILE_PAGE_COPY_MAX_BYTES, FILE_PAGE_DEDUPE_SCAN_MAX, FILE_PAGE_PATH_MAX, LOOSE_IMPORT_MAX_BYTES } from '../shared/limits.ts';
import { foldsCase, isStrictlyInside, samePath, type PathModule } from '../shared/path-compare.ts';
import { COPY_DIR } from '../shared/system-copy.ts';
import { bundleDocument, BundleTooLarge, createLiveFileSource, mimeOf, type FileSource, type SourceFile } from './bundle.ts';
import type { DesignIndex, DesignRecord, DesignStore, Logger, SelfWrites, SettingsStore } from './context.ts';
import { ApiError } from './http.ts';
import { looseTitleOf, readRegularFile } from './loose.ts';
import { resolveInside, writeFileAtomic } from './paths.ts';
import { recordOwnWrite } from './self-writes.ts';

// ---- sentences (the background frame shows them as the toast) ----

export const FILE_PAGE_NOT_HTML = 'Only .html and .htm files open as pages.';
export const FILE_PAGE_NETWORK = 'That file is on a network drive. Copy the file to this computer first.';
export const FILE_PAGE_WHERE = "Design Chamber couldn't tell which folder that file is in. Open it from the project's Files list again.";
export const FILE_PAGE_OUTSIDE = "That file is outside the project folder, so Design Chamber won't open it.";
export const FILE_PAGE_IN_ROOT = "That file is in your Designs folder. Import it from Design Chamber's list.";
export const FILE_PAGE_IN_ROOT_OTHER = "That file is in your Designs folder but isn't part of a design, so it can't be opened as a page.";
export const FILE_PAGE_BUSY = 'That file is being opened already.';
export const FILE_PAGE_LINK = 'That file is a link. Open the file it points to instead.';
export const FILE_PAGE_MISSING = "That file isn't there any more.";
export const FILE_PAGE_NOT_FILE = 'Pick an .html file to open it as a page.';
export const FILE_PAGE_DENIED = "Design Chamber isn't allowed to read that file. Check its permissions, then try again.";
export const FILE_PAGE_ENTRY_TOO_LARGE = `That file is over ${LOOSE_IMPORT_MAX_BYTES / (1024 * 1024)} MB, so it can't be opened as a page.`;
export const FILE_PAGE_COPY_TOO_LARGE = `This page uses more than ${FILE_PAGE_COPY_MAX_BYTES / (1024 * 1024)} MB of files, so it can't be copied. Export it from your project instead.`;
export const FILE_PAGE_TOO_SLOW = "Copying this page took too long, so it was stopped. Export it from your project instead.";
export const FILE_PAGE_COPY_FAILED = "Design Chamber couldn't copy that file into a new page. Nothing in your project was changed. Try again.";
export const FILE_PAGE_DISK_FULL = "There isn't enough disk space to copy that page. Free some space, then try again.";
export const FILE_PAGE_WRITE_DENIED = "Design Chamber isn't allowed to write to your Designs folder. Check its permissions, then try again.";

// ---- step 1: the body ----

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 1..`FILE_PAGE_PATH_MAX` characters, no NUL or other control character. */
const isPathText = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= FILE_PAGE_PATH_MAX && !/[\u0000-\u001f\u007f]/.test(value);

/** Exactly `{ path, directory }`; anything else is 400 `bad-request`. Nothing is touched here. */
export const parseFromFileBody = (body: unknown): FromFileBody => {
  if (!isRec(body)) throw new ApiError('bad-request', 'Send the file as a JSON object.');
  const keys = Object.keys(body);
  if (keys.length !== 2 || !Object.hasOwn(body, 'path') || !Object.hasOwn(body, 'directory')) {
    throw new ApiError('bad-request', 'Send the file path and its folder, and nothing else.');
  }
  const { path: filePath, directory } = body;
  if (!isPathText(filePath)) throw new ApiError('bad-request', `The file path must be text of 1 to ${FILE_PAGE_PATH_MAX} characters with no control characters.`);
  if (directory !== null && !isPathText(directory)) {
    throw new ApiError('bad-request', `The folder must be empty or text of 1 to ${FILE_PAGE_PATH_MAX} characters with no control characters.`);
  }
  return { path: filePath, directory };
};

// ---- step 2: the target (pure) ----

/** The file the user picked, normalised: `target` absolute, `directory` absolute or null, `name` its base name. */
export type FileTarget = { target: string; directory: string | null; name: string };

/** `\\server\share`, `//server/share`, `\\?\…` and `\\.\…`: a network or device path, in either slash. */
const isNetworkPath = (value: string): boolean => /^[\\/]{2}/.test(value);

/**
 * win32 only: `C:page.html` (drive-relative) and `\page.html` (rooted, no drive) resolve against
 * the service's own current folder, never the project's, so they are refused.
 */
const isAmbiguousWin32 = (value: string, p: PathModule): boolean => p.sep === '\\' && (/^[A-Za-z]:(?![\\/])/.test(value) || /^[\\/](?![\\/])/.test(value));

/**
 * Where the picked file is (§3.3 step 2). The SDK does not say whether a Files row's `path` is
 * absolute or relative to its `directory` (N10), so both are accepted: an absolute `path` is used
 * as given; a relative one needs an absolute `directory`, is joined to it and must stay strictly
 * inside it. Refused: network and device paths (422), a relative path without a folder or an
 * ambiguous win32 form (422), a relative path that leaves its folder (422), a folder that is not
 * absolute (400 `bad-path`), a name not ending in `.html` / `.htm` (422). This is not a
 * containment check for reads: the entry is read with O_NOFOLLOW and its files through
 * `resolveInside(folder, …)`.
 */
export const resolveFileTarget = (rawPath: string, directory: string | null, p: PathModule, platform: NodeJS.Platform): FileTarget => {
  if (isNetworkPath(rawPath) || (directory !== null && isNetworkPath(directory))) throw new ApiError('invalid', FILE_PAGE_NETWORK);
  if (isAmbiguousWin32(rawPath, p)) throw new ApiError('invalid', FILE_PAGE_WHERE);
  let folder: string | null = null;
  if (directory !== null) {
    if (isAmbiguousWin32(directory, p) || !p.isAbsolute(directory)) throw new ApiError('bad-path', 'The project folder must be an absolute path.');
    folder = p.resolve(directory);
  }
  let target: string;
  if (p.isAbsolute(rawPath)) {
    target = p.resolve(rawPath);
  } else {
    if (folder === null) throw new ApiError('invalid', FILE_PAGE_WHERE);
    target = p.resolve(folder, rawPath);
    if (!isStrictlyInside(folder, target, p, platform)) throw new ApiError('invalid', FILE_PAGE_OUTSIDE);
  }
  const name = p.basename(target);
  if (!/\.html?$/i.test(name)) throw new ApiError('invalid', FILE_PAGE_NOT_HTML);
  return { target, directory: folder, name };
};

// ---- step 7: the local files (the bundler's dry run) ----

/** Why a copy stopped early: over the byte cap, or over the time budget. */
export class CopyStopped extends Error {
  readonly why: 'size' | 'time';
  constructor(why: 'size' | 'time') {
    super(why === 'size' ? 'over the copy byte cap' : 'over the copy time budget');
    this.name = 'CopyStopped';
    this.why = why;
  }
}

/** The bundler follows references only inside these; every other file is only stat'ed by the scan. */
const SCANNED_EXTENSIONS = new Set(['.css', '.html', '.htm']);

const EMPTY = Buffer.alloc(0);

export type AssetPlan = {
  /** Local files to copy, at the same relative path (`/` separators), with their size at scan time. */
  keep: { rel: string; size: number }[];
  left: FromFileResponse['left'];
};

/**
 * Why a local file is never copied, or null to copy it (§3.3 step 7): a type outside the
 * bundler's MIME table, the page's own entry name (`index.html`, any case), and any path the
 * service owns in a design folder (`design.json`, `system/`, a dot folder such as `.chamber`,
 * `.versions`, or a dot file), so a reference can never plant service state in the new design.
 */
export const skipReasonOf = (rel: string): 'type' | 'reserved' | null => {
  if (mimeOf(rel) === 'application/octet-stream') return 'type';
  const parts = rel.split('/');
  const first = (parts[0] ?? '').toLowerCase();
  if (parts.some((part) => part.startsWith('.'))) return 'reserved';
  if (parts.length === 1 && (first === ENTRY_FILE || first === 'design.json')) return 'reserved';
  if (parts.length > 1 && first === COPY_DIR) return 'reserved';
  return null;
};

/**
 * The bundler's reading of the entry, as a dry run: which local files it uses (inputs), which
 * were missing, and which left the folder (blocked). The entry is served from the bytes already
 * read; CSS and HTML are read (contained) so their own references are found; everything else is
 * answered from a contained `stat` with no bytes. Every byte handed to the bundler counts against
 * `FILE_PAGE_COPY_MAX_BYTES`, so a page that pulls one large sheet in many times stops early.
 */
export const planAssets = async (
  folder: string,
  entryName: string,
  entryBytes: Buffer,
  options: { overTime: () => boolean; caseFolds: boolean },
): Promise<AssetPlan> => {
  const live = createLiveFileSource(folder);
  let handed = 0;
  const source: FileSource = {
    root: folder,
    async read(rel): Promise<SourceFile | null> {
      if (options.overTime()) throw new CopyStopped('time');
      if (rel === entryName) return { bytes: entryBytes, size: entryBytes.byteLength, mtimeMs: 0 };
      const info = await live.stat?.(rel); // RefBlocked (escape) propagates to the bundler, which counts it
      if (info === undefined || info === null) return null;
      if (!SCANNED_EXTENSIONS.has(path.posix.extname(rel).toLowerCase())) return { bytes: EMPTY, size: info.size, mtimeMs: info.mtimeMs };
      if (handed + info.size > FILE_PAGE_COPY_MAX_BYTES) throw new CopyStopped('size');
      const file = await live.read(rel);
      if (file === null) return null;
      handed += file.bytes.byteLength;
      if (handed > FILE_PAGE_COPY_MAX_BYTES) throw new CopyStopped('size');
      return file;
    },
  };
  let bundled: Awaited<ReturnType<typeof bundleDocument>>;
  try {
    bundled = await bundleDocument(source, entryName, { mode: 'export' });
  } catch (error) {
    if (error instanceof BundleTooLarge) throw new CopyStopped('size');
    throw error;
  }
  const keep: AssetPlan['keep'] = [];
  const seen = new Set<string>();
  let other = 0;
  let total = 0;
  for (const input of bundled.inputs) {
    if (input.rel === entryName) continue;
    if (skipReasonOf(input.rel) !== null) {
      other += 1;
      continue;
    }
    // On a case-folding disk `A.png` and `a.png` are one file: copy it once.
    const key = options.caseFolds ? input.rel.toLowerCase() : input.rel;
    if (seen.has(key)) continue;
    seen.add(key);
    total += input.size;
    if (total > FILE_PAGE_COPY_MAX_BYTES) throw new CopyStopped('size');
    keep.push({ rel: input.rel, size: input.size });
  }
  return { keep, left: { outside: bundled.blocked.length, missing: bundled.missing.length, other } };
};

/**
 * Copy the planned files from `folder` into the new design at `designDir`, then the entry last as
 * `index.html`, so the page is never shown half-copied (§3.3 step 8). Each source path is
 * contained again (`resolveInside(folder, …)`: the folder may have changed since the scan, a file
 * swapped for a link out is counted outside and never read) and read with `readRegularFile`
 * against what is left of `FILE_PAGE_COPY_MAX_BYTES`; each target goes through
 * `resolveInside(designDir, …)` and `writeFileAtomic`. Throws `CopyStopped` over the byte cap or
 * the time budget; answers `left` with what went missing or out on the way.
 */
export const copyIntoDesign = async (
  designDir: string,
  folder: string,
  plan: AssetPlan,
  entry: Uint8Array,
  overTime: () => boolean,
  /** Called with each design-relative path and its bytes right before the write (the self-write record). */
  beforeWrite: (rel: string, bytes: Uint8Array) => void = () => undefined,
): Promise<FromFileResponse['left']> => {
  const left = { ...plan.left };
  let total = 0;
  for (const asset of plan.keep) {
    if (overTime()) throw new CopyStopped('time');
    const segments = asset.rel.split('/');
    let from: string;
    try {
      from = await resolveInside(folder, segments);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'bad-path') {
        left.outside += 1;
        continue;
      }
      throw error;
    }
    const read = await readRegularFile(from, FILE_PAGE_COPY_MAX_BYTES - total);
    if (read.kind === 'too-large') throw new CopyStopped('size');
    if (read.kind !== 'ok') {
      left.missing += 1; // vanished, swapped for a link, or unreadable since the scan
      continue;
    }
    total += read.bytes.byteLength;
    const target = await resolveInside(designDir, segments);
    beforeWrite(asset.rel, read.bytes);
    await writeFileAtomic(target, read.bytes);
  }
  if (overTime()) throw new CopyStopped('time');
  beforeWrite(ENTRY_FILE, entry);
  await writeFileAtomic(path.join(designDir, ENTRY_FILE), entry);
  return left;
};

// ---- the importer ----

/** How long a cold design index may take before the dedupe goes on without it. */
const DEDUPE_INDEX_WAIT_MS = 1500;

const errorCode = (error: unknown): string => String((error as NodeJS.ErrnoException | null)?.code ?? '');

export type FilePageImporterOptions = {
  settings: Pick<SettingsStore, 'root'>;
  store: Pick<DesignStore, 'create' | 'trash' | 'get' | 'dir'>;
  designIndex: Pick<DesignIndex, 'all' | 'ready'>;
  /** The copy's writes are Design Chamber's own: the watcher drops their echo, so the build strip never shows them as the agent. */
  selfWrites: Pick<SelfWrites, 'record'>;
  log: Logger;
  /** Milliseconds clock for the copy budget; tests move it. */
  clock?: () => number;
  /** `importedFrom.at`; tests pin it. */
  now?: () => Date;
};

export type FilePageImporter = {
  /** `POST /pages/from-file`: validates the body (unknown request input) itself. */
  open(body: unknown): Promise<FromFileResponse>;
};

const NOTHING_LEFT: FromFileResponse['left'] = { outside: 0, missing: 0, other: 0 };

export const createFilePageImporter = (options: FilePageImporterOptions): FilePageImporter => {
  const { settings, store, designIndex, selfWrites, log } = options;
  const clock = options.clock ?? Date.now;
  const now = options.now ?? (() => new Date());
  const folds = foldsCase(path, process.platform);
  /** Files being opened right now, by path (case-folded where the disk folds): a double click gets 409. */
  const inFlight = new Set<string>();
  /** Copies this process made, newest first: found even before the design index has caught up. */
  const recent: string[] = [];

  const reused = (record: DesignRecord): FromFileResponse => ({ slug: record.slug, title: record.design.title, reused: true, left: { ...NOTHING_LEFT } });

  /** §3.3 step 3: a file inside the designs root is never copied. */
  const insideRoot = async (target: string): Promise<FromFileResponse | null> => {
    const root = settings.root();
    const realRoot = await realpath(root).catch(() => null);
    const realTarget = await realpath(target).catch(() => null);
    const pairs: [string, string][] = [[root, target]];
    if (realRoot !== null && realTarget !== null) pairs.unshift([realRoot, realTarget]);
    const pair = pairs.find(([base, file]) => isStrictlyInside(base, file, path, process.platform));
    if (pair === undefined) return null;
    // Folded where the disk folds, as isStrictlyInside compared them; slugs are lower case anyway.
    const [base, file] = folds ? [pair[0].toLowerCase(), pair[1].toLowerCase()] : pair;
    const parts = path.relative(base, file).split(path.sep);
    const first = parts[0] ?? '';
    if (parts.length === 1) throw new ApiError('invalid', FILE_PAGE_IN_ROOT);
    try {
      await store.dir(first); // slug rule + containment + "is a design folder"
      return reused(await store.get(first));
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'not-found' || error.code === 'bad-slug')) throw new ApiError('invalid', FILE_PAGE_IN_ROOT_OTHER);
      throw error;
    }
  };

  /** §3.3 step 6: a page already copied from this path with these bytes, newest first. */
  const findCopy = async (target: string, sha256: string): Promise<DesignRecord | null> => {
    let indexed: string[] = [];
    try {
      if (await designIndex.ready(DEDUPE_INDEX_WAIT_MS)) {
        indexed = designIndex
          .all()
          .filter((summary) => summary.kind === 'page')
          .slice(0, FILE_PAGE_DEDUPE_SCAN_MAX)
          .map((summary) => summary.slug);
      }
    } catch (error) {
      log.warn('file-page.index-unavailable', { error: error instanceof Error ? error.message : String(error) });
    }
    for (const slug of [...new Set([...recent, ...indexed])].slice(0, FILE_PAGE_DEDUPE_SCAN_MAX * 2)) {
      const record = await store.get(slug).catch(() => null); // gone or unreadable since: not a match
      const from = record?.state.importedFrom;
      if (record === null || from === undefined || record.design.kind !== 'page') continue;
      if (from.sha256 === sha256 && samePath(from.path, target, path, process.platform)) return record;
    }
    return null;
  };

  const readEntry = async (target: string): Promise<Buffer> => {
    const read = await readRegularFile(target, LOOSE_IMPORT_MAX_BYTES);
    switch (read.kind) {
      case 'ok':
        return read.bytes;
      case 'link':
        throw new ApiError('invalid', FILE_PAGE_LINK);
      case 'missing':
        throw new ApiError('not-found', FILE_PAGE_MISSING);
      case 'not-file':
        throw new ApiError('invalid', FILE_PAGE_NOT_FILE);
      case 'too-large':
        throw new ApiError('too-large', FILE_PAGE_ENTRY_TOO_LARGE);
      case 'denied':
        throw new ApiError('internal', FILE_PAGE_DENIED);
    }
  };

  const stoppedError = (error: CopyStopped): ApiError => new ApiError('too-large', error.why === 'size' ? FILE_PAGE_COPY_TOO_LARGE : FILE_PAGE_TOO_SLOW);

  /**
   * A step that reads the project: its own refusals pass through, anything else (EIO mid-scan, a
   * bug) becomes the plain copy sentence and is logged by code only. Left to `http.ts`, the stack
   * would reach the log, and a filesystem message names the project's path.
   */
  const guarded = async <T>(step: 'read' | 'scan', run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof CopyStopped) throw stoppedError(error);
      log.warn('file-page.read-failed', { step, code: errorCode(error) || 'unknown' });
      throw new ApiError('internal', FILE_PAGE_COPY_FAILED);
    }
  };

  const openLocked = async (file: FileTarget): Promise<FromFileResponse> => {
    const deadline = clock() + FILE_PAGE_COPY_BUDGET_MS;
    const overTime = (): boolean => clock() > deadline;

    const inside = await insideRoot(file.target);
    if (inside !== null) return inside;

    const entry = await guarded('read', () => readEntry(file.target));
    const sha256 = createHash('sha256').update(entry).digest('hex');
    const existing = await findCopy(file.target, sha256);
    if (existing !== null) return reused(existing);

    const folder = path.dirname(file.target);
    const plan = await guarded('scan', () => planAssets(folder, file.name, entry, { overTime, caseFolds: folds }));

    const record = await store.create({
      kind: 'page',
      title: looseTitleOf(file.name, entry),
      brief: '',
      preset: null,
      projectDirectory: file.directory,
      // BRIEF 2026-11-10: a design links only to the chat its chip came from.
      sessionId: null,
      importedFrom: { path: file.target, sha256, at: now().toISOString() },
    });
    let left: FromFileResponse['left'];
    try {
      // record.path is the store's contained folder (resolveInside at create time).
      left = await copyIntoDesign(record.path, folder, plan, entry, overTime, (rel, bytes) => recordOwnWrite(selfWrites, record.slug, rel, bytes));
    } catch (error) {
      // The code only: a filesystem message carries a path, and the project's paths stay out of the log.
      log.warn('file-page.copy-failed', { slug: record.slug, code: error instanceof CopyStopped ? error.why : errorCode(error) || 'unknown' });
      // The half-made page goes to .trash like any deleted design; the project was only read.
      await store.trash(record.slug).catch((trashError: unknown) => log.warn('file-page.cleanup-failed', { slug: record.slug, code: errorCode(trashError) || 'unknown' }));
      if (error instanceof CopyStopped) throw stoppedError(error);
      const code = errorCode(error);
      if (code === 'ENOSPC') throw new ApiError('internal', FILE_PAGE_DISK_FULL);
      if (code === 'EACCES' || code === 'EPERM') throw new ApiError('internal', FILE_PAGE_WRITE_DENIED);
      throw new ApiError('internal', FILE_PAGE_COPY_FAILED);
    }
    recent.unshift(record.slug);
    recent.splice(FILE_PAGE_DEDUPE_SCAN_MAX);
    log.info('file-page.copied', { slug: record.slug, files: plan.keep.length, outside: left.outside, missing: left.missing, other: left.other });
    return { slug: record.slug, title: record.design.title, reused: false, left };
  };

  return {
    async open(body) {
      const input = parseFromFileBody(body);
      const file = resolveFileTarget(input.path, input.directory, path, process.platform);
      // Taken synchronously, before the first await, so two calls in the same tick cannot both pass.
      const key = folds ? file.target.toLowerCase() : file.target;
      if (inFlight.has(key)) throw new ApiError('conflict', FILE_PAGE_BUSY);
      inFlight.add(key);
      try {
        return await openLocked(file);
      } finally {
        inFlight.delete(key);
      }
    },
  };
};
