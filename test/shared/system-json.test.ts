// The pure reader of a design system (documentation/specs/phase-2-5-technical.md §2.3, §2.5, §2.11,
// §5.1, §5.6): the tolerant system.json parser, the state parser, the detail every reader sees,
// section fingerprints, review derivation and safe brand file names.
//
// The token rules (light/dark contexts, sections, value checks) are T3's `token-edit.ts`; these
// tests inject small deterministic rules so the reader is tested on its own.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  BOARD_LAYOUTS,
  buildSystemDetail,
  coveredAreas,
  deriveReview,
  effectiveLayout,
  humaniseSystemId,
  isBoardLayout,
  isReservedSystemId,
  isSystemContractRel,
  LAYOUTS_OF_SECTION,
  parseSystemJson,
  parseSystemState,
  readItemLayout,
  layoutPlaceTakes,
  readSectionLayouts,
  safeAssetName,
  sectionFingerprints,
  sourceLineOf,
  SYSTEM_SECTIONS,
  type LayoutIgnoredSink,
  type SystemDetailSource,
  type SystemTokenRules,
} from '../../src/shared/system-json.ts';
import { SYSTEM_OUT_OF_SCOPE_MAX } from '../../src/shared/limits.ts';
import { entryKeyOf, isBoardEntryKey, parseEntryKey, sectionOfEntry } from '../../src/shared/system-board.ts';
import { SYSTEM_TOPIC_IDS } from '../../src/shared/system-checklist.ts';
import type { JsonObject, SystemState } from '../../src/shared/types.ts';
import { OLD_SYSTEM_HASHES, oldSystemSource } from './fixtures/old-system.ts';

const NOW = '2026-11-19T10:00:00.000Z';

/** Light = top-level :root; dark = anything inside `@media (prefers-color-scheme: dark)`; colours by `#`. */
const RULES: SystemTokenRules = {
  isLight: (ctx) => ctx.kind === 'root',
  isDark: (ctx) => ctx.kind === 'other' && ctx.label === '@media (prefers-color-scheme: dark)',
  classify: (_name, value) => (value.startsWith('#') ? 'colours' : value.endsWith('px') ? 'spacing' : 'other'),
  validate: (_section, _field, text) =>
    text.includes('url(') ? { ok: false, sentence: 'Not a value design systems use.' } : { ok: true, formula: /var\(|calc\(/.test(text) },
};

const state = (overrides: Partial<SystemState> = {}): SystemState => ({ ...parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW), ...overrides });

const source = (overrides: Partial<SystemDetailSource> = {}): SystemDetailSource => ({
  id: 'acme',
  dir: '/designs/_systems/acme',
  state: state(),
  systemJson: null,
  tokensCss: null,
  texts: {},
  files: [],
  build: null,
  ...overrides,
});

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('parseSystemJson', () => {
  test('a valid object keeps every key, unknown ones included', () => {
    const parsed = parseSystemJson('{"version":1,"tokens":{},"futureKey":{"x":1}}');
    assert.equal(parsed.unreadable, null);
    assert.deepEqual(parsed.raw, { version: 1, tokens: {}, futureKey: { x: 1 } });
    assert.deepEqual(parsed.problems, []);
  });

  test('not JSON, a list, a BOM-only file and a string all read as unreadable with the sentence', () => {
    for (const text of ['{', '[1,2]', '"text"', '', 'null']) {
      const parsed = parseSystemJson(text);
      assert.equal(parsed.raw, null, text);
      assert.equal(parsed.unreadable, "Design Chamber can't read this design system. system.json isn't valid JSON.", text);
    }
  });

  test('a leading BOM is allowed', () => {
    assert.deepEqual(parseSystemJson('\uFEFF{"version":1}').raw, { version: 1 });
  });

  test('over 1 MiB (counted in UTF-8 bytes) is unreadable, never parsed', () => {
    const big = `{"pad":"${'é'.repeat(600_000)}"}`; // 1.2 MB in UTF-8, 600 k characters
    assert.equal(parseSystemJson(big).unreadable, "Design Chamber can't read this design system. system.json is larger than 1 MB.");
  });

  test('wrong-typed lists are named problems, not fatal', () => {
    const parsed = parseSystemJson('{"type":{},"components":"x","tokens":[]}');
    assert.notEqual(parsed.raw, null);
    assert.deepEqual(parsed.problems.map((problem) => problem.entry).sort(), ['components', 'tokens', 'type']);
  });

  test('a __proto__ key is an ordinary key: it never changes the prototype and is never read as tokens', () => {
    const parsed = parseSystemJson('{"__proto__":{"tokens":{"--x":{}}},"tokens":{"__proto__":{"note":"x"}}}');
    assert.notEqual(parsed.raw, null);
    assert.equal(Object.getPrototypeOf(parsed.raw), Object.prototype);
    const detail = buildSystemDetail(source({ systemJson: '{"__proto__":{"tokens":{"--x":{}}},"tokens":{"__proto__":{"note":"x"}}}' }), RULES);
    assert.deepEqual(detail.tokens, []);
    assert.ok(detail.problems.some((problem) => problem.entry === 'tokens.__proto__'));
  });
});

describe('parseSystemState', () => {
  test('missing or broken: provisional (name from the id, Draft, revision 0)', () => {
    for (const raw of [null, 'x', [], 42]) {
      const parsed = parseSystemState(raw, 'acme-shop', NOW);
      assert.equal(parsed.name, 'Acme shop');
      assert.equal(parsed.status, 'draft');
      assert.equal(parsed.revision.n, 0);
      assert.equal(parsed.created, NOW);
      assert.deepEqual(parsed.review, {});
    }
  });

  test('keeps valid fields, drops garbage per field', () => {
    const fingerprint = 'a'.repeat(64);
    const parsed = parseSystemState(
      {
        name: 'Acme',
        status: 'ready',
        sessionId: 'ses_1',
        created: NOW,
        updated: NOW,
        revision: { n: 3, treeHash: 'b'.repeat(64), at: NOW },
        review: { colours: { state: 'looks-good', fingerprint, at: NOW }, typography: { state: 'bogus', fingerprint, at: NOW }, nope: {} },
        readyFingerprints: { colours: fingerprint, spacing: 'short' },
        handEditsSeq: -1,
        home: { kind: 'repo', directory: '/abs/shop', folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: NOW },
      },
      'acme',
      NOW,
    );
    assert.equal(parsed.name, 'Acme');
    assert.equal(parsed.status, 'ready');
    assert.equal(parsed.revision.n, 3);
    assert.deepEqual(Object.keys(parsed.review), ['colours']);
    assert.deepEqual(parsed.readyFingerprints, { colours: fingerprint });
    assert.equal(parsed.handEditsSeq, 0);
    assert.equal(parsed.home?.kind, 'repo');
  });

  test('sources.code keeps the scan\'s forAgent list; an older state without it parses unchanged', () => {
    const code = { directory: '/abs/shop', lastScan: NOW, partial: false, scanned: ['src/a.css'] };
    assert.deepEqual(parseSystemState({ sources: { code } }, 'acme', NOW).sources.code, code);
    const forAgent = [{ path: 'tailwind.config.js', why: 'Tailwind config' }, { path: '', why: 'empty path' }, { path: 'x.ts' }, 'junk'];
    assert.deepEqual(parseSystemState({ sources: { code: { ...code, forAgent } } }, 'acme', NOW).sources.code?.forAgent, [{ path: 'tailwind.config.js', why: 'Tailwind config' }]);
    const many = Array.from({ length: 30 }, (_, n) => ({ path: `f${n}.js`, why: 'js' }));
    assert.equal(parseSystemState({ sources: { code: { ...code, forAgent: many } } }, 'acme', NOW).sources.code?.forAgent?.length, 20);
    assert.equal(parseSystemState({ sources: { code: { ...code, forAgent: 'nope' } } }, 'acme', NOW).sources.code?.forAgent, undefined);
  });

  test('a name with a line break or over 60 characters falls back to the humanised id', () => {
    assert.equal(parseSystemState({ name: 'a\nb' }, 'acme', NOW).name, 'Acme');
    assert.equal(parseSystemState({ name: 'x'.repeat(61) }, 'acme', NOW).name, 'Acme');
  });

  test('humaniseSystemId', () => {
    assert.equal(humaniseSystemId('acme'), 'Acme');
    assert.equal(humaniseSystemId('my-brand-2'), 'My brand 2');
  });
});

describe('reserved ids', () => {
  test('none and ask are reserved, in any case', () => {
    for (const id of ['none', 'ask', 'NONE', 'Ask']) assert.equal(isReservedSystemId(id), true, id);
    for (const id of ['acme', 'none-2', 'asking']) assert.equal(isReservedSystemId(id), false, id);
  });
});

describe('coveredAreas', () => {
  test('absent: all four', () => assert.deepEqual(coveredAreas({}), { areas: ['foundations', 'components', 'patterns', 'brand'], problem: null }));
  test('a valid subset keeps board order', () => assert.deepEqual(coveredAreas({ coverage: ['brand', 'foundations'] }).areas, ['foundations', 'brand']));
  test('invalid (empty, unknown, duplicate, not a list): all four with the sentence', () => {
    for (const coverage of [[], ['colour'], ['brand', 'brand'], 'brand']) {
      const read = coveredAreas({ coverage });
      assert.equal(read.areas.length, 4);
      assert.equal(read.problem, "coverage in system.json can't be read, so all four areas are shown.");
    }
  });
});

describe('coverage areas in the detail (S8, AD-22)', () => {
  // A system written before S8: none of coverage, patterns, brand.
  const OLD_JSON = {
    version: 1,
    tokens: { '--brand-500': { section: 'colours', group: 'brand', note: 'Primary.' } },
    type: [{ id: 'body', name: 'Body', size: '16px' }],
    logos: [{ file: 'assets/logos/a.svg', variant: 'mark' }],
    notes: [{ id: 'history', title: 'History' }],
  };
  const oldSource = (json: Record<string, unknown>): SystemDetailSource =>
    source({
      systemJson: JSON.stringify(json),
      tokensCss: ':root {\n  --brand-500: #111111;\n}\n',
      texts: { 'notes/history.md': 'Why.' },
      files: [{ rel: 'assets/logos/a.svg', bytes: 3 }],
    });

  test('a system without coverage, patterns or brand reads exactly as one listing all four areas and empty lists', () => {
    const old = buildSystemDetail(oldSource(OLD_JSON), RULES);
    const explicit = buildSystemDetail(oldSource({ ...OLD_JSON, coverage: ['foundations', 'components', 'patterns', 'brand'], patterns: [], brand: [] }), RULES);
    assert.deepEqual(old.coverage, ['foundations', 'components', 'patterns', 'brand']);
    assert.deepEqual(old.patterns, []);
    assert.deepEqual(old.brand, []);
    assert.deepEqual(old.problems, []);
    // Everything but the system.json stamp (its bytes differ) is the same, byte for byte.
    const strip = (detail: ReturnType<typeof buildSystemDetail>) => JSON.stringify({ ...detail, stamps: { ...detail.stamps, systemJson: null } });
    assert.equal(strip(old), strip(explicit));
    assert.deepEqual(sectionFingerprints(old), sectionFingerprints(explicit));
  });

  test('invalid coverage is dropped with a problem and all four areas show', () => {
    for (const coverage of [[], ['typography'], ['brand', 'brand'], 'brand', ['foundations', 'components', 'patterns', 'brand', 'extra']]) {
      const detail = buildSystemDetail(source({ systemJson: JSON.stringify({ coverage }) }), RULES);
      assert.deepEqual(detail.coverage, ['foundations', 'components', 'patterns', 'brand'], JSON.stringify(coverage));
      assert.deepEqual(detail.problems, [{ entry: 'coverage', message: "coverage in system.json can't be read, so all four areas are shown." }]);
    }
  });

  test('patterns and brand hold up to 100 entries each; the rest are problems', () => {
    const many = (prefix: string, kind: string) => Array.from({ length: 101 }, (_, k) => ({ id: `${prefix}-${k}`, kind, title: `Entry ${k}` }));
    const detail = buildSystemDetail(source({ systemJson: JSON.stringify({ patterns: many('p', 'layout'), brand: many('b', 'imagery') }) }), RULES);
    assert.equal(detail.patterns.length, 100);
    assert.equal(detail.brand.length, 100);
    assert.deepEqual(detail.problems.map((problem) => problem.entry), ['patterns.p-100', 'brand.b-100']);
  });

  test('entry rules: unique id, kind from its list (absent is other), title 1..80, note up to 500', () => {
    const systemJson = JSON.stringify({
      patterns: [
        { id: 'a', title: 'No kind' },
        { id: 'a', kind: 'layout', title: 'Duplicate' },
        { id: 'b', kind: 'marketing', title: 'Brand kind in patterns' },
        { id: 'c', kind: 'voice', title: '' },
        { id: 'd', kind: 'voice', title: 'Long note', note: 'x'.repeat(501) },
        { id: 'Bad', kind: 'voice', title: 'Bad id' },
      ],
      brand: [{ id: 'logo-use', kind: 'logo-use', title: 'Clear space' }],
    });
    const detail = buildSystemDetail(source({ systemJson }), RULES);
    assert.deepEqual(detail.patterns.map((entry) => [entry.id, entry.kind]), [['a', 'other']]);
    assert.deepEqual(detail.brand.map((entry) => entry.id), ['logo-use']);
    assert.equal(detail.problems.length, 5);
  });

  test('fingerprints per section: a pattern body moves patterns only; a brand entry or a logo moves brand only; a font moves assets only', () => {
    const json = { patterns: [{ id: 'voice', kind: 'voice', title: 'Voice' }], brand: [{ id: 'hero', kind: 'marketing', title: 'Heroes' }], logos: [{ file: 'assets/logos/a.svg' }], fonts: [{ file: 'assets/fonts/a.woff2', family: 'A', weight: 400 }] };
    const files = [{ rel: 'assets/logos/a.svg', bytes: 3 }, { rel: 'assets/fonts/a.woff2', bytes: 3 }];
    const of = (overrides: Partial<SystemDetailSource>, hashes: Record<string, string> = {}) =>
      sectionFingerprints(buildSystemDetail(source({ systemJson: JSON.stringify(json), files, texts: { 'patterns/voice.md': 'Plain.' }, ...overrides }), RULES), hashes);
    const changed = (one: Record<string, string>, two: Record<string, string>) => SYSTEM_SECTIONS.filter((section) => one[section] !== two[section]);
    const base = of({});
    assert.deepEqual(changed(base, of({ texts: { 'patterns/voice.md': 'Short.' } })), ['patterns']);
    assert.deepEqual(changed(base, of({ texts: { 'patterns/voice.md': 'Plain.', 'brand/hero.md': 'Daylight.' } })), ['brand']);
    assert.deepEqual(changed(base, of({ systemJson: JSON.stringify({ ...json, brand: [{ id: 'hero', kind: 'imagery', title: 'Heroes' }] }) })), ['brand']);
    assert.deepEqual(changed(base, of({}, { 'assets/fonts/a.woff2': '1'.repeat(64) })), ['assets']);
  });

  test('Ready with a change only in an uncovered section still has changes to review only where fingerprints moved', () => {
    const json = { coverage: ['foundations'], patterns: [{ id: 'voice', kind: 'voice', title: 'Voice' }] };
    const before = sectionFingerprints(buildSystemDetail(source({ systemJson: JSON.stringify(json) }), RULES));
    const ready = state({ status: 'ready', readyFingerprints: before });
    const after = sectionFingerprints(buildSystemDetail(source({ systemJson: JSON.stringify(json), texts: { 'patterns/voice.md': 'New.' } }), RULES));
    assert.deepEqual(SYSTEM_SECTIONS.filter((section) => before[section] !== after[section]), ['patterns']);
    assert.equal(deriveReview(ready, after).changesToReview, true);
  });
});

describe('buildSystemDetail', () => {
  const css = [
    ':root {',
    '  --brand-500: #1a73e8;',
    '  --space-4: 16px;',
    '  --brand-500: #1a73e9;',
    '  --link: url(x.png);',
    '  --mix: var(--brand-500);',
    '  --odd: 1 !important;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root { --brand-500: #8ab4f8; --dark-only: #000; }',
    '}',
    '.card { --brand-500: red; }',
  ].join('\n');

  test('light is the last top-level :root value, dark the dark block, other contexts are listed', () => {
    const detail = buildSystemDetail(source({ tokensCss: css }), RULES);
    const brand = detail.tokens.find((token) => token.name === '--brand-500');
    assert.equal(brand?.light?.text, '#1a73e9');
    assert.equal(brand?.dark?.text, '#8ab4f8');
    assert.deepEqual(brand?.alsoSet, ['.card']);
    assert.equal(brand?.section, 'colours');
    assert.equal(brand?.group, 'other');
    assert.equal(detail.tokens.find((token) => token.name === '--space-4')?.section, 'spacing');
  });

  test('refused, formula and unreadable values say why; a dark-only token says so', () => {
    const detail = buildSystemDetail(source({ tokensCss: css }), RULES);
    const by = (name: string) => detail.tokens.find((token) => token.name === name);
    assert.deepEqual(by('--link')?.light, { text: 'url(x.png)', editable: 'unreadable', problem: 'Not a value design systems use.' });
    assert.equal(by('--mix')?.light?.editable, 'formula');
    assert.equal(by('--mix')?.light?.problem, 'This value is a formula. Ask the agent to change it.');
    assert.equal(by('--odd')?.light?.editable, 'unreadable');
    assert.equal(by('--dark-only')?.light, null);
    assert.equal(by('--dark-only')?.problem, 'Only a dark value is set.');
  });

  test('metadata sets section, group and note; metadata without a value is kept with the sentence', () => {
    const systemJson = JSON.stringify({ tokens: { '--brand-500': { section: 'colours', group: 'brand', note: 'Primary actions.' }, '--ghost': { note: 'Gone.' } } });
    const detail = buildSystemDetail(source({ tokensCss: css, systemJson }), RULES);
    const brand = detail.tokens.find((token) => token.name === '--brand-500');
    assert.equal(brand?.group, 'brand');
    assert.equal(brand?.note, 'Primary actions.');
    const ghost = detail.tokens.find((token) => token.name === '--ghost');
    assert.equal(ghost?.problem, 'No value for --ghost in tokens.css.');
    assert.equal(ghost?.light, null);
  });

  test('provenance marks tokens from code', () => {
    const detail = buildSystemDetail(source({ tokensCss: css, state: state({ provenance: { '--space-4': { file: 'a.css', line: 1, light: '16px', dark: null } } }) }), RULES);
    assert.equal(detail.tokens.find((token) => token.name === '--space-4')?.fromCode, true);
    assert.equal(detail.tokens.find((token) => token.name === '--brand-500')?.fromCode, false);
  });

  test('over 2 000 declarations: the rest are not read, with the sentence', () => {
    const many = `:root {\n${Array.from({ length: 2005 }, (_, i) => `  --t-${i}: ${i}px;`).join('\n')}\n}`;
    const detail = buildSystemDetail(source({ tokensCss: many }), RULES);
    assert.equal(detail.tokens.length, 2000);
    assert.ok(detail.problems.some((problem) => problem.message === "Design systems hold up to 2 000 tokens. The rest weren't read."));
  });

  test('invalid entries are dropped with a problem each; valid ones stay', () => {
    const systemJson = JSON.stringify({
      type: [{ id: 'body', name: 'Body', size: '16px' }, { id: 'Bad Id', name: 'x' }, { id: 'body', name: 'Dup' }, { id: 'link', name: 'Link', family: 'url(x)' }],
      fonts: [{ file: 'assets/fonts/inter.woff2', family: 'Inter', weight: 400 }, { file: '../etc/passwd', family: 'X' }, { file: 'assets/fonts/missing.woff2', family: 'Y' }],
      logos: [{ file: 'assets/logos/acme.svg' }, { file: 'assets/logos/acme.svg', variant: 'NOT OK' }],
      sources: [{ file: 'sources/brand.pdf' }],
      components: [
        { id: 'button', name: 'Button', tokens: ['--brand-500', '--nope'], example: 'components/button.html' },
        { id: 'card', name: 'Card', example: 'components/other.html' },
        { id: 'x', name: 'X', tokens: ['not-a-token'] },
      ],
      notes: [{ id: 'history', title: 'History' }, { id: 'gone', title: 'Gone' }, { id: 'x' }],
    });
    const detail = buildSystemDetail(
      source({
        tokensCss: css,
        systemJson,
        files: [
          { rel: 'assets/fonts/inter.woff2', bytes: 10 },
          { rel: 'assets/logos/acme.svg', bytes: 5 },
          { rel: 'sources/brand.pdf', bytes: 99 },
          { rel: 'components/button.html', bytes: 20 },
          { rel: 'notes/history.md', bytes: 4 },
        ],
        texts: { 'notes/history.md': 'Why.' },
      }),
      RULES,
    );
    assert.deepEqual(detail.type.map((style) => style.id), ['body', 'link']);
    assert.equal(detail.type.find((style) => style.id === 'link')?.family, '');
    assert.deepEqual(detail.fonts.map((font) => font.file), ['assets/fonts/inter.woff2']);
    assert.deepEqual(detail.logos, [{ file: 'assets/logos/acme.svg', variant: 'primary', note: '' }]);
    assert.deepEqual(detail.sourceFiles, [{ file: 'sources/brand.pdf', bytes: 99 }]);
    const button = detail.components.find((component) => component.id === 'button');
    assert.deepEqual(button?.undefinedTokens, ['--nope']);
    assert.deepEqual(button?.example, { remote: [] });
    assert.equal(detail.components.find((component) => component.id === 'card')?.example, null);
    assert.equal(detail.components.some((component) => component.id === 'x'), false);
    assert.deepEqual(
      detail.notes.map((note) => [note.id, note.text, note.problem]),
      [
        ['history', 'Why.', null],
        ['gone', '', 'notes/gone.md is missing.'],
      ],
    );
    assert.ok(detail.problems.length >= 9, JSON.stringify(detail.problems));
    assert.equal(detail.unreadable, null);
  });

  test('unreadable system.json: the whole-system sentence, tokens.css still shows', () => {
    const detail = buildSystemDetail(source({ tokensCss: css, systemJson: '{oops' }), RULES);
    assert.equal(detail.unreadable, "Design Chamber can't read this design system. system.json isn't valid JSON.");
    assert.ok(detail.tokens.length > 0);
  });

  test('a system.json the store found too large is unreadable without being read', () => {
    const detail = buildSystemDetail(source({ systemJson: null, tooLarge: ['system.json'] }), RULES);
    assert.equal(detail.unreadable, "Design Chamber can't read this design system. system.json is larger than 1 MB.");
  });

  test('empty: no files at all, or only empty seeds', () => {
    assert.equal(buildSystemDetail(source(), RULES).empty, true);
    assert.equal(buildSystemDetail(source({ tokensCss: ':root {\n}\n', systemJson: '{"version":1,"tokens":{}}' }), RULES).empty, true);
    assert.equal(buildSystemDetail(source({ texts: { 'OVERVIEW.md': '  \n' } }), RULES).empty, true);
    assert.equal(buildSystemDetail(source({ texts: { 'OVERVIEW.md': 'Calm and plain.' } }), RULES).empty, false);
    assert.equal(buildSystemDetail(source({ tokensCss: css }), RULES).empty, false);
  });

  test('an overview over 4 000 characters shows its start with the sentence', () => {
    const detail = buildSystemDetail(source({ texts: { 'OVERVIEW.md': 'x'.repeat(4100) } }), RULES);
    assert.equal(detail.overview?.text.length, 4000);
    assert.equal(detail.overview?.problem, 'OVERVIEW.md is longer than 4 000 characters. Only the start is shown.');
  });

  test('stamps are the raw-byte hashes the store passes, else the text hash, null when absent', () => {
    const detail = buildSystemDetail(source({ tokensCss: ':root{}', hashes: { 'tokens.css': 'f'.repeat(64) }, systemJson: '{}' }), RULES);
    assert.equal(detail.stamps.tokens, 'f'.repeat(64));
    assert.equal(detail.stamps.systemJson, sha('{}'));
    assert.equal(detail.stamps.overview, null);
  });

  test('patterns and brand entries read with their bodies as text', () => {
    const systemJson = JSON.stringify({
      patterns: [{ id: 'voice', kind: 'voice', title: 'Voice', note: 'Plain.' }, { id: 'bad', kind: 'nope', title: 'X' }],
      brand: [{ id: 'hero', kind: 'marketing', title: 'Heroes' }],
    });
    const detail = buildSystemDetail(source({ systemJson, texts: { 'patterns/voice.md': '<b>not markup</b>' } }), RULES);
    assert.deepEqual(detail.patterns, [{ id: 'voice', kind: 'voice', title: 'Voice', note: 'Plain.', text: '<b>not markup</b>', problem: null, layout: null, example: null }]);
    assert.deepEqual(detail.brand.map((entry) => [entry.id, entry.text]), [['hero', null]]);
  });

  test('an internal home is editable; the detail starts with every section Not reviewed', () => {
    const detail = buildSystemDetail(source(), RULES);
    assert.deepEqual(detail.home, { kind: 'internal' });
    assert.equal(detail.editable, true);
    for (const section of SYSTEM_SECTIONS) assert.equal(detail.review[section].state, 'not-reviewed');
  });
});

describe('sectionFingerprints and deriveReview', () => {
  const css = ':root {\n  --brand-500: #111111;\n  --space-4: 16px;\n}\n';
  const base = (): SystemDetailSource => source({ tokensCss: css, systemJson: JSON.stringify({ type: [{ id: 'body', name: 'Body', size: '16px' }] }) });

  test('a change touches only its own section', () => {
    const before = sectionFingerprints(buildSystemDetail(base(), RULES));
    const colourChanged = sectionFingerprints(buildSystemDetail({ ...base(), tokensCss: css.replace('#111111', '#222222') }, RULES));
    const changed = SYSTEM_SECTIONS.filter((section) => before[section] !== colourChanged[section]);
    assert.deepEqual(changed, ['colours']);
    const typeChanged = sectionFingerprints(buildSystemDetail({ ...base(), systemJson: JSON.stringify({ type: [{ id: 'body', name: 'Body text', size: '16px' }] }) }, RULES));
    assert.deepEqual(SYSTEM_SECTIONS.filter((section) => before[section] !== typeChanged[section]), ['typography']);
  });

  test('declaration order in tokens.css does not change a fingerprint', () => {
    const swapped = ':root {\n  --space-4: 16px;\n  --brand-500: #111111;\n}\n';
    assert.deepEqual(sectionFingerprints(buildSystemDetail(base(), RULES)), sectionFingerprints(buildSystemDetail({ ...base(), tokensCss: swapped }, RULES)));
  });

  test('a logo file changing its bytes changes the brand fingerprint only', () => {
    const withLogo = (hash: string): SystemDetailSource => ({
      ...base(),
      systemJson: JSON.stringify({ logos: [{ file: 'assets/logos/a.svg' }] }),
      files: [{ rel: 'assets/logos/a.svg', bytes: 3 }],
      hashes: { 'assets/logos/a.svg': hash },
    });
    const one = sectionFingerprints(buildSystemDetail(withLogo('1'.repeat(64)), RULES), { 'assets/logos/a.svg': '1'.repeat(64) });
    const two = sectionFingerprints(buildSystemDetail(withLogo('2'.repeat(64)), RULES), { 'assets/logos/a.svg': '2'.repeat(64) });
    assert.deepEqual(SYSTEM_SECTIONS.filter((section) => one[section] !== two[section]), ['brand']);
  });

  test('a recorded review shows only while its fingerprint matches; Ready with a changed section has changes to review', () => {
    const fingerprints = sectionFingerprints(buildSystemDetail(base(), RULES));
    const reviewed = state({
      status: 'ready',
      review: { colours: { state: 'looks-good', fingerprint: fingerprints.colours, at: NOW }, spacing: { state: 'needs-work', fingerprint: 'e'.repeat(64), at: NOW, note: 'Tighter.' } },
      readyFingerprints: { ...fingerprints },
    });
    const same = deriveReview(reviewed, fingerprints);
    assert.deepEqual(same.review.colours, { state: 'looks-good', note: null });
    assert.deepEqual(same.review.spacing, { state: 'not-reviewed', note: null });
    assert.equal(same.changesToReview, false);

    const changed = { ...fingerprints, colours: '9'.repeat(64) };
    const after = deriveReview(reviewed, changed);
    assert.deepEqual(after.review.colours, { state: 'not-reviewed', note: null });
    assert.equal(after.changesToReview, true);
    assert.equal(deriveReview({ ...reviewed, status: 'draft' }, changed).changesToReview, false);
  });

  test('the note of a matching review travels with it', () => {
    const fingerprints = sectionFingerprints(buildSystemDetail(base(), RULES));
    const read = deriveReview(state({ review: { spacing: { state: 'needs-work', fingerprint: fingerprints.spacing, at: NOW, note: 'Tighter.' } } }), fingerprints);
    assert.deepEqual(read.review.spacing, { state: 'needs-work', note: 'Tighter.' });
  });
});

describe('safeAssetName', () => {
  test('base name only, unsafe characters become dashes, extension lower-cased', () => {
    assert.equal(safeAssetName('C:\\Users\\me\\Brand Logo (final).SVG', []), 'Brand Logo -final.svg');
    assert.equal(safeAssetName('../../etc/passwd', []), 'passwd');
    assert.equal(safeAssetName('fonts/Inter–Bold.woff2', []), 'Inter-Bold.woff2');
  });

  test('no leading dot or dash, no trailing dot or space', () => {
    assert.equal(safeAssetName('.htaccess', []), 'htaccess');
    assert.equal(safeAssetName('--x.png', []), 'x.png');
    assert.equal(safeAssetName('name. ', []), 'name');
    assert.equal(safeAssetName('...', []), 'file');
  });

  test('Windows device stems get -file', () => {
    assert.equal(safeAssetName('CON.png', []), 'CON-file.png');
    assert.equal(safeAssetName('nul', []), 'nul-file');
    assert.equal(safeAssetName('com1.tar.gz', []), 'com1.tar-file.gz');
    assert.equal(safeAssetName('console.png', []), 'console.png');
  });

  test('a clash ignoring case gets -2, -3 …', () => {
    assert.equal(safeAssetName('Logo.svg', ['logo.svg']), 'Logo-2.svg');
    assert.equal(safeAssetName('logo.svg', ['logo.svg', 'LOGO-2.svg']), 'logo-3.svg');
  });

  test('at most 80 characters, the extension kept', () => {
    const name = safeAssetName(`${'a'.repeat(200)}.woff2`, []);
    assert.equal(name.length, 80);
    assert.ok(name.endsWith('.woff2'));
  });

  test('NFKC folds compatibility characters before the alphabet check', () => {
    assert.equal(safeAssetName('ｌｏｇｏ.png', []), 'logo.png');
  });
});

describe('Phase 2.6 AD-9: sources.code project and existing', () => {
  const code = (extra: Record<string, unknown>) => ({ sources: { code: { directory: '/code/shop/design-system', lastScan: NOW, partial: false, scanned: [], ...extra } } });

  test('they read back as written and reach the source line; older state reads as before', () => {
    const read = { page: ['design-system/index.html'], docs: ['design-system/OVERVIEW.md'], components: [] };
    const parsed = parseSystemState(code({ project: '/code/shop', existing: { location: 'design-system', marks: ['contract', 'page'], read } }), 'acme', NOW);
    assert.equal(parsed.sources.code?.project, '/code/shop');
    assert.deepEqual(parsed.sources.code?.existing, { location: 'design-system', marks: ['contract', 'page'], read });
    assert.deepEqual(sourceLineOf(parsed).code, { directory: '/code/shop/design-system', lastScan: NOW, partial: false, project: '/code/shop', existing: { location: 'design-system' } });
    const old = parseSystemState(code({}), 'acme', NOW);
    assert.ok(old.sources.code !== null && !('project' in old.sources.code) && !('existing' in old.sources.code));
    assert.deepEqual(sourceLineOf(old).code, { directory: '/code/shop/design-system', lastScan: NOW, partial: false });
  });

  test('forged values are dropped: a relative or UNC project, a climbing or absolute location, unknown marks, long lists', () => {
    for (const project of ['code/shop', '\\\\server\\share', 42]) {
      assert.equal(parseSystemState(code({ project }), 'acme', NOW).sources.code?.project, undefined, JSON.stringify(project));
    }
    for (const location of ['../etc', '/etc', 'C:/x', 'a\\b', 'a\nb', 7]) {
      assert.equal(parseSystemState(code({ existing: { location, marks: [], read: {} } }), 'acme', NOW).sources.code?.existing, undefined, JSON.stringify(location));
    }
    const many = Array.from({ length: 30 }, (_, n) => `ds/c${n}.html`);
    const parsed = parseSystemState(code({ existing: { location: 'ds', marks: ['page', 'evil', 'tokens'], read: { page: ['../x', 'ds/index.html'], docs: 'nope', components: many } } }), 'acme', NOW);
    assert.deepEqual(parsed.sources.code?.existing?.marks, ['page', 'tokens']);
    assert.deepEqual(parsed.sources.code?.existing?.read.page, ['ds/index.html']);
    assert.deepEqual(parsed.sources.code?.existing?.read.docs, []);
    assert.equal(parsed.sources.code?.existing?.read.components.length, 20);
  });
});

describe('board layout hints (system-board-layout-and-visual-check.md §A)', () => {
  const sink = (): LayoutIgnoredSink => ({ ignored: [], ignoredCount: 0 });

  test('the closed set and the per-section lists', () => {
    assert.deepEqual(BOARD_LAYOUTS, ['card', 'compact', 'full', 'table']);
    assert.ok(isBoardLayout('compact') && !isBoardLayout('wide') && !isBoardLayout('') && !isBoardLayout(7));
    assert.deepEqual(LAYOUTS_OF_SECTION.components, ['card', 'compact', 'full', 'table']);
    assert.deepEqual(LAYOUTS_OF_SECTION.colours, ['card', 'compact', 'table']);
    for (const section of ['typography', 'layers', 'assets'] as const) assert.equal(LAYOUTS_OF_SECTION[section], undefined, section);
  });

  test('readItemLayout: absent or null reads as not set; a valid value reads as itself', () => {
    const s = sink();
    assert.equal(readItemLayout(undefined, 'components.button', s), null);
    assert.equal(readItemLayout(null, 'components.button', s), null);
    assert.equal(readItemLayout('full', 'components.button', s), 'full');
    assert.deepEqual(s, { ignored: [], ignoredCount: 0 });
  });

  test('readItemLayout: unknown word, number, over 16 chars and control characters are ignored with a cleaned value', () => {
    const s = sink();
    assert.equal(readItemLayout('wide', 'components.table', s), null);
    assert.equal(readItemLayout(42, 'components.num', s), null);
    assert.equal(readItemLayout('x'.repeat(17), 'components.long', s), null);
    assert.equal(readItemLayout('ca\trd\n', 'components.ctrl', s), null);
    assert.equal(readItemLayout(true, 'components.bool', s), null);
    assert.equal(readItemLayout({ layout: 'card' }, 'components.obj', s), null);
    assert.equal(readItemLayout(['card'], 'components.arr', s), null);
    assert.deepEqual(s.ignored, [
      { entry: 'components.table', value: 'wide', reason: 'unknown' },
      { entry: 'components.num', value: 'number', reason: 'unknown' },
      { entry: 'components.long', value: `${'x'.repeat(15)}…`, reason: 'unknown' },
      { entry: 'components.ctrl', value: 'ca rd', reason: 'unknown' },
      { entry: 'components.bool', value: 'boolean', reason: 'unknown' },
      { entry: 'components.obj', value: 'object', reason: 'unknown' },
      { entry: 'components.arr', value: 'array', reason: 'unknown' },
    ]);
    assert.equal(s.ignoredCount, 7);
  });

  test('readSectionLayouts: valid defaults read; absent reads as {}', () => {
    const s = sink();
    assert.deepEqual(readSectionLayouts(null, s), {});
    assert.deepEqual(readSectionLayouts({ version: 1 }, s), {});
    assert.deepEqual(readSectionLayouts({ layout: { components: 'compact', colours: 'table', overview: 'full' } }, s), { components: 'compact', colours: 'table', overview: 'full' });
    assert.deepEqual(s, { ignored: [], ignoredCount: 0 });
  });

  test('readSectionLayouts: not an object, unknown keys, misplaced and unknown values', () => {
    const s = sink();
    assert.deepEqual(readSectionLayouts({ layout: 'compact' }, s), {});
    assert.deepEqual(readSectionLayouts({ layout: { typography: 'card', layers: 'table', assets: 'full', colours: 'full', nope: 'card', components: 'banana', spacing: 3 } }, s), {});
    assert.deepEqual(s.ignored, [
      { entry: 'layout', value: 'compact', reason: 'unknown' },
      { entry: 'layout.typography', value: 'card', reason: 'not-here' },
      { entry: 'layout.layers', value: 'table', reason: 'not-here' },
      { entry: 'layout.assets', value: 'full', reason: 'not-here' },
      { entry: 'layout.colours', value: 'full', reason: 'not-here' },
      { entry: 'layout.nope', value: 'card', reason: 'unknown' },
      { entry: 'layout.components', value: 'banana', reason: 'unknown' },
      { entry: 'layout.spacing', value: 'number', reason: 'unknown' },
    ]);
    assert.equal(s.ignoredCount, 8);
  });

  test('readSectionLayouts: notes is another name for the overview default; an explicit overview wins', () => {
    const s = sink();
    assert.deepEqual(readSectionLayouts({ layout: { notes: 'full' } }, s), { overview: 'full' });
    assert.deepEqual(readSectionLayouts({ layout: { notes: 'full', overview: 'table' } }, s), { overview: 'table' });
    assert.deepEqual(readSectionLayouts({ layout: { overview: 'table', notes: 'full' } }, s), { overview: 'table' });
    assert.deepEqual(s.ignored, [], 'a superseded alias is not a problem');
    // A bad notes value is reported under the name the agent wrote.
    assert.deepEqual(readSectionLayouts({ layout: { notes: 'huge' } }, s), {});
    assert.deepEqual(s.ignored, [{ entry: 'layout.notes', value: 'huge', reason: 'unknown' }]);
  });

  test('layoutPlaceTakes: what each place takes, for the warning', () => {
    assert.equal(layoutPlaceTakes('layout.typography'), 'typography takes no layout');
    assert.equal(layoutPlaceTakes('layout.colours'), 'takes card, compact or table');
    assert.equal(layoutPlaceTakes('layout.notes'), 'takes card, compact, full or table');
    assert.equal(layoutPlaceTakes('layout.components'), 'takes card, compact, full or table');
    assert.equal(layoutPlaceTakes('layout.nope'), 'not a section that takes a layout');
    assert.equal(layoutPlaceTakes('layout.__proto__'), 'not a section that takes a layout');
    assert.equal(layoutPlaceTakes('layout'), 'layout must be an object of section defaults');
    assert.equal(layoutPlaceTakes('components.table'), 'takes card, compact, full or table');
    assert.equal(layoutPlaceTakes('patterns[3]'), 'takes card, compact, full or table');
  });

  test('readSectionLayouts: a __proto__ key is an ordinary ignored key, and a long key is clipped to 40', () => {
    const s = sink();
    const raw = JSON.parse(`{"layout":{"__proto__":"card","${'k'.repeat(60)}":"card"}}`) as JsonObject;
    assert.deepEqual(readSectionLayouts(raw, s), {});
    assert.equal(Object.getPrototypeOf(raw), Object.prototype);
    assert.deepEqual(s.ignored.map((record) => record.entry), ['layout.__proto__', `layout.${'k'.repeat(40)}`]);
    assert.ok(s.ignored.every((record) => record.reason === 'unknown'));
  });

  const layoutSource = (json: Record<string, unknown>): SystemDetailSource =>
    source({
      systemJson: JSON.stringify(json),
      texts: { 'notes/grid.md': 'Space things.', 'patterns/empty.md': 'One action.', 'brand/press.md': 'Daylight.' },
      files: [{ rel: 'components/button.html', bytes: 10 }],
    });

  test('the detail carries item hints, section defaults and the ignored list; a bad hint never drops its entry nor adds a problem', () => {
    const detail = buildSystemDetail(
      layoutSource({
        version: 1,
        layout: { components: 'compact', patterns: 'table' },
        components: [
          { id: 'button', name: 'Button', example: 'components/button.html' },
          { id: 'table', name: 'Table', layout: 'full' },
          { id: 'modal', name: 'Modal', layout: 'wide' },
        ],
        notes: [{ id: 'grid', title: 'Grid', layout: 'full' }],
        patterns: [{ id: 'empty', kind: 'do-dont', title: 'Empty states', layout: 'card' }],
        brand: [{ id: 'press', kind: 'marketing', title: 'Press', layout: 'bogus' }],
      }),
      RULES,
    );
    assert.deepEqual(detail.components.map((component) => component.layout), [null, 'full', null]);
    assert.equal(detail.notes[0]?.layout, 'full');
    assert.equal(detail.patterns[0]?.layout, 'card');
    assert.equal(detail.brand[0]?.layout, null);
    assert.deepEqual(detail.boardLayout.sections, { components: 'compact', patterns: 'table' });
    assert.deepEqual(detail.boardLayout.ignored, [
      { entry: 'components.modal', value: 'wide', reason: 'unknown' },
      { entry: 'brand.press', value: 'bogus', reason: 'unknown' },
    ]);
    assert.equal(detail.boardLayout.ignoredCount, 2);
    assert.equal(detail.components.length, 3, 'the modal entry stays');
    assert.equal(detail.brand.length, 1, 'the press entry stays');
    assert.deepEqual(detail.problems, [], 'a bad hint is not an entry problem');
  });

  test('effective layout: the entry hint wins over the section default, which wins over card', () => {
    const detail = buildSystemDetail(layoutSource({ version: 1, layout: { components: 'compact' }, components: [{ id: 'button', name: 'Button', layout: 'full' }, { id: 'chip', name: 'Chip' }] }), RULES);
    assert.equal(effectiveLayout(detail, 'components', detail.components[0]?.layout ?? null), 'full');
    assert.equal(effectiveLayout(detail, 'components', detail.components[1]?.layout ?? null), 'compact');
    assert.equal(effectiveLayout(detail, 'patterns', null), 'card');
  });

  test('the ignored list caps at 20 with the true count', () => {
    const components = Array.from({ length: 30 }, (_, n) => ({ id: `c${n}`, name: `C${n}`, layout: 'wide' }));
    const detail = buildSystemDetail(layoutSource({ version: 1, components }), RULES);
    assert.equal(detail.boardLayout.ignored.length, 20);
    assert.equal(detail.boardLayout.ignoredCount, 30);
    assert.equal(detail.components.length, 30);
  });

  test('a layout-only change leaves every section fingerprint equal (reviews are not reset)', () => {
    const plain = {
      version: 1,
      components: [{ id: 'button', name: 'Button', example: 'components/button.html' }],
      notes: [{ id: 'grid', title: 'Grid' }],
      patterns: [{ id: 'empty', kind: 'do-dont', title: 'Empty states' }],
      brand: [{ id: 'press', kind: 'marketing', title: 'Press' }],
    };
    const hinted = {
      ...plain,
      layout: { components: 'compact', colours: 'table', overview: 'full', patterns: 'table', brand: 'compact' },
      components: [{ id: 'button', name: 'Button', example: 'components/button.html', layout: 'full' }],
      notes: [{ id: 'grid', title: 'Grid', layout: 'full' }],
      patterns: [{ id: 'empty', kind: 'do-dont', title: 'Empty states', layout: 'card' }],
      brand: [{ id: 'press', kind: 'marketing', title: 'Press', layout: 'table' }],
    };
    const before = sectionFingerprints(buildSystemDetail(layoutSource(plain), RULES));
    const after = sectionFingerprints(buildSystemDetail(layoutSource(hinted), RULES));
    assert.deepEqual(after, before);
  });

  test('an unreadable system.json carries no hints and no ignored records', () => {
    const detail = buildSystemDetail(source({ systemJson: '{ nope' }), RULES);
    assert.deepEqual(detail.boardLayout, { sections: {}, ignored: [], ignoredCount: 0 });
  });
});

describe('builder depth contract (system-builder-depth.md §4.3)', () => {
  const COLOURS = [
    ':root {',
    '  --accent: #2456d6;',
    '  --accent-fg: #ffffff;',
    '  --primary: #111111;',
    '  --on-primary: #eeeeee;',
    '  --lonely-fg: #000000;',
    '  --on-nothing: #000000;',
    '  --bg: #ffffff;',
    '  --fg: #222222;',
    '  --space-4: 16px;',
    '}',
  ].join('\n');
  const of = (json: Record<string, unknown>, overrides: Partial<SystemDetailSource> = {}) =>
    buildSystemDetail(source({ tokensCss: COLOURS, systemJson: JSON.stringify(json), ...overrides }), RULES);
  const changedSections = (one: Record<string, string>, two: Record<string, string>) => SYSTEM_SECTIONS.filter((section) => one[section] !== two[section]);

  test('an old system reads exactly as the 0.7.0 reader read it, plus empty new fields and only automatic pairs', () => {
    const before = JSON.parse(readFileSync(new URL('./fixtures/old-system-detail.json', import.meta.url), 'utf8')) as { detail: Record<string, unknown>; fingerprints: Record<string, string> };
    const detail = buildSystemDetail(oldSystemSource());
    assert.equal(detail.depth, null);
    assert.deepEqual(detail.outOfScope, []);
    assert.deepEqual(detail.problems, []);
    for (const component of detail.components) assert.deepEqual(component.sizes, []);
    for (const entry of [...detail.patterns, ...detail.brand]) assert.equal(entry.example, null);
    // The old fixture has on-colours, so its automatic pairs appear; nothing else is new.
    assert.deepEqual(detail.pairs, [
      { fg: '--accent-fg', bg: '--accent', use: 'text', note: '', auto: true },
      { fg: '--on-brand', bg: '--brand', use: 'text', note: '', auto: true },
    ]);
    const { depth: _depth, pairs: _pairs, outOfScope: _outOfScope, ...rest } = detail;
    const old = {
      ...rest,
      components: detail.components.map(({ sizes: _sizes, ...component }) => component),
      patterns: detail.patterns.map(({ example: _example, ...entry }) => entry),
      brand: detail.brand.map(({ example: _example, ...entry }) => entry),
    };
    assert.equal(JSON.stringify(old), JSON.stringify(before.detail));
    // Every fingerprint is the one 0.7.0 computed, so no review and no Ready system moves.
    assert.deepEqual(sectionFingerprints(detail, OLD_SYSTEM_HASHES), before.fingerprints);
  });

  test('depth: tokens, core and full read; absent is null; anything else is a problem on depth only', () => {
    for (const depth of ['tokens', 'core', 'full'] as const) assert.equal(of({ depth }).depth, depth);
    assert.equal(of({}).depth, null);
    assert.equal(of({ depth: null }).depth, null);
    for (const depth of ['huge', 'Full', 3, ['core'], {}]) {
      const detail = of({ depth, components: [{ id: 'button', name: 'Button' }] });
      assert.equal(detail.depth, null, JSON.stringify(depth));
      assert.deepEqual(detail.problems, [{ entry: 'depth', message: 'depth must be tokens, core or full, so the completeness check is off.' }]);
      assert.equal(detail.components.length, 1);
    }
  });

  test('component sizes read like variants; a bad list drops only that component', () => {
    const detail = of({
      components: [
        { id: 'button', name: 'Button', sizes: ['sm', 'md', 'lg'] },
        { id: 'chip', name: 'Chip', sizes: Array.from({ length: 11 }, (_, n) => `s${n}`) },
        { id: 'tag', name: 'Tag', sizes: 'md' },
        { id: 'pill', name: 'Pill', sizes: ['x'.repeat(41)] },
        { id: 'card', name: 'Card' },
      ],
    });
    assert.deepEqual(detail.components.map((component) => [component.id, component.sizes]), [['button', ['sm', 'md', 'lg']], ['card', []]]);
    assert.deepEqual(detail.problems.map((problem) => problem.entry), ['components.chip', 'components.tag', 'components.pill']);
    assert.ok(detail.problems.every((problem) => problem.message === 'Sizes is a list of up to 10 short names.'));
  });

  test('the new pattern and brand kinds read; a brand kind in patterns is still refused', () => {
    const patternKinds = ['navigation', 'overlay', 'forms', 'data-display', 'feedback', 'states', 'page', 'responsive', 'motion', 'accessibility'];
    const brandKinds = ['colour', 'social', 'email'];
    const detail = of({
      patterns: [...patternKinds.map((kind) => ({ id: kind, kind, title: kind })), { id: 'wrong', kind: 'email', title: 'Wrong' }],
      brand: [...brandKinds.map((kind) => ({ id: kind, kind, title: kind })), { id: 'wrong', kind: 'navigation', title: 'Wrong' }],
    });
    assert.deepEqual(detail.patterns.map((entry) => entry.kind), patternKinds);
    assert.deepEqual(detail.brand.map((entry) => entry.kind), brandKinds);
    assert.deepEqual(detail.problems.map((problem) => problem.entry), ['patterns.wrong', 'brand.wrong']);
  });

  test('pattern and brand examples: exactly <folder>/<id>.html and present; otherwise a problem and the entry stays', () => {
    const files = [{ rel: 'patterns/nav.html', bytes: 10 }, { rel: 'brand/hero.html', bytes: 10 }, { rel: 'components/sheet.html', bytes: 10 }];
    const detail = of(
      {
        patterns: [
          { id: 'nav', kind: 'navigation', title: 'Nav', example: 'patterns/nav.html' },
          { id: 'sheet', kind: 'overlay', title: 'Sheet', example: 'components/sheet.html' },
          { id: 'toast', kind: 'feedback', title: 'Toast', example: 'patterns/toast.html' },
          { id: 'up', kind: 'feedback', title: 'Up', example: '../patterns/nav.html' },
        ],
        brand: [{ id: 'hero', kind: 'marketing', title: 'Hero', example: 'brand/hero.html' }],
      },
      { files },
    );
    assert.deepEqual(detail.patterns.map((entry) => [entry.id, entry.example]), [['nav', { remote: [] }], ['sheet', null], ['toast', null], ['up', null]]);
    assert.deepEqual(detail.brand[0]?.example, { remote: [] });
    assert.deepEqual(detail.problems, [
      { entry: 'patterns.sheet', message: 'Its example must be patterns/sheet.html.' },
      { entry: 'patterns.toast', message: 'patterns/toast.html is missing.' },
      { entry: 'patterns.up', message: 'Its example must be patterns/up.html.' },
    ]);
  });

  test('automatic pairs: --x-fg on --x and --on-x on --x, only when --x is a colour this system sets', () => {
    const detail = of({});
    assert.deepEqual(detail.pairs, [
      { fg: '--accent-fg', bg: '--accent', use: 'text', note: '', auto: true },
      { fg: '--on-primary', bg: '--primary', use: 'text', note: '', auto: true },
    ]);
    assert.deepEqual(detail.problems, []);
  });

  test('declared pairs come first; a declared pair replaces its automatic twin; bad pairs are problems on that pair only', () => {
    const detail = of({
      pairs: [
        { fg: '--fg', bg: '--bg', use: 'text', note: 'Body text.' },
        { fg: '--accent-fg', bg: '--accent', use: 'ui' },
        { fg: '--fg', bg: '--bg' },
        { fg: '--fg', bg: '--space-4' },
        { fg: '--nope', bg: '--bg' },
        { fg: '--fg', bg: '--accent', use: 'huge' },
        { fg: '--fg', bg: '--accent', note: 'x'.repeat(501) },
        'junk',
        { fg: '--fg', bg: '--primary', use: 'large' },
      ],
    });
    assert.deepEqual(detail.pairs, [
      { fg: '--fg', bg: '--bg', use: 'text', note: 'Body text.', auto: false },
      { fg: '--accent-fg', bg: '--accent', use: 'ui', note: '', auto: false },
      { fg: '--fg', bg: '--primary', use: 'large', note: '', auto: false },
      { fg: '--on-primary', bg: '--primary', use: 'text', note: '', auto: true },
    ]);
    assert.deepEqual(detail.problems, [
      { entry: 'pairs[2]', message: 'This pair is listed twice.' },
      { entry: 'pairs[3]', message: 'Its fg and bg must be colour tokens this system sets.' },
      { entry: 'pairs[4]', message: 'Its fg and bg must be colour tokens this system sets.' },
      { entry: 'pairs[5]', message: 'Its use must be text, large or ui.' },
      { entry: 'pairs[6]', message: 'Its note is longer than 500 characters.' },
      { entry: 'pairs[7]', message: 'This pair is not an object.' },
    ]);
  });

  test('pairs cap at 60 with the true count; automatic pairs stop at the cap', () => {
    const many = Array.from({ length: 70 }, (_, n) => ({ fg: '--fg', bg: '--bg', note: `n${n}` }));
    // Distinct declared pairs: build 70 colour tokens.
    const css = `:root {\n${Array.from({ length: 70 }, (_, n) => `  --c${n}: #00000${n % 10};`).join('\n')}\n  --accent: #111111;\n  --accent-fg: #ffffff;\n}`;
    const pairs = many.map((_, n) => ({ fg: `--c${n}`, bg: '--accent' }));
    const detail = buildSystemDetail(source({ tokensCss: css, systemJson: JSON.stringify({ pairs }) }), RULES);
    assert.equal(detail.pairs.length, 60);
    assert.ok(detail.pairs.every((pair) => !pair.auto));
    assert.deepEqual(detail.problems, [{ entry: 'pairs', message: "Design systems hold up to 60 colour pairs. 10 more weren't read." }]);
  });

  test('outOfScope: known topic ids each once, unknown ones one problem, capped at 40 with the true count', () => {
    assert.deepEqual(of({ outOfScope: ['motion', 'marketing', 'motion'] }).outOfScope, ['motion', 'marketing']);
    const odd = of({ outOfScope: ['motion', 'sparkles', 'Marketing', 7] });
    assert.deepEqual(odd.outOfScope, ['motion']);
    assert.deepEqual(odd.problems, [{ entry: 'outOfScope', message: '"sparkles", "Marketing", "number" aren\'t checklist topics, so they were skipped.' }]);
    const one = of({ outOfScope: ['nope\nline'] });
    assert.deepEqual(one.problems, [{ entry: 'outOfScope', message: '"nope line" isn\'t a checklist topic, so it was skipped.' }]);
    const long = of({ outOfScope: Array.from({ length: 45 }, () => 'motion') });
    assert.deepEqual(long.outOfScope, ['motion']);
    assert.deepEqual(long.problems, [{ entry: 'outOfScope', message: "outOfScope holds up to 40 topic ids. 5 more weren't read." }]);
    assert.deepEqual(of({ outOfScope: 'motion' }).problems, [{ entry: 'outOfScope', message: 'outOfScope in system.json is not a list, so it was skipped.' }]);
  });

  test('__proto__ keys are ordinary ignored keys for depth, pairs and outOfScope', () => {
    const text = '{"__proto__":{"depth":"full","outOfScope":["motion"],"pairs":[{"fg":"--fg","bg":"--bg"}]},"pairs":[{"__proto__":{"fg":"--fg","bg":"--bg"}}]}';
    const detail = buildSystemDetail(source({ tokensCss: COLOURS, systemJson: text }), RULES);
    assert.equal(detail.depth, null);
    assert.deepEqual(detail.outOfScope, []);
    assert.ok(detail.pairs.every((pair) => pair.auto));
    assert.deepEqual(detail.problems, [{ entry: 'pairs[0]', message: 'Its fg and bg must be colour tokens this system sets.' }]);
  });

  test('fingerprints: a pattern or brand example moves its own section; pairs move colours; sizes move components; depth and outOfScope move none', () => {
    const json = {
      patterns: [{ id: 'nav', kind: 'navigation', title: 'Nav', example: 'patterns/nav.html' }],
      brand: [{ id: 'hero', kind: 'marketing', title: 'Hero', example: 'brand/hero.html' }],
      components: [{ id: 'button', name: 'Button' }],
    };
    const files = [{ rel: 'patterns/nav.html', bytes: 1 }, { rel: 'brand/hero.html', bytes: 1 }];
    const prints = (overrides: Record<string, unknown>, hashes: Record<string, string> = {}) => sectionFingerprints(of({ ...json, ...overrides }, { files }), hashes);
    const base = prints({}, { 'patterns/nav.html': '1'.repeat(64), 'brand/hero.html': '1'.repeat(64) });
    assert.deepEqual(changedSections(base, prints({}, { 'patterns/nav.html': '2'.repeat(64), 'brand/hero.html': '1'.repeat(64) })), ['patterns']);
    assert.deepEqual(changedSections(base, prints({}, { 'patterns/nav.html': '1'.repeat(64), 'brand/hero.html': '2'.repeat(64) })), ['brand']);
    const hashes = { 'patterns/nav.html': '1'.repeat(64), 'brand/hero.html': '1'.repeat(64) };
    assert.deepEqual(changedSections(base, prints({ depth: 'full' }, hashes)), []);
    assert.deepEqual(changedSections(base, prints({ depth: 'core', outOfScope: ['motion', 'marketing'] }, hashes)), []);
    assert.deepEqual(changedSections(base, prints({ pairs: [{ fg: '--fg', bg: '--bg' }] }, hashes)), ['colours']);
    assert.deepEqual(changedSections(base, prints({ components: [{ id: 'button', name: 'Button', sizes: ['sm'] }] }, hashes)), ['components']);
  });

  test('pattern and brand examples are contract paths; other shapes are not', () => {
    for (const rel of ['patterns/nav.html', 'brand/hero.html', 'components/button.html']) assert.equal(isSystemContractRel(rel), true, rel);
    for (const rel of ['patterns/Nav.html', 'patterns/../x.html', 'brand/a/b.html', 'patterns/nav.htm', 'notes/x.html']) assert.equal(isSystemContractRel(rel), false, rel);
  });

  test('the checklist topic ids are the closed list the spec names', () => {
    assert.equal(SYSTEM_TOPIC_IDS.length, 33);
    assert.equal(new Set(SYSTEM_TOPIC_IDS).size, 33);
    assert.ok(SYSTEM_TOPIC_IDS.length <= SYSTEM_OUT_OF_SCOPE_MAX);
  });

  test('pair entry keys: pair:<n> parses and belongs to Colours while the pair exists', () => {
    const detail = of({});
    assert.equal(isBoardEntryKey('pair:1'), true);
    assert.equal(isBoardEntryKey('pair:x'), false);
    assert.equal(isBoardEntryKey('pair:1000'), false);
    assert.deepEqual(parseEntryKey('pair:1'), { kind: 'pair', key: '1' });
    assert.equal(sectionOfEntry({ kind: 'pair', key: '1' }, detail), 'colours');
    assert.equal(sectionOfEntry({ kind: 'pair', key: '2' }, detail), null);
    assert.equal(entryKeyOf('pair', '0'), 'pair:0');
  });
});
