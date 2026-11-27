// The system-board probe (documentation/specs/system-board-layout-and-visual-check.md §B.4). Built
// into the same `__dcProbe` IIFE as the design probe (re-exported from probe.ts) and evaluated in the
// `dc-probe` isolated world of the rendered board. It only measures: geometry of the areas, the
// entries and their example previews, and the entry's own text. It returns plain data and makes no
// verdict; `sanitizeBoardProbe` and `analyzeBoard` (src/service/check/board-analyze.ts) re-check every
// number and decide. It reads the DOM and never writes; the engine scrolls between tiles.

import { BOARD_ENTRY_MAX, SYSTEM_BOARD_ITEMS_MEASURED_MAX, SYSTEM_BOARD_PREVIEW_ELEMENTS_MAX, SYSTEM_BOARD_TEXT_NODES_PER_ITEM, SYSTEM_PAIRS_MAX } from '../../shared/limits.ts';
import type { BoardProbe, BoardProbeItem, BoardProbePair, BoardProbePreview } from '../../service/check/board-analyze.ts';
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
        contentRight = Math.max(contentRight, oneRect.right - hostRect.left);
        outLeft = Math.max(outLeft, box.x - (oneRect.left + window.scrollX));
        outTop = Math.max(outTop, box.y - (oneRect.top + window.scrollY));
        outBottom = Math.max(outBottom, oneRect.bottom + window.scrollY - (box.y + box.h));
      }
      previews.push({
        w: host.clientWidth,
        scrollW: host.scrollWidth,
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