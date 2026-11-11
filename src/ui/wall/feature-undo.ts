// The view's one undo slot (Phase 2 technical design §2.7), shared by every hand-edit feature of one open
// design: Edit text and the screen actions each report their edit here, and Ctrl/⌘+Z undoes only the last
// one of either kind. Two slots would let one key press undo two edits (the last text edit and the last
// reorder), which is exactly what the single slot exists to prevent. The reducer is `nextUndoSlot`.

import { nextUndoSlot } from '../model/wall-input.ts';
import type { WallHandle } from './wall.ts';

export type UndoSlot = {
  /** A hand edit made by this view went through; it replaces whatever the slot held. */
  edited: (id: string) => void;
  /** Undo was pressed on that edit's own notice: the slot empties when it held it. */
  noticeUndo: (id: string) => void;
  /**
   * Ctrl/⌘+Z: the edit to undo (or null when there is none), and the slot is empty afterwards whatever the answer.
   * While an old version is on show (`viewing`, E12) nothing is undone and the slot is kept; `refusal` says why.
   */
  key: (viewing: boolean) => { undo: string | null; refusal: string | null };
};

const slots = new WeakMap<WallHandle, UndoSlot>();

export const undoSlotFor = (wall: WallHandle): UndoSlot => {
  const found = slots.get(wall);
  if (found) return found;
  let slot: string | null = null;
  const created: UndoSlot = {
    edited: (id) => {
      slot = nextUndoSlot(slot, { type: 'edited', id }).slot;
    },
    noticeUndo: (id) => {
      slot = nextUndoSlot(slot, { type: 'notice-undo', id }).slot;
    },
    key: (viewing) => {
      const next = nextUndoSlot(slot, { type: 'undo-key' }, viewing);
      slot = next.slot;
      return { undo: next.undo, refusal: next.refusal };
    },
  };
  slots.set(wall, created);
  return created;
};
