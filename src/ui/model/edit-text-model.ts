// View-model of "Edit text" (Phase 2 technical design §3.3, §3.5): whether the clicked element
// can be edited here and, when it cannot, the sentence that says why; what the editor sends and
// when that is a no-op; the sentences a refused save shows; where the toolbar and the editor
// sit. No DOM, so the rules are tested without one. The service decides again at the write
// (`src/service/edits/ops-text.ts`); everything here is advice that saves the user a try.

import type { EditTarget, SourceResponse } from '../../shared/api.ts';
import type { EditProbe } from '../../shared/bridge-protocol.ts';
import { TEXT_EDIT_MAX } from '../../shared/limits.ts';
import { decodeText, editorTextOf, locateTextTarget, scanHtml, sourceFileReason } from '../../shared/source-edit.ts';
import type { BuildPhase } from '../../guest/build-activity.ts';

// ---- Why Edit text is off ----

export type EditReason =
  | 'not-in-source'
  | 'formatted'
  | 'ambiguous'
  | 'viewing'
  | 'file-too-large'
  | 'too-long'
  | 'not-utf8'
  | 'unclear'
  | 'no-file'
  | 'link'
  | 'loading-failed';

/** §3.3: the sentence under the toolbar. `loading-failed` is built by `reasonSentence`. */
const REASON_TEXT: Record<Exclude<EditReason, 'loading-failed'>, string> = {
  'not-in-source': "This text is made by the page's script. Ask the agent to change it.",
  formatted: 'This has formatting inside. Ask the agent to change it.',
  ambiguous: "This text appears more than once and the exact one can't be found. Ask the agent to change it.",
  viewing: "You're viewing an old version.",
  'file-too-large': 'This file is too large to edit here.',
  'too-long': "That's too long to edit here. Ask the agent instead.",
  'not-utf8': "This file isn't plain UTF-8 text, so it can't be edited here. Ask the agent instead.",
  unclear: "Design Chamber can't find this text in the file exactly. Ask the agent to change it.",
  'no-file': 'Nothing to edit until the agent writes this screen.',
  link: "This file is a link, so Design Chamber can't edit it here. Ask the agent instead.",
};

export const reasonSentence = (reason: EditReason, detail?: string): string =>
  reason === 'loading-failed' ? `Couldn't read this file. ${detail ?? 'Try clicking the element again.'}`.trim() : REASON_TEXT[reason];

/** The reasons where asking the agent is the way forward (the sentence already says so, or the refusal does). */
export const ASK_AGENT_REASONS: ReadonlySet<EditReason> = new Set<EditReason>(['not-in-source', 'formatted', 'ambiguous', 'file-too-large', 'too-long', 'not-utf8', 'unclear', 'link']);

// ---- Checking one picked element ----

/** What reading the file gave: the source, or why there is none. */
export type SourceAnswer = { ok: true; source: SourceResponse } | { ok: false; kind: 'no-file' | 'failed'; message: string };

export type PickCheck =
  | {
      editable: true;
      /** sha256 of the bytes the editor text was read from: the write's `base`. */
      base: string;
      target: EditTarget;
      /** The element's text as the editor shows it (entities decoded, whitespace collapsed). */
      before: string;
      dir: 'ltr' | 'rtl';
    }
  | { editable: false; reason: EditReason; detail?: string };

const refuse = (reason: EditReason, detail?: string): PickCheck => (detail === undefined ? { editable: false, reason } : { editable: false, reason, detail });

/**
 * §3.3 order: viewing, no file, link, file too large, not UTF-8, then what the locator says about
 * this element. `probe` null means the frame did not answer (or nothing is under the point).
 */
export const checkPick = (input: { viewing: boolean; probe: EditProbe | null; source: SourceAnswer }): PickCheck => {
  if (input.viewing) return refuse('viewing');
  const { source, probe } = input;
  if (!source.ok) return source.kind === 'no-file' ? refuse('no-file') : refuse('loading-failed', source.message);
  const file = sourceFileReason({ link: source.source.link, charLength: source.source.text.length, utf8: source.source.utf8 });
  if (file !== null) return refuse(file);
  if (probe === null) return refuse('loading-failed', "The design didn't answer. Click the element again.");
  const target: EditTarget = { tag: probe.tag, id: probe.id, text: probe.text, sameIndex: probe.sameIndex, sameCount: probe.sameCount };
  const located = locateTextTarget(scanHtml(source.source.text), { ...target, leaf: probe.leaf, truncated: probe.truncated });
  if ('reason' in located) return refuse(located.reason);
  const decoded = decodeText(source.source.text, located.element.inner[0], located.element.inner[1]);
  if (decoded === null) return refuse('unclear');
  return { editable: true, base: source.source.sha256, target, before: editorTextOf(decoded).text, dir: probe.dir };
};

// ---- What the editor sends ----

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g;

/**
 * The typed text the way the write wants it (§3.4 step 3 and the service's literal verify): runs of
 * ASCII whitespace (pasted line breaks included) become one space, the ends are trimmed of ASCII
 * whitespace only (a non-breaking space stays), and stray control characters are dropped.
 */
export const normalizeTyped = (typed: string): string => typed.replace(CONTROL_CHARS, '').replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');

export type SaveDecision = { kind: 'unchanged' } | { kind: 'too-long'; length: number } | { kind: 'save'; after: string };

/** Enter or Save: nothing to do when the words did not change, a refusal when over the limit, else the text to send. */
export const saveDecision = (before: string, typed: string): SaveDecision => {
  const after = normalizeTyped(typed);
  if (after === before) return { kind: 'unchanged' };
  if (after.length > TEXT_EDIT_MAX) return { kind: 'too-long', length: after.length };
  return { kind: 'save', after };
};

/** Whether leaving now would lose words: what the click-away rule asks. */
export const hasChange = (before: string, typed: string): boolean => normalizeTyped(typed) !== before;

// ---- The character counter (§3.5) ----

export const COUNTER_NEAR = 4500;
export type CounterState = 'none' | 'near' | 'over';

/** Hidden under 4 500 characters, a plain count from there, an error past the limit. Lengths are of the typed text. */
export const counterState = (length: number): CounterState => (length > TEXT_EDIT_MAX ? 'over' : length >= COUNTER_NEAR ? 'near' : 'none');

export const counterText = (length: number, state: CounterState): string =>
  state === 'over' ? `${TEXT_EDIT_MAX.toLocaleString()} characters at most` : `${length.toLocaleString()} / ${TEXT_EDIT_MAX.toLocaleString()}`;

/** The screen reader hears the counter only when it crosses 4 500 and 5 000, not on every key. */
export const counterAnnouncement = (previous: CounterState, next: CounterState): string | null => {
  if (next === previous) return null;
  if (next === 'near') return previous === 'none' ? 'Close to the limit of 5,000 characters.' : null;
  if (next === 'over') return 'Over the limit of 5,000 characters. Shorten the text to save.';
  return null;
};

// ---- Copy ----

export const KEY_HINT = 'Enter to save · Esc to cancel';
export const CLICK_AWAY_LINE = 'Press Enter to save or Esc to discard.';
export const AGENT_WORKING_LINE = 'The agent is working on this design. It may write over your edit.';
export const STALE_TEXT = 'This file changed while you were editing. Nothing was saved.';

/** E11: the hint shows while the linked agent is writing, working or retrying. */
export const agentIsWorking = (phase: BuildPhase): boolean => phase === 'working' || phase === 'writing' || phase === 'retrying';

/** `aria-label` of the toolbar: the tag and the first 40 characters of its text. */
export const toolbarName = (tag: string, text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const clipped = flat.length > 40 ? `${flat.slice(0, 39).trimEnd()}…` : flat;
  return clipped === '' ? `Actions for ${tag}` : `Actions for ${tag} '${clipped}'`;
};

/** The notice after an undo went through. */
export const UNDONE_TEXT = 'Undone';

// ---- A refused save ----

/** Codes the service answers with its own user-facing sentence (§2.8); anything else is a host or network failure. */
const SERVICE_SENTENCE_CODES: ReadonlySet<string> = new Set(['bad-request', 'bad-path', 'bad-slug', 'not-found', 'conflict', 'stale', 'too-large', 'no-html', 'invalid', 'internal']);

export type Refusal = {
  /** The sentence under the textarea. */
  text: string;
  /** Show **Reload and try again**. */
  stale: boolean;
  /** Show **Ask agent**: the file will not take this edit however often it is tried. */
  askAgent: boolean;
};

/**
 * §2.8: a 409 stale keeps the exact sentence and offers a reload; the service's own sentences
 * (too large, not UTF-8, a link, not found) go through as written; a failure to reach the service
 * says so and that the text is still here. A write refused for the file itself (413, 422) offers Ask agent.
 */
export const refusalOf = (error: { code: string; message: string; status?: number | null }): Refusal => {
  if (error.code === 'stale') return { text: STALE_TEXT, stale: true, askAgent: false };
  if (SERVICE_SENTENCE_CODES.has(error.code)) {
    const fileRefusal = error.status === 413 || error.status === 422 || error.code === 'too-large' || error.code === 'invalid';
    // A write that failed on the disk or in the service (500, a busy file) changed nothing: say the text is still in the box.
    const keeps = error.code === 'internal' || error.code === 'conflict';
    return { text: keeps ? `${error.message} Your text is still here.` : error.message, stale: false, askAgent: fileRefusal };
  }
  return { text: `Couldn't save your change. ${error.message} Your text is still here.`, stale: false, askAgent: false };
};

/** After Reload and try again: what the editor does with the fresh check. */
export type ReloadOutcome =
  | { kind: 'ready'; check: Extract<PickCheck, { editable: true }>; fileNowSays: string | null }
  | { kind: 'gone'; sentence: string };

/**
 * Keep the user's text and adopt the new base and before. When the file's own text of the element
 * changed meanwhile, say what it reads now (§3.5). When the element is gone, the reason takes the hint's place.
 */
export const reloadOutcome = (previousBefore: string, check: PickCheck): ReloadOutcome => {
  if (!check.editable) return { kind: 'gone', sentence: reasonSentence(check.reason, check.detail) };
  return { kind: 'ready', check, fileNowSays: check.before === previousBefore ? null : check.before };
};

// ---- Where the toolbar and the editor sit ----

export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** The toolbar's labels give way to icons when the stage is narrower than this (§3.5). */
export const TOOLBAR_ICONS_BELOW = 300;
export const toolbarLabels = (stageWidth: number): boolean => stageWidth >= TOOLBAR_ICONS_BELOW;

const EDGE = 8;
const GAP = 6;
/** The element's box this close to the viewer's top edge puts the toolbar below it (§3.5). */
const FLIP_WITHIN = 48;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, Math.max(low, high)));

export type ToolbarPlace = { left: number; top: number; below: boolean };

/** Above the element, left edges aligned; below when there is no room above; always inside the stage. */
export const placeToolbar = (box: Box, size: Size, stage: Size): ToolbarPlace => {
  const below = box.y < Math.max(FLIP_WITHIN, size.h + GAP + EDGE);
  const top = below ? box.y + box.h + GAP : box.y - size.h - GAP;
  return { left: clamp(box.x, EDGE, stage.w - size.w - EDGE), top: clamp(top, EDGE, stage.h - size.h - EDGE), below };
};

/** §3.5: the page card follows the element's width between 260 and 480 px; the rail card is the element's width, at least 240, inside the stage. */
export const editorWidth = (input: { surface: 'page' | 'rail'; boxWidth: number; stageWidth: number }): number =>
  input.surface === 'page' ? clamp(Math.round(input.boxWidth), 260, 480) : Math.min(input.stageWidth - 2 * EDGE, Math.max(240, Math.round(input.boxWidth)));

/** Over the element, its top edge at the element's top; the rail card is pinned to the stage's side margins. */
export const placeEditor = (box: Box, size: Size, stage: Size, surface: 'page' | 'rail'): { left: number; top: number } => ({
  left: surface === 'rail' ? EDGE : clamp(box.x, EDGE, stage.w - size.w - EDGE),
  top: clamp(box.y, EDGE, stage.h - size.h - EDGE),
});

// ---- Reading the file ----

/** Settles with what reading the source gave, never rejects: a missing screen and a failed read are different sentences. */
export const answerSource = async (read: () => Promise<SourceResponse>): Promise<SourceAnswer> => {
  try {
    return { ok: true, source: await read() };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const message = error instanceof Error && error.message !== '' ? error.message : 'Try clicking the element again.';
    return code === 'no-html' || code === 'not-found' ? { ok: false, kind: 'no-file', message } : { ok: false, kind: 'failed', message };
  }
};
