// Versions (P4): every saved state of a design, newest first. View a version on the wall,
// compare it with the current design, or restore it (the current state is saved first).

import { mountBadge } from '@openchamber/sdk/ui';

import type { VersionDiffResponse } from '../../shared/api.ts';
import { host, store } from '../guest.ts';
import { relativeTime } from '../model/format.ts';
import { changeLabel, historyNotice, versionRows, type VersionRow } from '../model/versions-model.ts';
import { toast } from './actions.ts';
import { createScope, errorText, h } from './dom.ts';
import { banner, btn, loadingRow } from './kit.ts';

export type VersionsHandle = { el: HTMLElement; refresh: () => void; /** Focus that version's Restore button, if it is listed and enabled. */ focusRestore: (id: string) => void; dispose: () => void };

export type VersionsOptions = {
  slug: string;
  /** The version the wall shows, if any, and whether it is split against the current design. */
  viewing: () => { id: string; compare: boolean } | null;
  onView: (id: string) => void;
  onCompare: (id: string) => void;
  onBackToCurrent: () => void;
  /** The version being restored right now, or null: its Restore shows progress, the others are disabled. */
  restoring: () => string | null;
  /** Seam S10: restore this version. The view owns the flow (restore, then an Undo notice); it reports its own errors and never rejects. */
  onRestore: (version: { id: string; n: number }) => Promise<void>;
};

export const mountVersions = (options: VersionsOptions): VersionsHandle => {
  const scope = createScope();
  const el = h('div', { class: 'dc-versions' });
  let snapshotBusy = false;
  let diff: { id: string; state: 'loading' | 'ready' | 'error'; files: VersionDiffResponse['files']; error: string | null } | null = null;
  let diffToken = 0;

  const loadDiff = async (id: string): Promise<void> => {
    diffToken += 1;
    const mine = diffToken;
    diff = { id, state: 'loading', files: [], error: null };
    paint();
    try {
      const answer = await store.diffVersion(options.slug, id, 'current');
      if (mine === diffToken) diff = { id, state: 'ready', files: answer.files, error: null };
    } catch (error) {
      if (mine === diffToken) diff = { id, state: 'error', files: [], error: errorText(error) };
    }
    paint();
  };

  const snapshot = async (): Promise<void> => {
    snapshotBusy = true;
    paint();
    try {
      const created = await store.snapshotVersion(options.slug);
      toast('info', created ? `Saved as v${created.n}.` : 'Nothing has changed since the last version.');
    } catch (error) {
      toast('error', `Couldn’t save a version. ${errorText(error)}`);
    } finally {
      snapshotBusy = false;
      paint();
    }
  };

  const restore = (row: VersionRow): void => void options.onRestore({ id: row.id, n: row.n });

  const restoreButton = (row: VersionRow, restoring: string | null): HTMLElement => {
    const button = btn({ label: 'Restore', variant: 'ghost', size: 'xs', loading: restoring === row.id, disabled: restoring !== null && restoring !== row.id, onClick: () => restore(row) });
    button.el.dataset.restore = row.id;
    return button.el;
  };

  const rowEl = (row: VersionRow, viewing: { id: string; compare: boolean } | null): HTMLElement => {
    const active = viewing?.id === row.id;
    const restoring = options.restoring();
    const badge = h('span');
    if (row.current) mountBadge(badge, { label: 'Current', tone: 'success' });
    const actions = h(
      'div',
      { class: 'dc-version-actions' },
      btn({ label: active && !viewing?.compare ? 'Viewing' : 'View', variant: 'outline', size: 'xs', pressed: active && !viewing?.compare, onClick: () => { options.onView(row.id); void loadDiff(row.id); } }).el,
      btn({ label: active && viewing?.compare ? 'Comparing' : 'Compare', variant: 'outline', size: 'xs', icon: 'compare', pressed: active && viewing?.compare, onClick: () => { options.onCompare(row.id); void loadDiff(row.id); } }).el,
      row.current ? null : restoreButton(row, restoring),
    );
    const changed =
      active && diff && diff.id === row.id
        ? diff.state === 'loading'
          ? loadingRow('Comparing files…')
          : diff.state === 'error'
            ? h('p', { class: 'dc-form-error' }, `Couldn’t compare. ${diff.error ?? ''}`)
            : h(
                'ul',
                { class: 'dc-diff', 'aria-label': `Files changed since v${row.n}` },
                ...(diff.files.length === 0 ? [h('li', { class: 'dc-muted' }, 'Identical to the current design.')] : diff.files.map((file) => h('li', null, h('span', { class: 'dc-diff-kind', 'data-change': file.change }, changeLabel(file.change)), h('code', { class: 'dc-path' }, file.path)))),
              )
        : null;
    return h(
      'li',
      { class: 'dc-version', 'data-active': active ? 'true' : 'false' },
      h('div', { class: 'dc-version-head' }, h('span', { class: 'dc-version-n' }, row.title), badge, h('span', { class: 'dc-muted dc-version-when' }, relativeTime(row.created, Date.now(), host.snapshot()?.locale ?? 'en'))),
      h('p', { class: 'dc-version-reason' }, row.label ?? row.reason, h('span', { class: 'dc-muted' }, ` · ${row.fileCount} files`)),
      actions,
      changed,
    );
  };

  const paint = (): void => {
    const versions = store.getState().versions;
    const state = versions?.slug === options.slug ? versions : null;
    el.replaceChildren();
    if (!state || state.status === 'idle' || (state.status === 'loading' && !state.data)) {
      el.append(loadingRow('Loading versions…'));
      return;
    }
    if (!state.data) {
      el.append(banner({ tone: 'error', title: 'Versions didn’t load', body: state.error?.message ?? 'The local service didn’t answer.', action: { label: 'Try again', onClick: () => void store.loadVersions(options.slug) } }));
      return;
    }
    const { history } = state.data;
    const notice = history ? banner(historyNotice(history)) : null;
    if (notice && history === 'unsupported') {
      // A newer build owns this history: no list, no "Save a version now", no empty state.
      el.append(notice);
      return;
    }
    const { dirty } = state.data;
    const rows = versionRows(state.data.versions, dirty);
    const viewing = options.viewing();
    const save = btn({ label: 'Save a version now', variant: dirty ? 'default' : 'outline', icon: 'history', loading: snapshotBusy, onClick: () => void snapshot() });
    const dirtyRow = dirty
      ? h('li', { class: 'dc-version dc-version-dirty' }, h('div', { class: 'dc-version-head' }, h('span', { class: 'dc-version-n' }, 'Unsaved changes'), h('span', { class: 'dc-muted' }, 'Now')), h('p', { class: 'dc-version-reason' }, 'The files changed since the last version. Versions are also saved after each agent turn.'))
      : null;
    const back = viewing ? btn({ label: 'Back to current', variant: 'outline', icon: 'back', onClick: () => options.onBackToCurrent() }) : null;
    const list = rows.length === 0 && !dirty
      ? h('div', { class: 'dc-empty' }, h('p', { class: 'dc-empty-title' }, 'No versions yet'), h('p', { class: 'dc-empty-body' }, 'A version is saved after each agent turn. You can also save one now.'))
      : h('ul', { class: 'dc-version-list' }, dirtyRow, ...rows.map((row) => rowEl(row, viewing)));
    el.append(...(notice ? [notice] : []), h('div', { class: 'dc-versions-bar' }, back?.el ?? null, save.el), list);
  };

  scope.add(store.subscribe(paint));
  paint();
  return {
    el,
    refresh: paint,
    focusRestore: (id) => el.querySelector<HTMLElement>(`[data-restore="${CSS.escape(id)}"]`)?.focus(),
    dispose: () => {
      scope.dispose();
      el.remove();
    },
  };
};
