// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11, AD-21, AD-32). T0 stub: T14 fills it.
// The living page: generated from the snapshot (or the proposal, T17), staged at `.chamber/living-page.html`; the agent commits it.

import type { LivingPageView } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export const regenerateLivingPage = (ctx: ServiceContext, id: string, options: { source: 'snapshot' | 'proposal' }): Promise<void> => notBuilt();

export const livingPageState = (ctx: ServiceContext, id: string): Promise<LivingPageView> => notBuilt();
