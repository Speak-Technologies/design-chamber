// The Code scan (documentation/specs/phase-2-5-technical.md §7.1 to §7.3, AD-23): a bounded, read-only
// job over a project folder the user picked, the seed of a new system made from it (§7.2), and the
// re-sync review of an internal-home system (§7.3; its apply is `systems/edits.ts` op `resync`, §6.3).
// The repo flavour and the S8 purposes are T13's.
//
// Safety: the folder passes `validateScanFolder` (absolute, not a drive root, outside the Designs
// folder, compared as realpaths) and is walked from its realpath with discovery's walker under the
// heavier caps (depth 8, 20 000 entries, 10 s; discovery's own caps are untouched). Links are never
// followed (the walker lists only real files and folders; reads open with O_NOFOLLOW), the Designs
// folder is skipped when it lies inside the project, and secret files are skipped by name, never
// opened. Only candidates are read, at most 200, each up to 1 MB, each read under the time left.
//
// The values stay in the job's memory: the guest gets counts and paths (`ScanSummary`), and the logs
// get the job id, counts and the duration only. A root change stops running jobs and drops done ones.

import { randomBytes } from 'node:crypto';
import { constants as fsConstants, type Dirent } from 'node:fs';
import { lstat, open, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CodeResyncReview, CreateSystemBody, CreateSystemScanBody, ScanSummary, SystemScanResponse } from '../../shared/api.ts';
import {
  SCAN_CANDIDATES_MAX,
  SCAN_DEPTH_MAX,
  SCAN_ENTRIES_MAX,
  SCAN_FILE_MAX_BYTES,
  SCAN_ID_PATTERN,
  SCAN_TIME_MS,
  SCAN_TTL_MS,
  SCANS_KEPT_MAX,
  SCANS_RUNNING_MAX,
  SYSTEM_ID_PATTERN,
} from '../../shared/limits.ts';
import { resyncStampOf, safeAssetName } from '../../shared/system-json.ts';
import type { SystemState } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { bySpot, walk, withDeadline } from '../discovery.ts';
import { ApiError } from '../http.ts';
import { resolvePlainTarget, samePath, writeFileAtomic } from '../paths.ts';
import { readPreset } from '../routes/presets.ts';
import { checkAsset, checkAssetMeta, ensureFolder, FOLDER_OF_KIND, guessFontFace, guessLogoVariant } from './assets.ts';
import {
  extractFromCss,
  extractFromTokenJson,
  forAgentByName,
  isCssFile,
  isFontFolderFile,
  isLogoCandidate,
  isPreprocessorFile,
  isSecretName,
  isTokenJsonFile,
  mergeTokens,
  presetRootTokens,
  preprocessorHasVariables,
  resyncReview,
  SECTION_ORDER,
  seedSystemJson,
  seedTokensCss,
  type ExtractedFace,
  type ExtractedToken,
  type ScannedToken,
  type SeedToken,
} from './extract-rules.ts';
import { notBuilt } from './not-built.ts';
import { validateScanFolder } from './scan-folder.ts';
import { ensureSystemStore, type SystemSeed } from './store.ts';

// ---- sentences ----

export const SCAN_GONE_MESSAGE = 'That scan is no longer available. Scan the folder again.';
export const SCANS_BUSY_MESSAGE = 'Two scans are already running. Wait for one to finish, then try again.';
export const SCAN_CANCELLED_MESSAGE = 'The scan was stopped.';
export const SCAN_ROOT_CHANGED_MESSAGE = 'Your Designs folder changed, so the scan stopped. Scan again.';
/** A re-sync apply whose scan was made under another designs root (RS S4 "Changed folder"). */
export const RESYNC_ROOT_CHANGED_MESSAGE = 'Your Designs folder changed. Nothing was changed.';
export const SCAN_OTHER_SYSTEM_MESSAGE = 'That scan was made for another design system. Scan again.';
const scanFailedMessage = (directory: string): string => `Design Chamber couldn't finish reading ${directory}. Try again.`;

const SKIP_TOO_LARGE = "It's larger than 1 MB, so it wasn't read.";
const SKIP_UNREADABLE = "Design Chamber can't open it.";
const SKIP_NOT_JSON = "It isn't valid JSON.";
const SKIP_DESIGNS = 'This is your Designs folder, so it was not read.';
const WHY_COMPOSITE = 'Token values that are groups (like a whole text style): the agent can read them.';
const WHY_PREPROCESSOR = 'Sass or Less variables: the agent can read them.';
const whyRefused = (count: number): string => `Values Design Chamber couldn't use: ${count}. The agent can read them.`;

// ---- caps of what travels (§7.1 ScanSummary) ----

const FILES_SHOWN_MAX = 200;
const SKIPPED_SHOWN_MAX = 50;
const FOR_AGENT_MAX = 20;
const FONTS_MAX = 20;
const LOGOS_MAX = 20;

// ---- the scan ----

export type ScanLimits = { depth: number; entries: number; timeMs: number; fileBytes: number; candidates: number };

export const DEFAULT_SCAN_LIMITS: Readonly<ScanLimits> = Object.freeze({
  depth: SCAN_DEPTH_MAX,
  entries: SCAN_ENTRIES_MAX,
  timeMs: SCAN_TIME_MS,
  fileBytes: SCAN_FILE_MAX_BYTES,
  candidates: SCAN_CANDIDATES_MAX,
});

export type ScanAsset = ScanSummary['assets'][number];

/** What a finished scan keeps in memory. Only `summary` leaves the service. */
export type ScanResult = {
  /** The project folder's realpath. */
  directory: string;
  /** When the scan finished (state.json's `lastScan`). */
  at: string;
  tokens: ScannedToken[];
  /** Files the scan read (project-relative, `/`): a token from a file not in here is never "no longer in the code". */
  scanned: string[];
  assets: ScanAsset[];
  summary: ScanSummary;
};

class ScanStopped extends Error {}

type ReadOutcome = { text: string } | 'too-large' | 'unreadable' | 'timeout';

/** A regular file's text without following a link, refused over `maxBytes` before it is read. */
const readCandidate = async (file: string, maxBytes: number): Promise<Exclude<ReadOutcome, 'timeout'>> => {
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (handle === null) return 'unreadable';
  try {
    const info = await handle.stat();
    if (!info.isFile()) return 'unreadable';
    if (info.size > maxBytes) return 'too-large';
    const buffer = Buffer.alloc(info.size);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return { text: buffer.subarray(0, filled).toString('utf8') };
  } catch {
    return 'unreadable';
  } finally {
    await handle.close().catch(() => undefined);
  }
};

const emptyCounts = (): ScanSummary['counts'] => ({ colours: 0, typography: 0, spacing: 0, radius: 0, shadows: 0, layers: 0, sizes: 0, other: 0, fonts: 0, logos: 0 });

export type ScanInput = {
  /** The project folder's realpath (already through `validateScanFolder`). */
  directory: string;
  designsRoot: string;
  limits: ScanLimits;
  signal: AbortSignal;
  now: () => number;
  /** Directory entries seen so far, for the running answer. */
  onSeen?: (seen: number) => void;
};

/** The scan itself (§7.1). Throws `ScanStopped` when the signal aborts; never writes anything. */
export const runScan = async (input: ScanInput): Promise<ScanResult> => {
  const { directory, limits, signal } = input;
  const startedAt = input.now();
  const left = (): number => Math.max(0, limits.timeMs - (input.now() - startedAt));
  const stopIfAborted = (): void => {
    if (signal.aborted) throw new ScanStopped();
  };
  const expired = (): boolean => signal.aborted || left() <= 0;
  const designsReal = await realpath(input.designsRoot).catch(() => path.resolve(input.designsRoot));
  stopIfAborted();

  const skipped: { path: string; reason: string }[] = [];
  let seen = 0;
  const walked = await walk(directory, {
    depth: limits.depth,
    entries: limits.entries,
    expired,
    skipDir: (abs, rel) => {
      if (!samePath(abs, designsReal)) return false;
      skipped.push({ path: rel, reason: SKIP_DESIGNS });
      return true;
    },
    list: async (abs): Promise<Dirent[] | null> => {
      const listed = await withDeadline(readdir(abs, { withFileTypes: true }).catch(() => null), left(), null);
      seen += listed?.length ?? 0;
      input.onSeen?.(seen);
      return listed;
    },
  });
  stopIfAborted();
  let partial = walked.truncated;

  // Secret files are dropped here, by name: nothing below can open them.
  const files = walked.files.filter((rel) => !isSecretName(rel));
  const walkedSet = new Set(files);

  const forAgent: { path: string; why: string }[] = [];
  const addForAgent = (rel: string, why: string): void => {
    if (!forAgent.some((one) => one.path === rel)) forAgent.push({ path: rel, why });
  };
  for (const rel of [...files].sort(bySpot)) {
    const why = forAgentByName(rel);
    if (why !== null) addForAgent(rel, why);
  }

  // Candidates in priority order: token JSON, then CSS shallowest first, then Sass and Less.
  const candidates = [
    ...files.filter(isTokenJsonFile).sort(bySpot),
    ...files.filter(isCssFile).sort(bySpot),
    ...files.filter(isPreprocessorFile).sort(bySpot),
  ];
  if (candidates.length > limits.candidates) partial = true;

  const perFile: { file: string; tokens: ExtractedToken[] }[] = [];
  const faces: ExtractedFace[] = [];
  const found: { path: string; found: number }[] = [];
  const scanned: string[] = [];
  let refused = 0;
  for (const rel of candidates.slice(0, limits.candidates)) {
    stopIfAborted();
    if (left() <= 0) {
      partial = true;
      break;
    }
    const outcome = await withDeadline<ReadOutcome>(readCandidate(path.join(directory, ...rel.split('/')), limits.fileBytes), left(), 'timeout');
    stopIfAborted();
    if (outcome === 'timeout') {
      partial = true;
      break;
    }
    if (outcome === 'too-large' || outcome === 'unreadable') {
      skipped.push({ path: rel, reason: outcome === 'too-large' ? SKIP_TOO_LARGE : SKIP_UNREADABLE });
      continue;
    }
    scanned.push(rel);
    if (isPreprocessorFile(rel)) {
      if (preprocessorHasVariables(outcome.text)) addForAgent(rel, WHY_PREPROCESSOR);
      continue;
    }
    const extraction = isTokenJsonFile(rel) ? extractFromTokenJson(outcome.text, rel) : extractFromCss(outcome.text, rel);
    if (extraction.unreadable) skipped.push({ path: rel, reason: SKIP_NOT_JSON });
    if (extraction.composite) addForAgent(rel, WHY_COMPOSITE);
    if (extraction.refused > 0) addForAgent(rel, whyRefused(extraction.refused));
    refused += extraction.refused;
    perFile.push({ file: rel, tokens: extraction.tokens });
    faces.push(...extraction.faces);
    if (extraction.tokens.length + extraction.faces.length > 0) found.push({ path: rel, found: extraction.tokens.length + extraction.faces.length });
  }
  const merged = mergeTokens(perFile);
  if (merged.capped) partial = true;

  // Fonts: those an @font-face names (only files the walk saw, so never through a link), then the
  // rest of any `fonts` folder; logos by name. Sizes from lstat only; nothing here is opened.
  const assets: ScanAsset[] = [];
  const sizeOf = async (rel: string): Promise<number | null> => {
    const info = await withDeadline(lstat(path.join(directory, ...rel.split('/'))).catch(() => null), left(), null);
    return info !== null && info.isFile() ? info.size : null;
  };
  const fontPaths = new Set<string>();
  const fontCandidates: { path: string; family?: string; weight?: number; style?: string }[] = [];
  for (const face of faces) {
    if (!walkedSet.has(face.path) || fontPaths.has(face.path)) continue;
    fontPaths.add(face.path);
    fontCandidates.push({ path: face.path, ...(face.family === '' ? {} : { family: face.family }), weight: face.weight, style: face.style });
  }
  for (const rel of files.filter(isFontFolderFile).sort(bySpot)) {
    if (fontPaths.has(rel)) continue;
    fontPaths.add(rel);
    fontCandidates.push({ path: rel });
  }
  for (const font of fontCandidates) {
    if (assets.filter((one) => one.kind === 'font').length >= FONTS_MAX || expired()) break;
    const bytes = await sizeOf(font.path);
    if (bytes === null || !checkAssetMeta(font.path, 'font', bytes).ok) continue;
    const guess = guessFontFace(font.path);
    assets.push({ path: font.path, kind: 'font', bytes, family: font.family ?? guess.family, weight: font.weight ?? guess.weight, style: font.style ?? guess.style });
  }
  for (const rel of files.filter(isLogoCandidate).sort(bySpot)) {
    if (assets.filter((one) => one.kind === 'logo').length >= LOGOS_MAX || expired()) break;
    const bytes = await sizeOf(rel);
    if (bytes === null || !checkAssetMeta(rel, 'logo', bytes).ok) continue;
    assets.push({ path: rel, kind: 'logo', bytes });
  }
  stopIfAborted();
  if (left() <= 0) partial = true;

  const counts = emptyCounts();
  for (const token of merged.tokens) counts[token.section] += 1;
  counts.fonts = assets.filter((one) => one.kind === 'font').length;
  counts.logos = assets.filter((one) => one.kind === 'logo').length;

  return {
    directory,
    at: new Date(input.now()).toISOString(),
    tokens: merged.tokens,
    scanned,
    assets,
    summary: {
      directory,
      counts,
      files: found.slice(0, FILES_SHOWN_MAX),
      skipped: skipped.slice(0, SKIPPED_SHOWN_MAX),
      assets: assets.slice(0, FONTS_MAX + LOGOS_MAX),
      forAgent: forAgent.slice(0, FOR_AGENT_MAX),
      refused,
      partial,
    },
  };
};

// ---- the jobs ----

type JobState = 'running' | 'done' | 'failed' | 'cancelled' | 'root-changed';

type Job = {
  id: string;
  /** The designs root when the job started: a result is never used under another root. */
  root: string;
  systemId: string | null;
  directory: string;
  startedAt: number;
  finishedAt: number | null;
  abort: AbortController;
  state: JobState;
  seen: number;
  message: string;
  result: ScanResult | null;
  review: CodeResyncReview | undefined;
  /** The system's re-sync stamp when the review was made (§6.3), null for a scan without a system. */
  stamp: string | null;
  settled: Promise<void>;
};

/** A done re-sync scan, for the apply (§6.3): the values, the root it ran under and the stamp its review was made against. */
export type ResyncSource = { result: ScanResult; root: string; stamp: string };

export type ScanJobs = {
  start(input: CreateSystemScanBody): Promise<{ scanId: string }>;
  get(scanId: string): SystemScanResponse;
  cancel(scanId: string): void;
  /** A done job's result under the current root (for making a system from it); 404/409 sentence otherwise. */
  result(scanId: string): ScanResult;
  /**
   * A done re-sync scan of `systemId` under the current root (§6.3): 404 when it expired, 409 while it
   * runs, when it was made for another system, or under another Designs folder.
   */
  resyncSource(scanId: string, systemId: string): ResyncSource;
  /** Resolves once the job has finished, whatever its end (tests and the create flow). */
  settled(scanId: string): Promise<void>;
  dispose(): void;
};

export type ScanJobsOptions = {
  limits?: Partial<ScanLimits>;
  now?: () => number;
  /** Test seam: awaited before each job's walk, so a test can hold a job in `running`. */
  gate?: () => Promise<void>;
};

const newScanId = (): string => `sc_${randomBytes(18).toString('base64url')}`;

const gone = (): ApiError => new ApiError('not-found', SCAN_GONE_MESSAGE);

export const createScanJobs = (ctx: ServiceContext, options: ScanJobsOptions = {}): ScanJobs => {
  const limits: ScanLimits = { ...DEFAULT_SCAN_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const jobs = new Map<string, Job>();

  /** Done jobs past their time, then the oldest beyond the kept cap (running jobs are never dropped). */
  const prune = (): void => {
    const at = now();
    for (const [id, job] of jobs) if (job.finishedAt !== null && at - job.finishedAt > SCAN_TTL_MS) jobs.delete(id);
    const finished = [...jobs.values()].filter((job) => job.finishedAt !== null).sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    while (finished.length > SCANS_KEPT_MAX) {
      const oldest = finished.shift();
      if (oldest !== undefined) jobs.delete(oldest.id);
    }
  };

  const finish = (job: Job, state: JobState, message: string): void => {
    if (job.state !== 'running') return;
    job.state = state;
    job.message = message;
    job.finishedAt = now();
  };

  const stopAll = (state: 'cancelled' | 'root-changed', message: string): void => {
    for (const job of jobs.values()) {
      if (job.state !== 'running') continue;
      finish(job, state, message);
      job.abort.abort();
    }
  };

  const unsubscribe = ctx.settings.onRootChange(() => {
    stopAll('root-changed', SCAN_ROOT_CHANGED_MESSAGE);
    for (const [id, job] of jobs) if (job.state !== 'root-changed') jobs.delete(id);
  });

  /** §7.3: the review of an internal-home system against what the scan found. */
  const reviewFor = async (systemId: string, result: ScanResult): Promise<{ review: CodeResyncReview; stamp: string }> => {
    const store = ensureSystemStore(ctx);
    const state = await store.readState(systemId);
    const detail = await store.detail(systemId);
    return {
      review: resyncReview(detail, state.provenance, { tokens: result.tokens, scanned: result.scanned, assets: result.assets, partial: result.summary.partial }),
      stamp: resyncStampOf(detail.stamps),
    };
  };

  const run = async (job: Job): Promise<void> => {
    try {
      await options.gate?.();
      if (job.abort.signal.aborted) return;
      const result = await runScan({
        directory: job.directory,
        designsRoot: job.root,
        limits,
        signal: job.abort.signal,
        now,
        onSeen: (seen) => {
          job.seen = seen;
        },
      });
      const reviewed = job.systemId === null ? null : await reviewFor(job.systemId, result);
      if (job.state !== 'running') return; // stopped meanwhile
      job.result = result;
      job.review = reviewed?.review;
      job.stamp = reviewed?.stamp ?? null;
      finish(job, 'done', '');
      const { counts } = result.summary;
      ctx.log.info('systems.scan-done', {
        scanId: job.id,
        tokens: SECTION_ORDER.reduce((sum, section) => sum + counts[section], 0),
        fonts: counts.fonts,
        logos: counts.logos,
        files: result.scanned.length,
        partial: result.summary.partial,
        ms: now() - job.startedAt,
      });
    } catch (error) {
      if (error instanceof ScanStopped || job.state !== 'running') return;
      finish(job, 'failed', error instanceof ApiError ? error.message : scanFailedMessage(job.directory));
      ctx.log.warn('systems.scan-failed', { scanId: job.id, error: error instanceof Error ? error.name : 'unknown', ms: now() - job.startedAt });
    } finally {
      prune();
    }
  };

  const jobOf = (scanId: string): Job => {
    prune();
    const job = typeof scanId === 'string' && SCAN_ID_PATTERN.test(scanId) ? jobs.get(scanId) : undefined;
    if (job === undefined) throw gone();
    return job;
  };

  return {
    async start(input) {
      prune();
      if ([...jobs.values()].filter((job) => job.state === 'running').length >= SCANS_RUNNING_MAX) throw new ApiError('conflict', SCANS_BUSY_MESSAGE);
      const root = ctx.settings.root();
      let systemId: string | null = null;
      if (input.systemId !== undefined) {
        if (typeof input.systemId !== 'string' || !SYSTEM_ID_PATTERN.test(input.systemId)) throw new ApiError('bad-request', 'That is not a design system id.');
        const state = await ensureSystemStore(ctx).readState(input.systemId); // 404 sentence when it is gone
        // T13: a repo-backed system is re-read from its repo folder (§7.4), not reviewed against code provenance.
        if (state.home?.kind === 'repo') notBuilt();
        systemId = input.systemId;
      }
      const directory = await validateScanFolder(input.directory, root);
      // Checked again after the awaits: a third start could have slipped in.
      if ([...jobs.values()].filter((job) => job.state === 'running').length >= SCANS_RUNNING_MAX) throw new ApiError('conflict', SCANS_BUSY_MESSAGE);
      const job: Job = {
        id: newScanId(),
        root,
        systemId,
        directory,
        startedAt: now(),
        finishedAt: null,
        abort: new AbortController(),
        state: 'running',
        seen: 0,
        message: '',
        result: null,
        review: undefined,
        stamp: null,
        settled: Promise.resolve(),
      };
      jobs.set(job.id, job);
      job.settled = run(job);
      return { scanId: job.id };
    },

    get(scanId) {
      const job = jobOf(scanId);
      switch (job.state) {
        case 'running':
          return { state: 'running', seen: job.seen };
        case 'done': {
          // Safe: a job is `done` only after `result` was set (see `run`).
          const summary = job.result?.summary;
          if (summary === undefined) throw gone();
          return job.review === undefined ? { state: 'done', summary } : { state: 'done', summary, review: job.review };
        }
        default:
          return { state: job.state, message: job.message };
      }
    },

    cancel(scanId) {
      const job = jobOf(scanId);
      if (job.state === 'running') {
        finish(job, 'cancelled', SCAN_CANCELLED_MESSAGE);
        job.abort.abort();
        return;
      }
      jobs.delete(job.id);
    },

    result(scanId) {
      const job = jobOf(scanId);
      if (job.state === 'running') throw new ApiError('conflict', 'The scan is still running. Wait for it to finish.');
      if (job.state !== 'done' || job.result === null || !samePath(job.root, ctx.settings.root())) throw gone();
      return job.result;
    },

    resyncSource(scanId, systemId) {
      const job = jobOf(scanId);
      if (job.state === 'running') throw new ApiError('conflict', 'The scan is still running. Wait for it to finish.');
      if (job.state !== 'done' || job.result === null) throw gone();
      if (!samePath(job.root, ctx.settings.root())) throw new ApiError('conflict', RESYNC_ROOT_CHANGED_MESSAGE);
      if (job.systemId !== systemId || job.stamp === null) throw new ApiError('conflict', SCAN_OTHER_SYSTEM_MESSAGE);
      return { result: job.result, root: job.root, stamp: job.stamp };
    },

    async settled(scanId) {
      await jobOf(scanId).settled;
    },

    dispose() {
      unsubscribe();
      stopAll('cancelled', SCAN_CANCELLED_MESSAGE);
      jobs.clear();
    },
  };
};

// ---- making a system from a scan or a preset (§7.2) ----

/** One project file, contained: no link anywhere on the way (`resolvePlainTarget`), no link at the leaf (O_NOFOLLOW), ≤ `maxBytes`. */
export const readProjectFile = async (directory: string, rel: string, maxBytes: number): Promise<Buffer | null> => {
  let file: string;
  try {
    file = await resolvePlainTarget(directory, rel.split('/'));
  } catch {
    return null;
  }
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (handle === null) return null;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const bytes = Buffer.alloc(info.size);
    let filled = 0;
    while (filled < bytes.length) {
      const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return bytes.subarray(0, filled);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
};

/** The biggest asset a system takes (a document); fonts and logos are checked against their own cap after the read. */
export const ASSET_READ_MAX = 20 * 1024 * 1024;

const writeSeedText = async (systemDir: string, name: string, text: string): Promise<void> => {
  await writeFileAtomic(await resolvePlainTarget(systemDir, [name], { allowAbsent: true }), text, { createDirs: false });
};

/**
 * The seed of `POST /systems` (§7.2), or undefined for the plain empty system. Code: the scan's tokens
 * and the ticked fonts and logos (each must be one the scan offered), with provenance for re-sync.
 * Preset: its `:root` custom properties for every name the scan did not set. No `OVERVIEW.md`: the agent writes it.
 */
export const buildSystemSeed = async (ctx: ServiceContext, input: CreateSystemBody): Promise<SystemSeed | undefined> => {
  const scan = input.code === undefined ? null : ensureScanJobs(ctx).result(input.code.scanId);
  const ticked = input.code?.assets ?? [];
  const offered = new Map((scan?.assets ?? []).map((asset) => [asset.path, asset]));
  for (const rel of ticked) if (!offered.has(rel)) throw new ApiError('bad-request', 'One of the files to copy was not found by the scan. Scan the folder again.');

  const tokens: (SeedToken & { file?: string; line?: number })[] = (scan?.tokens ?? []).map((token) => ({ ...token }));
  const preset = input.description?.preset ?? null;
  if (preset !== null) {
    const read = await readPreset(ctx.packageRoot, preset);
    const have = new Set(tokens.map((token) => token.name));
    for (const token of read === null ? [] : presetRootTokens(read.text)) if (!have.has(token.name)) tokens.push(token);
  }
  if (scan === null && tokens.length === 0) return undefined;

  const write = async (systemDir: string): Promise<void> => {
    const fonts: { file: string; family: string; weight: number; style: 'normal' | 'italic' }[] = [];
    const logos: { file: string; variant: string }[] = [];
    const taken: Record<'font' | 'logo', string[]> = { font: [], logo: [] };
    // One file at a time, so memory holds one asset.
    for (const rel of ticked) {
      const asset = offered.get(rel);
      if (asset === undefined || scan === null) continue;
      const bytes = await readProjectFile(scan.directory, rel, ASSET_READ_MAX);
      const name = rel.split('/').at(-1) ?? rel;
      const check = bytes === null ? null : checkAsset(name, asset.kind, bytes);
      if (bytes === null || check === null || !check.ok) {
        // Changed or gone since the scan: the system is made without it, and the agent can add it.
        ctx.log.warn('systems.seed-asset-skipped', { kind: asset.kind, reason: bytes === null ? 'unreadable' : 'refused' });
        continue;
      }
      const segments = FOLDER_OF_KIND[asset.kind];
      await ensureFolder(systemDir, segments);
      const finalName = safeAssetName(name, taken[asset.kind]);
      taken[asset.kind].push(finalName);
      const file = [...segments, finalName].join('/');
      await writeFile(await resolvePlainTarget(systemDir, [...segments, finalName], { allowAbsent: true }), bytes, { flag: 'wx' });
      if (asset.kind === 'font') {
        const guess = guessFontFace(file);
        const style = asset.style === 'italic' ? 'italic' : asset.style === 'normal' ? 'normal' : guess.style;
        fonts.push({ file, family: asset.family ?? guess.family, weight: asset.weight ?? guess.weight, style });
      } else {
        logos.push({ file, variant: guessLogoVariant(file) });
      }
    }
    await writeSeedText(systemDir, 'tokens.css', seedTokensCss(tokens));
    await writeSeedText(systemDir, 'system.json', seedSystemJson(tokens, fonts, logos));
  };

  if (scan === null) return { write };
  const provenance: SystemState['provenance'] = {};
  for (const token of scan.tokens) provenance[token.name] = { file: token.file, line: token.line, light: token.light, dark: token.dark };
  return {
    write,
    code: {
      source: { directory: scan.directory, lastScan: scan.at, partial: scan.summary.partial, scanned: scan.scanned },
      provenance,
    },
  };
};

// ---- the context accessor (the `ensureSystemStore` pattern) ----

const instances = new WeakMap<ServiceContext, ScanJobs>();

/** The one scan registry of a composed service; created on first use and disposed with the service. */
export const ensureScanJobs = (ctx: ServiceContext): ScanJobs => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createScanJobs(ctx);
  instances.set(ctx, created);
  ctx.onDispose(() => created.dispose());
  return created;
};

/** Test seam: a registry with its own limits and clock, installed as the context's one. */
export const installScanJobs = (ctx: ServiceContext, options: ScanJobsOptions): ScanJobs => {
  instances.get(ctx)?.dispose();
  const created = createScanJobs(ctx, options);
  instances.set(ctx, created);
  ctx.onDispose(() => created.dispose());
  return created;
};
