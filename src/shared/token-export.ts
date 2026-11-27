// A design system's tokens as files to take elsewhere (documentation/specs/system-builder-depth.md §13 T19):
// W3C design tokens JSON (the 2025.10 format), a regenerated tokens.css and a Tailwind v4 `@theme` block.
// Pure: no Node imports.
//
// Nothing here copies bytes from tokens.css. Every name is checked again against the token name pattern and
// every value against `validateTokenValue` plus a quote and bracket balance, so a value can't close a
// declaration, a block or a string in any of the three files. A value that fails is left out and listed.
// A formula is written as the text it is and never worked out.

import { SYSTEM_TOKEN_NAME_PATTERN } from './limits.ts';
import { motionValueKind, parseMotionValue, splitTop, validateTokenValue } from './token-edit.ts';
import type { SystemToken, TokenSection, TokenValue } from './types.ts';

/** The part of a `SystemDetail` the exports read. */
export type TokenExportSource = { tokens: readonly SystemToken[] };

type Mode = 'light' | 'dark';
type ExportToken = { token: SystemToken; light: string | null; dark: string | null };

/** A token whose JSON name got a number: `path` is where it is in tokens.json. */
export type RenamedToken = { name: string; path: string };
/** A value no file holds, because it couldn't be checked. */
export type LeftOutValue = { name: string; mode: Mode };

// ---- the checks ----

/**
 * Every quote and bracket closes where CSS would close it: brackets inside a string don't count, and `!`
 * outside a string (`!important`) is refused. `validateTokenValue` counts brackets and quotes without
 * looking at which is inside which, which is not enough for a value written into a file.
 */
export const isSelfContained = (text: string): boolean => {
  let depth = 0;
  let quote: string | null = null;
  for (const char of text) {
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    } else if (char === '!') return false;
  }
  return depth === 0 && quote === null;
};

/** The text of a value an export may write, or null. */
const checkedValue = (section: TokenSection, value: TokenValue | null): string | null => {
  if (value === null || value.editable === 'unreadable') return null;
  return validateTokenValue(section, null, value.text).ok && isSelfContained(value.text) ? value.text : null;
};

const exportTokens = (source: TokenExportSource): ExportToken[] =>
  source.tokens
    .filter((token) => SYSTEM_TOKEN_NAME_PATTERN.test(token.name))
    .map((token) => ({ token, light: checkedValue(token.section, token.light), dark: checkedValue(token.section, token.dark) }));

/** Whether any token has a value an export can hold. */
export const hasExportableTokens = (source: TokenExportSource): boolean => exportTokens(source).some((one) => one.light !== null || one.dark !== null);

/** The values tokens.css sets that no export holds. */
export const leftOutValues = (source: TokenExportSource): LeftOutValue[] =>
  source.tokens.flatMap((token) => {
    if (!SYSTEM_TOKEN_NAME_PATTERN.test(token.name)) return [];
    return (['light', 'dark'] as const).filter((mode) => token[mode] !== null && checkedValue(token.section, token[mode]) === null).map((mode) => ({ name: token.name, mode }));
  });

// ---- values as W3C design tokens ----

type Dimension = { value: number; unit: 'px' | 'rem' };
type Component = number | 'none';
type Colour = { colorSpace: string; components: Component[]; alpha?: number; hex?: string };
type Shadow = { color: Colour; offsetX: Dimension; offsetY: Dimension; blur: Dimension; spread: Dimension; inset?: true };
type Typed =
  | { $type: 'color'; $value: Colour }
  | { $type: 'dimension'; $value: Dimension }
  | { $type: 'duration'; $value: { value: number; unit: 'ms' | 's' } }
  | { $type: 'cubicBezier'; $value: number[] }
  | { $type: 'fontFamily'; $value: string | string[] }
  | { $type: 'fontWeight'; $value: number | string }
  | { $type: 'shadow'; $value: Shadow | Shadow[] };

const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const NUMBER_PATTERN = new RegExp(`^${NUMBER}$`);
const NUMBER_AND_UNIT = new RegExp(`^(${NUMBER})([a-z%]*)$`, 'i');

const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000 + 0; // `+ 0`: never -0
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const numberAndUnit = (text: string): { value: number; unit: string } | null => {
  const match = NUMBER_AND_UNIT.exec(text);
  const value = Number(match?.[1]);
  return match === null || !Number.isFinite(value) ? null : { value: rounded(value), unit: (match[2] ?? '').toLowerCase() };
};

/** A length in px or rem, the only units the format has; `zero` also takes a bare `0`. */
const dimensionOf = (text: string, zero: boolean): Dimension | null => {
  const read = numberAndUnit(text);
  if (read === null) return null;
  if (read.unit === 'px' || read.unit === 'rem') return { value: read.value, unit: read.unit };
  return zero && read.unit === '' && read.value === 0 ? { value: 0, unit: 'px' } : null;
};

/** A number, or a percentage of `full`; `none` stays `none`. Null for anything else. */
const componentOf = (text: string, full: number): Component | null => {
  if (text.toLowerCase() === 'none') return 'none';
  const read = numberAndUnit(text);
  if (read === null) return null;
  if (read.unit === '') return read.value;
  return read.unit === '%' ? rounded((read.value / 100) * full) : null;
};

const DEGREES: Readonly<Record<string, number>> = Object.freeze({ '': 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 });

const hueOf = (text: string): Component | null => {
  if (text.toLowerCase() === 'none') return 'none';
  const read = numberAndUnit(text);
  if (read === null || !Object.hasOwn(DEGREES, read.unit)) return null;
  const degrees = (((read.value * (DEGREES[read.unit] ?? 1)) % 360) + 360) % 360;
  return rounded(degrees) % 360;
};

const within = (value: Component | null, min: number, max: number): Component | null => (typeof value === 'number' ? clamp(value, min, max) : value);

type Reader = (text: string) => Component | null;
const rgbChannel: Reader = (text) => {
  const value = componentOf(text, 255);
  return typeof value === 'number' ? rounded(clamp(value, 0, 255) / 255) : value;
};
const upTo = (full: number): Reader => (text) => within(componentOf(text, full), 0, full);
const signed = (full: number): Reader => (text) => componentOf(text, full);
const chroma = (full: number): Reader => (text) => within(componentOf(text, full), 0, Number.MAX_VALUE);

/** The three components of each CSS colour function, as the format's colour spaces count them. */
const FUNCTION_SPACES: Readonly<Record<string, { space: string; read: readonly [Reader, Reader, Reader] }>> = Object.freeze({
  rgb: { space: 'srgb', read: [rgbChannel, rgbChannel, rgbChannel] },
  rgba: { space: 'srgb', read: [rgbChannel, rgbChannel, rgbChannel] },
  hsl: { space: 'hsl', read: [hueOf, upTo(100), upTo(100)] },
  hsla: { space: 'hsl', read: [hueOf, upTo(100), upTo(100)] },
  hwb: { space: 'hwb', read: [hueOf, upTo(100), upTo(100)] },
  lab: { space: 'lab', read: [upTo(100), signed(125), signed(125)] },
  lch: { space: 'lch', read: [upTo(100), chroma(150), hueOf] },
  oklab: { space: 'oklab', read: [upTo(1), signed(0.4), signed(0.4)] },
  oklch: { space: 'oklch', read: [upTo(1), chroma(0.4), hueOf] },
});

/** `color()` space names to the format's; each component 0 to 1. */
const COLOUR_SPACE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  srgb: 'srgb', 'srgb-linear': 'srgb-linear', 'display-p3': 'display-p3', 'a98-rgb': 'a98-rgb',
  'prophoto-rgb': 'prophoto-rgb', rec2020: 'rec2020', xyz: 'xyz-d65', 'xyz-d65': 'xyz-d65', 'xyz-d50': 'xyz-d50',
});

const withAlpha = (colour: Colour, alpha: number): Colour => (alpha >= 1 ? colour : { ...colour, alpha });

const hexColour = (digits: string): Colour => {
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const part = (at: number): number => rounded(Number.parseInt(full.slice(at, at + 2), 16) / 255);
  const colour: Colour = { colorSpace: 'srgb', components: [part(0), part(2), part(4)], hex: `#${full.slice(0, 6).toLowerCase()}` };
  return withAlpha(colour, full.length === 8 ? part(6) : 1);
};

/** The three named colours the format can hold without a colour table; other names stay text. */
const NAMED: Readonly<Record<string, Colour>> = Object.freeze({
  black: hexColour('000000'),
  white: hexColour('ffffff'),
  transparent: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0 },
});

/** A CSS colour as the format writes one; null when it can't be said exactly (a keyword, a value out of range). */
const colourOf = (text: string): Colour | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex !== null) return hexColour(hex[1] ?? '');
  const lower = text.toLowerCase();
  if (Object.hasOwn(NAMED, lower)) return NAMED[lower] ?? null;
  const call = /^([a-z]+)\(([^()]*)\)$/.exec(lower);
  if (call === null) return null;
  const name = call[1] ?? '';
  const [before = '', slashAlpha, extra] = (call[2] ?? '').split('/');
  if (extra !== undefined) return null;
  const args = before.split(/[\s,]+/).filter((part) => part !== '');

  let space: string;
  let readers: readonly Reader[];
  if (name === 'color') {
    const given = args.shift() ?? '';
    if (!Object.hasOwn(COLOUR_SPACE_NAMES, given)) return null;
    space = COLOUR_SPACE_NAMES[given] ?? '';
    const unitChannel: Reader = (part) => {
      const value = componentOf(part, 1);
      return typeof value === 'number' && (value < 0 || value > 1) ? null : value;
    };
    readers = [unitChannel, unitChannel, unitChannel];
  } else {
    const known = Object.hasOwn(FUNCTION_SPACES, name) ? FUNCTION_SPACES[name] : undefined;
    if (known === undefined) return null;
    space = known.space;
    readers = known.read;
  }

  // `rgba(1, 2, 3, 0.5)` and `hsla(…)` carry the alpha as a fourth part.
  const alphaText = slashAlpha?.trim() ?? (args.length === 4 ? args.pop() : undefined);
  if (args.length !== 3) return null;
  const components = readers.map((read, index) => read(args[index] ?? ''));
  const alpha = alphaText === undefined ? 1 : componentOf(alphaText, 1);
  if (typeof alpha !== 'number' || components.some((one) => one === null)) return null;
  // Safe: every null was refused on the line above.
  return withAlpha({ colorSpace: space, components: components as Component[] }, clamp(alpha, 0, 1));
};

const shadowLayer = (layer: string): Shadow | null => {
  const lengths: Dimension[] = [];
  let color: Colour | null = null;
  let inset = false;
  for (const part of splitTop(layer, /\s/)) {
    if (part.toLowerCase() === 'inset') inset = true;
    else if (NUMBER_AND_UNIT.test(part)) {
      const length = dimensionOf(part, true);
      if (length === null) return null;
      lengths.push(length);
    } else {
      color = colourOf(part);
      if (color === null) return null;
    }
  }
  const [offsetX, offsetY, blur = { value: 0, unit: 'px' }, spread = { value: 0, unit: 'px' }] = lengths;
  // The format needs a colour; a shadow that takes the text colour stays text.
  if (color === null || offsetX === undefined || offsetY === undefined) return null;
  return { color, offsetX, offsetY, blur, spread, ...(inset ? { inset: true as const } : {}) };
};

const shadowOf = (text: string): Shadow | Shadow[] | null => {
  const layers = splitTop(text, /,/).map(shadowLayer);
  const [first] = layers;
  if (first === undefined || layers.some((layer) => layer === null)) return null;
  // Safe: every null was refused on the line above.
  return layers.length === 1 ? first : (layers as Shadow[]);
};

const WEIGHT_WORDS: ReadonlySet<string> = new Set([
  'thin', 'hairline', 'extra-light', 'ultra-light', 'light', 'normal', 'regular', 'book', 'medium', 'semi-bold', 'demi-bold', 'bold',
  'extra-bold', 'ultra-bold', 'black', 'heavy', 'extra-black', 'ultra-black',
]);
const WEIGHT_NAME = /weight/i;
const FAMILY_NAME = /family|^--ff-|^--font-(?:sans|serif|mono|body|heading|display|ui|code|base|brand|text)$/i;
/** Words a family-named token may hold that are not font names. */
const NOT_A_FAMILY = /^(?:inherit|initial|unset|revert|revert-layer|none|normal)$/i;

const familyOf = (name: string, text: string): string | string[] | null => {
  // A list or a quoted name says "fonts" on its own; one bare word needs the token's name to say so.
  if (!FAMILY_NAME.test(name) && !/[,"']/.test(text)) return null;
  const check = validateTokenValue('typography', 'family', text);
  if (!check.ok || check.formula || NOT_A_FAMILY.test(text)) return null;
  const names = text.split(',').map((one) => one.trim().replace(/^(["'])(.*)\1$/, '$2'));
  const [first] = names;
  return names.length === 1 && first !== undefined ? first : names;
};

/** `typography` and `other` hold mixed things, so the value and the name decide together. */
const mixedValue = (name: string, text: string): Typed | null => {
  if (WEIGHT_NAME.test(name)) {
    if (WEIGHT_WORDS.has(text)) return { $type: 'fontWeight', $value: text };
    const weight = Number(text);
    return NUMBER_PATTERN.test(text) && weight >= 1 && weight <= 1000 ? { $type: 'fontWeight', $value: weight } : null;
  }
  const dimension = dimensionOf(text, false);
  if (dimension !== null) return { $type: 'dimension', $value: dimension };
  const family = familyOf(name, text);
  return family === null ? null : { $type: 'fontFamily', $value: family };
};

const motionValue = (text: string): Typed | null => {
  if (motionValueKind(text) === 'time') {
    const read = numberAndUnit(text);
    return read !== null && (read.unit === 'ms' || read.unit === 's') ? { $type: 'duration', $value: { value: read.value, unit: read.unit } } : null;
  }
  const parsed = parseMotionValue(text);
  // `steps()` has no type in the format.
  return parsed?.kind === 'bezier' ? { $type: 'cubicBezier', $value: parsed.points.map(rounded) } : null;
};

/**
 * The typed form of a checked value, or null: it is then written as its text with no `$type`. A formula
 * is always that: none of these readers takes `var(`, `calc(` or the like (`familyOf` asks outright).
 */
const typedValue = (name: string, section: TokenSection, text: string): Typed | null => {
  switch (section) {
    case 'colours': {
      const colour = colourOf(text);
      return colour === null ? null : { $type: 'color', $value: colour };
    }
    case 'spacing':
    case 'radius':
    case 'sizes': {
      const dimension = dimensionOf(text, true);
      return dimension === null ? null : { $type: 'dimension', $value: dimension };
    }
    case 'shadows': {
      const shadow = shadowOf(text);
      return shadow === null ? null : { $type: 'shadow', $value: shadow };
    }
    case 'motion':
      return motionValue(text);
    case 'typography':
    case 'other':
      return mixedValue(name, text);
    case 'layers':
      return null;
  }
};

// ---- tokens.json ----

const SECTION_ORDER: readonly TokenSection[] = ['colours', 'typography', 'spacing', 'radius', 'shadows', 'motion', 'layers', 'sizes', 'other'];

/** No prototype, so a token called `--__proto__` or `--constructor` is an ordinary key. */
type Group = { [key: string]: Group | object };
const emptyGroup = (): Group => Object.create(null) as Group; // Safe: an object with no prototype and no keys.

const groupPath = (token: SystemToken): string[] => (token.section === 'colours' ? [token.section, token.group ?? 'other'] : [token.section]);
const ownName = (token: SystemToken): string => token.name.slice(2);

/**
 * Each token's name in tokens.json: the custom property without `--`. Two names in one group that differ
 * only by capitals collide in many tools, so the later one gets `-2`, `-3` and so on.
 */
const jsonNames = (tokens: readonly SystemToken[]): { names: Map<SystemToken, string>; renamed: RenamedToken[] } => {
  const names = new Map<SystemToken, string>();
  const renamed: RenamedToken[] = [];
  const keyOf = (token: SystemToken, name: string): string => `${groupPath(token).join('.')}.${name.toLowerCase()}`;
  // Every real name is taken up front, so a suffixed name never takes one a later token owns.
  const original = new Set(tokens.map((token) => keyOf(token, ownName(token))));
  const used = new Set<string>();
  for (const token of tokens) {
    let name = ownName(token);
    if (used.has(keyOf(token, name))) {
      let n = 2;
      while (used.has(keyOf(token, `${ownName(token)}-${n}`)) || original.has(keyOf(token, `${ownName(token)}-${n}`))) n += 1;
      name = `${ownName(token)}-${n}`;
      renamed.push({ name: token.name, path: [...groupPath(token), name].join('.') });
    }
    used.add(keyOf(token, name));
    names.set(token, name);
  }
  return { names, renamed };
};

/**
 * tokens.json: light values grouped by section (colours also by colour group), dark values the same way
 * under `dark`. A value the format can type carries `$type`; any other is its CSS text.
 */
export const toDesignTokensJson = (source: TokenExportSource): { text: string; renamed: RenamedToken[] } => {
  const tokens = exportTokens(source)
    .filter((one) => one.light !== null || one.dark !== null)
    .sort((a, b) => SECTION_ORDER.indexOf(a.token.section) - SECTION_ORDER.indexOf(b.token.section));
  const { names, renamed } = jsonNames(tokens.map((one) => one.token));

  const root = emptyGroup();
  const dark = emptyGroup();
  const put = (into: Group, one: ExportToken, value: string): void => {
    let group = into;
    for (const part of groupPath(one.token)) {
      group[part] ??= emptyGroup();
      // Safe: only groups are stored under section and colour group keys.
      group = group[part] as Group;
    }
    const entry = typedValue(one.token.name, one.token.section, value) ?? { $value: value };
    group[names.get(one.token) ?? ownName(one.token)] = one.token.note === '' ? entry : { ...entry, $description: one.token.note };
  };
  for (const one of tokens) {
    if (one.light !== null) put(root, one, one.light);
    if (one.dark !== null) put(dark, one, one.dark);
  }
  if (Object.keys(dark).length > 0) root.dark = dark;
  return { text: `${JSON.stringify(root, null, 2)}\n`, renamed };
};

// ---- tokens.css and the Tailwind theme ----

const declarations = (tokens: readonly ExportToken[], mode: Mode, indent: string): string =>
  tokens
    .flatMap((one) => {
      const value = one[mode];
      return value === null ? [] : [`${indent}${one.token.name}: ${value};\n`];
    })
    .join('');

/** tokens.css written again from the checked values: the light `:root` block and the dark media block. */
export const toTokensCss = (source: TokenExportSource): string => {
  const tokens = exportTokens(source);
  const light = declarations(tokens, 'light', '  ');
  const dark = declarations(tokens, 'dark', '    ');
  const blocks = [
    light === '' ? '' : `:root {\n${light}}\n`,
    dark === '' ? '' : `@media (prefers-color-scheme: dark) {\n  :root {\n${dark}  }\n}\n`,
  ].filter((block) => block !== '');
  return `/* Design tokens exported from Design Chamber. */\n${blocks.join('\n')}`;
};

/** tailwind-theme.css: a Tailwind v4 `@theme` block of the light values, under the names the system uses. */
export const toTailwindTheme = (source: TokenExportSource): string => {
  const tokens = exportTokens(source);
  const darkNote = tokens.some((one) => one.dark !== null) ? '/* Light values only. The CSS export holds the dark ones. */\n' : '';
  return `/* Design tokens exported from Design Chamber, for Tailwind CSS v4. */\n${darkNote}@theme {\n${declarations(tokens, 'light', '  ')}}\n`;
};

// ---- README.txt ----

/** What the files don't say for themselves; null when there is nothing to tell. */
export const exportReadme = (renamed: readonly RenamedToken[], leftOut: readonly LeftOutValue[]): string | null => {
  const parts: string[] = [];
  if (renamed.length > 0) {
    parts.push(
      'Renamed in tokens.json\nThese names differ only by capitals from another one in the same group, so they got a number:\n' +
        renamed.map((one) => `  ${one.name} is ${one.path}\n`).join(''),
    );
  }
  if (leftOut.length > 0) {
    parts.push(`Left out\nDesign Chamber couldn't read these values, so no file holds them:\n${leftOut.map((one) => `  ${one.name} (${one.mode})\n`).join('')}`);
  }
  return parts.length === 0 ? null : parts.join('\n');
};
