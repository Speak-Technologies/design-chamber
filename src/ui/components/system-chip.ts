// The design system chip (Phase 2.5 U4): one pill in the viewer's header that names the system a design
// uses and opens what you can do about it (open it, switch it, review an update, reset an override). On
// the full-screen page the panel hangs under the chip in a popover; in the rail it takes the panel as a
// sheet, like Checks. The quiet "was updated" banner and the notices after a change live in the notices
// region. Names and token values came from files or from the person: text only, never parsed.

import type { DesignSystemView, SystemPreviewResponse } from '../../shared/api.ts';
import { askAgent, client, feed, host, isServiceError, store } from '../guest.ts';
import { askRequestToast } from '../model/ask-bar-model.ts';
import {
  NO_OTHER_SYSTEMS,
  NO_SYSTEM,
  POPOVER_OVERRIDES_MAX,
  STALE_HINT,
  agentSwitchOf,
  appliedNotice,
  bannerOf,
  changeOptions,
  chipOf,
  dismissKey,
  overridesHeading,
  parseDismissed,
  popoverOf,
  previewLine,
  resetBase,
  shouldRefetchSystem,
  updateHeading,
  updateSections,
  type AppliedNotice,
} from '../model/design-system-model.ts';
import { RESTORE_NOTICE_MS, SHORT_NOTICE_MS } from '../model/findability-model.ts';
import { toast } from './actions.ts';
import { createScope, debounce, errorText, h } from './dom.ts';
import { icon } from './icons.ts';
import { banner, bannerWithActions, btn, openPopover, openSheet, type BtnHandle } from './kit.ts';
import type { NoticesHandle } from './notices.ts';
import { systems as systemsStore } from './systems-store.ts';

export type SystemChipOptions = {
  slug: string;
  surface: 'panel' | 'page';
  /** Where the popover or sheet mounts: the app root. */
  host: HTMLElement;
  notices: NoticesHandle;
  /** Opens the system's own page (the viewer closes first). Absent where there is no systems view. */
  onOpenSystem?: (id: string) => void;
};

export type SystemChipHandle = {
  el: HTMLElement;
  /** Hidden while an old version is on show: the system describes the files as they are now. */
  setHidden: (hidden: boolean) => void;
  dispose: () => void;
};

/** Changes come in bursts while the agent writes; ask the service once they settle. */
const REFETCH_MS = 600;

type Mode = 'main' | 'change';

const STALE_TEXT = 'This design changed since you opened this.';

export const mountSystemChip = (options: SystemChipOptions): SystemChipHandle => {
  const { slug, notices } = options;
  const compact = options.surface === 'panel';
  const scope = createScope();

  let view: DesignSystemView | null = null;
  let dismissed: number | null = null;
  let hidden = false;
  let disposed = false;
  let token = 0;

  // ---- the chip
  const glyph = h('span', { class: 'dc-system-glyph', 'aria-hidden': 'true' }, icon('system', 14));
  const label = h('span', { class: 'dc-system-label' });
  const button = h('button', { type: 'button', class: 'oc-sdk oc-sdk-badge dc-system-btn', 'data-compact': compact ? 'true' : 'false', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, glyph, label);
  const el = h('div', { class: 'dc-system', 'data-surface': options.surface, hidden: true }, button);

  const paintChip = (): void => {
    const chip = chipOf(view);
    el.hidden = hidden || chip === null;
    if (chip === null) return;
    label.textContent = chip.label;
    label.hidden = compact;
    if (chip.tone === 'neutral') button.removeAttribute('data-tone');
    else button.dataset.tone = chip.tone;
    const name = `Design system: ${chip.title}`;
    button.setAttribute('aria-label', name);
    button.title = name;
  };

  // ---- the panel: popover (page) or sheet (rail)
  let mode: Mode = 'main';
  let showAllOverrides = false;
  let busyReset: string | null = null;
  let changeTo: string | null = null;
  let preview: SystemPreviewResponse | null = null;
  let previewState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let previewError: string | null = null;
  let applying = false;
  let applyError: string | null = null;
  let panelBody: HTMLElement | null = null;
  let panelFoot: HTMLElement | null = null;
  let closePanel: ((restoreFocus?: boolean) => void) | null = null;
  let panelPopover: HTMLElement | null = null;
  let lastSignature = '';

  const failureLine = (text: string | null, retry?: () => void): HTMLElement | null =>
    text === null ? null : h('p', { class: 'dc-form-error', role: 'alert' }, text, retry ? ' ' : null, retry ? h('button', { type: 'button', class: 'dc-link', onclick: retry }, 'Reload and try again.') : null);

  const resetOverride = async (name: string): Promise<void> => {
    if (view === null || busyReset !== null) return;
    const base = resetBase(view);
    if (base === null) return;
    busyReset = name;
    paintPanel(true);
    try {
      await store.applyEdit(slug, { op: 'token-reset', base, names: [name] });
      toast('success', 'Back to the system’s value.');
    } catch (failure) {
      toast('error', isServiceError(failure, 'stale') ? STALE_TEXT : `Couldn’t reset that. ${errorText(failure)}`);
    } finally {
      busyReset = null;
      await load();
    }
  };

  const overrideRow = (override: { name: string; value: string; systemValue: string }): HTMLElement => {
    const reset = btn({ label: 'Reset to system', variant: 'ghost', size: 'xs', loading: busyReset === override.name, disabled: busyReset !== null, onClick: () => void resetOverride(override.name) });
    reset.el.setAttribute('aria-label', `Reset ${override.name} to the system’s value`);
    return h(
      'li',
      { class: 'dc-sys-override' },
      h('div', { class: 'dc-sys-override-text' }, h('code', { class: 'dc-path', title: override.name }, override.name), h('span', { class: 'dc-muted dc-sys-values' }, h('span', { title: 'This design' }, override.value), ' instead of ', h('span', { title: 'The system' }, override.systemValue))),
      reset.el,
    );
  };

  const overridesBlock = (current: DesignSystemView): HTMLElement | null => {
    if (current.overrides.length === 0) return null;
    const shown = showAllOverrides ? current.overrides : current.overrides.slice(0, POPOVER_OVERRIDES_MAX);
    const hiddenCount = current.overrides.length - shown.length;
    const more =
      hiddenCount > 0
        ? h('button', { type: 'button', class: 'dc-link', onclick: () => {
            showAllOverrides = true;
            paintPanel(true);
          } }, `Show ${hiddenCount} more`)
        : null;
    return h('section', { class: 'dc-sys-block' }, h('h3', { class: 'dc-sys-h' }, overridesHeading(current.overrides.length)), h('ul', { class: 'dc-sys-list' }, ...shown.map(overrideRow)), more);
  };

  const mainPanel = (current: DesignSystemView): { body: Node[]; foot: Node[] } => {
    const pop = popoverOf(current);
    const body: Node[] = pop.lines.map((line) => h('p', { class: 'dc-sys-line' }, line));
    for (const problem of pop.problems) body.push(h('p', { class: 'dc-sys-problem' }, icon('alert', 14), h('span', {}, problem)));
    const overrides = overridesBlock(current);
    if (overrides) body.push(overrides);
    const foot: Node[] = [];
    if (pop.update) foot.push(btn({ label: 'Review update', variant: 'default', emphasis: 'primary', size: 'sm', onClick: () => openUpdate() }).el);
    foot.push(btn({ label: 'Change…', variant: 'outline', size: 'sm', onClick: () => startChange() }).el);
    const openId = pop.openId;
    if (openId !== null && options.onOpenSystem) {
      const open = options.onOpenSystem;
      foot.push(btn({ label: 'Open system', variant: 'outline', size: 'sm', icon: 'external', onClick: () => {
        closePanel?.(false);
        open(openId);
      } }).el);
    }
    return { body, foot };
  };

  const loadPreview = async (to: string): Promise<void> => {
    changeTo = to;
    preview = null;
    previewState = 'loading';
    previewError = null;
    applyError = null;
    paintPanel(true);
    try {
      const answer = await client.call('GET /designs/:slug/system/preview', { params: { slug }, query: { to } });
      if (changeTo !== to) return;
      preview = answer;
      previewState = 'ready';
    } catch (failure) {
      if (changeTo !== to) return;
      previewState = 'error';
      previewError = `Couldn’t work out what would change. ${errorText(failure)}`;
    }
    paintPanel(true);
  };

  const startChange = (): void => {
    mode = 'change';
    changeTo = null;
    preview = null;
    previewState = 'idle';
    previewError = null;
    applyError = null;
    void systemsStore().load();
    paintPanel(true);
  };

  const backToMain = (): void => {
    mode = 'main';
    changeTo = null;
    paintPanel(true);
  };

  const applyChange = async (name: string): Promise<void> => {
    if (applying || changeTo === null || preview === null) return;
    const to = changeTo;
    applying = true;
    applyError = null;
    paintPanel(true);
    try {
      const answer = await client.call('POST /designs/:slug/system', { params: { slug }, body: { action: 'set', to, stamp: preview.stamp } });
      const said = appliedNotice(answer.notice, name, preview.toRevision);
      applying = false;
      mode = 'main';
      closePanel?.(false);
      showApplied(said, answer.before?.id ?? null);
      await store.refreshOpenDesign();
      await load();
    } catch (failure) {
      applying = false;
      applyError = isServiceError(failure, 'stale') ? STALE_TEXT : errorText(failure);
      paintPanel(true);
    }
  };

  const changePanel = (current: DesignSystemView): { body: Node[]; foot: Node[] } => {
    const list = systemsStore().get().systems ?? [];
    const choices = changeOptions(current, list);
    const body: Node[] = [h('p', { class: 'dc-sys-line' }, 'Pick the design system this design should use.')];
    if (choices.length === 0) body.push(h('p', { class: 'dc-muted' }, NO_OTHER_SYSTEMS));
    else {
      const group = h('div', { class: 'dc-sys-options', role: 'radiogroup', 'aria-label': 'Design system' });
      for (const choice of choices) {
        const on = changeTo === choice.id;
        const option = h(
          'button',
          { type: 'button', class: 'dc-sys-option', role: 'radio', 'aria-checked': on ? 'true' : 'false', disabled: applying, onclick: () => void loadPreview(choice.id) },
          h('span', { class: 'dc-sys-option-name' }, choice.label),
          choice.hint ? h('span', { class: 'dc-muted' }, choice.hint) : null,
        );
        group.append(option);
      }
      body.push(group);
    }
    if (previewState === 'loading') body.push(h('p', { class: 'dc-muted dc-sys-preview', role: 'status' }, 'Checking what would change…'));
    if (previewState === 'error') body.push(h('p', { class: 'dc-form-error', role: 'alert' }, previewError ?? ''));
    let applyLabel = 'Use this system';
    if (preview !== null && previewState === 'ready') {
      const toNone = changeTo === NO_SYSTEM;
      const named = choices.find((choice) => choice.id === changeTo)?.label ?? 'this system';
      applyLabel = toNone ? 'Remove the system' : `Use ${named}`;
      body.push(h('p', { class: 'dc-sys-preview', role: 'status' }, previewLine(preview, { none: toNone, fromName: current.status.state === 'linked' ? current.status.name : null })));
    }
    const failed = failureLine(applyError, applyError === STALE_TEXT ? () => void refreshChange() : undefined);
    if (failed) body.push(failed);
    const target = choices.find((choice) => choice.id === changeTo)?.label ?? '';
    const apply = btn({ label: applyLabel, variant: 'default', emphasis: 'primary', size: 'sm', loading: applying, disabled: previewState !== 'ready' || applying, onClick: () => void applyChange(changeTo === NO_SYSTEM ? 'No design system' : target) });
    const back = btn({ label: 'Back', variant: 'outline', size: 'sm', icon: 'back', disabled: applying, onClick: backToMain });
    return { body, foot: [apply.el, back.el] };
  };

  const refreshChange = async (): Promise<void> => {
    await load();
    if (changeTo !== null) await loadPreview(changeTo);
  };

  const paintPanel = (force = false): void => {
    if (panelBody === null || panelFoot === null) return;
    if (view === null) return;
    const signature = JSON.stringify([view, mode, showAllOverrides, busyReset, changeTo, previewState, preview?.stamp ?? null, previewError, applying, applyError, systemsStore().get().systems?.map((system) => [system.id, system.status, system.revision])]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    const active = document.activeElement;
    const keepFocusIn = active !== null && panelBody.contains(active);
    const parts = mode === 'change' ? changePanel(view) : mainPanel(view);
    panelBody.replaceChildren(...parts.body);
    panelFoot.replaceChildren(...parts.foot);
    panelFoot.hidden = parts.foot.length === 0;
    if (keepFocusIn || (active !== null && panelFoot.contains(active))) focusFirst();
  };

  const focusFirst = (): void => {
    const target = panelFoot?.querySelector<HTMLElement>('button:not(:disabled)') ?? panelBody?.querySelector<HTMLElement>('button:not(:disabled)');
    if (target) target.focus({ preventScroll: true });
    else panelPopover?.focus({ preventScroll: true });
  };

  const openMain = (): void => {
    if (closePanel || view === null) return;
    mode = 'main';
    showAllOverrides = false;
    lastSignature = '';
    const release = (): void => {
      closePanel = null;
      panelBody = null;
      panelFoot = null;
      panelPopover = null;
      button.setAttribute('aria-expanded', 'false');
    };
    if (compact) {
      const sheet = openSheet(options.host, { title: 'Design system', variant: 'full', onClose: release });
      panelBody = h('div', { class: 'dc-sys-panel' });
      sheet.body.append(panelBody);
      panelFoot = h('div', { class: 'dc-sys-actions' });
      sheet.foot.append(panelFoot);
      closePanel = () => sheet.close();
    } else {
      const popover = openPopover(options.host, button, { title: 'Design system', onClose: release });
      panelBody = h('div', { class: 'dc-sys-panel' });
      popover.body.append(panelBody);
      panelFoot = h('div', { class: 'dc-sys-actions' });
      popover.foot.append(panelFoot);
      closePanel = (restoreFocus) => popover.close(restoreFocus);
      panelPopover = popover.el;
    }
    button.setAttribute('aria-expanded', 'true');
    paintPanel(true);
    // openSheet focuses on a microtask of its own; this one runs after it.
    queueMicrotask(focusFirst);
    void load();
  };

  button.addEventListener('click', () => {
    if (closePanel) closePanel();
    else openMain();
  });

  // ---- the update sheet
  let closeUpdate: (() => void) | null = null;

  const openUpdate = (): void => {
    const current = view;
    if (current === null || current.status.state !== 'linked' || closeUpdate) return;
    const systemName = current.status.name;
    const systemId = current.status.id;
    closePanel?.(false);
    const sheet = openSheet(options.host, { title: 'Review update', variant: compact ? 'full' : 'side', onClose: () => {
      closeUpdate = null;
    } });
    closeUpdate = () => sheet.close();
    const content = h('div', { class: 'dc-sys-panel', 'aria-busy': 'true' }, h('p', { class: 'dc-muted', role: 'status' }, 'Checking what changed…'));
    sheet.body.append(content);
    let loaded: SystemPreviewResponse | null = null;
    let busy = false;
    let failure: string | null = null;
    let busyName: string | null = null;
    let primary: BtnHandle | null = null;

    const paint = (): void => {
      const live = view;
      content.setAttribute('aria-busy', loaded === null && failure === null ? 'true' : 'false');
      sheet.foot.replaceChildren();
      if (loaded === null) {
        if (failure !== null) {
          content.replaceChildren(h('p', { class: 'dc-form-error', role: 'alert' }, failure));
          sheet.foot.append(btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => void fetchPreview() }).el);
        }
        return;
      }
      const nodes: Node[] = [h('p', { class: 'dc-sys-line' }, updateHeading(systemName, loaded))];
      const sections = updateSections(loaded);
      if (sections.length === 0) nodes.push(h('p', { class: 'dc-muted' }, 'No tokens or components change. The update only brings this design’s copy to the new revision.'));
      for (const section of sections) {
        nodes.push(
          h(
            'section',
            { class: 'dc-sys-block' },
            h('h3', { class: 'dc-sys-h' }, section.title),
            h('ul', { class: 'dc-sys-names' }, ...section.names.map((name) => h('li', {}, h('code', { class: 'dc-path', title: name }, name)))),
            section.more > 0 ? h('p', { class: 'dc-muted dc-sys-more' }, `and ${section.more} more`) : null,
          ),
        );
      }
      const overrides = live?.overrides ?? [];
      if (overrides.length > 0) {
        nodes.push(
          h(
            'section',
            { class: 'dc-sys-block' },
            h('h3', { class: 'dc-sys-h' }, overridesHeading(overrides.length)),
            h('p', { class: 'dc-muted dc-sys-more' }, 'These stay as they are unless you reset them.'),
            h('ul', { class: 'dc-sys-list' }, ...overrides.map((override) => {
              const reset = btn({ label: 'Reset to system', variant: 'ghost', size: 'xs', loading: busyName === override.name, disabled: busyName !== null || busy, onClick: () => void resetInSheet(override.name) });
              reset.el.setAttribute('aria-label', `Reset ${override.name} to the system’s value`);
              return h('li', { class: 'dc-sys-override' }, h('div', { class: 'dc-sys-override-text' }, h('code', { class: 'dc-path', title: override.name }, override.name), h('span', { class: 'dc-muted dc-sys-values' }, override.value, ' instead of ', override.systemValue)), reset.el);
            })),
          ),
        );
      }
      const failed = failureLine(failure, failure === STALE_TEXT ? () => void fetchPreview() : undefined);
      if (failed) nodes.push(failed);
      content.replaceChildren(...nodes);
      primary = btn({ label: 'Update this design', variant: 'default', emphasis: 'primary', size: 'sm', loading: busy, disabled: busy || busyName !== null, onClick: () => void apply() });
      sheet.foot.append(primary.el);
    };

    const fetchPreview = async (): Promise<void> => {
      failure = null;
      loaded = null;
      paint();
      try {
        await load();
        loaded = await client.call('GET /designs/:slug/system/preview', { params: { slug }, query: { to: systemId } });
      } catch (error) {
        failure = `Couldn’t work out what changed. ${errorText(error)}`;
      }
      if (closeUpdate === null) return;
      paint();
    };

    const resetInSheet = async (name: string): Promise<void> => {
      const live = view;
      const base = live ? resetBase(live) : null;
      if (base === null || busyName !== null) return;
      busyName = name;
      paint();
      try {
        await store.applyEdit(slug, { op: 'token-reset', base, names: [name] });
        failure = null;
      } catch (error) {
        failure = isServiceError(error, 'stale') ? STALE_TEXT : `Couldn’t reset that. ${errorText(error)}`;
      }
      busyName = null;
      await load();
      if (closeUpdate !== null) paint();
    };

    const apply = async (): Promise<void> => {
      if (loaded === null || busy || loaded.toRevision === null) return;
      busy = true;
      failure = null;
      paint();
      try {
        const answer = await client.call('POST /designs/:slug/system', { params: { slug }, body: { action: 'update', toRevision: loaded.toRevision, stamp: loaded.stamp } });
        const said = appliedNotice(answer.notice, systemName, loaded.toRevision);
        busy = false;
        sheet.close();
        showApplied(said, answer.before?.id ?? null);
        await store.refreshOpenDesign();
        await load();
      } catch (error) {
        busy = false;
        failure = isServiceError(error, 'stale') ? STALE_TEXT : errorText(error);
        paint();
      }
    };

    void fetchPreview();
    queueMicrotask(() => primary?.el.focus({ preventScroll: true }));
  };

  // ---- notices
  /** The result of a change the person made: what happened, with Undo and "Ask the agent". */
  const showApplied = (said: AppliedNotice, before: string | null): void => {
    const buttons: BtnHandle[] = [];
    let undoButton: BtnHandle | null = null;
    if (before !== null) {
      undoButton = btn({ label: 'Undo', variant: 'outline', size: 'xs', onClick: () => void undo(before) });
      buttons.push(undoButton);
    }
    if (said.ask !== null) {
      const { purpose, label: askLabel } = said.ask;
      const ask = btn({ label: askLabel, variant: 'outline', size: 'xs', icon: 'send', onClick: () => {
        ask.set({ loading: true });
        void askAgent(slug, purpose, before ?? undefined).then(
          (outcome) => {
            const text = askRequestToast(outcome);
            if (text !== null) toast('success', text);
            ask.set({ loading: false });
          },
          (failure: unknown) => {
            toast('error', `Couldn’t ask the agent. ${errorText(failure)}`);
            ask.set({ loading: false });
          },
        );
      } });
      buttons.push(ask);
    }
    if (buttons.length === 0) {
      notices.setTransient('system', banner({ tone: 'success', title: said.title }), SHORT_NOTICE_MS);
      return;
    }
    const wrap = h('div', { class: 'dc-banner dc-system-notice', 'data-actions': 'stack' });
    wrap.append(...bannerWithActions('success', said.title, [], buttons.map((one) => one.el)));
    notices.setTransient('system', wrap, RESTORE_NOTICE_MS);
  };

  const undo = async (before: string): Promise<void> => {
    try {
      await store.restoreVersion(slug, before);
      await store.refreshOpenDesign();
      notices.setTransient('system', banner({ tone: 'success', title: 'Undone.' }), SHORT_NOTICE_MS);
      await load(true);
    } catch (failure) {
      notices.setTransient('system', banner({ tone: 'error', title: 'Couldn’t undo that.', body: errorText(failure) }));
    }
  };

  /** The agent recorded another system while the design was open: say so, once, with a way back. */
  const showAgentSwitch = (title: string, undoTo: string): void => {
    const undoButton = btn({ label: 'Undo', variant: 'outline', size: 'xs', onClick: () => void undo(undoTo) });
    const wrap = h('div', { class: 'dc-banner dc-system-notice', 'data-actions': 'stack' });
    wrap.append(...bannerWithActions('info', title, [], [undoButton.el]));
    notices.setTransient('system', wrap, RESTORE_NOTICE_MS);
  };

  let bannerKey = '';
  const paintBanner = (): void => {
    const shown = hidden ? null : bannerOf(view, dismissed);
    const key = shown === null ? '' : `${shown.revision}:${shown.text}`;
    if (key === bannerKey) return;
    bannerKey = key;
    if (shown === null) {
      notices.setTransient('system-update', null);
      return;
    }
    const review = btn({ label: 'Review update', variant: 'outline', size: 'xs', onClick: () => openUpdate() });
    const later = btn({ label: 'Not now', variant: 'ghost', size: 'xs', onClick: () => {
      dismissed = shown.revision;
      void host.storage.set(dismissKey(slug), shown.revision);
      paintBanner();
    } });
    const wrap = h('div', { class: 'dc-banner dc-system-banner', 'data-actions': 'stack' });
    wrap.append(...bannerWithActions('info', shown.text, [], [review.el, later.el]));
    notices.setTransient('system-update', wrap);
  };

  // ---- loading
  const load = async (own = false): Promise<void> => {
    token += 1;
    const mine = token;
    try {
      const answer = await client.call('GET /designs/:slug/system', { params: { slug } });
      if (disposed || mine !== token) return;
      const before = view;
      view = answer;
      // The person's own undo and changes say their own notice; only the agent's switch is announced here.
      const switched = own ? null : agentSwitchOf(before, answer);
      if (switched !== null && !hidden) showAgentSwitch(switched.title, switched.undoTo);
    } catch (failure) {
      if (disposed || mine !== token) return;
      // The last good answer stays; a design that has no readable record just shows no chip.
      console.warn('Design Chamber: the design system could not be read', failure);
    }
    paintChip();
    paintBanner();
    paintPanel();
  };

  const refetchSoon = debounce(() => {
    if (!disposed) void load();
  }, REFETCH_MS);

  scope.add(
    feed.subscribe((batch) => {
      if (shouldRefetchSystem(batch, slug)) refetchSoon();
    }),
  );
  scope.add(systemsStore().subscribe(() => paintPanel()));

  void host.storage.get(dismissKey(slug)).then((stored) => {
    dismissed = parseDismissed(stored);
    paintBanner();
  });
  paintChip();
  void load();

  return {
    el,
    setHidden: (next) => {
      hidden = next;
      if (next) {
        closePanel?.(false);
        closeUpdate?.();
        notices.setTransient('system-update', null);
        bannerKey = '';
      }
      paintChip();
      paintBanner();
    },
    dispose: () => {
      disposed = true;
      closePanel?.(false);
      closeUpdate?.();
      notices.setTransient('system-update', null);
      notices.setTransient('system', null);
      scope.dispose();
      el.remove();
    },
  };
};
