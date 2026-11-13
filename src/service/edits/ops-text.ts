// The text op (Phase 2 technical design §3.4; PS 08, E2, E4 to E7).
//
// It plans one splice of an element's text and writes nothing itself. The source decides
// (E2, AD-2): the file is read again here, its hash must be the one the page read (`base`), and
// the element is located in these bytes with T1's scanner, never taken from the frame. The
// splice touches only the changed run of the element's text (E5: CRLF, a BOM, comments, quoting
// and untouched entities survive byte for byte), typed `& < >` are escaped and the result is
// re-scanned before anything is planned (E6). The pipeline then writes the bytes with a
// compare-and-swap against `base` and keeps the reverse splice as the undo step.
//
// `after` is compared literally with the element's editor text after the splice (§3.4 step 6),
// and editor text collapses ASCII whitespace runs and trims the ends. So an `after` with leading,
// trailing or doubled ASCII whitespace, or a tab, is refused here as "can't place". The page
// normalises what it sends (collapse and trim ASCII whitespace, as `editorTextOf` reads it); this
// op does not rewrite the user's text behind their back.
//
// Every refusal is an `ApiError` with the user's §2.8 sentence, thrown before any byte is
// written. A locator refusal answers the one "can't place" sentence, never the page's reason:
// the page already checked, so a refusal here means the file moved or the request is forged.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { clip, oneLine } from '../../shared/agent/context.ts';
import { ENTRY_FILE, screenFileOf } from '../../shared/design-json.ts';
import { HAND_EDIT_QUOTE_MAX } from '../../shared/limits.ts';
import { locateTextTarget, scanHtml, sourceFileReason, spliceElementText, type SourceFileReason } from '../../shared/source-edit.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE, resolvePlainTarget } from '../paths.ts';
import type { OpInput, OpModule, OpPlan, RequestOf } from './op-module.ts';

// The sentences (§2.8). The stale and bad-request ones equal the pipeline's `STALE_MESSAGES.text`
// and `BAD_EDIT_MESSAGE` (a test holds them equal); they are not imported from pipeline.ts because
// that module imports this one for its op map.
export const TEXT_STALE_MESSAGE = 'This file changed while you were editing. Nothing was saved.';
export const TEXT_BAD_EDIT_MESSAGE = "Design Chamber couldn't read that edit. Nothing was saved.";
export const FILE_TOO_LARGE_MESSAGE = 'This file is too large to edit here. Ask the agent instead.';
export const NOT_UTF8_MESSAGE = "This file isn't plain UTF-8 text, so it can't be edited here. Ask the agent instead.";
export const CANT_PLACE_MESSAGE = "Design Chamber couldn't find this text in the file exactly. Nothing was saved.";
export const BAD_CHARACTERS_MESSAGE = "That text has characters that can't be saved.";

/** Line breaks and control characters other than tab (§3.4 step 3); the page turns pasted breaks into spaces. */
const UNSAVABLE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

const stale = (): ApiError => new ApiError('stale', TEXT_STALE_MESSAGE);
const cantPlace = (): ApiError => new ApiError('invalid', CANT_PLACE_MESSAGE);
const badEdit = (): ApiError => new ApiError('bad-request', TEXT_BAD_EDIT_MESSAGE);

/** A file-level refusal (shared with the page's disabled reasons, §3.3) as its §2.8 answer. */
const fileRefusal = (reason: SourceFileReason): ApiError => {
  switch (reason) {
    case 'link':
      return new ApiError('invalid', LINK_SENTENCE);
    case 'file-too-large':
      return new ApiError('too-large', FILE_TOO_LARGE_MESSAGE);
    case 'not-utf8':
      return new ApiError('invalid', NOT_UTF8_MESSAGE);
  }
};

type Target = { rel: string; where: string; screenTitle: string | null };

/** The file this request may edit (§3.4 step 1): the page's entry, or a listed screen of a canvas. */
const targetOf = (input: OpInput<RequestOf<'text'>>): Target => {
  const { design } = input.record;
  const { screen } = input.request;
  if (design.kind === 'page') {
    if (screen !== null) throw badEdit();
    return { rel: ENTRY_FILE, where: design.title, screenTitle: null };
  }
  if (screen === null) throw badEdit();
  const entry = design.screens.find((candidate) => candidate.id === screen);
  if (entry === undefined) throw badEdit();
  return { rel: screenFileOf(entry.id), where: entry.title, screenTitle: entry.title };
};

/**
 * The file's bytes, read through the one plain-target check (§2.3): a link anywhere on the way,
 * inside the design or out of it, is the link refusal; a file gone since the page read it is stale.
 */
const readSource = async (dir: string, rel: string): Promise<Buffer> => {
  let file: string;
  try {
    file = await resolvePlainTarget(dir, rel.split('/'));
  } catch (error) {
    if (error instanceof ApiError) throw fileRefusal('link');
    if (codeOf(error) === 'ENOENT') throw stale();
    throw error;
  }
  return readFile(file).catch((error: unknown) => {
    throw codeOf(error) === 'ENOENT' ? stale() : error;
  });
};

export const textOp: OpModule<RequestOf<'text'>> = {
  async plan(input): Promise<OpPlan> {
    const { request } = input;
    const target = targetOf(input);
    if (UNSAVABLE.test(request.before) || UNSAVABLE.test(request.after)) throw new ApiError('bad-request', BAD_CHARACTERS_MESSAGE);

    const bytes = await readSource(input.dir, target.rel);
    const text = bytes.toString('utf8');
    const reason = sourceFileReason({ link: false, charLength: text.length, utf8: Buffer.from(text, 'utf8').equals(bytes) });
    if (reason !== null) throw fileRefusal(reason);
    if (sha256(bytes) !== request.base) throw stale();

    // The service passes `leaf: true, truncated: false`: the leaves filter and the before/after
    // checks below enforce both whatever the request claims (source-edit.ts, LocateTarget).
    const located = locateTextTarget(scanHtml(text), { ...request.target, leaf: true, truncated: false });
    if (!('element' in located)) throw cantPlace();
    // Plans the smallest splice, refuses unless the element's editor text is exactly `before`,
    // then re-scans and verifies (§3.4 steps 4 to 6).
    const result = spliceElementText(text, located.element, request.before, request.after);
    if (result === null) throw cantPlace();

    // A Buffer.toString('utf8') keeps a BOM as U+FEFF, so it is encoded back unchanged; the file
    // round-tripped UTF-8 above, so every byte outside the splice is the byte that was read.
    const next = Buffer.from(result.text, 'utf8');
    const { rawFrom, rawTo, replacement } = result.splice;
    const where = clip(oneLine(target.where), HAND_EDIT_QUOTE_MAX);
    return {
      label: `Text updated in ${where}`,
      steps: [
        {
          kind: 'write',
          rel: target.rel,
          expectSha: request.base,
          bytes: next,
          undo: {
            kind: 'splice',
            file: target.rel,
            start: rawFrom,
            inserted: replacement.length,
            removed: text.slice(rawFrom, rawTo),
            afterSha: sha256(next),
            beforeSha: request.base,
          },
        },
      ],
      ledger: {
        kind: 'text',
        file: target.rel,
        screen: target.screenTitle,
        before: clip(request.before, HAND_EDIT_QUOTE_MAX),
        after: clip(request.after, HAND_EDIT_QUOTE_MAX),
      },
    };
  },
};
