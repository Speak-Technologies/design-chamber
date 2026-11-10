// The service half of design checks (documentation/specs/agent-render-and-check.md §3).
//
// `get` answers a design's findings: the STATIC checks, computed by the service itself on the
// current files (memoised until the design changes), and the RENDER part, read from
// `.chamber/check.json` (written by the agent's CLI or by `run`) and re-validated: severities and
// sentences come from the finding code, never from the file. A render result is `fresh` only when
// every file it was based on is unchanged. `run` renders on demand, one design at a time.

import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ChecksResponse, ChecksRunResponse } from '../../shared/api.ts';
import { countFindings, parseCheckReportText, sortFindings, withMessage } from '../../shared/checks.ts';
import { CHECK_FILE_MAX_BYTES, CHECK_STATIC_BUDGET_MS } from '../../shared/limits.ts';
import type { CheckFinding, CheckReport, DesignJson, Viewport } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { resolveBrowser, type BrowserResolution } from '../chrome.ts';
import { CheckInterrupted, runCheck } from './engine.ts';
import { runStaticChecks, type StaticRun } from './static.ts';

/** `page-height` notes are measurements for the agent's PNG list, not something to fix: left out of what the UI shows. */
const shown = (findings: CheckFinding[]): CheckFinding[] => findings.filter((finding) => finding.code !== 'page-height');

/** What "Ask the agent to fix" is built from: the same findings the counts cover, so the badge and the prompt always agree. */
export type ChecksForPrompt = { findings: CheckFinding[]; renderStale: boolean };

export type ChecksService = {
  get(slug: string): Promise<ChecksResponse>;
  forPrompt(slug: string): Promise<ChecksForPrompt>;
  /** 202-style: starts the job and answers at once. 409 while another design is being checked, 422 without a browser. */
  run(slug: string): Promise<ChecksRunResponse>;
};

export type ChecksDeps = {
  /** The probe source; defaults to the build's `__DC_PROBE__`. Tests inject it. */
  probeSource?: () => string | null;
  resolveBrowser?: () => BrowserResolution;
  platform?: NodeJS.Platform;
  isRoot?: () => boolean;
  now?: () => Date;
  /** Injectable for tests: the check itself. */
  runCheck?: typeof runCheck;
};

type StaticMemo = { run: StaticRun; at: string };

export const defaultProbeSource = (): string | null => (typeof __DC_PROBE__ === 'string' ? __DC_PROBE__ : null);

/** Whether the render result still describes the files: same design.json, same key for every file it covers. */
export const renderIsFresh = (report: CheckReport, current: StaticRun): boolean => {
  const render = report.render;
  if (render === null) return false;
  if (render.keys.design !== current.keys.design) return false;
  for (const [rel, key] of Object.entries(render.keys.entries)) {
    // A file the partial static run did not reach cannot be compared: it is not counted against the report.
    if (current.keys.entries[rel] !== key && !(current.partial && current.keys.entries[rel] === undefined)) return false;
  }
  // A document added since the run is not in it.
  return current.partial || current.entries.every((entry) => render.keys.entries[entry.rel] !== undefined);
};

export const createChecksService = (ctx: ServiceContext, deps: ChecksDeps = {}): ChecksService => {
  const { log } = ctx;
  const now = deps.now ?? (() => new Date());
  const platform = deps.platform ?? process.platform;
  const isRoot = deps.isRoot ?? (() => process.getuid?.() === 0);
  const probeSource = deps.probeSource ?? defaultProbeSource;
  const detect = deps.resolveBrowser ?? (() => resolveBrowser(ctx.settings.read()));

  const memos = new Map<string, Promise<StaticMemo>>();
  const unreadable = new Map<string, number>();
  let browserCache: { at: number; resolution: BrowserResolution } | null = null;
  const browser = (): BrowserResolution => {
    if (browserCache !== null && Date.now() - browserCache.at < 30_000) return browserCache.resolution;
    const resolution = detect();
    browserCache = { at: Date.now(), resolution };
    return resolution;
  };

  let job: { slug: string; controller: AbortController } | null = null;
  let disposed = false;

  const off = ctx.hub.subscribe((event) => {
    if (event.kind === 'root') {
      memos.clear();
      browserCache = null;
      return;
    }
    if (event.slug === null) return;
    if (event.kind === 'added' || event.kind === 'removed' || event.kind === 'design' || event.kind === 'files') memos.delete(event.slug);
  });
  ctx.onDispose(() => {
    disposed = true;
    off();
    job?.controller.abort();
  });

  const staticFor = (slug: string, designDir: string): Promise<StaticMemo> => {
    const known = memos.get(slug);
    if (known !== undefined) return known;
    const started = runStaticChecks(designDir, CHECK_STATIC_BUDGET_MS).then((run) => ({ run, at: now().toISOString() }));
    memos.set(slug, started);
    // A failed run is not memoised: the next request tries again.
    started.catch(() => {
      if (memos.get(slug) === started) memos.delete(slug);
    });
    return started;
  };

  /** `check.json` as a validated report, or `null` (absent, a link, too big, not valid). Logged once per mtime when present but unusable. */
  const readReport = async (slug: string, designDir: string): Promise<CheckReport | null> => {
    const chamber = path.join(designDir, '.chamber');
    const file = path.join(chamber, 'check.json');
    try {
      const dir = await lstat(chamber);
      if (dir.isSymbolicLink() || !dir.isDirectory()) return null;
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile() || info.size > CHECK_FILE_MAX_BYTES) {
        if (unreadable.get(slug) !== info.mtimeMs) {
          unreadable.set(slug, info.mtimeMs);
          log.warn('check.report-invalid', { slug, reason: info.isFile() ? 'too-large' : 'not-a-file' });
        }
        return null;
      }
      const report = parseCheckReportText(await readFile(file, 'utf8'));
      if (report === null && unreadable.get(slug) !== info.mtimeMs) {
        unreadable.set(slug, info.mtimeMs);
        log.warn('check.report-invalid', { slug, reason: 'invalid' });
      }
      return report;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') {
        log.warn('check.report-unreadable', { slug, code: (error as NodeJS.ErrnoException).code ?? null });
      }
      return null;
    }
  };

  const messaged = (findings: CheckReport['static']['findings'], viewports: readonly Viewport[]): CheckFinding[] => sortFindings(findings.map((finding) => withMessage(finding, viewports)));

  /** One computation for `get` and `forPrompt`: the response and the findings that are counted in it. */
  const build = async (slug: string): Promise<{ response: ChecksResponse; counted: CheckFinding[]; renderStale: boolean }> => {
    const record = await ctx.store.get(slug);
    const designDir = record.path;
    const [memo, report] = await Promise.all([staticFor(slug, designDir), readReport(slug, designDir)]);
    const design: DesignJson = memo.run.design;
    const viewports = design.viewports;

    const staticFindings = shown(messaged(memo.run.findings, viewports));
    const running = job?.slug === slug;
    const render = report?.render ?? null;
    const fresh = report !== null && renderIsFresh(report, memo.run);
    let state: ChecksResponse['render']['state'] = 'none';
    if (running) state = 'running';
    else if (render !== null) state = render.state === 'unavailable' || render.state === 'failed' ? render.state : fresh ? 'fresh' : 'stale';
    const renderFindings = render === null ? [] : shown(messaged(render.findings, viewports));
    // Only findings about the files as they are now count (whatever the render's own state: a timed-out screen is a real finding):
    // after an edit the old ones are listed, not counted.
    const countedRender = fresh && !running ? renderFindings : [];
    const counted = [...staticFindings, ...countedRender];
    const hasBrowser = browser().path !== null;
    const response: ChecksResponse = {
      static: { findings: staticFindings, partial: memo.run.partial, at: memo.at },
      render: {
        state,
        at: report?.createdAt ?? null,
        artboards: render?.artboards.length ?? 0,
        skipped: render?.skipped ?? 0,
        findings: renderFindings,
      },
      counts: countFindings(counted),
      canRun: job === null && hasBrowser,
      browser: hasBrowser,
    };
    return { response, counted, renderStale: render !== null && !fresh && !running };
  };

  return {
    get: async (slug) => (await build(slug)).response,

    async forPrompt(slug) {
      const { counted, renderStale } = await build(slug);
      return { findings: counted, renderStale };
    },

    async run(slug) {
      const record = await ctx.store.get(slug);
      if (job !== null) {
        if (job.slug === slug) return { state: 'running' };
        throw new ApiError('conflict', 'Another design is being checked. Try again in a moment.');
      }
      const resolution = browser();
      if (resolution.path === null) throw new ApiError('invalid', "No Chrome, Edge or Chromium browser was found, so Design Chamber can't render this design.");
      const probe = probeSource();
      if (probe === null) throw new ApiError('internal', 'The rendering check is not available in this build of Design Chamber.');
      if (disposed) throw new ApiError('internal', 'Design Chamber is shutting down. Try again in a moment.');

      const controller = new AbortController();
      job = { slug, controller };
      const browserPath = resolution.path;
      ctx.hub.emit({ slug, kind: 'checks' });
      void (deps.runCheck ?? runCheck)({
        designDir: record.path,
        slug,
        tool: 'service',
        browserPath,
        probeSource: probe,
        platform,
        isRoot: isRoot(),
        now,
        signal: controller.signal,
      })
        .catch((error: unknown) => {
          if (error instanceof CheckInterrupted) return; // shutting down
          log.warn('check.run-failed', { slug, error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          job = null;
          if (!disposed) ctx.hub.emit({ slug, kind: 'checks' });
        });
      return { state: 'running' };
    },
  };
};

const instances = new WeakMap<ServiceContext, ChecksService>();

/** One checks service per context (the routes and the prompt route share it). */
export const ensureChecksService = (ctx: ServiceContext, deps?: ChecksDeps): ChecksService => {
  const existing = instances.get(ctx);
  if (existing) return existing;
  const created = createChecksService(ctx, deps);
  instances.set(ctx, created);
  return created;
};
