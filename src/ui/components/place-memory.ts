// Keeps the open design across a reload of the panel or page frame (spec §3.8). The app tells it
// when a design opens (`remember`) and when the user goes back to the list (`clear`); on start it
// reads the stored place once, waits for the design list, and reopens the design when it is still
// there. The decision is `decideRestore` (model/place-model.ts); this file is only the wiring.

import { host, store } from '../guest.ts';
import { decideRestore, placeKey, storedPlace, type PlaceSurface } from '../model/place-model.ts';

export type PlaceMemory = {
  /** A design is now open: keep it, and stop waiting to restore an older one. */
  remember: (slug: string) => void;
  /** Back on the list: forget it. */
  clear: () => void;
};

export type PlaceMemoryOptions = {
  surface: PlaceSurface;
  /** Whether a design is open right now (the user's own choice or an open request wins over the remembered one). */
  isOpen: () => boolean;
  /** Reopen the remembered design. */
  open: (slug: string) => void;
};

export const keepPlace = ({ surface, isOpen, open }: PlaceMemoryOptions): PlaceMemory => {
  const key = placeKey(surface);
  let stored: unknown;
  let loaded = false;
  let settled = false;
  let unsubscribe = (): void => undefined;

  const settle = (): void => {
    settled = true;
    unsubscribe();
  };

  const evaluate = (): void => {
    if (settled || !loaded) return;
    const decision = decideRestore({ stored, designs: store.getState().designs.data?.designs ?? null, alreadyOpen: isOpen() });
    if (decision.action === 'wait') return;
    settle();
    if (decision.action === 'open') open(decision.slug);
    // A failed write is swallowed by the host wrapper: the stale place is dropped again on the next start.
    else if (decision.action === 'drop') void host.storage.set(key, null);
  };

  unsubscribe = store.subscribe(evaluate);
  void host.storage.get(key).then((value) => {
    stored = value;
    loaded = true;
    evaluate();
  });

  return {
    remember: (slug) => {
      settle();
      void host.storage.set(key, storedPlace(slug));
    },
    clear: () => {
      settle();
      void host.storage.set(key, null);
    },
  };
};
