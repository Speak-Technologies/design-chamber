// QA attacks on phase-0 0a (a damaged `.versions/index.json` never costs the history): torn
// writes at many offsets, a crash between the set-aside and the new index, concurrent
// snapshot + restore + list, a Windows-style refused rename, repeated damage against the
// five-copy cap, and restore without state.json. The invariant every case checks: no object
// named by a surviving or recoverable list is ever deleted.

import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { createVersionsService, type VersionsService } from '../../../src/service/versions.ts';
import { damagedFileName, hashesMentioned } from '../../../src/service/versions-index.ts';
import { ApiError } from '../../../src/service/http.ts';
import { pageDesign } from './harness.ts';

const require = createRequire(import.meta.url);
const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');

const setup = async (t: TestContext, now?: () => number): Promise<{ tmp: TmpRoot; ctx: FakeContext; versions: VersionsService }> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000, ...(now ? { now } : {}) });
  return { tmp, ctx, versions };
};

const vdir = (tmp: TmpRoot, slug: string): string => tmp.at(`${slug}/.versions`);
const indexOf = (tmp: TmpRoot, slug: string): string => path.join(vdir(tmp, slug), 'index.json');
const backupOf = (tmp: TmpRoot, slug: string): string => path.join(vdir(tmp, slug), 'index.bak.json');

const allObjects = async (tmp: TmpRoot, slug: string): Promise<Set<string>> => {
  const dir = path.join(vdir(tmp, slug), 'objects');
  const out = new Set<string>();
  for (const bucket of await readdir(dir).catch(() => [])) for (const name of await readdir(path.join(dir, bucket)).catch(() => [])) out.add(name);
  return out;
};

const damagedNames = async (tmp: TmpRoot, slug: string): Promise<string[]> =>
  (await readdir(vdir(tmp, slug)).catch(() => [])).filter((name) => name.startsWith('index.damaged-')).sort();

const seed = async (tmp: TmpRoot, versions: VersionsService, slug: string, n: number): Promise<void> => {
  await tmp.writeDesign(slug, pageDesign({ 'index.html': `${slug} page 1` }));
  for (let i = 1; i <= n; i += 1) {
    if (i > 1) await tmp.write(`${slug}/index.html`, `${slug} page ${i}`);
    assert.ok(await versions.create(slug, 'manual'), `${slug} version ${i}`);
  }
};

const assertKept = (after: Set<string>, expected: Iterable<string>, why: string): void => {
  for (const hash of expected) assert.ok(after.has(hash), `${why}: object ${hash.slice(0, 12)} was deleted`);
};

describe('QA 0a: torn and hostile indexes', () => {
  test('a torn index.json at any offset, with the backup intact, costs no object and keeps every version', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'base', 4);
    const original = await readFile(indexOf(tmp, 'base'), 'utf8');
    const offsets = [0, 1, 2, 10, 50, 100, 200, 400, 800, 1200, 1600, original.length - 40, original.length - 3];
    for (const [i, offset] of offsets.entries()) {
      if (offset < 0 || offset >= original.length) continue;
      const slug = `torn-${i}`;
      await seed(tmp, versions, slug, 4);
      const before = await allObjects(tmp, slug);
      await writeFile(indexOf(tmp, slug), (await readFile(indexOf(tmp, slug), 'utf8')).slice(0, offset));
      const listed = await versions.list(slug);
      assert.equal(listed.versions.length, 4, `offset ${offset}: the backup lists all four`);
      assert.equal(listed.history, 'recovered', `offset ${offset}`);
      await tmp.write(`${slug}/index.html`, 'next page');
      assert.equal((await versions.create(slug, 'manual'))?.id, 'v5', `offset ${offset}: ids continue`);
      assertKept(await allObjects(tmp, slug), before, `offset ${offset}`);
      assert.equal((await versions.list(slug)).versions.length, 5);
    }
  });

  test('a torn index.json with no backup keeps every object the torn text still names, and ids never repeat', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'base', 3);
    const length = (await readFile(indexOf(tmp, 'base'), 'utf8')).length;
    // Tree hashes are 64-hex too but are not objects: only hashes that were stored objects count.
    const allObjectsBefore = new Map<string, Promise<Set<string>>>();
    for (const [i, fraction] of [0.2, 0.4, 0.6, 0.8, 0.95].entries()) {
      const slug = `nobak-${i}`;
      await seed(tmp, versions, slug, 3);
      allObjectsBefore.set(slug, allObjects(tmp, slug));
      const text = (await readFile(indexOf(tmp, slug), 'utf8')).slice(0, Math.floor(length * fraction));
      await writeFile(indexOf(tmp, slug), text);
      await rm(backupOf(tmp, slug));
      assert.equal((await versions.list(slug)).history, 'reset');
      await tmp.write(`${slug}/index.html`, 'next page');
      const created = await versions.create(slug, 'manual');
      assert.ok(created);
      const named = [...text.matchAll(/"id": "v(\d+)"/g)].map((m) => Number(m[1]));
      assert.ok(created.n > Math.max(0, ...named), `fraction ${fraction}: v${created.n} is above every named id`);
      const before = await allObjectsBefore.get(slug);
      assertKept(await allObjects(tmp, slug), [...hashesMentioned(text)].filter((hash) => before?.has(hash)), `fraction ${fraction}`);
    }
  });

  test('recovering from a backup one generation old never reuses an id the damaged index named', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 2);
    const olderBackup = await readFile(backupOf(tmp, 'art'), 'utf8'); // names v1, v2; next 3
    await tmp.write('art/index.html', 'art page 3');
    assert.equal((await versions.create('art', 'manual'))?.id, 'v3');
    // A crash after the index write and before the backup write leaves the backup behind; then the index is torn.
    await writeFile(backupOf(tmp, 'art'), olderBackup);
    const text = await readFile(indexOf(tmp, 'art'), 'utf8');
    await writeFile(indexOf(tmp, 'art'), text.slice(0, text.length - 20));
    assert.equal((await versions.list('art')).history, 'recovered');
    await tmp.write('art/index.html', 'art page 4');
    assert.equal((await versions.create('art', 'manual'))?.id, 'v4', 'v3 was already used by the damaged index');
  });

  test('a BOM in front of a healthy index is read as healthy and never set aside', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 2);
    await writeFile(indexOf(tmp, 'art'), `﻿${await readFile(indexOf(tmp, 'art'), 'utf8')}`);
    const listed = await versions.list('art');
    assert.equal(listed.history, undefined);
    assert.equal(listed.versions.length, 2);
    await tmp.write('art/index.html', 'page 3');
    assert.equal((await versions.create('art', 'manual'))?.id, 'v3');
    assert.deepEqual(await damagedNames(tmp, 'art'), []);
  });

  test('valid JSON of the wrong shape falls back to the backup', async (t) => {
    const { tmp, versions } = await setup(t);
    for (const [i, bad] of ['[]', '{"version":1,"versions":{}}', '{"version":"1","versions":[]}', '{"version":0,"versions":[]}', 'null'].entries()) {
      const slug = `shape-${i}`;
      await seed(tmp, versions, slug, 2);
      const before = await allObjects(tmp, slug);
      await writeFile(indexOf(tmp, slug), bad);
      assert.equal((await versions.list(slug)).history, 'recovered', bad);
      await tmp.write(`${slug}/index.html`, 'page 3');
      assert.ok(await versions.create(slug, 'manual'));
      assertKept(await allObjects(tmp, slug), before, bad);
    }
  });

  test('a version 2 backup behind a ruined index is unsupported and nothing is written', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 1);
    const bak = JSON.parse(await readFile(backupOf(tmp, 'art'), 'utf8')) as { version: number };
    bak.version = 2;
    await writeFile(backupOf(tmp, 'art'), JSON.stringify(bak));
    await writeFile(indexOf(tmp, 'art'), 'garbage');
    assert.equal((await versions.list('art')).history, 'unsupported');
    await tmp.write('art/index.html', 'page 2');
    await assert.rejects(versions.create('art', 'manual'), (error: unknown) => error instanceof ApiError && error.code === 'invalid');
    assert.equal(await readFile(indexOf(tmp, 'art'), 'utf8'), 'garbage');
    assert.deepEqual(await damagedNames(tmp, 'art'), []);
  });
});

describe('QA 0a: crashes, races and refused renames', () => {
  test('a crash after the set-aside and before the new index is recovered from the backup, with no object lost', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 3);
    const before = await allObjects(tmp, 'art');
    // What the service leaves behind when it dies between the rename and the index write.
    await writeFile(indexOf(tmp, 'art'), 'torn');
    await rename(indexOf(tmp, 'art'), path.join(vdir(tmp, 'art'), damagedFileName(new Date(), 'recovered', 'qa01')));
    const listed = await versions.list('art');
    assert.equal(listed.versions.length, 3);
    assert.equal(listed.history, 'recovered');
    await tmp.write('art/index.html', 'page 4');
    assert.equal((await versions.create('art', 'manual'))?.id, 'v4');
    assertKept(await allObjects(tmp, 'art'), before, 'after the crash');
  });

  test('concurrent snapshot, restore and list on one slug with a damaged index: one set-aside, no object lost, a valid index', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 4);
    const before = await allObjects(tmp, 'art');
    await writeFile(indexOf(tmp, 'art'), (await readFile(indexOf(tmp, 'art'), 'utf8')).slice(0, 300));
    await tmp.write('art/index.html', 'unsaved');
    const results = await Promise.allSettled([
      versions.create('art', 'manual'),
      versions.list('art'),
      versions.restore('art', 'v2'),
      versions.list('art'),
      versions.create('art', 'manual'),
      versions.list('art'),
    ]);
    for (const [i, result] of results.entries()) assert.equal(result.status, 'fulfilled', `call ${i}: ${result.status === 'rejected' ? String(result.reason) : ''}`);
    assertKept(await allObjects(tmp, 'art'), before, 'after the race');
    assert.equal((await damagedNames(tmp, 'art')).length, 1, 'set aside exactly once');
    const final = await versions.list('art');
    assert.equal(final.history, 'recovered');
    assert.equal(final.dirty, false);
    assert.ok((await readFile(tmp.at('art/index.html'), 'utf8')).includes('page 2'), 'v2 is on disk');
    const index = JSON.parse(await readFile(indexOf(tmp, 'art'), 'utf8')) as { versions: { id: string }[] };
    assert.equal(new Set(index.versions.map((v) => v.id)).size, index.versions.length, 'no duplicate ids');
  });

  test('a rename refused with EPERM (Windows lock) falls back to a copy holding the damaged bytes', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 2);
    const before = await allObjects(tmp, 'art');
    await writeFile(indexOf(tmp, 'art'), 'locked and torn');
    const realRename = fsPromises.rename;
    fsPromises.rename = async (from, to) => {
      // Windows refuses to move a file another process holds open: only the move OF index.json fails.
      if (path.basename(String(from)) === 'index.json' && String(to).includes('index.damaged-')) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      return realRename(from, to);
    };
    syncBuiltinESMExports();
    t.after(() => {
      fsPromises.rename = realRename;
      syncBuiltinESMExports();
    });
    await tmp.write('art/index.html', 'page 3');
    assert.equal((await versions.create('art', 'manual'))?.id, 'v3');
    const aside = await damagedNames(tmp, 'art');
    assert.equal(aside.length, 1);
    assert.equal(await readFile(path.join(vdir(tmp, 'art'), aside[0] ?? ''), 'utf8'), 'locked and torn');
    assertKept(await allObjects(tmp, 'art'), before, 'after the copy fallback');
  });

  test('when the rename and the copy both fail, nothing is written over the damaged index and no object is deleted', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 2);
    const before = await allObjects(tmp, 'art');
    await writeFile(indexOf(tmp, 'art'), 'locked and torn');
    const realRename = fsPromises.rename;
    fsPromises.rename = async (from, to) => {
      if (String(to).includes('index.damaged-')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return realRename(from, to);
    };
    syncBuiltinESMExports();
    t.after(() => {
      fsPromises.rename = realRename;
      syncBuiltinESMExports();
    });
    await tmp.write('art/index.html', 'page 3');
    await assert.rejects(versions.create('art', 'manual'), (error: unknown) => error instanceof ApiError && error.code === 'internal' && /set the damaged version list aside/.test(error.message));
    assert.equal(await readFile(indexOf(tmp, 'art'), 'utf8'), 'locked and torn');
    assertKept(await allObjects(tmp, 'art'), before, 'after the refused set-aside');
  });
});

describe('QA 0a: repeated damage against the five-copy cap', () => {
  test('every hash named by a kept damaged copy survives seven rounds of damage', async (t) => {
    let clock = Date.parse('2026-11-01T12:00:00.000Z');
    const { tmp, versions } = await setup(t, () => clock);
    await seed(tmp, versions, 'art', 3);
    const everStored = await allObjects(tmp, 'art'); // tree hashes are 64-hex too; only stored objects count
    for (let round = 1; round <= 7; round += 1) {
      clock += 60_000;
      const text = await readFile(indexOf(tmp, 'art'), 'utf8');
      await writeFile(indexOf(tmp, 'art'), text.slice(0, Math.floor(text.length * 0.7)));
      if (round % 2 === 0) await rm(backupOf(tmp, 'art'));
      await tmp.write('art/index.html', `round ${round}`);
      for (const hash of await allObjects(tmp, 'art')) everStored.add(hash);
      assert.ok(await versions.create('art', 'manual'), `round ${round}`);
      const objects = await allObjects(tmp, 'art');
      for (const hash of objects) everStored.add(hash);
      const kept = await damagedNames(tmp, 'art');
      assert.ok(kept.length <= 5);
      for (const name of kept) {
        const named = [...hashesMentioned(await readFile(path.join(vdir(tmp, 'art'), name), 'utf8'))].filter((hash) => everStored.has(hash));
        assertKept(objects, named, `round ${round} ${name}`);
      }
      const live = JSON.parse(await readFile(indexOf(tmp, 'art'), 'utf8')) as { versions: { files: Record<string, string> }[] };
      for (const entry of live.versions) assertKept(objects, Object.values(entry.files), `round ${round} live`);
    }
  });
});

describe('QA 0a: restore without state.json', () => {
  test('restoring on an agent-made design keeps the comments and leaves the tree clean', async (t) => {
    const { tmp, versions } = await setup(t);
    const comment = { id: 'c_keep', screen: null, viewport: 'laptop', anchor: { selector: 'h1', text: 'hello', html: '<h1>', rect: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 } }, body: 'keep', status: 'open', created: '2026-10-26T12:00:00.000Z', sentAt: null, sentVersion: null };
    await tmp.writeDesign('art', pageDesign({ 'design.json': { version: 1, kind: 'page', title: 'T', created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T10:00:00.000Z', comments: [comment] } }));
    await rm(tmp.at('art/.chamber'), { recursive: true, force: true });
    const v1 = await versions.create('art', 'manual');
    assert.ok(v1);
    await tmp.write('art/index.html', '<p>later</p>');
    await versions.create('art', 'manual');
    await rm(tmp.at('art/.chamber'), { recursive: true, force: true });
    await versions.restore('art', 'v1');
    const onDisk = JSON.parse(await readFile(tmp.at('art/design.json'), 'utf8')) as { comments: { id: string }[] };
    assert.deepEqual(onDisk.comments.map((c) => c.id), ['c_keep']);
    const listed = await versions.list('art');
    assert.equal(listed.dirty, false, 'the grafted comments do not change the tree hash');
    assert.equal(listed.versions[0]?.treeHash, v1.treeHash);
  });
});

// ---- defects found by QA, fixed ----

describe('QA 0a: confirmed defects', () => {
  test('F1: a ruined index that names no hash, with no backup, must not let GC delete the old objects', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 3);
    const before = await allObjects(tmp, 'art');
    await writeFile(indexOf(tmp, 'art'), '{}');
    await rm(backupOf(tmp, 'art'));
    assert.equal((await versions.list('art')).history, 'reset'); // the banner says the old files are kept
    await tmp.write('art/index.html', 'page 4');
    assert.ok(await versions.create('art', 'manual'));
    assertKept(await allObjects(tmp, 'art'), before, 'reset from an unreadable index');
  });

  test('F1b: a damaged backup behind a damaged index must not lose what only the backup named', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 3);
    const before = await allObjects(tmp, 'art');
    const bak = await readFile(backupOf(tmp, 'art'), 'utf8');
    await writeFile(backupOf(tmp, 'art'), bak.slice(0, bak.length - 5)); // torn, still names every hash
    await writeFile(indexOf(tmp, 'art'), '');
    await tmp.write('art/index.html', 'page 4');
    assert.ok(await versions.create('art', 'manual'));
    assertKept(await allObjects(tmp, 'art'), before, 'both files damaged');
  });

  test('F2: GC must skip, not guess, when listing the damaged copies fails', async (t) => {
    const { tmp, versions } = await setup(t);
    await seed(tmp, versions, 'art', 3);
    const before = await allObjects(tmp, 'art');
    const text = await readFile(indexOf(tmp, 'art'), 'utf8');
    await writeFile(indexOf(tmp, 'art'), text.slice(0, text.lastIndexOf('"bytes"') + 8));
    await rm(backupOf(tmp, 'art'));
    const versionsDir = vdir(tmp, 'art');
    const realReaddir = fsPromises.readdir;
    let calls = 0;
    fsPromises.readdir = (async (target: Parameters<typeof realReaddir>[0], options?: unknown) => {
      if (String(target) === versionsDir) {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' }); // the GC listing
      }
      return (realReaddir as (p: unknown, o?: unknown) => Promise<unknown>)(target, options);
    }) as typeof realReaddir;
    syncBuiltinESMExports();
    t.after(() => {
      fsPromises.readdir = realReaddir;
      syncBuiltinESMExports();
    });
    await tmp.write('art/index.html', 'page 4');
    assert.ok(await versions.create('art', 'manual'));
    fsPromises.readdir = realReaddir;
    syncBuiltinESMExports();
    assertKept(await allObjects(tmp, 'art'), before, 'GC with an unreadable .versions listing');
  });
});
