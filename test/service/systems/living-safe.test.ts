// The living page's allowlist scanner and normalised hash (documentation/specs/phase-2-5-technical.md
// §5.11, §2.14 rev 3, T14): every hostile construct is a reason, a generated page is safe, and the hash
// survives line ends and trailing blanks but not a re-indent.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLivingPage } from '../../../src/service/systems/living-html.ts';
import { committedStateOf, withPageHash } from '../../../src/service/systems/living-page.ts';
import { normaliseForHash, readLivingPageMark, scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { boardFixture } from './board-fixture.ts';

// Without logos: the generator writes them as relative refs that the bundler inlines (living-page tests).
const detail = { ...boardFixture(), logos: [] };
const generated = (): string =>
  withPageHash(buildLivingPage(detail, { revision: 7, generatedAt: '2026-11-19T10:00:00.000Z', coverage: detail.coverage, redact: [] }).html).html;

const PAGE = generated();
const inBody = (fragment: string): string => PAGE.replace('</main>', `${fragment}\n</main>`);
const inHead = (fragment: string): string => PAGE.replace('<title>', `${fragment}\n<title>`);
const inCss = (css: string): string => PAGE.replace('</style>', `${css}\n</style>`);

test('the generated page is safe and carries its mark', () => {
  const scan = scanLivingPage(PAGE);
  assert.deepEqual(scan.reasons, []);
  assert.equal(scan.safe, true);
  assert.equal(scan.mark?.system, 'acme');
  assert.equal(scan.mark?.revision, 7);
});

const HOSTILE: Readonly<Record<string, string>> = {
  // Scripts and handlers.
  script: inBody('<script>alert(1)</script>'),
  'script upper case': inBody('<SCRIPT>alert(1)</SCRIPT>'),
  'script with a src': inBody('<script src="data:text/javascript;base64,YWxlcnQoMSk="></script>'),
  onclick: inBody('<p onclick="alert(1)">x</p>'),
  onerror: inBody('<img src="data:image/png;base64,AAAA" alt="" onerror="alert(1)">'),
  'ON upper case': inBody('<p ONMOUSEOVER="alert(1)">x</p>'),
  'on with spaces': inBody('<div onfocus = "alert(1)" tabindex="0">x</div>'),
  onanimationstart: inBody('<p class="x" onanimationstart="alert(1)">x</p>'),
  // javascript: with entities and whitespace.
  'javascript href': inBody('<a href="javascript:alert(1)">x</a>'),
  'javascript with a tab entity': inBody('<a href="jav&#x09;ascript:alert(1)">x</a>'),
  'javascript with a leading space': inBody('<a href=" javascript:alert(1)">x</a>'),
  'javascript as a decimal entity': inBody('<a href="&#106;avascript:alert(1)">x</a>'),
  'javascript with a newline': inBody('<a href="java\nscript:alert(1)">x</a>'),
  srcdoc: inBody('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'),
  'srcdoc on a div': inBody('<div srcdoc="x">x</div>'),
  // Foreign content.
  'svg style img onerror': inBody('<svg><style><img src="x" onerror="alert(1)"></style></svg>'),
  'svg animate': inBody('<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text y="20">x</text></a></svg>'),
  'svg set': inBody('<svg><set attributeName="onmouseover" to="alert(1)"/></svg>'),
  'svg a href': inBody('<svg><a href="javascript:alert(1)"><text y="20">x</text></a></svg>'),
  'svg use href': inBody('<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"/></svg>'),
  math: inBody('<math><mtext><table><mglyph><style><img src="x" onerror="alert(1)"></style></mglyph></table></mtext></math>'),
  // Comments and raw-text elements a browser reads its own way.
  'comment ending --!>': inBody('<!-- x --!><img src="x" onerror="alert(1)">'),
  'plain comment': inBody('<!-- a note -->'),
  template: inBody('<template><script>alert(1)</script></template>'),
  noscript: inBody('<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>'),
  textarea: inBody('<textarea><img src="x" onerror="alert(1)"></textarea>'),
  cdata: inBody('<![CDATA[x]]>'),
  // Attribute quoting the generator never writes.
  'unquoted value': inBody('<p class=x>x</p>'),
  'single-quoted value': inBody("<p class='x'>x</p>"),
  'a bare attribute': inBody('<p hidden>x</p>'),
  // Head elements that change what the page loads or where.
  'meta http-equiv': inHead('<meta http-equiv="refresh" content="0;url=https://example.com/">'),
  'meta csp': inHead('<meta http-equiv="Content-Security-Policy" content="default-src *">'),
  base: inHead('<base href="https://example.com/">'),
  link: inHead('<link rel="stylesheet" href="https://example.com/a.css">'),
  // CSS.
  'css url unquoted': inCss('body { background: url(data:image/png;base64,AAAA); }'),
  'css url with escapes': inCss('body { background: url("\\64 ata:image/png;base64,AAAA"); }'),
  'css escape in a property': inCss('body { b\\61 ckground: red; }'),
  'css @import': inCss('@import url("https://example.com/a.css");'),
  'css @import plain': inCss('@import "a.css";'),
  'css </style> inside': inCss('body { color: red; } </style><script>alert(1)</script><style>'),
  'css relative url': inCss('body { background: url("img/a.png"); }'),
  'css remote url': inCss('body { background: url("https://example.com/a.png"); }'),
  'css image-set': inCss('body { background: image-set("a.png" 1x); }'),
  'css expression': inCss('body { width: expression(alert(1)); }'),
  'css javascript': inCss('body { background: url("javascript:alert(1)"); }'),
  // References the page can't carry.
  'relative img': inBody('<img src="assets/logos/mark.svg" alt="">'),
  'remote img': inBody('<img src="https://example.com/a.png" alt="">'),
  'relative href': inBody('<a href="other.html">x</a>'),
  'remote href': inBody('<a href="https://example.com/">x</a>'),
  'style attribute': inBody('<p style="color: red">x</p>'),
  'iframe': inBody('<iframe src="data:text/html;base64,PHA+"></iframe>'),
  'object': inBody('<object data="data:text/html;base64,PHA+"></object>'),
  'form': inBody('<form action="https://example.com/"><button>x</button></form>'),
  'a second style': inBody('<style>p { color: red; }</style>'),
  'a second body': inBody('<body><p>x</p></body>'),
  'no doctype': PAGE.replace(/^<!doctype html>/i, ''),
};

for (const [name, page] of Object.entries(HOSTILE)) {
  test(`unsafe: ${name}`, () => {
    assert.notEqual(page, PAGE, 'the fixture changed the page');
    const scan = scanLivingPage(page);
    assert.equal(scan.safe, false, `${name} passed the scan`);
    assert.ok(scan.reasons.length > 0 && scan.reasons.length <= 10);
  });
}

test('text that only looks like markup is never a reason', () => {
  const page = inBody('<p>Use &lt;script&gt; never; a &lt; b and javascript: in prose is text.</p>');
  assert.equal(scanLivingPage(page).safe, true);
});

test('a page over the scan bound is too large and not scanned', () => {
  const scan = scanLivingPage(inBody(`<p>${'x'.repeat(22 * 1024 * 1024)}</p>`));
  assert.deepEqual(scan, { safe: false, reasons: ['too large'], mark: null });
  assert.equal(committedStateOf(inBody(`<p>${'x'.repeat(22 * 1024 * 1024)}</p>`), { id: 'acme', name: 'Acme', revision: 7 }).state, 'unreadable');
});

test('the normalised hash is the same for LF, CRLF, a BOM and trailing spaces', () => {
  const crlf = PAGE.replace(/\n/g, '\r\n');
  const trailing = PAGE.replace(/\n/g, '  \t\n');
  const bom = `\uFEFF${PAGE}`;
  const extraEnd = `${PAGE}\n\n\n`;
  for (const variant of [crlf, trailing, bom, extraEnd]) assert.equal(normaliseForHash(variant), normaliseForHash(PAGE));
  for (const variant of [crlf, trailing, bom, extraEnd]) {
    assert.equal(committedStateOf(variant, { id: 'acme', name: 'Acme', revision: 7 }).state, 'fresh');
  }
});

test('a re-indent reads as reformatted at the current revision, changed at another', () => {
  const reindented = PAGE.replace(/\n</g, '\n  <');
  assert.equal(scanLivingPage(reindented).safe, true);
  const current = committedStateOf(reindented, { id: 'acme', name: 'Acme', revision: 7 });
  assert.equal(current.state, 'reformatted');
  assert.equal(current.sentence, 'The living page may have been reformatted since it was generated. Its values are from revision 7, the current one.');
  assert.equal(committedStateOf(reindented, { id: 'acme', name: 'Acme', revision: 9 }).state, 'changed');
});

test('every committed state and its sentence', () => {
  const facts = { id: 'acme', name: 'Acme', revision: 7 };
  assert.deepEqual(committedStateOf(PAGE, facts), { state: 'fresh', revision: 7, sentence: 'Generated from revision 7, the current one.', reasons: [] });
  const later = committedStateOf(PAGE, { ...facts, revision: 9 });
  assert.equal(later.state, 'out-of-date');
  assert.equal(later.sentence, 'Generated from revision 7; Acme is at revision 9.');
  const edited = PAGE.replace('Calm and clear.', 'Calm, clear and edited.');
  assert.equal(committedStateOf(edited, facts).state, 'reformatted');
  assert.equal(committedStateOf(edited, { ...facts, revision: 9 }).state, 'changed');
  const other = committedStateOf(PAGE, { ...facts, id: 'other' });
  assert.equal(other.state, 'changed');
  assert.equal(other.sentence, 'The page in the repo differs from the one Design Chamber generated.');
  const unmarked = committedStateOf(PAGE.replace(/<meta name="dc-living-page"[^>]*>\n/, ''), facts);
  assert.equal(unmarked.state, 'changed');
  const unsafe = committedStateOf(inBody('<script>alert(1)</script>'), facts);
  assert.equal(unsafe.state, 'unsafe');
  assert.equal(unsafe.sentence, "The living page has markup Design Chamber didn't generate and can't check as safe. Ask the agent to update it.");
  assert.ok(unsafe.reasons.length > 0);
});

test('the hash swapped into the mark is the hash of the normalised page', () => {
  const mark = readLivingPageMark(PAGE);
  assert.ok(mark !== null);
  assert.match(mark.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(mark.hash, '0'.repeat(64));
  assert.equal(withPageHash(PAGE.replace(mark.hash, '0'.repeat(64))).hash, mark.hash);
});

test('a page with all four board layouts passes the scan (table divs, roles and the run CSS are on the lists)', () => {
  const base = { ...boardFixture(), logos: [] };
  const four = ['card', 'compact', 'full', 'table'] as const;
  const hinted = {
    ...base,
    components: base.components.map((component, index) => ({ ...component, layout: four[index] ?? null })),
    patterns: base.patterns.map((entry, index) => ({ ...entry, layout: four[index] ?? null })),
    brand: base.brand.map((entry, index) => ({ ...entry, layout: four[index] ?? null })),
    boardLayout: { sections: { components: 'table' as const, colours: 'table' as const, spacing: 'compact' as const, overview: 'full' as const }, ignored: [], ignoredCount: 0 },
  };
  const page = withPageHash(buildLivingPage(hinted, { revision: 8, generatedAt: '2026-11-19T10:00:00.000Z', coverage: hinted.coverage, redact: [] }).html).html;
  const scan = scanLivingPage(page);
  assert.deepEqual(scan.reasons, []);
  assert.equal(scan.safe, true);
  assert.equal(scan.mark?.revision, 8);
  assert.ok(page.includes('dc-run-table') && !/data-dc-/.test(page));
});
