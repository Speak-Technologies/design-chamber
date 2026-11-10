// QA regression (documentation/specs/phase-1-5-sdk-2-7.md §U4.3 1, 3): the composed service, as
// main.ts serves it, turns a host `turn-finished` into a real turn version on the linked design
// with no frame open. Guards the wiring in compose.ts (route → queue → versions.turn), which the
// unit tests cover only with fakes or the bare route.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';

import { composeService } from '../../../src/service/compose.ts';
import { ensureVersionsService } from '../../../src/service/versions.ts';
import type { Logger } from '../../../src/service/context.ts';
import { createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TOKEN = 'turn-events-composed-token';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('composed service: a turn-finished for a linked chat makes one turn version; an unlinked chat makes none', { timeout: 15_000 }, async (t) => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  await mkdir(root, { recursive: true });
  const settingsPath = tmp.at('settings.json');
  await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
  const logs: string[] = [];
  const log: Logger = {
    info: (event, fields) => void logs.push(JSON.stringify({ event, fields })),
    warn: (event, fields) => void logs.push(JSON.stringify({ event, fields })),
    error: (event, fields) => void logs.push(JSON.stringify({ event, fields })),
  };
  const service = await composeService({ token: TOKEN, log, packageRoot: REPO_ROOT, version: '0.0.0-test', env: { DC_SETTINGS_PATH: settingsPath }, homeDir: tmp.at('home') });
  t.after(() => service.dispose());
  const server = createServiceServer(service.router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;

  const linked = (await service.ctx.store.create({ kind: 'page', title: 'Linked', sessionId: 'ses_qa_linked_0001', html: '<h1>a</h1>' })).slug;
  const other = (await service.ctx.store.create({ kind: 'page', title: 'Other', sessionId: 'ses_qa_other_00001', html: '<h1>b</h1>' })).slug;

  // The index refreshes DESIGN_INDEX_REFRESH_MS after a change; an event that lands before that
  // sees no link (known-issues: a design linked in the last moments of a turn). Wait it out here.
  for (let waited = 0; waited < 3000 && service.ctx.designIndex.bySession('ses_qa_linked_0001').length === 0; waited += 10) await sleep(10);

  const post = async (sessionId: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/session-events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ v: 1, requestId: 'r', event: { id: 'e', type: 'turn-finished', at: Date.now(), session: { id: sessionId, parentId: null }, project: { directory: null }, linked: [] } }),
    });
    return response.text();
  };
  assert.equal(await post('ses_qa_linked_0001'), '{"ok":true}');
  assert.equal(await post('ses_qa_stranger_01'), '{"ok":true}');

  const versions = ensureVersionsService(service.ctx);
  const turnsOf = async (slug: string) => (await versions.list(slug)).versions.filter((version) => version.reason === 'turn').length;
  for (let waited = 0; waited < 8000 && (await turnsOf(linked)) === 0; waited += 50) await sleep(50);
  assert.equal(await turnsOf(linked), 1, 'the linked design got its turn version through the composed wiring');
  assert.equal(await turnsOf(other), 0, 'a design linked to another chat is not snapshotted');
  assert.ok(!logs.some((line) => line.includes('ses_qa_linked_0001') || line.includes('ses_qa_stranger_01')), 'no full session id in any log line');
});
