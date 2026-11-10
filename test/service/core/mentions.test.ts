// POST /mentions/search and /mentions/resolve (documentation/specs/phase-1-5-sdk-2-7.md §U6.3):
// bearer auth, search from memory only, resolve through the real store with the folder contained,
// and the 400 / 404 answers. The real WP1 modules over a tmp root, served through the real router.

import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { HOST_TEXT_MAX } from '../../../src/shared/limits.ts';
import type { MentionsResolveResponse, MentionsSearchResponse } from '../../../src/shared/api.ts';
import type { DesignSummary } from '../../../src/shared/types.ts';
import { unavailable, type DesignIndex, type DesignStore, type ServiceContext } from '../../../src/service/context.ts';
import { createDesignIndex } from '../../../src/service/design-index.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerMentionsRoutes } from '../../../src/service/routes/mentions.ts';
import { createCore, TEST_TOKEN, type Core } from './harness.ts';

type Served = { core: Core; ctx: ServiceContext; call(pathname: string, body: unknown, token?: string | null): Promise<Response> };

/** The mentions routes over `core`'s real store and a design index fed by it (or `overrides`). */
const serve = async (t: TestContext, overrides: Partial<ServiceContext> = {}): Promise<Served> => {
  const core = await createCore(t);
  const designIndex = createDesignIndex({ store: core.store, hub: core.ctx.hub, log: core.ctx.log });
  const ctx: ServiceContext = { ...core.ctx, designIndex, ...overrides };
  t.after(async () => {
    await designIndex.dispose();
    await core.stop();
  });
  const router = createRouter({ token: TEST_TOKEN, log: ctx.log });
  registerMentionsRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call: Served['call'] = (pathname, body, token = TEST_TOKEN) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { core, ctx, call };
};

const errorOf = async (answer: Response): Promise<{ error: string; message: string }> => (await answer.json()) as { error: string; message: string };

const anchor = { selector: 'main > h1', text: 'Plans for every roast', html: '<h1>', rect: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 0.5, y: 0.5 } };

describe('auth', () => {
  test('both routes refuse a missing or wrong token with 401, before any work', async (t) => {
    // A store and an index that throw on any use: a handler that ran would not answer 401.
    const { call } = await serve(t, { store: unavailable<DesignStore>('store'), designIndex: unavailable<DesignIndex>('index') });
    for (const [pathname, body] of [
      ['/mentions/search', { query: 'p', directory: null }],
      ['/mentions/resolve', { id: 'pricing' }],
    ] as const) {
      for (const token of [null, 'wrong'] as const) {
        const answer = await call(pathname, body, token);
        assert.equal(answer.status, 401, `${pathname} token=${String(token)}`);
        assert.equal((await errorOf(answer)).error, 'unauthorized');
      }
    }
  });
});

describe('search', () => {
  test('answers from the index in memory: the store is never asked, and a row has an id, a title and a subtitle but no url', async (t) => {
    const summary = (slug: string, over: Partial<DesignSummary>): DesignSummary => ({
      slug,
      kind: 'canvas',
      title: slug,
      created: '2026-11-01T10:00:00.000Z',
      updated: '2026-11-01T10:00:00.000Z',
      pending: false,
      screenCount: 4,
      viewports: [],
      sessionId: null,
      projectDirectory: null,
      openComments: 2,
      thumb: { state: 'unavailable', key: null },
      warnings: [],
      ...over,
    });
    const designs = [summary('pricing', { title: 'Pricing page' }), summary('about', { title: 'About us' })];
    const index: DesignIndex = {
      all: () => designs,
      get: (slug) => designs.find((design) => design.slug === slug) ?? null,
      bySession: () => [],
      ready: async () => true,
      dispose: async () => undefined,
    };
    const { call } = await serve(t, { designIndex: index, store: unavailable<DesignStore>('store') });
    const answer = await call('/mentions/search', { query: 'pri', directory: null });
    assert.equal(answer.status, 200);
    const { items } = (await answer.json()) as MentionsSearchResponse;
    assert.deepEqual(items, [{ id: 'pricing', title: 'Pricing page', subtitle: 'Canvas · 4 screens · 2 open comments' }]);
  });

  test('never more than 20 rows, and a cold index answers an empty list instead of waiting past its budget', async (t) => {
    const many = Array.from({ length: 50 }, (_, i): DesignSummary => ({
      slug: `d-${i}`,
      kind: 'page',
      title: `Design ${i}`,
      created: '2026-11-01T10:00:00.000Z',
      updated: '2026-11-01T10:00:00.000Z',
      pending: false,
      screenCount: 0,
      viewports: [],
      sessionId: null,
      projectDirectory: null,
      openComments: 0,
      thumb: { state: 'unavailable', key: null },
      warnings: [],
    }));
    const warm: DesignIndex = { all: () => many, get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined };
    const first = await serve(t, { designIndex: warm });
    const { items } = (await (await first.call('/mentions/search', { query: '', directory: '/work' })).json()) as MentionsSearchResponse;
    assert.equal(items.length, 20);

    const cold: DesignIndex = { ...warm, all: () => many, ready: async () => false };
    const second = await serve(t, { designIndex: cold });
    const empty = (await (await second.call('/mentions/search', { query: 'design', directory: null })).json()) as MentionsSearchResponse;
    assert.deepEqual(empty, { items: [] });
  });

  test('bad bodies are 400', async (t) => {
    const { call } = await serve(t);
    for (const body of [{}, { query: 5 }, { query: 'a', directory: 5 }, [], 'nope']) {
      const answer = await call('/mentions/search', body);
      assert.equal(answer.status, 400, JSON.stringify(body));
    }
  });
});

describe('resolve', () => {
  const traversal = ['../x', '..', '../../etc/passwd', '..%2fx', '%2e%2e%2fx', 'a/b', 'a\\b', '..\\x', 'C:\\Windows', 'C:', '/etc/passwd', 'A', 'a b', '.chamber', '', 'a'.repeat(64)];

  test('an id that is not a design folder name is 400 and never reaches the store', async (t) => {
    const { call } = await serve(t, { store: unavailable<DesignStore>('store') });
    for (const id of traversal) {
      const answer = await call('/mentions/resolve', { id });
      assert.equal(answer.status, 400, JSON.stringify(id));
      assert.equal((await errorOf(answer)).error, 'bad-request');
    }
    for (const body of [{}, { id: 5 }, { id: null }, [], 'nope']) assert.equal((await call('/mentions/resolve', body)).status, 400, JSON.stringify(body));
  });

  test('a design that is not there is 404 with the sentence the host shows', async (t) => {
    const { call } = await serve(t);
    const answer = await call('/mentions/resolve', { id: 'never-existed' });
    assert.equal(answer.status, 404);
    assert.deepEqual(await errorOf(answer), { error: 'not-found', message: 'That design is no longer in your Designs folder.' });
  });

  test('a design deleted between the search and the pick is 404', async (t) => {
    const { call, core } = await serve(t);
    const record = await core.store.create({ kind: 'page', title: 'Short lived', html: '<!doctype html><h1>Hi</h1>' });
    assert.equal((await call('/mentions/resolve', { id: record.slug })).status, 200);
    await core.store.trash(record.slug);
    assert.equal((await call('/mentions/resolve', { id: record.slug })).status, 404);
  });

  test('a folder that is a link pointing outside the root is not a design: 404, nothing read', async (t) => {
    const { call, core } = await serve(t);
    const outside = core.tmp.at('outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'design.json'), '{"title":"Secret"}');
    await writeFile(path.join(outside, 'index.html'), '<h1>secret</h1>');
    try {
      await symlink(outside, path.join(core.root, 'sneaky'), 'dir');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return t.skip('symlinks need a privilege on this machine');
      throw error;
    }
    const answer = await call('/mentions/resolve', { id: 'sneaky' });
    assert.equal(answer.status, 404);
    assert.ok(!JSON.stringify(await errorOf(answer)).includes('Secret'));
  });

  test('a page: folder, files that exist, viewports, no rules file, checks, no comments', async (t) => {
    const { call, core } = await serve(t);
    const record = await core.store.create({ kind: 'page', title: 'Landing', html: '<!doctype html><title>x</title><h1>Hi</h1>' });
    await writeFile(path.join(record.path, 'tokens.css'), ':root{--a:1}');
    const answer = await call('/mentions/resolve', { id: record.slug });
    assert.equal(answer.status, 200);
    const { text } = (await answer.json()) as MentionsResolveResponse;
    assert.ok(text.startsWith(`Design "Landing" (page) from Design Chamber. Its folder: ${record.path}\n`), text);
    assert.ok(text.includes('Files: design.json, index.html, tokens.css\n'), text);
    assert.ok(text.includes('Viewports: '));
    assert.ok(text.includes('Use the design-chamber skill for the design rules.'));
    assert.ok(/\nChecks: .*Run design_check before you say it is done\./.test(text), text);
    assert.ok(!text.includes('Open comments'));
    assert.ok(/\nRead at \d\d:\d\d\./.test(text));
    assert.ok(text.length <= HOST_TEXT_MAX);
  });

  test('with a rules file and open comments: the rules path, the comments, and a symlinked tokens.css is not listed', async (t) => {
    const { call, core } = await serve(t);
    const record = await core.store.create({ kind: 'page', title: 'Shop', html: '<!doctype html><h1>Hi</h1>' });
    await mkdir(path.join(record.path, '.chamber'), { recursive: true });
    await writeFile(path.join(record.path, '.chamber', 'RULES.md'), '# rules');
    const outside = core.tmp.at('elsewhere.css');
    await writeFile(outside, 'a{}');
    try {
      await symlink(outside, path.join(record.path, 'tokens.css'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
    const viewport = record.design.viewports[0]?.id ?? 'laptop';
    await core.store.addComment(record.slug, { screen: null, viewport, anchor, body: 'Make the headline shorter' });
    const { text } = (await (await call('/mentions/resolve', { id: record.slug })).json()) as MentionsResolveResponse;
    assert.ok(text.includes(`Rules for this design: ${path.join(record.path, '.chamber', 'RULES.md')}`), text);
    assert.ok(text.includes('Open comments from the user'));
    assert.ok(text.includes('Make the headline shorter'));
    assert.ok(!text.includes('tokens.css'), text);
  });

  test('many long comments: the text stays under the cap and says how many are left in Design Chamber', async (t) => {
    const { call, core } = await serve(t);
    const record = await core.store.create({ kind: 'page', title: 'Busy', html: '<!doctype html><h1>Hi</h1>' });
    const viewport = record.design.viewports[0]?.id ?? 'laptop';
    for (let i = 0; i < 30; i += 1) await core.store.addComment(record.slug, { screen: null, viewport, anchor, body: `${i}: ${'long '.repeat(180)}` });
    const { text } = (await (await call('/mentions/resolve', { id: record.slug })).json()) as MentionsResolveResponse;
    assert.ok(text.length <= HOST_TEXT_MAX, `${text.length} characters`);
    assert.ok(/and \d+ more open comments in Design Chamber\./.test(text), text);
    assert.ok(text.includes('→ 29: long'));
    assert.ok(text.includes(record.path));
  });

  test('a removed folder under a live root is 404, not a 500', async (t) => {
    const { call, core } = await serve(t);
    const record = await core.store.create({ kind: 'page', title: 'Gone soon', html: '<!doctype html><h1>Hi</h1>' });
    await rm(record.path, { recursive: true, force: true });
    assert.equal((await call('/mentions/resolve', { id: record.slug })).status, 404);
  });
});
