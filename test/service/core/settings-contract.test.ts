// The guard against drift between the visual harness's fake backend and the real service: the Settings sheet
// is built and looked at against `test/ui/visual/fake-backend.ts`, so when the fake answers something the
// service does not, the sheet works in the harness and is broken for the user (the design-system default
// and pins once were). Here both answer the same requests and must answer the same thing.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SettingsResponse } from '../../../src/shared/api.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeBackend } from '../../ui/visual/fake-backend.ts';
import { TEST_TOKEN, useServedCore } from './harness.ts';

/** Every key a value has, recursively, so the shape (not the data) is compared. Arrays are data here: the `systems` part is compared whole. */
const shapeOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shapeOf(inner)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return value === null ? 'null' : typeof value;
};

test('the fake backend and the real service answer the settings the same way, step by step', async (t) => {
  const fake = createFakeBackend();
  const core = await useServedCore(t);
  Object.assign(core.ctx, { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } });

  // The real root holds the systems the fake's book holds, with the same names and status.
  const book = (await fake.call('GET /systems', {})).systems;
  const store = ensureSystemStore(core.ctx);
  for (const row of book) {
    const made = await store.create({ name: row.name });
    assert.equal(made.id, row.id, `the real store names "${row.name}" ${made.id}, the fake ${row.id}: change the fake's ids`);
    if (row.status === 'ready') await store.patch(made.id, { status: 'ready' });
  }
  const tidepool = book.find((row) => row.status === 'ready');
  const draft = book.find((row) => row.status === 'draft');
  assert.ok(tidepool && draft, 'the fake book needs a Ready and a draft system for this test');

  const realGet = async (): Promise<SettingsResponse> => (await (await core.request('/settings')).json()) as SettingsResponse;
  const realPut = async (body: unknown): Promise<SettingsResponse> => {
    const answer = await core.request('/settings', { method: 'PUT', body, token: TEST_TOKEN });
    assert.equal(answer.status, 200, JSON.stringify(body));
    return (await answer.json()) as SettingsResponse;
  };

  const same = (step: string, real: SettingsResponse, fakeAnswer: SettingsResponse): void => {
    assert.deepEqual(real.systems, fakeAnswer.systems, `${step}: the systems part differs`);
    assert.deepEqual(shapeOf(real), shapeOf(fakeAnswer), `${step}: the settings answer has different keys`);
  };

  same('GET', await realGet(), await fake.call('GET /settings', {}));

  const steps: Array<[string, { systemDefault?: unknown; systemPins?: unknown }]> = [
    ['a Ready default', { systemDefault: { choice: 'system', id: tidepool.id, name: tidepool.name } }],
    ['a draft default', { systemDefault: { choice: 'system', id: draft.id, name: draft.name } }],
    ['a default that is gone', { systemDefault: { choice: 'system', id: 'gone', name: 'Gone' } }],
    ['no design system by default', { systemDefault: { choice: 'none' } }],
    [
      'pins of every kind',
      {
        systemPins: [
          { directory: '/work/shop', choice: 'system', id: tidepool.id, name: tidepool.name },
          { directory: '/work/blog', choice: 'none' },
          { directory: '/work/docs', choice: 'follow-default' },
          { directory: '/work/wip', choice: 'system', id: draft.id, name: draft.name },
          { directory: '/work/old', choice: 'system', id: 'gone', name: 'Gone' },
        ],
      },
    ],
    ['both reset with null', { systemDefault: null, systemPins: null }],
  ];
  for (const [step, body] of steps) {
    const real = await realPut(body);
    const fakeAnswer = await fake.call('PUT /settings', { body: body as Parameters<typeof fake.call<'PUT /settings'>>[1]['body'] });
    same(step, real, fakeAnswer);
    same(`GET after ${step}`, await realGet(), await fake.call('GET /settings', {}));
  }
});
