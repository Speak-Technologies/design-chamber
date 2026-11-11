// The full-screen page app: the library (P1) and one open design (canvas wall P2 / page
// viewer P6) as views of one stack. Settings (P5) opens as a side sheet over either.

import { openNewDialog } from '../components/new-dialog.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { errorText, h } from '../components/dom.ts';
import { openSheet } from '../components/kit.ts';
import { keepPlace } from '../components/place-memory.ts';
import { mountSettings, type SettingsHandle } from '../components/settings-view.ts';
import { flows } from '../guest.ts';
import { mountDesignView, type DesignViewHandle } from '../wall/design-view.ts';
import { mountLibrary } from './library-view.ts';

export const mountPage = (root: HTMLElement): void => {
  const app = h('div', { class: 'dc-app', 'data-surface': 'page' });
  root.replaceChildren(app);

  let open: { slug: string; handle: DesignViewHandle } | null = null;

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
  };

  const openSettings = (): void => {
    let settings: SettingsHandle | null = null;
    const sheet = openSheet(app, { title: 'Settings', variant: 'side', onClose: () => settings?.dispose() });
    settings = mountSettings(sheet.body);
  };

  const library = mountLibrary({
    actions,
    onOpen: openDesign,
    onSettings: openSettings,
    onNew: (kind) => openNewDialog(app, { kind, onCreated: openDesign }),
  });
  app.append(library.el);

  flows.watchItems(
    (target) => openDesign(target.slug),
    (error) => toast('error', `Couldn’t open that design. ${errorText(error)}`),
  );
};
