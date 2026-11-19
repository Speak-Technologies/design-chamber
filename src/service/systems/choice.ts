// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.5). T0 stub: T7 fills it.
// The agent's recorded `systemChoice` (AD-6): the service validates it and links itself; an agent can only ask.

import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

/** Subscribes to design events; returns the unsubscribe. */
export const startChoiceReconciler = (ctx: ServiceContext): (() => void) => notBuilt();
