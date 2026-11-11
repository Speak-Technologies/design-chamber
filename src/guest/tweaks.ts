// The Tweaks panel's brain (Phase 2 technical design §4.4, §4.5; feature 09), one per open design.
// It holds the knob states from `GET /tokens`, the file's sha256 and the pending (unsaved) values,
// and exposes `preview()` — the inline custom properties the wall posts to every live frame as
// `set-tokens` (no reload). Pending values are mirrored to `host.storage` so a frame the host closed
// loses nothing; Save, Reset and Discard delete the mirror. When tokens.css changes under unsaved
// values the controller raises the stale banner (Apply to the new file / Discard); the preview stays
// on top of the new file until the user chooses. No UI here: rows, labels and the leave dialog are
// the panel's; every write is the service's tokens edit route (the 07 rules).

import type { JsonValue } from '@openchamber/sdk';

import type { EditResponse, TokensResponse, TweakValue } from '../shared/api.ts';
import type { TokenVar } from '../shared/bridge-protocol.ts';
import { TOKEN_PREVIEW_VALUE_PATTERN, TWEAK_VAR_PATTERN } from '../shared/limits.ts';
import { isBalancedQuotes, tweakNumberText } from '../shared/tokens-css.ts';
import type { Tweak } from '../shared/types.ts';
import type { ChangeBatch } from './changes.ts';
import type { Schedule } from './page-state.ts';
import { isServiceError, toServiceError, type ServiceClient, type ServiceError } from './service-client.ts';

/** Pending values mirror to `host.storage` this long after the last change (§4.4). */
export const TWEAKS_MIRROR_DEBOUNCE_MS = 300;
/** A `files`/`design` event refetches `GET /tokens` after this quiet. */
export const TWEAKS_REFETCH_DEBOUNCE_MS = 300;

export const TWEAKS_SAVED_SENTENCE = 'Tweaks saved to tokens.css';

/** The `host.storage` key holding one design's pending values (§4.4). */
export const tweaksMirrorKey = (slug: string): string => `tweaks:${slug}`;

/** The notice the controller raises on a successful save (the panel adds Undo). */
export type TweaksNotice = { id: 'tweaks'; message: string };

/** The part of `host.storage` the mirror needs. */
export type TweaksStorage = {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
};

export type TweaksStatus = 'loading' | 'error' | 'ready' | 'saving';

export type TweaksState = {
  status: TweaksStatus;
  /** The last good `GET /tokens` answer; null until one succeeds. */
  tokens: TokensResponse | null;
  loadError: ServiceError | null;
  /** Unsaved values by var (only knobs that differ from the file). */
  pending: ReadonlyMap<string, number | string>;
  dirty: boolean;
  /** tokens.css changed since the pending values were made (§4.5). */
  stale: boolean;
  /** Pending knobs no longer `ok`/`value` in the new file: listed in the banner, left out of Apply. */
  staleExcluded: string[];
  /** The design is gone; pending values are kept for display, nothing written. */
  gone: boolean;
  saveError: ServiceError | null;
};

export type TweaksControllerDeps = {
  client: ServiceClient;
  slug: string;
  /** The current knob definitions (the store's open design); re-read on every use. */
  tweaks: () => readonly Tweak[];
  storage: TweaksStorage;
  /** The wall posts `set-tokens` to the live frames (rAF-coalesced there). */
  onPreview: (vars: TokenVar[]) => void;
  onNotice?: (notice: TweaksNotice) => void;
  now?: () => number;
  schedule?: Schedule;
};

export type TweaksController = {
  load(): Promise<void>;
  /** The load-failed row's "Try again". */
  retry(): Promise<void>;
  getState(): TweaksState;
  subscribe(listener: (state: TweaksState) => void): () => void;
  /** The user moved a knob: clamps and rounds a number, updates pending, preview and the mirror. */
  setValue(varName: string, value: number | string): void;
  preview(): TokenVar[];
  /** Back to the file's values, preview cleared, mirror deleted (no write). */
  reset(): void;
  /** Save the pending values through the tokens edit route. */
  save(): Promise<EditResponse>;
  /** Apply the pending values onto the changed file (the stale banner). */
  applyToNewFile(): Promise<EditResponse>;
  /** Drop the pending values (the stale banner / the leave dialog). */
  discard(): void;
  /** Wire to the change feed: a `files` (tokens.css) or `design` event refetches. */
  applyChanges(batch: ChangeBatch): void;
  dispose(): void;
};

const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** A stored mirror entry, or null when it is not the documented shape. */
const readStoredTweaks = (value: unknown): { sha256: string | null; values: TweakValue[] } | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { sha256?: unknown; values?: unknown };
  const sha256 = typeof record.sha256 === 'string' || record.sha256 === null ? record.sha256 : null;
  if (!Array.isArray(record.values)) return null;
  const values: TweakValue[] = [];
  for (const entry of record.values as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as { var?: unknown; value?: unknown };
    if (typeof item.var !== 'string' || (typeof item.value !== 'number' && typeof item.value !== 'string')) continue;
    values.push({ var: item.var, value: item.value });
  }
  return { sha256, values };
};

/** A number knob's value clamped to its range and rounded to its step. */
const clampStep = (value: number, min: number, max: number, step: number): number => {
  const stepped = Math.round((value - min) / step) * step + min;
  return Math.min(max, Math.max(min, stepped));
};

export const createTweaksController = (deps: TweaksControllerDeps): TweaksController => {
  const { client, slug, tweaks, storage, onPreview, onNotice } = deps;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;
  const mirrorKey = tweaksMirrorKey(slug);

  let status: TweaksStatus = 'loading';
  let tokens: TokensResponse | null = null;
  let loadError: ServiceError | null = null;
  let saveError: ServiceError | null = null;
  let pending = new Map<string, number | string>();
  let baseSha: string | null = null;
  let stale = false;
  let staleExcluded: string[] = [];
  let gone = false;
  let disposed = false;
  let mirrorTimer: (() => void) | null = null;
  let refetchTimer: (() => void) | null = null;
  const listeners = new Set<(state: TweaksState) => void>();

  const getState = (): TweaksState => ({
    status,
    tokens,
    loadError,
    pending,
    dirty: pending.size > 0,
    stale,
    staleExcluded,
    gone,
    saveError,
  });
  const notify = (): void => {
    for (const listener of [...listeners]) listener(getState());
  };

  const knobOf = (varName: string): Tweak | undefined => tweaks().find((knob) => knob.var === varName);
  const stateOf = (varName: string): string | undefined => tokens?.knobs.find((knob) => knob.var === varName)?.state;
  const editable = (varName: string): boolean => {
    const state = stateOf(varName);
    return state === 'ok' || state === 'value';
  };

  // ---- preview ----

  const preview = (): TokenVar[] => {
    const vars: TokenVar[] = [];
    for (const [name, value] of pending) {
      const knob = knobOf(name);
      if (!knob) continue;
      const text = knob.kind === 'number' ? (typeof value === 'number' ? tweakNumberText(value, knob) : null) : typeof value === 'string' ? value : null;
      if (text === null) continue;
      if (!TWEAK_VAR_PATTERN.test(name) || !TOKEN_PREVIEW_VALUE_PATTERN.test(text) || !isBalancedQuotes(text)) continue;
      vars.push({ name, value: text });
    }
    return vars;
  };

  // ---- the host.storage mirror ----

  const writeMirror = async (): Promise<void> => {
    if (disposed || gone) return;
    const values: TweakValue[] = [...pending].map(([varName, value]) => ({ var: varName, value }));
    const entry = { sha256: baseSha, values, at: now() };
    try {
      await storage.set(mirrorKey, entry);
    } catch {
      // The mirror is best-effort; the in-memory pending values still drive the panel.
    }
  };
  const scheduleMirror = (): void => {
    mirrorTimer?.();
    mirrorTimer = schedule(() => {
      mirrorTimer = null;
      void writeMirror();
    }, TWEAKS_MIRROR_DEBOUNCE_MS);
  };
  const deleteMirror = (): void => {
    mirrorTimer?.();
    mirrorTimer = null;
    void storage.delete(mirrorKey).catch(() => undefined);
  };

  const restorePending = async (): Promise<void> => {
    pending = new Map();
    let stored: unknown;
    try {
      stored = await storage.get(mirrorKey);
    } catch {
      return;
    }
    const entry = readStoredTweaks(stored);
    if (!entry) return;
    for (const { var: varName, value } of entry.values) {
      if (knobOf(varName)) pending.set(varName, value); // a knob that no longer exists is dropped
    }
    baseSha = entry.sha256;
  };

  const computeStaleExcluded = (): void => {
    if (!stale || !tokens) {
      staleExcluded = [];
      return;
    }
    staleExcluded = [...pending.keys()].filter((varName) => !editable(varName));
  };

  /** Fold a fresh `GET /tokens` answer into the pending state (the stale rule, §4.5). */
  const adoptTokens = (answer: TokensResponse): void => {
    tokens = answer;
    gone = false;
    if (pending.size > 0 && answer.sha256 !== baseSha) stale = true;
    else {
      baseSha = answer.sha256;
      stale = false;
    }
    computeStaleExcluded();
  };

  // ---- load / refetch ----

  const load = async (): Promise<void> => {
    status = 'loading';
    loadError = null;
    saveError = null;
    notify();
    await restorePending();
    try {
      const answer = await client.call('GET /designs/:slug/tokens', { params: { slug } });
      adoptTokens(answer);
      status = 'ready';
      notify();
      onPreview(preview());
    } catch (error) {
      const serviceError = toServiceError(error);
      if (serviceError.code === 'not-found') {
        gone = true;
        status = 'ready';
        notify();
        return;
      }
      loadError = serviceError;
      status = 'error';
      notify();
    }
  };

  const refetch = async (): Promise<void> => {
    if (disposed || status === 'loading' || status === 'saving') return;
    try {
      const answer = await client.call('GET /designs/:slug/tokens', { params: { slug } });
      adoptTokens(answer);
      if (status === 'error') {
        status = 'ready';
        loadError = null;
      }
      notify();
      if (pending.size > 0) onPreview(preview());
    } catch (error) {
      if (isServiceError(error, 'not-found')) {
        gone = true;
        notify();
      }
      // A transient read failure keeps the current state; the next event retries.
    }
  };

  const scheduleRefetch = (): void => {
    refetchTimer?.();
    refetchTimer = schedule(() => {
      refetchTimer = null;
      void refetch();
    }, TWEAKS_REFETCH_DEBOUNCE_MS);
  };

  const applyChanges = (batch: ChangeBatch): void => {
    if (disposed) return;
    if (batch.reset) {
      scheduleRefetch();
      return;
    }
    for (const event of batch.events) {
      if (event.slug !== slug) continue;
      if (event.kind === 'design') {
        scheduleRefetch();
        return;
      }
      if (event.kind === 'files' && (event.files === undefined || event.files.includes('tokens.css'))) {
        scheduleRefetch();
        return;
      }
    }
  };

  // ---- editing ----

  const setValue = (varName: string, value: number | string): void => {
    if (disposed || gone || !editable(varName)) return;
    const knob = knobOf(varName);
    if (!knob) return;
    let next: number | string;
    if (knob.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      next = clampStep(value, knob.min, knob.max, knob.step);
    } else {
      if (typeof value !== 'string' || !knob.options.some((option) => option.value === value)) return;
      next = value;
    }
    // A value back at the file's own is no longer pending.
    const fileValue = tokens?.knobs.find((entry) => entry.var === varName)?.value ?? null;
    if (fileValue !== null && fileValue === next) pending.delete(varName);
    else pending.set(varName, next);
    if (pending.size === 0) deleteMirror();
    else scheduleMirror();
    onPreview(preview());
    notify();
  };

  const clearPending = (): void => {
    pending = new Map();
    stale = false;
    staleExcluded = [];
    baseSha = tokens?.sha256 ?? null;
    deleteMirror();
    onPreview([]);
    notify();
  };

  // ---- save ----

  const commitTokens = async (base: string, values: TweakValue[]): Promise<EditResponse> => {
    status = 'saving';
    saveError = null;
    notify();
    try {
      const answer = await client.call('POST /designs/:slug/edits', { params: { slug }, body: { op: 'tokens', base, values } });
      // Adopt the write's stamp first, so this view's own change event never raises the banner.
      baseSha = answer.stamps.tokens ?? baseSha;
      pending = new Map();
      stale = false;
      staleExcluded = [];
      deleteMirror();
      onPreview([]);
      status = 'ready';
      notify();
      await refetch();
      onNotice?.({ id: 'tweaks', message: TWEAKS_SAVED_SENTENCE });
      return answer;
    } catch (error) {
      const serviceError = toServiceError(error);
      saveError = serviceError;
      status = 'ready';
      notify();
      if (serviceError.code === 'stale') await refetch();
      throw serviceError;
    }
  };

  const save = (): Promise<EditResponse> => {
    const values: TweakValue[] = [...pending].map(([varName, value]) => ({ var: varName, value }));
    return commitTokens(baseSha ?? '', values);
  };

  const applyToNewFile = (): Promise<EditResponse> => {
    const values: TweakValue[] = [...pending]
      .filter(([varName]) => editable(varName))
      .map(([varName, value]) => ({ var: varName, value }));
    return commitTokens(tokens?.sha256 ?? '', values);
  };

  // ---- lifecycle ----

  return {
    load,
    retry: load,
    getState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setValue,
    preview,
    reset: clearPending,
    save,
    applyToNewFile,
    discard: clearPending,
    applyChanges,
    dispose: () => {
      disposed = true;
      mirrorTimer?.();
      mirrorTimer = null;
      refetchTimer?.();
      refetchTimer = null;
      listeners.clear();
    },
  };
};
