// A design's system over HTTP (documentation/specs/phase-2-5-technical.md §3.2, §5.4, §6.4, §2.9):
// the bearer check and the slug gate on every route, body validation with sentences, view →
// preview → set → update, Reset to system (`token-reset`) with its Undo, `GET /designs` naming
// each design's system, and `POST /chip { system }` linking at creation.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { DesignListResponse, DesignSystemActionResponse, DesignSystemView, EditResponse, SystemPreviewResponse } from '../../../src/shared/api.ts';
import type { ServiceContext } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerChatRoutes } from '../../../src/service/routes/chat.ts';
import { registerDesignSystemRoutes } from '../../../src/service/routes/design-system.ts';
import { registerDesignsRoutes } from '../../../src/service/routes/designs.ts';
import { registerEditRoutes } from '../../../src/service/routes/edits.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { TOKEN_RESET_STALE_MESSAGE } from '../../../src/service/edits/ops-tokens-reset.ts';
import { STALE_MESSAGES } from '../../../src/service/edits/pipeline.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'link-routes-token-0123456789';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const SYSTEM_TOKENS = ':root {\n  --brand-500: #1a73e8;\n  --space-4: 16px;\n}\n';
const DESIGN_TOKENS = ':root {\n  --brand-500: tomato;\n  --space-4: 20px;\n  --own-gap: 3px;\n}\n.card {\n  --brand-500: navy;\n}\n';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const fake = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => fake.dispose());
  const ctx: ServiceContext = Object.assign(fake, { store: createDesignStore({ settings: fake.settings, log: fake.log, hub: fake.hub }) });
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerDesignSystemRoutes(router, ctx);
  registerDesignsRoutes(router, ctx);
  registerChatRoutes(router, ctx);
  registerEditRoutes(router, ctx);
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
  const systems = ensureSystemStore(ctx);
  const { id } = await systems.create({ name: 'Acme' });
  await tmp.write(`_systems/${id}/tokens.css`, SYSTEM_TOKENS);
  await tmp.write(`_systems/${id}/OVERVIEW.md`, 'Acme.\n');
  await systems.patch(id, { status: 'ready' });
  const design = await ctx.store.create({ kind: 'page', title: 'Checkout', html: '<link rel="stylesheet" href="system/system.css"><link rel="stylesheet" href="tokens.css"><p>Hi</p>' });
  await tmp.write(`${design.slug}/tokens.css`, DESIGN_TOKENS);
  return { tmp, ctx, call, id, slug: design.slug, systems };
};

test('every design-system route refuses a missing or wrong token with 401 and changes nothing', async (t) => {
  const { tmp, call, slug, id } = await serve(t);
  const routes: [string, string, unknown?][] = [
    ['GET', `/designs/${slug}/system`],
    ['GET', `/designs/${slug}/system/preview?to=${id}`],
    ['POST', `/designs/${slug}/system`, { action: 'set', to: id, stamp: `${'a'.repeat(64)}:${'b'.repeat(64)}` }],
    ['POST', `/designs/${slug}/edits`, { op: 'token-reset', base: sha(DESIGN_TOKENS), names: ['--brand-500'] }],
  ];
  for (const [method, url, body] of routes) {
    for (const token of [null, 'wrong-token']) {
      const answer = await call(method, url, body, token);
      assert.equal(answer.status, 401, `${method} ${url} ${String(token)}`);
    }
  }
  assert.equal(await lstat(tmp.at(`${slug}/system`)).catch(() => null), null);
  assert.equal(await tmp.read(`${slug}/tokens.css`), DESIGN_TOKENS);
});

test('a traversal or invalid slug is refused before any path is built', async (t) => {
  const { call, id } = await serve(t);
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b']) {
    for (const [method, url] of [['GET', `/designs/${hostile}/system`], ['GET', `/designs/${hostile}/system/preview?to=${id}`], ['POST', `/designs/${hostile}/system`]] as const) {
      const answer = await call(method, url, method === 'POST' ? { action: 'set', to: id, stamp: `${'a'.repeat(64)}:${'b'.repeat(64)}` } : undefined);
      assert.equal(answer.status, 400, `${method} ${url}`);
    }
  }
  for (const bad of ['Checkout', '_systems', '.chamber']) {
    const answer = await call('GET', `/designs/${bad}/system`);
    assert.equal(answer.status, 400, bad);
  }
  assert.equal((await call('GET', '/designs/nobody/system')).status, 404);
});

test('bodies and queries are validated with a sentence; nothing is written', async (t) => {
  const { tmp, call, slug } = await serve(t);
  const stamp = `${'a'.repeat(64)}:${'b'.repeat(64)}`;
  for (const body of [null, [], {}, { action: 'set', to: 'Acme', stamp }, { action: 'set', to: '../x', stamp }, { action: 'set', to: 'acme' }, { action: 'set', to: 'acme', stamp: 'x' }, { action: 'update', toRevision: 0, stamp }, { action: 'move', stamp }]) {
    const answer = await call('POST', `/designs/${slug}/system`, body);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.equal((answer.json as { message: string }).message, "Design Chamber couldn't read that change. Nothing was changed.");
  }
  assert.equal((await call('GET', `/designs/${slug}/system/preview`)).status, 400);
  assert.equal((await call('GET', `/designs/${slug}/system/preview?to=..%2Fx`)).status, 400);
  // An update without a copy says why.
  const view = (await call('GET', `/designs/${slug}/system`)).json as DesignSystemView;
  const update = await call('POST', `/designs/${slug}/system`, { action: 'update', toRevision: 1, stamp: view.stamp });
  assert.equal(update.status, 422);
  assert.equal((update.json as { message: string }).message, 'This design has no design system to update.');
  assert.equal(await lstat(tmp.at(`${slug}/system`)).catch(() => null), null);
});

test('view → preview → set → update over HTTP; GET /designs names the system and its update', async (t) => {
  const { tmp, call, slug, id, systems } = await serve(t);
  const before = (await call('GET', `/designs/${slug}/system`)).json as DesignSystemView;
  assert.deepEqual(before.status, { state: 'unset' });
  assert.equal(before.link, null);

  const preview = (await call('GET', `/designs/${slug}/system/preview?to=${id}`)).json as SystemPreviewResponse;
  assert.deepEqual(preview.tokens.added.sort(), ['--brand-500', '--space-4']);
  assert.deepEqual(preview.overrides.sort(), ['--brand-500', '--space-4']);
  assert.equal(preview.ownTokens, 1);
  assert.equal(preview.stamp, before.stamp);

  const set = await call('POST', `/designs/${slug}/system`, { action: 'set', to: id, stamp: before.stamp });
  assert.equal(set.status, 200);
  const answer = set.json as DesignSystemActionResponse;
  assert.equal(answer.notice, 'linked');
  assert.ok(answer.before !== null);

  // Reusing the old stamp is stale.
  const stale = await call('POST', `/designs/${slug}/system`, { action: 'set', to: 'none', stamp: before.stamp });
  assert.equal(stale.status, 409);
  assert.equal((stale.json as { error: string }).error, 'stale');

  const view = (await call('GET', `/designs/${slug}/system`)).json as DesignSystemView;
  assert.deepEqual(view.status, { state: 'linked', id, name: 'Acme', linkState: 'ok' });
  assert.equal(view.link?.id, id);
  assert.equal(view.link?.before, answer.before.id);
  assert.equal(typeof view.link?.fileCount, 'number');
  assert.equal(Object.hasOwn(view.link ?? {}, 'files'), false);
  assert.deepEqual(view.overrides.map((one) => one.name).sort(), ['--brand-500', '--space-4']);

  let list = (await call('GET', '/designs')).json as DesignListResponse;
  assert.deepEqual(list.designs.find((one) => one.slug === slug)?.system, { id, name: 'Acme', revision: view.link?.revision, state: 'ok', updateAvailable: false });

  // The system moves on: the list offers the update, and update brings it in.
  await tmp.write(`_systems/${id}/tokens.css`, SYSTEM_TOKENS.replace('16px', '18px'));
  await systems.settleRevision(id);
  const revision = (await systems.readState(id)).revision.n;
  const now = (await call('GET', `/designs/${slug}/system`)).json as DesignSystemView;
  assert.equal(now.updateAvailable, true);
  assert.equal(now.systemRevision, revision);
  // The list reads the systems index, refreshed shortly after a system event.
  for (let tries = 0; tries < 50; tries += 1) {
    list = (await call('GET', '/designs')).json as DesignListResponse;
    if (list.designs.find((one) => one.slug === slug)?.system?.updateAvailable === true) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(list.designs.find((one) => one.slug === slug)?.system?.updateAvailable, true);
  const updated = await call('POST', `/designs/${slug}/system`, { action: 'update', toRevision: revision, stamp: now.stamp });
  assert.equal(updated.status, 200);
  assert.equal((updated.json as DesignSystemActionResponse).notice, 'updated');
  assert.match(await tmp.read(`${slug}/system/tokens.css`), /18px/);
  assert.equal(await tmp.read(`${slug}/tokens.css`), DESIGN_TOKENS, "the design's own tokens.css is never touched by an update");
});

test('Reset to system removes only the light and dark overrides, with an Undo; a name that is no override is stale', async (t) => {
  const { tmp, call, slug, id } = await serve(t);
  const view = (await call('GET', `/designs/${slug}/system`)).json as DesignSystemView;
  await call('POST', `/designs/${slug}/system`, { action: 'set', to: id, stamp: view.stamp });

  // Not an override: the design's own token.
  const own = await call('POST', `/designs/${slug}/edits`, { op: 'token-reset', base: sha(DESIGN_TOKENS), names: ['--own-gap'] });
  assert.equal(own.status, 409);
  assert.equal((own.json as { message: string }).message, TOKEN_RESET_STALE_MESSAGE);
  assert.equal(STALE_MESSAGES['token-reset'], TOKEN_RESET_STALE_MESSAGE);
  // A stale base.
  assert.equal((await call('POST', `/designs/${slug}/edits`, { op: 'token-reset', base: sha('other'), names: ['--brand-500'] })).status, 409);
  // A bad shape.
  for (const names of [[], ['brand'], ['--a', '--a'], Array.from({ length: 201 }, (_, n) => `--t${n}`)]) {
    assert.equal((await call('POST', `/designs/${slug}/edits`, { op: 'token-reset', base: sha(DESIGN_TOKENS), names })).status, 400, JSON.stringify(names).slice(0, 40));
  }

  const reset = await call('POST', `/designs/${slug}/edits`, { op: 'token-reset', base: sha(DESIGN_TOKENS), names: ['--brand-500'] });
  assert.equal(reset.status, 200);
  const edit = reset.json as EditResponse;
  assert.equal(edit.edit.label, 'Reset --brand-500 to Acme');
  assert.equal(edit.edit.undoable, true);
  assert.ok(edit.version !== null);
  const after = await tmp.read(`${slug}/tokens.css`);
  assert.equal(after, ':root {\n  --space-4: 20px;\n  --own-gap: 3px;\n}\n.card {\n  --brand-500: navy;\n}\n', 'component styling in .card stays');

  const undo = await call('POST', `/designs/${slug}/edits/${edit.edit.id}/undo`, {});
  assert.equal(undo.status, 200);
  assert.equal(await tmp.read(`${slug}/tokens.css`), DESIGN_TOKENS);
});

test('POST /chip { system } links the new design at creation; none and ask are recorded; a Draft pick is refused', async (t) => {
  const { tmp, call, id, systems } = await serve(t);
  const linked = await call('POST', '/chip', { kind: 'page', brief: 'A pricing page', system: id });
  assert.equal(linked.status, 200);
  const slug = (linked.json as { slug: string }).slug;
  const copy = JSON.parse(await tmp.read(`${slug}/system/COPY.json`));
  assert.equal(copy.by, 'creation');
  assert.equal(copy.before, null);

  const none = (await call('POST', '/chip', { kind: 'page', brief: 'Another page', system: 'none' })).json as { slug: string };
  const ask = (await call('POST', '/chip', { kind: 'canvas', brief: 'A canvas', system: 'ask' })).json as { slug: string };
  const noneState = JSON.parse(await tmp.read(`${none.slug}/.chamber/state.json`));
  const askState = JSON.parse(await tmp.read(`${ask.slug}/.chamber/state.json`));
  assert.equal(noneState.systemDecision, 'none');
  assert.equal(askState.systemDecision, 'ask');
  // The service-owned decision is never mirrored into design.json.
  assert.equal(Object.hasOwn(JSON.parse(await tmp.read(`${none.slug}/design.json`)), 'systemDecision'), false);

  assert.equal((await call('POST', '/chip', { kind: 'page', brief: 'x', system: '../acme' })).status, 400);
  await systems.patch(id, { status: 'draft' });
  const draft = await call('POST', '/chip', { kind: 'page', brief: 'Draft pick', system: id });
  assert.equal(draft.status, 422);
  assert.equal((draft.json as { message: string }).message, 'Acme is a draft, so it can\'t be used for designs yet.');
  // With no Ready system and nothing chosen, a new design is exactly as before (no decision recorded).
  const plain = (await call('POST', '/chip', { kind: 'page', brief: 'Plain page' })).json as { slug: string };
  assert.equal(Object.hasOwn(JSON.parse(await tmp.read(`${plain.slug}/.chamber/state.json`)), 'systemDecision'), false);
});
