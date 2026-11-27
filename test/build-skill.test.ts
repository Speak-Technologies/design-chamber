// Build step (10b) (documentation/specs/phase-2-5-technical.md §8.8 rev 3, §19, T15): the builder
// skill written into a temp dist/, the interview parsed for the blocks bundle, and every build
// refusal (a missing or broken SYSTEM-QUESTIONS.md, an over-cap skill, a skill named like a
// command). One test runs the real build and asserts both shipped skills and the blocks define.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';

import { parseSystemQuestions } from '../src/shared/agent/system-questions.ts';
import { SYSTEM_REFERENCE_DOCS, SYSTEM_REFERENCE_FOLDER, SYSTEM_SKILL_NAME } from '../src/shared/agent/system-skill-doc.ts';
import { SYSTEM_REFERENCE_DOC_MAX, SYSTEM_REFERENCE_TOTAL_MAX, SYSTEM_SKILL_TEXT_MAX } from '../src/shared/limits.ts';
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

const REFERENCE_SRC = path.join(REPO, 'rules', 'system-reference');

/** A fixture package root with the real interview and reference docs; `edit` changes the docs folder first. */
const fixtureWithDocs = async (t: TestContext, edit: (folder: string) => Promise<void>): Promise<string> => {
  const packageRoot = await fixture(t, R1);
  const folder = path.join(packageRoot, 'rules', 'system-reference');
  await mkdir(folder, { recursive: true });
  for (const name of await readdir(REFERENCE_SRC)) await writeFile(path.join(folder, name), await readFile(path.join(REFERENCE_SRC, name)));
  await edit(folder);
  return packageRoot;
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

test('system-builder-depth T3: the reference docs ship beside the skill as LF text, every doc the skill names among them', async (t) => {
  const distDir = await distWith(t, ['design-chamber']);
  await buildBuilderSkill({ packageRoot: REPO, distDir });
  const shipped = path.join(distDir, 'skills', SYSTEM_SKILL_NAME, SYSTEM_REFERENCE_FOLDER);
  const names = (await readdir(shipped)).sort();
  assert.deepEqual(names, (await readdir(REFERENCE_SRC)).sort());
  for (const name of SYSTEM_REFERENCE_DOCS) assert.ok(names.includes(name), name);
  let total = 0;
  for (const name of names) {
    const text = await readFile(path.join(shipped, name), 'utf8');
    assert.equal(text, (await readFile(path.join(REFERENCE_SRC, name), 'utf8')).replace(/\r\n?/g, '\n'), name);
    assert.ok(text.length <= SYSTEM_REFERENCE_DOC_MAX, `${name} ${text.length}`);
    total += text.length;
  }
  assert.ok(total <= SYSTEM_REFERENCE_TOTAL_MAX, `${total}`);
  const skill = await readFile(path.join(distDir, 'skills', SYSTEM_SKILL_NAME, 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('read its reference doc in the reference folder next to this file'));
  assert.ok(skill.length <= 22_700, `${skill.length} (soft budget 22 700)`);
});

test('system-builder-depth T3: a reference doc over its cap, a bad name, an em dash, too much in total or a missing doc fails the build with one sentence, and ships nothing', async (t) => {
  const cases: [string, (folder: string) => Promise<void>, RegExp][] = [
    ['over the doc cap', (folder) => writeFile(path.join(folder, 'motion.md'), 'a'.repeat(SYSTEM_REFERENCE_DOC_MAX + 1)), /^build: rules\/system-reference\/motion\.md is 12001 characters; the cap is 12000\.$/],
    ['at the doc cap', (folder) => writeFile(path.join(folder, 'motion.md'), 'a'.repeat(SYSTEM_REFERENCE_DOC_MAX)), /^$/],
    ['an upper-case name', (folder) => writeFile(path.join(folder, 'Extra.md'), 'x'), /^build: rules\/system-reference\/Extra\.md is not a reference doc name \(lower-case letters, digits and dashes, ending \.md\)\.$/],
    ['not markdown', (folder) => writeFile(path.join(folder, 'notes.txt'), 'x'), /^build: rules\/system-reference\/notes\.txt is not a reference doc name/],
    ['a folder', (folder) => mkdir(path.join(folder, 'more.md')), /^build: rules\/system-reference\/more\.md is not a reference doc name/],
    ['an em dash', async (folder) => writeFile(path.join(folder, 'brand.md'), `${await readFile(path.join(folder, 'brand.md'), 'utf8')}\nOne \u2014 two.\n`), /^build: rules\/system-reference\/brand\.md has an em dash; use a colon, a comma or two sentences\.$/],
    ['too much in total', async (folder) => {
      for (let n = 0; n < 8; n += 1) await writeFile(path.join(folder, `extra-${n}.md`), 'a'.repeat(SYSTEM_REFERENCE_DOC_MAX));
    }, /^build: the reference docs are \d+ characters together; the cap is 80000\.$/],
    ['a doc the skill names is missing', (folder) => rm(path.join(folder, 'patterns.md')), /^build: rules\/system-reference\/patterns\.md is missing; the skill points at it\.$/],
    ['the folder is missing', (folder) => rm(folder, { recursive: true }), /^build: rules\/system-reference\/ is missing\.$/],
  ];
  for (const [label, edit, sentence] of cases) {
    const packageRoot = await fixtureWithDocs(t, edit);
    const distDir = await distWith(t, []);
    const run = buildBuilderSkill({ packageRoot, distDir });
    if (sentence.source === '^$') {
      await run; // the boundary itself passes
      continue;
    }
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof Error, label);
      assert.match(error.message, sentence, label);
      return true;
    });
    assert.deepEqual(await readdir(path.join(distDir, 'skills')).catch(() => []), [], `${label}: nothing half-built ships`);
  }
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
  // esbuild leaves a "// <define:NAME>" comment above a replaced value; only a use left in code counts.
  assert.ok(!blocks.replace(/^\s*\/\/ <define:__DC_SYSTEM_QUESTIONS__>\s*$/gm, '').includes('__DC_SYSTEM_QUESTIONS__'), 'the define was replaced');
  t.diagnostic(`builder skill ${builder.length} characters; blocks bundle ${blocks.length} bytes`);
});
