// The markdown renderer of the system documents (board and living page): the grammar the notes
// use (headings, paragraphs, emphasis, code, lists, links, tables, quotes), the two profiles'
// vocabularies, and the hostile cases — raw HTML, script URLs, attribute injection, deep nesting —
// that must stay escaped text. The renderer is pure, so every case here is a string in, string out.

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import { buildBoardHtml } from '../../../src/service/systems/board-html.ts';
import { livingCssProblems } from '../../../src/service/systems/living-safe.ts';
import { escapeHtml, markdownCss, markdownLinkUrl, renderMarkdown, withoutLeadingTitle } from '../../../src/service/systems/markdown-html.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { boardFixture } from './board-fixture.ts';
import { renderMarkdown as frozenRender } from './fixtures/markdown-d7453ba.ts';

const md = (source: string): string => renderMarkdown(source, 'board');
const living = (source: string): string => renderMarkdown(source, 'living');

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

/**
 * Growth, not wall clock: time at 4n against time at n, normalised by how much the input itself
 * grew. Linear tracks the input (ratio ~1); quadratic in the input runs ~4x ahead of it on a 4x
 * input. The additive term keeps sub-millisecond measurements from flaking on slow runners.
 */
const growth = (make: (n: number) => string, n: number, label: string, render: (source: string) => void): void => {
  const smallSource = make(n);
  const bigSource = make(4 * n);
  // Best of three: a GC pause in one sample must not flake the ratio on a shared runner.
  const time = (source: string): number => {
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      render(source);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  const small = time(smallSource);
  const big = time(bigSource);
  const inputRatio = bigSource.length / smallSource.length;
  assert.ok(big < 2 * inputRatio * Math.max(small, 1) + 8, `${label}: ${Math.round(small)} ms -> ${Math.round(big)} ms for ${inputRatio.toFixed(1)}x input`);
  assert.ok(big < 4000, `${label}: ${Math.round(big)} ms absolute`);
};

const bothProfiles = (source: string): void => {
  renderMarkdown(source, 'board');
  renderMarkdown(source, 'living');
};

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const deepList = (n: number): string => Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- item${i}`).join('\n');

test('nesting past the cap is escaped text, never a stack overflow, and grows with the input', () => {
  const quotes = `${'>'.repeat(20000)}x`;
  const emphasis = `${'**'.repeat(20000)}x${'**'.repeat(20000)}`;
  for (const source of [quotes, emphasis, deepList(2000)]) {
    assert.doesNotThrow(() => renderMarkdown(source, 'board'));
    assert.doesNotThrow(() => renderMarkdown(source, 'living'));
  }
  assert.ok(md(quotes).includes('x'));
  assert.ok(md(deepList(2000)).includes('item1999'));
  assert.ok(md(emphasis).includes('x'));
  growth((n) => `${'>'.repeat(n)}x`, 5000, '20 000-deep quotes', bothProfiles);
  growth((n) => `${'**'.repeat(n)}x${'**'.repeat(n)}`, 5000, '20 000-deep emphasis', bothProfiles);
  growth(deepList, 500, '2 000-deep list', bothProfiles);
});

test('adversarial lines at the service caps grow with the input, not with its square', () => {
  // The overview cap is 4 000 characters, a note's 20 000: every case below sits at one of them.
  growth((n) => `# a${' '.repeat(n)}#x`, 1000, 'heading space run', bothProfiles);
  growth((n) => `para\n## Title${'\t '.repeat(n)}more`, 375, 'heading tab/space run', bothProfiles);
  growth((n) => `# ${' '.repeat(n)}${LS}`, 5000, 'heading ending in U+2028', bothProfiles);
  growth((n) => `# ${' '.repeat(n)}${PS}`, 5000, 'heading ending in U+2029', bothProfiles);
  growth((n) => `- ${' '.repeat(n)}${LS}`, 5000, 'list marker ending in U+2028', bothProfiles);
  growth((n) => `${'`'.repeat(n)}${LS}`, 5000, 'backtick run ending in U+2028', bothProfiles);
  growth((n) => `${'~'.repeat(n)}${LS}`, 5000, 'tilde run ending in U+2028', bothProfiles);
  growth((n) => '['.repeat(n), 5000, 'unclosed brackets', bothProfiles);
  growth((n) => '!['.repeat(n), 2500, 'unclosed images', bothProfiles);
  growth((n) => '[]('.repeat(n), 1500, 'links with no closing paren', bothProfiles);
  growth((n) => '[x](a'.repeat(n), 1000, 'links with no closing paren at all', bothProfiles);
  growth((n) => `${'*a'.repeat(n)}\n`, 2500, 'emphasis openers with no closer on the line', bothProfiles);
});

test('a whole board of hostile notes grows with the notes, not with their square', () => {
  const kinds: ReadonlyArray<readonly [string, (n: number) => string]> = [
    ['brackets', () => '['.repeat(20000)],
    ['headings', () => `# a${' '.repeat(3994)}#x`],
    ['line separators', () => `# ${' '.repeat(19990)}${LS}`],
    ['tables', () => `${'|a'.repeat(2500)}\n${'|-'.repeat(2500)}\n${Array(5000).fill('|').join('\n')}`],
  ];
  for (const [name, text] of kinds) {
    const notesOf = (count: number): string => JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, text: text(0), problem: null })));
    growth(notesOf, 12, `board of ${name} notes`, (json) => {
      const html = buildBoardHtml({ ...boardFixture(), notes: JSON.parse(json) as SystemDetail['notes'] }, { scheme: 'dark' });
      assert.ok(html.includes('id="dc-section-overview"'), name);
    });
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
    const out = renderMarkdown(hostile, profile);
    assert.ok(!out.includes('<img'), out);
    assert.ok(!out.includes('<a '), out);
    assert.ok(out.includes(escapeHtml(hostile)), out);
  }
});

test('a wide or cell-hungry table cannot multiply the source', () => {
  // 2 500 columns over 5 000 bare "|" rows: 15 000 characters, inside the note cap.
  const wide = `${'|a'.repeat(2500)}\n${'|-'.repeat(2500)}\n${Array(5000).fill('|').join('\n')}`;
  growth((n) => `${'|a'.repeat(2500)}\n${'|-'.repeat(2500)}\n${Array(n).fill('|').join('\n')}`, 1250, 'wide table rows', bothProfiles);
  const wideOut = md(wide);
  assert.ok(!wideOut.includes('<table'), 'past the column cap it is text');
  assert.ok(wideOut.length < wide.length * 4, `${wideOut.length} chars from ${wide.length}`);
  // 64 columns over the same rows: a table, but only as many cells as the source budgets.
  const dense = `${'|a'.repeat(64)}\n${'|-'.repeat(64)}\n${Array(5000).fill('|').join('\n')}`;
  growth((n) => `${'|a'.repeat(64)}\n${'|-'.repeat(64)}\n${Array(n).fill('|').join('\n')}`, 1250, 'dense table rows', bothProfiles);
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
    const out = renderMarkdown(source, profile);
    const overflow = out.slice(out.lastIndexOf('</table>'));
    assert.ok(overflow.includes('<p>|'), `${profile}: the hostile row is in the overflow paragraph`);
    assert.ok(!/<img/i.test(out), `${profile}: no img in ${overflow.slice(-200)}`);
    assert.ok(!/<svg/i.test(out), `${profile}: no svg in ${overflow.slice(-200)}`);
    assert.ok(overflow.includes('&lt;img src=x onerror=alert(1)&gt;'), `${profile}: the img stays escaped text`);
    assert.ok(overflow.includes(escapeHtml('[<svg onload=1>](javascript:x)')), `${profile}: the refused link stays escaped text`);
  }
});

// Exact outputs frozen from the pre-refactor renderer (d7453ba, fixtures/markdown-d7453ba.ts):
// continuations indented less than the item's content, markers inside items, whitespace-only
// lines, fences and tables inside lists. A refactor that changes any of these goes red.
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
];

test('list continuations, nested markers and blank lines render exactly as before the refactor', () => {
  for (const c of FROZEN_CASES) {
    assert.equal(renderMarkdown(c.source, 'board'), c.board, JSON.stringify(c.source));
    assert.equal(renderMarkdown(c.source, 'living'), c.living, JSON.stringify(c.source));
  }
});

test('differential guard: seeded block-grammar fuzz matches the frozen pre-refactor renderer', () => {
  let seed = 123456789;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const pick = <T,>(a: readonly T[]): T => a[rnd(a.length)] as T;
  const indents = ['', ' ', '  ', '   ', '    ', '      '] as const;
  const line = (): string =>
    pick([
      () => pick(indents) + pick(['- ', '* ', '+ ', '1. ', '3. ', '10. ', '2) ']) + pick(['a', 'b c', '**x**', '`c`', '- nested', '2. num', 'text here', '']),
      () => pick(indents) + pick(['continuation', 'wrapped text', 'lazy line', 'x']),
      () => pick(['', ' ', '  ', '  \t', '\t']),
      () => pick(indents) + pick(['> q', '> ', '>> deep', '> - qitem']),
      () => pick(indents) + pick(['```', '```css', '~~~', 'code line', '```end']),
      () => pick(indents) + pick(['# h', '## h2', '---', '***', '| a | b |', '| --- | --- |', '| 1 | 2 |']),
    ])();
  for (let i = 0; i < 2000; i += 1) {
    const source = Array.from({ length: 1 + rnd(12) }, line).join('\n');
    assert.equal(renderMarkdown(source, 'board'), frozenRender(source, 'board'), `board: ${JSON.stringify(source)}`);
    assert.equal(renderMarkdown(source, 'living'), frozenRender(source, 'living'), `living: ${JSON.stringify(source)}`);
  }
});
