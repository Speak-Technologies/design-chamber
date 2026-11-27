// The user's design systems (Phase 2.5 U1), loaded from `GET /systems` and kept fresh by the change feed. One store per
// frame, shared by the page and the rail. Like the folders store: a load puts its outcome in state (a failed refresh
// keeps the rows it had), a mutation says its sentence on failure and re-reads the truth.

import type { SystemListResponse } from '../../shared/api.ts';
import type { SystemSummary } from '../../shared/types.ts';
import { toServiceError, type ServiceError } from '../../guest/service-client.ts';
import { client, feed, store } from '../guest.ts';
import { systemsListShouldRefresh } from '../model/system-events-model.ts';
import { debounce, errorText } from './dom.ts';

export type SystemsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The last good list; null until the first answer. */
  systems: SystemSummary[] | null;
  total: number;
  max: number;
  error: ServiceError | null;
};

export type SystemsStore = {
  get: () => SystemsState;
  subscribe: (listener: (state: SystemsState) => void) => () => void;
  load: () => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  /** Moves it to the trash; resolves to what the delete cleared (`default`, pins). */
  remove: (id: string) => Promise<{ default: boolean; pins: number }>;
  /** `null` stops it being the default (new designs ask again). */
  setDefault: (system: { id: string; name: string } | null) => Promise<void>;
};

const createSystemsStore = (): SystemsStore => {
  let state: SystemsState = { status: 'idle', systems: null, total: 0, max: 50, error: null };
  const listeners = new Set<(state: SystemsState) => void>();
  let ticket = 0;

  const set = (next: SystemsState): void => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const apply = (answer: SystemListResponse): void => set({ status: 'ready', systems: answer.systems, total: answer.total, max: answer.max, error: null });

  const load = async (): Promise<void> => {
    ticket += 1;
    const mine = ticket;
    set({ ...state, status: state.systems === null ? 'loading' : state.status, error: null });
    try {
      const answer = await client.call('GET /systems');
      if (mine !== ticket) return;
      apply(answer);
    } catch (error) {
      if (mine !== ticket) return;
      console.warn('Design Chamber: design systems failed to load', error);
      set({ ...state, status: 'error', error: toServiceError(error) });
    }
  };

  /** Runs one mutation; on failure the list is re-read (so a half-applied view never lingers) and the sentence is rethrown. */
  const run = async <T>(request: () => Promise<T>): Promise<T> => {
    try {
      const answer = await request();
      void load();
      return answer;
    } catch (error) {
      void load();
      throw new Error(errorText(error));
    }
  };

  // A system changed (the agent wrote a file, a revision settled), one was added or removed, or the folder changed.
  const refresh = debounce(() => void load(), 200);
  feed.subscribe((batch) => {
    // A board comment changes no row, so it doesn't read the list again.
    if (systemsListShouldRefresh(batch)) refresh();
  });

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    load,
    rename: (id, name) =>
      run(async () => {
        await client.call('PATCH /systems/:id', { params: { id }, body: { name } });
      }),
    remove: (id) =>
      run(async () => {
        const answer = await client.call('DELETE /systems/:id', { params: { id } });
        return answer.clearedSettings;
      }),
    setDefault: (system) =>
      run(async () => {
        await store.updateSettings({ systemDefault: system === null ? { choice: 'ask' } : { choice: 'system', id: system.id, name: system.name } });
      }),
  };
};

let shared: SystemsStore | null = null;

/** The frame's one systems store, created on first use (after `startGuest`). */
export const systems = (): SystemsStore => {
  if (shared === null) {
    shared = createSystemsStore();
    void shared.load();
  }
  return shared;
};
