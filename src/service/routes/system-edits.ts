// Phase 2.5 system hand edits (documentation/specs/phase-2-5-technical.md §3.1, §5.3, §6.2, §6.3):
// POST /systems/:id/edits, POST /systems/:id/edits/:eid/undo, POST /systems/:id/hand-edits/clear,
// POST /systems/:id/resync.
//
// Behind the router's bearer check and body cap. Every handler resolves the system first through
// `systems.dir(id)` (id pattern, containment, no links; 400 for a bad id, 404 when it is gone),
// then validates its params and body; no route takes a path. `systems/edits.ts` does the rest.
// Only the page and the rail call these, from Design Chamber's own controls (E1).
//
// POST /systems/:id/resync (internal home, §6.3): the body names a scan, the stamp the page read and
// token names and project paths only; the values come from the scan job's memory. A repo-backed
// system's re-sync (`{ scanId, stamp }`, all or nothing, §7.4) is T13's and answers not built yet.

import type { OkResponse, SystemEditResponse, SystemResyncResponse, SystemUndoEditResponse } from '../../shared/api.ts';
import { EDIT_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { CLEAR_RANGE_MESSAGE } from '../edits/file.ts';
import { ApiError, type Router } from '../http.ts';
import { ensureSystemEditService, parseSystemEditRequest, parseSystemResyncRequest } from '../systems/edits.ts';
import { applyRepoResync, parseRepoResyncRequest } from '../systems/snapshot.ts';
import { ensureSystemStore } from '../systems/store.ts';

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Registers:
 * - 'POST /systems/:id/edits'
 * - 'POST /systems/:id/edits/:eid/undo'
 * - 'POST /systems/:id/hand-edits/clear'
 * - 'POST /systems/:id/resync'
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

  router.on('POST /systems/:id/resync', async ({ params, body }): Promise<SystemResyncResponse> => {
    const systems = ensureSystemStore(ctx);
    await systems.dir(params.id);
    // The repo flavour takes `{ scanId, stamp }` only and has no Undo (§7.4, AD-33).
    if ((await systems.readState(params.id)).home?.kind === 'repo') return applyRepoResync(ctx, params.id, parseRepoResyncRequest(body));
    return ensureSystemEditService(ctx).resync(params.id, parseSystemResyncRequest(body));
  });
}
