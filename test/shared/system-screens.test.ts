// System screens in system.json (documentation/specs/system-builder-depth.md §4.6, §13 T12a): the
// `screens` and `viewports` readers, the entry problems (bad entries, the 25th screen, a missing or
// over-long file), a screen's own viewports replacing the system's, the fingerprints the screens fold
// into by kind, and the contract and copy paths that carry `screens/<id>.html`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SYSTEM_SCREENS_MAX } from '../../src/shared/limits.ts';
import {
  buildSystemDetail,
  isSystemContractRel,
  parseSystemState,
  screenAreaOf,
  sectionFingerprints,
  SYSTEM_SECTIONS,
  type SystemDetailSource,
} from '../../src/shared/system-json.ts';
import { isCopyReference, planCopy } from '../../src/service/systems/link.ts';

const NOW = '2026-11-27T10:00:00.000Z';
const LAPTOP = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE = { id: 'phone', label: 'Phone', width: 390, height: 844 };

const source = (json: unknown, files: string[] = [], overrides: Partial<SystemDetailSource> = {}): SystemDetailSource => ({
  id: 'acme',
  dir: '/designs/_systems/acme',
  state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
  systemJson: JSON.stringify(json),
  tokensCss: null,
  texts: {},
  files: files.map((rel) => ({ rel, bytes: 100 })),
  build: null,
  ...overrides,
});

const detailOf = (json: unknown, files: string[] = [], overrides: Partial<SystemDetailSource> = {}) => buildSystemDetail(source(json, files, overrides));

describe('screens', () => {
  test('listed screens read with their kind; a screen with its own viewports keeps them, others take the system sizes', () => {
    const detail = detailOf(
      {
        screens: [
          { id: 'home', title: 'Home page', kind: 'page' },
          { id: 'og-card', title: 'Social card', kind: 'marketing', viewports: [{ id: 'og', label: 'Open Graph', width: 1200, height: 630 }] },
          { id: 'email', title: 'Welcome email', kind: 'marketing', viewports: [{ id: 'email', width: 600, height: 1200 }] },
        ],
      },
      ['screens/home.html', 'screens/og-card.html', 'screens/email.html'],
    );
    assert.deepEqual(detail.problems, []);
    assert.deepEqual(detail.screens, [
      { id: 'home', title: 'Home page', kind: 'page', viewports: null, problem: null, source: null },
      { id: 'og-card', title: 'Social card', kind: 'marketing', viewports: [{ id: 'og', label: 'Open Graph', width: 1200, height: 630 }], problem: null, source: null },
      // A missing label reads as the id.
      { id: 'email', title: 'Welcome email', kind: 'marketing', viewports: [{ id: 'email', label: 'email', width: 600, height: 1200 }], problem: null, source: null },
    ]);
    assert.deepEqual(detail.viewports, [LAPTOP, PHONE]);
  });

  test('absent, null or empty screens read as none, with no problem', () => {
    for (const json of [{}, { screens: null }, { screens: [] }]) {
      const detail = detailOf(json);
      assert.deepEqual(detail.screens, [], JSON.stringify(json));
      assert.deepEqual(detail.problems, []);
    }
    assert.deepEqual(detailOf({ screens: 'home' }).problems, [{ entry: 'screens', message: 'screens in system.json is not a list, so it was skipped.' }]);
  });

  test('a bad entry is dropped with one problem naming it; the good ones stay', () => {
    const files = ['screens/home.html', 'screens/a.html', 'screens/b.html', 'screens/c.html', 'screens/d.html'];
    const detail = detailOf(
      {
        screens: [
          { id: 'home', title: 'Home', kind: 'page' },
          'not an object',
          { id: 'Home', title: 'Upper', kind: 'page' },
          { id: '../x', title: 'Up', kind: 'page' },
          { id: 'home', title: 'Twice', kind: 'page' },
          { id: 'a', title: '', kind: 'page' },
          { id: 'b', title: 'B', kind: 'landing' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D', kind: 'state', file: '../../elsewhere.html' },
        ],
      },
      files,
    );
    assert.deepEqual(detail.screens.map((screen) => screen.id), ['home']);
    assert.deepEqual(detail.problems, [
      { entry: 'screens[1]', message: 'This screen is not an object.' },
      { entry: 'screens.Home', message: 'This screen needs its own id: lower-case letters, digits and dashes.' },
      { entry: 'screens.../x', message: 'This screen needs its own id: lower-case letters, digits and dashes.' },
      { entry: 'screens.home', message: 'This screen needs its own id: lower-case letters, digits and dashes.' },
      { entry: 'screens.a', message: 'This screen needs a title of 1 to 80 characters.' },
      { entry: 'screens.b', message: 'Its kind must be page, pattern, state or marketing.' },
      { entry: 'screens.c', message: 'Its kind must be page, pattern, state or marketing.' },
      { entry: 'screens.d', message: 'Its file must be screens/d.html.' },
    ]);
  });

  test(`past ${SYSTEM_SCREENS_MAX} screens each further entry is a problem`, () => {
    const screens = Array.from({ length: SYSTEM_SCREENS_MAX + 2 }, (_, n) => ({ id: `s${n}`, title: `Screen ${n}`, kind: 'page' }));
    const detail = detailOf({ screens }, screens.map((screen) => `screens/${screen.id}.html`));
    assert.equal(detail.screens.length, SYSTEM_SCREENS_MAX);
    assert.deepEqual(detail.problems, [
      { entry: `screens.s${SYSTEM_SCREENS_MAX}`, message: 'Design systems hold up to 24 screens.' },
      { entry: `screens.s${SYSTEM_SCREENS_MAX + 1}`, message: 'Design systems hold up to 24 screens.' },
    ]);
  });

  test('a listed screen whose file is missing or over the cap stays, with its sentence on it and in the problems', () => {
    const detail = detailOf(
      { screens: [{ id: 'gone', title: 'Gone', kind: 'state' }, { id: 'big', title: 'Big', kind: 'page' }, { id: 'ok', title: 'Fine', kind: 'pattern' }] },
      ['screens/big.html', 'screens/ok.html'],
      { tooLarge: ['screens/big.html'] },
    );
    assert.deepEqual(detail.screens.map((screen) => [screen.id, screen.problem]), [
      ['gone', 'screens/gone.html is missing.'],
      ['big', 'screens/big.html is longer than 60 000 characters.'],
      ['ok', null],
    ]);
    assert.deepEqual(detail.problems, [
      { entry: 'screens.gone', message: 'screens/gone.html is missing.' },
      { entry: 'screens.big', message: 'screens/big.html is longer than 60 000 characters.' },
    ]);
  });

  test("a screen's unusable viewports fall back to the system's sizes with a problem", () => {
    const detail = detailOf(
      {
        screens: [
          { id: 'a', title: 'A', kind: 'page', viewports: [{ id: 'tiny', width: 10, height: 10 }] },
          { id: 'b', title: 'B', kind: 'page', viewports: 'phone' },
          { id: 'c', title: 'C', kind: 'page', viewports: [{ id: 'ok', width: 800, height: 600 }, { id: 'ok', width: 900, height: 600 }, { width: 800, height: 600 }] },
        ],
      },
      ['screens/a.html', 'screens/b.html', 'screens/c.html'],
    );
    assert.deepEqual(detail.screens.map((screen) => screen.viewports), [null, null, [{ id: 'ok', label: 'ok', width: 800, height: 600 }]]);
    assert.deepEqual(detail.problems.map((problem) => problem.entry), ['screens.a', 'screens.b', 'screens.c']);
    assert.match(detail.problems[0]?.message ?? '', /^No viewport here can be used\./);
    assert.equal(detail.problems[1]?.message, "Its viewports aren't a list, so the system's sizes are used.");
    assert.match(detail.problems[2]?.message ?? '', /^Some viewports were skipped\./);
  });
});

describe('viewports', () => {
  test('absent or null reads as Laptop and Phone; a valid list replaces them', () => {
    assert.deepEqual(detailOf({}).viewports, [LAPTOP, PHONE]);
    assert.deepEqual(detailOf({ viewports: null }).viewports, [LAPTOP, PHONE]);
    const custom = detailOf({ viewports: [{ id: 'tablet', label: 'Tablet', width: 834, height: 1194 }] });
    assert.deepEqual(custom.viewports, [{ id: 'tablet', label: 'Tablet', width: 834, height: 1194 }]);
    assert.deepEqual(custom.problems, []);
  });

  test('an unusable list falls back to the defaults with one problem; more than 8 keeps the first 8', () => {
    for (const viewports of ['laptop', [{ id: 'x', width: 199, height: 800 }], [{ id: 'x y', width: 800, height: 800 }], [{ id: 'x', width: 800.5, height: 800 }]]) {
      const detail = detailOf({ viewports });
      assert.deepEqual(detail.viewports, [LAPTOP, PHONE], JSON.stringify(viewports));
      assert.equal(detail.problems.length, 1);
      assert.equal(detail.problems[0]?.entry, 'viewports');
    }
    const many = Array.from({ length: 10 }, (_, n) => ({ id: `v${n}`, width: 400 + n, height: 800 }));
    const detail = detailOf({ viewports: many });
    assert.deepEqual(detail.viewports.map((viewport) => viewport.id), ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
    assert.deepEqual(detail.problems, [{ entry: 'viewports', message: 'Only the first 8 viewports are used.' }]);
  });
});

describe('fingerprints', () => {
  const files = ['screens/home.html', 'screens/og.html'];
  const prints = (json: unknown, hashes: Record<string, string> = {}) => sectionFingerprints(detailOf(json, files), hashes);
  const changed = (one: Record<string, string>, two: Record<string, string>) => SYSTEM_SECTIONS.filter((section) => one[section] !== two[section]);

  test('no screens: every fingerprint is what it was without the key', () => {
    assert.deepEqual(prints({ screens: [] }), prints({}));
    assert.deepEqual(prints({ viewports: [{ id: 'tablet', width: 834, height: 1194 }] }), prints({}), 'system sizes alone are no content');
  });

  test('page, pattern and state screens fold into patterns; marketing into brand; nothing else moves', () => {
    const none = prints({});
    for (const kind of ['page', 'pattern', 'state'] as const) {
      assert.equal(screenAreaOf(kind), 'patterns');
      assert.deepEqual(changed(none, prints({ screens: [{ id: 'home', title: 'Home', kind }] })), ['patterns'], kind);
    }
    assert.equal(screenAreaOf('marketing'), 'brand');
    assert.deepEqual(changed(none, prints({ screens: [{ id: 'og', title: 'OG', kind: 'marketing' }] })), ['brand']);
  });

  test("a screen's file, title, kind or sizes change its area's fingerprint", () => {
    const base = { screens: [{ id: 'home', title: 'Home', kind: 'page' }] };
    const before = prints(base, { 'screens/home.html': 'a'.repeat(64) });
    assert.deepEqual(changed(before, prints(base, { 'screens/home.html': 'b'.repeat(64) })), ['patterns'], 'file');
    assert.deepEqual(changed(before, prints({ screens: [{ id: 'home', title: 'Home 2', kind: 'page' }] }, { 'screens/home.html': 'a'.repeat(64) })), ['patterns'], 'title');
    assert.deepEqual(changed(before, prints({ ...base, viewports: [{ id: 'tablet', width: 834, height: 1194 }] }, { 'screens/home.html': 'a'.repeat(64) })), ['patterns'], 'system sizes');
    assert.deepEqual(
      changed(before, prints({ screens: [{ id: 'home', title: 'Home', kind: 'marketing' }] }, { 'screens/home.html': 'a'.repeat(64) })),
      ['patterns', 'brand'],
      'kind moves it to brand',
    );
  });
});

describe('contract and copy paths', () => {
  test('screens/<id>.html is a contract file; anything else under screens/ is not', () => {
    assert.equal(isSystemContractRel('screens/home.html'), true);
    assert.equal(isSystemContractRel('screens/og-card.html'), true);
    for (const rel of ['screens/Home.html', 'screens/a/b.html', 'screens/home.htm', 'screens/.home.html', 'screens/../x.html', 'screens/home.css', 'screen/home.html']) {
      assert.equal(isSystemContractRel(rel), false, rel);
    }
  });

  test('a copy carries the screens as agent reference, never exported', () => {
    assert.equal(isCopyReference('screens/home.html'), true);
    assert.equal(isCopyReference('screens/a/home.html'), false);
    // A detail with nothing to copy but the reference files (icons too, for the copy that lists them).
    const empty = { fonts: [], logos: [], icons: [], type: [], tokens: [] };
    const plan = planCopy(['tokens.css', 'system.json', 'screens/home.html', 'screens/notes.txt'], empty);
    const to = plan.entries.map((entry) => entry.to);
    assert.ok(to.includes('screens/home.html'));
    assert.ok(!to.includes('screens/notes.txt'));
  });
});
