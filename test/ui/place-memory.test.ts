// Keeping your place across a reload of the panel or page frame (spec §3.8): the pure decision
// (model/place-model.ts) and the wiring around it (components/place-memory.ts) on the fake host.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFakeServices, type FakeServices } from '../../src/guest/fake-services.ts';
import { keepPlace } from '../../src/ui/components/place-memory.ts';
import { feed, startGuest, store } from '../../src/ui/guest.ts';
import { decideRestore, placeKey, readPlace, storedPlace } from '../../src/ui/model/place-model.ts';

const COFFEE = 'coffee-subscription';
const LIST = [{ slug: COFFEE }, { slug: 'northwind-pricing' }];

// ---- the pure decision ----

test('readPlace accepts a stored slug and ignores everything else storage might hold', () => {
  assert.equal(readPlace(storedPlace(COFFEE)), COFFEE);
  for (const junk of [undefined, null, 'coffee-subscription', 42, [], {}, { slug: 7 }, { slug: '' }, { slug: '../outside' }, { slug: 'Has Spaces' }]) {
    assert.equal(readPlace(junk), null, JSON.stringify(junk));
  }
});

test('each surface has its own key, so the rail never reopens what the page had open', () => {
  assert.notEqual(placeKey('panel'), placeKey('page'));
});

test('decideRestore: open the remembered design when the list still has it', () => {
  assert.deepEqual(decideRestore({ stored: storedPlace(COFFEE), designs: LIST, alreadyOpen: false }), { action: 'open', slug: COFFEE });
});

test('decideRestore: wait for the list, never guess before it has loaded', () => {
  assert.deepEqual(decideRestore({ stored: storedPlace(COFFEE), designs: null, alreadyOpen: false }), { action: 'wait' });
});

test('decideRestore: a design that is gone is dropped, quietly', () => {
  assert.deepEqual(decideRestore({ stored: storedPlace('deleted-design'), designs: LIST, alreadyOpen: false }), { action: 'drop' });
  assert.deepEqual(decideRestore({ stored: storedPlace('only-one'), designs: [], alreadyOpen: false }), { action: 'drop' }, 'an empty folder too');
});

test('decideRestore: nothing remembered, or something unreadable, does nothing', () => {
  assert.deepEqual(decideRestore({ stored: null, designs: LIST, alreadyOpen: false }), { action: 'skip' });
  assert.deepEqual(decideRestore({ stored: undefined, designs: null, alreadyOpen: false }), { action: 'skip' });
  assert.deepEqual(decideRestore({ stored: { slug: '../x' }, designs: LIST, alreadyOpen: false }), { action: 'skip' });
});

test('decideRestore: an open request or the user’s own choice wins over the remembered design', () => {
  assert.deepEqual(decideRestore({ stored: storedPlace(COFFEE), designs: LIST, alreadyOpen: true }), { action: 'skip' });
  assert.deepEqual(decideRestore({ stored: storedPlace(COFFEE), designs: null, alreadyOpen: true }), { action: 'skip' });
});

// ---- the wiring on the fake host ----

const KEY = placeKey('panel');

const setup = async (t: { after: (fn: () => void) => void }, stored?: unknown): Promise<FakeServices> => {
  const fakes = createFakeServices();
  fakes.host.emitReady();
  startGuest(fakes.guestHost, fakes.client);
  // The change feed long-polls; stop it so the test process can end.
  t.after(() => feed.stop());
  if (stored !== undefined) await fakes.guestHost.client.storage.set(KEY, stored as never);
  return fakes;
};

const stored = (fakes: FakeServices): Promise<unknown> => fakes.guestHost.client.storage.get(KEY);

/** Waits until `done()` holds; the wiring is asynchronous (storage, then the list). */
const until = async (done: () => boolean | Promise<boolean>, what: string): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await done()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${what}`);
};

/** Lets storage and any list load that is already on its way settle, for "nothing happens" checks. */
const settleAll = async (): Promise<void> => {
  await store.refreshDesigns();
  await new Promise((resolve) => setTimeout(resolve, 60));
};

test('remember keeps the open design, and clear (back to the list) forgets it', async (t) => {
  const fakes = await setup(t);
  const memory = keepPlace({ surface: 'panel', isOpen: () => false, open: () => undefined });
  memory.remember(COFFEE);
  await until(async () => readPlace(await stored(fakes)) === COFFEE, 'the design to be remembered');
  memory.clear();
  await until(async () => (await stored(fakes)) === null, 'the place to be forgotten');
});

test('a reload reopens the remembered design once the list has it', async (t) => {
  const fakes = await setup(t, storedPlace(COFFEE));
  const opened: string[] = [];
  keepPlace({ surface: 'panel', isOpen: () => false, open: (slug) => opened.push(slug) });
  await store.refreshDesigns();
  await until(() => opened.length > 0, 'the design to reopen');
  await settleAll();
  assert.deepEqual(opened, [COFFEE], 'once, not on every later list change');
  assert.deepEqual(readPlace(await stored(fakes)), COFFEE, 'still remembered');
});

test('a remembered design that is gone falls back to the list, forgets it, and says nothing', async (t) => {
  const fakes = await setup(t, storedPlace('deleted-design'));
  const opened: string[] = [];
  keepPlace({ surface: 'panel', isOpen: () => false, open: (slug) => opened.push(slug) });
  await until(async () => (await stored(fakes)) === null, 'the stale place to be dropped');
  assert.deepEqual(opened, []);
  assert.deepEqual(fakes.host.callsOf('toast'), [], 'no toast, no message');
});

test('an open request that already opened a design wins, and the remembered one is left alone', async (t) => {
  const fakes = await setup(t, storedPlace(COFFEE));
  const opened: string[] = [];
  keepPlace({ surface: 'panel', isOpen: () => true, open: (slug) => opened.push(slug) });
  await settleAll();
  assert.deepEqual(opened, []);
  assert.deepEqual(readPlace(await stored(fakes)), COFFEE, 'the app overwrites it with remember(), not the restore');
});

test('a design the user opens before storage answers is not replaced by the remembered one', async (t) => {
  const fakes = await setup(t, storedPlace(COFFEE));
  const opened: string[] = [];
  const memory = keepPlace({ surface: 'panel', isOpen: () => false, open: (slug) => opened.push(slug) });
  memory.remember('northwind-pricing');
  await settleAll();
  assert.deepEqual(opened, []);
  await until(async () => readPlace(await stored(fakes)) === 'northwind-pricing', 'the newer design to be remembered');
});

test('unreadable stored data is ignored', async (t) => {
  await setup(t, { slug: '../outside' });
  const opened: string[] = [];
  keepPlace({ surface: 'panel', isOpen: () => false, open: (slug) => opened.push(slug) });
  await settleAll();
  assert.deepEqual(opened, []);
});
