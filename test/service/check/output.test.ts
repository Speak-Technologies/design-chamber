import assert from 'node:assert/strict';
import { mkdir, readdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { test } from 'node:test';

import { CheckOutputError, cleanupRuns, createRunDir, ensureCheckDir, isRunId, newRunId, pngNames, pngRelOf, pngStem, writeCheckReport, writePng } from '../../../src/service/check/output.ts';
import { parseCheckReportText } from '../../../src/shared/checks.ts';
import type { CheckReport } from '../../../src/shared/types.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const report = (): CheckReport => ({ version: 1, slug: 'demo', kind: 'page', createdAt: '2026-11-08T10:15:00.000Z', tool: 'cli', static: { findings: [] }, render: null });

test('run ids and png names', () => {
  const id = newRunId(new Date('2026-11-08T10:15:00.000Z'), () => 'a1b2c3');
  assert.equal(id, 'r-20261108101500-a1b2c3');
  assert.ok(isRunId(id));
  assert.ok(!isRunId('r-1'));
  assert.ok(!isRunId('../r-20261108101500-a1b2c3'));
  assert.equal(pngStem({ screen: 'home', viewport: 'laptop', slice: 1, slices: 3 }), 'home@laptop');
  assert.equal(pngStem({ screen: 'home', viewport: 'laptop', slice: 2, slices: 3 }), 'home@laptop-2');
  assert.equal(pngStem({ screen: null, viewport: 'laptop', slice: 1, slices: 1 }), 'page@laptop');
  assert.equal(pngStem({ screen: 'a/b', viewport: '..\\x', slice: 1, slices: 1 }), 'a_b@.._x');
  assert.equal(pngRelOf(id, 'a.png'), '.chamber/check/r-20261108101500-a1b2c3/a.png');
});

test('png names stay unique case-insensitively (Laptop and laptop are one file on Windows and macOS)', () => {
  assert.deepEqual(pngNames(['home@Laptop', 'home@laptop', 'home@LAPTOP', 'other@laptop']), ['home@Laptop.png', 'home@laptop-b.png', 'home@LAPTOP-c.png', 'other@laptop.png']);
});

test('ensureCheckDir creates the folders and answers the contained path', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>' });
  const checkDir = await ensureCheckDir(dir);
  assert.equal(checkDir, tmp.at('demo/.chamber/check'));
});

test('a symlinked .chamber is refused, so nothing is written outside the design', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>' });
  await mkdir(tmp.at('elsewhere'));
  await symlink(tmp.at('elsewhere'), tmp.at('demo/.chamber'), 'dir');
  await assert.rejects(() => ensureCheckDir(dir), CheckOutputError);
  await assert.rejects(() => writeCheckReport(dir, report()), CheckOutputError);
  await assert.rejects(() => createRunDir(dir, 'r-20261108101500-a1b2c3'), CheckOutputError);
  assert.deepEqual(await readdir(tmp.at('elsewhere')), []);
});

test('a symlinked .chamber/check is refused', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>' });
  await mkdir(tmp.at('demo/.chamber'));
  await mkdir(tmp.at('elsewhere'));
  await symlink(tmp.at('elsewhere'), tmp.at('demo/.chamber/check'), 'dir');
  await assert.rejects(() => createRunDir(dir, 'r-20261108101500-a1b2c3'), CheckOutputError);
  assert.deepEqual(await readdir(tmp.at('elsewhere')), []);
});

test('a plain file where .chamber should be is refused', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>', '.chamber': 'oops' });
  await assert.rejects(() => ensureCheckDir(dir), CheckOutputError);
});

test('png names that try to leave the run folder are refused by containment', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>' });
  await createRunDir(dir, 'r-20261108101500-a1b2c3');
  await assert.rejects(() => writePng(dir, 'r-20261108101500-a1b2c3', '../../../index.html', new Uint8Array([1])), /leave|step up|Only paths/);
  await assert.rejects(() => writePng(dir, '../..', 'x.png', new Uint8Array([1])), /leave|step up|Only paths/);
  assert.equal(await tmp.read('demo/index.html'), '<p>x</p>');
  const written = await writePng(dir, 'r-20261108101500-a1b2c3', 'home@laptop.png', new Uint8Array([1, 2, 3]));
  assert.equal(written, tmp.at('demo/.chamber/check/r-20261108101500-a1b2c3/home@laptop.png'));
});

test('the report is written atomically as valid JSON the service can read back', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>' });
  const file = await writeCheckReport(dir, report());
  assert.equal(file, tmp.at('demo/.chamber/check.json'));
  assert.ok(parseCheckReportText(await tmp.read('demo/.chamber/check.json')));
  assert.deepEqual((await readdir(tmp.at('demo/.chamber'))).sort(), ['check.json']);
});

test('cleanup keeps the new run and young runs, removes old ones, and touches nothing else', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>' });
  const names = ['r-20261108100000-aaaaaa', 'r-20261108100100-bbbbbb', 'r-20261108100200-cccccc'];
  for (const name of names) await createRunDir(dir, name);
  await writeFile(tmp.at('demo/.chamber/check/keepme.txt'), 'x');
  await mkdir(tmp.at('demo/.chamber/check/not-a-run'));
  const now = Date.now();
  const old = new Date(now - 10 * 60_000);
  await utimes(tmp.at(`demo/.chamber/check/${names[0]}`), old, old);
  await utimes(tmp.at(`demo/.chamber/check/${names[1]}`), old, old);
  const removed = await cleanupRuns(dir, new Set([names[1] as string]), now);
  assert.deepEqual(removed, [names[0]]);
  assert.deepEqual((await readdir(tmp.at('demo/.chamber/check'))).sort(), [names[1], names[2], 'keepme.txt', 'not-a-run'].sort());
});
