// Phase 2 — hand edits: POST /designs/:slug/edits, POST /designs/:slug/edits/:id/undo,
// GET /designs/:slug/tokens, POST /designs/:slug/hand-edits/clear (technical design §2.2).
//
// Behind the router's bearer check and 80 kB body cap. Every handler resolves the design first
// (slug pattern + containment, 404 "That design is no longer in your Designs folder."), then
// validates its params and body; no route takes a path. The pipeline (`edits/pipeline.ts`) does
// the rest. Only the page and the rail call these, from Design Chamber's own controls (E1).

import type { EditResponse, OkResponse, TokensResponse, UndoEditResponse } from '../../shared/api.ts';
import { EDIT_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ensureEditService, GONE_MESSAGE } from '../edits/pipeline.ts';
import { ApiError, type Router } from '../http.ts';

/** The design exists and is contained, or the edit routes' own 404 sentence. */
const resolveDesign = async (ctx: ServiceContext, slug: string): Promise<void> => {
  try {
    await ctx.store.dir(slug);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not-found') throw new ApiError('not-found', GONE_MESSAGE);
    throw error;
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Registers:
 * - 'POST /designs/:slug/edits'
 * - 'POST /designs/:slug/edits/:id/undo'
 * - 'GET /designs/:slug/tokens'
 * - 'POST /designs/:slug/hand-edits/clear'
 */
export function registerEditRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /designs/:slug/edits', ({ params, body }): Promise<EditResponse> => ensureEditService(ctx).apply(params.slug, body));

  router.on('POST /designs/:slug/edits/:id/undo', async ({ params, body }): Promise<UndoEditResponse> => {
    const edits = ensureEditService(ctx);
    await resolveDesign(ctx, params.slug);
    if (!EDIT_ID_PATTERN.test(params.id)) throw new ApiError('bad-request', 'That is not an edit id.');
    // `{}` (an empty body reads the same); anything else is a malformed request.
    if (body !== undefined && !(isPlainObject(body) && Object.keys(body).length === 0)) {
      throw new ApiError('bad-request', 'An undo takes no options.');
    }
    return edits.undo(params.slug, params.id);
  });

  router.on('GET /designs/:slug/tokens', ({ params }): Promise<TokensResponse> => ensureEditService(ctx).readTokens(params.slug));

  router.on('POST /designs/:slug/hand-edits/clear', async ({ params, body }): Promise<OkResponse> => {
    const edits = ensureEditService(ctx);
    await resolveDesign(ctx, params.slug);
    if (!isPlainObject(body) || typeof body.upTo !== 'number' || !Number.isSafeInteger(body.upTo) || body.upTo < 1) {
      throw new ApiError('bad-request', 'That hand-edit position is not one Design Chamber handed out.');
    }
    await edits.clearHandEdits(params.slug, body.upTo);
    return { ok: true };
  });
}
