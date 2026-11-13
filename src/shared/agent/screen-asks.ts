// The two ask texts the wall sends to the linked chat (Phase 2 technical design §5.2, §6.3):
// "+ Screen" and "Try 3 directions…". Both are asks: the service adds the folder, rules path and
// footer through `buildAskPrompt`, and the user's note travels verbatim as part of the words.
//
// Pure: no filesystem, no Node imports. Titles come from design.json (untrusted), so they are one
// line with their double quotes turned into single ones; the note is the user's own words and is
// never clipped here (the ask box counts down the room left after the fixed text).

import { TITLE_MAX } from '../limits.ts';
import { clip, oneLine } from './context.ts';

/** A design.json title as the ask quotes it: one line, no quote that could close early. */
const title = (text: string): string => `"${clip(oneLine(text), TITLE_MAX).replace(/"/g, "'")}"`;

const roomLine = (free: number): string => `The canvas has room for ${free} more screen${free === 1 ? '' : 's'}.`;

export type NewScreenAskInput = {
  /** The canvas title. */
  title: string;
  /** The screen the new one follows (the last row's title); null on an empty canvas. */
  after: string | null;
  /** Free screen slots (`SCREENS_MAX` minus the screens listed). */
  free: number;
  /** The user's words for the new screen, verbatim; empty or blank = none. */
  note: string;
};

/** "+ Screen": one line per clause; the agent picks the new screen's id. */
export const newScreenAsk = (input: NewScreenAskInput): string => {
  const after = input.after === null ? '' : ` after ${title(input.after)}`;
  const note = input.note.trim() === '' ? null : input.note;
  // The template ends the sentence; a note that already ends one keeps its own punctuation.
  const period = note === null || !/[.!?…]$/.test(note.trimEnd()) ? '.' : '';
  return [
    `Add a new screen to the canvas ${title(input.title)}${after}${note === null ? '' : `: ${note}`}${period}`,
    'Write it as screens/<id>.html and add it to design.json.',
    roomLine(input.free),
  ].join('\n');
};

export type DirectionsAskInput = {
  /** The screen's title. */
  title: string;
  /** The screen's id (`screens/<id>.html`). */
  id: string;
  /** Free screen slots (`SCREENS_MAX` minus the screens listed). */
  free: number;
  /** What the directions should explore, verbatim; empty or blank = none. */
  note: string;
};

/** "Try 3 directions…": the agent writes three marked siblings and leaves the original as it is. */
export const directionsAsk = (input: DirectionsAskInput): string => {
  const id = oneLine(input.id).replace(/"/g, "'");
  return [
    `Make 3 different directions for the screen ${title(input.title)} (screens/${id}.html).`,
    `Write each as its own screen (${id}-a, ${id}-b, ${id}-c) and mark it in design.json as a direction of "${id}", as RULES.md describes.`,
    `Leave "${id}" as it is.`,
    roomLine(input.free),
    ...(input.note.trim() === '' ? [] : [`What to explore: ${input.note}`]),
  ].join('\n');
};
