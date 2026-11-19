// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.14, AD-26, AD-27, AD-30). T0 stub: T17 fills it.
// Proposals: record each id with the bytes first read, the preview from `proposal/`, and what landed against what was approved.

import type { ProposalView } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export type Proposals = {
  view(id: string, proposalId: string): Promise<ProposalView>;
  compareLanded(id: string): Promise<void>;
};

export const createProposals = (ctx: ServiceContext): Proposals => notBuilt();
