// View-model of the designs list (rail R1, page P1): search, tabs, sort and the facts a row shows.

import { FOLDER_ID_PATTERN, FOLDER_NAME_MAX, FOLDERS_MAX, SYSTEM_ID_PATTERN } from '../../shared/limits.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import type { DesignKind, DesignSummary, SystemSummary } from '../../shared/types.ts';
import { plural } from './format.ts';

export type ListTab = 'all' | 'canvas' | 'page';
export type ListSort = 'updated' | 'created' | 'title';

export const LIST_TABS: ReadonlyArray<{ id: ListTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'canvas', label: 'Canvases' },
  { id: 'page', label: 'Pages' },
];

export const LIST_SORTS: ReadonlyArray<{ id: ListSort; label: string }> = [
  { id: 'updated', label: 'Updated' },
  { id: 'created', label: 'Created' },
  { id: 'title', label: 'Title' },
];

export const kindLabel = (kind: DesignKind): string => (kind === 'canvas' ? 'Canvas' : 'Page');

const matchesQuery = (design: DesignSummary, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return design.title.toLowerCase().includes(needle) || design.slug.toLowerCase().includes(needle);
};

const matchesTab = (design: DesignSummary, tab: ListTab): boolean => tab === 'all' || design.kind === tab;

export const filterDesigns = (designs: readonly DesignSummary[], query: string, tab: ListTab): DesignSummary[] =>
  designs.filter((design) => matchesTab(design, tab) && matchesQuery(design, query));

/** Counts per tab for the current search, so a tab never promises rows the search hides. */
export const tabCounts = (designs: readonly DesignSummary[], query: string): Record<ListTab, number> => {
  const searched = designs.filter((design) => matchesQuery(design, query));
  return {
    all: searched.length,
    canvas: searched.filter((design) => design.kind === 'canvas').length,
    page: searched.filter((design) => design.kind === 'page').length,
  };
};

export const sortDesigns = (designs: readonly DesignSummary[], sort: ListSort): DesignSummary[] => {
  const copy = [...designs];
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  const key = sort === 'created' ? 'created' : 'updated';
  return copy.sort((a, b) => Date.parse(b[key]) - Date.parse(a[key]));
};

/** "Canvas · 3 screens" or "Page": the kind line of a row, without the time. */
export const kindSummary = (design: DesignSummary): string => {
  if (design.kind === 'page') return 'Page';
  return `Canvas · ${plural(design.screenCount, 'screen')}`;
};

/** Plain sentence for the row's accessible name. */
export const rowAriaLabel = (design: DesignSummary): string => {
  const parts = [design.title, kindSummary(design)];
  if (design.pending) parts.push('waiting for the agent');
  if (design.openComments > 0) parts.push(plural(design.openComments, 'open comment'));
  if (systemUpdated(design)) parts.push(SYSTEM_UPDATED_LABEL);
  return parts.join(', ');
};

/** The badge on a row or card whose design system has a newer revision than the design's copy (Phase 2.5 U4). */
export const SYSTEM_UPDATED_LABEL = 'System updated';
export const systemUpdated = (design: Pick<DesignSummary, 'system'>): boolean => design.system?.updateAvailable === true;

// ---- Projects and folders (Phase 2.5 G1, technical design §9.5) ----
//
// Two ways to group the same list, and neither moves anything on disk:
// - projects: automatic, from `DesignSummary.projectDirectory` (a design made for a project folder);
// - folders: the user's own labels from the `/folders` routes; a design can sit in several.
// One `ListScope` picks one group (or none); search, tab and sort then work inside it.

export type ListScope = { kind: 'all' } | { kind: 'project'; directory: string } | { kind: 'no-project' } | { kind: 'folder'; id: string };

export const ALL_SCOPE: ListScope = { kind: 'all' };

/** The part of a folder the list needs (a `FolderView` fits). */
export type FolderLite = { id: string; name: string; slugs: readonly string[] };

/** One project the host knows (`listProjects`), for its display name. */
export type ProjectInfo = { directory: string; name: string };

export type ProjectGroup = {
  /** The first design's spelling of the folder; a stored scope matches by `sameDirectory`, not by this string. */
  directory: string;
  label: string;
  /** The full path, for the tooltip. */
  title: string;
  count: number;
  /** The folder is gone from disk: the designs still group, and the tooltip says so. */
  missing: boolean;
};

const normalizeDirectory = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
const isWindowsDirectory = (value: string): boolean => /^[A-Za-z]:\//.test(value);

/** `dir` is `root` or lies inside it; either slash, no trailing separator, case-folded for Windows paths (as `sameDirectory`). */
const isInsideOrEqualDirectory = (root: string, dir: string): boolean => {
  const left = normalizeDirectory(root);
  const right = normalizeDirectory(dir);
  const windows = isWindowsDirectory(left) || isWindowsDirectory(right);
  const a = windows ? left.toLowerCase() : left;
  const b = windows ? right.toLowerCase() : right;
  return b === a || b.startsWith(`${a}/`);
};

const baseName = (directory: string): string => {
  const parts = normalizeDirectory(directory).split('/').filter((part) => part !== '');
  return parts[parts.length - 1] ?? directory;
};

const parentName = (directory: string): string => {
  const parts = normalizeDirectory(directory).split('/').filter((part) => part !== '');
  return parts[parts.length - 2] ?? '';
};

/**
 * The project folder a design belongs to, or null: none recorded, or the folder is the designs folder itself or inside it
 * (a chat opened there), which counts as No project.
 */
export const projectOf = (design: Pick<DesignSummary, 'projectDirectory'>, designsRoot: string): string | null => {
  const directory = design.projectDirectory;
  if (directory === null || directory.trim() === '') return null;
  if (designsRoot !== '' && isInsideOrEqualDirectory(designsRoot, directory)) return null;
  return directory;
};

/** One row per project folder that has designs, labelled by the host's project name or the folder's base name. */
export const projectGroups = (
  designs: readonly DesignSummary[],
  projects: readonly ProjectInfo[],
  designsRoot: string,
  projectFolders: ReadonlyArray<{ directory: string; exists: boolean }> | undefined,
): ProjectGroup[] => {
  const groups: ProjectGroup[] = [];
  for (const design of designs) {
    const directory = projectOf(design, designsRoot);
    if (directory === null) continue;
    const found = groups.find((group) => sameDirectory(group.directory, directory));
    if (found) {
      found.count += 1;
      continue;
    }
    const named = projects.find((project) => sameDirectory(project.directory, directory))?.name.trim();
    const stat = projectFolders?.find((entry) => sameDirectory(entry.directory, directory));
    groups.push({ directory, label: named ? named : baseName(directory), title: directory, count: 1, missing: stat !== undefined && !stat.exists });
  }
  // Two projects with the same name tell apart by their parent folder: "app · work", "app · personal".
  const seen = new Map<string, number>();
  for (const group of groups) seen.set(group.label.toLowerCase(), (seen.get(group.label.toLowerCase()) ?? 0) + 1);
  const named = groups.map((group) => {
    const parent = parentName(group.directory);
    return (seen.get(group.label.toLowerCase()) ?? 0) > 1 && parent !== '' ? { ...group, label: `${group.label} · ${parent}` } : group;
  });
  return named.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
};

/** The group a design sits in, matched by `sameDirectory`. */
export const groupOf = (design: Pick<DesignSummary, 'projectDirectory'>, groups: readonly ProjectGroup[], designsRoot: string): ProjectGroup | null => {
  const directory = projectOf(design, designsRoot);
  if (directory === null) return null;
  return groups.find((group) => sameDirectory(group.directory, directory)) ?? null;
};

/** The designs one scope shows. Folders count a slug only when that design is in the list (a pruned name never shows). */
export const scopeDesigns = (designs: readonly DesignSummary[], scope: ListScope, folders: readonly FolderLite[], designsRoot: string): DesignSummary[] => {
  switch (scope.kind) {
    case 'all':
      return [...designs];
    case 'no-project':
      return designs.filter((design) => projectOf(design, designsRoot) === null);
    case 'project':
      return designs.filter((design) => {
        const directory = projectOf(design, designsRoot);
        return directory !== null && sameDirectory(directory, scope.directory);
      });
    case 'folder': {
      const members = new Set(folders.find((folder) => folder.id === scope.id)?.slugs ?? []);
      return designs.filter((design) => members.has(design.slug));
    }
  }
};

export type ScopeCounts = { all: number; noProject: number; folders: Record<string, number> };

/** Counts for the sidebar and the Show select. */
export const scopeCounts = (designs: readonly DesignSummary[], folders: readonly FolderLite[], designsRoot: string): ScopeCounts => {
  const live = new Set(designs.map((design) => design.slug));
  const counts: Record<string, number> = {};
  for (const folder of folders) counts[folder.id] = new Set(folder.slugs.filter((slug) => live.has(slug))).size;
  return { all: designs.length, noProject: designs.filter((design) => projectOf(design, designsRoot) === null).length, folders: counts };
};

/** The scope's name for a sentence ("shop", "Launch"); null for All designs. */
export const scopeLabel = (scope: ListScope, groups: readonly ProjectGroup[], folders: readonly FolderLite[]): string | null => {
  switch (scope.kind) {
    case 'all':
      return null;
    case 'no-project':
      return 'No project';
    case 'project':
      return groups.find((group) => sameDirectory(group.directory, scope.directory))?.label ?? baseName(scope.directory);
    case 'folder':
      return folders.find((folder) => folder.id === scope.id)?.name ?? null;
  }
};

/** A scope that names a project or folder that is gone falls back to All designs (the stored choice is left alone). */
export const resolveScope = (scope: ListScope, groups: readonly ProjectGroup[], folders: readonly FolderLite[]): ListScope => {
  if (scope.kind === 'project') return groups.some((group) => sameDirectory(group.directory, scope.directory)) ? scope : ALL_SCOPE;
  if (scope.kind === 'folder') return folders.some((folder) => folder.id === scope.id) ? scope : ALL_SCOPE;
  return scope;
};

export const sameScope = (a: ListScope, b: ListScope): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project' && b.kind === 'project') return sameDirectory(a.directory, b.directory);
  if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
  return true;
};

/** The empty folder's sentence; the rail has nothing to drag onto, so it only names the menu. */
export const folderEmptyBody = (draggable: boolean): string =>
  draggable ? 'Drag designs here, or use Add to folder in a design’s menu.' : 'Use Add to folder in a design’s menu.';

export type ProjectLine = { label: string; title: string };

/** The project name under a card's title, unless the list is already that project. */
export const cardProjectLine = (design: Pick<DesignSummary, 'projectDirectory'>, scope: ListScope, groups: readonly ProjectGroup[], designsRoot: string): ProjectLine | null => {
  const group = groupOf(design, groups, designsRoot);
  if (group === null) return null;
  if (scope.kind === 'project' && sameDirectory(scope.directory, group.directory)) return null;
  return { label: group.label, title: group.missing ? `${group.title}\nFolder not found` : group.title };
};

// -- The remembered view (host.storage `list-scope:<surface>`) --

export const scopeStorageKey = (surface: 'panel' | 'page'): string => `list-scope:${surface}`;

/** One string per scope: the select's option id and the stored value. */
export const scopeToId = (scope: ListScope): string => {
  switch (scope.kind) {
    case 'all':
      return 'all';
    case 'no-project':
      return 'no-project';
    case 'project':
      return `project:${scope.directory}`;
    case 'folder':
      return `folder:${scope.id}`;
  }
};

const SCOPE_ID_MAX = 1024;

/** Reads a stored or selected id back; anything unknown or malformed is All designs. */
export const scopeFromId = (raw: unknown): ListScope => {
  if (typeof raw !== 'string' || raw.length > SCOPE_ID_MAX) return ALL_SCOPE;
  if (raw === 'no-project') return { kind: 'no-project' };
  if (raw.startsWith('project:') && raw.length > 'project:'.length) return { kind: 'project', directory: raw.slice('project:'.length) };
  if (raw.startsWith('folder:') && FOLDER_ID_PATTERN.test(raw.slice('folder:'.length))) return { kind: 'folder', id: raw.slice('folder:'.length) };
  return ALL_SCOPE;
};

export type ScopeOption = { id: string; label: string; hint: string };

/** The Show select's entries: All designs, each project, No project (only when there are some), each folder. */
export const scopeOptions = (groups: readonly ProjectGroup[], counts: ScopeCounts, folders: readonly FolderLite[]): ScopeOption[] => [
  { id: 'all', label: 'All designs', hint: String(counts.all) },
  ...groups.map((group) => ({ id: scopeToId({ kind: 'project', directory: group.directory }), label: group.label, hint: String(group.count) })),
  ...(counts.noProject > 0 ? [{ id: 'no-project', label: 'No project', hint: String(counts.noProject) }] : []),
  ...folders.map((folder) => ({ id: scopeToId({ kind: 'folder', id: folder.id }), label: `Folder · ${folder.name}`, hint: String(counts.folders[folder.id] ?? 0) })),
];

// -- Folder names, checked before the request so the fix shows next to the field --
// The service checks the same rules (src/service/folders.ts) and its sentences are used verbatim.

// Control characters (C0, DEL, C1) and the line and paragraph separators: the service's rule (src/service/folders.ts).
const FOLDER_NAME_CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'u');

/** The first problem with a folder name, as the sentence to show, or null. `ignoreId`: the folder being renamed. */
export const folderNameProblem = (raw: string, folders: ReadonlyArray<Pick<FolderLite, 'id' | 'name'>>, ignoreId: string | null = null): string | null => {
  const name = raw.normalize('NFKC').trim();
  if (name.length === 0) return 'Give the folder a name.';
  if (FOLDER_NAME_CONTROL.test(name)) return "A folder name can't contain line breaks or tabs.";
  if (name.length > FOLDER_NAME_MAX) return `Keep the folder name to ${FOLDER_NAME_MAX} characters or fewer.`;
  const taken = folders.find((folder) => folder.id !== ignoreId && folder.name.toLowerCase() === name.toLowerCase());
  if (taken) return `You already have a folder called ${taken.name}.`;
  if (ignoreId === null && folders.length >= FOLDERS_MAX) return `You can have up to ${FOLDERS_MAX} folders.`;
  return null;
};

/** Folder facts the menus need for one design. */
export const foldersOfDesign = (slug: string, folders: readonly FolderLite[]): FolderLite[] => folders.filter((folder) => folder.slugs.includes(slug));

// ---- Library views, sort and the System filter (Phase 2.6 L1a, technical design §2.4, §6.4) ----
//
// View (page only) and sort (per surface) are remembered in host.storage; search, tab and the
// System filter live for the session only. Composition order: scope, System filter, search,
// tab counts, tab, sort. The empty state names every active filter and offers Clear filters,
// which clears search, tab and system but keeps the scope.

export type LibraryView = 'tiles' | 'list';

/** The page's view toggle; the rail is a list by nature and has no toggle. */
export const viewStorageKey = 'library-view:page';
export const sortStorageKey = (surface: 'panel' | 'page'): string => `list-sort:${surface}`;

/** Stored preferences read back; anything unknown or malformed falls back (Tiles, Updated). */
export const viewFromStored = (raw: unknown): LibraryView => (raw === 'list' ? 'list' : 'tiles');
export const sortFromStored = (raw: unknown): ListSort => (raw === 'created' || raw === 'title' ? raw : 'updated');

export type SystemFilter = { kind: 'all' } | { kind: 'none' } | { kind: 'system'; id: string };

export const ALL_SYSTEMS: SystemFilter = { kind: 'all' };

export const systemFilterToId = (filter: SystemFilter): string => {
  switch (filter.kind) {
    case 'all':
      return 'all';
    case 'none':
      return 'none';
    case 'system':
      return `system:${filter.id}`;
  }
};

/** Reads a select id back; anything unknown or malformed is All systems. */
export const systemFilterFromId = (raw: unknown): SystemFilter => {
  if (raw === 'none') return { kind: 'none' };
  if (typeof raw === 'string' && raw.startsWith('system:') && SYSTEM_ID_PATTERN.test(raw.slice('system:'.length))) return { kind: 'system', id: raw.slice('system:'.length) };
  return ALL_SYSTEMS;
};

/** A filter naming a system that is gone reads as All systems (the select shows it). */
export const resolveSystemFilter = (filter: SystemFilter, systems: readonly Pick<SystemSummary, 'id'>[]): SystemFilter =>
  filter.kind === 'system' && !systems.some((system) => system.id === filter.id) ? ALL_SYSTEMS : filter;

/** A deleted system counts as no system: the design keeps its own copy, but the link is gone. */
export const matchesSystem = (design: Pick<DesignSummary, 'system'>, filter: SystemFilter): boolean => {
  const link = design.system ?? null;
  const live = link !== null && link.state !== 'deleted' ? link : null;
  if (filter.kind === 'all') return true;
  if (filter.kind === 'none') return live === null;
  return live !== null && live.id === filter.id;
};

export type SystemOption = { id: string; label: string; hint?: string };

/** The System select's entries: All systems, each system by name (Draft or its used-by count), No system. */
export const systemOptions = (systems: readonly SystemSummary[]): SystemOption[] => [
  { id: 'all', label: 'All systems' },
  ...[...systems]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((system) => ({ id: systemFilterToId({ kind: 'system', id: system.id }), label: system.name, hint: system.status === 'draft' ? 'Draft' : String(system.usedBy) })),
  { id: 'none', label: 'No system' },
];

/** The project a system belongs to: its repo home, else its code source's project or folder. */
export const systemProjectOf = (summary: Pick<SystemSummary, 'home' | 'sources'>): string | null =>
  summary.home !== 'internal' ? summary.home.directory : summary.sources.code?.project ?? summary.sources.code?.directory ?? null;

/** Systems one scope shows. Folders hold designs, not systems. */
export const scopeSystems = (systems: readonly SystemSummary[], scope: ListScope): SystemSummary[] => {
  switch (scope.kind) {
    case 'all':
      return [...systems];
    case 'folder':
      return [];
    case 'no-project':
      return systems.filter((system) => systemProjectOf(system) === null);
    case 'project':
      return systems.filter((system) => {
        const directory = systemProjectOf(system);
        return directory !== null && sameDirectory(directory, scope.directory);
      });
  }
};

export type LibraryFilters = { query: string; tab: ListTab; system: SystemFilter };

/** Scope, then the System filter, then search, then tab counts, then tab, then sort (§6.4). */
export const libraryDesigns = (
  designs: readonly DesignSummary[],
  scope: ListScope,
  folders: readonly FolderLite[],
  designsRoot: string,
  filters: LibraryFilters,
  sort: ListSort,
): { scoped: DesignSummary[]; shown: DesignSummary[]; counts: Record<ListTab, number> } => {
  const scoped = scopeDesigns(designs, scope, folders, designsRoot);
  const systemed = scoped.filter((design) => matchesSystem(design, filters.system));
  const counts = tabCounts(systemed, filters.query);
  const shown = sortDesigns(filterDesigns(systemed, filters.query, filters.tab), sort);
  return { scoped, shown, counts };
};

/** One active filter in the empty state's chip row; the scope chip is fixed (Clear filters keeps it). */
export type EmptyChip = { id: 'scope' | 'search' | 'tab' | 'system'; label: string; fixed: boolean; icon?: 'folder' | 'layers' | 'page' };

export type LibraryEmpty = {
  kind: 'no-designs' | 'folder-empty' | 'no-matches';
  title: string;
  body: string;
  action: 'new' | 'show-all' | 'clear-filters';
  chips: EmptyChip[];
};

const systemNameOf = (filter: SystemFilter, systems: readonly Pick<SystemSummary, 'id' | 'name'>[]): string | null =>
  filter.kind === 'system' ? systems.find((system) => system.id === filter.id)?.name ?? null : null;

/**
 * "No designs in Q4 launch match “hero” with the Speak UI system." The approved canvas keeps the
 * generic noun in the sentence; the chip row names the exact tab. No search and no system: the
 * older "Nothing in … for this tab yet".
 */
export const noMatchesSentenceFor = (input: { scopeLabel: string | null; query: string; system: SystemFilter; systems: readonly Pick<SystemSummary, 'id' | 'name'>[] }): string => {
  const query = input.query.trim();
  const name = systemNameOf(input.system, input.systems);
  const systemPart = name !== null ? ` with the ${name} system` : input.system.kind === 'none' ? ' with no system' : '';
  const scopePart = input.scopeLabel === null ? '' : ` in ${input.scopeLabel}`;
  if (query === '' && systemPart === '') return input.scopeLabel === null ? 'Nothing in this tab yet' : `Nothing in ${input.scopeLabel} for this tab yet`;
  return `No designs${scopePart}${query === '' ? '' : ` match “${query}”`}${systemPart}.`;
};

/** Which empty state applies, with its copy and the active filters named. Null when rows show. */
export const emptyStateOf = (input: {
  all: readonly DesignSummary[];
  scoped: readonly DesignSummary[];
  shown: readonly DesignSummary[];
  scope: ListScope;
  scopeLabel: string | null;
  folderName: string | null;
  filters: LibraryFilters;
  systems: readonly Pick<SystemSummary, 'id' | 'name'>[];
  draggable: boolean;
}): LibraryEmpty | null => {
  if (input.shown.length > 0) return null;
  if (input.all.length === 0) {
    return {
      kind: 'no-designs',
      title: 'No designs yet',
      body: input.draggable
        ? 'Type /design or /page in any chat and describe what you want. Your agent writes the files and they show up here the moment they are saved.'
        : 'Type /design or /page in any chat and describe what you want. Your agent writes the files and they show up here.',
      action: 'new',
      chips: [],
    };
  }
  if (input.scoped.length === 0 && input.folderName !== null) {
    return { kind: 'folder-empty', title: `No designs in ${input.folderName} yet`, body: folderEmptyBody(input.draggable), action: 'show-all', chips: [] };
  }
  const { query, tab, system } = input.filters;
  const trimmed = query.trim();
  const chips: EmptyChip[] = [];
  if (input.scopeLabel !== null) {
    const label = input.scope.kind === 'folder' ? `Folder: ${input.scopeLabel}` : input.scope.kind === 'project' ? `Project: ${input.scopeLabel}` : input.scopeLabel;
    chips.push({ id: 'scope', label, fixed: true, icon: input.scope.kind === 'folder' ? 'folder' : input.scope.kind === 'project' ? 'layers' : 'page' });
  }
  if (trimmed !== '') chips.push({ id: 'search', label: `Search: ${trimmed}`, fixed: false });
  if (tab !== 'all') chips.push({ id: 'tab', label: LIST_TABS.find((entry) => entry.id === tab)?.label ?? tab, fixed: false });
  const name = systemNameOf(system, input.systems);
  if (name !== null) chips.push({ id: 'system', label: `System: ${name}`, fixed: false });
  else if (system.kind === 'none') chips.push({ id: 'system', label: 'No system', fixed: false });
  const lead = trimmed !== '' ? 'Try another word, or clear the filters.' : 'Clear the filters to see what is here.';
  return {
    kind: 'no-matches',
    title: noMatchesSentenceFor({ scopeLabel: input.scopeLabel, query, system, systems: input.systems }),
    body: input.scopeLabel === null ? lead : `${lead} ${input.scopeLabel} stays selected.`,
    action: 'clear-filters',
    chips,
  };
};
