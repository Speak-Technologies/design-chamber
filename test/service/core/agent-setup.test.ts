// The agent guide at <root>/AGENTS.md and the user-clicked `design-chamber` skill
// (documentation/specs/agent-guidance-and-pages.md §3.3, §3.4, §10, task A3).
//
// Ownership is the risk here: Design Chamber must never write over a file the user wrote or
// edited, and the skill is the one write outside the designs root. Every skill test points the
// home folder and XDG_CONFIG_HOME at a tmp folder: nothing here touches the real home.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { createAgentSetup, ownedFileState, skillTarget, type AgentSetup } from '../../../src/service/agent-setup.ts';
import { composeService } from '../../../src/service/compose.ts';
import type { Logger } from '../../../src/service/context.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createSettingsStore } from '../../../src/service/settings.ts';
import { buildAgentGuide, buildRetiredGuide, buildSkillDoc } from '../../../src/shared/agent/guide.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { REPO_ROOT } from './harness.ts';

type LogLine = { level: string; event: string };
const captureLog = (lines: LogLine[] = []): Logger => ({
  info: (event) => void lines.push({ level: 'info', event }),
  warn: (event) => void lines.push({ level: 'warn', event }),
  error: (event) => void lines.push({ level: 'error', event }),
});

const OLD = new Date('2020-01-01T00:00:00Z');

/** Bytes and mtime, so "untouched" means untouched (an identical rewrite still changes the mtime). */
const fingerprint = async (file: string): Promise<{ bytes: string; mtimeMs: number }> => ({
  bytes: await readFile(file, 'utf8'),
  mtimeMs: (await lstat(file)).mtimeMs,
});

const writeOld = async (file: string, text: string): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  await utimes(file, OLD, OLD);
};

/** A settings stand-in whose root the test moves by hand. */
const fakeSettings = (initial: string) => {
  let root = initial;
  const listeners = new Set<(root: string, previous: string) => void>();
  return {
    root: () => root,
    onRootChange: (listener: (root: string, previous: string) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    move(next: string) {
      const previous = root;
      root = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
};

type Fixture = { tmp: TmpRoot; root: string; home: string; settings: ReturnType<typeof fakeSettings>; agent: AgentSetup; logs: LogLine[] };

const useFixture = async (t: TestContext, options: { xdg?: string; makeRoot?: boolean } = {}): Promise<Fixture> => {
  const tmp = await useTmpRoot(t, 'dc-agent-');
  const root = tmp.at('designs');
  const home = tmp.at('home');
  await mkdir(home, { recursive: true });
  if (options.makeRoot !== false) await mkdir(root, { recursive: true });
  const settings = fakeSettings(root);
  const logs: LogLine[] = [];
  const agent = createAgentSetup({ log: captureLog(logs), settings, env: options.xdg ? { XDG_CONFIG_HOME: options.xdg } : {}, homeDir: home });
  return { tmp, root, home, settings, agent, logs };
};

const guideFor = (root: string): string => buildAgentGuide({ root, platform: process.platform });
const skillFor = (root: string): string => buildSkillDoc({ root, guidePath: path.join(root, 'AGENTS.md') });
const skillFileOf = (home: string): string => path.join(home, '.config', 'opencode', 'skills', 'design-chamber', 'SKILL.md');

const rejectsWith = async (promise: Promise<unknown>, code: string, message?: RegExp): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected an ApiError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
};

const canSymlink = async (t: TestContext, tmp: TmpRoot): Promise<boolean> => {
  try {
    await symlink(tmp.at('nowhere'), tmp.at('probe-link'));
    await rm(tmp.at('probe-link'));
    return true;
  } catch {
    t.skip('this machine cannot create symlinks');
    return false;
  }
};

// ---- ownedFileState (pure) ----

describe('ownedFileState: the ownership rules', () => {
  const root = '/home/you/Documents/Designs';
  const expected = buildAgentGuide({ root, platform: 'linux' });

  test('table: missing, current, outdated, edited, foreign, damaged marker', () => {
    const otherRoot = buildAgentGuide({ root: '/data/designs', platform: 'linux' });
    const editedOne = expected.replace('Write order', 'Write orden');
    const badHex = expected.replace(/sha256:[0-9a-f]{64}/, 'sha256:not-a-hash');
    const rows: [string | null, string][] = [
      [null, 'missing'],
      [expected, 'current'],
      [otherRoot, 'outdated'],
      [buildRetiredGuide({ oldRoot: root, newRoot: '/data/designs' }), 'outdated'],
      [editedOne, 'edited'],
      ['', 'foreign'],
      ['# My own notes about this folder\n', 'foreign'],
      [badHex, 'edited'],
      [expected.slice(0, 100), 'edited'],
    ];
    for (const [text, state] of rows) assert.equal(ownedFileState(text, expected), state, `${state}: ${String(text).slice(0, 40)}`);
  });

  test('skill files follow the same rules', () => {
    const skill = skillFor('/home/you/Documents/Designs');
    assert.equal(ownedFileState(skill, skill), 'current');
    assert.equal(ownedFileState(skillFor('/data/designs'), skill), 'outdated');
    assert.equal(ownedFileState(skill.replace('Work offline', 'Work online'), skill), 'edited');
    assert.equal(ownedFileState('---\nname: design-chamber\ndescription: mine\n---\nMy skill.\n', skill), 'foreign');
  });
});

// ---- skillTarget (pure) ----

describe('skillTarget (§3.4, §10)', () => {
  test('posix: XDG_CONFIG_HOME when absolute, else ~/.config; duplicates in ~/.claude and ~/.agents', () => {
    const p = path.posix;
    assert.deepEqual(skillTarget({}, '/home/you', p), {
      dir: '/home/you/.config/opencode/skills/design-chamber',
      file: '/home/you/.config/opencode/skills/design-chamber/SKILL.md',
      duplicates: ['/home/you/.claude/skills/design-chamber/SKILL.md', '/home/you/.agents/skills/design-chamber/SKILL.md'],
    });
    assert.equal(skillTarget({ XDG_CONFIG_HOME: '/xdg' }, '/home/you', p).file, '/xdg/opencode/skills/design-chamber/SKILL.md');
    assert.equal(skillTarget({ XDG_CONFIG_HOME: 'relative/cfg' }, '/home/you', p).file, '/home/you/.config/opencode/skills/design-chamber/SKILL.md', 'relative XDG is ignored');
    assert.equal(skillTarget({ XDG_CONFIG_HOME: '/xdg\0/evil' }, '/home/you', p).file, '/home/you/.config/opencode/skills/design-chamber/SKILL.md', 'XDG with NUL is ignored');
    assert.equal(skillTarget({ XDG_CONFIG_HOME: '' }, '/home/you', p).file, '/home/you/.config/opencode/skills/design-chamber/SKILL.md');
  });

  test('win32: %USERPROFILE%\\.config\\opencode\\skills, same rule', () => {
    const p = path.win32;
    const target = skillTarget({}, 'C:\\Users\\x', p);
    assert.equal(target.file, 'C:\\Users\\x\\.config\\opencode\\skills\\design-chamber\\SKILL.md');
    assert.equal(target.dir, 'C:\\Users\\x\\.config\\opencode\\skills\\design-chamber');
    assert.deepEqual(target.duplicates, ['C:\\Users\\x\\.claude\\skills\\design-chamber\\SKILL.md', 'C:\\Users\\x\\.agents\\skills\\design-chamber\\SKILL.md']);
    assert.equal(skillTarget({ XDG_CONFIG_HOME: 'D:\\cfg' }, 'C:\\Users\\x', p).file, 'D:\\cfg\\opencode\\skills\\design-chamber\\SKILL.md');
    assert.equal(skillTarget({ XDG_CONFIG_HOME: 'cfg' }, 'C:\\Users\\x', p).file, target.file, 'relative XDG is ignored');
  });
});

// ---- The guide ----

describe('guide at <root>/AGENTS.md (§3.3)', () => {
  test('written into an existing root; a second sync writes nothing', async (t) => {
    const { root, agent } = await useFixture(t);
    const file = path.join(root, 'AGENTS.md');
    assert.equal((await agent.guideStatus(root)).state, 'missing');
    assert.equal(existsSync(file), false, 'guideStatus is read-only');

    assert.deepEqual(await agent.syncGuide(), { path: file, state: 'current' });
    assert.equal(await readFile(file, 'utf8'), guideFor(root));
    await utimes(file, OLD, OLD);
    const before = await fingerprint(file);
    assert.equal((await agent.syncGuide()).state, 'current');
    assert.deepEqual(await fingerprint(file), before, 'an up-to-date guide is not rewritten');
  });

  test('never creates a missing root for the guide', async (t) => {
    const { root, agent } = await useFixture(t, { makeRoot: false });
    assert.equal((await agent.syncGuide()).state, 'no-root');
    assert.equal((await agent.guideStatus(root)).state, 'no-root');
    assert.equal(existsSync(root), false);
  });

  test('an outdated guide of ours is rewritten', async (t) => {
    const { root, agent } = await useFixture(t);
    const file = path.join(root, 'AGENTS.md');
    await writeOld(file, guideFor('/somewhere/else'));
    assert.equal((await agent.guideStatus(root)).state, 'outdated');
    assert.equal((await agent.syncGuide()).state, 'current');
    assert.equal(await readFile(file, 'utf8'), guideFor(root));
  });

  test('an edited guide is left alone (bytes and mtime), even when emptied', async (t) => {
    const { root, agent, logs } = await useFixture(t);
    const file = path.join(root, 'AGENTS.md');
    for (const text of [guideFor(root).replace('Write order', 'My write order'), guideFor(root).split('\n')[0] ?? '']) {
      await writeOld(file, text);
      const before = await fingerprint(file);
      assert.equal((await agent.syncGuide()).state, 'edited');
      assert.equal((await agent.syncGuide()).state, 'edited');
      assert.deepEqual(await fingerprint(file), before);
    }
    assert.equal(logs.filter((line) => line.event === 'agent.guide-left-alone').length, 1, 'logged once per process');
  });

  test('the user\'s own AGENTS.md (no marker) is left alone', async (t) => {
    const { root, agent } = await useFixture(t);
    const file = path.join(root, 'AGENTS.md');
    await writeOld(file, '# Notes for my agents\nSave designs wherever.\n');
    const before = await fingerprint(file);
    assert.equal((await agent.syncGuide()).state, 'foreign');
    assert.deepEqual(await fingerprint(file), before);
  });

  test('a symlinked AGENTS.md is left alone, wherever it points', async (t) => {
    const { tmp, root, agent } = await useFixture(t);
    if (!(await canSymlink(t, tmp))) return;
    // One link to a file inside the root holding an outdated guide of ours, one to a file outside it.
    const inside = path.join(root, 'notes.md');
    await writeOld(inside, guideFor('/somewhere/else'));
    await symlink(inside, path.join(root, 'AGENTS.md'));
    const insideBefore = await fingerprint(inside);
    assert.equal((await agent.syncGuide()).state, 'foreign');
    assert.deepEqual(await fingerprint(inside), insideBefore);
    assert.ok((await lstat(path.join(root, 'AGENTS.md'))).isSymbolicLink());

    await rm(path.join(root, 'AGENTS.md'));
    const outside = tmp.at('outside.md');
    await writeOld(outside, guideFor('/somewhere/else'));
    await symlink(outside, path.join(root, 'AGENTS.md'));
    const outsideBefore = await fingerprint(outside);
    assert.equal((await agent.syncGuide()).state, 'foreign');
    assert.deepEqual(await fingerprint(outside), outsideBefore);
  });

  test('a folder named AGENTS.md is left alone', async (t) => {
    const { root, agent } = await useFixture(t);
    await mkdir(path.join(root, 'AGENTS.md'));
    assert.equal((await agent.syncGuide()).state, 'foreign');
    assert.ok((await stat(path.join(root, 'AGENTS.md'))).isDirectory());
  });

  test('a differently-cased agents.md on a case-insensitive drive is left alone', async (t) => {
    const { tmp, root, agent } = await useFixture(t);
    await writeFile(tmp.at('case-probe'), '');
    if (!existsSync(tmp.at('CASE-PROBE'))) {
      t.skip('this filesystem is case-sensitive');
      return;
    }
    const file = path.join(root, 'agents.md');
    await writeOld(file, '# lower-case notes\n');
    const before = await fingerprint(file);
    assert.equal((await agent.syncGuide()).state, 'foreign');
    assert.deepEqual(await fingerprint(file), before);
  });

  test('a root with a control character answers failed with a sentence and writes nothing', async (t) => {
    const { tmp, agent, settings } = await useFixture(t);
    const bad = tmp.at('bad\nroot');
    await mkdir(bad, { recursive: true });
    settings.move(bad);
    const status = await agent.syncGuide();
    assert.equal(status.state, 'failed');
    assert.match(status.message ?? '', /unusual character/);
    assert.equal(existsSync(path.join(bad, 'AGENTS.md')), false);
  });

  test('root change retires our guide in the old root; switching back restores it', async (t) => {
    const tmp = await useTmpRoot(t, 'dc-agent-');
    const rootA = tmp.at('root-a');
    const rootB = tmp.at('root-b');
    await mkdir(rootA, { recursive: true });
    const settingsFile = tmp.at('settings.json');
    await writeFile(settingsFile, JSON.stringify({ version: 1, root: rootA }), 'utf8');
    const settings = await createSettingsStore({ log: captureLog(), packageRoot: REPO_ROOT, env: { DC_SETTINGS_PATH: settingsFile }, homeDir: tmp.at('home') });
    const agent = createAgentSetup({ log: captureLog(), settings, env: {}, homeDir: tmp.at('home') });
    const stop = agent.start({ hub: { subscribe: () => () => undefined }, ready: Promise.resolve() });
    t.after(stop);
    await new Promise((resolve) => setImmediate(resolve));
    await agent.idle();
    assert.equal(await readFile(path.join(rootA, 'AGENTS.md'), 'utf8'), guideFor(rootA), 'written at start');

    await settings.update({ root: rootB });
    await agent.idle();
    assert.equal(await readFile(path.join(rootA, 'AGENTS.md'), 'utf8'), buildRetiredGuide({ oldRoot: rootA, newRoot: rootB }));
    assert.equal(await readFile(path.join(rootB, 'AGENTS.md'), 'utf8'), guideFor(rootB));

    await settings.update({ root: rootA });
    await agent.idle();
    assert.equal(await readFile(path.join(rootA, 'AGENTS.md'), 'utf8'), guideFor(rootA), 'the full guide is back');
    assert.equal(await readFile(path.join(rootB, 'AGENTS.md'), 'utf8'), buildRetiredGuide({ oldRoot: rootB, newRoot: rootA }));
  });

  test('root change leaves an edited or foreign guide in the old root alone', async (t) => {
    const { tmp, root, agent, settings } = await useFixture(t);
    const stop = agent.start({ hub: { subscribe: () => () => undefined }, ready: new Promise(() => undefined) });
    t.after(stop);
    const file = path.join(root, 'AGENTS.md');
    await writeOld(file, guideFor(root).replace('Write order', 'Our write order'));
    const before = await fingerprint(file);
    const next = tmp.at('next');
    await mkdir(next);
    settings.move(next);
    await agent.idle();
    assert.deepEqual(await fingerprint(file), before);
    assert.equal(await readFile(path.join(next, 'AGENTS.md'), 'utf8'), guideFor(next));
  });

  test('an `added` event (the root exists now) writes the guide after the debounce', async (t) => {
    const { root, agent } = await useFixture(t, { makeRoot: false });
    const subscribed: { listener: ((event: ChangeEvent) => void) | null } = { listener: null };
    const stop = agent.start({
      hub: {
        subscribe: (fn) => {
          subscribed.listener = fn;
          return () => void (subscribed.listener = null);
        },
      },
      ready: Promise.resolve(),
      debounceMs: 20,
    });
    t.after(stop);
    await new Promise((resolve) => setImmediate(resolve));
    await agent.idle();
    assert.equal(existsSync(root), false);
    await mkdir(path.join(root, 'first-design'), { recursive: true });
    for (const kind of ['design', 'added', 'added'] as const) subscribed.listener?.({ seq: 1, slug: 'first-design', kind });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await agent.idle();
    assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), guideFor(root));
  });

  test('the composed service writes the guide once the watcher is ready', async (t) => {
    const tmp = await useTmpRoot(t, 'dc-agent-');
    const root = tmp.at('designs');
    await mkdir(root, { recursive: true });
    const settingsPath = tmp.at('settings.json');
    await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
    const service = await composeService({ token: 'agent-test', log: captureLog(), packageRoot: REPO_ROOT, version: '0.0.0-test', env: { DC_SETTINGS_PATH: settingsPath }, homeDir: tmp.at('home') });
    t.after(() => service.dispose());
    const file = path.join(root, 'AGENTS.md');
    for (let waited = 0; waited < 5000 && !existsSync(file); waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(await readFile(file, 'utf8'), guideFor(root));
    assert.equal(existsSync(tmp.at('home/.config/opencode')), false, 'starting never installs the skill');
  });
});

// ---- The skill ----

describe('skill install (§3.4): only on request, never over the user\'s file', () => {
  test('not-installed → install → current; a second install writes nothing', async (t) => {
    const { root, home, agent } = await useFixture(t);
    const file = skillFileOf(home);
    assert.deepEqual(await agent.skillStatus(), { path: file, state: 'not-installed', duplicates: [] });
    assert.equal(existsSync(path.join(home, '.config')), false, 'status is read-only');

    const installed = await agent.installSkill({ replaceEdited: false });
    assert.deepEqual(installed, { path: file, state: 'current', duplicates: [] });
    assert.equal(await readFile(file, 'utf8'), skillFor(root));
    await utimes(file, OLD, OLD);
    const before = await fingerprint(file);
    assert.equal((await agent.installSkill({ replaceEdited: false })).state, 'current');
    assert.deepEqual(await fingerprint(file), before);
  });

  test('a root change turns it outdated (never rewritten on its own); install brings it current', async (t) => {
    const { tmp, home, agent, settings } = await useFixture(t);
    await agent.installSkill({ replaceEdited: false });
    const file = skillFileOf(home);
    await utimes(file, OLD, OLD);
    const before = await fingerprint(file);
    const next = tmp.at('next');
    await mkdir(next);
    settings.move(next);
    await agent.idle();
    assert.equal((await agent.skillStatus()).state, 'outdated');
    assert.deepEqual(await fingerprint(file), before, 'a root change does not touch the skill');
    assert.equal((await agent.installSkill({ replaceEdited: false })).state, 'current');
    assert.equal(await readFile(file, 'utf8'), skillFor(next));
  });

  test('edited → 409 → replaceEdited:true → current', async (t) => {
    const { root, home, agent } = await useFixture(t);
    await agent.installSkill({ replaceEdited: false });
    const file = skillFileOf(home);
    await writeOld(file, skillFor(root).replace('Work offline', 'Work offline, my way'));
    const before = await fingerprint(file);
    assert.equal((await agent.skillStatus()).state, 'edited');
    await rejectsWith(agent.installSkill({ replaceEdited: false }), 'conflict', /You changed this skill/);
    assert.deepEqual(await fingerprint(file), before);
    assert.equal((await agent.installSkill({ replaceEdited: true })).state, 'current');
    assert.equal(await readFile(file, 'utf8'), skillFor(root));
  });

  test('foreign → 409 even with replaceEdited, bytes unchanged', async (t) => {
    const { home, agent } = await useFixture(t);
    const file = skillFileOf(home);
    await writeOld(file, '---\nname: design-chamber\ndescription: my own skill\n---\nMine.\n');
    const before = await fingerprint(file);
    assert.equal((await agent.skillStatus()).state, 'foreign');
    for (const replaceEdited of [false, true]) {
      await rejectsWith(agent.installSkill({ replaceEdited }), 'conflict', /A different skill called design-chamber is already at .*left it alone/);
    }
    assert.deepEqual(await fingerprint(file), before);
  });

  test('a symlinked design-chamber folder is foreign; nothing is written through it', async (t) => {
    const { tmp, home, agent } = await useFixture(t);
    if (!(await canSymlink(t, tmp))) return;
    const elsewhere = tmp.at('elsewhere');
    await mkdir(elsewhere);
    await mkdir(path.join(home, '.config', 'opencode', 'skills'), { recursive: true });
    await symlink(elsewhere, path.join(home, '.config', 'opencode', 'skills', 'design-chamber'), 'dir');
    assert.equal((await agent.skillStatus()).state, 'foreign');
    await rejectsWith(agent.installSkill({ replaceEdited: true }), 'conflict');
    assert.equal(existsSync(path.join(elsewhere, 'SKILL.md')), false);
  });

  test('a symlinked SKILL.md is foreign and left alone', async (t) => {
    const { tmp, root, home, agent } = await useFixture(t);
    if (!(await canSymlink(t, tmp))) return;
    const real = tmp.at('real-skill.md');
    await writeOld(real, skillFor(root));
    await mkdir(path.dirname(skillFileOf(home)), { recursive: true });
    await symlink(real, skillFileOf(home));
    const before = await fingerprint(real);
    assert.equal((await agent.skillStatus()).state, 'foreign');
    await rejectsWith(agent.installSkill({ replaceEdited: true }), 'conflict');
    assert.deepEqual(await fingerprint(real), before);
  });

  test('a symlinked opencode folder above skills/ is the user\'s setup: install works, path is the real one', async (t) => {
    const { tmp, root, home, agent } = await useFixture(t);
    if (!(await canSymlink(t, tmp))) return;
    const dotfiles = tmp.at('dotfiles/opencode');
    await mkdir(dotfiles, { recursive: true });
    await mkdir(path.join(home, '.config'), { recursive: true });
    await symlink(dotfiles, path.join(home, '.config', 'opencode'), 'dir');
    const realFile = path.join(dotfiles, 'skills', 'design-chamber', 'SKILL.md');
    assert.equal((await agent.skillStatus()).path, realFile, 'the real path is shown before the install');
    const installed = await agent.installSkill({ replaceEdited: false });
    assert.equal(installed.state, 'current');
    assert.equal(installed.path, realFile);
    assert.equal(await readFile(realFile, 'utf8'), skillFor(root));
  });

  test('copies in ~/.claude/skills and ~/.agents/skills are listed, never written', async (t) => {
    const { tmp, home, agent } = await useFixture(t);
    const claude = path.join(home, '.claude', 'skills', 'design-chamber', 'SKILL.md');
    await writeOld(claude, 'other copy');
    const before = await fingerprint(claude);
    assert.deepEqual((await agent.skillStatus()).duplicates, [claude]);
    const installed = await agent.installSkill({ replaceEdited: false });
    assert.deepEqual(installed.duplicates, [claude]);
    assert.deepEqual(await fingerprint(claude), before);
    assert.equal(existsSync(path.join(home, '.agents')), false);

    // A ~/.agents/skills that is a link to OpenCode's own skills folder is the same file, not a duplicate.
    if (!(await canSymlink(t, tmp))) return;
    await mkdir(path.join(home, '.agents'), { recursive: true });
    await symlink(path.join(home, '.config', 'opencode', 'skills'), path.join(home, '.agents', 'skills'), 'dir');
    assert.deepEqual((await agent.skillStatus()).duplicates, [claude]);
  });

  test('XDG_CONFIG_HOME (absolute) picks the config folder', async (t) => {
    const tmp = await useTmpRoot(t, 'dc-agent-');
    const xdg = tmp.at('xdg');
    const { home, agent } = await useFixture(t, { xdg });
    const installed = await agent.installSkill({ replaceEdited: false });
    assert.equal(installed.path, path.join(xdg, 'opencode', 'skills', 'design-chamber', 'SKILL.md'));
    assert.equal(existsSync(path.join(home, '.config')), false);
  });

  test('a root with a control character: unavailable with a sentence, install refused, nothing written', async (t) => {
    const { tmp, home, agent, settings } = await useFixture(t);
    settings.move(tmp.at('bad\troot'));
    const status = await agent.skillStatus();
    assert.equal(status.state, 'unavailable');
    assert.match(status.message ?? '', /unusual character/);
    await rejectsWith(agent.installSkill({ replaceEdited: false }), 'internal');
    assert.equal(existsSync(path.join(home, '.config')), false);
  });

  test('an unwritable skills folder answers a sentence, not raw Node text', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async (t) => {
    const { home, agent } = await useFixture(t);
    const skills = path.join(home, '.config', 'opencode', 'skills');
    await mkdir(skills, { recursive: true });
    await chmod(skills, 0o500);
    try {
      await rejectsWith(agent.installSkill({ replaceEdited: false }), 'internal', /not allowed to write/);
    } finally {
      await chmod(skills, 0o700);
    }
  });
});
