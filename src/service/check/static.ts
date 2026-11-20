// Static design checks (documentation/specs/agent-render-and-check.md §4.2): what can be known
// from the files alone, with no browser. Run by the CLI, by `--static`, and by the service on
// every change. The pure parts (hygiene, tokens, screen set, keys, the design's system) are exported
// for tests; `runStaticChecks` reads the design folder through the bundler's contained file source,
// and its design system copy (`system/`) and the linked system's state and tokens.css in
// `<root>/_systems/<id>` through readers that refuse links (Phase 2.5 §10.1). It writes nothing.

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DESIGN_JSON_FILE, ENTRY_FILE, normalizeKind, parseDesignJsonText } from '../../shared/design-json.ts';
import { CHECK_DETAIL_MAX, CHECK_FINDINGS_MAX, CHECK_TOKEN_LITERALS_MIN, SCREEN_ID_PATTERN, SYSTEM_ID_PATTERN, SYSTEM_JSON_MAX_BYTES } from '../../shared/limits.ts';
import { cleanDetail, normalizeExternalUrl } from '../../shared/checks.ts';
import { COPY_DIR, COPY_JSON_FILE, copyDrift } from '../../shared/system-copy.ts';
import { isReservedSystemId, parseSystemState, SYSTEMS_DIR } from '../../shared/system-json.ts';
import { readTweakValues } from '../../shared/tokens-css.ts';
import type { CheckCode, CheckFindingData, CopyRecord, DesignJson, DesignKind, Tweak } from '../../shared/types.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, createLiveFileSource, type BundleInput } from '../bundle.ts';
import { readTokensFile } from '../edits/ops-tokens.ts';
import { resolveInside, resolvePlainTarget, samePath } from '../paths.ts';
import { readCopyRecord } from '../store.ts';
import { hashCopyFolder } from '../systems/link.ts';
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

// ---- the design's system (Phase 2.5 technical design §10.1) ----

/** `system/COPY.json` as the check reads it (`readCopyRecord` without the bytes). */
export type CopyRead = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'ok'; record: CopyRecord };

/** A system in this Designs folder as the check sees it: its current name and status, or not there. */
export type SystemLookup = { state: 'ready' | 'draft'; name: string } | { state: 'unknown' };

export type DesignSystemInput = {
  copy: CopyRead;
  /** The linked system now (`unknown` when it is gone); ignored without a valid copy. */
  linked: SystemLookup;
  /** sha256 of every file under `system/` now. */
  copyHashes: Readonly<Record<string, string>>;
  /** `system/tokens.css` now, and the system's tokens.css when it still holds the bytes the copy started from. */
  copyCss: string | null;
  originalCss: string | null;
  /** The agent's `systemChoice` and the system it names, when there is one to judge. */
  choice: { value: string; system: SystemLookup } | null;
};

const SYSTEM_WHERE = { file: null, screen: null, viewport: null } as const;

/**
 * The design against its copy (S7-2): a copy that can't be read, files missing from it, and drift,
 * i.e. files under `system/` that differ from what COPY.json recorded. Overrides live in the design's
 * own tokens.css (where tweaks write too), never under `system/`, so they are never drift. Token drift
 * names the tokens when the system still holds the original tokens.css; otherwise the changed files
 * are counted (`part: 'system-files'`).
 */
export const designSystemFindings = (input: DesignSystemInput): CheckFindingData[] => {
  const out: CheckFindingData[] = [];
  const { copy } = input;
  if (copy.kind === 'invalid') out.push({ code: 'system-copy-invalid', file: `${COPY_DIR}/${COPY_JSON_FILE}`, screen: null, viewport: null });
  if (copy.kind === 'ok') {
    const { record } = copy;
    const system = input.linked.state === 'unknown' ? record.name : input.linked.name;
    const drift = copyDrift(record, input.copyHashes, { original: input.originalCss, current: input.copyCss });
    if (drift.missing.length > 0) {
      out.push({ code: 'system-copy-missing', ...SYSTEM_WHERE, params: { system, count: drift.missing.length }, detail: cleanDetail(drift.missing.slice(0, 3).join(', '), CHECK_DETAIL_MAX) });
    }
    // tokens.css counts by token when its tokens could be compared; a whitespace-only change is then no drift.
    const tokensCompared = input.originalCss !== null && drift.changed.includes('tokens.css');
    if (drift.tokens.length > 0) {
      out.push({ code: 'system-drift', ...SYSTEM_WHERE, params: { system, count: drift.tokens.length, revision: record.revision }, detail: cleanDetail(drift.tokens.slice(0, 3).join(', '), CHECK_DETAIL_MAX) });
    }
    const files = [...drift.changed.filter((rel) => !(tokensCompared && rel === 'tokens.css')), ...drift.extra].sort();
    if (files.length > 0) {
      out.push({ code: 'system-drift', ...SYSTEM_WHERE, params: { system, count: files.length, revision: record.revision, part: 'system-files' }, detail: cleanDetail(files.slice(0, 3).join(', '), CHECK_DETAIL_MAX) });
    }
  }
  const { choice } = input;
  const linkedToChoice = copy.kind === 'ok' && choice !== null && copy.record.id === choice.value;
  if (choice !== null && !linkedToChoice && choice.system.state !== 'ready') {
    out.push({ code: 'system-choice', file: DESIGN_JSON_FILE, screen: null, viewport: null, params: { value: choice.value, choice: choice.system.state === 'draft' ? 'draft' : 'unknown' } });
  }
  return out;
};

/**
 * `<root>/_systems/<id>` when it is a real folder reached without a link (the system store's rule),
 * with its name and status from state.json (provisional, so a draft, when that is missing or damaged).
 */
export const lookupSystem = async (root: string, id: string): Promise<SystemLookup> => {
  if (!SYSTEM_ID_PATTERN.test(id) || isReservedSystemId(id)) return { state: 'unknown' };
  const lexical = path.join(root, SYSTEMS_DIR, id);
  try {
    const real = await resolveInside(root, [SYSTEMS_DIR, id]);
    const info = await lstat(lexical);
    if (!samePath(real, lexical) || !info.isDirectory()) return { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
  let raw: unknown = null;
  try {
    // Refuses a link at `.chamber` or at state.json, so nothing outside the system folder is read.
    const stateFile = await resolvePlainTarget(lexical, ['.chamber', 'state.json']);
    const info = await lstat(stateFile);
    if (info.isFile() && info.size <= SYSTEM_JSON_MAX_BYTES) raw = JSON.parse(await readFile(stateFile, 'utf8'));
  } catch {
    raw = null; // missing or damaged: the store reads it as provisional too
  }
  const state = parseSystemState(raw, id, new Date(0).toISOString());
  return { state: state.status, name: state.name };
};

/** Everything `designSystemFindings` needs, read from a contained design folder in a contained root. */
const readDesignSystemInput = async (designDir: string, root: string, systemChoice: string | undefined): Promise<DesignSystemInput> => {
  const read = await readCopyRecord(designDir).catch(() => ({ kind: 'invalid' as const }));
  const copy: CopyRead = read.kind === 'ok' ? { kind: 'ok', record: read.record } : read;
  let linked: SystemLookup = { state: 'unknown' };
  let copyHashes: Record<string, string> = {};
  let copyCss: string | null = null;
  let originalCss: string | null = null;
  if (copy.kind === 'ok') {
    linked = await lookupSystem(root, copy.record.id);
    copyHashes = await hashCopyFolder(path.join(designDir, COPY_DIR));
    const current = await readTokensFile(designDir, [COPY_DIR, 'tokens.css']).catch(() => null);
    copyCss = current?.kind === 'read' ? current.text : null;
    if (linked.state !== 'unknown') {
      const original = await readTokensFile(root, [SYSTEMS_DIR, copy.record.id, 'tokens.css']).catch(() => null);
      if (original?.kind === 'read' && sha256(original.bytes) === copy.record.files['tokens.css']) originalCss = original.text;
    }
  }
  const choiceValue = systemChoice !== undefined && systemChoice !== 'none' && !isReservedSystemId(systemChoice) ? systemChoice : null;
  const choice = choiceValue === null ? null : { value: choiceValue, system: copy.kind === 'ok' && copy.record.id === choiceValue ? linked : await lookupSystem(root, choiceValue) };
  return { copy, linked, copyHashes, copyCss, originalCss, choice };
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

  // A design folder is a direct child of the designs root (the CLI's resolveTarget, the store), so its
  // systems are in the parent's `_systems`. With a valid copy the token checks use the system's tokens
  // too, and name the system.
  const systemInput = await readDesignSystemInput(designDir, path.dirname(designDir), designFound ? design.systemChoice : undefined);
  findings.push(...designSystemFindings(systemInput));
  const systemCss = systemInput.copy.kind === 'ok' ? (systemInput.copyCss ?? '').slice(0, TOKENS_BYTES) : null;
  const systemName = systemInput.copy.kind !== 'ok' ? undefined : systemInput.linked.state === 'unknown' ? systemInput.copy.record.name : systemInput.linked.name;
  const definedCss = systemCss === null ? tokensCss : `${systemCss}\n${tokensCss ?? ''}`;
  const systemParam = systemName === undefined ? {} : { system: systemName };

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
    if (definedCss !== null) {
      const tokens = tokenFindings({ tokensCss: definedCss, html: text });
      // The system is named only when the finding is about its tokens, not only the design's own.
      const fromSystem = systemCss === null ? null : tokenFindings({ tokensCss: systemCss, html: text });
      if (tokens.redefined.length > 0) {
        const named = fromSystem !== null && fromSystem.redefined.length > 0 ? systemParam : {};
        findings.push({ code: 'token-redefined', ...where, params: { count: tokens.redefined.length, ...named }, detail: cleanDetail(tokens.redefined.slice(0, 3).join(', '), CHECK_DETAIL_MAX) });
      }
      if (tokens.tokensHaveColors && tokens.literals.length >= CHECK_TOKEN_LITERALS_MIN) {
        const named = fromSystem?.tokensHaveColors === true ? systemParam : {};
        findings.push({ code: 'token-hardcoded', ...where, params: { count: tokens.literals.length, ...named }, detail: cleanDetail(tokens.literals.slice(0, 3).join(', '), CHECK_DETAIL_MAX) });
      }
    }
  }
  if (partial) findings.push({ code: 'check-partial', file: null, screen: null, viewport: null });

  return { findings: limited(findings), keys, design, designFound, kind, entries, partial };
};
