// "Register it as it is" over HTTP (documentation/specs/phase-2-6-technical.md §3.1, §5.9, §14 R-1, AD-10):
// the bearer check and the body rules; the happy path (a repo home on the project, a Draft, the first
// snapshot by the user from the scan's own read, no build, no code source, the repo untouched); every
// refusal (not a location scan, an incomplete contract, a running or gone scan, another root, an
// overlap naming the other system, a name taken, no living-page place, a folder gone); the half-made
// cleanup; and the R-1 audit of every repo-home path a registered system (no `state.build`) goes through.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import type { CreateSystemResponse, CreateSystemScanResponse, SystemListResponse, SystemPromptResponse, SystemScanResponse } from '../../../src/shared/api.ts';
import type { SystemDetail, SystemState } from '../../../src/shared/types.ts';
import { renameWithRetry } from '../../../src/service/paths.ts';
import { NOT_A_SYSTEM_SCAN_MESSAGE, SCAN_GONE_MESSAGE } from '../../../src/service/systems/extract.ts';
import { freeLivingPage } from '../../../src/service/systems/register.ts';
import { LOCATION_GONE_SENTENCE } from '../../../src/service/systems/scan-folder.ts';
import { isReadIntact, setSnapshotSwapSeam } from '../../../src/service/systems/snapshot.ts';
import { treeHashOf } from '../../../src/service/versions.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { messageOf, setupLocation, summaryOf } from './location-fixture.ts';
import { fingerprintTree, REPO_FILES } from './repo-fixture.ts';

test('the route refuses a missing or wrong token with 401 and makes nothing', async (t) => {
  const { call, tmp } = await setupLocation(t);
  for (const token of [null, 'wrong-token']) {
    assert.equal((await call('POST', '/systems/register', { scanId: 'sc_abcdefghijklmnop', name: 'Acme' }, token)).status, 401);
  }
  assert.deepEqual(await readdir(tmp.at('Designs')), ['.keep']);
});

test('bodies: an object of exactly scanId and name; an unknown scan is gone', async (t) => {
  const { call, tmp } = await setupLocation(t);
  for (const body of [null, [], 'x', { scanId: 'sc_abcdefghijklmnop', name: 'Acme', directory: '/etc' }]) {
    const answer = await call('POST', '/systems/register', body);
    assert.equal(answer.status, 400, JSON.stringify(body));
  }
  for (const name of ['', '   ', 42, 'a\nb', 'x'.repeat(61)]) {
    assert.equal((await call('POST', '/systems/register', { scanId: 'sc_abcdefghijklmnop', name })).status, 400, JSON.stringify(name));
  }
  for (const scanId of ['sc_abcdefghijklmnop', '../../etc', 42]) {
    const answer = await call('POST', '/systems/register', { scanId, name: 'Acme' });
    assert.equal(answer.status, 404, JSON.stringify(scanId));
    assert.equal(messageOf(answer), SCAN_GONE_MESSAGE);
  }
  assert.deepEqual(await readdir(tmp.at('Designs')), ['.keep']);
});

test('registering a complete system folder: a read-only repo-backed Draft, snapshot by the user, no build, the repo untouched', async (t) => {
  const { call, scan, project, tmp, ctx } = await setupLocation(t);
  const before = await fingerprintTree(project);
  const { scanId } = await scan({ directory: project, location: 'design-system' });
  const made = await call('POST', '/systems/register', { scanId, name: 'Acme' });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const { id, system } = made.json as CreateSystemResponse;
  assert.equal(id, 'acme');
  assert.deepEqual(await fingerprintTree(project), before, 'the repo is exactly as it was');

  const state = JSON.parse(await tmp.read(`Designs/_systems/${id}/.chamber/state.json`)) as SystemState;
  // index.html is taken by the folder's own page, so the living page goes beside it.
  assert.deepEqual(state.home, { kind: 'repo', directory: project, folder: 'design-system', livingPage: 'design-system/living-page.html', adoptedAt: state.home?.kind === 'repo' ? state.home.adoptedAt : '' });
  assert.equal(state.status, 'draft');
  assert.equal(state.build, undefined, 'no ticket, no BUILD.json, no build record');
  assert.equal(state.sources.code, null, 'a registered system has no code source');
  assert.equal(state.snapshot?.by, 'user');
  assert.equal(state.snapshot?.tampered, false);
  assert.equal(state.buildProblem ?? null, null);
  // The snapshot holds the contract files exactly as the repo has them, nothing else.
  const snapshot = (await readdir(tmp.at(`Designs/_systems/${id}/snapshot`), { recursive: true })).map((one) => one.split(path.sep).join('/')).sort();
  for (const rel of ['tokens.css', 'system.json', 'OVERVIEW.md', 'notes/history.md', 'components/button.html', 'assets/logos/acme.svg', 'SNAPSHOT.json']) assert.ok(snapshot.includes(rel), rel);
  for (const rel of ['README.md', 'extra.css', 'index.html', 'sources/deploy.pem']) assert.ok(!snapshot.includes(rel), `${rel} is not in the snapshot`);
  assert.equal(await tmp.read(`Designs/_systems/${id}/snapshot/tokens.css`), REPO_FILES['design-system/tokens.css']);
  const record = JSON.parse(await tmp.read(`Designs/_systems/${id}/snapshot/SNAPSHOT.json`)) as { by: string; folder: string; directory: string };
  assert.deepEqual([record.by, record.folder, record.directory], ['user', 'design-system', project]);
  // Nothing at the top level of the system folder but its own records.
  assert.deepEqual((await readdir(tmp.at(`Designs/_systems/${id}`))).filter((name) => !name.startsWith('.')).sort(), ['snapshot']);

  // The answer and the list read it as a ready-to-review repo system.
  assert.equal(system.home.kind, 'repo');
  assert.ok(system.tokens.some((token) => token.name === '--brand-500'));
  const list = (await call('GET', '/systems')).json as SystemListResponse;
  const row = list.systems.find((one) => one.id === id);
  assert.deepEqual(row?.home, { repo: 'shop', directory: project });
  assert.equal(row?.building, false);
  assert.equal(row?.status, 'draft');
  assert.deepEqual(row?.swatches, ['#1a73e8']);
  assert.ok(ctx.events.some((event) => event.kind === 'system' && event.system === id && event.systemChange === 'added'));

  // Discovery now says so.
  const again = summaryOf((await scan({ directory: project })).answer);
  assert.deepEqual(again.candidates?.find((one) => one.path === 'design-system')?.registered, { id, name: 'Acme' });
});

test('refusals: not a location scan, an incomplete contract, an overlap, a name taken, a gone folder, no living-page place', async (t) => {
  const { call, scan, project, tmp } = await setupLocation(t);
  const register = (scanId: string, name: string) => call('POST', '/systems/register', { scanId, name });

  const whole = await scan({ directory: project });
  const notLocation = await register(whole.scanId, 'Acme');
  assert.equal(notLocation.status, 409);
  assert.equal(messageOf(notLocation), NOT_A_SYSTEM_SCAN_MESSAGE);
  const page = await scan({ directory: project, location: 'app/design-system' });
  assert.equal(summaryOf(page.answer).location?.contract, null);
  assert.equal((await register(page.scanId, 'Acme')).status, 409, 'a Claude-built page is Make only');
  await tmp.write('shop/half/system.json', '{"version":1}\n');
  const half = await scan({ directory: project, location: 'half' });
  assert.equal(messageOf(await register(half.scanId, 'Acme')), NOT_A_SYSTEM_SCAN_MESSAGE);

  const first = await scan({ directory: project, location: 'design-system' });
  assert.equal((await register(first.scanId, 'Acme')).status, 200);
  // The same folder again: P25's overlap sentence, naming the system that has it.
  const second = await scan({ directory: project, location: 'design-system' });
  const overlap = await register(second.scanId, 'Acme two');
  assert.equal(overlap.status, 409);
  assert.equal(messageOf(overlap), 'Acme already uses this repo folder or living-page path.');
  // A name taken ignoring case, in another folder.
  await tmp.write('shop/brand/system.json', '{"version":1}\n');
  await tmp.write('shop/brand/tokens.css', ':root { --a: #fff; }\n');
  const brand = await scan({ directory: project, location: 'brand' });
  const taken = await register(brand.scanId, 'ACME');
  assert.equal(taken.status, 409);
  assert.equal(messageOf(taken), 'You already have a system called Acme.');
  // No place for the living page.
  await tmp.write('shop/brand/index.html', '<p>the user page</p>\n');
  await tmp.write('shop/brand/living-page.html', '<p>another</p>\n');
  const full = await register(brand.scanId, 'Brand');
  assert.equal(full.status, 409);
  assert.equal(messageOf(full), 'brand already has index.html and living-page.html, so Design Chamber has no place for its living page. Make a new system from it instead.');
  // The folder went between the scan and the click.
  await rm(tmp.at('shop/brand'), { recursive: true });
  const gone = await register(brand.scanId, 'Brand');
  assert.equal(gone.status, 400);
  assert.equal(messageOf(gone), LOCATION_GONE_SENTENCE);

  const names = ((await call('GET', '/systems')).json as SystemListResponse).systems.map((one) => one.name);
  assert.deepEqual(names, ['Acme'], 'no refusal left a system behind');
  assert.deepEqual((await readdir(tmp.at('Designs/_systems'))).sort(), ['acme']);
});

test('a running scan, and one made under another Designs folder, are refused', async (t) => {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const { call, project, jobs, ctx } = await setupLocation(t, { gate: () => gate });
  const started = (await call('POST', '/system-scans', { directory: project, location: 'design-system' })).json as CreateSystemScanResponse;
  const running = await call('POST', '/systems/register', { scanId: started.scanId, name: 'Acme' });
  assert.equal(running.status, 409);
  open();
  await jobs.settled(started.scanId);
  assert.equal(((await call('GET', `/system-scans/${started.scanId}`)).json as SystemScanResponse).state, 'done');
  await ctx.settings.update({ root: (await useTmpRoot(t, 'dc-root2-')).root });
  const moved = await call('POST', '/systems/register', { scanId: started.scanId, name: 'Acme' });
  assert.equal(moved.status, 404, 'a done job is dropped with the root');
  assert.equal(messageOf(moved), SCAN_GONE_MESSAGE);
});

test('a snapshot that fails to land leaves nothing half-registered', async (t) => {
  const { call, scan, project, tmp, ctx } = await setupLocation(t);
  const { scanId } = await scan({ directory: project, location: 'design-system' });
  setSnapshotSwapSeam(ctx, {
    rename: async (from, to) => {
      if (to.endsWith(`${path.sep}snapshot`)) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      await renameWithRetry(from, to);
    },
  });
  const failed = await call('POST', '/systems/register', { scanId, name: 'Acme' });
  assert.equal(failed.status, 409, JSON.stringify(failed.json));
  assert.match(messageOf(failed), /couldn't replace Acme's snapshot/);
  assert.deepEqual(await readdir(tmp.at('Designs/_systems')), [], 'the half-made system went to the trash');
  assert.ok((await readdir(tmp.at('Designs/.trash'))).some((name) => name.startsWith('system.acme-')));
  assert.deepEqual(((await call('GET', '/systems')).json as SystemListResponse).systems, []);
  // The same scan registers once the snapshot can land.
  setSnapshotSwapSeam(ctx, {});
  assert.equal((await call('POST', '/systems/register', { scanId, name: 'Acme' })).status, 200);
});

test('R-1: a registered system (no state.build) through every repo-home path', async (t) => {
  const { call, scan, project, tmp, systems, jobs } = await setupLocation(t);
  const before = await fingerprintTree(project);
  const { scanId } = await scan({ directory: project, location: 'design-system' });
  const { id } = (await call('POST', '/systems/register', { scanId, name: 'Acme' })).json as CreateSystemResponse;

  // Summary and detail: not building, no build view, no build problem; the page banners read the home.
  const detail = (await call('GET', `/systems/${id}`)).json as SystemDetail;
  assert.equal(detail.build, null);
  assert.equal(detail.buildProblem, null);
  assert.equal(detail.home.kind, 'repo');
  assert.notEqual(detail.snapshot, null);
  const row = ((await call('GET', '/systems')).json as SystemListResponse).systems[0];
  assert.equal(row?.building, false);
  assert.equal(row?.proposalWaiting, false);

  // Edits are refused read-only, before anything is written.
  const edit = await call('POST', `/systems/${id}/edits`, { op: 'save', stamps: { tokens: 'a'.repeat(64) }, tokens: [{ kind: 'set', name: '--brand-500', mode: 'light', value: '#000000' }] });
  assert.equal(edit.status, 422, JSON.stringify(edit.json));
  assert.deepEqual(edit.json, { error: 'read-only', message: 'Acme lives in shop. Change the values there, or ask the agent here.' });

  // Stop is for chat builds only: refused, the system stays.
  const stop = await call('POST', `/systems/${id}/build/stop`, {});
  assert.equal(stop.status, 409);
  assert.match(messageOf(stop), /wasn't started from a chat build/);
  // So is picking a build up in chat.
  const pickUp = await call('POST', `/systems/${id}/prompt`, { purpose: 'build-continue' });
  assert.equal(pickUp.status, 422);
  // The living-page ask regenerates the staged page and goes out.
  const living = await call('POST', `/systems/${id}/prompt`, { purpose: 'living-page' });
  assert.equal(living.status, 200, JSON.stringify(living.json));
  assert.match((living.json as SystemPromptResponse).text, /design-system\/living-page\.html|living-page\.html/);

  // A repo re-sync reads the repo again and lands nothing new (the repo didn't change).
  const started = (await call('POST', '/system-scans', { directory: project, systemId: id })).json as CreateSystemScanResponse;
  await jobs.settled(started.scanId);
  assert.equal(((await call('GET', `/system-scans/${started.scanId}`)).json as SystemScanResponse).state, 'done');
  const stamp = (await systems.readState(id)).snapshot?.treeHash ?? 'none';
  const applied = await call('POST', `/systems/${id}/resync`, { scanId: started.scanId, stamp });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));

  // Delete: the system goes, the repo stays.
  const deleted = await call('DELETE', `/systems/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal((deleted.json as { repoUntouched?: boolean }).repoUntouched, true);
  assert.deepEqual(await fingerprintTree(project), before, 'nothing on this path wrote the repo');
  assert.deepEqual(await readdir(tmp.at('Designs/_systems')), []);
  assert.equal(await readFile(path.join(project, 'design-system', 'tokens.css'), 'utf8'), REPO_FILES['design-system/tokens.css']);
});

test('freeLivingPage: index.html first, living-page.html when index.html is there (also as a folder), else refused', async (t) => {
  const tmp = await useTmpRoot(t, 'dc-living-');
  await tmp.write('ds/system.json', '{}');
  assert.equal(await freeLivingPage(tmp.root, 'ds'), 'ds/index.html');
  await tmp.write('ds/index.html/x', 'a folder named index.html');
  assert.equal(await freeLivingPage(tmp.root, 'ds'), 'ds/living-page.html');
  await tmp.write('ds/living-page.html', '<p></p>');
  await assert.rejects(() => freeLivingPage(tmp.root, 'ds'), /no place for its living page/);
});

test('isReadIntact: the scan read lands only when its bytes still hash to what it recorded', () => {
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
  const files = new Map([['tokens.css', Buffer.from(':root{--a:1px}')], ['system.json', Buffer.from('{}')]]);
  const hashes = { 'tokens.css': sha(':root{--a:1px}'), 'system.json': sha('{}') };
  const read = { files, hashes, treeHash: treeHashOf(hashes) };
  assert.equal(isReadIntact(read), true);
  assert.equal(isReadIntact({ ...read, files: new Map([...files, ['tokens.css', Buffer.from(':root{--a:2px}')]]) }), false, 'changed bytes');
  assert.equal(isReadIntact({ ...read, files: new Map([...files, ['OVERVIEW.md', Buffer.from('x')]]) }), false, 'a file with no hash');
  assert.equal(isReadIntact({ ...read, treeHash: 'f'.repeat(64) }), false, 'a forged tree hash');
});
