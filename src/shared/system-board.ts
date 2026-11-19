// Board entry keys (documentation/specs/phase-2-5-technical.md §9.2): the ONE place a
// `data-dc-entry` value's shape is defined. The board generator writes the keys, the bridge
// reads the attribute (advisory), the page selects entries and the prompt route validates them.
//
// T11 adds the patterns/brand sections; their keys already parse here. Pure: no Node imports.

import { BOARD_ENTRY_MAX, SYSTEM_ENTRY_ID_PATTERN, SYSTEM_TOKEN_NAME_PATTERN } from './limits.ts';
import type { SystemDetail, SystemSection } from './types.ts';

/** Every entry key the board may carry; `pattern:` and `brand:` are S8 (§2.11). */
export const BOARD_ENTRY_PATTERN =
  /^(token:--[A-Za-z0-9_-]{1,60}|type:[a-z0-9-]{1,40}|font:\d{1,3}|logo:\d{1,3}|component:[a-z0-9-]{1,40}|overview|note:[a-z0-9-]{1,40}|pattern:[a-z0-9-]{1,40}|brand:[a-z0-9-]{1,40})$/;

export type BoardEntryKind = 'token' | 'type' | 'font' | 'logo' | 'component' | 'overview' | 'note' | 'pattern' | 'brand';

export type BoardEntryKey = { kind: BoardEntryKind; key: string };

const KINDS: ReadonlySet<string> = new Set<BoardEntryKind>(['token', 'type', 'font', 'logo', 'component', 'overview', 'note', 'pattern', 'brand']);

/** True when the text is a well-formed entry key within the length cap. */
export const isBoardEntryKey = (text: string): boolean => text.length <= BOARD_ENTRY_MAX && BOARD_ENTRY_PATTERN.test(text);

/**
 * The `data-dc-entry` value for an entry (`overview` takes no key). Throws on a key off the
 * pattern: the generator only passes names and ids the parser already validated, so a throw is a bug.
 */
export const entryKeyOf = (kind: BoardEntryKind, key: string): string => {
  const text = kind === 'overview' ? 'overview' : `${kind}:${key}`;
  if (!isBoardEntryKey(text)) throw new Error(`Not a board entry key: ${kind}`);
  return text;
};

/** A validated entry key, or null for anything off the pattern. */
export const parseEntryKey = (text: string): BoardEntryKey | null => {
  if (!isBoardEntryKey(text)) return null;
  if (text === 'overview') return { kind: 'overview', key: '' };
  const at = text.indexOf(':');
  const kind = text.slice(0, at);
  // Safe: the pattern admits only the listed kinds before the colon.
  if (!KINDS.has(kind)) return null;
  return { kind: kind as BoardEntryKind, key: text.slice(at + 1) };
};

/** The section an entry belongs to, from the detail (a token's section is its own); null when the entry is not in it. */
export const sectionOfEntry = (key: BoardEntryKey, detail: SystemDetail): SystemSection | null => {
  switch (key.kind) {
    case 'token': {
      const token = detail.tokens.find((candidate) => candidate.name === key.key);
      if (token === undefined) return null;
      // "Other tokens" close the Sizes section (§5.7).
      return token.section === 'other' ? 'sizes' : token.section;
    }
    case 'type':
      return detail.type.some((style) => style.id === key.key) ? 'typography' : null;
    case 'font':
      return Number(key.key) < detail.fonts.length ? 'typography' : null;
    case 'logo':
      return Number(key.key) < detail.logos.length ? 'assets' : null;
    case 'component':
      return detail.components.some((component) => component.id === key.key) ? 'components' : null;
    case 'overview':
      return 'overview';
    case 'note':
      return detail.notes.some((note) => note.id === key.key) ? 'overview' : null;
    case 'pattern':
      return detail.patterns.some((entry) => entry.id === key.key) ? 'patterns' : null;
    case 'brand':
      return detail.brand.some((entry) => entry.id === key.key) ? 'brand' : null;
  }
};

/**
 * The custom property holding a token's dark value on the board (§5.7): `--brand` → `--dc-dark-brand`.
 * Injective (the leading `--` is cut, nothing else), and within the 80-character preview name cap.
 */
export const darkVarOf = (name: string): string => {
  if (!SYSTEM_TOKEN_NAME_PATTERN.test(name)) throw new Error('Not a token name.');
  return `--dc-dark-${name.slice(2)}`;
};

const TYPE_FIELDS: ReadonlySet<string> = new Set(['family', 'size', 'weight', 'lineHeight', 'letterSpacing']);

/** The custom property holding one field of a type style specimen (§5.7): `--dc-type-<id>-<field>`. */
export const typeVarOf = (id: string, field: string): string => {
  if (!SYSTEM_ENTRY_ID_PATTERN.test(id) || !TYPE_FIELDS.has(field)) throw new Error('Not a type style field.');
  return `--dc-type-${id}-${field}`;
};
