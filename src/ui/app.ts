// Starts the panel + page UI on a guest host and service client (docs/SPEC.md §8.1): applies the
// host theme and the device on every `ready` snapshot (so a theme switch, a rotation and the
// on-screen keyboard repaint live) and routes by `ready.surface`: `panel` → the rail app, `page` →
// the full-screen page app, except on a phone, where the page is the rail app laid out full screen
// (documentation/specs/native-extras.md §2.2). This frame never registers `onResolve`: the
// background entry answers slash commands.

import { applyHostReady, mountSpinner } from '@openchamber/sdk/ui';

import type { GuestHost } from '../guest/host.ts';
import type { ServiceClient } from '../guest/service-client.ts';
import { flows, host, startGuest, store } from './guest.ts';
import { applyDevice } from './components/device.ts';
import { deviceOf, openHelp } from './model/device-model.ts';
import { mountPage } from './page/page-app.ts';
import { mountRail } from './rail/rail-app.ts';

export const startApp = (guestHost: GuestHost, client: ServiceClient): void => {
  const root = document.querySelector<HTMLElement>('#root');
  if (!root) throw new Error('Design Chamber: #root is missing from index.html.');
  const appRoot: HTMLElement = root;

  startGuest(guestHost, client);

  // The controls we draw by hand (`oc-sdk-btn`, `oc-sdk-popup`) use the kit's classes; mounting any
  // kit primitive injects the kit stylesheet, so do it once before the first screen paints.
  mountSpinner(document.createElement('div')).dispose();

  let mounted = false;

  host.onReady((context) => {
    if (context.surface === 'background') return;
    applyHostReady(context, document.documentElement);
    const device = deviceOf(context);
    applyDevice(device, document.documentElement);
    document.documentElement.lang = context.locale;
    if (mounted) return;
    mounted = true;
    // Chosen once: a phone stays a phone, and a remount would lose what the user typed.
    const help = openHelp(device, __DC_PANEL_MOBILE__);
    if (context.surface === 'page' && device.form === 'phone') mountRail(appRoot, { variant: 'phone-page', help });
    else if (context.surface === 'page') mountPage(appRoot);
    else {
      mountRail(appRoot, { variant: 'panel', help });
      flows.watchOutbox();
    }
    flows.watchTurns();
    flows.watchSessions(() => (store.getState().designs.data?.designs ?? []).map(({ slug, sessionId }) => ({ slug, sessionId })));
  });
};
