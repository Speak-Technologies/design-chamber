// Build step (10b) (documentation/specs/phase-2-5-technical.md §8.8 rev 3, T15): the
// design-system-builder skill and the interview the SystemAsk block bakes. Kept apart from
// build.mjs so a test can run it into a temp dist/ with fixture inputs (broken questions, an
// over-cap skill, a skill named like a command) without bundling the whole extension.
//
// The skill and the block read ONE file: rules/SYSTEM-QUESTIONS.md is inlined verbatim into the
// skill and parsed into the SystemQuestionSet the blocks bundle gets as __DC_SYSTEM_QUESTIONS__.
// A missing or broken file fails the build with a plain sentence; nothing half-built ships.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_SKILL_TEXT_MAX } from '../src/shared/limits.ts';
import { parseSystemQuestions } from '../src/shared/agent/system-questions.ts';
import { systemContractSection } from '../src/shared/agent/system-rules.ts';
import { buildSystemSkill, SYSTEM_SKILL_NAME, SystemSkillTooLongError } from '../src/shared/agent/system-skill-doc.ts';

/**
 * Writes `dist/skills/design-system-builder/SKILL.md` and returns the parsed question set.
 * `packageRoot` holds `rules/` and `package.json`; `distDir` is the dist folder (step (10) has
 * already written the design-chamber skill into it, so the name check sees every bundled skill).
 */
export const buildBuilderSkill = async ({ packageRoot, distDir }) => {
  let questions;
  try {
    questions = await readFile(path.join(packageRoot, 'rules', 'SYSTEM-QUESTIONS.md'), 'utf8');
  } catch {
    throw new Error('rules/SYSTEM-QUESTIONS.md is missing.');
  }
  // A parse error fails the build with the parser's own sentence.
  const set = parseSystemQuestions(questions);

  let skill;
  try {
    skill = buildSystemSkill({ systemQuestions: questions, contract: systemContractSection() });
  } catch (error) {
    if (error instanceof SystemSkillTooLongError) {
      throw new Error(`build: the design-system-builder skill is ${error.length} characters; the cap is ${SYSTEM_SKILL_TEXT_MAX}.`);
    }
    throw error;
  }
  if (skill.length > SYSTEM_SKILL_TEXT_MAX) {
    throw new Error(`build: the design-system-builder skill is ${skill.length} characters; the cap is ${SYSTEM_SKILL_TEXT_MAX}.`);
  }
  if (!/^---\r?\nname: design-system-builder\r?\n/.test(skill)) {
    throw new Error('build: dist/skills/design-system-builder/SKILL.md must start with a frontmatter line "name: design-system-builder".');
  }
  await mkdir(path.join(distDir, 'skills', SYSTEM_SKILL_NAME), { recursive: true });
  await writeFile(path.join(distDir, 'skills', SYSTEM_SKILL_NAME, 'SKILL.md'), skill);

  // The host drops a command whose name a skill already uses (AD-16): no bundled skill may be
  // named like a command, or /design, /page or /design-system would silently disappear.
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const commands = (manifest.openchamber?.contributes?.commands ?? []).map((command) => command.name);
  const entries = await readdir(path.join(distDir, 'skills'), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && commands.includes(entry.name)) throw new Error(`build: the skill ${entry.name} would hide the /${entry.name} command.`);
  }
  return set;
};
