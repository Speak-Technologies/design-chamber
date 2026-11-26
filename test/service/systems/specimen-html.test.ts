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
    ...['overview', 'colours', 'typography', 'spacing', 'radius', 'shadows', 'layers', 'sizes'].map((id) => `section:${id}`),
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
    patterns: [{ id: 'voice', kind: hostile, title: hostile, note: hostile, text: `${hostile}\n\n${hostile}`, problem: hostile, layout: null }],
    brand: [{ id: 'Bad Id', kind: 'other', title: hostile, note: '', text: null, problem: null, layout: null }],
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
    notes: [{ id: 'history', title: 'Why the palette changed', text: '## Contrast\n\nThe old blue failed **AA**.\n\n```\n--old: #1a73e8;\n```', problem: null }],
    patterns: [{ id: 'voice', kind: 'voice', title: 'Voice and tone', note: '', text: 'Plain words.\n\n> No exclamation marks.', problem: null }],
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
    notes: [{ id: 'history', title: 'Why', text: '# Hi\n\n<script>alert(1)</script>\n\n[x](javascript:alert(2))\n\n```\n</code></pre><img src=x onerror=alert(3)>\n```', problem: null }],
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
    notes: [{ id: 'history', title: 'Why the palette changed', text: '# Why the palette changed\n\nThe old blue failed contrast.', problem: null }],
  };
  const overview = sectionOf(buildBoardHtml(detail, { scheme: 'light' }), 'overview');
  assert.equal((overview.match(/Why the palette changed/g) ?? []).length, 1, overview);
  assert.ok(overview.includes('<p>The old blue failed contrast.</p>'), overview);
});
