// The write primitives every hand edit uses against the agent (Phase 2 technical design §2.5):
// `replaceFileIfHashUnchanged` (the bytes compare-and-swap at the rename) and `moveNoReplace`
// (creates and moves that never overwrite). Risk logic: each rule here is mutation-checked.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { moveNoReplace, replaceFileIfHashUnchanged, type MoveDeps } from '../../../src/service/paths.ts';
import { refuseRenames, refuseSyncReads, refuseSyncRenames } from '../../helpers/refuse-rename.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const errno = (code: string): Error => Object.assign(new Error(code), { code });

/** No temp file is ever left behind in `dir`. */
const assertNoTemps = async (dir: string): Promise<void> => {
  const names = await readdir(dir);
  assert.deepEqual(
    names.filter((name) => name.endsWith('.tmp')),
    [],
    `temp files left: ${names.join(', ')}`,
  );
};

describe('replaceFileIfHashUnchanged', () => {
  test('replaces the file while it still holds the bytes the page read', async (t) => {
    const tmp = await useTmpRoot(t);
    const file = await tmp.write('d/index.html', '<h1>Ship faster</h1>');
    const answer = await replaceFileIfHashUnchanged(file, sha256('<h1>Ship faster</h1>'), bytes('<h1>Ship it faster</h1>'));
    assert.equal(answer, 'replaced');
    assert.equal(await readFile(file, 'utf8'), '<h1>Ship it faster</h1>');
    await assertNoTemps(tmp.at('d'));
  });

  test('an agent write since the read answers changed and writes nothing', async (t) => {
    const tmp = await useTmpRoot(t);
    const file = await tmp.write('d/index.html', '<h1>Ship faster</h1>');
    const readHash = sha256('<h1>Ship faster</h1>');
    await writeFile(file, '<h1>The agent was here</h1>');
    const answer = await replaceFileIfHashUnchanged(file, readHash, bytes('<h1>Ship it faster</h1>'));
    assert.equal(answer, 'changed');
    assert.equal(await readFile(file, 'utf8'), '<h1>The agent was here</h1>');
    await assertNoTemps(tmp.at('d'));
  });

  test('compares bytes, not decoded text: a BOM or an invalid byte the decoder hides still counts', async (t) => {
    const tmp = await useTmpRoot(t);
    // The file holds an invalid byte; the decoder turns it into U+FFFD, so the decoded text equals
    // a file that really holds U+FFFD. A compare of decoded text would accept that file's hash.
    const file = await tmp.write('d/index.html', Uint8Array.from([0x3c, 0xff, 0x3e]));
    const answer = await replaceFileIfHashUnchanged(file, sha256(Buffer.from('<�>', 'utf8')), bytes('<p>new</p>'));
    assert.equal(answer, 'changed');
    assert.deepEqual([...(await readFile(file))], [0x3c, 0xff, 0x3e]);
  });

  test('null expects the file absent: a create, refused when something appeared there', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('d/keep.txt', 'x');
    const file = tmp.at('d/new.html');
    assert.equal(await replaceFileIfHashUnchanged(file, null, bytes('fresh')), 'replaced');
    assert.equal(await readFile(file, 'utf8'), 'fresh');
    assert.equal(await replaceFileIfHashUnchanged(file, null, bytes('again')), 'changed');
    assert.equal(await readFile(file, 'utf8'), 'fresh');
    // And a file that vanished is not the bytes the page read.
    assert.equal(await replaceFileIfHashUnchanged(tmp.at('d/gone.html'), sha256('x'), bytes('y')), 'changed');
    await assertNoTemps(tmp.at('d'));
  });

  test('a Windows lock on the rename answers busy, leaves the file as it was and no temp', async (t) => {
    const tmp = await useTmpRoot(t);
    const file = await tmp.write('d/index.html', 'before');
    const refusal = refuseSyncRenames(t, (destination) => destination === file);
    assert.equal(await replaceFileIfHashUnchanged(file, sha256('before'), bytes('after')), 'busy');
    assert.equal(refusal.attempts.length, 1, 'one synchronous attempt: the pipeline owns the retries');
    assert.equal(await readFile(file, 'utf8'), 'before');
    await assertNoTemps(tmp.at('d'));
  });

  test('a Windows lock on the read answers busy too (EBUSY, EACCES)', async (t) => {
    const tmp = await useTmpRoot(t);
    const file = await tmp.write('d/index.html', 'before');
    refuseSyncReads(t, (target) => target === file, 'EBUSY');
    assert.equal(await replaceFileIfHashUnchanged(file, sha256('before'), bytes('after')), 'busy');
    assert.equal(await readFile(file, 'utf8'), 'before');
    await assertNoTemps(tmp.at('d'));
  });

  test('any other failure is thrown, with no temp left', async (t) => {
    const tmp = await useTmpRoot(t);
    const file = await tmp.write('d/index.html', 'before');
    refuseSyncRenames(t, (destination) => destination === file, 'EIO');
    await assert.rejects(replaceFileIfHashUnchanged(file, sha256('before'), bytes('after')), { code: 'EIO' });
    await assertNoTemps(tmp.at('d'));
  });
});

describe('moveNoReplace', () => {
  test('moves the file and keeps its inode, so its mtime (the wall\'s file stamp) is unchanged', async (t) => {
    const tmp = await useTmpRoot(t);
    const from = await tmp.write('d/screens/pricing.html', 'pricing');
    const before = await stat(from);
    const to = tmp.at('.trash/d.pricing-20261111120000.html');
    await tmp.write('.trash/keep.txt', 'x');
    assert.equal(await moveNoReplace(from, to), 'moved');
    await assert.rejects(stat(from), { code: 'ENOENT' });
    const after = await stat(to);
    assert.equal(await readFile(to, 'utf8'), 'pricing');
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.nlink, 1, 'the file is never left at both names');
  });

  test('a destination that exists answers exists and nothing is overwritten', async (t) => {
    const tmp = await useTmpRoot(t);
    const from = await tmp.write('d/screens/home-copy.html', 'the copy');
    const to = await tmp.write('d/screens/home.html', 'the agent\'s file');
    assert.equal(await moveNoReplace(from, to), 'exists');
    assert.equal(await readFile(to, 'utf8'), 'the agent\'s file');
    assert.equal(await readFile(from, 'utf8'), 'the copy');
  });

  test('a source locked against removal answers busy and drops the new link: only the source is left', async (t) => {
    const tmp = await useTmpRoot(t);
    const from = await tmp.write('d/screens/pricing.html', 'pricing');
    const to = tmp.at('d/screens/moved.html');
    const removed: string[] = [];
    const deps: MoveDeps = {
      unlink: async (target) => {
        removed.push(target);
        if (target === from) throw errno('EPERM');
        await unlink(target);
      },
    };
    assert.equal(await moveNoReplace(from, to, deps), 'busy');
    assert.deepEqual(removed, [from, to]);
    assert.equal(await readFile(from, 'utf8'), 'pricing');
    await assert.rejects(stat(to), { code: 'ENOENT' });
    assert.equal((await stat(from)).nlink, 1);
  });

  test('a source that vanished after the link keeps the only copy at the destination', async (t) => {
    const tmp = await useTmpRoot(t);
    const from = await tmp.write('d/a.html', 'a');
    const to = tmp.at('d/b.html');
    const deps: MoveDeps = {
      unlink: async (target) => {
        // Another program removed the source between the link and the unlink.
        await unlink(target);
        throw errno('ENOENT');
      },
    };
    assert.equal(await moveNoReplace(from, to, deps), 'moved');
    assert.equal(await readFile(to, 'utf8'), 'a');
  });

  for (const code of ['ENOTSUP', 'EPERM', 'ENOSYS', 'EXDEV']) {
    test(`no hard links (${code}): check-then-rename moves the file`, async (t) => {
      const tmp = await useTmpRoot(t);
      const from = await tmp.write('d/a.html', 'a');
      const to = tmp.at('d/b.html');
      const deps: MoveDeps = { link: () => Promise.reject(errno(code)) };
      assert.equal(await moveNoReplace(from, to, deps), 'moved');
      assert.equal(await readFile(to, 'utf8'), 'a');
      await assert.rejects(stat(from), { code: 'ENOENT' });
    });
  }

  test('no hard links and the destination exists: exists, nothing overwritten', async (t) => {
    const tmp = await useTmpRoot(t);
    const from = await tmp.write('d/a.html', 'a');
    const to = await tmp.write('d/b.html', 'b');
    const deps: MoveDeps = { link: () => Promise.reject(errno('ENOTSUP')) };
    assert.equal(await moveNoReplace(from, to, deps), 'exists');
    assert.equal(await readFile(to, 'utf8'), 'b');
    assert.equal(await readFile(from, 'utf8'), 'a');
  });

  test('no hard links and a lock that outlasts the rename retries: busy, the source stays', async (t) => {
    const tmp = await useTmpRoot(t);
    const from = await tmp.write('d/a.html', 'a');
    const to = tmp.at('d/b.html');
    refuseRenames(t, (destination) => destination === to);
    const deps: MoveDeps = { link: () => Promise.reject(errno('EXDEV')) };
    assert.equal(await moveNoReplace(from, to, deps), 'busy');
    assert.equal(await readFile(from, 'utf8'), 'a');
    await assert.rejects(stat(to), { code: 'ENOENT' });
  });

  test('any other link failure is thrown (a missing source is not a move)', async (t) => {
    const tmp = await useTmpRoot(t);
    await assert.rejects(moveNoReplace(tmp.at('missing.html'), tmp.at('b.html')), { code: 'ENOENT' });
  });
});
