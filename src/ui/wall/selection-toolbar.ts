// The selection toolbar (Phase 2 technical design §3.5): three actions floated above a picked
// element, next to the comment box that opens as it always did. Edit text opens the inline editor,
// Comment goes to the comment box, Ask agent hands the element to the ask bar. When Edit text
// cannot be used its button stays focusable (`aria-disabled`, never `disabled`) and the sentence
// that says why sits under the buttons, linked with `aria-describedby`, so a keyboard or screen
// reader user hears it. Pure DOM: the feature decides what each action does and where the toolbar goes.

import { h, nextId } from '../components/dom.ts';
import { btn, type BtnHandle } from '../components/kit.ts';
import type { IconName } from '../components/icons.ts';

export type ToolbarAction = 'edit' | 'comment' | 'ask';

/** Edit text while the frame and the file are being read, once it can be used, or why it cannot. */
export type EditState = { kind: 'checking' } | { kind: 'ready' } | { kind: 'disabled'; reason: string };

export type SelectionToolbarOptions = {
  /** "Actions for <tag> '<text>'" */
  name: string;
  /** Labels next to the icons; false on a narrow stage (the labels stay as `aria-label` and tooltip). */
  labels: boolean;
  onAction: (action: ToolbarAction) => void;
  /** Escape inside the toolbar: close it and hand the keyboard back to the wall. */
  onEscape: () => void;
};

export type SelectionToolbar = {
  el: HTMLElement;
  setEdit: (state: EditState) => void;
  setLabels: (labels: boolean) => void;
  /** Focus the toolbar's current button. */
  focus: () => void;
  dispose: () => void;
};

type Item = { action: ToolbarAction; label: string; icon: IconName; handle: BtnHandle };

export const createSelectionToolbar = (options: SelectionToolbarOptions): SelectionToolbar => {
  const reasonId = nextId('dc-seltoolbar-reason');
  const reason = h('p', { class: 'dc-seltoolbar-reason', id: reasonId, hidden: true });
  let edit: EditState = { kind: 'checking' };

  const make = (action: ToolbarAction, label: string, icon: IconName): Item => {
    const handle = btn({
      label,
      variant: 'ghost',
      size: 'xs',
      icon,
      title: label,
      onClick: () => {
        // A refused Edit text stays focusable so its reason can be read; pressing it does nothing.
        if (action === 'edit' && edit.kind !== 'ready') return;
        options.onAction(action);
      },
    });
    handle.el.setAttribute('aria-label', label);
    handle.el.dataset.action = action;
    handle.el.tabIndex = -1;
    return { action, label, icon, handle };
  };

  const items = [make('edit', 'Edit text', 'pencil'), make('comment', 'Comment', 'comment'), make('ask', 'Ask agent', 'chat')];
  const [editItem, commentItem] = items;
  // The comment box is open beside the toolbar, so Comment is where the user already is.
  if (commentItem) commentItem.handle.el.dataset.current = 'true';
  const row = h('div', { class: 'dc-seltoolbar-row', role: 'toolbar', 'aria-label': options.name, 'aria-orientation': 'horizontal' }, ...items.map((item) => item.handle.el));
  const el = h('div', { class: 'dc-seltoolbar', 'data-labels': String(options.labels) }, row, reason);

  let current = 0;
  const setCurrent = (index: number, focus: boolean): void => {
    current = (index + items.length) % items.length;
    items.forEach((item, at) => {
      item.handle.el.tabIndex = at === current ? 0 : -1;
    });
    if (focus) items[current]?.handle.el.focus();
  };
  setCurrent(0, false);

  row.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') setCurrent(current + 1, true);
    else if (event.key === 'ArrowLeft') setCurrent(current - 1, true);
    else if (event.key === 'Home') setCurrent(0, true);
    else if (event.key === 'End') setCurrent(items.length - 1, true);
    else if (event.key === 'Escape') options.onEscape();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  // A press moves the roving stop to the button the pointer used.
  row.addEventListener('focusin', (event) => {
    const at = items.findIndex((item) => item.handle.el === event.target);
    if (at >= 0 && at !== current) setCurrent(at, false);
  });

  const setEdit = (state: EditState): void => {
    edit = state;
    const button = editItem?.handle.el;
    if (!editItem || !button) return;
    editItem.handle.set({ loading: state.kind === 'checking' });
    // `loading` disables the button while it checks; once settled the button is focusable again.
    if (state.kind === 'disabled') {
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-describedby', reasonId);
      button.title = state.reason;
      reason.textContent = state.reason;
      reason.title = state.reason;
      reason.hidden = false;
    } else {
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-describedby');
      button.title = editItem.label;
      reason.textContent = '';
      reason.hidden = true;
    }
    el.dataset.edit = state.kind;
  };
  setEdit(edit);

  const setLabels = (labels: boolean): void => {
    el.dataset.labels = String(labels);
  };

  return {
    el,
    setEdit,
    setLabels,
    focus: () => items[current]?.handle.el.focus(),
    dispose: () => el.remove(),
  };
};
