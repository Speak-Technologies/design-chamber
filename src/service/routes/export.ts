// WP2 — POST /designs/:slug/export, POST /reveal (docs/SPEC.md §7, §4.3, §9.5).

import type { ExportBody, ExportResponse, OkResponse, SystemExportOptionsResponse, SystemExportResponse } from '../../shared/api.ts';
import { ApiError, type Router } from '../http.ts';
import type { ServiceContext } from '../context.ts';
import { createExportService, type ExportService } from '../export.ts';
import { createRevealRegistry, createRevealService, type RevealService } from '../reveal.ts';
import { ensureSystemStore } from '../systems/store.ts';

type ExportLane = { exports: ExportService; reveal: RevealService };

// One registry per context: /reveal accepts exactly the paths THIS service's /export issued.
const lanes = new WeakMap<ServiceContext, ExportLane>();

const laneOf = (ctx: ServiceContext): ExportLane => {
  const existing = lanes.get(ctx);
  if (existing) return existing;
  const registry = createRevealRegistry();
  const lane: ExportLane = {
    exports: createExportService({ store: ctx.store, settings: ctx.settings, log: ctx.log, issue: registry.issue }),
    reveal: createRevealService({ store: ctx.store, log: ctx.log, registry, systems: ensureSystemStore(ctx) }),
  };
  lanes.set(ctx, lane);
  return lane;
};

/**
 * Registers:
 * - 'POST /designs/:slug/export'
 * - 'POST /reveal'
 * The export body is validated at the boundary; reveal refuses every path the service did not
 * issue itself and that is not a design folder. Its system form derives the path from the system.
 */
export function registerExportRoutes(router: Router, ctx: ServiceContext): void {
  const lane = laneOf(ctx);
  registerSystemExportRoutes(router, ctx);

  router.on('POST /designs/:slug/export', async ({ params, body }): Promise<ExportResponse> => {
    const input = (body ?? {}) as Partial<ExportBody>;
    if (input.format !== 'zip' && input.format !== 'html') throw new ApiError('bad-request', 'The export format must be "zip" or "html".');
    if (input.screen !== undefined && typeof input.screen !== 'string') throw new ApiError('bad-request', 'That is not a screen id.');
    return lane.exports.export(params.slug, { format: input.format, ...(typeof input.screen === 'string' ? { screen: input.screen } : {}) });
  });

  router.on('POST /reveal', async ({ body }): Promise<OkResponse> => {
    // Safe: untrusted JSON, every field is checked below before use.
    const input = (body ?? {}) as { path?: unknown; system?: unknown; target?: unknown };
    // Phase 2.5 §3.5: the system form takes no path; the service derives it from the system's state.
    if (input.system !== undefined) {
      if (input.path !== undefined) throw new ApiError('bad-request', 'Reveal takes a path or a design system, not both.');
      await lane.reveal.revealSystem(input.system, input.target);
      return { ok: true };
    }
    if (typeof input.path !== 'string') throw new ApiError('bad-path', 'That is not a path Design Chamber can open.');
    await lane.reveal.reveal(input.path);
    return { ok: true };
  });
}

// ---- system-builder-depth Phase 3, Wave 0 (§13 T19) ----

export const SYSTEM_EXPORT_NOT_READY = "Token export isn't ready yet.";

const exportNotReady = (): never => {
  throw new ApiError('internal', SYSTEM_EXPORT_NOT_READY);
};

/**
 * Registers (called from `registerExportRoutes`, so T19 writes through this file's reveal registry):
 * - 'GET /systems/:id/export'
 * - 'POST /systems/:id/export'
 * Wave 0 stub: both answer "isn't ready yet" behind the router's bearer and path gate; nothing is read
 * or written. T19 replaces the handlers (the id through the system store, `laneOf(ctx)` for the write
 * and the reveal issue).
 */
export function registerSystemExportRoutes(router: Router, _ctx: ServiceContext): void {
  router.on('GET /systems/:id/export', async (): Promise<SystemExportOptionsResponse> => exportNotReady());
  router.on('POST /systems/:id/export', async (): Promise<SystemExportResponse> => exportNotReady());
}

// ---- end system-builder-depth Phase 3 ----
