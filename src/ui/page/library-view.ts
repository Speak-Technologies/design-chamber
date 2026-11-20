// P1, the page's library: toolbar (search, tabs, sort, New, settings) over a responsive grid
// of design cards with 16:10 thumbnails. Cards update live from change events without losing scroll.
// Notices above the grid: a failed refresh, an earlier folder with designs, loose HTML files to import.

import { mountBadge, mountBanner, mountEmpty, mountSearchField, mountSelect, mountTabs } from '@openchamber/sdk/ui';

import type { DesignSummary } from '../../shared/types.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { createScope, h } from '../components/dom.ts';
import { addToFolder, deleteFolder, DESIGN_DRAG_TYPE, listDesignMenu, mountUndoNotice, runListAction, type FolderRef } from '../components/folder-actions.ts';
import { folders as foldersStore, type FoldersState } from '../components/folders-store.ts';
import { icon } from '../components/icons.ts';
import { attachMenu, btn, iconBtn } from '../components/kit.ts';
import { mountLooseBanner } from '../components/loose-banner.ts';
import { mountThumb, type ThumbHandle } from '../components/thumb.ts';
import { guestHost, host, store } from '../guest.ts';
import { middlePath, plural, relativeTime } from '../model/format.ts';
import {
  ALL_SCOPE,
  LIST_SORTS,
  LIST_TABS,
  cardProjectLine,
  emptyKind,
  filterDesigns,
  folderEmptyBody,
  folderNameProblem,
  kindLabel,
  noMatchesSentence,
  projectGroups,
  resolveScope,
  rowAriaLabel,
  scopeCounts,
  scopeDesigns,
  scopeFromId,
  scopeLabel,
  scopeStorageKey,
  scopeToId,
  SYSTEM_UPDATED_LABEL,
  sortDesigns,
  systemUpdated,
  tabCounts,
  type ListScope,
  type ListSort,
  type ListTab,
  type ProjectGroup,
  type ProjectInfo,
} from '../model/list-model.ts';
import { designCountLabel } from '../model/settings-model.ts';
import { mountSidebar } from './library-sidebar.ts';

export type LibraryOptions = {
  actions: ActionContext;
  onNew: (kind: 'canvas' | 'page') => void;
  onSettings: () => void;
  /** Opens the design systems list (Phase 2.5). */
  onSystems: () => void;
  onOpen: (slug: string) => void;
};

export type LibraryHandle = { el: HTMLElement; focusCard: (slug: string) => void; focusSystems: () => void; dispose: () => void };

const SKELETON_CARDS = 8;
/** Under this page width the sidebar starts closed and floats over the grid when opened. */
const SIDEBAR_MIN_PAGE_WIDTH = 900;

export const mountLibrary = (options: LibraryOptions): LibraryHandle => {
  const scope = createScope();
  let query = '';
  let tab: ListTab = 'all';
  let sort: ListSort = 'updated';
  /** The remembered view; the one actually shown is `resolveScope` of it (a project or folder that is gone reads as All designs). */
  let chosen: ListScope = ALL_SCOPE;
  let projects: ProjectInfo[] = [];
  /** What the open card menus and the card lines need, refreshed on every paint. */
  let view: { scope: ListScope; groups: readonly ProjectGroup[]; root: string; folder: FolderRef | null } = { scope: ALL_SCOPE, groups: [], root: '', folder: null };
  /** null follows the page width (open from 900 px); the sidebar button sets it. */
  let sidebarWanted: boolean | null = null;
  let narrow = false;
  const folderStore = foldersStore();
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
  const settingsButton = btn({ label: 'Settings', variant: 'ghost', size: 'default', icon: 'settings', onClick: () => options.onSettings() });
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
  const sortHost = h('div', { class: 'dc-sort', title: 'Sort designs' }, h('span', { class: 'dc-sort-label' }, 'Sort'));
  const sortSelect = mountSelect(sortHost, { value: sort, options: LIST_SORTS.map(({ id, label }) => ({ id, label })), onChange: (id) => {
    sort = LIST_SORTS.find((entry) => entry.id === id)?.id ?? 'updated';
    sortSelect.update({ value: sort });
    paintGrid();
  } });

  const sidebarToggle = iconBtn({ icon: 'sidebar', label: 'Projects and folders', pressed: true, onClick: () => toggleSidebar() });
  const scopeName = h('span', { class: 'dc-page-scope', hidden: true });
  const toolbar = h(
    'header',
    { class: 'dc-library-bar' },
    sidebarToggle,
    h('h1', { class: 'dc-page-title' }, 'Designs', scopeName),
    h('div', { class: 'dc-library-controls' }, searchHost, tabsHost, sortHost),
    h('span', { class: 'dc-spacer' }),
    systemsButton.el,
    settingsButton.el,
    newButton.el,
  );
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
  const scroller = h('div', { class: 'dc-library-scroll' }, undoHost, notices, grid);
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
  });
  const body = h('div', { class: 'dc-library-body' }, sidebar.el, scroller);
  el.append(toolbar, body);

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

  const card = (design: DesignSummary): HTMLElement => {
    let thumb = thumbs.get(design.slug);
    if (thumb) thumb.update(design);
    else {
      thumb = mountThumb(design, 'card');
      thumbs.set(design.slug, thumb);
    }
    const line = cardProjectLine(design, view.scope, view.groups, view.root);
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
        line ? h('span', { class: 'dc-card-project', title: line.title }, icon('layers', 12), h('span', { class: 'dc-card-project-name' }, line.label)) : null,
        h('span', { class: 'dc-card-meta' }, kindBadge, h('span', { class: 'dc-muted' }, relativeTime(design.updated, Date.now(), locale)), indicators),
      ),
    );
    main.addEventListener('click', () => options.onOpen(design.slug));
    const more = iconBtn({ icon: 'more', label: `Actions for ${design.title}`, size: 'sm', onClick: () => undefined });
    more.classList.add('dc-card-more');
    const ref = { slug: design.slug, title: design.title, kind: design.kind, sessionId: design.sessionId };
    attachMenu(more, () => listDesignMenu(view.folder), (id) => runListAction(id, ref, options.actions, view.folder));
    const item = h('li', { class: 'dc-card', 'data-slug': design.slug, 'data-pending': design.pending ? 'true' : 'false', draggable: 'true' }, main, more);
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
    Array.from({ length: SKELETON_CARDS }, () => h('li', { class: 'dc-card dc-card-skeleton', 'aria-hidden': 'true' }, h('span', { class: 'dc-skel dc-skel-card' }), h('span', { class: 'dc-skel dc-skel-line' }), h('span', { class: 'dc-skel dc-skel-line dc-skel-short' })));

  const message = (...children: Array<Node>): HTMLElement => h('li', { class: 'dc-grid-message' }, ...children);

  const paintNotices = (): void => {
    for (const child of [...notices.children]) if (child !== looseBanner.el) child.remove();
    const state = store.getState();
    if (state.designs.status === 'error' && state.designs.data) {
      const wrap = h('div', { class: 'dc-banner' });
      mountBanner(wrap, { tone: 'warning', title: 'Couldn’t refresh the list', body: state.designs.error?.message ?? '', action: { label: 'Try again', onClick: () => void store.refreshDesigns() } });
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
    paintNotices();
    if ((state.status === 'idle' || state.status === 'loading') && !state.data) {
      grid.append(...skeletons());
      return;
    }
    if (!state.data) {
      const wrap = h('div');
      mountBanner(wrap, { tone: 'error', title: 'Your designs didn’t load', body: state.error?.message ?? 'The local service didn’t answer. Allow it in Settings → Extensions, then try again.', action: { label: 'Try again', onClick: () => void store.refreshDesigns() } });
      grid.append(message(wrap));
      return;
    }
    const all = state.data.designs;
    const root = state.data.root;
    const foldersState: FoldersState = folderStore.get();
    const folderList = foldersState.status === 'error' ? [] : foldersState.folders;
    const groups = projectGroups(all, projects, root, state.data.projectFolders);
    const foldersPending = chosen.kind === 'folder' && (foldersState.status === 'idle' || foldersState.status === 'loading') && foldersState.folders.length === 0;
    const effective = foldersPending ? chosen : resolveScope(chosen, groups, folderList);
    const folder = effective.kind === 'folder' ? folderList.find((entry) => entry.id === effective.id) ?? null : null;
    view = { scope: effective, groups, root, folder: folder ? { id: folder.id, name: folder.name } : null };
    const counts4 = scopeCounts(all, folderList, root);
    sidebar.paint({ scope: effective, counts: counts4, groups, folders: folderList, foldersStatus: foldersState.status === 'error' ? 'error' : foldersState.status === 'ready' ? 'ready' : 'loading', foldersError: foldersState.error });
    paintSidebarState();
    const label = scopeLabel(effective, groups, folderList);
    scopeName.hidden = label === null;
    scopeName.textContent = label ?? '';
    if (foldersPending) {
      grid.append(...skeletons());
      scroller.scrollTop = previousScroll;
      return;
    }
    const scoped = scopeDesigns(all, effective, folderList, root);
    const shown = sortDesigns(filterDesigns(scoped, query, tab), sort);
    const counts = tabCounts(scoped, query);
    tabsHandle.update({ items: LIST_TABS.map(({ id, label: tabLabel }) => ({ id, label: tabLabel, count: counts[id] })) });
    const kind = emptyKind(all, shown);
    if (kind !== 'none' && kind !== 'no-designs' && scoped.length === 0 && folder) {
      const wrap = h('div');
      mountEmpty(wrap, { title: `No designs in ${folder.name} yet`, body: folderEmptyBody(true), action: { label: 'Show all designs', onClick: () => setScope(ALL_SCOPE) } });
      grid.append(message(wrap));
    } else if (kind === 'no-designs') {
      const wrap = h('div');
      mountEmpty(wrap, { title: 'No designs yet', body: 'Type /design or /page in any chat and describe what you want. Your agent writes the files and they show up here the moment they are saved.', action: { label: 'New canvas', onClick: () => options.onNew('canvas') } });
      grid.append(message(wrap));
    } else if (kind === 'no-matches') {
      const wrap = h('div');
      mountEmpty(wrap, { title: query.trim() !== '' ? noMatchesSentence(label, query) : label !== null ? `Nothing in ${label} for this tab yet` : 'Nothing in this tab yet', body: label !== null ? 'Try another word, look in All, or show all designs.' : 'Try another word, or look in All.', action: { label: 'Clear filters', onClick: () => {
        query = '';
        tab = 'all';
        search.update({ value: '' });
        tabsHandle.update({ activeId: 'all' });
        paintGrid();
      } } });
      grid.append(message(wrap));
    } else grid.append(...shown.map(card));
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

  // The remembered view and the host's project names arrive after the first paint; a failure of either only costs the memory or the nicer name.
  void host.storage.get(scopeStorageKey('page')).then((stored) => {
    chosen = scopeFromId(stored);
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
      grid.querySelector<HTMLElement>(`[data-slug="${CSS.escape(slug)}"] .dc-card-main`)?.focus();
    },
    focusSystems: () => systemsButton.el.focus(),
    dispose: () => {
      scope.dispose();
      looseBanner.dispose();
      for (const handle of thumbs.values()) handle.dispose();
      thumbs.clear();
      search.dispose();
      tabsHandle.dispose();
      sortSelect.dispose();
      sidebar.dispose();
      undo.dispose();
      el.remove();
    },
  };
};
