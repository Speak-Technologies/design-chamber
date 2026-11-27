// PUT /view: what the user has open (documentation/specs/use-the-project-and-native-agent.md §2.4).
//
// The rail and the page report their design, screen, viewport, mode and selected element; the
// service keeps the latest report in `view.json` beside settings.json (never in the designs root,
// which may be a synced folder), and `dc read` tells the agent what it says. The route is behind the
// router's bearer check and its body cap. The body is checked here before anything else: only the
// six known fields are accepted, so no file content or comment text can ride in; the slug goes
// through `store.get` (pattern, containment under the root, a real design folder), and the screen and
// viewport must be ones the design has, the same checks as the ask route.
//
// Writes are bounded: one at a time (tmp + rename, `writeFileAtomic`); a changed report that arrives
// less than `VIEW_WRITE_MIN_GAP_MS` after the last write is held (the newest wins) and written when
// the gap has passed; an unchanged report only refreshes `at`, and at most every `VIEW_AT_REFRESH_MS`.

import os from 'node:os';
import path from 'node:path';

import type { OkResponse } from '../../shared/api.ts';
import { PAGE_FILL_VIEWPORT_ID } from '../../shared/limits.ts';
import {
  flattenViewText,
  VIEW_AT_REFRESH_MS,
  VIEW_FILE,
  VIEW_FILE_VERSION,
  VIEW_SELECTION_TEXT_MAX,
  VIEW_SELECTOR_MAX,
  VIEW_WRITE_MIN_GAP_MS,
  type ViewFile,
  type ViewMode,
  type ViewSelection,
  type ViewSurface,
} from '../../shared/view.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { writeFileAtomic } from '../paths.ts';
import { settingsFilePath, type SettingsEnv } from '../settings.ts';

/** view.json beside settings.json (so the `DC_SETTINGS_PATH` test seam moves it too). */
export const viewFilePath = (env: SettingsEnv = process.env, platform: NodeJS.Platform = process.platform, homeDir: string = os.homedir()): string =>
  path.join(path.dirname(settingsFilePath(env, platform, homeDir)), VIEW_FILE);

export type ViewRouteOptions = {
  /** Absolute `view.json` path (beside settings.json). */
  file: string;
  /** Clock seam for tests (ms since the epoch). */
  now?: () => number;
};

const BAD_BODY =
  'The open design is sent as { "surface": "rail" or "page", "slug": the design or null, "screen", "viewport", "mode" ("edit" or "play") and "selection" ({ "selector", "text" }) when there is one }.';
const BAD_SELECTION = `The selected element needs a selector of up to ${VIEW_SELECTOR_MAX} characters and text of up to ${VIEW_SELECTION_TEXT_MAX}.`;
const KNOWN = new Set(['surface', 'slug', 'screen', 'viewport', 'mode', 'selection']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A field that is absent, null or a string. `undefined` means the body shape is wrong. */
const optionalString = (value: unknown): string | null | undefined => (value === undefined || value === null ? null : typeof value === 'string' ? value : undefined);

/** What a report says, before the design is looked at. */
export type ParsedView = {
  surface: ViewSurface;
  slug: string | null;
  screen: string | null;
  viewport: string | null;
  mode: ViewMode | null;
  selection: ViewSelection | null;
};

/** The shape, caps and one-line rule of a `PUT /view` body. Throws 400 `bad-request`. Pure. */
export const parseViewBody = (body: unknown): ParsedView => {
  if (!isRecord(body)) throw new ApiError('bad-request', BAD_BODY);
  if (Object.keys(body).some((key) => !KNOWN.has(key))) throw new ApiError('bad-request', BAD_BODY);
  const { surface } = body;
  if (surface !== 'rail' && surface !== 'page') throw new ApiError('bad-request', BAD_BODY);
  if (body.slug !== null && typeof body.slug !== 'string') throw new ApiError('bad-request', BAD_BODY);
  const screen = optionalString(body.screen);
  const viewport = optionalString(body.viewport);
  if (screen === undefined || viewport === undefined) throw new ApiError('bad-request', BAD_BODY);
  const { mode } = body;
  if (mode !== undefined && mode !== null && mode !== 'edit' && mode !== 'play') throw new ApiError('bad-request', BAD_BODY);

  let selection: ViewSelection | null = null;
  if (body.selection !== undefined && body.selection !== null) {
    const raw = body.selection;
    if (!isRecord(raw) || Object.keys(raw).some((key) => key !== 'selector' && key !== 'text')) throw new ApiError('bad-request', BAD_SELECTION);
    if (typeof raw.selector !== 'string' || typeof raw.text !== 'string') throw new ApiError('bad-request', BAD_SELECTION);
    const selector = flattenViewText(raw.selector);
    const text = flattenViewText(raw.text);
    if (selector === '' || selector.length > VIEW_SELECTOR_MAX || text.length > VIEW_SELECTION_TEXT_MAX) throw new ApiError('bad-request', BAD_SELECTION);
    selection = { selector, text };
  }

  const slug = body.slug;
  if (slug === null && (screen !== null || viewport !== null || (mode ?? null) !== null || selection !== null)) {
    throw new ApiError('bad-request', 'With no design open, there is no screen, viewport, mode or selection to report.');
  }
  // `slug` is a string or null here: the checks above rejected everything else.
  return { surface, slug, screen, viewport, mode: mode ?? null, selection };
};

/** The newest-wins, rate-bounded writer of `view.json`. */
const createViewWriter = (ctx: ServiceContext, options: ViewRouteOptions) => {
  const now = options.now ?? Date.now;
  let lastKey: string | null = null;
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let held: Omit<ViewFile, 'at'> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // One write at a time, in order.
  let chain: Promise<void> = Promise.resolve();

  const write = (report: Omit<ViewFile, 'at'>): Promise<void> => {
    const run = async (): Promise<void> => {
      const at = now();
      const file: ViewFile = { ...report, at: new Date(at).toISOString() };
      try {
        await writeFileAtomic(options.file, `${JSON.stringify(file, null, 2)}\n`);
      } catch (error) {
        // The next report is a retry; the failure is logged once per attempt and never carries a design's data.
        ctx.log.warn('view.write-failed', { error: error instanceof Error ? error.message : String(error) });
        throw new ApiError('internal', "Design Chamber couldn't record what you have open. The agent may not see it.");
      }
      lastKey = JSON.stringify(report);
      lastWriteAt = at;
    };
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  };

  const flush = (): void => {
    timer = null;
    const report = held;
    held = null;
    if (report !== null) void write(report).catch(() => undefined);
  };

  ctx.onDispose(() => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    held = null;
    return chain;
  });

  return {
    async submit(report: Omit<ViewFile, 'at'>): Promise<void> {
      const key = JSON.stringify(report);
      const sinceWrite = now() - lastWriteAt;
      if (key === lastKey && held === null) {
        // Unchanged: only `at` moves, and not more than every few seconds.
        if (sinceWrite < VIEW_AT_REFRESH_MS) return;
        await write(report);
        return;
      }
      if (sinceWrite < VIEW_WRITE_MIN_GAP_MS) {
        held = report;
        if (timer === null) {
          timer = setTimeout(flush, VIEW_WRITE_MIN_GAP_MS - sinceWrite);
          // The service must not stay alive for a held report.
          timer.unref();
        }
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      held = null;
      await write(report);
    },
  };
};

/** Registers: 'PUT /view'. */
export function registerViewRoutes(router: Router, ctx: ServiceContext, options: ViewRouteOptions): void {
  const writer = createViewWriter(ctx, { ...options, file: path.resolve(options.file) });

  router.on('PUT /view', async ({ body }): Promise<OkResponse> => {
    const parsed = parseViewBody(body);
    let title: string | null = null;
    if (parsed.slug !== null) {
      // Pattern, containment under the root and "is a design folder", before anything is written.
      const record = await ctx.store.get(parsed.slug);
      title = record.design.title;
      if (parsed.screen !== null && !record.design.screens.some((screen) => screen.id === parsed.screen)) {
        throw new ApiError('bad-request', 'That screen is not in this design.');
      }
      if (parsed.viewport !== null && parsed.viewport !== PAGE_FILL_VIEWPORT_ID && !record.design.viewports.some((viewport) => viewport.id === parsed.viewport)) {
        throw new ApiError('bad-request', 'That viewport is not one this design has.');
      }
    }
    await writer.submit({
      v: VIEW_FILE_VERSION,
      surface: parsed.surface,
      slug: parsed.slug,
      title,
      screen: parsed.screen,
      viewport: parsed.viewport,
      mode: parsed.mode,
      selection: parsed.selection,
    });
    return { ok: true };
  });
}
