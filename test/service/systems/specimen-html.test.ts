// Coverage areas on the specimen board (documentation/specs/phase-2-5-technical.md §2.11, §5.7, AD-22):
// the sections that existed before S8 render byte-for-byte as before (snapshot taken from the T6
// generator), the board groups sections under the four area headings, Patterns & voice and Brand &
// marketing show escaped text cards, logos moved to Brand & marketing, and an uncovered area says
// "Not covered by this system." while still showing what an agent wrote there.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { isBoardEntryKey, parseEntryKey, sectionOfEntry } from '../../../src/shared/system-board.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { buildBoardHtml, escapeHtml } from '../../../src/service/systems/board-html.ts';
import { NOT_COVERED_SENTENCE, renderSpecimenSection } from '../../../src/service/systems/specimen-html.ts';
import { BOARD_FIXTURE_JSON, boardFixture } from './board-fixture.ts';

const snapshot = (name: string): string => readFileSync(new URL(`./__snapshots__/${name}`, import.meta.url), 'utf8');

const OPTIONS = { examples: { button: '<button class="b">Go</button><style>.b{color:red}</style>' }, unusable: new Set(['assets/fonts/broken.woff2']) } as const;

const sectionOf = (html: string, id: string): string => {
  const match = new RegExp(`<section class="dc-section" id="dc-section-${id}"[\\s\\S]*?</section>`).exec(html);
  assert.ok(match, id);
  return match[0];
};

const OLD_SECTIONS = ['overview', 'colours', 'typography', 'spacing', 'radius', 'shadows', 'layers', 'sizes', 'components'];

test('the sections from before the coverage areas render exactly as the T6 board did (snapshot)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const html = buildBoardHtml(boardFixture(), { scheme, ...OPTIONS });
    assert.equal(`${OLD_SECTIONS.map((id) => sectionOf(html, id)).join('\n')}\n`, snapshot('board-sections.html'), scheme);
    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)][1]?.[1];
    assert.equal(css, snapshot('board-system-css.css'), scheme);
  }
});

test('sections sit under the four area headings in board order', () => {
  const html = buildBoardHtml(boardFixture(), { scheme: 'light', ...OPTIONS });
  const order = [...html.matchAll(/data-dc-(area|section)="([a-z]+)"/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(order, [
    'area:foundations',
    ...['overview', 'colours', 'typography', 'spacing', 'radius', 'shadows', 'motion', 'layers', 'sizes'].map((id) => `section:${id}`),
    'area:components',
    'section:components',
    'area:patterns',
    'section:patterns',
    'area:brand',
    'section:brand',
    'section:assets',
  ]);
  for (const title of ['Foundations', 'Components', 'Patterns &amp; voice', 'Brand &amp; marketing']) assert.ok(html.includes(`<p class="dc-area-title" aria-hidden="true">${title}</p>`), title);
});

test('patterns and brand entries are escaped text cards with their keys; logos moved to Brand & marketing', () => {
  const html = buildBoardHtml(boardFixture(), { scheme: 'light', ...OPTIONS });
  const patterns = sectionOf(html, 'patterns');
  assert.ok(patterns.includes('data-dc-entry="pattern:empty-states"'));
  assert.ok(patterns.includes('data-dc-entry="pattern:voice"'));
  assert.ok(patterns.includes('<div class="dc-value">Layout</div>'));
  assert.ok(patterns.includes('<p>No exclamation marks. &lt;b&gt;never markup&lt;/b&gt;</p>'));
  assert.ok(!patterns.includes('<b>'));

  const brand = sectionOf(html, 'brand');
  assert.ok(brand.includes('data-dc-entry="brand:hero"'));
  assert.ok(brand.includes('<div class="dc-value">Marketing</div>'));
  assert.ok(brand.includes('<p>Shot in daylight.</p>'));
  assert.ok(brand.includes('data-dc-entry="logo:0"') && brand.includes('data-dc-entry="logo:1"'));
  assert.ok(brand.includes('<img class="dc-logo" src="assets/logos/mark.svg" alt="mark">'));

  const assets = sectionOf(html, 'assets');
  assert.ok(!assets.includes('logo'), 'no logos left in Assets');
  assert.ok(assets.includes('<h3>Font files</h3>') && assets.includes('<li>inter.woff2</li>'));
  assert.ok(assets.includes('<li>brand-guide.pdf</li>'));

  for (const key of ['pattern:voice', 'brand:hero', 'logo:0']) {
    assert.ok(isBoardEntryKey(key), key);
    const parsed = parseEntryKey(key);
    assert.ok(parsed);
    assert.equal(sectionOf(html, sectionOfEntry(parsed, boardFixture()) ?? 'none').includes(`data-dc-entry="${key}"`), true, key);
  }
});

test('hostile pattern and brand text never becomes markup', () => {
  const hostile = '</section><script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  const base = boardFixture();
  const detail: SystemDetail = {
    ...base,
    patterns: [{ id: 'voice', kind: hostile, title: hostile, note: hostile, text: `${hostile}\n\n${hostile}`, problem: hostile, layout: null, example: null }],
    brand: [{ id: 'Bad Id', kind: 'other', title: hostile, note: '', text: null, problem: null, layout: null, example: null }],
  };
  const html = buildBoardHtml(detail, { scheme: 'light' });
  assert.equal((html.match(/<script\b/gi) ?? []).length, 1, 'only the board script');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes(escapeHtml(hostile)));
  // An id off the pattern is shown but carries no entry key.
  assert.ok(!html.includes('brand:Bad Id'));
  for (const match of html.matchAll(/data-dc-entry="([^"]*)"/g)) assert.ok(isBoardEntryKey(match[1] ?? ''), match[1]);
});

test('an uncovered area says so on every one of its sections, and still shows entries written there', () => {
  const detail = boardFixture({ ...BOARD_FIXTURE_JSON, coverage: ['foundations', 'components'] });
  assert.deepEqual(detail.coverage, ['foundations', 'components']);
  const html = buildBoardHtml(detail, { scheme: 'light', ...OPTIONS });
  const line = `<p class="dc-empty dc-not-covered">${escapeHtml(NOT_COVERED_SENTENCE)}</p>`;
  for (const id of ['patterns', 'brand', 'assets']) assert.ok(sectionOf(html, id).includes(line), id);
  for (const id of OLD_SECTIONS) assert.ok(!sectionOf(html, id).includes(line), id);
  // Nothing is hidden: the agent's entries in uncovered sections are still there.
  assert.ok(sectionOf(html, 'patterns').includes('data-dc-entry="pattern:voice"'));
  assert.ok(sectionOf(html, 'brand').includes('data-dc-entry="logo:0"'));

  // An empty uncovered section shows the line only, not "No … yet."
  const empty = boardFixture({ coverage: ['foundations'] });
  const components = renderSpecimenSection(empty, 'components');
  assert.ok(components.includes(line));
  assert.ok(!components.includes('No components yet.'));
  const colours = renderSpecimenSection(empty, 'colours');
  assert.ok(colours.includes('data-dc-entry="token:--brand"') && !colours.includes(line));
});

test('empty covered sections name what goes there', () => {
  const empty = boardFixture({});
  assert.ok(renderSpecimenSection(empty, 'patterns').includes('No patterns or voice guidance yet.'));
  assert.ok(renderSpecimenSection(empty, 'brand').includes('No brand guidance or logos yet.'));
  assert.ok(renderSpecimenSection(empty, 'assets').includes('No font or source files yet.'));
});

test('without an example part a component card has no example (the living page passes its own)', () => {
  const section = renderSpecimenSection(boardFixture(), 'components');
  assert.ok(section.includes('data-dc-entry="component:button"'));
  assert.ok(!section.includes('<template') && !section.includes("couldn&#39;t be shown"));
});

test('overview, notes and pattern bodies render as markdown on the board', () => {
  const base = boardFixture();
  const detail: SystemDetail = {
    ...base,
    overview: { text: '# Nexus design system\n\nThe system for **Pentima Nexus**.\n\n## The look\n\n- Brand blue `#00A0E0` for links.\n- See [the docs](https://example.com/look).', problem: null },
    notes: [{ id: 'history', title: 'Why the palette changed', text: '## Contrast\n\nThe old blue failed **AA**.\n\n```\n--old: #1a73e8;\n```', problem: null, layout: null }],
    patterns: [{ id: 'voice', kind: 'voice', title: 'Voice and tone', note: '', text: 'Plain words.\n\n> No exclamation marks.', problem: null, layout: null, example: null }],
  };
  const html = buildBoardHtml(detail, { scheme: 'light' });
  const overview = sectionOf(html, 'overview');
  assert.ok(overview.includes('<h3 class="dc-md-h3">Nexus design system</h3>'), overview);
  assert.ok(overview.includes('<strong>Pentima Nexus</strong>'), overview);
  assert.ok(overview.includes('<h4 class="dc-md-h4">The look</h4>'), overview);
  assert.ok(overview.includes('<ul class="dc-md-list"><li><p>Brand blue <code class="dc-md-code">#00A0E0</code> for links.</p></li>'), overview);
  assert.ok(overview.includes('<a class="dc-md-link" href="https://example.com/look" rel="noopener noreferrer" target="_blank">the docs</a>'), overview);
  assert.ok(overview.includes('<h4 class="dc-md-h4">Contrast</h4>'), overview);
  assert.ok(overview.includes('<pre class="dc-md-pre"><code>--old: #1a73e8;</code></pre>'), overview);
  const patterns = sectionOf(html, 'patterns');
  assert.ok(patterns.includes('<blockquote class="dc-md-quote"><p>No exclamation marks.</p></blockquote>'), patterns);
  assert.ok(html.includes('.dc-section .dc-md-h3'), 'the board carries the markdown CSS');
});

test('hostile markdown in a note stays escaped text on the board', () => {
  const base = boardFixture();
  const detail: SystemDetail = {
    ...base,
    notes: [{ id: 'history', title: 'Why', text: '# Hi\n\n<script>alert(1)</script>\n\n[x](javascript:alert(2))\n\n```\n</code></pre><img src=x onerror=alert(3)>\n```', problem: null, layout: null }],
  };
  const html = buildBoardHtml(detail, { scheme: 'light' });
  assert.equal((html.match(/<script\b/gi) ?? []).length, 1, 'only the board script');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('a note whose body opens with its own title shows that heading once', () => {
  const detail: SystemDetail = {
    ...boardFixture(),
    notes: [{ id: 'history', title: 'Why the palette changed', text: '# Why the palette changed\n\nThe old blue failed contrast.', problem: null, layout: null }],
  };
  const overview = sectionOf(buildBoardHtml(detail, { scheme: 'light' }), 'overview');
  assert.equal((overview.match(/Why the palette changed/g) ?? []).length, 1, overview);
  assert.ok(overview.includes('<p>The old blue failed contrast.</p>'), overview);
});

// ---- layout runs (documentation/specs/system-board-layout-and-visual-check.md §A.3) ----

const runsFixture = (json: Record<string, unknown>): SystemDetail => boardFixture({ ...BOARD_FIXTURE_JSON, ...json });

test('runs keep the agent order: compact, compact, full, compact is three runs', () => {
  const detail = runsFixture({
    components: [
      { id: 'a', name: 'A', layout: 'compact' },
      { id: 'b', name: 'B', layout: 'compact' },
      { id: 'c', name: 'C', layout: 'full' },
      { id: 'd', name: 'D', layout: 'compact' },
    ],
  });
  const section = renderSpecimenSection(detail, 'components');
  const containers = [...section.matchAll(/<div class="(dc-grid dc-components[^"]*|dc-run-full)">/g)].map((match) => match[1]);
  assert.deepEqual(containers, ['dc-grid dc-components dc-run-compact', 'dc-run-full', 'dc-grid dc-components dc-run-compact']);
  const order = [...section.matchAll(/data-dc-entry="component:([a-d])"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'the agent order is never changed');
  // The first compact run holds a and b; the full run holds c; the last compact run holds d.
  const first = section.slice(section.indexOf('dc-run-compact'), section.indexOf('dc-run-full'));
  assert.ok(first.includes('component:a') && first.includes('component:b') && !first.includes('component:c'));
});

test('a section default applies to entries without their own hint; the entry hint wins', () => {
  const detail = runsFixture({ layout: { components: 'compact' }, components: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', layout: 'card' }] });
  const section = renderSpecimenSection(detail, 'components');
  assert.ok(section.includes('<div class="dc-grid dc-components dc-run-compact"><div class="dc-card dc-fit" data-dc-entry="component:a">'));
  assert.ok(section.includes('<div class="dc-grid dc-components dc-run-card"><div class="dc-card dc-fit" data-dc-entry="component:b">'));
});

test('component table rows carry the entry key, the roles and dc-fit; cells escape hostile text', () => {
  const hostile = '</div><script>alert(1)</script>"\'&';
  const detail = runsFixture({
    layout: { components: 'table' },
    components: [{ id: 'table', name: hostile, purpose: hostile, note: hostile, variants: [hostile], source: hostile, example: 'components/table.html' }],
  });
  const section = renderSpecimenSection(detail, 'components', { example: () => '<div class="dc-muted">example part</div>' });
  assert.ok(section.includes('<div class="dc-run-table" role="table" aria-label="Components">'));
  assert.ok(section.includes('<div class="dc-thead" role="row">'));
  for (const header of ['Name', 'Preview', 'Notes']) assert.ok(section.includes(`role="columnheader">${header}</div>`), header);
  assert.ok(section.includes('<div class="dc-trow dc-fit" role="row" data-dc-entry="component:table">'));
  assert.ok(section.includes('<div class="dc-tcell dc-tcell-name" role="cell">'));
  assert.ok(section.includes('<div class="dc-tcell dc-tcell-preview" role="cell">'));
  assert.ok(section.includes('<div class="dc-tcell dc-tcell-notes" role="cell">'));
  assert.ok(section.includes(escapeHtml(hostile)));
  assert.ok(!section.includes('<script>alert'));
  // No dc-fit on anything but the row in a table run.
  assert.equal((section.match(/dc-fit/g) ?? []).length, 1);
});

test('text and token tables carry their entry keys and headers; no dc-fit (no live preview to measure)', () => {
  const detail = runsFixture({
    layout: { overview: 'table', patterns: 'table', brand: 'table', colours: 'table', spacing: 'table' },
    notes: [{ id: 'history', title: 'Why the palette changed' }],
  });
  const overview = renderSpecimenSection(detail, 'overview');
  // No note on any entry: the Note column is left out (two columns).
  assert.ok(overview.includes('<div class="dc-run-table dc-table-two" role="table" aria-label="Notes">'));
  assert.ok(overview.includes('<div class="dc-trow" role="row" data-dc-entry="note:history">'));
  for (const header of ['Title', 'Guidance']) assert.ok(overview.includes(`role="columnheader">${header}</div>`), header);
  assert.ok(!overview.includes('role="columnheader">Note</div>') && !overview.includes('dc-tcell-notes'));
  assert.ok(!overview.includes('dc-fit'));
  // The overview text itself stays full width, outside the table.
  assert.ok(overview.includes('<div class="dc-text" data-dc-entry="overview">'));

  const patterns = renderSpecimenSection(detail, 'patterns');
  assert.ok(patterns.includes('data-dc-entry="pattern:voice"') && patterns.includes('role="table" aria-label="Patterns &amp; voice"'));
  const brand = renderSpecimenSection(detail, 'brand');
  assert.ok(brand.includes('data-dc-entry="brand:hero"'));
  // Logos keep their cards even when brand entries are a table.
  assert.ok(brand.includes('<div class="dc-card" data-dc-entry="logo:0">'));

  const colours = renderSpecimenSection(detail, 'colours');
  assert.ok(colours.includes('role="columnheader">Sample</div>') && colours.includes('role="columnheader">Token</div>') && colours.includes('role="columnheader">Note</div>'));
  // Token tables size their token column to the names, not to three fifths of the board.
  assert.ok(colours.includes('<div class="dc-run-table dc-table-tokens" role="table"'));
  assert.ok(colours.includes('<div class="dc-trow" role="row" data-dc-entry="token:--brand">'));
  assert.ok(!colours.includes('dc-fit'));
  const spacing = renderSpecimenSection(detail, 'spacing');
  assert.ok(spacing.includes('data-dc-entry="token:--space-2"') && spacing.includes('dc-run-table'));
});

test('colour groups keep their headings and form runs inside each group', () => {
  const detail = runsFixture({ layout: { colours: 'table' } });
  const colours = renderSpecimenSection(detail, 'colours');
  const brandAt = colours.indexOf('<h3>Brand</h3>');
  const surfaceAt = colours.indexOf('<h3>Surface</h3>');
  assert.ok(brandAt !== -1 && surfaceAt > brandAt);
  const brandGroup = colours.slice(brandAt, surfaceAt);
  assert.ok(brandGroup.includes('dc-run-table') && brandGroup.includes('token:--brand'));
  assert.ok(!brandGroup.includes('token:--surface'), 'the surface token stays in its own group');
  // Tokens have no per-entry hints: one section default makes the whole group one run.
  const mixed = runsFixture({
    tokensCss: ':root { --a: #111111; --b: #222222; --c: #333333; }',
    tokens: { '--a': { group: 'brand' }, '--b': { group: 'brand' }, '--c': { group: 'brand' } },
    layout: { colours: 'compact' },
  });
  const section = renderSpecimenSection(mixed, 'colours');
  assert.equal((section.match(/dc-run-compact/g) ?? []).length, 1, 'one section default, one run per group');
});

test('dc-fit marks only component cards in card and compact runs, never full cards, text or tokens', () => {
  const detail = runsFixture({
    components: [
      { id: 'a', name: 'A', layout: 'card', example: 'components/a.html' },
      { id: 'b', name: 'B', layout: 'compact', example: 'components/b.html' },
      { id: 'c', name: 'C', layout: 'full', example: 'components/c.html' },
    ],
    layout: { overview: 'compact', colours: 'compact' },
  });
  const components = renderSpecimenSection(detail, 'components', { example: () => '' });
  const fitted = [...components.matchAll(/class="([^"]*dc-fit[^"]*)" data-dc-entry="([^"]*)"/g)].map((match) => match[2]);
  assert.deepEqual(fitted, ['component:a', 'component:b']);
  const overview = renderSpecimenSection(detail, 'overview');
  assert.ok(!overview.includes('dc-fit'));
  const colours = renderSpecimenSection(detail, 'colours');
  assert.ok(!colours.includes('dc-fit'));
});

test('notes: a card run keeps the loose cards, compact a text grid, full one column, table rows', () => {
  const notes = [
    { id: 'n1', title: 'One' },
    { id: 'n2', title: 'Two', layout: 'compact' },
    { id: 'n3', title: 'Three', layout: 'full' },
    { id: 'n4', title: 'Four', layout: 'table' },
  ];
  const section = renderSpecimenSection(runsFixture({ notes }), 'overview');
  assert.ok(section.includes('<div class="dc-card dc-text" data-dc-entry="note:n1">'), 'card run stays loose as today');
  assert.ok(section.includes('<div class="dc-grid dc-text-grid dc-run-compact"><div class="dc-card dc-text" data-dc-entry="note:n2">'));
  assert.ok(section.includes('<div class="dc-run-full"><div class="dc-card dc-text" data-dc-entry="note:n3">'));
  // n4's body file is missing, so it carries a problem and the table keeps its Note column for it.
  assert.ok(section.includes('<div class="dc-run-table" role="table" aria-label="Notes">'));
  assert.ok(section.includes('data-dc-entry="note:n4"') && section.includes('dc-tcell-notes'));
});

test('a text table keeps its Note column when any entry has a note or a problem; the others get an empty cell', () => {
  const detail = runsFixture({
    layout: { patterns: 'table' },
    patterns: [
      { id: 'quiet', kind: 'voice', title: 'Quiet' },
      { id: 'loud', kind: 'voice', title: 'Loud', note: 'Only for alerts.' },
    ],
  });
  const patterns = renderSpecimenSection(detail, 'patterns');
  assert.ok(patterns.includes('<div class="dc-run-table" role="table" aria-label="Patterns &amp; voice">'));
  assert.ok(patterns.includes('role="columnheader">Note</div>'));
  assert.equal((patterns.match(/dc-tcell-notes/g) ?? []).length, 2, 'every row has the cell, so the columns line up');
  assert.ok(patterns.includes('<div class="dc-note">Only for alerts.</div>'));
});

test('an invalid hint falls back without a trace in the markup', () => {
  const detail = runsFixture({ components: [{ id: 'a', name: 'A', layout: 'wide' }], layout: { components: 'bogus' } });
  const section = renderSpecimenSection(detail, 'components');
  assert.ok(section.includes('<div class="dc-grid dc-components dc-run-card">'), 'falls back to card');
  assert.equal(detail.boardLayout.ignoredCount, 2);
});

// ---- markdown bodies inside every layout (the markdown renderer and the layout runs together) ----

test('markdown bodies render inside card, compact, full and table runs, in both profiles; a note title is shown once', () => {
  const md = '# Same title\n\nUse **bold** words.\n\n## Part\n\n- one\n- two\n\n```\ncode here\n```';
  const four = ['card', 'compact', 'full', 'table'] as const;
  const base = runsFixture({});
  const detail: SystemDetail = {
    ...base,
    notes: four.map((layout) => ({ id: `n-${layout}`, title: 'Same title', text: md, problem: null, layout })),
    patterns: four.map((layout) => ({ id: `p-${layout}`, kind: 'voice', title: `Pattern ${layout}`, note: '', text: md, problem: null, layout, example: null })),
  };
  // Each entry's own block: from its entry mark to the next one.
  const blockOf = (html: string, key: string): string => {
    const at = html.indexOf(`data-dc-entry="${key}"`);
    assert.ok(at !== -1, key);
    const next = html.indexOf('data-dc-entry="', at + 1);
    return html.slice(at, next === -1 ? undefined : next);
  };
  for (const profile of ['board', 'living'] as const) {
    const overview = renderSpecimenSection(detail, 'overview', { markdown: profile });
    const patterns = renderSpecimenSection(detail, 'patterns', { markdown: profile });
    for (const layout of four) {
      const note = blockOf(overview, `note:n-${layout}`);
      assert.ok(note.includes('<strong>bold</strong>'), `${profile} note ${layout}: ${note}`);
      assert.ok(note.includes('<ul class="dc-md-list">'), `${profile} note ${layout}: a list`);
      // The note's leading "# Same title" repeats its title: dropped in cards and table rows alike.
      assert.equal((note.match(/Same title/g) ?? []).length, 1, `${profile} note ${layout}: ${note}`);
      const pattern = blockOf(patterns, `pattern:p-${layout}`);
      assert.ok(pattern.includes('<strong>bold</strong>') && pattern.includes('dc-md-list'), `${profile} pattern ${layout}: ${pattern}`);
      if (profile === 'board') assert.ok(pattern.includes('<pre class="dc-md-pre">'), `board pattern ${layout}: a code block`);
      else assert.ok(!pattern.includes('<pre') && pattern.includes('<div class="dc-md-pre">'), `living pattern ${layout}: the allowlist form`);
    }
    // Table rows put the body in the guidance cell.
    assert.ok(/data-dc-entry="pattern:p-table"><div class="dc-tcell dc-tcell-name" role="cell">[\s\S]*?<div class="dc-tcell dc-tcell-preview" role="cell"><div class="dc-body"><h3 class="dc-md-h3">Same title<\/h3>/.test(patterns), 'a pattern keeps its own heading (only notes drop the title)');
  }
});
