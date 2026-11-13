// The viewer's "More actions" menu, defined in one place. The rail's compact header carries the
// extra entries (continue, export, copy) because it has no room for buttons (Comments and Versions
// sit beside the title instead);
// the full-screen page shows those as toolbar buttons and keeps only the design-level entries here.

import type { MenuEntry } from '../components/kit.ts';
import { PAGE_DATA_CLEAR_LABEL, PAGE_DATA_DISABLED_REASON, type PageDataEntry } from './page-state-model.ts';
import { ASK_FOR_TWEAKS_LABEL } from './tweaks-model.ts';

export type ViewerMenuInput = {
  /** The rail viewer (compact header). */
  compact: boolean;
  isPage: boolean;
  /** The page's HTML is over the clipboard cap, so "Copy HTML" is offered disabled. */
  copyHtmlTooLarge: boolean;
  /** The design declares no tweaks (and no old version is on show): offer "Ask for tweaks", which fills the ask bar. */
  askForTweaks?: boolean;
  /** Saved page data: `enabled` or `disabled` shows "Clear saved page data" (before Rename), `hidden` or absent leaves it out. */
  pageData?: PageDataEntry;
};

const reveal: MenuEntry = { id: 'reveal', label: 'Reveal in folder' };
const copyPath: MenuEntry = { id: 'path', label: 'Copy path' };
const rename: MenuEntry = { id: 'rename', label: 'Rename' };
const remove: MenuEntry = { id: 'delete', label: 'Delete…', destructive: true };
const askTweaks: MenuEntry = { id: 'ask-tweaks', label: ASK_FOR_TWEAKS_LABEL };

/** "Clear saved page data" while the design has some; off, with its reason, while an old version is on show. */
const clearPageData = (state: PageDataEntry | undefined): MenuEntry[] =>
  state === 'enabled' || state === 'disabled'
    ? [{ id: 'page-data', label: PAGE_DATA_CLEAR_LABEL, ...(state === 'disabled' ? { disabled: true, reason: PAGE_DATA_DISABLED_REASON } : {}) }]
    : [];

/** Design-level entries every viewer shows. */
const baseEntries = (pageData: PageDataEntry | undefined): MenuEntry[] => [reveal, copyPath, ...clearPageData(pageData), rename, { separator: true }, remove];

export const viewerMenuEntries = (input: ViewerMenuInput): MenuEntry[] => {
  // A design with no knobs gets one way to ask for some, right after the chat link in the rail and first on the page.
  const ask: MenuEntry[] = input.askForTweaks ? [askTweaks] : [];
  if (input.compact) {
    return [
      { id: 'chat', label: 'Continue in chat' },
      ...ask,
      { separator: true },
      { id: 'zip', label: 'Export ZIP' },
      { id: 'html', label: input.isPage ? 'Export single-file HTML' : 'Export screen as HTML…' },
      ...(input.isPage ? [{ id: 'copy-html', label: 'Copy HTML', disabled: input.copyHtmlTooLarge, hint: input.copyHtmlTooLarge ? 'too large' : undefined } satisfies MenuEntry] : []),
      copyPath,
      reveal,
      ...clearPageData(input.pageData),
      rename,
      { separator: true },
      remove,
    ];
  }
  const rest: MenuEntry[] = input.isPage ? baseEntries(input.pageData) : [{ id: 'zip', label: 'Export ZIP' }, { id: 'html', label: 'Export screen as HTML…' }, { separator: true }, ...baseEntries(input.pageData)];
  return input.askForTweaks ? [askTweaks, { separator: true }, ...rest] : rest;
};
