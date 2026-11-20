// The arguments of a chat block (documentation/specs/phase-1-5-sdk-2-7.md §U7.2, §U8.2), checked
// before anything is drawn or read. A model writes them, and text from a page or a ticket the agent
// read can steer that model, so every value is untrusted: slugs must be design folder names
// (`SLUG_PATTERN`, which already refuses `..`, slashes, drive letters and uppercase), labels are
// clipped text. Pure: no DOM, no host or service calls. Never throws.

import { GUEST_BLOCK_ARGS_TEXT_MAX } from '@openchamber/sdk';

import {
  DIRECTION_LABEL_MAX,
  DIRECTION_OPTIONS_MAX,
  DIRECTION_OPTIONS_MIN,
  DIRECTION_QUESTION_MAX,
  SLUG_PATTERN,
  SYSTEM_ASK_CALLS_MAX,
  SYSTEM_ASK_PROPOSED_MAX,
  SYSTEM_ASK_WHY_MAX,
  SYSTEM_BUILD_TICKET_PATTERN,
  SYSTEM_ID_PATTERN,
  SYSTEM_PROPOSAL_ID_PATTERN,
} from '../../shared/limits.ts';

export type OptionLetter = 'A' | 'B' | 'C' | 'D';

export const OPTION_LETTERS: readonly OptionLetter[] = ['A', 'B', 'C', 'D'];

export type DirectionOption = { letter: OptionLetter; label: string; slug: string };

/** One call the agent raised for round two, before the baked question set has checked its topic. */
export type SystemAskCall = { topic: string; why: string; proposed: string };

/**
 * The SystemAsk block's arguments once checked. `dropped` counts round-two calls that could not be
 * read (not an object, no topic, repeated, past the eighth); the unknown topics are dropped later,
 * against the question set (`resolveCalls` in system-ask-model.ts).
 */
export type SystemAskBlock =
  | { kind: 'interview-1'; ticket: string }
  | { kind: 'interview-2'; systemId: string; calls: SystemAskCall[]; dropped: number }
  | { kind: 'diff'; systemId: string; proposalId: string };

export type BlockArgs =
  | { name: 'DesignCard'; slug: string }
  | { name: 'DirectionPick'; question: string; options: DirectionOption[] }
  | { name: 'SystemAsk'; ask: SystemAskBlock };

export type ParsedBlock = { ok: true; block: BlockArgs } | { ok: false; reason: 'unknown-block' | 'bad-slug' | 'bad-options' | 'bad-system-ask' };

export const DEFAULT_QUESTION = 'Which direction?';

/**
 * At most `max` characters (code points, so an emoji is never cut in half), the last one an
 * ellipsis when something was cut. Runs of whitespace, newlines included, become one space.
 */
export const clipText = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= max ? flat : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
};

const textArg = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const slugOf = (value: unknown): string | null => {
  const text = textArg(value)?.trim() ?? '';
  return SLUG_PATTERN.test(text) ? text : null;
};

/** A `|` list, each entry trimmed, empty entries dropped (a trailing `|` is harmless). */
const listOf = (value: unknown): string[] | null => {
  const text = textArg(value);
  if (text === null) return null;
  return text
    .split('|')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
};

const parseDirection = (args: Readonly<Record<string, unknown>>): ParsedBlock => {
  const labels = listOf(args.options);
  const slugs = listOf(args.slugs);
  if (labels === null || slugs === null) return { ok: false, reason: 'bad-options' };
  const count = labels.length;
  if (count < DIRECTION_OPTIONS_MIN || count > DIRECTION_OPTIONS_MAX || slugs.length !== count) return { ok: false, reason: 'bad-options' };
  const options: DirectionOption[] = [];
  for (const [index, label] of labels.entries()) {
    const slug = slugOf(slugs[index]);
    const letter = OPTION_LETTERS[index];
    if (slug === null || letter === undefined) return { ok: false, reason: 'bad-options' };
    options.push({ letter, label: clipText(label, DIRECTION_LABEL_MAX), slug });
  }
  const question = clipText(textArg(args.question) ?? '', DIRECTION_QUESTION_MAX);
  return { ok: true, block: { name: 'DirectionPick', question: question === '' ? DEFAULT_QUESTION : question, options } };
};

const BAD_ASK: ParsedBlock = { ok: false, reason: 'bad-system-ask' };

/** The characters of every argument together, as the host counts them; unreadable or too long is refused. */
const argsFit = (args: Readonly<Record<string, unknown>>): boolean => {
  try {
    return JSON.stringify(args).length <= GUEST_BLOCK_ARGS_TEXT_MAX;
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `calls` as the agent wrote it: JSON text of an array. Unreadable entries are counted, never thrown. */
const parseCalls = (value: unknown): { calls: SystemAskCall[]; dropped: number } | null => {
  const text = textArg(value);
  if (text === null || text.trim() === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const calls: SystemAskCall[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const topic = isRecord(entry) ? textArg(entry.topic)?.trim() : undefined;
    if (!isRecord(entry) || topic === undefined || topic === '' || calls.length >= SYSTEM_ASK_CALLS_MAX || calls.some((call) => call.topic === topic)) {
      dropped += 1;
      continue;
    }
    calls.push({
      topic,
      why: clipText(textArg(entry.why) ?? '', SYSTEM_ASK_WHY_MAX),
      proposed: clipText(textArg(entry.proposed) ?? '', SYSTEM_ASK_PROPOSED_MAX),
    });
  }
  return { calls, dropped };
};

const matching = (value: unknown, pattern: RegExp): string | null => {
  const text = textArg(value)?.trim() ?? '';
  return pattern.test(text) ? text : null;
};

/**
 * `SystemAsk` (§8.12). The manifest passes five positional arguments, so the slots a kind does not
 * use arrive as `''` (or are left out) and are not read. Anything else that does not match is refused.
 */
export const parseSystemAskArgs = (args: Readonly<Record<string, unknown>>): ParsedBlock => {
  if (!argsFit(args)) return BAD_ASK;
  const kind = textArg(args.kind)?.trim();
  if (kind === 'interview-1') {
    const ticket = matching(args.ticket, SYSTEM_BUILD_TICKET_PATTERN);
    return ticket === null ? BAD_ASK : { ok: true, block: { name: 'SystemAsk', ask: { kind, ticket } } };
  }
  const systemId = matching(args.systemId, SYSTEM_ID_PATTERN);
  if (systemId === null) return BAD_ASK;
  if (kind === 'interview-2') {
    const read = parseCalls(args.calls);
    return read === null ? BAD_ASK : { ok: true, block: { name: 'SystemAsk', ask: { kind, systemId, calls: read.calls, dropped: read.dropped } } };
  }
  if (kind === 'diff') {
    const proposalId = matching(args.proposalId, SYSTEM_PROPOSAL_ID_PATTERN);
    return proposalId === null ? BAD_ASK : { ok: true, block: { name: 'SystemAsk', ask: { kind, systemId, proposalId } } };
  }
  return BAD_ASK;
};

export const parseBlockArgs = (name: string, args: Readonly<Record<string, unknown>>): ParsedBlock => {
  if (name === 'DesignCard') {
    const slug = slugOf(args.slug);
    return slug === null ? { ok: false, reason: 'bad-slug' } : { ok: true, block: { name: 'DesignCard', slug } };
  }
  if (name === 'DirectionPick') return parseDirection(args);
  if (name === 'SystemAsk') return parseSystemAskArgs(args);
  return { ok: false, reason: 'unknown-block' };
};
