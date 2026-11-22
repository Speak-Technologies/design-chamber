// Existing-system discovery (documentation/specs/phase-2-6-technical.md §5.5, AD-7, AD-12): which
// folders of a project look like a design system it already has, and what a chosen folder holds.
//
// Pure and path-only: the inputs are the scan's own walk (secret names already dropped, links never
// listed, node_modules / build output / dot folders never walked) and the tokens the scan already
// extracted. Nothing here opens a file, stats a path or reaches the network, so discovery can never
// read more of a repo than the Code scan does. Paths a repo chose are untrusted text: a candidate
// whose path is long or holds a control character is left out (it could not be typed back anyway).

import path from 'node:path';

import type { CandidateMark, LocationView, SystemCandidate } from '../../shared/api.ts';
import { LOCATION_READ_LIST_MAX, SYSTEM_CANDIDATES_MAX } from '../../shared/limits.ts';
import type { TokenSection } from '../../shared/types.ts';
import { bySpot } from '../discovery.ts';
import { samePath } from '../paths.ts';
import { isCssFile, isTokenJsonFile } from './extract-rules.ts';

/** A folder named like a design system (any segment of a path). */
export const SYSTEM_FOLDER = /^(design[-_]?systems?|style[-_]?guides?|ui[-_]?kit)$/i;
/**
 * A page directly in a system folder (`app/design-system/page.tsx`, `public/design-system/index.html`).
 * Plain `.md` is a doc, not a page (`design-system.md` is the docs rule's); `.mdx` routes are pages.
 */
const PAGE_IN_SYSTEM = /^(index|page|\+page|route)\.(html?|tsx|jsx|ts|js|vue|svelte|astro|mdx)$/i;
/** A page anywhere named after the system (`src/pages/design-system.tsx`, `styleguide.html`). */
const PAGE_ANYWHERE = /^(design[-_]?system|style[-_]?guide)\.(html?|tsx|jsx|vue|svelte|astro|mdx)$/i;
const TOKEN_CSS = /^(tokens|theme|variables|vars|design-tokens)\.css$/i;
const THEME_FILE = /^(theme\.(ts|js|mjs|cjs)|tailwind\.config\.[a-z]+)$/i;
const COMPONENT_FILE = /\.(tsx|jsx|vue|svelte|html)$/i;
const DOC_FILE = /\.mdx?$/i;
/** A design doc by name: discovery's names (`DESIGN.md`, `docs/design*`, `styleguide.md`) plus `design-system*.md`. */
const NAMED_DOC = /^(design\.md|design-system.*\.mdx?|styleguide\.md)$/i;
/** A doc that marks a system on its own (§5.5 "Qualifies"). */
const STRONG_DOC = /^(design\.md|design-system.*\.mdx?)$/i;
/** A CSS file that yielded this many tokens counts as a token file whatever its name. */
const CSS_TOKENS_MIN = 5;
/** Characters of a candidate path; longer ones are not offered. */
export const CANDIDATE_PATH_MAX = 200;

// For the missed line (§5.7): pages, components and themes written in code the scan never parses.
const CODE_PAGE = /^(page|\+page|route)\.(tsx|jsx|ts|js|svelte|mdx?)$/i;
const PAGE_DIR_FILE = /\.(tsx|jsx|vue|svelte|astro|mdx?)$/i;
const CODE_THEME = /^(theme\.(ts|js|mjs|cjs)|tailwind\.config\.[a-z]+|.+\.styles\.(ts|js)|styled.*\.ts)$/i;

const MARK_ORDER: readonly CandidateMark[] = ['contract', 'page', 'tokens', 'docs', 'components', 'theme'];

const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);
const dirOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const depthOf = (rel: string): number => (rel === '' ? 0 : rel.split('/').length);
/** `rel` relative to `folder` ('' = the project root), or null when it is not under it. */
const under = (folder: string, rel: string): string | null => (folder === '' ? rel : rel.startsWith(`${folder}/`) ? rel.slice(folder.length + 1) : null);
const hasControl = (value: string): boolean => /[\u0000-\u001f\u007f]/.test(value);

/** The deepest folder of `rel` named like a system, or null. */
const systemAncestor = (rel: string): string | null => {
  const segments = rel.split('/').slice(0, -1);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment !== undefined && SYSTEM_FOLDER.test(segment)) return segments.slice(0, index + 1).join('/');
  }
  return null;
};

export type CandidateToken = { file: string; section: TokenSection };

/** Tokens per file, and colours per file, from what the scan extracted. */
const tokenCounts = (tokens: readonly CandidateToken[]): { all: Map<string, number>; colours: Map<string, number> } => {
  const all = new Map<string, number>();
  const colours = new Map<string, number>();
  for (const token of tokens) {
    all.set(token.file, (all.get(token.file) ?? 0) + 1);
    if (token.section === 'colours') colours.set(token.file, (colours.get(token.file) ?? 0) + 1);
  }
  return { all, colours };
};

/** A token file by name, or a CSS file the scan found enough tokens in. */
const isTokenFile = (rel: string, perFile: ReadonlyMap<string, number>): boolean =>
  isTokenJsonFile(rel) || TOKEN_CSS.test(baseOf(rel)) || (isCssFile(rel) && (perFile.get(rel) ?? 0) >= CSS_TOKENS_MIN);

/** What one folder holds, classified. `files` are relative to the folder; `system` = a system or contract folder. */
type Holding = { pages: string[]; docs: string[]; components: string[]; tokenFiles: string[]; themes: string[]; strongDoc: boolean; tokens: number; colours: number };

const classify = (folder: string, files: readonly string[], system: boolean, counts: ReturnType<typeof tokenCounts>): Holding => {
  const held: Holding = { pages: [], docs: [], components: [], tokenFiles: [], themes: [], strongDoc: false, tokens: 0, colours: 0 };
  for (const inner of files) {
    const rel = folder === '' ? inner : `${folder}/${inner}`;
    const base = baseOf(inner);
    const direct = !inner.includes('/');
    if ((system && direct && PAGE_IN_SYSTEM.test(base)) || PAGE_ANYWHERE.test(base)) held.pages.push(rel);
    if (system ? DOC_FILE.test(base) : NAMED_DOC.test(base) || (rel.toLowerCase().startsWith('docs/design') && DOC_FILE.test(base))) {
      held.docs.push(rel);
      if (STRONG_DOC.test(base)) held.strongDoc = true;
    }
    if (system && inner.startsWith('components/') && COMPONENT_FILE.test(base)) held.components.push(rel);
    if (isTokenFile(rel, counts.all)) held.tokenFiles.push(rel);
    if (THEME_FILE.test(base)) held.themes.push(rel);
    held.tokens += counts.all.get(rel) ?? 0;
    held.colours += counts.colours.get(rel) ?? 0;
  }
  return held;
};

const marksOf = (held: Holding, contract: boolean): CandidateMark[] => {
  const marks = new Set<CandidateMark>();
  if (contract) marks.add('contract');
  if (held.pages.length > 0) marks.add('page');
  if (held.tokenFiles.length > 0) marks.add('tokens');
  if (held.docs.length > 0) marks.add('docs');
  if (held.components.length > 0) marks.add('components');
  if (held.themes.length > 0) marks.add('theme');
  return MARK_ORDER.filter((mark) => marks.has(mark));
};

/** Folders that directly hold both `system.json` and `tokens.css` (Design Chamber's file contract). */
const contractFolders = (files: readonly string[]): Set<string> => {
  const all = new Set(files);
  const out = new Set<string>();
  for (const rel of files) {
    if (baseOf(rel) !== 'system.json') continue;
    const folder = dirOf(rel);
    if (all.has(folder === '' ? 'tokens.css' : `${folder}/tokens.css`)) out.add(folder);
  }
  return out;
};

export type RegisteredSystem = { id: string; name: string; /** The system's repo folder or code folder, absolute. */ abs: string };

export type CandidateInput = {
  /** The walk's project-relative files (`/`), secret names already dropped. */
  files: readonly string[];
  tokens: readonly CandidateToken[];
  registered: readonly RegisteredSystem[];
  /** The project's realpath: candidates are compared with registered systems under it. */
  root: string;
  /** Test seam: the path comparison (defaults to the platform's `samePath`). */
  same?: (a: string, b: string) => boolean;
};

/**
 * §5.5: the folders that look like an existing design system, ranked (contract 4, page 3, a system
 * folder name 2, docs with tokens or a named design doc 1; then shallower first, then by path), at
 * most `SYSTEM_CANDIDATES_MAX`, and how many qualified in all.
 */
export const findSystemCandidates = (input: CandidateInput): { candidates: SystemCandidate[]; total: number } => {
  const same = input.same ?? ((a: string, b: string): boolean => samePath(a, b));
  const counts = tokenCounts(input.tokens);
  const contracts = contractFolders(input.files);

  // Every file goes to the deepest system-named folder above it, else (and also) to each contract
  // folder above it; a file under neither goes to its own folder, directly.
  type Group = { folder: string; system: boolean; contract: boolean; files: string[] };
  const groups = new Map<string, Group>();
  const groupOf = (folder: string, system: boolean): Group => {
    let group = groups.get(folder);
    if (group === undefined) {
      group = { folder, system, contract: contracts.has(folder), files: [] };
      groups.set(folder, group);
    }
    group.system ||= system;
    return group;
  };
  for (const rel of input.files) {
    const named = systemAncestor(rel);
    if (named !== null) {
      const inner = under(named, rel);
      if (inner !== null) groupOf(named, true).files.push(inner);
    }
    let inContract = false;
    for (const folder of contracts) {
      if (folder === '' || folder === named) continue;
      const inner = under(folder, rel);
      if (inner === null) continue;
      groupOf(folder, true).files.push(inner);
      inContract = true;
    }
    // A root contract only marks the root folder: its files are the root's direct children.
    if (named === null && !inContract) groupOf(dirOf(rel), false).files.push(baseOf(rel));
  }

  type Ranked = { candidate: SystemCandidate; rank: number };
  const ranked: Ranked[] = [];
  for (const group of groups.values()) {
    if (group.folder.length > CANDIDATE_PATH_MAX || hasControl(group.folder)) continue;
    const held = classify(group.folder, group.files, group.system, counts);
    const systemName = group.folder !== '' && SYSTEM_FOLDER.test(baseOf(group.folder));
    const docsAndTokens = held.docs.length > 0 && held.tokenFiles.length > 0;
    const qualifies = group.contract || held.pages.length > 0 || systemName || held.strongDoc || docsAndTokens;
    if (!qualifies) continue;
    const rank = group.contract ? 4 : held.pages.length > 0 ? 3 : systemName ? 2 : 1;
    const abs = path.join(input.root, ...group.folder.split('/').filter((part) => part !== ''));
    const hit = input.registered.find((system) => same(system.abs, abs));
    ranked.push({
      rank,
      candidate: {
        path: group.folder,
        marks: marksOf(held, group.contract),
        counts: { colours: held.colours, tokens: held.tokens, docs: held.docs.length, components: held.components.length, pages: held.pages.length },
        strong: rank >= 2,
        registered: hit === undefined ? null : { id: hit.id, name: hit.name },
      },
    });
  }
  // A plain candidate inside a system or contract folder candidate is part of it (its files are
  // already counted there); a contract folder inside a system folder stays its own place to register.
  const folders = ranked.filter((one) => one.rank >= 2 && one.candidate.path !== '').map((one) => one.candidate.path);
  const kept = ranked.filter((one) => one.rank >= 2 || !folders.some((folder) => under(folder, one.candidate.path) !== null && folder !== one.candidate.path));
  kept.sort((a, b) => b.rank - a.rank || depthOf(a.candidate.path) - depthOf(b.candidate.path) || (a.candidate.path < b.candidate.path ? -1 : a.candidate.path > b.candidate.path ? 1 : 0));
  return { candidates: kept.slice(0, SYSTEM_CANDIDATES_MAX).map((one) => one.candidate), total: kept.length };
};

/**
 * §5.7 `missed`: what the walk saw that Design Chamber never parses (it reads CSS and token JSON):
 * pages written in code (route files, HTML and Astro pages, files under `pages/` or `routes/`),
 * component files (under a `components` folder) and themes in code.
 */
export const missedCounts = (files: readonly string[]): { pages: number; components: number; codeThemes: number } => {
  let pages = 0;
  let components = 0;
  let codeThemes = 0;
  for (const rel of files) {
    const base = baseOf(rel);
    const folders = rel.split('/').slice(0, -1).map((part) => part.toLowerCase());
    const inComponents = folders.includes('components');
    if (inComponents && COMPONENT_FILE.test(base)) components += 1;
    else if (CODE_PAGE.test(base) || PAGE_ANYWHERE.test(base) || /\.(html?|astro)$/i.test(base) || ((folders.includes('pages') || folders.includes('routes')) && PAGE_DIR_FILE.test(base))) pages += 1;
    if (CODE_THEME.test(base)) codeThemes += 1;
  }
  return { pages, components, codeThemes };
};

/**
 * §5.7 `location`: what a chosen folder holds, read as a system folder. `files` and the tokens'
 * files are relative to the location; `location` is its project-relative path ('' = the project
 * root), which prefixes every listed path. `contract` is filled in by the job.
 */
export const locationView = (input: { location: string; files: readonly string[]; tokens: readonly CandidateToken[] }): Omit<LocationView, 'contract'> => {
  const counts = tokenCounts(input.tokens);
  const held = classify('', input.files, true, counts);
  const contract = input.files.includes('system.json') && input.files.includes('tokens.css');
  const projectRel = (rel: string): string => (input.location === '' ? rel : `${input.location}/${rel}`);
  const list = (rels: readonly string[]): string[] => [...rels].sort(bySpot).slice(0, LOCATION_READ_LIST_MAX).map(projectRel);
  return {
    path: input.location,
    marks: marksOf(held, contract),
    read: { page: list(held.pages), docs: list(held.docs), components: list(held.components) },
  };
};
