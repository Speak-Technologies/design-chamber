// tokens.css, the pure half (Phase 2 technical design §4.2, §4.3). The tolerant scanner finds
// every custom-property declaration and where its value sits; the reader turns that into each
// knob's state; the splice and the verify back the tokens op's byte-exact write.
// No Node imports: the guests can import this file (design-json.ts and bridge-protocol.ts do).
//
// The scanner follows CSS's own block rules closely enough that what it calls "the top-level
// :root declaration" is the one a browser applies: comments, strings (an unescaped line break
// ends a string as broken), `url(…)` without quotes, and nested `()`, `[]` and `{}` blocks,
// where only the matching closer ends a block (so an unclosed `(` swallows the rest of the
// file, as it does in a browser). A `;` at the top level only ends an at-statement; it does not
// end a rule's selector.

import type { TweakState } from './api.ts';
import { TWEAK_CHOICE_VALUE_PATTERN } from './limits.ts';
import type { Tweak, TweakNumber } from './types.ts';

/**
 * True when a value holds an even count of `'` and an even count of `"`. An unbalanced quote
 * would open a string that swallows the declarations after it, so choice values and preview
 * values must pass this before they are written or set (§4.2).
 */
export const isBalancedQuotes = (value: string): boolean => {
  let single = 0;
  let double = 0;
  for (const char of value) {
    if (char === "'") single += 1;
    else if (char === '"') double += 1;
  }
  return single % 2 === 0 && double % 2 === 0;
};

// ---- the scanner ----

/** Where a declaration sits: a top-level rule whose selector is exactly `:root`, or anywhere else. */
export type TokenContext = { kind: 'root' } | { kind: 'other'; label: string };

export type Declaration = {
  /** The property name as written, e.g. `--accent-h`. */
  name: string;
  /** `valueRaw = [from, to)`: after the colon's whitespace, before trailing whitespace, a comment, `!important`, `;` or `}`. */
  from: number;
  to: number;
  important: boolean;
  /** A comment anywhere between the colon and the end of the declaration. */
  comment: boolean;
  /** An unterminated string or `url(`, or a bracket left open at the end of the file. */
  broken: boolean;
  context: TokenContext;
};

/** Characters of a context label ("Also set for …"). */
export const TOKEN_CONTEXT_MAX = 60;

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
const isNameChar = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x2d || code === 0x5f || code >= 0x80;

/** The index after a comment that starts at `at` (`/*`); an unterminated one runs to the end. */
const commentEnd = (css: string, at: number): number => {
  const close = css.indexOf('*/', at + 2);
  return close === -1 ? css.length : close + 2;
};

/** The index after a string that opens at `at`; `ok` false when a line break or the end came first. */
const stringEnd = (css: string, at: number): { end: number; ok: boolean } => {
  const quote = css.charCodeAt(at);
  for (let i = at + 1; i < css.length; i += 1) {
    const code = css.charCodeAt(i);
    if (code === quote) return { end: i + 1, ok: true };
    if (code === 0x5c) i += 1; // a backslash escapes the next character, an escaped line break included
    else if (code === 0x0a || code === 0x0d || code === 0x0c) return { end: i, ok: false };
  }
  return { end: css.length, ok: false };
};

/**
 * At `at`, the start of an unquoted `url(`: the index after its `)`, with `ok` false for a bad
 * url (a quote, `(`, or the end before the `)`); null when this is not an unquoted url.
 */
const unquotedUrlEnd = (css: string, at: number): { end: number; ok: boolean } | null => {
  if (css.slice(at, at + 4).toLowerCase() !== 'url(' || (at > 0 && isNameChar(css.charCodeAt(at - 1)))) return null;
  let i = at + 4;
  while (i < css.length && isSpace(css.charCodeAt(i))) i += 1;
  const first = css.charCodeAt(i);
  if (first === 0x22 || first === 0x27) return null; // a quoted url is a function holding a string
  let ok = true;
  for (; i < css.length; i += 1) {
    const code = css.charCodeAt(i);
    if (code === 0x29) return { end: i + 1, ok };
    if (code === 0x5c) i += 1;
    else if (code === 0x22 || code === 0x27 || code === 0x28) ok = false;
  }
  return { end: css.length, ok: false };
};

/** Comments removed, whitespace collapsed, trimmed. */
const normalizePrelude = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('/*', i)) {
      i = commentEnd(text, i);
      out += ' ';
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out.replace(/[\s﻿]+/g, ' ').trim();
};

const clipLabel = (text: string): string => (text.length <= TOKEN_CONTEXT_MAX ? text : `${text.slice(0, TOKEN_CONTEXT_MAX - 1).trimEnd()}…`);

type Block = { prelude: string; atRule: boolean };

const contextOf = (stack: readonly Block[]): TokenContext => {
  const [only] = stack;
  if (stack.length === 1 && only !== undefined && !only.atRule && only.prelude.toLowerCase() === ':root') return { kind: 'root' };
  const atRules = stack.filter((block) => block.atRule).map((block) => block.prelude);
  const label = atRules.length > 0 ? atRules.join(' ') : stack.map((block) => block.prelude).join(' ');
  return { kind: 'other', label: clipLabel(label) };
};

/** `!` at `at` followed (after whitespace and comments) by `important`. */
const isImportantAt = (css: string, at: number): boolean => {
  let i = at + 1;
  for (;;) {
    while (i < css.length && isSpace(css.charCodeAt(i))) i += 1;
    if (!css.startsWith('/*', i)) break;
    i = commentEnd(css, i);
  }
  return css.slice(i, i + 9).toLowerCase() === 'important' && !isNameChar(css.charCodeAt(i + 9));
};

/** Every custom-property declaration in the file, in source order (§4.2). */
export const scanTokens = (css: string): Declaration[] => {
  const out: Declaration[] = [];
  const stack: Block[] = [];
  let i = css.charCodeAt(0) === 0xfeff ? 1 : 0;

  // The segment being read: a declaration, a rule's prelude, or an at-statement.
  let segStart = i;
  let colonAt: number | null = null;
  let custom = false;
  let importantAt: number | null = null;
  let firstComment: number | null = null;
  let comment = false;
  let broken = false;
  const brackets: number[] = [];

  const resetSegment = (at: number): void => {
    segStart = at;
    colonAt = null;
    custom = false;
    importantAt = null;
    firstComment = null;
    comment = false;
    broken = false;
    brackets.length = 0;
  };

  const endSegment = (at: number): void => {
    if (custom && colonAt !== null && stack.length > 0) {
      let from = colonAt + 1;
      while (from < at && isSpace(css.charCodeAt(from))) from += 1;
      let to = Math.min(at, importantAt ?? at, firstComment ?? at);
      while (to > from && isSpace(css.charCodeAt(to - 1))) to -= 1;
      out.push({
        name: normalizePrelude(css.slice(segStart, colonAt)),
        from,
        to: Math.max(from, to),
        important: importantAt !== null,
        comment,
        broken: broken || brackets.length > 0,
        context: contextOf(stack),
      });
    }
    resetSegment(at + 1);
  };

  while (i < css.length) {
    const code = css.charCodeAt(i);
    if (code === 0x2f && css.charCodeAt(i + 1) === 0x2a) {
      if (colonAt !== null) {
        comment = true;
        if (brackets.length === 0) firstComment ??= i;
      }
      i = commentEnd(css, i);
      continue;
    }
    if (code === 0x22 || code === 0x27) {
      const string = stringEnd(css, i);
      if (!string.ok) broken = true;
      i = string.end;
      continue;
    }
    if (code === 0x75 || code === 0x55) {
      const url = unquotedUrlEnd(css, i);
      if (url !== null) {
        if (!url.ok) broken = true;
        i = url.end;
        continue;
      }
    }
    const open = brackets.at(-1);
    if (open !== undefined) {
      // Inside a bracket only its own closer ends it; `;` and `}` are plain characters there.
      if (code === 0x28 || code === 0x5b || code === 0x7b) brackets.push(code === 0x28 ? 0x29 : code === 0x5b ? 0x5d : 0x7d);
      else if (code === open) brackets.pop();
      i += 1;
      continue;
    }
    if (code === 0x28) brackets.push(0x29);
    else if (code === 0x5b) brackets.push(0x5d);
    else if (code === 0x3a && colonAt === null && stack.length > 0) {
      colonAt = i;
      custom = /^--\S+$/.test(normalizePrelude(css.slice(segStart, i)));
    } else if (code === 0x21 && custom && colonAt !== null && importantAt === null && isImportantAt(css, i)) {
      importantAt = i;
    } else if (code === 0x7b) {
      if (custom && colonAt !== null) brackets.push(0x7d); // a custom property's value may hold a `{}` block
      else {
        const prelude = normalizePrelude(css.slice(segStart, i));
        stack.push({ prelude, atRule: prelude.startsWith('@') });
        resetSegment(i + 1);
      }
    } else if (code === 0x7d) {
      if (stack.length > 0) {
        endSegment(i);
        stack.pop();
      } else resetSegment(i + 1); // a stray `}` at the top level
    } else if (code === 0x3b) {
      if (stack.length > 0) endSegment(i);
      else if (css.slice(segStart, i).trimStart().startsWith('@')) resetSegment(i + 1); // an at-statement
    }
    i += 1;
  }
  endSegment(css.length);
  return out;
};

// ---- the knob states ----

/** A number as tokens.css writes it: digits with an optional fraction, then a lower-case unit. */
const NUMBER_VALUE = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/;

/** A choice value that can be replaced safely: the option shape, balanced quotes, no function. */
const isPlainChoiceValue = (value: string): boolean => TWEAK_CHOICE_VALUE_PATTERN.test(value) && isBalancedQuotes(value) && !value.includes('(');

/** Contexts of a var's other declarations, at most this many. */
export const ALSO_SET_MAX = 3;

/** One knob's state with the declaration it edits (the last top-level `:root` one), or null. */
export type KnobRead = { state: TweakState; declaration: Declaration | null; text: string | null };

const readKnob = (css: string | null, declarations: readonly Declaration[], tweak: Tweak): KnobRead => {
  const base = { var: tweak.var, value: null, fileUnit: null };
  if (css === null) return { state: { ...base, state: 'no-file', alsoSet: [] }, declaration: null, text: null };
  const mine = declarations.filter((declaration) => declaration.name === tweak.var);
  const alsoSet: string[] = [];
  for (const declaration of mine) {
    if (declaration.context.kind === 'other' && !alsoSet.includes(declaration.context.label) && alsoSet.length < ALSO_SET_MAX) alsoSet.push(declaration.context.label);
  }
  const declaration = mine.filter((one) => one.context.kind === 'root').at(-1) ?? null;
  if (declaration === null) return { state: { ...base, state: 'missing', alsoSet }, declaration: null, text: null };
  const text = css.slice(declaration.from, declaration.to);
  const formula = { state: { ...base, state: 'formula' as const, alsoSet }, declaration, text };
  if (declaration.important || declaration.comment || declaration.broken) return formula;
  if (tweak.kind === 'number') {
    const match = NUMBER_VALUE.exec(text);
    const digits = match?.[1];
    const unit = match?.[2];
    if (digits === undefined || unit === undefined) return formula;
    const value = Number(digits);
    return { state: { var: tweak.var, state: unit === tweak.unit ? 'ok' : 'unit', value, fileUnit: unit, alsoSet }, declaration, text };
  }
  if (tweak.options.some((option) => option.value === text)) return { state: { ...base, state: 'ok', value: text, alsoSet }, declaration, text };
  if (isPlainChoiceValue(text)) return { state: { ...base, state: 'value', value: text, alsoSet }, declaration, text };
  return formula;
};

/** Each knob read against the file, with the declaration it would edit (the op needs the offsets). */
export const readKnobs = (css: string | null, tweaks: readonly Tweak[]): KnobRead[] => {
  const declarations = css === null ? [] : scanTokens(css);
  return tweaks.map((tweak) => readKnob(css, declarations, tweak));
};

/** Each knob's state in the file; `css` null when the design has no tokens.css (§4.2). */
export const readTweakValues = (css: string | null, tweaks: readonly Tweak[]): TweakState[] => readKnobs(css, tweaks).map((read) => read.state);

/** The unit as words for a sentence. */
const unitWords = (unit: string): string => (unit === '' ? 'no unit' : unit);

/** Why a knob can't be tuned, as the panel and the save refusal word it; null when it can. */
export const tweakStateSentence = (state: TweakState, tweak: Tweak): string | null => {
  switch (state.state) {
    case 'ok':
    case 'value':
      return null;
    case 'missing':
      return `tokens.css has no ${tweak.var}.`;
    case 'formula':
      return 'This value is a formula. Ask the agent to change it.';
    case 'unit': {
      const fileUnit = state.fileUnit ?? '';
      const knobUnit = tweak.kind === 'number' ? tweak.unit : '';
      const file = fileUnit === '' ? `sets ${tweak.var} without a unit` : `sets ${tweak.var} in ${fileUnit}`;
      return `tokens.css ${file}, but this tweak uses ${unitWords(knobUnit)}. Ask the agent to fix it.`;
    }
    case 'no-file':
      return 'This design has no tokens.css.';
  }
};

// ---- formatting a value ----

/** Decimals of a knob's step (`parseTweaks` allows at most 4, so its string form never has an exponent). */
const stepDecimals = (step: number): number => {
  const fraction = String(step).split('.')[1];
  return fraction === undefined ? 0 : Math.min(fraction.length, 4);
};

/**
 * A number as the knob writes it: rounded to the step's decimals, no exponent, `-0` as `0`,
 * trailing zeros trimmed (§4.3 step 4). The unit is the caller's.
 */
export const formatTweakNumber = (value: number, step: number): string => {
  const decimals = stepDecimals(step);
  const factor = 10 ** decimals;
  let text = (Math.round(value * factor) / factor).toFixed(decimals);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
};

/** A number knob's value as tokens.css text: the formatted number and the knob's unit. */
export const tweakNumberText = (value: number, tweak: TweakNumber): string => `${formatTweakNumber(value, tweak.step)}${tweak.unit}`;

// ---- the splice and its verify ----

/** One declaration value to replace: `[from, to)` of the original text gets `text`. */
export type TokenChange = { from: number; to: number; text: string };

/**
 * One replacement of a contiguous run: in the text it is applied to, `removed` at `start` gives
 * way to `inserted`; `result` is the whole text afterwards.
 */
export type TokenSplice = { start: number; removed: string; inserted: string; result: string };

/**
 * The changes as as few splices as possible, each one contiguous run from its first changed
 * value to its last, applied front to back (each splice's offsets are in the text the previous
 * one left). One splice when the run's original text fits `maxRemoved` (the undo record's cap);
 * otherwise the changes are grouped greedily so every run fits. Every byte outside the changed
 * values is the original byte. Changes must not overlap.
 */
export const spliceTokens = (css: string, changes: readonly TokenChange[], maxRemoved: number): TokenSplice[] => {
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  const groups: TokenChange[][] = [];
  for (const change of sorted) {
    const group = groups.at(-1);
    const first = group?.[0];
    if (group !== undefined && first !== undefined && change.to - first.from <= maxRemoved) group.push(change);
    else groups.push([change]);
  }
  const splices: TokenSplice[] = [];
  let text = css;
  let shift = 0;
  for (const group of groups) {
    const first = group[0];
    const last = group.at(-1);
    if (first === undefined || last === undefined) continue;
    let inserted = '';
    let cursor = first.from;
    for (const change of group) {
      inserted += css.slice(cursor, change.from) + change.text;
      cursor = change.to;
    }
    const start = first.from + shift;
    const removed = css.slice(first.from, last.to);
    const result = text.slice(0, start) + inserted + text.slice(start + removed.length);
    splices.push({ start, removed, inserted, result });
    text = result;
    shift += inserted.length - removed.length;
  }
  return splices;
};

const sameContext = (a: TokenContext, b: TokenContext): boolean => (a.kind === 'root' ? b.kind === 'root' : b.kind === 'other' && a.label === b.label);

/** `before` with every change applied in one pass (the reference the splices are checked against). */
const applyChanges = (before: string, changes: readonly TokenChange[]): string => {
  let out = '';
  let cursor = 0;
  for (const change of [...changes].sort((a, b) => a.from - b.from)) {
    if (change.from < cursor || change.to < change.from) return '';
    out += before.slice(cursor, change.from) + change.text;
    cursor = change.to;
  }
  return out + before.slice(cursor);
};

/**
 * The write reads back exactly as planned (§4.3 step 5): every byte outside the changed values
 * is the original byte, the file holds the same declarations in the same contexts, every
 * changed one (by its `from` in `before`) now holds its new text cleanly, and every other one
 * keeps its text at its old place moved only by the changes before it. A new value that opened
 * a string, a bracket or a comment would shift or swallow what follows and fails here.
 */
export const verifyTokenWrite = (before: string, after: string, changes: readonly TokenChange[]): boolean => {
  if (after !== applyChanges(before, changes)) return false;
  const was = scanTokens(before);
  const now = scanTokens(after);
  if (was.length !== now.length) return false;
  const byFrom = new Map(changes.map((change) => [change.from, change]));
  if (byFrom.size !== changes.length) return false;
  let seen = 0;
  for (let k = 0; k < was.length; k += 1) {
    const old = was[k];
    const next = now[k];
    if (old === undefined || next === undefined) return false;
    if (old.name !== next.name || !sameContext(old.context, next.context)) return false;
    const shift = changes.reduce((sum, change) => (change.from < old.from ? sum + change.text.length - (change.to - change.from) : sum), 0);
    if (next.from !== old.from + shift) return false;
    const change = byFrom.get(old.from);
    if (change !== undefined) {
      seen += 1;
      if (change.to !== old.to || next.important || next.comment || next.broken) return false;
      if (after.slice(next.from, next.to) !== change.text) return false;
    } else if (
      after.slice(next.from, next.to) !== before.slice(old.from, old.to) ||
      next.important !== old.important ||
      next.comment !== old.comment ||
      next.broken !== old.broken
    ) {
      return false;
    }
  }
  return seen === changes.length;
};
