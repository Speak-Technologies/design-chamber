// View-model of the settings screens (R3, P5): folder validation, the browser status, the agent
// guide and skill rows, and the opencode.json tip. Pure: no DOM, no host calls.

import { SETTINGS_PATH_MAX } from '../../shared/limits.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
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

/** What the skill row offers: remove our unedited old copy, copy the path of one we leave alone, or nothing. */
export type SkillControl = 'remove-old-copy' | 'copy-path' | null;

export type SkillRow = {
  sentence: PathSentence;
  control: SkillControl;
};

/**
 * The skill row for each state the service reports. The skill ships inside the extension, so the
 * row says so first and only talks about an older installed copy when there is one: ours and
 * unedited (`current`, `outdated`) can be removed from here; an edited or foreign one is left
 * alone and only its path is offered.
 */
export const skillRow = (skill: AgentSkillStatus): SkillRow => {
  switch (skill.state) {
    case 'not-installed':
      return { sentence: plain('Built in. Agents in OpenChamber can use it while Design Chamber is on.'), control: null };
    case 'current':
    case 'outdated':
      return { sentence: withPath('Built in. An older copy is also installed at ', skill.path, ', so agents may see the skill twice.'), control: 'remove-old-copy' };
    case 'edited':
      return { sentence: withPath('Built in. You edited the older copy at ', skill.path, ', so Design Chamber leaves it alone. Delete it if you don’t need it.'), control: 'copy-path' };
    case 'foreign':
      return { sentence: withPath('Built in. Another design-chamber skill is installed at ', skill.path, '.'), control: 'copy-path' };
    case 'unavailable':
      return { sentence: plain(`Built in. ${skill.message ?? 'Design Chamber can’t look for an older copy on this computer.'}`), control: null };
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
export const PIN_DEFAULT = 'default';
const SYSTEM_PREFIX = 'system:';

const readySystems = (systems: readonly SystemSummary[]): SystemSummary[] => systems.filter((system) => system.status === 'ready');

export const defaultOptions = (systems: readonly SystemSummary[]): SystemSelectOption[] => [
  { id: DEFAULT_ASK, label: 'Ask me each time' },
  { id: SELECT_NONE, label: 'No design system' },
  ...readySystems(systems).map((system) => ({ id: `${SYSTEM_PREFIX}${system.id}`, label: system.name })),
];

export const pinOptions = (systems: readonly SystemSummary[]): SystemSelectOption[] => [
  { id: PIN_DEFAULT, label: 'Use the default' },
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

/** The select's value for a project; a pin that does not resolve shows as "Use the default". */
export const pinValue = (pin: SystemPinView | null): string => {
  if (pin === null) return PIN_DEFAULT;
  if (pin.choice === 'none') return SELECT_NONE;
  return pin.choice === 'system' && pin.state === 'ok' && pin.id !== undefined ? `${SYSTEM_PREFIX}${pin.id}` : PIN_DEFAULT;
};

/** A pin as the body of `PUT /settings` wants it: the view's `state` and `sentence` stay behind. */
export const pinSetting = (pin: SystemPinView): SystemPinSetting => {
  const { state: _state, sentence: _sentence, ...setting } = pin;
  return setting;
};

/**
 * The whole pin list after one project's select changed (the body is the whole list). "Use the default" removes the
 * pin; every other pin is kept as it was, including ones that point at a system that is gone.
 */
export const pinsAfter = (pins: readonly SystemPinView[], directory: string, value: string, systems: readonly SystemSummary[]): SystemPinSetting[] => {
  const others = pins.filter((pin) => !sameDirectory(pin.directory, directory)).map(pinSetting);
  if (value === PIN_DEFAULT) return others;
  if (value === SELECT_NONE) return [...others, { directory, choice: 'none' }];
  const system = value.startsWith(SYSTEM_PREFIX) ? readySystems(systems).find((one) => one.id === value.slice(SYSTEM_PREFIX.length)) : undefined;
  return system ? [...others, { directory, choice: 'system', id: system.id, name: system.name }] : others;
};

export type ProjectRow = { directory: string; name: string; value: string; sentence: string | null };

/** One row per project the host knows, then one per pin whose project is not in that list (it is still a setting). */
export const projectRows = (projects: ReadonlyArray<{ directory: string; name: string }>, pins: readonly SystemPinView[]): ProjectRow[] => {
  const pinFor = (directory: string): SystemPinView | null => pins.find((pin) => sameDirectory(pin.directory, directory)) ?? null;
  const rows = projects.map((project) => {
    const pin = pinFor(project.directory);
    return { directory: project.directory, name: project.name, value: pinValue(pin), sentence: pin !== null && pin.state !== 'ok' ? pin.sentence : null };
  });
  const extra = pins
    .filter((pin) => !projects.some((project) => sameDirectory(project.directory, pin.directory)))
    .map((pin) => ({ directory: pin.directory, name: folderName(pin.directory), value: pinValue(pin), sentence: pin.state !== 'ok' ? pin.sentence : null }));
  return [...rows, ...extra];
};

/** Under the default select: why a default that no longer resolves acts as "Ask me each time". */
export const defaultSentence = (view: SystemChoiceView): string | null => (view.choice === 'system' && view.state !== 'ok' ? view.sentence : null);

export const SYSTEMS_SECTION_TEXT = 'New designs follow these when you start them. Pick one per project, or let the default decide.';
export const NO_PROJECTS_TEXT = 'Open a project in OpenChamber and it shows up here.';
