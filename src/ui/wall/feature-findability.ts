// Phase 1 feature mount (seam S9): the first-run tip, the rail header chip and restore with Undo.
// A no-op until `feat/findability` fills it in; the design view already calls it.

import type { FeatureMount } from './view-context.ts';

export const mount: FeatureMount = () => () => undefined;
