// The section renderers of a design system (documentation/specs/phase-2-5-technical.md §5.7, §5.11,
// §2.11, AD-22), shared by the specimen board (`board-html.ts`) and the living page (`living-html.ts`),
// so both show the same values the same way. Pure: no service imports, so the CLI check can bundle it.
//
// Everything here is untrusted content's view: everything in it came from agent-written files. So:
// - every name, note, title, kind and value shown as text is HTML-escaped; overview, note, pattern
//   and brand bodies render as markdown (`markdown-html.ts`): escaped text in the generator's own
//   markup, never markup the agent wrote;
// - a value enters CSS only as a custom property declaration, after `validateTokenValue` passes again
//   (its alphabet has no `; { } < > \ : *` and no `url(`), so it can't leave its declaration or the
//   `<style>` element; a refused value is shown as text beside a hatched "can't read" swatch;
// - names enter CSS only after `SYSTEM_TOKEN_NAME_PATTERN`, ids only after `SYSTEM_ENTRY_ID_PATTERN`;
//   class names are ours, never the system's;
// - logos are only ever `<img src="assets/logos/…">` (the bundler makes a data: URL, and an SVG as an
//   image never runs script);
// - a component's example is not drawn here: the caller passes `example` (the board puts it in an inert
//   template, the living page a PNG), because that part depends on the board script.

import { SYSTEM_ENTRY_ID_PATTERN, SYSTEM_TOKEN_NAME_PATTERN } from '../../shared/limits.ts';
import { darkVarOf, entryKeyOf, isBoardEntryKey, typeVarOf, type BoardEntryKind } from '../../shared/system-board.ts';
import { AREA_OF_SECTION, effectiveLayout } from '../../shared/system-json.ts';
import { validateTokenValue, type TypeField } from '../../shared/token-edit.ts';
import type {
  BoardLayout,
  ColourGroup,
  FontAsset,
  LogoAsset,
  SystemArea,
  SystemComponent,
  SystemDetail,
  SystemEntryText,
  SystemSection,
  SystemToken,
  TokenSection,
  TypeStyle,
} from '../../shared/types.ts';
import { escapeHtml, renderMarkdown, withoutLeadingTitle, type MarkdownProfile } from './markdown-html.ts';

export { escapeHtml };

export type SpecimenOptions = {
  /** Font and logo files (`assets/…`) the service's `checkAsset` refused. */
  unusable?: ReadonlySet<string>;
  /**
   * The example part of a component card, called only for a component that names an example; `id` is
   * null when the component's id is off the pattern. Absent → no example part.
   */
  example?: (component: SystemComponent, id: string | null) => string;
  /**
   * The living page (§5.11) allows no `style` attribute: when given, each element's own declarations
   * go to this callback, which answers a class name the caller defines in its one `<style>`. Absent
   * (the board) → a `style` attribute, as before.
   */
  styleClass?: (declarations: string) => string;
  /** Which markdown vocabulary the bodies render in: the board's full one, or the living page's allowlist one. */
  markdown?: MarkdownProfile;
};

/** ` class="base" style="…"`, or ` class="base <generated>"` when the caller takes declarations as classes. */
type Styler = (base: string, declarations: string) => string;

const stylerOf = (options: SpecimenOptions): Styler => {
  const styleClass = options.styleClass;
  if (styleClass === undefined) return (base, declarations) => ` class="${base}" style="${escapeHtml(declarations)}"`;
  return (base, declarations) => (declarations === '' ? ` class="${base}"` : ` class="${base} ${styleClass(declarations)}"`);
};

/** The sentence an uncovered area's sections show (§2.11, S1). */
export const NOT_COVERED_SENTENCE = 'Not covered by this system.';

/** The four areas' headings (§2.11). */
export const AREA_TITLES: Readonly<Record<SystemArea, string>> = Object.freeze({
  foundations: 'Foundations',
  components: 'Components',
  patterns: 'Patterns & voice',
  brand: 'Brand & marketing',
});

// ---- escaping ----

// `escapeHtml` lives in `markdown-html.ts` (the renderer and the sections share one escape) and is
// re-exported above for the board and living page documents.

/** ` data-dc-entry="…"` for a valid key; nothing for a key off the pattern (it is then just not selectable). */
const entryAttr = (kind: BoardEntryKind, key: string): string => {
  const text = kind === 'overview' ? 'overview' : `${kind}:${key}`;
  return isBoardEntryKey(text) ? ` data-dc-entry="${escapeHtml(entryKeyOf(kind, key))}"` : '';
};

/** The value as it may enter CSS, or null when it must not (re-checked here, never trusted from the detail). */
const cssValueOf = (section: TokenSection, field: TypeField | null, text: string | undefined | null): string | null => {
  if (text === undefined || text === null || text === '') return null;
  return validateTokenValue(section, field, text).ok ? text : null;
};

const isTokenName = (name: string): boolean => SYSTEM_TOKEN_NAME_PATTERN.test(name);

// ---- layout runs (documentation/specs/system-board-layout-and-visual-check.md §A.3) ----

/** One run: consecutive entries sharing an effective layout, in the agent's order (D5: never reordered). */
type LayoutRun<T> = { layout: BoardLayout; items: T[] };

const runsOf = <T>(items: readonly T[], layoutOf: (item: T) => BoardLayout): LayoutRun<T>[] => {
  const runs: LayoutRun<T>[] = [];
  for (const item of items) {
    const layout = layoutOf(item);
    const last = runs.at(-1);
    if (last !== undefined && last.layout === layout) last.items.push(item);
    else runs.push({ layout, items: [item] });
  }
  return runs;
};

/** A table run: divs with ARIA roles, so the living page allowlist, hit-testing and the board script all work. */
const tableWrap = (label: string, inner: string): string => `<div class="dc-run-table" role="table" aria-label="${escapeHtml(label)}">${inner}</div>`;

const tableHeader = (cells: readonly string[]): string =>
  `<div class="dc-thead" role="row">${cells.map((cell) => `<div class="dc-tcell" role="columnheader">${escapeHtml(cell)}</div>`).join('')}</div>`;

const tableCell = (name: 'name' | 'preview' | 'notes', inner: string): string => `<div class="dc-tcell dc-tcell-${name}" role="cell">${inner}</div>`;

/** A file name inside one contract folder, as a URL path the bundler decodes back. */
const assetUrl = (rel: string): string | null => {
  const match = /^assets\/(fonts|logos)\/([A-Za-z0-9_][A-Za-z0-9._ -]{0,79})$/.exec(rel);
  if (match === null || match[2] === undefined || match[2].includes('..')) return null;
  return `assets/${match[1] ?? ''}/${encodeURIComponent(match[2])}`;
};

const baseName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

// ---- the CSS the system contributes ----

const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const TYPE_FIELDS: readonly TypeField[] = ['family', 'size', 'weight', 'lineHeight', 'letterSpacing'];

/** The system's tokens, type style fields and font faces as custom properties (`.dc-dark` takes the dark values). */
export const specimenSystemCss = (detail: SystemDetail, unusable: ReadonlySet<string>): string => {
  const root: string[] = [];
  const dark: string[] = [];
  for (const token of detail.tokens) {
    if (!isTokenName(token.name)) continue;
    const light = cssValueOf(token.section, null, token.light?.text);
    const darkValue = cssValueOf(token.section, null, token.dark?.text);
    if (light !== null) root.push(`${token.name}: ${light};`);
    if (darkValue !== null) {
      root.push(`${darkVarOf(token.name)}: ${darkValue};`);
      dark.push(`${token.name}: var(${darkVarOf(token.name)});`);
    }
  }
  for (const style of detail.type) {
    if (!SYSTEM_ENTRY_ID_PATTERN.test(style.id)) continue;
    for (const field of TYPE_FIELDS) {
      const value = cssValueOf('typography', field, style[field]);
      if (value !== null) root.push(`${typeVarOf(style.id, field)}: ${value};`);
    }
  }
  const faces: string[] = [];
  for (const font of detail.fonts) {
    const url = assetUrl(font.file);
    if (url === null || unusable.has(font.file) || !FONT_FAMILY.test(font.family)) continue;
    const weight = Number.isInteger(font.weight) && font.weight >= 1 && font.weight <= 1000 ? font.weight : 400;
    const style = font.style === 'italic' ? 'italic' : 'normal';
    faces.push(`@font-face { font-family: "${font.family}"; src: url("${url}"); font-weight: ${weight}; font-style: ${style}; font-display: block; }`);
  }
  return `${faces.join('\n')}\n:root {\n${root.join('\n')}\n}\n.dc-dark {\n${dark.join('\n')}\n}\n`;
};

// ---- pieces ----

const HATCHED = (label: string): string => `<div class="dc-swatch dc-hatched" role="img" aria-label="${escapeHtml(label)}"></div><div class="dc-hatched-label">${escapeHtml(label)}</div>`;
const CANT_READ = "Can't read this value";

/** One token's name and values as text. */
const tokenIdentity = (token: SystemToken): string => {
  const values = [token.light ? escapeHtml(token.light.text) : '', token.dark ? `dark ${escapeHtml(token.dark.text)}` : ''].filter(Boolean).join(' · ');
  return `<div class="dc-name">${escapeHtml(token.name)}</div>` + (values !== '' ? `<div class="dc-value">${values}</div>` : '');
};

/** One token's note and problem. */
const tokenNote = (token: SystemToken): string =>
  (token.note !== '' ? `<div class="dc-note">${escapeHtml(token.note)}</div>` : '') +
  (token.problem !== null ? `<div class="dc-problem">${escapeHtml(token.problem)}</div>` : '');

/** One token's identity lines: name, values as text, note, problem. */
const tokenText = (token: SystemToken): string => tokenIdentity(token) + tokenNote(token);

/** A visual for one side (light or dark) of a token, or the hatched "can't read" box. */
const sideVisual = (token: SystemToken, side: 'light' | 'dark', draw: (name: string) => string): string => {
  const value = side === 'light' ? token.light : token.dark;
  if (value === null) return `<div class="dc-muted dc-hatched-label">${side === 'light' ? 'No light value' : 'No dark value'}</div>`;
  if (cssValueOf(token.section, null, value.text) === null || !isTokenName(token.name)) return HATCHED(CANT_READ);
  return draw(token.name);
};

const grounds = (token: SystemToken, draw: (name: string) => string): string => {
  const light = `<div class="dc-ground dc-light">${sideVisual(token, 'light', draw)}</div>`;
  const dark = token.dark !== null ? `<div class="dc-ground dc-dark">${sideVisual(token, 'dark', draw)}</div>` : '';
  return `<div class="dc-grounds">${light}${dark}</div>`;
};

const tokenCard = (token: SystemToken, draw: (name: string) => string): string =>
  `<div class="dc-card"${entryAttr('token', token.name)}>${grounds(token, draw)}${tokenText(token)}</div>`;

/** A table run of tokens: the grounds in the sample cell, the name and values in the token cell, note and problem in the note cell. */
const tokenTable = (tokens: readonly SystemToken[], draw: (name: string) => string, label: string): string =>
  tableWrap(
    label,
    tableHeader(['Sample', 'Token', 'Note']) +
      tokens
        .map(
          (token) =>
            `<div class="dc-trow" role="row"${entryAttr('token', token.name)}>` +
            tableCell('name', grounds(token, draw)) +
            tableCell('preview', tokenIdentity(token)) +
            tableCell('notes', tokenNote(token)) +
            '</div>',
        )
        .join(''),
  );

/**
 * One run of token cards. `card` keeps today's grid byte for byte; `compact` denser; `table` rows.
 * `full` is not a token layout (the parser refuses it); it falls back to the card grid.
 */
const tokenRun = (run: LayoutRun<SystemToken>, draw: (name: string) => string, label: string): string => {
  if (run.layout === 'table') return tokenTable(run.items, draw, label);
  const cards = run.items.map((token) => tokenCard(token, draw)).join('');
  return `<div class="dc-grid${run.layout === 'compact' ? ' dc-run-compact' : ''}">${cards}</div>`;
};

const tokenRuns = (detail: SystemDetail, tokens: readonly SystemToken[], section: SystemSection, draw: (name: string) => string, label: string): string =>
  runsOf(tokens, () => effectiveLayout(detail, section, null))
    .map((run) => tokenRun(run, draw, label))
    .join('');

const sectionElement = (id: SystemSection, title: string, body: string): string =>
  `<section class="dc-section" id="dc-section-${id}" data-dc-section="${id}"><h2>${escapeHtml(title)}</h2>${body}</section>`;

const emptyLine = (text: string): string => `<p class="dc-empty">${escapeHtml(text)}</p>`;

const tokensOf = (detail: SystemDetail, which: TokenSection): SystemToken[] => detail.tokens.filter((token) => token.section === which);

/** A section's content: its body ('' when it has no entries) and the line shown when it is empty. */
type SectionParts = { title: string; body: string; empty: string };

// ---- foundations ----

const overviewParts = (detail: SystemDetail, markdown: MarkdownProfile): SectionParts => {
  const parts: string[] = [];
  if (detail.overview !== null) {
    parts.push(
      `<div class="dc-text"${entryAttr('overview', '')}>${renderMarkdown(detail.overview.text, markdown) || emptyLine('The overview is empty.')}` +
        (detail.overview.problem !== null ? `<div class="dc-problem">${escapeHtml(detail.overview.problem)}</div>` : '') +
        '</div>',
    );
  }
  // Notes run by the overview section's hints; a card run keeps today's loose full-width cards.
  for (const run of runsOf(detail.notes, (note) => effectiveLayout(detail, 'overview', note.layout))) {
    if (run.layout === 'table') {
      parts.push(entryTextTable('note', run.items, 'Notes', markdown));
      continue;
    }
    const cards = run.items.map((note) => noteCard(note, markdown)).join('');
    if (run.layout === 'card') parts.push(cards);
    else if (run.layout === 'full') parts.push(`<div class="dc-run-full">${cards}</div>`);
    else parts.push(`<div class="dc-grid dc-text-grid dc-run-compact">${cards}</div>`);
  }
  return { title: 'Overview', body: parts.join(''), empty: 'No overview or notes yet.' };
};

const noteCard = (note: SystemDetail['notes'][number], markdown: MarkdownProfile): string => {
  const key = SYSTEM_ENTRY_ID_PATTERN.test(note.id) ? entryAttr('note', note.id) : '';
  return (
    `<div class="dc-card dc-text"${key}><h3>${escapeHtml(note.title)}</h3>${renderMarkdown(withoutLeadingTitle(note.text, note.title), markdown)}` +
    (note.problem !== null ? `<div class="dc-problem">${escapeHtml(note.problem)}</div>` : '') +
    '</div>'
  );
};

const GROUPS: readonly { group: ColourGroup; title: string }[] = [
  { group: 'brand', title: 'Brand' },
  { group: 'surface', title: 'Surface' },
  { group: 'text', title: 'Text' },
  { group: 'border', title: 'Border' },
  { group: 'status', title: 'Status' },
  { group: 'data', title: 'Data' },
  { group: 'other', title: 'Other colours' },
];

const colourParts = (detail: SystemDetail, styled: Styler): SectionParts => {
  const colours = tokensOf(detail, 'colours');
  const swatch = (name: string): string => `<div${styled('dc-swatch', `background: var(${name})`)}></div>`;
  const body = GROUPS.map(({ group, title }) => {
    const members = colours.filter((token) => (token.group ?? 'other') === group);
    if (members.length === 0) return '';
    // Runs form inside each colour group; the group keeps its heading.
    return `<h3>${escapeHtml(title)}</h3>${tokenRuns(detail, members, 'colours', swatch, `Colours: ${title}`)}`;
  }).join('');
  return { title: 'Colours', body, empty: 'No colour tokens yet.' };
};

const caseOf = (style: TypeStyle): string => ({ none: 'none', upper: 'uppercase', lower: 'lowercase', title: 'capitalize' })[style.case] ?? 'none';

const typeRow = (style: TypeStyle, styled: Styler): string => {
  const values = TYPE_FIELDS.map((field) => style[field]).filter((value) => value !== '').map(escapeHtml).join(' · ');
  const id = SYSTEM_ENTRY_ID_PATTERN.test(style.id) ? style.id : null;
  const declarations =
    id === null
      ? ''
      : [
          `font-family: var(${typeVarOf(id, 'family')}, inherit)`,
          `font-size: var(${typeVarOf(id, 'size')}, inherit)`,
          `font-weight: var(${typeVarOf(id, 'weight')}, inherit)`,
          `line-height: var(${typeVarOf(id, 'lineHeight')}, inherit)`,
          `letter-spacing: var(${typeVarOf(id, 'letterSpacing')}, normal)`,
          `text-transform: ${caseOf(style)}`,
        ].join('; ');
  return (
    `<div class="dc-row"${id === null ? '' : entryAttr('type', id)}>` +
    `<div class="dc-meta"><div>${escapeHtml(style.name)}</div><div class="dc-value">${values}</div>` +
    (style.note !== '' ? `<div class="dc-note">${escapeHtml(style.note)}</div>` : '') +
    `</div><div${styled('dc-specimen', declarations)}>${escapeHtml(style.name)}: The quick brown fox jumps over the lazy dog</div></div>`
  );
};

const fontRow = (font: FontAsset, index: number, unusable: ReadonlySet<string>, styled: Styler): string => {
  const usable = !unusable.has(font.file) && assetUrl(font.file) !== null && FONT_FAMILY.test(font.family);
  const sample = usable
    ? `<div${styled('dc-specimen', `font-family: "${font.family}", sans-serif; font-weight: ${Number.isInteger(font.weight) ? font.weight : 400}; font-style: ${font.style === 'italic' ? 'italic' : 'normal'}`)}>Aa Bb Cc 0123456789</div>`
    : `<div class="dc-specimen">${escapeHtml("This font file can't be used.")}</div>`;
  return (
    `<div class="dc-row"${entryAttr('font', String(index))}><div class="dc-meta"><div>${escapeHtml(font.family)}</div>` +
    `<div class="dc-value">${escapeHtml(`${font.weight} ${font.style} · ${baseName(font.file)}`)}</div></div>${sample}</div>`
  );
};

const plainTokenRows = (tokens: readonly SystemToken[]): string =>
  tokens.map((token) => `<div class="dc-row"${entryAttr('token', token.name)}><div class="dc-meta">${tokenText(token)}</div></div>`).join('');

const typographyParts = (detail: SystemDetail, unusable: ReadonlySet<string>, styled: Styler): SectionParts => {
  const parts: string[] = [];
  if (detail.type.length > 0) parts.push(`<h3>Type styles</h3>${detail.type.map((style) => typeRow(style, styled)).join('')}`);
  if (detail.fonts.length > 0) parts.push(`<h3>Fonts</h3>${detail.fonts.map((font, index) => fontRow(font, index, unusable, styled)).join('')}`);
  const tokens = tokensOf(detail, 'typography');
  if (tokens.length > 0) parts.push(`<h3>Type tokens</h3>${plainTokenRows(tokens)}`);
  return { title: 'Typography', body: parts.join(''), empty: 'No type styles, fonts or type tokens yet.' };
};

const visualParts = (detail: SystemDetail, which: 'spacing' | 'radius' | 'shadows', title: string, empty: string, draw: (name: string) => string): SectionParts => {
  const tokens = tokensOf(detail, which);
  return { title, body: tokens.length > 0 ? tokenRuns(detail, tokens, which, draw, title) : '', empty };
};

const layerOrder = (token: SystemToken): number => {
  const text = token.light?.text ?? token.dark?.text ?? '';
  return /^-?\d+$/.test(text) ? Number(text) : 0;
};

const layersParts = (detail: SystemDetail, styled: Styler): SectionParts => {
  const tokens = [...tokensOf(detail, 'layers')].sort((a, b) => layerOrder(a) - layerOrder(b));
  const parts: SectionParts = { title: 'Layers', body: '', empty: 'No layer tokens yet.' };
  if (tokens.length === 0) return parts;
  const shown = tokens.slice(0, 12);
  const diagram = shown
    .map((token, index) => {
      const z = isTokenName(token.name) && cssValueOf('layers', null, token.light?.text) !== null ? `z-index: var(${token.name}); ` : '';
      return `<div${styled('dc-layer', `${z}left: ${index * 28}px; top: ${index * 6}px`)}>${escapeHtml(token.name)}</div>`;
    })
    .join('');
  const cards = tokens.map((token) => `<div class="dc-card"${entryAttr('token', token.name)}>${tokenText(token)}</div>`).join('');
  return { ...parts, body: `<div class="dc-stack" aria-hidden="true">${diagram}</div><div class="dc-grid">${cards}</div>` };
};

const sizesParts = (detail: SystemDetail, styled: Styler): SectionParts => {
  const sizes = tokensOf(detail, 'sizes');
  const others = tokensOf(detail, 'other');
  const bar = (name: string): string => `<div${styled('dc-bar', `width: min(var(${name}), 100%)`)}></div>`;
  const parts: string[] = [];
  if (sizes.length > 0) parts.push(tokenRuns(detail, sizes, 'sizes', bar, 'Sizes'));
  if (others.length > 0) parts.push(`<h3>Other tokens</h3>${plainTokenRows(others)}`);
  return { title: 'Sizes', body: parts.join(''), empty: 'No size tokens yet.' };
};

// ---- components ----

/** A component's note, variants, states, tokens and source (the card's text under the name, the table's notes cell). */
const componentLists = (component: SystemComponent): string => {
  const list = (label: string, items: readonly string[]): string =>
    items.length > 0 ? `<div class="dc-note">${escapeHtml(label)}: ${items.map(escapeHtml).join(', ')}</div>` : '';
  const undefinedTokens = new Set(component.undefinedTokens);
  const tokens = component.tokens.map((name) => escapeHtml(undefinedTokens.has(name) ? `${name} (not in this system)` : name));
  return (
    (component.note !== '' ? `<div class="dc-note">${escapeHtml(component.note)}</div>` : '') +
    list('Variants', component.variants) +
    list('States', component.states) +
    (tokens.length > 0 ? `<div class="dc-note">Tokens: ${tokens.join(', ')}</div>` : '') +
    (component.source !== null ? `<div class="dc-value">${escapeHtml(component.source)}</div>` : '')
  );
};

const componentName = (component: SystemComponent): string =>
  `<div><strong>${escapeHtml(component.name)}</strong></div>` + (component.purpose !== '' ? `<div class="dc-note">${escapeHtml(component.purpose)}</div>` : '');

/** `fit` marks the card for the board script's widen measurement (card and compact runs only). */
const componentCard = (component: SystemComponent, example: SpecimenOptions['example'], fit: boolean): string => {
  const id = SYSTEM_ENTRY_ID_PATTERN.test(component.id) ? component.id : null;
  const exampleHtml = component.example !== null && example !== undefined ? example(component, id) : '';
  return (
    `<div class="dc-card${fit ? ' dc-fit' : ''}"${id === null ? '' : entryAttr('component', id)}>${exampleHtml}` +
    componentName(component) +
    componentLists(component) +
    '</div>'
  );
};

/** A table run of components: name and purpose, the example, then the notes; the row carries the entry key and `dc-fit`. */
const componentTable = (components: readonly SystemComponent[], example: SpecimenOptions['example']): string =>
  tableWrap(
    'Components',
    tableHeader(['Name', 'Preview', 'Notes']) +
      components
        .map((component) => {
          const id = SYSTEM_ENTRY_ID_PATTERN.test(component.id) ? component.id : null;
          const exampleHtml = component.example !== null && example !== undefined ? example(component, id) : '';
          return (
            `<div class="dc-trow dc-fit" role="row"${id === null ? '' : entryAttr('component', id)}>` +
            tableCell('name', componentName(component)) +
            tableCell('preview', exampleHtml) +
            tableCell('notes', componentLists(component)) +
            '</div>'
          );
        })
        .join(''),
  );

const componentsParts = (detail: SystemDetail, example: SpecimenOptions['example']): SectionParts => {
  const body = runsOf(detail.components, (component) => effectiveLayout(detail, 'components', component.layout))
    .map((run) => {
      if (run.layout === 'table') return componentTable(run.items, example);
      const cards = run.items.map((component) => componentCard(component, example, run.layout !== 'full')).join('');
      if (run.layout === 'full') return `<div class="dc-run-full">${cards}</div>`;
      return `<div class="dc-grid dc-components${run.layout === 'compact' ? ' dc-run-compact' : ' dc-run-card'}">${cards}</div>`;
    })
    .join('');
  return { title: 'Components', body, empty: 'No components yet.' };
};

// ---- patterns & voice, brand & marketing (S8, §2.11) ----

const KIND_LABELS: Readonly<Record<string, string>> = {
  layout: 'Layout',
  'do-dont': "Do and don't",
  voice: 'Voice',
  marketing: 'Marketing',
  imagery: 'Imagery',
  'logo-use': 'Logo use',
  other: 'Other',
};

/** One pattern or brand entry as a text card: title, kind, note, then the body as markdown. */
const entryTextCard = (kind: 'pattern' | 'brand', entry: SystemEntryText, markdown: MarkdownProfile): string => {
  const key = SYSTEM_ENTRY_ID_PATTERN.test(entry.id) ? entryAttr(kind, entry.id) : '';
  return (
    `<div class="dc-card dc-text"${key}><h3>${escapeHtml(entry.title)}</h3>` +
    `<div class="dc-value">${escapeHtml(KIND_LABELS[entry.kind] ?? entry.kind)}</div>` +
    (entry.note !== '' ? `<div class="dc-note">${escapeHtml(entry.note)}</div>` : '') +
    (entry.text !== null && entry.text.trim() !== '' ? `<div class="dc-body">${renderMarkdown(entry.text, markdown)}</div>` : '') +
    (entry.problem !== null ? `<div class="dc-problem">${escapeHtml(entry.problem)}</div>` : '') +
    '</div>'
  );
};

/** One text entry as a table row: title (and kind), the body as guidance, note and problem. */
const entryTextRow = (kind: 'note' | 'pattern' | 'brand', entry: SystemEntryText | SystemDetail['notes'][number], markdown: MarkdownProfile): string => {
  const key = SYSTEM_ENTRY_ID_PATTERN.test(entry.id) ? entryAttr(kind, entry.id) : '';
  const isEntryText = 'kind' in entry;
  const title =
    `<div><strong>${escapeHtml(entry.title)}</strong></div>` +
    (isEntryText ? `<div class="dc-value">${escapeHtml(KIND_LABELS[entry.kind] ?? entry.kind)}</div>` : '');
  // A note's own leading heading repeats the title cell: dropped, as on the note cards.
  const body = entry.text === null ? '' : isEntryText ? entry.text : withoutLeadingTitle(entry.text, entry.title);
  const guidance = body.trim() !== '' ? `<div class="dc-body">${renderMarkdown(body, markdown)}</div>` : '';
  const note =
    (isEntryText && entry.note !== '' ? `<div class="dc-note">${escapeHtml(entry.note)}</div>` : '') +
    (entry.problem !== null ? `<div class="dc-problem">${escapeHtml(entry.problem)}</div>` : '');
  return `<div class="dc-trow" role="row"${key}>` + tableCell('name', title) + tableCell('preview', guidance) + tableCell('notes', note) + '</div>';
};

const entryTextTable = (kind: 'note' | 'pattern' | 'brand', entries: readonly (SystemEntryText | SystemDetail['notes'][number])[], label: string, markdown: MarkdownProfile): string =>
  tableWrap(label, tableHeader(['Title', 'Guidance', 'Note']) + entries.map((entry) => entryTextRow(kind, entry, markdown)).join(''));

/** Pattern and brand runs: a card run keeps today's text grid byte for byte; compact, full and table get their containers. */
const entryTextRuns = (kind: 'pattern' | 'brand', detail: SystemDetail, entries: readonly SystemEntryText[], label: string, markdown: MarkdownProfile): string =>
  runsOf(entries, (entry) => effectiveLayout(detail, kind === 'pattern' ? 'patterns' : 'brand', entry.layout))
    .map((run) => {
      if (run.layout === 'table') return entryTextTable(kind, run.items, label, markdown);
      const cards = run.items.map((entry) => entryTextCard(kind, entry, markdown)).join('');
      if (run.layout === 'full') return `<div class="dc-run-full">${cards}</div>`;
      return `<div class="dc-grid dc-text-grid${run.layout === 'compact' ? ' dc-run-compact' : ''}">${cards}</div>`;
    })
    .join('');

const patternsParts = (detail: SystemDetail, markdown: MarkdownProfile): SectionParts => ({
  title: 'Patterns & voice',
  body: entryTextRuns('pattern', detail, detail.patterns, 'Patterns & voice', markdown),
  empty: 'No patterns or voice guidance yet.',
});

const logoCard = (logo: LogoAsset, index: number, unusable: ReadonlySet<string>): string => {
  const url = unusable.has(logo.file) ? null : assetUrl(logo.file);
  const picture =
    url === null
      ? `<div class="dc-muted">${escapeHtml("This logo file can't be used.")}</div>`
      : `<img class="dc-logo" src="${escapeHtml(url)}" alt="${escapeHtml(logo.variant)}">`;
  return (
    `<div class="dc-card"${entryAttr('logo', String(index))}><div class="dc-grounds"><div class="dc-ground dc-light">${picture}</div></div>` +
    `<div>${escapeHtml(logo.variant)}</div><div class="dc-value">${escapeHtml(baseName(logo.file))}</div>` +
    (logo.note !== '' ? `<div class="dc-note">${escapeHtml(logo.note)}</div>` : '') +
    '</div>'
  );
};

const brandParts = (detail: SystemDetail, unusable: ReadonlySet<string>, markdown: MarkdownProfile): SectionParts => {
  const parts: string[] = [];
  const entries = entryTextRuns('brand', detail, detail.brand, 'Brand & marketing', markdown);
  if (entries !== '') parts.push(entries);
  if (detail.logos.length > 0) parts.push(`<h3>Logos</h3><div class="dc-grid">${detail.logos.map((logo, index) => logoCard(logo, index, unusable)).join('')}</div>`);
  return { title: 'Brand & marketing', body: parts.join(''), empty: 'No brand guidance or logos yet.' };
};

/** Assets keeps the font files and the source files (§2.11); fonts are drawn as specimens under Typography. */
const assetsParts = (detail: SystemDetail): SectionParts => {
  const parts: string[] = [];
  const list = (items: readonly string[]): string => `<ul class="dc-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  if (detail.fonts.length > 0) parts.push(`<h3>Font files</h3>${list(detail.fonts.map((font) => baseName(font.file)))}`);
  if (detail.sourceFiles.length > 0) parts.push(`<h3>Sources</h3>${list(detail.sourceFiles.map((file) => baseName(file.file)))}`);
  return { title: 'Assets', body: parts.join(''), empty: 'No font or source files yet.' };
};

// ---- one section ----

const partsOf = (detail: SystemDetail, section: SystemSection, options: SpecimenOptions): SectionParts => {
  const unusable = options.unusable ?? new Set<string>();
  const styled = stylerOf(options);
  const markdown = options.markdown ?? 'board';
  switch (section) {
    case 'overview':
      return overviewParts(detail, markdown);
    case 'colours':
      return colourParts(detail, styled);
    case 'typography':
      return typographyParts(detail, unusable, styled);
    case 'spacing':
      return visualParts(detail, 'spacing', 'Spacing', 'No spacing tokens yet.', (name) => `<div${styled('dc-bar', `width: var(${name})`)}></div>`);
    case 'radius':
      return visualParts(detail, 'radius', 'Radius', 'No radius tokens yet.', (name) => `<div${styled('dc-radius-box', `border-radius: var(${name})`)}></div>`);
    case 'shadows':
      return visualParts(detail, 'shadows', 'Shadows', 'No shadow tokens yet.', (name) => `<div${styled('dc-shadow-box', `box-shadow: var(${name})`)}></div>`);
    case 'layers':
      return layersParts(detail, styled);
    case 'sizes':
      return sizesParts(detail, styled);
    case 'components':
      return componentsParts(detail, options.example);
    case 'patterns':
      return patternsParts(detail, markdown);
    case 'brand':
      return brandParts(detail, unusable, markdown);
    case 'assets':
      return assetsParts(detail);
  }
};

/**
 * One section of a system as a `<section data-dc-section>` element. A section in an area the system
 * does not cover says "Not covered by this system." and still shows any entries written there anyway
 * (nothing is hidden, §2.11).
 */
export const renderSpecimenSection = (detail: SystemDetail, section: SystemSection, options: SpecimenOptions = {}): string => {
  const { title, body, empty } = partsOf(detail, section, options);
  const covered = detail.coverage.includes(AREA_OF_SECTION[section]);
  if (!covered) return sectionElement(section, title, `<p class="dc-empty dc-not-covered">${escapeHtml(NOT_COVERED_SENTENCE)}</p>${body}`);
  return sectionElement(section, title, body || emptyLine(empty));
};
