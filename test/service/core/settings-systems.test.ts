// The design-system keys of the settings file (documentation/specs/phase-2-5-technical.md §2.9, AD-11):
// `systemDefault` and `systemPins` keep valid entries only, duplicates by directory keep the first,
// and an update through the store persists them (deleting a system clears them this way, §5.1).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import type { Logger } from '../../../src/service/context.ts';
import { createSettingsStore, normalizeSettings, normalizeSystemDefault, normalizeSystemPins } from '../../../src/service/settings.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { REPO_ROOT } from './harness.ts';

const silentLog = (): Logger => ({ info() {}, warn() {}, error() {} });

describe('systemDefault', () => {
  test('the three shapes; ask is not stored (absent = ask)', () => {
    assert.deepEqual(normalizeSystemDefault({ choice: 'none' }), { choice: 'none' });
    assert.deepEqual(normalizeSystemDefault({ choice: 'system', id: 'acme', name: 'Acme', extra: 1 }), { choice: 'system', id: 'acme', name: 'Acme' });
    assert.deepEqual(normalizeSettings({ systemDefault: { choice: 'ask' } }), { version: 1 });
  });

  test('a bad id, a bad name or an unknown choice is dropped', () => {
    for (const value of [{ choice: 'system', id: '../x', name: 'X' }, { choice: 'system', id: 'acme', name: '' }, { choice: 'system', id: 'acme', name: 'a\nb' }, { choice: 'maybe' }, 'none', null]) {
      assert.equal(normalizeSystemDefault(value), null, JSON.stringify(value));
    }
  });
});

describe('systemPins', () => {
  test('valid pins only; the first pin per directory wins', () => {
    const pins = normalizeSystemPins(
      [
        { directory: '/abs/shop', choice: 'system', id: 'acme', name: 'Acme' },
        { directory: '/abs/shop', choice: 'none' },
        { directory: 'relative/path', choice: 'none' },
        { directory: '/abs/bad\nname', choice: 'none' },
        { directory: '/abs/blog', choice: 'system', id: 'Not Valid', name: 'X' },
        { directory: '/abs/docs', choice: 'follow-default' },
        'junk',
      ],
      'linux',
    );
    assert.deepEqual(pins, [
      { directory: '/abs/shop', choice: 'system', id: 'acme', name: 'Acme' },
      { directory: '/abs/docs', choice: 'follow-default' },
    ]);
  });

  test('a legacy default pin is dropped, so the project reads as Use the project; the next write leaves it out', () => {
    const raw = [
      { directory: '/abs/shop', choice: 'default' },
      { directory: '/abs/blog', choice: 'follow-default', id: 'ignored', name: 'Ignored' },
      { directory: '/abs/docs', choice: 'project' },
    ];
    assert.deepEqual(normalizeSystemPins(raw, 'linux'), [{ directory: '/abs/blog', choice: 'follow-default' }]);
    assert.deepEqual(normalizeSettings({ systemPins: [{ directory: '/abs/shop', choice: 'default' }] }), { version: 1 });
  });

  test('on win32 directories compare ignoring case and slash direction', () => {
    const pins = normalizeSystemPins(
      [
        { directory: 'C:\\Work\\Shop', choice: 'none' },
        { directory: 'c:/work/shop', choice: 'follow-default' },
      ],
      'win32',
    );
    assert.equal(pins.length, 1);
  });

  test('at most 50 pins', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ directory: `/abs/p${i}`, choice: 'none' }));
    assert.equal(normalizeSystemPins(many, 'linux').length, 50);
  });
});

describe('the settings store keeps them', () => {
  test('update persists the default and the pins; clearing writes them away', async (t) => {
    const tmp = await useTmpRoot(t);
    const file = path.join(tmp.root, 'settings.json');
    const store = await createSettingsStore({ log: silentLog(), packageRoot: REPO_ROOT, env: { DC_SETTINGS_PATH: file }, homeDir: tmp.root });
    await store.update({ systemDefault: { choice: 'system', id: 'acme', name: 'Acme' }, systemPins: [{ directory: '/abs/shop', choice: 'none' }] });
    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(written.systemDefault, { choice: 'system', id: 'acme', name: 'Acme' });
    assert.deepEqual(written.systemPins, [{ directory: '/abs/shop', choice: 'none' }]);
    await store.update({ systemDefault: { choice: 'ask' }, systemPins: [] });
    const cleared = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(cleared.systemDefault, undefined);
    assert.equal(cleared.systemPins, undefined);
    assert.equal(store.read().systemDefault, undefined);
  });
});
