// Saved page data, what the viewer shows about it (Phase 2 §8.6, feature 19). Pure: the menu entry's state, the confirm
// dialog's words, and the notices the controller (`guest/page-state.ts`) and the Clear action raise. The sentences the
// controller owns are imported, not copied, so a wording change there reaches the screen.

import { PAGE_STATE_CAP_SENTENCE, PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE, type PageStateNoticeKind } from '../../guest/page-state.ts';
import type { BannerTone } from '@openchamber/sdk/ui';

export const PAGE_DATA_CLEAR_LABEL = 'Clear saved page data';

/** The ⋯ menu entry: absent when there is nothing to clear, shown but off while an old version is on show. */
export type PageDataEntry = 'hidden' | 'enabled' | 'disabled';

export type PageDataEntryInput = {
  /** Characters of saved data the controller holds. */
  chars: number;
  /** This view saves (false after the load failed: nothing was read, so nothing can be cleared from here). */
  persisting: boolean;
  /** An old version is on show: it has empty data of its own and the live data is not touched from there. */
  viewing: boolean;
};

export const pageDataEntry = (input: PageDataEntryInput): PageDataEntry => {
  if (!input.persisting || input.chars <= 0) return 'hidden';
  return input.viewing ? 'disabled' : 'enabled';
};

/** Why the entry is off, as the muted second line of the menu row. */
export const PAGE_DATA_DISABLED_REASON = 'Not while viewing a version';

export const clearDialogTitle = (designTitle: string): string => `Clear saved page data for ${designTitle}?`;
export const CLEAR_DIALOG_BODY = "Ticks, toggles and filters this design saved will be reset. This can't be undone.";
export const CLEAR_DIALOG_CONFIRM = 'Clear';

/** The dialog stays open on a failure and says this (the service's own words follow). */
export const clearFailureText = (reason: string): string => `Couldn’t clear the saved page data. ${reason}`;

export type PageDataNoticeKind = PageStateNoticeKind | 'cleared';

export type PageDataNotice = { tone: BannerTone; title: string; body?: string; ttlMs: number };

/** How long a background notice stays (it holds while the pointer or focus is on it); "cleared" answers a press, so it is shorter. */
const BACKGROUND_MS = 10_000;
const CLEARED_MS = 5_000;

// The controller's "can't be saved" sentence is two sentences; the banner shows the first as its title and the second under it
// (a test holds the two halves to the controller's wording).
const UNSAVED_TITLE = "Page data can't be saved right now.";
const UNSAVED_BODY = 'Changes last until you close this design.';

export const CLEARED_SENTENCE = 'Saved page data cleared.';

export const pageDataNotice = (kind: PageDataNoticeKind): PageDataNotice => {
  switch (kind) {
    case 'unsaved':
      return { tone: 'warning', title: UNSAVED_TITLE, body: UNSAVED_BODY, ttlMs: BACKGROUND_MS };
    case 'cap':
      return { tone: 'warning', title: PAGE_STATE_CAP_SENTENCE, ttlMs: BACKGROUND_MS };
    case 'cleared-elsewhere':
      return { tone: 'info', title: PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE, ttlMs: BACKGROUND_MS };
    case 'cleared':
      return { tone: 'success', title: CLEARED_SENTENCE, ttlMs: CLEARED_MS };
  }
};
