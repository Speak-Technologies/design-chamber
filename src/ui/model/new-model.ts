// View-model of the New dialog: what is required, and the sentence that says what is missing.

import type { DesignKind, SystemDefaultSetting, SystemPinSetting, SystemSummary } from '../../shared/types.ts';
import { BRIEF_MAX } from '../../shared/limits.ts';
import { effectiveSystemChoice } from '../../shared/systems.ts';
import { folderName } from './format.ts';

export type Destination = 'new-chat' | 'current-chat';

export type NewForm = { kind: DesignKind; brief: string; preset: string | null; destination: Destination };

export const DESTINATIONS: ReadonlyArray<{ id: Destination; label: string; hint: string }> = [
  { id: 'new-chat', label: 'New chat', hint: 'Starts a chat in this project.' },
  { id: 'current-chat', label: 'Current chat', hint: 'Attaches the design to the chat you have open.' },
];

/** The sentence under the Canvas | Page tabs. */
export const kindHint = (kind: DesignKind): string =>
  kind === 'canvas' ? 'A wall of screens at several device sizes, with comments and versions.' : 'One HTML page shown full screen, with comments and versions. Export it as a ZIP or a single file.';

export const startLabel = (kind: DesignKind): string => (kind === 'canvas' ? 'Start canvas' : 'Start page');

/** Brief is optional (the agent asks when it is empty), so only the length can be wrong. */
export const validateBrief = (brief: string): string | null => (brief.length > BRIEF_MAX ? `Keep the brief under ${BRIEF_MAX} characters.` : null);

export const briefPlaceholder = (kind: DesignKind): string =>
  kind === 'canvas' ? 'e.g. A pricing page for a coffee subscription, laptop and phone' : 'e.g. A single-page invoice template I can print';

/** Presets list with the "no preset" choice first. */
export const presetOptions = (presets: ReadonlyArray<{ id: string; name: string; bestFor: string }>): Array<{ id: string; label: string; hint?: string }> => [
  { id: '', label: 'None, let the agent suggest one' },
  ...presets.map((preset) => ({ id: preset.id, label: preset.name, hint: preset.bestFor })),
];

// ---------------------------------------------------------------- the design system field (Phase 2.5 U4)

export const SYSTEM_ASK = 'ask';
export const SYSTEM_NONE = 'none';

export type SystemFieldInput = {
  /** Every system in the folder (`GET /systems`); only Ready ones are offered. */
  systems: readonly SystemSummary[];
  /** `GET /settings` `systems`, or undefined before it loads (then no default or pin applies). */
  settings: { default: SystemDefaultSetting; pins: SystemPinSetting[] } | undefined;
  designsRoot: string;
  /** The project the new design is for (the chat's folder), or null. */
  projectDirectory: string | null;
};

export type SystemFieldView = {
  /** No Ready system exists: the field is replaced by a line that points to the systems list. */
  empty: boolean;
  options: Array<{ id: string; label: string; hint?: string }>;
  /** The id the select shows: a system id, `none` or `ask`. */
  value: string;
  /** Why it is preselected: "Pinned for shop", "Your default"; null when it is the person's own pick or a plain ask. */
  hint: string | null;
  /** The style preset only matters while no system decides the look. */
  showPreset: boolean;
  /** What goes to `POST /chip` as `system`: undefined when the dialog has nothing to say (no Ready system). */
  send: string | undefined;
};

/** Windows and macOS compare folder names ignoring case; a Windows-looking root is enough to tell. */
export const foldsCaseFor = (root: string, platform: string): boolean => /^[A-Za-z]:|^\\\\/.test(root) || /mac|darwin/i.test(platform);

/**
 * The field's state. `chosen` is what the person picked in the select (null until they do); until then the
 * same rules the service uses decide: a pin for the project, the default, else ask.
 */
export const systemFieldOf = (input: SystemFieldInput, chosen: string | null, foldsCase: boolean): SystemFieldView => {
  const ready = input.systems.filter((system) => system.status === 'ready');
  const effective = effectiveSystemChoice({
    explicit: chosen,
    projectDirectory: input.projectDirectory,
    designsRoot: input.designsRoot,
    settings: { systemDefault: input.settings?.default, systemPins: input.settings?.pins },
    systems: input.systems.map((system) => ({ id: system.id, status: system.status })),
    foldsCase,
  });
  if (ready.length === 0 || effective.choice === 'none-silent') return { empty: ready.length === 0, options: [], value: SYSTEM_NONE, hint: null, showPreset: true, send: undefined };
  const options = [
    ...ready.map((system) => ({ id: system.id, label: system.name, hint: `Revision ${system.revision}` })),
    { id: SYSTEM_NONE, label: 'No design system' },
    { id: SYSTEM_ASK, label: 'Ask me in chat' },
  ];
  const value = effective.choice === 'system' ? effective.id : effective.choice === 'none' ? SYSTEM_NONE : SYSTEM_ASK;
  let hint: string | null = null;
  if (chosen === null && (effective.choice === 'system' || effective.choice === 'none')) {
    if (effective.why === 'pinned') hint = `Pinned for ${input.projectDirectory === null ? 'this project' : folderName(input.projectDirectory)}`;
    else if (effective.why === 'default') hint = 'Your default';
  }
  return { empty: false, options, value, hint, showPreset: effective.choice !== 'system', send: value };
};

export const NO_SYSTEMS_LINE = 'No design systems yet.';

// ---------------------------------------------------------------- the Folder or project field (Phase 2.6 F2)

export const FOLDER_FIELD_LABEL = 'Folder or project';
export const FOLDER_FIELD_HELPER = 'Optional. Pick where this design belongs; you can change it later.';
