// The phone shell (documentation/specs/native-extras.md §2.2, U3): the live-frame budget per device, and the phone
// styles staying out of a desktop (every new rule is scoped by the attributes `applyDevice` sets).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PAGE_LIVE_FRAMES_MAX, RAIL_LIVE_FRAMES_MAX } from '../../src/shared/limits.ts';
import { PHONE_LIVE_FRAMES_MAX, liveBudget } from '../../src/ui/model/wall-model.ts';

test('a phone keeps two frames live, whichever layout it shows; the rail and the page keep theirs', () => {
  assert.equal(PHONE_LIVE_FRAMES_MAX, 2);
  assert.equal(liveBudget(true, 'phone'), 2);
  assert.equal(liveBudget(false, 'phone'), 2);
  assert.equal(liveBudget(true, 'desktop'), RAIL_LIVE_FRAMES_MAX);
  assert.equal(liveBudget(false, 'desktop'), PAGE_LIVE_FRAMES_MAX);
  // A tablet keeps the desktop's layouts and budgets.
  assert.equal(liveBudget(true, 'tablet'), RAIL_LIVE_FRAMES_MAX);
  assert.equal(liveBudget(false, 'tablet'), PAGE_LIVE_FRAMES_MAX);
});

test('the phone block in styles.css only matches a phone or a coarse pointer', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url)), 'utf8');
  const start = css.indexOf('/* ===== Phone (native extras §2.2) ===== */');
  assert.ok(start > -1, 'the phone block exists');
  const next = css.indexOf('/* =====', start + 1);
  const block = css.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...block.matchAll(/([^{}]+)\{/g)].map((match) => (match[1] ?? '').trim());
  assert.ok(selectors.length >= 4);
  for (const selector of selectors) {
    if (selector === '.dc-settings-where') continue; // only drawn on a phone (settings-view.ts)
    for (const part of selector.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^\[data-dc-(form='phone'|pointer='coarse')\]/, part);
  }
});
