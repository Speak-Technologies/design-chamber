// The arguments of a chat block (documentation/specs/phase-1-5-sdk-2-7.md §U7.2, §U8.2), checked
// before anything is drawn or read. A model writes them, and text from a page or a ticket the agent
// read can steer that model, so every value is untrusted: slugs must be design folder names
// (`SLUG_PATTERN`, which already refuses `..`, slashes, drive letters and uppercase), labels are
// clipped text. Pure: no DOM, no host or service calls. Never throws.

import { DIRECTION_LABEL_MAX, DIRECTION_OPTIONS_MAX, DIRECTION_OPTIONS_MIN, DIRECTION_QUESTION_MAX, SLUG_PATTERN } from '../../shared/limits.ts';

export type OptionLetter = 'A' | 'B' | 'C' | 'D';

export const OPTION_LETTERS: readonly OptionLetter[] = ['A', 'B', 'C', 'D'];

export type DirectionOption = { letter: OptionLetter; label: string; slug: string };

export type BlockArgs = { name: 'DesignCard'; slug: string } | { name: 'DirectionPick'; question: string; options: DirectionOption[] };

export type ParsedBlock = { ok: true; block: BlockArgs } | { ok: false; reason: 'unknown-block' | 'bad-slug' | 'bad-options' };

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

export const parseBlockArgs = (name: string, args: Readonly<Record<string, unknown>>): ParsedBlock => {
  if (name === 'DesignCard') {
    const slug = slugOf(args.slug);
    return slug === null ? { ok: false, reason: 'bad-slug' } : { ok: true, block: { name: 'DesignCard', slug } };
  }
  if (name === 'DirectionPick') return parseDirection(args);
  return { ok: false, reason: 'unknown-block' };
};
