// Phase 2.6 `POST /memberships` (documentation/specs/phase-2-6-technical.md §3.1, §5.2, AD-2): a
// batch of add/remove changes to folders and projects in one queued registry write, atomic (all
// or nothing) or best effort (per-change results). It serves the picker's ticks, a filing retry,
// Move and Move's Undo. The router checks the bearer token before this handler runs; the body is
// validated in `parseMembershipsBody`, and the only file touched is `<root>/.chamber/folders.json`
// (through `folders.ts`). No path is ever built from a folder name or a project directory.

import type { MembershipsResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { ensureFoldersService, parseMembershipsBody } from '../folders.ts';
import type { Router } from '../http.ts';

/** Registers 'POST /memberships'. The service is made on first use, so registration never touches the context. */
export function registerMembershipsRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /memberships', async ({ body }): Promise<MembershipsResponse> => {
    const { changes, atomic } = parseMembershipsBody(body);
    return ensureFoldersService(ctx).changeMany(changes, { atomic });
  });
}
