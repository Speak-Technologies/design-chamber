import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { test } from 'node:test';

import { docHygiene, entryKeyOf, runStaticChecks, screenSetFindings, tokenFindings, tweakFindings } from '../../../src/service/check/static.ts';
import { parseDesignJsonText } from '../../../src/shared/design-json.ts';
import type { Tweak } from '../../../src/shared/types.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const GOOD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Home</title></head><body><p>Hi</p></body></html>';
const designJson = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  kind: 'canvas',
  title: 'Demo',
  created: '2026-11-01T10:00:00.000Z',
  updated: '2026-11-01T10:00:00.000Z',
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
  screens: [{ id: 'home', title: 'Home', file: 'screens/home.html' }],
  ...extra,
});
const codesOf = (findings: { code: string }[]): string[] => findings.map((finding) => finding.code).sort();

test('docHygiene: a complete document has no findings; each missing piece has its code', () => {
  assert.deepEqual(docHygiene(GOOD), []);
  assert.deepEqual(docHygiene('<html><head></head><body></body></html>').sort(), ['doc-charset', 'doc-doctype', 'doc-lang', 'doc-title', 'doc-viewport']);
  assert.deepEqual(docHygiene(GOOD.replace('<!doctype html>', '')), ['doc-doctype']);
  assert.deepEqual(docHygiene(GOOD.replace(' lang="en"', '')), ['doc-lang']);
  assert.deepEqual(docHygiene(GOOD.replace('<title>Home</title>', '<title>  </title>')), ['doc-title']);
  assert.deepEqual(docHygiene(GOOD.replace('<meta charset="utf-8">', '')), ['doc-charset']);
});

test('docHygiene is tolerant: BOM, upper case, attribute order, single quotes; comments are skipped', () => {
  assert.deepEqual(docHygiene('﻿<!DOCTYPE HTML><HTML LANG=en><HEAD><META CONTENT="text/html" HTTP-EQUIV="Content-Type"><meta content="width=1" name=\'viewport\'><TITLE>x</TITLE></HEAD></HTML>'), []);
  assert.ok(docHygiene(`<!-- <title>fake</title> <meta name="viewport"> -->${GOOD.replace('<title>Home</title>', '').replace('<meta name="viewport" content="width=device-width">', '')}`).includes('doc-title'));
});

test('tokenFindings: redefinitions, hardcoded colours, and what is not counted', () => {
  const tokensCss = ':root { --bg: #fff; --fg: #111; --space: 8px; }';
  const html = '<style>:root{--bg:#000;--other:1} .a{color:#123456;background:rgb(1,2,3);border:1px solid #abc;margin:var(--space)} .b{color:var(--fg,#ff0000)}</style><p style="color:hsl(10 20% 30%)">';
  const result = tokenFindings({ tokensCss, html });
  assert.deepEqual(result.redefined, ['--bg']);
  assert.equal(result.tokensHaveColors, true);
  assert.deepEqual(result.literals, ['#123456', 'rgb(', '#abc', 'hsl(']);
  assert.equal(tokenFindings({ tokensCss: ':root{--space:8px}', html }).tokensHaveColors, false);
  assert.deepEqual(tokenFindings({ tokensCss, html: '<style>.a{color:var(--fg,#ff0000);--bg:red}</style>' }).literals, []);
});

test('screenSetFindings: missing file, unlisted file, per-viewport copies', () => {
  const { design } = parseDesignJsonText(JSON.stringify(designJson({ screens: [{ id: 'home', file: 'screens/home.html' }, { id: 'ghost', file: 'screens/ghost.html' }] })), { kind: 'canvas', fallbackTitle: 'x', fallbackTime: new Date(0).toISOString() });
  const findings = screenSetFindings({ design, screenFiles: ['screens/home.html', 'screens/home-phone.html', 'screens/extra.html'] });
  assert.deepEqual(
    findings.map((finding) => `${finding.code}:${finding.file}`).sort(),
    ['screen-file-missing:screens/ghost.html', 'screen-per-viewport:screens/home-phone.html', 'screen-unlisted:screens/extra.html', 'screen-unlisted:screens/home-phone.html'],
  );
  assert.equal(findings.find((finding) => finding.code === 'screen-per-viewport')?.params?.base, 'home');
  assert.deepEqual(screenSetFindings({ design: null, screenFiles: ['screens/a.html'] }), []);
});

test('entryKeyOf changes with a size, an mtime or a file; not with order', () => {
  const a = { rel: 'screens/a.html', size: 10, mtimeMs: 1 };
  const b = { rel: 'assets/x.png', size: 5, mtimeMs: 2 };
  const key = entryKeyOf('screens/a.html', [a, b]);
  assert.equal(entryKeyOf('screens/a.html', [b, a]), key);
  assert.notEqual(entryKeyOf('screens/a.html', [{ ...a, size: 11 }, b]), key);
  assert.notEqual(entryKeyOf('screens/a.html', [a, { ...b, mtimeMs: 3 }]), key);
  assert.notEqual(entryKeyOf('screens/a.html', [a]), key);
  assert.notEqual(entryKeyOf('screens/b.html', [a, b]), key);
});

test('runStaticChecks: a clean canvas has no findings and a key per screen', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('clean', { 'design.json': designJson(), 'screens/home.html': GOOD });
  const run = await runStaticChecks(dir, 10_000);
  assert.deepEqual(run.findings, []);
  assert.equal(run.kind, 'canvas');
  assert.deepEqual(Object.keys(run.keys.entries), ['screens/home.html']);
  assert.equal(run.keys.design.length, 64);
  assert.deepEqual(run.entries, [{ rel: 'screens/home.html', screen: 'home' }]);
  assert.equal(run.partial, false);
});

test('runStaticChecks: missing and broken design.json', async (t) => {
  const tmp = await useTmpRoot(t);
  const missing = await runStaticChecks(await tmp.writeDesign('nojson', { 'screens/a.html': GOOD }), 10_000);
  assert.deepEqual(codesOf(missing.findings), ['design-json-missing']);
  assert.equal(missing.kind, 'canvas');
  const broken = await runStaticChecks(await tmp.writeDesign('broken', { 'design.json': '{ "kind": ', 'index.html': GOOD }), 10_000);
  assert.deepEqual(codesOf(broken.findings), ['design-json-invalid']);
  assert.ok(broken.findings[0]?.detail);
  const field = await runStaticChecks(await tmp.writeDesign('field', { 'design.json': designJson({ viewports: [{ id: 'laptop', width: 'wide', height: 800 }] }), 'screens/home.html': GOOD }), 10_000);
  assert.ok(field.findings.some((finding) => finding.code === 'design-json-field' && finding.params?.field !== undefined));
});

test('runStaticChecks: files, references, hygiene and tokens in one canvas', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('messy', {
    'design.json': designJson({ screens: [{ id: 'home', file: 'screens/home.html' }, { id: 'gone', file: 'screens/gone.html' }] }),
    'tokens.css': ':root{--bg:#fff;--fg:#111}',
    'screens/home.html':
      '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="missing.css"><style>:root{--bg:#000} p{color:#111;background:#222;border-color:#333}</style></head><body><img src="../../outside.png"><script type="module">import "./a.js"</script></body></html>',
    'screens/extra.html': GOOD,
  });
  const run = await runStaticChecks(dir, 10_000);
  const codes = codesOf(run.findings);
  for (const code of ['screen-file-missing', 'screen-unlisted', 'remote-ref', 'ref-missing', 'ref-outside', 'module-import', 'doc-doctype', 'doc-lang', 'doc-viewport', 'doc-title', 'doc-charset', 'token-redefined', 'token-hardcoded']) {
    assert.ok(codes.includes(code), `missing ${code} in ${codes.join(',')}`);
  }
  const remote = run.findings.find((finding) => finding.code === 'remote-ref');
  assert.equal(remote?.file, 'screens/home.html');
  assert.equal(remote?.detail, 'https://fonts.googleapis.com/css2?family=Inter');
  assert.equal(run.findings.find((finding) => finding.code === 'token-redefined')?.detail, '--bg');
});

test('runStaticChecks: a page without index.html', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('empty', { 'design.json': designJson({ kind: 'page', screens: [] }) });
  const run = await runStaticChecks(dir, 10_000);
  assert.deepEqual(codesOf(run.findings), ['entry-missing']);
  assert.deepEqual(run.entries, []);
});

test('runStaticChecks: a time budget of zero stops after the document list and says so', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('slow', { 'design.json': designJson(), 'screens/home.html': GOOD });
  let now = 0;
  const run = await runStaticChecks(dir, 5, () => (now += 10));
  assert.equal(run.partial, true);
  assert.ok(codesOf(run.findings).includes('check-partial'));
});

test('runStaticChecks never reads through a link that leaves the design folder', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('linked', { 'design.json': designJson(), 'screens/home.html': `${GOOD}<img src="../shared/notes.png">` });
  await tmp.write('secret/notes.png', 'x');
  await symlink(tmp.at('secret'), tmp.at('linked/shared'), 'dir');
  const run = await runStaticChecks(dir, 10_000);
  assert.ok(run.findings.some((finding) => finding.code === 'ref-outside'), 'the linked file is reported as outside');
  assert.ok(!run.findings.some((finding) => finding.code === 'ref-missing'));
});

test('a linked screens folder lists nothing, so its file names never reach a finding', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('secret/private-notes.html', GOOD);
  const dir = await tmp.writeDesign('linked2', { 'design.json': designJson({ kind: 'canvas', screens: [] }) });
  await symlink(tmp.at('secret'), tmp.at('linked2/screens'), 'dir');
  const run = await runStaticChecks(dir, 10_000);
  assert.deepEqual(run.entries, []);
  assert.ok(!JSON.stringify(run.findings).includes('private-notes'));
});

// ---- broken knobs (Phase 2 §4.7) ----

const KNOB_RADIUS: Tweak = { var: '--radius', label: 'Corner radius', kind: 'number', min: 0, max: 24, step: 2, unit: 'px' };
const KNOB_HUE: Tweak = { var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '' };
const KNOB_DENSITY: Tweak = { var: '--density', label: 'Density', kind: 'choice', options: [{ label: 'Compact', value: '0.85' }, { label: 'Comfortable', value: '1' }] };
const ALL_KNOBS: Tweak[] = [KNOB_RADIUS, KNOB_HUE, KNOB_DENSITY];
const GOOD_TOKENS = ':root{--radius:8px;--accent-h:210;--density:1}';
const brokenOf = (findings: { code: string; params?: { tweak?: string; field?: string } }[]): { tweak: string | undefined; field: string | undefined }[] =>
  findings.filter((finding) => finding.code === 'tweak-broken').map((finding) => ({ tweak: finding.params?.tweak, field: finding.params?.field }));

test('tweakFindings: knobs the file serves produce nothing, including a choice value outside the options', () => {
  assert.deepEqual(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: GOOD_TOKENS }), []);
  assert.deepEqual(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--radius:8px;--accent-h:210;--density:1.2}' }), []);
  assert.deepEqual(tweakFindings({ tweaks: [], tokensCss: GOOD_TOKENS }), []);
  assert.deepEqual(tweakFindings({ tweaks: [], tokensCss: null }), []);
});

test('tweakFindings: a missing variable and a formula are named; a unit mismatch is named', () => {
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--radius:8px;--density:1}' })), [{ tweak: 'missing', field: '--accent-h' }]);
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--radius:calc(4px * 2);--accent-h:210;--density:1}' })), [{ tweak: 'formula', field: '--radius' }]);
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--radius:var(--base);--accent-h:210;--density:1}' })), [{ tweak: 'formula', field: '--radius' }]);
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--radius: 8px /* base */;--accent-h:210;--density:1}' })), [{ tweak: 'formula', field: '--radius' }]);
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--radius:8px !important;--accent-h:210;--density:1}' })), [{ tweak: 'formula', field: '--radius' }]);
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--radius:0.5rem;--accent-h:210;--density:1}' })), [{ tweak: 'unit', field: '--radius' }]);
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: [KNOB_DENSITY], tokensCss: ':root{--density:rgb(1 2 3)}' })), [{ tweak: 'formula', field: '--density' }]);
});

test('tweakFindings: only a top-level :root declaration serves a knob; the last one wins', () => {
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: [KNOB_RADIUS], tokensCss: '@media (min-width: 1px){:root{--radius:8px}}' })), [{ tweak: 'missing', field: '--radius' }]);
  assert.deepEqual(tweakFindings({ tweaks: [KNOB_RADIUS], tokensCss: ':root{--radius:4px} :root{--radius:8px}' }), []);
  assert.deepEqual(brokenOf(tweakFindings({ tweaks: [KNOB_RADIUS], tokensCss: ':root{--radius:8px} :root{--radius:calc(4px * 2)}' })), [{ tweak: 'formula', field: '--radius' }]);
});

test('tweakFindings: no tokens.css is one design-level finding, however many knobs there are', () => {
  const findings = tweakFindings({ tweaks: ALL_KNOBS, tokensCss: null });
  assert.deepEqual(findings, [{ code: 'tweak-broken', file: 'design.json', screen: null, viewport: null, params: { tweak: 'no-tokens' } }]);
});

test('tweakFindings: several broken knobs each get their own finding', () => {
  const findings = tweakFindings({ tweaks: ALL_KNOBS, tokensCss: ':root{--density:1}' });
  assert.deepEqual(brokenOf(findings), [{ tweak: 'missing', field: '--radius' }, { tweak: 'missing', field: '--accent-h' }]);
  for (const finding of findings) {
    assert.equal(finding.file, 'design.json');
    assert.equal(finding.screen, null);
    assert.equal(finding.viewport, null);
  }
});

test('runStaticChecks: broken knobs are reported against design.json, valid ones stay silent', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('tweaks', {
    'design.json': designJson({ tweaks: ALL_KNOBS }),
    'tokens.css': ':root{--radius:calc(4px * 2);--density:1}',
    'screens/home.html': GOOD,
  });
  const run = await runStaticChecks(dir, 10_000);
  assert.deepEqual(brokenOf(run.findings), [{ tweak: 'formula', field: '--radius' }, { tweak: 'missing', field: '--accent-h' }]);
  const clean = await runStaticChecks(await tmp.writeDesign('tweaks-ok', { 'design.json': designJson({ tweaks: ALL_KNOBS }), 'tokens.css': GOOD_TOKENS, 'screens/home.html': GOOD }), 10_000);
  assert.deepEqual(clean.findings, []);
});

test('runStaticChecks: a page design reports broken knobs the same way', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('tweak-page', { 'design.json': designJson({ kind: 'page', screens: [], tweaks: [KNOB_HUE] }), 'tokens.css': ':root{--other:1}', 'index.html': GOOD });
  const run = await runStaticChecks(dir, 10_000);
  assert.deepEqual(brokenOf(run.findings), [{ tweak: 'missing', field: '--accent-h' }]);
});

test('runStaticChecks: tweaks without tokens.css is one finding; no tweaks never reports one', async (t) => {
  const tmp = await useTmpRoot(t);
  const noFile = await runStaticChecks(await tmp.writeDesign('no-tokens', { 'design.json': designJson({ tweaks: ALL_KNOBS }), 'screens/home.html': GOOD }), 10_000);
  assert.deepEqual(brokenOf(noFile.findings), [{ tweak: 'no-tokens', field: undefined }]);
  const noKnobs = await runStaticChecks(await tmp.writeDesign('no-knobs', { 'design.json': designJson(), 'screens/home.html': GOOD }), 10_000);
  assert.deepEqual(brokenOf(noKnobs.findings), []);
  const oldDesign = await runStaticChecks(await tmp.writeDesign('old', { 'design.json': designJson(), 'tokens.css': GOOD_TOKENS, 'screens/home.html': GOOD }), 10_000);
  assert.deepEqual(oldDesign.findings, []);
});

test('runStaticChecks: an invalid knob definition is a design.json warning, not a broken-knob finding', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('bad-knob', { 'design.json': designJson({ tweaks: [{ var: '--x', label: 'X', kind: 'slider' }] }), 'tokens.css': GOOD_TOKENS, 'screens/home.html': GOOD });
  const run = await runStaticChecks(dir, 10_000);
  assert.deepEqual(brokenOf(run.findings), []);
  assert.ok(run.findings.some((finding) => finding.code === 'design-json-field' && finding.params?.field === 'tweaks[0]'));
});

test('runStaticChecks: the per-code cap keeps at most five broken-knob findings', async (t) => {
  const tmp = await useTmpRoot(t);
  const knobs: Tweak[] = Array.from({ length: 7 }, (_, index) => ({ var: `--k${index}`, label: `Knob ${index}`, kind: 'number', min: 0, max: 10, step: 1, unit: '' }));
  const dir = await tmp.writeDesign('many-broken', { 'design.json': designJson({ tweaks: knobs }), 'tokens.css': ':root{--other:1}', 'screens/home.html': GOOD });
  const run = await runStaticChecks(dir, 10_000);
  assert.equal(run.findings.filter((finding) => finding.code === 'tweak-broken').length, 5);
});
