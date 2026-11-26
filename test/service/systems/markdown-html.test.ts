// The markdown renderer of the system documents (board and living page): the grammar the notes
// use (headings, paragraphs, emphasis, code, lists, links, tables, quotes), the two profiles'
// vocabularies, and the hostile cases — raw HTML, script URLs, attribute injection, deep nesting —
// that must stay escaped text. The renderer is pure, so every case here is a string in, string out.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { livingCssProblems } from '../../../src/service/systems/living-safe.ts';
import { MARKDOWN_SOURCE_MAX, escapeHtml, markdownCss, markdownLinkUrl, walkBlocks, withoutLeadingTitle } from '../../../src/service/systems/markdown-html.ts';
import { SYSTEM_NOTE_MAX, SYSTEM_OVERVIEW_MAX } from '../../../src/shared/limits.ts';
import { guarded, pairDifference, render, renderFrozen, stuckWalk, timeBoard, timeRender } from './markdown-watchdog.ts';

// Every render in this file runs in a worker under a deadline (markdown-watchdog.ts): a render
// that never returns is killed and fails its test, instead of hanging the run until the heap is gone.
const md = (source: string): string => render(source, 'board');
const living = (source: string): string => render(source, 'living');

test('headings enter the outline under the section h2, capped per profile', () => {
  assert.equal(md('# Nexus design system'), '<h3 class="dc-md-h3">Nexus design system</h3>');
  assert.equal(md('## The look'), '<h4 class="dc-md-h4">The look</h4>');
  assert.equal(md('### Deep'), '<h5 class="dc-md-h5">Deep</h5>');
  assert.equal(md('###### Six'), '<h6 class="dc-md-h6">Six</h6>');
  assert.equal(md('####### Seven'), '<p>####### Seven</p>');
  assert.equal(md('#hashtag'), '<p>#hashtag</p>');
  assert.equal(md('## Trailing ##'), '<h4 class="dc-md-h4">Trailing</h4>');
  assert.equal(living('### Three'), '<h4 class="dc-md-h4">Three</h4>');
  assert.equal(living('#### Four'), '<h4 class="dc-md-h4">Four</h4>');
  assert.equal(living('###### Six'), '<h4 class="dc-md-h4">Six</h4>');
});

test('plain text renders exactly as the escaped paragraphs did (the board snapshot guard)', () => {
  assert.equal(md('Calm and clear.\n\nSecond paragraph.'), '<p>Calm and clear.</p><p>Second paragraph.</p>');
  assert.equal(md('a\nb'), '<p>a\nb</p>');
  assert.equal(md(''), '');
  assert.equal(md('  \n\n '), '');
  assert.equal(md('One.\r\n\r\nTwo.\r\n'), '<p>One.</p><p>Two.</p>');
});

test('bold, italic, inline code and backslash escapes', () => {
  assert.equal(md('The system for **Pentima Nexus**, the platform.'), '<p>The system for <strong>Pentima Nexus</strong>, the platform.</p>');
  assert.equal(md('*calm* and _warm_'), '<p><em>calm</em> and <em>warm</em></p>');
  assert.equal(md('***both***'), '<p><strong><em>both</em></strong></p>');
  assert.equal(md('Brand blue `#00A0E0` for links.'), '<p>Brand blue <code class="dc-md-code">#00A0E0</code> for links.</p>');
  assert.equal(md('`<b>not markup</b>`'), '<p><code class="dc-md-code">&lt;b&gt;not markup&lt;/b&gt;</code></p>');
  assert.equal(md('copy_on_write and a__b__c stay words'), '<p>copy_on_write and a__b__c stay words</p>');
  assert.equal(md('\\*not emphasis\\*'), '<p>*not emphasis*</p>');
});

test('code fences keep their content as escaped text, closed or not', () => {
  assert.equal(
    md('```css\n:root { --x: red; }\n```'),
    '<pre class="dc-md-pre"><code>:root { --x: red; }</code></pre>',
  );
  assert.equal(md('```\nunclosed\nstill code'), '<pre class="dc-md-pre"><code>unclosed\nstill code</code></pre>');
  const hostile = md('```\n</code></pre><script>alert(1)</script>\n```');
  assert.ok(hostile.includes('&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!hostile.includes('<script'));
  assert.equal(living('```\nx\n```'), '<div class="dc-md-pre"><code>x</code></div>');
});

test('lists, nested lists and ordered lists', () => {
  assert.equal(
    md('- **Home:** Design Chamber (`_systems/nexus`).\n- **Mode:** describe.'),
    '<ul class="dc-md-list"><li><p><strong>Home:</strong> Design Chamber (<code class="dc-md-code">_systems/nexus</code>).</p></li><li><p><strong>Mode:</strong> describe.</p></li></ul>',
  );
  const nested = md('- a\n  - b\n    - c\n- d');
  assert.equal(
    nested,
    '<ul class="dc-md-list"><li><p>a</p><ul class="dc-md-list"><li><p>b</p><ul class="dc-md-list"><li><p>c</p></li></ul></li></ul></li><li><p>d</p></li></ul>',
  );
  assert.equal(md('1. one\n2. two'), '<ol class="dc-md-list"><li><p>one</p></li><li><p>two</p></li></ol>');
  assert.equal(md('\t- tabbed item'), '<ul class="dc-md-list"><li><p>tabbed item</p></li></ul>');
});

test('links: http, https, mailto and relative carry; everything else stays text', () => {
  assert.equal(
    md('[docs](https://example.com/a?b=1&c=2)'),
    '<p><a class="dc-md-link" href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">docs</a></p>',
  );
  assert.ok(md('[mail](mailto:studio@pentima.example)').includes('<a class="dc-md-link" href="mailto:studio@pentima.example" rel="noopener noreferrer" target="_blank">mail</a>'));
  assert.ok(md('[notes](notes/colour-usage.md)').includes('<a class="dc-md-link" href="notes/colour-usage.md" rel="noopener noreferrer" target="_blank">notes</a>'));
  assert.ok(md('[top](#dc-section-overview)').includes('<a class="dc-md-link" href="#dc-section-overview" rel="noopener noreferrer" target="_blank">top</a>'));
  assert.ok(md('[**bold** label](https://example.com)').includes('<a class="dc-md-link" href="https://example.com" rel="noopener noreferrer" target="_blank"><strong>bold</strong> label</a>'));
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '//evil.example/x', 'https://example.com/a b', 'C:\\Users\\you', '']) {
    const out = md(`[x](${url})`);
    assert.ok(!out.includes('<a '), `no link for ${JSON.stringify(url)}: ${out}`);
    assert.ok(out.includes(escapeHtml(`[x](${url})`)), `shown as written: ${out}`);
  }
});

test('a quote or an entity in a URL cannot leave the href attribute', () => {
  const injected = md('[x](https://a"onmouseover="alert(1))');
  assert.ok(injected.includes('href="https://a&quot;onmouseover=&quot;alert(1"'), injected);
  assert.ok(!injected.includes('"onmouseover="'), injected);
  const entity = md('[x](&#106;avascript:alert(1))');
  assert.ok(entity.includes('href="&amp;#106;avascript:alert(1"'), entity);
  assert.ok(!entity.includes('href="javascript:'), entity);
});

test('images are never drawn; raw HTML is shown as text', () => {
  const image = md('![logo](https://evil.example/x.png)');
  assert.ok(!image.includes('<img'), image);
  assert.ok(image.includes(escapeHtml('![logo](https://evil.example/x.png)')), image);
  const hostile = md('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n</p><p onclick="alert(3)">hi</p>');
  assert.ok(!hostile.includes('<script'), hostile);
  assert.ok(!hostile.includes('<img'), hostile);
  assert.ok(!hostile.includes('<p onclick'), hostile);
  assert.ok(hostile.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), hostile);
  assert.ok(hostile.includes('&lt;img src=x onerror=alert(2)&gt;'), hostile);
});

test('tables render with a header row, and escaped pipes stay in their cell', () => {
  const table = md('| Token | Use |\n| --- | --- |\n| `--bg` | **page** |\n| `--text` | body |');
  assert.ok(table.startsWith('<div class="dc-md-tablewrap"><table class="dc-md-table"><thead><tr><th scope="col">Token</th><th scope="col">Use</th></tr></thead><tbody>'), table);
  assert.ok(table.includes('<td><code class="dc-md-code">--bg</code></td><td><strong>page</strong></td>'), table);
  assert.ok(table.includes('<td><code class="dc-md-code">--text</code></td><td>body</td>'), table);
  assert.ok(md('| a \\| b |\n| --- |\n| c |').includes('<th scope="col">a | b</th>'));
  assert.equal(md('a | b\nnot a separator'), '<p>a | b\nnot a separator</p>');
});

test('blockquotes nest, and the living page carries them as a div', () => {
  assert.equal(md('> **Note**\n> more'), '<blockquote class="dc-md-quote"><p><strong>Note</strong>\nmore</p></blockquote>');
  assert.equal(md('>> deep'), '<blockquote class="dc-md-quote"><blockquote class="dc-md-quote"><p>deep</p></blockquote></blockquote>');
  assert.equal(living('> quoted'), '<div class="dc-md-quote"><p>quoted</p></div>');
});

test('the living profile stays inside the allowlist vocabulary', () => {
  const source = '# Title\n\n## Part\n\n### Deeper\n\n#### Deeper still\n\n```css\na { b: c; }\n```\n\n> quote\n\n- one\n  - two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n[out](https://example.com) and [in](#dc-section-overview) and [mail](mailto:x@y.z)';
  const out = living(source);
  for (const forbidden of ['<pre', '<blockquote', '<h5', '<h6', 'target=', 'rel=', '<img', '<script']) {
    assert.ok(!out.includes(forbidden), `${forbidden} in ${out}`);
  }
  assert.ok(out.includes('<div class="dc-md-pre"><code>a { b: c; }</code></div>'), out);
  assert.ok(out.includes('out (https://example.com)'), out);
  assert.ok(out.includes('mail (mailto:x@y.z)'), out);
  assert.ok(out.includes('<a class="dc-md-link" href="#dc-section-overview">in</a>'), out);
  assert.ok(!out.includes('<a class="dc-md-link" href="https:'), out);
});

// ---- cost at the service caps ----
//
// What reaches the renderer is capped: a note, pattern or brand body at SYSTEM_NOTE_MAX (20 000
// characters), the overview at SYSTEM_OVERVIEW_MAX (4 000); `bodyOf` cuts a longer file before it
// renders and `renderMarkdown` refuses to parse past MARKDOWN_SOURCE_MAX itself. So the tests
// measure there, not at sizes no caller can send: each family is built at a quarter of the cap and
// at the cap, and the time at the cap is held against the time at the quarter.

/** The largest `make(k)` that fits in `chars` characters. */
const fit = (make: (k: number) => string, chars: number): string => {
  let low = 1;
  while (make(low * 2).length <= chars) low *= 2;
  let high = low * 2;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (make(mid).length <= chars) low = mid;
    else high = mid;
  }
  return make(low);
};

/** Both profiles of one source at the cap, on a slow shared runner. Measured locally: under 10 ms. */
const CAP_BUDGET_MS = 500;

/**
 * Growth, not wall clock: both profiles at the cap against a quarter of the cap, normalised by how
 * much the input itself grew. Linear tracks the input (4x the text, about 4x the time); quadratic
 * runs 16x. Best of five inside the worker, so a GC pause in one sample cannot flake the ratio, and
 * an additive term so sub-millisecond samples cannot either.
 */
const growth = (label: string, make: (k: number) => string, cap: number = SYSTEM_NOTE_MAX): void => {
  const smallSource = fit(make, cap / 4);
  const bigSource = fit(make, cap);
  assert.ok(bigSource.length <= cap && bigSource.length > cap * 0.9, `${label}: ${bigSource.length} characters is not at the cap of ${cap}`);
  const small = timeRender(smallSource, 5);
  const big = timeRender(bigSource, 5);
  const inputRatio = bigSource.length / smallSource.length;
  assert.ok(big < 2 * inputRatio * small + 3, `${label}: ${small.toFixed(2)} ms -> ${big.toFixed(2)} ms for ${inputRatio.toFixed(1)}x input`);
  assert.ok(big < CAP_BUDGET_MS, `${label}: ${Math.round(big)} ms at the cap`);
};

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x85);
const repeatLines = (line: string) => (k: number): string => Array(k).fill(line).join('\n');
const deepList = (step: number) => (k: number): string => Array.from({ length: k }, (_, i) => `${' '.repeat(step * i)}- item${i}`).join('\n');

test('a source past the cap is one escaped paragraph, never parsed', () => {
  assert.equal(MARKDOWN_SOURCE_MAX, SYSTEM_NOTE_MAX);
  const atCap = `# t\n${'a'.repeat(MARKDOWN_SOURCE_MAX - 4)}`;
  assert.ok(md(atCap).startsWith('<h3 class="dc-md-h3">t</h3><p>a'));
  const past = `# t\n<b>${'a'.repeat(MARKDOWN_SOURCE_MAX)}`;
  for (const profile of ['board', 'living'] as const) {
    assert.equal(render(past, profile), `<p># t\n&lt;b&gt;${'a'.repeat(MARKDOWN_SOURCE_MAX)}</p>`);
  }
});

test('nesting past the cap is escaped text, never a stack overflow, and grows with the input', () => {
  const quotes = `${'>'.repeat(SYSTEM_NOTE_MAX - 1)}x`;
  const emphasis = `${'**'.repeat(4999)}x${'**'.repeat(4999)}`;
  // The deepest lists a note can hold: the indent grows with the depth, so the text is quadratic
  // in it. About 139 levels at two spaces a level, about 196 at one, 10 000 markers on one line.
  const two = fit(deepList(2), SYSTEM_NOTE_MAX);
  const one = fit(deepList(1), SYSTEM_NOTE_MAX);
  const chain = `${'- '.repeat(SYSTEM_NOTE_MAX / 2 - 1)}x`;
  assert.ok(two.split('\n').length >= 130 && one.split('\n').length >= 190, `${two.split('\n').length} and ${one.split('\n').length} levels`);
  for (const source of [quotes, emphasis, two, one, chain]) {
    assert.ok(source.length <= SYSTEM_NOTE_MAX);
    for (const profile of ['board', 'living'] as const) {
      const out = render(source, profile);
      assert.ok(out.includes('x') || out.includes(`item${source.split('\n').length - 1}`), `${profile}: the innermost text is kept`);
      // The depth cap: lists and quotes stop nesting, the rest is text.
      assert.ok((out.match(/<(?:ul|ol|blockquote|div) class="dc-md-(?:list|quote)"/g) ?? []).length <= 8, `${profile}: nesting is capped`);
    }
  }
  growth('quotes to the cap', (k) => `${'>'.repeat(k)}x`);
  growth('emphasis to the cap', (k) => `${'**'.repeat(k)}x${'**'.repeat(k)}`);
  growth('list nested two spaces a level', deepList(2));
  growth('list nested one space a level', deepList(1));
  growth('list nested with blank lines between', (k) => Array.from({ length: k }, (_, i) => `${' '.repeat(i)}- i\n`).join('\n'));
  growth('marker chain on one line', (k) => `${'- '.repeat(k)}x`);
});

test('list shapes at the note cap grow with the input, not with its square', () => {
  growth('flat list', repeatLines('- a'));
  growth('flat list with blank lines', repeatLines('- a\n'));
  growth('ordered list with long numbers', repeatLines('123456789. x'));
  growth('sawtooth nesting', (k) => Array.from({ length: k }, (_, i) => `${'  '.repeat(i % 7)}- i`).join('\n'));
  growth('marker chains on every line', repeatLines('- - - - - - - x'));
  growth('item then a long blank run', (k) => `- a${'\n'.repeat(k)}- b`);
  growth('items with blank runs', repeatLines('- a\n\n\n\n\n\n\n'));
  growth('one item with a long continuation', (k) => `- a\n${Array(k).fill(' b').join('\n')}`);
  growth('continuation under seven levels', (k) => `${fit(deepList(2), 70)}\n${Array(k).fill(`${' '.repeat(14)}x`).join('\n')}`);
  growth('quotes inside items', repeatLines('- > - > - > x'));
  growth('items inside quotes', (k) => Array.from({ length: k }, (_, i) => `> ${' '.repeat(i % 9)}- i`).join('\n'));
  growth('unclosed fence inside an item', (k) => `- a\n  \`\`\`\n${Array(k).fill('  x').join('\n')}`);
  growth('deeply indented item lines', (k) => Array(40).fill(`${' '.repeat(k)}- x`).join('\n'));
  growth('markers followed by space runs', (k) => Array(40).fill(`-${' '.repeat(k)}`).join('\n'));
});

test('adversarial lines at the service caps grow with the input, not with its square', () => {
  // The overview cap is 4 000 characters, a note's 20 000: every case below sits at one of them.
  growth('heading space run', (k) => `# a${' '.repeat(k)}#x`, SYSTEM_OVERVIEW_MAX);
  growth('heading tab/space run', (k) => `para\n## Title${'\t '.repeat(k)}more`, SYSTEM_OVERVIEW_MAX);
  growth('heading space run in a note', (k) => `# a${' '.repeat(k)}#x`);
  growth('heading ending in U+2028', (k) => `# ${' '.repeat(k)}${LS}`);
  growth('heading ending in U+2029', (k) => `# ${' '.repeat(k)}${PS}`);
  growth('heading ending in NEL', (k) => `# ${' '.repeat(k)}${NEL}`);
  growth('list marker ending in U+2028', (k) => `- ${' '.repeat(k)}${LS}`);
  growth('backtick run ending in U+2028', (k) => `${'`'.repeat(k)}${LS}`);
  growth('tilde run ending in U+2028', (k) => `${'~'.repeat(k)}${LS}`);
  growth('unclosed brackets', (k) => '['.repeat(k));
  growth('unclosed images', (k) => '!['.repeat(k));
  growth('links with no closing paren', (k) => '[]('.repeat(k));
  growth('links with no closing paren at all', (k) => '[x](a'.repeat(k));
  growth('emphasis openers with no closer on the line', (k) => `${'*a'.repeat(k)}\n`);
  growth('separator-like rows', repeatLines('|-|-|-|-'));
  growth('pipe lines that are not a table', repeatLines('a|b'));
});

test('U+2028, U+2029 and NEL end a line exactly as a newline does', () => {
  const source = ['# Title', '- one', '  wrapped', '- two', '', '```', 'code', '```', '> quote', 'tail'];
  for (const profile of ['board', 'living'] as const) {
    const expected = render(source.join('\n'), profile);
    for (const [name, terminator] of [['U+2028', LS], ['U+2029', PS], ['NEL', NEL], ['CR', '\r'], ['CRLF', '\r\n']] as const) {
      assert.equal(render(source.join(terminator), profile), expected, `${profile}: ${name}`);
    }
  }
  assert.equal(md(`# a${LS}b`), '<h3 class="dc-md-h3">a</h3><p>b</p>');
});

test('a whole board of hostile notes grows with the notes, not with their square', () => {
  // Every note sits at the 20 000-character cap; 48 of the 50 a system may hold.
  const kinds: ReadonlyArray<readonly [string, string]> = [
    ['brackets', '['.repeat(SYSTEM_NOTE_MAX)],
    ['headings', `# a${' '.repeat(SYSTEM_NOTE_MAX - 5)}#x`],
    ['line separators', `# ${' '.repeat(SYSTEM_NOTE_MAX - 3)}${LS}`],
    ['flat lists', fit(repeatLines('- a\n'), SYSTEM_NOTE_MAX)],
    ['quoted items', fit(repeatLines('- > - > - > x'), SYSTEM_NOTE_MAX)],
    ['deep lists', fit(deepList(1), SYSTEM_NOTE_MAX)],
    ['tables', `${'|a'.repeat(2500)}\n${'|-'.repeat(2500)}\n${Array(4999).fill('|').join('\n')}`],
  ];
  for (const [name, text] of kinds) {
    assert.ok(text.length <= SYSTEM_NOTE_MAX, name);
    const notesOf = (count: number): string => JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, text, problem: null })));
    const small = timeBoard(notesOf(12), 3);
    const big = timeBoard(notesOf(48), 3);
    assert.ok(small.ok && big.ok, `${name}: the board is drawn`);
    assert.ok(big.ms < 2 * 4 * small.ms + 8, `board of ${name} notes: ${small.ms.toFixed(1)} ms -> ${big.ms.toFixed(1)} ms for 4x the notes`);
    assert.ok(big.ms < 4000, `board of ${name} notes: ${Math.round(big.ms)} ms absolute`);
  }
});

test('horizontal rules, strikethrough and ordered-list starts', () => {
  assert.equal(md('---'), '<hr class="dc-md-hr">');
  assert.equal(md('***'), '<hr class="dc-md-hr">');
  assert.equal(md('___'), '<hr class="dc-md-hr">');
  assert.equal(md('- - -'), '<hr class="dc-md-hr">');
  assert.equal(md('a\n\n---\n\nb'), '<p>a</p><hr class="dc-md-hr"><p>b</p>');
  assert.equal(md('--'), '<p>--</p>');
  assert.equal(md('a --- b'), '<p>a --- b</p>');
  assert.equal(living('---'), '<hr class="dc-md-hr">');
  assert.equal(md('~~gone~~'), '<p><del class="dc-md-del">gone</del></p>');
  assert.equal(living('~~gone~~'), '<p><span class="dc-md-del">gone</span></p>');
  assert.equal(md('3. three\n4. four'), '<ol class="dc-md-list" start="3"><li><p>three</p></li><li><p>four</p></li></ol>');
  assert.equal(md('1. one'), '<ol class="dc-md-list"><li><p>one</p></li></ol>');
  assert.equal(living('3. three'), '<ol class="dc-md-list"><li><p>three</p></li></ol>');
  assert.equal(md('## a##'), '<h4 class="dc-md-h4">a##</h4>');
});

test('a note body opening with its own title drops the duplicate heading', () => {
  assert.equal(withoutLeadingTitle('# Accessibility\n\nText keeps contrast.', 'Accessibility'), '\nText keeps contrast.');
  assert.equal(withoutLeadingTitle('## Accessibility\n\nx', 'Accessibility'), '\nx');
  assert.equal(withoutLeadingTitle('# Other\n\nx', 'Accessibility'), '# Other\n\nx');
  assert.equal(withoutLeadingTitle('plain text', 'Accessibility'), 'plain text');
  assert.equal(withoutLeadingTitle('# Accessibility ##\n\nx', 'Accessibility'), '\nx');
});

test('markdownLinkUrl answers the allowlist directly', () => {
  assert.equal(markdownLinkUrl('  https://example.com  '), 'https://example.com');
  assert.equal(markdownLinkUrl('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
  assert.equal(markdownLinkUrl('mailto:x@y.z'), 'mailto:x@y.z');
  assert.equal(markdownLinkUrl('notes/x.md'), 'notes/x.md');
  assert.equal(markdownLinkUrl('#frag'), '#frag');
  assert.equal(markdownLinkUrl('javascript:alert(1)'), null);
  assert.equal(markdownLinkUrl(' javascript:alert(1)'), null);
  assert.equal(markdownLinkUrl('java\tscript:alert(1)'), null);
  assert.equal(markdownLinkUrl('data:text/html,x'), null);
  assert.equal(markdownLinkUrl('//evil.example'), null);
  assert.equal(markdownLinkUrl('a\\b'), null);
  assert.equal(markdownLinkUrl('https://x y'), null);
  assert.equal(markdownLinkUrl(''), null);
});

test('the markdown CSS is scoped, theme-aware on the board, and allowlist-safe on the living page', () => {
  assert.deepEqual(livingCssProblems(markdownCss('living', 'light')), []);
  assert.deepEqual(livingCssProblems(markdownCss('living', 'dark')), []);
  const board = markdownCss('board', 'dark');
  assert.ok(board.includes('.dc-section .dc-md-h3'), 'heading classes outrank the card label rule');
  assert.ok(board.includes('var(--dc-board-card,'), 'the board markdown follows the host theme');
  assert.ok(board.includes('var(--dc-board-border,'), board);
  assert.ok(board.includes('.dc-md-link {'), 'the link rule matches the class the renderer writes');
  assert.ok(!markdownCss('living', 'light').includes('var('), 'the living page greys are fixed');
  assert.ok(!board.includes('url('), board);
});
test('a link title works on a single line, mid-line and at the end of the text', () => {
  const linked = '<p><a class="dc-md-link" href="https://x.example" rel="noopener noreferrer" target="_blank">docs</a></p>';
  assert.equal(md('[docs](https://x.example "Docs")'), linked);
  assert.equal(md('[docs](https://x.example "Docs")\n'), linked);
  assert.equal(md('see [docs](https://x.example "Docs") now'), '<p>see <a class="dc-md-link" href="https://x.example" rel="noopener noreferrer" target="_blank">docs</a> now</p>');
  assert.equal(living('[in](#note-anchor "T")'), '<p><a class="dc-md-link" href="#note-anchor">in</a></p>');
  // A newline inside the title still refuses the link.
  assert.ok(md('[docs](https://x.example "Do\ncs")').includes(escapeHtml('[docs](https://x.example "Do')));
});

test('a refused link with markup in its label stays escaped text in both profiles', () => {
  const hostile = '[<img src=x onerror=alert(1)>](javascript:x)';
  for (const profile of ['board', 'living'] as const) {
    const out = render(hostile, profile);
    assert.ok(!out.includes('<img'), out);
    assert.ok(!out.includes('<a '), out);
    assert.ok(out.includes(escapeHtml(hostile)), out);
  }
});

test('a wide or cell-hungry table cannot multiply the source', () => {
  // 2 500 columns over 4 999 bare "|" rows: 19 999 characters, just inside the note cap.
  const wide = `${'|a'.repeat(2500)}\n${'|-'.repeat(2500)}\n${Array(4999).fill('|').join('\n')}`;
  assert.ok(wide.length <= SYSTEM_NOTE_MAX);
  growth('wide table rows', (k) => `${'|a'.repeat(1200)}\n${'|-'.repeat(1200)}\n${Array(k).fill('|').join('\n')}`);
  const wideOut = md(wide);
  assert.ok(!wideOut.includes('<table'), 'past the column cap it is text');
  assert.ok(wideOut.length < wide.length * 4, `${wideOut.length} chars from ${wide.length}`);
  // 64 columns over the same rows: a table, but only as many cells as the source budgets.
  const dense = `${'|a'.repeat(64)}\n${'|-'.repeat(64)}\n${Array(5000).fill('|').join('\n')}`;
  growth('dense table rows', (k) => `${'|a'.repeat(64)}\n${'|-'.repeat(64)}\n${Array(k).fill('|').join('\n')}`);
  const denseOut = md(dense);
  assert.ok(denseOut.includes('<table'), 'within the cap it is a table');
  assert.ok(denseOut.length < dense.length * 12, `${denseOut.length} chars from ${dense.length}`);
  assert.ok(denseOut.includes('<p>|'), 'rows past the cell budget stay as text');
  assert.ok(living(dense).includes('<table'), 'the living profile bounds cells the same way');
});

test('rows past the table cell budget stay escaped text in both profiles', () => {
  // 64 columns over 400 bare rows exhausts the budget, so the hostile last row lands in the overflow paragraph.
  const hostile = '|<img src=x onerror=alert(1)>|[<svg onload=1>](javascript:x)|';
  const source = `${'|a'.repeat(64)}\n${'|-'.repeat(64)}\n${Array(400).fill('|').join('\n')}\n${hostile}`;
  for (const profile of ['board', 'living'] as const) {
    const out = render(source, profile);
    const overflow = out.slice(out.lastIndexOf('</table>'));
    assert.ok(overflow.includes('<p>|'), `${profile}: the hostile row is in the overflow paragraph`);
    assert.ok(!/<img/i.test(out), `${profile}: no img in ${overflow.slice(-200)}`);
    assert.ok(!/<svg/i.test(out), `${profile}: no svg in ${overflow.slice(-200)}`);
    assert.ok(overflow.includes('&lt;img src=x onerror=alert(1)&gt;'), `${profile}: the img stays escaped text`);
    assert.ok(overflow.includes(escapeHtml('[<svg onload=1>](javascript:x)')), `${profile}: the refused link stays escaped text`);
  }
});

// Exact outputs frozen from the d7453ba renderer (fixtures/markdown-d7453ba.ts), whose list
// algorithm this renderer keeps: continuations indented less than the item's content, markers
// inside items, whitespace-only lines, fences and tables inside lists, and every block opener
// straight after a marker (a quote there once looped forever). A change to any of these goes red.
const FROZEN_CASES: readonly { source: string; board: string; living: string }[] = [
  { source: "1. Use the brand blue\n  for links only.", board: "<ol class=\"dc-md-list\"><li><p>Use the brand blue\nfor links only.</p></li></ol>", living: "<ol class=\"dc-md-list\"><li><p>Use the brand blue\nfor links only.</p></li></ol>" },
  { source: "10. Ten\n   wrapped", board: "<ol class=\"dc-md-list\" start=\"10\"><li><p>Ten\nwrapped</p></li></ol>", living: "<ol class=\"dc-md-list\"><li><p>Ten\nwrapped</p></li></ol>" },
  { source: "-   a\n  bcd", board: "<ul class=\"dc-md-list\"><li><p>a\nbcd</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a\nbcd</p></li></ul>" },
  { source: "- 2. Second\n- three", board: "<ul class=\"dc-md-list\"><li><ol class=\"dc-md-list\" start=\"2\"><li><p>Second</p></li></ol></li><li><p>three</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><ol class=\"dc-md-list\"><li><p>Second</p></li></ol></li><li><p>three</p></li></ul>" },
  { source: "- - x", board: "<ul class=\"dc-md-list\"><li><ul class=\"dc-md-list\"><li><p>x</p></li></ul></li></ul>", living: "<ul class=\"dc-md-list\"><li><ul class=\"dc-md-list\"><li><p>x</p></li></ul></li></ul>" },
  { source: "1. - a\n   - b", board: "<ol class=\"dc-md-list\"><li><ul class=\"dc-md-list\"><li><p>a</p></li><li><p>b</p></li></ul></li></ol>", living: "<ol class=\"dc-md-list\"><li><ul class=\"dc-md-list\"><li><p>a</p></li><li><p>b</p></li></ul></li></ol>" },
  { source: "a\n  \t\nb", board: "<p>a</p><p>b</p>", living: "<p>a</p><p>b</p>" },
  { source: "- a\n\n  b\n- c", board: "<ul class=\"dc-md-list\"><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>" },
  { source: "- a\n  ```\n  x\n   y\n  ```\n- b", board: "<ul class=\"dc-md-list\"><li><p>a</p><pre class=\"dc-md-pre\"><code>x\n y</code></pre></li><li><p>b</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a</p><div class=\"dc-md-pre\"><code>x\n y</code></div></li><li><p>b</p></li></ul>" },
  { source: "> - a\n>   b\n> - c", board: "<blockquote class=\"dc-md-quote\"><ul class=\"dc-md-list\"><li><p>a\nb</p></li><li><p>c</p></li></ul></blockquote>", living: "<div class=\"dc-md-quote\"><ul class=\"dc-md-list\"><li><p>a\nb</p></li><li><p>c</p></li></ul></div>" },
  { source: "- | a | b |\n  | --- | --- |\n  | 1 | 2 |", board: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-tablewrap\"><table class=\"dc-md-table\"><thead><tr><th scope=\"col\">a</th><th scope=\"col\">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div></li></ul>", living: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-tablewrap\"><table class=\"dc-md-table\"><thead><tr><th scope=\"col\">a</th><th scope=\"col\">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div></li></ul>" },
  { source: "1. one\n   1. inner\n      1. deep\n2. two", board: "<ol class=\"dc-md-list\"><li><p>one</p><ol class=\"dc-md-list\"><li><p>inner</p><ol class=\"dc-md-list\"><li><p>deep</p></li></ol></li></ol></li><li><p>two</p></li></ol>", living: "<ol class=\"dc-md-list\"><li><p>one</p><ol class=\"dc-md-list\"><li><p>inner</p><ol class=\"dc-md-list\"><li><p>deep</p></li></ol></li></ol></li><li><p>two</p></li></ol>" },
  { source: "- a\n b\n- c", board: "<ul class=\"dc-md-list\"><li><p>a\nb</p></li><li><p>c</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a\nb</p></li><li><p>c</p></li></ul>" },
  { source: "  \t\n- a\n  \t\n- b\n  \t", board: "<ul class=\"dc-md-list\"><li><p>a</p></li></ul><ul class=\"dc-md-list\"><li><p>b</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a</p></li></ul><ul class=\"dc-md-list\"><li><p>b</p></li></ul>" },
  // A block opener straight after the marker, nested quotes in items, fences four or more spaces
  // past the content column (a paragraph: a fence sits at most three spaces in), and empty items.
  { source: "- > x", board: "<ul class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><p>x</p></blockquote></li></ul>", living: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><p>x</p></div></li></ul>" },
  { source: "1. > quote", board: "<ol class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><p>quote</p></blockquote></li></ol>", living: "<ol class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><p>quote</p></div></li></ol>" },
  { source: "1. > quote\n   > more", board: "<ol class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><p>quote\nmore</p></blockquote></li></ol>", living: "<ol class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><p>quote\nmore</p></div></li></ol>" },
  { source: "- > a\n- b", board: "<ul class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><p>a</p></blockquote></li><li><p>b</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><p>a</p></div></li><li><p>b</p></li></ul>" },
  { source: "- a\n  - > b\n    > c\n  - d", board: "<ul class=\"dc-md-list\"><li><p>a</p><ul class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><p>b\nc</p></blockquote></li><li><p>d</p></li></ul></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a</p><ul class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><p>b\nc</p></div></li><li><p>d</p></li></ul></li></ul>" },
  { source: "- > - > deep", board: "<ul class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><ul class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><p>deep</p></blockquote></li></ul></blockquote></li></ul>", living: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><ul class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><p>deep</p></div></li></ul></div></li></ul>" },
  { source: "> - > x\n>   > y", board: "<blockquote class=\"dc-md-quote\"><ul class=\"dc-md-list\"><li><blockquote class=\"dc-md-quote\"><p>x\ny</p></blockquote></li></ul></blockquote>", living: "<div class=\"dc-md-quote\"><ul class=\"dc-md-list\"><li><div class=\"dc-md-quote\"><p>x\ny</p></div></li></ul></div>" },
  { source: "- # h\n- ```\n  x\n  ```", board: "<ul class=\"dc-md-list\"><li><h3 class=\"dc-md-h3\">h</h3></li><li><pre class=\"dc-md-pre\"><code>x</code></pre></li></ul>", living: "<ul class=\"dc-md-list\"><li><h3 class=\"dc-md-h3\">h</h3></li><li><div class=\"dc-md-pre\"><code>x</code></div></li></ul>" },
  { source: "- ```\n  x\n  ```\n- ~~~\n  y", board: "<ul class=\"dc-md-list\"><li><pre class=\"dc-md-pre\"><code>x</code></pre></li><li><pre class=\"dc-md-pre\"><code>y</code></pre></li></ul>", living: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-pre\"><code>x</code></div></li><li><div class=\"dc-md-pre\"><code>y</code></div></li></ul>" },
  { source: "- a\n      ```\n      x\n      ```", board: "<ul class=\"dc-md-list\"><li><p>a\n    <code class=\"dc-md-code\">     x     </code></p></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a\n    <code class=\"dc-md-code\">     x     </code></p></li></ul>" },
  { source: "- a\n\n      ```\n      x\n      ```\n- b", board: "<ul class=\"dc-md-list\"><li><p>a</p><p><code class=\"dc-md-code\">     x     </code></p></li><li><p>b</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a</p><p><code class=\"dc-md-code\">     x     </code></p></li><li><p>b</p></li></ul>" },
  { source: "1. a\n       ~~~\n       y\n       ~~~", board: "<ol class=\"dc-md-list\"><li><p>a\n    <del class=\"dc-md-del\">~\n    y\n    </del>~</p></li></ol>", living: "<ol class=\"dc-md-list\"><li><p>a\n    <span class=\"dc-md-del\">~\n    y\n    </span>~</p></li></ol>" },
  { source: "- \n- a", board: "<ul class=\"dc-md-list\"><li></li><li><p>a</p></li></ul>", living: "<ul class=\"dc-md-list\"><li></li><li><p>a</p></li></ul>" },
  { source: "- \n-  \n- ", board: "<ul class=\"dc-md-list\"><li></li><li></li><li></li></ul>", living: "<ul class=\"dc-md-list\"><li></li><li></li><li></li></ul>" },
  { source: "1. \n2. two", board: "<ol class=\"dc-md-list\"><li></li><li><p>two</p></li></ol>", living: "<ol class=\"dc-md-list\"><li></li><li><p>two</p></li></ol>" },
  { source: "- a\n  - \n  - b", board: "<ul class=\"dc-md-list\"><li><p>a</p><ul class=\"dc-md-list\"><li></li><li><p>b</p></li></ul></li></ul>", living: "<ul class=\"dc-md-list\"><li><p>a</p><ul class=\"dc-md-list\"><li></li><li><p>b</p></li></ul></li></ul>" },
  { source: "-\n- a", board: "<p>-</p><ul class=\"dc-md-list\"><li><p>a</p></li></ul>", living: "<p>-</p><ul class=\"dc-md-list\"><li><p>a</p></li></ul>" },
  { source: "- ---\n- ***", board: "<hr class=\"dc-md-hr\"><ul class=\"dc-md-list\"><li><hr class=\"dc-md-hr\"></li></ul>", living: "<hr class=\"dc-md-hr\"><ul class=\"dc-md-list\"><li><hr class=\"dc-md-hr\"></li></ul>" },
  { source: "- | a | b |\n  | --- | --- |", board: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-tablewrap\"><table class=\"dc-md-table\"><thead><tr><th scope=\"col\">a</th><th scope=\"col\">b</th></tr></thead></table></div></li></ul>", living: "<ul class=\"dc-md-list\"><li><div class=\"dc-md-tablewrap\"><table class=\"dc-md-table\"><thead><tr><th scope=\"col\">a</th><th scope=\"col\">b</th></tr></thead></table></div></li></ul>" },
  { source: "- ## h2\n  text", board: "<ul class=\"dc-md-list\"><li><h4 class=\"dc-md-h4\">h2</h4><p>text</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><h4 class=\"dc-md-h4\">h2</h4><p>text</p></li></ul>" },
  { source: "- 2. x\n    deeper\n  back", board: "<ul class=\"dc-md-list\"><li><ol class=\"dc-md-list\" start=\"2\"><li><p>x\ndeeper</p></li></ol><p>back</p></li></ul>", living: "<ul class=\"dc-md-list\"><li><ol class=\"dc-md-list\"><li><p>x\ndeeper</p></li></ol><p>back</p></li></ul>" },
];

test('list continuations, nested markers, openers after a marker and empty items render exactly as the frozen renderer did', () => {
  for (const c of FROZEN_CASES) {
    assert.equal(render(c.source, 'board'), c.board, JSON.stringify(c.source));
    assert.equal(render(c.source, 'living'), c.living, JSON.stringify(c.source));
    assert.equal(renderFrozen(c.source, 'board'), c.board, `the table matches the frozen renderer: ${JSON.stringify(c.source)}`);
    assert.equal(renderFrozen(c.source, 'living'), c.living, `the table matches the frozen renderer: ${JSON.stringify(c.source)}`);
  }
});

test('a block step that claims no line cannot spin: the line becomes text and the walk moves on', () => {
  // Under the watchdog: without the guard in walkBlocks this never returns, and fails here in seconds.
  assert.equal(stuckWalk(3, 'same'), '<p>line 0</p><p>line 1</p><p>line 2</p>');
  assert.equal(stuckWalk(2, 'behind'), '<p>line 0</p><p>line 1</p>');
  // A step that advances is used as it is, and never asked about a line it already claimed.
  const asked: number[] = [];
  const out = walkBlocks(
    5,
    (i) => {
      asked.push(i);
      return { html: `[${i}]`, next: i + 2 };
    },
    () => 'stuck',
  );
  assert.equal(out, '[0][2][4]');
  assert.deepEqual(asked, [0, 2, 4]);
  assert.equal(walkBlocks(0, () => ({ html: 'x', next: 1 }), () => 'stuck'), '');
});

test('the watchdog kills a render that does not return', () => {
  assert.throws(() => guarded({ op: 'spin' }, 300), /did not finish in 300 ms and was killed/);
  // The next render starts a fresh worker.
  assert.equal(md('after'), '<p>after</p>');
});

// ---- the seeded differential against the frozen d7453ba renderer ----

const BLOCK_OPENERS = [
  '> q', '> ', '>', '>q', '>> deep', '> - qitem', '> 1. qnum', '> # qh', '> ```', '> > - x',
  '```', '```css', '````', '~~~', '~~~~ info', '``` x ```',
  '# h', '## h2', '###### six', '####### seven', '#', '#tag', '# h #',
  '---', '***', '___', '- - -', '* * *', '--', '-- -',
  '| a | b |', '| --- | --- |', '|---|:-:|', '| 1 | 2 |', 'a | b', '|', '| x \\| y |',
  '- nested', '* star', '+ plus', '2. num', '10) ten', '-', '1.', '- ', '1. ', '- - x', '- 3. y', '1. - z',
] as const;
const TEXTS = ['', 'a', 'b c', 'text here', 'wrapped text', '**x**', '*e*', '_u_', '~~s~~', '`c`', '[l](u)', '![i](u)', '<b>raw</b>', '&amp;', '\\- esc', 'x  ', '\tx'] as const;
const MARKERS = ['- ', '* ', '+ ', '1. ', '3. ', '10. ', '2) ', '-   ', '-\t', '1.\t', '-     ', '123456789. ', '1234567890. ', '0. '] as const;
const INDENTS = ['', ' ', '  ', '   ', '    ', '     ', '      ', '        ', '\t', '\t\t', ' \t', '  \t '] as const;
const BLANKS = ['', '', ' ', '  ', '  \t', '\t', '      '] as const;
const JOINS = ['\n', '\n', '\n', '\n', '\r\n', '\r'] as const;

/**
 * A seeded generator (mulberry32), so a failing seed and index reproduce exactly. Not a power-of-two
 * LCG: its low bits cycle quickly, and the choices below would then never meet in most combinations.
 */
const seeded = (seed: number): { rnd: (n: number) => number; pick: <T>(from: readonly T[]) => T } => {
  let state = seed >>> 0;
  const rnd = (n: number): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  return { rnd, pick: <T,>(from: readonly T[]): T => from[rnd(from.length)] as T };
};

/** Free lines: every opener at every indent, alone, straight after a marker, and after a marker chain. */
const looseSource = ({ rnd, pick }: ReturnType<typeof seeded>): string => {
  const content = (): string => (rnd(3) === 0 ? pick(TEXTS) : pick(BLOCK_OPENERS));
  const line = (): string => {
    switch (rnd(8)) {
      case 0:
      case 1:
        return pick(INDENTS) + pick(MARKERS) + content();
      case 2:
        return pick(INDENTS) + pick(MARKERS) + pick(MARKERS) + content();
      case 3:
      case 4:
        return pick(INDENTS) + pick(BLOCK_OPENERS);
      case 5:
        return pick(INDENTS) + pick(TEXTS);
      case 6:
        return pick(BLANKS);
      default:
        return `${pick(['> ', '>', '>  ', ' > ', '>> '])}${pick(INDENTS)}${rnd(2) === 0 ? pick(MARKERS) : ''}${content()}`;
    }
  };
  return Array.from({ length: 1 + rnd(14) }, line).join(pick(JOINS));
};

/**
 * Structured lists: items whose marker sits at a tracked column, with openers after the marker and
 * child lines placed relative to the item's content column (before it, at it, one to eight past it).
 */
const nestedSource = ({ rnd, pick }: ReturnType<typeof seeded>): string => {
  const lines: string[] = [];
  const columns: number[] = [0];
  const count = 2 + rnd(12);
  for (let k = 0; k < count; k += 1) {
    const column = columns[columns.length - 1] ?? 0;
    const marker = pick(MARKERS);
    const width = marker.replace(/\t/g, ' ').length;
    lines.push(`${' '.repeat(column)}${marker}${rnd(2) === 0 ? pick(BLOCK_OPENERS) : pick(TEXTS)}`);
    const children = rnd(4);
    for (let c = 0; c < children; c += 1) {
      if (rnd(5) === 0) lines.push(pick(BLANKS));
      const at = Math.max(0, column + width + pick([-3, -2, -1, 0, 0, 0, 1, 2, 3, 4, 5, 8]));
      lines.push(`${' '.repeat(at)}${rnd(3) === 0 ? pick(TEXTS) : pick(BLOCK_OPENERS)}`);
    }
    const move = rnd(6);
    if (move <= 1 && columns.length < 10) columns.push(column + pick([width, width, 1, 2, 4, width + 1, width + 4]));
    else if (move === 2 && columns.length > 1) columns.pop();
    else if (move === 3) columns.length = 1;
    if (rnd(7) === 0) lines.push(pick(BLANKS));
  }
  return lines.join(pick(JOINS));
};

/** Visible text and block boundaries only: what is left when a difference is not just markup bytes. */
const structureOf = (html: string): string => html.replace(/<[^>]*>/g, '').replace(/\s+/g, '');

test('differential guard: seeded block-grammar fuzz matches the frozen d7453ba renderer byte for byte', () => {
  const totals = { sources: 0, bytes: 0, structural: 0 };
  let first = '';
  for (const seed of [123456789, 99991, 4242, 777, 31337]) {
    const random = seeded(seed);
    for (let i = 0; i < 6000; i += 1) {
      const source = i % 3 === 2 ? nestedSource(random) : looseSource(random);
      totals.sources += 1;
      const difference = pairDifference(source);
      if (difference === null) continue;
      totals.bytes += 1;
      if (structureOf(difference.board) !== structureOf(difference.frozenBoard) || structureOf(difference.living) !== structureOf(difference.frozenLiving)) totals.structural += 1;
      if (first === '') first = `seed ${seed}, source ${i}: ${JSON.stringify(source)}\n  now:    ${difference.board}\n  frozen: ${difference.frozenBoard}`;
    }
  }
  assert.equal(totals.sources, 30000);
  assert.deepEqual({ bytes: totals.bytes, structural: totals.structural }, { bytes: 0, structural: 0 }, `${totals.bytes} of ${totals.sources} sources differ; first: ${first}`);
});

test('the differential grammar puts every block opener straight after a marker and at varied indents', () => {
  // The blind spot that let an endless loop through: no generated item began with a quote.
  const random = seeded(2024);
  const loose = Array.from({ length: 6000 }, () => looseSource(random)).join('\n');
  const nested = Array.from({ length: 3000 }, () => nestedSource(random)).join('\n');
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const opener of ['> q', '>', '```', '~~~', '# h', '---', '***', '| a | b |', '| --- | --- |', '- nested', '2. num']) {
    assert.ok(new RegExp(`^ *(?:- |1\\. )${escape(opener)}$`, 'm').test(loose), `loose: ${opener} straight after a marker`);
    assert.ok(new RegExp(`^ *(?:- |1\\. )${escape(opener)}$`, 'm').test(nested), `nested: ${opener} straight after a marker`);
    for (const indent of [0, 2, 4, 6, 8]) {
      assert.ok(new RegExp(`^ {${indent}}${escape(opener)}$`, 'm').test(`${loose}\n${nested}`), `${opener} at indent ${indent}`);
    }
  }
  assert.ok(/^ *- $/m.test(loose) && /^ *1\. $/m.test(nested), 'empty items');
});
