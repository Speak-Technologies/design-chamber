import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { test } from 'node:test';

import { docHygiene, entryKeyOf, runStaticChecks, screenSetFindings, tokenFindings } from '../../../src/service/check/static.ts';
import { parseDesignJsonText } from '../../../src/shared/design-json.ts';
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
