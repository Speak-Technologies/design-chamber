// The page-side saved-page-data controller (Phase 2 technical design §8.4; feature 19), against a
// fake client that applies the service's own pure rules (gen/Clear, the cap) and a fake clock:
// coalescing to ≤1 PATCH/s, the byte-based inline/upload rule, the load timeout, Clear winning over
// dirty keys on both the 409 and the event path, and the cap/notice/retry behaviour.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PageStatePatchBody, PageStateResponse } from '../../src/shared/api.ts';
import type { StorageBatch } from '../../src/guest/bridge/storage-shim.ts';
import { PAGE_STATE_CHANGES_MAX, PAGE_STATE_MAX_CHARS, UPLOAD_TOTAL_MAX } from '../../src/shared/limits.ts';
import { applyPageStateDelta, formatGen, isOlderClear } from '../../src/shared/page-state.ts';
import {
  createPageStateController,
  PAGE_STATE_CAP_SENTENCE,
  PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE,
  PAGE_STATE_UNSAVED_SENTENCE,
  pageStateDiff,
  splitPageStateDelta,
  type PageStateNotice,
} from '../../src/guest/page-state.ts';
import { ServiceError, type ServiceClient } from '../../src/guest/service-client.ts';

const SLUG = 'demo';
const EPOCH = 'testepoch';

// ---- helpers ----

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const fakeClock = (start = 1_000_000) => {
  let at = start;
  const timers: { due: number; run: () => void; cancelled: boolean }[] = [];
  const schedule = (run: () => void, ms: number): (() => void) => {
    const timer = { due: at + ms, run, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return {
    now: () => at,
    schedule,
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

/** A fake service client that applies the same pure rules as the real page-state service. */
const fakePageState = () => {
  const state = { items: new Map<string, string>(), chars: 0, clears: 0 };
  const patches: PageStatePatchBody[] = [];
  const uploads: string[] = [];
  const uploadStore = new Map<string, string>();
  let uploadCounter = 0;
  const gen = (): string => formatGen(EPOCH, state.clears);
  const handlers = {
    get: async (): Promise<PageStateResponse> => ({ items: [...state.items], chars: state.chars, gen: gen() }),
    patch: async (body: PageStatePatchBody) => {
      patches.push(body);
      let bodyGen: string;
      let clear: boolean;
      let changes: [string, string | null][];
      if ('uploadId' in body) {
        const parsed = JSON.parse(uploadStore.get(body.uploadId) ?? '{}') as { gen?: string; clear?: boolean; changes?: [string, string | null][] };
        bodyGen = parsed.gen ?? '';
        clear = parsed.clear === true;
        changes = parsed.changes ?? [];
      } else {
        bodyGen = body.gen;
        clear = body.clear === true;
        changes = body.changes ?? [];
      }
      if (isOlderClear(bodyGen, gen())) throw new ServiceError('stale', 'Saved page data was cleared in another window.');
      const outcome = applyPageStateDelta(state.items, state.chars, { clear, changes }, PAGE_STATE_MAX_CHARS);
      if (!outcome.ok) throw new ServiceError('too-large', PAGE_STATE_CAP_SENTENCE);
      state.chars = outcome.chars;
      return { chars: state.chars, gen: gen() };
    },
    delete: async () => {
      state.clears += 1;
      state.items.clear();
      state.chars = 0;
      return { ok: true as const, gen: gen() };
    },
  };
  const call = async (key: string, ...args: unknown[]): Promise<unknown> => {
    const request = (args[0] ?? {}) as { body?: PageStatePatchBody };
    if (key === 'GET /designs/:slug/page-state') return handlers.get();
    if (key === 'PATCH /designs/:slug/page-state') return handlers.patch(request.body as PageStatePatchBody);
    if (key === 'DELETE /designs/:slug/page-state') return handlers.delete();
    throw new Error(`unexpected route ${key}`);
  };
  const upload = async (text: string): Promise<string> => {
    uploads.push(text);
    uploadCounter += 1;
    const id = `u_fake${String(uploadCounter).padStart(8, '0')}`;
    uploadStore.set(id, text);
    return id;
  };
  const client = {
    call,
    upload,
    loadRender: async () => {
      throw new Error('unused');
    },
    thumbnail: async () => {
      throw new Error('unused');
    },
  } as unknown as ServiceClient;
  return { client, state, patches, uploads, handlers, gen };
};

type Rig = {
  controller: ReturnType<typeof createPageStateController>;
  fake: ReturnType<typeof fakePageState>;
  clock: ReturnType<typeof fakeClock>;
  notices: PageStateNotice[];
  synced: { batch: StorageBatch; except: string | null }[];
  reloads: number;
};

const rig = (options: { loadTimeoutMs?: number } = {}): Rig => {
  const fake = fakePageState();
  const clock = fakeClock();
  const notices: PageStateNotice[] = [];
  const synced: { batch: StorageBatch; except: string | null }[] = [];
  let reloads = 0;
  const controller = createPageStateController({
    client: fake.client,
    slug: SLUG,
    onNotice: (notice) => notices.push(notice),
    syncFrames: (batch, except) => synced.push({ batch, except }),
    reloadFrames: () => {
      reloads += 1;
    },
    now: clock.now,
    schedule: clock.schedule,
    visibility: null,
    ...options,
  });
  return {
    controller,
    fake,
    clock,
    notices,
    synced,
    get reloads() {
      return reloads;
    },
  };
};

const batch = (changes: [string, string | null][], clear = false): StorageBatch => ({ clear, changes });
const noticeKinds = (notices: PageStateNotice[]): string[] => notices.map((notice) => notice.kind);

// ---- load ----

test('load: a successful read seeds the map and gen; init hands every frame persist + items', async () => {
  const r = rig();
  r.fake.state.items.set('theme', 'dark');
  r.fake.state.chars = 9;
  await r.controller.load();
  assert.equal(r.controller.persisting(), true);
  assert.equal(r.controller.chars(), 9);
  assert.deepEqual(r.controller.init(), { persist: true, items: [['theme', 'dark']] });
  assert.deepEqual(noticeKinds(r.notices), []);
});

test('load: a failure runs the view empty and unsaved, with the notice once', async () => {
  const r = rig();
  r.fake.handlers.get = async () => {
    throw new ServiceError('NO_SERVICE', 'down');
  };
  await r.controller.load();
  assert.equal(r.controller.persisting(), false);
  assert.deepEqual(r.controller.init(), { persist: false, items: [] });
  assert.deepEqual(noticeKinds(r.notices), ['unsaved']);
  assert.equal(r.notices[0]?.message, PAGE_STATE_UNSAVED_SENTENCE);
});

test('load: the 2 s timeout is a failure; a late answer is ignored for this view', async () => {
  const r = rig();
  const getGate: { resolve: (answer: PageStateResponse) => void } = { resolve: () => undefined };
  r.fake.handlers.get = () => new Promise<PageStateResponse>((resolve) => (getGate.resolve = resolve));
  const loading = r.controller.load();
  r.clock.advance(1999);
  await tick();
  assert.equal(r.controller.persisting(), false, 'not yet timed out, but not answered either');
  r.clock.advance(1);
  await loading;
  assert.equal(r.controller.persisting(), false, 'the timeout made it unsaved');
  assert.deepEqual(noticeKinds(r.notices), ['unsaved']);
  // The answer arrives after the timeout: it must not switch the running frames to saved.
  getGate.resolve({ items: [['late', 'value']], chars: 9, gen: r.fake.gen() });
  await tick();
  assert.equal(r.controller.persisting(), false);
  assert.deepEqual(r.controller.init(), { persist: false, items: [] });
});

// ---- apply + coalescing ----

test('apply: updates the map, forwards to the other frames, and coalesces to ≤1 PATCH/s', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.apply('home@laptop', batch([['a', '1']]));
  assert.deepEqual(r.controller.init().items, [['a', '1']]);
  assert.deepEqual(r.synced, [{ batch: { clear: false, changes: [['a', '1']] }, except: 'home@laptop' }]);

  r.clock.advance(0); // the first flush is due at once
  await tick();
  assert.equal(r.fake.patches.length, 1);

  r.controller.apply('home@laptop', batch([['b', '2']])); // a second write within the same second
  r.clock.advance(999);
  await tick();
  assert.equal(r.fake.patches.length, 1, 'still coalescing');
  r.clock.advance(1);
  await tick();
  assert.equal(r.fake.patches.length, 2, 'flushed once the second passed');
  assert.deepEqual(r.fake.state.items, new Map([['a', '1'], ['b', '2']]));
});

test('apply: a clear() from a frame empties the map and rides the next PATCH as clear', async () => {
  const r = rig();
  r.fake.state.items.set('old', 'x');
  r.fake.state.chars = 4;
  await r.controller.load();
  r.controller.apply('home@laptop', batch([['new', 'y']], true));
  assert.deepEqual(r.controller.init().items, [['new', 'y']]);
  r.clock.advance(0);
  await tick();
  const body = r.fake.patches[0];
  assert.ok(body && !('uploadId' in body));
  assert.equal(body.clear, true);
  assert.deepEqual(r.fake.state.items, new Map([['new', 'y']]));
});

test('apply: over the cap drops only the offending change, earlier data untouched, notice once', async () => {
  const r = rig();
  await r.controller.load();
  const big = 'x'.repeat(PAGE_STATE_MAX_CHARS - 3); // key 'big' (3) + value fills the cap exactly
  r.controller.apply('home@laptop', batch([['big', big]]));
  r.controller.apply('home@laptop', batch([['too', 'much']])); // would exceed the cap
  assert.deepEqual(noticeKinds(r.notices), ['cap']);
  assert.equal(r.notices[0]?.message, PAGE_STATE_CAP_SENTENCE);
  assert.deepEqual(r.controller.init().items, [['big', big]]);
  // The dropped change is not forwarded: only the first (accepted) batch was synced.
  assert.equal(r.synced.length, 1);
  assert.deepEqual(r.synced[0]?.batch.changes, [['big', big]]);
  r.clock.advance(0);
  await tick();
  assert.deepEqual(r.fake.state.items, new Map([['big', big]]));
});

// ---- inline vs upload (the byte rule) ----

test('flush: an ASCII delta goes inline, a same-length CJK or emoji delta goes by upload', async () => {
  const r = rig();
  await r.controller.load();
  const ascii = 'a'.repeat(40_000);
  const cjk = '漢'.repeat(40_000);
  const emoji = '😀'.repeat(20_000);

  r.controller.apply('b', batch([['ascii', ascii]]));
  await r.controller.flush();
  assert.equal(r.fake.uploads.length, 0, 'ASCII inline');
  assert.ok(r.fake.patches[0] && !('uploadId' in r.fake.patches[0]));

  r.controller.apply('b', batch([['cjk', cjk]]));
  await r.controller.flush();
  assert.equal(r.fake.uploads.length, 1, 'CJK uploaded');
  assert.ok(r.fake.patches[1] && 'uploadId' in r.fake.patches[1]);

  r.controller.apply('b', batch([['emoji', emoji]]));
  await r.controller.flush();
  assert.equal(r.fake.uploads.length, 2, 'emoji uploaded');
  assert.ok(r.fake.patches[2] && 'uploadId' in r.fake.patches[2]);

  assert.deepEqual(r.fake.state.items, new Map([['ascii', ascii], ['cjk', cjk], ['emoji', emoji]]));
  assert.deepEqual(noticeKinds(r.notices), [], 'nothing was refused');
});

test('flush: a delta over the char budget is uploaded even when ASCII', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.apply('b', batch([['k', 'a'.repeat(60_001)]]));
  await r.controller.flush();
  assert.equal(r.fake.uploads.length, 1);
  assert.deepEqual(r.fake.state.items.get('k'), 'a'.repeat(60_001));
});

// ---- failure and retry ----

test('flush: a failed PATCH keeps the changes dirty and retries; after 3 failures the notice shows once', async () => {
  const r = rig();
  await r.controller.load();
  let fail = true;
  const realPatch = r.fake.handlers.patch;
  r.fake.handlers.patch = async (body) => {
    if (fail) throw new ServiceError('NO_SERVICE', 'down');
    return realPatch(body);
  };
  r.controller.apply('b', batch([['a', '1']]));
  for (let n = 0; n < 3; n += 1) {
    r.clock.advance(1000);
    await tick();
  }
  assert.deepEqual(noticeKinds(r.notices), ['unsaved'], 'notice once after the third failure');
  assert.equal(r.fake.state.items.size, 0, 'nothing saved yet');
  fail = false;
  r.clock.advance(1000);
  await tick();
  assert.deepEqual(r.fake.state.items, new Map([['a', '1']]), 'the retry landed');
  assert.deepEqual(noticeKinds(r.notices), ['unsaved'], 'still just the one notice');
});

test('flush: a too-large refusal drops the changes, shows the cap notice, and is not retried', async () => {
  const r = rig();
  await r.controller.load();
  let calls = 0;
  r.fake.handlers.patch = async () => {
    calls += 1;
    throw new ServiceError('too-large', PAGE_STATE_CAP_SENTENCE);
  };
  r.controller.apply('b', batch([['a', '1']]));
  r.clock.advance(0);
  await tick();
  assert.deepEqual(noticeKinds(r.notices), ['cap']);
  assert.equal(calls, 1);
  r.clock.advance(5000);
  await tick();
  assert.equal(calls, 1, 'a permanent refusal is not retried');
});

// ---- Clear elsewhere wins (no resurrection) ----

test('a 409 on PATCH drops every dirty key, refetches empty and reloads the frames', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.apply('b', batch([['mine', 'dirty']])); // dirty, not yet flushed
  // Another surface clears: the gen moves ahead.
  r.fake.state.clears += 1;
  r.fake.state.items.clear();
  r.fake.state.chars = 0;
  r.clock.advance(0);
  await tick();
  assert.deepEqual(r.fake.state.items, new Map(), 'the dirty key was not written back');
  assert.equal(r.reloads, 1, 'the frames reloaded with the fetched data');
  assert.deepEqual(noticeKinds(r.notices), ['cleared-elsewhere']);
  assert.equal(r.notices[0]?.message, PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE);
  assert.deepEqual(r.controller.init().items, []);
  // A later write uses the new gen and is accepted (no lingering stale gen).
  r.controller.apply('b', batch([['after', 'ok']]));
  await r.controller.flush();
  assert.deepEqual(r.fake.state.items, new Map([['after', 'ok']]));
});

test('a page-state event with a newer Clear drops dirty keys and reloads (the event path)', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.apply('b', batch([['first', '1']]));
  r.clock.advance(0); // flush the first key so the next flush is a second away
  await tick();
  r.controller.apply('b', batch([['mine', 'dirty']])); // dirty; its flush is due in 1 s
  // Another surface clears and the change feed tells us before that flush is due.
  r.fake.state.clears += 1;
  r.fake.state.items.clear();
  r.fake.state.chars = 0;
  r.controller.applyChanges({ reset: false, epoch: EPOCH, seq: 1, events: [{ seq: 1, slug: SLUG, kind: 'page-state' }] });
  r.clock.advance(500); // the refetch debounce fires; the flush (1 s) is not due yet
  await tick();
  assert.equal(r.reloads, 1);
  assert.deepEqual(noticeKinds(r.notices), ['cleared-elsewhere']);
  assert.deepEqual(r.controller.init().items, []);
  // A later write must not resurrect the dropped dirty key.
  r.controller.apply('b', batch([['after', 'ok']]));
  await r.controller.flush();
  assert.deepEqual(r.fake.state.items, new Map([['after', 'ok']]));
});

test('a page-state event without a Clear syncs the difference, except keys still dirty here', async () => {
  const r = rig();
  r.fake.state.items.set('shared', 'one');
  r.fake.state.chars = 9;
  await r.controller.load();
  r.controller.apply('b', batch([['mine', 'dirty']])); // dirty here
  // Another surface writes a different key.
  r.fake.state.items.set('shared', 'two');
  r.fake.state.items.set('other', 'new');
  r.fake.state.chars = 'sharedtwoothernew'.length;
  r.controller.applyChanges({ reset: false, epoch: EPOCH, seq: 2, events: [{ seq: 2, slug: SLUG, kind: 'page-state' }] });
  r.clock.advance(500);
  await tick();
  assert.equal(r.reloads, 0, 'no reload for a plain write');
  const sync = r.synced.at(-1);
  assert.deepEqual(sync?.batch.changes, [['shared', 'two'], ['other', 'new']]);
  assert.equal(sync?.except, null);
  // Our dirty key keeps its local value.
  assert.equal(r.controller.init().items.find(([key]) => key === 'mine')?.[1], 'dirty');
});

// ---- clear (this surface) ----

test('clear: drops dirty keys, DELETEs, adopts the new gen and reloads empty; nothing comes back', async () => {
  const r = rig();
  r.fake.state.items.set('old', 'x');
  r.fake.state.chars = 4;
  await r.controller.load();
  r.controller.apply('b', batch([['pending', 'y']])); // dirty, a flush is scheduled
  const answer = await r.controller.clear();
  assert.equal(answer.ok, true);
  assert.equal(r.reloads, 1);
  assert.deepEqual(r.controller.init().items, []);
  assert.equal(r.controller.chars(), 0);
  // The cancelled flush must not write the dropped key back.
  r.clock.advance(5000);
  await tick();
  assert.deepEqual(r.fake.state.items, new Map());
  assert.equal(r.fake.patches.length, 0, 'no PATCH went out for the dropped keys');
});

test('clear: waits for an in-flight PATCH, then DELETEs; the cleared keys never return', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.apply('b', batch([['inflight', 'x']]));
  r.clock.advance(0); // start the flush (in flight)
  const clearing = r.controller.clear();
  await tick();
  await clearing;
  assert.deepEqual(r.fake.state.items, new Map());
  r.clock.advance(5000);
  await tick();
  assert.deepEqual(r.fake.state.items, new Map(), 'no resurrection after the in-flight write');
});

// ---- lifecycle ----

test('dispose flushes the pending changes', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.apply('b', batch([['last', 'write']]));
  await r.controller.dispose();
  assert.deepEqual(r.fake.state.items, new Map([['last', 'write']]));
});

// ---- the pure helpers ----

test('splitPageStateDelta: clear rides only the first; oversized single values are dropped', () => {
  const many: [string, string | null][] = Array.from({ length: PAGE_STATE_CHANGES_MAX + 5 }, (_, n) => [`k${n}`, 'v']);
  const { deltas, dropped } = splitPageStateDelta('e:0', true, many);
  assert.equal(deltas.length, 2);
  assert.equal(deltas[0]?.clear, true);
  assert.equal(deltas[1]?.clear, false);
  assert.equal(deltas[0]?.changes.length, PAGE_STATE_CHANGES_MAX);
  assert.equal(deltas[1]?.changes.length, 5);
  assert.deepEqual(dropped, []);

  // A single value too large for one upload is refused like the cap.
  const huge = 'x'.repeat(UPLOAD_TOTAL_MAX);
  const split = splitPageStateDelta('e:0', false, [['huge', huge], ['ok', '1']]);
  assert.deepEqual(split.dropped, [['huge', huge]]);
  assert.deepEqual(split.deltas, [{ clear: false, changes: [['ok', '1']] }]);

  // Nothing to flush.
  assert.deepEqual(splitPageStateDelta('e:0', false, []), { deltas: [], dropped: [] });
  assert.deepEqual(splitPageStateDelta('e:0', true, []), { deltas: [{ clear: true, changes: [] }], dropped: [] });
});

test('pageStateDiff: adds, updates and removals, skipping dirty keys', () => {
  const before = new Map([['a', '1'], ['b', '2'], ['gone', 'x']]);
  const after = new Map([['a', '1'], ['b', '9'], ['new', 'n']]);
  const dirty = new Map<string, string | null>([['new', 'mine']]);
  assert.deepEqual(pageStateDiff(before, after, dirty), [['b', '9'], ['gone', null]]);
});
