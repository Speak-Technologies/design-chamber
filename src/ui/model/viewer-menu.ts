// The viewer's "More actions" menu, defined in one place. The rail's compact header carries the
// extra entries (continue, export, copy) because it has no room for buttons (Comments and Versions
// sit beside the title instead; Tweaks does too until the rail is narrower than NARROW_RAIL_QUERY,
// where it moves in here and the title gets its room back);
// the full-screen page shows those as toolbar buttons and keeps only the design-level entries here.

import type { MenuEntry } from '../components/kit.ts';
import { PAGE_DATA_CLEAR_LABEL, PAGE_DATA_DISABLED_REASON, type PageDataEntry } from './page-state-model.ts';
import { ASK_FOR_TWEAKS_LABEL } from './tweaks-model.ts';

/**
 * A rail narrower than this has no room for the Tweaks icon button beside the title (the title needs 120 px at
 * 320). `styles.css` hides the button under the same width; keep the two numbers together.
 */
export const NARROW_RAIL_QUERY = '(max-width: 359.98px)';

export type ViewerMenuInput = {
  /** The rail viewer (compact header). */
  compact: boolean;
  isPage: boolean;
  /** The page's HTML is over the clipboard cap, so "Copy HTML" is offered disabled. */
  copyHtmlTooLarge: boolean;
  /** The design declares no tweaks (and no old version is on show): offer "Ask for tweaks", which fills the ask bar. */
  askForTweaks?: boolean;
  /** The rail is narrow and the design has tweaks: the menu item that stands in for the hidden Tweaks button, with its label. */
  railTweaks?: string | null;
  /** Saved page data: `enabled` or `disabled` shows "Clear saved page data" (before Rename), `hidden` or absent leaves it out. */
  pageData?: PageDataEntry;
  /** On a phone: leave out what acts on the computer that runs OpenChamber (see `withoutComputerOnly`). */
  phone?: boolean;
};

/**
 * Entries that act on the computer that runs OpenChamber, not on the phone in the user's hand: Reveal opens a
 * folder there, Export (a design's ZIP or HTML, a system's tokens) saves into that computer's export folder, Copy
 * path names a path on its disk (documentation/specs/native-extras.md §2.2). The service keeps every check; this
 * only hides them.
 */
const COMPUTER_ONLY: ReadonlySet<string> = new Set(['reveal', 'zip', 'html', 'path', 'export']);

const isSeparator = (entry: { id: string } | { separator: true } | undefined): boolean => entry !== undefined && 'separator' in entry;

/** A menu without the computer-only entries, and without the separators their removal leaves doubled or at an end. */
export const withoutComputerOnly = <T extends { id: string } | { separator: true }>(entries: readonly T[]): T[] => {
  const kept: T[] = [];
  for (const entry of entries) {
    if ('id' in entry && COMPUTER_ONLY.has(entry.id)) continue;
    if (isSeparator(entry) && (kept.length === 0 || isSeparator(kept.at(-1)))) continue;
    kept.push(entry);
  }
  while (isSeparator(kept.at(-1))) kept.pop();
  return kept;
};

const reveal: MenuEntry = { id: 'reveal', label: 'Reveal in folder' };
const addToFolder: MenuEntry = { id: 'add-to-folder', label: 'Add to folder…' };
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
const baseEntries = (pageData: PageDataEntry | undefined): MenuEntry[] => [addToFolder, reveal, copyPath, ...clearPageData(pageData), rename, { separator: true }, remove];

export const viewerMenuEntries = (input: ViewerMenuInput): MenuEntry[] => {
  const entries = allViewerEntries(input);
  return input.phone ? withoutComputerOnly(entries) : entries;
};

const allViewerEntries = (input: ViewerMenuInput): MenuEntry[] => {
  // A design with no knobs gets one way to ask for some, right after the chat link in the rail and first on the page.
  const ask: MenuEntry[] = input.askForTweaks ? [askTweaks] : [];
  if (input.compact) {
    return [
      { id: 'chat', label: 'Continue in chat' },
      ...(input.railTweaks ? [{ id: 'tweaks', label: input.railTweaks } satisfies MenuEntry] : []),
      ...ask,
      { separator: true },
      { id: 'zip', label: 'Export ZIP' },
      { id: 'html', label: input.isPage ? 'Export single-file HTML' : 'Export screen as HTML…' },
      ...(input.isPage ? [{ id: 'copy-html', label: 'Copy HTML', disabled: input.copyHtmlTooLarge, hint: input.copyHtmlTooLarge ? 'too large' : undefined } satisfies MenuEntry] : []),
      copyPath,
      addToFolder,
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
