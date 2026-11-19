// A design system's own files, read as data (documentation/specs/phase-2-5-technical.md §2.3,
// §2.5, §2.11, §2.13, §2.15, §5.1, §5.6). Pure: no Node imports, so the service, the CLI check
// and the guest all read a system the same way.
//
// Everything here reads agent-written text, so it is untrusted input: tolerant like
// design-json.ts, an invalid entry is dropped with a `SystemProblem`, never fatal, and unknown
// keys are kept on the raw object.
//
// T0 seam: the signatures are the contract. T1 (store, `parseSystemJson`, `parseSystemState`,
// `buildSystemDetail`, `deriveReview`, `sectionFingerprints`), T5 (`safeAssetName`), T11
// (`coveredAreas`, patterns/brand), T12b (`parseBuildJson`, `isSystemContractRel`) and T17
// (`parseProposal`) fill them, in that order.

import type {
  BuildJson,
  IsoDate,
  JsonObject,
  ProposalJson,
  SystemArea,
  SystemDetail,
  SystemSection,
  SystemState,
} from './types.ts';

const NOT_BUILT = 'This part of Design Chamber (design systems) is not built yet.';
const notBuilt = (): never => {
  throw new Error(NOT_BUILT);
};

/** One entry that could not be read; the page lists them ("3 entries couldn't be read."). */
export type SystemProblem = { entry: string; message: string };

/** Which coverage area each section belongs to (§2.11, AD-22). */
export const AREA_OF_SECTION: Readonly<Record<SystemSection, SystemArea>> = Object.freeze({
  overview: 'foundations',
  colours: 'foundations',
  typography: 'foundations',
  spacing: 'foundations',
  radius: 'foundations',
  shadows: 'foundations',
  layers: 'foundations',
  sizes: 'foundations',
  components: 'components',
  patterns: 'patterns',
  brand: 'brand',
  assets: 'brand',
});

/** The four areas in the order the board, the panel and the living page show them. */
export const SYSTEM_AREAS: readonly SystemArea[] = Object.freeze(['foundations', 'components', 'patterns', 'brand']);

/**
 * `system.json` (schema `design-chamber/system@1`, §2.3). `raw` keeps every key (null when the text is
 * not a JSON object or is over `SYSTEM_JSON_MAX_BYTES`); `unreadable` is the whole-file sentence then.
 */
export type ParsedSystemJson = { raw: JsonObject | null; problems: SystemProblem[]; unreadable: string | null };

export const parseSystemJson = (text: string): ParsedSystemJson => notBuilt();

/**
 * `<system>/.chamber/state.json` (schema `design-chamber/system-state@1`, §2.5). A missing or broken file
 * gives a provisional state (name from the id humanised, Draft, revision 0), written on the first service write.
 */
export const parseSystemState = (raw: unknown, id: string, now: IsoDate): SystemState => notBuilt();

/** The covered areas (§2.11): absent → all four; invalid → all four with the problem sentence. */
export const coveredAreas = (raw: JsonObject | null): { areas: SystemArea[]; problem: string | null } => notBuilt();

/** What `buildSystemDetail` reads: one system's files as the store found them (§5.1 `SystemRecord`). */
export type SystemDetailSource = {
  id: string;
  /** The system folder (`_systems/<id>`), shown as the path. */
  dir: string;
  state: SystemState;
  systemJson: string | null;
  tokensCss: string | null;
  /** Text files by contract-relative path (`OVERVIEW.md`, `notes/<id>.md`, …). */
  texts: Record<string, string>;
  /** Every file under the system's content set, contract-relative, with its size. */
  files: { rel: string; bytes: number }[];
  build: BuildJson | null;
};

/** The one detail every reader sees (board, checks, routes, living page). */
export const buildSystemDetail = (source: SystemDetailSource): SystemDetail => notBuilt();

/** sha256 of a canonical JSON of each section's entries (§2.5, §2.11). */
export const sectionFingerprints = (detail: SystemDetail): Record<SystemSection, string> => notBuilt();

/** A section shows its recorded review only while its fingerprint still matches (§2.5). */
export const deriveReview = (
  state: SystemState,
  fingerprints: Record<SystemSection, string>,
): { review: SystemDetail['review']; changesToReview: boolean } => notBuilt();

/** A safe file name for a brand file (§5.6): base name, NFKC, `[A-Za-z0-9._ -]`, ≤ 80, device stems, clashes. */
export const safeAssetName = (name: string, existing: readonly string[]): string => notBuilt();

/** A path in the system file contract (§5.10): `system.json`, `tokens.css`, `OVERVIEW.md`, `notes/<id>.md`, …. */
export const isSystemContractRel = (rel: string): boolean => notBuilt();

/** `BUILD.json` (schema `design-chamber/system-build@1`, §2.13): ≤ `SYSTEM_BUILD_JSON_MAX_BYTES`, else unreadable. */
export type ParsedBuildJson = { build: BuildJson | null; raw: JsonObject | null; problems: SystemProblem[]; unreadable: string | null };

export const parseBuildJson = (text: string): ParsedBuildJson => notBuilt();

/** `PROPOSAL.json` (schema `design-chamber/system-proposal@1`, §2.15): ≤ `SYSTEM_PROPOSAL_MAX_BYTES`, else unreadable. */
export type ParsedProposal = { proposal: ProposalJson | null; problems: SystemProblem[]; unreadable: string | null };

export const parseProposal = (text: string): ParsedProposal => notBuilt();
