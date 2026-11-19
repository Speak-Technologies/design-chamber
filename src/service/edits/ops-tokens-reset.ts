// Op `token-reset` (documentation/specs/phase-2-5-technical.md §6.4, "Reset to system"): remove
// overrides of the linked system's tokens from the design's tokens.css. T0 stub: T7 replaces this
// module. Unreachable until then: `parseEditRequest` refuses the op with 400.

import { ApiError } from '../http.ts';
import type { OpModule, RequestOf } from './op-module.ts';

export const tokensResetOp: OpModule<RequestOf<'token-reset'>> = {
  plan: async () => {
    throw new ApiError('internal', 'This part of Design Chamber (design systems) is not built yet.');
  },
};
