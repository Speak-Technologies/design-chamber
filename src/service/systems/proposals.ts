// Proposals (documentation/specs/phase-2-5-technical.md §5.14, §2.15, AD-26, AD-27, AD-30): every
// PROPOSAL.json id is recorded with the bytes first read, so an approval binds to the id and the bytes
// that were shown; the §5.14 step 3 checks, the preview living page from `proposal/`, the approval the
// agent's stamp claims, and what landed in the repo against what was approved.
//
// Writes go only to `<system>/.chamber/proposals.json` and `state.json`, under the designs root
// (`guardSystemWrite`). The repo is only `lstat`ed, through `resolveInside` on its realpath.

import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_PROPOSAL_ID_PATTERN, SYSTEM_PROPOSALS_KEPT, SYSTEM_QUIET_MS } from '../../shared/limits.ts';
import { homeViewOf, type ParsedProposal } from '../../shared/system-json.ts';
import type { BuildJson, ProposalPartName, ProposalProblemReason, ProposalView, SystemState } from '../../shared/types.ts';
import type { ChangeHub, Logger, ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { resolveInside, resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import { readRecord, regenerateLivingPage, type LivingProblem } from './living-page.ts';
import { normaliseForHash } from './living-safe.ts';
import {
  emptyProposalsRecord,
  listFiles,
  PROPOSAL_DIR,
  PROPOSAL_FILE,
  PROPOSALS_JSON,
  proposalDirOf,
  readProposalFile,
  readProposalsRecord,
  sha256Of,
  type ProposalsRecord,
  type SeenProposal,
} from './proposal-record.ts';
import { ensureSystemStore, guardSystemWrite, repoLabelOf, type SystemStore } from './store.ts';

/** A proposed file larger than this is hashed by its size alone (no system file is near it). */
const HASH_FILE_MAX = 32 * 1024 * 1024;
const PROBLEMS_MAX = 10;
const DIFFER_MAX = 20;

// ---- sentences (§5.14) ----

export const PROPOSAL_NOT_ADOPTED_SENTENCE = "This system hasn't been adopted from a build yet, so there is nothing to approve.";
export const PROPOSAL_ROUND_SENTENCE = "The interview isn't finished yet. A proposal comes after round two.";
export const PROPOSAL_REWRITTEN_SENTENCE = 'This proposal changed after it was shown. Ask the agent for a new one.';
export const PROPOSAL_DESCRIBE_SENTENCE = "Describe only never changes the app's code.";
export const PROPOSAL_INTERNAL_SENTENCE = 'This system lives in Design Chamber, so its proposal can only hold token fixes.';
export const PROPOSAL_NONE_FIXES_SENTENCE = "This build has no code to fix, so the proposal can't hold token fixes.";
export const proposalOutsideSentence = (file: string, folder: string): string => `${file} is outside ${folder}, the system's folder.`;
export const proposalLivingPathSentence = (file: string, livingPage: string): string => `${file} isn't the living page this build named (${livingPage}).`;
export const proposalCreateExistsSentence = (file: string, repo: string): string => `${file} already exists in ${repo}. The proposal must change it, not create it.`;
export const proposalFromMissingSentence = (from: string): string => `${from} is missing. The agent writes it before it asks.`;
const PREVIEW_SENTENCES: Readonly<Record<'preview-too-large' | 'preview-unsafe' | 'preview-secret', string>> = {
  'preview-too-large': 'The living page it proposes would be too large to show. Ask the agent to trim it.',
  'preview-unsafe': "The living page it proposes didn't pass the safety check.",
  'preview-secret': 'The living page it proposes shows something shaped like a secret. Remove it before you approve.',
};

type Problem = { reason: ProposalProblemReason; sentence: string };

const previewReasonOf = (problem: LivingProblem): 'preview-too-large' | 'preview-unsafe' | 'preview-secret' | null => {
  if (problem === 'too-large') return 'preview-too-large';
  if (problem === 'unsafe' || problem === 'bundle') return 'preview-unsafe';
  if (problem === 'secret') return 'preview-secret';
  return null;
};

// ---- the hash of what was shown (§2.15) ----

const hashFile = async (file: string): Promise<string> => {
  const info = await lstat(file).catch(() => null);
  if (info === null || !info.isFile()) return 'none';
  if (info.size > HASH_FILE_MAX) return `size:${info.size}`;
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (handle === null) return 'none';
  try {
    return sha256Of(await handle.readFile());
  } finally {
    await handle.close().catch(() => undefined);
  }
};

/** PROPOSAL.json's bytes plus, for a repo home, the sorted `rel:sha256` lines of `proposal/**`. */
export const proposalSha = async (bytes: Uint8Array, proposalDir: string | null): Promise<string> => {
  if (proposalDir === null) return sha256Of(bytes);
  const lines: string[] = [];
  for (const rel of (await listFiles(proposalDir)).sort()) lines.push(`${rel}:${await hashFile(path.join(proposalDir, ...rel.split('/')))}`);
  return sha256Of(Buffer.concat([Buffer.from(bytes), Buffer.from(`\n${lines.join('\n')}`, 'utf8')]));
};

// ---- step 3: checks against the build (never fatal; each problem disables Approve) ----

export type CheckInput = { state: SystemState; build: BuildJson | null; parsed: ParsedProposal; proposalDir: string | null };

const underFolder = (file: string, folder: string): boolean => file === folder || file.startsWith(`${folder}/`);

/** `lstat` of a repo path through the repo's realpath (read-only); a path that can't be resolved counts as absent. */
const repoHas = async (repoReal: string, file: string): Promise<boolean> => {
  try {
    const target = await resolveInside(repoReal, file.split('/'));
    return (await lstat(target).catch(() => null)) !== null;
  } catch {
    return false;
  }
};

export const checkProposal = async (input: CheckInput): Promise<Problem[]> => {
  const { state, build, parsed, proposalDir } = input;
  const proposal = parsed.proposal;
  const out: Problem[] = [];
  if (state.build === undefined || build === null) out.push({ reason: 'not-adopted', sentence: PROPOSAL_NOT_ADOPTED_SENTENCE });
  else if (build.round !== 2 && build.round !== 'done') out.push({ reason: 'round', sentence: PROPOSAL_ROUND_SENTENCE });
  // The parser's own problems (a file it skipped, a living-page part with two files): the file can't be used as it is.
  for (const problem of parsed.problems) out.push({ reason: 'unreadable', sentence: problem.message });
  if (proposal === null) return out;

  const home = state.home ?? { kind: 'internal' as const };
  // The parser's parts: each file normalised (`from` is null unless a create names one).
  const files = parsed.parts.flatMap((part) => part.files.map((file) => ({ part: part.name, file })));
  if (home.kind === 'repo') {
    let repoReal: string | null = null;
    try {
      repoReal = await realpath(home.directory);
    } catch {
      repoReal = null; // the repo problem is the snapshot's to report; the lstat checks wait for it
    }
    const repo = repoLabelOf(home.directory);
    for (const { part, file } of files) {
      if (part === 'system-files' && !underFolder(file.path, home.folder)) out.push({ reason: 'path-outside', sentence: proposalOutsideSentence(file.path, home.folder) });
      if (part === 'living-page' && file.path !== home.livingPage) out.push({ reason: 'living-page-path', sentence: proposalLivingPathSentence(file.path, home.livingPage) });
      if (file.change === 'create' && repoReal !== null && (await repoHas(repoReal, file.path))) {
        out.push({ reason: 'create-exists', sentence: proposalCreateExistsSentence(file.path, repo) });
      }
      if (file.from !== null) {
        const rel = file.from.slice(`${PROPOSAL_DIR}/`.length);
        const there = proposalDir !== null && (await lstat(path.join(proposalDir, ...rel.split('/'))).catch(() => null))?.isFile() === true;
        if (!there) out.push({ reason: 'from-missing', sentence: proposalFromMissingSentence(file.from) });
      }
    }
    if (proposal.mode === 'describe' && files.some(({ file }) => file.change !== 'create' && !underFolder(file.path, home.folder))) {
      out.push({ reason: 'describe-change', sentence: PROPOSAL_DESCRIBE_SENTENCE });
    }
  } else {
    if (parsed.parts.some((part) => part.name !== 'token-fixes')) out.push({ reason: 'internal-parts', sentence: PROPOSAL_INTERNAL_SENTENCE });
    // Internal home: every file the proposal names is the app's code.
    if (proposal.mode === 'describe' && files.some(({ file }) => file.change !== 'create')) out.push({ reason: 'describe-change', sentence: PROPOSAL_DESCRIBE_SENTENCE });
  }
  if (proposal.mode === 'none' && parsed.parts.some((part) => part.name === 'token-fixes')) out.push({ reason: 'none-fixes', sentence: PROPOSAL_NONE_FIXES_SENTENCE });
  return out;
};

// ---- the service ----

export type ProposalsDeps = {
  systems: SystemStore;
  hub: ChangeHub;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  root: () => string;
  /** §5.11: the preview living page from `proposal/` (T14's generator). */
  regeneratePreview: (id: string) => Promise<void>;
  /** The preview's record as the living page wrote it. */
  readPreview: (systemDir: string) => Promise<{ proposal: string; sha256: string | null; problem: LivingProblem | null } | null>;
  /** Test seams. */
  quietMs?: number;
  now?: () => Date;
};

export type ApprovalSeen = { approved: true } | { approved: false };

export type Proposals = {
  view(id: string, proposalId: string): Promise<ProposalView>;
  /** §5.14 step 1 to 4 now, without the quiet wait (start, tests). */
  settle(id: string): Promise<void>;
  /** §5.14 step 6, after the snapshot refresh that followed an approved stamp. */
  compareLanded(id: string): Promise<void>;
  /** A home change: the current proposal is the old home's and never becomes approvable. */
  supersede(id: string): Promise<void>;
  /** Stop: the current proposal is declined (when it is the one named). Inside `systems.withLock(id)` only. */
  declineLocked(id: string, proposalId: string | null): Promise<void>;
  /**
   * §5.14 step 5, inside `systems.withLock(id)` only (homes.ts step 4 holds it): the stamp's proposal is
   * the recorded current one, with the bytes that were shown → approved and `state.build.approved`.
   */
  approveLocked(id: string, proposal: string | null, parts: readonly string[]): Promise<ApprovalSeen>;
  idle(): Promise<void>;
  stop(): void;
};

export const createProposals = (deps: ProposalsDeps): Proposals => {
  const { systems, hub, log } = deps;
  const quietMs = deps.quietMs ?? SYSTEM_QUIET_MS;
  const now = deps.now ?? (() => new Date());
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const chains = new Map<string, Promise<void>>();
  let stopped = false;

  const emit = (id: string, systemChange: 'proposal' | 'state'): void => {
    hub.emit({ slug: null, kind: 'system', system: id, systemChange });
  };

  const recordFile = async (id: string, systemDir: string): Promise<string> => {
    const file = await resolvePlainTarget(systemDir, ['.chamber', PROPOSALS_JSON], { allowAbsent: true });
    await guardSystemWrite(deps.root(), file, id, log);
    return file;
  };

  /** Read, change and write the record; inside the system's lock. Returns the record written (or null when unchanged). */
  const updateRecordLocked = async (id: string, change: (record: ProposalsRecord) => ProposalsRecord | null): Promise<ProposalsRecord | null> => {
    const systemDir = await systems.dir(id);
    const current = (await readProposalsRecord(systemDir)) ?? emptyProposalsRecord();
    const next = change(structuredClone(current));
    if (next === null) return null;
    next.seen = next.seen.slice(-SYSTEM_PROPOSALS_KEPT);
    await writeFileAtomic(await recordFile(id, systemDir), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  };

  const enqueue = (id: string, task: () => Promise<void>): Promise<void> => {
    const previous = chains.get(id) ?? Promise.resolve();
    const run = previous.then(task).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'not-found') return;
      log.warn('systems.proposals.failed', { system: id, error: error instanceof Error ? error.name : 'error' });
    });
    chains.set(id, run);
    void run.then(() => {
      if (chains.get(id) === run) chains.delete(id);
    });
    return run;
  };

  const settle = async (id: string): Promise<void> => {
    const systemDir = await systems.dir(id);
    const source = await systems.get(id);
    const state = source.state;
    const repo = state.home?.kind === 'repo';
    const file = await readProposalFile(systemDir);
    const proposalDir = repo ? await proposalDirOf(systemDir) : null;
    const at = now().toISOString();

    if (file.kind === 'absent' || file.parsed.id === null) {
      const unreadable = file.kind === 'absent' ? null : (file.parsed.unreadable ?? null);
      const written = await systems.withLock(id, () =>
        updateRecordLocked(id, (record) => {
          if (record.current === null && record.unreadable === unreadable) return null;
          for (const entry of record.seen) if (entry.id === record.current && (entry.state === 'current' || entry.state === 'unreadable')) Object.assign(entry, { state: 'superseded', by: null });
          return { ...record, current: null, unreadable };
        }),
      );
      if (written !== null) emit(id, 'proposal');
      return;
    }

    const parsed = file.parsed;
    const proposalId = parsed.id as string;
    const sha = await proposalSha(file.bytes, proposalDir);
    const problems = parsed.unreadable === null ? await checkProposal({ state, build: source.build, parsed, proposalDir }) : [];

    let entryAfter: SeenProposal | null = null;
    await systems.withLock(id, () =>
      updateRecordLocked(id, (record) => {
        const known = record.seen.find((entry) => entry.id === proposalId);
        if (record.current !== null && record.current !== proposalId) {
          for (const entry of record.seen) if (entry.id === record.current && (entry.state === 'current' || entry.state === 'unreadable')) Object.assign(entry, { state: 'superseded', by: proposalId });
        }
        record.current = proposalId;
        record.unreadable = null;
        if (known === undefined) {
          const entry: SeenProposal = {
            id: proposalId,
            sha256: sha,
            fileSha256: file.fileSha256,
            firstSeen: at,
            state: parsed.unreadable === null ? 'current' : 'unreadable',
            previewSha256: null,
            at: null,
            by: null,
            reasons: problems.map((problem) => problem.reason),
            problems: problems.map((problem) => problem.sentence),
            sentence: parsed.unreadable,
            driftBefore: null,
          };
          record.seen.push(entry);
          entryAfter = entry;
          return record;
        }
        if (known.sha256 !== sha && (known.state === 'current' || known.state === 'unreadable')) {
          // AD-27: the same id with other bytes is never approvable again (the skill uses a new id per change).
          Object.assign(known, { state: 'rewritten', reasons: ['rewritten'], problems: [PROPOSAL_REWRITTEN_SENTENCE] });
        } else if (known.state === 'current') {
          // The build may have moved on (round two, adoption): the checks are run again on the same bytes.
          const previews = known.reasons.flatMap((reason, index) => (reason.startsWith('preview-') ? [{ reason, sentence: known.problems[index] ?? '' }] : []));
          const all = [...problems, ...previews];
          Object.assign(known, { reasons: all.map((problem) => problem.reason), problems: all.map((problem) => problem.sentence) });
        }
        entryAfter = known;
        return record;
      }),
    );
    emit(id, 'proposal');
    log.info('systems.proposals.recorded', { system: id, state: (entryAfter as SeenProposal | null)?.state ?? null, problems: problems.length });

    // Step 4: the preview, for a repo home's current proposal with a `proposal/` folder.
    const after = entryAfter as SeenProposal | null;
    if (!repo || proposalDir === null || after === null || after.state !== 'current') return;
    if (after.previewSha256 !== null) {
      const preview = await deps.readPreview(systemDir);
      if (preview?.proposal === proposalId && preview.sha256 === after.previewSha256) return; // drawn for these bytes already
    }
    await deps.regeneratePreview(id);
    const preview = await deps.readPreview(systemDir);
    if (preview === null || preview.proposal !== proposalId) return;
    const reason = preview.problem === null ? null : previewReasonOf(preview.problem);
    const written = await systems.withLock(id, () =>
      updateRecordLocked(id, (record) => {
        const entry = record.seen.find((item) => item.id === proposalId);
        if (entry === undefined || entry.state !== 'current' || entry.sha256 !== sha) return null;
        const kept = entry.reasons.flatMap((item, index) => (item.startsWith('preview-') ? [] : [{ reason: item, sentence: entry.problems[index] ?? '' }]));
        const all = reason === null ? kept : [...kept, { reason, sentence: PREVIEW_SENTENCES[reason] }];
        Object.assign(entry, { previewSha256: preview.sha256, reasons: all.map((item) => item.reason), problems: all.map((item) => item.sentence) });
        return record;
      }),
    );
    if (written !== null) emit(id, 'proposal');
  };

  const schedule = (id: string): void => {
    const previous = timers.get(id);
    if (previous !== undefined) clearTimeout(previous);
    const timer = setTimeout(() => {
      timers.delete(id);
      if (!stopped) void enqueue(id, () => settle(id));
    }, quietMs);
    timer.unref?.();
    timers.set(id, timer);
  };

  const unsubscribe = hub.subscribe((event) => {
    if (stopped || event.kind !== 'system' || event.system === undefined) return;
    if (event.systemChange === 'removed') return;
    if (event.systemChange === 'added' || (event.systemChange === 'files' && (event.files ?? []).some((rel) => rel === PROPOSAL_FILE || rel === PROPOSAL_DIR || rel.startsWith(`${PROPOSAL_DIR}/`)))) {
      schedule(event.system);
    }
  });

  const view = async (id: string, proposalId: string): Promise<ProposalView> => {
    if (!SYSTEM_PROPOSAL_ID_PATTERN.test(proposalId)) throw new ApiError('bad-request', 'That is not a proposal id.');
    const systemDir = await systems.dir(id);
    const record = await readProposalsRecord(systemDir);
    const entry = record?.seen.find((item) => item.id === proposalId) ?? null;
    if (entry === null) return { state: 'unknown' };
    if (entry.state === 'superseded') return { state: 'superseded', by: entry.by };
    if (entry.state === 'rewritten') return { state: 'rewritten' };
    if (entry.state === 'approved' || entry.state === 'declined') return { state: entry.state, at: entry.at ?? entry.firstSeen };
    if (entry.state === 'unreadable') return { state: 'unreadable', sentence: entry.sentence ?? 'PROPOSAL.json can\'t be read.' };

    // Current: the file as it is now must still be the bytes recorded (AD-27); a change not yet settled answers as it will.
    const file = await readProposalFile(systemDir);
    if (file.kind === 'absent') return { state: 'superseded', by: null };
    if (file.parsed.id !== proposalId) return { state: 'superseded', by: file.parsed.id };
    if (file.fileSha256 !== entry.fileSha256 || file.parsed.proposal === null) return { state: 'rewritten' };
    const state = await systems.readState(id);
    const repo = state.home?.kind === 'repo';
    const proposalDir = repo ? await proposalDirOf(systemDir) : null;
    const parts = await Promise.all(
      file.parsed.parts.map(async (part) => ({
        name: part.name,
        files: await Promise.all(
          part.files.map(async (item) => {
            if (item.from === null || proposalDir === null) return item;
            const info = await lstat(path.join(proposalDir, ...item.from.slice(`${PROPOSAL_DIR}/`.length).split('/'))).catch(() => null);
            return { ...item, bytes: info?.isFile() === true ? info.size : null };
          }),
        ),
      })),
    );
    let preview: Extract<ProposalView, { state: 'current' }>['preview'] = { board: false, livingPage: 'none', sentence: null };
    if (repo && proposalDir !== null) {
      const drawn = (await readRecord(systemDir))?.preview ?? null;
      const reason = entry.reasons.find((item): item is 'preview-too-large' | 'preview-unsafe' | 'preview-secret' => item.startsWith('preview-'));
      if (reason !== undefined) preview = { board: true, livingPage: 'failed', sentence: PREVIEW_SENTENCES[reason] };
      else if (drawn !== null && drawn.proposal === proposalId && drawn.sha256 !== null && drawn.sha256 === entry.previewSha256) preview = { board: true, livingPage: 'ready', sentence: null };
      else preview = { board: true, livingPage: 'generating', sentence: null };
    }
    const proposal = file.parsed.proposal;
    return {
      state: 'current',
      sha16: entry.sha256.slice(0, 16),
      preview,
      proposal: {
        id: proposal.id,
        supersedes: proposal.supersedes,
        created: proposal.created,
        mode: proposal.mode,
        summary: proposal.summary,
        parts,
        wayBack: proposal.wayBack,
        access: proposal.access,
        home: homeViewOf(state),
        problems: entry.problems.slice(0, PROBLEMS_MAX),
      },
    };
  };

  const approveLocked = async (id: string, proposal: string | null, parts: readonly string[]): Promise<ApprovalSeen> => {
    if (proposal === null || !SYSTEM_PROPOSAL_ID_PATTERN.test(proposal)) return { approved: false };
    const systemDir = await systems.dir(id);
    const record = await readProposalsRecord(systemDir);
    const entry = record?.seen.find((item) => item.id === proposal) ?? null;
    if (record === null || entry === null) return { approved: false };
    const state = await systems.readState(id);
    // The same approval stamped again (the agent fixing what landed) stays approved.
    const again = entry.state === 'approved' && state.build?.approved?.proposal === proposal;
    if (!again && (entry.state !== 'current' || record.current !== proposal)) return { approved: false };
    const file = await readProposalFile(systemDir);
    // AD-27: the bytes shown are PROPOSAL.json and, for a repo home, `proposal/**`; both are hashed again here.
    const shown = file.kind === 'absent' ? null : await proposalSha(file.bytes, state.home?.kind === 'repo' ? await proposalDirOf(systemDir) : null);
    if (!again && (file.kind === 'absent' || file.fileSha256 !== entry.fileSha256 || shown !== entry.sha256)) {
      // Changed since it was recorded and the quiet wait hasn't caught it yet: a rewrite.
      await updateRecordLocked(id, (next) => {
        const item = next.seen.find((seen) => seen.id === proposal);
        if (item === undefined) return null;
        Object.assign(item, { state: 'rewritten', reasons: ['rewritten'], problems: [PROPOSAL_REWRITTEN_SENTENCE] });
        return next;
      });
      emit(id, 'proposal');
      return { approved: false };
    }
    const at = now().toISOString();
    const driftBefore = state.codeDrift?.differ ?? null;
    if (!again) {
      await updateRecordLocked(id, (next) => {
        const item = next.seen.find((seen) => seen.id === proposal);
        if (item === undefined) return null;
        Object.assign(item, { state: 'approved', at, driftBefore });
        return next;
      });
    }
    await systems.updateStateLocked(id, (current) => {
      if (current.build === undefined) return null;
      const buildProblem = current.buildProblem?.reason === 'applied-unknown-proposal' ? null : (current.buildProblem ?? null);
      return { ...current, buildProblem, build: { ...current.build, approved: { proposal, sha256: entry.sha256, parts: [...parts] } } };
    });
    emit(id, 'proposal');
    log.info('systems.proposals.approved', { system: id, proposal });
    return { approved: true };
  };

  const compareLanded = async (id: string): Promise<void> => {
    const systemDir = await systems.dir(id);
    const state = await systems.readState(id);
    const approved = state.build?.approved ?? null;
    const home = state.home;
    if (approved === null || approved === undefined || home?.kind !== 'repo') return;
    const file = await readProposalFile(systemDir);
    if (file.kind === 'absent' || file.parsed.id !== approved.proposal || file.parsed.proposal === null) {
      log.warn('systems.proposals.landed-no-proposal', { system: id });
      return;
    }
    const record = await readProposalsRecord(systemDir);
    const entry = record?.seen.find((item) => item.id === approved.proposal) ?? null;
    const proposalDir = await proposalDirOf(systemDir);
    const snapshotDir = await systems.filesDir(id);
    const snapshotFiles = new Set(await listFiles(snapshotDir));
    const relOf = (repoPath: string): string | null => (underFolder(repoPath, home.folder) && repoPath !== home.folder ? repoPath.slice(home.folder.length + 1) : null);
    const normalisedSha = async (dir: string | null, rel: string): Promise<string | null> => {
      if (dir === null) return null;
      const target = path.join(dir, ...rel.split('/'));
      const info = await lstat(target).catch(() => null);
      if (info === null || !info.isFile() || info.size > HASH_FILE_MAX) return null;
      const handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
      if (handle === null) return null;
      try {
        return sha256Of(normaliseForHash((await handle.readFile()).toString('utf8')));
      } finally {
        await handle.close().catch(() => undefined);
      }
    };

    const differ: string[] = [];
    const parts = file.parsed.parts;
    for (const part of parts) {
      if (part.name !== 'system-files') continue;
      for (const item of part.files) {
        if (item.from === null) continue;
        const rel = relOf(item.path);
        const landed = rel === null ? null : await normalisedSha(snapshotDir, rel);
        const wanted = await normalisedSha(proposalDir, item.from.slice(`${PROPOSAL_DIR}/`.length));
        if (landed === null || wanted === null || landed !== wanted) differ.push(rel ?? item.path);
      }
    }

    let repoReal: string | null = null;
    try {
      repoReal = await realpath(home.directory);
    } catch {
      repoReal = null;
    }
    const found = async (repoPath: string): Promise<boolean> => {
      const rel = relOf(repoPath);
      if (rel !== null) return snapshotFiles.has(rel);
      return repoReal !== null && (await repoHas(repoReal, repoPath));
    };
    const unclaimed: string[] = [];
    for (const name of approved.parts) {
      const part = parts.find((item) => item.name === name);
      if (name === 'token-fixes') {
        const before = entry?.driftBefore ?? null;
        const after = state.codeDrift?.differ ?? null;
        if (before !== null && after !== null && before > 0 && after >= before) unclaimed.push(name);
        continue;
      }
      if (name === 'living-page') {
        if (!(repoReal !== null && (await repoHas(repoReal, home.livingPage)))) unclaimed.push(name);
        continue;
      }
      const wanted = (part?.files ?? []).filter((item) => item.change !== 'delete');
      if (wanted.length === 0) continue;
      let any = false;
      for (const item of wanted) {
        if (await found(item.path)) {
          any = true;
          break;
        }
      }
      if (!any) unclaimed.push(name as ProposalPartName);
    }

    const landed: NonNullable<SystemState['landed']> = { proposal: approved.proposal, matches: differ.length === 0 && unclaimed.length === 0, differ: differ.slice(0, DIFFER_MAX), unclaimed };
    await systems.withLock(id, () =>
      systems.updateStateLocked(id, (current) => (current.build?.approved?.proposal === approved.proposal ? { ...current, landed } : null)),
    );
    emit(id, 'state');
    log.info('systems.proposals.landed', { system: id, matches: landed.matches, differ: differ.length, unclaimed: unclaimed.length });
  };

  const supersede = async (id: string): Promise<void> => {
    const written = await systems.withLock(id, () =>
      updateRecordLocked(id, (record) => {
        let changed = false;
        for (const entry of record.seen) {
          if (entry.id === record.current && (entry.state === 'current' || entry.state === 'unreadable')) {
            Object.assign(entry, { state: 'superseded', by: null });
            changed = true;
          }
        }
        return changed ? record : null;
      }),
    );
    if (written !== null) emit(id, 'proposal');
  };

  const declineLocked = async (id: string, proposalId: string | null): Promise<void> => {
    const at = now().toISOString();
    const written = await updateRecordLocked(id, (record) => {
      if (proposalId !== null && record.current !== proposalId) return null;
      const entry = record.seen.find((item) => item.id === record.current);
      if (entry === undefined || entry.state !== 'current') return null;
      Object.assign(entry, { state: 'declined', at });
      return record;
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'not-found') return null;
      throw error;
    });
    if (written !== null) emit(id, 'proposal');
  };

  return {
    view,
    settle: (id) => enqueue(id, () => settle(id)),
    compareLanded,
    supersede,
    declineLocked,
    approveLocked,
    async idle() {
      while (chains.size > 0) await Promise.all([...chains.values()]);
    },
    stop() {
      stopped = true;
      unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
};

// ---- wiring ----

const instances = new WeakMap<ServiceContext, Proposals>();

/** The one proposals service of a composed service (the routes, homes and Stop share it). */
export const ensureProposals = (ctx: ServiceContext): Proposals => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createProposals({
    systems: ensureSystemStore(ctx),
    hub: ctx.hub,
    log: ctx.log,
    root: () => ctx.settings.root(),
    regeneratePreview: (id) => regenerateLivingPage(ctx, id, { source: 'proposal' }),
    readPreview: async (systemDir) => (await readRecord(systemDir))?.preview ?? null,
  });
  instances.set(ctx, created);
  ctx.onDispose(() => created.stop());
  return created;
};

/** One settle per system after the watcher's baseline, and again after a root change; returns the stop. */
export const startProposals = (ctx: ServiceContext, ready?: () => Promise<unknown>): (() => Promise<void>) => {
  const proposals = ensureProposals(ctx);
  const systems = ensureSystemStore(ctx);
  let stopped = false;
  const pass = async (): Promise<void> => {
    await ready?.();
    for (const row of await systems.list().catch(() => [])) {
      if (stopped) return;
      if (row.unreadable === null) void proposals.settle(row.id);
    }
  };
  const unsubscribe = ctx.hub.subscribe((event) => {
    if (!stopped && event.kind === 'root') void pass();
  });
  void pass();
  return async () => {
    stopped = true;
    unsubscribe();
    proposals.stop();
    await proposals.idle();
  };
};

