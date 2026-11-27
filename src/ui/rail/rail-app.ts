// The rail panel app (320–480 px): the list (R1), the compact viewer (R2) and settings (R3) as
// views of one stack, plus the New dialog. Chat links ("Open as page", a chip click) open
// the viewer here, because an extension cannot open the full-screen page from code.

import type { SystemOpenTarget } from '../../shared/api.ts';
import { openNewDialog } from '../components/new-dialog.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { errorText, h } from '../components/dom.ts';
import { openSheet } from '../components/kit.ts';
import { keepPlace } from '../components/place-memory.ts';
import { reportNothingOpen, reportReturn, startViewReport } from '../components/view-report.ts';
import { mountSettings, type SettingsHandle } from '../components/settings-view.ts';
import { feed, flows } from '../guest.ts';
import { mountDesignView, type DesignViewHandle } from '../wall/design-view.ts';
import { mountSystemsList, type SystemsListHandle } from '../systems/systems-list.ts';
import { mountBuildChipView, type BuildChipViewHandle } from '../systems/build-chip-view.ts';
import { mountSystemPage, type SystemPageHandle } from '../systems/system-page.ts';
import { mountListView } from './list-view.ts';

export const mountRail = (root: HTMLElement): void => {
  const app = h('div', { class: 'dc-app', 'data-surface': 'panel' });
  root.replaceChildren(app);
  // Always on: the service learns which design is open, so the user's agent can answer "this one" (spec §2.4).
  startViewReport('panel');

  let viewer: { slug: string; handle: DesignViewHandle } | null = null;
  /** The design systems list, while it is the view on screen. */
  let systemsView: SystemsListHandle | null = null;
  /** One design system, open from the list (the list stays behind it, hidden, so Back returns to it). */
  let systemPage: { id: string; handle: SystemPageHandle; /** Opened straight from the library (a chip, a tile): Back returns there, not to the systems list. */ fromLibrary: boolean } | null = null;
  /** How a design system build is going, opened by its chip in the chat. */
  let buildView: { ticket: string; handle: BuildChipViewHandle } | null = null;

  /** What the service is told is on screen: the open design, unless a system page, the systems list or a build covers it. */
  const syncView = (): void => {
    if (!viewer || systemPage || systemsView || buildView) reportNothingOpen();
    else reportReturn(viewer.slug);
  };

  const closeViewer = (): void => {
    const slug = viewer?.slug;
    viewer?.handle.dispose();
    viewer = null;
    list.el.hidden = false;
    place.clear();
    if (slug) list.focusRow(slug);
  };

  const showViewer = (slug: string, options: { startIn?: 'view' | 'comment' }): void => {
    viewer?.handle.dispose();
    // A chip click or an open request lands here while the systems list is up: it gives way to the design.
    systemPage?.handle.dispose();
    systemPage = null;
    systemsView?.dispose();
    systemsView = null;
    buildView?.handle.dispose();
    buildView = null;
    const handle = mountDesignView({ slug, surface: 'panel', actions, onBack: leaveViewer, startIn: options.startIn });
    viewer = { slug, handle };
    place.remember(slug);
    list.el.hidden = true;
    app.append(handle.el);
  };

  /** Back to the list; unsaved tweaks ask first ("Save your tweaks?"), and Keep editing stays here. */
  const leaveViewer = (): void => {
    const current = viewer;
    if (!current) return;
    void current.handle.beforeLeave().then((leave) => {
      if (leave && viewer === current) closeViewer();
    });
  };

  /** `startIn: 'comment'` comes with an open request (Work Status, a chat block); it also reaches a design that is already open. */
  const openViewer = (slug: string, options: { startIn?: 'view' | 'comment' } = {}): void => {
    if (viewer?.slug === slug) {
      if (options.startIn === 'comment') viewer.handle.startComment();
      return;
    }
    // Another design replaces the open one: the same question as going back.
    const current = viewer;
    if (current) {
      void current.handle.beforeLeave().then((leave) => {
        if (leave && viewer === current) showViewer(slug, options);
      });
      return;
    }
    showViewer(slug, options);
  };

  // The frame reloads when the extension updates; reopen the design that was open (an open request or the user's own choice wins).
  const place = keepPlace({ surface: 'panel', isOpen: () => viewer !== null, open: (slug) => openViewer(slug) });

  const actions: ActionContext = {
    host: app,
    onOpen: openViewer,
    onRemoved: (slug) => {
      if (viewer?.slug === slug) closeViewer();
    },
    onOpenSystem: (id, target) => {
      const current = viewer;
      if (!current) return openSystem(id, target);
      void current.handle.beforeLeave().then((leave) => {
        if (!leave || viewer !== current) return;
        closeViewer();
        openSystem(id, target);
      });
    },
  };

  const openSettings = (): void => {
    let settings: SettingsHandle | null = null;
    const sheet = openSheet(app, { title: 'Settings', variant: 'full', onClose: () => settings?.dispose() });
    settings = mountSettings(sheet.body);
  };

  const closeBuild = (): void => {
    buildView?.handle.dispose();
    buildView = null;
    list.el.hidden = false;
    syncView();
  };
  const showBuild = (ticket: string): void => {
    systemPage?.handle.dispose();
    systemPage = null;
    systemsView?.dispose();
    systemsView = null;
    buildView?.handle.dispose();
    const handle = mountBuildChipView({ ticket, surface: 'panel', actions, onBack: closeBuild });
    buildView = { ticket, handle };
    list.el.hidden = true;
    app.append(handle.el);
    handle.focus();
    syncView();
  };
  /** A build chip opened from the chat. An open design with unsaved tweaks asks first, like going back. */
  const openBuild = (ticket: string): void => {
    if (buildView?.ticket === ticket) return;
    const current = viewer;
    if (!current) return showBuild(ticket);
    void current.handle.beforeLeave().then((leave) => {
      if (!leave || viewer !== current) return;
      closeViewer();
      showBuild(ticket);
    });
  };

  const closeSystems = (focus: 'button' | 'none' = 'button'): void => {
    systemPage?.handle.dispose();
    systemPage = null;
    systemsView?.dispose();
    systemsView = null;
    list.el.hidden = false;
    syncView();
    if (focus === 'button') list.focusSystems();
  };
  const showSystems = (): void => {
    if (systemsView) return;
    buildView?.handle.dispose();
    buildView = null;
    systemsView = mountSystemsList({ surface: 'panel', actions, onBack: () => closeSystems(), onOpen: (id) => openSystem(id), onShowDesigns: showDesignsOf });
    list.el.hidden = true;
    app.append(systemsView.el);
    systemsView.focus();
    syncView();
  };

  /** A used-by link in the systems list: back to the library, filtered to that system. */
  const showDesignsOf = (id: string): void => {
    closeSystems('none');
    list.filterBySystem(id);
  };

  const closeSystemPage = (): void => {
    const origin = systemPage;
    systemPage?.handle.dispose();
    systemPage = null;
    if (origin?.fromLibrary) {
      closeSystems('none');
      list.focusSystemEntry(origin.id);
      return;
    }
    if (systemsView) {
      systemsView.el.hidden = false;
      systemsView.focus();
    }
  };
  /** The system's page; `board` and `preview` also bring the board or the living page's preview forward. */
  const openSystem = (id: string, target: SystemOpenTarget = 'page'): void => {
    if (systemPage?.id === id) {
      if (target !== 'page') systemPage.handle.showTarget(target);
      return;
    }
    systemPage?.handle.dispose();
    systemPage = null;
    const fromLibrary = systemsView === null;
    if (!systemsView) showSystems();
    if (!systemsView) return;
    systemsView.el.hidden = true;
    const handle = mountSystemPage({ id, surface: 'panel', actions, onBack: closeSystemPage, backTo: fromLibrary ? 'library' : undefined });
    systemPage = { id, handle, fromLibrary };
    app.append(handle.el);
    handle.focus();
    if (target !== 'page') handle.showTarget(target);
  };

  const list = mountListView({
    actions,
    onOpen: openViewer,
    onSystems: showSystems,
    onSettings: openSettings,
    onNew: (kind) => openNewDialog(app, { kind, onCreated: openViewer, onSystems: showSystems }),
  });
  app.append(list.el);

  // A chip click or "Open as page" opens the viewer here.
  flows.watchItems(
    (target) => (target.kind === 'open-build' ? openBuild(target.ticket) : target.kind === 'open-system' ? openSystem(target.system, target.target) : openViewer(target.slug)),
    (error) => toast('error', `Couldn’t open that design. ${errorText(error)}`),
  );
  // "Open as page" (background frame), a Work Status row or a chat block leaves a design for us to open.
  // A system request opens the system page, then jumps to its board or the living page preview when it asked for one.
  flows.watchOpenRequests(
    (listener) => feed.subscribe(listener),
    (target) => openViewer(target.slug, { startIn: target.intent }),
    (target) => openSystem(target.system, target.target),
  );
};
