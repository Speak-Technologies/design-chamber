// Calls from the service into OpenChamber (documentation/specs/phase-1-5-sdk-2-7.md §3.3), through
// the SDK's `createServiceHost`. It authenticates with the service token from the environment;
// the token stays in this process and is never logged (only the refusal code is).
//
// Without `OPENCHAMBER_HOST_CALLBACK_URL` (tests, an older host) every call answers `unavailable`
// without trying, logged once. Calls never throw: callers wait for their next trigger.

import { createServiceHost, OPENCHAMBER_HOST_CALLBACK_URL_ENV, ServiceHostError, type ServiceHost } from '@openchamber/sdk';

import type { HostCalls, Logger } from './context.ts';

export type HostCallsDeps = {
  /** The service's environment (`process.env` in production). */
  env: Record<string, string | undefined>;
  log: Logger;
  /** Test seam: the host client; defaults to the SDK's `createServiceHost`. */
  connect?: (env: Record<string, string | undefined>) => Pick<ServiceHost, 'setInstructions' | 'setMark'>;
};

export const createHostCalls = ({ env, log, connect = (callEnv) => createServiceHost({ env: callEnv }) }: HostCallsDeps): HostCalls => {
  const callback = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
  const available = typeof callback === 'string' && callback !== '';
  const host = available ? connect(env) : null;
  let loggedUnavailable = false;

  return {
    // `directory` null: every session; a project folder: the sessions under it, added to the
    // global text (SP-2, additive). The caller passes the same resolved path on write and removal.
    async setInstructions(text, directory = null) {
      if (host === null) {
        if (!loggedUnavailable) {
          loggedUnavailable = true;
          log.info('host-calls.unavailable', { reason: 'no host callback address' });
        }
        return 'unavailable';
      }
      try {
        await host.setInstructions(directory, text);
        return 'saved';
      } catch (error) {
        const code = error instanceof ServiceHostError ? error.code : error instanceof Error ? error.name : 'unknown';
        if (code === 'HOST_UNAVAILABLE') {
          log.warn('host-calls.unavailable', { call: 'setInstructions', code });
          return 'unavailable';
        }
        log.warn('host-calls.refused', { call: 'setInstructions', code });
        return 'refused';
      }
    },
    // One chat's sidebar mark (native-extras §4.2). Same rules as setInstructions: never throws,
    // only the error code is logged (never the mark's text, the host message or the token).
    async setMark(target, mark) {
      if (host === null) {
        if (!loggedUnavailable) {
          loggedUnavailable = true;
          log.info('host-calls.unavailable', { reason: 'no host callback address' });
        }
        return 'unavailable';
      }
      try {
        await host.setMark(target, mark);
        return 'saved';
      } catch (error) {
        const code = error instanceof ServiceHostError ? error.code : error instanceof Error ? error.name : 'unknown';
        // The host's limits: 429 `TOO_MANY_EVENTS` (rate) and 409 `TOO_MANY_MARKS` (cap), also when a
        // proxy answered the status without the code.
        const status = error instanceof ServiceHostError ? error.status : 0;
        if (code === 'TOO_MANY_EVENTS' || code === 'TOO_MANY_MARKS' || status === 429 || status === 409) {
          log.warn('host-calls.limited', { call: 'setMark', code });
          return 'limited';
        }
        if (code === 'HOST_UNAVAILABLE') {
          log.warn('host-calls.unavailable', { call: 'setMark', code });
          return 'unavailable';
        }
        log.warn('host-calls.refused', { call: 'setMark', code });
        return 'refused';
      }
    },
  };
};
