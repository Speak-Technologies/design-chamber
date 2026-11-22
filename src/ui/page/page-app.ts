// The full-screen page app: the library (P1) and one open design (canvas wall P2 / page
// viewer P6) as views of one stack. Settings (P5) opens as a side sheet over either.

import type { SystemOpenTarget } from '../../shared/api.ts';
import { openNewDialog } from '../components/new-dialog.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { errorText, h } from '../components/dom.ts';
import { openSheet } from '../components/kit.ts';
import { keepPlace } from '../components/place-memory.ts';
import { mountSettings, type SettingsHandle } from '../components/settings-view.ts';
import { flows } from '../guest.ts';
import { mountDesignView, type DesignViewHandle } from '../wall/design-view.ts';
import { mountSystemsList, type SystemsListHandle } from '../systems/systems-list.ts';
import { mountBuildChipView, type BuildChipViewHandle } from '../systems/build-chip-view.ts';
import { mountSystemPage, type SystemPageHandle } from '../systems/system-page.ts';
import { mountLibrary } from './library-view.ts';

export const mountPage = (root: HTMLElement): void => {
  const app = h('div', { class: 'dc-app', 'data-surface': 'page' });
  root.replaceChildren(app);

  let open: { slug: string; handle: DesignViewHandle } | null = null;
  /** The design systems list, while it is the view on screen. */
  let systemsView: SystemsListHandle | null = null;
  /** One design system, open from the list (the list stays behind it, hidden, so Back returns to it). */
  let systemPage: { id: string; handle: SystemPageHandle; /** Opened straight from the library (a chip, a tile): Back returns there, not to the systems list. */ fromLibrary: boolean } | null = null;
  /** How a design system build is going, opened by its chip in the chat. */
  let buildView: { ticket: string; handle: BuildChipViewHandle } | null = null;

  const closeDesign = (): void => {
    const slug = open?.slug;
    open?.handle.dispose();
    open = null;
    library.el.hidden = false;
    place.clear();
    if (slug) library.focusCard(slug);
  };

  const showDesign = (slug: string): void => {
    open?.handle.dispose();
    // A chip click or an open request lands here while the systems list is up: it gives way to the design.
    systemPage?.handle.dispose();
    systemPage = null;
    systemsView?.dispose();
    systemsView = null;
    buildView?.handle.dispose();
    buildView = null;
    const handle = mountDesignView({ slug, surface: 'page', actions, onBack: leaveDesign });
    open = { slug, handle };
    place.remember(slug);
    library.el.hidden = true;
    app.append(handle.el);
  };

  /** Back to the library; unsaved tweaks ask first ("Save your tweaks?"), and Keep editing stays here. */
  const leaveDesign = (): void => {
    const current = open;
    if (!current) return;
    void current.handle.beforeLeave().then((leave) => {
      if (leave && open === current) closeDesign();
    });
  };

  const openDesign = (slug: string): void => {
    if (open?.slug === slug) return;
    // Another design replaces the open one: the same question as going back.
    const current = open;
    if (current) {
      void current.handle.beforeLeave().then((leave) => {
        if (leave && open === current) showDesign(slug);
      });
      return;
    }
    showDesign(slug);
  };

  // The frame reloads when the extension updates; reopen the design that was open (the user's own choice wins).
  const place = keepPlace({ surface: 'page', isOpen: () => open !== null, open: openDesign });

  const actions: ActionContext = {
    host: app,
    onOpen: openDesign,
    onRemoved: (slug) => {
      if (open?.slug === slug) closeDesign();
    },
    onOpenSystem: (id, target) => {
      const current = open;
      if (!current) return openSystem(id, target);
      void current.handle.beforeLeave().then((leave) => {
        if (!leave || open !== current) return;
        closeDesign();
        openSystem(id, target);
      });
    },
  };

  const openSettings = (): void => {
    let settings: SettingsHandle | null = null;
    const sheet = openSheet(app, { title: 'Settings', variant: 'side', onClose: () => settings?.dispose() });
    settings = mountSettings(sheet.body);
  };

  const closeBuild = (): void => {
    buildView?.handle.dispose();
    buildView = null;
    library.el.hidden = false;
  };
  const showBuild = (ticket: string): void => {
    systemPage?.handle.dispose();
    systemPage = null;
    systemsView?.dispose();
    systemsView = null;
    buildView?.handle.dispose();
    const handle = mountBuildChipView({ ticket, surface: 'page', actions, onBack: closeBuild });
    buildView = { ticket, handle };
    library.el.hidden = true;
    app.append(handle.el);
    handle.focus();
  };
  /** A build chip opened from the chat. An open design with unsaved tweaks asks first, like going back. */
  const openBuild = (ticket: string): void => {
    if (buildView?.ticket === ticket) return;
    const current = open;
    if (!current) return showBuild(ticket);
    void current.handle.beforeLeave().then((leave) => {
      if (!leave || open !== current) return;
      closeDesign();
      showBuild(ticket);
    });
  };

  const closeSystems = (focus: 'button' | 'none' = 'button'): void => {
    systemPage?.handle.dispose();
    systemPage = null;
    systemsView?.dispose();
    systemsView = null;
    library.el.hidden = false;
    if (focus === 'button') library.focusSystems();
  };
  const showSystems = (): void => {
    if (systemsView) return;
    buildView?.handle.dispose();
    buildView = null;
    systemsView = mountSystemsList({ surface: 'page', actions, onBack: () => closeSystems(), onOpen: (id) => openSystem(id), onShowDesigns: showDesignsOf });
    library.el.hidden = true;
    app.append(systemsView.el);
    systemsView.focus();
  };

  /** A used-by link in the systems list: back to the library, filtered to that system. */
  const showDesignsOf = (id: string): void => {
    closeSystems('none');
    library.filterBySystem(id);
  };

  const closeSystemPage = (): void => {
    const origin = systemPage;
    systemPage?.handle.dispose();
    systemPage = null;
    if (origin?.fromLibrary) {
      closeSystems('none');
      library.focusSystemEntry(origin.id);
      return;
    }
    if (systemsView) {
      systemsView.el.hidden = false;
      systemsView.focus();
    }
  };
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
    const handle = mountSystemPage({ id, surface: 'page', actions, onBack: closeSystemPage, backTo: fromLibrary ? 'library' : undefined });
    systemPage = { id, handle, fromLibrary };
    app.append(handle.el);
    handle.focus();
    if (target !== 'page') handle.showTarget(target);
  };

  const library = mountLibrary({
    actions,
    onOpen: openDesign,
    onSystems: showSystems,
    onSettings: openSettings,
    onNew: (kind) => openNewDialog(app, { kind, onCreated: openDesign, onSystems: showSystems }),
  });
  app.append(library.el);

  flows.watchItems(
    (target) => (target.kind === 'open-build' ? openBuild(target.ticket) : target.kind === 'open-system' ? openSystem(target.system, target.target) : openDesign(target.slug)),
    (error) => toast('error', `Couldn’t open that design. ${errorText(error)}`),
  );
};
