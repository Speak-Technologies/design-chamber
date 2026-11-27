// The board probe's boundary and verdicts (documentation/specs/system-board-layout-and-visual-check.md
// §B.4, §B.6). The probe (src/guest/probe/board.ts) only measures, next to untrusted example script;
// `sanitizeBoardProbe` checks its answer for shape and size before any use, and every verdict is a
// pure function here. Findings carry codes, numbers and closed enums only; the entry key travels in
// `detail`, cleaned and clipped, and must pass `isBoardEntryKey` before it is named.

import { cleanDetail } from '../../shared/checks.ts';
import { BOARD_ENTRY_MAX, CHECK_DETAIL_MAX, SYSTEM_BOARD_FINDINGS_PER_CODE, SYSTEM_BOARD_ITEMS_MEASURED_MAX, SYSTEM_CHECK_BOARD_WIDTHS, SYSTEM_PAIRS_MAX } from '../../shared/limits.ts';
import { isBoardEntryKey } from '../../shared/system-board.ts';
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