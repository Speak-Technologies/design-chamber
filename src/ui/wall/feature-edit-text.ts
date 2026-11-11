// Phase 2 feature mount (seam S9): edit text in place (feature 08). It listens to the wall's picks
// (a click or double-click on an element in Edit mode), floats the selection toolbar over the
// element, and opens the inline editor. It is the only place in the UI that starts a text write,
// and only from Enter or Save inside the editor (E1): no frame message reaches it. The rules (what is
// editable and why not, what Enter sends, the sentences, the placement) are in
// `model/edit-text-model.ts`; this file wires them to the wall, the store, the notices and the ask bar.

import { phaseOf } from '../../guest/build-activity.ts';
import { createEditNotice } from '../components/edit-notice.ts';
import { store } from '../guest.ts';
import {
  agentIsWorking,
  editorWidth,
  hasChange,
  placeEditor,
  placeToolbar,
  reasonSentence,
  refusalOf,
  reloadOutcome,
  saveDecision,
  toolbarLabels,
  toolbarName,
  type PickCheck,
} from '../model/edit-text-model.ts';
import { askBarFor } from './feature-ask-bar.ts';
import { buildActivityFor } from './feature-build-strip.ts';
import { undoSlotFor } from './feature-undo.ts';
import { createSelectionToolbar, type SelectionToolbar, type ToolbarAction } from './selection-toolbar.ts';
import { createTextEditor, type TextEditor } from './text-editor.ts';
import type { FeatureMount } from './view-context.ts';
import type { WallPick } from './wall-types.ts';

type Editable = Extract<PickCheck, { editable: true }>;

type Toolbar = { kind: 'toolbar'; pick: WallPick; toolbar: SelectionToolbar; check: PickCheck | null };
type Editing = { kind: 'editor'; pick: WallPick; editor: TextEditor; check: Editable; saving: boolean; resize: ResizeObserver };
type Open = { kind: 'none' } | Toolbar | Editing;

/** The toolbar's gap to the comment box it sits beside. */
const CARD_GAP = 8;

export const mount: FeatureMount = (ctx) => {
  const { wall, slug } = ctx;
  const rail = ctx.surface === 'panel';
  let open: Open = { kind: 'none' };
  // One slot for every hand edit of this view, the screen actions' included (feature-undo.ts).
  const undoSlot = undoSlotFor(wall);
  let disposed = false;

  const notice = createEditNotice({
    notices: ctx.notices,
    undo: async (editId) => {
      await store.undoEdit(slug, editId);
    },
    onNoticeUndo: undoSlot.noticeUndo,
    focusWall: () => wall.focus(),
    viewing: () => ctx.viewing() !== null,
    onViewing: ctx.onViewing,
  });

  const agentWorking = (): boolean => {
    const watcher = buildActivityFor(wall);
    return watcher !== undefined && agentIsWorking(phaseOf(watcher.get(), Date.now()));
  };

  // ---------------------------------------------------------------- toolbar

  const placeToolbarFor = (current: Toolbar): void => {
    const el = current.toolbar.el;
    const stage = wall.size();
    const box = wall.pickBox(current.pick);
    const place = placeToolbar(box, { w: el.offsetWidth, h: el.offsetHeight }, { w: stage.width, h: stage.height });
    el.style.left = `${Math.round(place.left)}px`;
    el.style.top = `${Math.round(place.top)}px`;
    el.dataset.below = String(place.below);
    // Flipped below the element, the toolbar would sit on the comment box: the box goes under it.
    const card = wall.cardEl();
    if (place.below && card) card.style.top = `${Math.round(Math.max(Number.parseFloat(card.style.top) || 0, place.top + el.offsetHeight + CARD_GAP))}px`;
  };

  const closeToolbar = (): void => {
    if (open.kind !== 'toolbar') return;
    open.toolbar.dispose();
    open = { kind: 'none' };
  };

  const applyCheck = (current: Toolbar, check: PickCheck): void => {
    current.check = check;
    current.toolbar.setEdit(check.editable ? { kind: 'ready' } : { kind: 'disabled', reason: reasonSentence(check.reason, check.detail) });
    // The reason line makes the toolbar taller: place it again.
    placeToolbarFor(current);
  };

  const onAction = (action: ToolbarAction): void => {
    if (open.kind !== 'toolbar') return;
    const { pick, check } = open;
    if (action === 'edit') {
      if (check?.editable) openEditor(pick, check);
      return;
    }
    if (action === 'comment') {
      wall.openComment(pick);
      return;
    }
    // Ask agent: the element goes to the ask bar as its chip and the keyboard follows. An empty comment box goes away.
    const bar = askBarFor(wall);
    closeToolbar();
    wall.closeEmptyCard();
    if (bar) {
      bar.setSelection(pick.selection);
      bar.focus();
    }
  };

  const leave = (): void => {
    wall.closeCard();
    closeToolbar();
    wall.focus();
  };

  const showToolbar = (pick: WallPick): void => {
    if (open.kind === 'toolbar' && open.pick.selection.key === pick.selection.key) {
      // The double-click's pick for the element the first click picked: keep the toolbar, check again.
      open.pick = pick;
      open.toolbar.setEdit({ kind: 'checking' });
      placeToolbarFor(open);
      return;
    }
    closeToolbar();
    const toolbar = createSelectionToolbar({
      name: toolbarName(pick.element.tag, pick.element.text),
      labels: toolbarLabels(wall.size().width),
      onAction,
      onEscape: leave,
    });
    // Before the comment box in tab order: Shift+Tab from the box reaches the toolbar.
    wall.overlay.prepend(toolbar.el);
    open = { kind: 'toolbar', pick, toolbar, check: null };
    placeToolbarFor(open);
  };

  // ---------------------------------------------------------------- editor

  const placeEditorFor = (current: Editing): void => {
    const el = current.editor.el;
    const stage = wall.size();
    const box = wall.pickBox(current.pick);
    current.editor.setWidth(editorWidth({ surface: rail ? 'rail' : 'page', boxWidth: box.w, stageWidth: stage.width }));
    const place = placeEditor(box, { w: el.offsetWidth, h: el.offsetHeight }, { w: stage.width, h: stage.height }, rail ? 'rail' : 'page');
    el.style.left = `${Math.round(place.left)}px`;
    el.style.top = `${Math.round(place.top)}px`;
  };

  const closeEditor = (): void => {
    if (open.kind !== 'editor') return;
    const current = open;
    open = { kind: 'none' };
    current.resize.disconnect();
    current.editor.dispose();
    wall.setEditing(false);
    wall.ringPick(null);
  };

  const openEditor = (pick: WallPick, check: Editable): void => {
    closeToolbar();
    closeEditor();
    // The comment box the first click opened goes away when it is empty; a draft stays.
    wall.closeEmptyCard();
    const stage = wall.size();
    const box = wall.pickBox(pick);
    const editor = createTextEditor({
      initial: check.before,
      dir: check.dir,
      label: `Text of the ${pick.element.tag}`,
      width: editorWidth({ surface: rail ? 'rail' : 'page', boxWidth: box.w, stageWidth: stage.width }),
      agentWorking: agentWorking(),
      onSave: () => void save(),
      onCancel: () => {
        closeEditor();
        wall.focus();
      },
      onReload: () => void reload(),
      onAskAgent: () => askAgent(),
    });
    const resize = new ResizeObserver(() => {
      if (open.kind === 'editor' && open.editor === editor) placeEditorFor(open);
    });
    wall.overlay.append(editor.el);
    open = { kind: 'editor', pick, editor, check, saving: false, resize };
    resize.observe(editor.el);
    placeEditorFor(open);
    wall.setEditing(true);
    wall.ringPick(pick);
    if (ctx.viewing() !== null) editor.setViewing(true);
    editor.focus();
  };

  const save = async (): Promise<void> => {
    if (open.kind !== 'editor' || open.saving || ctx.viewing() !== null) return;
    const current = open;
    const decision = saveDecision(current.check.before, current.editor.value());
    // Nothing changed: no write, so no version and no ledger line for a no-op.
    if (decision.kind === 'unchanged') {
      closeEditor();
      wall.focus();
      return;
    }
    // Over the limit: the counter already says so and Save is off.
    if (decision.kind === 'too-long') return;
    current.saving = true;
    current.editor.setSaving(true);
    try {
      const response = await store.applyEdit(slug, {
        op: 'text',
        screen: current.pick.screen,
        base: current.check.base,
        target: current.check.target,
        before: current.check.before,
        after: decision.after,
      });
      if (disposed) return;
      if (response.edit.undoable) undoSlot.edited(response.edit.id);
      closeEditor();
      notice.saved(response.edit);
      wall.focus();
    } catch (error) {
      if (disposed || open.kind !== 'editor' || open !== current) return;
      current.saving = false;
      current.editor.setSaving(false);
      current.editor.setRefusal(refusalOf(describe(error)));
      current.editor.focus();
    }
  };

  const reload = async (): Promise<void> => {
    if (open.kind !== 'editor' || open.saving) return;
    const current = open;
    current.editor.setReloading(true);
    const next = await wall.recheckPick(current.pick);
    if (disposed || open !== current) return;
    current.editor.setReloading(false);
    const outcome = reloadOutcome(current.check.before, next);
    if (outcome.kind === 'ready') {
      // The user's words stay; the editor now compares and writes against the file as it is.
      current.check = outcome.check;
      current.editor.setRefusal(null);
      current.editor.setFileNowSays(outcome.fileNowSays);
    } else {
      current.editor.setGone(outcome.sentence);
    }
  };

  /** The typed words go to the ask bar with the element's chip; the editor closes. */
  const askAgent = (): void => {
    if (open.kind !== 'editor') return;
    const { pick, editor } = open;
    const bar = askBarFor(wall);
    const typed = editor.value();
    closeEditor();
    if (!bar) {
      wall.focus();
      return;
    }
    bar.setSelection(pick.selection);
    bar.setText(typed);
    bar.focus();
  };

  // ---------------------------------------------------------------- wall and view events

  const offPick = wall.onPick((pick) => {
    if (open.kind === 'editor') return;
    showToolbar(pick);
    const shown = open;
    if (shown.kind !== 'toolbar') return;
    void pick.check.then((check) => {
      if (disposed || open !== shown || shown.pick !== pick) return;
      applyCheck(shown, check);
      // A double-click opens the editor at once when the element allows it; otherwise the toolbar says why.
      if (pick.purpose === 'edit' && check.editable) openEditor(pick, check);
    });
  });

  // The comment box is the toolbar's neighbour: when it goes (cancelled, saved, moved away from), so does the toolbar.
  const offSelection = wall.onSelection((event) => {
    if (event.type === 'cleared') closeToolbar();
  });

  // The camera or a frame's scroll moved: a box that was anchored to the element follows it (the editor)
  // or goes with the comment box (the toolbar).
  const offMoved = wall.onMoved(() => {
    closeToolbar();
    if (open.kind === 'editor') placeEditorFor(open);
  });

  // A press on the wall away from the toolbar and the comment box closes the toolbar. A press away from the editor is
  // its click-away rule: unchanged text closes it (and the press goes on to the wall); changed text keeps it.
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (open.kind === 'toolbar' && !target?.closest('.dc-seltoolbar, .dc-composer')) closeToolbar();
    if (open.kind !== 'editor' || open.saving || target?.closest('.dc-editor')) return;
    if (hasChange(open.check.before, open.editor.value())) open.editor.remindClickAway();
    else closeEditor();
  };
  document.addEventListener('pointerdown', onPointerDown, true);

  const offUndoKey = wall.onUndoEdit(() => {
    // E12: with an old version on show the slot refuses (and keeps the edit); the notice says why.
    const { undo, refusal } = undoSlot.key(ctx.viewing() !== null);
    if (refusal !== null) notice.refused(refusal);
    else if (undo !== null) void notice.undo(undo);
  });

  // An old version on show: nothing here may write. The toolbar goes; an editor with unsaved words stays, with Save off and the reason.
  const offViewing = ctx.onViewing(() => {
    const viewing = ctx.viewing() !== null;
    if (open.kind === 'toolbar' && viewing) closeToolbar();
    if (open.kind !== 'editor') return;
    if (viewing && !hasChange(open.check.before, open.editor.value())) {
      closeEditor();
      return;
    }
    open.editor.setViewing(viewing);
  });

  // The agent starts or stops working on the design: the editor's first line follows (E11).
  const watcher = buildActivityFor(wall);
  const offWatch = watcher?.subscribe(() => {
    if (open.kind === 'editor') open.editor.setAgentWorking(agentWorking());
  });

  return () => {
    disposed = true;
    offPick();
    offSelection();
    offMoved();
    offUndoKey();
    offViewing();
    offWatch?.();
    document.removeEventListener('pointerdown', onPointerDown, true);
    closeToolbar();
    closeEditor();
    notice.dispose();
  };
};

/** The store rejects with a `ServiceError`; anything else still gets a sentence. */
const describe = (error: unknown): { code: string; message: string; status: number | null } => {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
    return { code: String(error.code), message: String(error.message), status };
  }
  return { code: 'REQUEST_FAILED', message: error instanceof Error ? error.message : 'Try again.', status: null };
};
