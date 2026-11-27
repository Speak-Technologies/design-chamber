// Hidden background frame: answers the /design and /page slash commands (docs/SPEC.md
// §8.1, §10.1) and runs the "Open as page" message action (§10.8) and the Files-row action
// (documentation/specs/native-extras.md §3). Both handlers are
// registered synchronously after connecting (the host waits up to 20 s, F15); `POST /chip`
// creates the pending design and returns the chip. A thrown error's message is what the host
// shows the user.

import { getGuestHost } from './host.ts';
import { createFlows } from './flows.ts';
import { createServiceClient } from './service-client.ts';

/** How long a command or a file action waits for the first ready snapshot before going without. */
const READY_WAIT_MS = 2000;

const host = getGuestHost();
const flows = createFlows({ host, client: createServiceClient(host.client), panelOnPhone: __DC_PANEL_MOBILE__ });

const readyOrTimeout = (): Promise<unknown> => Promise.race([host.whenReady(), new Promise((resolve) => setTimeout(resolve, READY_WAIT_MS))]);

host.client.onResolve(async (request) => {
  await readyOrTimeout();
  return flows.resolveSlashCommand(request);
});

host.client.onAction(async (item) => {
  // The file toasts differ on a phone, which only the ready snapshot says.
  if (item.kind === 'file') await readyOrTimeout();
  await flows.runAction(item);
});
