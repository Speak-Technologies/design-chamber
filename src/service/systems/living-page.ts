// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11, §2.14, AD-21, AD-31, AD-32): the living page.
//
// `regenerateLivingPage` builds the page from the snapshot (or, for a proposal preview, from
// `_systems/<id>/proposal/`), bundles it, checks it with the allowlist scanner and the secret-shape
// scan, and stages it at `.chamber/living-page.html` with its record `.chamber/living-page.json`. The
// agent copies the staged file into the repo; Design Chamber never writes the repo.
//
// `livingPageState` reads the committed page in the repo (read-only, never rendered) and says how it
// compares with what was generated: fresh, out of date, missing, changed, reformatted, unsafe or
// unreadable.

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  LIVING_EXAMPLE_SCALE,
  LIVING_PAGE_ASSET_MAX_BYTES,
  LIVING_PAGE_GENERATOR_VERSION,
  LIVING_PAGE_MAX_BYTES,
  LIVING_PAGE_OMITTED_MAX,
  RENDER_CHUNK_MAX_BYTES,
  SECRET_SHAPES_MAX,
  SYSTEM_PROPOSAL_ID_PATTERN,
} from '../../shared/limits.ts';
import { findSecretShapes } from '../../shared/secret-shapes.ts';
import { buildSystemDetail } from '../../shared/system-json.ts';
import type { RenderMeta } from '../../shared/api.ts';
import type { LivingPageState, LivingPageView, SecretShapeKind, SystemDetail, SystemState } from '../../shared/types.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, createLiveFileSource, type FileSource } from '../bundle.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { resolveInside, resolvePlainTarget, samePath, writeFileAtomic } from '../paths.ts';
import { splitChunks } from '../render-cache.ts';
import { checkAsset } from './assets.ts';
import { detailSourceFromTree, overlaySource } from './board.ts';
import { listFiles, proposalDirOf, readProposalFile } from './proposal-record.ts';
import { renderExamplePngs, type ExampleShot } from './living-examples.ts';
import { ICON_DRAWN_MAX_BYTES, iconCopies } from './specimen-html.ts';
import { buildLivingPage, LIVING_ENTRY_FILE, livingSchemes, type ExampleReason, type LivingExampleShot, type LivingPageDocument, type LivingPageInput, entryAt } from './living-html.ts';
import { LIVING_PAGE_SCAN_MAX_BYTES, LIVING_PAGE_TOO_LARGE_REASON, normaliseForHash, scanLivingPage } from './living-safe.ts';
import { ensureSystemStore, guardSystemWrite } from './store.ts';

export type LivingProblem = 'too-large' | 'bundle' | 'unsafe' | 'no-snapshot' | 'secret';
export type OmittedReason = 'too-large' | 'unsafe' | 'budget' | 'no-browser' | 'render-failed' | 'licence';
export type Omitted = { what: 'font' | 'logo' | 'icon' | 'example'; name: string; reason: OmittedReason };

/** `.chamber/living-page.json` (§2.14). `generator` is this build's addition: a new generator regenerates at start. */
export type LivingPageRecord = {
  v: 1;
  generator: number;
  revision: number;
  generatedAt: string;
  sha256: string | null;
  bytes: number;
  forApplied: string | null;
  omitted: Omitted[];
  problem: LivingProblem | null;
  fonts: 'embedded' | 'fallback';
  secrets: { kind: SecretShapeKind; where: string }[];
  preview: { proposal: string; sha256: string | null; problem: LivingProblem | null } | null;
};

const STAGED_HTML = 'living-page.html';
const STAGED_JSON = 'living-page.json';
const PREVIEW_HTML = 'living-page-preview.html';
const RECORD_MAX_BYTES = 256 * 1024;
const ZERO_HASH = '0'.repeat(64);
const PROBLEMS: readonly LivingProblem[] = ['too-large', 'bundle', 'unsafe', 'no-snapshot', 'secret'];
const OMITTED_REASONS: readonly OmittedReason[] = ['too-large', 'unsafe', 'budget', 'no-browser', 'render-failed', 'licence'];
const SECRET_KINDS: readonly SecretShapeKind[] = ['aws-key', 'github-token', 'openai-style-key', 'slack-token', 'google-key', 'private-key'];

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'error');

// ---- sentences (§5.11) ----

export const LIVING_UNSAFE_SENTENCE = "The living page has markup Design Chamber didn't generate and can't check as safe. Ask the agent to update it.";
export const LIVING_CHANGED_SENTENCE = 'The page in the repo differs from the one Design Chamber generated.';
export const livingMissingSentence = (repo: string): string => `No living page in ${repo} yet.`;
export const livingFreshSentence = (revision: number): string => `Generated from revision ${revision}, the current one.`;
export const livingOutOfDateSentence = (from: number, name: string, current: number): string => `Generated from revision ${from}; ${name} is at revision ${current}.`;
export const livingReformattedSentence = (revision: number): string =>
  `The living page may have been reformatted since it was generated. Its values are from revision ${revision}, the current one.`;
export const livingUnreadableSentence = (reason: string): string => `Design Chamber can't read the living page: ${reason}.`;

// ---- the record ----

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isProblem = (value: unknown): value is LivingProblem => typeof value === 'string' && (PROBLEMS as readonly string[]).includes(value);

/** The record as written by this service; anything off-shape reads as no record. */
export const parseLivingRecord = (text: string): LivingPageRecord | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || typeof raw.generatedAt !== 'string') return null;
  const omitted = Array.isArray(raw.omitted)
    ? raw.omitted
        .filter((item): item is Omitted => isRecord(item) && ['font', 'logo', 'icon', 'example'].includes(String(item.what)) && typeof item.name === 'string' && (OMITTED_REASONS as readonly string[]).includes(String(item.reason)))
        .slice(0, LIVING_PAGE_OMITTED_MAX)
        .map((item) => ({ what: item.what, name: item.name, reason: item.reason }))
    : [];
  const secrets = Array.isArray(raw.secrets)
    ? raw.secrets
        .filter((item): item is { kind: SecretShapeKind; where: string } => isRecord(item) && (SECRET_KINDS as readonly string[]).includes(String(item.kind)) && typeof item.where === 'string')
        .slice(0, SECRET_SHAPES_MAX)
        .map((item) => ({ kind: item.kind, where: item.where }))
    : [];
  const preview =
    isRecord(raw.preview) && typeof raw.preview.proposal === 'string' && SYSTEM_PROPOSAL_ID_PATTERN.test(raw.preview.proposal)
      ? {
          proposal: raw.preview.proposal,
          sha256: typeof raw.preview.sha256 === 'string' && /^[0-9a-f]{64}$/.test(raw.preview.sha256) ? raw.preview.sha256 : null,
          problem: isProblem(raw.preview.problem) ? raw.preview.problem : null,
        }
      : null;
  return {
    v: 1,
    generator: typeof raw.generator === 'number' ? raw.generator : 0,
    revision: raw.revision,
    generatedAt: raw.generatedAt,
    sha256: typeof raw.sha256 === 'string' && /^[0-9a-f]{64}$/.test(raw.sha256) ? raw.sha256 : null,
    bytes: typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : 0,
    forApplied: typeof raw.forApplied === 'string' ? raw.forApplied : null,
    omitted,
    problem: isProblem(raw.problem) ? raw.problem : null,
    fonts: raw.fonts === 'embedded' ? 'embedded' : 'fallback',
    secrets,
    preview,
  };
};

const chamberFile = async (ctx: ServiceContext, id: string, systemDir: string, name: string): Promise<string> => {
  const file = await resolvePlainTarget(systemDir, ['.chamber', name], { allowAbsent: true });
  await guardSystemWrite(ctx.settings.root(), file, id, ctx.log);
  return file;
};

export const readRecord = async (systemDir: string): Promise<LivingPageRecord | null> => {
  let file: string;
  try {
    file = await resolvePlainTarget(systemDir, ['.chamber', STAGED_JSON]);
  } catch {
    return null;
  }
  const info = await lstat(file).catch(() => null);
  if (info === null || !info.isFile() || info.size > RECORD_MAX_BYTES) return null;
  const text = await readFile(file, 'utf8').catch(() => null);
  return text === null ? null : parseLivingRecord(text);
};

const recordJson = (record: LivingPageRecord): string => `${JSON.stringify(record, null, 2)}\n`;

// ---- the pure parts ----

/** Fonts in type-style order (the first family a style names), then the rest in system order (§5.11 budget). */
export const fontsInTypeOrder = (detail: SystemDetail): SystemDetail['fonts'] => {
  const rank = (family: string): number => {
    const index = detail.type.findIndex((style) => (style.family.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase() === family.toLowerCase());
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return detail.fonts.map((font, index) => ({ font, index, rank: rank(font.family) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ font }) => font);
};

/** The length `dataUrlOf` gives `bytes` bytes as base64, with its `data:<mime>;base64,` prefix (≤ 40 characters). */
const encodedSize = (bytes: number): number => 40 + 4 * Math.ceil(bytes / 3);

/** An example shot as the page takes it: base64 and CSS pixels (the PNG is drawn at `LIVING_EXAMPLE_SCALE`). */
export const toLivingShot = (shot: ExampleShot): LivingExampleShot =>
  shot.png === null || shot.width === 0 || shot.height === 0
    ? { scheme: shot.scheme, png: null, reason: shot.reason ?? 'render-failed' }
    : {
        scheme: shot.scheme,
        png: { base64: Buffer.from(shot.png).toString('base64'), width: Math.ceil(shot.width / LIVING_EXAMPLE_SCALE), height: Math.ceil(shot.height / LIVING_EXAMPLE_SCALE) },
        reason: null,
      };

/**
 * Pictures to drop so a page `excess` bytes over the bound fits: dark ones first, then the largest
 * (§5.11 step 3). Answers `component:scheme` keys; empty when there is nothing left to drop.
 */
export const picturesToDrop = (examples: Readonly<Record<string, readonly LivingExampleShot[]>>, excess: number): string[] => {
  const candidates: { key: string; dark: boolean; size: number }[] = [];
  for (const [component, shots] of Object.entries(examples)) {
    for (const shot of shots) if (shot.png !== null) candidates.push({ key: `${component}:${shot.scheme}`, dark: shot.scheme === 'dark', size: shot.png.base64.length });
  }
  candidates.sort((a, b) => Number(b.dark) - Number(a.dark) || b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out: string[] = [];
  let freed = 0;
  for (const candidate of candidates) {
    if (freed >= excess) break;
    out.push(candidate.key);
    freed += candidate.size;
  }
  return out;
};

const ZERO_MARK = `hash=${ZERO_HASH}"`;

/** The page with its mark's hash set: sha256 of the normalised text with the hash zeroed (§2.14 rev 3). */
export const withPageHash = (html: string): { html: string; hash: string } => {
  const hash = sha256(normaliseForHash(html));
  const at = html.indexOf(ZERO_MARK);
  return { html: at === -1 ? html : `${html.slice(0, at)}hash=${hash}"${html.slice(at + ZERO_MARK.length)}`, hash };
};

/** The committed page compared with what was generated (§5.11 `state`), for one readable text. */
export const committedStateOf = (
  text: string,
  facts: { id: string; name: string; revision: number },
): { state: LivingPageState; revision: number | null; sentence: string; reasons: string[] } => {
  const scan = scanLivingPage(text);
  if (!scan.safe) {
    if (scan.reasons.length === 1 && scan.reasons[0] === LIVING_PAGE_TOO_LARGE_REASON) {
      return { state: 'unreadable', revision: null, sentence: livingUnreadableSentence('it is too large'), reasons: [] };
    }
    return { state: 'unsafe', revision: scan.mark?.revision ?? null, sentence: LIVING_UNSAFE_SENTENCE, reasons: scan.reasons };
  }
  const mark = scan.mark;
  if (mark === null || mark.system !== facts.id) return { state: 'changed', revision: mark?.revision ?? null, sentence: LIVING_CHANGED_SENTENCE, reasons: [] };
  const hashOk = sha256(normaliseForHash(text)) === mark.hash;
  if (mark.revision === facts.revision) {
    return hashOk
      ? { state: 'fresh', revision: mark.revision, sentence: livingFreshSentence(mark.revision), reasons: [] }
      : { state: 'reformatted', revision: mark.revision, sentence: livingReformattedSentence(mark.revision), reasons: [] };
  }
  if (!hashOk) return { state: 'changed', revision: mark.revision, sentence: LIVING_CHANGED_SENTENCE, reasons: [] };
  return { state: 'out-of-date', revision: mark.revision, sentence: livingOutOfDateSentence(mark.revision, facts.name, facts.revision), reasons: [] };
};

// ---- per-context state ----

type Shared = {
  abort: AbortController;
  /** Coalescing per system and source: the run under way, and at most one queued behind it. */
  running: Map<string, Promise<void>>;
  pending: Map<string, Promise<void>>;
  /** The committed page's last state per system, keyed by what the file looked like. */
  committed: Map<string, { key: string; view: CommittedView }>;
  /** Rendered staged and preview pages (`GET /systems/:id/living-page/render`), LRU by insertion order. */
  renders: Map<string, RenderEntry>;
  renderBytes: number;
};

type RenderEntry = { id: string; chunks: string[]; meta: RenderMeta; bytes: number };

export type CommittedView = { state: LivingPageState; revision: number | null; sentence: string; reasons: string[] };

const shared = new WeakMap<ServiceContext, Shared>();

const sharedOf = (ctx: ServiceContext): Shared => {
  let out = shared.get(ctx);
  if (out === undefined) {
    const abort = new AbortController();
    const state: Shared = { abort, running: new Map(), pending: new Map(), committed: new Map(), renders: new Map(), renderBytes: 0 };
    out = state;
    shared.set(ctx, state);
    ctx.onDispose(() => abort.abort());
    // A rendered page belongs to the files it was read from: any change to the system (or the root) drops it.
    ctx.onDispose(
      ctx.hub.subscribe((event) => {
        if (event.kind !== 'root' && (event.kind !== 'system' || event.system === undefined)) return;
        for (const [key, entry] of [...state.renders]) {
          if (event.kind === 'system' && entry.id !== event.system) continue;
          state.renders.delete(key);
          state.renderBytes -= entry.bytes;
        }
      }),
    );
  }
  return out;
};

const coalesce = (ctx: ServiceContext, key: string, work: () => Promise<void>): Promise<void> => {
  const state = sharedOf(ctx);
  const queued = state.pending.get(key);
  if (queued !== undefined) return queued;
  const before = state.running.get(key) ?? Promise.resolve();
  const next = before
    .catch(() => undefined)
    .then(() => {
      state.pending.delete(key);
      return work();
    });
  state.pending.set(key, next);
  state.running.set(key, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (state.running.get(key) === next) state.running.delete(key);
    });
  return next;
};

// ---- generation ----

type Generated =
  | { ok: true; html: string; hash: string; bytes: number; omitted: Omitted[]; fonts: 'embedded' | 'fallback'; secrets: { kind: SecretShapeKind; where: string }[] }
  | { ok: false; problem: LivingProblem; omitted: Omitted[]; fonts: 'embedded' | 'fallback'; secrets: { kind: SecretShapeKind; where: string }[] };

const pushOmitted = (list: Omitted[], item: Omitted): void => {
  if (list.length >= LIVING_PAGE_OMITTED_MAX) return;
  if (!list.some((known) => known.what === item.what && known.name === item.name && known.reason === item.reason)) list.push(item);
};

/** Absolute paths the page must never carry (the designs root, the repo, the home folder), as given and as real paths. */
const redactPaths = async (ctx: ServiceContext, state: SystemState): Promise<string[]> => {
  const out = new Set<string>();
  const add = async (candidate: string): Promise<void> => {
    if (candidate === '') return;
    out.add(path.resolve(candidate));
    out.add(await realpath(candidate).catch(() => path.resolve(candidate)));
  };
  await add(ctx.settings.root());
  if (state.home?.kind === 'repo') await add(state.home.directory);
  await add(os.homedir());
  return [...out];
};

/**
 * Everything §5.11 steps 1-4 do for one detail and its files: assets and fonts under the budget, the
 * example pictures, the document, the bundle, the size bound, the hash, the scanner and the secret scan.
 */
const generate = async (
  ctx: ServiceContext,
  input: { id: string; systemDir: string; detail: SystemDetail; source: FileSource; state: SystemState; embedFonts: boolean; preview?: { proposal: string; home: string } },
): Promise<Generated> => {
  const { detail, source } = input;
  const omitted: Omitted[] = [];
  const fonts: 'embedded' | 'fallback' = input.embedFonts ? 'embedded' : 'fallback';
  const base: LivingPageInput = {
    revision: input.state.revision.n,
    generatedAt: input.state.revision.at,
    coverage: detail.coverage,
    redact: await redactPaths(ctx, input.state),
    fonts,
    ...(input.preview !== undefined ? { preview: input.preview } : {}),
  };

  // The text alone sets the asset budget: every asset file left out, no pictures.
  const allAssets = new Set([...detail.fonts.map((font) => font.file), ...detail.logos.map((logo) => logo.file), ...detail.icons.map((icon) => icon.file)]);
  const textBytes = Buffer.byteLength(buildLivingPage(detail, { ...base, fonts: 'fallback', unusable: allAssets }).html, 'utf8');
  let budget = LIVING_PAGE_MAX_BYTES - textBytes;

  const unusable = new Set<string>();
  // Logos first.
  for (const logo of detail.logos) {
    const file = await source.read(logo.file).catch(() => null);
    const name = path.posix.basename(logo.file);
    if (file === null || !checkAsset(name, 'logo', file.bytes).ok) {
      unusable.add(logo.file);
      pushOmitted(omitted, { what: 'logo', name, reason: 'unsafe' });
    } else if (file.bytes.length > LIVING_PAGE_ASSET_MAX_BYTES) {
      unusable.add(logo.file);
      pushOmitted(omitted, { what: 'logo', name, reason: 'too-large' });
    } else if (encodedSize(file.bytes.length) > budget) {
      unusable.add(logo.file);
      pushOmitted(omitted, { what: 'logo', name, reason: 'budget' });
    } else budget -= encodedSize(file.bytes.length);
  }
  // Then icons: each is embedded once per size and ground it is drawn on.
  const copies = iconCopies(detail);
  for (const icon of detail.icons) {
    const file = await source.read(icon.file).catch(() => null);
    const name = path.posix.basename(icon.file);
    const reason: OmittedReason | null =
      file === null || !checkAsset(name, 'icon', file.bytes).ok
        ? 'unsafe'
        : file.bytes.length > ICON_DRAWN_MAX_BYTES
          ? 'too-large'
          : encodedSize(file.bytes.length) * copies > budget
            ? 'budget'
            : null;
    if (reason !== null || file === null) {
      unusable.add(icon.file);
      pushOmitted(omitted, { what: 'icon', name, reason: reason ?? 'unsafe' });
    } else budget -= encodedSize(file.bytes.length) * copies;
  }
  // Then fonts in type-style order, only when they may be embedded (AD-32).
  const fontData: Record<string, string> = {};
  const fontsLeftOut: { file: string; reason: 'too-large' | 'budget' | 'unsafe' }[] = [];
  for (const font of fontsInTypeOrder(detail)) {
    if (!input.embedFonts) {
      pushOmitted(omitted, { what: 'font', name: font.family, reason: 'licence' });
      continue;
    }
    const file = await source.read(font.file).catch(() => null);
    let reason: 'too-large' | 'budget' | 'unsafe' | null = null;
    if (file === null || !checkAsset(path.posix.basename(font.file), 'font', file.bytes).ok) reason = 'unsafe';
    else if (file.bytes.length > LIVING_PAGE_ASSET_MAX_BYTES) reason = 'too-large';
    else if (encodedSize(file.bytes.length) > budget) reason = 'budget';
    if (reason !== null || file === null) {
      unusable.add(font.file);
      fontsLeftOut.push({ file: font.file, reason: reason ?? 'unsafe' });
      pushOmitted(omitted, { what: 'font', name: font.family, reason: reason ?? 'unsafe' });
      continue;
    }
    budget -= encodedSize(file.bytes.length);
    fontData[font.file] = `data:${fontMime(font.file)};base64,${file.bytes.toString('base64')}`;
  }

  // The example pictures (AD-31); a missing browser leaves every one out, the page is still made.
  const shots = await renderExamplePngs(ctx, detail, { schemes: livingSchemes(detail), signal: sharedOf(ctx).abort.signal, source, id: input.id, systemDir: input.systemDir });
  const examples: Record<string, LivingExampleShot[]> = {};
  for (const shot of shots) (examples[shot.component] ??= []).push(toLivingShot(shot));

  // An example key is a component's id, or `pattern:<id>` / `brand:<id>` (exampleKeyOf).
  const nameOf = (key: string): string =>
    key.startsWith('pattern:')
      ? (detail.patterns.find((entry) => `pattern:${entry.id}` === key)?.title ?? key)
      : key.startsWith('brand:')
        ? (detail.brand.find((entry) => `brand:${entry.id}` === key)?.title ?? key)
        : (detail.components.find((candidate) => candidate.id === key)?.name ?? key);
  const exampleOmissions = (): void => {
    for (const [component, list] of Object.entries(examples)) {
      for (const shot of list) if (shot.png === null) pushOmitted(omitted, { what: 'example', name: nameOf(component), reason: shot.reason ?? 'render-failed' });
    }
  };

  const pageInput = (): LivingPageInput => ({ ...base, unusable, fontData, fontsLeftOut, examples });
  const bundle = async (doc: LivingPageDocument): Promise<{ kind: 'ok'; html: string } | { kind: 'problem'; problem: LivingProblem } | { kind: 'over'; excess: number }> => {
    try {
      const result = await bundleDocument(overlaySource(source, doc.html, LIVING_ENTRY_FILE), LIVING_ENTRY_FILE, { mode: 'export' });
      if (result.external.length > 0 || result.blocked.length > 0 || result.missing.length > 0) return { kind: 'problem', problem: 'bundle' };
      const bytes = Buffer.byteLength(result.html, 'utf8');
      return bytes > LIVING_PAGE_MAX_BYTES ? { kind: 'over', excess: bytes - LIVING_PAGE_MAX_BYTES } : { kind: 'ok', html: result.html };
    } catch (error) {
      if (error instanceof BundleTooLarge) return { kind: 'over', excess: Number.MAX_SAFE_INTEGER };
      if (error instanceof BundleMissingEntry) return { kind: 'problem', problem: 'bundle' };
      throw error;
    }
  };

  let doc = buildLivingPage(detail, pageInput());
  let bundled = await bundle(doc);
  while (bundled.kind === 'over') {
    const drop = picturesToDrop(examples, bundled.excess);
    if (drop.length === 0) break;
    for (const key of drop) {
      // `<example key>:<scheme>`; the example key may hold a colon itself (`pattern:nav`).
      const at = key.lastIndexOf(':');
      const component = key.slice(0, at);
      const scheme = key.slice(at + 1);
      examples[component] = (examples[component] ?? []).map((shot) => (shot.scheme === scheme ? { scheme: shot.scheme, png: null, reason: 'budget' as ExampleReason } : shot));
    }
    doc = buildLivingPage(detail, pageInput());
    bundled = await bundle(doc);
  }
  exampleOmissions();
  if (bundled.kind === 'over') return { ok: false, problem: 'too-large', omitted, fonts, secrets: [] };
  if (bundled.kind === 'problem') return { ok: false, problem: bundled.problem, omitted, fonts, secrets: [] };

  const { html, hash } = withPageHash(bundled.html);
  if (!scanLivingPage(html).safe) return { ok: false, problem: 'unsafe', omitted, fonts, secrets: [] };

  // Hits are found in the staged text; the entry each came from is read off the generated document's
  // ranges (the bundle only turns refs into data: URLs, which the scan skips, so the order is the same).
  const hits = findSecretShapes(html);
  const located = findSecretShapes(doc.html);
  const secrets = hits.map((hit, index) => {
    const at = located[index];
    return { kind: hit.kind, where: at !== undefined && at.kind === hit.kind ? entryAt(doc.ranges, at.index) : 'page' };
  });
  return { ok: true, html, hash, bytes: Buffer.byteLength(html, 'utf8'), omitted, fonts, secrets };
};

const FONT_MIME: Readonly<Record<string, string>> = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const fontMime = (file: string): string => FONT_MIME[path.posix.extname(file).toLowerCase()] ?? 'font/woff2';

/** Writes the record, keeping the parts the other source owns. */
const writeRecord = async (ctx: ServiceContext, id: string, systemDir: string, update: (current: LivingPageRecord | null) => LivingPageRecord): Promise<void> => {
  const file = await chamberFile(ctx, id, systemDir, STAGED_JSON);
  await writeFileAtomic(file, recordJson(update(await readRecord(systemDir))));
};

const removeChamberFile = async (ctx: ServiceContext, id: string, systemDir: string, name: string): Promise<void> => {
  const file = await chamberFile(ctx, id, systemDir, name).catch(() => null);
  if (file !== null) await rm(file, { force: true });
};

const regenerateSnapshot = async (ctx: ServiceContext, id: string): Promise<void> => {
  const systems = ensureSystemStore(ctx);
  const state = await systems.readState(id);
  if (state.home?.kind !== 'repo') return;
  const systemDir = await systems.dir(id);
  const access = (await systems.get(id)).build?.access ?? null;
  const embedFonts = access === 'dev' || state.livingPage?.embedFonts === true;
  const blank = (problem: LivingProblem, current: LivingPageRecord | null, extra: Partial<LivingPageRecord> = {}): LivingPageRecord => ({
    v: 1,
    generator: LIVING_PAGE_GENERATOR_VERSION,
    revision: state.revision.n,
    generatedAt: state.revision.at,
    sha256: null,
    bytes: 0,
    forApplied: null,
    omitted: [],
    problem,
    fonts: embedFonts ? 'embedded' : 'fallback',
    secrets: [],
    preview: current?.preview ?? null,
    ...extra,
  });

  if (state.snapshot == null) {
    await systems.withLock(id, async () => {
      await removeChamberFile(ctx, id, systemDir, STAGED_HTML);
      await writeRecord(ctx, id, systemDir, (current) => blank('no-snapshot', current));
    });
    ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'living-page' });
    return;
  }

  const detail = await systems.detail(id);
  const source = createLiveFileSource(await systems.filesDir(id));
  const generated = await generate(ctx, { id, systemDir, detail, source, state, embedFonts });
  const forApplied = state.snapshot.by === 'agent' ? (detail.build?.applied?.at ?? null) : null;
  // Secrets: a public (or unknown) page is not staged; a dev page is, with the finding (§5.11 step 4).
  const secretBlocks = generated.ok && generated.secrets.length > 0 && access !== 'dev';

  await systems.withLock(id, async () => {
    if (!generated.ok || secretBlocks) {
      await removeChamberFile(ctx, id, systemDir, STAGED_HTML);
      const problem: LivingProblem = generated.ok ? 'secret' : generated.problem;
      await writeRecord(ctx, id, systemDir, (current) => blank(problem, current, { forApplied, omitted: generated.omitted, secrets: generated.secrets }));
      return;
    }
    await writeFileAtomic(await chamberFile(ctx, id, systemDir, STAGED_HTML), generated.html);
    await writeRecord(ctx, id, systemDir, (current) => ({
      ...blank('no-snapshot', current),
      sha256: sha256(generated.html),
      bytes: generated.bytes,
      forApplied,
      omitted: generated.omitted,
      problem: null,
      secrets: generated.secrets,
    }));
  });
  ctx.log.info('systems.living-page.staged', {
    system: id,
    revision: state.revision.n,
    problem: generated.ok ? (secretBlocks ? 'secret' : null) : generated.problem,
    omitted: generated.omitted.length,
    secrets: generated.secrets.length,
  });
  ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'living-page' });
};

const regenerateProposal = async (ctx: ServiceContext, id: string): Promise<void> => {
  const systems = ensureSystemStore(ctx);
  const state = await systems.readState(id);
  if (state.home?.kind !== 'repo') return;
  const systemDir = await systems.dir(id);
  const file = await readProposalFile(systemDir);
  if (file.kind === 'absent' || file.parsed.unreadable !== null || file.parsed.id === null) return;
  const proposal = file.parsed.id;
  const proposalDir = await proposalDirOf(systemDir);
  if (proposalDir === null) return;

  const source = createLiveFileSource(proposalDir);
  const detail = buildSystemDetail(await detailSourceFromTree({ id, dir: systemDir, state, rels: await listFiles(proposalDir) }, source));
  const access = (await systems.get(id)).build?.access ?? null;
  const embedFonts = access === 'dev' || state.livingPage?.embedFonts === true;
  const generated = await generate(ctx, { id, systemDir, detail, source, state, embedFonts, preview: { proposal, home: path.basename(state.home.directory) } });
  // A preview with a secret shape is never written, whatever the access (Approve is blocked, §5.14).
  const problem: LivingProblem | null = !generated.ok ? generated.problem : generated.secrets.length > 0 ? 'secret' : null;

  await systems.withLock(id, async () => {
    if (problem !== null || !generated.ok) await removeChamberFile(ctx, id, systemDir, PREVIEW_HTML);
    else await writeFileAtomic(await chamberFile(ctx, id, systemDir, PREVIEW_HTML), generated.html);
    await writeRecord(ctx, id, systemDir, (current) => ({
      ...(current ?? {
        v: 1,
        generator: LIVING_PAGE_GENERATOR_VERSION,
        revision: state.revision.n,
        generatedAt: state.revision.at,
        sha256: null,
        bytes: 0,
        forApplied: null,
        omitted: [],
        problem: 'no-snapshot',
        fonts: embedFonts ? 'embedded' : 'fallback',
        secrets: [],
        preview: null,
      }),
      preview: { proposal, sha256: generated.ok && problem === null ? sha256(generated.html) : null, problem },
    }));
  });
  ctx.log.info('systems.living-page.preview', { system: id, proposal, problem });
  ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'proposal' });
};

/**
 * §5.11: generate and stage the living page of a repo-backed system (an internal home has none, and
 * the call does nothing). Calls for the same system and source are coalesced: one runs, one waits.
 */
export const regenerateLivingPage = (ctx: ServiceContext, id: string, options: { source: 'snapshot' | 'proposal' }): Promise<void> =>
  coalesce(ctx, `${id}:${options.source}`, () => (options.source === 'snapshot' ? regenerateSnapshot(ctx, id) : regenerateProposal(ctx, id)));

/** Resolves once every regeneration under way or queued has finished (tests, the PATCH switch). */
export const livingPagesIdle = async (ctx: ServiceContext): Promise<void> => {
  const state = sharedOf(ctx);
  while (state.running.size > 0) await Promise.allSettled([...state.running.values()]);
};

/** A home change makes the staged and preview pages the old home's: both go, with their record (§5.9). */
export const dropLivingPages = async (ctx: ServiceContext, id: string): Promise<void> => {
  const systems = ensureSystemStore(ctx);
  const systemDir = await systems.dir(id);
  await systems.withLock(id, async () => {
    for (const name of [STAGED_HTML, PREVIEW_HTML, STAGED_JSON]) await removeChamberFile(ctx, id, systemDir, name);
  });
  sharedOf(ctx).committed.delete(id);
  ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'living-page' });
};

// ---- the committed page's state ----

export type CommittedRead = { kind: 'view'; key: string; view: CommittedView } | { kind: 'text'; key: string; text: string } | { kind: 'repo-unreadable' };

export const readCommitted = async (repoDirectory: string, rel: string, repo: string): Promise<CommittedRead> => {
  const unreadable = (reason: string, key: string): CommittedRead => ({ kind: 'view', key, view: { state: 'unreadable', revision: null, sentence: livingUnreadableSentence(reason), reasons: [] } });
  const repoReal = await realpath(repoDirectory).catch(() => null);
  if (repoReal === null) return { kind: 'repo-unreadable' };
  const repoInfo = await lstat(repoReal).catch(() => null);
  if (repoInfo === null || !repoInfo.isDirectory()) return { kind: 'repo-unreadable' };
  const segments = rel.split('/');
  const lexical = path.resolve(repoReal, ...segments);
  let real: string;
  try {
    real = await resolveInside(repoReal, segments);
  } catch (error) {
    if (error instanceof ApiError) return unreadable("it isn't inside the repo", 'outside');
    return { kind: 'repo-unreadable' };
  }
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(lexical);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'view', key: 'missing', view: { state: 'missing', revision: null, sentence: livingMissingSentence(repo), reasons: [] } };
    return { kind: 'repo-unreadable' };
  }
  if (info.isSymbolicLink() || !samePath(real, lexical)) return unreadable("it's a link", 'link');
  if (!info.isFile()) return unreadable("it isn't a file", 'not-file');
  const key = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  if (info.size > LIVING_PAGE_SCAN_MAX_BYTES) return unreadable('it is too large', key);
  const handle = await open(lexical, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (handle === null) return unreadable("it couldn't be opened", key);
  try {
    const bytes = await handle.readFile();
    if (bytes.length > LIVING_PAGE_SCAN_MAX_BYTES) return unreadable('it is too large', key);
    return { kind: 'text', key, text: bytes.toString('utf8') };
  } catch {
    return unreadable("it couldn't be opened", key);
  } finally {
    await handle.close().catch(() => undefined);
  }
};

/**
 * `GET /systems/:id/living-page` (§5.11 `state`): the staged record and the committed page's state.
 * Read-only; the committed file is read at most once per change of its size, mtime and ctime.
 */
export const livingPageState = async (ctx: ServiceContext, id: string): Promise<LivingPageView> => {
  const systems = ensureSystemStore(ctx);
  const state = await systems.readState(id);
  const home = state.home;
  if (home?.kind !== 'repo') return { home: 'internal' };
  const systemDir = await systems.dir(id);
  const record = await readRecord(systemDir);
  const repo = path.basename(home.directory) || home.directory;
  const cache = sharedOf(ctx).committed;

  const facts = { id, name: state.name, revision: state.revision.n };
  const read = await readCommitted(home.directory, home.livingPage, repo);
  let committed: CommittedView;
  let repoReadable = true;
  if (read.kind === 'repo-unreadable') {
    repoReadable = false;
    committed = cache.get(id)?.view ?? { state: 'unreadable', revision: null, sentence: livingUnreadableSentence("the repo can't be read"), reasons: [] };
  } else {
    // The state depends on the file and on the system's revision and name; all are in the key.
    const key = `${home.directory}\n${home.livingPage}\n${read.key}\n${facts.revision}\n${facts.name}`;
    const known = cache.get(id);
    if (known !== undefined && known.key === key) committed = known.view;
    else {
      committed = read.kind === 'view' ? read.view : committedStateOf(read.text, facts);
      cache.set(id, { key, view: committed });
    }
  }

  return {
    home: 'repo',
    path: home.livingPage,
    absolute: path.join(home.directory, ...home.livingPage.split('/')),
    staged:
      record === null
        ? null
        : {
            revision: record.revision,
            bytes: record.bytes,
            omitted: record.omitted,
            problem: record.problem,
            fonts: record.fonts,
            secrets: record.secrets,
            preview: record.preview === null ? null : { proposal: record.preview.proposal, problem: record.preview.problem },
          },
    committed,
    repoReadable,
    embedFonts: state.livingPage?.embedFonts === true,
  };
};

/** The list row's and the detail's summary of the committed page (§4.3); null when it can't be had. */
export const livingPageSummary = async (ctx: ServiceContext, id: string): Promise<{ state: LivingPageState; sentence: string } | null> => {
  try {
    const view = await livingPageState(ctx, id);
    return view.home === 'repo' ? { state: view.committed.state, sentence: view.committed.sentence } : null;
  } catch (error) {
    ctx.log.warn('systems.living-page.state-failed', { system: id, error: errorName(error) });
    return null;
  }
};

/**
 * Service start: a repo-backed system whose staged record is missing, for another revision or from
 * another generator is regenerated once (§5.11). Returns the stop function.
 */
export const startLivingPages = (ctx: ServiceContext, ready?: () => Promise<unknown>): (() => Promise<void>) => {
  let stopped = false;
  ensureSystemStore(ctx).attachLivingPages((id) => livingPageSummary(ctx, id));
  const sweep = (async () => {
    await ready?.();
    const systems = ensureSystemStore(ctx);
    for (const summary of await systems.list().catch(() => [])) {
      if (stopped) return;
      if (summary.home === 'internal' || summary.unreadable !== null) continue;
      try {
        const state = await systems.readState(summary.id);
        if (state.home?.kind !== 'repo' || state.snapshot == null) continue;
        const record = await readRecord(await systems.dir(summary.id));
        if (record !== null && record.revision === state.revision.n && record.generator === LIVING_PAGE_GENERATOR_VERSION) continue;
        await regenerateLivingPage(ctx, summary.id, { source: 'snapshot' });
      } catch (error) {
        ctx.log.warn('systems.living-page.start-failed', { system: summary.id, error: errorName(error) });
      }
    }
  })();
  return async () => {
    stopped = true;
    await sweep.catch(() => undefined);
  };
};

// ---- the staged page and the proposal preview, rendered for the artboard frame (§3.5 rev 3, AD-30) ----

export const LIVING_RENDER_MISSING = "There's no living page to show yet.";
export const LIVING_RENDER_STALE = 'That living page is no longer in the cache. Open it again.';
const LIVING_RENDER_TOO_LARGE = 'The living page is too large to show inside OpenChamber.';
const RENDER_CACHE_MAX = 64 * 1024 * 1024;
const RENDER_ENTRY = 'living-page.html';

/**
 * `RenderMeta` of the staged page (`which: staged`) or the proposal preview (`which: preview`), read from
 * `.chamber/` only (never the repo). The page is self-contained, so the bundle reads nothing beside it:
 * any reference stays missing. The page shows both modes itself; `scheme` keys the cache for the frame.
 */
export const renderLivingPage = async (ctx: ServiceContext, id: string, options: { which: 'staged' | 'preview'; scheme: 'light' | 'dark' }): Promise<RenderMeta> => {
  const systems = ensureSystemStore(ctx);
  const systemDir = await systems.dir(id);
  const state = await systems.readState(id);
  if (state.home?.kind !== 'repo') throw new ApiError('not-found', LIVING_RENDER_MISSING);
  let file: string;
  try {
    file = await resolvePlainTarget(systemDir, ['.chamber', options.which === 'staged' ? STAGED_HTML : PREVIEW_HTML]);
  } catch {
    throw new ApiError('not-found', LIVING_RENDER_MISSING);
  }
  const info = await lstat(file).catch(() => null);
  if (info === null || !info.isFile()) throw new ApiError('not-found', LIVING_RENDER_MISSING);
  if (info.size > LIVING_PAGE_MAX_BYTES) throw new ApiError('too-large', LIVING_RENDER_TOO_LARGE);
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (handle === null) throw new ApiError('not-found', LIVING_RENDER_MISSING);
  let html: string;
  try {
    const bytes = await handle.readFile();
    if (bytes.length > LIVING_PAGE_MAX_BYTES) throw new ApiError('too-large', LIVING_RENDER_TOO_LARGE);
    html = bytes.toString('utf8');
  } finally {
    await handle.close().catch(() => undefined);
  }

  const cache = sharedOf(ctx);
  const key = sha256(JSON.stringify({ g: 'living-page', id, which: options.which, scheme: options.scheme, html: sha256(html) }));
  const cached = cache.renders.get(key);
  if (cached !== undefined) {
    cache.renders.delete(key);
    cache.renders.set(key, cached);
    return cached.meta;
  }
  const empty: FileSource = { root: systemDir, read: () => Promise.resolve(null), stat: () => Promise.resolve(null) };
  let result: Awaited<ReturnType<typeof bundleDocument>>;
  try {
    result = await bundleDocument(overlaySource(empty, html, RENDER_ENTRY), RENDER_ENTRY, { mode: 'render' });
  } catch (error) {
    if (error instanceof BundleTooLarge) throw new ApiError('too-large', LIVING_RENDER_TOO_LARGE);
    throw error;
  }
  const chunks = splitChunks(result.html, RENDER_CHUNK_MAX_BYTES);
  const bytes = Buffer.byteLength(result.html, 'utf8');
  const meta: RenderMeta = {
    key,
    chunks: chunks.length,
    bytes,
    title: `${state.name}: ${options.which === 'staged' ? 'living page' : 'living page preview'}`,
    missing: result.missing,
    blocked: result.blocked,
    external: result.external,
    warnings: result.warnings,
  };
  cache.renders.set(key, { id, chunks, meta, bytes });
  cache.renderBytes += bytes;
  for (const [old, entry] of [...cache.renders]) {
    if (cache.renderBytes <= RENDER_CACHE_MAX) break;
    cache.renders.delete(old);
    cache.renderBytes -= entry.bytes;
  }
  return meta;
};

/** One chunk of a rendered living page; `stale` when the key was dropped or belongs to another system. */
export const livingPageChunk = (ctx: ServiceContext, id: string, key: string, n: number): string => {
  const entry = sharedOf(ctx).renders.get(key);
  if (entry === undefined || entry.id !== id) throw new ApiError('stale', LIVING_RENDER_STALE);
  if (!Number.isInteger(n) || n < 0 || n >= entry.chunks.length) throw new ApiError('bad-request', 'That chunk number is not part of this page.');
  const chunk = entry.chunks[n];
  if (chunk === undefined) throw new ApiError('stale', LIVING_RENDER_STALE);
  return chunk;
};
