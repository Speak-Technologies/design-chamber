// Design checks, the pure half (documentation/specs/agent-render-and-check.md §2.2, §4.5): the
// ONE place a finding's severity and sentence come from. A finding on disk (`check.json`) is
// `{ code, file, screen, viewport, params, detail, selector }`; anything else in that file is
// dropped, so a forged report can neither choose a severity nor put its own sentence in the UI.
// `detail` and `selector` are the only strings that carry design text: cleaned and clipped here,
// shown as data. No Node imports: the guests can import this file.

import {
  CHECK_DETAIL_MAX,
  CHECK_FILE_MAX_BYTES,
  CHECK_FINDINGS_MAX,
  CHECK_RUN_BUDGET_MS,
  CHECK_SELECTOR_MAX,
  SCREEN_ID_PATTERN,
  SHA256_PATTERN,
  SLUG_PATTERN,
  VIEWPORT_ID_PATTERN,
} from './limits.ts';
import type {
  ArtboardCheck,
  CheckBrowser,
  CheckCode,
  CheckFinding,
  CheckFindingData,
  CheckParams,
  CheckReport,
  CheckSeverity,
  RenderCheckState,
  Viewport,
} from './types.ts';

// ---- code table ----

type CodeRule = { severity: CheckSeverity; sentence: (f: CheckFindingData, where: string) => string };

const num = (value: number | undefined, digits = 0): string => (value === undefined ? '?' : digits === 0 ? String(Math.round(value)) : value.toFixed(digits));
const fileOf = (f: CheckFindingData): string => f.file ?? 'This design';

/** Why artboards were left out, in the reason's own words; the limit case says how to check the rest. */
const skippedSentence = (f: CheckFindingData): string => {
  const count = Math.round(f.params?.count ?? 0);
  const what = `${count} ${count === 1 ? 'artboard was' : 'artboards were'} not rendered`;
  if (f.params?.reason === 'budget') return `${what} (the run took longer than ${Math.round(CHECK_RUN_BUDGET_MS / 1000)} seconds).`;
  if (f.params?.reason === 'failures') return `${what} (the browser failed three times in a row).`;
  return `${what} (the limit is ${num(f.params?.max)} per run). Use --screen <id> to check the rest.`;
};

/** `<file> @ <Label> <w>×<h>` is built by `whereOf`; the table only places it in a sentence. */
const RULES: Readonly<Record<CheckCode, CodeRule>> = {
  'overflow-x': { severity: 'error', sentence: (f, where) => `${where}: the content is ${num(f.params?.px)}px wide, wider than the ${num(f.params?.width)}px viewport.` },
  'text-clipped': { severity: 'warning', sentence: (_f, where) => `${where}: some text is cut off.` },
  'text-overlap': { severity: 'warning', sentence: (_f, where) => `${where}: two pieces of text overlap.` },
  contrast: {
    severity: 'error',
    sentence: (f, where) => `${where}: text contrast is ${num(f.params?.ratio, 1)}:1, below the ${num(f.params?.min, 1)}:1 that WCAG AA asks for.`,
  },
  'img-alt': { severity: 'error', sentence: (_f, where) => `${where}: an image has no alt text.` },
  'control-label': { severity: 'error', sentence: (_f, where) => `${where}: a form field has no label.` },
  'button-name': { severity: 'error', sentence: (_f, where) => `${where}: a button or link has no name.` },
  'screen-tall': { severity: 'warning', sentence: (f, where) => `${where}: this screen is ${num(f.params?.ratio, 1)} viewports tall. Split it into several screens.` },
  'page-height': { severity: 'info', sentence: (f, where) => `${where}: the page is ${num(f.params?.px)}px tall.` },
  'console-error': { severity: 'error', sentence: (_f, where) => `${where}: a script error.` },
  'request-blocked': { severity: 'error', sentence: (_f, where) => `${where}: a request to the internet was blocked.` },
  'dialog-opened': { severity: 'info', sentence: (_f, where) => `${where}: the page opened an alert or confirm box.` },
  'render-failed': { severity: 'error', sentence: (_f, where) => `${where} could not be rendered.` },
  'render-timeout': { severity: 'warning', sentence: (_f, where) => `${where} took too long to render and was skipped.` },
  'render-skipped': { severity: 'info', sentence: (f) => skippedSentence(f) },
  'browser-missing': { severity: 'info', sentence: () => 'No Chrome, Edge or Chromium was found, so nothing was rendered.' },
  'design-json-missing': { severity: 'error', sentence: () => 'design.json is missing. Write it before the HTML.' },
  'design-json-invalid': { severity: 'error', sentence: () => 'design.json is not valid JSON.' },
  'design-json-field': { severity: 'warning', sentence: (f) => `design.json: "${f.params?.field ?? '?'}" was ignored.` },
  'screen-file-missing': { severity: 'error', sentence: (f) => `${fileOf(f)} is listed in design.json but does not exist.` },
  'screen-unlisted': { severity: 'warning', sentence: (f) => `${fileOf(f)} is not in design.json screens, so the wall does not show it.` },
  'screen-per-viewport': {
    severity: 'warning',
    sentence: (f) => `${fileOf(f)} looks like a device copy of "${f.params?.base ?? '?'}". Use one responsive file per screen.`,
  },
  'entry-missing': { severity: 'error', sentence: () => 'index.html is missing.' },
  'ref-missing': { severity: 'error', sentence: (f) => `${fileOf(f)} links to a file that does not exist.` },
  'ref-outside': { severity: 'error', sentence: (f) => `${fileOf(f)} links to a file outside the design folder.` },
  'remote-ref': { severity: 'error', sentence: (f) => `${fileOf(f)} loads a file from the internet, which the viewer blocks.` },
  'module-import': { severity: 'warning', sentence: (f) => `${fileOf(f)} imports another script file, which can't load here.` },
  'doc-doctype': { severity: 'warning', sentence: (f) => `${fileOf(f)} does not start with <!doctype html>.` },
  'doc-lang': { severity: 'warning', sentence: (f) => `${fileOf(f)} has no lang on <html>.` },
  'doc-viewport': { severity: 'warning', sentence: (f) => `${fileOf(f)} has no viewport meta tag.` },
  'doc-title': { severity: 'warning', sentence: (f) => `${fileOf(f)} has no <title>.` },
  'doc-charset': { severity: 'info', sentence: (f) => `${fileOf(f)} does not declare its charset.` },
  'token-redefined': { severity: 'warning', sentence: (f) => `${fileOf(f)} redefines ${num(f.params?.count)} tokens from tokens.css. Change them in tokens.css.` },
  'token-hardcoded': {
    severity: 'info',
    sentence: (f) => `${fileOf(f)} has ${num(f.params?.count)} hardcoded colours although tokens.css defines colours.`,
  },
  'tweak-broken': {
    severity: 'warning',
    sentence: (f) => {
      const field = f.params?.field ?? '?';
      if (f.params?.tweak === 'missing') return `design.json: the tweak for ${field} names a variable tokens.css does not define.`;
      if (f.params?.tweak === 'formula') return `design.json: the tweak for ${field} points at a formula in tokens.css (calc() or var()), so it can't be tuned.`;
      if (f.params?.tweak === 'unit') return `design.json: the tweak for ${field} uses a different unit than tokens.css.`;
      // `no-tokens`, and the fallback when a stored finding carries no reason: the one sentence that needs no params.
      return 'design.json declares tweaks, but the design has no tokens.css.';
    },
  },
  'check-partial': { severity: 'info', sentence: () => 'Some files were not checked in time.' },
};

export const CHECK_CODES: readonly CheckCode[] = Object.freeze(Object.keys(RULES) as CheckCode[]);

export const isCheckCode = (value: unknown): value is CheckCode => typeof value === 'string' && Object.hasOwn(RULES, value);

/** The severity of a code. Only this table decides it. */
export const severityOf = (code: CheckCode): CheckSeverity => RULES[code].severity;

/** Codes whose sentence starts with the artboard (`file @ Label w×h`) rather than a bare file. */
const ARTBOARD_CODES: ReadonlySet<CheckCode> = new Set<CheckCode>([
  'overflow-x',
  'text-clipped',
  'text-overlap',
  'contrast',
  'img-alt',
  'control-label',
  'button-name',
  'screen-tall',
  'page-height',
  'console-error',
  'request-blocked',
  'dialog-opened',
  'render-failed',
  'render-timeout',
]);

/** `screens/home.html @ Phone 390×844`, or the file alone when the viewport is not known. */
export const whereOf = (finding: CheckFindingData, viewports: readonly Pick<Viewport, 'id' | 'label' | 'width' | 'height'>[]): string => {
  const file = finding.file ?? 'This design';
  if (finding.viewport === null) return file;
  const viewport = viewports.find((candidate) => candidate.id === finding.viewport);
  return viewport === undefined ? `${file} @ ${finding.viewport}` : `${file} @ ${viewport.label} ${viewport.width}×${viewport.height}`;
};

/** The sentence for a finding, from `code` and `params` only. */
export const findingMessage = (finding: CheckFindingData, viewports: readonly Pick<Viewport, 'id' | 'label' | 'width' | 'height'>[] = []): string =>
  RULES[finding.code].sentence(finding, ARTBOARD_CODES.has(finding.code) ? whereOf(finding, viewports) : fileOf(finding));

/** A stored finding with the severity and sentence the service derives from its code. */
export const withMessage = (finding: CheckFindingData, viewports: readonly Pick<Viewport, 'id' | 'label' | 'width' | 'height'>[] = []): CheckFinding => ({
  ...finding,
  severity: severityOf(finding.code),
  message: findingMessage(finding, viewports),
});

const SEVERITY_ORDER: Readonly<Record<CheckSeverity, number>> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then notes; the original order is kept within a severity. */
export const sortFindings = <T extends { severity: CheckSeverity }>(findings: readonly T[]): T[] =>
  findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.index - b.index)
    .map((entry) => entry.finding);

export type CheckCounts = { errors: number; warnings: number; notes: number };

export const countFindings = (findings: readonly { severity: CheckSeverity }[]): CheckCounts => {
  const counts: CheckCounts = { errors: 0, warnings: 0, notes: 0 };
  for (const finding of findings) {
    if (finding.severity === 'error') counts.errors += 1;
    else if (finding.severity === 'warning') counts.warnings += 1;
    else counts.notes += 1;
  }
  return counts;
};

// ---- text from the design: cleaned, one line, clipped ----

/** Control characters and line separators become spaces; the result is trimmed and cut to `max`. */
export const cleanDetail = (text: string, max: number): string => {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

// ---- URLs ----

/**
 * One remote reference as a canonical URL, or `null` when it does not parse. Protocol-relative
 * refs (`//fonts.googleapis.com/…`) are read as https, which is how a browser outside the
 * sandbox would load them. `new URL` also drops tabs and newlines, so an entry never adds a
 * line to a prompt.
 */
export const normalizeExternalUrl = (raw: string): string | null => {
  const ref = raw.trim();
  try {
    return new URL(ref.startsWith('//') ? `https:${ref}` : ref).href;
  } catch {
    return null;
  }
};

// ---- parsing check.json (untrusted) ----

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A design-relative path with `/` separators and no `..` step. */
export const FILE_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const FIELD_PATTERN = /^[A-Za-z0-9_.[\]-]{1,80}$/;
const PNG_PATTERN = /^\.chamber\/check\/r-[0-9]{14}-[0-9a-f]{6}\/[A-Za-z0-9@._-]{1,120}\.png$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export const isDesignRelativeFile = (value: unknown): value is string =>
  typeof value === 'string' && FILE_PATTERN.test(value) && !value.split('/').some((part) => part === '..' || part === '');

const ARTBOARDS_MAX = 400;
const PNGS_MAX = 4;
const ENTRIES_MAX = 200;
const PX_MAX = 1_000_000;

const PARAM_NUMBERS = ['px', 'width', 'ratio', 'min', 'count', 'max'] as const;

const parseParams = (value: unknown): CheckParams | undefined => {
  if (!isRec(value)) return undefined;
  const out: CheckParams = {};
  for (const key of PARAM_NUMBERS) {
    const entry = value[key];
    if (typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 1e9) out[key] = entry;
  }
  if (typeof value.field === 'string' && FIELD_PATTERN.test(value.field)) out.field = value.field;
  if (typeof value.base === 'string' && SCREEN_ID_PATTERN.test(value.base)) out.base = value.base;
  if (value.reason === 'limit' || value.reason === 'budget' || value.reason === 'failures') out.reason = value.reason;
  if (value.tweak === 'missing' || value.tweak === 'formula' || value.tweak === 'unit' || value.tweak === 'no-tokens') out.tweak = value.tweak;
  return Object.keys(out).length > 0 ? out : undefined;
};

/** One stored finding, or `null` when its code, file, screen or viewport is not valid. */
export const parseFindingData = (value: unknown): CheckFindingData | null => {
  if (!isRec(value) || !isCheckCode(value.code)) return null;
  const file = value.file === null || value.file === undefined ? null : isDesignRelativeFile(value.file) ? value.file : undefined;
  if (file === undefined) return null;
  const screen = value.screen === null || value.screen === undefined ? null : typeof value.screen === 'string' && SCREEN_ID_PATTERN.test(value.screen) ? value.screen : undefined;
  if (screen === undefined) return null;
  const viewport = value.viewport === null || value.viewport === undefined ? null : typeof value.viewport === 'string' && VIEWPORT_ID_PATTERN.test(value.viewport) ? value.viewport : undefined;
  if (viewport === undefined) return null;
  const finding: CheckFindingData = { code: value.code, file, screen, viewport };
  const params = parseParams(value.params);
  if (params !== undefined) finding.params = params;
  if (typeof value.detail === 'string') {
    const detail = cleanDetail(value.detail, CHECK_DETAIL_MAX);
    if (detail !== '') finding.detail = detail;
  }
  if (typeof value.selector === 'string') {
    const selector = cleanDetail(value.selector, CHECK_SELECTOR_MAX);
    if (selector !== '') finding.selector = selector;
  }
  return finding;
};

const parseFindingList = (value: unknown): CheckFindingData[] => {
  if (!Array.isArray(value)) return [];
  const out: CheckFindingData[] = [];
  for (const entry of value) {
    if (out.length >= CHECK_FINDINGS_MAX) break;
    const finding = parseFindingData(entry);
    if (finding !== null) out.push(finding);
  }
  return out;
};

const boundedInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= PX_MAX ? Math.round(value) : null;

const parseArtboard = (value: unknown): ArtboardCheck | null => {
  if (!isRec(value)) return null;
  const screen = value.screen === null ? null : typeof value.screen === 'string' && SCREEN_ID_PATTERN.test(value.screen) ? value.screen : undefined;
  if (screen === undefined) return null;
  if (typeof value.viewport !== 'string' || !VIEWPORT_ID_PATTERN.test(value.viewport)) return null;
  const width = boundedInt(value.width);
  const height = boundedInt(value.height);
  const docHeight = boundedInt(value.docHeight);
  const ms = boundedInt(value.ms);
  if (width === null || height === null || docHeight === null || ms === null || typeof value.ok !== 'boolean') return null;
  const pngs = Array.isArray(value.pngs) ? value.pngs.filter((png): png is string => typeof png === 'string' && PNG_PATTERN.test(png)).slice(0, PNGS_MAX) : [];
  return { screen, viewport: value.viewport, width, height, docHeight, pngs, ok: value.ok, ms };
};

const RENDER_STATES: ReadonlySet<unknown> = new Set<RenderCheckState>(['done', 'partial', 'unavailable', 'failed']);
const BROWSERS: ReadonlySet<unknown> = new Set<CheckBrowser>(['chrome', 'msedge', 'chromium', 'brave', 'other']);

const parseKeys = (value: unknown): { design: string; entries: Record<string, string> } | null => {
  if (!isRec(value) || typeof value.design !== 'string' || !SHA256_PATTERN.test(value.design) || !isRec(value.entries)) return null;
  const entries: Record<string, string> = {};
  for (const [rel, key] of Object.entries(value.entries).slice(0, ENTRIES_MAX)) {
    if (isDesignRelativeFile(rel) && typeof key === 'string' && SHA256_PATTERN.test(key)) entries[rel] = key;
  }
  return { design: value.design, entries };
};

/**
 * Validate a parsed `check.json`. `null` when the whole file is unusable (not an object, wrong
 * version, bad slug or time, a render part whose state or keys cannot be trusted); inside a
 * usable report, invalid findings and artboards are dropped, never fatal.
 */
export const parseCheckReport = (value: unknown): CheckReport | null => {
  if (!isRec(value) || value.version !== 1) return null;
  if (typeof value.slug !== 'string' || !SLUG_PATTERN.test(value.slug)) return null;
  if (value.kind !== 'page' && value.kind !== 'canvas') return null;
  if (typeof value.createdAt !== 'string' || !ISO_PATTERN.test(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) return null;
  if (value.tool !== 'cli' && value.tool !== 'service') return null;
  const staticPart = isRec(value.static) ? parseFindingList(value.static.findings) : [];

  let render: CheckReport['render'] = null;
  if (value.render !== null && value.render !== undefined) {
    if (!isRec(value.render) || !RENDER_STATES.has(value.render.state)) return null;
    const keys = parseKeys(value.render.keys);
    if (keys === null) return null;
    const browser = value.render.browser === null ? null : BROWSERS.has(value.render.browser) ? (value.render.browser as CheckBrowser) : undefined;
    if (browser === undefined) return null;
    const artboards: ArtboardCheck[] = [];
    if (Array.isArray(value.render.artboards)) {
      for (const entry of value.render.artboards.slice(0, ARTBOARDS_MAX)) {
        const artboard = parseArtboard(entry);
        if (artboard !== null) artboards.push(artboard);
      }
    }
    render = {
      // Safe: membership in RENDER_STATES was checked above.
      state: value.render.state as RenderCheckState,
      browser,
      keys,
      artboards,
      skipped: boundedInt(value.render.skipped) ?? 0,
      findings: parseFindingList(value.render.findings),
    };
  }
  return { version: 1, slug: value.slug, kind: value.kind, createdAt: value.createdAt, tool: value.tool, static: { findings: staticPart }, render };
};

/** Parse the text of a `check.json`: `null` when over the size cap or not JSON. */
export const parseCheckReportText = (text: string): CheckReport | null => {
  if (text.length > CHECK_FILE_MAX_BYTES) return null;
  try {
    return parseCheckReport(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
};
