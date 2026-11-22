// The shared folder picker (Phase 2.6 F2, technical design §6.1): one component behind the Add to
// folder dialog, the New dialog's Folder or project field, and Move. Projects list first (the
// approved canvas), then folders, then an inline New folder… field. Host tokens and kit controls
// only; names and paths are text, never markup. A locked row (the project a design was made for)
// says why and never writes.

import { mountCheckbox, mountSearchField, mountTextField, type CheckboxHandle, type SearchFieldHandle, type TextFieldHandle } from '@openchamber/sdk/ui';

import type { MembershipTarget } from '../../shared/api.ts';
import type { DesignSummary } from '../../shared/types.ts';
import { guestHost, store } from '../guest.ts';
import { filterRows, keyOfTarget, pickerTargets, showSearch, targetOfKey, type PickRow, type TargetKey } from '../model/folder-picker-model.ts';
import { folderNameProblem, type ProjectInfo } from '../model/list-model.ts';
import { createScope, errorText, h } from './dom.ts';
import { banner, btn, type BtnHandle } from './kit.ts';
import { folders, type FoldersState } from './folders-store.ts';
import { icon } from './icons.ts';

// icons.ts belongs to the library task (L1a); the picker's two extra glyphs live here until they
// move into ICONS. Same 24×24 stroke vocabulary as that file.
const GLYPHS = {
  lock: ['M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 8h.01'],
} as const;

export const pickGlyph = (name: keyof typeof GLYPHS, size = 14): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('dc-icon');
  for (const d of GLYPHS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
};

export type PickerDesignRef = { slug: string; title: string; projectDirectory: string | null };

export type FolderPickerOptions = {
  mode: 'multi' | 'single';
  /** `immediate`: a tick writes at once (Add to folder). `deferred`: ticks collect for the caller (New dialog). */
  apply: 'immediate' | 'deferred';
  /** The design being filed; null in the New dialog. */
  design: PickerDesignRef | null;
  /** New dialog: the chat's project, ticked and locked. */
  derivedProject: string | null;
  /** Move: the target the design is leaving, left out. */
  exclude?: TargetKey;
  /** Deferred: the keys ticked at open. */
  initial?: TargetKey[];
  /** Deferred: the selection changed (locked rows never included). */
  onChange?: (selected: TargetKey[]) => void;
  /** Single: a live row was picked; the caller writes (Move's one atomic batch). */
  onPick?: (target: MembershipTarget) => void;
  /** Visible rows before the list scrolls (default 6). */
  rows?: number;
  /** `always`: the New dialog's combo searches even under 9 targets (the approved canvas). */
  search?: 'auto' | 'always';
  searchPlaceholder?: string;
  /** The section notes ("They group designs for you", "Yours to fill"); the New dialog's combo heads are plain. */
  sectionNotes?: boolean;
};

export type FolderPickerHandle = {
  el: HTMLElement;
  /** The ticked, writable keys in list order (projects then folders). Locked rows never appear. */
  selected: () => TargetKey[];
  /** The selected rows themselves, for the New dialog's chips and stated result. */
  selectedRows: () => PickRow[];
  /** The locked automatic project row (the design's own, or the chat's in the New dialog), if any. */
  derivedRow: () => PickRow | null;
  /** Deferred: replace the selection (the New dialog's chip removes); fires onChange. */
  setSelected: (keys: TargetKey[]) => void;
  focus: () => void;
  dispose: () => void;
};

const SKELETON_ROWS = 3;
const PROJECTS_NOTE = 'They group designs for you';
const FOLDERS_NOTE = 'Yours to fill';
const NO_FOLDERS = 'No folders yet. Name one below and this design goes in it.';
const LOAD_ERROR_TITLE = 'Your folders didn’t load';
const LOAD_ERROR_BODY = 'The local service didn’t answer, so folders can’t be listed or made right now. Projects still work. Check the service is allowed in Settings, then try again.';

/** The hint under a project row's name: automatic, added by hand, or an invitation (the approved canvas). */
const projectHint = (row: PickRow, design: PickerDesignRef | null): string => {
  if (row.locked) return design !== null ? 'Automatic. This design was made there.' : 'Automatic, where the agent works';
  if (row.checked) return design !== null ? 'Added by you. Nothing on disk moved.' : 'Added by hand';
  return 'Tick to add this design by hand.';
};

type CheckRow = { kind: 'check'; li: HTMLLIElement; handle: CheckboxHandle; count: HTMLElement; glyph: SVGSVGElement | null; glyphName: 'lock' | 'layers' | null };
type BtnRow = { kind: 'btn'; li: HTMLLIElement; button: HTMLButtonElement; name: HTMLElement; hint: HTMLElement; count: HTMLElement; glyph: SVGSVGElement; glyphName: 'lock' | 'layers' | 'folder'; chev: SVGSVGElement };
type RowNode = CheckRow | BtnRow;

export const mountFolderPicker = (holder: HTMLElement, options: FolderPickerOptions): FolderPickerHandle => {
  const scope = createScope();
  const folderStore = folders();
  const mode = options.mode;
  const deferred = options.apply === 'deferred';
  const searchPlaceholder = options.searchPlaceholder ?? 'Search folders and projects';

  let hostProjects: ProjectInfo[] = [];
  let query = '';
  let selection = new Set<TargetKey>(options.initial ?? []);
  let failure: string | null = null;
  let status: string | null = null;
  let createOpen = false;
  let createValue = '';
  let creating = false;
  const busy = new Set<TargetKey>();
  /** A failed tick reads as its old value until the reload lands (the store is optimistic). */
  const reverts = new Map<TargetKey, boolean>();
  const rows = new Map<TargetKey, RowNode>();
  let disposed = false;

  const el = h('div', { class: 'dc-pick' });
  const searchWrap = h('div', { class: 'dc-pick-search', hidden: true });
  const search: SearchFieldHandle = scope.own(mountSearchField(searchWrap, { value: '', placeholder: searchPlaceholder, label: searchPlaceholder, onChange: (value) => {
    query = value;
    status = null;
    paint();
  } }));
  const list = h('div', { class: 'dc-pick-list' });
  list.style.setProperty('--dc-pick-rows', String(options.rows ?? 6));

  const projectsSection = h('section', { class: 'dc-pick-section' });
  const projectsHead = h('div', { class: 'dc-pick-head' }, h('h3', { class: 'dc-pick-title' }, 'Projects'), options.sectionNotes === false ? null : h('span', { class: 'dc-pick-note' }, PROJECTS_NOTE));
  const projectsList = h('ul', { class: 'dc-pick-rows', role: 'list', 'aria-label': 'Projects' });
  projectsSection.append(projectsHead, projectsList);

  const foldersSection = h('section', { class: 'dc-pick-section' });
  const foldersHead = h('div', { class: 'dc-pick-head' }, h('h3', { class: 'dc-pick-title' }, 'Folders'), options.sectionNotes === false ? null : h('span', { class: 'dc-pick-note' }, FOLDERS_NOTE));
  const foldersBody = h('div', { class: 'dc-pick-folders-body' });
  foldersSection.append(foldersHead, foldersBody);

  const failureLine = h('p', { class: 'dc-form-error dc-pick-failure', role: 'alert', hidden: true });
  const createBox = h('div', { class: 'dc-pick-new' });
  const statusLine = h('p', { class: 'dc-pick-status', role: 'status', hidden: true });
  list.append(projectsSection, foldersSection);
  el.append(searchWrap, list, failureLine, createBox, statusLine);
  holder.append(el);

  let createField: TextFieldHandle | null = null;
  let createButton: BtnHandle | null = null;
  let createInput: HTMLInputElement | null = null;

  const designsNow = (): { designs: DesignSummary[]; root: string } => {
    const data = store.getState().designs.data;
    return { designs: data?.designs ?? [], root: data?.root ?? '' };
  };

  const modelNow = (): { folders: PickRow[]; projects: PickRow[]; total: number } => {
    const state = folderStore.get();
    const { designs, root } = designsNow();
    return pickerTargets({
      folders: state.status === 'error' ? [] : state.folders,
      projectMembers: state.projects,
      hostProjects,
      designs,
      designsRoot: root,
      design: options.design,
      derivedProject: options.derivedProject,
      ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
    });
  };

  const selectedKeys = (): TargetKey[] => {
    const model = modelNow();
    const wanted = deferred ? selection : new Set([...model.projects, ...model.folders].filter((row) => row.checked && !row.locked).map((row) => row.key));
    return [...model.projects, ...model.folders].filter((row) => wanted.has(row.key) && !row.locked).map((row) => row.key);
  };

  const emitChange = (): void => options.onChange?.(selectedKeys());

  const showFailure = (message: string | null): void => {
    failure = message;
    failureLine.hidden = message === null;
    failureLine.textContent = message ?? '';
  };

  const showStatus = (message: string | null): void => {
    status = message;
    statusLine.hidden = message === null;
    statusLine.replaceChildren();
    if (message !== null) statusLine.append(icon('check', 14), h('span', null, message));
  };

  // ---- one tick, one write (immediate multi) ----

  const toggle = async (row: PickRow, checked: boolean): Promise<void> => {
    if (row.locked || options.design === null || busy.has(row.key)) return;
    const slug = options.design.slug;
    showFailure(null);
    showStatus(null);
    busy.add(row.key);
    paint();
    const target = targetOfKey(row.key);
    const change = { target, ...(checked ? { add: [slug] } : { remove: [slug] }) };
    try {
      const answer = await folderStore.apply([change]);
      const result = answer.results.find((entry) => keyOfTarget(entry.target) === row.key);
      // Best effort: a refused change answers ok:false and the list already shows the truth.
      if (result && !result.ok) showFailure(result.message);
    } catch (error) {
      showFailure(errorText(error));
      reverts.set(row.key, !checked);
      void folderStore.load().then(() => {
        reverts.delete(row.key);
        paint();
      });
    } finally {
      busy.delete(row.key);
      paint();
    }
  };

  // ---- rows ----

  const setGlyph = (node: RowNode, name: 'lock' | 'layers' | 'folder' | null): void => {
    if (node.kind === 'check') {
      const checkName = name === 'folder' ? null : name;
      if (checkName === node.glyphName) return;
      node.glyph?.remove();
      node.glyph = checkName === null ? null : checkName === 'lock' ? pickGlyph('lock', 14) : icon(checkName, 14);
      node.glyphName = checkName;
      if (node.glyph) node.li.querySelector('.oc-sdk-check-text')?.before(node.glyph);
    } else {
      if (name === null || name === node.glyphName) return;
      const next = name === 'lock' ? pickGlyph('lock', 14) : icon(name, 14);
      node.glyph.replaceWith(next);
      node.glyph = next;
      node.glyphName = name;
    }
  };

  const makeCheckRow = (row: PickRow): CheckRow => {
    const li = h('li', { class: 'dc-pick-row' });
    const handle = mountCheckbox(li, {
      label: row.label,
      checked: row.checked,
      description: row.kind === 'project' ? projectHint(row, options.design) : undefined,
      onChange: (checked) => {
        if (deferred) {
          if (row.locked) return;
          if (checked) selection.add(row.key);
          else selection.delete(row.key);
          showStatus(null);
          paint();
          emitChange();
        } else {
          void toggle(row, checked);
        }
      },
    });
    const count = h('span', { class: 'dc-pick-count', 'aria-hidden': 'true' }, String(row.count));
    li.append(count);
    li.querySelector('.oc-sdk-check')?.setAttribute('title', row.title);
    const node: CheckRow = { kind: 'check', li, handle, count, glyph: null, glyphName: null };
    rows.set(row.key, node);
    return node;
  };

  const makeBtnRow = (row: PickRow): BtnRow => {
    const name = h('span', { class: 'dc-pick-name' }, row.label);
    const hint = h('span', { class: 'dc-pick-hint', hidden: true });
    const count = h('span', { class: 'dc-pick-count', 'aria-hidden': 'true' }, String(row.count));
    const chev = icon('chevron', 14);
    chev.classList.add('dc-pick-chev');
    const glyph = row.kind === 'project' ? icon('layers', 14) : icon('folder', 14);
    const button = h(
      'button',
      { type: 'button', class: 'dc-pick-btn', title: row.title },
      glyph,
      h('span', { class: 'dc-pick-text' }, name, hint),
      count,
      chev,
    );
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      options.onPick?.(targetOfKey(row.key));
    });
    const li = h('li', { class: 'dc-pick-row dc-pick-row-btn' }, button);
    const node: BtnRow = { kind: 'btn', li, button, name, hint, count, glyph, glyphName: row.kind === 'project' ? 'layers' : 'folder', chev };
    rows.set(row.key, node);
    return node;
  };

  const updateRow = (node: RowNode, row: PickRow): void => {
    const checked = reverts.get(row.key) ?? (deferred && !row.locked ? selection.has(row.key) : row.checked);
    const inert = row.locked || (mode === 'single' && checked);
    if (node.kind === 'check') {
      node.handle.update({
        label: row.label,
        checked,
        description: row.kind === 'project' ? projectHint(row, options.design) : undefined,
        disabled: busy.has(row.key),
      });
      const control = node.li.querySelector('.oc-sdk-check');
      control?.setAttribute('aria-disabled', row.locked ? 'true' : 'false');
      control?.setAttribute('title', row.title);
      node.count.textContent = String(row.count);
      setGlyph(node, row.kind === 'project' ? (row.locked ? 'lock' : 'layers') : null);
      node.li.dataset.locked = row.locked ? 'true' : 'false';
    } else {
      node.name.textContent = row.label;
      const hintText = row.locked ? (options.design !== null ? 'Automatic. This design was made there.' : row.lockedReason ?? '') : mode === 'single' && checked && options.design !== null ? `${options.design.title} is already in ${row.label}.` : '';
      node.hint.textContent = hintText;
      node.hint.hidden = hintText === '';
      node.count.textContent = String(row.count);
      node.button.setAttribute('aria-disabled', inert ? 'true' : 'false');
      node.button.title = row.title;
      node.chev.style.display = inert ? 'none' : '';
      setGlyph(node, row.kind === 'project' ? (row.locked ? 'lock' : 'layers') : 'folder');
      node.li.dataset.locked = inert ? 'true' : 'false';
    }
  };

  const paintRows = (ul: HTMLUListElement, wanted: PickRow[]): void => {
    const keep = new Set<TargetKey>();
    for (const row of wanted) {
      keep.add(row.key);
      let node = rows.get(row.key);
      if (!node) node = mode === 'multi' ? makeCheckRow(row) : makeBtnRow(row);
      updateRow(node, row);
      ul.append(node.li); // append moves an existing row, so focus and the kit handle survive
    }
    for (const [key, node] of [...rows]) {
      if (keep.has(key) || node.li.parentElement !== ul) continue;
      if (node.kind === 'check') node.handle.dispose();
      node.li.remove();
      rows.delete(key);
    }
  };

  // ---- the inline New folder field ----

  const closeCreate = (): void => {
    createOpen = false;
    createValue = '';
    createField?.update({ error: undefined, value: '' });
  };

  const submitCreate = async (): Promise<void> => {
    if (creating || createField === null) return;
    const problem = folderNameProblem(createValue, folderStore.get().folders);
    if (problem !== null) {
      createField.update({ error: problem });
      return;
    }
    creating = true;
    createButton?.set({ loading: true });
    showFailure(null);
    try {
      const folder = await folderStore.create(createValue.trim());
      const key: TargetKey = `folder:${folder.id}`;
      if (mode === 'single') {
        closeCreate();
        options.onPick?.({ kind: 'folder', id: folder.id });
      } else if (deferred) {
        selection.add(key);
        closeCreate();
        showStatus(`Created ${folder.name}.`);
        emitChange();
      } else if (options.design !== null) {
        try {
          await folderStore.apply([{ target: { kind: 'folder', id: folder.id }, add: [options.design.slug] }]);
          showStatus(`Added to ${folder.name}.`);
        } catch (error) {
          showFailure(errorText(error));
        }
        closeCreate();
      }
    } catch (error) {
      createField.update({ error: errorText(error) });
    } finally {
      creating = false;
      createButton?.set({ loading: false });
      paint();
    }
  };

  const paintCreate = (state: FoldersState, nothingAtAll: boolean, noFolders: boolean, loading: boolean): void => {
    createBox.hidden = state.status === 'error' || loading;
    if (state.status === 'error' || loading) return;
    const wantOpen = createOpen || nothingAtAll || noFolders;
    if (wantOpen && createField === null) {
      createBox.replaceChildren();
      const fieldHost = h('div', { class: 'dc-pick-new-field' });
      createField = mountTextField(fieldHost, {
        label: 'Folder name',
        value: createValue,
        placeholder: 'Q4 launch',
        helper: '1 to 40 characters.',
        onChange: (next) => void (createValue = next),
      });
      createInput = fieldHost.querySelector('input');
      createButton = btn({ label: mode === 'single' ? 'Create and move' : 'Create and add', variant: 'default', size: 'sm', onClick: () => void submitCreate() });
      createInput?.addEventListener('blur', () => {
        if (createValue.trim() !== '') createField?.update({ error: folderNameProblem(createValue, folderStore.get().folders) ?? undefined });
      });
      fieldHost.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          void submitCreate();
        }
      });
      createBox.append(fieldHost, h('div', { class: 'dc-pick-new-actions' }, createButton.el));
      if (createOpen) queueMicrotask(() => createInput?.focus());
    } else if (!wantOpen && createField !== null) {
      createField.dispose();
      createField = null;
      createButton = null;
      createInput = null;
      createBox.replaceChildren();
    }
    if (!wantOpen && createBox.firstElementChild === null) {
      const open = btn({ label: 'New folder…', variant: 'ghost', size: 'sm', icon: 'plus', onClick: () => {
        createOpen = true;
        showStatus(null);
        paint();
      } });
      createBox.append(open.el);
    }
  };

  // ---- paint ----

  const paint = (): void => {
    if (disposed) return;
    const state = folderStore.get();
    const model = modelNow();
    const loading = (state.status === 'idle' || state.status === 'loading') && state.folders.length === 0;
    const errored = state.status === 'error';
    const nothingAtAll = !loading && !errored && model.total === 0;
    const noFolders = !loading && !errored && model.folders.length === 0;

    searchWrap.hidden = !(options.search === 'always' || showSearch(model.total));

    const projectRows = filterRows(model.projects, query);
    const searching = query.trim() !== '';
    const projectsEmptyMatch = searching && projectRows.length === 0 && model.projects.length > 0;
    projectsSection.hidden = nothingAtAll || (projectRows.length === 0 && !projectsEmptyMatch);
    if (projectsEmptyMatch) projectsList.replaceChildren(h('li', { class: 'dc-pick-message dc-muted' }, `No projects match “${query.trim()}”.`));
    else paintRows(projectsList, projectRows);

    foldersSection.hidden = nothingAtAll;
    if (loading) {
      foldersBody.replaceChildren(h('ul', { class: 'dc-pick-rows', 'aria-hidden': 'true' }, ...Array.from({ length: SKELETON_ROWS }, () => h('li', { class: 'dc-pick-skeleton' }, h('span', { class: 'dc-skel dc-skel-line' })))));
    } else if (errored) {
      foldersBody.replaceChildren(banner({ tone: 'error', title: LOAD_ERROR_TITLE, body: LOAD_ERROR_BODY, action: { label: 'Try again', onClick: () => void folderStore.load() } }));
    } else if (noFolders) {
      foldersBody.replaceChildren(h('p', { class: 'dc-pick-message dc-muted' }, NO_FOLDERS));
    } else {
      let ul = foldersBody.querySelector<HTMLUListElement>('.dc-pick-rows');
      if (!ul) {
        ul = h('ul', { class: 'dc-pick-rows', role: 'list', 'aria-label': 'Folders' });
        foldersBody.replaceChildren(ul);
      }
      const folderRows = filterRows(model.folders, query);
      if (searching && folderRows.length === 0) ul.replaceChildren(h('li', { class: 'dc-pick-message dc-muted' }, `No folders match “${query.trim()}”.`));
      else paintRows(ul, folderRows);
    }

    failureLine.hidden = failure === null;
    failureLine.textContent = failure ?? '';
    statusLine.hidden = status === null;

    paintCreate(state, nothingAtAll, noFolders, loading);
  };

  scope.add(folderStore.subscribe(paint));
  scope.add(store.subscribe(paint));
  void guestHost.client.listProjects().then(
    (answer) => {
      hostProjects = answer.projects.map((project) => ({ directory: project.directory, name: project.name }));
      paint();
    },
    (error: unknown) => console.warn('Design Chamber: the project names could not be read; folders show their own names', error),
  );
  void folderStore.load();
  paint();

  return {
    el,
    selected: selectedKeys,
    selectedRows: () => {
      const keys = new Set(selectedKeys());
      const model = modelNow();
      return [...model.projects, ...model.folders].filter((row) => keys.has(row.key));
    },
    derivedRow: () => {
      const model = modelNow();
      return model.projects.find((row) => row.locked) ?? null;
    },
    setSelected: (keys) => {
      const model = modelNow();
      const live = new Set([...model.projects, ...model.folders].filter((row) => !row.locked).map((row) => row.key));
      selection = new Set(keys.filter((key) => live.has(key)));
      paint();
      emitChange();
    },
    focus: () => {
      const target =
        (!searchWrap.hidden ? searchWrap.querySelector('input') : null) ??
        list.querySelector<HTMLElement>('.oc-sdk-check:not([disabled]), .dc-pick-btn[aria-disabled="false"]') ??
        createInput ??
        createBox.querySelector('button');
      target?.focus();
    },
    dispose: () => {
      disposed = true;
      scope.dispose();
      for (const node of rows.values()) if (node.kind === 'check') node.handle.dispose();
      rows.clear();
      createField?.dispose();
      el.remove();
    },
  };
};
