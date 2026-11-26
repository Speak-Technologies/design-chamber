// The specimen board document (documentation/specs/phase-2-5-technical.md §5.7, §9.2, §11.4): hostile
// names, notes and values never reach markup or CSS unescaped, refused values are hatched and never
// declared, SVG logos only ever as <img>, component examples only as inert template text, and every
// entry element carries a well-formed entry key.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import { BOARD_ENTRY_PATTERN, darkVarOf, entryKeyOf, isBoardEntryKey, parseEntryKey, sectionOfEntry, typeVarOf } from '../../../src/shared/system-board.ts';
import type { SystemDetail, SystemToken } from '../../../src/shared/types.ts';
import { buildBoardHtml, escapeHtml } from '../../../src/service/systems/board-html.ts';

const NOW = '2026-11-20T10:00:00.000Z';

const TOKENS_CSS = `:root {
  --brand: #1a73e8;
  --surface: #ffffff;
  --space-2: 8px;
  --radius-md: 6px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.2);
  --z-modal: 100;
  --container: 1200px;
}
@media (prefers-color-scheme: dark) {
  :root { --brand: #8ab4f8; --surface: #121212; }
}
`;

const SYSTEM_JSON = {
  tokens: { '--brand': { group: 'brand', note: 'Primary actions' }, '--surface': { group: 'surface' } },
  type: [{ id: 'body', name: 'Body', family: '"Inter", sans-serif', size: '16px', weight: '400', lineHeight: '1.5' }],
  fonts: [{ file: 'assets/fonts/inter.woff2', family: 'Inter', weight: 400 }],
  logos: [{ file: 'assets/logos/mark.svg', variant: 'mark' }],
  components: [{ id: 'button', name: 'Button', purpose: 'Starts an action', tokens: ['--brand', '--missing'], example: 'components/button.html' }],
  notes: [{ id: 'voice', title: 'Voice' }],
};

const makeDetail = (): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/tmp/_systems/acme',
    state: { ...parseSystemState({}, 'acme', NOW), name: 'Acme' },
    systemJson: JSON.stringify(SYSTEM_JSON),
    tokensCss: TOKENS_CSS,
    texts: { 'OVERVIEW.md': 'Calm and clear.\n\nSecond paragraph.', 'notes/voice.md': 'Plain words.' },
    files: [
      { rel: 'assets/fonts/inter.woff2', bytes: 10 },
      { rel: 'assets/logos/mark.svg', bytes: 10 },
      { rel: 'components/button.html', bytes: 10 },
    ],
    build: null,
  });

const styleBlocks = (html: string): string[] => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? '');
const scriptCount = (html: string): number => (html.match(/<script\b/gi) ?? []).length;
const entries = (html: string): string[] => [...html.matchAll(/data-dc-entry="([^"]*)"/g)].map((match) => match[1] ?? '');

const HOSTILE = '</style></title><script>alert(1)</script><img src=x onerror=alert(2)>"\'&';

const hostileToken = (name: string, text: string, section: SystemToken['section'] = 'colours'): SystemToken => ({
  name,
  section,
  group: section === 'colours' ? 'brand' : null,
  // A lying detail: the generator re-checks every value itself.
  light: { text, editable: 'ok', problem: null },
  dark: null,
  note: HOSTILE,
  breakpoint: false,
  alsoSet: [],
  fromCode: false,
  problem: null,
});

test('the fixture system parses with no problems (so the board tests below test the board)', () => {
  const detail = makeDetail();
  assert.deepEqual(detail.problems, []);
  assert.equal(detail.components[0]?.example !== null, true);
});

test('hostile names, notes, titles and values are escaped in markup and never reach CSS', () => {
  const base = makeDetail();
  const detail: SystemDetail = {
    ...base,
    name: HOSTILE,
    overview: { text: HOSTILE, problem: HOSTILE },
    notes: [{ id: 'voice', title: HOSTILE, text: HOSTILE, problem: null, layout: null }],
    tokens: [
      ...base.tokens,
      hostileToken('--evil', 'red;}</style><script>alert(3)</script>'),
      hostileToken('--evil-url', 'url(javascript:alert(4))'),
      hostileToken('--evil-other', 'x}body{display:none', 'other'),
      // A name off the token pattern never reaches CSS or a key.
      hostileToken('--a;}*{x:y', '#fff'),
    ],
    type: [{ ...base.type[0]!, name: HOSTILE, note: HOSTILE, family: 'x;}</style>' }], // Safe: the fixture has one type style.
    components: [{ ...base.components[0]!, name: HOSTILE, purpose: HOSTILE, note: HOSTILE, source: HOSTILE, variants: [HOSTILE], example: { remote: [HOSTILE] } }], // Safe: one component.
    logos: [{ file: 'assets/logos/mark.svg', variant: HOSTILE, note: HOSTILE }],
    sourceFiles: [{ file: `sources/${HOSTILE}`, bytes: 1 }],
  };
  const html = buildBoardHtml(detail, { scheme: 'light', examples: { button: '<b>ok</b>' } });

  // Only the board's own script element exists, and no hostile markup survived unescaped.
  assert.equal(scriptCount(html), 1);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('</title><script'));
  assert.ok(html.includes(escapeHtml(HOSTILE)));

  // CSS: two style blocks (chrome, system), neither holding a hostile value, name or brace trick.
  const blocks = styleBlocks(html);
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
    assert.ok(!/alert|javascript|display:none|<|--evil|--a;/.test(block), block);
  }
  assert.ok(blocks[1]?.includes('--brand: #1a73e8;'));
});

test('a refused value is hatched and never declared; a valid one is declared with its dark value', () => {
  const base = makeDetail();
  const detail: SystemDetail = { ...base, tokens: [...base.tokens, hostileToken('--bad', 'url(https://x.test/a.png)')] };
  const html = buildBoardHtml(detail, { scheme: 'light' });
  const card = /<div class="dc-card" data-dc-entry="token:--bad">([\s\S]*?)<\/div><\/div><div class="dc-name">/.exec(html);
  assert.ok(card, 'the --bad card');
  assert.ok(card[1]?.includes('dc-hatched'));
  assert.ok(html.includes("Can&#39;t read this value"));
  const css = styleBlocks(html)[1] ?? '';
  assert.ok(!css.includes('--bad'));
  assert.ok(css.includes(`${darkVarOf('--brand')}: #8ab4f8;`));
  assert.ok(css.includes(`--brand: var(${darkVarOf('--brand')});`));
  assert.ok(css.includes(`${typeVarOf('body', 'size')}: 16px;`));
  // A token shown on a dark ground only when it has a dark value.
  const brand = html.slice(html.indexOf('data-dc-entry="token:--brand"'), html.indexOf('data-dc-entry="token:--surface"'));
  assert.ok(brand.includes('dc-ground dc-dark'));
  assert.ok(!html.slice(html.indexOf('data-dc-entry="token:--space-2"')).split('</div></div>')[0]?.includes('dc-dark'));
});

test('a logo, SVG included, is only ever an <img>; a refused logo or font is a sentence', () => {
  const detail = makeDetail();
  const html = buildBoardHtml(detail, { scheme: 'light' });
  assert.ok(html.includes('<img class="dc-logo" src="assets/logos/mark.svg" alt="mark">'));
  assert.ok(!/<svg/i.test(html));
  assert.ok(/@font-face \{ font-family: "Inter"; src: url\("assets\/fonts\/inter\.woff2"\)/.test(html));

  const refused = buildBoardHtml(detail, { scheme: 'light', unusable: new Set(['assets/logos/mark.svg', 'assets/fonts/inter.woff2']) });
  assert.ok(!refused.includes('<img'));
  assert.ok(refused.includes('This logo file can&#39;t be used.'));
  assert.ok(refused.includes('This font file can&#39;t be used.'));
  assert.ok(!refused.includes('@font-face'));
});

test('a component example is escaped text inside a template, so it can neither run nor close the template', () => {
  const example = '<style>p{color:red}</style><p>Hi</p><script>window.ran = 1</script></template><script>escape()</script><!--dc-bridge-->';
  const html = buildBoardHtml(makeDetail(), { scheme: 'light', examples: { button: example } });
  const template = /<template data-dc-example="button">([\s\S]*?)<\/template>/.exec(html);
  assert.ok(template);
  assert.equal(template[1], escapeHtml(example));
  assert.ok(!template[1]?.includes('<'));
  assert.equal(scriptCount(html), 1);
  assert.ok(!html.includes('<!--dc-bridge-->'));
  assert.ok(html.includes('data-dc-example-host="button"'));
  // The board script sets the text on a shadow root (innerHTML never runs scripts), never clones nodes.
  assert.ok(html.includes("attachShadow({ mode: 'open' }).innerHTML = markup"));
  assert.ok(!html.includes('cloneNode') && !html.includes('importNode'));
  // Without a bundled example the card says so.
  assert.ok(buildBoardHtml(makeDetail(), { scheme: 'light' }).includes('This example couldn&#39;t be shown.'));
});

test('component cards are laid out in content-sized columns, and a preview wider than its column widens its card', () => {
  const html = buildBoardHtml(makeDetail(), { scheme: 'light', examples: { button: '<p>Hi</p>' } });
  // Columns, not grid rows: no card is stretched to a neighbour's row height, and the track is wide enough for a table or tab strip.
  assert.match(html, /\.dc-components \{ display: block; column-width: \d{3}px;/);
  assert.match(html, /\.dc-components > \.dc-card \{[^}]*break-inside: avoid/);
  assert.match(html, /\.dc-components > \.dc-card\.dc-wide \{ column-span: all; \}/);
  // The static board script measures each example and flags the wide ones (still one script, no markup from the system in it).
  assert.ok(html.includes("classList.add('dc-wide')"));
  assert.equal(scriptCount(html), 1);
});

test('every entry element carries a well-formed key, and the expected keys are there', () => {
  const html = buildBoardHtml(makeDetail(), { scheme: 'dark' });
  const keys = entries(html);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.ok(isBoardEntryKey(key), key);
  for (const expected of ['overview', 'note:voice', 'token:--brand', 'token:--z-modal', 'token:--container', 'type:body', 'font:0', 'logo:0', 'component:button']) {
    assert.ok(keys.includes(expected), expected);
  }
  assert.ok(html.includes('color-scheme: dark'));
});

test('an unreadable system shows its sentence, escaped, and runs no script', () => {
  const html = buildBoardHtml({ ...makeDetail(), unreadable: `${HOSTILE} unreadable` }, { scheme: 'light' });
  assert.equal(scriptCount(html), 0);
  assert.ok(html.includes(escapeHtml(HOSTILE)));
});

test('entry keys: build, parse, sections and the custom property names', () => {
  const detail = makeDetail();
  assert.equal(entryKeyOf('token', '--brand'), 'token:--brand');
  assert.equal(entryKeyOf('overview', 'ignored'), 'overview');
  assert.throws(() => entryKeyOf('type', 'Bad Id'));
  assert.throws(() => entryKeyOf('token', `--${'a'.repeat(61)}`));
  assert.deepEqual(parseEntryKey('token:--brand'), { kind: 'token', key: '--brand' });
  assert.deepEqual(parseEntryKey('overview'), { kind: 'overview', key: '' });
  assert.deepEqual(parseEntryKey('font:12'), { kind: 'font', key: '12' });
  for (const bad of ['', 'token:brand', 'token:--a"b', 'type:A', 'font:1234', 'overview:x', 'evil:x', `note:${'a'.repeat(41)}`, 'token:--brand\n']) {
    assert.equal(parseEntryKey(bad), null, bad);
  }
  const section = (text: string) => {
    const key = parseEntryKey(text);
    return key === null ? 'unparsed' : sectionOfEntry(key, detail);
  };
  assert.equal(section('token:--brand'), 'colours');
  assert.equal(section('token:--container'), 'sizes');
  assert.equal(section('token:--nope'), null);
  assert.equal(section('type:body'), 'typography');
  assert.equal(section('font:0'), 'typography');
  assert.equal(section('font:1'), null);
  assert.equal(section('logo:0'), 'brand');
  assert.equal(section('component:button'), 'components');
  assert.equal(section('note:voice'), 'overview');
  assert.equal(section('overview'), 'overview');
  assert.equal(section('pattern:x'), null);
  assert.equal(section('brand:x'), null);

  assert.equal(darkVarOf('--brand'), '--dc-dark-brand');
  assert.notEqual(darkVarOf('---brand'), darkVarOf('--brand'));
  assert.throws(() => darkVarOf('brand'));
  assert.equal(typeVarOf('body', 'lineHeight'), '--dc-type-body-lineHeight');
  assert.throws(() => typeVarOf('body', 'color'));
  // The longest names still fit the preview name cap (`--` + 80).
  assert.ok(/^--[A-Za-z0-9_-]{1,80}$/.test(darkVarOf(`--${'a'.repeat(60)}`)));
  assert.ok(/^--[A-Za-z0-9_-]{1,80}$/.test(typeVarOf('a'.repeat(40), 'letterSpacing')));
  assert.ok(BOARD_ENTRY_PATTERN.test('brand:logo-use'));
});

// ---- layout runs: the board CSS and script (system-board-layout-and-visual-check.md §A.4) ----

test('the board script measures .dc-fit (cards and table rows), and the run CSS is present', () => {
  const html = buildBoardHtml(makeDetail(), { scheme: 'light', examples: { button: '<p>Hi</p>' } });
  assert.ok(html.includes("document.querySelectorAll('.dc-fit')"));
  assert.ok(!html.includes("document.querySelectorAll('.dc-components > .dc-card')"));
  // Rule 1: the card run keeps the content-sized columns.
  assert.match(html, /\.dc-components \{ display: block; column-width: 600px; column-gap: 16px; \}/);
  assert.match(html, /\.dc-components > \.dc-card\.dc-wide \{ column-span: all; \}/);
  // Rule 2: compact columns and padding; compact token and text grids; the smaller swatch.
  assert.match(html, /\.dc-components\.dc-run-compact \{ column-width: 280px; \}/);
  assert.match(html, /\.dc-run-compact > \.dc-card \{ padding: 12px; \}/);
  assert.match(html, /\.dc-grid\.dc-run-compact \{ grid-template-columns: repeat\(auto-fill, minmax\(120px, 1fr\)\); \}/);
  assert.match(html, /\.dc-grid\.dc-text-grid\.dc-run-compact \{ grid-template-columns: repeat\(auto-fill, minmax\(200px, 1fr\)\); \}/);
  assert.match(html, /\.dc-run-compact \.dc-swatch \{ height: 32px; \}/);
  // Rule 3: full is one column with a 16px gap.
  assert.match(html, /\.dc-run-full \{ display: grid; grid-template-columns: 1fr; gap: 16px; \}/);
  // Rule 4: the table grid, subgrid rows, row rules, muted header, the container query.
  assert.match(html, /\.dc-run-table \{ display: grid; grid-template-columns: minmax\(160px, 1fr\) minmax\(0, 3fr\) minmax\(160px, 1\.2fr\); \}/);
  assert.match(html, /\.dc-thead, \.dc-trow \{ display: grid; grid-template-columns: subgrid; grid-column: 1 \/ -1; \}/);
  assert.match(html, /\.dc-trow \{ border-bottom: 1px solid var\(--dc-board-border/);
  assert.match(html, /\.dc-thead \{ color: var\(--dc-board-muted/);
  assert.match(html, /\.dc-section \{[^}]*container-type: inline-size;/);
  assert.match(html, /@container \(max-width: 759px\) \{/);
  // Rule 5: a widened row leaves the subgrid.
  assert.match(html, /\.dc-trow\.dc-wide \{ grid-template-columns: 1fr 1fr; \}/);
  assert.match(html, /\.dc-trow\.dc-wide \.dc-tcell-preview \{ grid-column: 1 \/ -1; grid-row: 2; \}/);
  // Rule 6: light and dark grounds stack in every run (the base fix 64c0687), never side by side.
  assert.ok(!/\.dc-grounds \{ flex-direction: row/.test(html), 'no run puts the grounds side by side');
  assert.match(html, /\.dc-components \.dc-grounds \{ flex-direction: column;/);
  assert.match(html, /\.dc-run-full \.dc-grounds \{ flex-direction: column;/);
  assert.match(html, /\.dc-trow \.dc-grounds \{ flex-direction: column; \}/);
  // Rule 7: every component run keeps the bounded card and the scrolling example.
  assert.match(html, /\.dc-run-full > \.dc-card \{ overflow: hidden; \}/);
  assert.match(html, /\.dc-example \{ display: block; min-height: 32px; overflow: auto; \}/);
});

test('a system with no hints renders the card run: dc-run-card on the container, dc-fit on the cards', () => {
  const html = buildBoardHtml(makeDetail(), { scheme: 'light', examples: { button: '<p>Hi</p>' } });
  assert.ok(html.includes('<div class="dc-grid dc-components dc-run-card">'));
  assert.ok(html.includes('<div class="dc-card dc-fit" data-dc-entry="component:button">'));
});

test('table and full runs render their containers; compact components keep dc-components', () => {
  const base = makeDetail();
  const table = buildBoardHtml({ ...base, components: base.components.map((component) => ({ ...component, layout: 'table' as const })) }, { scheme: 'light', examples: { button: '<p>Hi</p>' } });
  assert.ok(table.includes('<div class="dc-run-table" role="table" aria-label="Components">'));
  assert.ok(table.includes('<div class="dc-trow dc-fit" role="row" data-dc-entry="component:button">'));
  const full = buildBoardHtml({ ...base, components: base.components.map((component) => ({ ...component, layout: 'full' as const })) }, { scheme: 'light' });
  assert.ok(full.includes('<div class="dc-run-full">'));
  assert.ok(!full.includes('class="dc-card dc-fit"'), 'a full card is already the whole width');
  const compact = buildBoardHtml({ ...base, components: base.components.map((component) => ({ ...component, layout: 'compact' as const })) }, { scheme: 'light' });
  assert.ok(compact.includes('<div class="dc-grid dc-components dc-run-compact">'));
});
