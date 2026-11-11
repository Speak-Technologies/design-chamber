// The tokens op and the tokens.css reader (Phase 2 technical design §4.2, §4.3; PS 09, E4, E5).
//
// `readTokens` answers GET /designs/:slug/tokens: every knob's state in the file as it is now,
// with the file's hash the page later sends back as `base`. `tokensOp` plans one save and writes
// nothing itself: design.json's current knobs decide which vars and values are allowed (only a
// number in the knob's range or one of its option values is ever written, so a knob cannot
// inject CSS); the file is read again here and its hash must be `base`; each value replaces
// exactly its declaration's value range in the last top-level `:root` rule, so every other byte
// (whitespace, comments, other declarations, line endings, a BOM) stays; the result is scanned
// again before anything is planned. The changed values go out as one write (one undo step that
// spans them all) unless the run between the first and the last change is longer than an undo
// record can hold, when they are split into the fewest runs that fit.
//
// Saving tweaks never touches design.json, so `designSystem.confirmed` stays as it was (09-6).

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import type { TokensResponse, TweakState } from '../../shared/api.ts';
import { TOKENS_CSS_MAX_BYTES, TWEAK_CHOICE_VALUE_PATTERN } from '../../shared/limits.ts';
import {
  isBalancedQuotes,
  readKnobs,
  readTweakValues,
  spliceTokens,
  tweakNumberText,
  tweakStateSentence,
  verifyTokenWrite,
  type TokenChange,
} from '../../shared/tokens-css.ts';
import type { Tweak } from '../../shared/types.ts';
import type { DesignRecord } from '../context.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE, resolvePlainTarget } from '../paths.ts';
import { UNDO_REMOVED_MAX } from './file.ts';
import type { OpModule, OpPlan, PlannedStep, RequestOf } from './op-module.ts';
import { FILE_TOO_LARGE_MESSAGE, NOT_UTF8_MESSAGE } from './ops-text.ts';

export const TOKENS_FILE = 'tokens.css';

// The sentences (§2.8, §4.3). The stale one equals the pipeline's `STALE_MESSAGES.tokens` (a test
// holds them equal); it is not imported from pipeline.ts because that module imports this one.
export const TOKENS_LABEL = 'Tweaks saved to tokens.css';
export const TOKENS_STALE_MESSAGE = 'tokens.css changed since you started. Your values are still shown.';
export const TWEAKS_CHANGED_MESSAGE = 'The tweaks in design.json changed while you were working. Nothing was saved.';
export const TWEAK_VALUE_MESSAGE = "That value isn't one this tweak allows. Nothing was saved.";
export const TOKENS_CANT_WRITE_MESSAGE = "Design Chamber couldn't write these values into tokens.css exactly. Nothing was saved.";
export const TOKENS_UNCHANGED_DETAIL = 'tokens.css already had these values.';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

const stale = (): ApiError => new ApiError('stale', TOKENS_STALE_MESSAGE);

/** tokens.css as read for a request: absent, not readable here (a link, too large), or its bytes. */
type TokensFile =
  | { kind: 'absent' }
  | { kind: 'link' }
  | { kind: 'too-large' }
  | { kind: 'read'; bytes: Buffer; text: string; utf8: boolean };

/**
 * The design's tokens.css through the one plain-target check (§2.3): a link anywhere on the way,
 * inside the design or out of it, is not read; over `TOKENS_CSS_MAX_BYTES` is not read either.
 */
const readTokensFile = async (dir: string): Promise<TokensFile> => {
  let file: string;
  try {
    file = await resolvePlainTarget(dir, [TOKENS_FILE], { allowAbsent: true });
  } catch (error) {
    if (error instanceof ApiError) return { kind: 'link' };
    throw error;
  }
  try {
    if ((await stat(file)).size > TOKENS_CSS_MAX_BYTES) return { kind: 'too-large' };
    const bytes = await readFile(file);
    if (bytes.length > TOKENS_CSS_MAX_BYTES) return { kind: 'too-large' };
    const text = bytes.toString('utf8');
    return { kind: 'read', bytes, text, utf8: Buffer.from(text, 'utf8').equals(bytes) };
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
};

/**
 * Every knob's state in the design's current tokens.css (read only, §4.2). `editable` is false
 * for a missing file, a link, a file over the size cap or one that is not UTF-8; the panel then
 * disables every knob with one sentence, so the rows of a file that could not be read at all
 * (a link, too large) read as `missing` and carry no value.
 */
export const readTokens = async (record: DesignRecord, dir: string): Promise<TokensResponse> => {
  const { tweaks } = record.design;
  const file = await readTokensFile(dir);
  switch (file.kind) {
    case 'absent':
      return { exists: false, editable: false, sha256: null, knobs: readTweakValues(null, tweaks) };
    case 'link':
    case 'too-large':
      return { exists: true, editable: false, sha256: null, knobs: readTweakValues('', tweaks) };
    case 'read':
      return { exists: true, editable: file.utf8, sha256: sha256(file.bytes), knobs: readTweakValues(file.text, tweaks) };
  }
};

/** A requested value checked against its knob (§4.3 step 1); the new text tokens.css gets. */
const valueText = (tweak: Tweak, value: number | string): string => {
  if (tweak.kind === 'number') {
    // A value of the other kind means the agent changed the knob's kind since the panel read it.
    if (typeof value !== 'number') throw new ApiError('stale', TWEAKS_CHANGED_MESSAGE);
    if (!Number.isFinite(value) || value < tweak.min || value > tweak.max) throw new ApiError('bad-request', TWEAK_VALUE_MESSAGE);
    return tweakNumberText(value, tweak);
  }
  if (typeof value !== 'string') throw new ApiError('stale', TWEAKS_CHANGED_MESSAGE);
  // Option values were validated by parseTweaks; checked again here because they are written as CSS.
  if (!tweak.options.some((option) => option.value === value) || !TWEAK_CHOICE_VALUE_PATTERN.test(value) || !isBalancedQuotes(value)) {
    throw new ApiError('bad-request', TWEAK_VALUE_MESSAGE);
  }
  return value;
};

/**
 * The file already holds this value: the same number in the knob's unit (so `8.0px` stays as the
 * agent spelled it when the knob says 8), or the same choice text. `text` is the formatted value.
 */
const alreadySet = (tweak: Tweak, state: TweakState, text: string): boolean =>
  tweak.kind === 'number' ? state.fileUnit === tweak.unit && state.value === Number.parseFloat(text) : state.value === text;

export const tokensOp: OpModule<RequestOf<'tokens'>> = {
  async plan(input): Promise<OpPlan> {
    const { request } = input;
    const { tweaks } = input.record.design;

    // 1. Every var a current knob (design.json re-read inside the chain), every value one it allows.
    const wanted = request.values.map((entry) => {
      const tweak = tweaks.find((knob) => knob.var === entry.var);
      if (tweak === undefined) throw new ApiError('stale', TWEAKS_CHANGED_MESSAGE);
      return { tweak, text: valueText(tweak, entry.value) };
    });

    // 2. The file as it is now, the way GET /tokens read it: link, size, encoding, then the hash.
    const file = await readTokensFile(input.dir);
    if (file.kind === 'absent') throw stale();
    if (file.kind === 'link') throw new ApiError('invalid', LINK_SENTENCE);
    if (file.kind === 'too-large') throw new ApiError('too-large', FILE_TOO_LARGE_MESSAGE);
    if (!file.utf8) throw new ApiError('invalid', NOT_UTF8_MESSAGE);
    if (sha256(file.bytes) !== request.base) throw stale();
    const css = file.text;

    // 3. Each knob still editable in this file.
    const reads = readKnobs(css, wanted.map((one) => one.tweak));
    const changes: TokenChange[] = [];
    const ledger: { label: string; before: string; after: string }[] = [];
    wanted.forEach(({ tweak, text }, index) => {
      const read = reads[index];
      if (read === undefined || read.declaration === null || read.text === null || (read.state.state !== 'ok' && read.state.state !== 'value')) {
        throw new ApiError('invalid', (read && tweakStateSentence(read.state, tweak)) ?? TOKENS_CANT_WRITE_MESSAGE);
      }
      // 4. A value the file already holds is skipped (its spelling stays).
      if (alreadySet(tweak, read.state, text)) return;
      changes.push({ from: read.declaration.from, to: read.declaration.to, text });
      ledger.push({ label: tweak.label, before: read.text, after: text });
    });

    if (changes.length === 0) return { label: TOKENS_LABEL, detail: TOKENS_UNCHANGED_DETAIL, steps: [], ledger: { kind: 'tweaks', changes: [] } };

    // 5. The splice, verified by scanning the result, then one CAS write per run (one in practice).
    const splices = spliceTokens(css, changes, UNDO_REMOVED_MAX);
    const final = splices.at(-1)?.result;
    if (final === undefined || !verifyTokenWrite(css, final, changes)) throw new ApiError('invalid', TOKENS_CANT_WRITE_MESSAGE);
    const steps: PlannedStep[] = [];
    let beforeSha = request.base;
    for (const splice of splices) {
      // The file round-tripped UTF-8 above, so every byte outside the splice is the byte that was read.
      const bytes = Buffer.from(splice.result, 'utf8');
      const afterSha = sha256(bytes);
      steps.push({
        kind: 'write',
        rel: TOKENS_FILE,
        expectSha: beforeSha,
        bytes,
        undo: { kind: 'splice', file: TOKENS_FILE, start: splice.start, inserted: splice.inserted.length, removed: splice.removed, afterSha, beforeSha },
      });
      beforeSha = afterSha;
    }
    return { label: TOKENS_LABEL, steps, ledger: { kind: 'tweaks', changes: ledger } };
  },
};
