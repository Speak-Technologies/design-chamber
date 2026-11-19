// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.3, §6.2, §6.3). T0 stub: T3 (re-sync: T4, T13) fills it.
// System hand edits through the extracted step executor; 422 `read-only` for a repo-backed system.

import type { SystemEditRequest, SystemEditResponse, SystemUndoEditResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export type SystemEditService = {
  apply(id: string, request: SystemEditRequest): Promise<SystemEditResponse>;
  undo(id: string, editId: string): Promise<SystemUndoEditResponse>;
  clearHandEdits(id: string, upTo: number): Promise<void>;
};

export const createSystemEditService = (ctx: ServiceContext): SystemEditService => notBuilt();
