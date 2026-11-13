// What a design frame is seeded with, by design slug (Phase 2 §4.4 and §8.4). Two things sit outside the frame slot's own
// options because they belong to the open design, not to one frame, and change while frames exist:
//
//   - the Tweaks preview (custom properties every frame wears on top of tokens.css), and
//   - the saved page data (the design's `localStorage` seed, and the wait for it).
//
// A frame reads both when its document is made and again when it turns `ready`. No DOM here, so the rules are tested without one.

import type { PageMessageBody } from '../../guest/frame-channel.ts';
import type { StorageInit, TokenVar } from '../../shared/bridge-protocol.ts';

const tokenPreviews = new Map<string, readonly TokenVar[]>();

/** The wall's `setTokenPreview` is the only writer; it clears the entry on dispose. `[]` clears. */
export const setSlotTokens = (slug: string, vars: readonly TokenVar[]): void => {
  if (vars.length === 0) tokenPreviews.delete(slug);
  else tokenPreviews.set(slug, vars);
};
export const slotTokens = (slug: string): readonly TokenVar[] => tokenPreviews.get(slug) ?? [];

/** The design's saved page data as a frame sees it: wait for `ready` (at most the controller's 2 s), then take `init()`. */
export type SlotStorage = { ready: Promise<void>; init: () => StorageInit };

const storages = new Map<string, SlotStorage>();

/**
 * Register the live design's saved data. Returns the function that forgets it, which does nothing when a newer registration
 * replaced this one (a design closed and reopened quickly).
 */
export const setSlotStorage = (slug: string, source: SlotStorage): (() => void) => {
  storages.set(slug, source);
  return () => {
    if (storages.get(slug) === source) storages.delete(slug);
  };
};
export const slotStorage = (slug: string): SlotStorage | undefined => storages.get(slug);

/**
 * What a frame is told when it turns `ready`: where the preview stands now. It is sent even when the preview is empty, so a
 * Reset or Discard made while the frame was loading clears what the frame was created wearing (KI-20).
 */
export const onReadyMessages = (slug: string): PageMessageBody[] => [{ type: 'set-tokens', vars: [...slotTokens(slug)] }];
