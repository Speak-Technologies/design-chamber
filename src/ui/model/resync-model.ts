// What the re-sync sheet shows and sends (Phase 2.5 U5, technical design §7.3 and §9.3): the review of a code scan
// as groups with ticks, the one request that applies what is ticked, and the sentences for the ways a re-sync can
// stop. Pure: no DOM, no host calls. The service has the last word (it rebuilds the review at apply time and refuses
// anything that was not offered); this only decides what the sheet offers and says.
//
// The review has two flavours (technical design §7.4): `kind: 'code'` for a system kept in Design Chamber (this
// file), and `kind: 'repo'` for one that lives in a project's repo (U6: all or nothing, no ticks, no Undo).
// `isCodeReview` is the seam: the sheet paints a review only when it is a code one.

import type { CodeResyncReview, ResyncReview, SystemResyncBody } from '../../shared/api.ts';
import { checkValue } from './system-edit-model.ts';
import { plural } from './format.ts';

export type TokenMode = 'light' | 'dark';

export const isCodeReview = (review: ResyncReview): review is CodeResyncReview => review.kind === 'code';

// ---------------------------------------------------------------- sentences

export const KEPT_LINE = 'Your notes, overview, fonts and assets stay as they are. Only values change.';
export const PARTIAL_NOTE = 'Some files weren’t scanned, so tokens from them aren’t listed as removed.';
export const ROOT_CHANGED_SENTENCE = 'Your Designs folder changed. Nothing was changed.';
export const NOTHING_TICKED_REASON = 'Tick at least one change to apply.';
export const REMOVE_HINT = 'These are no longer in the code. They stay in the system unless you tick them.';
export const AGENT_TOKENS_NOTE = 'Tokens the agent or you added here are never listed.';
export const CHANGED_HINT = 'The code changed these values since you made the system.';
export const NEW_HINT = 'In the code, not in the system yet.';
export const FILES_HINT = 'Fonts and logos in the project that the system doesn’t have. Ticked ones are copied in.';
export const CONFLICT_HINT = 'You changed these here and the code changed them too. Your value stays unless you choose the code’s.';
export const NO_VALUE = 'not set';
/** How long the notice with Undo and "Ask the agent to update notes" stays up (it waits while the pointer or focus is on it). */
export const RESYNC_NOTICE_MS = 300_000;
/** A long group shows this many rows first; the rest are one click away. Ticks apply to every row, shown or not. */
export const GROUP_PAGE = 60;

export const matchesSentence = (system: string, folder: string): string => `${system} already matches ${folder}.`;

export const scanningLabel = (folder: string, seen: number): string => (seen > 0 ? `Reading ${folder}… ${plural(seen, 'file')} looked at` : `Reading ${folder}…`);

export const modeLabel = (mode: TokenMode): string => (mode === 'light' ? 'Light' : 'Dark');

// ---------------------------------------------------------------- the review as rows

export type ValueChange = { mode: TokenMode; from: string; to: string };
export type ChangedRow = { name: string; values: ValueChange[] };
export type ConflictValue = { mode: TokenMode; mine: string; code: string };
export type ConflictRow = { name: string; values: ConflictValue[] };

const byMode = (a: { mode: TokenMode }, b: { mode: TokenMode }): number => (a.mode === b.mode ? 0 : a.mode === 'light' ? -1 : 1);

/** Changed tokens, one row per name (a token that changed in both modes is one tick), light before dark. */
export const changedRows = (review: CodeResyncReview): ChangedRow[] => {
  const rows = new Map<string, ChangedRow>();
  for (const one of review.changed) {
    const row = rows.get(one.name) ?? { name: one.name, values: [] };
    row.values.push({ mode: one.mode, from: one.from, to: one.to });
    rows.set(one.name, row);
  }
  return [...rows.values()].map((row) => ({ ...row, values: row.values.sort(byMode) }));
};

export const conflictRows = (review: CodeResyncReview): ConflictRow[] => {
  const rows = new Map<string, ConflictRow>();
  for (const one of review.conflicts) {
    const row = rows.get(one.name) ?? { name: one.name, values: [] };
    row.values.push({ mode: one.mode, mine: one.mine, code: one.code });
    rows.set(one.name, row);
  }
  return [...rows.values()].map((row) => ({ ...row, values: row.values.sort(byMode) }));
};

/** "You changed this here. The code now says #0b6e66." (the mode comes first when the token has both). */
export const conflictSentence = (value: ConflictValue, both: boolean): string => `${both ? `${modeLabel(value.mode)}: ` : ''}You changed this here. The code now says ${value.code}.`;

const shown = (value: string): string => (value === '' ? NO_VALUE : value);
/** A token with more than one value, or only a dark one, says which mode each line is about. */
const labelled = (values: ReadonlyArray<{ mode: TokenMode }>): boolean => values.length > 1 || values[0]?.mode === 'dark';

/** "#ffffff → #f4f4f4", with "Light: " and "Dark: " in front when the token has both. */
export const changeLine = (row: ChangedRow): string =>
  row.values.map((value) => `${labelled(row.values) ? `${modeLabel(value.mode)}: ` : ''}${shown(value.from)} → ${shown(value.to)}`).join(' · ');

export const conflictLines = (row: ConflictRow): string[] => row.values.map((value) => conflictSentence(value, labelled(row.values)));

/** Nothing to apply: no list has a row. A partial scan with nothing listed is still "matches". */
export const reviewIsEmpty = (review: CodeResyncReview): boolean =>
  review.changed.length === 0 && review.conflicts.length === 0 && review.added.length === 0 && review.removed.length === 0 && review.assets.length === 0;

/** A value the sheet may paint as a swatch: only one that passes the same check as a colour typed into the page. */
export const swatchable = (value: string): boolean => value !== '' && checkValue('colours', null, value).ok;

export type GroupId = 'changes' | 'conflicts' | 'add' | 'remove' | 'assets';

export type GroupInfo = { id: GroupId; title: string; hint: string | null; ids: string[] };

/** The groups the review has rows for, in the order the sheet shows them. Empty groups are left out. */
export const reviewGroups = (review: CodeResyncReview): GroupInfo[] => {
  const groups: GroupInfo[] = [
    { id: 'changes', title: 'Changed', hint: CHANGED_HINT, ids: changedRows(review).map((row) => row.name) },
    { id: 'conflicts', title: 'Conflicts', hint: CONFLICT_HINT, ids: conflictRows(review).map((row) => row.name) },
    { id: 'add', title: 'New', hint: NEW_HINT, ids: [...review.added] },
    { id: 'remove', title: 'No longer in the code', hint: REMOVE_HINT, ids: [...review.removed] },
    { id: 'assets', title: 'New fonts and logos', hint: FILES_HINT, ids: review.assets.map((asset) => asset.path) },
  ];
  return groups.filter((group) => group.ids.length > 0);
};

// ---------------------------------------------------------------- ticks

/** What the user chose. `useCode` holds the conflicts settled with "Use the code's"; every other conflict keeps the user's value. */
export type ReviewTicks = {
  changes: ReadonlySet<string>;
  add: ReadonlySet<string>;
  remove: ReadonlySet<string>;
  useCode: ReadonlySet<string>;
  assets: ReadonlySet<string>;
};

/** Changed and New start ticked; removals and files start unticked; every conflict keeps the user's value. */
export const defaultTicks = (review: CodeResyncReview): ReviewTicks => ({
  changes: new Set(changedRows(review).map((row) => row.name)),
  add: new Set(review.added),
  remove: new Set(),
  useCode: new Set(),
  assets: new Set(),
});

export const isTicked = (ticks: ReviewTicks, group: GroupId, id: string): boolean => (group === 'conflicts' ? ticks.useCode : ticks[group]).has(id);

export const setTick = (ticks: ReviewTicks, group: GroupId, id: string, on: boolean): ReviewTicks => {
  const key = group === 'conflicts' ? 'useCode' : group;
  const next = new Set(ticks[key]);
  if (on) next.add(id);
  else next.delete(id);
  return { ...ticks, [key]: next };
};

/** Tick or untick a whole group at once (the group's own button). */
export const setGroup = (ticks: ReviewTicks, group: GroupId, ids: readonly string[], on: boolean): ReviewTicks => {
  const key = group === 'conflicts' ? 'useCode' : group;
  return { ...ticks, [key]: on ? new Set(ids) : new Set() };
};

export type GroupState = 'all' | 'some' | 'none';

export const groupState = (ticks: ReviewTicks, group: GroupId, ids: readonly string[]): GroupState => {
  const set = group === 'conflicts' ? ticks.useCode : ticks[group];
  const on = ids.filter((id) => set.has(id)).length;
  return on === 0 ? 'none' : on === ids.length ? 'all' : 'some';
};

/** What the group's button does next: "Untick all" when everything is ticked, else "Tick all". Conflicts say it in their own words. */
export const groupToggleLabel = (group: GroupId, state: GroupState): string => {
  if (group === 'conflicts') return state === 'all' ? 'Keep all mine' : 'Use all the code’s';
  return state === 'all' ? 'Untick all' : 'Tick all';
};

// ---------------------------------------------------------------- what Apply will do

export type ApplyCounts = { changed: number; added: number; removed: number; files: number };

/** `changed` counts a conflict settled with the code's value too: both write a new value. */
export const countsOf = (ticks: ReviewTicks): ApplyCounts => ({ changed: ticks.changes.size + ticks.useCode.size, added: ticks.add.size, removed: ticks.remove.size, files: ticks.assets.size });

const partsOf = (counts: ApplyCounts): string[] => [
  counts.changed > 0 ? `${counts.changed} changed` : '',
  counts.added > 0 ? `${counts.added} added` : '',
  counts.removed > 0 ? `${counts.removed} removed` : '',
  counts.files > 0 ? `${plural(counts.files, 'file')} copied` : '',
].filter((part) => part !== '');

export const nothingTicked = (ticks: ReviewTicks): boolean => {
  const counts = countsOf(ticks);
  return counts.changed + counts.added + counts.removed + counts.files === 0;
};

/** "Apply saves 5 changed, 2 added, 1 removed." or why Apply is off. */
export const selectionLine = (ticks: ReviewTicks): { text: string; canApply: boolean } => {
  if (nothingTicked(ticks)) return { text: NOTHING_TICKED_REASON, canApply: false };
  return { text: `Apply saves ${partsOf(countsOf(ticks)).join(', ')}.`, canApply: true };
};

/** The notice after a re-sync: "Re-synced Acme: 5 changed, 2 added, 1 removed." Parts that are zero are left out. */
export const resyncedSentence = (system: string, counts: ApplyCounts): string => {
  const parts = partsOf(counts);
  return parts.length === 0 ? `Re-synced ${system}.` : `Re-synced ${system}: ${parts.join(', ')}.`;
};

/** The request: names and paths only, never values (the service reads those from its own copy of the scan). */
export const applyBody = (scanId: string, stamp: string, ticks: ReviewTicks): SystemResyncBody => {
  const sorted = (set: ReadonlySet<string>): string[] => [...set].sort();
  return { scanId, stamp, changes: sorted(ticks.changes), add: sorted(ticks.add), remove: sorted(ticks.remove), useCode: sorted(ticks.useCode), assets: sorted(ticks.assets) };
};

// ---------------------------------------------------------------- when it stops

export type FailureKind = 'root-changed' | 'stale' | 'folder' | 'plain';

/**
 * The way a scan or an apply ended, from the service's code and sentence. `stale`: the system or the scan moved on
 * ("Scan again"); `folder`: the project folder can't be read ("Choose another folder…"); `root-changed`: the Designs
 * folder moved, the sheet closes; anything else is shown as it came and the user's ticks stay.
 */
export const failureKind = (code: string | null, message: string): FailureKind => {
  if (message === ROOT_CHANGED_SENTENCE) return 'root-changed';
  if (code === 'bad-path' || /^Design Chamber can['’]t read /.test(message)) return 'folder';
  if (/\bScan( the folder)? again\.?$/.test(message)) return 'stale';
  return 'plain';
};

/** A scan whose folder wasn't typed yet or can't be a path: the sentence to show, else null. */
export const folderInputProblem = (raw: string): string | null => {
  const path = raw.trim();
  if (path === '') return 'Type the full path of the folder.';
  if (!/^([A-Za-z]:[\\/]|\\\\|\/)/.test(path)) return 'Use the full path of the folder, such as C:\\Projects\\shop or /Users/you/shop.';
  return null;
};

/** The sheet's own state, as the title and the one line under it. */
export const sheetSubtitle = (system: string): string => `Read the project again and update ${system} from it.`;
