import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';

import { createChangeFeed, nextBackoff, type ChangeBatch, type VisibilitySource } from '../../src/guest/changes.ts';
import { createFakeService, fakeHash } from '../../src/guest/fake-services.ts';
import { createServiceClient, isServiceError, type ServiceClient } from '../../src/guest/service-client.ts';
import { createSourceCache } from '../../src/guest/source-cache.ts';
import { affectedSources, createStore, renderSourceKey, type Store } from '../../src/guest/store.ts';
import type { ChangesResponse, EditRequest, SourceResponse } from '../../src/shared/api.ts';
import { HAND_EDITS_LEDGER_MAX } from '../../src/shared/limits.ts';
import type { ChangeEvent, ChangeKind } from '../../src/shared/types.ts';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (check: () => boolean, label: string): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${label}`);
};

const scripted = (answers: (GuestRequestResult | Error)[]) => {
  const requests: GuestRequest[] = [];
  let release: (() => void) | null = null;
  const client = createServiceClient({
    serviceRequest: async (request) => {
      requests.push(request);
      const next = answers.shift();
      if (next === undefined) {
        // Park like a long-poll until the test stops the feed.
        await new Promise<void>((resolve) => (release = resolve));
        return { status: 200, body: JSON.stringify({ epoch: 'e', seq: 0, reset: false, events: [] }) };
      }
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { requests, client, release: () => release?.() };
};

const changes = (body: ChangesResponse): GuestRequestResult => ({ status: 200, body: JSON.stringify(body) });

test('change feed: first call since=0 epoch="" wait=15000, then follows seq/epoch; empty batches are not emitted', async () => {
  const { requests, client, release } = scripted([
    changes({ epoch: 'e1', seq: 4, reset: true, events: [] }),
    changes({ epoch: 'e1', seq: 4, reset: false, events: [] }),
    changes({ epoch: 'e1', seq: 6, reset: false, events: [{ seq: 5, slug: 'a', kind: 'files', files: ['screens/home.html'] }, { seq: 6, slug: 'a', kind: 'thumb' }] }),
  ]);
  const feed = createChangeFeed(client, { visibility: null });
  const batches: ChangeBatch[] = [];
  feed.subscribe((batch) => batches.push(batch));
  feed.start();
  await until(() => requests.length === 4, '4 requests');
  assert.deepEqual(
    requests.map((request) => request.query),
    [
      { since: '0', epoch: '', wait: '15000' },
      { since: '4', epoch: 'e1', wait: '15000' },
      { since: '4', epoch: 'e1', wait: '15000' },
      { since: '6', epoch: 'e1', wait: '15000' },
    ],
  );
  assert.deepEqual(batches.map((batch) => [batch.reset, batch.events.length]), [[true, 0], [false, 2]]);
  assert.equal(feed.status().state, 'live');
  feed.stop();
  release();
  await tick();
  assert.equal(requests.length, 4, 'no request after stop');
  assert.equal(feed.status().state, 'stopped');
});

test('change feed: backoff 1 → 2 → 4 → 8 → 10 s on errors, reset after a success', async () => {
  const failure = { status: 500, body: JSON.stringify({ error: 'internal', message: 'Down.' }) };
  const { client, release } = scripted([failure, failure, failure, failure, failure, failure, changes({ epoch: 'e', seq: 1, reset: true, events: [] }), failure]);
  const sleeps: number[] = [];
  const feed = createChangeFeed(client, { visibility: null, sleep: async (ms) => void sleeps.push(ms) });
  const statuses: string[] = [];
  feed.onStatus((status) => statuses.push(`${status.state}${status.retryInMs ?? ''}`));
  feed.start();
  await until(() => sleeps.length === 7, '7 sleeps');
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 10000, 10000, 1000]);
  assert.ok(statuses.includes('retrying1000') && statuses.includes('live'));
  assert.equal(nextBackoff(10_000), 10_000);
  feed.stop();
  release();
});

test('change feed: pauses while hidden and resumes when visible', async () => {
  let hidden = true;
  let notify: () => void = () => undefined;
  const visibility: VisibilitySource = { hidden: () => hidden, onChange: (listener) => ((notify = listener), () => undefined) };
  const { requests, client, release } = scripted([]);
  const feed = createChangeFeed(client, { visibility });
  feed.start();
  await tick();
  assert.equal(requests.length, 0);
  assert.equal(feed.status().state, 'paused');
  hidden = false;
  notify();
  await until(() => requests.length === 1, 'request after visible');
  feed.stop();
  release();
});

test('affectedSources: screen file → its screen, design.json → none, shared files → all', () => {
  const canvas = { kind: 'canvas' as const, screens: [{ id: 'home', title: 'Home', file: 'screens/home.html' }, { id: 'pricing', title: 'Pricing', file: 'screens/pricing.html' }] };
  assert.deepEqual(affectedSources(canvas, ['screens/home.html']), ['home']);
  assert.deepEqual(affectedSources(canvas, ['screens/home.html', 'screens/pricing.html', 'design.json']), ['home', 'pricing']);
  assert.deepEqual(affectedSources(canvas, ['design.json']), []);
  for (const shared of ['tokens.css', 'assets/logo.svg', 'DESIGN.md', 'screens/unknown.html']) assert.equal(affectedSources(canvas, [shared]), 'all', shared);
  assert.equal(affectedSources({ kind: 'page', screens: [] }, ['index.html']), 'all');
});

test('store: list, open, live refresh of only the affected artboards, comments and versions', async () => {
  const service = createFakeService();
  const client = createServiceClient({ serviceRequest: (request) => service.handle(request) });
  const store = createStore({ client });
  const statuses: string[] = [];
  store.subscribe((state, previous) => {
    if (state.designs.status !== previous.designs.status) statuses.push(state.designs.status);
  });

  await store.refreshDesigns();
  assert.deepEqual(statuses, ['loading', 'ready']);
  assert.deepEqual(store.getState().designs.data?.designs.map((d) => [d.slug, d.pending]).sort(), [
    ['coffee-subscription', false],
    ['launch-announcement', false],
    ['onboarding-flow', true],
  ]);

  await store.openDesign('coffee-subscription');
  assert.equal(store.getState().open?.status, 'ready');
  assert.equal(store.getState().open?.data?.design.screens.length, 2);

  // The agent edits one screen: only that row's artboards reload.
  await store.applyChanges({ reset: false, epoch: 'e', seq: 1, events: [{ seq: 1, slug: 'coffee-subscription', kind: 'files', files: ['screens/pricing.html'] }] });
  assert.deepEqual(store.getState().renderRevs, { [renderSourceKey('coffee-subscription', 'pricing')]: 1 });
  // tokens.css → every screen.
  await store.applyChanges({ reset: false, epoch: 'e', seq: 2, events: [{ seq: 2, slug: 'coffee-subscription', kind: 'files', files: ['tokens.css'] }] });
  assert.deepEqual(store.getState().renderRevs, { 'coffee-subscription|pricing': 2, 'coffee-subscription|home': 1 });

  const comment = await store.addComment('coffee-subscription', {
    screen: 'home',
    viewport: 'laptop',
    anchor: { selector: 'h1', text: 'x', html: '<h1>', rect: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0.5, y: 0.5 } },
    body: 'Bigger',
  });
  assert.ok(store.getState().open?.data?.design.comments.some((c) => c.id === comment.id));
  await store.updateComment('coffee-subscription', comment.id, { status: 'resolved' });
  assert.equal(store.getState().open?.data?.design.comments.find((c) => c.id === comment.id)?.status, 'resolved');
  await store.deleteComment('coffee-subscription', comment.id);
  assert.ok(!store.getState().open?.data?.design.comments.some((c) => c.id === comment.id));

  await store.loadVersions('coffee-subscription');
  const count = store.getState().versions?.data?.versions.length ?? 0;
  await store.snapshotVersion('coffee-subscription', 'Before pricing rework');
  await until(() => (store.getState().versions?.data?.versions.length ?? 0) === count + 1, 'versions reload');

  await store.renameDesign('coffee-subscription', 'Coffee club');
  assert.equal(store.getState().open?.data?.design.title, 'Coffee club');
  assert.equal(store.getState().designs.data?.designs.find((d) => d.slug === 'coffee-subscription')?.title, 'Coffee club');
});

test('store: an `added` event for the open design reloads every artboard of its fresh detail', async () => {
  const service = createFakeService();
  const client = createServiceClient({ serviceRequest: (request) => service.handle(request) });
  const store = createStore({ client });
  await store.openDesign('coffee-subscription');
  const screens = store.getState().open?.data?.design.screens.map((screen) => screen.id) ?? [];
  assert.ok(screens.length > 0);
  // The agent wrote the files within the service's coalescing window: only `added` arrives.
  await store.applyChanges({ reset: false, epoch: 'e', seq: 1, events: [{ seq: 1, slug: 'coffee-subscription', kind: 'added' }] });
  assert.deepEqual(store.getState().renderRevs, Object.fromEntries(screens.map((id) => [renderSourceKey('coffee-subscription', id), 1])));
  // `added` for another design only refreshes the list.
  await store.applyChanges({ reset: false, epoch: 'e', seq: 2, events: [{ seq: 2, slug: 'launch-announcement', kind: 'added' }] });
  assert.equal(Object.keys(store.getState().renderRevs).length, screens.length);
});

test('store: a `loose` event refetches the list exactly once, and nothing else', async () => {
  const service = createFakeService();
  const client = createServiceClient({ serviceRequest: (request) => service.handle(request) });
  const store = createStore({ client });
  await store.openDesign('coffee-subscription');
  const before = service.requests.length;
  await store.applyChanges({
    reset: false,
    epoch: 'e',
    seq: 2,
    events: [
      { seq: 1, slug: null, kind: 'loose' },
      { seq: 2, slug: null, kind: 'loose' },
    ],
  });
  const paths = service.requests.slice(before).map((request) => `${request.method} ${request.path}`);
  assert.deepEqual(paths, ['GET /designs']);
  assert.deepEqual(store.getState().renderRevs, {}, 'no artboard reloads');
  assert.equal(store.getState().designs.status, 'ready');
});

test('store: errors land in state with the service sentence; mutations reject with it; reset refetches', async () => {
  const service = createFakeService();
  const client = createServiceClient({ serviceRequest: (request) => service.handle(request) });
  const store = createStore({ client });
  await store.openDesign('does-not-exist');
  const open = store.getState().open;
  assert.equal(open?.status, 'error');
  assert.equal(open?.error?.code, 'not-found');
  assert.match(open?.error?.message ?? '', /no longer exists/);
  await assert.rejects(store.renameDesign('does-not-exist', 'x'), /no longer exists/);

  await store.checkHealth();
  assert.equal(store.getState().service.state, 'ready');

  await store.openDesign('launch-announcement');
  const before = service.requests.length;
  await store.applyChanges({ reset: true, epoch: 'e2', seq: 0, events: [] });
  const paths = service.requests.slice(before).map((request) => `${request.method} ${request.path}`).sort();
  assert.deepEqual(paths, ['GET /designs', 'GET /designs/launch-announcement', 'GET /settings']);
  assert.equal(store.getState().renderRevs['launch-announcement|'], 1);

  await store.deleteDesign('launch-announcement');
  assert.equal(store.getState().open, null);
  assert.ok(!store.getState().designs.data?.designs.some((d) => d.slug === 'launch-announcement'));
});

// ---- Phase 2 T11a: hand edits through the store, the user events, and the source cache ----

const COFFEE = 'coffee-subscription';
const HERO = 'Fresh roasts, every other Monday';
const TARGET = { tag: 'h1', id: null, text: HERO, sameIndex: 0, sameCount: 1 };

const fakeRig = (): { service: ReturnType<typeof createFakeService>; client: ServiceClient } => {
  const service = createFakeService();
  const client = createServiceClient({ serviceRequest: (request) => service.handle(request) });
  return { service, client };
};

const textEditBody = (base: string, before: string, after: string, screen: string | null = 'home'): EditRequest => ({
  op: 'text',
  screen,
  base,
  target: { ...TARGET, text: before },
  before,
  after,
});

/** The events the fake emitted, read back through GET /changes (the first call answers the epoch). */
const emittedEvents = async (client: ServiceClient): Promise<ChangeEvent[]> => {
  const first = await client.call('GET /changes', { query: { since: '0', epoch: '', wait: '0' } });
  const answer = await client.call('GET /changes', { query: { since: '0', epoch: first.epoch, wait: '0' } });
  return answer.events;
};

test('store: applyEdit bumps nothing itself; the user events reload both surfaces (E8)', async () => {
  const { service, client } = fakeRig();
  const page = createStore({ client });
  const rail = createStore({ client });
  await page.openDesign(COFFEE);
  await rail.openDesign(COFFEE);
  const key = renderSourceKey(COFFEE, 'home');
  const other = renderSourceKey(COFFEE, 'pricing');

  // A change-feed cursor, so each batch carries only the events since the last read.
  let cursor = { seq: 0, epoch: '' };
  const nextBatch = async (): Promise<ChangeBatch> => {
    const answer = await client.call('GET /changes', { query: { since: String(cursor.seq), epoch: cursor.epoch, wait: '0' } });
    cursor = { seq: answer.seq, epoch: answer.epoch };
    return { reset: answer.reset, epoch: answer.epoch, seq: answer.seq, events: answer.events };
  };
  await nextBatch(); // the first call answers the epoch (reset), no events yet

  // Without a feed the mutation bumps nothing: the service's user events drive the reloads.
  const source = await page.loadSource(COFFEE, 'home');
  const answer = await page.applyEdit(COFFEE, textEditBody(source.sha256, HERO, 'Fresh roasts, every Monday'));
  assert.equal(answer.edit.label, 'Text updated in Home');
  assert.equal(answer.edit.undoable, true);
  assert.ok(answer.stamps.file);
  assert.equal(answer.version?.reason, 'user-edit');
  assert.deepEqual(page.getState().renderRevs, {}, 'the mutation bumps nothing itself');
  assert.deepEqual(rail.getState().renderRevs, {});

  // The user events the service emitted reload only the edited screen, on both the page and the rail.
  const batch = await nextBatch();
  assert.ok(batch.events.some((event) => event.kind === 'files' && event.origin === 'user'), 'the edit emitted a user event');
  await page.applyChanges(batch);
  await rail.applyChanges(batch);
  assert.equal(page.getState().renderRevs[key], 1, 'the page reloaded home');
  assert.equal(rail.getState().renderRevs[key], 1, 'the rail reloaded home');
  assert.equal(page.getState().renderRevs[other] ?? 0, 0, 'the other screen did not reload');
  assert.match((await page.loadSource(COFFEE, 'home')).text, /Fresh roasts, every Monday/);

  // Undo: the bytes come back and the artboards reload again.
  const undone = await page.undoEdit(COFFEE, answer.edit.id);
  assert.deepEqual(undone.files, ['screens/home.html']);
  const undoBatch = await nextBatch();
  await page.applyChanges(undoBatch);
  await rail.applyChanges(undoBatch);
  assert.equal(page.getState().renderRevs[key], 2, 'the undo reloaded too');
  assert.equal(rail.getState().renderRevs[key], 2);
  assert.equal((await page.loadSource(COFFEE, 'home')).text, source.text, 'the bytes are back');

  const tokens = await page.loadTokens(COFFEE);
  assert.equal(tokens.exists, false);
  assert.deepEqual(tokens.knobs, []);
  await page.clearHandEdits(COFFEE, 999);
  await assert.rejects(page.undoEdit(COFFEE, answer.edit.id), /can't be undone any more/);
  assert.ok(service.requests.length > 0);
});

test('store: edit refusals reach the caller as ServiceError with the service sentence', async () => {
  const { service, client } = fakeRig();
  const store = createStore({ client });
  const source = await store.loadSource(COFFEE, 'home');
  // The agent rewrote the file: the stamp moved.
  service.writeFile(COFFEE, 'screens/home.html', '<html><body>rewritten</body></html>');
  await assert.rejects(store.applyEdit(COFFEE, textEditBody(source.sha256, HERO, 'x')), (error: unknown) => {
    assert.ok(isServiceError(error, 'stale'));
    assert.equal(error.message, 'This file changed while you were editing. Nothing was saved.');
    return true;
  });
  // Text that is not in the file: refused before any write.
  const fresh = await store.loadSource(COFFEE, 'home');
  await assert.rejects(store.applyEdit(COFFEE, textEditBody(fresh.sha256, 'not in the file', 'x')), /couldn't find this text/);
  // A design that is gone: the edit routes' own sentence.
  await assert.rejects(store.applyEdit('does-not-exist', textEditBody(fresh.sha256, HERO, 'x', null)), (error: unknown) => {
    assert.ok(isServiceError(error, 'not-found'));
    assert.match(error.message, /no longer in your Designs folder/);
    return true;
  });
  await assert.rejects(store.loadTokens('does-not-exist'), /no longer in your Designs folder/);
  await assert.rejects(store.clearHandEdits('does-not-exist', 1), /no longer in your Designs folder/);
});

// ---- the source cache (§3.5) ----

const sourceAnswer = (text: string): SourceResponse => ({ text, bytes: text.length, sha256: fakeHash(text), utf8: true, link: false });

const cacheRig = (options: { maxEntries?: number } = {}) => {
  const calls: string[] = [];
  let gate: (() => void) | null = null;
  let armed = false;
  let version = 1;
  let failNext = false;
  const cache = createSourceCache({
    load: async (slug, screen) => {
      calls.push(`${slug}|${screen ?? ''}`);
      // Capture the version at call time: an in-flight fetch reads the bytes it started with.
      const v = version;
      if (armed) {
        armed = false;
        await new Promise<void>((resolve) => {
          gate = resolve;
        });
      }
      if (failNext) {
        failNext = false;
        throw new Error('service down');
      }
      return sourceAnswer(`v${v} ${slug} ${screen ?? 'page'}`);
    },
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  });
  return {
    cache,
    calls,
    bump: () => {
      version += 1;
    },
    failNext: () => {
      failNext = true;
    },
    /** Hold the next load in flight until `release()`. */
    holdNext: () => {
      armed = true;
    },
    release: () => {
      gate?.();
      gate = null;
    },
  };
};

const batchOfEvents = (events: ChangeEvent[]): ChangeBatch => ({ reset: false, epoch: 'e', seq: events.length, events });
const ev = (seq: number, slug: string | null, kind: ChangeKind, files?: string[]): ChangeEvent => ({ seq, slug, kind, ...(files ? { files } : {}) });

test('source cache: one fetch per selection burst; at most 4 entries, least recently used evicted', async () => {
  const r = cacheRig();
  const first = await r.cache.get('x', 'home');
  const second = await r.cache.get('x', 'home');
  assert.equal(first, second, 'the same answer object');
  assert.deepEqual(r.calls, ['x|home']);
  await r.cache.get('x', 'pricing');
  await r.cache.get('x', 'checkout');
  await r.cache.get('x', 'faq');
  await r.cache.get('x', 'home'); // a hit refreshes recency
  await r.cache.get('x', 'blog'); // the fifth entry evicts pricing, not home
  assert.deepEqual(r.calls, ['x|home', 'x|pricing', 'x|checkout', 'x|faq', 'x|blog']);
  await r.cache.get('x', 'pricing');
  assert.equal(r.calls.length, 6, 'the evicted entry is fetched again');
  await r.cache.get('x', 'home');
  assert.equal(r.calls.length, 6, 'home stayed cached');
  // A smaller cap for a tighter view.
  const small = cacheRig({ maxEntries: 1 });
  await small.cache.get('x', 'home');
  await small.cache.get('x', 'pricing');
  await small.cache.get('x', 'home');
  assert.deepEqual(small.calls, ['x|home', 'x|pricing', 'x|home']);
});

test('source cache: a files event drops only the entries whose file it names; other kinds drop nothing', async () => {
  const r = cacheRig();
  await r.cache.get('x', 'home');
  await r.cache.get('x', 'pricing');
  await r.cache.get('y', null);
  const calls = r.calls.length;
  r.cache.applyChanges(batchOfEvents([ev(1, 'y', 'files', ['screens/home.html'])])); // another design
  r.cache.applyChanges(batchOfEvents([ev(2, 'x', 'files', ['tokens.css', 'assets/a.png', 'DESIGN.md'])])); // the HTML source is unchanged
  r.cache.applyChanges(batchOfEvents([ev(3, 'x', 'comments'), ev(4, 'x', 'versions'), ev(5, 'x', 'thumb'), ev(6, 'x', 'page-state'), ev(7, null, 'loose')]));
  await r.cache.get('x', 'home');
  await r.cache.get('x', 'pricing');
  await r.cache.get('y', null);
  assert.equal(r.calls.length, calls, 'everything stayed cached');
  // The named screen file: only that entry. A page entry is index.html.
  r.cache.applyChanges(batchOfEvents([ev(8, 'x', 'files', ['screens/home.html']), ev(9, 'y', 'files', ['index.html'])]));
  await r.cache.get('x', 'home');
  await r.cache.get('x', 'pricing');
  await r.cache.get('y', null);
  assert.deepEqual(r.calls.slice(calls), ['x|home', 'y|'], 'pricing untouched');
});

test('source cache: a restore, design, added and removed drop the design; root, reset and clear drop all', async () => {
  const r = cacheRig();
  const seed = async () => {
    await r.cache.get('x', 'home');
    await r.cache.get('x', 'pricing');
    await r.cache.get('y', null);
  };
  await seed();
  let calls = r.calls.length;
  r.cache.applyChanges(batchOfEvents([ev(1, 'x', 'files')])); // a restore rewrote every tracked file
  await seed();
  assert.deepEqual(r.calls.slice(calls), ['x|home', 'x|pricing'], 'y untouched');
  for (const [index, kind] of (['design', 'added', 'removed'] as const).entries()) {
    calls = r.calls.length;
    r.cache.applyChanges(batchOfEvents([ev(2 + index, 'x', kind)]));
    await seed();
    assert.deepEqual(r.calls.slice(calls), ['x|home', 'x|pricing'], kind);
  }
  calls = r.calls.length;
  r.cache.applyChanges(batchOfEvents([ev(5, null, 'root')]));
  await seed();
  assert.equal(r.calls.length, calls + 3, 'root: every entry');
  calls = r.calls.length;
  r.cache.applyChanges({ reset: true, epoch: 'e2', seq: 0, events: [] });
  await seed();
  assert.equal(r.calls.length, calls + 3, 'reset: every entry');
  calls = r.calls.length;
  r.cache.clear();
  await seed();
  assert.equal(r.calls.length, calls + 3, 'the view closed');
});

test('source cache: a fetch running through an invalidation does not cache its answer', async () => {
  const r = cacheRig();
  r.holdNext();
  const pending = r.cache.get('x', 'home');
  r.cache.applyChanges(batchOfEvents([ev(1, 'x', 'files', ['screens/home.html'])]));
  r.bump(); // the file changed while the fetch was in flight
  r.release();
  const stale = await pending;
  assert.match(stale.text, /^v1 /, 'the caller still gets the answer it asked for');
  const fresh = await r.cache.get('x', 'home');
  assert.match(fresh.text, /^v2 /, 'the next read is fresh, not the stale cached bytes');
  assert.deepEqual(r.calls, ['x|home', 'x|home']);
});

test('source cache: concurrent gets share one fetch; a failed load is not cached', async () => {
  const r = cacheRig();
  r.holdNext();
  const a = r.cache.get('x', 'home');
  const b = r.cache.get('x', 'home');
  r.release();
  assert.equal(await a, await b);
  assert.deepEqual(r.calls, ['x|home']);
  r.failNext();
  await assert.rejects(r.cache.get('x', 'pricing'), /service down/);
  await r.cache.get('x', 'pricing');
  assert.deepEqual(r.calls, ['x|home', 'x|pricing', 'x|pricing'], 'the error was not cached');
});

// ---- the fake service's edit routes (the stand-in the UI develops against) ----

test('fake edits: text splices the source, escapes typed markup, versions first, emits origin user; undo restores the bytes', async () => {
  const { service, client } = fakeRig();
  const source = await client.call('GET /designs/:slug/source', { params: { slug: COFFEE }, query: { screen: 'home' } });
  const answer = await client.call('POST /designs/:slug/edits', {
    params: { slug: COFFEE },
    body: textEditBody(source.sha256, HERO, '</p><script>alert(1)</script>'),
  });
  assert.match(answer.edit.id, /^e_[a-z0-9]{8,24}$/);
  assert.equal(answer.edit.label, 'Text updated in Home');
  assert.deepEqual(answer.edit.files, ['screens/home.html']);
  assert.equal(answer.version?.reason, 'user-edit');
  assert.equal(answer.coalesced, false);
  const entry = service.designs.get(COFFEE);
  assert.ok(entry);
  const text = entry.files['screens/home.html'] ?? '';
  assert.ok(text.includes('&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;'), 'typed markup stays text (E6)');
  assert.ok(!text.includes('<script>alert'), 'no raw script lands in the file');
  assert.equal(text.replace('&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;', HERO), source.text, 'only the edited run changed (E5)');
  assert.deepEqual(entry.edits.ledger.map((item) => item.kind), ['text']);
  const events = await emittedEvents(client);
  assert.ok(
    events.some((event) => event.kind === 'files' && event.origin === 'user' && event.files?.includes('screens/home.html')),
    'the user event carries origin',
  );
  assert.ok(events.some((event) => event.kind === 'versions' && event.origin === undefined), 'the version event is the service\'s own');

  const undone = await client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: answer.edit.id }, body: {} });
  assert.deepEqual(undone.files, ['screens/home.html']);
  assert.equal(entry.files['screens/home.html'], source.text, 'byte-exact undo');
  assert.equal(entry.edits.ledger.length, 0, 'the unsent entry is removed, not replaced (§7.1)');
  await assert.rejects(
    client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: answer.edit.id }, body: {} }),
    /can't be undone any more/,
  );
  // Once the entry was sent (cleared from the ledger), an undo appends an "Undid" line instead.
  const second = await client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: textEditBody(fakeHash(source.text), HERO, 'Another headline') });
  await client.call('POST /designs/:slug/hand-edits/clear', { params: { slug: COFFEE }, body: { upTo: entry.edits.seq } });
  assert.equal(entry.edits.ledger.length, 0, 'the message took the entry');
  await client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: second.edit.id }, body: {} });
  assert.deepEqual(entry.edits.ledger.map((item) => item.kind), ['undo']);
});

test('fake edits: a burst coalesces into one version; an agent write between forces a new one', async () => {
  const { service, client } = fakeRig();
  const edit = async (before: string, after: string) => {
    const source = await client.call('GET /designs/:slug/source', { params: { slug: COFFEE }, query: { screen: 'home' } });
    return client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: textEditBody(source.sha256, before, after) });
  };
  const first = await edit(HERO, 'A');
  assert.equal(first.coalesced, false);
  assert.ok(first.version);
  const second = await edit('A', 'B');
  assert.equal(second.coalesced, true);
  assert.equal(second.version, null);
  service.writeFile(COFFEE, 'screens/pricing.html', 'the agent was here');
  const third = await edit('B', 'C');
  assert.equal(third.coalesced, false);
  assert.ok(third.version, 'the agent\'s state gets its own version');
});

test('fake edits: undo after the agent changed the file is refused with the E9 sentence', async () => {
  const { service, client } = fakeRig();
  const source = await client.call('GET /designs/:slug/source', { params: { slug: COFFEE }, query: { screen: 'home' } });
  const answer = await client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: textEditBody(source.sha256, HERO, 'New headline') });
  service.writeFile(COFFEE, 'screens/home.html', 'the agent rewrote it');
  await assert.rejects(
    client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: answer.edit.id }, body: {} }),
    (error: unknown) => {
      assert.ok(isServiceError(error, 'stale'));
      assert.match(error.message, /changed after your edit/);
      return true;
    },
  );
  assert.equal(service.designs.get(COFFEE)?.files['screens/home.html'], 'the agent rewrote it', 'nothing was put back');
});

test('fake edits: reorder moves one screen, stamps the list, and undoes back', async () => {
  const { service, client } = fakeRig();
  const detail = await client.call('GET /designs/:slug', { params: { slug: COFFEE } });
  const answer = await client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: { op: 'reorder', screens: detail.screensStamp ?? '', order: ['pricing', 'home'] } });
  // An adjacent swap reads as either screen moving; describeMove names the one first in the old order.
  assert.equal(answer.edit.label, 'Moved Home to the end');
  assert.ok(answer.stamps.screens);
  const entry = service.designs.get(COFFEE);
  assert.deepEqual(entry?.design.screens.map((screen) => screen.id), ['pricing', 'home']);
  const events = await emittedEvents(client);
  assert.ok(events.some((event) => event.kind === 'design' && event.origin === 'user'));
  // A stale stamp is refused.
  await assert.rejects(
    client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: { op: 'reorder', screens: detail.screensStamp ?? '', order: ['home', 'pricing'] } }),
    /screen list changed while you were working/,
  );
  await client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: answer.edit.id }, body: {} });
  assert.deepEqual(entry?.design.screens.map((screen) => screen.id), ['home', 'pricing']);
});

test('fake edits: duplicate copies the bytes after the original; trash removes; both undo', async () => {
  const { service, client } = fakeRig();
  const entry = service.designs.get(COFFEE);
  assert.ok(entry);
  const detail = await client.call('GET /designs/:slug', { params: { slug: COFFEE } });
  const home = detail.files.screens.home;
  assert.ok(home);
  const homeText = entry.files['screens/home.html'] ?? '';
  const copy = await client.call('POST /designs/:slug/edits', {
    params: { slug: COFFEE },
    body: { op: 'duplicate', screens: detail.screensStamp ?? '', id: 'home', file: { size: home.size, mtime: home.mtime } },
  });
  assert.equal(copy.created?.id, 'home-copy');
  assert.equal(copy.created?.title, 'Home copy');
  assert.equal(copy.edit.label, 'Duplicated Home');
  assert.equal(entry.files['screens/home-copy.html'], homeText);
  assert.deepEqual(entry.design.screens.map((screen) => screen.id), ['home', 'home-copy', 'pricing']);
  await client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: copy.edit.id }, body: {} });
  assert.equal(entry.files['screens/home-copy.html'], undefined);
  assert.deepEqual(entry.design.screens.map((screen) => screen.id), ['home', 'pricing']);

  const fresh = await client.call('GET /designs/:slug', { params: { slug: COFFEE } });
  const pricing = fresh.files.screens.pricing;
  assert.ok(pricing);
  const pricingText = entry.files['screens/pricing.html'] ?? '';
  const trashed = await client.call('POST /designs/:slug/edits', {
    params: { slug: COFFEE },
    body: { op: 'trash-screen', screens: fresh.screensStamp ?? '', id: 'pricing', file: { size: pricing.size, mtime: pricing.mtime } },
  });
  assert.equal(trashed.edit.label, 'Moved Pricing to trash');
  assert.equal(entry.files['screens/pricing.html'], undefined);
  assert.deepEqual(entry.design.screens.map((screen) => screen.id), ['home']);
  await client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: trashed.edit.id }, body: {} });
  assert.equal(entry.files['screens/pricing.html'], pricingText);
  assert.deepEqual(entry.design.screens.map((screen) => screen.id), ['home', 'pricing']);
});

test('fake edits: keep-direction keeps the chosen bytes in the original place, moves its comments, and undoes', async () => {
  const { service, client } = fakeRig();
  const entry = service.designs.get(COFFEE);
  assert.ok(entry);
  const originalHome = entry.files['screens/home.html'] ?? '';
  entry.design.screens.push(
    { id: 'home-a', title: 'Home, bold', file: 'screens/home-a.html', direction: { of: 'home', letter: 'A', name: 'Bold' } },
    { id: 'home-b', title: 'Home, editorial', file: 'screens/home-b.html', direction: { of: 'home', letter: 'B', name: 'Editorial' } },
  );
  service.writeFile(COFFEE, 'screens/home-a.html', 'A bytes');
  service.writeFile(COFFEE, 'screens/home-b.html', 'B bytes');
  const hero = entry.design.comments[0];
  assert.ok(hero);
  entry.design.comments.push({ ...hero, id: 'c_dir01', screen: 'home-b' });
  const detail = await client.call('GET /designs/:slug', { params: { slug: COFFEE } });
  const stampOf = (id: string) => {
    const file = detail.files.screens[id];
    assert.ok(file);
    return { size: file.size, mtime: file.mtime };
  };
  const answer = await client.call('POST /designs/:slug/edits', {
    params: { slug: COFFEE },
    body: {
      op: 'keep-direction',
      screens: detail.screensStamp ?? '',
      of: 'home',
      keep: 'home-b',
      files: [
        { id: 'home', file: stampOf('home') },
        { id: 'home-a', file: stampOf('home-a') },
        { id: 'home-b', file: stampOf('home-b') },
      ],
    },
  });
  assert.equal(answer.edit.label, 'Kept B for Home');
  assert.equal(answer.edit.detail, 'The others are in the trash.');
  assert.equal(answer.version?.reason, 'keep-direction');
  assert.equal(entry.files['screens/home.html'], 'B bytes');
  assert.equal(entry.files['screens/home-a.html'], undefined);
  assert.equal(entry.files['screens/home-b.html'], undefined);
  assert.deepEqual(entry.design.screens.map((screen) => screen.id), ['home', 'pricing']);
  assert.equal(entry.design.comments.find((comment) => comment.id === 'c_dir01')?.screen, 'home');

  await client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: answer.edit.id }, body: {} });
  assert.equal(entry.files['screens/home.html'], originalHome);
  assert.equal(entry.files['screens/home-a.html'], 'A bytes');
  assert.equal(entry.files['screens/home-b.html'], 'B bytes');
  assert.deepEqual(entry.design.screens.map((screen) => screen.id), ['home', 'pricing', 'home-a', 'home-b']);
  assert.equal(entry.design.comments.find((comment) => comment.id === 'c_dir01')?.screen, 'home-b');
});

test('fake edits: tokens read the knobs, save splices the value, and refuse a stale base', async () => {
  const { service, client } = fakeRig();
  const entry = service.designs.get(COFFEE);
  assert.ok(entry);
  entry.design.tweaks = [{ var: '--radius', label: 'Corner radius', kind: 'number', min: 0, max: 24, step: 2, unit: 'px' }];
  service.writeFile(COFFEE, 'tokens.css', ':root { --radius: 8px; }');
  const tokens = await client.call('GET /designs/:slug/tokens', { params: { slug: COFFEE } });
  assert.equal(tokens.exists, true);
  assert.equal(tokens.editable, true);
  assert.deepEqual(tokens.knobs, [{ var: '--radius', state: 'ok', value: 8, fileUnit: 'px', alsoSet: [] }]);
  const answer = await client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: { op: 'tokens', base: tokens.sha256 ?? '', values: [{ var: '--radius', value: 12 }] } });
  assert.equal(answer.edit.label, 'Tweaks saved to tokens.css');
  assert.ok(answer.stamps.tokens);
  assert.match(entry.files['tokens.css'] ?? '', /--radius: 12px/);
  await assert.rejects(
    client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: { op: 'tokens', base: tokens.sha256 ?? '', values: [{ var: '--radius', value: 16 }] } }),
    /tokens.css changed since you started/,
  );
  await client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: answer.edit.id }, body: {} });
  assert.match(entry.files['tokens.css'] ?? '', /--radius: 8px/);
});

test('fake edits: the ledger caps with a dropped count; clear removes seq ≤ upTo, idempotently', async () => {
  const { service, client } = fakeRig();
  const entry = service.designs.get(COFFEE);
  assert.ok(entry);
  let text = HERO;
  for (let i = 0; i < HAND_EDITS_LEDGER_MAX + 1; i += 1) {
    const source = await client.call('GET /designs/:slug/source', { params: { slug: COFFEE }, query: { screen: 'home' } });
    const next = i % 2 === 0 ? 'Even headline' : 'Odd headline';
    await client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: textEditBody(source.sha256, text, next) });
    text = next;
  }
  assert.equal(entry.edits.ledger.length, HAND_EDITS_LEDGER_MAX);
  assert.equal(entry.edits.dropped, 1);
  assert.equal(entry.edits.seq, HAND_EDITS_LEDGER_MAX + 1);
  // The prompt carries the block and its upTo; continue carries none.
  const prompt = await client.call('POST /designs/:slug/prompt', { params: { slug: COFFEE }, body: { purpose: 'ask', text: 'Hello' } });
  assert.equal(prompt.handEdits?.upTo, HAND_EDITS_LEDGER_MAX + 1);
  assert.equal(prompt.handEdits?.count, HAND_EDITS_LEDGER_MAX);
  assert.match(prompt.text, /Hand edits since my last message/);
  assert.match(prompt.text, /and 1 earlier hand edit/);
  const cont = await client.call('POST /designs/:slug/prompt', { params: { slug: COFFEE }, body: { purpose: 'continue' } });
  assert.equal(cont.handEdits, null);

  await client.call('POST /designs/:slug/hand-edits/clear', { params: { slug: COFFEE }, body: { upTo: 10 } });
  assert.ok(entry.edits.ledger.every((item) => item.seq > 10));
  const count = entry.edits.ledger.length;
  await client.call('POST /designs/:slug/hand-edits/clear', { params: { slug: COFFEE }, body: { upTo: 10 } });
  assert.equal(entry.edits.ledger.length, count, 'idempotent');
  await client.call('POST /designs/:slug/hand-edits/clear', { params: { slug: COFFEE }, body: { upTo: HAND_EDITS_LEDGER_MAX + 1 } });
  assert.deepEqual(entry.edits.ledger, []);
  const after = await client.call('POST /designs/:slug/prompt', { params: { slug: COFFEE }, body: { purpose: 'ask', text: 'Hello again' } });
  assert.equal(after.handEdits, null);
});

test('fake edits: malformed requests are refused with the pipeline\'s sentences', async () => {
  const { client } = fakeRig();
  const source = await client.call('GET /designs/:slug/source', { params: { slug: COFFEE }, query: { screen: 'home' } });
  await assert.rejects(
    client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: { op: 'teleport', base: source.sha256 } as unknown as EditRequest }),
    (error: unknown) => {
      assert.ok(isServiceError(error, 'bad-request'));
      return true;
    },
  );
  await assert.rejects(
    client.call('POST /designs/:slug/edits/:id/undo', { params: { slug: COFFEE, id: 'not-an-id' }, body: {} }),
    /not an edit id/,
  );
  await assert.rejects(
    client.call('POST /designs/:slug/hand-edits/clear', { params: { slug: COFFEE }, body: { upTo: 0 } }),
    /hand-edit position/,
  );
  // A text edit over the cap: the 413 sentence.
  await assert.rejects(
    client.call('POST /designs/:slug/edits', { params: { slug: COFFEE }, body: textEditBody(source.sha256, HERO, 'x'.repeat(5001)) }),
    /too long to edit here/,
  );
});
