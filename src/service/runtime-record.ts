// `runtime.json` in Design Chamber's app-data folder (documentation/specs/phase-1-5-sdk-2-7.md
// §U3.3): which program runs the service, so the `design_check` tool in OpenCode can run the
// check CLI with it. It holds no secret: `{ v, execPath, electron, version, updated }`.
//
// Written atomically next to settings.json when the service starts, and only when `execPath`,
// `electron` or `version` changed (one read, compare, write). A failure is logged as
// `runtime-record.write-failed` and the service carries on; the tool then says it is not set up.
// The record alone is never trusted: the plugin checks it against the OpenChamber install that
// runs OpenCode (src/plugin/check-tool.ts, `validateRuntime`).

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RUNTIME_FILE } from '../shared/app-data.ts';
import { RUNTIME_PATH_MAX } from '../shared/limits.ts';
import type { Logger } from './context.ts';
import { writeFileAtomic } from './paths.ts';
import { settingsFilePath, type SettingsEnv } from './settings.ts';

export type RuntimeRecord = {
  v: 1;
  execPath: string;
  electron: boolean;
  version: string;
  updated: string;
};

export type RuntimeRecordOptions = {
  log: Logger;
  /** package.json version. */
  version: string;
  /** Settings-file location seam (`DC_SETTINGS_PATH`); defaults to `process.env`. */
  env?: SettingsEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  /** Test seams; default to this process. */
  execPath?: string;
  electron?: boolean;
  now?: () => Date;
};

export type RuntimeRecordStatus = 'written' | 'current' | 'failed';

/** runtime.json beside settings.json (so the `DC_SETTINGS_PATH` test seam moves both). */
export const runtimeRecordPath = (env: SettingsEnv = process.env, platform: NodeJS.Platform = process.platform, homeDir: string = os.homedir()): string =>
  path.join(path.dirname(settingsFilePath(env, platform, homeDir)), RUNTIME_FILE);

export const buildRuntimeRecord = (input: { execPath: string; electron: boolean; version: string; now: () => Date }): RuntimeRecord => ({
  v: 1,
  execPath: input.execPath,
  electron: input.electron,
  version: input.version,
  updated: input.now().toISOString(),
});

/** Whether the record on disk already says the same thing (`updated` aside). */
const sameRecord = (text: string, next: RuntimeRecord): boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const old = parsed as Partial<Record<keyof RuntimeRecord, unknown>>;
    return old.v === next.v && old.execPath === next.execPath && old.electron === next.electron && old.version === next.version;
  } catch {
    return false;
  }
};

const hasControl = (value: string): boolean => /[\u0000-\u001f\u007f]/.test(value);

/** Write or refresh the record and say which happened. Never rejects. */
export const syncRuntimeRecord = async (options: RuntimeRecordOptions): Promise<RuntimeRecordStatus> => {
  const { log } = options;
  try {
    const file = runtimeRecordPath(options.env ?? process.env, options.platform ?? process.platform, options.homeDir ?? os.homedir());
    const execPath = options.execPath ?? process.execPath;
    // The plugin refuses these anyway; writing them would only turn a clear "not set up" into a refusal.
    if (!path.isAbsolute(execPath) || execPath.length > RUNTIME_PATH_MAX || hasControl(execPath)) {
      log.warn('runtime-record.write-failed', { message: 'The runtime path cannot be recorded for the check tool.' });
      return 'failed';
    }
    const record = buildRuntimeRecord({
      execPath,
      electron: options.electron ?? process.versions.electron !== undefined,
      version: options.version,
      now: options.now ?? (() => new Date()),
    });
    const existing = await readFile(file, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (existing !== null && sameRecord(existing, record)) return 'current';
    await writeFileAtomic(file, `${JSON.stringify(record, null, 2)}\n`);
    log.info('runtime-record.written', { file, electron: record.electron, version: record.version });
    return 'written';
  } catch (error) {
    log.warn('runtime-record.write-failed', { error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
};

/** The service's start-up call (src/service/compose.ts). Never rejects. */
export const writeRuntimeRecord = async (options: RuntimeRecordOptions): Promise<void> => {
  await syncRuntimeRecord(options);
};
