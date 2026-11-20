// The living page of a repo-backed system (documentation/specs/phase-2-5-technical.md §5.11, §5.14, §2.14,
// AD-30..32, T14): a refresh stages a safe page and its record, a secret shape keeps a public page out of
// staging, fonts are embedded only for dev access or the user's switch, omissions are recorded, the
// committed page's state follows the repo, the preview has its band, and no local path or token leaks.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { LivingPageView } from '../../../src/shared/types.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { configureLivingExamples } from '../../../src/service/systems/living-examples.ts';
import { FONTS_EMBEDDED_LINE, FONTS_FALLBACK_LINE } from '../../../src/service/systems/living-html.ts';
import {
  dropLivingPages,
  LIVING_CHANGED_SENTENCE,
  livingFreshSentence,
  livingMissingSentence,
  livingOutOfDateSentence,
  livingPagesIdle,
  livingPageState,
  parseLivingRecord,
  regenerateLivingPage,
  startLivingPages,
  type LivingPageRecord,
} from '../../../src/service/systems/living-page.ts';
import { scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { createFakeBrowser } from './fake-cdp.ts';
import { setupRepo, SYSTEM_JSON, type RepoRig } from './repo-fixture.ts';

const TOKEN = 'living-page-bearer-token-0123456789abcdef';
// Built from parts so no file in the repo holds a whole key shape.
const AWS_KEY = `${'AKIA'}${'QWERTYUI'}${'23456789'}`;
const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(60, 7)]);

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');
const escaped = (text: string): string => text.replace(/'/g, '&#39;');

type Rig = RepoRig & {
  call: (method: string, url: string, body?: unknown) => Promise<{ status: number; json: unknown }>;
  staged: (id: string) => Promise<string | null>;
  preview: (id: string) => Promise<string | null>;
  record: (id: string) => Promise<LivingPageRecord | null>;
  refresh: (id: string) => Promise<void>;
  buildJson: (id: string, access: 'dev' | 'public' | null) => Promise<void>;
};

const setup = async (t: TestContext): Promise<Rig> => {
  const rig = await setupRepo(t);
  const router = createRouter({ token: TOKEN, log: rig.ctx.log });
  registerSystemsRoutes(router, rig.ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  t.after(() => livingPagesIdle(rig.ctx));
  // As the service start does: the store's detail reads the committed page's state (no system yet, so the sweep is empty).
  await startLivingPages(rig.ctx)();
  const { port } = server.address() as AddressInfo;
  const chamber = async (id: string, name: string): Promise<string | null> => readFile(path.join(await rig.systems.dir(id), '.chamber', name), 'utf8').catch(() => null);
  return {
    ...rig,
    call: async (method, url, body) => {
      const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: answer.status, json: (await answer.json()) as unknown };
    },
    staged: (id) => chamber(id, 'living-page.html'),
    preview: (id) => chamber(id, 'living-page-preview.html'),
    record: async (id) => {
      const text = await chamber(id, 'living-page.json');
      return text === null ? null : parseLivingRecord(text);
    },
    refresh: async (id) => {
      assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
      await livingPagesIdle(rig.ctx);
    },
    buildJson: async (id, access) => {
      const body = {
        version: 1,
        ticket: null,
        name: 'Acme',
        home: 'repo',
        repo: { directory: rig.project, folder: 'design-system', livingPage: 'design-system/index.html' },
        code: null,
        mode: 'none',
        dark: true,
        calls: [],
        access,
        round: 'done',
        applied: null,
        proposal: null,
        drift: null,
      };
      await writeFile(path.join(await rig.systems.dir(id), 'BUILD.json'), `${JSON.stringify(body, null, 2)}\n`);
    },
  };
};

/** The repo's system.json with fonts and a type style naming them. */
const withFonts = async (rig: Rig): Promise<void> => {
  const json = JSON.parse(SYSTEM_JSON) as Record<string, unknown>;
  await rig.tmp.write('shop/design-system/assets/fonts/inter.woff2', WOFF2);
  await rig.tmp.write(
    'shop/design-system/system.json',
    `${JSON.stringify({ ...json, fonts: [{ file: 'assets/fonts/inter.woff2', family: 'Inter', weight: 400 }], type: [{ id: 'body', name: 'Body', family: 'Inter, sans-serif', size: '16px' }] }, null, 2)}\n`,
  );
};

const noLeaks = (rig: Rig, ...texts: (string | null)[]): void => {
  for (const text of texts) {
    if (text === null) continue;
    assert.ok(!text.includes(rig.base), 'no local path');
    assert.ok(!text.includes(rig.root), 'no designs root');
    assert.ok(!text.includes(TOKEN), 'no bearer token');
  }
  const logs = JSON.stringify(rig.ctx.logs);
  assert.ok(!logs.includes(TOKEN));
  assert.ok(!logs.includes(AWS_KEY));
};

test('a refresh stages a safe, marked page and its record; the committed page has its own state', async (t) => {
  const rig = await setup(t);
  const id = await rig.repoSystem();
  await rig.refresh(id);

  const html = await rig.staged(id);
  assert.ok(html !== null);
  const scan = scanLivingPage(html);
  assert.deepEqual(scan.reasons, []);
  const state = await rig.systems.readState(id);
  assert.equal(scan.mark?.system, id);
  assert.equal(scan.mark?.revision, state.revision.n);
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('src="data:image/svg+xml'), 'the logo is inlined');
  assert.ok(!html.includes('assets/logos/'), 'no relative reference is left');

  const record = await rig.record(id);
  assert.ok(record !== null);
  assert.equal(record.revision, state.revision.n);
  assert.equal(record.sha256, sha256(html));
  assert.equal(record.bytes, Buffer.byteLength(html, 'utf8'));
  assert.equal(record.problem, null);
  assert.equal(record.fonts, 'fallback');
  assert.deepEqual(record.secrets, []);
  // Light and dark are both left out; the record names the example once.
  assert.deepEqual(record.omitted, [{ what: 'example', name: 'Button', reason: 'no-browser' }]);
  noLeaks(rig, html, JSON.stringify(record));

  // The repo's own index.html has no mark: it differs from the generated one.
  const before = (await rig.call('GET', `/systems/${id}/living-page`)).json as Extract<LivingPageView, { home: 'repo' }>;
  assert.equal(before.home, 'repo');
  assert.equal(before.path, 'design-system/index.html');
  assert.equal(before.staged?.revision, state.revision.n);
  assert.equal(before.embedFonts, false);
  assert.ok(['changed', 'unsafe'].includes(before.committed.state), before.committed.state);

  await rm(rig.repo('design-system/index.html'));
  const missing = await livingPageState(rig.ctx, id);
  assert.equal(missing.home === 'repo' ? missing.committed.sentence : null, livingMissingSentence('shop'));

  // Committed as staged: fresh. Then the system moves on: out of date.
  await copyFile(path.join(await rig.systems.dir(id), '.chamber', 'living-page.html'), rig.repo('design-system/index.html'));
  const fresh = await livingPageState(rig.ctx, id);
  assert.deepEqual(fresh.home === 'repo' ? fresh.committed : null, { state: 'fresh', revision: state.revision.n, sentence: livingFreshSentence(state.revision.n), reasons: [] });
  const detail = await rig.systems.detail(id);
  assert.equal(detail.livingPage?.state, 'fresh');

  await rig.tmp.write('shop/design-system/tokens.css', ':root {\n  --brand-500: #0b57d0;\n  --space-2: 8px;\n}\n');
  await rig.refresh(id);
  const next = (await rig.systems.readState(id)).revision.n;
  assert.ok(next > state.revision.n);
  // The committed page is the repo's own file, so it is now a revision behind.
  const later = await livingPageState(rig.ctx, id);
  assert.ok(later.home === 'repo');
  assert.equal(later.committed.state, 'out-of-date');
  assert.equal(later.committed.sentence, livingOutOfDateSentence(state.revision.n, 'Acme', next));
  assert.equal(later.staged?.revision, next);

  // An edit to the committed page at an old revision reads as changed.
  await writeFile(rig.repo('design-system/index.html'), (await readFile(rig.repo('design-system/index.html'), 'utf8')).replace('Acme in one paragraph.', 'Acme, edited.'));
  const changed = await livingPageState(rig.ctx, id);
  assert.equal(changed.home === 'repo' ? changed.committed.sentence : null, LIVING_CHANGED_SENTENCE);
});

test('a secret shape keeps a public page out of staging; a dev page is staged with the finding', async (t) => {
  const rig = await setup(t);
  await rig.tmp.write('shop/design-system/notes/history.md', `We rotated ${AWS_KEY} last week.\n`);
  const id = await rig.repoSystem();
  await rig.buildJson(id, 'public');
  await rig.refresh(id);

  assert.equal(await rig.staged(id), null);
  const blocked = await rig.record(id);
  assert.equal(blocked?.problem, 'secret');
  assert.deepEqual(blocked?.secrets, [{ kind: 'aws-key', where: 'note:history' }]);
  const view = await livingPageState(rig.ctx, id);
  assert.ok(view.home === 'repo');
  assert.equal(view.staged?.problem, 'secret');
  assert.ok(!JSON.stringify(view).includes(AWS_KEY));

  await rig.buildJson(id, null);
  await regenerateLivingPage(rig.ctx, id, { source: 'snapshot' });
  assert.equal(await rig.staged(id), null, 'unknown access is treated as public');

  await rig.buildJson(id, 'dev');
  await regenerateLivingPage(rig.ctx, id, { source: 'snapshot' });
  const staged = await rig.staged(id);
  assert.ok(staged !== null && staged.includes(AWS_KEY));
  const dev = await rig.record(id);
  assert.equal(dev?.problem, null);
  assert.deepEqual(dev?.secrets, [{ kind: 'aws-key', where: 'note:history' }]);
  assert.ok(!(await readFile(path.join(await rig.systems.dir(id), '.chamber', 'living-page.json'), 'utf8')).includes(AWS_KEY));
  noLeaks(rig, JSON.stringify(dev));
});

test('fonts are embedded only for dev access or the switch; the footer says which either way', async (t) => {
  const rig = await setup(t);
  await withFonts(rig);
  const id = await rig.repoSystem();
  await rig.refresh(id);

  const fallback = await rig.staged(id);
  assert.ok(fallback !== null);
  assert.ok(fallback.includes(escaped(FONTS_FALLBACK_LINE)));
  assert.ok(!fallback.includes('@font-face') && !fallback.includes('data:font/'));
  const first = await rig.record(id);
  assert.equal(first?.fonts, 'fallback');
  assert.ok(first?.omitted.some((item) => item.what === 'font' && item.name === 'Inter' && item.reason === 'licence'));

  // The switch, through the route: it regenerates without being asked again.
  const patched = await rig.call('PATCH', `/systems/${id}`, { livingPage: { embedFonts: true } });
  assert.equal(patched.status, 200);
  await livingPagesIdle(rig.ctx);
  const embedded = await rig.staged(id);
  assert.ok(embedded !== null);
  assert.ok(embedded.includes(FONTS_EMBEDDED_LINE));
  assert.ok(embedded.includes(`@font-face { font-family: "Inter"; src: url("data:font/woff2;base64,${WOFF2.toString('base64')}")`));
  assert.deepEqual(scanLivingPage(embedded).reasons, []);
  assert.equal((await rig.record(id))?.fonts, 'embedded');
  const view = (await rig.call('GET', `/systems/${id}/living-page`)).json as Extract<LivingPageView, { home: 'repo' }>;
  assert.equal(view.embedFonts, true);
  assert.equal(view.staged?.fonts, 'embedded');

  // Off again; then dev access embeds with the switch off.
  await rig.call('PATCH', `/systems/${id}`, { livingPage: { embedFonts: false } });
  await livingPagesIdle(rig.ctx);
  assert.equal((await rig.record(id))?.fonts, 'fallback');
  await rig.buildJson(id, 'dev');
  await regenerateLivingPage(rig.ctx, id, { source: 'snapshot' });
  assert.equal((await rig.record(id))?.fonts, 'embedded');
  assert.ok((await rig.staged(id))?.includes(FONTS_EMBEDDED_LINE));
});

test('a logo over the asset bound is left out and recorded; the page is still staged', async (t) => {
  const rig = await setup(t);
  await rig.tmp.write('shop/design-system/assets/logos/acme.svg', `<svg xmlns="http://www.w3.org/2000/svg"><desc>${'x'.repeat(4 * 1024 * 1024 + 10)}</desc></svg>`);
  const id = await rig.repoSystem();
  await rig.refresh(id);
  const html = await rig.staged(id);
  assert.ok(html !== null);
  assert.ok(!html.includes('data:image/svg+xml'));
  assert.deepEqual(scanLivingPage(html).reasons, []);
  assert.ok((await rig.record(id))?.omitted.some((item) => item.what === 'logo' && item.name === 'acme.svg' && item.reason === 'too-large'));
});

test('with the example pictures cached, a regeneration gives the same bytes without a browser', async (t) => {
  const rig = await setup(t);
  const id = await rig.repoSystem();
  const browser = createFakeBrowser();
  configureLivingExamples(rig.ctx, { openBrowser: browser.open, settleMs: 0 });
  await rig.refresh(id);
  const first = await rig.staged(id);
  assert.ok(first !== null && first.includes('src="data:image/png;base64,'));
  assert.ok(browser.opened > 0);
  assert.deepEqual((await rig.record(id))?.omitted, []);

  configureLivingExamples(rig.ctx, { openBrowser: null });
  await regenerateLivingPage(rig.ctx, id, { source: 'snapshot' });
  assert.equal(await rig.staged(id), first);
  assert.deepEqual((await rig.record(id))?.omitted, []);
});

test('regenerations of one system are coalesced: one runs, one waits', async (t) => {
  const rig = await setup(t);
  const id = await rig.repoSystem();
  await rig.refresh(id);
  const runs = [1, 2, 3, 4].map(() => regenerateLivingPage(rig.ctx, id, { source: 'snapshot' }));
  assert.equal(runs[1], runs[2]);
  assert.equal(runs[2], runs[3]);
  await Promise.all(runs);
  assert.ok((await rig.staged(id)) !== null);
});

test('no snapshot yet: the record says so and nothing is staged', async (t) => {
  const rig = await setup(t);
  const id = await rig.repoSystem();
  await regenerateLivingPage(rig.ctx, id, { source: 'snapshot' });
  assert.equal(await rig.staged(id), null);
  assert.equal((await rig.record(id))?.problem, 'no-snapshot');
});

test('a system kept in Design Chamber has no living page', async (t) => {
  const rig = await setup(t);
  const { id } = await rig.systems.create({ name: 'Inside' });
  await regenerateLivingPage(rig.ctx, id, { source: 'snapshot' });
  assert.equal(await rig.record(id), null);
  assert.deepEqual(await livingPageState(rig.ctx, id), { home: 'internal' });
  assert.deepEqual((await rig.call('GET', `/systems/${id}/living-page`)).json, { home: 'internal' });
  assert.equal((await rig.call('PATCH', `/systems/${id}`, { livingPage: { embedFonts: true } })).status, 422);
});

test('a home change drops the staged page, the preview and the record', async (t) => {
  const rig = await setup(t);
  const id = await rig.repoSystem();
  await rig.refresh(id);
  assert.ok((await rig.staged(id)) !== null);
  await dropLivingPages(rig.ctx, id);
  assert.equal(await rig.staged(id), null);
  assert.equal(await rig.record(id), null);
});

test('the service start regenerates a page whose record is missing', async (t) => {
  const rig = await setup(t);
  const id = await rig.repoSystem();
  await rig.refresh(id);
  await rm(path.join(await rig.systems.dir(id), '.chamber', 'living-page.json'));
  await rm(path.join(await rig.systems.dir(id), '.chamber', 'living-page.html'));
  const stop = startLivingPages(rig.ctx);
  t.after(stop);
  // The sweep runs in the background; wait (bounded) for its regeneration to land.
  for (let tries = 0; tries < 200 && (await rig.record(id)) === null; tries += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  await livingPagesIdle(rig.ctx);
  assert.ok((await rig.staged(id)) !== null);
  assert.equal((await rig.record(id))?.revision, (await rig.systems.readState(id)).revision.n);
});

test('a proposal preview has the band and no mark; one with a secret shape is never written', async (t) => {
  const rig = await setup(t);
  const id = await rig.repoSystem();
  await rig.refresh(id);
  const dir = await rig.systems.dir(id);
  await rig.tmp.write(path.relative(rig.tmp.root, path.join(dir, 'PROPOSAL.json')), { id: 'p_abcd1234' });
  const proposal = (rel: string, text: string): Promise<string> => rig.tmp.write(path.relative(rig.tmp.root, path.join(dir, 'proposal', ...rel.split('/'))), text);
  await proposal('tokens.css', ':root {\n  --brand-500: #0b57d0;\n}\n');
  await proposal('system.json', `${JSON.stringify({ version: 1, notes: [{ id: 'history', title: 'History' }] }, null, 2)}\n`);
  await proposal('notes/history.md', 'A new blue.\n');
  await regenerateLivingPage(rig.ctx, id, { source: 'proposal' });

  const preview = await rig.preview(id);
  assert.ok(preview !== null);
  assert.ok(preview.includes('<p class="lp-preview" role="note">Preview of proposal p_abcd1234 · not generated from shop yet</p>'));
  const scan = scanLivingPage(preview);
  assert.deepEqual(scan.reasons, []);
  assert.equal(scan.mark, null);
  const record = await rig.record(id);
  assert.deepEqual(record?.preview, { proposal: 'p_abcd1234', sha256: sha256(preview), problem: null });
  assert.equal(record?.problem, null, 'the staged page part is kept');
  noLeaks(rig, preview);

  await rig.buildJson(id, 'dev');
  await proposal('notes/history.md', `A new blue. ${AWS_KEY}\n`);
  await regenerateLivingPage(rig.ctx, id, { source: 'proposal' });
  assert.equal(await rig.preview(id), null);
  assert.deepEqual((await rig.record(id))?.preview, { proposal: 'p_abcd1234', sha256: null, problem: 'secret' });
});
