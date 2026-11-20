// Inline editing on the design system page (Phase 2.5 U2, technical design §9.3, §6): the values the user has
// changed and not saved yet, the one request that saves them, and the preview the board shows meanwhile.
// Pure: no DOM, no service. A value is checked with `validateTokenValue` before it enters the pending map.

import type { MetaChange, SystemEditRequest, SystemTextFile, TokenEdit } from '../../shared/api.ts';
import { SYSTEM_NOTE_MAX, SYSTEM_USAGE_NOTE_MAX, TOKEN_PREVIEW_NAME_PATTERN, TOKEN_PREVIEW_VALUE_PATTERN, TOKEN_PREVIEW_VARS_MAX } from '../../shared/limits.ts';
import { darkVarOf, typeVarOf } from '../../shared/system-board.ts';
import { FORMULA_SENTENCE, UNREADABLE_VALUE_SENTENCE, validateTokenValue, type TypeField } from '../../shared/token-edit.ts';
import type { SystemDetail, SystemToken, TokenSection, TypeStyle } from '../../shared/types.ts';
import type { TokenVar } from '../../shared/bridge-protocol.ts';

export const STALE_TITLE = 'changed while you were editing';
export const STALE_ACTION = 'Reload and try again';
export const NO_VERSION_SENTENCE = 'Couldn’t save a version first, so nothing was changed.';
export const OLD_VERSION_SENTENCE = 'You’re viewing an old version.';

/** What one pending change is: a token value, a type style field, a usage note or the overview text. */
export type PendingChange =
  | { kind: 'token'; name: string; mode: 'light' | 'dark'; value: string; section: TokenSection; existed: boolean }
  | { kind: 'type'; id: string; field: TypeField; value: string }
  | { kind: 'note'; path: 'tokens' | 'components' | 'patterns' | 'brand' | 'type'; id: string; value: string }
  | { kind: 'purpose'; id: string; value: string }
  | { kind: 'text'; file: SystemTextFile; value: string }
  | { kind: 'remove'; name: string };

export type PendingMap = ReadonlyMap<string, PendingChange>;

export const tokenKey = (name: string, mode: 'light' | 'dark'): string => `token:${name}:${mode}`;
export const typeKey = (id: string, field: TypeField): string => `type:${id}:${field}`;
export const noteKey = (path: string, id: string): string => `note:${path}:${id}`;
export const purposeKey = (id: string): string => `purpose:${id}`;
export const textKey = (file: string): string => `text:${file}`;
export const removeKey = (name: string): string => `remove:${name}`;

/** The check a value passes before it goes in the pending map: a sentence when it fails. */
export const checkValue = (section: TokenSection, field: TypeField | null, text: string): { ok: true } | { ok: false; sentence: string } => {
  const answer = validateTokenValue(section, field, text.trim());
  return answer.ok ? { ok: true } : { ok: false, sentence: answer.sentence };
};

export const noteProblem = (text: string, max: number = SYSTEM_USAGE_NOTE_MAX): string | null => (text.length > max ? `Keep this under ${max} characters.` : null);
export const textProblem = (text: string): string | null => (text.length > SYSTEM_NOTE_MAX ? `Keep this under ${SYSTEM_NOTE_MAX} characters.` : null);

/** Why a value can't be edited here, or null when it can. */
export const valueLock = (editable: 'ok' | 'formula' | 'unreadable'): string | null =>
  editable === 'formula' ? FORMULA_SENTENCE : editable === 'unreadable' ? UNREADABLE_VALUE_SENTENCE : null;

const typeValue = (field: TypeField, text: string): string | number => (field === 'weight' && /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : text.trim());

/** The system.json metadata changes among the pending ones. */
const metaChanges = (pending: PendingMap): MetaChange[] => {
  const changes: MetaChange[] = [];
  for (const change of pending.values()) {
    if (change.kind === 'type') changes.push({ at: ['type', change.id, change.field], value: typeValue(change.field, change.value) });
    else if (change.kind === 'purpose') changes.push({ at: ['components', change.id, 'purpose'], value: change.value.trim() });
    else if (change.kind === 'note') {
      const value = change.value.trim();
      if (change.path === 'tokens') changes.push({ at: ['tokens', change.id, 'note'], value });
      else if (change.path === 'components') changes.push({ at: ['components', change.id, 'note'], value });
      else if (change.path === 'type') changes.push({ at: ['type', change.id, 'note'], value });
      else changes.push({ at: [change.path, change.id, 'note'], value });
    }
  }
  return changes;
};

const tokenEdits = (pending: PendingMap): TokenEdit[] => {
  const edits: TokenEdit[] = [];
  for (const change of pending.values()) {
    if (change.kind === 'token') edits.push({ kind: change.existed ? 'set' : 'add', name: change.name, mode: change.mode, value: change.value.trim() });
    else if (change.kind === 'remove') edits.push({ kind: 'remove', name: change.name, mode: 'both' });
  }
  return edits;
};

/** The save request for the pending map, with the stamps of the files it touches; null when nothing is pending. */
export const saveRequest = (pending: PendingMap, detail: SystemDetail): Extract<SystemEditRequest, { op: 'save' }> | null => {
  if (pending.size === 0) return null;
  const tokens = tokenEdits(pending);
  const meta = metaChanges(pending);
  const texts: { file: SystemTextFile; text: string }[] = [];
  for (const change of pending.values()) if (change.kind === 'text') texts.push({ file: change.file, text: change.value });
  const stamps: Extract<SystemEditRequest, { op: 'save' }>['stamps'] = {};
  if (tokens.length > 0) stamps.tokens = detail.stamps.tokens;
  if (meta.length > 0) stamps.systemJson = detail.stamps.systemJson;
  if (texts.length > 0) {
    stamps.texts = {};
    for (const entry of texts) stamps.texts[entry.file] = entry.file === 'OVERVIEW.md' ? detail.stamps.overview : (detail.stamps.notes[entry.file.replace(/^notes\//, '').replace(/\.md$/, '')] ?? null);
  }
  const request: Extract<SystemEditRequest, { op: 'save' }> = { op: 'save', stamps };
  if (tokens.length > 0) request.tokens = tokens;
  if (meta.length > 0) request.meta = meta;
  if (texts.length > 0) request.texts = texts;
  return request;
};

/** What the board previews while changes are pending: only values that already passed the bridge's own pattern. */
export const previewVars = (pending: PendingMap): TokenVar[] => {
  const vars: TokenVar[] = [];
  const add = (name: string, value: string): void => {
    const text = value.trim();
    if (!TOKEN_PREVIEW_NAME_PATTERN.test(name) || !TOKEN_PREVIEW_VALUE_PATTERN.test(text)) return;
    if (vars.length < TOKEN_PREVIEW_VARS_MAX) vars.push({ name, value: text });
  };
  for (const change of pending.values()) {
    try {
      if (change.kind === 'token') add(change.mode === 'light' ? change.name : darkVarOf(change.name), change.value);
      else if (change.kind === 'type') add(typeVarOf(change.id, change.field), change.value);
    } catch {
      // A name off the pattern has no preview; the save still validates it.
    }
  }
  return vars;
};

/** The sentence under the board when the service refused the stamp. */
export const staleSentence = (name: string): string => `${name} ${STALE_TITLE}. Nothing was saved.`;

export const pendingCount = (pending: PendingMap): number => pending.size;

/** The saved value the field is compared with (a change back to it drops out of the map). */
export const savedToken = (token: SystemToken, mode: 'light' | 'dark'): string | null => (mode === 'light' ? token.light?.text : token.dark?.text) ?? null;
export const savedType = (style: TypeStyle, field: TypeField): string => style[field];

/** The undo notice after a save: "Saved Acme." with the service's own label when it has one. */
export const savedNotice = (label: string): { title: string; body: string } => ({ title: 'Saved', body: label });
