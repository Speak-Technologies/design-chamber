// QA regression (commit 9563d92): a chip stays in a chat's linked items for good, and slugs are
// reused once a design is deleted (`uniqueSlug` checks only live folders). An old chat that once
// carried `design:tea` must not claim a new, unrelated `tea` stub made for another chat.
// Expected to FAIL until session-links tells a chip of the old design from one of the new.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GuestSessionLinkedItem } from '@openchamber/sdk';

import type { DesignIndex } from '../../../src/service/context.ts';
import { createSessionLinks } from '../../../src/service/session-links.ts';
import { createCore } from './harness.ts';

const chipOf = (slug: string): GuestSessionLinkedItem => ({ id: `guest:design-chamber:design:${slug}`, kind: 'guest', url: 'file:///x', identifier: `design:${slug}` });
const coldIndex: Pick<DesignIndex, 'get'> = { get: () => null };

test('a chat that carried the chip of a deleted design does not claim a new design with the same slug', { todo: 'QA finding: stale chip after delete links the new stub to the old chat' }, async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());

  // Chat A made "Tea" and was linked to it; the user deleted it.
  const old = await core.store.create({ kind: 'page', title: 'Tea', brief: '', preset: null, projectDirectory: null, sessionId: 'ses_old_chat' });
  await core.store.trash(old.slug);

  // Later, `/page Tea` in chat B makes a new stub; the slug is free again, so it is the same.
  const stub = await core.store.create({ kind: 'page', title: 'Tea', brief: '', preset: null, projectDirectory: null });
  assert.equal(stub.slug, old.slug, 'precondition: the slug was reused');

  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  // Chat A has any turn before the user sends in chat B; its linked items still list the old chip.
  links.take({ session: { id: 'ses_old_chat', parentId: null }, linked: [chipOf(old.slug)] });
  await links.idle();

  assert.equal((await core.store.get(stub.slug)).design.sessionId, null, 'the new design must wait for chat B, not go to chat A');
});
