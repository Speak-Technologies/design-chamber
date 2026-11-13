// Build-time constants injected by scripts/build.mjs (esbuild `define`).

/** The minified IIFE source of `src/guest/bridge/bridge.ts`, injected into every design document. */
declare const __DC_BRIDGE__: string;

/** The minified IIFE source of `src/guest/probe/probe.ts` (`__dcProbe`), embedded in the service and CLI bundles for the design check. */
declare const __DC_PROBE__: string;

/** The minified IIFE source of `src/guest/bridge/storage-shim-entry.ts`, embedded in the service and CLI bundles and installed in the check browser before page scripts (empty, unsaved storage). */
declare const __DC_STORAGE_SHIM__: string;
