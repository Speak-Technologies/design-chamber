// A design system's `.chamber/edits.json`: its hand-edit ledger and undo records
// (documentation/specs/phase-2-5-technical.md §5.3, §6.1, §6.2). Same shape and queue as a
// design's (`edits/file.ts`, `edits/queue-file.ts`); the entries and undo steps are the system's.
//
// Everything read back is untrusted: an entry or a record that does not validate is dropped, so
// the ledger can never carry free text into a prompt, and an undo record can only name the
// system's own editable files.

import { clip, oneLine } from '../../shared/agent/context.ts';
import {
  EDIT_ID_PATTERN,
  HAND_EDIT_QUOTE_MAX,
  HAND_EDITS_LEDGER_MAX,
  SHA256_PATTERN,
  SOURCE_TEXT_MAX,
  SYSTEM_EDITS_FILE_MAX_BYTES,
  SYSTEM_TOKEN_NAME_PATTERN,
  SYSTEM_UNDO_TEXT_MAX,
} from '../../shared/limits.ts';
import type { HandEdit, IsoDate } from '../../shared/types.ts';
import type { Logger } from '../context.ts';
import { appendLedger, EDITS_FILE_SEGMENTS, parseHandEdit, pruneUndo, serializeEditsFile, UNDO_LABEL_MAX, UNDO_REMOVED_MAX, UNDO_STEPS_MAX, type LedgerFile } from '../edits/file.ts';
import type { HandEditBody } from '../edits/op-module.ts';
import { createQueueFile, type QueueFileStore } from '../edits/queue-file.ts';
import { SYSTEM_GONE_MESSAGE } from './store.ts';

// ---- the writable set (§5.3) ----

/** A body file of an entry: `notes/<id>.md`, `patterns/<id>.md`, `brand/<id>.md`. */
const BODY_FILE = /^(notes|patterns|brand)\/([a-z0-9][a-z0-9-]{0,39})\.md$/;
/** A brand file a re-sync may create (§6.3, T4/T13): the `safeAssetName` alphabet. */
const RESYNC_ASSET_FILE = /^assets\/(fonts|logos)\/[A-Za-z0-9_][A-Za-z0-9._ -]{0,79}$/;

/** The body file's folder and entry id, or null. */
export const bodyFileOf = (rel: string): { folder: 'notes' | 'patterns' | 'brand'; id: string } | null => {
  const match = BODY_FILE.exec(rel);
  const folder = match?.[1];
  const id = match?.[2];
  if (folder === undefined || id === undefined) return null;
  return { folder: folder as 'notes' | 'patterns' | 'brand', id };
};

/**
 * The system-relative files a hand edit may ever write (§5.3, §2.11): `tokens.css`, `system.json`,
 * `OVERVIEW.md` and the entry bodies; a re-sync also creates brand files. Never `.chamber`,
 * `.versions`, assets otherwise, components, sources or anything outside the system folder.
 */
export const isSystemEditableRel = (rel: string, options: { resync?: boolean } = {}): boolean =>
  rel === 'tokens.css' ||
  rel === 'system.json' ||
  rel === 'OVERVIEW.md' ||
  (!rel.includes('..') && bodyFileOf(rel) !== null) ||
  (options.resync === true && !rel.includes('..') && RESYNC_ASSET_FILE.test(rel));

// ---- shapes ----

export type SystemUndoStep =
  /** The pipeline's splice step (UTF-16 offsets in the decoded text), on tokens.css. */
  | { kind: 'splice'; file: string; start: number; inserted: number; removed: string; afterSha: string; beforeSha: string }
  /** The whole old text, put back while the file still hashes to `afterSha` (§6.1, up to `SYSTEM_UNDO_TEXT_MAX`). */
  | { kind: 'replace'; file: string; before: string; afterSha: string }
  /** A file the edit created; undo moves it to the trash (never a hard delete) while it still hashes to `sha`. */
  | { kind: 'create'; file: string; sha: string };

export type SystemUndoRecord = {
  id: string;
  at: IsoDate;
  label: string;
  /** The first ledger entry this edit added, or null when it added none (its entries share its `editId`). */
  ledgerSeq: number | null;
  steps: SystemUndoStep[];
};

export type SystemEditsFile = LedgerFile<SystemUndoRecord>;

export const emptySystemEditsFile = (): SystemEditsFile => ({ v: 1, seq: 0, ledger: [], dropped: 0, undo: [] });

// ---- validation (pure) ----

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown, max: number = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const isSha = (value: unknown): value is string => typeof value === 'string' && SHA256_PATTERN.test(value);
const isIso = (value: unknown): value is IsoDate => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const quote = (value: unknown): string | null => (typeof value === 'string' ? clip(oneLine(value), HAND_EDIT_QUOTE_MAX) : null);
const isTokenName = (value: unknown): value is string => typeof value === 'string' && SYSTEM_TOKEN_NAME_PATTERN.test(value);
const isTextFile = (value: unknown): value is string => typeof value === 'string' && (value === 'OVERVIEW.md' || bodyFileOf(value) !== null);

/** One system ledger entry, validated and normalised, or null; `undo` entries are the design ledger's. */
export const parseSystemHandEdit = (value: unknown): HandEdit | null => {
  if (!isObj(value)) return null;
  const { seq, at, editId } = value;
  if (!isCount(seq) || seq < 1 || !isIso(at) || typeof editId !== 'string' || !EDIT_ID_PATTERN.test(editId)) return null;
  const base = { seq, at, editId };
  switch (value.kind) {
    case 'system-token': {
      const before = quote(value.before);
      const after = quote(value.after);
      if (!isTokenName(value.name) || (value.mode !== 'light' && value.mode !== 'dark') || before === null || after === null) return null;
      return { ...base, kind: 'system-token', name: value.name, mode: value.mode, before, after };
    }
    case 'system-token-add':
      return isTokenName(value.name) ? { ...base, kind: 'system-token-add', name: value.name } : null;
    case 'system-token-remove':
      return isTokenName(value.name) ? { ...base, kind: 'system-token-remove', name: value.name } : null;
    case 'system-meta': {
      const what = quote(value.what);
      return what === null || what === '' ? null : { ...base, kind: 'system-meta', what };
    }
    case 'system-text':
      return isTextFile(value.file) ? { ...base, kind: 'system-text', file: value.file } : null;
    case 'undo':
      return parseHandEdit(value);
    default:
      return null;
  }
};

export const parseSystemUndoStep = (value: unknown): SystemUndoStep | null => {
  if (!isObj(value) || typeof value.file !== 'string' || !isSystemEditableRel(value.file, { resync: true })) return null;
  const { file } = value;
  switch (value.kind) {
    case 'splice': {
      const { start, inserted, removed, afterSha, beforeSha } = value;
      if (file !== 'tokens.css' || !isCount(start, SOURCE_TEXT_MAX) || !isCount(inserted, SOURCE_TEXT_MAX)) return null;
      if (typeof removed !== 'string' || removed.length > UNDO_REMOVED_MAX || !isSha(afterSha) || !isSha(beforeSha)) return null;
      return { kind: 'splice', file, start, inserted, removed, afterSha, beforeSha };
    }
    case 'replace': {
      const { before, afterSha } = value;
      if (typeof before !== 'string' || before.length > SYSTEM_UNDO_TEXT_MAX || !isSha(afterSha)) return null;
      return { kind: 'replace', file, before, afterSha };
    }
    case 'create':
      return isSha(value.sha) ? { kind: 'create', file, sha: value.sha } : null;
    default:
      return null;
  }
};

export const parseSystemUndoRecord = (value: unknown): SystemUndoRecord | null => {
  if (!isObj(value)) return null;
  const { id, at, label, ledgerSeq, steps } = value;
  if (typeof id !== 'string' || !EDIT_ID_PATTERN.test(id) || !isIso(at) || typeof label !== 'string') return null;
  if (!(ledgerSeq === null || (isCount(ledgerSeq) && ledgerSeq >= 1))) return null;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > UNDO_STEPS_MAX) return null;
  const parsed: SystemUndoStep[] = [];
  for (const step of steps) {
    const one = parseSystemUndoStep(step);
    if (one === null) return null; // a record with one bad step cannot be undone exactly: drop it whole
    parsed.push(one);
  }
  return { id, at, label: clip(oneLine(label), UNDO_LABEL_MAX), ledgerSeq, steps: parsed };
};

/** The file as far as it validates; `damaged` counts what was dropped (logged, never the content). */
export const parseSystemEditsFile = (value: unknown): { file: SystemEditsFile; damaged: number } => {
  if (!isObj(value) || value.v !== 1) return { file: emptySystemEditsFile(), damaged: 1 };
  let damaged = 0;
  const ledger: HandEdit[] = [];
  for (const entry of Array.isArray(value.ledger) ? value.ledger : []) {
    const one = parseSystemHandEdit(entry);
    if (one === null || (ledger.length > 0 && one.seq <= (ledger.at(-1)?.seq ?? 0))) damaged += 1;
    else ledger.push(one);
  }
  const undo: SystemUndoRecord[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(value.undo) ? value.undo : []) {
    const one = parseSystemUndoRecord(entry);
    if (one === null || ids.has(one.id)) damaged += 1;
    else {
      ids.add(one.id);
      undo.push(one);
    }
  }
  const lastSeq = ledger.at(-1)?.seq ?? 0;
  const seq = isCount(value.seq) ? Math.max(value.seq, lastSeq) : lastSeq;
  const dropped = isCount(value.dropped) ? value.dropped : 0;
  if (!Array.isArray(value.ledger) || !Array.isArray(value.undo) || !isCount(value.seq) || !isCount(value.dropped)) damaged += 1;
  return { file: { v: 1, seq, ledger: ledger.slice(-HAND_EDITS_LEDGER_MAX), dropped, undo }, damaged };
};

// ---- updates (pure) ----

export type NewSystemEdit = { editId: string; at: IsoDate; label: string; bodies: HandEditBody[]; steps: SystemUndoStep[] };

/**
 * One successful system edit: one ledger entry per changed thing (§6.2), all with the edit's id,
 * and one undo record spanning every file (when it has steps), then the prune by age and count.
 */
export const appendSystemEdit = (file: SystemEditsFile, edit: NewSystemEdit, nowMs: number): SystemEditsFile => {
  let current = file;
  let first: number | null = null;
  for (const body of edit.bodies) {
    const appended = appendLedger(current, { ...body, at: edit.at, editId: edit.editId }, parseSystemHandEdit);
    current = appended.file;
    first ??= appended.seq;
  }
  if (edit.steps.length === 0) return pruneUndo(current, nowMs);
  const record: SystemUndoRecord = { id: edit.editId, at: edit.at, label: clip(oneLine(edit.label), UNDO_LABEL_MAX), ledgerSeq: first, steps: edit.steps };
  return pruneUndo({ ...current, undo: [...current.undo.filter((one) => one.id !== record.id), record] }, nowMs);
};

/**
 * After an undo: the record is gone; its ledger entries are removed while they are still unsent
 * (they are appended together, so they are sent together), else an `undo` entry is appended.
 */
export const applySystemUndone = (file: SystemEditsFile, record: SystemUndoRecord, at: IsoDate, nowMs: number): SystemEditsFile => {
  const undo = file.undo.filter((one) => one.id !== record.id);
  const unsent = file.ledger.some((entry) => entry.editId === record.id && entry.kind !== 'undo');
  if (unsent) return pruneUndo({ ...file, undo, ledger: file.ledger.filter((entry) => entry.editId !== record.id) }, nowMs);
  const { file: withLedger } = appendLedger({ ...file, undo }, { kind: 'undo', of: record.label, at, editId: record.id }, parseSystemHandEdit);
  return pruneUndo(withLedger, nowMs);
};

// ---- the queue ----

export type SystemEditsFileStore = QueueFileStore<SystemEditsFile>;

/** `<system>/.chamber/edits.json`, keyed by system id; the system folder is never re-created. */
export const createSystemEditsFile = (deps: { log: Logger }): SystemEditsFileStore =>
  createQueueFile<SystemEditsFile>({
    log: deps.log,
    segments: EDITS_FILE_SEGMENTS,
    maxBytes: SYSTEM_EDITS_FILE_MAX_BYTES,
    empty: emptySystemEditsFile,
    parse: (value) => parseSystemEditsFile(value),
    serialize: (file) => serializeEditsFile(file, SYSTEM_EDITS_FILE_MAX_BYTES),
    goneMessage: SYSTEM_GONE_MESSAGE,
    logPrefix: 'systems.edits',
    keyField: 'system',
  });
