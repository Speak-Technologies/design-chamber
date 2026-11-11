// View-model of the Tweaks panel (Phase 2 feature 09, technical design §4.6): which body the panel shows,
// what each knob row reads and why it is off, the footer's buttons and its one note, the banners, the
// rail sheet's variant and height, and the leave decision. No DOM, so the rules are tested without one.
// The controller (`src/guest/tweaks.ts`) holds the state and does the work; this turns its state into
// words and flags. The service decides again at every write: everything here saves the user a try.

import type { TweaksState } from '../../guest/tweaks.ts';
import type { TweakState } from '../../shared/api.ts';
import { formatTweakNumber, tweakStateSentence } from '../../shared/tokens-css.ts';
import type { Tweak } from '../../shared/types.ts';
import { AGENT_WORKING_LINE } from './edit-text-model.ts';

// ---- copy ----

export const TWEAKS_TITLE = 'Tweaks';
export const TWEAKS_SUBTITLE = 'Change a value to preview it. Save writes the values to tokens.css.';
export const UNSAVED_BADGE = 'Unsaved';
export const TWEAKS_VIEWING_TEXT = "You're viewing an old version.";
/** The ⋯ menu entry of a design with no knobs: it fills the ask bar and sends nothing. */
export const ASK_FOR_TWEAKS_LABEL = 'Ask for tweaks';
export const ASK_FOR_TWEAKS_TEXT = 'Add tweaks for this design (accent hue, density, type scale, radius).';
export const TOKENS_LOADING_TEXT = 'Reading tokens.css…';
export const NOTHING_TO_SAVE_TEXT = 'Nothing to save yet.';
export const NO_TOKENS_TEXT = 'This design has no tokens.css.';
export const TOKENS_READ_ONLY_TEXT = "tokens.css can't be edited here. Ask the agent instead.";
export const VALUES_KEPT_TEXT = 'Your unsaved values are kept.';
export const DESIGN_GONE_TEXT = 'That design is no longer in your Designs folder. Your unsaved values were:';
export const PREVIEW_NOTE = "The preview shows this value everywhere; saved, it applies only where tokens.css doesn't set it again.";
export const STALE_TITLE = 'tokens.css changed since you started.';
export const STALE_BODY = 'Your values are still shown.';
export const STALE_SAVE_TITLE = 'Choose Apply to the new file or Discard my tweaks first.';
export const SAVED_SENTENCE = 'Tweaks saved to tokens.css';
export const LEAVE_TITLE = 'Save your tweaks?';
export const LEAVE_BODY = "Your tweak values aren't saved to tokens.css yet.";

export const readFailedText = (message: string): string => `Couldn't read tokens.css. ${message}`;

/** The sentence under the footer when a save did not go through. A stale or gone refusal already says everything. */
export const saveFailedText = (error: { code: string; message: string }): string =>
  error.code === 'stale' || error.code === 'not-found' ? error.message : `Couldn't save your tweaks. ${error.message} Your values are still here.`;

export const tweaksButtonLabel = (dirty: boolean): string => (dirty ? 'Tweaks, unsaved changes' : 'Tweaks');

// ---- the rail sheet ----

/** Below this host height the rail sheet is full height: half of it would leave no room for a slider and a footer. */
export const TWEAKS_SHEET_MIN_HOST_HEIGHT = 560;

/** The rail opens Tweaks as a bottom sheet (wall visible above) when it is tall enough, else as a full sheet. Chosen at open only. */
export const tweaksSheetVariant = (hostHeight: number): 'bottom' | 'full' => (hostHeight < TWEAKS_SHEET_MIN_HOST_HEIGHT ? 'full' : 'bottom');

/** The bottom sheet's height cap: half the host. */
export const bottomSheetMax = (hostHeight: number): number => Math.max(0, Math.floor(hostHeight / 2));

// ---- which body ----

export type PanelMode = 'loading' | 'error' | 'gone' | 'rows';

export const panelMode = (state: TweaksState): PanelMode => {
  if (state.gone || state.saveError?.code === 'not-found') return 'gone';
  if (state.status === 'error') return 'error';
  if (state.tokens === null) return 'loading';
  return 'rows';
};

export type PanelBanner =
  | { kind: 'viewing'; title: string }
  | { kind: 'no-tokens'; title: string }
  | { kind: 'not-editable'; title: string }
  | { kind: 'stale'; title: string; body: string };

export type PanelContext = { viewing: boolean };

/** The banners above the rows, in the order they matter. */
export const panelBanners = (state: TweaksState, tweaks: readonly Tweak[], context: PanelContext): PanelBanner[] => {
  const banners: PanelBanner[] = [];
  if (context.viewing) banners.push({ kind: 'viewing', title: TWEAKS_VIEWING_TEXT });
  if (state.tokens !== null && !state.tokens.exists) banners.push({ kind: 'no-tokens', title: NO_TOKENS_TEXT });
  else if (state.tokens !== null && !state.tokens.editable) banners.push({ kind: 'not-editable', title: TOKENS_READ_ONLY_TEXT });
  if (state.stale) {
    const labelOf = (name: string): string => tweaks.find((knob) => knob.var === name)?.label ?? name;
    const left = state.staleExcluded.map(labelOf);
    banners.push({ kind: 'stale', title: STALE_TITLE, body: left.length === 0 ? STALE_BODY : `${STALE_BODY} ${left.join(', ')} can't be applied to the new file and will be left out.` });
  }
  return banners;
};

// ---- knob rows ----

export type KnobRow = {
  var: string;
  label: string;
  kind: 'number' | 'choice';
  /** The control cannot be changed now (saving, an old version, the file unreadable, the knob broken). */
  disabled: boolean;
  /** Why this knob is broken in the file (its own sentence); null when it is fine. */
  reason: string | null;
  /** The user moved it and has not saved. */
  changed: boolean;
  valueText: string;
  number: { min: number; max: number; step: number; value: number } | null;
  /** `active` is '' when no option matches (the file sets another value). */
  choice: { options: { id: string; label: string }[]; active: string } | null;
  /** Muted lines under the control (another value in the file, another context also sets this var). */
  notes: string[];
};

const NO_VALUE = '–';

const numberText = (value: number, tweak: Extract<Tweak, { kind: 'number' }>): string => `${formatTweakNumber(value, tweak.step)}${tweak.unit === '' ? '' : ` ${tweak.unit}`}`;

/** Context-qualifier line for a var some other rule also sets, `alsoSet` as the service lists it. */
export const alsoSetNote = (contexts: readonly string[]): string => `Also set for ${contexts.join(', ')}; only the default changes.`;

const knobRow = (tweak: Tweak, file: TweakState | undefined, state: TweaksState, locked: boolean, fileProblem: boolean): KnobRow => {
  const pending = state.pending.get(tweak.var);
  const fileValue = file?.value ?? null;
  const brokenState = file !== undefined && file.state !== 'ok' && file.state !== 'value';
  // With no readable file the rows carry no reason of their own: the banner or the load-failed line says it once.
  const reason = !fileProblem && brokenState && file ? tweakStateSentence(file, tweak) : null;
  const disabled = locked || brokenState;
  const changed = pending !== undefined;
  const notes: string[] = [];
  if (file && file.alsoSet.length > 0 && !brokenState) notes.push(alsoSetNote(file.alsoSet), PREVIEW_NOTE);

  if (tweak.kind === 'number') {
    const current = typeof pending === 'number' ? pending : typeof fileValue === 'number' ? fileValue : null;
    return {
      var: tweak.var,
      label: tweak.label,
      kind: 'number',
      disabled,
      reason,
      changed,
      valueText: current === null ? NO_VALUE : numberText(current, tweak),
      number: { min: tweak.min, max: tweak.max, step: tweak.step, value: current ?? (tweak.min + tweak.max) / 2 },
      choice: null,
      notes,
    };
  }
  const current = typeof pending === 'string' ? pending : typeof fileValue === 'string' ? fileValue : null;
  const options = tweak.options.map((option) => ({ id: option.value, label: option.label }));
  const match = options.find((option) => option.id === current);
  // A plain value that is none of the options: nothing is pressed, and the file's own value is named.
  if (current !== null && match === undefined && file?.state === 'value' && !changed) notes.unshift(`tokens.css sets another value: ${current}`);
  return {
    var: tweak.var,
    label: tweak.label,
    kind: 'choice',
    disabled,
    reason,
    changed,
    valueText: match?.label ?? (current ?? NO_VALUE),
    number: null,
    choice: { options, active: match?.id ?? '' },
    notes,
  };
};

/** Every row the panel draws for the design's knobs, from the controller's state. */
export const knobRows = (tweaks: readonly Tweak[], state: TweaksState, context: PanelContext): KnobRow[] => {
  const tokens = state.tokens;
  const fileProblem = tokens === null || !tokens.exists || !tokens.editable;
  const locked = context.viewing || state.status !== 'ready' || state.gone || fileProblem;
  return tweaks.map((tweak) => knobRow(tweak, tokens?.knobs.find((knob) => knob.var === tweak.var), state, locked, fileProblem));
};

/** One line per pending knob, for the design-gone banner ("Accent hue: 250"). */
export const unsavedLines = (tweaks: readonly Tweak[], state: TweaksState): string[] =>
  tweaks.flatMap((tweak) => {
    const value = state.pending.get(tweak.var);
    if (value === undefined) return [];
    if (tweak.kind === 'number') return [`${tweak.label}: ${typeof value === 'number' ? numberText(value, tweak) : String(value)}`];
    return [`${tweak.label}: ${tweak.options.find((option) => option.value === value)?.label ?? String(value)}`];
  });

// ---- footer ----

export type FootNote = { tone: 'error' | 'warning' | 'muted'; text: string };

export type FootView = {
  resetDisabled: boolean;
  saveDisabled: boolean;
  saving: boolean;
  /** Why Save is off, for its tooltip; null when it is on or when the reason is self-evident. */
  saveTitle: string | null;
  note: FootNote | null;
};

export type FootContext = PanelContext & { agentWorking: boolean };

export const footView = (state: TweaksState, context: FootContext): FootView => {
  const saving = state.status === 'saving';
  const ready = state.status === 'ready' && !state.gone && state.tokens !== null;
  let saveTitle: string | null = null;
  if (context.viewing) saveTitle = TWEAKS_VIEWING_TEXT;
  else if (state.stale) saveTitle = STALE_SAVE_TITLE;
  else if (ready && !state.dirty) saveTitle = NOTHING_TO_SAVE_TEXT;
  const saveDisabled = context.viewing || !ready || !state.dirty || state.stale;
  // With tokens.css unread the values are kept but not touched: Reset waits for a good read, like every knob.
  const resetDisabled = context.viewing || !ready || !state.dirty;
  let note: FootNote | null = null;
  if (state.saveError && state.saveError.code !== 'not-found' && !(state.saveError.code === 'stale' && state.stale)) note = { tone: 'error', text: saveFailedText(state.saveError) };
  else if (context.agentWorking) note = { tone: 'warning', text: AGENT_WORKING_LINE };
  else if (ready && !state.dirty && !context.viewing) note = { tone: 'muted', text: NOTHING_TO_SAVE_TEXT };
  return { resetDisabled, saveDisabled, saving, saveTitle: saveDisabled ? saveTitle : null, note };
};

// ---- leaving ----

/** Leaving the design (back, another design): straight out, or the three-button question. */
export const leaveDecision = (state: Pick<TweaksState, 'dirty' | 'gone'>): 'leave' | 'ask' => (state.dirty && !state.gone ? 'ask' : 'leave');
