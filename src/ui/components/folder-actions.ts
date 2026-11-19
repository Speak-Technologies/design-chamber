// What the user can do with folders from the list (Phase 2.5 G1): the design menu's two extra entries,
// the "Add to folder" dialog, folder rename, delete with Undo, and a design dropped onto a folder.
// Folders are labels only; none of this touches a design's own folder on disk. Every failure keeps what the
// user typed and says what to do next.

import { mountCheckbox, mountTextField, type CheckboxHandle, type TextFieldHandle } from '@openchamber/sdk/ui';

import type { FolderView } from '../../shared/api.ts';
import { createHoldableTimer } from '../model/holdable-timer.ts';
import { plural } from '../model/format.ts';
import { folderNameProblem } from '../model/list-model.ts';
import { designMenu, runDesignAction, toast, type ActionContext, type DesignRef } from './actions.ts';
import { createScope, errorText, h } from './dom.ts';
import { banner, btn, openSheet, type MenuEntry } from './kit.ts';
import { folders, FOLDERS_COULDNT_LOAD } from './folders-store.ts';

export type FolderRef = { id: string; name: string };

/** The drag payload type of a design card; only our own rows accept it. */
export const DESIGN_DRAG_TYPE = 'application/x-design-chamber-design';

// ---------------------------------------------------------------- the design menu

/** The design menu with Add to folder… and, in a folder view, Remove from <folder>. */
export const listDesignMenu = (inFolder: FolderRef | null): MenuEntry[] => {
  const base = designMenu({ includeOpen: true });
  const at = base.findIndex((entry) => 'id' in entry && entry.id === 'reveal');
  const extra: MenuEntry[] = [{ id: 'add-to-folder', label: 'Add to folder…' }, ...(inFolder ? ([{ id: 'remove-from-folder', label: `Remove from ${inFolder.name}` }] satisfies MenuEntry[]) : [])];
  return [...base.slice(0, at), ...extra, ...base.slice(at)];
};

/** Runs a list menu choice: the folder entries here, everything else as before. */
export const runListAction = (id: string, design: DesignRef, context: ActionContext, inFolder: FolderRef | null): void => {
  if (id === 'add-to-folder') {
    openAddToFolder(context.host, design);
    return;
  }
  if (id === 'remove-from-folder' && inFolder) {
    void removeFromFolder(inFolder, design);
    return;
  }
  runDesignAction(id, design, context);
};

export const removeFromFolder = async (folder: FolderRef, design: Pick<DesignRef, 'slug' | 'title'>): Promise<void> => {
  try {
    await folders().removeDesigns(folder.id, [design.slug]);
    toast('info', `Removed “${design.title}” from ${folder.name}. It is still in All designs.`);
  } catch (error) {
    toast('error', `Couldn’t remove it from ${folder.name}. ${errorText(error)}`);
  }
};

/** A card or row dropped on a folder (or "Add to folder" without a dialog). Says what happened either way. */
export const addToFolder = async (folder: FolderView | FolderRef, design: Pick<DesignRef, 'slug' | 'title'>): Promise<void> => {
  const current = folders().get().folders.find((entry) => entry.id === folder.id);
  if (current?.slugs.includes(design.slug)) {
    toast('info', `“${design.title}” is already in ${folder.name}.`);
    return;
  }
  try {
    await folders().add(folder.id, [design.slug]);
    toast('success', `Added “${design.title}” to ${folder.name}.`);
  } catch (error) {
    toast('error', `Couldn’t add it to ${folder.name}. ${errorText(error)}`);
  }
};

// ---------------------------------------------------------------- Add to folder

const SKELETON_ROWS = 3;

export const openAddToFolder = (hostEl: HTMLElement, design: Pick<DesignRef, 'slug' | 'title'>): void => {
  const store = folders();
  const scope = createScope();
  const sheet = openSheet(hostEl, { title: 'Add to folder', subtitle: design.title, variant: 'dialog', onClose: () => scope.dispose() });

  const list = h('ul', { class: 'dc-folder-pick', role: 'list', 'aria-label': 'Folders' });
  const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  const createBox = h('div', { class: 'dc-folder-new' });
  const body = sheet.body;
  body.append(list, failure, createBox);

  const checks = new Map<string, CheckboxHandle>();
  let builtFor = '';
  let createField: TextFieldHandle | null = null;
  let creating = false;

  const showFailure = (message: string | null): void => {
    failure.hidden = message === null;
    failure.textContent = message ?? '';
  };

  const toggle = async (folder: FolderView, checked: boolean): Promise<void> => {
    showFailure(null);
    const handle = checks.get(folder.id);
    handle?.update({ disabled: true });
    try {
      if (checked) await store.add(folder.id, [design.slug]);
      else await store.removeDesigns(folder.id, [design.slug]);
    } catch (error) {
      handle?.update({ checked: !checked });
      showFailure(`Couldn’t ${checked ? 'add it to' : 'remove it from'} ${folder.name}. ${errorText(error)}`);
    } finally {
      handle?.update({ disabled: false });
    }
  };

  const paintList = (): void => {
    const state = store.get();
    if ((state.status === 'idle' || state.status === 'loading') && state.folders.length === 0) {
      builtFor = '';
      checks.clear();
      list.replaceChildren(...Array.from({ length: SKELETON_ROWS }, () => h('li', { class: 'dc-folder-pick-skeleton', 'aria-hidden': 'true' }, h('span', { class: 'dc-skel dc-skel-line' }))));
      return;
    }
    if (state.status === 'error') {
      builtFor = '';
      checks.clear();
      const retry = btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => void store.load() });
      list.replaceChildren(h('li', { class: 'dc-folder-pick-message' }, h('p', { class: 'dc-form-error' }, state.error ?? FOLDERS_COULDNT_LOAD), retry.el));
      return;
    }
    if (state.folders.length === 0) {
      builtFor = '';
      checks.clear();
      list.replaceChildren(h('li', { class: 'dc-folder-pick-message' }, h('p', { class: 'dc-muted' }, 'No folders yet. Name one below and this design goes in it.')));
      return;
    }
    const signature = state.folders.map((folder) => `${folder.id}:${folder.name}`).join('|');
    if (signature !== builtFor) {
      builtFor = signature;
      checks.clear();
      list.replaceChildren(
        ...state.folders.map((folder) => {
          const holder = h('li', { class: 'dc-folder-pick-row' });
          const handle = mountCheckbox(holder, { label: folder.name, checked: folder.slugs.includes(design.slug), description: plural(folder.slugs.length, 'design'), onChange: (checked) => void toggle(folder, checked) });
          checks.set(folder.id, handle);
          return holder;
        }),
      );
      return;
    }
    for (const folder of state.folders) checks.get(folder.id)?.update({ checked: folder.slugs.includes(design.slug), description: plural(folder.slugs.length, 'design') });
  };

  const paintCreate = (): void => {
    const state = store.get();
    const noFolders = state.status === 'ready' && state.folders.length === 0;
    if (createField !== null) return;
    if (state.status === 'error') {
      createBox.replaceChildren();
      return;
    }
    if (noFolders) {
      mountField();
      return;
    }
    if (createBox.firstElementChild === null) {
      const open = btn({ label: 'New folder…', variant: 'ghost', size: 'sm', icon: 'plus', onClick: () => mountField(true) });
      createBox.replaceChildren(open.el);
    }
  };

  const mountField = (focus = false): void => {
    createBox.replaceChildren();
    const holder = h('div', { class: 'dc-folder-new-field' });
    let value = '';
    const field = mountTextField(holder, { label: 'Folder name', value, placeholder: 'Q4 launch', onChange: (next) => void (value = next) });
    createField = field;
    const input = holder.querySelector('input');
    const create = btn({ label: 'Create and add', variant: 'default', size: 'sm', onClick: () => void submit() });
    const submit = async (): Promise<void> => {
      if (creating) return;
      const problem = folderNameProblem(value, store.get().folders);
      if (problem !== null) {
        field.update({ error: problem });
        return;
      }
      creating = true;
      create.set({ loading: true });
      showFailure(null);
      try {
        const folder = await store.create(value.trim());
        await store.add(folder.id, [design.slug]);
        createField = null;
        createBox.replaceChildren();
        paintList();
        paintCreate();
        toast('success', `Added “${design.title}” to ${folder.name}.`);
      } catch (error) {
        field.update({ error: errorText(error) });
      } finally {
        creating = false;
        create.set({ loading: false });
      }
    };
    input?.addEventListener('blur', () => {
      if (value.trim() !== '') field.update({ error: folderNameProblem(value, store.get().folders) ?? undefined });
    });
    holder.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        void submit();
      }
    });
    createBox.append(holder, h('div', { class: 'dc-folder-new-actions' }, create.el));
    if (focus) queueMicrotask(() => input?.focus());
  };

  const done = btn({ label: 'Done', variant: 'default', emphasis: 'primary', onClick: () => sheet.close() });
  sheet.foot.append(done.el);

  scope.add(
    store.subscribe(() => {
      paintList();
      paintCreate();
    }),
  );
  void store.load();
  paintList();
  paintCreate();
};

// ---------------------------------------------------------------- rename

/** Rename in a small dialog: validated before the request, the text kept when the save fails. */
export const openRenameFolder = (hostEl: HTMLElement, folder: FolderRef): void => {
  const store = folders();
  const sheet = openSheet(hostEl, { title: 'Rename folder', variant: 'dialog' });
  let value = folder.name;
  const field = mountTextField(sheet.body, { label: 'Name', value, onChange: (next) => void (value = next) });
  const submit = btn({ label: 'Save name', variant: 'default', emphasis: 'primary', onClick: () => void save() });
  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });
  const save = async (): Promise<void> => {
    const problem = folderNameProblem(value, store.get().folders, folder.id);
    if (problem !== null) {
      field.update({ error: problem });
      return;
    }
    submit.set({ loading: true });
    cancel.set({ disabled: true });
    try {
      await store.rename(folder.id, value.trim());
      sheet.close();
    } catch (error) {
      field.update({ error: errorText(error) });
      submit.set({ loading: false });
      cancel.set({ disabled: false });
    }
  };
  sheet.body.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      void save();
    }
  });
  sheet.foot.append(cancel.el, submit.el);
  queueMicrotask(() => sheet.body.querySelector('input')?.select());
};

// ---------------------------------------------------------------- delete with Undo

const UNDO_MS = 10_000;

export type UndoNoticeHandle = {
  el: HTMLElement;
  show: (options: { title: string; body?: string; undoLabel?: string; onUndo: () => Promise<void> }) => void;
  clear: () => void;
  dispose: () => void;
};

/** A live region holding one "<what happened>" notice with Undo for 10 seconds (the clock stops on hover and focus). */
export const mountUndoNotice = (): UndoNoticeHandle => {
  const el = h('div', { class: 'dc-undo-notice', 'aria-live': 'polite' });
  let timer: ReturnType<typeof createHoldableTimer> | null = null;
  const clear = (): void => {
    timer?.cancel();
    timer = null;
    el.replaceChildren();
  };
  return {
    el,
    clear,
    dispose: clear,
    show: ({ title, body, undoLabel = 'Undo', onUndo }) => {
      timer?.cancel();
      let busy = false;
      const node = banner({
        tone: 'info',
        title,
        body,
        action: {
          label: undoLabel,
          onClick: () => {
            if (busy) return;
            busy = true;
            clear();
            void onUndo();
          },
        },
      });
      el.replaceChildren(node);
      const own = createHoldableTimer(UNDO_MS, clear);
      timer = own;
      node.addEventListener('pointerenter', () => own.setHeld('hover', true));
      node.addEventListener('pointerleave', () => own.setHeld('hover', false));
      node.addEventListener('focusin', () => own.setHeld('focus', true));
      node.addEventListener('focusout', () => own.setHeld('focus', false));
      own.start();
    },
  };
};

/** Deletes a folder with no confirm (the designs stay) and offers Undo. Resolves true when it went through. */
export const deleteFolder = async (folder: FolderRef, notice: UndoNoticeHandle): Promise<boolean> => {
  const store = folders();
  let count: number;
  try {
    count = await store.remove(folder.id);
  } catch (error) {
    toast('error', `Couldn’t delete ${folder.name}. ${errorText(error)}`);
    return false;
  }
  notice.show({
    title: `Deleted folder ${folder.name}.`,
    body: count === 0 ? 'It was empty.' : `Its ${count === 1 ? 'design is' : `${count} designs are`} still in All designs.`,
    onUndo: async () => {
      try {
        const back = await store.restore(folder.id);
        toast('success', `Brought back ${back.name}.`);
      } catch (error) {
        toast('error', `Couldn’t bring ${folder.name} back. ${errorText(error)}`);
      }
    },
  });
  return true;
};
