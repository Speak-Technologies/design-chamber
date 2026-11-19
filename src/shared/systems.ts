// Pure rules about which design system applies, and the pure half of a repo home check
// (documentation/specs/phase-2-5-technical.md §2.9, §5.9). No Node imports: the New dialog,
// the chip route and the RULES.md builder decide the same way.
//
// T0 seam: the signatures are the contract. T9 fills `effectiveSystemChoice`; T12b fills
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

/**
 * RS S5-1, in order: explicit → a pin for the project (not the designs root or inside it) → the
 * default → `none-silent` when the answer is ask but no Ready system exists in this root (§2.9).
 */
export const effectiveSystemChoice = (input: EffectiveChoiceInput): EffectiveSystemChoice => notBuilt();

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
