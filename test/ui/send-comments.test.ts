// QA regression: the one door for sending comments keeps a single flight per comment id, so the
// drawer's batch, a row button and a thread card's "Send this" can never send one comment twice.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFakeServices } from '../../src/guest/fake-services.ts';
import { isSending, sendComments, sendOneComment } from '../../src/ui/components/send-comments.ts';
import { feed, startGuest, store } from '../../src/ui/guest.ts';

const COFFEE = 'coffee-subscription';

test('a comment already on its way cannot be sent again until the first send ends', async (t) => {
  const fakes = createFakeServices({ session: { id: 'ses_fake_coffee', title: 'Coffee', busy: false } });
  fakes.host.emitReady();
  startGuest(fakes.guestHost, fakes.client);
  // The change feed long-polls; stop it so the test process can end.
  t.after(() => feed.stop());
  const coffee = fakes.service.designs.get(COFFEE);
  assert.ok(coffee);
  const [hero] = coffee.design.comments;
  assert.ok(hero);
  coffee.design.comments.push({ ...hero, id: 'c_second', body: 'Second pin' });

  const prompts = (): number => fakes.host.callsOf('prompt').length;
  const before = prompts();

  // The batch takes both comments; "Send this" on one of them while the batch is in flight is refused.
  const batch = sendComments(COFFEE, [hero.id, 'c_second'], {});
  assert.equal(isSending(hero.id), true);
  await assert.rejects(sendComments(COFFEE, [hero.id], {}), /already on its way/);
  await batch;

  assert.equal(prompts() - before, 1, 'one message, not two');
  assert.equal(isSending(hero.id), false, 'the flight ends with the send');
  assert.equal(isSending('c_second'), false);
});

test('a batch blocked by a send in flight says so in plain words for a batch', async (t) => {
  const fakes = createFakeServices({ session: { id: 'ses_fake_coffee', title: 'Coffee', busy: false } });
  fakes.host.emitReady();
  startGuest(fakes.guestHost, fakes.client);
  t.after(() => feed.stop());
  const coffee = fakes.service.designs.get(COFFEE);
  assert.ok(coffee);
  const [hero] = coffee.design.comments;
  assert.ok(hero);
  coffee.design.comments.push({ ...hero, id: 'c_second', body: 'Second pin' });

  const single = sendComments(COFFEE, [hero.id], {});
  await assert.rejects(sendComments(COFFEE, [hero.id, 'c_second'], {}), /^Error: One of these comments is already on its way\. Try again in a moment\.$/);
  await assert.rejects(sendComments(COFFEE, [hero.id], {}), /^Error: That comment is already on its way to the chat\.$/);
  await single;
});

const openCoffee = async (t: { after: (fn: () => void) => void }) => {
  const fakes = createFakeServices({ session: { id: 'ses_fake_coffee', title: 'Coffee', busy: false } });
  fakes.host.emitReady();
  startGuest(fakes.guestHost, fakes.client);
  t.after(() => feed.stop());
  await store.openDesign(COFFEE);
  const coffee = fakes.service.designs.get(COFFEE);
  assert.ok(coffee);
  const [hero] = coffee.design.comments;
  assert.ok(hero);
  return { fakes, coffee, hero };
};

test('"Send this" from a card that is older than its comment: refused, nothing sent, nothing saved', async (t) => {
  const { fakes, coffee, hero } = await openCoffee(t);
  const original = hero.body;
  // The comment went out from the list while the card was open.
  hero.status = 'sent';
  await store.refreshOpenDesign();
  const before = fakes.host.callsOf('prompt').length;
  await assert.rejects(sendOneComment(COFFEE, hero.id, 'Edited on the stale card', {}), /^Error: That comment was already sent to the chat\.$/);
  assert.equal(fakes.host.callsOf('prompt').length, before, 'the chat did not get it twice');
  assert.equal(coffee.design.comments[0]?.body, original, 'the edit was not saved onto a sent comment');

  hero.status = 'resolved';
  await store.refreshOpenDesign();
  await assert.rejects(sendOneComment(COFFEE, hero.id, hero.body, {}), /resolved/);
  await assert.rejects(sendOneComment(COFFEE, 'c_gone99', 'x', {}), /gone/);
  assert.equal(fakes.host.callsOf('prompt').length, before);
});

test('"Send this" on an open comment saves an edited body first, then sends that comment alone', async (t) => {
  const { fakes, coffee, hero } = await openCoffee(t);
  await sendOneComment(COFFEE, hero.id, 'A sharper headline, please', { [hero.id]: 'moved' });
  assert.equal(coffee.design.comments[0]?.body, 'A sharper headline, please');
  assert.equal(coffee.design.comments[0]?.status, 'sent');
  const prompts = fakes.host.callsOf('prompt');
  assert.equal(prompts.length, 1);
  assert.match((prompts[0]?.[0] as { text: string }).text, /A sharper headline, please/);
  const asked = fakes.service.requests.find((request) => request.path.endsWith('/prompt'));
  assert.deepEqual(JSON.parse(asked?.body ?? '{}').anchorStates, { [hero.id]: 'moved' }, 'the pin state travels with the one comment');

});

test('"Send this" with the text unchanged does not save it again', async (t) => {
  const { fakes, coffee, hero } = await openCoffee(t);
  await sendOneComment(COFFEE, hero.id, hero.body, {});
  assert.equal(fakes.service.requests.filter((request) => request.method === 'PATCH').length, 0);
  assert.equal(coffee.design.comments[0]?.status, 'sent');
});
