// What the user can do with folders and project members from the list (Phase 2.5 G1, Phase 2.6 F2):
// the design menu's filing entries, the shared picker's Add to folder dialog, Move with one Undo,
// folder create, rename and delete (a confirm that names what stays, then Undo), and a design dropped
// onto a folder. Folders and project members are labels only; none of this touches a design's own
// folder on disk. Every failure keeps what the user typed and says what to do next.

import { mountTextField } from '@openchamber/sdk/ui';

import type { FolderView, MembershipTarget } from '../../shared/api.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import { store } from '../guest.ts';
import { createHoldableTimer } from '../model/holdable-timer.ts';
import { folderName } from '../model/format.ts';
import { keyOfTarget } from '../model/folder-picker-model.ts';
import { folderNameProblem, type FolderLite } from '../model/list-model.ts';
import { designMenu, runDesignAction, toast, type ActionContext, type DesignRef } from './actions.ts';
import { errorText, h } from './dom.ts';
import { mountFolderPicker, type PickerDesignRef } from './folder-picker.ts';
import { banner, btn, confirmDialog, openSheet, type MenuEntry } from './kit.ts';
import { folders } from './folders-store.ts';
import { icon } from './icons.ts';

export type FolderRef = { id: string; name: string };

/** The drag payload type of a design card; only our own rows accept it. */
export const DESIGN_DRAG_TYPE = 'application/x-design-chamber-design';

// ---------------------------------------------------------------- the design menu

/**
 * What the list is showing around a design: a folder, or a project this design is a manual member
 * of (`manual` false: it was made there, so it can't leave). L1a passes the whole view; the older
 * `FolderRef | null` argument still reads as a folder-only view.
 */
export type DesignMenuView = {
  folder: FolderRef | null;
  project: { directory: string; label: string; manual: boolean } | null;
};

const menuViewOf = (view: DesignMenuView | FolderRef | null): DesignMenuView => {
  if (view === null) return { folder: null, project: null };
  if ('folder' in view) return view;
  return { folder: view, project: null };
};

/** Add to folder… always; inside a folder or a manual project member's view, Move and Remove too. */
export const listDesignMenu = (view: DesignMenuView | FolderRef | null): MenuEntry[] => {
  const { folder, project } = menuViewOf(view);
  const base = designMenu({ includeOpen: true });
  const at = base.findIndex((entry) => 'id' in entry && entry.id === 'reveal');
  const extra: MenuEntry[] = [{ id: 'add-to-folder', label: 'Add to folder…' }];
  if (folder) {
    extra.push({ id: 'move-design', label: 'Move to folder…' }, { id: 'remove-from-folder', label: `Remove from ${folder.name}` });
  } else if (project?.manual) {
    extra.push({ id: 'move-design', label: 'Move to folder…' }, { id: 'remove-from-project', label: `Remove from ${project.label}` });
  }
  return [...base.slice(0, at), ...extra, ...base.slice(at)];
};

/** Runs a list menu choice: the filing entries here, everything else as before. */
export const runListAction = (id: string, design: DesignRef, context: ActionContext, view: DesignMenuView | FolderRef | null): void => {
  const { folder, project } = menuViewOf(view);
  if (id === 'add-to-folder') {
    openAddToFolder(context.host, design);
    return;
  }
  if (id === 'move-design') {
    const from = folder !== null ? { target: { kind: 'folder', id: folder.id } as MembershipTarget, label: folder.name } : project?.manual ? { target: { kind: 'project', directory: project.directory } as MembershipTarget, label: project.label } : null;
    if (from !== null) openMoveDesign(context.host, design, from);
    return;
  }
  if (id === 'remove-from-folder' && folder) {
    void removeFromFolder(folder, design);
    return;
  }
  if (id === 'remove-from-project' && project?.manual) {
    void removeFromProject(project, design);
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

/** Taking a design out of a project it was filed under by hand; its derived project never changes. */
export const removeFromProject = async (project: { directory: string; label: string }, design: Pick<DesignRef, 'slug' | 'title'>): Promise<void> => {
  try {
    await folders().apply([{ target: { kind: 'project', directory: project.directory }, remove: [design.slug] }]);
    toast('info', `Removed “${design.title}” from ${project.label}. It is still in All designs.`);
  } catch (error) {
    toast('error', `Couldn’t remove it from ${project.label}. ${errorText(error)}`);
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

/** The design's project folder as the list knows it (the picker locks that row). */
const pickerRefOf = (design: Pick<DesignRef, 'slug' | 'title'>): PickerDesignRef => ({
  slug: design.slug,
  title: design.title,
  projectDirectory: store.getState().designs.data?.designs.find((entry) => entry.slug === design.slug)?.projectDirectory ?? null,
});

// ---------------------------------------------------------------- Add to folder

export const openAddToFolder = (hostEl: HTMLElement, design: Pick<DesignRef, 'slug' | 'title'>): void => {
  const pickerHost = h('div');
  const sheet = openSheet(hostEl, { title: 'Add to folder', subtitle: design.title, variant: 'dialog', onClose: () => picker.dispose() });
  const note = h('p', { class: 'dc-pick-note-line' }, icon('info', 14), h('span', null, 'Projects and folders both group this design. Tick as many as you like. Each tick saves at once.'));
  sheet.body.append(note, pickerHost);
  const picker = mountFolderPicker(pickerHost, { mode: 'multi', apply: 'immediate', design: pickerRefOf(design), derivedProject: null });
  sheet.foot.append(btn({ label: 'Done', variant: 'default', emphasis: 'primary', onClick: () => sheet.close() }).el);
};

// ---------------------------------------------------------------- Move (one action, one Undo)

export type MoveFrom = { target: MembershipTarget; label: string };

/**
 * Move out of the folder or manual project being viewed: one atomic batch (untag here, tag there),
 * then an Undo notice that applies the inverse. A refusal says its sentence in the dialog and
 * changes nothing; a target that already holds the design says so and sends nothing.
 */
export const openMoveDesign = (hostEl: HTMLElement, design: Pick<DesignRef, 'slug' | 'title'>, from: MoveFrom): void => {
  const folderStore = folders();
  const ref = pickerRefOf(design);
  let busy = false;
  const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  const pickerHost = h('div');
  const sheet = openSheet(hostEl, { title: `Move ${design.title} out of ${from.label}`, subtitle: 'Into which folder?', variant: 'dialog', onClose: () => picker.dispose() });
  sheet.body.append(pickerHost, failure);

  const labelOf = (target: MembershipTarget): string =>
    target.kind === 'folder' ? folderStore.get().folders.find((entry) => entry.id === target.id)?.name ?? 'that folder' : folderName(target.directory);

  const pick = async (target: MembershipTarget): Promise<void> => {
    if (busy) return;
    const state = folderStore.get();
    const holds =
      target.kind === 'folder'
        ? state.folders.find((entry) => entry.id === target.id)?.slugs.includes(design.slug) ?? false
        : (state.projects.find((entry) => sameDirectory(entry.directory, target.directory))?.slugs.includes(design.slug) ?? false) ||
          (ref.projectDirectory !== null && sameDirectory(ref.projectDirectory, target.directory));
    const label = labelOf(target);
    if (holds) {
      toast('info', `“${design.title}” is already in ${label}.`);
      return;
    }
    busy = true;
    failure.hidden = true;
    try {
      await folderStore.apply([{ target: from.target, remove: [design.slug] }, { target, add: [design.slug] }], { atomic: true });
      sheet.close();
      const undo = async (): Promise<void> => {
        try {
          await folderStore.apply([{ target, remove: [design.slug] }, { target: from.target, add: [design.slug] }], { atomic: true });
        } catch (error) {
          toast('error', `Couldn’t undo the move. ${errorText(error)}`);
        }
      };
      if (frameNotice !== null) frameNotice.show({ title: `Moved ${design.title} to ${label}.`, onUndo: undo });
      else toast('success', `Moved ${design.title} to ${label}.`);
    } catch (error) {
      failure.textContent = errorText(error);
      failure.hidden = false;
    } finally {
      busy = false;
    }
  };

  const picker = mountFolderPicker(pickerHost, { mode: 'single', apply: 'immediate', design: ref, derivedProject: null, exclude: keyOfTarget(from.target), onPick: (target) => void pick(target) });
  sheet.foot.append(h('p', { class: 'dc-move-note dc-muted' }, 'Picking a folder moves it at once.'), btn({ label: 'Cancel', variant: 'outline', onClick: () => sheet.close() }).el);
};

// ---------------------------------------------------------------- create and rename

/** New folder from a menu: a name field, Create folder, Cancel. The same rules as the sidebar's field. */
export const openNewFolder = (hostEl: HTMLElement): void => {
  const folderStore = folders();
  const sheet = openSheet(hostEl, { title: 'New folder', variant: 'dialog' });
  let value = '';
  const field = mountTextField(sheet.body, { label: 'Folder name', value, placeholder: 'Q4 launch', onChange: (next) => void (value = next) });
  const submit = btn({ label: 'Create folder', variant: 'default', emphasis: 'primary', onClick: () => void create() });
  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });
  const create = async (): Promise<void> => {
    const problem = folderNameProblem(value, folderStore.get().folders);
    if (problem !== null) {
      field.update({ error: problem });
      return;
    }
    submit.set({ loading: true });
    cancel.set({ disabled: true });
    try {
      const folder = await folderStore.create(value.trim());
      sheet.close();
      toast('success', `Made folder ${folder.name}.`);
    } catch (error) {
      field.update({ error: errorText(error) });
      submit.set({ loading: false });
      cancel.set({ disabled: false });
    }
  };
  sheet.body.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      void create();
    }
  });
  sheet.foot.append(cancel.el, submit.el);
  queueMicrotask(() => sheet.body.querySelector('input')?.focus());
};

/** Rename in a small dialog: validated before the request, the text kept when the save fails. */
export const openRenameFolder = (hostEl: HTMLElement, folder: FolderRef): void => {
  const folderStore = folders();
  const sheet = openSheet(hostEl, { title: 'Rename folder', variant: 'dialog' });
  let value = folder.name;
  const field = mountTextField(sheet.body, { label: 'Name', value, onChange: (next) => void (value = next) });
  const submit = btn({ label: 'Save name', variant: 'default', emphasis: 'primary', onClick: () => void save() });
  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });
  const save = async (): Promise<void> => {
    const problem = folderNameProblem(value, folderStore.get().folders, folder.id);
    if (problem !== null) {
      field.update({ error: problem });
      return;
    }
    submit.set({ loading: true });
    cancel.set({ disabled: true });
    try {
      await folderStore.rename(folder.id, value.trim());
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

// ---------------------------------------------------------------- delete: a confirm that names what stays, then Undo

const UNDO_MS = 10_000;

export type UndoNoticeHandle = {
  el: HTMLElement;
  show: (options: { title: string; body?: string; undoLabel?: string; onUndo: () => Promise<void> }) => void;
  clear: () => void;
  dispose: () => void;
};

/** The frame's one Undo notice (the rail's or the page's), so Move can offer its Undo without a handle passed in. */
let frameNotice: UndoNoticeHandle | null = null;

/** A live region holding one "<what happened>" notice with Undo for 10 seconds (the clock stops on hover and focus). */
export const mountUndoNotice = (): UndoNoticeHandle => {
  const el = h('div', { class: 'dc-undo-notice', 'aria-live': 'polite' });
  let timer: ReturnType<typeof createHoldableTimer> | null = null;
  const clear = (): void => {
    timer?.cancel();
    timer = null;
    el.replaceChildren();
  };
  const handle: UndoNoticeHandle = {
    el,
    clear,
    dispose: () => {
      if (frameNotice === handle) frameNotice = null;
      clear();
    },
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
  frameNotice = handle;
  return handle;
};

/** What a delete would do, from the store at open time: its live members, and how many are in no other folder. */
export const deleteFacts = (folderId: string, folders: readonly FolderLite[]): { count: number; onlyHere: number } => {
  const slugs = folders.find((folder) => folder.id === folderId)?.slugs ?? [];
  const elsewhere = new Set(folders.filter((folder) => folder.id !== folderId).flatMap((folder) => folder.slugs));
  return { count: slugs.length, onlyHere: slugs.filter((slug) => !elsewhere.has(slug)).length };
};

export type DeleteCopy = { parts: Array<{ text: string; strong?: boolean }>; promise: string | null };

const DELETE_PROMISE = 'Deleting a folder never deletes designs.';

/** The confirm's sentence: the counts that matter, and the promise that designs stay. The notice after uses the answer's own numbers. */
export const deleteConfirmCopy = (input: { name: string; count: number; onlyHere: number }): DeleteCopy => {
  const { name, count, onlyHere } = input;
  if (count === 0) return { parts: [{ text: `${name} is empty. Deleting it changes nothing.` }], promise: null };
  if (onlyHere === 0) {
    return { parts: [{ text: count === 1 ? 'Its 1 design keeps its other folders.' : `Its ${count} designs all keep their other folders.` }], promise: DELETE_PROMISE };
  }
  const parts: DeleteCopy['parts'] =
    count === 1 ? [{ text: '1 design', strong: true }, { text: ` is in ${name}. ` }] : [{ text: `${count} designs`, strong: true }, { text: ` are in ${name}. ` }];
  if (onlyHere === 1) parts.push({ text: '1 of them', strong: true }, { text: ' is in no other folder; it stays in All designs.' });
  else parts.push({ text: `${onlyHere} of them`, strong: true }, { text: ' are in no other folder; they stay in All designs.' });
  return { parts, promise: DELETE_PROMISE };
};

/** Deletes a folder behind a confirm that names what stays, then offers Undo. The designs are never touched. */
export const deleteFolder = (folder: FolderRef, notice: UndoNoticeHandle): void => {
  const folderStore = folders();
  const copy = deleteConfirmCopy({ name: folder.name, ...deleteFacts(folder.id, folderStore.get().folders) });
  const host = notice.el.closest<HTMLElement>('.dc-app') ?? document.body;
  confirmDialog(host, {
    title: `Delete ${folder.name}?`,
    body: h(
      'div',
      { class: 'dc-delete-facts' },
      h('p', null, ...copy.parts.map((part) => (part.strong ? h('strong', null, part.text) : part.text))),
      copy.promise === null ? null : h('p', { class: 'dc-delete-promise' }, icon('info', 14), h('span', null, copy.promise)),
    ),
    confirmLabel: 'Delete folder',
    destructive: true,
    onConfirm: async () => {
      // A refusal throws its sentence and the confirm stays open (confirmDialog).
      const { designs } = await folderStore.remove(folder.id);
      notice.show({
        title: `Deleted ${folder.name}.`,
        body: designs === 0 ? 'It was empty.' : `Its ${designs === 1 ? 'design is' : `${designs} designs are`} still in All designs.`,
        onUndo: async () => {
          try {
            const back = await folderStore.restore(folder.id);
            toast('success', `Brought back ${back.name}.`);
          } catch (error) {
            toast('error', `Couldn’t bring ${folder.name} back. ${errorText(error)}`);
          }
        },
      });
    },
  });
};
