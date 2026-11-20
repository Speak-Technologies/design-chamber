// System checks (documentation/specs/phase-2-5-technical.md §10.3): what can be known about one
// design system from its files alone. Pure verdicts over `buildSystemDetail` and the source it was
// built from, so the CLI (`dc check --system <id>`), the tool and `GET /systems/:id/checks` all
// decide the same way. Findings carry codes and numbers only; the sentences come from
// `src/shared/checks.ts`. Entry labels, token names and file names travel in `detail`, cleaned and
// clipped like every other design text.
//
// Coverage (AD-22) is respected minimally: a finding about an area the system does not cover is
// not raised. The S8 findings (living page, repo, code drift, coverage-empty) are T16's.

import { cleanDetail, isDesignRelativeFile } from '../../shared/checks.ts';
import { CHECK_DETAIL_MAX, CHECK_FINDINGS_MAX, SYSTEM_NOTE_MAX, SYSTEM_OVERVIEW_MAX } from '../../shared/limits.ts';
import { AREA_OF_SECTION, type SystemDetailSource } from '../../shared/system-json.ts';
import type { CheckFindingData, CheckReport, SystemArea, SystemDetail } from '../../shared/types.ts';
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

// ---- the report (`<system>/.chamber/check.json`) ----

/**
 * A system's check report. Same `version` and findings as a design's (`CheckReport`), with the system
 * id in place of the slug and no render part: a system check is static only (§10.2).
 */
export type SystemCheckReport = {
  version: 1;
  system: string;
  createdAt: string;
  tool: CheckReport['tool'];
  static: { findings: CheckFindingData[] };
};

export const systemCheckReport = (input: { id: string; findings: CheckFindingData[]; now: Date; tool: CheckReport['tool'] }): SystemCheckReport => ({
  version: 1,
  system: input.id,
  createdAt: input.now.toISOString(),
  tool: input.tool,
  static: { findings: input.findings },
});
