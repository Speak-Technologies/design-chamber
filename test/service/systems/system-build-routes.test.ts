// The S8 build routes over HTTP (documentation/specs/phase-2-5-technical.md §3.5, §8.7): the bearer check,
// the parameter gates (traversal), POST /systems/chip (a ticket bound to the chat's project and session,
// the chip and its rules file under their caps), GET /system-builds/:ticket, Stop and its Undo.

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { StopBuildResponse, SystemBuildTicketResponse, SystemChipResponse } from '../../../src/shared/api.ts';
import { chipMarkerInUrl, chipMarkerOf } from '../../../src/shared/agent/chip.ts';
import { BRIEF_MAX, CHIP_TEXT_HARD_MAX, SYSTEM_BUILD_HEADER_MAX, SYSTEM_BUILD_TICKET_PATTERN, SYSTEM_SKILL_TEXT_MAX } from '../../../src/shared/limits.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemBuildRoutes } from '../../../src/service/routes/system-build.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'system-build-routes-token-0123456789';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemBuildRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };
  return { tmp, ctx, call };
};

test('every build route refuses a missing or wrong token with 401 and writes nothing', async (t) => {
  const { tmp, call } = await serve(t);
  const routes: [string, string, unknown?][] = [
    ['POST', '/systems/chip', { brief: 'x', projectDirectory: null, sessionId: null }],
    ['GET', '/system-builds/sb_k3m9q2x7a1bc'],
    ['POST', '/systems/acme/build/stop', { proposalId: null }],
    ['POST', '/system-stops/su_k3m9q2x7a1bc/undo', {}],
  ];
  for (const [method, url, body] of routes) {
    for (const token of [null, 'wrong-token']) {
      const answer = await call(method, url, body, token);
      assert.equal(answer.status, 401, `${method} ${url} ${String(token)}`);
    }
  }
  assert.deepEqual(await readdir(tmp.root), []);
});

test('a traversal or a value off the pattern is refused before any path is built', async (t) => {
  const { tmp, call } = await serve(t);
  for (const hostile of ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b']) {
    for (const url of [`/system-builds/${hostile}`, `/systems/${hostile}/build/stop`, `/system-stops/${hostile}/undo`]) {
      const answer = await call(url.startsWith('/system-builds') ? 'GET' : 'POST', url, url.startsWith('/system-builds') ? undefined : {});
      assert.equal(answer.status, 400, url);
      assert.equal((answer.json as { error: string }).error, 'bad-path', url);
    }
  }
  for (const bad of ['sb_SHORT', 'sb_..', 'C%3A', 'sb_k3m9q2x7a1bcd']) {
    const answer = await call('GET', `/system-builds/${bad}`);
    assert.equal(answer.status, 400, bad);
  }
  assert.equal((await call('POST', '/system-stops/su_bad/undo', {})).status, 400);
  assert.equal(((await call('POST', '/systems/Acme/build/stop', { proposalId: null })).json as { error: string }).error, 'bad-slug');
  assert.equal((await call('POST', '/systems/acme/build/stop', { proposalId: '../x' })).status, 400);
  assert.deepEqual(await readdir(tmp.root), []);
});

test('POST /systems/chip: a ticket bound to the project and session, the build chip, and the rules file under its cap', async (t) => {
  const { tmp, call } = await serve(t);
  const project = await useTmpRoot(t, 'dc-shop-');
  const answer = await call('POST', '/systems/chip', { brief: '  Acme, from our app  ', projectDirectory: project.root, sessionId: 'ses_here' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { ticket, chip } = answer.json as SystemChipResponse;
  assert.match(ticket, SYSTEM_BUILD_TICKET_PATTERN);
  assert.equal(chip.providerId, 'design-chamber');
  assert.equal(chip.id, `system-build:${ticket}`);
  assert.equal(chip.title, 'New design system');
  assert.deepEqual(chip.data, { build: ticket });
  const rulesFile = fileURLToPath(chip.url.replace(/#.*$/, ''));
  assert.equal(rulesFile, path.join(tmp.root, '.chamber', 'system-builds', `${ticket}.md`));
  const stored = JSON.parse(await tmp.read(`.chamber/system-builds/${ticket}.json`)) as { created: string; projectDirectory: string; sessionId: string };
  assert.equal(stored.projectDirectory, project.root);
  assert.equal(stored.sessionId, 'ses_here');
  assert.equal(chipMarkerInUrl(chip.url), chipMarkerOf(stored.created), 'the chip carries the ticket marker');

  assert.match(chip.text ?? '', /^\[Design Chamber\] Build a design system with the user\. Read .*\.md first/);
  assert.ok(chip.text?.includes(`The user's words: "Acme, from our app"`));
  assert.ok(chip.text?.includes(`Project: ${project.root}`));
  assert.ok(chip.text?.includes('Start with round one of the interview. Write nothing until the user answers it.'));
  assert.ok(chip.text?.includes(ticket));

  const rules = await readFile(rulesFile, 'utf8');
  assert.ok(rules.length <= SYSTEM_SKILL_TEXT_MAX + SYSTEM_BUILD_HEADER_MAX, `${rules.length}`);
  assert.ok(rules.startsWith(`# Design system build ${ticket}\n\nThis file is part of your instructions.`));
  assert.ok(rules.includes(`- Project folder: ${project.root}`));
  assert.ok(rules.includes(await readFile(path.resolve(import.meta.dirname, '../../../rules/SYSTEM-QUESTIONS.md'), 'utf8').then((text) => text.replace(/\r\n?/g, '\n').trim())), 'the interview is inlined verbatim');

  const state = (await call('GET', `/system-builds/${ticket}`)).json as SystemBuildTicketResponse;
  assert.deepEqual(state, { state: 'waiting', project: { label: path.basename(project.root) } });
  assert.deepEqual((await call('GET', '/system-builds/sb_000000000000')).json, { state: 'expired' });
});

test('POST /systems/chip: no project, the designs folder as the project, or a missing folder build an internal system; a maximal brief fits the chip cap', async (t) => {
  const { tmp, call } = await serve(t);
  for (const projectDirectory of [null, tmp.root, path.join(tmp.root, 'inside'), path.join(tmp.root, 'nope-not-here')]) {
    if (projectDirectory === path.join(tmp.root, 'inside')) await mkdir(projectDirectory, { recursive: true });
    const answer = await call('POST', '/systems/chip', { brief: 'x'.repeat(BRIEF_MAX), projectDirectory, sessionId: null });
    assert.equal(answer.status, 200, String(projectDirectory));
    const { ticket, chip } = answer.json as SystemChipResponse;
    assert.ok((chip.text ?? '').length <= CHIP_TEXT_HARD_MAX);
    assert.ok(chip.text?.includes('No project folder is open in this chat, so the system will live in Design Chamber; say so as an assumption.'), String(projectDirectory));
    const stored = JSON.parse(await tmp.read(`.chamber/system-builds/${ticket}.json`)) as { projectDirectory: string | null; sessionId: string | null };
    assert.equal(stored.projectDirectory, null);
    assert.equal(stored.sessionId, null);
  }
});

test('POST /systems/chip refuses a bad body with a sentence and the 50-system cap before any ticket is written', async (t) => {
  const { tmp, call } = await serve(t);
  const long = await call('POST', '/systems/chip', { brief: 'x'.repeat(BRIEF_MAX + 1), projectDirectory: null, sessionId: null });
  assert.equal(long.status, 422);
  assert.match((long.json as { message: string }).message, /^The brief is 2001 characters/);
  assert.equal((await call('POST', '/systems/chip', { brief: 1 })).status, 400);
  assert.equal((await call('POST', '/systems/chip', { brief: 'x', projectDirectory: 'relative/path' })).status, 400);
  assert.equal((await call('POST', '/systems/chip', { brief: 'x', sessionId: 'a'.repeat(200) })).status, 400);
  assert.equal((await call('POST', '/systems/chip', [])).status, 400);

  for (let n = 1; n <= 50; n += 1) await mkdir(tmp.at(`_systems/s${n}`), { recursive: true });
  const capped = await call('POST', '/systems/chip', { brief: 'x', projectDirectory: null, sessionId: null });
  assert.equal(capped.status, 409);
  assert.equal((capped.json as { message: string }).message, 'You have 50 design systems. Delete one to make another.');
  assert.deepEqual(await readdir(tmp.root), ['_systems']);
});

test('POST /systems/:id/build/stop and POST /system-stops/:undoId/undo round trip', async (t) => {
  const { tmp, ctx, call } = await serve(t);
  const systems = ensureSystemStore(ctx);
  const { id } = await systems.create({ name: 'Acme' });
  await systems.withLock(id, () => systems.updateStateLocked(id, (state) => ({ ...state, build: { ticket: null, adoptedAt: '2026-11-20T09:00:00.000Z', appliedSeen: null } })));

  const stopped = await call('POST', `/systems/${id}/build/stop`, { proposalId: 'p_k3m9q2x7' });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.json));
  const { undoId } = stopped.json as StopBuildResponse;
  assert.deepEqual(await readdir(tmp.at('_systems')), []);

  assert.deepEqual((await call('POST', `/system-stops/${undoId}/undo`, {})).json, { id: 'acme' });
  assert.deepEqual(await readdir(tmp.at('_systems')), ['acme']);
  const again = await call('POST', `/system-stops/${undoId}/undo`, {});
  assert.equal(again.status, 404);
  assert.equal((again.json as { message: string }).message, "That build can't be brought back any more.");

  assert.equal((await call('POST', '/systems/gone/build/stop', { proposalId: null })).status, 404);
});
