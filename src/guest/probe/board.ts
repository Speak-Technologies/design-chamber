// The system-board probe (documentation/specs/system-board-layout-and-visual-check.md §B.4). Built
// into the same `__dcProbe` IIFE as the design probe (re-exported from probe.ts) and evaluated in the
// `dc-probe` isolated world of the rendered board. It only measures: geometry of the areas, the
// entries and their example previews, and the entry's own text. It returns plain data and makes no
// verdict; `sanitizeBoardProbe` and `analyzeBoard` (src/service/check/board-analyze.ts) re-check every
// number and decide. It reads the DOM and never writes; the engine scrolls between tiles.

import { BOARD_ENTRY_MAX, SYSTEM_BOARD_ITEMS_MEASURED_MAX, SYSTEM_BOARD_PREVIEW_ELEMENTS_MAX, SYSTEM_BOARD_TEXT_NODES_PER_ITEM, SYSTEM_PAIRS_MAX } from '../../shared/limits.ts';
import type { BoardMotionProbe, BoardProbe, BoardProbeItem, BoardProbePair, BoardProbePreview, BoardStateProbe } from '../../service/check/board-analyze.ts';
import type { ForcedState } from '../../service/check/render.ts';
import { visuallyHidden } from './probe.ts';

const AREAS_MAX = 4;
/** Pair cells read per pass: a light and a dark ground for each pair (`BOARD_PAIR_CELLS_MAX`). */
const PAIR_CELLS_MAX = SYSTEM_PAIRS_MAX * 2;
const PREVIEWS_MAX = 2;
/** Words measured one by one in a text node whose whole-node rects reach outside; past it the whole-node figure stands. */
const WORDS_MEASURED_MAX = 400;

type EntryBox = { x: number; y: number; w: number; h: number };

/** How far any rect reaches past the entry's box on any side (document coordinates; rects under 1px skipped). */
const rectsOut = (rects: DOMRectList, box: EntryBox): number => {
  let out = 0;
  for (const line of Array.from(rects)) {
    if (line.width < 1 || line.height < 1) continue;
    out = Math.max(
      out,
      line.right + window.scrollX - (box.x + box.w),
      box.x - (line.left + window.scrollX),
      line.bottom + window.scrollY - (box.y + box.h),
      box.y - (line.top + window.scrollY),
    );
  }
  return out;
};

/** The same measure over each run of non-space characters, so a hanging space at a wrap does not count. */
const wordsOut = (range: Range, node: Text, box: EntryBox, whole: number): number => {
  const pattern = /\S+/g;
  let out = 0;
  let words = 0;
  for (let match = pattern.exec(node.data); match !== null; match = pattern.exec(node.data)) {
    words += 1;
    if (words > WORDS_MEASURED_MAX) return whole;
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].length);
    out = Math.max(out, rectsOut(range.getClientRects(), box));
  }
  return out;
};

/**
 * The colour pair cells (system-builder-depth §4.5): each `[data-dc-pair]` sample's computed text and
 * background colours and its ground's, as sRGB bytes. A computed colour can be in any space (oklch,
 * color-mix); a detached 1×1 canvas, never attached to the document, paints it and reads the bytes
 * back, so Node judges what the board paints. Nothing in the page is written.
 */
const collectPairs = (): BoardProbePair[] => {
  const cells = document.querySelectorAll('[data-dc-pair]');
  if (cells.length === 0) return [];
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return [];
  const bytesOf = (colour: string): number[] => {
    context.clearRect(0, 0, 1, 1);
    // A colour the canvas can't parse keeps the last fill: start from transparent so it reads as nothing.
    context.fillStyle = 'rgba(0, 0, 0, 0)';
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  };
  const out: BoardProbePair[] = [];
  for (let index = 0; index < cells.length && out.length < PAIR_CELLS_MAX; index += 1) {
    const cell = cells[index];
    if (!cell) continue;
    const style = getComputedStyle(cell);
    const ground = cell.closest('.dc-ground');
    out.push({
      key: (cell.getAttribute('data-dc-pair') ?? '').slice(0, 16),
      fg: bytesOf(style.color),
      bg: bytesOf(style.backgroundColor),
      ground: bytesOf(ground === null ? 'rgb(255, 255, 255)' : getComputedStyle(ground).backgroundColor),
    });
  }
  return out;
};

/** The labels the state check forces, as `data-dc-state` writes them (any case). */
const FORCEABLE: readonly ForcedState[] = ['hover', 'focus', 'focus-visible', 'active'];
/** Labels for an instance at rest: a forced state is tried on it first, so a static `is-hover` copy doesn't hide a real `:hover`. */
const REST_LABELS = ['rest', 'default', 'normal', 'idle', 'enabled'];

/**
 * The labelled interactive states in component examples (system-builder-depth T16): for each instance
 * labelled `data-dc-state` hover, focus, focus-visible or active, the element to force it on (its rest
 * twin with the same variant and size when the example has one, else the instance itself) as a host
 * index and an element index in that host's shadow root, with its box. Only each component's first
 * (light ground) host; at most `max`, then `truncated`. Reads only; Node forces the states over CDP.
 */
export const collectStates = (max: number): BoardStateProbe => {
  const states: BoardStateProbe['states'] = [];
  let truncated = false;
  const hosts = document.querySelectorAll('[data-dc-example-host]');
  const seen = new Set<string>();
  for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
    const host = hosts[hostIndex];
    const root = host?.shadowRoot;
    if (!host || !root || host.closest('.dc-dark') !== null) continue;
    const entry = (host.closest('[data-dc-entry]')?.getAttribute('data-dc-entry') ?? '').slice(0, BOARD_ENTRY_MAX);
    if (!entry.startsWith('component:') || seen.has(entry)) continue;
    seen.add(entry);
    const all = root.querySelectorAll('*');
    const labelled: { index: number; state: string; variant: string; size: string }[] = [];
    for (let index = 0; index < all.length && index < SYSTEM_BOARD_PREVIEW_ELEMENTS_MAX; index += 1) {
      const one = all[index];
      const state = one?.getAttribute('data-dc-state');
      if (!one || state === null || state === undefined) continue;
      labelled.push({ index, state: state.trim().toLowerCase().slice(0, 40), variant: (one.getAttribute('data-dc-variant') ?? '').trim().toLowerCase(), size: (one.getAttribute('data-dc-size') ?? '').trim().toLowerCase() });
    }
    const targets = new Set<string>();
    for (const instance of labelled) {
      const state = FORCEABLE.find((candidate) => candidate === instance.state);
      if (state === undefined) continue;
      const twin = labelled.find((other) => REST_LABELS.includes(other.state) && other.variant === instance.variant && other.size === instance.size);
      const index = twin?.index ?? instance.index;
      // Two instances that land on one element in one state are one picture.
      if (targets.has(`${index}|${state}`)) continue;
      targets.add(`${index}|${state}`);
      if (states.length >= max) {
        truncated = true;
        continue;
      }
      const rect = (all[index] ?? host).getBoundingClientRect();
      states.push({ entry, state, host: hostIndex, element: index, twin: twin !== undefined, variant: instance.variant.slice(0, 40), box: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height } });
    }
  }
  return { states, truncated };
};

/**
 * The motion to picture (system-builder-depth T17): in each example's first (light ground) host, the
 * elements labelled `data-dc-motion` (triggered by their `data-dc-state` when it is one the check forces,
 * else hover), then the Motion section's demo chips (`.dc-motion-demo`, played by hover, boxed with their
 * token's row so its name shows). Examples come
 * first, so the chips take what is left of `max`; only entries of `kinds` are read (`token` for the
 * chips), so another area can't fill it. Each with its entry, where it is and its box. Reads only.
 */
export const collectMotion = (max: number, kinds: readonly string[]): BoardMotionProbe => {
  const items: BoardMotionProbe['items'] = [];
  let truncated = false;
  const push = (item: BoardMotionProbe['items'][number]): void => {
    if (items.length >= max) truncated = true;
    else items.push(item);
  };
  const boxOf = (element: Element): BoardMotionProbe['items'][number]['box'] => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height };
  };
  const entryOf = (element: Element): string => (element.closest('[data-dc-entry]')?.getAttribute('data-dc-entry') ?? '').slice(0, BOARD_ENTRY_MAX);
  const wanted = (entry: string): boolean => kinds.includes(entry.slice(0, entry.indexOf(':')));
  const hosts = document.querySelectorAll('[data-dc-example-host]');
  const seen = new Set<string>();
  for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
    const host = hosts[hostIndex];
    const root = host?.shadowRoot;
    if (!host || !root || host.closest('.dc-dark') !== null) continue;
    const entry = entryOf(host);
    if (entry === '' || seen.has(entry) || !wanted(entry)) continue;
    seen.add(entry);
    const all = root.querySelectorAll('*');
    for (let index = 0; index < all.length && index < SYSTEM_BOARD_PREVIEW_ELEMENTS_MAX; index += 1) {
      const one = all[index];
      if (!one || !one.hasAttribute('data-dc-motion')) continue;
      const label = (one.getAttribute('data-dc-state') ?? '').trim().toLowerCase();
      push({ entry, kind: 'example', host: hostIndex, element: index, trigger: FORCEABLE.find((candidate) => candidate === label) ?? 'hover', box: boxOf(one) });
    }
  }
  const demos = document.querySelectorAll('.dc-motion-demo');
  for (let index = 0; index < demos.length; index += 1) {
    const demo = demos[index];
    if (!demo) continue;
    const entry = entryOf(demo);
    if (!wanted(entry)) continue;
    // The demo with its token's row around it, so the strip shows the token's name and value too.
    const row = demo.closest('[data-dc-entry]');
    const a = boxOf(demo);
    const b = row === null ? a : boxOf(row);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    push({ entry, kind: 'demo', host: null, element: index, trigger: 'hover', box: { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y } });
  }
  return { items, truncated };
};

/**
 * The board's measurements. Items are the `[data-dc-entry]` elements in document order (cards and
 * table rows alike); a preview's `contentRight` is the board script's `wider()` rule written once
 * more here, because the probe cannot call page script. Rects of `content-visibility: auto` sections
 * are read with forced layout, which Chrome performs for script queries.
 */
export const collectBoard = (): BoardProbe => {
  const scroller = document.scrollingElement ?? document.documentElement;
  const areas: BoardProbe['areas'] = [];
  const areaElements = document.querySelectorAll('[data-dc-area]');
  for (let index = 0; index < areaElements.length && areas.length < AREAS_MAX; index += 1) {
    const element = areaElements[index];
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    areas.push({ area: (element.getAttribute('data-dc-area') ?? '').slice(0, 40), top: rect.top + window.scrollY, height: rect.height });
  }

  const items: BoardProbeItem[] = [];
  const entries = document.querySelectorAll('[data-dc-entry]');
  const range = document.createRange();
  for (let index = 0; index < entries.length && items.length < SYSTEM_BOARD_ITEMS_MEASURED_MAX; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const rect = entry.getBoundingClientRect();
    const box = { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height };

    const previews: BoardProbePreview[] = [];
    const hosts = entry.querySelectorAll('[data-dc-example-host]');
    for (let hostIndex = 0; hostIndex < hosts.length && previews.length < PREVIEWS_MAX; hostIndex += 1) {
      const host = hosts[hostIndex];
      if (!host) continue;
      const root = host.shadowRoot;
      if (!root) continue;
      const hostRect = host.getBoundingClientRect();
      // The board gives the example's box padding (room for a lift on hover, board-html.ts): measure from its content box, so
      // the widths and the "wider than its card" figures are the example's own, as before the padding.
      const hostStyle = getComputedStyle(host);
      const padLeft = parseFloat(hostStyle.paddingLeft) || 0;
      const padRight = parseFloat(hostStyle.paddingRight) || 0;
      const contentLeft = hostRect.left + (parseFloat(hostStyle.borderLeftWidth) || 0) + padLeft;
      let contentRight = 0;
      let outLeft = 0;
      let outTop = 0;
      let outBottom = 0;
      const all = root.querySelectorAll('*');
      for (let scan = 0; scan < all.length && scan < SYSTEM_BOARD_PREVIEW_ELEMENTS_MAX; scan += 1) {
        const one = all[scan];
        if (!one) continue;
        const style = getComputedStyle(one);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (visuallyHidden(one, style, true)) continue;
        const oneRect = one.getBoundingClientRect();
        // No box, or under 1px in both directions: paints nothing.
        if (oneRect.width < 1 && oneRect.height < 1) continue;
        contentRight = Math.max(contentRight, oneRect.right - contentLeft);
        outLeft = Math.max(outLeft, box.x - (oneRect.left + window.scrollX));
        outTop = Math.max(outTop, box.y - (oneRect.top + window.scrollY));
        outBottom = Math.max(outBottom, oneRect.bottom + window.scrollY - (box.y + box.h));
      }
      previews.push({
        w: Math.max(0, host.clientWidth - padLeft - padRight),
        scrollW: Math.max(0, host.scrollWidth - padLeft - padRight),
        contentRight: Math.max(0, contentRight),
        outLeft: Math.max(0, outLeft),
        outTop: Math.max(0, outTop),
        outBottom: Math.max(0, outBottom),
      });
    }

    // The entry's own light-DOM text (never shadow content): the furthest any line reaches past its box.
    let textOut = 0;
    const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT);
    let nodes = 0;
    for (let node = walker.nextNode(); node !== null && nodes < SYSTEM_BOARD_TEXT_NODES_PER_ITEM; node = walker.nextNode()) {
      nodes += 1;
      range.selectNodeContents(node);
      const whole = rectsOut(range.getClientRects(), box);
      // A line that wraps at a space in pre-wrap text keeps that space hanging past the line's end, and the whole node's
      // rects include it: in a table row's last cell that reads as text a few px outside. Only when the cheap measure says
      // "outside" are the words measured on their own (ink, not whitespace), up to a bound; past it the whole figure stands.
      textOut = Math.max(textOut, whole > 1 && node instanceof Text ? wordsOut(range, node, box, whole) : whole);
    }

    items.push({
      // Clipped here, before the answer leaves the page: page script could set a huge attribute value.
      entry: (entry.getAttribute('data-dc-entry') ?? '').slice(0, BOARD_ENTRY_MAX),
      widened: entry.classList.contains('dc-wide'),
      box,
      previews,
      textOut: Math.max(0, textOut),
    });
  }

  return {
    innerWidth,
    scrollWidth: scroller.scrollWidth,
    scrollHeight: scroller.scrollHeight,
    areas,
    items,
    truncated: entries.length > SYSTEM_BOARD_ITEMS_MEASURED_MAX,
    pairs: collectPairs(),
  };
};