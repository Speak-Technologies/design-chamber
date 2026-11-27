// View-model of the designs list (rail R1, page P1): search, tabs, sort and the facts a row shows.

import { FOLDER_ID_PATTERN, FOLDER_NAME_MAX, FOLDERS_MAX, SYSTEM_ID_PATTERN } from '../../shared/limits.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import type { ProjectMembersView } from '../../shared/api.ts';
import type { DesignKind, DesignSummary, SystemSummary } from '../../shared/types.ts';
import { plural } from './format.ts';

export type ListTab = 'all' | 'canvas' | 'page' | 'system';
export type ListSort = 'updated' | 'created' | 'title';

export const LIST_TABS: ReadonlyArray<{ id: ListTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'canvas', label: 'Canvases' },
  { id: 'page', label: 'Pages' },
  { id: 'system', label: 'Systems' },
];

/** The design kinds' counts; the Systems tab is counted by `libraryItems`. */
export type DesignTabCounts = Record<Exclude<ListTab, 'system'>, number>;

/**
 * The rail's three kind tabs: designs only. Systems reach the rail through a pinned entry under the list and the
 * header icon, never as a tab or as rows among the designs; the page keeps all four (approved canvas, DESIGN.md
 * "The rail represents systems two ways").
 */
export const RAIL_TABS: ReadonlyArray<{ id: Exclude<ListTab, 'system'>; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'canvas', label: 'Canvases' },
  { id: 'page', label: 'Pages' },
];

/** A stored tab read back; anything unknown or malformed is All. */
export const tabFromStored = (raw: unknown): ListTab => LIST_TABS.find((entry) => entry.id === raw)?.id ?? 'all';

/** The rail has no Systems tab: a stored one (or any unknown value) reads as All. */
export const railTabFromStored = (raw: unknown): Exclude<ListTab, 'system'> => RAIL_TABS.find((entry) => entry.id === raw)?.id ?? 'all';

/**
 * What the System filter may rely on, from the systems store: the last good list (kept when a refresh fails, so a
 * name is still known), and whether the filter may be checked against it. Only a ready list can say a system is
 * gone; while loading, or after a failed read, the remembered filter stays as chosen (KI-31).
 */
export const systemsForFilter = <T>(state: { status: 'idle' | 'loading' | 'ready' | 'error'; systems: readonly T[] | null }): { list: readonly T[]; canResolve: boolean; failed: boolean } => ({
  list: state.systems ?? [],
  canResolve: state.status === 'ready' && state.systems !== null,
  failed: state.status === 'error' && state.systems === null,
});

/** The rail's pinned entry under the designs list: the accessible name says how many systems there are and what the entry does; unknown while they load or failed to load. */
export const systemsEntryLabel = (count: number | null): string => (count === null ? 'Design systems. Show them' : `Design systems, ${count}. Show them`);

/** Which surface a library view is for: the page mixes systems into All and counts them; the rail lists designs only. */
export type LibrarySurface = 'rail' | 'page';

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
export const tabCounts = (designs: readonly DesignSummary[], query: string): DesignTabCounts => {
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
  if (design.system) parts.push(design.system.state === 'deleted' ? `uses ${design.system.name}, deleted` : `uses ${design.system.name}`);
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

/** The registry's manual project members (`GET /folders` `projects`): designs the user filed under a project by hand. */
export type ManualProjects = readonly ProjectMembersView[];

/**
 * Every project folder a design sits in: the one it was made for first (`projectOf`), then the ones
 * the user filed it under by hand, each once (matched by `sameDirectory`). A manual project inside the
 * designs folder reads as none, like a derived one. Empty means No project (§19.1).
 */
export const projectsOf = (design: Pick<DesignSummary, 'slug' | 'projectDirectory'>, designsRoot: string, manual: ManualProjects = []): string[] => {
  const found: string[] = [];
  const add = (directory: string | null): void => {
    if (directory === null || directory.trim() === '') return;
    if (designsRoot !== '' && isInsideOrEqualDirectory(designsRoot, directory)) return;
    if (!found.some((entry) => sameDirectory(entry, directory))) found.push(directory);
  };
  add(projectOf(design, designsRoot));
  for (const entry of manual) if (entry.slugs.includes(design.slug)) add(entry.directory);
  return found;
};

/** One row per project folder that has designs (made for it, or filed under it by hand), labelled by the host's project name or the folder's base name. */
export const projectGroups = (
  designs: readonly DesignSummary[],
  projects: readonly ProjectInfo[],
  designsRoot: string,
  projectFolders: ReadonlyArray<{ directory: string; exists: boolean }> | undefined,
  manual: ManualProjects = [],
): ProjectGroup[] => {
  const groups: ProjectGroup[] = [];
  for (const design of designs) {
    for (const directory of projectsOf(design, designsRoot, manual)) {
      const found = groups.find((group) => sameDirectory(group.directory, directory));
      if (found) {
        found.count += 1;
        continue;
      }
      const named = projects.find((project) => sameDirectory(project.directory, directory))?.name.trim();
      const stat = projectFolders?.find((entry) => sameDirectory(entry.directory, directory));
      groups.push({ directory, label: named ? named : baseName(directory), title: directory, count: 1, missing: stat !== undefined && !stat.exists });
    }
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

/** The group a design sits in by being made for it, matched by `sameDirectory`. */
export const groupOf = (design: Pick<DesignSummary, 'projectDirectory'>, groups: readonly ProjectGroup[], designsRoot: string): ProjectGroup | null => {
  const directory = projectOf(design, designsRoot);
  if (directory === null) return null;
  return groups.find((group) => sameDirectory(group.directory, directory)) ?? null;
};

/** The designs one scope shows. Folders count a slug only when that design is in the list (a pruned name never shows). */
export const scopeDesigns = (designs: readonly DesignSummary[], scope: ListScope, folders: readonly FolderLite[], designsRoot: string, manual: ManualProjects = []): DesignSummary[] => {
  switch (scope.kind) {
    case 'all':
      return [...designs];
    case 'no-project':
      return designs.filter((design) => projectsOf(design, designsRoot, manual).length === 0);
    case 'project':
      return designs.filter((design) => projectsOf(design, designsRoot, manual).some((directory) => sameDirectory(directory, scope.directory)));
    case 'folder': {
      const members = new Set(folders.find((folder) => folder.id === scope.id)?.slugs ?? []);
      return designs.filter((design) => members.has(design.slug));
    }
  }
};

export type ScopeCounts = { all: number; noProject: number; folders: Record<string, number> };

/** Counts for the sidebar and the Show select. */
export const scopeCounts = (designs: readonly DesignSummary[], folders: readonly FolderLite[], designsRoot: string, manual: ManualProjects = []): ScopeCounts => {
  const live = new Set(designs.map((design) => design.slug));
  const counts: Record<string, number> = {};
  for (const folder of folders) counts[folder.id] = new Set(folder.slugs.filter((slug) => live.has(slug))).size;
  return { all: designs.length, noProject: designs.filter((design) => projectsOf(design, designsRoot, manual).length === 0).length, folders: counts };
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

export type ProjectLine = { label: string; title: string; /** Filed under this project by the user, not made for it. */ manual: boolean };

/** The tooltip line for a project filed by hand. */
export const FILED_BY_YOU = 'Filed here by you';

/**
 * The project name under a card's title, unless the list is already that project: the one the design
 * was made for; with none (or when the list is that project), the first project the user filed it
 * under, with "and N more" for the rest.
 */
export const cardProjectLine = (
  design: Pick<DesignSummary, 'slug' | 'projectDirectory'>,
  scope: ListScope,
  groups: readonly ProjectGroup[],
  designsRoot: string,
  manual: ManualProjects = [],
): ProjectLine | null => {
  const derived = projectOf(design, designsRoot);
  const candidates = projectsOf(design, designsRoot, manual)
    .filter((directory) => !(scope.kind === 'project' && sameDirectory(scope.directory, directory)))
    .map((directory) => ({ directory, group: groups.find((group) => sameDirectory(group.directory, directory)) ?? null }))
    .filter((entry): entry is { directory: string; group: ProjectGroup } => entry.group !== null);
  const first = candidates[0];
  if (first === undefined) return null;
  const isManual = derived === null || !sameDirectory(derived, first.directory);
  const more = isManual ? candidates.length - 1 : 0;
  const note = isManual ? `\n${FILED_BY_YOU}` : '';
  const missing = first.group.missing ? '\nFolder not found' : '';
  return {
    label: more > 0 ? `${first.group.label} and ${more} more` : first.group.label,
    title: `${first.group.title}${missing}${note}`,
    manual: isManual,
  };
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
// System filter are remembered per surface too (`list-tab:<surface>`, `list-system:<surface>`); search is not. Composition order: scope, System filter, search,
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

// -- The rail's Filters area: System filter, Sort and the view (titles or list), hidden until asked for --

/** `titles`: one line per design, the title only. `list`: the richer rows with thumbnails (the rail's original look). */
export type RailView = 'titles' | 'list';

export const RAIL_VIEWS: ReadonlyArray<{ id: RailView; label: string; hint: string }> = [
  { id: 'titles', label: 'Titles', hint: 'One line per design' },
  { id: 'list', label: 'List', hint: 'Thumbnails and details' },
];

export const railViewStorageKey = 'rail-view:panel';
/** The System filter and the kind tab are remembered per surface, like the sort (`list-sort:<surface>`). */
export const systemFilterStorageKey = (surface: 'panel' | 'page'): string => `list-system:${surface}`;
export const tabStorageKey = (surface: 'panel' | 'page'): string => `list-tab:${surface}`;
export const railSystemStorageKey = systemFilterStorageKey('panel');
/** What the rail does with no stored choice: the rows it always had. */
export const DEFAULT_RAIL_VIEW: RailView = 'list';
export const DEFAULT_SORT: ListSort = 'updated';

/** Stored value read back; anything unknown or malformed is the default list. */
export const railViewFromStored = (raw: unknown): RailView => (raw === 'titles' ? 'titles' : DEFAULT_RAIL_VIEW);

/** What the rail calls a system filter whose system it cannot name (the systems list has not loaded, or failed). */
export const UNKNOWN_SYSTEM_LABEL = 'One system';

/** The System select's entries, plus one for a filter whose system is not in the list (not loaded, or failed), so the select, its name and the Filters button agree (KI-30). */
export const systemSelectOptions = (systems: readonly SystemSummary[], filter: SystemFilter): SystemOption[] => {
  const options = systemOptions(systems);
  if (filter.kind !== 'system' || options.some((entry) => entry.id === systemFilterToId(filter))) return options;
  return [...options.slice(0, -1), { id: systemFilterToId(filter), label: UNKNOWN_SYSTEM_LABEL }, ...options.slice(-1)];
};

/** The prefix of a system entry in the Show select: "System · Tidepool", as folders read "Folder · Launch". */
export const SHOW_SYSTEM_LABEL = 'System · ';

/**
 * The rail's "Design systems" group in the Show select: one entry per system, A to Z, with Draft or its
 * used-by count (the same entries and ids as the System select). Empty while the systems are not known, so
 * the group is simply left out.
 */
export const showSystemOptions = (systems: readonly SystemSummary[]): ScopeOption[] =>
  systemOptions(systems)
    .filter((entry) => entry.id.startsWith('system:'))
    .map((entry) => ({ id: entry.id, label: `${SHOW_SYSTEM_LABEL}${entry.label}`, hint: entry.hint ?? '' }));

/** The system filter in words for the chip: the system's name, "No system", or "One system" when it cannot be named. Null when not filtering. */
export const systemFilterLabel = (filter: SystemFilter, systems: readonly Pick<SystemSummary, 'id' | 'name'>[]): string | null => {
  if (filter.kind === 'all') return null;
  if (filter.kind === 'none') return 'No system';
  return systems.find((system) => system.id === filter.id)?.name ?? UNKNOWN_SYSTEM_LABEL;
};

export type RailFilterState = {
  /** The list is narrowed by a system filter. Sort and view change the look and the order, never what is listed. */
  filtering: boolean;
  /** How many of System, Sort and View differ from the defaults, for the area's own "Reset" offer. */
  changed: number;
  /** The Filters button's accessible name. */
  buttonLabel: string;
  /** The words next to the dot, for a screen reader and the tooltip; empty when nothing is filtered. */
  summary: string;
  /** The removable chip under the header while the Filters area is closed; null when nothing is filtered. */
  chip: { label: string; removeLabel: string } | null;
};

/** What the Filters button shows while its area is closed: a dot when the list is narrowed, and a name that says so. */
export const railFilterState = (input: { system: SystemFilter; sort: ListSort; view: RailView; systems: readonly Pick<SystemSummary, 'id' | 'name'>[] }): RailFilterState => {
  const filter = input.system;
  const filtering = filter.kind !== 'all';
  const changed = (filtering ? 1 : 0) + (input.sort !== DEFAULT_SORT ? 1 : 0) + (input.view !== DEFAULT_RAIL_VIEW ? 1 : 0);
  const named = filter.kind === 'system' ? input.systems.find((system) => system.id === filter.id)?.name : undefined;
  const summary = filter.kind === 'all' ? '' : filter.kind === 'none' ? 'Showing designs with no system' : named ? `Showing designs that use ${named}` : 'Showing designs that use one system';
  const label = systemFilterLabel(filter, input.systems);
  return {
    filtering,
    changed,
    buttonLabel: filtering ? `Filters, on. ${summary}` : 'Filters',
    summary,
    chip: label === null ? null : { label, removeLabel: filter.kind === 'none' ? 'Remove the no system filter' : label === UNKNOWN_SYSTEM_LABEL ? 'Remove the system filter' : `Remove the ${label} system filter` },
  };
};

/** Back to the rail's defaults for the three controls in the area (System all, Updated, List). */
export const RAIL_FILTER_DEFAULTS: { system: SystemFilter; sort: ListSort; view: RailView } = { system: ALL_SYSTEMS, sort: DEFAULT_SORT, view: DEFAULT_RAIL_VIEW };

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
  manual: ManualProjects = [],
): { scoped: DesignSummary[]; shown: DesignSummary[]; counts: DesignTabCounts } => {
  const scoped = scopeDesigns(designs, scope, folders, designsRoot, manual);
  const systemed = scoped.filter((design) => matchesSystem(design, filters.system));
  const counts = tabCounts(systemed, filters.query);
  const shown = sortDesigns(filterDesigns(systemed, filters.query, filters.tab), sort);
  return { scoped, shown, counts };
};

// ---- Systems as library items (Phase 2.6 L1b, §6.4, §20) ----
//
// On the page a system is a library item next to the designs: it mixes into the All tab by the chosen
// sort, the Systems tab shows systems only, and the other two tabs show designs only. The System filter
// keeps only that system (None keeps none) and the system leads the All tab. The All count includes the
// systems; the sidebar's design counts stay designs-only.
// The rail is the asymmetric one (owner decision 2026-11-22): three tabs, designs only, and an All count
// that counts designs only. The rail reaches systems through its own list (a pinned entry, the header icon).

export type LibraryItem = { kind: 'design'; design: DesignSummary } | { kind: 'system'; system: SystemSummary };

const matchesSystemQuery = (system: Pick<SystemSummary, 'id' | 'name'>, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  return needle === '' || system.name.toLowerCase().includes(needle) || system.id.toLowerCase().includes(needle);
};

const matchesSystemFilter = (system: Pick<SystemSummary, 'id'>, filter: SystemFilter): boolean =>
  filter.kind === 'all' || (filter.kind === 'system' && filter.id === system.id);

const itemKey = (item: LibraryItem, sort: ListSort): number | string => {
  if (sort === 'title') return item.kind === 'design' ? item.design.title : item.system.name;
  const stamp = item.kind === 'design' ? item.design[sort === 'created' ? 'created' : 'updated'] : item.system[sort === 'created' ? 'created' : 'updated'];
  return Date.parse(stamp);
};

/** Designs and systems in one order: newest first, or A to Z. Equal keys keep the given order (designs come first). */
export const sortItems = (items: readonly LibraryItem[], sort: ListSort): LibraryItem[] =>
  items
    .map((item, index) => ({ item, index, key: itemKey(item, sort) }))
    .sort((a, b) => {
      if (typeof a.key === 'string' && typeof b.key === 'string') return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }) || a.index - b.index;
      const left = typeof a.key === 'number' && !Number.isNaN(a.key) ? a.key : 0;
      const right = typeof b.key === 'number' && !Number.isNaN(b.key) ? b.key : 0;
      return right - left || a.index - b.index;
    })
    .map((entry) => entry.item);

export type LibraryContents = {
  /** Designs in scope, before any filter (the header count and the empty states read it). */
  scoped: DesignSummary[];
  /** Systems in scope, before any filter. */
  scopedSystems: SystemSummary[];
  /** What the current tab shows, in order: the lead system first under a System filter. */
  items: LibraryItem[];
  /** The filtered system, when the tab is All; it leads `items`. */
  lead: SystemSummary | null;
  shownDesigns: DesignSummary[];
  shownSystems: SystemSummary[];
  counts: Record<ListTab, number>;
};

/** Scope, then the System filter, then search, then the counts per tab, then the tab, then the sort. */
export const libraryItems = (input: {
  designs: readonly DesignSummary[];
  systems: readonly SystemSummary[];
  scope: ListScope;
  folders: readonly FolderLite[];
  designsRoot: string;
  filters: LibraryFilters;
  sort: ListSort;
  /** The registry's manual project members: a project scope lists them with the designs made for it. */
  manual?: ManualProjects;
  /** `rail`: designs only, no system rows, counts that leave the systems out. Default `page`. */
  surface?: LibrarySurface;
}): LibraryContents => {
  const { sort } = input;
  const rail = input.surface === 'rail';
  // The rail has no Systems tab; a stale one reads as All.
  const filters: LibraryFilters = rail && input.filters.tab === 'system' ? { ...input.filters, tab: 'all' } : input.filters;
  const scoped = scopeDesigns(input.designs, input.scope, input.folders, input.designsRoot, input.manual ?? []);
  const scopedSystems = scopeSystems(input.systems, input.scope);
  const designCounts = tabCounts(
    scoped.filter((design) => matchesSystem(design, filters.system)),
    filters.query,
  );
  const systemsFound = scopedSystems.filter((system) => matchesSystemFilter(system, filters.system) && matchesSystemQuery(system, filters.query));
  const counts: Record<ListTab, number> = { all: designCounts.all + (rail ? 0 : systemsFound.length), canvas: designCounts.canvas, page: designCounts.page, system: systemsFound.length };
  const shownDesigns = filters.tab === 'system' ? [] : sortDesigns(filterDesigns(scoped.filter((design) => matchesSystem(design, filters.system)), filters.query, filters.tab), sort);
  const shownSystems = !rail && (filters.tab === 'all' || filters.tab === 'system') ? systemsFound : [];
  const lead = filters.tab === 'all' && filters.system.kind === 'system' ? shownSystems[0] ?? null : null;
  const rest: LibraryItem[] = [
    ...shownDesigns.map((design): LibraryItem => ({ kind: 'design', design })),
    ...shownSystems.filter((system) => system !== lead).map((system): LibraryItem => ({ kind: 'system', system })),
  ];
  const sorted = sortItems(rest, sort);
  return {
    scoped,
    scopedSystems,
    items: lead === null ? sorted : [{ kind: 'system', system: lead }, ...sorted],
    lead,
    shownDesigns,
    shownSystems,
    counts,
  };
};

/** One active filter in the empty state's chip row; the scope chip is fixed (Clear filters keeps it). */
export type EmptyChip = { id: 'scope' | 'search' | 'tab' | 'system'; label: string; fixed: boolean; icon?: 'folder' | 'layers' | 'page' };

export type LibraryEmpty = {
  kind: 'no-designs' | 'folder-empty' | 'no-matches' | 'no-systems' | 'folder-no-systems' | 'systems-failed';
  title: string;
  body: string;
  action: 'new' | 'show-all' | 'clear-filters' | 'new-system' | 'retry-systems';
  /** Replaces the action's usual label (Show all systems, where the usual one says designs). */
  actionLabel?: string;
  chips: EmptyChip[];
};

const systemNameOf = (filter: SystemFilter, systems: readonly Pick<SystemSummary, 'id' | 'name'>[]): string | null =>
  filter.kind === 'system' ? systems.find((system) => system.id === filter.id)?.name ?? null : null;

/**
 * "No designs in Q4 launch match “hero” with the Speak UI system." The approved canvas keeps the
 * generic noun in the sentence; the chip row names the exact tab. No search and no system: the
 * older "Nothing in … for this tab yet".
 */
export const noMatchesSentenceFor = (input: { scopeLabel: string | null; query: string; system: SystemFilter; systems: readonly Pick<SystemSummary, 'id' | 'name'>[]; tab?: ListTab }): string => {
  const query = input.query.trim();
  const name = systemNameOf(input.system, input.systems);
  const systemPart = name !== null ? ` with the ${name} system` : input.system.kind === 'none' ? ' with no system' : '';
  const scopePart = input.scopeLabel === null ? '' : ` in ${input.scopeLabel}`;
  // Only the Systems tab changes the noun; the other tabs keep the generic one (the chip row names the tab).
  const noun = input.tab === 'system' ? 'systems' : 'designs';
  if (query === '' && systemPart === '') return input.scopeLabel === null ? 'Nothing in this tab yet' : `Nothing in ${input.scopeLabel} for this tab yet`;
  return `No ${noun}${scopePart}${query === '' ? '' : ` match “${query}”`}${systemPart}.`;
};

export const SYSTEMS_FAILED_TITLE = 'Design systems didn’t load';
export const SYSTEMS_FAILED_BODY = 'Your designs are fine. Try again in a moment.';
export const NO_SYSTEMS_TITLE = 'No design systems yet';
export const NO_SYSTEMS_BODY = 'Make one from a project’s code, from brand files, or by describing it. Designs can then start from it.';
export const FOLDER_NO_SYSTEMS_TITLE = 'Folders hold designs, not systems.';
export const FOLDER_NO_SYSTEMS_BODY = 'Show all systems to see the ones you have.';

/** Which empty state applies, with its copy and the active filters named. Null when rows show. */
export const emptyStateOf = (input: {
  all: readonly DesignSummary[];
  scoped: readonly DesignSummary[];
  shown: readonly DesignSummary[];
  scope: ListScope;
  scopeLabel: string | null;
  folderName: string | null;
  filters: LibraryFilters;
  /** Every system the library knows (the System filter's names and the Systems tab's "none yet"). */
  systems: readonly Pick<SystemSummary, 'id' | 'name'>[];
  /** What the current tab shows besides designs; omitted where the surface shows designs only. */
  shownSystems?: readonly unknown[];
  /** The systems list did not load: the Systems tab says so instead of "none yet". */
  systemsFailed?: boolean;
  draggable: boolean;
  /** `rail`: designs only, so having systems does not make an empty All tab a "no matches". Default `page`. */
  surface?: LibrarySurface;
}): LibraryEmpty | null => {
  if (input.shown.length + (input.shownSystems?.length ?? 0) > 0) return null;
  if (input.filters.tab === 'system') {
    if (input.systemsFailed === true) return { kind: 'systems-failed', title: SYSTEMS_FAILED_TITLE, body: SYSTEMS_FAILED_BODY, action: 'retry-systems', actionLabel: 'Try again', chips: [] };
    if (input.scope.kind === 'folder') return { kind: 'folder-no-systems', title: FOLDER_NO_SYSTEMS_TITLE, body: FOLDER_NO_SYSTEMS_BODY, action: 'show-all', actionLabel: 'Show all systems', chips: [] };
    if (input.systems.length === 0) return { kind: 'no-systems', title: NO_SYSTEMS_TITLE, body: NO_SYSTEMS_BODY, action: 'new-system', actionLabel: 'New design system…', chips: [] };
  }
  if (input.all.length === 0 && (input.filters.tab !== 'all' || input.systems.length === 0 || input.surface === 'rail')) {
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
    title: noMatchesSentenceFor({ scopeLabel: input.scopeLabel, query, system, systems: input.systems, tab }),
    body: input.scopeLabel === null ? lead : `${lead} ${input.scopeLabel} stays selected.`,
    action: 'clear-filters',
    chips,
  };
};

// ---------------------------------------------------------------- This chat (native extras §4.2, U6)
//
// A click on a chat's sidebar mark opens the rail in that chat, and the rail cannot tell that click from a click on
// its icon. So the list leads with the designs linked to the chat the user is in: up to three rows, then a button
// that narrows the whole list to them.

/** Rows the This chat group shows before "Show all". */
export const THIS_CHAT_ROWS = 3;
export const THIS_CHAT_TITLE = 'This chat';

/** The designs linked to `sessionId`, newest first. None for no chat. */
export const chatDesigns = (designs: readonly DesignSummary[], sessionId: string | null): DesignSummary[] =>
  sessionId === null || sessionId === '' ? [] : sortDesigns(designs.filter((design) => design.sessionId === sessionId), 'updated');

export type ThisChatGroup = {
  designs: DesignSummary[];
  total: number;
  /** "Show all 5", or null when every linked design is already a row. */
  showAll: { label: string; aria: string } | null;
};

/**
 * The group above the list, or null: no chat, a chat with no designs, a search in progress (the results are what the
 * user asked for) or the list already narrowed to this chat.
 */
export const thisChatGroup = (designs: readonly DesignSummary[], sessionId: string | null, state: { searching: boolean; chatOnly: boolean }): ThisChatGroup | null => {
  if (state.searching || state.chatOnly) return null;
  const linked = chatDesigns(designs, sessionId);
  if (linked.length === 0) return null;
  const more = linked.length > THIS_CHAT_ROWS;
  return {
    designs: linked.slice(0, THIS_CHAT_ROWS),
    total: linked.length,
    showAll: more ? { label: `Show all ${linked.length}`, aria: `Show all ${plural(linked.length, 'design')} from this chat` } : null,
  };
};

/** The chip while the list is narrowed to this chat. */
export const chatChip = (count: number): { label: string; title: string; removeLabel: string } => ({
  label: THIS_CHAT_TITLE,
  title: `Showing ${plural(count, 'design')} from this chat`,
  removeLabel: 'Show all designs again',
});
