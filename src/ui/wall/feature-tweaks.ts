// Phase 2 feature mount (seam S9): the Tweaks panel (feature 09). It adds the Tweaks button when the design
// declares at least one valid knob (the toolbar on the page, the header actions in the rail), gives the view's
// drawer its content (a side dock on the page, a bottom sheet on the rail with the wall live above it), keeps one
// controller per open design (`src/guest/tweaks.ts`: values, preview, stale file, the storage mirror), and
// guards leaving the design with unsaved values.
//
// Like Edit text it is the only place that starts a write, and only from Save, "Apply to the new file" or the
// leave dialog's Save (E1): no message from a design frame reaches it. Moving a knob only previews, on every live
// artboard, through `wall.setTokenPreview`. While an old version is on show nothing previews and nothing saves.

import { phaseOf } from '../../guest/build-activity.ts';
import { createTweaksController, type TweaksController, type TweaksStorage } from '../../guest/tweaks.ts';
import { createEditNotice } from '../components/edit-notice.ts';
import { iconBtn, btn, type BtnHandle } from '../components/kit.ts';
import { askToSaveTweaks, mountTweaksPanel, type TweaksPanelHandle } from '../components/tweaks-panel.ts';
import { client, feed, guestHost, store } from '../guest.ts';
import { agentIsWorking } from '../model/edit-text-model.ts';
import { leaveDecision, tweaksButtonLabel } from '../model/tweaks-model.ts';
import { askBarFor } from './feature-ask-bar.ts';
import { buildActivityFor } from './feature-build-strip.ts';
import { undoSlotFor } from './feature-undo.ts';
import type { FeatureMount } from './view-context.ts';

/** `host.storage` as the controller's mirror wants it (the UI's `host.storage` wrapper has no delete). */
const mirrorStorage: TweaksStorage = {
  get: (key) => guestHost.client.storage.get(key),
  set: (key, value) => guestHost.client.storage.set(key, value),
  delete: (key) => guestHost.client.storage.delete(key),
};

export const mount: FeatureMount = (ctx) => {
  const { wall, slug } = ctx;
  const rail = ctx.surface === 'panel';
  let disposed = false;
  let controller: TweaksController | null = null;
  let panel: TweaksPanelHandle | null = null;
  const stops: Array<() => void> = [];
  const undoSlot = undoSlotFor(wall);

  const notice = createEditNotice({
    notices: ctx.notices,
    undo: async (editId) => {
      await store.undoEdit(slug, editId);
    },
    onNoticeUndo: undoSlot.noticeUndo,
    focusWall: () => wall.focus(),
    viewing: () => ctx.viewing() !== null,
    onViewing: ctx.onViewing,
  });

  const knobs = () => ctx.detail().design.tweaks;
  const hasKnobs = (): boolean => knobs().length > 0;

  const agentWorking = (): boolean => {
    const watcher = buildActivityFor(wall);
    return watcher !== undefined && agentIsWorking(phaseOf(watcher.get(), Date.now()));
  };

  // ---------------------------------------------------------------- the button

  let pageButton: BtnHandle | null = null;
  let railButton: HTMLButtonElement | null = null;
  const buttonEl = (): HTMLElement | null => pageButton?.el ?? railButton;

  const toggle = (): void => {
    if (!hasKnobs()) return;
    ctx.drawers.toggle('tweaks');
  };

  if (rail) {
    railButton = iconBtn({ icon: 'tune', label: 'Tweaks', pressed: false, onClick: toggle });
    railButton.classList.add('dc-tweaks-btn');
    // Between Comments and Versions, as on the page; the findability feature mounted those first.
    const versions = ctx.slots.compactActions.querySelector('.dc-versions-btn');
    ctx.slots.compactActions.insertBefore(railButton, versions);
  } else {
    pageButton = btn({ label: 'Tweaks', variant: 'outline', size: 'sm', icon: 'tune', pressed: false, onClick: toggle });
    pageButton.el.classList.add('dc-tweaks-btn');
    ctx.slots.tweaksSlot.append(pageButton.el);
  }

  const paintButton = (): void => {
    const el = buttonEl();
    if (!el) return;
    const dirty = controller?.getState().dirty === true;
    const open = ctx.drawers.active() === 'tweaks';
    const label = tweaksButtonLabel(dirty);
    el.hidden = !hasKnobs();
    el.classList.toggle('dc-dotmark', dirty);
    el.setAttribute('aria-pressed', String(open));
    // The page button shows its own word; the name only changes when there is something unsaved. The rail's icon always has one.
    if (rail) {
      el.setAttribute('aria-label', label);
      el.title = label;
    } else if (dirty) el.setAttribute('aria-label', label);
    else el.removeAttribute('aria-label');
  };

  // ---------------------------------------------------------------- preview

  /** What the frames wear: the pending values, or nothing while an old version is on show (it never previews). */
  const applyPreview = (): void => {
    wall.setTokenPreview(controller && ctx.viewing() === null ? controller.preview() : []);
  };

  // ---------------------------------------------------------------- the controller

  const ensureController = (): TweaksController => {
    if (controller) return controller;
    const created = createTweaksController({
      client,
      slug,
      tweaks: knobs,
      storage: mirrorStorage,
      onPreview: applyPreview,
    });
    controller = created;
    stops.push(created.subscribe(() => paintButton()), feed.subscribe((batch) => created.applyChanges(batch)), created.dispose);
    // Read tokens.css now: restores values the user left unsaved, so the dot and the preview are there before the panel opens.
    void created.load();
    return created;
  };

  /** Save or Apply: one request, its notice with Undo, and nothing more; a refusal stays on the controller for the panel. */
  const commit = async (run: (current: TweaksController) => ReturnType<TweaksController['save']>): Promise<void> => {
    const current = controller;
    if (!current || ctx.viewing() !== null) return;
    try {
      const response = await run(current);
      if (disposed) return;
      if (response.edit.undoable) undoSlot.edited(response.edit.id);
      notice.saved(response.edit);
      // The rail's full-height fallback sheet covers the notices, Undo included: close it so the notice shows
      // (the bottom sheet and the page's dock leave the notices in view).
      if (rail && ctx.drawers.active() === 'tweaks' && !ctx.drawers.isBottomSheet()) ctx.drawers.close();
    } catch {
      // The controller holds the error (`saveError`, or the stale state); the panel shows it with the values still there.
    }
  };

  // ---------------------------------------------------------------- the panel

  const unregister = ctx.drawers.register('tweaks', (sheet) => {
    const current = ensureController();
    const opened = mountTweaksPanel({
      sheet,
      controller: current,
      tweaks: knobs,
      viewing: () => ctx.viewing() !== null,
      agentWorking,
      onSave: () => void commit((c) => c.save()),
      onApply: () => void commit((c) => c.applyToNewFile()),
    });
    panel = opened;
    return {
      dispose: () => {
        opened.dispose();
        if (panel === opened) panel = null;
      },
    };
  });

  // ---------------------------------------------------------------- drawer, detail, version, agent

  let wasOpen = false;
  const syncDrawer = (): void => {
    const open = ctx.drawers.active() === 'tweaks';
    // One filled primary on screen: while the panel's Save is there, Send takes the outline look.
    askBarFor(wall)?.setQuiet(open);
    paintButton();
    // A non-modal sheet gives no focus back when it closes: the button that opened it does.
    if (wasOpen && !open && (document.activeElement === document.body || document.activeElement === null)) buttonEl()?.focus({ preventScroll: true });
    wasOpen = open;
  };

  const syncDetail = (): void => {
    if (hasKnobs()) ensureController();
    else if (controller) {
      // The agent took every knob away: nothing is left to preview or save.
      controller.discard();
      if (ctx.drawers.active() === 'tweaks') ctx.drawers.close();
    }
    paintButton();
    panel?.refresh();
  };

  const syncViewing = (): void => {
    applyPreview();
    panel?.refresh();
  };

  // Esc pressed on the wall closes the rail's bottom sheet, but only when the wall did not use it (a card, an editor, a popover).
  // The wall's own key handler runs first on the same element and marks a used key as handled.
  const onWallKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (ctx.drawers.active() !== 'tweaks' || !ctx.drawers.isBottomSheet()) return;
    event.preventDefault();
    ctx.drawers.close();
  };
  wall.el.addEventListener('keydown', onWallKey);

  // Leaving with unsaved values: the three-button question. Closing only the panel keeps them pending (the dot stays).
  const offGuard = ctx.onBeforeLeave(async () => {
    const current = controller;
    if (!current || leaveDecision(current.getState()) === 'leave') return true;
    return askToSaveTweaks({
      host: ctx.actions.host,
      save: async () => {
        await current.save();
      },
      discard: () => current.discard(),
    });
  });

  const watcher = buildActivityFor(wall);
  const offWatch = watcher?.subscribe(() => panel?.refresh());

  stops.push(ctx.drawers.onChange(syncDrawer), ctx.onDetail(syncDetail), ctx.onViewing(syncViewing));
  if (hasKnobs()) ensureController();
  paintButton();

  return () => {
    disposed = true;
    wall.el.removeEventListener('keydown', onWallKey);
    offGuard();
    offWatch?.();
    unregister();
    for (const stop of stops.splice(0).reverse()) stop();
    controller = null;
    panel = null;
    notice.dispose();
    buttonEl()?.remove();
  };
};
