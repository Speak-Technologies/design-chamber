// The page library's left sidebar (Phase 2.5 G1): All designs, Projects, No project and the user's Folders.
// One row is selected and filters the grid. Folder rows are drop targets for a dragged card, rename inline,
// and open a menu with Rename and Delete folder (no confirm: the designs stay, and a notice offers Undo).
// Everything it draws comes in through `paint`; it never reads the store itself.

import type { FolderView } from '../../shared/api.ts';
import { DESIGN_DRAG_TYPE } from '../components/folder-actions.ts';
import { h } from '../components/dom.ts';
import { icon, type IconName } from '../components/icons.ts';
import { attachMenu, btn, iconBtn } from '../components/kit.ts';
import { sameScope, scopeToId, type ListScope, type ProjectGroup, type ScopeCounts } from '../model/list-model.ts';

export type SidebarModel = {
  scope: ListScope;
  counts: ScopeCounts;
  groups: readonly ProjectGroup[];
  folders: readonly FolderView[];
  foldersStatus: 'loading' | 'ready' | 'error';
  foldersError: string | null;
};

export type SidebarOptions = {
  onSelect: (scope: ListScope) => void;
  onDrop: (folder: FolderView, slug: string) => void;
  onRetryFolders: () => void;
  /** Resolves when the folder exists; throws the sentence to show next to the field. */
  onCreate: (name: string) => Promise<void>;
  onRename: (folder: FolderView, name: string) => Promise<void>;
  onDelete: (folder: FolderView) => void;
  /** The first problem with a name, or null. `ignoreId` is the folder being renamed. */
  validate: (name: string, ignoreId: string | null) => string | null;
};

export type SidebarHandle = { el: HTMLElement; paint: (model: SidebarModel) => void; focusSelected: () => void; dispose: () => void };

const FOLDER_SKELETONS = 2;

export const mountSidebar = (options: SidebarOptions): SidebarHandle => {
  let model: SidebarModel | null = null;
  let renaming: { id: string; draft: string; error: string | null; busy: boolean } | null = null;

  const el = h('nav', { class: 'dc-side', 'aria-label': 'Projects and folders' });
  const lists = h('div', { class: 'dc-side-body' });
  el.append(lists);

  // ---- the create row: long-lived, so a repaint while typing never loses the text or the focus ----
  const createSlot = h('div', { class: 'dc-side-create-slot', hidden: true });
  let createDraft = '';
  let creating = false;
  /** A repaint re-attaches the create row, which blurs it; that blur is not the user leaving the field. */
  let painting = false;
  const createInput = h('input', { class: 'oc-sdk oc-sdk-input dc-side-input', type: 'text', 'aria-label': 'New folder name', autocomplete: 'off', spellcheck: 'false', placeholder: 'Folder name' });
  const createError = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  const createForm = h('form', { class: 'dc-side-create', novalidate: true }, createInput, createError);
  createSlot.append(createForm);
  let newFolderButton: HTMLButtonElement | null = null;

  const showCreateError = (message: string | null): void => {
    createError.hidden = message === null;
    createError.textContent = message ?? '';
    createInput.setAttribute('aria-invalid', message === null ? 'false' : 'true');
  };
  const closeCreate = (focusButton: boolean): void => {
    createDraft = '';
    createInput.value = '';
    showCreateError(null);
    createSlot.hidden = true;
    newFolderButton?.setAttribute('aria-expanded', 'false');
    if (focusButton) newFolderButton?.focus();
  };
  const openCreate = (): void => {
    createSlot.hidden = false;
    newFolderButton?.setAttribute('aria-expanded', 'true');
    createInput.focus();
  };
  createInput.addEventListener('input', () => {
    createDraft = createInput.value;
    if (createError.hidden === false) showCreateError(null);
  });
  createInput.addEventListener('blur', () => {
    if (creating || painting) return;
    if (createDraft.trim() === '') closeCreate(false);
    else showCreateError(options.validate(createDraft, null));
  });
  createInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeCreate(true);
    }
  });
  const submitCreate = (): void => {
    void (async () => {
      if (creating) return;
      const problem = options.validate(createDraft, null);
      if (problem !== null) {
        showCreateError(problem);
        return;
      }
      creating = true;
      createInput.disabled = true;
      try {
        await options.onCreate(createDraft.trim());
        closeCreate(true);
      } catch (error) {
        showCreateError(error instanceof Error ? error.message : 'Couldn’t make the folder. Try again.');
      } finally {
        creating = false;
        createInput.disabled = false;
        if (!createSlot.hidden) createInput.focus();
      }
    })();
  };
  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCreate();
  });
  createInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitCreate();
    }
  });

  // ---- rows ----

  const rowFor = (config: { scope: ListScope; label: string; count: number; glyph: IconName; title?: string; missing?: boolean; selected: boolean }): HTMLLIElement => {
    const main = h(
      'button',
      { type: 'button', class: 'dc-side-main', 'aria-current': config.selected ? 'true' : null, title: config.title, 'aria-label': `${config.label}, ${config.count}${config.missing ? ', folder not found' : ''}` },
      icon(config.glyph, 14),
      h('span', { class: 'dc-side-label' }, config.label),
      config.missing ? h('span', { class: 'dc-side-warn', 'aria-hidden': 'true' }, icon('alert', 12)) : null,
      h('span', { class: 'dc-side-count', 'aria-hidden': 'true' }, String(config.count)),
    );
    main.addEventListener('click', () => options.onSelect(config.scope));
    return h('li', { class: 'dc-side-row', 'data-scope': scopeToId(config.scope), 'data-selected': config.selected ? 'true' : 'false' }, main);
  };

  const heading = (text: string, ...trailing: Array<HTMLElement | null>): HTMLElement =>
    h('div', { class: 'dc-side-heading' }, h('h2', { class: 'dc-side-title' }, text), ...trailing);

  const folderRow = (folder: FolderView, current: SidebarModel): HTMLLIElement => {
    const selected = sameScope(current.scope, { kind: 'folder', id: folder.id });
    const count = current.counts.folders[folder.id] ?? 0;
    if (renaming?.id === folder.id) return renameRow(folder);
    const row = rowFor({ scope: { kind: 'folder', id: folder.id }, label: folder.name, count, glyph: 'folder', title: folder.name, selected });
    const more = iconBtn({ icon: 'more', label: `Actions for folder ${folder.name}`, size: 'sm', onClick: () => undefined });
    attachMenu(
      more,
      () => [
        { id: 'rename', label: 'Rename' },
        { separator: true },
        { id: 'delete', label: 'Delete folder', destructive: true },
      ],
      (id) => {
        if (id === 'rename') {
          renaming = { id: folder.id, draft: folder.name, error: null, busy: false };
          paint(current, true);
        } else options.onDelete(folder);
      },
    );
    row.append(more);
    // A dragged card dropped here joins the folder (the same as Add to folder in its menu).
    const accepts = (event: DragEvent): boolean => event.dataTransfer?.types.includes(DESIGN_DRAG_TYPE) === true;
    row.addEventListener('dragenter', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      row.dataset.drop = 'over';
    });
    row.addEventListener('dragover', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      row.dataset.drop = 'over';
    });
    row.addEventListener('dragleave', (event) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      delete row.dataset.drop;
    });
    row.addEventListener('drop', (event) => {
      delete row.dataset.drop;
      if (!accepts(event)) return;
      event.preventDefault();
      const slug = event.dataTransfer?.getData(DESIGN_DRAG_TYPE) ?? '';
      if (slug !== '') options.onDrop(folder, slug);
    });
    return row;
  };

  const renameRow = (folder: FolderView): HTMLLIElement => {
    const state = renaming;
    const input = h('input', { class: 'oc-sdk oc-sdk-input dc-side-input', type: 'text', 'aria-label': `New name for ${folder.name}`, value: state?.draft ?? folder.name, autocomplete: 'off', spellcheck: 'false', disabled: state?.busy ? true : null });
    input.value = state?.draft ?? folder.name;
    const error = h('p', { class: 'dc-form-error', role: 'alert', hidden: state?.error ? null : true }, state?.error ?? '');
    const form = h('form', { class: 'dc-side-create', novalidate: true }, input, error);
    const stop = (): void => {
      renaming = null;
      if (model) paint(model, false);
      lists.querySelector<HTMLElement>(`[data-scope="folder:${folder.id}"] .dc-side-main`)?.focus();
    };
    input.addEventListener('input', () => {
      if (renaming) renaming.draft = input.value;
      error.hidden = true;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        stop();
      }
    });
    const submit = (): void => {
      void (async () => {
        const mine = renaming;
        if (mine === null || mine.busy) return;
        const problem = options.validate(input.value, folder.id);
        if (problem !== null) {
          mine.error = problem;
          error.hidden = false;
          error.textContent = problem;
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        mine.busy = true;
        input.disabled = true;
        try {
          await options.onRename(folder, input.value.trim());
          stop();
        } catch (failure) {
          mine.busy = false;
          mine.error = failure instanceof Error ? failure.message : 'Couldn’t rename the folder. Try again.';
          input.disabled = false;
          error.hidden = false;
          error.textContent = mine.error;
          input.focus();
        }
      })();
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    return h('li', { class: 'dc-side-row dc-side-row-edit', 'data-scope': `folder:${folder.id}` }, form);
  };

  // ---- paint ----

  const paint = (next: SidebarModel, keepFocus = false): void => {
    model = next;
    const hadCreateFocus = document.activeElement === createInput;
    const focusedScope = keepFocus ? null : (document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.dc-side-row')?.dataset.scope ?? null : null);
    const { scope, counts, groups, folders: list } = next;
    const projectRows = groups.map((group) =>
      rowFor({ scope: { kind: 'project', directory: group.directory }, label: group.label, count: group.count, glyph: 'layers', title: group.missing ? `${group.title}\nFolder not found` : group.title, missing: group.missing, selected: sameScope(scope, { kind: 'project', directory: group.directory }) }),
    );
    if (counts.noProject > 0) projectRows.push(rowFor({ scope: { kind: 'no-project' }, label: 'No project', count: counts.noProject, glyph: 'page', selected: scope.kind === 'no-project' }));

    newFolderButton = btn({ label: 'New folder', variant: 'ghost', size: 'xs', icon: 'plus', onClick: () => (createSlot.hidden ? openCreate() : closeCreate(true)) }).el;
    newFolderButton.setAttribute('aria-expanded', createSlot.hidden ? 'false' : 'true');

    const folderBody: HTMLElement[] = [];
    if (next.foldersStatus === 'loading' && list.length === 0) {
      folderBody.push(h('ul', { class: 'dc-side-list', 'aria-hidden': 'true' }, ...Array.from({ length: FOLDER_SKELETONS }, () => h('li', { class: 'dc-side-skeleton' }, h('span', { class: 'dc-skel dc-skel-line' })))));
    } else if (next.foldersStatus === 'error') {
      folderBody.push(
        h(
          'div',
          { class: 'dc-side-note' },
          h('p', { class: 'dc-form-error' }, next.foldersError ?? 'Folders couldn’t load. Try again.'),
          btn({ label: 'Try again', variant: 'outline', size: 'xs', onClick: options.onRetryFolders }).el,
        ),
      );
    }
    if (next.foldersStatus !== 'error' && list.length > 0) folderBody.push(h('ul', { class: 'dc-side-list', role: 'list', 'aria-label': 'Folders' }, ...list.map((folder) => folderRow(folder, next))));
    if (next.foldersStatus === 'ready' && list.length === 0) folderBody.push(h('p', { class: 'dc-side-hint' }, 'No folders yet. Make one to group designs your own way.'));

    painting = true;
    lists.replaceChildren(
      h('ul', { class: 'dc-side-list', role: 'list' }, rowFor({ scope: { kind: 'all' }, label: 'All designs', count: counts.all, glyph: 'canvas', selected: scope.kind === 'all' })),
      ...(projectRows.length > 0 ? [heading('Projects'), h('ul', { class: 'dc-side-list', role: 'list', 'aria-label': 'Projects' }, ...projectRows)] : []),
      heading('Folders', newFolderButton),
      createSlot,
      ...folderBody,
    );
    painting = false;
    if (hadCreateFocus && !createSlot.hidden) createInput.focus();
    else if (focusedScope !== null) lists.querySelector<HTMLElement>(`[data-scope="${CSS.escape(focusedScope)}"] .dc-side-main`)?.focus();
    else if (keepFocus) lists.querySelector<HTMLInputElement>('.dc-side-row-edit input')?.focus();
  };

  return {
    el,
    paint: (next) => paint(next),
    focusSelected: () => lists.querySelector<HTMLElement>('.dc-side-row[data-selected="true"] .dc-side-main')?.focus(),
    dispose: () => el.remove(),
  };
};
