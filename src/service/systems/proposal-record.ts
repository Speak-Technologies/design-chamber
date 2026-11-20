// `.chamber/proposals.json` (schema `design-chamber/system-proposals@1`, documentation/specs/phase-2-5-technical.md
// §2.15, §5.14): the service's record of every proposal id it has seen, with the bytes it first read, so an
// approval binds to the id and the bytes shown (AD-27). Only `proposals.ts` writes it; the store, the board,
// the living-page preview and the check read it here, with the bounded PROPOSAL.json read and the
// `proposal/` folder helpers they share. Never through a link; anything off-shape reads as no record.

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_PROPOSAL_ID_PATTERN, SYSTEM_PROPOSAL_MAX_BYTES, SYSTEM_PROPOSALS_KEPT } from '../../shared/limits.ts';
import { parseProposal, type ParsedProposal } from '../../shared/system-json.ts';
import type { IsoDate, ProposalProblemReason } from '../../shared/types.ts';
import { SKIP_DIRS } from '../discovery.ts';
import { resolveInside, resolvePlainTarget, samePath } from '../paths.ts';

export const PROPOSALS_JSON = 'proposals.json';
export const PROPOSAL_FILE = 'PROPOSAL.json';
export const PROPOSAL_DIR = 'proposal';
const RECORD_MAX_BYTES = 1024 * 1024;
const PROBLEMS_MAX = 10;
const SENTENCE_MAX = 400;
const PROPOSAL_DEPTH_MAX = 4;
const PROPOSAL_ENTRIES_MAX = 2000;
export const PROPOSAL_LINK_SENTENCE = 'PROPOSAL.json must be a plain file, not a link or a folder.';

export type SeenState = 'current' | 'superseded' | 'rewritten' | 'approved' | 'declined' | 'unreadable';

export type SeenProposal = {
  id: string;
  /** PROPOSAL.json's bytes plus, for a repo home, the sorted `rel:sha256` list of `proposal/**` (§2.15). */
  sha256: string;
  /** PROPOSAL.json's bytes alone: the proposal read compares it without hashing `proposal/**`. */
  fileSha256: string;
  firstSeen: IsoDate;
  state: SeenState;
  /** The preview page's sha256, once it was generated for this proposal. */
  previewSha256: string | null;
  /** When the state last changed to approved or declined. */
  at: IsoDate | null;
  /** superseded: the id that replaced it (null when the file went or the home changed). */
  by: string | null;
  /** The §5.14 step 3 and step 4 problems, cached with the record: codes and the block's sentences. */
  reasons: ProposalProblemReason[];
  problems: string[];
  /** unreadable: the parser's sentence. */
  sentence: string | null;
  /** The code drift count when the approval was seen (token fixes landed when it moved). */
  driftBefore: number | null;
};

export type ProposalsRecord = {
  v: 1;
  /** The id PROPOSAL.json names now; null when it is absent or has no readable id. */
  current: string | null;
  /** PROPOSAL.json without a usable id: the parser's sentence. */
  unreadable: string | null;
  seen: SeenProposal[];
};

export const emptyProposalsRecord = (): ProposalsRecord => ({ v: 1, current: null, unreadable: null, seen: [] });

const STATES: readonly SeenState[] = ['current', 'superseded', 'rewritten', 'approved', 'declined', 'unreadable'];
const REASONS: readonly ProposalProblemReason[] = [
  'not-adopted', 'round', 'path-outside', 'living-page-path', 'create-exists', 'from-missing', 'describe-change',
  'internal-parts', 'none-fixes', 'rewritten', 'unreadable', 'preview-too-large', 'preview-unsafe', 'preview-secret',
];
const HEX64 = /^[0-9a-f]{64}$/;

export const sha256Of = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIsoText = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
const text = (value: unknown): string | null => (typeof value === 'string' && value.length <= SENTENCE_MAX ? value : null);
const idOrNull = (value: unknown): string | null => (typeof value === 'string' && SYSTEM_PROPOSAL_ID_PATTERN.test(value) ? value : null);
const hexOrNull = (value: unknown): string | null => (typeof value === 'string' && HEX64.test(value) ? value : null);

/** The record as this service writes it; an entry off-shape is dropped, a file off-shape is no record. */
export const parseProposalsRecord = (raw: string): ProposalsRecord | null => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(value) || value.v !== 1 || !Array.isArray(value.seen)) return null;
  const seen: SeenProposal[] = [];
  for (const item of value.seen) {
    if (!isObj(item)) continue;
    const id = idOrNull(item.id);
    const sha = hexOrNull(item.sha256);
    const fileSha = hexOrNull(item.fileSha256);
    if (id === null || sha === null || fileSha === null || !isIsoText(item.firstSeen)) continue;
    if (!(STATES as readonly unknown[]).includes(item.state)) continue;
    if (seen.some((entry) => entry.id === id)) continue;
    seen.push({
      id,
      sha256: sha,
      fileSha256: fileSha,
      firstSeen: item.firstSeen,
      state: item.state as SeenState,
      previewSha256: hexOrNull(item.previewSha256),
      at: isIsoText(item.at) ? item.at : null,
      by: idOrNull(item.by),
      reasons: Array.isArray(item.reasons) ? item.reasons.filter((reason): reason is ProposalProblemReason => (REASONS as readonly unknown[]).includes(reason)).slice(0, REASONS.length) : [],
      problems: Array.isArray(item.problems) ? item.problems.map(text).filter((line): line is string => line !== null).slice(0, PROBLEMS_MAX) : [],
      sentence: text(item.sentence),
      driftBefore: typeof item.driftBefore === 'number' && Number.isInteger(item.driftBefore) && item.driftBefore >= 0 ? item.driftBefore : null,
    });
  }
  return { v: 1, current: idOrNull(value.current), unreadable: text(value.unreadable), seen: seen.slice(-SYSTEM_PROPOSALS_KEPT) };
};

/** A plain file under `dir`, read whole up to `max` bytes (one more tells it is over); null when absent, a link or not a file. */
const readPlainFile = async (dir: string, segments: readonly string[], max: number): Promise<{ kind: 'absent' } | { kind: 'not-plain' } | { kind: 'bytes'; bytes: Buffer }> => {
  let file: string;
  try {
    file = await resolvePlainTarget(dir, segments, { allowAbsent: true });
  } catch {
    return { kind: 'not-plain' };
  }
  const info = await lstat(file).catch(() => null);
  if (info === null) return { kind: 'absent' };
  if (!info.isFile()) return { kind: 'not-plain' };
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (handle === null) return { kind: 'not-plain' };
  try {
    const buffer = Buffer.alloc(max + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return { kind: 'bytes', bytes: buffer.subarray(0, filled) };
  } finally {
    await handle.close().catch(() => undefined);
  }
};

/** `<system>/.chamber/proposals.json`, or null when there is none (or it is a link, too large, off-shape). */
export const readProposalsRecord = async (systemDir: string): Promise<ProposalsRecord | null> => {
  const read = await readPlainFile(systemDir, ['.chamber', PROPOSALS_JSON], RECORD_MAX_BYTES).catch(() => null);
  if (read === null || read.kind !== 'bytes' || read.bytes.length > RECORD_MAX_BYTES) return null;
  return parseProposalsRecord(read.bytes.toString('utf8'));
};

/** `PROPOSAL.json` as it is now: absent, or its bytes (bounded) and their parse. A link is unreadable. */
export type ProposalFileRead = { kind: 'absent' } | { kind: 'read'; bytes: Buffer; fileSha256: string; parsed: ParsedProposal };

export const readProposalFile = async (systemDir: string): Promise<ProposalFileRead> => {
  const read = await readPlainFile(systemDir, [PROPOSAL_FILE], SYSTEM_PROPOSAL_MAX_BYTES);
  if (read.kind === 'absent') return { kind: 'absent' };
  if (read.kind === 'not-plain') {
    const bytes = Buffer.alloc(0);
    return { kind: 'read', bytes, fileSha256: sha256Of(bytes), parsed: { proposal: null, id: null, parts: [], raw: null, problems: [], unreadable: PROPOSAL_LINK_SENTENCE } };
  }
  // An over-cap read keeps one byte more than the cap, so the parser's size check refuses it.
  return { kind: 'read', bytes: read.bytes, fileSha256: sha256Of(read.bytes), parsed: parseProposal(read.bytes.toString('utf8'), { skipDirs: SKIP_DIRS }) };
};

/** `<system>/proposal` when it is a real folder there (not a link); null otherwise. */
export const proposalDirOf = async (systemDir: string): Promise<string | null> => {
  let dir: string;
  try {
    dir = await resolveInside(systemDir, [PROPOSAL_DIR]);
  } catch {
    return null;
  }
  const info = await lstat(dir).catch(() => null);
  if (info === null || !info.isDirectory() || !samePath(dir, path.join(systemDir, PROPOSAL_DIR))) return null;
  return dir;
};

/** A plain folder's files (no links followed, dot-names skipped), relative with `/`, bounded. */
export const listFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  let budget = PROPOSAL_ENTRIES_MAX;
  const walk = async (rel: string, depth: number): Promise<void> => {
    const abs = rel === '' ? dir : path.join(dir, ...rel.split('/'));
    const entries = (await readdir(abs, { withFileTypes: true }).catch(() => [])).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (budget <= 0) return;
      budget -= 1;
      if (entry.name.startsWith('.')) continue;
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory() && depth < PROPOSAL_DEPTH_MAX) await walk(child, depth + 1);
      else if (entry.isFile()) out.push(child);
    }
  };
  await walk('', 0);
  return out;
};

/** The entry PROPOSAL.json names now, if it is recorded. */
export const currentEntry = (record: ProposalsRecord | null): SeenProposal | null =>
  record === null || record.current === null ? null : (record.seen.find((entry) => entry.id === record.current) ?? null);

/** The first problem of the current file for the `system-proposal-invalid` finding (§10.4), with the sentence that explains it. */
export type ProposalProblem = { reason: ProposalProblemReason; sentence: string | null };

/**
 * What the check says about PROPOSAL.json now (§10.4): the file is read here (the CLI has no service, so
 * the record may be behind), and the record adds what only the service knows (the step 3 and preview
 * problems, a rewrite). Null when there is no file, it is sound, or it is no longer waiting.
 */
export const readProposalProblem = async (systemDir: string): Promise<ProposalProblem | null> => {
  const file = await readProposalFile(systemDir).catch(() => null);
  if (file === null || file.kind === 'absent') return null;
  const { parsed } = file;
  if (parsed.unreadable !== null) return { reason: 'unreadable', sentence: parsed.unreadable };
  const record = await readProposalsRecord(systemDir);
  const entry = record?.seen.find((item) => item.id === parsed.id) ?? null;
  if (entry !== null) {
    if (entry.state === 'rewritten' || ((entry.state === 'current' || entry.state === 'unreadable') && entry.fileSha256 !== file.fileSha256)) return { reason: 'rewritten', sentence: null };
    if (entry.state !== 'current') return null;
    const reason = entry.reasons[0];
    if (reason !== undefined) return { reason, sentence: entry.problems[0] ?? null };
  }
  const first = parsed.problems[0];
  return first === undefined ? null : { reason: 'unreadable', sentence: first.message };
};
