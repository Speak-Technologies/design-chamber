// The living page document (documentation/specs/phase-2-5-technical.md §5.11, §5.14, rev 3, T14): mode
// copy, the footer and its fonts line, path redaction, the preview band, example figures, determinism
// and the size of a large system. Each page here is scanned with the allowlist.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIVING_PAGE_MAX_BYTES } from '../../../src/shared/limits.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import {
  buildLivingPage,
  DESCRIBE_MODE_LINE,
  EXAMPLE_REASON_SENTENCES,
  FONT_TOO_LARGE_SENTENCE,
  FONTS_EMBEDDED_LINE,
  FONTS_FALLBACK_LINE,
  type LivingExampleShot,
  type LivingPageInput,
  openingLine,
  previewBandText,
  VALUES_IN_CODE_LINE,
} from '../../../src/service/systems/living-html.ts';
import { livingCssProblems, scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { boardFixture } from './board-fixture.ts';

// Logos are relative refs the bundler inlines; these document-level tests leave them out.
const fixture = (): SystemDetail => ({ ...boardFixture(), logos: [] });
const INPUT: LivingPageInput = { revision: 3, generatedAt: '2026-11-19T10:00:00.000Z', coverage: fixture().coverage, redact: [] };
const build = (detail: SystemDetail, over: Partial<LivingPageInput> = {}): string => buildLivingPage(detail, { ...INPUT, ...over }).html;
const safe = (html: string): void => assert.deepEqual(scanLivingPage(html).reasons, []);

// A 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const REPO_HOME: SystemDetail['home'] = { kind: 'repo', directory: '/work/shop', label: 'shop', folder: 'design-system', livingPage: 'design-system/index.html', readable: true, problem: null, lastRead: null };
const buildView = (mode: 'fix' | 'describe' | 'none') => ({ mode, dark: true, calls: [], access: null, round: 'done' as const, applied: null });
const drift = (differ: number) => ({ at: '2026-11-20T09:00:00.000Z', mode: 'fix' as const, differ, names: [], partial: false, unread: [] });

test('the page is safe, normalised and marked', () => {
  const html = build(fixture());
  safe(html);
  assert.ok(html.startsWith('<!doctype html>\n'));
  assert.ok(html.endsWith('</html>\n'));
  assert.ok(!html.includes('\r') && !html.includes('\t'));
  assert.ok(!/[ \t]\n/.test(html));
  assert.match(html, /<meta name="dc-living-page" content="design-chamber\/living-page@1 system=acme revision=3 generated=2026-11-19T10:00:00.000Z hash=0{64}">/);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes(' style="'));
});

test('the opening line follows the mode', () => {
  const internal = fixture();
  assert.equal(openingLine({ ...internal, build: null }), `These are the values in ${internal.name}.`);
  const repo = { ...internal, home: REPO_HOME };
  assert.equal(openingLine({ ...repo, build: buildView('none') }), 'These are the values in shop/design-system.');
  assert.equal(openingLine({ ...repo, build: buildView('fix'), codeDrift: drift(0) }), VALUES_IN_CODE_LINE);
  assert.equal(openingLine({ ...repo, build: buildView('fix'), codeDrift: drift(3) }), 'These are the values in shop/design-system.');
  assert.equal(openingLine({ ...repo, build: buildView('describe'), codeDrift: drift(3) }), DESCRIBE_MODE_LINE);
  const html = build({ ...repo, build: buildView('describe'), codeDrift: drift(3) });
  assert.ok(html.includes(`<p class="lp-lede">${DESCRIBE_MODE_LINE}</p>`));
  safe(html);
});

test('the footer names the revision and date and says how fonts are shown, either way', () => {
  const fallback = build(fixture());
  assert.ok(fallback.includes('Acme · revision 3 · generated 19 Nov 2026'));
  assert.ok(fallback.includes(FONTS_FALLBACK_LINE.replace("'", '&#39;')) || fallback.includes(FONTS_FALLBACK_LINE));
  assert.ok(!fallback.includes('@font-face'));
  const embedded = build(fixture(), { fonts: 'embedded', fontData: { 'assets/fonts/inter.woff2': 'data:font/woff2;base64,d09GMgABAAAAAA==' } });
  assert.ok(embedded.includes(FONTS_EMBEDDED_LINE));
  assert.ok(embedded.includes('@font-face { font-family: "Inter"; src: url("data:font/woff2;base64,d09GMgABAAAAAA==")'));
  safe(embedded);
  safe(fallback);
});

test('font data is never written for fallback, and a bad payload is never written at all', () => {
  const data = { 'assets/fonts/inter.woff2': 'data:font/woff2;base64,d09GMgABAAAAAA==' };
  assert.ok(!build(fixture(), { fonts: 'fallback', fontData: data }).includes('@font-face'));
  const bad = build(fixture(), { fonts: 'embedded', fontData: { 'assets/fonts/inter.woff2': 'data:font/woff2;base64,AA"); } body { x: url("https://example.com/' } });
  assert.ok(!bad.includes('@font-face'));
  safe(bad);
});

test('a font left out is named in the footer', () => {
  const html = build(fixture(), { fonts: 'embedded', fontsLeftOut: [{ file: 'assets/fonts/inter.woff2', reason: 'too-large' }] });
  assert.ok(html.includes(`Inter: ${FONT_TOO_LARGE_SENTENCE}`));
  safe(html);
});

test('local paths in shown text read as …', () => {
  const detail = fixture();
  const hostile: SystemDetail = {
    ...detail,
    notes: detail.notes.map((note) => ({ ...note, text: 'Moved from /home/sam/Documents/Designs/_systems/acme/notes and /work/shop/src.' })),
    components: detail.components.map((component, index) => (index === 0 ? { ...component, source: '/work/shop/src/Button.tsx', note: 'See C:\\Users\\sam\\shop.' } : component)),
  };
  const html = build(hostile, { redact: ['/home/sam/Documents/Designs', '/work/shop', '/home/sam', 'C:\\Users\\sam'] });
  assert.ok(!html.includes('/home/sam'));
  assert.ok(!html.includes('/work/shop'));
  assert.ok(!html.includes('Users\\sam'));
  assert.ok(html.includes('Moved from …/_systems/acme/notes and …/src.'));
  assert.ok(!html.includes('Button.tsx'), 'an absolute component source is left out');
  safe(html);
});

test('component examples are PNG pictures per scheme, or the sentence that says why not', () => {
  const examples: Record<string, LivingExampleShot[]> = {
    button: [
      { scheme: 'light', png: { base64: PNG, width: 720, height: 120 }, reason: null },
      { scheme: 'dark', png: null, reason: 'budget' },
    ],
    card: [{ scheme: 'light', png: null, reason: 'no-browser' }],
  };
  const html = build(fixture(), { examples });
  assert.equal(html.split(`src="data:image/png;base64,${PNG}"`).length - 1, 1);
  assert.ok(html.includes(EXAMPLE_REASON_SENTENCES.budget));
  assert.ok(html.includes(EXAMPLE_REASON_SENTENCES['no-browser'].replace("'", '&#39;')) || html.includes(EXAMPLE_REASON_SENTENCES['no-browser']));
  assert.ok(!html.includes('<iframe'));
  safe(html);
});

test('a preview has the band and no mark', () => {
  const preview = { proposal: 'p_abcd1234', home: 'shop/design-system' };
  const html = build(fixture(), { preview });
  assert.equal(previewBandText(preview), 'Preview of proposal p_abcd1234 · not generated from shop/design-system yet');
  assert.ok(html.includes(`<p class="lp-preview" role="note">${previewBandText(preview)}</p>`));
  assert.ok(!html.includes('dc-living-page'));
  const scan = scanLivingPage(html);
  assert.equal(scan.safe, true);
  assert.equal(scan.mark, null);
});

test('the same detail and input give the same bytes', () => {
  const examples = { button: [{ scheme: 'light' as const, png: { base64: PNG, width: 720, height: 120 }, reason: null }] };
  const a = buildLivingPage(fixture(), { ...INPUT, examples });
  const b = buildLivingPage(fixture(), { ...INPUT, examples });
  assert.equal(a.html, b.html);
  assert.deepEqual(a.ranges, b.ranges);
});

test('a tab, a CR or trailing blanks in system text still give a normalised page', () => {
  const detail = fixture();
  const messy = { ...detail, overview: { text: 'Calm\tand clear.  \r\nSecond line.\r\n', problem: null } };
  const html = build(messy);
  assert.ok(!html.includes('\r') && !html.includes('\t'));
  assert.ok(!/[ \t]\n/.test(html));
  safe(html);
});

test('2000 tokens and 200 components stay well under the page bound', () => {
  const detail = fixture();
  const base = detail.tokens.find((token) => token.name === '--brand');
  const component = detail.components.find((candidate) => candidate.id === 'button');
  assert.ok(base !== undefined && component !== undefined);
  const tokens = Array.from({ length: 2000 }, (_, i) => ({
    ...base,
    name: `--colour-${i}`,
    note: `Token ${i}: a longer note so the page carries real text, as a big system would.`,
    light: { text: `#${(i * 2531).toString(16).padStart(6, '0').slice(-6)}`, editable: 'ok' as const, problem: null },
  }));
  const components = Array.from({ length: 200 }, (_, i) => ({ ...component, id: `part-${i}`, name: `Part ${i}`, tokens: [`--colour-${i}`] }));
  const examples: Record<string, LivingExampleShot[]> = {};
  for (const part of components) examples[part.id] = [{ scheme: 'light', png: null, reason: 'no-browser' }];
  const started = Date.now();
  const html = build({ ...detail, tokens, components }, { examples });
  const bytes = Buffer.byteLength(html, 'utf8');
  assert.ok(bytes < LIVING_PAGE_MAX_BYTES, `${bytes} bytes`);
  assert.ok(html.includes('--colour-1999'));
  assert.ok(html.includes('Part 199'));
  safe(html);
  assert.ok(Date.now() - started < 30_000);
});

test('markdown bodies stay inside the allowlist: no pre, blockquote, h5/h6 or link that leaves', () => {
  const rich = '# Title\n\n## Part\n\n### Deeper\n\n```css\na { b: c; }\n```\n\n> quote\n\n- one\n  - two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n[out](https://example.com) and [in](#note-anchor)';
  const html = build({ ...fixture(), overview: { text: rich, problem: null }, notes: [{ id: 'history', title: 'Why', text: rich, problem: null, layout: null }] });
  safe(html);
  for (const forbidden of ['<pre', '<blockquote', '<h5', '<h6', 'target=', 'rel=']) assert.ok(!html.includes(forbidden), forbidden);
  assert.ok(html.includes('<div class="dc-md-pre"><code>a { b: c; }</code></div>'), 'code block as a pre-wrap div');
  assert.ok(html.includes('out (https://example.com)'), 'a link that leaves is text and address');
  assert.ok(html.includes('<a class="dc-md-link" href="#note-anchor">in</a>'), 'a fragment link stays a link');
});

// ---- layout runs on the living page (system-board-layout-and-visual-check.md §A.6) ----

test('all four layouts in every section that takes them: the page stays safe, marked and stripped of entry marks', () => {
  const base = fixture();
  const four = ['card', 'compact', 'full', 'table'] as const;
  const detail: SystemDetail = {
    ...base,
    components: base.components.map((component, index) => ({ ...component, layout: four[index] ?? null })),
    notes: four.map((layout, index) => ({ id: `n${index}`, title: `Note ${index}`, text: 'Body.', problem: null, layout })),
    patterns: four.map((layout, index) => ({ id: `p${index}`, kind: 'other', title: `Pattern ${index}`, note: '', text: 'Body.', problem: null, layout, example: null })),
    brand: four.map((layout, index) => ({ id: `b${index}`, kind: 'other', title: `Brand ${index}`, note: '', text: 'Body.', problem: null, layout, example: null })),
    boardLayout: {
      sections: { components: 'table', overview: 'full', patterns: 'compact', brand: 'card', colours: 'table', spacing: 'compact', radius: 'card', shadows: 'table', sizes: 'compact' },
      ignored: [],
      ignoredCount: 0,
    },
  };
  const html = build(detail);
  safe(html);
  assert.ok(html.includes('dc-run-table') && html.includes('dc-run-full') && html.includes('dc-run-compact'));
  assert.ok(!/data-dc-/.test(html), 'the entry marks are stripped from table rows too');
  assert.ok(html.includes('role="table"') && html.includes('role="row"') && html.includes('role="columnheader"'));
  // The run CSS survived addCss: a refused rule would be dropped silently.
  for (const rule of ['.dc-run-table {', '.dc-thead, .dc-trow {', '@media (max-width: 720px) {', '.dc-components.dc-run-compact {', '.dc-run-full {', '.dc-grid.dc-run-compact {', '.dc-run-compact .dc-swatch {', '.dc-run-table.dc-table-tokens {', '.dc-run-table.dc-table-two {', '.dc-text p, .dc-body p, .dc-md-list, .dc-md-quote, .dc-note { max-width: 90ch; }']) {
    assert.ok(html.includes(rule), rule);
  }
  // Every CSS line of the page passes the allowlist on its own (the generator drops any that would not).
  const css = /<style>\n([\s\S]*?)\n<\/style>/.exec(html)?.[1] ?? '';
  assert.ok(css.length > 0);
  for (const line of css.split('\n')) {
    if (line.trim() === '') continue;
    assert.deepEqual(livingCssProblems(line), [], line);
  }
});
