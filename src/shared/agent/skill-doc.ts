// The bundled `design-chamber` skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4): the
// SKILL.md that scripts/build.mjs writes to dist/skills/design-chamber/. Pure and deterministic,
// no Node imports; the build runs it under Node's type stripping.
//
// Placeholder: the frontmatter and the two rules files, verbatim. The agent-skill branch (U2)
// adds the short guidance section and shares the rules-doc pieces.

import { SKILL_DESCRIPTION, SKILL_NAME } from './guide.ts';

export type BundledSkillInput = {
  /** `rules/DESIGN-RULES.md`, verbatim. */
  designRules: string;
  /** `rules/QUESTIONS.md`, verbatim. */
  questions: string;
  /** One entry per `presets/<id>.md` that ships beside the skill. */
  presets: ReadonlyArray<{ id: string; title: string }>;
};

const trimEnd = (text: string): string => text.replace(/\s+$/, '');

export const buildBundledSkill = ({ designRules, questions, presets }: BundledSkillInput): string =>
  [
    '---',
    `name: ${SKILL_NAME}`,
    `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
    '---',
    '# Designs for Design Chamber',
    '',
    presets.length === 0 ? 'No style presets ship with this skill.' : `Style presets, in presets/<id>.md next to this file: ${presets.map((preset) => preset.id).join(', ')}.`,
    '',
    '## Design rules',
    '',
    trimEnd(designRules),
    '',
    '## Questions to ask',
    '',
    trimEnd(questions),
    '',
  ].join('\n');
