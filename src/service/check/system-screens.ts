// System screens in the system check (documentation/specs/system-builder-depth.md §4.6, §13 T12b, §16).
// Pure: which screen artboards a run draws, in what order, how their dark twins are named, which
// findings a dark twin repeats, and what a run that left screens out says. The run itself
// (system-run.ts) bundles and renders them with the design check's own path (`renderArtboards`
// without `inspect`), so the design probe and `analyze.ts` judge a screen exactly as a design screen.

import { cleanDetail } from '../../shared/checks.ts';
import { CHECK_ARTBOARDS_MAX, CHECK_DETAIL_MAX } from '../../shared/limits.ts';
import { systemScreenFileOf } from '../../shared/system-json.ts';
import type { CheckFindingData, SystemDetail, Viewport } from '../../shared/types.ts';
import type { PlannedArtboard } from './render.ts';

/** A viewport id is at most 41 characters (`VIEWPORT_ID_PATTERN`); the dark twin's id keeps within it. */
const DARK_SUFFIX = '-dark';
const VIEWPORT_ID_LENGTH_MAX = 41;

/** `phone` → `phone-dark`: the dark twin of a screen viewport, as the board's `wide-dark` (names the pictures and the findings). */
export const darkViewportId = (id: string): string => `${id.slice(0, VIEWPORT_ID_LENGTH_MAX - DARK_SUFFIX.length)}${DARK_SUFFIX}`;

/** The sizes a screen shows at: its own, else the system's. */
export const screenViewportsOf = (detail: Pick<SystemDetail, 'viewports'>, screen: SystemDetail['screens'][number]): Viewport[] => screen.viewports ?? detail.viewports;

/** A viewport as one screen draws it. */
export type ScreenViewport = Viewport & { screen: string };

export type ScreenPlan = {
  /** The artboards to draw, light ones first (screen order, then viewport order), then the dark twins. */
  plan: PlannedArtboard[];
  /** Artboards left out past `CHECK_ARTBOARDS_MAX`, in plan order (so dark twins go first). */
  overLimit: PlannedArtboard[];
  /**
   * Every size the plan draws, per screen (the dark twins labelled ", dark"), for the findings' sentences.
   * Keyed by screen as well as id: two screens may use one viewport id at different sizes.
   */
  viewports: ScreenViewport[];
};

/**
 * One artboard per listed screen per viewport, in the schemes asked for (light first, so a cut keeps
 * the light results). A screen with a problem (missing, over the cap) is not drawn: the file checks
 * name it. `only` (`--screen`) keeps those screens; null keeps them all.
 */
export const planScreenArtboards = (
  detail: Pick<SystemDetail, 'screens' | 'viewports'>,
  options: { only: readonly string[] | null; schemes: readonly ('light' | 'dark')[] },
): ScreenPlan => {
  const screens = detail.screens.filter((screen) => screen.problem === null && (options.only === null || options.only.includes(screen.id)));
  const all: PlannedArtboard[] = [];
  const viewports = new Map<string, ScreenViewport>();
  for (const scheme of (['light', 'dark'] as const).filter((candidate) => options.schemes.includes(candidate))) {
    for (const screen of screens) {
      for (const viewport of screenViewportsOf(detail, screen)) {
        const drawn: Viewport = scheme === 'dark' ? { id: darkViewportId(viewport.id), label: `${viewport.label}, dark`, width: viewport.width, height: viewport.height } : viewport;
        const key = `${screen.id}|${drawn.id}`;
        if (!viewports.has(key)) viewports.set(key, { ...drawn, screen: screen.id });
        all.push({ file: systemScreenFileOf(screen.id), screen: screen.id, viewport: drawn, ...(scheme === 'dark' ? { scheme: 'dark' as const } : {}) });
      }
    }
  }
  return { plan: all.slice(0, CHECK_ARTBOARDS_MAX), overLimit: all.slice(CHECK_ARTBOARDS_MAX), viewports: [...viewports.values()] };
};

/**
 * The screen findings with each dark twin's repeats dropped: a finding on a dark artboard that the
 * same screen's light artboard at the same size already has (same code, selector and detail) says
 * nothing new. Colour findings differ between the schemes, so they stay.
 */
export const dedupeDarkScreenFindings = (findings: readonly CheckFindingData[], plan: readonly PlannedArtboard[]): CheckFindingData[] => {
  const lightOf = new Map<string, string>();
  for (const art of plan) {
    if (art.scheme !== 'dark' || art.screen === null) continue;
    const light = plan.find((candidate) => candidate.scheme !== 'dark' && candidate.screen === art.screen && darkViewportId(candidate.viewport.id) === art.viewport.id);
    if (light !== undefined) lightOf.set(`${art.screen}|${art.viewport.id}`, light.viewport.id);
  }
  const keyOf = (finding: CheckFindingData, viewport: string | null): string => `${finding.code}|${finding.file ?? ''}|${finding.screen ?? ''}|${viewport ?? ''}|${finding.selector ?? ''}|${finding.detail ?? ''}`;
  const seen = new Set(findings.map((finding) => keyOf(finding, finding.viewport)));
  return findings.filter((finding) => {
    const light = finding.screen === null || finding.viewport === null ? undefined : lightOf.get(`${finding.screen}|${finding.viewport}`);
    return light === undefined || !seen.has(keyOf(finding, light));
  });
};

/** `home at Phone` for a left-out artboard. */
const artLabel = (art: PlannedArtboard): string => `${art.screen ?? art.file} at ${art.viewport.label}`;

/**
 * What a run that left screen artboards out says: one `render-skipped` per reason (the artboard limit,
 * the time budget, a browser that kept failing), naming the first one left out as its file and listing
 * them all in `detail`, so the sentence can say "Use --screen <id> to check the rest."
 */
export const screenSkippedFindings = (input: {
  overLimit: readonly PlannedArtboard[];
  notRendered: readonly PlannedArtboard[];
  stoppedBy: 'budget' | 'failures' | 'aborted' | null;
}): CheckFindingData[] => {
  const out: CheckFindingData[] = [];
  const push = (arts: readonly PlannedArtboard[], reason: 'limit' | 'budget' | 'failures'): void => {
    const first = arts[0];
    if (first === undefined) return;
    out.push({
      code: 'render-skipped',
      file: first.file,
      screen: first.screen,
      viewport: null,
      params: { count: arts.length, reason, ...(reason === 'limit' ? { max: CHECK_ARTBOARDS_MAX } : {}) },
      detail: cleanDetail(arts.map(artLabel).join('; '), CHECK_DETAIL_MAX),
    });
  };
  if (input.stoppedBy === 'budget' || input.stoppedBy === 'failures') push(input.notRendered, input.stoppedBy);
  push(input.overLimit, 'limit');
  return out;
};
