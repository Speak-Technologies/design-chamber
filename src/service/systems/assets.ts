// Brand files of a design system (documentation/specs/phase-2-5-technical.md §5.6, AD-8): fonts, logos and
// source documents, added from a base64 upload (`POST /systems/:id/assets`) or read from a folder the
// user names (`POST /systems/:id/assets/from-folder`).
//
// Every file is checked twice, by its extension and by its content (`checkAsset`: magic bytes, or valid
// UTF-8 without NUL for text and SVG), and by size (per type, then ≤ 200 files and ≤ 100 MB across the
// system's `assets/` and `sources/`). Its name is made safe (`safeAssetName`: base name only, Windows
// device names, clashes ignoring case). It is written to a dot temp inside the target folder and
// published with `moveNoReplace`, so nothing already there is ever replaced, then recorded in
// system.json through one compare-and-swap write (retried 3 times) and in state.json's brand source.
// The whole addition runs under the system's lock.
//
// From a folder: the folder is validated like a scan folder (§7.1: absolute, outside the Designs
// folder, compared as realpaths), listed without recursion, links and dot files skipped, ≤ 200 files
// looked at. A file of a type no system uses is refused by its name and never opened; one over its
// size cap is refused by its size and never read. Files are read one at a time, so memory stays at one file.

import { createHash } from 'node:crypto';
import { constants as fsConstants, type Dirent } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type { AddSystemAssetResponse, AssetsFromFolderResponse } from '../../shared/api.ts';
import {
  SYSTEM_BYTES_MAX,
  SYSTEM_DOCUMENT_MAX_BYTES,
  SYSTEM_FILES_MAX,
  SYSTEM_FONT_MAX_BYTES,
  SYSTEM_IMAGE_MAX_BYTES,
} from '../../shared/limits.ts';
import { parseSystemJson, safeAssetName } from '../../shared/system-json.ts';
import type { JsonObject, JsonValue } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { atomicTempPath, isAtomicTempName, moveNoReplace, replaceFileIfHashUnchanged, resolveInside, resolvePlainTarget, samePath } from '../paths.ts';
import { systemSelfWritesKey } from '../watch.ts';
import { validateScanFolder } from './scan-folder.ts';
import { ensureSystemStore, refuseReadOnly } from './store.ts';

export type AssetKind = 'font' | 'logo' | 'source';
type AssetGroup = 'font' | 'image' | 'document';

export const FOLDER_OF_KIND: Readonly<Record<AssetKind, readonly string[]>> = {
  font: ['assets', 'fonts'],
  logo: ['assets', 'logos'],
  source: ['sources'],
};

const KIND_OF_GROUP: Readonly<Record<AssetGroup, AssetKind>> = { font: 'font', image: 'logo', document: 'source' };

const MAX_BYTES_OF_GROUP: Readonly<Record<AssetGroup, number>> = {
  font: SYSTEM_FONT_MAX_BYTES,
  image: SYSTEM_IMAGE_MAX_BYTES,
  document: SYSTEM_DOCUMENT_MAX_BYTES,
};

const TOO_LARGE_OF_GROUP: Readonly<Record<AssetGroup, string>> = {
  font: 'Fonts can be up to 5 MB.',
  image: 'Pictures can be up to 10 MB.',
  document: 'Documents can be up to 20 MB.',
};

// ---- content checks ----

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, index) => bytes[at + index] === byte);

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** UTF-8 text without NUL, or null (a fatal decoder: one invalid byte refuses the file). */
const utf8Text = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/**
 * An SVG: UTF-8 without NUL whose first element is `<svg`, after an optional BOM, an XML declaration,
 * comments and a doctype (and the white space between them).
 */
export const isSvgText = (bytes: Uint8Array): boolean => {
  const text = utf8Text(bytes);
  if (text === null) return false;
  let rest = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('<?xml')) {
      const end = rest.indexOf('?>');
      if (end < 0) return false;
      rest = rest.slice(end + 2);
    } else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end < 0) return false;
      rest = rest.slice(end + 3);
    } else if (/^<!doctype/i.test(rest)) {
      const end = rest.indexOf('>');
      if (end < 0) return false;
      rest = rest.slice(end + 1);
    } else {
      return /^<svg[\s>/]/.test(rest);
    }
  }
};

type AssetType = { group: AssetGroup; label: string; matches: (bytes: Uint8Array) => boolean };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const jpeg: AssetType = { group: 'image', label: 'JPEG', matches: (bytes) => startsWith(bytes, JPEG) };
const text = (label: string): AssetType => ({ group: 'document', label, matches: (bytes) => utf8Text(bytes) !== null });

/** The types a design system takes, by lower-cased extension (§5.6; RS S2's accepted list). */
const TYPES: Readonly<Record<string, AssetType>> = {
  woff2: { group: 'font', label: 'WOFF2', matches: (bytes) => startsWith(bytes, ascii('wOF2')) },
  woff: { group: 'font', label: 'WOFF', matches: (bytes) => startsWith(bytes, ascii('wOFF')) },
  ttf: { group: 'font', label: 'TrueType', matches: (bytes) => startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || startsWith(bytes, ascii('true')) },
  otf: { group: 'font', label: 'OpenType', matches: (bytes) => startsWith(bytes, ascii('OTTO')) },
  png: { group: 'image', label: 'PNG', matches: (bytes) => startsWith(bytes, PNG) },
  jpg: jpeg,
  jpeg,
  webp: { group: 'image', label: 'WebP', matches: (bytes) => startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8) },
  svg: { group: 'image', label: 'SVG', matches: isSvgText },
  pdf: { group: 'document', label: 'PDF', matches: (bytes) => startsWith(bytes, ascii('%PDF-')) },
  md: text('Markdown'),
  txt: text('text'),
};

const extensionOf = (name: string): string => {
  const base = name.split(/[\\/]/).at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

/** A file name as shown in a sentence: the base name, control characters dropped, ≤ 80 characters. */
export const displayName = (name: string): string => {
  const base = (name.split(/[\\/]/).at(-1) ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const shown = base === '' ? 'This file' : base;
  return shown.length > 80 ? `${shown.slice(0, 79)}…` : shown;
};

const notAType = (name: string): string => `${displayName(name)} isn't a file type design systems use.`;

export type AssetCheck = { ok: true; group: AssetGroup; kind: AssetKind } | { ok: false; reason: string };

/** The type and size checks that need no bytes (a folder file is refused by these before it is opened). */
export const checkAssetMeta = (name: string, kind: AssetKind | null, size: number): AssetCheck => {
  const type = TYPES[extensionOf(name)];
  if (type === undefined) return { ok: false, reason: notAType(name) };
  const resolvedKind = kind ?? KIND_OF_GROUP[type.group];
  // A source may be any type a system takes (a brand guide, a picture of the brand); fonts and logos must be their own kind.
  if (resolvedKind === 'font' && type.group !== 'font') return { ok: false, reason: `${displayName(name)} isn't a font file.` };
  if (resolvedKind === 'logo' && type.group !== 'image') return { ok: false, reason: `${displayName(name)} isn't a logo picture. Use SVG, PNG, JPEG or WebP.` };
  if (size > MAX_BYTES_OF_GROUP[type.group]) return { ok: false, reason: `${displayName(name)} is too large. ${TOO_LARGE_OF_GROUP[type.group]}` };
  return { ok: true, group: type.group, kind: resolvedKind };
};

/**
 * Pure (§5.6): is `bytes` a file of the type its name says, of a kind that fits, within its size cap?
 * The extension picks the type; the content must match it (magic bytes, or UTF-8 for text and SVG).
 */
export const checkAsset = (name: string, kind: AssetKind | null, bytes: Uint8Array): AssetCheck => {
  const meta = checkAssetMeta(name, kind, bytes.length);
  if (!meta.ok) return meta;
  const type = TYPES[extensionOf(name)];
  // Safe: checkAssetMeta answered ok only for a known extension.
  if (type === undefined || !type.matches(bytes)) {
    return { ok: false, reason: meta.group === 'font' ? "This font file can't be used." : `${displayName(name)} isn't a real ${type?.label ?? ''} file.` };
  }
  return meta;
};

// ---- names into system.json ----

const WEIGHT_WORDS: readonly [RegExp, number][] = [
  [/extra-?light|ultra-?light/, 200],
  [/semi-?bold|demi-?bold/, 600],
  [/extra-?bold|ultra-?bold/, 800],
  [/hairline|thin/, 100],
  [/light/, 300],
  [/medium/, 500],
  [/bold/, 700],
  [/black|heavy/, 900],
  [/regular|normal|book|roman/, 400],
];

const FACE_WORD = /extra-?light|ultra-?light|semi-?bold|demi-?bold|extra-?bold|ultra-?bold|hairline|thin|light|regular|normal|book|roman|medium|bold|black|heavy|italic|oblique|variable|[1-9]00/g;

const FONT_FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

/**
 * Pure (§5.6): `Inter-SemiBoldItalic.woff2` → `{ family: "Inter", weight: 600, style: "italic" }`. The
 * family is the stem before the first weight or style word at a word boundary (a separator, or a
 * lower-to-upper case change), the weight from `thin…black` or a number, the style from `italic`.
 */
export const guessFontFace = (file: string): { family: string; weight: number; style: 'normal' | 'italic' } => {
  const base = file.split('/').at(-1) ?? file;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const lower = stem.toLowerCase();
  let cut = stem.length;
  for (const match of lower.matchAll(FACE_WORD)) {
    const at = match.index;
    if (at === 0) continue;
    const before = stem.charAt(at - 1);
    const boundary = /[-_ .]/.test(before) || (/[a-z0-9]/.test(before) && /[A-Z0-9]/.test(stem.charAt(at)));
    if (boundary) {
      cut = at;
      break;
    }
  }
  const family = stem
    .slice(0, cut)
    .replace(/[^A-Za-z0-9 _-]/g, ' ')
    .replace(/[-_ ]+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  const rest = lower.slice(cut);
  const number = /(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/.exec(rest);
  const word = WEIGHT_WORDS.find(([pattern]) => pattern.test(rest));
  const weight = word !== undefined ? word[1] : number?.[1] !== undefined ? Number(number[1]) : 400;
  return { family: FONT_FAMILY_PATTERN.test(family) ? family : 'Brand font', weight, style: /italic|oblique/.test(rest) ? 'italic' : 'normal' };
};

/** Pure (§5.6): the first of `mark icon dark light white mono` among the name's words, else `primary`. */
export const guessLogoVariant = (file: string): string => {
  const base = file.split('/').at(-1) ?? file;
  const dot = base.lastIndexOf('.');
  const words = (dot > 0 ? base.slice(0, dot) : base).toLowerCase().split(/[^a-z0-9]+/);
  return words.find((word) => ['mark', 'icon', 'dark', 'light', 'white', 'mono'].includes(word)) ?? 'primary';
};

/** The system.json list and entry for one added file (§2.3 shapes). */
const entryOf = (rel: string, kind: AssetKind): { key: 'fonts' | 'logos' | 'sources'; entry: JsonObject } => {
  if (kind === 'font') return { key: 'fonts', entry: { file: rel, ...guessFontFace(rel) } };
  if (kind === 'logo') return { key: 'logos', entry: { file: rel, variant: guessLogoVariant(rel) } };
  return { key: 'sources', entry: { file: rel } };
};

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Pure: system.json text (null when absent) with the entries appended to their lists, every other key
 * kept; null when the file can't take them (not JSON, or a list key that is not a list). An entry whose
 * file is already listed is not added again.
 */
export const withAssetEntries = (current: string | null, added: readonly { rel: string; kind: AssetKind }[]): string | null => {
  let raw: JsonObject;
  if (current === null) raw = { version: 1 };
  else {
    const parsed = parseSystemJson(current);
    if (parsed.raw === null) return null;
    raw = parsed.raw;
  }
  for (const { rel, kind } of added) {
    const { key, entry } = entryOf(rel, kind);
    const list = Object.hasOwn(raw, key) ? raw[key] : [];
    if (!Array.isArray(list)) return null;
    if (list.some((item: JsonValue) => isObject(item) && item.file === rel)) continue;
    raw[key] = [...list, entry];
  }
  return `${JSON.stringify(raw, null, 2)}\n`;
};

// ---- the store side ----

/** Attempts of the system.json compare-and-swap before the file is left for the agent to record (§5.6). */
const SYSTEM_JSON_CAS_ATTEMPTS = 3;
/** Entries the measure of `assets/` and `sources/` looks at (the policy cap is 200 files). */
const MEASURE_ENTRIES_MAX = 2000;
const MEASURE_DEPTH_MAX = 4;
/** Files of a folder the from-folder flow looks at (§5.6). */
const FOLDER_FILES_MAX = 200;
/** Name attempts when a file appears at the chosen name between the listing and the move. */
const NAME_ATTEMPTS = 3;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const notRecorded = (files: readonly string[]): string =>
  files.length === 1
    ? `Couldn't record ${files[0] ?? ''} in system.json. Ask the agent to add it.`
    : `Added ${files.length} files, but couldn't record them in system.json. Ask the agent to add them.`;

/** Files and bytes under the system's `assets/` and `sources/` (links not followed, dot and temp names skipped). */
const measure = async (systemDir: string): Promise<{ files: number; bytes: number }> => {
  let files = 0;
  let bytes = 0;
  let budget = MEASURE_ENTRIES_MAX;
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (budget <= 0) return;
      budget -= 1;
      if (entry.name.startsWith('.') || isAtomicTempName(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MEASURE_DEPTH_MAX) await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        const info = await lstat(abs).catch(() => null);
        if (info === null) continue;
        files += 1;
        bytes += info.size;
      }
    }
  };
  for (const top of ['assets', 'sources']) {
    const abs = path.join(systemDir, top);
    const info = await lstat(abs).catch(() => null);
    if (info !== null && info.isDirectory() && !info.isSymbolicLink()) await walk(abs, 1);
  }
  return { files, bytes };
};

/** `assets/fonts` and friends, made one level at a time; each level must be a real folder (never a link). Also the Code scan's seed (§7.2). */
export const ensureFolder = async (systemDir: string, segments: readonly string[]): Promise<string> => {
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const part = segments.slice(0, depth);
    const abs = await resolveInside(systemDir, part);
    const lexical = path.join(systemDir, ...part);
    try {
      await mkdir(lexical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(lexical);
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(abs, lexical)) {
      throw new ApiError('invalid', `${part.join('/')} in this design system isn't a plain folder, so Design Chamber won't write there. Ask the agent to fix it.`);
    }
  }
  return path.join(systemDir, ...segments);
};

type AddEnv = { ctx: ServiceContext; id: string; systemDir: string; totals: { files: number; bytes: number } };

/** One checked file into its folder under a safe, unused name. Answers the system-relative path, or the refusal sentence. */
const writeOne = async (env: AddEnv, name: string, kind: AssetKind | null, bytes: Buffer): Promise<{ rel: string; kind: AssetKind } | { reason: string }> => {
  const check = checkAsset(name, kind, bytes);
  if (!check.ok) return { reason: check.reason };
  if (env.totals.files >= SYSTEM_FILES_MAX) return { reason: `This design system already holds ${SYSTEM_FILES_MAX} files.` };
  if (env.totals.bytes >= SYSTEM_BYTES_MAX) return { reason: 'This design system already holds 100 MB of files.' };
  if (env.totals.bytes + bytes.length > SYSTEM_BYTES_MAX) return { reason: `${displayName(name)} would take this design system over 100 MB of files.` };

  const segments = FOLDER_OF_KIND[check.kind];
  const folder = await ensureFolder(env.systemDir, segments);
  const taken = (await readdir(folder)).filter((entry) => !isAtomicTempName(entry));
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    let finalName: string;
    try {
      finalName = safeAssetName(name, taken);
    } catch {
      return { reason: `There are already 99 files called ${displayName(name)} in this design system.` };
    }
    const target = await resolvePlainTarget(env.systemDir, [...segments, finalName], { allowAbsent: true });
    const rel = [...segments, finalName].join('/');
    const tmp = atomicTempPath(target);
    try {
      await writeFile(tmp, bytes, { flag: 'wx' });
      // Before the move, so the watcher can tell this write from the agent's.
      env.ctx.selfWrites.record(systemSelfWritesKey(env.id), rel, sha256(bytes), bytes.length);
      const outcome = await moveNoReplace(tmp, target);
      if (outcome === 'moved') {
        env.totals.files += 1;
        env.totals.bytes += bytes.length;
        return { rel, kind: check.kind };
      }
      env.ctx.selfWrites.forget(systemSelfWritesKey(env.id), rel);
      if (outcome === 'busy') throw new ApiError('conflict', `Another program is using ${segments.join('/')} in this design system. Close it and try again.`);
      taken.push(finalName); // `exists`: someone wrote that name meanwhile; nothing of theirs was touched
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }
  throw new ApiError('conflict', `Files keep appearing in ${segments.join('/')} while Design Chamber writes. Try again.`);
};

/** Record the added files in system.json by compare-and-swap; false when it can't (the files stay either way). */
const recordInSystemJson = async (env: AddEnv, added: readonly { rel: string; kind: AssetKind }[]): Promise<boolean> => {
  let file: string;
  try {
    file = await resolvePlainTarget(env.systemDir, ['system.json'], { allowAbsent: true });
  } catch (error) {
    if (error instanceof ApiError) return false; // a link or a folder: never written through
    throw error;
  }
  for (let attempt = 0; attempt < SYSTEM_JSON_CAS_ATTEMPTS; attempt += 1) {
    let current: Buffer | null;
    try {
      const handle = await open(file, 'r');
      try {
        current = await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      current = null;
    }
    const next = withAssetEntries(current === null ? null : current.toString('utf8'), added);
    if (next === null) return false; // broken or wrong-shaped: the agent's file is never overwritten
    const bytes = Buffer.from(next, 'utf8');
    env.ctx.selfWrites.record(systemSelfWritesKey(env.id), 'system.json', sha256(bytes), bytes.length);
    const outcome = await replaceFileIfHashUnchanged(file, current === null ? null : sha256(current), bytes);
    if (outcome === 'replaced') return true;
  }
  env.ctx.selfWrites.forget(systemSelfWritesKey(env.id), 'system.json');
  return false;
};

/**
 * Under the system's lock: the files one at a time, then one system.json write and one state.json write
 * for all of them. Answers what was added and refused and whether system.json took the entries.
 */
const addUnderLock = async (
  ctx: ServiceContext,
  id: string,
  files: AsyncIterable<{ name: string; kind: AssetKind | null; bytes: Buffer } | { name: string; reason: string }>,
): Promise<{ added: { rel: string; kind: AssetKind; bytes: number }[]; refused: { name: string; reason: string }[]; recorded: boolean }> => {
  const store = ensureSystemStore(ctx);
  const result = await store.withLock(id, async () => {
    const systemDir = await store.dir(id);
    const state = await store.readState(id);
    // A repo-backed system refuses brand files with 422 `read-only` (S8, AD-20): again under the lock,
    // so a home adopted while the request waited is honoured before anything is written.
    refuseReadOnly(state);
    const env: AddEnv = { ctx, id, systemDir, totals: await measure(systemDir) };
    const added: { rel: string; kind: AssetKind; bytes: number }[] = [];
    const refused: { name: string; reason: string }[] = [];
    for await (const file of files) {
      if ('reason' in file) {
        refused.push({ name: displayName(file.name), reason: file.reason });
        continue;
      }
      const outcome = await writeOne(env, file.name, file.kind, file.bytes);
      if ('reason' in outcome) refused.push({ name: displayName(file.name), reason: outcome.reason });
      else added.push({ ...outcome, bytes: file.bytes.length });
    }
    if (added.length === 0) return { added, refused, recorded: true };
    const recorded = await recordInSystemJson(env, added);
    await store.updateStateLocked(id, (current) => {
      const brand = current.sources.brand?.files ?? [];
      const merged = [...brand, ...added.map((one) => one.rel).filter((rel) => !brand.includes(rel))].slice(0, 1000);
      return { ...current, sources: { ...current.sources, brand: { files: merged } } };
    });
    return { added, refused, recorded };
  });
  if (result.added.length > 0) {
    const changed = [...result.added.map((one) => one.rel), ...(result.recorded ? ['system.json'] : [])].sort();
    ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files', files: changed, origin: 'user' });
    // A user's addition is a new revision at once (AD-13), not after the agent's quiet period.
    await store.settleRevision(id);
  }
  return result;
};

/** `POST /systems/:id/assets`: the upload is taken once (it is gone whatever the answer). */
export const addSystemAsset = async (ctx: ServiceContext, id: string, input: { uploadId: string; name: string; kind: AssetKind }): Promise<AddSystemAssetResponse> => {
  const store = ensureSystemStore(ctx);
  await store.dir(id); // 404 before the upload is consumed
  const state = await store.readState(id);
  if (state.home?.kind === 'repo') {
    try {
      ctx.uploads.takeBytes(input.uploadId); // gone whatever the answer
    } catch {
      /* already gone or never there: the read-only answer still stands */
    }
    refuseReadOnly(state);
  }
  // Refused by type before the bytes are taken out of memory (they are dropped with the upload either way).
  const meta = checkAssetMeta(input.name, input.kind, 0);
  const bytes = ctx.uploads.takeBytes(input.uploadId);
  if (!meta.ok) throw new ApiError('invalid', meta.reason);
  const result = await addUnderLock(ctx, id, (async function* () {
    yield { name: input.name, kind: input.kind, bytes };
  })());
  const refusal = result.refused[0];
  if (refusal !== undefined) throw new ApiError('invalid', refusal.reason);
  const added = result.added[0];
  if (added === undefined) throw new Error('assets: one file in, nothing added and nothing refused.');
  if (!result.recorded) throw new ApiError('conflict', notRecorded([added.rel.split('/').at(-1) ?? added.rel]));
  return { asset: { file: added.rel, kind: added.kind, bytes: added.bytes }, refused: null };
};

/** A listed file that is something else once opened (swapped for a folder, a device or a pipe meanwhile). */
export const notPlainFileReason = (name: string): string => `${displayName(name)} isn't a plain file, so it wasn't added.`;

export type FolderFilesDeps = {
  /** Test seam: what the opened file is (default `handle.stat()`). */
  statOf?: (handle: FileHandle, abs: string) => Promise<{ isFile(): boolean; size: number }>;
};

/**
 * Read one regular file of the brand folder, refusing by name and size before opening and never following
 * a link. Every regular file the listing names ends as a file or a refusal, never dropped unsaid (KI-24).
 */
export async function* folderFiles(
  directory: string,
  deps: FolderFilesDeps = {},
): AsyncGenerator<{ name: string; kind: AssetKind | null; bytes: Buffer } | { name: string; reason: string }> {
  const statOf = deps.statOf ?? ((handle: FileHandle): Promise<{ isFile(): boolean; size: number }> => handle.stat());
  let listed: Dirent[];
  try {
    listed = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    const reason = code === 'EACCES' || code === 'EPERM' ? "Design Chamber isn't allowed to open it." : code === 'ENOENT' ? "It doesn't exist." : "It can't be opened right now.";
    throw new ApiError('bad-path', `Design Chamber can't read ${directory}. ${reason}`);
  }
  const entries = listed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let looked = 0;
  for (const entry of entries) {
    // A Dirent of a link is never isFile(): links are skipped, as are folders and dot files.
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    if (looked >= FOLDER_FILES_MAX) break;
    looked += 1;
    const abs = path.join(directory, entry.name);
    const byName = checkAssetMeta(entry.name, null, 0);
    if (!byName.ok) {
      yield { name: entry.name, reason: byName.reason }; // never opened (a key or .env file stays unread)
      continue;
    }
    // O_NOFOLLOW where the platform has it: a file swapped for a link after the listing is not followed.
    const handle = await open(abs, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
    if (handle === null) {
      yield { name: entry.name, reason: `Design Chamber can't open ${displayName(entry.name)}.` };
      continue;
    }
    try {
      const info = await statOf(handle, abs);
      if (!info.isFile()) {
        yield { name: entry.name, reason: notPlainFileReason(entry.name) };
        continue;
      }
      const bySize = checkAssetMeta(entry.name, null, info.size);
      if (!bySize.ok) {
        yield { name: entry.name, reason: bySize.reason };
        continue;
      }
      const cap = info.size;
      const bytes = Buffer.alloc(cap);
      let filled = 0;
      while (filled < cap) {
        const { bytesRead } = await handle.read(bytes, filled, cap - filled, filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      yield { name: entry.name, kind: bySize.kind, bytes: bytes.subarray(0, filled) };
    } finally {
      await handle.close();
    }
  }
}

/** `POST /systems/:id/assets/from-folder`. */
export const addAssetsFromFolder = async (ctx: ServiceContext, id: string, directory: string): Promise<AssetsFromFolderResponse> => {
  const store = ensureSystemStore(ctx);
  await store.dir(id);
  refuseReadOnly(await store.readState(id)); // before the folder is even looked at
  const folder = await validateScanFolder(directory, ctx.settings.root(), { insideRootSentence: 'Pick a folder outside your Designs folder.' });
  const result = await addUnderLock(ctx, id, folderFiles(folder));
  if (!result.recorded) throw new ApiError('conflict', notRecorded(result.added.map((one) => one.rel.split('/').at(-1) ?? one.rel)));
  return { added: result.added.map(({ rel, kind }) => ({ file: rel, kind })), refused: result.refused };
};
