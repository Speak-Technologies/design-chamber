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
import { mountListView } from './list-view.ts';

export const mountRail = (root: HTMLElement): void => {
  const app = h('div', { class: 'dc-app', 'data-surface': 'panel' });
  root.replaceChildren(app);

  let viewer: { slug: string; handle: DesignViewHandle } | null = null;

  const closeViewer = (): void => {
    const slug = viewer?.slug;
    viewer?.handle.dispose();
    viewer = null;
    list.el.hidden = false;
    place.clear();
    if (slug) list.focusRow(slug);
  };

  /** `startIn: 'comment'` comes with an open request (Work Status, a chat block); it also reaches a design that is already open. */
  const openViewer = (slug: string, options: { startIn?: 'view' | 'comment' } = {}): void => {
    if (viewer?.slug === slug) {
      if (options.startIn === 'comment') viewer.handle.startComment();
      return;
    }
    viewer?.handle.dispose();
    const handle = mountDesignView({ slug, surface: 'panel', actions, onBack: closeViewer, startIn: options.startIn });
    viewer = { slug, handle };
    place.remember(slug);
    list.el.hidden = true;
    app.append(handle.el);
  };

  // The frame reloads when the extension updates; reopen the design that was open (an open request or the user's own choice wins).
  const place = keepPlace({ surface: 'panel', isOpen: () => viewer !== null, open: (slug) => openViewer(slug) });

  const actions: ActionContext = {
    host: app,
    onOpen: openViewer,
    onRemoved: (slug) => {
      if (viewer?.slug === slug) closeViewer();
    },
  };

  const openSettings = (): void => {
    let settings: SettingsHandle | null = null;
    const sheet = openSheet(app, { title: 'Settings', variant: 'full', onClose: () => settings?.dispose() });
    settings = mountSettings(sheet.body);
  };

  const list = mountListView({
    actions,
    onOpen: openViewer,
    onSettings: openSettings,
    onNew: (kind) => openNewDialog(app, { kind, onCreated: openViewer }),
  });
  app.append(list.el);

  // A chip click or "Open as page" opens the viewer here.
  flows.watchItems(
    (target) => openViewer(target.slug),
    (error) => toast('error', `Couldn’t open that design. ${errorText(error)}`),
  );
  // "Open as page" (background frame), a Work Status row or a chat block leaves a design for us to open.
  flows.watchOpenRequests((listener) => feed.subscribe(listener), (target) => openViewer(target.slug, { startIn: target.intent }));
};
