// Build-time constants injected by scripts/build.mjs (esbuild `define`).

import type { SystemQuestionSet } from '../shared/types.ts';

declare global {
  /** The minified IIFE source of `src/guest/bridge/bridge.ts`, injected into every design document. */
  const __DC_BRIDGE__: string;

  /** The minified IIFE source of `src/guest/probe/probe.ts` (`__dcProbe`), embedded in the service and CLI bundles for the design check. */
  const __DC_PROBE__: string;

  /** The minified IIFE source of `src/guest/bridge/storage-shim-entry.ts`, embedded in the service and CLI bundles and installed in the check browser before page scripts (empty, unsaved storage). */
  const __DC_STORAGE_SHIM__: string;

  /** The interview parsed from `rules/SYSTEM-QUESTIONS.md` at build time (step 10b), baked into the blocks bundle: the SystemAsk block's fixed wording (§8.9, AD-25). */
  const __DC_SYSTEM_QUESTIONS__: SystemQuestionSet;

  /**
   * `contributes.panel.mobile === true` in the shipped manifest, set in every frame bundle (panel, background,
   * status, blocks), so phone copy matches what was shipped (native-extras §2.2). Not defined under `node --test`:
   * read it at a frame's entry and pass it in, never inside a pure model.
   */
  const __DC_PANEL_MOBILE__: boolean;
}

export {};
