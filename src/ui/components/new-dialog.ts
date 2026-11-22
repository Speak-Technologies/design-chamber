// New dialog: kind, brief, style preset, where the design is filed, and which chat the agent works
// in. One primary action. Filing is optional and never blocks the design: a target that refuses
// gets a notice with Try again after Start (Phase 2.6 F2).

import { mountSelect, mountTabs, mountTextField } from '@openchamber/sdk/ui';

import type { MembershipResult, MembershipTarget } from '../../shared/api.ts';
import type { DesignKind } from '../../shared/types.ts';
import { flows, host, store } from '../guest.ts';
import { systems as systemsStore } from './systems-store.ts';
import { DESTINATIONS, FOLDER_FIELD_HELPER, FOLDER_FIELD_LABEL, NO_SYSTEMS_LINE, briefPlaceholder, foldsCaseFor, kindHint, presetOptions, startLabel, systemFieldOf, validateBrief, type Destination } from '../model/new-model.ts';
import { filingOf, filingProblem, goesLine, keyOfTarget, type TargetKey } from '../model/folder-picker-model.ts';
import { folderName } from '../model/format.ts';
import { errorText, h } from './dom.ts';
import { mountFolderPicker } from './folder-picker.ts';
import { folders } from './folders-store.ts';
import { bannerWithActions, btn, iconBtn, openSheet } from './kit.ts';
import { icon } from './icons.ts';
import { toast } from './actions.ts';

export type NewDialogOptions = {
  kind: DesignKind;
  onCreated: (slug: string) => void;
  /** Opens the design systems list ("No design systems yet. Make one"); absent where there is none. */
  onSystems?: () => void;
};

/**
 * After Start: one warning notice per filing target that refused, with Try again (a best-effort
 * batch of just that target). The design was made either way; the notices sit over the app until
 * they are retried or dismissed.
 */
const showFilingFailures = (hostEl: HTMLElement, slug: string, failed: Array<Extract<MembershipResult, { ok: false }>>): void => {
  const strip = hostEl.querySelector<HTMLElement>('.dc-filing-notices') ?? h('div', { class: 'dc-filing-notices' });
  // In flow above the current view, never over its toolbar: a notice must not hide a control (WCAG 2.4.11).
  if (strip.parentElement === null) hostEl.prepend(strip);
  const nameOf = (target: MembershipTarget): string =>
    target.kind === 'folder' ? folders().get().folders.find((entry) => entry.id === target.id)?.name ?? 'that folder' : folderName(target.directory);
  const tidy = (): void => {
    if (strip.childElementCount === 0) strip.remove();
  };
  for (const result of failed) {
    const name = nameOf(result.target);
    const body = h('span', null, `${result.message} The design was still made.`);
    const retry = btn({ label: 'Try again', variant: 'outline', size: 'xs', onClick: () => void tryAgain() });
    const node = h('div', { class: 'dc-filing-notice' });
    const dismiss = iconBtn({ icon: 'close', label: `Dismiss the notice about ${name}`, size: 'sm', onClick: () => {
      node.remove();
      tidy();
    } });
    const tryAgain = async (): Promise<void> => {
      retry.set({ loading: true });
      try {
        const answer = await folders().apply([{ target: result.target, add: [slug] }]);
        const again = answer.results.find((entry) => keyOfTarget(entry.target) === keyOfTarget(result.target));
        if (again && !again.ok) body.textContent = `${again.message} The design was still made.`;
        else {
          node.remove();
          tidy();
          toast('success', `Added to ${name}.`);
        }
      } catch (error) {
        body.textContent = `${errorText(error)} The design was still made.`;
      } finally {
        retry.set({ loading: false });
      }
    };
    node.append(h('div', { class: 'dc-banner' }, ...bannerWithActions('warning', `Couldn’t add it to ${name}.`, [body], [retry.el])), dismiss);
    strip.append(node);
  }
};

export const openNewDialog = (hostEl: HTMLElement, options: NewDialogOptions): void => {
  let unsubscribe = (): void => {};
  let unsubscribeSystems = (): void => {};
  const sheet = openSheet(hostEl, {
    title: 'New design',
    variant: 'dialog',
    subtitle: 'Your chat agent writes the files; they appear here as it works.',
    onClose: () => {
      unsubscribe();
      unsubscribeSystems();
      picker.dispose();
    },
  });
  let kind = options.kind;
  let brief = '';
  let preset = '';
  /** The design system the person picked; null until they do (then the pin, the default or ask decides). */
  let systemChoice: string | null = null;
  let systemSend: string | undefined;
  let destination: Destination = 'new-chat';

  const kindHost = h('div', { class: 'dc-field' }, h('span', { class: 'oc-sdk-field-label' }, 'Type'));
  const kindTabs = mountTabs(kindHost, {
    items: [
      { id: 'canvas', label: 'Canvas' },
      { id: 'page', label: 'Page' },
    ],
    activeId: kind,
    trackBackground: true,
    onChange: (id) => {
      kind = id === 'page' ? 'page' : 'canvas';
      kindTabs.update({ activeId: kind });
      kindNote.textContent = kindHint(kind);
      briefField.update({ placeholder: briefPlaceholder(kind) });
      submit.set({ label: startLabel(kind) });
    },
  });
  const kindNote = h('p', { class: 'oc-sdk-field-note' }, kindHint(kind));
  kindHost.append(kindNote);

  const briefHost = h('div');
  const briefField = mountTextField(briefHost, {
    label: 'What should it be?',
    value: brief,
    multiline: true,
    rows: 4,
    placeholder: briefPlaceholder(kind),
    helper: 'Optional. Leave it empty and the agent will ask.',
    onChange: (next) => {
      brief = next;
      briefField.update({ error: validateBrief(next) ?? undefined });
    },
  });

  // The design system: preselected the way the service will decide, so the field says what will happen.
  const systemHost = h('div', { class: 'dc-field dc-system-field' });
  const systemSelect = mountSelect(systemHost, { label: 'Design system', value: 'ask', options: [{ id: 'ask', label: 'Ask me in chat' }], onChange: (id) => {
    systemChoice = id;
    paintSystem();
  } });
  const systemNote = h('p', { class: 'oc-sdk-field-note' });
  const systemEmpty = h('p', { class: 'oc-sdk-field-note dc-system-empty', hidden: true }, NO_SYSTEMS_LINE, ' ');
  if (options.onSystems) {
    const make = h('button', { type: 'button', class: 'dc-link' }, 'Make one');
    make.addEventListener('click', () => {
      sheet.close();
      options.onSystems?.();
    });
    systemEmpty.append(make);
  }
  systemHost.append(systemNote);
  const presetHost = h('div', { class: 'dc-field' });
  const presetSelect = mountSelect(presetHost, { label: 'Style preset', value: '', options: presetOptions([]), disabled: true, onChange: (id) => void (preset = id) });
  const presetNote = h('p', { class: 'oc-sdk-field-note', hidden: true });
  presetHost.append(presetNote);
  const paintPresets = (): void => {
    const state = store.getState().presets;
    if (state.status === 'ready' && state.data) presetSelect.update({ options: presetOptions(state.data.presets), disabled: false, value: preset });
    if (state.status === 'error') {
      presetNote.textContent = 'Style presets didn’t load, so the agent will choose the style. You can still start.';
      presetNote.hidden = false;
    }
  };
  const paintSystem = (): void => {
    const list = systemsStore().get();
    const settings = store.getState().settings.data;
    const view = systemFieldOf(
      { systems: list.systems ?? [], settings: settings?.systems, designsRoot: settings?.root ?? '', projectDirectory: host.snapshot()?.directory ?? null },
      systemChoice,
      foldsCaseFor(settings?.root ?? '', typeof navigator === 'undefined' ? '' : navigator.platform),
    );
    // Hidden until the list has answered, and replaced by a pointer when there is nothing to pick.
    const loaded = list.systems !== null;
    systemHost.hidden = !loaded || view.empty;
    systemEmpty.hidden = !loaded || !view.empty;
    systemSend = view.send;
    if (!view.empty) {
      systemSelect.update({ options: view.options, value: view.value });
      systemNote.textContent = view.hint ?? '';
      systemNote.hidden = view.hint === null;
    }
    presetHost.hidden = !view.showPreset;
  };
  unsubscribeSystems = systemsStore().subscribe(paintSystem);
  unsubscribe = store.subscribe(() => {
    paintPresets();
    paintSystem();
  });
  void store.loadPresets();
  paintPresets();
  paintSystem();

  // Folder or project: the inline picker, the picks as chips, and the line that says where it goes.
  // The chat's project is automatic (locked and ticked); everything else is the person's own pick.
  const folderHost = h('div', { class: 'dc-field dc-folder-field' });
  const folderLabel = h('span', { class: 'oc-sdk-field-label' }, FOLDER_FIELD_LABEL);
  const chips = h('div', { class: 'dc-pick-chips', 'aria-label': 'Chosen folders and projects', hidden: true });
  const pickerHost = h('div');
  const folderNote = h('p', { class: 'oc-sdk-field-note dc-folder-note' }, FOLDER_FIELD_HELPER);
  folderHost.append(folderLabel, chips, pickerHost, folderNote);
  let filingKeys: TargetKey[] = [];
  const paintFolderField = (): void => {
    const selected = picker.selectedRows();
    const derived = picker.derivedRow();
    const keys = picker.selected();
    const chipNodes: HTMLElement[] = [];
    if (derived !== null) {
      chipNodes.push(h('span', { class: 'dc-pick-chip', 'data-fixed': 'true', title: `Automatic: the agent works in ${derived.label}` }, icon('lock', 12), h('span', { class: 'dc-pick-chip-name' }, derived.label)));
    }
    for (const row of selected) {
      const remove = h('button', { type: 'button', class: 'dc-pick-chip-x', 'aria-label': `Remove ${row.label}`, title: `Remove ${row.label}` }, icon('close', 12));
      remove.addEventListener('click', () => picker.setSelected(keys.filter((key) => key !== row.key)));
      chipNodes.push(h('span', { class: 'dc-pick-chip', title: `${row.kind === 'folder' ? 'Folder' : 'Project'} ${row.label}` }, icon(row.kind === 'folder' ? 'folder' : 'layers', 12), h('span', { class: 'dc-pick-chip-name' }, row.label), remove));
    }
    chips.replaceChildren(...chipNodes);
    chips.hidden = chipNodes.length === 0;
    const goes = goesLine(selected, derived?.label ?? null);
    folderNote.replaceChildren();
    if (goes === null) folderNote.append(FOLDER_FIELD_HELPER);
    else folderNote.append(icon('info', 14), h('span', null, goes));
    folderNote.classList.toggle('dc-goes-line', goes !== null);
  };
  const picker = mountFolderPicker(pickerHost, {
    mode: 'multi',
    apply: 'deferred',
    design: null,
    derivedProject: host.snapshot()?.directory ?? null,
    rows: 5,
    search: 'always',
    searchPlaceholder: 'Find or make a folder',
    sectionNotes: false,
    onChange: (keys) => {
      filingKeys = keys;
      paintFolderField();
    },
  });
  paintFolderField();

  const destHost = h('div', { class: 'dc-field' }, h('span', { class: 'oc-sdk-field-label' }, 'Where should the agent work?'));
  const destTabs = mountTabs(destHost, {
    items: DESTINATIONS.map(({ id, label }) => ({ id, label })),
    activeId: destination,
    trackBackground: true,
    onChange: (id) => {
      destination = id === 'current-chat' ? 'current-chat' : 'new-chat';
      destTabs.update({ activeId: destination });
      paintDest();
    },
  });
  const destHint = h('p', { class: 'oc-sdk-field-note' });
  destHost.append(destHint);
  const paintDest = (): void => {
    const base = DESTINATIONS.find((entry) => entry.id === destination)?.hint ?? '';
    const noSession = destination === 'current-chat' && host.session() === null;
    destHint.textContent = noSession ? 'No chat is open right now. Choose New chat, or open one first.' : base;
  };
  paintDest();

  const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });
  const submit = btn({
    label: startLabel(kind),
    variant: 'default',
    emphasis: 'primary',
    onClick: () => {
      const problem = validateBrief(brief);
      if (problem !== null) {
        briefField.update({ error: problem });
        return;
      }
      const filingIssue = filingProblem(filingKeys);
      if (filingIssue !== null) {
        failure.textContent = filingIssue;
        failure.hidden = false;
        return;
      }
      const filing = filingOf(filingKeys);
      failure.hidden = true;
      submit.set({ loading: true });
      cancel.set({ disabled: true });
      flows.newDesign({ kind, brief, preset: preset === '' || presetHost.hidden ? null : preset, destination, ...(systemSend === undefined ? {} : { system: systemSend }), ...(filing === undefined ? {} : { filing }) }).then(
        ({ slug, filing: filed }) => {
          toast('success', 'Design started. It shows up in your list while the agent works.');
          sheet.close();
          options.onCreated(slug);
          const failed = (filed?.results ?? []).filter((result): result is Extract<MembershipResult, { ok: false }> => !result.ok);
          if (failed.length > 0) showFilingFailures(hostEl, slug, failed);
        },
        (error: unknown) => {
          failure.textContent = errorText(error);
          failure.hidden = false;
          submit.set({ loading: false });
          cancel.set({ disabled: false });
        },
      );
    },
  });

  sheet.body.append(kindHost, briefHost, systemHost, systemEmpty, presetHost, folderHost, destHost, failure);
  sheet.foot.append(cancel.el, submit.el);
};
