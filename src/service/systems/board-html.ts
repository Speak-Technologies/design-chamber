// The specimen board document (documentation/specs/phase-2-5-technical.md §5.7, AD-9). Pure: no
// service imports, so the CLI check can bundle it. T11 adds the area headings and moves the section
// renderers into `specimen-html.ts`.
//
// The board is untrusted content's view: everything in it came from agent-written files. So:
// - every name, note, title and value shown as text is HTML-escaped;
// - a value enters CSS only as a custom property declaration, after `validateTokenValue` passes again
//   (its alphabet has no `; { } < > \ : *` and no `url(`), so it can't leave its declaration or the
//   `<style>` element; a refused value is shown as text beside a hatched "can't read" swatch;
// - names enter CSS only after `SYSTEM_TOKEN_NAME_PATTERN`, ids only after `SYSTEM_ENTRY_ID_PATTERN`;
//   class names are ours, never the system's;
// - logos are only ever `<img src="assets/logos/…">` (the bundler makes a data: URL, and an SVG as an
//   image never runs script);
// - a component example is HTML-escaped into a `<template>` as text, so it is inert and can't close the
//   template; the board script sets it as a string on a shadow root's `innerHTML`, which never runs
//   `<script>` elements and keeps the example's CSS scoped (§5.7, §11.4).

import { SYSTEM_ENTRY_ID_PATTERN, SYSTEM_TOKEN_NAME_PATTERN } from '../../shared/limits.ts';
import { darkVarOf, entryKeyOf, isBoardEntryKey, typeVarOf, type BoardEntryKind } from '../../shared/system-board.ts';
import { validateTokenValue, type TypeField } from '../../shared/token-edit.ts';
import type { ColourGroup, FontAsset, LogoAsset, SystemComponent, SystemDetail, SystemToken, TokenSection, TypeStyle } from '../../shared/types.ts';

/** Bumped when the generated document changes shape, so cached boards are not reused. */
export const BOARD_GENERATOR_VERSION = 1;

/** The virtual entry the board is bundled from (never a file on disk). */
export const BOARD_ENTRY_FILE = '__board.html';

export type BoardHtmlOptions = {
  scheme: 'light' | 'dark';
  /** Each component's example document, already bundled by the service, by component id. */
  examples?: Readonly<Record<string, string>>;
  /** Font and logo files (`assets/…`) the service's `checkAsset` refused. */
  unusable?: ReadonlySet<string>;
};

// ---- escaping ----

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text and attribute values: the five HTML specials. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

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

/** Paragraphs of plain text, split on blank lines, each escaped. */
const paragraphs = (text: string): string =>
  text
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => `<p>${escapeHtml(part)}</p>`)
    .join('');

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

const systemCss = (detail: SystemDetail, unusable: ReadonlySet<string>): string => {
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

// ---- the board's own chrome ----

const FALLBACKS = {
  light: { bg: '#f7f7f8', fg: '#1d1d1f', muted: '#62626a', border: '#d8d8dc', card: '#ffffff', ground: '#ffffff', darkGround: '#18181b' },
  dark: { bg: '#141416', fg: '#ececef', muted: '#a0a0a8', border: '#34343a', card: '#1c1c20', ground: '#ffffff', darkGround: '#0e0e10' },
} as const;

const chromeCss = (scheme: 'light' | 'dark'): string => {
  const f = FALLBACKS[scheme];
  return `
:root { color-scheme: ${scheme}; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 40px 64px; background: var(--dc-board-bg, ${f.bg}); color: var(--dc-board-fg, ${f.fg});
  font-family: var(--dc-board-font, system-ui, sans-serif); font-size: 14px; line-height: 1.5; }
.dc-board-title { margin: 0 0 4px; font-size: 24px; font-weight: 600; }
.dc-board-sub { margin: 0 0 32px; color: var(--dc-board-muted, ${f.muted}); }
.dc-section { padding: 24px 0 8px; border-top: 1px solid var(--dc-board-border, ${f.border}); content-visibility: auto; contain-intrinsic-size: auto 480px; }
.dc-section > h2 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
.dc-section h3 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dc-board-muted, ${f.muted}); }
.dc-empty, .dc-muted { color: var(--dc-board-muted, ${f.muted}); }
.dc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.dc-card { background: var(--dc-board-card, ${f.card}); border: 1px solid var(--dc-board-border, ${f.border});
  border-radius: var(--dc-board-radius, 8px); padding: 12px; min-width: 0; }
.dc-name { font-family: ui-monospace, monospace; font-size: 12px; overflow-wrap: anywhere; }
.dc-value { font-family: ui-monospace, monospace; font-size: 12px; color: var(--dc-board-muted, ${f.muted}); overflow-wrap: anywhere; }
.dc-note { margin-top: 4px; font-size: 12px; color: var(--dc-board-muted, ${f.muted}); white-space: pre-wrap; overflow-wrap: anywhere; }
.dc-problem { margin-top: 4px; font-size: 12px; }
.dc-grounds { display: flex; gap: 8px; margin-bottom: 8px; }
.dc-ground { flex: 1; padding: 8px; border-radius: calc(var(--dc-board-radius, 8px) - 2px); background: ${f.ground}; color: #1d1d1f; }
.dc-ground.dc-dark { background: ${f.darkGround}; color: #ececef; }
.dc-swatch { height: 48px; border-radius: 4px; border: 1px solid rgb(127 127 127 / 0.3); }
.dc-hatched { background: repeating-linear-gradient(45deg, rgb(127 127 127 / 0.45) 0 2px, transparent 2px 8px); }
.dc-hatched-label { font-size: 11px; }
.dc-row { display: flex; gap: 16px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--dc-board-border, ${f.border}); }
.dc-row > .dc-meta { flex: 0 0 220px; min-width: 0; }
.dc-specimen { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dc-bar { height: 12px; max-width: 100%; background: currentColor; opacity: 0.7; border-radius: 2px; }
.dc-radius-box { width: 64px; height: 64px; border: 2px solid currentColor; opacity: 0.8; }
.dc-shadow-box { height: 64px; border-radius: 6px; background: #ffffff; }
.dc-stack { position: relative; height: 120px; }
.dc-layer { position: absolute; width: 140px; height: 56px; padding: 6px; border-radius: 6px; font-size: 11px;
  background: var(--dc-board-card, ${f.card}); border: 1px solid var(--dc-board-border, ${f.border}); overflow: hidden; }
.dc-example { display: block; min-height: 32px; overflow: auto; }
.dc-list { margin: 0; padding-left: 18px; }
.dc-logo { max-width: 100%; max-height: 96px; display: block; margin: 0 auto; }
.dc-text p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
`;
};

// ---- pieces ----

const HATCHED = (label: string): string => `<div class="dc-swatch dc-hatched" role="img" aria-label="${escapeHtml(label)}"></div><div class="dc-hatched-label">${escapeHtml(label)}</div>`;
const CANT_READ = "Can't read this value";

/** One token's identity lines: name, values as text, note, problem. */
const tokenText = (token: SystemToken): string => {
  const values = [token.light ? escapeHtml(token.light.text) : '', token.dark ? `dark ${escapeHtml(token.dark.text)}` : ''].filter(Boolean).join(' · ');
  return (
    `<div class="dc-name">${escapeHtml(token.name)}</div>` +
    (values !== '' ? `<div class="dc-value">${values}</div>` : '') +
    (token.note !== '' ? `<div class="dc-note">${escapeHtml(token.note)}</div>` : '') +
    (token.problem !== null ? `<div class="dc-problem">${escapeHtml(token.problem)}</div>` : '')
  );
};

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

const section = (id: string, title: string, body: string): string =>
  `<section class="dc-section" id="dc-section-${id}" data-dc-section="${id}"><h2>${escapeHtml(title)}</h2>${body}</section>`;

const emptyLine = (text: string): string => `<p class="dc-empty">${escapeHtml(text)}</p>`;

const tokensOf = (detail: SystemDetail, which: TokenSection): SystemToken[] => detail.tokens.filter((token) => token.section === which);

// ---- sections ----

const overviewSection = (detail: SystemDetail): string => {
  const parts: string[] = [];
  if (detail.overview !== null) {
    parts.push(
      `<div class="dc-text"${entryAttr('overview', '')}>${paragraphs(detail.overview.text) || emptyLine('The overview is empty.')}` +
        (detail.overview.problem !== null ? `<div class="dc-problem">${escapeHtml(detail.overview.problem)}</div>` : '') +
        '</div>',
    );
  }
  for (const note of detail.notes) {
    const key = SYSTEM_ENTRY_ID_PATTERN.test(note.id) ? entryAttr('note', note.id) : '';
    parts.push(
      `<div class="dc-card dc-text"${key}><h3>${escapeHtml(note.title)}</h3>${paragraphs(note.text)}` +
        (note.problem !== null ? `<div class="dc-problem">${escapeHtml(note.problem)}</div>` : '') +
        '</div>',
    );
  }
  return section('overview', 'Overview', parts.length > 0 ? parts.join('') : emptyLine('No overview or notes yet.'));
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

const colourSection = (detail: SystemDetail): string => {
  const colours = tokensOf(detail, 'colours');
  const swatch = (name: string): string => `<div class="dc-swatch" style="background: var(${name})"></div>`;
  const body = GROUPS.map(({ group, title }) => {
    const members = colours.filter((token) => (token.group ?? 'other') === group);
    if (members.length === 0) return '';
    return `<h3>${escapeHtml(title)}</h3><div class="dc-grid">${members.map((token) => tokenCard(token, swatch)).join('')}</div>`;
  }).join('');
  return section('colours', 'Colours', body || emptyLine('No colour tokens yet.'));
};

const caseOf = (style: TypeStyle): string => ({ none: 'none', upper: 'uppercase', lower: 'lowercase', title: 'capitalize' })[style.case] ?? 'none';

const typeRow = (style: TypeStyle): string => {
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
    `</div><div class="dc-specimen" style="${declarations}">${escapeHtml(style.name)}: The quick brown fox jumps over the lazy dog</div></div>`
  );
};

const fontRow = (font: FontAsset, index: number, unusable: ReadonlySet<string>): string => {
  const usable = !unusable.has(font.file) && assetUrl(font.file) !== null && FONT_FAMILY.test(font.family);
  const sample = usable
    ? `<div class="dc-specimen" style="font-family: &quot;${escapeHtml(font.family)}&quot;, sans-serif; font-weight: ${Number.isInteger(font.weight) ? font.weight : 400}; font-style: ${font.style === 'italic' ? 'italic' : 'normal'}">Aa Bb Cc 0123456789</div>`
    : `<div class="dc-specimen">${escapeHtml("This font file can't be used.")}</div>`;
  return (
    `<div class="dc-row"${entryAttr('font', String(index))}><div class="dc-meta"><div>${escapeHtml(font.family)}</div>` +
    `<div class="dc-value">${escapeHtml(`${font.weight} ${font.style} · ${baseName(font.file)}`)}</div></div>${sample}</div>`
  );
};

const plainTokenRows = (tokens: readonly SystemToken[]): string =>
  tokens.map((token) => `<div class="dc-row"${entryAttr('token', token.name)}><div class="dc-meta">${tokenText(token)}</div></div>`).join('');

const typographySection = (detail: SystemDetail, unusable: ReadonlySet<string>): string => {
  const parts: string[] = [];
  if (detail.type.length > 0) parts.push(`<h3>Type styles</h3>${detail.type.map(typeRow).join('')}`);
  if (detail.fonts.length > 0) parts.push(`<h3>Fonts</h3>${detail.fonts.map((font, index) => fontRow(font, index, unusable)).join('')}`);
  const tokens = tokensOf(detail, 'typography');
  if (tokens.length > 0) parts.push(`<h3>Type tokens</h3>${plainTokenRows(tokens)}`);
  return section('typography', 'Typography', parts.join('') || emptyLine('No type styles, fonts or type tokens yet.'));
};

const visualSection = (detail: SystemDetail, which: TokenSection, title: string, empty: string, draw: (name: string) => string): string => {
  const tokens = tokensOf(detail, which);
  return section(which, title, tokens.length > 0 ? `<div class="dc-grid">${tokens.map((token) => tokenCard(token, draw)).join('')}</div>` : emptyLine(empty));
};

const layerOrder = (token: SystemToken): number => {
  const text = token.light?.text ?? token.dark?.text ?? '';
  return /^-?\d+$/.test(text) ? Number(text) : 0;
};

const layersSection = (detail: SystemDetail): string => {
  const tokens = [...tokensOf(detail, 'layers')].sort((a, b) => layerOrder(a) - layerOrder(b));
  if (tokens.length === 0) return section('layers', 'Layers', emptyLine('No layer tokens yet.'));
  const shown = tokens.slice(0, 12);
  const diagram = shown
    .map((token, index) => {
      const z = isTokenName(token.name) && cssValueOf('layers', null, token.light?.text) !== null ? `z-index: var(${token.name}); ` : '';
      return `<div class="dc-layer" style="${z}left: ${index * 28}px; top: ${index * 6}px">${escapeHtml(token.name)}</div>`;
    })
    .join('');
  const cards = tokens.map((token) => `<div class="dc-card"${entryAttr('token', token.name)}>${tokenText(token)}</div>`).join('');
  return section('layers', 'Layers', `<div class="dc-stack" aria-hidden="true">${diagram}</div><div class="dc-grid">${cards}</div>`);
};

const sizesSection = (detail: SystemDetail): string => {
  const sizes = tokensOf(detail, 'sizes');
  const others = tokensOf(detail, 'other');
  const bar = (name: string): string => `<div class="dc-bar" style="width: min(var(${name}), 100%)"></div>`;
  const parts: string[] = [];
  if (sizes.length > 0) parts.push(`<div class="dc-grid">${sizes.map((token) => tokenCard(token, bar)).join('')}</div>`);
  if (others.length > 0) parts.push(`<h3>Other tokens</h3>${plainTokenRows(others)}`);
  return section('sizes', 'Sizes', parts.join('') || emptyLine('No size tokens yet.'));
};

const hasDark = (detail: SystemDetail): boolean => detail.tokens.some((token) => token.dark !== null);

const componentCard = (component: SystemComponent, examples: Readonly<Record<string, string>>, dark: boolean): string => {
  const id = SYSTEM_ENTRY_ID_PATTERN.test(component.id) ? component.id : null;
  const list = (label: string, items: readonly string[]): string =>
    items.length > 0 ? `<div class="dc-note">${escapeHtml(label)}: ${items.map(escapeHtml).join(', ')}</div>` : '';
  let example = '';
  if (component.example !== null) {
    const markup = id === null ? undefined : examples[id];
    if (markup === undefined || id === null) {
      example = `<div class="dc-muted">${escapeHtml("This example couldn't be shown.")}</div>`;
    } else {
      // Escaped as text: inert, and it can't close the template (§5.7).
      const host = (ground: string): string => `<div class="dc-ground ${ground}"><div class="dc-example" data-dc-example-host="${id}"></div></div>`;
      example =
        `<template data-dc-example="${id}">${escapeHtml(markup)}</template>` +
        `<div class="dc-grounds">${host('dc-light')}${dark ? host('dc-dark') : ''}</div>`;
      if (component.example.remote.length > 0) {
        example += `<div class="dc-note">${escapeHtml("This example asks for files from the internet, which don't load here:")} ${component.example.remote.map(escapeHtml).join(', ')}</div>`;
      }
    }
  }
  const undefinedTokens = new Set(component.undefinedTokens);
  const tokens = component.tokens.map((name) => escapeHtml(undefinedTokens.has(name) ? `${name} (not in this system)` : name));
  return (
    `<div class="dc-card"${id === null ? '' : entryAttr('component', id)}>${example}` +
    `<div><strong>${escapeHtml(component.name)}</strong></div>` +
    (component.purpose !== '' ? `<div class="dc-note">${escapeHtml(component.purpose)}</div>` : '') +
    (component.note !== '' ? `<div class="dc-note">${escapeHtml(component.note)}</div>` : '') +
    list('Variants', component.variants) +
    list('States', component.states) +
    (tokens.length > 0 ? `<div class="dc-note">Tokens: ${tokens.join(', ')}</div>` : '') +
    (component.source !== null ? `<div class="dc-value">${escapeHtml(component.source)}</div>` : '') +
    '</div>'
  );
};

const componentsSection = (detail: SystemDetail, examples: Readonly<Record<string, string>>): string => {
  const dark = hasDark(detail);
  const body = detail.components.map((component) => componentCard(component, examples, dark)).join('');
  return section('components', 'Components', body !== '' ? `<div class="dc-grid dc-components">${body}</div>` : emptyLine('No components yet.'));
};

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

const assetsSection = (detail: SystemDetail, unusable: ReadonlySet<string>): string => {
  const parts: string[] = [];
  if (detail.logos.length > 0) parts.push(`<h3>Logos</h3><div class="dc-grid">${detail.logos.map((logo, index) => logoCard(logo, index, unusable)).join('')}</div>`);
  if (detail.sourceFiles.length > 0) parts.push(`<h3>Sources</h3><ul class="dc-list">${detail.sourceFiles.map((file) => `<li>${escapeHtml(baseName(file.file))}</li>`).join('')}</ul>`);
  return section('assets', 'Assets', parts.join('') || emptyLine('No logos or source files yet.'));
};

// The board script (ours, static): attach each example to a shadow root as a string. Scripts set
// through innerHTML never run; the template's content is text, so nothing in it ran either.
const BOARD_SCRIPT = `(function () {
  var templates = document.querySelectorAll('template[data-dc-example]');
  var hosts = document.querySelectorAll('[data-dc-example-host]');
  for (var i = 0; i < templates.length; i += 1) {
    var id = templates[i].getAttribute('data-dc-example');
    var markup = templates[i].content.textContent || '';
    for (var j = 0; j < hosts.length; j += 1) {
      if (hosts[j].getAttribute('data-dc-example-host') !== id || hosts[j].shadowRoot) continue;
      try { hosts[j].attachShadow({ mode: 'open' }).innerHTML = markup; } catch (error) { hosts[j].textContent = 'This example could not be shown.'; }
    }
  }
})();`;

// ---- the document ----

const documentOf = (title: string, scheme: 'light' | 'dark', css: string, body: string, script: boolean): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
  `<style>${chromeCss(scheme)}</style><style>${css}</style></head>` +
  `<body>${body}${script ? `<script>${BOARD_SCRIPT}</script>` : ''}</body></html>`;

/** The whole board for one system (§5.7). */
export const buildBoardHtml = (detail: SystemDetail, options: BoardHtmlOptions): string => {
  const unusable = options.unusable ?? new Set<string>();
  const examples = options.examples ?? {};
  const title = `${detail.name}: specimen board`;
  const heading = `<h1 class="dc-board-title">${escapeHtml(detail.name)}</h1>`;
  if (detail.unreadable !== null) {
    return documentOf(title, options.scheme, '', `${heading}<p class="dc-board-sub">${escapeHtml(detail.unreadable)}</p>`, false);
  }
  const sub = detail.empty
    ? '<p class="dc-board-sub">This design system has nothing in it yet. Ask the agent to fill it in.</p>'
    : `<p class="dc-board-sub">${escapeHtml(detail.status === 'ready' ? 'Ready' : 'Draft')}</p>`;
  const body = [
    heading,
    sub,
    overviewSection(detail),
    colourSection(detail),
    typographySection(detail, unusable),
    visualSection(detail, 'spacing', 'Spacing', 'No spacing tokens yet.', (name) => `<div class="dc-bar" style="width: var(${name})"></div>`),
    visualSection(detail, 'radius', 'Radius', 'No radius tokens yet.', (name) => `<div class="dc-radius-box" style="border-radius: var(${name})"></div>`),
    visualSection(detail, 'shadows', 'Shadows', 'No shadow tokens yet.', (name) => `<div class="dc-shadow-box" style="box-shadow: var(${name})"></div>`),
    layersSection(detail),
    sizesSection(detail),
    componentsSection(detail, examples),
    assetsSection(detail, unusable),
  ].join('');
  return documentOf(title, options.scheme, systemCss(detail, unusable), body, true);
};
