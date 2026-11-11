// The one interface every hand-edit op implements (Phase 2 technical design §2.4, §10.6a).
//
// An op module only plans: it reads its targets, checks the request's stamps, computes the
// bytes and says how each step is undone. It writes nothing. The pipeline (`pipeline.ts`)
// executes the steps in order, inside the design's versions chain, after the version first,
// with compare-and-swap at every rename, rollback on a failed multi-step op, the self-write
// record, the user events and the edits.json append. T3 (text), T4 (screens) and T5 (tokens)
// each replace only their own `ops-*.ts`; the op map lives in `pipeline.ts` and never moves.

import type { EditRequest, FileStamp } from '../../shared/api.ts';
import type { HandEdit, HandEditBase, JsonValue } from '../../shared/types.ts';
import type { DesignRecord, DesignStore } from '../context.ts';
import type { UndoStep } from './file.ts';

/**
 * Where a file lives for a step: a design-relative path (`index.html`, `screens/home.html`,
 * `tokens.css`) or, for the trash only, a root-relative `.trash/<slug>.<screenId>-<stamp>[-n].html`
 * (`trash.ts`). The pipeline resolves both through `resolvePlainTarget`; no other shape is accepted.
 */
export type Place = string;

/** What an op module receives. `record` is the design as read for this request; `dir` is `record.path`. */
export type OpInput<R extends EditRequest = EditRequest> = {
  slug: string;
  record: DesignRecord;
  dir: string;
  request: R;
  store: DesignStore;
  /** The contained `<root>/.trash` folder, created on first use. */
  trashDir: () => Promise<string>;
  now: () => Date;
};

/** One step the pipeline executes, never the module. */
export type PlannedStep =
  /** Replace a file only while its bytes still hash to `expectSha` (the hash the module just read). */
  | { kind: 'write'; rel: string; expectSha: string; bytes: Uint8Array; undo: UndoStep }
  /** A new file, published with `moveNoReplace`: never over an existing one. */
  | { kind: 'create'; rel: string; bytes: Uint8Array; undo: UndoStep }
  /**
   * Move a file without replacing anything at `to`. `expect` is the source as the module saw it
   * (its sha256, or the size and mtime the wall showed). A trash destination taken meanwhile
   * moves on to the next free `-n`; the pipeline rewrites `undo.to` (a `move` undo step) to the
   * name actually used.
   */
  | { kind: 'move'; from: Place; to: Place; expect: { sha: string } | FileStamp; undo: UndoStep }
  /** The screen list in design.json, through `store.writeScreens` (stamp-checked under the store lock). */
  | { kind: 'screens'; expectStamp: string; mutate: (raw: JsonValue | undefined) => JsonValue[]; undo: (afterStamp: string) => UndoStep }
  /** Comments moved between screens through `store.moveComments`; the undo is built from what really moved. */
  | { kind: 'comments'; moves: { from: string; to: string }[]; undo: (moved: { id: string; from: string; to: string }[]) => UndoStep };

/** `Omit` over each member of a union (plain `Omit` would collapse the union to its common keys). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A ledger entry without the fields the pipeline adds (`seq`, `at`, `editId`). */
export type HandEditBody = DistributiveOmit<HandEdit, keyof HandEditBase>;

export type OpPlan = {
  /** The notice title and the undo record's label, e.g. "Text updated in Home". */
  label: string;
  /** An optional second notice line. `EditResponse` (WP0) has no field for it yet, so it is not sent. */
  detail?: string;
  steps: PlannedStep[];
  ledger: HandEditBody;
  /** Duplicate only: the copy, so the camera can bring it into view. */
  created?: { id: string; title: string };
};

/** Reads, stale checks and verifies; writes nothing. Throws `ApiError` with the user's sentence. */
export type OpModule<R extends EditRequest = EditRequest> = { plan(input: OpInput<R>): Promise<OpPlan> };

export type RequestOf<K extends EditRequest['op']> = Extract<EditRequest, { op: K }>;

/** The fixed dispatch table (one module per op name). */
export type OpModules = { [K in EditRequest['op']]: OpModule<RequestOf<K>> };

/** The sentence every op stub answers until its task replaces it (§16). */
export const NOT_BUILT_MESSAGE = 'This part of Design Chamber (edits) is not built yet.';
