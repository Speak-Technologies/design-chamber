// FROZEN COPY of src/service/systems/markdown-html.ts at commit d7453ba (pre-refactor renderer),
// kept only as the reference for the differential output guard in markdown-html.test.ts. Do not
// edit, do not import from production code. The living-safe import is inlined so the fixture is
// self-contained; everything else is byte-identical to d7453ba.

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
//   h3-h6, del, ol start, links that leave the page with rel/target);
// - `living` is served outside OpenChamber and must pass `scanLivingPage` (living-safe.ts): only
//   elements and attributes on that allowlist, so code blocks are a pre-wrap div, quotes a div,
//   strikethrough a span, headings stop at h4, ordered lists lose their start number, and a link
//   that leaves the page is shown as its text and address.
//
// Headings enter the document outline under the section's h2: markdown `#` becomes h3, `##` h4,
// and so on (the living page caps at h4). Nesting (quotes, lists, emphasis) is depth-capped so a
// hostile file cannot exhaust the stack; past the cap the stretch is shown as escaped text.
//
// Time is linear in the source: every delimiter lookup goes through a table built in one pass
// (`nextOf`, `stopUrlOf`, `ticksOf`), never a regex that rescans to the end of the text from each
// opener, and the block grammar's regexes are anchored without nested quantifiers over the same
// characters. A 20 000-character note of unclosed brackets or a heading line of 4 000 spaces
// renders in milliseconds, so one hostile file cannot freeze the service's main thread.
// Pure: no service imports, so the CLI check can bundle it.

const LIVING_HREF = /^#[A-Za-z][A-Za-z0-9_-]{0,80}$/;

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

// ---- linear-time lookup tables ----

/** Next position at or after `i` where `needle` starts, else -1: one backward pass, O(1) lookups. */
const nextOf = (text: string, needle: string): Int32Array => {
  const table = new Int32Array(text.length + 1);
  table[text.length] = -1;
  for (let i = text.length - 1; i >= 0; i -= 1) table[i] = text.startsWith(needle, i) ? i : (table[i + 1] ?? -1);
  return table;
};

const isSpaceTab = (ch: string): boolean => ch === ' ' || ch === '\t';

/** Next position at or after `i` that ends a link URL (whitespace or `)`), else the length. */
const stopUrlOf = (text: string): Int32Array => {
  const table = new Int32Array(text.length + 1);
  table[text.length] = text.length;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text[i] ?? '';
    table[i] = ch === ')' || /\s/.test(ch) ? i : (table[i + 1] ?? text.length);
  }
  return table;
};

/** Next position at or after `i` that is not a space or tab, else the length. */
const skipSpaceTabOf = (text: string): Int32Array => {
  const table = new Int32Array(text.length + 1);
  table[text.length] = text.length;
  for (let i = text.length - 1; i >= 0; i -= 1) table[i] = isSpaceTab(text[i] ?? '') ? (table[i + 1] ?? text.length) : i;
  return table;
};

/** Backtick runs: `nextRun[i]` the next run start at or after i, `runLen[start]` its length. */
const ticksOf = (text: string): { nextRun: Int32Array; runLen: Int32Array } => {
  const n = text.length;
  const nextRun = new Int32Array(n + 1);
  const runLen = new Int32Array(n + 1);
  nextRun[n] = -1;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (text[i] === '`' && (i === 0 || text[i - 1] !== '`')) {
      let len = 0;
      while (i + len < n && text[i + len] === '`') len += 1;
      runLen[i] = len;
      nextRun[i] = i;
    } else {
      nextRun[i] = nextRun[i + 1] ?? -1;
    }
  }
  return { nextRun, runLen };
};

// ---- the block grammar ----

/** Nesting cap for quotes, lists and emphasis: past it a stretch is escaped text, never a deeper parse. */
const MAX_DEPTH = 6;

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// Greedy rest, no trailing quantifiers over the same characters: a long space run cannot backtrack.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const SEP_CELL = /^:?-+:?$/;
/** Past this many columns a table is shown as text: cells are rows × columns, so width must be bounded. */
const TABLE_COLUMNS_MAX = 64;
const EMPHASIS_END = /[A-Za-z0-9_]/;

/** Trailing spaces and tabs off, by plain loop: a regex with a trailing quantifier races long runs. */
const trimSpaceTab = (text: string): string => {
  let end = text.length;
  while (end > 0 && isSpaceTab(text[end - 1] ?? '')) end -= 1;
  return end === text.length ? text : text.slice(0, end);
};

const indentOf = (line: string): number => {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
};

/** A heading's text without its closing #s and trailing whitespace, by plain loop (never a regex race). */
const headingText = (raw: string): string => {
  const text = trimSpaceTab(raw);
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  if (end === text.length) return text;
  if (end === 0) return '';
  if (isSpaceTab(text[end - 1] ?? '')) return trimSpaceTab(text.slice(0, end));
  return text;
};

/** A horizontal rule: three or more of one of - * _ , spaces and tabs between, at most three leading spaces. */
const isHorizontalRule = (line: string): boolean => {
  if (indentOf(line) > 3) return false;
  const text = line.trim();
  const ch = text[0];
  if (ch !== '-' && ch !== '*' && ch !== '_') return false;
  let count = 0;
  for (const c of text) {
    if (c === ch) count += 1;
    else if (!isSpaceTab(c)) return false;
  }
  return count >= 3;
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

const BACKSLASH_PUNCT = /[\\`*_{}[\]()#+\-.!|>~"']/;

/**
 * Inline markdown as escaped HTML: code spans (literal inside), links, strong, em, strikethrough,
 * backslash escapes; everything else is text. Every delimiter is found through a lookup table, so
 * a failed scan costs O(1) and never rescans the rest of the text. `depth` caps nesting. A link the
 * profile or the URL allowlist refuses stays visible as the words and address the agent wrote, inert.
 */
const inline = (text: string, profile: MarkdownProfile, depth: number): string => {
  if (depth > MAX_DEPTH) return escapeHtml(text);
  const n = text.length;
  const bracket = nextOf(text, ']');
  const stopUrl = stopUrlOf(text);
  const skipWs = skipSpaceTabOf(text);
  const quote = nextOf(text, '"');
  const newline = nextOf(text, '\n');
  const doubleStar = nextOf(text, '**');
  const doubleUnder = nextOf(text, '__');
  const tripleStar = nextOf(text, '***');
  const tripleUnder = nextOf(text, '___');
  const singleStar = nextOf(text, '*');
  const singleUnder = nextOf(text, '_');
  const strike = nextOf(text, '~~');
  const { nextRun, runLen } = ticksOf(text);
  // Per opener length, how far the search for a closing backtick run has already got: monotonic,
  // because openers are visited left to right, so a run ruled out once is never re-examined.
  const tickCursor = new Map<number, number>();

  /** The link starting at `open` ('['): its url, label end and whole end, or null. All O(1). */
  const linkAt = (open: number): { url: string; labelEnd: number; end: number } | null => {
    const j = bracket[open + 1] ?? -1;
    if (j === -1 || text[j + 1] !== '(') return null;
    const u = j + 2;
    const e = stopUrl[u] ?? n;
    if (e === n) return null;
    if (text[e] === ')') return { url: text.slice(u, e), labelEnd: j, end: e + 1 };
    const q = skipWs[e] ?? n;
    if (text[q] !== '"') return null;
    const c = quote[q + 1] ?? -1;
    const nl = newline[q + 1] ?? -1;
    if (c === -1 || (nl !== -1 && nl < c) || text[c + 1] !== ')') return null;
    return { url: text.slice(u, e), labelEnd: j, end: c + 2 };
  };

  let out = '';
  let plain = '';
  const flush = (): void => {
    if (plain !== '') {
      out += escapeHtml(plain);
      plain = '';
    }
  };
  let i = 0;
  while (i < n) {
    const ch = text[i] ?? '';
    if (ch === '\\' && BACKSLASH_PUNCT.test(text[i + 1] ?? '')) {
      plain += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === '`' && (runLen[i] ?? 0) > 0) {
      const len = runLen[i] ?? 0;
      let p = nextRun[Math.max(i + len, tickCursor.get(len) ?? 0)] ?? -1;
      while (p !== -1 && (runLen[p] ?? 0) !== len) p = nextRun[p + (runLen[p] ?? 0)] ?? -1;
      if (p !== -1) {
        tickCursor.set(len, p + (runLen[p] ?? 0));
        flush();
        out += `<code class="dc-md-code">${escapeHtml(text.slice(i + len, p).replace(/\n/g, ' '))}</code>`;
        i = p + len;
        continue;
      }
      tickCursor.set(len, n);
    }
    if (ch === '!' && text[i + 1] === '[') {
      const m = linkAt(i + 1);
      if (m !== null) {
        // Images are never drawn: the whole span stays visible as written text.
        plain += text.slice(i, m.end);
        i = m.end;
        continue;
      }
    }
    if (ch === '[') {
      const m = linkAt(i);
      if (m !== null) {
        const url = markdownLinkUrl(m.url);
        const label = inline(text.slice(i + 1, m.labelEnd), profile, depth + 1);
        flush();
        if (url !== null && (profile === 'board' || LIVING_HREF.test(url))) {
          out +=
            profile === 'board'
              ? `<a class="dc-md-link" href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${label}</a>`
              : `<a class="dc-md-link" href="${escapeHtml(url)}">${label}</a>`;
        } else {
          // Not a link this document may carry: the words and the address, as text.
          out += url === null ? escapeHtml(text.slice(i, m.end)) : `${label}${escapeHtml(` (${m.url})`)}`;
        }
        i = m.end;
        continue;
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const flanked = (end: number): boolean => !EMPHASIS_END.test(text[i - 1] ?? '') && !EMPHASIS_END.test(text[end] ?? '');
      const take = (table: Int32Array, marker: string, wrap: (inner: string) => string, single: boolean): boolean => {
        const p = table[i + marker.length] ?? -1;
        if (p === -1 || p === i + marker.length) return false;
        if (single && (newline[i + 1] ?? -1) !== -1 && (newline[i + 1] ?? -1) < p) return false;
        if (ch === '_' && !flanked(p + marker.length)) return false;
        flush();
        out += wrap(inline(text.slice(i + marker.length, p), profile, depth + 1));
        i = p + marker.length;
        return true;
      };
      if (ch === '~') {
        if (take(strike, '~~', (s) => (profile === 'board' ? `<del class="dc-md-del">${s}</del>` : `<span class="dc-md-del">${s}</span>`), false)) continue;
      } else if (ch === '*') {
        if (take(tripleStar, '***', (s) => `<strong><em>${s}</em></strong>`, false)) continue;
        if (take(doubleStar, '**', (s) => `<strong>${s}</strong>`, false)) continue;
        if (take(singleStar, '*', (s) => `<em>${s}</em>`, true)) continue;
      } else {
        if (take(tripleUnder, '___', (s) => `<strong><em>${s}</em></strong>`, false)) continue;
        if (take(doubleUnder, '__', (s) => `<strong>${s}</strong>`, false)) continue;
        if (take(singleUnder, '_', (s) => `<em>${s}</em>`, true)) continue;
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
  const marker = first[2] ?? '';
  const ordered = /^\d/.test(marker);
  const tag = ordered ? 'ol' : 'ul';
  // The first number is the list's start; the living page's allowlist has no start attribute.
  const from = ordered ? Number(marker.replace(/[.)]$/, '')) : 1;
  const startAttr = ordered && from !== 1 && profile === 'board' ? ` start="${from}"` : '';
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
  return { html: `<${tag} class="dc-md-list"${startAttr}>${items.join('')}</${tag}>`, next: i };
};

/** The block grammar over whole lines: fences, headings, rules, quotes, lists, tables, paragraphs. */
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
      out.push(`<${tag} class="dc-md-${tag}">${inline(headingText(heading[2] ?? ''), profile, depth)}</${tag}>`);
      i += 1;
      continue;
    }
    if (isHorizontalRule(line)) {
      out.push('<hr class="dc-md-hr">');
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
      if (header.length === sep.length && header.length <= TABLE_COLUMNS_MAX) {
        i += 2;
        const rowLines: string[] = [];
        while (i < lines.length && (lines[i] ?? '').trim() !== '' && (lines[i] ?? '').includes('|')) {
          rowLines.push(lines[i] ?? '');
          i += 1;
        }
        // Every row emits one cell per header column, so a wide header over bare "|" rows would
        // multiply the source into gigabytes. The cells a table may emit are bounded by the
        // characters it was written from; rows past that budget stay visible as a text paragraph.
        const budget = line.length + next.length + rowLines.reduce((total, row) => total + row.length, 0);
        const maxRows = Math.max(1, Math.floor(budget / header.length));
        const rows = rowLines.slice(0, maxRows).map((row) => {
          const cells = cellsOf(row);
          return header.map((_, column) => inline(cells[column] ?? '', profile, depth));
        });
        out.push(tableBlock(header.map((cell) => inline(cell, profile, depth)), rows));
        const rest = rowLines.slice(maxRows);
        if (rest.length > 0) out.push(`<p>${inline(rest.join('\n').trim(), profile, depth)}</p>`);
        continue;
      }
    }
    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || FENCE.test(cur) || HEADING.test(cur) || isHorizontalRule(cur) || QUOTE.test(cur) || ITEM.test(cur)) break;
      paragraph.push(cur);
      i += 1;
    }
    out.push(`<p>${inline(paragraph.join('\n').trim(), profile, depth)}</p>`);
  }
  return out.join('');
};

/** Source lines with CR normalised and leading tabs expanded, the one place both happen. */
const sourceLines = (source: string): string[] =>
  source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length)));

/**
 * Agent-written markdown as HTML for one of the two system documents. Every text stretch is
 * escaped; the markup is only the vocabulary above. Empty source answers '' (the caller shows its
 * own empty line). Leading tabs become four spaces so indent reads the same everywhere; a code
 * fence keeps them as spaces too.
 */
export const renderMarkdown = (source: string, profile: MarkdownProfile = 'board'): string => blocks(sourceLines(source), profile, 0);

/**
 * A note body that opens with its own title as a heading (the service derives the title from that
 * heading) shows the title once: the card's label, not twice. Only an exact, leading heading match
 * is dropped; anything else is left as written.
 */
export const withoutLeadingTitle = (source: string, title: string): string => {
  const lines = sourceLines(source);
  let i = 0;
  while (i < lines.length && (lines[i] ?? '').trim() === '') i += 1;
  const heading = HEADING.exec(lines[i] ?? '');
  if (heading === null || headingText(heading[2] ?? '') !== title.trim()) return source;
  return lines.slice(i + 1).join('\n');
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
.dc-md-hr { margin: 16px 0; border: 0; border-top: 1px solid ${border}; }
.dc-md-del { text-decoration: line-through; }
.dc-md-tablewrap { margin: 8px 0; overflow-x: auto; }
.dc-md-table { border-collapse: collapse; font-size: 13px; }
.dc-md-table th, .dc-md-table td { padding: 4px 8px; border: 1px solid ${border}; text-align: left; vertical-align: top; }
.dc-md-table th { background: ${card}; font-weight: 600; }
.dc-md-link { color: ${profile === 'living' ? g.fg : 'inherit'}; text-decoration: underline; }
.dc-body p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
`;
};