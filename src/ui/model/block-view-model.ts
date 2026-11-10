// Chat blocks as data (documentation/specs/phase-1-5-sdk-2-7.md §U7, §U8): what a card says, what a
// preview shows, which tile an answer marks. Pure: no DOM, no host or service calls. The check line
// is the viewer's own badge (`badgeOf`), so a design reads the same in the chat and in the rail.

import type { ChecksSummary, DesignDetailResponse, ThumbnailResponse } from '../../shared/api.ts';
import { BLOCK_SCREEN_TITLE_MAX, BLOCK_SCREENS_SHOWN, BLOCK_TITLE_MAX, THUMB_DATA_TEXT_MAX, THUMB_RETRY_DELAYS_MS } from '../../shared/limits.ts';
import type { DesignKind } from '../../shared/types.ts';
import { GUEST_BLOCK_ANSWER_MAX } from '@openchamber/sdk';
import { isServiceError } from '../../guest/service-client.ts';
import { clipText, OPTION_LETTERS, type DirectionOption } from './block-args.ts';
import { badgeOf, type BadgeView } from './checks-model.ts';

// ---------------------------------------------------------------- answers

/** What a tile hands the agent: `B: Editorial (pricing-b)`. */
export const answerText = (option: DirectionOption): string => clipText(`${option.letter}: ${option.label} (${option.slug})`, GUEST_BLOCK_ANSWER_MAX);

const ANSWER_PREFIX = /^([A-D]): /;

/**
 * Which tile an answer (replayed by the host after a reload) marks: the index of the option whose
 * letter starts it with our own `<letter>: ` prefix, or `note` for anything else (the user typed a
 * note, or a letter past the last option). Only the prefix is compared: a clipped label or text the
 * host kept around the answer still marks the tile. `null` = not answered yet.
 */
export const answeredOption = (answered: string | null, count: number): number | 'note' | null => {
  if (answered === null) return null;
  const letter = ANSWER_PREFIX.exec(answered)?.[1];
  const index = letter === undefined ? -1 : OPTION_LETTERS.indexOf(letter as (typeof OPTION_LETTERS)[number]);
  return index >= 0 && index < count ? index : 'note';
};

// ---------------------------------------------------------------- previews

const BASE64 = /^[A-Za-z0-9+/=]+$/;

/**
 * The `data:` URL for a ready thumbnail, or null. Only base64 text within `THUMB_DATA_TEXT_MAX`
 * reaches an `<img src>`: anything else from the service (or a fake) is never put in a URL.
 */
export const thumbSrc = (answer: ThumbnailResponse): string | null => {
  if (answer.state !== 'ready') return null;
  const png: unknown = answer.png;
  if (typeof png !== 'string' || png.length === 0 || png.length > THUMB_DATA_TEXT_MAX || !BASE64.test(png)) return null;
  return `data:image/png;base64,${png}`;
};

export type PreviewNoteReason = 'not-ready' | 'no-chrome' | 'failed' | 'missing' | 'error';

export type PreviewView =
  | { state: 'image'; src: string }
  /** Still being made: ask again in `retryInMs`. */
  | { state: 'waiting'; retryInMs: number }
  | { state: 'note'; reason: PreviewNoteReason; text: string };

const NOTES: Record<PreviewNoteReason, string> = {
  'not-ready': 'Preview not ready yet',
  'no-chrome': 'No preview without Chrome',
  failed: 'The preview couldn’t be made',
  missing: 'Not found',
  error: 'The preview didn’t load',
};

const note = (reason: PreviewNoteReason): PreviewView => ({ state: 'note', reason, text: NOTES[reason] });

/**
 * What a preview shows after `attempt` reads (1 after the first). A pending thumbnail is asked for
 * again at each `THUMB_RETRY_DELAYS_MS` step, then the preview says it is not ready.
 */
export const previewOf = (result: { answer: ThumbnailResponse } | { error: unknown }, attempt: number): PreviewView => {
  if ('error' in result) return note(isServiceError(result.error, 'not-found') ? 'missing' : 'error');
  const { answer } = result;
  switch (answer.state) {
    case 'ready': {
      const src = thumbSrc(answer);
      return src === null ? note('failed') : { state: 'image', src };
    }
    case 'pending': {
      const delay = THUMB_RETRY_DELAYS_MS[attempt - 1];
      return delay === undefined ? note('not-ready') : { state: 'waiting', retryInMs: delay };
    }
    case 'unavailable':
      return note('no-chrome');
    case 'failed':
      return note('failed');
  }
};

// ---------------------------------------------------------------- the card

export type CardView = {
  title: string;
  kind: DesignKind;
  kindLabel: string;
  /** `Screens: Welcome, Plans, Checkout` (canvas) or `Viewports: Laptop, Phone` (page). */
  detailLine: string;
  /** The viewer's Checks badge; null when the checks could not be read (hidden, not guessed). */
  badge: BadgeView | null;
};

const listLine = (lead: string, names: readonly string[]): string => {
  const shown = names.slice(0, BLOCK_SCREENS_SHOWN).map((name) => clipText(name, BLOCK_SCREEN_TITLE_MAX));
  const more = names.length - shown.length;
  return `${lead}: ${[...shown, ...(more > 0 ? [`+${more} more`] : [])].join(', ')}`;
};

export const cardView = (detail: DesignDetailResponse, checks: ChecksSummary | null): CardView => {
  const { design } = detail;
  const title = clipText(design.title, BLOCK_TITLE_MAX);
  const canvas = design.kind === 'canvas';
  const detailLine = canvas
    ? design.screens.length === 0
      ? 'No screens yet'
      : listLine('Screens', design.screens.map((screen) => screen.title))
    : listLine('Viewports', design.viewports.map((viewport) => viewport.label));
  return {
    title: title === '' ? detail.slug : title,
    kind: design.kind,
    kindLabel: canvas ? 'Canvas' : 'Page',
    detailLine,
    badge: checks === null ? null : badgeOf(checks, null, false),
  };
};

// ---------------------------------------------------------------- the picker

export type PickerState = {
  phase: 'open' | 'sending' | 'answered';
  /** The marked tile once answered; null for a note. */
  picked: number | null;
  /** The tile whose answer is on its way. */
  sending: number | null;
};

export type TileView = { pressed: boolean; disabled: boolean; dimmed: boolean; busy: boolean };

export type PickerView = { caption: string; tiles: TileView[] };

export const pickerView = (state: PickerState, options: readonly DirectionOption[]): PickerView => {
  const answered = state.phase === 'answered';
  const tiles = options.map(
    (_, index): TileView => ({
      pressed: answered && state.picked === index,
      disabled: state.phase !== 'open',
      dimmed: answered && state.picked !== null && state.picked !== index,
      busy: state.phase === 'sending' && state.sending === index,
    }),
  );
  const pickedLetter = state.picked === null ? undefined : options[state.picked]?.letter;
  const caption =
    state.phase === 'open'
      ? 'Pick one, or answer with a note below.'
      : state.phase === 'sending'
        ? 'Sending your choice…'
        : pickedLetter === undefined
          ? 'You answered with a note.'
          : `You picked ${pickedLetter}.`;
  return { caption, tiles };
};
