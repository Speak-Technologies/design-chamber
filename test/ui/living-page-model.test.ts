import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LivingPageState, SystemDetail } from '../../src/shared/types.ts';
import {
  livingCard,
  omittedLines,
  previewBand,
  previewTarget,
  problemReason,
  type LivingContext,
  type LivingRepoView,
} from '../../src/ui/model/living-page-model.ts';

const NOW = Date.parse('2026-11-20T10:00:00.000Z');
const OPTIONS = { now: NOW, locale: 'en' };

const context = (patch: Partial<LivingContext> = {}): LivingContext => ({
  name: 'Acme',
  revision: 7,
  home: { kind: 'repo', directory: '/work/shop', label: 'shop', folder: 'design-system', livingPage: 'design-system/index.html', readable: true, problem: null, lastRead: null },
  build: null,
  proposal: null,
  ...patch,
});

const view = (state: LivingPageState, patch: Partial<LivingRepoView> = {}): LivingRepoView => ({
  home: 'repo',
  path: 'design-system/index.html',
  absolute: '/work/shop/design-system/index.html',
  staged: { revision: 7, bytes: 412_000, omitted: [], problem: null, fonts: 'embedded', secrets: [], preview: null },
  committed: { state, revision: state === 'out-of-date' ? 5 : 7, sentence: '', reasons: [] },
  repoReadable: true,
  embedFonts: false,
  ...patch,
});

const ids = (card: ReturnType<typeof livingCard>): string[] => card.actions.map((action) => action.id);

test('every committed state has its label, tone, sentence and actions', () => {
  const table: [LivingPageState, string, string, string, string[]][] = [
    ['fresh', 'Up to date', 'success', 'Generated from revision 7, the current one.', ['preview', 'reveal']],
    ['out-of-date', 'Out of date', 'warning', 'Generated from revision 5; Acme is at revision 7.', ['ask', 'preview', 'reveal']],
    ['missing', 'Not in shop yet', 'warning', 'No living page in shop yet.', ['ask', 'preview']],
    ['changed', 'Changed in shop', 'warning', 'The page in shop differs from the one Design Chamber generated.', ['ask', 'preview', 'reveal']],
    ['reformatted', 'Reformatted', 'info', 'The living page may have been reformatted since it was generated. Its values are from revision 7, the current one.', ['preview', 'reveal']],
    ['unsafe', 'Can’t check as safe', 'error', 'The living page has markup Design Chamber didn’t generate and can’t check as safe.', ['ask', 'reveal']],
    ['unreadable', 'Can’t read', 'error', '', ['reveal']],
  ];
  for (const [state, label, tone, sentence, actions] of table) {
    const card = livingCard(view(state, state === 'unreadable' ? { committed: { state, revision: null, sentence: 'Design Chamber can\'t read the living page: it is a folder.', reasons: [] } } : {}), context(), OPTIONS);
    assert.equal(card.label, label, state);
    assert.equal(card.tone, tone, state);
    assert.equal(card.sentence, state === 'unreadable' ? 'Design Chamber can’t read the living page: it is a folder.' : sentence, state);
    assert.deepEqual(ids(card), actions, state);
  }
});

test('a staged problem reads Couldn’t generate and offers the fix, with the plain ask off', () => {
  const staged = { revision: 7, bytes: 0, omitted: [], problem: 'too-large', fonts: 'fallback' as const, secrets: [], preview: null };
  const card = livingCard(view('fresh', { staged }), context(), OPTIONS);
  assert.equal(card.kind, 'problem');
  assert.equal(card.label, 'Couldn’t generate');
  assert.equal(card.tone, 'error');
  assert.equal(card.sentence, 'Design Chamber couldn’t generate the living page. It would be too large.');
  assert.deepEqual(ids(card), ['fix', 'ask']);
  assert.equal(card.actions[0]?.label, 'Ask the agent to fix it');
  assert.equal(card.actions[0]?.enabled, true);
  assert.equal(card.actions[1]?.enabled, false);
  assert.ok(card.actions[1]?.why);
});

test('an unknown problem code is never shown raw', () => {
  assert.equal(problemReason('weird-code'), 'Something went wrong.');
});

test('the missing state says it is waiting only within 30 seconds of an apply', () => {
  const applied = (at: string): LivingContext['build'] => ({ mode: 'none', dark: false, calls: [], access: 'public', round: 'done', applied: { at: at as never, parts: [], skipped: [] } });
  const soon = livingCard(view('missing'), context({ build: applied('2026-11-20T09:59:45.000Z') }), OPTIONS);
  assert.equal(soon.sentence, 'No living page in shop yet. Design Chamber is waiting for the agent to commit it.');
  const later = livingCard(view('missing'), context({ build: applied('2026-11-20T09:58:00.000Z') }), OPTIONS);
  assert.equal(later.sentence, 'No living page in shop yet.');
});

test('the unsafe state lists at most three reasons', () => {
  const card = livingCard(view('unsafe', { committed: { state: 'unsafe', revision: 7, sentence: '', reasons: ['a', 'b', 'c', 'd'] } }), context(), OPTIONS);
  assert.deepEqual(card.reasons, ['a', 'b', 'c']);
});

test('the path line gives the path, the staged size and the staged revision', () => {
  const card = livingCard(view('fresh'), context(), OPTIONS);
  assert.equal(card.pathLine, 'design-system/index.html · 412 kB · rev 7');
  const none = livingCard(view('missing', { staged: null }), context(), OPTIONS);
  assert.equal(none.pathLine, 'design-system/index.html');
});

test('left-out items are counted by kind and reason', () => {
  assert.deepEqual(omittedLines([{ what: 'font', name: 'Big.woff2', reason: 'too-large' }]), ['1 font wasn’t embedded: too large.']);
  assert.deepEqual(
    omittedLines([
      { what: 'font', name: 'A', reason: 'too-large' },
      { what: 'font', name: 'B', reason: 'too-large' },
      { what: 'logo', name: 'C', reason: 'unsafe' },
    ]),
    ['2 fonts weren’t embedded: too large.', '1 logo wasn’t embedded: not safe to embed.'],
  );
});

test('a secret shape adds the warning line and never the value', () => {
  const staged = { revision: 7, bytes: 10, omitted: [], problem: null, fonts: 'embedded' as const, secrets: [{ kind: 'aws-key', where: 'brand/press' }], preview: null };
  const card = livingCard(view('fresh', { staged }), context(), OPTIONS);
  assert.equal(card.secretLine, 'The page shows something shaped like a secret (an AWS key in brand/press). Remove it before anyone else sees the page.');
  assert.equal(livingCard(view('fresh'), context(), OPTIONS).secretLine, null);
});

test('the Embed fonts switch is absent for a dev page and carries the help line otherwise', () => {
  const dev = livingCard(view('fresh'), context({ build: { mode: 'none', dark: false, calls: [], access: 'dev', round: 'done', applied: null } }), OPTIONS);
  assert.equal(dev.fonts, null);
  const pub = livingCard(view('fresh', { embedFonts: true }), context({ build: { mode: 'none', dark: false, calls: [], access: 'public', round: 'done', applied: null } }), OPTIONS);
  assert.equal(pub.fonts?.checked, true);
  assert.equal(pub.fonts?.help, 'Turn on only if the fonts’ licences allow publishing them.');
  assert.equal(livingCard(view('fresh'), context(), OPTIONS).fonts?.checked, false);
});

test('regenerating turns the changing actions and the switch off', () => {
  const card = livingCard(view('out-of-date'), context(), { ...OPTIONS, regenerating: true });
  assert.equal(card.regenerating, true);
  assert.equal(card.fonts?.disabled, true);
  assert.equal(card.actions.find((action) => action.id === 'ask')?.enabled, false);
  assert.equal(card.actions.find((action) => action.id === 'reveal')?.enabled, true);
});

test('a locked page keeps Reveal and gives the reason on the rest', () => {
  const card = livingCard(view('out-of-date'), context(), { ...OPTIONS, locked: 'An old version is open.' });
  assert.equal(card.actions.find((action) => action.id === 'ask')?.why, 'An old version is open.');
  assert.equal(card.actions.find((action) => action.id === 'reveal')?.enabled, true);
});

test('a repo that can’t be read turns the ask off with that reason and keeps Preview and Reveal', () => {
  const card = livingCard(view('out-of-date', { repoReadable: false }), context(), OPTIONS);
  const ask = card.actions.find((action) => action.id === 'ask');
  assert.equal(ask?.enabled, false);
  assert.equal(ask?.why, 'The repo can’t be read.');
  assert.equal(card.actions.find((action) => action.id === 'preview')?.enabled, true);
});

test('preview opens the proposal’s page while a proposal waits, else the staged one', () => {
  const staged = { revision: 7, bytes: 1, omitted: [], problem: null, fonts: 'embedded' as const, secrets: [], preview: { proposal: 'p_abc', problem: null } };
  const proposal: SystemDetail['proposal'] = { id: 'p_abc', state: 'current' };
  assert.deepEqual(previewTarget(view('fresh', { staged }), { proposal }), { which: 'preview', proposal: 'p_abc' });
  assert.deepEqual(previewTarget(view('fresh', { staged }), { proposal: null }), { which: 'staged', proposal: null });
  assert.equal(previewTarget(view('missing', { staged: null }), { proposal: null }), null);
  assert.equal(previewBand({ which: 'preview', proposal: 'p_abc' }), 'Preview of proposal p_abc');
});

test('no card copy uses an em dash', () => {
  for (const state of ['fresh', 'out-of-date', 'missing', 'changed', 'reformatted', 'unsafe'] as LivingPageState[]) {
    const card = livingCard(view(state), context(), OPTIONS);
    const text = [card.label, card.sentence, card.pathLine, ...card.actions.map((action) => action.label)].join(' ');
    assert.ok(!text.includes('\u2014'), state);
  }
});
