// The text op (Phase 2 technical design §3.4): STUB until T3 replaces this file (and only this
// file). It already sits in the pipeline's fixed op map, so the route answers "not built yet"
// for a well-formed text request instead of a false success.

import { ApiError } from '../http.ts';
import { NOT_BUILT_MESSAGE, type OpModule, type RequestOf } from './op-module.ts';

export const textOp: OpModule<RequestOf<'text'>> = {
  plan: async () => {
    throw new ApiError('internal', NOT_BUILT_MESSAGE);
  },
};
