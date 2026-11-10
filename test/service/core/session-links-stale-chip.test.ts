// QA regression (commit 9563d92): a chip stays in a chat's linked items for good, and slugs are
// reused once a design is deleted (`uniqueSlug` checks only live folders). An old chat that once
// carried `design:tea` must not claim a new, unrelated `tea` stub made for another chat.
// The chip carries its design's created time (a marker in its URL), so the old chat's chip names the
// old design, not the new one.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GuestSessionLinkedItem } from '@openchamber/sdk';

import { markChipUrl } from '../../../src/shared/agent/chip.ts';
import type { DesignIndex } from '../../../src/service/context.ts';
import { createSessionLinks } from '../../../src/service/session-links.ts';
import { createCore } from './harness.ts';

/** The chip as the service built it for a design: its folder URL marked with the design's created time. */
const chipOf = (slug: string, created: string): GuestSessionLinkedItem => ({ id: `guest:design-chamber:design:${slug}`, kind: 'guest', url: markChipUrl('file:///x', created), identifier: `design:${slug}` });
const coldIndex: Pick<DesignIndex, 'get'> = { get: () => null };

test('a chat that carried the chip of a deleted design does not claim a new design with the same slug', async (t) => {
  // One second per store clock call: the old and the new design never share a created time.
  let at = Date.parse('2026-11-10T10:00:00.000Z');
  const core = await createCore(t, { now: () => new Date((at += 1000)) });
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
  links.take({ session: { id: 'ses_old_chat', parentId: null }, linked: [chipOf(old.slug, old.state.created)] });
  await links.idle();
  assert.notEqual(old.state.created, stub.state.created, 'precondition: two designs, two created times');

  assert.equal((await core.store.get(stub.slug)).design.sessionId, null, 'the new design must wait for chat B, not go to chat A');
});
