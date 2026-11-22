// R1, the rail's designs list: header (Design systems, Settings, New), search, the Show select,
// the System and Sort pair, three kind tabs (All counts designs only, no system rows among them),
// thumbnail rows with badges, a system chip and a row menu, a pinned "Design systems" entry under the
// list (and the header icon) that opens the systems list, an empty state
// that names every active filter, a notice when an earlier folder still holds designs, and the
// offer to import loose HTML files saved straight into the designs folder. Sort is remembered
// (host.storage `list-sort:panel`); search, tab and the System filter live for the session.
// At 320 px the title keeps its 120 px budget and the pair truncates its values, never the title.

import { mountBanner, mountSearchField, mountSelect, mountTabs } from '@openchamber/sdk/ui';

import type { DesignSummary } from '../../shared/types.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import { type ActionContext } from '../components/actions.ts';
import { mountDesignRow, type DesignRowView } from '../components/design-row.ts';
import { createScope, h } from '../components/dom.ts';
import { deleteFolder, mountUndoNotice, openNewFolder, openRenameFolder, type DesignMenuView, type FolderRef } from '../components/folder-actions.ts';
import { folders as foldersStore, type FoldersState } from '../components/folders-store.ts';
import { icon } from '../components/icons.ts';
import { attachMenu, btn, iconBtn, nameSelect } from '../components/kit.ts';
import { mountLibraryEmpty } from '../components/library-empty.ts';
import { mountLooseBanner } from '../components/loose-banner.ts';
import { systems as systemsStore } from '../components/systems-store.ts';
import { type ThumbHandle } from '../components/thumb.ts';
import { guestHost, host, store } from '../guest.ts';
import { dismissedTip, shouldShowTip, TIP_KEY } from '../model/findability-model.ts';
import { middlePath } from '../model/format.ts';
import {
  ALL_SCOPE,
  ALL_SYSTEMS,
  LIST_SORTS,
  RAIL_TABS,
  emptyStateOf,
  libraryItems,
  projectGroups,
  resolveScope,
  resolveSystemFilter,
  scopeCounts,
  scopeFromId,
  scopeLabel,
  scopeOptions,
  scopeStorageKey,
  scopeToId,
  sortFromStored,
  sortStorageKey,
  systemFilterFromId,
  systemFilterToId,
  systemOptions,
  systemsEntryLabel,
  type ListScope,
  type ListSort,
  type ListTab,
  type ManualProjects,
  type ProjectGroup,
  type ProjectInfo,
  type SystemFilter,
} from '../model/list-model.ts';
import { designCountLabel } from '../model/settings-model.ts';
import { swatchLookup } from '../model/systems-model.ts';
import { openNewSystemSheet } from '../systems/new-system-sheet.ts';
import { toast } from '../components/actions.ts';

export type ListViewOptions = {
  actions: ActionContext;
  onNew: (kind: 'canvas' | 'page') => void;
  onSettings: () => void;
  /** Opens the design systems list (Phase 2.5): from the header icon and from the entry under the list. */
  onSystems: () => void;
  onOpen: (slug: string) => void;
};

export type ListViewHandle = {
  el: HTMLElement;
  focusRow: (slug: string) => void;
  focusSystems: () => void;
  /** Back from a system opened out of the list: focus the chip that opened it, else the entry that opened the systems list. */
  focusSystemEntry: (id: string) => void;
  /** Show the list filtered to one system: scope All, tab All, no search (a used-by link or a chip lands here). */
  filterBySystem: (id: string) => void;
  dispose: () => void;
};

const SKELETON_ROWS = 4;
/** The Show select's last entry: an action, not a scope. Picking it opens the New folder dialog and the select goes back to the current scope. */
const NEW_FOLDER_ID = '__new-folder';

const LOAD_FAILED_BODY = 'The local service didn’t answer. Allow it in Settings, then Extensions, and try again. Your folders and filters are kept.';
const REFRESH_FAILED_BODY = 'You’re seeing the designs from a minute ago. New ones will appear when the refresh works.';

export const mountListView = (options: ListViewOptions): ListViewHandle => {
  const scope = createScope();
  let query = '';
  let tab: ListTab = 'all';
  let sort: ListSort = 'updated';
  let systemFilter: SystemFilter = ALL_SYSTEMS;
  /** The remembered view; the one shown is `resolveScope` of it (a project or folder that is gone reads as All designs). */
  let chosen: ListScope = ALL_SCOPE;
  let projects: ProjectInfo[] = [];
  let view: { scope: ListScope; groups: readonly ProjectGroup[]; root: string; manual: ManualProjects; folder: FolderRef | null } = { scope: ALL_SCOPE, groups: [], root: '', manual: [], folder: null };
  /** The first colour of each system, for the chips' dots; refreshed on every paint. */
  let swatches: (id: string) => string | null = () => null;
  const folderStore = foldersStore();
  const systemStore = systemsStore();
  const thumbs = new Map<string, ThumbHandle>();

  const el = h('div', { class: 'dc-list-view' });

  // header: the title keeps its room; the controls sit beside it (the approved canvas's order).
  const newButton = btn({ label: 'New', variant: 'default', size: 'sm', icon: 'plus', chevron: true, onClick: () => undefined });
  attachMenu(
    newButton.el,
    () => [
      { id: 'canvas', label: 'Canvas…', hint: 'several screens' },
      { id: 'page', label: 'Page…', hint: 'one HTML page' },
    ],
    (id) => options.onNew(id === 'page' ? 'page' : 'canvas'),
  );
  const settingsButton = iconBtn({ icon: 'gear', label: 'Settings', onClick: () => options.onSettings() });
  /** Which of the two entries opened the systems list, so Back returns focus to it. */
  let systemsOpener: 'icon' | 'foot' = 'icon';
  const systemsButton = iconBtn({ icon: 'system', label: 'Design systems', onClick: () => {
    systemsOpener = 'icon';
    options.onSystems();
  } });
  const head = h('header', { class: 'dc-rail-head' }, h('h1', { class: 'dc-rail-title' }, 'Designs'), h('span', { class: 'dc-spacer' }), systemsButton, settingsButton, newButton.el);

  // filters
  const searchHost = h('div', { class: 'dc-search' });
  const search = mountSearchField(searchHost, { value: '', placeholder: 'Search designs', label: 'Search designs', onChange: (value) => {
    query = value;
    search.update({ value });
    paintList();
  } });
  const tabsHost = h('div', { class: 'dc-tabs' });
  const tabsHandle = mountTabs(tabsHost, { items: RAIL_TABS.map(({ id, label }) => ({ id, label })), activeId: tab, trackBackground: true, onChange: (id) => {
    tab = RAIL_TABS.find((entry) => entry.id === id)?.id ?? 'all';
    tabsHandle.update({ activeId: tab });
    paintList();
  } });
  // Show: the same groups as the page's sidebar (all, each project, No project, each folder) in one select.
  const showHost = h('div', { class: 'dc-rail-show-select dc-inline-select' });
  const showSelect = mountSelect(showHost, { label: 'Show', value: 'all', options: [{ id: 'all', label: 'All designs' }], onChange: (id) => {
    if (id !== NEW_FOLDER_ID) {
      setScope(scopeFromId(id));
      return;
    }
    // Not a scope: put the select back on the current one before the dialog opens, so closing it changes nothing.
    paintList();
    openNewFolder(options.actions.host);
  } });
  const folderMore = iconBtn({ icon: 'more', label: 'Folder actions', size: 'md', onClick: () => undefined });
  folderMore.hidden = true;
  attachMenu(
    folderMore,
    () => [
      { id: 'new-folder', label: 'New folder…' },
      { separator: true },
      { id: 'rename', label: 'Rename folder' },
      { separator: true },
      { id: 'delete', label: 'Delete folder', destructive: true },
    ],
    (id) => {
      const folder = view.folder;
      if (id === 'new-folder') {
        openNewFolder(options.actions.host);
        return;
      }
      if (!folder) return;
      if (id === 'rename') openRenameFolder(options.actions.host, folder);
      // The view falls back to All designs while the folder is gone, and returns to it with Undo.
      else void deleteFolder(folder, undo);
    },
  );
  const showRow = h('div', { class: 'dc-rail-show' }, showHost, folderMore);
  // System and Sort side by side, each half width; at 320 px their values truncate, the title never does.
  const systemHost = h('div', { class: 'dc-inline-select dc-rail-pair-select dc-system-select' });
  const systemSelect = mountSelect(systemHost, { label: 'System', value: 'all', options: [{ id: 'all', label: 'All systems' }, { id: 'none', label: 'No system' }], onChange: (id) => {
    systemFilter = systemFilterFromId(id);
    paintList();
  } });
  const sortHost = h('div', { class: 'dc-inline-select dc-rail-pair-select dc-sort-select' });
  const sortSelect = mountSelect(sortHost, { label: 'Sort', value: sort, options: LIST_SORTS.map(({ id, label }) => ({ id, label })), onChange: (id) => {
    sort = LIST_SORTS.find((entry) => entry.id === id)?.id ?? 'updated';
    sortSelect.update({ value: sort });
    void host.storage.set(sortStorageKey('panel'), sort);
    paintList();
  } });
  const pairRow = h('div', { class: 'dc-rail-pair' }, systemHost, sortHost);
  // Folders that can't be read: projects still work, and the way out sits next to the select.
  const foldersNote = h('div', { class: 'dc-rail-folders-note', hidden: true }, h('p', { class: 'dc-form-error' }, 'Folders couldn’t load. Try again.'), btn({ label: 'Try again', variant: 'outline', size: 'xs', onClick: () => void folderStore.load() }).el);
  const filters = h('div', { class: 'dc-rail-filters' }, searchHost, showRow, pairRow, foldersNote, tabsHost);

  // First-run tip (feat/findability): where the full-screen page is. The rail cannot open it
  // from code (an extension has no such API), so it points at the sidebar menu that does.
  const tipHost = h('div', { class: 'dc-rail-tip', hidden: true });
  let tipWanted: boolean | null = null;
  let tipHidden = false;
  const paintTip = (): void => {
    const state = store.getState().designs;
    const failed = state.status === 'error' && !state.data;
    const show = tipWanted === true && !tipHidden && !failed;
    tipHost.hidden = !show;
    if (!show) {
      tipHost.replaceChildren();
      return;
    }
    if (tipHost.firstElementChild) return;
    mountBanner(tipHost, {
      tone: 'info',
      title: 'Open Design Chamber full screen',
      body: 'In the sidebar, open Extension pages and pick Design Chamber. Canvases get the whole window there.',
      action: { label: 'Got it', onClick: dismissTip },
    });
  };
  const dismissTip = (): void => {
    tipHidden = true;
    paintTip();
    searchHost.querySelector<HTMLElement>('input')?.focus();
    // A failed write is swallowed by the host wrapper: the tip stays gone for this session and returns next time.
    void host.storage.set(TIP_KEY, dismissedTip(new Date()));
  };
  void host.storage.get(TIP_KEY).then((stored) => {
    tipWanted = shouldShowTip(stored);
    paintTip();
  });

  const notices = h('div', { class: 'dc-rail-notices' });
  // Long-lived: repaints of the other notices never detach it, so focus and an import in flight survive.
  const syncNotices = (): void => {
    notices.hidden = ![...notices.children].some((child) => child instanceof HTMLElement && !child.hidden);
  };
  const looseBanner = mountLooseBanner({ sheetHost: options.actions.host, onOpen: options.onOpen, onPaint: syncNotices });
  notices.append(looseBanner.el);
  const undo = mountUndoNotice();
  const list = h('ul', { class: 'dc-rows', role: 'list', 'aria-label': 'Designs' });
  const scroller = h('div', { class: 'dc-rail-scroll' }, h('div', { class: 'dc-rail-undo' }, undo.el), notices, list);
  // The pinned entry under the list: systems are not rows here, so this is where a rail user finds them (the approved canvas's rail-nav).
  const footCount = h('span', { class: 'dc-rail-nav-count' });
  const foot = h(
    'button',
    { type: 'button', class: 'dc-rail-nav', 'aria-label': systemsEntryLabel(null), title: 'Design systems', onClick: () => {
      systemsOpener = 'foot';
      options.onSystems();
    } },
    icon('system', 16),
    h('span', { class: 'dc-rail-nav-name' }, 'Design systems'),
    footCount,
    icon('chevron-right', 16),
  );
  el.append(head, tipHost, filters, scroller, foot);

  const switchBack = async (path: string): Promise<void> => {
    try {
      await store.updateSettings({ root: path });
      await store.refreshDesigns();
    } catch (error) {
      toast('error', `Couldn’t switch back. ${error instanceof Error ? error.message : ''}`);
    }
  };

  /** What the row menus offer here: the folder being viewed, or a project this design is a manual member of. */
  let manualSlugs = new Set<string>();
  const menuFor = (design: DesignSummary): DesignMenuView => {
    if (view.folder) return { folder: view.folder, project: null };
    if (view.scope.kind === 'project') {
      const label = scopeLabel(view.scope, view.groups, folderStore.get().folders);
      return { folder: null, project: { directory: view.scope.directory, label: label ?? view.scope.directory, manual: manualSlugs.has(design.slug) } };
    }
    return { folder: null, project: null };
  };

  const skeleton = (): HTMLElement[] =>
    Array.from({ length: SKELETON_ROWS }, () => h('li', { class: 'dc-row dc-row-skeleton', 'aria-hidden': 'true' }, h('span', { class: 'dc-skel dc-skel-thumb' }), h('span', { class: 'dc-skel-lines' }, h('span', { class: 'dc-skel dc-skel-line' }), h('span', { class: 'dc-skel dc-skel-line dc-skel-short' }))));

  const showLoading = (): void => {
    scroller.setAttribute('aria-busy', 'true');
    list.append(...skeleton(), h('li', { class: 'dc-list-message dc-sr-only', role: 'status' }, 'Loading your designs'));
  };

  const newSystem = (source?: 'existing'): void => openNewSystemSheet(options.actions.host, { ...(source ? { source } : {}), onMade: (result) => options.actions.onOpenSystem?.(result.id) });

  /** A used-by link or a chip: every design that uses this system, nothing else in the way. */
  const filterBySystem = (id: string): void => {
    chosen = ALL_SCOPE;
    query = '';
    tab = 'all';
    systemFilter = { kind: 'system', id };
    search.update({ value: '' });
    tabsHandle.update({ activeId: 'all' });
    paintList();
  };

  const clearFilters = (): void => {
    query = '';
    tab = 'all';
    systemFilter = ALL_SYSTEMS;
    search.update({ value: '' });
    tabsHandle.update({ activeId: 'all' });
    paintList();
  };

  const paintNotices = (): void => {
    for (const child of [...notices.children]) if (child !== looseBanner.el) child.remove();
    const state = store.getState();
    if (state.designs.status === 'error' && state.designs.data) {
      const wrap = h('div', { class: 'dc-banner' });
      mountBanner(wrap, { tone: 'warning', title: 'Couldn’t refresh the list', body: REFRESH_FAILED_BODY, action: { label: 'Try again', onClick: () => void store.refreshDesigns() } });
      looseBanner.el.before(wrap);
    }
    const holders = state.settings.data?.previousRoots.filter((root) => root.exists && root.designCount > 0) ?? [];
    const first = holders[0];
    if (first) {
      const wrap = h('div', { class: 'dc-banner' });
      mountBanner(wrap, { tone: 'info', title: `${designCountLabel(first.designCount)} remain in your earlier folder`, body: middlePath(first.path), action: { label: 'Switch back', onClick: () => void switchBack(first.path) } });
      wrap.title = first.path;
      looseBanner.el.before(wrap);
    }
    looseBanner.update(state.designs.data?.loose ?? null);
    syncNotices();
  };

  const paintShow = (scope: ListScope, groups: readonly ProjectGroup[], folderList: FoldersState['folders'], counts: ReturnType<typeof scopeCounts>, foldersState: FoldersState): void => {
    const entries = scopeOptions(groups, counts, folderList);
    showSelect.update({ value: scopeToId(scope), options: [...entries.map(({ id, label, hint }) => ({ id, label, hint })), { id: NEW_FOLDER_ID, label: 'New folder…' }] });
    const current = entries.find((entry) => entry.id === scopeToId(scope));
    nameSelect(showHost, 'Show', current?.label ?? 'All designs');
    folderMore.hidden = view.folder === null;
    showRow.dataset.folders = foldersState.status === 'error' ? 'error' : 'ok';
    foldersNote.hidden = foldersState.status !== 'error';
  };

  const setScope = (next: ListScope): void => {
    chosen = next;
    void host.storage.set(scopeStorageKey('panel'), scopeToId(next));
    paintList();
  };

  /** The entry under the list counts every system, whatever the designs are doing; while they load or when they failed it shows no number and still opens the list, which says which. */
  const paintFoot = (): void => {
    const systems = systemStore.get().systems;
    const count = systems === null ? null : systems.length;
    footCount.textContent = count === null ? '' : String(count);
    foot.setAttribute('aria-label', systemsEntryLabel(count));
  };

  const paintList = (): void => {
    const state = store.getState().designs;
    paintFoot();
    list.replaceChildren();
    for (const handle of [...thumbs.values()]) handle.el.remove();
    paintNotices();
    paintTip();
    scroller.removeAttribute('aria-busy');
    if ((state.status === 'idle' || state.status === 'loading') && !state.data) {
      showLoading();
      return;
    }
    if (!state.data) {
      const wrap = h('div', { class: 'dc-banner dc-banner-block' });
      mountBanner(wrap, { tone: 'error', title: 'Your designs didn’t load', body: state.error?.message ? `${state.error.message} Your folders and filters are kept.` : LOAD_FAILED_BODY, action: { label: 'Try again', onClick: () => void store.refreshDesigns() } });
      list.append(h('li', { class: 'dc-list-message' }, wrap));
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
    paintShow(effective, groups, folderList, scopeCounts(all, folderList, root, manualProjects), foldersState);

    // Systems: the filter's options are every system (a design in any scope can carry any
    // system's copy); a failed load leaves All systems / No system only.
    const systemsState = systemStore.get();
    const systemList = systemsState.status === 'error' ? [] : systemsState.systems ?? [];
    const systemsFailed = systemsState.status === 'error' && systemsState.systems === null;
    systemFilter = resolveSystemFilter(systemFilter, systemList);
    swatches = swatchLookup(systemList);
    const systemEntries = systemOptions(systemList);
    systemSelect.update({ value: systemFilterToId(systemFilter), options: systemEntries });
    nameSelect(systemHost, 'System', systemEntries.find((entry) => entry.id === systemFilterToId(systemFilter))?.label ?? 'All systems');
    nameSelect(sortHost, 'Sort', LIST_SORTS.find((entry) => entry.id === sort)?.label ?? 'Updated');

    if (foldersPending) {
      showLoading();
      return;
    }
    const label = scopeLabel(effective, groups, folderList);
    const filters = { query, tab, system: systemFilter };
    const { scoped, items, shownDesigns, counts } = libraryItems({ designs: all, systems: systemList, scope: effective, folders: folderList, designsRoot: root, filters, sort, manual: manualProjects, surface: 'rail' });
    tabsHandle.update({ items: RAIL_TABS.map(({ id, label: tabLabel }) => ({ id, label: tabLabel, count: counts[id] })) });
    // Below 380 px the counts leave the tabs (CSS); each tab keeps its count in its accessible name. They count designs only.
    for (const tabButton of tabsHost.querySelectorAll<HTMLElement>('[role=tab]')) {
      const entry = RAIL_TABS.find((item) => item.id === tabButton.dataset.id);
      if (entry) tabButton.setAttribute('aria-label', `${entry.label}, ${counts[entry.id]}`);
    }
    const empty = emptyStateOf({ all, scoped, shown: shownDesigns, scope: effective, scopeLabel: label, folderName: folder?.name ?? null, filters, systems: systemList, systemsFailed, draggable: false, surface: 'rail' });
    if (empty) {
      const wrap = h('div');
      mountLibraryEmpty(wrap, empty, {
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
          paintList();
        },
      });
      list.append(h('li', { class: 'dc-list-message' }, wrap));
    } else {
      const rowView: DesignRowView = { scope: effective, groups, root, manual: manualProjects, menu: { folder: null, project: null } };
      // The rail lists designs only: a system is reached through its chip on a row, the entry under the list or the header icon.
      list.append(...items.flatMap((item) => (item.kind === 'design' ? [mountDesignRow(item.design, { variant: 'rail', view: { ...rowView, menu: menuFor(item.design) }, actions: options.actions, onOpen: options.onOpen, thumbs, swatchOf: swatches })] : [])));
    }
    const live = new Set(all.map((design) => design.slug));
    for (const [slug, handle] of thumbs) {
      if (!live.has(slug)) {
        handle.dispose();
        thumbs.delete(slug);
      }
    }
  };

  // Settings and designs can change under us (a folder switch, an agent writing a file).
  let signature = '';
  scope.add(
    store.subscribe(() => {
      const state = store.getState();
      const next = `${state.designs.status}:${state.designs.data?.root ?? ''}:${JSON.stringify(state.designs.data?.projectFolders ?? null)}:${JSON.stringify(state.designs.data?.designs ?? null)}:${JSON.stringify(state.designs.data?.loose ?? null)}:${state.designs.error?.message ?? ''}:${JSON.stringify(state.settings.data?.previousRoots ?? null)}`;
      if (next === signature) return;
      signature = next;
      paintList();
    }),
  );
  const minute = setInterval(paintList, 60_000);
  scope.add(() => clearInterval(minute));
  scope.add(folderStore.subscribe(paintList));
  scope.add(systemStore.subscribe(paintList));

  // The remembered scope and sort, and the host's project names, arrive after the first paint;
  // a failure of any only costs the memory or the nicer name.
  void host.storage.get(scopeStorageKey('panel')).then((stored) => {
    chosen = scopeFromId(stored);
    paintList();
  });
  void host.storage.get(sortStorageKey('panel')).then((stored) => {
    sort = sortFromStored(stored);
    sortSelect.update({ value: sort });
    paintList();
  });
  void guestHost.client.listProjects().then(
    (answer) => {
      projects = answer.projects.map((project) => ({ directory: project.directory, name: project.name }));
      paintList();
    },
    (error: unknown) => console.warn('Design Chamber: the project names could not be read; folders show their own names', error),
  );

  void store.refreshDesigns();
  void store.loadSettings();
  paintList();

  return {
    el,
    focusRow: (slug) => {
      list.querySelector<HTMLElement>(`[data-slug="${CSS.escape(slug)}"] .dc-row-main`)?.focus();
    },
    focusSystems: () => (systemsOpener === 'foot' ? foot : systemsButton).focus(),
    focusSystemEntry: (id) => {
      const escaped = CSS.escape(id);
      (list.querySelector<HTMLElement>(`[data-id="${escaped}"] .dc-sys-main, .dc-design-system-chip[data-system-id="${escaped}"]`) ?? (systemsOpener === 'foot' ? foot : systemsButton)).focus();
    },
    filterBySystem,
    dispose: () => {
      scope.dispose();
      looseBanner.dispose();
      for (const handle of thumbs.values()) handle.dispose();
      thumbs.clear();
      search.dispose();
      tabsHandle.dispose();
      showSelect.dispose();
      systemSelect.dispose();
      sortSelect.dispose();
      undo.dispose();
      el.remove();
    },
  };
};
