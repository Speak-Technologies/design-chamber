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

/** The element's own text as a document-space box, or null when it paints nothing visible. */
const textRect = (nodes: Text[]): ProbeRect | null => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const range = document.createRange();
  for (const node of nodes) {
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return { x: left + window.scrollX, y: top + window.scrollY, w: right - left, h: bottom - top };
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
  const out: ProbeText[] = [];
  for (const [element, nodes] of byParent) {
    if (!visible(element)) continue;
    const rect = textRect(nodes);
    if (rect === null) continue;
    const style = getComputedStyle(element);
    out.push({
      selector: selectorOf(element),
      text: nodes.map((node) => node.data).join(' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_SHOWN),
      rect,
      color: style.color,
      bgChain: backgroundChain(element, rect),
      fontPx: Number.parseFloat(style.fontSize) || 0,
      weight: Number.parseInt(style.fontWeight, 10) || 400,
      fixed: isFixedOrSticky(element),
      disabled: element.closest(':disabled, [aria-disabled="true"]') !== null,
      clipped: clipsContent(element, style),
      ellipsis: style.textOverflow.includes('ellipsis') || (style.getPropertyValue('-webkit-line-clamp') !== '' && style.getPropertyValue('-webkit-line-clamp') !== 'none'),
    });
  }
  return out;
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
