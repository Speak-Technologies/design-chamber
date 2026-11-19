// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11). T0 stub: T14 fills it.
// The living page document (pure): escaped text and validated values only; no script, no event attribute, no remote URL.

import type { SystemArea, SystemDetail } from '../../shared/types.ts';
// Pure: no service imports, so the CLI check can bundle it.
const notBuilt = (): never => {
  throw new Error('This part of Design Chamber (design systems) is not built yet.');
};

export type LivingPageInput = { revision: number; generatedAt: string; coverage: SystemArea[]; redact: string[] };

export const buildLivingPageHtml = (detail: SystemDetail, input: LivingPageInput): string => notBuilt();

/** Replaces the designs root, the repo's location and the home folder in shown text with "…". */
export const redactLocalPaths = (text: string, paths: readonly string[]): string => notBuilt();
