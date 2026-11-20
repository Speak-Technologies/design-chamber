// A design's copy of its design system (documentation/specs/phase-2-5-technical.md §2.6, §2.7):
// the COPY.json reader, the overrides and own tokens of a design, drift, and what the design shows.
// Pure and Node-free: the service routes, the list, the checks and the UI decide the same way.

import { isIsoDate } from './design-json.ts';
import { SHA256_PATTERN, SYSTEM_ID_PATTERN, SYSTEM_NAME_MAX, VERSION_ID_PATTERN } from './limits.ts';
import { isDarkContext, isLightContext } from './token-edit.ts';
import { scanTokens, type Declaration } from './tokens-css.ts';
import type { CopyRecord, DesignSystemSummary } from './types.ts';

/** The folder of a design that holds its copy, and the link record inside it. */
export const COPY_DIR = 'system';
export const COPY_JSON_FILE = 'COPY.json';
export const COPY_SCHEMA_VERSION = 1;
/** A COPY.json larger than this is not read: an invalid copy (§16). */
export const COPY_JSON_MAX_BYTES = 64 * 1024;
/** Files one copy may list (the system's own cap is 200 assets plus the text files). */
export const COPY_FILES_MAX = 1000;

/** A copy-relative path: `/` separators, every segment a plain name (no dot start, no `..`). */
const COPY_REL_PATTERN = /^(?:[A-Za-z0-9_][A-Za-z0-9 ._-]{0,99}\/){0,2}[A-Za-z0-9_][A-Za-z0-9 ._-]{0,99}$/;

export const isCopyRel = (rel: string): boolean => COPY_REL_PATTERN.test(rel) && !rel.split('/').some((part) => part === '..' || part.endsWith('.'));

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * COPY.json (schema `design-chamber/system-copy@1`) as a typed record, or null when any field is
 * not what Design Chamber writes. The file sits in a folder the agent can reach, so nothing in it
 * is trusted: an id that is not a system id, a path that is not a plain copy path, a hash that is
 * not sha256 all make the copy invalid (link unknown; only Change… is offered).
 */
export const parseCopyRecord = (raw: unknown): CopyRecord | null => {
  if (!isRec(raw) || raw.v !== COPY_SCHEMA_VERSION) return null;
  const { id, name, revision, treeHash, at, by, before, files } = raw;
  if (typeof id !== 'string' || !SYSTEM_ID_PATTERN.test(id)) return null;
  if (typeof name !== 'string' || name.length < 1 || name.length > SYSTEM_NAME_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (typeof treeHash !== 'string' || !SHA256_PATTERN.test(treeHash)) return null;
  if (!isIsoDate(at)) return null;
  if (by !== 'user' && by !== 'agent' && by !== 'creation') return null;
  if (!(before === null || (typeof before === 'string' && VERSION_ID_PATTERN.test(before)))) return null;
  if (!isRec(files)) return null;
  const entries = Object.entries(files);
  if (entries.length > COPY_FILES_MAX) return null;
  const map: Record<string, string> = {};
  for (const [rel, hash] of entries) {
    if (!isCopyRel(rel) || rel === COPY_JSON_FILE || typeof hash !== 'string' || !SHA256_PATTERN.test(hash)) return null;
    map[rel] = hash;
  }
  return { v: 1, id, name, revision, treeHash, at, by, before, files: map };
};

/** COPY.json text that parses, or null (not JSON, or not a valid record). */
export const parseCopyRecordText = (text: string): CopyRecord | null => {
  try {
    return parseCopyRecord(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    return null;
  }
};

// ---- tokens: overrides, own tokens, the difference between two copies ----

type ModeValues = { light: string | null; dark: string | null };

const valueOf = (css: string, declaration: Declaration): string => css.slice(declaration.from, declaration.to).trim();

/**
 * Every name in the two contexts a system writes (§2.4: the top-level `:root` and the `:root` in the
 * dark media query), with its last value in each. Declarations in other contexts are component
 * styling, not tokens, and are left out.
 */
export const tokenValues = (css: string | null): Map<string, ModeValues> => {
  const out = new Map<string, ModeValues>();
  if (css === null) return out;
  for (const declaration of scanTokens(css)) {
    const light = isLightContext(declaration.context, 'system');
    const dark = !light && isDarkContext(declaration.context, 'system');
    if (!light && !dark) continue;
    const entry = out.get(declaration.name) ?? { light: null, dark: null };
    if (light) entry.light = valueOf(css, declaration);
    else entry.dark = valueOf(css, declaration);
    out.set(declaration.name, entry);
  }
  return out;
};

const shown = (values: ModeValues): string => values.light ?? values.dark ?? '';

export type TokenOverride = { name: string; value: string; systemValue: string };

/**
 * A design's overrides (Q5): declarations in its own tokens.css whose name the copy's tokens.css
 * defines. One entry per name, light value first (the dark one when the design sets only that).
 */
export const overridesOf = (copyCss: string | null, designCss: string | null): TokenOverride[] => {
  const system = tokenValues(copyCss);
  const out: TokenOverride[] = [];
  for (const [name, values] of tokenValues(designCss)) {
    const systemValues = system.get(name);
    if (systemValues === undefined) continue;
    const useLight = values.light !== null;
    out.push({ name, value: shown(values), systemValue: (useLight ? systemValues.light : systemValues.dark) ?? shown(systemValues) });
  }
  return out;
};

/** Names in the design's own tokens.css the copy does not define ("this design's own tokens"). */
export const ownTokensOf = (copyCss: string | null, designCss: string | null): string[] => {
  const system = tokenValues(copyCss);
  return [...tokenValues(designCss).keys()].filter((name) => !system.has(name));
};

export type TokenDiff = { changed: { name: string; from: string; to: string }[]; added: string[]; removed: string[] };

/** What moves from one tokens.css to another (the update and change preview, §3.2). */
export const tokenDiff = (fromCss: string | null, toCss: string | null): TokenDiff => {
  const from = tokenValues(fromCss);
  const to = tokenValues(toCss);
  const diff: TokenDiff = { changed: [], added: [], removed: [] };
  for (const [name, values] of to) {
    const old = from.get(name);
    if (old === undefined) diff.added.push(name);
    else if (old.light !== values.light || old.dark !== values.dark) diff.changed.push({ name, from: shown(old), to: shown(values) });
  }
  for (const name of from.keys()) if (!to.has(name)) diff.removed.push(name);
  return diff;
};

/** Components by id in a system.json text (raw entries as JSON text); unreadable text → none. */
const componentsOf = (text: string | null): Map<string, string> => {
  const out = new Map<string, string>();
  if (text === null) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return out;
  }
  if (!isRec(raw) || !Array.isArray(raw.components)) return out;
  for (const entry of raw.components) {
    if (isRec(entry) && typeof entry.id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(entry.id) && !out.has(entry.id)) out.set(entry.id, JSON.stringify(entry));
  }
  return out;
};

/** Component ids changed, added and removed between two system.json texts (the preview, §3.2). */
export const componentDiff = (fromText: string | null, toText: string | null): { changed: string[]; added: string[]; removed: string[] } => {
  const from = componentsOf(fromText);
  const to = componentsOf(toText);
  const diff = { changed: [] as string[], added: [] as string[], removed: [] as string[] };
  for (const [id, entry] of to) {
    const old = from.get(id);
    if (old === undefined) diff.added.push(id);
    else if (old !== entry) diff.changed.push(id);
  }
  for (const id of from.keys()) if (!to.has(id)) diff.removed.push(id);
  return diff;
};

// ---- drift (S7-2) ----

export type CopyDrift = { changed: string[]; missing: string[]; extra: string[]; tokens: string[] };

/**
 * The copy against what is on disk now: files whose hash moved, files gone, files nobody listed
 * (COPY.json itself aside). `original`/`current` tokens.css texts, when both are known, name the
 * tokens whose values differ. Overrides in the design's own tokens.css are never drift.
 */
export const copyDrift = (
  record: CopyRecord,
  currentFiles: Readonly<Record<string, string>>,
  tokens?: { original: string | null; current: string | null },
): CopyDrift => {
  const drift: CopyDrift = { changed: [], missing: [], extra: [], tokens: [] };
  for (const [rel, hash] of Object.entries(record.files)) {
    const now = currentFiles[rel];
    if (now === undefined) drift.missing.push(rel);
    else if (now !== hash) drift.changed.push(rel);
  }
  for (const rel of Object.keys(currentFiles)) if (rel !== COPY_JSON_FILE && record.files[rel] === undefined) drift.extra.push(rel);
  if (tokens !== undefined && tokens.original !== null && drift.changed.includes('tokens.css')) {
    const diff = tokenDiff(tokens.original, tokens.current);
    drift.tokens = [...diff.changed.map((one) => one.name), ...diff.added, ...diff.removed];
  }
  for (const list of [drift.changed, drift.missing, drift.extra]) list.sort();
  return drift;
};

// ---- what the design shows (§2.7) ----

export type DesignSystemStatusValue =
  | { state: 'linked'; id: string; name: string; linkState: 'ok' | 'draft' | 'deleted' }
  | { state: 'invalid' }
  | { state: 'none' }
  | { state: 'ask' }
  | { state: 'unset' };

/** A system as the status rules see it, from the systems index. */
export type IndexedSystem = { id: string; name: string; status: 'draft' | 'ready'; revision: number };

/**
 * A valid copy names the link (`deleted` when the id is not in this root); an invalid one says so;
 * without a copy the recorded decision answers (`system` with no copy: a restore went back before
 * the link, so "No design system"); an old design without a decision is `unset`.
 */
export const designSystemStatus = (input: {
  copy: CopyRecord | null;
  copyInvalid: boolean;
  decision: 'ask' | 'none' | 'system' | undefined;
  systems: readonly IndexedSystem[];
}): DesignSystemStatusValue => {
  if (input.copy !== null) {
    const { copy } = input;
    const system = input.systems.find((one) => one.id === copy.id);
    if (system === undefined) return { state: 'linked', id: copy.id, name: copy.name, linkState: 'deleted' };
    return { state: 'linked', id: copy.id, name: system.name, linkState: system.status === 'ready' ? 'ok' : 'draft' };
  }
  if (input.copyInvalid) return { state: 'invalid' };
  if (input.decision === 'ask') return { state: 'ask' };
  if (input.decision === 'none' || input.decision === 'system') return { state: 'none' };
  return { state: 'unset' };
};

/** The list's line for a design's link (`DesignSummary.system`), from its copy and the systems index. */
export const designSystemSummary = (copy: Pick<CopyRecord, 'id' | 'name' | 'revision'>, systems: readonly IndexedSystem[]): DesignSystemSummary => {
  const system = systems.find((one) => one.id === copy.id);
  if (system === undefined) return { id: copy.id, name: copy.name, revision: copy.revision, state: 'deleted', updateAvailable: false };
  const ready = system.status === 'ready';
  return { id: copy.id, name: system.name, revision: copy.revision, state: ready ? 'ok' : 'draft', updateAvailable: ready && system.revision > copy.revision };
};
