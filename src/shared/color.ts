// CSS colour maths for the contrast check (documentation/specs/agent-render-and-check.md §4.1):
// parse what `getComputedStyle` emits, composite alpha over a background chain, WCAG relative
// luminance and contrast ratio. Pure.

export type Rgba = { r: number; g: number; b: number; a: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const channel = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === 'none') return trimmed === 'none' ? 0 : null;
  const value = trimmed.endsWith('%') ? (Number.parseFloat(trimmed) / 100) * 255 : Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp(value, 0, 255) : null;
};

const alphaOf = (text: string | undefined): number | null => {
  if (text === undefined) return 1;
  const trimmed = text.trim();
  const value = trimmed.endsWith('%') ? Number.parseFloat(trimmed) / 100 : Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp(value, 0, 1) : null;
};

const parseHex = (hex: string): Rgba | null => {
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  const expand = (digits: string): string => [...digits].map((digit) => digit + digit).join('');
  const full = hex.length === 3 || hex.length === 4 ? expand(hex) : hex;
  if (full.length !== 6 && full.length !== 8) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
};

/**
 * A computed CSS colour as RGBA (0..255, alpha 0..1), or `null` when the text is not one this
 * understands (a colour space the browser kept, `currentcolor`, a keyword): the caller then
 * skips the contrast verdict rather than guessing.
 */
export const parseCssColor = (text: string): Rgba | null => {
  const value = text.trim().toLowerCase();
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (value.startsWith('#')) return parseHex(value.slice(1));
  const fn = /^(rgba?|color)\(\s*([^)]*)\)$/.exec(value);
  if (!fn) return null;
  const body = fn[2] ?? '';
  if (fn[1] === 'color') {
    // `color(srgb 0.1 0.2 0.3 / 0.5)`: the only space whose channels are plain sRGB.
    const srgb = /^srgb\s+([^/]+?)(?:\s*\/\s*(.+))?$/.exec(body);
    if (!srgb) return null;
    const parts = (srgb[1] ?? '').trim().split(/\s+/);
    if (parts.length !== 3) return null;
    const rgb = parts.map((part) => {
      const n = Number.parseFloat(part);
      return Number.isFinite(n) ? clamp(part.endsWith('%') ? (n / 100) * 255 : n * 255, 0, 255) : null;
    });
    const a = alphaOf(srgb[2]);
    if (rgb.some((n) => n === null) || a === null) return null;
    return { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0, a };
  }
  // `rgb(1, 2, 3)`, `rgba(1, 2, 3, 0.5)`, `rgb(1 2 3 / 50%)`.
  const [colors, slashAlpha] = body.split('/');
  const parts = (colors ?? '').split(/[\s,]+/).filter((part) => part !== '');
  const commaAlpha = parts.length === 4 ? parts[3] : undefined;
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map(channel);
  const a = alphaOf(slashAlpha ?? commaAlpha);
  if (rgb.some((n) => n === null) || a === null) return null;
  return { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0, a };
};

/** `top` painted over an opaque `bottom`. */
export const compositeOver = (top: Rgba, bottom: Rgba): Rgba => {
  const a = top.a + bottom.a * (1 - top.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number): number => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
};

const linear = (channel8: number): number => {
  const c = channel8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance of an opaque colour. */
export const relativeLuminance = (color: Rgba): number => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);

export const WHITE: Readonly<Rgba> = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });

/**
 * The colour a background chain paints: `chain` runs from the element outward up to the first
 * opaque ancestor; where the chain ends without one, the page canvas (white, the light scheme
 * the check renders in) is underneath.
 */
export const backdropOf = (chain: readonly Rgba[]): Rgba => {
  let backdrop: Rgba = { ...WHITE };
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const layer = chain[index];
    if (layer !== undefined) backdrop = compositeOver(layer, backdrop);
  }
  return backdrop;
};

/** WCAG contrast ratio (1..21) of text colour `fg` over a background chain. */
export const contrastRatio = (fg: Rgba, bgChain: readonly Rgba[]): number => {
  const backdrop = backdropOf(bgChain);
  const text = fg.a >= 1 ? fg : compositeOver(fg, backdrop);
  const a = relativeLuminance(text);
  const b = relativeLuminance(backdrop);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
};

/**
 * The AA minimum for text: 3:1 for large text (24 px, or 19 px and bold from 700), else 4.5:1.
 * Sizes are CSS px, as `getComputedStyle` reports them.
 */
export const minContrastFor = (fontPx: number, weight: number): number => (fontPx >= 24 || (fontPx >= 19 && weight >= 700) ? 3 : 4.5);
