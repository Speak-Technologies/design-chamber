// The completeness checklist of a design system (documentation/specs/system-builder-depth.md §4.5, D7).
// Pure: no Node imports. A closed list of topic ids keyed by `system.json` `depth`; the check names
// missing ids only, never agent text. `outOfScope` (system.json) lists ids the agent decided the system
// does not cover, and those stop counting (the user's decision 4, 2026-11-27).

import type { SystemTopicId } from './types.ts';

/** Every checklist topic id, the closed list `outOfScope` and the gap finding's detail draw from. */
export const SYSTEM_TOPIC_IDS: readonly SystemTopicId[] = Object.freeze([
  'surface', 'text', 'border', 'brand', 'status', 'type-styles', 'spacing', 'radius', 'pairs', 'dark-values',
  'state-colours', 'data-colours', 'control-sizes', 'breakpoints', 'elevation', 'layers', 'motion',
  'components', 'examples', 'focus-disabled',
  'voice', 'navigation', 'overlays', 'forms', 'feedback', 'states', 'data-display', 'accessibility', 'responsive',
  'logo', 'brand-colour', 'imagery', 'marketing',
] as const);

const TOPIC_SET: ReadonlySet<string> = new Set(SYSTEM_TOPIC_IDS);

export const isSystemTopicId = (value: unknown): value is SystemTopicId => typeof value === 'string' && TOPIC_SET.has(value);
