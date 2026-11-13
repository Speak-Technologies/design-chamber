// The inline text editor card (Phase 2 technical design §3.5): host chrome floated over the element
// that is being edited, never inside the design frame. One textarea with the element's source text
// selected, a key hint, Save, and the lines a save can end in: the click-away reminder, a refusal
// with its way back, the character counter, the agent-working hint. This file is the view; what
// Enter does with the text, the sentences and the placement are in `model/edit-text-model.ts`, and
// `feature-edit-text.ts` connects it to the wall and the store. The typed words are only ever put
// in with `.value` and `textContent`.

import {
  AGENT_WORKING_LINE,
  CLICK_AWAY_LINE,
  KEY_HINT,
  counterAnnouncement,
  counterState,
  counterText,
  reasonSentence,
  type CounterState,
  type Refusal,
} from '../model/edit-text-model.ts';
import { h, nextId } from '../components/dom.ts';
import { btn } from '../components/kit.ts';

const MAX_ROWS = 8;

export type TextEditorOptions = {
  /** The element's text as the editor reads it; it starts selected. */
  initial: string;
  dir: 'ltr' | 'rtl';
  /** Names the textarea, e.g. "Text of the h1". */
  label: string;
  width: number;
  agentWorking: boolean;
  /** Enter or Save. The feature decides: nothing to save, too long, or the write. */
  onSave: () => void;
  /** Esc, or a click away from unchanged text. */
  onCancel: () => void;
  /** **Reload and try again** after a stale refusal. */
  onReload: () => void;
  /** **Ask agent** when the file will not take this edit: the typed words go to the ask bar. */
  onAskAgent: () => void;
};

export type TextEditor = {
  el: HTMLElement;
  value: () => string;
  focus: () => void;
  setWidth: (width: number) => void;
  /** The write is on its way: read-only text, a spinner on Save. */
  setSaving: (saving: boolean) => void;
  /** A refused save: the sentence under the text, with **Reload and try again** for a stale file and **Ask agent** where the file will not take it. Null clears it. */
  setRefusal: (refusal: Refusal | null) => void;
  /** Show "Press Enter to save or Esc to discard." until the next keystroke, and put the caret back in the text. */
  remindClickAway: () => void;
  /** After a reload: what the file now says about the element (muted, above the text), or null. */
  setFileNowSays: (text: string | null) => void;
  /** After a reload found the element gone: the reason replaces the hint, Save is off, **Ask agent** offers the way on. Null undoes it. */
  setGone: (sentence: string | null) => void;
  /** The reload is running: the buttons wait. */
  setReloading: (reloading: boolean) => void;
  setAgentWorking: (working: boolean) => void;
  /** An old version is on show: Save is off and says why. */
  setViewing: (viewing: boolean) => void;
  dispose: () => void;
};

export const createTextEditor = (options: TextEditorOptions): TextEditor => {
  const ids = { hint: nextId('dc-editor-hint'), line: nextId('dc-editor-line') };
  let saving = false;
  let reloading = false;
  let gone = false;
  let viewing = false;
  let counter: CounterState = 'none';
  let reminding = false;

  const agent = h('p', { class: 'dc-editor-agent', hidden: !options.agentWorking }, AGENT_WORKING_LINE);
  const nowSays = h('p', { class: 'dc-editor-note', hidden: true });
  const area = h('textarea', {
    class: 'oc-sdk oc-sdk-input dc-editor-input',
    rows: 1,
    dir: options.dir,
    'aria-label': options.label,
    'aria-describedby': `${ids.hint} ${ids.line}`,
    spellcheck: true,
  });
  area.value = options.initial;
  // Click-away reminder, the viewing and gone sentences: one polite line under the text. A refusal has its own alert.
  const line = h('p', { class: 'dc-editor-line', id: ids.line, role: 'status', hidden: true });
  const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  const reload = btn({ label: 'Reload and try again', variant: 'outline', size: 'xs', onClick: () => options.onReload() });
  const ask = btn({ label: 'Ask agent', variant: 'outline', size: 'xs', icon: 'chat', onClick: () => options.onAskAgent() });
  ask.el.hidden = true;
  reload.el.hidden = true;
  const ways = h('div', { class: 'dc-editor-ways', hidden: true }, reload.el, ask.el);
  const hint = h('span', { class: 'dc-pop-hint', id: ids.hint }, KEY_HINT);
  const count = h('span', { class: 'dc-editor-count', 'aria-hidden': 'true', hidden: true });
  // The counter is read aloud only when it crosses 4 500 and 5 000, never on every key.
  const announce = h('span', { class: 'dc-editor-sr', 'aria-live': 'polite' });
  const save = btn({ label: 'Save', variant: 'default', size: 'sm', onClick: () => options.onSave() });

  const el = h(
    'div',
    { class: 'dc-editor', role: 'group', 'aria-label': 'Edit text', style: `width:${options.width}px` },
    agent,
    nowSays,
    area,
    line,
    failure,
    ways,
    h('div', { class: 'dc-editor-foot' }, h('span', { class: 'dc-editor-meta' }, hint, count), save.el),
    announce,
  );

  /** Grow with the text up to eight rows, then scroll. Not on screen yet: the CSS height. */
  const fit = (): void => {
    area.style.height = '';
    if (!area.isConnected) return;
    const style = getComputedStyle(area);
    const sum = (...values: string[]): number => values.reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
    const borders = sum(style.borderTopWidth, style.borderBottomWidth);
    const rowHeight = Number.parseFloat(style.lineHeight);
    const limit = Number.isFinite(rowHeight) ? rowHeight * MAX_ROWS + borders + sum(style.paddingTop, style.paddingBottom) : Number.POSITIVE_INFINITY;
    area.style.height = `${Math.min(area.scrollHeight + borders, limit)}px`;
  };

  const showLine = (text: string | null): void => {
    line.hidden = text === null;
    line.textContent = text ?? '';
    // Only the click-away reminder is a warning; the viewing and gone sentences are plain information.
    line.dataset.tone = text === CLICK_AWAY_LINE ? 'warning' : 'plain';
  };

  const paint = (): void => {
    const length = area.value.length;
    const next = counterState(length);
    count.hidden = next === 'none';
    count.textContent = next === 'none' ? '' : counterText(length, next);
    count.dataset.state = next;
    const said = counterAnnouncement(counter, next);
    if (said !== null) announce.textContent = said;
    counter = next;
    area.readOnly = saving;
    el.setAttribute('aria-busy', String(saving));
    save.set({ loading: saving, disabled: next === 'over' || gone || viewing });
    reload.set({ disabled: saving || reloading, loading: reloading });
    ask.set({ disabled: saving || reloading });
    hint.hidden = gone;
    agent.hidden = !options.agentWorking;
    if (gone) return;
    if (viewing) showLine(reasonSentence('viewing'));
    else if (!reminding) showLine(null);
  };

  /** The row under the text: Reload for a stale file, Ask agent where the file will not take the edit. */
  const showWays = (withReload: boolean, withAsk: boolean): void => {
    reload.el.hidden = !withReload;
    ask.el.hidden = !withAsk;
    ways.hidden = !withReload && !withAsk;
  };

  const setLine = (text: string | null): void => {
    reminding = text === CLICK_AWAY_LINE;
    showLine(text);
  };

  area.addEventListener('input', () => {
    // A new keystroke answers the reminder and the last refusal.
    if (reminding) setLine(null);
    failure.hidden = true;
    area.removeAttribute('aria-invalid');
    showWays(false, gone);
    fit();
    paint();
  });
  area.addEventListener('keydown', (event) => {
    // keyCode 229 is how older engines report a key swallowed by an IME: Enter there confirms a candidate.
    const composing = event.isComposing || event.keyCode === 229;
    if (composing) return;
    if (event.key === 'Enter') {
      // One line of text: Shift+Enter adds nothing (08-4).
      event.preventDefault();
      if (!event.shiftKey && !saving) options.onSave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) options.onCancel();
    }
  });
  // Pasted line breaks become spaces before they go in.
  area.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text');
    if (pasted === undefined || !/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    area.setRangeText(pasted.replace(/\r\n|\r|\n/g, ' '), area.selectionStart, area.selectionEnd, 'end');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });

  paint();

  return {
    el,
    value: () => area.value,
    focus: () => {
      fit();
      area.focus();
      area.select();
    },
    setWidth: (width) => {
      el.style.width = `${width}px`;
      fit();
    },
    setSaving: (next) => {
      saving = next;
      if (next) failure.hidden = true;
      paint();
    },
    setRefusal: (refusal) => {
      failure.hidden = refusal === null;
      failure.textContent = refusal?.text ?? '';
      area.setAttribute('aria-invalid', String(refusal !== null));
      showWays(refusal?.stale === true, gone || refusal?.askAgent === true);
      paint();
    },
    remindClickAway: () => {
      setLine(CLICK_AWAY_LINE);
      area.focus();
      // The press that triggered this is still on its way to the page and moves focus there; take it back once it has landed.
      setTimeout(() => {
        if (area.isConnected && reminding) area.focus();
      }, 0);
    },
    setFileNowSays: (text) => {
      nowSays.hidden = text === null;
      nowSays.textContent = text === null ? '' : `The file now says: “${text}”`;
    },
    setGone: (sentence) => {
      gone = sentence !== null;
      setLine(sentence);
      failure.hidden = true;
      showWays(false, gone);
      paint();
    },
    setReloading: (next) => {
      reloading = next;
      paint();
    },
    setAgentWorking: (working) => {
      options.agentWorking = working;
      paint();
    },
    setViewing: (next) => {
      viewing = next;
      if (!next) showLine(null);
      paint();
    },
    dispose: () => el.remove(),
  };
};
