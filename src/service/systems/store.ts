// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.1, §2.10). T0 stub: T1 (S8 `filesDir`: T12b) fills it.
// The system store: list, get, detail, create, patch, trash; every path through `systems.dir(id)` and `resolvePlainTarget`.

import type { CreateSystemBody, PatchSystemBody, PatchSystemResponse } from '../../shared/api.ts';
import type { SystemDetailSource } from '../../shared/system-json.ts';
import type { SystemDetail, SystemSummary } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export type SystemStore = {
  list(): Promise<SystemSummary[]>;
  /** `_systems/<id>` after the pattern, containment and lstat checks; 404 sentence otherwise. */
  dir(id: string): Promise<string>;
  /** `dir(id)` for an internal home, `dir(id)/snapshot` for a repo-backed one (AD-14). */
  filesDir(id: string): Promise<string>;
  get(id: string): Promise<SystemDetailSource>;
  detail(id: string): Promise<SystemDetail>;
  create(input: CreateSystemBody): Promise<{ id: string; system: SystemDetail }>;
  patch(id: string, body: PatchSystemBody): Promise<PatchSystemResponse>;
  trash(id: string): Promise<{ trashedTo: string; clearedSettings: { default: boolean; pins: number } }>;
};

export const createSystemStore = (ctx: ServiceContext): SystemStore => notBuilt();
