// The design view's notices region (`aria-live="polite"`): banners that describe the view (the
// "viewing a version" bar, remote files) and short-lived ones that report what the user just did
// (a saved export, a restore). The view replaces its own notices as its state changes; a
// transient notice has an id, replaces the one with the same id, and goes away by itself.

import { h } from './dom.ts';
import { createHoldableTimer, type HoldableTimer } from '../model/holdable-timer.ts';

/** What a transient notice reports; each id holds at most one notice. Shown in this order. */
export type TransientId = 'export' | 'restore';
const TRANSIENT_ORDER: readonly TransientId[] = ['export', 'restore'];

export type NoticesHandle = {
  /** The region element: put it in the view. */
  el: HTMLElement;
  /** Replace the notices that follow the view's state. Transient notices keep their place, focus and hover. */
  setStatic: (nodes: readonly HTMLElement[]) => void;
  /**
   * Show `node` as the notice `id` (replacing the previous one), or remove it with `null`. With
   * `ttlMs` it removes itself after that long; the clock stops while the node has hover or focus.
   */
  setTransient: (id: TransientId, node: HTMLElement | null, ttlMs?: number) => void;
  dispose: () => void;
};

type Transient = { node: HTMLElement; timer: HoldableTimer | null };

export const createNotices = (): NoticesHandle => {
  const el = h('div', { class: 'dc-notices', 'aria-live': 'polite' });
  let statics: HTMLElement[] = [];
  const transients = new Map<TransientId, Transient>();

  const drop = (id: TransientId): void => {
    const current = transients.get(id);
    if (!current) return;
    current.timer?.cancel();
    current.node.remove();
    transients.delete(id);
  };

  /** The first transient notice that is shown after `id`, so a new one can go in front of it. */
  const nextAfter = (id: TransientId): Node | null => {
    for (const later of TRANSIENT_ORDER.slice(TRANSIENT_ORDER.indexOf(id) + 1)) {
      const found = transients.get(later);
      if (found) return found.node;
    }
    return null;
  };

  /** Where static notices go: before every transient one. */
  const firstTransient = (): Node | null => {
    for (const id of TRANSIENT_ORDER) {
      const found = transients.get(id);
      if (found) return found.node;
    }
    return null;
  };

  return {
    el,
    setStatic: (nodes) => {
      for (const node of statics) node.remove();
      statics = [...nodes];
      const before = firstTransient();
      for (const node of statics) el.insertBefore(node, before);
    },
    setTransient: (id, node, ttlMs) => {
      drop(id);
      if (!node) return;
      let timer: HoldableTimer | null = null;
      if (ttlMs !== undefined) {
        timer = createHoldableTimer(ttlMs, () => drop(id));
        node.addEventListener('pointerenter', () => timer?.setHeld('hover', true));
        node.addEventListener('pointerleave', () => timer?.setHeld('hover', false));
        node.addEventListener('focusin', () => timer?.setHeld('focus', true));
        node.addEventListener('focusout', () => timer?.setHeld('focus', false));
      }
      transients.set(id, { node, timer });
      el.insertBefore(node, nextAfter(id));
      timer?.start();
    },
    dispose: () => {
      for (const id of [...transients.keys()]) drop(id);
    },
  };
};
