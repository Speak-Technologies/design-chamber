// Board entry keys (documentation/specs/phase-2-5-technical.md §9.2): the ONE place a
// `data-dc-entry` value's shape is defined. The board generator writes the keys, the bridge
// reads the attribute (advisory), the page selects entries and the prompt route validates them.
//
// T0 seam: the pattern is the contract (the bridge validator uses it now); the key helpers are
// filled by T6 (board) and T11 (the patterns/brand keys). Pure: no Node imports.

import { BOARD_ENTRY_MAX } from './limits.ts';
import type { SystemDetail, SystemSection } from './types.ts';

/** Every entry key the board may carry; `pattern:` and `brand:` are S8 (§2.11). */
export const BOARD_ENTRY_PATTERN =
  /^(token:--[A-Za-z0-9_-]{1,60}|type:[a-z0-9-]{1,40}|font:\d{1,3}|logo:\d{1,3}|component:[a-z0-9-]{1,40}|overview|note:[a-z0-9-]{1,40}|pattern:[a-z0-9-]{1,40}|brand:[a-z0-9-]{1,40})$/;

export type BoardEntryKind = 'token' | 'type' | 'font' | 'logo' | 'component' | 'overview' | 'note' | 'pattern' | 'brand';

export type BoardEntryKey = { kind: BoardEntryKind; key: string };

const notBuilt = (): never => {
  throw new Error('This part of Design Chamber (design systems) is not built yet.');
};

/** The `data-dc-entry` value for an entry (`overview` takes no key). T6 fills this. */
export const entryKeyOf = (kind: BoardEntryKind, key: string): string => notBuilt();

/** A validated entry key, or null for anything off the pattern. T6 fills this. */
export const parseEntryKey = (text: string): BoardEntryKey | null => notBuilt();

/** The section an entry belongs to, from the detail (a token's section is its own). T6 fills this. */
export const sectionOfEntry = (key: BoardEntryKey, detail: SystemDetail): SystemSection | null => notBuilt();

/** The custom property holding a token's dark value on the board (§5.7). T6 fills this. */
export const darkVarOf = (name: string): string => notBuilt();

/** The custom property holding one field of a type style specimen (§5.7). T6 fills this. */
export const typeVarOf = (id: string, field: string): string => notBuilt();

/** True when the text is a well-formed entry key within the length cap. */
export const isBoardEntryKey = (text: string): boolean => text.length <= BOARD_ENTRY_MAX && BOARD_ENTRY_PATTERN.test(text);