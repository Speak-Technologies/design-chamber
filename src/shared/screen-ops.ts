// Pure planning for the user's screen actions (Phase 2 technical design §5.2, §6.1, §6.2):
// reorder, duplicate, move to trash and keep a direction, over the RAW `screens` value of
// design.json. Raw, because the agent owns that list (§5.1): every entry the normaliser drops
// (an invalid id, a wrong file, a duplicate, one past the cap) and every key Design Chamber does
// not know (direction marks included) stays exactly as the agent wrote it.
//
// Nothing here touches the disk; the service's op module (`src/service/edits/ops-screens.ts`)
// reads, checks stamps and hands the results to the pipeline.

import { directionGroups, normalizeDesign, screenFileOf } from './design-json.ts';
import { SCREEN_ID_PATTERN, SCREENS_MAX, TITLE_MAX } from './limits.ts';
import type { JsonObject, JsonValue } from './types.ts';

export { directionGroups };

// ---- sentences (§2.8, §5.5) ----

export const SCREEN_LIST_STALE_MESSAGE = 'The screen list changed while you were working. Nothing was changed.';
export const NO_DESIGN_JSON_MESSAGE = "This design has no design.json yet, so its screens can't be changed here.";
export const DESIGN_JSON_UNREADABLE_MESSAGE = "design.json can't be read right now. Ask the agent to fix it.";
export const SCREEN_LIST_UNREADABLE_MESSAGE = "The screen list in design.json can't be read. Ask the agent to fix it.";
export const PAGE_HAS_NO_SCREENS_MESSAGE = 'This design is a page, so it has no screens to change.';
export const SCREENS_CAP_MESSAGE = `A canvas holds up to ${SCREENS_MAX} screens.`;

// ---- which raw entries are the listed screens ----

const isRecord = (value: JsonValue): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const NORMALIZE_ONE = { kind: 'canvas', fallbackTitle: 'screen', fallbackTime: '1970-01-01T00:00:00.000Z' } as const;

/** True when the normaliser keeps this entry as a screen on its own (its id and file rules). */
const parsesAsScreen = (entry: JsonValue): boolean => normalizeDesign({ kind: 'canvas', screens: [entry] }, NORMALIZE_ONE).design.screens.length === 1;

export type ListedSlot = { index: number; id: string };

/**
 * The raw index of every screen the wall lists, in list order. The same rules as the normaliser
 * (it decides each entry; first of a duplicated id wins; the cap cuts the rest), so the ids here
 * are exactly `design.screens` ids.
 */
export const listedSlots = (raw: readonly JsonValue[]): ListedSlot[] => {
  const slots: ListedSlot[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    if (slots.length >= SCREENS_MAX || !isRecord(entry) || typeof entry.id !== 'string' || seen.has(entry.id) || !parsesAsScreen(entry)) return;
    seen.add(entry.id);
    slots.push({ index, id: entry.id });
  });
  return slots;
};

// ---- reorder ----

/**
 * The listed entries in `order`, each moved verbatim into the slots the listed entries held;
 * every other raw entry keeps its index. Null when `order` is not exactly the listed ids, once each.
 */
export const reorderRaw = (raw: readonly JsonValue[], order: readonly string[]): JsonValue[] | null => {
  const slots = listedSlots(raw);
  if (order.length !== slots.length || new Set(order).size !== order.length) return null;
  const byId = new Map(slots.map((slot) => [slot.id, raw[slot.index]] as const));
  const next = [...raw];
  for (const [position, slot] of slots.entries()) {
    const entry = byId.get(order[position] ?? '');
    if (entry === undefined) return null;
    next[slot.index] = entry;
  }
  return next;
};

/** The direction groups as `directionGroups` answers them: a row's original and the members hidden inside it. */
export type MoveDirectionGroups = readonly { of: string; members: readonly { id: string }[] }[];

/**
 * The notice's view of a reorder: when exactly one screen moved, which one and the shown screen it
 * now sits above (`null` = it is last). Null when several moved or nothing did.
 *
 * The wall drags whole rows: a row's directions travel right after it, and it lands in a gap between
 * shown rows, never inside another row's directions. With `groups`, a candidate that breaks either
 * rule is not the dragged row, and `above` skips the candidate's own directions. An adjacent swap of
 * two plain rows still reads as either moving; the one first in the old order is named. Without
 * `groups`, or when no candidate fits a row move, the first candidate in the old order is named too.
 */
export const describeMove = (
  before: readonly string[],
  after: readonly string[],
  groups: MoveDirectionGroups = [],
): { moved: string; above: string | null } | null => {
  if (before.length !== after.length || before.every((id, index) => after[index] === id)) return null;
  const membersOf = new Map(groups.map((group) => [group.of, group.members.map((member) => member.id)] as const));
  const hidden = new Set(groups.flatMap((group) => group.members.map((member) => member.id)));
  let fallback: { moved: string; above: string | null } | null = null;
  for (const candidate of before) {
    const rest = (list: readonly string[]): string[] => list.filter((id) => id !== candidate);
    const a = rest(before);
    const b = rest(after);
    if (a.length !== b.length || !a.every((id, index) => b[index] === id)) continue;
    const at = after.indexOf(candidate);
    fallback ??= { moved: candidate, above: after[at + 1] ?? null };
    const members = membersOf.get(candidate) ?? [];
    const block = after.slice(at + 1, at + 1 + members.length);
    const above = after[at + 1 + members.length] ?? null;
    const travelsTogether = block.length === members.length && members.every((id) => block.includes(id));
    if (travelsTogether && (above === null || !hidden.has(above))) return { moved: candidate, above };
  }
  return fallback;
};

// ---- duplicate ----

/** Highest `-copy-n` tried before giving up (the folder would need thousands of copies). */
const COPY_SUFFIX_MAX = 999;
/** The longest id `SCREEN_ID_PATTERN` allows. */
const SCREEN_ID_MAX = 41;

/**
 * The first free id of `<id>-copy`, `<id>-copy-2`, `-3`…: free means not in `taken` (the caller
 * passes listed ids, every raw id and every `screens/*.html` stem on disk, lower-cased). When the
 * candidate would be longer than the pattern allows, the base is cut to fit and a trailing `-`
 * trimmed. Null past `-copy-999`.
 */
export const freeCopyId = (id: string, taken: ReadonlySet<string>): string | null => {
  for (let n = 1; n <= COPY_SUFFIX_MAX; n += 1) {
    const suffix = n === 1 ? '-copy' : `-copy-${n}`;
    const base = id.slice(0, SCREEN_ID_MAX - suffix.length).replace(/-+$/, '');
    const candidate = `${base}${suffix}`;
    if (SCREEN_ID_PATTERN.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return null;
};

/** `<Title> copy`, the title cut so the whole stays within `TITLE_MAX`. */
export const copyTitle = (title: string): string => `${title.slice(0, TITLE_MAX - ' copy'.length).trimEnd()} copy`;

/**
 * The list with a copy of `id`'s raw entry inserted right after it: `id`, `file` and `title`
 * replaced, `direction` removed (marks name the original), every other key kept. Null when `id`
 * is not listed.
 */
export const duplicateRaw = (raw: readonly JsonValue[], id: string, copyId: string, title: string): JsonValue[] | null => {
  const slot = listedSlots(raw).find((one) => one.id === id);
  const source = slot === undefined ? undefined : raw[slot.index];
  if (slot === undefined || source === undefined || !isRecord(source)) return null;
  const copy: JsonObject = { ...structuredClone(source), id: copyId, title, file: screenFileOf(copyId) };
  delete copy.direction;
  return [...raw.slice(0, slot.index + 1), copy, ...raw.slice(slot.index + 1)];
};

// ---- trash and keep ----

/**
 * The list without every entry carrying one of `ids`, so a hidden duplicate entry cannot come
 * back as the screen just removed. Everything else stays in order.
 */
export const removeRaw = (raw: readonly JsonValue[], ids: ReadonlySet<string>): JsonValue[] =>
  raw.filter((entry) => !(isRecord(entry) && typeof entry.id === 'string' && ids.has(entry.id)));
