// The bundled `design-chamber` skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4): the
// SKILL.md the build ships in dist/skills/design-chamber/. It reaches every agent while the
// extension is on, so it must carry the whole rules text and no path from this machine.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import { parsePreset } from '../../src/shared/agent/presets.ts';
import { CHECK_TOOL_NAME, LIST_TOOL_NAME, PROJECT_LINE, READ_TOOL_NAME, SKILL_DESCRIPTION, SKILL_NAME } from '../../src/shared/agent/guide.ts';
import { buildInstructions } from '../../src/shared/agent/instructions.ts';
import { findOwnershipMarker } from '../../src/shared/agent/ownership.ts';
import { checkSection, renderingSection, verbatim } from '../../src/shared/agent/rules-doc.ts';
import { BUNDLED_SKILL_TEXT_MAX, buildBundledSkill, buildSkillReferenceDocs, SKILL_REFERENCE_DOC_MAX, SKILL_REFERENCE_DOCS, splitDesignRules } from '../../src/shared/agent/skill-doc.ts';
import { SKILL_TEXT_MAX_MERGED } from '../../src/shared/limits.ts';
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

  test('carries DESIGN-RULES.md verbatim but its §4, which with QUESTIONS.md ships in reference/ (use-the-project §2.5 follow-up)', async () => {
    const input = await realInput();
    const skill = buildBundledSkill(input);
    const { core, practice } = splitDesignRules(input.designRules);
    assert.ok(skill.includes(lines(verbatim('rules/DESIGN-RULES.md, §4 in reference/design-practice.md', core))));
    assert.ok(practice.startsWith('## 4. Design best practices\n') && practice.length > 1000);
    assert.ok(!skill.includes(practice.trim()), 'the section itself is not inline');
    assert.ok(core.includes('## 4. Design best practices\n\nIn reference/design-practice.md next to this file:'), 'a pointer stands in its place');
    for (const heading of ['## 1. Precedence', '## 2. Discover', '## 3. Anti-slop', '## 5. File & technical rules', '## 6. Self-check']) assert.ok(skill.includes(heading), heading);
    const docs = buildSkillReferenceDocs({ designRules: input.designRules, questions: input.questions });
    assert.deepEqual(docs.map((doc) => doc.name), [...SKILL_REFERENCE_DOCS]);
    assert.ok(docs[0]?.text.endsWith(practice), 'design-practice.md is §4 word for word');
    assert.equal(docs[1]?.text, input.questions, 'questions.md is QUESTIONS.md word for word');
    assert.ok(!skill.includes(input.questions.split('\n').slice(2, 6).join('\n')), 'QUESTIONS.md is not inline');
    assert.ok(skill.includes('read reference/questions.md next to this file'));
    assert.ok(skill.indexOf('## Design rules') < skill.indexOf('## Questions to ask'));
    for (const doc of docs) {
      assert.ok(doc.text.length <= SKILL_REFERENCE_DOC_MAX, `${doc.name} ${doc.text.length}`);
      assert.ok(!doc.text.includes('\u2014'), doc.name);
    }
  });

  test('splitDesignRules: the heading on the first line or later; a missing heading throws a sentence', () => {
    const later = splitDesignRules('# R\n\n## 3. A\n\nx\n\n## 4. Design best practices\n\nbody\n\n## 5. B\n\ny\n');
    assert.equal(later.practice, '## 4. Design best practices\n\nbody\n');
    assert.ok(later.core.startsWith('# R\n\n## 3. A\n\nx\n\n## 4. Design best practices\n\nIn reference/'));
    assert.ok(later.core.endsWith('## 5. B\n\ny\n'));
    assert.equal(splitDesignRules('## 4. Design best practices\n\nlast\n').practice, '## 4. Design best practices\n\nlast\n');
    assert.throws(() => splitDesignRules('# R\n\n## 4. Best practices\n'), /has no "## 4\. Design best practices" heading/);
  });

  test('reuses the RULES.md offline rules and check section word for word; the check names design_check and has no command', async () => {
    const skill = buildBundledSkill(await realInput());
    assert.ok(skill.includes(lines(renderingSection())));
    assert.ok(skill.includes(lines(checkSection({ tool: CHECK_TOOL_NAME, command: null }))));
    assert.ok(skill.includes('Check the design with the design_check tool after each change'));
    assert.ok(!skill.includes('.chamber/bin/dc'));
  });

  test('the workflow names tweaks among the owned keys and the two kinds of directions (Phase 2)', async () => {
    const skill = buildBundledSkill(await realInput());
    assert.ok(skill.includes('In an existing design.json change only title, updated, viewports, screens, designSystem, tweaks and folderRequest, and keep every other key as it is.'));
    assert.ok(skill.includes('To let the user pick between directions you made as separate design folders, ask with DirectionPick.'));
    assert.ok(skill.includes('Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall.'));
  });

  test('the design-system lines and the 30 000-character ceiling (Phase 2.5 §8.11)', async () => {
    const skill = buildBundledSkill(await realInput());
    assert.ok(skill.includes('To build a design system with the user, use /design-system or the design-system-builder skill.'));
    assert.ok(skill.includes("- A design task never writes a project's repo; a system's repo changes only from its own chat, after the user approves a diff."));
    assert.ok(skill.length <= 30_000, `${skill.length} characters`);
  });

  test('Phase 2.6 §7.3: the folders line after the repo line, then the presets line; the built skill stays under the merged cap', async () => {
    const skill = buildBundledSkill(await realInput());
    const lines = skill.split('\n');
    const repo = lines.indexOf("- A design task never writes a project's repo; a system's repo changes only from its own chat, after the user approves a diff.");
    assert.ok(repo > 0);
    assert.equal(lines[repo + 1], '- Folders are the user\'s tags in the library; nothing moves on disk. Only when the user asks, add a design to an existing folder with design.json "folderRequest": { "add": ["<name>"], "at": "<now>" } (or "remove"). The names are in .chamber/folders.json in the designs folder: read it, never write it. Never create, rename or delete folders.');
    assert.ok((lines[repo + 2] ?? '').startsWith('- Style presets are in presets/'));
    assert.ok(skill.length <= SKILL_TEXT_MAX_MERGED, `${skill.length} characters`);
  });

  test('use-the-project §2.5: "What you can do" names the three tools, the commands and what to do without the tools, before the workflow', async () => {
    const skill = buildBundledSkill(await realInput());
    const block = skill.slice(skill.indexOf('## What you can do'), skill.indexOf('## How to work'));
    assert.ok(skill.indexOf('## What you can do') > 0 && block.length > 0);
    for (const tool of [LIST_TOOL_NAME, READ_TOOL_NAME, CHECK_TOOL_NAME]) assert.ok(block.includes(`- ${tool}: `), tool);
    assert.ok(block.includes('- /design and /page start a design with the rules attached. To build a design system with the user, use /design-system or the design-system-builder skill.'));
    assert.ok(block.includes('Without these tools, read the comments in design.json and .chamber/check.json yourself; never change either.'));
  });

  test('use-the-project §2.5: the follow-the-project line is the note\'s, word for word', async () => {
    const skill = buildBundledSkill(await realInput());
    assert.ok(skill.includes(`\n- ${PROJECT_LINE}\n`));
    assert.ok(buildInstructions({ root: '/home/you/Documents/Designs', platform: 'linux', checkCommand: null }).includes(`- ${PROJECT_LINE}`));
  });

  test('the built skill, with the real rules and presets, stays within BUNDLED_SKILL_TEXT_MAX (20 000)', async () => {
    assert.equal(BUNDLED_SKILL_TEXT_MAX, 20_000);
    const skill = buildBundledSkill(await realInput());
    assert.ok(skill.length <= BUNDLED_SKILL_TEXT_MAX, `${skill.length} characters`);
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
    const stub = { designRules: '# Design rules\n\n## 3. Anti-slop\n\n(rules text)\n\n## 4. Design best practices\n\n(moved)\n\n## 5. File & technical rules\n\n(rules text)\n', presets: [{ id: 'minimal-saas', title: 'Minimal SaaS' }] };
    assert.ok(!buildBundledSkill(stub).includes('—'));
    assert.equal(buildBundledSkill(stub), buildBundledSkill(stub));
  });

  test('golden sample (rules bodies stubbed so it only tracks our wording)', async () => {
    await assertSnapshot(
      'skill.bundled.md',
      buildBundledSkill({
        designRules: '(rules/DESIGN-RULES.md text appears here)\n\n## 4. Design best practices\n\n(this section ships in reference/design-practice.md)\n\n## 5. File & technical rules\n\n(the rest appears here)\n',
        presets: [{ id: 'minimal-saas', title: 'Minimal SaaS' }, { id: 'editorial', title: 'Editorial' }],
      }),
    );
  });
});
