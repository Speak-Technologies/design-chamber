// Token export over HTTP (documentation/specs/system-builder-depth.md §13 T19): the bearer check, the id
// through the system store (traversal and links), the closed body, Tailwind only for a project that uses
// it, the ZIP written to the export folder and issued to /reveal, a repo-backed system read from its
// snapshot, and no write anywhere in the project.

import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { SystemExportOptionsResponse, SystemExportResponse } from '../../../src/shared/api.ts';
import { createServiceClient } from '../../../src/guest/service-client.ts';
import type { BuildJson, SystemState } from '../../../src/shared/types.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { runBuildScan } from '../../../src/service/systems/drift.ts';
import { NO_TOKENS_TO_EXPORT, registerExportRoutes, TAILWIND_NOT_USED, usesTailwind } from '../../../src/service/routes/export.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { readZip } from '../render/zip-reader.ts';
import { fingerprintTree } from './repo-fixture.ts';

const TOKEN = 'system-export-token-0123456789';
const TOKENS = ':root {\n  --brand: #1a73e8;\n  --space-2: 8px;\n  --bad: url(x.png);\n}\n';

const serve = async (t: TestContext, settings: { downloadsDir?: string } = {}) => {
  const tmp = await useTmpRoot(t);
  const downloads = await useTmpRoot(t, 'dc-downloads-');
  const project = await useTmpRoot(t, 'dc-project-');
  const ctx = createFakeContext({
    root: tmp.root,
    // Never the real Downloads folder.
    settings: { downloadsDir: settings.downloadsDir ?? downloads.root },
    overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } },
  });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerExportRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as AddressInfo;
  assert.equal(address.address, '127.0.0.1');
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN): Promise<{ status: number; json: unknown }> => {
    const answer = await fetch(`http://127.0.0.1:${address.port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: await answer.json() };
  };
  const systems = ensureSystemStore(ctx);
  await systems.create({ name: 'Acme' });
  await tmp.write('_systems/acme/tokens.css', TOKENS);
  const patchState = (change: (state: SystemState) => SystemState): Promise<void> => systems.withLock('acme', () => systems.updateStateLocked('acme', change));
  /** The system as made from the code in `directory`. */
  const fromCode = (directory: string, extra: Partial<NonNullable<SystemState['sources']['code']>> = {}): Promise<void> =>
    patchState((state) => ({ ...state, sources: { ...state.sources, code: { directory, lastScan: '2026-11-27T10:00:00.000Z', partial: false, scanned: [], ...extra } } }));
  const formats = async (): Promise<string[]> => {
    const answer = await call('GET', '/systems/acme/export');
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    return (answer.json as SystemExportOptionsResponse).formats;
  };
  const exported = async (body: unknown = {}): Promise<SystemExportResponse & { files: Map<string, string> }> => {
    const answer = await call('POST', '/systems/acme/export', body);
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    const result = answer.json as SystemExportResponse;
    const files = new Map(readZip(await readFile(result.path)).map((entry) => [entry.name, entry.data.toString('utf8')]));
    return { ...result, files };
  };
  const written = async (): Promise<string[]> => (await readdir(downloads.root)).sort();
  return { tmp, downloads, project, ctx, systems, call, patchState, fromCode, formats, exported, written };
};

const URLS = [['GET', '/systems/acme/export'], ['POST', '/systems/acme/export']] as const;
const errorOf = (answer: { json: unknown }): { error: string; message: string } => answer.json as { error: string; message: string };

test('both export routes refuse a missing or wrong token with 401, and nothing is written', async (t) => {
  const { call, written } = await serve(t);
  for (const token of [null, 'wrong-token', `${TOKEN}x`]) {
    for (const [method, url] of URLS) {
      const answer = await call(method, url, method === 'POST' ? {} : undefined, token);
      assert.equal(answer.status, 401, `${method} ${String(token)}`);
      assert.equal(errorOf(answer).error, 'unauthorized');
    }
  }
  assert.deepEqual(await written(), []);
});

test('a traversal or invalid system id is refused on both routes; an unknown system is 404; nothing is written', async (t) => {
  const { call, written } = await serve(t);
  for (const [method] of URLS) {
    const body = method === 'POST' ? {} : undefined;
    for (const hostile of ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b', 'C%3A%5Cx']) {
      const answer = await call(method, `/systems/${hostile}/export`, body);
      assert.equal(answer.status, 400, `${method} ${hostile}`);
      assert.equal(errorOf(answer).error, 'bad-path');
    }
    for (const bad of ['Acme', '_systems', '.chamber', 'C%3A', 'a..b']) assert.equal((await call(method, `/systems/${bad}/export`, body)).status, 400, bad);
    assert.equal((await call(method, '/systems/ghost/export', body)).status, 404);
  }
  assert.deepEqual(await written(), []);
});

test('a linked system folder is not a system, and a linked tokens.css is never read into an export', { skip: process.platform === 'win32' }, async (t) => {
  const { tmp, project, call, written } = await serve(t);
  await project.write('outside/tokens.css', ':root { --leak: #123456; }');
  await symlink(project.at('outside'), tmp.at('_systems/linked'), 'dir');
  assert.equal((await call('POST', '/systems/linked/export', {})).status, 404);
  await mkdir(tmp.at('_systems/sly'), { recursive: true });
  await symlink(project.at('outside/tokens.css'), tmp.at('_systems/sly/tokens.css'), 'file');
  const answer = await call('POST', '/systems/sly/export', {});
  assert.equal(answer.status, 422);
  assert.equal(errorOf(answer).message, NO_TOKENS_TO_EXPORT);
  assert.deepEqual(await written(), []);
});

test('the export is one ZIP in the export folder, holding checked values only', async (t) => {
  const { downloads, exported, formats, written } = await serve(t);
  assert.deepEqual(await formats(), ['dtcg', 'css']);
  const result = await exported();
  assert.equal(result.path, path.join(downloads.root, 'acme-tokens.zip'));
  assert.equal(result.bytes, (await readFile(result.path)).length);
  assert.deepEqual(result.formats, ['dtcg', 'css']);
  assert.equal(result.renamed, 0);
  assert.deepEqual([...result.files.keys()], ['tokens.json', 'tokens.css', 'README.txt']);
  assert.equal(result.files.get('tokens.css'), '/* Design tokens exported from Design Chamber. */\n:root {\n  --brand: #1a73e8;\n  --space-2: 8px;\n}\n');
  assert.match(result.files.get('README.txt') ?? '', /--bad \(light\)/);
  for (const text of [result.files.get('tokens.css'), result.files.get('tokens.json')]) assert.ok(!text?.includes('url('));

  // A second export never overwrites the first; one format asked for gives that file only.
  const second = await exported({ formats: ['css'] });
  assert.equal(path.basename(second.path), 'acme-tokens (2).zip');
  assert.deepEqual([...second.files.keys()], ['tokens.css', 'README.txt']);
  assert.deepEqual(await written(), ['acme-tokens (2).zip', 'acme-tokens.zip']);
});

test('renamed counts the JSON names that were suffixed', async (t) => {
  const { tmp, exported } = await serve(t);
  await tmp.write('_systems/acme/tokens.css', ':root { --gap: 1px; --Gap: 2px; }');
  const result = await exported();
  assert.equal(result.renamed, 1);
  assert.match(result.files.get('README.txt') ?? '', /--Gap is spacing\.Gap-2/);
  assert.equal((await exported({ formats: ['css'] })).renamed, 0);
});

test('the written path is issued to the reveal registry; a path that was not is refused', async (t) => {
  const { downloads, call, exported } = await serve(t);
  const result = await exported();
  // Removed first, so reveal answers without opening a file manager: 404 only for a path it issued.
  await (await import('node:fs/promises')).rm(result.path);
  const issued = await call('POST', '/reveal', { path: result.path });
  assert.equal(issued.status, 404, JSON.stringify(issued.json));
  const other = await call('POST', '/reveal', { path: path.join(downloads.root, 'other-tokens.zip') });
  assert.equal(errorOf(other).error, 'bad-path');
});

test('without a usable export folder the ZIP goes to <root>/.exports', async (t) => {
  const blocker = await useTmpRoot(t);
  await blocker.write('file', 'not a folder');
  const { tmp, exported } = await serve(t, { downloadsDir: blocker.at('file/inside') });
  const result = await exported();
  // The default Downloads folder is never tried here: the configured one fails, then the fallback.
  assert.equal(result.path, tmp.at('.exports/acme-tokens.zip'));
});

test('the body is a closed set', async (t) => {
  const { call, written } = await serve(t);
  const bad: unknown[] = [[], 'dtcg', 3, null, { format: 'css' }, { formats: ['css'], path: '/etc' }, { formats: 'css' }, { formats: [] }, { formats: ['css', 'css'] }, { formats: ['scss'] }, { formats: ['__proto__'] }, { formats: [1] }];
  for (const body of bad) {
    const answer = await call('POST', '/systems/acme/export', body);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.equal(errorOf(answer).error, 'bad-request');
  }
  assert.deepEqual(await written(), []);
});

test('Tailwind is refused with a plain sentence when the project does not use it', async (t) => {
  const { project, call, fromCode, formats, written } = await serve(t);
  await fromCode(project.root);
  assert.deepEqual(await formats(), ['dtcg', 'css']);
  for (const body of [{ formats: ['tailwind'] }, { formats: ['css', 'tailwind'] }]) {
    const answer = await call('POST', '/systems/acme/export', body);
    assert.equal(answer.status, 422);
    assert.deepEqual(answer.json, { error: 'invalid', message: TAILWIND_NOT_USED });
  }
  assert.deepEqual(await written(), []);
});

test("a tailwind.config at the code folder's root offers Tailwind, without the file being read", async (t) => {
  const { project, fromCode, formats, exported } = await serve(t);
  const config = await project.write('tailwind.config.ts', 'throw new Error("never run");');
  // Unreadable (where the OS enforces it): a `stat` still answers, a read would fail.
  await chmod(config, 0o000);
  t.after(() => chmod(config, 0o600).catch(() => undefined)); // the folder may be gone already
  await fromCode(project.root);
  assert.deepEqual(await formats(), ['dtcg', 'css', 'tailwind']);
  const result = await exported({ formats: ['tailwind'] });
  assert.deepEqual(result.formats, ['tailwind']);
  assert.match(result.files.get('tailwind-theme.css') ?? '', /@theme \{\n {2}--brand: #1a73e8;\n {2}--space-2: 8px;\n\}\n$/);
  assert.deepEqual((await exported()).formats, ['dtcg', 'css', 'tailwind']);
});

test('what counts as using Tailwind: the config at the root, the project of a location, the scan list, BUILD.json', async (t) => {
  const project = await useTmpRoot(t);
  await project.write('sub/tailwind.config.js', '');
  await mkdir(project.at('dir/tailwind.config.js'), { recursive: true });
  await project.write('named/tailwind.config.json', '');
  const state = (code: Partial<NonNullable<SystemState['sources']['code']>> | null): SystemState =>
    // Safe: only `sources.code` is read.
    ({ sources: { code: code === null ? null : { directory: project.root, lastScan: 'x', partial: false, scanned: [], ...code }, brand: null, description: null } }) as SystemState;
  const none = { agentDrift: null };
  const drift = (kinds: string[]): { agentDrift: BuildJson['drift'] & object } => ({ agentDrift: { differ: 1, kinds, note: '' } });

  assert.equal(await usesTailwind(state(null), none), false);
  assert.equal(await usesTailwind(state({}), none), false, 'a config in a subfolder is not at the root');
  assert.equal(await usesTailwind(state({ directory: project.at('dir') }), none), false, 'a folder of that name');
  assert.equal(await usesTailwind(state({ directory: project.at('named') }), none), false, 'another extension');
  assert.equal(await usesTailwind(state({ directory: 'sub' }), none), false, 'a relative folder is never looked at');
  for (const name of ['js', 'cjs', 'mjs', 'ts']) {
    await project.write(`${name}/tailwind.config.${name}`, '');
    assert.equal(await usesTailwind(state({ directory: project.at(name) }), none), true, name);
  }
  assert.equal(await usesTailwind(state({ directory: project.at('dir'), project: project.at('sub') }), none), true);
  assert.equal(await usesTailwind(state({ forAgent: [{ path: 'apps/web/tailwind.config.cjs', why: 'x' }] }), none), true);
  assert.equal(await usesTailwind(state({ forAgent: [{ path: 'src/theme.ts', why: 'Tailwind config' }] }), none), false);
  assert.equal(await usesTailwind(state(null), drift(['tailwind-config'])), true);
  assert.equal(await usesTailwind(state(null), drift(['js-theme', 'scss'])), false);
});

test('Tailwind v4 with no config file: the build scan notes the CSS import, and forgets it once it is gone', async (t) => {
  const { ctx, project, fromCode, formats, systems } = await serve(t);
  await project.write('src/app.css', '@import "tailwindcss";\n@theme { --color-brand: #111111; }\n');
  // package.json is not one of the files the scan opens, so it decides nothing.
  await project.write('package.json', { dependencies: { tailwindcss: '^4' } });
  await fromCode(project.root);
  assert.deepEqual(await formats(), ['dtcg', 'css']);
  await runBuildScan(ctx, 'acme', project.root);
  assert.equal((await systems.readState('acme')).sources.code?.tailwind, true);
  assert.deepEqual(await formats(), ['dtcg', 'css', 'tailwind']);
  await project.write('src/app.css', ':root { --color-brand: #111111; }\n');
  await runBuildScan(ctx, 'acme', project.root);
  assert.equal((await systems.readState('acme')).sources.code?.tailwind, undefined);
  assert.deepEqual(await formats(), ['dtcg', 'css']);
});

test("BUILD.json's drift kind reaches the route", async (t) => {
  const { tmp, formats } = await serve(t);
  await tmp.write('_systems/acme/BUILD.json', {
    version: 1,
    ticket: null,
    name: 'Acme',
    home: 'internal',
    repo: null,
    code: null,
    mode: 'none',
    drift: { differ: 1, kinds: ['tailwind-config'], note: 'The config has its own colours.' },
  });
  assert.deepEqual(await formats(), ['dtcg', 'css', 'tailwind']);
});

test('no tokens, or a system.json that cannot be read, is refused with its sentence', async (t) => {
  const { tmp, call, written } = await serve(t);
  await tmp.write('_systems/acme/tokens.css', ':root { --bad: url(x); }');
  const empty = await call('POST', '/systems/acme/export', {});
  assert.deepEqual([empty.status, errorOf(empty).message], [422, NO_TOKENS_TO_EXPORT]);
  await tmp.write('_systems/acme/tokens.css', TOKENS);
  await writeFile(tmp.at('_systems/acme/system.json'), '{ not json');
  const unreadable = await call('POST', '/systems/acme/export', {});
  assert.equal(unreadable.status, 422);
  assert.match(errorOf(unreadable).message, /^Design Chamber can't read this design system\./);
  assert.deepEqual(await written(), []);
});

test('a repo-backed system exports its snapshot, and nothing in the project changes', async (t) => {
  const { tmp, project, patchState, fromCode, exported } = await serve(t);
  await project.write('tailwind.config.js', 'module.exports = {};');
  await project.write('design-system/tokens.css', ':root { --brand: #000000; }');
  await fromCode(project.root);
  await patchState((state) => ({
    ...state,
    home: { kind: 'repo', directory: project.root, folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: '2026-11-27T09:00:00.000Z' },
  }));
  await tmp.write('_systems/acme/snapshot/tokens.css', ':root { --brand: #abcdef; }');
  const before = await fingerprintTree(project.root);
  const result = await exported();
  assert.match(result.files.get('tokens.css') ?? '', /--brand: #abcdef;/, 'the snapshot, not the home folder or the repo');
  assert.deepEqual(result.formats, ['dtcg', 'css', 'tailwind']);
  assert.deepEqual(await fingerprintTree(project.root), before);
});

test('the guest client calls the two export routes, with no formats meaning all', async () => {
  const requests: unknown[] = [];
  const client = createServiceClient({
    serviceRequest: async (request) => {
      requests.push(request);
      return { status: 200, headers: {}, body: '{}' };
    },
  });
  await client.systemExportFormats('acme');
  await client.exportSystemTokens('acme');
  await client.exportSystemTokens('acme', ['css']);
  assert.deepEqual(requests, [
    { method: 'GET', path: '/systems/acme/export' },
    { method: 'POST', path: '/systems/acme/export', body: '{}' },
    { method: 'POST', path: '/systems/acme/export', body: '{"formats":["css"]}' },
  ]);
});
