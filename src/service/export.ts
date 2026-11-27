// Export delivery (docs/SPEC.md §4.3, §9.5): guests cannot download (F1, F10), so the service
// writes the file itself — to `settings.downloadsDir ?? <Downloads>` (the XDG Download folder
// on Linux, user-dirs.ts), falling back to `<root>/.exports/` when that folder is missing — and
// answers the path for the toast's "Show in folder" (reveal only accepts paths issued here).
//
//   ZIP:  `<slug>/` tree of every tracked file except design.json (internal); under `system/` (a
//         design system's copy, Phase 2.5 §2.6) only what the pages use, never the agent's reference
//   HTML: bundleDocument output WITHOUT the bridge — page index.html, or the chosen screen
//
//   Tokens: `<system id>-tokens.zip` of a design system's token files, written by Design Chamber
//         (system-builder-depth T19); same destination, naming and reveal rules
//
// Names get ` (2)`, ` (3)`… on collision (also between exports running at the same time);
// writes are atomic (tmp + rename in the same folder). The ZIP is written file by file as it goes.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ExportBody, ExportResponse } from '../shared/api.ts';
import { DESIGN_JSON_FILE, screenFileOf } from '../shared/design-json.ts';
import { SYSTEM_ID_PATTERN } from '../shared/limits.ts';
import { ApiError } from './http.ts';
import type { DesignRecord, DesignStore, Logger, SettingsStore } from './context.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, createLiveFileSource } from './bundle.ts';
import { resolveEntryFile } from './render-cache.ts';
import { atomicTempPath, foldsCase, renameWithRetry } from './paths.ts';
import { folderErrorSentence } from './root.ts';
import { userDir } from './user-dirs.ts';
import { listTracked } from './versions.ts';
import { ZIP_ENTRY_MAX_BYTES, ZipError, entryTooLargeSentence, writeZipFile, type ZipSource } from './zip.ts';

const NAME_COLLISION_TRIES = 1000;

export type ExportDeps = {
  store: DesignStore;
  settings: SettingsStore;
  log: Logger;
  /** Record a path so /reveal will accept it. */
  issue: (absolutePath: string) => void;
  /** Injectable for tests: overrides `settings.downloadsDir ?? ~/Downloads`. */
  downloadsDir?: () => string;
  /** Test seam: per-file ZIP cap, default `ZIP_ENTRY_MAX_BYTES` (512 MiB). */
  zipMaxEntryBytes?: number;
};

/** One file of a token export; `name` is a plain file name at the top of the ZIP. */
export type SystemExportFile = { name: string; text: string };

export type ExportService = {
  export(slug: string, body: ExportBody): Promise<ExportResponse>;
  /** Write `<system id>-tokens.zip` holding `files` (T19) and issue its path for /reveal. */
  systemTokens(id: string, files: readonly SystemExportFile[]): Promise<{ path: string; bytes: number }>;
};

const defaultDownloads = (): string => userDir('DOWNLOAD');

/** The folder exports go to: the configured (or default) Downloads when usable, else `<root>/.exports`. */
const destinationDir = async (deps: ExportDeps): Promise<string> => {
  const preferred = deps.downloadsDir ? deps.downloadsDir() : (deps.settings.read().downloadsDir ?? defaultDownloads());
  const fallback = path.join(deps.settings.root(), '.exports');
  for (const candidate of [preferred, fallback]) {
    try {
      await mkdir(candidate, { recursive: true });
      if (existsSync(candidate)) return candidate;
    } catch {
      // try the fallback
    }
  }
  throw new ApiError('internal', 'Design Chamber could not find a folder to save the export in.');
};

/** Case-insensitive disks (Windows, macOS) must treat `A.zip` and `a.zip` as one name. */
const reservationKey = (target: string): string => (foldsCase() ? target.toLowerCase() : target);

/** First free name in `dir`: not on disk and not reserved by an export that is still writing. */
const uniqueTarget = (dir: string, baseName: string, reserved: ReadonlySet<string>): string => {
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  const taken = (candidate: string): boolean => existsSync(candidate) || reserved.has(reservationKey(candidate));
  let candidate = path.join(dir, baseName);
  for (let n = 2; taken(candidate) && n <= NAME_COLLISION_TRIES; n += 1) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
  }
  if (taken(candidate)) throw new ApiError('conflict', 'Too many files with this name already exist in the export folder.');
  return candidate;
};

/** Files of a design-system copy a page can use (Phase 2.5 §2.6): its stylesheets, fonts, logos and icons. */
const COPY_ASSET_PATTERN = /^system\/(?:system\.css|fonts\.css|tokens\.css|fonts\/[^/]+|logos\/[^/]+|icons\/[^/]+)$/;

/**
 * Whether a tracked file goes into the ZIP (Phase 2.5 §2.6). Everything outside `system/` does, as
 * before. Under `system/` only what the bundled pages reference (`referenced`, design-relative), and
 * never the agent's reference (OVERVIEW.md, notes, patterns, brand, components, system.json) or
 * COPY.json. `referenced` null means the pages could not be bundled to tell: then the stylesheets,
 * fonts and logos go in, and still none of the reference.
 */
export const exportIncludes = (rel: string, referenced: ReadonlySet<string> | null): boolean => {
  if (rel !== 'system' && !rel.startsWith('system/')) return true;
  if (!COPY_ASSET_PATTERN.test(rel)) return false;
  return referenced === null || referenced.has(rel);
};

/** Every design-relative file the design's pages read when bundled for export; null when one can't be bundled. */
const referencedFiles = async (record: DesignRecord): Promise<Set<string> | null> => {
  const entries = record.design.kind === 'page' ? ['index.html'] : record.design.screens.filter((screen) => record.files.screens[screen.id]?.exists).map((screen) => screenFileOf(screen.id));
  const source = createLiveFileSource(record.path);
  const referenced = new Set<string>();
  for (const entry of entries) {
    try {
      const result = await bundleDocument(source, entry, { mode: 'export' });
      for (const input of result.inputs) referenced.add(input.rel);
    } catch (error) {
      if (error instanceof BundleMissingEntry) continue; // a screen not written yet references nothing
      return null;
    }
  }
  return referenced;
};

/** What the tracked-minus-design.json set holds, or `no-html` when there is nothing to put in a ZIP. */
const zipRels = async (record: DesignRecord): Promise<string[]> => {
  let rels = (await listTracked(record.path)).filter((rel) => rel !== DESIGN_JSON_FILE);
  if (rels.some((rel) => rel.startsWith('system/'))) {
    const referenced = await referencedFiles(record);
    rels = rels.filter((rel) => exportIncludes(rel, referenced));
  }
  if (rels.length === 0) throw new ApiError('no-html', 'This design has no files to export yet.');
  return rels;
};

/** Write the design's files into the archive at `tmpPath`, one file in memory at a time. */
const writeZipExport = async (slug: string, record: DesignRecord, rels: readonly string[], tmpPath: string, maxEntryBytes: number): Promise<number> => {
  const sources: ZipSource[] = rels.map((rel) => ({
    name: `${slug}/${rel}`,
    label: rel,
    read: async () => {
      const file = path.join(record.path, ...rel.split('/'));
      const info = await stat(file).catch(() => null);
      if (info === null) return null; // vanished mid-export: the ZIP simply lacks it
      // Refuse before reading: a huge file would otherwise be pulled into memory first.
      if (info.size > maxEntryBytes) throw new ZipError(entryTooLargeSentence(rel, maxEntryBytes));
      return readFile(file).catch(() => null);
    },
  }));
  const result = await writeZipFile(tmpPath, sources, { maxEntryBytes });
  if (result.entries === 0) throw new ApiError('no-html', 'This design has no files to export yet.');
  return result.bytes;
};

const buildHtml = async (record: DesignRecord, entryRel: string): Promise<Buffer> => {
  const source = createLiveFileSource(record.path);
  try {
    const result = await bundleDocument(source, entryRel, { mode: 'export' });
    return Buffer.from(result.html, 'utf8');
  } catch (error) {
    if (error instanceof BundleMissingEntry) throw new ApiError('no-html', `The document for this view (${entryRel}) has not been written yet.`);
    if (error instanceof BundleTooLarge) throw new ApiError('too-large', 'This design is too large to export as a single file. Export the ZIP instead.');
    throw error;
  }
};

export const createExportService = (deps: ExportDeps): ExportService => {
  /** Targets of exports still writing, so two at once never pick the same name. */
  const reserved = new Set<string>();

  /** Reserve a free name in `dir`, let `write` fill a tmp file, rename it into place; always release the name. */
  const deliver = async (dir: string, baseName: string, write: (tmpPath: string) => Promise<number>): Promise<{ target: string; bytes: number }> => {
    const target = uniqueTarget(dir, baseName, reserved);
    const key = reservationKey(target);
    reserved.add(key);
    const tmp = atomicTempPath(target);
    try {
      const bytes = await write(tmp);
      await renameWithRetry(tmp, target);
      return { target, bytes };
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      if (error instanceof ZipError) throw new ApiError('too-large', error.message);
      // macOS can refuse ~/Downloads to OpenChamber (privacy) even though the folder exists.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') throw new ApiError('bad-path', folderErrorSentence(error, dir));
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      reserved.delete(key);
    }
  };

  return {
    async systemTokens(id, files) {
      // The id names the file, so it is checked here as well as by the system store.
      if (!SYSTEM_ID_PATTERN.test(id)) throw new ApiError('bad-slug', 'That is not a design system id.');
      const sources: ZipSource[] = files.map((file) => ({ name: file.name, read: async () => Buffer.from(file.text, 'utf8') }));
      const dir = await destinationDir(deps);
      const written = await deliver(dir, `${id}-tokens.zip`, async (tmp) => (await writeZipFile(tmp, sources)).bytes);
      deps.issue(written.target);
      deps.log.info('export.tokens-written', { id, files: files.length, bytes: written.bytes });
      return { path: written.target, bytes: written.bytes };
    },

    async export(slug: string, body: ExportBody): Promise<ExportResponse> {
      if (body.format !== 'zip' && body.format !== 'html') {
        throw new ApiError('bad-request', 'The export format must be "zip" or "html".');
      }
      const screen = typeof body.screen === 'string' && body.screen !== '' ? body.screen : undefined;
      const record = await deps.store.get(slug);

      let written: { target: string; bytes: number };
      if (body.format === 'zip') {
        const rels = await zipRels(record);
        const dir = await destinationDir(deps);
        written = await deliver(dir, `${slug}.zip`, (tmp) => writeZipExport(slug, record, rels, tmp, deps.zipMaxEntryBytes ?? ZIP_ENTRY_MAX_BYTES));
      } else {
        const { entryRel, screenId } = resolveEntryFile(record.design, record.files, screen);
        const html = await buildHtml(record, entryRel);
        const dir = await destinationDir(deps);
        const baseName = screenId === null ? `${slug}.html` : `${slug}-${screenId}.html`;
        written = await deliver(dir, baseName, async (tmp) => {
          await writeFile(tmp, html);
          return html.length;
        });
      }
      deps.issue(written.target);
      deps.log.info('export.written', { slug, format: body.format, bytes: written.bytes });
      return { path: written.target, bytes: written.bytes, format: body.format };
    },
  };
};
