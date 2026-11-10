// DELETE /agent/skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4, §U2.6 4): remove the
// `design-chamber` skill copy an older version installed into OpenCode's skills folder, now
// that the skill ships inside the extension.
//
// This deletes a file outside the designs root, so the rules are strict: only the fixed path
// (`skillTarget`), only when the file carries our marker and its hash still matches, never
// through a symlinked leaf, never the copies in ~/.claude or ~/.agents, and nothing from the
// request ever reaches the filesystem. Every test points the home folder at a tmp folder.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { ApiErrorBody, RemoveSkillResponse } from '../../../src/shared/api.ts';
import { buildSkillDoc } from '../../../src/shared/agent/guide.ts';
import { createAgentSetup, type AgentSetup } from '../../../src/service/agent-setup.ts';
import type { Logger } from '../../../src/service/context.ts';
import { ApiError } from '../../../src/service/http.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { useServedCore } from './harness.ts';

const quietLog: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const OLD = new Date('2020-01-01T00:00:00Z');

const fingerprint = async (file: string): Promise<{ bytes: string; mtimeMs: number }> => ({
  bytes: await readFile(file, 'utf8'),
  mtimeMs: (await lstat(file)).mtimeMs,
});

const writeOld = async (file: string, text: string): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  await utimes(file, OLD, OLD);
};

const settingsAt = (initial: string) => {
  let root = initial;
  return { root: () => root, onRootChange: () => () => undefined, move: (next: string) => void (root = next) };
};

type Fixture = { tmp: TmpRoot; root: string; home: string; skillDir: string; skillFile: string; settings: ReturnType<typeof settingsAt>; agent: AgentSetup };

const useFixture = async (t: TestContext): Promise<Fixture> => {
  const tmp = await useTmpRoot(t, 'dc-skill-delete-');
  const root = tmp.at('designs');
  const home = tmp.at('home');
  await mkdir(root, { recursive: true });
  await mkdir(home, { recursive: true });
  const settings = settingsAt(root);
  const agent = createAgentSetup({ log: quietLog, settings, env: {}, homeDir: home });
  const skillDir = path.join(home, '.config', 'opencode', 'skills', 'design-chamber');
  return { tmp, root, home, skillDir, skillFile: path.join(skillDir, 'SKILL.md'), settings, agent };
};

/** What an older version wrote at install time. */
const ourCopy = (root: string, checkCommand: string | null = null): string => buildSkillDoc({ root, guidePath: path.join(root, 'AGENTS.md'), checkCommand });

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

/** Run `fn` and answer the ApiError it threw (fails the test when it did not throw one). */
const refusal = async (fn: () => Promise<unknown>): Promise<ApiError> => {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected an ApiError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected the removal to be refused');
};

const EDITED = "That copy has your own edits, so it stays. Delete it yourself if you don't need it.";
const FOREIGN = "That skill isn't one Design Chamber wrote, so it stays.";

describe('removeOldSkill: only ours and unedited', () => {
  test('an unedited copy of ours goes, with its now-empty folder; skills/ stays', async (t) => {
    const { root, skillDir, skillFile, agent } = await useFixture(t);
    await writeOld(skillFile, ourCopy(root));
    assert.equal((await agent.skillStatus()).state, 'current');
    const status = await agent.removeOldSkill();
    assert.equal(status.state, 'not-installed');
    assert.equal(existsSync(skillFile), false);
    assert.equal(existsSync(skillDir), false, 'the empty design-chamber folder is removed');
    assert.ok(existsSync(path.dirname(skillDir)), 'the skills folder itself is left');
  });

  test('an outdated copy of ours (another root, another version) goes too', async (t) => {
    const { skillFile, agent } = await useFixture(t);
    await writeOld(skillFile, ourCopy('/somewhere/else', "sh '/somewhere/else/.chamber/bin/dc' check <slug>"));
    assert.equal((await agent.skillStatus()).state, 'outdated');
    assert.equal((await agent.removeOldSkill()).state, 'not-installed');
    assert.equal(existsSync(skillFile), false);
  });

  test('an edited copy is refused with 409 and stays, bytes and mtime', async (t) => {
    const { root, skillFile, agent } = await useFixture(t);
    for (const text of [ourCopy(root).replace('Work offline', 'Work offline, my way'), `${ourCopy(root)}\n`, ourCopy(root).replace(/sha256: "[0-9a-f]{64}"/, 'sha256: "mine"')]) {
      await writeOld(skillFile, text);
      const before = await fingerprint(skillFile);
      const error = await refusal(() => agent.removeOldSkill());
      assert.equal(error.code, 'conflict');
      assert.equal(error.status, 409);
      assert.equal(error.message, EDITED);
      assert.deepEqual(await fingerprint(skillFile), before);
    }
  });

  test('a copy too large to verify counts as edited and stays', async (t) => {
    const { root, skillFile, agent } = await useFixture(t);
    await writeOld(skillFile, `${ourCopy(root)}${'x'.repeat(70 * 1024)}`);
    const before = await fingerprint(skillFile);
    assert.equal((await refusal(() => agent.removeOldSkill())).message, EDITED);
    assert.deepEqual(await fingerprint(skillFile), before);
  });

  test('a skill without our marker is refused with 409 and stays', async (t) => {
    const { skillFile, agent } = await useFixture(t);
    await writeOld(skillFile, '---\nname: design-chamber\ndescription: my own skill\n---\nMine.\n');
    const before = await fingerprint(skillFile);
    const error = await refusal(() => agent.removeOldSkill());
    assert.equal(error.code, 'conflict');
    assert.equal(error.message, FOREIGN);
    assert.deepEqual(await fingerprint(skillFile), before);
  });

  test('a symlinked design-chamber folder is refused, even when it holds an unedited copy of ours', async (t) => {
    const { tmp, root, skillDir, agent } = await useFixture(t);
    if (!(await canSymlink(t, tmp))) return;
    const elsewhere = tmp.at('elsewhere/design-chamber');
    const target = path.join(elsewhere, 'SKILL.md');
    await writeOld(target, ourCopy(root));
    await mkdir(path.dirname(skillDir), { recursive: true });
    await symlink(elsewhere, skillDir, 'dir');
    const before = await fingerprint(target);
    const error = await refusal(() => agent.removeOldSkill());
    assert.equal(error.code, 'conflict');
    assert.equal(error.message, FOREIGN);
    assert.deepEqual(await fingerprint(target), before, 'the file the link points at is untouched');
    assert.ok((await lstat(skillDir)).isSymbolicLink(), 'the link itself is untouched');
  });

  test('a symlinked SKILL.md is refused, even when it points at an unedited copy of ours', async (t) => {
    const { tmp, root, skillFile, agent } = await useFixture(t);
    if (!(await canSymlink(t, tmp))) return;
    const real = tmp.at('real-skill.md');
    await writeOld(real, ourCopy(root));
    await mkdir(path.dirname(skillFile), { recursive: true });
    await symlink(real, skillFile);
    const before = await fingerprint(real);
    assert.equal((await refusal(() => agent.removeOldSkill())).message, FOREIGN);
    assert.deepEqual(await fingerprint(real), before);
    assert.ok((await lstat(skillFile)).isSymbolicLink());
  });

  test('a folder named SKILL.md, or a file named design-chamber, is refused and left', async (t) => {
    const { skillDir, skillFile, agent } = await useFixture(t);
    await mkdir(skillFile, { recursive: true });
    assert.equal((await refusal(() => agent.removeOldSkill())).message, FOREIGN);
    assert.ok((await lstat(skillFile)).isDirectory());
    await rm(skillDir, { recursive: true });
    await writeOld(skillDir, 'not a folder');
    assert.equal((await refusal(() => agent.removeOldSkill())).message, FOREIGN);
    assert.equal(await readFile(skillDir, 'utf8'), 'not a folder');
  });

  test('nothing there answers not-installed and creates nothing (idempotent)', async (t) => {
    const { home, agent } = await useFixture(t);
    assert.equal((await agent.removeOldSkill()).state, 'not-installed');
    assert.equal((await agent.removeOldSkill()).state, 'not-installed');
    assert.equal(existsSync(path.join(home, '.config')), false);
  });

  test('other files in the folder keep the folder', async (t) => {
    const { root, skillDir, skillFile, agent } = await useFixture(t);
    await writeOld(skillFile, ourCopy(root));
    await writeOld(path.join(skillDir, 'notes.md'), 'mine');
    assert.equal((await agent.removeOldSkill()).state, 'not-installed');
    assert.equal(existsSync(skillFile), false);
    assert.equal(await readFile(path.join(skillDir, 'notes.md'), 'utf8'), 'mine');
  });

  test('never touches the copies in ~/.claude/skills and ~/.agents/skills, even unedited ones of ours', async (t) => {
    const { root, home, skillFile, agent } = await useFixture(t);
    const claude = path.join(home, '.claude', 'skills', 'design-chamber', 'SKILL.md');
    const agents = path.join(home, '.agents', 'skills', 'design-chamber', 'SKILL.md');
    await writeOld(skillFile, ourCopy(root));
    await writeOld(claude, ourCopy(root));
    await writeOld(agents, ourCopy(root));
    const claudeBefore = await fingerprint(claude);
    const agentsBefore = await fingerprint(agents);
    const status = await agent.removeOldSkill();
    assert.equal(status.state, 'not-installed');
    assert.deepEqual(status.duplicates, [claude, agents], 'still listed for the user');
    assert.deepEqual(await fingerprint(claude), claudeBefore);
    assert.deepEqual(await fingerprint(agents), agentsBefore);
  });

  test("works whatever the current root is (ownership comes from the file's own marker)", async (t) => {
    const { tmp, root, skillFile, settings, agent } = await useFixture(t);
    await writeOld(skillFile, ourCopy(root));
    settings.move(tmp.at('bad\troot'));
    assert.equal((await agent.skillStatus()).state, 'unavailable');
    // The status read afterwards still says unavailable for this root (agent-setup.test.ts covers that); the removal itself does not depend on it.
    await agent.removeOldSkill();
    assert.equal(existsSync(skillFile), false);
  });

  test('two removals at once: one removes, both answer not-installed', async (t) => {
    const { root, skillFile, agent } = await useFixture(t);
    await writeOld(skillFile, ourCopy(root));
    const answers = await Promise.all([agent.removeOldSkill(), agent.removeOldSkill()]);
    assert.deepEqual(answers.map((status) => status.state), ['not-installed', 'not-installed']);
    assert.equal(existsSync(skillFile), false);
  });

  test("a symlinked opencode folder above skills/ is the user's setup: the copy inside it goes", async (t) => {
    const { tmp, root, home, agent } = await useFixture(t);
    if (!(await canSymlink(t, tmp))) return;
    const dotfiles = tmp.at('dotfiles/opencode');
    const realFile = path.join(dotfiles, 'skills', 'design-chamber', 'SKILL.md');
    await writeOld(realFile, ourCopy(root));
    await mkdir(path.join(home, '.config'), { recursive: true });
    await symlink(dotfiles, path.join(home, '.config', 'opencode'), 'dir');
    assert.equal((await agent.removeOldSkill()).state, 'not-installed');
    assert.equal(existsSync(realFile), false);
    assert.ok(existsSync(path.join(dotfiles, 'skills')), 'only the leaf folder goes');
  });
});

describe('DELETE /agent/skill over HTTP', () => {
  const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

  test('removes an unedited copy; 409 with the sentence for an edited one; 401 without the token', async (t) => {
    const core = await useServedCore(t);
    const skillFile = path.join(core.homeDir, '.config', 'opencode', 'skills', 'design-chamber', 'SKILL.md');
    await writeOld(skillFile, ourCopy(core.root).replace('Work offline', 'Work offline, edited'));
    const before = await fingerprint(skillFile);

    const refused = await core.request('/agent/skill', { method: 'DELETE' });
    assert.equal(refused.status, 409);
    assert.deepEqual(await json<ApiErrorBody>(refused), { error: 'conflict', message: EDITED });
    assert.deepEqual(await fingerprint(skillFile), before);

    await writeOld(skillFile, ourCopy(core.root));
    for (const token of [null, 'wrong-token']) {
      assert.equal((await core.request('/agent/skill', { method: 'DELETE', token })).status, 401);
    }
    assert.ok(existsSync(skillFile), 'a refused request deletes nothing');

    const removed = await core.request('/agent/skill', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal((await json<RemoveSkillResponse>(removed)).skill.state, 'not-installed');
    assert.equal(existsSync(skillFile), false);
  });

  test('no request input reaches the filesystem: a path in the body or the query is ignored', async (t) => {
    const core = await useServedCore(t);
    // An unedited copy of ours somewhere else: a request naming it must not remove it.
    const bait = core.tmp.at('elsewhere/design-chamber/SKILL.md');
    await writeOld(bait, ourCopy(core.root));
    const before = await fingerprint(bait);
    for (const value of [bait, '../../../elsewhere/design-chamber/SKILL.md', '..\\..\\elsewhere', 'C:\\Users\\x\\SKILL.md']) {
      const answer = await core.request('/agent/skill', { method: 'DELETE', query: { path: value, file: value }, body: { path: value, file: value, dir: path.dirname(value) } });
      assert.equal(answer.status, 200);
      assert.equal((await json<RemoveSkillResponse>(answer)).skill.state, 'not-installed');
    }
    assert.deepEqual(await fingerprint(bait), before);
  });
});
