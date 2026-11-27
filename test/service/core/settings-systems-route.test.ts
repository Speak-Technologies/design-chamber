// GET/PUT /settings and the design-system keys (documentation/specs/phase-2-5-technical.md §2.9, §3.4):
// the route accepts and validates `systemDefault` and `systemPins`, answers the `systems` view the Settings
// section reads, saves to the settings file, and tells the pin sync and the chat routes at once.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test, type TestContext } from 'node:test';

import type { ApiErrorBody, SettingsResponse } from '../../../src/shared/api.ts';
import { SYSTEM_PINS_MAX } from '../../../src/shared/limits.ts';
import type { SystemPinSetting } from '../../../src/shared/types.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { TEST_TOKEN, useServedCore, type ServedCore } from './harness.ts';

const settingsFileOf = async (core: ServedCore): Promise<Record<string, unknown>> => JSON.parse(await readFile(core.tmp.at('settings.json'), 'utf8')) as Record<string, unknown>;

const put = async (core: ServedCore, body: unknown, token: string | null = TEST_TOKEN) => {
  const answer = await core.request('/settings', { method: 'PUT', body, token });
  return { status: answer.status, json: (await answer.json()) as SettingsResponse & ApiErrorBody };
};

const get = async (core: ServedCore): Promise<SettingsResponse> => (await (await core.request('/settings')).json()) as SettingsResponse;

/** A served core with a Ready system "Acme" and a draft system "Wip" in its root. */
const serve = async (t: TestContext) => {
  const core = await useServedCore(t);
  // The core harness has no design index; the system store only asks it which designs use a system.
  Object.assign(core.ctx, { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } });
  const systems = ensureSystemStore(core.ctx);
  const acme = await systems.create({ name: 'Acme' });
  await systems.patch(acme.id, { status: 'ready' });
  const wip = await systems.create({ name: 'Wip' });
  return { core, systems, acme: acme.id, wip: wip.id };
};

const pin = (directory: string, choice: SystemPinSetting['choice'] = 'none', extra: Partial<SystemPinSetting> = {}): SystemPinSetting => ({ directory, choice, ...extra });

describe('GET /settings answers the systems part', () => {
  test('a fresh settings file: ask, no pins, no notices', async (t) => {
    const { core } = await serve(t);
    assert.deepEqual((await get(core)).systems, { default: { choice: 'ask', state: 'ok', sentence: null }, pins: [], notices: [] });
  });
});

describe('PUT /settings with systemDefault', () => {
  test('a Ready system is saved, shown ok with the current name, and the file keeps it', async (t) => {
    const { core, acme } = await serve(t);
    const answer = await put(core, { systemDefault: { choice: 'system', id: acme, name: 'Old name' } });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.json.systems.default, { choice: 'system', id: acme, name: 'Acme', state: 'ok', sentence: null });
    assert.deepEqual((await settingsFileOf(core)).systemDefault, { choice: 'system', id: acme, name: 'Old name' });
    assert.deepEqual((await get(core)).systems.default, answer.json.systems.default);
  });

  test('none is saved; a draft shows its sentence; a system that is not in this folder shows missing', async (t) => {
    const { core, wip } = await serve(t);
    assert.deepEqual((await put(core, { systemDefault: { choice: 'none' } })).json.systems.default, { choice: 'none', state: 'ok', sentence: null });
    const draft = (await put(core, { systemDefault: { choice: 'system', id: wip, name: 'Wip' } })).json.systems.default;
    assert.equal(draft.choice === 'system' && draft.state, 'draft');
    assert.equal(draft.sentence, 'Wip is a draft. New designs ask you in chat until it is Ready.');
    const gone = (await put(core, { systemDefault: { choice: 'system', id: 'gone', name: 'Gone' } })).json.systems.default;
    assert.equal(gone.state, 'missing');
    assert.equal(gone.sentence, 'Your default design system isn’t in this Designs folder.');
  });

  test('ask and null both reset it, and neither leaves a key in the file', async (t) => {
    const { core, acme } = await serve(t);
    for (const reset of [{ choice: 'ask' }, null]) {
      await put(core, { systemDefault: { choice: 'system', id: acme, name: 'Acme' } });
      assert.ok('systemDefault' in (await settingsFileOf(core)));
      const answer = await put(core, { systemDefault: reset });
      assert.equal(answer.status, 200);
      assert.deepEqual(answer.json.systems.default, { choice: 'ask', state: 'ok', sentence: null });
      assert.equal('systemDefault' in (await settingsFileOf(core)), false, JSON.stringify(reset));
    }
  });

  test('bad shapes answer 400 with a sentence and change nothing', async (t) => {
    const { core, acme } = await serve(t);
    await put(core, { systemDefault: { choice: 'system', id: acme, name: 'Acme' } });
    const before = await settingsFileOf(core);
    const bad: unknown[] = ['ask', 7, [], {}, { choice: 'maybe' }, { choice: 'system' }, { choice: 'system', id: '../x', name: 'X' }, { choice: 'system', id: 'acme', name: '' }, { choice: 'system', id: 'acme', name: 'a\nb' }, { choice: 'system', id: 'acme', name: 'x'.repeat(61) }];
    for (const value of bad) {
      const answer = await put(core, { systemDefault: value });
      assert.equal(answer.status, 400, JSON.stringify(value));
      assert.equal(answer.json.error, 'bad-request');
      assert.match(answer.json.message, /default design system must be/);
    }
    assert.deepEqual(await settingsFileOf(core), before);
  });
});

describe('PUT /settings with systemPins', () => {
  test('the whole list is saved, in order, and each pin is resolved', async (t) => {
    const { core, acme, wip } = await serve(t);
    const pins = [pin('/work/shop', 'system', { id: acme, name: 'Acme' }), pin('/work/blog', 'none'), pin('/work/docs', 'follow-default'), pin('/work/wip', 'system', { id: wip, name: 'Wip' }), pin('/work/old', 'system', { id: 'gone', name: 'Gone' })];
    const answer = await put(core, { systemPins: pins });
    assert.equal(answer.status, 200);
    assert.deepEqual(
      answer.json.systems.pins.map((one) => [one.directory, one.choice, one.state, one.sentence]),
      [
        ['/work/shop', 'system', 'ok', null],
        ['/work/blog', 'none', 'ok', null],
        ['/work/docs', 'follow-default', 'ok', null],
        ['/work/wip', 'system', 'draft', 'Wip is a draft. Until it is Ready, this project uses the project’s own design files, or your default.'],
        ['/work/old', 'system', 'missing', 'Gone isn’t in this Designs folder. This project uses the project’s own design files, or your default.'],
      ],
    );
    assert.deepEqual((await settingsFileOf(core)).systemPins, pins);
    assert.deepEqual((await get(core)).systems.pins, answer.json.systems.pins);
  });

  test('a pin to a system that is gone is kept (Settings sends the old pins back with every change)', async (t) => {
    const { core } = await serve(t);
    const pins = [pin('/work/old', 'system', { id: 'gone', name: 'Gone' })];
    assert.equal((await put(core, { systemPins: pins })).status, 200);
    assert.deepEqual((await settingsFileOf(core)).systemPins, pins);
  });

  test('[] and null both clear the pins and leave no key in the file', async (t) => {
    const { core } = await serve(t);
    for (const clear of [[], null]) {
      await put(core, { systemPins: [pin('/work/shop')] });
      assert.ok('systemPins' in (await settingsFileOf(core)));
      const answer = await put(core, { systemPins: clear });
      assert.equal(answer.status, 200);
      assert.deepEqual(answer.json.systems.pins, []);
      assert.equal('systemPins' in (await settingsFileOf(core)), false, JSON.stringify(clear));
    }
  });

  test('exactly SYSTEM_PINS_MAX pins are fine; one more is refused', async (t) => {
    const { core } = await serve(t);
    const many = (count: number): SystemPinSetting[] => Array.from({ length: count }, (_unused, index) => pin(`/work/p${index}`));
    assert.equal((await put(core, { systemPins: many(SYSTEM_PINS_MAX) })).status, 200);
    const before = await settingsFileOf(core);
    const answer = await put(core, { systemPins: many(SYSTEM_PINS_MAX + 1) });
    assert.equal(answer.status, 400);
    assert.match(answer.json.message, new RegExp(`at most ${SYSTEM_PINS_MAX}`));
    assert.deepEqual(await settingsFileOf(core), before);
  });

  test('bad pins answer 400 with a sentence and change nothing', async (t) => {
    const { core } = await serve(t);
    await put(core, { systemPins: [pin('/work/keep')] });
    const before = await settingsFileOf(core);
    const bad: unknown[] = [
      'shop',
      { directory: '/work/shop', choice: 'none' },
      ['junk'],
      [{ directory: 'relative/dir', choice: 'none' }],
      [{ directory: '/work/bad\nname', choice: 'none' }],
      [{ directory: '/work/shop', choice: 'maybe' }],
      [{ directory: '/work/shop', choice: 'system' }],
      [{ directory: '/work/shop', choice: 'system', id: 'Not Valid', name: 'X' }],
      [pin('/work/shop'), pin('/work/shop', 'follow-default')],
      [pin('/work/ok'), { directory: 7, choice: 'none' }],
    ];
    for (const value of bad) {
      const answer = await put(core, { systemPins: value });
      assert.equal(answer.status, 400, JSON.stringify(value));
      assert.equal(answer.json.error, 'bad-request');
      assert.match(answer.json.message, /project pins?/);
    }
    assert.deepEqual(await settingsFileOf(core), before);
  });
});

describe('PUT /settings and Use the project (use-the-project spec §1.4, §1.5)', () => {
  test('a legacy default pin is refused with the four choices, and nothing is saved', async (t) => {
    const { core } = await serve(t);
    await put(core, { systemPins: [pin('/work/keep', 'follow-default')] });
    const before = await settingsFileOf(core);
    for (const value of [[{ directory: '/work/shop', choice: 'default' }], [pin('/work/ok'), { directory: '/work/shop', choice: 'default' }]]) {
      const answer = await put(core, { systemPins: value });
      assert.equal(answer.status, 400, JSON.stringify(value));
      assert.equal(answer.json.error, 'bad-request');
      assert.equal(answer.json.message, 'Pick Use the project, Use my default, No design system or a design system.');
    }
    assert.deepEqual(await settingsFileOf(core), before);
  });

  test('follow-default is stored and answered as it was sent', async (t) => {
    const { core } = await serve(t);
    const answer = await put(core, { systemPins: [pin('/work/shop', 'follow-default')] });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.json.systems.pins, [{ directory: '/work/shop', choice: 'follow-default', state: 'ok', sentence: null }]);
    assert.deepEqual((await settingsFileOf(core)).systemPins, [{ directory: '/work/shop', choice: 'follow-default' }]);
  });
});

describe('PUT /settings as a whole', () => {
  test('both system fields in one body; a bad one refuses the lot', async (t) => {
    const { core, acme } = await serve(t);
    const ok = await put(core, { systemDefault: { choice: 'system', id: acme, name: 'Acme' }, systemPins: [pin('/work/shop')] });
    assert.equal(ok.status, 200);
    const before = await settingsFileOf(core);
    const refused = await put(core, { systemDefault: { choice: 'none' }, systemPins: [{ directory: 'relative', choice: 'none' }] });
    assert.equal(refused.status, 400);
    assert.deepEqual(await settingsFileOf(core), before, 'the valid default is not saved when the pins are refused');
  });

  test('an empty body names every field it could have changed', async (t) => {
    const { core } = await serve(t);
    for (const body of [{}, { colour: 'red' }]) {
      const answer = await put(core, body);
      assert.equal(answer.status, 400);
      assert.equal(answer.json.message, 'Say what to change: "root", "chromePath", "systemDefault" and/or "systemPins".');
    }
  });

  test('without the token, or with a wrong one, nothing is saved', async (t) => {
    const { core } = await serve(t);
    const before = await settingsFileOf(core);
    for (const token of [null, 'wrong-token']) {
      const answer = await put(core, { systemDefault: { choice: 'none' }, systemPins: [pin('/work/shop')] }, token);
      assert.equal(answer.status, 401, String(token));
    }
    assert.deepEqual(await settingsFileOf(core), before);
  });

  test('a pin folder that tries to look like a traversal is only text: it is never opened', async (t) => {
    const { core } = await serve(t);
    // A pin is a folder name the host reports, stored and compared as text; the service never reads or writes it.
    const answer = await put(core, { systemPins: [pin('/work/../../etc', 'none')] });
    assert.equal(answer.status, 200);
    assert.equal(await core.tmp.read('etc').catch(() => null), null);
  });
});

describe('saving is live, without a restart', () => {
  test('the store the other routes read changes at once, and listeners hear it', async (t) => {
    const { core, acme } = await serve(t);
    const heard: string[] = [];
    const settings = core.ctx.settings as typeof core.ctx.settings & { onChange: (listener: () => void) => () => void };
    const off = settings.onChange(() => heard.push(JSON.stringify(core.ctx.settings.read().systemDefault ?? null)));
    t.after(off);
    await put(core, { systemDefault: { choice: 'system', id: acme, name: 'Acme' }, systemPins: [pin('/work/shop', 'system', { id: acme, name: 'Acme' })] });
    // What instructions.ts (pin sync), agent-system.ts (recommended system) and the chip route read.
    assert.deepEqual(core.ctx.settings.read().systemDefault, { choice: 'system', id: acme, name: 'Acme' });
    assert.equal(core.ctx.settings.read().systemPins?.length, 1);
    assert.deepEqual(heard, [JSON.stringify({ choice: 'system', id: acme, name: 'Acme' })]);
    await put(core, { systemDefault: null });
    assert.equal(core.ctx.settings.read().systemDefault, undefined);
    assert.equal(heard.length, 2);
  });
});

describe('switching the designs folder (spec: Changed designs folder)', () => {
  test('a default and a pin naming a system from the old folder say so, are kept, and work again on switch-back', async (t) => {
    const { core, acme } = await serve(t);
    const first = { choice: 'system', id: acme, name: 'Acme' };
    await put(core, { systemDefault: first, systemPins: [pin('/work/shop', 'system', { id: acme, name: 'Acme' })] });
    const other = core.tmp.at('other-designs');

    const away = await put(core, { root: other });
    assert.equal(away.status, 200);
    assert.deepEqual(away.json.systems.default, { ...first, state: 'missing', sentence: 'Your default design system isn’t in this Designs folder.' });
    assert.deepEqual(
      away.json.systems.pins.map((one) => [one.state, one.sentence]),
      [['missing', 'Acme isn’t in this Designs folder. This project uses the project’s own design files, or your default.']],
    );
    assert.deepEqual(away.json.systems.notices, [], 'nothing was deleted, so there is no deleted notice');
    const file = await settingsFileOf(core);
    assert.deepEqual(file.systemDefault, first, 'the default stays in the file');
    assert.equal((file.systemPins as unknown[]).length, 1);

    const back = await put(core, { root: core.root });
    assert.deepEqual(back.json.systems.default, { ...first, state: 'ok', sentence: null });
    assert.equal(back.json.systems.pins[0]?.state, 'ok');
  });
});

describe('notices are answered once', () => {
  test('deleting the default system clears it and the next GET says so, then the notice is gone', async (t) => {
    const { core, systems, acme } = await serve(t);
    await put(core, { systemDefault: { choice: 'system', id: acme, name: 'Acme' }, systemPins: [pin('/work/shop', 'system', { id: acme, name: 'Acme' })] });
    await systems.trash(acme);
    const first = await get(core);
    assert.deepEqual(first.systems.default, { choice: 'ask', state: 'ok', sentence: null });
    assert.deepEqual(first.systems.pins, []);
    assert.deepEqual(first.systems.notices, ['Acme was deleted, so it is no longer your default.', 'Acme was deleted, so it is no longer pinned for shop.']);
    assert.deepEqual((await get(core)).systems.notices, []);
  });
});
