// The reads behind `dc list` and `dc read` (documentation/specs/use-the-project-and-native-agent.md
// §2.3, §2.4): the designs folder, one design's state, and what the user has open. Read only:
// nothing here writes a file, and the hand-edit ledger stays as it is (only a sent message clears it).
//
// Everything read is agent-reachable (the agent writes the design folders, any local program can
// write view.json), so:
//   - a design folder is a slug (`SLUG_PATTERN`), resolved with `resolveInside` under the root,
//     and must be that folder itself: a link at the slug (to anywhere) is skipped;
//   - every file in it is reached through `resolvePlainTarget` (no link followed, a regular file
//     only), checked again on the open handle and read bounded;
//   - no path taken from file content is opened, except check PNG names, which must have the shape
//     a check writes (`.chamber/check/<run>/<name>.png`) and are re-resolved the same way;
//   - view.json's slug is re-checked and re-resolved under the current root.

import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { clip, oneLine } from '../shared/agent/context.ts';
import type { DesignSystemLine, ListAnswer, ListRow, ListSystem, OpenView, ReadAnswer, ReadCheck } from '../shared/agent/read-text.ts';
import { viewportLabel } from '../shared/agent/revision-prompt.ts';
import { countFindings, parseCheckReportText, sortFindings, withMessage } from '../shared/checks.ts';
import { applyServiceState, DESIGN_JSON_FILE, ENTRY_FILE, normalizeKind, normalizeServiceState, parseDesignJsonText, serviceStateOf } from '../shared/design-json.ts';
import { CHECK_FILE_MAX_BYTES, EDITS_FILE_MAX_BYTES, PAGE_FILL_VIEWPORT_ID, SCREEN_ID_PATTERN, SLUG_PATTERN } from '../shared/limits.ts';
import { sameDirectory } from '../shared/path-compare.ts';
import { COPY_DIR, COPY_JSON_FILE } from '../shared/system-copy.ts';
import { choiceSystemsOf } from '../shared/systems.ts';
import type { DesignJson, DesignKind, HandEdit, ServiceState, SettingsFile, SystemSummary } from '../shared/types.ts';
import { isViewFresh, VIEW_FILE, VIEW_SELECTION_TEXT_MAX, VIEW_SELECTOR_MAX, type ViewFile } from '../shared/view.ts';
import { isRunId } from './check/output.ts';
import { renderIsFresh } from './check/service.ts';
import { runStaticChecks } from './check/static.ts';
import { cliSystemStore } from './check/system-run.ts';
import { parseEditsFile } from './edits/file.ts';
import { isPlainTarget, resolveInside, resolvePlainTarget, samePath } from './paths.ts';
import { isDesignFolder } from './root.ts';
import { readCopyRecord } from './store.ts';

/** design.json and state.json carry up to 500 comments of 2 000 characters with anchors: a few MB at most. */
export const DESIGN_FILE_READ_MAX_BYTES = 4 * 1024 * 1024;
/** view.json is a few hundred bytes; anything far bigger is not the service's and is not read. */
export const VIEW_FILE_READ_MAX_BYTES = 16 * 1024;
/** Time the static file check may take for the "before your latest changes" flag (the tool stops at 20 s). */
const READ_STATIC_BUDGET_MS = 5000;
/** Check pictures checked on disk; `dc read` names fewer. */
const PNGS_CHECKED_MAX = 64;

// ---- bounded reads ----

export type PlainRead = { kind: 'ok'; text: string } | { kind: 'absent' } | { kind: 'refused' };

/**
 * A regular file's text inside `base`: `absent` when it isn't there, `refused` when it is a link
 * (anywhere on the way), not a file, over `maxBytes` or unreadable. Never follows a link out.
 */
export const readPlainBounded = async (base: string, segments: readonly string[], maxBytes: number): Promise<PlainRead> => {
  let file: string;
  try {
    file = await resolvePlainTarget(base, segments);
  } catch (error) {
    // Not there (an absent leaf or folder on the way); anything else (a link, a folder, a step out) is refused.
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { kind: 'absent' } : { kind: 'refused' };
  }
  try {
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > maxBytes) return { kind: 'refused' };
      const buffer = Buffer.alloc(maxBytes + 1);
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      // It grew between the stat and the read: the cap still holds.
      if (filled > maxBytes) return { kind: 'refused' };
      return { kind: 'ok', text: buffer.subarray(0, filled).toString('utf8') };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'absent' } : { kind: 'refused' };
  }
};

const jsonOf = (read: PlainRead): unknown => {
  if (read.kind !== 'ok') return null;
  try {
    return JSON.parse(read.text.charCodeAt(0) === 0xfeff ? read.text.slice(1) : read.text) as unknown;
  } catch {
    return null;
  }
};

// ---- the designs folder ----

export type RootFolder = {
  /** The root as given (what the agent is shown). */
  shown: string;
  /** Its realpath (what every read is built from, so a linked root is not a link inside itself). */
  real: string;
};

/** The root, which must exist; throws a plain sentence otherwise. */
export const openRoot = async (root: string): Promise<RootFolder> => {
  const real = await realpath(root).catch(() => null);
  const info = real === null ? null : await lstat(real).catch(() => null);
  if (real === null || info === null || !info.isDirectory()) throw new Error(`The designs folder ${root} does not exist.`);
  return { shown: root, real };
};

export type DesignFolder = { slug: string; dir: string; shown: string };

/**
 * The design folder for `slug`, or null: not a folder name, outside the root, a link (even one
 * pointing inside), not a folder, or the user's own folder that isn't a design.
 */
export const designFolderOf = async (root: RootFolder, slug: string): Promise<DesignFolder | null> => {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) return null;
  let real: string;
  try {
    real = await resolveInside(root.real, [slug]);
  } catch {
    return null;
  }
  const dir = path.join(root.real, slug);
  if (!samePath(real, dir)) return null;
  const info = await lstat(dir).catch(() => null);
  if (info === null || info.isSymbolicLink() || !info.isDirectory()) return null;
  if (!(await isDesignFolder(dir))) return null;
  return { slug, dir, shown: path.join(root.shown, slug) };
};

type DesignRead = { design: DesignJson; state: ServiceState; readable: boolean };

/**
 * One design as the store reads it (§6.3): state.json's service-owned fields over design.json's
 * agent fields, comments from state.json. A design.json that is there but can't be parsed (or is
 * a link, or too large) reads with defaults and `readable: false`.
 */
export const readDesignAt = async (folder: DesignFolder): Promise<DesignRead> => {
  const { dir, slug } = folder;
  const folderTime = (await lstat(dir)).mtime.toISOString();
  const stateRaw = jsonOf(await readPlainBounded(dir, ['.chamber', 'state.json'], DESIGN_FILE_READ_MAX_BYTES));
  const state = stateRaw === null ? null : normalizeServiceState(stateRaw);
  const designRead = await readPlainBounded(dir, [DESIGN_JSON_FILE], DESIGN_FILE_READ_MAX_BYTES);
  const designText = designRead.kind === 'ok' ? designRead.text : null;
  const entry = await lstat(path.join(dir, ENTRY_FILE)).catch(() => null);
  const kind: DesignKind = state?.kind ?? (entry?.isFile() === true ? 'page' : 'canvas');
  const options = { fallbackTitle: slug, fallbackTime: folderTime };
  let parsed = parseDesignJsonText(designText ?? '{}', { ...options, kind });
  const agentKind = state === null && designText !== null && parsed.raw !== null ? normalizeKind(parsed.raw.kind) : null;
  if (agentKind !== null && agentKind !== kind) parsed = parseDesignJsonText(designText ?? '{}', { ...options, kind: agentKind });
  const finalState = state ?? serviceStateOf(parsed.design);
  const readable = designRead.kind === 'absent' || (designRead.kind === 'ok' && parsed.raw !== null);
  return { design: applyServiceState(parsed.design, finalState), state: finalState, readable };
};

/** The systems of the root, newest first; null when they can't be read. */
const systemsOf = async (root: string, settings: SettingsFile): Promise<SystemSummary[] | null> => {
  const store = cliSystemStore(root, settings);
  try {
    return await store.list();
  } catch {
    return null;
  } finally {
    await store.dispose().catch(() => undefined);
  }
};

const systemLineOf = async (folder: DesignFolder, state: ServiceState, systems: readonly SystemSummary[] | null, checkCopy: boolean): Promise<DesignSystemLine> => {
  const copy = await readCopyRecord(folder.dir).catch(() => ({ kind: 'invalid' as const }));
  if (copy.kind === 'ok') {
    const row = systems?.find((one) => one.id === copy.record.id);
    let complete: boolean | null = null;
    if (checkCopy) {
      complete = true;
      const copyDir = path.join(folder.dir, COPY_DIR);
      for (const rel of ['system.css', ...Object.keys(copy.record.files)]) {
        if (rel === COPY_JSON_FILE) continue;
        if (!(await isPlainTarget(copyDir, rel.split('/')))) {
          complete = false;
          break;
        }
      }
    }
    return { state: 'linked', name: row?.name ?? copy.record.name, revision: copy.record.revision, complete };
  }
  if (copy.kind === 'absent' && state.systemDecision === 'project') return { state: 'project' };
  if (copy.kind === 'absent' && state.systemDecision === 'ask') return { state: 'ask' };
  return { state: 'none' };
};

// ---- what the user has open (§2.4) ----

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** view.json as far as it validates and is fresh, or null. Its slug is only a slug here: the caller re-resolves it. */
export const parseViewFile = (raw: unknown, nowMs: number): ViewFile | null => {
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.at !== 'string' || raw.at.length > 40) return null;
  if (raw.surface !== 'rail' && raw.surface !== 'page') return null;
  if (typeof raw.slug !== 'string' || !SLUG_PATTERN.test(raw.slug)) return null;
  const view: ViewFile = { v: 1, at: raw.at, surface: raw.surface, slug: raw.slug, title: null, screen: null, viewport: null, mode: null, selection: null };
  if (!isViewFresh(view, nowMs)) return null;
  if (typeof raw.title === 'string') view.title = clip(oneLine(raw.title), 200);
  if (typeof raw.screen === 'string' && SCREEN_ID_PATTERN.test(raw.screen)) view.screen = raw.screen;
  if (typeof raw.viewport === 'string' && raw.viewport.length <= 64 && !CONTROL.test(raw.viewport)) view.viewport = raw.viewport;
  if (raw.mode === 'edit' || raw.mode === 'play') view.mode = raw.mode;
  const selection = raw.selection;
  if (isRecord(selection) && typeof selection.selector === 'string' && typeof selection.text === 'string' && selection.selector.trim() !== '') {
    view.selection = { selector: clip(oneLine(selection.selector), VIEW_SELECTOR_MAX), text: clip(oneLine(selection.text), VIEW_SELECTION_TEXT_MAX) };
  }
  return view;
};

/** The fresh view.json in Design Chamber's data folder (beside settings.json), or null. */
export const readViewFile = async (dataDir: string, nowMs: number): Promise<ViewFile | null> => {
  const read = await readPlainBounded(dataDir, [VIEW_FILE], VIEW_FILE_READ_MAX_BYTES).catch((): PlainRead => ({ kind: 'refused' }));
  return parseViewFile(jsonOf(read), nowMs);
};

/** The view against the design it names: its screen and viewport only when the design has them. */
const openViewOf = (view: ViewFile, slug: string, design: DesignJson | null, nowMs: number): OpenView => {
  const screen = design === null || view.screen === null ? null : (design.screens.find((one) => one.id === view.screen) ?? null);
  const viewportKnown = design !== null && view.viewport !== null && (design.viewports.some((one) => one.id === view.viewport) || (design.kind === 'page' && view.viewport === PAGE_FILL_VIEWPORT_ID));
  return {
    slug,
    title: design?.title ?? view.title ?? slug,
    surface: view.surface,
    screen: screen === null ? null : { id: screen.id, title: screen.title },
    viewport: viewportKnown && view.viewport !== null && design !== null ? viewportLabel(design.viewports, view.viewport) : null,
    mode: view.mode,
    selection: view.selection,
    ageMs: Math.max(0, nowMs - Date.parse(view.at)),
  };
};

/** What is open, re-resolved under the current root; null when nothing fresh names a design there. */
const resolveOpen = async (root: RootFolder, view: ViewFile | null, nowMs: number, known?: ReadonlyMap<string, DesignJson>): Promise<OpenView | null> => {
  if (view === null || view.slug === null) return null;
  const cached = known?.get(view.slug);
  if (cached !== undefined) return openViewOf(view, view.slug, cached, nowMs);
  const folder = await designFolderOf(root, view.slug);
  if (folder === null) return null;
  const read = await readDesignAt(folder).catch(() => null);
  return openViewOf(view, view.slug, read === null || !read.readable ? null : read.design, nowMs);
};

// ---- dc list ----

export type ListInput = {
  root: string;
  settings: SettingsFile;
  /** Design Chamber's data folder (where settings.json and view.json live). */
  dataDir: string;
  now: Date;
  project: string | null;
  kind: DesignKind | null;
  text: string | null;
};

export const listDesigns = async (input: ListInput): Promise<ListAnswer> => {
  const root = await openRoot(input.root);
  const nowMs = input.now.getTime();
  const entries = await readdir(root.real, { withFileTypes: true });
  // A Dirent of a link is never isDirectory(): a linked design folder is skipped here, and again in designFolderOf.
  const slugs = entries.filter((entry) => entry.isDirectory() && SLUG_PATTERN.test(entry.name)).map((entry) => entry.name);
  const systems = await systemsOf(root.real, input.settings);

  const all: { row: ListRow; design: DesignJson | null }[] = [];
  for (const slug of slugs) {
    const folder = await designFolderOf(root, slug);
    if (folder === null) continue;
    const read = await readDesignAt(folder).catch(() => null);
    if (read === null || !read.readable) {
      all.push({ row: { slug, readable: false, updated: read?.design.updated ?? new Date(0).toISOString() }, design: null });
      continue;
    }
    const { design, state } = read;
    all.push({
      row: {
        slug,
        readable: true,
        kind: design.kind,
        title: design.title,
        projectDirectory: design.projectDirectory,
        updated: design.updated,
        openPins: design.comments.filter((comment) => comment.status === 'open').length,
        system: await systemLineOf(folder, state, systems, false),
      },
      design,
    });
  }

  const text = input.text?.trim().toLowerCase() ?? '';
  const matches = all.filter(({ row }) => {
    // A design that can't be read has no project or kind to match: only its folder name can.
    if (!row.readable) return input.project === null && input.kind === null && (text === '' || row.slug.includes(text));
    if (input.project !== null && (row.projectDirectory === null || !sameDirectory(row.projectDirectory, input.project))) return false;
    if (input.kind !== null && row.kind !== input.kind) return false;
    if (text !== '' && !row.slug.includes(text) && !row.title.toLowerCase().includes(text)) return false;
    return true;
  });
  const rows = matches.map(({ row }) => row).sort((a, b) => (a.updated === b.updated ? a.slug.localeCompare(b.slug) : b.updated.localeCompare(a.updated)));

  const known = new Map<string, DesignJson>();
  for (const one of all) if (one.design !== null) known.set(one.row.slug, one.design);
  const open = await resolveOpen(root, await readViewFile(input.dataDir, nowMs), nowMs, known);
  // The project each system belongs to, by the choice rules' own reading (use-the-project spec §1.2); an unreadable one belongs to none.
  const owners = new Map((systems === null ? [] : choiceSystemsOf(systems)).map((system) => [system.id, system.belongsTo]));
  const listed: ListSystem[] | null =
    systems === null ? null : systems.map((row) => ({ id: row.id, name: row.name, status: row.status, project: owners.get(row.id) ?? null, unreadable: row.unreadable !== null }));
  return { root: root.shown, open, rows, total: all.length, filtered: input.project !== null || input.kind !== null || text !== '', systems: listed };
};

// ---- dc read ----

export type ReadInput = { root: string; settings: SettingsFile; dataDir: string; now: Date; slug: string };

export type ReadResult = { ok: true; answer: ReadAnswer } | { ok: false; message: string };

/** One line per kind of hand edit, at most one per kind and screen. */
const handEditKinds = (ledger: readonly HandEdit[]): string[] => {
  const kinds: string[] = [];
  const add = (kind: string): void => {
    if (!kinds.includes(kind)) kinds.push(kind);
  };
  for (const entry of ledger) {
    if (entry.kind === 'text') add(`text on ${entry.screen ?? entry.file}`);
    else if (entry.kind === 'tweaks') add('tweaks');
    else if (entry.kind === 'reorder' || entry.kind === 'reorder-many') add('screen order');
    else if (entry.kind === 'duplicate') add(`duplicated ${entry.screen}`);
    else if (entry.kind === 'trash') add(`${entry.screen} moved to the trash`);
    else if (entry.kind === 'keep') add(`kept a direction of ${entry.screen}`);
    else if (entry.kind === 'undo') add('an undo');
  }
  return kinds;
};

const PNG_NAME = /^[A-Za-z0-9@._-]{1,120}\.png$/;

/** The last check, from `.chamber/check.json`: counts, whether the files changed since, and the pictures that are really there. No render. */
const lastCheckOf = async (folder: DesignFolder, design: DesignJson): Promise<ReadCheck> => {
  const read = await readPlainBounded(folder.dir, ['.chamber', 'check.json'], CHECK_FILE_MAX_BYTES);
  const report = read.kind === 'ok' ? parseCheckReportText(read.text) : null;
  if (report === null) return { state: 'none' };
  const findings = sortFindings([...report.static.findings, ...(report.render?.findings ?? [])].map((finding) => withMessage(finding, design.viewports))).filter((finding) => finding.code !== 'page-height');
  let stale = false;
  if (report.render !== null) {
    const current = await runStaticChecks(folder.dir, READ_STATIC_BUDGET_MS).catch(() => null);
    stale = current === null || !renderIsFresh(report, current);
  }
  const pngs: string[] = [];
  for (const rel of (report.render?.artboards ?? []).flatMap((artboard) => artboard.pngs).slice(0, PNGS_CHECKED_MAX)) {
    const parts = rel.split('/');
    if (parts.length !== 4 || parts[0] !== '.chamber' || parts[1] !== 'check' || !isRunId(parts[2] ?? '') || !PNG_NAME.test(parts[3] ?? '')) continue;
    if (await isPlainTarget(folder.dir, parts)) pngs.push(path.join(folder.shown, ...parts));
  }
  return { state: 'report', at: report.createdAt, counts: countFindings(findings), stale, pngs };
};

export const readOneDesign = async (input: ReadInput): Promise<ReadResult> => {
  const root = await openRoot(input.root);
  const notHere = { ok: false as const, message: `That is not a design in ${root.shown}.` };
  if (!SLUG_PATTERN.test(input.slug)) return notHere;
  const folder = await designFolderOf(root, input.slug);
  if (folder === null) return notHere;
  const nowMs = input.now.getTime();
  const { design, state, readable } = await readDesignAt(folder);
  // The systems list only names a linked copy (a renamed system); without a copy folder it isn't read.
  const hasCopy = (await lstat(path.join(folder.dir, COPY_DIR)).catch(() => null)) !== null;
  const systems = hasCopy ? await systemsOf(root.real, input.settings) : null;

  const editsRaw = jsonOf(await readPlainBounded(folder.dir, ['.chamber', 'edits.json'], EDITS_FILE_MAX_BYTES));
  const edits = editsRaw === null ? null : parseEditsFile(editsRaw, folder.slug).file;

  const view = await readViewFile(input.dataDir, nowMs);
  let open: ReadAnswer['open'] = { state: 'none' };
  if (view !== null && view.slug === folder.slug) open = { state: 'here', view: openViewOf(view, folder.slug, readable ? design : null, nowMs) };
  else if (view !== null) {
    const other = await resolveOpen(root, view, nowMs);
    if (other !== null) open = { state: 'other', view: other };
  }

  return {
    ok: true,
    answer: {
      slug: folder.slug,
      title: design.title,
      kind: design.kind,
      folder: folder.shown,
      projectDirectory: design.projectDirectory,
      readable,
      screens: design.screens,
      viewports: design.viewports,
      system: await systemLineOf(folder, state, systems, true),
      open,
      comments: design.comments,
      handEdits: edits === null ? { count: 0, kinds: [] } : { count: edits.ledger.length + edits.dropped, kinds: handEditKinds(edits.ledger) },
      check: await lastCheckOf(folder, design),
    },
  };
};
