// Build step (10b) (documentation/specs/phase-2-5-technical.md §8.8 rev 3, T15): the
// design-system-builder skill and the interview the SystemAsk block bakes. Kept apart from
// build.mjs so a test can run it into a temp dist/ with fixture inputs (broken questions, an
// over-cap skill, a skill named like a command) without bundling the whole extension.
//
// The skill and the block read ONE file: rules/SYSTEM-QUESTIONS.md is inlined verbatim into the
// skill and parsed into the SystemQuestionSet the blocks bundle gets as __DC_SYSTEM_QUESTIONS__.
// A missing or broken file fails the build with a plain sentence; nothing half-built ships.
//
// The reference docs (system-builder-depth §4.1) ship beside the skill in reference/, copied from
// rules/system-reference/ after each passes its name, size and em-dash checks.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_REFERENCE_DOC_MAX, SYSTEM_REFERENCE_TOTAL_MAX, SYSTEM_SKILL_TEXT_MAX } from '../src/shared/limits.ts';
import { parseSystemQuestions } from '../src/shared/agent/system-questions.ts';
import {
  builderSkillContract,
  buildSystemSkill,
  SYSTEM_REFERENCE_DOCS,
  SYSTEM_REFERENCE_FOLDER,
  SYSTEM_SKILL_NAME,
  SystemSkillTooLongError,
} from '../src/shared/agent/system-skill-doc.ts';

const REFERENCE_NAME = /^[a-z0-9-]{1,40}\.md$/;

/**
 * `rules/system-reference/*.md` (system-builder-depth §4.1), LF text sorted by name. Refused with one
 * sentence: a missing folder, a name off the pattern (any other file or a folder too), a doc over
 * `SYSTEM_REFERENCE_DOC_MAX`, all of them over `SYSTEM_REFERENCE_TOTAL_MAX`, an em dash, or a doc the
 * skill names that isn't there (the skill would point at nothing).
 */
const readReferenceDocs = async (packageRoot) => {
  const folder = path.join(packageRoot, 'rules', 'system-reference');
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    throw new Error('build: rules/system-reference/ is missing.');
  }
  const docs = [];
  let total = 0;
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const where = `rules/system-reference/${entry.name}`;
    if (!entry.isFile() || !REFERENCE_NAME.test(entry.name)) {
      throw new Error(`build: ${where} is not a reference doc name (lower-case letters, digits and dashes, ending .md).`);
    }
    const text = (await readFile(path.join(folder, entry.name), 'utf8')).replace(/\r\n?/g, '\n');
    if (text.length > SYSTEM_REFERENCE_DOC_MAX) throw new Error(`build: ${where} is ${text.length} characters; the cap is ${SYSTEM_REFERENCE_DOC_MAX}.`);
    if (text.includes('\u2014')) throw new Error(`build: ${where} has an em dash; use a colon, a comma or two sentences.`);
    total += text.length;
    docs.push({ name: entry.name, text });
  }
  if (total > SYSTEM_REFERENCE_TOTAL_MAX) throw new Error(`build: the reference docs are ${total} characters together; the cap is ${SYSTEM_REFERENCE_TOTAL_MAX}.`);
  for (const name of SYSTEM_REFERENCE_DOCS) {
    if (!docs.some((doc) => doc.name === name)) throw new Error(`build: rules/system-reference/${name} is missing; the skill points at it.`);
  }
  return docs;
};

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
    skill = buildSystemSkill({ systemQuestions: questions, contract: builderSkillContract(), reference: 'beside' });
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
  // Every reference doc is read and judged before anything is written, so a bad one ships nothing.
  const references = await readReferenceDocs(packageRoot);
  await mkdir(path.join(distDir, 'skills', SYSTEM_SKILL_NAME, SYSTEM_REFERENCE_FOLDER), { recursive: true });
  await writeFile(path.join(distDir, 'skills', SYSTEM_SKILL_NAME, 'SKILL.md'), skill);
  for (const { name, text } of references) await writeFile(path.join(distDir, 'skills', SYSTEM_SKILL_NAME, SYSTEM_REFERENCE_FOLDER, name), text);

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

// Build step (10) (use-the-project spec §2.5 follow-up): the design-chamber skill. SKILL.md keeps the
// core and stays within BUNDLED_SKILL_TEXT_MAX; the longer detail ships beside it in reference/, each
// doc checked for its size and for em dashes. The presets are copied beside it as they are. Every
// input is read and judged before anything is written, so a bad one ships nothing.

/**
 * Writes `dist/skills/design-chamber/` (SKILL.md, presets/, reference/). `packageRoot` holds `rules/`.
 * Refused with one sentence: an invalid preset, a skill over its cap, a reference doc over its cap or
 * all of them over theirs, an em dash in a reference doc, or a doc the skill names that is not built.
 */
export const buildDesignChamberSkill = async ({ packageRoot, distDir }) => {
  const { buildBundledSkill, buildSkillReferenceDocs, BUNDLED_SKILL_TEXT_MAX, SKILL_REFERENCE_DOC_MAX, SKILL_REFERENCE_DOCS, SKILL_REFERENCE_FOLDER, SKILL_REFERENCE_TOTAL_MAX } =
    await import('../src/shared/agent/skill-doc.ts');
  const { parsePreset } = await import('../src/shared/agent/presets.ts');
  const { SKILL_NAME } = await import('../src/shared/agent/guide.ts');
  const rules = (...parts) => path.join(packageRoot, 'rules', ...parts);
  const readRule = async (name) => {
    try {
      return await readFile(rules(name), 'utf8');
    } catch {
      throw new Error(`build: rules/${name} is missing.`);
    }
  };

  const presets = [];
  for (const name of (await readdir(rules('presets'))).filter((entry) => entry.endsWith('.md')).sort()) {
    const id = name.slice(0, -'.md'.length);
    const text = await readFile(rules('presets', name), 'utf8');
    const preset = parsePreset(id, text);
    if (!preset) throw new Error(`build: rules/presets/${name} is not a valid preset (a "# Name" heading and an "**id:** ${id} · **best for:** ..." line).`);
    presets.push({ id: preset.id, title: preset.name, name, text });
  }
  const designRules = await readRule('DESIGN-RULES.md');
  const questions = await readRule('QUESTIONS.md');

  let skill;
  let references;
  try {
    skill = buildBundledSkill({ designRules, presets: presets.map(({ id, title }) => ({ id, title })) });
    references = buildSkillReferenceDocs({ designRules, questions });
  } catch (error) {
    throw new Error(`build: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!/^---\r?\nname: design-chamber\r?\n/.test(skill)) {
    throw new Error('build: dist/skills/design-chamber/SKILL.md must start with a frontmatter line "name: design-chamber".');
  }
  if (skill.length > BUNDLED_SKILL_TEXT_MAX) {
    throw new Error(`build: the design-chamber skill is ${skill.length} characters; the cap is ${BUNDLED_SKILL_TEXT_MAX}. Move detail into a reference doc.`);
  }
  let total = 0;
  for (const { name, text } of references) {
    const where = `${SKILL_REFERENCE_FOLDER}/${name}`;
    if (text.length > SKILL_REFERENCE_DOC_MAX) throw new Error(`build: the design-chamber skill's ${where} is ${text.length} characters; the cap is ${SKILL_REFERENCE_DOC_MAX}.`);
    if (text.includes('\u2014')) throw new Error(`build: the design-chamber skill's ${where} has an em dash; use a colon, a comma or two sentences.`);
    total += text.length;
  }
  if (total > SKILL_REFERENCE_TOTAL_MAX) throw new Error(`build: the design-chamber skill's reference docs are ${total} characters together; the cap is ${SKILL_REFERENCE_TOTAL_MAX}.`);
  for (const name of SKILL_REFERENCE_DOCS) {
    if (!references.some((doc) => doc.name === name)) throw new Error(`build: ${SKILL_REFERENCE_FOLDER}/${name} was not built; the skill points at it.`);
  }

  const folder = path.join(distDir, 'skills', SKILL_NAME);
  await mkdir(path.join(folder, 'presets'), { recursive: true });
  await mkdir(path.join(folder, SKILL_REFERENCE_FOLDER), { recursive: true });
  for (const { name, text } of presets) await writeFile(path.join(folder, 'presets', name), text);
  for (const { name, text } of references) await writeFile(path.join(folder, SKILL_REFERENCE_FOLDER, name), text);
  await writeFile(path.join(folder, 'SKILL.md'), skill);
};
