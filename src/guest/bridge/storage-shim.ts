// The `localStorage` / `sessionStorage` stand-in inside the design frame (Phase 2 technical
// design §8.3). A `sandbox="allow-scripts"` frame has an opaque origin, so the browser's own
// storage throws `SecurityError`; the bridge installs this before any design script runs.
//
// It holds only this design's data, handed in by the page through `window.__DC.storage`, and
// it runs in the design's own realm: the design can read or break it, but only for itself.
// `localStorage` with `persist: true` sends its changes to the page once per task, split so no
// message goes over the protocol caps; everything else lives in memory for the frame's life.
//
// Known differences from the browser, by design: `instanceof Storage` is false and no `storage`
// events fire. IndexedDB, cookies and Cache Storage still throw.

import type { StorageChange, StorageInit } from '../../shared/bridge-protocol.ts';
import { PAGE_STATE_BATCH_MAX_CHARS, PAGE_STATE_CHANGES_MAX, PAGE_STATE_MAX_CHARS } from '../../shared/limits.ts';

/** One `storage-batch` body: only the first batch of a task carries `clear`. */
export type StorageBatch = { clear: boolean; changes: StorageChange[] };

export type StorageShim = {
  /** The page's `storage-sync`: updates the frame's `localStorage` map, fires nothing, posts nothing. */
  sync(clear: boolean, changes: readonly StorageChange[]): void;
};

/** What the stand-in needs from the window it installs on; a browser `Window` has all of it. */
export type StorageWindow = object & {
  queueMicrotask?: (task: () => void) => void;
  DOMException?: new (message?: string, name?: string) => Error;
};

/** Key plus value length in UTF-16 code units, the way browsers count storage. */
const sizeOf = (key: string, value: string | null): number => key.length + (value === null ? 0 : value.length);

/**
 * `window.__DC.storage` as the page sent it, or undefined (the frame then runs empty and
 * unsaved). Pairs of strings within `PAGE_STATE_MAX_CHARS` in all; the first of a repeated key
 * wins. No limit on the number of keys: a design may hold more than one batch's worth.
 */
export const readStorageInit = (value: unknown): StorageInit | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const init = value as { persist?: unknown; items?: unknown };
  if (typeof init.persist !== 'boolean' || !Array.isArray(init.items)) return undefined;
  const seen = new Set<string>();
  const items: [string, string][] = [];
  let chars = 0;
  for (const entry of init.items as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return undefined;
    const key: unknown = entry[0];
    const item: unknown = entry[1];
    if (typeof key !== 'string' || typeof item !== 'string') return undefined;
    chars += sizeOf(key, item);
    if (chars > PAGE_STATE_MAX_CHARS) return undefined;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push([key, item]);
  }
  return { persist: init.persist, items };
};

/**
 * Splits one task's changes into batches of at most `limits.changes` entries and `limits.chars`
 * characters of keys plus values, in order; only the first carries `clear`. A lone entry always
 * fits, because the quota already keeps one key plus value within the character cap.
 */
export const splitStorageBatches = (
  clear: boolean,
  changes: readonly StorageChange[],
  limits: { changes: number; chars: number } = { changes: PAGE_STATE_CHANGES_MAX, chars: PAGE_STATE_BATCH_MAX_CHARS },
): StorageBatch[] => {
  const batches: StorageBatch[] = [];
  let current: StorageChange[] = [];
  let chars = 0;
  const close = (): void => {
    batches.push({ clear: clear && batches.length === 0, changes: current });
    current = [];
    chars = 0;
  };
  for (const change of changes) {
    const size = sizeOf(change[0], change[1]);
    if (current.length > 0 && (current.length >= limits.changes || chars + size > limits.chars)) close();
    current.push(change);
    chars += size;
  }
  if (current.length > 0 || (clear && batches.length === 0)) close();
  return batches;
};

/** WebIDL DOMString conversion: like `String()`, but a Symbol throws `TypeError` as in the browser (a template literal runs ToString). */
const domString = (value: unknown): string => `${value}`;

const needArgs = (method: string, args: readonly unknown[], count: number): void => {
  if (args.length < count) {
    throw new TypeError(`Failed to execute '${method}' on 'Storage': ${count} argument${count === 1 ? '' : 's'} required, but only ${args.length} present.`);
  }
};

type Recorder = { set(key: string, value: string | null): void; clear(): void };

type Area = { storage: Storage; apply(clear: boolean, changes: readonly StorageChange[]): void };

const createArea = (seed: readonly (readonly [string, string])[], quota: (key: string) => Error, recorder: Recorder | null): Area => {
  const items = new Map<string, string>();
  let chars = 0;
  for (const [key, value] of seed) {
    if (items.has(key)) continue;
    items.set(key, value);
    chars += sizeOf(key, value);
  }
  // `key(n)` in a loop over `length` stays linear: the key list is rebuilt only after a change.
  let keyList: string[] | null = null;

  const put = (key: string, value: string): void => {
    const old = items.get(key);
    chars += sizeOf(key, value) - (old === undefined ? 0 : sizeOf(key, old));
    if (old === undefined) keyList = null;
    items.set(key, value);
  };
  const drop = (key: string): void => {
    const old = items.get(key);
    if (old === undefined) return;
    chars -= sizeOf(key, old);
    items.delete(key);
    keyList = null;
  };

  const getItem = (...args: unknown[]): string | null => {
    needArgs('getItem', args, 1);
    return items.get(domString(args[0])) ?? null;
  };
  const setItem = (...args: unknown[]): void => {
    needArgs('setItem', args, 2);
    const key = domString(args[0]);
    const value = domString(args[1]);
    const old = items.get(key);
    if (old === value) return;
    const next = chars + sizeOf(key, value) - (old === undefined ? 0 : sizeOf(key, old));
    if (next > PAGE_STATE_MAX_CHARS) throw quota(key);
    put(key, value);
    recorder?.set(key, value);
  };
  const removeItem = (...args: unknown[]): void => {
    needArgs('removeItem', args, 1);
    const key = domString(args[0]);
    if (!items.has(key)) return;
    drop(key);
    recorder?.set(key, null);
  };
  const clear = (): void => {
    if (items.size === 0) return;
    items.clear();
    chars = 0;
    keyList = null;
    recorder?.clear();
  };
  const key = (...args: unknown[]): string | null => {
    needArgs('key', args, 1);
    // WebIDL `unsigned long`: NaN and infinities are 0, the rest truncated modulo 2^32.
    const index = Number(args[0]) >>> 0;
    keyList ??= [...items.keys()];
    return keyList[index] ?? null;
  };

  // The prototype carries the Storage surface; items live in the Map, never as object keys, so
  // `__proto__` or `constructor` are plain data.
  const surface: object = Object.create(Object.prototype, {
    getItem: { value: getItem, enumerable: true, configurable: true, writable: true },
    setItem: { value: setItem, enumerable: true, configurable: true, writable: true },
    removeItem: { value: removeItem, enumerable: true, configurable: true, writable: true },
    clear: { value: clear, enumerable: true, configurable: true, writable: true },
    key: { value: key, enumerable: true, configurable: true, writable: true },
    length: { get: () => items.size, enumerable: true, configurable: true },
    [Symbol.toStringTag]: { value: 'Storage', configurable: true },
  });
  const target: object = Object.create(surface);

  // A stored key is a visible named property only when nothing on the prototype chain has that
  // name (WebIDL named-property visibility), so `getItem` or `length` are never shadowed.
  const isItem = (property: string | symbol): property is string =>
    typeof property === 'string' && items.has(property) && !(property in target);

  const proxy = new Proxy(target, {
    get: (object, property, receiver) => (isItem(property) ? items.get(property) : Reflect.get(object, property, receiver)),
    set: (object, property, value) => {
      if (typeof property !== 'string') return Reflect.set(object, property, value);
      setItem(property, value);
      return true;
    },
    has: (object, property) => (typeof property === 'string' && items.has(property)) || Reflect.has(object, property),
    deleteProperty: (object, property) => {
      if (!isItem(property)) return Reflect.deleteProperty(object, property);
      removeItem(property);
      return true;
    },
    ownKeys: (object) => [...[...items.keys()].filter((name) => !(name in object)), ...Reflect.ownKeys(object)],
    getOwnPropertyDescriptor: (object, property) =>
      isItem(property)
        ? { value: items.get(property), writable: true, enumerable: true, configurable: true }
        : Reflect.getOwnPropertyDescriptor(object, property),
    defineProperty: (object, property, descriptor) => {
      if (typeof property !== 'string') return Reflect.defineProperty(object, property, descriptor);
      if ('get' in descriptor || 'set' in descriptor) return false;
      setItem(property, descriptor.value);
      return true;
    },
    // Like the browser's Storage: it cannot be frozen or sealed (items come and go).
    preventExtensions: () => false,
  });

  return {
    // Safe: the proxy answers every member of the Storage interface (getItem, setItem,
    // removeItem, clear, key, length, named properties); only `instanceof Storage` differs.
    storage: proxy as Storage,
    apply: (clearFirst, changes) => {
      if (clearFirst) {
        items.clear();
        chars = 0;
        keyList = null;
      }
      for (const [name, value] of changes) {
        if (value === null) drop(name);
        else put(name, value);
      }
    },
  };
};

/**
 * Installs the stand-ins on `win` as own, configurable, non-writable properties (verified to
 * replace the sandbox's throwing accessors, §1). Without a valid `init` both are empty and
 * nothing leaves the frame. With `persist: true`, `localStorage` queues its changes (the last
 * value per key; `clear()` empties the queue) and hands them to `post` at the end of the task.
 */
export const installStorage = (win: StorageWindow, init: StorageInit | undefined, post: (batch: StorageBatch) => void): StorageShim => {
  // Captured now, before any design script can replace them.
  const Exception = win.DOMException ?? globalThis.DOMException;
  const schedule = win.queueMicrotask?.bind(win) ?? ((task: () => void) => void Promise.resolve().then(task));
  const quota = (key: string): Error => new Exception(`Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`, 'QuotaExceededError');

  let recorder: Recorder | null = null;
  if (init?.persist) {
    let queued = new Map<string, string | null>();
    let clearQueued = false;
    let scheduled = false;
    const flush = (): void => {
      scheduled = false;
      const changes = [...queued];
      const clear = clearQueued;
      queued = new Map();
      clearQueued = false;
      for (const batch of splitStorageBatches(clear, changes)) post(batch);
    };
    const wake = (): void => {
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    };
    recorder = {
      set: (key, value) => {
        // Re-inserted so the queue keeps the order of the last change to each key.
        queued.delete(key);
        queued.set(key, value);
        wake();
      },
      clear: () => {
        queued.clear();
        clearQueued = true;
        wake();
      },
    };
  }

  const local = createArea(init?.items ?? [], quota, recorder);
  const session = createArea([], quota, null);
  for (const [name, area] of [['localStorage', local], ['sessionStorage', session]] as const) {
    try {
      Object.defineProperty(win, name, { value: area.storage, configurable: true, enumerable: true, writable: false });
    } catch {
      // A window that refuses the definition keeps its own storage (which throws in the
      // sandbox, as before Phase 2); the bridge must still start, so this is not fatal.
    }
  }
  return { sync: (clear, changes) => local.apply(clear, changes) };
};
