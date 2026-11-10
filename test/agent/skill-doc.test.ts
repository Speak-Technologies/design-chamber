// The bundled `design-chamber` skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4): the
// SKILL.md the build ships in dist/skills/design-chamber/. It reaches every agent while the
// extension is on, so it must carry the whole rules text and no path from this machine.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import { parsePreset } from '../../src/shared/agent/presets.ts';
import { CHECK_TOOL_NAME, SKILL_DESCRIPTION, SKILL_NAME } from '../../src/shared/agent/guide.ts';
import { findOwnershipMarker } from '../../src/shared/agent/ownership.ts';
import { checkSection, renderingSection, verbatim } from '../../src/shared/agent/rules-doc.ts';
import { buildBundledSkill } from '../../src/shared/agent/skill-doc.ts';
import { REPO_RULES } from './helpers.ts';
import { assertSnapshot } from './snapshot.ts';

const read = (...parts: string[]): Promise<string> => readFile(path.join(REPO_RULES, ...parts), 'utf8');

const realInput = async () => {
  const names = (await readdir(path.join(REPO_RULES, 'presets'))).filter((name) => name.endsWith('.md')).sort();
  const presets = [];
  for (const name of names) {
    const id = name.slice(0, -'.md'.length);
    const preset = parsePreset(id, await read('presets', name));
    assert.ok(preset, `rules/presets/${name} parses`);
    if (preset) presets.push({ id: preset.id, title: preset.name });
  }
  return { designRules: await read('DESIGN-RULES.md'), questions: await read('QUESTIONS.md'), presets };
};

const lines = (parts: string[]): string => parts.join('\n');

describe('buildBundledSkill (§U2.4)', () => {
  test('frontmatter: name design-chamber and SKILL_DESCRIPTION, nothing else; no ownership marker', async () => {
    const skill = buildBundledSkill(await realInput());
    const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
    assert.ok(match?.[1] !== undefined, 'frontmatter present');
    const fields = (match?.[1] ?? '').split('\n');
    assert.deepEqual(fields.map((line) => line.split(':')[0]), ['name', 'description']);
    assert.equal(fields[0], `name: ${SKILL_NAME}`);
    assert.equal(JSON.parse(fields[1]?.slice('description: '.length) ?? '""'), SKILL_DESCRIPTION);
    assert.equal(findOwnershipMarker(skill).kind, 'none', 'the shipped skill is never mistaken for an installed copy of ours');
  });

  test('carries the whole of DESIGN-RULES.md and QUESTIONS.md, inside the RULES.md markers', async () => {
    const input = await realInput();
    const skill = buildBundledSkill(input);
    assert.ok(skill.includes(input.designRules.replace(/\n$/, '')), 'DESIGN-RULES.md in full');
    assert.ok(skill.includes(input.questions.replace(/\n$/, '')), 'QUESTIONS.md in full');
    assert.ok(skill.includes(lines(verbatim('rules/DESIGN-RULES.md', input.designRules))));
    assert.ok(skill.includes(lines(verbatim('rules/QUESTIONS.md', input.questions))));
    assert.ok(skill.indexOf('## Design rules') < skill.indexOf('## Questions to ask'));
  });

  test('reuses the RULES.md offline rules and check section word for word; the check names design_check and has no command', async () => {
    const skill = buildBundledSkill(await realInput());
    assert.ok(skill.includes(lines(renderingSection())));
    assert.ok(skill.includes(lines(checkSection({ tool: CHECK_TOOL_NAME, command: null }))));
    assert.ok(skill.includes('Check the design with the design_check tool after each change'));
    assert.ok(!skill.includes('.chamber/bin/dc'));
  });

  test('no absolute path, no path from this machine', async () => {
    const skill = buildBundledSkill(await realInput());
    assert.doesNotMatch(skill, /\/home\/|\/Users\/|[A-Za-z]:\\|\\\\[A-Za-z]/);
    assert.ok(!skill.includes(REPO_RULES));
  });

  test('lists every preset that ships beside it, and says so when none do', async () => {
    const input = await realInput();
    assert.ok(input.presets.length > 0, 'the repo ships presets');
    const skill = buildBundledSkill(input);
    for (const preset of input.presets) assert.ok(skill.includes(`${preset.id} (${preset.title})`), preset.id);
    assert.ok(skill.includes('presets/<id>.md next to this file'));
    assert.ok(buildBundledSkill({ ...input, presets: [] }).includes('- No style presets ship with this skill.'));
    const odd = buildBundledSkill({ ...input, presets: [{ id: 'x', title: 'Line one\nLine two' }] });
    assert.ok(odd.includes('x (Line one Line two)'), 'a title stays on one line');
  });

  test('our own wording has no em dash; deterministic', async () => {
    const stub = { designRules: 'rules\n', questions: 'questions\n', presets: [{ id: 'minimal-saas', title: 'Minimal SaaS' }] };
    assert.ok(!buildBundledSkill(stub).includes('—'));
    assert.equal(buildBundledSkill(stub), buildBundledSkill(stub));
  });

  test('golden sample (rules bodies stubbed so it only tracks our wording)', async () => {
    await assertSnapshot(
      'skill.bundled.md',
      buildBundledSkill({
        designRules: '(rules/DESIGN-RULES.md text appears here)\n',
        questions: '(rules/QUESTIONS.md text appears here)\n',
        presets: [{ id: 'minimal-saas', title: 'Minimal SaaS' }, { id: 'editorial', title: 'Editorial' }],
      }),
    );
  });
});
