// Comments on a design system's board (system-builder-depth T21): a Comment switch on the board, numbered pins on the
// entries that have comments, a small card to write or change one, and the list with "Send comments (N)". The look and
// keyboard model are the wall's pins and cards (`wall/pin-layer.ts`, `wall/comment-ui.ts`); the model is not: a board
// comment is anchored to an entry key and lives in the system's `.chamber/comments.json`, through the service only.
//
// In the rail the board is too short for a card to float on it, so the card docks at the top of the list, right under
// the board, and a marker stays on the entry.
//
// Words typed into a card and not saved are kept in memory (one store for every system page), so closing a card,
// clicking another entry or leaving the page never loses them; the same card shows them again.

import { mountBadge, mountSelect } from '@openchamber/sdk/ui';

import type { SystemComment, SystemDetail, SystemSection } from '../../shared/types.ts';
import { isBoardEntryKey } from '../../shared/system-board.ts';
import { toast } from '../components/actions.ts';
import { errorText, h } from '../components/dom.ts';
import { banner, btn, iconBtn, loadingRow, type BtnHandle } from '../components/kit.ts';
import { client } from '../guest.ts';
import {
  DAMAGED_BODY,
  DAMAGED_COUNT,
  DAMAGED_NONE,
  DAMAGED_TITLE,
  EMPTY_COMMENTS,
  boardCommentCounts,
  boardCommentRows,
  boardComposerKey,
  boardPinGlyph,
  boardPinLabel,
  boardPinSpots,
  boardSendResult,
  boardThreadKey,
  cardPlacement,
  commentBodyProblem,
  commentStatusLabel,
  createDraftStore,
  entriesOf,
  entryInSystem,
  entrySpot,
  sendAllState,
  sendOneProblem,
  splitRows,
  unsavedText,
  type BoardCommentRow,
} from '../model/board-comments-model.ts';
import { entryLabel } from '../model/system-page-model.ts';
import type { BoardHandle, BoardLayout } from './system-board.ts';
import { sendSystemComments, type SystemChat } from './system-ask.ts';

export type BoardCommentsOptions = {
  id: string;
  board: BoardHandle;
  /** The rail: cards dock in the list instead of floating on the board. */
  compact: boolean;
  detail: () => SystemDetail | null;
  chat: () => SystemChat;
  /** Why comments can't be added or sent right now (an old version is on show), or null. */
  locked: () => string | null;
  /** The entry selected on the page, so a keyboard user can comment on it from the list. */
  selectedEntry: () => string | null;
  /** The section chosen in the panel: in the rail the keyboard picks any of its entries to comment on. */
  section: () => SystemSection;
  /** Bring the board forward (it may be behind the Screens view or the phone's Sections view). */
  showBoard: () => void;
  /** A send went out: the page reads the system again (a new chat may be linked now). */
  afterSend: () => void;
};

export type BoardCommentsHandle = {
  /** The list, for the panel. */
  el: HTMLElement;
  /** Read the comments again (a `comments` change event, or the page loaded). */
  refresh: () => Promise<void>;
  /** The system, the lock or the selection changed: repaint. */
  sync: () => void;
  dispose: () => void;
};

/** Every system page shares one store: a draft outlives the page that held it, for as long as Design Chamber is open. */
const drafts = createDraftStore();

const PIN = 24;
const MISS_MS = 2600;

type Card =
  | { kind: 'new'; entry: string; el: HTMLElement; area: HTMLTextAreaElement; fallback: { x: number; y: number } }
  | { kind: 'thread'; id: string; el: HTMLElement; area: HTMLTextAreaElement; fallback: { x: number; y: number }; setStatus: (comment: SystemComment) => void };

export const mountBoardComments = (options: BoardCommentsOptions): BoardCommentsHandle => {
  const { id, board } = options;
  let comments: SystemComment[] = [];
  let damaged = false;
  let load: 'loading' | 'ready' | 'error' = 'loading';
  let loadError = '';
  let ticket = 0;
  let commenting = false;
  let card: Card | null = null;
  let expanded: boolean | null = null;
  let showResolved = false;
  let sendingAll = false;
  let sendError: string | null = null;
  const inFlight = new Set<string>();
  let missTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const doc = board.el.ownerDocument;
  /** The choice in "Comment on" (an entry key of the chosen section), kept across repaints. */
  let chosen: string | null = null;
  /** The page's selection last time, so a new click on the board moves the choice but a repaint doesn't undo the user's pick. */
  let lastSelected: string | null = null;

  // ------------------------------------------------------------ the board's own parts
  const pins = new Map<string, HTMLButtonElement>();
  const tempPin = h('span', { class: 'dc-pin dc-temp-pin dc-bc-pin', 'aria-hidden': 'true', hidden: true }, '+');
  const hint = h('p', { class: 'dc-bc-hint', role: 'status', hidden: true });
  const toggle = btn({ label: 'Comment', variant: 'outline', size: options.compact ? 'xs' : 'sm', icon: 'comment', onClick: () => setCommenting(!commenting) });
  toggle.el.classList.add('dc-bc-toggle');
  toggle.el.setAttribute('aria-pressed', 'false');
  // In the rail the board is too short to carry the hint as well: it goes on the list, right under the board.
  const tools = h('div', { class: 'dc-bc-tools' }, options.compact ? null : hint, toggle.el);
  board.pinLayer.append(tools, tempPin);
  board.pinLayer.setAttribute('role', 'group');
  board.pinLayer.setAttribute('aria-label', 'Comments on the board');

  // ------------------------------------------------------------ the list's parts
  const headCount = h('span', { class: 'dc-bc-count dc-muted' });
  const headButton = h(
    'button',
    { type: 'button', class: 'dc-bc-headbtn', 'aria-expanded': 'false', 'aria-controls': `dc-bc-body-${id}`, onClick: () => { expanded = !isExpanded(); paintList(); } },
    h('span', { class: 'dc-syspg-chev', 'aria-hidden': 'true' }),
    h('span', { class: 'dc-bc-title' }, 'Comments'),
    headCount,
  );
  const commentOn = h('div', { class: 'dc-bc-on' });
  const body = h('div', { class: 'dc-bc-body', id: `dc-bc-body-${id}` });
  const dock = h('div', { class: 'dc-bc-dock' });
  // The damaged-file banner sits outside the folding body, so it is seen however the list is folded.
  const damagedHost = h('div', { class: 'dc-bc-damaged' });
  const el = h('section', { class: 'dc-bc', 'aria-label': 'Comments on the board' }, h('div', { class: 'dc-bc-head' }, headButton, commentOn), options.compact ? hint : null, damagedHost, dock, body);

  // "Comment on …": the keyboard's way to add one. Built once and only updated, so a repaint between pointer down and
  // click (a value box losing focus repaints the panel) never swallows the press.
  const commentOnButton = btn({ label: 'Write comment', variant: 'outline', size: 'sm', icon: 'plus', onClick: () => startFromKeyboard() });
  const chooserHost = h('div', { class: 'dc-bc-chooser' });
  // Entry rows in the sections are chosen by pointer, so the keyboard picks any entry of the chosen section here.
  const chooser = mountSelect(chooserHost, { label: 'Comment on', value: null, options: [], searchable: true, searchPlaceholder: 'Find an entry', onChange: (entry) => { chosen = entry; paintCommentOn(); } });
  commentOn.append(chooserHost, commentOnButton.el);
  /** Where a card goes: on the board, or docked under it in the rail. */
  const cardHost = (): HTMLElement => (options.compact ? dock : board.pinLayer);

  const rows = (): BoardCommentRow[] => boardCommentRows(comments, options.detail());
  const isExpanded = (): boolean => expanded ?? (comments.length > 0 || commenting || damaged || load !== 'ready');

  /** Where focus goes when what had it went away: the comment's pin when it shows, else its row, else the Comment switch. */
  const focusComment = (commentId: string | null): void => {
    if (disposed) return;
    if (commentId !== null) {
      const pin = pins.get(commentId);
      if (pin !== undefined && !pin.hidden && pin.isConnected && pin.getClientRects().length > 0) return pin.focus();
      const row = el.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(`row:${commentId}`)}"]`);
      if (row !== null && row.getClientRects().length > 0) return row.focus();
    }
    toggle.el.focus();
  };

  /** The comment after this one in number order (or the one before, for the last), for focus after a delete. */
  const neighbourOf = (commentId: string): string | null => {
    const ordered = rows().map((row) => row.comment.id);
    const at = ordered.indexOf(commentId);
    if (at === -1) return null;
    return ordered[at + 1] ?? ordered[at - 1] ?? null;
  };

  // ------------------------------------------------------------ loading
  const refresh = async (): Promise<void> => {
    ticket += 1;
    const mine = ticket;
    try {
      const answer = await client.systemComments.list(id);
      if (disposed || mine !== ticket) return;
      comments = answer.comments;
      damaged = answer.damaged === true;
      load = 'ready';
    } catch (error) {
      if (disposed || mine !== ticket) return;
      // A refresh that fails keeps the list it had; only a first load shows the error.
      if (load !== 'ready') {
        load = 'error';
        loadError = errorText(error);
      } else toast('error', `Couldn’t refresh the comments. ${errorText(error)}`);
    }
    paintAll();
  };

  const replace = (next: SystemComment): void => {
    comments = comments.some((comment) => comment.id === next.id) ? comments.map((comment) => (comment.id === next.id ? next : comment)) : [...comments, next];
  };

  // ------------------------------------------------------------ comment mode
  function setCommenting(on: boolean): void {
    if (on && options.locked() !== null) return;
    commenting = on;
    board.setCommentMode(on);
    toggle.el.setAttribute('aria-pressed', String(on));
    toggle.set({ label: on ? 'Done' : 'Comment', icon: on ? 'check' : 'comment' });
    clearTimeout(missTimer);
    hint.hidden = !on;
    hint.textContent = on ? 'Click an entry to comment on it. Esc to stop.' : '';
    paintList();
  }

  board.setCommentHandler((entry, at) => {
    if (!commenting) return;
    if (entry === undefined || !isBoardEntryKey(entry)) {
      hint.textContent = 'That spot isn’t an entry. Click a swatch, a type style or a component.';
      clearTimeout(missTimer);
      missTimer = setTimeout(() => {
        if (commenting) hint.textContent = 'Click an entry to comment on it. Esc to stop.';
      }, MISS_MS);
      return;
    }
    openComposer(entry, at);
  });

  // ------------------------------------------------------------ cards
  const textarea = (label: string, value: string, placeholder: string): HTMLTextAreaElement => {
    const area = h('textarea', { class: 'oc-sdk oc-sdk-input dc-textarea', rows: 3, 'aria-label': label, placeholder });
    area.value = value;
    return area;
  };

  /** Keep what the card holds and take it away; focus goes back to what opened it (or the given element). */
  const closeCard = (returnTo?: HTMLElement | null): void => {
    if (card === null) return;
    const closing = card;
    card = null;
    if (closing.kind === 'new') drafts.keep(boardComposerKey(id, closing.entry), unsavedText(closing.area.value));
    else drafts.keep(boardThreadKey(id, closing.id), unsavedText(closing.area.value, comments.find((comment) => comment.id === closing.id)?.body ?? ''));
    closing.el.remove();
    tempPin.hidden = true;
    paintPins();
    if (returnTo === null) return;
    if (returnTo !== undefined) return returnTo.focus();
    // Escape, Cancel or the close button: back to the comment's pin (or row), or to the Comment switch.
    focusComment(closing.kind === 'thread' ? closing.id : null);
  };

  const placeCard = (): void => {
    if (card === null) return;
    const layout = board.layout();
    const box = { width: board.el.clientWidth, height: board.el.clientHeight };
    let at = card.fallback;
    if (layout !== null) {
      const entry = card.kind === 'new' ? card.entry : comments.find((comment) => comment.id === (card as { id: string }).id)?.entry;
      const rect = entry === undefined ? undefined : layout.rects.get(entry);
      if (rect !== undefined) {
        // A new comment's pin goes after the ones the entry already has; an open thread sits on its own pin.
        const index = card.kind === 'new' ? comments.filter((comment) => comment.entry === entry).length : 0;
        const pin = card.kind === 'thread' ? pins.get(card.id) : undefined;
        const spot = pin !== undefined && !pin.hidden ? { x: pin.offsetLeft - layout.frame.x, y: pin.offsetTop - layout.frame.y } : entrySpot(rect, layout.scroll, index, PIN);
        at = { x: layout.frame.x + spot.x, y: layout.frame.y + spot.y };
      }
    }
    if (card.kind === 'new') {
      tempPin.hidden = false;
      tempPin.style.left = `${at.x}px`;
      tempPin.style.top = `${at.y}px`;
    }
    if (options.compact) return;
    const place = cardPlacement(at, { width: card.el.offsetWidth || 300, height: card.el.offsetHeight || 180 }, box);
    card.el.style.left = `${place.left}px`;
    card.el.style.top = `${place.top}px`;
  };

  const cardFoot = (...children: Array<HTMLElement | null>): HTMLElement => h('div', { class: 'dc-pop-foot' }, ...children);

  function openComposer(entry: string, at: { x: number; y: number }): void {
    closeCard(null);
    const detail = options.detail();
    const label = detail === null ? { tag: 'entry', text: entry } : entryLabel(detail, entry);
    const key = boardComposerKey(id, entry);
    const area = textarea(`Comment on ${label.text || entry}`, drafts.get(key) ?? '', 'What should change here?');
    const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    const cancel = btn({
      label: 'Cancel',
      variant: 'ghost',
      size: 'sm',
      onClick: () => {
        // Cancel is the one way to throw the words away.
        area.value = '';
        drafts.drop(key);
        closeCard();
      },
    });
    const submit = btn({ label: 'Add comment', variant: 'default', size: 'sm', onClick: () => void add() });
    const add = async (): Promise<void> => {
      const problem = commentBodyProblem(area.value);
      failure.hidden = problem === null;
      if (problem !== null) {
        failure.textContent = problem;
        area.focus();
        return;
      }
      submit.set({ loading: true });
      cancel.set({ disabled: true });
      area.disabled = true;
      try {
        const { comment } = await client.systemComments.add(id, { entry, body: area.value.trim() });
        replace(comment);
        drafts.drop(key);
        area.value = '';
        load = 'ready';
        closeCard(null);
        paintAll();
        focusComment(comment.id);
      } catch (error) {
        failure.textContent = `Couldn’t add the comment. ${errorText(error)} Your text is still here.`;
        failure.hidden = false;
        submit.set({ loading: false });
        cancel.set({ disabled: false });
        area.disabled = false;
        area.focus();
      }
    };
    area.addEventListener('input', () => drafts.keep(key, unsavedText(area.value)));
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void add();
      }
    });
    const cardEl = h(
      'div',
      { class: 'dc-pop dc-composer dc-bc-card', 'data-docked': String(options.compact), role: 'dialog', 'aria-label': `New comment on ${label.text || entry}` },
      h('div', { class: 'dc-pop-head' }, h('span', { class: 'dc-pop-title' }, 'Comment on'), h('code', { class: 'dc-chip-code' }, label.tag)),
      label.text ? h('p', { class: 'dc-pop-snippet' }, label.text) : null,
      area,
      failure,
      cardFoot(h('span', { class: 'dc-pop-hint' }, `${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵'} to add`), h('span', { class: 'dc-pop-actions' }, cancel.el, submit.el)),
    );
    card = { kind: 'new', entry, el: cardEl, area, fallback: at };
    wireCard(cardEl);
    cardHost().append(cardEl);
    if (options.compact) cardEl.scrollIntoView({ block: 'nearest' });
    trackEntries();
    placeCard();
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function openThread(commentId: string): void {
    const found = comments.find((comment) => comment.id === commentId);
    if (found === undefined) return;
    closeCard(null);
    const row = rows().find((candidate) => candidate.comment.id === commentId);
    const key = boardThreadKey(id, commentId);
    let current = found;
    const area = textarea(`Comment ${row?.number ?? ''} text`, drafts.get(key) ?? current.body, '');
    const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    const badgeHost = h('span');
    const paintBadge = (): void => {
      badgeHost.replaceChildren();
      mountBadge(badgeHost, { label: commentStatusLabel(current.status), tone: current.status === 'open' ? 'primary' : current.status === 'sent' ? 'info' : 'neutral' });
    };
    paintBadge();

    const guard = async (button: BtnHandle, action: () => Promise<void>): Promise<void> => {
      button.set({ loading: true });
      failure.hidden = true;
      try {
        await action();
      } catch (error) {
        failure.textContent = errorText(error);
        failure.hidden = false;
      } finally {
        button.set({ loading: false });
      }
      // A busy button can't hold focus, and Send this hides once sent: keep focus in the card, so Escape still closes it.
      if (card?.el === cardEl && !cardEl.contains(doc.activeElement)) {
        if (button.el.isConnected && !button.el.hidden && !button.el.disabled) button.el.focus();
        else area.focus();
      }
    };
    const checked = (): string | null => {
      const problem = commentBodyProblem(area.value);
      if (problem !== null) {
        failure.textContent = problem;
        failure.hidden = false;
      }
      return problem;
    };
    /** Save the edited words first, when they changed, so a send or a status change never drops them. */
    const saveIfEdited = async (): Promise<void> => {
      if (area.value.trim() === current.body.trim()) return;
      const { comment } = await client.systemComments.update(id, commentId, { body: area.value.trim() });
      current = comment;
      replace(comment);
      drafts.drop(key);
    };

    const save = btn({
      label: 'Save',
      variant: 'default',
      size: 'sm',
      disabled: area.value.trim() === current.body.trim(),
      onClick: () => {
        if (checked() !== null) return;
        void guard(save, async () => {
          await saveIfEdited();
          save.set({ disabled: true });
          paintAll();
          area.focus();
        });
      },
    });
    area.addEventListener('input', () => {
      save.set({ disabled: area.value.trim() === current.body.trim() });
      drafts.keep(key, unsavedText(area.value, current.body));
    });

    const sendThis = btn({
      label: 'Send this',
      variant: 'outline',
      size: 'sm',
      icon: 'send',
      title: 'Send only this comment to the chat',
      onClick: () => {
        if (checked() !== null) return;
        void guard(sendThis, async () => {
          const problem = sendOneProblem(comments.find((comment) => comment.id === commentId));
          if (problem !== null) throw new Error(problem);
          if (options.locked() !== null) throw new Error(options.locked() ?? '');
          await saveIfEdited();
          await send([commentId], row?.number ?? null);
        });
      },
    });

    const toggleStatus = btn({
      label: current.status === 'resolved' ? 'Reopen' : 'Resolve',
      variant: 'outline',
      size: 'sm',
      icon: current.status === 'resolved' ? 'restore' : 'check',
      onClick: () =>
        void guard(toggleStatus, async () => {
          await saveIfEdited();
          const { comment } = await client.systemComments.update(id, commentId, { status: current.status === 'resolved' ? 'open' : 'resolved' });
          current = comment;
          replace(comment);
          setStatus(comment);
          paintAll();
        }),
    });

    // Deleting can't be undone, so it takes a second press; the button says so and goes back after a moment.
    let armed = false;
    let armTimer: ReturnType<typeof setTimeout> | undefined;
    const remove = btn({
      label: 'Delete',
      variant: 'ghost',
      size: 'sm',
      icon: 'trash',
      onClick: () => {
        if (!armed) {
          armed = true;
          remove.set({ label: 'Delete comment?' });
          remove.el.dataset.variant = 'destructive';
          armTimer = setTimeout(() => {
            armed = false;
            remove.set({ label: 'Delete' });
            remove.el.dataset.variant = 'ghost';
          }, 4000);
          return;
        }
        clearTimeout(armTimer);
        void guard(remove, async () => {
          const next = neighbourOf(commentId);
          await client.systemComments.remove(id, commentId);
          comments = comments.filter((comment) => comment.id !== commentId);
          drafts.drop(key);
          area.value = '';
          closeCard(null);
          paintAll();
          focusComment(next);
          toast('success', row ? `Comment ${row.number} deleted.` : 'Comment deleted.');
        });
      },
    });

    const close = iconBtn({ icon: 'close', label: 'Close comment', size: 'sm', onClick: () => closeCard() });
    const gone = row?.gone === true;
    const cardEl = h(
      'div',
      { class: 'dc-pop dc-thread dc-bc-card', 'data-docked': String(options.compact), role: 'dialog', 'aria-label': `Comment ${row?.number ?? ''}` },
      h('div', { class: 'dc-pop-head' }, h('span', { class: 'dc-pin-badge', 'data-status': current.status, 'aria-hidden': 'true' }, row ? boardPinGlyph(row) : ''), badgeHost, h('span', { class: 'dc-pop-where' }, row?.where ?? ''), close),
      gone ? h('p', { class: 'dc-pop-note' }, 'This entry isn’t in the system any more. The comment stays, and is still sent.') : null,
      area,
      failure,
      cardFoot(remove.el, h('span', { class: 'dc-pop-actions' }, toggleStatus.el, sendThis.el, save.el)),
    );
    const setStatus = (comment: SystemComment): void => {
      current = comment;
      paintBadge();
      cardEl.querySelector('.dc-pin-badge')?.setAttribute('data-status', comment.status);
      toggleStatus.set({ label: comment.status === 'resolved' ? 'Reopen' : 'Resolve', icon: comment.status === 'resolved' ? 'restore' : 'check' });
      sendThis.el.hidden = comment.status !== 'open' || options.locked() !== null;
    };
    setStatus(current);
    const spot = pins.get(commentId);
    const fallback = spot && !spot.hidden ? { x: spot.offsetLeft, y: spot.offsetTop } : { x: 16, y: 16 };
    card = { kind: 'thread', id: commentId, el: cardEl, area, fallback, setStatus };
    wireCard(cardEl);
    cardHost().append(cardEl);
    if (options.compact) cardEl.scrollIntoView({ block: 'nearest' });
    placeCard();
    area.focus();
  }

  /** A card takes its own clicks and keys: Escape closes it (keeping the words), nothing reaches the board under it. */
  const wireCard = (cardEl: HTMLElement): void => {
    cardEl.addEventListener('pointerdown', (event) => event.stopPropagation());
    cardEl.addEventListener('click', (event) => event.stopPropagation());
    cardEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeCard();
      }
    });
  };

  // ------------------------------------------------------------ the send
  const send = async (ids: string[], number: number | null): Promise<void> => {
    const busy = ids.find((candidate) => inFlight.has(candidate));
    if (busy !== undefined) throw new Error(ids.length === 1 ? 'That comment is already on its way to the chat.' : 'One of these comments is already on its way. Try again in a moment.');
    for (const candidate of ids) inFlight.add(candidate);
    paintList();
    try {
      const result = await sendSystemComments(id, options.chat(), ids);
      const copy = boardSendResult({ outcome: result.outcome, sent: result.commentIds.length, omitted: result.omitted.length, number, markFailed: result.markFailed });
      toast(copy.kind, copy.message);
      options.afterSend();
      await refresh();
      if (card?.kind === 'thread') {
        const now = comments.find((comment) => comment.id === (card as { id: string }).id);
        if (now !== undefined) card.setStatus(now);
      }
    } finally {
      for (const candidate of ids) inFlight.delete(candidate);
      paintList();
    }
  };

  const sendAll = async (): Promise<void> => {
    const open = comments.filter((comment) => comment.status === 'open').map((comment) => comment.id);
    sendingAll = true;
    sendError = null;
    paintList();
    try {
      await send(open, open.length === 1 ? (rows().find((row) => row.comment.id === open[0])?.number ?? null) : null);
    } catch (error) {
      sendError = `Couldn’t send. ${errorText(error)} Your comments are still here.`;
    } finally {
      sendingAll = false;
      paintList();
    }
  };

  const sendRow = async (row: BoardCommentRow): Promise<void> => {
    try {
      await send([row.comment.id], row.number);
    } catch (error) {
      toast('error', `Couldn’t send comment ${row.number}. ${errorText(error)} It is still open.`);
    }
  };

  const setRowStatus = async (row: BoardCommentRow, status: 'open' | 'resolved'): Promise<void> => {
    try {
      const { comment } = await client.systemComments.update(id, row.comment.id, { status });
      replace(comment);
      if (card?.kind === 'thread' && card.id === comment.id) card.setStatus(comment);
      paintAll();
    } catch (error) {
      toast('error', `Couldn’t update comment ${row.number}. ${errorText(error)}`);
    }
  };

  // ------------------------------------------------------------ painting
  const trackEntries = (): void => {
    const entries = rows().filter((row) => !row.gone).map((row) => row.comment.entry);
    if (card?.kind === 'new') entries.push(card.entry);
    board.trackEntries(entries);
  };

  function paintPins(layout: BoardLayout | null = board.layout()): void {
    const locked = options.locked() !== null;
    board.pinLayer.dataset.locked = String(locked);
    const all = rows();
    const keep = new Set(all.map((row) => row.comment.id));
    for (const [commentId, pin] of pins) {
      if (keep.has(commentId)) continue;
      pin.remove();
      pins.delete(commentId);
    }
    const spots = layout === null ? [] : boardPinSpots(all, layout.rects, layout.scroll, layout.frame, PIN);
    const spotOf = new Map(spots.map((spot) => [spot.id, spot]));
    for (const row of all) {
      let pin = pins.get(row.comment.id);
      if (pin === undefined) {
        const commentId = row.comment.id;
        const created = h('button', { type: 'button', class: 'dc-pin dc-bc-pin' });
        created.addEventListener('pointerdown', (event) => event.stopPropagation());
        created.addEventListener('click', (event) => {
          event.stopPropagation();
          if (card?.kind === 'thread' && card.id === commentId) closeCard();
          else openThread(commentId);
        });
        pins.set(commentId, created);
        pin = created;
      }
      // Only a new pin is placed: moving a node in the DOM takes focus off it. New comments have the highest numbers, so
      // Tab order stays the number order.
      if (!pin.isConnected) board.pinLayer.insertBefore(pin, tempPin);
      const spot = spotOf.get(row.comment.id);
      pin.textContent = boardPinGlyph(row);
      pin.dataset.status = row.comment.status;
      pin.setAttribute('aria-label', boardPinLabel(row));
      pin.title = `${row.number}. ${row.where}`;
      pin.dataset.open = String(card?.kind === 'thread' && card.id === row.comment.id);
      pin.hidden = locked || spot === undefined || !spot.inView || layout === null;
      if (spot !== undefined && layout !== null) {
        pin.style.left = `${layout.frame.x + spot.x}px`;
        pin.style.top = `${layout.frame.y + spot.y}px`;
      }
    }
    if (card !== null) placeCard();
  }

  function paintToggle(): void {
    const locked = options.locked();
    toggle.set({ disabled: locked !== null });
    toggle.el.title = locked ?? (commenting ? 'Stop adding comments' : 'Click an entry on the board to comment on it');
    if (locked !== null && commenting) setCommenting(false);
    if (locked !== null && card !== null) closeCard(null);
  }

  const rowEl = (row: BoardCommentRow): HTMLElement => {
    const { comment, number } = row;
    const resolved = comment.status === 'resolved';
    const sending = inFlight.has(comment.id);
    const main = h(
      'button',
      {
        type: 'button',
        class: 'dc-comment-main',
        'data-focus-key': `row:${comment.id}`,
        'aria-label': row.gone ? `Comment ${number}, on an entry that’s gone. Open it` : `Show comment ${number} on the board`,
      },
      h('span', { class: 'dc-pin-badge', 'data-status': comment.status, 'aria-hidden': 'true' }, boardPinGlyph(row)),
      h(
        'span',
        { class: 'dc-comment-text' },
        h('span', { class: 'dc-comment-where' }, row.where, comment.status === 'sent' ? h('span', { class: 'dc-bc-state' }, 'Sent') : null),
        h('span', { class: 'dc-comment-body' }, comment.body),
      ),
    );
    main.addEventListener('click', () => {
      options.showBoard();
      if (!row.gone) board.focusEntry(comment.entry);
      openThread(comment.id);
    });
    const sendNow =
      comment.status !== 'open' || options.locked() !== null
        ? null
        : iconBtn({ icon: 'send', label: `Send comment ${number} to chat`, size: 'sm', disabled: sending, onClick: () => void sendRow(row) });
    if (sendNow && sending) sendNow.setAttribute('aria-busy', 'true');
    sendNow?.setAttribute('data-focus-key', `send:${comment.id}`);
    const statusBtn = iconBtn({
      icon: resolved ? 'restore' : 'check',
      label: resolved ? `Reopen comment ${number}` : `Mark comment ${number} resolved`,
      size: 'sm',
      onClick: () => void setRowStatus(row, resolved ? 'open' : 'resolved'),
    });
    statusBtn.setAttribute('data-focus-key', `status:${comment.id}`);
    return h('li', { class: 'dc-comment', 'data-gone': row.gone ? 'true' : null, 'data-status': comment.status }, main, sendNow, statusBtn);
  };

  function paintList(): void {
    const open = isExpanded();
    headButton.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    const counts = boardCommentCounts(comments);
    headCount.textContent = load !== 'ready' ? '' : comments.length === 0 ? (damaged ? DAMAGED_COUNT : 'None yet') : [counts.open > 0 ? `${counts.open} open` : null, counts.sent > 0 ? `${counts.sent} sent` : null, counts.resolved > 0 ? `${counts.resolved} resolved` : null].filter(Boolean).join(' · ');

    paintCommentOn();
    damagedHost.replaceChildren();
    if (load === 'ready' && damaged) damagedHost.append(banner({ tone: 'warning', title: DAMAGED_TITLE, body: comments.length === 0 ? DAMAGED_NONE : DAMAGED_BODY }));

    // A repaint rebuilds the rows: focus on one of them comes back to the same control (or its row, once the control is gone).
    const active = doc.activeElement;
    const focusKey = active instanceof HTMLElement && body.contains(active) ? (active.dataset.focusKey ?? null) : null;
    body.replaceChildren();
    if (load === 'loading') {
      body.append(loadingRow('Loading comments…'));
      return;
    }
    if (load === 'error') {
      body.append(banner({ tone: 'error', title: 'Comments didn’t load', body: loadError || 'The local service didn’t answer.', action: { label: 'Try again', onClick: () => { load = 'loading'; paintList(); void refresh(); } } }));
      return;
    }
    if (comments.length === 0) {
      if (!damaged) body.append(h('p', { class: 'dc-bc-empty dc-muted' }, EMPTY_COMMENTS));
      return;
    }
    const split = splitRows(rows());
    const list = h('ul', { class: 'dc-comment-items dc-bc-list' }, ...split.live.map(rowEl));
    body.append(list);
    if (split.resolved.length > 0) {
      body.append(
        h(
          'button',
          { type: 'button', class: 'dc-bc-more', 'aria-expanded': String(showResolved), onClick: () => { showResolved = !showResolved; paintList(); } },
          showResolved ? 'Hide resolved' : `Show ${split.resolved.length} resolved`,
        ),
      );
      if (showResolved) body.append(h('ul', { class: 'dc-comment-items dc-bc-list', 'data-resolved': 'true' }, ...split.resolved.map(rowEl)));
    }
    const state = sendAllState(comments, options.chat().sessionId !== null, options.locked());
    const submit = btn({ label: state.label, variant: 'default', size: 'sm', icon: 'send', loading: sendingAll, disabled: !state.enabled || sendingAll, onClick: () => void sendAll() });
    submit.el.classList.add('dc-block');
    body.append(
      h(
        'div',
        { class: 'dc-bc-foot' },
        sendError === null ? null : h('p', { class: 'dc-form-error', role: 'alert' }, sendError),
        submit.el,
        state.reason === null ? null : h('p', { class: 'dc-foot-note' }, state.reason),
      ),
    );
    if (focusKey !== null && !body.contains(doc.activeElement)) {
      const [, commentId = ''] = focusKey.split(':');
      const target = body.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]:not(:disabled)`) ?? body.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(`row:${commentId}`)}"]`);
      target?.focus();
    }
  }

  /** The entries the keyboard can comment on now: every entry of the chosen section, the selected one first in line. */
  function paintCommentOn(): void {
    const current = options.detail();
    const detail = load === 'ready' && options.locked() === null ? current : null;
    const entries = detail === null ? [] : entriesOf(detail, options.section());
    const selected = options.selectedEntry();
    if (selected !== null && selected !== lastSelected && entries.includes(selected)) chosen = selected;
    lastSelected = selected;
    if (chosen === null || !entries.includes(chosen)) chosen = selected !== null && entries.includes(selected) ? selected : (entries[0] ?? null);
    chooser.update({ value: chosen, options: detail === null ? [] : entries.map((entry) => ({ id: entry, label: entryLabel(detail, entry).text || entry })) });
    commentOn.hidden = entries.length === 0;
    commentOnButton.set({ title: 'Write a comment on the chosen entry' });
  }

  /** "Comment on …" pressed: the composer for the rail's chosen entry, or the page's selected one. */
  function startFromKeyboard(): void {
    const entry = chosen;
    const detail = options.detail();
    if (entry === null || detail === null || !entryInSystem(detail, entry)) return;
    options.showBoard();
    board.focusEntry(entry);
    openComposer(entry, { x: 16, y: 16 });
  }

  function paintAll(): void {
    if (disposed) return;
    paintToggle();
    trackEntries();
    paintPins();
    paintList();
  }

  const stopLayout = board.onLayout((layout) => paintPins(layout));
  // Escape always has a way out: a card open with focus outside it (on the page body after a click elsewhere) closes, and
  // with no card it leaves comment mode. The card's own Escape is handled on the card and doesn't reach here.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (card !== null) {
      event.preventDefault();
      closeCard();
      return;
    }
    if (!commenting) return;
    setCommenting(false);
    toggle.el.focus();
  };
  doc.addEventListener('keydown', onKey);

  paintAll();
  void refresh();

  return {
    el,
    refresh,
    sync: paintAll,
    dispose: () => {
      disposed = true;
      closeCard(null);
      clearTimeout(missTimer);
      chooser.dispose();
      stopLayout();
      doc.removeEventListener('keydown', onKey);
      board.setCommentHandler(null);
      board.setCommentMode(false);
      el.remove();
    },
  };
};
