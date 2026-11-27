// View-model of the design systems list (Phase 2.5 U1): one row per system, the badges it shows and how they fold
// at the rail's narrow widths (technical design §9.6 "Systems list rows at 360 px"), the source and meta lines, and
// the state the whole list is in. Pure: no DOM, no host calls, so a test can pin every sentence.

import { SYSTEM_SWATCHES_MAX } from '../../shared/limits.ts';
import type { SystemSummary } from '../../shared/types.ts';
import { folderName, plural, relativeTime } from './format.ts';
import { swatchable } from './resync-model.ts';
import { scopeParts } from './system-page-model.ts';

export type RowTone = 'neutral' | 'info' | 'warning' | 'success' | 'error';

/** One mark under a system's name. `id` is stable, so a test and a screen reader can name it. */
export type RowBadge = { id: 'building' | 'changes' | 'default' | 'pinned' | 'living'; label: string; tone: RowTone };

/** Badges under the home line; a third or more fold into "+N" (a tooltip and the row's description list them). */
export const SYSTEM_ROW_BADGES_MAX = 2;

/** "shop" for a project folder: the host's name for it when it has one, else the folder's own name. */
export type ProjectLabel = (directory: string) => string;

/** "Pinned for shop" for one project, "Pinned for 3 projects" for several. */
export const pinnedLabel = (directories: readonly string[], label: ProjectLabel): string => {
  const [only] = directories;
  return directories.length === 1 && only !== undefined ? `Pinned for ${label(only)}` : `Pinned for ${plural(directories.length, 'project')}`;
};

const LIVING_PAGE_BADGE: Partial<Record<NonNullable<SystemSummary['livingPage']>, { label: string; tone: RowTone }>> = {
  'out-of-date': { label: 'Living page out of date', tone: 'warning' },
  changed: { label: 'Living page changed', tone: 'warning' },
  unsafe: { label: 'Living page can’t be checked', tone: 'error' },
};

/**
 * Every badge a row can show, in the spec's priority: Being built › Changes to review › Default › Pinned for N ›
 * living page out of date, changed or unsafe. The first two are shown; the rest are `hidden` (the "+N").
 */
export const systemRowBadges = (summary: SystemSummary, label: ProjectLabel): { shown: RowBadge[]; hidden: RowBadge[] } => {
  const all: RowBadge[] = [];
  if (summary.building) all.push({ id: 'building', label: 'Being built', tone: 'info' });
  if (summary.changesToReview) all.push({ id: 'changes', label: 'Changes to review', tone: 'warning' });
  if (summary.isDefault) all.push({ id: 'default', label: 'Default', tone: 'neutral' });
  if (summary.pinnedFor.length > 0) all.push({ id: 'pinned', label: pinnedLabel(summary.pinnedFor, label), tone: 'neutral' });
  const living = summary.livingPage === null ? undefined : LIVING_PAGE_BADGE[summary.livingPage];
  if (living) all.push({ id: 'living', ...living });
  return { shown: all.slice(0, SYSTEM_ROW_BADGES_MAX), hidden: all.slice(SYSTEM_ROW_BADGES_MAX) };
};

/** "From shop · From brand files · Described": what the system was made from. Empty for a blank one. */
export const sourceLine = (sources: SystemSummary['sources'], label: ProjectLabel): string[] => [
  ...(sources.code ? [`From ${label(sources.code.directory)}`] : []),
  ...(sources.brand > 0 ? ['From brand files'] : []),
  ...(sources.description ? ['Described'] : []),
];

export const usedByLine = (count: number): string => (count === 0 ? 'Not used yet' : `Used by ${plural(count, 'design')}`);

export type SystemRowModel = {
  id: string;
  name: string;
  /** The whole-system reason when its files can't be read at all; the row then shows it instead of the badges. */
  unreadable: string | null;
  status: { label: 'Draft' | 'Ready'; tone: RowTone };
  /** "In Design Chamber" or "Repo · shop", with the full path as its tooltip. */
  home: { label: string; title: string };
  badges: RowBadge[];
  /** "+1" with the labels it stands for. */
  more: { text: string; title: string } | null;
  /** The shared-repo sentence ("shop already has a repo-backed system (Acme)."), a muted line, never a badge. */
  notice: string | null;
  /** Depth, source line, used by, updated: joined with a dot on screen. */
  meta: string[];
  /** The same facts apart, so the used-by part can be a link into the filtered library. `depth` is "Core system" and the like, null when the system doesn't say. */
  metaParts: { depth: string | null; source: string[]; usedBy: { count: number; text: string }; updated: string | null };
  /** The row button's accessible name; hidden badges are in it too. */
  ariaLabel: string;
};

export const homeLine = (summary: Pick<SystemSummary, 'home'>): { label: string; title: string } =>
  summary.home === 'internal'
    ? { label: 'In Design Chamber', title: 'Kept in your Designs folder' }
    : { label: `Repo · ${summary.home.repo}`, title: summary.home.directory };

export const sharedRepoNotice = (summary: Pick<SystemSummary, 'home' | 'sharedRepoWith'>): string | null =>
  summary.home !== 'internal' && summary.sharedRepoWith !== null ? `${summary.home.repo} already has a repo-backed system (${summary.sharedRepoWith}).` : null;

export const systemRow = (summary: SystemSummary, context: { nowMs: number; locale: string; label: ProjectLabel }): SystemRowModel => {
  const badges = systemRowBadges(summary, context.label);
  const home = homeLine(summary);
  const updated = relativeTime(summary.updated, context.nowMs, context.locale);
  const source = sourceLine(summary.sources, context.label);
  // The depth leads the meta line, right under where the system lives, as on the system page's summary line.
  const [depth = null] = scopeParts(summary);
  const meta = [...(depth === null ? [] : [depth]), ...source, usedByLine(summary.usedBy), ...(updated === '' ? [] : [updated])];
  const status: SystemRowModel['status'] = summary.status === 'ready' ? { label: 'Ready', tone: 'success' } : { label: 'Draft', tone: 'info' };
  const notice = sharedRepoNotice(summary);
  const hiddenLabels = badges.hidden.map((badge) => badge.label);
  const spoken = [summary.name, status.label, home.label, ...badges.shown.map((badge) => badge.label), ...hiddenLabels];
  return {
    id: summary.id,
    name: summary.name,
    unreadable: summary.unreadable,
    status,
    home,
    badges: badges.shown,
    more: badges.hidden.length > 0 ? { text: `+${badges.hidden.length}`, title: hiddenLabels.join(', ') } : null,
    notice,
    meta,
    metaParts: { depth, source, usedBy: { count: summary.usedBy, text: usedByLine(summary.usedBy) }, updated: updated === '' ? null : updated },
    ariaLabel: summary.unreadable !== null ? `${summary.name}, can’t be read` : `${spoken.join(', ')}. ${meta.join(', ')}.`,
  };
};

// ---------------------------------------------------------------- the list's own states

export type SystemsLoad = { status: 'idle' | 'loading' | 'ready' | 'error'; systems: readonly SystemSummary[] | null };

/** What the list shows: a skeleton, the failure, the empty state, or the rows. A failed refresh keeps the rows it had. */
export type SystemsListState = 'loading' | 'error' | 'empty' | 'ready';

export const systemsListState = (load: SystemsLoad): SystemsListState => {
  if (load.systems === null) return load.status === 'error' ? 'error' : 'loading';
  return load.systems.length === 0 ? 'empty' : 'ready';
};

/** The host's own failure codes that mean the service itself isn't answering (the kit's "isn't running" state). */
const SERVICE_DOWN_CODES: ReadonlySet<string> = new Set(['NO_SERVICE', 'SERVICE_FAILED', 'HOST_TIMEOUT', 'REQUEST_FAILED', 'DISABLED', 'HOST_UNAVAILABLE']);

export const isServiceDownCode = (code: string): boolean => SERVICE_DOWN_CODES.has(code);

/** The banner for a list that didn't load: the service being down is its own, plainer sentence. */
export const loadFailure = (error: { code: string; message: string } | null): { title: string; body: string } => {
  const message = error?.message ?? 'Try again in a moment.';
  return error !== null && isServiceDownCode(error.code)
    ? { title: 'Design Chamber isn’t running', body: message }
    : { title: 'Your design systems didn’t load', body: message };
};

/** The confirm sentence of Delete…: where it goes and what the designs using it keep. */
export const deleteSentence = (usedBy: number): string =>
  usedBy === 0 ? 'It moves to the trash.' : usedBy === 1 ? 'It moves to the trash. The design that uses it keeps its copy.' : `It moves to the trash. The ${usedBy} designs that use it keep their copy.`;

export const EMPTY_TITLE = 'No design systems yet';
export const EMPTY_BODY = 'Make one from a project’s code, from brand files, or by describing it. Designs can then start from it.';

/** The New button is held back at the cap, with the reason beside it. */
export const atSystemsCap = (total: number, max: number): string | null =>
  total >= max ? `You have ${max} design systems, the most Design Chamber keeps. Delete one to make room.` : null;

/** The row menu: what each entry needs. Rows with a reason stay reachable, so the reason is read out. */
export type SystemMenuId = 'open' | 'make-default' | 'remove-default' | 'reveal' | 'rename' | 'delete';

export const systemMenu = (summary: Pick<SystemSummary, 'status' | 'isDefault' | 'unreadable'>): Array<{ id: SystemMenuId; label: string; disabled?: boolean; reason?: string; destructive?: boolean } | { separator: true }> => {
  const readable = summary.unreadable === null;
  return [
    ...(readable ? [{ id: 'open' as const, label: 'Open' }] : []),
    ...(readable
      ? summary.isDefault
        ? [{ id: 'remove-default' as const, label: 'Remove as default' }]
        : [{ id: 'make-default' as const, label: 'Make default', ...(summary.status === 'draft' ? { disabled: true, reason: 'Mark it ready first.' } : {}) }]
      : []),
    { id: 'reveal' as const, label: 'Reveal in folder' },
    ...(readable ? [{ id: 'rename' as const, label: 'Rename' }] : []),
    { separator: true as const },
    { id: 'delete' as const, label: 'Delete…', destructive: true },
  ];
};

/** The folder a repo-backed or code-scanned system names, for the project label fallback. */
export const labelFromDirectory = (directory: string): string => folderName(directory);

// ---------------------------------------------------------------- systems in the library (Phase 2.6 L1b)
//
// A system is a library item (a tile on the page, a row on the rail and in the List view). The plate shows the
// system's own colours, never a colour of ours; the tile's menu is the short one, because renaming and deleting
// stay in the Design systems list.

/** The colours a plate paints: the summary's own, only those the editor would accept as a colour, at most six. */
export const plateSwatches = (summary: Pick<SystemSummary, 'swatches'>): string[] => summary.swatches.filter(swatchable).slice(0, SYSTEM_SWATCHES_MAX);

/** The living page states that have something to preview (a missing, unsafe or unreadable page has not). */
const PREVIEWABLE_LIVING_PAGE: ReadonlySet<string> = new Set(['fresh', 'out-of-date', 'changed', 'reformatted']);

export const canPreviewLivingPage = (summary: Pick<SystemSummary, 'livingPage'>): boolean => summary.livingPage !== null && PREVIEWABLE_LIVING_PAGE.has(summary.livingPage);

/** The tile's own **Living page** button is for a repo-backed system; every other system reaches the preview from its menu. */
export const showsLivingPageButton = (summary: Pick<SystemSummary, 'livingPage' | 'home' | 'unreadable'>): boolean =>
  summary.unreadable === null && summary.home !== 'internal' && canPreviewLivingPage(summary);

export type LibrarySystemMenuId = 'open' | 'preview' | 'reveal';

export const librarySystemMenu = (summary: Pick<SystemSummary, 'livingPage' | 'unreadable'>): Array<{ id: LibrarySystemMenuId; label: string }> => [
  ...(summary.unreadable === null ? [{ id: 'open' as const, label: 'Open' }] : []),
  ...(summary.unreadable === null && canPreviewLivingPage(summary) ? [{ id: 'preview' as const, label: 'Preview living page' }] : []),
  { id: 'reveal' as const, label: 'Reveal in folder' },
];

/** The tile's accessible name: name, what it is, its state, where it lives, who uses it, when it changed. */
export const libraryTileLabel = (summary: SystemSummary, context: { nowMs: number; locale: string }): string => {
  if (summary.unreadable !== null) return `${summary.name}, design system, can’t be read`;
  const updated = relativeTime(summary.updated, context.nowMs, context.locale);
  const used = summary.usedBy === 0 ? 'not used yet' : `used by ${plural(summary.usedBy, 'design')}`;
  return [summary.name, 'design system', summary.status === 'ready' ? 'Ready' : 'Draft', homeLine(summary).label, used, ...(updated === '' ? [] : [`updated ${updated}`])].join(', ');
};

/** The link's accessible name: it says where it goes. */
export const usedByLinkLabel = (count: number): string => `${usedByLine(count)}. Show ${count === 1 ? 'it' : 'them'}`;

/** The page sidebar's system rows: by name, each with its first colour, its Draft mark and its used-by count. */
export type SidebarSystem = { id: string; name: string; draft: boolean; usedBy: number; swatch: string | null };

export const sidebarSystems = (systems: readonly SystemSummary[]): SidebarSystem[] =>
  [...systems]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((system) => ({ id: system.id, name: system.name, draft: system.status === 'draft', usedBy: system.usedBy, swatch: plateSwatches(system)[0] ?? null }));

/** The first readable colour of a system by id, for a design chip's dot; null when unknown or it has none. */
export const swatchLookup = (systems: readonly SystemSummary[]): ((id: string) => string | null) => {
  const byId = new Map(systems.map((system) => [system.id, plateSwatches(system)[0] ?? null] as const));
  return (id) => byId.get(id) ?? null;
};
