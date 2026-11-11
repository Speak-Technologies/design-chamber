import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { MenuEntry } from '../../src/ui/components/kit.ts';
import { viewerMenuEntries, type ViewerMenuInput } from '../../src/ui/model/viewer-menu.ts';

type Action = Extract<MenuEntry, { id: string }>;
const find = (entries: readonly MenuEntry[], id: string): Action | undefined => entries.find((entry): entry is Action => 'id' in entry && entry.id === id);
const entriesOf = (input: Partial<ViewerMenuInput>): MenuEntry[] => viewerMenuEntries({ compact: false, isPage: false, copyHtmlTooLarge: false, ...input });

const shape = (input: Partial<ViewerMenuInput>): string[] =>
  viewerMenuEntries({ compact: false, isPage: false, copyHtmlTooLarge: false, ...input }).map((entry) => ('id' in entry ? entry.id : '-'));

test('the full-screen canvas menu: export, then the design-level entries', () => {
  assert.deepEqual(shape({}), ['zip', 'html', '-', 'reveal', 'path', 'rename', '-', 'delete']);
});

test('the full-screen page menu has only the design-level entries (export and copy are toolbar buttons)', () => {
  assert.deepEqual(shape({ isPage: true }), ['reveal', 'path', 'rename', '-', 'delete']);
});

test('the rail canvas menu carries continue, export and the design-level entries; Comments and Versions sit in the header', () => {
  assert.deepEqual(shape({ compact: true }), ['chat', '-', 'zip', 'html', 'path', 'reveal', 'rename', '-', 'delete']);
});

test('the rail page menu adds Copy HTML and says what its export does', () => {
  assert.deepEqual(shape({ compact: true, isPage: true }), ['chat', '-', 'zip', 'html', 'copy-html', 'path', 'reveal', 'rename', '-', 'delete']);
  assert.equal(find(entriesOf({ compact: true, isPage: true }), 'html')?.label, 'Export single-file HTML');
  assert.equal(find(entriesOf({ compact: true }), 'html')?.label, 'Export screen as HTML…');
});

test('Copy HTML is disabled with a reason only when the page is over the clipboard cap', () => {
  const copy = (copyHtmlTooLarge: boolean) => find(entriesOf({ compact: true, isPage: true, copyHtmlTooLarge }), 'copy-html');
  assert.deepEqual(copy(true), { id: 'copy-html', label: 'Copy HTML', disabled: true, hint: 'too large' });
  assert.equal(copy(false)?.disabled, false);
  assert.equal(copy(false)?.hint, undefined);
});

test('the rail menu no longer lists Versions or Comments (the header has them)', () => {
  for (const isPage of [false, true]) {
    const entries = entriesOf({ compact: true, isPage });
    assert.equal(find(entries, 'versions'), undefined);
    assert.equal(find(entries, 'comments'), undefined);
  }
});

test('Delete is the only destructive entry, last', () => {
  const entries = entriesOf({ compact: true });
  const destructive = entries.filter((entry) => 'destructive' in entry && entry.destructive);
  assert.equal(destructive.length, 1);
  assert.equal(entries.at(-1), destructive[0]);
});

test('a design with no tweaks gets "Ask for tweaks": first on the page, right after the chat link in the rail', () => {
  assert.deepEqual(shape({ askForTweaks: true }), ['ask-tweaks', '-', 'zip', 'html', '-', 'reveal', 'path', 'rename', '-', 'delete']);
  assert.deepEqual(shape({ isPage: true, askForTweaks: true }), ['ask-tweaks', '-', 'reveal', 'path', 'rename', '-', 'delete']);
  assert.deepEqual(shape({ compact: true, askForTweaks: true }), ['chat', 'ask-tweaks', '-', 'zip', 'html', 'path', 'reveal', 'rename', '-', 'delete']);
  assert.equal(find(entriesOf({ askForTweaks: true }), 'ask-tweaks')?.label, 'Ask for tweaks');
});

test('a design that has tweaks, or an old version on show, does not offer it', () => {
  for (const input of [{}, { askForTweaks: false }, { compact: true }, { isPage: true }]) assert.equal(find(entriesOf(input), 'ask-tweaks'), undefined);
});

describe('Clear saved page data', () => {
  test('is left out unless the design has saved data', () => {
    for (const compact of [false, true]) for (const isPage of [false, true]) assert.equal(find(entriesOf({ compact, isPage }), 'page-data'), undefined);
    assert.equal(find(entriesOf({ pageData: 'hidden' }), 'page-data'), undefined);
  });

  test('sits just before Rename, after Copy path, on the page and the canvas, in the rail and full screen', () => {
    assert.deepEqual(shape({ isPage: true, pageData: 'enabled' }), ['reveal', 'path', 'page-data', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ pageData: 'enabled' }), ['zip', 'html', '-', 'reveal', 'path', 'page-data', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ compact: true, isPage: true, pageData: 'enabled' }), ['chat', '-', 'zip', 'html', 'copy-html', 'path', 'reveal', 'page-data', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ compact: true, pageData: 'enabled' }), ['chat', '-', 'zip', 'html', 'path', 'reveal', 'page-data', 'rename', '-', 'delete']);
  });

  test('is a plain, enabled entry normally, and off with its reason while an old version is on show', () => {
    assert.deepEqual(find(entriesOf({ pageData: 'enabled' }), 'page-data'), { id: 'page-data', label: 'Clear saved page data' });
    assert.deepEqual(find(entriesOf({ pageData: 'disabled' }), 'page-data'), { id: 'page-data', label: 'Clear saved page data', disabled: true, reason: 'Not while viewing a version' });
  });

  test('is not destructive in the menu (the confirm carries the weight); Delete stays the only destructive entry', () => {
    const entries = entriesOf({ compact: true, pageData: 'enabled' });
    assert.equal(entries.filter((entry) => 'destructive' in entry && entry.destructive).length, 1);
  });
});
