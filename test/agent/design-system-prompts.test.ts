// The design restyle and system-update prompts over HTTP (documentation/specs/phase-2-5-technical.md
// §3.2, §8.5, T15): the names and the changed lists are read from the before version's copy and the
// live copy, never from the request; the bearer check, the version gate and the graceful refusals.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { DesignSystemActionResponse, PromptResponse } from '../../src/shared/api.ts';
import type { ServiceContext } from '../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../src/service/http.ts';
import { registerChatRoutes } from '../../src/service/routes/chat.ts';
import { registerDesignSystemRoutes } from '../../src/service/routes/design-system.ts';
import { createDesignStore } from '../../src/service/store.ts';
import { LINK_NO_COPY_MESSAGE } from '../../src/service/systems/link.ts';
import { ensureSystemStore } from '../../src/service/systems/store.ts';
import { ensureVersionsService } from '../../src/service/versions.ts';
import { createFakeContext } from '../helpers/fake-context.ts';
import { useTmpRoot } from '../helpers/tmp-root.ts';

const TOKEN = 'design-system-prompts-token-0123456789';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const SYSTEM_TOKENS = ':root {\n  --brand-500: #1a73e8;\n}\n';
const DESIGN_TOKENS = ':root {\n  --brand-500: tomato;\n}\n';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const fake = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => fake.dispose());
  const ctx: ServiceContext = Object.assign(fake, { store: createDesignStore({ settings: fake.settings, log: fake.log, hub: fake.hub }) });
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerChatRoutes(router, ctx);
  registerDesignSystemRoutes(router, ctx);
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
  const makeSystem = async (name: string, tokens: string): Promise<string> => {
    const { id } = await systems.create({ name });
    await tmp.write(`_systems/${id}/tokens.css`, tokens);
    await tmp.write(`_systems/${id}/OVERVIEW.md`, `${name}.\n`);
    await systems.patch(id, { status: 'ready' });
    return id;
  };
  const acme = await makeSystem('Acme', SYSTEM_TOKENS);
  const design = await ctx.store.create({ kind: 'page', title: 'Checkout', html: '<p>Hi</p>' });
  await tmp.write(`${design.slug}/tokens.css`, DESIGN_TOKENS);
  const stampNow = async (): Promise<string> => {
    const copy = await tmp.read(`${design.slug}/system/COPY.json`).catch(() => '');
    return `${sha(copy)}:${sha(DESIGN_TOKENS)}`;
  };
  const link = async (to: string): Promise<DesignSystemActionResponse> => {
    const answer = await call('POST', `/designs/${design.slug}/system`, { action: 'set', to, stamp: await stampNow() });
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    return answer.json as DesignSystemActionResponse;
  };
  const update = async (toRevision: number): Promise<DesignSystemActionResponse> => {
    const answer = await call('POST', `/designs/${design.slug}/system`, { action: 'update', toRevision, stamp: await stampNow() });
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    return answer.json as DesignSystemActionResponse;
  };
  const prompt = (body: unknown, token: string | null = TOKEN) => call('POST', `/designs/${design.slug}/prompt`, body, token);
  return { tmp, ctx, call, prompt, link, update, makeSystem, systems, acme, slug: design.slug };
};

test('the prompt route refuses a missing or wrong token for the new purposes', async (t) => {
  const { prompt } = await serve(t);
  for (const purpose of ['restyle', 'system-update']) {
    for (const token of [null, 'wrong-token']) {
      const answer = await prompt({ purpose, before: 'v1' }, token);
      assert.equal(answer.status, 401, `${purpose} ${String(token)}`);
    }
  }
});

test('the before version is required and must exist; a bad purpose is still refused', async (t) => {
  const { prompt, link, acme } = await serve(t);
  for (const body of [{ purpose: 'restyle' }, { purpose: 'restyle', before: 'x' }, { purpose: 'system-update', before: 'v0' }, { purpose: 'restyle', before: '../x' }, { purpose: 'explode' }]) {
    const answer = await prompt(body);
    assert.equal(answer.status, 400, JSON.stringify(body));
  }
  await link(acme);
  const gone = await prompt({ purpose: 'restyle', before: 'v999' });
  assert.equal(gone.status, 404);
  assert.equal((gone.json as { message: string }).message, 'That version does not exist any more.');
});

test('restyle: the names come from the two copies, never from the request', async (t) => {
  const { prompt, link, makeSystem, acme, slug, tmp } = await serve(t);
  const first = await link(acme);
  assert.ok(first.before !== null, 'the link took a version first');
  const answer = await prompt({ purpose: 'restyle', before: first.before.id, to: 'Injected', from: 'Also injected' });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { text, handEdits } = answer.json as PromptResponse;
  assert.ok(text.startsWith(`[Design Chamber] This page now uses the design system "Acme" (before: none). Folder: ${tmp.at(slug)}. Rules: ${tmp.at(`${slug}/.chamber/RULES.md`)}`));
  assert.ok(text.includes("Restyle it with the new system's tokens."));
  assert.ok(!text.includes('Injected'));
  assert.equal(handEdits, null);

  // A switch between two systems: the before version holds the old copy.
  const old = await makeSystem('Old system', ':root {\n  --brand-500: navy;\n}\n');
  await link(old);
  const switched = await link(acme);
  assert.ok(switched.before !== null);
  const between = await prompt({ purpose: 'restyle', before: switched.before.id });
  assert.equal(between.status, 200);
  assert.ok((between.json as PromptResponse).text.includes('now uses the design system "Acme" instead of "Old system"'));

  // Removing the system: the live copy is gone, the before version still names it.
  const removed = await link('none');
  assert.ok(removed.before !== null);
  const off = await prompt({ purpose: 'restyle', before: removed.before.id });
  assert.equal(off.status, 200);
  assert.ok((off.json as PromptResponse).text.includes('This page no longer uses a design system (before: "Acme").'));
});

test('restyle with no change on either side is refused gracefully', async (t) => {
  const { prompt, ctx, slug } = await serve(t);
  const snapshot = await ensureVersionsService(ctx).snapshot(slug, 'manual');
  assert.ok(snapshot !== null);
  const answer = await prompt({ purpose: 'restyle', before: snapshot.id });
  assert.equal(answer.status, 422);
  assert.equal((answer.json as { message: string }).message, "This design's design system didn't change.");
});

test('system-update: the changed tokens and components between the two copies, with the new revision', async (t) => {
  const { tmp, prompt, link, update, systems, acme, slug } = await serve(t);
  await link(acme);
  // The system gains a token and a component; its revision settles to 2.
  await tmp.write(`_systems/${acme}/tokens.css`, ':root {\n  --brand-500: #ff6600;\n  --new-token: 4px;\n}\n');
  await tmp.write(`_systems/${acme}/system.json`, { version: 1, tokens: {}, components: [{ id: 'button', name: 'Button', purpose: 'Actions' }] });
  await systems.settleRevision(acme);
  const revision = (await systems.readState(acme)).revision.n;
  const updated = await update(revision);
  assert.ok(updated.before !== null);
  assert.equal(updated.notice, 'updated');
  const result = await prompt({ purpose: 'system-update', before: updated.before.id });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const { text } = result.json as PromptResponse;
  assert.ok(text.includes(`The design system "Acme" used by the page "Checkout" was updated to revision ${revision}.`));
  assert.ok(text.includes('Tokens added: --new-token'));
  assert.ok(text.includes('Tokens changed: --brand-500'));
  assert.ok(text.includes('Components added: button'));
  assert.ok(text.includes("Apply what needs HTML work; keep this design's overrides in tokens.css."));
  assert.ok(text.includes(`Read ${tmp.at(`${slug}/system/OVERVIEW.md`)} first.`));
});

test('system-update refusals: no live copy, or nothing changed between the copies', async (t) => {
  const { prompt, ctx, slug, link, acme } = await serve(t);
  const noCopy = await ensureVersionsService(ctx).snapshot(slug, 'manual');
  assert.ok(noCopy !== null);
  const none = await prompt({ purpose: 'system-update', before: noCopy.id });
  assert.equal(none.status, 422);
  assert.equal((none.json as { message: string }).message, LINK_NO_COPY_MESSAGE);

  await link(acme);
  const same = await ensureVersionsService(ctx).snapshot(slug, 'manual');
  assert.ok(same !== null);
  const unchanged = await prompt({ purpose: 'system-update', before: same.id });
  assert.equal(unchanged.status, 422);
  assert.equal((unchanged.json as { message: string }).message, 'Nothing changed between the two copies; the design is already up to date.');
});
