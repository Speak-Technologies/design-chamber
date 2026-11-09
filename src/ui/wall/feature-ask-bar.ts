// Phase 1 feature mount (seam S9): the docked ask bar.
// A no-op until `feat/ask-bar-send-pin` fills it in; the design view already calls it.

import type { FeatureMount } from './view-context.ts';

export const mount: FeatureMount = () => () => undefined;
