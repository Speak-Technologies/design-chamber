// SystemAsk (documentation/specs/phase-2-5-technical.md §8.12): the question a /design-system chat
// asks in place, as a block. Which of the three views it is comes from the checked arguments; the
// question set the two rounds draw is baked into this bundle at build time.

import type { SystemQuestionSet } from '../../shared/types.ts';
import type { SystemAskBlock } from '../model/block-args.ts';
import type { BlockContext, BlockView } from './block-view.ts';
import { mountDiff } from './system-ask-diff.ts';
import { mountInterview } from './system-ask-interview.ts';

export const mountSystemAsk = (root: HTMLElement, ctx: BlockContext, ask: SystemAskBlock, set: SystemQuestionSet, answered: string | null): BlockView =>
  ask.kind === 'diff' ? mountDiff(root, ctx, ask, set, answered) : mountInterview(root, ctx, ask, set, answered);
