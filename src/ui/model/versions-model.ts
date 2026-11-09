// View-model of the versions drawer (P4).

import type { BannerTone } from '@openchamber/sdk/ui';

import type { VersionHistoryState } from '../../shared/api.ts';
import type { VersionFileChange, VersionReason, VersionSummary } from '../../shared/types.ts';

export const reasonLabel = (reason: VersionReason): string => {
  switch (reason) {
    case 'auto':
      return 'Auto-saved';
    case 'turn':
      return 'After agent turn';
    case 'manual':
      return 'Saved manually';
    case 'restore-point':
      return 'Before restore';
    case 'restored':
      return 'Restored';
  }
};

export type VersionRow = {
  id: string;
  n: number;
  created: string;
  title: string;
  reason: string;
  fileCount: number;
  /** The newest version with nothing changed since: what the wall shows now. */
  current: boolean;
  label: string | null;
};

/** Newest first. `dirty` means the folder differs from the newest version, so none is "current". */
export const versionRows = (versions: readonly VersionSummary[], dirty: boolean): VersionRow[] => {
  const ordered = [...versions].sort((a, b) => b.n - a.n);
  return ordered.map((version, index) => ({
    id: version.id,
    n: version.n,
    created: version.created,
    title: `v${version.n}`,
    reason: reasonLabel(version.reason),
    fileCount: version.fileCount,
    current: index === 0 && !dirty,
    label: version.label ?? null,
  }));
};

export const changeLabel = (change: VersionFileChange): string => (change === 'added' ? 'Added' : change === 'removed' ? 'Removed' : 'Changed');

/** The banner while a version is open: "Viewing v12" or "Comparing v12 with current". */
export const viewingBanner = (versionNumber: number, compare: boolean): string =>
  compare ? `Comparing v${versionNumber} with the current design` : `Viewing v${versionNumber} (read only)`;

export const restoreConfirmBody = (versionNumber: number): string =>
  `The design goes back to v${versionNumber}. Your current files are saved as a version first, so you can return to them.`;

/** The notice above the list when the service had to repair, recover or reset it, or a newer build wrote it. */
export const historyNotice = (state: VersionHistoryState): { tone: BannerTone; title: string; body: string } => {
  switch (state) {
    case 'repaired':
      return { tone: 'warning', title: 'Some versions could not be read', body: 'They are hidden from this list. Their saved files are kept in this design’s .versions folder.' };
    case 'recovered':
      return { tone: 'warning', title: 'Version list restored from its backup', body: 'The list was damaged and has been rebuilt. The newest version may be missing.' };
    case 'reset':
      return { tone: 'warning', title: 'Older versions could not be recovered', body: 'The version list was damaged and had no usable backup. New versions are saved as usual, and the old files are kept in this design’s .versions folder.' };
    case 'unsupported':
      return { tone: 'info', title: 'Saved by a newer Design Chamber', body: 'Update the extension to see, save or restore versions of this design.' };
  }
};
