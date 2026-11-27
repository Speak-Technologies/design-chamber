// Where the comment card (new comment or a pin's thread) and the selection toolbar sit on the wall.
// One answer for both, so the toolbar can never cover the card's buttons. All in surface px. Pure.

export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export type CardPlaceInput = {
  /** The element (or pin) the card belongs to, where it is on screen now; it may be off the wall. */
  box: Box;
  card: Size;
  toolbar: Size | null;
  /** The part of the wall nothing covers. */
  stage: Size;
};

export type CardPlace = {
  card: { left: number; top: number };
  /** Null: no toolbar was asked for, or there is no room for it beside the card. */
  toolbar: { left: number; top: number; below: boolean } | null;
};

const EDGE = 8;
const CARD_GAP = 10;
const TOOLBAR_GAP = 6;
/** An element this close to the top edge has no toolbar above it. */
const FLIP_WITHIN = 48;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, Math.max(low, high)));

/**
 * The card goes under its element and the toolbar over it. When that does not fit they stack,
 * toolbar on top, under the element or else over it. Everything is kept on the wall, so an element
 * that has been moved away leaves them at the edge closest to it. The card comes first: without room
 * for both, the toolbar goes, and a card taller than the wall keeps its foot (the buttons) in view.
 */
export const placeCardAndToolbar = ({ box, card, toolbar, stage }: CardPlaceInput): CardPlace => {
  const across = (width: number): number => clamp(box.x, EDGE, stage.w - width - EDGE);
  const room = stage.h - 2 * EDGE;
  const under = box.y + box.h;
  /** The top of something `height` tall next to the element, `gap` px under it when it fits there. */
  const down = (height: number, gap: number): number => {
    if (height > room) return stage.h - EDGE - height;
    const wanted = under + gap + height <= stage.h - EDGE ? under + gap : box.y - CARD_GAP - height;
    return clamp(wanted, EDGE, stage.h - EDGE - height);
  };
  const alone: CardPlace = { card: { left: across(card.w), top: down(card.h, CARD_GAP) }, toolbar: null };
  if (!toolbar) return alone;

  const over = box.y - toolbar.h - TOOLBAR_GAP;
  const cardUnder = under + CARD_GAP;
  const split = box.y >= Math.max(FLIP_WITHIN, toolbar.h + TOOLBAR_GAP + EDGE) && over + toolbar.h <= stage.h - EDGE && cardUnder + card.h <= stage.h - EDGE;
  if (split) return { card: { left: across(card.w), top: cardUnder }, toolbar: { left: across(toolbar.w), top: over, below: false } };

  const stack = toolbar.h + TOOLBAR_GAP + card.h;
  if (stack > room) return alone;
  const top = down(stack, TOOLBAR_GAP);
  return { card: { left: across(card.w), top: top + toolbar.h + TOOLBAR_GAP }, toolbar: { left: across(toolbar.w), top, below: top > box.y } };
};
