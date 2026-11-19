// The token planner and value rules of a design system (documentation/specs/phase-2-5-technical.md
// §2.4, §6.1). Pure: no Node imports. Every value Design Chamber writes into a system or reads for
// display passes `validateTokenValue`, so nothing from a system can break out of a declaration.
//
// T0 seam: the signatures are the contract; T3 fills them (T11 adds the patterns/brand meta paths).
// The existing Tweaks planner (`tokensOp`) is not changed.

import type { TokenEdit } from './api.ts';
import type { TokenContext } from './tokens-css.ts';
import type { TokenSection } from './types.ts';

const NOT_BUILT = 'This part of Design Chamber (design systems) is not built yet.';
const notBuilt = (): never => {
  throw new Error(NOT_BUILT);
};

/** A type style field a value is checked for (§2.3); null for a token value. */
export type TypeField = 'family' | 'size' | 'weight' | 'lineHeight' | 'letterSpacing';

/**
 * `ok` with `formula: true` for a value holding `var(` `calc(` `min(` `max(` `clamp(` or `color-mix(`
 * (shown, not editable by hand); otherwise the refusal sentence naming the section's expected shape.
 */
export type ValueCheck = { ok: true; formula: boolean } | { ok: false; sentence: string };

export const validateTokenValue = (section: TokenSection, field: TypeField | null, text: string): ValueCheck => notBuilt();

/** The section a token without metadata falls into (§2.4). */
export const classifyToken = (name: string, value: string): TokenSection => notBuilt();

/**
 * `system`: only the top-level `:root` (light) and `:root` directly inside
 * `@media (prefers-color-scheme: dark)` (dark) count. `extraction`: the wider project forms of §2.4.
 */
export type ContextRules = 'system' | 'extraction';

export const isLightContext = (ctx: TokenContext, rules: ContextRules): boolean => notBuilt();
export const isDarkContext = (ctx: TokenContext, rules: ContextRules): boolean => notBuilt();

/** One planned change, as the ledger and the notice describe it. */
export type TokenEditChange = { name: string; mode: 'light' | 'dark'; before: string | null; after: string | null };

/**
 * The bytes after the edits, the changes made and the undo text, or the refusal sentence (§6.1).
 * `contexts: "design"` limits removals to the design's light `:root` and dark block (§6.4). `undo` is the
 * text needed to reverse it (splices, or the whole old text up to `SYSTEM_UNDO_TEXT_MAX`), null when over
 * that cap (the edit stands with `undoable: false`); T3 maps it onto the pipeline's undo steps.
 */
export type TokenEditPlan =
  | { result: string; changes: TokenEditChange[]; undo: { kind: 'splices'; splices: { start: number; removed: string; inserted: string }[] } | { kind: 'replace'; before: string } | null }
  | { refusal: string };

export const planTokenEdit = (css: string, edits: readonly TokenEdit[], options: { contexts: 'system' | 'design' }): TokenEditPlan => notBuilt();

/** Rescans `after` and checks it is exactly `before` with the planned edits applied (§6.1 Verify). */
export const verifyTokenEdit = (before: string, after: string, edits: readonly TokenEdit[]): boolean => notBuilt();
