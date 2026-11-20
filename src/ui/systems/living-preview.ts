// The preview of the living page Design Chamber generated (Phase 2.5 U6, technical design §9.6): the staged page, or
// the proposal's while one waits, in the same sandboxed artboard frame a design runs in (never `allow-same-origin`).
// Only the generated page is ever drawn; the copy committed in the repo is never rendered, only described.

import { artboardIdOf } from '../../shared/bridge-protocol.ts';
import { RENDER_CHUNK_CONCURRENCY } from '../../shared/limits.ts';
import type { RenderDoc } from '../../guest/service-client.ts';
import { h } from '../components/dom.ts';
import { btn, iconBtn, loadingRow } from '../components/kit.ts';
import { client, host } from '../guest.ts';
import { PREVIEW_NOTE, previewBand } from '../model/living-page-model.ts';
import { boardScheme } from '../model/system-page-model.ts';
import { createFrameSlot, type SlotState } from '../wall/frame-slot.ts';

export type PreviewTarget = { which: 'staged' | 'preview'; proposal: string | null };

export type LivingPreviewHandle = {
  el: HTMLElement;
  open: (target: PreviewTarget) => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
};

export type LivingPreviewOptions = {
  id: string;
  systemName: () => string;
  /** The repo's name, for the note ("The copy in shop may differ."). */
  repo: () => string;
  onClose: () => void;
};

/** The staged page (or the proposal's) as one document: the meta, then its chunks a few at a time. */
export const loadLivingPage = async (id: string, which: PreviewTarget['which'], scheme: 'light' | 'dark'): Promise<RenderDoc> => {
  const meta = await client.call('GET /systems/:id/living-page/render', { params: { id }, query: { which, scheme } });
  const indexes = Array.from({ length: meta.chunks }, (_, n) => n);
  const parts: string[] = new Array<string>(indexes.length).fill('');
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < indexes.length) {
      const n = next;
      next += 1;
      parts[n] = await client.call('GET /systems/:id/living-page/render/chunk', { params: { id }, query: { key: meta.key, n: String(n) } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(RENDER_CHUNK_CONCURRENCY, indexes.length) }, worker));
  return { meta, html: parts.join('') };
};

export const mountLivingPreview = (options: LivingPreviewOptions): LivingPreviewHandle => {
  let target: PreviewTarget | null = null;

  const slot = createFrameSlot({
    slug: `living:${options.id}`,
    loadDoc: () => loadLivingPage(options.id, target?.which ?? 'staged', boardScheme(host.snapshot()?.theme.mode)),
    artboardId: artboardIdOf(null, 'living'),
    title: `${options.systemName()} living page preview`,
    mode: () => 'play',
    scroll: () => ({ x: 0, y: 0 }),
    onState: () => paintState(),
  });
  slot.iframe.classList.add('dc-sys-frame');

  const band = h('div', { class: 'dc-lpv-band' });
  const note = h('p', { class: 'dc-lpv-note dc-muted' });
  const status = h('div', { class: 'dc-sys-board-state' });
  const frame = h('div', { class: 'dc-lpv-frame', role: 'region' }, slot.iframe, status);
  const close = iconBtn({ icon: 'close', label: 'Close the preview', onClick: () => api.close() });
  const el = h(
    'section',
    { class: 'dc-lpv', hidden: true, 'aria-label': 'Living page preview' },
    h('div', { class: 'dc-lpv-top' }, close, h('h2', { class: 'dc-lpv-title' }, 'Living page preview')),
    band,
    note,
    frame,
  );

  const load = (): void => void slot.load(null, null, 'living-page.html');

  function paintState(): void {
    const state: SlotState = slot.state();
    frame.dataset.state = state;
    status.replaceChildren();
    if (state === 'loading' || state === 'idle') status.append(loadingRow('Loading the preview…'));
    else if (state === 'missing' || state === 'error') {
      status.append(
        h('p', { class: 'dc-sys-board-message' }, state === 'missing' ? 'There is no generated page to show yet.' : 'The preview didn’t load.'),
        h('p', { class: 'dc-muted' }, slot.error() ?? 'Try again in a moment.'),
        btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => load() }).el,
      );
    }
  }

  const api: LivingPreviewHandle = {
    el,
    open: (next) => {
      target = next;
      band.replaceChildren(h('span', { class: 'dc-lpv-band-text' }, previewBand(next)));
      note.textContent = PREVIEW_NOTE.replace('shop', options.repo());
      frame.setAttribute('aria-label', `Preview of the ${options.systemName()} living page`);
      el.hidden = false;
      load();
      close.focus();
    },
    close: () => {
      if (el.hidden) return;
      el.hidden = true;
      target = null;
      slot.unload();
      options.onClose();
    },
    isOpen: () => !el.hidden,
    dispose: () => {
      slot.dispose();
      el.remove();
    },
  };
  return api;
};
