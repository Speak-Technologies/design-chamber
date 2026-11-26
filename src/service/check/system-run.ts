// One system check, end to end (documentation/specs/phase-2-5-technical.md §10.2, §10.3, and
// documentation/specs/system-board-layout-and-visual-check.md §B): read the system through the system
// store (every path contained, no link followed), build its detail, take the static findings, and —
// when the caller brings a browser — draw the board at two widths, measure it, save PNG tiles and
// write `<system>/.chamber/check.json`. The route and `--static` stay static. The CLI makes a store of
// its own over the designs root (`cliSystemStore`); the service route uses the composed one.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { normalizeExternalUrl } from '../../shared/checks.ts';
import {
  CHECK_FINDINGS_MAX,
  SYSTEM_CHECK_BOARD_TIMEOUT_MS,
  SYSTEM_CHECK_BOARD_WIDTHS,
  SYSTEM_CHECK_PNGS_MAX,
  SYSTEM_CHECK_RENDER_BUDGET_MS,
  SYSTEM_CHECK_TILES_PER_AREA,
} from '../../shared/limits.ts';
import { findSecretShapes } from '../../shared/secret-shapes.ts';
import { parseEntryKey } from '../../shared/system-board.ts';
import { buildSystemDetail, effectiveLayout, SYSTEM_AREAS, type SystemDetailSource } from '../../shared/system-json.ts';
import type { BoardLayout, CheckFindingData, RenderCheckState, SettingsFile, SystemComponent, SystemDetail } from '../../shared/types.ts';
import { BundleTooLarge, bundleDocument, createLiveFileSource, type FileSource } from '../bundle.ts';
import { createChangeHub } from '../changes.ts';
import type { Logger, SettingsStore } from '../context.ts';
import { resolvePlainTarget, writeFileAtomic } from '../paths.ts';
import { createSelfWrites } from '../self-writes.ts';
import { assembleBoardHtml, overlaySource, readProposalBoardSource } from '../systems/board-assemble.ts';
import { BOARD_ENTRY_FILE } from '../systems/board-html.ts';
import { committedStateOf, readCommitted, readRecord } from '../systems/living-page.ts';
import { readProposalProblem } from '../systems/proposal-record.ts';
import { createSystemStore, repoLabelOf, type SystemStore } from '../systems/store.ts';
import { analyzeBoard, boardFindings, sanitizeBoardProbe } from './board-analyze.ts';
import { browserClassOf, openCheckRun } from './engine.ts';
import { checkBrowserArgs, openCdp } from './cdp.ts';
import { ensureChamberDir } from './output.ts';
import { renderArtboards, type InspectPage, type InspectResult, type PlannedArtboard } from './render.ts';
import { areaEmpty, s8Findings, systemCheckReport, systemFindings, type S8Facts, type SystemCheckRender, type SystemCheckReport } from './system-static.ts';

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
};

const SYSTEM_OWNER = "This design system's" as const;
const BROWSER_START_MS = 20_000;
const BOARD_FILE = 'board.html';

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
  const source = await store.get(id);
  const detail = buildSystemDetail(source);
  const facts = await readS8Facts(store, id, source);
  const staticFindings = [...systemFindings(source, detail), ...s8Findings(source, detail, facts)].slice(0, CHECK_FINDINGS_MAX);
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
      findings: [{ code: 'browser-missing', file: null, screen: null, viewport: null }],
    });
  }
  const browserPath = renderInput.browserPath;

  // The board document, bundled like the design check's (export mode, no bridge placeholder).
  let bundledHtml: string;
  let components: SystemComponent[];
  try {
    const assembled = await assembleBoardHtml(drawDetail, drawSource, 'light');
    components = assembled.components;
    bundledHtml = (await bundleDocument(overlaySource(drawSource, assembled.html), BOARD_ENTRY_FILE, { mode: 'export' })).html;
  } catch (error) {
    if (error instanceof BundleTooLarge) {
      return writeStaticRender({
        state: 'failed',
        browser: browserClassOf(browserPath),
        drawn,
        widths: [],
        shots: [],
        findings: [{ code: 'render-failed', file: BOARD_FILE, screen: null, viewport: null, detail: 'over 60 MB' }],
      });
    }
    throw error;
  }

  // Every example's remote refs are already reported statically; a blocked request for one is not reported twice.
  const knownExternal = new Set(components.flatMap((component) => component.example?.remote ?? []).map((url) => normalizeExternalUrl(url) ?? url));

  const shots: SystemCheckRender['shots'] = [];
  let pngCount = 0;
  const inspect = async (page: InspectPage, art: PlannedArtboard): Promise<InspectResult | null> => {
    const raw = await page.evaluate(`${renderInput.probeSource};__dcProbe.collectBoard()`, { awaitPromise: false });
    const probe = sanitizeBoardProbe(raw);
    if (probe === null) return null;
    const width = SYSTEM_CHECK_BOARD_WIDTHS.find((candidate) => candidate.id === art.viewport.id);
    if (width === undefined) return null;
    const findings = analyzeBoard(probe, { width, widest: width.id === 'wide', layoutOf: (entry) => layoutOfEntry(drawDetail, entry), fileOf: fileOfEntry });
    const pngs: string[] = [];
    for (const area of SYSTEM_AREAS) {
      // An uncovered empty area only says "Not covered"; nothing to picture.
      if (!drawDetail.coverage.includes(area) && areaEmpty(drawDetail, area)) continue;
      const measured = probe.areas.find((candidate) => candidate.area === area);
      const top = measured?.top ?? 0;
      const height = measured?.height ?? 0;
      const tileHeight = width.height;
      const tiles = Math.min(SYSTEM_CHECK_TILES_PER_AREA, Math.max(1, Math.ceil(height / tileHeight)));
      if (height > SYSTEM_CHECK_TILES_PER_AREA * tileHeight) {
        findings.push({ code: 'system-board-partial', file: BOARD_FILE, screen: null, viewport: width.id, params: { area, max: SYSTEM_CHECK_TILES_PER_AREA * tileHeight, width: width.width } });
      }
      const areaPngs: string[] = [];
      for (let n = 1; n <= tiles && pngCount < SYSTEM_CHECK_PNGS_MAX; n += 1) {
        const tileTop = top + (n - 1) * tileHeight;
        const clipHeight = Math.min(tileHeight, top + height - tileTop);
        if (clipHeight < 1) break;
        await page.scrollTo(tileTop);
        const bytes = await page.capture({ y: tileTop, height: clipHeight });
        const rel = await page.save(area, n, tiles, bytes);
        areaPngs.push(rel);
        pngs.push(rel);
        pngCount += 1;
      }
      if (areaPngs.length > 0) shots.push({ width: width.id, area, pngs: areaPngs });
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
    const outcome = await renderArtboards({
      openBrowser: () => openCdp(browserPath, checkBrowserArgs({ workDir: space.workDir, platform: renderInput.platform, isRoot: renderInput.isRoot, join: path.join }), { timeoutMs: BROWSER_START_MS }),
      plan: SYSTEM_CHECK_BOARD_WIDTHS.map((width) => ({ file: BOARD_FILE, screen: null, viewport: { id: width.id, label: width.label, width: width.width, height: width.height } })),
      kind: 'page',
      loadDocument: async (file) => (file === BOARD_FILE ? { ok: true, html: bundledHtml } : { ok: false, reason: 'missing' }),
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
    if (outcome.unavailable) {
      findings.push({ code: 'render-failed', file: null, screen: null, viewport: null, detail: "This browser build can't be driven. Set another browser in Settings." });
    }
    const okCount = outcome.artboards.filter((artboard) => artboard.ok).length;
    const state: RenderCheckState = outcome.unavailable || okCount === 0 ? 'failed' : okCount < SYSTEM_CHECK_BOARD_WIDTHS.length ? 'partial' : 'done';
    // A width that failed after saving tiles names none of them: the report keeps only what it pictures.
    const kept = new Set(outcome.artboards.flatMap((artboard) => artboard.pngs));
    const keptShots = shots.map((shot) => ({ ...shot, pngs: shot.pngs.filter((rel) => kept.has(rel)) })).filter((shot) => shot.pngs.length > 0);
    const render: SystemCheckRender = { state, browser: browserClassOf(browserPath), drawn, widths: outcome.artboards, shots: keptShots, findings };
    const report = systemCheckReport({ ...base, render });
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
