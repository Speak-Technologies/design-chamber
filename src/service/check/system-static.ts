// System checks (documentation/specs/phase-2-5-technical.md §10.3): what can be known about one
// design system from its files alone. Pure verdicts over `buildSystemDetail` and the source it was
// built from, so the CLI (`dc check --system <id>`), the tool and `GET /systems/:id/checks` all
// decide the same way. Findings carry codes and numbers only; the sentences come from
// `src/shared/checks.ts`. Entry labels, token names and file names travel in `detail`, cleaned and
// clipped like every other design text.
//
// Coverage (AD-22) is respected: a finding about an area the system does not cover is not raised.
// The S8 findings (§10.4: living page, repo, snapshot, code drift, BUILD.json, coverage, what landed)
// are `s8Findings`, over the same detail plus what the caller read from the repo (`S8Facts`).

import { cleanDetail, isDesignRelativeFile } from '../../shared/checks.ts';
import { CHECK_DETAIL_MAX, CHECK_FINDINGS_MAX, SYSTEM_NOTE_MAX, SYSTEM_OVERVIEW_MAX } from '../../shared/limits.ts';
import { AREA_OF_SECTION, layoutPlaceTakes, SYSTEM_AREAS, type SystemDetailSource } from '../../shared/system-json.ts';
import type { ArtboardCheck, CheckBrowser, CheckFindingData, CheckParams, CheckReport, LivingPageState, ProposalPartName, ProposalProblemReason, RenderCheckState, SecretShapeKind, SystemArea, SystemDetail } from '../../shared/types.ts';
import { capPerCode } from './analyze.ts';

/** The words `buildSystemDetail` uses for the token cap (system-json.ts `TOKENS_CAP_SENTENCE`). */
const TOKENS_CAP_MESSAGE = "Design systems hold up to 2 000 tokens. The rest weren't read.";
/** A listed font whose file is absent: `readFonts` says `<file> is missing.` for an `assets/fonts/` path. */
const FONT_MISSING = /^(assets\/fonts\/[^\s]+) is missing\.$/;
/** Bodies `buildSystemDetail` reads with the note cap. */
const BODY_FILE = /^(?:notes|patterns|brand)\/[^/]+\.md$/;

const NOWHERE = { file: null, screen: null, viewport: null } as const;

const namesDetail = (names: readonly string[]): string => cleanDetail(names.slice(0, 3).join(', '), CHECK_DETAIL_MAX);

const covers = (detail: SystemDetail, area: SystemArea): boolean => detail.coverage.includes(area);

/** Ignored hints that are known layouts in a place that doesn't take them. The listed ones are counted; past the list's cap the rest count as unknown. */
const misplacedCount = (detail: SystemDetail): number => detail.boardLayout.ignored.filter((problem) => problem.reason === 'not-here').length;

/**
 * Every static finding of one system, capped per code and in total like a design's. `source` is the
 * input `detail` was built from (the raw texts tell "over the cap" apart from "at the cap").
 */
export const systemFindings = (source: Pick<SystemDetailSource, 'texts' | 'tooLarge'>, detail: SystemDetail): CheckFindingData[] => {
  const out: CheckFindingData[] = [];
  if (detail.unreadable !== null) {
    // Nothing in system.json can be trusted: say only that, and what tokens.css alone shows.
    out.push({ code: 'system-unreadable', ...NOWHERE });
  }

  // Entries the reader dropped or kept with a problem. The token cap, missing fonts and the
  // per-value problems have their own codes; everything else is one "entries" finding.
  const entryProblems: string[] = [];
  for (const problem of detail.problems) {
    if (problem.entry === 'tokens.css' && problem.message === TOKENS_CAP_MESSAGE) {
      out.push({ code: 'system-token-cap', file: 'tokens.css', screen: null, viewport: null });
      continue;
    }
    const font = problem.entry.startsWith('fonts[') ? FONT_MISSING.exec(problem.message) : null;
    if (font !== null && isDesignRelativeFile(font[1])) {
      out.push({ code: 'system-font-missing', file: font[1] ?? null, screen: null, viewport: null });
      continue;
    }
    if (!entryProblems.includes(problem.entry)) entryProblems.push(problem.entry);
  }
  if (detail.unreadable === null && entryProblems.length > 0) {
    out.push({ code: 'system-entry-invalid', file: 'system.json', screen: null, viewport: null, params: { count: entryProblems.length }, detail: namesDetail(entryProblems) });
  }

  // Layout hints are presentation: an ignored hint is its own warning, whatever the coverage, and
  // never an "entry couldn't be read" (the entry itself is fine).
  if (detail.boardLayout.ignoredCount > 0) {
    out.push({
      code: 'system-layout-invalid',
      file: 'system.json',
      screen: null,
      viewport: null,
      params: { count: detail.boardLayout.ignoredCount, misplaced: misplacedCount(detail) },
      // Each one with what its place takes, so the agent knows what to write instead (an unknown word and a known
      // layout in the wrong place read differently in the sentence; the detail names the fix for each).
      detail: cleanDetail(
        detail.boardLayout.ignored
          .slice(0, 3)
          .map((problem) => `${problem.entry}: ${problem.value} (${layoutPlaceTakes(problem.entry)})`)
          .join('; '),
        CHECK_DETAIL_MAX,
      ),
    });
  }

  if (covers(detail, AREA_OF_SECTION.colours)) {
    const invalid = detail.tokens.filter((token) => token.light?.editable === 'unreadable' || token.dark?.editable === 'unreadable').map((token) => token.name);
    if (invalid.length > 0) out.push({ code: 'system-value-invalid', file: 'tokens.css', screen: null, viewport: null, params: { count: invalid.length }, detail: namesDetail(invalid) });
  }

  if (detail.unreadable === null && covers(detail, AREA_OF_SECTION.overview)) {
    const overviewText = source.texts['OVERVIEW.md'];
    const tooLarge = source.tooLarge?.includes('OVERVIEW.md') === true;
    if (tooLarge || (overviewText !== undefined && overviewText.length > SYSTEM_OVERVIEW_MAX)) {
      out.push({ code: 'system-overview-long', file: 'OVERVIEW.md', screen: null, viewport: null });
    } else if (detail.overview === null || detail.overview.text.trim() === '') {
      out.push({ code: 'system-overview-empty', file: 'OVERVIEW.md', screen: null, viewport: null });
    }
  }

  for (const [rel, text] of Object.entries(source.texts)) {
    if (!BODY_FILE.test(rel) || !isDesignRelativeFile(rel)) continue;
    const area: SystemArea = rel.startsWith('patterns/') ? 'patterns' : rel.startsWith('brand/') ? 'brand' : AREA_OF_SECTION.overview;
    if (covers(detail, area) && text.length > SYSTEM_NOTE_MAX) out.push({ code: 'system-note-long', file: rel, screen: null, viewport: null });
  }
  for (const rel of source.tooLarge ?? []) {
    if (BODY_FILE.test(rel) && isDesignRelativeFile(rel)) out.push({ code: 'system-note-long', file: rel, screen: null, viewport: null });
  }

  if (covers(detail, 'components')) {
    for (const component of detail.components) {
      const file = `components/${component.id}.html`;
      const remote = component.example?.remote ?? [];
      if (remote.length > 0 && isDesignRelativeFile(file)) out.push({ code: 'system-example-remote', file, screen: null, viewport: null, detail: cleanDetail(remote[0] ?? '', CHECK_DETAIL_MAX) });
      if (component.undefinedTokens.length > 0) {
        out.push({ code: 'system-token-undefined', file: 'system.json', screen: null, viewport: null, params: { count: component.undefinedTokens.length }, detail: cleanDetail(`${component.id}: ${component.undefinedTokens.slice(0, 3).join(', ')}`, CHECK_DETAIL_MAX) });
      }
    }
  }

  return capPerCode(out).slice(0, CHECK_FINDINGS_MAX);
};

// ---- S8: the repo-backed system, code drift, coverage, what landed (§10.4) ----

/** The committed living page as the check read it (the same states as the system page's card). */
export type CommittedPageFacts = { state: LivingPageState; revision: number | null; sentence: string; reasons: readonly string[] };

/** What the caller read beside the system's own files; pure data, so the CLI and the route decide alike. */
export type S8Facts = {
  /** A repo-backed system's living page; null for an internal home. */
  living: {
    /** null when the repo could not be read at all. */
    committed: CommittedPageFacts | null;
    /** Secret shapes in the committed page's text (kinds only, never the values). */
    secrets: readonly { kind: SecretShapeKind }[];
    /** The staged record (`.chamber/living-page.json`), null when there is none. */
    staged: { problem: NonNullable<CheckParams['failed']> | null; secrets: readonly { kind: SecretShapeKind; where: string }[] } | null;
  } | null;
  /**
   * The current PROPOSAL.json's first problem (§5.14's closed list), null when there is none or it is sound;
   * `sentence` is the specific one (the parser's, or the step 3 check's) and goes in the finding's detail.
   */
  proposal: { reason: ProposalProblemReason; sentence: string | null } | null;
};

const PART_NAMES: readonly ProposalPartName[] = ['system-files', 'token-fixes', 'docs', 'living-page'];
const UNREADABLE_REASON = /^Design Chamber can't read the living page: (.+)\.$/;

/** Whether system.json names its coverage itself; an absent key covers all four areas by default (§2.11). */
const coverageDeclared = (systemJson: string | null): boolean => {
  if (systemJson === null) return false;
  try {
    const raw: unknown = JSON.parse(systemJson);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) && Object.hasOwn(raw, 'coverage');
  } catch {
    return false;
  }
};

/** Whether an area has nothing in it (the coverage finding's rule; the visual check tiles areas that hold entries even uncovered). */
export const areaEmpty = (detail: SystemDetail, area: SystemArea): boolean => {
  switch (area) {
    case 'foundations':
      return detail.tokens.length === 0 && detail.type.length === 0 && detail.notes.length === 0 && (detail.overview === null || detail.overview.text.trim() === '');
    case 'components':
      return detail.components.length === 0;
    case 'patterns':
      return detail.patterns.length === 0;
    case 'brand':
      return detail.brand.length === 0 && detail.logos.length === 0;
  }
};

/**
 * The S8 findings of one system (§10.4, rev 3 wording). Codes, enums and numbers only; names, paths and
 * the scanner's reasons travel in `detail`. A system that is unreadable, or still empty while it is
 * being built, raises no coverage finding.
 */
export const s8Findings = (source: Pick<SystemDetailSource, 'state' | 'systemJson' | 'build'>, detail: SystemDetail, facts: S8Facts): CheckFindingData[] => {
  const out: CheckFindingData[] = [];
  const system = detail.name;
  const repo = detail.home.kind === 'repo' ? detail.home.label : null;
  const named = (params: CheckParams = {}): CheckParams => ({ system, ...(repo !== null ? { repo } : {}), ...params });

  const buildProblem = source.state.buildProblem;
  if (buildProblem !== undefined && buildProblem !== null) out.push({ code: 'system-build-invalid', file: 'BUILD.json', screen: null, viewport: null, params: named({ build: buildProblem.reason }) });

  if (detail.home.kind === 'repo') {
    const living = facts.living;
    const repoUnreadable = (source.state.repoProblem !== undefined && source.state.repoProblem !== null) || living === null || living.committed === null;
    if (repoUnreadable) out.push({ code: 'system-repo-unreadable', ...NOWHERE, params: named() });
    if (detail.snapshot?.tampered === true) out.push({ code: 'system-snapshot-changed', ...NOWHERE, params: named() });

    const committed = living?.committed ?? null;
    if (committed !== null) {
      switch (committed.state) {
        case 'missing':
          out.push({ code: 'system-living-missing', ...NOWHERE, params: named() });
          break;
        case 'out-of-date':
          out.push({ code: 'system-living-stale', ...NOWHERE, params: named({ revision: detail.revision, ...(committed.revision !== null ? { from: committed.revision } : {}) }) });
          break;
        case 'changed':
          out.push({ code: 'system-living-changed', ...NOWHERE, params: named() });
          break;
        case 'reformatted':
          out.push({ code: 'system-living-reformatted', ...NOWHERE, params: named({ revision: detail.revision }) });
          break;
        case 'unsafe':
          out.push({ code: 'system-living-unsafe', ...NOWHERE, params: named(), detail: namesDetail(committed.reasons) });
          break;
        case 'unreadable': {
          // A page that can't be read (a link, too large, not a file) can't be checked as safe either.
          const reason = UNREADABLE_REASON.exec(committed.sentence)?.[1] ?? 'it could not be read';
          out.push({ code: 'system-living-unsafe', ...NOWHERE, params: named(), detail: cleanDetail(reason, CHECK_DETAIL_MAX) });
          break;
        }
        case 'fresh':
          break;
      }
    }

    const staged = living?.staged ?? null;
    if (staged !== null && staged.problem !== null) out.push({ code: 'system-living-failed', ...NOWHERE, params: named({ failed: staged.problem }) });

    // The committed page's own text first; else what the staged page shows (a dev page is staged with them).
    const access = source.build?.access ?? null;
    const accessParam: CheckParams = access === 'dev' || access === 'public' ? { access } : {};
    const committedHits = living?.secrets ?? [];
    const stagedHits = staged !== null && staged.problem !== 'secret' ? staged.secrets : [];
    const hits = committedHits.length > 0 ? committedHits : stagedHits;
    const first = hits[0];
    if (first !== undefined) {
      const where = (staged?.secrets ?? []).map((hit) => hit.where).filter((key, index, all) => key !== '' && all.indexOf(key) === index);
      out.push({
        code: 'system-living-secret',
        ...NOWHERE,
        params: named({ kind: first.kind, count: hits.length, ...accessParam }),
        ...(where.length > 0 ? { detail: namesDetail(where) } : {}),
      });
    }
  }

  const drift = detail.codeDrift;
  if (drift !== null && drift.differ > 0) {
    out.push({
      code: drift.mode === 'fix' ? 'system-code-drift' : 'system-code-differs',
      ...NOWHERE,
      params: named({ count: drift.differ, ...(drift.unread.length > 0 ? { unread: drift.unread.length } : {}) }),
      ...(drift.names.length > 0 ? { detail: namesDetail(drift.names) } : {}),
    });
  }

  if (facts.proposal !== null) {
    const detail = facts.proposal.sentence === null ? '' : cleanDetail(facts.proposal.sentence, CHECK_DETAIL_MAX);
    out.push({ code: 'system-proposal-invalid', file: 'PROPOSAL.json', screen: null, viewport: null, params: named({ proposal: facts.proposal.reason }), ...(detail !== '' ? { detail } : {}) });
  }

  const landed = detail.landed;
  if (landed !== null && !landed.matches) {
    if (landed.differ.length > 0) out.push({ code: 'system-landed-differs', ...NOWHERE, params: named({ count: landed.differ.length }), detail: namesDetail(landed.differ) });
    for (const part of landed.unclaimed) {
      if ((PART_NAMES as readonly string[]).includes(part)) out.push({ code: 'system-landed-differs', ...NOWHERE, params: named({ part: part as ProposalPartName }) });
    }
  }

  if (detail.unreadable === null && !detail.empty && coverageDeclared(source.systemJson)) {
    for (const area of SYSTEM_AREAS) {
      if (covers(detail, area) && areaEmpty(detail, area)) out.push({ code: 'system-coverage-empty', ...NOWHERE, params: named({ area }) });
    }
  }
  return capPerCode(out);
};

// ---- the report (`<system>/.chamber/check.json`) ----

/** The board widths the visual check draws (ids of `SYSTEM_CHECK_BOARD_WIDTHS`). */
export type SystemBoardWidthId = 'wide' | 'narrow';

/**
 * The visual check's part (documentation/specs/system-board-layout-and-visual-check.md §B.5): the
 * board drawn at two widths, its PNG tiles by area, and the measured findings. `null` when only the
 * files were checked (the route, `--static`). Additive: `version` stays 1.
 */
export type SystemCheckRender = {
  state: RenderCheckState;
  browser: CheckBrowser | null;
  /** Which board was drawn: the live one, or the waiting proposal's (D10). */
  drawn: { from: 'system' | 'proposal'; proposal: string | null };
  /** One artboard per width, `screen` null, in plan order. */
  widths: ArtboardCheck[];
  /** The pictures by width and area, in area order; paths system-relative. */
  shots: SystemBoardShot[];
  /** For each entry with a finding: the full-size pictures that show it, by width. */
  entryShots: { width: SystemBoardWidthId; entry: string; pngs: string[] }[];
  findings: CheckFindingData[];
};

/** One area at one width: its overview (the whole area scaled down) and its full-size tiles. */
export type SystemBoardShot = {
  width: SystemBoardWidthId;
  area: SystemArea;
  /** The area's height on the board, px. */
  heightPx: number;
  /** The area scaled to `scale`, covering its first `coversPx` (all of it unless the area is very tall); null if it couldn't be made. */
  overview: { png: string; scale: number; coversPx: number } | null;
  /** Full-size tiles, top to bottom; `y` is the tile's offset from the top of the area. */
  tiles: { png: string; y: number; height: number }[];
};

/**
 * A system's check report. Same `version` and findings as a design's (`CheckReport`), with the system
 * id in place of the slug. The render part is the visual check's; the route and `--static` leave it null.
 */
export type SystemCheckReport = {
  version: 1;
  system: string;
  createdAt: string;
  tool: CheckReport['tool'];
  static: { findings: CheckFindingData[] };
  render: SystemCheckRender | null;
};

export const systemCheckReport = (input: { id: string; findings: CheckFindingData[]; now: Date; tool: CheckReport['tool']; render?: SystemCheckRender | null }): SystemCheckReport => ({
  version: 1,
  system: input.id,
  createdAt: input.now.toISOString(),
  tool: input.tool,
  static: { findings: input.findings },
  render: input.render ?? null,
});
