// View-model of the New design system sheet (Phase 2.5 U1, Phase 2.6 E2): the name rule, the four sources, what a
// brand file is and why one is refused, the scan's sentences, the existing-system discovery and location copy, and
// the one question "can it be made?". Pure: no DOM, no host calls. The service has the last word on every rule here
// (names, file types, sizes, locations); this only says it early, in the same words, next to the field.

import type { LocationView, ScanSummary, SystemCandidate } from '../../shared/api.ts';
import { SYSTEM_BYTES_MAX, SYSTEM_DOCUMENT_MAX_BYTES, SYSTEM_FILES_MAX, SYSTEM_FONT_MAX_BYTES, SYSTEM_IMAGE_MAX_BYTES, SYSTEM_NAME_MAX } from '../../shared/limits.ts';
import { plural } from './format.ts';

export type SourceId = 'code' | 'brand' | 'description' | 'existing';

/** The checkboxes under "Start from", in the order the sheet shows them. */
export const SOURCES: ReadonlyArray<{ id: SourceId; label: string; hint: string }> = [
  { id: 'code', label: 'Project code', hint: 'Design Chamber reads the CSS and token files it can parse. The agent reads the rest of the project and writes the overview, notes and components. The project isn’t changed.' },
  { id: 'brand', label: 'Brand files', hint: 'Fonts, logos and brand documents you already have.' },
  { id: 'description', label: 'A description', hint: 'Say what it should look like, or start from a style preset.' },
  { id: 'existing', label: 'Existing design system', hint: 'Your project already has a system? Point at where it lives. Design Chamber reads its token files; the agent reads its page, docs and components.' },
];

/**
 * Ticking one source: Project code and Existing design system exclude each other (the chosen project stays), and
 * Existing design system unticks an empty A description with no preset, so a start stays within the step budget.
 */
export const nextSources = (
  current: Readonly<Record<SourceId, boolean>>,
  id: SourceId,
  checked: boolean,
  context: { description: string; preset: string },
): Record<SourceId, boolean> => {
  const next = { ...current, [id]: checked };
  if (checked && (id === 'code' || id === 'existing')) next[id === 'code' ? 'existing' : 'code'] = false;
  if (checked && id === 'existing' && context.description.trim() === '' && context.preset === '') next.description = false;
  return next;
};

// ---------------------------------------------------------------- name

/** One rule for a new and a renamed system, ignoring case. `existing` is every system the folder has now. */
export const systemNameProblem = (raw: string, existing: ReadonlyArray<{ name: string }>): string | null => {
  const name = raw.normalize('NFKC').trim();
  if (name === '') return 'Give the design system a name.';
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) return 'A design system name can’t contain line breaks or tabs.';
  if (name.length > SYSTEM_NAME_MAX) return `Keep the name to ${SYSTEM_NAME_MAX} characters or fewer.`;
  const taken = existing.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  return taken ? `You already have a system called ${taken.name}.` : null;
};

// ---------------------------------------------------------------- brand files

export type BrandKind = 'font' | 'logo' | 'source';

const KIND_BY_EXTENSION: Readonly<Record<string, { kind: BrandKind; max: number; limit: string }>> = {
  woff2: { kind: 'font', max: SYSTEM_FONT_MAX_BYTES, limit: '5 MB' },
  woff: { kind: 'font', max: SYSTEM_FONT_MAX_BYTES, limit: '5 MB' },
  ttf: { kind: 'font', max: SYSTEM_FONT_MAX_BYTES, limit: '5 MB' },
  otf: { kind: 'font', max: SYSTEM_FONT_MAX_BYTES, limit: '5 MB' },
  svg: { kind: 'logo', max: SYSTEM_IMAGE_MAX_BYTES, limit: '10 MB' },
  png: { kind: 'logo', max: SYSTEM_IMAGE_MAX_BYTES, limit: '10 MB' },
  jpg: { kind: 'logo', max: SYSTEM_IMAGE_MAX_BYTES, limit: '10 MB' },
  jpeg: { kind: 'logo', max: SYSTEM_IMAGE_MAX_BYTES, limit: '10 MB' },
  webp: { kind: 'logo', max: SYSTEM_IMAGE_MAX_BYTES, limit: '10 MB' },
  pdf: { kind: 'source', max: SYSTEM_DOCUMENT_MAX_BYTES, limit: '20 MB' },
  md: { kind: 'source', max: SYSTEM_DOCUMENT_MAX_BYTES, limit: '20 MB' },
  txt: { kind: 'source', max: SYSTEM_DOCUMENT_MAX_BYTES, limit: '20 MB' },
};

/** The accept list of the file picker: the same types the service takes. */
export const BRAND_ACCEPT = Object.keys(KIND_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(',');

export const BRAND_TYPES_LINE = 'Fonts (woff2, woff, ttf, otf), logos (svg, png, jpg, webp) and documents (pdf, md, txt).';

/** What a picked file is, or the sentence for why it can't be used. The contents are checked by the service. */
export const classifyBrandFile = (name: string, bytes: number): { ok: true; kind: BrandKind } | { ok: false; reason: string } => {
  const dot = name.lastIndexOf('.');
  const rule = dot > 0 ? KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] : undefined;
  if (!rule) return { ok: false, reason: `${name} isn’t a file type design systems use.` };
  if (bytes > rule.max) return { ok: false, reason: `${name} is too large (the limit is ${rule.limit}).` };
  if (bytes === 0) return { ok: false, reason: `${name} is empty.` };
  return { ok: true, kind: rule.kind };
};

export type PickedFile = { key: string; name: string; bytes: number; kind: BrandKind };
export type RefusedFile = { name: string; reason: string };

/**
 * Sorts newly picked files into the ones kept and the ones refused, each with its sentence. A file already picked
 * (same name and size) is skipped quietly; past the file or size cap the rest are refused by name.
 */
export const takeBrandFiles = (
  incoming: ReadonlyArray<{ key: string; name: string; bytes: number }>,
  kept: readonly PickedFile[],
): { added: PickedFile[]; refused: RefusedFile[] } => {
  const added: PickedFile[] = [];
  const refused: RefusedFile[] = [];
  let count = kept.length;
  let bytes = kept.reduce((sum, file) => sum + file.bytes, 0);
  for (const file of incoming) {
    if (kept.some((entry) => entry.key === file.key) || added.some((entry) => entry.key === file.key)) continue;
    const verdict = classifyBrandFile(file.name, file.bytes);
    if (!verdict.ok) {
      refused.push({ name: file.name, reason: verdict.reason });
      continue;
    }
    if (count >= SYSTEM_FILES_MAX) {
      refused.push({ name: file.name, reason: `${file.name} wasn’t added: a design system holds up to ${SYSTEM_FILES_MAX} files.` });
      continue;
    }
    if (bytes + file.bytes > SYSTEM_BYTES_MAX) {
      refused.push({ name: file.name, reason: `${file.name} wasn’t added: a design system holds up to ${Math.round(SYSTEM_BYTES_MAX / 1024 / 1024)} MB of files.` });
      continue;
    }
    count += 1;
    bytes += file.bytes;
    added.push({ ...file, kind: verdict.kind });
  }
  return { added, refused };
};

/** A path the service can read from: a drive, a UNC share or a root. The service checks the rest. */
export const folderPathProblem = (raw: string): string | null => {
  const path = raw.trim();
  if (path === '') return 'Type the full path of the folder.';
  if (!/^([A-Za-z]:[\\/]|\\\\|\/)/.test(path)) return 'Use the full path of the folder, such as C:\\Brand or /Users/you/Brand.';
  return null;
};

// ---------------------------------------------------------------- the code scan

/** "Found 48 colours, 9 type styles, … in 14 files." The counts the scan found, zero ones left out. */
export const scanSummarySentence = (summary: ScanSummary): string | null => {
  const counts = summary.counts;
  const parts = [
    counts.colours > 0 ? plural(counts.colours, 'colour') : null,
    counts.typography > 0 ? plural(counts.typography, 'type style') : null,
    counts.spacing > 0 ? plural(counts.spacing, 'spacing value') : null,
    counts.radius > 0 ? `${plural(counts.radius, 'corner radius', 'corner radii')}` : null,
    counts.shadows > 0 ? plural(counts.shadows, 'shadow') : null,
    counts.layers > 0 ? plural(counts.layers, 'layer') : null,
    counts.sizes + counts.other > 0 ? plural(counts.sizes + counts.other, 'size') : null,
    counts.fonts > 0 ? plural(counts.fonts, 'font file') : null,
    counts.logos > 0 ? plural(counts.logos, 'logo file') : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return `Found ${parts.join(', ')} in ${plural(summary.files.length, 'file')}.`;
};

export const SCAN_NOTHING_FOUND = 'Design Chamber didn’t find design tokens in this project. The agent can still read it and write the system.';
export const SCAN_PARTIAL = 'Scanned part of the project; it’s large.';
export const FONT_LICENCE_NOTE = 'Check you’re allowed to use these fonts in designs.';

/** Files the agent should read itself (config Design Chamber doesn't run); null when there are none. */
export const forAgentLine = (summary: ScanSummary): string | null =>
  summary.forAgent.length === 0 ? null : `${plural(summary.forAgent.length, 'file')} Design Chamber doesn’t run. The agent will read ${summary.forAgent.length === 1 ? 'it' : 'them'}.`;

export const skippedLine = (summary: ScanSummary): string | null => {
  const total = summary.skipped.length + summary.refused;
  if (total === 0) return null;
  // One skipped file is named with the service's own reason; more than one is said as a count.
  const only = summary.skipped[0];
  if (total === 1 && only !== undefined) return `Skipped ${only.path}. ${only.reason}`;
  return `${plural(total, 'file')} skipped (too large, secret or unreadable).`;
};

/** A scan that found nothing usable: no counts and no assets. */
export const scanFoundNothing = (summary: ScanSummary): boolean => scanSummarySentence(summary) === null;

// ---------------------------------------------------------------- existing systems (Phase 2.6 E2)

/** "A, B and C": the list join every sentence here shares. */
const joinParts = (parts: readonly string[]): string => {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

/** A location as the sheet names it: "design-system/", or "the project root" for ''. */
export const locationLabel = (path: string): string => (path === '' ? 'the project root' : `${path}/`);

export const MISSED_LINE = 'Design Chamber reads CSS and token JSON. Pages, components and themes written in code are left for the agent.';

/** MISSED_LINE plus what this scan saw but never parses; zero parts are left out. */
export const missedLine = (summary: ScanSummary): string => {
  const { pages, components, codeThemes } = summary.missed;
  const parts = [
    pages > 0 ? plural(pages, 'page') : null,
    components > 0 ? plural(components, 'component file') : null,
    codeThemes > 0 ? plural(codeThemes, 'theme in code', 'themes in code') : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? MISSED_LINE : `${MISSED_LINE} It saw ${joinParts(parts)}.`;
};

export const NO_CANDIDATES = 'No existing design system found in this project. Point at a folder yourself, or start from the code.';

export const NOTHING_IN_LOCATION = (folder: string): string =>
  `Design Chamber didn’t find token files in ${folder}. The agent can still read its page and docs and write the system.`;

/** What marks a candidate, in the service's mark order: "system.json, page, tokens, 3 docs". */
export const candidateMarkLine = (candidate: SystemCandidate): string => {
  const has = (mark: SystemCandidate['marks'][number]): boolean => candidate.marks.includes(mark);
  const words: string[] = [];
  if (has('contract')) words.push('system.json');
  if (has('page')) words.push('page');
  if (has('tokens')) words.push(candidate.marks.length === 1 ? 'token files' : 'tokens');
  if (has('docs')) words.push(plural(candidate.counts.docs, 'doc'));
  if (has('components')) words.push(plural(candidate.counts.components, 'component'));
  if (has('theme')) words.push('theme');
  if (has('docs') && !has('tokens')) words.push('no token files');
  return words.join(', ');
};

/** A candidate's counts, or its registered system, or "Nothing to parse". */
export const candidateCountLine = (candidate: SystemCandidate): string => {
  if (candidate.registered !== null) return `Already in Design Chamber as ${candidate.registered.name}`;
  const parts = [
    candidate.counts.colours > 0 ? plural(candidate.counts.colours, 'colour') : null,
    candidate.counts.tokens > 0 ? plural(candidate.counts.tokens, 'token') : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Nothing to parse' : parts.join(' · ');
};

export const candidatesNote = (total: number): string => `${plural(total, 'place')} found`;

export const candidatesMoreLine = (more: number): string => `and ${more} more. Type a folder below to use another.`;

export const nudgeLine = (candidate: SystemCandidate): string =>
  `This project already has a design system in ${locationLabel(candidate.path)}. Start from it instead?`;

/** The page, docs and component files a location leaves for the agent; null when there are none. */
export const leftForAgentLine = (location: LocationView): string | null => {
  const parts = [
    ...location.read.page,
    location.read.docs.length > 0 ? plural(location.read.docs.length, 'doc') : null,
    location.read.components.length > 0 ? plural(location.read.components.length, 'component file') : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `Left for the agent: ${joinParts(parts)}.`;
};

/** "Files read (N)": the files the scan actually opened, not only the ones that held values. */
export const filesReadLabel = (summary: ScanSummary): string => `Files read (${summary.read})`;

/** The rest of the read files, the ones with no values; null when every read file held values. */
export const filesReadMore = (summary: ScanSummary): string | null => {
  const more = Math.max(0, summary.read - summary.files.length);
  return more === 0 ? null : `and ${more} more with no values.`;
};

/**
 * Why a location's contract can't be registered as it is. The service names each gap; a gap that is a file name
 * reads "… is missing", a sentence stands on its own, and the project root gets its own line (it needs a folder).
 */
export const contractProblemLine = (missing: readonly string[]): string => {
  if (missing.includes('a folder inside the project')) {
    return 'The project root can’t be registered as it is. A registered system needs its own folder inside the project. Make a new system from it instead.';
  }
  const clauses = missing.map((gap) => {
    if (gap === 'system.json' || gap === 'tokens.css') return `${gap} is missing`;
    if (gap === 'a folder path of up to four folders without spaces') return 'its folder path must be up to four folders without spaces';
    if (gap === 'a folder Design Chamber can read in full') return 'Design Chamber can’t read the whole folder';
    return gap;
  });
  return `This folder has a system.json but ${joinParts(clauses)}, so it can’t be registered as it is. Make a new system from it instead.`;
};

export const LOOKING_LABEL = (project: string): string => `Looking for a design system in ${project}…`;

export const DISCOVERY_IDLE = 'Choose a project and Design Chamber looks for a design system in it. Nothing in it is changed.';

export const LOCATION_HELPER = (project: string): string => `A folder inside ${project}. Design Chamber only reads it.`;

export const LOCATION_IDLE = 'Pick a folder and Design Chamber reads its token files. Nothing in it is changed.';

export const LOCATION_FAILED_HINT = 'The folder wasn’t read. The path field says why.';

export const REGISTER_CHOICE_LABEL = 'Register it as it is';

export const MAKE_CHOICE_LABEL = 'Make a new system from it';

export const REGISTER_HINT = (project: string): string =>
  `This folder already holds a complete system in Design Chamber’s format. It is registered read-only and opens as a Draft for review. Nothing is written to ${project} and the agent isn’t asked.`;

export const MAKE_FROM_HINT = 'Design Chamber reads the tokens and the agent writes the overview, notes and components. The new system lives in Design Chamber.';

export const AGENT_DISABLED_HINT = 'Only needed when the agent writes the system. Registering it sends no request.';

export const REPO_UNTOUCHED_LINE = 'Your repository stays exactly as it is.';

export const NAME_SUGGESTED_HELPER = 'Suggested from the project. Change it if you like.';

export const REGISTER_TOAST = (name: string, project: string): string => `Registered ${name} from ${project}. Review it, then mark it ready.`;

// ---------------------------------------------------------------- the whole draft

export type ScanState =
  | { state: 'idle' }
  | { state: 'running'; directory: string; seen: number }
  | { state: 'done'; directory: string; scanId: string; summary: ScanSummary }
  | { state: 'failed'; directory: string; message: string };

/** The location scan of the Existing design system start (Phase 2.6 §6.6): a second job rooted at the folder. */
export type LocationScanState =
  | { state: 'idle' }
  | { state: 'running'; path: string }
  | { state: 'done'; path: string; scanId: string; summary: ScanSummary }
  | { state: 'failed'; path: string; message: string };

/** The sheet's two scans: the project's (code values and discovery) and the chosen location's. */
export type SheetScans = { project: ScanState; location: LocationScanState };

export type DraftInput = {
  name: string;
  sources: Readonly<Record<SourceId, boolean>>;
  scan: SheetScans;
  brand: { files: readonly PickedFile[]; folder: string };
  description: string;
  /** A bundled style preset id, or '' for none. */
  preset: string;
};

/** Where Make design system found a problem and what to say there. `null` field: the one line above the buttons. */
export type DraftProblem = { field: 'name' | 'code' | 'existing' | 'brand' | 'description'; message: string };

/** Everything that stops Make, first problem first. Empty means it can be made. Checked on press, not by a greyed-out button. */
export const draftProblems = (draft: DraftInput, existing: ReadonlyArray<{ name: string }>): DraftProblem[] => {
  const problems: DraftProblem[] = [];
  const name = systemNameProblem(draft.name, existing);
  if (name !== null) problems.push({ field: 'name', message: name });
  if (draft.sources.code) {
    if (draft.scan.project.state === 'idle') problems.push({ field: 'code', message: 'Pick the project to read, or untick Project code.' });
    else if (draft.scan.project.state === 'running') problems.push({ field: 'code', message: 'Wait for the scan to finish, or cancel it and untick Project code.' });
    else if (draft.scan.project.state === 'failed') problems.push({ field: 'code', message: 'Pick a folder Design Chamber can read, or untick Project code.' });
  }
  if (draft.sources.existing) {
    const { project, location } = draft.scan;
    if (project.state === 'idle') problems.push({ field: 'existing', message: 'Pick the project to read, or untick Existing design system.' });
    else if (project.state === 'running') problems.push({ field: 'existing', message: 'Wait for Design Chamber to look through the project.' });
    if (location.state === 'idle') problems.push({ field: 'existing', message: 'Pick where the system lives, or type its folder.' });
    else if (location.state === 'running') problems.push({ field: 'existing', message: 'Wait for Design Chamber to read that folder.' });
    else if (location.state === 'failed') problems.push({ field: 'existing', message: location.message });
  }
  if (draft.sources.brand) {
    if (draft.brand.files.length === 0 && draft.brand.folder.trim() === '') problems.push({ field: 'brand', message: 'Add brand files, or untick Brand files.' });
    else if (draft.brand.folder.trim() !== '') {
      const folder = folderPathProblem(draft.brand.folder);
      if (folder !== null) problems.push({ field: 'brand', message: folder });
    }
  }
  if (draft.sources.description && draft.description.length > DESCRIPTION_MAX) {
    problems.push({ field: 'description', message: `Keep the description to ${DESCRIPTION_MAX.toLocaleString('en-US')} characters or fewer.` });
  } else if (draft.sources.description && draft.description.trim() === '' && draft.preset === '') {
    problems.push({ field: 'description', message: 'Describe the look you want, pick a style preset, or untick A description.' });
  }
  return problems;
};

/** Characters of a description the service takes (`POST /systems`). */
export const DESCRIPTION_MAX = 2000;

export const DESCRIPTION_PLACEHOLDER = 'e.g. Calm and confident for a bookkeeping app. Deep green and warm neutrals, a serif for headings, generous space.';

export const MAKE_LABEL = 'Make design system';

/** The footer's primary when "Register it as it is" is chosen (Phase 2.6 AD-10). */
export const REGISTER_LABEL = 'Register design system';

/** The sentence under the sheet's title. */
export const SHEET_SUBTITLE = 'Start it from what you already have. Nothing is made until you press the button below.';

/** After the system exists but not everything went through: what is still open, as a clause the headline and the toast share. */
export const resultClause = (refused: number, sent: boolean): string => {
  const files = refused === 1 ? '1 file wasn’t added' : `${refused} files weren’t added`;
  if (refused > 0 && !sent) return `${files} and the agent wasn’t asked`;
  if (refused > 0) return files;
  return 'the agent wasn’t asked';
};

/** The result view's first line: "2 files weren't added and the agent wasn't asked." */
export const resultHeadline = (refused: number, sent: boolean): string => {
  const clause = resultClause(refused, sent);
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
};

/** The toast when the sheet was closed before the work finished: "Acme is made, but 2 files weren't added." */
export const resultToast = (name: string, refused: number, sent: boolean): string => `${name} is made, but ${resultClause(refused, sent)}.`;
