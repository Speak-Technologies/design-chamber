// Visual harness only: a frame with no UI that shows the harness itself works, for every surface a
// feature branch mounts (shoot.mjs, `?entry=probe`; scenarios/harness-frames.mjs). It is a frame entry
// like the real ones: `getGuestHost()` and the service client, with `fake-sdk.ts` behind `connectHost`.
// `window.__probe` holds what the frame has seen and offers the calls a block or status frame makes.

import { HostRequestError } from '@openchamber/sdk';

import { getGuestHost } from '../../../src/guest/host.ts';
import { createServiceClient } from '../../../src/guest/service-client.ts';

type Outcome = { ok: true } | { ok: false; code: string };

const guestHost = getGuestHost();
const client = createServiceClient(guestHost.client);

const outcome = (call: Promise<unknown>): Promise<Outcome> =>
  call.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, code: error instanceof HostRequestError ? error.code : String(error) }),
  );

const probe = {
  surface: null as string | null,
  block: null as { name: string; args: Record<string, string>; answered: string | null } | null,
  /** The last `GET /status/designs`: its row slugs and total, or the error code. */
  status: null as { slugs: string[]; total: number } | { error: string } | null,
  fetchStatus: async (): Promise<void> => {
    try {
      const answer = await client.call('GET /status/designs', { query: {} });
      probe.status = { slugs: answer.rows.map((row) => row.slug), total: answer.total };
    } catch (error) {
      probe.status = { error: error instanceof Error && 'code' in error ? String(error.code) : String(error) };
    }
  },
  setHeight: (height: number): Promise<Outcome> => outcome(guestHost.client.setHeight(height)),
  answerBlock: (text: string): Promise<Outcome> => outcome(guestHost.client.answerBlock(text)),
  openSurface: (surfaceId: string): Promise<Outcome> => outcome(guestHost.client.openSurface(surfaceId)),
};
(window as unknown as { __probe: typeof probe }).__probe = probe;

guestHost.ready.subscribe((context) => {
  if (context) probe.surface = context.surface;
});
guestHost.client.onBlock((call) => {
  probe.block = call;
});
void probe.fetchStatus();
