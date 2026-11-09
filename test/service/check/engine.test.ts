// runCheck without a browser, with --static, and with bad input: the paths that never start Chrome.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';

import { CheckUsageError, runCheck, type RunCheckInput } from '../../../src/service/check/engine.ts';
import { allFindings, exitCodeOf, formatCheckText, jsonOutput, parseArgs, resultLine } from '../../../src/service/check/report-text.ts';
import { parseCheckReportText } from '../../../src/shared/checks.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const GOOD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Home</title></head><body><p>Hi</p></body></html>';
const designJson = (kind: 'canvas' | 'page', ids: string[] = ['home']): object => ({
  version: 1,
  kind,
  title: 'Demo',
  created: '2026-11-01T10:00:00.000Z',
  updated: '2026-11-01T10:00:00.000Z',
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
  screens: kind === 'canvas' ? ids.map((id) => ({ id, title: id, file: `screens/${id}.html` })) : [],
  designSystem: { confirmed: false },
});
const input = (dir: string, over: Partial<RunCheckInput> = {}): RunCheckInput => ({
  designDir: dir,
  slug: 'demo',
  tool: 'cli',
  browserPath: null,
  probeSource: '',
  platform: process.platform,
  isRoot: false,
  now: () => new Date('2026-11-08T10:15:00.000Z'),
  ...over,
});

test('no browser: the render is "unavailable" with a note, the report is written, and the exit follows the files', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'design.json': designJson('canvas'), 'screens/home.html': GOOD });
  const result = await runCheck(input(dir));
  assert.equal(result.report.render?.state, 'unavailable');
  assert.equal(result.report.render?.browser, null);
  assert.deepEqual(result.report.render?.findings.map((finding) => finding.code), ['browser-missing']);
  assert.equal(result.pngs.length, 0);
  assert.ok(parseCheckReportText(await tmp.read('demo/.chamber/check.json')));
  assert.equal(exitCodeOf(allFindings(result.report, result.design.viewports)), 0);
  const text = formatCheckText({ report: result.report, design: result.design, pngs: [], reportPath: result.reportPath });
  assert.match(text, /No Chrome, Edge or Chromium was found, so nothing was rendered\. The file checks above still apply\./);
  assert.ok(!text.includes('Look at your work'));
  // With an error in the files the exit is 1 even though nothing rendered.
  await tmp.write('demo/design.json', designJson('canvas', ['home', 'gone']));
  const broken = await runCheck(input(dir));
  assert.equal(exitCodeOf(allFindings(broken.report, broken.design.viewports)), 1);
});

test('--static writes nothing and has no render part', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'design.json': designJson('page', []), 'index.html': GOOD });
  const result = await runCheck(input(dir, { staticOnly: true, browserPath: '/usr/bin/never-started' }));
  assert.equal(result.report.render, null);
  assert.equal(result.reportPath, null);
  assert.equal((await readdir(dir)).includes('.chamber'), false);
});

test('an unknown screen, or a screen filter on a page, is a usage error', async (t) => {
  const tmp = await useTmpRoot(t);
  const canvas = await tmp.writeDesign('canvas', { 'design.json': designJson('canvas'), 'screens/home.html': GOOD });
  await assert.rejects(() => runCheck(input(canvas, { screens: ['nope'], staticOnly: true })), (error: unknown) => error instanceof CheckUsageError && error.message === 'There is no screen "nope" in this design.');
  const page = await tmp.writeDesign('page', { 'design.json': designJson('page', []), 'index.html': GOOD });
  await assert.rejects(() => runCheck(input(page, { screens: ['home'], staticOnly: true })), CheckUsageError);
});

test('a browser that cannot be driven is a "failed" render with a way forward, not a crash', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'design.json': designJson('canvas'), 'screens/home.html': GOOD });
  // `true` starts and exits at once: the pipe closes, so it never answers Browser.getVersion.
  const result = await runCheck(input(dir, { browserPath: process.platform === 'win32' ? 'cmd.exe' : '/bin/true' }));
  assert.equal(result.report.render?.state, 'failed');
  const failure = result.report.render?.findings.find((finding) => finding.code === 'render-failed');
  assert.equal(failure?.detail, "This browser build can't be driven. Set another browser in Settings.");
  assert.equal(failure?.file, null);
  const text = formatCheckText({ report: result.report, design: result.design, pngs: [], reportPath: result.reportPath });
  assert.match(text, /This design could not be rendered\./);
});

test('result line wording', () => {
  assert.equal(resultLine({ errors: 0, warnings: 0, notes: 0 }), 'Result: no errors or warnings.');
  assert.equal(resultLine({ errors: 1, warnings: 2, notes: 0 }), 'Result: 1 error, 2 warnings.');
  assert.equal(resultLine({ errors: 0, warnings: 0, notes: 3 }), 'Result: no errors or warnings, 3 notes.');
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['check', 'demo']), { kind: 'check', root: null, target: 'demo', screens: [], staticOnly: false, json: false });
  assert.deepEqual(parseArgs(['--root', '/d', 'check', 'demo', '--screen', 'a', '--screen=b', '--static', '--json']), { kind: 'check', root: '/d', target: 'demo', screens: ['a', 'b'], staticOnly: true, json: true });
  assert.deepEqual(parseArgs(['--root=/d', 'check', 'demo']), { kind: 'check', root: '/d', target: 'demo', screens: [], staticOnly: false, json: false });
  assert.equal(parseArgs([]).kind, 'help');
  assert.equal(parseArgs(['-h']).kind, 'help');
  assert.equal(parseArgs(['--root', 'a', '--root', 'b', 'check', 'x']).kind, 'error');
  assert.equal(parseArgs(['--root']).kind, 'error');
  assert.equal(parseArgs(['check']).kind, 'error');
  assert.equal(parseArgs(['check', 'a', 'b']).kind, 'error');
  assert.equal(parseArgs(['check', 'a', '--bogus']).kind, 'error');
  assert.equal(parseArgs(['run', 'a']).kind, 'error');
  assert.equal(parseArgs(['check', 'a', '--screen']).kind, 'error');
});

test('KI-8: when errors fill the budget no empty "Warnings" heading follows', async (t) => {
  const tmp = await useTmpRoot(t);
  const ids = Array.from({ length: 11 }, (_, i) => `s${i}`);
  const files: Record<string, string> = { 'design.json': designJson('canvas', ids) as never };
  // 33 remote files (errors) and a missing title in every screen (warnings).
  for (const id of ids) files[`screens/${id}.html`] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${[1, 2, 3].map((n) => `<img alt="" src="https://a.example/${id}-${n}.png">`).join('')}</body></html>`;
  const dir = await tmp.writeDesign('demo', files);
  const result = await runCheck(input(dir, { staticOnly: true }));
  const text = formatCheckText({ report: result.report, design: result.design, pngs: [], reportPath: '/x/check.json' });
  assert.equal(text.split('\n').filter((line) => /^ {2}\d+\. /.test(line)).length, 30);
  assert.ok(text.includes('\nErrors\n'));
  assert.ok(!text.includes('\nWarnings\n'), 'a heading with nothing under it reads as "no warnings"');
  assert.match(text, /\nand 14 more in \/x\/check\.json\n/);
});

test('the text report caps at 30 findings and points at the full report', async (t) => {
  const tmp = await useTmpRoot(t);
  const files: Record<string, string> = { 'design.json': designJson('canvas', Array.from({ length: 12 }, (_, i) => `s${i}`)) as never };
  for (let i = 0; i < 12; i += 1) files[`screens/s${i}.html`] = '<html><body><img src="https://a.example/1.png"><img src="https://a.example/2.png"><img src="https://a.example/3.png"></body></html>';
  const dir = await tmp.writeDesign('demo', files);
  const result = await runCheck(input(dir, { staticOnly: true }));
  const text = formatCheckText({ report: result.report, design: result.design, pngs: [], reportPath: '/x/check.json' });
  const numbered = text.split('\n').filter((line) => /^ {2}\d+\. /.test(line));
  assert.equal(numbered.length, 30);
  assert.match(text, /\nand \d+ more in \/x\/check\.json\n/);
  assert.ok(jsonOutput({ report: result.report, design: result.design, pngs: [], reportPath: null }).includes('"counts"'));
});
