// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11, §2.14, rev 3). T0 stub: T14 fills it.
// The allowlist scan of a living page and its mark (pure; bundled into the CLI check). Text content is never a reason.

// Pure: no service imports, so the CLI check can bundle it.
const notBuilt = (): never => {
  throw new Error('This part of Design Chamber (design systems) is not built yet.');
};

export type LivingPageMark = { system: string; revision: number; generated: string; hash: string };

export const scanLivingPage = (text: string): { safe: boolean; reasons: string[]; mark: LivingPageMark | null } => notBuilt();

export const readLivingPageMark = (text: string): LivingPageMark | null => notBuilt();

/** Decode, drop a BOM, LF line ends, no trailing blanks, one final LF, the mark's hash zeroed (§2.14 rev 3). */
export const normaliseForHash = (text: string): string => notBuilt();
