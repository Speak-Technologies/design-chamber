// The bundler's tolerant HTML tag tokenizer (docs/SPEC.md §4.1), moved out of `bundle.ts` so the
// living page's allowlist scan (documentation/specs/phase-2-5-technical.md §5.11) reads tags the
// same way. No behaviour change from the bundler's copy; the bundler tests are the guard. Pure.

export type Attr = { name: string; value: string | null; raw: string; replaced?: string };
export type Tag = { name: string; lower: string; attrs: Attr[]; end: number; selfClosing: boolean };

export const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'title', 'textarea']);
export const WS: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r', '\f']);

export const parseTagAt = (text: string, lt: number): Tag | null => {
  const nameMatch = /^[A-Za-z][^\s/>]*/.exec(text.slice(lt + 1, lt + 128));
  if (!nameMatch) return null;
  const name = nameMatch[0];
  const attrs: Attr[] = [];
  let i = lt + 1 + name.length;
  let selfClosing = false;
  for (;;) {
    while (i < text.length && WS.has(text[i] ?? '')) i += 1;
    const c = text[i];
    if (c === undefined) {
      // Unterminated tag at EOF: the rest of the file is the tag (tolerant, like a browser).
      return { name, lower: name.toLowerCase(), attrs, end: text.length, selfClosing: false };
    }
    if (c === '>') {
      i += 1;
      break;
    }
    if (c === '/' && text[i + 1] === '>') {
      selfClosing = true;
      i += 2;
      break;
    }
    if (c === '/') {
      // Stray slash inside a tag (`<div / >`): skip it.
      i += 1;
      continue;
    }
    const attrStart = i;
    while (i < text.length && !WS.has(text[i] ?? '') && text[i] !== '=' && text[i] !== '>' && !(text[i] === '/' && text[i + 1] === '>')) i += 1;
    const attrName = text.slice(attrStart, i);
    if (attrName === '') {
      // Guarantees termination: always make progress.
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && WS.has(text[j] ?? '')) j += 1;
    let value: string | null = null;
    if (text[j] === '=') {
      j += 1;
      while (j < text.length && WS.has(text[j] ?? '')) j += 1;
      const quote = text[j];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, j + 1);
        value = text.slice(j + 1, close === -1 ? text.length : close);
        i = close === -1 ? text.length : close + 1;
      } else {
        const valueStart = j;
        while (j < text.length && !WS.has(text[j] ?? '') && text[j] !== '>') j += 1;
        value = text.slice(valueStart, j);
        i = j;
      }
    } else {
      i = attrStart + attrName.length;
    }
    attrs.push({ name: attrName.toLowerCase(), value, raw: text.slice(attrStart, i) });
  }
  return { name, lower: name.toLowerCase(), attrs, end: i, selfClosing };
};

/** End of a raw-text element's content: the first `</name` a browser would honour. */
export const findRawTextEnd = (text: string, from: number, tag: string): number => {
  const re = new RegExp(`</${tag}(?=[\\s>/]|$)`, 'gi');
  re.lastIndex = from;
  const match = re.exec(text);
  return match ? match.index : text.length;
};
