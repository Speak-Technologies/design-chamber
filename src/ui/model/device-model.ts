// What device a frame is on (documentation/specs/native-extras.md §2.2): `ready.device`, which an older host
// leaves out, read defensively because it ends up in CSS; and the few sentences that differ on a phone. Pure.
// `panelOnPhone` is a parameter, not `__DC_PANEL_MOBILE__`: only the built bundles define that.

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Device = { form: 'phone' | 'tablet' | 'desktop'; coarse: boolean; insets: Insets; keyboard: number };

/** Insets and the on-screen keyboard past this are a host bug, not a layout. */
const PX_MAX = 400;

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
export const DESKTOP_DEVICE: Device = { form: 'desktop', coarse: false, insets: NO_INSETS, keyboard: 0 };

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const px = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(PX_MAX, Math.max(0, Math.round(value))) : 0);

/** `context` is `ready`. A missing or malformed `device` is a desktop with a mouse. */
export const deviceOf = (context: { device?: unknown }): Device => {
  const raw = record(context.device);
  const { formFactor, pointer } = raw;
  if (formFactor !== 'phone' && formFactor !== 'tablet' && formFactor !== 'desktop') return DESKTOP_DEVICE;
  if (pointer !== 'coarse' && pointer !== 'fine') return DESKTOP_DEVICE;
  const insets = record(raw.insets);
  return {
    form: formFactor,
    coarse: pointer === 'coarse',
    insets: { top: px(insets.top), right: px(insets.right), bottom: px(insets.bottom), left: px(insets.left) },
    keyboard: px(raw.keyboard),
  };
};

export type DeviceHelp = {
  /** The design couldn't open from here. */
  notHere: string;
  serviceDown: string;
  /** The viewer's footer line; null where there is nothing to point at. */
  fullScreenHint: string | null;
  /** The rail's first-run tip. */
  firstRunTip: { title: string; body: string } | null;
};

const TIP_TITLE = 'Open Design Chamber full screen';

/**
 * Only a phone differs: a tablet keeps the desktop's sidebar. The phone page shows neither the hint nor the
 * tip; it doesn't read them (that choice belongs to the surface, not the device).
 */
export const openHelp = (device: Device, panelOnPhone: boolean): DeviceHelp => {
  if (device.form !== 'phone') {
    return {
      notHere: 'Open Design Chamber from the rail to see it.',
      serviceDown: 'Design Chamber isn’t responding.',
      fullScreenHint: 'Full screen: sidebar → Extension pages → Design Chamber',
      firstRunTip: { title: TIP_TITLE, body: 'In the sidebar, open Extension pages and pick Design Chamber. Canvases get the whole window there.' },
    };
  }
  const serviceDown = 'Design Chamber isn’t responding on your computer. Try again in a moment.';
  if (!panelOnPhone) return { notHere: 'Open Design Chamber from the More menu in your chats list.', serviceDown, fullScreenHint: null, firstRunTip: null };
  return {
    notHere: 'Design Chamber can’t open here yet. Open it from the More menu in your chats list.',
    serviceDown,
    fullScreenHint: 'Full screen: chats list → More → Design Chamber',
    firstRunTip: { title: TIP_TITLE, body: 'In your chats list, open More and pick Design Chamber.' },
  };
};
