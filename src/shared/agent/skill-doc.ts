// The bundled `design-chamber` skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4): the
// SKILL.md that scripts/build.mjs writes to dist/skills/design-chamber/, which reaches every
// agent while the extension is on. Pure and deterministic, no Node imports; the build runs it
// under Node's type stripping.
//
// It is static and shipped to everyone, so it holds no absolute path: the designs folder is in
// the instructions note (src/shared/agent/instructions.ts). The rule text stays in `rules/**`;
// the verbatim wrapper, the offline rules and the check section are the same pieces RULES.md
// uses (src/shared/agent/rules-doc.ts), so the two never drift apart.

import { CHECK_TOOL_NAME, SKILL_DESCRIPTION, SKILL_NAME } from './guide.ts';
import { checkSection, renderingSection, verbatim } from './rules-doc.ts';

export type BundledSkillInput = {
  /** `rules/DESIGN-RULES.md`, verbatim. */
  designRules: string;
  /** `rules/QUESTIONS.md`, verbatim. */
  questions: string;
  /** One entry per `presets/<id>.md` that ships beside the skill. */
  presets: ReadonlyArray<{ id: string; title: string }>;
};

/** A preset title on one line, so a stray newline in a rules file cannot start a new instruction line. */
const oneLineTitle = (title: string): string => title.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

const presetsLine = (presets: BundledSkillInput['presets']): string =>
  presets.length === 0
    ? '- No style presets ship with this skill.'
    : `- Style presets are in presets/<id>.md next to this file. Use one when the user picks it, or offer two or three when nothing settles the look: ${presets.map((preset) => `${preset.id} (${oneLineTitle(preset.title)})`).join(', ')}.`;

const workflow = (presets: BundledSkillInput['presets']): string[] => [
  '- The designs folder is named in the Design Chamber note in your instructions. Without that note, ask the user where their designs folder is (the default is ~/Documents/Designs).',
  '- Every design is its own folder in the designs folder, <slug>/, never a loose file. The slug uses lower-case letters, digits and hyphens, starts with a letter or digit and is at most 63 characters. Pick a new slug for a new design, and never edit another design\'s folder unless the user asks.',
  '- A page is one index.html shown full screen. A canvas is a wall of screens, screens/<id>.html, each shown at several device sizes side by side. Make a canvas when the user says canvas or the work has several screens, steps or boards.',
  '- Write design.json first, then the HTML, then tokens.css, DESIGN.md and assets/. design.json holds "version": 1, "kind" ("page" or "canvas"), "title", "updated", "viewports", and "screens" for a canvas. In an existing design.json change only title, updated, viewports, screens, designSystem and tweaks, and keep every other key as it is.',
  '- Set "updated" (and "created", when you write a new design.json) to the real current time, not a made-up one like midnight. Write the title in plain words, with no em dashes.',
  '- When a design is ready, show it in the chat with a DesignCard block. To let the user pick between directions you made as separate design folders, ask with DirectionPick. Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall. Write each in a fenced openui-lang code block whose first line is root = Stack([...]): root = Stack([DesignCard("<slug>")]) or root = Stack([DirectionPick("Which direction?", "Bold|Calm", "pricing-a|pricing-b")]). A root without Stack([...]) is not drawn. DirectionPick takes the question, then the option labels and the design folder names, each list split by | in the same order.',
  '- Work offline and check your work before you say you are done: both are below.',
  '- Never touch .versions/, .chamber/, .thumb.png or .trash/ in a design folder.',
  presetsLine(presets),
];

export const buildBundledSkill = ({ designRules, questions, presets }: BundledSkillInput): string =>
  [
    '---',
    `name: ${SKILL_NAME}`,
    `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
    '---',
    '# Designs for Design Chamber',
    '',
    'Design Chamber shows the designs saved in the user\'s designs folder inside OpenChamber. Follow this skill whenever you make or change one.',
    '',
    ...workflow(presets),
    '',
    '## Design rules',
    '',
    ...verbatim('rules/DESIGN-RULES.md', designRules),
    '',
    '## Questions to ask',
    '',
    ...verbatim('rules/QUESTIONS.md', questions),
    '',
    ...renderingSection(),
    '',
    ...checkSection({ tool: CHECK_TOOL_NAME, command: null }),
    '',
  ].join('\n');
