// The board probe's boundary and verdicts (documentation/specs/system-board-layout-and-visual-check.md
// §B.4, §B.6). The probe (src/guest/probe/board.ts) only measures, next to untrusted example script;
// `sanitizeBoardProbe` checks its answer for shape and size before any use, and every verdict is a
// pure function here. Findings carry codes, numbers and closed enums only; the entry key travels in
// `detail`, cleaned and clipped, and must pass `isBoardEntryKey` before it is named.

import { cleanDetail } from '../../shared/checks.ts';
import { BOARD_ENTRY_MAX, CHECK_DETAIL_MAX, SYSTEM_BOARD_FINDINGS_PER_CODE, SYSTEM_BOARD_ITEMS_MEASURED_MAX, SYSTEM_CHECK_BOARD_WIDTHS, SYSTEM_PAIRS_MAX } from '../../shared/limits.ts';
import { isBoardEntryKey, parseEntryKey } from '../../shared/system-board.ts';
import { FORCED_STATES, type ForcedState } from './render.ts';
import { SYSTEM_AREAS } from '../../shared/system-json.ts';
import type { BoardLayout, CheckCode, CheckFindingData, SystemArea, SystemDetail } from '../../shared/types.ts';
import { compositeOver, contrastRatio, type Rgba } from '../../shared/color.ts';
import { MEASURED_PAIR_TOLERANCE, PAIR_LEVELS, type LowPair, type PairScheme } from '../../shared/pair-contrast.ts';
import { contrastFindings } from './system-static.ts';

/** A board pass's id: the two light widths, and the dark pass (system-builder-depth D8). */
export type BoardPassId = 'wide' | 'narrow' | 'wide-dark';

/** One board width the check measures at. */
export type BoardWidth = { id: BoardPassId; label: string; width: number; height: number };

/** One board pass the check draws: a width, and the scheme the board is assembled in. */
export type BoardPass = BoardWidth & { scheme: PairScheme };

/** The two light passes (`SYSTEM_CHECK_BOARD_WIDTHS`) and the dark pass, drawn at the wide width only, last. */
export const BOARD_PASSES: readonly BoardPass[] = Object.freeze([
  ...SYSTEM_CHECK_BOARD_WIDTHS.map((width) => ({ ...width, scheme: 'light' as const })),
  { id: 'wide-dark', label: 'Wide board, dark', width: SYSTEM_CHECK_BOARD_WIDTHS[0].width, height: SYSTEM_CHECK_BOARD_WIDTHS[0].height, scheme: 'dark' },
]);

/** The areas the dark pass pictures (D8: brand is left to the light passes). */
export const DARK_PASS_AREAS: readonly SystemArea[] = Object.freeze(['foundations', 'components', 'patterns']);

/**
 * Which passes a run draws (D8, the user's decision 7): both light widths, then the dark pass when the
 * system has a dark value. `--scheme light` drops the dark pass; `--scheme dark` draws only it.
 */
export const boardPassesOf = (scheme: 'light' | 'dark' | 'both' | null, hasDark: boolean): BoardPass[] => {
  if (scheme === 'dark') return BOARD_PASSES.filter((pass) => pass.scheme === 'dark');
  if (scheme === 'light' || !hasDark) return BOARD_PASSES.filter((pass) => pass.scheme === 'light');
  return [...BOARD_PASSES];
};

/**
 * Each pass's share of the picture budgets: half each for the two light widths as before; with the
 * dark pass 0.4 / 0.3 / 0.3; one pass alone takes all of it.
 */
export const passShare = (passes: readonly BoardPass[], pass: BoardPass): number => {
  if (passes.length === 3) return pass.id === 'wide' ? 0.4 : 0.3;
  return 1 / Math.max(1, passes.length);
};

export type BoardProbePreview = {
  /** The host's client width and scroll width. */
  w: number;
  scrollW: number;
  /** The furthest right edge of any shadow element, minus the host's left edge. */
  contentRight: number;
  /** How far any shadow element reaches past the entry's box on that side (≥ 0). */
  outLeft: number;
  outTop: number;
  outBottom: number;
};

export type BoardProbeItem = {
  /** The `data-dc-entry` value; '' when absent. */
  entry: string;
  /** Whether the board script widened this card or row. */
  widened: boolean;
  /** The entry's box in document coordinates. */
  box: { x: number; y: number; w: number; h: number };
  previews: BoardProbePreview[];
  /** Light-DOM text beyond the entry's box, px ≥ 0. */
  textOut: number;
};

/** One colour pair cell (`[data-dc-pair]`): its painted colours as sRGB bytes `[r, g, b, a]`, read back through a detached canvas. */
export type BoardProbePair = { key: string; fg: number[]; bg: number[]; ground: number[] };

export type BoardProbe = {
  innerWidth: number;
  scrollWidth: number;
  scrollHeight: number;
  /** From `[data-dc-area]`, at most four. */
  areas: { area: string; top: number; height: number }[];
  items: BoardProbeItem[];
  /** More entries than the probe measures. */
  truncated: boolean;
  /** The pair cells (system-builder-depth §4.5): one per pair per ground; absent in an older probe. */
  pairs?: BoardProbePair[];
};

/** Pair cells per pass: a light and a dark ground for each of `SYSTEM_PAIRS_MAX` pairs. */
export const BOARD_PAIR_CELLS_MAX = SYSTEM_PAIRS_MAX * 2;

/** `3-dark`: the pair's index and its ground, as the board writes `data-dc-pair` (src/shared/pair-contrast.ts `pairKey`). */
const PAIR_KEY = /^(\d{1,3})-(light|dark)$/;

// ---- the boundary ----

const isRec = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, min = 0, max = 1e7): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null);

const parseBox = (value: unknown): BoardProbeItem['box'] | null => {
  if (!isRec(value)) return null;
  const x = finite(value.x, -1e7);
  const y = finite(value.y, -1e7);
  const w = finite(value.w);
  const h = finite(value.h);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
};

const parsePreview = (value: unknown): BoardProbePreview | null => {
  if (!isRec(value)) return null;
  const w = finite(value.w);
  const scrollW = finite(value.scrollW);
  const contentRight = finite(value.contentRight);
  const outLeft = finite(value.outLeft);
  const outTop = finite(value.outTop);
  const outBottom = finite(value.outBottom);
  return w === null || scrollW === null || contentRight === null || outLeft === null || outTop === null || outBottom === null
    ? null
    : { w, scrollW, contentRight, outLeft, outTop, outBottom };
};

const parseItem = (value: unknown): BoardProbeItem | null => {
  if (!isRec(value)) return null;
  const box = parseBox(value.box);
  if (box === null) return null;
  const textOut = finite(value.textOut);
  if (textOut === null) return null;
  const previews: BoardProbePreview[] = [];
  if (Array.isArray(value.previews)) {
    // At most two grounds (light and dark) per entry; the probe caps its scan at the same number.
    for (const entry of value.previews.slice(0, 2)) {
      const preview = parsePreview(entry);
      if (preview !== null) previews.push(preview);
    }
  }
  return {
    entry: typeof value.entry === 'string' ? cleanDetail(value.entry, BOARD_ENTRY_MAX) : '',
    widened: value.widened === true,
    box,
    previews,
    textOut,
  };
};

/** Four integer bytes 0..255, or null: anything else is not what the canvas reads back. */
const colourBytes = (value: unknown): number[] | null =>
  Array.isArray(value) && value.length === 4 && value.every((byte) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255) ? (value as number[]) : null;

/**
 * The pair cells, checked: a key the board writes and three colours of four bytes each; a bad cell is
 * dropped. A list longer than the board can write (`BOARD_PAIR_CELLS_MAX`) is forged or broken, so the
 * whole list is refused and no pair is measured from it.
 */
const parsePairs = (value: unknown): BoardProbePair[] => {
  if (!Array.isArray(value) || value.length > BOARD_PAIR_CELLS_MAX) return [];
  const out: BoardProbePair[] = [];
  for (const entry of value) {
    if (!isRec(entry) || typeof entry.key !== 'string' || !PAIR_KEY.test(entry.key)) continue;
    const fg = colourBytes(entry.fg);
    const bg = colourBytes(entry.bg);
    const ground = colourBytes(entry.ground);
    if (fg === null || bg === null || ground === null) continue;
    out.push({ key: entry.key, fg, bg, ground });
  }
  return out;
};

/**
 * The probe's answer as trusted data, or `null` when it is not the shape the probe returns. Numbers
 * are finite and bounded, arrays capped, strings clipped; a broken item or preview is dropped, never
 * fatal. The probe ran next to untrusted script, so nothing here is taken on faith.
 */
export const sanitizeBoardProbe = (value: unknown): BoardProbe | null => {
  if (!isRec(value)) return null;
  const innerWidth = finite(value.innerWidth);
  const scrollWidth = finite(value.scrollWidth);
  const scrollHeight = finite(value.scrollHeight);
  if (innerWidth === null || scrollWidth === null || scrollHeight === null) return null;
  const areas: BoardProbe['areas'] = [];
  if (Array.isArray(value.areas)) {
    for (const entry of value.areas.slice(0, SYSTEM_AREAS.length)) {
      if (!isRec(entry)) continue;
      const area = entry.area;
      const top = finite(entry.top);
      const height = finite(entry.height);
      if (typeof area !== 'string' || !(SYSTEM_AREAS as readonly string[]).includes(area) || top === null || height === null) continue;
      areas.push({ area, top, height });
    }
  }
  const items: BoardProbeItem[] = [];
  if (Array.isArray(value.items)) {
    for (const entry of value.items.slice(0, SYSTEM_BOARD_ITEMS_MEASURED_MAX)) {
      const item = parseItem(entry);
      if (item !== null) items.push(item);
    }
  }
  return { innerWidth, scrollWidth, scrollHeight, areas, items, truncated: value.truncated === true, pairs: parsePairs(value.pairs) };
};

// ---- verdicts ----

export type BoardAnalyzeContext = {
  width: BoardWidth;
  /** Whether this is the widest width drawn (the hint note is raised there only). */
  widest: boolean;
  /** The entry's effective layout, from the detail. */
  layoutOf: (entry: string) => BoardLayout;
  /** `components/<id>.html` for a component entry, `board.html` otherwise. */
  fileOf: (entry: string) => string;
};

const BOARD_FILE = 'board.html';

/** Every verdict for one width, from the probe's measurements. The 1px tolerance matches the board script's. */
export const analyzeBoard = (probe: BoardProbe, ctx: BoardAnalyzeContext): CheckFindingData[] => {
  const findings: CheckFindingData[] = [];
  const where = { file: BOARD_FILE, screen: null, viewport: ctx.width.id };

  if (probe.scrollWidth > probe.innerWidth + 1) {
    findings.push({ code: 'system-board-overflow', ...where, params: { px: Math.round(probe.scrollWidth), width: ctx.width.width } });
  }

  for (const item of probe.items) {
    // A forged or malformed key never reaches a sentence: it is shown as data only when well-formed.
    if (!isBoardEntryKey(item.entry)) continue;
    const at = { file: ctx.fileOf(item.entry), screen: null, viewport: ctx.width.id };
    let previewTooWide = false;
    for (const preview of item.previews) {
      const wide = Math.max(preview.scrollW, preview.contentRight);
      if (wide > preview.w + 1) {
        previewTooWide = true;
        findings.push({ code: 'system-board-preview-wide', ...at, params: { px: Math.round(wide), width: Math.round(preview.w) }, detail: item.entry });
      }
      const outside = Math.max(preview.outLeft, preview.outTop, preview.outBottom);
      if (outside > 1) {
        findings.push({ code: 'system-board-preview-outside', ...at, params: { px: Math.round(outside) }, detail: item.entry });
      }
    }
    if (item.textOut > 1) {
      findings.push({ code: 'system-board-text-outside', ...at, params: { px: Math.round(item.textOut) }, detail: item.entry });
    }
    // A preview still too wide after widening needs a smaller example, not a bigger layout: no hint then.
    if (item.widened && ctx.widest && !previewTooWide) {
      const layout = ctx.layoutOf(item.entry);
      if (layout !== 'full') findings.push({ code: 'system-board-hint-small', ...at, params: { layout }, detail: item.entry });
    }
  }

  if (probe.truncated) {
    findings.push({ code: 'system-board-partial', ...where, params: { pictured: 'entries', max: SYSTEM_BOARD_ITEMS_MEASURED_MAX } });
  }
  return findings;
};

/** The entry-level codes: one finding per (code, entry) survives dedupe. */
const ENTRY_CODES: ReadonlySet<CheckCode> = new Set<CheckCode>(['system-board-preview-wide', 'system-board-preview-outside', 'system-board-text-outside', 'system-board-hint-small']);

const widthRank = (finding: CheckFindingData): number => (finding.viewport === 'wide' ? 0 : finding.viewport === 'narrow' ? 1 : 2);

/**
 * One finding per (code, entry): the widest width that raised it wins (it fails even with the most
 * room); a finding raised only at narrow stays at narrow, one raised only in the dark pass stays there.
 * Board-level codes (overflow, partial, the render codes) are kept per width, except that the dark
 * pass repeats nothing the light wide pass already said (same code and detail). Input order is preserved.
 */
export const dedupeBoardFindings = (findings: readonly CheckFindingData[]): CheckFindingData[] => {
  const best = new Map<string, CheckFindingData>();
  const keyOf = (finding: CheckFindingData): string => `${finding.code}|${finding.detail ?? ''}`;
  for (const finding of findings) {
    if (!ENTRY_CODES.has(finding.code)) continue;
    const known = best.get(keyOf(finding));
    if (known === undefined || widthRank(finding) < widthRank(known)) best.set(keyOf(finding), finding);
  }
  const atWide = new Set(findings.filter((finding) => finding.viewport === 'wide').map(keyOf));
  return findings.filter((finding) => {
    if (ENTRY_CODES.has(finding.code)) return best.get(keyOf(finding)) === finding;
    return !(finding.viewport === 'wide-dark' && atWide.has(keyOf(finding)));
  });
};

// ---- forced state pictures (system-builder-depth T16) ----

/** One labelled state the probe found: the component entry, the state, where to force it, and its box. */
export type BoardStateTarget = {
  entry: string;
  state: ForcedState;
  /** Index among `[data-dc-example-host]` in the document. */
  host: number;
  /** Index among `*` in that host's shadow root. */
  element: number;
  /** The element is the instance's rest twin (same variant and size), not the labelled instance itself. */
  twin: boolean;
  /** The instance's `data-dc-variant`, lower case; '' when it has none or it isn't a plain short name. */
  variant: string;
  box: { x: number; y: number; w: number; h: number };
};

/** A variant as a picture's name and the text take it: lower-case letters, digits and dashes. */
const VARIANT_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type BoardStateProbe = { states: BoardStateTarget[]; truncated: boolean };

/** An index the probe could have counted: an integer from 0 to 100 000. */
const indexOf = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : null);

/**
 * The probe's state list as trusted data: a component entry key, a state from the closed set, two indexes
 * and a finite box; anything else is dropped. A list longer than `max` is forged or broken and refused.
 */
export const sanitizeStateProbe = (value: unknown, max: number): BoardStateProbe => {
  if (!isRec(value) || !Array.isArray(value.states) || value.states.length > max) return { states: [], truncated: false };
  const states: BoardStateTarget[] = [];
  for (const entry of value.states) {
    if (!isRec(entry) || typeof entry.entry !== 'string' || !isBoardEntryKey(entry.entry) || parseEntryKey(entry.entry)?.kind !== 'component') continue;
    const state = FORCED_STATES.find((candidate) => candidate === entry.state);
    const host = indexOf(entry.host);
    const element = indexOf(entry.element);
    const box = parseBox(entry.box);
    if (state === undefined || host === null || element === null || box === null) continue;
    const variant = typeof entry.variant === 'string' ? entry.variant.trim().toLowerCase().replace(/\s+/g, '-') : '';
    states.push({ entry: entry.entry, state, host, element, twin: entry.twin === true, variant: VARIANT_PATTERN.test(variant) ? variant : '', box });
  }
  return { states, truncated: value.truncated === true };
};

const NONE_STYLE = new Set(['none', 'hidden']);
const zeroWidth = (width: string | undefined): boolean => width === undefined || /^0(\.0+)?(px)?$/.test(width.trim());

/**
 * The computed values a person would see, from `STATE_STYLE_PROPERTIES`: an outline or a top border with
 * no style or no width paints nothing, so its colour and offset don't count.
 */
const visibleStyle = (style: Readonly<Record<string, string>>): Record<string, string> => {
  const out: Record<string, string> = {};
  const outlineShown = !NONE_STYLE.has(style['outline-style'] ?? 'none') && !zeroWidth(style['outline-width']);
  const borderShown = !NONE_STYLE.has(style['border-top-style'] ?? 'none') && !zeroWidth(style['border-top-width']);
  for (const [name, value] of Object.entries(style)) {
    if (name.startsWith('outline-') && !outlineShown) continue;
    if (name.startsWith('border-') && name.endsWith('-color') && !borderShown) continue;
    out[name] = value;
  }
  if (!outlineShown) out['outline-style'] = 'none';
  return out;
};

/**
 * Whether forcing a state changed anything a person would see on the element: any compared value, as
 * painted (T16). A `:focus-visible` that only changes the colour counts; `outline: none` and nothing
 * else doesn't, because the browser's own focus ring is then gone too.
 */
export const stateStyled = (before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): boolean => {
  const a = visibleStyle(before);
  const b = visibleStyle(after);
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of names) if ((a[name] ?? '') !== (b[name] ?? '')) return true;
  return false;
};

/** Why a forced state likely changed nothing, when the check can tell (`CheckParams.hint`). */
export type StateHint = 'rest' | 'focus-visible';

/**
 * One forced state as the check saw it: the picture (null when it couldn't be taken; the element at rest
 * beside it with the state forced), the verdict, the instance's variant when it names one, and for
 * an unstyled one the likely cause: `rest` when it was forced on the labelled copy itself (no resting copy
 * with the same variant and size), `focus-visible` when labelled focus but :focus-visible changes it.
 */
export type StateResult = { entry: string; state: ForcedState; png: string | null; styled: boolean; variant?: string; hint?: StateHint };

/** The words a hint adds after its state in the finding's detail. */
const HINT_DETAIL: Readonly<Record<StateHint, string>> = { rest: 'no resting copy beside it to force the state on', 'focus-visible': 'labelled focus but its CSS styles :focus-visible' };

/**
 * The `system-state-unstyled` findings: one per component whose labelled states change nothing when
 * forced, naming the component and those states in `detail` (`button: hover, focus-visible`).
 */
export const stateFindings = (results: readonly StateResult[], viewport: BoardPassId): CheckFindingData[] => {
  // Per component, each unstyled state once, with the first hint any of its instances gave.
  const unstyled = new Map<string, Map<ForcedState, StateHint | undefined>>();
  for (const result of results) {
    if (result.styled) continue;
    const id = parseEntryKey(result.entry)?.key;
    if (id === undefined) continue;
    let states = unstyled.get(id);
    if (states === undefined) unstyled.set(id, (states = new Map()));
    if (!states.has(result.state) || states.get(result.state) === undefined) states.set(result.state, result.hint);
  }
  return [...unstyled].map(([id, states]) => {
    const hints = new Set([...states.values()].filter((hint): hint is StateHint => hint !== undefined));
    const hint = hints.size === 2 ? 'both' : [...hints][0];
    const named = [...states].map(([state, why]) => (why === undefined ? state : `${state} (${HINT_DETAIL[why]})`));
    return {
      code: 'system-state-unstyled',
      file: `components/${id}.html`,
      screen: null,
      viewport,
      params: { count: states.size, ...(hint !== undefined ? { hint } : {}) },
      detail: cleanDetail(`${id}: ${named.join(', ')}`, CHECK_DETAIL_MAX),
    };
  });
};

// ---- motion frames (system-builder-depth T17) ----

/** One element to picture in motion: a Motion section demo chip, or an example element labelled `data-dc-motion`. */
export type BoardMotionTarget = {
  /** A token entry for a demo, a component, pattern or brand entry for an example element. */
  entry: string;
  kind: 'demo' | 'example';
  /** The example host's index among `[data-dc-example-host]`; null for a demo. */
  host: number | null;
  /** A demo's index among `.dc-motion-demo`, or the element's index among `*` in the host's shadow root. */
  element: number;
  trigger: ForcedState;
  box: { x: number; y: number; w: number; h: number };
};

export type BoardMotionProbe = { items: BoardMotionTarget[]; truncated: boolean };

/** The entry kinds motion is read from, and the area each is in (for `--area`). */
const MOTION_ENTRY_AREAS: Readonly<Record<string, SystemArea>> = { token: 'foundations', component: 'components', pattern: 'patterns', brand: 'brand' };

/** The area a motion entry belongs to, or null for a kind motion isn't read from. */
export const motionAreaOf = (entry: string): SystemArea | null => {
  const kind = parseEntryKey(entry)?.kind;
  return kind === undefined ? null : (MOTION_ENTRY_AREAS[kind] ?? null);
};

/**
 * The probe's motion list as trusted data: a well-formed entry of a kind motion is read from (a demo
 * under a token, an example element under a component, pattern or brand), the closed triggers, whole
 * indexes and a finite box. A list longer than `max` is forged or broken and refused.
 */
export const sanitizeMotionProbe = (value: unknown, max: number): BoardMotionProbe => {
  if (!isRec(value) || !Array.isArray(value.items) || value.items.length > max) return { items: [], truncated: false };
  const items: BoardMotionTarget[] = [];
  for (const item of value.items) {
    if (!isRec(item) || typeof item.entry !== 'string' || !isBoardEntryKey(item.entry)) continue;
    const kind = item.kind === 'demo' || item.kind === 'example' ? item.kind : null;
    const entryKind = parseEntryKey(item.entry)?.kind;
    if (kind === null || (kind === 'demo') !== (entryKind === 'token') || motionAreaOf(item.entry) === null) continue;
    const host = kind === 'demo' ? (item.host === null ? null : undefined) : (indexOf(item.host) ?? undefined);
    const element = indexOf(item.element);
    const trigger = FORCED_STATES.find((candidate) => candidate === item.trigger);
    const box = parseBox(item.box);
    if (host === undefined || element === null || trigger === undefined || box === null) continue;
    items.push({ entry: item.entry, kind, host, element, trigger, box });
  }
  return { items, truncated: value.truncated === true };
};

/** One motion strip as the check took it: the picture, how many frames, whether anything moved, with reduced motion, and how long it runs (ms). */
export type MotionResult = { entry: string; trigger: ForcedState; png: string; frames: number; moved: boolean; reducedMoves: boolean; ms?: number };

// ---- one area only (`--area`) ----

/**
 * The findings of one pass that belong to `area`: an entry's finding when its box starts inside the
 * area; the board-level ones (overflow, partial) always, since they are about the whole board.
 */
export const findingsInArea = (findings: readonly CheckFindingData[], probe: BoardProbe, area: SystemArea): CheckFindingData[] => {
  const measured = probe.areas.find((candidate) => candidate.area === area);
  if (measured === undefined) return findings.filter((finding) => !ENTRY_CODES.has(finding.code));
  const inside = new Set(probe.items.filter((item) => item.box.y >= measured.top && item.box.y < measured.top + measured.height).map((item) => item.entry));
  return findings.filter((finding) => !ENTRY_CODES.has(finding.code) || (finding.detail !== undefined && inside.has(finding.detail)));
};

// ---- measured colour pairs (system-builder-depth D6, §4.5) ----

const rgbaOf = (bytes: readonly number[]): Rgba => ({ r: bytes[0] ?? 0, g: bytes[1] ?? 0, b: bytes[2] ?? 0, a: (bytes[3] ?? 255) / 255 });

/**
 * The pair cells' verdicts, in Node: the text colour over the cell's background over its ground (each
 * composited as painted), against the pair's level less `MEASURED_PAIR_TOLERANCE`. A cell whose pair
 * and ground Node already judged from the values (`judged`, `pair-contrast.ts`) is skipped, so a pair
 * is judged once; so is a cell seen in an earlier pass. The low ones, to merge with the static ones.
 */
export const measuredLowPairs = (cells: readonly BoardProbePair[], detail: Pick<SystemDetail, 'pairs'>, judged: ReadonlySet<string>): LowPair[] => {
  const seen = new Set<string>();
  const low: LowPair[] = [];
  for (const cell of cells) {
    if (seen.has(cell.key) || judged.has(cell.key)) continue;
    seen.add(cell.key);
    const match = PAIR_KEY.exec(cell.key);
    const pair = match === null ? undefined : detail.pairs[Number(match[1])];
    if (match === null || pair === undefined) continue;
    const scheme: PairScheme = match[2] === 'dark' ? 'dark' : 'light';
    const ground = compositeOver(rgbaOf(cell.ground), { r: 255, g: 255, b: 255, a: 1 });
    const ratio = contrastRatio(rgbaOf(cell.fg), [rgbaOf(cell.bg), ground]);
    if (ratio < PAIR_LEVELS[pair.use] - MEASURED_PAIR_TOLERANCE) low.push({ index: Number(match[1]), pair, scheme, ratio });
  }
  return low;
};

/** The measured verdicts alone as findings, one per scheme (the run merges them with the static ones instead). */
export const measuredPairFindings = (cells: readonly BoardProbePair[], detail: Pick<SystemDetail, 'pairs' | 'depth'>, judged: ReadonlySet<string>): CheckFindingData[] =>
  contrastFindings(measuredLowPairs(cells, detail, judged), detail.depth);

/**
 * The board findings after dedupe, the per-code cap and the overall cap, in that order (§B.3 step 7).
 * The cap is per code across entries and widths (the board's own rule, not the design's per-file one).
 */
export const boardFindings = (findings: readonly CheckFindingData[], findingsMax: number): CheckFindingData[] => {
  const counts = new Map<CheckCode, number>();
  const out: CheckFindingData[] = [];
  for (const finding of dedupeBoardFindings(findings)) {
    const n = counts.get(finding.code) ?? 0;
    if (n >= SYSTEM_BOARD_FINDINGS_PER_CODE) continue;
    counts.set(finding.code, n + 1);
    out.push(finding);
  }
  return out.slice(0, findingsMax);
};