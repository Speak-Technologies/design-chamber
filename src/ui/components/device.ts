// Puts the device on the frame's root for the stylesheets (documentation/specs/native-extras.md §2.2): data
// attributes for form, pointer and whether the on-screen keyboard is up, and the safe-area insets and keyboard height as CSS variables. Call it with
// every `applyHostReady`, so rotation and the on-screen keyboard follow. Only numbers `deviceOf` clamped reach
// a style.

import { DESKTOP_DEVICE, type Device } from '../model/device-model.ts';
import { withoutComputerOnly } from '../model/viewer-menu.ts';

let current: Device = DESKTOP_DEVICE;

/** The device of the last `applyDevice` in this frame (a desktop before the first `ready`), for views that adapt their actions. */
export const currentDevice = (): Device => current;

/** A menu as this device shows it: on a phone, without the entries that act on the computer (Reveal, Export, Copy path). */
export const menuOnThisDevice = <T extends { id: string } | { separator: true }>(entries: readonly T[]): T[] =>
  current.form === 'phone' ? withoutComputerOnly(entries) : [...entries];

export const applyDevice = (device: Device, root: HTMLElement): void => {
  current = device;
  root.dataset.dcForm = device.form;
  root.dataset.dcPointer = device.coarse ? 'coarse' : 'fine';
  root.dataset.dcKeyboard = device.keyboard > 0 ? 'up' : 'down';
  for (const side of ['top', 'right', 'bottom', 'left'] as const) root.style.setProperty(`--dc-inset-${side}`, `${device.insets[side]}px`);
  root.style.setProperty('--dc-keyboard', `${device.keyboard}px`);
};
