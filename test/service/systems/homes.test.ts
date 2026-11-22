// Adoption and homes (documentation/specs/phase-2-5-technical.md §5.9, §2.13, AD-14, AD-15, AD-28):
// every closed reason of step 2 and 3, the rev 3 rules (home, folder and living page re-verified until
// the first applied stamp, fixed after it, the project folder outliving the consumed ticket), the stamp
// acted on once and across a restart, and the fixture repo left exactly as it was by all of it.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { BuildProblemReason, SystemState } from '../../../src/shared/types.ts';
import { createBuildTickets, type BuildTickets } from '../../../src/service/systems/builds.ts';
import { createHomes, verifyRepoHome, type Homes } from '../../../src/service/systems/homes.ts';
import { createSystemStore, type SystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { createTmpRoot } from '../../helpers/tmp-root.ts';

const HASH = 'b'.repeat(64);
const markOf = (id: string): string =>
  `<!doctype html><html><head><meta name="dc-living-page" content="design-chamber/living-page@1 system=${id} revision=1 generated=2026-11-20T09:00:00.000Z hash=${HASH}"></head><body></body></html>\n`;

type Calls = { refresh: string[]; scans: [string, string][]; drops: string[]; supersedes: string[] };

type Rig = {
  base: string;
  root: string;
  /** Repo paths (relative, `/`) a test put there itself; the unchanged-repo check skips them. */
  planted: Set<string>;
  project: string;
  ctx: FakeContext;
  systems: SystemStore;
  tickets: BuildTickets;
  calls: Calls;
  homes: Homes;
  /** A fresh homes service over the same store and tickets (a restart); the previous one is stopped. */
  restart(): Homes;
  issue(projectDirectory?: string | null): Promise<string>;
  /** An agent-made system folder holding only BUILD.json, reconciled. */
  agent(id: string, build: Record<string, unknown>): Promise<SystemState>;
  rewrite(id: string, build: Record<string, unknown>): Promise<SystemState>;
  problem(id: string): Promise<{ reason: BuildProblemReason; value: string } | null>;
};

/** The project tree the fixture repo starts with; its hashes are compared at the end of every test. */
const PROJECT_FILES: Record<string, string> = {
  'package.json': '{"name":"shop"}\n',
  'src/theme.css': ':root { --brand: #0a7; }\n',
  'apps/web/index.html': '<p>web</p>\n',
  'apps/web/src/app.css': 'body { margin: 0; }\n',
  'pages/user.html': '<p>the user wrote this page</p>\n',
};

const treeOf = async (dir: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        out[`${child}/`] = 'dir';
        await walk(child);
      } else if (entry.isSymbolicLink()) out[child] = 'link';
      else out[child] = createHash('sha256').update(await readFile(path.join(dir, child))).digest('hex');
    }
  };
  await walk('');
  return out;
};

// node:test runs `after` hooks in the order they were added: the repo check first, the cleanup last.
const setup = async (t: TestContext, options: { rootInsideProject?: boolean } = {}): Promise<Rig> => {
  const tmp = await createTmpRoot();
  const base = tmp.root;
  const project = path.join(base, 'shop');
  for (const [rel, text] of Object.entries(PROJECT_FILES)) await tmp.write(`shop/${rel}`, text);
  const root = options.rootInsideProject === true ? path.join(project, 'Designs') : path.join(base, 'Designs');
  await mkdir(root, { recursive: true });
  const ignored = (tree: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(tree).filter(([rel]) => !planted.has(rel.replace(/\/$/, '')) && !(options.rootInsideProject === true && (rel === 'Designs/' || rel.startsWith('Designs/')))));
  const planted = new Set<string>();
  const before = await treeOf(project);
  // The service never writes the repo, whatever the test did.
  t.after(async () => assert.deepEqual(ignored(await treeOf(project)), ignored(before), 'the fixture repo is unchanged'));

  const ctx = createFakeContext({ root });
  t.after(() => ctx.dispose());
  const systems = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, indexRefreshMs: 0 });
  t.after(() => systems.dispose());
  let at = Date.parse('2026-11-20T10:00:00.000Z');
  const now = (): Date => new Date((at += 1000));
  const tickets = createBuildTickets({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, systems, now });
  t.after(() => tickets.dispose());
  const calls: Calls = { refresh: [], scans: [], drops: [], supersedes: [] };
  const make = (): Homes =>
    createHomes({
      systems,
      tickets,
      settings: ctx.settings,
      hub: ctx.hub,
      log: ctx.log,
      now,
      snapshots: { refresh: async (id) => void calls.refresh.push(id) },
      scans: { build: async (id, directory) => void calls.scans.push([id, directory]) },
      livingPages: { drop: async (id) => void calls.drops.push(id) },
      proposals: { supersede: async (id) => void calls.supersedes.push(id) },
    });
  const rig: Rig = {
    base,
    root,
    planted,
    project,
    ctx,
    systems,
    tickets,
    calls,
    homes: make(),
    restart() {
      rig.homes.stop();
      rig.homes = make();
      return rig.homes;
    },
    async issue(projectDirectory = project) {
      return (await tickets.issue({ projectDirectory, sessionId: 'ses_build', rulesFor: () => '# rules\n' })).ticket.ticket;
    },
    async agent(id, build) {
      await mkdir(path.join(root, '_systems', id), { recursive: true });
      return rig.rewrite(id, build);
    },
    async rewrite(id, build) {
      await writeFile(path.join(root, '_systems', id, 'BUILD.json'), `${JSON.stringify(build, null, 2)}\n`);
      await rig.homes.reconcile(id);
      await rig.homes.idle();
      return systems.readState(id);
    },
    async problem(id) {
      return (await systems.readState(id)).buildProblem ?? null;
    },
  };
  t.after(() => rig.homes.stop());
  t.after(() => tmp.cleanup());
  return rig;
};

const repoBuild = (rig: Rig, ticket: string | null, over: Record<string, unknown> = {}, repo: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  ticket,
  name: 'Acme',
  home: 'repo',
  repo: { directory: rig.project, folder: 'design-system', livingPage: 'design-system/index.html', ...repo },
  ...over,
});

const STAMP = (at: string): Record<string, unknown> => ({ applied: { at, parts: ['system-files'], skipped: [] } });

// ---- step 2: adoption ----

test('a repo home with an open ticket is adopted: realpath home, build record, Draft, session, ticket consumed', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  const state = await rig.agent('acme', repoBuild(rig, ticket, { code: { directory: path.join(rig.project, 'src') } }));
  assert.deepEqual(state.home, { kind: 'repo', directory: rig.project, folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: state.build?.adoptedAt });
  assert.equal(state.name, 'Acme');
  assert.equal(state.status, 'draft');
  assert.equal(state.sessionId, 'ses_build');
  assert.equal(state.build?.ticket, ticket);
  assert.equal(state.build?.appliedSeen, null);
  assert.equal(state.build?.projectDirectory, rig.project);
  assert.equal(state.sources.code?.directory, path.join(rig.project, 'src'));
  assert.equal(state.buildProblem ?? null, null);
  // Consumed: the ticket is no longer open, but the project folder lives on in the build record (rev 3).
  assert.equal(await rig.tickets.open(ticket), null);
  assert.deepEqual(rig.calls.scans, [['acme', path.join(rig.project, 'src')]]);
  assert.ok(rig.ctx.events.some((event) => event.kind === 'system' && event.system === 'acme' && event.systemChange === 'build'));
  // The repo-backed content set is the (absent) snapshot: nothing of the repo is read as content.
  assert.deepEqual((await rig.systems.get('acme')).files, []);
});

test('an internal home is adopted without a ticket, and the code folder only an agent named is never scanned', async (t) => {
  const rig = await setup(t);
  const state = await rig.agent('calm', { version: 1, name: 'Calm', home: 'internal', code: { directory: rig.project } });
  assert.deepEqual(state.home, { kind: 'internal' });
  assert.equal(state.build?.projectDirectory, null);
  assert.equal(state.sources.code, null);
  assert.deepEqual(rig.calls.scans, []);
  // An unknown ticket on an internal home is adopted without it.
  const other = await rig.agent('quiet', { version: 1, ticket: 'sb_unknown00000', name: 'Quiet', home: 'internal' });
  assert.deepEqual(other.home, { kind: 'internal' });
  assert.equal(other.buildProblem ?? null, null);
});

test('a name clash ignoring case adopts "<name> 2" and says so', async (t) => {
  const rig = await setup(t);
  await rig.systems.create({ name: 'Acme' });
  const state = await rig.agent('acme-b', { version: 1, name: 'ACME', home: 'internal' });
  assert.equal(state.name, 'ACME 2');
  assert.deepEqual(rig.systems.takeNotices(), ['Another system is called ACME, so this one was named ACME 2.']);
});

test('unreadable, ticket-unknown and ticket-needed stop adoption and adopt nothing', async (t) => {
  const rig = await setup(t);
  await mkdir(path.join(rig.root, '_systems', 'broken'), { recursive: true });
  await writeFile(path.join(rig.root, '_systems', 'broken', 'BUILD.json'), '{ not json');
  await rig.homes.reconcile('broken');
  assert.equal((await rig.problem('broken'))?.reason, 'unreadable');

  const unknown = await rig.agent('ghost', repoBuild(rig, 'sb_000000000000'));
  assert.deepEqual(unknown.buildProblem, { reason: 'ticket-unknown', value: 'sb_000000000000' });
  assert.equal(unknown.build, undefined);
  assert.equal(unknown.home?.kind ?? 'internal', 'internal');

  const none = await rig.agent('loose', repoBuild(rig, null));
  assert.equal(none.buildProblem?.reason, 'ticket-needed');
  // A ticket from a chat with no project folder cannot place a repo home either.
  const noProject = await rig.issue(null);
  const placeless = await rig.agent('placeless', repoBuild(rig, noProject));
  assert.equal(placeless.buildProblem?.reason, 'ticket-needed');
  assert.notEqual(await rig.tickets.open(noProject), null, 'a refused adoption never consumes the ticket');
});

test('every path shape the record refuses is unreadable: .., dot segments, UNC, relative and drive-relative', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  const hostile: Record<string, unknown>[] = [
    { folder: '../outside' },
    { folder: '.git' },
    { folder: 'ds/.hidden' },
    { livingPage: '../index.html' },
    { directory: '\\\\server\\share\\shop' },
    { directory: '//server/share/shop' },
    { directory: 'shop' },
    { directory: 'C:shop' },
  ];
  for (const [index, repo] of hostile.entries()) {
    const id = `hostile-${index}`;
    const state = await rig.agent(id, repoBuild(rig, ticket, {}, repo));
    assert.equal(state.buildProblem?.reason, 'unreadable', JSON.stringify(repo));
    assert.equal(state.build, undefined);
  }
  assert.notEqual(await rig.tickets.open(ticket), null);
});

test('repo-outside-project: outside the project, above it (monorepo), a drive root, SKIP_DIRS, a link out', async (t) => {
  const rig = await setup(t);
  const elsewhere = path.join(rig.base, 'elsewhere');
  await mkdir(elsewhere, { recursive: true });
  // A ticket from apps/web: the repo above it is a monorepo root and is refused.
  const web = await rig.issue(path.join(rig.project, 'apps', 'web'));
  const cases: [string, Record<string, unknown>, string][] = [
    ['outside', repoBuild(rig, web, {}, { directory: elsewhere }), elsewhere],
    ['above', repoBuild(rig, web, {}, { directory: rig.project }), rig.project],
    ['drive-root', repoBuild(rig, web, {}, { directory: process.platform === 'win32' ? 'C:\\' : '/' }), process.platform === 'win32' ? 'C:\\' : '/'],
    ['skipped', repoBuild(rig, web, {}, { directory: path.join(rig.project, 'apps', 'web'), folder: 'node_modules/ds', livingPage: 'ds.html' }), 'node_modules'],
    ['gone', repoBuild(rig, web, {}, { directory: path.join(rig.project, 'apps', 'missing') }), path.join(rig.project, 'apps', 'missing')],
  ];
  for (const [id, build, value] of cases) {
    const state = await rig.agent(id, build);
    assert.deepEqual(state.buildProblem, { reason: 'repo-outside-project', value }, id);
  }
  // A link inside the repo that leads out of it: the folder resolves outside, so it is refused.
  const inner = await rig.issue();
  await symlink(elsewhere, path.join(rig.project, 'apps', 'out'), 'dir');
  rig.planted.add('apps/out');
  const linked = await rig.agent('linked', repoBuild(rig, inner, {}, { folder: 'apps/out/ds', livingPage: 'ds.html' }));
  assert.equal(linked.buildProblem?.reason, 'repo-outside-project');
  // A repo inside the project is fine (the ticket from the project, the repo a package of it).
  const pkg = await rig.agent('pkg', repoBuild(rig, inner, {}, { directory: path.join(rig.project, 'apps', 'web'), folder: 'ds', livingPage: 'ds/index.html' }));
  assert.equal(pkg.buildProblem ?? null, null);
  assert.equal(pkg.home?.kind, 'repo');
});

test('repo-outside-project: the designs root as the repo, or the system folder around or inside it', async (t) => {
  const rig = await setup(t, { rootInsideProject: true });
  const ticket = await rig.issue();
  const asRepo = await rig.agent('as-repo', repoBuild(rig, ticket, {}, { directory: rig.root, folder: 'ds', livingPage: 'ds.html' }));
  assert.equal(asRepo.buildProblem?.reason, 'repo-outside-project');
  const around = await rig.agent('around', repoBuild(rig, ticket, {}, { folder: 'Designs', livingPage: 'ds.html' }));
  assert.equal(around.buildProblem?.reason, 'repo-outside-project');
  const inside = await rig.agent('inside', repoBuild(rig, ticket, {}, { folder: 'Designs/acme', livingPage: 'ds.html' }));
  assert.equal(inside.buildProblem?.reason, 'repo-outside-project');
  const sibling = await rig.agent('sibling', repoBuild(rig, ticket));
  assert.equal(sibling.buildProblem ?? null, null, 'a folder beside the designs root is fine');
});

test('repo-overlap names the other system: the same folder, a nested one, the same living page', async (t) => {
  const rig = await setup(t);
  const first = await rig.agent('acme', repoBuild(rig, await rig.issue()));
  assert.equal(first.home?.kind, 'repo');
  const same = await rig.agent('brand', repoBuild(rig, await rig.issue(), { name: 'Brand' }));
  assert.deepEqual(same.buildProblem, { reason: 'repo-overlap', value: 'Acme' });
  const nested = await rig.agent('nested', repoBuild(rig, await rig.issue(), { name: 'Nested' }, { folder: 'design-system/inner', livingPage: 'inner.html' }));
  assert.deepEqual(nested.buildProblem, { reason: 'repo-overlap', value: 'Acme' });
  const page = await rig.agent('page', repoBuild(rig, await rig.issue(), { name: 'Page' }, { folder: 'brand', livingPage: 'design-system/index.html' }));
  assert.deepEqual(page.buildProblem, { reason: 'repo-overlap', value: 'Acme' });
  const apart = await rig.agent('apart', repoBuild(rig, await rig.issue(), { name: 'Apart' }, { folder: 'brand', livingPage: 'brand/index.html' }));
  assert.equal(apart.buildProblem ?? null, null);
});

test("living-page-exists: a user's file, or another system's page, is never taken; this system's own page is", async (t) => {
  const rig = await setup(t);
  const user = await rig.agent('acme', repoBuild(rig, await rig.issue(), {}, { folder: 'ds', livingPage: 'pages/user.html' }));
  assert.deepEqual(user.buildProblem, { reason: 'living-page-exists', value: 'pages/user.html' });
  // Another system's mark is not this system's.
  const other = path.join(rig.project, 'pages', 'other.html');
  await writeFile(other, markOf('brand'));
  rig.planted.add('pages/other.html');
  const foreign = await rig.agent('acme', repoBuild(rig, await rig.issue(), {}, { folder: 'ds', livingPage: 'pages/other.html' }));
  assert.equal(foreign.buildProblem?.reason, 'living-page-exists');
  // A folder at the path is not a page either.
  const folderAt = await rig.agent('acme', repoBuild(rig, await rig.issue(), {}, { folder: 'ds', livingPage: 'apps/web.html' }));
  assert.equal(folderAt.buildProblem ?? null, null, 'absent: fine');
  const own = path.join(rig.project, 'pages', 'acme.html');
  await writeFile(own, markOf('acme-2'));
  rig.planted.add('pages/acme.html');
  const mine = await rig.agent('acme-2', repoBuild(rig, await rig.issue(), { name: 'Acme Two' }, { folder: 'ds2', livingPage: 'pages/acme.html' }));
  assert.equal(mine.buildProblem ?? null, null);
  assert.equal(mine.home?.kind, 'repo');
});

test('verifyRepoHome refuses a link at the living-page path without reading through it', async (t) => {
  const rig = await setup(t);
  const opts = { root: rig.root, systems: rig.systems, id: 'acme' };
  // A link inside the repo to this system's own marked page is still not a page: it is never read through.
  await writeFile(path.join(rig.project, 'pages', 'real.html'), markOf('acme'));
  rig.planted.add('pages/real.html');
  await symlink(path.join(rig.project, 'pages', 'real.html'), path.join(rig.project, 'pages', 'link.html'));
  rig.planted.add('pages/link.html');
  const inner = await verifyRepoHome({ directory: rig.project, folder: 'ds', livingPage: 'pages/link.html' }, rig.project, opts);
  assert.deepEqual(inner.problem, { reason: 'living-page-exists', value: 'pages/link.html' });
  // A link leading out of the repo is refused before anything is looked at.
  const outside = path.join(rig.base, 'mark.html');
  await writeFile(outside, markOf('acme'));
  await symlink(outside, path.join(rig.project, 'pages', 'out.html'));
  rig.planted.add('pages/out.html');
  const out = await verifyRepoHome({ directory: rig.project, folder: 'ds', livingPage: 'pages/out.html' }, rig.project, opts);
  assert.deepEqual(out.problem, { reason: 'repo-outside-project', value: 'pages/out.html' });
  // The real page itself is this system's own and passes.
  const own = await verifyRepoHome({ directory: rig.project, folder: 'ds', livingPage: 'pages/real.html' }, rig.project, opts);
  assert.equal(own.problem, null);
});

test('code-outside-project: a code folder outside the ticket project stops adoption', async (t) => {
  const rig = await setup(t);
  const state = await rig.agent('acme', repoBuild(rig, await rig.issue(), { code: { directory: rig.base } }));
  assert.deepEqual(state.buildProblem, { reason: 'code-outside-project', value: rig.base });
  assert.equal(state.build, undefined);
  assert.deepEqual(rig.calls.scans, []);
});

// ---- step 3: following (rev 3, AD-28) ----

test('before the first stamp the folder, living page and code are re-verified and followed, with the project folder outliving the ticket', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  await rig.agent('acme', repoBuild(rig, ticket));
  assert.equal(await rig.tickets.open(ticket), null);
  const moved = await rig.rewrite('acme', repoBuild(rig, ticket, { code: { directory: path.join(rig.project, 'src') } }, { folder: 'brand', livingPage: 'brand/index.html' }));
  assert.equal(moved.buildProblem ?? null, null);
  assert.equal(moved.home?.kind === 'repo' ? moved.home.folder : null, 'brand');
  assert.equal(moved.home?.kind === 'repo' ? moved.home.livingPage : null, 'brand/index.html');
  assert.equal(moved.build?.projectDirectory, rig.project);
  assert.equal(moved.sources.code?.directory, path.join(rig.project, 'src'));
  assert.deepEqual(rig.calls.drops, ['acme']);
  assert.deepEqual(rig.calls.supersedes, ['acme']);
  assert.deepEqual(rig.calls.scans, [['acme', path.join(rig.project, 'src')]]);

  // Rewriting the same record again is not a move (a trailing slash on the directory neither).
  const again = await rig.rewrite('acme', repoBuild(rig, ticket, { code: { directory: `${path.join(rig.project, 'src')}/` } }, { directory: `${rig.project}/`, folder: 'brand', livingPage: 'brand/index.html' }));
  assert.equal(again.buildProblem ?? null, null);
  assert.equal(rig.calls.drops.length, 1);

  // A failing move leaves the last good home standing.
  const out = await rig.rewrite('acme', repoBuild(rig, ticket, {}, { folder: 'node_modules/ds', livingPage: 'ds.html' }));
  assert.equal(out.buildProblem?.reason, 'repo-outside-project');
  assert.equal(out.home?.kind === 'repo' ? out.home.folder : null, 'brand');
  const user = await rig.rewrite('acme', repoBuild(rig, ticket, {}, { folder: 'brand', livingPage: 'pages/user.html' }));
  assert.equal(user.buildProblem?.reason, 'living-page-exists');
  const code = await rig.rewrite('acme', repoBuild(rig, ticket, { code: { directory: rig.base } }, { folder: 'brand', livingPage: 'brand/index.html' }));
  assert.equal(code.buildProblem?.reason, 'code-outside-project');
  assert.equal(code.sources.code?.directory, path.join(rig.project, 'src'));

  // Repo → internal is always allowed before the first stamp (nothing is in the repo yet).
  const internal = await rig.rewrite('acme', { version: 1, ticket, name: 'Acme', home: 'internal' });
  assert.deepEqual(internal.home, { kind: 'internal' });
  assert.equal(internal.buildProblem ?? null, null);
  assert.equal(internal.sources.code, null);
  // And back to the repo, re-verified against the stored project folder.
  const back = await rig.rewrite('acme', repoBuild(rig, ticket));
  assert.equal(back.home?.kind, 'repo');
  assert.equal(back.buildProblem ?? null, null);
});

test('a different ticket is ticket-changed; a different name is ignored', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  await rig.agent('acme', repoBuild(rig, ticket));
  const other = await rig.issue();
  const changed = await rig.rewrite('acme', repoBuild(rig, other));
  assert.deepEqual(changed.buildProblem, { reason: 'ticket-changed', value: other });
  assert.equal(changed.build?.ticket, ticket);
  const renamed = await rig.rewrite('acme', repoBuild(rig, ticket, { name: 'Zebra' }));
  assert.equal(renamed.name, 'Acme');
  assert.equal(renamed.buildProblem ?? null, null, 'the right ticket clears the problem');
});

test('from the first stamp on the home is fixed: home-changed, the adopted values stand', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  await rig.agent('acme', repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z')));
  const stamped = await rig.systems.readState('acme');
  assert.equal(stamped.build?.appliedSeen, '2026-11-20T11:00:00.000Z');
  for (const build of [
    repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z'), { folder: 'brand', livingPage: 'brand/index.html' }),
    repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z'), { livingPage: 'design-system/other.html' }),
    repoBuild(rig, ticket, { ...STAMP('2026-11-20T11:00:00.000Z'), code: { directory: path.join(rig.project, 'src') } }),
    { version: 1, ticket, name: 'Acme', home: 'internal', ...STAMP('2026-11-20T11:00:00.000Z') },
  ]) {
    const state = await rig.rewrite('acme', build);
    assert.equal(state.buildProblem?.reason, 'home-changed', JSON.stringify(build));
    assert.deepEqual(state.home, stamped.home);
    assert.equal(state.sources.code, null);
  }
  const back = await rig.rewrite('acme', repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z')));
  assert.equal(back.buildProblem ?? null, null);
  assert.deepEqual(rig.calls.drops, []);
});

// ---- step 4: the applied stamp ----

test('an applied stamp is acted on once, newer ones again, and never again after a restart', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  await rig.agent('acme', repoBuild(rig, ticket));
  assert.deepEqual(rig.calls.refresh, []);
  await rig.rewrite('acme', repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z')));
  assert.deepEqual(rig.calls.refresh, ['acme']);
  await rig.rewrite('acme', repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z')));
  await rig.rewrite('acme', repoBuild(rig, ticket, STAMP('2026-11-20T10:30:00.000Z')));
  assert.deepEqual(rig.calls.refresh, ['acme'], 'the same or an older stamp is not acted on');

  const homes = rig.restart();
  await homes.reconcile('acme');
  await homes.idle();
  assert.deepEqual(rig.calls.refresh, ['acme'], 'a restart reads the seen stamp from state.json');

  await rig.rewrite('acme', repoBuild(rig, ticket, STAMP('2026-11-20T12:00:00.000Z')));
  assert.deepEqual(rig.calls.refresh, ['acme', 'acme']);
  assert.equal((await rig.systems.readState('acme')).build?.appliedSeen, '2026-11-20T12:00:00.000Z');
});

test('a failing refresh still records the stamp, so it never loops', async (t) => {
  const rig = await setup(t);
  rig.homes.stop();
  let attempts = 0;
  rig.homes = createHomes({
    systems: rig.systems,
    tickets: rig.tickets,
    settings: rig.ctx.settings,
    hub: rig.ctx.hub,
    log: rig.ctx.log,
    snapshots: {
      refresh: async () => {
        attempts += 1;
        throw new Error('the repo is busy');
      },
    },
  });
  const ticket = await rig.issue();
  await rig.agent('acme', repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z')));
  await rig.rewrite('acme', repoBuild(rig, ticket, STAMP('2026-11-20T11:00:00.000Z')));
  assert.equal(attempts, 1);
  assert.equal((await rig.systems.readState('acme')).build?.appliedSeen, '2026-11-20T11:00:00.000Z');
  assert.ok(rig.ctx.logs.some((line) => line.event === 'systems.homes.refresh-failed'));
});

test('an internal home with code rescans on a stamp; one without code does nothing', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  await rig.agent('calm', { version: 1, ticket, name: 'Calm', home: 'internal', code: { directory: path.join(rig.project, 'src') } });
  assert.equal(rig.calls.scans.length, 1);
  await rig.rewrite('calm', { version: 1, ticket, name: 'Calm', home: 'internal', code: { directory: path.join(rig.project, 'src') }, ...STAMP('2026-11-20T11:00:00.000Z') });
  assert.equal(rig.calls.scans.length, 2);
  assert.deepEqual(rig.calls.refresh, []);
});

test('BUILD.json events on the hub reconcile; a removed record or a sheet-made system does nothing', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  await mkdir(path.join(rig.root, '_systems', 'acme'), { recursive: true });
  await writeFile(path.join(rig.root, '_systems', 'acme', 'BUILD.json'), JSON.stringify(repoBuild(rig, ticket)));
  rig.ctx.hub.emit({ slug: null, kind: 'system', system: 'acme', systemChange: 'files', files: ['BUILD.json'] });
  await new Promise((resolve) => setImmediate(resolve));
  await rig.homes.idle();
  assert.equal((await rig.systems.readState('acme')).home?.kind, 'repo');

  const { id } = await rig.systems.create({ name: 'Sheet' });
  await rig.homes.reconcile(id);
  assert.equal((await rig.systems.readState(id)).build, undefined);
  assert.equal((await lstat(path.join(rig.root, '_systems', id, 'BUILD.json')).catch(() => null)), null);
});

// ---- Phase 2.6 AD-11: BUILD.json `existing` (§5.10) ----

const NO_READ = { page: [], docs: [], components: [] };

test('existing: a folder inside the ticket project is adopted as the code source, with the project and the location', async (t) => {
  const rig = await setup(t);
  const state = await rig.agent('acme', repoBuild(rig, await rig.issue(), { existing: { folder: 'apps/web' } }));
  assert.equal(state.buildProblem ?? null, null);
  assert.deepEqual(state.sources.code, {
    directory: path.join(rig.project, 'apps', 'web'),
    lastScan: state.sources.code?.lastScan,
    partial: false,
    scanned: [],
    project: rig.project,
    existing: { location: 'apps/web', marks: [], read: NO_READ },
  });
  assert.deepEqual(rig.calls.scans, [['acme', path.join(rig.project, 'apps', 'web')]], 'the adoption scan fills what it holds');
  // A code folder named too stays the code source; the existing folder rides along.
  const both = await rig.agent('both', repoBuild(rig, await rig.issue(), { code: { directory: rig.project }, existing: { folder: '.' } }, { folder: 'brand', livingPage: 'brand/index.html' }));
  assert.equal(both.sources.code?.directory, rig.project);
  assert.deepEqual(both.sources.code?.existing, { location: '', marks: [], read: NO_READ });
});

test('existing-outside-project: a link out, a gone folder or no ticket project is ignored with a problem; the build is still adopted', async (t) => {
  const rig = await setup(t);
  await symlink(rig.base, path.join(rig.project, 'linkout'), 'dir');
  rig.planted.add('linkout');
  const out = await rig.agent('acme', repoBuild(rig, await rig.issue(), { existing: { folder: 'linkout' } }));
  assert.deepEqual(out.buildProblem, { reason: 'existing-outside-project', value: 'linkout' });
  assert.equal(out.home?.kind, 'repo', 'adopted anyway');
  assert.notEqual(out.build, undefined);
  assert.equal(out.sources.code, null, 'the ignored folder is never read');
  assert.deepEqual(rig.calls.scans, []);
  const gone = await rig.agent('gone', repoBuild(rig, await rig.issue(), { existing: { folder: 'nope' } }, { folder: 'brand', livingPage: 'brand/index.html' }));
  assert.deepEqual(gone.buildProblem, { reason: 'existing-outside-project', value: 'nope' });
  // An internal home without a ticket has no project for the folder to be inside.
  const internal = await rig.agent('calm', { version: 1, name: 'Calm', home: 'internal', existing: { folder: 'apps/web' } });
  assert.deepEqual(internal.buildProblem, { reason: 'existing-outside-project', value: 'apps/web' });
  assert.equal(internal.sources.code, null);
  // A shape the record refuses is skipped at parse: no problem, nothing read.
  const shape = await rig.agent('shape', { version: 1, name: 'Shape', home: 'internal', existing: { folder: '../outside' } });
  assert.equal(shape.buildProblem ?? null, null);
  assert.equal(shape.sources.code, null);
});

test('existing is re-verified and followed before the first stamp; a fix clears the problem', async (t) => {
  const rig = await setup(t);
  const ticket = await rig.issue();
  const first = await rig.agent('acme', repoBuild(rig, ticket, { existing: { folder: 'nope' } }));
  assert.equal(first.buildProblem?.reason, 'existing-outside-project');
  const fixed = await rig.rewrite('acme', repoBuild(rig, ticket, { existing: { folder: 'apps/web' } }));
  assert.equal(fixed.buildProblem ?? null, null);
  assert.equal(fixed.sources.code?.existing?.location, 'apps/web');
  assert.deepEqual(rig.calls.drops, [], 'only the existing folder changed: the home and its pages stand');
  assert.deepEqual(rig.calls.scans, [['acme', path.join(rig.project, 'apps', 'web')]]);
  const unchanged = await rig.rewrite('acme', repoBuild(rig, ticket, { existing: { folder: 'apps/web' } }));
  assert.equal(unchanged.buildProblem ?? null, null);
  assert.equal(rig.calls.scans.length, 1, 'the same record is not a change');
});
