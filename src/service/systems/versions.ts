// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.2). T0 stub: T2 fills it.
// System history through the `VersionTarget` seam of `versions.ts`; restore refused for a repo-backed system (AD-20).

import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

/** The second `createVersionsService` instance, over systems instead of designs. */
export const ensureSystemVersions = (ctx: ServiceContext): never => notBuilt();
