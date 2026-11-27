// Quiet mode of the resident service (documentation/specs/native-extras.md §4.3): after
// QUIET_AFTER_MS without `GET /changes` the watcher's backstop slows and the render cache is
// dropped; the next request goes back to the active pace and looks at every design once.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FSWatcher } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { describe, test, type TestContext } from 'node:test';

import { createChangeHub } from '../../../src/service/changes.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { createPace } from '../../../src/service/pace.ts';
import { createRenderService } from '../../../src/service/render-cache.ts';
import { registerChangesRoutes } from '../../../src/service/routes/changes.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { startWatcher, takeFingerprint, type Watcher } from '../../../src/service/watch.ts';
import type { SettingsStore } from '../../../src/service/context.ts';
import { QUIET_AFTER_MS, WATCH_POLL_MS, WATCH_POLL_QUIET_MS } from '../../../src/shared/limits.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { pageDesign } from '../render/harness.ts';
import type { LogLine } from './harness.ts';

const makeLog = () => {
  const lines: LogLine[] = [];
  return {
    lines,
    log: {
      info: (event: string, fields?: LogLine['fields']) => void lines.push({ level: 'info', event, fields }),
      warn: (event: string, fields?: LogLine['fields']) => void lines.push({ level: 'warn', event, fields }),
      error: (event: string, fields?: LogLine['fields']) => void lines.push({ level: 'error', event, fields }),
    },
  };
};

/** A pace over a recording watcher and render cache, on a clock the test moves. */
const rig = (options: { pollFails?: boolean } = {}) => {
  let time = 1_000_000;
  let tick: () => void = () => assert.fail('the pace never subscribed to the poll tick');
  const calls: string[] = [];
  const logs = makeLog();
  const pace = createPace({
    watcher: {
      onTick: (listener) => {
        tick = listener;
        return () => undefined;
      },
      setPollMs: (ms) => void calls.push(`setPollMs ${ms}`),
      pollNow: (poll) => {
        calls.push(`pollNow ${poll?.all === true ? 'all' : 'slice'}`);
        return options.pollFails ? Promise.reject(new Error('EIO: the share went away')) : Promise.resolve();
      },
    },
    renders: { dropAll: () => void calls.push('dropAll') },
    log: logs.log,
    now: () => time,
  });
  return {
    pace,
    calls,
    logs: logs.lines,
    /** Let `ms` pass, then run one of the watcher's poll ticks. */
    after(ms: number) {
      time += ms;
      tick();
    },
  };
};

const QUIET = [`setPollMs ${WATCH_POLL_QUIET_MS}`, 'dropAll'];
const WAKE = [`setPollMs ${WATCH_POLL_MS}`, 'pollNow all'];

describe('createPace (fake clock)', () => {
  test('the limits are the ones the spec names', () => {
    assert.equal(QUIET_AFTER_MS, 600_000);
    assert.equal(WATCH_POLL_MS, 3000);
    assert.equal(WATCH_POLL_QUIET_MS, 60_000);
  });

  test('quiet after 10 minutes without a request, counted from the start, and not a millisecond before', () => {
    const { calls, logs, after } = rig();
    after(QUIET_AFTER_MS - 1);
    assert.deepEqual(calls, []);
    after(1);
    assert.deepEqual(calls, QUIET);
    assert.deepEqual(logs.map((line) => line.event), ['pace.quiet']);
  });

  test('each request starts the 10 minutes again, and does nothing else while active', () => {
    const { pace, calls, after } = rig();
    for (let i = 0; i < 5; i += 1) {
      after(QUIET_AFTER_MS - 1);
      pace.touch();
    }
    assert.deepEqual(calls, [], 'an active service never sets the interval, polls or drops the cache');
    after(QUIET_AFTER_MS - 1);
    assert.deepEqual(calls, []);
    after(1);
    assert.deepEqual(calls, QUIET);
  });

  test('the cache is dropped once per quiet spell, however many ticks follow', () => {
    const { calls, after } = rig();
    after(QUIET_AFTER_MS);
    for (let i = 0; i < 20; i += 1) after(WATCH_POLL_QUIET_MS);
    assert.deepEqual(calls, QUIET);
  });

  test('the next request goes back to 3 s and polls every design once; a second quiet spell drops the cache again', () => {
    const { pace, calls, logs, after } = rig();
    after(QUIET_AFTER_MS);
    calls.length = 0;
    pace.touch();
    assert.deepEqual(calls, WAKE);
    pace.touch();
    after(WATCH_POLL_MS);
    assert.deepEqual(calls, WAKE, 'one wake, one poll');
    calls.length = 0;
    after(QUIET_AFTER_MS);
    assert.deepEqual(calls, QUIET);
    assert.deepEqual(logs.map((line) => line.event), ['pace.quiet', 'pace.active', 'pace.quiet']);
  });

  test('a wake poll that fails is logged, never thrown, and the pace stays active', async () => {
    const { pace, calls, logs, after } = rig({ pollFails: true });
    after(QUIET_AFTER_MS);
    pace.touch();
    await new Promise((resolve) => setImmediate(resolve));
    const warning = logs.find((line) => line.level === 'warn');
    assert.equal(warning?.event, 'pace.wake-poll-failed');
    assert.equal(warning?.fields?.error, 'EIO: the share went away');
    calls.length = 0;
    after(WATCH_POLL_MS);
    assert.deepEqual(calls, []);
  });
});

/** A watcher on the real filesystem whose poll interval runs on mocked timers. */
const watched = async (t: TestContext, tmp: TmpRoot, options: { mute?: boolean } = {}) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const hub = createChangeHub(randomUUID());
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const settings: SettingsStore = {
    root: () => tmp.root,
    defaultRoot: () => tmp.root,
    read: () => ({ version: 1, root: tmp.root }),
    update: () => Promise.reject(new Error('not used')),
    onRootChange: () => () => undefined,
  };
  const watch = { opened: 0, closed: 0 };
  // `mute` stands for an fs.watch that is healthy as far as anyone can tell but drops its events.
  const impl = (() => {
    watch.opened += 1;
    const fake = { close: () => void (watch.closed += 1), on: () => fake };
    return fake as unknown as FSWatcher;
  }) as unknown as typeof import('node:fs').watch;
  const fingerprinted: string[] = [];
  const watcher: Watcher = startWatcher({
    settings,
    hub,
    log: makeLog().log,
    debounceMs: 20,
    ...(options.mute ? { watchImpl: impl } : {}),
    fingerprint: (dir, { nested }) => {
      fingerprinted.push(dir);
      return takeFingerprint(dir, undefined, nested);
    },
  });
  t.after(() => watcher.stop());
  await watcher.ready;
  let time = 0;
  let drops = 0;
  const pace = createPace({ watcher, renders: { dropAll: () => void (drops += 1) }, log: makeLog().log, now: () => time });
  return {
    watcher,
    pace,
    events,
    watch,
    fingerprinted,
    drops: () => drops,
    /** Advance the pace's clock and the watcher's interval together. */
    async pass(ms: number) {
      time += ms;
      t.mock.timers.tick(ms);
      await watcher.pollNow(); // settles behind the tick the timer started
    },
    async waitFor(predicate: (event: ChangeEvent) => boolean) {
      const deadline = Date.now() + 4000;
      while (!events.some(predicate)) {
        if (Date.now() > deadline) throw new Error(`no such event: ${JSON.stringify(events)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
};

const names = (count: number): string[] => Array.from({ length: count }, (_, i) => `design-${String(i).padStart(2, '0')}`);

describe('createPace on the real watcher', () => {
  test('a change fs.watch dropped is found within one quiet tick, and all of them on waking', async (t) => {
    const tmp = await useTmpRoot(t);
    for (const slug of names(12)) await tmp.writeDesign(slug, pageDesign());
    const env = await watched(t, tmp, { mute: true });

    await env.pass(QUIET_AFTER_MS);
    assert.equal(env.drops(), 1);

    for (const slug of names(12)) await writeFile(tmp.at(`${slug}/index.html`), `<h1>changed while quiet</h1>`, 'utf8');
    env.fingerprinted.length = 0;
    env.events.length = 0;
    t.mock.timers.tick(WATCH_POLL_QUIET_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(env.fingerprinted, [], 'no poll tick before the quiet interval is over');
    t.mock.timers.tick(1);
    for (const slug of names(12)) await env.waitFor((event) => event.slug === slug && event.kind === 'files');

    for (const slug of names(12)) await writeFile(tmp.at(`${slug}/index.html`), `<h1>changed again, then someone looked</h1>`, 'utf8');
    env.events.length = 0;
    env.pace.touch();
    for (const slug of names(12)) await env.waitFor((event) => event.slug === slug && event.kind === 'files');
    assert.equal(env.drops(), 1);
  });

  test('fs.watch is never stopped, going quiet or waking', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.writeDesign('demo', pageDesign());
    const env = await watched(t, tmp, { mute: true });
    await env.pass(QUIET_AFTER_MS);
    await env.pass(WATCH_POLL_QUIET_MS);
    env.pace.touch();
    await env.pass(WATCH_POLL_MS);
    assert.deepEqual(env.watch, { opened: 1, closed: 0 });
  });

  test('while quiet a live fs.watch event still arrives at once, with no poll tick', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.writeDesign('demo', pageDesign());
    const env = await watched(t, tmp);
    await env.pass(QUIET_AFTER_MS);
    env.events.length = 0;
    await writeFile(tmp.at('demo/index.html'), '<h1>an agent writes while nobody looks</h1>', 'utf8');
    await env.waitFor((event) => event.slug === 'demo' && event.kind === 'files');
  });
});

describe('the render cache', () => {
  test('dropAll forgets every document; asking again builds it again', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 30 });
    const renders = createRenderService({ store: ctx.store, hub: ctx.hub, onDispose: ctx.onDispose, versions });
    await tmp.writeDesign('one', pageDesign());
    await tmp.writeDesign('two', pageDesign({ 'index.html': '<h1>second</h1>' }));
    const first = await renders.render('one', {});
    const second = await renders.render('two', {});
    assert.ok(renders.chunk(first.key, 0).includes('hello'));

    renders.dropAll();
    for (const meta of [first, second]) assert.throws(() => renders.chunk(meta.key, 0), { code: 'stale' });

    const again = await renders.render('one', {});
    assert.equal(again.key, first.key);
    assert.ok(renders.chunk(again.key, 0).includes('hello'));
  });
});

describe('GET /changes keeps the service active', () => {
  test('an authorised request touches the pace; a missing or wrong token does not', async (t) => {
    const tmp = await useTmpRoot(t);
    const ctx = createFakeContext({ root: tmp.root });
    t.after(() => ctx.dispose());
    let touches = 0;
    const token = 'pace-test-token-0123456789';
    const router = createRouter({ token, log: ctx.log });
    registerChangesRoutes(router, ctx);
    // Set after registration, as compose.ts does: the route must read it per request.
    ctx.pace = { touch: () => void (touches += 1) };
    const server = createServiceServer(router);
    await listenLoopback(server, 0);
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    const get = (bearer: string | null) =>
      fetch(`http://127.0.0.1:${port}/changes?since=0&epoch=`, {
        headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(10_000),
      });

    assert.equal((await get(null)).status, 401);
    assert.equal((await get('wrong')).status, 401);
    assert.equal(touches, 0);
    assert.equal((await get(token)).status, 200);
    assert.equal(touches, 1);
  });
});
