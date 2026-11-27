// What the token export of a design system says and offers (system-builder-depth T19u): the entry in the system's menu,
// the format ticks of the sheet and the sentences around them. Pure: no DOM, no host.

import type { TokenExportFormat } from '../../shared/types.ts';

/**
 * The ZIP is written on the computer that runs the service, so a phone has nowhere to find it and is not offered the
 * export. `context` is `ready` (or null before it). `feat/native-extras` brings a `Device` model with the same rule;
 * this can read that once the two branches meet.
 */
export const exportOffered = (context: { device?: { formFactor?: unknown } } | null): boolean => context?.device?.formFactor !== 'phone';

export type ExportMenuEntry = { id: 'export'; label: string; disabled?: true; reason?: string };

/** The export reads the saved, current files, so it waits while the screen shows something else. */
export const exportMenuEntry = (facts: { viewing: boolean; dirty: boolean; unreadable: boolean }): ExportMenuEntry => {
  const entry: ExportMenuEntry = { id: 'export', label: 'Export tokens…' };
  const reason = facts.viewing
    ? 'Go back to the current version first.'
    : facts.dirty
      ? 'Save or discard your changes first.'
      : facts.unreadable
        ? 'This system can’t be read right now.'
        : null;
  return reason === null ? entry : { ...entry, disabled: true, reason };
};

export type FormatChoice = { format: TokenExportFormat; label: string; file: string };

const CHOICES: readonly FormatChoice[] = [
  { format: 'dtcg', label: 'Design tokens (W3C)', file: 'tokens.json' },
  { format: 'css', label: 'CSS variables', file: 'tokens.css' },
  { format: 'tailwind', label: 'Tailwind theme', file: 'tailwind-theme.css' },
];

/** The ticks to draw: only what the service offers (Tailwind only for a project that uses it), in a fixed order. */
export const formatChoices = (offered: readonly TokenExportFormat[]): FormatChoice[] => CHOICES.filter((choice) => offered.includes(choice.format));

export const pickedFormats = (offered: readonly TokenExportFormat[], ticked: ReadonlySet<TokenExportFormat>): TokenExportFormat[] =>
  formatChoices(offered)
    .map((choice) => choice.format)
    .filter((format) => ticked.has(format));

export const PICK_A_FORMAT = 'Pick at least one format.';
export const EXPORT_NOTHING = 'This design system has no tokens to export yet. Ask the agent to add some.';

export const renamedSentence = (renamed: number): string | null => {
  if (renamed <= 0) return null;
  return renamed === 1
    ? '1 name was changed so it doesn’t clash in tokens.json. README.txt in the ZIP lists it.'
    : `${renamed} names were changed so they don’t clash in tokens.json. README.txt in the ZIP lists them.`;
};

export const exportButtonLabel = (state: { busy: boolean; failed: boolean }): string => (state.busy ? 'Exporting…' : state.failed ? 'Try again' : 'Export ZIP');
