// The Design Chamber note OpenChamber puts in every agent's instructions while the extension is
// on (documentation/specs/phase-1-5-sdk-2-7.md §U2.2). It reaches every session in every project,
// so it stays short (about 900 characters with a usual root): Design Chamber is on, where designs
// go, Use the project, and the three tools. Everything else is in the design-chamber skill, which
// the note tells the agent to load. Pure and deterministic, no Node imports.
//
// The root, the check command built from it and the skill's reference folder are the only outside
// inputs. A control character would start a new instruction line, so each is refused here as well
// as in `PUT /settings`.

import { SERVICE_INSTRUCTIONS_MAX } from '@openchamber/sdk';

import { assertRoot, capped, CHECK_TOOL_NAME, code, joinWith, LIST_TOOL_NAME, PROJECT_LINE, READ_TOOL_NAME, SKILL_NAME } from './guide.ts';

export type InstructionsInput = {
  /** Absolute designs root. */
  root: string;
  /** Decides the folder separator and the PowerShell hint. */
  platform: NodeJS.Platform;
  /** The launcher's check command with the literal `<slug>`, or `null` when the launcher is not in place. */
  checkCommand: string | null;
  /** The bundled skill's absolute `reference/` folder, or `null` (absent) when it is not installed. */
  referenceDir?: string | null;
};

const toolsLine = (): string =>
  `- Tools: ${LIST_TOOL_NAME} (the library and what the user has open), ${READ_TOOL_NAME} (one design's pins, state and last check) and ${CHECK_TOOL_NAME} (renders a design and lists what to fix; run it before you say a design is done).`;

/** Only with the launcher in place: how an agent without the tool checks (any agent outside OpenChamber's OpenCode). */
const commandLine = (checkCommand: string | null, platform: NodeJS.Platform): string[] => {
  if (checkCommand === null) return [];
  const powershell = platform === 'win32' ? ' In PowerShell, put & in front.' : '';
  return [`- Without ${CHECK_TOOL_NAME}, run ${code(checkCommand)} with the design's folder name for <slug>.${powershell}`];
};

const skillLine = (referenceDir: string | null): string =>
  `- Load the ${SKILL_NAME} skill first: it has the design rules, the design.json format and the chat blocks.` +
  (referenceDir === null ? '' : ` Its longer reference files are in ${code(referenceDir)}.`);

const compose = (root: string, platform: NodeJS.Platform, checkCommand: string | null, referenceDir: string | null): string => {
  const sep = platform === 'win32' ? '\\' : '/';
  return [
    `Design Chamber is on. It shows the designs in the user's designs folder: ${code(root)}`,
    `- Save each design, mockup, UI screen, landing page or prototype there in its own folder, ${code(joinWith(sep, root, '<slug>') + sep)}, never as a loose file.`,
    skillLine(referenceDir),
    `- ${PROJECT_LINE}`,
    toolsLine(),
    ...commandLine(checkCommand, platform),
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
 * the reference folder (the skill names it too), and past that the builder throws rather than cut
 * a path in half.
 */
export const buildInstructions = ({ root, platform, checkCommand, referenceDir = null }: InstructionsInput): string => {
  assertRoot(root);
  if (checkCommand !== null) assertRoot(checkCommand, 'check command');
  if (referenceDir !== null) assertRoot(referenceDir, 'skill reference folder');
  for (const [command, reference] of [[checkCommand, referenceDir], [null, referenceDir], [null, null]] as const) {
    const text = compose(root, platform, command, reference);
    if (text.length <= SERVICE_INSTRUCTIONS_MAX) return text;
  }
  return capped(compose(root, platform, null, null), SERVICE_INSTRUCTIONS_MAX, 'instructions');
};
