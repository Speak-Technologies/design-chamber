// The design-check probe (documentation/specs/agent-render-and-check.md §4.4). Built as an IIFE
// (`__dcProbe`, scripts/build.mjs) and evaluated by the check engine in an ISOLATED WORLD of the
// rendered design: its own JavaScript globals, the page's DOM. It only measures. It returns plain
// data and makes no verdict; every verdict is a pure function in src/service/check/analyze.ts,
// which also re-validates what comes back (the design's own script ran in the same document).
// It reads the DOM and never writes, except that the engine scrolls between screenshots.

import { CHECK_TEXT_ELEMENTS_MAX } from '../../shared/limits.ts';
import type { ProbeRect, ProbeResult, ProbeText } from '../../service/check/analyze.ts';
import { buildSelector } from '../bridge/selector.ts';

export type CollectOptions = { maxTexts?: number };

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'OPTION', 'TEXTAREA']);
const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED']);
const UNLABELED_SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const LIST_MAX = 20;
const WIDE_SCAN_MAX = 5000;
const TEXT_SHOWN = 80;
// Same caps sanitizeProbe enforces on the answer (src/service/check/analyze.ts); they bound the
// payload a design with very long text could inflate.
const TEXT_LINES_MAX = 100;
const TEXT_ANCESTORS_MAX = 64;

const selectorOf = (element: Element): string => buildSelector(element, document);

const isOpaque = (color: string): boolean => {
  const match = /^rgba?\(([^)]*)\)$/.exec(color.trim());
  if (!match) return false;
  const body = match[1] ?? '';
  if (body.includes('/')) return /\/\s*1(\.0*)?\s*$|\/\s*100%/.test(body);
  const parts = body.split(',').map((part) => part.trim());
  return parts.length === 3 || (parts.length === 4 && Number.parseFloat(parts[3] ?? '1') >= 1);
};

const visible = (element: Element): boolean => {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
};

/** The boxes the text actually paints: one per line fragment, document space, under 1px ignored. */
const textLines = (nodes: Text[]): ProbeRect[] => {
  const lines: ProbeRect[] = [];
  const range = document.createRange();
  for (const node of nodes) {
    if (lines.length >= TEXT_LINES_MAX) break;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 1 || rect.height < 1) continue;
      lines.push({ x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height });
      if (lines.length >= TEXT_LINES_MAX) break;
    }
  }
  return lines;
};

/** The box around all the line fragments; the caller checks the lines are not empty. */
const unionRect = (lines: ProbeRect[]): ProbeRect => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const line of lines) {
    left = Math.min(left, line.x);
    top = Math.min(top, line.y);
    right = Math.max(right, line.x + line.w);
    bottom = Math.max(bottom, line.y + line.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
};

const intersectRect = (a: ProbeRect, b: ProbeRect): ProbeRect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w >= 1 && h >= 1 ? { x, y, w, h } : null;
};

/** The line boxes left after clipping ancestors cut them; empty means nothing paints. */
const paintedLines = (element: Element, lines: ProbeRect[]): ProbeRect[] => {
  // Fixed text escapes its ancestors' overflow clipping.
  if (getComputedStyle(element).position === 'fixed') return lines;
  let painted = lines;
  for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = node.getBoundingClientRect();
    const clip: ProbeRect = { x: box.left + node.clientLeft + window.scrollX, y: box.top + node.clientTop + window.scrollY, w: node.clientWidth, h: node.clientHeight };
    painted = painted.map((line) => intersectRect(line, clip)).filter((line): line is ProbeRect => line !== null);
    if (painted.length === 0) break;
  }
  return painted;
};

/** A `clip: rect(...)` with no area (rect(0 0 0 0), rect(1px, 1px, 1px, 1px)): nothing paints. */
const zeroAreaClip = (clip: string): boolean => {
  const match = /^rect\(([^)]*)\)$/.exec(clip.trim());
  if (!match) return false;
  const sides = (match[1] ?? '').split(/[\s,]+/).filter((part) => part !== '').map((part) => Number.parseFloat(part));
  if (sides.length !== 4 || sides.some((side) => !Number.isFinite(side))) return false;
  const top = sides[0] ?? 0;
  const right = sides[1] ?? 0;
  const bottom = sides[2] ?? 0;
  const left = sides[3] ?? 0;
  return bottom <= top || right <= left;
};

/** A `clip-path: inset(...)` that collapses the box to nothing, like inset(50%). */
const insetClipsAll = (clipPath: string, box: DOMRect): boolean => {
  const match = /^inset\(([^)]*)\)$/.exec(clipPath.trim());
  if (!match) return false;
  const parts = (match[1] ?? '').trim().split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0 || parts.length > 4) return false;
  const px = (part: string | undefined, extent: number): number | null => {
    if (part === undefined) return null;
    const size = /^(-?[\d.]+)(px|%)$/.exec(part);
    if (!size) return null;
    const value = Number.parseFloat(size[1] ?? '');
    return size[2] === '%' ? (value / 100) * extent : value;
  };
  const top = px(parts[0], box.height);
  const right = px(parts[1] ?? parts[0], box.width);
  const bottom = px(parts[2] ?? parts[0], box.height);
  const left = px(parts[3] ?? parts[1] ?? parts[0], box.width);
  if (top === null || right === null || bottom === null || left === null) return false;
  return top + bottom >= box.height || left + right >= box.width;
};

/** Visually hidden text (screen-reader-only patterns): no visual verdict applies to it. */
const visuallyHidden = (element: Element, style: CSSStyleDeclaration, painted: ProbeRect[]): boolean => {
  if (painted.length === 0) return true; // clipped away entirely by an ancestor
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (Number.parseFloat(getComputedStyle(node).opacity) === 0) return true;
  }
  // `clip` only applies to positioned elements; on a static one it paints nothing away.
  if ((style.position === 'absolute' || style.position === 'fixed') && zeroAreaClip(style.clip)) return true;
  const box = element.getBoundingClientRect();
  if (insetClipsAll(style.clipPath, box)) return true;
  // The sr-only idiom: a 1×1 box whose own overflow hides everything in it.
  const clips = style.overflowX === 'hidden' || style.overflowX === 'clip' || style.overflowY === 'hidden' || style.overflowY === 'clip';
  return box.width <= 1 && box.height <= 1 && clips;
};

/** Background colours from the element up to the first opaque one; null when the real backdrop cannot be known. */
const backgroundChain = (element: Element, rect: ProbeRect): string[] | null => {
  const chain: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.backgroundImage !== 'none' || style.filter !== 'none' || style.mixBlendMode !== 'normal' || Number.parseFloat(style.opacity) < 1) return null;
    chain.push(style.backgroundColor);
    if (isOpaque(style.backgroundColor)) break;
  }
  // Something painted behind the text that is not an ancestor (a hero image in its own layer) decides the real backdrop.
  const x = rect.x - window.scrollX + rect.w / 2;
  const y = rect.y - window.scrollY + rect.h / 2;
  if (x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight) {
    const stack = document.elementsFromPoint(x, y);
    const own = stack.findIndex((candidate) => candidate === element || element.contains(candidate));
    for (const below of own < 0 ? [] : stack.slice(own + 1)) {
      if (below.contains(element)) continue;
      if (MEDIA_TAGS.has(below.tagName.toUpperCase()) || getComputedStyle(below).backgroundImage !== 'none') return null;
    }
  }
  return chain;
};

const isFixedOrSticky = (element: Element): boolean => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
};

const clipsContent = (element: Element, style: CSSStyleDeclaration): boolean => {
  const hidden = (value: string): boolean => value === 'hidden' || value === 'clip';
  if (!hidden(style.overflowX) && !hidden(style.overflowY)) return false;
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
};

const textsOf = (max: number): ProbeText[] => {
  const byParent = new Map<Element, Text[]>();
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && byParent.size < max; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || SKIPPED_TAGS.has(parent.tagName.toUpperCase()) || text.data.trim() === '') continue;
    const list = byParent.get(parent);
    if (list) list.push(text);
    else byParent.set(parent, [text]);
  }
  const entries: { element: Element; text: ProbeText }[] = [];
  for (const [element, nodes] of byParent) {
    if (!visible(element)) continue;
    const lines = textLines(nodes);
    if (lines.length === 0) continue;
    const rect = unionRect(lines);
    const style = getComputedStyle(element);
    const painted = paintedLines(element, lines);
    entries.push({
      element,
      text: {
        selector: selectorOf(element),
        text: nodes.map((node) => node.data).join(' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_SHOWN),
        rect,
        lines: painted,
        hidden: visuallyHidden(element, style, painted),
        color: style.color,
        bgChain: backgroundChain(element, rect),
        fontPx: Number.parseFloat(style.fontSize) || 0,
        weight: Number.parseInt(style.fontWeight, 10) || 400,
        fixed: isFixedOrSticky(element),
        disabled: element.closest(':disabled, [aria-disabled="true"]') !== null,
        clipped: clipsContent(element, style),
        ellipsis: style.textOverflow.includes('ellipsis') || (style.getPropertyValue('-webkit-line-clamp') !== '' && style.getPropertyValue('-webkit-line-clamp') !== 'none'),
        ancestors: [],
      },
    });
  }
  // Which other measured texts are this one's ancestors: they share its flow, never an overlap.
  const indexOf = new Map(entries.map((entry, index): [Element, number] => [entry.element, index]));
  return entries.map(({ element, text }) => {
    const ancestors: number[] = [];
    for (let node: Element | null = element.parentElement; node && ancestors.length < TEXT_ANCESTORS_MAX; node = node.parentElement) {
      const index = indexOf.get(node);
      if (index !== undefined) ancestors.push(index);
    }
    return { ...text, ancestors };
  });
};

/** Elements sticking out past the right edge that no scrolling box contains, deepest first. */
const wideElements = (): { selector: string; right: number }[] => {
  const found: { element: Element; depth: number; right: number }[] = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (let index = 0; index < all.length && index < WIDE_SCAN_MAX; index += 1) {
    const element = all[index];
    if (!element) continue;
    const right = element.getBoundingClientRect().right + window.scrollX;
    if (right <= innerWidth + 1 || !visible(element)) continue;
    let contained = false;
    let depth = 0;
    for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      depth += 1;
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.position === 'fixed') contained = true;
    }
    if (!contained) found.push({ element, depth, right });
  }
  return found
    .sort((a, b) => b.depth - a.depth || b.right - a.right)
    .slice(0, LIST_MAX)
    .map((entry) => ({ selector: selectorOf(entry.element), right: Math.round(entry.right) }));
};

const textOfIds = (ids: string | null): string =>
  (ids ?? '')
    .split(/\s+/)
    .map((id) => (id === '' ? '' : (document.getElementById(id)?.textContent ?? '')))
    .join(' ')
    .trim();

const hasAccessibleName = (element: Element): boolean => {
  if ((element.getAttribute('aria-label') ?? '').trim() !== '') return true;
  if (textOfIds(element.getAttribute('aria-labelledby')) !== '') return true;
  if ((element.getAttribute('title') ?? '').trim() !== '') return true;
  if ((element.textContent ?? '').trim() !== '') return true;
  if (element.querySelector('img[alt]:not([alt=""]), svg title, [aria-label]') !== null) return true;
  return false;
};

const hasControlLabel = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean => {
  if ((element.getAttribute('aria-label') ?? '').trim() !== '') return true;
  if (textOfIds(element.getAttribute('aria-labelledby')) !== '') return true;
  if ((element.getAttribute('title') ?? '').trim() !== '') return true;
  return Array.from(element.labels ?? []).some((label) => (label.textContent ?? '').trim() !== '');
};

const listOf = (selector: string, keep: (element: Element) => boolean): string[] => {
  const out: string[] = [];
  for (const element of Array.from(document.querySelectorAll(selector))) {
    if (out.length >= LIST_MAX) break;
    if (visible(element) && keep(element)) out.push(selectorOf(element));
  }
  return out;
};

export const collect = (options: CollectOptions = {}): ProbeResult => {
  const scroller = document.scrollingElement ?? document.documentElement;
  return {
    scrollWidth: scroller.scrollWidth,
    scrollHeight: scroller.scrollHeight,
    innerWidth,
    innerHeight,
    wide: wideElements(),
    texts: textsOf(options.maxTexts ?? CHECK_TEXT_ELEMENTS_MAX),
    imgsNoAlt: listOf('img', (img) => !img.hasAttribute('alt') && !['presentation', 'none'].includes(img.getAttribute('role') ?? '') && img.getAttribute('aria-hidden') !== 'true'),
    unlabeled: listOf('input, select, textarea', (field) => {
      const type = (field.getAttribute('type') ?? '').toLowerCase();
      return !UNLABELED_SKIP_TYPES.has(type) && !hasControlLabel(field as HTMLInputElement);
    }),
    nameless: listOf('button, a[href], [role="button"]', (control) => !hasAccessibleName(control)),
  };
};
