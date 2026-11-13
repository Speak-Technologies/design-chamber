// The rendering half of a check (documentation/specs/agent-render-and-check.md §4.3): each
// artboard (one screen at one viewport) is bundled like the in-app wall renders it, served to
// headless Chrome from memory under a CSP that mirrors the guest frame, measured by the probe and
// captured as PNG slices. The page may not reach the network: every request but the one document
// is failed here, and the browser itself has no DNS and a dead proxy (`checkBrowserArgs`).

import {
  CHECK_ARTBOARD_TIMEOUT_MS,
  CHECK_DETAIL_MAX,
  CHECK_RUN_BUDGET_MS,
  CHECK_SLICES_MAX,
  CHECK_TEXT_ELEMENTS_MAX,
} from '../../shared/limits.ts';
import { cleanDetail, normalizeExternalUrl } from '../../shared/checks.ts';
import type { ArtboardCheck, CheckFindingData, DesignKind, Viewport } from '../../shared/types.ts';
import { analyzeProbe, capPerCode, sanitizeProbe } from './analyze.ts';
import { CdpError, CdpUnavailable, type CdpEvent, type CdpSession } from './cdp.ts';

/** The response header every design document is served with: the guest frame's rules, offline. */
export const CHECK_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  'frame-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
].join('; ');

/** The synthetic origin documents are served from. `.invalid` never resolves. */
export const DOCUMENT_ORIGIN = 'https://design.invalid';

export type PlannedArtboard = { file: string; screen: string | null; viewport: Viewport };

export type LoadedDocument = { ok: true; html: string } | { ok: false; reason: 'missing' | 'too-large' };

export type RenderDeps = {
  /** Start a browser (used once, and once more after repeated failures). */
  openBrowser: () => Promise<CdpSession>;
  plan: readonly PlannedArtboard[];
  kind: DesignKind;
  loadDocument: (file: string) => Promise<LoadedDocument>;
  probeSource: string;
  /** Remote URLs the static pass already reports as `remote-ref`; a blocked request for one is not reported twice. */
  knownExternal: ReadonlySet<string>;
  /** Store one PNG slice; answers its design-relative path. */
  savePng: (artboard: PlannedArtboard, slice: number, slices: number, bytes: Buffer) => Promise<string>;
  clock?: () => number;
  signal?: AbortSignal;
  artboardTimeoutMs?: number;
  runBudgetMs?: number;
};

export type RenderOutcome = {
  artboards: ArtboardCheck[];
  findings: CheckFindingData[];
  /** Planned artboards that were never tried (budget, abort, repeated failure). */
  notRendered: number;
  /** Why `notRendered` is not zero. */
  stoppedBy: 'budget' | 'failures' | 'aborted' | null;
  /** The browser could not be started at all. */
  unavailable: boolean;
};

type Page = {
  targetId: string;
  sessionId: string;
  send: <T = Record<string, unknown>>(method: string, params?: object, timeoutMs?: number) => Promise<T>;
};

type Serving = { url: string; html: Buffer; served: boolean; blocked: string[] };

const openPage = async (session: CdpSession, serving: { current: Serving | null }): Promise<Page> => {
  const { targetId } = await session.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  const page: Page = { targetId, sessionId, send: (method, params, timeoutMs) => session.send(method, params, { sessionId, ...(timeoutMs ? { timeoutMs } : {}) }) };
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  // The storage stand-in (Phase 2 technical design §8.5): every artboard runs with empty, unsaved
  // localStorage/sessionStorage, in place before any design script so a design that legitimately
  // uses storage renders instead of failing with a console error. Registered once per page: it runs
  // on every new document, so each artboard starts empty and nothing carries over. The build always
  // embeds it; an unbundled run without it keeps the browser's own (throwing) storage.
  const storageShim = typeof __DC_STORAGE_SHIM__ === 'string' ? __DC_STORAGE_SHIM__ : '';
  if (storageShim !== '') await page.send('Page.addScriptToEvaluateOnNewDocument', { source: storageShim });
  session.on('Fetch.requestPaused', (event) => {
    if (event.sessionId !== sessionId) return;
    const requestId = String(event.params.requestId);
    const url = String((event.params.request as { url?: unknown } | undefined)?.url ?? '');
    const current = serving.current;
    const respond = (method: string, params: object): void => {
      page.send(method, { requestId, ...params }).catch(() => undefined);
    };
    if (current !== null && url === current.url && !current.served) {
      current.served = true;
      respond('Fetch.fulfillRequest', {
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'text/html; charset=utf-8' },
          { name: 'content-security-policy', value: CHECK_CSP },
          { name: 'cache-control', value: 'no-store' },
        ],
        body: current.html.toString('base64'),
      });
      return;
    }
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
      respond('Fetch.continueRequest', {});
      return;
    }
    current?.blocked.push(url);
    respond('Fetch.failRequest', { errorReason: 'BlockedByClient' });
  });
  return page;
};

const SETTLE_EXPRESSION = `(async () => {
  try { await document.fonts.ready; } catch (e) {}
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 400));
  return true;
})()`;

const FRAMES_EXPRESSION = '(async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; })()';

const firstLine = (text: string): string => cleanDetail(text.split('\n')[0] ?? '', CHECK_DETAIL_MAX);

const argText = (arg: unknown): string => {
  const record = (arg ?? {}) as { value?: unknown; description?: unknown };
  return typeof record.value === 'string' ? record.value : typeof record.description === 'string' ? record.description : String(record.value ?? '');
};

type ArtboardResult =
  | { ok: true; check: ArtboardCheck; findings: CheckFindingData[] }
  | { ok: false; reason: 'failed' | 'timeout'; detail?: string };

class Abandoned extends Error {}

const renderOne = async (
  session: CdpSession,
  page: Page,
  serving: { current: Serving | null },
  art: PlannedArtboard,
  html: string,
  counter: number,
  deps: RenderDeps,
  alive: { value: boolean; wake?: () => void },
): Promise<ArtboardResult> => {
  const started = (deps.clock ?? Date.now)();
  const { viewport } = art;
  const where = { file: art.file, screen: art.screen, viewport: viewport.id };
  const events: CheckFindingData[] = [];
  const messages = new Set<string>();
  const addConsole = (text: string, urlHint = ''): void => {
    // A sandbox without allow-modals ignores alert/confirm/prompt and says so: the page used a dialog the viewer cannot show.
    if (/Ignored call to '(alert|confirm|prompt)\(\)'/.test(text)) {
      if (!events.some((event) => event.code === 'dialog-opened')) events.push({ code: 'dialog-opened', ...where });
      return;
    }
    const detail = firstLine(text);
    if (detail === '' || messages.has(detail)) return;
    for (const known of deps.knownExternal) if (text.includes(known) || urlHint === known) return; // reported as a remote-ref already
    messages.add(detail);
    events.push({ code: 'console-error', ...where, detail });
  };

  const url = `${DOCUMENT_ORIGIN}/${counter}/${art.file}`;
  const mine: Serving = { url, html: Buffer.from(html, 'utf8'), served: false, blocked: [] };
  serving.current = mine;
  let loaded: () => void = () => undefined;
  const loadFired = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  // A timed-out artboard must not stay parked on a load that will never come.
  alive.wake = loaded;
  const offs = [
    session.on('Page.loadEventFired', (event) => {
      if (event.sessionId === page.sessionId) loaded();
    }),
    session.on('Runtime.exceptionThrown', (event: CdpEvent) => {
      if (event.sessionId !== page.sessionId) return;
      const details = event.params.exceptionDetails as { text?: unknown; exception?: { description?: unknown } } | undefined;
      addConsole(typeof details?.exception?.description === 'string' ? details.exception.description : String(details?.text ?? 'Script error'));
    }),
    session.on('Runtime.consoleAPICalled', (event) => {
      if (event.sessionId !== page.sessionId || event.params.type !== 'error') return;
      const args = Array.isArray(event.params.args) ? event.params.args : [];
      addConsole(args.map(argText).join(' '));
    }),
    session.on('Log.entryAdded', (event) => {
      if (event.sessionId !== page.sessionId) return;
      const entry = event.params.entry as { level?: unknown; source?: unknown; text?: unknown; url?: unknown } | undefined;
      // Blocked requests also log a network error: the request-blocked finding covers those.
      if (entry?.level !== 'error' || entry.source === 'network') return;
      addConsole(String(entry.text ?? ''), typeof entry.url === 'string' ? (normalizeExternalUrl(entry.url) ?? '') : '');
    }),
    session.on('Page.javascriptDialogOpening', (event) => {
      if (event.sessionId !== page.sessionId) return;
      page.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined);
      events.push({ code: 'dialog-opened', ...where });
    }),
  ];
  const guard = (): void => {
    if (!alive.value) throw new Abandoned();
  };

  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    const navigation = await page.send<{ frameId: string; errorText?: string }>('Page.navigate', { url });
    guard();
    if (navigation.errorText) return { ok: false, reason: 'failed', detail: cleanDetail(navigation.errorText, CHECK_DETAIL_MAX) };
    await loadFired;
    guard();
    const { executionContextId } = await page.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId: navigation.frameId, worldName: 'dc-probe' });
    await page.send('Runtime.evaluate', { expression: SETTLE_EXPRESSION, contextId: executionContextId, awaitPromise: true, returnByValue: true });
    guard();
    const evaluated = await page.send<{ result?: { value?: unknown }; exceptionDetails?: unknown }>('Runtime.evaluate', {
      expression: `${deps.probeSource};__dcProbe.collect(${JSON.stringify({ maxTexts: CHECK_TEXT_ELEMENTS_MAX })})`,
      contextId: executionContextId,
      returnByValue: true,
      timeout: 8000,
    });
    guard();
    const probe = evaluated.exceptionDetails === undefined ? sanitizeProbe(evaluated.result?.value) : null;
    if (probe === null) return { ok: false, reason: 'failed', detail: 'The page could not be measured.' };

    const slices = Math.max(1, Math.min(CHECK_SLICES_MAX, Math.ceil(probe.scrollHeight / viewport.height)));
    const pngs: string[] = [];
    for (let slice = 1; slice <= slices; slice += 1) {
      await page.send('Runtime.evaluate', {
        expression: `window.scrollTo({ top: ${(slice - 1) * viewport.height}, behavior: 'instant' }); ${FRAMES_EXPRESSION}`,
        contextId: executionContextId,
        awaitPromise: true,
        returnByValue: true,
      });
      guard();
      const shot = await page.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      guard();
      pngs.push(await deps.savePng(art, slice, slices, Buffer.from(shot.data, 'base64')));
    }

    const blocked = mine.blocked.filter((blockedUrl) => !deps.knownExternal.has(normalizeExternalUrl(blockedUrl) ?? blockedUrl));
    const requests: CheckFindingData[] = [...new Set(blocked)].slice(0, 5).map((blockedUrl) => ({ code: 'request-blocked', ...where, detail: cleanDetail(blockedUrl, CHECK_DETAIL_MAX) }));
    const findings = capPerCode([
      ...analyzeProbe(probe, { file: art.file, screen: art.screen, viewport: viewport.id, width: viewport.width, height: viewport.height, kind: deps.kind }),
      ...events,
      ...requests,
    ]);
    return {
      ok: true,
      findings,
      check: { screen: art.screen, viewport: viewport.id, width: viewport.width, height: viewport.height, docHeight: Math.round(probe.scrollHeight), pngs, ok: true, ms: (deps.clock ?? Date.now)() - started },
    };
  } finally {
    for (const off of offs) off();
    // A run abandoned after its timeout can finish late: it must not clear the artboard that is rendering by then.
    if (serving.current === mine) serving.current = null;
  }
};

const withTimeout = async <T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<{ timedOut: false; value: T } | { timedOut: true }> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve({ timedOut: true });
    }, ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ timedOut: false as const, value })), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * Render the planned artboards in order. A failed artboard is a finding, not an exception: the
 * next one still renders. A second failure in a row restarts the browser once; a third in a row
 * ends the run (the rest is `notRendered`). Closes every browser it opened.
 */
export const renderArtboards = async (deps: RenderDeps): Promise<RenderOutcome> => {
  const clock = deps.clock ?? Date.now;
  const artboardMs = deps.artboardTimeoutMs ?? CHECK_ARTBOARD_TIMEOUT_MS;
  const runMs = deps.runBudgetMs ?? CHECK_RUN_BUDGET_MS;
  const outcome: RenderOutcome = { artboards: [], findings: [], notRendered: 0, stoppedBy: null, unavailable: false };
  if (deps.plan.length === 0) return outcome;

  let session: CdpSession;
  try {
    session = await deps.openBrowser();
  } catch (error) {
    if (error instanceof CdpUnavailable || error instanceof CdpError) {
      outcome.unavailable = true;
      outcome.notRendered = deps.plan.length;
      return outcome;
    }
    throw error;
  }
  const serving: { current: Serving | null } = { current: null };
  let page: Page | null = null;
  let consecutiveFailures = 0;
  let restarted = false;
  const started = clock();
  let counter = 0;
  let live: { value: boolean; wake?: () => void } | null = null;

  try {
    // Ctrl-C or a shutdown ends the browser and frees the screen it is on at once, instead of waiting out its timeout.
    deps.signal?.addEventListener(
      'abort',
      () => {
        if (live !== null) {
          live.value = false;
          live.wake?.();
        }
        void session.close();
      },
      { once: true },
    );
    await session.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
    for (const [index, art] of deps.plan.entries()) {
      const stop = deps.signal?.aborted ? 'aborted' : clock() - started > runMs ? 'budget' : consecutiveFailures >= 3 ? 'failures' : null;
      if (stop !== null) {
        outcome.notRendered = deps.plan.length - index;
        outcome.stoppedBy = stop;
        break;
      }
      const where = { file: art.file, screen: art.screen, viewport: art.viewport.id };
      const failed = (code: 'render-failed' | 'render-timeout', detail?: string, browserTrouble = true): void => {
        if (browserTrouble) consecutiveFailures += 1;
        outcome.findings.push({ code, ...where, ...(detail ? { detail } : {}) });
        outcome.artboards.push({ screen: art.screen, viewport: art.viewport.id, width: art.viewport.width, height: art.viewport.height, docHeight: 0, pngs: [], ok: false, ms: 0 });
      };

      const loadedDocument = await deps.loadDocument(art.file);
      if (!loadedDocument.ok) {
        failed('render-failed', loadedDocument.reason === 'too-large' ? 'over 60 MB' : undefined, false);
        continue;
      }
      if (consecutiveFailures >= 2 && !restarted) {
        // Twice in a row: the browser itself may be wedged. One fresh start, then a third failure ends the run.
        restarted = true;
        await session.close();
        try {
          session = await deps.openBrowser();
          await session.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
          page = null;
        } catch {
          outcome.notRendered = deps.plan.length - index;
          outcome.stoppedBy = deps.signal?.aborted ? 'aborted' : 'failures';
          break;
        }
      }
      try {
        page ??= await openPage(session, serving);
      } catch (error) {
        if (error instanceof CdpUnavailable || error instanceof CdpError) {
          failed('render-failed', 'The browser could not open a page.');
          page = null;
          continue;
        }
        throw error;
      }

      counter += 1;
      const alive: { value: boolean; wake?: () => void } = { value: true };
      live = alive;
      const current = page;
      let result: Awaited<ReturnType<typeof withTimeout<ArtboardResult>>>;
      try {
        result = await withTimeout(renderOne(session, current, serving, art, loadedDocument.html, counter, deps, alive), artboardMs, () => {
          alive.value = false;
          alive.wake?.();
        });
      } catch (error) {
        if (error instanceof Abandoned) continue;
        if (error instanceof CdpUnavailable || error instanceof CdpError) {
          result = { timedOut: false, value: { ok: false, reason: 'failed', detail: cleanDetail(error.message, CHECK_DETAIL_MAX) } };
        } else {
          throw error;
        }
      }
      if (result.timedOut) {
        failed('render-timeout');
        await session.send('Target.closeTarget', { targetId: current.targetId }, { timeoutMs: 3000 }).catch(() => undefined);
        page = null;
        continue;
      }
      if (!result.value.ok) {
        failed(result.value.reason === 'timeout' ? 'render-timeout' : 'render-failed', result.value.detail);
        await session.send('Target.closeTarget', { targetId: current.targetId }, { timeoutMs: 3000 }).catch(() => undefined);
        page = null;
        continue;
      }
      consecutiveFailures = 0;
      outcome.artboards.push(result.value.check);
      outcome.findings.push(...result.value.findings);
    }
  } finally {
    await session.close();
  }
  return outcome;
};
