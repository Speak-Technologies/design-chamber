// Puts the device on the frame's root for the stylesheets (documentation/specs/native-extras.md §2.2): data
// attributes for form and pointer, and the safe-area insets and keyboard height as CSS variables. Call it with
// every `applyHostReady`, so rotation and the on-screen keyboard follow. Only numbers `deviceOf` clamped reach
// a style.

import type { Device } from '../model/device-model.ts';

export const applyDevice = (device: Device, root: HTMLElement): void => {
  root.dataset.dcForm = device.form;
  root.dataset.dcPointer = device.coarse ? 'coarse' : 'fine';
  for (const side of ['top', 'right', 'bottom', 'left'] as const) root.style.setProperty(`--dc-inset-${side}`, `${device.insets[side]}px`);
  root.style.setProperty('--dc-keyboard', `${device.keyboard}px`);
};
