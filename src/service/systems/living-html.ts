// The living page document (documentation/specs/phase-2-5-technical.md §5.11, §2.14, rev 3). Pure: no
// service imports, so the CLI check can bundle it.
//
// The page is the system's own document, served outside OpenChamber, so its framing uses fixed greys
// and never a host token. It holds exactly what `scanLivingPage` (`living-safe.ts`) allows: the four
// areas through the shared section renderers (`specimen-html.ts`), with each element's declarations
// turned into generated classes (no `style` attribute), component examples as PNG `<img>`s, embedded
// fonts as quoted `data:` URLs in the one `<style>`, a contents list of `#` links, and the footer.
// Every string from the system is escaped text; a CSS line that the allowlist would refuse is left out.
//
// The text is emitted already normalised (§2.14): LF only, no tab, no trailing blank, one final LF.
// While writing, the generator records which entry each stretch of text came from (`brand:press`,
// `note:voice`, `token:--x`), so a secret shape found later is reported by its entry, never by value.

import { LIVING_PAGE_MARK_NAME, SYSTEM_ENTRY_ID_PATTERN, SYSTEM_TOKEN_NAME_PATTERN } from '../../shared/limits.ts';
import { darkVarOf, typeVarOf } from '../../shared/system-board.ts';
import { AREA_OF_SECTION, screenAreaOf, SYSTEM_AREAS, SYSTEM_SECTIONS } from '../../shared/system-json.ts';
import type { SystemArea, SystemDetail, SystemSection } from '../../shared/types.ts';
import { LIVING_VIEWPORT, livingCssProblems } from './living-safe.ts';
import { markdownCss } from './markdown-html.ts';
import { AREA_TITLES, CURRENT_COLOR_CSS, escapeHtml, GROUND_TEXT, renderSpecimenSection, specimenSystemCss, type ExampleEntry } from './specimen-html.ts';

/** The virtual entry the living page is bundled from (never a file on disk). */
export const LIVING_ENTRY_FILE = '__living.html';

export type ExampleReason = 'no-browser' | 'render-failed' | 'too-large' | 'budget';

/** The sentence a component card shows for an example with no picture (§5.11). */
export const EXAMPLE_REASON_SENTENCES: Readonly<Record<ExampleReason, string>> = Object.freeze({
  'no-browser': "Chrome or Edge isn't available.",
  'render-failed': "It couldn't be drawn.",
  'too-large': 'The picture is too large.',
  budget: 'The page would be too large.',
});

export const FONTS_EMBEDDED_LINE = 'Fonts are embedded; check their licences before publishing.';
export const FONTS_FALLBACK_LINE = "Fonts aren't embedded; specimens use fallback fonts. Turn on Embed fonts in Design Chamber if their licences allow it.";
export const FONT_TOO_LARGE_SENTENCE = 'This font is too large to embed; specimens use the fallback.';
export const VALUES_IN_CODE_LINE = 'These are the values the code uses.';
export const DESCRIBE_MODE_LINE = 'This page describes the intended system. The code was left unchanged and may differ.';

/** One example picture, already a PNG; `width`/`height` are CSS pixels. */
export type LivingExampleShot = {
  scheme: 'light' | 'dark';
  png: { base64: string; width: number; height: number } | null;
  reason: ExampleReason | null;
};

export type LivingPageInput = {
  revision: number;
  /** `state.revision.at`, never "now": the page is deterministic for a revision. */
  generatedAt: string;
  coverage: SystemArea[];
  /** Absolute paths shown text must not carry (the designs root, the repo, the home folder). */
  redact: string[];
  /** AD-32: whether fonts are embedded (`dev` access or the user's switch). Default `fallback`. */
  fonts?: 'embedded' | 'fallback';
  /** Embedded font faces, file → `data:font/…;base64,…` (used only when `fonts` is `embedded`). */
  fontData?: Readonly<Record<string, string>>;
  /** Fonts that were meant to be embedded but were left out, with why. */
  fontsLeftOut?: readonly { file: string; reason: 'too-large' | 'budget' | 'unsafe' }[];
  /** Font and logo files (`assets/…`) that can't be used (refused by `checkAsset`, a type the page can't carry, over budget). */
  unusable?: ReadonlySet<string>;
  /** Icon files tinted to the ground's text colour (`paintsOnlyCurrentColor`). */
  tinted?: ReadonlySet<string>;
  /** Each example's pictures, by example key (`exampleKeyOf`: a component's id, `pattern:<id>`, `brand:<id>`). */
  examples?: Readonly<Record<string, readonly LivingExampleShot[]>>;
  /** A proposal preview (§5.14): no mark, and a band naming the proposal and the home it isn't from yet. */
  preview?: { proposal: string; home: string };
};

/** A stretch of the document written for one entry (`where` is the entry key, `name`, or `page`). */
export type LivingRange = { start: number; end: number; where: string };

export type LivingPageDocument = { html: string; ranges: LivingRange[] };

// ---- small pure helpers ----

const ZERO_HASH = '0'.repeat(64);

/** The mark's `content` (§2.14). */
export const livingMarkContent = (id: string, revision: number, generated: string, hash: string = ZERO_HASH): string =>
  `design-chamber/living-page@1 system=${id} revision=${revision} generated=${generated} hash=${hash}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "19 Nov 2026" (UTC); the ISO text itself when it isn't a date. */
export const footerDate = (iso: string): string => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()] ?? ''} ${at.getUTCFullYear()}`;
};

/** Light always; dark too when any token has a dark value (the grounds the page shows). */
export const livingSchemes = (detail: SystemDetail): ('light' | 'dark')[] => (detail.tokens.some((token) => token.dark !== null) ? ['light', 'dark'] : ['light']);

/** A component source path as shown: only a relative path; an absolute-looking value is left out (§5.11). */
const relativeSource = (source: string | null): string | null => {
  if (source === null) return null;
  const trimmed = source.trim();
  if (trimmed === '' || /^([/\\~]|[A-Za-z]:)/.test(trimmed) || trimmed.split(/[/\\]/).includes('..')) return null;
  return source;
};

// Mirrors `secret-shapes.ts`: a `data:` URL up to the first character that ends a URL in HTML or CSS.
const DATA_URL = /\bdata:[A-Za-z0-9.+/-]*(?:;[A-Za-z0-9=.+-]*)*,[^\s"'()<>]*/gi;

/** Apply `fn` to the text outside `data:` URLs (picture and font bytes are never rewritten). */
const outsideDataUrls = (text: string, fn: (part: string) => string): string => {
  let out = '';
  let pos = 0;
  for (const match of text.matchAll(DATA_URL)) {
    out += fn(text.slice(pos, match.index)) + match[0];
    pos = match.index + match[0].length;
  }
  return out + fn(text.slice(pos));
};

/**
 * Replaces the designs root, the repo's location and the home folder in shown text with "…" (§5.11),
 * longest first so a path inside another reads as the longer one. Both the plain and the HTML-escaped
 * spelling are replaced; `data:` URL payloads are left alone. A path shorter than two characters (a
 * bare `/`) is never a match.
 */
export const redactLocalPaths = (text: string, paths: readonly string[]): string => {
  const forms = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.replace(/[/\\]+$/, '');
    if (trimmed.length < 2) continue;
    forms.add(trimmed);
    forms.add(escapeHtml(trimmed));
  }
  if (forms.size === 0) return text;
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  return outsideDataUrls(text, (part) => {
    let out = part;
    for (const form of ordered) out = out.split(form).join('…');
    return out;
  });
};

/** LF only, a tab as a character reference, trailing blanks as references, one final LF (§2.14). */
const normaliseEmitted = (text: string): string =>
  `${text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '&#9;')
    .replace(/ +$/gm, (blanks) => '&#32;'.repeat(blanks.length))
    .replace(/\n+$/, '')}\n`;

// ---- the page's own framing (fixed greys; no host token, no url(), no `behavior`) ----

const FRAME_CSS = `:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f7f7f8; color: #1d1d1f; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 15px; line-height: 1.55; }
.lp-wrap { max-width: 1120px; margin: 0 auto; padding: 40px 32px 64px; }
.lp-header h1 { margin: 0 0 6px; font-size: 30px; font-weight: 650; letter-spacing: -0.01em; }
.lp-lede { margin: 0 0 4px; color: #3a3a40; }
.lp-sub { margin: 0; color: #62626a; font-size: 13px; }
.lp-contents { margin: 28px 0 8px; padding: 16px 20px; background: #ffffff; border: 1px solid #d8d8dc; border-radius: 8px; }
.lp-contents h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #62626a; }
.lp-contents ul { margin: 0; padding-left: 18px; }
.lp-contents ul ul { padding-left: 16px; }
.lp-contents a { color: #1d1d1f; }
.lp-area { padding-top: 24px; }
.lp-area-title { margin: 32px 0 0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #62626a; }
.dc-section { padding: 24px 0 8px; border-top: 1px solid #d8d8dc; }
.dc-section > h2 { margin: 0 0 16px; font-size: 19px; font-weight: 600; }
.dc-section h3 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #62626a; }
.dc-empty, .dc-muted { color: #62626a; }
.dc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.dc-card { background: #ffffff; border: 1px solid #d8d8dc; border-radius: 8px; padding: 12px; min-width: 0; }
.dc-name { font-family: ui-monospace, monospace; font-size: 12px; overflow-wrap: anywhere; }
.dc-value { font-family: ui-monospace, monospace; font-size: 12px; color: #62626a; overflow-wrap: anywhere; }
.dc-note { margin-top: 4px; font-size: 12px; color: #62626a; white-space: pre-wrap; overflow-wrap: anywhere; }
.dc-problem { margin-top: 4px; font-size: 12px; }
.dc-grounds { display: flex; gap: 8px; margin-bottom: 8px; }
.dc-ground { flex: 1; padding: 8px; border-radius: 6px; background: #ffffff; color: ${GROUND_TEXT.light}; }
.dc-ground.dc-dark { background: #18181b; color: ${GROUND_TEXT.dark}; }
${CURRENT_COLOR_CSS}
.dc-swatch { height: 48px; border-radius: 4px; border: 1px solid rgb(127 127 127 / 0.3); }
.dc-hatched { background: repeating-linear-gradient(45deg, rgb(127 127 127 / 0.45) 0 2px, transparent 2px 8px); }
.dc-hatched-label { font-size: 11px; }
.dc-row { display: flex; gap: 16px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid #d8d8dc; }
.dc-row > .dc-meta { flex: 0 0 220px; min-width: 0; }
.dc-specimen { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dc-bar { height: 12px; max-width: 100%; background: currentColor; opacity: 0.7; border-radius: 2px; }
.dc-radius-box { width: 64px; height: 64px; border: 2px solid currentColor; opacity: 0.8; }
.dc-shadow-box { height: 64px; border-radius: 6px; background: #ffffff; }
.dc-stack { position: relative; height: 120px; }
.dc-layer { position: absolute; width: 140px; height: 56px; padding: 6px; border-radius: 6px; font-size: 11px; background: #ffffff; border: 1px solid #d8d8dc; overflow: hidden; }
.dc-list { margin: 0; padding-left: 18px; }
/* An icon card's two grounds stack, so every size fits the card's width (they wrap inside a ground). */
.dc-icons .dc-grounds { flex-direction: column; }
.dc-icons .dc-ground { flex: 0 0 auto; min-width: 0; }
.dc-curve { display: block; width: 96px; max-width: 100%; height: auto; margin: 0 auto; }
.dc-motion-track { padding: 4px 0; }
.dc-logo { max-width: 100%; max-height: 96px; display: block; margin: 0 auto; }
.dc-text p, .dc-body p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
/* A readable measure: guidance, overview and note text (paragraphs, markdown lists and quotes) stops at about 90 characters, whatever the layout's width. */
.dc-text p, .dc-body p, .dc-md-list, .dc-md-quote, .dc-note { max-width: 90ch; }
.dc-text-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.dc-components { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.dc-components.dc-run-compact { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.dc-run-full { display: grid; grid-template-columns: 1fr; gap: 16px; }
:is(.dc-grid, .dc-run-full, .dc-run-table, .dc-card) + :is(.dc-grid, .dc-run-full, .dc-run-table) { margin-top: 16px; }
:is(.dc-grid, .dc-run-full, .dc-run-table) + .dc-card { margin-top: 16px; }
.dc-grid.dc-run-compact { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.dc-grid.dc-text-grid.dc-run-compact { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.dc-run-compact .dc-swatch { height: 32px; }
.dc-run-table { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(0, 3fr) minmax(160px, 1.2fr); }
/* Token tables: a short sample, the token column as wide as its longest name and value (up to 420px), the note after it.
   Text tables with no notes have two columns. */
.dc-run-table.dc-table-tokens { grid-template-columns: minmax(120px, 240px) fit-content(420px) minmax(200px, 1fr); }
.dc-run-table.dc-table-two { grid-template-columns: minmax(160px, 1fr) minmax(0, 4fr); }
.dc-table-tokens .dc-tcell-preview { padding-right: 24px; }
.dc-thead, .dc-trow { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; }
.dc-thead { color: #62626a; font-size: 12px; font-weight: 600; }
.dc-thead .dc-tcell { padding: 8px 12px 8px 0; }
.dc-trow { border-bottom: 1px solid #d8d8dc; }
.dc-tcell { padding: 12px 12px 12px 0; min-width: 0; }
.dc-tcell:last-child { padding-right: 0; }
.dc-tcell > .dc-body:first-child { margin-top: 0; }
@media (max-width: 720px) {
  .dc-run-table, .dc-run-table.dc-table-tokens, .dc-run-table.dc-table-two { grid-template-columns: 1fr; }
}
.dc-body { margin-top: 8px; }
.dc-pair-grounds { flex-direction: column; }
.dc-pair-sample { padding: 10px 12px; border-radius: 4px; font-size: 16px; font-weight: 500; border: 1px solid rgb(127 127 127 / 0.3); margin-bottom: 4px; }
.lp-examples { display: grid; gap: 8px; margin-bottom: 8px; }
.lp-example { margin: 0; }
.lp-example img { display: block; max-width: 100%; height: auto; border: 1px solid #d8d8dc; border-radius: 6px; background: #ffffff; }
.lp-example figcaption { font-size: 11px; color: #62626a; margin-top: 2px; }
.lp-screens { display: grid; gap: 24px; }
.lp-screen h4 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
.lp-screen-shots { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.lp-screen-shots > .lp-example { max-width: 100%; min-width: 0; }
.lp-footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #d8d8dc; color: #62626a; font-size: 13px; }
.lp-footer p { margin: 0 0 4px; }
.lp-footer ul { margin: 4px 0 0; padding-left: 18px; }`;

// ---- the document ----

/** The sections of each area, in board order (§2.11). */
const AREA_SECTIONS: readonly { area: SystemArea; sections: readonly SystemSection[] }[] = SYSTEM_AREAS.map((area) => ({
  area,
  sections: SYSTEM_SECTIONS.filter((section) => AREA_OF_SECTION[section] === area),
}));

const SECTION_TITLES: Readonly<Record<SystemSection, string>> = {
  overview: 'Overview',
  colours: 'Colours',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Radius',
  shadows: 'Shadows',
  motion: 'Motion',
  layers: 'Layers',
  sizes: 'Sizes',
  components: 'Components',
  patterns: 'Patterns & voice',
  brand: 'Brand & marketing',
  assets: 'Assets',
};

/** The opening line by mode (§5.11, Review 🟡). */
export const openingLine = (detail: SystemDetail): string => {
  if (detail.build?.mode === 'fix' && detail.codeDrift?.differ === 0) return VALUES_IN_CODE_LINE;
  if (detail.build?.mode === 'describe') return DESCRIBE_MODE_LINE;
  const where = detail.home.kind === 'repo' ? `${detail.home.label}/${detail.home.folder}` : detail.name;
  return `These are the values in ${where}.`;
};

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'emoji', 'fangsong', 'inherit', 'initial', 'unset', '-apple-system', 'blinkmacsystemfont']);

/** The first family a type style names, when it is a real family name (not a generic, not a var()). */
const firstFamily = (stack: string): string | null => {
  const first = (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (first === '' || first.includes('(') || first.startsWith('ui-') || GENERIC_FAMILIES.has(first.toLowerCase())) return null;
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(first) ? first : null;
};

/** Fonts named by type styles with no font file in the system ("No font file for Iowan Old Style; …"). */
export const fontsWithoutFile = (detail: SystemDetail): string[] => {
  const known = new Set(detail.fonts.map((font) => font.family.toLowerCase()));
  const out: string[] = [];
  for (const style of detail.type) {
    const family = firstFamily(style.family);
    if (family === null || known.has(family.toLowerCase()) || out.includes(family)) continue;
    out.push(family);
  }
  return out;
};

const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const DATA_FONT = /^data:font\/(?:woff2|woff|ttf|otf);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A builder that remembers which entry each piece of text came from. */
const createWriter = () => {
  let html = '';
  const ranges: LivingRange[] = [];
  return {
    push(text: string, where: string | null = null): void {
      if (where !== null && text !== '') ranges.push({ start: html.length, end: html.length + text.length, where });
      html += text;
    },
    get length(): number {
      return html.length;
    },
    done(): LivingPageDocument {
      return { html, ranges };
    },
  };
};

/** The CSS custom property → the entry it belongs to, so a line of the `<style>` maps to its token or type style. */
const cssEntryMap = (detail: SystemDetail): Map<string, string> => {
  const map = new Map<string, string>();
  for (const token of detail.tokens) {
    if (!SYSTEM_TOKEN_NAME_PATTERN.test(token.name)) continue;
    map.set(token.name, `token:${token.name}`);
    map.set(darkVarOf(token.name), `token:${token.name}`);
  }
  for (const style of detail.type) {
    if (!SYSTEM_ENTRY_ID_PATTERN.test(style.id)) continue;
    for (const field of ['family', 'size', 'weight', 'lineHeight', 'letterSpacing']) map.set(typeVarOf(style.id, field), `type:${style.id}`);
  }
  return map;
};

const ENTRY_MARKS = / data-dc-(entry|section|pair)="([^"]*)"|<\/section>/g;

/**
 * Drops the board's `data-dc-entry` / `data-dc-section` / `data-dc-pair` attributes (not on the
 * allowlist) and answers the ranges each entry's text covers: from its attribute to the next entry,
 * section or section end. A pair sample's mark sits inside its entry, so it is dropped without closing it.
 */
const stripEntryMarks = (body: string): { text: string; marks: { start: number; end: number; where: string }[] } => {
  let text = '';
  let pos = 0;
  const marks: { start: number; end: number; where: string }[] = [];
  let open: { start: number; where: string } | null = null;
  const close = (): void => {
    if (open !== null && text.length > open.start) marks.push({ start: open.start, end: text.length, where: open.where });
    open = null;
  };
  for (const match of body.matchAll(ENTRY_MARKS)) {
    text += body.slice(pos, match.index);
    pos = match.index + match[0].length;
    if (match[1] === 'pair') continue;
    close();
    if (match[0] === '</section>') {
      text += match[0];
      continue;
    }
    if (match[1] === 'entry') open = { start: text.length, where: match[2] ?? 'page' };
  }
  text += body.slice(pos);
  close();
  return { text, marks };
};

const exampleFigures =
  (examples: Readonly<Record<string, readonly LivingExampleShot[]>>) =>
  (entry: ExampleEntry): string => {
    const shots = entry.key === null || !Object.hasOwn(examples, entry.key) ? [] : (examples[entry.key] ?? []);
    if (shots.length === 0) return `<p class="dc-muted">${escapeHtml(`No picture of this example: ${EXAMPLE_REASON_SENTENCES['render-failed']}`)}</p>`;
    const figures: string[] = [];
    const missing: string[] = [];
    for (const shot of shots) {
      const label = shot.scheme === 'dark' ? 'dark' : 'light';
      const png = shot.png;
      if (png !== null && /^[A-Za-z0-9+/]+={0,2}$/.test(png.base64) && Number.isInteger(png.width) && Number.isInteger(png.height)) {
        figures.push(
          `<figure class="lp-example"><img src="data:image/png;base64,${png.base64}" alt="${escapeHtml(`${entry.name} example, ${label}`)}" width="${png.width}" height="${png.height}">` +
            `<figcaption>${label === 'dark' ? 'Dark' : 'Light'}</figcaption></figure>`,
        );
        continue;
      }
      const sentence = `No picture of this example: ${EXAMPLE_REASON_SENTENCES[shot.reason ?? 'render-failed']}`;
      if (!missing.includes(sentence)) missing.push(sentence);
    }
    return (figures.length > 0 ? `<div class="lp-examples">${figures.join('')}</div>` : '') + missing.map((sentence) => `<p class="dc-muted">${escapeHtml(sentence)}</p>`).join('');
  };

/** A screen picture's key among the page's pictures; `screen:` is never part of a component id. */
export const screenShotKey = (screen: string, viewport: string): string => `screen:${screen}@${viewport}`;

/** The sentence for a screen with no picture (the board's words for an example), and why when it isn't the screen's doing. */
export const SCREEN_NOT_SHOWN_SENTENCE = "This example couldn't be shown.";

const PICTURE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The screens of one area (system-builder-depth T14): each with its title and a picture per viewport,
 * labelled with the viewport and its size. A picture only: nothing of the screen's markup is written.
 */
const screenPictures = (detail: SystemDetail, area: 'patterns' | 'brand', examples: Readonly<Record<string, readonly LivingExampleShot[]>>): string => {
  const screens = detail.screens.filter((screen) => screenAreaOf(screen.kind) === area);
  if (screens.length === 0) return '';
  const cards = screens.map((screen) => {
    const figures = (screen.viewports ?? detail.viewports).map((viewport) => {
      const key = screenShotKey(screen.id, viewport.id);
      const shot = Object.hasOwn(examples, key) ? examples[key]?.[0] : undefined;
      const png = shot?.png ?? null;
      const reason = shot?.reason ?? 'render-failed';
      const picture =
        png !== null && PICTURE.test(png.base64) && Number.isInteger(png.width) && Number.isInteger(png.height)
          ? `<img src="data:image/png;base64,${png.base64}" alt="${escapeHtml(`${screen.title}, ${viewport.label}`)}" width="${png.width}" height="${png.height}">`
          : `<p class="dc-muted">${escapeHtml(reason === 'render-failed' ? SCREEN_NOT_SHOWN_SENTENCE : `${SCREEN_NOT_SHOWN_SENTENCE} ${EXAMPLE_REASON_SENTENCES[reason]}`)}</p>`;
      return `<figure class="lp-example">${picture}<figcaption>${escapeHtml(`${viewport.label} · ${viewport.width} × ${viewport.height}`)}</figcaption></figure>`;
    });
    // The mark is dropped from the page; it names the screen for a secret-shape hit in its text.
    const mark = SYSTEM_ENTRY_ID_PATTERN.test(screen.id) ? ` data-dc-entry="screen:${screen.id}"` : '';
    return `<article class="lp-screen"${mark}><h4>${escapeHtml(screen.title)}</h4><div class="lp-screen-shots">${figures.join('')}</div></article>`;
  });
  return `<h3>Screens</h3><div class="lp-screens">${cards.join('')}</div>`;
};

const PREVIEW_CSS = '.lp-preview { margin: 0; padding: 10px 24px; background: #fdf3d7; color: #4a3b0b; border-bottom: 1px solid #e6d29a; font: 600 14px/1.4 system-ui, sans-serif; }';

/** The preview's top band (§5.11 rev 3). */
export const previewBandText = (preview: { proposal: string; home: string }): string => `Preview of proposal ${preview.proposal} · not generated from ${preview.home} yet`;

/** The whole document and the entry ranges of its text (§5.11). The mark carries a zero hash. */
export const buildLivingPage = (detail: SystemDetail, input: LivingPageInput): LivingPageDocument => {
  const redact = (text: string): string => redactLocalPaths(text, input.redact);
  const embedded = input.fonts === 'embedded';
  const unusable = input.unusable ?? new Set<string>();
  // Sources are never listed; a component's source only when it is a relative path; coverage as given.
  const shown: SystemDetail = {
    ...detail,
    coverage: input.coverage,
    sourceFiles: [],
    components: detail.components.map((component) => ({ ...component, source: relativeSource(component.source) })),
  };

  // Per-element declarations become classes (the allowlist has no `style` attribute).
  const classes = new Map<string, string>();
  const styleClass = (declarations: string): string => {
    const known = classes.get(declarations);
    if (known !== undefined) return known;
    const name = `lp-s${classes.size + 1}`;
    classes.set(declarations, name);
    return name;
  };

  // The body, with the board's entry marks, then the marks turned into ranges.
  const areas: string[] = [];
  for (const { area, sections } of AREA_SECTIONS) {
    const rendered = sections.map((section) => renderSpecimenSection(shown, section, { unusable, tinted: input.tinted ?? new Set<string>(), still: true, styleClass, markdown: 'living', example: exampleFigures(input.examples ?? {}), screens: (area) => screenPictures(shown, area, input.examples ?? {}) })).join('\n');
    areas.push(`<div class="lp-area" id="lp-area-${area}" role="group" aria-label="${escapeHtml(AREA_TITLES[area])}"><p class="lp-area-title" aria-hidden="true">${escapeHtml(AREA_TITLES[area])}</p>\n${rendered}\n</div>`);
  }
  const { text: body, marks } = stripEntryMarks(redact(areas.join('\n')));

  // The system's CSS: tokens and type fields as custom properties; faces only when fonts are embedded.
  const entryOfVar = cssEntryMap(detail);
  const cssLines: { text: string; where: string | null }[] = [];
  const addCss = (text: string, where: string | null): void => {
    if (livingCssProblems(text).length === 0) cssLines.push({ text, where });
  };
  addCss(`${FRAME_CSS}\n${markdownCss('living', 'light')}`, null);
  if (input.preview !== undefined) addCss(PREVIEW_CSS, null);
  // `specimenSystemCss` writes faces as relative URLs; the page writes its own, so every file is passed as unusable there.
  const systemCss = specimenSystemCss(detail, new Set(detail.fonts.map((font) => font.file)));
  for (const line of systemCss.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('@font-face')) continue;
    const name = /^(--[A-Za-z0-9_-]+)\s*:/.exec(trimmed)?.[1];
    addCss(trimmed, name === undefined ? null : (entryOfVar.get(name) ?? null));
  }
  if (embedded) {
    detail.fonts.forEach((font, index) => {
      const data = input.fontData?.[font.file];
      if (data === undefined || !DATA_FONT.test(data) || unusable.has(font.file) || !FONT_FAMILY.test(font.family)) return;
      const weight = Number.isInteger(font.weight) && font.weight >= 1 && font.weight <= 1000 ? font.weight : 400;
      addCss(`@font-face { font-family: "${font.family}"; src: url("${data}"); font-weight: ${weight}; font-style: ${font.style === 'italic' ? 'italic' : 'normal'}; font-display: block; }`, `font:${index}`);
    });
  }
  for (const [declarations, name] of classes) addCss(`.${name} { ${declarations}; }`, null);

  // Font notes for the footer.
  const fontNotes: string[] = [];
  for (const left of input.fontsLeftOut ?? []) {
    const font = detail.fonts.find((candidate) => candidate.file === left.file);
    if (font !== undefined) fontNotes.push(`${font.family}: ${FONT_TOO_LARGE_SENTENCE}`);
  }
  for (const family of fontsWithoutFile(detail)) fontNotes.push(`No font file for ${family}; specimens use the fallback.`);

  const name = redact(detail.name);
  const markContent = livingMarkContent(detail.id, input.revision, input.generatedAt);
  const contents = AREA_SECTIONS.map(
    ({ area, sections }) =>
      `<li><a href="#lp-area-${area}">${escapeHtml(AREA_TITLES[area])}</a><ul>${sections.map((section) => `<li><a href="#dc-section-${section}">${escapeHtml(SECTION_TITLES[section])}</a></li>`).join('')}</ul></li>`,
  ).join('');

  const w = createWriter();
  w.push(`<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${input.preview === undefined ? `<meta name="${LIVING_PAGE_MARK_NAME}" content="${markContent}">\n` : ''}`);
  w.push(`<meta name="viewport" content="${LIVING_VIEWPORT}">\n<title>`);
  w.push(escapeHtml(`${name} design system`), 'name');
  w.push('</title>\n<style>\n');
  for (const line of cssLines) w.push(`${line.text}\n`, line.where);
  w.push('</style>\n</head>\n<body>\n');
  if (input.preview !== undefined) w.push(`<p class="lp-preview" role="note">${escapeHtml(previewBandText(input.preview))}</p>\n`);
  w.push('<div class="lp-wrap">\n<header class="lp-header"><h1>');
  w.push(escapeHtml(name), 'name');
  w.push(`</h1>\n<p class="lp-lede">${escapeHtml(redact(openingLine(detail)))}</p>\n`);
  w.push(`<p class="lp-sub">${escapeHtml(`Revision ${input.revision} · ${footerDate(input.generatedAt)}`)}</p>\n</header>\n`);
  w.push(`<nav class="lp-contents" aria-label="Contents"><h2>Contents</h2><ul>${contents}</ul></nav>\n<main>\n`);
  let at = 0;
  for (const mark of marks) {
    w.push(body.slice(at, mark.start));
    w.push(body.slice(mark.start, mark.end), mark.where);
    at = mark.end;
  }
  w.push(body.slice(at));
  w.push('\n</main>\n<footer class="lp-footer">\n<p>');
  w.push(escapeHtml(`${name} · revision ${input.revision} · generated ${footerDate(input.generatedAt)}`), 'name');
  w.push(`</p>\n<p>${escapeHtml(embedded ? FONTS_EMBEDDED_LINE : FONTS_FALLBACK_LINE)}</p>\n`);
  if (fontNotes.length > 0) w.push(`<ul>${fontNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>\n`);
  w.push('</footer>\n</div>\n</body>\n</html>\n');

  const doc = w.done();
  // Already in normal form unless system text carried a tab, a CR or trailing blanks; then the ranges are
  // recomputed by re-normalising each stretch (references only lengthen text, never move order).
  const normal = normaliseEmitted(doc.html);
  if (normal === doc.html) return doc;
  const out = createWriter();
  const bounds = [...doc.ranges].sort((a, b) => a.start - b.start);
  let pos = 0;
  const piece = (text: string): string => text.replace(/\r\n?/g, '\n').replace(/\t/g, '&#9;');
  for (const range of bounds) {
    out.push(piece(doc.html.slice(pos, range.start)));
    out.push(piece(doc.html.slice(range.start, range.end)), range.where);
    pos = range.end;
  }
  out.push(piece(doc.html.slice(pos)));
  const pieced = out.done();
  const final = normaliseEmitted(pieced.html);
  // Trailing-blank references lengthen lines; ranges stay ordered, so a hit maps to the nearest preceding range start.
  return { html: final, ranges: pieced.ranges };
};

/** The document alone (§5.11). */
export const buildLivingPageHtml = (detail: SystemDetail, input: LivingPageInput): string => buildLivingPage(detail, input).html;

/**
 * The entry a secret-shape hit at `index` came from: the range holding it, else the nearest range that
 * starts before it in the same stretch, else `page`.
 */
export const entryAt = (ranges: readonly LivingRange[], index: number): string => {
  let best: LivingRange | null = null;
  for (const range of ranges) {
    if (index >= range.start && index < range.end) return range.where;
    if (range.start <= index && (best === null || range.start > best.start)) best = range;
  }
  return best !== null && index - best.end < 64 ? best.where : 'page';
};
