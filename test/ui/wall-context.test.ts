import assert from 'node:assert/strict';
import { test } from 'node:test';

import { late } from '../../src/ui/wall/wall-context.ts';

test('late: calling it before bind throws a message that names what is missing', () => {
  const slot = late<{ name: string }>('the board set');
  assert.throws(() => slot(), /the board set before it was wired up/);
});

test('late: after bind it returns the bound value, and a falsy value still counts as bound', () => {
  const slot = late<{ name: string }>('the board set');
  const value = { name: 'boards' };
  slot.bind(value);
  assert.equal(slot(), value);
  const zero = late<number>('a counter');
  zero.bind(0);
  assert.equal(zero(), 0);
});
