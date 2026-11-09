// View-model of the findability features: the first-run tip, the rail header's Comments chip
// and the notices after a restore. Pure: no DOM, no host.

import type { RestoreVersionResponse } from '../../shared/api.ts';

/** `host.storage` key (instance scope) for the first-run tip. */
export const TIP_KEY = 'tip:full-screen';

/** How long a restore notice that offers Undo stays; the notices region holds it while the pointer or focus is on it. */
export const RESTORE_NOTICE_MS = 10_000;
/** How long the notices without an Undo stay ("Nothing changed", "Back to v8"). */
export const SHORT_NOTICE_MS = 5_000;

/** Only a stored `{ dismissed: true }` hides the tip: a missing, failed or garbled read shows it again. */
export const shouldShowTip = (stored: unknown): boolean => !(typeof stored === 'object' && stored !== null && 'dismissed' in stored && stored.dismissed === true);

/** What "Got it" writes. */
export const dismissedTip = (now: Date): { dismissed: true; at: string } => ({ dismissed: true, at: now.toISOString() });

export const commentsChip = (count: number): { label: string; aria: string } =>
  count > 0 ? { label: String(count), aria: `Comments, ${count} open` } : { label: '', aria: 'Comments' };

type Version = { id: string; n: number };

export type RestoreNotice = {
  title: string;
  body: string;
  /** The version Undo restores, or null when there is nothing to undo. */
  undoTo: Version | null;
};

/**
 * What to tell the user after a restore. `requested` is the version they pressed Restore on:
 * the response's `restored` is the snapshot taken after the restore, which has its own number.
 */
export const restoreNotice = (result: RestoreVersionResponse, requested: { n: number }): RestoreNotice => {
  // An older service build may not send `before`; then there is nothing safe to offer as Undo.
  const before: RestoreVersionResponse['before'] | undefined = result.before;
  if (!before) return { title: `Restored v${requested.n}`, body: 'Your previous state is saved in Versions.', undoTo: null };
  if (before.treeHash === result.restored.treeHash) return { title: `v${requested.n} matches the current design`, body: 'Nothing changed.', undoTo: null };
  const undoTo = { id: before.id, n: before.n };
  return {
    title: `Restored v${requested.n}`,
    body: result.restorePoint ? `Your previous state is saved as v${result.restorePoint.n}.` : `Your previous state is v${before.n} in Versions.`,
    undoTo,
  };
};

/** The notice after Undo put `to` back. There is no Undo of the Undo; the restored version stays in the list. */
export const undoneNotice = (to: { n: number }, undoneFrom: { n: number }): { title: string; body: string } => ({
  title: `Back to v${to.n}`,
  body: `v${undoneFrom.n} is still in Versions.`,
});

/** The Undo that failed: where the user's earlier state is, so nothing feels lost. */
export const undoFailedNotice = (message: string, to: { n: number }): { title: string; body: string } => ({
  title: 'Couldn’t undo',
  body: `${message} Your earlier state is saved as v${to.n} in Versions.`,
});

/** The host error toast when a restore fails. */
export const restoreFailedMessage = (n: number, message: string): string => `Couldn’t restore v${n}. ${message} Nothing was changed.`;
