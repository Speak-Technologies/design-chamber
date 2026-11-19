// Phase 2.5 system hand edits (documentation/specs/phase-2-5-technical.md §3.1, §5.3, §6.2):
// POST /systems/:id/edits, POST /systems/:id/edits/:eid/undo, POST /systems/:id/hand-edits/clear.
//
// Behind the router's bearer check and body cap. Every handler resolves the system first through
// `systems.dir(id)` (id pattern, containment, no links; 400 for a bad id, 404 when it is gone),
// then validates its params and body; no route takes a path. `systems/edits.ts` does the rest.
// Only the page and the rail call these, from Design Chamber's own controls (E1).
//
// POST /systems/:id/resync stays a stub until T4/T13 (built from the scan job's memory, §6.3).

import type { OkResponse, RouteKey, SystemEditResponse, SystemUndoEditResponse } from '../../shared/api.ts';
import { EDIT_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { CLEAR_RANGE_MESSAGE } from '../edits/file.ts';
import { ApiError, type Router } from '../http.ts';
import { ensureSystemEditService, parseSystemEditRequest } from '../systems/edits.ts';
import { registerNotBuilt } from '../systems/not-built.ts';
import { ensureSystemStore } from '../systems/store.ts';

const NOT_BUILT_KEYS: readonly RouteKey[] = ['POST /systems/:id/resync'];

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Registers:
 * - 'POST /systems/:id/edits'
 * - 'POST /systems/:id/edits/:eid/undo'
 * - 'POST /systems/:id/hand-edits/clear'
 * - 'POST /systems/:id/resync' (not built yet: T4/T13)
 */
export function registerSystemEditRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /systems/:id/edits', async ({ params, body }): Promise<SystemEditResponse> => {
    await ensureSystemStore(ctx).dir(params.id);
    const request = parseSystemEditRequest(body);
    return ensureSystemEditService(ctx).apply(params.id, request);
  });

  router.on('POST /systems/:id/edits/:eid/undo', async ({ params, body }): Promise<SystemUndoEditResponse> => {
    await ensureSystemStore(ctx).dir(params.id);
    if (!EDIT_ID_PATTERN.test(params.eid)) throw new ApiError('bad-request', 'That is not an edit id.');
    // `{}` (an empty body reads the same); anything else is a malformed request.
    if (body !== undefined && !(isPlainObject(body) && Object.keys(body).length === 0)) throw new ApiError('bad-request', 'An undo takes no options.');
    return ensureSystemEditService(ctx).undo(params.id, params.eid);
  });

  router.on('POST /systems/:id/hand-edits/clear', async ({ params, body }): Promise<OkResponse> => {
    await ensureSystemStore(ctx).dir(params.id);
    if (!isPlainObject(body) || typeof body.upTo !== 'number' || !Number.isSafeInteger(body.upTo) || body.upTo < 1) throw new ApiError('bad-request', CLEAR_RANGE_MESSAGE);
    await ensureSystemEditService(ctx).clearHandEdits(params.id, body.upTo);
    return { ok: true };
  });

  registerNotBuilt(router, NOT_BUILT_KEYS);
}
