// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11 `renderExamplePngs`, AD-31): component
// examples as PNG pictures for the living page.
//
// Each example is bundled on its own (relative to `components/`, export mode, so no bridge), wrapped in
// a fixed shell that carries the system's tokens.css and its fonts, and drawn by headless Chrome over
// CDP with scripts disabled, a CSP that refuses scripts, and every request but the document failed.
// Only the screenshot's pixels leave the browser, so whatever the example's markup does, the page
// receives an image. Pictures are cached by content under `.chamber/living-examples/<sha>.png`.

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  LIVING_EXAMPLE_HEIGHT_MAX,
  LIVING_EXAMPLE_PNG_MAX_BYTES,
  LIVING_EXAMPLE_SCALE,
  LIVING_EXAMPLE_TIMEOUT_MS,
  LIVING_EXAMPLE_WIDTH,
  LIVING_EXAMPLES_BUDGET_MS,
  LIVING_EXAMPLES_CACHE_MAX,
  LIVING_PAGE_ASSET_MAX_BYTES,
  LIVING_PAGE_GENERATOR_VERSION,
  SYSTEM_COMPONENTS_MAX,
  SYSTEM_ENTRY_ID_PATTERN,
} from '../../shared/limits.ts';
import type { SystemDetail } from '../../shared/types.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, dataUrlOf, type FileSource } from '../bundle.ts';
import { CdpError, CdpUnavailable, checkBrowserArgs, DEFAULT_LAUNCH_BUDGET_MS, launchOpenOptions, openCdp, type CdpSession, type OpenBrowserOptions } from '../check/cdp.ts';
import { CHECK_CSP, DOCUMENT_ORIGIN } from '../check/render.ts';
import { resolveBrowser } from '../chrome.ts';
import type { ServiceContext } from '../context.ts';
import { resolveInside, writeFileAtomic } from '../paths.ts';
import { pngSize, removeStaleWorkDirs, thumbWorkParent } from '../thumbnails.ts';
import { checkAsset } from './assets.ts';
import type { ExampleReason } from './living-html.ts';
import { guardSystemWrite } from './store.ts';

export type { ExampleReason };

/** One example picture; `width`/`height` are the PNG's own pixels (0 when there is none). */
export type ExampleShot = { component: string; scheme: 'light' | 'dark'; png: Uint8Array | null; width: number; height: number; reason: ExampleReason | null };

/** `CHECK_CSP` with `script-src 'none'` and no other change (§5.11 step 3). */
export const EXAMPLE_CSP = CHECK_CSP.replace(/script-src [^;]*/, "script-src 'none'");

const BROWSER_START_MS = 20_000;
/** A restart launch with less of the batch budget left than this is not started; the rest of the batch fails instead. */
const RESTART_LAUNCH_MIN_MS = 3000;
const WORK_PREFIX = 'dc-living-';
const CACHE_FOLDER = 'living-examples';
const CACHE_FILE = /^[0-9a-f]{64}\.png$/;
const VIEWPORT_HEIGHT = 800;
/** After load, a moment for fonts and layout to settle (no page script runs, so no `document.fonts.ready`). */
const SETTLE_MS = 150;

// ---- the shell and the plan (pure) ----

/** A `<style>` body never closes its element early. */
const styleText = (css: string): string => css.replace(/<\/style/gi, '<\\/style');

/** Holds every animation and transition at its end, so a picture is the same each time (reduced motion is emulated too). */
const STILL_CSS =
  '*, *::before, *::after { animation-delay: -1ms !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important; animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }';

/**
 * The fixed generator shell around one bundled example: the system's tokens and fonts, then the
 * scheme, at the start of `<head>` (the example's own CSS still wins where it says so).
 */
export const exampleShellHtml = (exampleHtml: string, shell: { tokensCss: string; fontsCss: string }, scheme: 'light' | 'dark'): string => {
  const block =
    `<meta name="color-scheme" content="${scheme}">` +
    `<style>${styleText(shell.tokensCss)}\n${styleText(shell.fontsCss)}\n:root { color-scheme: ${scheme}; }\n${STILL_CSS}</style>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(exampleHtml);
  if (head !== null) {
    const at = head.index + head[0].length;
    return exampleHtml.slice(0, at) + block + exampleHtml.slice(at);
  }
  const anchor = /<html(?:\s[^>]*)?>/i.exec(exampleHtml) ?? /<!doctype[^>]*>/i.exec(exampleHtml);
  if (anchor !== null) {
    const at = anchor.index + anchor[0].length;
    return `${exampleHtml.slice(0, at)}<head>${block}</head>${exampleHtml.slice(at)}`;
  }
  return `<!doctype html><html><head>${block}</head><body>${exampleHtml}</body></html>`;
};

export type PlannedShot = { component: string; scheme: 'light' | 'dark'; key: string; html: string };

/** The cache key (§5.11 step 2): every input of the picture, each length-prefixed so no two inputs run together. */
export const exampleCacheKey = (input: { exampleHtml: string; tokensCss: string; fontsCss: string; scheme: 'light' | 'dark' }): string => {
  const hash = createHash('sha256');
  for (const part of [input.exampleHtml, input.tokensCss, input.fontsCss, input.scheme, String(LIVING_EXAMPLE_WIDTH), String(LIVING_EXAMPLE_SCALE), String(LIVING_PAGE_GENERATOR_VERSION)]) {
    const bytes = Buffer.from(part, 'utf8');
    hash.update(`${bytes.length}:`).update(bytes);
  }
  return hash.digest('hex');
};

/** One shot per example per scheme, in component order then light before dark; at most `SYSTEM_COMPONENTS_MAX` examples. */
export const planExampleShots = (
  examples: readonly { component: string; html: string }[],
  shell: { tokensCss: string; fontsCss: string },
  schemes: readonly ('light' | 'dark')[],
): PlannedShot[] => {
  const order = (['light', 'dark'] as const).filter((scheme) => schemes.includes(scheme));
  const out: PlannedShot[] = [];
  for (const example of examples.slice(0, SYSTEM_COMPONENTS_MAX)) {
    for (const scheme of order) {
      out.push({
        component: example.component,
        scheme,
        key: exampleCacheKey({ exampleHtml: example.html, tokensCss: shell.tokensCss, fontsCss: shell.fontsCss, scheme }),
        html: exampleShellHtml(example.html, shell, scheme),
      });
    }
  }
  return out;
};

/** The clip height of a shot: the content height in CSS px, at least 1, at most `LIVING_EXAMPLE_HEIGHT_MAX`. */
export const clipHeightOf = (metrics: { cssContentSize?: { height?: unknown }; contentSize?: { height?: unknown } }): number => {
  const raw = metrics.cssContentSize?.height ?? metrics.contentSize?.height;
  const height = typeof raw === 'number' && Number.isFinite(raw) ? Math.ceil(raw) : VIEWPORT_HEIGHT;
  return Math.max(1, Math.min(LIVING_EXAMPLE_HEIGHT_MAX, height));
};

// ---- fonts for the shell ----

const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

/**
 * The system's fonts as `@font-face` rules with embedded data (the picture never carries a font file,
 * so licences don't apply to it; §5.11 step 1). A file that isn't a usable font is left out.
 */
export const shellFontsCss = async (detail: SystemDetail, source: FileSource): Promise<string> => {
  const rules: string[] = [];
  for (const font of detail.fonts) {
    if (!FONT_FAMILY.test(font.family) || !/^assets\/fonts\/[^/]+$/.test(font.file)) continue;
    const file = await source.read(font.file).catch(() => null);
    if (file === null || file.bytes.length > LIVING_PAGE_ASSET_MAX_BYTES || !checkAsset(path.posix.basename(font.file), 'font', file.bytes).ok) continue;
    const weight = Number.isInteger(font.weight) && font.weight >= 1 && font.weight <= 1000 ? font.weight : 400;
    rules.push(`@font-face { font-family: "${font.family}"; src: url("${dataUrlOf(font.file, file.bytes)}"); font-weight: ${weight}; font-style: ${font.style === 'italic' ? 'italic' : 'normal'}; }`);
  }
  return rules.join('\n');
};

// ---- the browser part ----

export type ExampleDeps = {
  /** Start a browser; `null` = none is installed (every shot `no-browser`). Default: the setting or detection. */
  openBrowser?: ((options?: OpenBrowserOptions) => Promise<CdpSession>) | null;
  clock?: () => number;
  shotTimeoutMs?: number;
  budgetMs?: number;
  settleMs?: number;
};

type Page = { targetId: string; sessionId: string; send: <T = Record<string, unknown>>(method: string, params?: object) => Promise<T> };
type Serving = { url: string; html: Buffer; served: boolean };

class ShotTimeout extends Error {}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One page for the batch; every request but the current document is failed, so nothing leaves (as `render.ts`). */
const openPage = async (session: CdpSession, serving: { current: Serving | null }, shotMs: number): Promise<Page> => {
  const { targetId } = await session.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  const page: Page = { targetId, sessionId, send: (method, params) => session.send(method, params, { sessionId, timeoutMs: shotMs }) };
  await page.send('Page.enable');
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // Before any navigation: no script of any document this page loads ever runs.
  await page.send('Emulation.setScriptExecutionDisabled', { value: true });
  session.on('Fetch.requestPaused', (event) => {
    if (event.sessionId !== sessionId) return;
    const requestId = String(event.params.requestId);
    const url = String((event.params.request as { url?: unknown } | undefined)?.url ?? '');
    const respond = (method: string, params: object): void => {
      page.send(method, { requestId, ...params }).catch(() => undefined);
    };
    const current = serving.current;
    if (current !== null && url === current.url && !current.served) {
      current.served = true;
      respond('Fetch.fulfillRequest', {
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'text/html; charset=utf-8' },
          { name: 'content-security-policy', value: EXAMPLE_CSP },
          { name: 'cache-control', value: 'no-store' },
        ],
        body: current.html.toString('base64'),
      });
      return;
    }
    if (url.startsWith('data:') || url.startsWith('about:')) {
      respond('Fetch.continueRequest', {});
      return;
    }
    respond('Fetch.failRequest', { errorReason: 'BlockedByClient' });
  });
  return page;
};

const shoot = async (session: CdpSession, page: Page, serving: { current: Serving | null }, shot: PlannedShot, counter: number, settleMs: number, alive: { value: boolean }): Promise<Buffer> => {
  const url = `${DOCUMENT_ORIGIN}/living/${counter}/${shot.component}-${shot.scheme}.html`;
  serving.current = { url, html: Buffer.from(shot.html, 'utf8'), served: false };
  let loaded: () => void = () => undefined;
  const loadFired = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  const off = session.on('Page.loadEventFired', (event) => {
    if (event.sessionId === page.sessionId) loaded();
  });
  const guard = (): void => {
    if (!alive.value) throw new ShotTimeout();
  };
  try {
    await page.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'prefers-color-scheme', value: shot.scheme },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    await page.send('Emulation.setDeviceMetricsOverride', { width: LIVING_EXAMPLE_WIDTH, height: VIEWPORT_HEIGHT, deviceScaleFactor: LIVING_EXAMPLE_SCALE, mobile: false });
    const navigation = await page.send<{ errorText?: string }>('Page.navigate', { url });
    guard();
    if (navigation.errorText) throw new CdpError('Page.navigate', navigation.errorText);
    await loadFired;
    guard();
    if (settleMs > 0) await delay(settleMs);
    guard();
    // The height from the browser's own layout, never from page script.
    const metrics = await page.send<{ cssContentSize?: { height?: unknown }; contentSize?: { height?: unknown } }>('Page.getLayoutMetrics');
    guard();
    const height = clipHeightOf(metrics);
    const shotResult = await page.send<{ data?: unknown }>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: LIVING_EXAMPLE_WIDTH, height, scale: 1 },
    });
    guard();
    if (typeof shotResult.data !== 'string') throw new CdpError('Page.captureScreenshot', 'no picture');
    return Buffer.from(shotResult.data, 'base64');
  } finally {
    off();
  }
};

const withTimeout = async <T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new ShotTimeout());
    }, ms);
  });
  work.catch(() => undefined); // a late failure after the timeout is not unhandled
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * Draws the planned shots that have no cached picture, one at a time on one browser. A browser that
 * fails twice in a row is restarted once (the check engine's rule); a third failure in a row, the
 * batch budget or an abort leaves the rest `render-failed`. Answers the PNG bytes or a reason per key.
 */
export const drawShots = async (
  shots: readonly PlannedShot[],
  options: { openBrowser: (launch?: OpenBrowserOptions) => Promise<CdpSession>; signal?: AbortSignal; clock?: () => number; shotTimeoutMs?: number; budgetMs?: number; settleMs?: number },
): Promise<Map<string, { png: Buffer } | { reason: ExampleReason }>> => {
  const out = new Map<string, { png: Buffer } | { reason: ExampleReason }>();
  if (shots.length === 0) return out;
  const clock = options.clock ?? Date.now;
  const shotMs = options.shotTimeoutMs ?? LIVING_EXAMPLE_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? LIVING_EXAMPLES_BUDGET_MS;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const started = clock();
  const failRest = (from: number, reason: ExampleReason): void => {
    for (const shot of shots.slice(from)) if (!out.has(shot.key)) out.set(shot.key, { reason });
  };

  let session: CdpSession;
  try {
    session = await options.openBrowser(options.signal ? { signal: options.signal } : {});
  } catch (error) {
    if (error instanceof CdpUnavailable || error instanceof CdpError) {
      failRest(0, 'render-failed');
      return out;
    }
    throw error;
  }
  const serving: { current: Serving | null } = { current: null };
  let page: Page | null = null;
  let failures = 0;
  let restarted = false;
  let counter = 0;
  let live: { value: boolean } | null = null;
  const onAbort = (): void => {
    if (live !== null) live.value = false;
    void session.close();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await session.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
    for (const [index, shot] of shots.entries()) {
      if (out.has(shot.key)) continue; // the same picture twice in one batch
      if (options.signal?.aborted === true || clock() - started > budgetMs || failures >= 3) {
        failRest(index, 'render-failed');
        break;
      }
      if ((failures >= 2 || session.exited) && !restarted) {
        restarted = true;
        await session.close();
        // The restart gets only what is left of the batch budget (a slow first launch has used some of it).
        const left = started + budgetMs - clock();
        if (left < RESTART_LAUNCH_MIN_MS) {
          failRest(index, 'render-failed');
          break;
        }
        try {
          session = await options.openBrowser({ launchBudgetMs: Math.min(DEFAULT_LAUNCH_BUDGET_MS, left), ...(options.signal ? { signal: options.signal } : {}) });
          await session.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
          page = null;
        } catch {
          failRest(index, 'render-failed');
          break;
        }
      } else if (session.exited) {
        failRest(index, 'render-failed');
        break;
      }
      const alive = { value: true };
      live = alive;
      try {
        page ??= await openPage(session, serving, shotMs);
        counter += 1;
        const current = page;
        const png = await withTimeout(shoot(session, current, serving, shot, counter, settleMs, alive), shotMs, () => {
          alive.value = false;
        });
        failures = 0;
        if (png.length > LIVING_EXAMPLE_PNG_MAX_BYTES) out.set(shot.key, { reason: 'too-large' });
        else if (pngSize(png) === null) out.set(shot.key, { reason: 'render-failed' });
        else out.set(shot.key, { png });
      } catch (error) {
        if (!(error instanceof ShotTimeout || error instanceof CdpError || error instanceof CdpUnavailable)) throw error;
        failures += 1;
        out.set(shot.key, { reason: 'render-failed' });
        const stale = page;
        page = null;
        if (stale !== null) await session.send('Target.closeTarget', { targetId: stale.targetId }, { timeoutMs: 3000 }).catch(() => undefined);
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    await session.close().catch(() => undefined);
  }
  failRest(0, 'render-failed');
  return out;
};

// ---- the cache ----

/** Keys used by each system's last two regenerations, per process (§5.11 step 4). */
const recentUse = new WeakMap<ServiceContext, Map<string, string[][]>>();

const cacheDirOf = async (ctx: ServiceContext, id: string, systemDir: string): Promise<string | null> => {
  try {
    const chamber = await resolveInside(systemDir, ['.chamber']);
    await guardSystemWrite(ctx.settings.root(), chamber, id, ctx.log);
    await mkdir(chamber, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const dir = await resolveInside(systemDir, ['.chamber', CACHE_FOLDER]);
    await mkdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const info = await lstat(dir);
    return info.isDirectory() && !info.isSymbolicLink() ? dir : null;
  } catch (error) {
    ctx.log.warn('systems.living-examples.cache-unavailable', { system: id, error: error instanceof Error ? error.name : 'error' });
    return null;
  }
};

const readCached = async (dir: string | null, key: string): Promise<Buffer | null> => {
  if (dir === null) return null;
  const file = path.join(dir, `${key}.png`);
  const info = await lstat(file).catch(() => null);
  if (info === null || !info.isFile() || info.size > LIVING_EXAMPLE_PNG_MAX_BYTES) return null;
  const bytes = await readFile(file).catch(() => null);
  return bytes !== null && pngSize(bytes) !== null ? bytes : null;
};

/** Removes pictures neither of the last two regenerations used (once two are known), and the oldest past the cap. */
const pruneCache = async (ctx: ServiceContext, id: string, dir: string, used: readonly string[]): Promise<void> => {
  let bySystem = recentUse.get(ctx);
  if (bySystem === undefined) {
    bySystem = new Map();
    recentUse.set(ctx, bySystem);
  }
  const history = [...(bySystem.get(id) ?? []), [...used]].slice(-2);
  bySystem.set(id, history);
  const keep = new Set(history.flat());
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => CACHE_FILE.test(name));
  const now = new Date();
  for (const key of used) await utimes(path.join(dir, `${key}.png`), now, now).catch(() => undefined);
  const left: { name: string; at: number }[] = [];
  for (const name of names) {
    if (history.length >= 2 && !keep.has(name.slice(0, 64))) {
      await rm(path.join(dir, name), { force: true }).catch(() => undefined);
      continue;
    }
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info !== null) left.push({ name, at: info.mtimeMs });
  }
  if (left.length <= LIVING_EXAMPLES_CACHE_MAX) return;
  left.sort((a, b) => a.at - b.at);
  for (const { name } of left.slice(0, left.length - LIVING_EXAMPLES_CACHE_MAX)) {
    if (!keep.has(name.slice(0, 64))) await rm(path.join(dir, name), { force: true }).catch(() => undefined);
  }
};

// ---- the entry point ----

const configured = new WeakMap<ServiceContext, ExampleDeps>();

/** Test seam: the browser and clocks this context's example pictures use. */
export const configureLivingExamples = (ctx: ServiceContext, deps: ExampleDeps): void => {
  configured.set(ctx, deps);
};

const defaultOpenBrowser = (ctx: ServiceContext, systemDir: string, workDirs: string[]): ((launch?: OpenBrowserOptions) => Promise<CdpSession>) | null => {
  const browserPath = resolveBrowser(ctx.settings.read()).path;
  if (browserPath === null) return null;
  return async (launch) => {
    const parent = thumbWorkParent(process.platform, systemDir, os.tmpdir());
    if (parent !== os.tmpdir()) await removeStaleWorkDirs(parent, WORK_PREFIX);
    const workDir = await mkdtemp(path.join(parent, WORK_PREFIX));
    workDirs.push(workDir);
    return openCdp(browserPath, checkBrowserArgs({ workDir, platform: process.platform, isRoot: process.getuid?.() === 0, join: path.join }), launchOpenOptions(launch, BROWSER_START_MS));
  };
};

/**
 * Every example of `detail` as a picture per scheme (§5.11). `source` reads the system's files (the
 * snapshot, or the proposal); `systemDir` holds the cache. Never throws for a browser problem: a
 * missing browser makes every uncached shot `no-browser`, a failing one `render-failed`.
 */
export const renderExamplePngs = async (
  ctx: ServiceContext,
  detail: SystemDetail,
  options: { schemes: ('light' | 'dark')[]; signal: AbortSignal; source: FileSource; id: string; systemDir: string },
): Promise<ExampleShot[]> => {
  const deps = configured.get(ctx) ?? {};
  const examples: { component: string; html: string }[] = [];
  const failed: string[] = [];
  for (const component of detail.components.slice(0, SYSTEM_COMPONENTS_MAX)) {
    if (component.example === null || !SYSTEM_ENTRY_ID_PATTERN.test(component.id)) continue;
    try {
      const bundled = await bundleDocument(options.source, `components/${component.id}.html`, { mode: 'export' });
      examples.push({ component: component.id, html: bundled.html });
    } catch (error) {
      if (!(error instanceof BundleTooLarge || error instanceof BundleMissingEntry)) throw error;
      failed.push(component.id);
    }
  }
  const tokens = await options.source.read('tokens.css').catch(() => null);
  const shell = { tokensCss: tokens?.bytes.toString('utf8') ?? '', fontsCss: await shellFontsCss(detail, options.source) };
  const plan = planExampleShots(examples, shell, options.schemes);

  const dir = plan.length > 0 ? await cacheDirOf(ctx, options.id, options.systemDir) : null;
  const pictures = new Map<string, Buffer>();
  const misses: PlannedShot[] = [];
  for (const shot of plan) {
    if (pictures.has(shot.key) || misses.some((miss) => miss.key === shot.key)) continue;
    const cached = await readCached(dir, shot.key);
    if (cached !== null) pictures.set(shot.key, cached);
    else misses.push(shot);
  }

  const reasons = new Map<string, ExampleReason>();
  if (misses.length > 0) {
    const workDirs: string[] = [];
    const openBrowser = deps.openBrowser === undefined ? defaultOpenBrowser(ctx, options.systemDir, workDirs) : deps.openBrowser;
    try {
      if (openBrowser === null) {
        for (const shot of misses) reasons.set(shot.key, 'no-browser');
      } else {
        const drawn = await drawShots(misses, {
          openBrowser,
          signal: options.signal,
          ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
          ...(deps.shotTimeoutMs !== undefined ? { shotTimeoutMs: deps.shotTimeoutMs } : {}),
          ...(deps.budgetMs !== undefined ? { budgetMs: deps.budgetMs } : {}),
          ...(deps.settleMs !== undefined ? { settleMs: deps.settleMs } : {}),
        });
        for (const [key, result] of drawn) {
          if ('reason' in result) {
            reasons.set(key, result.reason);
            continue;
          }
          pictures.set(key, result.png);
          if (dir !== null) await writeFileAtomic(path.join(dir, `${key}.png`), result.png, { createDirs: false }).catch((error: unknown) => ctx.log.warn('systems.living-examples.cache-write-failed', { system: options.id, error: error instanceof Error ? error.name : 'error' }));
        }
      }
    } finally {
      for (const workDir of workDirs) await rm(workDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  }
  if (dir !== null) await pruneCache(ctx, options.id, dir, [...pictures.keys()]);

  const out: ExampleShot[] = [];
  for (const id of failed) for (const scheme of options.schemes) out.push({ component: id, scheme, png: null, width: 0, height: 0, reason: 'render-failed' });
  for (const shot of plan) {
    const png = pictures.get(shot.key) ?? null;
    const size = png === null ? null : pngSize(png);
    out.push(
      png !== null && size !== null
        ? { component: shot.component, scheme: shot.scheme, png, width: size.width, height: size.height, reason: null }
        : { component: shot.component, scheme: shot.scheme, png: null, width: 0, height: 0, reason: reasons.get(shot.key) ?? 'render-failed' },
    );
  }
  return out;
};
