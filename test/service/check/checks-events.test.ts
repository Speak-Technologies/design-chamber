// A finished check (`<design>/.chamber/check.json`) becomes a `checks` change event, on the
// watch fast path and on the poll backstop alike (Linux's folder watch skips dot folders, so
// there the poll is the path). Ordinary `.chamber/` files stay silent.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';

import { createChangeHub } from '../../../src/service/changes.ts';
import { createLogger, type SettingsStore } from '../../../src/service/context.ts';
import { writeFileAtomic } from '../../../src/service/paths.ts';
import { startWatcher } from '../../../src/service/watch.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

type FakeFs = { emit(filename: string): void; watchImpl: typeof import('node:fs').watch };

/** An fs.watch stand-in the test drives by hand. */
const fakeFs = (): FakeFs => {
  let listener: ((event: string, filename: string | null) => void) | null = null;
  return {
    emit: (filename) => listener?.('change', filename),
    watchImpl: ((_root: string, _options: unknown, handler: (event: string, filename: string | null) => void) => {
      listener = handler;
      return { on: () => undefined, close: () => undefined } as unknown as FSWatcher;
    }) as unknown as typeof import('node:fs').watch,
  };
};

const start = async (t: TestContext, options: { pollMs: number; watchImpl?: typeof import('node:fs').watch }) => {
  const tmp = await useTmpRoot(t);
  await tmp.writeDesign('demo', { 'design.json': { version: 1, kind: 'page' }, 'index.html': '<p>x</p>' });
  const hub = createChangeHub(randomUUID());
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const settings: SettingsStore = {
    root: () => tmp.root,
    defaultRoot: () => tmp.root,
    read: () => ({ version: 1, root: tmp.root }),
    async update() {
      throw new Error('unused');
    },
    onRootChange: () => () => undefined,
  };
  const watcher = startWatcher({ settings, hub, log: createLogger(() => undefined), debounceMs: 30, pollMs: options.pollMs, ...(options.watchImpl ? { watchImpl: options.watchImpl } : {}) });
  t.after(() => watcher.stop());
  await watcher.ready;
  const until = async (what: string, predicate: (event: ChangeEvent) => boolean, ms = 3000): Promise<ChangeEvent> => {
    for (let waited = 0; waited <= ms; waited += 20) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${what}; saw ${JSON.stringify(events)}`);
  };
  return { tmp, events, until };
};

const kinds = (events: ChangeEvent[]): string[] => events.map((event) => `${event.slug}:${event.kind}`);

test('watch path: a check.json event for the design is a checks event, not a files event', async (t) => {
  const fs = fakeFs();
  const { tmp, events, until } = await start(t, { pollMs: 60_000, watchImpl: fs.watchImpl });
  await mkdir(tmp.at('demo/.chamber'), { recursive: true });
  await writeFileAtomic(tmp.at('demo/.chamber/check.json'), '{}\n');
  fs.emit('demo/.chamber/check.json'.replace(/\//g, process.platform === 'win32' ? '\\' : '/'));
  await until('a checks event', (event) => event.slug === 'demo' && event.kind === 'checks');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(kinds(events), ['demo:checks']);
});

test('other .chamber files and temp files stay silent on the watch path', async (t) => {
  const fs = fakeFs();
  const { events } = await start(t, { pollMs: 60_000, watchImpl: fs.watchImpl });
  for (const name of ['demo/.chamber/RULES.md', 'demo/.chamber/state.json', 'demo/.chamber/.check.json.tmp-1-abc', 'demo/.chamber/check/r-20261108101500-a1b2c3/home@laptop.png', 'demo/.chamber/bin/dc']) fs.emit(name);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(events, []);
});

test('poll path: with no watch events at all, the next poll finds a new check.json, and a rewrite', async (t) => {
  const fs = fakeFs();
  const { tmp, events, until } = await start(t, { pollMs: 80, watchImpl: fs.watchImpl });
  await mkdir(tmp.at('demo/.chamber'), { recursive: true });
  await writeFileAtomic(tmp.at('demo/.chamber/check.json'), '{}\n');
  await until('the first checks event', (event) => event.slug === 'demo' && event.kind === 'checks');
  assert.ok(!events.some((event) => event.kind === 'files'), 'a report is not a content change');
  const before = events.filter((event) => event.kind === 'checks').length;
  await writeFileAtomic(tmp.at('demo/.chamber/check.json'), '{"changed":true,"more":"bytes"}\n');
  for (let waited = 0; waited < 3000 && events.filter((event) => event.kind === 'checks').length === before; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(events.filter((event) => event.kind === 'checks').length > before, 'a rewrite is a new event');
});
