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

/** Cut each line box to a clipping box, per axis; a line under 1px in either axis paints nothing. */
const clipLines = (lines: ProbeRect[], box: ProbeRect, clipX: boolean, clipY: boolean): ProbeRect[] => {
  if (!clipX && !clipY) return lines;
  const out: ProbeRect[] = [];
  for (const line of lines) {
    const x = clipX ? Math.max(line.x, box.x) : line.x;
    const y = clipY ? Math.max(line.y, box.y) : line.y;
    const right = clipX ? Math.min(line.x + line.w, box.x + box.w) : line.x + line.w;
    const bottom = clipY ? Math.min(line.y + line.h, box.y + box.h) : line.y + line.h;
    const w = right - x;
    const h = bottom - y;
    if (w >= 1 && h >= 1) out.push({ x, y, w, h });
  }
  return out;
};

/** Whether a line reaches more than 1px out of a box on a checked axis (the tolerance `clipsContent` uses). */
const sticksOut = (line: ProbeRect, box: ProbeRect, checkX: boolean, checkY: boolean): boolean =>
  (checkX && (line.x < box.x - 1 || line.x + line.w > box.x + box.w + 1)) || (checkY && (line.y < box.y - 1 || line.y + line.h > box.y + box.h + 1));

/**
 * Where a line can show once its scroll box is scrolled: anywhere along the box on the scrolling
 * axis. A box with no size on that axis shows nothing.
 */
const spreadLines = (lines: ProbeRect[], box: ProbeRect, spreadX: boolean, spreadY: boolean): ProbeRect[] => {
  if (!spreadX && !spreadY) return lines;
  const out: ProbeRect[] = [];
  for (const line of lines) {
    const spread: ProbeRect = { x: spreadX ? box.x : line.x, y: spreadY ? box.y : line.y, w: spreadX ? box.w : line.w, h: spreadY ? box.h : line.h };
    if (spread.w >= 1 && spread.h >= 1) out.push(spread);
  }
  return out;
};

/**
 * Whether an element establishes a containing block for positioned descendants. Verified in
 * Chrome: a non-static position contains `absolute`; transform, the separate translate, rotate
 * and scale properties, perspective, filter, backdrop-filter, a `will-change` naming one of
 * them, and layout/paint `contain` contain both `absolute` and `fixed`. `display: contents`
 * generates no box and contains nothing.
 */
const establishesContainingBlock = (element: Element, position: 'absolute' | 'fixed'): boolean => {
  const style = getComputedStyle(element);
  if (style.display === 'contents') return false;
  if (position === 'absolute' && style.position !== 'static') return true;
  if (style.transform !== 'none' || style.perspective !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none') return true;
  if (style.translate !== 'none' || style.rotate !== 'none' || style.scale !== 'none') return true;
  if (/transform|translate|rotate|scale|perspective|filter/.test(style.willChange)) return true;
  if (/paint|layout|strict|content/.test(style.contain)) return true;
  return false;
};

/** The nearest ancestor that contains a fixed element, or null when the viewport contains it. */
const fixedContainingBlock = (element: Element): Element | null => {
  for (let node: Element | null = element.parentElement; node !== null; node = node.parentElement) {
    if (establishesContainingBlock(node, 'fixed')) return node;
  }
  return null;
};

/**
 * The body's overflow propagates to the viewport when the root is visible in both axes; the body
 * box then has used overflow visible and does not clip (verified in Chrome).
 */
const bodyOverflowPropagates = (node: Element): boolean => {
  if (node !== document.body) return false;
  const root = getComputedStyle(document.documentElement);
  return root.overflowX === 'visible' && root.overflowY === 'visible';
};

/** How one box treats what sticks out of it, per axis. */
type Clipping = {
  /** The padding box overflow clips to (`paddingBoxOf`). */
  box: ProbeRect;
  /** What sticks out never shows: `hidden`/`clip`, or `auto`/`scroll` with nothing to scroll to. */
  cutX: boolean;
  cutY: boolean;
  /** What sticks out shows once the box is scrolled: `auto`/`scroll` with content past its edge. */
  scrollX: boolean;
  scrollY: boolean;
};

/**
 * Boxes overflow does not apply to, verified in Chrome: a non-replaced inline box and a
 * `display: contents` box (no box at all; both have an empty client box, so clipping to it would
 * hide everything inside), and table rows and row groups (they have a client box and still clip
 * nothing).
 */
const OVERFLOW_IGNORED = new Set(['inline', 'contents', 'table-row', 'table-row-group', 'table-header-group', 'table-footer-group']);

/**
 * The padding box overflow clips to, in document space. Client sizes are layout pixels and the
 * rect is what paints, so under a `scale` they are brought to the rect's size (a zoomed card
 * would otherwise cut text that shows, a shrunk mock screen would keep text it cuts).
 */
const paddingBoxOf = (node: Element): ProbeRect => {
  const rect = node.getBoundingClientRect();
  const scaleX = node instanceof HTMLElement && node.offsetWidth > 0 ? rect.width / node.offsetWidth : 1;
  const scaleY = node instanceof HTMLElement && node.offsetHeight > 0 ? rect.height / node.offsetHeight : 1;
  return { x: rect.left + node.clientLeft * scaleX + window.scrollX, y: rect.top + node.clientTop * scaleY + window.scrollY, w: node.clientWidth * scaleX, h: node.clientHeight * scaleY };
};

/**
 * The clipping a box applies, or null when it applies none: overflow visible; the root and a
 * propagating body (their overflow belongs to the viewport, which the check scrolls, and the
 * root's client box is one emulated screen tall); a box overflow does not apply to.
 */
const clippingOf = (node: Element, style: CSSStyleDeclaration): Clipping | null => {
  if (style.overflowX === 'visible' && style.overflowY === 'visible') return null;
  if (node === document.documentElement || bodyOverflowPropagates(node)) return null;
  if (OVERFLOW_IGNORED.has(style.display)) return null;
  const scrollable = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll';
  // The same 1px tolerance as `clipsContent`: a box with nothing to scroll to cuts like `hidden`.
  const scrollX = scrollable(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
  const scrollY = scrollable(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
  return { box: paddingBoxOf(node), cutX: style.overflowX !== 'visible' && !scrollX, cutY: style.overflowY !== 'visible' && !scrollY, scrollX, scrollY };
};

type PaintedText = {
  /** The line boxes that paint now: cut by every clipping box, scroll boxes where they are scrolled to. */
  lines: ProbeRect[];
  /**
   * Whether any of the text can show at all. Scrolling never takes this away: text scrolled out
   * of a box is still seen once the box is scrolled. False is text parked outside a box that
   * never shows what sticks out of it, the screen-reader-only idiom.
   */
  reachable: boolean;
  /** The innermost scroll box that cuts the text now, and the text's lines inside it before that cut. */
  scrolled: { box: Element; lines: ProbeRect[] } | null;
};

/**
 * What a text's clipping boxes leave of its line boxes. Two answers come out of one walk and must
 * stay apart: where the text paints now (for overlap) and whether it can be seen at all (for
 * hidden). The boxes are the text's own box and its containing-block chain: a box does not clip
 * positioned text whose containing block sits outside it (a dropdown or badge escaping a
 * clipped card).
 */
const paintedText = (element: Element, style: CSSStyleDeclaration, lines: ProbeRect[]): PaintedText => {
  const out: PaintedText = { lines, reachable: true, scrolled: null };
  // Where the text can show once every scroll box around it is scrolled.
  let reach = lines;
  const clipBy = (node: Element, clipping: Clipping | null): void => {
    if (clipping === null) return;
    const { box, cutX, cutY, scrollX, scrollY } = clipping;
    const kept = clipLines(out.lines, box, cutX, cutY);
    if (out.scrolled === null && kept.some((line) => sticksOut(line, box, scrollX, scrollY))) out.scrolled = { box: node, lines: kept };
    out.lines = clipLines(kept, box, scrollX, scrollY);
    // Past a scroll box, the boxes further out cut the scroll box, not the text it scrolls.
    reach = spreadLines(clipLines(reach, box, cutX, cutY), box, scrollX, scrollY);
  };
  clipBy(element, clippingOf(element, style));
  if (style.position === 'fixed' && fixedContainingBlock(element) === null) {
    // Fixed text the viewport contains never scrolls into view: only what is on screen paints it.
    // A transformed/filtered ancestor contains it instead, and the walk below clips it there.
    const screen: ProbeRect = { x: window.scrollX, y: window.scrollY, w: innerWidth, h: innerHeight };
    out.lines = clipLines(out.lines, screen, true, true);
    reach = clipLines(reach, screen, true, true);
  } else {
    let node: Element = element;
    let position = style.position;
    while (out.lines.length > 0 || reach.length > 0) {
      let parent: Element | null = node.parentElement;
      if (position === 'absolute' || position === 'fixed') {
        while (parent !== null && !establishesContainingBlock(parent, position)) parent = parent.parentElement;
      }
      if (parent === null) break;
      const parentStyle = getComputedStyle(parent);
      clipBy(parent, clippingOf(parent, parentStyle));
      node = parent;
      position = parentStyle.position;
    }
  }
  out.reachable = reach.length > 0;
  return out;
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
const visuallyHidden = (element: Element, style: CSSStyleDeclaration, reachable: boolean): boolean => {
  if (!reachable) return true; // parked outside a box that never shows it
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
  // Scroll boxes by number: texts cut by the same box are compared inside it.
  const scrollBoxes = new Map<Element, number>();
  const scrollBoxId = (box: Element): number => {
    const known = scrollBoxes.get(box);
    if (known !== undefined) return known;
    scrollBoxes.set(box, scrollBoxes.size);
    return scrollBoxes.size - 1;
  };
  for (const [element, nodes] of byParent) {
    if (!visible(element)) continue;
    const lines = textLines(nodes);
    if (lines.length === 0) continue;
    const rect = unionRect(lines);
    const style = getComputedStyle(element);
    const painted = paintedText(element, style, lines);
    entries.push({
      element,
      text: {
        selector: selectorOf(element),
        text: nodes.map((node) => node.data).join(' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_SHOWN),
        rect,
        lines: painted.lines,
        ...(painted.scrolled === null ? {} : { inScroll: { box: scrollBoxId(painted.scrolled.box), lines: painted.scrolled.lines } }),
        hidden: visuallyHidden(element, style, painted.reachable),
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
