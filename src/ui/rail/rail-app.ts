// The rail panel app (320–480 px): the list (R1), the compact viewer (R2) and settings (R3) as
// views of one stack, plus the New dialog. Chat links ("Open as page", a chip click) open
// the viewer here, because an extension cannot open the full-screen page from code.

import { openNewDialog } from '../components/new-dialog.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { errorText, h } from '../components/dom.ts';
import { openSheet } from '../components/kit.ts';
import { keepPlace } from '../components/place-memory.ts';
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

  let viewer: { slug: string; handle: DesignViewHandle } | null = null;
  /** The design systems list, while it is the view on screen. */
  let systemsView: SystemsListHandle | null = null;
  /** One design system, open from the list (the list stays behind it, hidden, so Back returns to it). */
  let systemPage: { id: string; handle: SystemPageHandle } | null = null;
  /** How a design system build is going, opened by its chip in the chat. */
  let buildView: { ticket: string; handle: BuildChipViewHandle } | null = null;

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
    onOpenSystem: (id) => {
      const current = viewer;
      if (!current) return openSystem(id);
      void current.handle.beforeLeave().then((leave) => {
        if (!leave || viewer !== current) return;
        closeViewer();
        openSystem(id);
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

  const closeSystems = (): void => {
    systemPage?.handle.dispose();
    systemPage = null;
    systemsView?.dispose();
    systemsView = null;
    list.el.hidden = false;
    list.focusSystems();
  };
  const showSystems = (): void => {
    if (systemsView) return;
    buildView?.handle.dispose();
    buildView = null;
    systemsView = mountSystemsList({ surface: 'panel', actions, onBack: closeSystems, onOpen: (id) => openSystem(id) });
    list.el.hidden = true;
    app.append(systemsView.el);
    systemsView.focus();
  };

  const closeSystemPage = (): void => {
    systemPage?.handle.dispose();
    systemPage = null;
    if (systemsView) {
      systemsView.el.hidden = false;
      systemsView.focus();
    }
  };
  const openSystem = (id: string): void => {
    if (systemPage?.id === id) return;
    systemPage?.handle.dispose();
    systemPage = null;
    if (!systemsView) showSystems();
    if (!systemsView) return;
    systemsView.el.hidden = true;
    const handle = mountSystemPage({ id, surface: 'panel', actions, onBack: closeSystemPage });
    systemPage = { id, handle };
    app.append(handle.el);
    handle.focus();
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
    (target) => (target.kind === 'open-build' ? openBuild(target.ticket) : openViewer(target.slug)),
    (error) => toast('error', `Couldn’t open that design. ${errorText(error)}`),
  );
  // "Open as page" (background frame), a Work Status row or a chat block leaves a design for us to open.
  flows.watchOpenRequests((listener) => feed.subscribe(listener), (target) => openViewer(target.slug, { startIn: target.intent }));
};
