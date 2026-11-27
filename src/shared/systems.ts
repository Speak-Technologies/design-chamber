// Pure rules about which design system applies, and the pure half of a repo home check
// (documentation/specs/phase-2-5-technical.md §2.9, §5.9). No Node imports: the New dialog,
// the chip route and the RULES.md builder decide the same way.
//
// T7 filled `effectiveSystemChoice`; T12b `repoHomeShapeProblem` (the I/O half, realpath and
// lstat, lives in `systems/homes.ts` as `verifyRepoHome`).

import { BUILD_PROBLEM_VALUE_MAX, REPO_REL_PATTERN } from './limits.ts';
import type { SettingsResponse } from './api.ts';
import type { BuildProblemReason, EffectiveSystemChoice, SettingsFile, SystemChoiceView, SystemPinView, SystemSettingState } from './types.ts';

/** A system as the choice rules see it: its id and whether it is Ready. */
export type ChoiceSystem = { id: string; status: 'draft' | 'ready' };

export type EffectiveChoiceInput = {
  /** The New dialog's choice: an id, `none` or `ask`; null when the dialog did not choose. */
  explicit: string | null;
  /** The design's project folder (the chat's), or null. */
  projectDirectory: string | null;
  designsRoot: string;
  settings: Pick<SettingsFile, 'systemDefault' | 'systemPins'>;
  /** The systems in the current root. */
  systems: readonly ChoiceSystem[];
  /** win32 and darwin compare folders ignoring case. */
  foldsCase: boolean;
};

/** A folder path as text: `/` separators, no trailing separator, folded when the disk ignores case. */
const folderKey = (value: string, foldsCase: boolean): string => {
  const norm = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return foldsCase || /^[A-Za-z]:\//.test(norm) ? norm.toLowerCase() : norm;
};

/** `dir` is `root` or a folder below it (text only: both are absolute paths the host or the user gave). */
const isSameOrInside = (root: string, dir: string, foldsCase: boolean): boolean => {
  const base = folderKey(root, foldsCase);
  const target = folderKey(dir, foldsCase);
  return target === base || target.startsWith(`${base}/`);
};

/**
 * RS S5-1, in order: explicit → a pin for the project (not the designs root or inside it) → the
 * default → `none-silent` when the answer is ask but no Ready system exists in this root (§2.9).
 * A system named anywhere (explicit, pin, default) counts only when it exists here and is Ready; an
 * explicit one that is not falls through to the pin and the default (the New dialog offers Ready
 * systems only, so this is a system that changed after the dialog opened; the chip route refuses it first).
 */
export const effectiveSystemChoice = (input: EffectiveChoiceInput): EffectiveSystemChoice => {
  const ready = (id: string | undefined): id is string => id !== undefined && input.systems.some((system) => system.id === id && system.status === 'ready');
  const anyReady = input.systems.some((system) => system.status === 'ready');
  const ask = (): EffectiveSystemChoice => (anyReady ? { choice: 'ask' } : { choice: 'none-silent' });

  const { explicit } = input;
  if (explicit === 'none') return { choice: 'none', why: 'explicit' };
  if (explicit === 'ask') return ask();
  if (explicit !== null && ready(explicit)) return { choice: 'system', id: explicit, why: 'explicit' };

  const project = input.projectDirectory;
  if (project !== null && project !== '' && !isSameOrInside(input.designsRoot, project, input.foldsCase)) {
    const pin = (input.settings.systemPins ?? []).find((one) => folderKey(one.directory, input.foldsCase) === folderKey(project, input.foldsCase));
    if (pin !== undefined) {
      if (pin.choice === 'none') return { choice: 'none', why: 'pinned' };
      if (pin.choice === 'system' && ready(pin.id)) return { choice: 'system', id: pin.id, why: 'pinned' };
      // `default`, or a pinned system that is gone or a draft: the default decides.
    }
  }

  const fallback = input.settings.systemDefault ?? { choice: 'ask' };
  if (fallback.choice === 'none') return { choice: 'none', why: 'default' };
  if (fallback.choice === 'system' && ready(fallback.id)) return { choice: 'system', id: fallback.id, why: 'default' };
  return ask();
};

/** A system as the Settings view sees it: its name, whether it is Ready, and whether its folder can be read. */
export type SettingsViewSystem = { id: string; name: string; status: 'draft' | 'ready'; unreadable: string | null };

/** Where a setting stands against this root's systems: the state and, when it is not ok, the sentence that says why (§3.4). */
const settingState = (
  ref: { id: string; name: string },
  systems: readonly SettingsViewSystem[],
  words: { gone: string; draft: string },
): { name: string; state: SystemSettingState; sentence: string | null } => {
  const system = systems.find((one) => one.id === ref.id);
  if (system === undefined) return { name: ref.name, state: 'deleted', sentence: `${ref.name} was deleted. ${words.gone}` };
  if (system.unreadable !== null) return { name: system.name, state: 'missing', sentence: `${system.name} can’t be read right now. ${words.gone}` };
  if (system.status === 'draft') return { name: system.name, state: 'draft', sentence: `${system.name} is a draft. ${words.draft}` };
  return { name: system.name, state: 'ok', sentence: null };
};

/**
 * The `systems` part of the settings answer (§3.4): the default and each pin resolved against this root, and the
 * one-time notices. A choice that names a system which is gone, a draft or unreadable keeps its saved id (switching
 * back to the folder that has it restores it) and says why in `sentence`; the effective rules above treat it as unset.
 */
export const settingsSystemsView = (input: {
  settings: Pick<SettingsFile, 'systemDefault' | 'systemPins'>;
  systems: readonly SettingsViewSystem[];
  notices: readonly string[];
}): NonNullable<SettingsResponse['systems']> => {
  const { systems } = input;
  const saved = input.settings.systemDefault ?? { choice: 'ask' as const };
  const view: SystemChoiceView =
    saved.choice === 'system'
      ? { ...saved, ...settingState(saved, systems, { gone: 'New designs ask you in chat.', draft: 'New designs ask you in chat until it is Ready.' }) }
      : { ...saved, state: 'ok', sentence: null };
  const pins = (input.settings.systemPins ?? []).map((pin): SystemPinView => {
    if (pin.choice !== 'system' || pin.id === undefined) return { ...pin, state: 'ok', sentence: null };
    return { ...pin, ...settingState({ id: pin.id, name: pin.name ?? pin.id }, systems, { gone: 'This project uses the default.', draft: 'This project uses the default until it is Ready.' }) };
  });
  return { default: view, pins, notices: [...input.notices] };
};

/** The repo home a BUILD.json asks for (§2.13 `repo`). */
export type RepoHomeRequest = { directory: string; folder: string; livingPage: string };

/** Another repo-backed system's home, for the overlap rule. */
export type OtherRepoHome = { id: string; name: string; directory: string; folder: string; livingPage: string };

/** A folder path built from a base and `/`-separated segments, for text comparison only. */
const under = (base: string, segments: readonly string[]): string => `${base.replace(/[\\/]+$/, '')}/${segments.join('/')}`;

const problemValue = (value: string): string => value.slice(0, BUILD_PROBLEM_VALUE_MAX);

/**
 * The checks that need no filesystem (§5.9 step 2): `folder` and `livingPage` match
 * `REPO_REL_PATTERN` with no discovery `SKIP_DIRS` segment, the repo lies inside the project folder,
 * the system folder is not the designs root, inside it or containing it, and no other system's folder
 * overlaps or shares the living-page path (compared with `foldsCase` on win32/darwin). Null when it
 * passes. `repoReal` is the repo's realpath, already resolved by the caller; `skipDirs` is discovery's
 * `SKIP_DIRS` (passed in, so this module stays pure and there is one list). The I/O half
 * (`verifyRepoHome`) re-checks the designs-root rule against the resolved folder and reads the
 * living-page mark.
 */
export const repoHomeShapeProblem = (
  request: RepoHomeRequest,
  context: { repoReal: string; projectDirectory: string; designsRoot: string; others: readonly OtherRepoHome[]; foldsCase: boolean; skipDirs: ReadonlySet<string> },
): { reason: BuildProblemReason; value: string } | null => {
  const { repoReal, projectDirectory, designsRoot, others, foldsCase, skipDirs } = context;
  const folderSegments = REPO_REL_PATTERN.test(request.folder) ? request.folder.split('/') : null;
  const pageSegments = REPO_REL_PATTERN.test(request.livingPage) && request.livingPage.endsWith('.html') ? request.livingPage.split('/') : null;
  if (folderSegments === null || pageSegments === null) return { reason: 'unreadable', value: problemValue(`${request.folder} ${request.livingPage}`) };
  // A system folder never lives in a folder the scan skips (node_modules, dist, …).
  const skipped = [...folderSegments, ...pageSegments].find((segment) => skipDirs.has(segment.toLowerCase()));
  if (skipped !== undefined) return { reason: 'repo-outside-project', value: problemValue(skipped) };
  if (!isSameOrInside(projectDirectory, repoReal, foldsCase)) return { reason: 'repo-outside-project', value: problemValue(request.directory) };

  const folderAbs = under(repoReal, folderSegments);
  const pageAbs = under(repoReal, pageSegments);
  // The designs root is never the system folder, never inside it and never contains it (§5.9).
  if (isSameOrInside(designsRoot, folderAbs, foldsCase) || isSameOrInside(folderAbs, designsRoot, foldsCase)) {
    return { reason: 'repo-outside-project', value: problemValue(folderAbs) };
  }
  for (const other of others) {
    const otherFolder = under(other.directory, other.folder.split('/'));
    if (isSameOrInside(folderAbs, otherFolder, foldsCase) || isSameOrInside(otherFolder, folderAbs, foldsCase)) {
      return { reason: 'repo-overlap', value: problemValue(other.name) };
    }
    if (folderKey(pageAbs, foldsCase) === folderKey(under(other.directory, other.livingPage.split('/')), foldsCase)) {
      return { reason: 'repo-overlap', value: problemValue(other.name) };
    }
  }
  return null;
};
