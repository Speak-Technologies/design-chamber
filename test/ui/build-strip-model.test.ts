// What the build strip says for each phase (full-screen text, rail pill, detail, tone, actions,
// the one-per-change announcement). Pure: tracks come from the real reducer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { QUIET_MS, initialTrack, reduceBuild, type BuildInput, type BuildTrack, type LinkedActivity } from '../../src/guest/build-activity.ts';
import { buildView, formatElapsed } from '../../src/ui/model/build-strip-model.ts';

const T0 = 1_700_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const WRITING_MS = 15 * SEC;

const run = (...inputs: BuildInput[]): BuildTrack => inputs.reduce<BuildTrack>((track, input) => reduceBuild(track, input), initialTrack(T0));
const sess = (at: number, activity: LinkedActivity, outcome: 'completed' | 'failed' | null = null): BuildInput => ({ kind: 'session', at, activity, outcome });
const files = (at: number, list: string[], created = false): BuildInput => ({ kind: 'files', at, files: list, created });
const detail = (over: Partial<Extract<BuildInput, { kind: 'detail' }>> = {}): BuildInput => ({
  kind: 'detail',
  at: T0,
  pending: false,
  created: T0,
  screensWritten: 0,
  screensTotal: 0,
  isCanvas: false,
  ...over,
});

// ---- formatElapsed ----

test('formatElapsed: m:ss, then h:mm:ss', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(42 * SEC), '0:42');
  assert.equal(formatElapsed(42_999), '0:42', 'whole seconds, never rounded up');
  assert.equal(formatElapsed(12 * MIN + 5 * SEC), '12:05');
  assert.equal(formatElapsed(60 * MIN + 2 * MIN + 3 * SEC), '1:02:03');
  assert.equal(formatElapsed(-5 * SEC), '0:00', 'a clock step back never shows a negative time');
});

// ---- hidden ----

test('nothing to show: an empty view that announces nothing', () => {
  const view = buildView(initialTrack(T0), T0);
  assert.equal(view.phase, 'hidden');
  assert.deepEqual([view.text, view.pill, view.detail, view.elapsed, view.announce, view.title], ['', '', null, null, null, null]);
  assert.deepEqual(view.actions, []);
});

// ---- copy per phase ----

test('question and permission: a warning with Open chat', () => {
  const question = buildView(run(sess(T0, 'waiting-question')), T0 + SEC);
  assert.equal(question.text, 'The agent is asking you something in the chat');
  assert.equal(question.pill, 'Agent has a question');
  assert.equal(question.tone, 'warning');
  assert.deepEqual(question.actions, ['open-chat']);
  const permission = buildView(run(sess(T0, 'waiting-permission')), T0 + SEC);
  assert.equal(permission.text, 'The agent needs your OK in the chat');
  assert.equal(permission.pill, 'Agent needs your OK');
  assert.deepEqual(permission.actions, ['open-chat']);
});

test('working: neutral text, elapsed since the turn started, nothing saved yet', () => {
  const view = buildView(run(sess(T0, 'running')), T0 + 42 * SEC);
  assert.equal(view.phase, 'working');
  assert.equal(view.text, 'The agent is working');
  assert.equal(view.pill, 'Agent is working');
  assert.equal(view.tone, 'info');
  assert.equal(view.elapsed, '0:42');
  assert.equal(view.detail, null, 'no file this turn and not yet quiet');
  assert.deepEqual(view.actions, []);
});

test('working: names the last saved file, then admits a quiet spell after QUIET_MS', () => {
  const track = run(sess(T0, 'running'), files(T0 + 5 * SEC, ['screens/pricing.html']));
  const after = buildView(track, T0 + 5 * SEC + 90 * SEC);
  assert.equal(after.phase, 'working');
  assert.match(after.detail ?? '', /^Last saved pricing\.html /);
  assert.equal(buildView(track, T0 + 5 * SEC + QUIET_MS - 1).detail?.startsWith('Last saved'), true);
  assert.equal(buildView(track, T0 + 5 * SEC + QUIET_MS).detail, 'Nothing saved in the last 2 minutes');
  const untouched = run(sess(T0, 'running'));
  assert.equal(buildView(untouched, T0 + QUIET_MS).detail, 'Nothing saved in the last 2 minutes', 'from the turn start when nothing was saved');
});

test('retrying: a warning with elapsed', () => {
  const view = buildView(run(sess(T0, 'retrying')), T0 + 65 * SEC);
  assert.equal(view.text, 'The agent hit a problem and is retrying');
  assert.equal(view.pill, 'Agent is retrying');
  assert.equal(view.tone, 'warning');
  assert.equal(view.elapsed, '1:05');
});

test('writing: the full path on the strip, the basename in the pill, the whole path in the tooltip', () => {
  const view = buildView(run(sess(T0, 'running'), files(T0 + 10 * SEC, ['screens/pricing.html'])), T0 + 11 * SEC);
  assert.equal(view.phase, 'writing');
  assert.equal(view.text, 'Writing screens/pricing.html');
  assert.equal(view.pill, 'Writing pricing.html');
  assert.equal(view.title, 'screens/pricing.html');
  assert.equal(view.tone, 'info');
  assert.equal(view.elapsed, '0:11');
});

test('writing: long names are cut with an ellipsis (middlePath); the tooltip keeps the whole path', () => {
  const long = `assets/${'deeply-nested-folder/'.repeat(5)}${'a-very-long-file-name-'.repeat(3)}hero.png`;
  const view = buildView(run(sess(T0, 'running'), files(T0, [long])), T0 + SEC);
  assert.ok(view.text.length < `Writing ${long}`.length);
  assert.ok(view.text.includes('…'));
  assert.ok(view.pill.length <= 'Writing '.length + 24, 'the pill name stays within 24 characters');
  assert.equal(view.title, long);
});

test('writing without a name (a folder just appeared) and without a session', () => {
  const view = buildView(run(files(T0, [], true)), T0 + SEC);
  assert.equal(view.text, 'The agent is writing');
  assert.equal(view.pill, 'Writing');
  assert.equal(view.title, null);
  assert.equal(view.elapsed, null, 'no turn known, so no elapsed time');
});

test('writing: "2 of 4 screens written" only on a canvas with more than one screen', () => {
  const canvas = run(sess(T0, 'running'), detail({ isCanvas: true, screensTotal: 4, screensWritten: 2 }), files(T0, ['screens/a.html']));
  assert.equal(buildView(canvas, T0 + SEC).detail, '2 of 4 screens written');
  const single = run(sess(T0, 'running'), detail({ isCanvas: true, screensTotal: 1, screensWritten: 1 }), files(T0, ['screens/a.html']));
  assert.equal(buildView(single, T0 + SEC).detail, null);
  const page = run(sess(T0, 'running'), detail({ isCanvas: false, screensTotal: 0, screensWritten: 0 }), files(T0, ['index.html']));
  assert.equal(buildView(page, T0 + SEC).detail, null);
});

test('done: counts the files, a success; Open chat only when nothing changed', () => {
  const changed = run(sess(T0, 'running'), files(T0 + SEC, ['index.html', 'tokens.css', 'assets/a.png']), sess(T0 + 20 * SEC, 'idle', 'completed'));
  const view = buildView(changed, T0 + 21 * SEC);
  assert.equal(view.phase, 'done');
  assert.equal(view.text, 'Done. Updated 3 files');
  assert.equal(view.pill, 'Done');
  assert.equal(view.tone, 'success');
  assert.deepEqual(view.actions, []);
  assert.equal(view.elapsed, null, 'the clock stops with the turn');
  const one = run(sess(T0, 'running'), files(T0 + SEC, ['index.html']), sess(T0 + 20 * SEC, 'idle', 'completed'));
  assert.equal(buildView(one, T0 + 21 * SEC).text, 'Done. Updated 1 file');
  const nothing = buildView(run(sess(T0, 'running'), sess(T0 + 20 * SEC, 'idle', 'completed')), T0 + 21 * SEC);
  assert.equal(nothing.text, 'Done. No files changed');
  assert.deepEqual(nothing.actions, ['open-chat']);
});

test('failed: an error with Open chat and Dismiss', () => {
  const view = buildView(run(sess(T0, 'running'), sess(T0 + 5 * SEC, 'idle', 'failed')), T0 + 6 * SEC);
  assert.equal(view.phase, 'failed');
  assert.equal(view.text, 'The agent stopped with an error');
  assert.equal(view.pill, 'Agent stopped');
  assert.equal(view.tone, 'error');
  assert.deepEqual(view.actions, ['open-chat', 'dismiss']);
});

test('stalled: a warning with Open chat and Dismiss', () => {
  const view = buildView(run(detail({ pending: true, created: T0 })), T0 + 3 * MIN);
  assert.equal(view.phase, 'stalled');
  assert.equal(view.text, 'Nothing written yet. Check the chat for a question.');
  assert.equal(view.pill, 'Nothing written yet');
  assert.equal(view.tone, 'warning');
  assert.deepEqual(view.actions, ['open-chat', 'dismiss']);
});

test('offline: a warning, no action', () => {
  const view = buildView(run(sess(T0, 'running'), { kind: 'feed', at: T0 + SEC, state: 'retrying' }), T0 + SEC + 6 * SEC);
  assert.equal(view.phase, 'offline');
  assert.equal(view.text, 'Reconnecting to the local service');
  assert.equal(view.pill, 'Reconnecting');
  assert.equal(view.tone, 'warning');
  assert.deepEqual(view.actions, []);
});

// ---- announce ----

test('announce is the text without the elapsed time and does not change as seconds tick', () => {
  const track = run(sess(T0, 'running'), files(T0, ['screens/pricing.html']));
  const first = buildView(track, T0 + 2 * SEC);
  const later = buildView(track, T0 + 9 * SEC);
  assert.equal(first.announce, 'Writing screens/pricing.html');
  assert.equal(later.announce, first.announce);
  assert.notEqual(later.elapsed, first.elapsed);
});

test('announce stays put across the detail changing (a minute passing) within a phase', () => {
  const track = run(sess(T0, 'running'), files(T0, ['screens/pricing.html']));
  const a = buildView(track, T0 + WRITING_MS + 5 * SEC);
  const b = buildView(track, T0 + WRITING_MS + 65 * SEC);
  assert.equal(a.phase, 'working');
  assert.notEqual(a.detail, b.detail);
  assert.equal(a.announce, b.announce);
});

test('announce changes when the phase or the file changes', () => {
  const one = run(sess(T0, 'running'), files(T0, ['screens/a.html']));
  const two = reduceBuild(one, files(T0 + SEC, ['screens/b.html']));
  assert.notEqual(buildView(one, T0 + 2 * SEC).announce, buildView(two, T0 + 2 * SEC).announce);
  assert.notEqual(buildView(one, T0 + 2 * SEC).announce, buildView(one, T0 + 60 * SEC).announce);
});
