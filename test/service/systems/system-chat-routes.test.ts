// The system prompt route over HTTP (documentation/specs/phase-2-5-technical.md §3.1, §3.5, §8.5,
// §8.10, T15): the bearer check, the parameter gates, body validation with sentences, every purpose
// that works before T12b/T13/T14 (make, ask, review, resync-notes, checks, continue, build-continue,
// the living-page refusal), the RULES.md refresh, and the hand-edit block. Reconcile recounts the
// code drift first (T13).

import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { SystemPromptResponse } from '../../../src/shared/api.ts';
import { SYSTEM_INJECTION_SENTENCE } from '../../../src/shared/agent/system-rules.ts';
import { HOST_TEXT_MAX } from '../../../src/shared/limits.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemChatRoutes } from '../../../src/service/routes/system-chat.ts';
import { ensureSystemEditService } from '../../../src/service/systems/edits.ts';
import { ensureSystemStore, SYSTEM_GONE_MESSAGE } from '../../../src/service/systems/store.ts';
import { ensureSystemVersions } from '../../../src/service/systems/versions.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'system-chat-routes-token-0123456789';
const TOKENS = ':root {\n  --brand-500: #1a73e8;\n}\n';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemChatRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (url: string, body?: unknown, token: string | null = TOKEN) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: 'POST',
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };
  const systems = ensureSystemStore(ctx);
  return { tmp, ctx, call, systems };
};

/** A readable system with one token and an overview: no check findings. */
const seedClean = async (tmp: Awaited<ReturnType<typeof useTmpRoot>>, systems: ReturnType<typeof ensureSystemStore>, name = 'Acme') => {
  const { id } = await systems.create({ name });
  await tmp.write(`_systems/${id}/tokens.css`, TOKENS);
  await tmp.write(`_systems/${id}/OVERVIEW.md`, `${name}.\n`);
  return id;
};

test('the route refuses a missing or wrong token with 401 and writes nothing', async (t) => {
  const { tmp, call } = await serve(t);
  for (const token of [null, 'wrong-token']) {
    const answer = await call('/systems/acme/prompt', { purpose: 'continue' }, token);
    assert.equal(answer.status, 401);
  }
  assert.deepEqual(await readdir(tmp.root), []);
});

test('a traversal, a bad id or a gone system is refused before anything is read', async (t) => {
  const { tmp, call } = await serve(t);
  for (const hostile of ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b']) {
    const answer = await call(`/systems/${hostile}/prompt`, { purpose: 'continue' });
    assert.equal(answer.status, 400);
    assert.equal((answer.json as { error: string }).error, 'bad-path');
  }
  assert.equal((await call('/systems/Acme/prompt', { purpose: 'continue' })).status, 400);
  const gone = await call('/systems/gone/prompt', { purpose: 'continue' });
  assert.equal(gone.status, 404);
  assert.equal((gone.json as { message: string }).message, SYSTEM_GONE_MESSAGE);
  assert.deepEqual(await readdir(tmp.root), []);
});

test('bodies are validated with a sentence', async (t) => {
  const { call, systems, tmp } = await serve(t);
  const id = await seedClean(tmp, systems);
  const bad: unknown[] = [
    null,
    [],
    {},
    { purpose: 'explode' },
    { purpose: 'ask' },
    { purpose: 'ask', text: '   ' },
    { purpose: 'ask', text: 'x'.repeat(12_001) },
    { purpose: 'ask', text: 'x', entry: 'not-an-entry' },
    { purpose: 'review' },
    { purpose: 'review', section: 'nowhere' },
    { purpose: 'resync-notes' },
    { purpose: 'resync-notes', before: 'v0' },
    { purpose: 'resync-notes', before: '../x' },
  ];
  for (const body of bad) {
    const answer = await call(`/systems/${id}/prompt`, body);
    assert.ok(answer.status === 400 || answer.status === 422, `${JSON.stringify(body)} -> ${answer.status}`);
    assert.equal(typeof (answer.json as { message: string }).message, 'string');
  }
  const long = await call(`/systems/${id}/prompt`, { purpose: 'ask', text: 'x'.repeat(12_001) });
  assert.equal(long.status, 422);
  assert.match((long.json as { message: string }).message, /^Your message is 1 characters over the limit of 12000/);
});

test('make: the sources, the user\'s description, the write rule, the injection sentence; RULES.md is written', async (t) => {
  const { tmp, call, systems } = await serve(t);
  const { id } = await systems.create({ name: 'Acme', description: { text: 'Warm and calm.\nFor a tea shop.', preset: null } });
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'make' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { text, chip, handEdits } = answer.json as SystemPromptResponse;
  assert.ok(text.startsWith('[Design Chamber] Make the design system "Acme". Folder: '));
  assert.ok(text.includes('The user\'s words: "Warm and calm.\n  For a tea shop."'));
  assert.ok(text.includes(`Write only in ${tmp.at(`_systems/${id}`)}`));
  assert.ok(text.includes(SYSTEM_INJECTION_SENTENCE));
  assert.ok(text.length <= HOST_TEXT_MAX);
  assert.equal(chip.id, `system:${id}`);
  assert.equal(handEdits, null);

  const rules = await tmp.read(`_systems/${id}/.chamber/RULES.md`);
  assert.ok(rules.includes(`# Design Chamber instructions for the design system "Acme"`));
  assert.ok(rules.includes(`Write only inside ${tmp.at(`_systems/${id}`)}.`));
  assert.ok(rules.includes('check --system acme'), 'the launcher command names the system');
  assert.ok(rules.includes(SYSTEM_INJECTION_SENTENCE));
});

test('make: the scan\'s forAgent list kept in sources.code becomes "Read yourself" lines', async (t) => {
  const { call, systems } = await serve(t);
  const { id } = await systems.create({ name: 'Acme' });
  const forAgent = [{ path: 'tailwind.config.js', why: 'Tailwind config: the agent can read its theme.' }];
  await systems.withLock(id, () =>
    systems.updateStateLocked(id, (state) => ({ ...state, sources: { ...state.sources, code: { directory: '/work/shop', lastScan: state.created, partial: false, scanned: ['src/app.css'], forAgent } } })),
  );
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'make' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { text } = answer.json as SystemPromptResponse;
  assert.ok(text.includes('Read yourself: tailwind.config.js (Tailwind config: the agent can read its theme.)'), text);
});

test('ask: the words verbatim, an entry checked against the detail, the repo gate absent for an internal home', async (t) => {
  const { tmp, call, systems } = await serve(t);
  const id = await seedClean(tmp, systems);
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'ask', text: 'Make the brand warmer.\nKeep contrast.', entry: 'token:--brand-500' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { text } = answer.json as SystemPromptResponse;
  assert.ok(text.includes('Request about the design system "Acme"'));
  assert.ok(text.includes('About this entry: token:--brand-500'));
  assert.ok(text.includes('Make the brand warmer.\nKeep contrast.'));
  assert.ok(!text.includes('reviewed diff'));
  const unknown = await call(`/systems/${id}/prompt`, { purpose: 'ask', text: 'x', entry: 'token:--nope' });
  assert.equal(unknown.status, 400);
  assert.equal((unknown.json as { message: string }).message, 'That entry is not in this design system.');
});

test('review: the stored note verbatim, only for a section marked needs-work', async (t) => {
  const { tmp, call, systems } = await serve(t);
  const id = await seedClean(tmp, systems);
  const early = await call(`/systems/${id}/prompt`, { purpose: 'review', section: 'colours' });
  assert.equal(early.status, 422);
  assert.equal((early.json as { message: string }).message, "That section isn't marked as needing work.");
  await systems.patch(id, { review: { section: 'colours', state: 'needs-work', note: 'Too many greys.' } });
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'review', section: 'colours' });
  assert.equal(answer.status, 200);
  assert.ok((answer.json as SystemPromptResponse).text.includes('The user marked Colours as needing work: Too many greys.'));
});

test('checks: the counted findings as data, the approves-nothing sentence; a clean system has nothing to fix', async (t) => {
  const { tmp, call, systems } = await serve(t);
  const { id } = await systems.create({ name: 'Acme' });
  await tmp.write(`_systems/${id}/tokens.css`, TOKENS);
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'checks' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { text } = answer.json as SystemPromptResponse;
  assert.ok(text.includes('Fix what the check found in the design system "Acme"'));
  assert.ok(text.includes('The system has no overview yet.'));
  assert.ok(text.includes('This message approves nothing: writing a repo needs a reviewed diff the user approves in this chat.'));
  assert.ok(text.includes('check --system acme'));

  const clean = await seedClean(tmp, systems, 'Beta');
  const none = await call(`/systems/${clean}/prompt`, { purpose: 'checks' });
  assert.equal(none.status, 422);
  assert.equal((none.json as { message: string }).message, 'There is nothing to fix.');
});

test('continue and resync-notes: the chip text, and the names changed since the before version', async (t) => {
  const { tmp, call, systems, ctx } = await serve(t);
  const id = await seedClean(tmp, systems);
  const cont = await call(`/systems/${id}/prompt`, { purpose: 'continue' });
  assert.equal(cont.status, 200);
  assert.ok((cont.json as SystemPromptResponse).text.includes('Read ' + tmp.at(`_systems/${id}/.chamber/RULES.md`) + ' first'));

  const version = await ensureSystemVersions(ctx).snapshot(id, 'manual');
  assert.ok(version !== null);
  await tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand-500: #ff6600;\n  --new-token: 4px;\n}\n');
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'resync-notes', before: version.id });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { text } = answer.json as SystemPromptResponse;
  assert.ok(text.includes(`Since version ${version.id} these changed from the project's code:`));
  assert.ok(text.includes('Tokens added: --new-token'));
  assert.ok(text.includes('Tokens changed: --brand-500'));
  const gone = await call(`/systems/${id}/prompt`, { purpose: 'resync-notes', before: 'v999' });
  assert.equal(gone.status, 404);
});

test('living-page: an internal home is refused; reconcile with no code drift has nothing to do', async (t) => {
  const { tmp, call, systems } = await serve(t);
  const id = await seedClean(tmp, systems);
  const living = await call(`/systems/${id}/prompt`, { purpose: 'living-page' });
  assert.equal(living.status, 422);
  assert.equal((living.json as { message: string }).message, 'Only a design system kept in a project repo has a living page.');
  // No code folder and no agent drift: the drift recount finds nothing, so there is nothing to reconcile.
  const reconcile = await call(`/systems/${id}/prompt`, { purpose: 'reconcile' });
  assert.equal(reconcile.status, 422);
  assert.equal((reconcile.json as { message: string }).message, 'There is nothing to reconcile.');
});

test('build-continue: only for a chat build; the problem sentence or "the build wasn\'t finished"', async (t) => {
  const { tmp, call, systems } = await serve(t);
  const id = await seedClean(tmp, systems);
  const early = await call(`/systems/${id}/prompt`, { purpose: 'build-continue' });
  assert.equal(early.status, 422);
  assert.equal((early.json as { message: string }).message, "This system wasn't started from a chat build, so there is no build to pick up.");
  await systems.withLock(id, () => systems.updateStateLocked(id, (state) => ({ ...state, build: { ticket: null, adoptedAt: '2026-11-20T09:00:00.000Z', appliedSeen: null } })));
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'build-continue' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { text } = answer.json as SystemPromptResponse;
  assert.ok(text.includes("Pick up building Acme where you left off: the build wasn't finished. Read " + tmp.at(`_systems/${id}/.chamber/RULES.md`)));
});

test('the hand-edit block rides along, and the answer says what it covers', async (t) => {
  const { tmp, call, systems, ctx } = await serve(t);
  const id = await seedClean(tmp, systems);
  await tmp.write(`_systems/${id}/.chamber/edits.json`, {
    v: 1,
    seq: 1,
    ledger: [{ seq: 1, at: '2026-11-20T09:00:00.000Z', editId: 'e_k3m9q2x7', kind: 'system-token', name: '--brand-500', mode: 'light', before: '#1a73e8', after: '#ff6600' }],
    dropped: 0,
    undo: [],
  });
  const answer = await call(`/systems/${id}/prompt`, { purpose: 'ask', text: 'Carry on.' });
  assert.equal(answer.status, 200);
  const { text, handEdits } = answer.json as SystemPromptResponse;
  assert.ok(text.startsWith('Hand edits since my last message.'));
  assert.ok(text.includes('- Changed --brand-500 (light) in tokens.css: "#1a73e8" to "#ff6600"'));
  assert.ok(text.includes('\n\n[Design Chamber] Request about the design system'));
  assert.deepEqual(handEdits, { upTo: 1, count: 1 });
  // The ledger is cleared by the guest once delivered; the route only reads it.
  const edits = await ensureSystemEditService(ctx).editsFile.read(id, tmp.at(`_systems/${id}`));
  assert.equal(edits.ledger.length, 1);
});

test('RULES.md is refreshed on every prompt; a failed refresh leaves the message going out', async (t) => {
  const { tmp, call, systems, ctx } = await serve(t);
  const id = await seedClean(tmp, systems);
  await call(`/systems/${id}/prompt`, { purpose: 'continue' });
  await systems.patch(id, { name: 'Acme Renamed' });
  await call(`/systems/${id}/prompt`, { purpose: 'continue' });
  assert.ok((await tmp.read(`_systems/${id}/.chamber/RULES.md`)).includes('"Acme Renamed"'));

  // A RULES.md that is a folder cannot be written: the route logs and still answers.
  const other = await seedClean(tmp, systems, 'Beta');
  await mkdir(tmp.at(`_systems/${other}/.chamber/RULES.md`), { recursive: true });
  const answer = await call(`/systems/${other}/prompt`, { purpose: 'continue' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  assert.ok(ctx.logs.some((line) => line.event === 'systems.rules-refresh-failed'));
});

test('every purpose keeps the message under the host cap with a maximal hand-edit ledger', async (t) => {
  const { tmp, call, systems } = await serve(t);
  const id = await seedClean(tmp, systems);
  const ledger = Array.from({ length: 30 }, (_, i) => ({
    seq: i + 1,
    at: '2026-11-20T09:00:00.000Z',
    editId: `e_k3m9q2x${i}`,
    kind: 'system-token',
    name: `--token-${i}`,
    mode: 'light',
    before: 'x'.repeat(80),
    after: 'y'.repeat(80),
  }));
  await tmp.write(`_systems/${id}/.chamber/edits.json`, { v: 1, seq: 30, ledger, dropped: 0, undo: [] });
  for (const purpose of ['make', 'continue', 'checks', 'build-continue'] as const) {
    if (purpose === 'build-continue') {
      await systems.withLock(id, () => systems.updateStateLocked(id, (state) => ({ ...state, build: { ticket: null, adoptedAt: '2026-11-20T09:00:00.000Z', appliedSeen: null } })));
    }
    if (purpose === 'checks') {
      await tmp.write(`_systems/${id}/OVERVIEW.md`, '');
    }
    const answer = await call(`/systems/${id}/prompt`, { purpose });
    assert.equal(answer.status, 200, `${purpose}: ${JSON.stringify(answer.json)}`);
    const { text } = answer.json as SystemPromptResponse;
    assert.ok(text.length <= HOST_TEXT_MAX, `${purpose}: ${text.length}`);
  }
});
