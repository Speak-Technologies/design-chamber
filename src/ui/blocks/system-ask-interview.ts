// SystemAsk, rounds one and two (documentation/specs/phase-2-5-technical.md §8.12): radio and
// checkbox questions with the recommended option in bold, the block's own note field, and one
// answer ("Go with these") that carries the picks as text plus a marker line the skill parses.
// Round one reads its build ticket to know whether the chat has a project folder; round two shows
// the calls the agent raised, each with its reason and what it proposes.

import { mountBanner, mountButton, mountSpinner, mountTextField, type ButtonHandle, type TextFieldHandle } from '@openchamber/sdk/ui';

import { SYSTEM_ASK_POLL_MS } from '../../shared/limits.ts';
import type { SystemQuestion, SystemQuestionSet } from '../../shared/types.ts';
import { isServiceError } from '../../guest/service-client.ts';
import { h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import type { SystemAskBlock } from '../model/block-args.ts';
import {
  CUSTOM_LINE,
  NO_PROJECT_LINE,
  OUT_OF_DATE,
  SERVICE_DOWN,
  SYSTEM_GONE,
  TICKET_EXPIRED,
  answeredView,
  defaultPicks,
  droppedLine,
  isCustom,
  resolveCalls,
  roundOneAnswer,
  roundOneBlock,
  roundOneQuestions,
  roundTwoAnswer,
  roundTwoRead,
  roundTwoSub,
  withPick,
  type Picks,
  type RoundTwoCall,
} from '../model/system-ask-model.ts';
import type { BlockContext, BlockView } from './block-view.ts';
import { cannotTake, frame, primaryOf, refusedLine, sendAnswer, startRefetch, uid } from './system-ask-shared.ts';

type Interview = Extract<SystemAskBlock, { kind: 'interview-1' | 'interview-2' }>;
type Phase = 'loading' | 'form' | 'stale' | 'expired' | 'gone' | 'down';

const NOTHING_TO_ANSWER = 'There is nothing to answer here. Reply in the chat.';

export const mountInterview = (root: HTMLElement, ctx: BlockContext, ask: Interview, set: SystemQuestionSet, answered: string | null): BlockView => {
  const roundOne = ask.kind === 'interview-1';
  const two = ask.kind === 'interview-2' ? resolveCalls(ask.calls, ask.dropped, set) : null;
  const blockId = uid('dcb-i');

  // Both rounds read the service before they can be answered: the ticket (round one) or the system (round two).
  let phase: Phase = 'loading';
  /** Round two: the system's name as the service gave it. */
  let systemNameNow: string | null = null;
  let disposed = false;
  let hasProject = true;
  let picks: Picks = defaultPicks(roundOne ? set.roundOne : (two?.calls ?? []).map((call) => call.question));
  let note = '';
  let sending = false;
  let refused = false;
  let cannot: string | null = null;
  let answeredText: string | null = answered;
  let owned: Array<{ dispose: () => void }> = [];
  let stopRefetch: (() => void) | null = null;

  // What paint() reaches into after each pick.
  let goHandle: ButtonHandle | null = null;
  let reasonEl: HTMLElement | null = null;
  let refusedEl: HTMLElement | null = null;
  let inputs: HTMLInputElement[] = [];
  let customLines: Array<{ el: HTMLElement; question: SystemQuestion }> = [];
  let noteField: TextFieldHandle | null = null;

  const shown = (): SystemQuestion[] => (roundOne ? roundOneQuestions(set, hasProject) : (two?.calls ?? []).map((call) => call.question));

  const own = <T extends { dispose: () => void }>(handle: T): T => {
    owned.push(handle);
    return handle;
  };

  const paint = (): void => {
    const reason = roundOne ? roundOneBlock(shown(), picks) : null;
    goHandle?.update({ disabled: reason !== null || sending, loading: sending });
    if (reasonEl) {
      reasonEl.textContent = reason ?? '';
      reasonEl.hidden = reason === null;
    }
    if (refusedEl) refusedEl.hidden = !refused;
    for (const input of inputs) input.disabled = sending || cannot !== null;
    noteField?.update({ disabled: sending || cannot !== null });
    for (const line of customLines) line.el.hidden = !isCustom(picks, line.question);
  };

  const questionBlock = (question: SystemQuestion, call: RoundTwoCall | null): HTMLElement => {
    const labelId = uid(`${blockId}-q`);
    const group = h(
      'div',
      { class: 'dcb-q', role: question.multiple ? 'group' : 'radiogroup', 'aria-labelledby': labelId },
      h('p', { class: 'dcb-q-label', id: labelId }, question.label),
    );
    if (call && (call.why !== '' || call.proposed !== '')) {
      group.append(
        h(
          'div',
          { class: 'dcb-q-agent' },
          call.why === '' ? null : h('p', null, h('span', { class: 'dcb-q-agent-k' }, 'From the agent: '), call.why),
          call.proposed === '' ? null : h('p', null, h('span', { class: 'dcb-q-agent-k' }, 'Proposed: '), call.proposed),
        ),
      );
    }
    const name = `${blockId}-${question.topic}`;
    for (const option of question.options) {
      const input = h('input', { class: 'dcb-opt-input', type: question.multiple ? 'checkbox' : 'radio', name, value: option.choice });
      input.checked = (picks[question.topic] ?? []).includes(option.choice);
      input.addEventListener('change', () => {
        picks = withPick(picks, question, option.choice, question.multiple ? input.checked : true);
        paint();
      });
      inputs.push(input);
      group.append(
        h(
          'label',
          { class: 'dcb-opt' },
          input,
          h(
            'span',
            { class: 'dcb-opt-text' },
            h('span', { class: 'dcb-opt-name', 'data-recommended': option.recommended ? '' : null }, option.label, option.recommended ? h('span', { class: 'dcb-sr' }, ' (recommended)') : null),
            option.why === '' ? null : h('span', { class: 'dcb-opt-why' }, option.why),
          ),
        ),
      );
    }
    if (question.options.some((option) => option.choice === 'custom')) {
      const line = h('p', { class: 'dcb-q-custom', role: 'status' }, CUSTOM_LINE);
      customLines.push({ el: line, question });
      group.append(line);
    }
    return group;
  };

  const go = (): void => {
    const reason = roundOne ? roundOneBlock(shown(), picks) : null;
    if (sending || reason !== null || cannot !== null || answeredText !== null) return;
    const text = roundOne ? roundOneAnswer(ask.ticket, set, picks, hasProject, note) : roundTwoAnswer(ask.systemId, two?.calls ?? [], picks, note);
    // Inside the click: the answer goes to the host before anything else happens.
    const sent = sendAnswer(ctx, text);
    sending = true;
    refused = false;
    paint();
    void sent.then((outcome) => {
      sending = false;
      if (outcome === 'sent') {
        if (answeredText === null) answeredText = text;
        stopRefetch?.();
        stopRefetch = null;
        render();
      } else if (outcome === 'host-rejected') {
        cannot = text;
        render();
      } else {
        refused = true;
        paint();
      }
    });
  };

  const formBody = (body: HTMLElement, foot: HTMLElement): void => {
    inputs = [];
    customLines = [];
    const calls = two?.calls ?? [];
    const dropped = two ? droppedLine(two.dropped) : null;
    if (!roundOne && calls.length === 0) {
      body.append(h('p', { class: 'dcb-ask-fact' }, dropped ?? NOTHING_TO_ANSWER));
      foot.remove();
      return;
    }
    if (dropped) body.append(h('p', { class: 'dcb-ask-fact' }, icon('alert', 14), dropped));
    if (roundOne && !hasProject) body.append(h('p', { class: 'dcb-ask-fact' }, icon('folder', 14), NO_PROJECT_LINE));
    if (roundOne) for (const question of shown()) body.append(questionBlock(question, null));
    else for (const call of calls) body.append(questionBlock(call.question, call));

    const noteSlot = h('div', { class: 'dcb-ask-note' });
    body.append(noteSlot);
    noteField = own(
      mountTextField(noteSlot, {
        label: 'Add a note (optional)',
        value: note,
        multiline: true,
        rows: 2,
        placeholder: 'Anything the agent should know',
        onChange: (value) => {
          note = value;
        },
      }),
    );

    reasonEl = h('p', { class: 'dcb-ask-reason', role: 'status' });
    refusedEl = refusedLine();
    refusedEl.hidden = true;
    if (cannot !== null) {
      const fallback = cannotTake(ctx, cannot);
      own(fallback);
      foot.append(fallback.el);
      return;
    }
    const slot = h('span', { class: 'dcb-ask-btn' });
    goHandle = own(mountButton(slot, { label: 'Go with these', variant: 'default', size: 'default', onClick: go }));
    primaryOf(slot);
    foot.append(reasonEl, refusedEl, h('div', { class: 'dcb-ask-actions' }, slot));
  };

  const answeredBody = (body: HTMLElement, text: string): void => {
    const view = answeredView(text, set);
    body.append(h('p', { class: 'dcb-ask-done' }, icon('check', 16), view.headline));
    if (view.verbatim !== null) {
      body.append(h('p', { class: 'dcb-ask-quote' }, view.verbatim));
      return;
    }
    const list = h('dl', { class: 'dcb-ask-picks' });
    const questions = view.kind === 'round-1' ? set.roundOne : set.roundTwo;
    for (const question of questions) {
      const chosen = view.picks[question.topic];
      if (chosen === undefined) continue;
      const words = chosen.map((choice) => question.options.find((option) => option.choice === choice)?.label ?? choice).join(', ');
      list.append(h('dt', null, question.label), h('dd', null, words === '' ? 'None' : words));
    }
    if (list.childElementCount > 0) body.append(list);
  };

  const phaseBody = (body: HTMLElement): void => {
    if (phase === 'loading') {
      const row = h('p', { class: 'dcb-ask-loading', role: 'status' });
      const spin = h('span', { class: 'dcb-ask-spin' });
      mountSpinner(spin, { size: 'sm' });
      row.append(spin, 'Loading the question…');
      body.append(row);
      return;
    }
    const slot = h('div', { class: 'dcb-ask-banner' });
    body.append(slot);
    if (phase === 'down') {
      own(mountBanner(slot, { tone: 'warning', title: SERVICE_DOWN, action: { label: 'Try again', onClick: () => void read() } }));
    } else {
      own(mountBanner(slot, { tone: 'info', title: phase === 'expired' ? TICKET_EXPIRED : phase === 'gone' ? SYSTEM_GONE : OUT_OF_DATE }));
    }
  };

  const render = (): void => {
    for (const handle of owned) handle.dispose();
    owned = [];
    goHandle = null;
    reasonEl = null;
    refusedEl = null;
    noteField = null;
    inputs = [];
    customLines = [];
    const open = answeredText === null && phase === 'form';
    const f = frame({ icon: 'system', title: roundOne ? 'Before I read the code' : 'A few calls from the code', sub: roundOne ? 'Round 1 of 2' : roundTwoSub(systemNameNow), foot: open });
    if (answeredText !== null) answeredBody(f.body, answeredText);
    else if (phase === 'form' && f.foot) formBody(f.body, f.foot);
    else phaseBody(f.body);
    root.replaceChildren(f.el);
    paint();
  };

  const readTicket = async (): Promise<void> => {
    if (!roundOne || answeredText !== null || sending) return;
    let next: Phase;
    let project = hasProject;
    try {
      const answer = await ctx.client.call('GET /system-builds/:ticket', { params: { ticket: ask.ticket } });
      next = answer.state === 'waiting' ? 'form' : answer.state === 'made' ? 'stale' : 'expired';
      if (answer.state === 'waiting') project = answer.project !== null;
    } catch (error) {
      // A hiccup while the form is open is not worth losing the user's picks for.
      if (phase === 'form') return;
      next = 'down';
      if (!isServiceError(error)) console.warn('Design Chamber: reading the build ticket failed', error);
    }
    if (disposed || answeredText !== null || sending || (next === phase && project === hasProject)) return;
    phase = next;
    hasProject = project;
    render();
  };

  /** Round two: the system must be in round two for the card to be answerable (§8.12). */
  const readSystem = async (): Promise<void> => {
    if (roundOne || answeredText !== null || sending) return;
    let next: Phase;
    let name = systemNameNow;
    try {
      const detail = await ctx.client.call('GET /systems/:id', { params: { id: ask.systemId } });
      const result = roundTwoRead(detail);
      next = result.phase;
      name = result.name;
    } catch (error) {
      if (isServiceError(error, 'not-found')) {
        next = roundTwoRead(null).phase;
        name = null;
      } else {
        // A hiccup while the form (or a settled sentence) is up is not worth losing the user's picks for.
        if (phase !== 'loading' && phase !== 'down') return;
        next = 'down';
        if (!isServiceError(error)) console.warn('Design Chamber: reading the system failed', error);
      }
    }
    if (disposed || answeredText !== null || sending || (next === phase && name === systemNameNow)) return;
    phase = next;
    systemNameNow = name;
    render();
  };

  const read = (): Promise<void> => (roundOne ? readTicket() : readSystem());

  render();
  if (answeredText === null) {
    void read();
    stopRefetch = startRefetch(read, SYSTEM_ASK_POLL_MS);
  }

  return {
    update: (next) => {
      if (next === null || next === answeredText) return;
      answeredText = next;
      stopRefetch?.();
      stopRefetch = null;
      render();
    },
    dispose: () => {
      disposed = true;
      stopRefetch?.();
      for (const handle of owned) handle.dispose();
      owned = [];
      root.replaceChildren();
    },
  };
};
