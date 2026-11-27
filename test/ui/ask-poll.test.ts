// How long an unanswered SystemAsk block keeps asking (review finding F4: it asked every 5 s forever, so the
// service never reached its idle stop). Driven with mocked timers.
import assert from 'node:assert/strict';
import { mock, test, type TestContext } from 'node:test';

import { ASK_POLL_BACKOFF_MAX_MS, startAskPoll, type PollVerdict } from '../../src/ui/model/ask-poll.ts';

const MS = 5000;

/** A poller whose reads answer whatever `next` says; `at` records when each read started. */
const setup = (t: TestContext, next: () => PollVerdict | Promise<PollVerdict>, visible: () => boolean = () => true) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let now = 0;
  const at: number[] = [];
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  const poll = startAskPoll(
    async () => {
      at.push(now);
      return next();
    },
    MS,
    visible,
  );
  const run = async (ms: number): Promise<void> => {
    for (let passed = 0; passed < ms; passed += 1000) {
      await settle();
      now += 1000;
      mock.timers.tick(1000);
    }
    await settle();
  };
  return { at, poll, run, settle };
};

test('a live question is read at once and then every 5 s', async (t) => {
  const { at, run } = setup(t, () => 'again');
  await run(15_000);
  assert.deepEqual(at, [0, 5000, 10_000, 15_000]);
});

test('done stops the polling for good, and focus does not restart it', async (t) => {
  let reads = 0;
  const { at, poll, run } = setup(t, () => ((reads += 1) === 2 ? 'done' : 'again'));
  await run(120_000);
  poll.now();
  await run(10_000);
  assert.deepEqual(at, [0, 5000]);
});

test('while the service is down the wait doubles up to a minute, and returns to 5 s once it answers', async (t) => {
  let down = true;
  const { at, run } = setup(t, () => (down ? 'later' : 'again'));
  await run(200_000);
  assert.deepEqual(at, [0, 10_000, 30_000, 70_000, 130_000, 190_000]);
  assert.equal(ASK_POLL_BACKOFF_MAX_MS, 60_000);
  down = false;
  await run(60_000); // the read at 250 s succeeds
  await run(5000);
  assert.deepEqual(at.slice(6, 8), [250_000, 255_000]);
});

test('a read that throws counts as the service being down', async (t) => {
  const warn = mock.method(console, 'warn', () => undefined);
  t.after(() => warn.mock.restore());
  const { at, run } = setup(t, () => Promise.reject(new Error('boom')));
  await run(30_000);
  assert.deepEqual(at, [0, 10_000, 30_000]);
});

test('a hidden frame sends nothing until it is seen again; now() reads at once', async (t) => {
  let seen = false;
  const { at, poll, run } = setup(t, () => 'again', () => seen);
  await run(30_000);
  assert.deepEqual(at, [0]); // the mount read
  poll.now();
  assert.deepEqual(at, [0]);
  seen = true;
  poll.now();
  await run(5000);
  assert.deepEqual(at, [0, 30_000, 35_000]);
});

test('one read at a time, and stop() ends it even with a read out', async (t) => {
  let release: (verdict: PollVerdict) => void = () => undefined;
  const { at, poll, run } = setup(t, () => new Promise<PollVerdict>((resolve) => (release = resolve)));
  poll.now();
  await run(20_000);
  assert.deepEqual(at, [0]);
  poll.stop();
  release('again');
  await run(20_000);
  assert.deepEqual(at, [0]);
});
