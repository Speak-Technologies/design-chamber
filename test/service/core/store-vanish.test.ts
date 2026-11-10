// A design deleted outside the app while the store is working on it stays deleted (fix 7c20ced):
// the store may create `.chamber/` inside a live design folder, never the design folder itself.
// These cover the mutation path through writeState (the reconcile path is in store.test.ts).

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, test, type TestContext } from 'node:test';

import { createChangeHub } from '../../../src/service/changes.ts';
import type { Logger, SettingsStore } from '../../../src/service/context.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const exists = (target: string): Promise<boolean> => stat(target).then(() => true, () => false);

const makeStore = async (t: TestContext, onWarn: (event: string) => void = () => undefined) => {
  const tmp = await useTmpRoot(t);
  const root = tmp.root;
  const settings: SettingsStore = {
    root: () => root,
    defaultRoot: () => root,
    read: () => ({ version: 1, root }),
    async update() {
      throw new Error('not used');
    },
    onRootChange: () => () => undefined,
  };
  const log: Logger = { info: () => undefined, error: () => undefined, warn: (event) => onWarn(event) };
  return { tmp, store: createDesignStore({ settings, log, hub: createChangeHub(randomUUID()) }) };
};

describe('a design deleted mid-mutation (7c20ced)', () => {
  test('a patch whose design is deleted after it was read is a 404 and does not bring the folder back', async (t) => {
    let dir = '';
    const { tmp, store } = await makeStore(t, (event) => {
      // Fires inside readInternal, after the folder was found: the delete lands between read and write.
      if (event === 'store.state-unparseable') rmSync(dir, { recursive: true, force: true });
    });
    dir = path.join(tmp.root, 'racing');
    await tmp.write('racing/design.json', { version: 1, kind: 'canvas', title: 'Racing' });
    await tmp.write('racing/.chamber/state.json', 'not json at all');
    await assert.rejects(store.patch('racing', { title: 'Too late' }), (error: unknown) => error instanceof ApiError && error.code === 'not-found');
    assert.equal(await exists(dir), false, 'the folder came back');
  });

  test('a design whose .chamber/ was deleted (folder kept) gets its state.json back on the next mutation', async (t) => {
    const { store } = await makeStore(t);
    const created = await store.create({ kind: 'canvas', title: 'Kept' });
    await rm(path.join(created.path, '.chamber'), { recursive: true, force: true });
    await store.patch(created.slug, { title: 'Renamed' });
    const state = JSON.parse(await readFile(path.join(created.path, '.chamber', 'state.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(state.kind, 'canvas');
    const json = JSON.parse(await readFile(path.join(created.path, 'design.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(json.title, 'Renamed');
  });

  test('a design whose .chamber/ is a file reports the error instead of writing elsewhere', async (t) => {
    const { store } = await makeStore(t);
    const created = await store.create({ kind: 'canvas', title: 'Odd' });
    await rm(path.join(created.path, '.chamber'), { recursive: true, force: true });
    await writeFile(path.join(created.path, '.chamber'), 'a file, not a folder');
    await assert.rejects(store.patch(created.slug, { title: 'x' }), (error: unknown) => !(error instanceof ApiError && error.code === 'not-found'));
    assert.equal(await readFile(path.join(created.path, '.chamber'), 'utf8'), 'a file, not a folder');
  });
});
