// Work Status frame (documentation/specs/phase-1-5-sdk-2-7.md §U5): the "Designs" section of a chat's Work
// Status. One line per design: what the agent is doing, how its checks stand, with Check and Open. Our own
// frame rather than an app-drawn section, because only a frame can open the rail and see which chat it is in.
//
// It reads `GET /status/designs` and refetches on the change feed (a long-poll, no timer polls anything);
// the host runs the frame only while the section is shown and expanded, and the feed also pauses while the
// document is hidden. Every word comes from `model/status-model.ts`; design titles are agent-written, so
// they only ever reach the page through `textContent`. The panel's `guest.ts` is not used: it would start
// the whole store, and this frame needs one route.

import { applyHostReady, mountSpinner } from '@openchamber/sdk/ui';

import type { StatusDesignsQuery, StatusDesignsResponse } from '../../shared/api.ts';
import { STATUS_REFETCH_DEBOUNCE_MS, STATUS_STARTING_GIVE_UP_MS } from '../../shared/limits.ts';
import { createChangeFeed } from '../../guest/changes.ts';
import { PANEL_SURFACE_ID, isHostError, openInRail } from '../../guest/flows.ts';
import { getGuestHost } from '../../guest/host.ts';
import { createServiceClient, isServiceError, toServiceError } from '../../guest/service-client.ts';
import { debounce, errorText, h } from '../components/dom.ts';
import { btn, type BtnHandle } from '../components/kit.ts';
import {
  STATUS_COPY,
  projectDirectoryOf,
  shouldRefetchStatus,
  statusSectionOf,
  type StatusNotice,
  type StatusRowView,
  type StatusSectionView,
} from '../model/status-model.ts';

const guestHost = getGuestHost();
const client = createServiceClient(guestHost.client);
const feed = createChangeFeed(client);

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Design Chamber: #root is missing from the Work Status frame.');
const appRoot: HTMLElement = root;

// The kit's stylesheet comes with its first primitive; mount one now so our buttons look like the kit's.
mountSpinner(document.createElement('div')).dispose();

// ---------------------------------------------------------------- state

let data: StatusDesignsResponse | null = null;
let failure: { code: string; message: string } | null = null;
let failingSince: number | null = null;
let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
let hasProject = true;
/** The folder the host says this chat is in; a chat without a project is in its own folder, which is not a project. */
let directory: string | null = null;
/** `directory` when it is a registered project, else null (the list then spans this chat and the last 7 days). */
let projectDirectory: string | null = null;
let resolveSeq = 0;
let sessionId: string | null = null;
let ready = false;
let latest = 0;
/** Designs the person pressed Check on, until the service reports the run itself. */
const checking = new Set<string>();

const queryOf = (): StatusDesignsQuery => ({
  ...(projectDirectory === null ? {} : { directory: projectDirectory }),
  ...(sessionId === null ? {} : { session: sessionId }),
});

// ---------------------------------------------------------------- host calls that never reject

const toast = (kind: 'info' | 'error', message: string): void => {
  guestHost.client.toast({ kind, message, dismiss: kind === 'error' }).catch((error: unknown) => {
    console.warn('Design Chamber: toast failed', error);
  });
};

const isRailUnavailable = (error: unknown): boolean => isHostError(error, 'NO_DIRECTORY') || isHostError(error, 'UNSUPPORTED');

// ---------------------------------------------------------------- reading

/** Longest wait for the host's project list; past it the folder is taken for a project, as it was before the list was asked. */
const PROJECTS_WAIT_MS = 3000;

const readProjects = async (): Promise<ReadonlyArray<{ directory: string }> | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The host did not answer listProjects in time.')), PROJECTS_WAIT_MS);
    });
    return (await Promise.race([guestHost.client.listProjects(), timeout])).projects;
  } catch (error) {
    console.warn('Design Chamber: listProjects failed, treating the folder as a project', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Decide whether the host's folder is a project, then read the list for it. Redone whenever the folder changes. */
const resolveProject = async (): Promise<void> => {
  resolveSeq += 1;
  const mine = resolveSeq;
  const projects = directory === null ? [] : await readProjects();
  if (mine !== resolveSeq) return;
  projectDirectory = projectDirectoryOf(directory, projects);
  hasProject = projectDirectory !== null;
  paint();
  await load();
};

const load = async (): Promise<void> => {
  latest += 1;
  const mine = latest;
  try {
    const answer = await client.call('GET /status/designs', { query: queryOf() });
    if (mine !== latest) return;
    data = answer;
    failure = null;
    failingSince = null;
    clearTimeout(giveUpTimer);
  } catch (error) {
    if (mine !== latest) return;
    const problem = toServiceError(error);
    failure = { code: problem.code, message: problem.message };
    if (failingSince === null) {
      failingSince = Date.now();
      // "Starting" turns into "isn’t responding" once; this is a deadline for a message, not a poll.
      clearTimeout(giveUpTimer);
      giveUpTimer = setTimeout(paint, STATUS_STARTING_GIVE_UP_MS);
    }
  }
  paint();
};

const refetch = debounce(() => void load(), STATUS_REFETCH_DEBOUNCE_MS);

// ---------------------------------------------------------------- actions

const runCheck = async (slug: string): Promise<void> => {
  if (checking.has(slug)) return;
  checking.add(slug);
  paint();
  try {
    await client.call('POST /designs/:slug/checks/run', { params: { slug }, body: {} });
  } catch (error) {
    if (isServiceError(error, 'conflict')) toast('info', STATUS_COPY.anotherCheck);
    else if (isServiceError(error, 'not-found')) toast('error', STATUS_COPY.gone);
    else toast('error', `Couldn’t start the check. ${errorText(error)}`);
  }
  // The service now owns "running"; a failed press reads the truth too (the design may be gone).
  await load();
  checking.delete(slug);
  paint();
};

const openDesign = async (slug: string): Promise<void> => {
  try {
    const outcome = await openInRail({ client, host: guestHost.client }, slug, 'view');
    if (outcome === 'gone') {
      toast('error', STATUS_COPY.gone);
      void load();
    } else if (outcome === 'not-here') toast('info', STATUS_COPY.notHere);
  } catch (error) {
    toast('error', `Couldn’t open that design. ${errorText(error)}`);
  }
};

const openAll = async (): Promise<void> => {
  try {
    await guestHost.client.openSurface(PANEL_SURFACE_ID);
  } catch (error) {
    if (isRailUnavailable(error)) toast('info', STATUS_COPY.notHere);
    else toast('error', `Couldn’t open Design Chamber. ${errorText(error)}`);
  }
};

// ---------------------------------------------------------------- drawing

type RowNode = { el: HTMLLIElement; update: (view: StatusRowView) => void };

const rows = new Map<string, RowNode>();
const busyOpen = new Set<string>();
let rowSeq = 0;

const buildRow = (slug: string): RowNode => {
  rowSeq += 1;
  const reasonId = `ws-reason-${rowSeq}`;
  const dot = h('span', { class: 'ws-dot', 'aria-hidden': 'true' });
  const title = h('span', { class: 'ws-title' });
  const meta = h('span', { class: 'ws-meta' });
  const reason = h('span', { class: 'ws-sr', id: reasonId });
  const check: BtnHandle = btn({ label: 'Check', variant: 'ghost', size: 'xs', onClick: () => void runCheck(slug) });
  const open: BtnHandle = btn({
    label: 'Open',
    variant: 'outline',
    size: 'xs',
    onClick: () => {
      if (busyOpen.has(slug)) return;
      busyOpen.add(slug);
      open.set({ loading: true });
      void openDesign(slug).finally(() => {
        busyOpen.delete(slug);
        open.set({ loading: false });
      });
    },
  });
  const el = h('li', { class: 'ws-row', 'data-slug': slug }, dot, title, meta, h('div', { class: 'ws-actions' }, check.el, open.el), reason);

  return {
    el,
    update: (view) => {
      el.dataset.tone = view.tone;
      el.dataset.here = view.here ? 'true' : 'false';
      title.textContent = view.title;
      // The name's own tooltip would hide the row's: keep the full title (it may be clipped) and add the checks sentence.
      title.title = view.tooltip ? `${view.title}\n${view.tooltip}` : view.title;
      meta.textContent = view.meta;
      meta.hidden = view.meta === '';
      // The badge's own sentence when there is a check part; the line is also read in order, so this is a bonus.
      if (view.tooltip) el.title = view.tooltip;
      else el.removeAttribute('title');
      check.el.setAttribute('aria-label', `Check ${view.title}`);
      open.el.setAttribute('aria-label', `Open ${view.title}`);
      check.set({ loading: view.check.state === 'busy', disabled: view.check.state === 'disabled', title: view.check.reason ?? undefined });
      // A disabled button gives its reason to a screen reader through this, not only a tooltip.
      reason.textContent = view.check.reason ?? '';
      if (view.check.state === 'disabled') check.el.setAttribute('aria-describedby', reasonId);
      else check.el.removeAttribute('aria-describedby');
    },
  };
};

/** Make `parent`'s children exactly `wanted`, in order, moving a node only when it is out of place (a moved node loses focus). */
const syncChildren = (parent: HTMLElement, wanted: readonly Node[]): void => {
  wanted.forEach((node, index) => {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
  });
  while (parent.children.length > wanted.length) parent.lastElementChild?.remove();
};

const list = h('ul', { class: 'ws-list', 'aria-label': 'Designs' });
const noticeText = h('span', { class: 'ws-notice-text' });
const retry = btn({ label: 'Try again', variant: 'ghost', size: 'xs', onClick: () => void load() });
const notice = h('div', { class: 'ws-notice', role: 'status' }, noticeText, retry.el);
const emptyText = h('p', { class: 'ws-empty' });
const loading = h('div', { class: 'ws-loading' });
mountSpinner(loading, { size: 'sm', label: STATUS_COPY.loading });
const more = btn({ label: '', variant: 'ghost', size: 'xs', onClick: () => void openAll() });
const moreWrap = h('div', { class: 'ws-more' }, more.el);
const frame = h('div', { class: 'ws-frame' }, loading, notice, emptyText, list, moreWrap);
appRoot.append(frame);

const paintNotice = (value: StatusNotice | null): void => {
  notice.hidden = value === null;
  if (value === null) return;
  noticeText.textContent = value.text;
  notice.dataset.kind = value.kind;
  retry.el.hidden = !value.retry;
};

const draw = (view: StatusSectionView): void => {
  loading.hidden = view.kind !== 'loading';
  emptyText.hidden = view.kind !== 'empty';
  emptyText.textContent = view.emptyText ?? '';
  paintNotice(view.notice);
  list.hidden = view.kind !== 'list';

  const live = new Set(view.rows.map((row) => row.slug));
  for (const [slug, node] of rows) {
    if (!live.has(slug)) {
      node.el.remove();
      rows.delete(slug);
    }
  }
  const wanted: HTMLElement[] = [];
  for (const row of view.rows) {
    let node = rows.get(row.slug);
    if (!node) {
      node = buildRow(row.slug);
      rows.set(row.slug, node);
    }
    node.update(row);
    wanted.push(node.el);
  }
  syncChildren(list, wanted);

  moreWrap.hidden = view.more === null;
  if (view.more !== null) more.set({ label: view.more });
};

let sizeObserver: ResizeObserver | null = null;
let lastHeight = -1;

/** The section is as tall as its content; the host clamps it to 24..320 and the document scrolls past that. */
const reportHeight = (): void => {
  const height = Math.ceil(frame.getBoundingClientRect().height);
  if (height === lastHeight || height <= 0) return;
  lastHeight = height;
  guestHost.client.setHeight(height).catch((error: unknown) => {
    console.warn('Design Chamber: setHeight failed', error);
  });
};

const paint = (): void => {
  if (!ready) return;
  draw(
    statusSectionOf({
      data,
      error: failure,
      failingMs: failingSince === null ? 0 : Date.now() - failingSince,
      hasProject,
      checking,
    }),
  );
};

// ---------------------------------------------------------------- start

guestHost.ready.subscribe((context) => {
  if (!context) return;
  // Every ready snapshot, theme switches included: the host's tokens are the only palette.
  applyHostReady(context, document.documentElement);
  document.documentElement.lang = context.locale;
  if (ready) return;
  ready = true;
  directory = context.directory;
  sessionId = context.session?.id ?? null;
  sizeObserver = new ResizeObserver(reportHeight);
  sizeObserver.observe(frame);
  paint();
  void resolveProject();
});

guestHost.directory.subscribe((next) => {
  if (!ready || next === directory) return;
  directory = next;
  data = null;
  paint();
  void resolveProject();
});

guestHost.session.subscribe((next) => {
  const id = next?.id ?? null;
  if (!ready || id === sessionId) return;
  sessionId = id;
  void load();
});

feed.subscribe((batch) => {
  if (shouldRefetchStatus(batch)) refetch();
});
// A feed that comes back after an outage is the service starting again: read the list instead of waiting for an event.
let feedWasDown = false;
feed.onStatus((status) => {
  if (status.state === 'retrying') feedWasDown = true;
  else if (status.state === 'live' && feedWasDown) {
    feedWasDown = false;
    refetch();
  }
});
feed.start();

window.addEventListener('pagehide', () => {
  feed.stop();
  sizeObserver?.disconnect();
  clearTimeout(giveUpTimer);
});
