// The rows of Work Status (documentation/specs/phase-1-5-sdk-2-7.md §U5.3): which designs the
// chat's status frame lists, and what it says about each. Answered from memory: the design index
// for the list, the activity tracker for the linked agent, this module's own change-hub listener
// for the last file an agent wrote, and the checks service (memoised, under a short read budget)
// for the counts. Nothing here reads a design folder or a request-supplied path: `directory` and
// `session` are only compared with what the index already holds.

import { basename } from 'node:path/posix';

import type { ChecksResponse, StatusAgentState, StatusDesignRow, StatusDesignsQuery, StatusDesignsResponse } from '../shared/api.ts';
import { RESTORE_QUIET_MS, agentFiles } from '../shared/build-activity.ts';
import { STATUS_CHECK_READ_MS, STATUS_INDEX_WAIT_MS, STATUS_RECENT_MS, STATUS_ROWS_MAX, WRITING_WINDOW_MS } from '../shared/limits.ts';
import { sameDirectory } from '../shared/path-compare.ts';
import type { DesignSummary } from '../shared/types.ts';
import type { ServiceContext } from './context.ts';

// ---- Picking (pure) ----

export type StatusPickInput = {
  /** The frame's project folder; `null` = no project open. */
  directory: string | null;
  /** The frame's chat; `null` = none. */
  sessionId: string | null;
  /** Sessions with an agent working right now. */
  working: ReadonlySet<string>;
  /** Epoch ms. */
  now: number;
};

const timeOf = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

/**
 * The designs Work Status lists, in order (§U5.2): this chat's design first; then designs an agent
 * is working on in this project; then this project's designs updated in the last 7 days. With no
 * project open the project test is dropped (anywhere). With a project open, a design that names no
 * project cannot be placed in it and is left out, unless it is this chat's. `picked` is cut at
 * `STATUS_ROWS_MAX`; `total` counts every match.
 */
export const pickStatusDesigns = (designs: readonly DesignSummary[], input: StatusPickInput): { picked: DesignSummary[]; total: number } => {
  const { directory, sessionId, working, now } = input;
  const ranked: { design: DesignSummary; rank: 0 | 1 | 2 }[] = [];
  for (const design of designs) {
    const here = sessionId !== null && design.sessionId === sessionId;
    const inProject = directory === null || (design.projectDirectory !== null && sameDirectory(design.projectDirectory, directory));
    if (here) {
      ranked.push({ design, rank: 0 });
    } else if (!inProject) {
      continue;
    } else if (design.sessionId !== null && working.has(design.sessionId)) {
      ranked.push({ design, rank: 1 });
    } else if (now - timeOf(design.updated) <= STATUS_RECENT_MS) {
      ranked.push({ design, rank: 2 });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || timeOf(b.design.updated) - timeOf(a.design.updated) || a.design.slug.localeCompare(b.design.slug));
  return { picked: ranked.slice(0, STATUS_ROWS_MAX).map((entry) => entry.design), total: ranked.length };
};

/**
 * What the rail pill would say (§U5.2 agent table): working with a file saved inside the writing
 * window is `writing`, working otherwise `working`, a failed last turn `failed`; a finished or
 * unknown turn says nothing.
 */
export const agentStateOf = (
  activity: { state: 'working' | 'done' | 'failed' } | null,
  lastFile: { file: string; at: number } | null,
  now: number,
): { agent: StatusAgentState | null; lastFile: string | null } => {
  if (activity?.state === 'failed') return { agent: 'failed', lastFile: null };
  if (activity?.state !== 'working') return { agent: null, lastFile: null };
  if (lastFile !== null && now - lastFile.at < WRITING_WINDOW_MS) return { agent: 'writing', lastFile: lastFile.file };
  return { agent: 'working', lastFile: null };
};

// ---- The service ----

export type StatusContext = Pick<ServiceContext, 'hub' | 'designIndex' | 'activity' | 'log' | 'onDispose'>;

export type StatusDesignsDeps = {
  /** The design's check state (the checks service's `get`). May reject or be slow. */
  checksFor(slug: string): Promise<ChecksResponse>;
  /** Epoch ms; tests inject it. */
  now?: () => number;
  indexWaitMs?: number;
  checkReadMs?: number;
};

export type StatusDesigns = {
  answer(query: StatusDesignsQuery): Promise<StatusDesignsResponse>;
};

const NONE: StatusDesignsResponse = { rows: [], total: 0 };

/** The first `ms` of `work`, else `null`; a rejection is `null` too. The timer never outlives the race. */
const within = async <T>(work: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export const createStatusDesigns = (ctx: StatusContext, deps: StatusDesignsDeps): StatusDesigns => {
  const now = deps.now ?? Date.now;
  const indexWaitMs = deps.indexWaitMs ?? STATUS_INDEX_WAIT_MS;
  const checkReadMs = deps.checkReadMs ?? STATUS_CHECK_READ_MS;

  // The last file an agent wrote per design, from the same `files` events the viewer's build strip
  // reads. Starts empty at service start: a file written before the first status read shows as
  // "working" until the next write.
  const lastFiles = new Map<string, { file: string; at: number }>();
  const restoredAt = new Map<string, number>();

  const off = ctx.hub.subscribe((event) => {
    if (event.kind === 'root') {
      lastFiles.clear();
      restoredAt.clear();
      return;
    }
    if (event.slug === null) return;
    if (event.kind === 'removed') {
      lastFiles.delete(event.slug);
      restoredAt.delete(event.slug);
      return;
    }
    if (event.kind !== 'files') return;
    // The user's own hand edit (Phase 2 §2.6): not the agent writing.
    if (event.origin === 'user') return;
    const at = now();
    // A `files` event with no list is a user's restore; the watcher then re-reports what the restore wrote.
    if (event.files === undefined) {
      restoredAt.set(event.slug, at);
      lastFiles.delete(event.slug);
      return;
    }
    const restored = restoredAt.get(event.slug);
    if (restored !== undefined && at - restored < RESTORE_QUIET_MS) return;
    const written = agentFiles(event.files);
    const latest = written[written.length - 1];
    if (latest !== undefined) lastFiles.set(event.slug, { file: basename(latest), at });
  });
  ctx.onDispose(off);

  const checksOf = async (design: DesignSummary): Promise<StatusDesignRow['checks']> => {
    // The row shows no check part for a design with nothing written yet.
    if (design.pending) return null;
    const read = await within(deps.checksFor(design.slug), checkReadMs);
    return read === null ? null : { counts: read.counts, render: { state: read.render.state }, canRun: read.canRun, browser: read.browser };
  };

  return {
    async answer(query) {
      try {
        if (!(await ctx.designIndex.ready(indexWaitMs))) return NONE;
        const at = now();
        const { picked, total } = pickStatusDesigns(ctx.designIndex.all(), {
          directory: query.directory === undefined || query.directory === '' ? null : query.directory,
          sessionId: query.session === undefined || query.session === '' ? null : query.session,
          working: new Set(ctx.activity.working().map((activity) => activity.sessionId)),
          now: at,
        });
        const rows = await Promise.all(
          picked.map(async (design): Promise<StatusDesignRow> => {
            const state = agentStateOf(design.sessionId === null ? null : ctx.activity.of(design.sessionId), lastFiles.get(design.slug) ?? null, at);
            return {
              slug: design.slug,
              title: design.title,
              kind: design.kind,
              here: query.session !== undefined && query.session !== '' && design.sessionId === query.session,
              agent: state.agent,
              lastFile: state.lastFile,
              checks: await checksOf(design),
              pending: design.pending,
              openComments: design.openComments,
            };
          }),
        );
        return { rows, total };
      } catch (error) {
        // Work Status is a glance, not a gate: an index or tracker that fails shows the empty state.
        ctx.log.warn('status.designs-failed', { error: error instanceof Error ? error.message : String(error) });
        return NONE;
      }
    },
  };
};
