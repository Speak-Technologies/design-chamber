// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.11, §2.14, rev 3). T0 stub: T14 fills
// `scanLivingPage` and `normaliseForHash`; T12b filled `readLivingPageMark` (the adoption check reads
// an existing living page's mark before it ever lets a generated page replace it, §5.9).
// The allowlist scan of a living page and its mark (pure; bundled into the CLI check). Text content is never a reason.

import { LIVING_PAGE_MARK_NAME, SYSTEM_ID_PATTERN } from '../../shared/limits.ts';

// Pure: no service imports, so the CLI check can bundle it.
const notBuilt = (): never => {
  throw new Error('This part of Design Chamber (design systems) is not built yet.');
};

export type LivingPageMark = { system: string; revision: number; generated: string; hash: string };

export const scanLivingPage = (text: string): { safe: boolean; reasons: string[]; mark: LivingPageMark | null } => notBuilt();

/** An attribute's value, double or single quoted; null when the tag does not carry it. */
const attrOf = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? null);
};

/**
 * The `dc-living-page` mark (§2.14): one meta tag whose content is exactly
 * `design-chamber/living-page@1 system=<id> revision=<n> generated=<ISO> hash=<64 hex>`.
 * Null when there is no mark or it is not this shape — the caller treats that as "not this
 * system's page", never as a reason to overwrite the file.
 */
export const readLivingPageMark = (text: string): LivingPageMark | null => {
  for (const tag of text.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attrOf(tag, 'name') !== LIVING_PAGE_MARK_NAME) continue;
    const content = attrOf(tag, 'content');
    if (content === null) return null;
    const mark = /^design-chamber\/living-page@1 system=([^\s]+) revision=(\d{1,9}) generated=([^\s]+) hash=([0-9a-f]{64})$/.exec(content);
    if (mark === null) return null;
    const [, system = '', revision = '', generated = '', hash = ''] = mark;
    if (!SYSTEM_ID_PATTERN.test(system) || generated.length > 40 || !Number.isFinite(Date.parse(generated))) return null;
    return { system, revision: Number(revision), generated, hash };
  }
  return null;
};

/** Decode, drop a BOM, LF line ends, no trailing blanks, one final LF, the mark's hash zeroed (§2.14 rev 3). */
export const normaliseForHash = (text: string): string => notBuilt();
