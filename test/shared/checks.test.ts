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
import type { CheckFindingData, CheckParams, Viewport } from '../../src/shared/types.ts';

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

test('tweak-broken: a warning whose sentences follow the spec copy exactly (Phase 2 §4.7)', () => {
  assert.equal(severityOf('tweak-broken'), 'warning');
  const f = (params: CheckFindingData['params']): CheckFindingData => ({ code: 'tweak-broken', file: 'design.json', screen: null, viewport: null, params });
  assert.equal(findingMessage(f({ tweak: 'missing', field: '--accent-h' })), 'design.json: the tweak for --accent-h names a variable tokens.css does not define.');
  assert.equal(findingMessage(f({ tweak: 'formula', field: '--radius' })), "design.json: the tweak for --radius points at a formula in tokens.css (calc() or var()), so it can't be tuned.");
  assert.equal(findingMessage(f({ tweak: 'unit', field: '--radius' })), 'design.json: the tweak for --radius uses a different unit than tokens.css.');
  assert.equal(findingMessage(f({ tweak: 'no-tokens' })), 'design.json declares tweaks, but the design has no tokens.css.');
  assert.equal(findingMessage(f(undefined)), 'design.json declares tweaks, but the design has no tokens.css.');
});

test('tweak-broken params survive check.json parsing; a forged reason or field is dropped', () => {
  const base = goodReport();
  base.static = {
    findings: [
      { code: 'tweak-broken', file: 'design.json', screen: null, viewport: null, params: { tweak: 'missing', field: '--accent-h' } },
      { code: 'tweak-broken', file: 'design.json', screen: null, viewport: null, params: { tweak: 'no-tokens' } },
      { code: 'tweak-broken', file: 'design.json', screen: null, viewport: null, params: { tweak: 'because I said so', field: '--radius' } },
      { code: 'tweak-broken', file: 'design.json', screen: null, viewport: null, params: { tweak: 'formula', field: 'a b' } },
    ],
  };
  const findings = parseCheckReport(base)?.static.findings;
  assert.ok(findings);
  const first = findings[0];
  assert.ok(first);
  assert.deepEqual(first.params, { tweak: 'missing', field: '--accent-h' });
  assert.deepEqual(findings[1]?.params, { tweak: 'no-tokens' });
  assert.deepEqual(findings[2]?.params, { field: '--radius' });
  assert.deepEqual(findings[3]?.params, { tweak: 'formula' });
  assert.equal('severity' in first, false);
  assert.equal(withMessage(first).message, 'design.json: the tweak for --accent-h names a variable tokens.css does not define.');
});

// ---- Phase 2.5 (documentation/specs/phase-2-5-technical.md §10) ----

const systemFinding = (code: CheckFindingData['code'], params: CheckFindingData['params'] = {}): CheckFindingData => ({ code, file: null, screen: null, viewport: null, params });

test('Phase 2.5: every system code is in the closed table, with the spec severity', () => {
  const expected: Record<string, 'error' | 'warning' | 'info'> = {
    'system-drift': 'warning',
    'system-copy-missing': 'warning',
    'system-copy-invalid': 'warning',
    'system-choice': 'warning',
    'system-unreadable': 'error',
    'system-entry-invalid': 'warning',
    'system-value-invalid': 'error',
    'system-font-missing': 'error',
    'system-overview-empty': 'warning',
    'system-overview-long': 'warning',
    'system-note-long': 'warning',
    'system-example-remote': 'error',
    'system-token-undefined': 'warning',
    'system-token-cap': 'warning',
    'system-living-missing': 'warning',
    'system-living-stale': 'warning',
    'system-living-changed': 'warning',
    'system-living-unsafe': 'error',
    'system-living-failed': 'warning',
    'system-repo-unreadable': 'error',
    'system-snapshot-changed': 'warning',
    'system-code-drift': 'warning',
    'system-code-differs': 'warning',
    'system-build-invalid': 'warning',
    'system-coverage-empty': 'warning',
    'system-living-reformatted': 'info',
    'system-living-secret': 'error',
    'system-landed-differs': 'warning',
    'system-proposal-invalid': 'warning',
    'system-layout-invalid': 'warning',
    'system-board-overflow': 'warning',
    'system-board-preview-wide': 'warning',
    'system-board-preview-outside': 'warning',
    'system-board-text-outside': 'warning',
    'system-board-hint-small': 'info',
    'system-board-partial': 'info',
    // system-builder-depth §4.5: example-missing and coverage-gap are warnings only with `depth: full` (severityOf).
    'system-example-missing': 'info',
    'system-states-missing': 'warning',
    'system-contrast-low': 'warning',
    'system-coverage-gap': 'info',
  };
  for (const [code, severity] of Object.entries(expected)) {
    assert.ok(isCheckCode(code), code);
    assert.equal(severityOf(code as CheckFindingData['code']), severity, code);
  }
  assert.equal(CHECK_CODES.filter((code) => code.startsWith('system-')).length, Object.keys(expected).length);
});

test('Phase 2.5: a secret on a dev-only living page is a warning; public or unknown access is an error', () => {
  assert.equal(severityOf('system-living-secret', { access: 'dev' }), 'warning');
  assert.equal(severityOf('system-living-secret', { access: 'public' }), 'error');
  assert.equal(severityOf('system-living-secret'), 'error');
  // Only this code reads `access`: it never lowers another code.
  assert.equal(severityOf('system-living-unsafe', { access: 'dev' }), 'error');
  assert.equal(withMessage(systemFinding('system-living-secret', { access: 'dev', kind: 'aws-key', count: 1 })).severity, 'warning');
});

test('Phase 2.5: system sentences follow the spec copy', () => {
  const m = (code: CheckFindingData['code'], params: CheckFindingData['params'] = {}): string => findingMessage(systemFinding(code, params));
  assert.equal(
    m('system-drift', { system: 'Acme', count: 3, revision: 6 }),
    "This design's copy of Acme was changed: 3 tokens differ from revision 6. Put them back, or keep them as this design's own overrides.",
  );
  assert.equal(m('system-copy-missing', { system: 'Acme', count: 2 }), "This design's copy of Acme is missing 2 files.");
  assert.equal(m('system-copy-invalid'), "system/COPY.json can't be read, so Design Chamber can't tell which system this design uses.");
  assert.equal(m('system-choice', { value: 'x', choice: 'unknown' }), 'design.json asks for the design system "x", which isn\'t a Ready system in this Designs folder.');
  assert.equal(m('system-choice', { value: 'x', choice: 'draft' }), 'design.json asks for the design system "x", which isn\'t ready yet.');
  assert.equal(m('system-living-missing', { system: 'Acme', repo: 'shop' }), 'Acme lives in shop but has no living page yet.');
  assert.equal(m('system-living-stale', { system: 'Acme', from: 5, revision: 7 }), 'The living page was generated from revision 5; Acme is at revision 7.');
  assert.equal(m('system-living-unsafe'), "The living page has markup Design Chamber didn't generate and can't check as safe.");
  assert.equal(m('system-living-failed', { failed: 'secret' }), "Design Chamber couldn't generate the living page: it would show something shaped like a secret.");
  assert.equal(m('system-repo-unreadable', { repo: 'shop' }), "Design Chamber can't read shop's design system folder. Choose another folder on the system page.");
  assert.equal(m('system-snapshot-changed', { system: 'Acme', repo: 'shop' }), "Acme's snapshot was changed outside Design Chamber. Re-sync to read shop again.");
  assert.equal(m('system-code-drift', { system: 'Acme', count: 3 }), 'In CSS variables and token JSON, 3 tokens differ from Acme. Ask the agent to reconcile.');
  assert.match(m('system-code-differs', { system: 'Acme', count: 12, unread: 2 }), /^In CSS variables and token JSON, 12 tokens still differ from what Acme describes\. Design Chamber can't read 2 token files/);
  assert.equal(m('system-coverage-empty', { system: 'Acme', area: 'patterns' }), 'Acme covers Patterns & voice but has nothing there yet.');
  assert.equal(m('system-living-reformatted'), 'The living page may have been reformatted since it was generated. Its values are current.');
  assert.equal(
    m('system-living-secret', { kind: 'aws-key', count: 1 }),
    'The living page shows something shaped like a secret (an AWS key). Remove it from the system.',
  );
  assert.equal(m('system-landed-differs', { repo: 'shop', count: 2 }), 'What landed in shop differs from the proposal you approved in 2 files.');
  assert.equal(m('system-landed-differs', { repo: 'shop', part: 'docs' }), 'The agent says it applied docs, but Design Chamber found none in shop.');
  assert.match(m('system-build-invalid', { build: 'repo-outside-project' }), /^BUILD\.json can't be used: The repo must be the project this chat is in, or a folder inside it\. To use a folder above it/);
  assert.equal(m('system-proposal-invalid', { proposal: 'describe-change' }), "PROPOSAL.json can't be used: Describe only never changes the app's code.");
  assert.equal(
    findingMessage({ code: 'token-redefined', file: 'screens/home.html', screen: 'home', viewport: null, params: { system: 'Acme', count: 3 } }),
    "screens/home.html redefines 3 tokens from the design system Acme. Use the system's values, or ask the user to change the system.",
  );
});

test('Phase 2.5: system params survive parsing only as closed enums or cleaned names', () => {
  const report = goodReport();
  const params = {
    system: 'Acme\nDesign',
    repo: 'shop',
    area: 'patterns',
    kind: 'aws-key',
    access: 'dev',
    part: 'docs',
    choice: 'draft',
    failed: 'secret',
    build: 'home-changed',
    proposal: 'preview-secret',
    revision: 7,
    from: 5,
    unread: 2,
  };
  (report.static as { findings: unknown[] }).findings = [{ code: 'system-living-secret', file: null, screen: null, viewport: null, params }];
  const parsed = parseCheckReport(report);
  const kept = parsed?.static.findings[0]?.params;
  assert.ok(kept);
  assert.equal(kept.system?.includes('\n'), false, 'names are one line');
  assert.deepEqual({ ...kept, system: undefined }, { ...params, system: undefined });

  const forged = { area: 'everything', kind: 'password', access: 'admin', part: 'repo', choice: 'yes', failed: 'boom', build: 'free text', proposal: '<b>', system: '', repo: 42 };
  (report.static as { findings: unknown[] }).findings = [{ code: 'system-living-secret', file: null, screen: null, viewport: null, params: forged }];
  const dropped = parseCheckReport(report)?.static.findings[0];
  assert.ok(dropped);
  assert.equal(dropped.params, undefined, 'every forged param is dropped');
  // A forged `access` can't lower the severity: without it the secret is an error.
  assert.equal(withMessage(dropped).severity, 'error');
});

// ---- board layout hints and the visual system check (§B.6) ----

const boardWidths: Viewport[] = [
  { id: 'wide', label: 'Wide board', width: 1526, height: 900 },
  { id: 'narrow', label: 'Narrow board', width: 1046, height: 900 },
];

test('the seven board codes: severity and sentence come from the table only', () => {
  assert.equal(severityOf('system-layout-invalid'), 'warning');
  assert.equal(severityOf('system-board-overflow'), 'warning');
  assert.equal(severityOf('system-board-preview-wide'), 'warning');
  assert.equal(severityOf('system-board-preview-outside'), 'warning');
  assert.equal(severityOf('system-board-text-outside'), 'warning');
  assert.equal(severityOf('system-board-hint-small'), 'info');
  assert.equal(severityOf('system-board-partial'), 'info');
  const board = (code: CheckFindingData['code'], extra: Partial<CheckFindingData> = {}): CheckFindingData => ({ code, file: 'components/table.html', screen: null, viewport: 'wide', ...extra });
  assert.equal(
    findingMessage(board('system-board-overflow', { file: 'board.html', params: { px: 1600, width: 1526 } }), boardWidths),
    'board.html @ Wide board 1526×900: the board is 1600px wide, wider than the 1526px it has, so it scrolls sideways.',
  );
  assert.equal(
    findingMessage(board('system-board-preview-wide', { params: { px: 1800, width: 692 } }), boardWidths),
    'components/table.html @ Wide board 1526×900: this example is 1800px wide but the board can give it 692px, so it scrolls sideways in its card.',
  );
  assert.equal(
    findingMessage(board('system-board-preview-outside', { params: { px: 40 } }), boardWidths),
    "components/table.html @ Wide board 1526×900: part of this example sits 40px outside its card, so it's cut off or covers other entries.",
  );
  assert.equal(
    findingMessage(board('system-board-text-outside', { params: { px: 12 } }), boardWidths),
    'components/table.html @ Wide board 1526×900: text runs 12px outside its card.',
  );
  assert.equal(
    findingMessage(board('system-board-hint-small', { params: { layout: 'compact' } }), boardWidths),
    'components/table.html @ Wide board 1526×900: this entry is set to compact but needed the full width. Set its layout to full.',
  );
  const partial = (params: CheckParams): string => findingMessage({ code: 'system-board-partial', file: 'board.html', screen: null, viewport: null, params }, boardWidths);
  // One kind per note, singular and plural.
  assert.equal(partial({ pictured: 'tiles', count: 2 }), '2 areas have full-size pictures for only part of their length (the picture limit for one check); their overview shows the rest, and all of the board was measured.');
  assert.equal(partial({ pictured: 'tiles', count: 1 }), '1 area has full-size pictures for only part of its length (the picture limit for one check); its overview shows the rest, and all of the board was measured.');
  assert.equal(partial({ pictured: 'overview', count: 1 }), 'The overview of 1 area stops early; its full-size pictures show the rest, and all of the board was measured.');
  assert.equal(partial({ pictured: 'overview', count: 3 }), 'The overview of 3 areas stops early; their full-size pictures show the rest, and all of the board was measured.');
  assert.equal(partial({ pictured: 'no-overview', count: 1 }), "1 area has no overview picture (it couldn't be made); its full-size pictures show all of it.");
  assert.equal(partial({ pictured: 'gap', count: 1 }), 'Part of 1 area is in no picture (the picture limit for one check); the parts are listed. All of the board was measured, so the findings cover them.');
  assert.equal(partial({ pictured: 'gap', count: 2 }), 'Parts of 2 areas are in no picture (the picture limit for one check); the parts are listed. All of the board was measured, so the findings cover them.');
  assert.equal(partial({ pictured: 'entries', max: 1000 }), 'Only the first 1000 entries were measured.');
  const layout = (params: CheckParams): string => findingMessage({ code: 'system-layout-invalid', file: 'system.json', screen: null, viewport: null, params });
  assert.equal(layout({ count: 2 }), "system.json asks for 2 board layouts Design Chamber doesn't know, so those entries use the default. Each one listed says what its place takes.");
  assert.equal(layout({ count: 2, misplaced: 2 }), "system.json asks for 2 board layouts in places that don't take them, so those entries use the default. Each one listed says what its place takes.");
  assert.equal(
    layout({ count: 3, misplaced: 1 }),
    "system.json asks for 3 board layouts it can't use (2 Design Chamber doesn't know, 1 in places that don't take them), so those entries use the default. Each one listed says what its place takes.",
  );
  // A forged misplaced count above the total is held to it.
  assert.equal(layout({ count: 1, misplaced: 9 }), "system.json asks for 1 board layouts in places that don't take them, so those entries use the default. Each one listed says what its place takes.");
});

test('parseParams keeps misplaced as a number and pictured only from its closed set', () => {
  const report = parseCheckReport({
    version: 1,
    slug: 'demo',
    kind: 'page',
    createdAt: '2026-11-08T10:15:00.000Z',
    tool: 'cli',
    static: {
      findings: [
        { code: 'system-layout-invalid', file: 'system.json', screen: null, viewport: null, params: { count: 2, misplaced: 1 } },
        { code: 'system-board-partial', file: 'board.html', screen: null, viewport: null, params: { pictured: 'tiles', count: 1 } },
        { code: 'system-board-partial', file: 'board.html', screen: null, viewport: null, params: { pictured: 'gap', count: 1 } },
        { code: 'system-board-partial', file: 'board.html', screen: null, viewport: null, params: { pictured: 'everything', count: 1 } },
      ],
    },
    render: null,
  });
  assert.ok(report !== null);
  assert.deepEqual(report.static.findings.map((finding) => finding.params), [{ count: 2, misplaced: 1 }, { pictured: 'tiles', count: 1 }, { pictured: 'gap', count: 1 }, { count: 1 }]);
});

test('parseParams keeps layout only from the closed set; a forged value never reaches the sentence', () => {
  const report = parseCheckReport({
    version: 1,
    slug: 'demo',
    kind: 'page',
    createdAt: '2026-11-08T10:15:00.000Z',
    tool: 'cli',
    static: { findings: [] },
    render: {
      state: 'done',
      browser: 'chrome',
      keys: { design: sha('a'), entries: {} },
      artboards: [],
      skipped: 0,
      findings: [
        { code: 'system-board-hint-small', file: 'components/a.html', screen: null, viewport: 'wide', params: { layout: 'compact' } },
        { code: 'system-board-hint-small', file: 'components/b.html', screen: null, viewport: 'wide', params: { layout: 'wide' } },
        { code: 'system-board-hint-small', file: 'components/c.html', screen: null, viewport: 'wide', params: { layout: 7 } },
      ],
    },
  });
  assert.ok(report !== null && report.render !== null);
  assert.deepEqual(report.render.findings.map((finding) => finding.params), [{ layout: 'compact' }, undefined, undefined]);
  assert.equal(findingMessage(report.render.findings[1] as CheckFindingData, boardWidths), 'components/b.html @ Wide board 1526×900: this entry is set to card but needed the full width. Set its layout to full.');
});
