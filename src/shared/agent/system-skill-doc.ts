// The design-system-builder protocol (documentation/specs/phase-2-5-technical.md §8.8, AD-16, AD-17):
// the text an agent follows when the user runs /design-system. Pure and deterministic, no Node imports.
//
// T12a ships the body every build ticket's rules file carries (§2.12: a header, then this body), so an
// agent without the skill has the protocol. T15 completes it (the SystemAsk argument shapes, the full
// reviewed-diff and living-page sections, the build step that writes `dist/skills/design-system-builder/`),
// keeping `buildSystemSkillBody` as the one source both delivery paths read.

import { SYSTEM_SKILL_TEXT_MAX } from '../limits.ts';
import { CHECK_TOOL_NAME } from './guide.ts';
import { SYSTEM_INJECTION_REPO_TAIL, SYSTEM_INJECTION_SENTENCE } from './system-rules.ts';

/** The skill's name; it must never equal a command name (`design-system`), or the host hides the command (AD-16). */
export const SYSTEM_SKILL_NAME = 'design-system-builder';

export const SYSTEM_SKILL_DESCRIPTION =
  'Use when the user asks to build, extract, fix or document a design system for an app, or runs /design-system. Interviews first, then builds the system for Design Chamber.';

export type SystemSkillInput = {
  /** `rules/SYSTEM-QUESTIONS.md`, verbatim (§8.9). */
  systemQuestions: string;
  /** `systemContractSection()` lines (one source with a system's RULES.md, §8.4). */
  contract: readonly string[];
};

/** The skill body is over `SYSTEM_SKILL_TEXT_MAX`; the build and the ticket route refuse it. */
export class SystemSkillTooLongError extends Error {
  readonly length: number;
  constructor(length: number) {
    super(`The design-system-builder text is ${length} characters; the cap is ${SYSTEM_SKILL_TEXT_MAX}.`);
    this.name = 'SystemSkillTooLongError';
    this.length = length;
  }
}

const whenThisApplies = (): string[] => [
  '## When this applies',
  '',
  '- The user ran /design-system, or asked you to build, extract, fix or document a design system with this skill.',
  '- Design systems live in the Designs folder under `_systems/<id>/`. The ticket file the /design-system chip names gives the Designs folder, the project folder and the ticket.',
  "- No ticket file (no /design-system chip in this chat): don't start the interview. Ask the user to run /design-system.",
  "- Derive the system's name from the project and state it as an assumption; the user can rename it in Design Chamber.",
  '- If a skill or command named design-system already exists, /design-system may be hidden. The user can still say: build a design system with the design-system-builder skill.',
];

const asking = (): string[] => [
  '## Asking',
  '',
  '- Ask round one before you read any code, and round two after you have read it. Each round is one message with the recommended answers in bold, ending with "Reply with changes, or say go to accept the defaults."',
  '- When the SystemAsk block is available in this chat, use it for each round and for the diff. Use SystemAsk only in a chat with a /design-system ticket; never for other diffs.',
  "- If the block can't be shown or the user types instead, ask the same thing in text; a typed reply is always valid.",
  '- A note on its own is never approval. Words that ask for any change are never approval.',
];

const recording = (): string[] => [
  '## Recording the answers',
  '',
  '- After round one, write `_systems/<id>/BUILD.json` (`version: 1`, `ticket`, `name`, `home`, `repo`, `code`, `mode`, `dark`, `calls`, `access`, `round`, `applied: null`). Update it after round two (`round: 2`, then `"done"`).',
  '- The id: lower-case letters, digits and dashes from the name; if `_systems/<id>` exists, add -2.',
  '- `home` is `internal` (the system lives in Design Chamber) or `repo` (it lives in the project, in `repo.folder`, default `design-system/`). A repo home must be the project folder of this chat or a folder inside it.',
  '- OVERVIEW.md names the home, the mode, the covered areas and the dark-mode decision. For describe only it says: Describes the intended system; the code was left unchanged.',
];

const files = (contract: readonly string[]): string[] => [
  ...contract,
  '',
  '- Internal home: write the files into `_systems/<id>/`. Repo home: the same files go into `<repo>/<folder>/`, only after the user approves the diff.',
  '- Seed values from `_systems/<id>/.chamber/scan.json` when it exists; read the files yourself for counts.',
];

const reviewedDiff = (): string[] => [
  '## The reviewed diff',
  '',
  '- Before you change anything in the repo, write the proposed system files into `_systems/<id>/proposal/` and describe every file you will create or change in `_systems/<id>/PROPOSAL.json` with a new id each time anything changes. Say the diff in your reply as text.',
  "- Approval is the user's own answer for your latest proposal. Without it, write nothing to the repo. New files are created, never written over an existing file.",
  '- Declined: write nothing to the repo. Describe only instead: set `mode: "describe"` and propose new files only, with a new id. Stop: Design Chamber has already removed the draft; write nothing more under `_systems/<id>/` and say so.',
  '- Describe only never changes the app\'s existing code.',
  '- After you write the repo, set `applied` in BUILD.json (time, parts, skipped, proposal). Design Chamber then reads the repo.',
];

const never = (): string[] => [
  '## What you never do',
  '',
  "- Write `_systems/<id>/snapshot/` or `.chamber/`, or mark a system ready.",
  "- Change a system's home after anything has been applied.",
  '- Write a repo from a design task, or reuse a proposal id for different content.',
];

const checks = (): string[] => [
  '## Check your work',
  '',
  `Check the system with the ${CHECK_TOOL_NAME} tool with { "system": "<id>" } before you say you are done. If you don't have that tool, run the check command from Design Chamber's instructions with --system <id>.`,
];

/** The builder body: when it applies, asking, the interview (verbatim), recording, the files, the diff, the never list, checks. */
export const buildSystemSkillBody = (input: SystemSkillInput): string => {
  const text = [
    '# Building a design system with the user',
    '',
    ...whenThisApplies(),
    '',
    ...asking(),
    '',
    '## The interview (rules/SYSTEM-QUESTIONS.md)',
    '',
    input.systemQuestions.trim(),
    '',
    ...recording(),
    '',
    ...files(input.contract),
    '',
    ...reviewedDiff(),
    '',
    ...never(),
    '',
    ...checks(),
    '',
    `${SYSTEM_INJECTION_SENTENCE} ${SYSTEM_INJECTION_REPO_TAIL}`,
    '',
  ].join('\n');
  if (text.length > SYSTEM_SKILL_TEXT_MAX) throw new SystemSkillTooLongError(text.length);
  return text;
};
