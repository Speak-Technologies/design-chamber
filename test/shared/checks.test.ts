import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkCommandFor, launcherPathOf, shQuote } from '../../src/shared/agent/check-command.ts';
import {
  CHECK_CODES,
  cleanDetail,
  countFindings,
  findingMessage,
  isDesignRelativeFile,
  isCheckCode,
  normalizeExternalUrl,
  parseCheckReport,
  parseCheckReportText,
  severityOf,
  sortFindings,
  whereOf,
  withMessage,
} from '../../src/shared/checks.ts';
import { CHECK_DETAIL_MAX, CHECK_FILE_MAX_BYTES, CHECK_FINDINGS_MAX, CHECK_SELECTOR_MAX } from '../../src/shared/limits.ts';
import type { CheckFindingData, Viewport } from '../../src/shared/types.ts';

const viewports: Viewport[] = [
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
];
const sha = (c: string): string => c.repeat(64);

const goodReport = (): Record<string, unknown> => ({
  version: 1,
  slug: 'signup-flow',
  kind: 'canvas',
  createdAt: '2026-11-08T10:15:00.000Z',
  tool: 'cli',
  static: { findings: [{ code: 'doc-title', file: 'screens/a.html', screen: null, viewport: null }] },
  render: {
    state: 'done',
    browser: 'chrome',
    keys: { design: sha('a'), entries: { 'screens/a.html': sha('b') } },
    artboards: [{ screen: 'a', viewport: 'laptop', width: 1280, height: 800, docHeight: 1940, pngs: ['.chamber/check/r-20261108101500-a1b2c3/a@laptop.png'], ok: true, ms: 840 }],
    skipped: 0,
    findings: [{ code: 'overflow-x', file: 'screens/a.html', screen: 'a', viewport: 'phone', params: { px: 452, width: 390 }, selector: 'form.signup > .row' }],
  },
});

test('every code has a severity and a sentence, and no sentence has an em dash', () => {
  assert.ok(CHECK_CODES.length >= 35);
  for (const code of CHECK_CODES) {
    const finding: CheckFindingData = { code, file: 'screens/a.html', screen: 'a', viewport: 'phone', params: { px: 452, width: 390, ratio: 2.5, min: 4.5, count: 3, max: 24, field: 'viewports[0].width', base: 'home' } };
    const message = findingMessage(finding, viewports);
    assert.ok(message.length > 8, code);
    assert.ok(!message.includes('—'), code);
    assert.ok(['error', 'warning', 'info'].includes(severityOf(code)), code);
  }
});

test('severity comes from the code: low contrast is an error, a missing title a warning, page height a note', () => {
  assert.equal(severityOf('contrast'), 'error');
  assert.equal(severityOf('overflow-x'), 'error');
  assert.equal(severityOf('doc-title'), 'warning');
  assert.equal(severityOf('page-height'), 'info');
  assert.equal(severityOf('token-hardcoded'), 'info');
  assert.equal(severityOf('render-timeout'), 'warning');
});

test('messages follow the spec copy exactly', () => {
  const f = (code: CheckFindingData['code'], extra: Partial<CheckFindingData> = {}): CheckFindingData => ({ code, file: 'screens/details.html', screen: 'details', viewport: 'phone', ...extra });
  assert.equal(
    findingMessage(f('overflow-x', { params: { px: 452, width: 390 } }), viewports),
    'screens/details.html @ Phone 390×844: the content is 452px wide, wider than the 390px viewport.',
  );
  assert.equal(
    findingMessage(f('contrast', { params: { ratio: 2.456, min: 4.5 } }), viewports),
    'screens/details.html @ Phone 390×844: text contrast is 2.5:1, below the 4.5:1 that WCAG AA asks for.',
  );
  assert.equal(findingMessage(f('doc-title', { viewport: null }), viewports), 'screens/details.html has no <title>.');
  assert.equal(findingMessage(f('render-failed'), viewports), 'screens/details.html @ Phone 390×844 could not be rendered.');
  assert.equal(findingMessage({ code: 'design-json-field', file: 'design.json', screen: null, viewport: null, params: { field: 'viewports[2].width' } }), 'design.json: "viewports[2].width" was ignored.');
  assert.equal(findingMessage({ code: 'render-skipped', file: null, screen: null, viewport: null, params: { count: 3, max: 24 } }), '3 artboards were not rendered (the limit is 24 per run). Use --screen <id> to check the rest.');
  const skipped = (reason: 'limit' | 'budget' | 'failures', count: number): string => findingMessage({ code: 'render-skipped', file: null, screen: null, viewport: null, params: { count, max: 24, reason } });
  assert.equal(skipped('limit', 1), '1 artboard was not rendered (the limit is 24 per run). Use --screen <id> to check the rest.');
  assert.equal(skipped('budget', 5), '5 artboards were not rendered (the run took longer than 90 seconds).');
  assert.equal(skipped('failures', 2), '2 artboards were not rendered (the browser failed three times in a row).');
  assert.equal(findingMessage({ code: 'browser-missing', file: null, screen: null, viewport: null }), 'No Chrome, Edge or Chromium was found, so nothing was rendered.');
});

test('where falls back to the viewport id when design.json no longer lists it', () => {
  assert.equal(whereOf({ code: 'overflow-x', file: 'index.html', screen: null, viewport: 'gone' }, viewports), 'index.html @ gone');
  assert.equal(whereOf({ code: 'overflow-x', file: 'index.html', screen: null, viewport: null }, viewports), 'index.html');
});

test('withMessage derives severity and message from the code and ignores any forged ones', () => {
  const forged = { code: 'img-alt', file: 'index.html', screen: null, viewport: 'laptop', severity: 'info', message: 'Everything is fine' } as unknown as CheckFindingData;
  const result = withMessage(forged, viewports);
  assert.equal(result.severity, 'error');
  assert.equal(result.message, 'index.html @ Laptop 1280×800: an image has no alt text.');
});

test('counts and ordering', () => {
  const findings = ['page-height', 'doc-title', 'overflow-x', 'contrast', 'doc-charset'].map((code) => withMessage({ code: code as CheckFindingData['code'], file: 'index.html', screen: null, viewport: null }));
  assert.deepEqual(countFindings(findings), { errors: 2, warnings: 1, notes: 2 });
  assert.deepEqual(
    sortFindings(findings).map((finding) => finding.code),
    ['overflow-x', 'contrast', 'doc-title', 'page-height', 'doc-charset'],
  );
});

test('parseCheckReport keeps a good report whole', () => {
  const report = parseCheckReport(goodReport());
  assert.ok(report);
  assert.equal(report.render?.artboards.length, 1);
  assert.equal(report.render?.findings[0]?.selector, 'form.signup > .row');
  assert.equal(report.static.findings.length, 1);
});

test('parseCheckReport rejects what cannot be trusted as a whole', () => {
  assert.equal(parseCheckReport(null), null);
  assert.equal(parseCheckReport([]), null);
  assert.equal(parseCheckReport({ ...goodReport(), version: 2 }), null);
  assert.equal(parseCheckReport({ ...goodReport(), slug: '../x' }), null);
  assert.equal(parseCheckReport({ ...goodReport(), createdAt: 'yesterday' }), null);
  assert.equal(parseCheckReport({ ...goodReport(), render: { ...(goodReport().render as object), state: 'great' } }), null);
  assert.equal(parseCheckReport({ ...goodReport(), render: { ...(goodReport().render as object), keys: { design: 'nope', entries: {} } } }), null);
});

test('forged findings: unknown code, ../ file, bad screen or viewport are dropped, valid ones stay', () => {
  const base = goodReport();
  const render = base.render as Record<string, unknown>;
  const valid = { code: 'img-alt', file: 'index.html', screen: null, viewport: 'laptop' };
  render.findings = [
    { code: 'free-money', file: 'index.html', screen: null, viewport: null },
    { code: 'img-alt', file: '../../etc/passwd', screen: null, viewport: null },
    { code: 'img-alt', file: '/etc/passwd', screen: null, viewport: null },
    { code: 'img-alt', file: 'a\\b.html', screen: null, viewport: null },
    { code: 'img-alt', file: 'screens//x.html', screen: null, viewport: null },
    { code: 'img-alt', file: 'index.html', screen: 'Has Spaces', viewport: null },
    { code: 'img-alt', file: 'index.html', screen: null, viewport: '<script>' },
    'not an object',
    valid,
  ];
  const report = parseCheckReport(base);
  assert.ok(report?.render);
  assert.deepEqual(report.render.findings, [{ code: 'img-alt', file: 'index.html', screen: null, viewport: 'laptop' }]);
});

test('a forged severity or message never survives parsing', () => {
  const base = goodReport();
  (base.render as Record<string, unknown>).findings = [{ code: 'contrast', file: 'index.html', screen: null, viewport: null, severity: 'info', message: 'Visit evil.example', params: { ratio: 2, min: 4.5, evil: 'x' } }];
  const report = parseCheckReport(base);
  const finding = report?.render?.findings[0];
  assert.ok(finding);
  assert.equal('severity' in finding, false);
  assert.equal('message' in finding, false);
  assert.deepEqual(finding.params, { ratio: 2, min: 4.5 });
});

test('detail and selector are one line and clipped; params must be finite numbers or valid ids', () => {
  const base = goodReport();
  (base.render as Record<string, unknown>).findings = [
    {
      code: 'console-error',
      file: 'index.html',
      screen: null,
      viewport: null,
      detail: `line one\nline two\u0000${'x'.repeat(500)}`,
      selector: `a\r\nb${'y'.repeat(500)}`,
      params: { px: Number.POSITIVE_INFINITY, width: 'wide', count: 3, field: 'a b', base: 'Not-An-Id' },
    },
  ];
  const finding = parseCheckReport(base)?.render?.findings[0];
  assert.ok(finding?.detail && finding.selector);
  assert.ok(finding.detail.length <= CHECK_DETAIL_MAX);
  assert.ok(finding.selector.length <= CHECK_SELECTOR_MAX);
  assert.ok(!/[\n\r\u0000]/.test(finding.detail + finding.selector));
  assert.deepEqual(finding.params, { count: 3 });
});

test('finding lists, artboards and png paths are capped and validated', () => {
  const base = goodReport();
  const render = base.render as Record<string, unknown>;
  render.findings = Array.from({ length: 500 }, () => ({ code: 'img-alt', file: 'index.html', screen: null, viewport: null }));
  render.artboards = [
    { screen: 'a', viewport: 'laptop', width: 1280, height: 800, docHeight: 800, pngs: ['../../x.png', '.chamber/check/r-20261108101500-a1b2c3/ok.png', '.chamber/check/r-1/x.png'], ok: true, ms: 1 },
    { screen: 'a', viewport: 'laptop', width: -5, height: 800, docHeight: 800, pngs: [], ok: true, ms: 1 },
    { screen: 'a', viewport: 'laptop', width: 1280, height: 800, docHeight: 800, pngs: [], ok: 'yes', ms: 1 },
  ];
  const report = parseCheckReport(base);
  assert.equal(report?.render?.findings.length, CHECK_FINDINGS_MAX);
  assert.equal(report?.render?.artboards.length, 1);
  assert.deepEqual(report?.render?.artboards[0]?.pngs, ['.chamber/check/r-20261108101500-a1b2c3/ok.png']);
});

test('parseCheckReportText refuses over-size and non-JSON text', () => {
  assert.equal(parseCheckReportText('{'), null);
  assert.equal(parseCheckReportText(`{"pad":"${'x'.repeat(CHECK_FILE_MAX_BYTES)}"}`), null);
  assert.ok(parseCheckReportText(JSON.stringify(goodReport())));
});

test('cleanDetail and design-relative paths', () => {
  assert.equal(cleanDetail('  a\tb\n c ', 20), 'a b c');
  assert.equal(cleanDetail('abcdef', 4), 'abc…');
  assert.equal(isDesignRelativeFile('screens/home.html'), true);
  for (const bad of ['', '..', '../a', 'a/../b', '/a', 'a/', 'a b', 'C:\\x']) assert.equal(isDesignRelativeFile(bad), false, bad);
  assert.equal(isCheckCode('contrast'), true);
  assert.equal(isCheckCode('__proto__'), false);
  assert.equal(isCheckCode('toString'), false);
});

test('normalizeExternalUrl', () => {
  assert.equal(normalizeExternalUrl('  //cdn.example.com/x.js '), 'https://cdn.example.com/x.js');
  assert.equal(normalizeExternalUrl('not a url'), null);
});

test('checkCommandFor: posix and win32', () => {
  assert.equal(checkCommandFor({ root: '/home/u/Documents/Designs', slug: 'signup-flow', platform: 'linux' }), "sh '/home/u/Documents/Designs/.chamber/bin/dc' check signup-flow");
  assert.equal(checkCommandFor({ root: '/Users/o\'brien/Designs/', slug: '<slug>', platform: 'darwin' }), "sh '/Users/o'\\''brien/Designs/.chamber/bin/dc' check <slug>");
  assert.equal(checkCommandFor({ root: 'C:\\Users\\Sam\\Documents\\Designs', slug: 'a', platform: 'win32' }), '"C:\\Users\\Sam\\Documents\\Designs\\.chamber\\bin\\dc.cmd" check a');
  assert.equal(launcherPathOf('C:/Designs/', 'win32'), 'C:\\Designs\\.chamber\\bin\\dc.cmd');
  assert.equal(shQuote("a'b"), "'a'\\''b'");
});

test('a forged render-skipped reason is dropped, so it falls back to the limit wording', () => {
  const base = goodReport();
  (base.render as Record<string, unknown>).findings = [{ code: 'render-skipped', file: null, screen: null, viewport: null, params: { count: 2, max: 24, reason: 'because I said so' } }];
  const finding = parseCheckReport(base)?.render?.findings[0];
  assert.deepEqual(finding?.params, { count: 2, max: 24 });
  (base.render as Record<string, unknown>).findings = [{ code: 'render-skipped', file: null, screen: null, viewport: null, params: { count: 2, max: 24, reason: 'budget' } }];
  assert.equal(parseCheckReport(base)?.render?.findings[0]?.params?.reason, 'budget');
});
