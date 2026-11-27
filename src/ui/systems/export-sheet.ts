// The "Export tokens" sheet of a design system (system-builder-depth T19u): ask the service which formats this system
// can export, let the user untick any, and have the service write one ZIP. The service writes the file; this only
// names the formats. The page reports where it went.

import { mountCheckbox, type CheckboxHandle } from '@openchamber/sdk/ui';

import type { SystemExportResponse } from '../../shared/api.ts';
import type { TokenExportFormat } from '../../shared/types.ts';
import { toast } from '../components/actions.ts';
import { createScope, errorText, h } from '../components/dom.ts';
import { btn, loadingRow, openSheet } from '../components/kit.ts';
import { client } from '../guest.ts';
import { EXPORT_NOTHING, PICK_A_FORMAT, exportButtonLabel, formatChoices, pickedFormats } from '../model/token-export-model.ts';

export type ExportSheetOptions = {
  id: string;
  systemName: string;
  /** The system has no tokens at all: say so and offer nothing to press. */
  empty: boolean;
  onExported: (result: SystemExportResponse) => void;
};

export const openExportSheet = (hostEl: HTMLElement, options: ExportSheetOptions): { close: () => void } => {
  const scope = createScope();
  let closed = false;
  const sheet = openSheet(hostEl, {
    title: 'Export tokens',
    subtitle: `Saves ${options.systemName} as one ZIP file in your Downloads folder. Your project isn’t changed.`,
    variant: 'dialog',
    onClose: () => {
      closed = true;
      scope.dispose();
    },
  });
  sheet.el.classList.add('dc-export');

  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });

  const say = (...nodes: HTMLElement[]): void => {
    sheet.body.replaceChildren(...nodes);
  };

  const form = (offered: TokenExportFormat[]): void => {
    const ticked = new Set<TokenExportFormat>(offered);
    const boxes: CheckboxHandle[] = [];
    let busy = false;
    let failed = false;
    const problem = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    const fieldset = h('fieldset', { class: 'dc-export-formats' }, h('legend', { class: 'dc-sr-only' }, 'Formats'));
    const submit = btn({ label: exportButtonLabel({ busy, failed }), variant: 'default', emphasis: 'primary', onClick: () => void run() });

    const paint = (): void => {
      submit.set({ label: exportButtonLabel({ busy, failed }), loading: busy });
      cancel.set({ disabled: busy });
      for (const box of boxes) box.update({ disabled: busy });
    };
    const fail = (sentence: string): void => {
      problem.textContent = sentence;
      problem.hidden = false;
    };

    const run = async (): Promise<void> => {
      if (busy) return;
      const formats = pickedFormats(offered, ticked);
      if (formats.length === 0) {
        fail(PICK_A_FORMAT);
        fieldset.querySelector<HTMLElement>('input,button')?.focus();
        return;
      }
      busy = true;
      problem.hidden = true;
      paint();
      try {
        const result = await client.exportSystemTokens(options.id, formats);
        // The sheet may have been closed while the file was written; where it went is still worth saying.
        sheet.close();
        options.onExported(result);
      } catch (error) {
        const sentence = `Couldn’t export. ${errorText(error)}`;
        if (closed) {
          toast('error', sentence);
          return;
        }
        busy = false;
        failed = true;
        paint();
        fail(sentence);
        submit.el.focus();
      }
    };

    for (const choice of formatChoices(offered)) {
      const holder = h('div', { class: 'dc-export-format', 'data-format': choice.format });
      const box: CheckboxHandle = mountCheckbox(holder, {
        label: choice.label,
        description: choice.file,
        checked: true,
        onChange: (on) => {
          // The kit's checkbox is controlled: it shows the new tick only when told to.
          box.update({ checked: on });
          if (on) ticked.add(choice.format);
          else ticked.delete(choice.format);
          if (ticked.size > 0 && problem.textContent === PICK_A_FORMAT) problem.hidden = true;
        },
      });
      scope.add(() => box.dispose());
      boxes.push(box);
      fieldset.append(holder);
    }
    say(fieldset, problem);
    sheet.foot.replaceChildren(cancel.el, submit.el);
    fieldset.querySelector<HTMLElement>('input,button')?.focus();
  };

  const load = async (): Promise<void> => {
    say(loadingRow('Checking the formats…'));
    sheet.foot.replaceChildren(cancel.el);
    try {
      const { formats } = await client.systemExportFormats(options.id);
      if (closed) return;
      if (formatChoices(formats).length === 0) say(h('p', { class: 'dc-muted' }, EXPORT_NOTHING));
      else form(formats);
    } catch (error) {
      if (closed) return;
      const again = btn({ label: 'Try again', variant: 'default', onClick: () => void load() });
      say(h('p', { class: 'dc-form-error', role: 'alert' }, `Couldn’t check the formats. ${errorText(error)}`));
      sheet.foot.replaceChildren(cancel.el, again.el);
      again.el.focus();
    }
  };

  if (options.empty) {
    say(h('p', { class: 'dc-muted' }, EXPORT_NOTHING));
    cancel.set({ label: 'Close' });
    sheet.foot.replaceChildren(cancel.el);
  } else void load();

  return { close: sheet.close };
};
