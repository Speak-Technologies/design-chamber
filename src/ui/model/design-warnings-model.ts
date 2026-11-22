// What the design-warnings band shows (components/design-warnings.ts): the open design's
// `warnings` as plain sentences. Pure, so the choices (what is dropped, how many lines show
// before "N more") are tested without a DOM.

import type { DesignWarning } from '../../shared/types.ts';

/** Lines shown before the rest go behind "Show N more": a warning band is a heads-up, not a log. */
export const WARNING_LINES_SHOWN = 2;

export type WarningLines = {
  /** The sentences, in the order the service sent them, without empty or repeated ones. */
  all: string[];
  /** The ones shown while the band is collapsed. */
  shown: string[];
  /** How many are behind "Show N more". */
  more: number;
};

export const warningLines = (warnings: readonly DesignWarning[]): WarningLines => {
  const all: string[] = [];
  for (const warning of warnings) {
    const message = warning.message.trim();
    if (message !== '' && !all.includes(message)) all.push(message);
  }
  const shown = all.slice(0, WARNING_LINES_SHOWN);
  return { all, shown, more: all.length - shown.length };
};

/** The toggle's visible text and its screen-reader name. */
export const moreLabel = (more: number, expanded: boolean): string => (expanded ? 'Show fewer' : `Show ${more} more`);

/** A name for the region, so a screen reader says what the lines are ("Design.json problems, 3"). */
export const bandLabel = (count: number): string => (count === 1 ? 'A problem with this design' : `${count} problems with this design`);
