// Brand files over HTTP (documentation/specs/phase-2-5-technical.md §3.1, §5.6, AD-8): the bearer check, the
// id gate (traversal), a base64 upload into a real system store, the checks by type and content, safe and
// unused names (device names, clashes ignoring case, never over a file already there), the per-system
// caps, system.json recorded by compare-and-swap under the system's lock, and Add from a folder (contained:
// never the Designs folder, links never followed, refused types never opened).

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { AddSystemAssetResponse, AssetsFromFolderResponse, CreateSystemResponse } from '../../../src/shared/api.ts';
import { SYSTEM_BYTES_MAX, SYSTEM_FILES_MAX } from '../../../src/shared/limits.ts';
import type { SystemDetail, SystemState } from '../../../src/shared/types.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemAssetRoutes } from '../../../src/service/routes/system-assets.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { registerUploadsRoutes } from '../../../src/service/routes/uploads.ts';
import { createUploadStore } from '../../../src/service/uploads.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'assets-routes-token-0123456789';

const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'latin1'), randomBytes(300)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(200)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', 'utf8');
const PDF = Buffer.from('%PDF-1.7\n%…\n', 'utf8');

type Answer = { status: number; json: unknown };

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({
    root: tmp.root,
    overrides: { uploads: createUploadStore(), designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } },
  });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerUploadsRoutes(router, ctx);
  registerSystemAssetRoutes(router, ctx);
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
  /** The guest's chunker: POST /uploads { base64 }, then 60 000-character chunks. */
  const upload = async (bytes: Buffer): Promise<string> => {
    const text = bytes.toString('base64');
    const created = await call('POST', '/uploads', { total: text.length, encoding: 'base64' });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const { uploadId } = created.json as { uploadId: string };
    for (let at = 0, index = 0; at < text.length || index === 0; at += 60_000, index += 1) {
      if (text.length === 0) break;
      const put = await call('PUT', `/uploads/${uploadId}/${index}`, { data: text.slice(at, at + 60_000) });
      assert.equal(put.status, 200, JSON.stringify(put.json));
    }
    return uploadId;
  };
  const add = async (bytes: Buffer, name: string, kind: 'font' | 'logo' | 'source', id = 'acme'): Promise<Answer> =>
    call('POST', `/systems/${id}/assets`, { uploadId: await upload(bytes), name, kind });
  const made = await call('POST', '/systems', { name: 'Acme', brand: true });
  assert.equal(made.status, 200);
  assert.equal((made.json as CreateSystemResponse).id, 'acme');
  const at = (rel: string): string => tmp.at(`_systems/acme/${rel}`);
  const state = async (): Promise<SystemState> => JSON.parse(await readFile(at('.chamber/state.json'), 'utf8')) as SystemState;
  return { tmp, ctx, call, upload, add, at, state };
};

const messageOf = (answer: Answer): string => (answer.json as { message: string }).message;

test('both routes refuse a missing or wrong token with 401 and write nothing', async (t) => {
  const { call, upload, at } = await serve(t);
  const uploadId = await upload(SVG);
  for (const token of [null, 'wrong-token']) {
    assert.equal((await call('POST', '/systems/acme/assets', { uploadId, name: 'a.svg', kind: 'logo' }, token)).status, 401);
    assert.equal((await call('POST', '/systems/acme/assets/from-folder', { directory: '/tmp' }, token)).status, 401);
  }
  await assert.rejects(readdir(at('assets')), { code: 'ENOENT' });
  // The upload was not consumed by the refused calls.
  assert.equal((await call('POST', '/systems/acme/assets', { uploadId, name: 'a.svg', kind: 'logo' })).status, 200);
});

test('a repo-backed system refuses both routes with 422 read-only and writes nothing (AD-20)', async (t) => {
  const { tmp, call, upload, at, state } = await serve(t);
  const home = { kind: 'repo', directory: path.join(tmp.root, 'shop'), folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: '2026-11-20T10:00:00.000Z' };
  await writeFile(at('.chamber/state.json'), `${JSON.stringify({ ...(await state()), home }, null, 2)}\n`);
  const systemJsonBefore = await readFile(at('system.json'), 'utf8');
  const sentence = 'Acme lives in shop. Change the values there, or ask the agent here.';

  const uploadId = await upload(SVG);
  const added = await call('POST', '/systems/acme/assets', { uploadId, name: 'a.svg', kind: 'logo' });
  assert.equal(added.status, 422);
  assert.deepEqual(added.json, { error: 'read-only', message: sentence });
  // The upload was dropped with the refusal, never kept in memory for a retry.
  assert.equal((await call('POST', '/systems/acme/assets', { uploadId, name: 'a.svg', kind: 'logo' })).status, 422);

  const brand = path.join(tmp.root, 'brand');
  await mkdir(brand, { recursive: true });
  await writeFile(path.join(brand, 'logo.svg'), SVG);
  const folder = await call('POST', '/systems/acme/assets/from-folder', { directory: brand });
  assert.equal(folder.status, 422);
  assert.deepEqual(folder.json, { error: 'read-only', message: sentence });
  // Refused before the folder is looked at: a folder that is not there answers the same.
  assert.equal((await call('POST', '/systems/acme/assets/from-folder', { directory: path.join(tmp.root, 'gone') })).status, 422);

  await assert.rejects(readdir(at('assets')), { code: 'ENOENT' });
  assert.equal(await readFile(at('system.json'), 'utf8'), systemJsonBefore);
});

test('a traversal or invalid id is refused before any path is built; an unknown system keeps the upload', async (t) => {
  const { call, upload } = await serve(t);
  const uploadId = await upload(SVG);
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b']) {
    for (const suffix of ['assets', 'assets/from-folder']) {
      const answer = await call('POST', `/systems/${hostile}/${suffix}`, { uploadId, name: 'a.svg', kind: 'logo', directory: '/tmp' });
      assert.equal(answer.status, 400, `${hostile} ${suffix}`);
      assert.equal((answer.json as { error: string }).error, 'bad-path');
    }
  }
  for (const bad of ['Acme', '_systems', '.chamber', 'C%3A']) {
    const answer = await call('POST', `/systems/${bad}/assets`, { uploadId, name: 'a.svg', kind: 'logo' });
    assert.equal(answer.status, 400, bad);
  }
  const ghost = await call('POST', '/systems/ghost/assets', { uploadId, name: 'a.svg', kind: 'logo' });
  assert.equal(ghost.status, 404);
  assert.equal(messageOf(ghost), 'That design system is no longer in your Designs folder.');
  assert.equal((await call('POST', '/systems/acme/assets', { uploadId, name: 'a.svg', kind: 'logo' })).status, 200);
});

test('bodies are validated with sentences', async (t) => {
  const { call } = await serve(t);
  const cases: [string, unknown, string][] = [
    ['assets', [], 'Name the upload, the file name and its kind.'],
    ['assets', { uploadId: '../x', name: 'a.svg', kind: 'logo' }, 'That is not an upload id.'],
    ['assets', { uploadId: 'u_abcdefghij', name: '', kind: 'logo' }, 'A file name is 1 to 255 characters.'],
    ['assets', { uploadId: 'u_abcdefghij', name: 'a\u0000.svg', kind: 'logo' }, 'A file name is 1 to 255 characters.'],
    ['assets', { uploadId: 'u_abcdefghij', name: 'a.svg', kind: 'picture' }, 'A brand file is a font, a logo or a source.'],
    ['assets/from-folder', {}, 'Name the folder to add brand files from.'],
    ['assets/from-folder', { directory: 5 }, 'Name the folder to add brand files from.'],
  ];
  for (const [suffix, body, message] of cases) {
    const answer = await call('POST', `/systems/acme/${suffix}`, body);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.equal(messageOf(answer), message);
  }
  const encoding = await call('POST', '/uploads', { total: 4, encoding: 'hex' });
  assert.equal(encoding.status, 400);
  assert.equal(messageOf(encoding), 'An upload is sent as "text" or "base64".');
});

test('a font upload is written, recorded in system.json and state.json, announced, and a new revision', async (t) => {
  const { ctx, call, add, at, state } = await serve(t);
  const before = (await call('GET', '/systems/acme')).json as SystemDetail;
  const answer = await add(WOFF2, 'Inter-SemiBold.woff2', 'font');
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  assert.deepEqual(answer.json as AddSystemAssetResponse, { asset: { file: 'assets/fonts/Inter-SemiBold.woff2', kind: 'font', bytes: WOFF2.length }, refused: null });
  assert.ok((await readFile(at('assets/fonts/Inter-SemiBold.woff2'))).equals(WOFF2));
  const json = JSON.parse(await readFile(at('system.json'), 'utf8')) as { version: number; tokens: object; fonts: unknown[] };
  assert.equal(json.version, 1);
  assert.deepEqual(json.tokens, {}, 'the seed keys are kept');
  assert.deepEqual(json.fonts, [{ file: 'assets/fonts/Inter-SemiBold.woff2', family: 'Inter', weight: 600, style: 'normal' }]);
  assert.deepEqual((await state()).sources.brand, { files: ['assets/fonts/Inter-SemiBold.woff2'] });
  const event = ctx.events.find((one) => one.kind === 'system' && one.systemChange === 'files');
  assert.deepEqual(event?.files, ['assets/fonts/Inter-SemiBold.woff2', 'system.json']);
  assert.equal(event?.origin, 'user');
  const after = (await call('GET', '/systems/acme')).json as SystemDetail;
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.fonts, [{ file: 'assets/fonts/Inter-SemiBold.woff2', family: 'Inter', weight: 600, style: 'normal' }]);
  // No temp file is left behind.
  assert.deepEqual(await readdir(at('assets/fonts')), ['Inter-SemiBold.woff2']);
});

test('a content mismatch is refused with 422, writes nothing, and the upload is gone', async (t) => {
  const { call, upload, at } = await serve(t);
  const uploadId = await upload(JPEG);
  const answer = await call('POST', '/systems/acme/assets', { uploadId, name: 'logo.png', kind: 'logo' });
  assert.equal(answer.status, 422);
  assert.equal(messageOf(answer), "logo.png isn't a real PNG file.");
  const fontAnswer = await call('POST', '/systems/acme/assets', { uploadId: await upload(PNG), name: 'Inter.woff2', kind: 'font' });
  assert.equal(messageOf(fontAnswer), "This font file can't be used.");
  const typeAnswer = await call('POST', '/systems/acme/assets', { uploadId: await upload(PDF), name: 'brand.key', kind: 'source' });
  assert.equal(messageOf(typeAnswer), "brand.key isn't a file type design systems use.");
  await assert.rejects(readdir(at('assets')), { code: 'ENOENT' });
  const again = await call('POST', '/systems/acme/assets', { uploadId, name: 'logo.jpg', kind: 'logo' });
  assert.equal(again.status, 404, 'an upload is taken once, whatever the answer');
});

test('safe names: path parts dropped, Windows device names, clashes ignoring case, never over an existing file', async (t) => {
  const { tmp, add, at } = await serve(t);
  const fileOf = async (bytes: Buffer, name: string, kind: 'font' | 'logo' | 'source'): Promise<string> => {
    const answer = await add(bytes, name, kind);
    assert.equal(answer.status, 200, `${name}: ${JSON.stringify(answer.json)}`);
    return (answer.json as AddSystemAssetResponse).asset.file;
  };
  assert.equal(await fileOf(SVG, '../../../evil.svg', 'logo'), 'assets/logos/evil.svg');
  assert.equal(await fileOf(SVG, 'C:\\Users\\me\\Logo.svg', 'logo'), 'assets/logos/Logo.svg');
  assert.equal(await fileOf(SVG, 'logo.SVG', 'logo'), 'assets/logos/logo-2.svg', 'a clash ignoring case');
  assert.equal(await fileOf(SVG, 'LOGO.svg', 'logo'), 'assets/logos/LOGO-3.svg');
  assert.equal(await fileOf(PNG, 'NUL.png', 'logo'), 'assets/logos/NUL-file.png');
  assert.equal(await fileOf(WOFF2, 'con.woff2', 'font'), 'assets/fonts/con-file.woff2');
  assert.equal(await fileOf(PDF, 'com1.pdf', 'source'), 'sources/com1-file.pdf');
  // A file the agent put there is never replaced.
  await tmp.write('_systems/acme/sources/guide.pdf', 'the agent’s guide');
  assert.equal(await fileOf(PDF, 'guide.pdf', 'source'), 'sources/guide-2.pdf');
  assert.equal(await readFile(at('sources/guide.pdf'), 'utf8'), 'the agent’s guide');
  const json = JSON.parse(await readFile(at('system.json'), 'utf8')) as { logos: { file: string }[] };
  assert.deepEqual(json.logos.map((logo) => logo.file), ['assets/logos/evil.svg', 'assets/logos/Logo.svg', 'assets/logos/logo-2.svg', 'assets/logos/LOGO-3.svg', 'assets/logos/NUL-file.png']);
  // Nothing escaped the system folder.
  await assert.rejects(readFile(tmp.at('evil.svg')), { code: 'ENOENT' });
});

test('per-system caps: 200 files and 100 MB across assets/ and sources/', async (t) => {
  const { add, at } = await serve(t);
  await mkdir(at('sources'), { recursive: true });
  for (let index = 0; index < SYSTEM_FILES_MAX; index += 1) await writeFile(at(`sources/n${index}.md`), 'x');
  const full = await add(SVG, 'a.svg', 'logo');
  assert.equal(full.status, 422);
  assert.equal(messageOf(full), 'This design system already holds 200 files.');
  await assert.rejects(readdir(at('assets/logos')), { code: 'ENOENT' });

  // Bytes: one large (sparse) file, then one that would cross the line, then one at it.
  await rm(at('sources'), { recursive: true, force: true });
  await mkdir(at('sources'));
  await writeFile(at('sources/big.pdf'), '');
  await truncate(at('sources/big.pdf'), SYSTEM_BYTES_MAX - 100);
  const over = await add(PNG, 'b.png', 'logo');
  assert.equal(over.status, 422);
  assert.equal(messageOf(over), 'b.png would take this design system over 100 MB of files.');
  assert.equal((await add(SVG, 'tiny.svg', 'logo')).status, 200, `${SVG.length} bytes still fit`);
  await truncate(at('sources/big.pdf'), SYSTEM_BYTES_MAX);
  const atCap = await add(SVG, 'more.svg', 'logo');
  assert.equal(messageOf(atCap), 'This design system already holds 100 MB of files.');
});

test('system.json: a broken file is never written over (409, the file stays); concurrent additions are all recorded', async (t) => {
  const { tmp, call, upload, add, at } = await serve(t);
  await tmp.write('_systems/acme/system.json', '{ "version": 1, "tokens": ');
  const answer = await add(SVG, 'acme.svg', 'logo');
  assert.equal(answer.status, 409);
  assert.equal(messageOf(answer), "Couldn't record acme.svg in system.json. Ask the agent to add it.");
  assert.ok((await readFile(at('assets/logos/acme.svg'))).equals(SVG), 'the file stays');
  assert.equal(await readFile(at('system.json'), 'utf8'), '{ "version": 1, "tokens": ', 'the agent’s file is untouched');

  await tmp.write('_systems/acme/system.json', { version: 1, tokens: {}, note: 'kept' });
  // Two uploads (the most that may be open) added at once: the lock and the compare-and-swap keep both.
  const [first, second] = await Promise.all([upload(PNG), upload(WOFF2)]);
  const both = await Promise.all([
    call('POST', '/systems/acme/assets', { uploadId: first, name: 'mark.png', kind: 'logo' }),
    call('POST', '/systems/acme/assets', { uploadId: second, name: 'Brand-Bold.woff2', kind: 'font' }),
  ]);
  assert.deepEqual(both.map((one) => one.status), [200, 200]);
  const json = JSON.parse(await readFile(at('system.json'), 'utf8')) as { note: string; logos: unknown[]; fonts: unknown[] };
  assert.equal(json.note, 'kept');
  assert.deepEqual(json.logos, [{ file: 'assets/logos/mark.png', variant: 'mark' }]);
  assert.deepEqual(json.fonts, [{ file: 'assets/fonts/Brand-Bold.woff2', family: 'Brand', weight: 700, style: 'normal' }]);
});

test('a link where a target folder should be is refused, never written through', async (t) => {
  const { tmp, add, at } = await serve(t);
  const outside = await useTmpRoot(t);
  await mkdir(at('assets'), { recursive: true });
  try {
    await symlink(outside.root, at('assets/logos'), 'dir');
  } catch {
    t.skip('this system cannot make folder links');
    return;
  }
  const answer = await add(SVG, 'acme.svg', 'logo');
  // Containment sees the link leave the system (400 bad-path) before the plain-folder check would.
  assert.equal(answer.status, 400);
  assert.equal((answer.json as { error: string }).error, 'bad-path');
  assert.deepEqual(await readdir(outside.root), []);
  void tmp;
});

test('Add from a folder: accepted files added, refused ones named, links and dot files skipped, refused types never opened', async (t) => {
  const { call, at, state } = await serve(t);
  const brand = await useTmpRoot(t, 'dc-brand-');
  await brand.write('Inter-Regular.woff2', WOFF2);
  await brand.write('acme-mark.svg', SVG);
  await brand.write('guide.pdf', PDF);
  await brand.write('fake.png', JPEG);
  await brand.write('.env', 'SECRET=1');
  await brand.write('brand.key', 'secret');
  await chmod(brand.at('brand.key'), 0o000); // were it opened, the reason would say it can't be opened
  await brand.write('nested/deep.svg', SVG);
  const elsewhere = await useTmpRoot(t, 'dc-elsewhere-');
  await elsewhere.write('linked.svg', SVG);
  let linked = true;
  try {
    await symlink(elsewhere.at('linked.svg'), brand.at('linked.svg'), 'file');
  } catch {
    linked = false;
  }
  const answer = await call('POST', '/systems/acme/assets/from-folder', { directory: brand.root });
  await chmod(brand.at('brand.key'), 0o600);
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const { added, refused } = answer.json as AssetsFromFolderResponse;
  assert.deepEqual(added, [
    { file: 'assets/fonts/Inter-Regular.woff2', kind: 'font' },
    { file: 'assets/logos/acme-mark.svg', kind: 'logo' },
    { file: 'sources/guide.pdf', kind: 'source' },
  ]);
  assert.deepEqual(refused, [
    { name: 'brand.key', reason: "brand.key isn't a file type design systems use." },
    { name: 'fake.png', reason: "fake.png isn't a real PNG file." },
  ]);
  if (linked) await assert.rejects(readFile(at('assets/logos/linked.svg')), { code: 'ENOENT' });
  await assert.rejects(readFile(at('assets/logos/deep.svg')), { code: 'ENOENT' });
  assert.deepEqual((await state()).sources.brand?.files, ['assets/fonts/Inter-Regular.woff2', 'assets/logos/acme-mark.svg', 'sources/guide.pdf']);
  const json = JSON.parse(await readFile(at('system.json'), 'utf8')) as { fonts: unknown[]; logos: unknown[]; sources: unknown[] };
  assert.equal(json.fonts.length + json.logos.length + json.sources.length, 3);
  // The brand folder is only read.
  assert.deepEqual((await readdir(brand.root)).sort(), ['.env', 'Inter-Regular.woff2', 'acme-mark.svg', 'brand.key', 'fake.png', 'guide.pdf', ...(linked ? ['linked.svg'] : []), 'nested'].sort());
});

test('Add from a folder is contained: never the Designs folder or inside it, even through a link; only real, absolute folders', async (t) => {
  const { tmp, call } = await serve(t);
  const refusedWith = async (directory: string, message: string | RegExp): Promise<void> => {
    const answer = await call('POST', '/systems/acme/assets/from-folder', { directory });
    assert.equal(answer.status, 400, directory);
    assert.equal((answer.json as { error: string }).error, 'bad-path', directory);
    if (typeof message === 'string') assert.equal(messageOf(answer), message, directory);
    else assert.match(messageOf(answer), message, directory);
  };
  await tmp.write('checkout/index.html', '<p>');
  await refusedWith(tmp.root, 'Pick a folder outside your Designs folder.');
  await refusedWith(tmp.at('checkout'), 'Pick a folder outside your Designs folder.');
  await refusedWith(tmp.at('_systems/acme'), 'Pick a folder outside your Designs folder.');
  await refusedWith(`${tmp.root}${path.sep}..${path.sep}${path.basename(tmp.root)}`, 'Pick a folder outside your Designs folder.');
  await refusedWith('relative/brand', 'Choose a full folder path.');
  await refusedWith('~/brand', 'Choose a full folder path.');
  await refusedWith(path.parse(tmp.root).root, 'A whole drive is too much to read. Pick a folder inside it.');
  await refusedWith(`${tmp.root}\u0000x`, 'That folder path contains an invalid character.');
  await refusedWith(`/x/${'a'.repeat(4100)}`, 'That folder path is too long.');
  await refusedWith(tmp.at('missing'), /^Design Chamber can't read .*missing\. It doesn't exist\.$/);
  await refusedWith(tmp.at('checkout/index.html'), /^Design Chamber can't read .*index\.html\. It isn't a folder\.$/);
  const outside = await useTmpRoot(t, 'dc-out-');
  try {
    await symlink(tmp.root, outside.at('designs-link'), 'dir');
  } catch {
    return; // no folder links on this system: the realpath case can't be set up
  }
  await refusedWith(outside.at('designs-link'), 'Pick a folder outside your Designs folder.');
});
