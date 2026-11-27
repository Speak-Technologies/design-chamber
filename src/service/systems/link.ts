// Copy-on-link (documentation/specs/phase-2-5-technical.md §5.4, §2.6, AD-5, AD-7): a design's copy
// of its design system in `<design>/system/`, with `system/COPY.json` as the truth of which system
// and revision it copied.
//
//   link(slug, { to, by, stamp?, reason, toRevision? }):
//     the design's versions chain (`versions.userEdit`, never coalesced; none at creation):
//       precheck: leftovers of an interrupted swap recovered; `system` not a link or a file; the
//                 user's stamp; the target exists, is Ready and settled; its files read on its own
//                 lock with the tree checked before and after (a moved tree retries once, then the
//                 being-changed 409); the size cap. Nothing written, no version.
//       version first ("Before changing / updating the design system"; refused → 422, nothing changed)
//       apply:    staged in `.chamber/system-incoming-<rand>/` (COPY.json last, naming the version),
//                 the old copy moved to `.chamber/system-replaced-<rand>` (an unlink's to
//                 `.chamber/system-removed-<rand>`, which recovery never puts back), the staging renamed to
//                 `system/` (a failed rename puts the old copy back), the old copy removed; the
//                 self-writes recorded before the publish, so the watcher shows them as the
//                 user's; then state.json and the `files` event.
//   Undo is a restore of the version taken first (AD-7): `system/**` is tracked, so a restore brings
//   the old copy and its COPY.json back with no code here.
//
// Containment: the design folder comes from the store (slug pattern + `resolveInside`); the staging
// and replaced folders are fixed names under its `.chamber`; every copy path is `planCopy` output,
// checked again by `isCopyRel` and `resolveInside`. The system's files are read through
// `systems.filesDir(id)` and `resolvePlainTarget` (a link is never read). Nothing is written
// outside the design folder.

import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { CopyRecordView, DesignSystemActionResponse, DesignSystemView, SystemPreviewResponse } from '../../shared/api.ts';
import { SNAPSHOT_BYTES_MAX, SNAPSHOT_FILES_MAX, SYSTEM_ID_PATTERN } from '../../shared/limits.ts';
import {
  componentDiff,
  COPY_DIR,
  COPY_FILES_MAX,
  COPY_JSON_FILE,
  copyDrift,
  designSystemStatus,
  designSystemSummary,
  isCopyRel,
  overridesOf,
  ownTokensOf,
  tokenDiff,
  type IndexedSystem,
} from '../../shared/system-copy.ts';
import { buildSystemDetail } from '../../shared/system-json.ts';
import type { CopyRecord, ServiceState, SystemDetail, SystemSummary } from '../../shared/types.ts';
import type { ChangeHub, DesignStore, Logger, SelfWrites, ServiceContext } from '../context.ts';
import { readTokensFile } from '../edits/ops-tokens.ts';
import { ApiError } from '../http.ts';
import { renameWithRetry, resolveInside, resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import { readCopyRecord, readCopyRecordIn } from '../store.ts';
import { ensureVersionsService, listTracked, toSummary, treeHashOf, type VersionsService } from '../versions.ts';
import { ensureSystemStore, type SystemStore } from './store.ts';
import { snapshotTamperedMessage } from './snapshot.ts';

// ---- sentences (§5.4, §3.2) ----

export const LINK_SYSTEM_GONE_MESSAGE = 'That design system is no longer in your Designs folder.';
export const linkDraftMessage = (name: string): string => `${name} is a draft, so it can't be used for designs yet.`;
export const linkBeingChangedMessage = (name: string): string => `${name} is being changed. Try again in a moment.`;
export const linkTooLargeMessage = (name: string): string => `${name}'s files are too large to copy into this design.`;
export const LINK_SWAP_BUSY_MESSAGE = "Another program is using this design's files. Close it and try again.";
export const LINK_FOLDER_LINK_MESSAGE = "This design's system folder is a link, so Design Chamber can't replace it here.";
export const LINK_STALE_MESSAGE = "This design's system changed since you opened this. Reload and try again.";
export const LINK_NO_COPY_MESSAGE = 'This design has no design system to update.';
const DESIGN_GONE_MESSAGE = 'That design is no longer in your Designs folder.';

/** Why a link was refused, for the agent's choice (§5.5 `systemChoiceProblem`). */
export type LinkRefusalReason = 'unknown' | 'draft' | 'being-changed' | 'too-large' | 'failed';

/** A refusal with its sentence (what the route answers) and the reason the reconciler records. */
export class LinkRefusal extends ApiError {
  readonly reason: LinkRefusalReason;

  constructor(code: ApiError['code'], message: string, reason: LinkRefusalReason) {
    super(code, message);
    this.reason = reason;
  }
}

// ---- the plan (pure) ----

/** The entry stylesheet of every copy (§2.6): the bundler follows both imports. */
export const SYSTEM_CSS_TEXT = '@import "fonts.css";\n@import "tokens.css";\n';

const FONT_FORMATS: Readonly<Record<string, string>> = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

/**
 * Agent reference files a copy carries (never exported): the overview, notes, patterns, brand texts,
 * examples, system screens (system-builder-depth T12a) and system.json.
 */
const REFERENCE_PATTERN = /^(?:OVERVIEW\.md|system\.json|(?:notes|patterns|brand)\/[^/]+\.md|(?:components|patterns|brand|screens)\/[^/]+\.html)$/;

/** True for a copy path that is reference for the agent only (§2.6): never in a ZIP export. */
export const isCopyReference = (rel: string): boolean => REFERENCE_PATTERN.test(rel) || rel === COPY_JSON_FILE;

/** The family names in a `font-family` value: comma-separated, quotes and case removed. */
export const familiesIn = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim().replace(/^(["'])(.*)\1$/, '$2').trim().toLowerCase())
    .filter((part) => part !== '');

/** A copy file: bytes from a system file (`from`, contract-relative) or generated text. */
export type CopyPlanEntry = { to: string; from: string } | { to: string; text: string };
export type CopyPlan = { entries: CopyPlanEntry[] };

const baseName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);
const extensionOf = (rel: string): string => {
  const name = baseName(rel);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/**
 * What a copy holds (§2.6), from the system's content files and its parsed detail:
 * `tokens.css` byte for byte (empty when the system has none), a generated `fonts.css` with one
 * `@font-face` per font whose family a type style or a typography token names, the `system.css`
 * entry, those font files, every logo, every listed icon, and the agent reference. Never `sources/**`, `.chamber/**`,
 * `.versions/**`, `BUILD.json`, `SNAPSHOT.json` or an unused font. Every value written into
 * `fonts.css` already passed system.json's patterns (family, safe file name, weight, style), and
 * the file names are checked again here, so nothing from the system can break out of a rule.
 */
export const planCopy = (files: readonly string[], detail: Pick<SystemDetail, 'fonts' | 'logos' | 'icons' | 'type' | 'tokens'>): CopyPlan => {
  const present = new Set(files);
  const entries: CopyPlanEntry[] = [];
  const taken = new Set<string>();
  const add = (entry: CopyPlanEntry): void => {
    if (taken.has(entry.to) || !isCopyRel(entry.to)) return;
    taken.add(entry.to);
    entries.push(entry);
  };

  add(present.has('tokens.css') ? { to: 'tokens.css', from: 'tokens.css' } : { to: 'tokens.css', text: '' });

  const used = new Set<string>();
  for (const style of detail.type) for (const family of familiesIn(style.family)) used.add(family);
  for (const token of detail.tokens) {
    if (token.section !== 'typography') continue;
    for (const value of [token.light, token.dark]) if (value !== null) for (const family of familiesIn(value.text)) used.add(family);
  }
  const rules: string[] = [];
  for (const font of detail.fonts) {
    const format = FONT_FORMATS[extensionOf(font.file)];
    const name = baseName(font.file);
    if (format === undefined || !present.has(font.file) || !used.has(font.family.toLowerCase())) continue;
    if (!/^[A-Za-z0-9_][A-Za-z0-9._ -]{0,79}$/.test(name) || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(font.family)) continue;
    add({ to: `fonts/${name}`, from: font.file });
    rules.push(
      `@font-face {\n  font-family: "${font.family}";\n  src: url("fonts/${name}") format("${format}");\n  font-weight: ${Math.trunc(font.weight)};\n  font-style: ${font.style === 'italic' ? 'italic' : 'normal'};\n  font-display: swap;\n}\n`,
    );
  }
  add({ to: 'fonts.css', text: rules.join('\n') });
  add({ to: 'system.css', text: SYSTEM_CSS_TEXT });
  for (const logo of detail.logos) if (present.has(logo.file)) add({ to: `logos/${baseName(logo.file)}`, from: logo.file });
  // Listed icons only: a file in assets/icons/ that `icons` does not name is not copied.
  for (const icon of detail.icons) if (present.has(icon.file)) add({ to: `icons/${baseName(icon.file)}`, from: icon.file });
  for (const rel of [...files].sort()) if (REFERENCE_PATTERN.test(rel)) add({ to: rel, from: rel });
  return { entries };
};

// ---- helpers ----

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** `sha256(COPY.json bytes or "") + ":" + sha256(design tokens.css bytes or "")` (§3.2). */
export const designSystemStamp = (copyBytes: Uint8Array | null, tokensBytes: Uint8Array | null): string =>
  `${sha256(copyBytes ?? '')}:${sha256(tokensBytes ?? '')}`;

const STAGING_PREFIX = 'system-incoming-';
const REPLACED_PREFIX = 'system-replaced-';
/**
 * An unlink's old copy, on its way out. Its own prefix, so recovery can tell it from a swap's
 * replaced copy: a removed system never comes back, whatever stopped the cleanup.
 */
const REMOVED_PREFIX = 'system-removed-';
/** Folder levels a copy can have (`fonts/x`, `notes/x.md`); deeper entries are not part of it. */
const COPY_DEPTH_MAX = 3;

/** sha256 of every file under a copy folder, bounded; links and dot names are skipped. */
export const hashCopyFolder = async (copyDir: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  let budget = COPY_FILES_MAX + 50;
  const walk = async (relDir: string, depth: number): Promise<void> => {
    const absDir = relDir === '' ? copyDir : path.join(copyDir, ...relDir.split('/'));
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (budget <= 0) return;
      if (entry.name.startsWith('.')) continue;
      budget -= 1;
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth < COPY_DEPTH_MAX) await walk(rel, depth + 1);
      } else if (entry.isFile()) {
        const bytes = await readFile(path.join(absDir, entry.name)).catch(() => null);
        if (bytes !== null) out[rel] = sha256(bytes);
      }
    }
  };
  await walk('', 1);
  return out;
};

/** The design's `system` path: absent, a real folder, or something Design Chamber won't replace. */
const copyFolderKind = async (designDir: string): Promise<'absent' | 'folder' | 'other'> => {
  const info = await lstat(path.join(designDir, COPY_DIR)).catch(() => null);
  if (info === null) return 'absent';
  return info.isDirectory() && !info.isSymbolicLink() ? 'folder' : 'other';
};

/** A text file of the design's copy (`system/<name>`), or null when the copy folder or the file is not a plain one. */
const readCopyText = async (designDir: string, name: string): Promise<string | null> => {
  if ((await copyFolderKind(designDir)) !== 'folder') return null;
  const read = await readTokensFile(designDir, [COPY_DIR, name]).catch(() => null);
  return read?.kind === 'read' ? read.text : null;
};

/** `.chamber` of a design, made without recursion (a deleted design is never recreated). */
const chamberOf = async (designDir: string): Promise<string> => {
  const chamber = path.join(designDir, '.chamber');
  try {
    await mkdir(chamber);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') throw new ApiError('not-found', DESIGN_GONE_MESSAGE);
    if (codeOf(error) !== 'EEXIST') throw error;
  }
  const info = await lstat(chamber);
  if (!info.isDirectory()) throw new ApiError('invalid', LINK_FOLDER_LINK_MESSAGE);
  return resolveInside(designDir, ['.chamber']);
};

const isComplete = async (stagingDir: string): Promise<boolean> => {
  const read = await readCopyRecordIn(stagingDir).catch(() => null);
  if (read === null || read.kind !== 'ok') return false;
  for (const rel of Object.keys(read.record.files)) {
    const info = await lstat(path.join(stagingDir, ...rel.split('/'))).catch(() => null);
    if (info === null || !info.isFile()) return false;
  }
  return true;
};

/**
 * Finish or undo a swap a restart interrupted (§5.4 Recovery), so a design keeps its old copy or
 * the new one, never neither: with no `system/`, a complete staging (a valid COPY.json and every
 * file it lists) is renamed into place, else a replaced copy is renamed back. A removed copy (an
 * unlink whose cleanup did not finish) is never put back. Every other leftover is Design Chamber's
 * own folder and is removed.
 */
export const recoverCopy = async (designDir: string): Promise<void> => {
  const chamber = path.join(designDir, '.chamber');
  const entries = await readdir(chamber, { withFileTypes: true }).catch(() => []);
  const withPrefix = (prefix: string): string[] =>
    entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).map((entry) => path.join(chamber, entry.name));
  const staged = withPrefix(STAGING_PREFIX);
  const replaced = withPrefix(REPLACED_PREFIX);
  const removed = withPrefix(REMOVED_PREFIX);
  for (const leftover of removed) await rm(leftover, { recursive: true, force: true });
  if (staged.length === 0 && replaced.length === 0) return;
  const live = path.join(designDir, COPY_DIR);
  let used: string | null = null;
  if ((await copyFolderKind(designDir)) === 'absent') {
    for (const candidate of staged) {
      if (await isComplete(candidate)) {
        used = candidate;
        break;
      }
    }
    used ??= replaced[0] ?? null;
    if (used !== null) await renameWithRetry(used, live);
  }
  for (const leftover of [...staged, ...replaced]) if (leftover !== used) await rm(leftover, { recursive: true, force: true });
};

/** Every design folder under the root with swap leftovers, recovered (service start, §5.4). Never throws. */
export const recoverAllCopies = async (root: string, log: Logger): Promise<void> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !SYSTEM_ID_PATTERN.test(entry.name)) continue; // the slug pattern (SYSTEM_ID_PATTERN = SLUG_PATTERN)
    try {
      await recoverCopy(await resolveInside(root, [entry.name]));
    } catch (error) {
      log.warn('systems.copy-recover-failed', { slug: entry.name, error: messageOf(error) });
    }
  }
};

// ---- the service ----

export type LinkRequest = {
  /** A system id, or `none`. */
  to: string;
  by: 'user' | 'agent' | 'creation';
  /** The user's stamp (`designSystemStamp`); absent for the agent and at creation. */
  stamp?: string;
  reason: 'system-change' | 'system-update';
  /** Update only: the revision the user saw in the preview. */
  toRevision?: number;
};

/** A system's files read for a copy: the plan with every byte, and the revision they are. */
type SystemCopy = { id: string; name: string; revision: number; treeHash: string; files: Map<string, Buffer>; bytes: number };

type Precheck =
  | { kind: 'link'; designDir: string; target: SystemCopy; old: Record<string, string>; hadCopy: CopyRecord | null; choice: string | undefined }
  | { kind: 'unlink'; designDir: string; old: Record<string, string>; hadCopy: CopyRecord | null; choice: string | undefined };

/** A request that changes no file: answered without a version (precheck throws it, `link` catches it). */
class NoFileChange {
  readonly decision: 'none' | null;
  constructor(decision: 'none' | null) {
    this.decision = decision;
  }
}

export type LinkServiceDeps = {
  store: DesignStore;
  versions: VersionsService;
  systems: SystemStore;
  selfWrites: SelfWrites;
  hub: ChangeHub;
  log: Logger;
  /** The designs root now (start-up recovery lists it). */
  root: () => string;
  now?: () => Date;
  /** Test seam: removes the old copy after a swap (default `rm -r`), so a cleanup that fails can be proven. */
  removeTree?: (dir: string) => Promise<void>;
};

export type LinkService = {
  link(slug: string, request: LinkRequest): Promise<DesignSystemActionResponse>;
  view(slug: string): Promise<DesignSystemView>;
  preview(slug: string, to: string): Promise<SystemPreviewResponse>;
  /**
   * Systems as the status rules see them. `fresh` reads the folder now (a decision: a link, the
   * agent's choice, a new design); otherwise the index, or a fresh list when it has not loaded (the list).
   */
  indexed(fresh?: boolean): Promise<IndexedSystem[]>;
  /**
   * Service start (§5.4): recover every design's swap leftovers. Links wait for it, so a link that
   * starts at once never has its staging taken for a leftover. Never rejects.
   */
  recoverAll(): Promise<void>;
};

const LIST_MAX = 200;
const VIEW_LIST_MAX = 20;

const capped = <T>(list: readonly T[], max: number): T[] => list.slice(0, max);

const copyRecordView = ({ files, ...rest }: CopyRecord): CopyRecordView => ({ ...rest, fileCount: Object.keys(files).length });

const toIndexed = (rows: readonly SystemSummary[]): IndexedSystem[] =>
  rows.filter((row) => row.unreadable === null).map((row) => ({ id: row.id, name: row.name, status: row.status, revision: row.revision }));

export const createLinkService = (deps: LinkServiceDeps): LinkService => {
  const { store, versions, systems, selfWrites, hub, log } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const removeTree = deps.removeTree ?? ((dir: string): Promise<void> => rm(dir, { recursive: true, force: true }));
  let startup: Promise<void> = Promise.resolve();

  const indexed = async (fresh = false): Promise<IndexedSystem[]> => {
    const rows = systems.index();
    if (!fresh && rows.length > 0) return toIndexed(rows);
    return toIndexed(await systems.list());
  };

  /** The target's name for a sentence: its state's, or the id when it can't be read. */
  const nameOf = async (id: string): Promise<string> => (await systems.readState(id).catch(() => null))?.name ?? id;

  /**
   * The system's files for a copy, read on the system's own lock (no edit or restore interleaves),
   * with the revision brought current first and the tree checked before and after the read: a tree
   * that moved (the agent writing) is retried once, then refused as being changed (§5.4 step 3).
   */
  const readSystemCopy = async (id: string): Promise<SystemCopy> => {
    try {
      await systems.dir(id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not-found') throw new LinkRefusal('invalid', LINK_SYSTEM_GONE_MESSAGE, 'unknown');
      throw error;
    }
    const state = await systems.readState(id);
    if (state.status !== 'ready') throw new LinkRefusal('invalid', linkDraftMessage(state.name), 'draft');
    if (!systems.isSettled(id)) throw new LinkRefusal('conflict', linkBeingChangedMessage(state.name), 'being-changed');
    // §5.10 tamper rule: a snapshot holding bytes Design Chamber didn't put there is never copied.
    if (state.home?.kind === 'repo' && state.snapshot?.tampered === true) throw new LinkRefusal('conflict', snapshotTamperedMessage(state.name), 'failed');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Outside the lock: settleRevision takes the system's lock itself.
      await systems.settleRevision(id);
      const read = await systems.withLock(id, async (): Promise<SystemCopy | null> => {
        const current = await systems.readState(id);
        if (current.status !== 'ready') throw new LinkRefusal('invalid', linkDraftMessage(current.name), 'draft');
        if (current.home?.kind === 'repo' && current.snapshot?.tampered === true) throw new LinkRefusal('conflict', snapshotTamperedMessage(current.name), 'failed');
        const source = await systems.get(id);
        const before = treeHashOf(source.hashes ?? {});
        if (before !== current.revision.treeHash) return null;
        const plan = planCopy(source.files.map((file) => file.rel), buildSystemDetail(source));
        const filesDir = await systems.filesDir(id);
        const files = new Map<string, Buffer>();
        let bytes = 0;
        for (const entry of plan.entries) {
          if ('text' in entry) {
            const buffer = Buffer.from(entry.text, 'utf8');
            files.set(entry.to, buffer);
            bytes += buffer.length;
            continue;
          }
          const file = await resolvePlainTarget(filesDir, entry.from.split('/')).catch(() => null);
          if (file === null) return null; // gone or turned into a link meanwhile
          const info = await stat(file).catch(() => null);
          if (info === null) return null;
          bytes += info.size;
          if (bytes > SNAPSHOT_BYTES_MAX) throw new LinkRefusal('invalid', linkTooLargeMessage(current.name), 'too-large');
          const buffer = await readFile(file).catch(() => null);
          if (buffer === null || sha256(buffer) !== source.hashes?.[entry.from]) return null;
          files.set(entry.to, buffer);
        }
        const after = await systems.get(id);
        if (treeHashOf(after.hashes ?? {}) !== before) return null;
        return { id, name: current.name, revision: current.revision.n, treeHash: current.revision.treeHash, files, bytes };
      });
      if (read !== null) return read;
    }
    throw new LinkRefusal('conflict', linkBeingChangedMessage(await nameOf(id)), 'being-changed');
  };

  /** The design's tracked files outside `system/` plus the copy must stay within the version caps (§5.4 step 3). */
  const checkSize = async (designDir: string, target: SystemCopy): Promise<void> => {
    let files = target.files.size + 1;
    let bytes = target.bytes;
    for (const rel of await listTracked(designDir)) {
      if (rel === COPY_DIR || rel.startsWith(`${COPY_DIR}/`)) continue;
      files += 1;
      bytes += (await stat(path.join(designDir, ...rel.split('/'))).catch(() => null))?.size ?? 0;
    }
    if (files > SNAPSHOT_FILES_MAX || bytes > SNAPSHOT_BYTES_MAX) throw new LinkRefusal('invalid', linkTooLargeMessage(target.name), 'too-large');
  };

  const stampOf = async (designDir: string): Promise<string> => {
    const copy = await readCopyRecord(designDir);
    const tokens = await readTokensFile(designDir);
    return designSystemStamp(copy.kind === 'ok' ? copy.bytes : null, tokens.kind === 'read' ? tokens.bytes : null);
  };

  const precheck = async (slug: string, request: LinkRequest): Promise<Precheck> => {
    const designDir = await store.dir(slug);
    await recoverCopy(designDir);
    if ((await copyFolderKind(designDir)) === 'other') throw new LinkRefusal('invalid', LINK_FOLDER_LINK_MESSAGE, 'failed');
    if (request.stamp !== undefined && request.stamp !== (await stampOf(designDir))) throw new ApiError('stale', LINK_STALE_MESSAGE);
    const copy = await readCopyRecord(designDir);
    const hadCopy = copy.kind === 'ok' ? copy.record : null;
    const record = await store.get(slug);
    const choice = record.design.systemChoice;
    const old = (await copyFolderKind(designDir)) === 'folder' ? await hashCopyFolder(path.join(designDir, COPY_DIR)) : {};
    if (request.to === 'none') {
      if (Object.keys(old).length === 0 && copy.kind === 'absent' && (await copyFolderKind(designDir)) === 'absent') throw new NoFileChange('none');
      return { kind: 'unlink', designDir, old, hadCopy, choice };
    }
    if (request.reason === 'system-update') {
      if (hadCopy === null || hadCopy.id !== request.to) throw new ApiError('invalid', LINK_NO_COPY_MESSAGE);
    }
    const target = await readSystemCopy(request.to);
    if (request.toRevision !== undefined && request.toRevision !== target.revision) throw new ApiError('stale', LINK_STALE_MESSAGE);
    if (hadCopy !== null && hadCopy.id === target.id && hadCopy.revision === target.revision && hadCopy.treeHash === target.treeHash) {
      const drift = copyDrift(hadCopy, old);
      if (drift.changed.length + drift.missing.length + drift.extra.length === 0) throw new NoFileChange(null);
    }
    await checkSize(designDir, target);
    return { kind: 'link', designDir, target, old, hadCopy, choice };
  };

  /** Stage, swap and publish (§5.4 steps 5–6). Answers the copy-relative files the design now has. */
  const swap = async (slug: string, plan: Precheck, record: CopyRecord | null, bytesOfRecord: Buffer | null): Promise<string[]> => {
    const { designDir } = plan;
    const chamber = await chamberOf(designDir);
    const live = path.join(designDir, COPY_DIR);
    const token = randomBytes(6).toString('hex');
    const now: Record<string, { sha: string; size: number }> = {};
    let staging: string | null = null;
    if (plan.kind === 'link' && record !== null && bytesOfRecord !== null) {
      staging = path.join(chamber, `${STAGING_PREFIX}${token}`);
      await mkdir(staging);
      try {
        for (const [rel, bytes] of plan.target.files) {
          const target = await resolveInside(staging, rel.split('/'));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFileAtomic(target, bytes, { createDirs: false });
          now[rel] = { sha: sha256(bytes), size: bytes.length };
        }
        // COPY.json last: a staging without it is incomplete, so recovery never publishes half a copy.
        await writeFileAtomic(path.join(staging, COPY_JSON_FILE), bytesOfRecord, { createDirs: false });
        now[COPY_JSON_FILE] = { sha: sha256(bytesOfRecord), size: bytesOfRecord.length };
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }

    // The watcher must see these as Design Chamber's own writes (no "Writing…" strip): recorded first.
    for (const rel of Object.keys(plan.old)) if (now[rel] === undefined) selfWrites.record(slug, `${COPY_DIR}/${rel}`, null, null);
    for (const [rel, file] of Object.entries(now)) selfWrites.record(slug, `${COPY_DIR}/${rel}`, file.sha, file.size);

    let replaced: string | null = null;
    if ((await copyFolderKind(designDir)) === 'folder') {
      // An unlink's old copy is "removed", not "replaced": recovery deletes it instead of putting it back.
      replaced = path.join(chamber, `${staging === null ? REMOVED_PREFIX : REPLACED_PREFIX}${token}`);
      try {
        await renameWithRetry(live, replaced);
      } catch (error) {
        if (staging !== null) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        log.warn('systems.copy-swap-busy', { slug, step: 'move-old', code: codeOf(error) ?? 'error' });
        throw new LinkRefusal('conflict', LINK_SWAP_BUSY_MESSAGE, 'failed');
      }
    }
    if (staging !== null) {
      try {
        await renameWithRetry(staging, live);
      } catch (error) {
        // Put the old copy back, so the design keeps what it had.
        if (replaced !== null) await renameWithRetry(replaced, live).catch((back: unknown) => log.error('systems.copy-restore-failed', { slug, code: codeOf(back) ?? 'error' }));
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        log.warn('systems.copy-swap-busy', { slug, step: 'publish', code: codeOf(error) ?? 'error' });
        throw new LinkRefusal('conflict', LINK_SWAP_BUSY_MESSAGE, 'failed');
      }
    }
    // The version taken first holds the old copy's bytes; this folder is Design Chamber's own.
    if (replaced !== null) await removeTree(replaced).catch((error: unknown) => log.warn('systems.copy-cleanup-failed', { slug, error: messageOf(error) }));
    return [...new Set([...Object.keys(plan.old), ...Object.keys(now)])].sort();
  };

  const statusNow = async (designDir: string, state: ServiceState): Promise<DesignSystemActionResponse['status']> => {
    const copy = await readCopyRecord(designDir);
    return designSystemStatus({ copy: copy.kind === 'ok' ? copy.record : null, copyInvalid: copy.kind === 'invalid', decision: state.systemDecision, systems: await indexed(true) });
  };

  const recordDecision = async (slug: string, request: LinkRequest, decision: 'none' | 'system', choice: string | undefined): Promise<ServiceState> =>
    store.updateSystemState(slug, (state) => {
      const next: ServiceState = { ...state, systemDecision: decision };
      delete next.systemChoiceProblem;
      // A user's Change… takes the agent's current answer as seen, so an old agent value never undoes it (§5.5).
      if (request.by === 'user' && choice !== undefined) next.systemChoiceSeen = choice;
      return next;
    });

  const link = async (slug: string, request: LinkRequest): Promise<DesignSystemActionResponse> => {
    if (request.to !== 'none' && !SYSTEM_ID_PATTERN.test(request.to)) throw new ApiError('bad-request', 'That is not a design system id.');
    await startup;
    const apply = async (plan: Precheck, before: string | null): Promise<{ files: string[]; notice: DesignSystemActionResponse['notice'] }> => {
      let record: CopyRecord | null = null;
      let bytes: Buffer | null = null;
      if (plan.kind === 'link') {
        const files: Record<string, string> = {};
        for (const [rel, buffer] of [...plan.target.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) files[rel] = sha256(buffer);
        record = { v: 1, id: plan.target.id, name: plan.target.name, revision: plan.target.revision, treeHash: plan.target.treeHash, at: now().toISOString(), by: request.by, before, files };
        bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      }
      const files = await swap(slug, plan, record, bytes);
      const notice: DesignSystemActionResponse['notice'] =
        plan.kind === 'unlink' ? 'removed' : plan.hadCopy === null ? 'linked' : plan.hadCopy.id !== plan.target.id ? 'switched' : 'updated';
      return { files, notice };
    };

    const finish = async (plan: Precheck, files: string[]): Promise<ServiceState> => {
      hub.emit({ slug, kind: 'files', files: files.map((rel) => `${COPY_DIR}/${rel}`), ...(request.by === 'agent' ? {} : { origin: 'user' as const }) });
      try {
        return await recordDecision(slug, request, plan.kind === 'link' ? 'system' : 'none', plan.choice);
      } catch (error) {
        // The copy stands (COPY.json is the truth of the link); the decision is only the unlinked label.
        log.warn('systems.link-state-failed', { slug, error: messageOf(error) });
        return (await store.get(slug)).state;
      }
    };

    try {
      if (request.by === 'creation') {
        const plan = await precheck(slug, request);
        const { files, notice } = await apply(plan, null);
        const state = await finish(plan, files);
        return { before: null, status: await statusNow(plan.designDir, state), notice };
      }
      const result = await versions.userEdit(slug, request.reason, {
        staleMessage: LINK_STALE_MESSAGE,
        precheck: () => precheck(slug, request),
        apply: async (plan, _tree, version) => {
          const done = await apply(plan, version?.id ?? null);
          // `written` feeds hand-edit coalescing only, which these reasons never do (each is its own version).
          return { response: { plan, ...done }, written: [] };
        },
      });
      const { plan, files, notice } = result.response;
      const state = await finish(plan, files);
      log.info('systems.linked', { slug, to: request.to, by: request.by, notice });
      return { before: result.version === null ? null : toSummary(result.version), status: await statusNow(plan.designDir, state), notice };
    } catch (error) {
      if (!(error instanceof NoFileChange)) throw error;
      const designDir = await store.dir(slug);
      const record = await store.get(slug);
      const state =
        error.decision === 'none'
          ? await recordDecision(slug, request, 'none', record.design.systemChoice)
          : request.by === 'user' && record.design.systemChoice !== undefined && record.design.systemChoice !== record.state.systemChoiceSeen
            ? await recordDecision(slug, request, 'system', record.design.systemChoice)
            : record.state;
      return { before: null, status: await statusNow(designDir, state), notice: 'unchanged' };
    }
  };

  const view = async (slug: string): Promise<DesignSystemView> => {
    const record = await store.get(slug);
    const designDir = record.path;
    const copy = await readCopyRecord(designDir);
    const designTokens = await readTokensFile(designDir);
    const designCss = designTokens.kind === 'read' ? designTokens.text : null;
    const copyCss = await readCopyText(designDir, 'tokens.css');
    const systemsNow = await indexed(true);
    const linked = copy.kind === 'ok' ? copy.record : null;
    const system = linked === null ? undefined : systemsNow.find((one) => one.id === linked.id);

    let drift = { complete: true, missing: [] as string[], drift: [] as string[] };
    if (linked !== null) {
      // The tokens the copy started with, when the system still holds exactly those bytes.
      let original: string | null = null;
      if (system !== undefined) {
        const filesDir = await systems.filesDir(linked.id).catch(() => null);
        const read = filesDir === null ? null : await readTokensFile(filesDir).catch(() => null);
        if (read?.kind === 'read' && sha256(read.bytes) === linked.files['tokens.css']) original = read.text;
      }
      const found = copyDrift(linked, await hashCopyFolder(path.join(designDir, COPY_DIR)), { original, current: copyCss });
      drift = { complete: found.missing.length === 0, missing: capped(found.missing, VIEW_LIST_MAX), drift: capped([...found.changed, ...found.extra], VIEW_LIST_MAX) };
    }
    return {
      status: designSystemStatus({ copy: linked, copyInvalid: copy.kind === 'invalid', decision: record.state.systemDecision, systems: systemsNow }),
      link: linked === null ? null : copyRecordView(linked),
      systemRevision: system?.revision ?? null,
      updateAvailable: linked === null ? false : designSystemSummary(linked, systemsNow).updateAvailable,
      copy: { ...drift, invalid: copy.kind === 'invalid' },
      overrides: linked === null ? [] : capped(overridesOf(copyCss, designCss), LIST_MAX),
      ownTokens: linked === null ? 0 : ownTokensOf(copyCss, designCss).length,
      choiceProblem: record.state.systemChoiceProblem ?? null,
      stamp: designSystemStamp(copy.kind === 'ok' ? copy.bytes : null, designTokens.kind === 'read' ? designTokens.bytes : null),
    };
  };

  const preview = async (slug: string, to: string): Promise<SystemPreviewResponse> => {
    if (to !== 'none' && !SYSTEM_ID_PATTERN.test(to)) throw new ApiError('bad-request', 'Say which design system to preview: an id or "none".');
    const designDir = await store.dir(slug);
    const copy = await readCopyRecord(designDir);
    const designTokens = await readTokensFile(designDir);
    const designCss = designTokens.kind === 'read' ? designTokens.text : null;
    const fromCss = copy.kind === 'ok' ? await readCopyText(designDir, 'tokens.css') : null;
    const fromJson = copy.kind === 'ok' ? await readCopyText(designDir, 'system.json') : null;
    let toCss: string | null = null;
    let toJson: string | null = null;
    let toRevision: number | null = null;
    let bytes = 0;
    if (to !== 'none') {
      const target = await readSystemCopy(to);
      toCss = target.files.get('tokens.css')?.toString('utf8') ?? null;
      toJson = target.files.get('system.json')?.toString('utf8') ?? null;
      toRevision = target.revision;
      bytes = target.bytes;
    }
    const tokens = tokenDiff(fromCss, toCss);
    const components = componentDiff(fromJson, toJson);
    return {
      fromRevision: copy.kind === 'ok' ? copy.record.revision : null,
      toRevision,
      tokens: {
        changed: capped(tokens.changed, LIST_MAX),
        added: capped(tokens.added, LIST_MAX),
        removed: capped(tokens.removed, LIST_MAX),
        totals: { changed: tokens.changed.length, added: tokens.added.length, removed: tokens.removed.length },
      },
      components: {
        changed: capped(components.changed, LIST_MAX),
        added: capped(components.added, LIST_MAX),
        removed: capped(components.removed, LIST_MAX),
        totals: { changed: components.changed.length, added: components.added.length, removed: components.removed.length },
      },
      overrides: capped(overridesOf(toCss, designCss).map((one) => one.name), LIST_MAX),
      ownTokens: ownTokensOf(toCss, designCss).length,
      bytes,
      stamp: designSystemStamp(copy.kind === 'ok' ? copy.bytes : null, designTokens.kind === 'read' ? designTokens.bytes : null),
    };
  };

  const recoverAll = (): Promise<void> => {
    startup = startup.then(() => recoverAllCopies(deps.root(), log));
    return startup;
  };

  return { link, view, preview, indexed, recoverAll };
};

// ---- the context accessor (the `ensureVersionsService` pattern, §5) ----

const instances = new WeakMap<ServiceContext, LinkService>();

export const ensureLinkService = (ctx: ServiceContext): LinkService => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createLinkService({
    store: ctx.store,
    versions: ensureVersionsService(ctx),
    systems: ensureSystemStore(ctx),
    selfWrites: ctx.selfWrites,
    hub: ctx.hub,
    log: ctx.log,
    root: () => ctx.settings.root(),
  });
  instances.set(ctx, created);
  return created;
};

export const linkDesignSystem = (ctx: ServiceContext, slug: string, request: LinkRequest): Promise<DesignSystemActionResponse> => ensureLinkService(ctx).link(slug, request);
