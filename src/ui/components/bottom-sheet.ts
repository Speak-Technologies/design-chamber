// Keeps the rail's Tweaks bottom sheet within half of its host and tells the view when its height changes,
// so the wall can refit to the part still visible above it (Phase 2 §4.6.1). A percentage `max-height` would not
// resolve against the host's auto-height wrapper, so the cap is written in px (`--dc-sheet-max`, styles.css).

import { bottomSheetMax } from '../model/tweaks-model.ts';
import type { SheetHandle } from './kit.ts';

/** Start tracking; returns the function that stops it. `onResize` runs when the host or the sheet's panel changes size. */
export const trackBottomSheet = (host: HTMLElement, sheet: SheetHandle, onResize: () => void): (() => void) => {
  const panel = sheet.el.querySelector<HTMLElement>('.dc-sheet-panel');
  const setMax = (): void => sheet.el.style.setProperty('--dc-sheet-max', `${bottomSheetMax(host.clientHeight)}px`);
  setMax();
  const observer = new ResizeObserver(() => {
    setMax();
    onResize();
  });
  observer.observe(host);
  if (panel) observer.observe(panel);
  return () => observer.disconnect();
};
