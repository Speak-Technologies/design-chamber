// Static design checks (documentation/specs/agent-render-and-check.md §4.2): what can be known
// from the files alone, with no browser. Run by the CLI, by `--static`, and by the service on
// every change. The pure parts (hygiene, tokens, screen set, keys) are exported for tests;
// `runStaticChecks` reads the design folder only through the bundler's contained file source.

import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { DESIGN_JSON_FILE, ENTRY_FILE, normalizeKind, parseDesignJsonText } from '../../shared/design-json.ts';
import { CHECK_DETAIL_MAX, CHECK_FINDINGS_MAX, CHECK_TOKEN_LITERALS_MIN, SCREEN_ID_PATTERN } from '../../shared/limits.ts';
import { cleanDetail, normalizeExternalUrl } from '../../shared/checks.ts';
import { readTweakValues } from '../../shared/tokens-css.ts';
import type { CheckCode, CheckFindingData, DesignJson, DesignKind, Tweak } from '../../shared/types.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, createLiveFileSource, type BundleInput } from '../bundle.ts';
import { capPerCode } from './analyze.ts';

/** Raw HTML read for the hygiene checks. */
const HYGIENE_BYTES = 256 * 1024;
const TOKENS_BYTES = 512 * 1024;
/** Canvas screen files looked at, listed or on disk. */
export const SCREEN_FILES_MAX = 60;

// ---- keys (what a render check was based on) ----

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** sha256 of the entry path plus the sorted `rel:size:mtimeMs` of every file its bundle read. */
export const entryKeyOf = (rel: string, inputs: readonly BundleInput[]): string =>
  sha256(`${rel}\n${inputs.map((input) => `${input.rel}:${input.size}:${input.mtimeMs}`).sort().join('\n')}`);

// ---- document hygiene ----

const withoutComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');

/** Hygiene codes for one document's text: doctype, lang, viewport meta, title, charset. */
export const docHygiene = (text: string): CheckCode[] => {
  const html = withoutComments(text.replace(/^﻿/, ''));
  const found: CheckCode[] = [];
  if (!/^\s*<!doctype\s+html\b/i.test(html)) found.push('doc-doctype');
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag === null || !/\blang\s*=\s*["']?[A-Za-z]/i.test(htmlTag[0])) found.push('doc-lang');
  if (!/<meta\b[^>]*\bname\s*=\s*["']?viewport\b/i.test(html)) found.push('doc-viewport');
  if (!/<title\b[^>]*>\s*[^\s<]/i.test(html)) found.push('doc-title');
  if (!/<meta\b[^>]*\b(charset\s*=|http-equiv\s*=\s*["']?content-type)/i.test(html)) found.push('doc-charset');
  return found;
};

// ---- tokens ----

const COLOR_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?)\(/gi;
const CUSTOM_PROPERTY_DEFINITION = /(--[A-Za-z0-9_-]+)\s*:/g;

/** The CSS an HTML document carries itself: `<style>` blocks and `style=""` attribute values. */
const inlineCssOf = (html: string): string[] => {
  const css: string[] = [];
  for (const match of withoutComments(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css.push(match[1] ?? '');
  for (const match of withoutComments(html).matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) css.push(match[1] ?? match[2] ?? '');
  return css;
};

export type TokenFindings = {
  /** Token names tokens.css defines that the document defines again. */
  redefined: string[];
  /** Colour literals outside token definitions and `var()` fallbacks. */
  literals: string[];
  /** tokens.css defines at least one colour. */
  tokensHaveColors: boolean;
};

/** Compare a document's own CSS with `tokens.css`. */
export const tokenFindings = (input: { tokensCss: string; html: string }): TokenFindings => {
  const tokensCss = input.tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set<string>();
  let tokensHaveColors = false;
  for (const match of tokensCss.matchAll(/(--[A-Za-z0-9_-]+)\s*:([^;}]*)/g)) {
    defined.add(match[1] ?? '');
    COLOR_LITERAL.lastIndex = 0;
    if (COLOR_LITERAL.test(match[2] ?? '')) tokensHaveColors = true;
  }
  const redefined = new Set<string>();
  const literals: string[] = [];
  for (const block of inlineCssOf(input.html)) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(CUSTOM_PROPERTY_DEFINITION)) if (defined.has(match[1] ?? '')) redefined.add(match[1] ?? '');
    const bare = css
      .replace(/var\(\s*--[A-Za-z0-9_-]+\s*,[^)]*\)/g, '')
      .replace(/--[A-Za-z0-9_-]+\s*:[^;}]*/g, '');
    for (const match of bare.matchAll(COLOR_LITERAL)) literals.push(match[0]);
  }
  return { redefined: [...redefined], literals, tokensHaveColors };
};

// ---- broken knobs (Phase 2 technical design §4.7) ----

/**
 * Knobs tokens.css cannot serve, read with the same reader the Tweaks panel uses: one finding
 * per knob whose variable is missing from the top-level `:root`, whose value is a formula, or
 * whose unit differs; one design-level finding when tweaks are declared but there is no
 * tokens.css. A choice value outside the options is still tunable, so it is not broken.
 */
export const tweakFindings = (input: { tweaks: readonly Tweak[]; tokensCss: string | null }): CheckFindingData[] => {
  const { tweaks, tokensCss } = input;
  if (tweaks.length === 0) return [];
  const where = { file: DESIGN_JSON_FILE, screen: null, viewport: null };
  if (tokensCss === null) return [{ code: 'tweak-broken', ...where, params: { tweak: 'no-tokens' } }];
  const out: CheckFindingData[] = [];
  for (const state of readTweakValues(tokensCss, tweaks)) {
    // `ok` and `value` are tunable; `no-file` cannot happen here (tokensCss is not null).
    if (state.state === 'missing' || state.state === 'formula' || state.state === 'unit') {
      out.push({ code: 'tweak-broken', ...where, params: { tweak: state.state, field: state.var } });
    }
  }
  return out;
};

// ---- screen set ----

const VIEWPORT_SUFFIX = /^(.+)-(phone|mobile|tablet|desktop|laptop)$/;

/** design.json screens against the `screens/*.html` files on disk. */
export const screenSetFindings = (input: { design: DesignJson | null; screenFiles: readonly string[] }): CheckFindingData[] => {
  const { design } = input;
  const out: CheckFindingData[] = [];
  const onDisk = new Set(input.screenFiles);
  const listed = design?.screens ?? [];
  const listedFiles = new Set(listed.map((screen) => screen.file));
  if (design !== null) {
    for (const screen of listed) {
      if (!onDisk.has(screen.file)) out.push({ code: 'screen-file-missing', file: screen.file, screen: screen.id, viewport: null });
    }
    for (const file of input.screenFiles) {
      if (!listedFiles.has(file)) out.push({ code: 'screen-unlisted', file, screen: null, viewport: null });
    }
  }
  const ids = new Set<string>([...listed.map((screen) => screen.id), ...input.screenFiles.map((file) => path.posix.basename(file, '.html'))]);
  for (const id of [...ids].sort()) {
    const match = VIEWPORT_SUFFIX.exec(id);
    const base = match?.[1];
    if (base !== undefined && ids.has(base)) out.push({ code: 'screen-per-viewport', file: `screens/${id}.html`, screen: SCREEN_ID_PATTERN.test(id) ? id : null, viewport: null, params: { base } });
  }
  return out;
};

// ---- the run ----

export type StaticRun = {
  findings: CheckFindingData[];
  keys: { design: string; entries: Record<string, string> };
  /** The normalised design.json (defaults when it is missing or unreadable). */
  design: DesignJson;
  /** True when `design.json` was found and parsed as JSON. */
  designFound: boolean;
  kind: DesignKind;
  /** Entry documents that exist, in wall order. */
  entries: { rel: string; screen: string | null }[];
  /** The budget ran out before every file was checked. */
  partial: boolean;
};

const isRegularFile = async (file: string): Promise<boolean> => (await lstat(file).catch(() => null))?.isFile() === true;

/** `screens/*.html` regular files (no links), name order, at most `SCREEN_FILES_MAX`. */
const listScreenFiles = async (designDir: string): Promise<string[]> => {
  const dir = path.join(designDir, 'screens');
  const info = await lstat(dir).catch(() => null);
  if (info === null || !info.isDirectory()) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && /\.html$/i.test(entry.name))
    .map((entry) => `screens/${entry.name}`)
    .sort()
    .slice(0, SCREEN_FILES_MAX);
};

const limited = (findings: CheckFindingData[]): CheckFindingData[] => capPerCode(findings).slice(0, CHECK_FINDINGS_MAX);

/**
 * Check the files of one design folder. `designDir` is already a contained design folder
 * (the CLI's `resolveTarget`, the service's `store.get`); every read inside it goes through the
 * bundler's file source, which refuses links and paths that leave the folder.
 */
export const runStaticChecks = async (designDir: string, budgetMs: number, clock: () => number = Date.now): Promise<StaticRun> => {
  const started = clock();
  const source = createLiveFileSource(designDir);
  const findings: CheckFindingData[] = [];

  const designFile = await source.read(DESIGN_JSON_FILE).catch(() => null);
  const designText = designFile === null ? null : designFile.bytes.toString('utf8');
  const screenFiles = await listScreenFiles(designDir);
  const hasEntry = await isRegularFile(path.join(designDir, ENTRY_FILE));
  const guessedKind: DesignKind = screenFiles.length > 0 && !hasEntry ? 'canvas' : 'page';
  const fallbackTime = new Date(0).toISOString();

  let designFound = false;
  let parsed = parseDesignJsonText('{}', { kind: guessedKind, fallbackTitle: path.basename(designDir), fallbackTime });
  if (designText === null) {
    findings.push({ code: 'design-json-missing', file: DESIGN_JSON_FILE, screen: null, viewport: null });
  } else {
    designFound = true;
    let raw: unknown = null;
    try {
      raw = JSON.parse(designText.charCodeAt(0) === 0xfeff ? designText.slice(1) : designText);
    } catch (error) {
      findings.push({ code: 'design-json-invalid', file: DESIGN_JSON_FILE, screen: null, viewport: null, detail: cleanDetail(error instanceof Error ? error.message : 'unreadable', CHECK_DETAIL_MAX) });
    }
    if (raw !== null) {
      const recordKind = typeof raw === 'object' && !Array.isArray(raw) ? normalizeKind((raw as { kind?: unknown }).kind) : null;
      parsed = parseDesignJsonText(designText, { kind: recordKind ?? guessedKind, fallbackTitle: path.basename(designDir), fallbackTime });
      for (const warning of parsed.warnings) {
        if (warning.field !== undefined && /^[A-Za-z0-9_.[\]-]{1,80}$/.test(warning.field)) {
          findings.push({ code: 'design-json-field', file: DESIGN_JSON_FILE, screen: null, viewport: null, params: { field: warning.field } });
        }
      }
    }
  }
  const { design } = parsed;
  const kind = design.kind;

  findings.push(...screenSetFindings({ design: designFound ? design : null, screenFiles }));
  if (kind === 'page' && !hasEntry) findings.push({ code: 'entry-missing', file: ENTRY_FILE, screen: null, viewport: null });

  // Entry documents in wall order: listed screens that exist, then the unlisted ones on disk.
  const onDisk = new Set(screenFiles);
  const entries: StaticRun['entries'] =
    kind === 'page'
      ? hasEntry
        ? [{ rel: ENTRY_FILE, screen: null }]
        : []
      : [
          ...design.screens.filter((screen) => onDisk.has(screen.file)).map((screen) => ({ rel: screen.file, screen: screen.id })),
          ...screenFiles.filter((file) => !design.screens.some((screen) => screen.file === file)).map((file) => ({ rel: file, screen: null })),
        ];

  const tokensFile = await source.read('tokens.css').catch(() => null);
  const tokensCss = tokensFile === null ? null : tokensFile.bytes.subarray(0, TOKENS_BYTES).toString('utf8');
  findings.push(...tweakFindings({ tweaks: design.tweaks, tokensCss }));

  const keys: StaticRun['keys'] = { design: sha256(designFile?.bytes ?? ''), entries: {} };
  let partial = false;
  for (const entry of entries) {
    if (clock() - started > budgetMs) {
      partial = true;
      break;
    }
    const where = { file: entry.rel, screen: entry.screen, viewport: null };
    try {
      const bundle = await bundleDocument(source, entry.rel, { mode: 'export' });
      keys.entries[entry.rel] = entryKeyOf(entry.rel, bundle.inputs);
      for (const ref of bundle.missing) findings.push({ code: 'ref-missing', ...where, detail: cleanDetail(ref, CHECK_DETAIL_MAX) });
      for (const ref of bundle.blocked) findings.push({ code: 'ref-outside', ...where, detail: cleanDetail(ref, CHECK_DETAIL_MAX) });
      for (const url of bundle.external) findings.push({ code: 'remote-ref', ...where, detail: cleanDetail(normalizeExternalUrl(url) ?? url, CHECK_DETAIL_MAX) });
      if (bundle.warnings.some((warning) => warning.code === 'module-import')) findings.push({ code: 'module-import', ...where });
    } catch (error) {
      if (error instanceof BundleTooLarge) findings.push({ code: 'render-failed', ...where, detail: 'over 60 MB' });
      else if (!(error instanceof BundleMissingEntry)) throw error;
      continue;
    }
    const raw = await source.read(entry.rel).catch(() => null);
    if (raw === null) continue;
    const text = raw.bytes.subarray(0, HYGIENE_BYTES).toString('utf8');
    for (const code of docHygiene(text)) findings.push({ code, ...where });
    if (tokensCss !== null) {
      const tokens = tokenFindings({ tokensCss, html: text });
      if (tokens.redefined.length > 0) {
        findings.push({ code: 'token-redefined', ...where, params: { count: tokens.redefined.length }, detail: cleanDetail(tokens.redefined.slice(0, 3).join(', '), CHECK_DETAIL_MAX) });
      }
      if (tokens.tokensHaveColors && tokens.literals.length >= CHECK_TOKEN_LITERALS_MIN) {
        findings.push({ code: 'token-hardcoded', ...where, params: { count: tokens.literals.length }, detail: cleanDetail(tokens.literals.slice(0, 3).join(', '), CHECK_DETAIL_MAX) });
      }
    }
  }
  if (partial) findings.push({ code: 'check-partial', file: null, screen: null, viewport: null });

  return { findings: limited(findings), keys, design, designFound, kind, entries, partial };
};
