// The watcher's echo filter (Phase 2 technical design §2.6, E10): a file event whose current
// bytes equal the last bytes the service itself wrote there is the echo of a hand edit and is
// dropped; anything else is the agent's and is shown. No consumption and no time limit, so a
// doubled Windows event and the poll backstop seeing it later both still read as the echo.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { FSWatcher } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';

import { createChangeHub } from '../../../src/service/changes.ts';
import type { Logger, SelfWrites, SettingsStore } from '../../../src/service/context.ts';
import { createSelfWrites } from '../../../src/service/self-writes.ts';
import { startWatcher, type Watcher } from '../../../src/service/watch.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const DEBOUNCE_MS = 30;

type Rig = {
  tmp: TmpRoot;
  events: ChangeEvent[];
  watcher: Watcher;
  selfWrites: SelfWrites;
  /** Deliver one fs.watch event for a root-relative name (what the platform would report). */
  fire(name: string): void;
  /** Events for `slug` emitted after `mark`, once the debounce has flushed. */
  settle(mark: number): Promise<ChangeEvent[]>;
  /** The service's own write: record the bytes, then write them (as the pipeline does). */
  userWrite(rel: string, text: string): Promise<void>;
};

/**
 * A watcher whose fs.watch only reports what the test fires (so a doubled event and a late poll
 * are deterministic) and whose poll timer never runs on its own (`pollNow` drives it).
 */
const setup = async (t: TestContext): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  await tmp.writeDesign('art', { 'index.html': '<h1>one</h1>', 'design.json': '{"version":1,"kind":"page","title":"A"}\n', 'DESIGN.md': '# notes' });
  const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const hub = createChangeHub(randomUUID());
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const settings: SettingsStore = {
    root: () => tmp.root,
    defaultRoot: () => tmp.root,
    read: () => ({ version: 1, root: tmp.root }),
    async update() {
      throw new Error('not used');
    },
    onRootChange: () => () => undefined,
  };
  let listener: ((event: string, filename: string | null) => void) | null = null;
  const fake = { close() {}, on: () => fake, once: () => fake, emit: () => false, ref: () => fake, unref: () => fake };
  const watchImpl = ((_root: string, _options: unknown, callback: (event: string, filename: string | null) => void) => {
    listener = callback;
    // Safe: the watcher only calls close() and on('error') on what fs.watch answers.
    return fake as unknown as FSWatcher;
  }) as unknown as typeof import('node:fs').watch;
  const selfWrites = createSelfWrites();
  const watcher = startWatcher({ settings, hub, log, debounceMs: DEBOUNCE_MS, pollMs: 600_000, watchImpl, selfWrites });
  t.after(() => watcher.stop());
  await watcher.ready;
  return {
    tmp,
    events,
    watcher,
    selfWrites,
    fire: (name) => listener?.('change', name),
    settle: async (mark) => {
      await sleep(DEBOUNCE_MS * 4);
      return events.filter((event) => event.seq > mark && event.slug === 'art');
    },
    userWrite: async (rel, text) => {
      selfWrites.record('art', rel, sha256(text), Buffer.byteLength(text));
      await writeFile(tmp.at(`art/${rel}`), text);
    },
  };
};

const seqOf = (rig: Rig): number => rig.events.at(-1)?.seq ?? 0;

test('the echo of the service\'s own write emits nothing', async (t) => {
  const rig = await setup(t);
  const mark = seqOf(rig);
  await rig.userWrite('index.html', '<h1>edited</h1>');
  rig.fire('art/index.html');
  assert.deepEqual(await rig.settle(mark), []);
});

test('a doubled Windows event for one rename, in separate flushes, is dropped both times', async (t) => {
  const rig = await setup(t);
  const mark = seqOf(rig);
  await rig.userWrite('index.html', '<h1>edited</h1>');
  rig.fire('art/index.html');
  assert.deepEqual(await rig.settle(mark), []);
  rig.fire('art/index.html');
  assert.deepEqual(await rig.settle(mark), [], 'the entry is not consumed by the first event');
});

test('the poll backstop seeing the change later (no live event) still reads it as the echo', async (t) => {
  const rig = await setup(t);
  const mark = seqOf(rig);
  await rig.userWrite('index.html', '<h1>edited, seen only by the poll</h1>');
  // No fs.watch event: OneDrive dropped it. Time does not matter (no TTL), the poll finds the
  // fingerprint moved and the batch goes through the same filter.
  await sleep(DEBOUNCE_MS * 2);
  await rig.watcher.pollNow();
  assert.deepEqual(await rig.settle(mark), []);
});

test('an agent write of different bytes after the echo is shown', async (t) => {
  const rig = await setup(t);
  const mark = seqOf(rig);
  await rig.userWrite('index.html', '<h1>edited</h1>');
  rig.fire('art/index.html');
  assert.deepEqual(await rig.settle(mark), []);
  await writeFile(rig.tmp.at('art/index.html'), '<h1>the agent wrote this</h1>');
  rig.fire('art/index.html');
  const events = await rig.settle(mark);
  assert.deepEqual(events.map((event) => [event.kind, event.files, event.origin]), [['files', ['index.html'], undefined]]);
});

test('B then A: the agent writing B and then the user\'s bytes A again shows both', async (t) => {
  const rig = await setup(t);
  await rig.userWrite('index.html', 'A');
  rig.fire('art/index.html');
  await rig.settle(seqOf(rig));
  const mark = seqOf(rig);
  await writeFile(rig.tmp.at('art/index.html'), 'B');
  rig.fire('art/index.html');
  assert.equal((await rig.settle(mark)).length, 1, 'B is shown');
  const markB = seqOf(rig);
  await writeFile(rig.tmp.at('art/index.html'), 'A');
  rig.fire('art/index.html');
  const shown = await rig.settle(markB);
  assert.deepEqual(shown.map((event) => event.files), [['index.html']], 'A again is the agent\'s write, so the wall leaves B');
});

test('a batch with the echo and an agent file lists only the agent file; a design.json echo emits no design event', async (t) => {
  const rig = await setup(t);
  const mark = seqOf(rig);
  await rig.userWrite('index.html', '<h1>edited</h1>');
  await rig.userWrite('design.json', '{"version":1,"kind":"page","title":"Renamed"}\n');
  await writeFile(rig.tmp.at('art/DESIGN.md'), '# the agent');
  rig.fire('art/index.html');
  rig.fire('art/design.json');
  rig.fire('art/DESIGN.md');
  const events = await rig.settle(mark);
  assert.deepEqual(events.map((event) => [event.kind, event.files]), [['files', ['DESIGN.md']]]);
});

test('a removal the service made (recorded null) is the echo while the file stays absent', async (t) => {
  const rig = await setup(t);
  const mark = seqOf(rig);
  rig.selfWrites.record('art', 'DESIGN.md', null, null);
  await rm(rig.tmp.at('art/DESIGN.md'));
  rig.fire('art/DESIGN.md');
  assert.deepEqual(await rig.settle(mark), []);
});

test('without a registry the watcher reports every change as before', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.writeDesign('art', { 'index.html': 'x' });
  const hub = createChangeHub(randomUUID());
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const settings: SettingsStore = {
    root: () => tmp.root,
    defaultRoot: () => tmp.root,
    read: () => ({ version: 1, root: tmp.root }),
    async update() {
      throw new Error('not used');
    },
    onRootChange: () => () => undefined,
  };
  const watcher = startWatcher({ settings, hub, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, debounceMs: DEBOUNCE_MS, pollMs: 600_000 });
  t.after(() => watcher.stop());
  await watcher.ready;
  await writeFile(tmp.at('art/index.html'), 'y');
  await watcher.pollNow();
  await sleep(DEBOUNCE_MS * 4);
  assert.ok(events.some((event) => event.kind === 'files' && (event.files ?? []).includes('index.html')));
});
