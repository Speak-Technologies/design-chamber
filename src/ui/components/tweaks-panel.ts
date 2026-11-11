// The Tweaks panel's body and footer (Phase 2 feature 09, technical design §4.6): one row per knob (a
// slider, or a segmented choice), the banners above them, the load-failed and design-gone blocks, and the
// pinned footer (Reset, Save, one note). It lives in a sheet the design view opened (a side dock on the
// page, a bottom sheet on the rail), draws from the controller's state (`src/guest/tweaks.ts`) through the
// view-model (`model/tweaks-model.ts`), and starts nothing itself: Save and "Apply to the new file" go back
// to the feature, which owns the notices.
//
// Rows are built once per set of knobs and patched in place after that, so a slider keeps the pointer while
// the user drags it. Moving a knob is `controller.setValue`: it previews on the wall within a frame.

import { mountBadge, mountTabs, type TabsHandle } from '@openchamber/sdk/ui';

import type { TweaksController, TweaksState } from '../../guest/tweaks.ts';
import type { Tweak } from '../../shared/types.ts';
import {
  footView,
  knobRows,
  LEAVE_BODY,
  LEAVE_TITLE,
  panelBanners,
  panelMode,
  readFailedText,
  saveFailedText,
  TOKENS_LOADING_TEXT,
  UNSAVED_BADGE,
  unsavedLines,
  DESIGN_GONE_TEXT,
  VALUES_KEPT_TEXT,
  type KnobRow,
  type PanelBanner,
} from '../model/tweaks-model.ts';
import { createScope, errorText, h, nextId, replace } from './dom.ts';
import { icon } from './icons.ts';
import { banner, bannerWithActions, btn, loadingRow, openSheet, type SheetHandle } from './kit.ts';

export type TweaksPanelOptions = {
  /** The sheet the view opened; the panel fills its title badge, body and foot. */
  sheet: SheetHandle;
  controller: TweaksController;
  /** The design's current knobs (a new design.json answer changes them). */
  tweaks: () => readonly Tweak[];
  /** An old version is on show: the rows and buttons are off. */
  viewing: () => boolean;
  /** The build strip says the linked agent is working. */
  agentWorking: () => boolean;
  /** Save pressed. The feature saves, raises the notice and reports its own errors (the panel shows the controller's). */
  onSave: () => void;
  /** "Apply to the new file" pressed (the stale banner). */
  onApply: () => void;
};

export type TweaksPanelHandle = {
  /** Repaint: the knobs, the viewing state or the agent's activity changed outside the controller. */
  refresh: () => void;
  dispose: () => void;
};

type RowView = {
  var: string;
  li: HTMLElement;
  value: HTMLElement;
  input: HTMLInputElement | null;
  tabs: TabsHandle | null;
  tabsHost: HTMLElement | null;
  notes: HTMLElement;
  notesKey: string;
  reason: HTMLElement;
  reasonText: HTMLElement;
  onChoice: { current: (id: string) => void };
};

export const mountTweaksPanel = (options: TweaksPanelOptions): TweaksPanelHandle => {
  const { sheet, controller } = options;
  const scope = createScope();
  const prefix = nextId('dc-tweaks');

  // ---- title badge ("Unsaved") ----
  const title = sheet.el.querySelector<HTMLElement>('.dc-sheet-title');
  let badge: ReturnType<typeof mountBadge> | null = null;
  let badgeHost: HTMLElement | null = null;
  if (title) {
    badgeHost = h('span', { class: 'dc-tweaks-badge', hidden: true });
    badge = mountBadge(badgeHost, { label: UNSAVED_BADGE, tone: 'warning' });
    title.append(' ', badgeHost);
  }

  // ---- body ----
  const bannersEl = h('div', { class: 'dc-tweaks-banners' });
  const loadingEl = h('div', { class: 'dc-tweaks-loading' }, loadingRow(TOKENS_LOADING_TEXT));
  const failedEl = h('div', { class: 'dc-tweaks-failed' });
  const goneEl = h('div', { class: 'dc-tweaks-gone' });
  const rowsEl = h('ul', { class: 'dc-tweaks-rows', 'aria-label': 'Tweak controls' });
  sheet.body.classList.add('dc-tweaks-body');
  sheet.body.append(bannersEl, loadingEl, failedEl, goneEl, rowsEl);

  // ---- foot ----
  const noteEl = h('p', { class: 'dc-tweaks-note', hidden: true });
  const reset = btn({ label: 'Reset', variant: 'ghost', icon: 'reset', onClick: () => controller.reset() });
  const save = btn({ label: 'Save', variant: 'default', emphasis: 'primary', icon: 'check', onClick: () => options.onSave() });
  sheet.foot.classList.add('dc-tweaks-foot');
  sheet.foot.append(noteEl, h('div', { class: 'dc-sheet-foot-row' }, reset.el, save.el));

  let rows: RowView[] = [];
  let rowsKey = '';
  let bannersKey = '';
  let failedKey = '';
  let goneKey = '';

  // ---------------------------------------------------------------- rows

  const buildRow = (tweak: Tweak): RowView => {
    const id = `${prefix}-${tweak.var.slice(2)}`;
    const value = h('span', { class: 'dc-knob-value' });
    const notes = h('div', { class: 'dc-knob-notes' });
    const reasonText = h('span');
    const reason = h('p', { class: 'dc-knob-reason', hidden: true }, icon('warning', 14), reasonText);
    const onChoice = { current: (_id: string): void => undefined };
    let input: HTMLInputElement | null = null;
    let tabs: TabsHandle | null = null;
    let tabsHost: HTMLElement | null = null;
    let head: HTMLElement;
    let control: HTMLElement;
    if (tweak.kind === 'number') {
      head = h('div', { class: 'dc-knob-head' }, h('label', { class: 'dc-knob-label', for: id }, tweak.label), value);
      input = h('input', { id, type: 'range', min: tweak.min, max: tweak.max, step: tweak.step });
      const slider = input;
      slider.addEventListener('input', () => controller.setValue(tweak.var, Number(slider.value)));
      // Page Up and Page Down move ten steps (the browser's own page step is a tenth of the range, which is one step on a short one).
      slider.addEventListener('keydown', (event) => {
        if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
        event.preventDefault();
        controller.setValue(tweak.var, Number(slider.value) + (event.key === 'PageUp' ? 10 : -10) * tweak.step);
      });
      control = slider;
    } else {
      head = h('div', { class: 'dc-knob-head' }, h('span', { class: 'dc-knob-label', id: `${id}-label` }, tweak.label), value);
      tabsHost = h('div', { class: 'dc-knob-choice', role: 'group', 'aria-labelledby': `${id}-label` });
      tabs = mountTabs(tabsHost, {
        items: tweak.options.map((option) => ({ id: option.value, label: option.label })),
        activeId: '',
        trackBackground: true,
        onChange: (next) => onChoice.current(next),
      });
      onChoice.current = (next) => controller.setValue(tweak.var, next);
      control = tabsHost;
    }
    const li = h('li', { class: 'dc-knob', 'data-knob': tweak.var }, head, control, notes, reason);
    return { var: tweak.var, li, value, input, tabs, tabsHost, notes, notesKey: '', reason, reasonText, onChoice };
  };

  const paintRow = (view: RowView, row: KnobRow): void => {
    view.value.textContent = row.valueText;
    view.li.dataset.changed = String(row.changed);
    view.li.dataset.broken = String(row.reason !== null);
    view.li.dataset.disabled = String(row.disabled);
    if (view.input && row.number) {
      const text = String(row.number.value);
      if (view.input.value !== text) view.input.value = text;
      view.input.disabled = row.disabled;
      view.input.setAttribute('aria-valuetext', row.valueText);
    }
    if (view.tabs && view.tabsHost && row.choice) {
      view.tabs.update({ activeId: row.choice.active });
      view.tabsHost.inert = row.disabled;
      view.tabsHost.dataset.disabled = String(row.disabled);
    }
    const key = row.notes.join('\n');
    if (key !== view.notesKey) {
      view.notesKey = key;
      view.notes.replaceChildren(...row.notes.map((note) => h('p', { class: 'dc-knob-note' }, note)));
    }
    view.reason.hidden = row.reason === null;
    view.reasonText.textContent = row.reason ?? '';
  };

  const paintRows = (state: TweaksState, tweaks: readonly Tweak[], viewing: boolean): void => {
    const key = JSON.stringify(tweaks);
    if (key !== rowsKey) {
      rowsKey = key;
      for (const view of rows) view.tabs?.dispose();
      rows = tweaks.map(buildRow);
      rowsEl.replaceChildren(...rows.map((view) => view.li));
    }
    const model = knobRows(tweaks, state, { viewing });
    model.forEach((row, index) => {
      const view = rows[index];
      if (view) paintRow(view, row);
    });
  };

  // ---------------------------------------------------------------- banners and blocks

  const bannerNode = (entry: PanelBanner, state: TweaksState): HTMLElement => {
    if (entry.kind === 'stale') {
      const apply = btn({ label: 'Apply to the new file', variant: 'outline', size: 'xs', disabled: state.status === 'saving', onClick: () => options.onApply() });
      const discard = btn({ label: 'Discard my tweaks', variant: 'ghost', size: 'xs', disabled: state.status === 'saving', onClick: () => controller.discard() });
      const wrap = h('div', { class: 'dc-banner dc-tweaks-banner', 'data-actions': 'stack' });
      wrap.append(...bannerWithActions('warning', entry.title, [entry.body], [apply.el, discard.el]));
      return wrap;
    }
    return banner({ tone: entry.kind === 'viewing' ? 'info' : 'warning', title: entry.title });
  };

  const paintBanners = (state: TweaksState, tweaks: readonly Tweak[], viewing: boolean): void => {
    const entries = panelBanners(state, tweaks, { viewing });
    const key = JSON.stringify([entries, state.status === 'saving']);
    if (key === bannersKey) return;
    bannersKey = key;
    bannersEl.replaceChildren(...entries.map((entry) => bannerNode(entry, state)));
  };

  const paintFailed = (state: TweaksState): void => {
    const failed = state.status === 'error' && state.loadError !== null && !state.gone;
    failedEl.hidden = !failed;
    if (!failed || !state.loadError) {
      failedKey = '';
      return;
    }
    const message = readFailedText(state.loadError.message);
    const key = `${message}|${state.pending.size > 0}`;
    if (key === failedKey) return;
    failedKey = key;
    const retry = btn({ label: 'Try again', variant: 'outline', size: 'xs', onClick: () => void controller.retry() });
    replace(failedEl, h('p', { class: 'dc-tweaks-error', role: 'alert' }, message), state.pending.size > 0 ? h('p', { class: 'dc-tweaks-kept' }, VALUES_KEPT_TEXT) : null, retry.el);
  };

  const paintGone = (state: TweaksState, tweaks: readonly Tweak[]): void => {
    const lines = unsavedLines(tweaks, state);
    const key = lines.join('\n');
    if (key === goneKey && goneEl.childElementCount > 0) return;
    goneKey = key;
    const list = h('ul', { class: 'dc-tweaks-lost' }, ...lines.map((line) => h('li', null, line)));
    const wrap = h('div', { class: 'dc-banner dc-tweaks-banner' });
    wrap.append(...bannerWithActions('warning', DESIGN_GONE_TEXT, lines.length === 0 ? [] : [list], []));
    replace(goneEl, wrap);
  };

  // ---------------------------------------------------------------- footer

  const paintFoot = (state: TweaksState, viewing: boolean): void => {
    const view = footView(state, { viewing, agentWorking: options.agentWorking() });
    reset.set({ disabled: view.resetDisabled });
    save.set({ disabled: view.saveDisabled, loading: view.saving, title: view.saveTitle ?? '' });
    noteEl.hidden = view.note === null;
    noteEl.textContent = view.note?.text ?? '';
    noteEl.dataset.tone = view.note?.tone ?? 'muted';
    noteEl.setAttribute('role', view.note?.tone === 'error' ? 'alert' : 'status');
  };

  // ---------------------------------------------------------------- paint

  const paint = (): void => {
    const state = controller.getState();
    const tweaks = options.tweaks();
    const viewing = options.viewing();
    const mode = panelMode(state);
    const hadFocus = sheet.body.contains(document.activeElement) || sheet.foot.contains(document.activeElement);
    if (badgeHost) badgeHost.hidden = !state.dirty;
    paintBanners(state, tweaks, viewing);
    loadingEl.hidden = mode !== 'loading';
    goneEl.hidden = mode !== 'gone';
    if (mode === 'gone') paintGone(state, tweaks);
    paintFailed(state);
    rowsEl.hidden = mode === 'gone' || mode === 'loading';
    if (!rowsEl.hidden) paintRows(state, tweaks, viewing);
    paintFoot(state, viewing);
    // A control that had focus and went away (Try again, Save while it saves) hands it to the panel, never to the page behind.
    if (hadFocus && !(sheet.body.contains(document.activeElement) || sheet.foot.contains(document.activeElement))) sheet.el.querySelector<HTMLElement>('.dc-sheet-panel')?.focus({ preventScroll: true });
  };

  scope.add(controller.subscribe(paint));
  paint();

  return {
    refresh: paint,
    dispose: () => {
      scope.dispose();
      for (const view of rows) view.tabs?.dispose();
      badge?.dispose();
      rows = [];
    },
  };
};

// ---------------------------------------------------------------- leaving

export type LeaveDialogOptions = {
  host: HTMLElement;
  /** Save the pending values; throws (or rejects) when it did not go through, with the controller's error. */
  save: () => Promise<void>;
  /** Drop the pending values. */
  discard: () => void;
};

/**
 * "Save your tweaks?": the three answers. Resolves true when the user may leave (saved or discarded), false for
 * Keep editing (also Escape and a press outside). A failed save keeps the dialog open with the sentence and Save
 * to try again; the values are kept.
 */
export const askToSaveTweaks = (options: LeaveDialogOptions): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const settle = (leave: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(leave);
    };
    const sheet = openSheet(options.host, { title: LEAVE_TITLE, variant: 'dialog', onClose: () => settle(false) });
    const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    sheet.body.append(h('div', { class: 'dc-confirm-body' }, h('p', null, LEAVE_BODY)), failure);
    const keep = btn({ label: 'Keep editing', variant: 'ghost', onClick: () => sheet.close() });
    const discard = btn({
      label: 'Discard',
      variant: 'destructive',
      onClick: () => {
        options.discard();
        settle(true);
        sheet.close();
      },
    });
    const save = btn({
      label: 'Save',
      variant: 'default',
      emphasis: 'primary',
      icon: 'check',
      onClick: () => {
        failure.hidden = true;
        save.set({ loading: true });
        keep.set({ disabled: true });
        discard.set({ disabled: true });
        options.save().then(
          () => {
            settle(true);
            sheet.close();
          },
          (error: unknown) => {
            failure.textContent = typeof error === 'object' && error !== null && 'code' in error && 'message' in error ? saveFailedText({ code: String(error.code), message: String(error.message) }) : errorText(error);
            failure.hidden = false;
            save.set({ loading: false });
            keep.set({ disabled: false });
            discard.set({ disabled: false });
          },
        );
      },
    });
    sheet.foot.append(keep.el, discard.el, save.el);
  });
