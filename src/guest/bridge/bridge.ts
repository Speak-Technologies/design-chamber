// The script injected at the start of every design document (docs/SPEC.md §8.3), built to a
// minified IIFE string (`__DC_BRIDGE__`) and placed by `frame-doc.ts` right after `<head>`.
//
// It runs inside the untrusted design frame, in the same realm as the design's own scripts:
// it holds no secret and can do nothing the design could not do itself. It only answers the
// page's questions (hit-test, anchors, edit probe), reports sizes and scroll, scrolls on
// request, and turns link clicks into navigate / open-external requests. Phase 2: before
// anything else it installs the storage stand-in (`storage-shim.ts`), and it applies the tweak
// preview as inline custom properties on `<html>`. It posts to `window.parent` only, and
// accepts only messages from `window.parent` that pass `parsePageMessage` with its own
// artboard id and nonce.

import {
  BRIDGE_KEYS,
  BRIDGE_PROTOCOL_VERSION,
  parsePageMessage,
  type AnchorResult,
  type BridgeInit,
  type BridgeKey,
  type BridgeMode,
  type FrameToPageMessage,
  type HitElement,
  type PageToFrameMessage,
  type TokenVar,
} from '../../shared/bridge-protocol.ts';
import { BRIDGE_SIZE_THROTTLE_MS, BRIDGE_TITLE_MAX } from '../../shared/limits.ts';
import type { Rect } from '../../shared/types.ts';
import { elementText, openingTag, resolveAnchor } from './anchor.ts';
import { editProbeOf } from './edit-probe.ts';
import { readInit } from './init.ts';
import { classifyGoto, classifyLink, type LinkAction } from './links.ts';
import { buildSelector, tagNameOf } from './selector.ts';
import { installStorage } from './storage-shim.ts';

type FrameMessageBody = FrameToPageMessage extends infer M ? (M extends unknown ? Omit<M, 'dc' | 'artboardId' | 'nonce'> : never) : never;

/** Lines → px for `WheelEvent.deltaMode === 1`, pages → px for `2`. */
const LINE_PX = 16;
const READY_RESENDS = 5;
const READY_RESEND_MS = 300;

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  return false;
};

const start = (init: BridgeInit): void => {
  let mode: BridgeMode = init.mode;
  let acknowledged = false;
  const parentWindow = window.parent;
  const framed = parentWindow !== window;

  const post = (body: FrameMessageBody): void => {
    parentWindow.postMessage({ ...body, dc: BRIDGE_PROTOCOL_VERSION, artboardId: init.artboardId, nonce: init.nonce }, '*');
  };

  // ---- Storage stand-in: first, so it is in place before any design script runs ----
  const storage = installStorage(window, framed ? init.storage : undefined, (batch) => post({ type: 'storage-batch', ...batch }));

  // ---- Tweak preview: inline custom properties on <html>, which beat every normal :root rule ----
  let previewed: readonly string[] = [];
  const setTokens = (vars: readonly TokenVar[]): void => {
    const style = document.documentElement.style;
    const names = new Set(vars.map((entry) => entry.name));
    for (const name of previewed) if (!names.has(name)) style.removeProperty(name);
    for (const entry of vars) style.setProperty(entry.name, entry.value);
    previewed = [...names];
  };
  // The bridge runs first in <head>, so the preview is there before the first paint.
  if (init.tokens) setTokens(init.tokens);

  if (!framed) return;

  const docSize = (): { docWidth: number; docHeight: number } => {
    const root = document.documentElement;
    const body = document.body;
    return {
      docWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
      docHeight: Math.max(root.scrollHeight, body ? body.scrollHeight : 0),
    };
  };

  /** Element rect in document px (viewport rect + scroll). */
  const docRect = (element: Element): Rect => {
    const box = element.getBoundingClientRect();
    return { x: box.left + window.scrollX, y: box.top + window.scrollY, w: Math.max(0, box.width), h: Math.max(0, box.height) };
  };

  /** Hit-test and edit-probe targets: not the document itself, not our overlay. */
  const usableAt = (x: number, y: number): Element | null => {
    const element = document.elementFromPoint(x, y);
    return element && element !== document.documentElement && element !== document.body && !element.hasAttribute('data-dc-overlay') ? element : null;
  };

  const describe = (element: Element): HitElement => ({
    selector: buildSelector(element, document),
    text: elementText(element),
    html: openingTag(element),
    rect: docRect(element),
    tag: tagNameOf(element).slice(0, 64) || 'element',
  });

  // ---- Highlight overlay (drawn in document coordinates, never intercepts input) ----
  let overlay: HTMLDivElement | null = null;
  const highlight = (selector: string | null): void => {
    let target: Element | null = null;
    if (selector) {
      try {
        target = document.querySelector(selector);
      } catch {
        target = null;
      }
    }
    if (!target) {
      overlay?.remove();
      overlay = null;
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-dc-overlay', '');
      overlay.setAttribute('aria-hidden', 'true');
    }
    const rect = docRect(target);
    overlay.setAttribute(
      'style',
      `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
        'outline:2px solid Highlight;outline-offset:1px;pointer-events:none;z-index:2147483647;margin:0;padding:0;border:0;background:transparent;',
    );
    if (!overlay.isConnected) document.documentElement.append(overlay);
  };

  // ---- Page → frame ----
  const handle = (message: PageToFrameMessage): void => {
    switch (message.type) {
      case 'init-ack':
        acknowledged = true;
        return;
      case 'set-mode':
        mode = message.mode;
        return;
      case 'hit-test': {
        const element = usableAt(message.x, message.y);
        post({ type: 'hit', x: message.x, y: message.y, element: element ? describe(element) : null });
        return;
      }
      case 'edit-probe': {
        const element = usableAt(message.x, message.y);
        const counts = element ? editProbeOf(element, document) : null;
        const probe = element && counts ? { ...counts, dir: getComputedStyle(element).direction === 'rtl' ? ('rtl' as const) : ('ltr' as const), rect: docRect(element) } : null;
        post({ type: 'edit-probe-result', x: message.x, y: message.y, probe });
        return;
      }
      case 'set-tokens':
        setTokens(message.vars);
        return;
      case 'storage-sync':
        storage.sync(message.clear, message.changes);
        return;
      case 'resolve-anchors': {
        const results: AnchorResult[] = message.anchors.map((anchor) => {
          const match = resolveAnchor(document, anchor);
          return { id: anchor.id, found: match.found, exact: match.exact, rect: match.element ? docRect(match.element) : null };
        });
        post({ type: 'anchors', results });
        return;
      }
      case 'scroll-by':
        window.scrollBy(message.dx, message.dy);
        return;
      case 'scroll-to':
        window.scrollTo(message.x, message.y);
        return;
      case 'highlight':
        highlight(message.selector);
        return;
    }
  };

  window.addEventListener('message', (event) => {
    if (event.source !== parentWindow) return;
    const message = parsePageMessage(event.data);
    if (!message || message.artboardId !== init.artboardId || message.nonce !== init.nonce) return;
    handle(message);
  });

  // ---- Frame → page: ready, size, scroll ----
  const sendReady = (): void => post({ type: 'ready', ...docSize(), title: document.title.slice(0, BRIDGE_TITLE_MAX) });

  let sizeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSize = '';
  const reportSize = (): void => {
    if (sizeTimer !== null) return;
    sizeTimer = setTimeout(() => {
      sizeTimer = null;
      const size = docSize();
      const key = `${size.docWidth}x${size.docHeight}`;
      if (key === lastSize) return;
      lastSize = key;
      post({ type: 'size', ...size });
    }, BRIDGE_SIZE_THROTTLE_MS);
  };

  let scrollQueued = false;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        post({ type: 'scroll', x: window.scrollX, y: window.scrollY });
      });
    },
    { passive: true },
  );

  const onDomReady = (): void => {
    if (init.scroll.x !== 0 || init.scroll.y !== 0) window.scrollTo(init.scroll.x, init.scroll.y);
    sendReady();
    let resends = 0;
    const resend = setInterval(() => {
      resends += 1;
      if (acknowledged || resends > READY_RESENDS) clearInterval(resend);
      else sendReady();
    }, READY_RESEND_MS);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(reportSize);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
    // Absolutely positioned or overflowing content changes the scroll size without resizing
    // <html>/<body>, which ResizeObserver cannot see; reportSize is throttled and deduped.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(reportSize).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    }
    reportSize();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
  else onDomReady();
  window.addEventListener('load', () => {
    // Images and fonts change the height after DOMContentLoaded; restore scroll once laid out.
    if (init.scroll.x !== 0 || init.scroll.y !== 0) window.scrollTo(init.scroll.x, init.scroll.y);
    reportSize();
  });

  // ---- Links, forms, wheel, keys ----
  const act = (action: LinkAction): void => {
    switch (action.kind) {
      case 'fragment': {
        if (action.id === '') {
          window.scrollTo(0, 0);
          return;
        }
        const target = document.getElementById(action.id) ?? document.getElementsByName(action.id)[0] ?? null;
        target?.scrollIntoView();
        return;
      }
      case 'navigate':
        post({ type: 'navigate', href: action.href, hash: action.hash });
        return;
      case 'external':
        post({ type: 'open-external', url: action.url });
        return;
      case 'blocked':
        return;
    }
  };

  document.addEventListener(
    'click',
    (event) => {
      const origin = event.target instanceof Element ? event.target : null;
      const target = origin?.closest('a[href], area[href], [data-dc-goto]') ?? null;
      if (!target) return;
      event.preventDefault();
      const goto = target.getAttribute('data-dc-goto');
      if (goto !== null) {
        act(classifyGoto(goto));
        return;
      }
      act(classifyLink(target.getAttribute('href') ?? '', init.file));
    },
    true,
  );

  // CSP `form-action 'none'` blocks submissions anyway; preventing keeps the document in place.
  document.addEventListener('submit', (event) => event.preventDefault(), true);

  window.addEventListener(
    'wheel',
    (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl && mode !== 'edit') return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? window.innerHeight : 1;
      post({ type: 'wheel', deltaX: event.deltaX * unit, deltaY: event.deltaY * unit, x: event.clientX, y: event.clientY, ctrl });
    },
    { passive: false, capture: true },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (isEditable(event.target)) return;
      if (!(BRIDGE_KEYS as readonly string[]).includes(event.key)) return;
      // Safe: membership in BRIDGE_KEYS was checked just above.
      post({ type: 'key', key: event.key as BridgeKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey });
    },
    true,
  );
};

const init = readInit((window as Window & { __DC?: unknown }).__DC);
// Without a valid init the design still gets working (empty, unsaved) storage instead of throws.
if (init) start(init);
else installStorage(window, undefined, () => undefined);
