// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.7, §5.11). T0 stub: T11 fills it.
// Section renderers shared by the board and the living page (pure).

import type { SystemDetail, SystemSection } from '../../shared/types.ts';
// Pure: no service imports, so the CLI check can bundle it.
const notBuilt = (): never => {
  throw new Error('This part of Design Chamber (design systems) is not built yet.');
};

export const renderSpecimenSection = (detail: SystemDetail, section: SystemSection, options: { scheme: 'light' | 'dark' }): string => notBuilt();
