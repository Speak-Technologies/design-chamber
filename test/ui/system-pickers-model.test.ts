import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SystemChoiceView, SystemPinView, SystemSummary } from '../../src/shared/types.ts';
import { foldsCaseFor, systemFieldOf } from '../../src/ui/model/new-model.ts';
import {
  defaultFrom,
  defaultOptions,
  defaultSentence,
  defaultValue,
  pinOptions,
  pinValue,
  pinsAfter,
  projectRows,
} from '../../src/ui/model/settings-model.ts';
import { SYSTEM_UPDATED_LABEL, systemUpdated } from '../../src/ui/model/list-model.ts';

const sys = (id: string, name: string, status: 'ready' | 'draft', revision = 3): SystemSummary => ({ id, name, status, revision }) as SystemSummary;
const LIST = [sys('acme', 'Acme', 'ready'), sys('shop', 'Shop', 'ready', 5), sys('wip', 'Wip', 'draft')];
const ROOT = '/home/you/Designs';

test('the New dialog field offers Ready systems, No design system and Ask me in chat', () => {
  const view = systemFieldOf({ systems: LIST, settings: undefined, designsRoot: ROOT, projectDirectory: null }, null, false);
  assert.deepEqual(view.options.map((o) => o.id), ['acme', 'shop', 'none', 'ask']);
  assert.equal(view.value, 'ask');
  assert.equal(view.hint, null);
  assert.equal(view.showPreset, true);
  assert.equal(view.empty, false);
});

test('it preselects the project pin, then the default, and says why', () => {
  const settings = { default: { choice: 'system' as const, id: 'acme', name: 'Acme' }, pins: [{ directory: '/work/shop', choice: 'system' as const, id: 'shop', name: 'Shop' }] };
  const pinned = systemFieldOf({ systems: LIST, settings, designsRoot: ROOT, projectDirectory: '/work/shop' }, null, false);
  assert.equal(pinned.value, 'shop');
  assert.equal(pinned.hint, 'Pinned for shop');
  assert.equal(pinned.showPreset, false);
  const other = systemFieldOf({ systems: LIST, settings, designsRoot: ROOT, projectDirectory: '/work/blog' }, null, false);
  assert.equal(other.value, 'acme');
  assert.equal(other.hint, 'Your default');
});

test('picking in the select wins and drops the hint; a system hides the preset', () => {
  const settings = { default: { choice: 'system' as const, id: 'acme', name: 'Acme' }, pins: [] };
  const mine = systemFieldOf({ systems: LIST, settings, designsRoot: ROOT, projectDirectory: null }, 'none', false);
  assert.equal(mine.value, 'none');
  assert.equal(mine.hint, null);
  assert.equal(mine.showPreset, true);
  assert.equal(mine.send, 'none');
});

test('with no Ready system the field gives way to a line', () => {
  const view = systemFieldOf({ systems: [sys('wip', 'Wip', 'draft')], settings: undefined, designsRoot: ROOT, projectDirectory: null }, null, false);
  assert.equal(view.empty, true);
  assert.equal(view.send, undefined);
  assert.equal(view.showPreset, true);
});

test('Windows-looking roots fold case', () => {
  assert.equal(foldsCaseFor('C:\\Users\\you\\Designs', 'linux'), true);
  assert.equal(foldsCaseFor('/home/you/Designs', 'Linux x86_64'), false);
  assert.equal(foldsCaseFor('/Users/you/Designs', 'MacIntel'), true);
});

test('settings selects list Ready systems only', () => {
  assert.deepEqual(defaultOptions(LIST).map((o) => o.label), ['Ask me each time', 'No design system', 'Acme', 'Shop']);
  assert.deepEqual(pinOptions(LIST).map((o) => o.label), ['Use the default', 'No design system', 'Acme', 'Shop']);
});

test('the default round-trips and an unresolved one shows as Ask me each time', () => {
  const ok: SystemChoiceView = { choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null };
  assert.equal(defaultValue(ok), 'system:acme');
  assert.deepEqual(defaultFrom('system:acme', LIST), { choice: 'system', id: 'acme', name: 'Acme' });
  assert.deepEqual(defaultFrom('none', LIST), { choice: 'none' });
  assert.deepEqual(defaultFrom('system:wip', LIST), { choice: 'ask' });
  const gone: SystemChoiceView = { choice: 'system', id: 'old', name: 'Old', state: 'missing', sentence: 'Your default design system isn’t in this Designs folder.' };
  assert.equal(defaultValue(gone), 'ask');
  assert.equal(defaultSentence(gone), 'Your default design system isn’t in this Designs folder.');
  assert.equal(defaultSentence(ok), null);
});

test('a pin that does not resolve acts as unset and keeps its sentence', () => {
  const draft: SystemPinView = { directory: '/work/shop', choice: 'system', id: 'wip', name: 'Wip', state: 'draft', sentence: 'Wip is a draft.' };
  assert.equal(pinValue(draft), 'default');
  assert.equal(pinValue(null), 'default');
  assert.equal(pinValue({ directory: '/x', choice: 'none', state: 'ok', sentence: null }), 'none');
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [draft]);
  assert.equal(rows[0]?.sentence, 'Wip is a draft.');
  assert.equal(rows[0]?.value, 'default');
});

test('a pin whose project is not open still gets a row', () => {
  const pin: SystemPinView = { directory: '/work/old-site', choice: 'none', state: 'ok', sentence: null };
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [pin]);
  assert.deepEqual(rows.map((r) => r.name), ['shop', 'old-site']);
});

test('changing one project sends the whole list and leaves the others alone', () => {
  const other: SystemPinView = { directory: '/work/blog', choice: 'none', state: 'ok', sentence: null };
  const mine: SystemPinView = { directory: '/work/shop', choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null };
  assert.deepEqual(pinsAfter([other, mine], '/work/shop', 'system:shop', LIST), [{ directory: '/work/blog', choice: 'none' }, { directory: '/work/shop', choice: 'system', id: 'shop', name: 'Shop' }]);
  assert.deepEqual(pinsAfter([other, mine], '/work/shop', 'default', LIST), [{ directory: '/work/blog', choice: 'none' }]);
  assert.deepEqual(pinsAfter([other], '/work/shop', 'none', LIST), [{ directory: '/work/blog', choice: 'none' }, { directory: '/work/shop', choice: 'none' }]);
});

test('the list badge follows updateAvailable', () => {
  assert.equal(SYSTEM_UPDATED_LABEL, 'System updated');
  assert.equal(systemUpdated({ system: { id: 'a', name: 'A', revision: 2, state: 'ok', updateAvailable: true } }), true);
  assert.equal(systemUpdated({ system: { id: 'a', name: 'A', revision: 2, state: 'ok', updateAvailable: false } }), false);
  assert.equal(systemUpdated({}), false);
  assert.equal(systemUpdated({ system: null }), false);
});
