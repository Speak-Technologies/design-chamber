// The token planner and value rules of a design system (documentation/specs/phase-2-5-technical.md
// §2.4, §6.1). Pure: no Node imports. Every value Design Chamber writes into a system or reads for
// display passes `validateTokenValue`, so nothing from a system can break out of a declaration.
//
// The planner works on the bytes it is given and plans splices against them: a `set` replaces one
// value range, an `add` inserts a declaration at the end of the last light `:root` or dark block (or
// appends that block), a `remove` cuts declarations out. Every other byte stays as it was (E5), and
// `verifyTokenEdit` rescans the result to prove it before anything is written.
//
// The existing Tweaks planner (`tokensOp`) is not changed. The patterns/brand meta paths are
// validated and applied in `systems/edit-meta.ts` (§2.11).

import type { TokenEdit } from './api.ts';
import {
  SYSTEM_MOTION_DURATION_MAX_MS,
  SYSTEM_MOTION_STEPS_MAX,
  SYSTEM_TOKEN_NAME_PATTERN,
  SYSTEM_TOKEN_VALUE_MAX,
  SYSTEM_UNDO_TEXT_MAX,
  TEXT_EDIT_MAX,
  TOKEN_PREVIEW_VALUE_PATTERN,
} from './limits.ts';
import { isBalancedQuotes, scanTokenBlocks, scanTokens, spliceTokens, type Declaration, type TokenBlock, type TokenContext } from './tokens-css.ts';
import type { TokenSection } from './types.ts';

/** A type style field a value is checked for (§2.3); null for a token value. */
export type TypeField = 'family' | 'size' | 'weight' | 'lineHeight' | 'letterSpacing';

/**
 * `ok` with `formula: true` for a value holding `var(` `calc(` `min(` `max(` `clamp(` or `color-mix(`
 * (shown, not editable by hand); otherwise the refusal sentence naming the section's expected shape.
 */
export type ValueCheck = { ok: true; formula: boolean } | { ok: false; sentence: string };

// ---- the value rules (§2.4) ----

export const FORMULA_SENTENCE = 'This value is a formula. Ask the agent to change it.';
export const UNREADABLE_VALUE_SENTENCE = "This value can't be read.";

const PLAIN_SHAPE = 'Use a plain CSS value of up to 100 characters, without ; { } < > \\ : or *, and without url().';

const SECTION_SHAPES: Readonly<Record<TokenSection, string>> = {
  colours: 'Use a colour, like #1a73e8, rgb(26 115 232) or a colour name.',
  spacing: 'Use a length, like 16px or 1rem.',
  radius: 'Use a length, like 8px or 0.5rem.',
  sizes: 'Use a size, like 1200px or 40rem, or a plain number.',
  shadows: 'Use a shadow, like 0 1px 2px rgb(0 0 0 / 0.2), or none.',
  layers: 'Use a whole number, like 10, or auto.',
  typography: PLAIN_SHAPE,
  motion: 'Use a time, like 200ms or 0.2s, or an easing, like ease-out, cubic-bezier(0.2, 0, 0, 1) or steps(4, end).',
  other: PLAIN_SHAPE,
};

const FIELD_SHAPES: Readonly<Record<TypeField, string>> = {
  family: 'Use font names separated by commas, like "Inter", sans-serif.',
  size: 'Use a size, like 16px or 1rem, or normal.',
  weight: 'Use a weight from 1 to 1000, or normal or bold.',
  lineHeight: 'Use a number like 1.5, a length, or normal.',
  letterSpacing: 'Use a length, like 0.02em, or normal.',
};

/** The functions a value may call: colours and formulas only (so no `url(`, `image-set(`, `expression(`, `attr(`, `element(`). */
const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'var', 'calc', 'min', 'max', 'clamp']);
const FORMULA_PATTERN = /(?:^|[^A-Za-z0-9-])(?:var|calc|min|max|clamp|color-mix)\(/i;
/** The easing functions a motion value may call besides those (system-builder-depth T10a); no other section takes them. */
const MOTION_FUNCTIONS: ReadonlySet<string> = new Set(['cubic-bezier', 'steps']);

/**
 * Rule 1: length, the preview alphabet (no `; { } < > \ : *`, no control character), balanced quotes and
 * brackets, known functions only (`extra` adds a section's own, such as motion's easings).
 */
const passesRuleOne = (text: string, extra?: ReadonlySet<string>): boolean => {
  if (text.length < 1 || text.length > SYSTEM_TOKEN_VALUE_MAX || !TOKEN_PREVIEW_VALUE_PATTERN.test(text) || !isBalancedQuotes(text)) return false;
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  if (depth !== 0) return false;
  for (const match of text.matchAll(/([A-Za-z-][A-Za-z0-9-]*)?\(/g)) {
    const name = match[1];
    // A bare `(` (a group inside calc) calls nothing.
    if (name !== undefined && !ALLOWED_FUNCTIONS.has(name.toLowerCase()) && extra?.has(name.toLowerCase()) !== true) return false;
  }
  return true;
};

const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const NUMBER_PATTERN = new RegExp(`^${NUMBER}$`);
const SPACING_UNITS = ['px', 'rem', 'em', '%', 'vw', 'vh', 'vmin', 'vmax', 'svh', 'dvh', 'lvh', 'ch', 'ex'];
const ALL_LENGTH_UNITS = [
  ...SPACING_UNITS,
  'cm', 'mm', 'q', 'in', 'pt', 'pc', 'lh', 'rlh', 'cap', 'ic', 'rex', 'rch', 'ric', 'rcap',
  'vi', 'vb', 'svw', 'svi', 'svb', 'lvw', 'lvi', 'lvb', 'dvw', 'dvi', 'dvb',
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax',
];
const lengthPattern = (units: readonly string[]): RegExp => new RegExp(`^(?:[+-]?0|${NUMBER}(?:${units.join('|')}))$`, 'i');
const SPACING_LENGTH = lengthPattern(SPACING_UNITS);
const ANY_LENGTH = lengthPattern(ALL_LENGTH_UNITS);
const INTEGER = /^[+-]?\d+$/;

/** The CSS named colours (CSS Color 4), lower case. */
const NAMED_COLOURS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender ' +
    'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey ' +
    'lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange ' +
    'orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray ' +
    'slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen ' +
    'transparent currentcolor'
  ).split(' '),
);

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOUR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/i;
const COLOUR_SPACES: ReadonlySet<string> = new Set(['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz', 'xyz-d50', 'xyz-d65']);
const COLOUR_ARGUMENT = new RegExp(`^(?:${NUMBER}(?:%|deg|rad|grad|turn)?|none)$`, 'i');

const isColour = (text: string): boolean => {
  if (HEX_COLOUR.test(text) || NAMED_COLOURS.has(text.toLowerCase())) return true;
  const match = COLOUR_FUNCTION.exec(text);
  if (match === null) return false;
  const name = (match[1] ?? '').toLowerCase();
  const args = (match[2] ?? '').trim().split(/[\s,/]+/).filter((part) => part !== '');
  if (name === 'color') {
    const space = args.shift();
    if (space === undefined || !COLOUR_SPACES.has(space.toLowerCase())) return false;
  }
  return args.length >= 3 && args.length <= 4 && args.every((arg) => COLOUR_ARGUMENT.test(arg));
};

/** `text` split on `separator` outside brackets and quotes; empty parts dropped. */
export const splitTop = (text: string, separator: RegExp): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of text) {
    if (quote !== null) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '(') {
      depth += 1;
      current += char;
    } else if (char === ')') {
      depth -= 1;
      current += char;
    } else if (depth === 0 && separator.test(char)) {
      if (current.trim() !== '') parts.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
};

/** `none`, or a comma list of `[inset] <length>{2,4} [<colour>]` in any order; `needsPair` refuses `none`. */
const isShadow = (text: string, needsPair: boolean): boolean => {
  if (text.toLowerCase() === 'none') return !needsPair;
  const layers = splitTop(text, /,/);
  if (layers.length === 0) return false;
  return layers.every((layer) => {
    let lengths = 0;
    let colours = 0;
    let insets = 0;
    for (const part of splitTop(layer, /\s/)) {
      if (part.toLowerCase() === 'inset') insets += 1;
      else if (ANY_LENGTH.test(part)) lengths += 1;
      else if (isColour(part)) colours += 1;
      else return false;
    }
    return lengths >= 2 && lengths <= 4 && colours <= 1 && insets <= 1;
  });
};

const isLayer = (text: string): boolean => {
  if (text.toLowerCase() === 'auto') return true;
  if (!INTEGER.test(text)) return false;
  const value = Number(text);
  return value >= -2147483647 && value <= 2147483647;
};

// ---- motion (system-builder-depth T10a) ----

const TIME = new RegExp(`^(${NUMBER})(ms|s)$`, 'i');
const EASING_KEYWORDS: ReadonlySet<string> = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
const CUBIC_BEZIER = new RegExp(`^cubic-bezier\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)$`, 'i');
const STEPS = /^steps\(\s*(\d{1,4})\s*(?:,\s*(start|end)\s*)?\)$/i;

/** A duration from 0 to `SYSTEM_MOTION_DURATION_MAX_MS`, in `ms` or `s`. */
const isTime = (text: string): boolean => {
  const match = TIME.exec(text);
  if (match === null) return false;
  const ms = Number(match[1]) * ((match[2] ?? '').toLowerCase() === 's' ? 1000 : 1);
  return Number.isFinite(ms) && ms >= 0 && ms <= SYSTEM_MOTION_DURATION_MAX_MS;
};

/**
 * A keyword easing, `cubic-bezier(x1, y1, x2, y2)` with both x from 0 to 1 (CSS refuses others) and
 * finite y, or `steps(n[, start|end])` with n from 1 to `SYSTEM_MOTION_STEPS_MAX`.
 */
const isEasing = (text: string): boolean => {
  if (EASING_KEYWORDS.has(text.toLowerCase())) return true;
  const bezier = CUBIC_BEZIER.exec(text);
  if (bezier !== null) {
    const [x1, y1, x2, y2] = bezier.slice(1, 5).map(Number);
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return false;
    return [x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1;
  }
  const steps = STEPS.exec(text);
  if (steps === null) return false;
  const count = Number(steps[1]);
  return count >= 1 && count <= SYSTEM_MOTION_STEPS_MAX;
};

const isMotionValue = (text: string): boolean => isTime(text) || isEasing(text);

/** Whether a motion value is a time or an easing (the checklist counts one of each); null for anything else. */
export const motionValueKind = (text: string): 'time' | 'easing' | null => (isTime(text) ? 'time' : isEasing(text) ? 'easing' : null);

/** The curves the easing keywords stand for (CSS Easing Functions), as `cubic-bezier` control points. */
const EASING_CURVES: Readonly<Record<string, readonly [number, number, number, number]>> = Object.freeze({
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
});

/** A motion value read into numbers, for a specimen to draw. */
export type MotionValue =
  | { kind: 'time'; ms: number }
  | { kind: 'bezier'; points: readonly [number, number, number, number] }
  | { kind: 'steps'; count: number; at: 'start' | 'end' };

/** The numbers of a motion value; null for anything the rules above refuse (a formula included). */
export const parseMotionValue = (text: string): MotionValue | null => {
  const kind = motionValueKind(text);
  if (kind === null) return null;
  if (kind === 'time') {
    const match = TIME.exec(text);
    // `+ 0`: "-0ms" reads as 0.
    return match === null ? null : { kind: 'time', ms: Number(match[1]) * ((match[2] ?? '').toLowerCase() === 's' ? 1000 : 1) + 0 };
  }
  const keyword = text.toLowerCase();
  const curve = Object.hasOwn(EASING_CURVES, keyword) ? EASING_CURVES[keyword] : undefined;
  if (curve !== undefined) return { kind: 'bezier', points: curve };
  const bezier = CUBIC_BEZIER.exec(text);
  if (bezier !== null) return { kind: 'bezier', points: [Number(bezier[1]), Number(bezier[2]), Number(bezier[3]), Number(bezier[4])] };
  const steps = STEPS.exec(text);
  return steps === null ? null : { kind: 'steps', count: Number(steps[1]), at: (steps[2] ?? '').toLowerCase() === 'start' ? 'start' : 'end' };
};

/** Names that are motion tokens (`--duration-*`, `--ease-*`, `--motion-*`). */
const MOTION_NAME = /^--(?:duration|ease|motion)-/i;

const FAMILY_NAME = /^(?:"[^"]+"|'[^']+'|[A-Za-z-][A-Za-z0-9-]*(?: +[A-Za-z-][A-Za-z0-9-]*)*)$/;

const fieldValid = (field: TypeField, text: string): boolean => {
  const lower = text.toLowerCase();
  switch (field) {
    case 'family': {
      const names = text.split(',').map((name) => name.trim());
      return names.length > 0 && names.every((name) => FAMILY_NAME.test(name));
    }
    case 'size':
    case 'letterSpacing':
      return lower === 'normal' || ANY_LENGTH.test(text);
    case 'weight': {
      if (lower === 'normal' || lower === 'bold' || lower === 'lighter' || lower === 'bolder') return true;
      if (!NUMBER_PATTERN.test(text)) return false;
      const weight = Number(text);
      return weight >= 1 && weight <= 1000;
    }
    case 'lineHeight':
      return lower === 'normal' || (NUMBER_PATTERN.test(text) && Number(text) >= 0) || ANY_LENGTH.test(text);
  }
};

const sectionValid = (section: TokenSection, text: string): boolean => {
  switch (section) {
    case 'colours':
      return isColour(text);
    case 'spacing':
      return SPACING_LENGTH.test(text);
    case 'radius':
      return ANY_LENGTH.test(text);
    case 'sizes':
      return SPACING_LENGTH.test(text) || NUMBER_PATTERN.test(text);
    case 'shadows':
      return isShadow(text, false);
    case 'layers':
      return isLayer(text);
    case 'motion':
      return isMotionValue(text);
    case 'typography':
    case 'other':
      return true;
  }
};

export const validateTokenValue = (section: TokenSection, field: TypeField | null, text: string): ValueCheck => {
  const shape = field === null ? SECTION_SHAPES[section] : FIELD_SHAPES[field];
  if (!passesRuleOne(text, field === null && section === 'motion' ? MOTION_FUNCTIONS : undefined)) return { ok: false, sentence: shape };
  if (FORMULA_PATTERN.test(text)) return { ok: true, formula: true };
  const valid = field === null ? sectionValid(section, text) : fieldValid(field, text);
  return valid ? { ok: true, formula: false } : { ok: false, sentence: shape };
};

/** The section a token without metadata falls into (§2.4). */
export const classifyToken = (name: string, value: string): TokenSection => {
  const text = value.trim();
  const lower = name.toLowerCase();
  // A motion name holding a time, an easing, a formula or nothing yet; any other value falls through as before.
  if (MOTION_NAME.test(name) && (text === '' || FORMULA_PATTERN.test(text) || isMotionValue(text))) return 'motion';
  if (isColour(text)) return 'colours';
  if (isShadow(text, true)) return 'shadows';
  if (/radius|rounded/.test(lower)) return 'radius';
  if (/(^--z-|z-?index|layer|stack)/.test(lower) && INTEGER.test(text)) return 'layers';
  if (/space|spacing|gap|gutter|pad|margin|inset/.test(lower) && SPACING_LENGTH.test(text)) return 'spacing';
  if (/font|family|text-|leading|line-height|tracking|letter|weight|^--fs-/.test(lower)) return 'typography';
  if (/size|width|height|breakpoint|^--bp-|screen|container/.test(lower) && ANY_LENGTH.test(text)) return 'sizes';
  return 'other';
};

/**
 * The section a token reads in: the one `system.json` records, else the classified one. A recorded
 * `other` on a token that classifies as motion reads as motion: the Phase 1 rules told agents to leave
 * `--duration-*` and `--ease-*` in `other` until the section existed (system-builder-depth T10a).
 */
export const resolveTokenSection = (recorded: TokenSection | null | undefined, classified: TokenSection): TokenSection =>
  recorded === null || recorded === undefined || (recorded === 'other' && classified === 'motion') ? classified : recorded;

// ---- contexts (§2.4) ----

/**
 * `system`: only the top-level `:root` (light) and `:root` directly inside
 * `@media (prefers-color-scheme: dark)` (dark) count. `extraction`: the wider project forms of §2.4.
 */
export type ContextRules = 'system' | 'extraction';

const DARK_MEDIA = '@media(prefers-color-scheme:dark)';
const normaliseAtRule = (prelude: string): string => prelude.toLowerCase().replace(/\s*([():,])\s*/g, '$1').replace(/\s+/g, ' ').trim();
/** Lower case, single spaces, attribute selectors without quotes or inner spaces (`[data-theme="dark"]` → `[data-theme=dark]`). */
const normaliseSelector = (selector: string): string =>
  selector
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\[\s*([a-z0-9_-]+)\s*=\s*(["']?)([a-z0-9_-]+)\2\s*\]/g, '[$1=$3]')
    .trim();
const selectorList = (prelude: string): string[] => prelude.split(',').map(normaliseSelector);

const LIGHT_EXTRACTION: ReadonlySet<string> = new Set([':root', 'html', ':host', '.light', '[data-theme=light]']);
const DARK_TOP_EXTRACTION: ReadonlySet<string> = new Set(['.dark', ':root.dark', 'html.dark', '[data-theme=dark]', ':root[data-theme=dark]', '[data-mode=dark]']);

const partsOf = (ctx: TokenContext): { atRules: readonly string[]; selectors: readonly string[] } =>
  ctx.kind === 'root' ? { atRules: [], selectors: [':root'] } : { atRules: ctx.atRules ?? [], selectors: ctx.selectors ?? [] };

const isLightParts = (atRules: readonly string[], selectors: readonly string[], rules: ContextRules): boolean => {
  const [selector] = selectors;
  if (atRules.length === 0 && selectors.length === 1 && selector !== undefined) {
    const list = selectorList(selector);
    return rules === 'system' ? list.length === 1 && list[0] === ':root' : list.every((one) => LIGHT_EXTRACTION.has(one));
  }
  const [atRule] = atRules;
  return rules === 'extraction' && atRules.length === 1 && selectors.length === 0 && atRule !== undefined && normaliseAtRule(atRule) === '@theme';
};

const isDarkParts = (atRules: readonly string[], selectors: readonly string[], rules: ContextRules): boolean => {
  const [selector] = selectors;
  const [atRule] = atRules;
  if (selectors.length !== 1 || selector === undefined) return false;
  const list = selectorList(selector);
  if (atRules.length === 1 && atRule !== undefined && normaliseAtRule(atRule) === DARK_MEDIA) {
    return rules === 'system' ? list.length === 1 && list[0] === ':root' : list.every((one) => one === ':root' || one === 'html');
  }
  return rules === 'extraction' && atRules.length === 0 && list.every((one) => DARK_TOP_EXTRACTION.has(one));
};

export const isLightContext = (ctx: TokenContext, rules: ContextRules): boolean => {
  if (ctx.kind === 'root') return true;
  const { atRules, selectors } = partsOf(ctx);
  return isLightParts(atRules, selectors, rules);
};

export const isDarkContext = (ctx: TokenContext, rules: ContextRules): boolean => {
  if (ctx.kind === 'root') return false;
  const { atRules, selectors } = partsOf(ctx);
  return isDarkParts(atRules, selectors, rules);
};

/** A block of the mode a system writes into: the rule itself is the `:root` (not an at-rule nested in one). */
const isModeBlock = (block: TokenBlock, mode: 'light' | 'dark'): boolean => {
  // The block itself is the `:root` rule (an `@media` nested inside `:root` lists the same preludes).
  if (block.atRule || block.atRules.length + block.selectors.length !== (mode === 'light' ? 1 : 2)) return false;
  return mode === 'light' ? isLightParts(block.atRules, block.selectors, 'system') : isDarkParts(block.atRules, block.selectors, 'system');
};

// ---- the planner (§6.1) ----

/** One planned change, as the ledger and the notice describe it. */
export type TokenEditChange = { name: string; mode: 'light' | 'dark'; before: string | null; after: string | null };

/**
 * The bytes after the edits, the changes made and the undo text, or the refusal sentence (§6.1).
 * `contexts: "design"` limits removals to the design's light `:root` and dark block (§6.4). `undo` is the
 * text needed to reverse it (splices, or the whole old text up to `SYSTEM_UNDO_TEXT_MAX`), null when over
 * that cap (the edit stands with `undoable: false`); T3 maps it onto the pipeline's undo steps.
 */
export type TokenEditPlan =
  | { result: string; changes: TokenEditChange[]; undo: { kind: 'splices'; splices: { start: number; removed: string; inserted: string }[] } | { kind: 'replace'; before: string } | null }
  | { refusal: string };

export type TokenPlanOptions = {
  /** `design` (§6.4) reads the same two contexts as `system`; other declarations are component styling and stay. */
  contexts: 'system' | 'design';
  /** The section system.json gives a token, so its value is checked for the right shape; else `classifyToken`. */
  sectionOf?: (name: string) => TokenSection | null;
};

export const NOT_EXACT_SENTENCE = "Design Chamber couldn't write these values exactly. Nothing was saved.";
const BAD_EDIT_SENTENCE = "Design Chamber couldn't read that edit. Nothing was saved.";
const NOT_A_NAME_SENTENCE = 'A token name starts with -- and holds up to 60 letters, digits, dashes or underscores.';
const notSetSentence = (name: string, mode: 'light' | 'dark'): string => `tokens.css has no ${mode} value for ${name}. Reload and try again.`;
const alreadySetSentence = (name: string, mode: 'light' | 'dark'): string => `tokens.css already has a ${mode} value for ${name}.`;
const notThereSentence = (name: string): string => `tokens.css has no ${name} to remove. Reload and try again.`;

/** Characters of removed text the splice undo steps may hold together (the same budget as `UNDO_REMOVED_MAX`). */
export const TOKEN_UNDO_REMOVED_MAX = TEXT_EDIT_MAX * 8;
/** Splice undo steps one token edit may take; more is undone as the whole old text. */
export const TOKEN_UNDO_SPLICES_MAX = 16;

type Splice = { from: number; to: number; text: string };
type Mode = 'light' | 'dark';

/** What the structure check needs: which declarations went, which got a new value, which arrived. */
type Expectation = { removed: ReadonlySet<number>; set: ReadonlyMap<number, string>; added: { name: string; mode: Mode; value: string }[] };

type Built = { result: string; changes: TokenEditChange[]; splices: Splice[]; expect: Expectation } | { refusal: string };

const isHorizontalSpace = (char: string | undefined): boolean => char === ' ' || char === '\t';
const isWhitespace = (char: string | undefined): boolean => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

/** The file's own line break: its first one, or `\n`. */
const lineBreakOf = (css: string): string => (/\r\n|\n|\r/.exec(css)?.[0] === '\r\n' ? '\r\n' : '\n');

/** The whitespace from the start of `at`'s line up to `at`, or null when anything else sits there. */
const indentBefore = (css: string, at: number): string | null => {
  let k = at;
  while (k > 0 && isHorizontalSpace(css[k - 1])) k -= 1;
  return k === 0 || css[k - 1] === '\n' || css[k - 1] === '\r' ? css.slice(k, at) : null;
};

/** The leading whitespace of the line holding `at`. */
const lineIndentOf = (css: string, at: number): string => {
  let k = at;
  while (k > 0 && css[k - 1] !== '\n' && css[k - 1] !== '\r') k -= 1;
  let end = k;
  while (isHorizontalSpace(css[end])) end += 1;
  return css.slice(k, end);
};

/**
 * A declaration cut out (§6.1): from its name to its `;`, with the whitespace before it back to the
 * line start when only whitespace sits there, and then the line break after it, so the whole line goes.
 */
const removalOf = (css: string, declaration: Declaration): Splice => {
  let from = declaration.start;
  const indent = indentBefore(css, from);
  if (indent !== null) from -= indent.length;
  let to = css[declaration.end] === ';' ? declaration.end + 1 : declaration.end;
  if (indent !== null) {
    let after = to;
    while (isHorizontalSpace(css[after])) after += 1;
    if (css.startsWith('\r\n', after)) to = after + 2;
    else if (css[after] === '\n' || css[after] === '\r') to = after + 1;
  }
  return { from, to, text: '' };
};

/** The splices applied to `css` in one pass (sorted, not overlapping). */
const applySplices = (css: string, splices: readonly Splice[]): string => {
  let out = '';
  let cursor = 0;
  for (const splice of splices) {
    out += css.slice(cursor, splice.from) + splice.text;
    cursor = splice.to;
  }
  return out + css.slice(cursor);
};

const textOf = (css: string, declaration: Declaration): string => css.slice(declaration.from, declaration.to);
const isPlain = (declaration: Declaration): boolean => !declaration.important && !declaration.comment && !declaration.broken;

const buildPlan = (css: string, edits: readonly TokenEdit[], options: TokenPlanOptions): Built => {
  if (edits.length === 0) return { refusal: BAD_EDIT_SENTENCE };
  const declarations = scanTokens(css);
  const inMode = (declaration: Declaration, mode: Mode): boolean =>
    mode === 'light' ? isLightContext(declaration.context, 'system') : isDarkContext(declaration.context, 'system');
  const ofName = (name: string, mode: Mode): Declaration[] => declarations.filter((one) => one.name === name && inMode(one, mode));
  const sectionFor = (name: string, value: string): TokenSection => resolveTokenSection(options.sectionOf?.(name), classifyToken(name, value));
  const firstValueOf = (name: string): string | null => {
    const found = ofName(name, 'light').at(-1) ?? ofName(name, 'dark').at(-1);
    return found === undefined ? null : textOf(css, found);
  };

  const claimed = new Set<string>();
  const claim = (name: string, mode: Mode): boolean => {
    const key = `${name}\u0000${mode}`;
    if (claimed.has(key)) return false;
    claimed.add(key);
    return true;
  };

  const splices: Splice[] = [];
  const removals: Splice[] = [];
  const changes: TokenEditChange[] = [];
  const removed = new Set<number>();
  const set = new Map<number, string>();
  const adds: Record<Mode, { name: string; value: string }[]> = { light: [], dark: [] };

  for (const edit of edits) {
    if (typeof edit.name !== 'string' || !SYSTEM_TOKEN_NAME_PATTERN.test(edit.name)) return { refusal: NOT_A_NAME_SENTENCE };
    const { name } = edit;
    switch (edit.kind) {
      case 'set': {
        if (!claim(name, edit.mode)) return { refusal: BAD_EDIT_SENTENCE };
        const target = ofName(name, edit.mode).at(-1);
        if (target === undefined) return { refusal: notSetSentence(name, edit.mode) };
        const before = textOf(css, target);
        if (!isPlain(target)) return { refusal: UNREADABLE_VALUE_SENTENCE };
        if (FORMULA_PATTERN.test(before)) return { refusal: FORMULA_SENTENCE };
        const check = validateTokenValue(sectionFor(name, before), null, edit.value);
        if (!check.ok) return { refusal: check.sentence };
        splices.push({ from: target.from, to: target.to, text: edit.value });
        set.set(target.start, edit.value);
        changes.push({ name, mode: edit.mode, before, after: edit.value });
        break;
      }
      case 'add': {
        if (!claim(name, edit.mode)) return { refusal: BAD_EDIT_SENTENCE };
        if (ofName(name, edit.mode).length > 0) return { refusal: alreadySetSentence(name, edit.mode) };
        const check = validateTokenValue(sectionFor(name, firstValueOf(name) ?? edit.value), null, edit.value);
        if (!check.ok) return { refusal: check.sentence };
        adds[edit.mode].push({ name, value: edit.value });
        changes.push({ name, mode: edit.mode, before: null, after: edit.value });
        break;
      }
      case 'remove': {
        const modes: Mode[] = edit.mode === 'both' ? ['light', 'dark'] : [edit.mode];
        let found = 0;
        for (const mode of modes) {
          if (!claim(name, mode)) return { refusal: BAD_EDIT_SENTENCE };
          const targets = ofName(name, mode);
          const last = targets.at(-1);
          if (last === undefined) continue;
          found += targets.length;
          for (const target of targets) {
            removed.add(target.start);
            removals.push(removalOf(css, target));
          }
          changes.push({ name, mode, before: textOf(css, last), after: null });
        }
        if (found === 0) return { refusal: notThereSentence(name) };
        break;
      }
      default:
        return { refusal: BAD_EDIT_SENTENCE };
    }
  }
  splices.push(...removals);

  // Insertions: one per mode, at the end of the last block of that mode, or a new block at the end.
  const eol = lineBreakOf(css);
  const blocks = scanTokenBlocks(css);
  const appended: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const list = adds[mode];
    if (list.length === 0) continue;
    const block = blocks.filter((one) => isModeBlock(one, mode)).sort((a, b) => a.open - b.open).at(-1);
    if (block === undefined) {
      const lines = list.map(({ name, value }) => `${mode === 'light' ? '  ' : '    '}${name}: ${value};${eol}`).join('');
      appended.push(mode === 'light' ? `:root {${eol}${lines}}${eol}` : `@media (prefers-color-scheme: dark) {${eol}  :root {${eol}${lines}  }${eol}}${eol}`);
      continue;
    }
    if (!block.closed) return { refusal: NOT_EXACT_SENTENCE };
    // After the last character the block keeps, skipping whitespace and what this edit removes.
    let at = block.close;
    for (;;) {
      while (at > block.open + 1 && isWhitespace(css[at - 1])) at -= 1;
      const covering = removals.find((removal) => removal.from < at && at <= removal.to && removal.from > block.open);
      if (covering === undefined) break;
      at = covering.from;
    }
    const first = declarations.find((one) => one.start > block.open && one.start < block.close && inMode(one, mode) && !removed.has(one.start));
    const closeIndent = indentBefore(css, block.close);
    const indent = (first === undefined ? null : indentBefore(css, first.start)) ?? (closeIndent === null ? '  ' : `${closeIndent}  `);
    const needsSemicolon = block.openTail && at > block.tailStart;
    const needsClosingBreak = !css.slice(at, block.close).includes('\n') && !css.slice(at, block.close).includes('\r');
    const text = `${needsSemicolon ? ';' : ''}${list.map(({ name, value }) => `${eol}${indent}${name}: ${value};`).join('')}${needsClosingBreak ? `${eol}${lineIndentOf(css, block.open)}` : ''}`;
    splices.push({ from: at, to: at, text });
  }
  if (appended.length > 0) {
    const separator = css === '' ? '' : css.endsWith('\n') || css.endsWith('\r') ? eol : `${eol}${eol}`;
    splices.push({ from: css.length, to: css.length, text: `${separator}${appended.join(eol)}` });
  }

  // Insertions first where they share a position with a range; no two ranges may overlap.
  splices.sort((a, b) => a.from - b.from || (a.to - a.from) - (b.to - b.from));
  for (let k = 1; k < splices.length; k += 1) {
    const previous = splices[k - 1];
    const current = splices[k];
    if (previous !== undefined && current !== undefined && previous.to > current.from) return { refusal: NOT_EXACT_SENTENCE };
  }
  const added = (['light', 'dark'] as const).flatMap((mode) => adds[mode].map((one) => ({ ...one, mode })));
  return { result: applySplices(css, splices), changes, splices, expect: { removed, set, added } };
};

const sameStrings = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((value, index) => value === (b ?? [])[index]);

const sameContext = (a: TokenContext, b: TokenContext): boolean =>
  a.kind === 'root' ? b.kind === 'root' : b.kind === 'other' && a.label === b.label && sameStrings(a.atRules, b.atRules) && sameStrings(a.selectors, b.selectors);

/**
 * §6.1 Verify, the structural half: `after` holds `before`'s declarations minus the removed ones plus
 * the added ones (name and context); each set or added one holds exactly its new text and is plain;
 * every other one keeps its text, flags and relative order.
 */
const structureHolds = (before: string, after: string, expect: Expectation): boolean => {
  const kept = scanTokens(before).filter((one) => !expect.removed.has(one.start));
  const pending = [...expect.added];
  let next = 0;
  for (const declaration of scanTokens(after)) {
    const text = textOf(after, declaration);
    const old = kept[next];
    if (old !== undefined && old.name === declaration.name && sameContext(old.context, declaration.context)) {
      const newText = expect.set.get(old.start);
      if (newText !== undefined) {
        if (text !== newText || !isPlain(declaration)) return false;
      } else if (
        text !== textOf(before, old) ||
        declaration.important !== old.important ||
        declaration.comment !== old.comment ||
        declaration.broken !== old.broken
      ) {
        return false;
      }
      next += 1;
      continue;
    }
    const index = pending.findIndex(
      (one) =>
        one.name === declaration.name &&
        (one.mode === 'light' ? isLightContext(declaration.context, 'system') : isDarkContext(declaration.context, 'system')) &&
        one.value === text &&
        isPlain(declaration),
    );
    if (index === -1) return false;
    pending.splice(index, 1);
  }
  return next === kept.length && pending.length === 0;
};

const undoOf = (css: string, splices: readonly Splice[]): Extract<TokenEditPlan, { result: string }>['undo'] => {
  const runs = spliceTokens(css, splices, TOKEN_UNDO_REMOVED_MAX);
  const removedTotal = runs.reduce((sum, run) => sum + run.removed.length, 0);
  if (runs.length <= TOKEN_UNDO_SPLICES_MAX && removedTotal <= TOKEN_UNDO_REMOVED_MAX) {
    return { kind: 'splices', splices: runs.map(({ start, removed, inserted }) => ({ start, removed, inserted })) };
  }
  return css.length <= SYSTEM_UNDO_TEXT_MAX ? { kind: 'replace', before: css } : null;
};

export const planTokenEdit = (css: string, edits: readonly TokenEdit[], options: TokenPlanOptions): TokenEditPlan => {
  const built = buildPlan(css, edits, options);
  if ('refusal' in built) return built;
  if (!structureHolds(css, built.result, built.expect)) return { refusal: NOT_EXACT_SENTENCE };
  return { result: built.result, changes: built.changes, undo: undoOf(css, built.splices) };
};

/** Rescans `after` and checks it is exactly `before` with the planned edits applied (§6.1 Verify). */
export const verifyTokenEdit = (before: string, after: string, edits: readonly TokenEdit[]): boolean => {
  const built = buildPlan(before, edits, { contexts: 'system' });
  if ('refusal' in built) return false;
  return after === built.result && structureHolds(before, after, built.expect);
};
