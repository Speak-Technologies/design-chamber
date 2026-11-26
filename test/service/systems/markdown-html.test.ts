// The markdown renderer of the system documents (board and living page): the grammar the notes
// use (headings, paragraphs, emphasis, code, lists, links, tables, quotes), the two profiles'
// vocabularies, and the hostile cases — raw HTML, script URLs, attribute injection, deep nesting —
// that must stay escaped text. The renderer is pure, so every case here is a string in, string out.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { livingCssProblems } from '../../../src/service/systems/living-safe.ts';
import { escapeHtml, markdownCss, markdownLinkUrl, renderMarkdown } from '../../../src/service/systems/markdown-html.ts';

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
    '<p><a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">docs</a></p>',
  );
  assert.ok(md('[mail](mailto:studio@pentima.example)').includes('<a href="mailto:studio@pentima.example" rel="noopener noreferrer" target="_blank">mail</a>'));
  assert.ok(md('[notes](notes/colour-usage.md)').includes('<a href="notes/colour-usage.md" rel="noopener noreferrer" target="_blank">notes</a>'));
  assert.ok(md('[top](#dc-section-overview)').includes('<a href="#dc-section-overview" rel="noopener noreferrer" target="_blank">top</a>'));
  assert.ok(md('[**bold** label](https://example.com)').includes('<a href="https://example.com" rel="noopener noreferrer" target="_blank"><strong>bold</strong> label</a>'));
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
  assert.ok(out.includes('<a href="#dc-section-overview">in</a>'), out);
  assert.ok(!out.includes('<a href="https:'), out);
});

test('nesting past the cap is escaped text, never a stack overflow', () => {
  const quotes = `${'> '.repeat(40)}deep`;
  assert.ok(md(quotes).includes(escapeHtml('deep')));
  const lists = Array.from({ length: 40 }, (_, i) => `${'  '.repeat(i)}- item${i}`).join('\n');
  assert.ok(md(lists).includes('item39'));
  const emphasis = `${'**'.repeat(40)}x${'**'.repeat(40)}`;
  assert.ok(md(emphasis).includes('x'));
  const links = `${'[a]('.repeat(40)}https://example.com${')'.repeat(40)}`;
  assert.ok(typeof md(links) === 'string');
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
  assert.ok(!markdownCss('living', 'light').includes('var('), 'the living page greys are fixed');
  assert.ok(!board.includes('url('), board);
});