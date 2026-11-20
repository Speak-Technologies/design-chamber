// The messages Design Chamber sends to a design system's chat (documentation/specs/
// phase-2-5-technical.md §8.5, §8.10): make, ask, review, resync-notes, continue and living-page,
// and the system chip. Pure and deterministic, no Node imports. Every text is at most
// `HOST_TEXT_MAX` (16 000) characters: the user's own words are never cut (an ask that does not fit
// throws `SystemPromptTooLongError`); everything else is clipped or counted to fit.
//
// Names, notes and paths come from files an agent wrote, so each is flattened to one line where it
// sits inside our sentences; the user's words keep their line breaks, indented under their label.

import { CHIP_TEXT_HARD_MAX, HOST_ATTACH_TITLE_MAX, HOST_ATTACH_URL_MAX, HOST_TEXT_MAX, SYSTEM_BUILD_HEADER_MAX, SYSTEM_SKILL_TEXT_MAX } from '../limits.ts';
import { CHIP_PROVIDER_ID, type BuildChipData, type Chip, type SystemChipData, type SystemSection } from '../types.ts';
import { markChipUrl } from './chip.ts';
import { clip, indentContinuation, joinFolder, oneLine } from './context.ts';
import { SYSTEM_INJECTION_REPO_TAIL, SYSTEM_INJECTION_SENTENCE } from './system-rules.ts';

/** What every system message knows about the system. */
export type SystemPromptSystem = {
  id: string;
  name: string;
  /** Absolute `_systems/<id>`. */
  folder: string;
  /** A repo-backed system's home; null for an internal one. */
  repo: { directory: string; folder: string; livingPage: string } | null;
};

/** The user's words do not fit even alone; `over` is how many characters to remove. */
export class SystemPromptTooLongError extends Error {
  readonly over: number;
  constructor(over: number) {
    super(`The message is ${over} characters over the host limit.`);
    this.name = 'SystemPromptTooLongError';
    this.over = over;
  }
}

/** Names listed in a resync-notes message (§8.5). */
export const SYSTEM_PROMPT_NAMES_MAX = 40;
/** Scanned files named in a make message (§8.5). */
export const SYSTEM_PROMPT_SCANNED_MAX = 20;
const PATH_SHOWN_MAX = 300;
const NAME_SHOWN_MAX = 80;

const SECTION_LABEL: Readonly<Record<SystemSection, string>> = {
  overview: 'Overview',
  colours: 'Colours',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Radius',
  shadows: 'Shadows',
  layers: 'Layers',
  sizes: 'Sizes',
  components: 'Components',
  patterns: 'Patterns & voice',
  brand: 'Brand & marketing',
  assets: 'Assets',
};

export const sectionLabel = (section: SystemSection): string => SECTION_LABEL[section];

const nameOf = (system: SystemPromptSystem): string => clip(oneLine(system.name), NAME_SHOWN_MAX);
export const systemRulesPathOf = (folder: string): string => joinFolder(folder, '.chamber', 'RULES.md');
const repoFolderOf = (repo: NonNullable<SystemPromptSystem['repo']>): string => joinFolder(repo.directory, ...repo.folder.split('/'));

const injection = (system: SystemPromptSystem): string => (system.repo === null ? SYSTEM_INJECTION_SENTENCE : `${SYSTEM_INJECTION_SENTENCE} ${SYSTEM_INJECTION_REPO_TAIL}`);

/** §8.10: an ask or a review of a repo-backed system goes through a reviewed diff. */
const repoGate = (system: SystemPromptSystem): string[] =>
  system.repo === null
    ? []
    : [`${nameOf(system)} lives in ${repoFolderOf(system.repo)}. Propose the change as a reviewed diff and wait for the user's approval before you write the repo. After you write it, stamp \`applied\` in BUILD.json.`];

const header = (system: SystemPromptSystem, lead: string): string =>
  `[Design Chamber] ${lead} "${nameOf(system)}". Folder: ${system.folder}. Rules: ${systemRulesPathOf(system.folder)}`;

const fitOrThrow = (text: string, max: number): string => {
  if (text.length > max) throw new SystemPromptTooLongError(text.length - max);
  return text;
};

// ---- the chip ----

/** The chip's text (§8.5 `continue`: the system chip only). */
export const buildSystemChipText = (system: SystemPromptSystem): string =>
  [
    header(system, 'Design system'),
    `Read ${systemRulesPathOf(system.folder)} first, in full: it is part of this message. Then read ${joinFolder(system.folder, 'OVERVIEW.md')}.`,
    ...(system.repo === null
      ? [`Write only inside ${system.folder}. Never edit .chamber/ or .versions/, and never mark the system ready.`]
      : [`${nameOf(system)} lives in ${repoFolderOf(system.repo)}. Change it only after the user approves a reviewed diff in this chat.`]),
    injection(system),
  ].join('\n');

/** The attach chip for a system: `id = system:<id>`, the folder URL with the system's marker (its created time). */
export const buildSystemChip = (system: SystemPromptSystem, input: { folderUrl: string; created: string }): Chip<SystemChipData> => {
  const marked = markChipUrl(input.folderUrl, input.created);
  return {
    providerId: CHIP_PROVIDER_ID,
    id: `system:${system.id}`,
    title: clip(`${oneLine(system.name)} (design system)`, HOST_ATTACH_TITLE_MAX),
    url: marked.length <= HOST_ATTACH_URL_MAX ? marked : input.folderUrl.length <= HOST_ATTACH_URL_MAX ? input.folderUrl : '',
    text: buildSystemChipText(system),
    data: { system: system.id },
  };
};

/** `continue`: the chip says everything. */
export const buildSystemContinuePrompt = (system: SystemPromptSystem): string => buildSystemChipText(system);

// ---- make ----

export type SystemMakeInput = {
  system: SystemPromptSystem;
  /** The project the system is made from, or null. */
  projectDirectory: string | null;
  /** Project-relative files that held tokens. */
  scanned: readonly string[];
  /** Files the scan could not read itself, for the agent, with the reason. */
  forAgent: readonly { path: string; why: string }[];
  /** Absolute brand files the user added. */
  brandFiles: readonly string[];
  /** The user's description, verbatim, or null. */
  description: string | null;
  preset: string | null;
  checkCommand: string | null;
  maxChars?: number;
};

export const buildSystemMakePrompt = (input: SystemMakeInput): string => {
  const { system } = input;
  const max = input.maxChars ?? HOST_TEXT_MAX;
  const shown = input.scanned.slice(0, SYSTEM_PROMPT_SCANNED_MAX).map((file) => clip(oneLine(file), PATH_SHOWN_MAX));
  const more = input.scanned.length - shown.length;
  const description = input.description === null ? '' : input.description.trim();
  const lines = [
    `[Design Chamber] Make the design system "${nameOf(system)}". Folder: ${system.folder}. Rules: ${systemRulesPathOf(system.folder)}`,
    ...(input.projectDirectory === null ? [] : [`Project: ${input.projectDirectory}`]),
    ...(shown.length === 0 ? [] : [`Files that held tokens: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`]),
    ...input.forAgent.slice(0, SYSTEM_PROMPT_SCANNED_MAX).map((entry) => `Read yourself: ${clip(oneLine(entry.path), PATH_SHOWN_MAX)} (${clip(oneLine(entry.why), 200)})`),
    ...(input.brandFiles.length === 0 ? [] : [`Brand files: ${input.brandFiles.slice(0, SYSTEM_PROMPT_SCANNED_MAX).map((file) => clip(oneLine(file), PATH_SHOWN_MAX)).join(', ')}`]),
    ...(description === '' ? [] : [`The user's words: "${indentContinuation(description, '  ')}"`]),
    ...(input.preset === null ? [] : [`Style preset: ${oneLine(input.preset)}`]),
    "Design Chamber already wrote the values it could read into tokens.css. Write OVERVIEW.md, the usage notes and components in system.json, and anything it couldn't read.",
    `${input.projectDirectory === null ? '' : `Don't change anything in ${input.projectDirectory}. `}Write only in ${system.folder}.`,
    SYSTEM_INJECTION_SENTENCE,
    input.checkCommand === null ? `Check the system with the design_check tool with { "system": "${system.id}" } before you say you are done.` : `Check the system before you say you are done: ${input.checkCommand}`,
  ];
  return fitOrThrow(lines.join('\n'), max);
};

// ---- ask, review ----

export type SystemAskInput = {
  system: SystemPromptSystem;
  /** The user's words, trimmed; never cut. */
  text: string;
  /** The board entry the question is about (already checked against the detail), or null. */
  entry: string | null;
  /** The section the user had open, or null. */
  section: SystemSection | null;
  maxChars?: number;
};

export const buildSystemAskPrompt = (input: SystemAskInput): string => {
  const { system } = input;
  const about = input.entry !== null ? [`About this entry: ${input.entry}`] : input.section !== null ? [`About the section: ${sectionLabel(input.section)}`] : [];
  return fitOrThrow(
    [
      header(system, 'Request about the design system'),
      ...about,
      input.text,
      ...repoGate(system),
      'Change only what this asks; keep everything else. Never mark the system ready.',
    ].join('\n'),
    input.maxChars ?? HOST_TEXT_MAX,
  );
};

export type SystemReviewInput = { system: SystemPromptSystem; section: SystemSection; note: string; maxChars?: number };

export const buildSystemReviewPrompt = (input: SystemReviewInput): string => {
  const max = input.maxChars ?? HOST_TEXT_MAX;
  const build = (note: string): string =>
    [
      header(input.system, 'Review of the design system'),
      `The user marked ${sectionLabel(input.section)} as needing work: ${indentContinuation(note, '  ')}`,
      ...repoGate(input.system),
      'Fix what the note asks in that section only. Never mark the system ready.',
    ].join('\n');
  const full = build(input.note.trim());
  if (full.length <= max) return full;
  // A stored note is already capped; this only guards an unusual folder path.
  return build(clip(input.note.trim(), Math.max(0, input.note.trim().length - (full.length - max))));
};

// ---- resync notes ----

export type SystemResyncNotesInput = {
  system: SystemPromptSystem;
  /** The version the user compared against. */
  before: string;
  tokens: { added: readonly string[]; changed: readonly string[] };
  components: { added: readonly string[]; changed: readonly string[] };
};

const namesLine = (label: string, names: readonly string[]): string[] => {
  if (names.length === 0) return [];
  const shown = names.slice(0, SYSTEM_PROMPT_NAMES_MAX).map((name) => clip(oneLine(name), NAME_SHOWN_MAX));
  const more = names.length - shown.length;
  return [`${label}: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`];
};

export const buildSystemResyncNotesPrompt = (input: SystemResyncNotesInput): string =>
  fitOrThrow(
    [
      header(input.system, 'Re-sync of the design system'),
      `Since version ${oneLine(input.before)} these changed from the project's code:`,
      ...namesLine('Tokens added', input.tokens.added),
      ...namesLine('Tokens changed', input.tokens.changed),
      ...namesLine('Components added', input.components.added),
      ...namesLine('Components changed', input.components.changed),
      'Update the usage notes in system.json and OVERVIEW.md where these changes need words. Leave the values as they are.',
    ].join('\n'),
    HOST_TEXT_MAX,
  );

// ---- living page (§8.10) ----

export type SystemLivingPageInput = {
  system: SystemPromptSystem & { repo: NonNullable<SystemPromptSystem['repo']> };
  /** Absolute staged `_systems/<id>/.chamber/living-page.html`. */
  stagedFile: string;
  revision: number;
};

export const buildSystemLivingPagePrompt = (input: SystemLivingPageInput): string => {
  const { system } = input;
  const target = joinFolder(system.repo.directory, ...system.repo.livingPage.split('/'));
  const name = nameOf(system);
  return fitOrThrow(
    [
      `[Design Chamber] The user asked you to update the living page of the design system "${name}". This message is their approval to commit one file and nothing else: ` +
        `copy ${input.stagedFile} byte for byte to ${target}, commit only that file ("Update ${name} living page to revision ${input.revision}"), and say in your reply that you did.`,
      `Don't change any other file in ${system.repo.directory}; anything else needs a new reviewed diff and the user's approval. If that file has changes you didn't make, stop and ask.`,
    ].join('\n'),
    HOST_TEXT_MAX,
  );
};

/** A hand-edit block goes first, then a blank line, then the message (as for designs, §8.5). */
export const withSystemHandEdits = (block: string | null, text: string): string => (block === null ? text : `${block}\n\n${text}`);

// ---- the build chip and the ticket's rules file (§8.7, §2.12) ----

/** What the /design-system chip and its rules file know about the build. */
export type SystemBuildChipInput = {
  ticket: string;
  /** The user's words after the command, trimmed (≤ BRIEF_MAX); '' when none. */
  brief: string;
  /** The chat's project folder as the ticket records it, or null (an internal system). */
  projectDirectory: string | null;
  /** Absolute `<root>/.chamber/system-builds/<ticket>.md`. */
  rulesFile: string;
};

const NO_PROJECT_SENTENCE = 'No project folder is open in this chat, so the system will live in Design Chamber; say so as an assumption.';

/** The chip's text (§8.7): read the ticket file, the user's words, the project, start with round one, the ticket, the injection sentence. */
export const buildSystemBuildChipText = (input: SystemBuildChipInput): string => {
  const words = input.brief.trim();
  return fitOrThrow(
    [
      `[Design Chamber] Build a design system with the user. Read ${clip(input.rulesFile, PATH_SHOWN_MAX * 2)} first; it is part of your instructions (the design-system-builder skill, with this chat's details).`,
      words === '' ? 'The user added no words to the command; ask what the system is for in round one.' : `The user's words: "${indentContinuation(words, '  ')}"`,
      input.projectDirectory === null ? NO_PROJECT_SENTENCE : `Project: ${clip(input.projectDirectory, PATH_SHOWN_MAX * 2)}`,
      'Start with round one of the interview. Write nothing until the user answers it.',
      `Build ticket: ${input.ticket}. Put it in BUILD.json as "ticket".`,
      `${SYSTEM_INJECTION_SENTENCE} ${SYSTEM_INJECTION_REPO_TAIL}`,
    ].join('\n'),
    CHIP_TEXT_HARD_MAX,
  );
};

/**
 * The attach chip for a build: `id = system-build:<ticket>`, title "New design system", the rules file's
 * URL with the ticket's marker (its created time, so a chip never links a later ticket), data `{ build }`.
 */
export const buildSystemBuildChip = (input: SystemBuildChipInput & { rulesUrl: string; created: string }): Chip<BuildChipData> => {
  const marked = markChipUrl(input.rulesUrl, input.created);
  return {
    providerId: CHIP_PROVIDER_ID,
    id: `system-build:${input.ticket}`,
    title: 'New design system',
    url: marked.length <= HOST_ATTACH_URL_MAX ? marked : input.rulesUrl.length <= HOST_ATTACH_URL_MAX ? input.rulesUrl : '',
    text: buildSystemBuildChipText(input),
    data: { build: input.ticket },
  };
};

/** Paths in the ticket header are clipped so the header always fits SYSTEM_BUILD_HEADER_MAX. */
const HEADER_PATH_MAX = 240;

/** The header of `<ticket>.md` (§2.12), at most SYSTEM_BUILD_HEADER_MAX characters. */
export const buildSystemTicketHeader = (input: { ticket: string; root: string; projectDirectory: string | null }): string => {
  const header = [
    `# Design system build ${input.ticket}`,
    '',
    'This file is part of your instructions.',
    '',
    `- Ticket: ${input.ticket}`,
    `- Designs folder: ${clip(input.root, HEADER_PATH_MAX)}`,
    `- Design systems: ${clip(joinFolder(input.root, '_systems'), HEADER_PATH_MAX + 10)}`,
    `- Project folder: ${input.projectDirectory === null ? 'none. The system will live in Design Chamber.' : clip(input.projectDirectory, HEADER_PATH_MAX)}`,
    '',
  ].join('\n');
  return clip(header, SYSTEM_BUILD_HEADER_MAX);
};

/** `<ticket>.md`: the header, then the builder body (§2.12); at most SYSTEM_SKILL_TEXT_MAX + SYSTEM_BUILD_HEADER_MAX. */
export const buildSystemTicketRules = (header: string, body: string): string => fitOrThrow(`${header}\n${body}`, SYSTEM_SKILL_TEXT_MAX + SYSTEM_BUILD_HEADER_MAX);
