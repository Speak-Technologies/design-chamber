// The internal-home re-sync apply (documentation/specs/phase-2-5-technical.md §6.3, §7.3; RS S4) over
// HTTP against a real system store, real system history and real scan jobs in a temp designs root:
// changed / conflict / new / gone applied only as ticked, values updated while notes, the overview,
// fonts and assets are kept (S4-1), removals only from "No longer in the code" (never an agent's
// token, never one from a file a partial scan did not read), "Before re-sync" first and Undo
// (files and provenance), stale and root-change refusals that write nothing, and the bearer and
// traversal gates of the route.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { CodeResyncReview, CreateSystemResponse, CreateSystemScanResponse, SystemResyncResponse, SystemScanResponse, SystemUndoEditResponse } from '../../../src/shared/api.ts';
import { resyncStampOf } from '../../../src/shared/system-json.ts';
import type { SystemDetail, SystemState } from '../../../src/shared/types.ts';
import { ApiError, createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemEditRoutes } from '../../../src/service/routes/system-edits.ts';
import { registerSystemScanRoutes } from '../../../src/service/routes/system-scans.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { createSystemEditService, parseSystemResyncRequest, RESYNC_NOTHING_TICKED_MESSAGE, resyncStaleMessage } from '../../../src/service/systems/edits.ts';
import { installScanJobs, RESYNC_ROOT_CHANGED_MESSAGE, SCAN_GONE_MESSAGE, SCAN_OTHER_SYSTEM_MESSAGE, type ScanJobsOptions } from '../../../src/service/systems/extract.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { ensureSystemVersions } from '../../../src/service/systems/versions.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'resync-routes-token-0123456789';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
const OLD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"/>';

type Answer = { status: number; json: unknown };

const serve = async (t: TestContext, options: ScanJobsOptions = {}) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  let jobs = installScanJobs(ctx, options);
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerSystemScanRoutes(router, ctx);
  registerSystemEditRoutes(router, ctx);
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
  const scan = async (directory: string, systemId?: string): Promise<{ scanId: string; review: CodeResyncReview | undefined }> => {
    const started = await call('POST', '/system-scans', systemId === undefined ? { directory } : { directory, systemId });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const { scanId } = started.json as CreateSystemScanResponse;
    await jobs.settled(scanId);
    const got = (await call('GET', `/system-scans/${scanId}`)).json as SystemScanResponse;
    assert.equal(got.state, 'done', JSON.stringify(got));
    const review = (got as Extract<SystemScanResponse, { state: 'done' }>).review;
    return { scanId, review: review?.kind === 'code' ? review : undefined };
  };
  /** The stamp the page sends: from the system's detail as it reads it now. */
  const stampOf = async (id: string): Promise<string> => resyncStampOf(((await call('GET', `/systems/${id}`)).json as SystemDetail).stamps);
  const reinstall = (next: ScanJobsOptions): void => {
    jobs = installScanJobs(ctx, next);
  };
  return { tmp, ctx, call, scan, stampOf, reinstall };
};

const messageOf = (answer: Answer): string => (answer.json as { message: string }).message;
const stateOf = async (tmp: TmpRoot, id: string): Promise<SystemState> => JSON.parse(await tmp.read(`_systems/${id}/.chamber/state.json`)) as SystemState;

const FIRST = `:root {
  --brand: #111111;
  --surface: #222222;
  --gone: #333333;
  --mine: #444444;
  --keep: #555555;
}
@media (prefers-color-scheme: dark) {
  :root { --brand: #121212; }
}
`;

const SECOND = `:root {
  --brand: #aaaaaa;
  --surface: #222222;
  --mine: #bbbbbb;
  --keep: #565656;
  --fresh: 2px;
}
@media (prefers-color-scheme: dark) {
  :root { --brand: #bababa; }
}
`;

/**
 * Acme made from the project's code, then: the agent adds an overview, a note, a note on --brand,
 * its own token --agent-only and an old logo; the user changes --mine here; the code changes.
 */
const prepare = async (t: TestContext, options: ScanJobsOptions = {}) => {
  const rig = await serve(t, options);
  const { tmp, call, scan } = rig;
  const project = await useTmpRoot(t, 'dc-project-');
  await project.write('theme.css', FIRST);
  const made = await call('POST', '/systems', { name: 'Acme', code: { scanId: (await scan(project.root)).scanId, assets: [] } });
  assert.equal(made.status, 200, JSON.stringify(made.json));

  const css = await tmp.read('_systems/acme/tokens.css');
  await tmp.write('_systems/acme/tokens.css', css.replace('--mine: #444444;', '--mine: #999999;').replace('--keep: #555555;', '--keep: #555555;\n  --agent-only: 4px;'));
  const json = JSON.parse(await tmp.read('_systems/acme/system.json')) as { tokens: Record<string, Record<string, unknown>> } & Record<string, unknown>;
  json.tokens['--brand'] = { ...json.tokens['--brand'], note: 'Primary actions only.' };
  json.notes = [{ id: 'history', title: 'History' }];
  json.logos = [{ file: 'assets/logos/old.svg', variant: 'primary' }];
  await tmp.write('_systems/acme/system.json', `${JSON.stringify(json, null, 2)}\n`);
  await tmp.write('_systems/acme/OVERVIEW.md', 'Acme is calm and plain.\n');
  await tmp.write('_systems/acme/notes/history.md', 'Why the palette changed.\n');
  await tmp.write('_systems/acme/assets/logos/old.svg', OLD_SVG);

  await project.write('theme.css', SECOND);
  await project.write('public/logo.svg', SVG);
  return { ...rig, project };
};

const kept = async (tmp: TmpRoot) => ({
  overview: await tmp.read('_systems/acme/OVERVIEW.md'),
  note: await tmp.read('_systems/acme/notes/history.md'),
  oldLogo: await tmp.read('_systems/acme/assets/logos/old.svg'),
});

test('the review, then Apply: ticked values change, notes, overview, fonts and assets are kept, then Undo', async (t) => {
  const { tmp, call, scan, stampOf, project } = await prepare(t);
  const { scanId, review } = await scan(project.root, 'acme');
  assert.deepEqual(review, {
    kind: 'code',
    changed: [
      { name: '--brand', mode: 'light', from: '#111111', to: '#aaaaaa' },
      { name: '--brand', mode: 'dark', from: '#121212', to: '#bababa' },
      { name: '--keep', mode: 'light', from: '#555555', to: '#565656' },
    ],
    conflicts: [{ name: '--mine', mode: 'light', mine: '#999999', code: '#bbbbbb' }],
    added: ['--fresh'],
    removed: ['--gone'],
    assets: [{ path: 'public/logo.svg', kind: 'logo' }],
    partial: false,
  });
  // The agent's own token is never "no longer in the code".
  assert.ok(!review?.removed.includes('--agent-only'));

  const beforeCss = await tmp.read('_systems/acme/tokens.css');
  const beforeJson = await tmp.read('_systems/acme/system.json');
  const beforeState = await stateOf(tmp, 'acme');
  const keptBefore = await kept(tmp);

  // --keep's change is left unticked; --mine takes the code's value.
  const applied = await call('POST', '/systems/acme/resync', {
    scanId,
    stamp: await stampOf('acme'),
    changes: ['--brand'],
    useCode: ['--mine'],
    add: ['--fresh'],
    remove: ['--gone'],
    assets: ['public/logo.svg'],
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  const answer = applied.json as SystemResyncResponse;
  assert.deepEqual(answer.counts, { changed: 2, added: 1, removed: 1 });
  assert.equal(answer.edit.label, 'Re-synced Acme: 2 changed, 1 added, 1 removed.');
  assert.equal(answer.edit.undoable, true);
  assert.equal(answer.coalesced, false);
  assert.equal(answer.version?.reason, 'resync');
  assert.deepEqual(answer.edit.files, ['assets/logos/logo.svg', 'system.json', 'tokens.css']);
  assert.equal(answer.stamps.tokens !== undefined && answer.stamps.systemJson !== undefined, true);
  assert.equal(answer.directoryChanged, undefined);

  // Values: only what was ticked.
  const css = await tmp.read('_systems/acme/tokens.css');
  assert.match(css, /--brand: #aaaaaa;/);
  assert.match(css, /--brand: #bababa;/);
  assert.match(css, /--mine: #bbbbbb;/);
  assert.match(css, /--fresh: 2px;/);
  assert.match(css, /--keep: #555555;/, 'an unticked change keeps the system value');
  assert.match(css, /--agent-only: 4px;/, "the agent's token stays");
  assert.match(css, /--surface: #222222;/);
  assert.ok(!css.includes('--gone'), 'the ticked removal is gone');

  // system.json: the note on --brand, the notes list and the old logo are kept; --gone's metadata is
  // gone, --fresh's added, the new logo listed after the old one.
  const json = JSON.parse(await tmp.read('_systems/acme/system.json')) as { tokens: Record<string, unknown>; notes: unknown; logos: unknown };
  assert.deepEqual(json.tokens['--brand'], { section: 'colours', group: 'brand', note: 'Primary actions only.' });
  assert.equal(json.tokens['--gone'], undefined);
  assert.equal(typeof (json.tokens['--fresh'] as { section: string }).section, 'string');
  assert.deepEqual(json.notes, [{ id: 'history', title: 'History' }]);
  assert.deepEqual(json.logos, [
    { file: 'assets/logos/old.svg', variant: 'primary' },
    { file: 'assets/logos/logo.svg', variant: 'primary' },
  ]);
  assert.equal(await tmp.read('_systems/acme/assets/logos/logo.svg'), SVG);
  assert.deepEqual(await kept(tmp), keptBefore, 'overview, notes and existing assets untouched');

  // state.json: provenance follows what was applied; the code source line is the new scan; a new revision.
  const state = await stateOf(tmp, 'acme');
  assert.deepEqual(state.provenance['--brand'], { file: 'theme.css', line: 2, light: '#aaaaaa', dark: '#bababa' });
  assert.deepEqual(state.provenance['--mine']?.light, '#bbbbbb');
  assert.deepEqual(state.provenance['--fresh']?.light, '2px');
  assert.equal(state.provenance['--gone'], undefined);
  assert.deepEqual(state.provenance['--keep'], beforeState.provenance['--keep'], 'an unticked change keeps its record, so it is offered again');
  assert.equal(state.provenance['--agent-only'], undefined);
  assert.notEqual(state.sources.code?.lastScan, undefined);
  assert.ok(state.revision.n > beforeState.revision.n, 'the revision moved on');

  // The next scan offers only what is left: --keep.
  const again = await scan(project.root, 'acme');
  assert.deepEqual(again.review?.changed, [{ name: '--keep', mode: 'light', from: '#555555', to: '#565656' }]);
  assert.deepEqual([again.review?.conflicts, again.review?.added, again.review?.removed, again.review?.assets], [[], [], [], []]);

  // Undo: the files as they were, the copied logo to the trash, the provenance put back.
  const undone = await call('POST', `/systems/acme/edits/${answer.edit.id}/undo`, {});
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.deepEqual((undone.json as SystemUndoEditResponse).files.sort(), ['assets/logos/logo.svg', 'system.json', 'tokens.css']);
  assert.equal(await tmp.read('_systems/acme/tokens.css'), beforeCss);
  assert.equal(await tmp.read('_systems/acme/system.json'), beforeJson);
  assert.deepEqual((await readdir(tmp.at('_systems/acme/assets/logos'))).sort(), ['old.svg']);
  const restored = await stateOf(tmp, 'acme');
  assert.deepEqual(restored.provenance, beforeState.provenance);
  assert.deepEqual(restored.sources.code, beforeState.sources.code);
  assert.deepEqual(await kept(tmp), keptBefore);
});

test('the version first is "Before re-sync" and holds the system as it was', async (t) => {
  const { tmp, ctx, call, scan, stampOf, project } = await prepare(t);
  const beforeCss = await tmp.read('_systems/acme/tokens.css');
  const { scanId } = await scan(project.root, 'acme');
  const applied = await call('POST', '/systems/acme/resync', { scanId, stamp: await stampOf('acme'), changes: ['--brand'] });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  const versions = ensureSystemVersions(ctx);
  const list = await versions.list('acme');
  const newest = list.versions.at(-1);
  assert.equal(newest?.reason, 'resync');
  assert.equal((applied.json as SystemResyncResponse).version?.id, newest?.id);
  const { source } = await versions.readTree('acme', newest?.id ?? '');
  const file = await source.read('tokens.css');
  assert.equal(file === null ? null : Buffer.from(file.bytes).toString('utf8'), beforeCss);
});

test('removals: only from "No longer in the code"; an agent token or an unlisted name is refused and nothing is written', async (t) => {
  const { tmp, call, scan, stampOf, project } = await prepare(t);
  const { scanId } = await scan(project.root, 'acme');
  const before = { css: await tmp.read('_systems/acme/tokens.css'), json: await tmp.read('_systems/acme/system.json'), state: await tmp.read('_systems/acme/.chamber/state.json') };
  const stamp = await stampOf('acme');
  for (const body of [
    { remove: ['--agent-only'] },
    { remove: ['--surface'] },
    { changes: ['--mine'] }, // a conflict is not a change
    { useCode: ['--brand'] },
    { add: ['--brand'] },
    { assets: ['theme.css'] },
    { assets: ['../../etc/passwd'] },
  ]) {
    const answer = await call('POST', '/systems/acme/resync', { scanId, stamp, ...body });
    assert.equal(answer.status, 409, JSON.stringify(body));
    assert.equal(messageOf(answer), resyncStaleMessage('Acme'));
  }
  const nothing = await call('POST', '/systems/acme/resync', { scanId, stamp });
  assert.deepEqual([nothing.status, messageOf(nothing)], [400, RESYNC_NOTHING_TICKED_MESSAGE]);
  assert.deepEqual({ css: await tmp.read('_systems/acme/tokens.css'), json: await tmp.read('_systems/acme/system.json'), state: await tmp.read('_systems/acme/.chamber/state.json') }, before);
  assert.equal(((await call('GET', '/systems/acme')).json as SystemDetail).tokens.some((token) => token.name === '--agent-only'), true);
});

test('a partial scan never offers a token from a file it did not read for removal', async (t) => {
  const rig = await serve(t);
  const { tmp, call, scan, stampOf } = rig;
  const project = await useTmpRoot(t, 'dc-project-');
  await project.write('a.css', ':root { --top: #111111; }');
  await project.write('deep/b.css', ':root { --deep: #222222; }');
  const made = await call('POST', '/systems', { name: 'Acme', code: { scanId: (await scan(project.root)).scanId, assets: [] } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal((await stateOf(tmp, 'acme')).provenance['--deep']?.file, 'deep/b.css');

  // The code drops --deep; this scan reads one candidate only (a.css), so it is partial.
  await project.write('deep/b.css', ':root { }');
  rig.reinstall({ limits: { candidates: 1 } });
  const { scanId, review } = await scan(project.root, 'acme');
  assert.equal(review?.partial, true);
  assert.deepEqual(review?.removed, []);
  const refused = await call('POST', '/systems/acme/resync', { scanId, stamp: await stampOf('acme'), remove: ['--deep'] });
  assert.equal(refused.status, 409);
  assert.match(await tmp.read('_systems/acme/tokens.css'), /--deep: #222222;/);
});

test('stale: the system changed after the scan, or the page sent an old stamp; nothing is written and no version taken', async (t) => {
  const { tmp, ctx, call, scan, stampOf, project } = await prepare(t);
  const { scanId } = await scan(project.root, 'acme');
  const stamp = await stampOf('acme');
  const versions = ensureSystemVersions(ctx);
  const count = (await versions.list('acme')).versions.length;

  const wrong = await call('POST', '/systems/acme/resync', { scanId, stamp: `${'0'.repeat(64)}:none`, changes: ['--brand'] });
  assert.deepEqual([wrong.status, messageOf(wrong)], [409, resyncStaleMessage('Acme')]);

  // The agent edits tokens.css after the scan.
  const css = (await tmp.read('_systems/acme/tokens.css')).replace('--surface: #222222;', '--surface: #232323;');
  await tmp.write('_systems/acme/tokens.css', css);
  const stale = await call('POST', '/systems/acme/resync', { scanId, stamp, changes: ['--brand'] });
  assert.deepEqual([stale.status, messageOf(stale)], [409, resyncStaleMessage('Acme')]);
  assert.equal(await tmp.read('_systems/acme/tokens.css'), css);
  assert.equal((await versions.list('acme')).versions.length, count, 'a refused re-sync takes no version');
});

test('the scan must be this system’s, under this Designs folder, and not expired', async (t) => {
  const { tmp, ctx, call, scan, stampOf, project } = await prepare(t);
  const other = await call('POST', '/systems', { name: 'Other' });
  assert.equal(other.status, 200);
  const { scanId } = await scan(project.root, 'acme');
  const stamp = await stampOf('acme');

  const wrongSystem = await call('POST', '/systems/other/resync', { scanId, stamp, changes: ['--brand'] });
  assert.deepEqual([wrongSystem.status, messageOf(wrongSystem)], [409, SCAN_OTHER_SYSTEM_MESSAGE]);
  const plainScan = (await scan(project.root)).scanId;
  const noSystem = await call('POST', '/systems/acme/resync', { scanId: plainScan, stamp, changes: ['--brand'] });
  assert.deepEqual([noSystem.status, messageOf(noSystem)], [409, SCAN_OTHER_SYSTEM_MESSAGE]);
  const unknown = await call('POST', '/systems/acme/resync', { scanId: 'sc_abcdefghijklmnop', stamp, changes: ['--brand'] });
  assert.deepEqual([unknown.status, messageOf(unknown)], [404, SCAN_GONE_MESSAGE]);

  // A root change drops the scan (and the system is not in the new root): nothing is written in the old one.
  const before = await tmp.read('_systems/acme/tokens.css');
  await ctx.settings.update({ root: (await useTmpRoot(t, 'dc-root2-')).root });
  const moved = await call('POST', '/systems/acme/resync', { scanId, stamp, changes: ['--brand'] });
  assert.equal(moved.status, 404);
  assert.equal(await tmp.read('_systems/acme/tokens.css'), before);
});

test('a root change while the apply waits for the chain answers "Your Designs folder changed" and writes nothing', async (t) => {
  const { tmp, ctx, scan, stampOf, project } = await prepare(t);
  const { scanId } = await scan(project.root, 'acme');
  const stamp = await stampOf('acme');
  const systems = ensureSystemStore(ctx);
  const before = await tmp.read('_systems/acme/tokens.css');
  const real = (await import('../../../src/service/systems/extract.ts')).ensureScanJobs(ctx);
  const source = real.resyncSource(scanId, 'acme');
  // The scan as the apply saw it before the chain; the root reads differently by the time it runs.
  const edits = createSystemEditService({
    systems,
    versions: ensureSystemVersions(ctx),
    hub: ctx.hub,
    selfWrites: ctx.selfWrites,
    settings: ctx.settings,
    log: ctx.log,
    scans: { resyncSource: () => ({ ...source, root: `${source.root}-elsewhere` }) },
  });
  await assert.rejects(edits.resync('acme', parseSystemResyncRequest({ scanId, stamp, changes: ['--brand'] })), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.deepEqual([error.code, error.message], ['conflict', RESYNC_ROOT_CHANGED_MESSAGE]);
    return true;
  });
  assert.equal(await tmp.read('_systems/acme/tokens.css'), before);
});

test('the route: 401 without the token, traversal refused, a malformed body is 400 before anything is read', async (t) => {
  const { tmp, call, scan, stampOf, project } = await prepare(t);
  const { scanId } = await scan(project.root, 'acme');
  const stamp = await stampOf('acme');
  const before = await tmp.read('_systems/acme/tokens.css');
  for (const token of [null, 'wrong-token']) {
    const answer = await call('POST', '/systems/acme/resync', { scanId, stamp, changes: ['--brand'] }, token);
    assert.equal(answer.status, 401);
  }
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b', '..', 'C%3A']) {
    const answer = await call('POST', `/systems/${hostile}/resync`, { scanId, stamp, changes: ['--brand'] });
    assert.ok(answer.status === 400 || answer.status === 404, `${hostile}: ${answer.status}`);
  }
  for (const body of [
    null,
    [],
    { scanId, stamp: 'nope', changes: ['--brand'] },
    { scanId: '../x', stamp, changes: ['--brand'] },
    { scanId, stamp, changes: ['brand'] },
    { scanId, stamp, changes: ['--brand', '--brand'] },
    { scanId, stamp, changes: '--brand' },
    { scanId, stamp, assets: ['a\u0000b'] },
    { scanId, stamp, assets: Array.from({ length: 41 }, (_, k) => `f${k}.svg`) },
  ]) {
    const answer = await call('POST', '/systems/acme/resync', body);
    assert.equal(answer.status, 400, JSON.stringify(body));
  }
  assert.equal(await tmp.read('_systems/acme/tokens.css'), before);
  assert.deepEqual(await readFile(tmp.at('_systems/acme/assets/logos/old.svg'), 'utf8'), OLD_SVG);
});

test('T19: a re-sync records a tailwindcss import the code has gained', async (t) => {
  const { tmp, call, scan, stampOf, project } = await prepare(t);
  assert.equal((await stateOf(tmp, 'acme')).sources.code?.tailwind, undefined);
  await project.write('theme.css', `@import "tailwindcss";\n${SECOND}`);
  const { scanId } = await scan(project.root, 'acme');
  const applied = await call('POST', '/systems/acme/resync', { scanId, stamp: await stampOf('acme'), changes: ['--brand'], useCode: [], add: [], remove: [], assets: [] });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal((await stateOf(tmp, 'acme')).sources.code?.tailwind, true);
});
