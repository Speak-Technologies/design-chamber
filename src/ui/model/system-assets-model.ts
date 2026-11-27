// What the section panel says about motion tokens and icons (system-builder-depth T10c). Pure: no DOM, no host.

import { motionValueKind } from '../../shared/token-edit.ts';
import type { SystemDetail, SystemToken } from '../../shared/types.ts';
import { plural } from './format.ts';

export const MOTION_EMPTY = 'No motion tokens yet. Ask the agent to add some.';
export const ICONS_EMPTY = 'No icons yet. Ask the agent to add some.';

export type MotionKind = 'Duration' | 'Easing';

/** What a motion value is; null for a formula or a value the rules refuse (the row then claims nothing). */
export const motionKindLabel = (text: string | null): MotionKind | null => {
  const kind = text === null ? null : motionValueKind(text);
  return kind === null ? null : kind === 'time' ? 'Duration' : 'Easing';
};

/** "2 durations, 3 easings", or "5 motion values" when some are neither (a formula). */
export const motionCountText = (tokens: readonly SystemToken[]): string => {
  const kinds = tokens.map((token) => motionKindLabel(token.light?.text ?? null));
  if (kinds.includes(null)) return plural(tokens.length, 'motion value');
  const durations = kinds.filter((kind) => kind === 'Duration').length;
  const easings = kinds.length - durations;
  return [durations > 0 ? plural(durations, 'duration') : null, easings > 0 ? plural(easings, 'easing') : null].filter((part) => part !== null).join(', ');
};

/** "12 icons, 3 files": icons are named apart from the fonts and source files beside them. Empty text for none. */
export const assetsCountText = (detail: Pick<SystemDetail, 'fonts' | 'sourceFiles'> & Partial<Pick<SystemDetail, 'icons'>>): string => {
  const icons = detail.icons?.length ?? 0;
  const files = detail.fonts.length + detail.sourceFiles.length;
  return [icons > 0 ? plural(icons, 'icon') : null, files > 0 ? plural(files, 'file') : null].filter((part) => part !== null).join(', ');
};

export type IconPicture = { src: string };

const ICON_GRID = 'class="dc-grid dc-icons"';
const CARD = /<div class="dc-card" data-dc-entry="icon:(\d{1,3})">/g;
/** Only a base64 SVG data URL is ever taken, so nothing else can reach an `src`. */
const PICTURE = /<img class="dc-icon(?: [^"]*)?"[^>]*? src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2})"/;

/**
 * The icon pictures the specimen board already carries, by position in `detail.icons`. The service has no route
 * for one file, and the board bundles every icon as `<img src="data:…">`, so the panel reads those addresses as
 * text. The board is never parsed into the page and only ever used as an `<img>`, so no markup or script of an
 * icon runs. Only the last icon grid counts: an agent's example earlier in the document can't stand in for it.
 */
export const iconPictures = (boardHtml: string): Map<number, IconPicture> => {
  const pictures = new Map<number, IconPicture>();
  const start = boardHtml.lastIndexOf(ICON_GRID);
  if (start < 0) return pictures;
  const grid = boardHtml.slice(start);
  const cards = [...grid.matchAll(CARD)];
  cards.forEach((card, position) => {
    const from = card.index + card[0].length;
    const body = grid.slice(from, cards[position + 1]?.index ?? grid.length);
    const end = body.indexOf('</section>');
    const src = PICTURE.exec(end < 0 ? body : body.slice(0, end))?.[1];
    if (src !== undefined) pictures.set(Number(card[1]), { src });
  });
  return pictures;
};
