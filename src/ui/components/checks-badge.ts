// The Checks badge (documentation/specs/agent-render-and-check.md §9): one pill in the viewer's
// header that says how the design stands (`No issues`, `3 issues`, `Checking`) and opens the
// findings. On the full-screen page the findings hang under the badge in a popover; in the rail
// they take the whole panel as a sheet, like Comments. The findings' sentences come from the
// service; text that came from the design (selectors, snippets) goes in through `textContent`.

import type { ChecksResponse } from '../../shared/api.ts';
import type { CheckFinding } from '../../shared/types.ts';
import { askAgent, client, feed, host, isServiceError } from '../guest.ts';
import { askRequestToast } from '../model/ask-bar-model.ts';
import { badgeOf, panelOf, runResultOf, shouldRefetch, type CheckGroup, type PanelView } from '../model/checks-model.ts';
import { toast } from './actions.ts';
import { createScope, debounce, errorText, h, nextId } from './dom.ts';
import { banner, btn, openPopover, openSheet } from './kit.ts';
import { icon } from './icons.ts';

export type ChecksBadgeOptions = {
  slug: string;
  surface: 'panel' | 'page';
  /** Where the popover or sheet mounts: the app root. */
  host: HTMLElement;
};

export type ChecksBadgeHandle = {
  el: HTMLElement;
  /** Hidden while an old version is on show: the checks describe the current files only. */
  setHidden: (hidden: boolean) => void;
  dispose: () => void;
};

/** Changes come in bursts while the agent writes; ask the service once they settle. */
const REFETCH_MS = 600;
/** A running check ends with a `checks` event; this is the safety net if the feed is down. */
const RUNNING_POLL_MS = 4000;

type PanelHandle = { body: HTMLElement; foot: HTMLElement; update: (view: PanelView) => void; /** True when a button took focus. */ focusFirst: () => boolean };

type GroupNode = { el: HTMLElement; title: HTMLElement; list: HTMLElement; collapsed: boolean; signature: string };

/** Make `parent`'s children exactly `wanted`, in order, moving a node only when it is out of place (a moved node loses focus). */
const syncChildren = (parent: HTMLElement, wanted: readonly Node[]): void => {
  wanted.forEach((node, index) => {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
  });
  while (parent.children.length > wanted.length) parent.lastElementChild?.remove();
};

/** Filled when it is the next step, outline otherwise. The kit's own "default" is a faint tint, so the filled look is ours. */
const setPrimary = (button: HTMLElement, primary: boolean): void => {
  if (primary) {
    button.dataset.emphasis = 'primary';
    button.dataset.variant = 'default';
  } else {
    delete button.dataset.emphasis;
    button.dataset.variant = 'outline';
  }
};

/**
 * The findings, laid out once and repainted in place: every node a person can focus (the group
 * disclosures, the buttons, the retry button) survives a refresh, so a refetch never drops focus
 * out of the dialog, and a group they opened stays open.
 */
const buildPanel = (actions: { ask: () => void; run: () => void; retry: () => void }): PanelHandle => {
  // Groups the person opened stay open, also when a group goes away and comes back.
  const opened = new Set<string>();
  const nodes = new Map<CheckGroup['id'], GroupNode>();

  const summary = h('p', { class: 'dc-checks-summary', id: nextId('dc-checks-summary') });
  // Not a live region: the badge's own region announces when a check starts and ends, once.
  const renderLine = h('p', { class: 'dc-checks-render' });
  const notice = h('div', { class: 'dc-checks-notice' });
  const groups = h('div', { class: 'dc-checks-groups' });
  // Focus lands here when the button a person pressed turns off while it works.
  const body = h('div', { class: 'dc-checks-panel', tabindex: '-1' }, summary, renderLine, notice, groups);

  const ask = btn({ label: 'Ask the agent to fix', variant: 'default', size: 'sm', icon: 'send', emphasis: 'primary', onClick: actions.ask });
  const run = btn({ label: 'Check rendering', variant: 'outline', size: 'sm', onClick: actions.run });
  // A disabled button gives its reason to a screen reader through the summary beside it, not only a tooltip.
  ask.el.setAttribute('aria-describedby', summary.id);
  const foot = h('div', { class: 'dc-checks-actions' }, ask.el, run.el);
  const next = h('p', { class: 'dc-checks-next' });
  const skeleton = h('div', { class: 'dc-checks-skeleton', 'aria-hidden': 'true' }, h('span', { class: 'dc-checks-skel', 'data-w': 'short' }), h('span', { class: 'dc-checks-skel' }), h('span', { class: 'dc-checks-skel' }), h('span', { class: 'dc-checks-skel', 'data-w': 'mid' }));
  let noticeKey = '';

  const row = (finding: CheckFinding): HTMLElement =>
    h(
      'li',
      { class: 'dc-checks-item', 'data-severity': finding.severity },
      h('p', { class: 'dc-checks-msg' }, finding.message),
      // Design text: shown as text in a code element, whole value on hover, never parsed.
      finding.detail ? h('code', { class: 'dc-path dc-checks-code', title: finding.detail }, finding.detail) : null,
      finding.selector ? h('code', { class: 'dc-path dc-checks-code', 'data-kind': 'selector', title: finding.selector }, finding.selector) : null,
    );

  const createGroup = (entry: CheckGroup): GroupNode => {
    const list = h('ul', { class: 'dc-checks-list' });
    if (!entry.collapsed) {
      const title = h('h3', { class: 'dc-checks-group-title' });
      return { el: h('section', { class: 'dc-checks-group' }, title, list), title, list, collapsed: false, signature: '' };
    }
    const title = h('summary', { class: 'dc-checks-group-title' });
    const details = h('details', { class: 'dc-checks-group' }, title, list);
    details.open = opened.has(entry.id);
    details.addEventListener('toggle', () => void (details.open ? opened.add(entry.id) : opened.delete(entry.id)));
    return { el: details, title, list, collapsed: true, signature: '' };
  };

  const groupNode = (entry: CheckGroup): HTMLElement => {
    let node = nodes.get(entry.id);
    if (!node || node.collapsed !== entry.collapsed) {
      node = createGroup(entry);
      nodes.set(entry.id, node);
    }
    node.el.dataset.tone = entry.tone;
    node.title.textContent = `${entry.title} · ${entry.items.length}`;
    const signature = JSON.stringify(entry.items.map((item) => [item.message, item.detail, item.selector]));
    if (signature !== node.signature) {
      node.list.replaceChildren(...entry.items.map(row));
      node.signature = signature;
    }
    return node.el;
  };

  return {
    body,
    foot,
    update: (view) => {
      const hadFocus = document.activeElement;
      body.setAttribute('aria-busy', view.phase === 'loading' ? 'true' : 'false');
      summary.textContent = view.summary;
      summary.hidden = view.summary === '';
      renderLine.hidden = view.renderLine === null;
      renderLine.textContent = view.renderLine?.text ?? '';
      renderLine.dataset.tone = view.renderLine?.tone ?? 'muted';

      // The error banner is rebuilt only when what it says changes, so its Try again button keeps focus.
      const wantedKey = view.error ? `${view.error.title}\n${view.error.message}` : '';
      if (wantedKey !== noticeKey) {
        noticeKey = wantedKey;
        notice.replaceChildren();
        if (view.error) notice.append(banner({ tone: 'error', title: view.error.title, body: view.error.message, action: { label: 'Try again', onClick: actions.retry } }));
      }

      const wanted: Node[] = [];
      if (view.phase === 'loading') wanted.push(skeleton);
      else if (view.phase === 'ready') {
        if (view.nextStep) {
          next.textContent = view.nextStep;
          wanted.push(next);
        }
        const shown = view.groups.map(groupNode);
        wanted.push(...shown);
        for (const id of [...nodes.keys()]) if (!view.groups.some((entry) => entry.id === id)) nodes.delete(id);
      } else nodes.clear();
      syncChildren(groups, wanted);

      foot.hidden = view.phase !== 'ready';
      ask.set({ disabled: view.ask.disabled, title: view.ask.disabled ? 'Nothing to fix' : undefined });
      run.el.hidden = !view.run.visible;
      run.set({ label: view.run.label, loading: view.run.busy });
      setPrimary(ask.el, view.primary === 'ask');
      setPrimary(run.el, view.primary === 'run');
      // A button that switched itself off (the check is running) must not take the person's place with it.
      if ((hadFocus === ask.el && ask.el.disabled) || (hadFocus === run.el && (run.el.disabled || run.el.hidden))) body.focus({ preventScroll: true });
    },
    focusFirst: () => {
      const target = !ask.el.disabled ? ask.el : !run.el.hidden && !run.el.disabled ? run.el : null;
      target?.focus({ preventScroll: true });
      return target !== null;
    },
  };
};

export const mountChecksBadge = (options: ChecksBadgeOptions): ChecksBadgeHandle => {
  const { slug } = options;
  const compact = options.surface === 'panel';
  const scope = createScope();

  let response: ChecksResponse | null = null;
  let error: string | null = null;
  /** The person asked for a rendering check; true until the service has answered after it started the job. */
  let requested = false;
  let jobStarted = false;
  let wasBusy = false;
  let disposed = false;
  let token = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  // ---- the badge
  // The kit's badge look (tone colours from `data-tone`) on a real button, with a shape beside the words.
  const glyph = h('span', { class: 'dc-checks-glyph', 'aria-hidden': 'true' });
  const ring = h('span', { class: 'oc-sdk-spinner-ring dc-checks-ring', 'aria-hidden': 'true' });
  const label = h('span', { class: 'dc-checks-label' }, 'Checking');
  const button = h('button', { type: 'button', class: 'oc-sdk oc-sdk-badge dc-checks-badge', 'data-compact': compact ? 'true' : 'false', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, glyph, ring, label);
  // The one live region: written only when its sentence changes, so a repaint or a refetch says nothing.
  const live = h('span', { class: 'dc-sr-only', role: 'status', 'aria-live': 'polite' });
  let lastAnnounced = '';
  const el = h('div', { class: 'dc-checks', 'data-surface': options.surface }, button, live);

  const busy = (): boolean => requested || response?.render.state === 'running';

  // ---- the findings, in a popover (page) or a sheet (rail)
  let panel: PanelHandle | null = null;
  let closeSurface: ((restoreFocus?: boolean) => void) | null = null;

  const view = (): PanelView => panelOf(response, error, busy(), Date.now(), host.snapshot()?.locale ?? 'en');

  const paint = (): void => {
    const next = badgeOf(response, error, busy());
    // The rail has no room for words: the number alone, the sentence in the accessible name and the tooltip.
    label.textContent = compact ? (next.count > 0 ? String(next.count) : '') : next.label;
    label.hidden = compact && next.count === 0;
    if (next.tone === 'neutral') button.removeAttribute('data-tone');
    else button.dataset.tone = next.tone;
    button.setAttribute('aria-label', next.ariaLabel);
    button.title = next.ariaLabel;
    const checking = next.label === 'Checking';
    button.setAttribute('aria-busy', checking ? 'true' : 'false');
    ring.hidden = !checking;
    glyph.replaceChildren();
    if (!checking) {
      // Beside the words a shape only backs up colour; alone in the rail it is the whole message.
      const clean = next.label === 'No issues';
      const mark = next.tone === 'success' || (compact && clean) ? icon('check', 12) : next.tone === 'error' || next.tone === 'warning' || (compact && next.label === 'Checks') ? icon('alert', 12) : null;
      if (mark) glyph.append(mark);
    }
    glyph.hidden = glyph.childElementCount === 0;
    panel?.update(view());
  };

  const announce = (text: string): void => {
    if (text === lastAnnounced) return;
    lastAnnounced = text;
    live.textContent = text;
  };

  const poll = (): void => {
    clearTimeout(pollTimer);
    if (disposed || !busy()) return;
    pollTimer = setTimeout(() => void load(), RUNNING_POLL_MS);
  };

  const load = async (): Promise<void> => {
    token += 1;
    const mine = token;
    try {
      const answer = await client.call('GET /designs/:slug/checks', { params: { slug } });
      if (disposed || mine !== token) return;
      response = answer;
      error = null;
      // The service has started our job once it answers "running" or has finished it: either way its word is the truth now.
      if (requested && jobStarted && answer.render.state !== 'running') {
        requested = false;
        jobStarted = false;
      }
    } catch (failure) {
      if (disposed || mine !== token) return;
      // The last good answer stays on screen; the panel says the refresh failed.
      error = errorText(failure);
      if (requested && jobStarted) {
        requested = false;
        jobStarted = false;
      }
    }
    const nowBusy = busy();
    if (wasBusy && !nowBusy && response && error === null) announce(runResultOf(response));
    wasBusy = nowBusy;
    paint();
    poll();
  };

  const refetchSoon = debounce(() => {
    if (!disposed) void load();
  }, REFETCH_MS);

  scope.add(
    feed.subscribe((batch) => {
      if (shouldRefetch(batch, slug)) refetchSoon();
    }),
  );
  scope.add(() => clearTimeout(pollTimer));

  // ---- actions
  let asking = false;
  const askToFix = async (): Promise<void> => {
    if (asking) return;
    asking = true;
    try {
      const said = askRequestToast(await askAgent(slug, 'checks'));
      if (said !== null) toast('success', said);
      closeSurface?.(false);
    } catch (failure) {
      // The panel stays open so nothing is lost; a 422 means the issues went away in the meantime.
      toast('error', `Couldn’t ask the agent. ${errorText(failure)}`);
      if (isServiceError(failure, 'invalid')) void load();
    } finally {
      asking = false;
    }
  };

  const checkRendering = async (): Promise<void> => {
    if (busy()) return;
    requested = true;
    jobStarted = false;
    wasBusy = true;
    paint();
    announce('Checking the rendering…');
    try {
      await client.call('POST /designs/:slug/checks/run', { params: { slug }, body: {} });
      jobStarted = true;
    } catch (failure) {
      requested = false;
      wasBusy = false;
      lastAnnounced = '';
      live.textContent = '';
      toast('error', `Couldn’t check the rendering. ${errorText(failure)}`);
      paint();
      void load();
      return;
    }
    await load();
  };

  // ---- open and close
  const open = (): void => {
    if (closeSurface) return;
    const handle = buildPanel({ ask: () => void askToFix(), run: () => void checkRendering(), retry: () => void load() });
    let popoverEl: HTMLElement | null = null;
    const release = (): void => {
      closeSurface = null;
      panel = null;
      button.setAttribute('aria-expanded', 'false');
    };
    if (compact) {
      const sheet = openSheet(options.host, { title: 'Checks', variant: 'full', onClose: release });
      sheet.body.append(handle.body);
      sheet.foot.append(handle.foot);
      closeSurface = () => sheet.close();
    } else {
      const popover = openPopover(options.host, button, { title: 'Checks', onClose: release });
      popover.body.append(handle.body);
      popover.foot.append(handle.foot);
      closeSurface = (restoreFocus) => popover.close(restoreFocus);
      popoverEl = popover.el;
    }
    panel = handle;
    button.setAttribute('aria-expanded', 'true');
    paint();
    // openSheet focuses on a microtask of its own; this one runs after it.
    // With nothing to press yet (still loading) focus goes to the dialog itself, so Escape and Tab behave.
    queueMicrotask(() => void (handle.focusFirst() || popoverEl?.focus({ preventScroll: true })));
    // Opening is the moment to be current, whatever the feed has or has not said.
    void load();
  };

  button.addEventListener('click', () => {
    if (closeSurface) closeSurface();
    else open();
  });

  paint();
  void load();

  return {
    el,
    setHidden: (next) => {
      el.hidden = next;
      if (next) closeSurface?.(false);
    },
    dispose: () => {
      disposed = true;
      closeSurface?.(false);
      scope.dispose();
      el.remove();
    },
  };
};
