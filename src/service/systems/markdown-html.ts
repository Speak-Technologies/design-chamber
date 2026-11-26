// Markdown rendering for the system documents (the specimen board and the living page): a small
// pure renderer over the agent-written notes (OVERVIEW.md, notes/*.md, patterns/*.md, brand/*.md).
// Untrusted content's view, the same stance as `specimen-html.ts`: every stretch of system text is
// HTML-escaped before it enters the document, and the only markup is the generator's own, from a
// fixed vocabulary. Raw HTML in the source is shown as text, never passed through; a link carries
// only a URL `markdownLinkUrl` accepts (http, https, mailto, or a relative path), escaped as an
// attribute; images are never drawn (they would load from somewhere the document cannot check).
//
// Two profiles, because the two documents have different contracts:
// - `board` runs in the sandboxed artboard frame and gets the full vocabulary (pre, blockquote,
//   h3-h6, links that leave the page with rel/target);
// - `living` is served outside OpenChamber and must pass `scanLivingPage` (living-safe.ts): only
//   elements and attributes on that allowlist, so code blocks are a pre-wrap div, quotes a div,
//   headings stop at h4, and a link that leaves the page is shown as its text and address.
//
// Headings enter the document outline under the section's h2: markdown `#` becomes h3, `##` h4,
// and so on (the living page caps at h4). Nesting (quotes, lists, emphasis) is depth-capped so a
// hostile file cannot exhaust the stack; past the cap the stretch is shown as escaped text.
// Pure: no service imports, so the CLI check can bundle it.

import { LIVING_HREF } from './living-safe.ts';

export type MarkdownProfile = 'board' | 'living';

// ---- escaping ----

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text and attribute values: the five HTML specials. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

// ---- links ----

/** Control characters and spaces: a scheme split by them (`java\tscript:`) is not a URL we keep. */
const hasControl = (url: string): boolean => {
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
};

const SCHEME = /^([a-z][a-z0-9+.-]*):/;

/**
 * The URL a markdown link may carry, or null when it must not: http, https, mailto, or a relative
 * path (no scheme, not protocol-relative, no backslash, no control character or space). A refused
 * URL is shown as written text, never as a link. The value still goes through `escapeHtml` as an
 * attribute, so an entity or a quote in it cannot leave the attribute either.
 */
export const markdownLinkUrl = (raw: string): string | null => {
  const url = raw.trim();
  if (url === '' || hasControl(url) || url.includes('\\')) return null;
  const scheme = SCHEME.exec(url.toLowerCase())?.[1];
  if (scheme !== undefined) return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? url : null;
  if (url.startsWith('//')) return null;
  return url;
};

// ---- the block grammar ----

/** Nesting cap for quotes, lists and emphasis: past it a stretch is escaped text, never a deeper parse. */
const MAX_DEPTH = 6;

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const SEP_CELL = /^:?-+:?$/;
const EMPHASIS_END = /[A-Za-z0-9_]/;

const indentOf = (line: string): number => {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
};

/** A table row's cells: boundary pipes dropped, escaped pipes kept as pipes. */
const cellsOf = (line: string): string[] => {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
};

const isSeparator = (line: string): boolean => {
  if (!line.includes('|') || !line.includes('-')) return false;
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => SEP_CELL.test(cell));
};

/** The heading tag for a markdown level: under the section's h2, capped per profile. */
const headingTag = (level: number, profile: MarkdownProfile): string => `h${Math.min(level + 2, profile === 'board' ? 6 : 4)}`;

const codeBlock = (content: string, profile: MarkdownProfile): string =>
  profile === 'board'
    ? `<pre class="dc-md-pre"><code>${escapeHtml(content)}</code></pre>`
    : `<div class="dc-md-pre"><code>${escapeHtml(content)}</code></div>`;

const quoteBlock = (inner: string, profile: MarkdownProfile): string =>
  profile === 'board' ? `<blockquote class="dc-md-quote">${inner}</blockquote>` : `<div class="dc-md-quote">${inner}</div>`;

const tableBlock = (header: readonly string[], rows: readonly (readonly string[])[]): string => {
  const head = `<thead><tr>${header.map((cell) => `<th scope="col">${cell}</th>`).join('')}</tr></thead>`;
  const body = rows.length > 0 ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>` : '';
  return `<div class="dc-md-tablewrap"><table class="dc-md-table">${head}${body}</table></div>`;
};

// ---- inline ----

const CODE_SPAN = /^(`+)([\s\S]*?)\1(?!`)/;
const IMAGE = /^!\[[^\]]*\]\([^\s)]*(?:[ \t]+"[^"\n]*")?\)/;
const LINK = /^\[([^\]]*)\]\(([^\s)]*)(?:[ \t]+"[^"\n]*")?\)/;
const TRIPLE = /^(\*\*\*|___)([\s\S]+?)\1/;
const DOUBLE = /^(\*\*|__)([\s\S]+?)\1/;
const SINGLE_STAR = /^\*([^*\n]+?)\*/;
const SINGLE_UNDER = /^_([^_\n]+?)_/;
const BACKSLASH_PUNCT = /[\\`*_{}[\]()#+\-.!|>~"']/;

/**
 * Inline markdown as escaped HTML: code spans (literal inside), links, strong, em, backslash
 * escapes; everything else is text. `depth` caps nesting. A link the profile or the URL allowlist
 * refuses stays visible as the words and address the agent wrote, inert.
 */
const inline = (text: string, profile: MarkdownProfile, depth: number): string => {
  if (depth > MAX_DEPTH) return escapeHtml(text);
  let out = '';
  let plain = '';
  const flush = (): void => {
    if (plain !== '') {
      out += escapeHtml(plain);
      plain = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i] ?? '';
    if (ch === '\\' && BACKSLASH_PUNCT.test(text[i + 1] ?? '')) {
      plain += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === '`') {
      const m = CODE_SPAN.exec(rest);
      if (m !== null && m[2] !== undefined) {
        flush();
        out += `<code class="dc-md-code">${escapeHtml(m[2].replace(/\n/g, ' '))}</code>`;
        i += m[0].length;
        continue;
      }
    }
    if (ch === '!') {
      const m = IMAGE.exec(rest);
      if (m !== null) {
        plain += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === '[') {
      const m = LINK.exec(rest);
      if (m !== null && m[1] !== undefined && m[2] !== undefined) {
        const url = markdownLinkUrl(m[2]);
        const label = inline(m[1], profile, depth + 1);
        if (url !== null && (profile === 'board' || LIVING_HREF.test(url))) {
          flush();
          out += profile === 'board' ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${label}</a>` : `<a href="${escapeHtml(url)}">${label}</a>`;
        } else {
          // Not a link this document may carry: the words and the address, as text.
          flush();
          out += url === null ? escapeHtml(m[0]) : `${label}${escapeHtml(` (${m[2]})`)}`;
        }
        i += m[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const boundaryOk = (end: number): boolean =>
        ch === '*' || (!EMPHASIS_END.test(text[i - 1] ?? '') && !EMPHASIS_END.test(text[end] ?? ''));
      const triple = TRIPLE.exec(rest);
      if (triple !== null && triple[2] !== undefined && boundaryOk(i + triple[0].length)) {
        flush();
        out += `<strong><em>${inline(triple[2], profile, depth + 1)}</em></strong>`;
        i += triple[0].length;
        continue;
      }
      const double = DOUBLE.exec(rest);
      if (double !== null && double[2] !== undefined && boundaryOk(i + double[0].length)) {
        flush();
        out += `<strong>${inline(double[2], profile, depth + 1)}</strong>`;
        i += double[0].length;
        continue;
      }
      const single = ch === '*' ? SINGLE_STAR.exec(rest) : SINGLE_UNDER.exec(rest);
      if (single !== null && single[1] !== undefined && boundaryOk(i + single[0].length)) {
        flush();
        out += `<em>${inline(single[1], profile, depth + 1)}</em>`;
        i += single[0].length;
        continue;
      }
    }
    plain += ch;
    i += 1;
  }
  flush();
  return out;
};

// ---- blocks ----

/** One list run at one indent: items with their continuation and nested blocks, dedented. */
const listRun = (lines: readonly string[], start: number, profile: MarkdownProfile, depth: number): { html: string; next: number } => {
  const first = ITEM.exec(lines[start] ?? '');
  // The caller only enters on a list item line.
  if (first === null) return { html: '', next: start + 1 };
  const base = (first[1] ?? '').length;
  const ordered = /^\d/.test(first[2] ?? '');
  const tag = ordered ? 'ol' : 'ul';
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i] ?? '');
    if (m === null || (m[1] ?? '').length !== base) break;
    const contentIndent = (m[1] ?? '').length + (m[2] ?? '').length + (m[3] ?? '').length;
    const li: string[] = [m[4] ?? ''];
    i += 1;
    for (;;) {
      const cur = lines[i];
      if (cur === undefined) break;
      if (cur.trim() === '') {
        let j = i;
        while (j < lines.length && (lines[j] ?? '').trim() === '') j += 1;
        const after = lines[j];
        if (after !== undefined && indentOf(after) > base) {
          li.push('');
          i = j;
          continue;
        }
        break;
      }
      const nm = ITEM.exec(cur);
      if (nm !== null && (nm[1] ?? '').length <= base) break;
      if (indentOf(cur) > base) {
        li.push(cur.slice(Math.min(contentIndent, indentOf(cur))));
        i += 1;
        continue;
      }
      break;
    }
    items.push(`<li>${blocks(li, profile, depth + 1)}</li>`);
  }
  return { html: `<${tag} class="dc-md-list">${items.join('')}</${tag}>`, next: i };
};

/** The block grammar over whole lines: fences, headings, quotes, lists, tables, paragraphs. */
const blocks = (lines: readonly string[], profile: MarkdownProfile, depth: number): string => {
  if (depth > MAX_DEPTH) return `<p>${escapeHtml(lines.join('\n').trim())}</p>`;
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? '```';
      const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
      const content: string[] = [];
      i += 1;
      while (i < lines.length && !close.test(lines[i] ?? '')) {
        content.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // the closing fence, or the end of the file
      out.push(codeBlock(content.join('\n'), profile));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const tag = headingTag(heading[1]?.length ?? 1, profile);
      out.push(`<${tag} class="dc-md-${tag}">${inline((heading[2] ?? '').trim(), profile, depth)}</${tag}>`);
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] ?? '');
        if (q === null) break;
        inner.push(q[1] ?? '');
        i += 1;
      }
      out.push(quoteBlock(blocks(inner, profile, depth + 1), profile));
      continue;
    }
    if (ITEM.test(line)) {
      const run = listRun(lines, i, profile, depth);
      out.push(run.html);
      i = run.next;
      continue;
    }
    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && isSeparator(next)) {
      const header = cellsOf(line);
      const sep = cellsOf(next);
      if (header.length === sep.length) {
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && (lines[i] ?? '').trim() !== '' && (lines[i] ?? '').includes('|')) {
          const cells = cellsOf(lines[i] ?? '');
          rows.push(header.map((_, column) => inline(cells[column] ?? '', profile, depth)));
          i += 1;
        }
        out.push(tableBlock(header.map((cell) => inline(cell, profile, depth)), rows));
        continue;
      }
    }
    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || FENCE.test(cur) || HEADING.test(cur) || QUOTE.test(cur) || ITEM.test(cur)) break;
      paragraph.push(cur);
      i += 1;
    }
    out.push(`<p>${inline(paragraph.join('\n').trim(), profile, depth)}</p>`);
  }
  return out.join('');
};

/**
 * Agent-written markdown as HTML for one of the two system documents. Every text stretch is
 * escaped; the markup is only the vocabulary above. Empty source answers '' (the caller shows its
 * own empty line). Leading tabs become four spaces so indent reads the same everywhere; a code
 * fence keeps them as spaces too.
 */
export const renderMarkdown = (source: string, profile: MarkdownProfile = 'board'): string => {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length)));
  return blocks(lines, profile, 0);
};

// ---- the CSS the two documents carry ----

/** The same fallback greys as the board chrome (board-html.ts); the living page's are fixed. */
const GREYS = {
  light: { card: '#ffffff', border: '#d8d8dc', muted: '#62626a', fg: '#1d1d1f' },
  dark: { card: '#1c1c20', border: '#34343a', muted: '#a0a0a8', fg: '#ececef' },
} as const;

/**
 * The markdown rules, scoped so they never restyle the document's own chrome: heading classes
 * outrank `.dc-section h3` (the card labels), and every other rule hangs off a `dc-md-` class the
 * generator alone writes. The living page's copy passes `livingCssProblems` (no url(), no escape).
 */
export const markdownCss = (profile: MarkdownProfile, scheme: 'light' | 'dark' = 'light'): string => {
  const g = profile === 'living' ? GREYS.light : GREYS[scheme];
  // The board follows the host theme through the chrome's variables; the living page's greys are fixed.
  const card = profile === 'living' ? g.card : `var(--dc-board-card, ${g.card})`;
  const border = profile === 'living' ? g.border : `var(--dc-board-border, ${g.border})`;
  const muted = profile === 'living' ? g.muted : `var(--dc-board-muted, ${g.muted})`;
  const sizes = profile === 'living' ? ['17px', '15px', '14px'] : ['16px', '14px', '13px'];
  const wrap = profile === 'living' ? 'pre-wrap' : 'pre';
  return `
.dc-section .dc-md-h3, .dc-section .dc-md-h4, .dc-section .dc-md-h5, .dc-section .dc-md-h6 { font-weight: 600; text-transform: none; letter-spacing: normal; color: inherit; }
.dc-section .dc-md-h3 { margin: 20px 0 8px; font-size: ${sizes[0] ?? '16px'}; }
.dc-section .dc-md-h4 { margin: 16px 0 6px; font-size: ${sizes[1] ?? '14px'}; }
.dc-section .dc-md-h5, .dc-section .dc-md-h6 { margin: 12px 0 4px; font-size: ${sizes[2] ?? '13px'}; }
.dc-section .dc-md-h3:first-child, .dc-section .dc-md-h4:first-child, .dc-section .dc-md-h5:first-child, .dc-section .dc-md-h6:first-child { margin-top: 0; }
.dc-md-code { font-family: ui-monospace, monospace; font-size: 0.9em; padding: 0 4px; border: 1px solid ${border}; border-radius: 4px; background: ${card}; }
.dc-md-pre { margin: 8px 0; padding: 8px 10px; border: 1px solid ${border}; border-radius: 6px; background: ${card}; font-size: 12px; line-height: 1.5; white-space: ${wrap}; overflow-x: auto; }
.dc-md-pre code { padding: 0; border: 0; background: none; font-size: inherit; }
.dc-md-quote { margin: 8px 0; padding: 2px 12px; border-left: 2px solid ${border}; color: ${muted}; }
.dc-md-quote > :first-child { margin-top: 0; }
.dc-md-quote > :last-child { margin-bottom: 0; }
.dc-md-list { margin: 8px 0; padding-left: 18px; }
.dc-md-list .dc-md-list { margin: 4px 0 0; }
.dc-md-list li + li { margin-top: 4px; }
.dc-md-list li > p { margin: 0; }
.dc-md-tablewrap { margin: 8px 0; overflow-x: auto; }
.dc-md-table { border-collapse: collapse; font-size: 13px; }
.dc-md-table th, .dc-md-table td { padding: 4px 8px; border: 1px solid ${border}; text-align: left; vertical-align: top; }
.dc-md-table th { background: ${card}; font-weight: 600; }
.dc-md a { color: ${profile === 'living' ? g.fg : 'inherit'}; text-decoration: underline; }
.dc-body p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
`;
};