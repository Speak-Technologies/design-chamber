// The sentences that tell the user how to work the wall, the ask bar and the text box. Desktop and
// tablet name keys; a phone has no Ctrl, Shift, Esc, Space or arrows, so it gets its own. The
// visible shortcut lines in the comment card and the text box are hidden on a phone in styles.css. Pure.

import type { Device } from './device-model.ts';
import { CLICK_AWAY_LINE } from './edit-text-model.ts';

export type InputWords = {
  /** The canvas wall's accessible name. */
  wall: string;
  /** The page viewer's accessible name. */
  page: string;
  /** Read out with the ask bar. */
  askBar: string;
  /** Shown under the text box after a tap or click away from unsaved changes. */
  editClickAway: string;
};

const KEYBOARD: InputWords = {
  wall: 'Design wall. Arrow keys pan, plus and minus zoom, Shift+1 fits everything. Hold Space and drag to pan.',
  page: 'Page preview. Arrow keys, Page Up and Page Down scroll the page.',
  askBar: 'Enter sends, Shift+Enter adds a line.',
  editClickAway: CLICK_AWAY_LINE,
};

const PHONE: InputWords = {
  wall: 'Design wall. Drag to move it and pinch to zoom.',
  page: 'Page preview. Drag to scroll the page.',
  askBar: 'The return key sends.',
  editClickAway: 'Tap Save to keep this change, or Cancel to discard it.',
};

export const inputWords = (form: Device['form']): InputWords => (form === 'phone' ? PHONE : KEYBOARD);
