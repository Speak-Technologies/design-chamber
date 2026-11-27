// Compare sheets (documentation/specs/system-builder-depth.md §13 T18): a system screen drawn by the check
// beside a screenshot of the real app the agent or the user saved in `sources/screens/`. Pure: which light
// screen artboards get a sheet (the viewport as wide as the picture, ±2 px, at most
// `SYSTEM_COMPARE_SHEETS_MAX`), and what a screen whose sheet wasn't made says. The run (system-run.ts) reads
// the pictures, draws the screens and stitches the sheets; the service never opens, runs or pictures the app.

import { cleanDetail } from '../../shared/checks.ts';
import { CHECK_DETAIL_MAX, SYSTEM_COMPARE_SHEETS_MAX } from '../../shared/limits.ts';
import { systemScreenFileOf } from '../../shared/system-json.ts';
import type { CheckFindingData, Viewport } from '../../shared/types.ts';
import type { PlannedArtboard } from './render.ts';

/** How far a picture's width may be from the viewport's and still be compared (a scrollbar, a rounding). */
export const COMPARE_WIDTH_TOLERANCE = 2;

/** A screen's source as the run read it: its size from the header, or unreadable (not the picture its name says). */
export type CompareSource =
  | { screen: string; source: string; ok: true; type: 'png' | 'jpeg'; width: number; height: number; bytes: Buffer }
  | { screen: string; source: string; ok: false };

/** One sheet to make: the screen's light artboard and the source it is compared with. */
export type CompareTarget = { screen: string; viewport: Viewport; source: Extract<CompareSource, { ok: true }> };

const noteFor = (screen: string, params?: CheckFindingData['params'], detail?: string): CheckFindingData => ({
  code: 'system-compare-skipped',
  file: systemScreenFileOf(screen),
  screen,
  viewport: null,
  ...(params !== undefined ? { params } : {}),
  ...(detail !== undefined ? { detail: cleanDetail(detail, CHECK_DETAIL_MAX) } : {}),
});

/**
 * The sheets a run makes, in plan order: for each screen with a readable source, each of its light
 * artboards in the plan whose width is within `COMPARE_WIDTH_TOLERANCE` of the picture's. A source no
 * viewport matches is one note with the picture's width; an unreadable one is one note; past the cap the
 * rest are one note with the count. A screen the plan doesn't draw (`--screen`, the artboard limit) gets nothing.
 */
export const planCompares = (sources: readonly CompareSource[], plan: readonly PlannedArtboard[]): { targets: CompareTarget[]; findings: CheckFindingData[] } => {
  const all: CompareTarget[] = [];
  const findings: CheckFindingData[] = [];
  for (const source of sources) {
    const light = plan.filter((art) => art.scheme !== 'dark' && art.screen === source.screen);
    if (light.length === 0) continue;
    if (!source.ok) {
      findings.push(noteFor(source.screen, undefined, `${source.screen}: ${source.source}`));
      continue;
    }
    const matching = light.filter((art) => Math.abs(art.viewport.width - source.width) <= COMPARE_WIDTH_TOLERANCE);
    if (matching.length === 0) {
      findings.push(noteFor(source.screen, { px: source.width }, `${source.screen}: ${source.source}`));
      continue;
    }
    for (const art of matching) all.push({ screen: source.screen, viewport: art.viewport, source });
  }
  const over = all.slice(SYSTEM_COMPARE_SHEETS_MAX);
  const first = over[0];
  if (first !== undefined) findings.push(noteFor(first.screen, { reason: 'limit', count: over.length, max: SYSTEM_COMPARE_SHEETS_MAX }, over.map((target) => `${target.screen} at ${target.viewport.label}`).join('; ')));
  return { targets: all.slice(0, SYSTEM_COMPARE_SHEETS_MAX), findings };
};

/** The sheets the time cut: one note with the count, naming the first screen. */
export const compareBudgetNote = (left: readonly CompareTarget[]): CheckFindingData[] => {
  const first = left[0];
  return first === undefined ? [] : [noteFor(first.screen, { reason: 'budget', count: left.length }, left.map((target) => `${target.screen} at ${target.viewport.label}`).join('; '))];
};

/**
 * The document that turns a picture Node can't read (a JPEG, a palette or 16-bit PNG) into the browser's
 * own PNG: the picture alone at its size, from a data URL (the check's CSP allows `img-src data:`).
 */
export const sourceDocument = (source: Extract<CompareSource, { ok: true }>): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}img{display:block;width:${source.width}px;height:${source.height}px}</style></head><body><img alt="" src="data:image/${source.type};base64,${source.bytes.toString('base64')}"></body></html>`;
