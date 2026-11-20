// Build chips (`system-build:<ticket>`, documentation/specs/phase-2-5-technical.md §2.12): a chat that
// carries one gets recorded in the ticket, marker-gated and only while the ticket has no chat; the
// design and system chip paths are untouched.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chipMarkerOf, markChipUrl } from '../../../src/shared/agent/chip.ts';
import type { DesignIndex } from '../../../src/service/context.ts';
import { buildChipsOf, createSessionLinks, LINKED_CHIPS_MAX, type LinkEvent } from '../../../src/service/session-links.ts';
import type { BuildTickets } from '../../../src/service/systems/builds.ts';

const URL_BASE = 'file:///home/you/Documents/Designs/.chamber/system-builds/sb_k3m9q2x7a1bc.md';
const CREATED = '2026-11-20T10:00:00.000Z';
const MARKER = chipMarkerOf(CREATED) ?? '';

const buildChip = (ticket: string, created: string | null = CREATED): unknown => ({
  id: `guest:design-chamber:system-build:${ticket}`,
  kind: 'guest',
  url: created === null ? URL_BASE : markChipUrl(URL_BASE, created),
});
const eventOf = (sessionId: string, linked: unknown[], parentId: string | null = null): LinkEvent => ({ session: { id: sessionId, parentId }, linked });
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const coldIndex: Pick<DesignIndex, 'get'> = { get: () => null };

test('buildChipsOf: our marked build chips with valid tickets, once each; other chips and junk are skipped', () => {
  assert.deepEqual(buildChipsOf([buildChip('sb_k3m9q2x7a1bc'), buildChip('sb_k3m9q2x7a1bc'), buildChip('sb_000000000000')]), [
    { ticket: 'sb_k3m9q2x7a1bc', marker: MARKER },
    { ticket: 'sb_000000000000', marker: MARKER },
  ]);
  assert.deepEqual(buildChipsOf([buildChip('sb_k3m9q2x7a1bc', null)]), [], 'no marker, no link');
  const junk: unknown[] = [
    null,
    'x',
    { id: 'guest:design-chamber:system:acme', kind: 'guest', url: markChipUrl(URL_BASE, CREATED) },
    { id: 'guest:other:system-build:sb_k3m9q2x7a1bc', kind: 'guest', url: markChipUrl(URL_BASE, CREATED) },
    { id: 'guest:design-chamber:system-build:sb_k3m9q2x7a1bc', kind: 'issue', url: markChipUrl(URL_BASE, CREATED) },
    buildChip('../etc'),
    buildChip('sb_SHORT'),
    buildChip('sb_k3m9q2x7a1bc/x'),
  ];
  assert.deepEqual(buildChipsOf(junk), []);
  const many = Array.from({ length: LINKED_CHIPS_MAX + 4 }, (_, n) => buildChip(`sb_${String(n).padStart(12, '0')}`));
  assert.equal(buildChipsOf(many).length, LINKED_CHIPS_MAX);
});

test('a build chip on a chat calls linkSession with the chat, the ticket and the marker; a subagent chat links nothing', async () => {
  const calls: [string, string, string][] = [];
  const builds: Pick<BuildTickets, 'linkSession'> = {
    linkSession: async (ticket, sessionId, marker) => {
      calls.push([ticket, sessionId, marker]);
      return 'linked';
    },
  };
  const links = createSessionLinks({ store: { linkIfUnlinked: async () => 'has-chat' as const }, index: coldIndex, log: quiet, builds });
  links.take(eventOf('ses_sub', [buildChip('sb_k3m9q2x7a1bc')], 'ses_parent'));
  links.take(eventOf('ses_chat', [buildChip('sb_k3m9q2x7a1bc')]));
  await links.idle();
  assert.deepEqual(calls, [['sb_k3m9q2x7a1bc', 'ses_chat', MARKER]]);
  links.dispose();
});

test('a failing linkSession is logged and does not stop the queue; without the builds dep, build chips are ignored', async () => {
  const warned: string[] = [];
  const links = createSessionLinks({
    store: { linkIfUnlinked: async () => 'has-chat' as const },
    index: coldIndex,
    log: { ...quiet, warn: (event: string) => void warned.push(event) },
    builds: { linkSession: async () => Promise.reject(new Error('disk full')) },
  });
  links.take(eventOf('ses_a', [buildChip('sb_k3m9q2x7a1bc')]));
  await links.idle();
  assert.deepEqual(warned, ['session-links.build-failed']);

  let called = false;
  const without = createSessionLinks({ store: { linkIfUnlinked: async () => ((called = true), 'has-chat' as const) }, index: coldIndex, log: quiet });
  without.take(eventOf('ses_a', [buildChip('sb_k3m9q2x7a1bc')]));
  await without.idle();
  assert.equal(called, false);
});
