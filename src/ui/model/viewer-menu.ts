// The viewer's "More actions" menu, defined in one place. The rail's compact header carries the
// extra entries (continue, export, copy, versions, comments) because it has no room for buttons;
// the full-screen page shows those as toolbar buttons and keeps only the design-level entries here.

import type { MenuEntry } from '../components/kit.ts';

export type ViewerMenuInput = {
  /** The rail viewer (compact header). */
  compact: boolean;
  isPage: boolean;
  /** Open comments, shown in the "Comments (n)" entry. */
  openComments: number;
  /** The page's HTML is over the clipboard cap, so "Copy HTML" is offered disabled. */
  copyHtmlTooLarge: boolean;
};

const reveal: MenuEntry = { id: 'reveal', label: 'Reveal in folder' };
const copyPath: MenuEntry = { id: 'path', label: 'Copy path' };
const rename: MenuEntry = { id: 'rename', label: 'Rename' };
const remove: MenuEntry = { id: 'delete', label: 'Delete…', destructive: true };

/** Design-level entries every viewer shows. */
const baseEntries = (): MenuEntry[] => [reveal, copyPath, rename, { separator: true }, remove];

export const viewerMenuEntries = (input: ViewerMenuInput): MenuEntry[] => {
  if (input.compact) {
    return [
      { id: 'chat', label: 'Continue in chat' },
      { separator: true },
      { id: 'zip', label: 'Export ZIP' },
      { id: 'html', label: input.isPage ? 'Export single-file HTML' : 'Export screen as HTML…' },
      ...(input.isPage ? [{ id: 'copy-html', label: 'Copy HTML', disabled: input.copyHtmlTooLarge, hint: input.copyHtmlTooLarge ? 'too large' : undefined } satisfies MenuEntry] : []),
      copyPath,
      reveal,
      { separator: true },
      { id: 'versions', label: 'Versions' },
      { id: 'comments', label: `Comments (${input.openComments})` },
      rename,
      { separator: true },
      remove,
    ];
  }
  return input.isPage ? baseEntries() : [{ id: 'zip', label: 'Export ZIP' }, { id: 'html', label: 'Export screen as HTML…' }, { separator: true }, ...baseEntries()];
};
