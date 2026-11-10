// Visual harness only: stands in for `@openchamber/sdk` when shoot.mjs bundles a frame's real entry
// point (src/ui/status/main.ts, src/ui/blocks/main.ts). Everything is the real SDK except
// `connectHost`, which returns the real host connection with the fake service behind it
// (fake-host.ts), so `getGuestHost()` in the entry works unchanged.

import { connectHost as connectRealHost } from '@openchamber/sdk';

import { installFakeHost } from './fake-host.ts';

export * from '@openchamber/sdk';

export const connectHost: typeof connectRealHost = (...args) => installFakeHost(connectRealHost(...args));
