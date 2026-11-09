// A set of listeners with one `emit`. The design view uses it to tell feature mounts about
// changes (detail, viewing) and the wall uses it for selection events. No DOM, no state beyond the set.

export type Listeners<A extends unknown[] = []> = {
  /** Add a listener; the returned function removes it (safe to call twice). */
  add: (listener: (...args: A) => void) => () => void;
  /** Call every listener in the order added. One that throws is logged and does not stop the rest. */
  emit: (...args: A) => void;
  size: () => number;
};

export const createListeners = <A extends unknown[] = []>(): Listeners<A> => {
  const set = new Set<(...args: A) => void>();
  return {
    add: (listener) => {
      set.add(listener);
      return () => void set.delete(listener);
    },
    emit: (...args) => {
      // A copy, so a listener that unsubscribes itself (or adds another) does not change this round.
      for (const listener of [...set]) {
        try {
          listener(...args);
        } catch (error) {
          console.error('A listener failed.', error);
        }
      }
    },
    size: () => set.size,
  };
};
