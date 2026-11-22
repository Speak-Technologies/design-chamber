import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deleteConfirmCopy, deleteFacts, listDesignMenu, type DesignMenuView } from '../../src/ui/components/folder-actions.ts';
import type { MenuEntry } from '../../src/ui/components/kit.ts';
import type { FolderLite } from '../../src/ui/model/list-model.ts';

const folder = (id: string, name: string, slugs: string[]): FolderLite => ({ id, name, slugs });
const ids = (entries: readonly MenuEntry[]): string[] => entries.map((entry) => ('id' in entry ? entry.id : '-'));
const labelOf = (entries: readonly MenuEntry[], id: string): string | undefined => {
  const found = entries.find((entry) => 'id' in entry && entry.id === id);
  return found && 'label' in found ? found.label : undefined;
};

// ---------------------------------------------------------------- delete facts and confirm copy

test('deleteFacts counts the members and the ones in no other folder', () => {
  const folders = [folder('f_a', 'Q4 launch', ['pricing', 'checkout', 'hero']), folder('f_b', 'Archive', ['checkout']), folder('f_c', 'Empty', [])];
  assert.deepEqual(deleteFacts('f_a', folders), { count: 3, onlyHere: 2 }); // checkout keeps Archive
  assert.deepEqual(deleteFacts('f_b', folders), { count: 1, onlyHere: 0 });
  assert.deepEqual(deleteFacts('f_c', folders), { count: 0, onlyHere: 0 });
  assert.deepEqual(deleteFacts('f_gone', folders), { count: 0, onlyHere: 0 });
});

const textOf = (copy: ReturnType<typeof deleteConfirmCopy>): string => copy.parts.map((part) => part.text).join('');

test('the confirm for an empty folder says deleting changes nothing', () => {
  const copy = deleteConfirmCopy({ name: 'Scratch', count: 0, onlyHere: 0 });
  assert.equal(textOf(copy), 'Scratch is empty. Deleting it changes nothing.');
  assert.equal(copy.promise, null);
});

test('the confirm when every design keeps another folder says so, with the promise', () => {
  const copy = deleteConfirmCopy({ name: 'Q4 launch', count: 6, onlyHere: 0 });
  assert.equal(textOf(copy), 'Its 6 designs all keep their other folders.');
  assert.equal(copy.promise, 'Deleting a folder never deletes designs.');
  assert.equal(textOf(deleteConfirmCopy({ name: 'Q4 launch', count: 1, onlyHere: 0 })), 'Its 1 design keeps its other folders.');
});

test('the confirm names how many designs lose their last folder, and that they stay in All designs', () => {
  const copy = deleteConfirmCopy({ name: 'Q4 launch', count: 6, onlyHere: 2 });
  assert.equal(textOf(copy), '6 designs are in Q4 launch. 2 of them are in no other folder; they stay in All designs.');
  assert.equal(copy.promise, 'Deleting a folder never deletes designs.');
  assert.deepEqual(copy.parts.filter((part) => part.strong).map((part) => part.text), ['6 designs', '2 of them']);
  assert.equal(`${textOf(copy)} ${copy.promise}`, '6 designs are in Q4 launch. 2 of them are in no other folder; they stay in All designs. Deleting a folder never deletes designs.');
});

test('the singular forms read naturally', () => {
  const one = deleteConfirmCopy({ name: 'Ideas', count: 1, onlyHere: 1 });
  assert.equal(textOf(one), '1 design is in Ideas. 1 of them is in no other folder; it stays in All designs.');
  const oneOfMany = deleteConfirmCopy({ name: 'Ideas', count: 4, onlyHere: 1 });
  assert.equal(textOf(oneOfMany), '4 designs are in Ideas. 1 of them is in no other folder; it stays in All designs.');
});

// ---------------------------------------------------------------- the design menu

const FOLDER: DesignMenuView = { folder: { id: 'f_a', name: 'Q4 launch' }, project: null };
const MANUAL_PROJECT: DesignMenuView = { folder: null, project: { directory: 'C:\\work\\shop', label: 'shop', manual: true } };
const DERIVED_PROJECT: DesignMenuView = { folder: null, project: { directory: 'C:\\work\\shop', label: 'shop', manual: false } };

test('outside a folder or project the menu only adds Add to folder…, before Reveal', () => {
  const entries = listDesignMenu(null);
  assert.deepEqual(ids(entries), ['open', 'continue', 'add-to-folder', 'reveal', 'rename', '-', 'delete']);
  assert.equal(labelOf(entries, 'add-to-folder'), 'Add to folder…');
});

test('in a folder view the menu offers Move and Remove from that folder', () => {
  const entries = listDesignMenu(FOLDER);
  assert.deepEqual(ids(entries), ['open', 'continue', 'add-to-folder', 'move-design', 'remove-from-folder', 'reveal', 'rename', '-', 'delete']);
  assert.equal(labelOf(entries, 'move-design'), 'Move to folder…');
  assert.equal(labelOf(entries, 'remove-from-folder'), 'Remove from Q4 launch');
});

test('the older FolderRef argument still reads as a folder view (L1a passes the whole view next)', () => {
  assert.deepEqual(ids(listDesignMenu({ id: 'f_a', name: 'Q4 launch' })), ids(listDesignMenu(FOLDER)));
});

test('a manual project member can Move and Remove; a derived member can do neither', () => {
  const manual = listDesignMenu(MANUAL_PROJECT);
  assert.deepEqual(ids(manual), ['open', 'continue', 'add-to-folder', 'move-design', 'remove-from-project', 'reveal', 'rename', '-', 'delete']);
  assert.equal(labelOf(manual, 'remove-from-project'), 'Remove from shop');
  assert.deepEqual(ids(listDesignMenu(DERIVED_PROJECT)), ids(listDesignMenu(null)));
});
