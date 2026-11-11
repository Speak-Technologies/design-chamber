// One open design: the canvas wall (P2), the page viewer (P6) and the compact rail viewer
// (R2) are the same view with a different toolbar. It owns the toolbar, the wall, the comments
// and versions drawers, and the notices (remote files, saved export, viewing an old version).

import { mountSelect, mountTabs } from '@openchamber/sdk/ui';

import type { DesignDetailResponse } from '../../shared/api.ts';
import { HOST_CLIPBOARD_MAX, PAGE_FILL_VIEWPORT_ID } from '../../shared/limits.ts';
import { confirmDelete, continueInChat, copyHtml, copyPath, exportDesign, renameDesign, renameDialog, reveal, revealDesign, toast, type ActionContext } from '../components/actions.ts';
import { mountComments, type CommentsHandle } from '../components/comments-drawer.ts';
import { createScope, debounce, errorText, h, replace } from '../components/dom.ts';
import { createNotices } from '../components/notices.ts';
import { sendOneComment } from '../components/send-comments.ts';
import { trackBottomSheet } from '../components/bottom-sheet.ts';
import { attachMenu, banner, bannerWithActions, btn, confirmDialog, iconBtn, loadingRow, openMenu, openSheet, type BtnHandle, type MenuEntry, type SheetHandle, type SheetVariant } from '../components/kit.ts';
import { createRestoreFlow } from '../components/restore-flow.ts';
import { mountVersions, type VersionsHandle } from '../components/versions-drawer.ts';
import type { Camera } from '../../guest/camera.ts';
import { renderSourceKey } from '../../guest/store.ts';
import { askSelfContained, host, isServiceError, store } from '../guest.ts';
import { askRequestToast } from '../model/ask-bar-model.ts';
import { viewportLabel, viewportSize, zoomPercent } from '../model/format.ts';
import { readDirectionViewports } from '../model/directions-model.ts';
import { createListeners } from '../model/listeners.ts';
import { ASK_FOR_TWEAKS_TEXT, TWEAKS_SUBTITLE, TWEAKS_TITLE, tweaksSheetVariant } from '../model/tweaks-model.ts';
import { viewerMenuEntries } from '../model/viewer-menu.ts';
import { viewingBanner } from '../model/versions-model.ts';
import { pageViewOptions, remoteBannerHidden, remoteNotice, resolvePageView, shortUrl } from '../model/wall-model.ts';
import * as askBar from './feature-ask-bar.ts';
import { askBarFor } from './feature-ask-bar.ts';
import * as buildStrip from './feature-build-strip.ts';
import * as checks from './feature-checks.ts';
import * as directions from './feature-directions.ts';
import * as editText from './feature-edit-text.ts';
import * as findability from './feature-findability.ts';
import * as screens from './feature-screens.ts';
import * as tweaks from './feature-tweaks.ts';
import type { DrawerContent, DrawerKind, FeatureMount, ViewContext } from './view-context.ts';
import type { DirectionKeepPress } from './wall-types.ts';
import { createWall, type WallHandle } from './wall.ts';

export type DesignViewOptions = {
  slug: string;
  surface: 'panel' | 'page';
  actions: ActionContext;
  onBack: () => void;
  /**
   * How the design opens. `comment` (a Work Status "Comment" or a chat block) starts in Edit with
   * Comment pressed, so the next click pins a comment; `view` keeps the default (pages open in Play,
   * canvases in Edit).
   */
  startIn?: 'view' | 'comment';
};

export type DesignViewHandle = {
  el: HTMLElement;
  /** Switch to Edit with Comment pressed: the design is already open and a "Comment" request arrived for it. */
  startComment: () => void;
  /**
   * The user is about to leave this design (back to the list, or another design). Resolves false when a guard keeps them
   * here (unsaved tweaks: "Save your tweaks?" and they chose Keep editing). Nothing is disposed either way.
   */
  beforeLeave: () => Promise<boolean>;
  dispose: () => void;
};

/**
 * Per-design view settings in `host.storage` `view:<slug>`; `pageView` is checked against the design's viewports when it is used.
 * `directionViewport` is the size each direction row is shown at, by its original's screen id (an unknown id shows the first size).
 */
type Prefs = { hidden: string[]; camera: Camera | null; pageView: unknown; directionViewport: Record<string, string> };
type Drawer = { kind: DrawerKind; sheet: SheetHandle; handle: CommentsHandle | VersionsHandle | DrawerContent; stop: (() => void) | null };

const FULL_SCREEN_HINT = 'Full screen: sidebar → Extension pages → Design Chamber';
/** How long the "Export saved" notice stays (it holds while the pointer or focus is on it). */
const EXPORT_NOTICE_MS = 15_000;

/**
 * Remote-files banners the user hid, by design slug: the blocked URLs on screen at the time.
 * Module scope, so it lasts while the extension runs (closing and reopening the design keeps it).
 */
const hiddenRemote = new Map<string, readonly string[]>();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const readPrefs = (raw: unknown): Prefs => {
  if (!isRecord(raw)) return { hidden: [], camera: null, pageView: null, directionViewport: {} };
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((entry): entry is string => typeof entry === 'string') : [];
  const camera = isRecord(raw.camera) && typeof raw.camera.x === 'number' && typeof raw.camera.y === 'number' && typeof raw.camera.scale === 'number' ? { x: raw.camera.x, y: raw.camera.y, scale: raw.camera.scale } : null;
  return { hidden, camera, pageView: raw.pageView, directionViewport: readDirectionViewports(raw.directionViewport) };
};

export const mountDesignView = (options: DesignViewOptions): DesignViewHandle => {
  const { slug } = options;
  const compact = options.surface === 'panel';
  const scope = createScope();
  const el = h('div', { class: 'dc-design', 'data-surface': options.surface });
  let disposed = false;
  let built: Built | null = null;
  let building = false;

  type Built = { apply: (data: DesignDetailResponse) => void; startComment: () => void; beforeLeave: () => Promise<boolean>; dispose: () => void };
  // Set by `startIn: 'comment'`, or by `startComment` while the design is still loading.
  let wantComment = options.startIn === 'comment';

  const stateOf = () => {
    const open = store.getState().open;
    return open?.slug === slug ? open : null;
  };

  const backButton = (label: string): HTMLElement => btn({ label, variant: 'ghost', icon: 'back', onClick: options.onBack }).el;

  const showMessage = (...children: Array<Node | null>): void => {
    el.replaceChildren(h('div', { class: 'dc-design-state' }, h('div', { class: 'dc-state-bar' }, backButton(compact ? 'Designs' : 'Library')), h('div', { class: 'dc-state-body' }, ...children)));
  };

  const build = async (first: DesignDetailResponse): Promise<void> => {
    building = true;
    const prefs = readPrefs(await host.storage.get(`view:${slug}`));
    building = false;
    if (disposed) return;
    const bscope = createScope();
    let data = first;
    const design = (): DesignDetailResponse['design'] => data.design;
    const isPage = first.design.kind === 'page';

    let mode: 'edit' | 'play' = isPage && !wantComment ? 'play' : 'edit';
    let hidden = new Set(prefs.hidden.filter((id) => first.design.viewports.some((viewport) => viewport.id === id)));
    if (hidden.size >= first.design.viewports.length) hidden = new Set();
    // A page opens the way it was last viewed; Full width when that view is gone.
    let pageView: string = resolvePageView(prefs.pageView, first.design.viewports);
    let showPins = false;
    let viewing: { id: string; compare: boolean } | null = null;
    let drawer: Drawer | null = null;
    // Seam S9: feature mounts hear about these.
    const detailListeners = createListeners();
    const viewingListeners = createListeners();
    const drawerListeners = createListeners();
    let htmlChars: number | null = null;

    let directionViewport = prefs.directionViewport;
    const savePrefs = debounce((camera: Camera | null) => {
      void host.storage.set(`view:${slug}`, { hidden: [...hidden], camera, pageView, directionViewport });
    }, 500);
    // "Keep this one" presses from the wall's direction rows go to the directions feature (seam S9).
    const keepListeners = createListeners<[DirectionKeepPress]>();

    const zoomLabel = btn({ label: '100%', variant: 'ghost', size: 'xs', title: 'Reset zoom to 100%', onClick: () => wall.zoomReset() });
    zoomLabel.el.classList.add('dc-zoom-label');

    // ---------------------------------------------------------------- wall
    const stage = h('div', { class: 'dc-stage' });
    // Seams S1 to S3 and S8: empty slots the Phase 1 features fill (styles.css keeps them out of the layout while empty).
    const slots = {
      statusSlot: h('div', { class: 'dc-status-slot' }),
      overlay: h('div', { class: 'dc-stage-overlay' }),
      bottomDock: h('div', { class: 'dc-bottom-dock' }),
      compactActions: h('div', { class: 'dc-compact-actions' }),
      tweaksSlot: h('span', { class: 'dc-tweaks-slot' }),
    };
    // Set once the drawers exist; on a narrow page the dock is laid over the wall (styles.css).
    let dockEl: HTMLElement | null = null;
    const wall: WallHandle = createWall(
      {
        slug,
        compact,
        presentation: isPage ? 'page' : 'wall',
        initialPageView: pageView,
        coveredRight: () => (dockEl && !dockEl.hidden && getComputedStyle(dockEl).position === 'absolute' ? dockEl.offsetWidth : 0),
        // The rail's Tweaks sheet sits over the bottom of the view; what it covers of the wall is where the sheet's top meets the stage.
        coveredBottom: () => {
          if (drawer?.sheet.el.dataset.variant !== 'bottom') return 0;
          const panel = drawer.sheet.el.querySelector('.dc-sheet-panel');
          return panel ? Math.max(0, stage.getBoundingClientRect().bottom - panel.getBoundingClientRect().top) : 0;
        },
        initialCamera: isPage ? null : prefs.camera,
        directionViewport: (of) => directionViewport[of],
        onDirectionViewport: (of, viewportId) => {
          directionViewport = { ...directionViewport, [of]: viewportId };
          savePrefs(wall.getCamera());
        },
        onKeepDirection: keepListeners.emit,
        onScale: (next) => zoomLabel.set({ label: zoomPercent(next) }),
        onCameraSettled: (camera) => savePrefs(camera),
        createComment: async (body) => {
          await store.addComment(slug, body);
        },
        updateComment: async (id, patch) => {
          await store.updateComment(slug, id, patch);
        },
        deleteComment: async (id) => {
          await store.deleteComment(slug, id);
        },
        // Seam S6: "Send this" on a thread card (checks the comment is still open, saves an edited text, sends it alone).
        onSendComment: (id, body) => sendOneComment(slug, id, body, wall.anchorStates()),
        onExternal: (url) =>
          confirmDialog(options.actions.host, {
            title: 'Open this link in your browser?',
            body: h('p', null, h('code', { class: 'dc-path' }, url)),
            confirmLabel: 'Open in browser',
            onConfirm: async () => {
              await host.openUrl(url);
            },
          }),
        onNotice: (message) => toast('info', message),
        onStatus: () => {
          paintNotices();
          if (drawer?.kind === 'comments') (drawer.handle as CommentsHandle).refresh();
        },
      },
      first,
    );
    stage.append(wall.el, slots.overlay);
    wall.setMode(mode);
    wall.setShowPins(showPins);
    if (!isPage) wall.setHiddenViewports([...hidden]);

    // ---------------------------------------------------------------- toolbar controls
    const zoomOut = iconBtn({ icon: 'minus', label: 'Zoom out', size: 'sm', onClick: () => wall.zoomStep(1 / 1.25) });
    const zoomIn = iconBtn({ icon: 'plus', label: 'Zoom in', size: 'sm', onClick: () => wall.zoomStep(1.25) });
    const fit = btn({ label: 'Fit', variant: 'ghost', size: 'xs', icon: 'fit', title: 'Fit everything on screen (Shift+1)', onClick: () => wall.fit() });
    const zoomGroup = h('div', { class: 'dc-group', role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomLabel.el, zoomIn, fit.el);

    const modeHost = h('div', { class: 'dc-mode' });
    const modeTabs = mountTabs(modeHost, {
      items: [
        { id: 'edit', label: 'Edit' },
        { id: 'play', label: 'Play' },
      ],
      activeId: mode,
      trackBackground: true,
      onChange: (id) => setMode(id === 'play' ? 'play' : 'edit'),
    });
    modeHost.title = 'Edit: click an element to comment. Play: use the design like a prototype.';
    bscope.add(() => modeTabs.dispose());

    const pinsToggle = btn({ label: 'Pins', variant: 'ghost', size: 'xs', icon: 'comment', pressed: showPins, title: 'Show comment pins while playing', onClick: () => {
      showPins = !showPins;
      pinsToggle.set({ pressed: showPins });
      wall.setShowPins(showPins);
    } });
    pinsToggle.el.hidden = mode !== 'play' || isPage;

    const commentMode = btn({ label: 'Comment', variant: 'outline', size: 'sm', icon: 'cursor', pressed: false, title: 'Click an element to pin a comment to it', onClick: () => setMode(mode === 'edit' ? 'play' : 'edit') });

    const setMode = (next: 'edit' | 'play'): void => {
      if (viewing) return;
      mode = next;
      wall.setMode(next);
      modeTabs.update({ activeId: next });
      commentMode.set({ pressed: next === 'edit' });
      pinsToggle.el.hidden = next !== 'play' || isPage;
    };

    const chipHost = h('div', { class: 'dc-chips', role: 'group', 'aria-label': 'Device sizes shown' });
    const paintChips = (): void => {
      chipHost.replaceChildren();
      for (const viewport of design().viewports) {
        const on = !hidden.has(viewport.id);
        const chip = btn({
          label: viewport.label,
          variant: 'outline',
          size: 'xs',
          pressed: on,
          title: `${viewportLabel(viewport)}. ${on ? 'Click to hide' : 'Click to show'}`,
          onClick: () => {
            const next = new Set(hidden);
            if (on) {
              if (design().viewports.length - next.size <= 1) {
                toast('info', 'Keep at least one device size visible.');
                return;
              }
              next.add(viewport.id);
            } else next.delete(viewport.id);
            hidden = next;
            wall.setHiddenViewports([...hidden]);
            savePrefs(wall.getCamera());
            paintChips();
          },
        });
        chip.el.dataset.chip = on ? 'on' : 'off';
        chipHost.append(chip.el, h('span', { class: 'dc-chip-size' }, viewportSize(viewport)));
      }
    };

    // Page "View": Full width like a browser tab, or one of the design's viewports at its width.
    const viewportHost = h('div', { class: 'dc-viewport-select', title: 'Full width fills the viewer. A device size shows the page at that width.' });
    const showPageView = (id: string): void => {
      pageView = id;
      wall.setPageView(id);
      viewportSelect.update({ value: id });
    };
    const viewportSelect = mountSelect(viewportHost, {
      label: 'View',
      value: pageView,
      options: pageViewOptions(first.design.viewports),
      onChange: (id) => {
        showPageView(id);
        savePrefs(null);
      },
    });
    bscope.add(() => viewportSelect.dispose());
    const paintViewportOptions = (): void => {
      viewportSelect.update({ options: pageViewOptions(design().viewports), value: pageView });
    };

    const commentsButton = btn({ label: 'Comments', variant: 'outline', size: 'sm', icon: 'comment', onClick: () => toggleDrawer('comments') });
    const versionsButton = btn({ label: 'Versions', variant: 'outline', size: 'sm', icon: 'history', onClick: () => toggleDrawer('versions') });
    const chatButton = btn({ label: 'Continue in chat', variant: 'default', size: 'sm', icon: 'chat', onClick: () => void continueInChat(slug) });

    const exportMenu = btn({ label: 'Export', variant: 'outline', size: 'sm', icon: 'download', chevron: true, onClick: () => undefined });
    const copyMenu = btn({ label: 'Copy', variant: 'outline', size: 'sm', icon: 'copy', chevron: true, onClick: () => undefined });
    const moreButton = iconBtn({ icon: 'more', label: 'More actions', onClick: () => undefined });

    const doExport = async (format: 'zip' | 'html', screen?: string): Promise<void> => {
      const done = await exportDesign(slug, format, screen);
      if (!done) return;
      const { path } = done;
      notices.setTransient('export', banner({ tone: 'success', title: 'Export saved', body: path, action: { label: 'Show in folder', onClick: () => void reveal(path) } }), EXPORT_NOTICE_MS);
    };

    const pickScreenThenExport = (anchor: HTMLElement): void => {
      const screens = design().screens;
      if (screens.length <= 1) {
        void doExport('html', screens[0]?.id);
        return;
      }
      openMenu(anchor, screens.map((screen) => ({ id: screen.id, label: screen.title })), (id) => void doExport('html', id));
    };

    const ref = () => ({ slug, title: design().title, kind: design().kind, sessionId: design().sessionId });
    const rename = (): void => renameDialog(options.actions.host, ref());

    const moreEntries = (): MenuEntry[] =>
      viewerMenuEntries({ compact, isPage, copyHtmlTooLarge: htmlChars !== null && htmlChars > HOST_CLIPBOARD_MAX, askForTweaks: design().tweaks.length === 0 && viewing === null });

    const onMore = (id: string): void => {
      switch (id) {
        case 'chat':
          void continueInChat(slug);
          return;
        case 'ask-tweaks': {
          // Words for the ask bar, not sent: the user adds what they want and presses Send.
          const bar = askBarFor(wall);
          bar?.setText(ASK_FOR_TWEAKS_TEXT);
          bar?.focus();
          return;
        }
        case 'zip':
          void doExport('zip');
          return;
        case 'html':
          if (isPage) void doExport('html');
          else pickScreenThenExport(moreButton);
          return;
        case 'copy-html':
          void copyHtml(slug);
          return;
        case 'path':
          void copyPath(slug);
          return;
        case 'reveal':
          void revealDesign(slug);
          return;
        case 'rename':
          rename();
          return;
        case 'delete':
          confirmDelete(options.actions, ref());
          return;
      }
    };
    attachMenu(moreButton, moreEntries, onMore);
    attachMenu(
      exportMenu.el,
      () => [
        { id: 'zip', label: 'Download ZIP', hint: 'HTML + assets' },
        { id: 'html', label: 'Download single-file HTML', hint: 'assets inlined' },
      ],
      (id) => void doExport(id === 'zip' ? 'zip' : 'html'),
    );
    attachMenu(
      copyMenu.el,
      () => {
        const tooBig = htmlChars !== null && htmlChars > HOST_CLIPBOARD_MAX;
        return [
          { id: 'html', label: 'Copy HTML', disabled: tooBig, hint: tooBig ? 'too large to copy' : undefined },
          { id: 'path', label: 'Copy path' },
        ];
      },
      (id) => void (id === 'html' ? copyHtml(slug) : copyPath(slug)),
    );

    // ---------------------------------------------------------------- title
    const titleInput = h('input', { class: 'dc-title-input', type: 'text', 'aria-label': 'Design name', spellcheck: 'false', maxlength: '120' });
    titleInput.value = first.design.title;
    const commitTitle = async (): Promise<void> => {
      const next = titleInput.value.trim();
      if (next === design().title) return;
      try {
        await renameDesign(slug, next);
      } catch (error) {
        toast('error', `Couldn’t rename. ${errorText(error)}`);
        titleInput.value = design().title;
      }
    };
    titleInput.addEventListener('blur', () => void commitTitle());
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') titleInput.blur();
      else if (event.key === 'Escape') {
        titleInput.value = design().title;
        titleInput.blur();
      }
    });

    const titleText = h('h1', { class: 'dc-title-text', title: first.design.title }, first.design.title);

    // ---------------------------------------------------------------- toolbar layout
    const back = btn({ label: compact ? 'Designs' : 'Library', variant: 'ghost', size: 'sm', icon: 'back', onClick: options.onBack });
    let toolbar: HTMLElement;
    if (compact) {
      toolbar = h(
        'header',
        { class: 'dc-toolbar dc-toolbar-compact' },
        h('div', { class: 'dc-toolbar-row' }, iconBtn({ icon: 'back', label: 'Back to designs', onClick: options.onBack }), titleText, slots.compactActions, moreButton),
        // A page never pans or zooms, so its second row has no zoom group.
        isPage
          ? h('div', { class: 'dc-toolbar-row dc-toolbar-tools' }, viewportHost, commentMode.el)
          : h('div', { class: 'dc-toolbar-row dc-toolbar-tools' }, modeHost, h('span', { class: 'dc-spacer' }), zoomGroup),
      );
    } else if (isPage) {
      toolbar = h(
        'header',
        { class: 'dc-toolbar' },
        h('div', { class: 'dc-toolbar-group' }, back.el, titleInput),
        h('div', { class: 'dc-toolbar-group' }, viewportHost, commentMode.el),
        slots.statusSlot,
        h('div', { class: 'dc-toolbar-group' }, commentsButton.el, slots.tweaksSlot, versionsButton.el, exportMenu.el, copyMenu.el, chatButton.el, moreButton),
      );
    } else {
      toolbar = h(
        'header',
        { class: 'dc-toolbar' },
        h('div', { class: 'dc-toolbar-group' }, back.el, titleInput),
        h('div', { class: 'dc-toolbar-group' }, modeHost, pinsToggle.el, chipHost, zoomGroup),
        slots.statusSlot,
        h('div', { class: 'dc-toolbar-group' }, commentsButton.el, slots.tweaksSlot, versionsButton.el, chatButton.el, moreButton),
      );
    }

    // ---------------------------------------------------------------- notices
    const notices = createNotices();

    // "Ask the agent to fix it": one request at a time; the button is busy until it finishes,
    // also when the banner was repainted meanwhile.
    let asking = false;
    let askButton: BtnHandle | null = null;
    const setAsking = (busy: boolean): void => {
      asking = busy;
      askButton?.set({ loading: busy });
    };
    const askOffline = async (): Promise<void> => {
      if (asking) return;
      setAsking(true);
      try {
        const said = askRequestToast(await askSelfContained(slug));
        if (said !== null) toast('success', said);
      } catch (error) {
        toast('error', `Couldn’t ask the agent. ${errorText(error)}`);
      } finally {
        setAsking(false);
      }
    };

    /** Remote files the frames tried to load: the first few by host and path, the full URL on hover. */
    const remoteBanner = (urls: readonly string[]): HTMLElement => {
      const notice = remoteNotice(urls, isPage ? 'page' : 'canvas');
      askButton = btn({ label: 'Ask the agent to fix it', variant: 'outline', size: 'xs', loading: asking, onClick: () => void askOffline() });
      const hide = btn({ label: 'Hide', variant: 'ghost', size: 'xs', title: 'Hide until another file is blocked', onClick: () => hideRemote(urls) });
      const list = h(
        'ul',
        { class: 'dc-remote-list' },
        ...notice.urls.map((url) => h('li', null, h('code', { class: 'dc-path', title: url }, shortUrl(url)))),
        notice.more > 0 ? h('li', { class: 'dc-remote-more' }, `+ ${notice.more} more`) : null,
      );
      // data-actions="stack": in the rail both buttons get their own row under the list (styles.css).
      const wrap = h('div', { class: 'dc-banner dc-remote', 'data-actions': 'stack' });
      wrap.append(...bannerWithActions('warning', notice.title, ['They’re blocked here because designs run offline:', list], [askButton.el, hide.el]));
      return wrap;
    };

    /** Hide the banner for this design until a file it did not list is blocked; focus goes back to the wall. */
    const hideRemote = (urls: readonly string[]): void => {
      hiddenRemote.set(slug, [...urls]);
      paintNotices();
      wall.focus();
    };

    /** The comments drawer says the blocked files travel with the request (the service adds them). */
    const paintCommentsNote = (blocked: boolean): void => {
      if (drawer?.kind !== 'comments') return;
      const foot = drawer.sheet.foot;
      const note = foot.querySelector('.dc-foot-note');
      if (!blocked) note?.remove();
      else if (!note) foot.append(h('p', { class: 'dc-foot-note' }, 'The blocked files are listed in the request too.'));
    };

    // Frames report status often; the notices repaint only when what they show changed, so a
    // screen reader hears a warning once and a hovered button stays put.
    let noticesKey = '';
    const paintNotices = (): void => {
      const remote = wall.externalRefs();
      paintCommentsNote(remote.length > 0);
      const showRemote = remote.length > 0 && !viewing && !remoteBannerHidden(remote, hiddenRemote.get(slug) ?? null);
      const key = JSON.stringify([viewing, showRemote ? remote : [], restoreFlow.busyId()]);
      if (key === noticesKey) return;
      noticesKey = key;
      askButton = null;
      notices.setStatic([...(viewing ? [versionsRow(viewing)] : []), ...(showRemote ? [remoteBanner(remote)] : [])]);
    };

    const versionsRow = (current: { id: string; compare: boolean }): HTMLElement => {
      const number = Number(current.id.slice(1));
      const compareBtn = btn({ label: current.compare ? `View v${number} only` : 'Compare with current', variant: 'outline', size: 'xs', icon: 'compare', onClick: () => viewVersion(current.id, !current.compare) });
      const restoring = restoreFlow.busyId();
      const restoreBtn = btn({ label: 'Restore', variant: 'outline', size: 'xs', loading: restoring === current.id, disabled: restoring !== null && restoring !== current.id, onClick: () => void restoreVersion({ id: current.id, n: number }) });
      restoreBtn.el.dataset.restore = current.id;
      const backBtn = btn({ label: 'Back to current', variant: 'default', size: 'xs', onClick: () => leaveVersion() });
      const listBtn = compact ? btn({ label: 'Versions', variant: 'ghost', size: 'xs', onClick: () => toggleDrawer('versions') }) : null;
      return h('div', { class: 'dc-viewing', role: 'status' }, icon_(), h('span', { class: 'dc-viewing-text' }, viewingBanner(number, current.compare)), h('span', { class: 'dc-viewing-actions' }, compareBtn.el, restoreBtn.el, listBtn?.el ?? null, backBtn.el));
    };

    const icon_ = (): HTMLElement => h('span', { class: 'dc-viewing-dot', 'aria-hidden': 'true' });

    /**
     * Seam S10: where a restore starts, for the Versions list and the "Viewing" bar. It restores at
     * once and offers Undo in the notices (components/restore-flow.ts); it reports its own errors and never rejects.
     */
    const restoreFlow = createRestoreFlow({
      slug,
      notices,
      onRestored: () => {
        if (viewing) leaveVersion();
        // The rail's Versions sheet covers the notice: close it so the Undo shows.
        if (compact && drawer?.kind === 'versions') closeDrawer();
      },
      onBusy: () => {
        (drawer?.kind === 'versions' ? (drawer.handle as VersionsHandle) : null)?.refresh();
        paintNotices();
      },
      focusWall: () => wall.focus(),
      // A failed restore repainted the button that had focus. In the rail the open Versions sheet is modal,
      // so focus goes back to that sheet's button, never to the wall behind it.
      onFailed: (version) => {
        if (drawer?.kind === 'versions') (drawer.handle as VersionsHandle).focusRestore(version.id);
        else el.querySelector<HTMLElement>(`.dc-viewing [data-restore="${CSS.escape(version.id)}"]`)?.focus();
      },
    });
    const restoreVersion = restoreFlow.restore;

    const viewVersion = (id: string, compare: boolean): void => {
      viewing = { id, compare };
      wall.setVersion(id, compare);
      modeTabs.update({ activeId: 'play' });
      modeHost.dataset.disabled = 'true';
      commentMode.el.disabled = true;
      paintNotices();
      (drawer?.kind === 'versions' ? (drawer.handle as VersionsHandle) : null)?.refresh();
      viewingListeners.emit();
    };

    const leaveVersion = (): void => {
      viewing = null;
      wall.setVersion(null, false);
      modeTabs.update({ activeId: mode });
      delete modeHost.dataset.disabled;
      commentMode.el.disabled = false;
      paintNotices();
      (drawer?.kind === 'versions' ? (drawer.handle as VersionsHandle) : null)?.refresh();
      viewingListeners.emit();
    };

    // ---------------------------------------------------------------- drawers
    const dock = h('aside', { class: 'dc-dock', hidden: true });
    dockEl = dock;
    /** What the open drawer holds goes with it: its content, and the bottom sheet's height watch. */
    const release = (current: Drawer): void => {
      current.handle.dispose();
      current.stop?.();
    };
    // Tweaks fills its own sheet (feature-tweaks.ts registers the filler); the view only opens it.
    let tweaksFill: ((sheet: SheetHandle) => DrawerContent) | null = null;
    const closeDrawer = (): void => {
      const current = drawer;
      drawer = null;
      if (current) release(current);
      current?.sheet.close();
      commentsButton.set({ pressed: false });
      versionsButton.set({ pressed: false });
      dock.hidden = true;
      wall.refit();
      drawerListeners.emit();
    };

    const toggleDrawer = (kind: DrawerKind): void => {
      if (drawer?.kind === kind) {
        closeDrawer();
        return;
      }
      if (kind === 'tweaks' && !tweaksFill) return;
      if (drawer) {
        const previous = drawer;
        drawer = null;
        release(previous);
        previous.sheet.close();
      }
      const title = kind === 'comments' ? 'Comments' : kind === 'versions' ? 'Versions' : TWEAKS_TITLE;
      // The rail's Tweaks is a bottom sheet with the wall live above it when the rail is tall enough; Comments and Versions stay full height.
      const variant: SheetVariant = !compact ? 'dock' : kind === 'tweaks' ? tweaksSheetVariant(options.actions.host.clientHeight) : 'full';
      const sheet = openSheet(compact ? options.actions.host : dock, {
        title,
        variant,
        ...(kind === 'tweaks' ? { subtitle: TWEAKS_SUBTITLE } : {}),
        onClose: () => {
          if (drawer?.sheet === sheet) {
            release(drawer);
            drawer = null;
            commentsButton.set({ pressed: false });
            versionsButton.set({ pressed: false });
            dock.hidden = true;
            wall.refit();
            drawerListeners.emit();
          }
        },
      });
      let handle: CommentsHandle | VersionsHandle | DrawerContent;
      if (kind === 'tweaks') {
        handle = (tweaksFill ?? ((): DrawerContent => ({ dispose: () => undefined })))(sheet);
      } else if (kind === 'comments') {
        const comments = mountComments({
          slug,
          detached: () => wall.detachedIds(),
          anchorStates: () => wall.anchorStates(),
          onLocate: (id) => {
            if (compact) closeDrawer();
            if (viewing) leaveVersion();
            if (isPage && mode !== 'edit') setMode('edit');
            wall.focusComment(id);
          },
        });
        sheet.body.append(comments.el);
        handle = comments;
        void store.refreshOpenDesign();
      } else {
        const versions = mountVersions({
          slug,
          viewing: () => viewing,
          onView: (id) => {
            viewVersion(id, false);
            if (compact) closeDrawer();
          },
          onCompare: (id) => {
            viewVersion(id, true);
            if (compact) closeDrawer();
          },
          onBackToCurrent: () => leaveVersion(),
          restoring: restoreFlow.busyId,
          onRestore: restoreVersion,
        });
        sheet.body.append(versions.el);
        handle = versions;
        void store.loadVersions(slug);
      }
      drawer = { kind, sheet, handle, stop: variant === 'bottom' ? trackBottomSheet(options.actions.host, sheet, () => wall.refit()) : null };
      paintCommentsNote(wall.externalRefs().length > 0);
      // The bottom sheet lives in the rail's own host and leaves the wall live above it: an empty dock beside the wall would squeeze it.
      dock.hidden = variant === 'bottom';
      wall.refit();
      commentsButton.set({ pressed: kind === 'comments' });
      versionsButton.set({ pressed: kind === 'versions' });
      drawerListeners.emit();
    };

    // ---------------------------------------------------------------- data flow
    const openCount = (): number => design().comments.filter((comment) => comment.status === 'open').length;

    const refreshHtmlSize = (): void => {
      if (!isPage) return;
      void store.loadSource(slug).then(
        (source) => void (htmlChars = source.text.length),
        () => void (htmlChars = null),
      );
    };
    const refreshHtmlSizeSoon = debounce(refreshHtmlSize, 600);

    const apply = (next: DesignDetailResponse): void => {
      data = next;
      wall.setDetail(next);
      if (document.activeElement !== titleInput) titleInput.value = next.design.title;
      titleText.textContent = next.design.title;
      titleText.title = next.design.title;
      const count = openCount();
      commentsButton.set({ label: count > 0 ? `Comments · ${count}` : 'Comments' });
      paintChips();
      paintViewportOptions();
      paintNotices();
      // The agent removed the viewport this page was shown at: back to Full width.
      if (isPage && resolvePageView(pageView, next.design.viewports) !== pageView) showPageView(PAGE_FILL_VIEWPORT_ID);
      detailListeners.emit();
    };

    // The store bumps a source's render revision when the agent changes its files.
    let revs = store.getState().renderRevs;
    bscope.add(
      store.subscribe((state) => {
        if (state.renderRevs === revs) return;
        const previous = revs;
        revs = state.renderRevs;
        const sources = isPage ? [null] : design().screens.map((screen) => screen.id);
        const changed = new Set(sources.filter((source) => revs[renderSourceKey(slug, source)] !== previous[renderSourceKey(slug, source)]));
        if (changed.size === 0) return;
        wall.reload(changed);
        refreshHtmlSizeSoon();
      }),
    );

    const main = h('div', { class: 'dc-design-main' }, h('div', { class: 'dc-wall-col' }, stage, slots.bottomDock), dock);
    replace(el, toolbar, notices.el, main, compact ? h('footer', { class: 'dc-hint' }, FULL_SCREEN_HINT) : null);
    apply(first);
    refreshHtmlSize();
    if (isPage) {
      commentMode.set({ pressed: mode === 'edit' });
      paintViewportOptions();
    }
    wall.fit();
    queueMicrotask(() => wall.focus());

    // Features that must be asked before the user leaves this design (unsaved tweaks).
    const leaveGuards: Array<() => Promise<boolean>> = [];
    // Seam S9: the Phase 1 features mount once the wall exists, and unmount with the view.
    const viewContext: ViewContext = {
      slug,
      surface: options.surface,
      isPage,
      detail: () => data,
      onDetail: detailListeners.add,
      viewing: () => viewing,
      onViewing: viewingListeners.add,
      wall,
      slots,
      drawers: {
        toggle: toggleDrawer,
        active: () => drawer?.kind ?? null,
        onChange: drawerListeners.add,
        register: (_kind, fill) => {
          tweaksFill = fill;
          return () => {
            if (tweaksFill !== fill) return;
            tweaksFill = null;
            if (drawer?.kind === 'tweaks') closeDrawer();
          };
        },
        close: closeDrawer,
        isBottomSheet: () => drawer?.sheet.el.dataset.variant === 'bottom',
      },
      onKeepDirection: keepListeners.add,
      onBeforeLeave: (guard) => {
        leaveGuards.push(guard);
        return () => {
          const at = leaveGuards.indexOf(guard);
          if (at >= 0) leaveGuards.splice(at, 1);
        };
      },
      notices,
      actions: options.actions,
      scope: bscope,
    };
    // One feature failing to mount or unmount must not take the viewer, or the others, down with it.
    const mountFeature = (name: string, mount: FeatureMount): (() => void) => {
      try {
        const unmount = mount(viewContext);
        return () => {
          try {
            unmount();
          } catch (error) {
            console.error(`design chamber: ${name} unmount failed`, error);
          }
        };
      } catch (error) {
        console.error(`design chamber: ${name} mount failed`, error);
        return () => undefined;
      }
    };
    const unmounts = [
      mountFeature('build strip', buildStrip.mount),
      mountFeature('ask bar', askBar.mount),
      mountFeature('findability', findability.mount),
      mountFeature('checks badge', checks.mount),
      // After the build strip and the ask bar: it reads the strip's phase and hands the ask bar an element.
      mountFeature('edit text', editText.mount),
      // Also after the build strip (it reads the strip's phase for the menu's hint) and after Edit text (they share one undo slot).
      mountFeature('screens', screens.mount),
      // Also after Edit text (one undo slot), and after the screens feature: both write through the same notices.
      mountFeature('directions', directions.mount),
      // After the build strip (its phase is the panel's agent-working hint), the ask bar (Send goes quiet while the panel is open) and Edit text (they share one undo slot).
      mountFeature('tweaks', tweaks.mount),
    ];

    built = {
      apply,
      startComment: () => setMode('edit'),
      beforeLeave: async () => {
        for (const guard of [...leaveGuards]) if (!(await guard())) return false;
        return true;
      },
      dispose: () => {
        for (const unmount of [...unmounts].reverse()) unmount();
        restoreFlow.dispose();
        closeDrawer();
        notices.dispose();
        bscope.dispose();
        wall.dispose();
      },
    };
  };

  let lastApplied: DesignDetailResponse | null = null;
  const update = (): void => {
    if (disposed) return;
    const state = stateOf();
    if (built) {
      if (state?.data) {
        // The store notifies for every slot it loads; only a new answer for this design needs the wall.
        if (state.data !== lastApplied) {
          lastApplied = state.data;
          built.apply(state.data);
        }
      }
      else if (!state || (state.status === 'error' && isServiceError(state.error, 'not-found'))) {
        built.dispose();
        built = null;
        lastApplied = null;
        showMessage(h('p', { class: 'dc-empty-title' }, 'This design is gone'), h('p', { class: 'dc-empty-body' }, 'Its folder was moved or deleted. Pick another design from the list.'));
      }
      return;
    }
    if (building) return;
    if (!state || state.status === 'idle' || (state.status === 'loading' && !state.data)) {
      showMessage(loadingRow('Opening design…'));
      return;
    }
    if (state.data) {
      void build(state.data);
      return;
    }
    showMessage(banner({ tone: 'error', title: 'This design didn’t open', body: state.error?.message ?? 'The local service didn’t answer.', action: { label: 'Try again', onClick: () => void store.openDesign(slug) } }));
  };

  scope.add(store.subscribe(update));
  void store.openDesign(slug);
  update();

  return {
    el,
    startComment: () => {
      if (built) built.startComment();
      else wantComment = true;
    },
    beforeLeave: () => (built ? built.beforeLeave() : Promise.resolve(true)),
    dispose: () => {
      disposed = true;
      scope.dispose();
      built?.dispose();
      if (store.getState().open?.slug === slug) store.closeDesign();
      el.remove();
    },
  };
};
