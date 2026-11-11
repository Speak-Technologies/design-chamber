// The page-state controller's inline-vs-upload rule against the real service (Phase 2 technical
// design §8.4, §17 "Non-ASCII inline PATCH"): a 60 000-char-class delta of CJK or emoji goes through
// the controller to the real service by upload and persists; an ASCII one goes inline; none is
// answered 413. This is the byte rule end to end — the fake-client unit test proves the decision,
// this proves the service actually accepts what the controller sends.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';

import type { PageStateResponse } from '../../../src/shared/api.ts';
import { createPageStateController, type PageStateNotice } from '../../../src/guest/page-state.ts';
import { createServiceClient, fitsOneRequest, type ServiceClient, type ServiceTransport } from '../../../src/guest/service-client.ts';
import { startServiceProcess, useServiceProcess, type RunningService } from '../../helpers/service-process.ts';

const ROUTE = '/designs/demo/page-state';

const start = async (t: TestContext): Promise<{ service: RunningService; root: string; settings: string }> => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dc-page-state-inline-')));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
  const root = path.join(dir, 'designs');
  await mkdir(path.join(root, 'demo'), { recursive: true });
  await writeFile(path.join(root, 'demo', 'design.json'), JSON.stringify({ version: 1, kind: 'page', title: 'Checklist' }));
  await writeFile(path.join(root, 'demo', 'index.html'), '<p>Checklist</p>');
  const settings = path.join(dir, 'settings.json');
  await writeFile(settings, JSON.stringify({ version: 1, root, downloadsDir: path.join(dir, 'downloads') }));
  const service = await useServiceProcess(t, { DC_SETTINGS_PATH: settings });
  return { service, root, settings };
};

/** A real service client over the running process, counting uploads so the routing is observable. */
const clientOver = (service: RunningService): { client: ServiceClient; uploads: string[] } => {
  const transport: ServiceTransport = {
    serviceRequest: async (request: GuestRequest): Promise<GuestRequestResult> => {
      const answer = await service.request(request.path, {
        method: request.method,
        query: request.query,
        body: request.body === undefined ? undefined : JSON.parse(request.body),
      });
      return { status: answer.status, body: await answer.text() };
    },
  };
  const base = createServiceClient(transport);
  const uploads: string[] = [];
  const client: ServiceClient = {
    ...base,
    upload: async (text: string): Promise<string> => {
      uploads.push(text);
      return base.upload(text);
    },
  };
  return { client, uploads };
};

const read = async (service: RunningService): Promise<PageStateResponse> => {
  const answer = await service.request(ROUTE);
  assert.equal(answer.status, 200);
  return (await answer.json()) as PageStateResponse;
};

test('a 60 000-char CJK or emoji delta goes by upload and persists; ASCII inline; none answered 413', async (t) => {
  const { service, settings } = await start(t);
  const { client, uploads } = clientOver(service);
  const notices: PageStateNotice[] = [];
  const controller = createPageStateController({
    client,
    slug: 'demo',
    onNotice: (notice) => notices.push(notice),
    syncFrames: () => undefined,
    reloadFrames: () => undefined,
  });
  await controller.load();
  assert.equal(controller.persisting(), true);

  const ascii = 'a'.repeat(59_900);
  const cjk = '漢'.repeat(59_900);
  const emoji = '😀'.repeat(29_900); // 2 UTF-16 units each → 59 800 chars

  // ASCII: the serialized body fits one request, so it goes inline.
  controller.apply('page@laptop', { clear: false, changes: [['ascii', ascii]] });
  await controller.flush();
  assert.equal(uploads.length, 0, 'the ASCII delta went inline');

  // CJK: same character count, ~3x the bytes → upload.
  controller.apply('page@laptop', { clear: false, changes: [['cjk', cjk]] });
  await controller.flush();
  assert.equal(uploads.length, 1, 'the CJK delta went by upload');
  assert.ok(fitsOneRequest(JSON.stringify({ gen: 'x:0', clear: false, changes: [['cjk', cjk]] })) === false);

  // Emoji: ~4 bytes per code point → upload.
  controller.apply('page@laptop', { clear: false, changes: [['emoji', emoji]] });
  await controller.flush();
  assert.equal(uploads.length, 2, 'the emoji delta went by upload');

  // Nothing was refused: no cap or unsaved notice, and the service holds all three values.
  assert.deepEqual(notices, []);
  const held = await read(service);
  const items = new Map(held.items);
  assert.equal(items.get('ascii'), ascii);
  assert.equal(items.get('cjk'), cjk);
  assert.equal(items.get('emoji'), emoji);
  assert.equal(held.chars, 'ascii'.length + ascii.length + 'cjk'.length + cjk.length + 'emoji'.length + emoji.length);

  // Persisted to disk: a restart reads the same data back.
  await service.stop();
  const restarted = await startServiceProcess({ DC_SETTINGS_PATH: settings });
  t.after(() => restarted.stop());
  const after = await read(restarted);
  const afterItems = new Map(after.items);
  assert.equal(afterItems.get('cjk'), cjk);
  assert.equal(afterItems.get('emoji'), emoji);
  assert.equal(afterItems.get('ascii'), ascii);
});

test('a delta right at the character budget is uploaded, never 413', async (t) => {
  const { service } = await start(t);
  const { client, uploads } = clientOver(service);
  const controller = createPageStateController({
    client,
    slug: 'demo',
    onNotice: () => undefined,
    syncFrames: () => undefined,
    reloadFrames: () => undefined,
  });
  await controller.load();
  // 60 000 characters of ASCII: the body is a hair over the char budget, so it uploads.
  const value = 'a'.repeat(60_000);
  controller.apply('page@laptop', { clear: false, changes: [['big', value]] });
  await controller.flush();
  assert.equal(uploads.length, 1);
  const held = await read(service);
  assert.equal(new Map(held.items).get('big'), value);
});
