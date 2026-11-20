// The user's folders (Phase 2.5 G1), loaded from the `/folders` routes and kept fresh by the change feed.
// One store per frame, shared by the page library, the rail list and the dialogs. Folders are labels: nothing
// here touches a design's own folder on disk. A mutation updates the view at once and the service answer confirms it;
// a failure reloads the truth and rethrows the service's sentence for the caller to show next to the control.

import type { FolderView } from '../../shared/api.ts';
import { client, feed } from '../guest.ts';
import { debounce, errorText } from './dom.ts';

export type FoldersState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  folders: FolderView[];
  /** The registry file could not be read: the list is empty and says so (the same "couldn't load" sentence). */
  damaged: boolean;
  error: string | null;
};

export type FoldersStore = {
  get: () => FoldersState;
  subscribe: (listener: (state: FoldersState) => void) => () => void;
  load: () => Promise<void>;
  create: (name: string) => Promise<FolderView>;
  rename: (id: string, name: string) => Promise<FolderView>;
  /** Soft delete; resolves to how many designs were in it. `restore` undoes it within the service's window. */
  remove: (id: string) => Promise<number>;
  restore: (id: string) => Promise<FolderView>;
  add: (id: string, slugs: string[]) => Promise<FolderView>;
  removeDesigns: (id: string, slugs: string[]) => Promise<FolderView>;
};

export const FOLDERS_COULDNT_LOAD = 'Folders couldn’t load. Try again.';

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((slug) => b.includes(slug));

const createFoldersStore = (): FoldersStore => {
  let state: FoldersState = { status: 'idle', folders: [], damaged: false, error: null };
  const listeners = new Set<(state: FoldersState) => void>();
  let ticket = 0;

  const set = (next: FoldersState): void => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const load = async (): Promise<void> => {
    ticket += 1;
    const mine = ticket;
    set({ ...state, status: state.status === 'ready' ? 'ready' : 'loading', error: null });
    try {
      const answer = await client.call('GET /folders');
      if (mine !== ticket) return;
      if (answer.damaged) set({ status: 'error', folders: [], damaged: true, error: FOLDERS_COULDNT_LOAD });
      else set({ status: 'ready', folders: answer.folders, damaged: false, error: null });
    } catch (error) {
      if (mine !== ticket) return;
      console.warn('Design Chamber: folders failed to load', error);
      set({ status: 'error', folders: state.folders, damaged: false, error: FOLDERS_COULDNT_LOAD });
    }
  };

  const replaceOne = (folder: FolderView): void => {
    ticket += 1; // an older list answer must not undo this
    const known = state.folders.some((entry) => entry.id === folder.id);
    set({ ...state, status: 'ready', error: null, folders: known ? state.folders.map((entry) => (entry.id === folder.id ? folder : entry)) : [...state.folders, folder] });
  };

  /** Runs one mutation; on failure the list is re-read (so a half-applied view never lingers) and the sentence is rethrown. */
  const run = async <T>(request: () => Promise<T>): Promise<T> => {
    try {
      return await request();
    } catch (error) {
      void load();
      throw new Error(errorText(error));
    }
  };

  const change = (id: string, body: { add?: string[]; remove?: string[] }): Promise<FolderView> => {
    const before = state.folders.find((folder) => folder.id === id);
    if (before) {
      const slugs = [...before.slugs.filter((slug) => !(body.remove ?? []).includes(slug)), ...(body.add ?? []).filter((slug) => !before.slugs.includes(slug))];
      if (!sameSet(slugs, before.slugs)) replaceOne({ ...before, slugs });
    }
    return run(async () => {
      const { folder } = await client.call('POST /folders/:folderId/designs', { params: { folderId: id }, body });
      replaceOne(folder);
      return folder;
    });
  };

  // The feed says a folder changed, a design was removed (its membership goes), or the designs folder changed.
  const refresh = debounce(() => void load(), 150);
  feed.subscribe((batch) => {
    if (batch.reset || batch.events.some((event) => event.kind === 'folders' || event.kind === 'removed' || event.kind === 'root')) refresh();
  });

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    load,
    create: (name) =>
      run(async () => {
        const { folder } = await client.call('POST /folders', { body: { name } });
        replaceOne(folder);
        return folder;
      }),
    rename: (id, name) =>
      run(async () => {
        const { folder } = await client.call('PATCH /folders/:folderId', { params: { folderId: id }, body: { name } });
        replaceOne(folder);
        return folder;
      }),
    remove: (id) =>
      run(async () => {
        const { designs } = await client.call('DELETE /folders/:folderId', { params: { folderId: id } });
        ticket += 1;
        set({ ...state, folders: state.folders.filter((folder) => folder.id !== id) });
        return designs;
      }),
    restore: (id) =>
      run(async () => {
        const { folder } = await client.call('POST /folders/:folderId/undelete', { params: { folderId: id }, body: {} });
        replaceOne(folder);
        return folder;
      }),
    add: (id, slugs) => change(id, { add: slugs }),
    removeDesigns: (id, slugs) => change(id, { remove: slugs }),
  };
};

let shared: FoldersStore | null = null;

/** The frame's one folders store, created on first use (after `startGuest`). */
export const folders = (): FoldersStore => {
  if (shared === null) {
    shared = createFoldersStore();
    void shared.load();
  }
  return shared;
};
