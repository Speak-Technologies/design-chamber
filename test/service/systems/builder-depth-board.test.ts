// The board and living page for the builder-depth contract (documentation/specs/system-builder-depth.md
// §4.4, T5): pattern and brand live examples drawn exactly like component examples, the Pairs block
// under Colours, escaping in every new cell, the living page's allowlist, and the generator versions.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIVING_EXAMPLE_GENERATOR_VERSION, LIVING_PAGE_GENERATOR_VERSION } from '../../../src/shared/limits.ts';
import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import type { FileSource } from '../../../src/service/bundle.ts';
import { assembleBoardHtml } from '../../../src/service/systems/board-assemble.ts';
import { buildBoardHtml } from '../../../src/service/systems/board-html.ts';
import { isCopyReference } from '../../../src/service/systems/link.ts';
import { planExampleShots } from '../../../src/service/systems/living-examples.ts';
import { buildLivingPage, type LivingPageInput } from '../../../src/service/systems/living-html.ts';
import { picturesToDrop } from '../../../src/service/systems/living-page.ts';
import { livingCssProblems, scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { exampleFileOf, exampleKeyOf, PAIR_MEASURED_SENTENCE } from '../../../src/service/systems/specimen-html.ts';

const NOW = '2026-11-27T10:00:00.000Z';
const HOSTILE = '"><img src=x onerror=alert(1)><script>x</script>';

const TOKENS = `:root {
  --bg: #ffffff;
  --fg: #767676;
  --muted: #777777;
  --accent: #2456d6;
  --accent-fg: #ffffff;
  --soft: oklch(0.7 0.1 250);
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111111; --fg: #f2f2f2; }
}
`;

const JSON_OF = (over: Record<string, unknown> = {}) => ({
  tokens: { '--bg': { group: 'surface' }, '--fg': { group: 'text' }, '--muted': { group: 'text' }, '--accent': { group: 'brand' }, '--accent-fg': { group: 'text' }, '--soft': { group: 'other' } },
  components: [{ id: 'nav', name: 'Nav component', example: 'components/nav.html' }],
  patterns: [{ id: 'nav', kind: 'navigation', title: 'Navigation', note: 'Top bar on laptop.', example: 'patterns/nav.html' }],
  brand: [{ id: 'hero', kind: 'marketing', title: 'Hero', example: 'brand/hero.html' }],
  pairs: [
    { fg: '--fg', bg: '--bg', use: 'text', note: 'Body text.' },
    { fg: '--muted', bg: '--bg', use: 'text' },
    { fg: '--soft', bg: '--bg', use: 'ui' },
  ],
  ...over,
});

const FILES = ['components/nav.html', 'patterns/nav.html', 'brand/hero.html'];

const detailOf = (over: Record<string, unknown> = {}, tokensCss = TOKENS): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(JSON_OF(over)),
    tokensCss,
    texts: {},
    files: FILES.map((rel) => ({ rel, bytes: 10 })),
    build: null,
  });

const EXAMPLES: Record<string, string> = {
  nav: '<button>Component nav</button>',
  'pattern:nav': '<nav><a href="#">Pattern nav</a></nav>',
  'brand:hero': '<section>Hero</section>',
};

/** An in-memory file source: just enough for the bundler. */
const memorySource = (files: Record<string, string>): FileSource => ({
  root: '/memory',
  read: async (rel) => {
    if (!Object.hasOwn(files, rel)) return null;
    const bytes = Buffer.from(files[rel] ?? '', 'utf8');
    return { bytes, size: bytes.length, mtimeMs: 0 };
  },
  stat: async (rel) => (Object.hasOwn(files, rel) ? { size: Buffer.byteLength(files[rel] ?? ''), mtimeMs: 0 } : null),
});

/** One entry's own block: from its entry mark to the next one. */
const blockOf = (html: string, key: string): string => {
  const start = html.indexOf(`data-dc-entry="${key}"`);
  assert.notEqual(start, -1, key);
  const next = html.indexOf('data-dc-entry="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

test('example keys: a component keeps its id, pattern and brand entries are kind-qualified, so ids may be shared', () => {
  assert.equal(exampleKeyOf('component', 'nav'), 'nav');
  assert.equal(exampleKeyOf('pattern', 'nav'), 'pattern:nav');
  assert.equal(exampleKeyOf('brand', 'hero'), 'brand:hero');
  assert.equal(exampleFileOf('component', 'nav'), 'components/nav.html');
  assert.equal(exampleFileOf('pattern', 'nav'), 'patterns/nav.html');
  assert.equal(exampleFileOf('brand', 'hero'), 'brand/hero.html');
});

test('a pattern example draws in a dc-fit card as an inert template, apart from a component of the same id', () => {
  const html = buildBoardHtml(detailOf(), { scheme: 'light', examples: EXAMPLES });
  const pattern = blockOf(html, 'pattern:nav');
  assert.match(pattern, /^data-dc-entry="pattern:nav"/);
  assert.ok(html.includes('<div class="dc-card dc-text dc-fit" data-dc-entry="pattern:nav">'));
  assert.ok(pattern.includes('<template data-dc-example="pattern:nav">&lt;nav&gt;&lt;a href=&quot;#&quot;&gt;Pattern nav&lt;/a&gt;&lt;/nav&gt;</template>'));
  assert.ok(pattern.includes('data-dc-example-host="pattern:nav"'));
  // The example sits above the body: after the kind and note.
  assert.ok(pattern.indexOf('Top bar on laptop.') < pattern.indexOf('<template'));
  assert.ok(blockOf(html, 'component:nav').includes('<template data-dc-example="nav">&lt;button&gt;Component nav'));
  assert.ok(blockOf(html, 'brand:hero').includes('<template data-dc-example="brand:hero">'));
  // The dark ground is there because the system has dark values.
  assert.equal((pattern.match(/data-dc-example-host="pattern:nav"/g) ?? []).length, 2);
});

test('a pattern example draws in a dc-fit table row, in the preview cell above the guidance', () => {
  const html = buildBoardHtml(detailOf({ layout: { patterns: 'table' } }), { scheme: 'light', examples: EXAMPLES });
  assert.ok(html.includes('<div class="dc-trow dc-fit" role="row" data-dc-entry="pattern:nav">'));
  const row = blockOf(html, 'pattern:nav');
  assert.match(row, /dc-tcell-preview" role="cell"><template data-dc-example="pattern:nav">/);
});

test('an entry without an example keeps its card exactly as before (no dc-fit); a missing bundle says so', () => {
  const plain = buildBoardHtml(detailOf({ patterns: [{ id: 'voice', kind: 'voice', title: 'Voice' }] }), { scheme: 'light', examples: EXAMPLES });
  assert.ok(plain.includes('<div class="dc-card dc-text" data-dc-entry="pattern:voice">'));
  const missing = buildBoardHtml(detailOf(), { scheme: 'light', examples: {} });
  assert.ok(blockOf(missing, 'pattern:nav').includes("This example couldn&#39;t be shown."));
});

test('escaping in every new cell: hostile titles, kinds, notes, example markup and pair notes', () => {
  const detail = detailOf({
    patterns: [{ id: 'nav', kind: 'navigation', title: HOSTILE, note: HOSTILE, example: 'patterns/nav.html' }],
    brand: [{ id: 'hero', kind: 'social', title: HOSTILE, example: 'brand/hero.html' }],
    pairs: [{ fg: '--fg', bg: '--bg', note: HOSTILE }],
  });
  for (const layout of ['card', 'table'] as const) {
    const html = buildBoardHtml({ ...detail, boardLayout: { ...detail.boardLayout, sections: { patterns: layout, brand: layout, colours: layout } } }, { scheme: 'light', examples: { ...EXAMPLES, 'pattern:nav': HOSTILE } });
    assert.ok(!html.includes('<img src=x'), layout);
    assert.ok(!html.includes('<script>x'), layout);
    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'), layout);
  }
});

test('the Pairs block: Aa Text on each ground, the ratio for hex values, "Measured by the check" for oklch', () => {
  const html = buildBoardHtml(detailOf(), { scheme: 'light', examples: EXAMPLES });
  assert.ok(html.includes('<h3>Pairs</h3>'));
  const body = blockOf(html, 'pair:0');
  // #767676 on #ffffff is the classic 4.54:1; dark #f2f2f2 on #111111.
  assert.ok(body.includes('style="color: var(--fg); background: var(--bg)" data-dc-pair="0-light">Aa Text</div><div class="dc-value">4.54:1</div>'), body);
  assert.ok(body.includes('data-dc-pair="0-dark">Aa Text</div><div class="dc-value">16.'), body);
  assert.ok(body.includes('Body text, needs 4.5:1'));
  assert.ok(body.includes('--fg on --bg'));
  // #777777 on white is 4.478…:1, written rounded down so it never reads as passing.
  assert.ok(blockOf(html, 'pair:1').includes('<div class="dc-value">4.47:1</div>'));
  assert.ok(body.includes('data-dc-pair="0-dark">Aa Text</div><div class="dc-value">16.86:1</div>'), body);
  assert.ok(blockOf(html, 'pair:2').includes(`<div class="dc-value">${PAIR_MEASURED_SENTENCE}</div>`));
  // The automatic pair is drawn and says where it came from.
  const auto = blockOf(html, 'pair:3');
  assert.ok(auto.includes('--accent-fg on --accent'));
  assert.ok(auto.includes('Found from the token names.'));
});

test('pairs take the colours layout: compact grid, or a table', () => {
  const compact = buildBoardHtml(detailOf({ layout: { colours: 'compact' } }), { scheme: 'light' });
  assert.match(compact, /<h3>Pairs<\/h3><div class="dc-grid dc-run-compact"><div class="dc-card" data-dc-entry="pair:0">/);
  const table = buildBoardHtml(detailOf({ layout: { colours: 'table' } }), { scheme: 'light' });
  assert.match(table, /<h3>Pairs<\/h3><div class="dc-run-table dc-table-tokens" role="table" aria-label="Colours: Pairs">/);
  assert.ok(table.includes('<div class="dc-trow" role="row" data-dc-entry="pair:0">'));
});

test('a system without dark values draws one ground per pair; a system without pairs has no Pairs block', () => {
  const light = buildBoardHtml(detailOf({}, TOKENS.replace(/@media[\s\S]*$/, '')), { scheme: 'light' });
  assert.ok(!blockOf(light, 'pair:0').includes('-dark"'));
  const none = buildBoardHtml(detailOf({ pairs: [] }, ':root { --bg: #ffffff; }'), { scheme: 'light' });
  assert.ok(!none.includes('<h3>Pairs</h3>'));
});

test('new board CSS names only --dc-board-* variables', () => {
  const html = buildBoardHtml(detailOf(), { scheme: 'light' });
  const chrome = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const added = chrome.split('\n').filter((line) => /dc-pair|dc-text\.dc-fit|dc-text-grid > \.dc-card\.dc-wide/.test(line));
  assert.ok(added.length >= 4, added.join('\n'));
  for (const line of added) for (const name of line.match(/var\((--[a-z0-9-]+)/g) ?? []) assert.match(name, /^var\(--dc-board-/, line);
});

test('assembly bundles pattern and brand examples one by one, and a missing one is "couldn\'t be shown"', async () => {
  const source = memorySource({ 'components/nav.html': '<b>c</b>', 'patterns/nav.html': '<i>p</i><img src="https://example.com/x.png">' });
  const { html, patterns, brand } = await assembleBoardHtml(detailOf(), source, 'light');
  assert.ok(html.includes('<template data-dc-example="pattern:nav">'));
  assert.deepEqual(patterns[0]?.example?.remote, ['https://example.com/x.png']);
  assert.ok(blockOf(html, 'pattern:nav').includes('This example asks for files from the internet'));
  assert.deepEqual(brand[0]?.example, { remote: [] });
  assert.ok(blockOf(html, 'brand:hero').includes("This example couldn&#39;t be shown."));
});

test('the living page with pattern and brand pictures and pairs passes the allowlist; data-dc-pair is stripped', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const detail = detailOf();
  const input: LivingPageInput = {
    revision: 2,
    generatedAt: NOW,
    coverage: detail.coverage,
    redact: [],
    examples: {
      'pattern:nav': [{ scheme: 'light', png: { base64: PNG, width: 1, height: 1 }, reason: null }],
      'brand:hero': [{ scheme: 'light', png: null, reason: 'no-browser' }],
    },
  };
  for (const layout of ['card', 'compact', 'table'] as const) {
    const shown: SystemDetail = { ...detail, boardLayout: { ...detail.boardLayout, sections: { colours: layout, patterns: layout === 'compact' ? ('full' as const) : layout } } };
    const { html, ranges } = buildLivingPage(shown, input);
    assert.deepEqual(scanLivingPage(html).reasons, [], layout);
    const css = /<style>\n([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    for (const line of css.split('\n')) assert.deepEqual(livingCssProblems(line), [], line);
    assert.ok(!html.includes('data-dc-pair'), layout);
    assert.ok(!html.includes('data-dc-entry'), layout);
    assert.ok(html.includes('alt="Navigation example, light"'), layout);
    assert.ok(html.includes('No picture of this example'), layout);
    assert.ok(html.includes('dc-pair-sample'), layout);
    // A pair keeps its range: stripping its sample mark doesn't close the entry early.
    const pair = ranges.find((range) => range.where === 'pair:0');
    assert.ok(pair !== undefined && html.slice(pair.start, pair.end).includes('Body text, needs 4.5:1'), layout);
  }
});

test('living-page budget drops split the scheme off the last colon, so pattern:nav keys survive', () => {
  const PNG = 'A'.repeat(100);
  const drop = picturesToDrop({ 'pattern:nav': [{ scheme: 'dark', png: { base64: PNG, width: 1, height: 1 }, reason: null }] }, 1);
  assert.deepEqual(drop, ['pattern:nav:dark']);
});

test('example pictures plan for pattern and brand keys; the cache key is content only, so the example version stays 2', () => {
  const shell = { tokensCss: ':root{}', fontsCss: '' };
  const shots = planExampleShots([{ component: 'nav', html: '<b>x</b>' }, { component: 'pattern:nav', html: '<b>x</b>' }], shell, ['light']);
  assert.deepEqual(shots.map((shot) => shot.component), ['nav', 'pattern:nav']);
  // The same content gives the same picture whoever it belongs to.
  assert.equal(shots[0]?.key, shots[1]?.key);
  assert.equal(LIVING_EXAMPLE_GENERATOR_VERSION, 2);
  assert.equal(LIVING_PAGE_GENERATOR_VERSION, 5);
});

test('copy-on-link carries pattern and brand examples as agent reference', () => {
  assert.equal(isCopyReference('patterns/nav.html'), true);
  assert.equal(isCopyReference('brand/hero.html'), true);
  assert.equal(isCopyReference('components/button.html'), true);
  assert.equal(isCopyReference('patterns/a/b.html'), false);
});
