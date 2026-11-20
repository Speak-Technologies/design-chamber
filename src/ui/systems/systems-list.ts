// The design systems list (Phase 2.5 U1, technical design §9.3), one view for the rail and the page: a header with the way
// back and **New design system**, then a row per system (name, Draft or Ready, where it lives, what needs a look, what
// it was made from, who uses it). Every state is drawn: a skeleton that matches the rows, the empty list with its three
// ways to start, a system whose files can't be read, and the service not answering. Rows open a system through
// `onOpen`; the system page itself is U2's.

import { mountBadge, mountBanner, mountEmpty, mountTextField } from '@openchamber/sdk/ui';

import type { SystemSummary } from '../../shared/types.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { createScope, errorText, h } from '../components/dom.ts';
import { attachMenu, btn, confirmDialog, iconBtn, openSheet } from '../components/kit.ts';
import { systems, type SystemsState } from '../components/systems-store.ts';
import { client, guestHost, host } from '../guest.ts';
import { folderName, plural } from '../model/format.ts';
import { systemNameProblem } from '../model/new-system-model.ts';
import { EMPTY_BODY, EMPTY_TITLE, atSystemsCap, deleteSentence, loadFailure, systemMenu, systemRow, systemsListState, type RowTone, type SystemMenuId } from '../model/systems-model.ts';
import { BUILD_BUTTON_LABEL, openBuildWithAgent } from './build-with-agent.ts';
import { openNewSystemSheet } from './new-system-sheet.ts';

export type SystemsListOptions = {
  surface: 'panel' | 'page';
  actions: ActionContext;
  onBack: () => void;
  /** A row was chosen, or a new system was made: the system page opens. */
  onOpen: (id: string) => void;
};

export type SystemsListHandle = { el: HTMLElement; focus: () => void; focusRow: (id: string) => void; dispose: () => void };

const SKELETON_ROWS = 4;

const tonedBadge = (label: string, tone: RowTone, title?: string): HTMLElement => {
  const holder = h('span', { class: 'dc-sys-badge', title: title ?? null });
  mountBadge(holder, { label, tone });
  return holder;
};

export const mountSystemsList = (options: SystemsListOptions): SystemsListHandle => {
  const scope = createScope();
  const store = systems();
  let projects: Array<{ directory: string; name: string }> = [];
  const label = (directory: string): string => projects.find((project) => sameDirectory(project.directory, directory))?.name ?? folderName(directory);

  const el = h('div', { class: 'dc-sys-view', 'data-surface': options.surface });

  // ------------------------------------------------------------ header
  const back = options.surface === 'panel' ? iconBtn({ icon: 'back', label: 'Back to designs', onClick: () => options.onBack() }) : btn({ label: 'Library', variant: 'ghost', size: 'default', icon: 'back', onClick: () => options.onBack() }).el;
  const newButton = btn({
    label: 'New design system',
    variant: 'default',
    size: options.surface === 'panel' ? 'sm' : 'default',
    icon: 'plus',
    onClick: () => openNewSystemSheet(options.actions.host, { onMade: (result) => options.onOpen(result.id) }),
  });
  const buildButton = btn({
    label: BUILD_BUTTON_LABEL,
    variant: 'outline',
    size: options.surface === 'panel' ? 'sm' : 'default',
    icon: 'chat',
    onClick: () => openBuildWithAgent(options.actions.host, buildButton.el),
  });
  const head =
    options.surface === 'panel'
      ? h('header', { class: 'dc-rail-head' }, back, h('h1', { class: 'dc-rail-title' }, 'Design systems'), h('span', { class: 'dc-spacer' }))
      : h('header', { class: 'dc-library-bar dc-sys-bar' }, back, h('h1', { class: 'dc-page-title' }, 'Design systems'), h('span', { class: 'dc-spacer' }), buildButton.el, newButton.el);
  const tools = options.surface === 'panel' ? h('div', { class: 'dc-sys-tools' }, newButton.el, buildButton.el) : null;
  const capNote = h('p', { class: 'dc-muted dc-sys-cap', hidden: true });

  const notices = h('div', { class: 'dc-sys-notices' });
  const list = h('ul', { class: 'dc-sys-list', 'aria-label': 'Design systems' });
  const scroller = h('div', { class: options.surface === 'panel' ? 'dc-rail-scroll dc-sys-scroll' : 'dc-library-scroll dc-sys-scroll' }, notices, capNote, list);
  el.append(head);
  if (tools) el.append(tools);
  el.append(scroller);

  // ------------------------------------------------------------ rows
  const rowFor = (summary: SystemSummary): HTMLElement => {
    const model = systemRow(summary, { nowMs: Date.now(), locale: host.snapshot()?.locale ?? 'en', label });
    const unreadable = model.unreadable !== null;

    const title = h('span', { class: 'dc-sys-title', title: model.name }, model.name);
    const nameLine = h('span', { class: 'dc-sys-name' }, title, unreadable ? tonedBadge('Can’t read', 'error') : tonedBadge(model.status.label, model.status.tone));
    const content: HTMLElement[] = [nameLine];
    if (unreadable) content.push(h('span', { class: 'dc-sys-reason' }, model.unreadable ?? ''));
    else {
      const badges = h('span', { class: 'dc-sys-line' }, tonedBadge(model.home.label, 'neutral', model.home.title), ...model.badges.map((badge) => tonedBadge(badge.label, badge.tone)));
      if (model.more) badges.append(h('span', { class: 'dc-sys-more', title: model.more.title }, model.more.text, h('span', { class: 'dc-sr-only' }, `: ${model.more.title}`)));
      content.push(badges);
      if (model.notice) content.push(h('span', { class: 'dc-sys-notice' }, model.notice));
      content.push(h('span', { class: 'dc-sys-meta' }, model.meta.join(' · ')));
    }

    const main = unreadable
      ? h('div', { class: 'dc-sys-main', 'data-static': 'true', role: 'group', 'aria-label': model.ariaLabel }, ...content)
      : h('button', { type: 'button', class: 'dc-sys-main', 'aria-label': model.ariaLabel }, ...content);
    if (!unreadable) main.addEventListener('click', () => options.onOpen(summary.id));

    const more = iconBtn({ icon: 'more', label: `Actions for ${summary.name}`, size: 'sm', onClick: () => undefined });
    attachMenu(
      more,
      () => systemMenu(summary),
      (id) => void runAction(id as SystemMenuId, summary),
    );
    return h('li', { class: 'dc-sys', 'data-id': summary.id, 'data-state': unreadable ? 'unreadable' : summary.status }, main, more);
  };

  const skeleton = (): HTMLElement[] =>
    Array.from({ length: SKELETON_ROWS }, () =>
      h(
        'li',
        { class: 'dc-sys dc-sys-skeleton', 'aria-hidden': 'true' },
        h('span', { class: 'dc-sys-main' }, h('span', { class: 'dc-skel dc-skel-line dc-sys-skel-name' }), h('span', { class: 'dc-skel dc-skel-line dc-sys-skel-badges' }), h('span', { class: 'dc-skel dc-skel-line dc-skel-short' })),
      ),
    );

  const emptyState = (): HTMLElement => {
    const holder = h('div');
    mountEmpty(holder, { title: EMPTY_TITLE, body: EMPTY_BODY });
    const actions = h(
      'div',
      { class: 'dc-sys-empty-actions' },
      btn({ label: 'From code…', variant: 'outline', size: 'sm', icon: 'page', onClick: () => openNewSystemSheet(options.actions.host, { source: 'code', onMade: (result) => options.onOpen(result.id) }) }).el,
      btn({ label: 'From brand files…', variant: 'outline', size: 'sm', icon: 'image', onClick: () => openNewSystemSheet(options.actions.host, { source: 'brand', onMade: (result) => options.onOpen(result.id) }) }).el,
      btn({ label: 'Describe…', variant: 'outline', size: 'sm', icon: 'pencil', onClick: () => openNewSystemSheet(options.actions.host, { source: 'description', onMade: (result) => options.onOpen(result.id) }) }).el,
    );
    return h('li', { class: 'dc-sys-message dc-sys-empty' }, holder, actions);
  };

  const failureState = (state: SystemsState): HTMLElement => {
    const failure = loadFailure(state.error);
    const holder = h('div', { class: 'dc-banner dc-banner-block' });
    mountBanner(holder, { tone: 'error', title: failure.title, body: failure.body, action: { label: 'Try again', onClick: () => void store.load() } });
    return h('li', { class: 'dc-sys-message' }, holder);
  };

  const paintNotices = (state: SystemsState): void => {
    notices.replaceChildren();
    if (state.status === 'error' && state.systems !== null) {
      const holder = h('div', { class: 'dc-banner' });
      mountBanner(holder, { tone: 'warning', title: 'Couldn’t refresh the list', body: state.error?.message ?? '', action: { label: 'Try again', onClick: () => void store.load() } });
      notices.append(holder);
    }
    notices.hidden = notices.childElementCount === 0;
    const cap = atSystemsCap(state.total, state.max);
    capNote.textContent = cap ?? '';
    capNote.hidden = cap === null;
    newButton.set({ disabled: cap !== null, title: cap ?? '' });
    buildButton.set({ disabled: cap !== null, title: cap ?? '' });
  };

  const paint = (): void => {
    const state = store.get();
    const previousScroll = scroller.scrollTop;
    list.replaceChildren();
    paintNotices(state);
    const kind = systemsListState({ status: state.status, systems: state.systems });
    if (kind === 'loading') list.append(...skeleton());
    else if (kind === 'error') list.append(failureState(state));
    else if (kind === 'empty') list.append(emptyState());
    else list.append(...(state.systems ?? []).map(rowFor));
    list.setAttribute('aria-busy', kind === 'loading' ? 'true' : 'false');
    scroller.scrollTop = previousScroll;
  };

  // ------------------------------------------------------------ actions
  const others = (id: string): Array<{ name: string }> => (store.get().systems ?? []).filter((entry) => entry.id !== id);

  const rename = (summary: SystemSummary): void => {
    const sheet = openSheet(options.actions.host, { title: 'Rename design system', variant: 'dialog' });
    let value = summary.name;
    const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    const holder = h('div');
    const field = mountTextField(holder, {
      label: 'Name',
      value,
      onChange: (next) => {
        value = next;
        field.update({ value: next, error: systemNameProblem(next, others(summary.id)) ?? undefined });
      },
    });
    const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });
    const save = btn({
      label: 'Rename',
      variant: 'default',
      emphasis: 'primary',
      onClick: () => {
        const problem = systemNameProblem(value, others(summary.id));
        if (problem !== null) {
          field.update({ error: problem });
          return;
        }
        failure.hidden = true;
        save.set({ loading: true });
        cancel.set({ disabled: true });
        store.rename(summary.id, value.normalize('NFKC').trim()).then(
          () => {
            toast('success', `Renamed to ${value.trim()}.`);
            sheet.close();
          },
          (error: unknown) => {
            failure.textContent = errorText(error);
            failure.hidden = false;
            save.set({ loading: false });
            cancel.set({ disabled: false });
          },
        );
      },
    });
    sheet.body.append(holder, failure);
    sheet.foot.append(cancel.el, save.el);
  };

  const remove = (summary: SystemSummary): void => {
    confirmDialog(options.actions.host, {
      title: `Delete ${summary.name}?`,
      body: h('p', null, deleteSentence(summary.usedBy)),
      confirmLabel: 'Delete design system',
      destructive: true,
      onConfirm: async () => {
        const cleared = await store.remove(summary.id);
        const extra = [cleared.default ? 'It was your default, so new designs ask again.' : null, cleared.pins > 0 ? `${plural(cleared.pins, 'project pin')} cleared.` : null].filter((part): part is string => part !== null);
        toast('success', [`Deleted ${summary.name}.`, ...extra].join(' '));
      },
    });
  };

  const runAction = async (id: SystemMenuId, summary: SystemSummary): Promise<void> => {
    try {
      if (id === 'open') options.onOpen(summary.id);
      else if (id === 'rename') rename(summary);
      else if (id === 'delete') remove(summary);
      else if (id === 'make-default') {
        await store.setDefault({ id: summary.id, name: summary.name });
        toast('success', `${summary.name} is now the default for new designs.`);
      } else if (id === 'remove-default') {
        await store.setDefault(null);
        toast('success', `${summary.name} is no longer the default. New designs ask each time.`);
      } else if (id === 'reveal') {
        await client.call('POST /reveal', { body: { system: summary.id, target: 'folder' } });
      }
    } catch (error) {
      toast('error', `${id === 'reveal' ? 'Couldn’t open the folder' : 'That didn’t work'}. ${errorText(error)}`);
    }
  };

  // ------------------------------------------------------------ live
  let signature = '';
  scope.add(
    store.subscribe((state) => {
      const next = `${state.status}:${state.total}:${state.error?.message ?? ''}:${JSON.stringify(state.systems)}`;
      if (next === signature) return;
      signature = next;
      paint();
    }),
  );
  // "2 hours ago" ages while the list is open.
  const minute = setInterval(paint, 60_000);
  scope.add(() => clearInterval(minute));

  // The host's project names make "From shop" and "Pinned for shop" read like the user's own words; without them the folder name stands in.
  guestHost.client.listProjects().then(
    (answer) => {
      projects = answer.projects.map((project) => ({ directory: project.directory, name: project.name }));
      paint();
    },
    (error: unknown) => console.warn('Design Chamber: the project names could not be read; systems show folder names', error),
  );

  void store.load();
  paint();

  return {
    el,
    focus: () => (el.querySelector<HTMLElement>('.dc-sys-main:not([data-static])') ?? newButton.el).focus(),
    focusRow: (id) => list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .dc-sys-main`)?.focus(),
    dispose: () => {
      scope.dispose();
      el.remove();
    },
  };
};
