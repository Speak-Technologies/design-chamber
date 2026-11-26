// The board probe's boundary and verdicts (documentation/specs/system-board-layout-and-visual-check.md
// §B.4, §B.6). The probe (src/guest/probe/board.ts) only measures, next to untrusted example script;
// `sanitizeBoardProbe` checks its answer for shape and size before any use, and every verdict is a
// pure function here. Findings carry codes, numbers and closed enums only; the entry key travels in
// `detail`, cleaned and clipped, and must pass `isBoardEntryKey` before it is named.

import { cleanDetail } from '../../shared/checks.ts';
import { BOARD_ENTRY_MAX, SYSTEM_BOARD_FINDINGS_PER_CODE, SYSTEM_BOARD_ITEMS_MEASURED_MAX, SYSTEM_CHECK_BOARD_WIDTHS } from '../../shared/limits.ts';
import { isBoardEntryKey } from '../../shared/system-board.ts';
import { SYSTEM_AREAS } from '../../shared/system-json.ts';
import type { BoardLayout, CheckCode, CheckFindingData } from '../../shared/types.ts';

/** One of the two board widths the check draws (`SYSTEM_CHECK_BOARD_WIDTHS`). */
export type BoardWidth = (typeof SYSTEM_CHECK_BOARD_WIDTHS)[number];

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

export type BoardProbe = {
  innerWidth: number;
  scrollWidth: number;
  scrollHeight: number;
  /** From `[data-dc-area]`, at most four. */
  areas: { area: string; top: number; height: number }[];
  items: BoardProbeItem[];
  /** More entries than the probe measures. */
  truncated: boolean;
};

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
  return { innerWidth, scrollWidth, scrollHeight, areas, items, truncated: value.truncated === true };
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
 * room); a finding raised only at narrow stays at narrow. Board-level codes (overflow, partial, the
 * render codes) are kept per width. Input order is preserved.
 */
export const dedupeBoardFindings = (findings: readonly CheckFindingData[]): CheckFindingData[] => {
  const best = new Map<string, CheckFindingData>();
  const keyOf = (finding: CheckFindingData): string => `${finding.code}|${finding.detail ?? ''}`;
  for (const finding of findings) {
    if (!ENTRY_CODES.has(finding.code)) continue;
    const known = best.get(keyOf(finding));
    if (known === undefined || widthRank(finding) < widthRank(known)) best.set(keyOf(finding), finding);
  }
  return findings.filter((finding) => !ENTRY_CODES.has(finding.code) || best.get(keyOf(finding)) === finding);
};

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