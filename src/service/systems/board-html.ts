// The specimen board document (documentation/specs/phase-2-5-technical.md §5.7, §2.11, AD-9, AD-22).
// Pure: no service imports, so the CLI check can bundle it. The sections come from the shared
// renderers in `specimen-html.ts` (escaping and CSS rules are stated there), grouped under the four
// coverage area headings; this file adds the board's chrome, the component example part and the
// board script.
//
// A component example is HTML-escaped into a `<template>` as text, so it is inert and can't close the
// template; the board script sets it as a string on a shadow root's `innerHTML`, which never runs
// `<script>` elements and keeps the example's CSS scoped (§5.7, §11.4).

import { AREA_OF_SECTION, SYSTEM_AREAS, SYSTEM_SECTIONS } from '../../shared/system-json.ts';
import type { SystemArea, SystemComponent, SystemDetail, SystemSection } from '../../shared/types.ts';
import { AREA_TITLES, escapeHtml, renderSpecimenSection, specimenSystemCss } from './specimen-html.ts';

export { escapeHtml } from './specimen-html.ts';

/** Bumped when the generated document changes shape, so cached boards are not reused. */
export const BOARD_GENERATOR_VERSION = 3;

/** The virtual entry the board is bundled from (never a file on disk). */
export const BOARD_ENTRY_FILE = '__board.html';

export type BoardHtmlOptions = {
  scheme: 'light' | 'dark';
  /** Each component's example document, already bundled by the service, by component id. */
  examples?: Readonly<Record<string, string>>;
  /** Font and logo files (`assets/…`) the service's `checkAsset` refused. */
  unusable?: ReadonlySet<string>;
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
.dc-area { padding-top: 16px; }
.dc-area-title { margin: 24px 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dc-board-muted, ${f.muted}); }
.dc-text-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.dc-body { margin-top: 8px; }
/* Components: columns, not grid rows, so each card is as tall as its own content (a short card never stretches to a tall
   neighbour's row, a long preview never gets a fixed-height box). The 600px minimum gives a table, a KPI row or a tab strip room to
   fit: two columns on a full-screen page, one in a narrow stage. A card whose preview is still wider than its column (the board script
   measures it) takes the full width instead (the dc-wide class); only a preview wider than the whole board scrolls, inside its own ground. */
.dc-components { display: block; column-width: 600px; column-gap: 16px; }
/* One bounded group: the preview ground and the text under it share a card that stands clear of the board (a tint of the text
   colour on the card surface, and a border between the border and text colours), so the name and notes never read as loose text. */
.dc-components > .dc-card { display: block; break-inside: avoid; margin: 0 0 16px; padding: 16px; overflow: hidden;
  background: color-mix(in srgb, var(--dc-board-card, ${f.card}) 94%, var(--dc-board-fg, ${f.fg}));
  border: 1px solid color-mix(in srgb, var(--dc-board-border, ${f.border}) 70%, var(--dc-board-fg, ${f.fg})); }
.dc-components > .dc-card.dc-wide { column-span: all; }
/* Light and dark grounds stack, each as wide as the card, so a wide preview never has to share the row. */
.dc-components .dc-grounds { flex-direction: column; margin-bottom: 12px; }
.dc-components .dc-ground { flex: 0 0 auto; min-width: 0; padding: 12px; }
.dc-components .dc-example { overflow-x: auto; overflow-y: visible; }
`;
};

// ---- the board's example part (needs the board script) ----

const hasDark = (detail: SystemDetail): boolean => detail.tokens.some((token) => token.dark !== null);

/** A component example as escaped text in an inert template, attached to shadow roots by the board script. */
const boardExample =
  (examples: Readonly<Record<string, string>>, dark: boolean) =>
  (component: SystemComponent, id: string | null): string => {
    const markup = id === null ? undefined : examples[id];
    if (markup === undefined || id === null || component.example === null) return `<div class="dc-muted">${escapeHtml("This example couldn't be shown.")}</div>`;
    // Escaped as text: inert, and it can't close the template (§5.7).
    const host = (ground: string): string => `<div class="dc-ground ${ground}"><div class="dc-example" data-dc-example-host="${id}"></div></div>`;
    let html = `<template data-dc-example="${id}">${escapeHtml(markup)}</template><div class="dc-grounds">${host('dc-light')}${dark ? host('dc-dark') : ''}</div>`;
    if (component.example.remote.length > 0) {
      html += `<div class="dc-note">${escapeHtml("This example asks for files from the internet, which don't load here:")} ${component.example.remote.map(escapeHtml).join(', ')}</div>`;
    }
    return html;
  };

// ---- areas ----

/** The sections of each area, in board order (§2.11). */
const AREA_SECTIONS: readonly { area: SystemArea; sections: readonly SystemSection[] }[] = SYSTEM_AREAS.map((area) => ({
  area,
  sections: SYSTEM_SECTIONS.filter((section) => AREA_OF_SECTION[section] === area),
}));

const areaBlock = (area: SystemArea, sections: string): string =>
  `<div class="dc-area" id="dc-area-${area}" data-dc-area="${area}" role="group" aria-label="${escapeHtml(AREA_TITLES[area])}">` +
  `<p class="dc-area-title" aria-hidden="true">${escapeHtml(AREA_TITLES[area])}</p>${sections}</div>`;

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
  // A component card whose example is wider than its column spans the board instead (measured with the card narrow, again on resize).
  var cards = document.querySelectorAll('.dc-components > .dc-card');
  var wider = function (host) {
    var root = host.shadowRoot;
    if (!root) return false;
    if (host.scrollWidth > host.clientWidth + 1) return true;
    var edge = host.getBoundingClientRect().right + 1;
    var all = root.querySelectorAll('*');
    for (var k = 0; k < all.length; k += 1) {
      var box = all[k].getBoundingClientRect();
      if (box.width > 0 && box.right > edge) return true;
    }
    return false;
  };
  var widen = function () {
    var k;
    for (k = 0; k < cards.length; k += 1) cards[k].classList.remove('dc-wide');
    var flagged = [];
    for (k = 0; k < cards.length; k += 1) {
      var inside = cards[k].querySelectorAll('[data-dc-example-host]');
      for (var m = 0; m < inside.length; m += 1) {
        if (wider(inside[m])) { flagged.push(cards[k]); break; }
      }
    }
    for (k = 0; k < flagged.length; k += 1) flagged[k].classList.add('dc-wide');
  };
  var frame = 0;
  window.addEventListener('resize', function () {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () { frame = 0; widen(); });
  });
  if (cards.length > 0) widen();
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
  const specimen = { unusable, example: boardExample(examples, hasDark(detail)) };
  const areas = AREA_SECTIONS.map(({ area, sections }) => areaBlock(area, sections.map((section) => renderSpecimenSection(detail, section, specimen)).join('')));
  const body = [heading, sub, ...areas].join('');
  return documentOf(title, options.scheme, specimenSystemCss(detail, unusable), body, true);
};
