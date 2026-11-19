// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.7). T0 stub: T6 (area headings: T11) fills it.
// The board document (pure): every shown string escaped; values enter CSS only after `validateTokenValue`.

import type { SystemDetail } from '../../shared/types.ts';
// Pure: no service imports, so the CLI check can bundle it.
const notBuilt = (): never => {
  throw new Error('This part of Design Chamber (design systems) is not built yet.');
};

export const buildBoardHtml = (detail: SystemDetail, options: { scheme: 'light' | 'dark' }): string => notBuilt();
