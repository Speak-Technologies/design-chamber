import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeProbe, capPerCode, overlapShare, sanitizeProbe, type ArtboardInfo, type ProbeResult, type ProbeText } from '../../../src/service/check/analyze.ts';
import { compositeOver, contrastRatio, minContrastFor, parseCssColor, relativeLuminance } from '../../../src/service/check/color.ts';
import { CHECK_FINDINGS_PER_CODE } from '../../../src/shared/limits.ts';

const artboard: ArtboardInfo = { file: 'screens/home.html', screen: 'home', viewport: 'phone', width: 390, height: 844, kind: 'canvas' };
const emptyProbe = (): ProbeResult => ({ scrollWidth: 390, scrollHeight: 844, innerWidth: 390, innerHeight: 844, wide: [], texts: [], imgsNoAlt: [], unlabeled: [], nameless: [] });
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

test('parseCssColor reads what getComputedStyle prints', () => {
  assert.deepEqual(parseCssColor('rgb(255, 0, 10)'), { r: 255, g: 0, b: 10, a: 1 });
  assert.deepEqual(parseCssColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseCssColor('rgb(10 20 30 / 25%)'), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.deepEqual(parseCssColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseCssColor('#11223380'), { r: 17, g: 34, b: 51, a: 128 / 255 });
  assert.deepEqual(parseCssColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseCssColor('color(srgb 1 0 0 / 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
  for (const unknown of ['currentcolor', 'oklch(0.5 0.1 20)', 'red', '', 'rgb(1, 2)', '#12', '#gggggg', 'rgb(a, b, c)']) assert.equal(parseCssColor(unknown), null, unknown);
});

test('contrast ratio: black on white is 21, white on white is 1, the AA grey boundary', () => {
  assert.ok(Math.abs(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, []) - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, [{ r: 255, g: 255, b: 255, a: 1 }]) - 1) < 1e-9);
  // #767676 on white is the lightest grey that passes AA (4.54:1); #777 does not (4.48:1).
  assert.ok(contrastRatio({ r: 0x76, g: 0x76, b: 0x76, a: 1 }, []) >= 4.5);
  assert.ok(contrastRatio({ r: 0x77, g: 0x77, b: 0x77, a: 1 }, []) < 4.5);
});

test('alpha is composited: semi-transparent text and layered backgrounds', () => {
  const half = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
  assert.ok(Math.abs(half.r - 127.5) < 1e-9);
  // 50% black text on white is mid grey: below AA.
  assert.ok(contrastRatio({ r: 0, g: 0, b: 0, a: 0.5 }, []) < 4.6);
  // A translucent white layer over a dark one reads as the blend, not as white.
  const ratio = contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, [{ r: 255, g: 255, b: 255, a: 0.1 }, { r: 0, g: 0, b: 0, a: 1 }]);
  assert.ok(ratio > 10 && ratio < 21);
  assert.ok(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 }) === 0);
});

test('AA thresholds: large and bold text need 3, other text 4.5', () => {
  assert.equal(minContrastFor(16, 400), 4.5);
  assert.equal(minContrastFor(23.9, 400), 4.5);
  assert.equal(minContrastFor(24, 400), 3);
  assert.equal(minContrastFor(19, 700), 3);
  assert.equal(minContrastFor(19, 600), 4.5);
  assert.equal(minContrastFor(18, 700), 4.5);
});

test('low contrast is reported once per colour pair, with its selector and rounded-down ratio', () => {
  const grey = text({ color: 'rgb(150, 150, 150)', selector: 'p.a' });
  const probe = { ...emptyProbe(), texts: [grey, text({ ...grey, selector: 'p.b' })] };
  const findings = analyzeProbe(probe, artboard).filter((finding) => finding.code === 'contrast');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.selector, 'p.a');
  assert.equal(findings[0]?.params?.min, 4.5);
  assert.ok((findings[0]?.params?.ratio ?? 99) < 4.5);
  assert.equal(findings[0]?.viewport, 'phone');
});

test('contrast passes at exactly the boundary and is skipped for disabled text, unknown backgrounds and unknown colours', () => {
  assert.ok(!codes({ ...emptyProbe(), texts: [text({ color: 'rgb(118, 118, 118)' })] }).includes('contrast'));
  assert.ok(codes({ ...emptyProbe(), texts: [text({ color: 'rgb(119, 119, 119)' })] }).includes('contrast'));
  assert.ok(!codes({ ...emptyProbe(), texts: [text({ color: 'rgb(200, 200, 200)', disabled: true })] }).includes('contrast'));
  assert.ok(!codes({ ...emptyProbe(), texts: [text({ color: 'rgb(200, 200, 200)', bgChain: null })] }).includes('contrast'));
  assert.ok(!codes({ ...emptyProbe(), texts: [text({ color: 'oklch(0.9 0 0)' })] }).includes('contrast'));
  assert.ok(!codes({ ...emptyProbe(), texts: [text({ color: 'rgb(200, 200, 200)', text: '   ' })] }).includes('contrast'));
});

test('large text passes at 3:1', () => {
  // #949494 on white is 3.03:1.
  const large = text({ color: 'rgb(148, 148, 148)', fontPx: 28 });
  assert.ok(!codes({ ...emptyProbe(), texts: [large] }).includes('contrast'));
  assert.ok(codes({ ...emptyProbe(), texts: [{ ...large, fontPx: 16 }] }).includes('contrast'));
});

test('overflow-x: wider than the viewport, selector = widest offender, 1px tolerance', () => {
  const probe = { ...emptyProbe(), scrollWidth: 452, wide: [{ selector: 'div.small', right: 410 }, { selector: 'form.signup > .row', right: 452 }] };
  const finding = analyzeProbe(probe, artboard).find((entry) => entry.code === 'overflow-x');
  assert.deepEqual(finding?.params, { px: 452, width: 390 });
  assert.equal(finding?.selector, 'form.signup > .row');
  assert.ok(!codes({ ...emptyProbe(), scrollWidth: 391 }).includes('overflow-x'));
  assert.ok(codes({ ...emptyProbe(), scrollWidth: 392 }).includes('overflow-x'));
});

test('clipped text is a finding unless it is an ellipsis or line clamp', () => {
  assert.ok(codes({ ...emptyProbe(), texts: [text({ clipped: true })] }).includes('text-clipped'));
  assert.ok(!codes({ ...emptyProbe(), texts: [text({ clipped: true, ellipsis: true })] }).includes('text-clipped'));
  assert.ok(!codes({ ...emptyProbe(), texts: [text({ clipped: false })] }).includes('text-clipped'));
});

test('overlap: needs 30% of the smaller box; nesting, fixed headers and touching boxes are fine', () => {
  const a = { x: 0, y: 0, w: 100, h: 20 };
  assert.equal(overlapShare(a, { x: 50, y: 0, w: 100, h: 20 }), 0.5);
  assert.equal(overlapShare(a, { x: 100, y: 0, w: 100, h: 20 }), 0);
  assert.equal(overlapShare(a, { x: 10, y: 5, w: 20, h: 5 }), 0, 'a box inside the other is nesting, not overlap');
  const over = [text({ selector: 'h1', rect: a }), text({ selector: 'p', rect: { x: 50, y: 0, w: 100, h: 20 } })];
  assert.ok(codes({ ...emptyProbe(), texts: over }).includes('text-overlap'));
  assert.ok(!codes({ ...emptyProbe(), texts: [over[0] as ProbeText, { ...(over[1] as ProbeText), fixed: true }] }).includes('text-overlap'));
  assert.ok(!codes({ ...emptyProbe(), texts: [over[0] as ProbeText, { ...(over[1] as ProbeText), rect: { x: 90, y: 0, w: 100, h: 20 } }] }).includes('text-overlap'));
});

test('alt text, labels and names come from the probe lists', () => {
  const probe = { ...emptyProbe(), imgsNoAlt: ['img.hero'], unlabeled: ['input#email', 'select.plan'], nameless: ['button.icon'] };
  assert.deepEqual(codes(probe).filter((code) => code !== 'page-height'), ['img-alt', 'control-label', 'control-label', 'button-name']);
});

test('page height is always a note; screen-tall only on a canvas at 6 viewports', () => {
  const tall = { ...emptyProbe(), scrollHeight: 844 * 6 };
  assert.ok(codes(tall).includes('screen-tall'));
  assert.ok(!codes({ ...emptyProbe(), scrollHeight: 844 * 6 - 10 }).includes('screen-tall'));
  assert.ok(!analyzeProbe(tall, { ...artboard, kind: 'page', screen: null }).some((finding) => finding.code === 'screen-tall'));
  const height = analyzeProbe(tall, artboard).find((finding) => finding.code === 'page-height');
  assert.deepEqual(height?.params, { px: 5064, ratio: 6 });
});

test('findings are capped per code', () => {
  const many = Array.from({ length: 20 }, (_, i) => `img.n${i}`);
  assert.equal(analyzeProbe({ ...emptyProbe(), imgsNoAlt: many }, artboard).filter((finding) => finding.code === 'img-alt').length, CHECK_FINDINGS_PER_CODE);
  const list = Array.from({ length: 9 }, () => ({ code: 'img-alt' as const, file: 'a.html', screen: null, viewport: 'phone' }));
  assert.equal(capPerCode(list).length, CHECK_FINDINGS_PER_CODE);
});

test('sanitizeProbe refuses a wrong shape and trims what a script could inflate', () => {
  assert.equal(sanitizeProbe(null), null);
  assert.equal(sanitizeProbe({ scrollWidth: 'wide' }), null);
  assert.equal(sanitizeProbe({ ...emptyProbe(), scrollHeight: Number.NaN }), null);
  const raw = { ...emptyProbe(), imgsNoAlt: Array.from({ length: 500 }, () => 'img'), texts: [text(), { selector: 3 }, null, text({ selector: `a\nb${'x'.repeat(900)}` })], wide: [{ selector: 'x', right: 'far' }] };
  const clean = sanitizeProbe(raw);
  assert.ok(clean);
  assert.equal(clean.imgsNoAlt.length, 50);
  assert.equal(clean.texts.length, 2);
  assert.ok(!clean.texts[1]?.selector.includes('\n'));
  assert.ok((clean.texts[1]?.selector.length ?? 999) <= 300);
  assert.equal(clean.wide.length, 0);
});
