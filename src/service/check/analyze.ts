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
  /** Document-space box of the element's own text. */
  rect: ProbeRect;
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

const parseText = (value: unknown): ProbeText | null => {
  if (!isRec(value)) return null;
  const selector = selectorOf(value.selector);
  const rect = parseRect(value.rect);
  const fontPx = finite(value.fontPx, 0, 1000);
  const weight = finite(value.weight, 0, 1000);
  if (selector === null || rect === null || fontPx === null || weight === null || typeof value.color !== 'string') return null;
  const bgChain = Array.isArray(value.bgChain) && value.bgChain.every((entry) => typeof entry === 'string') ? (value.bgChain.slice(0, 40) as string[]) : null;
  return {
    selector,
    text: typeof value.text === 'string' ? cleanDetail(value.text, TEXT_SHOWN_MAX) : '',
    rect,
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
    for (const entry of value.texts.slice(0, CHECK_TEXT_ELEMENTS_MAX)) {
      const text = parseText(entry);
      if (text !== null) texts.push(text);
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
    if (text.bgChain === null || text.disabled || text.text.trim() === '') continue;
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

const overlapFindings = (probe: ProbeResult, artboard: ArtboardInfo): CheckFindingData[] => {
  const boxes = probe.texts.filter((text) => !text.fixed && text.rect.w > 1 && text.rect.h > 1 && text.text.trim() !== '');
  const out: CheckFindingData[] = [];
  for (let i = 0; i < boxes.length && out.length < CHECK_FINDINGS_PER_CODE; i += 1) {
    const a = boxes[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j];
      if (b === undefined || overlapShare(a.rect, b.rect) < OVERLAP_MIN_SHARE) continue;
      out.push({ ...base('text-overlap', artboard), detail: cleanDetail(`${a.text} / ${b.text}`, 160), selector: a.selector });
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
    if (text.clipped && !text.ellipsis && text.text.trim() !== '') {
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
