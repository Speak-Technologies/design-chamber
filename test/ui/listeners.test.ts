import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createListeners } from '../../src/ui/model/listeners.ts';

test('emit calls listeners in the order they were added, with the arguments', () => {
  const seen: string[] = [];
  const listeners = createListeners<[string]>();
  listeners.add((value) => seen.push(`a:${value}`));
  listeners.add((value) => seen.push(`b:${value}`));
  listeners.emit('x');
  assert.deepEqual(seen, ['a:x', 'b:x']);
});

test('the returned remover stops a listener, and calling it twice is harmless', () => {
  const seen: number[] = [];
  const listeners = createListeners();
  const remove = listeners.add(() => seen.push(1));
  listeners.add(() => seen.push(2));
  remove();
  remove();
  listeners.emit();
  assert.deepEqual(seen, [2]);
  assert.equal(listeners.size(), 1);
});

test('a listener that removes itself or adds another does not change the round in progress', () => {
  const seen: string[] = [];
  const listeners = createListeners();
  const removeFirst = listeners.add(() => {
    seen.push('first');
    removeFirst();
    listeners.add(() => seen.push('late'));
  });
  listeners.add(() => seen.push('second'));
  listeners.emit();
  assert.deepEqual(seen, ['first', 'second']);
  listeners.emit();
  assert.deepEqual(seen, ['first', 'second', 'second', 'late']);
});

test('a listener that throws does not stop the others', (t) => {
  const log = t.mock.method(console, 'error', () => undefined);
  const seen: string[] = [];
  const listeners = createListeners();
  listeners.add(() => {
    throw new Error('boom');
  });
  listeners.add(() => seen.push('after'));
  listeners.emit();
  assert.deepEqual(seen, ['after']);
  assert.equal(log.mock.callCount(), 1);
});
