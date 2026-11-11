// The check-browser storage stand-in (docs/SPEC.md §9.9, technical design §8.5). Bundled alone as
// an IIFE (`__DC_STORAGE_SHIM__`) and installed with CDP Page.addScriptToEvaluateOnNewDocument
// before any design script, so a design that legitimately uses localStorage does not fail the
// check with a console error. Empty and unsaved: nothing persists between artboards.
import { installStorage } from './storage-shim.ts';

installStorage(window, undefined, () => undefined);