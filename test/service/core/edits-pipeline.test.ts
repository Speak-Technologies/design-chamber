// The edit pipeline end to end with fake ops (Phase 2 technical design §2.4 to §2.10, PS E1 to
// E12): version first, stale refusals, compare-and-swap at the rename, the writable set, links,
// rollback of a failed multi-step op, undo (exact bytes, guarded, single-shot, on disk so it
// survives a new service instance), the ledger, coalescing, and the clear racing an edit.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { EditResponse, FileStamp } from '../../../src/shared/api.ts';
import type { JsonObject, JsonValue, VersionEntry } from '../../../src/shared/types.ts';
import type { DesignStore } from '../../../src/service/context.ts';
import { createEditsFile, type EditsFileStore } from '../../../src/service/edits/file.ts';
import type { OpModule, OpModules, RequestOf } from '../../../src/service/edits/op-module.ts';
import {
  createEditService,
  DEFAULT_OPS,
  GONE_MESSAGE,
  partWayMessage,
  ROLLED_BACK_MESSAGE,
  STALE_MESSAGES,
  UNDO_GONE_MESSAGE,
  UNDO_STALE_MESSAGE,
  type EditService,
} from '../../../src/service/edits/pipeline.ts';
import { ApiError } from '../../../src/service/http.ts';
import { LINK_SENTENCE } from '../../../src/service/paths.ts';
import { screensStampOf } from '../../../src/service/store.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { canvasDesign, pageDesign } from '../render/harness.ts';

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const START = Date.parse('2026-11-11T12:00:00.000Z');

type Gate = { wait: Promise<void>; open: () => void };
const gate = (): Gate => {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
};

type Hooks = {
  /** Inside the op's plan, after it read the file (an agent writing in the window before the rename). */
  afterRead?: () => Promise<void>;
  /** The design-relative file the fake text op plans to write (defaults to the request's file). */
  rel?: string;
};

/** A minimal text op: replace the first `before` with `after`, guarded by `base`, undone by a splice. */
const fakeText = (hooks: Hooks = {}): OpModule<RequestOf<'text'>> => ({
  async plan({ dir, request }) {
    const rel = hooks.rel ?? (request.screen === null ? 'index.html' : `screens/${request.screen}.html`);
    const bytes = await readFile(path.join(dir, ...rel.split('/'))).catch(() => Buffer.from(''));
    if (sha256(bytes) !== request.base) throw new ApiError('stale', STALE_MESSAGES.text);
    await hooks.afterRead?.();
    const text = bytes.toString('utf8');
    const start = text.indexOf(request.before);
    if (start < 0) throw new ApiError('invalid', "Design Chamber couldn't find this text in the file exactly. Nothing was saved.");
    const next = Buffer.from(`${text.slice(0, start)}${request.after}${text.slice(start + request.before.length)}`, 'utf8');
    return {
      label: 'Text updated in Demo',
      steps: [
        {
          kind: 'write',
          rel,
          expectSha: request.base,
          bytes: next,
          undo: { kind: 'splice', file: rel, start, inserted: request.after.length, removed: request.before, afterSha: sha256(next), beforeSha: request.base },
        },
      ],
      ledger: { kind: 'text', file: rel, screen: null, before: request.before, after: request.after },
    };
  },
});

const rawOf = async (dir: string): Promise<JsonObject> => JSON.parse(await readFile(path.join(dir, 'design.json'), 'utf8')) as JsonObject;

/** Duplicate: create `screens/<id>-copy.html`, then add it to the list (two steps, for rollback and multi-step undo). */
const fakeDuplicate: OpModule<RequestOf<'duplicate'>> = {
  async plan({ dir, request }) {
    const bytes = await readFile(path.join(dir, 'screens', `${request.id}.html`));
    const before = (await rawOf(dir)).screens;
    const copyId = `${request.id}-copy`;
    const copyRel = `screens/${copyId}.html`;
    return {
      label: 'Duplicated Home',
      steps: [
        { kind: 'create', rel: copyRel, bytes, undo: { kind: 'create', file: copyRel, sha: sha256(bytes) } },
        {
          kind: 'screens',
          expectStamp: request.screens,
          mutate: (raw) => [...(Array.isArray(raw) ? raw : []), { id: copyId, title: 'Home copy', file: copyRel }],
          undo: (afterStamp) => ({ kind: 'screens', before: Array.isArray(before) ? structuredClone(before) : [], afterStamp }),
        },
      ],
      ledger: { kind: 'duplicate', screen: 'Home', copy: 'Home copy', file: copyRel },
      created: { id: copyId, title: 'Home copy' },
    };
  },
};

/** Trash: move the screen file to `.trash/<slug>.<id>-<stamp>.html`, then drop it from the list. */
const fakeTrash = (stamp: string): OpModule<RequestOf<'trash-screen'>> => ({
  async plan({ slug, dir, request }) {
    const rel = `screens/${request.id}.html`;
    const bytes = await readFile(path.join(dir, ...rel.split('/')));
    const before = (await rawOf(dir)).screens;
    const to = `.trash/${slug}.${request.id}-${stamp}.html`;
    return {
      label: 'Moved Checkout to trash',
      steps: [
        { kind: 'move', from: rel, to, expect: { sha: sha256(bytes) }, undo: { kind: 'move', from: rel, to, sha: sha256(bytes) } },
        {
          kind: 'screens',
          expectStamp: request.screens,
          mutate: (raw) => (Array.isArray(raw) ? raw : []).filter((entry) => !(typeof entry === 'object' && entry !== null && !Array.isArray(entry) && entry.id === request.id)),
          undo: (afterStamp) => ({ kind: 'screens', before: Array.isArray(before) ? structuredClone(before) : [], afterStamp }),
        },
      ],
      ledger: { kind: 'trash', screen: 'Checkout', file: rel },
    };
  },
});

type ScreensBehaviour = { beforeWrite?: () => Promise<void> };

/** The store with a real-enough `writeScreens` (T4 builds the real one): stamp check, mutate, hook, write. */
const withScreens = (base: DesignStore, behaviour: ScreensBehaviour): DesignStore =>
  new Proxy(base, {
    get(target, property, receiver) {
      if (property !== 'writeScreens') return Reflect.get(target, property, receiver);
      const writeScreens: DesignStore['writeScreens'] = async (slug, expectStamp, mutate, hooks) => {
        await behaviour.beforeWrite?.();
        const dir = await target.dir(slug);
        const raw = await rawOf(dir);
        if (screensStampOf(raw) !== expectStamp) throw new ApiError('stale', STALE_MESSAGES.reorder);
        const next: JsonObject = { ...raw, screens: mutate(raw.screens) };
        const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
        hooks?.beforeRename?.(bytes);
        await writeFile(path.join(dir, 'design.json'), bytes);
        return { stamp: screensStampOf(next), bytes };
      };
      return writeScreens;
    },
  });

type Rig = {
  tmp: TmpRoot;
  ctx: FakeContext;
  clock: { now: number };
  edits: EditService;
  /** A second service over the same root and files (a restart: new versions memory, new queue). */
  restart(): EditService;
};

type RigOptions = { ops?: Partial<OpModules>; screens?: ScreensBehaviour; editsFile?: (real: EditsFileStore) => EditsFileStore };

const setup = async (t: TestContext, options: RigOptions = {}): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const clock = { now: START };
  const store = withScreens(ctx.store, options.screens ?? {});
  const build = (): EditService => {
    const versions = createVersionsService({ store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 600_000, now: () => clock.now });
    const real = createEditsFile({ log: ctx.log });
    return createEditService({
      store,
      versions,
      hub: ctx.hub,
      selfWrites: ctx.selfWrites,
      settings: ctx.settings,
      log: ctx.log,
      now: () => new Date(clock.now),
      ops: { ...DEFAULT_OPS, ...options.ops },
      editsFile: options.editsFile ? options.editsFile(real) : real,
      pause: async () => undefined,
    });
  };
  return { tmp, ctx, clock, edits: build(), restart: build };
};

const textRequest = (base: string, before: string, after: string, screen: string | null = null) => ({
  op: 'text',
  screen,
  base,
  target: { tag: 'h1', id: null, text: before, sameIndex: 0, sameCount: 1 },
  before,
  after,
});

const versionsOf = async (tmp: TmpRoot, slug: string): Promise<VersionEntry[]> => {
  const text = await readFile(tmp.at(`${slug}/.versions/index.json`), 'utf8').catch(() => null);
  return text === null ? [] : (JSON.parse(text) as { versions: VersionEntry[] }).versions;
};

const editsJson = async (tmp: TmpRoot, slug: string): Promise<{ seq: number; ledger: { seq: number; kind: string }[]; undo: { id: string; steps: { kind: string; to?: string }[] }[] }> =>
  JSON.parse(await readFile(tmp.at(`${slug}/.chamber/edits.json`), 'utf8'));

const stampOf = async (tmp: TmpRoot, rel: string): Promise<FileStamp> => {
  const info = await stat(tmp.at(rel));
  return { size: info.size, mtime: info.mtime.toISOString() };
};

const rejectsWith = (code: string, message: string) => (error: unknown): boolean => {
  assert.ok(error instanceof ApiError, String(error));
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  return true;
};

const ORIGINAL = '<!doctype html>\r\n<!-- keep -->\r\n<h1>Ship faster</h1>\r\n';

const pageRig = async (t: TestContext, options: RigOptions = {}): Promise<Rig> => {
  const rig = await setup(t, { ...options, ops: { text: fakeText(), ...options.ops } });
  await rig.tmp.writeDesign('art', pageDesign({ 'index.html': ORIGINAL }));
  return rig;
};

const editText = (rig: Rig, from: string, to: string, base?: string): Promise<EditResponse> =>
  rig.tmp.read('art/index.html').then((text) => rig.edits.apply('art', textRequest(base ?? sha256(text), from, to)));

describe('apply: version first, smallest change, the user event', () => {
  test('the edit takes "Before your edits" holding the old bytes, writes only its change and announces origin "user"', async (t) => {
    const rig = await pageRig(t);
    const answer = await editText(rig, 'Ship faster', 'Ship it faster');
    const expected = ORIGINAL.replace('Ship faster', 'Ship it faster');
    assert.equal(await rig.tmp.read('art/index.html'), expected);
    assert.equal(answer.edit.label, 'Text updated in Demo');
    assert.equal(answer.edit.undoable, true);
    assert.deepEqual(answer.edit.files, ['index.html']);
    assert.match(answer.edit.id, /^e_[a-z0-9]{8,24}$/);
    assert.equal(answer.coalesced, false);
    assert.equal(answer.version?.reason, 'user-edit');
    assert.deepEqual(answer.stamps, { file: sha256(expected) });
    const [version] = await versionsOf(rig.tmp, 'art');
    assert.equal(version?.files['index.html'], sha256(ORIGINAL), 'the version holds the bytes from before the edit');
    const events = rig.ctx.events.filter((event) => event.origin === 'user');
    assert.deepEqual(events.map((event) => [event.kind, event.files]), [['files', ['index.html']]]);
    assert.equal(await rig.ctx.selfWrites.isEcho('art', 'index.html', rig.tmp.at('art')), true, 'the watcher will drop its echo');
  });

  test('a request the op refuses as stale writes nothing and takes no version', async (t) => {
    const rig = await pageRig(t);
    await assert.rejects(editText(rig, 'Ship faster', 'x', 'f'.repeat(64)), rejectsWith('stale', STALE_MESSAGES.text));
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL);
    assert.deepEqual(await versionsOf(rig.tmp, 'art'), []);
  });

  test('the agent writing between the read and the rename loses nothing: compare-and-swap refuses with the op sentence', async (t) => {
    const agent = '<h1>The agent wrote this</h1>';
    const rig = await pageRig(t, { ops: { text: fakeText({ afterRead: () => writeFile(rigDir(), agent) }) } });
    const rigDir = (): string => rig.tmp.at('art/index.html');
    await assert.rejects(editText(rig, 'Ship faster', 'Ship it faster'), rejectsWith('stale', STALE_MESSAGES.text));
    assert.equal(await rig.tmp.read('art/index.html'), agent);
    assert.equal(await rig.ctx.selfWrites.isEcho('art', 'index.html', rig.tmp.at('art')), false, 'the self-write was forgotten: the agent event is shown');
    assert.equal(rig.ctx.events.filter((event) => event.origin === 'user').length, 0);
  });

  test('malformed requests are 400 before any read; a gone design is the edit sentence; over-long text is 413', async (t) => {
    const rig = await pageRig(t);
    for (const body of [null, { op: 'rm' }, { op: 'text', screen: '../x', base: 'a'.repeat(64) }, { ...textRequest('nope', 'a', 'b') }, { op: 'reorder', screens: 'a'.repeat(64), order: ['home', 'home'] }]) {
      await assert.rejects(rig.edits.apply('art', body), (error: unknown) => error instanceof ApiError && error.code === 'bad-request', JSON.stringify(body));
    }
    await assert.rejects(rig.edits.apply('art', textRequest('a'.repeat(64), 'a', 'x'.repeat(5001))), (error: unknown) => error instanceof ApiError && error.code === 'too-large');
    await assert.rejects(rig.edits.apply('gone', textRequest('a'.repeat(64), 'a', 'b')), rejectsWith('not-found', GONE_MESSAGE));
    assert.deepEqual(await versionsOf(rig.tmp, 'art'), []);
  });

  test('the shipped op stubs answer "not built yet" and write nothing', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('art', pageDesign({ 'index.html': ORIGINAL }));
    await assert.rejects(editText(rig, 'Ship faster', 'x'), rejectsWith('internal', 'This part of Design Chamber (edits) is not built yet.'));
    await assert.rejects(rig.edits.readTokens('art'), rejectsWith('internal', 'This part of Design Chamber (edits) is not built yet.'));
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL);
  });
});

describe('the writable set and links (E7, 07-7)', () => {
  for (const rel of ['design.json', 'assets/app.css', 'screens/home.html', 'DESIGN.md']) {
    test(`a text op planning a write to ${rel} on a page is refused before the version`, async (t) => {
      const rig = await setup(t, { ops: { text: fakeText({ rel }) } });
      await rig.tmp.writeDesign('art', pageDesign({ [rel]: 'Ship faster' }));
      const before = await rig.tmp.read(`art/${rel}`);
      await assert.rejects(rig.edits.apply('art', textRequest(sha256(before), 'Ship faster', 'x')), rejectsWith('internal', ROLLED_BACK_MESSAGE));
      assert.equal(await rig.tmp.read(`art/${rel}`), before);
      assert.deepEqual(await versionsOf(rig.tmp, 'art'), []);
      assert.ok(rig.ctx.logs.some((line) => line.event === 'edits.plan-refused'));
    });
  }

  test('an entry file that is a link inside the design is refused with the link sentence; its target is untouched', async (t) => {
    const rig = await setup(t, { ops: { text: fakeText() } });
    await rig.tmp.writeDesign('art', pageDesign({ 'other.html': ORIGINAL }));
    await rm(rig.tmp.at('art/index.html'));
    await symlink(rig.tmp.at('art/other.html'), rig.tmp.at('art/index.html'));
    await assert.rejects(editText(rig, 'Ship faster', 'x'), rejectsWith('invalid', LINK_SENTENCE));
    assert.equal(await rig.tmp.read('art/other.html'), ORIGINAL);
  });
});

describe('multi-step ops: rollback (§2.9)', () => {
  const canvasRig = async (t: TestContext, screens: ScreensBehaviour): Promise<Rig> => {
    const rig = await setup(t, { ops: { duplicate: fakeDuplicate }, screens });
    await rig.tmp.writeDesign('wall', canvasDesign());
    return rig;
  };
  const duplicate = async (rig: Rig): Promise<EditResponse> =>
    rig.edits.apply('wall', { op: 'duplicate', screens: (await rig.ctx.store.get('wall')).screensStamp, id: 'home', file: await stampOf(rig.tmp, 'wall/screens/home.html') });

  test('a later step refused as stale undoes the done steps and keeps its own sentence', async (t) => {
    const rig = await canvasRig(t, {
      beforeWrite: async () => {
        throw new ApiError('stale', STALE_MESSAGES.duplicate);
      },
    });
    await assert.rejects(duplicate(rig), rejectsWith('stale', STALE_MESSAGES.duplicate));
    await assert.rejects(stat(rig.tmp.at('wall/screens/home-copy.html')), { code: 'ENOENT' });
    const trash = await readdir(rig.tmp.at('.trash'));
    assert.equal(trash.length, 1, 'the copy went to the trash, never a hard delete');
    assert.match(trash[0] ?? '', /^wall\.home-copy-[0-9]{14}\.html$/);
    assert.ok(rig.ctx.logs.some((line) => line.event === 'edits.rolled-back'));
  });

  test('a later step failing on the disk is rolled back with "nothing was changed"', async (t) => {
    const rig = await canvasRig(t, {
      beforeWrite: async () => {
        throw Object.assign(new Error('disk said no'), { code: 'EIO' });
      },
    });
    await assert.rejects(duplicate(rig), rejectsWith('internal', ROLLED_BACK_MESSAGE));
    await assert.rejects(stat(rig.tmp.at('wall/screens/home-copy.html')), { code: 'ENOENT' });
  });

  test('a rollback that cannot run stops, logs and points at the version taken first', async (t) => {
    let tmp: TmpRoot | null = null;
    const rig = await canvasRig(t, {
      beforeWrite: async () => {
        // The agent rewrote the new copy before the list write failed: undoing the create is no longer safe.
        await writeFile(tmp?.at('wall/screens/home-copy.html') ?? '', '<h1>agent</h1>');
        throw Object.assign(new Error('disk said no'), { code: 'EIO' });
      },
    });
    tmp = rig.tmp;
    await assert.rejects(duplicate(rig), rejectsWith('internal', partWayMessage('user-edit')));
    assert.equal(await rig.tmp.read('wall/screens/home-copy.html'), '<h1>agent</h1>', 'nothing of the agent is lost');
    assert.ok(rig.ctx.logs.some((line) => line.event === 'edits.rollback-failed' && line.fields?.step === 'create'));
  });

  test('a duplicate lands as one edit and its undo puts the list back and the copy in the trash', async (t) => {
    const rig = await canvasRig(t, {});
    const before = await rig.tmp.read('wall/design.json');
    const answer = await duplicate(rig);
    assert.deepEqual(answer.created, { id: 'home-copy', title: 'Home copy' });
    assert.deepEqual(answer.edit.files, ['design.json', 'screens/home-copy.html']);
    assert.equal(answer.stamps.screens, (await rig.ctx.store.get('wall')).screensStamp);
    assert.deepEqual(rig.ctx.events.filter((event) => event.origin === 'user').map((event) => event.kind), ['files', 'design']);
    const undone = await rig.edits.undo('wall', answer.edit.id);
    assert.deepEqual(undone.files, ['design.json', 'screens/home-copy.html']);
    await assert.rejects(stat(rig.tmp.at('wall/screens/home-copy.html')), { code: 'ENOENT' });
    assert.deepEqual((await rawOf(rig.tmp.at('wall'))).screens, (JSON.parse(before) as JsonObject).screens);
    assert.equal((await readdir(rig.tmp.at('.trash'))).length, 1);
  });
});

describe('moves to the trash', () => {
  test('a trash name taken meanwhile moves on to -2, and the undo record names the one used', async (t) => {
    const stamp = '20261111120000';
    const rig = await setup(t, { ops: { 'trash-screen': fakeTrash(stamp) } });
    await rig.tmp.writeDesign('wall', canvasDesign());
    await rig.tmp.write(`.trash/wall.checkout-${stamp}.html`, 'someone else');
    const answer = await rig.edits.apply('wall', { op: 'trash-screen', screens: (await rig.ctx.store.get('wall')).screensStamp, id: 'checkout', file: null });
    assert.equal(await rig.tmp.read(`.trash/wall.checkout-${stamp}.html`), 'someone else', 'never overwritten');
    assert.match(await rig.tmp.read(`.trash/wall.checkout-${stamp}-2.html`), /checkout/);
    const record = (await editsJson(rig.tmp, 'wall')).undo[0];
    assert.equal(record?.steps[0]?.to, `.trash/wall.checkout-${stamp}-2.html`);
    await rig.edits.undo('wall', answer.edit.id);
    assert.match(await rig.tmp.read('wall/screens/checkout.html'), /checkout/);
    assert.equal(await rig.tmp.read(`.trash/wall.checkout-${stamp}.html`), 'someone else');
  });

  test('undo refuses before any change when the trashed name was taken again', async (t) => {
    const stamp = '20261111120000';
    const rig = await setup(t, { ops: { 'trash-screen': fakeTrash(stamp) } });
    await rig.tmp.writeDesign('wall', canvasDesign());
    const answer = await rig.edits.apply('wall', { op: 'trash-screen', screens: (await rig.ctx.store.get('wall')).screensStamp, id: 'checkout', file: null });
    await rig.tmp.write('wall/screens/checkout.html', '<h1>the agent made a new one</h1>');
    const listAfter = await rig.tmp.read('wall/design.json');
    await assert.rejects(rig.edits.undo('wall', answer.edit.id), rejectsWith('stale', UNDO_STALE_MESSAGE));
    assert.equal(await rig.tmp.read('wall/screens/checkout.html'), '<h1>the agent made a new one</h1>');
    assert.equal(await rig.tmp.read('wall/design.json'), listAfter, 'the list was not touched either');
  });
});

describe('undo (E9, AD-5)', () => {
  test('undo puts back exactly the bytes from before, once; a second undo of the id is 404', async (t) => {
    const rig = await pageRig(t);
    const answer = await editText(rig, 'Ship faster', 'Ship <it> & faster');
    const undone = await rig.edits.undo('art', answer.edit.id);
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL, 'CRLF, comment and all');
    assert.deepEqual(undone.files, ['index.html']);
    assert.deepEqual(undone.stamps, { file: sha256(ORIGINAL) });
    await assert.rejects(rig.edits.undo('art', answer.edit.id), rejectsWith('not-found', UNDO_GONE_MESSAGE));
  });

  test('two undos of one id at once: one lands, the other is 404', async (t) => {
    const rig = await pageRig(t);
    const answer = await editText(rig, 'Ship faster', 'Ship it');
    const results = await Promise.allSettled([rig.edits.undo('art', answer.edit.id), rig.edits.undo('art', answer.edit.id)]);
    assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL);
  });

  test('undo after the file changed again is refused with the E9 sentence and changes nothing', async (t) => {
    const rig = await pageRig(t);
    const answer = await editText(rig, 'Ship faster', 'Ship it');
    await writeFile(rig.tmp.at('art/index.html'), '<h1>agent</h1>');
    await assert.rejects(rig.edits.undo('art', answer.edit.id), rejectsWith('stale', UNDO_STALE_MESSAGE));
    assert.equal(await rig.tmp.read('art/index.html'), '<h1>agent</h1>');
  });

  test('undo survives a new service instance (the record is on disk)', async (t) => {
    const rig = await pageRig(t);
    const answer = await editText(rig, 'Ship faster', 'Ship it');
    const fresh = rig.restart();
    await fresh.undo('art', answer.edit.id);
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL);
    await assert.rejects(fresh.undo('art', answer.edit.id), rejectsWith('not-found', UNDO_GONE_MESSAGE));
  });

  test('an undo record past 30 minutes is gone', async (t) => {
    const rig = await pageRig(t);
    const answer = await editText(rig, 'Ship faster', 'Ship it');
    rig.clock.now += 31 * 60_000;
    await assert.rejects(rig.edits.undo('art', answer.edit.id), rejectsWith('not-found', UNDO_GONE_MESSAGE));
  });

  test('a burst shares one version; Undo steps back through it one edit at a time', async (t) => {
    const rig = await pageRig(t);
    const first = await editText(rig, 'Ship faster', 'Ship it faster');
    rig.clock.now += 5_000;
    const second = await editText(rig, 'it faster', 'it now');
    assert.equal(second.coalesced, true);
    assert.equal(second.version, null);
    assert.equal((await versionsOf(rig.tmp, 'art')).length, 1);
    await rig.edits.undo('art', second.edit.id);
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL.replace('Ship faster', 'Ship it faster'));
    await rig.edits.undo('art', first.edit.id);
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL);
  });

  test('when edits.json cannot be written the edit stands and says it has no Undo', async (t) => {
    const rig = await pageRig(t);
    await mkdir(rig.tmp.at('art/elsewhere'));
    await symlink(rig.tmp.at('art/elsewhere'), rig.tmp.at('art/.chamber'));
    const answer = await editText(rig, 'Ship faster', 'Ship it');
    assert.equal(answer.edit.undoable, false);
    assert.equal(await rig.tmp.read('art/index.html'), ORIGINAL.replace('Ship faster', 'Ship it'));
    assert.ok(rig.ctx.logs.some((line) => line.event === 'edits.record-failed'));
  });
});

describe('the ledger (§7.1)', () => {
  test('each edit appends one structured entry; an unsent edit undone leaves no trace; a sent one is followed by "undo"', async (t) => {
    const rig = await pageRig(t);
    const first = await editText(rig, 'Ship faster', 'Ship it');
    let file = await editsJson(rig.tmp, 'art');
    assert.deepEqual(file.ledger, [{ seq: 1, at: new Date(START).toISOString(), editId: first.edit.id, kind: 'text', file: 'index.html', screen: null, before: 'Ship faster', after: 'Ship it' }]);
    await rig.edits.undo('art', first.edit.id);
    assert.deepEqual((await editsJson(rig.tmp, 'art')).ledger, []);

    const second = await editText(rig, 'Ship faster', 'Ship now');
    await rig.edits.clearHandEdits('art', 2);
    await rig.edits.clearHandEdits('art', 2); // idempotent
    await rig.edits.undo('art', second.edit.id);
    file = await editsJson(rig.tmp, 'art');
    assert.deepEqual(file.ledger.map((entry) => [entry.seq, entry.kind]), [[3, 'undo']]);
    await assert.rejects(rig.edits.clearHandEdits('art', 4), (error: unknown) => error instanceof ApiError && error.code === 'bad-request');
  });

  for (const order of ['clear lands while the edit is held in its plan', 'clear lands while the edit waits to append'] as const) {
    test(`concurrent clear + edit (${order}) keeps both the undo record and the cleared ledger`, async (t) => {
      const held = gate();
      const reached = gate();
      let armed = false;
      const hold = async (): Promise<void> => {
        if (!armed) return;
        reached.open();
        await held.wait;
      };
      const inPlan = order === 'clear lands while the edit is held in its plan';
      const rig = await setup(t, {
        ops: { text: fakeText({ afterRead: inPlan ? hold : undefined }) },
        editsFile: (real) => ({
          read: real.read,
          update: async (slug, dir, mutate) => {
            if (!inPlan) await hold();
            return real.update(slug, dir, mutate);
          },
        }),
      });
      await rig.tmp.writeDesign('art', pageDesign({ 'index.html': ORIGINAL }));
      const first = await editText(rig, 'Ship faster', 'Ship it');
      armed = true;
      const editing = editText(rig, 'Ship it', 'Ship now');
      await reached.wait;
      armed = false; // the clear passes the gate
      await rig.edits.clearHandEdits('art', 1);
      held.open();
      const second = await editing;
      const file = await editsJson(rig.tmp, 'art');
      assert.deepEqual(file.ledger.map((entry) => entry.seq), [2], 'entry 1 stays cleared and entry 2 is there');
      assert.deepEqual(file.undo.map((record) => record.id), [first.edit.id, second.edit.id], 'both undo records are there');
    });
  }
});

describe('screens and comments steps report what they wrote', () => {
  test('the screens step feeds the self-write hook with the exact bytes it renames', async (t) => {
    const rig = await setup(t, { ops: { duplicate: fakeDuplicate } });
    await rig.tmp.writeDesign('wall', canvasDesign());
    await rig.edits.apply('wall', { op: 'duplicate', screens: (await rig.ctx.store.get('wall')).screensStamp, id: 'home', file: await stampOf(rig.tmp, 'wall/screens/home.html') });
    assert.equal(await rig.ctx.selfWrites.isEcho('wall', 'design.json', rig.tmp.at('wall')), true);
    assert.equal(await rig.ctx.selfWrites.isEcho('wall', 'screens/home-copy.html', rig.tmp.at('wall')), true);
    const raw = (await rawOf(rig.tmp.at('wall'))).screens as JsonValue[];
    assert.equal(raw.length, 3);
  });
});

describe('raw disk errors become the folder sentence', () => {
  test('an op whose read fails on the disk answers a sentence, not the generic 500', async (t) => {
    const failing: OpModule<RequestOf<'text'>> = {
      plan: async () => {
        throw Object.assign(new Error('EACCES: permission denied, open /secret/path'), { code: 'EACCES' });
      },
    };
    const rig = await setup(t, { ops: { text: failing } });
    await rig.tmp.writeDesign('art', pageDesign({ 'index.html': ORIGINAL }));
    await assert.rejects(editText(rig, 'Ship faster', 'x'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'internal');
      assert.match(error.message, /is not allowed to write to/);
      return true;
    });
    assert.ok(rig.ctx.logs.some((line) => line.event === 'edits.write-failed' && line.fields?.code === 'EACCES'));
    assert.doesNotMatch(JSON.stringify(rig.ctx.logs), /Ship faster/, 'no typed text in the log');
  });
});
