// One design check, end to end (documentation/specs/agent-render-and-check.md §4): static
// checks, then (when a browser exists and the caller wants it) rendering, then the report and its
// PNGs on disk. The CLI and the service's "Check rendering" job both call `runCheck`.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CHECK_ARTBOARDS_MAX, CHECK_STATIC_BUDGET_MS } from '../../shared/limits.ts';
import type { ArtboardCheck, CheckBrowser, CheckFindingData, CheckReport, DesignJson, RenderCheckState, Viewport } from '../../shared/types.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, createLiveFileSource } from '../bundle.ts';
import { removeStaleWorkDirs, thumbWorkParent } from '../thumbnails.ts';
import { checkBrowserArgs, openCdp } from './cdp.ts';
import { cleanupRuns, createRunDir, ensureChamberDir, newRunId, pngNames, pngRelOf, pngStem, reportPathOf, writeCheckReport, writePng } from './output.ts';
import { renderArtboards, type LoadedDocument, type PlannedArtboard } from './render.ts';
import { entryKeyOf, runStaticChecks, type StaticRun } from './static.ts';
import { normalizeExternalUrl } from '../../shared/checks.ts';

const WORK_PREFIX = 'dc-check-';
const BROWSER_START_MS = 20_000;

/** The caller asked for something this design cannot do (an unknown screen). Exit 2 in the CLI. */
export class CheckUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckUsageError';
  }
}

/** The run was stopped (Ctrl-C, shutdown) before it finished: no report is written, so nothing half-done reads as a result. */
export class CheckInterrupted extends Error {
  constructor() {
    super('The check was interrupted, so no report was saved.');
    this.name = 'CheckInterrupted';
  }
}

/** Basename class of a browser path: never the path itself (it can hold a user name). */
export const browserClassOf = (browserPath: string): CheckBrowser => {
  const name = browserPath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (name.includes('msedge') || name.includes('edge')) return 'msedge';
  if (name.includes('brave')) return 'brave';
  if (name.includes('chromium')) return 'chromium';
  if (name.includes('chrome')) return 'chrome';
  return 'other';
};

/**
 * Artboards in wall order: a canvas lists each screen that has a file, at the viewports it
 * shows; a page lists `index.html` at every viewport. `only` keeps the named screens.
 */
export const planArtboards = (input: { design: DesignJson; entries: StaticRun['entries']; only?: readonly string[] }): PlannedArtboard[] => {
  const { design, entries } = input;
  if (design.kind === 'page') {
    const entry = entries[0];
    return entry === undefined ? [] : design.viewports.map((viewport) => ({ file: entry.rel, screen: null, viewport }));
  }
  const plan: PlannedArtboard[] = [];
  for (const screen of design.screens) {
    if (input.only !== undefined && !input.only.includes(screen.id)) continue;
    if (!entries.some((entry) => entry.rel === screen.file)) continue;
    const shown: Viewport[] = screen.viewports === undefined ? design.viewports : design.viewports.filter((viewport) => screen.viewports?.includes(viewport.id));
    for (const viewport of shown) plan.push({ file: screen.file, screen: screen.id, viewport });
  }
  return plan;
};

export type RunCheckInput = {
  /** An existing, contained design folder. */
  designDir: string;
  slug: string;
  /** Canvas only: check just these screens. */
  screens?: string[];
  /** Files only: no browser, nothing written. */
  staticOnly?: boolean;
  tool: 'cli' | 'service';
  /** `null` = no browser found. */
  browserPath: string | null;
  probeSource: string;
  platform: NodeJS.Platform;
  isRoot: boolean;
  now: () => Date;
  signal?: AbortSignal;
  /** Where throwaway profiles go on Windows and macOS. */
  tmpdir?: string;
  /** Time limits; the defaults are `CHECK_ARTBOARD_TIMEOUT_MS` and `CHECK_RUN_BUDGET_MS`. Tests shorten them. */
  budgets?: { artboardMs?: number; runMs?: number };
};

export type RunCheckResult = {
  report: CheckReport;
  /** Absolute `check.json`, or `null` when nothing was written (`staticOnly`). */
  reportPath: string | null;
  /** Absolute PNG paths of this run, in artboard order. */
  pngs: string[];
  design: DesignJson;
  entryCount: number;
};

const unavailableRender = (keys: StaticRun['keys'], planned: number): NonNullable<CheckReport['render']> => ({
  state: 'unavailable',
  browser: null,
  keys,
  artboards: [],
  skipped: planned,
  findings: [{ code: 'browser-missing', file: null, screen: null, viewport: null }],
});

export const runCheck = async (input: RunCheckInput): Promise<RunCheckResult> => {
  const { designDir } = input;
  const staticRun = await runStaticChecks(designDir, CHECK_STATIC_BUDGET_MS);
  const { design, kind } = staticRun;
  const base = { version: 1 as const, slug: input.slug, kind, createdAt: input.now().toISOString(), tool: input.tool, static: { findings: staticRun.findings } };
  const done = (report: CheckReport, reportPath: string | null, pngs: string[]): RunCheckResult => ({ report, reportPath, pngs, design, entryCount: staticRun.entries.length });

  if (input.screens !== undefined) {
    if (kind === 'page') throw new CheckUsageError('This design is a page, so it has no screens to pick.');
    for (const id of input.screens) {
      if (!design.screens.some((screen) => screen.id === id)) throw new CheckUsageError(`There is no screen "${id}" in this design.`);
    }
  }
  if (input.staticOnly === true) return done({ ...base, render: null }, null, []);

  const planned = planArtboards({ design, entries: staticRun.entries, ...(input.screens ? { only: input.screens } : {}) });
  const plan = planned.slice(0, CHECK_ARTBOARDS_MAX);
  const overLimit = planned.length - plan.length;

  if (input.browserPath === null) {
    const render = unavailableRender(staticRun.keys, planned.length);
    return done({ ...base, render }, await writeCheckReport(designDir, { ...base, render }), []);
  }

  // Everything the run writes is inside the design's `.chamber/`, and lands there only through output.ts.
  await ensureChamberDir(designDir);
  const parent = thumbWorkParent(input.platform, designDir, input.tmpdir ?? os.tmpdir());
  if (parent !== (input.tmpdir ?? os.tmpdir())) await removeStaleWorkDirs(parent, WORK_PREFIX);
  const workDir = await mkdtemp(path.join(parent, WORK_PREFIX));
  const runId = newRunId(input.now());
  const stems: string[] = [];
  /** Every file written, including slices of an artboard that failed afterwards. */
  const written: string[] = [];
  const renderKeys: Record<string, string> = {};
  const source = createLiveFileSource(designDir);
  let cached: { file: string; html: string } | null = null;
  const browserPath = input.browserPath;

  const loadDocument = async (file: string): Promise<LoadedDocument> => {
    if (cached?.file === file) return { ok: true, html: cached.html };
    try {
      const bundle = await bundleDocument(source, file, { mode: 'export' });
      renderKeys[file] = entryKeyOf(file, bundle.inputs);
      cached = { file, html: bundle.html };
      return { ok: true, html: bundle.html };
    } catch (error) {
      if (error instanceof BundleTooLarge) return { ok: false, reason: 'too-large' };
      if (error instanceof BundleMissingEntry) return { ok: false, reason: 'missing' };
      throw error;
    }
  };

  const knownExternal = new Set(
    staticRun.findings.filter((finding) => finding.code === 'remote-ref' && finding.detail !== undefined).map((finding) => normalizeExternalUrl(finding.detail ?? '') ?? finding.detail ?? ''),
  );

  try {
    if (plan.length > 0) await createRunDir(designDir, runId);
    const outcome = await renderArtboards({
      openBrowser: () => openCdp(browserPath, checkBrowserArgs({ workDir, platform: input.platform, isRoot: input.isRoot, join: path.join }), { timeoutMs: BROWSER_START_MS }),
      plan,
      kind,
      loadDocument,
      probeSource: input.probeSource,
      knownExternal,
      savePng: async (art, slice, slices, bytes) => {
        stems.push(pngStem({ screen: art.screen, viewport: art.viewport.id, slice, slices }));
        const name = pngNames(stems).at(-1) ?? 'artboard.png';
        written.push(await writePng(designDir, runId, name, bytes));
        return pngRelOf(runId, name);
      },
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.budgets?.artboardMs !== undefined ? { artboardTimeoutMs: input.budgets.artboardMs } : {}),
      ...(input.budgets?.runMs !== undefined ? { runBudgetMs: input.budgets.runMs } : {}),
    });

    if (input.signal?.aborted || outcome.stoppedBy === 'aborted') {
      await rm(path.join(designDir, '.chamber', 'check', runId), { recursive: true, force: true }).catch(() => undefined);
      throw new CheckInterrupted();
    }
    const findings: CheckFindingData[] = [...outcome.findings];
    if (outcome.unavailable) {
      findings.push({ code: 'render-failed', file: null, screen: null, viewport: null, detail: "This browser build can't be driven. Set another browser in Settings." });
    }
    const skipped = overLimit + outcome.notRendered;
    if (!outcome.unavailable) {
      // One note per reason, each saying its own: the artboard limit, the time budget, or a browser that kept failing.
      if (overLimit > 0) findings.push({ code: 'render-skipped', file: null, screen: null, viewport: null, params: { count: overLimit, max: CHECK_ARTBOARDS_MAX, reason: 'limit' } });
      if (outcome.notRendered > 0 && (outcome.stoppedBy === 'budget' || outcome.stoppedBy === 'failures')) {
        findings.push({ code: 'render-skipped', file: null, screen: null, viewport: null, params: { count: outcome.notRendered, max: CHECK_ARTBOARDS_MAX, reason: outcome.stoppedBy } });
      }
    }

    const okCount = outcome.artboards.filter((artboard: ArtboardCheck) => artboard.ok).length;
    const state: RenderCheckState = outcome.unavailable ? 'failed' : planned.length === 0 ? 'done' : okCount === 0 ? 'failed' : okCount < planned.length ? 'partial' : 'done';
    const render: NonNullable<CheckReport['render']> = {
      state,
      browser: browserClassOf(browserPath),
      keys: { design: staticRun.keys.design, entries: { ...staticRun.keys.entries, ...renderKeys } },
      artboards: outcome.artboards,
      skipped,
      findings,
    };
    const report: CheckReport = { ...base, render };
    const reportPath = await writeCheckReport(designDir, report);
    // The run's pictures are the ones the report names, in artboard order: the text report pairs them with artboards by position,
    // so a slice saved by an artboard that then timed out must not be in the list (and is removed).
    const pngs = outcome.artboards.flatMap((artboard) => artboard.pngs.map((rel) => path.join(designDir, ...rel.split('/'))));
    for (const orphan of written.filter((file) => !pngs.includes(file))) await rm(orphan, { force: true }).catch(() => undefined);
    if (pngs.length === 0) await rm(path.join(designDir, '.chamber', 'check', runId), { recursive: true, force: true }).catch(() => undefined);
    await cleanupRuns(designDir, pngs.length > 0 ? new Set([runId]) : new Set(), input.now().getTime());
    return done(report, reportPath, pngs);
  } finally {
    await rm(workDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
};

export { reportPathOf };
