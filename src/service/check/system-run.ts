// One system check, end to end (documentation/specs/phase-2-5-technical.md §10.2, §10.3): read the
// system through the system store (every path contained, no link followed), build its detail, take
// the static findings, and (for the CLI) write `<system>/.chamber/check.json`. Static only: no
// browser. The CLI makes a store of its own over the designs root (`cliSystemStore`); the service
// route uses the composed one.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { buildSystemDetail } from '../../shared/system-json.ts';
import type { SettingsFile, SystemDetail } from '../../shared/types.ts';
import { createChangeHub } from '../changes.ts';
import type { Logger, SettingsStore } from '../context.ts';
import { resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import { createSelfWrites } from '../self-writes.ts';
import { createSystemStore, type SystemStore } from '../systems/store.ts';
import { systemCheckReport, systemFindings, type SystemCheckReport } from './system-static.ts';

export type SystemCheckRun = { report: SystemCheckReport; detail: SystemDetail };

/** The findings of one system, from what the store reads now. */
export const runSystemCheck = async (store: Pick<SystemStore, 'get'>, id: string, input: { now: Date; tool: SystemCheckReport['tool'] }): Promise<SystemCheckRun> => {
  const source = await store.get(id);
  const detail = buildSystemDetail(source);
  return { report: systemCheckReport({ id, findings: systemFindings(source, detail), now: input.now, tool: input.tool }), detail };
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
