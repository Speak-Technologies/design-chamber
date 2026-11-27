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
  CHECK_FINDINGS_MAX,
  SYSTEM_CHECK_BOARD_TIMEOUT_MS,
  CHECK_DETAIL_MAX,
  SYSTEM_CHECK_OPTIONAL_TILES_TIME_SHARE,
  SYSTEM_CHECK_PNGS_MAX,
  SYSTEM_CHECK_RENDER_BUDGET_MS,
  SYSTEM_CHECK_TILE_PIXELS_MAX,
  SYSTEM_EXAMPLE_MAX,
} from '../../shared/limits.ts';
import { findSecretShapes } from '../../shared/secret-shapes.ts';
import { isBoardEntryKey, parseEntryKey } from '../../shared/system-board.ts';
import { buildSystemDetail, effectiveLayout, SYSTEM_AREAS, type SystemDetailSource } from '../../shared/system-json.ts';
import type { BoardLayout, CheckFindingData, RenderCheckState, SettingsFile, SystemArea, SystemDetail } from '../../shared/types.ts';
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
import { analyzeBoard, boardFindings, boardPassesOf, DARK_PASS_AREAS, findingsInArea, measuredLowPairs, passShare, sanitizeBoardProbe, type BoardProbePair } from './board-analyze.ts';
import { staticLowPairs } from '../../shared/pair-contrast.ts';
import { pictureCoverage, planBoardPictures, type PictureCoverage } from './board-pictures.ts';
import { browserClassOf, openCheckRun } from './engine.ts';
import { checkBrowserArgs, launchOpenOptions, openCdp } from './cdp.ts';
import { ensureChamberDir } from './output.ts';
import { PngStitchError, stitchPngs } from './png-stitch.ts';
import { CHECK_RUN_DEADLINE_MS, renderArtboards, type InspectPage, type InspectResult, type PlannedArtboard } from './render.ts';
import { areaEmpty, contrastFindings, s8Findings, systemCheckReport, systemFindings, type S8Facts, type SystemBoardShot, type SystemCheckRender, type SystemCheckReport } from './system-static.ts';

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
  /** Time limits; the defaults are SYSTEM_CHECK_BOARD_TIMEOUT_MS and SYSTEM_CHECK_RENDER_BUDGET_MS. Tests shorten them. */
  budgets?: { boardMs?: number; runMs?: number };
  /** Test seam: replaces the render loop (so a test can see what the run hands it), as `RunCheckInput.render`. */
  renderLoop?: typeof renderArtboards;
  /** `--area`: picture and measure one area only (the board is still drawn whole). Absent or null: every area. */
  area?: SystemArea | null;
  /** `--scheme`: which passes to draw. Absent or null: both when the system has a dark value, else light. */
  scheme?: 'light' | 'dark' | 'both' | null;
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

  // The board documents, bundled like the design check's (export mode, no bridge placeholder): one per scheme drawn.
  const documents = new Map<string, string>();
  const remote: string[] = [];
  try {
    for (const scheme of [...new Set(passes.map((pass) => pass.scheme))]) {
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
    const outcome = await (renderInput.renderLoop ?? renderArtboards)({
      // The launch options carry the abort signal and, for a restart, only what is left of the run.
      openBrowser: (launch) =>
        openCdp(browserPath, checkBrowserArgs({ workDir: space.workDir, platform: renderInput.platform, isRoot: renderInput.isRoot, join: path.join }), launchOpenOptions(launch, BROWSER_START_MS)),
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
      runBudgetMs: renderInput.budgets?.runMs ?? SYSTEM_CHECK_RENDER_BUDGET_MS,
      ...(renderInput.signal ? { signal: renderInput.signal } : {}),
    });

    await space.checkAborted(renderInput.signal?.aborted === true || outcome.stoppedBy === 'aborted');

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
    if (outcome.unavailable) {
      findings.push({ code: 'render-failed', file: null, screen: null, viewport: null, detail: "This browser build can't be driven. Set another browser in Settings." });
    }
    const okCount = outcome.artboards.filter((artboard) => artboard.ok).length;
    const state: RenderCheckState = outcome.unavailable || okCount === 0 ? 'failed' : okCount < passes.length ? 'partial' : 'done';
    // A width that failed after saving tiles names none of them: the report keeps only what it pictures.
    const kept = new Set(outcome.artboards.flatMap((artboard) => artboard.pngs));
    const keptShots = shots
      .map((shot) => ({ ...shot, overview: shot.overview !== null && kept.has(shot.overview.png) ? shot.overview : null, tiles: shot.tiles.filter((tile) => kept.has(tile.png)) }))
      .filter((shot) => shot.overview !== null || shot.tiles.length > 0);
    const keptEntryShots = entryShots.map((shot) => ({ ...shot, pngs: shot.pngs.filter((rel) => kept.has(rel)) })).filter((shot) => shot.pngs.length > 0);
    const areas = SYSTEM_AREAS.filter((area) => (onlyArea === null ? drawDetail.coverage.includes(area) || !areaEmpty(drawDetail, area) : area === onlyArea));
    const schemes = [...new Set(passes.map((pass) => pass.scheme))];
    const render: SystemCheckRender = { state, browser: browserClassOf(browserPath), drawn, widths: outcome.artboards, shots: keptShots, entryShots: keptEntryShots, findings, areas, schemes };
    const report = systemCheckReport({ ...base, findings: reportStatic, render });
    const reportPath = await writeSystemCheckReport(systemDir, report);
    const keptRels = outcome.artboards.flatMap((artboard) => artboard.pngs);
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
