// The Design Chamber note in every agent's instructions (documentation/specs/phase-1-5-sdk-2-7.md
// §U2.3): built from the current root and sent with `ctx.hostCalls.setInstructions` after the
// watcher baseline and on every root change, skipping a text identical to the last one sent.
//
// Seam stub: sends nothing yet. The agent-skill branch (U2) fills it with `buildInstructions`
// (`src/shared/agent/instructions.ts`).

import type { ServiceContext } from './context.ts';

export type InstructionsDeps = {
  /** The launcher's check command for `root` with the literal `<slug>`, or `null` when it is not in place. */
  commandFor: (root: string) => Promise<string | null>;
  /** The watcher's baseline: the first text is sent after it. */
  ready: Promise<void>;
};

/** Start keeping the instructions current; answers the stop function. */
export const startInstructions = (_ctx: ServiceContext, _deps: InstructionsDeps): (() => void) => () => undefined;
