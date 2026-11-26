// The system-board probe (documentation/specs/system-board-layout-and-visual-check.md §B.4). Built
// into the same `__dcProbe` IIFE as the design probe (re-exported from probe.ts) and evaluated in the
// `dc-probe` isolated world of the rendered board. It only measures: geometry of the areas, the
// entries and their example previews, and the entry's own text. It returns plain data and makes no
// verdict; `sanitizeBoardProbe` and `analyzeBoard` (src/service/check/board-analyze.ts) re-check every
// number and decide. It reads the DOM and never writes; the engine scrolls between tiles.

import { SYSTEM_BOARD_ITEMS_MEASURED_MAX, SYSTEM_BOARD_PREVIEW_ELEMENTS_MAX, SYSTEM_BOARD_TEXT_NODES_PER_ITEM } from '../../shared/limits.ts';
import type { BoardProbe, BoardProbeItem, BoardProbePreview } from '../../service/check/board-analyze.ts';
import { visuallyHidden } from './probe.ts';

const AREAS_MAX = 4;
const PREVIEWS_MAX = 2;

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
    areas.push({ area: element.getAttribute('data-dc-area') ?? '', top: rect.top + window.scrollY, height: rect.height });
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
      for (const line of Array.from(range.getClientRects())) {
        if (line.width < 1 || line.height < 1) continue;
        textOut = Math.max(
          textOut,
          line.right + window.scrollX - (box.x + box.w),
          box.x - (line.left + window.scrollX),
          line.bottom + window.scrollY - (box.y + box.h),
          box.y - (line.top + window.scrollY),
        );
      }
    }

    items.push({
      entry: entry.getAttribute('data-dc-entry') ?? '',
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
  };
};