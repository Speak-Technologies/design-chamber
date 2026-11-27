// The token export menu and sheet of a design system (system-builder-depth T19u): when the menu offers it, which formats
// the sheet lists, and what it says afterwards. Pure view-model tests; the DOM is walked in the visual harness
// (test/ui/visual/scenarios/system-export.mjs).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EXPORT_NOTHING,
  exportButtonLabel,
  exportMenuEntry,
  exportOffered,
  formatChoices,
  pickedFormats,
  renamedSentence,
} from '../../src/ui/model/token-export-model.ts';

test('the export is for the computer: a phone is not offered it, anything else is', () => {
  assert.equal(exportOffered({ device: { formFactor: 'phone' } }), false);
  assert.equal(exportOffered({ device: { formFactor: 'tablet' } }), true);
  assert.equal(exportOffered({ device: { formFactor: 'desktop' } }), true);
  // An older host says nothing about the device, and a frame before `ready` has no context: both are a computer.
  assert.equal(exportOffered({}), true);
  assert.equal(exportOffered(null), true);
});

test('the menu entry is live on a clean current system', () => {
  assert.deepEqual(exportMenuEntry({ viewing: false, dirty: false, unreadable: false }), { id: 'export', label: 'Export tokens…' });
});

test('the menu entry says why when the saved files are not what is on screen, or can’t be read', () => {
  const off = (facts: Parameters<typeof exportMenuEntry>[0]): string | undefined => {
    const entry = exportMenuEntry(facts);
    assert.equal('disabled' in entry && entry.disabled, true);
    return 'reason' in entry ? entry.reason : undefined;
  };
  assert.equal(off({ viewing: true, dirty: false, unreadable: false }), 'Go back to the current version first.');
  assert.equal(off({ viewing: false, dirty: true, unreadable: false }), 'Save or discard your changes first.');
  assert.equal(off({ viewing: false, dirty: false, unreadable: true }), 'This system can’t be read right now.');
});

test('Tailwind is listed only when the service offers it, always in the same order', () => {
  assert.deepEqual(
    formatChoices(['css', 'dtcg']).map((choice) => choice.format),
    ['dtcg', 'css'],
  );
  assert.deepEqual(
    formatChoices(['tailwind', 'css', 'dtcg']).map((choice) => [choice.format, choice.label, choice.file]),
    [
      ['dtcg', 'Design tokens (W3C)', 'tokens.json'],
      ['css', 'CSS variables', 'tokens.css'],
      ['tailwind', 'Tailwind theme', 'tailwind-theme.css'],
    ],
  );
  // A format a newer service might send has no wording here, so it is not shown rather than shown as a raw id.
  assert.deepEqual(formatChoices(['dtcg', 'sass' as 'css']).map((choice) => choice.format), ['dtcg']);
  assert.deepEqual(formatChoices([]), []);
});

test('the ticks are sent in the listed order, and only for formats that are offered', () => {
  assert.deepEqual(pickedFormats(['dtcg', 'css'], new Set(['css', 'tailwind', 'dtcg'])), ['dtcg', 'css']);
  assert.deepEqual(pickedFormats(['dtcg', 'css', 'tailwind'], new Set()), []);
});

test('renamed names are counted in words, and nothing is said when none were', () => {
  assert.equal(renamedSentence(0), null);
  assert.equal(renamedSentence(1), '1 name was changed so it doesn’t clash in tokens.json. README.txt in the ZIP lists it.');
  assert.equal(renamedSentence(4), '4 names were changed so they don’t clash in tokens.json. README.txt in the ZIP lists them.');
});

test('the button says what it does, shows progress, and offers a retry after a failure', () => {
  assert.equal(exportButtonLabel({ busy: false, failed: false }), 'Export ZIP');
  assert.equal(exportButtonLabel({ busy: true, failed: false }), 'Exporting…');
  assert.equal(exportButtonLabel({ busy: true, failed: true }), 'Exporting…');
  assert.equal(exportButtonLabel({ busy: false, failed: true }), 'Try again');
});

test('no sentence carries a dash', () => {
  const words = [
    EXPORT_NOTHING,
    renamedSentence(1),
    renamedSentence(2),
    ...formatChoices(['dtcg', 'css', 'tailwind']).flatMap((choice) => [choice.label, choice.file]),
  ];
  for (const sentence of words) assert.doesNotMatch(String(sentence), /[—–]/);
});
