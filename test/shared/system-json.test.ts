// The pure reader of a design system (documentation/specs/phase-2-5-technical.md §2.3, §2.5, §2.11,
// §5.1, §5.6): the tolerant system.json parser, the state parser, the detail every reader sees,
// section fingerprints, review derivation and safe brand file names.
//
// The token rules (light/dark contexts, sections, value checks) are T3's `token-edit.ts`; these
// tests inject small deterministic rules so the reader is tested on its own.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  buildSystemDetail,
  coveredAreas,
  deriveReview,
  humaniseSystemId,
  isReservedSystemId,
  parseSystemJson,
  parseSystemState,
  safeAssetName,
  sectionFingerprints,
  SYSTEM_SECTIONS,
  type SystemDetailSource,
  type SystemTokenRules,
} from '../../src/shared/system-json.ts';
import type { SystemState } from '../../src/shared/types.ts';

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
    assert.deepEqual(detail.patterns, [{ id: 'voice', kind: 'voice', title: 'Voice', note: 'Plain.', text: '<b>not markup</b>', problem: null }]);
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
