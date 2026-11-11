// The tokens op and the tokens.css reader (Phase 2 technical design §4.2, §4.3): STUB until T5
// replaces this file (and only this file). `tokensOp` sits in the pipeline's fixed op map and
// `readTokens` answers GET /designs/:slug/tokens.

import type { TokensResponse } from '../../shared/api.ts';
import type { DesignRecord } from '../context.ts';
import { ApiError } from '../http.ts';
import { NOT_BUILT_MESSAGE, type OpModule, type RequestOf } from './op-module.ts';

export const tokensOp: OpModule<RequestOf<'tokens'>> = {
  plan: async () => {
    throw new ApiError('internal', NOT_BUILT_MESSAGE);
  },
};

/** Every knob's state in the design's current tokens.css (read only). */
export const readTokens = async (_record: DesignRecord, _dir: string): Promise<TokensResponse> => {
  throw new ApiError('internal', NOT_BUILT_MESSAGE);
};
