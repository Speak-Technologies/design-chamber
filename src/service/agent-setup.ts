// How agents find Design Chamber without a slash command (documentation/specs/
// agent-guidance-and-pages.md §3.3, §3.4): the guide the service keeps at `<root>/AGENTS.md`,
// and the `design-chamber` OpenCode skill the user installs from Settings.
//
// Ownership (D6): both files carry a marker with a content hash (src/shared/agent/ownership.ts).
// The service rewrites only its own unedited file. A file without the marker, an edited one, a
// symlink or anything that is not a regular file is never written. The final compare + rename
// is synchronous (`replaceFileIfUnchanged`), so a user edit that lands mid-write is kept.
//
// The skill is the one write outside the designs root. Its path is fixed (`skillTarget`, no
// request input), it happens only from `POST /agent/skill` (the user's click), and the leaf
// `design-chamber` folder and `SKILL.md` must not be symlinks. Symlinks above `skills/` are the
// user's own setup (a dotfiles repo) and are followed; Settings shows the real path.

import { readFileSync } from 'node:fs';
import { lstat, mkdir, open, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildAgentGuide, buildRetiredGuide, buildSkillDoc, GUIDE_FILE, SKILL_NAME } from '../shared/agent/guide.ts';
import { findOwnershipMarker, ownershipHash } from '../shared/agent/ownership.ts';
import type { AgentGuideStatus, AgentSkillStatus, ChangeEvent } from '../shared/types.ts';
import type { ChangeHub, Logger, SettingsStore } from './context.ts';
import { ApiError } from './http.ts';
import { replaceFileIfUnchanged, resolveInside, type PathModule } from './paths.ts';
import { folderErrorSentence, isDirectory } from './root.ts';

/** Our files are a few kB; anything bigger is read only this far, which can never verify (so: edited or foreign). */
const OWNED_FILE_READ_MAX = 64 * 1024;
/** `added` events come in bursts while an agent creates folders. */
export const GUIDE_SYNC_DEBOUNCE_MS = 2000;
const RENAME_ATTEMPTS = 4;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Ownership (pure) ----

export type OwnedFileState = 'missing' | 'current' | 'outdated' | 'edited' | 'foreign';

/**
 * Classify a file Design Chamber may own against the text it would write now.
 * No marker → `foreign`; a damaged marker or a hash that does not match → `edited`;
 * verified and byte-equal → `current`; verified but different → `outdated`.
 */
export const ownedFileState = (text: string | null, expected: string): OwnedFileState => {
  if (text === null) return 'missing';
  const marker = findOwnershipMarker(text);
  if (marker.kind === 'none') return 'foreign';
  if (marker.kind === 'damaged' || marker.hex !== ownershipHash(text)) return 'edited';
  return text === expected ? 'current' : 'outdated';
};

// ---- Skill target (pure) ----

export type SkillEnv = { XDG_CONFIG_HOME?: string };
export type SkillTarget = { file: string; dir: string; duplicates: string[] };

/**
 * Where the skill goes (D7): `<XDG_CONFIG_HOME or ~/.config>/opencode/skills/design-chamber/SKILL.md`
 * on every OS. `XDG_CONFIG_HOME` counts only when it is absolute and NUL-free. `duplicates` are
 * the other places OpenCode loads a skill of the same name from; they are read, never written.
 */
export const skillTarget = (env: SkillEnv, homeDir: string, p: PathModule = path): SkillTarget => {
  const xdg = env.XDG_CONFIG_HOME;
  const cfg = typeof xdg === 'string' && xdg.trim() !== '' && !xdg.includes('\0') && p.isAbsolute(xdg) ? xdg : p.join(homeDir, '.config');
  const dir = p.join(cfg, 'opencode', 'skills', SKILL_NAME);
  return {
    dir,
    file: p.join(dir, 'SKILL.md'),
    duplicates: [p.join(homeDir, '.claude', 'skills', SKILL_NAME, 'SKILL.md'), p.join(homeDir, '.agents', 'skills', SKILL_NAME, 'SKILL.md')],
  };
};

// ---- File reads ----

/** `null` when absent, `'not-a-file'` for a symlink, folder or device; otherwise at most `OWNED_FILE_READ_MAX` bytes of text. */
const readOwnedFile = async (file: string): Promise<string | null | 'not-a-file'> => {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR') return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) return 'not-a-file';
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(info.size, OWNED_FILE_READ_MAX));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
};

/** The text on disk right now, the way `replaceFileIfUnchanged` reads it (`undefined` = unreadable). */
const currentText = (file: string): string | null | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    return codeOf(error) === 'ENOENT' ? null : undefined;
  }
};

/**
 * Replace `file` with `data` only while it still holds `expected` (`null` = absent). Windows can
 * refuse the rename while another program has the file open, so a refusal with unchanged content
 * is retried a few times. Answers false when someone else changed the file first.
 */
const replaceOwnedFile = async (file: string, expected: string | null, data: string): Promise<boolean> => {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    if (await replaceFileIfUnchanged(file, expected, data)) return true;
    if (currentText(file) !== expected) return false;
    await sleep(40 * attempt);
  }
  throw Object.assign(new Error('The file stayed locked by another program.'), { code: 'EBUSY' });
};

/**
 * `dir` with symlinks resolved as far as it exists, the missing rest appended: the skill path
 * Settings shows, so a symlinked `~/.config/opencode` (a dotfiles repo) is visible before and
 * after the install. The leaf `design-chamber` folder is not resolved (a symlink there is foreign).
 */
const realpathAsFarAsItExists = async (dir: string): Promise<string> => {
  const rest: string[] = [];
  let current = dir;
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest);
    } catch (error) {
      const parent = path.dirname(current);
      if ((codeOf(error) !== 'ENOENT' && codeOf(error) !== 'ENOTDIR') || parent === current) return dir;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
};

// ---- The module ----

export type AgentSetupOptions = {
  log: Logger;
  settings: Pick<SettingsStore, 'root' | 'onRootChange'>;
  /** `XDG_CONFIG_HOME`; defaults to `process.env`. Tests point it (and `homeDir`) at a tmp folder. */
  env?: SkillEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

export type AgentSetup = {
  /** Read-only classification of the guide in `root` (GET /settings). Never throws. */
  guideStatus(root: string): Promise<AgentGuideStatus>;
  /** Write or refresh the guide in the current root when it is ours (or missing). Serialised; never throws. */
  syncGuide(): Promise<AgentGuideStatus>;
  /** Retire our guide in `previous`, then sync the one in `root` (wired to `settings.onRootChange`). Never throws. */
  rootChanged(root: string, previous: string): Promise<void>;
  /** Read-only skill status (GET /settings). Never throws. */
  skillStatus(): Promise<AgentSkillStatus>;
  /** Install or update the skill. Only `POST /agent/skill` calls this. 409 for foreign/edited, 500 on a write failure. */
  installSkill(options: { replaceEdited: boolean }): Promise<AgentSkillStatus>;
  /** Start syncing: once now (after `ready`), on root changes, and on `added` events (debounced). Answers the stop function. */
  start(deps: { hub: Pick<ChangeHub, 'subscribe'>; ready: Promise<void>; debounceMs?: number }): () => void;
  /** Settles when every queued guide write has finished (tests and shutdown). */
  idle(): Promise<void>;
};

export const createAgentSetup = (options: AgentSetupOptions): AgentSetup => {
  const { log, settings } = options;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const target = skillTarget(env, homeDir);
  const loggedOnce = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  /** Run `task` after every earlier guide task; a failure is logged and never breaks the chain. */
  const enqueue = <T>(task: () => Promise<T>, fallback: T): Promise<T> => {
    const run = queue.then(task).catch((error: unknown) => {
      log.error('agent.guide-task-failed', { error: errorText(error) });
      return fallback;
    });
    queue = run;
    return run;
  };

  const logOnce = (state: string, file: string): void => {
    const key = `${state}\0${file}`;
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    log.info('agent.guide-left-alone', { state, path: file });
  };

  const builderFailure = (what: 'guide' | 'skill'): string =>
    `Design Chamber could not write the ${what} because your designs folder path is too long or contains an unusual character.`;

  /** Classify (and with `write`, create or refresh) the guide in `root`. */
  const syncGuideIn = async (root: string, write: boolean): Promise<AgentGuideStatus> => {
    const shown = path.join(root, GUIDE_FILE);
    try {
      if (!(await isDirectory(root))) return { path: shown, state: 'no-root' };
      let expected: string;
      try {
        expected = buildAgentGuide({ root, platform });
      } catch {
        return { path: shown, state: 'failed', message: builderFailure('guide') };
      }
      // The guide's own name, under the realpath'd root, NOT followed: a symlinked AGENTS.md is the user's.
      const realRoot = await resolveInside(root, []);
      const file = path.join(realRoot, GUIDE_FILE);
      const text = await readOwnedFile(file);
      if (text === 'not-a-file') {
        if (write) logOnce('foreign', file);
        return { path: shown, state: 'foreign' };
      }
      const state = ownedFileState(text, expected);
      if (state === 'edited' || state === 'foreign') {
        if (write) logOnce(state, file);
        return { path: shown, state };
      }
      if (state === 'current' || !write) return { path: shown, state };
      // Containment for the write itself (the name is fixed; this still refuses a root that moved out from under us).
      await resolveInside(root, [GUIDE_FILE]);
      if (!(await replaceOwnedFile(file, text, expected))) {
        log.info('agent.guide-changed-while-writing', { path: file });
        return syncGuideIn(root, false);
      }
      log.info('agent.guide-written', { path: file, was: state });
      return { path: shown, state: 'current' };
    } catch (error) {
      log.warn('agent.guide-failed', { path: shown, code: codeOf(error) ?? null, error: errorText(error) });
      return { path: shown, state: 'failed', message: folderErrorSentence(error, root, { platform, homeDir }) };
    }
  };

  /** Our unedited guide in a previous root now points at the new one; anything else there is left alone. */
  const retireGuideIn = async (oldRoot: string, newRoot: string): Promise<void> => {
    try {
      if (!(await isDirectory(oldRoot))) return;
      const realRoot = await resolveInside(oldRoot, []);
      const file = path.join(realRoot, GUIDE_FILE);
      const text = await readOwnedFile(file);
      if (text === null || text === 'not-a-file') return;
      const retired = buildRetiredGuide({ oldRoot, newRoot });
      const state = ownedFileState(text, retired);
      if (state !== 'outdated') return; // current = already retired to this root; edited/foreign = not ours to change
      if (await replaceOwnedFile(file, text, retired)) log.info('agent.guide-retired', { path: file, to: newRoot });
    } catch (error) {
      log.warn('agent.guide-retire-failed', { root: oldRoot, code: codeOf(error) ?? null, error: errorText(error) });
    }
  };

  /** Duplicates that exist and are not the target itself seen through a symlink. */
  const duplicatesOf = async (): Promise<string[]> => {
    const targetReal = await realpath(target.file).catch(() => null);
    const found: string[] = [];
    for (const candidate of target.duplicates) {
      const exists = await stat(candidate).then(() => true, () => false);
      if (!exists) continue;
      const real = await realpath(candidate).catch(() => candidate);
      if (targetReal !== null && real === targetReal) continue;
      found.push(candidate);
    }
    return found;
  };

  /** The skill's state plus what `installSkill` needs: the text on disk and the text to write. */
  const classifySkill = async (): Promise<{ status: AgentSkillStatus; onDisk: string | null; expected: string | null }> => {
    let shown = target.file;
    let duplicates: string[] = [];
    try {
      duplicates = await duplicatesOf();
      const dirInfo = await lstat(target.dir).catch((error: unknown) => {
        if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR') return null;
        throw error;
      });
      shown = path.join(await realpathAsFarAsItExists(path.dirname(target.dir)), SKILL_NAME, 'SKILL.md');
      if (dirInfo !== null && (dirInfo.isSymbolicLink() || !dirInfo.isDirectory())) {
        return { status: { path: shown, state: 'foreign', duplicates }, onDisk: null, expected: null };
      }
      const root = settings.root();
      let expected: string;
      try {
        expected = buildSkillDoc({ root, guidePath: path.join(root, GUIDE_FILE) });
      } catch {
        return { status: { path: shown, state: 'unavailable', duplicates, message: builderFailure('skill') }, onDisk: null, expected: null };
      }
      const text = dirInfo === null ? null : await readOwnedFile(target.file);
      if (text === 'not-a-file') return { status: { path: shown, state: 'foreign', duplicates }, onDisk: null, expected };
      const owned = ownedFileState(text, expected);
      const state = owned === 'missing' ? 'not-installed' : owned;
      return { status: { path: shown, state, duplicates }, onDisk: text, expected };
    } catch (error) {
      log.warn('agent.skill-status-failed', { code: codeOf(error) ?? null, error: errorText(error) });
      return {
        status: { path: shown, state: 'unavailable', duplicates, message: folderErrorSentence(error, target.dir, { platform, homeDir }) },
        onDisk: null,
        expected: null,
      };
    }
  };

  const setup: AgentSetup = {
    guideStatus: (root) => syncGuideIn(root, false),

    syncGuide: () => enqueue(() => syncGuideIn(settings.root(), true), { path: path.join(settings.root(), GUIDE_FILE), state: 'failed' }),

    rootChanged: (root, previous) =>
      enqueue(async () => {
        await retireGuideIn(previous, root);
        await syncGuideIn(root, true);
      }, undefined),

    skillStatus: async () => (await classifySkill()).status,

    async installSkill({ replaceEdited }) {
      const { status, onDisk, expected } = await classifySkill();
      if (status.state === 'foreign') {
        throw new ApiError('conflict', `A different skill called design-chamber is already at ${status.path}, so Design Chamber left it alone.`);
      }
      if (status.state === 'edited' && !replaceEdited) {
        throw new ApiError('conflict', 'You changed this skill. Replace it with Design Chamber\'s version?');
      }
      if (status.state === 'unavailable' || expected === null) {
        throw new ApiError('internal', status.message ?? 'Design Chamber could not read OpenCode\'s skills folder.');
      }
      if (status.state === 'current') return status;

      try {
        await mkdir(target.dir, { recursive: true });
        // Symlinks above skills/ are the user's own setup; the leaf folder itself must be real.
        const dirInfo = await lstat(target.dir);
        if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
          throw new ApiError('conflict', `A different skill called design-chamber is already at ${status.path}, so Design Chamber left it alone.`);
        }
        if (!(await replaceOwnedFile(target.file, onDisk, expected))) {
          throw new ApiError('conflict', 'The skill file changed while Design Chamber was writing it. Try again.');
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        log.warn('agent.skill-install-failed', { code: codeOf(error) ?? null, error: errorText(error) });
        throw new ApiError('internal', folderErrorSentence(error, target.dir, { platform, homeDir }));
      }
      const fresh = (await classifySkill()).status;
      log.info('agent.skill-installed', { path: fresh.path, was: status.state });
      return fresh;
    },

    start({ hub, ready, debounceMs = GUIDE_SYNC_DEBOUNCE_MS }) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      void ready.then(
        () => {
          if (!stopped) void setup.syncGuide();
        },
        (error: unknown) => log.warn('agent.guide-start-skipped', { error: errorText(error) }),
      );
      const offRoot = settings.onRootChange((root, previous) => {
        if (!stopped) void setup.rootChanged(root, previous);
      });
      const offHub = hub.subscribe((event: ChangeEvent) => {
        if (stopped || event.kind !== 'added') return;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (!stopped) void setup.syncGuide();
        }, debounceMs);
      });
      return () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        offRoot();
        offHub();
      };
    },

    idle: async () => {
      // A task may enqueue another while we wait: settle only once the chain stops growing.
      for (;;) {
        const current = queue;
        await current.catch(() => undefined);
        if (current === queue) return;
      }
    },
  };
  return setup;
};
