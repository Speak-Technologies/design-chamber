// A design system's hand edits (documentation/specs/phase-2-5-technical.md §5.3, §6.1, §6.2, AD-4;
// the Phase 2 user-edit rules E1 to E12 read with "system" in place of "design").
//
//   apply(id, save):
//     repo-backed → 422 read-only before anything (AD-20, the store's refuseReadOnly)
//     → systemVersions.userEdit (the system's chain, its store lock):
//         precheck: every stamp equals the file's sha now (E4); metadata applied to the parsed
//                   system.json; tokens planned and verified (§6.1); texts checked against their
//                   caps; every step inside the writable set (E7). Nothing written, no version.
//         version first ("Before your edits", coalesced, E3)
//         apply:    the steps through the shared executor (compare-and-swap, no-replace creates,
//                   self-write records, rollback newest first); `system files` events with
//                   `origin: "user"` (E8, E10); the undo record and one ledger entry per changed
//                   thing; the review fingerprints of the sections the save changed re-recorded.
//     → the revision settles (outside the chain: it takes the store lock itself).
//   undo(id, editId): the recorded reverse steps through the same chain, each guarded by the hash
//                   the edit left (E9); a re-sync's undo also puts its provenance back.
//
//   apply(id, resync) (§6.3, S4; internal home only, the repo flavour is `snapshot.ts`):
//     the scan job's memory (`ResyncSource`: values, root, the stamp its review was made against)
//     → the chain: the root and the stamp checked again, the review rebuilt from the files and
//       provenance now, every tick inside its list (a removal only from "No longer in the code",
//       which never holds an agent's or the user's token, nor one from a file the scan did not read)
//     → version first ("Before re-sync", never coalesced) → token values set, added, removed;
//       system.json metadata of added and removed tokens and the copied fonts and logos (notes,
//       overview, existing fonts and assets untouched) → state.json provenance and code source
//     → the revision settles outside the chain (the store lock is not re-entrant).
//
// E1: nothing here is reachable from a frame; the only callers are the routes, which only the
// page and the rail call, from Design Chamber's own controls.

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { MetaChange, SystemEditRequest, SystemEditResponse, SystemEditStamps, SystemResyncResponse, SystemTextFile, SystemUndoEditResponse, TokenEdit } from '../../shared/api.ts';
import {
  EDIT_ID_PATTERN,
  SCAN_ID_PATTERN,
  SHA256_PATTERN,
  SYSTEM_JSON_MAX_BYTES,
  SYSTEM_NOTE_MAX,
  SYSTEM_OVERVIEW_MAX,
  SYSTEM_TOKEN_NAME_PATTERN,
  SYSTEM_TOKEN_VALUE_MAX,
  SYSTEM_TOKENS_MAX,
  SYSTEM_UNDO_TEXT_MAX,
  TOKENS_CSS_MAX_BYTES,
} from '../../shared/limits.ts';
import { buildSystemDetail, parseSystemJson, RESYNC_STAMP_PATTERN, resyncStampOf, safeAssetName, sectionFingerprints, SYSTEM_SECTIONS, SYSTEM_TOKEN_RULES, type SystemTokenRules } from '../../shared/system-json.ts';
import { planTokenEdit, verifyTokenEdit, NOT_EXACT_SENTENCE } from '../../shared/token-edit.ts';
import type { JsonObject, JsonValue, SystemSection, SystemState, TokenSection } from '../../shared/types.ts';
import type { ChangeHub, Logger, SelfWrites, ServiceContext, SettingsStore } from '../context.ts';
import { codeOf, createStepExecutor, executeSteps, ROLLED_BACK_MESSAGE, sha256, type ExecPlace, type ExecRun, type MoveAlternatives } from '../edits/execute.ts';
import { clearLedger, findUndo, UNDO_STEPS_MAX } from '../edits/file.ts';
import type { HandEditBody } from '../edits/op-module.ts';
import { FILE_TOO_LARGE_MESSAGE, NOT_UTF8_MESSAGE } from '../edits/ops-text.ts';
import { UNDO_STALE_MESSAGE } from '../edits/pipeline.ts';
import { ensureTrashDir, TRASH_PREFIX, TRASH_SUFFIX_MAX, trashStampOf } from '../edits/trash.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE, resolvePlainTarget, samePath } from '../paths.ts';
import { folderErrorSentence } from '../root.ts';
import { toSummary, type VersionsService, type WrittenFile } from '../versions.ts';
import { systemSelfWritesKey } from '../watch.ts';
import { checkAsset, ensureFolder, FOLDER_OF_KIND, guessFontFace, guessLogoVariant } from './assets.ts';
import { applyMetaChange, describeMeta, isMetaPath } from './edit-meta.ts';
import {
  appendSystemEdit,
  applySystemUndone,
  bodyFileOf,
  createSystemEditsFile,
  isSystemEditableRel,
  withResyncUndone,
  type SystemEditsFileStore,
  type SystemResyncUndo,
  type SystemUndoRecord,
  type SystemUndoStep,
} from './edits-file.ts';
import { ASSET_READ_MAX, ensureScanJobs, readProjectFile, RESYNC_ROOT_CHANGED_MESSAGE, SCAN_GONE_MESSAGE, type ResyncSource, type ScanJobs } from './extract.ts';
import { colourGroupOf, resyncReview } from './extract-rules.ts';
import { ensureSystemStore, refuseReadOnly, SYSTEM_GONE_MESSAGE, type SystemStore } from './store.ts';
import { ensureSystemVersions } from './versions.ts';

// ---- sentences ----

export const SYSTEM_BAD_EDIT_MESSAGE = "Design Chamber couldn't read that edit. Nothing was saved.";
export const OVERVIEW_EMPTY_MESSAGE = 'Write something in the overview, or leave it as it was.';
export const OVERVIEW_TOO_LONG_MESSAGE = 'Keep the overview under 4 000 characters. Move detail into a note.';
export const BODY_TOO_LONG_MESSAGE = 'Keep this text under 20 000 characters.';
export const SYSTEM_JSON_UNREADABLE_MESSAGE = "system.json can't be read, so these notes can't be changed here. Ask the agent to fix it.";
export const BODY_ENTRY_GONE_MESSAGE = 'This entry is no longer in system.json. Reload and try again.';
export const UNDO_NOT_KEPT_NOTICE = "Restore 'Before your edits' from Versions to undo.";
const BAD_TEXT_MESSAGE = "That text has characters that can't be saved.";
/** Half of a surrogate pair on its own: it cannot be written as UTF-8 (it would become U+FFFD). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const UNDO_GONE = "This edit can't be undone any more.";

/** E4 for a system: "Acme changed while you were editing. Nothing was saved." */
export const systemStaleMessage = (name: string): string => `${name} changed while you were editing. Nothing was saved.`;

const partWayMessage = "Something went wrong part way. The version 'Before your edits' holds everything as it was; restore it from Versions.";
const resyncPartWayMessage = "Something went wrong part way. The version 'Before re-sync' holds everything as it was; restore it from Versions.";
export const RESYNC_UNDO_NOT_KEPT_NOTICE = "Restore 'Before re-sync' from Versions to undo.";

// ---- request shape (pure) ----

/** Token edits, metadata changes and texts one save may carry (§6.2). */
export const SYSTEM_EDIT_TOKENS_MAX = 200;
export const SYSTEM_EDIT_META_MAX = 200;
export const SYSTEM_EDIT_TEXTS_MAX = 10;

type SaveRequest = Extract<SystemEditRequest, { op: 'save' }>;
type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const bad = (): never => {
  throw new ApiError('bad-request', SYSTEM_BAD_EDIT_MESSAGE);
};
const stampOf = (value: unknown): string | null => (value === null ? null : typeof value === 'string' && SHA256_PATTERN.test(value) ? value : bad());
const isTextFileName = (value: unknown): value is SystemTextFile => typeof value === 'string' && (value === 'OVERVIEW.md' || bodyFileOf(value) !== null);

const tokenEdit = (value: unknown): TokenEdit => {
  if (!isObj(value) || typeof value.name !== 'string' || !SYSTEM_TOKEN_NAME_PATTERN.test(value.name)) return bad();
  const { name, mode } = value;
  const textValue = (): string =>
    typeof value.value === 'string' && value.value.length >= 1 && value.value.length <= SYSTEM_TOKEN_VALUE_MAX ? value.value : bad();
  switch (value.kind) {
    case 'set':
    case 'add':
      if (mode !== 'light' && mode !== 'dark') return bad();
      return { kind: value.kind, name, mode, value: textValue() };
    case 'remove':
      if (mode !== 'light' && mode !== 'dark' && mode !== 'both') return bad();
      return { kind: 'remove', name, mode };
    default:
      return bad();
  }
};

const metaChange = (value: unknown): MetaChange => {
  if (!isObj(value) || !isMetaPath(value.at)) return bad();
  const v = value.value;
  if (!(v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= SYSTEM_NOTE_MAX))) return bad();
  return { at: value.at, value: v };
};

/**
 * `POST /systems/:id/edits` as a fresh, fully typed `save` (only known keys), or 400 with one
 * sentence. Rules that need the files (stamps, caps, entries, value shapes) are checked inside the chain.
 */
export const parseSystemEditRequest = (body: unknown): SaveRequest => {
  if (!isObj(body)) return bad();
  if (body.op === 'resync') throw new ApiError('bad-request', 'A re-sync goes through its own review. Scan the project again.');
  if (body.op !== 'save' || !isObj(body.stamps)) return bad();
  const list = <T>(value: unknown, max: number, item: (one: unknown) => T): T[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > max) return bad();
    return value.map(item);
  };
  const tokens = list(body.tokens, SYSTEM_EDIT_TOKENS_MAX, tokenEdit);
  const meta = list(body.meta, SYSTEM_EDIT_META_MAX, metaChange);
  const texts = list(body.texts, SYSTEM_EDIT_TEXTS_MAX, (one) => {
    if (!isObj(one) || !isTextFileName(one.file) || typeof one.text !== 'string' || one.text.length > SYSTEM_NOTE_MAX * 2) return bad();
    return { file: one.file, text: one.text };
  });
  if ((tokens?.length ?? 0) + (meta?.length ?? 0) + (texts?.length ?? 0) === 0) return bad();
  if (texts !== undefined && new Set(texts.map((one) => one.file)).size !== texts.length) return bad();

  const raw = body.stamps;
  const stamps: SaveRequest['stamps'] = {};
  if (tokens !== undefined && tokens.length > 0) {
    if (!('tokens' in raw)) return bad();
    stamps.tokens = stampOf(raw.tokens);
  }
  if (meta !== undefined && meta.length > 0) {
    if (!('systemJson' in raw)) return bad();
    stamps.systemJson = stampOf(raw.systemJson);
  }
  if (texts !== undefined && texts.length > 0) {
    const rawTexts = raw.texts;
    if (!isObj(rawTexts)) return bad();
    const textStamps: Record<string, string | null> = {};
    for (const { file } of texts) {
      if (!Object.hasOwn(rawTexts, file)) return bad();
      textStamps[file] = stampOf(rawTexts[file]);
    }
    stamps.texts = textStamps;
  }
  return {
    op: 'save',
    stamps,
    ...(tokens !== undefined && tokens.length > 0 ? { tokens } : {}),
    ...(meta !== undefined && meta.length > 0 ? { meta } : {}),
    ...(texts !== undefined && texts.length > 0 ? { texts } : {}),
  };
};

// ---- the re-sync request (pure, §6.3) ----

type ResyncRequest = Extract<SystemEditRequest, { op: 'resync' }>;

/** New font and logo files one re-sync may copy (the scan offers ≤ 20 of each). */
export const RESYNC_ASSETS_MAX = 40;
export const RESYNC_NOTHING_TICKED_MESSAGE = 'Nothing is ticked, so there is nothing to apply.';
const PROJECT_PATH_MAX = 4096;

/** "Acme changed after the scan…": the review no longer describes the files (409 stale, **Scan again**). */
export const resyncStaleMessage = (name: string): string => `${name} changed after the scan, so nothing was changed. Scan again.`;

/**
 * `POST /systems/:id/resync` (internal home) as a fresh, fully typed request, or 400 with one sentence.
 * It names token names and project paths only, never values: every value comes from the scan's memory.
 * Whether each name and path is in the review is the apply's rule (inside the chain).
 */
export const parseSystemResyncRequest = (body: unknown): ResyncRequest => {
  if (!isObj(body)) return bad();
  const { scanId, stamp } = body;
  if (typeof scanId !== 'string' || !SCAN_ID_PATTERN.test(scanId)) return bad();
  if (typeof stamp !== 'string' || !RESYNC_STAMP_PATTERN.test(stamp)) return bad();
  const names = (value: unknown): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > SYSTEM_TOKENS_MAX) return bad();
    const list = value.map((one: unknown) => (typeof one === 'string' && SYSTEM_TOKEN_NAME_PATTERN.test(one) ? one : bad()));
    return new Set(list).size === list.length ? list : bad();
  };
  const changes = names(body.changes);
  const add = names(body.add);
  const remove = names(body.remove);
  const useCode = names(body.useCode);
  if (body.assets !== undefined && (!Array.isArray(body.assets) || body.assets.length > RESYNC_ASSETS_MAX)) return bad();
  const assets = ((body.assets ?? []) as unknown[]).map((one) =>
    typeof one === 'string' && one.length >= 1 && one.length <= PROJECT_PATH_MAX && !/[\u0000-\u001f\u007f]/.test(one) ? one : bad(),
  );
  if (new Set(assets).size !== assets.length) return bad();
  if (changes.length + add.length + remove.length + useCode.length + assets.length === 0) throw new ApiError('bad-request', RESYNC_NOTHING_TICKED_MESSAGE);
  return { op: 'resync', scanId, stamp, changes, add, remove, useCode, assets };
};

// ---- the service ----

export type SystemEditService = {
  /** A `save` answers `SystemEditResponse`; a `resync` answers `SystemResyncResponse` (its counts added). */
  apply(id: string, request: SystemEditRequest): Promise<SystemEditResponse>;
  /** The internal-home re-sync (§6.3), typed. */
  resync(id: string, request: ResyncRequest): Promise<SystemResyncResponse>;
  undo(id: string, editId: string): Promise<SystemUndoEditResponse>;
  clearHandEdits(id: string, upTo: number): Promise<void>;
  /** The system's edits.json queue (the prompt builder reads the ledger through it). */
  editsFile: SystemEditsFileStore;
};

export type SystemEditDeps = {
  systems: Pick<SystemStore, 'dir' | 'get' | 'readState' | 'updateStateLocked' | 'settleRevision'>;
  /** The system history (T2): its `userEdit` runs on the system's chain and takes the version first. */
  versions: Pick<VersionsService, 'userEdit'>;
  hub: ChangeHub;
  selfWrites: SelfWrites;
  settings: Pick<SettingsStore, 'root'>;
  log: Logger;
  now?: () => Date;
  pause?: (ms: number) => Promise<void>;
  editsFile?: SystemEditsFileStore;
  rules?: SystemTokenRules;
  /** The scan jobs a re-sync reads its values from (§6.3); absent → no scan is ever found (404). */
  scans?: Pick<ScanJobs, 'resyncSource'>;
};

/** `e_` + 20 hex characters (inside `EDIT_ID_PATTERN`). */
const mintEditId = (): string => `e_${randomBytes(10).toString('hex')}`;

/** One step this service executes: a compare-and-swap write or a no-replace create. */
type SystemStep =
  | { kind: 'write'; rel: string; expectSha: string; bytes: Uint8Array; reverse: SystemUndoStep; record: SystemUndoStep[] | null }
  | { kind: 'create'; rel: string; bytes: Uint8Array; reverse: SystemUndoStep; record: SystemUndoStep[] | null };

type Done = { reverse: SystemUndoStep; record: SystemUndoStep[] | null };

type Run = ExecRun & { id: string; dir: string; written: WrittenFile[]; files: Set<string>; stamps: SystemEditStamps };

/** The section system.json gives a token (`tokens.<name>.section`), or null. */
const sectionInRaw = (raw: JsonObject | null, name: string): TokenSection | null => {
  const tokenNotes = raw?.tokens;
  if (typeof tokenNotes !== 'object' || tokenNotes === null || Array.isArray(tokenNotes) || !Object.hasOwn(tokenNotes, name)) return null;
  const entry = tokenNotes[name];
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || !Object.hasOwn(entry, 'section')) return null;
  const section = entry.section;
  return section === 'colours' || section === 'typography' || section === 'spacing' || section === 'radius' || section === 'shadows' || section === 'layers' || section === 'sizes' || section === 'other'
    ? section
    : null;
};

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

type FileRead = { kind: 'absent' } | { kind: 'link' } | { kind: 'too-large' } | { kind: 'read'; bytes: Buffer; text: string; utf8: boolean };

/** `.trash/system.<id>.<file with / as .>-<stamp>[-n]<ext>`: a dot never occurs in a slug, and these hold more dots than a trashed system folder. */
const SYSTEM_TRASH_NAME = /^system\.([a-z0-9][a-z0-9-]{0,62})\.([A-Za-z0-9._ -]{1,120})-([0-9]{14})(?:-([0-9]{1,2}))?(\.[a-z0-9]{1,10})?$/;

const trashPlaceFor = (id: string, rel: string, stamp: string, n = 1): string => {
  const extension = path.extname(rel).toLowerCase();
  const stem = rel.slice(0, rel.length - path.extname(rel).length).replace(/\//g, '.');
  return `${TRASH_PREFIX}system.${id}.${stem}-${stamp}${n > 1 ? `-${n}` : ''}${extension}`;
};

const isOwnSystemTrashPlace = (place: string, id: string): boolean => {
  if (!place.startsWith(TRASH_PREFIX)) return false;
  const match = SYSTEM_TRASH_NAME.exec(place.slice(TRASH_PREFIX.length));
  return match !== null && match[1] === id && !place.includes('..');
};

const nextSystemTrashPlace = (place: string): string | null => {
  const match = SYSTEM_TRASH_NAME.exec(place.slice(TRASH_PREFIX.length));
  if (match === null) return null;
  const [, id = '', stem = '', stamp = '', suffix, extension = ''] = match;
  const n = suffix === undefined ? 1 : Number(suffix);
  if (n >= TRASH_SUFFIX_MAX) return null;
  return `${TRASH_PREFIX}system.${id}.${stem}-${stamp}-${n + 1}${extension}`;
};

const SYSTEM_TRASH_ALTERNATIVES: MoveAlternatives = { renamable: (place) => place.startsWith(TRASH_PREFIX), next: nextSystemTrashPlace };

const stampKeyOf = (rel: string): 'tokens' | 'systemJson' | 'text' => (rel === 'tokens.css' ? 'tokens' : rel === 'system.json' ? 'systemJson' : 'text');

export const createSystemEditService = (deps: SystemEditDeps): SystemEditService => {
  const { systems, versions, hub, selfWrites, settings, log, scans } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const pause = deps.pause ?? ((ms: number) => delay(ms));
  const editsFile = deps.editsFile ?? createSystemEditsFile({ log });
  const rules = deps.rules ?? SYSTEM_TOKEN_RULES;
  const exec = createStepExecutor({ selfWrites, pause });

  /** `resync`: the run may also create (and an undo trash) the brand files a re-sync copied (§5.3). */
  const newRun = (id: string, dir: string, staleMessage: string, options: { resync?: boolean } = {}): Run => {
    let trash: Promise<string> | null = null;
    const run: Run = {
      key: systemSelfWritesKey(id),
      id,
      dir,
      staleMessage,
      written: [],
      files: new Set(),
      stamps: {},
      resolve: async (place, allowAbsent): Promise<ExecPlace> => {
        if (place.startsWith(TRASH_PREFIX)) {
          if (!isOwnSystemTrashPlace(place, id)) throw new ApiError('internal', ROLLED_BACK_MESSAGE);
          trash ??= ensureTrashDir(settings.root());
          return { abs: await resolvePlainTarget(await trash, [place.slice(TRASH_PREFIX.length)], { allowAbsent }), rel: null };
        }
        if (!isSystemEditableRel(place, { resync: options.resync === true })) throw new ApiError('internal', ROLLED_BACK_MESSAGE);
        return { abs: await resolvePlainTarget(dir, place.split('/'), { allowAbsent }), rel: place };
      },
      noteWrite: (rel, bytes) => {
        if (rel === null) return;
        run.written.push([rel, bytes]);
        run.files.add(rel);
        // Brand files carry no edit stamp (only tokens.css, system.json and the texts do).
        if (bytes === null || !isSystemEditableRel(rel)) return;
        const key = stampKeyOf(rel);
        if (key === 'text') run.stamps.texts = { ...run.stamps.texts, [rel]: sha256(bytes) };
        else run.stamps[key] = sha256(bytes);
      },
    };
    return run;
  };

  /** A system file as it is now: link, size, then the bytes (and whether they are plain UTF-8). */
  const readSystemFile = async (dir: string, rel: string, maxBytes: number): Promise<FileRead> => {
    let file: string;
    try {
      file = await resolvePlainTarget(dir, rel.split('/'), { allowAbsent: true });
    } catch (error) {
      if (error instanceof ApiError) return { kind: 'link' };
      throw error;
    }
    try {
      if ((await stat(file)).size > maxBytes) return { kind: 'too-large' };
      const bytes = await readFile(file);
      if (bytes.length > maxBytes) return { kind: 'too-large' };
      const text = bytes.toString('utf8');
      return { kind: 'read', bytes, text, utf8: Buffer.from(text, 'utf8').equals(bytes) };
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { kind: 'absent' };
      throw error;
    }
  };

  /** The file's text after the stamp check (E4), or null when it is absent (stamp null). */
  const readStamped = async (dir: string, rel: string, maxBytes: number, stamp: string | null | undefined, staleMessage: string): Promise<{ text: string; bytes: Buffer } | null> => {
    const file = await readSystemFile(dir, rel, maxBytes);
    if (file.kind === 'link') throw new ApiError('invalid', LINK_SENTENCE);
    if (file.kind === 'too-large') throw new ApiError('too-large', FILE_TOO_LARGE_MESSAGE);
    const actual = file.kind === 'absent' ? null : sha256(file.bytes);
    if (actual !== (stamp ?? null)) throw new ApiError('stale', staleMessage);
    if (file.kind === 'absent') return null;
    if (!file.utf8) throw new ApiError('invalid', NOT_UTF8_MESSAGE);
    return { text: file.text, bytes: file.bytes };
  };

  /** The section fingerprints of the system as it is now (§2.5). */
  const fingerprintsOf = async (id: string): Promise<Record<SystemSection, string>> => {
    const source = await systems.get(id);
    return sectionFingerprints(buildSystemDetail(source, rules), source.hashes ?? {});
  };

  /**
   * §2.5: the user's own save keeps their sections reviewed. A section the save changed whose
   * recorded review (or Mark ready fingerprint) still matched before the save follows the new
   * fingerprint; a section someone else changed earlier stays Not reviewed.
   */
  const rerecord = (state: SystemState, before: Record<SystemSection, string>, after: Record<SystemSection, string>): SystemState | null => {
    let changed = false;
    const review = { ...state.review };
    const ready = state.readyFingerprints === null ? null : { ...state.readyFingerprints };
    for (const section of SYSTEM_SECTIONS) {
      if (before[section] === after[section]) continue;
      const recorded = review[section];
      if (recorded !== undefined && recorded.fingerprint === before[section]) {
        review[section] = { ...recorded, fingerprint: after[section] };
        changed = true;
      }
      if (ready !== null && ready[section] === before[section]) {
        ready[section] = after[section];
        changed = true;
      }
    }
    return changed ? { ...state, review, readyFingerprints: ready } : null;
  };

  const announce = (run: Run): void => {
    const files = [...run.files].sort();
    if (files.length > 0) hub.emit({ slug: null, kind: 'system', system: run.id, systemChange: 'files', files, origin: 'user' });
  };

  /** A raw filesystem error as the user's sentence (logged with its code only, never content). */
  const asUserError = async (id: string, dir: string, op: string, error: unknown): Promise<unknown> => {
    if (error instanceof ApiError) return error;
    if (codeOf(error) === 'ENOENT') {
      const left = await stat(dir).then((info) => info.isDirectory(), () => false);
      if (!left) return new ApiError('not-found', SYSTEM_GONE_MESSAGE);
    }
    log.error('systems.edits.write-failed', { system: id, op, code: codeOf(error) ?? 'error' });
    return new ApiError('internal', folderErrorSentence(error, dir));
  };

  // ---- planning a save (inside the chain; writes nothing) ----

  type Plan = { label: string; detail?: string; steps: SystemStep[]; bodies: HandEditBody[]; undoable: boolean };

  /** The steps of one file's new text: a CAS write (or a create when it was absent), with its undo. */
  const textStep = (rel: string, old: { text: string; bytes: Buffer } | null, next: string): SystemStep => {
    const bytes = Buffer.from(next, 'utf8');
    const afterSha = sha256(bytes);
    if (old === null) {
      const undo: SystemUndoStep = { kind: 'create', file: rel, sha: afterSha };
      return { kind: 'create', rel, bytes, reverse: undo, record: [undo] };
    }
    const reverse: SystemUndoStep = { kind: 'replace', file: rel, before: old.text, afterSha };
    return { kind: 'write', rel, expectSha: sha256(old.bytes), bytes, reverse, record: old.text.length <= SYSTEM_UNDO_TEXT_MAX ? [reverse] : null };
  };

  const planSave = async (dir: string, state: SystemState, request: SaveRequest): Promise<Plan> => {
    const stale = systemStaleMessage(state.name);
    const steps: SystemStep[] = [];
    const bodies: HandEditBody[] = [];

    // Every stamp first (E4): nothing is planned against a file that moved on.
    const json = request.meta !== undefined || request.texts?.some((one) => one.file !== 'OVERVIEW.md') === true;
    const jsonStamped = request.meta !== undefined;
    const tokensFile = request.tokens === undefined ? null : await readStamped(dir, 'tokens.css', TOKENS_CSS_MAX_BYTES, request.stamps.tokens, stale);
    const systemJsonFile = jsonStamped
      ? await readStamped(dir, 'system.json', SYSTEM_JSON_MAX_BYTES, request.stamps.systemJson, stale)
      : json
        ? await readSystemFile(dir, 'system.json', SYSTEM_JSON_MAX_BYTES).then((file) => (file.kind === 'read' && file.utf8 ? { text: file.text, bytes: file.bytes } : null))
        : null;
    const textFiles = new Map<string, { text: string; bytes: Buffer } | null>();
    for (const { file } of request.texts ?? []) {
      const max = (file === 'OVERVIEW.md' ? SYSTEM_OVERVIEW_MAX : SYSTEM_NOTE_MAX) * 4;
      textFiles.set(file, await readStamped(dir, file, max, request.stamps.texts?.[file], stale));
    }

    // system.json: the metadata, applied to a fresh copy of the parsed object (unknown keys kept).
    let raw: JsonObject | null = null;
    if (systemJsonFile !== null) raw = parseSystemJson(systemJsonFile.text).raw;
    if (request.meta !== undefined) {
      if (systemJsonFile === null || raw === null) throw new ApiError('invalid', SYSTEM_JSON_UNREADABLE_MESSAGE);
      const next = structuredClone(raw);
      for (const change of request.meta) {
        const refused = applyMetaChange(next, change, stale);
        if (refused !== null) throw new ApiError(refused.code, refused.sentence);
      }
      const text = `${JSON.stringify(next, null, 2)}\n`;
      if (text !== systemJsonFile.text) {
        steps.push(textStep('system.json', systemJsonFile, text));
        for (const change of request.meta) bodies.push({ kind: 'system-meta', what: describeMeta(change.at) });
      }
      raw = next;
    }

    // tokens.css: planned against the bytes read, then verified (§6.1).
    if (request.tokens !== undefined) {
      const css = tokensFile?.text ?? '';
      const plan = planTokenEdit(css, request.tokens, { contexts: 'system', sectionOf: (name) => sectionInRaw(raw, name) });
      if ('refusal' in plan) throw new ApiError('invalid', plan.refusal);
      if (!verifyTokenEdit(css, plan.result, request.tokens)) throw new ApiError('invalid', NOT_EXACT_SENTENCE);
      if (plan.result !== css) {
        const bytes = Buffer.from(plan.result, 'utf8');
        const afterSha = sha256(bytes);
        if (tokensFile === null) {
          const undo: SystemUndoStep = { kind: 'create', file: 'tokens.css', sha: afterSha };
          steps.push({ kind: 'create', rel: 'tokens.css', bytes, reverse: undo, record: [undo] });
        } else {
          const beforeSha = sha256(tokensFile.bytes);
          let record: SystemUndoStep[] | null = null;
          if (plan.undo?.kind === 'replace') record = [{ kind: 'replace', file: 'tokens.css', before: plan.undo.before, afterSha }];
          else if (plan.undo?.kind === 'splices') {
            // Each splice in the text the previous one left: hash the chain of intermediate texts.
            record = [];
            let text = css;
            let previousSha = beforeSha;
            for (const splice of plan.undo.splices) {
              text = `${text.slice(0, splice.start)}${splice.inserted}${text.slice(splice.start + splice.removed.length)}`;
              const nextSha = sha256(Buffer.from(text, 'utf8'));
              record.push({ kind: 'splice', file: 'tokens.css', start: splice.start, inserted: splice.inserted.length, removed: splice.removed, afterSha: nextSha, beforeSha: previousSha });
              previousSha = nextSha;
            }
            if (text !== plan.result) record = null;
          }
          steps.push({ kind: 'write', rel: 'tokens.css', expectSha: beforeSha, bytes, reverse: { kind: 'replace', file: 'tokens.css', before: css, afterSha }, record });
        }
        const named = new Set<string>();
        for (const change of plan.changes) {
          if (change.before !== null && change.after !== null) bodies.push({ kind: 'system-token', name: change.name, mode: change.mode, before: change.before, after: change.after });
          else if (!named.has(`${change.after === null ? 'remove' : 'add'}\u0000${change.name}`)) {
            named.add(`${change.after === null ? 'remove' : 'add'}\u0000${change.name}`);
            bodies.push(change.after === null ? { kind: 'system-token-remove', name: change.name } : { kind: 'system-token-add', name: change.name });
          }
        }
      }
    }

    // Texts: the overview (may be created) and the bodies of entries system.json lists.
    for (const { file, text } of request.texts ?? []) {
      if (text.includes('\u0000') || LONE_SURROGATE.test(text)) throw new ApiError('invalid', BAD_TEXT_MESSAGE);
      if (file === 'OVERVIEW.md') {
        if (text.trim() === '') throw new ApiError('invalid', OVERVIEW_EMPTY_MESSAGE);
        if (text.length > SYSTEM_OVERVIEW_MAX) throw new ApiError('invalid', OVERVIEW_TOO_LONG_MESSAGE);
      } else {
        if (text.length > SYSTEM_NOTE_MAX) throw new ApiError('invalid', BODY_TOO_LONG_MESSAGE);
        const body = bodyFileOf(file);
        if (raw === null) throw new ApiError('invalid', SYSTEM_JSON_UNREADABLE_MESSAGE);
        const list = Object.hasOwn(raw, body?.folder ?? '') ? raw[body?.folder ?? ''] : undefined;
        const listed = Array.isArray(list) && list.some((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && Object.hasOwn(entry, 'id') && entry.id === body?.id);
        if (!listed) throw new ApiError('stale', BODY_ENTRY_GONE_MESSAGE);
      }
      const old = textFiles.get(file) ?? null;
      if (old !== null && old.text === text) continue;
      steps.push(textStep(file, old, text));
      bodies.push({ kind: 'system-text', file });
    }

    // Every step inside the writable set (E7): a bug here refuses the whole plan before the version.
    if (!steps.every((step) => isSystemEditableRel(step.rel))) {
      log.error('systems.edits.plan-refused', { op: 'save' });
      throw new ApiError('internal', ROLLED_BACK_MESSAGE);
    }

    const removedOnly =
      request.tokens !== undefined &&
      request.tokens.every((edit) => edit.kind === 'remove') &&
      request.texts === undefined &&
      (request.meta ?? []).every((change) => change.at.length === 2 || change.at[2] === undefined);
    const removedNames = [...new Set((request.tokens ?? []).map((edit) => edit.name))];
    const label = removedOnly
      ? `Removed ${removedNames.length === 1 ? (removedNames[0] ?? 'a token') : `${removedNames.length} tokens`} from ${state.name}. Designs that copied ${state.name} keep it.`
      : `Saved to ${state.name}`;
    const undoable = steps.length > 0 && steps.every((step) => step.record !== null);
    return { label, ...(steps.length === 0 ? { detail: 'Nothing changed.' } : undoable ? {} : { detail: UNDO_NOT_KEPT_NOTICE }), steps, bodies, undoable };
  };

  // ---- planning a re-sync (inside the chain; writes nothing, §6.3) ----

  type ResyncPlan = {
    steps: SystemStep[];
    /** Asset folders to make before the steps run (`assets/fonts`, `assets/logos`). */
    folders: (readonly string[])[];
    provenance: SystemState['provenance'];
    undoState: SystemResyncUndo;
    code: NonNullable<SystemState['sources']['code']>;
    counts: SystemResyncResponse['counts'];
    directoryChanged: boolean;
    label: string;
  };

  /** A tracked file the re-sync rewrites: read, refused when it is a link, too large or not UTF-8. */
  const readResyncFile = async (dir: string, rel: string, maxBytes: number): Promise<{ text: string; bytes: Buffer } | null> => {
    const file = await readSystemFile(dir, rel, maxBytes);
    if (file.kind === 'link') throw new ApiError('invalid', LINK_SENTENCE);
    if (file.kind === 'too-large') throw new ApiError('too-large', FILE_TOO_LARGE_MESSAGE);
    if (file.kind === 'absent') return null;
    if (!file.utf8) throw new ApiError('invalid', NOT_UTF8_MESSAGE);
    return { text: file.text, bytes: file.bytes };
  };

  /** File names already in a system asset folder (none when it is absent). */
  const namesIn = async (dir: string, segments: readonly string[]): Promise<string[]> => {
    return readdir(path.join(dir, ...segments)).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return [];
      throw error;
    });
  };

  const planResync = async (id: string, dir: string, state: SystemState, request: ResyncRequest, source: ResyncSource): Promise<ResyncPlan> => {
    const stale = resyncStaleMessage(state.name);
    const scan = source.result;

    // The files as they are now must be the ones the review was made against.
    const tokensFile = await readResyncFile(dir, 'tokens.css', TOKENS_CSS_MAX_BYTES);
    const systemJsonFile = await readResyncFile(dir, 'system.json', SYSTEM_JSON_MAX_BYTES);
    const stampNow = resyncStampOf({ tokens: tokensFile === null ? null : sha256(tokensFile.bytes), systemJson: systemJsonFile === null ? null : sha256(systemJsonFile.bytes) });
    if (stampNow !== source.stamp || request.stamp !== source.stamp) throw new ApiError('stale', stale);

    // The review rebuilt from the system now; every tick must be in its own list.
    const detail = buildSystemDetail(await systems.get(id), rules);
    const review = resyncReview(detail, state.provenance, { tokens: scan.tokens, scanned: scan.scanned, assets: scan.assets, partial: scan.summary.partial });
    const inList = (ticked: readonly string[], listed: Iterable<string>): boolean => {
      const offered = new Set(listed);
      return ticked.every((one) => offered.has(one));
    };
    if (
      !inList(request.changes, review.changed.map((one) => one.name)) ||
      !inList(request.useCode, review.conflicts.map((one) => one.name)) ||
      !inList(request.add, review.added) ||
      !inList(request.remove, review.removed) ||
      !inList(request.assets, review.assets.map((one) => one.path))
    ) {
      throw new ApiError('stale', stale);
    }

    const scanned = new Map(scan.tokens.map((token) => [token.name, token]));
    const mine = new Map(detail.tokens.map((token) => [token.name, token]));
    const raw: JsonObject | null = systemJsonFile === null ? null : parseSystemJson(systemJsonFile.text).raw;

    // tokens.css: values only (§6.3). Changed and "Use the code's" set the code's value; New adds both
    // modes the code has; a ticked removal takes both modes.
    const edits: TokenEdit[] = [];
    for (const name of request.changes) for (const one of review.changed) if (one.name === name) edits.push({ kind: 'set', name, mode: one.mode, value: one.to });
    for (const name of request.useCode) {
      for (const one of review.conflicts) {
        if (one.name !== name) continue;
        const has = mine.get(name)?.[one.mode] !== null && mine.get(name)?.[one.mode] !== undefined;
        edits.push({ kind: has ? 'set' : 'add', name, mode: one.mode, value: one.code });
      }
    }
    for (const name of request.add) {
      const token = scanned.get(name);
      if (token === undefined) throw new ApiError('stale', stale);
      if (token.light !== null) edits.push({ kind: 'add', name, mode: 'light', value: token.light });
      if (token.dark !== null) edits.push({ kind: 'add', name, mode: 'dark', value: token.dark });
    }
    for (const name of request.remove) {
      const token = mine.get(name);
      // A token already gone from tokens.css only loses its provenance (and its metadata, below).
      if (token !== undefined && (token.light !== null || token.dark !== null)) edits.push({ kind: 'remove', name, mode: 'both' });
    }

    const steps: SystemStep[] = [];
    if (edits.length > 0) {
      const css = tokensFile?.text ?? '';
      const sectionOf = (name: string): TokenSection | null => sectionInRaw(raw, name) ?? scanned.get(name)?.section ?? null;
      const plan = planTokenEdit(css, edits, { contexts: 'system', sectionOf });
      if ('refusal' in plan) throw new ApiError('invalid', plan.refusal);
      if (!verifyTokenEdit(css, plan.result, edits)) throw new ApiError('invalid', NOT_EXACT_SENTENCE);
      if (plan.result !== css) steps.push(textStep('tokens.css', tokensFile, plan.result));
    }

    // The new brand files, read from the project with the scan's containment and checked like an upload.
    const folders: (readonly string[])[] = [];
    const assetSteps: SystemStep[] = [];
    const taken: Record<'font' | 'logo', string[]> = { font: [], logo: [] };
    const listed: Record<'font' | 'logo', string[] | null> = { font: null, logo: null };
    const entries: { key: 'fonts' | 'logos'; entry: JsonObject }[] = [];
    for (const rel of request.assets) {
      const asset = scan.assets.find((one) => one.path === rel);
      if (asset === undefined) throw new ApiError('stale', stale);
      const segments = FOLDER_OF_KIND[asset.kind];
      const name = rel.split('/').at(-1) ?? rel;
      const bytes = await readProjectFile(scan.directory, rel, ASSET_READ_MAX);
      if (bytes === null) throw new ApiError('stale', stale);
      const check = checkAsset(name, asset.kind, bytes);
      if (!check.ok) throw new ApiError('invalid', check.reason);
      listed[asset.kind] ??= await namesIn(dir, segments);
      const finalName = safeAssetName(name, [...(listed[asset.kind] ?? []), ...taken[asset.kind]]);
      taken[asset.kind].push(finalName);
      const file = [...segments, finalName].join('/');
      if (!folders.includes(segments)) folders.push(segments);
      const undo: SystemUndoStep = { kind: 'create', file, sha: sha256(bytes) };
      assetSteps.push({ kind: 'create', rel: file, bytes, reverse: undo, record: [undo] });
      if (asset.kind === 'font') {
        const guess = guessFontFace(file);
        const style = asset.style === 'italic' ? 'italic' : asset.style === 'normal' ? 'normal' : guess.style;
        entries.push({ key: 'fonts', entry: { file, family: asset.family ?? guess.family, weight: asset.weight ?? guess.weight, style } });
      } else {
        entries.push({ key: 'logos', entry: { file, variant: guessLogoVariant(file) } });
      }
    }

    // system.json: the metadata of added and removed tokens and the copied files; every other key,
    // note and entry kept as it is (S4-1).
    const removedMeta = request.remove.filter((name) => isJsonObject(raw?.tokens) && Object.hasOwn(raw.tokens, name));
    const addedMeta = request.add.filter((name) => !(isJsonObject(raw?.tokens) && Object.hasOwn(raw.tokens, name)));
    if (removedMeta.length + addedMeta.length + entries.length > 0) {
      if (systemJsonFile !== null && raw === null) throw new ApiError('invalid', SYSTEM_JSON_UNREADABLE_MESSAGE);
      const next: JsonObject = raw === null ? { version: 1 } : structuredClone(raw);
      if (addedMeta.length + removedMeta.length > 0) {
        if (next.tokens !== undefined && !isJsonObject(next.tokens)) throw new ApiError('invalid', SYSTEM_JSON_UNREADABLE_MESSAGE);
        const tokens: JsonObject = isJsonObject(next.tokens) ? next.tokens : {};
        for (const name of removedMeta) delete tokens[name];
        for (const name of addedMeta) {
          const section = scanned.get(name)?.section ?? 'other';
          const group = section === 'colours' ? colourGroupOf(name) : null;
          tokens[name] = group === null ? { section } : { section, group };
        }
        next.tokens = tokens;
      }
      for (const { key, entry } of entries) {
        const list = next[key];
        if (list !== undefined && !Array.isArray(list)) throw new ApiError('invalid', SYSTEM_JSON_UNREADABLE_MESSAGE);
        next[key] = [...(list ?? []), entry];
      }
      const text = `${JSON.stringify(next, null, 2)}\n`;
      if (systemJsonFile === null || text !== systemJsonFile.text) steps.push(textStep('system.json', systemJsonFile, text));
    }
    steps.push(...assetSteps);

    // Every step inside the writable set (E7, plus the re-sync's brand files).
    if (!steps.every((step) => isSystemEditableRel(step.rel, { resync: true }))) {
      log.error('systems.edits.plan-refused', { op: 'resync' });
      throw new ApiError('internal', ROLLED_BACK_MESSAGE);
    }

    // state.json: provenance of each touched name (what the code says now), the code source line.
    const provenance = { ...state.provenance };
    const before: SystemResyncUndo['provenance'] = {};
    for (const name of [...request.changes, ...request.useCode, ...request.add]) {
      const token = scanned.get(name);
      if (token === undefined) continue;
      before[name] = state.provenance[name] ?? null;
      provenance[name] = { file: token.file, line: token.line, light: token.light, dark: token.dark };
    }
    for (const name of request.remove) {
      before[name] = state.provenance[name] ?? null;
      delete provenance[name];
    }
    const changed = new Set([...request.changes, ...request.useCode]).size;
    const counts = { changed, added: request.add.length, removed: request.remove.length };
    const previous = state.sources.code;
    return {
      steps,
      folders,
      provenance,
      undoState: { provenance: before, code: previous },
      code: { directory: scan.directory, lastScan: scan.at, partial: scan.summary.partial, scanned: scan.scanned },
      counts,
      directoryChanged: previous !== null && !samePath(previous.directory, scan.directory),
      label: `Re-synced ${state.name}: ${counts.changed} changed, ${counts.added} added, ${counts.removed} removed.`,
    };
  };

  // ---- running steps ----

  const runStep = async (run: Run, step: SystemStep): Promise<Done> => {
    if (step.kind === 'write') {
      const { abs } = await run.resolve(step.rel, false);
      await exec.casWrite(run, abs, step.rel, step.expectSha, step.bytes);
    } else {
      const body = bodyFileOf(step.rel);
      if (body !== null) {
        // The entry's folder, made without recursion inside the contained system folder; a link
        // there already is refused by the containment check of the create that follows.
        await mkdir(path.join(run.dir, body.folder)).catch((error: unknown) => {
          if (codeOf(error) !== 'EEXIST') throw error;
        });
      }
      await exec.createFile(run, step.rel, step.bytes);
    }
    return { reverse: step.reverse, record: step.record };
  };

  const runReverse = async (run: Run, step: SystemUndoStep): Promise<void> => {
    switch (step.kind) {
      case 'splice':
        return exec.reverseSplice(run, step);
      case 'replace': {
        const { abs } = await run.resolve(step.file, false);
        await exec.casWrite(run, abs, step.file, step.afterSha, Buffer.from(step.before, 'utf8'));
        return;
      }
      case 'create': {
        const source = await exec.readMoveSource(run, step.file, { sha: step.sha });
        await exec.movePlace(run, source, trashPlaceFor(run.id, step.file, trashStampOf(now())), source.bytes, SYSTEM_TRASH_ALTERNATIVES);
        return;
      }
    }
  };

  /** Every undo guard checked before the first change, over a virtual view of what earlier reverse steps leave. */
  const checkUndoGuards = async (run: Run, record: SystemUndoRecord): Promise<void> => {
    const virtual = new Map<string, string | null>();
    const shaAt = async (place: string): Promise<string | null> => (virtual.has(place) ? (virtual.get(place) ?? null) : exec.shaOnDisk(run, place));
    for (const step of [...record.steps].reverse()) {
      switch (step.kind) {
        case 'splice':
          if ((await shaAt(step.file)) !== step.afterSha) throw exec.stale(run);
          virtual.set(step.file, step.beforeSha);
          break;
        case 'replace':
          if ((await shaAt(step.file)) !== step.afterSha) throw exec.stale(run);
          virtual.set(step.file, sha256(Buffer.from(step.before, 'utf8')));
          break;
        case 'create':
          if ((await shaAt(step.file)) !== step.sha) throw exec.stale(run);
          virtual.set(step.file, null);
          break;
      }
    }
  };

  /** After the chain step: the revision settles and the page hears about the new state. */
  const settle = async (id: string, stateChanged: boolean): Promise<void> => {
    await systems.settleRevision(id).catch((error: unknown) => log.warn('systems.edits.revision-failed', { system: id, code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') }));
    if (stateChanged) hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'state' });
  };

  const service: SystemEditService = {
    editsFile,

    async apply(id, request) {
      if (request.op === 'resync') return service.resync(id, request);
      const state = await systems.readState(id);
      refuseReadOnly(state);
      const staleMessage = systemStaleMessage(state.name);
      const editId = mintEditId();
      let stateChanged = false;
      const result = await versions.userEdit(id, 'user-edit', {
        staleMessage,
        precheck: async () => {
          // Read again inside the chain: an edit queued behind another sees what that one left.
          const dir = await systems.dir(id);
          const current = await systems.readState(id);
          refuseReadOnly(current);
          const plan = await planSave(dir, current, request).catch(async (error: unknown) => {
            throw await asUserError(id, dir, 'save', error);
          });
          const before = plan.steps.length > 0 ? await fingerprintsOf(id) : null;
          return { plan, run: newRun(id, dir, systemStaleMessage(current.name)), before };
        },
        apply: async ({ plan, run, before }) => {
          const done = await executeSteps<SystemStep, Done>(plan.steps, {
            forward: (step) => runStep(run, step),
            reverse: (undo) => runReverse(run, undo.reverse),
            asUserError: (error) => asUserError(id, run.dir, 'save', error),
            rollbackFailed: (undo) => {
              log.error('systems.edits.rollback-failed', { system: id, step: undo.reverse.kind });
              announce(run);
              return new ApiError('internal', partWayMessage);
            },
            rolledBack: (step, cause) => log.warn('systems.edits.rolled-back', { system: id, step: step.kind, code: cause instanceof ApiError ? cause.code : 'error' }),
          });
          announce(run);
          let undoable = false;
          if (plan.steps.length > 0) {
            const records = done.map((one) => one.record);
            const steps = records.every((one): one is SystemUndoStep[] => one !== null) ? records.flat() : [];
            try {
              const at = now();
              const after = await editsFile.update(id, run.dir, (file) => appendSystemEdit(file, { editId, at: at.toISOString(), label: plan.label, bodies: plan.bodies, steps }, at.getTime()));
              undoable = steps.length > 0 && after.undo.some((one) => one.id === editId);
            } catch (error) {
              // The edit stands; the notice just has no Undo.
              log.warn('systems.edits.record-failed', { system: id, code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
            }
            if (before !== null) {
              try {
                const after = await fingerprintsOf(id);
                await systems.updateStateLocked(id, (current) => {
                  const next = rerecord(current, before, after);
                  stateChanged = next !== null;
                  return next;
                });
              } catch (error) {
                // The save stands; the changed sections read Not reviewed until reviewed again.
                log.warn('systems.edits.review-failed', { system: id, code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
              }
            }
          }
          const detail = plan.steps.length > 0 && !undoable ? UNDO_NOT_KEPT_NOTICE : plan.detail;
          const response: Omit<SystemEditResponse, 'version' | 'coalesced'> = {
            edit: { id: editId, label: plan.label, ...(detail !== undefined ? { detail } : {}), files: [...run.files].sort(), undoable },
            stamps: run.stamps,
          };
          return { response, written: run.written };
        },
      });
      if (result.response.edit.files.length > 0) await settle(id, stateChanged);
      log.info('systems.edits.applied', { system: id, coalesced: result.coalesced });
      return { ...result.response, version: result.version === null ? null : toSummary(result.version), coalesced: result.coalesced };
    },

    async resync(id, request) {
      const state = await systems.readState(id);
      // A repo-backed system's re-sync is all or nothing with no Undo (`snapshot.ts`
      // `applyRepoResync`, §7.4, AD-33), never these ticks: a ticked request for one is out of date.
      if (state.home?.kind === 'repo') throw new ApiError('stale', resyncStaleMessage(state.name));
      if (scans === undefined) throw new ApiError('not-found', SCAN_GONE_MESSAGE);
      const source = scans.resyncSource(request.scanId, id); // 404 expired, 409 running / other system / other root
      if (request.stamp !== source.stamp) throw new ApiError('stale', resyncStaleMessage(state.name));
      const editId = mintEditId();
      const result = await versions.userEdit(id, 'resync', {
        staleMessage: resyncStaleMessage(state.name),
        precheck: async () => {
          // Inside the chain: the root, the system and its files as they are now.
          if (!samePath(settings.root(), source.root)) throw new ApiError('conflict', RESYNC_ROOT_CHANGED_MESSAGE);
          const dir = await systems.dir(id);
          const current = await systems.readState(id);
          if (current.home?.kind === 'repo') throw new ApiError('stale', resyncStaleMessage(current.name));
          const plan = await planResync(id, dir, current, request, source).catch(async (error: unknown) => {
            throw await asUserError(id, dir, 'resync', error);
          });
          return { plan, run: newRun(id, dir, resyncStaleMessage(current.name), { resync: true }) };
        },
        apply: async ({ plan, run }) => {
          try {
            for (const segments of plan.folders) await ensureFolder(run.dir, segments);
          } catch (error) {
            throw await asUserError(id, run.dir, 'resync', error);
          }
          const done = await executeSteps<SystemStep, Done>(plan.steps, {
            forward: (step) => runStep(run, step),
            reverse: (undo) => runReverse(run, undo.reverse),
            asUserError: (error) => asUserError(id, run.dir, 'resync', error),
            rollbackFailed: (undo) => {
              log.error('systems.edits.rollback-failed', { system: id, op: 'resync', step: undo.reverse.kind });
              announce(run);
              return new ApiError('internal', resyncPartWayMessage);
            },
            rolledBack: (step, cause) => log.warn('systems.edits.rolled-back', { system: id, op: 'resync', step: step.kind, code: cause instanceof ApiError ? cause.code : 'error' }),
          });
          announce(run);
          // The undo record: every file step, and the state part (provenance and the code source line).
          let undoable = false;
          const records = done.map((one) => one.record);
          const steps = records.every((one): one is SystemUndoStep[] => one !== null) ? records.flat() : [];
          if (steps.length > 0 && steps.length <= UNDO_STEPS_MAX) {
            try {
              const at = now();
              const after = await editsFile.update(id, run.dir, (file) => appendSystemEdit(file, { editId, at: at.toISOString(), label: plan.label, bodies: [], steps, resync: plan.undoState }, at.getTime()));
              undoable = after.undo.some((one) => one.id === editId);
            } catch (error) {
              // The re-sync stands; the notice just has no Undo ("Before re-sync" restores it).
              log.warn('systems.edits.record-failed', { system: id, op: 'resync', code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
            }
          }
          try {
            // On the chain already (the system's lock): `updateStateLocked` takes no lock of its own.
            await systems.updateStateLocked(id, (current) => ({ ...current, provenance: plan.provenance, sources: { ...current.sources, code: plan.code } }));
          } catch (error) {
            // The values stand; the next review compares against the provenance as it was.
            log.warn('systems.edits.provenance-failed', { system: id, code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
          }
          const response: Omit<SystemResyncResponse, 'version' | 'coalesced'> = {
            edit: { id: editId, label: plan.label, ...(undoable ? {} : { detail: RESYNC_UNDO_NOT_KEPT_NOTICE }), files: [...run.files].sort(), undoable },
            stamps: run.stamps,
            counts: plan.counts,
            ...(plan.directoryChanged ? { directoryChanged: true } : {}),
          };
          return { response, written: run.written };
        },
      });
      // Outside the chain: `settleRevision` takes the store lock itself.
      await settle(id, true);
      log.info('systems.edits.resynced', { system: id, ...result.response.counts });
      return { ...result.response, version: result.version === null ? null : toSummary(result.version), coalesced: result.coalesced };
    },

    async undo(id, editId) {
      if (!EDIT_ID_PATTERN.test(editId)) throw new ApiError('bad-request', 'That is not an edit id.');
      const state = await systems.readState(id);
      refuseReadOnly(state);
      let stateChanged = false;
      const result = await versions.userEdit(id, 'user-edit', {
        staleMessage: UNDO_STALE_MESSAGE,
        precheck: async () => {
          const dir = await systems.dir(id);
          refuseReadOnly(await systems.readState(id));
          const file = await editsFile.read(id, dir);
          const record = findUndo(file, editId, now().getTime());
          if (record === null) throw new ApiError('not-found', UNDO_GONE);
          // A re-sync's record may name the brand files it copied (validated when edits.json is read).
          const run = newRun(id, dir, UNDO_STALE_MESSAGE, { resync: true });
          await checkUndoGuards(run, record).catch(async (error: unknown) => {
            throw await asUserError(id, dir, 'undo', error);
          });
          return { record, run, before: await fingerprintsOf(id) };
        },
        apply: async ({ record, run, before }) => {
          let reversed = 0;
          for (const step of [...record.steps].reverse()) {
            try {
              await runReverse(run, step);
              reversed += 1;
            } catch (error) {
              if (reversed === 0) throw await asUserError(id, run.dir, 'undo', error);
              log.error('systems.edits.undo-failed', { system: id, step: step.kind });
              announce(run);
              throw new ApiError('internal', partWayMessage);
            }
          }
          announce(run);
          try {
            const at = now();
            await editsFile.update(id, run.dir, (file) => {
              const still = file.undo.find((one) => one.id === record.id);
              return still === undefined ? file : applySystemUndone(file, still, at.toISOString(), at.getTime());
            });
          } catch (error) {
            // The files are back; a later undo of this id is refused by its guards.
            log.warn('systems.edits.record-failed', { system: id, op: 'undo', code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
          }
          try {
            const after = await fingerprintsOf(id);
            await systems.updateStateLocked(id, (current) => {
              const restored = record.resync === undefined ? current : withResyncUndone(current, record.resync);
              const next = rerecord(restored, before, after) ?? (record.resync === undefined ? null : restored);
              stateChanged = next !== null;
              return next;
            });
          } catch (error) {
            log.warn('systems.edits.review-failed', { system: id, code: error instanceof ApiError ? error.code : (codeOf(error) ?? 'error') });
          }
          const response: Omit<SystemUndoEditResponse, 'version'> = { files: [...run.files].sort(), stamps: run.stamps };
          return { response, written: run.written };
        },
      });
      await settle(id, stateChanged);
      log.info('systems.edits.undone', { system: id });
      return { ...result.response, version: result.version === null ? null : toSummary(result.version) };
    },

    async clearHandEdits(id, upTo) {
      const dir = await systems.dir(id);
      await editsFile.update(id, dir, (file) => clearLedger(file, upTo));
    },
  };
  return service;
};

// ---- wiring (the routes share one instance per context) ----

const instances = new WeakMap<ServiceContext, SystemEditService>();

export const ensureSystemEditService = (ctx: ServiceContext): SystemEditService => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createSystemEditService({
    systems: ensureSystemStore(ctx),
    versions: ensureSystemVersions(ctx),
    hub: ctx.hub,
    selfWrites: ctx.selfWrites,
    settings: ctx.settings,
    log: ctx.log,
    scans: { resyncSource: (scanId, systemId) => ensureScanJobs(ctx).resyncSource(scanId, systemId) },
  });
  instances.set(ctx, created);
  return created;
};
