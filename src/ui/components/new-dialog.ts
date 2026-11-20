// New dialog: kind, brief, style preset, and which chat the agent works in. One primary action.

import { mountSelect, mountTabs, mountTextField } from '@openchamber/sdk/ui';

import type { DesignKind } from '../../shared/types.ts';
import { flows, host, store } from '../guest.ts';
import { systems as systemsStore } from './systems-store.ts';
import { DESTINATIONS, NO_SYSTEMS_LINE, briefPlaceholder, foldsCaseFor, kindHint, presetOptions, startLabel, systemFieldOf, validateBrief, type Destination } from '../model/new-model.ts';
import { errorText, h } from './dom.ts';
import { btn, openSheet } from './kit.ts';
import { toast } from './actions.ts';

export type NewDialogOptions = {
  kind: DesignKind;
  onCreated: (slug: string) => void;
  /** Opens the design systems list ("No design systems yet. Make one"); absent where there is none. */
  onSystems?: () => void;
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
      failure.hidden = true;
      submit.set({ loading: true });
      cancel.set({ disabled: true });
      flows.newDesign({ kind, brief, preset: preset === '' || presetHost.hidden ? null : preset, destination, ...(systemSend === undefined ? {} : { system: systemSend }) }).then(
        ({ slug }) => {
          toast('success', 'Design started. It shows up in your list while the agent works.');
          sheet.close();
          options.onCreated(slug);
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

  sheet.body.append(kindHost, briefHost, systemHost, systemEmpty, presetHost, destHost, failure);
  sheet.foot.append(cancel.el, submit.el);
};
