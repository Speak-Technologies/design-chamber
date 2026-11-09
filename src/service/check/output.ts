// Where a check writes (documentation/specs/agent-render-and-check.md §4.6): PNGs under
// `<design>/.chamber/check/<runId>/` and the report `<design>/.chamber/check.json`. The agent
// writes into design folders too, so `.chamber` and `.chamber/check` are refused when they are
// links; every path is resolved through `resolveInside`; the report is written last, atomically.

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CHECK_RUN_KEEP_MS } from '../../shared/limits.ts';
import type { CheckReport } from '../../shared/types.ts';
import { resolveInside, writeFileAtomic } from '../paths.ts';

export class CheckOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckOutputError';
  }
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/** Create `<parent>/<name>` when absent; refuse a link or a plain file in its place (`label` names it in the message). */
export const ensureNormalFolder = async (parent: string, name: string, label: string): Promise<string> => {
  const target = path.join(parent, name);
  const info = await lstat(target).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info !== null && (info.isSymbolicLink() || !info.isDirectory())) {
    throw new CheckOutputError(`This design's ${label} entry is not a normal folder, so Design Chamber cannot save the check there. Remove it and run the check again.`);
  }
  if (info === null) await mkdir(target);
  return target;
};

/** `<design>/.chamber`, created when absent; refuses a link or a file. */
export const ensureChamberDir = (designDir: string): Promise<string> => ensureNormalFolder(designDir, '.chamber', '.chamber');

/** `<design>/.chamber/check`, created when absent; refuses a link or a file at either level. Answers the contained real path. */
export const ensureCheckDir = async (designDir: string): Promise<string> => {
  const chamber = await ensureChamberDir(designDir);
  await ensureNormalFolder(chamber, 'check', '.chamber/check');
  return resolveInside(designDir, ['.chamber', 'check']);
};

const RUN_ID_PATTERN = /^r-[0-9]{14}-[0-9a-f]{6}$/;

const stamp = (date: Date): string => date.toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** `r-<yyyymmddhhmmss>-<6 hex>`. */
export const newRunId = (now: Date, random: () => string = () => randomBytes(3).toString('hex')): string => `r-${stamp(now)}-${random()}`;

export const isRunId = (value: string): boolean => RUN_ID_PATTERN.test(value);

const unsafeStemChars = /[^A-Za-z0-9@._-]/g;

/** `home@laptop`, with `-<n>` for the second and later slices of a tall page. */
export const pngStem = (input: { screen: string | null; viewport: string; slice: number; slices: number }): string => {
  const base = `${(input.screen ?? 'page').replace(unsafeStemChars, '_')}@${input.viewport.replace(unsafeStemChars, '_')}`;
  return input.slices > 1 && input.slice > 1 ? `${base}-${input.slice}` : base;
};

/**
 * File names for `stems`, unique case-insensitively (Windows and macOS would merge `Laptop` and
 * `laptop`): a repeated name gets `-b`, `-c`, … before `.png`.
 */
export const pngNames = (stems: readonly string[]): string[] => {
  const taken = new Set<string>();
  return stems.map((stem) => {
    let candidate = `${stem}.png`;
    for (let n = 0; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem}-${String.fromCharCode(98 + (n % 25))}${n >= 25 ? String(Math.floor(n / 25)) : ''}.png`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
};

/** Design-relative path (`/`) of a PNG in a run. */
export const pngRelOf = (runId: string, name: string): string => `.chamber/check/${runId}/${name}`;

/** Create the run folder; answers its contained real path. */
export const createRunDir = async (designDir: string, runId: string): Promise<string> => {
  const checkDir = await ensureCheckDir(designDir);
  const runDir = path.join(checkDir, runId);
  await mkdir(runDir, { recursive: true });
  return resolveInside(designDir, ['.chamber', 'check', runId]);
};

export const writePng = async (designDir: string, runId: string, name: string, bytes: Uint8Array): Promise<string> => {
  const target = await resolveInside(designDir, ['.chamber', 'check', runId, name]);
  await writeFile(target, bytes);
  return target;
};

/** Absolute path of the report. */
export const reportPathOf = (designDir: string): string => path.join(designDir, '.chamber', 'check.json');

/** Write `check.json` atomically (last writer wins). Refuses a linked `.chamber`. */
export const writeCheckReport = async (designDir: string, report: CheckReport): Promise<string> => {
  await ensureChamberDir(designDir);
  const target = await resolveInside(designDir, ['.chamber', 'check.json']);
  await writeFileAtomic(target, `${JSON.stringify(report, null, 2)}\n`);
  return target;
};

/**
 * Remove run folders the new report does not name and that are older than `CHECK_RUN_KEEP_MS`
 * (a concurrent run's folder is young, so it survives). Only `r-*` folders directly under
 * `.chamber/check`; nothing else is touched.
 */
export const cleanupRuns = async (designDir: string, keep: ReadonlySet<string>, nowMs: number, keepMs: number = CHECK_RUN_KEEP_MS): Promise<string[]> => {
  const removed: string[] = [];
  let checkDir: string;
  try {
    checkDir = await ensureCheckDir(designDir);
  } catch {
    return removed;
  }
  const entries = await readdir(checkDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !isRunId(entry.name) || keep.has(entry.name)) continue;
    const target = path.join(checkDir, entry.name);
    const info = await stat(target).catch(() => null);
    if (info === null || nowMs - info.mtimeMs < keepMs) continue;
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    removed.push(entry.name);
  }
  return removed;
};
