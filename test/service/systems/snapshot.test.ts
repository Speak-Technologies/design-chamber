// The repo-backed snapshot (documentation/specs/phase-2-5-technical.md §5.10, AD-14, AD-18): a read
// is complete or refused, only contract paths are kept, secret names and links are never read, a
// tree that moves mid-read is read once more, an unchanged tree takes no version, a failed swap
// keeps the old snapshot, and a swap a restart interrupted is finished or undone.

import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { SYSTEM_FILES_MAX } from '../../../src/shared/limits.ts';
import { ApiError } from '../../../src/service/http.ts';
import { renameWithRetry } from '../../../src/service/paths.ts';
import { readRepoSystem } from '../../../src/service/systems/repo-read.ts';
import { recoverSnapshot, refreshSnapshot, setSnapshotSwapSeam, SNAPSHOT_JSON } from '../../../src/service/systems/snapshot.ts';
import { ensureSystemVersions } from '../../../src/service/systems/versions.ts';
import { setupRepo, TOKENS } from './repo-fixture.ts';

const CONTRACT = ['OVERVIEW.md', 'assets/logos/acme.svg', 'components/button.html', 'notes/history.md', 'system.json', 'tokens.css'];

const versionsOf = async (ctx: Parameters<typeof ensureSystemVersions>[0], id: string) => (await ensureSystemVersions(ctx).list(id)).versions;

test('a first read keeps contract paths only, skips secret names and links, and takes a repo-read version', async (t) => {
  const rig = await setupRepo(t);
  await symlink(rig.repo('design-system/OVERVIEW.md'), rig.repo('design-system/notes/linked.md'));
  const id = await rig.repoSystem();
  const before = await rig.systems.readState(id);

  const outcome = await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  assert.equal(outcome.kind, 'refreshed');

  const source = await rig.systems.get(id);
  assert.deepEqual(Object.keys(source.hashes ?? {}).sort(), CONTRACT);
  assert.equal(source.tokensCss, TOKENS);
  const snapshotDir = path.join(await rig.systems.dir(id), 'snapshot');
  for (const never of ['README.md', 'extra.css', 'index.html', 'sources/deploy.pem', 'notes/linked.md', 'notes/deep/nested.md']) {
    assert.equal(await lstat(path.join(snapshotDir, ...never.split('/'))).catch(() => null), null, `${never} is not in the snapshot`);
  }
  const record = JSON.parse(await readFile(path.join(snapshotDir, SNAPSHOT_JSON), 'utf8')) as { by: string; files: Record<string, string>; skipped: { path: string; reason: string }[]; ignored: number; treeHash: string };
  assert.equal(record.by, 'agent');
  assert.deepEqual(Object.keys(record.files).sort(), CONTRACT);
  assert.deepEqual(
    record.skipped.map((one) => one.path),
    ['notes/linked.md', 'sources/deploy.pem'],
  );
  assert.equal(record.skipped[0]?.reason, 'It is a link, so it was not read.');
  assert.equal(record.skipped[1]?.reason, 'Its name looks like a secret, so it was not read.');
  assert.equal(record.ignored, 3, 'README.md, extra.css and the nested note');

  const state = await rig.systems.readState(id);
  assert.equal(state.snapshot?.by, 'agent');
  assert.equal(state.snapshot?.tampered, false);
  assert.equal(state.snapshot?.treeHash, record.treeHash);
  assert.equal(state.revision.n, before.revision.n + 1);
  assert.equal(state.revision.treeHash, record.treeHash);
  const versions = await versionsOf(rig.ctx, id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0]?.reason, 'repo-read');
  assert.ok(rig.ctx.events.some((event) => event.kind === 'system' && event.system === id && event.systemChange === 'files' && (event.files ?? []).includes('snapshot/tokens.css')));
});

test('a folder over the file cap is refused whole, and the last snapshot stands', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();
  assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
  const kept = (await rig.systems.readState(id)).snapshot?.treeHash;
  for (let n = 0; n <= SYSTEM_FILES_MAX; n += 1) await writeFile(rig.repo(`design-system/notes/n${String(n).padStart(3, '0')}.md`), `note ${n}\n`);

  const outcome = await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  assert.deepEqual(outcome, { kind: 'problem', reason: 'too-large' });
  const state = await rig.systems.readState(id);
  assert.equal(state.snapshot?.treeHash, kept, 'nothing of a refused read is kept');
  assert.equal(state.repoProblem?.reason, 'too-large');
  assert.equal(await lstat(path.join(await rig.systems.dir(id), 'snapshot', 'notes', 'n000.md')).catch(() => null), null);
  // A user's re-sync hears the sentence instead.
  await assert.rejects(refreshSnapshot(rig.ctx, id, { by: 'user' }), (error: unknown) => error instanceof ApiError && error.code === 'invalid');
});

test('a missing system folder is a problem, not an empty snapshot', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem('Acme', { folder: 'not-here' });
  assert.deepEqual(await refreshSnapshot(rig.ctx, id, { by: 'agent' }), { kind: 'problem', reason: 'folder-missing' });
  const state = await rig.systems.readState(id);
  assert.equal(state.snapshot ?? null, null);
  assert.equal(state.repoProblem?.reason, 'folder-missing');
  assert.equal((await versionsOf(rig.ctx, id)).length, 0);
});

test('a tree that moves during the read is read once more; still moving is being-changed', async (t) => {
  const rig = await setupRepo(t);
  const overview = rig.repo('design-system/OVERVIEW.md');
  let bumps = 0;
  const bump = async (): Promise<void> => {
    bumps += 1;
    await writeFile(overview, `Acme, edit ${bumps}, longer each time${'.'.repeat(bumps)}\n`);
  };

  // Moved once: the second attempt reads the new bytes.
  const once = await readRepoSystem({ directory: rig.project, folder: 'design-system', livingPage: 'design-system/index.html', betweenChecks: async (attempt) => (attempt === 0 ? bump() : undefined) });
  assert.equal(once.kind, 'read');
  assert.equal(once.kind === 'read' ? once.files.get('OVERVIEW.md')?.toString('utf8') : null, `Acme, edit 1, longer each time.\n`);

  // Moved on both attempts: nothing is kept.
  const twice = await readRepoSystem({ directory: rig.project, folder: 'design-system', livingPage: 'design-system/index.html', betweenChecks: bump });
  assert.deepEqual(twice, { kind: 'problem', reason: 'being-changed' });
  assert.equal(bumps, 3);
});

test('an unchanged tree takes no version and no revision; only the time moves', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();
  await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  const first = await rig.systems.readState(id);
  // A new mtime alone changes nothing: the content is compared, not the clock.
  const later = new Date(Date.now() + 60_000);
  await utimes(rig.repo('design-system/tokens.css'), later, later);

  const again = await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  assert.equal(again.kind, 'unchanged');
  const second = await rig.systems.readState(id);
  assert.equal(second.revision.n, first.revision.n);
  assert.equal(second.snapshot?.treeHash, first.snapshot?.treeHash);
  assert.ok((second.snapshot?.at ?? '') >= (first.snapshot?.at ?? ''));
  assert.equal((await versionsOf(rig.ctx, id)).length, 1);

  // A real change takes its version first, then the snapshot moves.
  await writeFile(rig.repo('design-system/tokens.css'), TOKENS.replace('#1a73e8', '#0b57d0'));
  assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
  const versions = await versionsOf(rig.ctx, id);
  assert.equal(versions.length, 2);
  assert.equal((await rig.systems.readState(id)).revision.n, first.revision.n + 1);
  assert.ok((await rig.systems.get(id)).tokensCss?.includes('#0b57d0'));
});

test('a swap that fails puts the old snapshot back and answers the busy sentence', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();
  await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  const kept = await rig.systems.get(id);
  const keptState = await rig.systems.readState(id);
  await writeFile(rig.repo('design-system/OVERVIEW.md'), 'Acme, rewritten.\n');

  const systemDir = await rig.systems.dir(id);
  setSnapshotSwapSeam(rig.ctx, {
    rename: async (from, to) => {
      // The publish step (staging into place) fails; moving the old folder aside works.
      if (to === path.join(systemDir, 'snapshot')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return renameWithRetry(from, to);
    },
  });
  await assert.rejects(refreshSnapshot(rig.ctx, id, { by: 'agent' }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'conflict');
    assert.equal(error.message, "Design Chamber couldn't replace Acme's snapshot because a file in it is in use. Close it and try again.");
    return true;
  });
  const after = await rig.systems.get(id);
  assert.deepEqual(after.hashes, kept.hashes, 'the old snapshot is back, whole');
  const state = await rig.systems.readState(id);
  assert.equal(state.snapshot?.treeHash, keptState.snapshot?.treeHash);
  assert.equal(state.revision.n, keptState.revision.n);
  // Nothing of the attempt is left in .chamber.
  const chamber = path.join(systemDir, '.chamber');
  assert.deepEqual((await readdir(chamber)).filter((name) => name.startsWith('snapshot-')), []);

  // Once the file is free, the next read lands.
  setSnapshotSwapSeam(rig.ctx, {});
  assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
  assert.ok((await rig.systems.get(id)).hashes?.['OVERVIEW.md'] !== kept.hashes?.['OVERVIEW.md']);
});

test('restart recovery mirrors the copy: a complete staging is published, else the replaced folder comes back', async (t) => {
  const rig = await setupRepo(t);
  const id = await rig.repoSystem();
  await refreshSnapshot(rig.ctx, id, { by: 'agent' });
  const systemDir = await rig.systems.dir(id);
  const live = path.join(systemDir, 'snapshot');
  const chamber = path.join(systemDir, '.chamber');
  const kept = await rig.systems.get(id);

  // Interrupted after the old folder moved aside, before the staging was complete.
  const replaced = path.join(chamber, 'snapshot-replaced-aaaaaaaaaaaa');
  const incomplete = path.join(chamber, 'snapshot-incoming-bbbbbbbbbbbb');
  await renameWithRetry(live, replaced);
  await mkdir(incomplete);
  await writeFile(path.join(incomplete, 'tokens.css'), ':root { --half: 1px; }\n');
  await recoverSnapshot(systemDir);
  assert.deepEqual((await rig.systems.get(id)).hashes, kept.hashes, 'the replaced snapshot is back');
  assert.equal(await lstat(incomplete).catch(() => null), null);
  assert.equal(await lstat(replaced).catch(() => null), null);

  // Interrupted after a complete staging: it is published, the old folder removed.
  const complete = path.join(chamber, 'snapshot-incoming-cccccccccccc');
  await renameWithRetry(live, replaced);
  await mkdir(complete);
  await writeFile(path.join(complete, 'tokens.css'), ':root { --whole: 2px; }\n');
  await writeFile(path.join(complete, SNAPSHOT_JSON), JSON.stringify({ v: 1, files: { 'tokens.css': 'x' }, treeHash: 'y' }));
  await recoverSnapshot(systemDir);
  assert.equal(await readFile(path.join(live, 'tokens.css'), 'utf8'), ':root { --whole: 2px; }\n');
  assert.equal(await lstat(replaced).catch(() => null), null);
  assert.equal(await lstat(complete).catch(() => null), null);

  // With a live snapshot in place, leftovers are only removed.
  const stray = path.join(chamber, 'snapshot-incoming-dddddddddddd');
  await mkdir(stray);
  await recoverSnapshot(systemDir);
  assert.equal(await lstat(stray).catch(() => null), null);
  assert.equal(await readFile(path.join(live, 'tokens.css'), 'utf8'), ':root { --whole: 2px; }\n');
  await rm(live, { recursive: true, force: true });
});
