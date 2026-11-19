// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.9, AD-15, AD-28). T0 stub: T12b fills it.
// Adopting an agent-written BUILD.json: the I/O half of the repo home check (realpath, lstat); the pure half is `repoHomeShapeProblem`.

import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

/** Subscribes to BUILD.json changes and runs once per system at start; returns the unsubscribe. */
export const startHomes = (ctx: ServiceContext): (() => void) => notBuilt();
