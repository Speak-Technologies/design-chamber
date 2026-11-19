// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.4, §2.6). T0 stub: T7 fills it.
// Copy-on-link: a version first, the copy staged in `.chamber/system-incoming-*`, then swapped into `<design>/system/`.

import type { DesignSystemActionResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export type LinkRequest = { to: string; by: 'user' | 'agent' | 'creation'; stamp?: string; reason: 'system-change' | 'system-update' };

export const linkDesignSystem = (ctx: ServiceContext, slug: string, request: LinkRequest): Promise<DesignSystemActionResponse> => notBuilt();

/** At start and before every link: finish or undo a swap a restart interrupted. */
export const recoverCopy = (designDir: string): Promise<void> => notBuilt();
