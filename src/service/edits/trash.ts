// Trash names for screen files a hand edit moves away (Phase 2 technical design §5.2, §2.1).
//
// A trashed screen file goes to `<root>/.trash/<slug>.<screenId>-<yyyymmddhhmmss>[-n].html`.
// The dot cannot occur in a slug or a screen id, so the name never clashes with a trashed
// design folder (`<slug>-<stamp>/`) or a loose original (`<stem>-<stamp>.html`) of another slug.
// Places are written into `.chamber/edits.json`; `isOwnTrashPlace` is the only shape the edits
// file accepts for one, so a tampered file can only name this design's own trash entries.

import { mkdir } from 'node:fs/promises';

import { SCREEN_ID_PATTERN } from '../../shared/limits.ts';
import { resolveInside } from '../paths.ts';

/** The root-relative folder trash places start with. */
export const TRASH_PREFIX = '.trash/';

/** `-2` to `-99` after the bare name: then the trash refuses (409 conflict, §5.2). */
export const TRASH_SUFFIX_MAX = 99;

/** Local time, the same `yyyymmddhhmmss` the store gives a trashed design folder. */
export const trashStampOf = (date: Date): string => {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
};

/** `.trash/<slug>.<screenId>-<stamp>[-n].html`; `n` 1 is the bare name. */
export const trashPlaceOf = (slug: string, screenId: string, stamp: string, n = 1): string =>
  `${TRASH_PREFIX}${slug}.${screenId}-${stamp}${n > 1 ? `-${n}` : ''}.html`;

const TRASH_NAME = /^([a-z0-9][a-z0-9-]{0,62})\.([a-z0-9][a-z0-9-]{0,40})-([0-9]{14})(?:-([0-9]{1,2}))?\.html$/;

export type TrashName = { slug: string; screenId: string; stamp: string; n: number };

/** Parses a trash place this module minted; `null` for anything else. */
export const parseTrashPlace = (place: string): TrashName | null => {
  if (!place.startsWith(TRASH_PREFIX)) return null;
  const match = TRASH_NAME.exec(place.slice(TRASH_PREFIX.length));
  if (match === null) return null;
  const [, slug = '', screenId = '', stamp = '', suffix] = match;
  if (!SCREEN_ID_PATTERN.test(screenId)) return null;
  const n = suffix === undefined ? 1 : Number(suffix);
  if (suffix !== undefined && (n < 2 || n > TRASH_SUFFIX_MAX)) return null;
  return { slug, screenId, stamp, n };
};

/** True for a trash place that belongs to `slug` (the only trash shape an undo may touch). */
export const isOwnTrashPlace = (place: string, slug: string): boolean => parseTrashPlace(place)?.slug === slug;

/** The trash name after `place` (`-n` + 1), or `null` past `-99` or for a place that is not a trash name. */
export const nextTrashPlace = (place: string): string | null => {
  const parsed = parseTrashPlace(place);
  if (parsed === null || parsed.n >= TRASH_SUFFIX_MAX) return null;
  return trashPlaceOf(parsed.slug, parsed.screenId, parsed.stamp, parsed.n + 1);
};

/** The contained `<root>/.trash` folder, created when missing (as `store.trash` does). */
export const ensureTrashDir = async (root: string): Promise<string> => {
  const dir = await resolveInside(root, ['.trash']);
  await mkdir(dir, { recursive: true });
  return dir;
};
