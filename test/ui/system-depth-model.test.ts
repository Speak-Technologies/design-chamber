// What the panel shows of system-builder-depth (T8): the depth and left-out topics on the summary line and in the Overview,
// the kind labels, and the colour pairs with their ratios. Pure view-model tests; the DOM is walked in the visual harness
// (test/ui/visual/scenarios/design-system-depth.mjs).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENTRY_KINDS } from '../../src/shared/system-json.ts';
import { SYSTEM_TOPIC_IDS } from '../../src/shared/system-checklist.ts';
import type { SystemColourPair, SystemDetail, SystemToken } from '../../src/shared/types.ts';
import { PAIR_MEASURED_SENTENCE } from '../../src/service/systems/specimen-html.ts';
import {
  DEPTH_LABEL,
  DEPTH_SENTENCE,
  ENTRY_KIND_LABEL,
  PAIR_MEASURED,
  TOPIC_LABEL,
  entryKindLabel,
  entryLabel,
  homeLine,
  homeTitle,
  leftOutText,
  pairViews,
  scopeParts,
  scopeView,
  sectionOfHit,
} from '../../src/ui/model/system-page-model.ts';
import { repoHeaderLine } from '../../src/ui/model/system-home-model.ts';

const token = (name: string, light: string, dark: string | null = null, editable: 'ok' | 'formula' = 'ok'): SystemToken => ({
  name,
  section: 'colours',
  group: null,
  light: { text: light, editable, problem: null },
  dark: dark === null ? null : { text: dark, editable: 'ok', problem: null },
  note: '',
  breakpoint: false,
  alsoSet: [],
  fromCode: false,
  problem: null,
});

const pair = (fg: string, bg: string, use: SystemColourPair['use'] = 'text', over: Partial<SystemColourPair> = {}): SystemColourPair => ({ fg, bg, use, note: '', auto: false, ...over });

const NO_SOURCES = { code: null, brand: 0 };
const internal = { kind: 'internal' } as SystemDetail['home'];
const repo = { kind: 'repo', directory: 'C:\\work\\shop', label: 'shop', folder: 'design-system', livingPage: 'design-system/index.html', readable: true, problem: null, lastRead: null } as SystemDetail['home'];

// ---- depth and what was left out ----

test('an older system, with none of the new fields, shows no scope anywhere', () => {
  const older = { home: internal, sources: NO_SOURCES, usedBy: 2 } as Parameters<typeof homeLine>[0];
  assert.deepEqual(scopeParts(older), []);
  assert.equal(homeLine(older, 'From a description'), 'In Design Chamber · From a description · Used by 2 designs');
  assert.equal(homeTitle(older), 'Kept in your Designs folder');
  assert.equal(leftOutText(older), null);
  assert.equal(scopeView(older), null);
  assert.deepEqual(repoHeaderLine({ home: repo }), { text: 'Repo · shop · design-system/', title: 'C:\\work\\shop' });
});

test('the depth and the count of topics left out sit on the summary line, right after where the system lives', () => {
  const detail = { home: internal, sources: NO_SOURCES, usedBy: 0, depth: 'core', outOfScope: ['motion', 'marketing', 'data-display'] } as Parameters<typeof homeLine>[0];
  assert.deepEqual(scopeParts(detail), ['Core system', '3 topics left out']);
  assert.equal(homeLine(detail, 'From tidepool-web'), 'In Design Chamber · Core system · 3 topics left out · From tidepool-web · Not used yet');
  assert.equal(homeLine({ ...detail, outOfScope: ['motion'] } as Parameters<typeof homeLine>[0], null), 'In Design Chamber · Core system · 1 topic left out · Not used yet');
  assert.equal(homeLine({ ...detail, depth: 'tokens', outOfScope: [] } as Parameters<typeof homeLine>[0], null), 'In Design Chamber · Tokens only · Not used yet');
  assert.equal(homeLine({ ...detail, depth: 'full', outOfScope: [] } as Parameters<typeof homeLine>[0], null), 'In Design Chamber · Full system · Not used yet');
  assert.equal(homeLine({ ...detail, depth: null, outOfScope: ['motion'] } as Parameters<typeof homeLine>[0], null), 'In Design Chamber · 1 topic left out · Not used yet');
});

test('a repo-backed system carries the depth on both header lines', () => {
  const detail = { home: repo, sources: NO_SOURCES, usedBy: 2, depth: 'full', outOfScope: ['logo'] } as Parameters<typeof homeLine>[0];
  assert.equal(homeLine(detail, 'From shop'), 'Repo · shop · Full system · 1 topic left out · Used by 2 designs');
  assert.deepEqual(repoHeaderLine(detail as Parameters<typeof repoHeaderLine>[0]), {
    text: 'Repo · shop · design-system/ · Full system · 1 topic left out',
    title: 'C:\\work\\shop\nLeft out on purpose: Logo.',
  });
});

test('the tooltip names the topics left out in words, not ids', () => {
  const detail = { home: internal, outOfScope: ['data-display', 'brand-colour'] } as Parameters<typeof homeTitle>[0];
  assert.equal(leftOutText(detail), 'Left out on purpose: Data display, Brand colour.');
  assert.equal(homeTitle(detail), 'Kept in your Designs folder\nLeft out on purpose: Data display, Brand colour.');
});

test('the Overview scope block shows the depth sentence, the left-out topics, or both', () => {
  assert.deepEqual(scopeView({ depth: 'core', outOfScope: [] }), { depth: { label: 'Core system', sentence: DEPTH_SENTENCE.core }, leftOut: [] });
  assert.deepEqual(scopeView({ depth: null, outOfScope: ['motion', 'states'] }), { depth: null, leftOut: ['Motion', 'Empty, loading and error states'] });
  assert.equal(scopeView({ depth: null, outOfScope: [] }), null);
});

test('every checklist topic has a plain label, each different, none with a dash', () => {
  for (const id of SYSTEM_TOPIC_IDS) assert.ok(TOPIC_LABEL[id], `${id} has a label`);
  assert.equal(new Set(Object.values(TOPIC_LABEL)).size, SYSTEM_TOPIC_IDS.length, 'two topics read the same');
  assert.equal(Object.keys(TOPIC_LABEL).length, SYSTEM_TOPIC_IDS.length, 'a label for a topic that is not on the list');
});

test('no text the panel adds uses an em or en dash', () => {
  const words = [...Object.values(TOPIC_LABEL), ...Object.values(DEPTH_LABEL), ...Object.values(DEPTH_SENTENCE), ...Object.values(ENTRY_KIND_LABEL), PAIR_MEASURED];
  for (const word of words) assert.ok(!/[—–]/.test(word), word);
});

// ---- kind labels ----

test('every pattern and brand kind the contract allows has a label', () => {
  for (const kind of [...ENTRY_KINDS.patterns, ...ENTRY_KINDS.brand]) {
    assert.ok(Object.hasOwn(ENTRY_KIND_LABEL, kind), `${kind} has a label`);
    assert.notEqual(entryKindLabel(kind), kind, `${kind} reads as words`);
  }
  assert.equal(entryKindLabel('overlay'), 'Overlays');
  assert.equal(entryKindLabel('data-display'), 'Data display');
  assert.equal(entryKindLabel('colour'), 'Brand colour');
  assert.equal(entryKindLabel('do-dont'), 'Do and don’t');
});

test('a kind this build does not know reads as plain words, never a raw id or a prototype key', () => {
  assert.equal(entryKindLabel('page-template'), 'Page template');
  assert.equal(entryKindLabel('icons'), 'Icons');
  assert.equal(entryKindLabel('constructor'), 'Constructor');
  assert.equal(entryKindLabel('__proto__'), 'Proto');
  assert.equal(entryKindLabel(''), 'Other');
});

// ---- colour pairs ----

const palette = [token('--text', '#000000', '#ffffff'), token('--surface', '#ffffff', '#111111'), token('--grey', '#777777'), token('--ok-grey', '#767676'), token('--formula', 'var(--text)', null, 'formula'), token('--accent', 'oklch(0.55 0.12 190)')];

test('a system with no pairs lists none', () => {
  assert.deepEqual(pairViews({ tokens: palette }), []);
  assert.deepEqual(pairViews({ tokens: palette, pairs: [] }), []);
});

test('a pair reads as its two token names, its use and the level it needs', () => {
  const [view] = pairViews({ tokens: palette, pairs: [pair('--text', '--surface', 'text', { note: 'Body copy.' })] });
  assert.equal(view?.index, 0);
  assert.equal(view?.name, '--text on --surface');
  assert.equal(view?.use, 'Body text, needs 4.5:1');
  assert.equal(view?.note, 'Body copy.');
  assert.equal(view?.auto, false);
  assert.equal(pairViews({ tokens: palette, pairs: [pair('--text', '--surface', 'large')] })[0]?.use, 'Large text, needs 3:1');
  assert.equal(pairViews({ tokens: palette, pairs: [pair('--text', '--surface', 'ui')] })[0]?.use, 'Interface part, needs 3:1');
});

test('the ratio is printed for a hex pair, once per scheme, the dark one from the dark values', () => {
  const [view] = pairViews({ tokens: palette, pairs: [pair('--text', '--surface')] });
  assert.deepEqual(view?.grounds.map((ground) => [ground.label, ground.ratio, ground.low]), [
    ['Light', '21.00:1', false],
    ['Dark', '18.88:1', false],
  ]);
  assert.deepEqual(view?.grounds.map((ground) => [ground.fg, ground.bg]), [
    ['#000000', '#ffffff'],
    ['#ffffff', '#111111'],
  ]);
});

test('a system with no dark values draws one ground, light', () => {
  const light = [token('--text', '#000000'), token('--surface', '#ffffff')];
  const [view] = pairViews({ tokens: light, pairs: [pair('--text', '--surface')] });
  assert.deepEqual(view?.grounds.map((ground) => ground.scheme), ['light']);
});

test('a pair Node cannot judge says the check measures it, and is not called low', () => {
  const [formula, oklch] = pairViews({ tokens: palette, pairs: [pair('--formula', '--surface'), pair('--text', '--accent')] });
  for (const view of [formula, oklch]) {
    for (const ground of view?.grounds ?? []) {
      assert.equal(ground.ratio, PAIR_MEASURED);
      assert.equal(ground.low, false);
    }
  }
  // A formula has no value to draw; a colour Node can't parse still has one the browser can draw.
  assert.equal(formula?.grounds[0]?.fg, null);
  assert.equal(oklch?.grounds[0]?.bg, 'oklch(0.55 0.12 190)');
});

test('the measured sentence is the one the board prints', () => {
  assert.equal(PAIR_MEASURED, PAIR_MEASURED_SENTENCE);
});

test('a ratio under the level is marked low, at the boundary and not above it', () => {
  const [under, over, large] = pairViews({
    tokens: palette,
    pairs: [pair('--grey', '--surface', 'text'), pair('--ok-grey', '--surface', 'text'), pair('--grey', '--surface', 'large')],
  });
  // #777777 on white is 4.48:1 (under 4.5), #767676 is 4.54:1 (over).
  assert.equal(under?.grounds[0]?.ratio, '4.47:1');
  assert.equal(under?.grounds[0]?.low, true);
  assert.equal(under?.grounds[0]?.ariaLabel, 'Light, 4.47:1, under 4.5:1');
  assert.equal(over?.grounds[0]?.low, false);
  assert.equal(over?.grounds[0]?.ariaLabel, 'Light, 4.54:1');
  // The same colours pass as large text (3:1): the level is the pair's own use.
  assert.equal(large?.grounds[0]?.low, false);
});

test('an automatic pair is flagged, and the order the service gave is kept', () => {
  const views = pairViews({ tokens: palette, pairs: [pair('--text', '--surface'), pair('--ok-grey', '--surface', 'text', { auto: true })] });
  assert.deepEqual(views.map((view) => [view.index, view.auto]), [[0, false], [1, true]]);
});

test('a pair naming a token the detail lacks still draws a row and reads as measured', () => {
  const [view] = pairViews({ tokens: palette, pairs: [pair('--gone', '--surface')] });
  assert.equal(view?.grounds[0]?.ratio, PAIR_MEASURED);
  assert.equal(view?.grounds[0]?.fg, null);
});

// ---- a pair on the board is a click target in Colours ----

test('a click on a pair lands in Colours, and a pair that is not there selects nothing', () => {
  const detail = { tokens: palette, pairs: [pair('--text', '--surface')], components: [], patterns: [], brand: [], type: [], fonts: [], logos: [] } as unknown as SystemDetail;
  assert.equal(sectionOfHit(detail, 'pair:0'), 'colours');
  assert.equal(sectionOfHit(detail, 'pair:1'), null);
  assert.equal(sectionOfHit(detail, 'pair:abcd'), null);
  assert.deepEqual(entryLabel(detail, 'pair:0'), { tag: 'pair', text: '--text on --surface' });
  assert.deepEqual(entryLabel(detail, 'pair:5'), { tag: 'pair', text: 'Colour pair' });
});
