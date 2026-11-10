// `runtime.json` in Design Chamber's app-data folder (documentation/specs/phase-1-5-sdk-2-7.md
// §U3.3): which program runs the service, so the `design_check` tool in OpenCode can run the
// check CLI with it. It holds no secret.
//
// Seam stub: writes nothing yet. The check-tool branch (U3) fills it (atomic write next to
// settings.json, rewritten only when `execPath` or `version` changed, failures logged as
// `runtime-record.write-failed`, never thrown).

import type { Logger } from './context.ts';
import type { SettingsEnv } from './settings.ts';

export type RuntimeRecordOptions = {
  log: Logger;
  /** package.json version. */
  version: string;
  /** Settings-file location seam (`DC_SETTINGS_PATH`); defaults to `process.env`. */
  env?: SettingsEnv;
  homeDir?: string;
};

/** Write or refresh the record. Never rejects. */
export const writeRuntimeRecord = async (_options: RuntimeRecordOptions): Promise<void> => undefined;
