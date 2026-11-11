// The screen ops end to end over the REAL store and versions (Phase 2 technical design §5.1,
// §5.2, §6.2, §2.9, §17; PS 10, 11): screen-list stamps, the raw list kept, free copy ids, trash
// names, undo of each op, keep-direction with its comments moved and moved back precisely,
// rollback mid-way, provisional and unreadable design.json refused, comments never dropped, and
// `writeScreens` giving up after its 5th lost attempt with a 409 and nothing written.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { describe, test, type TestContext } from 'node:test';

import type { EditResponse, FileStamp } from '../../../src/shared/api.ts';
import { SCREENS_MAX } from '../../../src/shared/limits.ts';
import {
  DESIGN_JSON_UNREADABLE_MESSAGE,
  NO_DESIGN_JSON_MESSAGE,
  SCREEN_LIST_STALE_MESSAGE,
  SCREEN_LIST_UNREADABLE_MESSAGE,
  SCREENS_CAP_MESSAGE,
} from '../../../src/shared/screen-ops.ts';
import type { Comment, JsonObject, JsonValue, VersionEntry } from '../../../src/shared/types.ts';
import type { DesignStore } from '../../../src/service/context.ts';
import { KEEP_NOT_WRITTEN_MESSAGE, KEPT_CURRENT_DETAIL, KEPT_OTHERS_DETAIL } from '../../../src/service/edits/ops-screens.ts';
import { createEditService, ROLLED_BACK_MESSAGE, UNDO_STALE_MESSAGE, type EditService } from '../../../src/service/edits/pipeline.ts';
import { trashStampOf } from '../../../src/service/edits/trash.ts';
import { ApiError } from '../../../src/service/http.ts';
import { LINK_SENTENCE } from '../../../src/service/paths.ts';
import { DESIGN_JSON_BUSY_MESSAGE, screensStampOf } from '../../../src/service/store.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { createCore, type Core } from './harness.ts';

const START = Date.parse('2026-11-11T12:00:00.000Z');
const STAMP = trashStampOf(new Date(START));

type Rig = {
  core: Core;
  clock: { now: number };
  edits: EditService;
  /** A new service over the same root (a restart: new versions memory, new edits queue). */
  restart(): EditService;
  at(rel: string): string;
  read(rel: string): Promise<string>;
};

type RigOptions = { store?: (real: DesignStore) => DesignStore };

const setup = async (t: TestContext, options: RigOptions = {}): Promise<Rig> => {
  const clock = { now: START };
  const core = await createCore(t, { now: () => new Date(clock.now) });
  t.after(() => core.stop());
  const store = options.store ? options.store(core.store) : core.store;
  const build = (): EditService =>
    createEditService({
      store,
      versions: createVersionsService({ store, hub: core.ctx.hub, log: core.ctx.log, onDispose: core.ctx.onDispose, quietMs: 600_000, now: () => clock.now }),
      hub: core.ctx.hub,
      selfWrites: core.ctx.selfWrites,
      settings: core.ctx.settings,
      log: core.ctx.log,
      now: () => new Date(clock.now),
      pause: async () => undefined,
    });
  const at = (rel: string): string => `${core.root}/${rel}`;
  return { core, clock, edits: build(), restart: build, at, read: (rel) => readFile(at(rel), 'utf8') };
};

const html = (name: string): string => `<!doctype html><html><body><h1>${name}</h1></body></html>`;

/** A canvas whose raw list carries an invalid entry and an unknown key between the listed screens. */
const CANVAS_JSON: JsonObject = {
  version: 1,
  kind: 'canvas',
  title: 'Shop',
  created: '2026-10-26T10:00:00.000Z',
  updated: '2026-10-26T10:00:00.000Z',
  agentNote: 'kept',
  screens: [
    { id: 'home', title: 'Home', file: 'screens/home.html', note: 'agent key' },
    { id: 'Broken Id', title: 'Not shown' },
    { id: 'pricing', title: 'Pricing' },
    { id: 'checkout', title: 'Checkout' },
  ],
};

const writeCanvas = async (rig: Rig, json: JsonObject = CANVAS_JSON, files: Record<string, string> = {}): Promise<void> => {
  await rig.core.tmp.writeDesign('designs/shop', {
    'design.json': json,
    'screens/home.html': html('home'),
    'screens/pricing.html': html('pricing'),
    'screens/checkout.html': html('checkout'),
    ...files,
  });
};

const rawOf = async (rig: Rig): Promise<JsonObject> => JSON.parse(await rig.read('shop/design.json')) as JsonObject;
const stampNow = async (rig: Rig): Promise<string> => {
  const stamp = (await rig.core.store.get('shop')).screensStamp;
  assert.ok(stamp);
  return stamp;
};
const fileStamp = async (rig: Rig, rel: string): Promise<FileStamp> => {
  const info = await stat(rig.at(`shop/${rel}`));
  return { size: info.size, mtime: info.mtime.toISOString() };
};
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
const trashNames = async (rig: Rig): Promise<string[]> => (await readdir(rig.at('.trash')).catch(() => [])).sort();
const versionsOf = async (rig: Rig): Promise<VersionEntry[]> => {
  const text = await rig.read('shop/.versions/index.json').catch(() => null);
  return text === null ? [] : (JSON.parse(text) as { versions: VersionEntry[] }).versions;
};

const rejectsWith = (code: string, message: string) => (error: unknown): boolean => {
  assert.ok(error instanceof ApiError, String(error));
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  return true;
};

const anchor = { selector: 'h1', text: 'x', html: '<h1>', rect: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 0.5, y: 0.5 } };
const comment = (rig: Rig, screen: string, body: string): Promise<Comment> => rig.core.store.addComment('shop', { screen, viewport: 'laptop', anchor, body });
const commentScreens = async (rig: Rig): Promise<Record<string, string | null>> =>
  Object.fromEntries((await rig.core.store.get('shop')).state.comments.map((one) => [one.body, one.screen]));

describe('reorder', () => {
  test('moves only the listed entries, verbatim; the invalid entry, unknown keys and comments stay; undo puts the list back', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    await comment(rig, 'home', 'on home');
    const before = await rawOf(rig);
    const answer = await rig.edits.apply('shop', { op: 'reorder', screens: await stampNow(rig), order: ['checkout', 'home', 'pricing'] });
    assert.equal(answer.edit.label, 'Moved Checkout above Home');
    assert.deepEqual(answer.edit.files, ['design.json']);
    assert.equal(answer.version?.reason, 'user-edit');
    const after = await rawOf(rig);
    const screens = before.screens as JsonValue[];
    assert.deepEqual(after.screens, [screens[3], screens[1], screens[0], screens[2]]);
    assert.equal(after.agentNote, 'kept');
    assert.equal(after.title, 'Shop');
    assert.deepEqual((after.comments as JsonObject[]).map((one) => one.body), ['on home'], 'the screen write never drops a comment');
    assert.equal(answer.stamps.screens, await stampNow(rig));
    assert.equal(answer.stamps.screens, screensStampOf(after));

    await rig.edits.undo('shop', answer.edit.id);
    assert.deepEqual((await rawOf(rig)).screens, before.screens);
  });

  test('a move to the end and several moves read as such; a stale stamp writes nothing and takes no version', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    const toEnd = await rig.edits.apply('shop', { op: 'reorder', screens: await stampNow(rig), order: ['pricing', 'checkout', 'home'] });
    assert.equal(toEnd.edit.label, 'Moved Home to the end');
    const many = await rig.edits.apply('shop', { op: 'reorder', screens: await stampNow(rig), order: ['home', 'checkout', 'pricing'] });
    assert.equal(many.edit.label, 'Screens reordered');

    const text = await rig.read('shop/design.json');
    const versions = (await versionsOf(rig)).length;
    await assert.rejects(rig.edits.apply('shop', { op: 'reorder', screens: toEnd.stamps.screens ?? '', order: ['home', 'pricing', 'checkout'] }), rejectsWith('stale', SCREEN_LIST_STALE_MESSAGE));
    assert.equal(await rig.read('shop/design.json'), text);
    assert.equal((await versionsOf(rig)).length, versions);
  });

  test('an order that is not exactly the listed ids is 400; the same order is refused', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    const stamp = await stampNow(rig);
    await assert.rejects(rig.edits.apply('shop', { op: 'reorder', screens: stamp, order: ['home', 'pricing'] }), (error: unknown) => error instanceof ApiError && error.code === 'bad-request');
    await assert.rejects(rig.edits.apply('shop', { op: 'reorder', screens: stamp, order: ['home', 'pricing', 'checkout'] }), (error: unknown) => error instanceof ApiError && error.code === 'invalid');
  });
});

describe('refusals before any write', () => {
  test('a provisional design (no design.json) is refused and never gets one', async (t) => {
    const rig = await setup(t);
    await rig.core.tmp.writeDesign('designs/shop', { 'screens/home.html': html('home') });
    await rig.core.store.get('shop');
    const fake = 'a'.repeat(64);
    await assert.rejects(rig.edits.apply('shop', { op: 'reorder', screens: fake, order: ['home'] }), rejectsWith('invalid', NO_DESIGN_JSON_MESSAGE));
    await assert.rejects(rig.core.store.writeScreens('shop', fake, () => []), rejectsWith('invalid', NO_DESIGN_JSON_MESSAGE));
    assert.equal(await exists(rig.at('shop/design.json')), false);
  });

  test('an unparseable design.json and a screens value that is not a list are refused with their sentences', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    const stamp = await stampNow(rig);
    await writeFile(rig.at('shop/design.json'), '{ "screens": [');
    await assert.rejects(rig.edits.apply('shop', { op: 'trash-screen', screens: stamp, id: 'home', file: null }), rejectsWith('invalid', DESIGN_JSON_UNREADABLE_MESSAGE));
    await assert.rejects(rig.core.store.writeScreens('shop', stamp, () => []), rejectsWith('invalid', DESIGN_JSON_UNREADABLE_MESSAGE));
    assert.equal(await rig.read('shop/design.json'), '{ "screens": [');

    await writeFile(rig.at('shop/design.json'), JSON.stringify({ ...CANVAS_JSON, screens: { home: true } }));
    await assert.rejects(rig.edits.apply('shop', { op: 'trash-screen', screens: await stampNow(rig), id: 'home', file: null }), rejectsWith('invalid', SCREEN_LIST_UNREADABLE_MESSAGE));
    assert.equal(await exists(rig.at('shop/screens/home.html')), true);
  });
});

describe('duplicate', () => {
  test('a free id past a stray file on disk, inserted after the original, comments stay; undo sends the copy to the trash', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig, CANVAS_JSON, { 'screens/home-copy.html': html('stray') });
    await comment(rig, 'home', 'on home');
    const before = await rawOf(rig);
    const answer = await rig.edits.apply('shop', { op: 'duplicate', screens: await stampNow(rig), id: 'home', file: await fileStamp(rig, 'screens/home.html') });
    assert.equal(answer.edit.label, 'Duplicated Home');
    assert.deepEqual(answer.created, { id: 'home-copy-2', title: 'Home copy' });
    assert.deepEqual(answer.edit.files, ['design.json', 'screens/home-copy-2.html']);
    assert.equal(await rig.read('shop/screens/home-copy-2.html'), html('home'));
    assert.equal(await rig.read('shop/screens/home-copy.html'), html('stray'), 'never overwritten');
    const screens = (await rawOf(rig)).screens as JsonObject[];
    assert.deepEqual(screens.map((entry) => entry.id), ['home', 'home-copy-2', 'Broken Id', 'pricing', 'checkout']);
    assert.deepEqual(screens[1], { id: 'home-copy-2', title: 'Home copy', file: 'screens/home-copy-2.html', note: 'agent key' });
    assert.deepEqual(await commentScreens(rig), { 'on home': 'home' });

    await rig.edits.undo('shop', answer.edit.id);
    assert.equal(await exists(rig.at('shop/screens/home-copy-2.html')), false);
    assert.deepEqual((await rawOf(rig)).screens, before.screens);
    assert.deepEqual(await trashNames(rig), [`shop.home-copy-2-${STAMP}.html`]);
  });

  test('at 40 screens the copy is refused; a file that changed since the wall read it is stale', async (t) => {
    const rig = await setup(t);
    const many = Array.from({ length: SCREENS_MAX }, (_, n) => ({ id: `s${n}`, title: `S${n}` }));
    await writeCanvas(rig, { ...CANVAS_JSON, screens: many }, { 'screens/s0.html': html('s0') });
    await assert.rejects(rig.edits.apply('shop', { op: 'duplicate', screens: await stampNow(rig), id: 's0', file: await fileStamp(rig, 'screens/s0.html') }), rejectsWith('invalid', SCREENS_CAP_MESSAGE));

    const other = await setup(t);
    await writeCanvas(other);
    const seen = await fileStamp(other, 'screens/home.html');
    await writeFile(other.at('shop/screens/home.html'), html('the agent rewrote home'));
    await assert.rejects(other.edits.apply('shop', { op: 'duplicate', screens: await stampNow(other), id: 'home', file: seen }), rejectsWith('stale', SCREEN_LIST_STALE_MESSAGE));
    assert.deepEqual((await readdir(other.at('shop/screens'))).sort(), ['checkout.html', 'home.html', 'pricing.html']);
  });

  test('a screen file that is a link is refused with the link sentence', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    await rm(rig.at('shop/screens/home.html'));
    await symlink(rig.at('shop/screens/pricing.html'), rig.at('shop/screens/home.html'));
    const file = await fileStamp(rig, 'screens/home.html');
    await assert.rejects(rig.edits.apply('shop', { op: 'duplicate', screens: await stampNow(rig), id: 'home', file }), rejectsWith('invalid', LINK_SENTENCE));
  });
});

describe('move to trash', () => {
  test('the file goes to <root>/.trash/<slug>.<id>-<stamp>.html, the entry leaves, comments stay; undo puts both back', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    await comment(rig, 'pricing', 'on pricing');
    const before = await rawOf(rig);
    const answer = await rig.edits.apply('shop', { op: 'trash-screen', screens: await stampNow(rig), id: 'pricing', file: await fileStamp(rig, 'screens/pricing.html') });
    assert.equal(answer.edit.label, 'Moved Pricing to trash');
    assert.deepEqual(await trashNames(rig), [`shop.pricing-${STAMP}.html`]);
    assert.equal(await rig.read(`.trash/shop.pricing-${STAMP}.html`), html('pricing'));
    assert.deepEqual(((await rawOf(rig)).screens as JsonObject[]).map((entry) => entry.id), ['home', 'Broken Id', 'checkout']);
    assert.deepEqual(await commentScreens(rig), { 'on pricing': 'pricing' }, 'comments are not touched');

    await rig.edits.undo('shop', answer.edit.id);
    assert.equal(await rig.read('shop/screens/pricing.html'), html('pricing'));
    assert.deepEqual((await rawOf(rig)).screens, before.screens);
    assert.deepEqual(await trashNames(rig), []);
  });

  test('the last screen may go; a screen not written yet leaves only the list', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig, { ...CANVAS_JSON, screens: [{ id: 'home', title: 'Home' }, { id: 'later', title: 'Later' }] });
    await rig.edits.apply('shop', { op: 'trash-screen', screens: await stampNow(rig), id: 'later', file: null });
    await rig.edits.apply('shop', { op: 'trash-screen', screens: await stampNow(rig), id: 'home', file: await fileStamp(rig, 'screens/home.html') });
    assert.deepEqual((await rawOf(rig)).screens, []);
    assert.deepEqual((await rig.core.store.get('shop')).design.screens, []);
  });

  test('a file the wall showed as not written that exists now is stale', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    await assert.rejects(rig.edits.apply('shop', { op: 'trash-screen', screens: await stampNow(rig), id: 'home', file: null }), rejectsWith('stale', SCREEN_LIST_STALE_MESSAGE));
    assert.equal(await exists(rig.at('shop/screens/home.html')), true);
  });
});

// ---- keep a direction ----

const DIRECTIONS_JSON: JsonObject = {
  ...CANVAS_JSON,
  screens: [
    { id: 'home', title: 'Home', file: 'screens/home.html' },
    { id: 'home-a', title: 'Home, bold', direction: { of: 'home', letter: 'A', name: 'Bold' } },
    { id: 'pricing', title: 'Pricing' },
    { id: 'home-b', title: 'Home, editorial', direction: { of: 'home', letter: 'B', name: 'Editorial' } },
    { id: 'home-c', title: 'Home, quiet', direction: { of: 'home', letter: 'C', name: 'Quiet' } },
  ],
};

const writeDirections = async (rig: Rig, files: Record<string, string> = {}): Promise<void> =>
  writeCanvas(rig, DIRECTIONS_JSON, { 'screens/home-a.html': html('A'), 'screens/home-b.html': html('B'), 'screens/home-c.html': html('C'), ...files });

const groupFiles = async (rig: Rig, ids: string[] = ['home', 'home-a', 'home-b', 'home-c']): Promise<{ id: string; file: FileStamp | null }[]> =>
  Promise.all(ids.map(async (id) => ({ id, file: (await exists(rig.at(`shop/screens/${id}.html`))) ? await fileStamp(rig, `screens/${id}.html`) : null })));

const keep = async (rig: Rig, which: string, edits: EditService = rig.edits): Promise<EditResponse> =>
  edits.apply('shop', { op: 'keep-direction', screens: await stampNow(rig), of: 'home', keep: which, files: await groupFiles(rig) });

describe('keep a direction', () => {
  test('keep B: version first, B in the original place, the others in the trash, marks gone, only B\'s comments move', async (t) => {
    const rig = await setup(t);
    await writeDirections(rig);
    await comment(rig, 'home', 'on the original');
    await comment(rig, 'home-b', 'on B one');
    await comment(rig, 'home-b', 'on B two');
    await comment(rig, 'home-a', 'on A');
    // A hand edit just before: keep-direction never coalesces into its "Before your edits".
    await rig.edits.apply('shop', { op: 'reorder', screens: await stampNow(rig), order: ['pricing', 'home', 'home-a', 'home-b', 'home-c'] });
    const before = await rawOf(rig);

    const answer = await keep(rig, 'home-b');
    assert.equal(answer.edit.label, 'Kept B for Home');
    assert.equal(answer.edit.detail, KEPT_OTHERS_DETAIL);
    assert.equal(answer.version?.reason, 'keep-direction');
    assert.equal(answer.coalesced, false);
    assert.deepEqual((await versionsOf(rig)).map((one) => one.reason), ['user-edit', 'keep-direction']);
    assert.equal(await rig.read('shop/screens/home.html'), html('B'), "B's bytes, unchanged, in the original's file");
    assert.equal(await exists(rig.at('shop/screens/home-b.html')), false);
    assert.deepEqual(await trashNames(rig), [`shop.home-${STAMP}.html`, `shop.home-a-${STAMP}.html`, `shop.home-c-${STAMP}.html`]);
    assert.equal(await rig.read(`.trash/shop.home-${STAMP}.html`), html('home'));
    const screens = (await rawOf(rig)).screens as JsonObject[];
    assert.deepEqual(screens, [{ id: 'pricing', title: 'Pricing' }, { id: 'home', title: 'Home', file: 'screens/home.html' }], 'the original keeps its id, title and place');
    assert.deepEqual(await commentScreens(rig), { 'on the original': 'home', 'on B one': 'home', 'on B two': 'home', 'on A': 'home-a' });

    const undone = await rig.edits.undo('shop', answer.edit.id);
    assert.ok(undone.files.includes('screens/home.html'));
    for (const id of ['home', 'home-a', 'home-b', 'home-c']) assert.equal(await rig.read(`shop/screens/${id}.html`), html(id === 'home' ? 'home' : id.slice(-1).toUpperCase()));
    assert.deepEqual(await trashNames(rig), []);
    assert.deepEqual((await rawOf(rig)).screens, before.screens);
    assert.deepEqual(await commentScreens(rig), { 'on the original': 'home', 'on B one': 'home-b', 'on B two': 'home-b', 'on A': 'home-a' }, 'only the comments the keep moved go back');
  });

  test('keep Current: every direction goes to the trash, no comment moves', async (t) => {
    const rig = await setup(t);
    await writeDirections(rig);
    await comment(rig, 'home-b', 'on B');
    const answer = await keep(rig, 'home');
    assert.equal(answer.edit.label, 'Kept the current Home');
    assert.equal(answer.edit.detail, KEPT_CURRENT_DETAIL);
    assert.equal(await rig.read('shop/screens/home.html'), html('home'));
    assert.deepEqual(await trashNames(rig), [`shop.home-a-${STAMP}.html`, `shop.home-b-${STAMP}.html`, `shop.home-c-${STAMP}.html`]);
    assert.deepEqual(((await rawOf(rig)).screens as JsonObject[]).map((entry) => entry.id), ['home', 'pricing']);
    assert.deepEqual(await commentScreens(rig), { 'on B': 'home-b' });
  });

  test('undo after a restart puts every file, the list and the comments back', async (t) => {
    const rig = await setup(t);
    await writeDirections(rig);
    await comment(rig, 'home-b', 'on B');
    const before = await rawOf(rig);
    const answer = await keep(rig, 'home-b');
    await rig.restart().undo('shop', answer.edit.id);
    assert.equal(await rig.read('shop/screens/home.html'), html('home'));
    assert.equal(await rig.read('shop/screens/home-b.html'), html('B'));
    assert.deepEqual((await rawOf(rig)).screens, before.screens);
    assert.deepEqual(await commentScreens(rig), { 'on B': 'home-b' });
  });

  test('a direction written since the wall loaded is stale; a direction not written cannot be kept', async (t) => {
    const rig = await setup(t);
    await writeDirections(rig, {});
    await rm(rig.at('shop/screens/home-c.html'));
    const files = await groupFiles(rig);
    await writeFile(rig.at('shop/screens/home-c.html'), html('C'));
    await assert.rejects(rig.edits.apply('shop', { op: 'keep-direction', screens: await stampNow(rig), of: 'home', keep: 'home-b', files }), rejectsWith('stale', SCREEN_LIST_STALE_MESSAGE));
    await rm(rig.at('shop/screens/home-c.html'));
    await assert.rejects(keep(rig, 'home-c'), rejectsWith('invalid', KEEP_NOT_WRITTEN_MESSAGE));
    assert.deepEqual(await trashNames(rig), []);
    assert.equal(await rig.read('shop/screens/home.html'), html('home'));
  });

  test('undo is refused before any change when the original\'s file changed after the keep', async (t) => {
    const rig = await setup(t);
    await writeDirections(rig);
    const answer = await keep(rig, 'home-b');
    await writeFile(rig.at('shop/screens/home.html'), html('the agent again'));
    await assert.rejects(rig.edits.undo('shop', answer.edit.id), rejectsWith('stale', UNDO_STALE_MESSAGE));
    assert.equal(await rig.read('shop/screens/home.html'), html('the agent again'));
    assert.equal((await trashNames(rig)).length, 3);
  });
});

describe('rollback mid-way (§2.9)', () => {
  test('a list write that gives up rolls every move back and answers its own sentence', async (t) => {
    const rig = await setup(t, {
      store: (real) =>
        new Proxy(real, {
          get: (target, property, receiver) =>
            property === 'writeScreens'
              ? async () => {
                  throw new ApiError('conflict', DESIGN_JSON_BUSY_MESSAGE);
                }
              : Reflect.get(target, property, receiver),
        }),
    });
    await writeDirections(rig);
    const before = await rig.read('shop/design.json');
    await assert.rejects(keep(rig, 'home-b'), rejectsWith('conflict', DESIGN_JSON_BUSY_MESSAGE));
    for (const id of ['home', 'home-a', 'home-b', 'home-c']) assert.equal(await rig.read(`shop/screens/${id}.html`), html(id === 'home' ? 'home' : id.slice(-1).toUpperCase()));
    assert.deepEqual(await trashNames(rig), []);
    assert.equal(await rig.read('shop/design.json'), before);
  });

  test('a comment move failing after the list write rolls the list and the files back', async (t) => {
    const rig = await setup(t, {
      store: (real) =>
        new Proxy(real, {
          get: (target, property, receiver) =>
            property === 'moveComments'
              ? async () => {
                  throw Object.assign(new Error('disk said no'), { code: 'EIO' });
                }
              : Reflect.get(target, property, receiver),
        }),
    });
    await writeDirections(rig);
    const screens = (await rawOf(rig)).screens;
    await assert.rejects(keep(rig, 'home-b'), rejectsWith('internal', ROLLED_BACK_MESSAGE));
    assert.deepEqual((await rawOf(rig)).screens, screens);
    assert.equal(await rig.read('shop/screens/home.html'), html('home'));
    assert.equal(await rig.read('shop/screens/home-b.html'), html('B'));
    assert.deepEqual(await trashNames(rig), []);
  });
});

describe('store.writeScreens and store.moveComments', () => {
  test('the hook sees the exact bytes written; the answer is those bytes and the new stamp', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    const seen: Uint8Array[] = [];
    const result = await rig.core.store.writeScreens('shop', await stampNow(rig), (raw) => (Array.isArray(raw) ? [...raw].reverse() : []), { beforeRename: (bytes) => void seen.push(bytes) });
    const onDisk = await readFile(rig.at('shop/design.json'));
    assert.equal(seen.length, 1);
    assert.deepEqual(Buffer.from(seen[0] ?? new Uint8Array()), onDisk);
    assert.deepEqual(Buffer.from(result.bytes), onDisk);
    assert.equal(result.stamp, await stampNow(rig));
  });

  test('an agent write that keeps the list re-applies; one that changes it is stale', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    const stamp = await stampNow(rig);
    let calls = 0;
    await rig.core.store.writeScreens('shop', stamp, (raw) => (Array.isArray(raw) ? raw.slice(1) : []), {
      beforeRename: () => {
        calls += 1;
        if (calls === 1) writeFileSync(rig.at('shop/design.json'), `${JSON.stringify({ ...CANVAS_JSON, title: 'Renamed by the agent' }, null, 2)}\n`);
      },
    });
    const raw = await rawOf(rig);
    assert.equal(calls, 2);
    assert.equal(raw.title, 'Renamed by the agent', "the agent's other change is kept");
    assert.equal((raw.screens as JsonValue[]).length, 3);

    await assert.rejects(
      rig.core.store.writeScreens('shop', await stampNow(rig), (list) => (Array.isArray(list) ? list : []), {
        beforeRename: () => writeFileSync(rig.at('shop/design.json'), JSON.stringify({ ...CANVAS_JSON, screens: [] })),
      }),
      rejectsWith('stale', SCREEN_LIST_STALE_MESSAGE),
    );
  });

  test('losing all 5 attempts answers 409 and writes nothing; the edit claims nothing either', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    let n = 0;
    const agentWrites = (): void => {
      n += 1;
      writeFileSync(rig.at('shop/design.json'), `${JSON.stringify({ ...CANVAS_JSON, title: `Agent ${n}` }, null, 2)}\n`);
    };
    const seen: Uint8Array[] = [];
    await assert.rejects(
      rig.core.store.writeScreens('shop', await stampNow(rig), (raw) => (Array.isArray(raw) ? raw.slice(1) : []), {
        beforeRename: (bytes) => {
          seen.push(bytes);
          agentWrites();
        },
      }),
      rejectsWith('conflict', DESIGN_JSON_BUSY_MESSAGE),
    );
    assert.equal(seen.length, 5);
    assert.equal((await rawOf(rig)).title, 'Agent 5', "the agent's file is untouched");
    assert.equal(((await rawOf(rig)).screens as JsonValue[]).length, 4);

    // Through the pipeline: the trash is rolled back and the answer is the conflict sentence.
    const piped = await setup(t, {
      store: (real) =>
        new Proxy(real, {
          get: (target, property, receiver) =>
            property === 'writeScreens'
              ? ((slug: string, stamp: string, mutate: Parameters<DesignStore['writeScreens']>[2]) =>
                  target.writeScreens(slug, stamp, mutate, {
                    beforeRename: () => writeFileSync(piped.at('shop/design.json'), `${JSON.stringify({ ...CANVAS_JSON, title: `Agent ${Math.random()}` }, null, 2)}\n`),
                  })) satisfies DesignStore['writeScreens']
              : Reflect.get(target, property, receiver),
        }),
    });
    await writeCanvas(piped);
    await assert.rejects(
      piped.edits.apply('shop', { op: 'trash-screen', screens: await stampNow(piped), id: 'pricing', file: await fileStamp(piped, 'screens/pricing.html') }),
      rejectsWith('conflict', DESIGN_JSON_BUSY_MESSAGE),
    );
    assert.equal(await piped.read('shop/screens/pricing.html'), html('pricing'));
    assert.deepEqual(await trashNames(piped), []);
  });

  test('moveComments with ids moves only those comments; without ids every comment on the screen', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    const one = await comment(rig, 'home', 'one');
    await comment(rig, 'home', 'two');
    const seen: Uint8Array[] = [];
    const limited = await rig.core.store.moveComments('shop', [{ from: 'home', to: 'pricing', ids: [one.id] }], { beforeRename: (bytes) => void seen.push(bytes) });
    assert.deepEqual(limited.moved, [{ id: one.id, from: 'home', to: 'pricing' }]);
    assert.deepEqual(await commentScreens(rig), { one: 'pricing', two: 'home' });
    assert.deepEqual(Buffer.from(limited.bytes ?? new Uint8Array()), await readFile(rig.at('shop/design.json')));
    assert.equal(seen.length, 1);
    const all = await rig.core.store.moveComments('shop', [{ from: 'pricing', to: 'checkout' }, { from: 'home', to: 'checkout' }]);
    assert.equal(all.moved.length, 2);
    assert.deepEqual(await commentScreens(rig), { one: 'checkout', two: 'checkout' });
    const none = await rig.core.store.moveComments('shop', [{ from: 'home', to: 'pricing' }]);
    assert.deepEqual(none, { moved: [], bytes: null });
  });

  test('a design.json the agent rewrote without comments gets them back on the next screen write', async (t) => {
    const rig = await setup(t);
    await writeCanvas(rig);
    await comment(rig, 'home', 'keep me');
    await writeFile(rig.at('shop/design.json'), `${JSON.stringify(CANVAS_JSON, null, 2)}\n`);
    await rig.core.store.writeScreens('shop', await stampNow(rig), (raw) => (Array.isArray(raw) ? raw : []));
    assert.deepEqual(((await rawOf(rig)).comments as JsonObject[]).map((entry) => entry.body), ['keep me']);
  });
});
