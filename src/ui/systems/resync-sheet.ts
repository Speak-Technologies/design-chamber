// The Re-sync sheet of a design system (Phase 2.5 U5, technical design §7.3 and §9.3): read the project again, show
// what the code changed since the system was made, and apply what the user ticks. Nothing is written until Apply, and
// Apply takes a version first (the service does that), so the page can offer Undo.
//
// This file is the internal home's flavour (`review.kind === 'code'`): groups with ticks, conflicts with a choice.
// The repo flavour (U6: all or nothing, no ticks, no Undo) plugs in through `options.repoReview`; without it the sheet
// says plainly that it can't show that review. Every value from the code is set with `textContent`, never as markup.

import { mountCheckbox, mountSpinner, type CheckboxHandle } from '@openchamber/sdk/ui';

import type { CodeResyncReview, ResyncReview, SystemResyncResponse } from '../../shared/api.ts';
import { resyncStampOf } from '../../shared/system-json.ts';
import { toServiceError } from '../../guest/service-client.ts';
import { createScope, h, nextId } from '../components/dom.ts';
import { banner, btn, openSheet, type BtnHandle } from '../components/kit.ts';
import { client } from '../guest.ts';
import { folderName } from '../model/format.ts';
import {
  AGENT_TOKENS_NOTE,
  GROUP_PAGE,
  KEPT_LINE,
  NO_VALUE,
  PARTIAL_NOTE,
  applyBody,
  changedRows,
  conflictRows,
  conflictSentence,
  countsOf,
  defaultTicks,
  failureKind,
  folderInputProblem,
  groupState,
  groupToggleLabel,
  isCodeReview,
  isTicked,
  matchesSentence,
  modeLabel,
  resyncedSentence,
  reviewGroups,
  reviewIsEmpty,
  scanningLabel,
  selectionLine,
  setGroup,
  setTick,
  sheetSubtitle,
  swatchable,
  type ApplyCounts,
  type GroupId,
  type GroupInfo,
  type ReviewTicks,
} from '../model/resync-model.ts';

const SCAN_POLL_MS = 500;

/** What a finished re-sync hands back: the page shows the notice (Undo, Ask the agent) from it. */
export type ResyncApplied = { response: SystemResyncResponse; counts: ApplyCounts; sentence: string };

/** What the repo flavour (U6) gets to draw its own review into the sheet. */
export type RepoReviewContext = {
  review: Exclude<ResyncReview, CodeResyncReview>;
  scanId: string;
  stamp: string;
  body: HTMLElement;
  foot: HTMLElement;
  close: () => void;
};

export type ResyncSheetOptions = {
  id: string;
  systemName: string;
  /** The folder the system was made from. */
  directory: string;
  onApplied: (result: ResyncApplied) => void;
  repoReview?: (context: RepoReviewContext) => void;
};

type Phase = 'scanning' | 'review' | 'applying' | 'matches' | 'stale' | 'folder' | 'failed' | 'root-changed' | 'unsupported';

export const openResyncSheet = (hostEl: HTMLElement, options: ResyncSheetOptions): { close: () => void } => {
  const scope = createScope();
  let closed = false;
  const sheet = openSheet(hostEl, {
    title: `Re-sync ${options.systemName}`,
    variant: 'dialog',
    subtitle: sheetSubtitle(options.systemName),
    onClose: () => {
      closed = true;
      cancelScan();
      scope.dispose();
    },
  });
  sheet.el.classList.add('dc-resync');

  let phase: Phase = 'scanning';
  let directory = options.directory;
  let seen = 0;
  let message = '';
  let scanId = '';
  let stamp = '';
  let review: CodeResyncReview | null = null;
  let ticks: ReviewTicks = { changes: new Set(), add: new Set(), remove: new Set(), useCode: new Set(), assets: new Set() };
  let applyProblem = '';
  /** Disposers for the review's controls; a new paint ends the old ones. */
  let paintScope = createScope();
  scope.add(() => paintScope.dispose());

  // ------------------------------------------------------------ the scan
  let scanTicket = 0;
  let scanJob: string | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelScan(): void {
    scanTicket += 1;
    if (scanTimer !== null) clearTimeout(scanTimer);
    scanTimer = null;
    const job = scanJob;
    scanJob = null;
    if (job !== null) {
      client.call('DELETE /system-scans/:scanId', { params: { scanId: job } }).catch((error: unknown) => {
        console.warn('Design Chamber: the scan could not be cancelled; the service ends it on its own', error);
      });
    }
  }

  const fail = (error: unknown): void => {
    const failure = toServiceError(error);
    message = failure.message;
    const kind = failureKind(failure.code, failure.message);
    phase = kind === 'root-changed' ? 'root-changed' : kind === 'folder' ? 'folder' : kind === 'stale' ? 'stale' : 'failed';
    paint();
  };

  const scan = async (folder: string): Promise<void> => {
    cancelScan();
    const mine = scanTicket;
    directory = folder;
    seen = 0;
    applyProblem = '';
    phase = 'scanning';
    paint();
    try {
      // The stamp is what the system's files look like right now; the service refuses the apply if they change first.
      const detail = await client.call('GET /systems/:id', { params: { id: options.id } });
      if (mine !== scanTicket) return;
      stamp = resyncStampOf(detail.stamps);
      const started = await client.call('POST /system-scans', { body: { directory: folder, systemId: options.id } });
      if (mine !== scanTicket) {
        client.call('DELETE /system-scans/:scanId', { params: { scanId: started.scanId } }).catch(() => undefined);
        return;
      }
      scanId = started.scanId;
      scanJob = started.scanId;
      const poll = async (): Promise<void> => {
        try {
          const answer = await client.call('GET /system-scans/:scanId', { params: { scanId: started.scanId } });
          if (mine !== scanTicket) return;
          if (answer.state === 'running') {
            seen = answer.seen;
            paintScanning();
            scanTimer = setTimeout(() => void poll(), SCAN_POLL_MS);
            return;
          }
          scanJob = null;
          if (answer.state !== 'done') {
            message = answer.message;
            const kind = answer.state === 'root-changed' ? 'root-changed' : failureKind(null, answer.message);
            phase = kind === 'root-changed' ? 'root-changed' : kind === 'folder' ? 'folder' : 'failed';
            paint();
            return;
          }
          if (answer.review === undefined) {
            message = 'That scan has nothing to compare against. Scan again.';
            phase = 'stale';
            paint();
            return;
          }
          if (!isCodeReview(answer.review)) {
            if (options.repoReview) {
              message = '';
              phase = 'unsupported';
              paint();
              options.repoReview({ review: answer.review, scanId: started.scanId, stamp, body: sheet.body, foot: sheet.foot, close: sheet.close });
              return;
            }
            message = `${options.systemName} lives in a project. Ask the agent to update it from the code.`;
            phase = 'unsupported';
            paint();
            return;
          }
          review = answer.review;
          ticks = defaultTicks(answer.review);
          phase = reviewIsEmpty(answer.review) ? 'matches' : 'review';
          paint();
        } catch (error) {
          if (mine !== scanTicket) return;
          scanJob = null;
          fail(error);
        }
      };
      await poll();
    } catch (error) {
      if (mine !== scanTicket) return;
      fail(error);
    }
  };

  // ------------------------------------------------------------ apply
  let applying = false;
  const apply = async (): Promise<void> => {
    if (applying || review === null) return;
    const line = selectionLine(ticks);
    if (!line.canApply) return;
    applying = true;
    applyProblem = '';
    const counts = countsOf(ticks);
    phase = 'applying';
    paint();
    try {
      const response = await client.call('POST /systems/:id/resync', { params: { id: options.id }, body: applyBody(scanId, stamp, ticks) });
      if (closed) return;
      applying = false;
      // The service's own counts are what was written (a ticked name it skipped is not claimed).
      const written: ApplyCounts = { changed: response.counts.changed, added: response.counts.added, removed: response.counts.removed, files: counts.files };
      options.onApplied({ response, counts: written, sentence: resyncedSentence(options.systemName, written) });
      sheet.close();
    } catch (error) {
      applying = false;
      if (closed) return;
      const failure = toServiceError(error);
      const kind = failureKind(failure.code, failure.message);
      message = failure.message;
      if (kind === 'plain') {
        applyProblem = failure.message;
        phase = 'review';
      } else phase = kind === 'root-changed' ? 'root-changed' : kind === 'folder' ? 'folder' : 'stale';
      paint();
    }
  };

  // ------------------------------------------------------------ small pieces
  const swatch = (value: string): HTMLElement => {
    const node = h('span', { class: 'dc-sp-swatch dc-resync-swatch', 'aria-hidden': 'true' });
    if (swatchable(value)) node.style.setProperty('background-color', value);
    else node.dataset.empty = 'true';
    return node;
  };
  /** One value: its swatch (colours only) and the text. */
  const valueChip = (value: string): HTMLElement => {
    const text = h('code', { class: 'dc-resync-code' });
    text.textContent = value === '' ? NO_VALUE : value;
    return h('span', { class: 'dc-resync-val' }, swatchable(value) ? swatch(value) : null, text);
  };
  const modeTag = (mode: 'light' | 'dark'): HTMLElement => h('span', { class: 'dc-resync-mode dc-muted' }, modeLabel(mode));

  const folderForm = (initial: string): HTMLElement => {
    const inputId = nextId('dc-resync-folder');
    const input = h('input', { type: 'text', id: inputId, class: 'oc-sdk-input', placeholder: 'C:\\Projects\\shop or /Users/you/shop', spellcheck: 'false', autocomplete: 'off' });
    input.value = initial;
    const problem = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    const go = (): void => {
      const issue = folderInputProblem(input.value);
      problem.hidden = issue === null;
      problem.textContent = issue ?? '';
      if (issue === null) void scan(input.value.trim());
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        go();
      }
    });
    const read = btn({ label: 'Read this folder', variant: 'outline', size: 'sm', onClick: go });
    queueMicrotask(() => input.focus());
    return h('div', { class: 'dc-field dc-resync-folder' }, h('label', { class: 'oc-sdk-field-label', for: inputId }, 'Project folder'), h('div', { class: 'dc-newsys-row' }, input, read.el), problem);
  };

  // ------------------------------------------------------------ painting
  const done = (label = 'Close'): HTMLElement => btn({ label, variant: 'outline', onClick: () => sheet.close() }).el;
  let scanningText: HTMLElement | null = null;

  function paintScanning(): void {
    if (phase === 'scanning' && scanningText) {
      scanningText.replaceChildren();
      mountSpinner(scanningText, { label: scanningLabel(folderName(directory), seen) });
    }
  }

  function paint(): void {
    paintScope.dispose();
    paintScope = createScope();
    scanningText = null;
    sheet.body.removeAttribute('inert');
    sheet.body.replaceChildren();
    sheet.foot.replaceChildren();
    const system = options.systemName;

    if (phase === 'scanning') {
      scanningText = h('div', { class: 'dc-resync-running', role: 'status' });
      sheet.body.append(scanningText);
      paintScanning();
      sheet.foot.append(btn({ label: 'Cancel', variant: 'outline', onClick: () => sheet.close() }).el);
      return;
    }
    if (phase === 'matches') {
      sheet.body.append(h('p', { class: 'dc-resync-matches', role: 'status' }, matchesSentence(system, folderName(directory))), h('p', { class: 'dc-muted' }, KEPT_LINE));
      sheet.foot.append(done());
      return;
    }
    if (phase === 'stale') {
      sheet.body.append(h('p', { class: 'dc-form-error', role: 'alert' }, message));
      sheet.foot.append(done('Not now'), btn({ label: 'Scan again', variant: 'default', emphasis: 'primary', onClick: () => void scan(directory) }).el);
      return;
    }
    if (phase === 'folder') {
      const form = h('div', { class: 'dc-resync-stack' }, h('p', { class: 'dc-form-error', role: 'alert' }, message));
      const choose = btn({
        label: 'Choose another folder…',
        variant: 'outline',
        size: 'sm',
        onClick: () => {
          choose.el.replaceWith(folderForm(directory));
        },
      });
      form.append(choose.el);
      sheet.body.append(form);
      sheet.foot.append(done('Not now'));
      return;
    }
    if (phase === 'failed') {
      sheet.body.append(h('div', { class: 'dc-resync-stack' }, h('p', { class: 'dc-form-error', role: 'alert' }, message), h('p', { class: 'dc-muted' }, `${system} wasn’t changed.`)));
      sheet.foot.append(done('Not now'), btn({ label: 'Scan again', variant: 'outline', onClick: () => void scan(directory) }).el);
      return;
    }
    if (phase === 'root-changed') {
      sheet.body.append(h('p', { class: 'dc-form-error', role: 'alert' }, message));
      sheet.foot.append(done());
      return;
    }
    if (phase === 'unsupported') {
      if (message !== '') {
        sheet.body.append(h('p', { class: 'dc-muted' }, message));
        sheet.foot.append(done());
      }
      return;
    }
    if (review !== null) paintReview(review);
  }

  function paintReview(current: CodeResyncReview): void {
    const boxes = new Map<string, CheckboxHandle>();
    const pairs = new Map<string, { mine: BtnHandle; code: BtnHandle }>();
    const toggles = new Map<GroupId, { button: BtnHandle; ids: string[] }>();
    const busy = phase === 'applying';
    const groups = reviewGroups(current);
    const changed = new Map(changedRows(current).map((row) => [row.name, row]));
    const conflicts = new Map(conflictRows(current).map((row) => [row.name, row]));

    const keyOf = (group: GroupId, id: string): string => `${group}:${id}`;

    const syncTicks = (): void => {
      for (const [key, box] of boxes) {
        const [group, ...rest] = key.split(':');
        box.update({ checked: isTicked(ticks, group as GroupId, rest.join(':')) });
      }
      for (const [key, pair] of pairs) {
        const on = isTicked(ticks, 'conflicts', key);
        pair.mine.set({ pressed: !on });
        pair.code.set({ pressed: on });
      }
      for (const [group, toggle] of toggles) toggle.button.set({ label: groupToggleLabel(group, groupState(ticks, group, toggle.ids)) });
      const line = selectionLine(ticks);
      selection.textContent = line.text;
      selection.dataset.empty = String(!line.canApply);
      applyButton.set({ disabled: !line.canApply });
    };

    const tick = (group: GroupId, id: string, on: boolean): void => {
      ticks = setTick(ticks, group, id, on);
      syncTicks();
    };

    const tickRow = (group: GroupId, id: string, label: string, detail: HTMLElement | null): HTMLElement => {
      const holder = h('div', { class: 'dc-resync-check' });
      const box = mountCheckbox(holder, { label, checked: isTicked(ticks, group, id), disabled: busy, onChange: (on) => tick(group, id, on) });
      paintScope.add(() => box.dispose());
      boxes.set(keyOf(group, id), box);
      return h('li', { class: 'dc-resync-row', 'data-group': group }, holder, detail);
    };

    const changedRow = (name: string): HTMLElement => {
      const row = changed.get(name);
      const lines = (row?.values ?? []).map((value) => {
        const both = (row?.values.length ?? 0) > 1 || value.mode === 'dark';
        const line = h('p', { class: 'dc-resync-line' }, both ? modeTag(value.mode) : null, valueChip(value.from), h('span', { class: 'dc-resync-arrow', 'aria-hidden': 'true' }, '→'), h('span', { class: 'dc-sr-only' }, 'now'), valueChip(value.to));
        return line;
      });
      return tickRow('changes', name, name, h('div', { class: 'dc-resync-values' }, ...lines));
    };

    const conflictRow = (name: string): HTMLElement => {
      const row = conflicts.get(name);
      const both = (row?.values.length ?? 0) > 1 || row?.values[0]?.mode === 'dark';
      const lines = (row?.values ?? []).map((value) =>
        h(
          'div',
          { class: 'dc-resync-conflict' },
          h('p', { class: 'dc-resync-text' }, conflictSentence(value, both)),
          h('p', { class: 'dc-resync-line' }, h('span', { class: 'dc-muted' }, 'Yours'), valueChip(value.mine), h('span', { class: 'dc-muted' }, 'Code'), valueChip(value.code)),
        ),
      );
      const on = isTicked(ticks, 'conflicts', name);
      const mine = btn({ label: 'Keep mine', variant: 'outline', size: 'xs', pressed: !on, disabled: busy, onClick: () => tick('conflicts', name, false) });
      const code = btn({ label: 'Use the code’s', variant: 'outline', size: 'xs', pressed: on, disabled: busy, onClick: () => tick('conflicts', name, true) });
      pairs.set(name, { mine, code });
      const choice = h('div', { class: 'dc-resync-choice', role: 'group', 'aria-label': `${name}: which value to keep` }, mine.el, code.el);
      const title = h('p', { class: 'dc-resync-name' });
      title.textContent = name;
      return h('li', { class: 'dc-resync-row', 'data-group': 'conflicts' }, title, h('div', { class: 'dc-resync-values' }, ...lines), choice);
    };

    const plainRow = (group: GroupId, id: string): HTMLElement => {
      if (group === 'assets') {
        const asset = current.assets.find((one) => one.path === id);
        return tickRow(group, id, `${asset?.kind === 'logo' ? 'Logo' : 'Font'}: ${folderName(id)}`, h('p', { class: 'dc-resync-line dc-muted' }, h('span', { class: 'dc-path' }, id)));
      }
      return tickRow(group, id, id, null);
    };

    const rowFor = (group: GroupId, id: string): HTMLElement => (group === 'changes' ? changedRow(id) : group === 'conflicts' ? conflictRow(id) : plainRow(group, id));

    const groupView = (info: GroupInfo): HTMLElement => {
      const list = h('ul', { class: 'dc-resync-list' });
      let shownCount = 0;
      const more = h('div', { class: 'dc-resync-more' });
      const showMore = (): void => {
        const next = info.ids.slice(shownCount, shownCount + GROUP_PAGE);
        for (const id of next) list.append(rowFor(info.id, id));
        shownCount += next.length;
        more.replaceChildren();
        if (shownCount < info.ids.length) {
          const rest = info.ids.length - shownCount;
          more.append(btn({ label: `Show ${rest} more`, variant: 'ghost', size: 'xs', onClick: () => { showMore(); syncTicks(); } }).el);
        }
      };
      showMore();
      const toggle = btn({
        label: groupToggleLabel(info.id, groupState(ticks, info.id, info.ids)),
        variant: 'ghost',
        size: 'xs',
        disabled: busy,
        onClick: () => {
          ticks = setGroup(ticks, info.id, info.ids, groupState(ticks, info.id, info.ids) !== 'all');
          syncTicks();
        },
      });
      toggles.set(info.id, { button: toggle, ids: info.ids });
      const headId = nextId('dc-resync-group');
      return h(
        'section',
        { class: 'dc-resync-group', 'data-group': info.id, 'aria-labelledby': headId },
        h('div', { class: 'dc-resync-grouphead' }, h('h3', { class: 'dc-resync-title', id: headId }, info.title, h('span', { class: 'dc-resync-count dc-muted' }, String(info.ids.length))), toggle.el),
        info.hint ? h('p', { class: 'dc-muted dc-resync-hint' }, info.hint) : null,
        list,
        more,
      );
    };

    const selection = h('p', { class: 'dc-resync-sel', 'aria-live': 'polite' });
    const applyButton = btn({ label: 'Apply', variant: 'default', emphasis: 'primary', loading: busy, onClick: () => void apply() });

    const intro = h('div', { class: 'dc-resync-intro' }, h('p', { class: 'dc-muted' }, KEPT_LINE));
    if (current.partial) intro.append(h('p', { class: 'dc-resync-note' }, PARTIAL_NOTE));
    if (applyProblem !== '') sheet.body.append(banner({ tone: 'error', title: 'Nothing was changed', body: applyProblem }));
    sheet.body.append(intro, ...groups.map(groupView));
    sheet.body.append(h('p', { class: 'dc-muted dc-resync-foot-note' }, AGENT_TOKENS_NOTE));
    if (busy) sheet.body.setAttribute('inert', '');

    sheet.foot.append(selection, btn({ label: 'Not now', variant: 'outline', disabled: busy, onClick: () => sheet.close() }).el, applyButton.el);
    syncTicks();
    if (busy) applyButton.set({ loading: true, disabled: true });
  }

  void scan(directory);
  return { close: sheet.close };
};
