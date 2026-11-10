// POST /open-request (documentation/specs/phase-1-5-sdk-2-7.md §3.2): a Work Status row or a chat
// block asks the rail to open an existing design. The slug is checked against the pattern before
// any path is built, then resolved through the store (containment); a missing design is 404 with
// a sentence. The request replaces any older one, emits an `open` change event, and the rail's
// `DELETE /open-request` takes it with its intent, exactly once.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { useTmpRoot } from '../helpers/tmp-root.ts';
import { assertError, createChatContext, seedDesign, serveRoutes } from './helpers.ts';

describe('POST /open-request', () => {
  test('leaves a request the rail takes once, with its intent, and emits `open`', async (t) => {
    const tmp = await useTmpRoot(t);
    await seedDesign(tmp, 'pricing-page');
    const ctx = createChatContext(tmp);
    const { call } = await serveRoutes(t, ctx);

    const reply = await call('/open-request', { body: { slug: 'pricing-page', intent: 'comment' } });
    assert.equal(reply.status, 200, JSON.stringify(reply.json));
    assert.deepEqual(reply.json, { ok: true });
    assert.deepEqual(
      ctx.events.map((event) => ({ slug: event.slug, kind: event.kind })),
      [{ slug: 'pricing-page', kind: 'open' }],
    );

    const taken = await call('/open-request', { method: 'DELETE' });
    const request = taken.json.request as { slug: string; intent: string; created: string };
    assert.equal(request.slug, 'pricing-page');
    assert.equal(request.intent, 'comment');
    assert.ok(!Number.isNaN(Date.parse(request.created)));
    assert.deepEqual((await call('/open-request', { method: 'DELETE' })).json, { request: null }, 'taken once');
  });

  test('intent defaults to view; a newer request replaces an untaken older one', async (t) => {
    const tmp = await useTmpRoot(t);
    await seedDesign(tmp, 'first');
    await seedDesign(tmp, 'second');
    const ctx = createChatContext(tmp);
    const { call } = await serveRoutes(t, ctx);
    assert.equal((await call('/open-request', { body: { slug: 'first', intent: 'comment' } })).status, 200);
    assert.equal((await call('/open-request', { body: { slug: 'second' } })).status, 200);
    const request = (await call('/open-request', { method: 'DELETE' })).json.request as { slug: string; intent: string };
    assert.equal(request.slug, 'second');
    assert.equal(request.intent, 'view');
  });

  test('a missing design is 404 with a sentence, and leaves no request and no event', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createChatContext(tmp);
    const { call } = await serveRoutes(t, ctx);
    const reply = await call('/open-request', { body: { slug: 'gone-design' } });
    assertError(reply, 404, 'not-found');
    assert.equal(reply.json.message, 'That design is no longer in your Designs folder.');
    assert.deepEqual((await call('/open-request', { method: 'DELETE' })).json, { request: null });
    assert.deepEqual(ctx.events, []);
  });

  test('slugs that could name a path are refused at the pattern, before the store is asked', async (t) => {
    const tmp = await useTmpRoot(t);
    await seedDesign(tmp, 'real');
    const ctx = createChatContext(tmp);
    let asked = 0;
    const dir = ctx.store.dir.bind(ctx.store);
    ctx.store.dir = async (slug) => {
      asked += 1;
      return dir(slug);
    };
    const { call } = await serveRoutes(t, ctx);
    for (const slug of ['../real', '..', '/etc', 'C:\\Windows', '\\\\server\\share', 'real/../real', 'Real', '', 'a'.repeat(64), '%2e%2e', 'real\u0000']) {
      const reply = await call('/open-request', { body: { slug } });
      assert.equal(reply.status, 400, `slug ${JSON.stringify(slug)}`);
    }
    assert.equal(asked, 0, 'no refused slug reached the store');
    assert.deepEqual(ctx.events, []);
  });

  test('malformed bodies and intents are 400', async (t) => {
    const tmp = await useTmpRoot(t);
    await seedDesign(tmp, 'real');
    const ctx = createChatContext(tmp);
    const { call } = await serveRoutes(t, ctx);
    for (const body of [null, [], 'real', { slug: 3 }, { slug: 'real', intent: 'edit' }, { slug: 'real', intent: 1 }]) {
      const reply = await call('/open-request', { body });
      assert.equal(reply.status, 400, JSON.stringify(body));
    }
    assert.deepEqual((await call('/open-request', { method: 'DELETE' })).json, { request: null });
  });

  test('POST /pages/from-message with open: true leaves a `view` request', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createChatContext(tmp);
    const { call } = await serveRoutes(t, ctx);
    const text = '```html\n<!doctype html><html><head><title>Card</title></head><body>x</body></html>\n```';
    const reply = await call('/pages/from-message', { body: { uploadId: ctx.seedUpload(text), sessionId: 's', sessionTitle: 'Chat', messageId: 'm', directory: null, open: true } });
    assert.equal(reply.status, 200, JSON.stringify(reply.json));
    const request = (await call('/open-request', { method: 'DELETE' })).json.request as { slug: string; intent: string };
    assert.equal(request.slug, reply.json.slug);
    assert.equal(request.intent, 'view');
  });
});
