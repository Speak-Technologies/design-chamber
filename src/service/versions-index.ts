// Pure rules for reading `.versions/index.json` (phase-0 spec, 0a): what a damaged index is,
// what survives it, and what the drawer is told. No I/O here; versions.ts does the reading and writing.
//
// The index lives in the agent-writable design folder, so every byte of it, the backup and
// the damaged copies is untrusted input. `parseIndexText` is the one gate for all three.

import type { VersionHistoryState } from '../shared/api.ts';
import { SHA256_PATTERN, VERSION_ID_PATTERN, VERSION_INDEX_VERSION } from '../shared/limits.ts';
import type { VersionEntry, VersionIndex } from '../shared/types.ts';

export const VERSIONS_DIR = '.versions';
export const CHAMBER_DIR = '.chamber';

/** 100 versions x 1 000 files is about 12 MB; anything beyond this is not read, only set aside. */
export const INDEX_READ_MAX_BYTES = 64 * 1024 * 1024;
/** Damaged copies kept per design (newest by time). */
export const DAMAGED_KEEP_MAX = 5;
/** How long a damaged copy (and every file it names) is kept. */
export const DAMAGED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

// ---- tracked set and path rules ----

/** `.versions/**`, `.chamber/**`, `.thumb.png` (and its atomic-write temporaries) are never tracked. */
export const isTracked = (rel: string): boolean => {
  const segments = rel.split('/');
  if (segments[0] === VERSIONS_DIR || segments[0] === CHAMBER_DIR) return false;
  const base = segments[segments.length - 1] ?? '';
  return base !== '.thumb.png' && !base.startsWith('.thumb.');
};

/** A design-relative `/` path with no step that could leave the folder (lexical; writes still go through `resolveInside`). */
export const isSafeRel = (rel: string): boolean =>
  rel !== '' &&
  !rel.includes('\u0000') &&
  !rel.includes('\\') &&
  !rel.startsWith('/') &&
  !/^[A-Za-z]:/.test(rel) &&
  rel.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

/** Every path must be tracked and safe, every object a sha256. */
export const isFileMap = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.entries(value).every(([rel, hash]) => isSafeRel(rel) && isTracked(rel) && typeof hash === 'string' && SHA256_PATTERN.test(hash));

export const isEntry = (value: unknown): value is VersionEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    VERSION_ID_PATTERN.test(entry.id) &&
    typeof entry.n === 'number' &&
    typeof entry.created === 'string' &&
    typeof entry.reason === 'string' &&
    (entry.sessionId === null || typeof entry.sessionId === 'string') &&
    typeof entry.treeHash === 'string' &&
    SHA256_PATTERN.test(entry.treeHash) &&
    isFileMap(entry.files) &&
    typeof entry.bytes === 'number'
  );
};

// ---- parsing ----

export type IndexParse =
  | { kind: 'ok'; index: VersionIndex; dropped: number }
  | { kind: 'unsupported'; version: number }
  | { kind: 'unreadable' };

/**
 * Entries are dropped one by one: a single bad entry never hides the others. A newer `version`
 * is `unsupported` whatever else it holds (its other fields mean something this build cannot read).
 */
export const parseIndexText = (text: string): IndexParse => {
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { kind: 'unreadable' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'unreadable' };
  const raw = value as { version?: unknown; next?: unknown; versions?: unknown };
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) return { kind: 'unreadable' };
  if (raw.version > VERSION_INDEX_VERSION) return { kind: 'unsupported', version: raw.version };
  if (raw.version !== VERSION_INDEX_VERSION || !Array.isArray(raw.versions)) return { kind: 'unreadable' };

  const versions = raw.versions.filter(isEntry);
  const floor = versions.reduce((max, entry) => Math.max(max, entry.n + 1), 1);
  const next = typeof raw.next === 'number' && Number.isInteger(raw.next) && raw.next >= 1 ? Math.max(raw.next, floor) : floor;
  return { kind: 'ok', index: { version: VERSION_INDEX_VERSION, next, versions }, dropped: raw.versions.length - versions.length };
};

// ---- scans of damaged text: protect and number, never read or write through them ----

/** Every 64-hex run in the text, so a truncated file still protects what it names. */
export const hashesMentioned = (text: string): Set<string> => new Set(text.match(/[0-9a-f]{64}/g) ?? []);

/** The highest `"id": "vN"` named anywhere in the text (0 if none), so new ids never repeat old ones. */
export const highestVersionNumber = (text: string): number => {
  let highest = 0;
  for (const match of text.matchAll(/"id"\s*:\s*"v([1-9][0-9]{0,8})"/g)) highest = Math.max(highest, Number(match[1]));
  return highest;
};

// ---- damaged file names ----

export type DamageKind = 'entries' | 'recovered' | 'reset';

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** `index.damaged-<YYYYMMDDTHHMMSSZ>-<rand>-<kind>.json`: only `[0-9A-Za-z.-]`, safe on Windows. */
export const damagedFileName = (now: Date, kind: DamageKind, rand: string): string =>
  `index.damaged-${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z-${rand}-${kind}.json`;

const DAMAGED_NAME = /^index\.damaged-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9A-Za-z]{1,16}-(entries|recovered|reset)\.json$/;

export const parseDamagedFileName = (name: string): { at: number; kind: DamageKind } | null => {
  const match = DAMAGED_NAME.exec(name);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const at = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(at);
  // Date.UTC rolls month 13 over to January; a real stamp reads back unchanged.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour) return null;
  return { at, kind: match[7] as DamageKind };
};

// ---- what the drawer is told ----

export type IndexHealth = 'ok' | 'repaired' | 'recovered' | 'reset' | 'unsupported';

const STATE_OF_KIND: Record<DamageKind, VersionHistoryState> = { entries: 'repaired', recovered: 'recovered', reset: 'reset' };

/** `unsupported`, then what this read found, then the newest damaged copy still on disk, else nothing. */
export const historyStateOf = (health: IndexHealth, damaged: readonly { at: number; kind: DamageKind }[]): VersionHistoryState | null => {
  if (health === 'unsupported') return 'unsupported';
  if (health !== 'ok') return health;
  let newest: { at: number; kind: DamageKind } | null = null;
  for (const item of damaged) if (newest === null || item.at > newest.at) newest = item;
  return newest === null ? null : STATE_OF_KIND[newest.kind];
};
