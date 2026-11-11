// Visual harness only: puts the in-memory fake service behind a frame's host connection, so the real
// UI, service client, store and change feed run unchanged. Every harness frame (panel, page, Work
// Status, chat block) goes through here: `fake-main.ts` for the panel and the page, and `fake-sdk.ts`
// (a stand-in for `connectHost`) for the frames whose real entry point calls `getGuestHost()`.
//
// Scenario hooks, all on `window.__dcFake` of the frame:
//   - the fake backend's own (writePending, writeFile, ageDesign, padScreens, unwriteScreen, addDirections, failNextRestore, checks);
//   - `route(key, override)` / `clearRoutes()`: answer one route yourself (see `RouteOverride`);
//   - the page URL's `?routes=<json>` sets overrides before the first request, which `route()` cannot:
//     {"GET /status/designs": {"status": 200, "body": {"rows": [], "total": 0}}}.

import { ROUTE_KEYS, type RouteKey } from '../../../src/shared/api.ts';
import type { HostLike } from '../../../src/guest/host.ts';
import { createFakeTransport, type FakeTransport, type RouteOverride } from './fake-transport.ts';

export type FakeHooks = Pick<FakeTransport['backend'], 'writePending' | 'writeFile' | 'ageDesign' | 'padScreens' | 'unwriteScreen' | 'addDirections' | 'failNextRestore' | 'touchTokens' | 'checks'> & {
  route: FakeTransport['routes']['set'];
  clearRoutes: FakeTransport['routes']['clear'];
};

const isRouteKey = (key: string): key is RouteKey => (ROUTE_KEYS as readonly string[]).includes(key);

/** `?routes=` from the frame's own URL (the host page passes its query on); a typo is reported, not ignored. */
const routesFromUrl = (): Array<[RouteKey, RouteOverride]> => {
  const raw = new URLSearchParams(location.search).get('routes');
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    return Object.entries(parsed).flatMap(([key, override]): Array<[RouteKey, RouteOverride]> => {
      if (isRouteKey(key)) return [[key, override as RouteOverride]];
      console.error(`design chamber harness: ?routes names an unknown route "${key}"`);
      return [];
    });
  } catch (error) {
    console.error(`design chamber harness: ?routes is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return [];
  }
};

/** The real host (talking to `host.html`) with `serviceRequest` answered by the fake backend. */
export const installFakeHost = <T extends HostLike>(real: T): T => {
  const fake = createFakeTransport();
  for (const [key, override] of routesFromUrl()) fake.routes.set(key, override);
  (window as unknown as { __dcFake?: FakeHooks }).__dcFake = {
    writePending: fake.backend.writePending,
    writeFile: fake.backend.writeFile,
    ageDesign: fake.backend.ageDesign,
    padScreens: fake.backend.padScreens,
    unwriteScreen: fake.backend.unwriteScreen,
    addDirections: fake.backend.addDirections,
    failNextRestore: fake.backend.failNextRestore,
    touchTokens: fake.backend.touchTokens,
    checks: fake.backend.checks,
    route: fake.routes.set,
    clearRoutes: fake.routes.clear,
  };
  return new Proxy(real, {
    get: (target, key, receiver) => (key === 'serviceRequest' ? fake.serviceRequest : Reflect.get(target, key, receiver)),
  });
};
