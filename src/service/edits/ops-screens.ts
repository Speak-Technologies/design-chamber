// The screen ops (Phase 2 technical design §5.2, §6.2; PS 10, 11): reorder, duplicate,
// trash-screen and keep-direction. Like every op module this only plans: it reads design.json
// and the screen files, checks the request's stamps (the screen-list stamp and each file's size
// and mtime as the wall showed them), and hands the pipeline its steps. The list itself is
// planned by the pure functions in `src/shared/screen-ops.ts` over the RAW `screens` value, so
// every entry and key the agent wrote that Design Chamber does not show travels unchanged.
//
// The pipeline runs the steps in order after the version first, each move with no-replace and
// the list through `store.writeScreens` (stamp re-checked under the store lock), and rolls the
// done steps back when a later one fails (§2.9).

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { FileStamp } from '../../shared/api.ts';
import { clip, oneLine } from '../../shared/agent/context.ts';
import { DESIGN_JSON_FILE, parseDesignJsonText, screenFileOf } from '../../shared/design-json.ts';
import { HAND_EDIT_QUOTE_MAX, SCREENS_MAX } from '../../shared/limits.ts';
import {
  copyTitle,
  describeMove,
  DESIGN_JSON_UNREADABLE_MESSAGE,
  directionGroups,
  duplicateRaw,
  freeCopyId,
  listedSlots,
  NO_DESIGN_JSON_MESSAGE,
  PAGE_HAS_NO_SCREENS_MESSAGE,
  removeRaw,
  reorderRaw,
  SCREEN_LIST_STALE_MESSAGE,
  SCREEN_LIST_UNREADABLE_MESSAGE,
  SCREENS_CAP_MESSAGE,
} from '../../shared/screen-ops.ts';
import type { JsonValue } from '../../shared/types.ts';
import type { DesignRecord } from '../context.ts';
import { ApiError } from '../http.ts';
import { resolvePlainTarget } from '../paths.ts';
import { screensStampOf } from '../store.ts';
import type { UndoStep } from './file.ts';
import type { OpInput, OpModule, OpPlan, PlannedStep, RequestOf } from './op-module.ts';
import { trashPlaceOf, trashStampOf } from './trash.ts';

export type ScreenRequest = RequestOf<'reorder' | 'duplicate' | 'trash-screen' | 'keep-direction'>;

// ---- sentences (§2.8; the shared ones live in screen-ops.ts) ----

/** A request that names screens the list does not have, or a group that is not this one, while the stamp matches. */
export const BAD_SCREEN_REQUEST_MESSAGE = "Design Chamber couldn't read that edit. Nothing was saved.";
export const SAME_ORDER_MESSAGE = 'The screens are already in that order, so nothing was changed.';
export const NO_COPY_NAME_MESSAGE = "There's no free name for another copy of this screen. Move some copies to the trash first.";
export const KEEP_NOT_WRITTEN_MESSAGE = "This direction isn't written yet, so it can't be kept.";
export const KEPT_OTHERS_DETAIL = 'The others are in the trash.';
export const KEPT_CURRENT_DETAIL = 'The directions are in the trash.';

const stale = (): ApiError => new ApiError('stale', SCREEN_LIST_STALE_MESSAGE);
const badRequest = (): ApiError => new ApiError('bad-request', BAD_SCREEN_REQUEST_MESSAGE);

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** A title as the notice and the ledger quote it: one line, clipped. */
const quoted = (title: string): string => clip(oneLine(title), HAND_EDIT_QUOTE_MAX);

// ---- reads (every one before any write) ----

type ScreenList = { raw: JsonValue[]; ids: string[]; titleOf: (id: string) => string };

/**
 * design.json's raw screen list, refused unless the design is a canvas with a readable
 * design.json whose screen-list stamp is the one the wall acted on.
 */
const readScreenList = async (record: DesignRecord, dir: string, stamp: string): Promise<ScreenList> => {
  if (record.design.kind !== 'canvas') throw new ApiError('invalid', PAGE_HAS_NO_SCREENS_MESSAGE);
  if (record.designJson === 'missing') throw new ApiError('invalid', NO_DESIGN_JSON_MESSAGE);
  if (record.designJson === 'invalid') throw new ApiError('invalid', DESIGN_JSON_UNREADABLE_MESSAGE);
  const text = await readFile(path.join(dir, DESIGN_JSON_FILE), 'utf8').catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT') throw new ApiError('invalid', NO_DESIGN_JSON_MESSAGE);
    throw error;
  });
  const { raw } = parseDesignJsonText(text, { kind: 'canvas', fallbackTitle: record.slug, fallbackTime: record.design.created });
  if (raw === null) throw new ApiError('invalid', DESIGN_JSON_UNREADABLE_MESSAGE);
  if (screensStampOf(raw) !== stamp) throw stale();
  const screens = raw.screens;
  if (!Array.isArray(screens)) throw new ApiError('invalid', SCREEN_LIST_UNREADABLE_MESSAGE);
  const ids = listedSlots(screens).map((slot) => slot.id);
  const listed = record.design.screens.map((screen) => screen.id);
  // The record and this read came from two reads of the file: they must agree on the list.
  if (ids.length !== listed.length || ids.some((id, index) => listed[index] !== id)) throw stale();
  const titles = new Map(record.design.screens.map((screen) => [screen.id, screen.title]));
  return { raw: screens, ids, titleOf: (id) => titles.get(id) ?? id };
};

/**
 * A screen file as the wall showed it: `null` must still be absent, a stamp must still match the
 * size and mtime; then its bytes (or null when absent). A link is refused with the link sentence.
 */
const readScreenFile = async (dir: string, id: string, expected: FileStamp | null): Promise<Buffer | null> => {
  const abs = await resolvePlainTarget(dir, ['screens', `${id}.html`], { allowAbsent: true });
  const info = await lstat(abs).catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT') return null;
    throw error;
  });
  if (info === null) {
    if (expected !== null) throw stale();
    return null;
  }
  if (expected === null || info.size !== expected.size || info.mtime.toISOString() !== expected.mtime) throw stale();
  const bytes = await readFile(abs).catch((error: unknown) => {
    throw codeOf(error) === 'ENOENT' ? stale() : error;
  });
  // A rewrite between the stat and the read, with the same size: still not what the wall showed.
  if (bytes.length !== expected.size) throw stale();
  return bytes;
};

/** Every `screens/*.html` stem on disk, lower-cased (a case-insensitive disk must not collide). */
const screenStemsOnDisk = async (dir: string): Promise<string[]> => {
  const names = await readdir(path.join(dir, 'screens')).catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR') return [];
    throw error;
  });
  return names.filter((name) => name.toLowerCase().endsWith('.html')).map((name) => name.slice(0, -'.html'.length).toLowerCase());
};

// ---- steps ----

/** The list step: `change` re-applied to the list `writeScreens` reads (equal to this read while the stamp holds). */
const screensStep = (stamp: string, before: JsonValue[], change: (raw: JsonValue[]) => JsonValue[] | null): PlannedStep => ({
  kind: 'screens',
  expectStamp: stamp,
  mutate: (raw) => {
    if (!Array.isArray(raw)) throw new ApiError('invalid', SCREEN_LIST_UNREADABLE_MESSAGE);
    const next = change(raw);
    if (next === null) throw stale();
    return next;
  },
  undo: (afterStamp): UndoStep => ({ kind: 'screens', before: structuredClone(before), afterStamp }),
});

/** Move a screen file away, undone by moving it back while it still hashes to the bytes moved. */
const moveStep = (from: string, to: string, bytes: Buffer): PlannedStep => {
  const sha = sha256(bytes);
  return { kind: 'move', from, to, expect: { sha }, undo: { kind: 'move', from, to, sha } };
};

// ---- the four ops ----

const planReorder = async ({ record, dir, request }: OpInput<RequestOf<'reorder'>>): Promise<OpPlan> => {
  const list = await readScreenList(record, dir, request.screens);
  if (reorderRaw(list.raw, request.order) === null) throw badRequest();
  if (request.order.every((id, index) => list.ids[index] === id)) throw new ApiError('invalid', SAME_ORDER_MESSAGE);
  const step = screensStep(request.screens, list.raw, (raw) => reorderRaw(raw, request.order));
  const move = describeMove(list.ids, request.order);
  const title = (id: string): string => quoted(list.titleOf(id));
  if (move === null) {
    return { label: 'Screens reordered', steps: [step], ledger: { kind: 'reorder-many', order: request.order.map(title) } };
  }
  const label = move.above === null ? `Moved ${title(move.moved)} to the end` : `Moved ${title(move.moved)} above ${title(move.above)}`;
  return { label, steps: [step], ledger: { kind: 'reorder', moved: title(move.moved), above: move.above === null ? null : title(move.above) } };
};

const planDuplicate = async ({ record, dir, request }: OpInput<RequestOf<'duplicate'>>): Promise<OpPlan> => {
  const list = await readScreenList(record, dir, request.screens);
  if (!list.ids.includes(request.id)) throw badRequest();
  if (list.ids.length >= SCREENS_MAX) throw new ApiError('invalid', SCREENS_CAP_MESSAGE);
  const bytes = await readScreenFile(dir, request.id, request.file);
  if (bytes === null) throw stale(); // Unreachable: a stamped file that is absent is stale inside readScreenFile.
  const rawIds = list.raw.flatMap((entry) => (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && typeof entry.id === 'string' ? [entry.id.toLowerCase()] : []));
  const taken = new Set([...list.ids, ...rawIds, ...(await screenStemsOnDisk(dir))]);
  const copyId = freeCopyId(request.id, taken);
  if (copyId === null) throw new ApiError('conflict', NO_COPY_NAME_MESSAGE);
  const title = copyTitle(list.titleOf(request.id));
  if (duplicateRaw(list.raw, request.id, copyId, title) === null) throw badRequest();
  const rel = screenFileOf(copyId);
  return {
    label: `Duplicated ${quoted(list.titleOf(request.id))}`,
    steps: [
      { kind: 'create', rel, bytes, undo: { kind: 'create', file: rel, sha: sha256(bytes) } },
      screensStep(request.screens, list.raw, (raw) => duplicateRaw(raw, request.id, copyId, title)),
    ],
    ledger: { kind: 'duplicate', screen: quoted(list.titleOf(request.id)), copy: quoted(title), file: rel },
    created: { id: copyId, title },
  };
};

const planTrash = async ({ slug, record, dir, request, now }: OpInput<RequestOf<'trash-screen'>>): Promise<OpPlan> => {
  const list = await readScreenList(record, dir, request.screens);
  if (!list.ids.includes(request.id)) throw badRequest();
  const bytes = await readScreenFile(dir, request.id, request.file);
  const rel = screenFileOf(request.id);
  const steps: PlannedStep[] = [];
  if (bytes !== null) steps.push(moveStep(rel, trashPlaceOf(slug, request.id, trashStampOf(now())), bytes));
  const gone = new Set([request.id]);
  steps.push(screensStep(request.screens, list.raw, (raw) => removeRaw(raw, gone)));
  const title = quoted(list.titleOf(request.id));
  return { label: `Moved ${title} to trash`, steps, ledger: { kind: 'trash', screen: title, file: rel } };
};

const planKeep = async ({ slug, record, dir, request, now }: OpInput<RequestOf<'keep-direction'>>): Promise<OpPlan> => {
  const list = await readScreenList(record, dir, request.screens);
  const group = directionGroups(record.design.screens).find((one) => one.of === request.of);
  // The stamp matched, so the marks are the ones the wall drew: a missing group is a wrong request.
  if (group === undefined) throw badRequest();
  const groupIds = [group.of, ...group.members.map((member) => member.id)];
  const named = new Set(request.files.map((entry) => entry.id));
  if (named.size !== groupIds.length || !groupIds.every((id) => named.has(id)) || !named.has(request.keep)) throw badRequest();

  const bytesOf = new Map<string, Buffer | null>();
  for (const entry of request.files) bytesOf.set(entry.id, await readScreenFile(dir, entry.id, entry.file));
  const keptBytes = bytesOf.get(request.keep) ?? null;
  if (keptBytes === null) throw new ApiError('invalid', KEEP_NOT_WRITTEN_MESSAGE);

  const stamp = trashStampOf(now());
  const steps: PlannedStep[] = [];
  for (const member of group.members) {
    const bytes = bytesOf.get(member.id) ?? null;
    if (member.id !== request.keep && bytes !== null) steps.push(moveStep(screenFileOf(member.id), trashPlaceOf(slug, member.id, stamp), bytes));
  }
  const keptMember = group.members.find((member) => member.id === request.keep);
  if (keptMember !== undefined) {
    const original = bytesOf.get(group.of) ?? null;
    if (original !== null) steps.push(moveStep(screenFileOf(group.of), trashPlaceOf(slug, group.of, stamp), original));
    // B's bytes land unchanged in the original's place: its id, title, position and links stay.
    steps.push(moveStep(screenFileOf(keptMember.id), screenFileOf(group.of), keptBytes));
  }
  const memberIds = new Set(group.members.map((member) => member.id));
  steps.push(screensStep(request.screens, list.raw, (raw) => removeRaw(raw, memberIds)));
  if (keptMember !== undefined) {
    steps.push({
      kind: 'comments',
      moves: [{ from: keptMember.id, to: group.of }],
      undo: (moved): UndoStep => ({ kind: 'comments', moves: moved }),
    });
  }

  const title = quoted(list.titleOf(group.of));
  const mark = keptMember?.direction;
  if (keptMember === undefined || mark === undefined) {
    return { label: `Kept the current ${title}`, detail: KEPT_CURRENT_DETAIL, steps, ledger: { kind: 'keep', screen: title, letter: null, name: null } };
  }
  return { label: `Kept ${mark.letter} for ${title}`, detail: KEPT_OTHERS_DETAIL, steps, ledger: { kind: 'keep', screen: title, letter: mark.letter, name: quoted(mark.name) } };
};

export const screensOp: OpModule<ScreenRequest> = {
  plan: async (input) => {
    const { request } = input;
    switch (request.op) {
      case 'reorder':
        return planReorder({ ...input, request });
      case 'duplicate':
        return planDuplicate({ ...input, request });
      case 'trash-screen':
        return planTrash({ ...input, request });
      case 'keep-direction':
        return planKeep({ ...input, request });
    }
  },
};
