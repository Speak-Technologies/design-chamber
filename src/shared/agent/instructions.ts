// The Design Chamber note OpenChamber puts in every agent's instructions while the extension is
// on (documentation/specs/phase-1-5-sdk-2-7.md §U2.2). It reaches every chat in every project,
// so it holds only what an agent acts on: where designs go, that the skill has the rules, how to
// check, which chat blocks exist. Pure and deterministic, no Node imports.
//
// The root (and the check command built from it) is the only outside input. A control character
// would start a new instruction line, so it is refused here as well as in `PUT /settings`.

import { SERVICE_INSTRUCTIONS_MAX } from '@openchamber/sdk';

import { assertRoot, capped, CHECK_TOOL_NAME, code, joinWith, PROJECT_LINE, SKILL_NAME } from './guide.ts';

export type InstructionsInput = {
  /** Absolute designs root. */
  root: string;
  /** Decides the folder separator and the PowerShell hint. */
  platform: NodeJS.Platform;
  /** The launcher's check command with the literal `<slug>`, or `null` when the launcher is not in place. */
  checkCommand: string | null;
};

const checkLine = (checkCommand: string | null, platform: NodeJS.Platform): string => {
  const tool = `- Before you say a design is done, check it with the ${CHECK_TOOL_NAME} tool`;
  const after = 'Fix every error and look at the PNGs it saves.';
  if (checkCommand === null) return `${tool}. ${after}`;
  const powershell = platform === 'win32' ? ' (In PowerShell, put & in front.)' : '';
  return `${tool}, or, if you don't have that tool, run ${code(checkCommand)} with the design's folder name in place of <slug>.${powershell} ${after}`;
};

/** Use the project and the native agent (spec §2.5); the skill says the same, so a root too long for the note drops them. */
const PROJECT_LINES: readonly string[] = [
  `- ${PROJECT_LINE}`,
  "- To see the library, the user's pins and what they have open, use design_list and design_read.",
];

const compose = (root: string, platform: NodeJS.Platform, checkCommand: string | null, projectLines = true): string => {
  const sep = platform === 'win32' ? '\\' : '/';
  return [
    `Design Chamber is on. It shows the designs saved in the user's designs folder: ${code(root)}`,
    `- When the user asks for a design, mockup, UI screen, landing page or prototype, save it there in its own folder, ${code(joinWith(sep, root, '<slug>') + sep)}, never as a loose file. Load the ${SKILL_NAME} skill first: it has the design rules and the design.json format.`,
    '- A page is one index.html. A canvas is several screens/<id>.html files listed in design.json.',
    checkLine(checkCommand, platform),
    `- When a design is ready, show it with a DesignCard block. To let the user pick between directions you made as separate design folders, ask with DirectionPick. Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall. Write each in a fenced openui-lang code block whose first line is root = Stack([...]), for example ${code('root = Stack([DesignCard("<slug>")])')} or ${code('root = Stack([DirectionPick("Which direction?", "Bold|Calm", "pricing-a|pricing-b")])')}. A root without Stack([...]) is not drawn.`,
    '- The user can type /design or /page to start a design with the project\'s rules attached.',
    '- Design systems live in `_systems/<id>/` in the designs folder. Write there only when the user or Design Chamber asks you to make or change a system; never set its status.',
    "- A design's copy of its system is its system/ folder: read it, never change it.",
    '- To build a design system with the user, use /design-system or the design-system-builder skill.',
    "- A design task never writes a project's repo; a system's repo changes only from its own chat, after the user approves a diff.",
    '- Folders in the library are the user\'s tags. Add a design to an existing folder only when the user asks, with design.json "folderRequest" (the design-chamber skill has the format). Never create, rename or delete folders.',
    '- When the user points at a design system a project already has, read its page, docs and components before you build from it.',
    ...(projectLines ? PROJECT_LINES : []),
  ].join('\n');
};

/** A project pin's text (Phase 2.5 §8.6, AD-12): at most this many characters. */
export const PIN_INSTRUCTION_MAX = 200;

/** The one line a pinned project's sessions read beside the global note (SP-2: additive per directory). */
export const buildPinInstruction = (systemName: string): string => {
  const name = systemName.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const text = (shown: string): string => `Designs for this project use the design system "${shown}" in Design Chamber.`;
  const full = text(name);
  if (full.length <= PIN_INSTRUCTION_MAX) return full;
  return text(`${name.slice(0, Math.max(1, name.length - (full.length - PIN_INSTRUCTION_MAX) - 1)).trimEnd()}…`);
};

/**
 * The instructions text for `root`, at most `SERVICE_INSTRUCTIONS_MAX` characters. A root long
 * enough to pass the limit loses the check-command clause first (the tool is still named), then
 * the two Use the project lines (the skill has them), and past that the builder throws rather than
 * cut a path in half.
 */
export const buildInstructions = ({ root, platform, checkCommand }: InstructionsInput): string => {
  assertRoot(root);
  if (checkCommand !== null) assertRoot(checkCommand, 'check command');
  const full = compose(root, platform, checkCommand);
  if (full.length <= SERVICE_INSTRUCTIONS_MAX) return full;
  const noCommand = compose(root, platform, null);
  if (noCommand.length <= SERVICE_INSTRUCTIONS_MAX) return noCommand;
  return capped(compose(root, platform, null, false), SERVICE_INSTRUCTIONS_MAX, 'instructions');
};
