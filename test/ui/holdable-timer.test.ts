import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { createHoldableTimer } from '../../src/ui/model/holdable-timer.ts';

const clock = (t: TestContext): void => t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

test('expires once after the full time', (t) => {
  clock(t);
  let expired = 0;
  const timer = createHoldableTimer(10_000, () => (expired += 1));
  timer.start();
  t.mock.timers.tick(9_999);
  assert.equal(expired, 0);
  t.mock.timers.tick(1);
  assert.equal(expired, 1);
  t.mock.timers.tick(60_000);
  assert.equal(expired, 1);
});

test('a hold stops the clock and release resumes with what was left', (t) => {
  clock(t);
  let expired = 0;
  const timer = createHoldableTimer(10_000, () => (expired += 1));
  timer.start();
  t.mock.timers.tick(7_000);
  timer.setHeld('hover', true);
  t.mock.timers.tick(60_000);
  assert.equal(expired, 0, 'held: never expires');
  timer.setHeld('hover', false);
  t.mock.timers.tick(2_999);
  assert.equal(expired, 0, '3 s were left, not the full 10 s and not 0');
  t.mock.timers.tick(1);
  assert.equal(expired, 1);
});

test('hover and focus both have to let go before the clock runs again', (t) => {
  clock(t);
  let expired = 0;
  const timer = createHoldableTimer(5_000, () => (expired += 1));
  timer.start();
  timer.setHeld('hover', true);
  timer.setHeld('focus', true);
  timer.setHeld('hover', false);
  t.mock.timers.tick(30_000);
  assert.equal(expired, 0, 'focus still holds it');
  timer.setHeld('focus', false);
  t.mock.timers.tick(5_000);
  assert.equal(expired, 1);
});

test('start while held waits for the release; start again resets the time; cancel never expires', (t) => {
  clock(t);
  let expired = 0;
  const timer = createHoldableTimer(4_000, () => (expired += 1));
  timer.setHeld('hover', true);
  timer.start();
  t.mock.timers.tick(10_000);
  assert.equal(expired, 0);
  timer.setHeld('hover', false);
  t.mock.timers.tick(3_000);
  timer.start();
  t.mock.timers.tick(3_999);
  assert.equal(expired, 0, 'restarted from the full time');
  timer.cancel();
  t.mock.timers.tick(60_000);
  assert.equal(expired, 0);
});

test('releasing a hold that was never taken does nothing', (t) => {
  clock(t);
  let expired = 0;
  const timer = createHoldableTimer(1_000, () => (expired += 1));
  timer.start();
  timer.setHeld('hover', false);
  t.mock.timers.tick(1_000);
  assert.equal(expired, 1);
});
