// What the Work Status frame says (documentation/specs/phase-1-5-sdk-2-7.md §U5.2), as data. Pure: no DOM,
// no host calls. A design's line reads like it does everywhere else because its words come from exactly two
// places: the agent part from `pillText` (the rail pill) and the check part from `badgeOf` (the Checks badge).
// While the linked chat runs, its current call takes the agent part's place, in the strip's words (`describeTool`).
// This file only decides which parts show, in what order, with which dot colour and which button state.

import type { SessionTool } from '../../guest/session-tool.ts';
import { readSessionTool } from '../../guest/session-tool.ts';
import type { StatusDesignRow, StatusDesignsResponse } from '../../shared/api.ts';
import { STATUS_STARTING_GIVE_UP_MS, TOOL_REPAINT_MS } from '../../shared/limits.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import { pillText } from './build-strip-model.ts';
import { badgeOf, type BadgeTone } from './checks-model.ts';
import { plural } from './format.ts';
import { describeTool } from './tool-model.ts';

/** Every sentence of the frame that is not built from a row; the frame draws these and nothing else of its own. */
export const STATUS_COPY = {
  loading: 'Loading designs',
  emptyProject: 'No designs for this project yet. Ask the agent for one, or type /design.',
  emptyAnywhere: 'No designs in the last 7 days. Ask the agent for one, or type /design.',
  starting: 'Design Chamber is starting.',
  unresponsive: 'Design Chamber isn’t responding.',
  paused: 'Design Chamber is paused. Turn it on in Settings → Extensions.',
  loadFailed: 'Couldn’t load your designs.',
  waiting: 'Waiting for agent',
  noBrowser: 'Checks need Chrome, Edge or Chromium.',
  anotherCheck: 'Another design is being checked. Try again when it finishes.',
  checkUnavailable: 'Checks aren’t available for this design yet.',
  checkNothingYet: 'There is nothing to check until the agent writes the first file.',
  gone: 'That design was deleted.',
  notHere: 'Open Design Chamber from the rail to see it.',
} as const;

export type StatusTone = 'info' | 'success' | 'warning' | 'error' | 'muted';

export type StatusPart = { kind: 'agent' | 'check' | 'comments'; text: string };

/** `ready` can be pressed, `busy` is checking now, `disabled` carries the reason a person can read. */
export type CheckButtonView = { state: 'ready' | 'busy' | 'disabled'; reason: string | null };

export type StatusRowView = {
  slug: string;
  title: string;
  /** Linked to the chat this frame is in. */
  here: boolean;
  parts: StatusPart[];
  /** The parts joined with " · ", for the line under the title. Empty when there is nothing to say. */
  meta: string;
  /** The dot. The words in `meta` carry the same news, so the colour is never the only signal. */
  tone: StatusTone;
  /** The Checks badge's accessible sentence, when the line has a check part. */
  tooltip: string | null;
  check: CheckButtonView;
};

/** The call each running chat of the project is making, by session id. */
export type SessionTools = ReadonlyMap<string, SessionTool>;

export type StatusRowContext = {
  /** The person pressed Check on this row and the service has not yet said "running". */
  checking: boolean;
  tools?: SessionTools;
};

const CHECK_TONE: Readonly<Record<BadgeTone, StatusTone>> = { success: 'success', warning: 'warning', error: 'error', neutral: 'muted' };

const agentPart = (row: StatusDesignRow, tools: SessionTools | undefined): { text: string; tone: StatusTone } | null => {
  if (row.agent === 'writing' || row.agent === 'working') {
    // The linked chat's current call, in the build strip's short words. An unknown tool says nothing.
    const tool = row.sessionId === null ? undefined : tools?.get(row.sessionId);
    const words = tool ? describeTool(tool, null) : null;
    if (words) return { text: words.short, tone: 'info' };
  }
  if (row.agent === 'writing') return { text: pillText('writing', row.lastFile), tone: 'info' };
  if (row.agent === 'working') return { text: pillText('working', null), tone: 'info' };
  if (row.agent === 'failed') return { text: pillText('failed', null), tone: 'error' };
  if (row.pending) return { text: STATUS_COPY.waiting, tone: 'warning' };
  return null;
};

const checkButton = (row: StatusDesignRow, context: StatusRowContext): CheckButtonView => {
  const { checks } = row;
  if (context.checking || checks?.render.state === 'running') return { state: 'busy', reason: null };
  if (row.pending) return { state: 'disabled', reason: STATUS_COPY.checkNothingYet };
  if (checks === null) return { state: 'disabled', reason: STATUS_COPY.checkUnavailable };
  // `canRun` is also false while a check of any design runs, one that may not be a row here: the service says which reason it is.
  if (!checks.browser) return { state: 'disabled', reason: STATUS_COPY.noBrowser };
  if (!checks.canRun) return { state: 'disabled', reason: STATUS_COPY.anotherCheck };
  return { state: 'ready', reason: null };
};

export const statusRowView = (row: StatusDesignRow, context: StatusRowContext): StatusRowView => {
  const agent = agentPart(row, context.tools);
  // Nothing is written yet, so there is nothing to have checks about.
  const badge = row.checks !== null && !row.pending ? badgeOf(row.checks, null, context.checking) : null;
  const parts: StatusPart[] = [];
  if (agent) parts.push({ kind: 'agent', text: agent.text });
  if (badge) parts.push({ kind: 'check', text: badge.label });
  if (row.openComments > 0) parts.push({ kind: 'comments', text: plural(row.openComments, 'open comment') });
  return {
    slug: row.slug,
    title: row.title,
    here: row.here,
    parts,
    meta: parts.map((part) => part.text).join(' · '),
    // What the agent is doing outranks how the checks stand.
    tone: agent?.tone ?? (badge ? CHECK_TONE[badge.tone] : 'muted'),
    tooltip: badge?.ariaLabel ?? null,
    check: checkButton(row, context),
  };
};

// ---- the section ----

export type StatusNotice = { kind: 'starting' | 'unresponsive' | 'paused' | 'error'; text: string; retry: boolean };

export type StatusSectionView = {
  /** `problem` has nothing to list and only a notice to show. */
  kind: 'loading' | 'empty' | 'problem' | 'list';
  loadingLabel: string;
  emptyText: string | null;
  notice: StatusNotice | null;
  rows: StatusRowView[];
  /** "Show all 12 designs" when more exist than the rows listed. */
  more: string | null;
};

export type StatusSectionInput = {
  /** The last answer, kept while a refresh fails. */
  data: StatusDesignsResponse | null;
  /** The last failure, `code` as the service client reports it; null once a request has worked again. */
  error: { code: string; message: string } | null;
  /** How long it has failed, for "starting" turning into "isn’t responding". */
  failingMs: number;
  /** Whether OpenChamber has a project open here: the empty sentence differs. */
  hasProject: boolean;
  /** Designs the person pressed Check on, until the service says "running". */
  checking: ReadonlySet<string>;
  tools?: SessionTools;
  /** "Isn't responding" as this device says it (`openHelp`); the desktop's words without it. */
  serviceDown?: string;
};

const noticeOf = (error: NonNullable<StatusSectionInput['error']>, failingMs: number, unresponsive: string): StatusNotice => {
  if (error.code === 'NO_SERVICE' || error.code === 'SERVICE_FAILED') {
    return failingMs >= STATUS_STARTING_GIVE_UP_MS
      ? { kind: 'unresponsive', text: unresponsive, retry: true }
      : { kind: 'starting', text: STATUS_COPY.starting, retry: false };
  }
  if (error.code === 'DISABLED') return { kind: 'paused', text: STATUS_COPY.paused, retry: false };
  return { kind: 'error', text: `${STATUS_COPY.loadFailed} ${error.message}`, retry: true };
};

export const statusSectionOf = (input: StatusSectionInput): StatusSectionView => {
  const notice = input.error ? noticeOf(input.error, input.failingMs, input.serviceDown ?? STATUS_COPY.unresponsive) : null;
  const base = { loadingLabel: STATUS_COPY.loading, emptyText: null, notice, rows: [], more: null };
  const { data } = input;
  if (data === null) return { ...base, kind: notice ? 'problem' : 'loading' };
  if (data.rows.length === 0) {
    if (notice) return { ...base, kind: 'problem' };
    return { ...base, kind: 'empty', emptyText: input.hasProject ? STATUS_COPY.emptyProject : STATUS_COPY.emptyAnywhere };
  }
  return {
    ...base,
    kind: 'list',
    rows: data.rows.map((row) => statusRowView(row, { checking: input.checking.has(row.slug), tools: input.tools })),
    more: data.total > data.rows.length ? `Show all ${data.total} designs` : null,
  };
};

// ---- which folder is a project ----

/**
 * The folder to treat as the chat's project, or null when there is none. The host's `directory` is also set in
 * a chat opened without a project (that chat's own folder under OpenChamber's config), so a folder only counts
 * when it is one of the registered `projects`; otherwise the list is "this chat's designs, then the last 7 days".
 * `projects` is null when the list could not be read: then the folder counts, as before.
 */
export const projectDirectoryOf = (directory: string | null, projects: ReadonlyArray<{ directory: string }> | null): string | null => {
  if (directory === null) return null;
  if (projects === null) return directory;
  return projects.some((project) => sameDirectory(project.directory, directory)) ? directory : null;
};

/** The registered project the chat's folder is, with the id its sessions are read by; null when it is none. */
export const projectOf = <P extends { directory: string }>(directory: string | null, projects: ReadonlyArray<P> | null): P | null =>
  directory === null ? null : (projects?.find((project) => sameDirectory(project.directory, directory)) ?? null);

// ---- what the agents are doing ----

/** From a sessions snapshot: only a running session has a current call, and the call is read as untrusted. */
export const toolsOf = (sessions: ReadonlyArray<{ id: string; activity: string; tool?: unknown }>): SessionTools => {
  const tools = new Map<string, SessionTool>();
  for (const session of sessions) {
    const tool = session.activity === 'running' ? readSessionTool(session.tool) : null;
    if (tool) tools.set(session.id, tool);
  }
  return tools;
};

const sameTools = (a: SessionTools, b: SessionTools): boolean =>
  a.size === b.size && [...a].every(([id, tool]) => b.get(id)?.name === tool.name && b.get(id)?.target === tool.target);

/** The tools on screen, and since when. */
export type HeldTools = { tools: SessionTools; since: number };

/**
 * The tools to draw at `now`: they change at most once per `TOOL_REPAINT_MS`, so the lines stay readable while
 * an agent opens ten files a second. `wait` is how long until the held-back ones may show; null when none are.
 */
export const holdTools = (held: HeldTools | null, tools: SessionTools, now: number): { held: HeldTools; wait: number | null } => {
  if (held && sameTools(held.tools, tools)) return { held, wait: null };
  // A clock stepped back counts as time passed, so nothing is held for longer than the limit.
  if (held && now >= held.since && now - held.since < TOOL_REPAINT_MS) return { held, wait: held.since + TOOL_REPAINT_MS - now };
  return { held: { tools, since: now }, wait: null };
};

// ---- live updates ----

const REFETCH_KINDS: ReadonlySet<string> = new Set(['added', 'removed', 'design', 'files', 'comments', 'checks', 'activity', 'root']);

/**
 * Whether a change batch can change a row: a design coming or going, its files, its comments, its checks, the
 * agent's activity, a switch of the designs folder, or a reset (the service restarted; refetch everything).
 * Thumbnails, versions, loose files and open requests never show in this section.
 */
export const shouldRefetchStatus = (batch: { reset: boolean; events: ReadonlyArray<{ kind: string }> }): boolean =>
  batch.reset || batch.events.some((event) => REFETCH_KINDS.has(event.kind));
