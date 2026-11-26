// The board probe's sanitizer and verdicts (documentation/specs/system-board-layout-and-visual-check.md
// §B.4, §B.6): pure functions over synthetic probe answers. The 1px boundaries are pinned (1 → no
// finding, 2 → finding), the hint note is wide-width only, dedupe keeps the widest width, and the
// sanitizer refuses anything the probe next to untrusted script could forge.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeBoard, boardFindings, dedupeBoardFindings, sanitizeBoardProbe, type BoardProbe } from '../../../src/service/check/board-analyze.ts';
import { SYSTEM_BOARD_FINDINGS_PER_CODE, SYSTEM_BOARD_ITEMS_MEASURED_MAX, SYSTEM_CHECK_BOARD_WIDTHS } from '../../../src/shared/limits.ts';
import type { BoardLayout, CheckFindingData } from '../../../src/shared/types.ts';

const WIDE = SYSTEM_CHECK_BOARD_WIDTHS[0];
const NARROW = SYSTEM_CHECK_BOARD_WIDTHS[1];

const probe = (over: Partial<BoardProbe> = {}): BoardProbe => ({
  innerWidth: 1526,
  scrollWidth: 1526,
  scrollHeight: 2000,
  areas: [{ area: 'components', top: 400, height: 1200 }],
  items: [],
  truncated: false,
  ...over,
});

const item = (over: Partial<BoardProbe['items'][number]> = {}): BoardProbe['items'][number] => ({
  entry: 'component:table',
  widened: false,
  box: { x: 40, y: 400, w: 692, h: 200 },
  previews: [{ w: 600, scrollW: 600, contentRight: 600, outLeft: 0, outTop: 0, outBottom: 0 }],
  textOut: 0,
  ...over,
});

const ctx = (over: Partial<Parameters<typeof analyzeBoard>[1]> = {}): Parameters<typeof analyzeBoard>[1] => ({
  width: WIDE,
  widest: true,
  layoutOf: () => 'card' as BoardLayout,
  fileOf: (entry) => (entry.startsWith('component:') ? `components/${entry.slice('component:'.length)}.html` : 'board.html'),
  ...over,
});

const codes = (findings: readonly CheckFindingData[]): string[] => findings.map((finding) => finding.code);

test('the 1px boundaries: 1px over is tolerated, 2px is a finding', () => {
  // Board overflow.
  assert.deepEqual(codes(analyzeBoard(probe({ scrollWidth: 1527 }), ctx())), []);
  const overflow = analyzeBoard(probe({ scrollWidth: 1528 }), ctx());
  assert.deepEqual(codes(overflow), ['system-board-overflow']);
  assert.deepEqual(overflow[0]?.params, { px: 1528, width: 1526 });
  assert.equal(overflow[0]?.file, 'board.html');
  assert.equal(overflow[0]?.viewport, 'wide');

  // Preview wide: scrollWidth and contentRight both feed the rule.
  assert.deepEqual(codes(analyzeBoard(probe({ items: [item({ previews: [{ w: 600, scrollW: 601, contentRight: 600, outLeft: 0, outTop: 0, outBottom: 0 }] })] }), ctx())), []);
  const wide = analyzeBoard(probe({ items: [item({ previews: [{ w: 600, scrollW: 602, contentRight: 600, outLeft: 0, outTop: 0, outBottom: 0 }] })] }), ctx());
  assert.deepEqual(codes(wide), ['system-board-preview-wide']);
  assert.deepEqual(wide[0]?.params, { px: 602, width: 600 });
  assert.equal(wide[0]?.file, 'components/table.html');
  assert.equal(wide[0]?.detail, 'component:table');
  const content = analyzeBoard(probe({ items: [item({ previews: [{ w: 600, scrollW: 600, contentRight: 602, outLeft: 0, outTop: 0, outBottom: 0 }] })] }), ctx());
  assert.deepEqual(codes(content), ['system-board-preview-wide']);

  // Preview outside: each side, 1px tolerated.
  for (const side of ['outLeft', 'outTop', 'outBottom'] as const) {
    const atOne = item({ previews: [{ w: 600, scrollW: 600, contentRight: 600, outLeft: 0, outTop: 0, outBottom: 0, [side]: 1 }] });
    assert.deepEqual(codes(analyzeBoard(probe({ items: [atOne] }), ctx())), [], side);
    const atTwo = item({ previews: [{ w: 600, scrollW: 600, contentRight: 600, outLeft: 0, outTop: 0, outBottom: 0, [side]: 2 }] });
    const found = analyzeBoard(probe({ items: [atTwo] }), ctx());
    assert.deepEqual(codes(found), ['system-board-preview-outside'], side);
    assert.deepEqual(found[0]?.params, { px: 2 });
  }

  // Text outside.
  assert.deepEqual(codes(analyzeBoard(probe({ items: [item({ textOut: 1 })] }), ctx())), []);
  const text = analyzeBoard(probe({ items: [item({ textOut: 2 })] }), ctx());
  assert.deepEqual(codes(text), ['system-board-text-outside']);
  assert.deepEqual(text[0]?.params, { px: 2 });
});

test('hint-small: only at the wide width, only for a widened entry whose layout is not full', () => {
  const widened = item({ widened: true });
  const compact = ctx({ layoutOf: () => 'compact' });
  assert.deepEqual(codes(analyzeBoard(probe({ items: [widened] }), compact)), ['system-board-hint-small']);
  assert.deepEqual(analyzeBoard(probe({ items: [widened] }), compact)[0]?.params, { layout: 'compact' });
  // Narrow width: never.
  assert.deepEqual(codes(analyzeBoard(probe({ items: [widened] }), { ...compact, width: NARROW, widest: false })), []);
  // full: the hint was right.
  assert.deepEqual(codes(analyzeBoard(probe({ items: [widened] }), ctx({ layoutOf: () => 'full' }))), []);
  // Not widened: nothing to say.
  assert.deepEqual(codes(analyzeBoard(probe({ items: [item()] }), compact)), []);
  // card and table also raise it.
  assert.deepEqual(codes(analyzeBoard(probe({ items: [widened] }), ctx({ layoutOf: () => 'card' }))), ['system-board-hint-small']);
  assert.deepEqual(codes(analyzeBoard(probe({ items: [widened] }), ctx({ layoutOf: () => 'table' }))), ['system-board-hint-small']);
});

test('entry keys off the pattern are never named; a non-component entry names board.html', () => {
  const forged = item({ entry: 'component:../evil' });
  assert.deepEqual(codes(analyzeBoard(probe({ items: [forged], scrollWidth: 9999 }), ctx())).filter((code) => code !== 'system-board-overflow'), []);
  const token = item({ entry: 'token:--brand', textOut: 5 });
  const found = analyzeBoard(probe({ items: [token] }), ctx());
  assert.equal(found[0]?.file, 'board.html');
  assert.equal(found[0]?.detail, 'token:--brand');
  // An empty entry (no attribute) is skipped.
  assert.deepEqual(codes(analyzeBoard(probe({ items: [item({ entry: '', textOut: 5 })] }), ctx())), []);
});

test('truncated measurement is one partial note with the entry cap', () => {
  const found = analyzeBoard(probe({ truncated: true }), ctx());
  assert.deepEqual(codes(found), ['system-board-partial']);
  assert.deepEqual(found[0]?.params, { max: SYSTEM_BOARD_ITEMS_MEASURED_MAX });
});

test('dedupe keeps the widest width per (code, entry); narrow-only findings stay; board codes stay per width', () => {
  const at = (viewport: string, px: number): CheckFindingData => ({ code: 'system-board-preview-wide', file: 'components/table.html', screen: null, viewport, params: { px, width: 600 }, detail: 'component:table' });
  const both = dedupeBoardFindings([at('wide', 1800), at('narrow', 1800)]);
  assert.equal(both.length, 1);
  assert.equal(both[0]?.viewport, 'wide');
  // Narrow first in the input: the wide one still wins.
  const reversed = dedupeBoardFindings([at('narrow', 1800), at('wide', 1800)]);
  assert.equal(reversed.length, 1);
  assert.equal(reversed[0]?.viewport, 'wide');
  // Only narrow raised it: kept at narrow.
  const narrowOnly = dedupeBoardFindings([at('narrow', 900)]);
  assert.equal(narrowOnly.length, 1);
  assert.equal(narrowOnly[0]?.viewport, 'narrow');
  // Two previews of one entry at one width collapse to one.
  assert.equal(dedupeBoardFindings([at('wide', 1800), at('wide', 1700)]).length, 1);
  // Board-level codes are kept per width.
  const overflow = (viewport: string): CheckFindingData => ({ code: 'system-board-overflow', file: 'board.html', screen: null, viewport, params: { px: 1600, width: 1526 } });
  const partial = (viewport: string): CheckFindingData => ({ code: 'system-board-partial', file: 'board.html', screen: null, viewport, params: { max: 3600, area: 'components', width: 1526 } });
  const failed = (viewport: string): CheckFindingData => ({ code: 'render-failed', file: 'board.html', screen: null, viewport });
  assert.equal(dedupeBoardFindings([overflow('wide'), overflow('narrow'), partial('wide'), partial('narrow'), failed('wide'), failed('narrow')]).length, 6);
  // Different entries never collapse into each other.
  const other: CheckFindingData = { ...at('wide', 1800), detail: 'component:nav', file: 'components/nav.html' };
  assert.equal(dedupeBoardFindings([at('wide', 1800), other]).length, 2);
});

test('the per-code cap keeps 20 board findings per code, after dedupe and before the overall cap', () => {
  const items = Array.from({ length: 25 }, (_, n) => item({ entry: `component:c${n}`, previews: [{ w: 100, scrollW: 200, contentRight: 200, outLeft: 0, outTop: 0, outBottom: 0 }] }));
  const found = analyzeBoard(probe({ items }), ctx());
  assert.equal(found.length, 25);
  assert.equal(boardFindings(found, 200).length, SYSTEM_BOARD_FINDINGS_PER_CODE);
  assert.equal(boardFindings(found, 10).length, 10, 'the overall cap still applies');
});

// ---- the sanitizer ----

test('sanitizeBoardProbe: a well-formed answer passes with its numbers', () => {
  const answer = probe({ items: [item()] });
  const sanitized = sanitizeBoardProbe(answer);
  assert.ok(sanitized !== null);
  assert.equal(sanitized.innerWidth, 1526);
  assert.equal(sanitized.items.length, 1);
  assert.equal(sanitized.items[0]?.entry, 'component:table');
  assert.equal(sanitized.items[0]?.previews[0]?.scrollW, 600);
});

test('sanitizeBoardProbe: NaN, Infinity, wrong types and missing parts are refused', () => {
  assert.equal(sanitizeBoardProbe(null), null);
  assert.equal(sanitizeBoardProbe([]), null);
  assert.equal(sanitizeBoardProbe('x'), null);
  assert.equal(sanitizeBoardProbe({ ...probe(), innerWidth: NaN }), null);
  assert.equal(sanitizeBoardProbe({ ...probe(), scrollWidth: Infinity }), null);
  assert.equal(sanitizeBoardProbe({ ...probe(), scrollHeight: '2000' }), null);
  assert.equal(sanitizeBoardProbe({ ...probe(), innerWidth: -1 }), null);
  assert.equal(sanitizeBoardProbe({ ...probe(), innerWidth: 1e7 + 1 }), null);
  // A non-list items reads as no items (the design probe's convention), never as findings.
  assert.deepEqual(sanitizeBoardProbe({ ...probe(), items: 'x' })?.items, []);
  // A broken item is dropped, not fatal; a broken preview too.
  const mixed = sanitizeBoardProbe({ ...probe(), items: [item(), { entry: 'component:x' }, { ...item(), previews: [{ w: NaN }] }, item({ box: { x: 0, y: 0, w: -1, h: 0 } })] });
  assert.ok(mixed !== null);
  // The boxless and negative-box items drop; the NaN preview drops but its item stays, without previews.
  assert.equal(mixed.items.length, 2);
  assert.deepEqual(mixed.items[1]?.previews, []);
  const noPreview = sanitizeBoardProbe({ ...probe(), items: [item({ previews: [] })] });
  assert.ok(noPreview !== null);
  assert.deepEqual(noPreview.items[0]?.previews, []);
});

test('sanitizeBoardProbe: arrays are capped and strings clipped', () => {
  const manyItems = Array.from({ length: SYSTEM_BOARD_ITEMS_MEASURED_MAX + 50 }, (_, n) => item({ entry: `component:c${n}` }));
  const sanitized = sanitizeBoardProbe({ ...probe(), items: manyItems, areas: Array.from({ length: 9 }, (_, n) => ({ area: 'components', top: n, height: 1 })) });
  assert.ok(sanitized !== null);
  assert.equal(sanitized.items.length, SYSTEM_BOARD_ITEMS_MEASURED_MAX);
  assert.equal(sanitized.areas.length, 4);
  const longEntry = sanitizeBoardProbe({ ...probe(), items: [item({ entry: `component:${'a'.repeat(300)}` })] });
  assert.ok(longEntry !== null);
  assert.ok((longEntry.items[0]?.entry ?? '').length <= 120);
  // An unknown area name is dropped; widened and truncated read as booleans only.
  const areas = sanitizeBoardProbe({ ...probe(), areas: [{ area: 'evil', top: 0, height: 1 }, { area: 'brand', top: 0, height: 1 }], items: [item({ widened: 'yes' as never })], truncated: 'yes' });
  assert.ok(areas !== null);
  assert.deepEqual(areas.areas.map((area) => area.area), ['brand']);
  assert.equal(areas.items[0]?.widened, false);
  assert.equal(areas.truncated, false);
});