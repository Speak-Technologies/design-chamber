// Op `token-reset` (documentation/specs/phase-2-5-technical.md §6.4, "Reset to system"): remove
// overrides of the linked system's tokens from the design's own tokens.css, so the copy's value
// shows again (the copy in `system/` is linked before tokens.css, so a removed override falls
// back to it).
//
// Plans only, like every op: the design's tokens.css is read again here and must hash to `base`;
// each name must be an override right now (`overridesOf` against the copy's tokens.css) or the
// whole request is stale; the removal is the shared token planner's `remove` in both modes with
// `contexts: "design"` (the light `:root` and the dark block only; a declaration in any other
// context is component styling and stays), and the planner verifies the result structurally. One
// compare-and-swap write per undo splice, each undone by its splice; an edit too large for splice
// undo records is refused rather than written without a way back.

import { createHash } from 'node:crypto';

import { overridesOf } from '../../shared/system-copy.ts';
import { planTokenEdit } from '../../shared/token-edit.ts';
import type { TokenEdit } from '../../shared/api.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE } from '../paths.ts';
import { readCopyRecord } from '../store.ts';
import type { OpModule, OpPlan, PlannedStep, RequestOf } from './op-module.ts';
import { FILE_TOO_LARGE_MESSAGE, NOT_UTF8_MESSAGE } from './ops-text.ts';
import { readTokensFile, TOKENS_FILE } from './ops-tokens.ts';

/** The pipeline's `STALE_MESSAGES['token-reset']` (a test holds them equal; not imported, pipeline.ts imports this module). */
export const TOKEN_RESET_STALE_MESSAGE = 'This override changed since you opened the update. Reload and try again.';
export const TOKEN_RESET_TOO_MANY_MESSAGE = 'Too many overrides to reset in one step. Reset fewer at a time.';
export const TOKEN_RESET_LEDGER_LABEL = 'Reset to system';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const stale = (): ApiError => new ApiError('stale', TOKEN_RESET_STALE_MESSAGE);

export const tokensResetOp: OpModule<RequestOf<'token-reset'>> = {
  async plan(input): Promise<OpPlan> {
    const { request, dir } = input;

    // 1. The link: without a readable copy nothing is an override any more.
    const copy = await readCopyRecord(dir);
    if (copy.kind !== 'ok') throw stale();
    const copyTokens = await readTokensFile(dir, ['system', TOKENS_FILE]);
    if (copyTokens.kind !== 'read') throw stale();

    // 2. The design's own tokens.css as it is now: link, size, encoding, then the hash.
    const file = await readTokensFile(dir);
    if (file.kind === 'absent') throw stale();
    if (file.kind === 'link') throw new ApiError('invalid', LINK_SENTENCE);
    if (file.kind === 'too-large') throw new ApiError('too-large', FILE_TOO_LARGE_MESSAGE);
    if (!file.utf8) throw new ApiError('invalid', NOT_UTF8_MESSAGE);
    if (sha256(file.bytes) !== request.base) throw stale();

    // 3. Every name still an override of the copy.
    const overrides = new Map(overridesOf(copyTokens.text, file.text).map((one) => [one.name, one]));
    if (!request.names.every((name) => overrides.has(name))) throw stale();

    // 4. The removal, planned and verified by the shared planner.
    const edits: TokenEdit[] = request.names.map((name) => ({ kind: 'remove', name, mode: 'both' }));
    const planned = planTokenEdit(file.text, edits, { contexts: 'design' });
    if ('refusal' in planned) throw new ApiError('invalid', planned.refusal);
    if (planned.undo === null || planned.undo.kind !== 'splices') throw new ApiError('too-large', TOKEN_RESET_TOO_MANY_MESSAGE);

    // 5. One CAS write per undo splice: each splice applies to the text the previous one left.
    const steps: PlannedStep[] = [];
    let text = file.text;
    let beforeSha = request.base;
    for (const splice of planned.undo.splices) {
      const next = `${text.slice(0, splice.start)}${splice.inserted}${text.slice(splice.start + splice.removed.length)}`;
      const bytes = Buffer.from(next, 'utf8');
      const afterSha = sha256(bytes);
      steps.push({
        kind: 'write',
        rel: TOKENS_FILE,
        expectSha: beforeSha,
        bytes,
        undo: { kind: 'splice', file: TOKENS_FILE, start: splice.start, inserted: splice.inserted.length, removed: splice.removed, afterSha, beforeSha },
      });
      text = next;
      beforeSha = afterSha;
    }
    // The splices rebuild exactly the planner's verified result, or nothing is written.
    if (text !== planned.result) throw new ApiError('invalid', TOKEN_RESET_STALE_MESSAGE);

    const [first] = request.names;
    const label = request.names.length === 1 && first !== undefined ? `Reset ${first} to ${copy.record.name}` : `Reset ${request.names.length} tokens to ${copy.record.name}`;
    const changes = request.names.map((name) => {
      // Safe: every name was checked to be in `overrides` in step 3.
      const override = overrides.get(name) as { value: string; systemValue: string };
      return { label: `${TOKEN_RESET_LEDGER_LABEL}: ${name}`, before: override.value, after: override.systemValue };
    });
    return { label, steps, ledger: { kind: 'tweaks', changes } };
  },
};
