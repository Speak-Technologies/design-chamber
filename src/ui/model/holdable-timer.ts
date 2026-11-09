// A countdown that stops while something holds it (a hovered or focused notice) and carries on
// with the time that was left. No DOM; it only uses `setTimeout` and `Date.now`.

export type HoldableTimer = {
  /** Start (or restart) the countdown from the full time. */
  start: () => void;
  /** Say whether `cause` (for example `hover`, `focus`) is holding the timer. It runs while no cause holds it. */
  setHeld: (cause: string, held: boolean) => void;
  /** Stop for good; `onExpire` will not be called. */
  cancel: () => void;
};

export const createHoldableTimer = (ttlMs: number, onExpire: () => void): HoldableTimer => {
  const causes = new Set<string>();
  let remaining = ttlMs;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = false;

  const run = (): void => {
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      if (live) {
        live = false;
        onExpire();
      }
    }, remaining);
  };

  const pause = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };

  return {
    start: () => {
      clearTimeout(timer);
      timer = undefined;
      remaining = ttlMs;
      live = true;
      if (causes.size === 0) run();
    },
    setHeld: (cause, held) => {
      const before = causes.size;
      if (held) causes.add(cause);
      else causes.delete(cause);
      if (!live) return;
      if (before === 0 && causes.size > 0) pause();
      else if (before > 0 && causes.size === 0) run();
    },
    cancel: () => {
      live = false;
      clearTimeout(timer);
      timer = undefined;
    },
  };
};
