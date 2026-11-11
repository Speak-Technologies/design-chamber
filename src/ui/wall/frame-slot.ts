// One sandboxed design frame: loads a rendered document through the guest, wraps it in a blob
// document with the bridge (`frame-doc.ts`), and talks to it through a validated frame channel
// (`frame-channel.ts`). The frame is `sandbox="allow-scripts"` — never `allow-same-origin` — so
// the design cannot reach this page.
//
// `channel` is stable across reloads: it forwards to the current document's channel, so a pin
// tracker (`trackPins`) built on it keeps working when the document is replaced.

import { createFrameChannel, type FrameChannel, type PageMessageBody } from '../../guest/frame-channel.ts';
import { ARTBOARD_SANDBOX, createFrameDocument, type FrameDocument } from '../../guest/frame-doc.ts';
import type { RenderMeta } from '../../shared/api.ts';
import type { BridgeMode, FrameToPageMessage, TokenVar } from '../../shared/bridge-protocol.ts';
import { h } from '../components/dom.ts';
import { client, isServiceError } from '../guest.ts';

/**
 * The Tweaks preview on show, by design (Phase 2 §4.4): the inline custom properties every frame of that design wears
 * on top of its tokens.css. A frame that loads or reloads reads it for its first paint (`BridgeInit.tokens`), and a frame
 * that turns `ready` is sent it again, so a slider moved while a frame was loading is not lost. The wall's
 * `setTokenPreview` is the only writer; it clears the entry on dispose.
 */
const tokenPreviews = new Map<string, readonly TokenVar[]>();
export const setSlotTokens = (slug: string, vars: readonly TokenVar[]): void => {
  if (vars.length === 0) tokenPreviews.delete(slug);
  else tokenPreviews.set(slug, vars);
};
export const slotTokens = (slug: string): readonly TokenVar[] => tokenPreviews.get(slug) ?? [];

export type SlotState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export type SlotOptions = {
  slug: string;
  artboardId: string;
  title: string;
  mode: () => BridgeMode;
  scroll: () => { x: number; y: number };
  onState: (state: SlotState) => void;
};

export type FrameSlot = {
  iframe: HTMLIFrameElement;
  state: () => SlotState;
  meta: () => RenderMeta | null;
  error: () => string | null;
  /** Messages from whichever document is loaded; `send` goes to it. */
  channel: FrameChannel;
  load: (screenId: string | null, version: string | null, file: string) => Promise<void>;
  post: (message: PageMessageBody) => void;
  unload: () => void;
  dispose: () => void;
};

export const createFrameSlot = (options: SlotOptions): FrameSlot => {
  const iframe = h('iframe', {
    class: 'dc-frame',
    sandbox: ARTBOARD_SANDBOX,
    title: options.title,
    tabindex: '-1',
    referrerpolicy: 'no-referrer',
    allow: '',
  });
  let state: SlotState = 'idle';
  let meta: RenderMeta | null = null;
  let error: string | null = null;
  let doc: FrameDocument | null = null;
  let current: FrameChannel | null = null;
  let token = 0;
  const listeners = new Set<(message: FrameToPageMessage) => void>();

  const setState = (next: SlotState): void => {
    state = next;
    options.onState(next);
  };

  const drop = (): void => {
    current?.dispose();
    current = null;
    doc?.revoke();
    doc = null;
    iframe.removeAttribute('src');
  };

  const channel: FrameChannel = {
    get identity() {
      return current?.identity ?? { artboardId: options.artboardId, nonce: '' };
    },
    send: (body) => current?.send(body),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => listeners.clear(),
  };

  return {
    iframe,
    state: () => state,
    meta: () => meta,
    error: () => error,
    channel,
    load: async (screenId, version, file) => {
      token += 1;
      const mine = token;
      error = null;
      setState('loading');
      try {
        const rendered = await client.loadRender(options.slug, screenId, version);
        if (mine !== token) return;
        meta = rendered.meta;
        drop();
        const tokens = [...slotTokens(options.slug)];
        doc = createFrameDocument(rendered.html, { artboardId: options.artboardId, file, mode: options.mode(), scroll: options.scroll(), ...(tokens.length > 0 ? { tokens } : {}) });
        // The channel exists before the document loads, so the bridge's first `ready` is answered.
        const next = createFrameChannel({ artboardId: options.artboardId, nonce: doc.init.nonce, frame: iframe });
        next.subscribe((message) => {
          // The slot turns `ready` when the bridge reports `ready`; until then the frame is still painting.
          if (message.type === 'ready') {
            // The preview may have moved while this document loaded: say where it stands now.
            const now = slotTokens(options.slug);
            if (now.length > 0) next.send({ type: 'set-tokens', vars: [...now] });
          }
          if (message.type === 'ready' && state === 'loading') setState('ready');
          for (const listener of [...listeners]) listener(message);
        });
        current = next;
        iframe.src = doc.url;
      } catch (failure) {
        if (mine !== token) return;
        meta = null;
        error = failure instanceof Error && failure.message !== '' ? failure.message : 'This could not be loaded.';
        // `no-html`: the agent has not written this file yet (the service's answer); `not-found`: the screen is not listed yet.
        setState(isServiceError(failure, 'no-html') || isServiceError(failure, 'not-found') ? 'missing' : 'error');
      }
    },
    post: (message) => current?.send(message),
    unload: () => {
      token += 1;
      drop();
      meta = null;
      setState('idle');
    },
    dispose: () => {
      token += 1;
      drop();
      listeners.clear();
      iframe.remove();
    },
  };
};
