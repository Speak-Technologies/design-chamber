// Versions of one design system (Phase 2.5 U2, technical design §9.3): the same drawer and the same restore with
// Undo as a design, on the system's own routes (`/systems/:id/versions`). A design's drawer reads the design store,
// so this is its twin over the system routes, built from the same view-model and restore core. Compare shows the
// changed files only; the board shows the old version, read only.

import { mountBadge } from '@openchamber/sdk/ui';

import type { VersionDiffResponse, VersionListResponse } from '../../shared/api.ts';
import { toast } from '../components/actions.ts';
import { createScope, errorText, h } from '../components/dom.ts';
import { banner, bannerWithActions, btn, loadingRow, type BtnHandle } from '../components/kit.ts';
import type { NoticesHandle } from '../components/notices.ts';
import { client, host } from '../guest.ts';
import { relativeTime } from '../model/format.ts';
import { createRestoreCore, type Version } from '../model/restore-core.ts';
import { changeLabel, historyNotice, versionRows, type VersionRow } from '../model/versions-model.ts';

export type SystemVersionsOptions = {
  id: string;
  viewing: () => { id: string; compare: boolean } | null;
  onView: (id: string, n: number) => void;
  onCompare: (id: string, n: number) => void;
  onBackToCurrent: () => void;
  restoring: () => string | null;
  onRestore: (version: Version) => Promise<void>;
};

export type SystemVersionsHandle = { el: HTMLElement; refresh: () => void; load: () => Promise<void>; focusRestore: (id: string) => void; dispose: () => void };

type Listed = { status: 'loading' | 'ready' | 'error'; data: VersionListResponse | null; error: string | null };

export const mountSystemVersions = (options: SystemVersionsOptions): SystemVersionsHandle => {
  const scope = createScope();
  const el = h('div', { class: 'dc-versions' });
  let listed: Listed = { status: 'loading', data: null, error: null };
  let diff: { id: string; state: 'loading' | 'ready' | 'error'; files: VersionDiffResponse['files']; error: string | null } | null = null;
  let diffToken = 0;
  let loadToken = 0;

  const load = async (): Promise<void> => {
    loadToken += 1;
    const mine = loadToken;
    if (listed.data === null) listed = { status: 'loading', data: null, error: null };
    paint();
    try {
      const data = await client.call('GET /systems/:id/versions', { params: { id: options.id } });
      if (mine === loadToken) listed = { status: 'ready', data, error: null };
    } catch (error) {
      if (mine === loadToken) listed = { status: 'error', data: listed.data, error: errorText(error) };
    }
    paint();
  };

  const loadDiff = async (id: string): Promise<void> => {
    diffToken += 1;
    const mine = diffToken;
    diff = { id, state: 'loading', files: [], error: null };
    paint();
    try {
      const answer = await client.call('GET /systems/:id/versions/:vid/diff', { params: { id: options.id, vid: id }, query: { against: 'current' } });
      if (mine === diffToken) diff = { id, state: 'ready', files: answer.files, error: null };
    } catch (error) {
      if (mine === diffToken) diff = { id, state: 'error', files: [], error: errorText(error) };
    }
    paint();
  };

  const restoreButton = (row: VersionRow, restoring: string | null): HTMLElement => {
    const button = btn({ label: 'Restore', variant: 'ghost', size: 'xs', loading: restoring === row.id, disabled: restoring !== null && restoring !== row.id, onClick: () => void options.onRestore({ id: row.id, n: row.n }) });
    button.el.dataset.restore = row.id;
    return button.el;
  };

  const rowEl = (row: VersionRow, viewing: { id: string; compare: boolean } | null): HTMLElement => {
    const active = viewing?.id === row.id;
    const badge = h('span');
    if (row.current) mountBadge(badge, { label: 'Current', tone: 'success' });
    const actions = h(
      'div',
      { class: 'dc-version-actions' },
      btn({ label: active && !viewing?.compare ? 'Viewing' : 'View', variant: 'outline', size: 'xs', pressed: active && !viewing?.compare, onClick: () => { options.onView(row.id, row.n); void loadDiff(row.id); } }).el,
      btn({ label: active && viewing?.compare ? 'Comparing' : 'Compare', variant: 'outline', size: 'xs', icon: 'compare', pressed: active && viewing?.compare, onClick: () => { options.onCompare(row.id, row.n); void loadDiff(row.id); } }).el,
      row.current ? null : restoreButton(row, options.restoring()),
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
                ...(diff.files.length === 0 ? [h('li', { class: 'dc-muted' }, 'Identical to the current design system.')] : diff.files.map((file) => h('li', null, h('span', { class: 'dc-diff-kind', 'data-change': file.change }, changeLabel(file.change)), h('code', { class: 'dc-path' }, file.path)))),
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

  function paint(): void {
    el.replaceChildren();
    if (listed.status === 'loading' && !listed.data) {
      el.append(loadingRow('Loading versions…'));
      return;
    }
    if (!listed.data) {
      el.append(banner({ tone: 'error', title: 'Versions didn’t load', body: listed.error ?? 'The local service didn’t answer.', action: { label: 'Try again', onClick: () => void load() } }));
      return;
    }
    const { history, dirty } = listed.data;
    const notice = history ? banner(historyNotice(history)) : null;
    if (notice && history === 'unsupported') {
      el.append(notice);
      return;
    }
    const rows = versionRows(listed.data.versions, dirty);
    const viewing = options.viewing();
    const dirtyRow = dirty
      ? h('li', { class: 'dc-version dc-version-dirty' }, h('div', { class: 'dc-version-head' }, h('span', { class: 'dc-version-n' }, 'Unsaved changes'), h('span', { class: 'dc-muted' }, 'Now')), h('p', { class: 'dc-version-reason' }, 'The files changed since the last version. A version is saved before each of your edits and after each agent turn.'))
      : null;
    const back = viewing ? btn({ label: 'Back to current', variant: 'outline', icon: 'back', onClick: () => options.onBackToCurrent() }) : null;
    const list =
      rows.length === 0 && !dirty
        ? h('div', { class: 'dc-empty' }, h('p', { class: 'dc-empty-title' }, 'No versions yet'), h('p', { class: 'dc-empty-body' }, 'A version is saved before each of your edits and after each agent turn.'))
        : h('ul', { class: 'dc-version-list' }, dirtyRow, ...rows.map((row) => rowEl(row, viewing)));
    el.append(...(notice ? [notice] : []), ...(back ? [h('div', { class: 'dc-versions-bar' }, back.el)] : []), list);
  }

  paint();
  void load();
  scope.add(() => {
    loadToken += 1;
    diffToken += 1;
  });
  return {
    el,
    refresh: paint,
    load,
    focusRestore: (id) => el.querySelector<HTMLElement>(`[data-restore="${CSS.escape(id)}"]`)?.focus(),
    dispose: () => {
      scope.dispose();
      el.remove();
    },
  };
};

// ---- Restore with Undo ----

export type SystemRestoreOptions = {
  id: string;
  notices: NoticesHandle;
  /** Reload the system and its board after a restore or an Undo. */
  refresh: () => Promise<void>;
  /** A restore or Undo went through: leave version viewing, close the drawer. */
  onRestored: () => void;
  onBusy: () => void;
  focusBoard: () => void;
  onFailed: (version: Version) => void;
};

export type SystemRestore = { restore: (version: Version) => Promise<void>; busyId: () => string | null; dispose: () => void };

export const createSystemRestore = (options: SystemRestoreOptions): SystemRestore => {
  const { notices } = options;
  let noticeButtons: BtnHandle[] = [];

  const show = (tone: 'success' | 'error', title: string, body: string, buttons: BtnHandle[], ttlMs?: number): void => {
    noticeButtons = buttons;
    if (buttons.length === 0) {
      notices.setTransient('restore', banner({ tone, title, body }), ttlMs);
      return;
    }
    const wrap = h('div', { class: 'dc-banner dc-restore-notice', 'data-actions': 'stack' });
    wrap.append(...bannerWithActions(tone, title, [body], buttons.map((button) => button.el)));
    notices.setTransient('restore', wrap, ttlMs);
  };

  const keepFocus = (): void => {
    const active = document.activeElement;
    if (!active || active === document.body) options.focusBoard();
  };

  const core = createRestoreCore({
    restore: (versionId) => client.call('POST /systems/:id/versions/:vid/restore', { params: { id: options.id, vid: versionId } }),
    refresh: options.refresh,
    describe: errorText,
    view: {
      busy: (versionId) => {
        for (const button of noticeButtons) button.set({ disabled: versionId !== null, title: versionId !== null ? 'Another restore is running.' : undefined });
        options.onBusy();
      },
      restoreFailed: (version, message) => {
        toast('error', message);
        options.onFailed(version);
      },
      reloaded: () => options.onRestored(),
      restored: (version, notice, ttlMs) => {
        const undoTo = notice.undoTo;
        if (!undoTo) show('success', notice.title, notice.body, [], ttlMs);
        else {
          const undoButton = btn({
            label: 'Undo',
            variant: 'outline',
            size: 'xs',
            onClick: () => {
              if (core.busyId() !== null) return;
              undoButton.set({ loading: true });
              void core.undo(undoTo, version);
            },
          });
          show('success', notice.title, notice.body, [undoButton], ttlMs);
        }
        keepFocus();
      },
      undone: (notice, ttlMs) => {
        show('success', notice.title, notice.body, [], ttlMs);
        options.focusBoard();
      },
      undoFailed: (to, from, notice) => {
        const again = btn({
          label: 'Try again',
          variant: 'outline',
          size: 'xs',
          onClick: () => {
            if (core.busyId() !== null) return;
            again.set({ loading: true });
            void core.undo(to, from);
          },
        });
        const dismiss = btn({
          label: 'Dismiss',
          variant: 'ghost',
          size: 'xs',
          onClick: () => {
            noticeButtons = [];
            notices.setTransient('restore', null);
            options.focusBoard();
          },
        });
        show('error', notice.title, notice.body, [again, dismiss]);
        again.el.focus();
      },
    },
  });

  return { restore: core.restore, busyId: core.busyId, dispose: core.dispose };
};
