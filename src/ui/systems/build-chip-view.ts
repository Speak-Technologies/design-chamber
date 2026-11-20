// The build chip's view (Phase 2.5 U7, technical design §9.6). When a `system-build:<ticket>` chip is opened from the
// chat, the rail shows how that build is going: waiting for the agent's interview, the design system itself once the
// agent has started it, or why there is nothing to show. It asks `GET /system-builds/:ticket` every few seconds, only
// while the window is visible, and stops once there is an answer it can keep (a made or an expired build) or after
// three failed tries in a row.

import { mountBanner, mountEmpty, mountSpinner } from '@openchamber/sdk/ui';

import { SYSTEM_BUILD_POLL_MS } from '../../shared/limits.ts';
import { toast, type ActionContext } from '../components/actions.ts';
import { createScope, errorText, h } from '../components/dom.ts';
import { btn, iconBtn } from '../components/kit.ts';
import { client, guestHost, host, isServiceError } from '../guest.ts';
import {
  BUILD_CHIP_TITLE,
  afterAnswer,
  afterFailure,
  afterProbe,
  chipView,
  keepsPolling,
  startBuildChip,
  type BuildChipModel,
  type ChipAction,
  type ChipActionId,
} from '../model/system-build-model.ts';
import { mountSystemPage, type SystemPageHandle } from './system-page.ts';

export type BuildChipViewOptions = {
  ticket: string;
  surface: 'panel' | 'page';
  actions: ActionContext;
  onBack: () => void;
};

export type BuildChipViewHandle = { el: HTMLElement; focus: () => void; dispose: () => void };

export const mountBuildChipView = (options: BuildChipViewOptions): BuildChipViewHandle => {
  const scope = createScope();
  let model: BuildChipModel = startBuildChip();
  /** The chat the chip was opened from: it is where the agent interviews the user. */
  const chatId = host.session()?.id ?? null;
  let system: { id: string; handle: SystemPageHandle } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const el = h('div', { class: 'dc-build-view', 'data-surface': options.surface });
  const back =
    options.surface === 'panel'
      ? iconBtn({ icon: 'back', label: 'Back to designs', onClick: () => options.onBack() })
      : btn({ label: 'Library', variant: 'ghost', size: 'default', icon: 'back', onClick: () => options.onBack() }).el;
  const title = h('h1', { class: options.surface === 'panel' ? 'dc-rail-title' : 'dc-page-title' }, BUILD_CHIP_TITLE);
  const head =
    options.surface === 'panel' ? h('header', { class: 'dc-rail-head' }, back, title, h('span', { class: 'dc-spacer' })) : h('header', { class: 'dc-library-bar dc-sys-bar' }, back, title, h('span', { class: 'dc-spacer' }));
  const stage = h('div', { class: 'dc-build-stage', 'aria-live': 'polite' });
  el.append(head, stage);

  const continueChat = async (): Promise<void> => {
    const id = chatId ?? host.session()?.id ?? null;
    if (id === null) {
      toast('info', 'Open the chat that started this build, then try again.');
      return;
    }
    try {
      await guestHost.client.openSession(id);
    } catch (error) {
      toast('error', `Couldn’t open the chat. ${errorText(error)}`);
    }
  };

  const run = (id: ChipActionId): void => {
    if (id === 'continue-chat') void continueChat();
    else if (id === 'open-system' && model.phase === 'made') {
      model = { ...model, probe: 'checking' };
      paint();
      void probe();
    } else if (id === 'try-again') {
      model = startBuildChip();
      paint();
      void tick();
    }
  };

  const actionRow = (actions: ChipAction[]): HTMLElement =>
    h(
      'div',
      { class: 'dc-build-actions' },
      ...actions.map((action) => btn({ label: action.label, variant: action.primary ? 'default' : 'outline', size: 'sm', icon: action.id === 'continue-chat' ? 'chat' : undefined, onClick: () => run(action.id) }).el),
    );

  const showSystem = (id: string): void => {
    if (system?.id === id) return;
    system?.handle.dispose();
    const handle = mountSystemPage({ id, surface: options.surface, actions: options.actions, onBack: options.onBack });
    system = { id, handle };
    el.replaceChildren(handle.el);
    handle.focus();
  };

  const paint = (): void => {
    if (model.phase === 'made' && system?.id === model.id) return;
    const view = chipView(model);
    title.textContent = view.title;
    stage.replaceChildren();
    if (view.spinner !== null) {
      const holder = h('div', { class: 'dc-build-loading' });
      mountSpinner(holder, { label: view.spinner });
      stage.append(holder);
    } else if (view.problem !== null) {
      const holder = h('div', { class: 'dc-banner dc-banner-block' });
      const retry = view.actions.find((action) => action.id === 'try-again');
      mountBanner(holder, { tone: 'error', title: view.problem.title, body: view.problem.body, ...(retry ? { action: { label: retry.label, onClick: () => run('try-again') } } : {}) });
      stage.append(holder);
    } else {
      const holder = h('div', { class: 'dc-build-empty' });
      const lead = view.actions.find((action) => action.primary && action.id === 'continue-chat');
      mountEmpty(holder, { title: view.title, body: view.body ?? '', ...(lead ? { action: { label: lead.label, onClick: () => run(lead.id) } } : {}) });
      stage.append(holder);
      if (view.note !== null) stage.append(h('p', { class: 'dc-muted dc-build-note' }, view.note));
      const rest = view.actions.filter((action) => action !== lead);
      if (rest.length > 0) stage.append(actionRow(rest));
    }
  };

  /** Is the system the agent started really there? A stopped build takes its draft to the trash. */
  const probe = async (): Promise<void> => {
    if (model.phase !== 'made') return;
    const { id } = model;
    try {
      await client.call('GET /systems/:id', { params: { id } });
      model = afterProbe(model, 'present');
      showSystem(id);
    } catch (error) {
      model = afterProbe(model, isServiceError(error) && error.code === 'not-found' ? 'gone' : 'unknown');
      paint();
    }
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!keepsPolling(model) || document.hidden) return;
    timer = setTimeout(() => void tick(), SYSTEM_BUILD_POLL_MS);
  };

  const tick = async (): Promise<void> => {
    if (inFlight || !keepsPolling(model)) return;
    inFlight = true;
    try {
      const answer = await client.call('GET /system-builds/:ticket', { params: { ticket: options.ticket } });
      model = afterAnswer(model, answer);
    } catch (error) {
      model = afterFailure(model, isServiceError(error) ? { code: error.code, message: error.message } : { code: 'unknown', message: errorText(error) });
    } finally {
      inFlight = false;
    }
    paint();
    if (model.phase === 'made') void probe();
    schedule();
  };

  const onVisible = (): void => {
    if (document.hidden) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    } else void tick().then(schedule);
  };
  document.addEventListener('visibilitychange', onVisible);
  scope.add(() => document.removeEventListener('visibilitychange', onVisible));
  scope.add(() => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  });

  paint();
  void tick();

  return {
    el,
    focus: () => {
      if (system) system.handle.focus();
      else back.focus();
    },
    dispose: () => {
      scope.dispose();
      system?.handle.dispose();
      el.remove();
    },
  };
};
