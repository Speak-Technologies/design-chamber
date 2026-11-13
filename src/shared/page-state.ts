// Saved page data (Phase 2 technical design §8.1, §8.2; feature 19): the pure rules of
// `<design>/.chamber/page-state.json` and of a PATCH delta, shared by the service and the page.
//
// The data is pairs, never an object, so key order is insertion order (for `key(n)`) and keys
// such as `__proto__` or `"1"` stay plain data. The cap counts keys and values together in
// UTF-16 code units, the way browsers count storage (owner decision 19-7). Everything read from
// disk or a request is untrusted: a value that is not exactly the documented shape reads as no
// data (a file) or is refused (a request).

import type { PageStateItems } from './api.ts';
import type { StorageChange } from './bridge-protocol.ts';
import { PAGE_STATE_CHANGES_MAX, PAGE_STATE_MAX_CHARS } from './limits.ts';

/** The `v` of the only page-state.json format this build reads and writes. */
export const PAGE_STATE_FILE_VERSION = 1;

/** What a PATCH asks for once validated: `clear` first, then `changes` in order (`null` removes). */
export type PageStateDelta = { clear: boolean; changes: StorageChange[] };

/** Characters one entry costs against the cap. */
const entryChars = (key: string, value: string | null): number => (value === null ? 0 : key.length + value.length);

/** Characters of keys plus values, counted like browsers count storage. */
export const pageStateChars = (items: Iterable<readonly [string, string]>): number => {
  let chars = 0;
  for (const [key, value] of items) chars += key.length + value.length;
  return chars;
};

/**
 * Parse the text of `page-state.json`. `null` for anything that is not exactly
 * `{ v: 1, items: [[string, string], ...] }` within the cap: unparseable JSON, another version,
 * a non-pair entry, a non-string key or value, or more than `cap` characters. A repeated key
 * keeps its first value (and costs nothing more). Other top-level keys (`updated`) are ignored.
 */
export const parsePageStateFile = (text: string, cap: number = PAGE_STATE_MAX_CHARS): { items: Map<string, string>; chars: number } | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== PAGE_STATE_FILE_VERSION || !Array.isArray(record.items)) return null;
  const items = new Map<string, string>();
  let chars = 0;
  for (const entry of record.items as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const key: unknown = entry[0];
    const value: unknown = entry[1];
    if (typeof key !== 'string' || typeof value !== 'string') return null;
    if (items.has(key)) continue;
    chars += key.length + value.length;
    if (chars > cap) return null;
    items.set(key, value);
  }
  return { items, chars };
};

/** The file text for `items` (one line, no personal data beyond the items themselves). */
export const serializePageStateFile = (items: ReadonlyMap<string, string>, updated: string): string =>
  `${JSON.stringify({ v: PAGE_STATE_FILE_VERSION, updated, items: [...items] satisfies PageStateItems })}\n`;

/**
 * Validate a delta from a request: `clear` absent or a boolean, `changes` absent or a list of at
 * most `PAGE_STATE_CHANGES_MAX` pairs of a string key and a string-or-null value. `null` when
 * anything else is there (the route answers 400). Size is bounded by the request or the upload;
 * the cap is checked on the result (`applyPageStateDelta`).
 */
export const parsePageStateDelta = (clear: unknown, changes: unknown): PageStateDelta | null => {
  if (clear !== undefined && typeof clear !== 'boolean') return null;
  if (changes !== undefined && (!Array.isArray(changes) || changes.length > PAGE_STATE_CHANGES_MAX)) return null;
  const out: StorageChange[] = [];
  for (const entry of (changes ?? []) as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const key: unknown = entry[0];
    const value: unknown = entry[1];
    if (typeof key !== 'string' || (value !== null && typeof value !== 'string')) return null;
    out.push([key, value]);
  }
  return { clear: clear === true, changes: out };
};

export type DeltaOutcome = { ok: true; chars: number; changed: boolean } | { ok: false; chars: number };

/**
 * Apply `delta` to `items` (`clear` first, then `changes` in order) only when the result stays
 * within `cap`; otherwise nothing is applied (`ok: false`, the current `chars`). The total is
 * worked out from the last change per key before anything is touched, so a refused delta leaves
 * the map exactly as it was. `changed` is false when the result equals what was there (a retried
 * PATCH), so the caller neither writes nor announces it.
 */
export const applyPageStateDelta = (items: Map<string, string>, chars: number, delta: PageStateDelta, cap: number = PAGE_STATE_MAX_CHARS): DeltaOutcome => {
  const last = new Map<string, string | null>();
  for (const [key, value] of delta.changes) last.set(key, value);

  let next = delta.clear ? 0 : chars;
  let changed = delta.clear && items.size > 0;
  for (const [key, value] of last) {
    const before = delta.clear ? undefined : items.get(key);
    next += entryChars(key, value) - (before === undefined ? 0 : entryChars(key, before));
    if ((before ?? null) !== value) changed = true;
  }
  if (next > cap) return { ok: false, chars };
  if (!changed) return { ok: true, chars, changed: false };

  if (delta.clear) items.clear();
  for (const [key, value] of delta.changes) {
    if (value === null) items.delete(key);
    else items.set(key, value);
  }
  return { ok: true, chars: next, changed: true };
};

// ---- gen: the per-design clear counter (§8.2, "Clear never comes back") ----

/** At most this long; the service refuses anything else with 400 (§10.2). */
export const PAGE_STATE_GEN_MAX = 120;

const GEN_PATTERN = /^([A-Za-z0-9_-]{1,100}):(0|[1-9][0-9]{0,15})$/;

/** `<epoch>:<n>`, `n` the clears so far in this service run. */
export const formatGen = (epoch: string, clears: number): string => `${epoch}:${clears}`;

/** The parts of a gen, or `null` when it is not a string of the form `<epoch>:<n>` within `PAGE_STATE_GEN_MAX`. */
export const parseGen = (gen: unknown): { epoch: string; clears: number } | null => {
  if (typeof gen !== 'string' || gen.length > PAGE_STATE_GEN_MAX) return null;
  const match = GEN_PATTERN.exec(gen);
  if (match === null) return null;
  const clears = Number(match[2]);
  if (!Number.isSafeInteger(clears)) return null;
  // Safe: group 1 is required by the pattern, so it is always present on a match.
  return { epoch: match[1] as string, clears };
};

/**
 * True when `gen` was handed out before a Clear that `current` has seen: same epoch, fewer
 * clears. A gen from another epoch (the service restarted since) is never older: the counter
 * cannot say, so it is accepted. Anything unparseable is not "older" (the route refuses it first).
 */
export const isOlderClear = (gen: string, current: string): boolean => {
  const mine = parseGen(gen);
  const theirs = parseGen(current);
  if (mine === null || theirs === null) return false;
  return mine.epoch === theirs.epoch && mine.clears < theirs.clears;
};
