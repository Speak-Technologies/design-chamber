// The Phase 2.5 placeholder (documentation/specs/phase-2-5-technical.md §18 T0): every design-system
// route and module answers this until its task lands. The router has already checked the bearer
// token, and a stub reads no request input and touches no file, so it has nothing to contain.

import type { RouteKey } from '../../shared/api.ts';
import { ApiError, type Router } from '../http.ts';

export const SYSTEMS_NOT_BUILT_MESSAGE = 'This part of Design Chamber (design systems) is not built yet.';

/** Throws the 500 every Phase 2.5 stub answers. */
export const notBuilt = (): never => {
  throw new ApiError('internal', SYSTEMS_NOT_BUILT_MESSAGE);
};

/** Registers each key with the not-built answer; the owning task replaces its file's registrations. */
export const registerNotBuilt = (router: Router, keys: readonly RouteKey[]): void => {
  for (const key of keys) router.on(key, notBuilt);
};
