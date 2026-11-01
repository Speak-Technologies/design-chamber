// The loose-HTML banner over the rail list (R1) and the library grid (P1): an `.html` file saved
// straight into the designs folder is not a design, so we offer to import it as a page. One file
// gets a direct Import; several open a Review sheet with a row and an Import button per file.
// The element is long-lived: the list repaints move it, never rebuild it, so an import in flight
// keeps its spinner.

import { mountBanner, type BannerTone } from '@openchamber/sdk/ui';

import type { ImportLooseResponse } from '../../shared/api.ts';
import type { LooseHtmlFile } from '../../shared/types.ts';
import { client, host, store } from '../guest.ts';
import { fileSize, relativeTime } from '../model/format.ts';
import { LOOSE_DISMISSED_KEY, importOutcome, looseBanner, looseKey, parseDismissed, unlistedNote, type LooseList } from '../model/loose-model.ts';
import { toast } from './actions.ts';
import { append, errorText, h } from './dom.ts';
import { btn, openSheet } from './kit.ts';

export type LooseBannerOptions = {
  /** Element the Review sheet mounts into. */
  sheetHost: HTMLElement;
  onOpen: (slug: string) => void;
  /** After every repaint, so the host can hide its notices strip when nothing in it shows. */
  onPaint?: () => void;
};

export type LooseBannerHandle = { el: HTMLElement; update: (loose: LooseList | null) => void; dispose: () => void };

const importLoose = (name: string): Promise<ImportLooseResponse> => client.call('POST /loose/import', { body: { name } });

/** A kit banner whose action slot holds our own buttons (the kit offers one action; we need two). */
const bannerWith = (tone: BannerTone, title: string, body: Array<Node | string>, actions: HTMLElement[]): HTMLElement[] => {
  const holder = h('div');
  mountBanner(holder, { tone, title, body: ' ' });
  const bodyEl = holder.querySelector<HTMLElement>('.oc-sdk-banner-body');
  if (bodyEl) {
    bodyEl.replaceChildren(...body);
    bodyEl.hidden = body.length === 0;
  }
  const slot = holder.querySelector<HTMLElement>('.oc-sdk-banner-action');
  if (slot) {
    slot.hidden = false;
    slot.replaceChildren(h('div', { class: 'dc-row-actions' }, ...actions));
  }
  return [...holder.childNodes].filter((node): node is HTMLElement => node instanceof HTMLElement);
};

export const mountLooseBanner = (options: LooseBannerOptions): LooseBannerHandle => {
  // data-actions="stack": two buttons need their own row under the text in a narrow rail (styles.css rule).
  const el = h('div', { class: 'dc-banner', 'data-actions': 'stack', hidden: true });
  let loose: LooseList | null = null;
  /** `undefined` until storage answers, so a dismissed banner never flashes in. */
  let dismissed: string[] | null | undefined;
  let busy = false;
  let imported: (ImportLooseResponse & { tone: BannerTone; message: string }) | null = null;
  let disposed = false;

  const openImported = (slug: string): void => {
    imported = null;
    paint();
    options.onOpen(slug);
  };

  /** Repaints keep keyboard users in the banner: focus moves to its first button when it was inside. */
  const paint = (): void => {
    if (disposed) return;
    const hadFocus = document.activeElement instanceof Node && el.contains(document.activeElement);
    render();
    options.onPaint?.();
    if (hadFocus && !el.hidden) el.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  };

  const render = (): void => {
    if (imported) {
      const done = imported;
      const open = btn({ label: 'Open', variant: 'outline', size: 'xs', onClick: () => openImported(done.slug) });
      const close = btn({ label: 'Dismiss', variant: 'ghost', size: 'xs', onClick: () => {
        imported = null;
        paint();
      } });
      el.replaceChildren(...bannerWith(done.tone, done.message, [], [open.el, close.el]));
      el.hidden = false;
      return;
    }
    const model = dismissed === undefined ? null : looseBanner(loose, dismissed);
    if (!model) {
      el.replaceChildren();
      el.hidden = true;
      return;
    }
    const notNow = btn({ label: 'Not now', variant: 'ghost', size: 'xs', onClick: () => dismiss() });
    if (model.mode === 'single') {
      const name = model.name;
      const action = btn({ label: 'Import as page', variant: 'outline', size: 'xs', loading: busy, onClick: () => void importOne(name) });
      el.replaceChildren(...bannerWith('info', model.title, [h('code', { class: 'dc-chip-code' }, name), ` ${model.body}`], [action.el, notNow.el]));
    } else {
      const review = btn({ label: 'Review', variant: 'outline', size: 'xs', onClick: () => openReview() });
      el.replaceChildren(...bannerWith('info', model.title, [model.body], [review.el, notNow.el]));
    }
    el.hidden = false;
  };

  const dismiss = (): void => {
    if (!loose) return;
    dismissed = looseKey(loose.files);
    void host.storage.set(LOOSE_DISMISSED_KEY, dismissed);
    paint();
  };

  const importOne = async (name: string): Promise<void> => {
    if (busy) return;
    busy = true;
    paint();
    try {
      const result = await importLoose(name);
      const outcome = importOutcome(result);
      imported = { ...result, tone: outcome.kind, message: outcome.message };
    } catch (error) {
      toast('error', `Couldn’t import ${name}. ${errorText(error)}`);
    } finally {
      busy = false;
      paint();
      void store.refreshDesigns();
    }
  };

  const openReview = (): void => {
    if (!loose) return;
    const snapshot = loose;
    const sheet = openSheet(options.sheetHost, {
      title: 'HTML files in your designs folder',
      subtitle: 'Each one you import becomes a page. The original moves to .trash in your designs folder.',
      variant: 'dialog',
    });
    const locale = host.snapshot()?.locale ?? 'en';
    const row = (file: LooseHtmlFile): HTMLElement => {
      const detail = h('span', { class: 'dc-muted' }, `${fileSize(file.bytes, locale)} · ${relativeTime(file.mtime, Date.now(), locale)}`);
      const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
      const text = h('div', { class: 'dc-prev-text' }, h('code', { class: 'dc-path', title: file.name }, file.name), detail, failure);
      const item = h('li', { class: 'dc-prev' }, text);
      const action = btn({ label: 'Import', variant: 'outline', size: 'xs', onClick: () => {
        action.set({ loading: true });
        failure.hidden = true;
        importLoose(file.name).then(
          (result) => {
            const outcome = importOutcome(result);
            detail.textContent = result.originalMovedTo === null ? outcome.message : `Imported as “${result.title}”.`;
            const open = btn({ label: 'Open', variant: 'outline', size: 'xs', onClick: () => {
              sheet.close();
              options.onOpen(result.slug);
            } });
            action.el.replaceWith(open.el);
            open.el.focus();
            void store.refreshDesigns();
          },
          (error: unknown) => {
            failure.textContent = errorText(error);
            failure.hidden = false;
            action.set({ loading: false });
          },
        );
      } });
      action.el.setAttribute('aria-label', `Import ${file.name} as a page`);
      item.append(action.el);
      return item;
    };
    const note = unlistedNote(snapshot);
    append(sheet.body, h('ul', { class: 'dc-prev-list', 'aria-label': 'HTML files' }, ...snapshot.files.map(row)), note ? h('p', { class: 'dc-muted' }, note) : null);
    sheet.foot.append(btn({ label: 'Done', variant: 'ghost', onClick: () => sheet.close() }).el);
  };

  void host.storage.get(LOOSE_DISMISSED_KEY).then((value) => {
    dismissed = parseDismissed(value);
    paint();
  });

  return {
    el,
    update: (next) => {
      // The lists repaint every minute for relative times; only a changed file list repaints the banner.
      if (JSON.stringify(next) === JSON.stringify(loose)) return;
      loose = next;
      paint();
    },
    dispose: () => {
      disposed = true;
      el.remove();
    },
  };
};
