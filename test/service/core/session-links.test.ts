// Linking a design to the chat that carries its chip, from session events (see
// src/service/session-links.ts). The chip on the chat is the evidence, never timing: a design is
// linked only while it has no chat, only to a chat whose event lists `guest:design-chamber:design:<slug>`,
// and never relinked. Works the same for a chat with no project, which no guest can see.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GuestSessionLinkedItem } from '@openchamber/sdk';

import type { DesignIndex } from '../../../src/service/context.ts';
import { chipSlugsOf, createSessionLinks, LINKED_CHIPS_MAX, type LinkEvent } from '../../../src/service/session-links.ts';
import type { DesignSummary } from '../../../src/shared/types.ts';
import { createCore } from './harness.ts';

const chipOf = (slug: string): GuestSessionLinkedItem => ({ id: `guest:design-chamber:design:${slug}`, kind: 'guest', url: 'file:///x', identifier: `design:${slug}` });

const eventOf = (sessionId: string, linked: GuestSessionLinkedItem[], parentId: string | null = null): LinkEvent => ({ session: { id: sessionId, parentId }, linked });

/** An index that knows nothing (cold start): every chip slug is read from the store. */
const coldIndex: Pick<DesignIndex, 'get'> = { get: () => null };

test('chipSlugsOf: only our own design chips, valid slugs, once each', () => {
  assert.deepEqual(chipSlugsOf([chipOf('tea'), chipOf('tea'), chipOf('pricing-2')]), ['tea', 'pricing-2']);
  const foreign: GuestSessionLinkedItem[] = [
    { id: 'linear:OPE-367', kind: 'linear', url: 'https://linear.app/x', provider: 'linear', identifier: 'OPE-367' },
    { id: 'guest:other-ext:design:tea', kind: 'guest', url: 'file:///x' },
    { id: 'guest:design-chamber:design:tea', kind: 'issue', url: 'file:///x' },
    { id: 'link:https://example.com', kind: 'external', url: 'https://example.com' },
    { id: 'guest:design-chamber:issue:tea', kind: 'guest', url: 'file:///x' },
  ];
  assert.deepEqual(chipSlugsOf(foreign), []);
  for (const bad of ['../x', 'A', '', 'a/b', 'a\\b', '-x', 'x'.repeat(64), 'tea\n']) {
    assert.deepEqual(chipSlugsOf([{ id: `guest:design-chamber:design:${bad}`, kind: 'guest', url: 'file:///x' }]), [], JSON.stringify(bad));
  }
  const many = Array.from({ length: LINKED_CHIPS_MAX + 5 }, (_, i) => chipOf(`d${i}`));
  assert.equal(chipSlugsOf(many).length, LINKED_CHIPS_MAX);
});

test('an unlinked design whose chip is on a chat with no project is linked to that chat', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const chatDirectory = '/home/you/.config/openchamber/chats/2026-11-10/session-e965d591';
  const stub = await core.store.create({ kind: 'page', title: 'Tea', brief: 'tiny page about tea', preset: null, projectDirectory: chatDirectory });
  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  links.take(eventOf('ses_chat', [chipOf(stub.slug)]));
  await links.idle();

  const { design } = await core.store.get(stub.slug);
  assert.equal(design.sessionId, 'ses_chat');
  assert.equal(design.projectDirectory, chatDirectory);
});

test('a linked design is never relinked, a subagent links nothing, and a chip for a missing design is skipped', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const linked = await core.store.create({ kind: 'page', title: 'Linked', brief: '', preset: null, projectDirectory: null, sessionId: 'ses_first' });
  const open = await core.store.create({ kind: 'canvas', title: 'Open', brief: '', preset: null, projectDirectory: null });
  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  // Another chat that also carries both chips (the user attached them there too).
  links.take(eventOf('ses_other', [chipOf(linked.slug), chipOf('gone-design')]));
  // A subagent of a chat with the open design's chip.
  links.take(eventOf('ses_sub', [chipOf(open.slug)], 'ses_parent'));
  await links.idle();

  assert.equal((await core.store.get(linked.slug)).design.sessionId, 'ses_first', 'never moved to another chat');
  assert.equal((await core.store.get(open.slug)).design.sessionId, null, 'a subagent event links nothing');
  assert.ok(!core.logs.some((line) => line.level === 'error'), 'a missing design is not an error');
});

test('the first chat to report the chip keeps the design', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const stub = await core.store.create({ kind: 'page', title: 'Tea', brief: '', preset: null, projectDirectory: null });
  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  links.take(eventOf('ses_a', [chipOf(stub.slug)]));
  links.take(eventOf('ses_b', [chipOf(stub.slug)]));
  await links.idle();

  assert.equal((await core.store.get(stub.slug)).design.sessionId, 'ses_a');
});

test('an index that already shows the design linked reads no design folder', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  let reads = 0;
  const store = { get: async (slug: string) => (reads += 1, core.store.get(slug)), patch: core.store.patch };
  const summary = { slug: 'tea', sessionId: 'ses_known' } as DesignSummary; // Safe: only `sessionId` is read.
  const index: Pick<DesignIndex, 'get'> = { get: (slug) => (slug === 'tea' ? summary : null) };
  const links = createSessionLinks({ store, index, log: core.ctx.log });
  t.after(() => links.dispose());

  links.take(eventOf('ses_known', [chipOf('tea')]));
  links.take(eventOf('ses_else', []));
  await links.idle();
  assert.equal(reads, 0);
});
