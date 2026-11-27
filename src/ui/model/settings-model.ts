// View-model of the settings screens (R3, P5): folder validation, the browser status, the agent
// guide and skill rows, and the opencode.json tip. Pure: no DOM, no host calls.

import { SETTINGS_PATH_MAX } from '../../shared/limits.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import { choiceSystemsOf, projectSystemOf } from '../../shared/systems.ts';
import type { AgentInstructionsState } from '../../shared/api.ts';
import type { AgentGuideStatus, AgentSkillStatus, SystemChoiceView, SystemDefaultSetting, SystemPinSetting, SystemPinView, SystemSummary } from '../../shared/types.ts';
import { folderName } from './format.ts';

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const UNC = /^\\\\[^\\]+\\[^\\]+/;

export const isAbsolutePath = (path: string): boolean => path.startsWith('/') || path.startsWith('~/') || WINDOWS_ABSOLUTE.test(path) || UNC.test(path);

/** A filesystem root alone ("/", "C:\") is refused by the service too; say so before the round trip. */
const isFilesystemRoot = (path: string): boolean => path === '/' || /^[A-Za-z]:[\\/]?$/.test(path);

const looksWindows = (path: string): boolean => WINDOWS_ABSOLUTE.test(path) || path.startsWith('\\\\');

/** Trailing separators do not make a different folder, except on a bare root ("/", "C:\"). */
const stripTrailing = (path: string): string => {
  const stripped = path.replace(/[\\/]+$/, '');
  return stripped === '' || /^[A-Za-z]:$/.test(stripped) ? path : stripped;
};

/**
 * True when the field names the folder already in use, so Apply has nothing to do: compared
 * after trimming and dropping a trailing `/` or `\`, and case-insensitively when either side
 * looks like a Windows path.
 */
export const isSameRootInput = (input: string, currentRoot: string): boolean => {
  const a = stripTrailing(input.trim());
  const b = stripTrailing(currentRoot.trim());
  if (looksWindows(a) || looksWindows(b)) return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
  return a === b;
};

/** Inline validation for the folder field. `null` = fine to apply. The unchanged case is not an error: Apply is disabled then. */
export const validateRootInput = (input: string): string | null => {
  const value = input.trim();
  if (value === '') return 'Enter the full path of a folder, or choose “Use default”.';
  if (value.length > SETTINGS_PATH_MAX) return 'That path is too long.';
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'That path contains a character folders can’t have.';
  if (!isAbsolutePath(value)) return 'Use the full path, starting with a drive letter (C:\\…) or “/”.';
  if (isFilesystemRoot(value)) return 'Choose a folder inside the drive, not the drive itself.';
  return null;
};

/** opencode.json globs use forward slashes on every OS. */
export const permissionSnippet = (root: string): string => {
  const glob = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/**`;
  return JSON.stringify({ permission: { external_directory: { [glob]: 'allow' } } }, null, 2);
};

export const designCountLabel = (count: number): string => (count === 1 ? '1 design' : `${count} designs`);

export type BrowserStatus = { tone: 'success' | 'neutral'; title: string; detail: string };

/** No browser is not a fault: thumbnails still work as live previews, so the tone stays neutral. */
export const browserStatus = (path: string | null, source: 'setting' | 'detected' | 'none'): BrowserStatus => {
  if (path === null || source === 'none') {
    return { tone: 'neutral', title: 'Live previews', detail: 'No Chrome, Edge or Chromium found, so thumbnails are live previews. Install one or set its path for image thumbnails.' };
  }
  return { tone: 'success', title: source === 'setting' ? 'Using your chosen browser' : 'Detected automatically', detail: path };
};

// ---------------------------------------------------------------- agent guide and skill

/**
 * A sentence with one path in it, split so the view can set the path in code type:
 * `before` + path + `after`. `path` is null when the sentence names none.
 */
export type PathSentence = { before: string; path: string | null; after: string };

const withPath = (before: string, path: string, after: string): PathSentence => ({ before, path, after });
const plain = (text: string): PathSentence => ({ before: text, path: null, after: '' });

/** The guide row: what Design Chamber does with `<root>/AGENTS.md` right now. */
export const guideSentence = (guide: AgentGuideStatus): PathSentence => {
  switch (guide.state) {
    case 'current':
    case 'outdated':
      return withPath('Design Chamber keeps a guide for agents at ', guide.path, '.');
    case 'edited':
      return withPath('You edited ', guide.path, ', so Design Chamber leaves it alone.');
    case 'foreign':
      return withPath('', guide.path, ' is your own file, so Design Chamber didn’t add a guide.');
    case 'missing':
      return withPath('Design Chamber adds a guide for agents at ', guide.path, ' the next time it starts.');
    case 'no-root':
      return plain('The guide is added once your designs folder exists.');
    case 'failed':
      return plain(guide.message ?? 'Design Chamber couldn’t write its guide for agents. Check that you can write to your designs folder.');
  }
};

/** What the older-copy row offers: remove our unedited old copy, copy the path of one we leave alone, or nothing. */
export type SkillControl = 'remove-old-copy' | 'copy-path' | null;

export type SkillRow = {
  sentence: PathSentence;
  control: SkillControl;
};

/**
 * The "Older copy" row (use-the-project spec §2.6). The skill ships inside the extension and the Built in row says so,
 * so this row exists only when there is something to say about a copy installed before: ours and unedited
 * (`current`, `outdated`) can be removed from here; an edited or foreign one is left alone and only its path is
 * offered; when the service can't look, it says so. Null for `not-installed`.
 */
export const skillRow = (skill: AgentSkillStatus): SkillRow | null => {
  switch (skill.state) {
    case 'not-installed':
      return null;
    case 'current':
    case 'outdated':
      return { sentence: withPath('An older copy is installed at ', skill.path, ', so agents may see the skill twice.'), control: 'remove-old-copy' };
    case 'edited':
      return { sentence: withPath('You edited the older copy at ', skill.path, ', so Design Chamber leaves it alone. Delete it if you don’t need it.'), control: 'copy-path' };
    case 'foreign':
      return { sentence: withPath('Another design-chamber skill is installed at ', skill.path, '.'), control: 'copy-path' };
    case 'unavailable':
      return { sentence: plain(skill.message ?? 'Design Chamber can’t look for an older copy on this computer.'), control: null };
  }
};

// ---------------------------------------------------------------- "Your agent" (use-the-project spec §2.6)

export const AGENT_SECTION_TITLE = 'Your agent';
export const AGENT_SECTION_TEXT = 'Agents in OpenChamber know Design Chamber while it is on. Nothing to set up.';
/** Static on purpose: a guest can't see whether OpenCode loaded the plugin, so this names the tools without promising they did. */
export const BUILT_IN_TEXT = 'Design rules, the design-chamber skill, and the design_check, design_list and design_read tools.';
export const OUTSIDE_TITLE = 'Using an agent outside OpenChamber?';
export const OUTSIDE_TEXT = 'Agents outside OpenChamber don’t get the note above. They can find your designs through the guide and the lines below.';

export type InstructionsRow = { badge: string; tone: 'success' | 'neutral' | 'warning'; detail: string };

/** "In every chat": whether the host kept the short note that goes with every chat (read fresh on every GET and PUT). */
export const instructionsRow = (state: AgentInstructionsState): InstructionsRow => {
  switch (state) {
    case 'saved':
      return { badge: 'Sent', tone: 'success', detail: 'Every chat gets a short note about Design Chamber.' };
    case 'pending':
      return { badge: 'Pending', tone: 'neutral', detail: 'Sent from the next message.' };
    case 'not-saved':
      return { badge: 'Not saved', tone: 'warning', detail: 'OpenChamber didn’t save it. It is sent again when Design Chamber restarts.' };
  }
};

/** One warning per extra copy OpenCode would also load. */
export const duplicateSentences = (skill: AgentSkillStatus): PathSentence[] =>
  skill.duplicates.map((path) => withPath('Another copy is at ', path, '. OpenCode needs one copy, so remove the other.'));

// ---------------------------------------------------------------- design systems (Phase 2.5 U4)
//
// "Default for new designs" and one row per project. A choice names a system by id; one that is a draft,
// deleted or missing in this folder counts as unset (the service says so in `sentence`), so its select shows
// the unset choice and the sentence says why.

export type SystemSelectOption = { id: string; label: string };

export const DEFAULT_ASK = 'ask';
export const SELECT_NONE = 'none';
/** Use the project: no pin is stored for it. */
export const PIN_PROJECT = 'project';
/** Use my default: stored as a `follow-default` pin. */
export const PIN_FOLLOW_DEFAULT = 'follow-default';
const SYSTEM_PREFIX = 'system:';

const readySystems = (systems: readonly SystemSummary[]): SystemSummary[] => systems.filter((system) => system.status === 'ready');

export const defaultOptions = (systems: readonly SystemSummary[]): SystemSelectOption[] => [
  { id: DEFAULT_ASK, label: 'Ask me each time' },
  { id: SELECT_NONE, label: 'No design system' },
  ...readySystems(systems).map((system) => ({ id: `${SYSTEM_PREFIX}${system.id}`, label: system.name })),
];

/** Use-the-project spec §1.7, in this order: the project (no pin, the default), your default, none, each Ready system. */
export const pinOptions = (systems: readonly SystemSummary[]): SystemSelectOption[] => [
  { id: PIN_PROJECT, label: 'Use the project' },
  { id: PIN_FOLLOW_DEFAULT, label: 'Use my default' },
  { id: SELECT_NONE, label: 'No design system' },
  ...readySystems(systems).map((system) => ({ id: `${SYSTEM_PREFIX}${system.id}`, label: system.name })),
];

/** The select's value for the default; a system that no longer resolves shows as "Ask me each time". */
export const defaultValue = (view: SystemChoiceView): string => (view.choice === 'system' ? (view.state === 'ok' ? `${SYSTEM_PREFIX}${view.id}` : DEFAULT_ASK) : view.choice === 'none' ? SELECT_NONE : DEFAULT_ASK);

export const defaultFrom = (value: string, systems: readonly SystemSummary[]): SystemDefaultSetting => {
  if (value === SELECT_NONE) return { choice: 'none' };
  const system = value.startsWith(SYSTEM_PREFIX) ? readySystems(systems).find((one) => one.id === value.slice(SYSTEM_PREFIX.length)) : undefined;
  return system ? { choice: 'system', id: system.id, name: system.name } : { choice: 'ask' };
};

/** The select's value for a project; a pinned system that does not resolve shows as "Use the project", which is what then applies. */
export const pinValue = (pin: SystemPinView | null): string => {
  if (pin === null) return PIN_PROJECT;
  if (pin.choice === 'none') return SELECT_NONE;
  if (pin.choice === 'follow-default') return PIN_FOLLOW_DEFAULT;
  return pin.state === 'ok' && pin.id !== undefined ? `${SYSTEM_PREFIX}${pin.id}` : PIN_PROJECT;
};

/** A pin as the body of `PUT /settings` wants it: the view's `state` and `sentence` stay behind. */
export const pinSetting = (pin: SystemPinView): SystemPinSetting => {
  const { state: _state, sentence: _sentence, ...setting } = pin;
  return setting;
};

/**
 * The whole pin list after one project's select changed (the body is the whole list). "Use the project" removes the
 * pin, "Use my default" stores `follow-default`; every other pin is kept as it was, including ones that point at a
 * system that is gone.
 */
export const pinsAfter = (pins: readonly SystemPinView[], directory: string, value: string, systems: readonly SystemSummary[]): SystemPinSetting[] => {
  const others = pins.filter((pin) => !sameDirectory(pin.directory, directory)).map(pinSetting);
  if (value === PIN_PROJECT) return others;
  if (value === PIN_FOLLOW_DEFAULT) return [...others, { directory, choice: 'follow-default' }];
  if (value === SELECT_NONE) return [...others, { directory, choice: 'none' }];
  const system = value.startsWith(SYSTEM_PREFIX) ? readySystems(systems).find((one) => one.id === value.slice(SYSTEM_PREFIX.length)) : undefined;
  return system ? [...others, { directory, choice: 'system', id: system.id, name: system.name }] : others;
};

export type ProjectRow = { directory: string; name: string; value: string; sentence: string | null };

/** What the rows need besides the pins: the systems list (null while it loads or when it failed), the default, case folding. */
export type ProjectRowsContext = { systems: readonly SystemSummary[] | null; defaultView: SystemChoiceView; foldsCase: boolean };

/** The default's name as its select shows it; a system that no longer resolves acts as Ask me each time. */
export const defaultLabel = (view: SystemChoiceView): string => {
  if (view.choice === 'none') return 'No design system';
  if (view.choice === 'system' && view.state === 'ok') return view.name;
  return 'Ask me each time';
};

/** The project's own system, Ready first; a draft one only when it has no Ready one. Null while the list is unknown. */
const ownSystemOf = (systems: readonly SystemSummary[] | null, directory: string, foldsCase: boolean): { name: string; id: string; draft: boolean } | null => {
  if (systems === null) return null;
  const rows = choiceSystemsOf(systems);
  const ready = projectSystemOf(rows, directory, foldsCase);
  if (ready !== null) return { ...ready, draft: false };
  // projectSystemOf only picks Ready systems; ask it again about the drafts alone to name one that isn't Ready yet.
  const draft = projectSystemOf(rows.filter((row) => row.status === 'draft').map((row) => ({ ...row, status: 'ready' as const })), directory, foldsCase);
  return draft === null ? null : { ...draft, draft: true };
};

/** Use-the-project spec §1.7: the sentence under a project's select that says what its new designs will use. */
const rowSentence = (directory: string, pin: SystemPinView | null, context: ProjectRowsContext): string | null => {
  if (pin !== null && pin.choice === 'system' && pin.state !== 'ok') return pin.sentence;
  if (pin !== null && pin.choice !== 'system') return null;
  const own = ownSystemOf(context.systems, directory, context.foldsCase);
  if (pin !== null) {
    // A pinned system that resolves: only worth a sentence when the project also has a system of its own.
    const pinned = pin.name ?? pin.id ?? 'that system';
    return own !== null && !own.draft && own.id !== pin.id ? `This project has its own system, ${own.name}. New designs use ${pinned} because you picked it.` : null;
  }
  if (own === null) return `Follows the project’s design files. If it has none, uses your default (${defaultLabel(context.defaultView)}).`;
  if (own.draft) return `${own.name} is a draft. Until it is Ready, designs follow the project’s files.`;
  return `Uses ${own.name}, this project’s design system.`;
};

/** One row per project the host knows, then one per pin whose project is not in that list (it is still a setting). */
export const projectRows = (projects: ReadonlyArray<{ directory: string; name: string }>, pins: readonly SystemPinView[], context: ProjectRowsContext): ProjectRow[] => {
  const pinFor = (directory: string): SystemPinView | null => pins.find((pin) => sameDirectory(pin.directory, directory)) ?? null;
  const rows = projects.map((project) => {
    const pin = pinFor(project.directory);
    return { directory: project.directory, name: project.name, value: pinValue(pin), sentence: rowSentence(project.directory, pin, context) };
  });
  const extra = pins
    .filter((pin) => !projects.some((project) => sameDirectory(project.directory, pin.directory)))
    .map((pin) => ({ directory: pin.directory, name: folderName(pin.directory), value: pinValue(pin), sentence: rowSentence(pin.directory, pin, context) }));
  return [...rows, ...extra];
};

/** Under the default select: why a default that no longer resolves acts as "Ask me each time". */
export const defaultSentence = (view: SystemChoiceView): string | null => (view.choice === 'system' && view.state !== 'ok' ? view.sentence : null);

export const SYSTEMS_SECTION_TEXT = 'New designs follow their project’s own design system and files. Change it per project, or set what happens when a project has nothing.';
/** Under "Default for new designs", always shown. */
export const DEFAULT_NOTE = 'Used when a design has no project, or its project has no design files.';
export const NO_PROJECTS_TEXT = 'Open a project in OpenChamber and it shows up here.';
