// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.10, AD-14). T0 stub: T13 fills it.
// Reading the repo's system folder into `_systems/<id>/snapshot/` (read-only on the repo, swap staged under `.chamber/`).

import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export const refreshSnapshot = (ctx: ServiceContext, id: string, options: { by: 'agent' | 'user'; scanId?: string; directory?: string }): Promise<void> => notBuilt();

/** At start: finish or undo a snapshot swap a restart interrupted. */
export const recoverSnapshot = (systemDir: string): Promise<void> => notBuilt();
