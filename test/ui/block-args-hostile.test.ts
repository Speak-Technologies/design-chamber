// QA regression: chat block arguments written by a hostile or confused model
// (documentation/specs/phase-1-5-sdk-2-7.md §U7.2, §U8.2, §6 "Block frames"). parseBlockArgs never
// throws, keeps markup as literal text (the frame sets it with textContent), refuses look-alike
// slugs, and stays bounded on huge input.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIRECTION_LABEL_MAX, DIRECTION_QUESTION_MAX } from '../../src/shared/limits.ts';
import { parseBlockArgs } from '../../src/ui/model/block-args.ts';
import { answeredOption, answerText } from '../../src/ui/model/block-view-model.ts';
import { createPicker } from '../../src/ui/blocks/block-data.ts';

test('hostile: markup in the question and labels stays literal text', () => {
  const parsed = parseBlockArgs('DirectionPick', { question: '<script>alert(1)</script>', options: '<img src=x onerror=alert(1)>|"><b>B</b>', slugs: 'a|b' });
  assert.ok(parsed.ok && parsed.block.name === 'DirectionPick');
  if (parsed.ok && parsed.block.name === 'DirectionPick') {
    assert.equal(parsed.block.question, '<script>alert(1)</script>');
    assert.equal(parsed.block.options[0]?.label, '<img src=x onerror=alert(1)>');
    assert.equal(parsed.block.options[1]?.label, '"><b>B</b>');
  }
});

test('hostile: look-alike, control-character and encoded slugs are refused', () => {
  for (const slug of ['pricing‐b', 'pricing\u0000', 'a\nb', '%2e%2e', '..', '.', 'a b', 'ａ', '\\\\server\\share', 'pricing-b​', '/abs']) {
    const card = parseBlockArgs('DesignCard', { slug });
    assert.equal(card.ok, false, JSON.stringify(slug));
    const pick = parseBlockArgs('DirectionPick', { options: 'A|B', slugs: `a|${slug}` });
    assert.equal(pick.ok, false, `pick ${JSON.stringify(slug)}`);
  }
});

test('hostile: odd argument shapes never throw', () => {
  const weird: unknown[] = [null, undefined, 0, true, [], {}, ['a', 'b'], { toString: () => 'a|b' }, Symbol('x'), 10n];
  for (const value of weird) {
    assert.doesNotThrow(() => parseBlockArgs('DesignCard', { slug: value }));
    assert.doesNotThrow(() => parseBlockArgs('DirectionPick', { question: value, options: value, slugs: value }));
    assert.doesNotThrow(() => parseBlockArgs('DirectionPick', { question: value, options: 'A|B', slugs: 'a|b' }));
  }
  assert.doesNotThrow(() => parseBlockArgs('DesignCard', Object.create(null) as Record<string, unknown>));
  assert.equal(parseBlockArgs('DesignCard', { slug: { toString: () => 'a' } }).ok, false, 'only real strings count');
});

test('hostile: pipe edge cases', () => {
  const ok = (options: string, slugs: string): boolean => parseBlockArgs('DirectionPick', { options, slugs }).ok;
  assert.equal(ok('||||', '||||'), false);
  assert.equal(ok('A|B|', 'a|b|'), true, 'trailing pipes are harmless');
  assert.equal(ok('|A|B', '|a|b'), true, 'leading pipes are harmless');
  assert.equal(ok('A|B|C|D', 'a|b|c|d'), true);
  assert.equal(ok('A|B|C|D|', 'a|b|c|d|e'), false, 'counts after dropping empties must still match');
});

test('hostile: huge arguments are bounded and do not throw', () => {
  const huge = 'x'.repeat(1_000_000);
  const parsed = parseBlockArgs('DirectionPick', { question: huge, options: `${huge}|${huge}`, slugs: 'a|b' });
  assert.ok(parsed.ok && parsed.block.name === 'DirectionPick');
  if (parsed.ok && parsed.block.name === 'DirectionPick') {
    assert.equal(Array.from(parsed.block.question).length, DIRECTION_QUESTION_MAX);
    for (const option of parsed.block.options) assert.equal(Array.from(option.label).length, DIRECTION_LABEL_MAX);
  }
  assert.equal(parseBlockArgs('DesignCard', { slug: huge }).ok, false);
  assert.equal(parseBlockArgs('DirectionPick', { options: Array(5000).fill('A').join('|'), slugs: Array(5000).fill('a').join('|') }).ok, false);
});

test('hostile: a label that looks like another answer still round-trips to its own tile', () => {
  const parsed = parseBlockArgs('DirectionPick', { options: 'D: fake|B', slugs: 'a|b' });
  assert.ok(parsed.ok && parsed.block.name === 'DirectionPick');
  if (parsed.ok && parsed.block.name === 'DirectionPick') {
    const first = parsed.block.options[0];
    assert.ok(first);
    if (first) assert.equal(answeredOption(answerText(first), parsed.block.options.length), 0);
  }
});

test('picker: the host answer is called synchronously inside the click (user activation)', () => {
  const texts: string[] = [];
  const picker = createPicker(
    (text) => {
      texts.push(text);
      return new Promise<void>(() => undefined);
    },
    [
      { letter: 'A', label: 'One', slug: 'a' },
      { letter: 'B', label: 'Two', slug: 'b' },
    ],
    () => undefined,
  );
  void picker.pick(0);
  assert.deepEqual(texts, ['A: One (a)'], 'answer must be called before pick() yields');
});

test('picker: a replayed note while an answer is in flight wins, and the late success does not overwrite it', async () => {
  let release: () => void = () => undefined;
  const picker = createPicker(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    [
      { letter: 'A', label: 'One', slug: 'a' },
      { letter: 'B', label: 'Two', slug: 'b' },
    ],
    () => undefined,
  );
  const pending = picker.pick(1);
  picker.restore('Neither, try red');
  release();
  assert.equal(await pending, 'sent');
  assert.deepEqual(picker.state(), { phase: 'answered', picked: null, sending: null });
});
