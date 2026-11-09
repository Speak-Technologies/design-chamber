// The live build strip's brain (docs: documentation/specs/phase-1-review-loop.md §2): a pure
// reducer over file events, linked-session activity, the design detail and the feed status,
// a pure `phaseOf` with the §2.3 precedence, and the watcher wiring against the fake host.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import type { GuestSessionRecord } from '@openchamber/sdk';

import type { DesignDetailResponse } from '../../src/shared/api.ts';
import type { ChangeEvent } from '../../src/shared/types.ts';
import {
  DONE_LINGER_MS,
  FEED_DOWN_MS,
  PENDING_STALL_MS,
  QUIET_MS,
  RECENT_MS,
  RESTORE_QUIET_MS,
  UNKNOWN_HOLD_MS,
  WRITING_WINDOW_MS,
  agentFiles,
  batchAgentFiles,
  inRestoreQuiet,
  initialTrack,
  nextDeadline,
  phaseOf,
  reduceBuild,
  watchBuildActivity,
  type BuildActivity,
  type BuildInput,
  type BuildTrack,
  type LinkedActivity,
} from '../../src/guest/build-activity.ts';
import type { ChangeBatch, ChangeFeed, FeedStatus } from '../../src/guest/changes.ts';
import { createFakeHost } from '../../src/guest/fake-services.ts';
import { createGuestHost } from '../../src/guest/host.ts';

const T0 = 1_000_000;
const SEC = 1000;

// ---- helpers: inputs and a reducer run ----

const sess = (at: number, activity: LinkedActivity, outcome: 'completed' | 'failed' | null = null): BuildInput => ({ kind: 'session', at, activity, outcome });
const files = (at: number, list: string[], created = false): BuildInput => ({ kind: 'files', at, files: list, created });
const detail = (at: number, over: Partial<Extract<BuildInput, { kind: 'detail' }>> = {}): BuildInput => ({
  kind: 'detail',
  at,
  pending: false,
  created: T0,
  screensWritten: 0,
  screensTotal: 0,
  isCanvas: false,
  ...over,
});
const feedIn = (at: number, state: FeedStatus['state']): BuildInput => ({ kind: 'feed', at, state });

const run = (...inputs: BuildInput[]): BuildTrack => inputs.reduce<BuildTrack>((track, input) => reduceBuild(track, input), initialTrack(T0));
const phase = (track: BuildTrack, at: number) => phaseOf(track, at);

// ---- the timings the spec fixes (§2.3); the tests below are written against the constants ----

test('the timings are the specified ones', () => {
  assert.deepEqual(
    { WRITING_WINDOW_MS, QUIET_MS, DONE_LINGER_MS, PENDING_STALL_MS, FEED_DOWN_MS, RECENT_MS, RESTORE_QUIET_MS, UNKNOWN_HOLD_MS },
    { WRITING_WINDOW_MS: 15_000, QUIET_MS: 120_000, DONE_LINGER_MS: 8_000, PENDING_STALL_MS: 180_000, FEED_DOWN_MS: 5_000, RECENT_MS: 6_000, RESTORE_QUIET_MS: 3_000, UNKNOWN_HOLD_MS: 30_000 },
  );
});

// ---- agentFiles ----

test('agentFiles drops the service folders and design.json, keeps agent output', () => {
  assert.deepEqual(agentFiles(['.versions/v3/index.html', '.chamber/RULES.md', '.trash/x/index.html', 'design.json', 'assets/a.png', 'screens/home.html', 'tokens.css']), ['assets/a.png', 'screens/home.html', 'tokens.css']);
  assert.deepEqual(agentFiles(['design.json.ec0f4e9c44da.tmp', 'index.html', 'index.html.2bba59ef828e.tmp', 'scratch.tmp', 'assets/a.png.tmp', 'template.html']), ['index.html', 'template.html'], 'temp files, whatever their hex');
  assert.deepEqual(agentFiles(['screens/home.html', 'screens/home.html']), ['screens/home.html'], 'distinct');
  assert.deepEqual(agentFiles([]), []);
});

test('batchAgentFiles: this slug only; a files event without a list is ignored; added counts as started', () => {
  const events: ChangeEvent[] = [
    { seq: 1, slug: 'a', kind: 'files', files: ['screens/x.html', 'design.json'] },
    { seq: 2, slug: 'b', kind: 'files', files: ['screens/other.html'] },
    { seq: 3, slug: 'a', kind: 'files' },
    { seq: 4, slug: 'a', kind: 'versions' },
  ];
  assert.deepEqual(batchAgentFiles(events.filter((event) => event.seq !== 3), 'a'), { files: ['screens/x.html'], created: false, restored: false });
  assert.deepEqual(batchAgentFiles([{ seq: 5, slug: 'a', kind: 'added' }], 'a'), { files: [], created: true, restored: false });
  assert.deepEqual(batchAgentFiles([{ seq: 6, slug: 'a', kind: 'files' }], 'a'), { files: [], created: false, restored: true });
  assert.deepEqual(batchAgentFiles([{ seq: 7, slug: null, kind: 'root' }], 'a'), { files: [], created: false, restored: false });
  assert.deepEqual(batchAgentFiles([{ seq: 8, slug: 'b', kind: 'files' }], 'a'), { files: [], created: false, restored: false }, 'another design\'s restore is not ours');
  assert.deepEqual(
    batchAgentFiles(events, 'a'),
    { files: [], created: false, restored: true },
    'a batch holding the restore event drops its own file lists: they are the restore\'s writes',
  );
});

// ---- phases, one per row of the table ----

test('a fresh track shows nothing', () => {
  assert.equal(phase(initialTrack(T0), T0), 'hidden');
});

test('question and permission follow the session activity', () => {
  assert.equal(phase(run(sess(T0, 'waiting-question')), T0 + SEC), 'question');
  assert.equal(phase(run(sess(T0, 'waiting-permission')), T0 + SEC), 'permission');
});

test('working and retrying follow the session activity', () => {
  assert.equal(phase(run(sess(T0, 'running')), T0 + SEC), 'working');
  assert.equal(phase(run(sess(T0, 'retrying')), T0 + SEC), 'retrying');
});

test('writing: a file within the window, then back to working', () => {
  const track = run(sess(T0, 'running'), files(T0 + 2 * SEC, ['screens/pricing.html']));
  assert.equal(phase(track, T0 + 2 * SEC), 'writing');
  assert.equal(phase(track, T0 + 2 * SEC + WRITING_WINDOW_MS - 1), 'writing');
  assert.equal(phase(track, T0 + 2 * SEC + WRITING_WINDOW_MS), 'working');
});

test('writing works without a session (files-only) and then hides', () => {
  const track = run(sess(T0, 'none'), files(T0, ['index.html']));
  assert.equal(phase(track, T0 + 1), 'writing');
  assert.equal(phase(track, T0 + WRITING_WINDOW_MS), 'hidden');
});

test('an added event is "started writing" with no file name', () => {
  const track = run(files(T0, [], true));
  assert.equal(phase(track, T0 + 1), 'writing');
  assert.equal(track.lastFile?.path, null);
});

test('done: lingers exactly DONE_LINGER_MS after the turn ends, then hides', () => {
  const track = run(sess(T0, 'running'), files(T0 + SEC, ['index.html']), sess(T0 + 10 * SEC, 'idle', 'completed'));
  assert.equal(phase(track, T0 + 10 * SEC), 'done');
  assert.equal(phase(track, T0 + 10 * SEC + DONE_LINGER_MS - 1), 'done');
  assert.equal(phase(track, T0 + 10 * SEC + DONE_LINGER_MS), 'hidden');
});

test('done is not hidden behind writing when the last file landed just before the turn ended', () => {
  // The common case: the final write, then the turn ends a moment later.
  const track = run(sess(T0, 'running'), files(T0 + 9 * SEC, ['index.html']), sess(T0 + 10 * SEC, 'idle', 'completed'));
  assert.equal(phase(track, T0 + 11 * SEC), 'done');
  assert.equal(phase(track, T0 + 10 * SEC + DONE_LINGER_MS), 'hidden', 'and not "writing" again afterwards');
});

test('a file that lands a moment after the turn ended still counts in the Done count', () => {
  const track = run(sess(T0, 'running'), sess(T0 + 5 * SEC, 'idle', 'completed'), files(T0 + 6 * SEC, ['index.html']));
  assert.equal(phase(track, T0 + 7 * SEC), 'done');
  assert.deepEqual(track.turnFiles, ['index.html']);
});

test('failed: sticks while idle until dismissed', () => {
  const track = run(sess(T0, 'running'), sess(T0 + 5 * SEC, 'idle', 'failed'));
  assert.equal(phase(track, T0 + 6 * SEC), 'failed');
  assert.equal(phase(track, T0 + 60 * 60 * SEC), 'failed', 'an hour later');
  const dismissed = reduceBuild(track, { kind: 'dismiss', at: T0 + 7 * SEC });
  assert.equal(phase(dismissed, T0 + 8 * SEC), 'hidden');
});

test('a dismissed failure comes back as a new turn: the next turn clears the dismissal', () => {
  const failed = run(sess(T0, 'running'), sess(T0 + SEC, 'idle', 'failed'), { kind: 'dismiss', at: T0 + 2 * SEC });
  const again = reduceBuild(failed, sess(T0 + 3 * SEC, 'running'));
  assert.equal(phase(again, T0 + 4 * SEC), 'working');
  const failedAgain = reduceBuild(again, sess(T0 + 5 * SEC, 'idle', 'failed'));
  assert.equal(phase(failedAgain, T0 + 6 * SEC), 'failed');
});

test('a new agent file also clears a dismissal', () => {
  const failed = run(sess(T0, 'running'), sess(T0 + SEC, 'idle', 'failed'), { kind: 'dismiss', at: T0 + 2 * SEC });
  assert.equal(phase(failed, T0 + 3 * SEC), 'hidden');
  const written = reduceBuild(failed, files(T0 + 4 * SEC, ['index.html']));
  assert.equal(written.dismissedAt, null);
});

test('stalled: pending and idle for exactly PENDING_STALL_MS since created', () => {
  const track = run(detail(T0, { pending: true, created: T0 }));
  assert.equal(phase(track, T0 + PENDING_STALL_MS - 1), 'hidden');
  assert.equal(phase(track, T0 + PENDING_STALL_MS), 'stalled');
});

test('stalled: not while the agent is working, not once something is written, dismissible', () => {
  const pending = run(detail(T0, { pending: true, created: T0 }), sess(T0 + SEC, 'running'));
  assert.equal(phase(pending, T0 + PENDING_STALL_MS + SEC), 'working');
  const written = run(detail(T0, { pending: false, created: T0 }));
  assert.equal(phase(written, T0 + PENDING_STALL_MS + SEC), 'hidden');
  const dismissed = reduceBuild(run(detail(T0, { pending: true, created: T0 })), { kind: 'dismiss', at: T0 + PENDING_STALL_MS });
  assert.equal(phase(dismissed, T0 + PENDING_STALL_MS + 1), 'hidden');
});

test('stalled works in files-only mode (a /design chip that was never sent)', () => {
  const track = run(sess(T0, 'none'), detail(T0, { pending: true, created: T0 }));
  assert.equal(phase(track, T0 + PENDING_STALL_MS), 'stalled');
});

// ---- precedence ----

test('offline outranks every other phase', () => {
  const track = run(sess(T0, 'waiting-question'), feedIn(T0 + SEC, 'retrying'));
  assert.equal(phase(track, T0 + SEC + FEED_DOWN_MS), 'offline');
});

test('question outranks permission outranks failed, writing, retrying, working', () => {
  const asking = run(sess(T0, 'running'), files(T0, ['index.html']), sess(T0 + SEC, 'waiting-question'));
  assert.equal(phase(asking, T0 + 2 * SEC), 'question');
  assert.equal(phase(reduceBuild(asking, sess(T0 + 2 * SEC, 'waiting-permission')), T0 + 3 * SEC), 'permission');
});

test('writing outranks retrying and working', () => {
  assert.equal(phase(run(sess(T0, 'retrying'), files(T0, ['index.html'])), T0 + SEC), 'writing');
  assert.equal(phase(run(sess(T0, 'running'), files(T0, ['index.html'])), T0 + SEC), 'writing');
});

// ---- no claims from silence ----

test('no done or failed for a turn this frame never saw start (mounting on an idle chat)', () => {
  assert.equal(phase(run(sess(T0, 'idle', 'failed')), T0 + SEC), 'hidden');
  assert.equal(phase(run(sess(T0, 'idle', 'completed')), T0 + SEC), 'hidden');
});

test('no done or failed in files-only mode', () => {
  for (const activity of ['none', 'gone'] as const) {
    const track = run(sess(T0, activity), files(T0, ['index.html']));
    assert.equal(phase(track, T0 + WRITING_WINDOW_MS + SEC), 'hidden', activity);
    assert.equal(track.turnSeen, false);
  }
});

test('the session going away mid-turn ends the turn without a Done', () => {
  const track = run(sess(T0, 'running'), sess(T0 + SEC, 'gone'));
  assert.equal(track.turnSeen, false);
  assert.equal(phase(track, T0 + 2 * SEC), 'hidden');
});

test('a turn seen from the first snapshot (mounted mid-turn) can still finish with Done', () => {
  const track = run(sess(T0, 'running'), sess(T0 + 4 * SEC, 'idle', 'completed'));
  assert.equal(phase(track, T0 + 5 * SEC), 'done');
});

test('unknown activity holds the last known state, then shows nothing once it lasts too long', () => {
  const track = run(sess(T0, 'running'), sess(T0 + SEC, 'unknown'));
  assert.equal(track.activity, 'running');
  assert.equal(phase(track, T0 + 2 * SEC), 'working', 'a blip changes nothing');
  assert.equal(phase(track, T0 + SEC + UNKNOWN_HOLD_MS - 1), 'working');
  assert.equal(phase(track, T0 + SEC + UNKNOWN_HOLD_MS), 'hidden', 'no claims once it is unknown for good');
  assert.equal(nextDeadline(track, T0 + 2 * SEC), T0 + SEC + UNKNOWN_HOLD_MS, 'the hold has an end the timer wakes for');
  assert.equal(reduceBuild(track, sess(T0 + 5 * SEC, 'unknown')), track, 'a second unknown does not restart the hold');
});

test('unknown with no known state before it changes nothing visible', () => {
  assert.equal(phase(run(sess(T0, 'unknown')), T0 + SEC), 'hidden');
  assert.equal(phase(run(sess(T0, 'unknown'), sess(T0 + SEC, 'running')), T0 + 2 * SEC), 'working');
});

test('a Done that lingers is not disturbed by an unknown blip', () => {
  const track = run(sess(T0, 'running'), sess(T0 + SEC, 'idle', 'completed'), sess(T0 + 2 * SEC, 'unknown'), sess(T0 + 3 * SEC, 'idle', 'completed'));
  assert.equal(track.idleAt, T0 + SEC);
  assert.equal(phase(track, T0 + 4 * SEC), 'done');
});

// ---- a user's restore is not the agent ----

test('a restore: its file echo inside the quiet window is ignored; after it, the agent counts again', () => {
  const track = run(sess(T0, 'idle'), { kind: 'restore', at: T0 + 10 * SEC }, files(T0 + 10 * SEC + 300, ['index.html']));
  assert.equal(track.lastFile, null);
  assert.equal(phase(track, T0 + 11 * SEC), 'hidden');
  assert.equal(inRestoreQuiet(track, T0 + 10 * SEC + RESTORE_QUIET_MS - 1), true);
  assert.equal(inRestoreQuiet(track, T0 + 10 * SEC + RESTORE_QUIET_MS), false);
  const later = reduceBuild(track, files(T0 + 10 * SEC + RESTORE_QUIET_MS, ['index.html']));
  assert.equal(phase(later, T0 + 14 * SEC), 'writing');
});

test('a restore also takes back a "last file" that landed just before its own event (the echo can come first)', () => {
  const track = run(files(T0 + 10 * SEC, ['index.html']), { kind: 'restore', at: T0 + 10 * SEC + 400 });
  assert.equal(track.lastFile, null);
  const old = run(files(T0, ['index.html']), { kind: 'restore', at: T0 + 60 * SEC });
  assert.equal(old.lastFile?.path, 'index.html', 'an agent write from a minute ago stays');
});

test('an agent turn is not touched by a restore that happens to a different moment', () => {
  const track = run(sess(T0, 'running'), files(T0 + SEC, ['screens/a.html']), { kind: 'restore', at: T0 + 40 * SEC });
  assert.equal(track.activity, 'running');
  assert.deepEqual(track.turnFiles, ['screens/a.html']);
});

// ---- watcher wiring: restore ----

test('wiring: a restore\'s event and the watcher\'s echo of it (temp names included) never show as the agent writing', async (t) => {
  const r = rig(t);
  await flush();
  r.clock.t = T0 + 10 * SEC;
  r.feed.emit({ events: [{ seq: 1, slug: 'coffee', kind: 'files' }, { seq: 2, slug: 'coffee', kind: 'versions' }] });
  r.clock.t = T0 + 10 * SEC + 400;
  r.feed.emit({ events: [{ seq: 3, slug: 'coffee', kind: 'files', files: ['design.json.ec0f4e9c44da.tmp', 'index.html', 'index.html.2bba59ef828e.tmp'] }] });
  assert.equal(r.watcher.get().lastFile, null);
  assert.equal(phaseOf(r.watcher.get(), T0 + 11 * SEC), 'hidden');
  // The echo can also come in the same batch, or before the event.
  const b = rig(t);
  await flush();
  b.clock.t = T0 + 10 * SEC;
  b.feed.emit({ events: [{ seq: 1, slug: 'coffee', kind: 'files', files: ['index.html'] }, { seq: 2, slug: 'coffee', kind: 'files' }] });
  assert.equal(b.watcher.get().lastFile, null);
});

// ---- turns ----

test('a turn start resets the turn files and last file; waiting inside a turn does not', () => {
  const first = run(sess(T0, 'running'), files(T0 + SEC, ['a.html', 'b.html']));
  assert.deepEqual(first.turnFiles, ['a.html', 'b.html']);
  const asked = reduceBuild(first, sess(T0 + 2 * SEC, 'waiting-question'));
  const resumed = reduceBuild(asked, sess(T0 + 3 * SEC, 'running'));
  assert.deepEqual(resumed.turnFiles, ['a.html', 'b.html'], 'same turn');
  assert.equal(resumed.turnStartedAt, T0);
  const ended = reduceBuild(resumed, sess(T0 + 4 * SEC, 'idle', 'completed'));
  const next = reduceBuild(ended, sess(T0 + 20 * SEC, 'running'));
  assert.deepEqual(next.turnFiles, []);
  assert.equal(next.lastFile, null);
  assert.equal(next.turnStartedAt, T0 + 20 * SEC);
  assert.equal(next.idleAt, null);
});

test('turn files are distinct and capped at 50', () => {
  const many = Array.from({ length: 70 }, (_, index) => `assets/${index}.png`);
  const track = run(sess(T0, 'running'), files(T0 + 1, many), files(T0 + 2, ['assets/0.png', 'assets/1.png']));
  assert.equal(track.turnFiles.length, 50);
  assert.equal(new Set(track.turnFiles).size, 50);
});

test('a repeated session snapshot changes nothing and returns the same track', () => {
  const track = run(sess(T0, 'running'));
  assert.equal(reduceBuild(track, sess(T0 + 5 * SEC, 'running')), track);
  const idle = run(sess(T0, 'running'), sess(T0 + SEC, 'idle', 'completed'));
  assert.equal(reduceBuild(idle, sess(T0 + 9 * SEC, 'idle', 'completed')), idle, 'idleAt is not pushed forward by other chats updating');
});

test('an unchanged detail returns the same track; a list-less files input is ignored', () => {
  const track = run(detail(T0, { pending: true, created: T0 }));
  assert.equal(reduceBuild(track, detail(T0 + SEC, { pending: true, created: T0 })), track);
  assert.equal(reduceBuild(track, files(T0 + SEC, [])), track);
});

test('a files input means something was written: pending is cleared, the last file is the batch\'s', () => {
  const track = run(detail(T0, { pending: true, created: T0 }), files(T0 + SEC, ['screens/a.html', 'screens/b.html']));
  assert.equal(track.pending, false);
  assert.equal(track.lastFile?.at, T0 + SEC);
  const reversed = run(detail(T0, { pending: true, created: T0 }), files(T0 + SEC, ['screens/b.html', 'screens/a.html']));
  assert.equal(reversed.lastFile?.path, track.lastFile?.path, 'order within a batch does not matter');
});

test('a feed reset keeps the track but forgets the last file, so no stale "Writing"', () => {
  const track = run(sess(T0, 'running'), files(T0, ['index.html']), { kind: 'reset', at: T0 + SEC });
  assert.equal(track.lastFile, null);
  assert.deepEqual(track.turnFiles, ['index.html']);
  assert.equal(phase(track, T0 + 2 * SEC), 'working');
});

// ---- offline ----

test('offline: only after FEED_DOWN_MS, and only if the strip was showing', () => {
  const showing = run(sess(T0, 'running'), feedIn(T0 + SEC, 'retrying'));
  assert.equal(phase(showing, T0 + SEC + FEED_DOWN_MS - 1), 'working');
  assert.equal(phase(showing, T0 + SEC + FEED_DOWN_MS), 'offline');
  const hidden = run(feedIn(T0 + SEC, 'retrying'));
  assert.equal(phase(hidden, T0 + SEC + FEED_DOWN_MS * 10), 'hidden');
});

test('offline stays while the strip phase behind it times out, and clears when the feed is live again', () => {
  const track = run(files(T0, ['index.html']), feedIn(T0 + SEC, 'retrying'));
  assert.equal(phase(track, T0 + WRITING_WINDOW_MS + 60 * SEC), 'offline', 'was showing when the feed went down');
  const back = reduceBuild(track, feedIn(T0 + 30 * SEC, 'live'));
  assert.equal(back.feedDownSince, null);
  assert.equal(phase(back, T0 + 30 * SEC), 'hidden');
});

test('the feed pausing (hidden frame) is not an outage; repeated retrying keeps the first time', () => {
  const retrying = run(sess(T0, 'running'), feedIn(T0, 'retrying'));
  assert.equal(reduceBuild(retrying, feedIn(T0 + 3 * SEC, 'retrying')), retrying);
  const paused = reduceBuild(retrying, feedIn(T0 + 3 * SEC, 'paused'));
  assert.equal(paused.feedDownSince, null);
});

// ---- nextDeadline ----

test('nextDeadline: nothing to wait for when hidden', () => {
  assert.equal(nextDeadline(initialTrack(T0), T0), null);
});

test('nextDeadline: the writing window', () => {
  const track = run(files(T0, ['index.html']));
  assert.equal(nextDeadline(track, T0 + 1), T0 + WRITING_WINDOW_MS);
  assert.equal(nextDeadline(track, T0 + WRITING_WINDOW_MS), null);
});

test('nextDeadline: the done linger', () => {
  const track = run(sess(T0, 'running'), sess(T0 + SEC, 'idle', 'completed'));
  assert.equal(nextDeadline(track, T0 + 2 * SEC), T0 + SEC + DONE_LINGER_MS);
});

test('nextDeadline: the stall time for a pending design, not once dismissed or working', () => {
  const track = run(detail(T0, { pending: true, created: T0 }));
  assert.equal(nextDeadline(track, T0 + SEC), T0 + PENDING_STALL_MS);
  assert.equal(nextDeadline(reduceBuild(track, { kind: 'dismiss', at: T0 + SEC }), T0 + 2 * SEC), null);
  assert.equal(nextDeadline(reduceBuild(track, sess(T0 + SEC, 'running')), T0 + 2 * SEC), T0 + SEC + QUIET_MS, 'working has only the quiet notice ahead');
  assert.equal(nextDeadline(reduceBuild(track, sess(T0 + SEC, 'waiting-question')), T0 + 2 * SEC), null, 'the agent is asking: no stall to wait for');
});

test('nextDeadline: the offline time, only when the strip was showing', () => {
  const showing = run(sess(T0, 'running'), feedIn(T0 + SEC, 'retrying'));
  assert.equal(nextDeadline(showing, T0 + 2 * SEC), T0 + SEC + FEED_DOWN_MS);
  const hidden = run(feedIn(T0 + SEC, 'retrying'));
  assert.equal(nextDeadline(hidden, T0 + 2 * SEC), null);
});

test('nextDeadline: the quiet notice while working, measured from the last file or the turn start', () => {
  const track = run(sess(T0, 'running'));
  assert.equal(nextDeadline(track, T0 + SEC), T0 + QUIET_MS);
  const wrote = reduceBuild(track, files(T0 + 30 * SEC, ['index.html']));
  assert.equal(nextDeadline(wrote, T0 + 31 * SEC), T0 + 30 * SEC + WRITING_WINDOW_MS, 'the writing window comes first');
  assert.equal(nextDeadline(wrote, T0 + 30 * SEC + WRITING_WINDOW_MS), T0 + 30 * SEC + QUIET_MS);
});

test('nextDeadline: the earliest of several', () => {
  const track = run(sess(T0, 'running'), files(T0, ['index.html']), feedIn(T0 + SEC, 'retrying'));
  assert.equal(nextDeadline(track, T0 + 2 * SEC), T0 + SEC + FEED_DOWN_MS);
});

// ---- watcher wiring ----

type FakeFeed = ChangeFeed & { emit(batch: Partial<ChangeBatch> & { events?: ChangeEvent[] }): void; setState(state: FeedStatus['state']): void };

const fakeFeed = (): FakeFeed => {
  const listeners = new Set<(batch: ChangeBatch) => void>();
  const statusListeners = new Set<(status: FeedStatus) => void>();
  let status: FeedStatus = { state: 'live', error: null, retryInMs: null };
  return {
    start: () => undefined,
    stop: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    status: () => status,
    emit: (batch) => {
      for (const listener of [...listeners]) listener({ reset: false, events: [], epoch: 'e', seq: 1, ...batch });
    },
    setState: (state) => {
      status = { state, error: null, retryInMs: null };
      for (const listener of [...statusListeners]) listener(status);
    },
  };
};

const SHOP = 'C:\\Users\\you\\projects\\shop';

const detailOf = (over: { sessionId?: string | null; projectDirectory?: string | null; pending?: boolean; screens?: string[]; created?: string } = {}): DesignDetailResponse => ({
  slug: 'coffee',
  path: 'C:\\Designs\\coffee',
  design: {
    version: 1,
    kind: 'canvas',
    title: 'Coffee',
    created: over.created ?? new Date(T0).toISOString(),
    updated: new Date(T0).toISOString(),
    brief: '',
    sessionId: over.sessionId === undefined ? 'ses_a' : over.sessionId,
    projectDirectory: over.projectDirectory === undefined ? SHOP : over.projectDirectory,
    preset: null,
    entry: null,
    viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
    screens: (over.screens ?? ['home', 'pricing']).map((id) => ({ id, title: id, file: `screens/${id}.html` })),
    designSystem: { confirmed: false },
    comments: [],
  },
  pending: over.pending ?? false,
  files: { screens: Object.fromEntries((over.screens ?? ['home', 'pricing']).map((id, index) => [id, { exists: index === 0, size: 100, mtime: null }])) },
  warnings: [],
});

const record = (id: string, activity: GuestSessionRecord['activity'], outcome: GuestSessionRecord['outcome'] = null): GuestSessionRecord => ({
  id,
  title: id,
  projectId: 'proj_shop',
  directory: SHOP,
  parentId: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  worktree: null,
  activity,
  outcome,
  items: [],
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

type Rig = {
  host: ReturnType<typeof createFakeHost>;
  feed: FakeFeed;
  watcher: BuildActivity;
  clock: { t: number };
  setDetail(next: DesignDetailResponse): void;
  subscribed: string[];
  unsubscribed: string[];
};

const rig = (t: TestContext, options: { detail?: DesignDetailResponse | null; directory?: string | null; projects?: boolean } = {}): Rig => {
  const host = createFakeHost({ directory: options.directory === undefined ? SHOP : options.directory });
  if (options.projects === false) host.projects = [];
  host.emitReady();
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  const original = host.onSessions;
  host.onSessions = async (projectId, listener) => {
    subscribed.push(projectId);
    const stop = await original(projectId, listener);
    return () => {
      unsubscribed.push(projectId);
      stop();
    };
  };
  const feed = fakeFeed();
  const clock = { t: T0 };
  let current: DesignDetailResponse | null = options.detail === undefined ? detailOf() : options.detail;
  const detailListeners = new Set<() => void>();
  const watcher = watchBuildActivity({
    host: createGuestHost(host),
    feed,
    slug: 'coffee',
    detail: () => current,
    onDetail: (listener) => {
      detailListeners.add(listener);
      return () => detailListeners.delete(listener);
    },
    now: () => clock.t,
  });
  t.after(() => watcher.dispose());
  return {
    host,
    feed,
    watcher,
    clock,
    setDetail: (next) => {
      current = next;
      for (const listener of [...detailListeners]) listener();
    },
    subscribed,
    unsubscribed,
  };
};

test('wiring: the linked session in the design\'s project drives activity and the turn', async (t) => {
  const r = rig(t);
  await flush();
  r.host.emitSessions('proj_shop', [record('ses_a', 'idle'), record('ses_other', 'running')]);
  assert.equal(r.watcher.get().activity, 'idle');
  r.clock.t = T0 + SEC;
  r.host.emitSessions('proj_shop', [record('ses_a', 'running'), record('ses_other', 'running')]);
  assert.equal(r.watcher.get().activity, 'running');
  assert.equal(r.watcher.get().turnSeen, true);
  r.clock.t = T0 + 9 * SEC;
  r.host.emitSessions('proj_shop', [record('ses_a', 'idle', 'completed')]);
  assert.equal(phaseOf(r.watcher.get(), T0 + 10 * SEC), 'done');
});

test('wiring: a ready snapshot without the linked session is "gone"; loading is ignored; error is "none"', async (t) => {
  const r = rig(t);
  await flush();
  r.host.emitSessions('proj_shop', [record('ses_a', 'running')]);
  assert.equal(r.watcher.get().activity, 'running');
  r.host.emitSessions('proj_shop', [], 'loading');
  assert.equal(r.watcher.get().activity, 'running', 'a loading snapshot says nothing');
  r.host.emitSessions('proj_shop', [record('ses_other', 'idle')]);
  assert.equal(r.watcher.get().activity, 'gone');
  r.host.emitSessions('proj_shop', [], 'error');
  assert.equal(r.watcher.get().activity, 'none');
});

test('wiring: no linked session means files-only', async (t) => {
  const r = rig(t, { detail: detailOf({ sessionId: null }) });
  await flush();
  assert.equal(r.watcher.get().activity, 'none');
  assert.deepEqual(r.subscribed, []);
});

test('wiring: no project for the design and none for the frame is "none", and the busy chat stands in when it is the selected one', async (t) => {
  const r = rig(t, { detail: detailOf({ projectDirectory: 'Z:\\nowhere' }), directory: null, projects: false });
  await flush();
  assert.equal(r.watcher.get().activity, 'none');
  r.host.setSession({ id: 'ses_a', title: 'Chat', busy: true });
  await flush();
  assert.equal(r.watcher.get().activity, 'running', 'the selected linked chat is busy');
  r.host.setSession({ id: 'ses_a', title: 'Chat', busy: false });
  assert.equal(r.watcher.get().activity, 'idle');
  r.host.setSession({ id: 'ses_elsewhere', title: 'Other', busy: true });
  assert.equal(r.watcher.get().activity, 'none', 'another chat is selected: nothing known');
});

test('wiring: onSessions rejecting falls back to none and warns once', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const host = createFakeHost({ directory: SHOP });
  host.emitReady();
  host.onSessions = async () => {
    throw new Error('no grant');
  };
  const feed = fakeFeed();
  const watcher = watchBuildActivity({ host: createGuestHost(host), feed, slug: 'coffee', detail: () => detailOf(), onDetail: () => () => undefined, now: () => T0 });
  t.after(() => watcher.dispose());
  await flush();
  assert.equal(watcher.get().activity, 'none');
  assert.equal(warn.mock.callCount(), 1);
});

test('wiring: the design\'s project is found by directory (Windows case-insensitive), falling back to the frame directory', async (t) => {
  const r = rig(t, { detail: detailOf({ projectDirectory: SHOP.toLowerCase() }) });
  await flush();
  assert.deepEqual(r.subscribed, ['proj_shop']);
  const b = rig(t, { detail: detailOf({ projectDirectory: null }) });
  await flush();
  assert.deepEqual(b.subscribed, ['proj_shop'], 'no projectDirectory: the frame directory');
});

test('wiring: a changed sessionId re-subscribes and reads the new session; an unchanged detail does not', async (t) => {
  const r = rig(t);
  await flush();
  r.host.emitSessions('proj_shop', [record('ses_a', 'running'), record('ses_b', 'waiting-question')]);
  assert.equal(r.watcher.get().activity, 'running');
  r.setDetail(detailOf());
  await flush();
  assert.equal(r.subscribed.length, 1, 'same link: same subscription');
  r.setDetail(detailOf({ sessionId: 'ses_b' }));
  await flush();
  assert.equal(r.subscribed.length, 2);
  assert.deepEqual(r.unsubscribed, ['proj_shop'], 'the old subscription was released');
  assert.equal(r.watcher.get().activity, 'waiting-question');
});

test('wiring: a changed projectDirectory re-subscribes to the other project', async (t) => {
  const r = rig(t);
  r.host.projects = [
    { id: 'proj_shop', name: 'shop', directory: SHOP },
    { id: 'proj_blog', name: 'blog', directory: 'C:\\Users\\you\\projects\\blog' },
  ];
  await flush();
  r.setDetail(detailOf({ projectDirectory: 'C:\\Users\\you\\projects\\blog' }));
  await flush();
  assert.deepEqual(r.subscribed, ['proj_shop', 'proj_blog']);
});

test('wiring: dispose releases the subscription, the timer and the listeners', async (t) => {
  const r = rig(t);
  await flush();
  r.host.emitSessions('proj_shop', [record('ses_a', 'running')]);
  let heard = 0;
  r.watcher.subscribe(() => (heard += 1));
  r.watcher.dispose();
  assert.deepEqual(r.unsubscribed, ['proj_shop']);
  r.host.emitSessions('proj_shop', [record('ses_a', 'idle', 'completed')]);
  r.feed.emit({ events: [{ seq: 1, slug: 'coffee', kind: 'files', files: ['screens/home.html'] }] });
  assert.equal(heard, 0);
  assert.equal(r.watcher.get().activity, 'running');
});

test('wiring: dispose while the project lookup is still pending never subscribes', async (t) => {
  const r = rig(t);
  r.watcher.dispose();
  await flush();
  assert.deepEqual(r.subscribed, []);
});

test('wiring: files for this slug move the track; other slugs, versions and list-less events do not', async (t) => {
  const r = rig(t);
  await flush();
  r.clock.t = T0 + 5 * SEC;
  r.feed.emit({ events: [{ seq: 1, slug: 'other', kind: 'files', files: ['screens/x.html'] }] });
  r.feed.emit({ events: [{ seq: 2, slug: 'coffee', kind: 'files' }] });
  r.feed.emit({ events: [{ seq: 3, slug: 'coffee', kind: 'files', files: ['.versions/v2/index.html', 'design.json'] }] });
  assert.equal(r.watcher.get().lastFile, null);
  // The list-less event is a user's restore; the agent counts again once its echo is over.
  r.clock.t = T0 + 5 * SEC + RESTORE_QUIET_MS;
  r.feed.emit({ events: [{ seq: 4, slug: 'coffee', kind: 'files', files: ['screens/pricing.html'] }] });
  assert.deepEqual(r.watcher.get().lastFile, { path: 'screens/pricing.html', at: T0 + 5 * SEC + RESTORE_QUIET_MS });
  assert.equal(phaseOf(r.watcher.get(), T0 + 6 * SEC + RESTORE_QUIET_MS), 'writing');
});

test('wiring: a feed reset clears the last file', async (t) => {
  const r = rig(t);
  await flush();
  r.feed.emit({ events: [{ seq: 1, slug: 'coffee', kind: 'files', files: ['screens/pricing.html'] }] });
  r.feed.emit({ reset: true });
  assert.equal(r.watcher.get().lastFile, null);
});

test('wiring: the feed going down for FEED_DOWN_MS shows offline (only if the strip was showing)', async (t) => {
  const r = rig(t);
  await flush();
  r.host.emitSessions('proj_shop', [record('ses_a', 'running')]);
  r.clock.t = T0 + SEC;
  r.feed.setState('retrying');
  assert.equal(phaseOf(r.watcher.get(), T0 + SEC + FEED_DOWN_MS), 'offline');
  r.feed.setState('live');
  assert.equal(phaseOf(r.watcher.get(), T0 + SEC + FEED_DOWN_MS), 'working');
});

test('wiring: the detail feeds pending and the screen counts', async (t) => {
  const r = rig(t, { detail: detailOf({ pending: true }) });
  await flush();
  const track = r.watcher.get();
  assert.equal(track.pending, true);
  assert.equal(track.isCanvas, true);
  assert.equal(track.screensTotal, 2);
  assert.equal(track.screensWritten, 1);
  assert.equal(track.createdAt, T0);
});

test('wiring: dismiss goes through the reducer and notifies', async (t) => {
  const r = rig(t, { detail: detailOf({ pending: true }) });
  await flush();
  let heard = 0;
  r.watcher.subscribe(() => (heard += 1));
  r.watcher.dismiss();
  assert.equal(heard, 1);
  assert.notEqual(r.watcher.get().dismissedAt, null);
});

test('wiring: one timer at the next deadline, and it notifies once when it fires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig(t);
  r.feed.emit({ events: [{ seq: 1, slug: 'coffee', kind: 'files', files: ['screens/pricing.html'] }] });
  let heard = 0;
  r.watcher.subscribe(() => (heard += 1));
  r.clock.t = T0 + WRITING_WINDOW_MS;
  t.mock.timers.tick(WRITING_WINDOW_MS);
  assert.equal(heard, 1, 'the writing window ended');
  t.mock.timers.tick(10 * 60 * SEC);
  assert.equal(heard, 1, 'nothing else is timed: no polling while hidden');
});

// ---- QA regressions (qa-tester, feat/build-strip) ----

test('wiring: dispose while onSessions is still answering stops the subscription it returns', async () => {
  const host = createFakeHost({ directory: SHOP });
  host.emitReady();
  let answer: (stop: () => void) => void = () => {};
  let stopped = 0;
  host.onSessions = () => new Promise<() => void>((resolve) => (answer = resolve));
  const feed = fakeFeed();
  const watcher = watchBuildActivity({ host: createGuestHost(host), feed, slug: 'coffee', detail: () => detailOf(), onDetail: () => () => {}, now: () => T0 });
  await flush();
  watcher.dispose();
  answer(() => (stopped += 1));
  await flush();
  assert.equal(stopped, 1, 'a subscription that arrives after dispose is released, not leaked against the 32-per-frame cap');
});

test('an unknown blip mid-turn (host reconnect) keeps the turn: files and elapsed survive', () => {
  const track = run(
    sess(T0, 'idle'),
    sess(T0 + SEC, 'running'),
    files(T0 + 10 * SEC, ['screens/a.html']),
    sess(T0 + 60 * SEC, 'unknown'),
    sess(T0 + 62 * SEC, 'running'),
    sess(T0 + 90 * SEC, 'idle', 'completed'),
  );
  assert.equal(track.turnStartedAt, T0 + SEC);
  assert.deepEqual(track.turnFiles, ['screens/a.html']);
  assert.equal(phase(track, T0 + 91 * SEC), 'done');
});
