// What the instruction builders know about a design's system (documentation/specs/
// phase-2-5-technical.md §8.1): read from the design's copy (`<design>/system/COPY.json`), its
// recorded decision (state.json `systemDecision`) and the systems of this root. Reads only.
//
// Every file read here is agent-reachable (the agent writes in the design and system folders), so
// each is reached through `resolvePlainTarget` (no link followed out of its folder), checked to be
// a regular file and read bounded.

import { open } from 'node:fs/promises';
import path from 'node:path';

import { AGENT_SYSTEM_CHOICES_MAX, AGENT_SYSTEM_MISSING_MAX, overviewLineOf, type AgentSystem, type AgentSystemChoice } from '../shared/agent/context.ts';
import { sameDirectory } from '../shared/path-compare.ts';
import { COPY_DIR, COPY_JSON_FILE } from '../shared/system-copy.ts';
import { SYSTEM_OVERVIEW_MAX } from '../shared/limits.ts';
import type { SettingsFile, SystemDetail, SystemSummary } from '../shared/types.ts';
import type { DesignRecord, Logger } from './context.ts';
import { isPlainTarget, resolvePlainTarget } from './paths.ts';
import { readCopyRecord } from './store.ts';
import type { SystemStore } from './systems/store.ts';

/** An overview is read up to 4 bytes per character of its cap. */
const OVERVIEW_BYTES_MAX = SYSTEM_OVERVIEW_MAX * 4;

/** A regular file's text inside `base`, at most `maxBytes`; null when it is absent, a link, not a file or unreadable. */
const readBounded = async (base: string, rel: string, maxBytes: number): Promise<string | null> => {
  try {
    const file = await resolvePlainTarget(base, rel.split('/'));
    const handle = await open(file, 'r');
    try {
      if (!(await handle.stat()).isFile()) return null;
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
};

/** The px values of a system's breakpoint tokens, ascending, once each. */
export const breakpointsOf = (detail: Pick<SystemDetail, 'tokens'>): number[] => {
  const values = new Set<number>();
  for (const token of detail.tokens) {
    if (!token.breakpoint) continue;
    const match = /^(\d{1,5}(?:\.\d+)?)px$/.exec((token.light ?? token.dark)?.text.trim() ?? '');
    if (match?.[1] !== undefined) values.add(Number(match[1]));
  }
  return [...values].sort((a, b) => a - b);
};

/**
 * The system the ask recommends (§8.1): the Ready system made from this design's project, else
 * the default when it is Ready, else none.
 */
export const recommendedSystem = (
  rows: readonly Pick<SystemSummary, 'id' | 'status' | 'unreadable' | 'sources'>[],
  projectDirectory: string | null,
  settings: Pick<SettingsFile, 'systemDefault'>,
): string | null => {
  const ready = rows.filter((row) => row.status === 'ready' && row.unreadable === null);
  if (projectDirectory !== null) {
    const fromProject = ready.find((row) => row.sources.code !== null && sameDirectory(row.sources.code.directory, projectDirectory));
    if (fromProject !== undefined) return fromProject.id;
  }
  const fallback = settings.systemDefault;
  return fallback?.choice === 'system' && ready.some((row) => row.id === fallback.id) ? fallback.id : null;
};

export type AgentSystemDeps = {
  systems: Pick<SystemStore, 'list' | 'filesDir' | 'detail'>;
  settings: () => Pick<SettingsFile, 'systemDefault'>;
  log: Logger;
};

const linkedOf = async (deps: AgentSystemDeps, record: DesignRecord, copy: { id: string; name: string; revision: number; files: Record<string, string> }, rows: readonly SystemSummary[]): Promise<AgentSystem> => {
  const folder = path.join(record.path, COPY_DIR);
  const missing: string[] = [];
  for (const rel of ['system.css', ...Object.keys(copy.files)]) {
    if (missing.length >= AGENT_SYSTEM_MISSING_MAX) break;
    if (rel !== COPY_JSON_FILE && !(await isPlainTarget(folder, rel.split('/')))) missing.push(rel);
  }
  const overview = await readBounded(folder, 'OVERVIEW.md', OVERVIEW_BYTES_MAX);
  const row = rows.find((one) => one.id === copy.id);
  let breakpoints: number[] = [];
  if (row !== undefined && row.unreadable === null) {
    try {
      breakpoints = breakpointsOf(await deps.systems.detail(copy.id));
    } catch (error) {
      deps.log.warn('agent.system-detail-failed', { system: copy.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    state: 'linked',
    id: copy.id,
    name: row?.name ?? copy.name,
    revision: copy.revision,
    folder,
    complete: missing.length === 0,
    missing,
    overviewEmpty: overview === null || overview.trim() === '',
    breakpoints,
    repo: row !== undefined && row.home !== 'internal' ? row.home.directory : null,
  };
};

const askOf = async (deps: AgentSystemDeps, record: DesignRecord, rows: readonly SystemSummary[]): Promise<AgentSystem> => {
  const ready = rows.filter((row) => row.status === 'ready' && row.unreadable === null);
  // Every system went away since the design was made: nothing to ask about.
  if (ready.length === 0) return { state: 'none' };
  const recommended = recommendedSystem(ready, record.design.projectDirectory, deps.settings());
  // The recommended one is always offered, even past the cap.
  const offered = [...ready.filter((row) => row.id === recommended), ...ready.filter((row) => row.id !== recommended)].slice(0, AGENT_SYSTEM_CHOICES_MAX);
  const choices: AgentSystemChoice[] = [];
  for (const row of offered) {
    const dir = await deps.systems.filesDir(row.id).catch(() => null);
    const overview = dir === null ? null : await readBounded(dir, 'OVERVIEW.md', OVERVIEW_BYTES_MAX);
    choices.push({ id: row.id, name: row.name, line: overviewLineOf(overview) });
  }
  return { state: 'ask', choices, recommended };
};

/**
 * The design's system for its instructions. A copy that can't be read reads as `none` (the agent
 * is not pointed at files that may not be there; the viewer says the copy is unreadable). The
 * systems list failing reads the same as no systems: the copy alone still names the link.
 */
export const agentSystemOf = async (deps: AgentSystemDeps, record: DesignRecord): Promise<AgentSystem> => {
  const copy = await readCopyRecord(record.path).catch(() => ({ kind: 'invalid' as const }));
  const decision = record.state.systemDecision;
  if (copy.kind !== 'ok' && decision !== 'ask') return copy.kind === 'invalid' || decision !== undefined ? { state: 'none' } : { state: 'unset' };
  let rows: SystemSummary[] = [];
  try {
    rows = await deps.systems.list();
  } catch (error) {
    deps.log.warn('agent.systems-list-failed', { error: error instanceof Error ? error.message : String(error) });
  }
  if (copy.kind === 'ok') return linkedOf(deps, record, copy.record, rows);
  return askOf(deps, record, rows);
};
