// Design Chamber's own app-data folder (documentation/specs/phase-1-5-sdk-2-7.md §U3.3): where
// settings.json and runtime.json live. Pure and free of Node imports, so the service
// (`src/service/settings.ts`, `src/service/runtime-record.ts`) and the OpenCode plugin
// (`src/plugin/check-tool.ts`, bundled with nothing to import) compute the same folder.
//   win32   %APPDATA%\Design Chamber   (fallback <home>\AppData\Roaming\Design Chamber)
//   darwin  <home>/Library/Application Support/Design Chamber
//   else    <XDG_CONFIG_HOME or <home>/.config>/design-chamber
// The real service never receives XDG_CONFIG_HOME (GUEST_SERVICES.md:28), so the plugin passes
// `xdgConfigHome: undefined` whatever OpenCode's own environment says, and both sides agree.

/** The record the service writes for the `design_check` tool, beside settings.json. */
export const RUNTIME_FILE = 'runtime.json';

export type DataDirInput = {
  platform: NodeJS.Platform;
  homeDir: string;
  /** `%APPDATA%` (Windows only). Blank or missing falls back to the roaming folder. */
  appData?: string | undefined;
  /** `XDG_CONFIG_HOME` (Linux and other Unix). Blank or missing falls back to `~/.config`. */
  xdgConfigHome?: string | undefined;
  /** The join of the path flavour in use (`path.join`, `path.win32.join`, ...). */
  join: (...parts: string[]) => string;
};

const given = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== '';

/** The absolute folder that holds Design Chamber's settings.json and runtime.json. */
export const designChamberDataDir = ({ platform, homeDir, appData, xdgConfigHome, join }: DataDirInput): string => {
  if (platform === 'win32') return join(given(appData) ? appData : join(homeDir, 'AppData', 'Roaming'), 'Design Chamber');
  if (platform === 'darwin') return join(homeDir, 'Library', 'Application Support', 'Design Chamber');
  return join(given(xdgConfigHome) ? xdgConfigHome : join(homeDir, '.config'), 'design-chamber');
};
