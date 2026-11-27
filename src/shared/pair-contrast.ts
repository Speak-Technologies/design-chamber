// Contrast of a system's colour pairs (documentation/specs/system-builder-depth.md D6, §4.4, §4.5).
// Pure, shared by the board's Pairs block, the static check and the visual check's measured pairs, so
// the three judge a pair the same way. A pair is judged per scheme: light from the light values; dark
// from each token's dark value, or its light value where it has none (what the dark page shows).
//
// Statically, only values Node can parse (hex, rgb(), color(srgb …)) and an opaque ground are judged;
// anything else (oklch(), a var() formula, a named colour, a see-through ground) is left to the check
// browser, which measures what it paints.

import type { ColourPairUse, SystemColourPair, SystemDetail, SystemToken } from './types.ts';
import { contrastRatio, parseCssColor, type Rgba } from './color.ts';

export type PairScheme = 'light' | 'dark';

/** The WCAG AA level each use must reach. */
export const PAIR_LEVELS: Readonly<Record<ColourPairUse, number>> = Object.freeze({ text: 4.5, large: 3, ui: 3 });

/**
 * How far under its level a measured pair must be before it is a finding: the check browser reads the
 * painted colour back through a canvas, which can round a channel (system-builder-depth §12).
 */
export const MEASURED_PAIR_TOLERANCE = 0.05;

/** Light always; dark too when any token has a dark value. */
export const pairSchemes = (detail: Pick<SystemDetail, 'tokens'>): PairScheme[] => (detail.tokens.some((token) => token.dark !== null) ? ['light', 'dark'] : ['light']);

const valueOf = (token: SystemToken | undefined, scheme: PairScheme): string | null => {
  if (token === undefined) return null;
  const value = scheme === 'dark' ? (token.dark ?? token.light) : token.light;
  return value === null || value.editable !== 'ok' ? null : value.text;
};

/** The two colours of a pair in one scheme, parsed; null when either can't be read here. */
const parsedPair = (tokens: ReadonlyMap<string, SystemToken>, pair: Pick<SystemColourPair, 'fg' | 'bg'>, scheme: PairScheme): { fg: Rgba; bg: Rgba } | null => {
  const fgText = valueOf(tokens.get(pair.fg), scheme);
  const bgText = valueOf(tokens.get(pair.bg), scheme);
  if (fgText === null || bgText === null) return null;
  const fg = parseCssColor(fgText);
  const bg = parseCssColor(bgText);
  // A see-through ground depends on what is under it: only the browser knows.
  if (fg === null || bg === null || bg.a < 1) return null;
  return { fg, bg };
};

const tokenMap = (detail: Pick<SystemDetail, 'tokens'>): Map<string, SystemToken> => new Map(detail.tokens.map((token) => [token.name, token]));

/** The pair's WCAG ratio in one scheme, or null when Node can't judge it (the check browser measures it). */
export const staticPairRatio = (detail: Pick<SystemDetail, 'tokens'>, pair: Pick<SystemColourPair, 'fg' | 'bg'>, scheme: PairScheme): number | null => {
  const colours = parsedPair(tokenMap(detail), pair, scheme);
  return colours === null ? null : contrastRatio(colours.fg, [colours.bg]);
};

/** A ratio as the board and the findings write it: rounded down to two places, so 4.499 never reads 4.50. */
export const ratioText = (ratio: number): string => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;

/** One pair under its level in one scheme. */
export type LowPair = { index: number; pair: SystemColourPair; scheme: PairScheme; ratio: number };

/** Every pair Node can judge that is under its level, per scheme (index into `detail.pairs`). */
export const staticLowPairs = (detail: Pick<SystemDetail, 'tokens' | 'pairs'>): { low: LowPair[]; judged: Set<string> } => {
  const tokens = tokenMap(detail);
  const low: LowPair[] = [];
  const judged = new Set<string>();
  for (const scheme of pairSchemes(detail)) {
    detail.pairs.forEach((pair, index) => {
      const colours = parsedPair(tokens, pair, scheme);
      if (colours === null) return;
      judged.add(pairKey(index, scheme));
      const ratio = contrastRatio(colours.fg, [colours.bg]);
      if (ratio < PAIR_LEVELS[pair.use]) low.push({ index, pair, scheme, ratio });
    });
  }
  return { low, judged };
};

/** `3-dark`: the pair index and scheme, as the board's `data-dc-pair` attribute and the judged set write it. */
export const pairKey = (index: number, scheme: PairScheme): string => `${index}-${scheme}`;
