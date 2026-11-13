// The three saved-page-data routes on the real service process, called the way the host proxy
// calls them (Phase 2 technical design §8.2, §17 "Route rejections"): bearer, slug, traversal,
// body bounds and the gen rule, then the data's whole life: save, read back, the upload path,
// the cap, a stale PATCH after Clear, a linked .chamber, and the flush on shutdown.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { ApiErrorBody, CreateUploadResponse, PageStateClearResponse, PageStatePatchResponse, PageStateResponse } from '../../../src/shared/api.ts';
import { PAGE_STATE_MAX_CHARS, UPLOAD_CHUNK_MAX_CHARS } from '../../../src/shared/limits.ts';
import { startServiceProcess, useServiceProcess, type RunningService } from '../../helpers/service-process.ts';

const GONE = 'That design is no longer in your Designs folder.';
const CAP = "This design tried to save more than 1 MB of page data. The extra wasn't saved.";
const ROUTE = '/designs/demo/page-state';

type Rig = { service: RunningService; root: string; outside: string; settings: string };

const start = async (t: TestContext): Promise<Rig> => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dc-page-state-routes-')));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
  const root = path.join(dir, 'designs');
  const outside = path.join(dir, 'outside');
  await mkdir(path.join(root, 'demo'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, 'demo', 'design.json'), JSON.stringify({ version: 1, kind: 'page', title: 'Checklist' }));
  await writeFile(path.join(root, 'demo', 'index.html'), '<p>Checklist</p>');
  const settings = path.join(dir, 'settings.json');
  await writeFile(settings, JSON.stringify({ version: 1, root, downloadsDir: path.join(dir, 'downloads') }));
  const service = await useServiceProcess(t, { DC_SETTINGS_PATH: settings });
  return { service, root, outside, settings };
};

const errorOf = async (response: Response): Promise<ApiErrorBody> => (await response.json()) as ApiErrorBody;

const read = async (service: RunningService): Promise<PageStateResponse> => {
  const answer = await service.request(ROUTE);
  assert.equal(answer.status, 200);
  return (await answer.json()) as PageStateResponse;
};

const patch = (service: RunningService, body: unknown): Promise<Response> => service.request(ROUTE, { method: 'PATCH', body });

const onDisk = async (root: string): Promise<[string, string][] | null> => {
  const text = await readFile(path.join(root, 'demo', '.chamber', 'page-state.json'), 'utf8').catch(() => null);
  return text === null ? null : (JSON.parse(text) as { items: [string, string][] }).items;
};

const linkOrSkip = async (t: TestContext, target: string, link: string): Promise<boolean> => {
  try {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    t.skip(`symlinks unavailable on this platform/account: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

const calls: [string, { method?: string; body?: unknown }][] = [
  [ROUTE, {}],
  [ROUTE, { method: 'PATCH', body: { gen: 'e:0', changes: [] } }],
  [ROUTE, { method: 'DELETE' }],
];

describe('page-state routes: refusals before anything is read or written', () => {
  test('a missing or wrong token is 401 on all three', async (t) => {
    const { service } = await start(t);
    for (const [pathname, init] of calls) {
      for (const token of [null, 'wrong', ''] as const) {
        const answer = await service.request(pathname, { ...init, token });
        assert.equal(answer.status, 401, `${init.method ?? 'GET'} token=${String(token)}`);
        assert.equal((await errorOf(answer)).error, 'unauthorized');
      }
    }
  });

  test('a bad name is 400, an unknown design 404 with the gone sentence, a traversal never reaches a file', async (t) => {
    const { service, root } = await start(t);
    await writeFile(path.join(path.dirname(root), 'page-state.json'), JSON.stringify({ v: 1, items: [['secret', 'outside']] }));
    for (const [, init] of calls) {
      const label = init.method ?? 'GET';
      const bad = await service.request('/designs/BAD SLUG/page-state', init);
      assert.equal(bad.status, 400, label);
      assert.equal((await errorOf(bad)).error, 'bad-slug');

      const gone = await service.request('/designs/no-such-design/page-state', init);
      assert.equal(gone.status, 404, label);
      assert.deepEqual(await errorOf(gone), { error: 'not-found', message: GONE });

      for (const traversal of ['/designs/..%2F..%2Fdesigns/page-state', '/designs/%2E%2E/page-state', '/designs/..%5Cdemo/page-state', '/designs/C%3A%5Cx/page-state']) {
        const answer = await service.request(traversal, init);
        const body = await errorOf(answer);
        // `%2E%2E` is resolved by the URL parser itself (`/designs/page-state`): no such route, 404.
        if (traversal.includes('%2E%2E')) assert.deepEqual([answer.status, body.error], [404, 'not-found'], `${label} ${traversal}`);
        else assert.ok(answer.status === 400 && (body.error === 'bad-path' || body.error === 'bad-slug'), `${label} ${traversal}: ${answer.status} ${body.error}`);
        assert.equal(JSON.stringify(body).includes('secret'), false);
      }
    }
  });

  test('a PATCH without a valid gen, or with a malformed delta, is 400 and nothing is saved', async (t) => {
    const { service, root } = await start(t);
    const bodies: unknown[] = [
      undefined,
      [],
      { changes: [['a', 'b']] },
      { gen: 7, changes: [['a', 'b']] },
      { gen: 'no-colon', changes: [['a', 'b']] },
      { gen: 'e:-1', changes: [['a', 'b']] },
      { gen: `${'e'.repeat(130)}:0`, changes: [['a', 'b']] },
      { gen: 'e:0', clear: 'yes' },
      { gen: 'e:0', changes: { a: 'b' } },
      { gen: 'e:0', changes: [['a', 1]] },
      { gen: 'e:0', changes: [['a', 'b', 'c']] },
      { gen: 'e:0', uploadId: '../../etc/passwd' },
      { gen: 'e:0', uploadId: 'u_abcdefgh1234', changes: [['a', 'b']] },
    ];
    for (const body of bodies) {
      const answer = await patch(service, body);
      assert.equal(answer.status, 400, JSON.stringify(body));
      const error = await errorOf(answer);
      assert.equal(error.error, 'bad-request');
      assert.match(error.message, /\.$/, 'a sentence');
    }
    assert.equal(await onDisk(root), null);
    assert.deepEqual((await read(service)).items, []);
  });

  test('a body over the router cap is 413', async (t) => {
    const { service } = await start(t);
    const answer = await patch(service, { gen: 'e:0', changes: [['k', 'x'.repeat(81_000)]] });
    assert.equal(answer.status, 413);
    assert.equal((await errorOf(answer)).error, 'too-large');
  });
});

describe('page-state routes: the data', () => {
  test('save, read back, survive a restart; a PATCH is answered only once its change is on disk', async (t) => {
    const { service, root, settings } = await start(t);
    const { gen } = await read(service);
    let answer = await patch(service, { gen, changes: [['checklist:done', '[1,3]'], ['theme', 'dark']] });
    assert.equal(answer.status, 200);
    assert.deepEqual((await answer.json()) as PageStatePatchResponse, { chars: 'checklist:done[1,3]themedark'.length, gen });
    assert.deepEqual(await onDisk(root), [['checklist:done', '[1,3]'], ['theme', 'dark']]);
    // The second write is coalesced (due a second after the first) and the answer waits for it: the
    // host's stop is a hard kill on Windows, so nothing answered may live only in memory.
    answer = await patch(service, { gen, changes: [['checklist:done', '[1,3,4]']] });
    assert.equal(answer.status, 200);
    assert.deepEqual(await onDisk(root), [['checklist:done', '[1,3,4]'], ['theme', 'dark']], 'on disk when answered');
    await service.stop();
    assert.deepEqual(await onDisk(root), [['checklist:done', '[1,3,4]'], ['theme', 'dark']]);

    const restarted = await startServiceProcess({ DC_SETTINGS_PATH: settings });
    t.after(() => restarted.stop());
    const after = await read(restarted);
    assert.deepEqual(after.items, [['checklist:done', '[1,3,4]'], ['theme', 'dark']]);
    assert.notEqual(after.gen, gen, 'a new run has a new epoch');
    // The old run's gen is from another epoch: accepted.
    assert.equal((await patch(restarted, { gen, changes: [['theme', 'light']] })).status, 200);
    assert.equal(restarted.output().includes('checklist:done'), false, 'never logged');
    assert.equal(service.output().includes('checklist:done'), false, 'never logged');
  });

  test('a delta too big for one request goes through an upload', async (t) => {
    const { service } = await start(t);
    const { gen } = await read(service);
    const json = JSON.stringify({ gen, clear: false, changes: [['notes', '漢'.repeat(60_000)]] });
    const created = await service.request('/uploads', { method: 'POST', body: { total: json.length } });
    assert.equal(created.status, 200);
    const { uploadId } = (await created.json()) as CreateUploadResponse;
    // Split well under both chunk limits (each CJK character is three UTF-8 bytes).
    const size = Math.floor(UPLOAD_CHUNK_MAX_CHARS / 4);
    for (let index = 0, at = 0; at < json.length; index += 1, at += size) {
      const put = await service.request(`/uploads/${uploadId}/${index}`, { method: 'PUT', body: { data: json.slice(at, at + size) } });
      assert.equal(put.status, 200, `chunk ${index}`);
    }
    const answer = await patch(service, { gen, uploadId });
    assert.equal(answer.status, 200);
    assert.equal(((await answer.json()) as PageStatePatchResponse).chars, 5 + 60_000);
    assert.equal((await read(service)).items[0]?.[1].length, 60_000);

    // The upload is taken once; a replay of the id is refused.
    assert.equal((await patch(service, { gen, uploadId })).status, 404);
  });

  test('an uploaded delta carrying another gen is refused', async (t) => {
    const { service } = await start(t);
    const { gen } = await read(service);
    const json = JSON.stringify({ gen: 'other:0', changes: [['a', 'b']] });
    const { uploadId } = (await (await service.request('/uploads', { method: 'POST', body: { total: json.length } })).json()) as CreateUploadResponse;
    await service.request(`/uploads/${uploadId}/0`, { method: 'PUT', body: { data: json } });
    assert.equal((await patch(service, { gen, uploadId })).status, 400);
    assert.deepEqual((await read(service)).items, []);
  });

  test('over 1 MB: 413 with the cap sentence, nothing of that delta applied', async (t) => {
    const { service } = await start(t);
    const { gen } = await read(service);
    // Fill to just under the cap through uploads-free chunks of 40 000 characters, sent together so
    // they share the coalesced writes (each answer waits for its write).
    const chunk = 'x'.repeat(40_000);
    let chars = 0;
    const fills: Promise<Response>[] = [];
    for (let n = 0; chars + 40_005 <= PAGE_STATE_MAX_CHARS; n += 1) {
      const key = `k${String(n).padStart(4, '0')}`;
      fills.push(patch(service, { gen, changes: [[key, chunk]] }));
      chars += key.length + chunk.length;
    }
    for (const filled of await Promise.all(fills)) assert.equal(filled.status, 200);
    // Exactly to the cap is still saved.
    const room = PAGE_STATE_MAX_CHARS - chars;
    assert.equal((await patch(service, { gen, changes: [['last', 'y'.repeat(room - 4)]] })).status, 200);
    const over = await patch(service, { gen, changes: [['first', 'small'], ['k0001', null], ['k0001', 'z'.repeat(40_001)]] });
    assert.equal(over.status, 413);
    assert.deepEqual(await errorOf(over), { error: 'too-large', message: CAP });
    const after = await read(service);
    assert.equal(after.chars, PAGE_STATE_MAX_CHARS);
    assert.equal(after.items.some(([key]) => key === 'first'), false, 'nothing of the refused delta was applied');
    assert.equal(after.items.find(([key]) => key === 'k0001')?.[1], chunk);
  });

  test('Clear: idempotent, removes the file, and a PATCH from before it is 409 with nothing applied', async (t) => {
    const { service, root } = await start(t);
    const loaded = (await read(service)).gen;
    assert.equal((await patch(service, { gen: loaded, changes: [['ticked', '1,2']] })).status, 200);

    const first = await service.request(ROUTE, { method: 'DELETE' });
    assert.equal(first.status, 200);
    const cleared = (await first.json()) as PageStateClearResponse;
    assert.equal(cleared.ok, true);
    assert.notEqual(cleared.gen, loaded);

    const stale = await patch(service, { gen: loaded, changes: [['ticked', '1,2,3']] });
    assert.equal(stale.status, 409);
    assert.equal((await errorOf(stale)).error, 'stale');
    assert.deepEqual((await read(service)).items, []);

    const second = await service.request(ROUTE, { method: 'DELETE' });
    assert.equal(second.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(await onDisk(root), null, 'nothing came back');
  });

  test('a .chamber that is a link: reads empty, PATCH and Clear refuse with a sentence, the target untouched', async (t) => {
    const { service, root, outside } = await start(t);
    const planted = JSON.stringify({ v: 1, items: [['planted', 'outside data']] });
    await writeFile(path.join(outside, 'page-state.json'), planted);
    if (!(await linkOrSkip(t, outside, path.join(root, 'demo', '.chamber')))) return;
    const { items, gen } = await read(service);
    assert.deepEqual(items, []);
    const refused = await patch(service, { gen, changes: [['a', 'b']] });
    assert.equal(refused.status, 422);
    assert.match((await errorOf(refused)).message, /link/);
    assert.equal((await service.request(ROUTE, { method: 'DELETE' })).status, 422);
    assert.equal(await readFile(path.join(outside, 'page-state.json'), 'utf8'), planted);
  });

  test('nothing is created for a design that only reads', async (t) => {
    const { service, root } = await start(t);
    await read(service);
    await assert.rejects(stat(path.join(root, 'demo', '.chamber', 'page-state.json')));
  });
});
