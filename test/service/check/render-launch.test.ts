// The launches of a check run: cancellable, and the restart clipped to what is left of the run
// (so first launch + run + restart stay under the `design_check` tool's kill).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CdpUnavailable, DEFAULT_LAUNCH_BUDGET_MS, type CdpSession, type OpenBrowserOptions } from '../../../src/service/check/cdp.ts';
import { CHECK_RUN_DEADLINE_MS, renderArtboards, type PlannedArtboard, type RenderDeps } from '../../../src/service/check/render.ts';
import { CHECK_TOOL_TIMEOUT_MS } from '../../../src/shared/limits.ts';

/** A session that cannot open a page: every artboard fails as browser trouble. */
const brokenSession = (): CdpSession => ({
  send: (method: string) => (method === 'Browser.setDownloadBehavior' ? Promise.resolve({} as never) : Promise.reject(new CdpUnavailable('The browser closed.'))),
  on: () => () => undefined,
  onExit: () => () => undefined,
  exited: false,
  close: () => Promise.resolve(),
});

const plan = (count: number): PlannedArtboard[] =>
  Array.from({ length: count }, (_, i) => ({ file: `s${i}.html`, screen: `s${i}`, viewport: { id: 'laptop', label: 'Laptop', width: 1280, height: 800 } }));

const deps = (over: Partial<RenderDeps>): RenderDeps => ({
  openBrowser: () => Promise.resolve(brokenSession()),
  plan: plan(4),
  kind: 'canvas',
  loadDocument: () => Promise.resolve({ ok: true, html: '<p>x</p>' }),
  probeSource: '',
  knownExternal: new Set(),
  savePng: () => Promise.resolve('x.png'),
  ...over,
});

test('the whole run is held under the tool kill, with room to close and write', () => {
  assert.ok(CHECK_RUN_DEADLINE_MS < CHECK_TOOL_TIMEOUT_MS);
  assert.ok(CHECK_TOOL_TIMEOUT_MS - CHECK_RUN_DEADLINE_MS >= 10_000);
});

test('the restart launch gets only what is left of the run, not the full launch budget', async () => {
  let now = 0;
  const calls: (OpenBrowserOptions | undefined)[] = [];
  await renderArtboards(
    deps({
      clock: () => now,
      overallBudgetMs: 100_000,
      openBrowser: (options) => {
        calls.push(options);
        if (calls.length === 1) now += 70_000; // a slow first launch
        return Promise.resolve(brokenSession());
      },
    }),
  );
  assert.equal(calls.length, 2, 'started once, restarted once');
  assert.equal(calls[1]?.launchBudgetMs, 30_000, 'clipped to the 30 s left');
  assert.ok((calls[1]?.launchBudgetMs ?? 0) < DEFAULT_LAUNCH_BUDGET_MS);
});

test('a restart launch is capped at the default budget when plenty of the run is left', async () => {
  const calls: (OpenBrowserOptions | undefined)[] = [];
  await renderArtboards(deps({ clock: () => 0, overallBudgetMs: 1_000_000, openBrowser: (options) => (calls.push(options), Promise.resolve(brokenSession())) }));
  assert.equal(calls[1]?.launchBudgetMs, DEFAULT_LAUNCH_BUDGET_MS);
});

test('no restart is attempted when the run has no time left; the rest is reported as not rendered', async () => {
  let now = 0;
  let launches = 0;
  const outcome = await renderArtboards(
    deps({
      clock: () => now,
      overallBudgetMs: 100_000,
      openBrowser: () => {
        launches += 1;
        now += 99_000; // the first launch eats the run
        return Promise.resolve(brokenSession());
      },
    }),
  );
  assert.equal(launches, 1, 'never relaunched');
  assert.equal(outcome.stoppedBy, 'budget');
  assert.ok(outcome.notRendered > 0);
});

test('aborting while the browser starts ends the run as aborted, not as an undrivable browser', async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const outcome = await renderArtboards(
    deps({
      signal: controller.signal,
      openBrowser: (options) => {
        seen = options?.signal;
        return new Promise<CdpSession>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new CdpUnavailable('The launch was cancelled.')), { once: true });
          setTimeout(() => controller.abort(), 10);
        });
      },
    }),
  );
  assert.equal(seen, controller.signal, 'the run\'s signal reaches the launch');
  assert.equal(outcome.stoppedBy, 'aborted');
  assert.equal(outcome.unavailable, false);
  assert.equal(outcome.notRendered, 4);
});

test('an abort that lands as the launch resolves closes the browser without waiting on a command', async () => {
  const controller = new AbortController();
  let closed = 0;
  // A live browser that is slow to answer its first command.
  const session: CdpSession = {
    ...brokenSession(),
    send: () => new Promise<never>((resolve) => setTimeout(() => resolve({} as never), 2000).unref()),
    close: () => ((closed += 1), Promise.resolve()),
  };
  const started = Date.now();
  const outcome = await renderArtboards(
    deps({
      signal: controller.signal,
      openBrowser: () => {
        controller.abort(); // after the browser answered, before the run attached its own listener
        return Promise.resolve(session);
      },
    }),
  );
  assert.equal(outcome.stoppedBy, 'aborted');
  assert.ok(closed >= 1, 'the browser was closed');
  assert.ok(Date.now() - started < 1000, 'did not wait on the first command');
});
