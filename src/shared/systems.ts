// Pure rules about which design system applies, and the pure half of a repo home check
// (documentation/specs/phase-2-5-technical.md §2.9, §5.9). No Node imports: the New dialog,
// the chip route and the RULES.md builder decide the same way.
//
// T7 filled `effectiveSystemChoice`; T12b `repoHomeShapeProblem` (the I/O half, realpath and
// lstat, lives in `systems/homes.ts` as `verifyRepoHome`).

import { BUILD_PROBLEM_VALUE_MAX, REPO_REL_PATTERN } from './limits.ts';
import type { SettingsResponse } from './api.ts';
import type { BuildProblemReason, EffectiveSystemChoice, SettingsFile, SystemChoiceView, SystemPinView, SystemSettingState, SystemSummary } from './types.ts';

/**
 * The New dialog's and `POST /chip`'s "Use the project" (use-the-project spec §1.4). `@` can't start a system id
 * (`SLUG_PATTERN`), so a system folder named `project` stays valid.
 */
export const PROJECT_CHOICE = '@project';

/**
 * A system as the choice rules see it (use-the-project spec §1.4). `belongsTo` is the project folder it was made
 * from (a repo home's directory, else its recorded code source), null when it belongs to no project.
 */
export type ChoiceSystem = { id: string; status: 'draft' | 'ready'; name: string; belongsTo: string | null; repo: boolean; updated: string };

/**
 * The rules' view of the systems list. A system whose folder can't be read is left out, as the chip route's index
 * leaves it out: it can't be linked, so no rule should pick it.
 */
export const choiceSystemsOf = (rows: readonly Pick<SystemSummary, 'id' | 'name' | 'status' | 'unreadable' | 'home' | 'sources' | 'updated'>[]): ChoiceSystem[] =>
  rows
    .filter((row) => row.unreadable === null)
    .map((row) => ({
      id: row.id,
      status: row.status,
      name: row.name,
      // A repo home is the project's own (a registered system has no code source); else the folder it was scanned from.
      belongsTo: row.home !== 'internal' ? row.home.directory : row.sources.code === null ? null : (row.sources.code.project ?? row.sources.code.directory),
      repo: row.home !== 'internal',
      updated: row.updated,
    }));

/**
 * What the rules know about the project's own files: discovery's state and whether it found a design source. Null
 * when unknown (the New dialog has no scan), so Use the project answers `project` when no own system exists.
 */
export type ProjectScan = { state: 'scanned' | 'unreadable' | 'no-project'; found: boolean };

export type EffectiveChoiceInput = {
  /** The New dialog's choice: an id, `none`, `ask` or `PROJECT_CHOICE`; null when the dialog did not choose. */
  explicit: string | null;
  /** The design's project folder (the chat's), or null. */
  projectDirectory: string | null;
  /** The project scan's answer, or null when no scan ran. */
  project: ProjectScan | null;
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
 * The project's own Ready design system (use-the-project spec §1.2): one that belongs to the project, to a folder
 * inside it (a repo in the project) or to a folder around it (a chat opened in a package of the repo). The deepest
 * owner wins, then a repo home over an internal one, then the newest, then the id, so the pick never depends on
 * list order. Text comparison only: nothing is opened.
 */
export const projectSystemOf = (systems: readonly ChoiceSystem[], projectDirectory: string, foldsCase: boolean): { id: string; name: string } | null => {
  const depth = (folder: string): number => folderKey(folder, foldsCase).split('/').length;
  const candidates = systems.flatMap((system) => {
    const owner = system.belongsTo;
    if (system.status !== 'ready' || owner === null || owner.trim() === '') return [];
    const related = isSameOrInside(projectDirectory, owner, foldsCase) || isSameOrInside(owner, projectDirectory, foldsCase);
    return related ? [{ system, depth: depth(owner) }] : [];
  });
  candidates.sort((a, b) =>
    b.depth - a.depth
    || Number(b.system.repo) - Number(a.system.repo)
    || (a.system.updated < b.system.updated ? 1 : a.system.updated > b.system.updated ? -1 : 0)
    || (a.system.id < b.system.id ? -1 : a.system.id > b.system.id ? 1 : 0));
  const pick = candidates[0]?.system;
  return pick === undefined ? null : { id: pick.id, name: pick.name };
};

/**
 * Use-the-project spec §1.3, highest first: the New dialog's pick → a pin for the project (not the designs root or
 * inside it) → Use the project (the project's own Ready system, else its design files, else an unreadable folder) →
 * the default → `none-silent` when the answer is ask but no Ready system exists in this root (§2.9).
 * No pin is Use the project; `follow-default` goes straight to the default. A system named anywhere (explicit, pin,
 * default) counts only when it exists here and is Ready; an explicit one that is not falls through (the New dialog
 * offers Ready systems only, so this is a system that changed after the dialog opened; the chip route refuses it first).
 */
export const effectiveSystemChoice = (input: EffectiveChoiceInput): EffectiveSystemChoice => {
  const ready = (id: string | undefined): id is string => id !== undefined && input.systems.some((system) => system.id === id && system.status === 'ready');
  const anyReady = input.systems.some((system) => system.status === 'ready');
  const ask = (): EffectiveSystemChoice => (anyReady ? { choice: 'ask' } : { choice: 'none-silent' });

  const project = input.projectDirectory;
  const isProject = project !== null && project.trim() !== '' && !isSameOrInside(input.designsRoot, project, input.foldsCase);

  /** §1.2 steps 1 to 3; null at step 4 (the scan found nothing) or when there is no project. */
  const useProject = (why: 'explicit' | 'default'): EffectiveSystemChoice | null => {
    if (!isProject || input.project?.state === 'no-project') return null;
    const own = projectSystemOf(input.systems, project, input.foldsCase);
    if (own !== null) return { choice: 'system', id: own.id, why: 'project' };
    const scan = input.project;
    if (scan === null || scan.state === 'unreadable' || scan.found) return { choice: 'project', why };
    return null;
  };

  const byDefault = (): EffectiveSystemChoice => {
    const fallback = input.settings.systemDefault ?? { choice: 'ask' };
    if (fallback.choice === 'none') return { choice: 'none', why: 'default' };
    if (fallback.choice === 'system' && ready(fallback.id)) return { choice: 'system', id: fallback.id, why: 'default' };
    return ask();
  };

  const { explicit } = input;
  if (explicit === 'none') return { choice: 'none', why: 'explicit' };
  if (explicit === 'ask') return ask();
  if (explicit === PROJECT_CHOICE) return useProject('explicit') ?? byDefault();
  if (explicit !== null && ready(explicit)) return { choice: 'system', id: explicit, why: 'explicit' };

  if (isProject) {
    const pin = (input.settings.systemPins ?? []).find((one) => folderKey(one.directory, input.foldsCase) === folderKey(project, input.foldsCase));
    if (pin?.choice === 'none') return { choice: 'none', why: 'pinned' };
    if (pin?.choice === 'system' && ready(pin.id)) return { choice: 'system', id: pin.id, why: 'pinned' };
    if (pin?.choice === 'follow-default') return byDefault();
    // No pin, or a pinned system that is gone or a draft: Use the project.
    const fromProject = useProject('default');
    if (fromProject !== null) return fromProject;
  }
  return byDefault();
};

/** A system as the Settings view sees it: its name, whether it is Ready, and whether its folder can be read. */
export type SettingsViewSystem = { id: string; name: string; status: 'draft' | 'ready'; unreadable: string | null };

/** What each setting says when its system does not apply here; `unset` is what then happens (the effective rules above). */
type SettingWords = { absent: (name: string) => string; unset: string; draftUntil: string };

/**
 * Where a setting stands against this root's systems: the state and, when it is not ok, the sentence that says why (§3.4).
 * `missing` is a system that is not in this Designs folder (a folder switch; a real delete already clears the setting)
 * or whose folder cannot be read. Both keep the saved id, so switching back restores it.
 */
const settingState = (
  ref: { id: string; name: string },
  systems: readonly SettingsViewSystem[],
  words: SettingWords,
): { name: string; state: SystemSettingState; sentence: string | null } => {
  const system = systems.find((one) => one.id === ref.id);
  if (system === undefined) return { name: ref.name, state: 'missing', sentence: words.absent(ref.name) };
  if (system.unreadable !== null) return { name: system.name, state: 'missing', sentence: `${system.name} can’t be read right now. ${words.unset}` };
  if (system.status === 'draft') return { name: system.name, state: 'draft', sentence: `${system.name} is a draft. ${words.draftUntil}` };
  return { name: system.name, state: 'ok', sentence: null };
};

const DEFAULT_WORDS: SettingWords = {
  absent: () => 'Your default design system isn’t in this Designs folder.',
  unset: 'New designs ask you in chat.',
  draftUntil: 'New designs ask you in chat until it is Ready.',
};
// Use-the-project spec §1.5, §1.7: a pin that doesn't apply falls to Use the project.
const PIN_WORDS: SettingWords = {
  absent: (name) => `${name} isn’t in this Designs folder. This project uses the project’s own design files, or your default.`,
  unset: 'This project uses the project’s own design files, or your default.',
  draftUntil: 'Until it is Ready, this project uses the project’s own design files, or your default.',
};

/**
 * The `systems` part of the settings answer (§3.4): the default and each pin resolved against this root, and the
 * one-time notices. A choice that names a system which is not here, a draft or unreadable keeps its saved id and says
 * why in `sentence`; the effective rules above treat it as unset.
 */
export const settingsSystemsView = (input: {
  settings: Pick<SettingsFile, 'systemDefault' | 'systemPins'>;
  systems: readonly SettingsViewSystem[];
  notices: readonly string[];
}): NonNullable<SettingsResponse['systems']> => {
  const { systems } = input;
  const saved = input.settings.systemDefault ?? { choice: 'ask' as const };
  const view: SystemChoiceView = saved.choice === 'system' ? { ...saved, ...settingState(saved, systems, DEFAULT_WORDS) } : { ...saved, state: 'ok', sentence: null };
  const pins = (input.settings.systemPins ?? []).map((pin): SystemPinView => {
    if (pin.choice !== 'system' || pin.id === undefined) return { ...pin, state: 'ok', sentence: null };
    return { ...pin, ...settingState({ id: pin.id, name: pin.name ?? pin.id }, systems, PIN_WORDS) };
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
