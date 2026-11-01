// View-model of the loose-HTML banner (rail R1, library P1): a `.html` file saved straight into the
// designs folder is not a design, so the list offers to import it as a page. Pure: no DOM, no host.

import type { ImportLooseResponse } from '../../shared/api.ts';
import type { LooseHtmlFile } from '../../shared/types.ts';

/** `host.storage` key holding the sorted names the user said "Not now" to. */
export const LOOSE_DISMISSED_KEY = 'loose-dismissed';

/** Names shown in the banner body before "+ n more". */
export const LOOSE_BANNER_NAMES = 3;

export type LooseList = { files: readonly LooseHtmlFile[]; total: number };

/** What the banner shows: one file gets a direct Import, several get a Review sheet. */
export type LooseBanner =
  | { mode: 'single'; title: string; name: string; body: string }
  | { mode: 'many'; title: string; body: string };

/** The list as the dismissal remembers it: sorted names, so the order the service lists them in does not matter. */
export const looseKey = (files: readonly LooseHtmlFile[]): string[] => files.map((file) => file.name).sort();

/** True when the user dismissed exactly this set of files; any added or removed file brings the banner back. */
export const isDismissed = (files: readonly LooseHtmlFile[], dismissed: readonly string[] | null): boolean => {
  if (dismissed === null) return false;
  const current = looseKey(files);
  return current.length === dismissed.length && current.every((name, index) => name === dismissed[index]);
};

/** Reads the stored dismissal defensively: storage is shared and may hold anything. */
export const parseDismissed = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string') ? [...value].sort() : null;

/** The banner for this list, or null when there is nothing to offer or the user dismissed this exact set. */
export const looseBanner = (loose: LooseList | null | undefined, dismissed: readonly string[] | null): LooseBanner | null => {
  if (!loose || loose.total <= 0) return null;
  if (isDismissed(loose.files, dismissed)) return null;
  const first = loose.files[0];
  if (loose.total === 1 && first) {
    return { mode: 'single', title: '1 HTML file here isn’t a design yet.', name: first.name, body: 'Import it as a page? The original moves to .trash in your designs folder.' };
  }
  const names = loose.files.slice(0, LOOSE_BANNER_NAMES).map((file) => file.name);
  const more = loose.total - names.length;
  const listed = names.join(', ');
  const body = more > 0 ? (listed === '' ? `${loose.total} files` : `${listed} + ${more} more`) : listed;
  return { mode: 'many', title: `${loose.total} HTML files here aren’t designs yet.`, body };
};

/** The toast after an import: success with an Open action, or a note that the original stayed put. */
export const importOutcome = (result: ImportLooseResponse): { kind: 'success' | 'info'; message: string } =>
  result.originalMovedTo === null
    ? { kind: 'info', message: 'Imported. The original couldn’t be moved to .trash, so it’s still in your designs folder.' }
    : { kind: 'success', message: `Imported “${result.title}” as a page.` };

/** Review sheet footnote when the service listed fewer names than it counted. */
export const unlistedNote = (loose: LooseList): string | null => {
  const hidden = loose.total - loose.files.length;
  if (hidden <= 0) return null;
  return hidden === 1 ? '1 more file isn’t listed here. Import these first and it shows up.' : `${hidden} more files aren’t listed here. Import these first and they show up.`;
};
