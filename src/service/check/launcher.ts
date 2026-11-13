// The launcher scripts (documentation/specs/agent-render-and-check.md §2.1, D2). The agent runs
// `sh <root>/.chamber/bin/dc check <slug>` (or the `.cmd` on Windows); the script bakes in the
// runtime that runs this service (`process.execPath` + `ELECTRON_RUN_AS_NODE`), the CLI path and
// the designs root, so the agent needs no `node` on its PATH. The service writes the scripts and
// never runs them. A file without our marker on line 2 is the user's and is left alone.
//
// Pure: `shQuote`, `cmdQuote`, `buildLaunchers`. Disk: `syncLaunchers`. Wiring: `ensureLauncherService`.

import { chmod, lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { checkCommandFor, shQuote } from '../../shared/agent/check-command.ts';
import type { Logger, ServiceContext } from '../context.ts';
import { foldsCase, resolveInside, writeFileAtomic } from '../paths.ts';
import { ensureNormalFolder } from './output.ts';

export const LAUNCHER_MARKER = 'design-chamber:launcher v1';
const SH_NOTE = 'Written by Design Chamber; rewritten when the extension starts.';

// ---- quoting (pure) ----

const hasControl = (value: string): boolean => /[\u0000-\u001f\u007f]/.test(value);

/** sh value in single quotes, each `'` written `'\''`; `null` for a value holding a control character (NUL, newline…). */
export const quoteSh = (value: string): string | null => (hasControl(value) ? null : shQuote(value));

/** cmd value in double quotes with `%` doubled; `null` for `"` or a control character (cmd has no way to carry them safely). */
export const quoteCmd = (value: string): string | null => (value.includes('"') || hasControl(value) ? null : `"${value.replace(/%/g, '%%')}"`);

export type LauncherInput = { execPath: string; cliPath: string; root: string };
export type Launchers = { sh: string | null; cmd: string | null };

/** The text of both scripts. A script is `null` when one of its values cannot be quoted for that shell. */
export const buildLaunchers = ({ execPath, cliPath, root }: LauncherInput): Launchers => {
  const sh = [quoteSh(execPath), quoteSh(cliPath), quoteSh(root)];
  const cmd = [quoteCmd(execPath), quoteCmd(cliPath), quoteCmd(root)];
  return {
    sh: sh.some((part) => part === null) ? null : `#!/bin/sh\n# ${LAUNCHER_MARKER}. ${SH_NOTE}\nELECTRON_RUN_AS_NODE=1 exec ${sh[0]} ${sh[1]} --root ${sh[2]} "$@"\n`,
    cmd: cmd.some((part) => part === null)
      ? null
      : `@echo off\r\nrem ${LAUNCHER_MARKER}. ${SH_NOTE}\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n${cmd[0]} ${cmd[1]} --root ${cmd[2]} %*\r\n`,
  };
};

/** Whether `text` is one of our launchers (marker on line 2). */
export const isOurLauncher = (text: string): boolean => (text.split(/\r?\n/)[1] ?? '').includes(LAUNCHER_MARKER);

// ---- disk ----

export type LauncherStatus = 'written' | 'current' | 'foreign' | 'failed' | 'unavailable';

type OneResult = 'written' | 'current' | 'foreign';

const writeOne = async (root: string, name: string, text: string, executable: boolean): Promise<OneResult> => {
  const target = await resolveInside(root, ['.chamber', 'bin', name]);
  const info = await lstat(target).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (info !== null) {
    if (info.isSymbolicLink() || !info.isFile()) return 'foreign';
    const existing = await readFile(target, 'utf8');
    if (existing !== text && !isOurLauncher(existing)) return 'foreign';
    if (existing === text) {
      if (executable) await chmod(target, 0o755).catch(() => undefined);
      return 'current';
    }
  }
  await writeFileAtomic(target, text);
  if (executable) await chmod(target, 0o755);
  return 'written';
};

export type SyncInput = LauncherInput & { log: Logger; platform?: NodeJS.Platform };

/**
 * Write `<root>/.chamber/bin/dc` and `dc.cmd` when their bytes differ. The answer is for the
 * script this platform uses; the other is written too (a synced root may be opened on another OS).
 * Never throws: a failure is logged and answered as `failed`.
 */
export const syncLaunchers = async (input: SyncInput): Promise<LauncherStatus> => {
  const { log, root } = input;
  const platform = input.platform ?? process.platform;
  const own = platform === 'win32' ? 'cmd' : 'sh';
  try {
    if (!(await stat(input.cliPath).then((info) => info.isFile(), () => false))) {
      log.warn('check.launcher-cli-missing', { cliPath: input.cliPath });
      return 'unavailable';
    }
    const launchers = buildLaunchers(input);
    if (launchers[own] === null) {
      log.warn('check.launcher-refused', { shell: own });
      return 'unavailable';
    }
    const chamber = await ensureNormalFolder(root, '.chamber', '.chamber');
    await ensureNormalFolder(chamber, 'bin', '.chamber/bin');
    const results: Partial<Record<'sh' | 'cmd', OneResult>> = {};
    for (const shell of ['sh', 'cmd'] as const) {
      const text = launchers[shell];
      if (text === null) continue;
      try {
        results[shell] = await writeOne(root, shell === 'sh' ? 'dc' : 'dc.cmd', text, shell === 'sh');
      } catch (error) {
        if (shell === own) throw error;
        log.warn('check.launcher-other-failed', { shell, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const result = results[own];
    if (result === 'foreign') log.info('check.launcher-foreign', { shell: own });
    else if (result === 'written') log.info('check.launcher-written', { shell: own });
    return result ?? 'failed';
  } catch (error) {
    log.warn('check.launcher-failed', { code: (error as NodeJS.ErrnoException | null)?.code ?? null, error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
};

// ---- the service wiring ----

export type LauncherService = {
  /** Write the launchers for `root` once (memoised per root); answers this platform's status. */
  ensure(root: string): Promise<LauncherStatus>;
  /** The command an agent runs for `slug` in `root`, or `null` when the launcher is not in place. */
  commandFor(root: string, slug: string): Promise<string | null>;
  /** Forget what was synced (a root changed back, or the launcher was removed): the next `ensure` writes again. */
  forget(root?: string): void;
};

export type LauncherDeps = {
  log: Logger;
  execPath?: string;
  cliPath: string;
  platform?: NodeJS.Platform;
};

export const createLauncherService = (deps: LauncherDeps): LauncherService => {
  const platform = deps.platform ?? process.platform;
  const execPath = deps.execPath ?? process.execPath;
  const synced = new Map<string, Promise<LauncherStatus>>();
  const caseFolds = foldsCase(platform === 'win32' ? path.win32 : path.posix, platform);
  const keyOf = (root: string): string => (caseFolds ? root.toLowerCase() : root);
  const ensure = (root: string): Promise<LauncherStatus> => {
    const key = keyOf(root);
    const known = synced.get(key);
    if (known !== undefined) return known;
    const run = syncLaunchers({ execPath, cliPath: deps.cliPath, root, log: deps.log, platform });
    synced.set(key, run);
    return run;
  };
  return {
    ensure,
    async commandFor(root, slug) {
      const status = await ensure(root);
      return status === 'written' || status === 'current' ? checkCommandFor({ root, slug, platform }) : null;
    },
    forget(root) {
      if (root === undefined) synced.clear();
      else synced.delete(keyOf(root));
    },
  };
};

const instances = new WeakMap<ServiceContext, LauncherService>();

/** One launcher service per context (routes, agent setup and compose share it). CLI path: `<package>/dist/cli/dc.mjs`. */
export const ensureLauncherService = (ctx: ServiceContext, override?: Partial<LauncherDeps>): LauncherService => {
  const existing = instances.get(ctx);
  if (existing) return existing;
  const created = createLauncherService({ log: ctx.log, cliPath: path.join(ctx.packageRoot, 'dist', 'cli', 'dc.mjs'), ...override });
  instances.set(ctx, created);
  return created;
};
