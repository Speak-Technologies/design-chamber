// Pure rules about which design system applies, and the pure half of a repo home check
// (documentation/specs/phase-2-5-technical.md §2.9, §5.9). No Node imports: the New dialog,
// the chip route and the RULES.md builder decide the same way.
//
// T0 seam: the signatures are the contract. T7 filled `effectiveSystemChoice`; T12b fills
// `repoHomeShapeProblem` (the I/O half, realpath and lstat, lives in `systems/homes.ts`).

import type { BuildProblemReason, EffectiveSystemChoice, SettingsFile } from './types.ts';

const NOT_BUILT = 'This part of Design Chamber (design systems) is not built yet.';
const notBuilt = (): never => {
  throw new Error(NOT_BUILT);
};

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

/** The repo home a BUILD.json asks for (§2.13 `repo`). */
export type RepoHomeRequest = { directory: string; folder: string; livingPage: string };

/** Another repo-backed system's home, for the overlap rule. */
export type OtherRepoHome = { id: string; name: string; directory: string; folder: string; livingPage: string };

/**
 * The checks that need no filesystem (§5.9 step 2): `folder` and `livingPage` match
 * `REPO_REL_PATTERN` with no discovery `SKIP_DIRS` segment, the repo lies inside the project folder,
 * and no other system's folder overlaps or shares the living-page path. Null when it passes.
 * `repoReal` is the repo's realpath, already resolved by the caller.
 */
export const repoHomeShapeProblem = (
  request: RepoHomeRequest,
  context: { repoReal: string; projectDirectory: string; designsRoot: string; others: readonly OtherRepoHome[]; foldsCase: boolean },
): { reason: BuildProblemReason; value: string } | null => notBuilt();
