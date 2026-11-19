// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11, AD-31). T0 stub: T14 fills it.
// Component examples as PNGs from headless Chrome over CDP, scripts disabled; cached under `.chamber/living-examples/`.

import type { SystemDetail } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export type ExampleShot = { component: string; scheme: 'light' | 'dark'; png: Uint8Array | null; reason: 'no-browser' | 'render-failed' | 'too-large' | 'budget' | null };

export const renderExamplePngs = (ctx: ServiceContext, detail: SystemDetail, options: { schemes: ('light' | 'dark')[]; signal: AbortSignal }): Promise<ExampleShot[]> =>
  notBuilt();
