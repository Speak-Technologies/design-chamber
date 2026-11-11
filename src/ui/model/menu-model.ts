// How one row of a kit menu behaves, as a pure decision (Phase 2 technical design §5.4). The kit's
// `openMenu` draws the row from this and nothing else, so the rule is tested without a DOM.
//
// Three kinds of row:
// - enabled: reachable by the arrow keys, runs on Enter, Space and click;
// - disabled WITH a reason: the reason is drawn inside the option as a second muted line, and the
//   row stays reachable by the arrow keys (so a keyboard or screen-reader user finds the reason).
//   It is `aria-disabled`, not natively disabled, and Enter, Space and click do nothing;
// - disabled without a reason: the native disabled look, skipped by the arrow keys (as before). It
//   may point at the menu's foot note instead, which says the one thing that explains several rows
//   (the 40-screen cap).

/** The part of a menu entry the row's behaviour depends on. */
export type MenuRowEntry = {
  disabled?: boolean;
  /** Why the row is off, said inside the row. Only meaningful with `disabled`. */
  reason?: string;
  /** A disabled row without a reason of its own that the menu's foot note explains. */
  explainedBy?: 'foot';
};

/** Element ids a row may point at with `aria-describedby`. */
export type MenuRowIds = { reason: string; foot: string | null };

export type MenuRowState = {
  /** Skipped by the arrow keys: what the SDK's `moveListSelection` receives as `disabled`. */
  navDisabled: boolean;
  /** Enter, Space and click do nothing, and the menu stays open. */
  inert: boolean;
  /** The native `disabled` attribute. A row with a reason is `aria-disabled` instead. */
  nativeDisabled: boolean;
  /** Draw the reason line inside the row. */
  showsReason: boolean;
  /** The element id for `aria-describedby`, or null. */
  describedBy: string | null;
};

export const menuRowState = (entry: MenuRowEntry, ids: MenuRowIds): MenuRowState => {
  if (entry.disabled !== true) return { navDisabled: false, inert: false, nativeDisabled: false, showsReason: false, describedBy: null };
  const reason = entry.reason !== undefined && entry.reason !== '';
  if (reason) return { navDisabled: false, inert: true, nativeDisabled: false, showsReason: true, describedBy: ids.reason };
  return { navDisabled: true, inert: true, nativeDisabled: true, showsReason: false, describedBy: entry.explainedBy === 'foot' ? ids.foot : null };
};
