// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.12, §7.4, AD-19, AD-23): the service's own
// code scans of a built system's code folder.
//
// `build` (adoption, and after each internal-home apply): the scan's certain values go to
// `.chamber/scan.json` for the building agent (the agent reads files, not routes), then the drift is
// counted from the same scan. `drift` (after a snapshot refresh, a user re-sync, a reconcile prompt):
// the count only. Both run through the scan jobs (`runInternal`: same walker, limits, running cap and
// root-change abort) and exclude the system's repo folder, its living page, the designs root and
// `_systems`, so the system is never compared with itself.
//
// The count covers CSS custom properties and token JSON only (rev 3): files the scanner can't read
// (Tailwind configs, JS themes) are listed in `unread`, and every sentence says so (`shared/checks.ts`).
// BUILD.json's own `drift` is the agent's number, shown on its own line and never added to this one.
//
// Read-only on the project: the scan only reads; every write lands under `_systems/<id>/.chamber/`.

import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { CODE_DRIFT_NAMES_MAX, SCAN_JSON_MAX_BYTES, SYSTEM_TOKENS_MAX } from '../../shared/limits.ts';
import { tokenValues } from '../../shared/system-copy.ts';
import { SYSTEMS_DIR } from '../../shared/system-json.ts';
import type { SystemState } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import { ensureScanJobs, ScanStopped, type ScanResult } from './extract.ts';
import { validateScanFolder } from './scan-folder.ts';
import { ensureSystemStore, guardSystemWrite } from './store.ts';

export const SCAN_JSON_SCHEMA = 'design-chamber/system-scan@1';
const SCAN_FILES_MAX = 200;
const SCAN_FOR_AGENT_MAX = 20;
const SCAN_SKIPPED_MAX = 50;
const UNREAD_MAX = 20;

type ModeValues = { name: string; light: string | null; dark: string | null };

/** Trimmed, hex lower-cased: `#FFF ` and `#fff` are the same value (§5.12). */
export const normaliseValue = (value: string): string => value.trim().replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => hex.toLowerCase());

const differs = (a: string | null, b: string | null): boolean => a !== null && b !== null && normaliseValue(a) !== normaliseValue(b);

/**
 * A name counts when the code defines it with a different light or dark value (§5.12). Names the code
 * lacks are not counted (it may use other names the scanner doesn't read), nor a mode only one side sets.
 */
export const codeDrift = (
  systemTokens: readonly ModeValues[],
  codeTokens: readonly ModeValues[],
): { differ: number; names: string[] } => {
  const code = new Map<string, ModeValues>();
  for (const token of codeTokens) if (!code.has(token.name)) code.set(token.name, token);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const token of systemTokens) {
    if (seen.has(token.name)) continue;
    seen.add(token.name);
    const there = code.get(token.name);
    if (there === undefined) continue;
    if (differs(token.light, there.light) || differs(token.dark, there.dark)) names.push(token.name);
  }
  return { differ: names.length, names: names.slice(0, CODE_DRIFT_NAMES_MAX) };
};

// ---- scan.json (§7.4) ----

export type ScanJson = {
  v: 1;
  schema: typeof SCAN_JSON_SCHEMA;
  at: string;
  directory: string;
  partial: boolean;
  counts: ScanResult['summary']['counts'];
  files: { path: string; found: number }[];
  forAgent: { path: string; why: string }[];
  skipped: { path: string; reason: string }[];
  tokens: { name: string; light: string | null; dark: string | null; file: string; line: number }[];
};

/** The file's body: every list capped, and tokens dropped from the end until it fits the byte cap. */
export const scanJsonOf = (result: ScanResult): string => {
  const tokens = result.tokens.slice(0, SYSTEM_TOKENS_MAX).map((token) => ({ name: token.name, light: token.light, dark: token.dark, file: token.file, line: token.line }));
  const body: ScanJson = {
    v: 1,
    schema: SCAN_JSON_SCHEMA,
    at: result.at,
    directory: result.directory,
    partial: result.summary.partial || result.tokens.length > SYSTEM_TOKENS_MAX,
    counts: result.summary.counts,
    files: result.summary.files.slice(0, SCAN_FILES_MAX),
    forAgent: result.summary.forAgent.slice(0, SCAN_FOR_AGENT_MAX),
    skipped: result.summary.skipped.slice(0, SCAN_SKIPPED_MAX),
    tokens,
  };
  let text = `${JSON.stringify(body, null, 2)}\n`;
  while (Buffer.byteLength(text, 'utf8') > SCAN_JSON_MAX_BYTES && body.tokens.length > 0) {
    body.tokens = body.tokens.slice(0, Math.floor(body.tokens.length / 2));
    body.partial = true;
    text = `${JSON.stringify(body, null, 2)}\n`;
  }
  return text;
};

// ---- the scans ----

type CodeFacts = { directory: string; mode: 'fix' | 'describe' };

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'error');

/**
 * What the code scan leaves out (§5.12): the repo folder and living page of a repo home, the designs
 * root and `_systems`. Compared as the walker sees them (under the code folder's realpath).
 */
const excludesFor = async (ctx: ServiceContext, state: SystemState): Promise<string[]> => {
  const root = ctx.settings.root();
  const rootReal = await realpath(root).catch(() => path.resolve(root));
  const out = [rootReal, path.join(rootReal, SYSTEMS_DIR)];
  const home = state.home;
  if (home?.kind === 'repo') {
    const repoReal = await realpath(home.directory).catch(() => path.resolve(home.directory));
    out.push(path.join(repoReal, ...home.folder.split('/')), path.join(repoReal, ...home.livingPage.split('/')));
  }
  return out;
};

/** The code folder and mode a drift count needs, or null when the system has none (§5.12). */
const codeFactsOf = async (ctx: ServiceContext, id: string): Promise<{ facts: CodeFacts | null; state: SystemState; tokensCss: string | null }> => {
  const source = await ensureSystemStore(ctx).get(id);
  const mode = source.build?.mode;
  const directory = source.state.sources.code?.directory ?? null;
  const facts = directory !== null && (mode === 'fix' || mode === 'describe') ? { directory, mode } : null;
  return { facts, state: source.state, tokensCss: source.tokensCss };
};

const storeDrift = async (ctx: ServiceContext, id: string, next: SystemState['codeDrift'] | null): Promise<void> => {
  const systems = ensureSystemStore(ctx);
  let changed = false;
  await systems.withLock(id, () =>
    systems.updateStateLocked(id, (current) => {
      if (next === null && (current.codeDrift ?? null) === null) return null;
      changed = true;
      return { ...current, codeDrift: next };
    }),
  );
  if (changed) ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'state' });
};

const driftFrom = (mode: 'fix' | 'describe', tokensCss: string | null, result: ScanResult): NonNullable<SystemState['codeDrift']> => {
  const system = [...tokenValues(tokensCss)].map(([name, values]) => ({ name, light: values.light, dark: values.dark }));
  const counted = codeDrift(system, result.tokens);
  return {
    at: result.at,
    mode,
    differ: counted.differ,
    names: counted.names,
    partial: result.summary.partial,
    unread: result.summary.forAgent.slice(0, UNREAD_MAX).map((one) => one.path),
  };
};

/** One internal scan of the code folder; a folder that no longer passes the scan rules is no scan. */
const scanCode = async (ctx: ServiceContext, purpose: 'build' | 'drift', state: SystemState, directory: string): Promise<ScanResult | null> => {
  const root = ctx.settings.root();
  let real: string;
  try {
    real = await validateScanFolder(directory, root);
  } catch {
    ctx.log.warn('systems.code-scan-folder-refused', { system: state.id, purpose });
    return null;
  }
  return ensureScanJobs(ctx).runInternal(purpose, real, await excludesFor(ctx, state));
};

/**
 * §5.12: count the code drift again and store it in `state.codeDrift` (null when the system has no
 * code folder or no fix/describe mode). A stopped scan keeps the last count.
 */
export const recomputeDrift = async (ctx: ServiceContext, id: string): Promise<void> => {
  const { facts, state, tokensCss } = await codeFactsOf(ctx, id);
  if (facts === null) {
    await storeDrift(ctx, id, null);
    return;
  }
  let result: ScanResult | null;
  try {
    result = await scanCode(ctx, 'drift', state, facts.directory);
  } catch (error) {
    if (error instanceof ScanStopped) return;
    throw error;
  }
  if (result === null) return;
  const drift = driftFrom(facts.mode, tokensCss, result);
  await storeDrift(ctx, id, drift);
  ctx.log.info('systems.drift', { system: id, differ: drift.differ, unread: drift.unread?.length ?? 0, partial: drift.partial });
};

/**
 * §7.4 `build` scan: the code folder scanned, its certain values written to `.chamber/scan.json`
 * (the building agent reads it), `sources.code` updated, then the drift counted from the same scan.
 */
export const runBuildScan = async (ctx: ServiceContext, id: string, directory: string): Promise<void> => {
  const systems = ensureSystemStore(ctx);
  const state = await systems.readState(id);
  let result: ScanResult | null;
  try {
    result = await scanCode(ctx, 'build', state, directory);
  } catch (error) {
    if (error instanceof ScanStopped) return;
    throw error;
  }
  if (result === null) return;
  const scanned = result;
  const systemDir = await systems.dir(id);
  await systems.withLock(id, async () => {
    const file = await resolvePlainTarget(systemDir, ['.chamber', 'scan.json'], { allowAbsent: true });
    await guardSystemWrite(ctx.settings.root(), file, id, ctx.log);
    await writeFileAtomic(file, scanJsonOf(scanned), { createDirs: false });
    await systems.updateStateLocked(id, (current) =>
      current.sources.code === null ? null : { ...current, sources: { ...current.sources, code: { ...current.sources.code, lastScan: scanned.at, partial: scanned.summary.partial, scanned: scanned.scanned.slice(0, SCAN_FILES_MAX), forAgent: scanned.summary.forAgent.slice(0, SCAN_FOR_AGENT_MAX) } } },
    );
  });
  ctx.log.info('systems.build-scan', { system: id, tokens: scanned.tokens.length, files: scanned.scanned.length, partial: scanned.summary.partial });
  const { facts, tokensCss } = await codeFactsOf(ctx, id);
  if (facts === null) {
    await storeDrift(ctx, id, null);
    return;
  }
  await storeDrift(ctx, id, driftFrom(facts.mode, tokensCss, scanned)).catch((error: unknown) => ctx.log.warn('systems.drift-failed', { system: id, error: errorName(error) }));
  ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'state' });
};
