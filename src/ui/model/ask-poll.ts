// How an unanswered SystemAsk block keeps asking the service. A visible block that polls keeps the service
// from its idle stop, so a read says what comes next: ask `again` at the usual pace, `later` (the service is
// not answering, or the question is out of date for now: the wait doubles up to a minute), or `done` (the
// ticket or proposal is finished or gone: never ask again). No DOM: only `setTimeout`, and the caller says
// whether the frame is visible.

export type PollVerdict = 'again' | 'later' | 'done';

export const ASK_POLL_BACKOFF_MAX_MS = 60_000;

export type AskPoll = {
  /** Read at once (focus, Try again), unless a read is out or the polling is over. */
  now: () => void;
  stop: () => void;
};

/** Reads at once, then every `ms` while `visible()`; a hidden frame sends nothing. */
export const startAskPoll = (read: () => Promise<PollVerdict>, ms: number, visible: () => boolean): AskPoll => {
  let delay = ms;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let over = false;

  const stop = (): void => {
    over = true;
    clearTimeout(timer);
  };

  const schedule = (): void => {
    clearTimeout(timer);
    if (!over) timer = setTimeout(tick, delay);
  };

  const run = (): void => {
    if (over || busy) return;
    busy = true;
    clearTimeout(timer);
    read()
      .catch((error: unknown): PollVerdict => {
        console.warn('Design Chamber: refetch failed', error);
        return 'later';
      })
      .then((verdict) => {
        busy = false;
        if (verdict === 'done') {
          stop();
          return;
        }
        delay = verdict === 'later' ? Math.min(delay * 2, ASK_POLL_BACKOFF_MAX_MS) : ms;
        schedule();
      });
  };

  const tick = (): void => {
    if (visible()) run();
    else schedule();
  };

  run();
  return {
    now: () => {
      if (visible()) run();
    },
    stop,
  };
};
