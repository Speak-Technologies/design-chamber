// Chat block frame, shared by DesignCard and DirectionPick (documentation/specs/phase-1-5-sdk-2-7.md
// §U7, §U8). The host mounts it in an agent's reply with the panel's grants and hands it the call
// (`onBlock`); the arguments are written by a model, so they go through `parseBlockArgs` before
// anything is drawn or read. The frame follows the host theme on every `ready` and tells the host how
// tall it is.

import { GUEST_BLOCK_HEIGHT_MAX, type GuestBlockCall, type ToastKind } from '@openchamber/sdk';
import { applyHostReady, mountSpinner } from '@openchamber/sdk/ui';

import { getGuestHost } from '../../guest/host.ts';
import { createServiceClient } from '../../guest/service-client.ts';
import { parseBlockArgs } from '../model/block-args.ts';
import { notice, type BlockContext, type BlockView } from './block-view.ts';
import { mountDesignCard } from './design-card.ts';
import { mountDirectionPick } from './direction-pick.ts';

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Design Chamber: #root is missing from blocks/index.html.');
const blockRoot: HTMLElement = root;

const guestHost = getGuestHost();
const ctx: BlockContext = {
  client: createServiceClient(guestHost.client),
  host: guestHost.client,
  toast: (kind: ToastKind, message: string) => {
    guestHost.client.toast({ kind, message, dismiss: kind === 'error' }).catch((error: unknown) => console.warn('Design Chamber: toast failed', error));
  },
};

// The kit's stylesheet comes in with the first kit mount; do it before the first paint.
mountSpinner(document.createElement('div')).dispose();

guestHost.ready.subscribe((context) => {
  if (!context) return;
  applyHostReady(context, document.documentElement);
  document.documentElement.lang = context.locale;
});

// ---- height: as tall as the block's content, up to the host's limit

let lastHeight = -1;
new ResizeObserver(() => {
  const height = Math.min(GUEST_BLOCK_HEIGHT_MAX, Math.ceil(blockRoot.getBoundingClientRect().height));
  if (height === lastHeight) return;
  lastHeight = height;
  guestHost.client.setHeight(height).catch((error: unknown) => console.warn('Design Chamber: setHeight failed', error));
}).observe(blockRoot);

// ---- the call: drawn once per name and arguments; a replay with an answer only updates it

let view: BlockView | null = null;
let drawn: string | null = null;

const draw = (call: GuestBlockCall): BlockView | null => {
  const parsed = parseBlockArgs(call.name, call.args);
  if (!parsed.ok) {
    if (parsed.reason === 'unknown-block') {
      console.warn(`Design Chamber: no block named "${call.name}"`);
      blockRoot.replaceChildren();
      return null;
    }
    blockRoot.replaceChildren(
      parsed.reason === 'bad-slug'
        ? notice({ icon: 'alert', text: 'This card doesn’t point to a design.' })
        : notice({ icon: 'alert', text: 'This question has no options to pick from.' }),
    );
    return null;
  }
  const { block } = parsed;
  return block.name === 'DesignCard' ? mountDesignCard(blockRoot, ctx, block.slug) : mountDirectionPick(blockRoot, ctx, block.question, block.options, call.answered);
};

guestHost.client.onBlock((call) => {
  const key = JSON.stringify([call.name, call.args]);
  if (key === drawn && view) {
    view.update(call.answered);
    return;
  }
  view?.dispose();
  drawn = key;
  view = draw(call);
});
