// Hand-edit versions (Phase 2 technical design §2.4, AD-4; PS E3): `versions.userEdit` takes a
// "Before your edits" version before the first byte of a hand edit is written, coalesces a burst
// of hand edits with no other writer between them, and answers each snapshot refusal with its
// own sentence. `afterTree` is the pre-apply tree with only the edit's own writes swapped in, so
// an agent write anywhere after the apply forces the next edit to take a version.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsPromises, { mkdir, readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { describe, test, type TestContext } from 'node:test';

import { serializeJson, stripForVersion } from '../../../src/shared/design-json.ts';
import { SNAPSHOT_FILES_MAX, USER_EDIT_COALESCE_MS } from '../../../src/shared/limits.ts';
import type { JsonObject, VersionEntry } from '../../../src/shared/types.ts';
import { ApiError } from '../../../src/service/http.ts';
import {
  computeTree,
  createVersionsService,
  SnapshotRefusedError,
  trackedHashOf,
  treeHashOf,
  type UserEditReason,
  type VersionsService,
  type WrittenFile,
} from '../../../src/service/versions.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { canvasDesign, pageDesign } from '../render/harness.ts';

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const STALE = 'This file changed while you were editing. Nothing was saved.';

type Rig = { tmp: TmpRoot; ctx: FakeContext; versions: VersionsService; clock: { now: number } };

const setup = async (t: TestContext): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const clock = { now: Date.parse('2026-11-11T12:00:00.000Z') };
  // A long quiet period: no auto snapshot runs inside a test.
  const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 600_000, now: () => clock.now });
  return { tmp, ctx, versions, clock };
};

const indexOf = async (tmp: TmpRoot, slug: string): Promise<VersionEntry[]> => {
  const text = await readFile(tmp.at(`${slug}/.versions/index.json`), 'utf8').catch(() => null);
  return text === null ? [] : (JSON.parse(text) as { versions: VersionEntry[] }).versions;
};

type EditOptions = {
  reason?: UserEditReason;
  /** Runs inside `apply`, after the edit's own write: something else writing in that window. */
  thenInsideApply?: () => Promise<void>;
  written?: (bytes: Uint8Array) => WrittenFile[];
};

/** One hand edit through `userEdit`: write `text` to `<slug>/<rel>` in `apply`, report it as written. */
const handEdit = (rig: Rig, slug: string, rel: string, text: string, options: EditOptions = {}) =>
  rig.versions.userEdit(slug, options.reason ?? 'user-edit', {
    staleMessage: STALE,
    precheck: async () => ({ rel, bytes: new TextEncoder().encode(text) }),
    apply: async (plan) => {
      await writeFile(rig.tmp.at(`${slug}/${plan.rel}`), plan.bytes);
      await options.thenInsideApply?.();
      return { response: { wrote: plan.rel }, written: options.written?.(plan.bytes) ?? [[plan.rel, plan.bytes]] };
    },
  });

describe('userEdit: version first', () => {
  test('the first hand edit takes a "Before your edits" version holding the files before it', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign({ 'index.html': '<h1>Ship faster</h1>' }));
    const result = await handEdit(rig, 'art', 'index.html', '<h1>Ship it faster</h1>');
    assert.equal(result.coalesced, false);
    assert.deepEqual(result.response, { wrote: 'index.html' });
    assert.ok(result.version);
    assert.equal(result.version.reason, 'user-edit');
    assert.equal(result.version.files['index.html'], sha256('<h1>Ship faster</h1>'));
    assert.equal(await rig.tmp.read('art/index.html'), '<h1>Ship it faster</h1>');
    assert.deepEqual((await indexOf(rig.tmp, 'art')).map((entry) => entry.reason), ['user-edit']);
  });

  test('a refused precheck writes nothing and takes no version', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    let applied = false;
    await assert.rejects(
      rig.versions.userEdit('art', 'user-edit', {
        staleMessage: STALE,
        precheck: async () => {
          throw new ApiError('stale', STALE);
        },
        apply: async () => {
          applied = true;
          return { response: null, written: [] };
        },
      }),
      { code: 'stale', message: STALE },
    );
    assert.equal(applied, false);
    assert.deepEqual(await indexOf(rig.tmp, 'art'), []);
  });

  test('files that already match the newest version answer that version (dedupe), not a new one', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    const manual = await rig.versions.create('art', 'manual');
    assert.ok(manual);
    const result = await handEdit(rig, 'art', 'index.html', '<p>edited</p>');
    assert.equal(result.coalesced, false);
    assert.equal(result.version?.id, manual.id);
    assert.equal((await indexOf(rig.tmp, 'art')).length, 1);
  });

  test('a failed apply keeps the version and propagates; the next edit does not coalesce with a failed one', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    await assert.rejects(
      rig.versions.userEdit('art', 'user-edit', {
        staleMessage: STALE,
        precheck: async () => null,
        apply: async () => {
          throw new ApiError('stale', STALE);
        },
      }),
      { code: 'stale' },
    );
    assert.equal((await indexOf(rig.tmp, 'art')).length, 1, 'the version taken first stays (it holds the current files)');
    const next = await handEdit(rig, 'art', 'index.html', '<p>second try</p>');
    assert.equal(next.coalesced, false);
    assert.equal(next.version?.id, 'v1', 'deduped against the version the failed edit took');
  });
});

describe('userEdit: coalescing (AD-4)', () => {
  test('a burst of hand edits with no other writer shares one version', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign({ 'index.html': '<h1>one</h1>' }));
    const first = await handEdit(rig, 'art', 'index.html', '<h1>two</h1>');
    rig.clock.now += 10_000;
    const second = await handEdit(rig, 'art', 'index.html', '<h1>three</h1>');
    rig.clock.now += 10_000;
    const third = await handEdit(rig, 'art', 'index.html', '<h1>four</h1>');
    assert.equal(first.coalesced, false);
    assert.equal(second.coalesced, true);
    assert.equal(second.version, null);
    assert.equal(third.coalesced, true);
    const entries = await indexOf(rig.tmp, 'art');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.files['index.html'], sha256('<h1>one</h1>'), 'the one version holds the state before the burst');
  });

  test('CRITICAL: an agent write between an edit\'s apply and the next edit forces a version that holds it', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign({ 'index.html': '<h1>one</h1>', 'DESIGN.md': '# Notes' }));
    // The agent writes another file in the window after the edit's own write, before userEdit
    // returns: a tree re-read from disk at that point would wrongly count it as the edit's result.
    await handEdit(rig, 'art', 'index.html', '<h1>two</h1>', {
      thenInsideApply: () => writeFile(rig.tmp.at('art/DESIGN.md'), '# The agent rewrote this'),
    });
    rig.clock.now += 5_000;
    const second = await handEdit(rig, 'art', 'index.html', '<h1>three</h1>');
    assert.equal(second.coalesced, false, 'the agent wrote in between: no coalescing');
    assert.ok(second.version);
    assert.equal(second.version.reason, 'user-edit');
    assert.equal(second.version.files['DESIGN.md'], sha256('# The agent rewrote this'), 'the new version holds the agent\'s file');
    assert.equal(second.version.files['index.html'], sha256('<h1>two</h1>'));
    assert.equal((await indexOf(rig.tmp, 'art')).length, 2);
  });

  test('an agent write after the edit returned forces a version too; without it the next edit coalesces', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', canvasDesign());
    await handEdit(rig, 'art', 'screens/home.html', '<h1>home 2</h1>');
    await writeFile(rig.tmp.at('art/screens/checkout.html'), '<h1>agent checkout</h1>');
    const second = await handEdit(rig, 'art', 'screens/home.html', '<h1>home 3</h1>');
    assert.equal(second.coalesced, false);
    assert.equal(second.version?.files['screens/checkout.html'], sha256('<h1>agent checkout</h1>'));
    const third = await handEdit(rig, 'art', 'screens/home.html', '<h1>home 4</h1>');
    assert.equal(third.coalesced, true);
  });

  test('the 60 s window: at the limit it coalesces, one millisecond past it takes a version', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    await handEdit(rig, 'art', 'index.html', '<p>a</p>');
    rig.clock.now += USER_EDIT_COALESCE_MS;
    assert.equal((await handEdit(rig, 'art', 'index.html', '<p>b</p>')).coalesced, true);
    rig.clock.now += USER_EDIT_COALESCE_MS + 1;
    const late = await handEdit(rig, 'art', 'index.html', '<p>c</p>');
    assert.equal(late.coalesced, false);
    assert.equal(late.version?.files['index.html'], sha256('<p>b</p>'));
  });

  test('a restore between two edits forces a version', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign({ 'index.html': '<p>start</p>' }));
    const first = await handEdit(rig, 'art', 'index.html', '<p>edited</p>');
    assert.ok(first.version);
    await rig.versions.restore('art', first.version.id);
    const second = await handEdit(rig, 'art', 'index.html', '<p>again</p>');
    assert.equal(second.coalesced, false);
  });

  test('design.json written by an edit is swapped in comments-stripped, as computeTree hashes it', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', canvasDesign());
    const raw = JSON.parse(await rig.tmp.read('art/design.json')) as JsonObject;
    // The edit writes design.json with a comment in it: versions never hold comments.
    const next = `${JSON.stringify({ ...raw, title: 'Renamed', comments: [{ id: 'c_1', body: 'hi' }] }, null, 2)}\n`;
    await handEdit(rig, 'art', 'design.json', next);
    assert.equal((await handEdit(rig, 'art', 'screens/home.html', '<p>x</p>')).coalesced, true);
  });

  test('a file the edit removed or moved away is dropped from afterTree; untracked writes are ignored', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', canvasDesign());
    await handEdit(rig, 'art', 'screens/home.html', '<p>home</p>', {
      thenInsideApply: async () => {
        await fsPromises.rm(rig.tmp.at('art/screens/checkout.html'));
        await mkdir(rig.tmp.at('art/.chamber'), { recursive: true });
        await writeFile(rig.tmp.at('art/.chamber/edits.json'), '{}');
      },
      written: (bytes) => [
        ['screens/home.html', bytes],
        ['screens/checkout.html', null],
        ['.chamber/edits.json', new TextEncoder().encode('{}')],
      ],
    });
    assert.equal((await handEdit(rig, 'art', 'screens/home.html', '<p>home 2</p>')).coalesced, true);
  });

  test('keep-direction never coalesces and ends a burst', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', canvasDesign());
    await handEdit(rig, 'art', 'screens/home.html', '<p>1</p>');
    const keep = await handEdit(rig, 'art', 'screens/home.html', '<p>2</p>', { reason: 'keep-direction' });
    assert.equal(keep.coalesced, false);
    assert.equal(keep.version?.reason, 'keep-direction');
    const after = await handEdit(rig, 'art', 'screens/home.html', '<p>3</p>');
    assert.equal(after.coalesced, false, 'the next hand edit takes its own version');
    assert.equal(after.version?.reason, 'user-edit');
    assert.deepEqual((await indexOf(rig.tmp, 'art')).map((entry) => entry.reason), ['user-edit', 'keep-direction', 'user-edit']);
  });
});

describe('userEdit: typed snapshot refusals (§2.8)', () => {
  const refusedEdit = (rig: Rig) => {
    let applied = false;
    const run = rig.versions.userEdit('art', 'user-edit', {
      staleMessage: STALE,
      precheck: async () => null,
      apply: async () => {
        applied = true;
        return { response: null, written: [] };
      },
    });
    return { run, applied: () => applied };
  };

  test('too large: 422 with the version-first sentence, nothing written', async (t) => {
    const rig = await setup(t);
    const files: Record<string, string> = {};
    for (let i = 0; i <= SNAPSHOT_FILES_MAX; i += 1) files[`assets/f${i}.txt`] = 'x';
    await rig.tmp.writeDesign('art', pageDesign(files));
    const edit = refusedEdit(rig);
    await assert.rejects(edit.run, {
      code: 'invalid',
      status: 422,
      message: "Couldn't save a version first, so nothing was changed. This design is too large to keep a version (more than 1,000 files or 100 MB).",
    });
    assert.equal(edit.applied(), false);
  });

  test('a newer build\'s history: 422 unsupported sentence', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign({ '.versions/index.json': { version: 99, next: 1, versions: [] } }));
    const edit = refusedEdit(rig);
    await assert.rejects(edit.run, {
      code: 'invalid',
      message: "Couldn't save a version first, so nothing was changed. This design's versions were saved by a newer Design Chamber.",
    });
    assert.equal(edit.applied(), false);
  });

  test('an unreadable history: 422 unreadable sentence', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    await mkdir(rig.tmp.at('art/.versions/index.json'), { recursive: true }); // a folder where the index belongs
    const edit = refusedEdit(rig);
    await assert.rejects(edit.run, {
      code: 'invalid',
      message: "Couldn't save a version first, so nothing was changed. Design Chamber could not read this design's version history right now.",
    });
    assert.equal(edit.applied(), false);
  });

  test('torn (the design kept changing while it was saved): 409 stale with the op\'s own sentence', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    tearReads(t, rig.tmp.at('art/index.html'));
    const edit = refusedEdit(rig);
    await assert.rejects(edit.run, { code: 'stale', status: 409, message: STALE });
    assert.equal(edit.applied(), false);
  });

  test('snapshot refusals are typed, with the code and wording restore has always answered', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    const v1 = await rig.versions.create('art', 'manual');
    assert.ok(v1);
    for (let i = 0; i <= SNAPSHOT_FILES_MAX; i += 1) await rig.tmp.write(`art/assets/f${i}.txt`, 'x');
    await assert.rejects(rig.versions.restore('art', v1.id), (error: unknown) => {
      assert.ok(error instanceof SnapshotRefusedError);
      assert.ok(error instanceof ApiError);
      assert.equal(error.refusal, 'too-large');
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /too large to keep a restore point/);
      return true;
    });
  });

  test('a torn restore point keeps the conflict code and sentence, typed torn', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign());
    const v1 = await rig.versions.create('art', 'manual');
    assert.ok(v1);
    await rig.tmp.write('art/index.html', '<p>changed</p>');
    tearReads(t, rig.tmp.at('art/index.html'));
    await assert.rejects(rig.versions.restore('art', v1.id), (error: unknown) => {
      assert.ok(error instanceof SnapshotRefusedError);
      assert.equal(error.refusal, 'torn');
      assert.equal(error.code, 'conflict');
      assert.equal(error.message, 'The design changed while Design Chamber was saving it. Try again.');
      return true;
    });
  });
});

/** Every read of `file` answers different bytes: a file being rewritten mid-snapshot. */
const tearReads = (t: TestContext, file: string): void => {
  const original = fsPromises.readFile;
  let n = 0;
  const patched = async (...args: Parameters<typeof fsPromises.readFile>): ReturnType<typeof fsPromises.readFile> => {
    if (String(args[0]) === file) {
      n += 1;
      return Buffer.from(`<p>rewritten ${n}</p>`);
    }
    return original(...args);
  };
  // Safe: the patch forwards every other call unchanged; the torn file answers a Buffer, as readFile without an encoding does.
  fsPromises.readFile = patched as typeof fsPromises.readFile;
  syncBuiltinESMExports();
  t.after(() => {
    fsPromises.readFile = original;
    syncBuiltinESMExports();
  });
};

describe('trackedHashOf / treeHashOf', () => {
  test('match computeTree exactly: design.json comments-stripped, unparseable verbatim, other files by sha256', async (t) => {
    const tmp = await useTmpRoot(t);
    const design = { version: 1, kind: 'page', title: 'T', created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T10:00:00.000Z', comments: [{ id: 'c_1' }] };
    const dir = await tmp.writeDesign('art', { 'design.json': design, 'index.html': '<p>x</p>', 'assets/a.png': Uint8Array.from([1, 2, 3]), '1': 'integer-like name' });
    const tree = await computeTree(dir);
    const designBytes = await readFile(tmp.at('art/design.json'));
    assert.equal(trackedHashOf('design.json', designBytes), tree.files['design.json']);
    assert.equal(trackedHashOf('design.json', designBytes), sha256(serializeJson(stripForVersion(design as unknown as JsonObject))));
    assert.equal(trackedHashOf('index.html', Buffer.from('<p>x</p>')), tree.files['index.html']);
    assert.equal(treeHashOf(tree.files), tree.treeHash);
    // Key order does not matter: the lines are sorted as listTracked sorts.
    const reversed = Object.fromEntries(Object.entries(tree.files).reverse());
    assert.equal(treeHashOf(reversed), tree.treeHash);

    await writeFile(tmp.at('art/design.json'), '{ "half": ');
    const torn = await computeTree(dir);
    assert.equal(trackedHashOf('design.json', Buffer.from('{ "half": ')), torn.files['design.json']);
    assert.equal(torn.files['design.json'], sha256('{ "half": '));
  });
});
