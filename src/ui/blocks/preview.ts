// A design's preview inside a chat block: the service's cached PNG as a checked `data:` URL, a small
// spinner while it is being made (asked again at each THUMB_RETRY_DELAYS_MS step), or an icon and a
// short sentence (no Chrome, not ready, not found). Never the design's own HTML: no live preview in
// the chat (documentation/specs/phase-1-5-sdk-2-7.md §U7.2).

import { mountSpinner } from '@openchamber/sdk/ui';

import type { ServiceClient } from '../../guest/service-client.ts';
import type { DesignKind } from '../../shared/types.ts';
import { h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { previewOf, type PreviewView } from '../model/block-view-model.ts';

export type PreviewHandle = { el: HTMLElement; dispose: () => void };

export type PreviewOptions = {
  client: Pick<ServiceClient, 'thumbnail'>;
  slug: string;
  /** Picks the icon when there is no image; null when the kind is not known (a generic image icon). */
  kind: DesignKind | null;
  /** Every state the preview settles on, so a tile can name it (a missing design). */
  onView?: (view: PreviewView | null) => void;
};

export const mountPreview = (options: PreviewOptions): PreviewHandle => {
  const el = h('div', { class: 'dcb-preview', 'data-state': 'loading', 'aria-hidden': 'true' });
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const showSpinner = (): void => {
    el.dataset.state = 'loading';
    const spot = h('span', { class: 'dcb-preview-spin' });
    el.replaceChildren(spot);
    mountSpinner(spot, { size: 'sm' });
  };

  const show = (view: PreviewView): void => {
    if (view.state === 'waiting') return;
    if (view.state === 'image') {
      const img = h('img', { alt: '', draggable: 'false', decoding: 'async', src: view.src });
      img.addEventListener('load', () => void (el.dataset.state = 'ready'), { once: true });
      // A PNG the browser cannot decode: say so instead of a broken image.
      img.addEventListener('error', () => show({ state: 'note', reason: 'failed', text: 'The preview couldn’t be made' }), { once: true });
      el.replaceChildren(img);
      options.onView?.(view);
      return;
    }
    el.dataset.state = view.reason === 'missing' ? 'missing' : 'note';
    const glyph = view.reason === 'missing' ? 'alert' : options.kind ?? 'image';
    el.replaceChildren(h('span', { class: 'dcb-preview-note' }, icon(glyph, 20), h('span', { class: 'dcb-preview-text' }, view.text)));
    options.onView?.(view);
  };

  const read = (attempt: number): void => {
    timer = null;
    options.client.thumbnail(options.slug).then(
      (answer) => settle(previewOf({ answer }, attempt), attempt),
      (error: unknown) => settle(previewOf({ error }, attempt), attempt),
    );
  };

  const settle = (view: PreviewView, attempt: number): void => {
    if (disposed) return;
    if (view.state === 'waiting') {
      timer = setTimeout(() => read(attempt + 1), view.retryInMs);
      return;
    }
    show(view);
  };

  showSpinner();
  options.onView?.(null);
  read(1);

  return {
    el,
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      el.remove();
    },
  };
};
