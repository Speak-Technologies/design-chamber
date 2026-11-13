// Saved page data survives a hard kill of the built service (docs/SPEC.md §9.17). The host stops
// a service with SIGTERM, which on Windows is TerminateProcess: no handler runs, nothing is
// flushed. So a PATCH may only be answered once its change is on disk. This kills the real built
// service with SIGKILL (TerminateProcess on Windows) on every CI OS and checks the rule from the
// outside: every save that was answered is there after a restart, and a save that was still
// waiting when the process died was never answered as saved.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { ChangesResponse, PageStateResponse } from '../../../src/shared/api.ts';
import { BUILT_MAIN, startServiceProcess, type RunningService } from '../../helpers/service-process.ts';

const ROUTE = '/designs/demo/page-state';

/** Long enough for an answer sent from memory to reach the test, well under the 1 s write spacing. */
const ANSWER_GRACE_MS = 200;

const json = async <T>(answer: Response, label: string): Promise<T> => {
  const text = await answer.text();
  assert.equal(answer.status, 200, `${label}: ${answer.status} ${text}`);
  return JSON.parse(text) as T;
};

const patch = (service: RunningService, gen: string, changes: [string, string][]): Promise<Response> =>
  service.request(ROUTE, { method: 'PATCH', body: { gen, changes } });

/** Wait until the service reports a page-state change for the demo design after `since`. */
const waitForPageState = async (service: RunningService, epoch: string, since: number): Promise<void> => {
  const deadline = Date.now() + 10_000;
  let cursor = since;
  while (Date.now() < deadline) {
    const answer = await json<ChangesResponse>(await service.request('/changes', { query: { since: String(cursor), epoch, wait: '2000' } }), 'changes');
    if (answer.events.some((event) => event.slug === 'demo' && event.kind === 'page-state')) return;
    cursor = answer.seq;
  }
  assert.fail('the service never reported the second save as applied');
};

test('after a hard kill, every answered save is on disk and an unanswered one was never answered as saved', { timeout: 60_000 }, async (t) => {
  if (!existsSync(BUILT_MAIN)) {
    // CI always builds first (`npm run check`), so there a missing bundle is a failure, not a skip.
    assert.ok(!process.env.CI, 'dist/service/main.js is missing in CI; `npm run check` builds it before the tests');
    t.skip('dist/service/main.js is missing; run `npm run build` (npm run check does) to test the built service.');
    return;
  }
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dc-page-state-kill-')));
  const running: RunningService[] = [];
  // One hook, so every process is gone before the folder is removed (Windows will not delete open files).
  t.after(async () => {
    for (const service of running) await service.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = path.join(dir, 'designs');
  await mkdir(path.join(root, 'demo'), { recursive: true });
  await writeFile(path.join(root, 'demo', 'design.json'), JSON.stringify({ version: 1, kind: 'page', title: 'Checklist' }));
  await writeFile(path.join(root, 'demo', 'index.html'), '<p>Checklist</p>');
  const settings = path.join(dir, 'settings.json');
  await writeFile(settings, JSON.stringify({ version: 1, root, downloadsDir: path.join(dir, 'downloads') }));

  const first = await startServiceProcess({ DC_SETTINGS_PATH: settings }, BUILT_MAIN);
  running.push(first);
  const { gen } = await json<PageStateResponse>(await first.request(ROUTE), 'read');

  // The first save is written at once. The second comes within a second of it, so its write is
  // held back by the once-a-second rule; it must still not be answered before it lands.
  await json(await patch(first, gen, [['first', '1']]), 'first save');
  await json(await patch(first, gen, [['answered', 'yes']]), 'second save');

  // A third save, sent and applied in memory, its write held back a second: kill before it lands.
  const { epoch, seq } = await json<ChangesResponse>(await first.request('/changes', { query: { since: '0', epoch: '', wait: '0' } }), 'changes');
  const pending: Promise<number | 'no answer'> = patch(first, gen, [['pending', 'maybe']]).then(
    (answer) => answer.status,
    () => 'no answer' as const,
  );
  await waitForPageState(first, epoch, seq);
  await new Promise((resolve) => setTimeout(resolve, ANSWER_GRACE_MS));
  await first.stop('SIGKILL');
  // The request either got an answer before the kill or its connection died with the process.
  const pendingStatus = await pending;
  t.diagnostic(`the save in flight at the kill: ${pendingStatus === 'no answer' ? 'never answered' : `answered ${pendingStatus}`}`);

  const second = await startServiceProcess({ DC_SETTINGS_PATH: settings }, BUILT_MAIN);
  running.push(second);
  const after = new Map((await json<PageStateResponse>(await second.request(ROUTE), 'read after restart')).items);
  assert.equal(after.get('first'), '1', 'the first answered save survived the kill');
  assert.equal(after.get('answered'), 'yes', 'the held-back answered save survived the kill');
  // Unanswered, it may be absent or present; answered as saved, it must be there.
  if (pendingStatus === 200) assert.equal(after.get('pending'), 'maybe', 'a save answered as saved went missing');
  assert.equal(second.output().includes('maybe'), false, 'page data is never logged');
});
