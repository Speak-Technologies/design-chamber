// View-model of the New design system sheet (Phase 2.5 U1): the name rule, the three sources, what a brand file is
// and why one is refused, the scan's sentences and the one question "can it be made?". Pure: no DOM, no host calls.
// The service has the last word on every rule here (names, file types, sizes); this only says it early, in the
// same words, next to the field.

import type { ScanSummary } from '../../shared/api.ts';
import { SYSTEM_BYTES_MAX, SYSTEM_DOCUMENT_MAX_BYTES, SYSTEM_FILES_MAX, SYSTEM_FONT_MAX_BYTES, SYSTEM_IMAGE_MAX_BYTES, SYSTEM_NAME_MAX } from '../../shared/limits.ts';
import { plural } from './format.ts';

export type SourceId = 'code' | 'brand' | 'description';

/** The checkboxes under "Start from", in the order the sheet shows them. */
export const SOURCES: ReadonlyArray<{ id: SourceId; label: string; hint: string }> = [
  { id: 'code', label: 'Project code', hint: 'Read a project’s colours, type and components. The project isn’t changed.' },
  { id: 'brand', label: 'Brand files', hint: 'Fonts, logos and brand documents you already have.' },
  { id: 'description', label: 'A description', hint: 'Say what it should look like, or start from a style preset.' },
];

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

export const skippedLine = (summary: ScanSummary): string | null =>
  summary.skipped.length + summary.refused === 0 ? null : `${plural(summary.skipped.length + summary.refused, 'file')} skipped (too large, secret or unreadable).`;

/** A scan that found nothing usable: no counts and no assets. */
export const scanFoundNothing = (summary: ScanSummary): boolean => scanSummarySentence(summary) === null;

// ---------------------------------------------------------------- the whole draft

export type ScanState =
  | { state: 'idle' }
  | { state: 'running'; directory: string; seen: number }
  | { state: 'done'; directory: string; scanId: string; summary: ScanSummary }
  | { state: 'failed'; directory: string; message: string };

export type DraftInput = {
  name: string;
  sources: Readonly<Record<SourceId, boolean>>;
  scan: ScanState;
  brand: { files: readonly PickedFile[]; folder: string };
  description: string;
  /** A bundled style preset id, or '' for none. */
  preset: string;
};

/** Where Make design system found a problem and what to say there. `null` field: the one line above the buttons. */
export type DraftProblem = { field: 'name' | 'code' | 'brand' | 'description'; message: string };

/** Everything that stops Make, first problem first. Empty means it can be made. Checked on press, not by a greyed-out button. */
export const draftProblems = (draft: DraftInput, existing: ReadonlyArray<{ name: string }>): DraftProblem[] => {
  const problems: DraftProblem[] = [];
  const name = systemNameProblem(draft.name, existing);
  if (name !== null) problems.push({ field: 'name', message: name });
  if (draft.sources.code) {
    if (draft.scan.state === 'idle') problems.push({ field: 'code', message: 'Pick the project to read, or untick Project code.' });
    else if (draft.scan.state === 'running') problems.push({ field: 'code', message: 'Wait for the scan to finish, or cancel it and untick Project code.' });
    else if (draft.scan.state === 'failed') problems.push({ field: 'code', message: 'Pick a folder Design Chamber can read, or untick Project code.' });
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

/** The sentence under the sheet's title. */
export const SHEET_SUBTITLE = 'Starts as a draft you review. Your chat agent writes the notes and components.';

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
