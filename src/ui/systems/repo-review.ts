// The repo flavour of the Re-sync sheet (Phase 2.5 U6, technical design §7.4 and §9.6): what changed in the repo's
// system folder since Design Chamber last read it, as plain lists, and one Apply. All or nothing: no ticks, no
// conflicts, no Undo (the repo's own history is the way back). Apply posts the scan and the stamp, never a value.
// Every name and value from the repo is set with `textContent`.

import { toServiceError } from '../../guest/service-client.ts';
import { h } from '../components/dom.ts';
import { banner, btn } from '../components/kit.ts';
import { client } from '../guest.ts';
import { failureKind, resyncedSentence } from '../model/resync-model.ts';
import { repoReviewModel, type RepoReviewContext as ModelContext, type RepoReviewRow, type RepoReviewSection } from '../model/system-home-model.ts';
import type { ResyncApplied, RepoReviewContext } from './resync-sheet.ts';

export type RepoReviewOptions = ModelContext & {
  id: string;
  onApplied: (result: ResyncApplied) => void;
};

const rowView = (row: RepoReviewRow): HTMLElement => {
  const values =
    row.from !== null || row.to !== null
      ? h('span', { class: 'dc-resync-values' }, h('code', { class: 'dc-resync-code' }, row.from ?? ''), h('span', { class: 'dc-resync-arrow', 'aria-hidden': 'true' }, '→'), h('code', { class: 'dc-resync-code' }, row.to ?? ''))
      : null;
  return h(
    'li',
    { class: 'dc-resync-row', 'data-repo-row': 'true' },
    h('span', { class: 'dc-resync-name' }, row.name),
    row.tag === null ? null : h('span', { class: 'dc-resync-mode dc-muted' }, row.tag),
    values,
    row.note === null ? null : h('span', { class: 'dc-resync-rownote dc-muted' }, row.note),
  );
};

const sectionView = (section: RepoReviewSection): HTMLElement =>
  h(
    'section',
    { class: 'dc-resync-group', 'data-group': section.id },
    h('div', { class: 'dc-resync-grouphead' }, h('h3', { class: 'dc-resync-title' }, section.title, h('span', { class: 'dc-resync-count dc-muted' }, String(section.count)))),
    h('ul', { class: 'dc-resync-list' }, ...section.rows.map(rowView)),
    section.more > 0 ? h('p', { class: 'dc-muted dc-resync-hint' }, `and ${section.more} more`) : null,
  );

/** Draw the review into the sheet's body and foot. Called once per finished scan. */
export const paintRepoReview = (context: RepoReviewContext, options: RepoReviewOptions): void => {
  const model = repoReviewModel(context.review as Parameters<typeof repoReviewModel>[0], options);
  let problem: { title: string; body: string } | null = null;
  let busy = false;
  let stale = false;

  const draw = (): void => {
    context.body.replaceChildren();
    context.foot.replaceChildren();
    if (busy) context.body.setAttribute('inert', '');
    else context.body.removeAttribute('inert');

    if (stale) {
      context.body.append(h('p', { class: 'dc-form-error', role: 'alert' }, problem?.body ?? ''));
      context.foot.append(btn({ label: 'Not now', variant: 'outline', onClick: () => context.close() }).el, btn({ label: 'Scan again', variant: 'default', emphasis: 'primary', onClick: () => context.scanAgain() }).el);
      return;
    }
    if (problem) context.body.append(banner({ tone: 'error', title: problem.title, body: problem.body }));

    if (model.nothingChanged && model.blocked === null) {
      context.body.append(h('p', { class: 'dc-resync-matches', role: 'status' }, model.matches));
      if (model.refused !== null) context.body.append(h('p', { class: 'dc-muted' }, model.refused));
      context.foot.append(btn({ label: 'Close', variant: 'outline', onClick: () => context.close() }).el);
      return;
    }

    context.body.append(h('p', { class: 'dc-muted dc-resync-intro' }, model.intro));
    if (model.repoint !== null) context.body.append(h('p', { class: 'dc-resync-repoint' }, model.repoint));
    if (model.blocked !== null) context.body.append(h('p', { class: 'dc-form-error', role: 'alert' }, model.blocked));
    for (const section of model.sections) context.body.append(sectionView(section));
    if (model.refused !== null) context.body.append(h('p', { class: 'dc-muted dc-resync-foot-note' }, model.refused));

    const apply = btn({ label: 'Apply', variant: 'default', emphasis: 'primary', loading: busy, disabled: model.blocked !== null || busy, ...(model.blocked !== null ? { title: model.blocked } : {}), onClick: () => void run() });
    context.foot.append(btn({ label: 'Not now', variant: 'outline', disabled: busy, onClick: () => context.close() }).el, apply.el);
  };

  const run = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    problem = null;
    draw();
    try {
      const response = await client.call('POST /systems/:id/resync', { params: { id: options.id }, body: { scanId: context.scanId, stamp: context.stamp } });
      const counts = { changed: response.counts.changed, added: response.counts.added, removed: response.counts.removed, files: 0 };
      context.close();
      options.onApplied({ response, counts, sentence: resyncedSentence(options.systemName, counts) });
    } catch (error) {
      busy = false;
      const failure = toServiceError(error);
      const kind = failureKind(failure.code, failure.message);
      problem = { title: 'Nothing was changed', body: failure.message };
      stale = kind === 'stale' || failure.code === 'stale';
      draw();
    }
  };

  draw();
};
