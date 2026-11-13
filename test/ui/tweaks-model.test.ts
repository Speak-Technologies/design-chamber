import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TweaksState } from '../../src/guest/tweaks.ts';
import type { TokensResponse, TweakState } from '../../src/shared/api.ts';
import type { Tweak } from '../../src/shared/types.ts';
import {
  alsoSetNote,
  bottomSheetMax,
  footView,
  knobRows,
  leaveDecision,
  NOTHING_TO_SAVE_TEXT,
  panelBanners,
  panelMode,
  PREVIEW_NOTE,
  readFailedText,
  saveFailedText,
  STALE_SAVE_TITLE,
  tweaksButtonLabel,
  tweaksSheetVariant,
  unsavedLines,
  type PanelContext,
} from '../../src/ui/model/tweaks-model.ts';

const HUE: Tweak = { var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '' };
const RADIUS: Tweak = { var: '--radius', label: 'Corner radius', kind: 'number', min: 0, max: 24, step: 2, unit: 'px' };
const DENSITY: Tweak = {
  var: '--density',
  label: 'Density',
  kind: 'choice',
  options: [
    { label: 'Compact', value: '0.85' },
    { label: 'Comfortable', value: '1' },
    { label: 'Roomy', value: '1.2' },
  ],
};
const TWEAKS = [HUE, RADIUS, DENSITY];

const knob = (over: Partial<TweakState> & Pick<TweakState, 'var'>): TweakState => ({ state: 'ok', value: null, fileUnit: null, alsoSet: [], ...over });
const FILE: TweakState[] = [knob({ var: '--accent-h', value: 210 }), knob({ var: '--radius', value: 8, fileUnit: 'px' }), knob({ var: '--density', value: '1' })];
const tokens = (knobs: TweakState[] = FILE, over: Partial<TokensResponse> = {}): TokensResponse => ({ exists: true, editable: true, sha256: 'a'.repeat(64), knobs, ...over });

const state = (over: Partial<TweaksState> = {}): TweaksState => ({
  status: 'ready',
  tokens: tokens(),
  loadError: null,
  pending: new Map(),
  dirty: false,
  stale: false,
  staleExcluded: [],
  gone: false,
  saveError: null,
  ...over,
});
const dirty = (pending: Array<[string, number | string]>, over: Partial<TweaksState> = {}): TweaksState => state({ pending: new Map(pending), dirty: pending.length > 0, ...over });
const CURRENT: PanelContext = { viewing: false };
const rowOf = (s: TweaksState, name: string, context: PanelContext = CURRENT) => {
  const row = knobRows(TWEAKS, s, context).find((entry) => entry.var === name);
  assert.ok(row, `a row for ${name}`);
  return row;
};

// ---- the rail sheet ----

test('the rail opens a bottom sheet from 560 px of height and a full sheet below it', () => {
  assert.equal(tweaksSheetVariant(559), 'full');
  assert.equal(tweaksSheetVariant(560), 'bottom');
  assert.equal(tweaksSheetVariant(900), 'bottom');
});

test('the bottom sheet is capped at half the host, in whole px', () => {
  assert.equal(bottomSheetMax(900), 450);
  assert.equal(bottomSheetMax(561), 280);
  assert.equal(bottomSheetMax(-4), 0);
});

// ---- which body ----

test('the body follows the controller: loading until a first answer, the load-failed block, the design-gone block, then rows', () => {
  assert.equal(panelMode(state({ status: 'loading', tokens: null })), 'loading');
  assert.equal(panelMode(state({ status: 'error', tokens: null })), 'error');
  assert.equal(panelMode(state({ gone: true })), 'gone');
  assert.equal(panelMode(state()), 'rows');
  // A reload while rows are on show keeps them (no flash of the loading row).
  assert.equal(panelMode(state({ status: 'loading' })), 'rows');
});

test('a save that finds the design gone shows the design-gone block too', () => {
  assert.equal(panelMode(state({ saveError: { name: 'ServiceError', message: 'gone', code: 'not-found', status: 404 } as TweaksState['saveError'] })), 'gone');
});

test('banners: viewing, then the file problem, then the stale one', () => {
  const all = panelBanners(state({ stale: true, staleExcluded: ['--radius'], tokens: tokens(FILE, { editable: false }) }), TWEAKS, { viewing: true });
  assert.deepEqual(
    all.map((entry) => entry.kind),
    ['viewing', 'not-editable', 'stale'],
  );
  const stale = all.find((entry) => entry.kind === 'stale');
  assert.ok(stale && stale.kind === 'stale');
  assert.match(stale.body, /Your values are still shown\. Corner radius can't be applied to the new file/);
});

test('no tokens.css reads as one banner, not a reason on every row', () => {
  const none = state({ tokens: tokens(FILE.map((entry) => ({ ...entry, state: 'no-file', value: null })), { exists: false, editable: false, sha256: null }) });
  assert.deepEqual(panelBanners(none, TWEAKS, CURRENT).map((entry) => entry.kind), ['no-tokens']);
  const rows = knobRows(TWEAKS, none, CURRENT);
  assert.ok(rows.every((row) => row.disabled && row.reason === null));
});

// ---- rows ----

test('a number row reads the file value with its unit, and a pending value over it', () => {
  assert.equal(rowOf(state(), '--radius').valueText, '8 px');
  assert.equal(rowOf(state(), '--accent-h').valueText, '210');
  const moved = dirty([['--radius', 12]]);
  assert.equal(rowOf(moved, '--radius').valueText, '12 px');
  assert.equal(rowOf(moved, '--radius').changed, true);
  assert.equal(rowOf(moved, '--accent-h').changed, false);
  assert.deepEqual(rowOf(moved, '--radius').number, { min: 0, max: 24, step: 2, value: 12 });
});

test('a choice row presses the matching option and shows its label', () => {
  const row = rowOf(state(), '--density');
  assert.equal(row.valueText, 'Comfortable');
  assert.equal(row.choice?.active, '1');
  assert.deepEqual(row.choice?.options.map((option) => option.label), ['Compact', 'Comfortable', 'Roomy']);
});

test('a choice whose file value is none of the options presses nothing and says what the file holds', () => {
  const other = state({ tokens: tokens([...FILE.slice(0, 2), knob({ var: '--density', state: 'value', value: '1.5' })]) });
  const row = rowOf(other, '--density');
  assert.equal(row.choice?.active, '');
  assert.equal(row.valueText, '1.5');
  assert.deepEqual(row.notes, ['tokens.css sets another value: 1.5']);
  assert.equal(row.disabled, false);
});

test('a broken knob is disabled with its own reason; its neighbours stay live', () => {
  const broken = state({ tokens: tokens([knob({ var: '--accent-h', state: 'formula' }), FILE[1] as TweakState, FILE[2] as TweakState]) });
  const hue = rowOf(broken, '--accent-h');
  assert.equal(hue.disabled, true);
  assert.equal(hue.reason, 'This value is a formula. Ask the agent to change it.');
  assert.equal(hue.valueText, '–');
  assert.equal(rowOf(broken, '--radius').disabled, false);
  assert.equal(rowOf(broken, '--radius').reason, null);
});

test('a var another rule also sets gets the also-set line and the preview note', () => {
  const also = state({ tokens: tokens([FILE[0] as TweakState, knob({ var: '--radius', value: 8, fileUnit: 'px', alsoSet: ['@media (max-width: 700px)', '[data-theme=dark]'] }), FILE[2] as TweakState]) });
  assert.deepEqual(rowOf(also, '--radius').notes, ['Also set for @media (max-width: 700px), [data-theme=dark]; only the default changes.', PREVIEW_NOTE]);
  assert.equal(alsoSetNote(['@media print']), 'Also set for @media print; only the default changes.');
});

test('every row is off while saving, while an old version is on show, and when tokens.css could not be read', () => {
  assert.ok(knobRows(TWEAKS, state({ status: 'saving' }), CURRENT).every((row) => row.disabled));
  assert.ok(knobRows(TWEAKS, state(), { viewing: true }).every((row) => row.disabled));
  const failed = state({ status: 'error', tokens: null, pending: new Map([['--accent-h', 250]]), dirty: true });
  const rows = knobRows(TWEAKS, failed, CURRENT);
  assert.ok(rows.every((row) => row.disabled && row.reason === null));
  // The values the user left unsaved are kept and shown; the rest read "–".
  assert.equal(rows[0]?.valueText, '250');
  assert.equal(rows[1]?.valueText, '–');
});

test('an unreadable tokens.css that is not editable disables rows without a per-row reason', () => {
  const locked = state({ tokens: tokens(FILE, { editable: false }) });
  assert.ok(knobRows(TWEAKS, locked, CURRENT).every((row) => row.disabled && row.reason === null));
});

test('the design-gone block lists the unsaved values as Label: value', () => {
  const gone = dirty(
    [
      ['--accent-h', 250],
      ['--radius', 12],
      ['--density', '1.2'],
    ],
    { gone: true },
  );
  assert.deepEqual(unsavedLines(TWEAKS, gone), ['Accent hue: 250', 'Corner radius: 12 px', 'Density: Roomy']);
  assert.deepEqual(unsavedLines(TWEAKS, state({ gone: true })), []);
});

// ---- footer ----

test('Save and Reset are off with nothing to save, and the foot says what is missing', () => {
  const view = footView(state(), { viewing: false, agentWorking: false });
  assert.equal(view.saveDisabled, true);
  assert.equal(view.resetDisabled, true);
  assert.equal(view.saveTitle, NOTHING_TO_SAVE_TEXT);
  assert.deepEqual(view.note, { tone: 'muted', text: NOTHING_TO_SAVE_TEXT });
});

test('with unsaved values both are on, and nothing explains itself', () => {
  const view = footView(dirty([['--radius', 12]]), { viewing: false, agentWorking: false });
  assert.equal(view.saveDisabled, false);
  assert.equal(view.resetDisabled, false);
  assert.equal(view.saveTitle, null);
  assert.equal(view.note, null);
});

test('while saving Save shows progress and Reset is off', () => {
  const view = footView(dirty([['--radius', 12]], { status: 'saving' }), { viewing: false, agentWorking: false });
  assert.equal(view.saving, true);
  assert.equal(view.saveDisabled, true);
  assert.equal(view.resetDisabled, true);
});

test('a stale file turns Save off until the user chooses, and says so', () => {
  const view = footView(dirty([['--radius', 12]], { stale: true }), { viewing: false, agentWorking: false });
  assert.equal(view.saveDisabled, true);
  assert.equal(view.saveTitle, STALE_SAVE_TITLE);
  assert.equal(view.resetDisabled, false);
});

test('with tokens.css unread, Reset and Save are off even though values are kept', () => {
  const failed = footView(dirty([['--accent-h', 250]], { status: 'error', tokens: null }), { viewing: false, agentWorking: false });
  assert.equal(failed.saveDisabled, true);
  assert.equal(failed.resetDisabled, true);
});

test('an old version turns both off', () => {
  const view = footView(dirty([['--radius', 12]]), { viewing: true, agentWorking: false });
  assert.equal(view.saveDisabled, true);
  assert.equal(view.resetDisabled, true);
});

test('the foot note: a refused save outranks the agent hint, which outranks the empty note', () => {
  const refused = { name: 'ServiceError', message: 'tokens.css is a link.', code: 'invalid', status: 422 } as TweaksState['saveError'];
  const withError = footView(dirty([['--radius', 12]], { saveError: refused }), { viewing: false, agentWorking: true });
  assert.deepEqual(withError.note, { tone: 'error', text: "Couldn't save your tweaks. tokens.css is a link. Your values are still here." });
  const working = footView(state(), { viewing: false, agentWorking: true });
  assert.equal(working.note?.tone, 'warning');
  assert.equal(working.note?.text, 'The agent is working on this design. It may write over your edit.');
});

test('a stale refusal is not said twice: the banner already says it', () => {
  const stale = { name: 'ServiceError', message: 'tokens.css changed since you started. Your values are still shown.', code: 'stale', status: 409 } as TweaksState['saveError'];
  const view = footView(dirty([['--radius', 12]], { saveError: stale, stale: true }), { viewing: false, agentWorking: false });
  assert.equal(view.note, null);
});

test('sentences keep the service words and name what is kept', () => {
  assert.equal(readFailedText('The local service did not answer.'), "Couldn't read tokens.css. The local service did not answer.");
  assert.equal(saveFailedText({ code: 'stale', message: 'The tweaks in design.json changed while you were working. Nothing was saved.' }), 'The tweaks in design.json changed while you were working. Nothing was saved.');
  assert.equal(saveFailedText({ code: 'unavailable', message: 'The local service did not answer.' }), "Couldn't save your tweaks. The local service did not answer. Your values are still here.");
});

// ---- the button and leaving ----

test('the button names unsaved values', () => {
  assert.equal(tweaksButtonLabel(false), 'Tweaks');
  assert.equal(tweaksButtonLabel(true), 'Tweaks, unsaved changes');
});

test('leaving asks only when there are unsaved values and the design still exists', () => {
  assert.equal(leaveDecision({ dirty: false, gone: false }), 'leave');
  assert.equal(leaveDecision({ dirty: true, gone: false }), 'ask');
  // Nothing can be saved to a design that is gone: the user is not trapped by a question they cannot answer.
  assert.equal(leaveDecision({ dirty: true, gone: true }), 'leave');
});
