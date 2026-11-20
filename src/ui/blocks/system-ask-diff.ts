// SystemAsk, the diff (documentation/specs/phase-2-5-technical.md §8.12): what the agent proposes to
// write, part by part, with a switch per part, the files and their patches, the two previews, and a
// footer that stays put: Decline and Approve, and under Decline the three ways out (Describe only
// instead, Stop, Back). Everything shown comes from the service (the proposal and the system's name),
// never from the block's arguments, which only say which proposal to read.
//
// An answer is built from the proposal already loaded and handed to the host inside the click. Stop is
// the one action that calls the service first: it removes the draft, and only then says so in the chat.

import { mountBanner, mountButton, mountSpinner, mountSwitch, type ButtonHandle } from '@openchamber/sdk/ui';

import { SYSTEM_ASK_POLL_MS } from '../../shared/limits.ts';
import type { ProposalPartName, ProposalView, SystemQuestionSet } from '../../shared/types.ts';
import { isServiceError } from '../../guest/service-client.ts';
import { append, h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import type { SystemAskBlock } from '../model/block-args.ts';
import {
  LOADING_PROPOSAL,
  SERVICE_DOWN,
  PART_LABELS,
  answeredView,
  approveAnswer,
  approveView,
  describeAnswer,
  describeOffered,
  diffTitle,
  fileRowText,
  isCurrent,
  listedFiles,
  partStat,
  patchView,
  previewButtons,
  proposalStateSentence,
  stopAnswer,
  systemName,
  undoWindow,
  unlistedUses,
  usesLine,
  type CurrentProposal,
} from '../model/system-ask-model.ts';
import type { BlockContext, BlockView } from './block-view.ts';
import { cannotTake, frame, primaryOf, refusedLine, sendAnswer, startRefetch, uid } from './system-ask-shared.ts';

type Diff = Extract<SystemAskBlock, { kind: 'diff' }>;
type Load = 'loading' | 'ready' | 'down';
type Disposable = { dispose: () => void };

const UNDO_LINE = 'Design Chamber brought the build back. Tell the agent to carry on.';

export const mountDiff = (root: HTMLElement, ctx: BlockContext, ask: Diff, set: SystemQuestionSet, answered: string | null): BlockView => {
  let load: Load = answered === null ? 'loading' : 'ready';
  let view: ProposalView | null = null;
  let viewKey = '';
  let name: string | null = null;
  let nameTried = false;
  let on = new Set<ProposalPartName>();
  let partsKnown = false;
  const open = new Set<string>();
  let declining = false;
  let busy = false;
  let refused = false;
  let stopError: string | null = null;
  let cannot: string | null = null;
  let answeredText: string | null = answered;
  /** Stop worked in Design Chamber but the chat did not take the answer. */
  let stoppedText: string | null = null;
  let undo: { id: string; until: number } | null = null;
  let undone = false;
  /** An Undo request is out: a second click waits for it. */
  let undoing = false;
  let undoButton: ButtonHandle | null = null;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let owned: Disposable[] = [];
  let footOwned: Disposable[] = [];
  let footEl: HTMLElement | null = null;
  let bodyEl: HTMLElement | null = null;
  let stopRefetch: (() => void) | null = null;
  let disposed = false;

  const title = (): string => systemName(name, ask.systemId);
  const current = (): CurrentProposal | null => (isCurrent(view) ? view : null);

  // ---------------------------------------------------------------- the footer

  const slotButton = (label: string, variant: 'default' | 'outline' | 'destructive', onClick: () => void, state: { disabled?: boolean; loading?: boolean; primary?: boolean } = {}): HTMLElement => {
    const slot = h('span', { class: 'dcb-ask-btn' });
    const handle: ButtonHandle = mountButton(slot, { label, variant, size: 'default', disabled: state.disabled === true, loading: state.loading === true, onClick });
    footOwned.push(handle);
    if (state.primary) primaryOf(slot);
    return slot;
  };

  const submit = (text: string): void => {
    if (busy || cannot !== null || answeredText !== null) return;
    // Inside the click: the answer reaches the host before anything else happens.
    const sent = sendAnswer(ctx, text);
    busy = true;
    refused = false;
    paintFoot();
    void sent.then((outcome) => {
      busy = false;
      if (outcome === 'sent') {
        answeredText = text;
        stopRefetch?.();
        stopRefetch = null;
        renderAll();
      } else if (outcome === 'host-rejected') {
        cannot = text;
        renderAll();
      } else {
        refused = true;
        paintFoot();
      }
    });
  };

  const stop = async (proposal: CurrentProposal): Promise<void> => {
    if (busy || cannot !== null || answeredText !== null) return;
    busy = true;
    stopError = null;
    refused = false;
    paintFoot();
    try {
      const result = await ctx.client.stopBuild(ask.systemId, proposal.proposal.id);
      undo = { id: result.undoId, until: Date.parse(result.until) };
      scheduleUndoExpiry();
    } catch (error) {
      busy = false;
      // A 409 has its own sentence (the build already moved on); nothing is sent to the chat.
      stopError = isServiceError(error, 'conflict') ? error.message : 'Couldn’t stop the build. Try again, or tell the agent in the chat.';
      paintFoot();
      return;
    }
    const text = stopAnswer(ask.systemId, title(), proposal.proposal.id);
    const outcome = await sendAnswer(ctx, text);
    busy = false;
    stopRefetch?.();
    stopRefetch = null;
    if (outcome === 'sent') answeredText = text;
    else stoppedText = text;
    renderAll();
  };

  /** One timer for the Undo window: when it ends the card repaints and the button leaves. */
  const clearUndoTimer = (): void => {
    if (undoTimer !== null) clearTimeout(undoTimer);
    undoTimer = null;
  };

  const scheduleUndoExpiry = (): void => {
    clearUndoTimer();
    if (undo === null || undone) return;
    const offer = undoWindow(undo.until, Date.now());
    if (!offer.open) return;
    undoTimer = setTimeout(() => {
      undoTimer = null;
      renderAll();
    }, offer.repaintIn);
  };

  const undoStop = (): void => {
    const pending = undo;
    if (pending === null || undone || undoing) return;
    undoing = true;
    undoButton?.update({ disabled: true, loading: true });
    ctx.client.undoStop(pending.id).then(
      () => {
        undoing = false;
        undone = true;
        clearUndoTimer();
        renderAll();
      },
      () => {
        undoing = false;
        undoButton?.update({ disabled: false, loading: false });
        ctx.toast('error', 'Couldn’t bring the build back. It may have been too long.');
      },
    );
  };

  const paintFoot = (): void => {
    if (!footEl) return;
    for (const handle of footOwned) handle.dispose();
    footOwned = [];
    const proposal = current();
    const approve = approveView(view, on, ask.proposalId, busy);
    const reason = proposal === null ? null : approve.reason;
    if (cannot !== null) {
      const fallback = cannotTake(ctx, cannot);
      footOwned.push(fallback);
      footEl.replaceChildren(fallback.el);
      return;
    }
    const lines: Array<HTMLElement | null> = [
      reason !== null && !declining ? h('p', { class: 'dcb-ask-reason', role: 'status' }, reason) : null,
      stopError !== null ? h('p', { class: 'dcb-ask-problem', role: 'alert' }, stopError) : null,
      refused ? refusedLine() : null,
    ];
    const actions = declining && proposal !== null
      ? [
          describeOffered(proposal) ? slotButton('Describe only instead', 'outline', () => submit(describeAnswer(ask.systemId, proposal.proposal.id)), { disabled: busy }) : null,
          slotButton('Stop', 'destructive', () => void stop(proposal), { disabled: busy }),
          slotButton('Back', 'outline', () => {
            declining = false;
            stopError = null;
            paintFoot();
            footEl?.querySelector<HTMLButtonElement>('button')?.focus();
          }, { disabled: busy }),
        ]
      : [
          slotButton('Decline', 'outline', () => {
            declining = true;
            refused = false;
            paintFoot();
            footEl?.querySelector<HTMLButtonElement>('button')?.focus();
          }, { disabled: proposal === null || busy }),
          slotButton(approve.label, 'default', () => {
            const now = current();
            // The button is off for any proposal that is not the one this card names; so is a click that raced the repaint.
            if (now !== null && approveView(now, on, ask.proposalId).enabled) submit(approveAnswer(ask.systemId, now, on));
          }, { disabled: !approve.enabled, loading: busy && !declining, primary: true }),
        ];
    footEl.replaceChildren(...lines.filter((line): line is HTMLElement => line !== null), h('div', { class: 'dcb-ask-actions' }, ...actions.filter((el): el is HTMLElement => el !== null)));
  };

  // ---------------------------------------------------------------- the body

  const own = <T extends Disposable>(handle: T): T => {
    owned.push(handle);
    return handle;
  };

  const banner = (tone: 'info' | 'warning', text: string, action?: { label: string; onClick: () => void }): HTMLElement => {
    const slot = h('div', { class: 'dcb-ask-banner' });
    own(mountBanner(slot, { tone, title: text, action }));
    return slot;
  };

  const partBlock = (proposal: CurrentProposal, index: number): HTMLElement => {
    const part = proposal.proposal.parts[index];
    if (!part) return h('div');
    const switchSlot = h('div', { class: 'dcb-part-switch' });
    const handle = own(
      mountSwitch(switchSlot, {
        label: PART_LABELS[part.name],
        description: partStat(part),
        checked: on.has(part.name),
        disabled: cannot !== null,
        onChange: (checked) => {
          if (checked) on.add(part.name);
          else on.delete(part.name);
          handle.update({ checked });
          paintFoot();
        },
      }),
    );
    const list = h('ul', { class: 'dcb-files' });
    for (const file of listedFiles(part)) {
      const patchId = uid('dcb-patch');
      const patch = patchView(file);
      const panel = h('div', { class: 'dcb-patch', id: patchId, hidden: !open.has(`${part.name}:${file.path}`) }, patch.kind === 'patch' ? h('pre', { class: 'dcb-patch-code', tabindex: 0 }, patch.text) : h('p', { class: 'dcb-patch-note' }, patch.text));
      const button = h(
        'button',
        { type: 'button', class: 'dcb-file', 'aria-expanded': String(!panel.hidden), 'aria-controls': patchId },
        h('span', { class: 'dcb-file-chev' }, icon('chevron', 14)),
        h('span', { class: 'dcb-file-text' }, fileRowText(file)),
      );
      button.addEventListener('click', () => {
        const key = `${part.name}:${file.path}`;
        if (open.has(key)) open.delete(key);
        else open.add(key);
        panel.hidden = !open.has(key);
        button.setAttribute('aria-expanded', String(open.has(key)));
      });
      list.append(h('li', { class: 'dcb-file-item' }, button, panel));
    }
    const uses = unlistedUses(part);
    if (uses) list.append(h('li', { class: 'dcb-uses' }, usesLine(uses)));
    return h('div', { class: 'dcb-part' }, switchSlot, list.childElementCount > 0 ? list : null);
  };

  const previewRow = (proposal: CurrentProposal): HTMLElement | null => {
    const buttons = previewButtons(proposal);
    if (!buttons.livingPage.shown && !buttons.board.shown && buttons.sentence === null) return null;
    const row = h('div', { class: 'dcb-preview-row' });
    const add = (label: string, which: 'living-page-preview' | 'board-preview', enabled: boolean): void => {
      const slot = h('span', { class: 'dcb-ask-btn' });
      own(
        mountButton(slot, {
          label,
          variant: 'outline',
          size: 'sm',
          disabled: !enabled,
          onClick: () => {
            ctx.openSystemPreview(ask.systemId, which).then(
              (outcome) => {
                if (outcome === 'opened') ctx.toast('info', which === 'living-page-preview' ? 'The living page preview is open in the rail.' : 'The board is open in the rail.');
                else if (outcome === 'gone') ctx.toast('error', 'This design system is no longer in your Designs folder.');
                else ctx.toast('error', 'Open Design Chamber from the rail to see the preview.');
              },
              () => ctx.toast('error', 'Couldn’t open the preview. Open Design Chamber from the rail.'),
            );
          },
        }),
      );
      row.append(slot);
    };
    if (buttons.livingPage.shown) add('Preview living page', 'living-page-preview', buttons.livingPage.enabled);
    if (buttons.board.shown) add('Open the board', 'board-preview', buttons.board.enabled);
    return h('div', { class: 'dcb-preview-wrap' }, row, buttons.sentence === null ? null : h('p', { class: 'dcb-ask-fact', role: 'status' }, buttons.sentence));
  };

  const proposalBody = (body: HTMLElement, proposal: CurrentProposal): void => {
    const { proposal: p } = proposal;
    const mode = diffTitle(proposal).mode;
    append(
      body,
      p.summary === '' ? null : h('p', { class: 'dcb-ask-summary' }, p.summary),
      h('dl', { class: 'dcb-meta' }, mode === null ? null : h('dt', null, 'Mode'), mode === null ? null : h('dd', null, mode), h('dt', null, 'Way back'), h('dd', null, p.wayBack.text)),
    );
    if (p.problems.length > 0) {
      const list = h('ul', { class: 'dcb-problems' }, ...p.problems.map((problem) => h('li', null, problem)));
      body.append(h('div', { class: 'dcb-ask-banner' }, banner('warning', 'This proposal has problems.'), list));
    }
    body.append(h('div', { class: 'dcb-parts' }, ...p.parts.map((_, index) => partBlock(proposal, index))));
    const previews = previewRow(proposal);
    if (previews) body.append(previews);
  };

  const answeredBody = (body: HTMLElement, text: string): void => {
    const done = answeredView(text, set);
    body.append(h('p', { class: 'dcb-ask-done' }, icon('check', 16), done.headline));
    if (done.verbatim !== null) body.append(h('p', { class: 'dcb-ask-quote' }, done.verbatim));
    for (const line of done.lines) body.append(h('p', { class: 'dcb-ask-fact' }, line));
    if (done.kind === 'stop') undoBody(body);
  };

  const undoBody = (body: HTMLElement): void => {
    if (undone) {
      body.append(h('p', { class: 'dcb-ask-fact', role: 'status' }, UNDO_LINE));
      return;
    }
    if (undo === null || !undoWindow(undo.until, Date.now()).open) return;
    const slot = h('span', { class: 'dcb-ask-btn' });
    undoButton = own(mountButton(slot, { label: 'Undo', variant: 'outline', size: 'sm', disabled: undoing, loading: undoing, onClick: undoStop }));
    body.append(h('div', { class: 'dcb-ask-actions' }, slot));
  };

  const stoppedBody = (body: HTMLElement, text: string): void => {
    body.append(h('p', { class: 'dcb-ask-done' }, icon('check', 16), 'You stopped this build.'));
    body.append(h('p', { class: 'dcb-ask-fact' }, 'Design Chamber removed the draft, but the chat did not take the message.'));
    const fallback = cannotTake(ctx, text);
    own(fallback);
    body.append(fallback.el);
    undoBody(body);
  };

  const loadingBody = (body: HTMLElement): void => {
    const row = h('p', { class: 'dcb-ask-loading', role: 'status' });
    const spin = h('span', { class: 'dcb-ask-spin' });
    mountSpinner(spin, { size: 'sm' });
    row.append(spin, LOADING_PROPOSAL);
    body.append(row);
  };

  const renderAll = (): void => {
    if (disposed) return;
    const scroll = bodyEl?.scrollTop ?? 0;
    for (const handle of owned) handle.dispose();
    for (const handle of footOwned) handle.dispose();
    owned = [];
    footOwned = [];
    undoButton = null;
    const proposal = current();
    const settled = answeredText !== null || stoppedText !== null;
    const head = proposal ? diffTitle(proposal) : { target: 'Proposed changes', mode: null };
    const f = frame({
      icon: 'layers',
      title: settled ? 'Proposed changes' : head.target,
      sub: title(),
      side: ask.proposalId,
      foot: !settled && load === 'ready' && proposal !== null,
    });
    bodyEl = f.body;
    footEl = f.foot;
    if (answeredText !== null) answeredBody(f.body, answeredText);
    else if (stoppedText !== null) stoppedBody(f.body, stoppedText);
    else if (load === 'loading') loadingBody(f.body);
    else if (load === 'down') f.body.append(banner('warning', SERVICE_DOWN, { label: 'Try again', onClick: () => void readProposal(true) }));
    else if (proposal) proposalBody(f.body, proposal);
    else if (view !== null) f.body.append(banner('info', proposalStateSentence(view) ?? ''));
    root.replaceChildren(f.el);
    f.body.scrollTop = scroll;
    paintFoot();
  };

  // ---------------------------------------------------------------- reads

  const readProposal = async (retry = false): Promise<void> => {
    if (answeredText !== null || stoppedText !== null || busy) return;
    if (retry && load === 'down') {
      load = 'loading';
      renderAll();
    }
    try {
      const [next, detail] = await Promise.all([
        ctx.client.getProposal(ask.systemId, ask.proposalId),
        nameTried ? Promise.resolve(name) : ctx.client.call('GET /systems/:id', { params: { id: ask.systemId } }).then((system) => system.name, () => null),
      ]);
      if (answeredText !== null || stoppedText !== null || busy || disposed) return;
      const key = JSON.stringify(next);
      const changedName = detail !== name;
      name = detail;
      nameTried = true;
      if (next.state === 'current' && !partsKnown) {
        on = new Set(next.proposal.parts.map((part) => part.name));
        partsKnown = true;
      }
      if (load === 'ready' && key === viewKey && !changedName) return;
      load = 'ready';
      view = next;
      viewKey = key;
      renderAll();
    } catch (error) {
      if (isServiceError(error, 'not-found')) {
        // The service answered: it has no such proposal (or system) any more. Never keep Approve live for it.
        if (answeredText !== null || stoppedText !== null || busy || disposed) return;
        const gone: ProposalView = { state: 'unknown' };
        const goneKey = JSON.stringify(gone);
        if (load === 'ready' && viewKey === goneKey) return;
        load = 'ready';
        view = gone;
        viewKey = goneKey;
        declining = false;
        stopError = null;
        renderAll();
        return;
      }
      // A hiccup (the service not answering) while a proposal is on screen is not worth taking it away for.
      if (load === 'ready' && view !== null) return;
      if (!isServiceError(error)) console.warn('Design Chamber: reading the proposal failed', error);
      if (load === 'down') return;
      load = 'down';
      renderAll();
    }
  };

  renderAll();
  if (answered === null) {
    void readProposal();
    stopRefetch = startRefetch(() => readProposal(), SYSTEM_ASK_POLL_MS);
  }

  return {
    update: (next) => {
      if (next === null || next === answeredText) return;
      answeredText = next;
      cannot = null;
      stopRefetch?.();
      stopRefetch = null;
      renderAll();
    },
    dispose: () => {
      disposed = true;
      clearUndoTimer();
      stopRefetch?.();
      for (const handle of owned) handle.dispose();
      for (const handle of footOwned) handle.dispose();
      owned = [];
      footOwned = [];
      root.replaceChildren();
    },
  };
};
