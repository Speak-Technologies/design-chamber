// The bundled `design-chamber` skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4): the
// SKILL.md that scripts/build.mjs writes to dist/skills/design-chamber/, which reaches every
// agent while the extension is on. Pure and deterministic, no Node imports; the build runs it
// under Node's type stripping.
//
// It is static and shipped to everyone, so it holds no absolute path: the designs folder is in
// the instructions note (src/shared/agent/instructions.ts). The rule text stays in `rules/**`;
// the verbatim wrapper, the offline rules and the check section are the same pieces RULES.md
// uses (src/shared/agent/rules-doc.ts), so the two never drift apart.

import { CHECK_TOOL_NAME, LIST_TOOL_NAME, PROJECT_LINE, READ_TOOL_NAME, SKILL_DESCRIPTION, SKILL_NAME } from './guide.ts';
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

/** The tools, blocks and commands an agent in OpenChamber has (use-the-project spec §2.5), and what to do without them. */
const toolLines = (): string[] => [
  `- ${LIST_TOOL_NAME}: the designs and design systems, newest first, and which design the user has open. Filter by project, kind or text.`,
  `- ${READ_TOOL_NAME}: one design's open pins (with the element each points at), what the user has open in it, hand edits waiting, its system and the last check.`,
  `- ${CHECK_TOOL_NAME}: render a design, save PNGs and list what to fix.`,
  '- /design and /page start a design with the rules attached. To build a design system with the user, use /design-system or the design-system-builder skill.',
  `- When the user says "this", "the selected one" or "my comments", call ${READ_TOOL_NAME} first. Without these tools, read the comments in design.json and .chamber/check.json yourself; never change either.`,
];

const workflow = (presets: BundledSkillInput['presets']): string[] => [
  '- The Design Chamber note in your instructions names the designs folder. Without it, ask the user (the default is ~/Documents/Designs).',
  "- Every design is its own folder, <slug>/ (lower-case letters, digits and hyphens, starting with a letter or digit, at most 63 characters), never a loose file. Use a new slug for a new design; never edit another design's folder unless the user asks.",
  '- A page is one index.html shown full screen. A canvas is a wall of screens, screens/<id>.html, each at several device sizes. Make a canvas when the user says canvas or the work has several screens, steps or boards.',
  '- Write design.json first, then the HTML, then tokens.css, DESIGN.md and assets/. design.json holds "version": 1, "kind" ("page" or "canvas"), "title", "updated", "viewports", and "screens" for a canvas. In an existing design.json change only title, updated, viewports, screens, designSystem, tweaks and folderRequest, and keep every other key as it is.',
  '- Set "updated" (and "created" for a new design.json) to the real current time. Write the title in plain words, with no em dashes.',
  `- ${PROJECT_LINE}`,
  '- When a design is ready, show it with a DesignCard block. To let the user pick between directions you made as separate design folders, ask with DirectionPick. Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall. Write each in a fenced openui-lang code block whose first line is root = Stack([...]): root = Stack([DesignCard("<slug>")]) or root = Stack([DirectionPick("Which direction?", "Bold|Calm", "pricing-a|pricing-b")]).',
  '- Never touch .versions/, .chamber/, .thumb.png or .trash/ in a design folder.',
  "- Design systems live in _systems/<id>/. Write there only when the user or Design Chamber asks you to make or change a system; never set its status. A design's copy of its system is its system/ folder: read it, never change it.",
  "- A design task never writes a project's repo; a system's repo changes only from its own chat, after the user approves a diff.",
  '- Folders are the user\'s tags in the library; nothing moves on disk. Only when the user asks, add a design to an existing folder with design.json "folderRequest": { "add": ["<name>"], "at": "<now>" } (or "remove"). The names are in .chamber/folders.json in the designs folder: read it, never write it. Never create, rename or delete folders.',
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
    "Design Chamber shows the user's designs inside OpenChamber. Follow this skill whenever you make or change one.",
    '',
    '## What you can do',
    '',
    ...toolLines(),
    '',
    '## How to work',
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
