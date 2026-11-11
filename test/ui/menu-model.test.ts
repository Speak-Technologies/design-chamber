import assert from 'node:assert/strict';
import { test } from 'node:test';

import { menuRowState, type MenuRowIds } from '../../src/ui/model/menu-model.ts';

const ids: MenuRowIds = { reason: 'menu-1-up-reason', foot: 'menu-1-foot' };

test('an entry without disabled is a plain, reachable, live row (every existing menu is unchanged)', () => {
  assert.deepEqual(menuRowState({}, ids), { navDisabled: false, inert: false, nativeDisabled: false, showsReason: false, describedBy: null });
  assert.deepEqual(menuRowState({ disabled: false }, ids), { navDisabled: false, inert: false, nativeDisabled: false, showsReason: false, describedBy: null });
});

test('a disabled row with a reason stays reachable by the arrow keys, does nothing on Enter, Space or click, and names its reason', () => {
  const state = menuRowState({ disabled: true, reason: 'This is the first screen.' }, ids);
  assert.equal(state.navDisabled, false);
  assert.equal(state.inert, true);
  assert.equal(state.nativeDisabled, false);
  assert.equal(state.showsReason, true);
  assert.equal(state.describedBy, ids.reason);
});

test('a disabled row without a reason is the native disabled row the arrow keys skip', () => {
  const state = menuRowState({ disabled: true }, ids);
  assert.equal(state.navDisabled, true);
  assert.equal(state.inert, true);
  assert.equal(state.nativeDisabled, true);
  assert.equal(state.showsReason, false);
  assert.equal(state.describedBy, null);
});

test('a cap row (disabled, no reason of its own) points at the foot note, once the menu has one', () => {
  assert.equal(menuRowState({ disabled: true, explainedBy: 'foot' }, ids).describedBy, ids.foot);
  assert.equal(menuRowState({ disabled: true, explainedBy: 'foot' }, { reason: 'r', foot: null }).describedBy, null);
});

test('a reason on an enabled row is ignored: only a disabled row explains itself', () => {
  const state = menuRowState({ reason: 'Not shown.' }, ids);
  assert.equal(state.showsReason, false);
  assert.equal(state.inert, false);
  assert.equal(state.describedBy, null);
});

test('an empty reason counts as none, so the row is skipped like any disabled row', () => {
  const state = menuRowState({ disabled: true, reason: '' }, ids);
  assert.equal(state.navDisabled, true);
  assert.equal(state.showsReason, false);
});

test('a row with its own reason ignores the foot pointer (the reason is the nearer explanation)', () => {
  assert.equal(menuRowState({ disabled: true, reason: 'Why.', explainedBy: 'foot' }, ids).describedBy, ids.reason);
});
