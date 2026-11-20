// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11, §2.14, rev 3): the allowlist scan of a
// living page, its mark, and the normalised text its self-hash is taken over. T12b's adoption check
// reads an existing page's mark before it ever lets a generated page replace it (§5.9).
//
// The scan is an allowlist of exactly what the generator emits (rev 3): every construct a lenient
// tokenizer and a browser could read differently (foreign content, comments, raw-text elements,
// entities in URLs, unquoted values, CSS escapes) is outside the lists, so it is a reason before any
// interpretation is needed. Tags are read with the bundler's tokenizer (`html-tags.ts`). Text content
// is never a reason. Pure: no service imports, so the CLI check can bundle it.

import { LIVING_PAGE_MARK_NAME, LIVING_PAGE_MAX_BYTES, SYSTEM_ID_PATTERN } from '../../shared/limits.ts';
import { findRawTextEnd, parseTagAt, type Tag } from '../html-tags.ts';

export type LivingPageMark = { system: string; revision: number; generated: string; hash: string };

export type LivingPageScan = { safe: boolean; reasons: string[]; mark: LivingPageMark | null };

/** A page over this is not scanned (§5.11): `unreadable`, "too large". */
export const LIVING_PAGE_SCAN_MAX_BYTES = LIVING_PAGE_MAX_BYTES + 1024 * 1024;
export const LIVING_PAGE_TOO_LARGE_REASON = 'too large';

const REASONS_MAX = 10;

/** The viewport meta's one allowed content. */
export const LIVING_VIEWPORT = 'width=device-width, initial-scale=1';

/** An attribute's value, double or single quoted; null when the tag does not carry it. */
const attrOf = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? null);
};

const MARK_CONTENT = /^design-chamber\/living-page@1 system=([^\s]+) revision=(\d{1,9}) generated=([^\s]+) hash=([0-9a-f]{64})$/;

/** The mark's `content` read by its grammar (§2.14); null when it is not exactly that shape. */
export const parseMarkContent = (content: string): LivingPageMark | null => {
  const mark = MARK_CONTENT.exec(content);
  if (mark === null) return null;
  const [, system = '', revision = '', generated = '', hash = ''] = mark;
  if (!SYSTEM_ID_PATTERN.test(system) || generated.length > 40 || !Number.isFinite(Date.parse(generated))) return null;
  return { system, revision: Number(revision), generated, hash };
};

/**
 * The `dc-living-page` mark (§2.14): one meta tag whose content is exactly
 * `design-chamber/living-page@1 system=<id> revision=<n> generated=<ISO> hash=<64 hex>`.
 * Null when there is no mark or it is not this shape — the caller treats that as "not this
 * system's page", never as a reason to overwrite the file.
 */
export const readLivingPageMark = (text: string): LivingPageMark | null => {
  for (const tag of text.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attrOf(tag, 'name') !== LIVING_PAGE_MARK_NAME) continue;
    const content = attrOf(tag, 'content');
    return content === null ? null : parseMarkContent(content);
  }
  return null;
};

const ZERO_HASH = '0'.repeat(64);

/** Decode, drop a BOM, LF line ends, no trailing blanks, one final LF, the mark's hash zeroed (§2.14 rev 3). */
export const normaliseForHash = (text: string): string => {
  const lines = (text.startsWith('\uFEFF') ? text.slice(1) : text).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
  const body = `${lines.replace(/\n+$/, '')}\n`;
  return body.replace(/<meta\b[^>]*>/gi, (tag) => (attrOf(tag, 'name') === LIVING_PAGE_MARK_NAME ? tag.replace(/hash=[0-9a-f]{64}/, `hash=${ZERO_HASH}`) : tag));
};

// ---- the allowlist ----

const ELEMENTS: ReadonlySet<string> = new Set([
  'html', 'head', 'body', 'meta', 'title', 'style', 'header', 'main', 'nav', 'section', 'article', 'aside', 'footer',
  'h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'div', 'span', 'table', 'thead', 'tbody', 'tr',
  'th', 'td', 'caption', 'figure', 'figcaption', 'img', 'code', 'small', 'strong', 'em', 'hr', 'br',
]);

const GLOBAL_ATTRS: ReadonlySet<string> = new Set(['class', 'id', 'lang', 'dir', 'role', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden']);

const ELEMENT_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'width', 'height']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  td: new Set(['colspan', 'rowspan', 'scope']),
};

const HREF = /^#[A-Za-z][A-Za-z0-9_-]{0,80}$/;
const IMG_SRC = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const DIGITS = /^\d{1,6}$/;
/** An attribute exactly as the generator writes it: a lower-case name, `=`, a double-quoted value. */
const ATTR_RAW = /^[a-z][a-z0-9-]*="[^"]*"$/;

const CSS_URL = /^url\("data:(?:font\/(?:woff2|woff|ttf|otf)|image\/(?:png|jpeg|gif|webp|svg\+xml));base64,[A-Za-z0-9+/]+={0,2}"\)/;
const CSS_FORBIDDEN: readonly { needle: string; reason: string }[] = [
  { needle: '@import', reason: 'CSS with @import' },
  { needle: '@charset', reason: 'CSS with @charset' },
  { needle: '@namespace', reason: 'CSS with @namespace' },
  { needle: 'expression(', reason: 'CSS with expression()' },
  { needle: 'behavior', reason: 'CSS with behavior' },
  { needle: '-moz-binding', reason: 'CSS with -moz-binding' },
  { needle: 'javascript:', reason: 'CSS with javascript:' },
  // Not on the spec's list, but a CSS function that loads a picture from a plain string.
  { needle: 'image-set(', reason: 'CSS with image-set()' },
];

/**
 * Why a piece of CSS is not one the living page may carry ([] when it may). The generator runs this
 * over each declaration it writes and leaves out any that fails, so a generated page always passes.
 */
export const livingCssProblems = (css: string): string[] => {
  const out: string[] = [];
  if (css.includes('<')) out.push('CSS with <');
  if (css.includes('\\')) out.push('CSS with an escape');
  const lower = css.toLowerCase();
  for (const { needle, reason } of CSS_FORBIDDEN) if (lower.includes(needle)) out.push(reason);
  let from = 0;
  for (;;) {
    const at = lower.indexOf('url(', from);
    if (at === -1) break;
    if (!CSS_URL.test(css.slice(at))) {
      out.push('CSS with a url() that is not an embedded font or picture');
      break;
    }
    from = at + 4;
  }
  return out;
};

const isMetaAllowed = (attrs: Map<string, string>): boolean => {
  const keys = [...attrs.keys()].sort().join(',');
  if (keys === 'charset') return attrs.get('charset') === 'utf-8';
  if (keys !== 'content,name') return false;
  const name = attrs.get('name');
  const content = attrs.get('content') ?? '';
  if (name === 'viewport') return content === LIVING_VIEWPORT;
  return name === LIVING_PAGE_MARK_NAME && parseMarkContent(content) !== null;
};

/** The reasons one start tag carries ([] when it is on the lists). */
const tagReasons = (tag: Tag): string[] => {
  const out: string[] = [];
  const name = tag.lower;
  if (!/^[a-z][a-z0-9]*$/.test(tag.name) || !ELEMENTS.has(name)) return [`a <${name.slice(0, 40)}> element`];
  const values = new Map<string, string>();
  for (const attr of tag.attrs) {
    if (attr.name.startsWith('on')) {
      out.push(`an event attribute (${attr.name.slice(0, 40)})`);
      continue;
    }
    if (!ATTR_RAW.test(attr.raw) || attr.value === null) {
      out.push(`an attribute that isn't double-quoted (${attr.name.slice(0, 40)})`);
      continue;
    }
    if (values.has(attr.name)) {
      out.push(`a repeated attribute (${attr.name})`);
      continue;
    }
    values.set(attr.name, attr.value);
    if (name === 'meta') continue; // checked as a whole below
    if (attr.name === 'style') {
      out.push('a style attribute');
      continue;
    }
    if (!GLOBAL_ATTRS.has(attr.name) && !(ELEMENT_ATTRS[name]?.has(attr.name) ?? false)) {
      out.push(`a ${attr.name} attribute on <${name}>`);
      continue;
    }
    if (name === 'a' && attr.name === 'href' && !HREF.test(attr.value)) out.push('a link that leaves the page');
    if (name === 'img' && attr.name === 'src' && !IMG_SRC.test(attr.value)) out.push('a picture that is not embedded');
    if (name === 'img' && (attr.name === 'width' || attr.name === 'height') && !DIGITS.test(attr.value)) out.push(`an img ${attr.name} that is not a number`);
  }
  if (name === 'meta' && out.length === 0 && !isMetaAllowed(values)) out.push('a <meta> Design Chamber does not write');
  return out;
};

/**
 * Safe only when every construct is on the lists of §5.11 (rev 3). `reasons` (≤ 10) say what was
 * found; `mark` is the page's mark when it has one.
 */
export const scanLivingPage = (text: string): LivingPageScan => {
  if (text.length > LIVING_PAGE_SCAN_MAX_BYTES || Buffer.byteLength(text, 'utf8') > LIVING_PAGE_SCAN_MAX_BYTES) {
    return { safe: false, reasons: [LIVING_PAGE_TOO_LARGE_REASON], mark: null };
  }
  const reasons: string[] = [];
  const add = (reason: string): void => {
    if (reasons.length < REASONS_MAX && !reasons.includes(reason)) reasons.push(reason);
  };

  let i = text.startsWith('\uFEFF') ? 1 : 0;
  const doctype = /^<!doctype html>/i.exec(text.slice(i, i + 15));
  if (doctype === null) add('no <!doctype html> at the start');
  else i += doctype[0].length;

  const counts = { html: 0, head: 0, body: 0, style: 0 };
  let inHead = false;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    const next = text[lt + 1] ?? '';
    if (next === '!') {
      add(text.startsWith('<!--', lt) ? 'a comment' : text.slice(lt, lt + 9).toUpperCase() === '<![CDATA[' ? 'a CDATA section' : 'a <! declaration');
      const close = text.indexOf('>', lt + 2);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (next === '?') {
      add('a processing instruction');
      const close = text.indexOf('>', lt + 2);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (next === '/') {
      // An end tag exactly as the generator writes it; anything else after `</` a browser may read as a comment.
      const end = /^<\/([a-z][a-z0-9]*)>/.exec(text.slice(lt, lt + 16));
      if (end === null || end[1] === undefined) {
        add('a malformed end tag');
        i = lt + 2;
        continue;
      }
      if (!ELEMENTS.has(end[1])) add(`a <${end[1]}> element`);
      if (end[1] === 'head') inHead = false;
      i = lt + end[0].length;
      continue;
    }
    if (!/[A-Za-z]/.test(next)) {
      i = lt + 1; // a `<` in text: text, never a reason
      continue;
    }
    const tag = parseTagAt(text, lt);
    if (tag === null) {
      i = lt + 1;
      continue;
    }
    if (tag.end >= text.length && !text.endsWith('>')) add('an unfinished tag');
    for (const reason of tagReasons(tag)) add(reason);
    const name = tag.lower;
    if (name === 'html' || name === 'head' || name === 'body') counts[name] += 1;
    if (name === 'head') inHead = true;
    if (name === 'body') inHead = false;
    i = tag.end;
    if (name === 'style' || name === 'title' || name === 'script' || name === 'textarea') {
      // Raw text: read to the first end tag a browser honours.
      const end = findRawTextEnd(text, tag.end, name);
      const content = text.slice(tag.end, end);
      if (name === 'style') {
        counts.style += 1;
        if (!inHead) add('a <style> outside <head>');
        for (const reason of livingCssProblems(content)) add(reason);
      }
      if (name === 'title' && content.includes('<')) add('a title with <');
      const close = /^<\/[a-z]+>/i.exec(text.slice(end, end + 16));
      if (end < text.length && (close === null || close[0].toLowerCase() !== `</${name}>`)) add('a malformed end tag');
      i = end + (close?.[0].length ?? 0);
    }
  }
  if (counts.html !== 1) add('not exactly one <html>');
  if (counts.head !== 1) add('not exactly one <head>');
  if (counts.body !== 1) add('not exactly one <body>');
  if (counts.style !== 1) add('not exactly one <style>');
  return { safe: reasons.length === 0, reasons, mark: readLivingPageMark(text) };
};
