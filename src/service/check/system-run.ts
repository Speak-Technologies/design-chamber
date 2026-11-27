// One system check, end to end (documentation/specs/phase-2-5-technical.md §10.2, §10.3, and
// documentation/specs/system-board-layout-and-visual-check.md §B): read the system through the system
// store (every path contained, no link followed), build its detail, take the static findings, and —
// when the caller brings a browser — draw the board at two widths, measure it, save PNG tiles and
// write `<system>/.chamber/check.json`. The route and `--static` stay static. The CLI makes a store of
// its own over the designs root (`cliSystemStore`); the service route uses the composed one.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { cleanDetail, normalizeExternalUrl } from '../../shared/checks.ts';
import {
  CHECK_ARTBOARD_TIMEOUT_MS,
  CHECK_FINDINGS_MAX,
  SYSTEM_CHECK_BOARD_TIMEOUT_MS,
  CHECK_DETAIL_MAX,
  SYSTEM_CHECK_OPTIONAL_TILES_TIME_SHARE,
  SYSTEM_CHECK_PNGS_MAX,
  SYSTEM_CHECK_RENDER_BUDGET_MS,
  SYSTEM_CHECK_SCREENS_BUDGET_MS,
  SYSTEM_CHECK_TILE_PIXELS_MAX,
  SYSTEM_EXAMPLE_MAX,
  SYSTEM_SCREEN_MAX,
  SYSTEM_MOTION_FRAMES,
  SYSTEM_MOTION_SHOTS_MAX,
  SYSTEM_STATE_SHOTS_MAX,
} from '../../shared/limits.ts';
import { findSecretShapes } from '../../shared/secret-shapes.ts';
import { isBoardEntryKey, parseEntryKey } from '../../shared/system-board.ts';
import { buildSystemDetail, effectiveLayout, SYSTEM_AREAS, systemScreenFileOf, type SystemDetailSource } from '../../shared/system-json.ts';
import type { ArtboardCheck, BoardLayout, CheckFindingData, RenderCheckState, SettingsFile, SystemArea, SystemDetail } from '../../shared/types.ts';
import { BundleTooLarge, bundleDocument, createLiveFileSource, RefBlocked, type FileSource } from '../bundle.ts';
import { createChangeHub } from '../changes.ts';
import type { Logger, SettingsStore } from '../context.ts';
import { resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import { createSelfWrites } from '../self-writes.ts';
import { assembleBoardHtml, bundleExamples, overlaySource, readProposalBoardSource } from '../systems/board-assemble.ts';
import { BOARD_ENTRY_FILE } from '../systems/board-html.ts';
import { exampleFileOf, exampleKeyOf, ICON_DRAWN_MAX_BYTES } from '../systems/specimen-html.ts';
import { committedStateOf, readCommitted, readRecord } from '../systems/living-page.ts';
import { readProposalProblem } from '../systems/proposal-record.ts';
import { createSystemStore, repoLabelOf, type SystemStore } from '../systems/store.ts';
import {
  analyzeBoard,
  boardFindings,
  boardPassesOf,
  DARK_PASS_AREAS,
  findingsInArea,
  measuredLowPairs,
  passShare,
  sanitizeBoardProbe,
  motionAreaOf,
  sanitizeMotionProbe,
  sanitizeStateProbe,
  stateFindings,
  stateStyled,
  type BoardProbePair,
  type BoardMotionProbe,
  type BoardStateProbe,
  type MotionResult,
  type StateHint,
  type StateResult,
} from './board-analyze.ts';
import { staticLowPairs } from '../../shared/pair-contrast.ts';
import { pictureCoverage, planBoardPictures, type PictureCoverage } from './board-pictures.ts';
import { browserClassOf, CheckUsageError, openCheckRun } from './engine.ts';
import { checkBrowserArgs, launchOpenOptions, openCdp } from './cdp.ts';
import { ensureChamberDir } from './output.ts';
import { decodePng, PNG_STITCH_PIXELS_MAX, PNG_STITCH_SIDE_MAX, PngStitchError, pictureSize, SIDE_BY_SIDE_GAP, stitchPngs, stitchSideBySide } from './png-stitch.ts';
import { compareBudgetNote, planCompares, sourceDocument, type CompareSource, type CompareTarget } from './system-compare.ts';
import { checkAsset } from '../systems/assets.ts';
import { CHECK_RUN_DEADLINE_MS, renderArtboards, type ElementPath, type ForcedState, type InspectPage, type InspectResult, type LoadedDocument, type PlannedArtboard, type RenderOutcome } from './render.ts';
import { dedupeDarkScreenFindings, planScreenArtboards, screenSkippedFindings, type ScreenPlan } from './system-screens.ts';
import { areaEmpty, contrastFindings, s8Findings, systemCheckReport, systemFindings, type S8Facts, type SystemBoardShot, type SystemCheckRender, type SystemCheckReport, type SystemCompareSheet } from './system-static.ts';

export type SystemCheckRun = {
  report: SystemCheckReport;
  detail: SystemDetail;
  /** Absolute `check.json`, or null when nothing was written (the static path). */
  reportPath: string | null;
  /** Absolute PNG paths of this run, in width and area order. */
  pngs: string[];
};

/** What the visual check needs from the caller; absent → the static path (the route, `--static`). */
export type SystemRenderInput = {
  /** null = no browser found. */
  browserPath: string | null;
  probeSource: string;
  platform: NodeJS.Platform;
  isRoot: boolean;
  signal?: AbortSignal;
  tmpdir?: string;
  /**
   * Time limits; the defaults are SYSTEM_CHECK_BOARD_TIMEOUT_MS (one board pass), SYSTEM_CHECK_RENDER_BUDGET_MS
   * (the whole render), SYSTEM_CHECK_SCREENS_BUDGET_MS (the screens' share of it) and CHECK_ARTBOARD_TIMEOUT_MS
   * (one screen artboard). Tests shorten them.
   */
  budgets?: { boardMs?: number; runMs?: number; screensMs?: number; screenMs?: number };
  /** Test seam: replaces the render loop (so a test can see what the run hands it), as `RunCheckInput.render`. */
  renderLoop?: typeof renderArtboards;
  /** `--area`: picture and measure one area only (the board is still drawn whole). Absent or null: every area. */
  area?: SystemArea | null;
  /** `--scheme`: which passes to draw. Absent or null: both when the system has a dark value, else light. */
  scheme?: 'light' | 'dark' | 'both' | null;
  /**
   * `--screen` (system-builder-depth T12b): draw only these system screens and skip the board. Each must be
   * listed in `screens`; not with `area`. Absent, null or empty: the board, then every screen.
   */
  screens?: readonly string[] | null;
};

/** `--screen` and `--area` together (the CLI and the tool refuse it first; this guards every caller). */
export const SCREEN_WITH_AREA_SENTENCE = "--screen can't be combined with --area: --screen checks only those screens and skips the board.";
/** A `--screen` id the system doesn't list. */
export const unknownSystemScreenSentence = (id: string): string => `There is no screen "${cleanDetail(id, 40)}" in this design system. Its system.json lists the screens.`;

const NO_OUTCOME: RenderOutcome = Object.freeze({ artboards: [], findings: [], notRendered: 0, stoppedBy: null, unavailable: false });

/**
 * One system screen as the check draws it: read through the source (contained, no link out), within the
 * character cap, bundled in export mode (no bridge placeholder), as the design check bundles a screen.
 */
export const loadSystemScreen = async (source: FileSource, rel: string): Promise<LoadedDocument> => {
  const file = await source.read(rel).catch((error: unknown) => {
    if (error instanceof RefBlocked) return null;
    throw error;
  });
  if (file === null) return { ok: false, reason: 'missing' };
  const text = file.bytes.toString('utf8');
  // Over the cap since the detail was read: not drawn (the next run names it as too long).
  if (text.length > SYSTEM_SCREEN_MAX) return { ok: false, reason: 'missing' };
  try {
    return { ok: true, html: (await bundleDocument(overlaySource(source, text, rel), rel, { mode: 'export' })).html };
  } catch (error) {
    if (error instanceof BundleTooLarge) return { ok: false, reason: 'too-large' };
    throw error;
  }
};

const SYSTEM_OWNER = "This design system's" as const;
const BROWSER_START_MS = 20_000;
const BOARD_FILE = 'board.html';
/** The dark pass's document (the board assembled in the dark scheme); its findings still name `board.html`. */
const DARK_BOARD_FILE = 'board-dark.html';

/**
 * What S8 needs from outside the system's files (§10.4): the COMMITTED living page in the repo, read
 * here (contained under the repo's realpath, never a link, bounded, never rendered), and the staged
 * record. The repo is only read. The same read serves the CLI and the route, with no service cache.
 */
export const readS8Facts = async (store: Pick<SystemStore, 'dir'>, id: string, source: Pick<SystemDetailSource, 'state'>): Promise<S8Facts> => {
  const home = source.state.home;
  // PROPOSAL.json is read here through the parser, and the service's record adds the step 3 problems (§5.14).
  const systemDir = await store.dir(id);
  const proposal = await readProposalProblem(systemDir);
  if (home?.kind !== 'repo') return { living: null, proposal };
  const record = await readRecord(systemDir);
  const staged = record === null ? null : { problem: record.problem, secrets: record.secrets };
  const read = await readCommitted(home.directory, home.livingPage, repoLabelOf(home.directory));
  if (read.kind === 'repo-unreadable') return { living: { committed: null, secrets: [], staged }, proposal };
  if (read.kind === 'view') return { living: { committed: read.view, secrets: [], staged }, proposal };
  const committed = committedStateOf(read.text, { id, name: source.state.name, revision: source.state.revision.n });
  return { living: { committed, secrets: findSecretShapes(read.text).map((hit) => ({ kind: hit.kind })), staged }, proposal };
};

/** The entry's effective layout, from the detail the board was drawn from (logos keep their cards). */
const layoutOfEntry = (detail: SystemDetail, entry: string): BoardLayout => {
  const key = parseEntryKey(entry);
  if (key === null) return 'card';
  switch (key.kind) {
    case 'component': {
      const component = detail.components.find((candidate) => candidate.id === key.key);
      return component === undefined ? 'card' : effectiveLayout(detail, 'components', component.layout);
    }
    case 'note': {
      const note = detail.notes.find((candidate) => candidate.id === key.key);
      return note === undefined ? 'card' : effectiveLayout(detail, 'overview', note.layout);
    }
    case 'pattern': {
      const pattern = detail.patterns.find((candidate) => candidate.id === key.key);
      return pattern === undefined ? 'card' : effectiveLayout(detail, 'patterns', pattern.layout);
    }
    case 'brand': {
      const brand = detail.brand.find((candidate) => candidate.id === key.key);
      return brand === undefined ? 'card' : effectiveLayout(detail, 'brand', brand.layout);
    }
    case 'token': {
      const token = detail.tokens.find((candidate) => candidate.name === key.key);
      if (token === undefined) return 'card';
      return effectiveLayout(detail, token.section === 'other' ? 'sizes' : token.section, null);
    }
    default:
      // overview, type styles, fonts and logos: fixed presentation, no hint applies.
      return 'card';
  }
};

/** A component example is read up to 4 bytes per character of its cap, as the store reads text. */
const EXAMPLE_READ_MAX_BYTES = SYSTEM_EXAMPLE_MAX * 4;

/**
 * Each component example's text by its file, for the label scan (system-builder-depth §4.5). Read
 * through the live file source (`resolveInside`: no escape, no link out); a file over the example cap,
 * missing or refused is left out, so its labels are simply not judged.
 */
export const readExampleTexts = async (source: FileSource, detail: SystemDetail): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const component of detail.components) {
    if (component.example === null) continue;
    const rel = `components/${component.id}.html`;
    try {
      const info = (await source.stat?.(rel)) ?? null;
      if (info === null || info.size > EXAMPLE_READ_MAX_BYTES) continue;
      const file = await source.read(rel);
      if (file !== null && file.bytes.length <= EXAMPLE_READ_MAX_BYTES) out[rel] = file.bytes.toString('utf8');
    } catch (error) {
      // A refused path (a link out of the system) is not read; anything else is a real failure.
      if (!(error instanceof RefBlocked)) throw error;
    }
  }
  return out;
};

/**
 * Each listed icon's text by its file, for the mixed-set scan (system-builder-depth §4.6). Read like the
 * examples, through the live file source; a file too large to be drawn, missing or refused is left out.
 */
export const readIconTexts = async (source: FileSource, detail: SystemDetail): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const { file: rel } of detail.icons) {
    try {
      const info = (await source.stat?.(rel)) ?? null;
      if (info === null || info.size > ICON_DRAWN_MAX_BYTES) continue;
      const file = await source.read(rel);
      if (file !== null && file.bytes.length <= ICON_DRAWN_MAX_BYTES) out[rel] = file.bytes.toString('utf8');
    } catch (error) {
      if (!(error instanceof RefBlocked)) throw error;
    }
  }
  return out;
};

/** Room around a state picture's element, so a focus ring or a shadow drawn outside its box is in the picture. */
const STATE_SHOT_MARGIN = 16;
/** A state picture is at most this tall: it shows one control, not a whole example. */
const STATE_SHOT_HEIGHT_MAX = 600;
/** A forced state as its picture's caption names it. */
const STATE_CAPTIONS: Readonly<Record<ForcedState, string>> = { hover: 'Hover', focus: 'Focus', 'focus-visible': 'Focus visible', active: 'Active' };
/** The share of a board pass the state pictures may run to; past it the rest are left out with a note. */
const STATE_PASS_TIME_SHARE = 0.85;

/**
 * The forced state pass (system-builder-depth T16), on the wide light board after its tiles: for each
 * labelled state the probe found, the element's computed style with the state off, the state forced over
 * CDP, the style again and a tight picture (`<component>-<state>@wide.png`), then the state cleared
 * before the next one. A state that changes nothing is `system-state-unstyled`; a list cut at
 * `SYSTEM_STATE_SHOTS_MAX` or by the deadline is one `system-board-partial` note. An element that has gone
 * since the probe read it is skipped.
 */
export const pictureStates = async (
  page: Pick<InspectPage, 'computedStyle' | 'forceState' | 'scrollTo' | 'capture' | 'save'>,
  probe: BoardStateProbe,
  input: { viewportWidth: number; deadline: number; clock?: () => number },
): Promise<{ results: StateResult[]; pngs: string[]; findings: CheckFindingData[] }> => {
  const clock = input.clock ?? Date.now;
  const results: StateResult[] = [];
  const pngs: string[] = [];
  let cut = probe.truncated;
  for (const target of probe.states) {
    if (clock() >= input.deadline) {
      cut = true;
      break;
    }
    const id = parseEntryKey(target.entry)?.key ?? 'component';
    const element: ElementPath = [
      { selector: '[data-dc-example-host]', index: target.host },
      { selector: '*', index: target.element },
    ];
    const before = await page.computedStyle(element);
    if (before === null) continue;
    // The element at rest first, the same clip as the forced picture, so the two sit side by side.
    const { box } = target;
    const x = Math.min(Math.max(0, Math.floor(box.x - STATE_SHOT_MARGIN)), input.viewportWidth - 1);
    const width = Math.max(1, Math.min(input.viewportWidth, Math.ceil(box.x + box.w + STATE_SHOT_MARGIN)) - x);
    const y = Math.max(0, Math.floor(box.y - STATE_SHOT_MARGIN));
    const height = Math.max(1, Math.min(STATE_SHOT_HEIGHT_MAX, Math.ceil(box.h + STATE_SHOT_MARGIN * 2)));
    await page.scrollTo(y);
    const rest = await page.capture({ x, y, width, height });
    if (!(await page.forceState(element, [target.state]))) continue;
    let after: Record<string, string> | null = null;
    let png: string | null = null;
    try {
      after = await page.computedStyle(element);
      const forced = await page.capture({ x, y, width, height });
      let picture: Buffer;
      try {
        picture = stitchSideBySide([rest, forced], { captions: [target.twin ? 'Rest' : 'Not forced', STATE_CAPTIONS[target.state]] });
      } catch (error) {
        // A picture that can't be stitched is kept on its own.
        if (!(error instanceof PngStitchError)) throw error;
        picture = forced;
      }
      png = await page.save([id, target.variant, target.state].filter((part) => part !== '').join('-'), 1, 1, picture);
    } finally {
      // Cleared before the next element, whatever happened to this one.
      await page.forceState(element, []);
    }
    if (after === null) continue;
    const styled = stateStyled(before, after);
    // An unstyled state's likely cause: focus whose CSS styles :focus-visible instead (forced once more to tell),
    // else a state forced on the labelled copy itself, there being no resting copy beside it.
    let hint: StateHint | undefined;
    if (!styled && target.state === 'focus' && (await page.forceState(element, ['focus-visible']))) {
      try {
        const visible = await page.computedStyle(element);
        if (visible !== null && stateStyled(before, visible)) hint = 'focus-visible';
      } finally {
        await page.forceState(element, []);
      }
    }
    if (!styled && hint === undefined && !target.twin) hint = 'rest';
    results.push({ entry: target.entry, state: target.state, png, styled, ...(target.variant !== '' ? { variant: target.variant } : {}), ...(hint !== undefined ? { hint } : {}) });
    if (png !== null) pngs.push(png);
  }
  const findings = stateFindings(results, 'wide');
  if (cut) findings.push({ code: 'system-board-partial', file: BOARD_FILE, screen: null, viewport: 'wide', params: { pictured: 'states', count: results.length, max: SYSTEM_STATE_SHOTS_MAX } });
  return { results, pngs, findings };
};

/** The entry kinds the motion probe reads for `--area` (examples first, then the `token` demo chips; null: all). */
export const motionKindsOf = (area: SystemArea | null): string[] => {
  const all: Record<SystemArea, string> = { components: 'component', patterns: 'pattern', brand: 'brand', foundations: 'token' };
  return area === null ? ['component', 'pattern', 'brand', 'token'] : [all[area]];
};

/** Room around a motion element, so an element that lifts or grows, and its shadow, stay in the frame. */
const MOTION_SHOT_MARGIN = 40;

/**
 * The motion pass (system-builder-depth T17), on the wide light board after the state pictures: for each
 * demo chip and `data-dc-motion` element the probe found (only `area`'s when one is given), its trigger
 * forced with every animation paused and `SYSTEM_MOTION_FRAMES` frames from start to end, then the end
 * once more with reduced motion, stitched left to right into `<entry>-motion@wide.png`. Nothing started
 * is one frame. A list cut at `SYSTEM_MOTION_SHOTS_MAX` or by the deadline is one `system-board-partial`
 * note; a strip that can't be stitched, or an element gone since the probe, is skipped.
 */
export const pictureMotion = async (
  page: Pick<InspectPage, 'animationFrames' | 'scrollTo' | 'save'>,
  probe: BoardMotionProbe,
  input: { viewportWidth: number; deadline: number; area: SystemArea | null; clock?: () => number },
): Promise<{ results: MotionResult[]; pngs: string[]; findings: CheckFindingData[] }> => {
  const clock = input.clock ?? Date.now;
  const results: MotionResult[] = [];
  let cut = probe.truncated;
  for (const target of probe.items) {
    if (input.area !== null && motionAreaOf(target.entry) !== input.area) continue;
    if (clock() >= input.deadline) {
      cut = true;
      break;
    }
    const element: ElementPath =
      target.kind === 'demo' || target.host === null
        ? [{ selector: '.dc-motion-demo', index: target.element }]
        : [
            { selector: '[data-dc-example-host]', index: target.host },
            { selector: '*', index: target.element },
          ];
    const { box } = target;
    const x = Math.min(Math.max(0, Math.floor(box.x - MOTION_SHOT_MARGIN)), input.viewportWidth - 1);
    const width = Math.max(1, Math.min(input.viewportWidth, Math.ceil(box.x + box.w + MOTION_SHOT_MARGIN)) - x);
    const y = Math.max(0, Math.floor(box.y - MOTION_SHOT_MARGIN));
    const height = Math.max(1, Math.min(STATE_SHOT_HEIGHT_MAX, Math.ceil(box.h + MOTION_SHOT_MARGIN * 2)));
    await page.scrollTo(y);
    const shot = await page.animationFrames(element, target.trigger, { x, y, width, height }, SYSTEM_MOTION_FRAMES);
    if (shot === null) continue;
    let strip: Buffer;
    try {
      // Each frame captioned with its time (similar speeds read apart), or "No motion"; last the reduced end.
      const captions = shot.moved ? shot.times.map((ms) => `${ms} ms`) : ['No motion'];
      strip = stitchSideBySide([...shot.frames, shot.reduced], { captions: [...captions, 'Reduced motion'] });
    } catch (error) {
      if (!(error instanceof PngStitchError)) throw error;
      continue;
    }
    const label = `${parseEntryKey(target.entry)?.key ?? 'entry'}-motion`;
    const png = await page.save(label, 1, 1, strip);
    const ms = shot.moved ? shot.times.at(-1) : undefined;
    results.push({ entry: target.entry, trigger: target.trigger, png, frames: shot.frames.length, moved: shot.moved, reducedMoves: shot.reducedMoves, ...(ms !== undefined ? { ms } : {}) });
  }
  const findings: CheckFindingData[] = cut ? [{ code: 'system-board-partial', file: BOARD_FILE, screen: null, viewport: 'wide', params: { pictured: 'motion', count: results.length, max: SYSTEM_MOTION_SHOTS_MAX } }] : [];
  return { results, pngs: results.map((result) => result.png), findings };
};

/**
 * The real-app pictures of the screens the plan draws (T18), read through the draw source (contained, no
 * link followed): a file whose bytes aren't the PNG or JPEG its name says, or whose header can't be read,
 * is unreadable; one gone since the detail was read is left out (the next run names it missing).
 */
export const readCompareSources = async (source: FileSource, detail: Pick<SystemDetail, 'screens'>, plan: readonly PlannedArtboard[]): Promise<CompareSource[]> => {
  const out: CompareSource[] = [];
  for (const screen of detail.screens) {
    if (screen.source === null || !plan.some((art) => art.screen === screen.id)) continue;
    const file = await source.read(screen.source).catch((error: unknown) => {
      if (error instanceof RefBlocked) return null;
      throw error;
    });
    if (file === null) continue;
    const size = checkAsset(screen.source, 'source', file.bytes).ok ? pictureSize(file.bytes) : null;
    out.push(size === null ? { screen: screen.id, source: screen.source, ok: false } : { screen: screen.id, source: screen.source, ok: true, ...size, bytes: file.bytes });
  }
  return out;
};

/** The two sides of a compare sheet, named in the picture. */
export const COMPARE_CAPTIONS: readonly string[] = Object.freeze(['Design', 'Your app']);

/**
 * The rows each screen slice repeats from the one above, to drop before stacking them. A design check
 * scrolls slice i to (i - 1) × the viewport's height, but the browser stops at the page's bottom, so the
 * last slice of a page that isn't a whole number of screens tall starts higher and shows part of the slice
 * before it again. Only that last one overlaps.
 */
export const sliceOverlaps = (slices: number, viewportHeight: number, docHeight: number): number[] => {
  const out = Array.from({ length: slices }, () => 0);
  if (slices < 2) return out;
  const wanted = (slices - 1) * viewportHeight;
  const actual = Math.min(wanted, Math.max(0, docHeight - viewportHeight));
  out[slices - 1] = Math.max(0, wanted - actual);
  return out;
};

/** A compare transcode's document name: the source's own path (one artboard per picture). */
export const compareFileOf = (target: Pick<CompareTarget, 'source'>): string => target.source.source;

/** The bands a source picture is read back in, px (a full-size board tile's height). */
const COMPARE_BAND = 900;
/** Below this much time left the browser isn't started again for the pictures Node can't read. */
const COMPARE_TRANSCODE_MIN_MS = 3000;

/**
 * The compare sheets (T18): for each target whose light screen artboard was drawn, the screen's slices
 * stacked, then the source at its own size beside it (`stitchSideBySide`), saved as
 * `compare-<id>@<viewport>.png`. A source Node can't decode (a JPEG, a palette PNG) is drawn by the
 * browser once (`transcode`, the inspect path: the picture alone, read back as PNG bands). Past `deadline`
 * the rest are one note; a picture that can't be stitched is the unreadable note.
 */
export const makeCompareSheets = async (input: {
  targets: readonly CompareTarget[];
  artboards: readonly ArtboardCheck[];
  slices: ReadonlyMap<string, readonly Buffer[]>;
  budgetMs: number;
  savePng: (art: PlannedArtboard, slice: number, slices: number, bytes: Buffer, label?: string) => Promise<string>;
  transcode: (plan: PlannedArtboard[], inspect: (page: InspectPage, art: PlannedArtboard) => Promise<InspectResult | null>, budgetMs: number) => Promise<RenderOutcome>;
  clock?: () => number;
}): Promise<{ sheets: SystemCompareSheet[]; findings: CheckFindingData[] }> => {
  const clock = input.clock ?? Date.now;
  const deadline = clock() + input.budgetMs;
  const sheets: SystemCompareSheet[] = [];
  const findings: CheckFindingData[] = [];
  const unreadable = new Set<string>();
  const noteUnreadable = (target: CompareTarget): void => {
    if (unreadable.has(target.screen)) return;
    unreadable.add(target.screen);
    findings.push({ code: 'system-compare-skipped', file: systemScreenFileOf(target.screen), screen: target.screen, viewport: null, detail: cleanDetail(`${target.screen}: ${target.source.source}`, CHECK_DETAIL_MAX) });
  };
  // Only artboards drawn whole: the screen's own findings say why one wasn't.
  const ready = input.targets.flatMap((target) => {
    const artboard = input.artboards.find((candidate) => candidate.ok && candidate.screen === target.screen && candidate.viewport === target.viewport.id);
    const slices = input.slices.get(`${target.screen}|${target.viewport.id}`) ?? [];
    return artboard !== undefined && slices.length > 0 && slices.length === artboard.pngs.length ? [{ target, slices, width: artboard.width, skipTop: sliceOverlaps(slices.length, artboard.height, artboard.docHeight) }] : [];
  });
  const sheetHeightOf = (width: number, sourceWidth: number): number => Math.min(PNG_STITCH_SIDE_MAX, Math.floor(PNG_STITCH_PIXELS_MAX / (width + SIDE_BY_SIDE_GAP + sourceWidth)));

  // Each source as a PNG Node reads: its own bytes when they decode, else the browser's picture of it.
  const sourcePngs = new Map<string, Buffer>();
  const toDraw = new Map<string, { target: CompareTarget; height: number }>();
  for (const { target, width } of ready) {
    const known = target.source.source;
    if (sourcePngs.has(known) || toDraw.has(known)) continue;
    let readable = false;
    if (target.source.type === 'png') {
      try {
        decodePng(target.source.bytes);
        readable = true;
      } catch (error) {
        if (!(error instanceof PngStitchError)) throw error;
      }
    }
    if (readable) sourcePngs.set(known, target.source.bytes);
    else toDraw.set(known, { target, height: Math.min(target.source.height, sheetHeightOf(width, target.source.width)) });
  }
  const notDrawn = new Set<string>();
  if (toDraw.size > 0) {
    const left = deadline - clock();
    if (left < COMPARE_TRANSCODE_MIN_MS) {
      for (const known of toDraw.keys()) notDrawn.add(known);
    } else {
      const plan: PlannedArtboard[] = [...toDraw.values()].map(({ target, height }) => ({
        file: compareFileOf(target),
        screen: target.screen,
        viewport: { id: target.viewport.id, label: target.viewport.label, width: target.source.width, height: Math.min(height, COMPARE_BAND) },
      }));
      const drawn = await input.transcode(
        plan,
        async (page, art) => {
          const wanted = toDraw.get(art.file);
          if (wanted === undefined) return null;
          const bands: Buffer[] = [];
          for (let y = 0; y < wanted.height; y += COMPARE_BAND) {
            await page.scrollTo(y);
            bands.push(await page.capture({ y, height: Math.min(COMPARE_BAND, wanted.height - y) }));
          }
          sourcePngs.set(art.file, bands.length === 1 && bands[0] !== undefined ? bands[0] : stitchPngs(bands));
          return { findings: [], docHeight: wanted.height, pngs: [] };
        },
        left,
      );
      // Not reached for want of time: the budget note; drawn and failed: unreadable.
      for (const art of plan.slice(plan.length - drawn.notRendered)) notDrawn.add(art.file);
    }
  }

  const late: CompareTarget[] = [];
  for (const { target, slices, skipTop } of ready) {
    const known = target.source.source;
    if (notDrawn.has(known) || clock() >= deadline) {
      late.push(target);
      continue;
    }
    const sourcePng = sourcePngs.get(known);
    if (sourcePng === undefined) {
      noteUnreadable(target);
      continue;
    }
    let sheet: Buffer;
    try {
      const screenPng = slices.length === 1 && slices[0] !== undefined ? slices[0] : stitchPngs(slices, { skipTop });
      sheet = stitchSideBySide([screenPng, sourcePng], { captions: COMPARE_CAPTIONS });
    } catch (error) {
      if (!(error instanceof PngStitchError)) throw error;
      noteUnreadable(target);
      continue;
    }
    const art: PlannedArtboard = { file: systemScreenFileOf(target.screen), screen: target.screen, viewport: target.viewport };
    sheets.push({ screen: target.screen, viewport: target.viewport.id, source: known, png: await input.savePng(art, 1, 1, sheet, `compare-${target.screen}`) });
  }
  findings.push(...compareBudgetNote(late));
  return { sheets, findings };
};

const fileOfEntry = (entry: string): string => {
  const key = parseEntryKey(entry);
  return key !== null && key.kind === 'component' ? `components/${key.key}.html` : BOARD_FILE;
};

/**
 * The findings of one system, from what the store reads now; with `render`, the board is drawn at the
 * two check widths, measured and pictured, and the report gains its render part. The static path
 * writes nothing; the render path writes the report last, atomically, and keeps only its own PNGs.
 */
export const runSystemCheck = async (
  store: Pick<SystemStore, 'get' | 'dir' | 'filesDir' | 'readState'>,
  id: string,
  input: { now: Date; tool: SystemCheckReport['tool']; render?: SystemRenderInput },
): Promise<SystemCheckRun> => {
  // As the design check: the whole run (static pass, assembly, launches, both widths) ends before the tool's kill; the clock starts here.
  const deadlineAt = Date.now() + CHECK_RUN_DEADLINE_MS;
  const source = await store.get(id);
  const detail = buildSystemDetail(source);
  const facts = await readS8Facts(store, id, source);
  const liveSource = createLiveFileSource(await store.filesDir(id));
  const examples = await readExampleTexts(liveSource, detail);
  // Each example bundled on its own, so its remote refs are known to the file checks too (KI-39); the reader leaves them empty.
  const bundled = await bundleExamples(detail, liveSource);
  // The motion check reads each example with its stylesheets inlined, by its file.
  const bundledByFile: Record<string, string> = {};
  for (const [kind, entries] of [['component', detail.components], ['pattern', detail.patterns], ['brand', detail.brand]] as const) {
    for (const entry of entries) {
      const html = bundled.examples[exampleKeyOf(kind, entry.id)];
      if (html !== undefined) bundledByFile[exampleFileOf(kind, entry.id)] = html;
    }
  }
  const icons = await readIconTexts(liveSource, detail);
  const staticFindings = [...systemFindings({ ...source, examples, bundled: bundledByFile, icons }, { ...detail, components: bundled.components, patterns: bundled.patterns, brand: bundled.brand }), ...s8Findings(source, detail, facts)].slice(0, CHECK_FINDINGS_MAX);
  const base = { id, findings: staticFindings, now: input.now, tool: input.tool };
  const staticRun: SystemCheckRun = { report: systemCheckReport(base), detail, reportPath: null, pngs: [] };
  const renderInput = input.render;
  if (renderInput === undefined) return staticRun;

  const systemDir = await store.dir(id);

  // D10: a repo-backed system with a waiting proposal is drawn from the proposal; else the live files.
  const proposal = detail.home.kind === 'repo' ? await readProposalBoardSource(store, id) : null;
  const drawDetail = proposal === null ? detail : proposal.detail;
  const drawSource: FileSource = proposal === null ? createLiveFileSource(await store.filesDir(id)) : proposal.source;
  const drawn: SystemCheckRender['drawn'] = proposal === null ? { from: 'system', proposal: null } : { from: 'proposal', proposal: proposal.proposalId };

  // --screen (T12b): known ids only, never with --area; refused before anything is drawn or written.
  const onlyScreens = renderInput.screens === undefined || renderInput.screens === null || renderInput.screens.length === 0 ? null : [...new Set(renderInput.screens)];
  if (onlyScreens !== null) {
    if ((renderInput.area ?? null) !== null) throw new CheckUsageError(SCREEN_WITH_AREA_SENTENCE);
    for (const screenId of onlyScreens) if (!drawDetail.screens.some((screen) => screen.id === screenId)) throw new CheckUsageError(unknownSystemScreenSentence(screenId));
  }

  const writeStaticRender = async (render: SystemCheckRender): Promise<SystemCheckRun> => {
    await ensureChamberDir(systemDir, SYSTEM_OWNER);
    const report = systemCheckReport({ ...base, render });
    const reportPath = await writeSystemCheckReport(systemDir, report);
    return { report, detail, reportPath, pngs: [] };
  };

  if (renderInput.browserPath === null) {
    return writeStaticRender({
      state: 'unavailable',
      browser: null,
      drawn,
      widths: [],
      shots: [],
      entryShots: [],
      findings: [{ code: 'browser-missing', file: null, screen: null, viewport: null }],
    });
  }
  const browserPath = renderInput.browserPath;

  // The passes (D8): both light widths, then the dark pass when the system has a dark value and --scheme allows it.
  const passes = boardPassesOf(renderInput.scheme ?? null, drawDetail.tokens.some((token) => token.dark !== null));
  const onlyArea = renderInput.area ?? null;
  // The schemes drawn, for the board and the screens alike (light, dark, or both when the system has dark values).
  const schemes = [...new Set(passes.map((pass) => pass.scheme))];
  // --screen skips the board; --area pictures one board area and draws no screens.
  const boardRuns = onlyScreens === null;
  const screenPlan: ScreenPlan = onlyArea === null ? planScreenArtboards(drawDetail, { only: onlyScreens, schemes }) : { plan: [], overLimit: [], viewports: [] };
  const screensDrawn = screenPlan.plan.length > 0 || screenPlan.overLimit.length > 0;

  // The board documents, bundled like the design check's (export mode, no bridge placeholder): one per scheme drawn.
  const documents = new Map<string, string>();
  const remote: string[] = [];
  try {
    for (const scheme of boardRuns ? schemes : []) {
      // Every section laid out now (eager), so the areas measure their real height and every tile paints.
      const assembled = await assembleBoardHtml(drawDetail, drawSource, scheme, { eager: true });
      remote.push(...[...assembled.components, ...assembled.patterns, ...assembled.brand].flatMap((entry) => entry.example?.remote ?? []));
      documents.set(scheme === 'dark' ? DARK_BOARD_FILE : BOARD_FILE, (await bundleDocument(overlaySource(drawSource, assembled.html), BOARD_ENTRY_FILE, { mode: 'export' })).html);
    }
  } catch (error) {
    if (error instanceof BundleTooLarge) {
      return writeStaticRender({
        state: 'failed',
        browser: browserClassOf(browserPath),
        drawn,
        widths: [],
        shots: [],
        entryShots: [],
        findings: [{ code: 'render-failed', file: BOARD_FILE, screen: null, viewport: null, detail: 'over 60 MB' }],
      });
    }
    throw error;
  }

  // Every example's remote refs are already reported statically; a blocked request for one is not reported twice.
  const knownExternal = new Set(remote.map((url) => normalizeExternalUrl(url) ?? url));
  // The pair cells each pass measured (system-builder-depth §4.5); judged in Node once the passes are done.
  const pairCells: BoardProbePair[] = [];

  const shots: SystemCheckRender['shots'] = [];
  const entryShots: SystemCheckRender['entryShots'] = [];
  // What the pictures leave out, by kind (pictureCoverage): each area at each width counts once, in one note per kind.
  // Kept per width, so a width that fails after its inspect ran (a timeout) adds no notes about pictures it doesn't keep.
  const short: { width: string; kind: Exclude<PictureCoverage['kind'], 'whole'>; text: string }[] = [];
  const boardMs = renderInput.budgets?.boardMs ?? SYSTEM_CHECK_BOARD_TIMEOUT_MS;
  // The forced state pictures (T16), from the wide light pass.
  const stateResults: StateResult[] = [];
  let statePassRan = false;
  // The motion strips (T17), from the same pass.
  const motionResults: MotionResult[] = [];
  let motionPassRan = false;
  const inspect = async (page: InspectPage, art: PlannedArtboard): Promise<InspectResult | null> => {
    const started = Date.now();
    const raw = await page.evaluate(`${renderInput.probeSource};__dcProbe.collectBoard()`, { awaitPromise: false });
    const probe = sanitizeBoardProbe(raw);
    if (probe === null) return null;
    const width = passes.find((candidate) => candidate.id === art.viewport.id);
    if (width === undefined) return null;
    const measuredAll = analyzeBoard(probe, { width, widest: width.id === 'wide', layoutOf: (entry) => layoutOfEntry(drawDetail, entry), fileOf: fileOfEntry });
    // --area: the board is drawn whole (the same layout), but only that area's entries are named and pictured.
    const findings = onlyArea === null ? measuredAll : findingsInArea(measuredAll, probe, onlyArea);
    if (onlyArea === null || onlyArea === 'foundations') pairCells.push(...(probe.pairs ?? []));

    // Entries with a finding at this width, with their boxes: their bands are pictured first.
    const flaggedKeys = new Set(findings.map((finding) => finding.detail).filter((key): key is string => key !== undefined && isBoardEntryKey(key)));
    const flagged = probe.items.filter((item) => flaggedKeys.has(item.entry)).map((item) => ({ entry: item.entry, top: item.box.y, bottom: item.box.y + item.box.h }));
    const shown = SYSTEM_AREAS.filter((area) => drawDetail.coverage.includes(area) || !areaEmpty(drawDetail, area))
      .filter((area) => (onlyArea === null || area === onlyArea) && (width.scheme === 'light' || DARK_PASS_AREAS.includes(area)))
      .flatMap((area) => {
      const measured = probe.areas.find((candidate) => candidate.area === area);
      return measured === undefined ? [] : [{ area, top: measured.top, height: measured.height }];
    });
    const plans = planBoardPictures({
      areas: shown,
      flagged,
      viewportWidth: width.width,
      tileHeight: width.height,
      // The budgets split by pass: half each for two widths, 0.4 / 0.3 / 0.3 with the dark pass.
      tilePixels: Math.floor(SYSTEM_CHECK_TILE_PIXELS_MAX * passShare(passes, width)),
      pngs: Math.floor(SYSTEM_CHECK_PNGS_MAX * passShare(passes, width)),
    });

    // Past this point only overview strips and finding tiles are still taken, so the width finishes in time.
    const softDeadline = started + boardMs * SYSTEM_CHECK_OPTIONAL_TILES_TIME_SHARE;
    const pngs: string[] = [];
    const tilesTaken: { png: string; top: number; bottom: number }[] = [];
    for (const plan of plans) {
      const strips: Buffer[] = [];
      const tiles: SystemBoardShot['tiles'] = [];
      const areaPngs: string[] = [];
      for (const band of plan.bands) {
        const tile = band.tile && (band.priority || Date.now() < softDeadline);
        if (band.strip < 1 && !tile) continue;
        await page.scrollTo(band.y);
        if (band.strip >= 1) strips.push(await page.capture({ y: band.y, height: band.strip, scale: plan.scale }));
        if (tile) {
          const rel = await page.save(plan.area, band.index, plan.bands.length, await page.capture({ y: band.y, height: band.height }));
          tiles.push({ png: rel, y: band.y - plan.top, height: band.height });
          tilesTaken.push({ png: rel, top: band.y, bottom: band.y + band.height });
          areaPngs.push(rel);
        }
      }
      let overview: SystemBoardShot['overview'] = null;
      if (strips.length > 0) {
        try {
          const rel = await page.save(`${plan.area}-overview`, 1, 1, stitchPngs(strips));
          overview = { png: rel, scale: plan.scale, coversPx: plan.coversPx };
          areaPngs.unshift(rel);
        } catch (error) {
          // A strip Chrome drew that can't be stacked leaves this area with its tiles only; anything else is a real failure.
          if (!(error instanceof PngStitchError)) throw error;
        }
      }
      pngs.push(...areaPngs);
      const label = `${plan.area} at ${width.width}px${width.scheme === 'dark' ? ' (dark)' : ''}`;
      const shot: SystemBoardShot = { width: width.id, area: plan.area, heightPx: plan.height, overview, tiles };
      const coverage = pictureCoverage(shot);
      const note = (kind: (typeof short)[number]['kind'], text: string): void => void short.push({ width: width.id, kind, text });
      if (coverage.kind === 'gap') note('gap', `${label}, ${coverage.gaps.map(([from, to]) => `${from} to ${to}px`).join(' and ')}`);
      else if (coverage.kind === 'overview') note('overview', `${label}, overview to ${plan.coversPx}px`);
      else if (coverage.kind === 'tiles') note('tiles', `${label}, ${tiles.length} of ${plan.bands.length} full-size tiles`);
      else if (coverage.kind === 'no-overview') note('no-overview', label);
      shots.push(shot);
    }
    for (const box of flagged) {
      const showing = tilesTaken.filter((tile) => tile.top < box.bottom && tile.bottom > box.top).map((tile) => tile.png);
      if (showing.length > 0) entryShots.push({ width: width.id, entry: box.entry, pngs: showing });
    }
    // T16: the labelled states, forced and pictured on the wide light board only (the dark pass and the narrow width don't repeat it).
    if (width.id === 'wide' && (onlyArea === null || onlyArea === 'components')) {
      statePassRan = true;
      const targets = sanitizeStateProbe(await page.evaluate(`${renderInput.probeSource};__dcProbe.collectStates(${SYSTEM_STATE_SHOTS_MAX})`, { awaitPromise: false }), SYSTEM_STATE_SHOTS_MAX);
      const pass = await pictureStates(page, targets, { viewportWidth: width.width, deadline: started + boardMs * STATE_PASS_TIME_SHARE });
      stateResults.push(...pass.results);
      findings.push(...pass.findings);
      pngs.push(...pass.pngs);
    }
    // T17: motion strips, last on the wide light board, so a pass short of time drops them first.
    if (width.id === 'wide') {
      motionPassRan = true;
      // Example elements claim the cap first, then the demo chips; only the kinds --area keeps are collected.
      const targets = sanitizeMotionProbe(await page.evaluate(`${renderInput.probeSource};__dcProbe.collectMotion(${SYSTEM_MOTION_SHOTS_MAX}, ${JSON.stringify(motionKindsOf(onlyArea))})`, { awaitPromise: false }), SYSTEM_MOTION_SHOTS_MAX);
      const pass = await pictureMotion(page, targets, { viewportWidth: width.width, deadline: started + boardMs * STATE_PASS_TIME_SHARE, area: onlyArea });
      motionResults.push(...pass.results);
      findings.push(...pass.findings);
      pngs.push(...pass.pngs);
    }
    return { findings, docHeight: probe.scrollHeight, pngs };
  };

  const space = await openCheckRun(systemDir, {
    now: () => input.now,
    platform: renderInput.platform,
    ...(renderInput.tmpdir !== undefined ? { tmpdir: renderInput.tmpdir } : {}),
    withRunDir: true,
    owner: SYSTEM_OWNER,
  });
  try {
    const loop = renderInput.renderLoop ?? renderArtboards;
    // The launch options carry the abort signal and, for a restart, only what is left of the run.
    const openBrowser: Parameters<typeof renderArtboards>[0]['openBrowser'] = (launch) =>
      openCdp(browserPath, checkBrowserArgs({ workDir: space.workDir, platform: renderInput.platform, isRoot: renderInput.isRoot, join: path.join }), launchOpenOptions(launch, BROWSER_START_MS));
    // The budget (§16): with screens to draw after the board, the board keeps 70 s of the 110 s and the
    // screens get 40 s; --screen alone gets all of it. Both share the run's deadline, under the tool's 180 s kill.
    const runMs = renderInput.budgets?.runMs ?? SYSTEM_CHECK_RENDER_BUDGET_MS;
    const screensMs = Math.min(runMs, renderInput.budgets?.screensMs ?? SYSTEM_CHECK_SCREENS_BUDGET_MS);
    const boardRunMs = screensDrawn ? runMs - screensMs : runMs;
    const outcome = !boardRuns ? NO_OUTCOME : await loop({
      openBrowser,
      deadlineAt,
      // The dark pass runs last, so a run out of time cuts it first and keeps the light results.
      plan: passes.map((pass) => ({
        file: pass.scheme === 'dark' ? DARK_BOARD_FILE : BOARD_FILE,
        screen: null,
        viewport: { id: pass.id, label: pass.label, width: pass.width, height: pass.height },
        ...(pass.scheme === 'dark' ? { scheme: 'dark' as const } : {}),
      })),
      kind: 'page',
      loadDocument: async (file) => {
        const html = documents.get(file);
        return html === undefined ? { ok: false, reason: 'missing' } : { ok: true, html };
      },
      probeSource: renderInput.probeSource,
      knownExternal,
      savePng: space.savePng,
      inspect,
      artboardTimeoutMs: renderInput.budgets?.boardMs ?? SYSTEM_CHECK_BOARD_TIMEOUT_MS,
      runBudgetMs: boardRunMs,
      ...(renderInput.signal ? { signal: renderInput.signal } : {}),
    });

    await space.checkAborted(renderInput.signal?.aborted === true || outcome.stoppedBy === 'aborted');

    // T18: the screens' real-app pictures, read before the screens are drawn so their slices can be kept for the sheets.
    const screensStarted = Date.now();
    const compares = planCompares(screenPlan.plan.length === 0 || outcome.unavailable ? [] : await readCompareSources(drawSource, drawDetail, screenPlan.plan), screenPlan.plan);
    const compareKeys = new Set(compares.targets.map((target) => `${target.screen}|${target.viewport.id}`));
    const screenSlices = new Map<string, Buffer[]>();

    // The screens (T12b): the design check's own path (no inspect), so the design probe and analyze.ts judge
    // each screen at each viewport; the dark twins are emulated in `prefers-color-scheme: dark`.
    const screenDocuments = new Map<string, Promise<LoadedDocument>>();
    const screenOutcome: RenderOutcome =
      screenPlan.plan.length === 0
        ? NO_OUTCOME
        : outcome.unavailable
          ? { ...NO_OUTCOME, unavailable: true, notRendered: screenPlan.plan.length }
          : await loop({
              openBrowser,
              deadlineAt,
              plan: screenPlan.plan,
              kind: 'page',
              loadDocument: (file) => {
                const known = screenDocuments.get(file);
                if (known !== undefined) return known;
                const loading = loadSystemScreen(drawSource, file);
                screenDocuments.set(file, loading);
                return loading;
              },
              probeSource: renderInput.probeSource,
              knownExternal,
              // `screen-<id>@<viewport>.png` (`-dark` for the dark twins, `-2` for a second slice).
              savePng: (art, slice, slices, bytes) => {
                // A light artboard with a compare sheet to make keeps its slices in memory, in order (T18).
                const key = `${art.screen ?? ''}|${art.viewport.id}`;
                if (art.scheme !== 'dark' && compareKeys.has(key)) screenSlices.set(key, [...(slice === 1 ? [] : (screenSlices.get(key) ?? [])), bytes]);
                return space.savePng(art, slice, slices, bytes, `screen-${art.screen ?? 'screen'}`);
              },
              artboardTimeoutMs: renderInput.budgets?.screenMs ?? CHECK_ARTBOARD_TIMEOUT_MS,
              runBudgetMs: boardRuns ? screensMs : runMs,
              ...(renderInput.signal ? { signal: renderInput.signal } : {}),
            });

    await space.checkAborted(renderInput.signal?.aborted === true || screenOutcome.stoppedBy === 'aborted');

    // T18: the compare sheets, in what is left of the screens' time.
    const sheets = await makeCompareSheets({
      targets: compares.targets,
      artboards: screenOutcome.artboards,
      slices: screenSlices,
      budgetMs: (boardRuns ? screensMs : runMs) - (Date.now() - screensStarted),
      savePng: space.savePng,
      transcode: (plan, inspectSource, budgetMs) =>
        loop({
          openBrowser,
          deadlineAt,
          plan,
          kind: 'page',
          loadDocument: async (file) => {
            const target = compares.targets.find((candidate) => compareFileOf(candidate) === file);
            return target === undefined ? { ok: false, reason: 'missing' } : { ok: true, html: sourceDocument(target.source) };
          },
          probeSource: renderInput.probeSource,
          knownExternal,
          savePng: space.savePng,
          inspect: inspectSource,
          artboardTimeoutMs: renderInput.budgets?.screenMs ?? CHECK_ARTBOARD_TIMEOUT_MS,
          runBudgetMs: budgetMs,
          ...(renderInput.signal ? { signal: renderInput.signal } : {}),
        }),
    });
    await space.checkAborted(renderInput.signal?.aborted === true);

    const findings: CheckFindingData[] = boardFindings(outcome.findings, CHECK_FINDINGS_MAX);
    // Pairs Node couldn't judge from the values, as the board painted them (a pair judged statically is not judged again),
    // merged with the static ones into one finding per scheme.
    const measuredLow = drawDetail.coverage.includes('foundations') ? measuredLowPairs(pairCells, drawDetail, staticLowPairs(drawDetail).judged) : [];
    const reportStatic =
      measuredLow.length === 0
        ? staticFindings
        : [
            ...staticFindings.filter((finding) => finding.code !== 'system-contrast-low'),
            ...contrastFindings([...(detail.coverage.includes('foundations') ? staticLowPairs(detail).low : []), ...measuredLow], detail.depth),
          ];
    // A pass the run had no time (or no working browser) for: said, never silent. The light passes come first, so it is the dark one.
    if (outcome.notRendered > 0 && (outcome.stoppedBy === 'budget' || outcome.stoppedBy === 'failures')) {
      const left = passes.slice(passes.length - outcome.notRendered).map((pass) => pass.label);
      findings.push({ code: 'render-skipped', file: BOARD_FILE, screen: null, viewport: null, params: { count: outcome.notRendered, reason: outcome.stoppedBy }, detail: cleanDetail(left.join(', '), CHECK_DETAIL_MAX) });
    }
    const okWidths = new Set(outcome.artboards.filter((artboard) => artboard.ok).map((artboard) => artboard.viewport));
    for (const kind of ['gap', 'no-overview', 'overview', 'tiles'] as const) {
      const areas = short.filter((entry) => entry.kind === kind && okWidths.has(entry.width)).map((entry) => entry.text);
      if (areas.length > 0) {
        findings.push({ code: 'system-board-partial', file: BOARD_FILE, screen: null, viewport: null, params: { pictured: kind, count: areas.length }, detail: cleanDetail(areas.join('; '), CHECK_DETAIL_MAX) });
      }
    }
    // The screens' findings after the board's, a dark twin's repeats dropped, then what was left out and why.
    findings.push(
      ...dedupeDarkScreenFindings(screenOutcome.findings, screenPlan.plan),
      ...screenSkippedFindings({ overLimit: screenPlan.overLimit, notRendered: screenPlan.plan.slice(screenPlan.plan.length - screenOutcome.notRendered), stoppedBy: screenOutcome.stoppedBy }),
      ...compares.findings,
      ...sheets.findings,
    );
    if (outcome.unavailable || screenOutcome.unavailable) {
      findings.push({ code: 'render-failed', file: null, screen: null, viewport: null, detail: "This browser build can't be driven. Set another browser in Settings." });
    }
    const unavailable = outcome.unavailable || screenOutcome.unavailable;
    const planned = (boardRuns ? passes.length : 0) + screenPlan.plan.length;
    const okCount = [...outcome.artboards, ...screenOutcome.artboards].filter((artboard) => artboard.ok).length;
    const state: RenderCheckState =
      unavailable || (planned > 0 && okCount === 0) ? 'failed' : okCount < planned || screenPlan.overLimit.length > 0 ? 'partial' : 'done';
    // A width that failed after saving tiles names none of them: the report keeps only what it pictures.
    const kept = new Set(outcome.artboards.flatMap((artboard) => artboard.pngs));
    const keptShots = shots
      .map((shot) => ({ ...shot, overview: shot.overview !== null && kept.has(shot.overview.png) ? shot.overview : null, tiles: shot.tiles.filter((tile) => kept.has(tile.png)) }))
      .filter((shot) => shot.overview !== null || shot.tiles.length > 0);
    const keptEntryShots = entryShots.map((shot) => ({ ...shot, pngs: shot.pngs.filter((rel) => kept.has(rel)) })).filter((shot) => shot.pngs.length > 0);
    // A wide pass that failed after its state pass keeps none of it (its findings went with it).
    const keptStates = okWidths.has('wide') ? stateResults.map((result) => ({ ...result, png: result.png !== null && kept.has(result.png) ? result.png : null })) : [];
    // --screen draws no board area.
    const areas = !boardRuns ? [] : SYSTEM_AREAS.filter((area) => (onlyArea === null ? drawDetail.coverage.includes(area) || !areaEmpty(drawDetail, area) : area === onlyArea));
    const render: SystemCheckRender = {
      state,
      browser: browserClassOf(browserPath),
      drawn,
      widths: outcome.artboards,
      shots: keptShots,
      entryShots: keptEntryShots,
      // Capped when screens add theirs; a board-only run keeps its findings exactly as before.
      findings: screensDrawn ? findings.slice(0, CHECK_FINDINGS_MAX) : findings,
      areas,
      schemes,
      ...(screensDrawn ? { screens: { artboards: screenOutcome.artboards, viewports: screenPlan.viewports } } : {}),
      ...(statePassRan && okWidths.has('wide') ? { states: keptStates } : {}),
      ...(motionPassRan && okWidths.has('wide') ? { motion: motionResults.filter((result) => kept.has(result.png)) } : {}),
      ...(compares.targets.length > 0 ? { compares: sheets.sheets } : {}),
    };
    const report = systemCheckReport({ ...base, findings: reportStatic, render });
    const reportPath = await writeSystemCheckReport(systemDir, report);
    const keptRels = [...outcome.artboards, ...screenOutcome.artboards].flatMap((artboard) => artboard.pngs).concat(sheets.sheets.map((sheet) => sheet.png));
    await space.finish(keptRels, input.now.getTime());
    return { report, detail, reportPath, pngs: keptRels.map((rel) => path.join(systemDir, ...rel.split('/'))) };
  } finally {
    await space.close();
  }
};

/**
 * Write the report to `<systemDir>/.chamber/check.json` atomically. `.chamber` is made without
 * recursion (a deleted system is never recreated), and neither it nor the file may be a link.
 */
export const writeSystemCheckReport = async (systemDir: string, report: SystemCheckReport): Promise<string> => {
  try {
    await mkdir(path.join(systemDir, '.chamber'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const target = await resolvePlainTarget(systemDir, ['.chamber', 'check.json'], { allowAbsent: true });
  await writeFileAtomic(target, `${JSON.stringify(report, null, 2)}\n`, { createDirs: false });
  return target;
};

const quietLog: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * A read-only system store for the CLI: the designs root it was given, no watcher, no settings
 * writes. The caller disposes it. A revision is never settled here: the quiet timer is longer than
 * any check, and `dispose` clears it.
 */
export const cliSystemStore = (root: string, settings: SettingsFile): SystemStore => {
  const settingsStore: SettingsStore = {
    root: () => root,
    defaultRoot: () => root,
    read: () => settings,
    update: () => Promise.reject(new Error('The check does not change settings.')),
    onRootChange: () => () => undefined,
  };
  return createSystemStore({ settings: settingsStore, hub: createChangeHub('dc-check'), log: quietLog, selfWrites: createSelfWrites(), quietMs: 24 * 60 * 60 * 1000 });
};
