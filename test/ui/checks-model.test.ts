import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChecksRenderState, ChecksResponse, ChecksSummary } from '../../src/shared/api.ts';
import { countFindings, withMessage } from '../../src/shared/checks.ts';
import type { CheckFindingData } from '../../src/shared/types.ts';
import { badgeOf, groupsOf, issueCount, panelOf, renderLineOf, rendersCounted, runResultOf, shouldRefetch } from '../../src/ui/model/checks-model.ts';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const finding = (code: CheckFindingData['code'], over: Partial<CheckFindingData> = {}) => withMessage({ code, file: 'index.html', screen: null, viewport: null, ...over });

type Over = {
  static?: ReturnType<typeof finding>[];
  render?: ReturnType<typeof finding>[];
  state?: ChecksRenderState;
  canRun?: boolean;
  /** A browser was found; defaults to true. */
  browser?: boolean;
  artboards?: number;
  at?: string | null;
  /** Counted findings; defaults to the static ones plus the render ones when the state is `fresh`. */
  counted?: ReturnType<typeof finding>[];
};

const response = (over: Over = {}): ChecksResponse => {
  const staticFindings = over.static ?? [];
  const render = over.render ?? [];
  const state = over.state ?? 'fresh';
  const counted = over.counted ?? [...staticFindings, ...(state === 'fresh' ? render : [])];
  return {
    static: { findings: staticFindings, partial: false, at: '2026-11-08T11:59:59.000Z' },
    render: { state, at: over.at === undefined ? '2026-11-08T11:56:00.000Z' : over.at, artboards: over.artboards ?? 2, skipped: 0, findings: render },
    counts: countFindings(counted),
    canRun: over.canRun ?? true,
    browser: over.browser ?? true,
  };
};

const ERR = finding('ref-missing');
const ERR2 = finding('entry-missing');
const WARN = finding('doc-title');
const NOTE = finding('doc-charset');

// ---- the badge ----

test('the badge counts errors and warnings, one issue singular, never notes', () => {
  assert.equal(badgeOf(response({ static: [ERR] }), null, false).label, '1 issue');
  assert.equal(badgeOf(response({ static: [ERR, WARN] }), null, false).label, '2 issues');
  assert.equal(badgeOf(response({ static: [NOTE] }), null, false).label, 'No issues');
  assert.equal(issueCount(response({ static: [ERR, ERR2, WARN, NOTE] })), 3);
});

test('the badge tone follows the worst counted severity', () => {
  assert.equal(badgeOf(response({ static: [WARN] }), null, false).tone, 'warning');
  assert.equal(badgeOf(response({ static: [WARN, ERR] }), null, false).tone, 'error');
  assert.equal(badgeOf(response({ static: [] }), null, false).tone, 'success');
});

test('the accessible name carries the label, so the colour is never the only signal', () => {
  assert.equal(badgeOf(response({ static: [ERR, WARN] }), null, false).ariaLabel, 'Checks: 2 issues');
  assert.equal(badgeOf(response({ static: [ERR] }), null, false).ariaLabel, 'Checks: 1 issue');
  assert.equal(badgeOf(response(), null, false).ariaLabel, 'Checks: No issues');
});

test('loading, running and a failed load are neutral and say so', () => {
  assert.deepEqual(badgeOf(null, null, false), { label: 'Checking', tone: 'neutral', ariaLabel: 'Checks: Checking', count: 0 });
  assert.equal(badgeOf(null, 'The service did not answer.', false).label, 'Checks');
  assert.equal(badgeOf(null, 'The service did not answer.', false).tone, 'neutral');
  assert.match(badgeOf(null, 'x', false).ariaLabel, /didn’t load/);
  const during = badgeOf(response({ static: [ERR] }), null, true);
  assert.equal(during.label, 'Checking');
  assert.equal(during.tone, 'neutral');
  assert.equal(badgeOf(response({ state: 'running', static: [ERR] }), null, false).label, 'Checking');
});

test('the badge carries the issue count for the rail, where it shows the number alone', () => {
  assert.equal(badgeOf(response({ static: [ERR, WARN, NOTE] }), null, false).count, 2);
  assert.equal(badgeOf(response(), null, false).count, 0);
  assert.equal(badgeOf(response({ static: [ERR] }), null, true).count, 0);
  assert.equal(badgeOf(null, 'x', false).count, 0);
});

test('a refresh that failed keeps the last good count on the badge', () => {
  assert.equal(badgeOf(response({ static: [ERR] }), 'The service did not answer.', false).label, '1 issue');
});

test('a pass is green only when nothing more can be learned; otherwise it is neutral and says what is missing', () => {
  assert.equal(badgeOf(response({ state: 'fresh' }), null, false).tone, 'success');
  assert.equal(badgeOf(response({ state: 'unavailable' }), null, false).tone, 'success');
  assert.equal(badgeOf(response({ state: 'none', canRun: false, browser: false }), null, false).tone, 'success', 'no browser: nothing to check with');
  assert.equal(badgeOf(response({ state: 'none', canRun: false, browser: true }), null, false).tone, 'neutral', 'a run elsewhere is not a missing browser');
  const never = badgeOf(response({ state: 'none' }), null, false);
  assert.equal(never.tone, 'neutral');
  assert.equal(never.label, 'No issues');
  assert.match(never.ariaLabel, /Rendering hasn’t been checked yet/);
  const stale = badgeOf(response({ state: 'stale' }), null, false);
  assert.equal(stale.tone, 'neutral');
  assert.match(stale.ariaLabel, /checked before your latest changes/);
  assert.equal(badgeOf(response({ state: 'failed' }), null, false).tone, 'neutral');
});

test('badgeOf and issueCount take a ChecksSummary: a Work Status row carries only counts, render state, canRun and browser', () => {
  const summary = (over: Partial<ChecksSummary> = {}): ChecksSummary => ({ counts: { errors: 0, warnings: 0, notes: 0 }, render: { state: 'fresh' }, canRun: true, browser: true, ...over });
  assert.equal(issueCount(summary({ counts: { errors: 1, warnings: 2, notes: 5 } })), 3, 'notes never count');
  assert.deepEqual(badgeOf(summary({ counts: { errors: 1, warnings: 0, notes: 0 } }), null, false), badgeOf(response({ static: [ERR] }), null, false), 'same words and tone as the full response');
  assert.equal(badgeOf(summary({ counts: { errors: 0, warnings: 2, notes: 0 } }), null, false).tone, 'warning');
  assert.equal(badgeOf(summary(), null, false).tone, 'success');
  assert.equal(badgeOf(summary({ render: { state: 'none' } }), null, false).tone, 'neutral', 'rendering never checked and it can run');
  assert.equal(badgeOf(summary({ render: { state: 'none' }, canRun: false, browser: false }), null, false).tone, 'success', 'no browser');
  assert.equal(badgeOf(summary({ render: { state: 'none' }, canRun: false, browser: true }), null, false).tone, 'neutral', 'another design is being checked: still not known');
  assert.match(badgeOf(summary({ render: { state: 'stale' } }), null, false).ariaLabel, /checked before your latest changes/);
  assert.equal(badgeOf(summary({ render: { state: 'running' } }), null, false).label, 'Checking');
  // A full response still fits where a summary is asked for.
  const full: ChecksSummary = response({ static: [WARN] });
  assert.equal(badgeOf(full, null, false).label, '1 issue');
});

// ---- counted render findings ----

test('render findings are counted only for a fresh rendering', () => {
  const render = [finding('overflow-x', { file: 's.html', viewport: 'phone', params: { px: 452, width: 390 } })];
  assert.equal(rendersCounted(response({ state: 'fresh', render })), true);
  assert.equal(rendersCounted(response({ state: 'stale', render })), false);
  assert.equal(rendersCounted(response({ state: 'running', render })), false);
  assert.equal(rendersCounted(response({ state: 'none' })), false);
});

test('an unavailable or failed rendering is counted when the service counted it', () => {
  const failed = finding('render-failed', { file: 's.html', viewport: 'phone' });
  assert.equal(rendersCounted(response({ state: 'failed', render: [failed], counted: [failed] })), true);
  assert.equal(rendersCounted(response({ state: 'failed', render: [failed], counted: [] })), false);
  assert.equal(rendersCounted(response({ state: 'unavailable', render: [] })), true);
});

// ---- groups ----

test('groups are errors, warnings, notes, then older findings; empty ones are left out', () => {
  const groups = groupsOf(response({ static: [NOTE, WARN, ERR] }));
  assert.deepEqual(groups.map((group) => group.id), ['errors', 'warnings', 'notes']);
  assert.deepEqual(groups.map((group) => group.title), ['Needs fixing', 'Worth a look', 'Notes']);
  assert.deepEqual(groups.map((group) => group.collapsed), [false, false, true]);
  assert.deepEqual(groupsOf(response()), []);
});

test('a fresh rendering joins the current groups, errors first', () => {
  const overflow = finding('overflow-x', { file: 's.html', viewport: 'phone', params: { px: 452, width: 390 } });
  const groups = groupsOf(response({ static: [WARN, ERR], render: [overflow] }));
  assert.deepEqual(groups[0]?.items.map((item) => item.code), ['ref-missing', 'overflow-x']);
  assert.deepEqual(groups[1]?.items.map((item) => item.code), ['doc-title']);
});

test('older rendering findings sit in their own muted group and are not counted with the current ones', () => {
  const overflow = finding('overflow-x', { file: 's.html', viewport: 'phone', params: { px: 452, width: 390 } });
  const contrast = finding('contrast', { file: 's.html', viewport: 'laptop', params: { ratio: 3.1, min: 4.5 } });
  const groups = groupsOf(response({ state: 'stale', static: [ERR], render: [overflow, contrast] }));
  assert.deepEqual(groups.map((group) => group.id), ['errors', 'earlier']);
  assert.equal(groups[0]?.items.length, 1);
  assert.equal(groups[1]?.title, 'From before your latest changes');
  assert.equal(groups[1]?.tone, 'muted');
  assert.equal(groups[1]?.collapsed, true);
  assert.equal(groups[1]?.items.length, 2);
});

test('while a check is running the earlier findings are labelled as the last check, not as old', () => {
  const overflow = finding('overflow-x', { file: 's.html', viewport: 'phone', params: { px: 452, width: 390 } });
  const groups = groupsOf(response({ state: 'running', render: [overflow] }));
  assert.equal(groups[0]?.title, 'From the last rendering check');
});

test('"no browser found" is the rendering line, not a note to read twice', () => {
  const missing = finding('browser-missing', { file: null });
  const groups = groupsOf(response({ state: 'unavailable', render: [missing], counted: [missing] }));
  assert.deepEqual(groups, []);
});

test('the note count in the summary leaves out the "no browser" note that the rendering line already says', () => {
  const missing = finding('browser-missing', { file: null });
  const view = panelOf(response({ state: 'unavailable', render: [missing], counted: [missing] }), null, false, NOW, 'en');
  assert.equal(view.summary, 'No errors or warnings.');
  const withNote = panelOf(response({ state: 'unavailable', static: [NOTE], render: [missing], counted: [NOTE, missing] }), null, false, NOW, 'en');
  assert.equal(withNote.summary, 'No errors or warnings. 1 note.');
});

test('the sentences are the service ones and design text is passed through as data', () => {
  const entry = finding('contrast', { file: 's.html', viewport: 'laptop', params: { ratio: 3.1, min: 4.5 }, detail: '<img src=x onerror=alert(1)>', selector: 'a > b' });
  const item = groupsOf(response({ render: [entry] }))[0]?.items[0];
  assert.equal(item?.message, entry.message);
  assert.equal(item?.detail, '<img src=x onerror=alert(1)>');
});

// ---- the rendering line (exact copy) ----

test('the rendering line, state by state', () => {
  const line = (over: Over) => renderLineOf(response(over), NOW, 'en').text;
  assert.equal(line({ state: 'none' }), 'Rendering hasn’t been checked yet.');
  assert.equal(line({ state: 'running' }), 'Checking the rendering…');
  assert.equal(line({ state: 'stale' }), 'Rendering was checked before your latest changes.');
  assert.equal(line({ state: 'unavailable' }), 'No Chrome, Edge or Chromium was found, so only the files were checked.');
  assert.equal(line({ state: 'failed' }), 'The last rendering check failed.');
  assert.equal(line({ state: 'fresh', artboards: 6 }), 'Rendered 6 artboards 4 min. ago.');
  assert.equal(line({ state: 'fresh', artboards: 1 }), 'Rendered 1 artboard 4 min. ago.');
  assert.equal(line({ state: 'fresh', artboards: 0 }), 'There was nothing to render yet.');
});

// ---- the panel ----

test('the rendering line already says "checking" once the person asked, before the service reports running', () => {
  const view = panelOf(response({ state: 'stale' }), null, true, NOW, 'en');
  assert.deepEqual(view.renderLine, { text: 'Checking the rendering…', tone: 'busy' });
  assert.equal(panelOf(response({ state: 'stale' }), null, false, NOW, 'en').renderLine?.text, 'Rendering was checked before your latest changes.');
});

test('the panel has a loading phase, an error phase and a ready phase', () => {
  assert.equal(panelOf(null, null, false, NOW, 'en').phase, 'loading');
  const failed = panelOf(null, 'The service did not answer.', false, NOW, 'en');
  assert.equal(failed.phase, 'error');
  assert.deepEqual(failed.error, { title: 'Checks didn’t load', message: 'The service did not answer.' });
  assert.equal(panelOf(response(), null, false, NOW, 'en').phase, 'ready');
});

test('a failed refresh keeps the older answer and says the refresh failed', () => {
  const view = panelOf(response({ static: [ERR] }), 'The service did not answer.', false, NOW, 'en');
  assert.equal(view.phase, 'ready');
  assert.equal(view.error?.title, 'Checks didn’t refresh');
  assert.equal(view.groups.length, 1);
});

test('the summary counts errors and warnings in words and mentions notes', () => {
  const summary = (over: Over) => panelOf(response(over), null, false, NOW, 'en').summary;
  assert.equal(summary({ static: [] }), 'No errors or warnings.');
  assert.equal(summary({ static: [ERR] }), '1 error.');
  assert.equal(summary({ static: [ERR, ERR2, WARN] }), '2 errors, 1 warning.');
  assert.equal(summary({ static: [WARN, NOTE] }), '1 warning. 1 note.');
  assert.equal(summary({ static: [NOTE] }), 'No errors or warnings. 1 note.');
});

test('Ask the agent to fix is disabled exactly when there is nothing counted to fix', () => {
  assert.equal(panelOf(response({ static: [NOTE] }), null, false, NOW, 'en').ask.disabled, true);
  assert.equal(panelOf(response({ static: [WARN] }), null, false, NOW, 'en').ask.disabled, false);
  // Older rendering findings are not counted, so they do not enable it.
  const overflow = finding('overflow-x', { file: 's.html', viewport: 'phone', params: { px: 452, width: 390 } });
  assert.equal(panelOf(response({ state: 'stale', render: [overflow] }), null, false, NOW, 'en').ask.disabled, true);
});

test('the filled button is the next step: Ask when there is something to fix, Check rendering when there is not', () => {
  const primary = (over: Over, running = false) => panelOf(response(over), null, running, NOW, 'en').primary;
  assert.equal(primary({ static: [ERR] }), 'ask');
  assert.equal(primary({ static: [WARN], canRun: false }), 'ask');
  assert.equal(primary({ static: [ERR] }, true), 'ask');
  assert.equal(primary({ static: [], state: 'none' }), 'run');
  assert.equal(primary({ static: [NOTE], state: 'fresh' }), 'run');
  assert.equal(primary({ static: [], canRun: false }), null);
  assert.equal(primary({ static: [], state: 'none' }, true), null);
  assert.equal(panelOf(null, null, false, NOW, 'en').primary, null);
});

test('Check rendering: shown when a run can start or is going, named by whether it ran before', () => {
  const run = (over: Over, running = false) => panelOf(response(over), null, running, NOW, 'en').run;
  assert.deepEqual(run({ state: 'none' }), { visible: true, label: 'Check rendering', busy: false });
  assert.deepEqual(run({ state: 'fresh' }), { visible: true, label: 'Check again', busy: false });
  assert.deepEqual(run({ state: 'stale' }), { visible: true, label: 'Check again', busy: false });
  assert.deepEqual(run({ state: 'none', canRun: false }), { visible: false, label: 'Check rendering', busy: false });
  assert.deepEqual(run({ state: 'running', canRun: false }), { visible: true, label: 'Check rendering', busy: true });
  assert.deepEqual(run({ state: 'fresh', canRun: false }, true), { visible: true, label: 'Check rendering', busy: true });
});

test('clean files with an unknown rendering point at the next step; otherwise there is none', () => {
  const next = (over: Over) => panelOf(response(over), null, false, NOW, 'en').nextStep;
  assert.equal(next({ state: 'none' }), 'Check rendering to look at every screen at its size.');
  assert.equal(next({ state: 'stale' }), 'Check rendering to look at every screen at its size.');
  assert.equal(next({ state: 'fresh' }), null);
  assert.equal(next({ state: 'none', canRun: false }), null);
  assert.equal(next({ state: 'none', static: [ERR] }), null);
});

test('a finished run is announced in words', () => {
  assert.equal(runResultOf(response({ state: 'fresh' })), 'Rendering check finished. No issues.');
  assert.equal(runResultOf(response({ state: 'fresh', static: [ERR, WARN] })), 'Rendering check finished. 2 issues.');
  assert.equal(runResultOf(response({ state: 'fresh', static: [ERR] })), 'Rendering check finished. 1 issue.');
  assert.equal(runResultOf(response({ state: 'failed' })), 'The rendering check failed.');
  assert.equal(runResultOf(response({ state: 'unavailable' })), 'No browser was found, so the rendering was not checked.');
});

// ---- live updates ----

test('only changes to this design, a root change or a reset refetch the checks', () => {
  const batch = (events: Array<{ slug: string | null; kind: string }>, reset = false) => ({ reset, events });
  for (const kind of ['files', 'design', 'checks', 'added']) assert.equal(shouldRefetch(batch([{ slug: 'a', kind }]), 'a'), true, kind);
  for (const kind of ['comments', 'thumb', 'versions', 'removed', 'loose']) assert.equal(shouldRefetch(batch([{ slug: 'a', kind }]), 'a'), false, kind);
  assert.equal(shouldRefetch(batch([{ slug: 'b', kind: 'files' }]), 'a'), false);
  assert.equal(shouldRefetch(batch([{ slug: null, kind: 'root' }]), 'a'), true);
  assert.equal(shouldRefetch(batch([], true), 'a'), true);
  assert.equal(shouldRefetch(batch([{ slug: 'b', kind: 'comments' }, { slug: 'a', kind: 'checks' }]), 'a'), true);
});
