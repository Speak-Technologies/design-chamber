// Keeping your place (documentation/specs/phase-1-5-sdk-2-7.md §3.8): the rail and the full-screen
// page reload whenever the extension updates, and used to start on the list every time. The open
// design's slug is kept in `host.storage` and reopened on start. Pure: no DOM, no host calls.

import { SLUG_PATTERN } from '../../shared/limits.ts';

export type PlaceSurface = 'panel' | 'page';

/** One key per surface, so opening a design in the rail never reopens it in the full-screen page. */
export const placeKey = (surface: PlaceSurface): string => `place:${surface}`;

/** What is stored while a design is open. Going back to the list stores `null`. */
export type StoredPlace = { slug: string };

export const storedPlace = (slug: string): StoredPlace => ({ slug });

/** The remembered slug, or null when nothing (or something unreadable) is stored. Storage is untrusted. */
export const readPlace = (stored: unknown): string | null => {
  if (typeof stored !== 'object' || stored === null || !('slug' in stored)) return null;
  return typeof stored.slug === 'string' && SLUG_PATTERN.test(stored.slug) ? stored.slug : null;
};

export type RestoreInput = {
  /** The raw stored value, once storage has answered. */
  stored: unknown;
  /** The design list, or null until it has loaded. */
  designs: ReadonlyArray<{ slug: string }> | null;
  /** A design is already open: the user opened one, or an open request (Work Status, a chat block, "Open as page") did. */
  alreadyOpen: boolean;
};

export type RestoreDecision =
  /** Nothing to do, and nothing more to wait for. */
  | { action: 'skip' }
  /** Not enough is known yet; ask again when the list loads. */
  | { action: 'wait' }
  | { action: 'open'; slug: string }
  /** The remembered design is gone: forget it and show the list, with no message. */
  | { action: 'drop' };

/**
 * Whether to reopen the remembered design. An open request, or a design the user opened first,
 * always wins over the remembered one. A design that is no longer in the list is dropped quietly.
 */
export const decideRestore = ({ stored, designs, alreadyOpen }: RestoreInput): RestoreDecision => {
  if (alreadyOpen) return { action: 'skip' };
  const slug = readPlace(stored);
  if (slug === null) return { action: 'skip' };
  if (designs === null) return { action: 'wait' };
  return designs.some((design) => design.slug === slug) ? { action: 'open', slug } : { action: 'drop' };
};
