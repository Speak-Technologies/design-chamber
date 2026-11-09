// Restore safety (review 2026-10-27, C1 + C2): a restore either completes from a version that
// stays intact, or refuses before writing anything when no restore point can be stored.

import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { SNAPSHOT_FILES_MAX, VERSIONS_KEEP } from '../../../src/shared/limits.ts';
import { pageDesign } from './harness.ts';

describe('version restore safety', () => {
  test('C1 — restoring the oldest version when the history is full restores it completely', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000 });

    await tmp.writeDesign('art', pageDesign({ 'index.html': '<p>oldest-unique</p>' }));
    const oldest = await versions.create('art', 'manual');
    assert.ok(oldest);
    for (let n = 2; n <= VERSIONS_KEEP; n += 1) {
      await tmp.write('art/index.html', `<p>edit ${n}</p>`);
      assert.ok(await versions.create('art', 'manual'));
    }
    // Dirty design: the restore takes a restore point first, which must not prune the target.
    await tmp.write('art/index.html', '<p>unsaved work</p>');

    const result = await versions.restore('art', oldest.id);
    assert.equal(await readFile(tmp.at('art/index.html'), 'utf8'), '<p>oldest-unique</p>');
    assert.ok(result.restorePoint, 'the unsaved work is kept as a restore point');
    const listed = await versions.list('art');
    assert.ok(listed.versions.length <= VERSIONS_KEEP);
    assert.equal(listed.dirty, false);
    // The restore point holds the unsaved work and can be restored back.
    await versions.restore('art', result.restorePoint.id);
    assert.equal(await readFile(tmp.at('art/index.html'), 'utf8'), '<p>unsaved work</p>');
  });

  test('C2 — a design too large for a restore point refuses the restore and changes nothing', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000 });

    await tmp.writeDesign('art', pageDesign());
    const v1 = await versions.create('art', 'manual');
    assert.ok(v1);
    // The agent later edits the page and adds more assets than a snapshot may hold.
    await tmp.write('art/index.html', '<p>newer page</p>');
    for (let n = 0; n <= SNAPSHOT_FILES_MAX; n += 1) await tmp.write(`art/assets/a${n}.txt`, `asset ${n}`);

    await assert.rejects(versions.restore('art', v1.id), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /too large to keep a restore point/);
      return true;
    });
    assert.equal(await readFile(tmp.at('art/assets/a0.txt'), 'utf8'), 'asset 0');
    assert.equal(await readFile(tmp.at(`art/assets/a${SNAPSHOT_FILES_MAX}.txt`), 'utf8'), `asset ${SNAPSHOT_FILES_MAX}`);
    assert.equal(await readFile(tmp.at('art/index.html'), 'utf8'), '<p>newer page</p>');
    assert.equal((await versions.list('art')).versions.length, 1);
  });

  const comment = (id: string, body: string): object => ({
    id,
    screen: null,
    viewport: 'laptop',
    anchor: { selector: 'h1', text: 'hello', html: '<h1>', rect: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 0.5, y: 0.5 } },
    body,
    status: 'open',
    created: '2026-10-26T12:00:00.000Z',
    sentAt: null,
    sentVersion: null,
  });
  const designWith = (comments: object[]): object => ({
    version: 1,
    kind: 'page',
    title: 'Test artifact',
    created: '2026-10-26T10:00:00.000Z',
    updated: '2026-10-26T10:00:00.000Z',
    comments,
  });

  test('★ restore keeps the live comments even when state.json is missing', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000 });

    await tmp.writeDesign('art', pageDesign({ 'design.json': designWith([comment('c_aaaa', 'first pin'), comment('c_bbbb', 'second pin')]) }));
    await rm(tmp.at('art/.chamber/state.json'), { force: true });
    const v1 = await versions.create('art', 'manual');
    assert.ok(v1);
    await tmp.write('art/index.html', '<p>agent rewrote it</p>');
    assert.ok(await versions.create('art', 'manual'));

    await versions.restore('art', v1.id);
    const onDisk = JSON.parse(await readFile(tmp.at('art/design.json'), 'utf8')) as { comments?: { id: string }[] };
    assert.deepEqual(onDisk.comments?.map((c) => c.id), ['c_aaaa', 'c_bbbb'], 'design.json still carries both comments');
    const record = await ctx.store.get('art');
    assert.deepEqual(record.state.comments.map((c) => c.id), ['c_aaaa', 'c_bbbb'], 'and so does the store');
    assert.ok((await readFile(tmp.at('art/index.html'), 'utf8')).includes('hello'), 'the files were restored');
  });

  test('a version whose design.json does not parse refuses to restore over live comments, before writing anything', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000 });

    await tmp.writeDesign('art', pageDesign({ 'design.json': '{"version": 1, "title": "half written' }));
    const v1 = await versions.create('art', 'manual');
    assert.ok(v1);
    await tmp.write('art/design.json', designWith([comment('c_aaaa', 'live pin')]));
    await tmp.write('art/index.html', '<p>newer page</p>');
    const designBefore = await readFile(tmp.at('art/design.json'), 'utf8');

    await assert.rejects(versions.restore('art', v1.id), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /would lose your comments\. Nothing was changed\./);
      return true;
    });
    assert.equal(await readFile(tmp.at('art/design.json'), 'utf8'), designBefore);
    assert.equal(await readFile(tmp.at('art/index.html'), 'utf8'), '<p>newer page</p>');
    assert.equal((await versions.list('art')).versions.length, 1, 'no restore point was made');
  });

  test('a version whose design.json does not parse still restores when state.json holds the comments', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000 });

    await tmp.writeDesign('art', pageDesign({ 'design.json': 'not json yet' }));
    const v1 = await versions.create('art', 'manual');
    assert.ok(v1);
    await tmp.write('art/design.json', designWith([comment('c_aaaa', 'live pin')]));
    await ctx.store.get('art'); // reads only; state.json is written below, as the store would have
    const state = { version: 1, kind: 'page', created: '2026-10-26T10:00:00.000Z', brief: '', sessionId: null, projectDirectory: null, preset: null, entry: 'index.html', comments: [comment('c_aaaa', 'live pin')] };
    await tmp.write('art/.chamber/state.json', state);
    await tmp.write('art/index.html', '<p>newer page</p>');

    await versions.restore('art', v1.id);
    assert.equal(await readFile(tmp.at('art/design.json'), 'utf8'), 'not json yet', 'written as stored');
    const kept = JSON.parse(await readFile(tmp.at('art/.chamber/state.json'), 'utf8')) as { comments: { id: string }[] };
    assert.deepEqual(kept.comments.map((c) => c.id), ['c_aaaa'], 'state.json still has the comment');
  });
});
