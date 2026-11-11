// The self-write registry (Phase 2 technical design §2.6, E10): the last bytes the service
// itself left at each (slug, file). The last-bytes rule, no consumption, no TTL, bounded, and
// an agent write of different bytes is never dropped.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { SELF_WRITES_MAX, SOURCE_TEXT_MAX } from '../../../src/shared/limits.ts';
import { createSelfWrites } from '../../../src/service/self-writes.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('self-writes: the last-bytes rule', () => {
  test('the file the service left reads as an echo; other bytes do not', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'user bytes' });
    const self = createSelfWrites();
    self.record('demo', 'index.html', sha256('user bytes'), 'user bytes'.length);
    assert.equal(await self.isEcho('demo', 'index.html', dir), true);

    // The agent writes different bytes: not an echo, so the event is shown.
    await writeFile(tmp.at('demo/index.html'), 'agent bytes');
    assert.equal(await self.isEcho('demo', 'index.html', dir), false);
  });

  test('never consumed and no TTL: a second event for the same bytes is still an echo', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'user bytes' });
    const self = createSelfWrites();
    self.record('demo', 'index.html', sha256('user bytes'), 'user bytes'.length);
    // Windows reports one rename as two events; the poll backstop sees it ~30 s later.
    assert.equal(await self.isEcho('demo', 'index.html', dir), true);
    assert.equal(await self.isEcho('demo', 'index.html', dir), true);
    assert.equal(await self.isEcho('demo', 'index.html', dir), true);
  });

  test('a later record replaces the earlier one (last bytes win)', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'second' });
    const self = createSelfWrites();
    self.record('demo', 'index.html', sha256('first'), 'first'.length);
    self.record('demo', 'index.html', sha256('second'), 'second'.length);
    assert.equal(await self.isEcho('demo', 'index.html', dir), true);
  });

  test('B then A again: after forget, the restored user bytes are shown, not hidden', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'A' });
    const self = createSelfWrites();
    self.record('demo', 'index.html', sha256('A'), 1);
    assert.equal(await self.isEcho('demo', 'index.html', dir), true);

    // The agent writes B: not an echo, and the watcher forgets the entry.
    await writeFile(tmp.at('demo/index.html'), 'B');
    assert.equal(await self.isEcho('demo', 'index.html', dir), false);
    self.forget('demo', 'index.html');

    // The agent writes A again: without forget this would read as the user's echo and be
    // hidden, and the wall would keep B. With it, the event is shown.
    await writeFile(tmp.at('demo/index.html'), 'A');
    assert.equal(await self.isEcho('demo', 'index.html', dir), false);
  });

  test('a different size is not an echo (no read needed)', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'much longer agent bytes' });
    const self = createSelfWrites();
    self.record('demo', 'index.html', sha256('short'), 'short'.length);
    assert.equal(await self.isEcho('demo', 'index.html', dir), false);
  });

  test('same size, different bytes: the hash decides', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'bbbb' });
    const self = createSelfWrites();
    self.record('demo', 'index.html', sha256('aaaa'), 4);
    assert.equal(await self.isEcho('demo', 'index.html', dir), false);
  });

  test('null means removed: absent is the echo, a present file is not', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'screens/home.html': 'x' });
    const self = createSelfWrites();
    self.record('demo', 'screens/home.html', null, null);
    assert.equal(await self.isEcho('demo', 'screens/home.html', dir), false);
    const { rm } = await import('node:fs/promises');
    await rm(tmp.at('demo/screens/home.html'));
    assert.equal(await self.isEcho('demo', 'screens/home.html', dir), true);
  });

  test('no entry is never an echo; a file over SOURCE_TEXT_MAX is never recorded', async (t) => {
    const tmp = await useTmpRoot(t);
    const big = 'x'.repeat(SOURCE_TEXT_MAX + 1);
    const dir = await tmp.writeDesign('demo', { 'index.html': big, 'other.html': 'y' });
    const self = createSelfWrites();
    assert.equal(await self.isEcho('demo', 'other.html', dir), false);
    self.record('demo', 'index.html', sha256(big), big.length);
    assert.equal(await self.isEcho('demo', 'index.html', dir), false);
  });
});

describe('self-writes: bounded and scoped', () => {
  test(`at most ${SELF_WRITES_MAX} entries, least recently recorded dropped first`, async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'x' });
    const self = createSelfWrites();
    // null entries read as echoes of absent files, so the LRU is testable without 1024 files.
    for (let index = 0; index < SELF_WRITES_MAX; index += 1) {
      self.record('demo', `f${index}.html`, null, null);
    }
    // Refresh the first entry, then overflow by one: the SECOND entry is now the oldest.
    self.record('demo', 'f0.html', null, null);
    self.record('demo', 'overflow.html', null, null);
    assert.equal(await self.isEcho('demo', 'f0.html', dir), true, 'the refreshed entry stays');
    assert.equal(await self.isEcho('demo', 'f1.html', dir), false, 'the least recently recorded was dropped');
    assert.equal(await self.isEcho('demo', 'overflow.html', dir), true);
  });

  test('forgetDesign drops one design only; clear drops everything', async (t) => {
    const tmp = await useTmpRoot(t);
    const dirA = await tmp.writeDesign('a', { 'index.html': 'x' });
    const dirB = await tmp.writeDesign('b', { 'index.html': 'x' });
    const self = createSelfWrites();
    self.record('a', 'index.html', sha256('x'), 1);
    self.record('b', 'index.html', sha256('x'), 1);
    self.forgetDesign('a');
    assert.equal(await self.isEcho('a', 'index.html', dirA), false);
    assert.equal(await self.isEcho('b', 'index.html', dirB), true);
    self.clear();
    assert.equal(await self.isEcho('b', 'index.html', dirB), false);
  });

  test('entries are per (slug, file): one design\'s write is never another\'s echo', async (t) => {
    const tmp = await useTmpRoot(t);
    const dirA = await tmp.writeDesign('a', { 'index.html': 'x' });
    const dirB = await tmp.writeDesign('b', { 'index.html': 'x' });
    const self = createSelfWrites();
    self.record('a', 'index.html', sha256('x'), 1);
    assert.equal(await self.isEcho('a', 'index.html', dirA), true);
    assert.equal(await self.isEcho('b', 'index.html', dirB), false);
  });

  test('the registry holds bytes, not a clock: reading the file never changes the entry', async (t) => {
    const tmp = await useTmpRoot(t);
    const dir = await tmp.writeDesign('demo', { 'index.html': 'x' });
    const self = createSelfWrites();
    self.record('demo', 'index.html', sha256('x'), 1);
    for (let round = 0; round < 3; round += 1) {
      assert.equal(await self.isEcho('demo', 'index.html', dir), true);
      assert.equal(await readFile(tmp.at('demo/index.html'), 'utf8'), 'x');
    }
  });
});