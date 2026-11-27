// Where the comment card and the selection toolbar go (src/ui/model/card-place-model.ts): the card
// follows its element, stays in view when the element leaves, and the toolbar never covers it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeCardAndToolbar, type CardPlaceInput } from '../../src/ui/model/card-place-model.ts';

const stage = { w: 1000, h: 700 };
const card = { w: 300, h: 220 };
const toolbar = { w: 260, h: 34 };
const place = (box: CardPlaceInput['box'], over: Partial<CardPlaceInput> = {}) => placeCardAndToolbar({ box, card, toolbar, stage, ...over });

test('with room, the card sits under its element and the toolbar above it', () => {
  assert.deepEqual(place({ x: 200, y: 200, w: 400, h: 60 }), { card: { left: 200, top: 270 }, toolbar: { left: 200, top: 160, below: false } });
});

test('no toolbar: under the element, or above it when there is no room under it', () => {
  assert.deepEqual(place({ x: 200, y: 200, w: 400, h: 60 }, { toolbar: null }), { card: { left: 200, top: 270 }, toolbar: null });
  assert.deepEqual(place({ x: 200, y: 500, w: 400, h: 60 }, { toolbar: null }).card, { left: 200, top: 500 - 10 - 220 });
});

test('the card moves by exactly as much as its element while it has room', () => {
  const a = place({ x: 200, y: 200, w: 100, h: 40 });
  const b = place({ x: 230, y: 180, w: 100, h: 40 });
  assert.equal(b.card.left - a.card.left, 30);
  assert.equal(b.card.top - a.card.top, -20);
});

test('an element off screen keeps the card in view at the edge closest to it', () => {
  const at = (x: number, y: number) => place({ x, y, w: 100, h: 40 }, { toolbar: null }).card;
  assert.equal(at(-900, 200).left, 8, 'left');
  assert.equal(at(4000, 200).left, 1000 - 300 - 8, 'right');
  assert.equal(at(300, -900).top, 8, 'top');
  assert.equal(at(300, 4000).top, 700 - 220 - 8, 'bottom');
  assert.deepEqual(at(-900, 4000), { left: 8, top: 700 - 220 - 8 }, 'a corner');
});

test('when under does not fit, toolbar and card stack above the element, toolbar on top', () => {
  const result = place({ x: 200, y: 500, w: 100, h: 40 });
  assert.deepEqual(result.card, { left: 200, top: 500 - 10 - 220 });
  assert.deepEqual(result.toolbar, { left: 200, top: 500 - 10 - 220 - 6 - 34, below: false });
});

test('an element at the very top: toolbar then card, both under it', () => {
  const result = place({ x: 200, y: 10, w: 100, h: 40 });
  assert.deepEqual(result.toolbar, { left: 200, top: 56, below: true });
  assert.deepEqual(result.card, { left: 200, top: 96 });
});

test('no room for both: the toolbar goes and the card stays whole', () => {
  const result = place({ x: 20, y: 100, w: 100, h: 40 }, { stage: { w: 320, h: 250 } });
  assert.equal(result.toolbar, null);
  assert.ok(result.card.top >= 8 && result.card.top + card.h <= 250 - 8);
});

test('a card taller than the wall keeps its foot, where the buttons are, in view', () => {
  const result = place({ x: 20, y: 40, w: 100, h: 40 }, { stage: { w: 320, h: 180 } });
  assert.equal(result.card.top + card.h, 180 - 8);
  assert.equal(result.toolbar, null);
});

test('wherever the element is, the toolbar never overlaps the card and both stay on the wall', () => {
  for (const [w, h] of [[320, 460], [320, 300], [390, 570], [1400, 760]] as const) {
    for (const bar of [{ w: 260, h: 34 }, { w: 268, h: 78 }]) {
      for (const size of [{ w: Math.min(300, w - 16), h: 210 }, { w: Math.min(300, w - 16), h: 260 }]) {
        for (let x = -500; x <= w + 500; x += 125) {
          for (let y = -500; y <= h + 500; y += 23) {
            for (const boxH of [0, 40, 400]) {
              const at = `stage ${w}×${h}, card ${size.h}, bar ${bar.h}, element ${x},${y}×${boxH}`;
              const result = placeCardAndToolbar({ box: { x, y, w: 80, h: boxH }, card: size, toolbar: bar, stage: { w, h } });
              assert.ok(result.card.left >= 8 && result.card.left + size.w <= w - 8, `card across: ${at}`);
              assert.ok(result.card.top >= 8 && result.card.top + size.h <= h - 8, `card down: ${at}`);
              if (result.toolbar === null) {
                assert.ok(size.h + 6 + bar.h > h - 16, `dropped only without room: ${at}`);
                continue;
              }
              const t = result.toolbar;
              assert.ok(t.top + bar.h <= result.card.top || t.top >= result.card.top + size.h, `overlap: ${at}`);
              assert.ok(t.top >= 8 && t.top + bar.h <= h - 8 && t.left >= 8 && t.left + bar.w <= w - 8, `toolbar on the wall: ${at}`);
            }
          }
        }
      }
    }
  }
});
