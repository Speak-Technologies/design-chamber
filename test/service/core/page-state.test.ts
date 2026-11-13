// Saved page data, service side (Phase 2 technical design §8.1, §8.2; feature 19): one store per
// design at .chamber/page-state.json, the 1 MB cap, at most one disk write per second per design
// (fake clock), a PATCH answered only once its change is on disk, flush on dispose, no re-created
// design after a removal, hostile files reading as empty, links refused on the lexical path, Clear
// never coming back, and nothing personal logged.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { PAGE_STATE_FILE_MAX_BYTES, PAGE_STATE_MAX_CHARS, PAGE_STATE_WRITE_MIN_MS } from '../../../src/shared/limits.ts';
import { formatGen, type PageStateDelta } from '../../../src/shared/page-state.ts';
import { ApiError } from '../../../src/service/http.ts';
import {
  createPageStateService,
  PAGE_STATE_CAP_SENTENCE,
  PAGE_STATE_GONE_SENTENCE,
  PAGE_STATE_IDLE_MS,
  PAGE_STATE_LINK_SENTENCE,
  PAGE_STATE_STALE_SENTENCE,
  type PageStateService,
  type Schedule,
} from '../../../src/service/page-state.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

/**
 * A clock the test moves by hand: a timer due now runs on its own (as `setTimeout(0)` does), a
 * later one when the clock passes its time.
 */
const fakeClock = (start = 1_000_000) => {
  let at = start;
  const timers: { due: number; run: () => void; cancelled: boolean }[] = [];
  const schedule: Schedule = (run, ms) => {
    const timer = { due: at + ms, run, cancelled: false };
    timers.push(timer);
    if (ms <= 0) {
      setImmediate(() => {
        if (timer.cancelled) return;
        timer.cancelled = true;
        timer.run();
      });
    }
    return () => {
      timer.cancelled = true;
    };
  };
  return {
    now: () => at,
    schedule,
    /** Timers created so far (each one is one disk write at most). */
    created: () => timers.length,
    pending: () => timers.filter((timer) => !timer.cancelled && timer.due > at - 1).length,
    advance(ms: number): void {
      at += ms;
      for (const timer of [...timers]) {
        if (timer.cancelled || timer.due > at) continue;
        timer.cancelled = true;
        timer.run();
      }
    },
  };
};

type Setup = { tmp: TmpRoot; ctx: FakeContext; clock: ReturnType<typeof fakeClock>; service: PageStateService; dir: string; fileOf: (slug?: string) => string };

const DESIGN = { 'design.json': { kind: 'page', title: 'Checklist' }, 'index.html': '<p>Checklist</p>' };

const setup = async (t: TestContext, options: { cacheMaxBytes?: number } = {}): Promise<Setup> => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', DESIGN);
  const ctx = createFakeContext({ root: tmp.root });
  const clock = fakeClock();
  const service = createPageStateService({ store: ctx.store, hub: ctx.hub, log: ctx.log, now: clock.now, schedule: clock.schedule, ...options });
  t.after(() => service.dispose());
  return { tmp, ctx, clock, service, dir, fileOf: (slug = 'demo') => tmp.at(`${slug}/.chamber/page-state.json`) };
};

const set = (...changes: [string, string | null][]): PageStateDelta => ({ clear: false, changes });

const onDisk = async (file: string): Promise<[string, string][] | null> => {
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  const parsed = JSON.parse(text) as { v: number; items: [string, string][] };
  assert.equal(parsed.v, 1);
  return parsed.items;
};

const exists = (target: string): Promise<boolean> => stat(target).then(() => true, () => false);

/** Every earlier task of the slug has settled once a read through the same chain answers. */
const settled = async (service: PageStateService, slug = 'demo'): Promise<void> => {
  await service.read(slug);
};

/** Let the service's file calls and chained tasks run until `done()` holds. */
const until = async (done: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(done(), `never happened: ${what}`);
};

/** How many changes the service applied so far (each one announces itself). */
const applied = (ctx: FakeContext): number => ctx.events.filter((event) => event.kind === 'page-state').length;

type Tracked<T> = { promise: Promise<T>; settled: () => boolean };

/** Whether a promise has settled yet, without waiting for it. */
const tracked = <T>(promise: Promise<T>): Tracked<T> => {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  return { promise, settled: () => done };
};

const rejectsWith = (promise: Promise<unknown>, code: string, message?: string | RegExp): Promise<void> =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, String(error));
    assert.equal(error.code, code);
    if (typeof message === 'string') assert.equal(error.message, message);
    else if (message) assert.match(error.message, message);
    return true;
  });

const linkOrSkip = async (t: TestContext, target: string, link: string, type: 'file' | 'dir'): Promise<boolean> => {
  try {
    await symlink(target, link, process.platform === 'win32' && type === 'dir' ? 'junction' : type);
    return true;
  } catch (error) {
    t.skip(`symlinks unavailable on this platform/account: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

describe('page-state: read and write', () => {
  test('a design with no data reads empty and nothing is created until it writes', async (t) => {
    const { service, ctx, dir } = await setup(t);
    assert.deepEqual(await service.read('demo'), { items: [], chars: 0, gen: formatGen(ctx.epoch, 0) });
    assert.equal(await exists(path.join(dir, '.chamber')), false);
  });

  test('a PATCH is answered once the file holds the pairs, in order', async (t) => {
    const { service, ctx, fileOf } = await setup(t);
    const answer = await service.patch('demo', formatGen(ctx.epoch, 0), set(['checklist:done', '[1,3,4]'], ['theme', 'dark']));
    assert.deepEqual(answer, { chars: 'checklist:done[1,3,4]themedark'.length, gen: formatGen(ctx.epoch, 0) });
    assert.deepEqual(await onDisk(fileOf()), [['checklist:done', '[1,3,4]'], ['theme', 'dark']], 'on disk when answered');
    assert.deepEqual((await service.read('demo')).items, [['checklist:done', '[1,3,4]'], ['theme', 'dark']]);
    // The event says only which design: no keys, no values.
    const events = ctx.events.filter((event) => event.kind === 'page-state');
    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0] ?? {}).sort(), ['kind', 'seq', 'slug']);
  });

  test('a retried PATCH changes nothing: answered the same, not written or announced again', async (t) => {
    const { service, ctx, clock } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    const first = await service.patch('demo', gen, set(['a', '1']));
    clock.advance(0);
    await settled(service);
    const timers = clock.created();
    assert.deepEqual(await service.patch('demo', gen, set(['a', '1'])), first);
    assert.equal(clock.created(), timers, 'no new write scheduled');
    assert.equal(ctx.events.filter((event) => event.kind === 'page-state').length, 1);
  });

  test('a new service instance (a restart) reads what the last one wrote, and accepts the old epoch', async (t) => {
    const { service, ctx, clock, tmp } = await setup(t);
    await service.patch('demo', formatGen(ctx.epoch, 0), set(['theme', 'dark']));
    clock.advance(0);
    await service.dispose();

    const next = createFakeContext({ root: tmp.root });
    const restarted = createPageStateService({ store: next.store, hub: next.hub, log: next.log });
    t.after(() => restarted.dispose());
    assert.deepEqual((await restarted.read('demo')).items, [['theme', 'dark']]);
    // The page loaded under the old run: its gen has another epoch, which the counter cannot judge.
    await restarted.patch('demo', formatGen(ctx.epoch, 0), set(['theme', 'light']));
    assert.deepEqual((await restarted.read('demo')).items, [['theme', 'light']]);
  });

  test('designs keep separate stores', async (t) => {
    const { service, ctx, clock, tmp, fileOf } = await setup(t);
    await tmp.writeDesign('other', DESIGN);
    await service.patch('demo', formatGen(ctx.epoch, 0), set(['k', 'demo']));
    await service.patch('other', formatGen(ctx.epoch, 0), set(['k', 'other']));
    clock.advance(0);
    await settled(service, 'demo');
    await settled(service, 'other');
    assert.deepEqual(await onDisk(fileOf('demo')), [['k', 'demo']]);
    assert.deepEqual(await onDisk(fileOf('other')), [['k', 'other']]);
  });

  test('an unknown design or a bad name is refused before any file is touched', async (t) => {
    const { service, ctx, tmp } = await setup(t);
    await rejectsWith(service.read('no-such-design'), 'not-found');
    await rejectsWith(service.patch('../demo', formatGen(ctx.epoch, 0), set(['a', 'b'])), 'bad-slug');
    await rejectsWith(service.clear('BAD SLUG'), 'bad-slug');
    assert.equal(await exists(tmp.at('no-such-design')), false);
  });
});

describe('page-state: the 1 MB cap (keys and values together)', () => {
  test('exactly at the cap is saved; one character more is refused and nothing of it applied', async (t) => {
    const { service, ctx, clock, fileOf } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['keep', 'me']));
    // Within a second of the first write: answered when the clock reaches the next one.
    const filling = service.patch('demo', gen, set(['big', 'x'.repeat(PAGE_STATE_MAX_CHARS - 6 - 3)]));
    await until(() => applied(ctx) === 2, 'the big value applied');
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    const full = await filling;
    assert.equal(full.chars, PAGE_STATE_MAX_CHARS);

    await rejectsWith(service.patch('demo', gen, set(['keep', null], ['k', 'v'.repeat(10)])), 'too-large', PAGE_STATE_CAP_SENTENCE);
    const after = await service.read('demo');
    assert.equal(after.chars, PAGE_STATE_MAX_CHARS);
    assert.deepEqual(after.items.map(([key]) => key), ['keep', 'big'], 'the removal in the refused delta was not applied either');

    clock.advance(0);
    await settled(service);
    assert.deepEqual((await onDisk(fileOf()))?.map(([key]) => key), ['keep', 'big']);
  });
});

describe('page-state: at most one disk write per second per design', () => {
  test('a storm of PATCHes is coalesced into one write a second, carrying the latest data', async (t) => {
    const { service, ctx, clock, fileOf } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['n', '0']));
    clock.advance(0);
    await settled(service);
    assert.deepEqual(await onDisk(fileOf()), [['n', '0']]);

    // A design writing on every animation frame for most of a second.
    const answers: Tracked<unknown>[] = [];
    for (let frame = 1; frame <= 50; frame += 1) {
      answers.push(tracked(service.patch('demo', gen, set(['n', String(frame)]))));
      await until(() => applied(ctx) === 1 + frame, `frame ${frame} applied`);
      clock.advance(16);
    }
    await settled(service);
    assert.deepEqual(await onDisk(fileOf()), [['n', '0']], 'nothing written before the second is up');
    assert.equal(answers.filter((answer) => answer.settled()).length, 0, 'no PATCH answered before its change is on disk');
    assert.equal(clock.created(), 2, 'one write for the first PATCH, one coalesced write for the other fifty');

    clock.advance(PAGE_STATE_WRITE_MIN_MS - 50 * 16);
    await Promise.all(answers.map((answer) => answer.promise));
    assert.deepEqual(await onDisk(fileOf()), [['n', '50']]);
    assert.equal(clock.created(), 2);
  });

  test('a quiet design writes at once, never sooner than a second after its previous write', async (t) => {
    const { service, ctx, clock, fileOf } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    clock.advance(PAGE_STATE_WRITE_MIN_MS * 5);
    await service.patch('demo', gen, set(['a', '2']));
    assert.deepEqual(await onDisk(fileOf()), [['a', '2']]);
    const third = tracked(service.patch('demo', gen, set(['a', '3'])));
    await until(() => applied(ctx) === 3, 'the third change applied');
    clock.advance(PAGE_STATE_WRITE_MIN_MS - 1);
    await settled(service);
    assert.deepEqual(await onDisk(fileOf()), [['a', '2']]);
    assert.equal(third.settled(), false, 'not answered while its change is only in memory');
    clock.advance(1);
    await third.promise;
    assert.deepEqual(await onDisk(fileOf()), [['a', '3']]);
  });

  test('dispose flushes a write that was not due yet, and its PATCH is answered then', async (t) => {
    const { service, ctx, clock, fileOf } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    const last = tracked(service.patch('demo', gen, set(['a', 'last before close'])));
    await until(() => applied(ctx) === 2, 'the last change applied');
    assert.equal(last.settled(), false);
    await service.dispose();
    await last.promise;
    assert.deepEqual(await onDisk(fileOf()), [['a', 'last before close']]);
    assert.equal(clock.pending(), 0, 'the timer was cancelled');
  });

  test('a root change flushes to the old folder and forgets the cache', async (t) => {
    const { service, ctx, fileOf } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    const beforeClear = service.patch('demo', gen, set(['a', '2']));
    await until(() => applied(ctx) === 2, 'the second change applied');
    await service.clear('demo');
    await beforeClear; // made before the Clear: answered by it, nothing to write
    await service.patch('demo', formatGen(ctx.epoch, 1), set(['a', 'written']));
    const pending = service.patch('demo', formatGen(ctx.epoch, 1), set(['a', 'pending']));
    await until(() => applied(ctx) === 5, 'the pending change applied');
    ctx.hub.emit({ slug: null, kind: 'root' });
    await service.flush();
    await pending;
    assert.deepEqual(await onDisk(fileOf()), [['a', 'pending']]);
    assert.equal((await service.read('demo')).gen, formatGen(ctx.epoch, 0), 'the clear counter is dropped with the root');
  });
});

describe('page-state: a removed design is never re-created', () => {
  test('a removed event drops the pending write', async (t) => {
    const { service, ctx, clock, tmp } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    const second = service.patch('demo', gen, set(['a', '2']));
    await until(() => applied(ctx) === 2, 'the second change applied');
    await rm(tmp.at('demo'), { recursive: true });
    ctx.hub.emit({ slug: 'demo', kind: 'removed' });
    await rejectsWith(second, 'not-found', PAGE_STATE_GONE_SENTENCE);
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await service.flush();
    assert.equal(await exists(tmp.at('demo')), false);
    assert.equal(ctx.logs.some((line) => line.event === 'page-state.write-failed'), false, 'the dropped write was never even tried');
  });

  test('a folder deleted before the event arrives: the write fails, nothing is created, only the code is logged', async (t) => {
    const { service, ctx, clock, tmp } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['private', 'career notes']));
    const second = service.patch('demo', gen, set(['private', 'more career notes']));
    await until(() => applied(ctx) === 2, 'the second change applied');
    await rm(tmp.at('demo'), { recursive: true });
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await rejectsWith(second, 'internal');
    await service.flush();
    assert.equal(await exists(tmp.at('demo')), false);
    const failed = ctx.logs.find((line) => line.event === 'page-state.write-failed');
    assert.deepEqual(failed?.fields, { slug: 'demo', code: 'ENOENT' });
  });
});

describe('page-state: hostile or hand-edited files read as no data', () => {
  const hostile: [string, string | Uint8Array][] = [
    ['not JSON', '{"v":1,"items":[["a",'],
    ['another version', JSON.stringify({ v: 2, items: [['a', 'b']] })],
    ['items not pairs', JSON.stringify({ v: 1, items: [['a', 'b', 'c']] })],
    ['a number value', JSON.stringify({ v: 1, items: [['a', 5]] })],
    ['over the cap', JSON.stringify({ v: 1, items: [['a', 'x'.repeat(PAGE_STATE_MAX_CHARS)]] })],
    ['binary', new Uint8Array([0xff, 0xfe, 0x00, 0x01])],
  ];
  for (const [label, content] of hostile) {
    test(`${label}: empty and damaged; the next save replaces the file`, async (t) => {
      const { service, ctx, clock, tmp, fileOf } = await setup(t);
      await tmp.write('demo/.chamber/page-state.json', content);
      const read = await service.read('demo');
      assert.deepEqual(read, { items: [], chars: 0, gen: formatGen(ctx.epoch, 0), damaged: true });
      assert.deepEqual(ctx.logs.find((line) => line.event === 'page-state.unreadable')?.fields, { slug: 'demo' });

      await service.patch('demo', formatGen(ctx.epoch, 0), set(['fresh', 'start']));
      clock.advance(0);
      await settled(service);
      assert.deepEqual(await onDisk(fileOf()), [['fresh', 'start']]);
      assert.equal((await service.read('demo')).damaged, undefined);
    });
  }

  test('a file over the read cap is never read', async (t) => {
    const { service, ctx, tmp } = await setup(t);
    await tmp.write('demo/.chamber/page-state.json', ' '.repeat(PAGE_STATE_FILE_MAX_BYTES + 1));
    assert.equal((await service.read('demo')).damaged, true);
    assert.deepEqual(ctx.logs.find((line) => line.event === 'page-state.unreadable')?.fields, { slug: 'demo', code: 'too-large' });
  });

  test('prototype keys stay plain data and repeated keys keep the first value', async (t) => {
    const { service, tmp } = await setup(t);
    await tmp.write('demo/.chamber/page-state.json', JSON.stringify({ v: 1, items: [['__proto__', '{"polluted":true}'], ['a', '1'], ['a', '2']] }));
    assert.deepEqual((await service.read('demo')).items, [['__proto__', '{"polluted":true}'], ['a', '1']]);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test('a page-state.json that is a folder reads as no data and a write refuses', async (t) => {
    const { service, ctx, tmp } = await setup(t);
    await mkdir(tmp.at('demo/.chamber/page-state.json'), { recursive: true });
    assert.equal((await service.read('demo')).items.length, 0);
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', 'b'])), 'invalid', PAGE_STATE_LINK_SENTENCE);
  });
});

describe('page-state: links are refused on the lexical path', () => {
  test('a .chamber that links to a folder inside the design: reads empty, writes and Clear refuse, the target untouched', async (t) => {
    const { service, ctx, clock, tmp, dir } = await setup(t);
    const inner = JSON.stringify({ v: 1, items: [['planted', 'data']] });
    await tmp.write('demo/elsewhere/page-state.json', inner);
    if (!(await linkOrSkip(t, path.join(dir, 'elsewhere'), path.join(dir, '.chamber'), 'dir'))) return;

    assert.deepEqual((await service.read('demo')).items, [], 'the linked data is never handed back');
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', 'b'])), 'invalid', PAGE_STATE_LINK_SENTENCE);
    await rejectsWith(service.clear('demo'), 'invalid', PAGE_STATE_LINK_SENTENCE);
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await service.flush();
    assert.equal(await readFile(tmp.at('demo/elsewhere/page-state.json'), 'utf8'), inner);
  });

  test('a page-state.json that links to a file inside the design: the same', async (t) => {
    const { service, ctx, tmp, dir } = await setup(t);
    await mkdir(path.join(dir, '.chamber'));
    await tmp.write('demo/notes.json', JSON.stringify({ v: 1, items: [['planted', 'data']] }));
    if (!(await linkOrSkip(t, path.join(dir, 'notes.json'), path.join(dir, '.chamber', 'page-state.json'), 'file'))) return;
    assert.deepEqual((await service.read('demo')).items, []);
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', 'b'])), 'invalid', PAGE_STATE_LINK_SENTENCE);
    assert.match(await readFile(tmp.at('demo/notes.json'), 'utf8'), /planted/);
  });

  test('a .chamber that links out of the designs folder: reads empty, writes refuse', async (t) => {
    const { service, ctx, tmp, dir } = await setup(t);
    const outside = path.join(path.dirname(tmp.root), `${path.basename(tmp.root)}-outside`);
    await mkdir(outside, { recursive: true });
    t.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(path.join(outside, 'page-state.json'), JSON.stringify({ v: 1, items: [['secret', 'outside']] }));
    if (!(await linkOrSkip(t, outside, path.join(dir, '.chamber'), 'dir'))) return;
    assert.deepEqual((await service.read('demo')).items, []);
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', 'b'])), 'invalid', PAGE_STATE_LINK_SENTENCE);
    assert.match(await readFile(path.join(outside, 'page-state.json'), 'utf8'), /outside/);
  });

  test('a .chamber that is a dangling link: the write refuses as a link and nothing is created at its target', async (t) => {
    const { service, ctx, dir } = await setup(t);
    const target = path.join(dir, 'not-there');
    if (!(await linkOrSkip(t, target, path.join(dir, '.chamber'), 'dir'))) return;
    // The link only shows at the write, and the PATCH waiting for it answers the refusal.
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', '1'])), 'invalid', PAGE_STATE_LINK_SENTENCE);
    assert.equal(await exists(target), false);
    assert.deepEqual(ctx.logs.find((line) => line.event === 'page-state.write-refused')?.fields, { slug: 'demo', reason: 'link' });
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', '2'])), 'invalid', PAGE_STATE_LINK_SENTENCE);
  });

  test('a .chamber swapped for a link after the data loaded: the next write refuses and writes nothing there', async (t) => {
    const { service, ctx, clock, tmp, dir } = await setup(t);
    await service.patch('demo', formatGen(ctx.epoch, 0), set(['a', '1']));
    await rm(path.join(dir, '.chamber'), { recursive: true });
    await mkdir(path.join(dir, 'elsewhere'));
    if (!(await linkOrSkip(t, path.join(dir, 'elsewhere'), path.join(dir, '.chamber'), 'dir'))) return;
    const second = service.patch('demo', formatGen(ctx.epoch, 0), set(['a', '2']));
    await until(() => applied(ctx) === 2, 'the second change applied');
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await rejectsWith(second, 'invalid', PAGE_STATE_LINK_SENTENCE);
    await service.flush();
    assert.equal(await exists(tmp.at('demo/elsewhere/page-state.json')), false);
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', '3'])), 'invalid', PAGE_STATE_LINK_SENTENCE);
  });
});

describe('page-state: Clear never comes back', () => {
  test('surface B holds dirty keys, A clears, B\'s next PATCH is stale and nothing reaches the disk', async (t) => {
    const { service, ctx, clock, fileOf } = await setup(t);
    const loaded = (await service.read('demo')).gen;
    await service.patch('demo', loaded, set(['ticked', '1,2,3']));
    clock.advance(0);
    await settled(service);

    const cleared = await service.clear('demo');
    assert.deepEqual(cleared, { ok: true, gen: formatGen(ctx.epoch, 1) });
    assert.equal(await onDisk(fileOf()), null);

    await rejectsWith(service.patch('demo', loaded, set(['ticked', '1,2,3,4'])), 'stale', PAGE_STATE_STALE_SENTENCE);
    assert.deepEqual(await service.read('demo'), { items: [], chars: 0, gen: formatGen(ctx.epoch, 1) });
    clock.advance(PAGE_STATE_WRITE_MIN_MS * 2);
    await service.flush();
    assert.equal(await onDisk(fileOf()), null, 'the dirty keys were never written back');

    // With the new gen the surface saves again.
    await service.patch('demo', cleared.gen, set(['ticked', '1']));
    assert.deepEqual((await service.read('demo')).items, [['ticked', '1']]);
  });

  test('a write that was due when Clear ran does not bring the data back', async (t) => {
    const { service, ctx, clock, fileOf } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    const due = service.patch('demo', gen, set(['a', '2']));
    await until(() => applied(ctx) === 2, 'the second change applied');
    await service.clear('demo');
    await due; // answered by the Clear: what it saved is cleared, not lost
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await service.flush();
    assert.equal(await onDisk(fileOf()), null);
  });

  test('a PATCH started right after a Clear (same tick, old gen) is refused, not applied after it', async (t) => {
    const { service, ctx } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    const [cleared, late] = await Promise.allSettled([service.clear('demo'), service.patch('demo', gen, set(['b', '2']))]);
    assert.equal(cleared.status, 'fulfilled');
    await rejectsWith(late.status === 'rejected' ? Promise.reject(late.reason) : Promise.resolve(late.value), 'stale');
    assert.deepEqual((await service.read('demo')).items, []);
  });

  test('Clear is idempotent: a second one answers ok with the next gen', async (t) => {
    const { service, ctx, fileOf } = await setup(t);
    assert.deepEqual(await service.clear('demo'), { ok: true, gen: formatGen(ctx.epoch, 1) });
    assert.deepEqual(await service.clear('demo'), { ok: true, gen: formatGen(ctx.epoch, 2) });
    assert.equal(await onDisk(fileOf()), null);
    assert.equal(ctx.events.filter((event) => event.kind === 'page-state').length, 2);
  });

  test('the clear counter survives the data cache dropping the entry', async (t) => {
    const { service, ctx, clock } = await setup(t);
    await service.clear('demo');
    await service.read('demo');
    clock.advance(PAGE_STATE_IDLE_MS + 1);
    await service.read('demo');
    await rejectsWith(service.patch('demo', formatGen(ctx.epoch, 0), set(['a', '1'])), 'stale');
  });
});

describe('page-state: memory', () => {
  test('a clean entry is reloaded from disk after 10 idle minutes, kept before that', async (t) => {
    const { service, clock, tmp } = await setup(t);
    await tmp.write('demo/.chamber/page-state.json', JSON.stringify({ v: 1, items: [['a', 'disk 1']] }));
    assert.deepEqual((await service.read('demo')).items, [['a', 'disk 1']]);
    await tmp.write('demo/.chamber/page-state.json', JSON.stringify({ v: 1, items: [['a', 'disk 2']] }));
    clock.advance(PAGE_STATE_IDLE_MS - 1);
    assert.deepEqual((await service.read('demo')).items, [['a', 'disk 1']], 'still cached');
    clock.advance(PAGE_STATE_IDLE_MS);
    assert.deepEqual((await service.read('demo')).items, [['a', 'disk 2']], 'dropped once idle, then reloaded');
  });

  test('over the byte bound, the least recently used clean entry is dropped first; a dirty one never', async (t) => {
    const { service, ctx, clock, tmp } = await setup(t, { cacheMaxBytes: 100 });
    await tmp.writeDesign('other', DESIGN);
    await tmp.write('other/.chamber/page-state.json', JSON.stringify({ v: 1, items: [['k', 'o'.repeat(40)]] }));
    // demo is dirty (its second write is not due on the fake clock) and bigger than the bound on its own.
    await service.patch('demo', formatGen(ctx.epoch, 0), set(['k', 'first']));
    const dirty = service.patch('demo', formatGen(ctx.epoch, 0), set(['k', 'd'.repeat(60)]));
    await until(() => applied(ctx) === 2, 'the big change applied');
    await service.read('other');
    await tmp.write('other/.chamber/page-state.json', JSON.stringify({ v: 1, items: [['k', 'changed on disk']] }));
    await service.read('demo');
    assert.deepEqual((await service.read('other')).items, [['k', 'changed on disk']], 'other was evicted and reloaded');
    assert.equal((await service.read('demo')).items[0]?.[1], 'd'.repeat(60), 'the dirty entry stayed');
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await dirty;
  });
});

describe('page-state: disk failures', () => {
  test('a failed write keeps the memory copy, its PATCH answers the folder sentence, and a resend writes it', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX permissions as a normal user' : false }, async (t) => {
    const { service, ctx, clock, fileOf, dir } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    /** Answer a PATCH whose write is a second away (each attempt counts as the last write). */
    const nextWrite = async (delta: PageStateDelta): Promise<unknown> => {
      const answer = tracked(service.patch('demo', gen, delta));
      await until(() => answer.settled() || clock.pending() > 0, 'the write scheduled');
      clock.advance(PAGE_STATE_WRITE_MIN_MS);
      return answer.promise;
    };
    const chamber = path.join(dir, '.chamber');
    await chmod(chamber, 0o500);
    try {
      await rejectsWith(nextWrite(set(['a', '2'])), 'internal', /not allowed to write/);
      assert.deepEqual(ctx.logs.find((line) => line.event === 'page-state.write-failed')?.fields, { slug: 'demo', code: 'EACCES' });
      assert.deepEqual((await service.read('demo')).items, [['a', '2']], 'the memory copy stays');
      assert.deepEqual(await onDisk(fileOf()), [['a', '1']]);

      // The page resends the same keys: nothing changes in memory, and the answer still waits for
      // a write, which fails again while the folder is read-only.
      await rejectsWith(nextWrite(set(['a', '2'])), 'internal', /not allowed to write/);
    } finally {
      await chmod(chamber, 0o700);
    }
    assert.deepEqual(await nextWrite(set(['a', '2'])), { chars: 2, gen });
    assert.deepEqual(await onDisk(fileOf()), [['a', '2']], 'the resend wrote the memory copy');
    await nextWrite(set(['a', '3']));
    assert.deepEqual(await onDisk(fileOf()), [['a', '3']]);
  });

  test('a write nobody waits for that fails is answered by the next PATCH, which applies nothing and retries', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX permissions as a normal user' : false }, async (t) => {
    const { service, ctx, clock, fileOf, dir } = await setup(t);
    const gen = formatGen(ctx.epoch, 0);
    await service.patch('demo', gen, set(['a', '1']));
    const chamber = path.join(dir, '.chamber');
    await chmod(chamber, 0o500);
    try {
      const pending = service.patch('demo', gen, set(['a', '2']));
      await until(() => applied(ctx) === 2, 'the second change applied');
      clock.advance(PAGE_STATE_WRITE_MIN_MS);
      await rejectsWith(pending, 'internal', /not allowed to write/);
      // Now the memory copy is newer than the file and nobody waits: a flush (shutdown, root
      // change) fails with nobody to tell, so the next PATCH tells.
      await service.flush();
      await rejectsWith(service.patch('demo', gen, set(['a', '3'])), 'internal', /not allowed to write/);
      assert.deepEqual((await service.read('demo')).items, [['a', '2']], 'nothing of the refused PATCH applied');
    } finally {
      await chmod(chamber, 0o700);
    }
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await settled(service);
    assert.deepEqual(await onDisk(fileOf()), [['a', '2']], 'the retry wrote the memory copy');
  });
});

describe('page-state: never logged', () => {
  test('no key, value or file text reaches a log line through any path', async (t) => {
    const { service, ctx, clock, tmp } = await setup(t);
    const SECRET = 'career-plan-SECRET-7f3a';
    await tmp.write('demo/.chamber/page-state.json', `{"v":1,"items":[["${SECRET}","${SECRET}"`);
    await service.read('demo');
    await service.patch('demo', formatGen(ctx.epoch, 0), set([SECRET, SECRET]));
    await service.patch('demo', formatGen(ctx.epoch, 0), set([`${SECRET}-big`, SECRET.repeat(PAGE_STATE_MAX_CHARS / SECRET.length)])).catch(() => undefined);
    await service.clear('demo');
    await service.patch('demo', formatGen(ctx.epoch, 0), set([SECRET, SECRET])).catch(() => undefined);
    await service.patch('demo', formatGen(ctx.epoch, 1), set([SECRET, SECRET]));
    const failing = service.patch('demo', formatGen(ctx.epoch, 1), set([SECRET, `${SECRET}-2`]));
    await until(() => clock.pending() > 0, 'the last write scheduled');
    await rm(tmp.at('demo'), { recursive: true });
    clock.advance(PAGE_STATE_WRITE_MIN_MS);
    await failing.catch(() => undefined);
    await service.flush();

    assert.ok(ctx.logs.length >= 2, 'the unreadable file and the failed write were logged');
    const text = JSON.stringify(ctx.logs);
    assert.equal(text.includes(SECRET), false, text);
    for (const line of ctx.logs) assert.equal(line.fields?.slug, 'demo');
  });
});
