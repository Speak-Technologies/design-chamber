// The two places a chat block touches the outside world, kept out of the DOM code so tests can count
// every call (documentation/specs/phase-1-5-sdk-2-7.md §U7.2, §U8.2):
// - `readCard`: the card's reads on mount. Reads only; nothing with a side effect runs before a click.
// - `createPicker`: the one answer a DirectionPick gives, only from a pick, only once.

import type { ChecksSummary, DesignDetailResponse } from '../../shared/api.ts';
import { isServiceError, type ServiceClient } from '../../guest/service-client.ts';
import type { DirectionOption } from '../model/block-args.ts';
import { answeredOption, answerText, type PickerState } from '../model/block-view-model.ts';

export type CardClient = Pick<ServiceClient, 'call'>;

export type CardRead =
  | { state: 'ready'; detail: DesignDetailResponse; checks: ChecksSummary | null }
  /** The folder is no longer in the designs root. */
  | { state: 'gone' }
  /** The service did not answer; `paused` when the extension is turned off. */
  | { state: 'error'; paused: boolean };

/** The design and its checks, in parallel. A checks read that fails only hides the badge. */
export const readCard = async (client: CardClient, slug: string): Promise<CardRead> => {
  const checks = client.call('GET /designs/:slug/checks', { params: { slug } }).then(
    (answer): ChecksSummary => ({ counts: answer.counts, render: { state: answer.render.state }, canRun: answer.canRun, browser: answer.browser }),
    () => null,
  );
  try {
    const detail = await client.call('GET /designs/:slug', { params: { slug } });
    return { state: 'ready', detail, checks: await checks };
  } catch (error) {
    if (isServiceError(error, 'not-found')) return { state: 'gone' };
    return { state: 'error', paused: isServiceError(error, 'DISABLED') };
  }
};

export type PickOutcome = 'sent' | 'ignored' | { error: unknown };

export type Picker = {
  state(): PickerState;
  /**
   * Answers with tile `index`. Must be called from the click itself: the host refuses an answer
   * without a user activation, so nothing is awaited before `answer` is called.
   */
  pick(index: number): Promise<PickOutcome>;
  /** The answer the host replays (`onBlock`, also after a reload). */
  restore(answered: string | null): void;
};

export const createPicker = (answer: (text: string) => Promise<void>, options: readonly DirectionOption[], onChange: (state: PickerState) => void): Picker => {
  let current: PickerState = { phase: 'open', picked: null, sending: null };
  // Read through a function: `restore` can change the phase while an answer is on its way.
  const phase = (): PickerState['phase'] => current.phase;
  const set = (next: PickerState): void => {
    current = next;
    onChange(next);
  };
  return {
    state: () => current,
    pick: async (index) => {
      const option = options[index];
      if (current.phase !== 'open' || option === undefined) return 'ignored';
      const sent = answer(answerText(option));
      set({ phase: 'sending', picked: null, sending: index });
      try {
        await sent;
      } catch (error) {
        // A replay may already have marked the block answered (another window, a note); keep that.
        if (phase() === 'sending') set({ phase: 'open', picked: null, sending: null });
        return { error };
      }
      if (phase() === 'sending') set({ phase: 'answered', picked: index, sending: null });
      return 'sent';
    },
    restore: (answered) => {
      const marked = answeredOption(answered, options.length);
      if (marked === null) return;
      set({ phase: 'answered', picked: marked === 'note' ? null : marked, sending: null });
    },
  };
};
