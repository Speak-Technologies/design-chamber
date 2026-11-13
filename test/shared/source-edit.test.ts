// The source scanner, locator and splice for in-place text edits
// (documentation/specs/phase-2-technical.md §3.2–§3.4, PS §2 E2/E5/E6 and §3).
// Pure functions over the decoded source string; fixtures carry the byte-level
// cases (CRLF, BOM, entities, comments, implied end tags, RTL, duplicates).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { normalizeText as anchorNormalizeText } from '../../src/guest/bridge/anchor.ts';
import { SOURCE_TEXT_MAX } from '../../src/shared/limits.ts';
import {
  decodeText,
  editorTextOf,
  escapeText,
  locateTextTarget,
  normalizeText,
  planTextSplice,
  scanHtml,
  sourceFileReason,
  spliceElementText,
  type LocateTarget,
  type ScanElement,
  type ScanTree,
} from '../../src/shared/source-edit.ts';

const fixtureDir = path.resolve(import.meta.dirname, '..', 'fixtures', 'source-edit');
const fixture = (name: string): string => readFileSync(path.join(fixtureDir, name), 'utf8');

const target = (over: Partial<LocateTarget> & { tag: string; text: string }): LocateTarget => ({
  id: null,
  sameIndex: 0,
  sameCount: 0,
  leaf: true,
  truncated: false,
  ...over,
});

const elementById = (scan: ScanTree, id: string): ScanElement => {
  const found = scan.elements.find((e) => e.id?.decoded === id);
  assert.ok(found, `element #${id} in the scan`);
  return found;
};

const reasonOf = (scan: ScanTree, t: LocateTarget): string => {
  const result = locateTextTarget(scan, t);
  assert.ok('reason' in result, `expected a refusal, got an element`);
  return result.reason;
};

// ---- scanHtml ----

describe('scanHtml: the tolerant tokenizer', () => {
  test('elements carry tag, ranges, parent and children in document order', () => {
    const text = '<div id="a"><p>One</p><p>Two</p></div>';
    const scan = scanHtml(text);
    assert.deepEqual(scan.elements.map((e) => e.tag), ['div', 'p', 'p']);
    const [div, p1, p2] = scan.elements;
    assert.ok(div && p1 && p2);
    assert.deepEqual(div.startTag, [0, 12]);
    assert.deepEqual(p1.startTag, [12, 15]);
    assert.deepEqual(p1.inner, [15, 18]);
    assert.deepEqual(p1.endTag, [18, 22]);
    assert.equal(text.slice(p1.inner[0], p1.inner[1]), 'One');
    assert.equal(text.slice(p2.inner[0], p2.inner[1]), 'Two');
    assert.equal(p1.parent, 0);
    assert.equal(p2.parent, 0);
    assert.equal(div.parent, -1);
    assert.deepEqual(div.childElements, [1, 2]);
    assert.deepEqual(p1.childElements, []);
    assert.equal(div.endTag !== null, true);
  });

  test('void elements never open a stack entry', () => {
    const text = '<p>a<br>b<img src="x.png">c</p>';
    const scan = scanHtml(text);
    assert.deepEqual(scan.elements.map((e) => e.tag), ['p', 'br', 'img']);
    const p = scan.elements[0];
    assert.ok(p);
    assert.equal(text.slice(p.inner[0], p.inner[1]), 'a<br>b<img src="x.png">c');
    assert.deepEqual(p.childElements, [1, 2]);
    assert.equal(scan.elements[1]?.endTag, null);
  });

  test('raw text elements skip to their matching end tag, case-insensitive', () => {
    const text = '<p>a</p><script>var s = "</p><div>";</SCRIPT><p>b</p>';
    const scan = scanHtml(text);
    assert.deepEqual(scan.elements.map((e) => e.tag), ['p', 'script', 'p']);
    const script = scan.elements[1];
    assert.ok(script);
    assert.equal(text.slice(script.inner[0], script.inner[1]), 'var s = "</p><div>";');
    assert.equal(script.inert, true);
    const lastP = scan.elements[2];
    assert.ok(lastP);
    assert.equal(text_(scan, lastP), 'b');
  });

  test('title and textarea are raw text and inert', () => {
    const scan = scanHtml('<head><title>T &amp; more</title></head><textarea>raw <b>text</b></textarea>');
    const title = scan.elements.find((e) => e.tag === 'title');
    const textarea = scan.elements.find((e) => e.tag === 'textarea');
    assert.ok(title && textarea);
    assert.equal(title.inert, true);
    assert.equal(textarea.inert, true);
    assert.equal(textarea.childElements.length, 0);
  });

  test('plaintext holds everything to the end of the file (browsers honour no end tag)', () => {
    const scan = scanHtml('<plaintext></plaintext><p>Hi</p>');
    assert.equal(scan.elements.length, 1, 'tags after plaintext are its raw text, not elements');
    const plain = scan.elements[0];
    assert.ok(plain);
    assert.equal(plain.tag, 'plaintext');
    assert.equal(plain.endTag, null);
    assert.equal(plain.inner[1], scan.text.length);
  });

  test('a stray end tag is ignored; an end tag closes the outer element and pops to it', () => {
    const scan = scanHtml('<div><p>text</span></div>');
    const [div, p] = scan.elements;
    assert.ok(div && p);
    assert.equal(p.endTag, null, 'p was closed implicitly by </div>');
    assert.equal(text_(scan, p), 'text');
    assert.ok(div.endTag);
    assert.equal(scan.text.slice(div.endTag[0], div.endTag[1]), '</div>');
  });

  test('self-closing: /> closes only void elements and foreign content', () => {
    const html = scanHtml('<div/><p/>text</div>');
    const div = html.elements[0];
    assert.ok(div);
    assert.ok(div.endTag, '<div/> stays open in HTML, so </div> closes it');
    const p = html.elements[1];
    assert.ok(p);
    assert.equal(p.endTag, null, '<p/> stays open and never gets an explicit end tag');

    const svg = scanHtml('<svg><circle/><g/></svg>');
    const circle = svg.elements.find((e) => e.tag === 'circle');
    const g = svg.elements.find((e) => e.tag === 'g');
    assert.ok(circle && g);
    assert.deepEqual(circle.inner, [circle.startTag[1], circle.startTag[1]]);
    assert.deepEqual(g.inner, [g.startTag[1], g.startTag[1]]);
    assert.equal(svg.elements[0]?.foreign, true);
    assert.equal(circle.foreign, true);
  });

  test('comments, CDATA and processing instructions set hasComment on every open element', () => {
    const scan = scanHtml('<div><p>a<!-- x -->b</p></div>');
    const [div, p] = scan.elements;
    assert.ok(div && p);
    assert.equal(p.hasComment, true);
    assert.equal(div.hasComment, true);
    const cdata = scanHtml('<p>a<![CDATA[x]]>b</p>');
    assert.equal(cdata.elements[0]?.hasComment, true);
    const pi = scanHtml('<p>a<?proc x?>b</p>');
    assert.equal(pi.elements[0]?.hasComment, true);
    const doctype = scanHtml('<!doctype html><p>a</p>');
    assert.equal(doctype.elements[0]?.hasComment, false, 'a doctype is not a comment');
  });

  test('an unterminated comment runs to the end of the file', () => {
    const scan = scanHtml('<p>a<!-- never closed');
    const p = scan.elements[0];
    assert.ok(p);
    assert.equal(p.hasComment, true);
    assert.equal(p.endTag, null);
  });

  test('foreign and inert flags propagate; template content is inert', () => {
    const scan = scanHtml('<svg><text>Hi</text></svg><math><mi>x</mi></math><template><p>T</p></template><noscript><p>N</p></noscript><head><meta charset="utf-8"></head>');
    const byTag = (tag: string) => scan.elements.find((e) => e.tag === tag);
    assert.equal(byTag('text')?.foreign, true);
    assert.equal(byTag('mi')?.foreign, true);
    assert.equal(byTag('svg')?.foreign, true);
    const templateP = scan.elements.filter((e) => e.tag === 'p')[0];
    assert.ok(templateP);
    assert.equal(templateP.inert, true);
    assert.equal(byTag('noscript')?.inert, true);
    assert.equal(byTag('meta')?.inert, true, 'inside head');
  });

  test('id keeps its raw and decoded value; the first id attribute wins', () => {
    const scan = scanHtml('<p id="caf&#233;" id="other">x</p><p id="&#128;">y</p><p id>z</p><p>w</p>');
    const [a, b, c, d] = scan.elements;
    assert.ok(a && b && c && d);
    assert.deepEqual(a.id, { raw: 'caf&#233;', decoded: 'café' });
    assert.deepEqual(b.id, { raw: '&#128;', decoded: null });
    assert.deepEqual(c.id, { raw: '', decoded: '' });
    assert.equal(d.id, null);
  });

  test('quoted attribute values may contain >; attribute order and quoting stay in the source', () => {
    const text = "<h1 class=\"hero\" data-x='a>b'>Ship</h1>";
    const scan = scanHtml(text);
    const h1 = scan.elements[0];
    assert.ok(h1);
    assert.deepEqual(h1.startTag, [0, 30]);
    assert.equal(text_(scan, h1), 'Ship');
  });

  test('BOM and CRLF are ordinary characters: offsets stay byte-faithful', () => {
    const text = '\ufeff<p>a\r\nb</p>';
    const scan = scanHtml(text);
    const p = scan.elements[0];
    assert.ok(p);
    assert.deepEqual(p.startTag, [1, 4]);
    assert.equal(text.slice(p.inner[0], p.inner[1]), 'a\r\nb');
  });

  test('unterminated tags and lone < are tolerated', () => {
    const scan = scanHtml('a < b <p>text');
    const p = scan.elements.find((e) => e.tag === 'p');
    assert.ok(p);
    assert.equal(p.endTag, null);
    assert.equal(text_(scan, p), 'text');
  });
});

/** The decoded-and-normalised text of an element, as the locator compares it. */
const text_ = (scan: ScanTree, e: ScanElement): string => {
  const decoded = decodeText(scan.text, e.inner[0], e.inner[1]);
  return decoded === null ? '' : normalizeText(decoded.text);
};

// ---- decodeText ----

describe('decodeText: character references with a per-code-unit raw map', () => {
  test('the named set decodes with its semicolon', () => {
    const names: [string, string][] = [
      ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', '\u00a0'],
      ['copy', '©'], ['reg', '®'], ['trade', '™'], ['hellip', '…'], ['mdash', '—'], ['ndash', '–'],
      ['lsquo', '\u2018'], ['rsquo', '\u2019'], ['ldquo', '\u201c'], ['rdquo', '\u201d'],
      ['laquo', '«'], ['raquo', '»'], ['bull', '•'], ['middot', '·'], ['times', '×'], ['divide', '÷'],
      ['deg', '°'], ['plusmn', '±'], ['euro', '€'], ['pound', '£'], ['yen', '¥'], ['cent', '¢'],
      ['sect', '§'], ['para', '¶'], ['shy', '\u00ad'],
    ];
    for (const [name, char] of names) {
      const raw = `x&${name};y`;
      const decoded = decodeText(raw, 0, raw.length);
      assert.ok(decoded, name);
      assert.equal(decoded.text, `x${char}y`, name);
      assert.deepEqual(decoded.map[1], [1, 1 + name.length + 2], `${name} maps to its whole reference`);
    }
  });

  test('numeric references, decimal and hex, with the raw range on every code unit', () => {
    const raw = '&#65;&#x42;';
    const decoded = decodeText(raw, 0, raw.length);
    assert.ok(decoded);
    assert.equal(decoded.text, 'AB');
    assert.deepEqual(decoded.map, [[0, 5], [5, 11]]);
  });

  test('an astral reference maps both surrogate units to the one reference range', () => {
    const raw = '&#128512;';
    const decoded = decodeText(raw, 0, raw.length);
    assert.ok(decoded);
    assert.equal(decoded.text, '😀');
    assert.equal(decoded.text.length, 2);
    assert.deepEqual(decoded.map, [[0, 9], [0, 9]]);
  });

  test('0, surrogates and out-of-range code points become U+FFFD, as browsers do', () => {
    for (const ref of ['&#0;', '&#xD800;', '&#1114112;', '&#999999999999999999999999;']) {
      const decoded = decodeText(ref, 0, ref.length);
      assert.ok(decoded, ref);
      assert.equal(decoded.text, '\ufffd', ref);
    }
  });

  test('the Windows-1252 range &#128; to &#159; is undecodable, decimal and hex', () => {
    assert.equal(decodeText('&#128;', 0, 6), null);
    assert.equal(decodeText('&#159;', 0, 6), null);
    assert.equal(decodeText('&#x80;', 0, 6), null);
    assert.equal(decodeText('&#x9F;', 0, 6), null);
    assert.ok(decodeText('&#127;', 0, 6), 'just below the range decodes');
    assert.ok(decodeText('&#160;', 0, 6), 'just above the range decodes');
  });

  test('unknown names, missing semicolons and malformed numeric references are undecodable', () => {
    assert.equal(decodeText('&eacute;', 0, 8), null);
    assert.equal(decodeText('&amp', 0, 4), null);
    assert.equal(decodeText('&amp more', 0, 9), null);
    assert.equal(decodeText('&#;', 0, 3), null);
    assert.equal(decodeText('&#x;', 0, 4), null);
    assert.equal(decodeText('&#65', 0, 4), null);
    assert.equal(decodeText('&AMP;', 0, 5), null, 'the set is the lower-case names only');
  });

  test('an & followed by anything but an ASCII letter or # is a literal &', () => {
    const raw = 'a & b & 5 &é && &';
    const decoded = decodeText(raw, 0, raw.length);
    assert.ok(decoded);
    assert.equal(decoded.text, raw);
    assert.deepEqual(decoded.map[2], [2, 3]);
  });

  test('comments, CDATA and processing instructions never reach the text', () => {
    const raw = 'a<!-- x -->b<![CDATA[y]]>c<?p z?>d<!bogus>e';
    const decoded = decodeText(raw, 0, raw.length);
    assert.ok(decoded);
    assert.equal(decoded.text, 'abcde');
    assert.deepEqual(decoded.map[1], [11, 12], 'b keeps its raw offset after the comment');
  });

  test('child markup never reaches the text; quoted > inside a tag is honoured', () => {
    const raw = 'Hello <b title="x>y">world</b>!';
    const decoded = decodeText(raw, 0, raw.length);
    assert.ok(decoded);
    assert.equal(decoded.text, 'Hello world!');
    assert.equal(decodeText('text</span>', 0, 10)?.text, 'text', 'a stray end tag is not text');
    assert.equal(decodeText('a < b < 3', 0, 9)?.text, 'a < b < 3', 'a lone < stays literal');
  });

  test('attribute values decode references only: a < inside an id is literal', () => {
    const scan = scanHtml('<p id="a<b &amp; c">x</p>');
    assert.deepEqual(scan.elements[0]?.id, { raw: 'a<b &amp; c', decoded: 'a<b & c' });
  });

  test('the range is honoured: a reference cut by the end is undecodable', () => {
    assert.equal(decodeText('&amp;', 0, 4), null);
    const decoded = decodeText('x&amp;y', 1, 6);
    assert.ok(decoded);
    assert.equal(decoded.text, '&');
    assert.deepEqual(decoded.map, [[1, 6]]);
  });
});

// ---- editorTextOf ----

describe('editorTextOf: ASCII whitespace only', () => {
  const editorOf = (raw: string) => {
    const decoded = decodeText(raw, 0, raw.length);
    assert.ok(decoded);
    return editorTextOf(decoded);
  };

  test('runs of ASCII whitespace collapse to one space; ends are trimmed', () => {
    const editor = editorOf(' \t\nHello \r\n world \f ');
    assert.equal(editor.text, 'Hello world');
    assert.deepEqual(editor.map[5], [8, 12], 'the collapsed space covers the whole \\r\\n run');
  });

  test('U+00A0 and other Unicode spaces survive, even at the ends', () => {
    assert.equal(editorOf('\u00a0Hello\u00a0').text, '\u00a0Hello\u00a0');
    assert.equal(editorOf('a\u00a0b').text, 'a\u00a0b');
    assert.equal(editorOf('a\u2003b').text, 'a\u2003b');
    assert.equal(editorOf('\u2003').text, '\u2003');
  });

  test('all-whitespace text becomes empty; the map stays per editor character', () => {
    assert.equal(editorOf(' \r\n\t ').text, '');
    const editor = editorOf('a  b');
    assert.equal(editor.text, 'a b');
    assert.deepEqual(editor.map, [[0, 1], [1, 3], [3, 4]]);
  });

  test('entity-decoded whitespace collapses like literal whitespace', () => {
    assert.equal(editorOf('a&#32;&#32;b').text, 'a b');
    assert.equal(editorOf('&#160;x').text, '\u00a0x', 'a non-breaking space is not ASCII whitespace');
  });
});

// ---- normalizeText parity ----

describe('normalizeText: the same rule as the bridge anchor', () => {
  test('matches src/guest/bridge/anchor.ts on the comparison battery', () => {
    const battery = [
      '', ' ', 'a b', 'a  b', ' a\tb\r\n', 'a\u00a0b', '\u00a0x\u00a0', 'a\u2003b',
      '\ufeffx', 'a\vb', 'one two three', '  one  two  ', 'مرحبا بالعالم', 'אחד שניים',
    ];
    for (const text of battery) {
      assert.equal(normalizeText(text), anchorNormalizeText(text), JSON.stringify(text));
    }
  });
});

// ---- locateTextTarget ----

describe('locateTextTarget: every reason and the certain paths', () => {
  test('a single source leaf is certain, whatever the probe counted', () => {
    const scan = scanHtml('<p id="t">Hello world</p>');
    const result = locateTextTarget(scan, target({ tag: 'p', id: 't', text: 'Hello world', sameCount: 3, sameIndex: 2 }));
    assert.ok('element' in result);
    assert.equal(result.element.id?.decoded, 't');
  });

  test('not a leaf → formatted; truncated → too-long', () => {
    const scan = scanHtml('<p>Hello</p>');
    assert.equal(reasonOf(scan, target({ tag: 'p', text: 'Hello', leaf: false })), 'formatted');
    assert.equal(reasonOf(scan, target({ tag: 'p', text: 'Hello', truncated: true })), 'too-long');
  });

  test('script-made text (nothing in the source matches) → not-in-source', () => {
    const scan = scanHtml('<p>Source words</p>');
    assert.equal(reasonOf(scan, target({ tag: 'p', text: 'Script words' })), 'not-in-source');
    assert.equal(reasonOf(scan, target({ tag: 'h1', text: 'Source words' })), 'not-in-source');
  });

  test('child elements inside the text → formatted', () => {
    const scan = scanHtml('<p>Hello <b>world</b></p>');
    assert.equal(reasonOf(scan, target({ tag: 'p', text: 'Hello world' })), 'formatted');
  });

  test('a comment inside the text → formatted, never not-in-source', () => {
    const scan = fixture('comments.html');
    const tree = scanHtml(scan);
    assert.equal(reasonOf(tree, target({ tag: 'p', text: 'Plain words', id: 'commented' })), 'formatted');
    assert.equal(reasonOf(tree, target({ tag: 'p', text: 'Plain words', id: 'cdata' })), 'formatted');
    assert.equal(reasonOf(tree, target({ tag: 'p', text: 'Plain words', id: 'pi' })), 'formatted');
    const clean = locateTextTarget(tree, target({ tag: 'p', text: 'Plain words', id: 'clean' }));
    assert.ok('element' in clean, 'a comment elsewhere in the file does not block the clean element');
  });

  test('implied end tags → unclear (the explicit-end-tag rule)', () => {
    const tree = scanHtml(fixture('implied-end-tags.html'));
    assert.equal(reasonOf(tree, target({ tag: 'li', text: 'Two' })), 'unclear');
    assert.equal(reasonOf(tree, target({ tag: 'p', text: 'One' })), 'unclear');
    assert.equal(reasonOf(tree, target({ tag: 'p', text: 'Inner', id: 'inner' })), 'unclear');
    const closed = locateTextTarget(tree, target({ tag: 'p', text: 'Closed', id: 'closed' }));
    assert.ok('element' in closed);
    // <li>One nests <li>Two in the tolerant scan, so its text differs: an honest not-in-source.
    assert.equal(reasonOf(tree, target({ tag: 'li', text: 'One' })), 'not-in-source');
    // An implied close that nests an empty child reads as formatted (the scan sees a child).
    const nested = scanHtml('<div><p>One<p></p></div>');
    assert.equal(reasonOf(nested, target({ tag: 'p', text: 'One' })), 'formatted');
  });

  test('undecodable entities → unclear, not not-in-source (PS §3)', () => {
    const tree = scanHtml(fixture('entities.html'));
    assert.equal(reasonOf(tree, target({ tag: 'p', text: '€ euro', id: 'win1252' })), 'unclear');
    assert.equal(reasonOf(tree, target({ tag: 'p', text: 'Ÿ beta', id: 'win1252hex' })), 'unclear');
    assert.equal(reasonOf(tree, target({ tag: 'p', text: 'é tale', id: 'unknown' })), 'unclear');
    assert.equal(reasonOf(tree, target({ tag: 'p', text: '& more', id: 'nosemi' })), 'unclear');
  });

  test('duplicates: the count and index must agree with the frame', () => {
    const tree = scanHtml(fixture('duplicates.html'));
    const raw = fixture('duplicates.html');
    const secondButtonAt = raw.indexOf('<button>Learn more</button>', raw.indexOf('<button>') + 1);
    const second = locateTextTarget(tree, target({ tag: 'button', text: 'Learn more', sameCount: 2, sameIndex: 1 }));
    assert.ok('element' in second);
    assert.equal(second.element.startTag[0], secondButtonAt);
    const first = locateTextTarget(tree, target({ tag: 'button', text: 'Learn more', sameCount: 2, sameIndex: 0 }));
    assert.ok('element' in first);
    assert.ok(first.element.startTag[0] < second.element.startTag[0]);
    // A script-made third copy: the counts differ → refuse.
    assert.equal(reasonOf(tree, target({ tag: 'button', text: 'Learn more', sameCount: 3, sameIndex: 2 })), 'ambiguous');
    // No count from the probe (scan cap) with several leaves → refuse.
    assert.equal(reasonOf(tree, target({ tag: 'button', text: 'Learn more', sameCount: 0 })), 'ambiguous');
    // An out-of-range index is refused, never guessed.
    assert.equal(reasonOf(tree, target({ tag: 'button', text: 'Learn more', sameCount: 2, sameIndex: 5 })), 'ambiguous');
  });

  test('ids: null means no id attribute; a decoded id must match exactly', () => {
    const tree = scanHtml(fixture('duplicates.html'));
    const special = locateTextTarget(tree, target({ tag: 'button', text: 'Learn more', id: 'special' }));
    assert.ok('element' in special);
    assert.equal(special.element.id?.raw, 'special');
    assert.equal(reasonOf(tree, target({ tag: 'button', text: 'Learn more', id: 'absent' })), 'not-in-source');
    const decodedId = scanHtml('<p id="caf&#233;">x</p>');
    const match = locateTextTarget(decodedId, target({ tag: 'p', text: 'x', id: 'café' }));
    assert.ok('element' in match);
    assert.equal(reasonOf(decodedId, target({ tag: 'p', text: 'x' })), 'not-in-source', 'an element with an id is not "no id"');
    const emptyId = scanHtml('<p id="">x</p>');
    assert.equal(reasonOf(emptyId, target({ tag: 'p', text: 'x' })), 'not-in-source');
    const badId = scanHtml('<p id="&#128;">x</p>');
    assert.equal(reasonOf(badId, target({ tag: 'p', text: 'x', id: 'anything' })), 'unclear');
  });

  test('foreign and inert content is never a candidate', () => {
    const tree = scanHtml('<svg><text>Hi</text></svg><template><p>Hi</p></template><title>Hi</title><p>Hi</p>');
    const result = locateTextTarget(tree, target({ tag: 'text', text: 'Hi' }));
    assert.ok('reason' in result);
    assert.equal(reasonOf(tree, target({ tag: 'title', text: 'Hi' })), 'not-in-source');
    const p = locateTextTarget(tree, target({ tag: 'p', text: 'Hi' }));
    assert.ok('element' in p, 'the template copy is inert; the live p is the one candidate');
    assert.equal(p.element.inert, false);
  });

  test('entities and whitespace layout compare through normalizeText', () => {
    const tree = scanHtml('<p>\n  Build &amp; ship\n  your ideas.\n</p>');
    const result = locateTextTarget(tree, target({ tag: 'p', text: 'Build & ship your ideas.' }));
    assert.ok('element' in result);
  });
});

// ---- escapeText (E6) ----

describe('escapeText: typed text stays text', () => {
  test('& < > are escaped; quotes, NBSP and every other character stay literal', () => {
    assert.equal(escapeText('</p><script>alert(1)</script>'), '&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeText('a & b'), 'a &amp; b');
    assert.equal(escapeText('"q" \'a\' \u00a0 © 😀'), '"q" \'a\' \u00a0 © 😀');
    assert.equal(escapeText(''), '');
  });
});

// ---- the splice (§3.4) ----

describe('spliceElementText: the smallest change, verified', () => {
  const spliceOf = (raw: string, id: string, before: string, after: string) => {
    const scan = scanHtml(raw);
    const element = elementById(scan, id);
    return { scan, element, result: spliceElementText(raw, element, before, after) };
  };

  test('only the changed run is replaced; untouched entities keep their spelling', () => {
    const raw = '<p id="t">Build &amp; ship your ideas.</p>';
    const { result } = spliceOf(raw, 't', 'Build & ship your ideas.', 'Build & send your ideas.');
    assert.ok(result);
    assert.equal(result.text, '<p id="t">Build &amp; send your ideas.</p>');
    // The smallest change: ship → send keeps the common s, replaces hip with end.
    assert.equal(raw.slice(result.splice.rawFrom, result.splice.rawTo), 'hip');
    assert.equal(result.splice.replacement, 'end');
  });

  test('E6: </p><script> can never become markup', () => {
    const raw = '<p id="t">Hello</p>';
    const after = '</p><script>alert(1)</script>';
    const { result } = spliceOf(raw, 't', 'Hello', after);
    assert.ok(result);
    assert.equal(result.text, '<p id="t">&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    const again = scanHtml(result.text);
    assert.equal(again.elements.some((e) => e.tag === 'script'), false);
    const p = again.elements.find((e) => e.tag === 'p');
    assert.ok(p);
    assert.equal(p.childElements.length, 0);
    assert.ok(p.endTag);
    const decoded = decodeText(result.text, p.inner[0], p.inner[1]);
    assert.ok(decoded);
    assert.equal(editorTextOf(decoded).text, after);
  });

  test('E6: typed < > & are escaped, quotes are written as UTF-8 text', () => {
    const raw = '<p id="t">Hello</p>';
    const after = '<b>bold</b> & "quotes"';
    const { result } = spliceOf(raw, 't', 'Hello', after);
    assert.ok(result);
    assert.equal(result.text, '<p id="t">&lt;b&gt;bold&lt;/b&gt; &amp; "quotes"</p>');
  });

  test('CRLF fixture: every byte outside the range is identical', () => {
    const raw = fixture('crlf.html');
    const { result } = spliceOf(raw, 'intro', 'Build & ship your ideas.', 'Build & send your ideas.');
    assert.ok(result);
    assert.equal(result.text, raw.replace('Build &amp; ship', 'Build &amp; send'));
    assert.equal(raw.slice(result.splice.rawFrom, result.splice.rawTo), 'hip');
    assert.equal(result.text.slice(0, result.splice.rawFrom), raw.slice(0, result.splice.rawFrom));
    assert.equal(result.text.slice(result.splice.rawFrom + result.splice.replacement.length), raw.slice(result.splice.rawTo));
    const crlfCount = (s: string) => (s.match(/\r\n/g) ?? []).length;
    assert.equal(crlfCount(result.text), crlfCount(raw));
    assert.ok(result.text.includes('<!-- keep this comment -->'));
    assert.ok(result.text.includes("data-x='a>b'"));
  });

  test('BOM fixture: the mark survives the write', () => {
    const raw = fixture('bom.html');
    const { result } = spliceOf(raw, 'lead', 'Hello world', 'Hi world');
    assert.ok(result);
    assert.equal(result.text, raw.replace('Hello world', 'Hi world'));
    assert.ok(result.text.startsWith('\ufeff'));
  });

  test('RTL fixture: the splice is logical order, bytes outside stay', () => {
    const raw = fixture('rtl.html');
    const middle = spliceOf(raw, 'he', 'אחד שניים שלושה', 'אחד שתיים שלושה');
    assert.ok(middle.result);
    assert.equal(middle.result.text, raw.replace('שניים', 'שתיים'));
    assert.equal(raw.slice(middle.result.splice.rawFrom, middle.result.splice.rawTo), 'נ');
    assert.equal(middle.result.splice.replacement, 'ת');
    const append = spliceOf(raw, 'ar', 'مرحبا بالعالم', 'مرحبا بالعالم الجديد');
    assert.ok(append.result);
    assert.equal(append.result.text, raw.replace('مرحبا بالعالم</p>', 'مرحبا بالعالم الجديد</p>'));
  });

  test('pure insertion: at the end, at the start, into empty and whitespace-only text', () => {
    const end = spliceOf('<p id="t">Hello</p>', 't', 'Hello', 'Hello!');
    assert.ok(end.result);
    assert.equal(end.result.text, '<p id="t">Hello!</p>');
    assert.equal(end.result.splice.rawFrom, end.result.splice.rawTo);

    const start = spliceOf('<p id="t">Hello</p>', 't', 'Hello', 'Oh Hello');
    assert.ok(start.result);
    assert.equal(start.result.text, '<p id="t">Oh Hello</p>');

    const empty = spliceOf('<p id="t"></p>', 't', '', 'Hi');
    assert.ok(empty.result);
    assert.equal(empty.result.text, '<p id="t">Hi</p>');

    const ws = spliceOf('<p id="t">  \n  </p>', 't', '', 'Hi');
    assert.ok(ws.result);
    assert.equal(ws.result.text, '<p id="t">  \n  Hi</p>', 'insertion sits after the leading whitespace');

    const indented = spliceOf('<p id="t">\n  Hello\n</p>', 't', 'Hello', 'Hello!');
    assert.ok(indented.result);
    assert.equal(indented.result.text, '<p id="t">\n  Hello!\n</p>');
  });

  test('empty after: the element stays with its leading and trailing whitespace', () => {
    const raw = '<p id="t">\n  Hello\n</p>';
    const { result } = spliceOf(raw, 't', 'Hello', '');
    assert.ok(result);
    assert.equal(result.text, '<p id="t">\n  \n</p>');
  });

  test('surrogate pairs are never split, literal or entity-encoded', () => {
    const literal = spliceOf('<p id="t">Hi 😀</p>', 't', 'Hi 😀', 'Hi 😃');
    assert.ok(literal.result);
    assert.equal(literal.result.text, '<p id="t">Hi 😃</p>');
    assert.equal('<p id="t">Hi 😀</p>'.slice(literal.result.splice.rawFrom, literal.result.splice.rawTo), '😀');

    const entity = spliceOf('<p id="t">&#128512; tail</p>', 't', '😀 tail', '😃 tail');
    assert.ok(entity.result);
    assert.equal(entity.result.text, '<p id="t">😃 tail</p>');
    assert.equal('<p id="t">&#128512; tail</p>'.slice(entity.result.splice.rawFrom, entity.result.splice.rawTo), '&#128512;');

    const around = spliceOf('<p id="t">😀a</p>', 't', '😀a', '😀b');
    assert.ok(around.result);
    assert.equal(around.result.text, '<p id="t">😀b</p>');

    const before = spliceOf('<p id="t">a😀</p>', 't', 'a😀', 'b😀');
    assert.ok(before.result);
    assert.equal(before.result.text, '<p id="t">b😀</p>');

    const typed = spliceOf('<p id="t">x</p>', 't', 'x', '😀 🎉');
    assert.ok(typed.result);
    assert.equal(typed.result.text, '<p id="t">😀 🎉</p>');
  });

  test('a lone surrogate in the typed text is refused (it cannot round-trip UTF-8)', () => {
    const { result } = spliceOf('<p id="t">x</p>', 't', 'x', 'a\ud800b');
    assert.equal(result, null);
  });

  test('before must equal the element editor text; undecodable inner refuses', () => {
    const raw = '<p id="t">Hello</p>';
    const scan = scanHtml(raw);
    const element = elementById(scan, 't');
    assert.equal(spliceElementText(raw, element, 'Wrong', 'x'), null);
    const win = fixture('entities.html');
    const winScan = scanHtml(win);
    assert.equal(spliceElementText(win, elementById(winScan, 'win1252'), '€ euro', 'x'), null);
  });

  test('planTextSplice maps the changed editor range through both maps', () => {
    const raw = '<p id="t">\n  Build &amp; ship\n  your ideas.\n</p>';
    const scan = scanHtml(raw);
    const element = elementById(scan, 't');
    const before = 'Build & ship your ideas.';
    const splice = planTextSplice(raw, element, before, 'Build & send your ideas.');
    assert.ok(splice);
    assert.equal(raw.slice(splice.rawFrom, splice.rawTo), 'hip');
    assert.equal(splice.replacement, 'end');
    // Changing the last character replaces only that character, not the whole word.
    const ws = planTextSplice(raw, element, before, 'Build & ship your ideas!');
    assert.ok(ws);
    assert.equal(raw.slice(ws.rawFrom, ws.rawTo), '.');
    assert.equal(ws.replacement, '!');
    // A changed collapsed space replaces the whole source run, CRLF and indentation included.
    const run = planTextSplice(raw, element, before, 'Build & shipXyour ideas.');
    assert.ok(run);
    assert.equal(raw.slice(run.rawFrom, run.rawTo), '\n  ');
    assert.equal(run.replacement, 'X');
  });

  test('the verify step refuses a result that is not the asked text (literal §3.4 step 6)', () => {
    // after carries leading ASCII whitespace: editorTextOf collapses it, so the literal
    // verify (editor text === after) refuses. Flagged for T3/U1 in the T1 report.
    const { result } = spliceOf('<p id="t">Hello</p>', 't', 'Hello', ' Hello');
    assert.equal(result, null);
  });

  test('a no-op edit verifies and changes nothing', () => {
    const raw = '<p id="t">Hello</p>';
    const { result } = spliceOf(raw, 't', 'Hello', 'Hello');
    assert.ok(result);
    assert.equal(result.text, raw);
  });
});

// ---- file-level gates (§3.3 order, §3.4 steps 2–3) ----

describe('sourceFileReason: link, size and encoding gates in the §3.3 order', () => {
  test('link wins over size and encoding', () => {
    assert.equal(sourceFileReason({ link: true, charLength: SOURCE_TEXT_MAX + 1, utf8: false }), 'link');
  });
  test('size wins over encoding; the cap itself is allowed', () => {
    assert.equal(sourceFileReason({ link: false, charLength: SOURCE_TEXT_MAX + 1, utf8: false }), 'file-too-large');
    assert.equal(sourceFileReason({ link: false, charLength: SOURCE_TEXT_MAX, utf8: true }), null);
  });
  test('not UTF-8 is refused; a clean file passes', () => {
    assert.equal(sourceFileReason({ link: false, charLength: 10, utf8: false }), 'not-utf8');
    assert.equal(sourceFileReason({ link: false, charLength: 10, utf8: true }), null);
  });
});
