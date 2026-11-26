// What the visual system check pictures at one board width (documentation/specs/
// system-board-layout-and-visual-check.md §B.4, revised after QA): every shown area gets an
// overview (the whole area scaled down, made from small strips the browser draws band by band) and
// full-size tiles, 900px bands from the area's top. Full-size tiles are paid from a pixel budget,
// not a tile count: the bands around entries with a finding first, then the rest top to bottom, so a
// product-sized system is pictured whole and a huge one stays bounded with an honest note. Pure.

import {
  SYSTEM_CHECK_ENTRY_TILES_MAX,
  SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX,
  SYSTEM_CHECK_OVERVIEW_SCALE_MAX,
  SYSTEM_CHECK_OVERVIEW_SCALE_MIN,
} from '../../shared/limits.ts';
import type { SystemArea } from '../../shared/types.ts';

export type PictureBand = {
  /** 1-based band number within the area (the tile's number in its file name). */
  index: number;
  /** Document y of the band's top, px. */
  y: number;
  height: number;
  /** A full-size tile is taken of this band. */
  tile: boolean;
  /** The band shows an entry with a finding: its tile is taken even when time runs short. */
  priority: boolean;
  /** Document px of this band that go into the overview (0 = none, past the overview's reach). */
  strip: number;
};

export type AreaPicturePlan = {
  area: SystemArea;
  top: number;
  height: number;
  /** The overview's scale, and how much of the area it shows (all of it unless the area is very tall). */
  scale: number;
  coversPx: number;
  bands: PictureBand[];
};

export type PicturePlanInput = {
  /** The areas to picture, in board order (document coordinates). */
  areas: readonly { area: SystemArea; top: number; height: number }[];
  /** Boxes of entries with a finding at this width (document y). */
  flagged: readonly { top: number; bottom: number }[];
  viewportWidth: number;
  /** A full-size tile's height (the viewport's height). */
  tileHeight: number;
  /** This width's full-size pixel budget. */
  tilePixels: number;
  /** This width's PNG budget, overviews included. */
  pngs: number;
};

/** The overview scale for an area of `height` px: fit SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX, within the bounds. */
export const overviewScaleOf = (height: number): number => {
  const fit = height > 0 ? SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX / height : SYSTEM_CHECK_OVERVIEW_SCALE_MAX;
  return Math.round(Math.min(SYSTEM_CHECK_OVERVIEW_SCALE_MAX, Math.max(SYSTEM_CHECK_OVERVIEW_SCALE_MIN, fit)) * 1000) / 1000;
};

export const planBoardPictures = (input: PicturePlanInput): AreaPicturePlan[] => {
  const plans: AreaPicturePlan[] = [];
  for (const measured of input.areas) {
    const top = Math.max(0, Math.round(measured.top));
    const height = Math.max(0, Math.ceil(measured.height));
    const scale = overviewScaleOf(height);
    // The overview shows the whole area unless the scale is at its floor and the area still doesn't fit (rounding the
    // scale may add a few pixels to the overview's height; that never cuts the area).
    const coversPx = height * SYSTEM_CHECK_OVERVIEW_SCALE_MIN > SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX ? Math.floor(SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX / SYSTEM_CHECK_OVERVIEW_SCALE_MIN) : height;
    const bands: PictureBand[] = [];
    for (let y = top, index = 1; y < top + height; y += input.tileHeight, index += 1) {
      const bandHeight = Math.min(input.tileHeight, top + height - y);
      bands.push({ index, y, height: bandHeight, tile: false, priority: false, strip: Math.max(0, Math.min(bandHeight, top + coversPx - y)) });
    }
    plans.push({ area: measured.area, top, height, scale, coversPx, bands });
  }

  // The bands that show an entry with a finding: its top SYSTEM_CHECK_ENTRY_TILES_MAX bands.
  for (const box of input.flagged) {
    let taken = 0;
    for (const plan of plans) {
      for (const band of plan.bands) {
        if (taken >= SYSTEM_CHECK_ENTRY_TILES_MAX) break;
        if (band.y < box.bottom && band.y + band.height > box.top) {
          band.priority = true;
          taken += 1;
        }
      }
    }
  }

  const overviews = plans.filter((plan) => plan.coversPx > 0).length;
  let pngsLeft = input.pngs - overviews;
  let pixelsLeft = input.tilePixels;
  const take = (band: PictureBand): void => {
    const cost = band.height * input.viewportWidth;
    if (band.tile || pngsLeft < 1 || cost > pixelsLeft) return;
    band.tile = true;
    pngsLeft -= 1;
    pixelsLeft -= cost;
  };
  const all = plans.flatMap((plan) => plan.bands);
  for (const band of all) if (band.priority) take(band);
  for (const band of all) take(band);
  return plans;
};

/**
 * How one area at one width came out in pictures, for the single honest note about what is left out. Exactly one kind:
 * `gap` = some of the area is in no picture (both the overview and the full-size tiles stop short, or there
 * is no overview and the tiles stop); `no-overview` = the overview couldn't be made but the tiles show all of
 * it; `overview` = the overview stops early but the tiles show the rest; `tiles` = the tiles stop but the
 * overview shows the rest; `whole` = nothing to say. `gaps` are the unpictured ranges, px from the area's top.
 */
export type PictureCoverage = { kind: 'whole' | 'tiles' | 'overview' | 'no-overview' | 'gap'; gaps: [number, number][] };

export const pictureCoverage = (shot: { heightPx: number; overview: { coversPx: number } | null; tiles: readonly { y: number; height: number }[] }): PictureCoverage => {
  const covered: [number, number][] = [...shot.tiles.map((tile): [number, number] => [tile.y, tile.y + tile.height])];
  if (shot.overview !== null) covered.push([0, shot.overview.coversPx]);
  covered.sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let reached = 0;
  for (const [from, to] of covered) {
    if (from > reached) gaps.push([reached, Math.min(from, shot.heightPx)]);
    reached = Math.max(reached, to);
    if (reached >= shot.heightPx) break;
  }
  if (reached < shot.heightPx) gaps.push([reached, shot.heightPx]);
  const real = gaps.filter(([from, to]) => to - from >= 1);
  if (real.length > 0) return { kind: 'gap', gaps: real };
  if (shot.overview === null) return { kind: 'no-overview', gaps: [] };
  if (shot.overview.coversPx < shot.heightPx) return { kind: 'overview', gaps: [] };
  const tiled = shot.tiles.reduce((sum, tile) => sum + tile.height, 0);
  return { kind: tiled < shot.heightPx ? 'tiles' : 'whole', gaps: [] };
};
