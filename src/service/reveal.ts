// "Show in folder" (docs/SPEC.md §4.3, §9.5): opens the OS file manager on a path the service
// itself issued this run (an export) or on a design folder — never anywhere else. Every
// command is spawned with an args array (no shell), so no path is ever interpolated.
//
//   win32   explorer.exe /select,<path>   fire-and-forget: explorer exits non-zero even on success
//   darwin  open -R <path>                fire-and-forget
//   linux   xdg-open <dir> → gio open <dir> → FileManager1.ShowItems over D-Bus (gdbus), the
//           next one tried only when the previous could not start or exited non-zero.
//
// The service env is an allowlist (F9: no DISPLAY, WAYLAND_DISPLAY or DBUS_SESSION_BUS_ADDRESS),
// so on Linux the session bus and Wayland socket are re-derived from XDG_RUNTIME_DIR, which is
// passed — that is how the desktop's file manager is reached from a headless child process.
//
// Phase 2.5 (§3.5, T12b): the system form `{ system, target }` takes no path. The service derives it
// from the system's state: `folder` = `_systems/<id>/`, `repo` = `<repo>/<folder>`, `living-page` =
// the committed file (its folder opened, the file selected). Read-only: nothing is created or written.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_DIRECTORY_MAX, SYSTEM_ID_PATTERN } from '../shared/limits.ts';
import type { SystemState } from '../shared/types.ts';
import { ApiError } from './http.ts';
import type { DesignStore, Logger } from './context.ts';
import { foldsCase, resolveInside } from './paths.ts';

/** The three places a system's Reveal may open (§3.5); never a path. */
export type SystemRevealTarget = 'folder' | 'repo' | 'living-page';

export const SYSTEM_REVEAL_TARGETS: readonly SystemRevealTarget[] = ['folder', 'repo', 'living-page'];

/** What the system form needs from the system store: the contained folder and the state. */
export type RevealSystems = { dir(id: string): Promise<string>; readState(id: string): Promise<SystemState> };

/** Paths the service wrote this run. Bounded: the oldest issued path is forgotten first. */
export type RevealRegistry = {
  issue(absolutePath: string): void;
  has(absolutePath: string): boolean;
};

const REGISTRY_MAX = 1000;
/** How long a Linux opener may run before it is taken as launched (some stay open with the window). */
const LINUX_OPENER_WAIT_MS = 5000;

/** Comparison form: absolute, separators normalised, case-folded where the filesystem is (win32, darwin). */
const normalizePathKey = (value: string, platform: NodeJS.Platform): string => {
  const resolved = path.resolve(value);
  return foldsCase(platform === 'win32' ? path.win32 : path.posix, platform) ? resolved.toLowerCase() : resolved;
};

export const createRevealRegistry = (platform: NodeJS.Platform = process.platform): RevealRegistry => {
  const issued = new Set<string>();
  return {
    issue(absolutePath: string): void {
      const key = normalizePathKey(absolutePath, platform);
      issued.add(key);
      if (issued.size > REGISTRY_MAX) {
        const oldest = issued.values().next();
        if (!oldest.done) issued.delete(oldest.value);
      }
    },
    has: (absolutePath: string) => issued.has(normalizePathKey(absolutePath, platform)),
  };
};

/** One command in a reveal plan. `wait`: the outcome decides whether the next command runs. */
export type RevealCommand = { command: string; args: string[]; wait: boolean };

/**
 * Starts `command`. With `wait`, resolves true once it exited 0 (or is still running after
 * the grace period — it launched), false when it could not start or exited non-zero.
 * Without `wait`, resolves true at once.
 */
export type LaunchFn = (step: RevealCommand, env: NodeJS.ProcessEnv) => Promise<boolean>;

const defaultLaunch: LaunchFn = (step, env) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const child = spawn(step.command, step.args, { detached: true, stdio: 'ignore', env });
    child.on('error', () => finish(false)); // ENOENT: this opener is not installed
    child.unref();
    if (!step.wait) {
      finish(true);
      return;
    }
    child.on('exit', (code) => finish(code === 0));
    setTimeout(() => finish(true), LINUX_OPENER_WAIT_MS).unref();
  });

/** A D-Bus string-array literal holding one file URI; `'` is percent-encoded so the literal cannot be broken. */
const showItemsArg = (target: string): string => `['${pathToFileURL(target).href.replace(/'/g, '%27')}']`;

/** The commands to try, in order, for one resolved path. */
export const revealPlan = (resolved: string, platform: NodeJS.Platform): RevealCommand[] => {
  if (platform === 'win32') return [{ command: 'explorer.exe', args: [`/select,${resolved}`], wait: false }];
  if (platform === 'darwin') return [{ command: 'open', args: ['-R', resolved], wait: false }];
  const dir = path.dirname(resolved);
  return [
    { command: 'xdg-open', args: [dir], wait: true },
    { command: 'gio', args: ['open', dir], wait: true },
    {
      command: 'gdbus',
      args: [
        'call',
        '--session',
        '--dest',
        'org.freedesktop.FileManager1',
        '--object-path',
        '/org/freedesktop/FileManager1',
        '--method',
        'org.freedesktop.FileManager1.ShowItems',
        showItemsArg(resolved),
        '',
      ],
      wait: true,
    },
  ];
};

/**
 * The env a Linux opener needs to reach the user's desktop: the allowlisted service env plus
 * the session bus (`$XDG_RUNTIME_DIR/bus`) and the Wayland socket (`wayland-0`) when they exist
 * and the variables are not already set. Nothing is guessed for X11 (no DISPLAY): the X
 * authority file is not passed either, so a guessed display would not authenticate.
 */
export const linuxOpenerEnv = (env: NodeJS.ProcessEnv, exists: (file: string) => boolean = existsSync): NodeJS.ProcessEnv => {
  const next: NodeJS.ProcessEnv = { ...env };
  const runtimeDir = env.XDG_RUNTIME_DIR;
  if (typeof runtimeDir !== 'string' || !path.posix.isAbsolute(runtimeDir)) return next;
  const bus = path.posix.join(runtimeDir, 'bus');
  if (!next.DBUS_SESSION_BUS_ADDRESS && exists(bus)) next.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;
  if (!next.WAYLAND_DISPLAY && exists(path.posix.join(runtimeDir, 'wayland-0'))) next.WAYLAND_DISPLAY = 'wayland-0';
  return next;
};

export type RevealDeps = {
  store: DesignStore;
  log: Logger;
  registry: RevealRegistry;
  /** The system form's source; without it the form answers bad-path. */
  systems?: RevealSystems;
  /** Injectable for tests. */
  launch?: LaunchFn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

export type RevealService = {
  /** Throws `bad-path` for anything the service did not issue and that is not a design folder. */
  reveal(requested: string): Promise<void>;
  /** True when the path may be revealed (export issued this run, or a design folder). */
  mayReveal(requested: string): Promise<boolean>;
  /** The system form: the path is derived from the system's state, never taken from the caller. */
  revealSystem(id: unknown, target: unknown): Promise<void>;
};

export const createRevealService = (deps: RevealDeps): RevealService => {
  const platform = deps.platform ?? process.platform;
  const launch = deps.launch ?? defaultLaunch;

  const isDesignFolder = async (normalized: string): Promise<boolean> => {
    const designs = await deps.store.list().catch(() => []);
    for (const design of designs) {
      const dir = await deps.store.dir(design.slug).catch(() => null);
      if (dir !== null && normalizePathKey(dir, platform) === normalized) return true;
    }
    return false;
  };

  const check = async (requested: unknown): Promise<string> => {
    if (typeof requested !== 'string' || requested.trim() === '' || requested.length > PROJECT_DIRECTORY_MAX) {
      throw new ApiError('bad-path', 'That is not a path Design Chamber can open.');
    }
    if (requested.includes('\u0000')) throw new ApiError('bad-path', 'That is not a path Design Chamber can open.');
    const resolved = path.resolve(requested);
    const normalized = normalizePathKey(resolved, platform);
    if (deps.registry.has(normalized) || (await isDesignFolder(normalized))) return resolved;
    throw new ApiError('bad-path', 'Design Chamber only opens the folders and export files it created itself.');
  };

  const open = async (resolved: string): Promise<void> => {
    const baseEnv = deps.env ?? process.env;
    const env = platform === 'win32' || platform === 'darwin' ? baseEnv : linuxOpenerEnv(baseEnv);
    const tried: string[] = [];
    for (const step of revealPlan(resolved, platform)) {
      tried.push(step.command);
      if (await launch(step, env)) return;
    }
    deps.log.warn('reveal.no-file-manager', { tried: tried.join(', ') });
    throw new ApiError(
      'internal',
      `Design Chamber could not open a file manager. The file is at ${resolved}. Open it yourself, or install xdg-utils so "Show in folder" works.`,
    );
  };

  /** The path a system target names, derived from state and contained; it must exist as that kind. */
  const systemTarget = async (id: unknown, target: unknown): Promise<string> => {
    if (typeof id !== 'string' || !SYSTEM_ID_PATTERN.test(id)) throw new ApiError('bad-slug', 'That is not a design system id.');
    if (typeof target !== 'string' || !(SYSTEM_REVEAL_TARGETS as readonly string[]).includes(target)) {
      throw new ApiError('bad-request', 'Reveal opens a design system\'s folder, its repo folder or its living page.');
    }
    const systems = deps.systems;
    if (systems === undefined) throw new ApiError('bad-path', 'That is not a path Design Chamber can open.');
    const systemDir = await systems.dir(id); // 404 when gone, bad-slug when not an id
    if (target === 'folder') return systemDir;
    const state = await systems.readState(id);
    const home = state.home;
    if (home === undefined || home.kind !== 'repo') throw new ApiError('invalid', `${state.name} lives in Design Chamber, not in a repo.`);
    const repoName = path.basename(home.directory) || home.directory;
    const rel = target === 'repo' ? home.folder : home.livingPage;
    const repoInfo = await lstat(home.directory).catch(() => null);
    if (repoInfo === null || !repoInfo.isDirectory()) throw new ApiError('not-found', `${repoName} isn't at ${home.directory} anymore.`);
    let resolved: string;
    try {
      resolved = await resolveInside(home.directory, rel.split('/'));
    } catch {
      throw new ApiError('bad-path', `That path leaves ${repoName}, so Design Chamber won't open it.`);
    }
    const info = await lstat(resolved).catch(() => null);
    if (target === 'repo') {
      if (info === null || !info.isDirectory()) throw new ApiError('not-found', `${rel} isn't in ${repoName} yet.`);
    } else if (info === null || !info.isFile()) {
      throw new ApiError('not-found', `The living page isn't in ${repoName} yet.`);
    }
    return resolved;
  };

  return {
    async revealSystem(id: unknown, target: unknown): Promise<void> {
      await open(await systemTarget(id, target));
    },
    async mayReveal(requested: string): Promise<boolean> {
      try {
        await check(requested);
        return true;
      } catch {
        return false;
      }
    },
    async reveal(requested: string): Promise<void> {
      const resolved = await check(requested);
      if (!existsSync(resolved)) throw new ApiError('not-found', 'That file does not exist any more.');
      await open(resolved);
    },
  };
};
