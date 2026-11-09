// The watcher and the §6.3 merge under it (docs/SPEC.md §9.4, §4.8, SPEC §14 WP1):
// fs.watch fast path + poll backstop, per-slug debounce, ignored service-owned paths,
// root switching, and the acceptance pair — an agent overwrite that drops the comments is
// re-merged within 1 s, and the merge itself never loops.

import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import type { FSWatcher } from 'node:fs';

import { createChangeHub } from '../../../src/service/changes.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { FINGERPRINT_ENTRIES_MAX, carryNested, startWatcher, sweepSlice, takeFingerprint, type Fingerprint, type Watcher } from '../../../src/service/watch.ts';
import type { ChangeHub, Logger, SettingsStore } from '../../../src/service/context.ts';
import { WATCH_POLL_MS } from '../../../src/shared/limits.ts';
import type { ChangeEvent, ChangeKind } from '../../../src/shared/types.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import type { LogLine } from './harness.ts';

type WatchEnv = {
  tmp: TmpRoot;
  logs: LogLine[];
  hub: ChangeHub;
  events: ChangeEvent[];
  settings: SettingsStore;
  watcher: Watcher;
  setRoot(next: string): void;
  root(): string;
  waitForEvent(predicate: (event: ChangeEvent) => boolean, timeoutMs?: number): Promise<ChangeEvent>;
  quietFor(ms: number): Promise<void>;
};

const makeWatchEnv = async (
  t: TestContext,
  options: {
    debounceMs?: number;
    pollMs?: number;
    watchImpl?: typeof import('node:fs').watch;
    withStore?: boolean;
    sweepTicks?: number;
    fingerprint?: (dir: string, options: { nested: boolean }) => Promise<Fingerprint>;
  } = {},
): Promise<WatchEnv & { store?: ReturnType<typeof createDesignStore> }> => {
  const tmp = await useTmpRoot(t);
  const logs: LogLine[] = [];
  const log: Logger = {
    info: (event, fields) => void logs.push({ level: 'info', event, fields }),
    warn: (event, fields) => void logs.push({ level: 'warn', event, fields }),
    error: (event, fields) => void logs.push({ level: 'error', event, fields }),
  };
  const hub = createChangeHub(randomUUID());
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));

  let currentRoot = tmp.root;
  const rootListeners = new Set<(next: string, previous: string) => void>();
  const settings: SettingsStore = {
    root: () => currentRoot,
    defaultRoot: () => currentRoot,
    read: () => ({ version: 1, root: currentRoot }),
    async update() {
      throw new Error('not used in watch tests');
    },
    onRootChange(listener) {
      rootListeners.add(listener);
      return () => rootListeners.delete(listener);
    },
  };

  const store = options.withStore ? createDesignStore({ settings, log, hub }) : undefined;
  const watcher = startWatcher({
    settings,
    hub,
    log,
    debounceMs: options.debounceMs ?? 50,
    pollMs: options.pollMs ?? WATCH_POLL_MS,
    ...(options.watchImpl ? { watchImpl: options.watchImpl } : {}),
    ...(options.sweepTicks === undefined ? {} : { sweepTicks: options.sweepTicks }),
    ...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
  });
  t.after(() => watcher.stop());
  // Folders a test creates after this are changes, not part of the startup baseline.
  await watcher.ready;

  const waitForEvent = async (predicate: (event: ChangeEvent) => boolean, timeoutMs = 4000): Promise<ChangeEvent> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = events.find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${timeoutMs} ms waiting for an event; saw: ${JSON.stringify(events)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  return {
    tmp,
    logs,
    hub,
    events,
    settings,
    watcher,
    store,
    root: () => currentRoot,
    setRoot(next: string) {
      const previous = currentRoot;
      currentRoot = next;
      for (const listener of [...rootListeners]) listener(next, previous);
    },
    waitForEvent,
    quietFor: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
};

/** A dead fs.watch stand-in so only the poll backstop can produce events. */
const deadWatch = (() => {
  const fake = { close() {}, on: () => fake, once: () => fake, emit: () => false, ref: () => fake, unref: () => fake };
  return fake as unknown as FSWatcher;
}) as unknown as typeof import('node:fs').watch;

describe('watcher events', () => {
  test('a new design folder emits "added", file writes emit "files", design.json emits "design", deletion emits "removed"', async (t) => {
    const env = await makeWatchEnv(t, { pollMs: 600_000 }); // isolate the fs.watch fast path
    await env.quietFor(150); // let the seed scan settle

    await mkdir(env.tmp.at('demo'), { recursive: true });
    await env.waitForEvent((event) => event.slug === 'demo' && event.kind === 'added');

    await writeFile(env.tmp.at('demo/index.html'), '<h1>one</h1>', 'utf8');
    const files = await env.waitForEvent((event) => event.slug === 'demo' && event.kind === 'files');
    assert.deepEqual(files.files, ['index.html']);

    await writeFile(env.tmp.at('demo/design.json'), '{"version":1}', 'utf8');
    await env.waitForEvent((event) => event.slug === 'demo' && event.kind === 'design');

    await mkdir(env.tmp.at('demo/screens'), { recursive: true });
    await writeFile(env.tmp.at('demo/screens/home.html'), '<h1>home</h1>', 'utf8');
    const nested = await env.waitForEvent((event) => event.slug === 'demo' && event.kind === 'files' && (event.files ?? []).includes('screens/home.html'));
    assert.ok(nested.seq > files.seq);

    await rm(env.tmp.at('demo'), { recursive: true, force: true });
    await env.waitForEvent((event) => event.slug === 'demo' && event.kind === 'removed');
  });

  test('service-owned paths are ignored: .chamber/, .versions/, .thumb.png, tmp files, .trash/', async (t) => {
    const env = await makeWatchEnv(t, { pollMs: 600_000 });
    await mkdir(env.tmp.at('demo'), { recursive: true });
    await env.waitForEvent((event) => event.slug === 'demo' && event.kind === 'added');
    const mark = env.hub.seq();

    await mkdir(env.tmp.at('demo/.chamber'), { recursive: true });
    await writeFile(env.tmp.at('demo/.chamber/state.json'), '{}', 'utf8');
    await mkdir(env.tmp.at('demo/.versions'), { recursive: true });
    await writeFile(env.tmp.at('demo/.versions/index.json'), '{}', 'utf8');
    await writeFile(env.tmp.at('demo/.thumb.png'), 'PNG', 'utf8');
    await writeFile(env.tmp.at('demo/.design.json.tmp-42-abc'), 'partial', 'utf8');
    await writeFile(env.tmp.at('demo/.index.html.2bba59ef828e.tmp'), 'partial', 'utf8');
    await writeFile(env.tmp.at('demo/index.html.2bba59ef828e.tmp'), 'partial', 'utf8'); // an older build's undotted temp name
    await mkdir(env.tmp.at('.trash/old-1'), { recursive: true });
    await writeFile(env.tmp.at('.trash/old-1/design.json'), '{}', 'utf8');

    await env.quietFor(500); // five debounce windows: nothing may arrive
    const late = env.events.filter((event) => event.seq > mark);
    assert.deepEqual(late, [], `unexpected events: ${JSON.stringify(late)}`);
  });

  test('the poll backstop delivers changes when fs.watch is dead (OneDrive/network roots)', async (t) => {
    const env = await makeWatchEnv(t, { watchImpl: deadWatch, pollMs: 120 });
    await mkdir(env.tmp.at('polled'), { recursive: true });
    await env.waitForEvent((event) => event.slug === 'polled' && event.kind === 'added', 6000);

    await writeFile(env.tmp.at('polled/design.json'), '{"version":1}', 'utf8');
    await env.waitForEvent((event) => event.slug === 'polled' && event.kind === 'design', 6000);

    await mkdir(env.tmp.at('polled/screens'), { recursive: true });
    await writeFile(env.tmp.at('polled/screens/a.html'), '<h1>a</h1>', 'utf8');
    const files = await env.waitForEvent((event) => event.slug === 'polled' && event.kind === 'files' && (event.files ?? []).includes('screens/a.html'), 6000);
    assert.ok(files.seq > 0);
  });

  test('poll-only roots: the service\'s own dot writes emit nothing; a new top-level file is named (KI-1)', async (t) => {
    const env = await makeWatchEnv(t, { watchImpl: deadWatch, pollMs: 120 });
    await mkdir(env.tmp.at('polled/screens'), { recursive: true });
    await writeFile(env.tmp.at('polled/screens/home.html'), '<p>home</p>', 'utf8');
    await env.waitForEvent((event) => event.slug === 'polled' && event.kind === 'added', 6000);
    await env.quietFor(500);
    const mark = env.hub.seq();

    // Exactly what thumbnails.ts does when it publishes a capture, and a mirror tmp file.
    const thumbTmp = env.tmp.at(`polled/.thumb.${Date.now()}.png`);
    await writeFile(thumbTmp, 'png');
    await rename(thumbTmp, env.tmp.at('polled/.thumb.png'));
    await writeFile(env.tmp.at('polled/.design.json.tmp-1-x'), '{}', 'utf8');
    await env.quietFor(800);
    const late = env.events.filter((event) => event.seq > mark && event.slug === 'polled');
    assert.deepEqual(late, [], `a service dot write is not a content change: ${JSON.stringify(late)}`);

    await writeFile(env.tmp.at('polled/notes.txt'), 'new', 'utf8');
    const added = await env.waitForEvent((event) => event.seq > mark && event.slug === 'polled' && event.kind === 'files', 6000);
    assert.deepEqual(added.files, ['notes.txt']);
  });

  test('a design.json write whose own event never came is still reported with the next event in that folder', async (t) => {
    // Windows' recursive watch and OneDrive can drop or coalesce events. When another event in
    // the same folder flushes first, the flush moves the poll fingerprint past the design.json
    // change; unless that flush reports it, the poll never sees it again and the design is
    // never reconciled. The poll is off here, so only the flush can report it.
    let emit: ((event: string, filename: string | null) => void) | null = null;
    const scripted = ((_root: string, _options: unknown, listener: (event: string, filename: string | null) => void) => {
      emit = listener;
      const fake = { close() {}, on: () => fake, once: () => fake, emit: () => false, ref: () => fake, unref: () => fake };
      return fake as unknown as FSWatcher;
    }) as unknown as typeof import('node:fs').watch;
    const env = await makeWatchEnv(t, { watchImpl: scripted, pollMs: 600_000 });
    assert.ok(emit !== null, 'the watcher started the scripted watch');
    // Safe: narrowed by the assert above; TypeScript cannot see the callback's assignment.
    const fire = emit as (event: string, filename: string | null) => void;

    await mkdir(env.tmp.at('dropped'), { recursive: true });
    await writeFile(env.tmp.at('dropped/index.html'), '<h1>one</h1>', 'utf8');
    fire('rename', 'dropped');
    await env.waitForEvent((event) => event.slug === 'dropped' && event.kind === 'added', 2000);

    await writeFile(env.tmp.at('dropped/design.json'), '{"kind":"page"}', 'utf8');
    await writeFile(env.tmp.at('dropped/index.html'), '<h1>two</h1>', 'utf8');
    fire('change', 'dropped/index.html'); // design.json's own event was dropped
    const design = await env.waitForEvent((event) => event.slug === 'dropped' && event.kind === 'design', 2000);
    const files = env.events.find((event) => event.slug === 'dropped' && event.kind === 'files');
    assert.deepEqual(files?.files, ['index.html']);
    assert.ok(design.seq > 0);
  });

  test('a root switch emits "root", follows the new root and ignores the old one', async (t) => {
    const env = await makeWatchEnv(t, { pollMs: 600_000 });
    await mkdir(env.tmp.at('old-root-design'), { recursive: true });
    await mkdir(env.tmp.at('root-b'), { recursive: true });
    await env.waitForEvent((event) => event.slug === 'old-root-design' && event.kind === 'added');

    env.setRoot(env.tmp.at('root-b'));
    await env.waitForEvent((event) => event.slug === null && event.kind === 'root');
    // Folders created after the new root's baseline are changes, not part of it.
    await env.watcher.ready;

    await mkdir(env.tmp.at('root-b/new-design'), { recursive: true });
    await env.waitForEvent((event) => event.slug === 'new-design' && event.kind === 'added');

    const mark = env.hub.seq();
    await writeFile(env.tmp.at('old-root-design/index.html'), '<h1>ignored</h1>', 'utf8');
    await env.quietFor(400);
    assert.deepEqual(env.events.filter((event) => event.seq > mark && event.slug === 'old-root-design'), []);
  });
});

describe('loose html files in the root (agent-guidance spec §3.5)', () => {
  const looseEvents = (env: WatchEnv, after: number): ChangeEvent[] =>
    env.events.filter((event) => event.seq > after && event.kind === 'loose');

  test('adding and removing a root html file emits "loose" (fs.watch path); AGENTS.md, dot files and design folders do not', async (t) => {
    const env = await makeWatchEnv(t, { pollMs: 600_000 });
    await env.quietFor(150);

    let mark = env.hub.seq();
    await writeFile(env.tmp.at('stray.html'), '<p>stray</p>', 'utf8');
    const added = await env.waitForEvent((event) => event.seq > mark && event.kind === 'loose');
    assert.equal(added.slug, null);

    mark = env.hub.seq();
    await writeFile(env.tmp.at('AGENTS.md'), '# guide', 'utf8');
    await writeFile(env.tmp.at('.hidden.html'), '<p>h</p>', 'utf8');
    await mkdir(env.tmp.at('a-design'), { recursive: true });
    await writeFile(env.tmp.at('a-design/index.html'), '<p>design</p>', 'utf8');
    await env.waitForEvent((event) => event.seq > mark && event.slug === 'a-design' && event.kind === 'added');
    await env.quietFor(400);
    assert.deepEqual(looseEvents(env, mark), [], 'nothing changed the loose set');

    mark = env.hub.seq();
    await rm(env.tmp.at('stray.html'));
    await env.waitForEvent((event) => event.seq > mark && event.kind === 'loose');
  });

  test('the poll backstop catches loose files when fs.watch is dead', async (t) => {
    const env = await makeWatchEnv(t, { watchImpl: deadWatch, pollMs: 120 });
    const mark = env.hub.seq();
    await writeFile(env.tmp.at('polled.htm'), '<p>p</p>', 'utf8');
    await env.waitForEvent((event) => event.seq > mark && event.kind === 'loose', 6000);
    const second = env.hub.seq();
    await writeFile(env.tmp.at('AGENTS.md'), '# guide', 'utf8');
    await env.quietFor(500);
    assert.deepEqual(looseEvents(env, second), [], 'AGENTS.md is not loose html');
  });

  test('files already there at start are the baseline, not a change', async (t) => {
    const tmpEnv = await makeWatchEnv(t, { pollMs: 120, watchImpl: deadWatch });
    // Restart the watcher over a root that already holds a loose file.
    await writeFile(tmpEnv.tmp.at('before.html'), '<p>b</p>', 'utf8');
    await tmpEnv.waitForEvent((event) => event.kind === 'loose', 6000);
    tmpEnv.watcher.stop();

    const hub = createChangeHub(randomUUID());
    const events: ChangeEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const fresh = startWatcher({ settings: tmpEnv.settings, hub, log: { info() {}, warn() {}, error() {} }, debounceMs: 50, pollMs: 120, watchImpl: deadWatch });
    t.after(() => fresh.stop());
    await fresh.ready;
    await tmpEnv.quietFor(500);
    assert.deepEqual(events.filter((event) => event.kind === 'loose'), []);
  });
});

describe('fs.watch that cannot work here (Linux inotify limit, no recursive support)', () => {
  const failing = (code: string, how: 'throw' | 'emit') => {
    let calls = 0;
    const impl = (() => {
      calls += 1;
      const error = Object.assign(new Error(`${code}: System limit for number of file watchers reached, watch`), { code });
      if (how === 'throw') throw error;
      let onError: ((error: Error) => void) | null = null;
      const fake = {
        close() {},
        on(event: string, listener: (error: Error) => void) {
          if (event === 'error') {
            onError = listener;
            setTimeout(() => onError?.(error), 5);
          }
          return fake;
        },
      };
      return fake as unknown as FSWatcher;
    }) as unknown as typeof import('node:fs').watch;
    return { impl, calls: () => calls };
  };

  for (const [code, how] of [
    ['ENOSPC', 'emit'],
    ['ENOSPC', 'throw'],
    ['ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', 'throw'],
  ] as const) {
    test(`${code} (${how}): logged once as poll-only, never retried, and the poll backstop keeps the list live`, async (t) => {
      const watch = failing(code, how);
      const env = await makeWatchEnv(t, { watchImpl: watch.impl, pollMs: 100 });
      await env.quietFor(150); // let the seed scan settle, or it may adopt the folder silently
      await mkdir(env.tmp.at('polled'), { recursive: true });
      await env.waitForEvent((event) => event.slug === 'polled' && event.kind === 'added', 6000);
      await writeFile(env.tmp.at('polled/index.html'), '<h1>x</h1>', 'utf8');
      await env.waitForEvent((event) => event.slug === 'polled' && event.kind === 'files', 6000);
      await env.quietFor(350); // several more poll ticks
      assert.equal(watch.calls(), 1, 'a permanent failure is not retried every poll tick');
      assert.deepEqual(env.logs.map((line) => `${line.level}:${line.event}`), ['info:watch.poll-only']);
    });
  }

  test('a transient failure is still retried by the poll tick', async (t) => {
    const watch = failing('EMFILE', 'throw');
    const env = await makeWatchEnv(t, { watchImpl: watch.impl, pollMs: 60 });
    await env.quietFor(400);
    assert.ok(watch.calls() > 1, `retried (${watch.calls()} calls)`);
    assert.deepEqual(env.logs.filter((line) => line.event.startsWith('watch.')).map((line) => `${line.level}:${line.event}`), ['warn:watch.unavailable'], 'logged once');
  });

  test('a root switch gives fs.watch another chance', async (t) => {
    const watch = failing('ENOSPC', 'throw');
    const env = await makeWatchEnv(t, { watchImpl: watch.impl, pollMs: 60 });
    await env.quietFor(200);
    assert.equal(watch.calls(), 1);
    await mkdir(env.tmp.at('root-b'), { recursive: true });
    env.setRoot(env.tmp.at('root-b'));
    await env.quietFor(50);
    assert.equal(watch.calls(), 2);
  });
});

describe('design.json merge under the watcher (§6.3, WP1 acceptance)', () => {
  test('an agent overwrite that dropped the comments is re-merged within 1 s', async (t) => {
    const env = await makeWatchEnv(t, { debounceMs: 250, pollMs: 600_000, withStore: true });
    const store = env.store;
    assert.ok(store);
    const created = await store.create({ kind: 'canvas', title: 'Live merge' });
    const comment = await store.addComment(created.slug, {
      screen: null,
      viewport: 'laptop',
      anchor: { selector: 'main > h1', text: 'Ship faster', html: '<h1>', rect: { x: 1, y: 2, w: 3, h: 4 }, point: { x: 0.5, y: 0.5 } },
      body: 'Keep me',
    });
    await env.quietFor(500); // let the watcher digest the service's own writes

    // The agent rewrites design.json wholesale — comments gone, title changed, unknown key added.
    const designFile = path.join(created.path, 'design.json');
    const started = Date.now();
    await writeFile(
      designFile,
      JSON.stringify({
        version: 1,
        kind: 'canvas',
        title: 'Agent retitled',
        created: '2020-01-01T00:00:00.000Z',
        updated: new Date().toISOString(),
        viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
        screens: [],
        designSystem: { confirmed: true },
        agentExtra: 'kept',
      }),
      'utf8',
    );

    let mergedText = '';
    const deadline = started + 4000;
    for (;;) {
      mergedText = await readFile(designFile, 'utf8');
      if (mergedText.includes(comment.id)) break;
      if (Date.now() > deadline) throw new Error(`design.json was never re-merged; last content: ${mergedText}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `re-merge took ${elapsed} ms, over the 1 s acceptance budget`);

    const merged = JSON.parse(mergedText) as Record<string, unknown>;
    assert.equal(merged.title, 'Agent retitled');
    assert.equal(merged.agentExtra, 'kept');
    assert.equal(merged.created, created.design.created); // service-owned: state.json wins
    assert.equal((merged.comments as unknown[]).length, 1);
  });

  test('the merge never loops: one rewrite, then silence', async (t) => {
    const env = await makeWatchEnv(t, { debounceMs: 120, pollMs: 600_000, withStore: true });
    const store = env.store;
    assert.ok(store);
    const created = await store.create({ kind: 'canvas', title: 'No loop' });
    await store.addComment(created.slug, {
      screen: null,
      viewport: 'laptop',
      anchor: { selector: 'h1', text: 'x', html: '<h1>', rect: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0.5, y: 0.5 } },
      body: 'Pin',
    });
    await env.quietFor(400);

    const designFile = path.join(created.path, 'design.json');
    await writeFile(designFile, JSON.stringify({ version: 1, kind: 'canvas', title: 'Dropped everything' }), 'utf8');
    await env.waitForEvent((event) => event.slug === created.slug && event.kind === 'design');
    // Wait for the merge write to land…
    const merged = await new Promise<string>((resolve) => {
      const poll = (): void => {
        void readFile(designFile, 'utf8').then((text) => {
          if (text.includes('Dropped everything') && text.includes('comments')) resolve(text);
          else setTimeout(poll, 20);
        });
      };
      poll();
    });
    assert.ok(merged.includes('comments'));
    const afterMerge = await stat(designFile);

    await env.quietFor(900); // ~7 debounce windows of silence
    const still = await stat(designFile);
    assert.equal(still.mtimeMs, afterMerge.mtimeMs, 'design.json must not be rewritten again');
    assert.equal(await readFile(designFile, 'utf8'), merged);
    assert.equal(env.logs.filter((line) => line.event === 'store.design-json-remerged').length, 1, 'exactly one re-merge write, then silence');
  });
});

describe('rotating sweep while the live watcher is healthy (phase 0b)', () => {
  /** A watcher that stays alive and says nothing; `fail` makes the latest one report an error. */
  const silentWatch = () => {
    let calls = 0;
    const errorListeners: Array<(error: Error) => void> = [];
    const impl = (() => {
      calls += 1;
      const fake = {
        close() {},
        on(event: string, listener: (error: Error) => void) {
          if (event === 'error') errorListeners.push(listener);
          return fake;
        },
        once: () => fake,
        ref: () => fake,
        unref: () => fake,
      };
      return fake as unknown as FSWatcher;
    }) as unknown as typeof import('node:fs').watch;
    return { impl, calls: () => calls, fail: (error: Error) => errorListeners.at(-1)?.(error) };
  };

  /** Counts fingerprint calls per design folder name: `counts` all of them, `deep` the ones that walked nested folders. */
  const counting = () => {
    const counts = new Map<string, number>();
    const deep = new Map<string, number>();
    return {
      counts,
      deep,
      clear: () => {
        counts.clear();
        deep.clear();
      },
      fingerprint: (dir: string, options: { nested: boolean }): Promise<Fingerprint> => {
        const slug = path.basename(dir);
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
        if (options.nested) deep.set(slug, (deep.get(slug) ?? 0) + 1);
        return takeFingerprint(dir, undefined, options.nested);
      },
    };
  };

  const makeDesigns = async (env: WatchEnv, slugs: string[]): Promise<void> => {
    for (const slug of slugs) {
      await mkdir(env.tmp.at(slug), { recursive: true });
      await writeFile(env.tmp.at(`${slug}/index.html`), `<h1>${slug}</h1>`, 'utf8');
    }
  };

  test('sweepSlice walks the sorted list, wraps around, and copes with an empty list or a stale cursor', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(sweepSlice(list, 0, 2), { slice: ['a', 'b'], next: 2 });
    assert.deepEqual(sweepSlice(list, 4, 2), { slice: ['e', 'a'], next: 1 });
    assert.deepEqual(sweepSlice(list, 3, 9), { slice: ['d', 'e', 'a', 'b', 'c'], next: 3 }, 'never more than the list, each once');
    assert.deepEqual(sweepSlice(list, 12, 1), { slice: ['c'], next: 3 }, 'a cursor past the end wraps');
    assert.deepEqual(sweepSlice([], 7, 3), { slice: [], next: 0 });
    assert.deepEqual(sweepSlice(list, 1, 0), { slice: [], next: 1 });
  });

  test('★ healthy watcher: 20 designs, sweepTicks 10 — after 10 polls every design was fingerprinted exactly once', async (t) => {
    const watch = silentWatch();
    const spy = counting();
    const env = await makeWatchEnv(t, { watchImpl: watch.impl, pollMs: 600_000, sweepTicks: 10, fingerprint: spy.fingerprint });
    const slugs = Array.from({ length: 20 }, (_, i) => `design-${String(i).padStart(2, '0')}`);
    await makeDesigns(env, slugs);
    await env.watcher.pollNow(); // the silent watcher reported nothing: the poll finds the new folders
    spy.clear();

    for (let tick = 0; tick < 10; tick += 1) await env.watcher.pollNow();
    assert.deepEqual([...spy.counts.keys()].sort(), slugs);
    assert.deepEqual([...new Set(spy.counts.values())], [1], `each design once, saw ${JSON.stringify([...spy.counts])}`);
    assert.equal(watch.calls(), 1, 'the watcher was never restarted');
  });

  test('★ a healthy but silent watcher: an in-place edit is still reported by a later sweep (the deaf-watcher net)', async (t) => {
    const watch = silentWatch();
    const env = await makeWatchEnv(t, { watchImpl: watch.impl, pollMs: 600_000, sweepTicks: 3 });
    await makeDesigns(env, ['aa', 'bb', 'cc']);
    await env.watcher.pollNow();
    const mark = env.hub.seq();

    await writeFile(env.tmp.at('bb/index.html'), '<h1>bb, edited in place with a different length</h1>', 'utf8');
    for (let tick = 0; tick < 3; tick += 1) await env.watcher.pollNow(); // one full pass over three designs
    const event = await env.waitForEvent((e) => e.seq > mark && e.slug === 'bb' && e.kind === 'files', 6000);
    assert.deepEqual(event.files, ['index.html']);
  });

  test('a watcher that errors: the next poll fingerprints every design, then the sweep rotates again', async (t) => {
    const watch = silentWatch();
    const spy = counting();
    const env = await makeWatchEnv(t, { watchImpl: watch.impl, pollMs: 600_000, sweepTicks: 10, fingerprint: spy.fingerprint });
    await makeDesigns(env, ['aa', 'bb', 'cc', 'dd']);
    await env.watcher.pollNow();
    const mark = env.hub.seq();

    watch.fail(Object.assign(new Error('too many open files'), { code: 'EMFILE' }));
    await writeFile(env.tmp.at('cc/index.html'), '<h1>changed while the watcher was down, longer</h1>', 'utf8');
    spy.clear();
    await env.watcher.pollNow();
    assert.deepEqual([...spy.counts].sort(), [['aa', 1], ['bb', 1], ['cc', 1], ['dd', 1]], 'every design looked at, not a slice');
    assert.equal(watch.calls(), 2, 'the poll tick restarted the watcher');
    await env.waitForEvent((e) => e.seq > mark && e.slug === 'cc' && e.kind === 'files', 6000);

    spy.clear();
    await env.watcher.pollNow();
    assert.equal([...spy.counts.values()].reduce((a, b) => a + b, 0), 1, 'healthy again: one design per tick for four designs at sweepTicks 10');
  });

  const unavailableWatch = (() => {
    throw Object.assign(new Error('ENOSPC: System limit for number of file watchers reached'), { code: 'ENOSPC' });
  }) as unknown as typeof import('node:fs').watch;

  test('★ poll-only root: every design gets the cheap check each tick and the nested walk rotates, so a pass over 20 designs walks each exactly once', async (t) => {
    const spy = counting();
    const env = await makeWatchEnv(t, { watchImpl: unavailableWatch, pollMs: 600_000, sweepTicks: 10, fingerprint: spy.fingerprint });
    const slugs = Array.from({ length: 20 }, (_, i) => `design-${String(i).padStart(2, '0')}`);
    await makeDesigns(env, slugs);
    await env.watcher.pollNow();
    spy.clear();

    for (let tick = 0; tick < 10; tick += 1) await env.watcher.pollNow();
    assert.deepEqual([...new Set(spy.counts.values())], [10], 'cheap check: every design on every tick');
    assert.deepEqual([...spy.deep.keys()].sort(), slugs);
    assert.deepEqual([...new Set(spy.deep.values())], [1], 'nested walk: each design once per pass of 10 ticks');
  });

  test('★ poll-only root: a top-level stylesheet edit shows on the next tick; nested asset edits and new nested files show within one pass', async (t) => {
    const env = await makeWatchEnv(t, { watchImpl: unavailableWatch, pollMs: 600_000, sweepTicks: 10 });
    await makeDesigns(env, ['pp', 'qq', 'rr']);
    await env.tmp.write('pp/assets/img/a.png', 'AAAA');
    await env.tmp.write('pp/styles.css', 'body{}');
    await env.watcher.pollNow();
    const pass = async (): Promise<void> => {
      for (let tick = 0; tick < 10; tick += 1) await env.watcher.pollNow();
    };

    let mark = env.hub.seq();
    await writeFile(env.tmp.at('pp/styles.css'), 'body{margin:0}', 'utf8');
    await env.watcher.pollNow(); // one tick, not a pass
    const css = await env.waitForEvent((e) => e.seq > mark && e.slug === 'pp' && e.kind === 'files', 6000);
    assert.deepEqual(css.files, ['styles.css']);

    // In-place rewrite: same size, new mtime. Nothing about the folder listing changes.
    mark = env.hub.seq();
    await writeFile(env.tmp.at('pp/assets/img/a.png'), 'BBBB');
    const later = new Date(Date.now() + 10_000);
    await utimes(env.tmp.at('pp/assets/img/a.png'), later, later);
    await pass();
    const rewrite = await env.waitForEvent((e) => e.seq > mark && e.slug === 'pp' && e.kind === 'files', 6000);
    assert.deepEqual(rewrite.files, ['assets/img/a.png']);

    mark = env.hub.seq();
    await env.tmp.write('pp/assets/img/deeper/b.png', 'new');
    await pass();
    const nested = await env.waitForEvent((e) => e.seq > mark && e.slug === 'pp' && e.kind === 'files', 6000);
    assert.ok((nested.files ?? []).includes('assets/img/deeper/b.png'), JSON.stringify(nested.files));

    // Ticks that skipped the walk must not read as "the nested files vanished".
    const settled = env.hub.seq();
    await pass();
    assert.deepEqual(env.events.filter((e) => e.seq > settled && e.slug === 'pp'), [], 'nothing changed, nothing reported');
  });

  test('a poll tick never starts while the previous one is still running (slow network share)', async (t) => {
    let active = 0;
    let maxActive = 0;
    let started = 0;
    let release: () => void = () => {};
    let gate: Promise<void> | null = null;
    const slow = async (dir: string, options: { nested: boolean }): Promise<Fingerprint> => {
      if (gate !== null) {
        started += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
      }
      return takeFingerprint(dir, undefined, options.nested);
    };
    const env = await makeWatchEnv(t, { watchImpl: unavailableWatch, pollMs: 15, sweepTicks: 1, fingerprint: slow });
    await makeDesigns(env, ['aa']);
    await env.watcher.pollNow();

    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deadline = Date.now() + 6000;
    while (started === 0) {
      if (Date.now() > deadline) throw new Error('the timer-driven poll never started');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // Proving a negative takes time: well over ten poll intervals, during which the first tick is held.
    const heldUntil = Date.now() + 250;
    while (Date.now() < heldUntil) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(started, 1, 'no second tick began while the first was running');
    assert.equal(maxActive, 1);
    release();
  });

  test('a poll tick that throws releases the no-overlap guard: the timer-driven poll keeps running', async (t) => {
    let calls = 0;
    let throwNext = false;
    let thrown = false;
    const flaky = async (dir: string, options: { nested: boolean }): Promise<Fingerprint> => {
      calls += 1;
      if (throwNext) {
        throwNext = false;
        thrown = true;
        throw new Error('EIO: the share went away for a moment');
      }
      return takeFingerprint(dir, undefined, options.nested);
    };
    const env = await makeWatchEnv(t, { watchImpl: unavailableWatch, pollMs: 15, sweepTicks: 1, fingerprint: flaky });
    await makeDesigns(env, ['aa']);
    await env.watcher.pollNow();
    throwNext = true;
    const deadline = Date.now() + 6000;
    while (!thrown) {
      if (Date.now() > deadline) throw new Error('the timer-driven poll never ran');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const after = calls;
    while (calls === after) {
      if (Date.now() > deadline) throw new Error('no poll tick ran after one threw: the guard stayed held');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(env.logs.some((line) => line.event === 'watch.poll-failed'), 'the failed tick was logged');
  });

  // QA finding (phase 0b re-review): the cheap fingerprint keys every top-level folder, but the full
  // one stops keying folders once the walk budget is spent. On a poll-only root a design with more
  // than 256 entries under assets/ and another top-level folder (fonts/) then flips between the two
  // forms and reports `fonts/` as changed on most ticks with nothing changed on disk: the open page
  // reloads every few seconds and the 8 s auto-snapshot quiet period never ends.
  test('poll-only root: a design whose walk hits the cap and that has another top-level folder reports nothing while nothing changes', async (t) => {
    const env = await makeWatchEnv(t, { watchImpl: unavailableWatch, pollMs: 600_000, sweepTicks: 10 });
    await makeDesigns(env, ['big', 'other-1', 'other-2']);
    for (let i = 0; i < FINGERPRINT_ENTRIES_MAX + 20; i += 1) await env.tmp.write(`big/assets/f-${String(i).padStart(3, '0')}.png`, 'x');
    await env.tmp.write('big/fonts/inter.woff2', 'font');
    await env.watcher.pollNow();
    const settled = env.hub.seq();
    for (let tick = 0; tick < 12; tick += 1) await env.watcher.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 300)); // let any scheduled flush (50 ms debounce) emit
    assert.deepEqual(
      env.events.filter((e) => e.seq > settled && e.slug === 'big').map((e) => [e.kind, e.files]),
      [],
      'nothing changed on disk, so nothing is reported',
    );
  });
});

describe('takeFingerprint (capped, sorted walk)', () => {
  const walkedKeys = (fingerprint: Fingerprint, top: string): string[] =>
    [...fingerprint.keys()].filter((key) => key.startsWith(`${top}/`) && key !== `${top}/` && key !== `${top}/…`);

  test('the walk is capped at 256 entries plus a truncated marker, and the same two calls give the same map', async (t) => {
    const tmp = await useTmpRoot(t);
    for (let i = 0; i < 300; i += 1) await tmp.write(`d/assets/f-${String(i).padStart(3, '0')}.txt`, 'x');
    const first = await takeFingerprint(tmp.at('d'));
    const second = await takeFingerprint(tmp.at('d'));
    assert.equal(FINGERPRINT_ENTRIES_MAX, 256);
    assert.equal(walkedKeys(first, 'assets').length, 256);
    assert.equal(first.get('assets/…'), 'truncated');
    assert.deepEqual([...first], [...second], 'sorted walk: the cap boundary does not move');
    assert.ok(first.has('assets/f-000.txt') && first.has('assets/f-255.txt') && !first.has('assets/f-256.txt'), 'the first 256 names in sorted order');
  });

  test('under the cap there is no marker; a smaller budget truncates sooner', async (t) => {
    const tmp = await useTmpRoot(t);
    for (let i = 0; i < 5; i += 1) await tmp.write(`d/assets/f-${i}.txt`, 'x');
    assert.equal((await takeFingerprint(tmp.at('d'))).has('assets/…'), false);
    const small = await takeFingerprint(tmp.at('d'), 3);
    assert.equal(walkedKeys(small, 'assets').length, 3);
    assert.equal(small.get('assets/…'), 'truncated');
  });

  test('nested files and folders are keyed by path; extra top-level files by mtime:size; other top-level folders are walked too', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('d/index.html', '<p>x</p>');
    await tmp.write('d/styles.css', 'body{}');
    await tmp.write('d/assets/img/a.png', 'png');
    await tmp.write('d/fonts/inter.woff2', 'font');
    const fingerprint = await takeFingerprint(tmp.at('d'));
    const info = await stat(tmp.at('d/styles.css'));
    assert.equal(fingerprint.get('styles.css'), `${info.mtimeMs}:${info.size}`);
    assert.match(fingerprint.get('assets/img/a.png') ?? '', /^\d+(\.\d+)?:3$/);
    assert.equal(fingerprint.get('assets/img/'), 'dir');
    assert.match(fingerprint.get('assets/') ?? '', /:dir$/);
    assert.equal(fingerprint.get('fonts/'), 'dir');
    assert.ok(fingerprint.has('fonts/inter.woff2'));
  });

  test('dot names and symlinks are not followed, and the walk stops at six folder levels', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('d/assets/.hidden/secret.txt', 's');
    await tmp.write('d/assets/l1/l2/l3/l4/l5/l6/too-deep.txt', 'x');
    await tmp.write('d/assets/l1/l2/l3/l4/l5/kept.txt', 'x');
    await tmp.write('outside/leak.txt', 'x');
    let linked = true;
    await symlink(tmp.at('outside'), tmp.at('d/assets/link'), 'dir').catch(() => {
      linked = false; // Windows without the privilege: the dot and depth rules are still checked
    });
    const fingerprint = await takeFingerprint(tmp.at('d'));
    assert.ok(![...fingerprint.keys()].some((key) => key.includes('.hidden')), 'dot folders skipped');
    assert.ok(fingerprint.has('assets/l1/l2/l3/l4/l5/kept.txt'), 'level 6 entries are fingerprinted');
    assert.ok(!fingerprint.has('assets/l1/l2/l3/l4/l5/l6/too-deep.txt'), 'nothing below level 6');
    if (linked) assert.ok(![...fingerprint.keys()].some((key) => key.startsWith('assets/link')), 'a symlink is neither keyed nor walked');
  });

  test('past the walk cap the cheap and the full form still agree on every top-level file and folder', async (t) => {
    const tmp = await useTmpRoot(t);
    for (let i = 0; i < FINGERPRINT_ENTRIES_MAX + 20; i += 1) await tmp.write(`d/assets/f-${String(i).padStart(3, '0')}.png`, 'x');
    await tmp.write('d/fonts/inter.woff2', 'font');
    await tmp.write('d/zz-notes.txt', 'n');
    const topLevel = (fingerprint: Fingerprint): string[] => [...fingerprint.keys()].filter((key) => !key.slice(0, -1).includes('/') && !key.endsWith('…')).sort();
    const full = await takeFingerprint(tmp.at('d'));
    const cheap = await takeFingerprint(tmp.at('d'), undefined, false);
    assert.equal(full.get('assets/…'), 'truncated', 'the walk really did hit the cap');
    assert.deepEqual(topLevel(cheap), topLevel(full));
    assert.ok(topLevel(full).includes('fonts/') && topLevel(full).includes('zz-notes.txt'));
  });

  test('carryNested keeps the last walk\'s nested keys for folders that still exist and drops those of removed folders', () => {
    const previous: Fingerprint = new Map([
      ['index.html', '1:1'],
      ['assets/', '5:dir'],
      ['assets/a.png', '2:2'],
      ['assets/img/', 'dir'],
      ['assets/…', 'truncated'],
      ['fonts/', 'dir'],
      ['fonts/x.woff2', '3:3'],
      ['screens/home.html', '4:4'],
    ]);
    const cheap: Fingerprint = new Map([
      ['index.html', '1:1'],
      ['assets/', '6:dir'],
      ['screens/home.html', '9:9'],
    ]);
    assert.deepEqual(
      [...carryNested(previous, cheap)].sort(),
      [['assets/', '6:dir'], ['assets/a.png', '2:2'], ['assets/img/', 'dir'], ['assets/…', 'truncated'], ['index.html', '1:1'], ['screens/home.html', '9:9']],
    );
    assert.equal(carryNested(undefined, cheap), cheap);
  });
});

// Windows reports a change to the design folder itself, so the full fingerprint diff (not the
// fs.watch filename filter) decides what is named: it must never key a service temp file.
test('fingerprints never key a service temp name, at the top level or nested (cheap and full)', async (t) => {
  const tmp = path.join((await import('node:os')).tmpdir(), `dc-fp-tmp-${randomUUID()}`);
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await mkdir(path.join(tmp, 'assets', 'img'), { recursive: true });
  await writeFile(path.join(tmp, 'index.html'), '<h1>hi</h1>', 'utf8');
  await writeFile(path.join(tmp, 'index.html.2bba59ef828e.tmp'), 'partial', 'utf8');
  await writeFile(path.join(tmp, 'assets', 'img', 'logo.png.0123456789ab.tmp'), 'partial', 'utf8');
  await writeFile(path.join(tmp, 'assets', 'img', 'logo.png'), 'PNG', 'utf8');
  for (const nested of [false, true]) {
    const keys = [...(await takeFingerprint(tmp, FINGERPRINT_ENTRIES_MAX, nested)).keys()];
    assert.ok(keys.includes('index.html'), `${nested ? 'full' : 'cheap'}: real files are keyed`);
    assert.ok(!keys.some((key) => key.endsWith('.tmp')), `${nested ? 'full' : 'cheap'}: no temp name keyed: ${JSON.stringify(keys)}`);
  }
});
