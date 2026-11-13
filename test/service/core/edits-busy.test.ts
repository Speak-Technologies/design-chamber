// QA regression (Phase 2 technical design §2.5, §2.8 "Windows lock after retries"): a target the
// OS keeps refusing (EPERM/EBUSY/EACCES on the read or rename) is retried three times with the
// 40/80/120 ms pauses, then answered 409 conflict with the lock sentence. Nothing is written, no
// temp is left, no user event goes out and the self-write entry is forgotten (so the watcher does
// not hide a later agent write). The lock is simulated with chmod 000 right before the
// compare-and-swap (EACCES on the read is one of the busy codes), so POSIX non-root only.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import type { SelfWrites } from '../../../src/service/context.ts';
import { createEditsFile } from '../../../src/service/edits/file.ts';
import { BUSY_MESSAGE, createEditService, DEFAULT_OPS } from '../../../src/service/edits/pipeline.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { pageDesign } from '../render/harness.ts';

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const ORIGINAL = '<!doctype html>\n<h1>Ship faster</h1>\n';
const canLock = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

describe('the pipeline under a lock that outlasts the retries', () => {
  test('busy four times: 409 with the lock sentence after 40/80/120 ms, nothing written, self-write forgotten', { skip: !canLock && 'needs POSIX non-root for chmod 000' }, async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    await tmp.writeDesign('art', pageDesign({ 'index.html': ORIGINAL }));
    const file = tmp.at('art/index.html');
    t.after(() => chmod(file, 0o644).catch(() => undefined));

    // The lock lands right before the compare-and-swap: the pipeline records the self-write first.
    const selfWrites: SelfWrites = {
      ...ctx.selfWrites,
      record: (slug, rel, hash, size) => {
        ctx.selfWrites.record(slug, rel, hash, size);
        if (rel === 'index.html') chmodSync(file, 0o000); // sync: locked before the compare-and-swap reads
      },
    };
    const pauses: number[] = [];
    const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 600_000 });
    const edits = createEditService({
      store: ctx.store,
      versions,
      hub: ctx.hub,
      selfWrites,
      settings: ctx.settings,
      log: ctx.log,
      ops: DEFAULT_OPS,
      editsFile: createEditsFile({ log: ctx.log }),
      pause: async (ms) => {
        pauses.push(ms);
        await chmod(file, 0o000); // still locked on every retry
      },
    });

    const request = {
      op: 'text',
      screen: null,
      base: sha256(ORIGINAL),
      target: { tag: 'h1', id: null, text: 'Ship faster', sameIndex: 0, sameCount: 1 },
      before: 'Ship faster',
      after: 'Ship it faster',
    };
    await assert.rejects(edits.apply('art', request), (error: unknown) => {
      assert.ok(error instanceof ApiError, String(error));
      assert.equal(error.code, 'conflict');
      assert.equal(error.message, BUSY_MESSAGE);
      return true;
    });
    assert.deepEqual(pauses, [40, 80, 120], 'three retries with the §2.5 pauses');

    await chmod(file, 0o644);
    assert.equal(await readFile(file, 'utf8'), ORIGINAL, 'nothing written');
    assert.deepEqual((await readdir(tmp.at('art'))).filter((name) => name.startsWith('.') && name.endsWith('.tmp')), [], 'no temp left');
    assert.equal(ctx.events.filter((event) => event.origin === 'user').length, 0, 'no user event for a write that never happened');
    // The bytes the edit would have left, written later by someone else, must not read as the echo.
    await writeFile(file, ORIGINAL.replace('Ship faster', 'Ship it faster'));
    assert.equal(await ctx.selfWrites.isEcho('art', 'index.html', tmp.at('art')), false, 'the self-write was forgotten');
  });
});
