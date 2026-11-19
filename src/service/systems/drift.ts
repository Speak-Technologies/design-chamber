// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.12). T0 stub: T13 fills it.
// Code drift: what the system says against the CSS variables and token JSON the code defines.

import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export const recomputeDrift = (ctx: ServiceContext, id: string): Promise<void> => notBuilt();

/** A name counts when the code defines it with a different light or dark value (§5.12). */
export const codeDrift = (
  systemTokens: readonly { name: string; light: string | null; dark: string | null }[],
  codeTokens: readonly { name: string; light: string | null; dark: string | null }[],
): { differ: number; names: string[] } => notBuilt();
