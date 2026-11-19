// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.7). T0 stub: T6 fills it.
// The specimen board: generated from the system files, bundled like a design, shown in the standard sandboxed artboard frame (AD-9).

import type { RenderMeta } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export const renderBoard = (ctx: ServiceContext, id: string, options: { version?: string; scheme: 'light' | 'dark' }): Promise<RenderMeta> => notBuilt();
