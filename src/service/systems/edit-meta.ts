// A design system's metadata changes (documentation/specs/phase-2-5-technical.md §6.2, §2.3,
// §2.11): each `MetaChange` applied to the parsed system.json object, with every value checked by
// its field's rule. Pure. Unknown keys are kept; only own properties are read, so a `__proto__` or
// `constructor` key is an ordinary key. A path whose parent is missing creates it only for
// `tokens.<name>`; a missing type style, component, font, logo, pattern or brand entry is stale.

import type { MetaChange, MetaPath } from '../../shared/api.ts';
import { SYSTEM_ENTRY_ID_PATTERN, SYSTEM_TOKEN_NAME_PATTERN, SYSTEM_USAGE_NOTE_MAX } from '../../shared/limits.ts';
import { validateTokenValue, type TypeField } from '../../shared/token-edit.ts';
import type { JsonObject, JsonValue } from '../../shared/types.ts';

/** A refused change: `stale` when the entry it names is gone, `invalid` for a value its field does not take. */
export type MetaRefusal = { code: 'stale' | 'invalid'; sentence: string };

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (object: JsonObject, key: string): JsonValue | undefined => (Object.hasOwn(object, key) ? object[key] : undefined);
const hasControl = (text: string): boolean => /[\u0000-\u001f\u007f]/.test(text);

const TOKEN_SECTIONS = ['colours', 'typography', 'spacing', 'radius', 'shadows', 'layers', 'sizes', 'other'];
const COLOUR_GROUPS = ['brand', 'surface', 'text', 'border', 'status', 'data', 'other'];
const TYPE_CASES = ['none', 'upper', 'lower', 'title'];
const PATTERN_KINDS = ['layout', 'do-dont', 'voice', 'other'];
const BRAND_KINDS = ['marketing', 'imagery', 'logo-use', 'other'];
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const LOGO_VARIANT_PATTERN = /^[a-z0-9][a-z0-9 -]{0,39}$/;
const TYPE_VALUE_FIELDS: readonly string[] = ['family', 'size', 'weight', 'lineHeight', 'letterSpacing'];

const FIELD_WORDS: Readonly<Record<string, string>> = {
  note: 'note',
  group: 'colour group',
  section: 'section',
  breakpoint: 'breakpoint flag',
  family: 'font family',
  size: 'size',
  weight: 'weight',
  lineHeight: 'line height',
  letterSpacing: 'letter spacing',
  case: 'case',
  name: 'name',
  purpose: 'purpose',
  style: 'style',
  variant: 'variant',
  title: 'title',
  kind: 'kind',
};

const NOTE_TOO_LONG = `A note can be up to ${SYSTEM_USAGE_NOTE_MAX} characters.`;
const BAD_META = "Design Chamber couldn't read that change. Nothing was saved.";

/** A usage note: up to 500 characters, line breaks allowed, no NUL; null or '' removes it. */
const noteValue = (value: unknown): JsonValue | undefined | MetaRefusal => {
  if (value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.includes('\u0000')) return { code: 'invalid', sentence: BAD_META };
  return value.length > SYSTEM_USAGE_NOTE_MAX ? { code: 'invalid', sentence: NOTE_TOO_LONG } : value;
};

const oneOf = (value: unknown, allowed: readonly string[], sentence: string, nullable: boolean): JsonValue | undefined | MetaRefusal => {
  if (value === null && nullable) return undefined;
  return typeof value === 'string' && allowed.includes(value) ? value : { code: 'invalid', sentence };
};

const lineValue = (value: unknown, max: number, sentence: string): JsonValue | MetaRefusal => {
  if (typeof value !== 'string') return { code: 'invalid', sentence };
  const text = value.trim();
  return text.length >= 1 && text.length <= max && !hasControl(text) ? text : { code: 'invalid', sentence };
};

const isRefusal = (value: unknown): value is MetaRefusal =>
  isObject(value) && (value.code === 'stale' || value.code === 'invalid') && typeof value.sentence === 'string' && Object.keys(value).length === 2;

/** The new value of one field (undefined removes the key), or the refusal. */
const valueFor = (path: MetaPath, value: MetaChange['value']): JsonValue | undefined | MetaRefusal => {
  const [area] = path;
  const field = path[2];
  if (field === undefined) return value === null ? undefined : { code: 'invalid', sentence: BAD_META };
  switch (area) {
    case 'tokens':
      switch (field) {
        case 'note':
          return noteValue(value);
        case 'group':
          return oneOf(value, COLOUR_GROUPS, 'Choose a colour group: brand, surface, text, border, status, data or other.', true);
        case 'section':
          return oneOf(value, TOKEN_SECTIONS, 'Choose a section: colours, typography, spacing, radius, shadows, layers, sizes or other.', true);
        case 'breakpoint':
          return value === null ? undefined : typeof value === 'boolean' ? value : { code: 'invalid', sentence: BAD_META };
      }
      break;
    case 'type':
      if (TYPE_VALUE_FIELDS.includes(field)) {
        if (value === null || value === '') return undefined;
        const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
        if (typeof text !== 'string') return { code: 'invalid', sentence: BAD_META };
        const check = validateTokenValue('typography', field as TypeField, text);
        return check.ok ? value : { code: 'invalid', sentence: check.sentence };
      }
      if (field === 'case') return oneOf(value, TYPE_CASES, 'Choose a case: none, upper, lower or title.', false);
      if (field === 'note') return noteValue(value);
      if (field === 'name') return lineValue(value, 60, 'A type style needs a name of 1 to 60 characters.');
      break;
    case 'components':
      return noteValue(value);
    case 'fonts':
      if (field === 'family') return typeof value === 'string' && FONT_FAMILY_PATTERN.test(value) ? value : { code: 'invalid', sentence: 'A font family is letters, digits, spaces and dashes.' };
      if (field === 'weight') return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : { code: 'invalid', sentence: 'A font weight is a whole number from 1 to 1000.' };
      if (field === 'style') return oneOf(value, ['normal', 'italic'], 'A font style is normal or italic.', false);
      break;
    case 'logos':
      if (field === 'variant') return typeof value === 'string' && LOGO_VARIANT_PATTERN.test(value) ? value : { code: 'invalid', sentence: 'A logo variant is lower-case words, like primary or mark.' };
      if (field === 'note') return noteValue(value);
      break;
    case 'patterns':
    case 'brand':
      if (field === 'title') return lineValue(value, 80, 'A title is 1 to 80 characters.');
      if (field === 'note') return noteValue(value);
      if (field === 'kind') return oneOf(value, area === 'patterns' ? PATTERN_KINDS : BRAND_KINDS, `Choose a kind: ${(area === 'patterns' ? PATTERN_KINDS : BRAND_KINDS).join(', ')}.`, false);
      break;
  }
  return { code: 'invalid', sentence: BAD_META };
};

/** Words for the ledger (§6.2 `system-meta { what }`, e.g. "the note of --brand-500"). */
export const describeMeta = (path: MetaPath): string => {
  const [area, key] = path;
  const field = path[2];
  const fieldWords = field === undefined ? 'notes' : (FIELD_WORDS[field] ?? field);
  switch (area) {
    case 'tokens':
      return `the ${fieldWords} of ${key}`;
    case 'type':
      return `the ${fieldWords} of type style ${key}`;
    case 'components':
      return `the ${fieldWords} of component ${key}`;
    case 'fonts':
    case 'logos':
      return `the ${fieldWords} of ${key}`;
    case 'patterns':
      return `the ${fieldWords} of pattern ${key}`;
    case 'brand':
      return `the ${fieldWords} of brand entry ${key}`;
  }
};

/** The shape of a path from a request (validated before anything reads system.json). */
export const isMetaPath = (value: unknown): value is MetaPath => {
  if (!Array.isArray(value) || value.some((part) => typeof part !== 'string')) return false;
  const [area, key, field] = value as string[];
  if (key === undefined) return false;
  if (value.length === 2) return area === 'tokens' && SYSTEM_TOKEN_NAME_PATTERN.test(key);
  if (value.length !== 3 || field === undefined) return false;
  switch (area) {
    case 'tokens':
      return SYSTEM_TOKEN_NAME_PATTERN.test(key) && ['note', 'group', 'section', 'breakpoint'].includes(field);
    case 'type':
      return SYSTEM_ENTRY_ID_PATTERN.test(key) && [...TYPE_VALUE_FIELDS, 'case', 'note', 'name'].includes(field);
    case 'components':
      return SYSTEM_ENTRY_ID_PATTERN.test(key) && (field === 'note' || field === 'purpose');
    case 'fonts':
      return /^assets\/fonts\/[A-Za-z0-9_][A-Za-z0-9._ -]{0,79}$/.test(key) && !key.includes('..') && ['family', 'weight', 'style'].includes(field);
    case 'logos':
      return /^assets\/logos\/[A-Za-z0-9_][A-Za-z0-9._ -]{0,79}$/.test(key) && !key.includes('..') && (field === 'variant' || field === 'note');
    case 'patterns':
    case 'brand':
      return SYSTEM_ENTRY_ID_PATTERN.test(key) && ['title', 'note', 'kind'].includes(field);
    default:
      return false;
  }
};

const setOrDelete = (object: JsonObject, key: string, value: JsonValue | undefined): void => {
  if (value === undefined) delete object[key];
  else object[key] = value;
};

/** The list entry whose own `id` (or `file` for fonts and logos) is `key`, or null. */
const entryOf = (raw: JsonObject, area: string, key: string): JsonObject | null => {
  const list = own(raw, area);
  if (!Array.isArray(list)) return null;
  const by = area === 'fonts' || area === 'logos' ? 'file' : 'id';
  for (const entry of list) if (isObject(entry) && own(entry, by) === key) return entry;
  return null;
};

/**
 * One change applied in place to `raw` (a fresh copy of system.json), or the refusal. `staleSentence`
 * is answered when the entry the path names is no longer in system.json.
 */
export const applyMetaChange = (raw: JsonObject, change: MetaChange, staleSentence: string): MetaRefusal | null => {
  const { at: path } = change;
  const next = valueFor(path, change.value);
  if (isRefusal(next)) return next;
  const [area, key] = path;
  const field = path[2];
  if (area === 'tokens') {
    let tokens = own(raw, 'tokens');
    if (tokens === undefined) {
      if (next === undefined) return null; // removing notes nobody wrote: nothing to do
      tokens = {};
      raw.tokens = tokens;
    }
    if (!isObject(tokens)) return { code: 'invalid', sentence: "The token notes in system.json can't be read. Ask the agent to fix them." };
    if (field === undefined) {
      delete tokens[key];
      return null;
    }
    let entry = own(tokens, key);
    if (entry === undefined) {
      if (next === undefined) return null;
      entry = {};
      tokens[key] = entry;
    }
    if (!isObject(entry)) return { code: 'invalid', sentence: "The notes for this token in system.json can't be read. Ask the agent to fix them." };
    setOrDelete(entry, field, next);
    return null;
  }
  if (field === undefined) return { code: 'invalid', sentence: BAD_META };
  const entry = entryOf(raw, area, key);
  if (entry === null) return { code: 'stale', sentence: staleSentence };
  setOrDelete(entry, field, next);
  return null;
};
