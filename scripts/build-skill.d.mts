// Types for scripts/build-skill.mjs (build step 10b), so tests import it typed.
import type { SystemQuestionSet } from '../src/shared/types.ts';

/** Writes dist/skills/design-system-builder/SKILL.md and returns the parsed interview (§8.8 rev 3). */
export function buildBuilderSkill(input: { packageRoot: string; distDir: string }): Promise<SystemQuestionSet>;
