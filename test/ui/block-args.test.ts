// parseBlockArgs: every argument of a chat block is written by a model, so it is checked before
// anything is drawn or read (documentation/specs/phase-1-5-sdk-2-7.md §U7.3 1, §U8.3 1).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIRECTION_LABEL_MAX, DIRECTION_QUESTION_MAX } from '../../src/shared/limits.ts';
import { parseBlockArgs } from '../../src/ui/model/block-args.ts';

const card = (slug: unknown) => parseBlockArgs('DesignCard', { slug } as Record<string, unknown>);

test('DesignCard: refuses a missing, empty, path-like, too long or uppercase slug', () => {
  for (const slug of [undefined, '', '   ', '../x', 'a/b', 'a\\b', 'C:\\Users', 'x'.repeat(64), 'Pricing', '-pricing', 42]) {
    const parsed = card(slug);
    assert.equal(parsed.ok, false, `slug ${JSON.stringify(slug)} should be refused`);
    if (!parsed.ok) assert.equal(parsed.reason, 'bad-slug');
  }
});

test('DesignCard: accepts a slug with spaces around it, trimmed', () => {
  assert.deepEqual(card('  pricing-b \n'), { ok: true, block: { name: 'DesignCard', slug: 'pricing-b' } });
  assert.deepEqual(card('x'.repeat(63)), { ok: true, block: { name: 'DesignCard', slug: 'x'.repeat(63) } });
});

const pick = (args: Record<string, unknown>) => parseBlockArgs('DirectionPick', args);

test('DirectionPick: two options with matching slugs are valid, lettered in order', () => {
  const parsed = pick({ question: ' Which one? ', options: 'A|B', slugs: 'a|b' });
  assert.deepEqual(parsed, {
    ok: true,
    block: {
      name: 'DirectionPick',
      question: 'Which one?',
      options: [
        { letter: 'A', label: 'A', slug: 'a' },
        { letter: 'B', label: 'B', slug: 'b' },
      ],
    },
  });
});

test('DirectionPick: options and slugs are trimmed and empty entries dropped', () => {
  const parsed = pick({ question: '', options: ' Editorial | | Dense table |', slugs: 'pricing-a | pricing-b' });
  assert.equal(parsed.ok, true);
  if (parsed.ok && parsed.block.name === 'DirectionPick') {
    assert.deepEqual(
      parsed.block.options.map(({ label, slug }) => [label, slug]),
      [
        ['Editorial', 'pricing-a'],
        ['Dense table', 'pricing-b'],
      ],
    );
  }
});

test('DirectionPick: an empty or missing question reads "Which direction?"', () => {
  for (const question of ['', '   ', undefined]) {
    const parsed = pick({ question, options: 'A|B', slugs: 'a|b' });
    assert.ok(parsed.ok && parsed.block.name === 'DirectionPick' && parsed.block.question === 'Which direction?');
  }
});

test('DirectionPick: five options, one option, mismatched counts and missing lists are refused', () => {
  const cases: Record<string, unknown>[] = [
    { options: 'A|B|C|D|E', slugs: 'a|b|c|d|e' },
    { options: 'A', slugs: 'a' },
    { options: 'A|B|C', slugs: 'a|b' },
    { options: 'A|B', slugs: 'a|b|c' },
    { options: 'A|B' },
    { slugs: 'a|b' },
    { options: '|', slugs: '|' },
  ];
  for (const args of cases) {
    const parsed = pick(args);
    assert.equal(parsed.ok, false, JSON.stringify(args));
    if (!parsed.ok) assert.equal(parsed.reason, 'bad-options');
  }
});

test('DirectionPick: one slug that is not a design folder name refuses the whole question', () => {
  for (const slugs of ['a|../b', 'a|B', 'a|b/c', 'a|' + 'x'.repeat(64)]) {
    const parsed = pick({ options: 'A|B', slugs });
    assert.equal(parsed.ok, false, slugs);
  }
});

test('DirectionPick: labels over the limit and a long question are clipped, newlines become spaces', () => {
  const long = 'L'.repeat(DIRECTION_LABEL_MAX + 20);
  const parsed = pick({ question: `Q\n${'q'.repeat(DIRECTION_QUESTION_MAX)}`, options: `${long}|Two\nlines`, slugs: 'a|b' });
  assert.ok(parsed.ok && parsed.block.name === 'DirectionPick');
  if (parsed.ok && parsed.block.name === 'DirectionPick') {
    const [first, second] = parsed.block.options;
    assert.equal(Array.from(first?.label ?? '').length, DIRECTION_LABEL_MAX);
    assert.ok(first?.label.endsWith('…'));
    assert.equal(second?.label, 'Two lines');
    assert.equal(Array.from(parsed.block.question).length, DIRECTION_QUESTION_MAX);
    assert.ok(parsed.block.question.startsWith('Q q'));
  }
});

test('clipping never splits a character made of two code units', () => {
  const parsed = pick({ options: `${'😀'.repeat(DIRECTION_LABEL_MAX + 1)}|B`, slugs: 'a|b' });
  assert.ok(parsed.ok && parsed.block.name === 'DirectionPick');
  if (parsed.ok && parsed.block.name === 'DirectionPick') {
    const label = parsed.block.options[0]?.label ?? '';
    assert.ok(!/[\uD800-\uDBFF]$/.test(label.slice(0, -1)), 'no lone high surrogate before the ellipsis');
  }
});

test('an unknown block name or arguments that are not text are refused', () => {
  assert.deepEqual(parseBlockArgs('DesignWall', { slug: 'a' }), { ok: false, reason: 'unknown-block' });
  assert.equal(pick({ options: ['A', 'B'], slugs: 'a|b' }).ok, false);
});
