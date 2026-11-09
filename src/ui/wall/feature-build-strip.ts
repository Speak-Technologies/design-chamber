// Phase 1 feature mount (seam S9): the live build strip.
// A no-op until `feat/build-strip` fills it in; the design view already calls it.

import type { FeatureMount } from './view-context.ts';

export const mount: FeatureMount = () => () => undefined;
