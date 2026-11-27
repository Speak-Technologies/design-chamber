// View-model of the New dialog: what is required, and the sentence that says what is missing.

import type { DesignKind, EffectiveSystemChoice, SystemDefaultSetting, SystemPinSetting, SystemSummary } from '../../shared/types.ts';
import { BRIEF_MAX } from '../../shared/limits.ts';
import { PROJECT_CHOICE, choiceSystemsOf, effectiveSystemChoice } from '../../shared/systems.ts';
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
  /** The id the select shows: a system id, `none`, `ask` or `PROJECT_CHOICE`. */
  value: string;
  /**
   * Why it is preselected, or what Use the project does: "From shop", "Reads shop’s design files first", "Pinned for
   * shop", "Your default"; null for a plain ask or the person's own pick of a system or none.
   */
  hint: string | null;
  /** The style preset only matters while no system decides the look. */
  showPreset: boolean;
  /** The note under the preset while the design follows the project; null otherwise. */
  presetHint: string | null;
  /** What goes to `POST /chip` as `system`: undefined when the dialog has nothing to say (no Ready system). */
  send: string | undefined;
};

/** Windows and macOS compare folder names ignoring case; a Windows-looking root is enough to tell. */
export const foldsCaseFor = (root: string, platform: string): boolean => /^[A-Za-z]:|^\\\\/.test(root) || /mac|darwin/i.test(platform);

/**
 * The field's state. `chosen` is what the person picked in the select (null until they do); until then the
 * same rules the service uses decide (use-the-project spec §1.3): a pin for the project, then Use the project (its
 * own Ready system, else its files), then the default, else ask.
 */
export const systemFieldOf = (input: SystemFieldInput, chosen: string | null, foldsCase: boolean): SystemFieldView => {
  const ready = input.systems.filter((system) => system.status === 'ready');
  const decide = (explicit: string | null): EffectiveSystemChoice =>
    effectiveSystemChoice({
      explicit,
      projectDirectory: input.projectDirectory,
      // The dialog runs no scan, so Use the project answers "follow the project" whenever no own system exists.
      project: null,
      designsRoot: input.designsRoot,
      settings: { systemDefault: input.settings?.default, systemPins: input.settings?.pins },
      systems: choiceSystemsOf(input.systems),
      foldsCase,
    });
  const effective = decide(chosen);
  if (ready.length === 0 || effective.choice === 'none-silent') return { empty: ready.length === 0, options: [], value: SYSTEM_NONE, hint: null, showPreset: true, presetHint: null, send: undefined };

  // The rules answer from the project only for a real project folder (not the designs root or inside it): asking
  // them about Use the project tells the dialog whether to offer it, with no second copy of that test here.
  const asProject = decide(PROJECT_CHOICE);
  const fromProject = (choice: EffectiveSystemChoice): boolean => choice.choice === 'project' || (choice.choice === 'system' && choice.why === 'project');
  const projectOffered = fromProject(asProject);
  const projectName = input.projectDirectory === null ? 'this project' : folderName(input.projectDirectory);

  const options = [
    ...(projectOffered ? [{ id: PROJECT_CHOICE, label: 'Use the project' }] : []),
    ...ready.map((system) => ({ id: system.id, label: system.name, hint: `Revision ${system.revision}` })),
    { id: SYSTEM_NONE, label: 'No design system' },
    { id: SYSTEM_ASK, label: 'Ask me in chat' },
  ];
  const pickedProject = chosen === PROJECT_CHOICE && projectOffered;
  let value: string;
  if (pickedProject || effective.choice === 'project') value = PROJECT_CHOICE;
  else value = effective.choice === 'system' ? effective.id : effective.choice === 'none' ? SYSTEM_NONE : SYSTEM_ASK;

  let hint: string | null = null;
  if (effective.choice === 'system' && effective.why === 'project') hint = `From ${projectName}`;
  else if (effective.choice === 'project') hint = `Reads ${projectName}’s design files first`;
  else if (chosen === null && (effective.choice === 'system' || effective.choice === 'none')) {
    if (effective.why === 'pinned') hint = `Pinned for ${projectName}`;
    else if (effective.why === 'default') hint = 'Your default';
  }
  const showPreset = effective.choice !== 'system';
  return { empty: false, options, value, hint, showPreset, presetHint: showPreset && value === PROJECT_CHOICE ? 'Used only where the project’s files say nothing.' : null, send: value };
};

export const NO_SYSTEMS_LINE = 'No design systems yet.';

// ---------------------------------------------------------------- the Folder or project field (Phase 2.6 F2)

export const FOLDER_FIELD_LABEL = 'Folder or project';
export const FOLDER_FIELD_HELPER = 'Optional. Pick where this design belongs; you can change it later.';
