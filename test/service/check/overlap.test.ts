// C1: overlap is judged on the boxes text actually paints (per line), never between a text and
// its own ancestors or descendants, and visually hidden text sits out every visual verdict.
// Synthetic probe answers drive the pure verdicts; the sanitize tests guard the untrusted boundary.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeProbe, overlapShare, sanitizeProbe, type ArtboardInfo, type ProbeResult, type ProbeText } from '../../../src/service/check/analyze.ts';
import { CHECK_FINDINGS_PER_CODE, CHECK_TEXT_ELEMENTS_MAX } from '../../../src/shared/limits.ts';

const artboard: ArtboardInfo = { file: 'screens/home.html', screen: 'home', viewport: 'laptop', width: 1280, height: 800, kind: 'canvas' };
const emptyProbe = (): ProbeResult => ({ scrollWidth: 1280, scrollHeight: 800, innerWidth: 1280, innerHeight: 800, wide: [], texts: [], imgsNoAlt: [], unlabeled: [], nameless: [] });
const text = (extra: Partial<ProbeText> = {}): ProbeText => ({
  selector: 'p.note',
  text: 'Hello there',
  rect: { x: 10, y: 10, w: 100, h: 20 },
  color: 'rgb(0, 0, 0)',
  bgChain: [],
  fontPx: 16,
  weight: 400,
  fixed: false,
  disabled: false,
  clipped: false,
  ellipsis: false,
  ...extra,
});
const codes = (probe: ProbeResult): string[] => analyzeProbe(probe, artboard).map((finding) => finding.code);
const overlaps = (probe: ProbeResult) => analyzeProbe(probe, artboard).filter((finding) => finding.code === 'text-overlap');

test('overlap is judged per painted line: a wrapped inline element does not cover its siblings', () => {
  // The paragraph's own text paints on two lines; the inline code wraps with it. The sibling
  // span sits on line 2 next to the code's line-2 fragment, never under it.
  const paragraph = text({ selector: 'p', text: 'Before after', rect: { x: 0, y: 0, w: 300, h: 40 }, lines: [{ x: 0, y: 0, w: 300, h: 20 }, { x: 0, y: 20, w: 300, h: 20 }] });
  const code = text({ selector: 'p > code', text: 'wrapped inline code', rect: { x: 60, y: 0, w: 240, h: 40 }, lines: [{ x: 60, y: 0, w: 240, h: 20 }, { x: 0, y: 20, w: 120, h: 20 }], ancestors: [0] });
  const sibling = text({ selector: 'p > span', text: 'sibling', rect: { x: 140, y: 20, w: 200, h: 20 }, lines: [{ x: 140, y: 20, w: 200, h: 20 }], ancestors: [0] });
  assert.deepEqual(overlaps({ ...emptyProbe(), texts: [paragraph, code, sibling] }), [], 'per-line boxes never touch the sibling');
  // The same geometry with one merged box per element (the old probe shape) does overlap:
  // the code's union box covers the sibling on line 2. That is the false warning C1 removes.
  const merged = [paragraph, code, sibling].map(({ lines: _lines, ...rest }) => rest);
  assert.equal(overlaps({ ...emptyProbe(), texts: merged }).length, 1, 'the merged-box shape is what produced the false warning');
});

test('a text never overlaps its own ancestor or descendant, whatever the geometry', () => {
  const parent = text({ selector: 'p', text: 'parent text', rect: { x: 0, y: 0, w: 100, h: 20 } });
  const child = text({ selector: 'p > code', text: 'child text', rect: { x: 50, y: 0, w: 100, h: 20 }, ancestors: [0] });
  assert.equal(overlapShare(parent.rect, child.rect), 0.5, 'the geometry alone would call it an overlap');
  assert.deepEqual(overlaps({ ...emptyProbe(), texts: [parent, child] }), [], 'the ancestor link exempts the pair');
  // The link works in the other direction too (the probe reports it on the descendant).
  const childFirst = text({ selector: 'p > code', text: 'child text', rect: { x: 50, y: 0, w: 100, h: 20 } });
  const parentSecond = text({ selector: 'p', text: 'parent text', rect: { x: 0, y: 0, w: 100, h: 20 }, ancestors: [0] });
  assert.deepEqual(overlaps({ ...emptyProbe(), texts: [childFirst, parentSecond] }), []);
  // Without the link the same boxes are a real overlap.
  assert.equal(overlaps({ ...emptyProbe(), texts: [parent, { ...child, ancestors: [] }] }).length, 1);
  // An index that names no measured text is ignored, not honoured.
  assert.equal(overlaps({ ...emptyProbe(), texts: [parent, { ...child, ancestors: [7] }] }).length, 1);
});

test('visually hidden text sits out overlap, clipped text and contrast; visible text does not', () => {
  const visible = text({ selector: 'h1', text: 'Visible heading', rect: { x: 0, y: 0, w: 200, h: 30 } });
  const hidden = text({ selector: 'span.sr', text: 'screen reader text', rect: { x: 50, y: 0, w: 200, h: 30 }, hidden: true, clipped: true, color: 'rgb(230, 230, 230)' });
  const found = codes({ ...emptyProbe(), texts: [visible, hidden] });
  assert.ok(!found.includes('text-overlap'), 'hidden text never overlaps');
  assert.ok(!found.includes('text-clipped'), 'a 1px sr-only box is not cut-off text');
  assert.ok(!found.includes('contrast'), 'nobody sees the colour, so it is not a visual defect');
  // The same measurements without the hidden flag are judged (the rule excludes, it does not blind).
  const seen = codes({ ...emptyProbe(), texts: [visible, { ...hidden, hidden: false }] });
  assert.ok(seen.includes('text-overlap'));
  assert.ok(seen.includes('text-clipped'));
  assert.ok(seen.includes('contrast'));
});

test('real overlaps are still found on per-line boxes: the share rule, the fixed exemption and the cap', () => {
  const a = text({ selector: 'h1', text: 'Heading', rect: { x: 0, y: 0, w: 100, h: 20 }, lines: [{ x: 0, y: 0, w: 100, h: 20 }] });
  const over = text({ selector: 'p.caption', text: 'Caption', rect: { x: 50, y: 0, w: 100, h: 20 }, lines: [{ x: 50, y: 0, w: 100, h: 20 }] });
  const findings = overlaps({ ...emptyProbe(), texts: [a, over] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.detail, 'Heading / Caption');
  assert.equal(findings[0]?.selector, 'h1');
  // Under 30% of the smaller box: no warning (the share rule is unchanged).
  const barely = text({ ...over, rect: { x: 80, y: 0, w: 100, h: 20 }, lines: [{ x: 80, y: 0, w: 100, h: 20 }] });
  assert.deepEqual(overlaps({ ...emptyProbe(), texts: [a, barely] }), []);
  // Fixed/sticky text is exempt as before.
  assert.deepEqual(overlaps({ ...emptyProbe(), texts: [a, { ...over, fixed: true }] }), []);
  // One finding per element, capped per code. Each caption is shifted 2px so no box holds another.
  const many = [a, ...Array.from({ length: CHECK_FINDINGS_PER_CODE + 2 }, (_, i) => text({ ...over, selector: `p.c${i}`, text: `Caption ${i}`, rect: { x: 50 + i * 2, y: 0, w: 100, h: 20 }, lines: [{ x: 50 + i * 2, y: 0, w: 100, h: 20 }] }))];
  assert.equal(overlaps({ ...emptyProbe(), texts: many }).length, CHECK_FINDINGS_PER_CODE);
});

test('two texts overlap when any pair of their painted lines does, even if other lines are far apart', () => {
  const a = text({ selector: 'p.a', rect: { x: 0, y: 0, w: 100, h: 60 }, lines: [{ x: 0, y: 0, w: 100, h: 20 }, { x: 0, y: 40, w: 100, h: 20 }] });
  const b = text({ selector: 'p.b', rect: { x: 50, y: 40, w: 100, h: 20 }, lines: [{ x: 50, y: 40, w: 100, h: 20 }] });
  assert.equal(overlaps({ ...emptyProbe(), texts: [a, b] }).length, 1, 'line 2 of a is half covered by b');
});

test('sanitizeProbe validates the new fields: line boxes, hidden flag and ancestor indices', () => {
  // Deliberately malformed values: the boundary must drop them, so they bypass the typed helper.
  const raw: Record<string, unknown> = {
    ...emptyProbe(),
    texts: [
      {
        ...text({ selector: 'p' }),
        lines: [{ x: 0, y: 0, w: 100, h: 20 }, { x: 'far', y: 0, w: 100, h: 20 }, null, { x: 0, y: 20, w: -5, h: 20 }],
        hidden: true,
        ancestors: [1, 1, 'x', -2, 1.5, Number.NaN],
      },
      { ...text({ selector: 'p > code' }), ancestors: [0] },
    ],
  };
  const clean = sanitizeProbe(raw);
  assert.ok(clean);
  assert.deepEqual(clean.texts[0]?.lines, [{ x: 0, y: 0, w: 100, h: 20 }], 'only well-formed boxes survive');
  assert.equal(clean.texts[0]?.hidden, true);
  assert.deepEqual(clean.texts[0]?.ancestors, [1], 'indices are whole numbers in range, duplicates and junk dropped');
  assert.deepEqual(clean.texts[1]?.ancestors, [0]);
  // Missing or malformed fields fall back to today's shape: the merged rect, visible, no links.
  const bare = sanitizeProbe({ ...emptyProbe(), texts: [{ ...text(), lines: 'nope', hidden: 'yes', ancestors: 3 }] });
  assert.ok(bare);
  assert.deepEqual(bare.texts[0]?.lines, []);
  assert.equal(bare.texts[0]?.hidden, false);
  assert.deepEqual(bare.texts[0]?.ancestors, []);
  assert.equal(overlaps({ ...emptyProbe(), texts: bare.texts }).length, 0, 'a lone text never overlaps');
});

test('sanitizeProbe caps the new fields and remaps ancestor indices when an entry is dropped', () => {
  const longLines = Array.from({ length: 400 }, (_, i) => ({ x: 0, y: i * 20, w: 100, h: 20 }));
  const longAncestors = Array.from({ length: 400 }, (_, i) => i);
  const raw: Record<string, unknown> = {
    ...emptyProbe(),
    texts: [
      { selector: 3 }, // dropped: not a text entry
      { ...text({ selector: 'p' }), lines: longLines, ancestors: longAncestors },
      { ...text({ selector: 'p > code' }), ancestors: [1, 2, CHECK_TEXT_ELEMENTS_MAX + 5] },
    ],
  };
  const clean = sanitizeProbe(raw);
  assert.ok(clean);
  assert.equal(clean.texts.length, 2);
  assert.equal(clean.texts[0]?.lines?.length, 100, 'line boxes are capped');
  assert.ok((clean.texts[0]?.ancestors?.length ?? 999) <= 64, 'ancestor links are capped');
  // The code's ancestor was raw index 1; after the dropped entry it is index 0. Index 2 names
  // nothing that survived, and the out-of-range index is gone.
  assert.deepEqual(clean.texts[1]?.ancestors, [0]);
  const parent = clean.texts[0];
  const child = clean.texts[1];
  assert.ok(parent && child);
  parent.rect = { x: 0, y: 0, w: 100, h: 20 };
  parent.lines = [parent.rect];
  child.rect = { x: 50, y: 0, w: 100, h: 20 };
  child.lines = [child.rect];
  assert.deepEqual(overlaps({ ...emptyProbe(), texts: clean.texts }), [], 'the remapped link still exempts the pair');
});

test('a long document of wrapping texts gives no false overlaps, and a planted line overlap is still found', () => {
  // 2000 texts x 30 line boxes, stacked like a long document. The verdict must stay exact at that
  // size; the cost of the pair walk is measured outside the suite, not asserted on a clock.
  const texts: ProbeText[] = [];
  let y = 0;
  for (let i = 0; i < CHECK_TEXT_ELEMENTS_MAX; i += 1) {
    const lines = Array.from({ length: 30 }, (_, l) => ({ x: 0, y: y + l * 20, w: 600, h: 18 }));
    texts.push(text({ selector: `p.t${i}`, text: `Paragraph ${i}`, rect: { x: 0, y, w: 600, h: 600 }, lines }));
    y += 610;
  }
  assert.deepEqual(overlaps({ ...emptyProbe(), texts, scrollHeight: y }), [], 'no false overlaps at the text cap');
  // Pull one text up over its predecessor so exactly one line pair partially overlaps (25px of a
  // 20px line step: 13px shared of 18px, over the 30% rule, neither line holding the other).
  const planted = texts.map((entry, i) =>
    i === 1501
      ? { ...entry, rect: { ...entry.rect, y: entry.rect.y - 25 }, lines: entry.lines?.map((line) => ({ ...line, y: line.y - 25 })) }
      : entry,
  );
  const found = overlaps({ ...emptyProbe(), texts: planted, scrollHeight: y });
  assert.equal(found.length, 1, 'the one real line-pair overlap inside intersecting rects is found');
  assert.equal(found[0]?.detail, 'Paragraph 1500 / Paragraph 1501');
});
