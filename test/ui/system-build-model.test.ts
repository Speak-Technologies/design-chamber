import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SystemSummary } from '../../src/shared/types.ts';
import { BRIEF_MAX } from '../../src/shared/limits.ts';
import {
  BUILD_POLL_FAILURES_MAX,
  EXPIRED_BODY,
  STOPPED_BODY,
  WAITING_BODY,
  afterAnswer,
  afterFailure,
  afterProbe,
  briefProblem,
  buildSetup,
  chipView,
  destinationHint,
  keepsPolling,
  startBuildChip,
  startedText,
  type BuildChipModel,
} from '../../src/ui/model/system-build-model.ts';
import { homeLine, sharedRepoNotice, systemRow, systemRowBadges } from '../../src/ui/model/systems-model.ts';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const label = (directory: string): string => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory;

const summary = (over: Partial<SystemSummary> = {}): SystemSummary => ({
  id: 'acme',
  name: 'Acme',
  status: 'draft',
  changesToReview: false,
  sources: { code: null, brand: 0, description: false },
  created: '2026-01-01T00:00:00Z',
  swatches: [],
  usedBy: 0,
  isDefault: false,
  pinnedFor: [],
  updated: new Date(NOW - 3_600_000).toISOString(),
  revision: 1,
  empty: false,
  unreadable: null,
  home: 'internal',
  building: false,
  sharedRepoWith: null,
  livingPage: null,
  proposalWaiting: false,
  ...over,
});

const labels = (actions: ReadonlyArray<{ label: string }>): string[] => actions.map((action) => action.label);
const down = { code: 'REQUEST_FAILED', message: 'The Design Chamber service did not answer. Try again.' };
const broken = { code: 'internal', message: 'The service answered with an error (500).' };

// ---------------------------------------------------------------- the chip's states

test('first poll: a spinner and nothing to press', () => {
  const view = chipView(startBuildChip());
  assert.equal(view.state, 'loading');
  assert.equal(view.spinner, 'Checking the build…');
  assert.deepEqual(view.actions, []);
  assert.equal(view.title, 'New design system');
  assert.equal(keepsPolling(startBuildChip()), true);
});

test('waiting: the interview sentence, the project, and Continue in chat', () => {
  const model = afterAnswer(startBuildChip(), { state: 'waiting', project: { label: 'shop' } });
  const view = chipView(model);
  assert.equal(view.state, 'waiting');
  assert.equal(view.body, 'The agent is interviewing you in chat. The design system shows here once it’s started.');
  assert.equal(view.body, WAITING_BODY);
  assert.equal(view.note, 'Project: shop');
  assert.deepEqual(labels(view.actions), ['Continue in chat']);
  assert.equal(keepsPolling(model), true);
  assert.equal(chipView(afterAnswer(startBuildChip(), { state: 'waiting', project: null })).note, null);
});

test('made: the system opens as soon as it is there; the poll stops', () => {
  const made = afterAnswer(afterAnswer(startBuildChip(), { state: 'waiting', project: null }), { state: 'made', id: 'harbor', name: 'Harbor' });
  assert.equal(keepsPolling(made), false);
  const checking = chipView(made);
  assert.equal(checking.state, 'opening');
  assert.equal(checking.title, 'Harbor');
  assert.equal(checking.spinner, 'Opening Harbor…');
  assert.deepEqual(chipView(afterProbe(made, 'present')).actions, []);
});

test('made, then stopped: the draft is in the trash and only Continue in chat is left', () => {
  const made = afterAnswer(startBuildChip(), { state: 'made', id: 'harbor', name: 'Harbor' });
  const view = chipView(afterProbe(made, 'gone'));
  assert.equal(view.state, 'stopped');
  assert.equal(view.body, 'This build was stopped. Its draft is in the Designs folder’s trash.');
  assert.equal(view.body, STOPPED_BODY);
  assert.deepEqual(labels(view.actions), ['Continue in chat']);
});

test('made, but the system could not be looked at: Open system and a ghost Continue in chat', () => {
  const made = afterAnswer(startBuildChip(), { state: 'made', id: 'harbor', name: 'Harbor' });
  const view = chipView(afterProbe(made, 'unknown'));
  assert.equal(view.state, 'made');
  assert.deepEqual(view.actions.map((action) => [action.label, action.primary]), [['Open system', true], ['Continue in chat', false]]);
});

test('expired: the week-old sentence, no actions, no more polling', () => {
  const model = afterAnswer(startBuildChip(), { state: 'expired' });
  const view = chipView(model);
  assert.equal(view.body, 'This build was started more than a week ago. Run /design-system again.');
  assert.equal(view.body, EXPIRED_BODY);
  assert.deepEqual(view.actions, []);
  assert.equal(keepsPolling(model), false);
});

test('a made or expired build never goes back: a late answer or a failed poll changes nothing', () => {
  const made: BuildChipModel = { phase: 'made', id: 'harbor', name: 'Harbor', probe: 'present' };
  assert.equal(afterAnswer(made, { state: 'waiting', project: null }), made);
  assert.equal(afterFailure(made, down), made);
  const expired: BuildChipModel = { phase: 'expired' };
  assert.equal(afterAnswer(expired, { state: 'made', id: 'x', name: 'X' }), expired);
  assert.equal(afterProbe({ phase: 'waiting', project: null, failures: 0 }, 'gone').phase, 'waiting');
});

// ---------------------------------------------------------------- failures

test('the service not running is its own state at once, with Try again', () => {
  const view = chipView(afterFailure(startBuildChip(), down));
  assert.equal(view.state, 'service-down');
  assert.equal(view.problem?.title, 'Design Chamber isn’t running');
  assert.deepEqual(labels(view.actions), ['Try again']);
  assert.equal(view.tone, 'error');
});

test('three failed polls in a row end the polling; one answer in between starts the count again', () => {
  let model = startBuildChip();
  for (let tries = 1; tries < BUILD_POLL_FAILURES_MAX; tries += 1) {
    model = afterFailure(model, broken);
    assert.equal(keepsPolling(model), true, `try ${tries} keeps going`);
  }
  model = afterFailure(model, broken);
  const view = chipView(model);
  assert.equal(view.state, 'failed');
  assert.equal(view.problem?.title, 'Couldn’t check the build');
  assert.equal(view.problem?.body, broken.message);
  assert.deepEqual(labels(view.actions), ['Try again']);
  assert.equal(keepsPolling(model), false);

  let again = afterFailure(afterFailure(startBuildChip(), broken), broken);
  again = afterAnswer(again, { state: 'waiting', project: null });
  again = afterFailure(afterFailure(again, broken), broken);
  assert.equal(again.phase, 'waiting', 'two more failures after an answer are still only two');
});

test('Try again starts from a fresh first poll', () => {
  const failed = afterFailure(afterFailure(afterFailure(startBuildChip(), broken), broken), broken);
  assert.equal(failed.phase, 'failed');
  assert.deepEqual(startBuildChip(), { phase: 'loading', failures: 0 });
});

// ---------------------------------------------------------------- Build with the agent…

test('with a project and a chat, both destinations are offered and the open chat comes first', () => {
  const setup = buildSetup({ hasSession: true, hasProject: true });
  assert.deepEqual(labels(setup.offered), ['This chat', 'New chat']);
  assert.equal(setup.initial, 'current-chat');
});

test('with a project and no chat, a new chat is the one that works', () => {
  assert.equal(buildSetup({ hasSession: false, hasProject: true }).initial, 'new-chat');
  assert.deepEqual(destinationHint('current-chat', { hasSession: false }), { text: 'No chat is open right now. Open one first.', blocked: true });
  assert.equal(destinationHint('new-chat', { hasSession: false }).blocked, false);
});

test('with no project folder only This chat is offered', () => {
  const setup = buildSetup({ hasSession: true, hasProject: false });
  assert.deepEqual(labels(setup.offered), ['This chat']);
  assert.equal(setup.initial, 'current-chat');
  assert.equal(buildSetup({ hasSession: false, hasProject: false }).initial, 'current-chat');
});

test('the brief is optional and stops at 2000 characters', () => {
  assert.equal(briefProblem(''), null);
  assert.equal(briefProblem('a'.repeat(BRIEF_MAX)), null);
  assert.equal(briefProblem('a'.repeat(BRIEF_MAX + 1)), 'Keep it under 2000 characters.');
});

test('what the toast says once the request reached a chat', () => {
  assert.equal(startedText({ outcome: 'sent', ticket: 'sb_a', sessionId: 's' }), 'Asked the agent to build a design system. Answer its questions in the chat.');
  assert.match(startedText({ outcome: 'composed', ticket: 'sb_a', sessionId: 's' }), /waiting in the chat composer/);
  assert.match(startedText({ outcome: 'new-session', ticket: 'sb_a', sessionId: 's' }), /Started a chat/);
});

test('no em dashes in any sentence the chip or the popover shows', () => {
  const sentences = [
    WAITING_BODY,
    STOPPED_BODY,
    EXPIRED_BODY,
    ...[startBuildChip(), afterFailure(startBuildChip(), down), { phase: 'made' as const, id: 'a', name: 'A', probe: 'unknown' as const }].flatMap((model) => {
      const view = chipView(model);
      return [view.body ?? '', view.problem?.title ?? '', view.problem?.body ?? '', ...labels(view.actions)];
    }),
  ];
  for (const sentence of sentences) assert.ok(!/[—–]/.test(sentence), sentence);
});

// ---------------------------------------------------------------- the list's home lines and badges

test('home lines: In Design Chamber, or Repo · folder with the full path as the tooltip', () => {
  assert.deepEqual(homeLine(summary()), { label: 'In Design Chamber', title: 'Kept in your Designs folder' });
  const repo = summary({ home: { repo: 'shop', directory: 'C:\\Users\\you\\work\\shop' } });
  assert.deepEqual(homeLine(repo), { label: 'Repo · shop', title: 'C:\\Users\\you\\work\\shop' });
});

test('the shared-repo notice is a third line and only for a repo-backed system', () => {
  const repo = summary({ home: { repo: 'shop', directory: '/work/shop' }, sharedRepoWith: 'Acme' });
  assert.equal(sharedRepoNotice(repo), 'shop already has a repo-backed system (Acme).');
  assert.equal(sharedRepoNotice(summary({ sharedRepoWith: 'Acme' })), null);
  assert.equal(sharedRepoNotice(summary({ home: { repo: 'shop', directory: '/work/shop' } })), null);
});

test('a system being built shows the info badge first, and the row says so to a screen reader', () => {
  const row = systemRow(summary({ building: true, changesToReview: true, isDefault: true, pinnedFor: ['/work/shop'], home: { repo: 'shop', directory: '/work/shop' } }), { nowMs: NOW, locale: 'en', label });
  assert.deepEqual(row.badges.map((badge) => [badge.id, badge.tone]), [['building', 'info'], ['changes', 'warning']]);
  assert.equal(row.more?.text, '+2');
  assert.match(row.more?.title ?? '', /Default, Pinned for shop/);
  assert.match(row.ariaLabel, /Being built/);
});

test('at most two badges sit beside the home badge; the rest fold into +N', () => {
  const { shown, hidden } = systemRowBadges(summary({ building: true, changesToReview: true, isDefault: true, pinnedFor: ['/a', '/b'] }), label);
  assert.equal(shown.length, 2);
  assert.deepEqual(hidden.map((badge) => badge.id), ['default', 'pinned']);
});
