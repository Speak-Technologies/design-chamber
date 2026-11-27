// Sidebar marks (documentation/specs/native-extras.md §4.2, §4.8): the pure plan and text, the
// diff, the token bucket, and the running module on a fake clock (settle, working deferral,
// limited pause, refusal, root change, neutral first). Nothing here reaches a real host.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SERVICE_MARK_TEXT_MAX, SERVICE_MARKS_MAX, type ServiceMark } from '@openchamber/sdk';

import type { Logger, SessionActivity, SetMarkResult } from '../../../src/service/context.ts';
import {
  createSessionMarks,
  createRateWindow,
  markText,
  MARKS_LIMITED_PAUSE_MS,
  nextChange,
  planMarks,
  type MarkCounts,
  type MarkTimers,
} from '../../../src/service/session-marks.ts';
import { MARK_CHECK_READ_MS, MARK_SETTLE_MS, MARKS_DEBOUNCE_MS, MARKS_RATE_PER_MIN } from '../../../src/shared/limits.ts';
import type { ChangeEvent, DesignSummary } from '../../../src/shared/types.ts';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

const summary = (slug: string, over: Partial<DesignSummary> = {}): DesignSummary => ({
  slug,
  kind: 'page',
  title: slug,
  created: iso(T0),
  updated: iso(T0),
  pending: false,
  screenCount: 1,
  viewports: [],
  sessionId: null,
  projectDirectory: null,
  openComments: 0,
  thumb: { state: 'unavailable', key: null },
  warnings: [],
  ...over,
});

// ---- planMarks ----

test('planMarks groups by chat, skips unlinked designs, orders by the newest design', () => {
  const plan = planMarks(
    [
      summary('old', { sessionId: 'ses_a', title: 'Old', updated: iso(T0 - 5000) }),
      summary('loose', { title: 'Not linked' }),
      summary('pricing', { sessionId: 'ses_b', title: 'Pricing', updated: iso(T0 - 1000) }),
      summary('home', { sessionId: 'ses_a', title: 'Home', updated: iso(T0) }),
      summary('faq', { sessionId: 'ses_b', title: 'FAQ', updated: iso(T0 - 2000) }),
    ],
    new Map(),
  );
  assert.deepEqual([...plan.keys()], ['ses_a', 'ses_b']);
  assert.deepEqual(plan.get('ses_a'), { icon: 'palette', tone: 'neutral', text: 'Home and 1 other design' });
  assert.deepEqual(plan.get('ses_b'), { icon: 'palette', tone: 'neutral', text: 'Pricing and 1 other design' });
});

test('planMarks: warning for check errors or comments not sent, never for warnings or null counts', () => {
  const designs = [
    summary('errs', { sessionId: 'ses_err', title: 'Errs', updated: iso(T0) }),
    summary('pins', { sessionId: 'ses_pin', title: 'Pins', openComments: 3, updated: iso(T0 - 1) }),
    summary('clean', { sessionId: 'ses_ok', title: 'Clean', updated: iso(T0 - 2) }),
    summary('unread', { sessionId: 'ses_null', title: 'Unread', updated: iso(T0 - 3) }),
  ];
  const counts = new Map<string, MarkCounts>([
    ['errs', { errors: 1 }],
    ['clean', { errors: 0 }],
    ['unread', null],
  ]);
  const plan = planMarks(designs, counts);
  assert.equal(plan.get('ses_err')?.tone, 'warning');
  assert.equal(plan.get('ses_err')?.text, 'Errs: 1 check error');
  assert.equal(plan.get('ses_pin')?.tone, 'warning');
  assert.equal(plan.get('ses_pin')?.text, 'Pins: 3 comments not sent');
  assert.equal(plan.get('ses_ok')?.tone, 'neutral');
  assert.equal(plan.get('ses_null')?.tone, 'neutral');
});

test('planMarks sums issues over a chat\'s designs', () => {
  const plan = planMarks(
    [
      summary('a', { sessionId: 's', title: 'Pricing', openComments: 2, updated: iso(T0) }),
      summary('b', { sessionId: 's', title: 'B', openComments: 1, updated: iso(T0 - 1) }),
      summary('c', { sessionId: 's', title: 'C', updated: iso(T0 - 2) }),
    ],
    new Map([['b', { errors: 1 }], ['c', { errors: 2 }]]),
  );
  assert.deepEqual(plan.get('s'), { icon: 'palette', tone: 'warning', text: 'Pricing and 2 other designs: 3 check errors, 3 comments not sent' });
});

test('planMarks keeps the `max` chats with the newest designs (the cap)', () => {
  const designs = Array.from({ length: SERVICE_MARKS_MAX + 5 }, (_, i) => summary(`d${i}`, { sessionId: `ses_${i}`, updated: iso(T0 - i * 1000) }));
  const plan = planMarks(designs, new Map());
  assert.equal(plan.size, SERVICE_MARKS_MAX);
  assert.ok(plan.has('ses_0'));
  assert.ok(!plan.has(`ses_${SERVICE_MARKS_MAX}`), 'the oldest chats are left out');
  assert.deepEqual([...planMarks(designs, new Map(), 2).keys()], ['ses_0', 'ses_1']);
});

// ---- markText ----

test('markText: one, several, the issue parts and their plurals', () => {
  assert.equal(markText(['Pricing'], { errors: 0, comments: 0 }), 'Pricing');
  assert.equal(markText(['Pricing', 'a', 'b'], { errors: 0, comments: 0 }), 'Pricing and 2 other designs');
  assert.equal(markText(['Pricing', 'a'], { errors: 0, comments: 0 }), 'Pricing and 1 other design');
  assert.equal(markText(['Pricing'], { errors: 1, comments: 3 }), 'Pricing: 1 check error, 3 comments not sent');
  assert.equal(markText(['Pricing'], { errors: 2, comments: 0 }), 'Pricing: 2 check errors');
  assert.equal(markText(['Pricing'], { errors: 0, comments: 1 }), 'Pricing: 1 comment not sent');
});

test('markText strips control characters and bidi overrides into one line', () => {
  assert.equal(markText(['Pri\ncing\u0007\u2028page \u202e evil \u200f\u061cx'], { errors: 0, comments: 0 }), 'Pri cing page evil x');
  assert.equal(markText(['\u0000\n '], { errors: 0, comments: 0 }), 'Untitled design');
});

test('markText fits SERVICE_MARK_TEXT_MAX by cutting the title and keeps the issues whole', () => {
  const text = markText(['T'.repeat(500), 'x'], { errors: 12, comments: 7 });
  assert.equal(text.length, SERVICE_MARK_TEXT_MAX);
  assert.ok(text.endsWith('… and 1 other design: 12 check errors, 7 comments not sent'), text);
});

test('markText never cuts inside a surrogate pair', () => {
  for (let pad = 0; pad < 4; pad += 1) {
    const text = markText(['a'.repeat(pad) + '😀'.repeat(150)], { errors: 0, comments: 0 });
    assert.ok(text.length <= SERVICE_MARK_TEXT_MAX);
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text), `lone surrogate with pad ${pad}`);
    assert.ok(text.endsWith('…'));
  }
});

// ---- nextChange ----

const mark = (text: string, tone: ServiceMark['tone'] = 'neutral'): ServiceMark => ({ icon: 'palette', tone, text });
const key = (m: ServiceMark): string => `${m.icon}\u0000${m.tone}\u0000${m.text}`;

test('nextChange: sets in priority order, replaces, then removes; nothing when they match', () => {
  const desired = new Map([['a', mark('A')], ['b', mark('B', 'warning')]]);
  assert.deepEqual(nextChange(desired, new Map()), { sessionId: 'a', mark: mark('A') });
  assert.deepEqual(nextChange(desired, new Map([['a', key(mark('A'))], ['b', key(mark('B'))]])), { sessionId: 'b', mark: mark('B', 'warning') });
  const applied = new Map([['a', key(mark('A'))], ['b', key(mark('B', 'warning'))], ['gone', key(mark('G'))]]);
  assert.deepEqual(nextChange(desired, applied), { sessionId: 'gone', mark: null });
  applied.delete('gone');
  assert.equal(nextChange(desired, applied), null, 'unchanged sends nothing');
});

test('nextChange at the host cap: a new chat waits for a removal, a replacement does not', () => {
  const desired = new Map([['new', mark('N')], ['kept', mark('K2')]]);
  const applied = new Map([['kept', key(mark('K'))], ['old', key(mark('O'))]]);
  assert.deepEqual(nextChange(desired, applied, 2), { sessionId: 'kept', mark: mark('K2') });
  applied.set('kept', key(mark('K2')));
  assert.deepEqual(nextChange(desired, applied, 2), { sessionId: 'old', mark: null });
  applied.delete('old');
  assert.deepEqual(nextChange(desired, applied, 2), { sessionId: 'new', mark: mark('N') });
});

// ---- rate window ----

test('the rate window allows MARKS_RATE_PER_MIN in any 60 s, then frees one as the oldest leaves', () => {
  let now = T0;
  const rate = createRateWindow(MARKS_RATE_PER_MIN, () => now);
  for (let i = 0; i < MARKS_RATE_PER_MIN; i += 1) {
    assert.equal(rate.take(), 0);
    now += 100;
  }
  const wait = rate.take();
  assert.equal(wait, 60_000 - MARKS_RATE_PER_MIN * 100, 'until the first send leaves the window');
  now += wait;
  assert.equal(rate.take(), 0);
  assert.ok(rate.take() > 0, 'the next one still waits');
});

// ---- the running module ----

type Pending = { at: number; seq: number; fn: () => void };

const fakeClock = () => {
  let now = T0;
  let seq = 0;
  const pending = new Set<Pending>();
  const timers: MarkTimers = {
    setTimeout: (fn, ms) => {
      const entry = { at: now + Math.max(0, ms), seq: (seq += 1), fn };
      pending.add(entry);
      return entry;
    },
    clearTimeout: (handle) => void pending.delete(handle as Pending),
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const advance = async (ms: number): Promise<void> => {
    const target = now + ms;
    await flush();
    for (;;) {
      const due = [...pending].filter((entry) => entry.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (due === undefined) break;
      pending.delete(due);
      now = due.at;
      due.fn();
      await flush();
    }
    now = target;
    await flush();
  };
  return { now: () => now, timers, advance, flush };
};

type Rig = ReturnType<typeof rig>;

const rig = (designs: DesignSummary[], options: { errors?: Map<string, number>; answer?: (n: number) => SetMarkResult; ready?: boolean } = {}) => {
  const clock = fakeClock();
  const state = { designs, working: new Set<string>(), errors: options.errors ?? new Map<string, number>(), hang: new Set<string>() };
  const sent: { sessionId: string; mark: ServiceMark | null; at: number }[] = [];
  const reads: string[] = [];
  const lines: { event: string; fields: unknown }[] = [];
  const log: Logger = {
    info: (event, fields) => void lines.push({ event, fields }),
    warn: (event, fields) => void lines.push({ event, fields }),
    error: (event, fields) => void lines.push({ event, fields }),
  };
  let listener: ((event: ChangeEvent) => void) | null = null;
  let calls = 0;
  const marks = createSessionMarks({
    index: { all: () => state.designs, ready: async () => options.ready ?? true },
    checks: {
      get: async (slug) => {
        reads.push(slug);
        if (state.hang.has(slug)) return new Promise<never>(() => {});
        return { counts: { errors: state.errors.get(slug) ?? 0 } };
      },
    },
    activity: {
      of: (sessionId): SessionActivity | null => (state.working.has(sessionId) ? { sessionId, state: 'working', at: clock.now(), directory: null } : null),
    },
    hostCalls: {
      setMark: async (target, mark) => {
        calls += 1;
        const answer = options.answer?.(calls) ?? 'saved';
        sent.push({ sessionId: target.sessionId, mark, at: clock.now() });
        return answer;
      },
    },
    hub: {
      subscribe: (fn) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
    },
    log,
    now: clock.now,
    timers: clock.timers,
  });
  let seq = 0;
  const emit = (event: Omit<ChangeEvent, 'seq'>): void => listener?.({ ...event, seq: (seq += 1) });
  return { clock, state, sent, reads, lines, marks, emit, calls: () => calls, subscribed: () => listener !== null };
};

const started = async (r: Rig): Promise<void> => {
  await r.marks.start();
  await r.clock.flush();
  await r.marks.idle();
};

test('start sets neutral marks first, then upgrades to warning as counts come in', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_a', title: 'Pricing' })], { errors: new Map([['pricing', 2]]) });
  await started(r);
  assert.deepEqual(
    r.sent.map((s) => [s.sessionId, s.mark?.tone, s.mark?.text]),
    [
      ['ses_a', 'neutral', 'Pricing'],
      ['ses_a', 'warning', 'Pricing: 2 check errors'],
    ],
  );
  await r.marks.dispose();
});

test('unchanged state sends nothing; events that cannot change a mark do not even reconcile', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_a', title: 'Pricing' })]);
  await started(r);
  assert.equal(r.sent.length, 1);
  const readsBefore = r.reads.length;
  r.emit({ slug: 'pricing', kind: 'thumb' });
  r.emit({ slug: 'pricing', kind: 'versions' });
  await r.clock.advance(MARKS_DEBOUNCE_MS * 5);
  assert.equal(r.reads.length, readsBefore, 'no reconcile for thumbnails or versions');
  r.emit({ slug: 'pricing', kind: 'files' });
  await r.clock.advance(MARK_SETTLE_MS * 3);
  assert.equal(r.reads.length, readsBefore + 1, 'a file change recounts once');
  assert.equal(r.sent.length, 1, 'the same mark is not sent again');
  await r.marks.dispose();
});

test('a comment added turns the mark to warning about 2 s later; sending it turns it back', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_a', title: 'Pricing' })]);
  await started(r);
  r.state.designs = [summary('pricing', { sessionId: 'ses_a', title: 'Pricing', openComments: 1 })];
  r.emit({ slug: 'pricing', kind: 'comments' });
  await r.clock.advance(MARKS_DEBOUNCE_MS - 1);
  assert.equal(r.sent.length, 1, 'coalesced: nothing before the debounce');
  await r.clock.advance(1);
  assert.equal(r.sent.at(-1)?.mark?.text, 'Pricing: 1 comment not sent');
  assert.equal(r.sent.at(-1)?.mark?.tone, 'warning');
  r.state.designs = [summary('pricing', { sessionId: 'ses_a', title: 'Pricing', openComments: 0 })];
  r.emit({ slug: 'pricing', kind: 'comments' });
  await r.clock.advance(MARKS_DEBOUNCE_MS);
  assert.equal(r.sent.at(-1)?.mark?.tone, 'neutral');
  await r.marks.dispose();
});

test('counts wait MARK_SETTLE_MS after the last save before they are read again', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_a', title: 'Pricing' })]);
  await started(r);
  const readsBefore = r.reads.length;
  r.state.errors.set('pricing', 1);
  r.emit({ slug: 'pricing', kind: 'files' });
  await r.clock.advance(MARKS_DEBOUNCE_MS);
  r.emit({ slug: 'pricing', kind: 'files' }); // the agent saves again at 2 s
  await r.clock.advance(MARK_SETTLE_MS - 1);
  assert.equal(r.reads.length, readsBefore, 'still settling: no read');
  assert.equal(r.sent.at(-1)?.mark?.tone, 'neutral');
  await r.clock.advance(MARKS_DEBOUNCE_MS + 1);
  assert.equal(r.reads.length, readsBefore + 1);
  assert.equal(r.sent.at(-1)?.mark?.tone, 'warning');
  await r.marks.dispose();
});

test('a working chat is not recounted until its turn ends', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_a', title: 'Pricing' })]);
  await started(r);
  const readsBefore = r.reads.length;
  r.state.working.add('ses_a');
  r.state.errors.set('pricing', 4);
  r.emit({ slug: 'pricing', kind: 'files' });
  await r.clock.advance(MARK_SETTLE_MS * 4);
  assert.equal(r.reads.length, readsBefore, 'no read mid-turn');
  r.state.working.delete('ses_a');
  r.emit({ slug: 'pricing', kind: 'activity' });
  await r.clock.advance(MARKS_DEBOUNCE_MS);
  assert.equal(r.reads.length, readsBefore + 1);
  assert.equal(r.sent.at(-1)?.mark?.text, 'Pricing: 4 check errors');
  await r.marks.dispose();
});

test('a check read that hangs keeps the last tone and never warns from the failure', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_a', title: 'Pricing' })]);
  r.state.hang.add('pricing');
  await r.marks.start();
  await r.clock.advance(MARK_CHECK_READ_MS);
  await r.marks.idle();
  assert.deepEqual(r.sent.map((s) => s.mark?.tone), ['neutral']);
  assert.ok(r.lines.some((line) => line.event === 'session-marks.counts-unread'));
  await r.marks.dispose();
});

test('a design deleted or moved removes the old chat\'s mark; a root change removes them all', async () => {
  const r = rig([
    summary('a', { sessionId: 'ses_a', title: 'A', updated: iso(T0) }),
    summary('b', { sessionId: 'ses_b', title: 'B', updated: iso(T0 - 1) }),
    summary('c', { sessionId: 'ses_c', title: 'C', updated: iso(T0 - 2) }),
  ]);
  await started(r);
  assert.equal(r.sent.length, 3);
  r.state.designs = r.state.designs.filter((d) => d.slug !== 'a');
  r.emit({ slug: 'a', kind: 'removed' });
  await r.clock.advance(MARKS_DEBOUNCE_MS);
  assert.deepEqual(r.sent.at(-1), { sessionId: 'ses_a', mark: null, at: r.clock.now() });
  r.state.designs = [];
  r.emit({ slug: null, kind: 'root' });
  await r.clock.advance(MARKS_DEBOUNCE_MS);
  assert.deepEqual(r.sent.slice(-2).map((s) => [s.sessionId, s.mark]), [['ses_b', null], ['ses_c', null]]);
  await r.marks.dispose();
});

test('the bucket sends 50 a minute, newest chats first', async () => {
  const designs = Array.from({ length: 120 }, (_, i) => summary(`d${i}`, { sessionId: `ses_${i}`, updated: iso(T0 - i * 1000) }));
  const r = rig(designs);
  await r.marks.start();
  await r.clock.flush();
  assert.equal(r.sent.length, MARKS_RATE_PER_MIN);
  assert.deepEqual(r.sent.slice(0, 3).map((s) => s.sessionId), ['ses_0', 'ses_1', 'ses_2']);
  await r.clock.advance(60_000);
  assert.ok(r.sent.length <= MARKS_RATE_PER_MIN * 2, `${r.sent.length} in two minutes`);
  for (const s of r.sent) {
    const inWindow = r.sent.filter((o) => o.at > s.at - 60_000 && o.at <= s.at).length;
    assert.ok(inWindow <= MARKS_RATE_PER_MIN, 'never more than 50 in any minute, under the host\'s 60');
  }
  await r.clock.advance(60_000 * 2);
  assert.equal(new Set(r.sent.map((s) => s.sessionId)).size, 120, 'all set within about three minutes');
  await r.marks.dispose();
});

test('limited pauses the bucket 60 s, then sends the state as it is then', async () => {
  const r = rig(
    [
      summary('a', { sessionId: 'ses_a', title: 'A', updated: iso(T0) }),
      summary('b', { sessionId: 'ses_b', title: 'B', updated: iso(T0 - 1) }),
    ],
    { answer: (n) => (n === 2 ? 'limited' : 'saved') },
  );
  await r.marks.start();
  await r.clock.flush();
  assert.equal(r.sent.length, 2);
  r.state.designs = [summary('a', { sessionId: 'ses_a', title: 'A', updated: iso(T0) }), summary('b', { sessionId: 'ses_b', title: 'B2', updated: iso(T0 - 1) })];
  r.emit({ slug: 'b', kind: 'design' });
  await r.clock.advance(MARKS_LIMITED_PAUSE_MS - 1);
  assert.equal(r.sent.length, 2, 'nothing while paused');
  await r.clock.advance(1);
  assert.equal(r.sent.at(-1)?.mark?.text, 'B2', 'the current state, not the stale one');
  assert.equal(r.lines.filter((l) => l.event === 'session-marks.limited').length, 1);
  await r.marks.dispose();
});

test('a refusal stops the loop until the next start, logged once', async () => {
  const r = rig([summary('a', { sessionId: 'ses_a' }), summary('b', { sessionId: 'ses_b' })], { answer: () => 'refused' });
  await started(r);
  assert.equal(r.calls(), 1);
  r.emit({ slug: 'a', kind: 'comments' });
  await r.clock.advance(60_000 * 5);
  assert.equal(r.calls(), 1);
  assert.equal(r.lines.filter((l) => l.event === 'session-marks.stopped').length, 1);
  await r.marks.dispose();
});

test('no host (unavailable): one call per trigger, no loop on its own', async () => {
  const r = rig([summary('a', { sessionId: 'ses_a' }), summary('b', { sessionId: 'ses_b' })], { answer: () => 'unavailable' });
  await started(r);
  assert.equal(r.calls(), 1);
  await r.clock.advance(60_000 * 10);
  assert.equal(r.calls(), 1, 'nothing retries by itself');
  r.emit({ slug: 'a', kind: 'files' });
  await r.clock.advance(MARKS_DEBOUNCE_MS);
  assert.equal(r.calls(), 2, 'the next event tries once more');
  await r.marks.dispose();
});

test('no title, slug or session id reaches a log line', async () => {
  const r = rig([summary('secret-slug', { sessionId: 'ses_secret', title: 'Secret title' })], { answer: (n) => (n === 1 ? 'limited' : 'refused') });
  r.state.hang.add('secret-slug');
  await r.marks.start();
  await r.clock.advance(MARKS_LIMITED_PAUSE_MS + MARK_CHECK_READ_MS);
  await r.marks.idle();
  assert.ok(r.lines.length >= 2, 'something was logged');
  const logged = JSON.stringify(r.lines);
  for (const secret of ['secret-slug', 'ses_secret', 'Secret title']) assert.ok(!logged.includes(secret), secret);
  await r.marks.dispose();
});

test('dispose unsubscribes, cancels timers and sends nothing more', async () => {
  const r = rig([summary('a', { sessionId: 'ses_a' })]);
  await started(r);
  r.emit({ slug: 'a', kind: 'comments' });
  await r.marks.dispose();
  assert.equal(r.subscribed(), false);
  const before = r.calls();
  await r.clock.advance(60_000);
  assert.equal(r.calls(), before);
});

test('a new root forgets the old counts: a design with the same slug is read again', async () => {
  const r = rig([summary('a', { sessionId: 'ses_a', title: 'A' })], { errors: new Map([['a', 3]]) });
  await started(r);
  assert.equal(r.sent.at(-1)?.mark?.tone, 'warning');
  r.state.errors.set('a', 0);
  r.state.designs = [summary('a', { sessionId: 'ses_a', title: 'A' })];
  r.emit({ slug: null, kind: 'root' });
  await r.clock.advance(MARKS_DEBOUNCE_MS);
  await r.marks.idle();
  assert.equal(r.sent.at(-1)?.mark?.tone, 'neutral', 'no stale warning from the old root');
  await r.marks.dispose();
});
