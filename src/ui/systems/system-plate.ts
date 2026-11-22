// The plate a design system wears in the library: a small sample of its own colours where a design shows its
// thumbnail (Phase 2.6 L1b, the approved canvas's "plate"). The swatches are the system's content, painted
// through the style object after `plateSwatches` checked each one, never written as markup; everything else
// (the surface, the sample letters, the lines) is host chrome and follows the theme. A system with no readable
// colours shows the system glyph on the same surface.

import { h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { plateSwatches } from '../model/systems-model.ts';
import type { SystemSummary } from '../../shared/types.ts';

export type PlateVariant = 'tile' | 'row';

export const mountPlate = (summary: Pick<SystemSummary, 'swatches'>, variant: PlateVariant): HTMLElement => {
  const colours = plateSwatches(summary);
  const plate = h('span', { class: 'dc-plate', 'data-variant': variant, 'data-empty': colours.length === 0 ? 'true' : 'false', 'aria-hidden': 'true' });
  if (colours.length === 0) {
    plate.append(icon('system', variant === 'tile' ? 28 : 18));
    return plate;
  }
  plate.append(h('span', { class: 'dc-plate-aa' }, 'Aa'));
  if (variant === 'tile') {
    const accent = h('span', { class: 'dc-plate-accent' });
    accent.style.setProperty('background-color', colours[0] ?? '');
    plate.append(h('span', { class: 'dc-plate-spec' }, accent, h('span', { class: 'dc-plate-line', 'data-w': 'long' }), h('span', { class: 'dc-plate-line', 'data-w': 'short' })));
  }
  const strip = h('span', { class: 'dc-plate-swatches' });
  for (const colour of colours) {
    const cell = h('i', { class: 'dc-plate-swatch' });
    cell.style.setProperty('background-color', colour);
    strip.append(cell);
  }
  plate.append(strip);
  return plate;
};

/** A single swatch square for the sidebar row and the design chip; neutral when the system has no readable colour. */
export const mountSwatchDot = (colour: string | null, className: string): HTMLElement => {
  const dot = h('span', { class: className, 'data-empty': colour === null ? 'true' : 'false', 'aria-hidden': 'true' });
  if (colour !== null) dot.style.setProperty('background-color', colour);
  return dot;
};
