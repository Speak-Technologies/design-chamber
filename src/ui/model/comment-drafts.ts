// Words typed into a comment card but not saved. A card holding some stays open while the wall or
// the design moves; when it has to close anyway, the text is kept here and the same card shows it
// again. Only Cancel, a save, a send or a delete throw it away. Kept in memory for as long as
// Design Chamber stays open. Pure.

/** The text worth keeping: what differs from the saved words (`''` for a new comment), as typed. Null: nothing to lose. */
export const unsavedText = (value: string, saved = ''): string | null => (value.trim() === '' || value.trim() === saved.trim() ? null : value);

/**
 * The new-comment card of one element. On a canvas each artboard has its own; a page is one
 * document at any View size, so its draft follows the element across sizes.
 */
export const composerDraftKey = (at: { slug: string; screen: string | null; artboard: string; selector: string; pageMode: boolean }): string =>
  JSON.stringify(['new', at.slug, at.pageMode ? at.screen : at.artboard, at.selector]);

export const threadDraftKey = (slug: string, commentId: string): string => JSON.stringify(['thread', slug, commentId]);

export type DraftStore = {
  get: (key: string) => string | null;
  /** What a closing card holds; null forgets anything older. */
  keep: (key: string, text: string | null) => void;
  drop: (key: string) => void;
};

export const createDraftStore = (): DraftStore => {
  const drafts = new Map<string, string>();
  return {
    get: (key) => drafts.get(key) ?? null,
    keep: (key, text) => void (text === null ? drafts.delete(key) : drafts.set(key, text)),
    drop: (key) => void drafts.delete(key),
  };
};
