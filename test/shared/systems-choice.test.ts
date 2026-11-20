// effectiveSystemChoice (documentation/specs/phase-2-5-technical.md §2.9, RS S5-1): explicit → a pin for
// the project (never the designs root or a folder inside it) → the default → none-silent when the
// answer is ask but no Ready system exists in this root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { effectiveSystemChoice, type EffectiveChoiceInput } from '../../src/shared/systems.ts';

const base = (over: Partial<EffectiveChoiceInput> = {}): EffectiveChoiceInput => ({
  explicit: null,
  projectDirectory: '/work/shop',
  designsRoot: '/home/me/Documents/Designs',
  settings: {},
  systems: [
    { id: 'acme', status: 'ready' },
    { id: 'shop', status: 'ready' },
    { id: 'wip', status: 'draft' },
  ],
  foldsCase: false,
  ...over,
});

test('nothing set: ask while a Ready system exists, none-silent when none does', () => {
  assert.deepEqual(effectiveSystemChoice(base()), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ systems: [{ id: 'wip', status: 'draft' }] })), { choice: 'none-silent' });
  assert.deepEqual(effectiveSystemChoice(base({ systems: [] })), { choice: 'none-silent' });
});

test('an explicit choice wins over a pin and the default', () => {
  const settings = { systemDefault: { choice: 'system' as const, id: 'acme', name: 'Acme' }, systemPins: [{ directory: '/work/shop', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'shop', settings })), { choice: 'system', id: 'shop', why: 'explicit' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'none', settings })), { choice: 'none', why: 'explicit' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'ask', settings })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'ask', systems: [] })), { choice: 'none-silent' });
});

test('an explicit Draft or unknown id falls through to the pin and the default', () => {
  const settings = { systemDefault: { choice: 'system' as const, id: 'acme', name: 'Acme' } };
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'wip', settings })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'gone', settings })), { choice: 'system', id: 'acme', why: 'default' });
});

test('a pin for the project decides: none, a Ready system, or the default', () => {
  const pin = (choice: 'none' | 'system' | 'default', id?: string) => ({ systemPins: [{ directory: '/work/shop', choice, ...(id ? { id, name: id } : {}) }], systemDefault: { choice: 'system' as const, id: 'acme', name: 'Acme' } });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('none') })), { choice: 'none', why: 'pinned' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('system', 'shop') })), { choice: 'system', id: 'shop', why: 'pinned' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('default') })), { choice: 'system', id: 'acme', why: 'default' });
  // A pin to a Draft or a deleted system acts as unset.
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('system', 'wip') })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('system', 'gone') })), { choice: 'system', id: 'acme', why: 'default' });
});

test('pins compare folders as the OS does: slashes, trailing separator, case on folding disks', () => {
  const settings = { systemPins: [{ directory: 'C:\\Work\\Shop\\', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings, projectDirectory: 'c:/work/shop' })), { choice: 'none', why: 'pinned' });
  const posix = { systemPins: [{ directory: '/work/Shop', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings: posix, projectDirectory: '/work/shop' })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: posix, projectDirectory: '/work/shop', foldsCase: true })), { choice: 'none', why: 'pinned' });
});

test('the designs root, or a folder inside it, is never a pinned project', () => {
  const settings = { systemPins: [{ directory: '/home/me/Documents/Designs', choice: 'none' as const }, { directory: '/home/me/Documents/Designs/sub', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings, projectDirectory: '/home/me/Documents/Designs' })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ settings, projectDirectory: '/home/me/Documents/Designs/sub' })), { choice: 'ask' });
  // A sibling whose name only starts like the root is not inside it.
  const sibling = { systemPins: [{ directory: '/home/me/Documents/Designs-old', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings: sibling, projectDirectory: '/home/me/Documents/Designs-old' })), { choice: 'none', why: 'pinned' });
});

test('the default: none, a Ready system, or ask when its system is a Draft or gone', () => {
  assert.deepEqual(effectiveSystemChoice(base({ settings: { systemDefault: { choice: 'none' } } })), { choice: 'none', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: { systemDefault: { choice: 'system', id: 'shop', name: 'Shop' } } })), { choice: 'system', id: 'shop', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: { systemDefault: { choice: 'system', id: 'wip', name: 'WIP' } } })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ projectDirectory: null, settings: { systemDefault: { choice: 'system', id: 'gone', name: 'Gone' } } })), { choice: 'ask' });
});
