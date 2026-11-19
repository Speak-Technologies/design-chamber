// The watcher's systems branch (documentation/specs/phase-2-5-technical.md §5.1, AD-1): events under
// `<root>/_systems/<id>/` become `{ slug: null, kind: 'system', system, systemChange }`; the
// service's own writes are dropped by bytes under the self-writes key `_systems/<id>`; the design
// branch never sees `_systems`; the poll backstop sweeps systems after designs; folder-watch
// descends into `_systems` on Linux.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, test, type TestContext } from 'node:test';

import { createChangeHub } from '../../../src/service/changes.ts';
import type { Logger, SelfWrites, SettingsStore } from '../../../src/service/context.ts';
import { watchFolders } from '../../../src/service/folder-watch.ts';
import { createSelfWrites } from '../../../src/service/self-writes.ts';
import { startWatcher, systemSelfWritesKey, type Watcher } from '../../../src/service/watch.ts';
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
  fire(name: string): void;
  /** Events after `mark`, once the debounce has flushed. */
  settle(mark: number): Promise<ChangeEvent[]>;
  mark(): number;
};

/** A watcher whose fs.watch reports only what the test fires, and whose poll runs only on `pollNow`. */
const setup = async (t: TestContext): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/tokens.css', ':root { --brand: #111111; }\n');
  await tmp.write('_systems/acme/system.json', '{"version":1}\n');
  await tmp.writeDesign('shop', { 'index.html': '<h1>shop</h1>' });
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
  }) as unknown as typeof fsWatch;
  const selfWrites = createSelfWrites();
  const watcher = startWatcher({ settings, hub, log, debounceMs: DEBOUNCE_MS, pollMs: 600_000, watchImpl, selfWrites, sweepTicks: 1 });
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
      return events.filter((event) => event.seq > mark);
    },
    mark: () => events.at(-1)?.seq ?? 0,
  };
};

const shape = (event: ChangeEvent) => ({ slug: event.slug, kind: event.kind, system: event.system, systemChange: event.systemChange, files: event.files });

describe('the systems branch of the watcher', () => {
  test('a system existing at start is the baseline: no added event', async (t) => {
    const rig = await setup(t);
    assert.deepEqual(rig.events, []);
  });

  test('a new system folder is added; an agent write is a files event; removal is removed', async (t) => {
    const rig = await setup(t);
    let mark = rig.mark();
    await mkdir(rig.tmp.at('_systems/beta'));
    rig.fire('_systems/beta');
    assert.deepEqual((await rig.settle(mark)).map(shape), [{ slug: null, kind: 'system', system: 'beta', systemChange: 'added', files: undefined }]);

    mark = rig.mark();
    await writeFile(rig.tmp.at('_systems/acme/tokens.css'), ':root { --brand: #222222; }\n');
    rig.fire('_systems/acme/tokens.css');
    assert.deepEqual((await rig.settle(mark)).map(shape), [{ slug: null, kind: 'system', system: 'acme', systemChange: 'files', files: ['tokens.css'] }]);

    mark = rig.mark();
    await rm(rig.tmp.at('_systems/beta'), { recursive: true });
    rig.fire('_systems/beta');
    assert.deepEqual((await rig.settle(mark)).map(shape), [{ slug: null, kind: 'system', system: 'beta', systemChange: 'removed', files: undefined }]);
  });

  test("the service's own write is dropped as the echo under _systems/<id>; the agent's next write is shown", async (t) => {
    const rig = await setup(t);
    const text = ':root { --brand: #333333; }\n';
    rig.selfWrites.record(systemSelfWritesKey('acme'), 'tokens.css', sha256(text), Buffer.byteLength(text));
    let mark = rig.mark();
    await writeFile(rig.tmp.at('_systems/acme/tokens.css'), text);
    rig.fire('_systems/acme/tokens.css');
    assert.deepEqual(await rig.settle(mark), []);
    // A doubled event in a later flush is still the echo.
    rig.fire('_systems/acme/tokens.css');
    assert.deepEqual(await rig.settle(mark), []);

    mark = rig.mark();
    await writeFile(rig.tmp.at('_systems/acme/tokens.css'), ':root { --brand: #444444; }\n');
    rig.fire('_systems/acme/tokens.css');
    assert.deepEqual((await rig.settle(mark)).map((event) => event.files), [['tokens.css']]);
  });

  test('a design with the same relative path is never taken for the system echo', async (t) => {
    const rig = await setup(t);
    const text = '<h1>edited</h1>';
    rig.selfWrites.record(systemSelfWritesKey('shop'), 'index.html', sha256(text), Buffer.byteLength(text));
    const mark = rig.mark();
    await writeFile(rig.tmp.at('shop/index.html'), text);
    rig.fire('shop/index.html');
    assert.deepEqual((await rig.settle(mark)).map((event) => [event.slug, event.kind]), [['shop', 'files']]);
  });

  test('.chamber/check.json is a checks change; other .chamber and .versions files are ignored', async (t) => {
    const rig = await setup(t);
    let mark = rig.mark();
    await rig.tmp.write('_systems/acme/.chamber/check.json', '{}');
    rig.fire('_systems/acme/.chamber/check.json');
    assert.deepEqual((await rig.settle(mark)).map(shape), [{ slug: null, kind: 'system', system: 'acme', systemChange: 'checks', files: undefined }]);

    mark = rig.mark();
    await rig.tmp.write('_systems/acme/.chamber/state.json', '{}');
    await rig.tmp.write('_systems/acme/.versions/index.json', '{}');
    rig.fire('_systems/acme/.chamber/state.json');
    rig.fire('_systems/acme/.versions/index.json');
    rig.fire('_systems/acme/.tokens.css.0123456789ab.tmp');
    assert.deepEqual(await rig.settle(mark), []);
  });

  test('names that are not system folders, and links, are never systems', async (t) => {
    const rig = await setup(t);
    const outside = await useTmpRoot(t, 'dc-outside-');
    const mark = rig.mark();
    await mkdir(rig.tmp.at('_systems/Not_Valid'));
    await symlink(outside.root, rig.tmp.at('_systems/linked'), 'dir');
    rig.fire('_systems/Not_Valid/tokens.css');
    rig.fire('_systems/linked');
    rig.fire('_systems/.hidden/x');
    assert.deepEqual(await rig.settle(mark), []);
    await rig.watcher.pollNow();
    assert.deepEqual(await rig.settle(mark), []);
  });

  test('the design branch never reports _systems', async (t) => {
    const rig = await setup(t);
    const mark = rig.mark();
    await mkdir(rig.tmp.at('_systems/gamma'));
    rig.fire('_systems');
    rig.fire('_systems/gamma');
    await rig.watcher.pollNow();
    const after = await rig.settle(mark);
    assert.ok(after.every((event) => event.slug === null), JSON.stringify(after));
    assert.deepEqual(after.filter((event) => event.kind === 'system').map((event) => [event.system, event.systemChange]), [['gamma', 'added']]);
  });

  test('the poll backstop reports a system change the platform never announced', async (t) => {
    const rig = await setup(t);
    await rig.watcher.pollNow(); // baseline for every key
    const mark = rig.mark();
    await writeFile(rig.tmp.at('_systems/acme/system.json'), '{"version":1,"notes":[]}\n');
    await rig.tmp.write('_systems/acme/notes/why.md', 'Because.');
    await rig.watcher.pollNow();
    const after = (await rig.settle(mark)).filter((event) => event.kind === 'system');
    assert.equal(after.length, 1);
    assert.equal(after[0]?.system, 'acme');
    assert.ok(after[0]?.files?.includes('system.json'), JSON.stringify(after));
  });

  test('_systems vanishing removes every system', async (t) => {
    const rig = await setup(t);
    const mark = rig.mark();
    await rm(rig.tmp.at('_systems'), { recursive: true });
    rig.fire('_systems');
    assert.deepEqual((await rig.settle(mark)).map((event) => [event.system, event.systemChange]), [['acme', 'removed']]);
  });
});

describe('folder-watch descends into _systems', () => {
  test('a write inside a system folder is reported, a non-design top-level folder is not watched', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('_systems/acme/tokens.css', ':root{}');
    await tmp.write('_private/notes.txt', 'x');
    const seen: string[] = [];
    const watcher = watchFolders(tmp.root, { persistent: false }, (_event, name) => void seen.push(name ?? '<null>'));
    t.after(() => watcher.close());
    await sleep(150);
    await writeFile(tmp.at('_systems/acme/tokens.css'), ':root{--a:1px}');
    await writeFile(tmp.at('_private/notes.txt'), 'y');
    const deadline = Date.now() + 4000;
    while (!seen.includes('_systems/acme/tokens.css') && Date.now() < deadline) await sleep(20);
    assert.ok(seen.includes('_systems/acme/tokens.css'), JSON.stringify(seen));
    assert.ok(!seen.includes('_private/notes.txt'), JSON.stringify(seen));
  });
});
