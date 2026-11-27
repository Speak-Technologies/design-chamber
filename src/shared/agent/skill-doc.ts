// The bundled `design-chamber` skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4): the
// SKILL.md that scripts/build.mjs writes to dist/skills/design-chamber/, which reaches every
// agent while the extension is on. Pure and deterministic, no Node imports; the build runs it
// under Node's type stripping.
//
// It is static and shipped to everyone, so it holds no absolute path: the designs folder and the
// absolute reference folder are in the instructions note (src/shared/agent/instructions.ts). The
// rule text stays in `rules/**`; the verbatim wrapper, the offline rules and the check section are
// the same pieces RULES.md uses (src/shared/agent/rules-doc.ts), so the two never drift apart.
//
// SKILL.md keeps the core (the workflow, DESIGN-RULES.md, the offline rules, the check) within
// BUNDLED_SKILL_TEXT_MAX; longer detail ships beside it in reference/ (`SKILL_REFERENCE_DOCS`,
// copied and capped by scripts/build-skill.mjs), and SKILL.md says in a few lines what each holds.

import { CHECK_TOOL_NAME, LIST_TOOL_NAME, PROJECT_LINE, READ_TOOL_NAME, SKILL_DESCRIPTION, SKILL_NAME } from './guide.ts';
import { checkSection, renderingSection, verbatim } from './rules-doc.ts';

/** The built SKILL.md's cap; the build refuses a longer one. */
export const BUNDLED_SKILL_TEXT_MAX = 20_000;

/** The folder beside SKILL.md that holds the reference docs. */
export const SKILL_REFERENCE_FOLDER = 'reference';

/** One reference doc's cap, and all of them together. */
export const SKILL_REFERENCE_DOC_MAX = 12_000;
export const SKILL_REFERENCE_TOTAL_MAX = 40_000;

/** The reference docs SKILL.md points at, by file name. */
export const SKILL_REFERENCE_DOCS = ['design-practice.md', 'questions.md'] as const;

/** The DESIGN-RULES.md section that ships as reference/design-practice.md instead of inline. */
const PRACTICE_HEADING = '## 4. Design best practices';

/**
 * rules/DESIGN-RULES.md without its §4, and §4 on its own, both verbatim. Throws when the heading is
 * gone (the rules author renamed it), so the build fails with a plain sentence rather than ship a
 * skill that points at an empty doc.
 */
export const splitDesignRules = (designRules: string): { core: string; practice: string } => {
  const text = designRules.replace(/\r\n?/g, '\n');
  // Where the heading line starts in `text` (the leading newline lets it match on the first line too).
  const start = `\n${text}`.indexOf(`\n${PRACTICE_HEADING}\n`);
  if (start === -1) throw new Error(`rules/DESIGN-RULES.md has no "${PRACTICE_HEADING}" heading; the skill ships that section as ${SKILL_REFERENCE_FOLDER}/design-practice.md.`);
  const next = text.indexOf('\n## ', start + PRACTICE_HEADING.length);
  const end = next === -1 ? text.length : next + 1;
  const pointer = `${PRACTICE_HEADING}\n\nIn ${SKILL_REFERENCE_FOLDER}/design-practice.md next to this file: hierarchy, type, spacing, colour and contrast, layout, responsive, states, accessibility, motion, real content and character. Read it before your first screen.\n\n`;
  return { core: `${text.slice(0, start)}${pointer}${text.slice(end)}`, practice: text.slice(start, end).replace(/\n+$/, '\n') };
};

/** The reference docs as they ship, in SKILL_REFERENCE_DOCS order: the build checks each and writes them beside SKILL.md. */
export const buildSkillReferenceDocs = ({ designRules, questions }: { designRules: string; questions: string }): Array<{ name: (typeof SKILL_REFERENCE_DOCS)[number]; text: string }> => [
  { name: 'design-practice.md', text: `# Design best practices\n\nPart of Design Chamber's design rules (rules/DESIGN-RULES.md §4).\n\n${splitDesignRules(designRules).practice}` },
  { name: 'questions.md', text: questions.replace(/\r\n?/g, '\n') },
];

export type BundledSkillInput = {
  /** `rules/DESIGN-RULES.md`, verbatim. */
  designRules: string;
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
  '- When the user points at a design system a project already has (a page, docs, components), read those first and build from what is there.',
  '- When a design is ready, show it with a DesignCard block. To let the user pick between directions you made as separate design folders, ask with DirectionPick. Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall. Write each in a fenced openui-lang code block whose first line is root = Stack([...]): root = Stack([DesignCard("<slug>")]) or root = Stack([DirectionPick("Which direction?", "Bold|Calm", "pricing-a|pricing-b")]).',
  '- Never touch .versions/, .chamber/, .thumb.png or .trash/ in a design folder.',
  "- Design systems live in _systems/<id>/. Write there only when the user or Design Chamber asks you to make or change a system; never set its status. A design's copy of its system is its system/ folder: read it, never change it.",
  "- A design task never writes a project's repo; a system's repo changes only from its own chat, after the user approves a diff.",
  '- Folders are the user\'s tags in the library; nothing moves on disk. Only when the user asks, add a design to an existing folder with design.json "folderRequest": { "add": ["<name>"], "at": "<now>" } (or "remove"). The names are in .chamber/folders.json in the designs folder: read it, never write it. Never create, rename or delete folders.',
  presetsLine(presets),
];

/** rules/QUESTIONS.md in short; the whole protocol is reference/questions.md. */
const questionsSection = (): string[] => [
  '## Questions to ask',
  '',
  `Before a new design, read ${SKILL_REFERENCE_FOLDER}/questions.md next to this file: when to ask, how, and a first-reply template. In short:`,
  '',
  "- Read the brief, the project and the design folder first. Never ask what the files already answer.",
  '- When a missing answer would change the design, ask once: 3 to 6 numbered questions in one message, each with a bold recommended default, then wait. Go ahead with an "Assumptions" list when the user said go, for a small edit, or when the project already settles it.',
  '- Always settle the viewports: from the project, else recommend Laptop 1280×800 and Phone 390×844, and record them in design.json.',
  '- When the look is open, offer two or three named directions in the same message and recommend one.',
];

export const buildBundledSkill = ({ designRules, presets }: BundledSkillInput): string =>
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
    ...verbatim(`rules/DESIGN-RULES.md, §4 in ${SKILL_REFERENCE_FOLDER}/design-practice.md`, splitDesignRules(designRules).core),
    '',
    ...questionsSection(),
    '',
    ...renderingSection(),
    '',
    ...checkSection({ tool: CHECK_TOOL_NAME, command: null }),
    '',
  ].join('\n');
