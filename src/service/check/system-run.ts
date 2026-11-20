// One system check, end to end (documentation/specs/phase-2-5-technical.md §10.2, §10.3): read the
// system through the system store (every path contained, no link followed), build its detail, take
// the static findings, and (for the CLI) write `<system>/.chamber/check.json`. Static only: no
// browser. The CLI makes a store of its own over the designs root (`cliSystemStore`); the service
// route uses the composed one.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { CHECK_FINDINGS_MAX } from '../../shared/limits.ts';
import { findSecretShapes } from '../../shared/secret-shapes.ts';
import { buildSystemDetail, type SystemDetailSource } from '../../shared/system-json.ts';
import type { SettingsFile, SystemDetail } from '../../shared/types.ts';
import { createChangeHub } from '../changes.ts';
import type { Logger, SettingsStore } from '../context.ts';
import { resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import { createSelfWrites } from '../self-writes.ts';
import { committedStateOf, readCommitted, readRecord } from '../systems/living-page.ts';
import { readProposalProblem } from '../systems/proposal-record.ts';
import { createSystemStore, repoLabelOf, type SystemStore } from '../systems/store.ts';
import { s8Findings, systemCheckReport, systemFindings, type S8Facts, type SystemCheckReport } from './system-static.ts';

export type SystemCheckRun = { report: SystemCheckReport; detail: SystemDetail };

/**
 * What S8 needs from outside the system's files (§10.4): the COMMITTED living page in the repo, read
 * here (contained under the repo's realpath, never a link, bounded, never rendered), and the staged
 * record. The repo is only read. The same read serves the CLI and the route, with no service cache.
 */
export const readS8Facts = async (store: Pick<SystemStore, 'dir'>, id: string, source: Pick<SystemDetailSource, 'state'>): Promise<S8Facts> => {
  const home = source.state.home;
  // PROPOSAL.json is read here through the parser, and the service's record adds the step 3 problems (§5.14).
  const systemDir = await store.dir(id);
  const proposal = await readProposalProblem(systemDir);
  if (home?.kind !== 'repo') return { living: null, proposal };
  const record = await readRecord(systemDir);
  const staged = record === null ? null : { problem: record.problem, secrets: record.secrets };
  const read = await readCommitted(home.directory, home.livingPage, repoLabelOf(home.directory));
  if (read.kind === 'repo-unreadable') return { living: { committed: null, secrets: [], staged }, proposal };
  if (read.kind === 'view') return { living: { committed: read.view, secrets: [], staged }, proposal };
  const committed = committedStateOf(read.text, { id, name: source.state.name, revision: source.state.revision.n });
  return { living: { committed, secrets: findSecretShapes(read.text).map((hit) => ({ kind: hit.kind })), staged }, proposal };
};

/** The findings of one system, from what the store reads now. */
export const runSystemCheck = async (store: Pick<SystemStore, 'get' | 'dir'>, id: string, input: { now: Date; tool: SystemCheckReport['tool'] }): Promise<SystemCheckRun> => {
  const source = await store.get(id);
  const detail = buildSystemDetail(source);
  const facts = await readS8Facts(store, id, source);
  const findings = [...systemFindings(source, detail), ...s8Findings(source, detail, facts)].slice(0, CHECK_FINDINGS_MAX);
  return { report: systemCheckReport({ id, findings, now: input.now, tool: input.tool }), detail };
};

/**
 * Write the report to `<systemDir>/.chamber/check.json` atomically. `.chamber` is made without
 * recursion (a deleted system is never recreated), and neither it nor the file may be a link.
 */
export const writeSystemCheckReport = async (systemDir: string, report: SystemCheckReport): Promise<string> => {
  try {
    await mkdir(path.join(systemDir, '.chamber'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const target = await resolvePlainTarget(systemDir, ['.chamber', 'check.json'], { allowAbsent: true });
  await writeFileAtomic(target, `${JSON.stringify(report, null, 2)}\n`, { createDirs: false });
  return target;
};

const quietLog: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * A read-only system store for the CLI: the designs root it was given, no watcher, no settings
 * writes. The caller disposes it. A revision is never settled here: the quiet timer is longer than
 * any check, and `dispose` clears it.
 */
export const cliSystemStore = (root: string, settings: SettingsFile): SystemStore => {
  const settingsStore: SettingsStore = {
    root: () => root,
    defaultRoot: () => root,
    read: () => settings,
    update: () => Promise.reject(new Error('The check does not change settings.')),
    onRootChange: () => () => undefined,
  };
  return createSystemStore({ settings: settingsStore, hub: createChangeHub('dc-check'), log: quietLog, selfWrites: createSelfWrites(), quietMs: 24 * 60 * 60 * 1000 });
};
