// View-model of the settings screens (R3, P5): folder validation, the browser status, the agent
// guide and skill rows, and the opencode.json tip. Pure: no DOM, no host calls.

import { SETTINGS_PATH_MAX } from '../../shared/limits.ts';
import type { AgentGuideStatus, AgentSkillStatus } from '../../shared/types.ts';

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

export type SkillAction = { kind: 'install' | 'update' | 'replace'; label: string };

export type SkillRow = {
  /** The button, or null when there is nothing to click (installed, someone else's skill, unavailable). */
  action: SkillAction | null;
  /** "Installed" badge beside the path. */
  installed: boolean;
  sentence: PathSentence;
  /** Asked inline before Replace overwrites the user's edits. */
  confirm: string | null;
};

/** The skill row for each state the service reports. */
export const skillRow = (skill: AgentSkillStatus): SkillRow => {
  switch (skill.state) {
    case 'not-installed':
      return { action: { kind: 'install', label: 'Install skill' }, installed: false, confirm: null, sentence: withPath('Adds a design-chamber skill to OpenCode at ', skill.path, ', so any chat knows where designs go.') };
    case 'outdated':
      return { action: { kind: 'update', label: 'Update skill' }, installed: false, confirm: null, sentence: plain('Your designs folder changed since you installed it.') };
    case 'current':
      return { action: null, installed: true, confirm: null, sentence: withPath('', skill.path, '') };
    case 'edited':
      return {
        action: { kind: 'replace', label: 'Replace skill…' },
        installed: false,
        confirm: 'Replace your edited skill with Design Chamber’s version?',
        sentence: withPath('You edited the skill at ', skill.path, '. Design Chamber won’t update it unless you replace it.'),
      };
    case 'foreign':
      return { action: null, installed: false, confirm: null, sentence: withPath('A different skill called design-chamber is already at ', skill.path, ', so Design Chamber left it alone.') };
    case 'unavailable':
      return { action: null, installed: false, confirm: null, sentence: plain(skill.message ?? 'The skill can’t be installed on this computer.') };
  }
};

/** One warning per extra copy OpenCode would also load. */
export const duplicateSentences = (skill: AgentSkillStatus): PathSentence[] =>
  skill.duplicates.map((path) => withPath('Another copy is at ', path, '. OpenCode needs one copy, so remove the other.'));
