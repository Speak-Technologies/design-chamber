// Probe measurements → findings (documentation/specs/agent-render-and-check.md §4.4). The probe
// (src/guest/probe/probe.ts) only measures; every verdict is made here, in plain functions the
// tests drive with synthetic results. `sanitizeProbe` is the boundary: the probe ran next to
// untrusted design script, so its answer is checked for shape and size before any use.

import {
  CHECK_FINDINGS_PER_CODE,
  CHECK_SELECTOR_MAX,
  CHECK_TALL_RATIO,
  CHECK_TEXT_ELEMENTS_MAX,
} from '../../shared/limits.ts';
import { cleanDetail } from '../../shared/checks.ts';
import type { CheckCode, CheckFindingData, DesignKind } from '../../shared/types.ts';
import { contrastRatio, minContrastFor, parseCssColor, type Rgba } from './color.ts';

export type ProbeRect = { x: number; y: number; w: number; h: number };

export type ProbeText = {
  selector: string;
  /** First 80 characters of the element's own text. */
  text: string;
  /** Document-space box around all of the element's own text (the union of `lines`). */
  rect: ProbeRect;
  /** The boxes the text paints now, one per line fragment, trimmed to what its clipping boxes let through (scroll boxes where they are scrolled to). Empty or absent without `inScroll`: fall back to `rect` (older shapes). */
  lines?: ProbeRect[];
  /** Set when a scroll box cuts the text now: the innermost such box (a number shared by every text it cuts) and the text's line boxes inside it before that cut. Two texts in the same box are compared on these, so an overlap the user scrolls to is still found; `lines` may then be empty (scrolled out of view). */
  inScroll?: { box: number; lines: ProbeRect[] };
  /** Visually hidden (screen-reader-only patterns): sits out every visual verdict, not the accessibility lists. Never set by scrolling: text scrolled out of a box is seen once the box is scrolled. */
  hidden?: boolean;
  /** Positions in `texts` of this element's ancestors that have their own text entry: one flow, never an overlap. */
  ancestors?: number[];
  /** Computed `color`. */
  color: string;
  /** Computed `background-color` of the element and its ancestors up to the first opaque one; `null` when it cannot be known (image, filter, blend, opacity < 1). */
  bgChain: string[] | null;
  fontPx: number;
  weight: number;
  /** The element or an ancestor is `position: fixed` or `sticky`. */
  fixed: boolean;
  /** A disabled control (WCAG exempts it). */
  disabled: boolean;
  /** The text is cut off by `overflow` on its box. */
  clipped: boolean;
  /** `text-overflow: ellipsis` or a line clamp: cutting is the intent. */
  ellipsis: boolean;
};

export type ProbeResult = {
  scrollWidth: number;
  scrollHeight: number;
  innerWidth: number;
  innerHeight: number;
  /** Elements sticking out past the right edge, deepest first. */
  wide: { selector: string; right: number }[];
  texts: ProbeText[];
  imgsNoAlt: string[];
  unlabeled: string[];
  nameless: string[];
};

const WIDE_MAX = 20;
const SELECTORS_MAX = 50;
const TEXT_SHOWN_MAX = 80;
/** Line boxes kept per text; the probe caps its answer at the same number (src/guest/probe/probe.ts). */
const TEXT_LINES_MAX = 100;
/** Ancestor links kept per text; deeper chains lose the exemption, never gain a wrong one. */
const TEXT_ANCESTORS_MAX = 64;

const isRec = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, min = -1e7, max = 1e7): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null);

const selectorOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? cleanDetail(value, CHECK_SELECTOR_MAX) : null);

const selectorList = (value: unknown): string[] =>
  Array.isArray(value) ? value.slice(0, SELECTORS_MAX).map(selectorOf).filter((selector): selector is string => selector !== null) : [];

const parseRect = (value: unknown): ProbeRect | null => {
  if (!isRec(value)) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  const w = finite(value.w, 0);
  const h = finite(value.h, 0);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
};

const parseLines = (value: unknown): ProbeRect[] => {
  const lines: ProbeRect[] = [];
  if (!Array.isArray(value)) return lines;
  for (const entry of value.slice(0, TEXT_LINES_MAX)) {
    const line = parseRect(entry);
    if (line !== null) lines.push(line);
  }
  return lines;
};

/** A scroll box is named by a whole number below the text cap (at most one box per measured text). */
const parseInScroll = (value: unknown): ProbeText['inScroll'] => {
  if (!isRec(value)) return undefined;
  const box = value.box;
  if (typeof box !== 'number' || !Number.isInteger(box) || box < 0 || box >= CHECK_TEXT_ELEMENTS_MAX) return undefined;
  return { box, lines: parseLines(value.lines) };
};

const parseText = (value: unknown): ProbeText | null => {
  if (!isRec(value)) return null;
  const selector = selectorOf(value.selector);
  const rect = parseRect(value.rect);
  const fontPx = finite(value.fontPx, 0, 1000);
  const weight = finite(value.weight, 0, 1000);
  if (selector === null || rect === null || fontPx === null || weight === null || typeof value.color !== 'string') return null;
  const bgChain = Array.isArray(value.bgChain) && value.bgChain.every((entry) => typeof entry === 'string') ? (value.bgChain.slice(0, 40) as string[]) : null;
  const inScroll = parseInScroll(value.inScroll);
  const ancestors: number[] = [];
  if (Array.isArray(value.ancestors)) {
    for (const entry of value.ancestors.slice(0, TEXT_ANCESTORS_MAX)) {
      if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < CHECK_TEXT_ELEMENTS_MAX) ancestors.push(entry);
    }
  }
  return {
    selector,
    text: typeof value.text === 'string' ? cleanDetail(value.text, TEXT_SHOWN_MAX) : '',
    rect,
    lines: parseLines(value.lines),
    ...(inScroll === undefined ? {} : { inScroll }),
    hidden: value.hidden === true,
    ancestors,
    color: value.color.slice(0, 120),
    bgChain: bgChain === null ? null : bgChain.map((entry) => entry.slice(0, 120)),
    fontPx,
    weight,
    fixed: value.fixed === true,
    disabled: value.disabled === true,
    clipped: value.clipped === true,
    ellipsis: value.ellipsis === true,
  };
};

/** The probe's answer as trusted data, or `null` when it is not the shape the probe returns. */
export const sanitizeProbe = (value: unknown): ProbeResult | null => {
  if (!isRec(value)) return null;
  const scrollWidth = finite(value.scrollWidth, 0);
  const scrollHeight = finite(value.scrollHeight, 0);
  const innerWidth = finite(value.innerWidth, 0);
  const innerHeight = finite(value.innerHeight, 0);
  if (scrollWidth === null || scrollHeight === null || innerWidth === null || innerHeight === null) return null;
  const wide: ProbeResult['wide'] = [];
  if (Array.isArray(value.wide)) {
    for (const entry of value.wide.slice(0, WIDE_MAX)) {
      if (!isRec(entry)) continue;
      const selector = selectorOf(entry.selector);
      const right = finite(entry.right);
      if (selector !== null && right !== null) wide.push({ selector, right });
    }
  }
  const texts: ProbeText[] = [];
  if (Array.isArray(value.texts)) {
    // Ancestor links are positions in the answer as the probe sent it. Entries that fail
    // validation are dropped, so the links are remapped to the positions that survived.
    const parsed: { raw: number; text: ProbeText }[] = [];
    for (const [raw, entry] of value.texts.slice(0, CHECK_TEXT_ELEMENTS_MAX).entries()) {
      const text = parseText(entry);
      if (text !== null) parsed.push({ raw, text });
    }
    const position = new Map(parsed.map((entry, index) => [entry.raw, index]));
    for (const [index, { text }] of parsed.entries()) {
      const ancestors = [...new Set((text.ancestors ?? []).map((raw) => position.get(raw)).filter((link): link is number => link !== undefined && link !== index))];
      texts.push({ ...text, ancestors });
    }
  }
  return {
    scrollWidth,
    scrollHeight,
    innerWidth,
    innerHeight,
    wide,
    texts,
    imgsNoAlt: selectorList(value.imgsNoAlt),
    unlabeled: selectorList(value.unlabeled),
    nameless: selectorList(value.nameless),
  };
};

// ---- verdicts ----

export type ArtboardInfo = {
  /** Design-relative file that was rendered. */
  file: string;
  /** Screen id on a canvas; `null` on a page. */
  screen: string | null;
  viewport: string;
  /** The viewport's declared size. */
  width: number;
  height: number;
  kind: DesignKind;
};

const base = (code: CheckCode, artboard: ArtboardInfo): CheckFindingData => ({ code, file: artboard.file, screen: artboard.screen, viewport: artboard.viewport });

const area = (rect: ProbeRect): number => rect.w * rect.h;

const intersectionArea = (a: ProbeRect, b: ProbeRect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const contains = (outer: ProbeRect, inner: ProbeRect): boolean =>
  outer.x - 1 <= inner.x && outer.y - 1 <= inner.y && outer.x + outer.w + 1 >= inner.x + inner.w && outer.y + outer.h + 1 >= inner.y + inner.h;

/** Share of the smaller box two text boxes overlap by, when neither holds the other. */
export const overlapShare = (a: ProbeRect, b: ProbeRect): number => {
  const smaller = Math.min(area(a), area(b));
  if (smaller <= 0 || contains(a, b) || contains(b, a)) return 0;
  return intersectionArea(a, b) / smaller;
};

export const OVERLAP_MIN_SHARE = 0.3;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Contrast findings: one per distinct (text colour, background) pair, errors by code. */
const contrastFindings = (probe: ProbeResult, artboard: ArtboardInfo): CheckFindingData[] => {
  const seen = new Set<string>();
  const out: CheckFindingData[] = [];
  for (const text of probe.texts) {
    if (text.hidden || text.bgChain === null || text.disabled || text.text.trim() === '') continue;
    const fg = parseCssColor(text.color);
    if (fg === null || fg.a <= 0) continue;
    const chain: Rgba[] = [];
    let known = true;
    for (const entry of text.bgChain) {
      const layer = parseCssColor(entry);
      if (layer === null) {
        known = false;
        break;
      }
      chain.push(layer);
    }
    if (!known) continue;
    const pair = `${text.color}|${text.bgChain.join('>')}`;
    if (seen.has(pair)) continue;
    const ratio = contrastRatio(fg, chain);
    const min = minContrastFor(text.fontPx, text.weight);
    if (ratio >= min) continue;
    seen.add(pair);
    // Rounded down, so a 4.46 never prints as "4.5:1, below 4.5:1".
    out.push({ ...base('contrast', artboard), params: { ratio: Math.floor(ratio * 10) / 10, min }, detail: cleanDetail(text.text, 120), selector: text.selector });
  }
  return out;
};

/**
 * The boxes a text paints now. With no line boxes, a text its scroll box cuts is scrolled out of
 * view and paints nothing; without a scroll box it is an older shape, judged on its merged box.
 */
const paintedBoxesOf = (text: ProbeText): ProbeRect[] => {
  if (text.lines !== undefined && text.lines.length > 0) return text.lines;
  return text.inScroll === undefined ? [text.rect] : [];
};

/**
 * The boxes two texts are compared on. Texts cut by the same scroll box: their boxes inside it
 * (what scrolling it shows). Any other pair: what paints now, so text scrolled out of a box never
 * overlaps text outside the box.
 */
const comparedBoxes = (a: ProbeText, b: ProbeText): [ProbeRect[], ProbeRect[]] =>
  a.inScroll !== undefined && b.inScroll !== undefined && a.inScroll.box === b.inScroll.box ? [a.inScroll.lines, b.inScroll.lines] : [paintedBoxesOf(a), paintedBoxesOf(b)];

/** Two texts overlap when any pair of their compared line boxes does, by the share rule. */
const linesOverlap = (a: ProbeText, b: ProbeText): boolean => {
  const [linesA, linesB] = comparedBoxes(a, b);
  for (const lineA of linesA) {
    for (const lineB of linesB) {
      if (overlapShare(lineA, lineB) >= OVERLAP_MIN_SHARE) return true;
    }
  }
  return false;
};

/**
 * Cheap necessary condition for any line pair to overlap: a text's `rect` encloses every line box
 * it has, painted or inside its scroll box (the union of its lines before clipping), so disjoint
 * rects can hold no overlapping pair. Skipping those pairs first keeps the verdict off the
 * texts² × lines² path on long documents of wrapping text.
 */
const rectsIntersect = (a: ProbeRect, b: ProbeRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const overlapFindings = (probe: ProbeResult, artboard: ArtboardInfo): CheckFindingData[] => {
  // Indices stay the positions in probe.texts: ancestor links name those, not this filtered list.
  const boxes = probe.texts
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => !text.hidden && !text.fixed && text.rect.w > 1 && text.rect.h > 1 && text.text.trim() !== '');
  const out: CheckFindingData[] = [];
  for (let i = 0; i < boxes.length && out.length < CHECK_FINDINGS_PER_CODE; i += 1) {
    const a = boxes[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j];
      if (b === undefined || !rectsIntersect(a.text.rect, b.text.rect) || !linesOverlap(a.text, b.text)) continue;
      // A text and text in its own ancestor or descendant are one flow, whatever the geometry.
      if ((a.text.ancestors ?? []).includes(b.index) || (b.text.ancestors ?? []).includes(a.index)) continue;
      out.push({ ...base('text-overlap', artboard), detail: cleanDetail(`${a.text.text} / ${b.text.text}`, 160), selector: a.text.selector });
      break;
    }
  }
  return out;
};

/** Cap per code (`CHECK_FINDINGS_PER_CODE`), keeping order. */
export const capPerCode = (findings: readonly CheckFindingData[]): CheckFindingData[] => {
  const counts = new Map<string, number>();
  const out: CheckFindingData[] = [];
  for (const finding of findings) {
    const key = `${finding.code}|${finding.file ?? ''}|${finding.viewport ?? ''}`;
    const n = counts.get(key) ?? 0;
    if (n >= CHECK_FINDINGS_PER_CODE) continue;
    counts.set(key, n + 1);
    out.push(finding);
  }
  return out;
};

/** Every verdict for one artboard, from the probe's measurements. */
export const analyzeProbe = (probe: ProbeResult, artboard: ArtboardInfo): CheckFindingData[] => {
  const findings: CheckFindingData[] = [];

  if (probe.scrollWidth > artboard.width + 1) {
    const widest = probe.wide.reduce<ProbeResult['wide'][number] | null>((best, entry) => (best === null || entry.right > best.right ? entry : best), null);
    findings.push({ ...base('overflow-x', artboard), params: { px: Math.round(probe.scrollWidth), width: artboard.width }, ...(widest ? { selector: widest.selector } : {}) });
  }

  for (const text of probe.texts) {
    if (!text.hidden && text.clipped && !text.ellipsis && text.text.trim() !== '') {
      findings.push({ ...base('text-clipped', artboard), detail: cleanDetail(text.text, 120), selector: text.selector });
    }
  }
  findings.push(...overlapFindings(probe, artboard));
  findings.push(...contrastFindings(probe, artboard));
  for (const selector of probe.imgsNoAlt) findings.push({ ...base('img-alt', artboard), selector });
  for (const selector of probe.unlabeled) findings.push({ ...base('control-label', artboard), selector });
  for (const selector of probe.nameless) findings.push({ ...base('button-name', artboard), selector });

  const ratio = artboard.height > 0 ? probe.scrollHeight / artboard.height : 0;
  if (artboard.kind === 'canvas' && ratio >= CHECK_TALL_RATIO) {
    findings.push({ ...base('screen-tall', artboard), params: { ratio: round1(ratio), px: Math.round(probe.scrollHeight) } });
  }
  findings.push({ ...base('page-height', artboard), params: { px: Math.round(probe.scrollHeight), ratio: round1(ratio) } });

  return capPerCode(findings);
};
