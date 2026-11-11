// The screen ops (Phase 2 technical design §5.2, §6.2): reorder, duplicate, trash-screen and
// keep-direction. STUB until T4 replaces this file (and only this file). It already sits in the
// pipeline's fixed op map for all four op names.

import { ApiError } from '../http.ts';
import { NOT_BUILT_MESSAGE, type OpModule, type RequestOf } from './op-module.ts';

export type ScreenRequest = RequestOf<'reorder' | 'duplicate' | 'trash-screen' | 'keep-direction'>;

export const screensOp: OpModule<ScreenRequest> = {
  plan: async () => {
    throw new ApiError('internal', NOT_BUILT_MESSAGE);
  },
};
