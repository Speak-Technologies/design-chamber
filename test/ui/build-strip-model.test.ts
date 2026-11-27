// What the build strip says for each phase (full-screen text, rail pill, detail, tone, actions,
// the one-per-change announcement). Pure: tracks come from the real reducer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { QUIET_MS, initialTrack, reduceBuild, type BuildInput, type BuildTrack, type LinkedActivity } from '../../src/guest/build-activity.ts';
import { TOOL_REPAINT_MS } from '../../src/shared/limits.ts';
import { buildView, formatElapsed, paintTrack, pillText, type ToolHold } from '../../src/ui/model/build-strip-model.ts';
import type { ToolDesign } from '../../src/ui/model/tool-model.ts';

const T0 = 1_700_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const WRITING_MS = 15 * SEC;

const run = (...inputs: BuildInput[]): BuildTrack => inputs.reduce<BuildTrack>((track, input) => reduceBuild(track, input), initialTrack(T0));
const sess = (at: number, activity: LinkedActivity, outcome: 'completed' | 'failed' | null = null): BuildInput => ({ kind: 'session', at, activity, outcome, tool: null });
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

// ---- pillText: the words a Work Status row shares with the rail pill ----

test('pillText says exactly what buildView shows in the rail pill', () => {
  const writing = buildView(run(sess(T0, 'running'), files(T0 + 10 * SEC, ['screens/pricing.html'])), T0 + 11 * SEC);
  assert.equal(writing.phase, 'writing');
  assert.equal(pillText('writing', 'screens/pricing.html'), writing.pill);
  assert.equal(pillText('writing', 'pricing.html'), writing.pill, 'a bare name reads the same as its path');

  const nameless = buildView(run(files(T0, [], true)), T0 + SEC);
  assert.equal(pillText('writing', null), nameless.pill);

  const long = `assets/${'a-very-long-file-name-'.repeat(3)}hero.png`;
  assert.equal(pillText('writing', long), buildView(run(sess(T0, 'running'), files(T0, [long])), T0 + SEC).pill, 'long names are cut the same way');

  const working = buildView(run(sess(T0, 'running')), T0 + 42 * SEC);
  assert.equal(working.phase, 'working');
  assert.equal(pillText('working', null), working.pill);

  const failed = buildView(run(sess(T0, 'running'), sess(T0 + 5 * SEC, 'idle', 'failed')), T0 + 6 * SEC);
  assert.equal(failed.phase, 'failed');
  assert.equal(pillText('failed', null), failed.pill);

  const done = buildView(run(sess(T0, 'running'), files(T0 + SEC, ['index.html']), sess(T0 + 20 * SEC, 'idle', 'completed')), T0 + 21 * SEC);
  assert.equal(done.phase, 'done');
  assert.equal(pillText('done', null), done.pill);
});

test('pillText words: the four phases a status row shows', () => {
  assert.deepEqual(
    [pillText('writing', 'screens/pricing.html'), pillText('writing', null), pillText('working', null), pillText('failed', null), pillText('done', null)],
    ['Writing pricing.html', 'Writing', 'Agent is working', 'Agent stopped', 'Done'],
  );
});

// ---- the agent's current tool (native-extras §1.2) ----

const COFFEE: ToolDesign = { slug: 'coffee', entry: null, files: ['screens/home.html', 'screens/pricing.html'] };
const running = (at: number, name: string, target: string | null = null): BuildInput => ({ kind: 'session', at, activity: 'running', outcome: null, tool: { name, target } });

test('working with a tool: the words, the pill and the tooltip name it; the detail line stays', () => {
  const track = run(running(T0, 'edit', 'pricing.html'), files(T0, ['screens/home.html']));
  const at = T0 + WRITING_MS + 5 * SEC;
  const view = buildView(track, at, 'en', COFFEE);
  assert.equal(view.phase, 'working');
  assert.equal(view.text, 'Editing screens/pricing.html');
  assert.equal(view.pill, 'Editing pricing.html');
  assert.equal(view.title, 'screens/pricing.html');
  assert.equal(view.announce, 'Editing screens/pricing.html', 'an edit is worth saying aloud');
  assert.match(view.detail ?? '', /^Last saved home\.html /);
  assert.equal(view.elapsed, '0:20');
  assert.equal(view.tone, 'info');
});

test('writing with a tool: the tool words, with the screens line kept', () => {
  const track = run(running(T0, 'read', 'src/styles/theme.css'), detail({ isCanvas: true, screensTotal: 4, screensWritten: 2 }), files(T0, ['screens/home.html']));
  const view = buildView(track, T0 + SEC, 'en', COFFEE);
  assert.equal(view.phase, 'writing');
  assert.equal(view.text, 'Reading src/styles/theme.css');
  assert.equal(view.pill, 'Reading theme.css');
  assert.equal(view.detail, '2 of 4 screens written');
  assert.equal(view.announce, 'Writing screens/home.html', 'a read is not announced: the phase keeps its own sentence');
});

test('announce: writes and edits only; every other kind keeps the phase sentence', () => {
  assert.equal(buildView(run(running(T0, 'write', 'screens/home.html')), T0 + SEC, 'en', COFFEE).announce, 'Writing screens/home.html');
  for (const [name, target] of [['read', 'a.css'], ['grep', 'src'], ['bash', 'ls'], ['webfetch', null], ['todowrite', null], ['task', null], ['design_check', null], ['design_list', null]] as const) {
    const view = buildView(run(running(T0, name, target)), T0 + SEC, 'en', COFFEE);
    assert.equal(view.announce, 'The agent is working', name);
    assert.notEqual(view.text, 'The agent is working', name);
  }
});

test('an unknown tool, or none, keeps today’s words', () => {
  const unknown = buildView(run(running(T0, 'question', 'a.css')), T0 + SEC, 'en', COFFEE);
  assert.deepEqual([unknown.text, unknown.pill, unknown.announce, unknown.title], ['The agent is working', 'Agent is working', 'The agent is working', null]);
});

test('without a design (the system strip) the target shows as the host gave it', () => {
  assert.equal(buildView(run(running(T0, 'edit', 'tokens.css')), T0 + SEC).text, 'Editing tokens.css');
});

test('other phases ignore the tool', () => {
  const track = run(running(T0, 'edit', 'a.css'), { kind: 'feed', at: T0 + SEC, state: 'retrying' });
  assert.equal(buildView(track, T0 + 10 * SEC, 'en', COFFEE).text, 'Reconnecting to the local service');
});

test('a saved file name is cleaned before it is shortened: text, pill, detail, tooltip and announcement', () => {
  const nasty = `screens/${'\u200E'.repeat(40)}price\u202Elmth.\u2066gnp\u0007`;
  const clean = 'screens/pricelmth.gnp';
  const writing = buildView(run(sess(T0, 'running'), files(T0, [nasty])), T0 + SEC);
  assert.deepEqual([writing.text, writing.pill, writing.title, writing.announce], [`Writing ${clean}`, 'Writing pricelmth.gnp', clean, `Writing ${clean}`]);
  const working = buildView(run(sess(T0, 'running'), files(T0, [nasty])), T0 + WRITING_MS + SEC);
  assert.match(working.detail ?? '', /^Last saved pricelmth\.gnp /);
  assert.equal(pillText('writing', nasty), 'Writing pricelmth.gnp', 'Work Status gets the same words');
  assert.equal(pillText('writing', '\u202E'), 'Writing', 'nothing left to name');
  assert.equal(buildView(run(sess(T0, 'running'), files(T0, ['\u202E'])), T0 + SEC).text, 'The agent is writing');
  const edited = buildView(run(running(T0, 'edit', 'screens/\u202Egnp.html')), T0 + SEC, 'en', COFFEE);
  assert.deepEqual([edited.text, edited.pill, edited.title, edited.announce], ['Editing screens/gnp.html', 'Editing gnp.html', 'screens/gnp.html', 'Editing screens/gnp.html']);
});

// ---- paintTrack: tool words change at most once a second ----

/** Paint each (time, track) in turn and report the tool target on screen after each, with the wait. */
const painter = () => {
  let held: ToolHold | null = null;
  return (track: BuildTrack, now: number): [string | null, number | null] => {
    const painted = paintTrack(held, track, now);
    held = painted.held;
    return [painted.track.tool?.target ?? null, painted.wait];
  };
};
const reading = (target: string, from: BuildTrack = initialTrack(T0), at = T0): BuildTrack => reduceBuild(from, running(at, 'read', target));

test('paintTrack: the first tool shows at once; the next waits out the second, then the latest shows', () => {
  const paint = painter();
  const a = reading('a');
  assert.deepEqual(paint(a, T0), ['a', null]);
  const b = reading('b', a, T0 + 100);
  assert.deepEqual(paint(b, T0 + 100), ['a', TOOL_REPAINT_MS - 100]);
  const c = reading('c', b, T0 + 400);
  assert.deepEqual(paint(c, T0 + 400), ['a', TOOL_REPAINT_MS - 400], 'the wait runs from the last change on screen, not from the newest tool');
  assert.deepEqual(paint(c, T0 + TOOL_REPAINT_MS - 1), ['a', 1], 'a repaint for the elapsed time does not let it through early');
  assert.deepEqual(paint(c, T0 + TOOL_REPAINT_MS), ['c', null]);
  const d = reading('d', c, T0 + TOOL_REPAINT_MS + 10);
  assert.deepEqual(paint(d, T0 + TOOL_REPAINT_MS + 10), ['c', TOOL_REPAINT_MS - 10]);
});

test('paintTrack: a change after a quiet second shows at once, and no timer is asked for', () => {
  const paint = painter();
  const a = reading('a');
  paint(a, T0);
  assert.deepEqual(paint(reading('b', a, T0 + 5 * SEC), T0 + 5 * SEC), ['b', null]);
});

test('paintTrack: a phase change paints at once', () => {
  const paint = painter();
  const a = reading('a');
  paint(a, T0);
  const writing = reduceBuild(reading('b', a, T0 + 100), files(T0 + 100, ['screens/home.html']));
  assert.deepEqual(paint(writing, T0 + 100), ['b', null]);
  const question = reduceBuild(writing, sess(T0 + 200, 'waiting-question'));
  assert.deepEqual(paint(question, T0 + 200), [null, null]);
});

test('paintTrack: other news paints while the tool is still held back', () => {
  let held: ToolHold | null = null;
  const a = reading('a');
  held = paintTrack(held, a, T0).held;
  const b = reduceBuild(reading('b', a, T0 + 100), detail({ isCanvas: true, screensTotal: 3, screensWritten: 1 }));
  const painted = paintTrack(held, b, T0 + 100);
  assert.deepEqual([painted.track.tool?.target, painted.track.screensWritten], ['a', 1]);
});

test('paintTrack: a clock stepped back never holds the words for longer than a second', () => {
  const paint = painter();
  const a = reading('a');
  paint(a, T0);
  assert.deepEqual(paint(reading('b', a, T0 - 60 * SEC), T0 - 60 * SEC), ['b', null]);
});
