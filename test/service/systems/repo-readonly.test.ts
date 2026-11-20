// AD-18 (documentation/specs/phase-2-5-technical.md §5.13): the service never writes a project repo.
// Every step a repo-backed system goes through runs between two fingerprints of the repo (each file's
// bytes, mode and mtime, each folder's listing), and the two must match: adoption, the code scan,
// the snapshot refresh, the living page, the state routes, a proposal (settle, preview, the T17 routes,
// the approval and the landed compare), example pictures drawn by a fake browser, a stop and its Undo,
// a user re-sync with a re-point, a link and the delete.

import assert from 'node:assert/strict';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';

import type { CreateSystemScanResponse, StopBuildResponse, SystemScanResponse } from '../../../src/shared/api.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemBoardRoutes } from '../../../src/service/routes/system-board.ts';
import { registerSystemBuildRoutes } from '../../../src/service/routes/system-build.ts';
import { registerSystemEditRoutes } from '../../../src/service/routes/system-edits.ts';
import { registerSystemScanRoutes } from '../../../src/service/routes/system-scans.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { ensureBuildTickets } from '../../../src/service/systems/builds.ts';
import { runBuildScan } from '../../../src/service/systems/drift.ts';
import { ensureScanJobs } from '../../../src/service/systems/extract.ts';
import { createHomes } from '../../../src/service/systems/homes.ts';
import { configureLivingExamples } from '../../../src/service/systems/living-examples.ts';
import { createLinkService } from '../../../src/service/systems/link.ts';
import { livingPagesIdle, regenerateLivingPage } from '../../../src/service/systems/living-page.ts';
import { ensureProposals } from '../../../src/service/systems/proposals.ts';
import { clearRecoverySnapshot, refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { createSystemStore } from '../../../src/service/systems/store.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { createFakeBrowser } from './fake-cdp.ts';
import { fingerprintTree, proposalJson, setupRepo } from './repo-fixture.ts';

const TOKEN = 'repo-readonly-token-0123456789ab';

test('no step of a repo-backed system changes a byte, mode, mtime or listing of the repo', async (t) => {
  const rig = await setupRepo(t);
  const { ctx, systems, project } = rig;
  // A second copy of the repo, for the re-point; made before any step, so it is fingerprinted too.
  const moved = path.join(rig.base, 'shop-moved');
  await cp(project, moved, { recursive: true, preserveTimestamps: true });
  await writeFile(path.join(moved, 'design-system', 'OVERVIEW.md'), 'Acme, from its new home.\n');

  const repos = [project, moved];
  const steps: string[] = [];
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    const before = await Promise.all(repos.map((dir) => fingerprintTree(dir)));
    await run();
    const after = await Promise.all(repos.map((dir) => fingerprintTree(dir)));
    assert.deepEqual(after, before, `${name} left the repo exactly as it was`);
    steps.push(name);
  };

  ensureScanJobs(ctx);
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerSystemScanRoutes(router, ctx);
  registerSystemEditRoutes(router, ctx);
  registerSystemBuildRoutes(router, ctx);
  registerSystemBoardRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };

  // Adoption (the living page goes where no file is yet: one in place refuses it), with the real snapshot refresh and build scan behind it.
  const tickets = ensureBuildTickets(ctx);
  const homes = createHomes({
    systems,
    tickets,
    settings: ctx.settings,
    hub: ctx.hub,
    log: ctx.log,
    snapshots: { refresh: async (id, options) => void (await refreshSnapshot(ctx, id, options)), clear: (id) => clearRecoverySnapshot(ctx, id) },
    scans: { build: (id, directory) => runBuildScan(ctx, id, directory) },
    proposals: ensureProposals(ctx),
  });
  t.after(() => homes.stop());
  const { ticket } = (await tickets.issue({ projectDirectory: project, sessionId: 'ses_build', rulesFor: () => '# rules\n' })).ticket;
  const id = 'acme';
  const writeBuildOf = async (system: string, name: string, buildTicket: string, over: Record<string, unknown>): Promise<void> => {
    const build = { version: 1, ticket: buildTicket, name, home: 'repo', repo: { directory: project, folder: 'design-system', livingPage: 'docs/design-system.html' }, code: { directory: project }, mode: 'fix', ...over };
    await rig.tmp.write(`Designs/_systems/${system}/BUILD.json`, `${JSON.stringify(build, null, 2)}\n`);
    await homes.reconcile(system);
    await homes.idle();
  };
  const writeBuild = (over: Record<string, unknown>): Promise<void> => writeBuildOf(id, 'Acme', ticket, over);
  await step('adoption', async () => {
    await writeBuild({});
  });
  const adopted = await systems.readState(id);
  assert.equal(adopted.home?.kind, 'repo');

  await step('code scan', () => runBuildScan(ctx, id, project));
  assert.notEqual((await systems.readState(id)).sources.code?.lastScan ?? null, null, 'the code was scanned');
  // The agent's applied stamp makes the service read the repo (§5.10), then a direct refresh.
  await step('snapshot refresh', async () => {
    await writeBuild({ applied: { at: '2026-11-20T11:00:00.000Z', parts: ['system-files'], skipped: [] } });
    assert.notEqual((await systems.readState(id)).snapshot ?? null, null, 'the stamp read the repo');
    await writeFile(path.join(rig.base, 'unrelated.txt'), 'a change outside the repo\n');
    await refreshSnapshot(ctx, id, { by: 'agent' });
  });
  await step('living-page generation', async () => {
    await regenerateLivingPage(ctx, id, { source: 'snapshot' });
  });
  await step('state routes', async () => {
    assert.equal((await call('GET', `/systems/${id}`)).status, 200);
    await call('GET', `/systems/${id}/living-page`);
    assert.equal((await call('GET', '/systems')).status, 200);
  });

  await step('proposal, preview and approval', async () => {
    const dir = await systems.dir(id);
    const inSystem = (rel: string): string => path.relative(rig.tmp.root, path.join(dir, ...rel.split('/')));
    await rig.tmp.write(inSystem('proposal/tokens.css'), ':root {\n  --brand-500: #0b57d0;\n}\n');
    await rig.tmp.write(inSystem('proposal/notes/palette.md'), 'A darker blue.\n');
    const parts = [
      { name: 'system-files', files: [{ path: 'design-system/notes/palette.md', change: 'create', summary: 'Why the blue.', added: 1, removed: 0, from: 'proposal/notes/palette.md' }] },
      { name: 'living-page', files: [{ path: 'docs/design-system.html', change: 'create', summary: 'The page.', added: 1, removed: 0 }] },
    ];
    await rig.tmp.write(inSystem('PROPOSAL.json'), `${JSON.stringify(proposalJson('p_aaaa1111', { parts }), null, 2)}\n`);
    const proposals = ensureProposals(ctx);
    await proposals.settle(id);
    await proposals.idle();
    await livingPagesIdle(ctx);
    assert.equal((await call('GET', `/systems/${id}/proposals/p_aaaa1111`)).status, 200);
    const preview = await call('GET', `/systems/${id}/living-page/render?which=preview&scheme=light`);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.equal((await call('GET', `/systems/${id}/board?proposal=p_aaaa1111&scheme=light`)).status, 200);
    await writeBuild({ round: 'done', applied: { at: '2026-11-20T12:00:00.000Z', parts: ['system-files', 'living-page'], skipped: [] }, proposal: 'p_aaaa1111' });
    await livingPagesIdle(ctx);
    const state = await systems.readState(id);
    assert.equal(state.build?.approved?.proposal, 'p_aaaa1111');
    // Nothing was written to the repo (the agent never applied it), and the compare says so.
    assert.deepEqual([state.landed?.differ, state.landed?.unclaimed], [['notes/palette.md'], ['system-files', 'living-page']]);
  });

  await step('example pictures with a fake browser', async () => {
    const fake = createFakeBrowser();
    configureLivingExamples(ctx, { openBrowser: fake.open, settleMs: 0 });
    try {
      await regenerateLivingPage(ctx, id, { source: 'snapshot' });
      await regenerateLivingPage(ctx, id, { source: 'proposal' });
      await livingPagesIdle(ctx);
    } finally {
      configureLivingExamples(ctx, { openBrowser: null });
    }
    assert.ok(fake.opened > 0, 'the fake browser was started');
    assert.ok(fake.served.length > 0, 'an example was served to the browser');
    const cache = path.join(await systems.dir(id), '.chamber', 'living-examples');
    assert.ok((await readdir(cache)).some((name) => name.endsWith('.png')), 'the pictures were cached in the system, not the repo');
  });

  await step('stop with a waiting proposal, and its Undo', async () => {
    // A second build on the same repo (its own folder, so no overlap with Acme), adopted but not yet applied: the only kind a stop takes.
    const second = (await tickets.issue({ projectDirectory: project, sessionId: 'ses_build_2', rulesFor: () => '# rules\n' })).ticket.ticket;
    const other = 'beacon';
    await writeBuildOf(other, 'Beacon', second, { round: 2, repo: { directory: project, folder: 'beacon-system', livingPage: 'docs/beacon.html' } });
    const beacon = await systems.readState(other);
    assert.equal(beacon.home?.kind, 'repo');
    assert.equal(beacon.build?.appliedSeen ?? null, null);
    const dir = await systems.dir(other);
    const inSystem = (rel: string): string => path.relative(rig.tmp.root, path.join(dir, ...rel.split('/')));
    await rig.tmp.write(inSystem('proposal/tokens.css'), ':root {\n  --brand-500: #0b57d0;\n}\n');
    await rig.tmp.write(inSystem('PROPOSAL.json'), `${JSON.stringify(proposalJson('p_bbbb2222'), null, 2)}\n`);
    const proposals = ensureProposals(ctx);
    await proposals.settle(other);
    await proposals.idle();
    await livingPagesIdle(ctx);

    const stopped = await call('POST', `/systems/${other}/build/stop`, { proposalId: 'p_bbbb2222' });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.json));
    assert.equal((await call('GET', `/systems/${other}`)).status, 404, 'the stop took the system away');
    const undone = await call('POST', `/system-stops/${(stopped.json as StopBuildResponse).undoId}/undo`, {});
    assert.deepEqual(undone.json, { id: other });
    assert.equal((await systems.readState(other)).home?.kind, 'repo', 'Undo brought the system back, home and all');
    const record = JSON.parse(await readFile(path.join(await systems.dir(other), '.chamber', 'proposals.json'), 'utf8')) as { seen: { id: string; state: string }[] };
    assert.equal(record.seen.find((entry) => entry.id === 'p_bbbb2222')?.state, 'declined', 'the stop declined the waiting proposal');
  });

  await step('user re-sync with a re-point', async () => {
    const started = await call('POST', '/system-scans', { directory: moved, systemId: id });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const { scanId } = started.json as CreateSystemScanResponse;
    await ensureScanJobs(ctx).settled(scanId);
    const got = (await call('GET', `/system-scans/${scanId}`)).json as SystemScanResponse;
    assert.equal(got.state, 'done', JSON.stringify(got));
    const stamp = (await systems.readState(id)).snapshot?.treeHash ?? 'none';
    const applied = await call('POST', `/systems/${id}/resync`, { scanId, stamp });
    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    const state = await systems.readState(id);
    assert.equal(state.home?.kind === 'repo' ? state.home.directory : null, moved);
  });

  await step('link', async () => {
    await systems.withLock(id, () => systems.updateStateLocked(id, (state) => ({ ...state, status: 'ready' })));
    const store = createDesignStore({ settings: ctx.settings, log: ctx.log, hub: ctx.hub });
    const quiet = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, quietMs: 0, indexRefreshMs: 5 });
    t.after(() => quiet.dispose());
    const versions = createVersionsService({ store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 600_000 });
    const link = createLinkService({ store, versions, systems: quiet, selfWrites: ctx.selfWrites, hub: ctx.hub, log: ctx.log, root: () => rig.root });
    const { slug } = await store.create({ kind: 'page', title: 'Checkout', html: '<!doctype html><html><body><h1>Checkout</h1></body></html>' });
    await link.link(slug, { to: id, by: 'agent', reason: 'system-change' });
  });

  await step('delete', async () => {
    const deleted = await call('DELETE', `/systems/${id}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  });

  assert.deepEqual(steps, ['adoption', 'code scan', 'snapshot refresh', 'living-page generation', 'state routes', 'proposal, preview and approval', 'example pictures with a fake browser', 'stop with a waiting proposal, and its Undo', 'user re-sync with a re-point', 'link', 'delete']);
});
