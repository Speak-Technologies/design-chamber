// Visual harness entry (shoot.mjs bundles it in place of src/ui/main.ts): the real UI on the
// real guest core, talking to the mock host page for theme, toasts, clipboard and storage, with
// service requests answered in memory by the fake backend (fake-host.ts). Never part of a production bundle.
// The Work Status and chat block frames run their own real entry points instead (fake-sdk.ts).

import { connectHost } from '@openchamber/sdk';

import { createGuestHost } from '../../../src/guest/host.ts';
import { createServiceClient } from '../../../src/guest/service-client.ts';
import { startApp } from '../../../src/ui/app.ts';
import { installFakeHost } from './fake-host.ts';

const hybrid = installFakeHost(connectHost());
const guestHost = createGuestHost(hybrid);
startApp(guestHost, createServiceClient(hybrid));
