// The T17 routes over HTTP (documentation/specs/phase-2-5-technical.md §3.5, §5.14, §5.11): the proposal read
// (a proposalId that fails its pattern is 400, an unrecorded one `unknown`), the living-page render of the
// staged page and the preview with its chunks bound to their system, and the preview board over `proposal/`
// (`?proposal=`). Every route refuses a missing or wrong token and an encoded separator in a path parameter.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { ProposalResponse, RenderMeta } from '../../../src/shared/api.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemBoardRoutes } from '../../../src/service/routes/system-board.ts';
import { registerSystemBuildRoutes } from '../../../src/service/routes/system-build.ts';
import { BOARD_NO_PROPOSAL_MESSAGE } from '../../../src/service/systems/board.ts';
import { LIVING_RENDER_MISSING, LIVING_RENDER_STALE, livingPagesIdle } from '../../../src/service/systems/living-page.ts';
import { ensureProposals } from '../../../src/service/systems/proposals.ts';
import { refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { proposalJson, setupRepo, type RepoRig } from './repo-fixture.ts';

const TOKEN = 'proposals-routes-token-0123456789abcdef';
const P1 = 'p_aaaa1111';
const ZERO = '0'.repeat(64);

type Rig = RepoRig & {
  call(url: string, token?: string | null): Promise<{ status: number; body: unknown; text: string }>;
  id: string;
  /** A refreshed repo system with a settled proposal and its `proposal/` folder. */
  propose(): Promise<void>;
  /** Every chunk of a render, joined. */
  whole(prefix: string, meta: RenderMeta): Promise<string>;
};

const setup = async (t: TestContext): Promise<Rig> => {
  const rig = await setupRepo(t);
  const router = createRouter({ token: TOKEN, log: rig.ctx.log });
  registerSystemBuildRoutes(router, rig.ctx);
  registerSystemBoardRoutes(router, rig.ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  t.after(() => livingPagesIdle(rig.ctx));
  const { port } = server.address() as AddressInfo;
  const id = await rig.repoSystem();
  const dir = await rig.systems.dir(id);
  const inSystem = (rel: string): string => path.relative(rig.tmp.root, path.join(dir, ...rel.split('/')));
  const call: Rig['call'] = async (url, token = TOKEN) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });
    const text = await answer.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
    return { status: answer.status, body, text };
  };
  return {
    ...rig,
    call,
    id,
    async propose() {
      assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
      await livingPagesIdle(rig.ctx);
      await rig.tmp.write(inSystem('proposal/tokens.css'), ':root {\n  --brand-500: #0b57d0;\n}\n');
      await rig.tmp.write(inSystem('proposal/system.json'), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
      await rig.tmp.write(inSystem('PROPOSAL.json'), `${JSON.stringify(proposalJson(P1), null, 2)}\n`);
      const proposals = ensureProposals(rig.ctx);
      await proposals.settle(id);
      await proposals.idle();
      await livingPagesIdle(rig.ctx);
    },
    async whole(prefix, meta) {
      let out = '';
      for (let n = 0; n < meta.chunks; n += 1) {
        const chunk = await call(`${prefix}?key=${meta.key}&n=${n}`);
        assert.equal(chunk.status, 200, chunk.text);
        out += chunk.text;
      }
      return out;
    },
  };
};

const ROUTES = (id: string): string[] => [
  `/systems/${id}/proposals/${P1}`,
  `/systems/${id}/living-page/render?which=staged&scheme=light`,
  `/systems/${id}/living-page/render/chunk?key=${ZERO}&n=0`,
  `/systems/${id}/board?proposal=${P1}`,
];

test('every T17 route refuses a missing or wrong token, and a traversal in the id', async (t) => {
  const rig = await setup(t);
  for (const url of ROUTES(rig.id)) {
    for (const token of [null, 'wrong-token']) {
      const answer = await rig.call(url, token);
      assert.equal(answer.status, 401, `${url} ${String(token)}`);
      assert.equal((answer.body as { error: string }).error, 'unauthorized');
    }
  }
  for (const hostile of ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b']) {
    for (const url of ROUTES(hostile)) {
      const answer = await rig.call(url);
      assert.equal(answer.status, 400, `${url}`);
      assert.equal((answer.body as { error: string }).error, 'bad-path', url);
    }
  }
  // A plain id that names no system.
  for (const url of ROUTES('ghost')) assert.equal((await rig.call(url)).status, 404, url);
});

test('the proposal read: a bad id is 400, an unrecorded one unknown, the current one in full', async (t) => {
  const rig = await setup(t);
  for (const bad of ['p_short', 'P_AAAA1111', 'x', `p_${'a'.repeat(17)}`]) {
    const answer = await rig.call(`/systems/${rig.id}/proposals/${bad}`);
    assert.equal(answer.status, 400, bad);
    assert.equal((answer.body as { error: string }).error, 'bad-request');
  }
  assert.deepEqual((await rig.call(`/systems/${rig.id}/proposals/${P1}`)).body, { state: 'unknown' });
  await rig.propose();
  const answer = await rig.call(`/systems/${rig.id}/proposals/${P1}`);
  assert.equal(answer.status, 200);
  const view = answer.body as ProposalResponse;
  assert.equal(view.state, 'current');
  if (view.state !== 'current') return;
  assert.equal(view.proposal.id, P1);
  assert.match(view.sha16, /^[0-9a-f]{16}$/);
  assert.deepEqual(view.preview, { board: true, livingPage: 'ready', sentence: null });
  // The home as the system page shows it (its directory is how the guest finds the project's name).
  assert.deepEqual(view.proposal.home.kind === 'repo' ? [view.proposal.home.label, view.proposal.home.folder] : null, ['shop', 'design-system']);
});

test('the living-page render: staged and preview, chunks bound to their system, the query checked', async (t) => {
  const rig = await setup(t);
  const render = (which: string, scheme = 'light') => rig.call(`/systems/${rig.id}/living-page/render?which=${which}&scheme=${scheme}`);
  assert.equal((await render('staged')).status, 404, 'nothing staged before the first refresh');
  assert.equal(((await render('staged')).body as { message: string }).message, LIVING_RENDER_MISSING);
  for (const which of ['', 'committed', '..%2Fx']) assert.equal((await render(which)).status, 400, which);
  assert.equal((await render('staged', 'sepia')).status, 400);

  await rig.propose();
  const chunkUrl = `/systems/${rig.id}/living-page/render/chunk`;
  const staged = await render('staged');
  assert.equal(staged.status, 200, staged.text);
  const stagedMeta = staged.body as RenderMeta;
  const stagedHtml = await rig.whole(chunkUrl, stagedMeta);
  assert.equal(Buffer.byteLength(stagedHtml), stagedMeta.bytes);
  assert.ok(!stagedHtml.includes('lp-preview'));

  const preview = await render('preview', 'dark');
  assert.equal(preview.status, 200, preview.text);
  const previewMeta = preview.body as RenderMeta;
  assert.notEqual(previewMeta.key, stagedMeta.key);
  const previewHtml = await rig.whole(chunkUrl, previewMeta);
  assert.ok(previewHtml.includes(`Preview of proposal ${P1}`));
  assert.ok(previewHtml.includes('#0b57d0'));
  assert.ok(!previewHtml.includes(rig.base), 'no local path');

  // The chunk query: the key's shape, the number's shape, its range.
  for (const query of ['key=nothex&n=0', `key=${previewMeta.key}&n=-1`, `key=${previewMeta.key}&n=1e3`, `key=${previewMeta.key}`, `key=${previewMeta.key}&n=${previewMeta.chunks}`]) {
    assert.equal((await rig.call(`${chunkUrl}?${query}`)).status, 400, query);
  }
  // An unknown key is stale; so is this system's key asked through another system's id.
  const unknown = await rig.call(`${chunkUrl}?key=${ZERO}&n=0`);
  assert.deepEqual([unknown.status, (unknown.body as { message: string }).message], [409, LIVING_RENDER_STALE]);
  const other = await rig.repoSystem('Other');
  const crossed = await rig.call(`/systems/${other}/living-page/render/chunk?key=${previewMeta.key}&n=0`);
  assert.equal(crossed.status, 409);
});

test('the preview board renders proposal/, only for the proposal waiting, never with a version', async (t) => {
  const rig = await setup(t);
  const board = (query: string) => rig.call(`/systems/${rig.id}/board?${query}`);
  assert.equal((await board(`proposal=${P1}`)).status, 404, 'no proposal yet');
  await rig.propose();
  const answer = await board(`proposal=${P1}&scheme=light`);
  assert.equal(answer.status, 200, answer.text);
  const html = await rig.whole(`/systems/${rig.id}/board/chunk`, answer.body as RenderMeta);
  assert.ok(html.includes('#0b57d0'), 'the proposed tokens');
  const live = await rig.whole(`/systems/${rig.id}/board/chunk`, (await board('scheme=light')).body as RenderMeta);
  assert.ok(!live.includes('#0b57d0'), 'the live board is the snapshot');

  // A changed proposal/ file draws again, not from the cache.
  await rig.tmp.write(path.relative(rig.tmp.root, path.join(await rig.systems.dir(rig.id), 'proposal', 'tokens.css')), ':root {\n  --brand-500: #174ea6;\n}\n');
  const again = await rig.whole(`/systems/${rig.id}/board/chunk`, (await board(`proposal=${P1}&scheme=light`)).body as RenderMeta);
  assert.ok(again.includes('#174ea6'));

  const other = await board('proposal=p_bbbb2222');
  assert.deepEqual([other.status, (other.body as { message: string }).message], [404, BOARD_NO_PROPOSAL_MESSAGE]);
  assert.equal((await board('proposal=p_bad')).status, 400);
  assert.equal((await board(`proposal=${P1}&version=v1`)).status, 400);
});
