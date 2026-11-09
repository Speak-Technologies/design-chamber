import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MenuEntry } from '../../src/ui/components/kit.ts';
import { viewerMenuEntries, type ViewerMenuInput } from '../../src/ui/model/viewer-menu.ts';

type Action = Extract<MenuEntry, { id: string }>;
const find = (entries: readonly MenuEntry[], id: string): Action | undefined => entries.find((entry): entry is Action => 'id' in entry && entry.id === id);
const entriesOf = (input: Partial<ViewerMenuInput>): MenuEntry[] => viewerMenuEntries({ compact: false, isPage: false, openComments: 0, copyHtmlTooLarge: false, ...input });

const shape = (input: Partial<ViewerMenuInput>): string[] =>
  viewerMenuEntries({ compact: false, isPage: false, openComments: 0, copyHtmlTooLarge: false, ...input }).map((entry) => ('id' in entry ? entry.id : '-'));

test('the full-screen canvas menu: export, then the design-level entries', () => {
  assert.deepEqual(shape({}), ['zip', 'html', '-', 'reveal', 'path', 'rename', '-', 'delete']);
});

test('the full-screen page menu has only the design-level entries (export and copy are toolbar buttons)', () => {
  assert.deepEqual(shape({ isPage: true }), ['reveal', 'path', 'rename', '-', 'delete']);
});

test('the rail canvas menu carries continue, export, copy path, versions and comments', () => {
  assert.deepEqual(shape({ compact: true }), ['chat', '-', 'zip', 'html', 'path', 'reveal', '-', 'versions', 'comments', 'rename', '-', 'delete']);
});

test('the rail page menu adds Copy HTML and says what its export does', () => {
  assert.deepEqual(shape({ compact: true, isPage: true }), ['chat', '-', 'zip', 'html', 'copy-html', 'path', 'reveal', '-', 'versions', 'comments', 'rename', '-', 'delete']);
  assert.equal(find(entriesOf({ compact: true, isPage: true }), 'html')?.label, 'Export single-file HTML');
  assert.equal(find(entriesOf({ compact: true }), 'html')?.label, 'Export screen as HTML…');
});

test('Copy HTML is disabled with a reason only when the page is over the clipboard cap', () => {
  const copy = (copyHtmlTooLarge: boolean) => find(entriesOf({ compact: true, isPage: true, copyHtmlTooLarge }), 'copy-html');
  assert.deepEqual(copy(true), { id: 'copy-html', label: 'Copy HTML', disabled: true, hint: 'too large' });
  assert.equal(copy(false)?.disabled, false);
  assert.equal(copy(false)?.hint, undefined);
});

test('the Comments entry shows the open count; Delete is the only destructive entry, last', () => {
  const entries = entriesOf({ compact: true, openComments: 3 });
  assert.equal(find(entries, 'comments')?.label, 'Comments (3)');
  const destructive = entries.filter((entry) => 'destructive' in entry && entry.destructive);
  assert.equal(destructive.length, 1);
  assert.equal(entries.at(-1), destructive[0]);
});
