// Build tickets and Stop (documentation/specs/phase-2-5-technical.md §2.12, §5.9, AD-15, AD-29): issue,
// expire, the cap, consume, the session link (only while null, marker-gated), containment of the
// ticket folder, and Stop with its in-memory Undo against a real system store in a temp designs root.

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { chipMarkerOf } from '../../../src/shared/agent/chip.ts';
import { SYSTEM_BUILD_TICKET_PATTERN, SYSTEM_BUILD_TTL_MS, SYSTEM_BUILDS_MAX, SYSTEM_STOP_UNDO_PATTERN } from '../../../src/shared/limits.ts';
import { parseSystemState } from '../../../src/shared/system-json.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createBuildTickets, parseTicket, STOP_UNDO_GONE_MESSAGE, type BuildTickets } from '../../../src/service/systems/builds.ts';
import { createSystemStore, type SystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

type Clock = { now: () => Date; advance(ms: number): void };
const clockAt = (iso: string): Clock => {
  let at = Date.parse(iso);
  return { now: () => new Date(at), advance: (ms) => (at += ms) };
};

type Setup = { tmp: TmpRoot; ctx: FakeContext; systems: SystemStore; tickets: BuildTickets; clock: Clock; make: (undoMs?: number) => BuildTickets };

const setup = async (t: TestContext): Promise<Setup> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const clock = clockAt('2026-11-20T10:00:00.000Z');
  const systems = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, indexRefreshMs: 0 });
  t.after(() => systems.dispose());
  const make = (undoMs?: number): BuildTickets => {
    const made = createBuildTickets({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, systems, now: clock.now, ...(undoMs === undefined ? {} : { undoMs }) });
    t.after(() => made.dispose());
    return made;
  };
  return { tmp, ctx, systems, tickets: make(), clock, make };
};

const RULES = (ticket: { ticket: string }): string => `# rules for ${ticket.ticket}\n`;
const buildsDir = (tmp: TmpRoot): string => tmp.at('.chamber/system-builds');
const listBuilds = async (tmp: TmpRoot): Promise<string[]> => (await readdir(buildsDir(tmp)).catch(() => [] as string[])).sort();
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

/** A system made by the store, then marked as started from a chat build (what adoption, T12b, writes). */
const builtSystem = async (s: Setup, name: string, appliedSeen: string | null = null): Promise<string> => {
  const { id } = await s.systems.create({ name });
  await s.systems.withLock(id, () =>
    s.systems.updateStateLocked(id, (state) => ({ ...state, build: { ticket: null, adoptedAt: '2026-11-20T09:00:00.000Z', appliedSeen, projectDirectory: '/home/you/shop' } })),
  );
  return id;
};

const rejectsWith = async (promise: Promise<unknown>, code: string, message?: string | RegExp): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, String(error));
    assert.equal(error.code, code);
    if (typeof message === 'string') assert.equal(error.message, message);
    else if (message !== undefined) assert.match(error.message, message);
    return true;
  });
};

// ---- tickets ----

test('issue writes <ticket>.md then <ticket>.json under .chamber/system-builds; get answers waiting with the project label, never the path', async (t) => {
  const s = await setup(t);
  const { ticket, rulesFile } = await s.tickets.issue({ projectDirectory: '/home/you/shop', sessionId: 'ses_1', rulesFor: RULES });
  assert.match(ticket.ticket, SYSTEM_BUILD_TICKET_PATTERN);
  assert.equal(rulesFile, path.join(buildsDir(s.tmp), `${ticket.ticket}.md`));
  assert.equal(await readFile(rulesFile, 'utf8'), `# rules for ${ticket.ticket}\n`);
  const stored = JSON.parse(await s.tmp.read(`.chamber/system-builds/${ticket.ticket}.json`)) as unknown;
  assert.deepEqual(stored, { v: 1, ticket: ticket.ticket, created: '2026-11-20T10:00:00.000Z', projectDirectory: '/home/you/shop', sessionId: 'ses_1' });
  assert.deepEqual(await s.tickets.get(ticket.ticket), { state: 'waiting', project: { label: 'shop' } });

  const none = await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES });
  assert.deepEqual(await s.tickets.get(none.ticket.ticket), { state: 'waiting', project: null });
  assert.notEqual(none.ticket.ticket, ticket.ticket);
});

test('a ticket expires after SYSTEM_BUILD_TTL_MS: get answers expired and the next issue removes both files', async (t) => {
  const s = await setup(t);
  const old = await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES });
  s.clock.advance(SYSTEM_BUILD_TTL_MS - 1);
  assert.equal((await s.tickets.get(old.ticket.ticket)).state, 'waiting');
  s.clock.advance(1);
  assert.deepEqual(await s.tickets.get(old.ticket.ticket), { state: 'expired' });
  assert.equal(await s.tickets.open(old.ticket.ticket), null);
  const fresh = await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES });
  assert.deepEqual(await listBuilds(s.tmp), [`${fresh.ticket.ticket}.json`, `${fresh.ticket.ticket}.md`]);
});

test('the cap: a 21st open ticket drops the oldest; unknown names, links and damaged tickets are handled without touching other files', async (t) => {
  const s = await setup(t);
  const issued: string[] = [];
  for (let n = 0; n < SYSTEM_BUILDS_MAX; n += 1) {
    issued.push((await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES })).ticket.ticket);
    s.clock.advance(1000);
  }
  // Files that are not ours stay; a damaged ticket of ours is swept.
  await writeFile(path.join(buildsDir(s.tmp), 'notes.txt'), 'mine');
  await writeFile(path.join(buildsDir(s.tmp), 'sb_zzzzzzzzzzzz.json'), '{ not json');
  const last = (await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES })).ticket.ticket;
  const files = await listBuilds(s.tmp);
  assert.equal(files.filter((name) => name.endsWith('.json')).length, SYSTEM_BUILDS_MAX);
  assert.ok(!files.includes(`${issued[0]}.json`) && !files.includes(`${issued[0]}.md`), 'the oldest is dropped');
  assert.ok(files.includes(`${issued[1]}.json`) && files.includes(`${last}.json`));
  assert.ok(files.includes('notes.txt'), "a file that isn't a ticket is never removed");
  assert.ok(!files.includes('sb_zzzzzzzzzzzz.json'));
  assert.deepEqual(await s.tickets.get(issued[0] ?? ''), { state: 'expired' });
});

test('sweep at start removes an orphaned rules file and expired tickets', async (t) => {
  const s = await setup(t);
  const kept = await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES });
  await writeFile(path.join(buildsDir(s.tmp), 'sb_aaaaaaaaaaaa.md'), 'orphan');
  await writeFile(
    path.join(buildsDir(s.tmp), 'sb_bbbbbbbbbbbb.json'),
    JSON.stringify({ v: 1, ticket: 'sb_bbbbbbbbbbbb', created: '2026-01-01T00:00:00.000Z', projectDirectory: null, sessionId: null }),
  );
  await s.make().sweep();
  assert.deepEqual(await listBuilds(s.tmp), [`${kept.ticket.ticket}.json`, `${kept.ticket.ticket}.md`]);
});

test('consume removes both files and get answers made with the system; a restart finds it through state.build.ticket', async (t) => {
  const s = await setup(t);
  const { ticket } = await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES });
  const { id } = await s.systems.create({ name: 'Acme' });
  await s.systems.withLock(id, () => s.systems.updateStateLocked(id, (state) => ({ ...state, build: { ticket: ticket.ticket, adoptedAt: '2026-11-20T10:00:00.000Z', appliedSeen: null, projectDirectory: null } })));
  await s.tickets.consume(ticket.ticket, id);
  assert.deepEqual(await listBuilds(s.tmp), []);
  assert.deepEqual(await s.tickets.get(ticket.ticket), { state: 'made', id: 'acme', name: 'Acme' });
  assert.equal(await s.tickets.open(ticket.ticket), null);

  const restarted = s.make();
  for (let i = 0; i < 50 && s.systems.index().length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await restarted.get(ticket.ticket), { state: 'made', id: 'acme', name: 'Acme' });
});

test('get refuses a value that is not a ticket before any path is built', async (t) => {
  const s = await setup(t);
  for (const bad of ['../x', 'sb_SHORT', 'sb_k3m9q2x7a1bc/..', 'sb_k3m9q2x7a1b', '']) await rejectsWith(s.tickets.get(bad), 'bad-request');
});

test('linkSession: writes the chat only while the ticket has none, and only for the chip made for that ticket', async (t) => {
  const s = await setup(t);
  const { ticket } = await s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES });
  const marker = chipMarkerOf(ticket.created) ?? '';
  assert.equal(await s.tickets.linkSession(ticket.ticket, 'ses_a', 'wrongmarker'), 'unchanged');
  assert.equal((await s.tickets.open(ticket.ticket))?.sessionId, null);
  assert.equal(await s.tickets.linkSession(ticket.ticket, 'ses_a', marker), 'linked');
  assert.equal(await s.tickets.linkSession(ticket.ticket, 'ses_b', marker), 'unchanged', 'never moved to another chat');
  assert.equal((await s.tickets.open(ticket.ticket))?.sessionId, 'ses_a');
  assert.equal(await s.tickets.linkSession('sb_nonexistent0', 'ses_a', marker), 'unchanged');
  assert.equal(await s.tickets.linkSession('../etc', 'ses_a', marker), 'unchanged');
});

test('a .chamber/system-builds that is a link leading out of the root is never written through', async (t) => {
  const s = await setup(t);
  const outside = await useTmpRoot(t, 'dc-outside-');
  await mkdir(s.tmp.at('.chamber'), { recursive: true });
  await symlink(outside.root, buildsDir(s.tmp), 'dir');
  await assert.rejects(s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES }), ApiError);
  assert.deepEqual(await readdir(outside.root), []);
  // A ticket file planted outside is not read through the link.
  await writeFile(path.join(outside.root, 'sb_aaaaaaaaaaaa.json'), JSON.stringify({ v: 1, ticket: 'sb_aaaaaaaaaaaa', created: '2026-11-20T10:00:00.000Z', projectDirectory: null, sessionId: null }));
  assert.deepEqual(await s.tickets.get('sb_aaaaaaaaaaaa'), { state: 'expired' });
  await s.tickets.sweep();
  assert.deepEqual(await readdir(outside.root), ['sb_aaaaaaaaaaaa.json'], 'the sweep never deletes through a link');
});

test('a .chamber/system-builds that is a link to another folder inside the root is never read, swept or written through', async (t) => {
  const s = await setup(t);
  const planted = JSON.stringify({ v: 1, ticket: 'sb_aaaaaaaaaaaa', created: '2026-01-01T00:00:00.000Z', projectDirectory: null, sessionId: null });
  await s.tmp.write('shop/sb_aaaaaaaaaaaa.json', planted);
  await s.tmp.write('shop/sb_bbbbbbbbbbbb.md', 'a user file that looks like ours');
  await mkdir(s.tmp.at('.chamber'), { recursive: true });
  await symlink(s.tmp.at('shop'), buildsDir(s.tmp), 'dir');
  await s.tickets.sweep();
  assert.deepEqual((await readdir(s.tmp.at('shop'))).sort(), ['sb_aaaaaaaaaaaa.json', 'sb_bbbbbbbbbbbb.md']);
  await assert.rejects(s.tickets.issue({ projectDirectory: null, sessionId: null, rulesFor: RULES }), ApiError);
  assert.equal((await readdir(s.tmp.at('shop'))).length, 2);
});

test('parseTicket keeps only the schema it wrote', () => {
  const good = { v: 1, ticket: 'sb_k3m9q2x7a1bc', created: '2026-11-20T10:00:00.000Z', projectDirectory: '/home/you/shop', sessionId: 'ses_1' };
  assert.deepEqual(parseTicket(good, 'sb_k3m9q2x7a1bc'), good);
  assert.equal(parseTicket(good, 'sb_000000000000'), null, 'the file name and the ticket must agree');
  for (const bad of [{ ...good, v: 2 }, { ...good, created: 'soon' }, { ...good, projectDirectory: 'relative/shop' }, { ...good, sessionId: '' }, { ...good, sessionId: 'a\nb' }, null, []]) {
    assert.equal(parseTicket(bad, 'sb_k3m9q2x7a1bc'), null, JSON.stringify(bad));
  }
});

test('parseSystemState keeps a valid build record and drops a damaged one', () => {
  const base = { name: 'Acme', created: '2026-11-20T10:00:00.000Z' };
  const build = { ticket: 'sb_k3m9q2x7a1bc', adoptedAt: '2026-11-20T10:00:00.000Z', appliedSeen: null, projectDirectory: '/home/you/shop' };
  assert.deepEqual(parseSystemState({ ...base, build }, 'acme', '2026-11-20T10:00:00.000Z').build, build);
  assert.equal(parseSystemState({ ...base, build: null }, 'acme', '2026-11-20T10:00:00.000Z').build, undefined);
  assert.equal(parseSystemState({ ...base, build: { ...build, appliedSeen: 'yesterday' } }, 'acme', '2026-11-20T10:00:00.000Z').build, undefined);
  assert.equal(parseSystemState({ ...base, build: { ...build, ticket: '../x' } }, 'acme', '2026-11-20T10:00:00.000Z').build, undefined);
});

// ---- Stop and Undo (rev 3, AD-29) ----

test('stop moves a never-applied Draft to the trash and answers an undo id; undo brings it back', async (t) => {
  const s = await setup(t);
  const id = await builtSystem(s, 'Acme');
  const stopped = await s.tickets.stop(id, { proposalId: 'p_k3m9q2x7' });
  assert.match(stopped.undoId, SYSTEM_STOP_UNDO_PATTERN);
  assert.equal(stopped.until, new Date(Date.parse('2026-11-20T10:00:00.000Z') + 600_000).toISOString());
  assert.equal(await exists(s.tmp.at('_systems/acme')), false);
  const trash = await readdir(s.tmp.at('.trash'));
  assert.equal(trash.length, 1);
  assert.match(trash[0] ?? '', /^system\.acme-/);
  assert.ok(s.ctx.events.some((event) => event.kind === 'system' && event.system === 'acme' && event.systemChange === 'removed'));

  assert.deepEqual(await s.tickets.undoStop(stopped.undoId), { id: 'acme' });
  assert.equal(await exists(s.tmp.at('_systems/acme/.chamber/state.json')), true);
  assert.deepEqual(await readdir(s.tmp.at('.trash')), []);
  assert.equal((await s.systems.readState('acme')).name, 'Acme');
  // An undo id works once.
  await rejectsWith(s.tickets.undoStop(stopped.undoId), 'not-found', STOP_UNDO_GONE_MESSAGE);
});

test('stop is refused once an applied stamp was acted on, and for a system not built in chat; nothing moves', async (t) => {
  const s = await setup(t);
  const id = await builtSystem(s, 'Acme', '2026-11-20T09:30:00.000Z');
  await rejectsWith(s.tickets.stop(id, { proposalId: null }), 'conflict', "Acme already has files in shop, so it can't be removed here. Delete it from the system page; shop isn't changed.");
  assert.equal(await exists(s.tmp.at('_systems/acme')), true);

  const { id: sheet } = await s.systems.create({ name: 'Sheet' });
  await rejectsWith(s.tickets.stop(sheet, { proposalId: null }), 'conflict', /wasn't started from a chat build/);
  assert.equal(await exists(s.tmp.at('_systems/sheet')), true);
  assert.equal(await exists(s.tmp.at('.trash')), false);

  await rejectsWith(s.tickets.stop('gone', { proposalId: null }), 'not-found');
  await rejectsWith(s.tickets.stop('../x', { proposalId: null }), 'bad-slug');
});

test('undo after the window answers 404 and leaves the folder in the trash', async (t) => {
  const s = await setup(t);
  const id = await builtSystem(s, 'Acme');
  const stopped = await s.tickets.stop(id, { proposalId: null });
  s.clock.advance(600_000);
  await rejectsWith(s.tickets.undoStop(stopped.undoId), 'not-found', STOP_UNDO_GONE_MESSAGE);
  assert.equal(await exists(s.tmp.at('_systems/acme')), false);
  assert.equal((await readdir(s.tmp.at('.trash'))).length, 1);
});

test('undo is refused when a system with the same id or name exists again', async (t) => {
  const s = await setup(t);
  const id = await builtSystem(s, 'Acme');
  const stopped = await s.tickets.stop(id, { proposalId: null });
  await s.systems.create({ name: 'Acme' });
  await rejectsWith(s.tickets.undoStop(stopped.undoId), 'conflict', "A design system called Acme exists again, so this one can't come back.");
  assert.equal((await readdir(s.tmp.at('.trash'))).length, 1, 'the stopped one stays in the trash');

  // Same name under another id (the folder renamed by hand): still refused.
  const other = await builtSystem(s, 'Brand');
  const again = await s.tickets.stop(other, { proposalId: null });
  await s.systems.create({ name: 'BRAND ' });
  await rejectsWith(s.tickets.undoStop(again.undoId), 'conflict', /Brand exists again/);
});

test('a restart forgets the undo ids but keeps the trash', async (t) => {
  const s = await setup(t);
  const id = await builtSystem(s, 'Acme');
  const stopped = await s.tickets.stop(id, { proposalId: null });
  const restarted = s.make();
  await rejectsWith(restarted.undoStop(stopped.undoId), 'not-found', STOP_UNDO_GONE_MESSAGE);
  assert.equal((await readdir(s.tmp.at('.trash'))).length, 1);
});
