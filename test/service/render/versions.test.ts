import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { createVersionsService, EMPTY_TREE_HASH, isTracked, listTracked, type VersionsService } from '../../../src/service/versions.ts';
import { ApiError } from '../../../src/service/http.ts';
import { pageDesign, sleep } from './harness.ts';

const setup = async (t: TestContext, quietMs = 40, now?: () => number): Promise<{ tmp: TmpRoot; ctx: FakeContext; versions: VersionsService }> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs, ...(now ? { now } : {}) });
  return { tmp, ctx, versions };
};

const indexFile = (tmp: TmpRoot, slug: string): string => tmp.at(`${slug}/.versions/index.json`);
const objectsDir = (tmp: TmpRoot, slug: string): string => tmp.at(`${slug}/.versions/objects`);

const allObjects = async (dir: string): Promise<string[]> => {
  const buckets = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const hashes: string[] = [];
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    for (const name of await readdir(path.join(dir, bucket.name))) hashes.push(name);
  }
  return hashes;
};

describe('tracked set', () => {
  test('versions, chamber and thumbnails are excluded; everything else is tracked', () => {
    assert.equal(isTracked('index.html'), true);
    assert.equal(isTracked('assets/pic.png'), true);
    assert.equal(isTracked('DESIGN.md'), true);
    assert.equal(isTracked('.versions/index.json'), false);
    assert.equal(isTracked('.chamber/state.json'), false);
    assert.equal(isTracked('.thumb.png'), false);
    assert.equal(isTracked('.thumb.123.png'), false);
    assert.equal(isTracked('sub/.thumb.png'), false);
    assert.equal(isTracked('.index.html.2bba59ef828e.tmp'), false);
    assert.equal(isTracked('screens/home.html.2bba59ef828e.tmp'), false);
    assert.equal(isTracked('notes.tmp'), true);
  });

  test('listTracked walks the folder and skips the excluded trees', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.writeDesign('art', {
      ...pageDesign(),
      'assets/pic.png': 'x',
      '.chamber/state.json': '{}',
      '.versions/index.json': '{}',
      '.thumb.png': 'x',
    });
    const rels = await listTracked(tmp.at('art'));
    assert.deepEqual(rels, ['assets/pic.png', 'design.json', 'index.html']);
  });
});

describe('versions', () => {
  test('manual snapshot creates v1, dedupes an unchanged tree, and lists newest-first', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());

    const first = await versions.create('art', 'manual');
    assert.ok(first);
    assert.equal(first.id, 'v1');
    assert.equal(first.n, 1);
    assert.equal(first.reason, 'manual');
    assert.equal(first.fileCount, 2); // design.json + index.html

    const again = await versions.create('art', 'manual');
    assert.equal(again, null, 'an unchanged tree is deduped by hash');

    const list = await versions.list('art');
    assert.equal(list.versions.length, 1);
    assert.equal(list.dirty, false);
    assert.equal(list.currentTreeHash, first.treeHash);

    await tmp.write('art/index.html', '<p>changed</p>');
    const dirty = await versions.list('art');
    assert.equal(dirty.dirty, true, 'a content change makes the tree dirty');

    const second = await versions.create('art', 'manual', { label: 'after edit' });
    assert.ok(second);
    assert.equal(second.id, 'v2');
    assert.equal(second.label, 'after edit');
    const list2 = await versions.list('art');
    assert.deepEqual(
      list2.versions.map((entry) => entry.id),
      ['v2', 'v1'],
      'newest first',
    );
    assert.equal(list2.dirty, false);
  });

  test('design.json is stored with comments removed and sessionId kept', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', {
      ...pageDesign(),
      'design.json': {
        version: 1,
        kind: 'page',
        title: 'T',
        created: '2026-10-26T10:00:00.000Z',
        updated: '2026-10-26T10:00:00.000Z',
        sessionId: 'ses_abc',
        comments: [{ id: 'c_abcd', screen: null, viewport: 'laptop', anchor: { selector: 'h1', text: 'x', html: '<h1>', rect: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 } }, body: 'secret pin', status: 'open', created: '2026-10-26T10:00:00.000Z', sentAt: null, sentVersion: null }],
      },
    });
    const created = await versions.create('art', 'manual');
    assert.ok(created);
    const index = JSON.parse(await readFile(indexFile(tmp, 'art'), 'utf8')) as { versions: { files: Record<string, string> }[] };
    const hash = index.versions[0]?.files['design.json'];
    assert.ok(hash);
    const stored = await readFile(path.join(objectsDir(tmp, 'art'), hash.slice(0, 2), hash), 'utf8');
    assert.ok(!stored.includes('secret pin'), 'comments are stripped from the stored design.json');
    assert.ok(stored.includes('ses_abc'), 'other fields survive');
  });

  test('auto snapshot fires after the quiet period and is deduped when nothing changed', async (t) => {
    const { tmp, ctx, versions } = await setup(t, 40);
    await tmp.writeDesign('art', pageDesign());
    await versions.create('art', 'manual'); // v1

    await tmp.write('art/index.html', '<p>agent wrote</p>');
    ctx.hub.emit({ slug: 'art', kind: 'files', files: ['index.html'] });
    assert.equal(versions.autoPending('art'), true);
    await sleep(200);
    const list = await versions.list('art');
    assert.equal(list.versions.length, 2);
    assert.equal(list.versions[0]?.reason, 'auto');
    assert.equal(list.dirty, false);

    // An event with no content change dedupes: no v3.
    ctx.hub.emit({ slug: 'art', kind: 'files', files: ['index.html'] });
    await sleep(200);
    assert.equal((await versions.list('art')).versions.length, 2);
  });

  test('turn snapshot captures every design linked to the session and dedupes within the window', async (t) => {
    const { tmp, versions } = await setup(t);
    const design = (title: string, sessionId: string) => ({
      ...pageDesign(),
      'design.json': { version: 1, kind: 'page', title, created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T10:00:00.000Z', sessionId },
    });
    await tmp.writeDesign('one', design('One', 'ses_x'));
    await tmp.writeDesign('two', design('Two', 'ses_x'));
    await tmp.writeDesign('three', design('Three', 'ses_y'));

    const created = await versions.turn('ses_x');
    assert.deepEqual(created.map((entry) => entry.slug).sort(), ['one', 'two']);
    assert.ok(created.every((entry) => entry.id === 'v1'));

    // Same session within 2 s collapses into one run even though content changed.
    await tmp.write('one/index.html', '<p>more</p>');
    const collapsed = await versions.turn('ses_x');
    assert.deepEqual(collapsed, created, 'the dedupe window answers the first run');
    await sleep(2100);
    const after = await versions.turn('ses_x');
    assert.equal(after.length, 1, 'after the window the change is captured');
    assert.equal(after[0]?.slug, 'one');
  });

  test('a turn that ends after the quiet-period auto snapshot promotes that auto version to "turn"', async (t) => {
    const { tmp, ctx, versions } = await setup(t, 40);
    await tmp.writeDesign('art', {
      ...pageDesign(),
      'design.json': { version: 1, kind: 'page', title: 'Art', created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T10:00:00.000Z', sessionId: 'ses_x' },
    });
    await versions.create('art', 'manual'); // v1
    await tmp.write('art/index.html', '<p>agent wrote</p>');
    ctx.hub.emit({ slug: 'art', kind: 'files', files: ['index.html'] });
    await sleep(200);
    assert.equal((await versions.list('art')).versions[0]?.reason, 'auto', 'v2 is the auto snapshot');

    const turned = await versions.turn('ses_x');
    assert.deepEqual(turned.map((entry) => entry.id), ['v2'], 'no duplicate version: v2 is the turn result');
    const list = await versions.list('art');
    assert.deepEqual(list.versions.map((entry) => `${entry.id}:${entry.reason}`), ['v2:turn', 'v1:manual']);

    // A manual version with the same files is never relabelled.
    await sleep(2100);
    await tmp.write('art/index.html', '<p>by hand</p>');
    await versions.create('art', 'manual'); // v3
    assert.deepEqual(await versions.turn('ses_x'), []);
    assert.equal((await versions.list('art')).versions[0]?.reason, 'manual');
  });

  test('restore writes the old tree back, deletes extra files, and records restore-point + restored', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', {
      ...pageDesign(),
      'design.json': {
        version: 1,
        kind: 'page',
        title: 'Original title',
        created: '2026-10-26T10:00:00.000Z',
        updated: '2026-10-26T10:00:00.000Z',
      },
    });
    const v1 = await versions.create('art', 'manual');
    assert.ok(v1);

    // The agent rewrites and adds files, then a manual snapshot pins that state.
    await tmp.write('art/index.html', '<p>rewrite</p>');
    await tmp.write('art/extra.txt', 'added later');
    await tmp.write(
      'art/design.json',
      JSON.stringify({ version: 1, kind: 'page', title: 'Renamed by agent', created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T11:00:00.000Z' }),
    );
    const v2 = await versions.create('art', 'manual');
    assert.ok(v2);

    // A dirty change with no snapshot → restore must save it as the restore-point.
    await tmp.write('art/index.html', '<p>unsaved edit</p>');
    const result = await versions.restore('art', 'v1');
    assert.ok(result.restorePoint, 'the unsaved state was saved first');
    assert.equal(result.restorePoint.reason, 'restore-point');
    assert.equal(result.restored.reason, 'restored');

    const restoredHtml = await readFile(tmp.at('art/index.html'), 'utf8');
    assert.ok(restoredHtml.includes('<h1>hello</h1>'), 'the v1 entry HTML is back');
    const restoredDesign = JSON.parse(await readFile(tmp.at('art/design.json'), 'utf8')) as { title: string };
    assert.equal(restoredDesign.title, 'Original title');
    const extra = await readFile(tmp.at('art/extra.txt'), 'utf8').catch(() => null);
    assert.equal(extra, null, 'files added after the version are deleted');

    const list = await versions.list('art');
    assert.equal(list.dirty, false, 'the restored tree matches the newest version');
    assert.deepEqual(
      list.versions.map((entry) => entry.reason),
      ['restored', 'restore-point', 'manual', 'manual'],
    );
    assert.equal(list.versions[0]?.treeHash, v1.treeHash, 'the restored snapshot has the v1 tree hash');
  });

  test('restore keeps CURRENT comments and sessionId (never taken from the snapshot)', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    await versions.create('art', 'manual'); // v1: no session, no comments

    // WP1's state.json is the truth for service-owned fields; simulate a later link + comment.
    await tmp.write(
      'art/.chamber/state.json',
      JSON.stringify({
        version: 1,
        kind: 'page',
        created: '2026-10-26T10:00:00.000Z',
        brief: '',
        sessionId: 'ses_now',
        projectDirectory: null,
        preset: null,
        entry: 'index.html',
        comments: [
          { id: 'c_now1', screen: null, viewport: 'laptop', anchor: { selector: 'h1', text: 'hello', html: '<h1>', rect: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 0.5, y: 0.5 } }, body: 'keep me', status: 'open', created: '2026-10-26T12:00:00.000Z', sentAt: null, sentVersion: null },
        ],
      }),
    );
    await tmp.write('art/index.html', '<p>agent changed it</p>');
    await versions.create('art', 'manual'); // v2

    await versions.restore('art', 'v1');
    const design = JSON.parse(await readFile(tmp.at('art/design.json'), 'utf8')) as { sessionId: string | null; comments: { id: string }[] };
    assert.equal(design.sessionId, 'ses_now', 'the current session link survives the restore');
    assert.deepEqual(
      design.comments.map((comment) => comment.id),
      ['c_now1'],
      'the current comments survive the restore',
    );
    assert.ok((await readFile(tmp.at('art/index.html'), 'utf8')).includes('<h1>hello</h1>'), 'agent content was restored');
  });

  test('restoring the newest version is a no-op that still answers the version', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    const v1 = await versions.create('art', 'manual');
    assert.ok(v1);
    const result = await versions.restore('art', 'v1');
    assert.equal(result.restorePoint, null, 'nothing unsaved → no restore-point');
    assert.equal(result.restored.id, 'v1', 'the existing version is answered, no duplicate entry');
    assert.equal((await versions.list('art')).versions.length, 1);
  });

  test('diff against current and against another version', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    await versions.create('art', 'manual'); // v1
    await tmp.write('art/index.html', '<p>changed</p>');
    await tmp.write('art/added.txt', 'new');
    await versions.create('art', 'manual'); // v2
    await tmp.write('art/index.html', '<p>changed again</p>');

    const againstCurrent = await versions.diff('art', 'v1', 'current');
    assert.deepEqual(againstCurrent.files, [
      { path: 'added.txt', change: 'added' },
      { path: 'index.html', change: 'modified' },
    ]);

    const v1v2 = await versions.diff('art', 'v1', 'v2');
    assert.deepEqual(v1v2.files, [
      { path: 'added.txt', change: 'added' },
      { path: 'index.html', change: 'modified' },
    ]);
    const same = await versions.diff('art', 'v2', 'v2');
    assert.deepEqual(same.files, []);
  });

  test('prune keeps the newest 100 versions and GC removes unreferenced objects', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', { 'index.html': 'seed 0' });
    for (let i = 1; i <= 105; i += 1) {
      await tmp.write('art/index.html', `seed ${i}`);
      const created = await versions.create('art', 'manual');
      assert.ok(created, `snapshot ${i}`);
    }
    const list = await versions.list('art');
    assert.equal(list.versions.length, 100, 'the oldest versions are pruned');
    assert.equal(list.versions[0]?.n, 105);
    assert.equal(list.versions[99]?.n, 6, 'pruning keeps the newest window');

    const referenced = new Set<string>();
    const index = JSON.parse(await readFile(indexFile(tmp, 'art'), 'utf8')) as { versions: { files: Record<string, string> }[] };
    for (const entry of index.versions) for (const hash of Object.values(entry.files)) referenced.add(hash);
    const objects = await allObjects(objectsDir(tmp, 'art'));
    for (const hash of objects) assert.ok(referenced.has(hash), `object ${hash} is still referenced`);
    assert.ok(objects.length < 110, 'orphaned seed objects were collected');
  });

  test('unknown ids and damaged versions are refused with user-facing errors', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    await versions.create('art', 'manual');
    await assert.rejects(versions.restore('art', 'v9'), ApiError);
    await assert.rejects(versions.diff('art', 'nope', 'current'), ApiError);
    await assert.rejects(versions.readTree('art', 'v9'), ApiError);

    // A deleted object makes the version unrestorable — but the refusal happens BEFORE any write.
    const objects = await allObjects(objectsDir(tmp, 'art'));
    const victim = objects[0];
    assert.ok(victim);
    await rm(path.join(objectsDir(tmp, 'art'), victim.slice(0, 2), victim));
    await assert.rejects(versions.restore('art', 'v1'), /damaged/);
    assert.ok((await readFile(tmp.at('art/index.html'), 'utf8')).includes('hello'), 'nothing was written');
  });

  test('a tampered index.json cannot make restore read or write outside the design folder', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    const created = await versions.create('art', 'manual');
    assert.ok(created);
    const index = JSON.parse(await readFile(indexFile(tmp, 'art'), 'utf8')) as { versions: { files: Record<string, string> }[] };
    const entry = index.versions[0];
    assert.ok(entry);
    const hash = Object.values(entry.files)[0];
    assert.ok(hash);
    const tampered: Record<string, string>[] = [{ '../escaped.txt': hash }, { 'C:/escaped.txt': hash }, { 'index.html': '../../../../etc/passwd' }];
    for (const files of tampered) {
      entry.files = files;
      await tmp.write('art/.versions/index.json', index);
      await assert.rejects(versions.restore('art', created.id), ApiError);
    }
    await assert.rejects(readFile(tmp.at('escaped.txt')), 'nothing was written next to the design');
    assert.ok((await readFile(tmp.at('art/index.html'), 'utf8')).includes('hello'), 'the design is untouched');
  });

  test('an empty design folder has the empty tree hash and is not dirty', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.write('art/placeholder.txt', '');
    await rm(tmp.at('art/placeholder.txt'));
    const list = await versions.list('art');
    assert.equal(list.currentTreeHash, EMPTY_TREE_HASH);
    assert.equal(list.dirty, false);
    assert.equal(list.versions.length, 0);
  });
});

// ---- phase-0 0a: a damaged index never costs the history ----

const versionsDirOf = (tmp: TmpRoot, slug: string): string => tmp.at(`${slug}/.versions`);

const damagedFiles = async (tmp: TmpRoot, slug: string): Promise<string[]> =>
  (await readdir(versionsDirOf(tmp, slug)).catch(() => [])).filter((name) => name.startsWith('index.damaged-')).sort();

type RawIndex = { version: number; next: number; versions: { id: string; files: Record<string, string>; treeHash: string }[] };
const readRawIndex = async (tmp: TmpRoot, slug: string): Promise<RawIndex> => JSON.parse(await readFile(indexFile(tmp, slug), 'utf8')) as RawIndex;

/** n versions, each with its own index.html content ("page 1" … "page n"). */
const seedVersions = async (tmp: TmpRoot, versions: VersionsService, slug: string, n: number): Promise<void> => {
  await tmp.writeDesign(slug, pageDesign({ 'index.html': 'page 1' }));
  for (let i = 1; i <= n; i += 1) {
    if (i > 1) await tmp.write(`${slug}/index.html`, `page ${i}`);
    assert.ok(await versions.create(slug, 'manual'), `version ${i}`);
  }
};

describe('version history survives a damaged index', () => {
  test('★ a truncated index is recovered from the backup, set aside, and costs no object', async (t) => {
    const { tmp, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 5);
    const objectsBefore = await allObjects(objectsDir(tmp, 'art'));
    const original = await readFile(indexFile(tmp, 'art'), 'utf8');
    const truncated = original.slice(0, Math.floor(original.length / 2));
    await writeFile(indexFile(tmp, 'art'), truncated);

    const before = await versions.list('art');
    assert.equal(before.versions.length, 5, 'the backup restores the whole list');
    assert.equal(before.history, 'recovered');
    assert.equal(await readFile(indexFile(tmp, 'art'), 'utf8'), truncated, 'list only reads');
    assert.deepEqual(await damagedFiles(tmp, 'art'), [], 'list sets nothing aside');

    await tmp.write('art/index.html', 'page 6');
    const created = await versions.create('art', 'manual');
    assert.equal(created?.id, 'v6');

    const objectsAfter = new Set(await allObjects(objectsDir(tmp, 'art')));
    for (const hash of objectsBefore) assert.ok(objectsAfter.has(hash), `object ${hash} was kept`);
    const aside = await damagedFiles(tmp, 'art');
    assert.equal(aside.length, 1);
    assert.match(aside[0] ?? '', /-recovered\.json$/);
    assert.equal(await readFile(path.join(versionsDirOf(tmp, 'art'), aside[0] ?? ''), 'utf8'), truncated, 'the damaged copy holds the original bytes');
    const after = await versions.list('art');
    assert.equal(after.versions.length, 6);
    assert.equal(after.history, 'recovered');
  });

  test('every index write also writes a byte-identical backup', async (t) => {
    const { tmp, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 2);
    assert.equal(await readFile(path.join(versionsDirOf(tmp, 'art'), 'index.bak.json'), 'utf8'), await readFile(indexFile(tmp, 'art'), 'utf8'));
  });

  test('★ one invalid entry is hidden, the others stay, and its objects survive the next snapshot', async (t) => {
    const { tmp, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 5);
    const index = await readRawIndex(tmp, 'art');
    const victim = index.versions[2];
    assert.ok(victim);
    const victimHash = victim.files['index.html'];
    assert.ok(victimHash);
    victim.treeHash = 'not-a-hash';
    const damagedBytes = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexFile(tmp, 'art'), damagedBytes);

    const before = await versions.list('art');
    assert.deepEqual(before.versions.map((v) => v.id), ['v5', 'v4', 'v2', 'v1']);
    assert.equal(before.history, 'repaired');
    assert.equal(await readFile(indexFile(tmp, 'art'), 'utf8'), damagedBytes, 'list does not write');

    await tmp.write('art/index.html', 'page 6');
    assert.ok(await versions.create('art', 'manual'));
    const objects = await allObjects(objectsDir(tmp, 'art'));
    assert.ok(objects.includes(victimHash), 'the dropped entry keeps its file');
    assert.match((await damagedFiles(tmp, 'art'))[0] ?? '', /-entries\.json$/);
    const after = await versions.list('art');
    assert.equal(after.versions.length, 5);
    assert.equal(after.history, 'repaired');
  });

  test('★ no backup and a ruined index: history is reset, ids never repeat, old objects stay', async (t) => {
    const { tmp, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 3);
    const objectsBefore = await allObjects(objectsDir(tmp, 'art'));
    const original = await readFile(indexFile(tmp, 'art'), 'utf8');
    const ruined = original.slice(0, original.lastIndexOf('"bytes"') + 8); // names every hash and v3, then stops
    await writeFile(indexFile(tmp, 'art'), ruined);
    await rm(path.join(versionsDirOf(tmp, 'art'), 'index.bak.json'), { force: true });

    assert.equal((await versions.list('art')).history, 'reset');
    await tmp.write('art/index.html', 'page 4');
    const created = await versions.create('art', 'manual');
    assert.equal(created?.id, 'v4', 'the new id is above every id the damaged file names');
    const objectsAfter = new Set(await allObjects(objectsDir(tmp, 'art')));
    for (const hash of objectsBefore) assert.ok(objectsAfter.has(hash), `object ${hash} was kept`);
    assert.match((await damagedFiles(tmp, 'art'))[0] ?? '', /-reset\.json$/);
    const after = await versions.list('art');
    assert.equal(after.history, 'reset');
    assert.deepEqual(after.versions.map((v) => v.id), ['v4']);
  });

  test('a missing index next to stored objects is a reset with an orphans note', async (t) => {
    const { tmp, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 2);
    const objectsBefore = await allObjects(objectsDir(tmp, 'art'));
    await rm(indexFile(tmp, 'art'), { force: true });
    await rm(path.join(versionsDirOf(tmp, 'art'), 'index.bak.json'), { force: true });

    assert.equal((await versions.list('art')).history, 'reset');
    await tmp.write('art/index.html', 'page 3');
    assert.ok(await versions.create('art', 'manual'));

    const aside = await damagedFiles(tmp, 'art');
    assert.equal(aside.length, 1);
    const note = JSON.parse(await readFile(path.join(versionsDirOf(tmp, 'art'), aside[0] ?? ''), 'utf8')) as { orphans: string[] };
    assert.deepEqual([...note.orphans].sort(), [...objectsBefore].sort());
    const objectsAfter = new Set(await allObjects(objectsDir(tmp, 'art')));
    for (const hash of objectsBefore) assert.ok(objectsAfter.has(hash), `object ${hash} was kept`);
  });

  test('a brand new design (no index, no objects) is healthy and has no notice', async (t) => {
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    const list = await versions.list('art');
    assert.equal(list.history, undefined);
    assert.ok(await versions.create('art', 'manual'));
    assert.deepEqual(await damagedFiles(tmp, 'art'), []);
    assert.equal((await versions.list('art')).history, undefined);
  });

  test('★ an index from a newer build is refused and left byte for byte alone', async (t) => {
    const { tmp, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 1);
    const index = await readRawIndex(tmp, 'art');
    index.version = 2;
    const newer = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexFile(tmp, 'art'), newer);
    await tmp.write('art/index.html', 'page 2');

    await assert.rejects(versions.create('art', 'manual'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /newer version of Design Chamber/);
      return true;
    });
    await assert.rejects(versions.restore('art', 'v1'), (error: unknown) => error instanceof ApiError && error.code === 'invalid');
    assert.equal(await readFile(indexFile(tmp, 'art'), 'utf8'), newer);
    assert.deepEqual(await damagedFiles(tmp, 'art'), []);
    const list = await versions.list('art');
    assert.equal(list.history, 'unsupported');
    assert.deepEqual(list.versions, []);
  });

  test('an index.json that cannot be read (here: a folder) is an error, not an empty history', async (t) => {
    const { tmp, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 2);
    const objectsBefore = (await allObjects(objectsDir(tmp, 'art'))).sort();
    await rm(indexFile(tmp, 'art'), { force: true });
    await mkdir(indexFile(tmp, 'art'));
    await tmp.write('art/index.html', 'page 3');

    await assert.rejects(versions.list('art'), (error: unknown) => error instanceof ApiError && error.code === 'internal' && /could not read this design's version history/.test(error.message));
    await assert.rejects(versions.create('art', 'manual'), (error: unknown) => error instanceof ApiError && error.code === 'internal');
    assert.deepEqual((await allObjects(objectsDir(tmp, 'art'))).sort(), objectsBefore, 'nothing was stored or deleted');
    assert.deepEqual(await damagedFiles(tmp, 'art'), []);
    assert.ok((await stat(indexFile(tmp, 'art'))).isDirectory());
  });

  test('an unreadable backup stops garbage collection instead of guessing', async (t) => {
    const { tmp, ctx, versions } = await setup(t);
    await seedVersions(tmp, versions, 'art', 1);
    const stray = 'ab'.padEnd(64, 'c');
    await mkdir(path.join(objectsDir(tmp, 'art'), 'ab'), { recursive: true });
    await writeFile(path.join(objectsDir(tmp, 'art'), 'ab', stray), 'orphan');
    const backup = path.join(versionsDirOf(tmp, 'art'), 'index.bak.json');
    await rm(backup, { force: true });
    await mkdir(backup); // a folder where the backup should be: reading it fails with EISDIR

    await tmp.write('art/index.html', 'page 2');
    assert.ok(await versions.create('art', 'manual'));
    assert.ok((await allObjects(objectsDir(tmp, 'art'))).includes(stray), 'GC skipped, the stray object is still there');
    assert.ok(ctx.logs.some((line) => line.event === 'versions.gc-skipped'));
  });

  test('★ a damaged copy protects its objects for 30 days, then they are collected', async (t) => {
    let clock = Date.parse('2026-11-01T12:00:00.000Z');
    const { tmp, versions } = await setup(t, 40, () => clock);
    await seedVersions(tmp, versions, 'art', 2);
    const index = await readRawIndex(tmp, 'art');
    const onlyInDamaged = index.versions.map((v) => v.files['index.html'] ?? '');
    assert.equal(onlyInDamaged.length, 2);
    const original = await readFile(indexFile(tmp, 'art'), 'utf8');
    const ruined = original.slice(0, original.lastIndexOf('"bytes"') + 8); // ruined, still names its hashes
    await writeFile(indexFile(tmp, 'art'), ruined);
    await rm(path.join(versionsDirOf(tmp, 'art'), 'index.bak.json'), { force: true });
    const protectedHashes = onlyInDamaged.filter((hash) => ruined.includes(hash));
    assert.equal(protectedHashes.length, 2, 'both pages are named by the damaged copy');

    await tmp.write('art/index.html', 'page 3');
    assert.ok(await versions.create('art', 'manual'));
    clock += 29 * 24 * 60 * 60 * 1000;
    await tmp.write('art/index.html', 'page 4');
    assert.ok(await versions.create('art', 'manual'));
    let objects = await allObjects(objectsDir(tmp, 'art'));
    for (const hash of protectedHashes) assert.ok(objects.includes(hash), 'still protected on day 29');
    assert.equal((await damagedFiles(tmp, 'art')).length, 2, 'the damaged index and the note naming every stored object');

    clock += 2 * 24 * 60 * 60 * 1000;
    await tmp.write('art/index.html', 'page 5');
    assert.ok(await versions.create('art', 'manual'));
    objects = await allObjects(objectsDir(tmp, 'art'));
    for (const hash of protectedHashes) assert.ok(!objects.includes(hash), 'collected on day 31');
    assert.deepEqual(await damagedFiles(tmp, 'art'), [], 'the damaged copy is gone');
    assert.equal((await versions.list('art')).history, undefined, 'and so is the notice');
  });

  test('only the newest five damaged copies are kept', async (t) => {
    let clock = Date.parse('2026-11-01T12:00:00.000Z');
    const { tmp, versions } = await setup(t, 40, () => clock);
    await seedVersions(tmp, versions, 'art', 1);
    for (let round = 1; round <= 7; round += 1) {
      clock += 60_000;
      await writeFile(indexFile(tmp, 'art'), `broken ${round}`);
      await tmp.write('art/index.html', `round ${round}`);
      assert.ok(await versions.create('art', 'manual'));
    }
    assert.equal((await damagedFiles(tmp, 'art')).length, 5);
  });

  test('a .versions folder that is a link out of the design is refused and nothing is written outside', async (t) => {
    if (process.platform === 'win32') return t.skip('creating a symlink needs a privilege on Windows');
    const { tmp, versions } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    const outside = tmp.at('elsewhere');
    await mkdir(outside, { recursive: true });
    await symlink(outside, versionsDirOf(tmp, 'art'), 'dir');

    await assert.rejects(versions.create('art', 'manual'), (error: unknown) => error instanceof ApiError && error.code === 'bad-path');
    await assert.rejects(versions.restore('art', 'v1'), (error: unknown) => error instanceof ApiError);
    await assert.rejects(versions.list('art'), (error: unknown) => error instanceof ApiError && error.code === 'bad-path');
    assert.deepEqual(await readdir(outside), [], 'nothing was created outside the design');
  });
});
