// settingsSystemsView (documentation/specs/phase-2-5-technical.md §3.4): the default and each pin against the
// systems of this root. The route test covers the wiring; this pins every state and its sentence.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settingsSystemsView, type SettingsViewSystem } from '../../src/shared/systems.ts';

const systems: SettingsViewSystem[] = [
  { id: 'acme', name: 'Acme', status: 'ready', unreadable: null },
  { id: 'wip', name: 'Wip', status: 'draft', unreadable: null },
  { id: 'broken', name: 'Broken', status: 'ready', unreadable: 'The folder cannot be read.' },
];

test('nothing saved reads as ask with no pins', () => {
  assert.deepEqual(settingsSystemsView({ settings: {}, systems, notices: [] }), { default: { choice: 'ask', state: 'ok', sentence: null }, pins: [], notices: [] });
});

test('a default is ok, draft or missing (not in this folder, or unreadable), and the saved name is replaced by the current one', () => {
  const view = (id: string) => settingsSystemsView({ settings: { systemDefault: { choice: 'system', id, name: 'Saved name' } }, systems, notices: [] }).default;
  assert.deepEqual(view('acme'), { choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null });
  assert.deepEqual(view('wip'), { choice: 'system', id: 'wip', name: 'Wip', state: 'draft', sentence: 'Wip is a draft. New designs ask you in chat until it is Ready.' });
  assert.deepEqual(view('broken'), { choice: 'system', id: 'broken', name: 'Broken', state: 'missing', sentence: 'Broken can’t be read right now. New designs ask you in chat.' });
  assert.deepEqual(view('gone'), { choice: 'system', id: 'gone', name: 'Saved name', state: 'missing', sentence: 'Your default design system isn’t in this Designs folder.' });
});

test('pins: none and default are always ok; a system pin follows the same three states', () => {
  const view = settingsSystemsView({
    settings: {
      systemPins: [
        { directory: '/a', choice: 'none' },
        { directory: '/b', choice: 'default' },
        { directory: '/c', choice: 'system', id: 'wip', name: 'Wip' },
        { directory: '/d', choice: 'system', id: 'broken', name: 'Broken' },
        { directory: '/e', choice: 'system', id: 'gone' },
      ],
    },
    systems,
    notices: ['One notice.'],
  });
  assert.deepEqual(
    view.pins.map((pin) => [pin.directory, pin.state, pin.sentence]),
    [
      ['/a', 'ok', null],
      ['/b', 'ok', null],
      ['/c', 'draft', 'Wip is a draft. This project uses the default until it is Ready.'],
      ['/d', 'missing', 'Broken can’t be read right now. This project uses the default.'],
      ['/e', 'missing', 'gone isn’t in this Designs folder. This project uses the default.'],
    ],
  );
  assert.deepEqual(view.notices, ['One notice.']);
});
