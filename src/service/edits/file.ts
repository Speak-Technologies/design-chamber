// `.chamber/edits.json`: the hand-edit ledger and the undo records (Phase 2 technical design
// §2.1, §7.1, AD-5, AD-7). Service-owned, never versioned, exported, sent or mirrored.
//
//   { "v": 1, "seq": 18, "ledger": [HandEdit…], "dropped": 0, "undo": [UndoRecord…] }
//
// Everything read back is untrusted (anything that can write the design folder can write this
// file): `parseEditsFile` keeps only entries whose every field validates, so the ledger can never
// carry free text into a prompt and an undo record can only name this design's editable files and
// its own trash entries. A file that is too large, not JSON or a link reads as empty; the next
// write replaces it (a link is never written through).
//
// One writer per design: `update` runs on a per-slug promise chain and re-reads the file inside
// it, so no caller ever writes a copy it read earlier (the pipeline's append, undo's removal, the
// expiry prune, the hand-edits clear). Lock order is the versions chain, then this queue; the
// clear route takes only the queue.

import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  COMMENT_ID_PATTERN,
  COMMENTS_MAX,
  EDIT_ID_PATTERN,
  EDITS_FILE_MAX_BYTES,
  HAND_EDIT_QUOTE_MAX,
  HAND_EDITS_LEDGER_MAX,
  SCREEN_ID_PATTERN,
  SCREENS_MAX,
  SHA256_PATTERN,
  SLUG_PATTERN,
  SOURCE_TEXT_MAX,
  TEXT_EDIT_MAX,
  TWEAKS_MAX,
  USER_UNDO_KEEP,
  USER_UNDO_TTL_MS,
} from '../../shared/limits.ts';
import type { DirectionLetter, HandEdit, IsoDate, JsonValue } from '../../shared/types.ts';
import { clip, oneLine } from '../../shared/agent/context.ts';
import type { Logger } from '../context.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE, resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import type { HandEditBody } from './op-module.ts';
import { isOwnTrashPlace } from './trash.ts';

// ---- shapes ----

/** One recorded reverse step, applied newest first on undo, each guarded by a hash or a stamp. */
export type UndoStep =
  /** `start` and `inserted` are UTF-16 offsets in the decoded text; `removed` is the raw source text the edit replaced. */
  | { kind: 'splice'; file: string; start: number; inserted: number; removed: string; afterSha: string; beforeSha: string }
  /** `before` is the raw `screens` value; `afterStamp` the screen-list stamp the edit left. */
  | { kind: 'screens'; before: JsonValue[]; afterStamp: string }
  /** The forward move (`from` → `to`); undo moves `to` back to `from` while it still hashes to `sha`. */
  | { kind: 'move'; from: string; to: string; sha: string }
  /** A file the edit created; undo moves it to the trash (never a hard delete) while it still hashes to `sha`. */
  | { kind: 'create'; file: string; sha: string }
  | { kind: 'comments'; moves: { id: string; from: string; to: string }[] };

export type UndoRecord = {
  id: string;
  at: IsoDate;
  /** The notice title, e.g. "Text updated in Home"; the ledger quotes it as "Undid: …". */
  label: string;
  /** The ledger entry this edit added, or null when it added none. */
  ledgerSeq: number | null;
  /** In the order they were applied. */
  steps: UndoStep[];
};

export type EditsFile = {
  v: 1;
  /** Last ledger seq handed out: monotonic per design, survives clears. */
  seq: number;
  /** Oldest first, ≤ `HAND_EDITS_LEDGER_MAX`. */
  ledger: HandEdit[];
  /** Entries dropped off the front of the ledger since the last clear. */
  dropped: number;
  /** Newest last, ≤ `USER_UNDO_KEEP`, each ≤ `USER_UNDO_TTL_MS` old. */
  undo: UndoRecord[];
};

export const EDITS_FILE_SEGMENTS: readonly string[] = ['.chamber', 'edits.json'];

export const emptyEditsFile = (): EditsFile => ({ v: 1, seq: 0, ledger: [], dropped: 0, undo: [] });

/** Characters of the raw text one splice may put back (entity-heavy text, §2.1). */
export const UNDO_REMOVED_MAX = TEXT_EDIT_MAX * 8;
/** Steps one undo record may hold (keep-direction with four members is well under). */
export const UNDO_STEPS_MAX = 32;
/** Characters of an undo record's label. */
export const UNDO_LABEL_MAX = 200;

// ---- validation (pure) ----

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown, max: number = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const isSha = (value: unknown): value is string => typeof value === 'string' && SHA256_PATTERN.test(value);
const isIso = (value: unknown): value is IsoDate => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

/** A quoted title, label, name or text: one line, clipped to `HAND_EDIT_QUOTE_MAX`. */
const quote = (value: unknown): string | null => (typeof value === 'string' ? clip(oneLine(value), HAND_EDIT_QUOTE_MAX) : null);

const SCREEN_FILE = /^screens\/([a-z0-9][a-z0-9-]{0,40})\.html$/;

/** The screen id of `screens/<id>.html`, or null. */
export const screenIdOfFile = (rel: string): string | null => {
  const id = SCREEN_FILE.exec(rel)?.[1];
  return id !== undefined && SCREEN_ID_PATTERN.test(id) ? id : null;
};

/** The design-relative files a hand edit may ever write (07-7): never assets, DESIGN.md, `.chamber`, `.versions`. */
export const isEditableRel = (rel: string): boolean => rel === 'index.html' || rel === 'tokens.css' || screenIdOfFile(rel) !== null;

/** A ledger entry's `file`: an editable file or design.json (screen-list edits). */
const isLedgerFile = (value: unknown): value is string => typeof value === 'string' && (value === 'design.json' || isEditableRel(value));

const isLetter = (value: unknown): value is DirectionLetter => value === 'A' || value === 'B' || value === 'C' || value === 'D';

/**
 * One ledger entry, validated and normalised (quotes one-lined and clipped), or null. The
 * pipeline runs its own new entries through this too, so a module bug cannot store free text.
 */
export const parseHandEdit = (value: unknown): HandEdit | null => {
  if (!isObj(value)) return null;
  const { seq, at, editId } = value;
  if (!isCount(seq) || seq < 1 || !isIso(at) || typeof editId !== 'string' || !EDIT_ID_PATTERN.test(editId)) return null;
  const base = { seq, at, editId };
  switch (value.kind) {
    case 'text': {
      const before = quote(value.before);
      const after = quote(value.after);
      const screen = value.screen === null ? null : quote(value.screen);
      if (!isLedgerFile(value.file) || before === null || after === null || (value.screen !== null && screen === null)) return null;
      return { ...base, kind: 'text', file: value.file, screen, before, after };
    }
    case 'tweaks': {
      if (!Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > TWEAKS_MAX) return null;
      const changes: { label: string; before: string; after: string }[] = [];
      for (const change of value.changes) {
        if (!isObj(change)) return null;
        const label = quote(change.label);
        const before = quote(change.before);
        const after = quote(change.after);
        if (label === null || before === null || after === null) return null;
        changes.push({ label, before, after });
      }
      return { ...base, kind: 'tweaks', changes };
    }
    case 'reorder': {
      const moved = quote(value.moved);
      const above = value.above === null ? null : quote(value.above);
      if (moved === null || (value.above !== null && above === null)) return null;
      return { ...base, kind: 'reorder', moved, above };
    }
    case 'reorder-many': {
      if (!Array.isArray(value.order) || value.order.length === 0 || value.order.length > SCREENS_MAX) return null;
      const order: string[] = [];
      for (const title of value.order) {
        const one = quote(title);
        if (one === null) return null;
        order.push(one);
      }
      return { ...base, kind: 'reorder-many', order };
    }
    case 'duplicate': {
      const screen = quote(value.screen);
      const copy = quote(value.copy);
      if (screen === null || copy === null || !isLedgerFile(value.file)) return null;
      return { ...base, kind: 'duplicate', screen, copy, file: value.file };
    }
    case 'trash': {
      const screen = quote(value.screen);
      if (screen === null || !isLedgerFile(value.file)) return null;
      return { ...base, kind: 'trash', screen, file: value.file };
    }
    case 'keep': {
      const screen = quote(value.screen);
      const name = value.name === null ? null : quote(value.name);
      if (screen === null || !(value.letter === null || isLetter(value.letter)) || (value.name !== null && name === null)) return null;
      return { ...base, kind: 'keep', screen, letter: value.letter, name };
    }
    case 'undo': {
      const of = quote(value.of);
      return of === null ? null : { ...base, kind: 'undo', of };
    }
    default:
      return null;
  }
};

/** A step place: a design-relative editable file, or (only where `trash` is true) this design's own trash entry. */
const isPlace = (value: unknown, slug: string, trash: boolean): value is string =>
  typeof value === 'string' && (isEditableRel(value) || (trash && isOwnTrashPlace(value, slug)));

/** One undo step, or null. Paths are checked again with `resolvePlainTarget` when the undo runs. */
export const parseUndoStep = (value: unknown, slug: string): UndoStep | null => {
  if (!isObj(value)) return null;
  switch (value.kind) {
    case 'splice': {
      const { file, start, inserted, removed, afterSha, beforeSha } = value;
      if (!isPlace(file, slug, false) || !isCount(start, SOURCE_TEXT_MAX) || !isCount(inserted, SOURCE_TEXT_MAX)) return null;
      if (typeof removed !== 'string' || removed.length > UNDO_REMOVED_MAX || !isSha(afterSha) || !isSha(beforeSha)) return null;
      return { kind: 'splice', file, start, inserted, removed, afterSha, beforeSha };
    }
    case 'screens': {
      // Parsed from JSON, so every element is a JsonValue already.
      if (!Array.isArray(value.before) || !isSha(value.afterStamp)) return null;
      return { kind: 'screens', before: value.before as JsonValue[], afterStamp: value.afterStamp };
    }
    case 'move': {
      const { from, to, sha } = value;
      if (!isPlace(from, slug, false) || !isPlace(to, slug, true) || from === to || !isSha(sha)) return null;
      return { kind: 'move', from, to, sha };
    }
    case 'create': {
      const { file, sha } = value;
      if (typeof file !== 'string' || screenIdOfFile(file) === null || !isSha(sha)) return null;
      return { kind: 'create', file, sha };
    }
    case 'comments': {
      if (!Array.isArray(value.moves) || value.moves.length > COMMENTS_MAX) return null;
      const moves: { id: string; from: string; to: string }[] = [];
      for (const move of value.moves) {
        if (!isObj(move)) return null;
        const { id, from, to } = move;
        if (typeof id !== 'string' || !COMMENT_ID_PATTERN.test(id)) return null;
        if (typeof from !== 'string' || !SCREEN_ID_PATTERN.test(from) || typeof to !== 'string' || !SCREEN_ID_PATTERN.test(to)) return null;
        moves.push({ id, from, to });
      }
      return { kind: 'comments', moves };
    }
    default:
      return null;
  }
};

export const parseUndoRecord = (value: unknown, slug: string): UndoRecord | null => {
  if (!isObj(value)) return null;
  const { id, at, label, ledgerSeq, steps } = value;
  if (typeof id !== 'string' || !EDIT_ID_PATTERN.test(id) || !isIso(at) || typeof label !== 'string') return null;
  if (!(ledgerSeq === null || (isCount(ledgerSeq) && ledgerSeq >= 1))) return null;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > UNDO_STEPS_MAX) return null;
  const parsed: UndoStep[] = [];
  for (const step of steps) {
    const one = parseUndoStep(step, slug);
    if (one === null) return null; // a record with one bad step cannot be undone exactly: drop it whole
    parsed.push(one);
  }
  return { id, at, label: clip(oneLine(label), UNDO_LABEL_MAX), ledgerSeq, steps: parsed };
};

/** The file as far as it validates; `damaged` counts what was dropped (logged, never the content). */
export const parseEditsFile = (value: unknown, slug: string): { file: EditsFile; damaged: number } => {
  if (!SLUG_PATTERN.test(slug) || !isObj(value) || value.v !== 1) return { file: emptyEditsFile(), damaged: 1 };
  let damaged = 0;
  const ledger: HandEdit[] = [];
  for (const entry of Array.isArray(value.ledger) ? value.ledger : []) {
    const one = parseHandEdit(entry);
    if (one === null || (ledger.length > 0 && one.seq <= (ledger.at(-1)?.seq ?? 0))) damaged += 1;
    else ledger.push(one);
  }
  const undo: UndoRecord[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(value.undo) ? value.undo : []) {
    const one = parseUndoRecord(entry, slug);
    if (one === null || ids.has(one.id)) damaged += 1;
    else {
      ids.add(one.id);
      undo.push(one);
    }
  }
  const lastSeq = ledger.at(-1)?.seq ?? 0;
  // `seq` never goes back below an entry it handed out, whatever the file says.
  const seq = isCount(value.seq) ? Math.max(value.seq, lastSeq) : lastSeq;
  const dropped = isCount(value.dropped) ? value.dropped : 0;
  if (!Array.isArray(value.ledger) || !Array.isArray(value.undo) || !isCount(value.seq) || !isCount(value.dropped)) damaged += 1;
  return { file: { v: 1, seq, ledger: ledger.slice(-HAND_EDITS_LEDGER_MAX), dropped, undo }, damaged };
};

// ---- updates (pure) ----

const ageOk = (record: UndoRecord, nowMs: number): boolean => {
  const at = Date.parse(record.at);
  return nowMs - at <= USER_UNDO_TTL_MS && at - nowMs <= USER_UNDO_TTL_MS;
};

/** Undo records past `USER_UNDO_TTL_MS` (or from a far future clock) dropped, then the newest `USER_UNDO_KEEP` kept. */
export const pruneUndo = (file: EditsFile, nowMs: number): EditsFile => {
  const undo = file.undo.filter((record) => ageOk(record, nowMs)).slice(-USER_UNDO_KEEP);
  return undo.length === file.undo.length ? file : { ...file, undo };
};

/** The undo record with this id while it is still usable, or null. */
export const findUndo = (file: EditsFile, id: string, nowMs: number): UndoRecord | null =>
  file.undo.find((record) => record.id === id && ageOk(record, nowMs)) ?? null;

/** A ledger entry appended with the next seq; the oldest entries over the cap counted in `dropped`. */
const appendLedger = (file: EditsFile, entry: Readonly<Obj> | null): { file: EditsFile; seq: number | null } => {
  if (entry === null) return { file, seq: null };
  const seq = file.seq + 1;
  const hand = parseHandEdit({ ...entry, seq });
  if (hand === null) return { file, seq: null };
  const ledger = [...file.ledger, hand];
  const over = Math.max(0, ledger.length - HAND_EDITS_LEDGER_MAX);
  return { file: { ...file, seq, ledger: ledger.slice(over), dropped: file.dropped + over }, seq };
};

export type NewEdit = { editId: string; at: IsoDate; label: string; body: HandEditBody; steps: UndoStep[] };

/**
 * One successful hand edit: its ledger entry (validated; a body that does not validate adds no
 * entry) and its undo record (when it has steps), then the prune by age and count.
 */
export const appendEdit = (file: EditsFile, edit: NewEdit, nowMs: number): EditsFile => {
  const { file: withLedger, seq } = appendLedger(file, { ...edit.body, at: edit.at, editId: edit.editId });
  if (edit.steps.length === 0) return pruneUndo(withLedger, nowMs);
  const record: UndoRecord = { id: edit.editId, at: edit.at, label: clip(oneLine(edit.label), UNDO_LABEL_MAX), ledgerSeq: seq, steps: edit.steps };
  return pruneUndo({ ...withLedger, undo: [...withLedger.undo.filter((one) => one.id !== record.id), record] }, nowMs);
};

/**
 * After an undo: the record is gone; its ledger entry is removed while it is still unsent, else
 * an `undo` entry is appended so the agent hears about it (§7.1).
 */
export const applyUndone = (file: EditsFile, record: UndoRecord, at: IsoDate, nowMs: number): EditsFile => {
  const undo = file.undo.filter((one) => one.id !== record.id);
  const unsent = record.ledgerSeq !== null && file.ledger.some((entry) => entry.seq === record.ledgerSeq);
  if (unsent) return pruneUndo({ ...file, undo, ledger: file.ledger.filter((entry) => entry.seq !== record.ledgerSeq) }, nowMs);
  const { file: withLedger } = appendLedger({ ...file, undo }, { kind: 'undo', of: record.label, at, editId: record.id });
  return pruneUndo(withLedger, nowMs);
};

/** `upTo` must be a positive integer the ledger has handed out (≤ `seq`). */
export const CLEAR_RANGE_MESSAGE = 'That hand-edit position is not one Design Chamber handed out.';

/**
 * Remove ledger entries with `seq ≤ upTo` (idempotent). The dropped count goes too once the
 * oldest kept entry is cleared, since every message that carried it also carried that count.
 */
export const clearLedger = (file: EditsFile, upTo: number): EditsFile => {
  if (!Number.isSafeInteger(upTo) || upTo < 1 || upTo > file.seq) throw new ApiError('bad-request', CLEAR_RANGE_MESSAGE);
  const first = file.ledger[0];
  const ledger = file.ledger.filter((entry) => entry.seq > upTo);
  const dropped = first === undefined || first.seq <= upTo ? 0 : file.dropped;
  if (ledger.length === file.ledger.length && dropped === file.dropped) return file;
  return { ...file, ledger, dropped };
};

/** The file text as written: oldest undo records dropped until it fits `EDITS_FILE_MAX_BYTES` (so it always reads back). */
export const serializeEditsFile = (file: EditsFile): { text: string; file: EditsFile } => {
  let current = file;
  for (;;) {
    const text = `${JSON.stringify(current, null, 2)}\n`;
    if (Buffer.byteLength(text, 'utf8') <= EDITS_FILE_MAX_BYTES || current.undo.length === 0) return { text, file: current };
    current = { ...current, undo: current.undo.slice(1) };
  }
};

// ---- the queue ----

export type EditsFileStore = {
  /** The validated file (empty when absent, damaged, too large or a link). No queue: the file is replaced atomically. */
  read(slug: string, dir: string): Promise<EditsFile>;
  /** Read-modify-write on the slug's queue; `mutate` sees the file as it is inside the queue. Answers the file as written. */
  update(slug: string, dir: string, mutate: (file: EditsFile) => EditsFile): Promise<EditsFile>;
};

export type EditsFileDeps = { log: Logger };

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

export const createEditsFile = (deps: EditsFileDeps): EditsFileStore => {
  const { log } = deps;
  const chains = new Map<string, Promise<unknown>>();
  const chained = <T>(slug: string, fn: () => Promise<T>): Promise<T> => {
    const previous = chains.get(slug) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    chains.set(slug, settled);
    void settled.then(() => {
      if (chains.get(slug) === settled) chains.delete(slug);
    });
    return run;
  };

  /** The lexical edits.json path, or null when `.chamber` or the file is a link (or not a regular file). */
  const targetOf = async (slug: string, dir: string): Promise<string | null> => {
    try {
      return await resolvePlainTarget(dir, EDITS_FILE_SEGMENTS, { allowAbsent: true });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      log.warn('edits.file-link', { slug });
      return null;
    }
  };

  const read = async (slug: string, dir: string): Promise<EditsFile> => {
    let target: string | null;
    try {
      target = await targetOf(slug, dir);
    } catch (error) {
      log.warn('edits.file-unreadable', { slug, code: codeOf(error) ?? 'error' });
      return emptyEditsFile();
    }
    if (target === null) return emptyEditsFile();
    try {
      const info = await stat(target);
      if (info.size > EDITS_FILE_MAX_BYTES) {
        log.warn('edits.file-unreadable', { slug, code: 'too-large' });
        return emptyEditsFile();
      }
      const parsed = parseEditsFile(JSON.parse(await readFile(target, 'utf8')) as unknown, slug);
      if (parsed.damaged > 0) log.warn('edits.file-unreadable', { slug, code: 'entries-dropped', dropped: parsed.damaged });
      return parsed.file;
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return emptyEditsFile();
      log.warn('edits.file-unreadable', { slug, code: codeOf(error) ?? 'not-json' });
      return emptyEditsFile();
    }
  };

  const write = async (slug: string, dir: string, text: string): Promise<void> => {
    try {
      // Not recursive: a design folder removed meanwhile is never re-created.
      await mkdir(path.join(dir, '.chamber'));
    } catch (error) {
      if (codeOf(error) !== 'EEXIST') {
        const folderLeft = await stat(dir).then((info) => info.isDirectory(), () => false);
        throw folderLeft ? error : new ApiError('not-found', 'That design is no longer in your Designs folder.');
      }
    }
    // Resolved after the mkdir, so a `.chamber` link that was already there is refused, never written through.
    const target = await targetOf(slug, dir);
    if (target === null) throw new ApiError('invalid', LINK_SENTENCE);
    await writeFileAtomic(target, text, { createDirs: false });
  };

  return {
    read,
    update: (slug, dir, mutate) =>
      chained(slug, async () => {
        const current = await read(slug, dir);
        const next = mutate(current);
        if (next === current) return current;
        const { text, file } = serializeEditsFile(next);
        await write(slug, dir, text);
        return file;
      }),
  };
};
