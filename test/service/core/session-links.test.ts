// Linking a design to the chat that carries its chip, from session events (see
// src/service/session-links.ts). The chip on the chat is the evidence, never timing: a design is
// linked only while it has no chat, only to a chat whose event lists our chip for that very design
// (slug and the design's created-time marker in the chip URL), and never relinked. Works the same
// for a chat with no project, which no guest can see.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GuestSessionLinkedItem } from '@openchamber/sdk';

import { chipMarkerOf, markChipUrl } from '../../../src/shared/agent/chip.ts';
import { TURN_EVENT_QUEUE_MAX } from '../../../src/shared/limits.ts';
import type { DesignIndex, DesignStore, LinkIfUnlinkedOutcome, ServiceContext } from '../../../src/service/context.ts';
import { registerSessionEventsRoutes } from '../../../src/service/routes/session-events.ts';
import { chipsOf, createSessionLinks, LINKED_CHIPS_MAX, type LinkEvent } from '../../../src/service/session-links.ts';
import type { TurnEvents } from '../../../src/service/turn-events.ts';
import type { DesignSummary } from '../../../src/shared/types.ts';
import { createCore, serveCore } from './harness.ts';

const FOLDER = 'file:///home/you/Documents/Designs/tea';

/** Our chip as OpenChamber lists it on a chat; `created` is the design's, as the service put it in the URL. */
const chipOf = (slug: string, created: string | null): GuestSessionLinkedItem => ({
  id: `guest:design-chamber:design:${slug}`,
  kind: 'guest',
  url: created === null ? FOLDER : markChipUrl(FOLDER, created),
  identifier: `design:${slug}`,
});

const eventOf = (sessionId: string, linked: unknown[], parentId: string | null = null): LinkEvent => ({ session: { id: sessionId, parentId }, linked });

/** An index that knows nothing (cold start): every chip goes to the store. */
const coldIndex: Pick<DesignIndex, 'get'> = { get: () => null };

/** A store clock one second apart per call, so two designs never share a created time. */
const ticking = (): (() => Date) => {
  let at = Date.parse('2026-11-10T10:00:00.000Z');
  return () => new Date((at += 1000));
};

test('chipsOf: only our own design chips carrying a marker, valid slugs, once each; junk never throws', () => {
  const created = '2026-11-10T11:58:12.741Z';
  const marker = chipMarkerOf(created);
  assert.ok(marker !== null);
  assert.deepEqual(chipsOf([chipOf('tea', created), chipOf('tea', created), chipOf('pricing-2', created)]), [
    { slug: 'tea', marker },
    { slug: 'pricing-2', marker },
  ]);
  assert.deepEqual(chipsOf([chipOf('tea', null)]), [], 'a chip from an older build has no marker');
  const foreign: unknown[] = [
    { id: 'linear:OPE-367', kind: 'linear', url: 'https://linear.app/x', provider: 'linear', identifier: 'OPE-367' },
    { id: 'guest:other-ext:design:tea', kind: 'guest', url: markChipUrl(FOLDER, created) },
    { id: 'guest:design-chamber:design:tea', kind: 'issue', url: markChipUrl(FOLDER, created) },
    { id: 'guest:design-chamber:issue:tea', kind: 'guest', url: markChipUrl(FOLDER, created) },
    { id: 'guest:design-chamber:design:tea', kind: 'guest', url: `${FOLDER}#dc-created=` },
    { id: 'guest:design-chamber:design:tea', kind: 'guest', url: `${FOLDER}#dc-created=NOT_BASE36` },
  ];
  assert.deepEqual(chipsOf(foreign), []);
  for (const bad of ['../x', 'A', '', 'a/b', 'a\\b', '-x', 'x'.repeat(64), 'tea\n']) {
    assert.deepEqual(chipsOf([{ id: `guest:design-chamber:design:${bad}`, kind: 'guest', url: markChipUrl(FOLDER, created) }]), [], JSON.stringify(bad));
  }
  const junk: unknown[] = [null, undefined, 'x', 5, [], {}, { id: 5, kind: 'guest', url: 'u' }, { id: 'guest:design-chamber:design:tea', kind: 'guest' }, { id: 'guest:design-chamber:design:tea', kind: 'guest', url: null }];
  assert.deepEqual(chipsOf(junk), []);
  const many = Array.from({ length: LINKED_CHIPS_MAX + 5 }, (_, i) => chipOf(`d${i}`, created));
  assert.equal(chipsOf(many).length, LINKED_CHIPS_MAX);
});

test('an unlinked design whose chip is on a chat with no project is linked to that chat', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const chatDirectory = '/home/you/.config/openchamber/chats/2026-11-10/session-e965d591';
  const stub = await core.store.create({ kind: 'page', title: 'Tea', brief: 'tiny page about tea', preset: null, projectDirectory: chatDirectory });
  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  links.take(eventOf('ses_chat', [chipOf(stub.slug, stub.state.created)]));
  await links.idle();

  const { design } = await core.store.get(stub.slug);
  assert.equal(design.sessionId, 'ses_chat');
  assert.equal(design.projectDirectory, chatDirectory);
});

test('a chip from an older build (no marker) links nothing', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const stub = await core.store.create({ kind: 'page', title: 'Tea', brief: '', preset: null, projectDirectory: null });
  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  links.take(eventOf('ses_chat', [chipOf(stub.slug, null)]));
  await links.idle();
  assert.equal((await core.store.get(stub.slug)).design.sessionId, null);
});

test('a linked design is never relinked, a subagent links nothing, and a chip for a missing design is skipped', async (t) => {
  const core = await createCore(t, { now: ticking() });
  t.after(() => core.stop());
  const linked = await core.store.create({ kind: 'page', title: 'Linked', brief: '', preset: null, projectDirectory: null, sessionId: 'ses_first' });
  const open = await core.store.create({ kind: 'canvas', title: 'Open', brief: '', preset: null, projectDirectory: null });
  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  // Another chat that also carries both chips (the user attached them there too).
  links.take(eventOf('ses_other', [chipOf(linked.slug, linked.state.created), chipOf('gone-design', linked.state.created)]));
  // A subagent of a chat with the open design's chip.
  links.take(eventOf('ses_sub', [chipOf(open.slug, open.state.created)], 'ses_parent'));
  await links.idle();

  assert.equal((await core.store.get(linked.slug)).design.sessionId, 'ses_first', 'never moved to another chat');
  assert.equal((await core.store.get(open.slug)).design.sessionId, null, 'a subagent event links nothing');
  assert.ok(!core.logs.some((line) => line.level === 'error' || line.event === 'session-links.failed'), 'a missing design is not a failure');
});

test('the first chat to report the chip keeps the design', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const stub = await core.store.create({ kind: 'page', title: 'Tea', brief: '', preset: null, projectDirectory: null });
  const links = createSessionLinks({ store: core.store, index: coldIndex, log: core.ctx.log });
  t.after(() => links.dispose());

  links.take(eventOf('ses_a', [chipOf(stub.slug, stub.state.created)]));
  links.take(eventOf('ses_b', [chipOf(stub.slug, stub.state.created)]));
  await links.idle();

  assert.equal((await core.store.get(stub.slug)).design.sessionId, 'ses_a');
});

test('store.linkIfUnlinked: links only a design with no chat whose created time gives the marker', async (t) => {
  const core = await createCore(t, { now: ticking() });
  t.after(() => core.stop());
  const stub = await core.store.create({ kind: 'page', title: 'Tea', brief: '', preset: null, projectDirectory: null });
  const marker = chipMarkerOf(stub.state.created);
  assert.ok(marker !== null);
  const other = chipMarkerOf(new Date(Date.parse(stub.state.created) - 1).toISOString());
  assert.ok(other !== null && other !== marker);

  assert.equal(await core.store.linkIfUnlinked(stub.slug, 'ses_a', other), 'other-design');
  assert.equal((await core.store.get(stub.slug)).design.sessionId, null);
  // Two at once: the lock lets exactly one link.
  const outcomes = await Promise.all([core.store.linkIfUnlinked(stub.slug, 'ses_a', marker), core.store.linkIfUnlinked(stub.slug, 'ses_b', marker)]);
  assert.deepEqual(outcomes, ['linked', 'has-chat']);
  assert.equal((await core.store.get(stub.slug)).design.sessionId, 'ses_a');
  await assert.rejects(core.store.linkIfUnlinked('no-such-design', 'ses_a', marker), { code: 'not-found' });
});

test('an index that already shows the design linked costs no store call', async (t) => {
  let calls = 0;
  const store: Pick<DesignStore, 'linkIfUnlinked'> = { linkIfUnlinked: async () => ((calls += 1), 'linked') };
  const summary = { slug: 'tea', sessionId: 'ses_known' } as DesignSummary; // Safe: only `sessionId` is read.
  const index: Pick<DesignIndex, 'get'> = { get: (slug) => (slug === 'tea' ? summary : null) };
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const links = createSessionLinks({ store, index, log });
  t.after(() => links.dispose());

  links.take(eventOf('ses_known', [chipOf('tea', '2026-11-10T11:58:12.741Z')]));
  links.take(eventOf('ses_else', []));
  await links.idle();
  assert.equal(calls, 0);
});

test(`at most TURN_EVENT_QUEUE_MAX (${TURN_EVENT_QUEUE_MAX}) chats wait; the oldest waiting ones are dropped with a warning`, async (t) => {
  let release!: () => void; // Safe: assigned by the Promise constructor below, before any await.
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const linkedTo: string[] = [];
  const store: Pick<DesignStore, 'linkIfUnlinked'> = {
    linkIfUnlinked: async (_slug, sessionId): Promise<LinkIfUnlinkedOutcome> => {
      await gate;
      linkedTo.push(sessionId);
      return 'linked';
    },
  };
  const warnings: string[] = [];
  const log = { info: () => undefined, warn: (event: string) => void warnings.push(event), error: () => undefined };
  const links = createSessionLinks({ store, index: coldIndex, log });
  t.after(() => links.dispose());
  const chip = chipOf('tea', '2026-11-10T11:58:12.741Z');

  // Chat 0 is taken by the worker at once and waits on the gate; chats 1.. wait in the queue.
  const extra = 3;
  for (let i = 0; i <= TURN_EVENT_QUEUE_MAX + extra; i += 1) links.take(eventOf(`ses_${i}`, [chip]));
  release();
  await links.idle();

  const expected = ['ses_0', ...Array.from({ length: TURN_EVENT_QUEUE_MAX }, (_, i) => `ses_${i + 1 + extra}`)];
  assert.deepEqual(linkedTo, expected);
  assert.equal(warnings.filter((event) => event === 'session-links.queue-full').length, extra);
});

test('POST /session-events: junk in `linked` answers { ok: true } and the turn event still reaches the turn queue', async (t) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const served = await serveCore(t, core);
  const taken: string[] = [];
  const turnEvents: TurnEvents = { take: (event) => void taken.push(event.session.id), idle: async () => undefined, dispose: () => undefined };
  registerSessionEventsRoutes(served.router, { ...core.ctx, designIndex: { ...coldIndex, all: () => [], bySession: () => [], ready: async () => true, dispose: async () => undefined } }, turnEvents);

  for (const linked of [[null], [{}], [{ id: 5, kind: 'guest', url: 'u' }], [{ id: 'guest:design-chamber:design:tea', kind: 'guest' }], [7, 'x', []]]) {
    const body = { v: 1, requestId: 'r', event: { id: 'e', type: 'turn-started', at: 1, session: { id: 'ses_junk', parentId: null }, project: { directory: null }, linked } };
    const response = await served.request('/session-events', { method: 'POST', body });
    assert.equal(response.status, 200, JSON.stringify(linked));
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.equal(taken.length, 5, 'every event reached the turn queue');
});

test('registerSessionEventsRoutes with an injected linker reads nothing from the context', async (t) => {
  // The way feat/turn-events' route test serves it: an empty context and its own linker.
  const core = await createCore(t);
  t.after(() => core.stop());
  const served = await serveCore(t, core);
  const linkedSeen: unknown[][] = [];
  const turnsSeen: string[] = [];
  const turnEvents: TurnEvents = { take: (event) => void turnsSeen.push(event.type), idle: async () => undefined, dispose: () => undefined };
  registerSessionEventsRoutes(served.router, {} as ServiceContext, turnEvents, { take: (event) => void linkedSeen.push([...event.linked]) }); // Safe: the injected linker means the route reads no context.

  const chip = chipOf('tea', '2026-11-10T11:58:12.741Z');
  const body = { v: 1, requestId: 'r', event: { id: 'e', type: 'turn-finished', at: 1, session: { id: 'ses_1', parentId: null }, project: { directory: null }, linked: [chip] } };
  const response = await served.request('/session-events', { method: 'POST', body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(linkedSeen, [[chip]]);
  assert.deepEqual(turnsSeen, ['turn-finished']);
});
