// P1, the page's library: header (title and counts, Design systems, Settings, New) over a toolbar
// (search, kind tabs, System filter, Sort, Tiles/List) and a responsive grid of design cards with
// 16:10 thumbnails, or a column list of the same designs. View and sort are remembered per surface
// (host.storage); search, tab and the System filter live for the session. Cards and rows update
// live from change events without losing scroll. Notices above: a failed refresh, an earlier
// folder with designs, loose HTML files to import. The approved canvas (phase-2-6-library-ui) is
// the visual authority. Design systems are library items too (L1b): tiles (or list rows) mixed into
// the All tab by the sort, only systems on the Systems tab, the filtered system leading; every
// design carries a chip that opens its system, and a system's used-by link filters the library.

import { mountBadge, mountBanner, mountSearchField, mountSelect, mountTabs } from '@openchamber/sdk/ui';

import type { DesignSummary } from '../../shared/types.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { designSystemChip, mountDesignRow, type DesignRowView } from '../components/design-row.ts';
import { createScope, h } from '../components/dom.ts';
import { addToFolder, deleteFolder, DESIGN_DRAG_TYPE, listDesignMenu, mountUndoNotice, runListAction, type DesignMenuView, type FolderRef } from '../components/folder-actions.ts';
import { folders as foldersStore, type FoldersState } from '../components/folders-store.ts';
import { icon } from '../components/icons.ts';
import { attachMenu, btn, iconBtn, nameSelect } from '../components/kit.ts';
import { mountLibraryEmpty } from '../components/library-empty.ts';
import { mountLooseBanner } from '../components/loose-banner.ts';
import { systems as systemsStore } from '../components/systems-store.ts';
import { mountThumb, type ThumbHandle } from '../components/thumb.ts';
import { guestHost, host, store } from '../guest.ts';
import { folderName, middlePath, plural, relativeTime } from '../model/format.ts';
import {
  ALL_SCOPE,
  ALL_SYSTEMS,
  LIST_SORTS,
  LIST_TABS,
  cardProjectLine,
  emptyStateOf,
  folderNameProblem,
  kindLabel,
  libraryItems,
  projectGroups,
  resolveScope,
  resolveSystemFilter,
  rowAriaLabel,
  scopeCounts,
  scopeFromId,
  scopeLabel,
  scopeStorageKey,
  scopeToId,
  sortFromStored,
  sortStorageKey,
  systemFilterFromId,
  systemFilterToId,
  systemOptions,
  SYSTEM_UPDATED_LABEL,
  systemUpdated,
  viewFromStored,
  viewStorageKey,
  type LibraryView,
  type ListScope,
  type ListSort,
  type ListTab,
  type ManualProjects,
  type ProjectGroup,
  type ProjectInfo,
  type SystemFilter,
} from '../model/list-model.ts';
import { designCountLabel } from '../model/settings-model.ts';
import { sidebarSystems, swatchLookup } from '../model/systems-model.ts';
import { openNewSystemSheet } from '../systems/new-system-sheet.ts';
import { mountSystemListRow } from '../systems/system-row.ts';
import { mountSystemTile } from '../systems/system-tile.ts';
import { mountSidebar } from './library-sidebar.ts';

export type LibraryOptions = {
  actions: ActionContext;
  onNew: (kind: 'canvas' | 'page') => void;
  onSettings: () => void;
  /** Opens the design systems list (Phase 2.5). */
  onSystems: () => void;
  onOpen: (slug: string) => void;
};

export type LibraryHandle = {
  el: HTMLElement;
  focusCard: (slug: string) => void;
  focusSystems: () => void;
  /** Back from a system opened out of the library: focus the chip or tile that opened it, else the systems button. */
  focusSystemEntry: (id: string) => void;
  /** Show the library filtered to one system: scope All, tab All, no search (a used-by link or a chip lands here). */
  filterBySystem: (id: string) => void;
  dispose: () => void;
};

const SKELETON_CARDS = 8;
const SKELETON_ROWS = 6;
/** Under this page width the sidebar starts closed and floats over the grid when opened. */
const SIDEBAR_MIN_PAGE_WIDTH = 900;

const LOAD_FAILED_BODY = 'The local service didn’t answer. Allow it in Settings, then Extensions, and try again. Your folders and filters are kept.';
const REFRESH_FAILED_BODY = 'You’re seeing the designs from a minute ago. New ones will appear when the refresh works.';

export const mountLibrary = (options: LibraryOptions): LibraryHandle => {
  const scope = createScope();
  let query = '';
  let tab: ListTab = 'all';
  let sort: ListSort = 'updated';
  let libraryView: LibraryView = 'tiles';
  let systemFilter: SystemFilter = ALL_SYSTEMS;
  /** The remembered view; the one actually shown is `resolveScope` of it (a project or folder that is gone reads as All designs). */
  let chosen: ListScope = ALL_SCOPE;
  let projects: ProjectInfo[] = [];
  /** What the open card menus and the card lines need, refreshed on every paint. */
  let view: { scope: ListScope; groups: readonly ProjectGroup[]; root: string; manual: ManualProjects; folder: FolderRef | null } = { scope: ALL_SCOPE, groups: [], root: '', manual: [], folder: null };
  /** null follows the page width (open from 900 px); the sidebar button sets it. */
  let sidebarWanted: boolean | null = null;
  let narrow = false;
  const folderStore = foldersStore();
  const systemStore = systemsStore();
  const thumbs = new Map<string, ThumbHandle>();
  const el = h('div', { class: 'dc-library' });

  const newButton = btn({ label: 'New', variant: 'default', size: 'default', icon: 'plus', chevron: true, onClick: () => undefined });
  attachMenu(
    newButton.el,
    () => [
      { id: 'canvas', label: 'Canvas…', hint: 'several screens' },
      { id: 'page', label: 'Page…', hint: 'one HTML page' },
    ],
    (id) => options.onNew(id === 'page' ? 'page' : 'canvas'),
  );
  const settingsButton = iconBtn({ icon: 'gear', label: 'Settings', onClick: () => options.onSettings() });
  const systemsButton = btn({ label: 'Design systems', variant: 'ghost', size: 'default', icon: 'system', onClick: () => options.onSystems() });

  const searchHost = h('div', { class: 'dc-search' });
  const search = mountSearchField(searchHost, { value: '', placeholder: 'Search designs', label: 'Search designs', onChange: (value) => {
    query = value;
    search.update({ value });
    paintGrid();
  } });
  const tabsHost = h('div', { class: 'dc-tabs' });
  const tabsHandle = mountTabs(tabsHost, { items: LIST_TABS.map(({ id, label }) => ({ id, label })), activeId: tab, trackBackground: true, onChange: (id) => {
    tab = LIST_TABS.find((entry) => entry.id === id)?.id ?? 'all';
    tabsHandle.update({ activeId: tab });
    paintGrid();
  } });
  const systemHost = h('div', { class: 'dc-inline-select dc-system-select' });
  const systemSelect = mountSelect(systemHost, { label: 'System', value: 'all', options: [{ id: 'all', label: 'All systems' }, { id: 'none', label: 'No system' }], onChange: (id) => {
    systemFilter = systemFilterFromId(id);
    paintGrid();
  } });
  const sortHost = h('div', { class: 'dc-inline-select dc-sort-select' });
  const sortSelect = mountSelect(sortHost, { label: 'Sort', value: sort, options: LIST_SORTS.map(({ id, label }) => ({ id, label })), onChange: (id) => {
    sort = LIST_SORTS.find((entry) => entry.id === id)?.id ?? 'updated';
    sortSelect.update({ value: sort });
    void host.storage.set(sortStorageKey('page'), sort);
    paintGrid();
  } });
  const viewButton = (view: LibraryView, label: string, glyph: 'tiles' | 'list'): HTMLButtonElement =>
    h('button', { type: 'button', class: 'dc-view-toggle-btn', 'aria-pressed': String(libraryView === view), 'aria-label': `View as ${label.toLowerCase()}` }, icon(glyph, 14), label);
  const tilesButton = viewButton('tiles', 'Tiles', 'tiles');
  const listButton = viewButton('list', 'List', 'list');
  const viewToggle = h('div', { class: 'dc-view-toggle', role: 'group', 'aria-label': 'View' }, tilesButton, listButton);
  const setView = (next: LibraryView): void => {
    if (libraryView === next) return;
    libraryView = next;
    void host.storage.set(viewStorageKey, next);
    paintGrid();
  };
  tilesButton.addEventListener('click', () => setView('tiles'));
  listButton.addEventListener('click', () => setView('list'));

  const sidebarToggle = iconBtn({ icon: 'sidebar', label: 'Projects, folders and design systems', pressed: true, onClick: () => toggleSidebar() });
  const countLine = h('span', { class: 'dc-page-count', hidden: true });
  const toolbar = h(
    'header',
    { class: 'dc-library-bar' },
    sidebarToggle,
    h('h1', { class: 'dc-page-title' }, 'Designs', countLine),
    h('span', { class: 'dc-spacer' }),
    systemsButton.el,
    settingsButton,
    newButton.el,
  );
  const controls = h('div', { class: 'dc-library-controls', role: 'toolbar', 'aria-label': 'Filter and arrange the library' }, searchHost, tabsHost, systemHost, sortHost, viewToggle);
  const notices = h('div', { class: 'dc-library-notices' });
  // Long-lived: repaints of the other notices never detach it, so focus and an import in flight survive.
  const syncNotices = (): void => {
    notices.hidden = ![...notices.children].some((child) => child instanceof HTMLElement && !child.hidden);
  };
  const looseBanner = mountLooseBanner({ sheetHost: options.actions.host, onOpen: options.onOpen, onPaint: syncNotices });
  notices.append(looseBanner.el);
  const undo = mountUndoNotice();
  const undoHost = h('div', { class: 'dc-library-undo' }, undo.el);
  const grid = h('ul', { class: 'dc-grid', role: 'list', 'aria-label': 'Designs' });
  const listHead = h('div', { class: 'dc-list-head', 'aria-hidden': 'true' }, h('span'), h('span', null, 'Name'), h('span', { class: 'dc-list-head-system' }, 'System'), h('span', { class: 'dc-list-head-in' }, 'In'), h('span', { class: 'dc-list-head-when' }, 'Updated'), h('span'));
  const list = h('ul', { class: 'dc-library-list', role: 'list', 'aria-label': 'Designs' });
  const listWrap = h('div', { class: 'dc-list-wrap', 'data-chip': 'true', hidden: true }, listHead, list);
  const scroller = h('div', { class: 'dc-library-scroll' }, undoHost, notices, grid, listWrap);
  const sidebar = mountSidebar({
    onSelect: (next) => {
      setScope(next);
      if (narrow) setSidebar(false);
    },
    onDrop: (folder, slug) => {
      const design = store.getState().designs.data?.designs.find((entry) => entry.slug === slug);
      if (design) void addToFolder(folder, { slug, title: design.title });
    },
    onRetryFolders: () => void folderStore.load(),
    onCreate: async (name) => {
      const folder = await folderStore.create(name);
      toast('success', `Made folder ${folder.name}.`);
    },
    onRename: async (folder, name) => void (await folderStore.rename(folder.id, name)),
    onDelete: (folder) => {
      // The view falls back to All designs while the folder is gone, and returns to it with Undo.
      void deleteFolder({ id: folder.id, name: folder.name }, undo);
    },
    validate: (name, ignoreId) => folderNameProblem(name, folderStore.get().folders, ignoreId),
    // A system row filters the library and keeps the scope; on a floating sidebar it then gets out of the way.
    onFilterSystem: (id) => {
      setSystemFilter({ kind: 'system', id });
      if (narrow) setSidebar(false);
    },
    onSystems: () => options.onSystems(),
    onNewSystem: () => newSystem(),
    onRetrySystems: () => void systemStore.load(),
    onRetryDesigns: () => void store.refreshDesigns(),
  });
  const body = h('div', { class: 'dc-library-body' }, sidebar.el, scroller);
  el.append(toolbar, controls, body);

  const sidebarOpen = (): boolean => sidebarWanted ?? !narrow;
  const paintSidebarState = (): void => {
    const open = sidebarOpen();
    body.dataset.sidebar = open ? 'open' : 'closed';
    body.dataset.narrow = narrow ? 'true' : 'false';
    sidebarToggle.setAttribute('aria-pressed', String(open));
    sidebarToggle.setAttribute('aria-expanded', String(open));
    sidebar.el.inert = !open;
  };
  const setSidebar = (open: boolean): void => {
    sidebarWanted = open;
    paintSidebarState();
  };
  const toggleSidebar = (): void => {
    setSidebar(!sidebarOpen());
    if (sidebarOpen()) sidebar.focusSelected();
  };
  const sizeWatcher = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    const next = width > 0 && width < SIDEBAR_MIN_PAGE_WIDTH;
    if (next === narrow) return;
    narrow = next;
    paintSidebarState();
  });
  sizeWatcher.observe(el);
  scope.add(() => sizeWatcher.disconnect());
  // Escape closes the sidebar when it floats over the grid.
  sidebar.el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && narrow && sidebarOpen() && !event.defaultPrevented) {
      event.preventDefault();
      setSidebar(false);
      sidebarToggle.focus();
    }
  });

  const setSystemFilter = (next: SystemFilter): void => {
    systemFilter = next;
    paintGrid();
  };

  const newSystem = (source?: 'existing'): void => openNewSystemSheet(options.actions.host, { ...(source ? { source } : {}), onMade: (result) => options.actions.onOpenSystem?.(result.id) });

  /** The host's project names make "From shop" read like the user's own words; without them the folder name stands in. */
  const projectLabel = (directory: string): string => projects.find((project) => sameDirectory(project.directory, directory))?.name ?? folderName(directory);

  const setScope = (next: ListScope): void => {
    chosen = next;
    void host.storage.set(scopeStorageKey('page'), scopeToId(next));
    paintGrid();
  };

  const switchBack = async (path: string): Promise<void> => {
    try {
      await store.updateSettings({ root: path });
      await store.refreshDesigns();
    } catch (error) {
      toast('error', `Couldn’t switch back. ${error instanceof Error ? error.message : ''}`);
    }
  };

  /** What the row and card menus offer here: the folder being viewed, or a project this design is a manual member of. */
  let manualSlugs = new Set<string>();
  /** The first colour of each system, for the chips' dots; refreshed on every paint. */
  let swatches: (id: string) => string | null = () => null;
  const menuFor = (design: DesignSummary): DesignMenuView => {
    if (view.folder) return { folder: view.folder, project: null };
    if (view.scope.kind === 'project') {
      const label = scopeLabel(view.scope, view.groups, folderStore.get().folders);
      return { folder: null, project: { directory: view.scope.directory, label: label ?? view.scope.directory, manual: manualSlugs.has(design.slug) } };
    }
    return { folder: null, project: null };
  };

  const card = (design: DesignSummary): HTMLElement => {
    let thumb = thumbs.get(design.slug);
    if (thumb) thumb.update(design);
    else {
      thumb = mountThumb(design, 'card');
      thumbs.set(design.slug, thumb);
    }
    const line = cardProjectLine(design, view.scope, view.groups, view.root, view.manual);
    const kindBadge = h('span');
    mountBadge(kindBadge, { label: kindLabel(design.kind), tone: 'neutral' });
    const locale = host.snapshot()?.locale ?? 'en';
    const indicators = h('span', { class: 'dc-card-flags' });
    if (systemUpdated(design)) indicators.append(h('span', { class: 'dc-flag', 'data-tone': 'info', title: `${design.system?.name ?? 'The design system'} was updated since this design copied it.` }, SYSTEM_UPDATED_LABEL));
    if (design.openComments > 0) indicators.append(h('span', { class: 'dc-flag', title: plural(design.openComments, 'open comment') }, icon('pin', 12), String(design.openComments)));
    if (design.sessionId) indicators.append(h('span', { class: 'dc-flag dc-flag-icon', title: 'Linked to a chat', role: 'img', 'aria-label': 'Linked to a chat' }, icon('chat', 12)));
    const main = h(
      'button',
      { type: 'button', class: 'dc-card-main', 'aria-label': rowAriaLabel(design) },
      h('span', { class: 'dc-card-thumb' }, thumb.el, design.pending ? h('span', { class: 'dc-card-overlay' }, h('span', { class: 'dc-flag', 'data-tone': 'warning' }, 'Waiting for agent')) : null),
      h(
        'span',
        { class: 'dc-card-body' },
        h('span', { class: 'dc-card-title' }, design.title),
        line ? h('span', { class: 'dc-card-project', title: line.title, 'data-filed': line.manual ? 'true' : null }, icon('layers', 12), h('span', { class: 'dc-card-project-name' }, line.label)) : null,
        h('span', { class: 'dc-card-meta' }, kindBadge, h('span', { class: 'dc-muted' }, relativeTime(design.updated, Date.now(), locale)), indicators),
      ),
    );
    main.addEventListener('click', () => options.onOpen(design.slug));
    const more = iconBtn({ icon: 'more', label: `Actions for ${design.title}`, size: 'sm', onClick: () => undefined });
    more.classList.add('dc-card-more');
    const ref = { slug: design.slug, title: design.title, kind: design.kind, sessionId: design.sessionId };
    attachMenu(more, () => listDesignMenu(menuFor(design)), (id) => runListAction(id, ref, options.actions, menuFor(design)));
    const chip = designSystemChip(design, { actions: options.actions, swatchOf: swatches });
    const item = h('li', { class: 'dc-card', 'data-slug': design.slug, 'data-pending': design.pending ? 'true' : 'false', draggable: 'true' }, main, chip === null ? null : h('div', { class: 'dc-card-foot' }, chip), more);
    // Drag a card onto a folder in the sidebar to add it. Add to folder… in the menu does the same with a click.
    item.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData(DESIGN_DRAG_TYPE, design.slug);
      event.dataTransfer.effectAllowed = 'copy';
      item.dataset.dragging = 'true';
    });
    item.addEventListener('dragend', () => {
      delete item.dataset.dragging;
    });
    return item;
  };

  const skeletons = (): HTMLElement[] =>
    libraryView === 'tiles'
      ? Array.from({ length: SKELETON_CARDS }, () => h('li', { class: 'dc-card dc-card-skeleton', 'aria-hidden': 'true' }, h('span', { class: 'dc-skel dc-skel-card' }), h('span', { class: 'dc-skel dc-skel-line' }), h('span', { class: 'dc-skel dc-skel-line dc-skel-short' })))
      : Array.from({ length: SKELETON_ROWS }, () =>
          h(
            'li',
            { class: 'dc-row dc-list-row dc-row-skeleton', 'aria-hidden': 'true' },
            h('span', { class: 'dc-row-thumb' }, h('span', { class: 'dc-skel dc-skel-thumb' })),
            h('span', { class: 'dc-row-name' }, h('span', { class: 'dc-skel dc-skel-line' }), h('span', { class: 'dc-skel dc-skel-line dc-skel-short' })),
            h('span', { class: 'dc-row-in' }, h('span', { class: 'dc-skel dc-skel-line dc-skel-short' })),
            h('span', { class: 'dc-row-when' }, h('span', { class: 'dc-skel dc-skel-line dc-skel-short' })),
          ),
        );

  const message = (...children: Array<Node>): HTMLElement => h('li', { class: 'dc-grid-message' }, ...children);
  /** The container the current view paints into; the other one stays hidden. */
  const activeList = (): HTMLElement => (libraryView === 'tiles' ? grid : list);
  const paintViewState = (): void => {
    grid.hidden = libraryView !== 'tiles';
    listWrap.hidden = libraryView !== 'list';
    tilesButton.setAttribute('aria-pressed', String(libraryView === 'tiles'));
    listButton.setAttribute('aria-pressed', String(libraryView === 'list'));
  };
  const showLoading = (): void => {
    scroller.setAttribute('aria-busy', 'true');
    activeList().append(...skeletons(), h('li', { class: 'dc-grid-message dc-sr-only', role: 'status' }, 'Loading your designs'));
  };

  const clearFilters = (): void => {
    query = '';
    tab = 'all';
    systemFilter = ALL_SYSTEMS;
    search.update({ value: '' });
    tabsHandle.update({ activeId: 'all' });
    paintGrid();
  };

  /** A used-by link or a chip: every design that uses this system, nothing else in the way. */
  const filterBySystem = (id: string): void => {
    chosen = ALL_SCOPE;
    query = '';
    tab = 'all';
    systemFilter = { kind: 'system', id };
    search.update({ value: '' });
    tabsHandle.update({ activeId: 'all' });
    paintGrid();
  };

  const paintNotices = (): void => {
    for (const child of [...notices.children]) if (child !== looseBanner.el) child.remove();
    const state = store.getState();
    if (state.designs.status === 'error' && state.designs.data) {
      const wrap = h('div', { class: 'dc-banner' });
      mountBanner(wrap, { tone: 'warning', title: 'Couldn’t refresh the list', body: REFRESH_FAILED_BODY, action: { label: 'Try again', onClick: () => void store.refreshDesigns() } });
      looseBanner.el.before(wrap);
    }
    const first = state.settings.data?.previousRoots.find((root) => root.exists && root.designCount > 0);
    if (first) {
      const wrap = h('div', { class: 'dc-banner' });
      mountBanner(wrap, { tone: 'info', title: `${designCountLabel(first.designCount)} remain in your earlier folder`, body: middlePath(first.path), action: { label: 'Switch back', onClick: () => void switchBack(first.path) } });
      wrap.title = first.path;
      looseBanner.el.before(wrap);
    }
    looseBanner.update(state.designs.data?.loose ?? null);
    syncNotices();
  };

  const paintGrid = (): void => {
    const previousScroll = scroller.scrollTop;
    const state = store.getState().designs;
    grid.replaceChildren();
    list.replaceChildren();
    paintViewState();
    paintNotices();
    scroller.removeAttribute('aria-busy');
    if ((state.status === 'idle' || state.status === 'loading') && !state.data) {
      countLine.hidden = true;
      sidebar.paintWithoutDesigns('loading');
      paintSidebarState();
      showLoading();
      return;
    }
    if (!state.data) {
      countLine.hidden = true;
      sidebar.paintWithoutDesigns('failed');
      paintSidebarState();
      const wrap = h('div', { class: 'dc-banner' });
      mountBanner(wrap, { tone: 'error', title: 'Your designs didn’t load', body: state.error?.message ? `${state.error.message} Your folders and filters are kept.` : LOAD_FAILED_BODY, action: { label: 'Try again', onClick: () => void store.refreshDesigns() } });
      activeList().append(message(wrap));
      return;
    }
    const all = state.data.designs;
    const root = state.data.root;
    const foldersState: FoldersState = folderStore.get();
    const folderList = foldersState.status === 'error' ? [] : foldersState.folders;
    const manualProjects: ManualProjects = foldersState.projects;
    const groups = projectGroups(all, projects, root, state.data.projectFolders, manualProjects);
    const foldersPending = chosen.kind === 'folder' && (foldersState.status === 'idle' || foldersState.status === 'loading') && foldersState.folders.length === 0;
    const effective = foldersPending ? chosen : resolveScope(chosen, groups, folderList);
    const folder = effective.kind === 'folder' ? folderList.find((entry) => entry.id === effective.id) ?? null : null;
    view = { scope: effective, groups, root, manual: manualProjects, folder: folder ? { id: folder.id, name: folder.name } : null };
    manualSlugs = new Set(effective.kind === 'project' ? foldersState.projects.find((entry) => sameDirectory(entry.directory, effective.directory))?.slugs ?? [] : []);
    const counts4 = scopeCounts(all, folderList, root, manualProjects);

    // Systems: the filter's options are every system, because a design in any scope can carry any
    // system's copy (the canvas draws a folder scope with a system filter active). A failed load
    // leaves All systems / No system only. The tiles themselves follow the scope (`libraryItems`).
    const systemsState = systemStore.get();
    const systemList = systemsState.status === 'error' ? [] : systemsState.systems ?? [];
    const systemsFailed = systemsState.status === 'error' && systemsState.systems === null;
    systemFilter = resolveSystemFilter(systemFilter, systemList);
    swatches = swatchLookup(systemList);
    sidebar.paint({
      scope: effective,
      counts: counts4,
      groups,
      folders: folderList,
      foldersStatus: foldersState.status === 'error' ? 'error' : foldersState.status === 'ready' ? 'ready' : 'loading',
      foldersError: foldersState.error,
      systems: sidebarSystems(systemList),
      systemFilter,
      systemsStatus: systemsFailed ? 'error' : systemsState.systems === null ? 'loading' : 'ready',
    });
    paintSidebarState();
    const label = scopeLabel(effective, groups, folderList);
    const systemEntries = systemOptions(systemList);
    systemSelect.update({ value: systemFilterToId(systemFilter), options: systemEntries });
    nameSelect(systemHost, 'System', systemEntries.find((entry) => entry.id === systemFilterToId(systemFilter))?.label ?? 'All systems');
    nameSelect(sortHost, 'Sort', LIST_SORTS.find((entry) => entry.id === sort)?.label ?? 'Updated');

    if (foldersPending || (tab === 'system' && systemsState.systems === null && !systemsFailed)) {
      countLine.hidden = true;
      showLoading();
      scroller.scrollTop = previousScroll;
      return;
    }
    const filters = { query, tab, system: systemFilter };
    const { scoped, scopedSystems, items, lead, shownDesigns, shownSystems, counts } = libraryItems({ designs: all, systems: systemList, scope: effective, folders: folderList, designsRoot: root, filters, sort, manual: manualProjects });
    countLine.hidden = false;
    const totals = scopedSystems.length > 0 ? `${plural(scoped.length, 'design')} and ${plural(scopedSystems.length, 'system')}` : plural(scoped.length, 'design');
    // With a scope active the line names it too: the sidebar may be closed on a narrow page.
    countLine.textContent = label === null ? totals : `${label} · ${totals}`;
    tabsHandle.update({ items: LIST_TABS.map(({ id, label: tabLabel }) => ({ id, label: tabLabel, count: counts[id] })) });
    const empty = emptyStateOf({ all, scoped, shown: shownDesigns, shownSystems, scope: effective, scopeLabel: label, folderName: folder?.name ?? null, filters, systems: systemList, systemsFailed, draggable: true });
    if (empty) {
      const wrap = h('div');
      mountLibraryEmpty(wrap, empty, {
        // First run: nothing to show yet, so offer the system start too (not while the systems list is unknown).
        ...(systemsState.systems !== null && systemList.length === 0 && !systemsFailed ? { firstRun: { onNewSystem: () => newSystem(), onExistingSystem: () => newSystem('existing') } } : {}),
        onAction: () => {
          if (empty.action === 'new') options.onNew('canvas');
          else if (empty.action === 'show-all') setScope(ALL_SCOPE);
          else if (empty.action === 'new-system') newSystem();
          else if (empty.action === 'retry-systems') void systemStore.load();
          else clearFilters();
        },
        onClearChip: (id) => {
          if (id === 'search') {
            query = '';
            search.update({ value: '' });
          } else if (id === 'tab') {
            tab = 'all';
            tabsHandle.update({ activeId: 'all' });
          } else systemFilter = ALL_SYSTEMS;
          paintGrid();
        },
      });
      activeList().append(message(wrap));
    } else {
      const systemActions = { label: projectLabel, onOpen: (id: string) => options.actions.onOpenSystem?.(id), onPreview: (id: string) => options.actions.onOpenSystem?.(id, 'preview'), onShowDesigns: (id: string) => filterBySystem(id) };
      const rowView: DesignRowView = { scope: effective, groups, root, manual: manualProjects, menu: { folder: null, project: null } };
      const nodes = items.map((item) => {
        if (item.kind === 'system') return libraryView === 'tiles' ? mountSystemTile(item.system, { ...systemActions, lead: item.system === lead }) : mountSystemListRow(item.system, systemActions);
        return libraryView === 'tiles' ? card(item.design) : mountDesignRow(item.design, { variant: 'list', view: { ...rowView, menu: menuFor(item.design) }, actions: options.actions, onOpen: options.onOpen, thumbs, swatchOf: swatches });
      });
      activeList().append(...nodes);
    }
    const live = new Set(all.map((design) => design.slug));
    for (const [slug, handle] of thumbs) {
      if (!live.has(slug)) {
        handle.dispose();
        thumbs.delete(slug);
      }
    }
    scroller.scrollTop = previousScroll;
  };

  let signature = '';
  scope.add(
    store.subscribe(() => {
      const state = store.getState();
      const next = `${state.designs.status}:${state.designs.data?.root ?? ''}:${JSON.stringify(state.designs.data?.projectFolders ?? null)}:${JSON.stringify(state.designs.data?.designs ?? null)}:${JSON.stringify(state.designs.data?.loose ?? null)}:${state.designs.error?.message ?? ''}:${JSON.stringify(state.settings.data?.previousRoots ?? null)}`;
      if (next === signature) return;
      signature = next;
      paintGrid();
    }),
  );
  const minute = setInterval(paintGrid, 60_000);
  scope.add(() => clearInterval(minute));
  scope.add(folderStore.subscribe(paintGrid));
  scope.add(systemStore.subscribe(paintGrid));

  // The remembered scope, sort and view, and the host's project names, arrive after the first paint;
  // a failure of any only costs the memory or the nicer name.
  void host.storage.get(scopeStorageKey('page')).then((stored) => {
    chosen = scopeFromId(stored);
    paintGrid();
  });
  void host.storage.get(sortStorageKey('page')).then((stored) => {
    sort = sortFromStored(stored);
    sortSelect.update({ value: sort });
    paintGrid();
  });
  void host.storage.get(viewStorageKey).then((stored) => {
    libraryView = viewFromStored(stored);
    paintGrid();
  });
  void guestHost.client.listProjects().then(
    (answer) => {
      projects = answer.projects.map((project) => ({ directory: project.directory, name: project.name }));
      paintGrid();
    },
    (error: unknown) => console.warn('Design Chamber: the project names could not be read; folders show their own names', error),
  );

  void store.refreshDesigns();
  void store.loadSettings();
  paintGrid();

  return {
    el,
    focusCard: (slug) => {
      const escaped = CSS.escape(slug);
      (grid.querySelector<HTMLElement>(`[data-slug="${escaped}"] .dc-card-main`) ?? list.querySelector<HTMLElement>(`[data-slug="${escaped}"] .dc-row-hit`))?.focus();
    },
    focusSystems: () => systemsButton.el.focus(),
    focusSystemEntry: (id) => {
      const escaped = CSS.escape(id);
      const entry = scroller.querySelector<HTMLElement>(`[data-system-id="${escaped}"] .dc-card-main, [data-system-id="${escaped}"] .dc-row-hit, [data-system-id="${escaped}"].dc-design-system-chip`);
      (entry ?? systemsButton.el).focus();
    },
    filterBySystem,
    dispose: () => {
      scope.dispose();
      looseBanner.dispose();
      for (const handle of thumbs.values()) handle.dispose();
      thumbs.clear();
      search.dispose();
      tabsHandle.dispose();
      sortSelect.dispose();
      systemSelect.dispose();
      sidebar.dispose();
      undo.dispose();
      el.remove();
    },
  };
};
