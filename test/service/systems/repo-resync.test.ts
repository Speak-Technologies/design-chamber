// The user's repo re-sync and the tamper rule (documentation/specs/phase-2-5-technical.md §5.10, §7.4,
// AD-20, AD-33): the scan reads the repo folder, Apply takes it all or nothing with no Undo, a stale
// stamp says Scan again, a re-point must hold the system's folder, and a snapshot changed outside
// Design Chamber blocks a link (409) until a re-read clears it.

import assert from 'node:assert/strict';
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { API_ERROR_STATUS } from '../../../src/shared/api.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { ensureScanJobs } from '../../../src/service/systems/extract.ts';
import { createLinkService, LinkRefusal } from '../../../src/service/systems/link.ts';
import { SCAN_FOLDER_IN_ROOT } from '../../../src/service/systems/scan-folder.ts';
import { applyRepoResync, parseRepoResyncRequest, refreshSnapshot, snapshotTamperedMessage, startSnapshots } from '../../../src/service/systems/snapshot.ts';
import { createSystemStore } from '../../../src/service/systems/store.ts';
import { ensureSystemVersions } from '../../../src/service/systems/versions.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { setupRepo, TOKENS, type RepoRig } from './repo-fixture.ts';

const scan = async (rig: RepoRig, id: string, directory = rig.project) => {
  const jobs = ensureScanJobs(rig.ctx);
  const { scanId } = await jobs.start({ directory, systemId: id });
  await jobs.settled(scanId);
  return { scanId, answer: jobs.get(scanId) };
};

const stampOf = async (rig: RepoRig, id: string): Promise<string> => (await rig.systems.readState(id)).snapshot?.treeHash ?? 'none';

const rejectsWith = (code: string, message?: string) => (error: unknown): boolean => {
  assert.ok(error instanceof ApiError, String(error));
  assert.equal(error.code, code);
  if (message !== undefined) assert.equal(error.message, message);
  return true;
};

test('the body is { scanId, stamp } only; a stamp is a tree hash or "none"', () => {
  const scanId = 'sc_abcdefghijklmnopqrstuvwx';
  assert.deepEqual(parseRepoResyncRequest({ scanId, stamp: 'none' }), { scanId, stamp: 'none' });
  assert.deepEqual(parseRepoResyncRequest({ scanId, stamp: 'a'.repeat(64) }), { scanId, stamp: 'a'.repeat(64) });
  for (const body of [null, [], {}, { scanId }, { scanId, stamp: 'A'.repeat(64) }, { scanId, stamp: 'none', ticks: [] }, { scanId: '../x', stamp: 'none' }]) {
    assert.throws(() => parseRepoResyncRequest(body), rejectsWith('bad-request', "Design Chamber couldn't read that re-sync. Scan again."), JSON.stringify(body));
  }
});

test('Apply takes the repo all or nothing with no Undo: a version first, undoable false, no undo record', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();

  // The first read: nothing yet, so everything is new and the stamp is "none".
  const first = await scan(rig, id);
  assert.equal(first.answer.state, 'done');
  const review = first.answer.state === 'done' ? first.answer.review : undefined;
  assert.equal(review?.kind, 'repo');
  const applied = await applyRepoResync(rig.ctx, id, { scanId: first.scanId, stamp: 'none' });
  assert.equal(applied.edit.undoable, false);
  assert.equal(applied.edit.label, `Re-synced Acme from shop: 0 changed, 7 added, 0 removed.`);
  assert.equal(applied.version?.reason, 'repo-read');
  assert.equal((await rig.systems.get(id)).tokensCss, TOKENS);
  assert.equal((await rig.systems.readState(id)).snapshot?.by, 'user');

  // A change in the repo: the review lists it, Apply takes a `resync` version and the new bytes.
  await writeFile(rig.repo('design-system/tokens.css'), TOKENS.replace('#1a73e8', '#0b57d0'));
  await writeFile(rig.repo('design-system/notes/history.md'), 'A new history.\n');
  const second = await scan(rig, id);
  const stamp = await stampOf(rig, id);
  const resynced = await applyRepoResync(rig.ctx, id, { scanId: second.scanId, stamp });
  assert.equal(resynced.edit.label, 'Re-synced Acme from shop: 2 changed, 0 added, 0 removed.');
  assert.equal(resynced.edit.undoable, false);
  assert.equal(resynced.version?.reason, 'resync');
  assert.deepEqual(resynced.stamps, {});
  assert.ok((await rig.systems.get(id)).tokensCss?.includes('#0b57d0'));
  // AD-33: no undo record anywhere.
  const editsFile = path.join(await rig.systems.dir(id), '.chamber', 'edits.json');
  const edits = await readFile(editsFile, 'utf8').then((text) => JSON.parse(text) as { undo?: { id: string }[] }, () => null);
  assert.ok(edits === null || !(edits.undo ?? []).some((one) => one.id === resynced.edit.id), 'a repo re-sync writes no undo record');
  // AD-20: restore stays refused on a repo home.
  const versions = (await ensureSystemVersions(rig.ctx).list(id)).versions;
  assert.equal(versions.length, 2);

  // Nothing changed since: the label says so and nothing is written.
  const third = await scan(rig, id);
  const same = await applyRepoResync(rig.ctx, id, { scanId: third.scanId, stamp: await stampOf(rig, id) });
  assert.equal(same.edit.label, 'Acme already matches shop.');
  assert.deepEqual(same.edit.files, []);
  assert.equal(same.version, null);
  assert.equal((await ensureSystemVersions(rig.ctx).list(id)).versions.length, 2);
});

test('a stale stamp answers 409 with Scan again and changes nothing', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();
  await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  await writeFile(rig.repo('design-system/OVERVIEW.md'), 'Read by the user.\n');
  const reviewed = await scan(rig, id);
  const stamp = await stampOf(rig, id);
  // The agent's stamp lands between the review and Apply: the snapshot moved under the sheet.
  await writeFile(rig.repo('design-system/OVERVIEW.md'), 'Read by the agent.\n');
  await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  const moved = await rig.systems.readState(id);

  await assert.rejects(applyRepoResync(rig.ctx, id, { scanId: reviewed.scanId, stamp }), rejectsWith('stale'));
  assert.equal(API_ERROR_STATUS.stale, 409);
  const after = await rig.systems.readState(id);
  assert.equal(after.snapshot?.treeHash, moved.snapshot?.treeHash);
  assert.equal(after.revision.n, moved.revision.n);
  // A stamp that is not the job's own is stale before anything is read.
  await assert.rejects(applyRepoResync(rig.ctx, id, { scanId: reviewed.scanId, stamp: 'none' }), rejectsWith('stale'));
});

test('a re-point must pass the folder rules and hold the system folder; a good one moves the home', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();
  await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  const jobs = ensureScanJobs(rig.ctx);

  // Inside the designs root: refused before any scan starts.
  await assert.rejects(jobs.start({ directory: rig.root, systemId: id }), rejectsWith('bad-path', SCAN_FOLDER_IN_ROOT));
  // A folder without design-system: the scan fails with the folder sentence, and Apply has nothing.
  const empty = path.join(rig.base, 'elsewhere');
  await mkdir(empty);
  const missing = await scan(rig, id, empty);
  assert.deepEqual(missing.answer, { state: 'failed', message: 'elsewhere has no design-system folder yet.' });
  await assert.rejects(applyRepoResync(rig.ctx, id, { scanId: missing.scanId, stamp: await stampOf(rig, id) }), (error: unknown) => error instanceof ApiError);
  const kept = await rig.systems.readState(id);
  assert.equal(kept.home?.kind === 'repo' ? kept.home.directory : null, rig.project, 'a failed re-point leaves the home alone');

  // The repo moved: a re-point to the new folder reads it and moves the home there.
  const moved = path.join(rig.base, 'shop-moved');
  await cp(rig.project, moved, { recursive: true });
  await writeFile(path.join(moved, 'design-system', 'OVERVIEW.md'), 'Acme, from its new home.\n');
  const repointed = await scan(rig, id, moved);
  assert.equal(repointed.answer.state, 'done');
  const answer = await applyRepoResync(rig.ctx, id, { scanId: repointed.scanId, stamp: await stampOf(rig, id) });
  assert.equal(answer.directoryChanged, true);
  assert.equal(answer.edit.label, 'Re-synced Acme from shop-moved: 1 changed, 0 added, 0 removed.');
  const state = await rig.systems.readState(id);
  assert.equal(state.home?.kind === 'repo' ? state.home.directory : null, moved);
  assert.equal(state.repoProblem ?? null, null);
});

test('a snapshot changed outside Design Chamber is marked tampered, a link answers 409, a re-read clears it', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();
  await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  await rig.systems.withLock(id, () => rig.systems.updateStateLocked(id, (state) => ({ ...state, status: 'ready' })));
  const stop = startSnapshots(rig.ctx);

  // The service's own echo (the bytes it wrote) is not tampering.
  rig.ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files', files: ['snapshot/tokens.css'] });
  await stop();
  assert.equal((await rig.systems.readState(id)).snapshot?.tampered, false);

  const watching = startSnapshots(rig.ctx);
  t.after(() => watching());
  await writeFile(path.join(await rig.systems.dir(id), 'snapshot', 'tokens.css'), ':root { --brand-500: hotpink; }\n');
  rig.ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files', files: ['snapshot/tokens.css'] });
  await watching();
  assert.equal((await rig.systems.readState(id)).snapshot?.tampered, true);

  // The link service over a store with no quiet wait, so only the tamper rule can refuse.
  const store = createDesignStore({ settings: rig.ctx.settings, log: rig.ctx.log, hub: rig.ctx.hub });
  const systems = createSystemStore({ settings: rig.ctx.settings, hub: rig.ctx.hub, log: rig.ctx.log, selfWrites: rig.ctx.selfWrites, quietMs: 0, indexRefreshMs: 5 });
  t.after(() => systems.dispose());
  const versions = createVersionsService({ store, hub: rig.ctx.hub, log: rig.ctx.log, onDispose: rig.ctx.onDispose, quietMs: 600_000 });
  const link = createLinkService({ store, versions, systems, selfWrites: rig.ctx.selfWrites, hub: rig.ctx.hub, log: rig.ctx.log, root: () => rig.root });
  const { slug } = await store.create({ kind: 'page', title: 'Checkout', html: '<!doctype html><html><body><h1>Checkout</h1></body></html>' });

  await assert.rejects(link.link(slug, { to: id, by: 'agent', reason: 'system-change' }), (error: unknown) => {
    assert.ok(error instanceof LinkRefusal);
    assert.equal(error.code, 'conflict');
    assert.equal(API_ERROR_STATUS[error.code], 409);
    assert.equal(error.message, snapshotTamperedMessage('Acme'));
    assert.equal(error.message, "Acme's snapshot was changed outside Design Chamber. Re-sync it first.");
    return true;
  });
  assert.equal(await lstat(path.join(rig.root, slug, 'system')).catch(() => null), null, 'nothing was copied');

  // A re-read puts the repo's bytes back and clears the mark; the link then goes through.
  assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
  assert.equal((await rig.systems.readState(id)).snapshot?.tampered, false);
  assert.equal((await rig.systems.get(id)).tokensCss, TOKENS);
  await link.link(slug, { to: id, by: 'agent', reason: 'system-change' });
  assert.ok((await lstat(path.join(rig.root, slug, 'system', 'tokens.css'))).isFile());
});
