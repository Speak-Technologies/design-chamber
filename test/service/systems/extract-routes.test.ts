// The Code scan over HTTP and its job registry (documentation/specs/phase-2-5-technical.md §3.1, §7.1
// to §7.3, AD-23): the bearer check and the :scanId gate, the folder check reused from
// `validateScanFolder`, a scan of a fixture project (CSS light and dark, token JSON, @font-face,
// fonts and logos, things for the agent), secret files never opened, links never followed, the
// Designs folder inside a project skipped, the bounds, cancel, a root change, the caps on running
// and kept jobs, making a system from a scan (§7.2) and the re-sync review (§7.3).

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { CodeResyncReview, CreateSystemResponse, CreateSystemScanResponse, ScanSummary, SystemScanResponse } from '../../../src/shared/api.ts';
import type { SystemDetail, SystemState } from '../../../src/shared/types.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemScanRoutes } from '../../../src/service/routes/system-scans.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { installScanJobs, SCAN_GONE_MESSAGE, SCAN_ROOT_CHANGED_MESSAGE, SCANS_BUSY_MESSAGE, type ScanJobsOptions } from '../../../src/service/systems/extract.ts';
import { SCAN_FOLDER_IN_ROOT } from '../../../src/service/systems/scan-folder.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'extract-routes-token-0123456789';

const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'latin1'), randomBytes(200)]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';

type Answer = { status: number; json: unknown };

const serve = async (t: TestContext, options: ScanJobsOptions = {}) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const jobs = installScanJobs(ctx, options);
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerSystemScanRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN): Promise<Answer> => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };
  /** Start a scan and wait for its end; answers the scan id and the final GET. */
  const scan = async (directory: string, systemId?: string): Promise<{ scanId: string; answer: SystemScanResponse }> => {
    const started = await call('POST', '/system-scans', systemId === undefined ? { directory } : { directory, systemId });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const { scanId } = started.json as CreateSystemScanResponse;
    await jobs.settled(scanId);
    const got = await call('GET', `/system-scans/${scanId}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    return { scanId, answer: got.json as SystemScanResponse };
  };
  return { tmp, ctx, jobs, call, scan };
};

const summaryOf = (answer: SystemScanResponse): ScanSummary => {
  assert.equal(answer.state, 'done', JSON.stringify(answer));
  return (answer as Extract<SystemScanResponse, { state: 'done' }>).summary;
};

const messageOf = (answer: Answer): string => (answer.json as { message: string }).message;

/** A small app with every kind of source the scan reads. */
const writeProject = async (project: TmpRoot): Promise<void> => {
  await project.write(
    'src/styles/theme.css',
    `:root {
  --brand-500: #1a73e8;
  --surface-bg: #ffffff;
  --space-4: 16px;
  --radius-2: 8px;
  --hero: url(hero.png);
}
@media (prefers-color-scheme: dark) {
  :root { --brand-500: #8ab4f8; --surface-bg: #111111; }
}
.button { --pad: 3px; }
@font-face { font-family: "Inter"; font-weight: 600; src: url(../../public/fonts/Inter-SemiBold.woff2) format("woff2"); }
`,
  );
  await project.write('tokens/base.json', { color: { $type: 'color', text: { $value: '#222222' } }, z: { modal: { $value: 100 } } });
  await project.write('public/fonts/Inter-SemiBold.woff2', WOFF2);
  await project.write('public/fonts/Mono-Regular.ttf', Buffer.concat([Buffer.from([0, 1, 0, 0]), randomBytes(50)]));
  await project.write('public/logo.svg', SVG);
  await project.write('public/hero.png', 'not a logo by name');
  await project.write('tailwind.config.js', 'module.exports = { theme: { screens: { md: "768px" } } };');
  await project.write('src/vars.scss', '$brand: #123456;\n');
  await project.write('docs/DESIGN.md', '# Design\n');
  await project.write('node_modules/lib/tokens.css', ':root { --vendor: 1px; }');
  await project.write('.hidden/x.css', ':root { --hidden: 1px; }');
};

test('the three routes refuse a missing or wrong token with 401, and :scanId is gated', async (t) => {
  const { call } = await serve(t);
  for (const token of [null, 'wrong-token']) {
    assert.equal((await call('POST', '/system-scans', { directory: '/tmp' }, token)).status, 401);
    assert.equal((await call('GET', '/system-scans/sc_abcdefghijklmnop', undefined, token)).status, 401);
    assert.equal((await call('DELETE', '/system-scans/sc_abcdefghijklmnop', undefined, token)).status, 401);
  }
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b']) {
    const answer = await call('GET', `/system-scans/${hostile}`);
    assert.equal(answer.status, 400, hostile);
    assert.equal((answer.json as { error: string }).error, 'bad-path');
  }
  for (const unknown of ['sc_abcdefghijklmnop', 'nope', 'sc_short']) {
    const answer = await call('GET', `/system-scans/${unknown}`);
    assert.equal(answer.status, 404, unknown);
    assert.equal(messageOf(answer), SCAN_GONE_MESSAGE);
    assert.equal((await call('DELETE', `/system-scans/${unknown}`)).status, 404);
  }
});

test('the folder goes through validateScanFolder: never the Designs folder or inside it, only real absolute folders', async (t) => {
  const { tmp, call } = await serve(t);
  await tmp.write('shop/index.html', '<p>');
  const refused = async (body: unknown, status: number, message: string | RegExp): Promise<void> => {
    const answer = await call('POST', '/system-scans', body);
    assert.equal(answer.status, status, JSON.stringify(body));
    if (typeof message === 'string') assert.equal(messageOf(answer), message);
    else assert.match(messageOf(answer), message);
  };
  await refused({}, 400, 'Name the folder to scan.');
  await refused({ directory: 7 }, 400, 'Name the folder to scan.');
  await refused({ directory: tmp.root }, 400, SCAN_FOLDER_IN_ROOT);
  await refused({ directory: tmp.at('shop') }, 400, SCAN_FOLDER_IN_ROOT);
  await refused({ directory: 'relative/app' }, 400, 'Choose a full folder path.');
  await refused({ directory: tmp.at('missing') }, 400, /It doesn't exist\.$/);
  await refused({ directory: '/tmp', systemId: '../x' }, 400, 'That is not a design system id.');
  await refused({ directory: '/tmp', systemId: 'ghost' }, 404, 'That design system is no longer in your Designs folder.');
});

test('a scan of a project: tokens by section, fonts and logos, things for the agent; values never leave the service', async (t) => {
  const { ctx, scan } = await serve(t);
  const project = await useTmpRoot(t, 'dc-project-');
  await writeProject(project);
  const { answer } = await scan(project.root);
  const summary = summaryOf(answer);
  assert.equal(summary.directory, project.root);
  assert.equal(summary.partial, false);
  assert.deepEqual(summary.counts, { colours: 3, typography: 0, spacing: 1, radius: 1, shadows: 0, layers: 1, sizes: 0, other: 0, fonts: 2, logos: 1 });
  assert.deepEqual(summary.files, [
    { path: 'tokens/base.json', found: 2 },
    { path: 'src/styles/theme.css', found: 5 },
  ]);
  assert.deepEqual(summary.assets, [
    { path: 'public/fonts/Inter-SemiBold.woff2', kind: 'font', bytes: WOFF2.length, family: 'Inter', weight: 600, style: 'normal' },
    { path: 'public/fonts/Mono-Regular.ttf', kind: 'font', bytes: 54, family: 'Mono', weight: 400, style: 'normal' },
    { path: 'public/logo.svg', kind: 'logo', bytes: SVG.length },
  ]);
  assert.equal(summary.refused, 1, 'the url() value');
  assert.deepEqual(summary.forAgent.map((one) => one.path).sort(), ['docs/DESIGN.md', 'src/styles/theme.css', 'src/vars.scss', 'tailwind.config.js']);
  // Only counts and paths travel: no value text in the answer or in a log line.
  const text = JSON.stringify(answer) + JSON.stringify(ctx.logs);
  for (const value of ['#1a73e8', '#8ab4f8', '16px', 'hero.png', '--vendor', '--hidden']) assert.ok(!text.includes(value), value);
  assert.ok(ctx.logs.some((line) => line.event === 'systems.scan-done'));
});

test('secret files are never opened, links are never followed, and the Designs folder inside a project is skipped', async (t) => {
  const project = await useTmpRoot(t, 'dc-project-');
  // The designs root lives inside the project (a monorepo with its designs checked in).
  const { scan, ctx } = await serve(t);
  await ctx.settings.update({ root: project.at('designs') });
  await project.write('designs/_systems/acme/tokens.css', ':root { --designs-only: 1px; }');
  await project.write('app.css', ':root { --app: 1px; }');
  await project.write('.env.theme.css', ':root { --secret: 1px; }');
  await project.write('certs/tokens.json.pem', '{"x":{"$value":"1px"}}');
  await chmod(project.at('.env.theme.css'), 0o000); // were it opened, it would be listed as "can't open"
  const outside = await useTmpRoot(t, 'dc-outside-');
  await outside.write('evil.css', ':root { --outside: 1px; }');
  await outside.write('sub/deep.css', ':root { --outside-dir: 1px; }');
  await outside.write('fonts/Leak.woff2', WOFF2);
  let linked = true;
  try {
    await symlink(outside.at('evil.css'), project.at('linked.css'), 'file');
    await symlink(outside.at('sub'), project.at('linked-dir'), 'dir');
    await project.write('face.css', '@font-face { font-family: Leak; src: url(leak/Leak.woff2); }');
    await symlink(outside.at('fonts'), project.at('leak'), 'dir');
  } catch {
    linked = false;
  }
  const { answer } = await scan(project.root);
  await chmod(project.at('.env.theme.css'), 0o600);
  const summary = summaryOf(answer);
  // face.css names a font (found), but the font sits behind a link, so it is not offered below.
  assert.deepEqual(summary.files, [{ path: 'app.css', found: 1 }, ...(linked ? [{ path: 'face.css', found: 1 }] : [])]);
  assert.deepEqual(summary.skipped, [{ path: 'designs', reason: 'This is your Designs folder, so it was not read.' }]);
  assert.deepEqual(summary.assets, [], linked ? 'a font behind a link is not offered' : 'no links on this system');
  assert.equal(summary.counts.other + summary.counts.sizes + summary.counts.spacing, 1);
});

test('bounds: entries, depth and time make the scan partial; never more than the caps', async (t) => {
  const project = await useTmpRoot(t, 'dc-project-');
  for (let index = 0; index < 30; index += 1) await project.write(`f${String(index).padStart(2, '0')}.css`, `:root { --t${index}: 1px; }`);
  await project.write('a/b/c/deep.css', ':root { --deep: 1px; }');

  const few = await serve(t, { limits: { entries: 10 } });
  const entries = summaryOf((await few.scan(project.root)).answer);
  assert.equal(entries.partial, true);
  assert.ok(entries.files.length < 30);

  const shallow = await serve(t, { limits: { depth: 2 } });
  const depth = summaryOf((await shallow.scan(project.root)).answer);
  assert.ok(!depth.files.some((file) => file.path === 'a/b/c/deep.css'), 'below depth 2 is not walked');

  const someFiles = await serve(t, { limits: { candidates: 5 } });
  const candidates = summaryOf((await someFiles.scan(project.root)).answer);
  assert.equal(candidates.partial, true);
  assert.equal(candidates.files.length, 5);

  // A clock that jumps 11 s at every look: the walk stops at once.
  let clock = 0;
  const slow = await serve(t, { now: () => (clock += 11_000) });
  const time = summaryOf((await slow.scan(project.root)).answer);
  assert.equal(time.partial, true);
  assert.deepEqual(time.files, []);
});

test('cancel stops a running scan; a root change stops running ones and drops done ones; two run at most', async (t) => {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const { ctx, jobs, call } = await serve(t, { gate: () => gate });
  const project = await useTmpRoot(t, 'dc-project-');
  await project.write('a.css', ':root { --a: 1px; }');

  const first = (await call('POST', '/system-scans', { directory: project.root })).json as CreateSystemScanResponse;
  const second = (await call('POST', '/system-scans', { directory: project.root })).json as CreateSystemScanResponse;
  assert.deepEqual((await call('GET', `/system-scans/${first.scanId}`)).json, { state: 'running', seen: 0 });
  const third = await call('POST', '/system-scans', { directory: project.root });
  assert.equal(third.status, 409);
  assert.equal(messageOf(third), SCANS_BUSY_MESSAGE);

  assert.deepEqual((await call('DELETE', `/system-scans/${first.scanId}`)).json, { ok: true });
  assert.deepEqual((await call('GET', `/system-scans/${first.scanId}`)).json, { state: 'cancelled', message: 'The scan was stopped.' });

  const elsewhere = await useTmpRoot(t, 'dc-root2-');
  await ctx.settings.update({ root: elsewhere.root });
  open();
  await jobs.settled(second.scanId);
  assert.deepEqual((await call('GET', `/system-scans/${second.scanId}`)).json, { state: 'root-changed', message: SCAN_ROOT_CHANGED_MESSAGE });
  assert.equal((await call('GET', `/system-scans/${first.scanId}`)).status, 404, 'a stopped job is dropped on a root change');

  const done = (await call('POST', '/system-scans', { directory: project.root })).json as CreateSystemScanResponse;
  await jobs.settled(done.scanId);
  assert.equal(((await call('GET', `/system-scans/${done.scanId}`)).json as SystemScanResponse).state, 'done');
  await ctx.settings.update({ root: (await useTmpRoot(t, 'dc-root3-')).root });
  assert.equal((await call('GET', `/system-scans/${done.scanId}`)).status, 404, 'a done job expires with the root');
});

test('done jobs are kept 10 minutes and at most 4', async (t) => {
  let clock = 1_000_000;
  const { scan, call } = await serve(t, { now: () => clock });
  const project = await useTmpRoot(t, 'dc-project-');
  await project.write('a.css', ':root { --a: 1px; }');
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1) ids.push((await scan(project.root)).scanId);
  assert.equal((await call('GET', `/system-scans/${ids[0] ?? ''}`)).status, 404, 'the oldest of five is dropped');
  assert.equal((await call('GET', `/system-scans/${ids[1] ?? ''}`)).status, 200);
  clock += 10 * 60_000 + 1;
  assert.equal((await call('GET', `/system-scans/${ids[4] ?? ''}`)).status, 404, 'expired after ten minutes');
});

test('making a system from a scan: seeded tokens.css and system.json, ticked fonts and logos copied, provenance kept', async (t) => {
  const { tmp, call, scan } = await serve(t);
  const project = await useTmpRoot(t, 'dc-project-');
  await writeProject(project);
  const { scanId } = await scan(project.root);

  const stranger = await call('POST', '/systems', { name: 'Shop', code: { scanId, assets: ['../../etc/passwd'] } });
  assert.equal(stranger.status, 400);
  assert.equal(messageOf(stranger), 'One of the files to copy was not found by the scan. Scan the folder again.');
  const unknown = await call('POST', '/systems', { name: 'Shop', code: { scanId: 'sc_abcdefghijklmnop', assets: [] } });
  assert.equal(unknown.status, 404);
  assert.equal(await readdir(tmp.at('_systems')).catch(() => null), null, 'nothing was written by the refusals');

  const made = await call('POST', '/systems', { name: 'Shop', code: { scanId, assets: ['public/fonts/Inter-SemiBold.woff2', 'public/logo.svg'] } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const { id, system } = made.json as CreateSystemResponse;
  assert.equal(id, 'shop');
  const css = await tmp.read('_systems/shop/tokens.css');
  assert.match(css, /^:root \{\n {2}\/\* Colours \*\/\n/);
  assert.match(css, /--brand-500: #1a73e8;/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n {2}:root \{\n {4}\/\* Colours \*\/\n {4}--brand-500: #8ab4f8;/);
  assert.ok(!css.includes('url('), 'the refused value never lands');
  const json = JSON.parse(await tmp.read('_systems/shop/system.json')) as { tokens: Record<string, unknown>; fonts: unknown[]; logos: unknown[] };
  assert.deepEqual(json.tokens['--brand-500'], { section: 'colours', group: 'brand' });
  assert.deepEqual(json.tokens['--surface-bg'], { section: 'colours', group: 'surface' });
  assert.deepEqual(json.tokens['--space-4'], { section: 'spacing' });
  assert.deepEqual(json.fonts, [{ file: 'assets/fonts/Inter-SemiBold.woff2', family: 'Inter', weight: 600, style: 'normal' }]);
  assert.deepEqual(json.logos, [{ file: 'assets/logos/logo.svg', variant: 'primary' }]);
  assert.ok((await readFile(tmp.at('_systems/shop/assets/fonts/Inter-SemiBold.woff2'))).equals(WOFF2));
  assert.deepEqual((await readdir(tmp.at('_systems/shop'))).sort(), ['.chamber', 'assets', 'system.json', 'tokens.css'], 'no OVERVIEW.md: the agent writes it');

  const state = JSON.parse(await tmp.read('_systems/shop/.chamber/state.json')) as SystemState;
  assert.equal(state.revision.n, 1);
  assert.equal(state.sources.code?.directory, project.root);
  assert.deepEqual(state.sources.code?.scanned.sort(), ['src/styles/theme.css', 'src/vars.scss', 'tokens/base.json']);
  assert.deepEqual(state.sources.code?.forAgent?.map((one) => one.path).sort(), ['docs/DESIGN.md', 'src/styles/theme.css', 'src/vars.scss', 'tailwind.config.js'], 'kept for the make message');
  assert.deepEqual(state.provenance['--brand-500'], { file: 'src/styles/theme.css', line: 2, light: '#1a73e8', dark: '#8ab4f8' });
  assert.equal(system.tokens.find((token) => token.name === '--brand-500')?.fromCode, true);
  assert.equal(system.revision, 1);
  // The project is only read.
  assert.deepEqual((await readdir(project.at('public'))).sort(), ['fonts', 'hero.png', 'logo.svg']);
});

test('a preset description seeds its :root tokens', async (t) => {
  const { tmp, call } = await serve(t);
  const made = await call('POST', '/systems', { name: 'Calm', description: { text: 'Calm.', preset: 'minimal-saas' } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const detail = (made.json as CreateSystemResponse).system as SystemDetail;
  assert.ok(detail.tokens.length > 3);
  assert.ok(detail.tokens.every((token) => token.fromCode === false));
  assert.match(await tmp.read('_systems/calm/tokens.css'), /^:root \{\n {2}\/\* /);
});

test('re-sync review: changed, conflicts, new and gone against the code the system was made from', async (t) => {
  const { tmp, call, scan } = await serve(t);
  const project = await useTmpRoot(t, 'dc-project-');
  await project.write('theme.css', ':root { --brand: #111111; --surface: #222222; --gone: #333333; --mine: #444444; }');
  const made = await call('POST', '/systems', { name: 'Acme', code: { scanId: (await scan(project.root)).scanId, assets: [] } });
  assert.equal(made.status, 200);
  // The user changed --mine here; the code changes --brand and --mine, drops --gone, adds --fresh.
  const css = await tmp.read('_systems/acme/tokens.css');
  await writeFile(tmp.at('_systems/acme/tokens.css'), css.replace('--mine: #444444', '--mine: #999999'));
  await project.write('theme.css', ':root { --brand: #aaaaaa; --surface: #222222; --mine: #bbbbbb; --fresh: 2px; }');
  await mkdir(project.at('public'));
  await project.write('public/logo.svg', SVG);
  const { answer } = await scan(project.root, 'acme');
  assert.equal(answer.state, 'done');
  const review = (answer as Extract<SystemScanResponse, { state: 'done' }>).review as CodeResyncReview;
  assert.deepEqual(review, {
    kind: 'code',
    changed: [{ name: '--brand', mode: 'light', from: '#111111', to: '#aaaaaa' }],
    conflicts: [{ name: '--mine', mode: 'light', mine: '#999999', code: '#bbbbbb' }],
    added: ['--fresh'],
    removed: ['--gone'],
    assets: [{ path: 'public/logo.svg', kind: 'logo' }],
    partial: false,
  });
});
