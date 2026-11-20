// Build step (10b) (documentation/specs/phase-2-5-technical.md §8.8 rev 3, §19, T15): the builder
// skill written into a temp dist/, the interview parsed for the blocks bundle, and every build
// refusal (a missing or broken SYSTEM-QUESTIONS.md, an over-cap skill, a skill named like a
// command). One test runs the real build and asserts both shipped skills and the blocks define.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';

import { parseSystemQuestions } from '../src/shared/agent/system-questions.ts';
import { SYSTEM_SKILL_NAME } from '../src/shared/agent/system-skill-doc.ts';
import { SYSTEM_SKILL_TEXT_MAX } from '../src/shared/limits.ts';
import { buildBuilderSkill } from '../scripts/build-skill.mjs';
import { useTmpRoot } from './helpers/tmp-root.ts';

const REPO = path.resolve(import.meta.dirname, '..');
const R1 = await readFile(path.join(REPO, 'rules', 'SYSTEM-QUESTIONS.md'), 'utf8');
const MANIFEST = { openchamber: { contributes: { commands: [{ name: 'design' }, { name: 'page' }, { name: 'design-system' }] } } };

/** A fixture package root: the manifest, and optionally a rules/SYSTEM-QUESTIONS.md. */
const fixture = async (t: TestContext, questions: string | null): Promise<string> => {
  const tmp = await useTmpRoot(t, 'dc-build-skill-');
  await tmp.write('package.json', MANIFEST);
  if (questions !== null) await tmp.write('rules/SYSTEM-QUESTIONS.md', questions);
  return tmp.root;
};

/** A temp dist with the design-chamber skill folder step (10) would have written. */
const distWith = async (t: TestContext, skillNames: readonly string[]): Promise<string> => {
  const tmp = await useTmpRoot(t, 'dc-build-dist-');
  for (const name of skillNames) await mkdir(path.join(tmp.root, 'skills', name), { recursive: true });
  return tmp.root;
};

test('the builder skill lands in dist/skills, and the returned set is the interview the block bakes', async (t) => {
  const distDir = await distWith(t, ['design-chamber']);
  const set = await buildBuilderSkill({ packageRoot: REPO, distDir });
  assert.deepEqual(set, parseSystemQuestions(R1));
  const skill = await readFile(path.join(distDir, 'skills', SYSTEM_SKILL_NAME, 'SKILL.md'), 'utf8');
  assert.ok(skill.startsWith('---\nname: design-system-builder\n'));
  assert.ok(skill.length <= SYSTEM_SKILL_TEXT_MAX, `${skill.length}`);
  assert.ok(skill.includes(R1.trim()), 'the skill inlines the same file the set was parsed from');
});

test('a missing rules/SYSTEM-QUESTIONS.md fails the build with its sentence', async (t) => {
  const packageRoot = await fixture(t, null);
  const distDir = await distWith(t, []);
  await assert.rejects(buildBuilderSkill({ packageRoot, distDir }), /rules\/SYSTEM-QUESTIONS\.md is missing\./);
});

test('a broken interview fails the build with the parser\'s sentence', async (t) => {
  const packageRoot = await fixture(t, R1.replace('## Round two: after you read the code', '## Round 2'));
  const distDir = await distWith(t, []);
  await assert.rejects(buildBuilderSkill({ packageRoot, distDir }), /rules\/SYSTEM-QUESTIONS\.md: the "## Round two: after you read the code" heading is missing\./);
});

test('a skill over 24 000 characters fails the build, never ships cut', async (t) => {
  // A structurally valid interview with enough options to push the skill over the cap.
  const options = Array.from({ length: 1500 }, (_, i) => `- **Option ${i}** {#opt-${i}}: A why line.`).join('\n');
  const huge = R1.replace('Pick any.\n', `Pick any.\n${options}\n`);
  const packageRoot = await fixture(t, huge);
  const distDir = await distWith(t, []);
  await assert.rejects(buildBuilderSkill({ packageRoot, distDir }), /build: the design-system-builder skill is \d+ characters; the cap is 24000\./);
});

test('the name-disjointness check goes red when a skill is named like a command', async (t) => {
  const distDir = await distWith(t, ['design-chamber', 'page']);
  await assert.rejects(buildBuilderSkill({ packageRoot: REPO, distDir }), /build: the skill page would hide the \/page command\./);
  const designSystem = await distWith(t, ['design-system']);
  await assert.rejects(buildBuilderSkill({ packageRoot: REPO, distDir: designSystem }), /build: the skill design-system would hide the \/design-system command\./);
});

test('the real build ships both skills, disjoint from the commands, and bakes the interview into the blocks bundle', async (t) => {
  // The whole build into the repo's dist/ (gitignored): step (10), (10b) and the blocks define.
  await promisify(execFile)(process.execPath, [path.join(REPO, 'scripts', 'build.mjs')], { cwd: REPO, timeout: 120_000 });
  const manifest = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8')) as { openchamber: { contributes: { commands: { name: string }[] } } };
  const commands = manifest.openchamber.contributes.commands.map((command) => command.name);
  for (const name of ['design-chamber', SYSTEM_SKILL_NAME]) {
    const skill = await readFile(path.join(REPO, 'dist', 'skills', name, 'SKILL.md'), 'utf8');
    assert.ok(skill.startsWith(`---\nname: ${name}\n`), name);
    assert.ok(!commands.includes(name), `the skill ${name} would hide a command`);
  }
  const builder = await readFile(path.join(REPO, 'dist', 'skills', SYSTEM_SKILL_NAME, 'SKILL.md'), 'utf8');
  assert.ok(builder.length <= SYSTEM_SKILL_TEXT_MAX, `${builder.length}`);
  const blocks = await readFile(path.join(REPO, 'dist', 'blocks', 'main.js'), 'utf8');
  assert.ok(!blocks.includes('__DC_SYSTEM_QUESTIONS__'), 'the define was replaced (or nothing references it yet)');
  t.diagnostic(`builder skill ${builder.length} characters; blocks bundle ${blocks.length} bytes`);
});
