// What the Work Status frame says for a design row and for the section (documentation/specs/phase-1-5-sdk-2-7.md §U5.2).
// Pure: the strings must equal what `pillText` (the rail pill) and `badgeOf` (the Checks badge) return, so the
// three places never drift.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChecksRenderState, ChecksSummary, StatusDesignRow, StatusDesignsResponse } from '../../src/shared/api.ts';
import { STATUS_STARTING_GIVE_UP_MS } from '../../src/shared/limits.ts';
import { pillText } from '../../src/ui/model/build-strip-model.ts';
import { badgeOf } from '../../src/ui/model/checks-model.ts';
import {
  STATUS_COPY,
  projectDirectoryOf,
  statusRowView,
  shouldRefetchStatus,
  statusSectionOf,
  type StatusRowContext,
  type StatusSectionInput,
} from '../../src/ui/model/status-model.ts';

const summary = (state: ChecksRenderState, over: { errors?: number; warnings?: number; notes?: number; canRun?: boolean; browser?: boolean } = {}): ChecksSummary => ({
  counts: { errors: over.errors ?? 0, warnings: over.warnings ?? 0, notes: over.notes ?? 0 },
  render: { state },
  canRun: over.canRun ?? true,
  browser: over.browser ?? true,
});

const row = (over: Partial<StatusDesignRow> = {}): StatusDesignRow => ({
  slug: 'pricing-page',
  title: 'Pricing page',
  kind: 'page',
  here: false,
  agent: null,
  lastFile: null,
  checks: null,
  pending: false,
  openComments: 0,
  ...over,
});

const IDLE: StatusRowContext = { checking: false };

// ---- agent part ----

test('agent part: writing, working and failed use the rail pill words, with info, info and error dots', () => {
  const writing = statusRowView(row({ agent: 'writing', lastFile: 'pricing.html' }), IDLE);
  assert.deepEqual(writing.parts, [{ kind: 'agent', text: pillText('writing', 'pricing.html') }]);
  assert.equal(writing.parts[0]?.text, 'Writing pricing.html');
  assert.equal(writing.tone, 'info');

  const working = statusRowView(row({ agent: 'working' }), IDLE);
  assert.equal(working.parts[0]?.text, pillText('working', null));
  assert.equal(working.tone, 'info');

  const failed = statusRowView(row({ agent: 'failed' }), IDLE);
  assert.equal(failed.parts[0]?.text, pillText('failed', null));
  assert.equal(failed.tone, 'error');
});

test('agent part: writing without a file name says just "Writing"', () => {
  assert.equal(statusRowView(row({ agent: 'writing', lastFile: null }), IDLE).parts[0]?.text, pillText('writing', null));
});

test('agent part: a design with no first file yet reads "Waiting for agent" with a warning dot', () => {
  const waiting = statusRowView(row({ pending: true }), IDLE);
  assert.deepEqual(waiting.parts, [{ kind: 'agent', text: 'Waiting for agent' }]);
  assert.equal(waiting.tone, 'warning');
});

test('agent part: the agent state beats "Waiting for agent" when both are set', () => {
  const view = statusRowView(row({ pending: true, agent: 'working' }), IDLE);
  assert.deepEqual(view.parts.map((part) => part.text), ['Agent is working']);
});

test('agent part: none when the agent is finished or unknown', () => {
  assert.deepEqual(statusRowView(row({ agent: null }), IDLE).parts, []);
});

// ---- check part: all six render states, with and without issues ----

const STATES: ChecksRenderState[] = ['running', 'fresh', 'stale', 'none', 'unavailable', 'failed'];
const TONE = { success: 'success', warning: 'warning', error: 'error', neutral: 'muted' } as const;

for (const state of STATES) {
  for (const [name, counts] of [
    ['no issues', {}],
    ['2 warnings', { warnings: 2 }],
    ['1 error and 2 warnings', { errors: 1, warnings: 2 }],
    ['notes only', { notes: 3 }],
  ] as const) {
    for (const [canRun, browser] of [[true, true], [false, true], [false, false]] as const) {
      test(`check part (${state}, ${name}, canRun ${canRun}, browser ${browser}) equals badgeOf`, () => {
        const checks = summary(state, { ...counts, canRun, browser });
        const badge = badgeOf(checks, null, false);
        const view = statusRowView(row({ checks }), IDLE);
        assert.deepEqual(view.parts, [{ kind: 'check', text: badge.label }]);
        assert.equal(view.tone, TONE[badge.tone]);
        assert.equal(view.tooltip, badge.ariaLabel);
      });
    }
  }
}

test('check part: the exact words for the spec table', () => {
  const text = (checks: ChecksSummary): string | undefined => statusRowView(row({ checks }), IDLE).parts[0]?.text;
  assert.equal(text(summary('running')), 'Checking');
  assert.equal(text(summary('fresh', { errors: 2, warnings: 1 })), '3 issues');
  assert.equal(text(summary('fresh', { warnings: 1 })), '1 issue');
  assert.equal(text(summary('fresh')), 'No issues');
  assert.equal(statusRowView(row({ checks: summary('stale') }), IDLE).tooltip, 'Checks: No issues in the files. Rendering was checked before your latest changes.');
  assert.equal(statusRowView(row({ checks: summary('none') }), IDLE).tooltip, 'Checks: No issues in the files. Rendering hasn’t been checked yet.');
  assert.equal(statusRowView(row({ checks: summary('running') }), IDLE).tooltip, 'Checks: Checking the rendering');
});

test('check part: omitted when the checks were not read in time, or the design has no file yet', () => {
  const none = statusRowView(row({ checks: null }), IDLE);
  assert.deepEqual(none.parts, []);
  assert.equal(none.tooltip, null);
  assert.equal(none.tone, 'muted');
  const pending = statusRowView(row({ pending: true, checks: summary('fresh') }), IDLE);
  assert.deepEqual(pending.parts.map((part) => part.kind), ['agent']);
  assert.equal(pending.tooltip, null);
});

test('check part: a check the person just started reads "Checking" before the service says so', () => {
  const view = statusRowView(row({ checks: summary('fresh', { warnings: 2 }) }), { checking: true });
  assert.deepEqual(view.parts, [{ kind: 'check', text: badgeOf(summary('fresh', { warnings: 2 }), null, true).label }]);
  assert.equal(view.parts[0]?.text, 'Checking');
  assert.equal(view.tone, 'muted');
});

// ---- comments part and the whole line ----

test('comments part: counted when open, singular for one, absent for none', () => {
  assert.deepEqual(statusRowView(row({ openComments: 2 }), IDLE).parts, [{ kind: 'comments', text: '2 open comments' }]);
  assert.deepEqual(statusRowView(row({ openComments: 1 }), IDLE).parts, [{ kind: 'comments', text: '1 open comment' }]);
  assert.deepEqual(statusRowView(row({ openComments: 0 }), IDLE).parts, []);
});

test('meta text: the parts in order joined with " · "; the agent dot wins over the check tone', () => {
  const view = statusRowView(row({ agent: 'writing', lastFile: 'pricing.html', checks: summary('fresh', { errors: 3 }), openComments: 2 }), IDLE);
  assert.equal(view.meta, 'Writing pricing.html · 3 issues · 2 open comments');
  assert.equal(view.tone, 'info');
  const calm = statusRowView(row({ checks: summary('fresh', { errors: 3 }) }), IDLE);
  assert.equal(calm.tone, 'error');
});

test('a row with nothing to say has an empty meta and a muted dot', () => {
  const view = statusRowView(row(), IDLE);
  assert.equal(view.meta, '');
  assert.equal(view.tone, 'muted');
});

test('the row keeps the design it is for and whether it belongs to this chat', () => {
  const view = statusRowView(row({ slug: 'a-b', title: 'A <b>bold</b> title', here: true }), IDLE);
  assert.deepEqual([view.slug, view.title, view.here], ['a-b', 'A <b>bold</b> title', true]);
});

// ---- the Check button ----

test('Check: ready when a check can run and none is running', () => {
  assert.deepEqual(statusRowView(row({ checks: summary('fresh') }), IDLE).check, { state: 'ready', reason: null });
});

test('Check: busy while this design is checked, from the service or from a press', () => {
  assert.equal(statusRowView(row({ checks: summary('running', { canRun: false }) }), IDLE).check.state, 'busy');
  assert.equal(statusRowView(row({ checks: summary('fresh') }), { checking: true }).check.state, 'busy');
});

test('Check: disabled with the Chrome reason when no browser was found', () => {
  assert.deepEqual(statusRowView(row({ checks: summary('none', { canRun: false, browser: false }) }), IDLE).check, { state: 'disabled', reason: 'Checks need Chrome, Edge or Chromium.' });
});

test('Check: disabled with the "another design" reason while any design is being checked, even one that is not a row here', () => {
  // A check started from the viewer on a design outside the five rows: no row reads "running", but the service says canRun is false with a browser present.
  assert.deepEqual(statusRowView(row({ checks: summary('fresh', { canRun: false }) }), IDLE).check, {
    state: 'disabled',
    reason: 'Another design is being checked. Try again when it finishes.',
  });
});

test('check part: a never-checked design stays muted while a check of another design runs, and green only with no browser', () => {
  const elsewhere = statusRowView(row({ checks: summary('none', { canRun: false }) }), IDLE);
  assert.equal(elsewhere.tone, 'muted');
  assert.equal(elsewhere.tooltip, 'Checks: No issues in the files. Rendering hasn’t been checked yet.');
  assert.equal(statusRowView(row({ checks: summary('none', { canRun: false, browser: false }) }), IDLE).tone, 'success');
});

test('Check: disabled with a reason when the checks were not read, or there is no file to check yet', () => {
  assert.deepEqual(statusRowView(row({ checks: null }), IDLE).check, { state: 'disabled', reason: STATUS_COPY.checkUnavailable });
  assert.deepEqual(statusRowView(row({ pending: true, checks: summary('none') }), IDLE).check, { state: 'disabled', reason: STATUS_COPY.checkNothingYet });
});

// ---- the section ----

const response = (rows: StatusDesignRow[], total = rows.length): StatusDesignsResponse => ({ rows, total });
const section = (over: Partial<StatusSectionInput> = {}) =>
  statusSectionOf({ data: null, error: null, failingMs: 0, hasProject: true, checking: new Set(), ...over });

test('section: loading until the first answer', () => {
  const view = section();
  assert.equal(view.kind, 'loading');
  assert.equal(view.loadingLabel, 'Loading designs');
  assert.deepEqual(view.rows, []);
  assert.equal(view.notice, null);
});

test('section: empty with a project says to ask the agent or type /design', () => {
  const view = section({ data: response([]), hasProject: true });
  assert.equal(view.kind, 'empty');
  assert.equal(view.emptyText, 'No designs for this project yet. Ask the agent for one, or type /design.');
});

test('section: empty without a project names the last 7 days', () => {
  const view = section({ data: response([]), hasProject: false });
  assert.equal(view.emptyText, 'No designs in the last 7 days. Ask the agent for one, or type /design.');
});

test('section: a list shows its rows and "Show all N designs" only when more exist', () => {
  const rows = [row({ slug: 'a' }), row({ slug: 'b' })];
  const full = section({ data: response(rows, 2) });
  assert.equal(full.kind, 'list');
  assert.deepEqual(full.rows.map((r) => r.slug), ['a', 'b']);
  assert.equal(full.more, null);
  const more = section({ data: response(rows, 12) });
  assert.equal(more.more, 'Show all 12 designs');
});

test('section: a row whose check is running turns every other Check into "another design is being checked"', () => {
  const view = section({
    data: response([row({ slug: 'a', checks: summary('running', { canRun: false }) }), row({ slug: 'b', checks: summary('none', { canRun: false }) })]),
  });
  assert.equal(view.rows[0]?.check.state, 'busy');
  assert.equal(view.rows[1]?.check.reason, 'Another design is being checked. Try again when it finishes.');
});

test('section: a pressed Check marks only its row as busy', () => {
  const view = section({ data: response([row({ slug: 'a', checks: summary('fresh') }), row({ slug: 'b', checks: summary('fresh') })]), checking: new Set(['a']) });
  assert.deepEqual(view.rows.map((r) => r.check.state), ['busy', 'ready']);
});

test('section: the service not running reads "starting", then "isn’t responding" with Try again after 10 s', () => {
  for (const code of ['NO_SERVICE', 'SERVICE_FAILED']) {
    const starting = section({ error: { code, message: 'x' }, failingMs: 2000 });
    assert.equal(starting.kind, 'problem');
    assert.deepEqual(starting.notice, { kind: 'starting', text: 'Design Chamber is starting.', retry: false });
    const stuck = section({ error: { code, message: 'x' }, failingMs: STATUS_STARTING_GIVE_UP_MS });
    assert.deepEqual(stuck.notice, { kind: 'unresponsive', text: 'Design Chamber isn’t responding.', retry: true });
  }
});

test('section: a paused extension says where to turn it on', () => {
  const view = section({ error: { code: 'DISABLED', message: 'x' } });
  assert.deepEqual(view.notice, { kind: 'paused', text: 'Design Chamber is paused. Turn it on in Settings → Extensions.', retry: false });
});

test('section: any other failure shows the service’s own sentence with Try again', () => {
  const view = section({ error: { code: 'internal', message: 'The local service didn’t answer.' } });
  assert.equal(view.kind, 'problem');
  assert.deepEqual(view.notice, { kind: 'error', text: 'Couldn’t load your designs. The local service didn’t answer.', retry: true });
});

test('section: a failed refresh keeps the rows already on screen and adds the notice', () => {
  const view = section({ data: response([row({ slug: 'a' })], 3), error: { code: 'NO_SERVICE', message: 'x' }, failingMs: 500 });
  assert.equal(view.kind, 'list');
  assert.deepEqual(view.rows.map((r) => r.slug), ['a']);
  assert.equal(view.notice?.kind, 'starting');
  assert.equal(view.more, 'Show all 3 designs');
});

test('copy: no em dashes and no en dashes anywhere in the frame’s words', () => {
  const views = [
    section(),
    section({ data: response([]) }),
    section({ data: response([]), hasProject: false }),
    section({ data: response([row({ agent: 'writing', lastFile: 'a.html', checks: summary('stale'), openComments: 2 }), row({ pending: true, checks: null })], 9) }),
    section({ error: { code: 'NO_SERVICE', message: 'x' }, failingMs: 20_000 }),
    section({ error: { code: 'DISABLED', message: 'x' } }),
    section({ error: { code: 'internal', message: 'The local service didn’t answer.' } }),
  ];
  const words = [...Object.values(STATUS_COPY), ...JSON.stringify(views).split('"')];
  for (const text of words) assert.ok(!/[—–]/.test(text), `dash in: ${text}`);
});

// ---- live updates ----

test('refetch: on a reset and on every kind that changes a row', () => {
  assert.equal(shouldRefetchStatus({ reset: true, events: [] }), true);
  for (const kind of ['added', 'removed', 'design', 'files', 'comments', 'checks', 'activity', 'root']) {
    assert.equal(shouldRefetchStatus({ reset: false, events: [{ kind }] }), true, kind);
  }
});

test('refetch: not for thumbnails, versions, loose files or open requests', () => {
  for (const kind of ['thumb', 'versions', 'loose', 'open']) {
    assert.equal(shouldRefetchStatus({ reset: false, events: [{ kind }] }), false, kind);
  }
  assert.equal(shouldRefetchStatus({ reset: false, events: [] }), false);
  assert.equal(shouldRefetchStatus({ reset: false, events: [{ kind: 'thumb' }, { kind: 'checks' }] }), true);
});

// ---- which folder is a project ----

const PROJECTS = [{ directory: '/home/sam/Documents/GitHub/ember-oak' }, { directory: 'C:\\Users\\you\\shop' }];

test('project: a registered project folder is the project, whatever the slashes and case on Windows', () => {
  assert.equal(projectDirectoryOf('/home/sam/Documents/GitHub/ember-oak/', PROJECTS), '/home/sam/Documents/GitHub/ember-oak/');
  assert.equal(projectDirectoryOf('c:/users/YOU/shop', PROJECTS), 'c:/users/YOU/shop');
});

test('project: a no-project chat’s own folder is not a project, so the list falls back to this chat and the last 7 days', () => {
  assert.equal(projectDirectoryOf('/home/sam/.config/openchamber/chats/2026-11-10/session-0a1b2c', PROJECTS), null);
});

test('project: no folder at all, or an empty project list, is not a project', () => {
  assert.equal(projectDirectoryOf(null, PROJECTS), null);
  assert.equal(projectDirectoryOf('/home/sam/work', []), null);
});

test('project: when the project list could not be read, the folder counts as a project, as before', () => {
  assert.equal(projectDirectoryOf('/home/sam/work', null), '/home/sam/work');
  assert.equal(projectDirectoryOf(null, null), null);
});
