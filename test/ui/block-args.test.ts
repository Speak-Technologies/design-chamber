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

// ---- SystemAsk (documentation/specs/phase-2-5-technical.md §8.12)

import { GUEST_BLOCK_ARGS_TEXT_MAX } from '@openchamber/sdk';

const ask = (args: Record<string, unknown>) => parseBlockArgs('SystemAsk', args);
const TICKET = 'sb_abcdefghij12';
const CALLS = JSON.stringify([{ topic: 'greys', why: 'Greys are blue-ish.', proposed: 'Brand-tinted' }]);

test('SystemAsk interview-1: a ticket, with the unused slots empty as the manifest passes them', () => {
  assert.deepEqual(ask({ kind: 'interview-1', ticket: TICKET, systemId: '', proposalId: '', calls: '' }), { ok: true, block: { name: 'SystemAsk', ask: { kind: 'interview-1', ticket: TICKET } } });
  assert.deepEqual(ask({ kind: 'interview-1', ticket: ` ${TICKET} ` }), { ok: true, block: { name: 'SystemAsk', ask: { kind: 'interview-1', ticket: TICKET } } });
});

test('SystemAsk interview-1: every bad ticket is refused', () => {
  for (const ticket of [undefined, '', 'sb_short', 'SB_ABCDEFGHIJ12', 'sb_abcdefghij123', '../x', 7, null, `${TICKET}\n`.replace(/\n/, ' x')]) {
    assert.deepEqual(ask({ kind: 'interview-1', ticket }), { ok: false, reason: 'bad-system-ask' }, `ticket ${JSON.stringify(ticket)}`);
  }
});

test('SystemAsk: a kind that is missing, unknown or not text is refused', () => {
  for (const kind of [undefined, '', 'interview', 'Interview-1', 'diffs', 3, ['diff']]) {
    assert.deepEqual(ask({ kind, ticket: TICKET, systemId: 'acme', proposalId: 'p_k3m9q2x7', calls: CALLS }), { ok: false, reason: 'bad-system-ask' }, `kind ${JSON.stringify(kind)}`);
  }
});

test('SystemAsk interview-2: a system id and calls as JSON text', () => {
  const parsed = ask({ kind: 'interview-2', ticket: '', systemId: 'acme', proposalId: '', calls: CALLS });
  assert.deepEqual(parsed, { ok: true, block: { name: 'SystemAsk', ask: { kind: 'interview-2', systemId: 'acme', calls: [{ topic: 'greys', why: 'Greys are blue-ish.', proposed: 'Brand-tinted' }], dropped: 0 } } });
});

test('SystemAsk interview-2: a bad system id or calls that are not a JSON array are refused', () => {
  for (const systemId of [undefined, '', '../acme', 'Acme', 'a/b', 'x'.repeat(64), 5]) {
    assert.equal(ask({ kind: 'interview-2', systemId, calls: CALLS }).ok, false, `systemId ${JSON.stringify(systemId)}`);
  }
  for (const calls of [undefined, '', '   ', '{', 'not json', '{"topic":"greys"}', '"greys"', 'null', 12, [{ topic: 'greys' }]]) {
    assert.deepEqual(ask({ kind: 'interview-2', systemId: 'acme', calls }), { ok: false, reason: 'bad-system-ask' }, `calls ${JSON.stringify(calls)}`);
  }
});

test('SystemAsk interview-2: unreadable entries, repeats and calls past the eighth are dropped and counted, long text is clipped', () => {
  const entries: unknown[] = [
    { topic: 'greys', why: 'w'.repeat(500), proposed: 'p'.repeat(500) },
    'greys',
    null,
    { why: 'no topic' },
    { topic: 42 },
    { topic: 'greys', why: 'again' },
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((topic) => ({ topic, why: 'x', proposed: 'y' })),
  ];
  const parsed = ask({ kind: 'interview-2', systemId: 'acme', calls: JSON.stringify(entries) });
  assert.ok(parsed.ok && parsed.block.name === 'SystemAsk' && parsed.block.ask.kind === 'interview-2');
  if (parsed.ok && parsed.block.name === 'SystemAsk' && parsed.block.ask.kind === 'interview-2') {
    assert.equal(parsed.block.ask.calls.length, 8);
    assert.equal(parsed.block.ask.dropped, 6);
    assert.equal(Array.from(parsed.block.ask.calls[0]?.why ?? '').length, 300);
    assert.equal(Array.from(parsed.block.ask.calls[0]?.proposed ?? '').length, 200);
    assert.equal(parsed.block.ask.calls[1]?.topic, 'a');
  }
});

test('SystemAsk diff: a system id and a proposal id', () => {
  assert.deepEqual(ask({ kind: 'diff', ticket: '', systemId: 'acme', proposalId: 'p_k3m9q2x7', calls: '' }), { ok: true, block: { name: 'SystemAsk', ask: { kind: 'diff', systemId: 'acme', proposalId: 'p_k3m9q2x7' } } });
});

test('SystemAsk diff: every bad proposal id or system id is refused', () => {
  for (const proposalId of [undefined, '', 'k3m9q2x7', 'p_', 'p_short', 'P_K3M9Q2X7', 'p_k3m9q2x7zzzzzzzzzz', 'p_k3m9q2x7/..', 7]) {
    assert.equal(ask({ kind: 'diff', systemId: 'acme', proposalId }).ok, false, `proposalId ${JSON.stringify(proposalId)}`);
  }
  assert.equal(ask({ kind: 'diff', systemId: '..', proposalId: 'p_k3m9q2x7' }).ok, false);
  assert.equal(ask({ kind: 'diff', proposalId: 'p_k3m9q2x7' }).ok, false);
});

test('SystemAsk: arguments over the host limit are refused', () => {
  const big = JSON.stringify([{ topic: 'greys', why: 'w'.repeat(GUEST_BLOCK_ARGS_TEXT_MAX), proposed: '' }]);
  assert.deepEqual(ask({ kind: 'interview-2', systemId: 'acme', calls: big }), { ok: false, reason: 'bad-system-ask' });
  assert.deepEqual(ask({ kind: 'diff', systemId: 'acme', proposalId: 'p_k3m9q2x7', extra: 'x'.repeat(GUEST_BLOCK_ARGS_TEXT_MAX) }), { ok: false, reason: 'bad-system-ask' });
});

test('SystemAsk: arguments that cannot be read as JSON never throw', () => {
  const loop: Record<string, unknown> = { kind: 'diff', systemId: 'acme', proposalId: 'p_k3m9q2x7' };
  loop.self = loop;
  assert.deepEqual(ask(loop), { ok: false, reason: 'bad-system-ask' });
});
