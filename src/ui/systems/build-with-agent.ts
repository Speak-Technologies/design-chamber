// "Build with the agent…" (Phase 2.5 U7, technical design §9.6): a small popover under the button in the systems
// list. An optional line of what the system is for, where the agent works (this chat or a new one), Start. Start
// asks the guest flow for a build ticket and sends the request to a chat; the agent then interviews the user there.
// When the request does not reach a chat the words stay, and Try again and Copy request are offered.

import { mountTabs, mountTextField } from '@openchamber/sdk/ui';

import { FlowError, type BuildSystemResult } from '../../guest/flows.ts';
import { toast } from '../components/actions.ts';
import { createScope, errorText, h } from '../components/dom.ts';
import { btn, openPopover } from '../components/kit.ts';
import { flows, host } from '../guest.ts';
import {
  NOT_SENT_BODY,
  NOT_SENT_TITLE,
  briefProblem,
  buildSetup,
  destinationHint,
  startedText,
  type BuildDestination,
} from '../model/system-build-model.ts';

export const BUILD_BUTTON_LABEL = 'Build with the agent…';

const BRIEF_ROWS = 3;

export const openBuildWithAgent = (appHost: HTMLElement, anchor: HTMLElement): void => {
  const scope = createScope();
  const context = (): { hasSession: boolean; hasProject: boolean } => ({ hasSession: host.session() !== null, hasProject: Boolean(host.snapshot()?.directory) });
  const setup = buildSetup(context());
  let destination: BuildDestination = setup.initial;
  let brief = '';
  /** The request text of the last try that did not reach a chat. */
  let unsent: string | null = null;

  const popover = openPopover(appHost, anchor, { title: BUILD_BUTTON_LABEL.replace('…', ''), onClose: () => scope.dispose() });

  const briefHost = h('div');
  const briefField = mountTextField(briefHost, {
    label: 'What is it for? (optional)',
    value: brief,
    multiline: true,
    rows: BRIEF_ROWS,
    placeholder: 'A shop for hand-made candles, calm and warm',
    onChange: (next) => {
      brief = next;
      unsent = null;
      const error = briefProblem(next);
      briefField.update({ value: next, error: error ?? undefined });
      paint();
    },
  });
  scope.add(() => briefField.dispose());

  const destHost = h('div', { class: 'dc-field' });
  const destLabel = h('span', { class: 'oc-sdk-field-label' }, 'Agent works in');
  const tabsHost = h('div');
  destHost.append(destLabel, tabsHost);
  const tabs = mountTabs(tabsHost, {
    items: setup.offered,
    activeId: destination,
    trackBackground: true,
    onChange: (id) => {
      destination = id === 'new-chat' ? 'new-chat' : 'current-chat';
      tabs.update({ activeId: destination });
      unsent = null;
      paint();
    },
  });
  scope.add(() => tabs.dispose());
  const hint = h('p', { class: 'oc-sdk-field-note' });
  destHost.append(hint);

  const failure = h('div', { class: 'dc-build-failure', role: 'alert', hidden: true });
  popover.body.append(h('div', { class: 'dc-build-form' }, briefHost, destHost, failure));

  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => popover.close() });
  const copy = btn({
    label: 'Copy request',
    variant: 'outline',
    icon: 'copy',
    onClick: () => {
      if (unsent === null) return;
      void host.writeClipboard(unsent).then((ok) => toast(ok ? 'success' : 'error', ok ? 'Request copied. Paste it into a chat.' : 'Couldn’t reach the clipboard. Select the text and copy it by hand.'));
    },
  });
  const start = btn({ label: 'Start', variant: 'default', emphasis: 'primary', onClick: () => void submit() });
  copy.el.hidden = true;
  popover.foot.append(h('span', { class: 'dc-pop-actions' }, copy.el), h('span', { class: 'dc-pop-actions' }, cancel.el, start.el));

  const paint = (): void => {
    const note = destinationHint(destination, context());
    hint.textContent = note.text;
    start.set({ disabled: note.blocked || briefProblem(brief) !== null });
    if (unsent === null) {
      failure.hidden = true;
      failure.replaceChildren();
      copy.el.hidden = true;
      start.set({ label: 'Start' });
    }
  };

  const showNotSent = (text: string): void => {
    unsent = text;
    failure.replaceChildren(h('strong', null, NOT_SENT_TITLE), h('span', null, ` ${NOT_SENT_BODY}`));
    failure.hidden = false;
    copy.el.hidden = false;
    start.set({ label: 'Try again', loading: false, disabled: false });
    popover.reposition();
  };

  const submit = async (): Promise<void> => {
    start.set({ loading: true });
    cancel.set({ disabled: true });
    try {
      const result: BuildSystemResult = await flows.buildSystem({ brief, destination });
      if (result.outcome === 'not-sent') {
        showNotSent(result.text);
        return;
      }
      toast('success', startedText(result));
      popover.close(false);
    } catch (error) {
      if (error instanceof FlowError) {
        failure.replaceChildren(h('span', null, error.message));
        failure.hidden = false;
        popover.reposition();
      } else toast('error', `Couldn’t start the build. ${errorText(error)}`);
    } finally {
      start.set({ loading: false });
      cancel.set({ disabled: false });
    }
  };

  paint();
  popover.reposition();
  briefHost.querySelector<HTMLElement>('textarea')?.focus();
};
