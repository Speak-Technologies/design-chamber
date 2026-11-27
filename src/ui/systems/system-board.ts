// The specimen board of one design system (Phase 2.5 U2, technical design §9.3): the service renders it as a
// page (`GET /systems/:id/board`), and it runs in the same sandboxed artboard frame a design does, never with
// `allow-same-origin`. The page reads the frame's messages as advice only: a click asks the frame which board
// entry is under the pointer (`hit-test`), a section chosen in the panel asks it to scroll to one (`resolve-anchors`
// then `scroll-to` and `highlight`), and the host theme and the pending edits reach it as `set-tokens`.
// In comment mode (system-builder-depth T21) a click asks the same `hit-test`, and the entry goes to the comment layer
// instead; the boxes of the entries that have comments come back through `resolve-anchors`, so pins follow their entry
// after every reload, scheme change and resize. Nothing here writes a file.

import { artboardIdOf, type FrameToPageMessage, type TokenVar } from '../../shared/bridge-protocol.ts';
import type { Rect } from '../../shared/types.ts';
import { BRIDGE_ANCHORS_MAX, TOKEN_PREVIEW_NAME_PATTERN, TOKEN_PREVIEW_VALUE_PATTERN, TOKEN_PREVIEW_VARS_MAX } from '../../shared/limits.ts';
import { h } from '../components/dom.ts';
import { btn, loadingRow } from '../components/kit.ts';
import { client, host } from '../guest.ts';
import { boardPointerVar, boardScheme, entrySelector } from '../model/system-page-model.ts';
import { setSlotTokens } from '../model/slot-seed.ts';
import { createFrameSlot, type SlotState } from '../wall/frame-slot.ts';

export type BoardHandle = {
  el: HTMLElement;
  state: () => SlotState;
  /** Load the board again (a revision landed, the scheme changed, "Try again"). The scroll position stays. */
  reload: () => void;
  /** Show an old version of the system (read only), or the live one with `null`. */
  setVersion: (versionId: string | null) => void;
  /** The pending edits, previewed on the board; `[]` clears them. */
  setPreview: (vars: readonly TokenVar[]) => void;
  /** Scroll to an entry and outline it (`null` clears the outline). */
  focusEntry: (entry: string | null) => void;
  /** The layer over the board where the comment pins and cards go (it lets clicks through where it is empty). */
  pinLayer: HTMLElement;
  /** Comment mode: a click on the board reports its entry to `onComment` instead of selecting it. */
  setCommentMode: (on: boolean) => void;
  /** Who hears a comment-mode click: the entry under it (or undefined) and the point, in the board element's pixels. */
  setCommentHandler: (handler: ((entry: string | undefined, at: { x: number; y: number }) => void) | null) => void;
  /** The entries whose boxes to follow; every new layout (load, resize, scroll) goes to `onLayout`. */
  trackEntries: (entries: readonly string[]) => void;
  onLayout: (listener: (layout: BoardLayout) => void) => () => void;
  /** The last layout (null until the board is ready). */
  layout: () => BoardLayout | null;
  dispose: () => void;
};

/**
 * Where the tracked entries are: `rects` in the board document's pixels (an entry the board doesn't draw is missing),
 * `scroll` the document's scroll, `frame` the frame's box inside the board element.
 */
export type BoardLayout = { rects: ReadonlyMap<string, Rect>; scroll: { x: number; y: number }; frame: { x: number; y: number; width: number; height: number } };

export type BoardOptions = {
  id: string;
  name: () => string;
  /** The user clicked an entry on the board (the key is the frame's advice: the caller checks it). */
  onEntry: (entry: string | undefined) => void;
  onState: (state: SlotState) => void;
};

const VIEWPORT = 'board';
const FILE = 'board.html';

/** The host's colours and type as the board's own variables, so it reads as part of OpenChamber in either theme. */
const themeVars = (): TokenVar[] => {
  const tokens = host.snapshot()?.theme.tokens;
  if (!tokens) return [];
  const wanted: Array<[string, string]> = [
    ['--dc-board-bg', tokens.background],
    ['--dc-board-card', tokens.elevated],
    ['--dc-board-fg', tokens.foreground],
    ['--dc-board-muted', tokens.muted],
    ['--dc-board-border', tokens.border],
    ['--dc-board-font', tokens.font],
    ['--dc-board-radius', tokens.radius],
  ];
  return wanted.filter(([name, value]) => TOKEN_PREVIEW_NAME_PATTERN.test(name) && TOKEN_PREVIEW_VALUE_PATTERN.test(value)).map(([name, value]) => ({ name, value }));
};

export const mountBoard = (options: BoardOptions): BoardHandle => {
  const key = `system:${options.id}`;
  let version: string | null = null;
  let preview: readonly TokenVar[] = [];
  let scheme = boardScheme(host.snapshot()?.theme.mode);
  let waiting: { entry: string } | null = null;
  let scrollTo: ((entry: string) => void) | null = null;
  let hit: { x: number; y: number } | null = null;
  /** Where the pointer is over the board (frame px), sent with the tokens so a motion demo can play under it. */
  let pointer: TokenVar | null = null;
  let pointerFrame = 0;
  let commenting = false;
  let commentHandler: ((entry: string | undefined, at: { x: number; y: number }) => void) | null = null;
  /** A comment-mode click waiting for its `hit`, with where it was in the board element. */
  let commentHit: { x: number; y: number; at: { x: number; y: number } } | null = null;
  let tracked: string[] = [];
  let rects = new Map<string, Rect>();
  let frameScroll = { x: 0, y: 0 };
  let ready = false;
  const layoutListeners = new Set<(layout: BoardLayout) => void>();

  const slot = createFrameSlot({
    slug: key,
    loadDoc: (_screen, versionId) => client.loadBoard(options.id, versionId, scheme),
    artboardId: artboardIdOf(null, VIEWPORT),
    title: `${options.name()} specimen board`,
    mode: () => 'edit',
    scroll: () => ({ x: 0, y: 0 }),
    onState: (state) => {
      paintState();
      options.onState(state);
    },
  });
  slot.iframe.classList.add('dc-sys-frame');

  const overlay = h('div', { class: 'dc-sys-hit', 'aria-hidden': 'true' });
  const status = h('div', { class: 'dc-sys-board-state' });
  const pinLayer = h('div', { class: 'dc-bc-layer' });
  const el = h('div', { class: 'dc-sys-board', 'data-state': 'idle' }, slot.iframe, overlay, pinLayer, status);

  const frameBox = (): BoardLayout['frame'] => {
    const outer = el.getBoundingClientRect();
    const inner = slot.iframe.getBoundingClientRect();
    return { x: inner.left - outer.left, y: inner.top - outer.top, width: inner.width, height: inner.height };
  };
  const currentLayout = (): BoardLayout | null => (ready ? { rects, scroll: frameScroll, frame: frameBox() } : null);
  const emitLayout = (): void => {
    const now = currentLayout();
    if (now === null) return;
    for (const listener of layoutListeners) listener(now);
  };
  /** Ask the frame where the tracked entries are; the answer comes back as `anchors` with `pin<n>` ids. */
  const resolveTracked = (): void => {
    if (!ready) return;
    if (tracked.length === 0) {
      rects = new Map();
      emitLayout();
      return;
    }
    slot.post({ type: 'resolve-anchors', anchors: tracked.map((entry, index) => ({ id: `pin${index}`, selector: entrySelector(entry), text: '', html: '' })) });
  };
  const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => emitLayout()) : null;
  resizes?.observe(el);

  const vars = (): TokenVar[] => [...themeVars(), ...preview].slice(0, TOKEN_PREVIEW_VARS_MAX - 1);
  const sendTokens = (): void => {
    const all = vars();
    // The seed a reloaded frame starts with never carries the pointer: it is only true for this document, now.
    setSlotTokens(key, all);
    slot.post({ type: 'set-tokens', vars: pointer === null ? all : [...all, pointer] });
  };
  const movePointer = (next: TokenVar | null): void => {
    if (next?.value === pointer?.value) return;
    pointer = next;
    if (slot.state() === 'ready') sendTokens();
  };

  const load = (): void => {
    setSlotTokens(key, vars());
    void slot.load(null, version, FILE);
  };

  function paintState(): void {
    const state = slot.state();
    el.dataset.state = state;
    status.replaceChildren();
    if (state === 'loading' || state === 'idle') status.append(loadingRow('Loading the board…'));
    else if (state === 'missing' || state === 'error') {
      status.append(
        h('p', { class: 'dc-sys-board-message' }, state === 'missing' ? 'The board isn’t ready yet.' : 'The board didn’t load.'),
        h('p', { class: 'dc-muted' }, slot.error() ?? 'Try again in a moment.'),
        btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => load() }).el,
      );
    }
  }

  const unsubscribe = slot.channel.subscribe((message: FrameToPageMessage) => {
    if (message.type === 'ready') {
      ready = true;
      frameScroll = { x: 0, y: 0 };
      sendTokens();
      if (waiting) scrollTo?.(waiting.entry);
      resolveTracked();
    } else if (message.type === 'size') {
      resolveTracked();
    } else if (message.type === 'scroll') {
      frameScroll = { x: message.x, y: message.y };
      emitLayout();
    } else if (message.type === 'hit') {
      if (commentHit && commentHit.x === message.x && commentHit.y === message.y) {
        const at = commentHit.at;
        commentHit = null;
        commentHandler?.(message.element?.entry ?? undefined, at);
        return;
      }
      if (!hit || hit.x !== message.x || hit.y !== message.y) return;
      hit = null;
      options.onEntry(message.element?.entry ?? undefined);
    } else if (message.type === 'anchors') {
      const found = message.results.find((result) => result.id === 'entry' && result.found && result.rect);
      if (found?.rect) slot.post({ type: 'scroll-to', x: 0, y: Math.max(0, Math.round(found.rect.y) - 72) });
      const pins = message.results.filter((result) => result.id.startsWith('pin'));
      if (pins.length === 0) return;
      const next = new Map<string, Rect>();
      for (const result of pins) {
        const entry = tracked[Number(result.id.slice(3))];
        if (entry !== undefined && result.found && result.rect) next.set(entry, result.rect);
      }
      rects = next;
      emitLayout();
    }
  });

  scrollTo = (entry) => {
    const selector = entrySelector(entry);
    slot.post({ type: 'resolve-anchors', anchors: [{ id: 'entry', selector, text: '', html: '' }] });
    slot.post({ type: 'highlight', selector });
  };

  // The click layer keeps the pointer from the frame, so hover is reported instead (once a frame), and the board plays the motion
  // demo under it. The click below still selects the entry.
  overlay.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const rect = slot.iframe.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      movePointer(boardPointerVar(x, y));
    });
  });
  overlay.addEventListener('pointerleave', () => {
    if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    movePointer(null);
  });
  overlay.addEventListener('click', (event) => {
    if (slot.state() !== 'ready') return;
    const rect = slot.iframe.getBoundingClientRect();
    const point = { x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top) };
    if (commenting && commentHandler) {
      const outer = el.getBoundingClientRect();
      commentHit = { ...point, at: { x: Math.round(event.clientX - outer.left), y: Math.round(event.clientY - outer.top) } };
      hit = null;
    } else hit = point;
    slot.post({ type: 'hit-test', x: point.x, y: point.y });
  });
  // The wheel scrolls the board over the click layer and over the pins, which sit on top of it.
  const forwardWheel = (event: WheelEvent): void => {
    if (slot.state() !== 'ready' || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest('.dc-pop')) return;
    event.preventDefault();
    slot.post({ type: 'scroll-by', dx: Math.round(event.deltaX), dy: Math.round(event.deltaY) });
  };
  overlay.addEventListener('wheel', forwardWheel, { passive: false });
  pinLayer.addEventListener('wheel', forwardWheel, { passive: false });

  // The scheme follows the host: a switch loads the board again in the other one; a colour change in the same scheme only moves the variables.
  const stopReady = host.onReady((context) => {
    const next = boardScheme(context.theme.mode);
    if (next !== scheme) {
      scheme = next;
      ready = false;
      load();
    } else if (slot.state() === 'ready') sendTokens();
  });

  paintState();
  load();

  const loadAgain = (): void => {
    ready = false;
    rects = new Map();
    load();
  };

  return {
    el,
    state: () => slot.state(),
    reload: () => loadAgain(),
    setVersion: (next) => {
      version = next;
      loadAgain();
    },
    setPreview: (next) => {
      preview = next;
      if (slot.state() === 'ready') sendTokens();
      else setSlotTokens(key, vars());
    },
    focusEntry: (entry) => {
      if (entry === null) {
        waiting = null;
        slot.post({ type: 'highlight', selector: null });
        return;
      }
      waiting = { entry };
      if (slot.state() === 'ready') scrollTo?.(entry);
    },
    pinLayer,
    setCommentMode: (on) => {
      commenting = on;
      el.dataset.commenting = String(on);
      if (!on) commentHit = null;
    },
    setCommentHandler: (handler) => {
      commentHandler = handler;
    },
    trackEntries: (entries) => {
      const next = [...new Set(entries)].slice(0, BRIDGE_ANCHORS_MAX);
      if (next.length === tracked.length && next.every((entry, index) => entry === tracked[index])) return;
      tracked = next;
      resolveTracked();
    },
    onLayout: (listener) => {
      layoutListeners.add(listener);
      return () => void layoutListeners.delete(listener);
    },
    layout: currentLayout,
    dispose: () => {
      resizes?.disconnect();
      layoutListeners.clear();
      if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
      unsubscribe();
      stopReady();
      slot.dispose();
      setSlotTokens(key, []);
      el.remove();
    },
  };
};
