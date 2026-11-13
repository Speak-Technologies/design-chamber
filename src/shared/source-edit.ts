// The source scanner, locator and splice for in-place text edits
// (documentation/specs/phase-2-technical.md §3.2–§3.4; PS §2 E2/E5/E6, §3).
// Pure: the page runs these to fill the editor and the disabled reasons, and the service
// runs them again on the same bytes to decide what is written (AD-2) — the source decides,
// never the frame's DOM. No HTML library: a tolerant tokenizer in the style of
// src/service/bundle.ts, with one hard rule — an element is a candidate only when its end
// tag is explicit and matches, so anything the scan could place differently from the browser
// is refused rather than guessed (E2).
//
// Every offset is a UTF-16 code-unit index into the decoded source string (the unit the
// service's undo records use, §2.1); ranges are [from, to). The splice never touches a
// character outside its range: indentation, CRLF, the BOM, comments, attribute order and
// quoting, and the entity spelling of untouched text all survive (E5). Typed text is
// escaped before it is written and the result is re-scanned (E6).

import type { EditTarget } from './api.ts';
import { SOURCE_TEXT_MAX } from './limits.ts';

/** A [from, to) range of UTF-16 code-unit offsets. */
export type Range = [number, number];

export type ScanElement = {
  /** Lower-cased tag name. */
  tag: string;
  startTag: Range;
  /** Content between the start tag and the end tag (or the implicit close / EOF). */
  inner: Range;
  /** The explicit matching end tag; null when the element was closed implicitly or never. */
  endTag: Range | null;
  /** The id attribute: raw value and decoded value (null when undecodable); null when absent. */
  id: { raw: string; decoded: string | null } | null;
  /** Index into ScanTree.elements of the parent; -1 at the top level. */
  parent: number;
  /** Indices of the direct child elements, in document order. */
  childElements: number[];
  /** A comment, CDATA section or processing instruction sits inside inner. */
  hasComment: boolean;
  /** Inside svg or math (or one of them): foreign content, never a text-edit candidate. */
  foreign: boolean;
  /** Inside template, noscript or head, or itself a raw-text element: not rendered text. */
  inert: boolean;
};

export type ScanTree = {
  /** The scanned source string; every range indexes into it. */
  text: string;
  /** Elements in document order (start-tag order). */
  elements: ScanElement[];
};

/** Decoded text with one raw range per UTF-16 code unit (both units of a surrogate pair share the reference's range). */
export type DecodedText = { text: string; map: Range[] };

/** Editor text with one decoded range per UTF-16 code unit (a collapsed space covers the whole whitespace run). */
export type EditorText = { text: string; map: Range[] };

/**
 * What the locator needs: the wire EditTarget plus the two probe facts the page holds.
 * Service callers pass `leaf: true, truncated: false` — the leaves filter and the
 * before/after length checks enforce both anyway (§3.4 steps 3–4).
 */
export type LocateTarget = EditTarget & { leaf: boolean; truncated: boolean };

export type LocateReason = 'not-in-source' | 'formatted' | 'too-long' | 'ambiguous' | 'unclear';

export type LocateResult = { element: ScanElement } | { reason: LocateReason };

/** The raw range to replace and the escaped replacement; `removed` for undo is raw.slice(rawFrom, rawTo). */
export type TextSplice = { rawFrom: number; rawTo: number; replacement: string };

// ---- character classes ----

const isAsciiWs = (code: number): boolean =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;

const isAsciiLetter = (code: number): boolean =>
  (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);

const isAsciiLetterOrDigit = (code: number): boolean =>
  isAsciiLetter(code) || (code >= 0x30 && code <= 0x39);

const isDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;

const isHexDigit = (code: number): boolean =>
  isDigit(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** True when cutting `text` at `at` would fall between a surrogate pair's two units. */
const splitsPair = (text: string, at: number): boolean =>
  at > 0 && at < text.length && isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at));

/** A lone surrogate cannot round-trip UTF-8 (it encodes as U+FFFD), so typed text holding one is refused. */
const hasLoneSurrogate = (text: string): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code)) {
      if (!isLowSurrogate(text.charCodeAt(i + 1))) return true;
      i += 1;
    } else if (isLowSurrogate(code)) {
      return true;
    }
  }
  return false;
};

// ---- decodeText (§3.2) ----

/** The named set the editor decodes; anything else refuses instead of guessing a 2 000-name table. */
const NAMED_REFS: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae',
  // The mdash value is decode data (the character &mdash; names), not copy; written as a code
  // point so the KI-7 copy guard, which reads every string literal, stays unbroken.
  trade: '\u2122', hellip: '\u2026', mdash: String.fromCharCode(0x2014), ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', bull: '\u2022', middot: '\u00b7',
  times: '\u00d7', divide: '\u00f7', deg: '\u00b0', plusmn: '\u00b1', euro: '\u20ac', pound: '\u00a3',
  yen: '\u00a5', cent: '\u00a2', sect: '\u00a7', para: '\u00b6', shy: '\u00ad',
};

/** End of a comment-like region starting at `at` (comment, CDATA, PI or bogus comment), bounded by `to`. */
const commentLikeEnd = (raw: string, at: number, to: number): number => {
  if (raw.startsWith('<!--', at)) {
    const end = raw.indexOf('-->', at + 4);
    return end === -1 || end + 3 > to ? to : end + 3;
  }
  if (raw.startsWith('<![CDATA[', at)) {
    const end = raw.indexOf(']]>', at + 9);
    return end === -1 || end + 3 > to ? to : end + 3;
  }
  const gt = raw.indexOf('>', at);
  return gt === -1 || gt + 1 > to ? to : gt + 1;
};

/** End of a tag-like region (`<name …>` or `</name …>`), honouring quoted attribute values, bounded by `to`. */
const tagLikeEnd = (raw: string, at: number, to: number): number => {
  let i = at + 1;
  let quote = '';
  while (i < to) {
    const c = raw.charAt(i);
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
    i += 1;
  }
  return to;
};

/**
 * Decode character references in raw[from, to) with a per-code-unit raw offset map.
 * Null when the text is undecodable: a &#128;–&#159; reference (Windows-1252, not guessed),
 * an unknown named reference, or a reference without its semicolon.
 * `skipMarkup` (text, not attribute values): comments, CDATA, processing instructions and
 * tags never reach the text — the DOM's textContent does not hold them, and the locator's
 * formatted reason depends on a child element's text reading as its textContent.
 */
const decodeReferences = (raw: string, from: number, to: number, skipMarkup: boolean): DecodedText | null => {
  let text = '';
  const map: Range[] = [];
  let i = from;
  while (i < to) {
    if (skipMarkup && raw.charAt(i) === '<') {
      if (raw.startsWith('<!--', i) || raw.startsWith('<![CDATA[', i) || raw.startsWith('<?', i) || raw.startsWith('<!', i)) {
        i = commentLikeEnd(raw, i, to);
        continue;
      }
      if (raw.startsWith('</', i) || isAsciiLetter(raw.charCodeAt(i + 1))) {
        i = tagLikeEnd(raw, i, to);
        continue;
      }
    }
    if (raw.charAt(i) !== '&') {
      text += raw.charAt(i);
      map.push([i, i + 1]);
      i += 1;
      continue;
    }
    const next = i + 1 < to ? raw.charCodeAt(i + 1) : NaN;
    if (!isAsciiLetter(next) && next !== 0x23 /* # */) {
      // An & followed by anything but an ASCII letter or # is a literal &.
      text += '&';
      map.push([i, i + 1]);
      i += 1;
      continue;
    }
    if (next === 0x23) {
      let j = i + 2;
      const hex = raw.charAt(j) === 'x' || raw.charAt(j) === 'X';
      if (hex) j += 1;
      const digitsStart = j;
      while (j < to && (hex ? isHexDigit(raw.charCodeAt(j)) : isDigit(raw.charCodeAt(j)))) j += 1;
      if (j === digitsStart || j >= to || raw.charAt(j) !== ';') return null;
      const value = parseInt(raw.slice(digitsStart, j), hex ? 16 : 10);
      if (value >= 0x80 && value <= 0x9f) return null; // Windows-1252 range: refuse, don't guess the table
      const char = value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(value);
      const ref: Range = [i, j + 1];
      for (let k = 0; k < char.length; k += 1) map.push(ref);
      text += char;
      i = j + 1;
      continue;
    }
    let j = i + 1;
    while (j < to && isAsciiLetterOrDigit(raw.charCodeAt(j))) j += 1;
    if (j >= to || raw.charAt(j) !== ';') return null;
    const value = NAMED_REFS[raw.slice(i + 1, j)];
    if (value === undefined) return null;
    text += value;
    map.push([i, j + 1]);
    i = j + 1;
  }
  return { text, map };
};

/** Decode element text: references decoded, markup and comments skipped (textContent semantics). */
export const decodeText = (raw: string, from: number, to: number): DecodedText | null =>
  decodeReferences(raw, from, to, true);

/** Decode an attribute value: references only — a `<` inside a value is literal, not markup. */
const decodeAttrValue = (raw: string): string | null => {
  const decoded = decodeReferences(raw, 0, raw.length, false);
  return decoded === null ? null : decoded.text;
};

// ---- editorTextOf (§3.2) ----

/**
 * The editor's reading of decoded text: runs of ASCII whitespace collapse to one space and
 * the ends are trimmed of ASCII whitespace only — never String.trim(), which would also
 * strip U+00A0 and the other Unicode spaces. A non-breaking space survives an edit.
 * The map gives each editor character its range in the DECODED text (the decode map then
 * gives the raw range); a collapsed space covers the whole whitespace run.
 */
export const editorTextOf = (decoded: DecodedText): EditorText => {
  const { text } = decoded;
  const len = text.length;
  let out = '';
  const outMap: Range[] = [];
  let i = 0;
  while (i < len && isAsciiWs(text.charCodeAt(i))) i += 1;
  while (i < len) {
    if (isAsciiWs(text.charCodeAt(i))) {
      const start = i;
      while (i < len && isAsciiWs(text.charCodeAt(i))) i += 1;
      if (i < len) {
        out += ' ';
        outMap.push([start, i]);
      }
    } else {
      out += text.charAt(i);
      outMap.push([i, i + 1]);
      i += 1;
    }
  }
  return { text: out, map: outMap };
};

/**
 * The DOM-text comparison rule, identical to the bridge's normalizeText
 * (src/guest/bridge/anchor.ts): \s collapse and trim. Mirrored here because shared code
 * never imports the guest; test/shared/source-edit.test.ts asserts the parity.
 */
export const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();

// ---- scanHtml (§3.2) ----

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript']);
const INERT_ANCESTORS = new Set(['template', 'noscript', 'head']);
const FOREIGN_ROOTS = new Set(['svg', 'math']);

type StartTag = { tag: string; end: number; selfClosing: boolean; idRaw: string | null };

/** Parse a start tag at `lt` (`<` + ASCII letter); null when it is not one. Attributes are scanned, only id is kept. */
const parseStartTag = (text: string, lt: number): StartTag | null => {
  const nameMatch = /^[A-Za-z][^\s/>]*/.exec(text.slice(lt + 1, lt + 128));
  if (!nameMatch) return null;
  const tag = nameMatch[0].toLowerCase();
  const len = text.length;
  let i = lt + 1 + nameMatch[0].length;
  let selfClosing = false;
  let idRaw: string | null = null;
  for (;;) {
    while (i < len && isAsciiWs(text.charCodeAt(i))) i += 1;
    const c = text.charAt(i);
    if (i >= len) return { tag, end: len, selfClosing: false, idRaw }; // unterminated tag at EOF
    if (c === '>') {
      i += 1;
      break;
    }
    if (c === '/' && text.charAt(i + 1) === '>') {
      selfClosing = true;
      i += 2;
      break;
    }
    if (c === '/') {
      i += 1; // stray slash inside a tag (`<div / >`)
      continue;
    }
    const attrStart = i;
    while (i < len && !isAsciiWs(text.charCodeAt(i)) && text.charAt(i) !== '=' && text.charAt(i) !== '>' && !(text.charAt(i) === '/' && text.charAt(i + 1) === '>')) i += 1;
    const attrName = text.slice(attrStart, i);
    if (attrName === '') {
      i += 1; // always make progress
      continue;
    }
    let j = i;
    while (j < len && isAsciiWs(text.charCodeAt(j))) j += 1;
    let value: string | null = null;
    if (text.charAt(j) === '=') {
      j += 1;
      while (j < len && isAsciiWs(text.charCodeAt(j))) j += 1;
      const quote = text.charAt(j);
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, j + 1);
        value = text.slice(j + 1, close === -1 ? len : close);
        i = close === -1 ? len : close + 1;
      } else {
        const valueStart = j;
        while (j < len && !isAsciiWs(text.charCodeAt(j)) && text.charAt(j) !== '>') j += 1;
        value = text.slice(valueStart, j);
        i = j;
      }
    } else {
      i = attrStart + attrName.length;
    }
    if (attrName.toLowerCase() === 'id' && idRaw === null) idRaw = value ?? '';
  }
  return { tag, end: i, selfClosing, idRaw };
};

/** End of a raw-text element's content: the first `</name` a browser would honour (bundle.ts convention). */
const findRawTextEnd = (text: string, from: number, tag: string): number => {
  // Only the fixed RAW_TEXT_TAGS names reach this, so the tag is regex-safe.
  const re = new RegExp(`</${tag}(?=[\\s>/]|$)`, 'gi');
  re.lastIndex = from;
  const match = re.exec(text);
  return match ? match.index : text.length;
};

/**
 * The tolerant scan: doctype, comments (unterminated → to the end), quoted attribute values
 * containing `>`, void elements, raw-text elements, stray end tags (ignored) and end tags
 * that close an outer element (pop to it). It does not implement the HTML insertion modes;
 * the explicit-end-tag rule in locateTextTarget refuses what that could place differently.
 */
export const scanHtml = (text: string): ScanTree => {
  const elements: ScanElement[] = [];
  const stack: number[] = [];
  const len = text.length;
  let pos = 0;

  const markComment = (): void => {
    for (const idx of stack) {
      const open = elements[idx];
      if (open) open.hasComment = true;
    }
  };

  while (pos < len) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) break;
    pos = lt;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      pos = end === -1 ? len : end + 3;
      markComment();
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      pos = end === -1 ? len : end + 3;
      markComment();
      continue;
    }
    if (text.startsWith('<!', lt) || text.startsWith('<?', lt)) {
      const gt = text.indexOf('>', lt);
      pos = gt === -1 ? len : gt + 1;
      if (!/^<!doctype/i.test(text.slice(lt, lt + 10))) markComment();
      continue;
    }
    if (text.startsWith('</', lt)) {
      const nameMatch = /^<\/([A-Za-z][^\s/>]*)/.exec(text.slice(lt, lt + 128));
      const gt = text.indexOf('>', lt);
      const stop = gt === -1 ? len : gt + 1;
      pos = stop;
      if (!nameMatch) continue;
      const name = (nameMatch[1] ?? '').toLowerCase();
      if (VOID_TAGS.has(name)) continue;
      let at = -1;
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        const open = elements[stack[k] ?? -1];
        if (open && open.tag === name) {
          at = k;
          break;
        }
      }
      if (at === -1) continue; // stray end tag
      // Elements above the match close implicitly: no end tag, content up to this tag.
      while (stack.length > at + 1) {
        const idx = stack.pop();
        const closed = idx === undefined ? undefined : elements[idx];
        if (closed) closed.inner = [closed.startTag[1], lt];
      }
      const idx = stack.pop();
      const el = idx === undefined ? undefined : elements[idx];
      if (el) {
        el.endTag = [lt, stop];
        el.inner = [el.startTag[1], lt];
      }
      continue;
    }
    const parsed = parseStartTag(text, lt);
    if (parsed === null) {
      pos = lt + 1; // a lone `<` is text
      continue;
    }
    const { tag, end, selfClosing, idRaw } = parsed;
    pos = end;

    const parent = stack.length > 0 ? (stack[stack.length - 1] ?? -1) : -1;
    const parentEl = parent === -1 ? undefined : elements[parent];
    const foreign = (parentEl !== undefined && parentEl.foreign) || FOREIGN_ROOTS.has(tag);
    // template itself is inert too: its content is a document fragment, not rendered text.
    const inert = (parentEl !== undefined && (parentEl.inert || INERT_ANCESTORS.has(parentEl.tag)))
      || RAW_TEXT_TAGS.has(tag) || tag === 'template';
    const idDecoded = idRaw === null ? null : decodeAttrValue(idRaw);
    const el: ScanElement = {
      tag,
      startTag: [lt, end],
      inner: [end, end],
      endTag: null,
      id: idRaw === null ? null : { raw: idRaw, decoded: idDecoded },
      parent,
      childElements: [],
      hasComment: false,
      foreign,
      inert,
    };
    const idx = elements.length;
    elements.push(el);
    if (parentEl) parentEl.childElements.push(idx);

    if (VOID_TAGS.has(tag)) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      // plaintext: browsers honour no end tag at all, everything to EOF is its content.
      const contentEnd = tag === 'plaintext' ? len : findRawTextEnd(text, end, tag);
      el.inner = [end, contentEnd];
      if (contentEnd < len) {
        const gt = text.indexOf('>', contentEnd);
        const stop = gt === -1 ? len : gt + 1;
        el.endTag = [contentEnd, stop];
        pos = stop;
      } else {
        pos = len;
      }
      continue;
    }

    // /> closes only void elements and foreign content; on any other HTML element it is
    // ignored, as browsers ignore it, so the element stays open.
    if (selfClosing && foreign) continue;
    stack.push(idx);
  }

  // Still-open elements at EOF: content to the end, no explicit end tag.
  for (const idx of stack) {
    const el = elements[idx];
    if (el) el.inner = [el.startTag[1], len];
  }
  return { text, elements };
};

// ---- locateTextTarget (§3.2) ----

/**
 * Find the one source element the frame's anchor names, or refuse with a reason.
 * A single source leaf is certain; with several, the frame and the source must agree on
 * the count before the document-order index is trusted. Undecodable candidates answer
 * `unclear` (PS §3: unknown entities), never a guess.
 */
export const locateTextTarget = (scan: ScanTree, target: LocateTarget): LocateResult => {
  if (!target.leaf) return { reason: 'formatted' };
  if (target.truncated) return { reason: 'too-long' };

  const matches: ScanElement[] = [];
  let anyUndecodable = false;
  for (const e of scan.elements) {
    if (e.tag !== target.tag || e.foreign || e.inert) continue;
    if (target.id === null) {
      if (e.id !== null) continue;
    } else {
      if (e.id === null) continue;
      if (e.id.decoded === null) {
        anyUndecodable = true;
        continue;
      }
      if (e.id.decoded !== target.id) continue;
    }
    // normalizeText never grows text, so a shorter raw inner can never match: skip the decode.
    if (e.inner[1] - e.inner[0] < target.text.length) continue;
    const decoded = decodeText(scan.text, e.inner[0], e.inner[1]);
    if (decoded === null) {
      anyUndecodable = true;
      continue;
    }
    if (normalizeText(decoded.text) === target.text) matches.push(e);
  }

  if (matches.length === 0) return { reason: anyUndecodable ? 'unclear' : 'not-in-source' };
  const leaves = matches.filter((e) => e.childElements.length === 0 && !e.hasComment && e.endTag !== null);
  if (leaves.length === 0) {
    const anyFormatted = matches.some((e) => e.childElements.length > 0 || e.hasComment);
    return { reason: anyFormatted ? 'formatted' : 'unclear' };
  }
  const only = leaves.length === 1 ? leaves[0] : undefined;
  if (only) return { element: only };
  if (target.sameCount > 0 && leaves.length === target.sameCount) {
    const picked = leaves[target.sameIndex];
    if (picked) return { element: picked };
  }
  return { reason: 'ambiguous' };
};

// ---- the splice (§3.4 steps 5–6) ----

/** E6: typed text is written as text — & < > escaped, nothing else changes. */
export const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Plan the smallest splice (§3.4 step 5): the common prefix and suffix of before and after
 * (UTF-16 code units, moved off a surrogate pair middle) map through the editor map and the
 * decode map to a raw range. Null when the element's editor text is not `before`, the inner
 * is undecodable, or `after` holds a lone surrogate.
 */
export const planTextSplice = (raw: string, element: ScanElement, before: string, after: string): TextSplice | null => {
  const decoded = decodeText(raw, element.inner[0], element.inner[1]);
  if (decoded === null) return null;
  const editor = editorTextOf(decoded);
  if (editor.text !== before) return null;
  if (hasLoneSurrogate(after)) return null;

  let p = 0;
  const maxP = Math.min(before.length, after.length);
  while (p < maxP && before.charCodeAt(p) === after.charCodeAt(p)) p += 1;
  if (splitsPair(before, p) || splitsPair(after, p)) p -= 1;
  let s = 0;
  const maxS = maxP - p;
  while (s < maxS && before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)) s += 1;
  if (splitsPair(before, before.length - s) || splitsPair(after, after.length - s)) s -= 1;

  const editFrom = p;
  const editTo = before.length - s;
  let rawFrom: number;
  let rawTo: number;
  if (editFrom < editTo) {
    const first = editor.map[editFrom];
    const last = editor.map[editTo - 1];
    if (!first || !last) return null;
    const dFirst = decoded.map[first[0]];
    const dLast = decoded.map[last[1] - 1];
    if (!dFirst || !dLast) return null;
    rawFrom = dFirst[0];
    rawTo = dLast[1];
  } else {
    // Pure insertion: after the editor character p - 1, or at the start of the trimmed
    // text, or — for empty or whitespace-only text — after the leading whitespace run.
    if (p > 0) {
      const prev = editor.map[p - 1];
      if (!prev) return null;
      const dPrev = decoded.map[prev[1] - 1];
      if (!dPrev) return null;
      rawFrom = dPrev[1];
    } else if (editor.text.length > 0) {
      const first = editor.map[0];
      if (!first) return null;
      const dFirst = decoded.map[first[0]];
      if (!dFirst) return null;
      rawFrom = dFirst[0];
    } else {
      let k = 0;
      while (k < decoded.text.length && isAsciiWs(decoded.text.charCodeAt(k))) k += 1;
      if (k === 0) {
        rawFrom = element.inner[0];
      } else {
        const dWs = decoded.map[k - 1];
        if (!dWs) return null;
        rawFrom = dWs[1];
      }
    }
    rawTo = rawFrom;
  }
  return { rawFrom, rawTo, replacement: escapeText(after.slice(p, after.length - s)) };
};

/**
 * Verify a splice (§3.4 step 6): the bytes outside the range are unchanged, and a re-scan
 * finds the element at the same start-tag offset still a leaf with an explicit end tag whose
 * editor text is exactly `after`. The literal comparison means an `after` with leading,
 * trailing or consecutive ASCII whitespace (or a tab) is refused — the editor text collapses
 * them; the page normalises what it sends (flagged in the T1 report for T3/U1).
 */
export const verifyTextSplice = (original: string, spliced: string, splice: TextSplice, element: ScanElement, after: string): boolean => {
  const { rawFrom, rawTo, replacement } = splice;
  if (rawFrom > rawTo || rawFrom < element.inner[0] || rawTo > element.inner[1]) return false;
  if (spliced.slice(0, rawFrom) !== original.slice(0, rawFrom)) return false;
  if (spliced.slice(rawFrom + replacement.length) !== original.slice(rawTo)) return false;
  const scan = scanHtml(spliced);
  const again = scan.elements.find((e) => e.startTag[0] === element.startTag[0]);
  if (!again || again.childElements.length > 0 || again.hasComment || again.endTag === null) return false;
  const decoded = decodeText(spliced, again.inner[0], again.inner[1]);
  if (decoded === null) return false;
  return editorTextOf(decoded).text === after;
};

/**
 * Plan, apply and verify one text edit; null on any refusal (nothing to write).
 * The answer's `splice` is the undo record's material: start = rawFrom,
 * inserted = replacement.length, removed = raw.slice(rawFrom, rawTo) (§3.4 step 8).
 */
export const spliceElementText = (raw: string, element: ScanElement, before: string, after: string): { text: string; splice: TextSplice } | null => {
  const splice = planTextSplice(raw, element, before, after);
  if (splice === null) return null;
  const text = raw.slice(0, splice.rawFrom) + splice.replacement + raw.slice(splice.rawTo);
  if (!verifyTextSplice(raw, text, splice, element, after)) return null;
  return { text, splice };
};

// ---- file-level gates (§3.3 order; §3.4 steps 2–3) ----

export type SourceFileReason = 'link' | 'file-too-large' | 'not-utf8';

/**
 * The file-level refusals shared by the page (before the user types) and the service (at the
 * write), in the §3.3 order: link, then size, then encoding. Null when the file is editable.
 */
export const sourceFileReason = (input: { link: boolean; charLength: number; utf8: boolean }): SourceFileReason | null => {
  if (input.link) return 'link';
  if (input.charLength > SOURCE_TEXT_MAX) return 'file-too-large';
  if (!input.utf8) return 'not-utf8';
  return null;
};
