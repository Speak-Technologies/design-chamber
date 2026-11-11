// Reads `window.__DC` (set by `frame-doc.ts` just before the bridge runs) into a `BridgeInit`
// (docs/SPEC.md §8.3; Phase 2 technical design §10.4). Pure, so it is unit-tested without a
// browser. The page is the trusted side, but the bridge re-validates what it seeds the frame with.

import { BRIDGE_PROTOCOL_VERSION, parsePageMessage, type BridgeInit, type TokenVar } from '../../shared/bridge-protocol.ts';
import { BRIDGE_ARTBOARD_ID_MAX, BRIDGE_NONCE_MAX } from '../../shared/limits.ts';
import { readStorageInit } from './storage-shim.ts';

/** The tweak preview, by the same rules as a `set-tokens` message; anything else means no preview. */
const readTokens = (value: unknown, artboardId: string, nonce: string): TokenVar[] | undefined => {
  if (value === undefined) return undefined;
  const message = parsePageMessage({ dc: BRIDGE_PROTOCOL_VERSION, type: 'set-tokens', artboardId, nonce, vars: value });
  return message?.type === 'set-tokens' ? message.vars : undefined;
};

/**
 * The init, or null when its core fields are malformed (the bridge then does not start).
 * Malformed `tokens` mean no preview; malformed `storage` means empty, unsaved storage.
 */
export const readInit = (value: unknown): BridgeInit | null => {
  if (typeof value !== 'object' || value === null) return null;
  const init = value as Partial<Record<keyof BridgeInit, unknown>>;
  const { artboardId, nonce, file, mode, scroll } = init;
  if (typeof artboardId !== 'string' || artboardId.length === 0 || artboardId.length > BRIDGE_ARTBOARD_ID_MAX) return null;
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > BRIDGE_NONCE_MAX) return null;
  if (typeof file !== 'string' || (mode !== 'edit' && mode !== 'play')) return null;
  if (typeof scroll !== 'object' || scroll === null) return null;
  const { x, y } = scroll as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const tokens = readTokens(init.tokens, artboardId, nonce);
  const storage = readStorageInit(init.storage);
  return {
    artboardId,
    file,
    mode,
    scroll: { x, y },
    nonce,
    ...(tokens ? { tokens } : {}),
    ...(storage ? { storage } : {}),
  };
};
