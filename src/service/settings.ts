// Service-owned settings file (docs/SPEC.md §6.5, §9.2) — port of design-canvas
// `service/settings.ts`, renamed for Design Chamber.
//
// One small JSON file per user, outside the designs root, holding where designs live:
// `{ version: 1, root?, previousRoots?, chromePath?, downloadsDir? }`. Guests never read or
// write it — GET/PUT /settings are the only door. Location:
//   win32   %APPDATA%\Design Chamber\settings.json   (fallback ~\AppData\Roaming\…)
//   darwin  ~/Library/Application Support/Design Chamber/settings.json
//   else    ${XDG_CONFIG_HOME:-~/.config}/design-chamber/settings.json
// `DC_SETTINGS_PATH` overrides the file location (test seam only — the host never passes
// custom env, F9). A corrupt file reads as absent and is logged; writes are atomic.
// Changing `root` pushes the old root onto `previousRoots` (newest first, ≤ 10) and NEVER
// moves files; listeners registered via `onRootChange` (the watcher) are notified after the
// write succeeded.

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { PutSettingsBody } from '../shared/api.ts';
import { designChamberDataDir } from '../shared/app-data.ts';
import { PREVIOUS_ROOTS_MAX, SETTINGS_FILE_VERSION, SETTINGS_PATH_MAX, SYSTEM_ID_PATTERN, SYSTEM_NAME_MAX, SYSTEM_PINS_MAX } from '../shared/limits.ts';
import type { SettingsFile, SystemDefaultSetting, SystemPinSetting } from '../shared/types.ts';
import type { Logger, SettingsStore } from './context.ts';
import { ApiError } from './http.ts';
import { defaultDesignsRoot, sameRoot, validateRootCandidate } from './root.ts';
import { samePath, writeFileAtomic } from './paths.ts';

export type SettingsEnv = {
  DC_SETTINGS_PATH?: string;
  APPDATA?: string;
  XDG_CONFIG_HOME?: string;
};

/** Absolute settings file path for the platform (`DC_SETTINGS_PATH` wins). */
export const settingsFilePath = (
  env: SettingsEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string => {
  const override = env.DC_SETTINGS_PATH;
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override.trim());
  // The folder rule is shared with the OpenCode plugin, which reads runtime.json from it.
  const dir = designChamberDataDir({ platform, homeDir, appData: env.APPDATA, xdgConfigHome: env.XDG_CONFIG_HOME, join: path.join });
  return path.join(dir, 'settings.json');
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A system named in settings (Phase 2.5 §2.9): the id pattern and a 1..60 character name without control characters. */
const systemRef = (id: unknown, name: unknown): { id: string; name: string } | null =>
  typeof id === 'string' && SYSTEM_ID_PATTERN.test(id) && typeof name === 'string' && name.trim() !== '' && name.length <= SYSTEM_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(name)
    ? { id, name }
    : null;

/** The default design system (§2.9); null when the value is not one of the three shapes (absent = ask). */
export const normalizeSystemDefault = (raw: unknown): SystemDefaultSetting | null => {
  if (!isRecord(raw)) return null;
  if (raw.choice === 'ask') return { choice: 'ask' };
  if (raw.choice === 'none') return { choice: 'none' };
  if (raw.choice !== 'system') return null;
  const ref = systemRef(raw.id, raw.name);
  return ref === null ? null : { choice: 'system', ...ref };
};

/**
 * Project pins (§2.9): valid entries only (an absolute directory of at most 4 096 characters without a
 * control character; `system` pins name a system), at most `SYSTEM_PINS_MAX`; a second pin for the same
 * directory (either slash, case-folded where the platform folds) is dropped.
 */
export const normalizeSystemPins = (raw: unknown, platform: NodeJS.Platform = process.platform): SystemPinSetting[] => {
  if (!Array.isArray(raw)) return [];
  const p = platform === 'win32' ? path.win32 : path.posix;
  const pins: SystemPinSetting[] = [];
  for (const entry of raw) {
    if (pins.length >= SYSTEM_PINS_MAX) break;
    if (!isRecord(entry)) continue;
    const { directory, choice } = entry;
    if (typeof directory !== 'string' || directory.length > SETTINGS_PATH_MAX || /[\u0000-\u001f\u007f]/.test(directory) || !p.isAbsolute(directory)) continue;
    if (pins.some((pin) => samePath(pin.directory, directory, p, platform))) continue;
    if (choice === 'default' || choice === 'none') pins.push({ directory, choice });
    else if (choice === 'system') {
      const ref = systemRef(entry.id, entry.name);
      if (ref !== null) pins.push({ directory, choice, ...ref });
    }
  }
  return pins;
};

/** Keep only well-typed fields; anything else in the file is dropped. */
export const normalizeSettings = (raw: unknown): SettingsFile => {
  const out: SettingsFile = { version: SETTINGS_FILE_VERSION };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const value = raw as Partial<Record<keyof SettingsFile, unknown>>;
  const text = (candidate: unknown): string | null =>
    typeof candidate === 'string' && candidate.trim() !== '' && candidate.length <= SETTINGS_PATH_MAX ? candidate : null;
  const root = text(value.root);
  if (root !== null) out.root = root;
  const chromePath = text(value.chromePath);
  if (chromePath !== null) out.chromePath = chromePath;
  const downloadsDir = text(value.downloadsDir);
  if (downloadsDir !== null) out.downloadsDir = downloadsDir;
  if (Array.isArray(value.previousRoots)) {
    const roots = value.previousRoots.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
    if (roots.length > 0) out.previousRoots = roots.slice(0, PREVIOUS_ROOTS_MAX);
  }
  const systemDefault = normalizeSystemDefault(value.systemDefault);
  // Absent means ask (§2.9), so an explicit ask is not stored.
  if (systemDefault !== null && systemDefault.choice !== 'ask') out.systemDefault = systemDefault;
  const systemPins = normalizeSystemPins(value.systemPins);
  if (systemPins.length > 0) out.systemPins = systemPins;
  return out;
};

/** Parse settings text. Corrupt JSON = absent (`null`) so callers fall back and log. */
export const parseSettings = (text: string): SettingsFile | null => {
  try {
    return normalizeSettings(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
};

/** Read the settings file; a missing or corrupt file answers `{ version: 1 }` (corrupt is signalled). */
export const readSettingsFile = async (file: string): Promise<{ settings: SettingsFile; corrupt: boolean }> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { settings: { version: SETTINGS_FILE_VERSION }, corrupt: false };
  }
  const parsed = parseSettings(text);
  if (parsed === null) return { settings: { version: SETTINGS_FILE_VERSION }, corrupt: true };
  return { settings: parsed, corrupt: false };
};

/** Atomically write the settings file (tmp + rename), creating its folder. */
export const writeSettingsFile = async (file: string, settings: SettingsFile): Promise<void> => {
  await writeFileAtomic(file, `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`);
};

export type SettingsStoreOptions = {
  log: Logger;
  /** The extension package folder; a root inside it is refused. */
  packageRoot: string;
  /** Test seam: `DC_SETTINGS_PATH` and friends. Defaults to `process.env`. */
  env?: SettingsEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
};

/**
 * The live settings store. `createSettingsStore` reads the file once (corrupt → defaults +
 * a warning); `read()` then answers from cache and `update()` validates, persists atomically
 * and notifies root-change listeners.
 */
export const createSettingsStore = async (options: SettingsStoreOptions): Promise<SettingsStore> => {
  const { log, packageRoot } = options;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const file = settingsFilePath(env, platform, homeDir);

  const initial = await readSettingsFile(file);
  if (initial.corrupt) log.warn('settings.corrupt', { file, message: 'The settings file could not be read; defaults are used.' });
  let current: SettingsFile = initial.settings;

  const rootHost = { platform, env };
  const defaultRoot = defaultDesignsRoot(homeDir, rootHost);
  const rootListeners = new Set<(root: string, previous: string) => void>();
  const rootOf = (candidate: SettingsFile): string =>
    typeof candidate.root === 'string' && candidate.root.trim() !== '' ? path.resolve(candidate.root) : defaultRoot;

  const store: SettingsStore = {
    root: () => rootOf(current),
    defaultRoot: () => defaultRoot,
    read: () => current,
    async update(patch: PutSettingsBody): Promise<SettingsFile> {
      const previousRoot = store.root();
      const next: SettingsFile = { ...current };

      let rootChanges = false;
      if (patch.root !== undefined) {
        if (patch.root === null) {
          delete next.root;
        } else {
          const validated = await validateRootCandidate(patch.root, { packageRoot, homeDir, host: rootHost });
          if (!validated.ok) throw new ApiError('bad-path', validated.message);
          next.root = validated.root;
        }
        rootChanges = !sameRoot(rootOf(next), previousRoot);
        // The old root always joins previousRoots on a real switch — even one that looks
        // empty now (a design may land there later, or the count may have failed) — so
        // nothing the user made disappears from the "Switch back" list. Files are NEVER
        // moved (BRIEF: existing designs are not silently moved).
        const nextRoot = rootOf(next);
        const previous = (next.previousRoots ?? []).filter((entry) => !sameRoot(entry, nextRoot) && !sameRoot(entry, previousRoot));
        if (rootChanges) next.previousRoots = [previousRoot, ...previous].slice(0, PREVIOUS_ROOTS_MAX);
        else if (previous.length > 0) next.previousRoots = previous;
        else delete next.previousRoots;
      }
      if (patch.chromePath !== undefined) {
        if (patch.chromePath === null) {
          delete next.chromePath;
        } else {
          const value = patch.chromePath.trim();
          if (value === '' || value.includes('\0') || value.length > SETTINGS_PATH_MAX) {
            throw new ApiError('bad-path', 'That browser path does not work. Give the full path to the browser program.');
          }
          next.chromePath = value;
        }
      }

      // Phase 2.5 §2.9: the default system and the pins arrive validated as a whole; normalizeSettings
      // keeps the valid parts. Deleting a system clears what names it through this same door (§5.1).
      if (patch.systemDefault !== undefined) next.systemDefault = patch.systemDefault;
      if (patch.systemPins !== undefined) next.systemPins = patch.systemPins;

      try {
        await writeSettingsFile(file, next);
      } catch (error) {
        throw new ApiError('internal', `Could not save the settings file: ${error instanceof Error ? error.message : String(error)}`);
      }
      current = normalizeSettings(next);
      if (rootChanges) {
        const newRoot = store.root();
        log.info('settings.root-changed', { from: previousRoot, to: newRoot });
        for (const listener of [...rootListeners]) {
          try {
            listener(newRoot, previousRoot);
          } catch (error) {
            log.error('settings.root-listener-failed', { error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      return current;
    },
    onRootChange(listener) {
      rootListeners.add(listener);
      return () => rootListeners.delete(listener);
    },
  };
  return store;
};
