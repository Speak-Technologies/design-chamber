import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MenuEntry } from '../../src/ui/components/kit.ts';
import { NARROW_RAIL_QUERY, viewerMenuEntries, withoutComputerOnly, type ViewerMenuInput } from '../../src/ui/model/viewer-menu.ts';

type Action = Extract<MenuEntry, { id: string }>;
const find = (entries: readonly MenuEntry[], id: string): Action | undefined => entries.find((entry): entry is Action => 'id' in entry && entry.id === id);
const labelOf = (entries: readonly MenuEntry[], id: string): string | undefined => find(entries, id)?.label;
const entriesOf = (input: Partial<ViewerMenuInput>): MenuEntry[] => viewerMenuEntries({ compact: false, isPage: false, copyHtmlTooLarge: false, ...input });

const shape = (input: Partial<ViewerMenuInput>): string[] =>
  viewerMenuEntries({ compact: false, isPage: false, copyHtmlTooLarge: false, ...input }).map((entry) => ('id' in entry ? entry.id : '-'));

test('the full-screen canvas menu: export, then the design-level entries', () => {
  assert.deepEqual(shape({}), ['zip', 'html', '-', 'add-to-folder', 'reveal', 'path', 'rename', '-', 'delete']);
});

test('the full-screen page menu has only the design-level entries (export and copy are toolbar buttons)', () => {
  assert.deepEqual(shape({ isPage: true }), ['add-to-folder', 'reveal', 'path', 'rename', '-', 'delete']);
});

test('the rail canvas menu carries continue, export and the design-level entries; Comments and Versions sit in the header', () => {
  assert.deepEqual(shape({ compact: true }), ['chat', '-', 'zip', 'html', 'path', 'add-to-folder', 'reveal', 'rename', '-', 'delete']);
});

test('the rail page menu adds Copy HTML and says what its export does', () => {
  assert.deepEqual(shape({ compact: true, isPage: true }), ['chat', '-', 'zip', 'html', 'copy-html', 'path', 'add-to-folder', 'reveal', 'rename', '-', 'delete']);
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
  assert.deepEqual(shape({ askForTweaks: true }), ['ask-tweaks', '-', 'zip', 'html', '-', 'add-to-folder', 'reveal', 'path', 'rename', '-', 'delete']);
  assert.deepEqual(shape({ isPage: true, askForTweaks: true }), ['ask-tweaks', '-', 'add-to-folder', 'reveal', 'path', 'rename', '-', 'delete']);
  assert.deepEqual(shape({ compact: true, askForTweaks: true }), ['chat', 'ask-tweaks', '-', 'zip', 'html', 'path', 'add-to-folder', 'reveal', 'rename', '-', 'delete']);
  assert.equal(find(entriesOf({ askForTweaks: true }), 'ask-tweaks')?.label, 'Ask for tweaks');
});

test('a design that has tweaks, or an old version on show, does not offer it', () => {
  for (const input of [{}, { askForTweaks: false }, { compact: true }, { isPage: true }]) assert.equal(find(entriesOf(input), 'ask-tweaks'), undefined);
});

test('a narrow rail moves Tweaks into the menu, right after the chat link, under the label the button had', () => {
  assert.deepEqual(shape({ compact: true, railTweaks: 'Tweaks' }), ['chat', 'tweaks', '-', 'zip', 'html', 'path', 'add-to-folder', 'reveal', 'rename', '-', 'delete']);
  assert.equal(find(entriesOf({ compact: true, railTweaks: 'Tweaks, unsaved changes' }), 'tweaks')?.label, 'Tweaks, unsaved changes');
  // Not offered when the rail is wide enough (no railTweaks), and never on the full-screen page, whose toolbar has the button.
  for (const input of [{ compact: true }, { compact: true, railTweaks: null }, { compact: false, railTweaks: 'Tweaks' }, { compact: false, isPage: true, railTweaks: 'Tweaks' }]) {
    assert.equal(find(entriesOf(input), 'tweaks'), undefined, JSON.stringify(input));
  }
});

describe('Clear saved page data', () => {
  test('is left out unless the design has saved data', () => {
    for (const compact of [false, true]) for (const isPage of [false, true]) assert.equal(find(entriesOf({ compact, isPage }), 'page-data'), undefined);
    assert.equal(find(entriesOf({ pageData: 'hidden' }), 'page-data'), undefined);
  });

  test('sits just before Rename, after Copy path, on the page and the canvas, in the rail and full screen', () => {
    assert.deepEqual(shape({ isPage: true, pageData: 'enabled' }), ['add-to-folder', 'reveal', 'path', 'page-data', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ pageData: 'enabled' }), ['zip', 'html', '-', 'add-to-folder', 'reveal', 'path', 'page-data', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ compact: true, isPage: true, pageData: 'enabled' }), ['chat', '-', 'zip', 'html', 'copy-html', 'path', 'add-to-folder', 'reveal', 'page-data', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ compact: true, pageData: 'enabled' }), ['chat', '-', 'zip', 'html', 'path', 'add-to-folder', 'reveal', 'page-data', 'rename', '-', 'delete']);
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

test('Add to folder… sits before Reveal in folder on every surface (Phase 2.6 F2)', () => {
  for (const compact of [false, true]) {
    for (const isPage of [false, true]) {
      const entries = entriesOf({ compact, isPage });
      const at = entries.findIndex((entry) => 'id' in entry && entry.id === 'add-to-folder');
      const reveal = entries.findIndex((entry) => 'id' in entry && entry.id === 'reveal');
      assert.ok(at > -1 && reveal === at + 1, `add-to-folder right before reveal (compact=${compact}, isPage=${isPage})`);
      assert.equal(labelOf(entries, 'add-to-folder'), 'Add to folder…');
    }
  }
});

test('the media query hiding the rail Tweaks button matches NARROW_RAIL_QUERY (KI-21: the two must not drift)', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url)), 'utf8');
  const btn = css.indexOf('.dc-compact-actions .dc-tweaks-btn');
  assert.ok(btn > -1, 'the compact Tweaks button rule exists in styles.css');
  const media = css.lastIndexOf('@media', btn);
  assert.ok(media > -1, 'a media query guards the compact Tweaks button');
  const open = css.indexOf('{', media);
  const condition = css.slice(media + '@media'.length, open).trim();
  assert.equal(condition, NARROW_RAIL_QUERY);
});

describe('on a phone (native-extras §2.2)', () => {
  const COMPUTER_ONLY = ['reveal', 'zip', 'html', 'path', 'export'];

  test('the rail menus leave out Reveal, Export and Copy path, and keep everything that works from the phone', () => {
    assert.deepEqual(shape({ compact: true, phone: true }), ['chat', '-', 'add-to-folder', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ compact: true, isPage: true, phone: true }), ['chat', '-', 'copy-html', 'add-to-folder', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ compact: true, isPage: true, phone: true, askForTweaks: true, pageData: 'enabled' }), ['chat', 'ask-tweaks', '-', 'copy-html', 'add-to-folder', 'page-data', 'rename', '-', 'delete']);
    assert.deepEqual(shape({ compact: true, phone: true, railTweaks: 'Tweaks' }), ['chat', 'tweaks', '-', 'add-to-folder', 'rename', '-', 'delete']);
  });

  test('no combination shows a computer-only entry, starts or ends on a separator, or doubles one', () => {
    for (const compact of [false, true]) {
      for (const isPage of [false, true]) {
        for (const askForTweaks of [false, true]) {
          for (const pageData of [undefined, 'enabled', 'disabled'] as const) {
            const ids = shape({ compact, isPage, askForTweaks, pageData, phone: true });
            const label = JSON.stringify({ compact, isPage, askForTweaks, pageData });
            for (const id of COMPUTER_ONLY) assert.ok(!ids.includes(id), `${id} hidden ${label}`);
            assert.notEqual(ids[0], '-', label);
            assert.notEqual(ids.at(-1), '-', label);
            assert.ok(!ids.join(',').includes('-,-'), label);
            assert.equal(ids.at(-1), 'delete', label);
          }
        }
      }
    }
  });

  test('without the phone flag every menu is exactly as before', () => {
    for (const compact of [false, true]) for (const isPage of [false, true]) assert.deepEqual(shape({ compact, isPage, phone: false }), shape({ compact, isPage }));
  });

  test('withoutComputerOnly works on any menu (list rows, systems) and tidies the separators', () => {
    const entries = [{ id: 'reveal' }, { separator: true as const }, { id: 'open' }, { id: 'path' }, { separator: true as const }, { separator: true as const }, { id: 'rename' }, { separator: true as const }, { id: 'zip' }];
    assert.deepEqual(withoutComputerOnly(entries), [{ id: 'open' }, { separator: true }, { id: 'rename' }]);
    assert.deepEqual(withoutComputerOnly([{ id: 'reveal' }]), []);
    assert.deepEqual(withoutComputerOnly([{ id: 'rename' }, { id: 'export' }]), [{ id: 'rename' }], "a system's Export tokens");
    assert.deepEqual(withoutComputerOnly([]), []);
  });
});
