// A design system's own files, read as data (documentation/specs/phase-2-5-technical.md §2.3,
// §2.5, §2.11, §2.13, §2.15, §5.1, §5.6). Pure: no Node imports, so the service, the CLI check
// and the guest all read a system the same way.
//
// Everything here reads agent-written text, so it is untrusted input: tolerant like
// design-json.ts, an invalid entry is dropped with a `SystemProblem`, never fatal, and unknown
// keys are kept on the raw object. Only own properties are read (`Object.hasOwn`), so a
// `__proto__` key is an ordinary, ignored key.
//
// T1 fills `parseSystemJson`, `parseSystemState`, `coveredAreas`, `buildSystemDetail`,
// `sectionFingerprints`, `deriveReview` and `safeAssetName`; T12b `parseBuildJson`,
// `isSystemContractRel` and `buildProblemSentence`; T17 `parseProposal` and `landedSentence`.
//
// Token values: which declaration is light or dark, a token's section and whether a value is
// valid are the token rules of `token-edit.ts` (T3). `buildSystemDetail` takes them as
// `SystemTokenRules` (defaulting to those functions), so the reader and its tests do not depend
// on the order the two tasks land in.

import { sha256Hex } from './agent/ownership.ts';
import {
  BOARD_LAYOUT_TEXT_MAX,
  BUILD_PROBLEM_VALUE_MAX,
  LOCATION_READ_LIST_MAX,
  REPO_REL_PATTERN,
  SYSTEM_LAYOUT_PROBLEMS_MAX,
  SYSTEM_BRAND_MAX,
  SYSTEM_BUILD_CALLS_MAX,
  SYSTEM_BUILD_JSON_MAX_BYTES,
  SYSTEM_BUILD_TICKET_PATTERN,
  SYSTEM_COMPONENT_SIZES_MAX,
  SYSTEM_COMPONENTS_MAX,
  SYSTEM_ENTRY_ID_PATTERN,
  SYSTEM_OUT_OF_SCOPE_MAX,
  SYSTEM_PAIRS_MAX,
  SYSTEM_EXAMPLE_MAX,
  SYSTEM_ID_PATTERN,
  SYSTEM_JSON_MAX_BYTES,
  SYSTEM_NAME_MAX,
  SYSTEM_NOTE_MAX,
  SYSTEM_NOTES_MAX,
  SYSTEM_OVERVIEW_MAX,
  SYSTEM_PATTERNS_MAX,
  REPO_PATH_PATTERN,
  SYSTEM_PROPOSAL_FILES_MAX,
  SYSTEM_PROPOSAL_ID_PATTERN,
  SYSTEM_PROPOSAL_MAX_BYTES,
  SYSTEM_PROPOSAL_PATCH_MAX,
  SYSTEM_PROPOSAL_PATCHES_MAX,
  SYSTEM_TOKEN_NAME_PATTERN,
  SYSTEM_TOKENS_MAX,
  SYSTEM_TYPE_STYLES_MAX,
  SYSTEM_USAGE_NOTE_MAX,
} from './limits.ts';
import { isSystemTopicId } from './system-checklist.ts';
import { classifyToken, isDarkContext, isLightContext, validateTokenValue, type TypeField, type ValueCheck } from './token-edit.ts';
import { ALSO_SET_MAX, scanTokens, type Declaration, type TokenContext } from './tokens-css.ts';
import type {
  BoardLayout,
  BuildJson,
  BuildView,
  CandidateMark,
  ColourGroup,
  ColourPairUse,
  FontAsset,
  IsoDate,
  JsonObject,
  JsonValue,
  LogoAsset,
  LandedView,
  ProposalFile,
  ProposalFileEntry,
  ProposalJson,
  ProposalPart,
  ProposalPartName,
  ReviewState,
  SourceLine,
  SystemArea,
  SystemColourPair,
  SystemComponent,
  SystemDepth,
  SystemDetail,
  SystemEntryText,
  SystemHomeView,
  SystemSection,
  SystemState,
  SystemToken,
  SystemTopicId,
  TokenSection,
  TokenValue,
  TypeStyle,
} from './types.ts';

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

/** Every section, in board order. */
export const SYSTEM_SECTIONS: readonly SystemSection[] = Object.freeze(Object.keys(AREA_OF_SECTION) as SystemSection[]);

export const isSystemSection = (value: unknown): value is SystemSection =>
  typeof value === 'string' && Object.hasOwn(AREA_OF_SECTION, value);

/** The folder under the designs root that holds the systems (AD-1): `_` fails `SLUG_PATTERN`, so no design reader sees it. */
export const SYSTEMS_DIR = '_systems';

/** System ids that clash with `systemChoice` values (§2.7): never minted, and a folder by that name is not usable. */
export const RESERVED_SYSTEM_IDS: readonly string[] = Object.freeze(['none', 'ask']);

export const isReservedSystemId = (id: string): boolean => RESERVED_SYSTEM_IDS.includes(id.toLowerCase());

/** The whole-system sentence prefix (RS S1 states). */
export const SYSTEM_UNREADABLE_PREFIX = "Design Chamber can't read this design system.";

// ---- small readers ----

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An own property only: `__proto__`, `constructor` and friends never come from the prototype. */
const own = (object: JsonObject, key: string): JsonValue | undefined => (Object.hasOwn(object, key) ? object[key] : undefined);

const isIso = (value: unknown): value is IsoDate => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));

const hasControl = (text: string): boolean => /[\u0000-\u001f\u007f]/.test(text);

/** Text of 1..max characters with no control character (titles and names). */
const lineText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length >= 1 && value.length <= max && !hasControl(value) ? value.trim() : null;

/** A usage note: text up to `max` characters, line breaks allowed. Absent → ''. Null when present but invalid. */
const noteText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) return null;
  return value;
};

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// ---- system.json ----

/**
 * `system.json` (schema `design-chamber/system@1`, §2.3). `raw` keeps every key (null when the text is
 * not a JSON object or is over `SYSTEM_JSON_MAX_BYTES`); `unreadable` is the whole-file sentence then.
 */
export type ParsedSystemJson = { raw: JsonObject | null; problems: SystemProblem[]; unreadable: string | null };

const NOT_JSON = `${SYSTEM_UNREADABLE_PREFIX} system.json isn't valid JSON.`;
const TOO_LARGE_JSON = `${SYSTEM_UNREADABLE_PREFIX} system.json is larger than 1 MB.`;

/** The list keys of system.json; each must be a list when present. */
const LIST_KEYS = ['type', 'fonts', 'logos', 'components', 'notes', 'sources', 'patterns', 'brand', 'pairs', 'outOfScope'] as const;

export const parseSystemJson = (text: string): ParsedSystemJson => {
  // A cheap bound first: every UTF-16 unit is at most 3 UTF-8 bytes.
  if (text.length > SYSTEM_JSON_MAX_BYTES || (text.length * 3 > SYSTEM_JSON_MAX_BYTES && byteLength(text) > SYSTEM_JSON_MAX_BYTES)) {
    return { raw: null, problems: [], unreadable: TOO_LARGE_JSON };
  }
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch {
    return { raw: null, problems: [], unreadable: NOT_JSON };
  }
  if (!isObject(value)) return { raw: null, problems: [], unreadable: NOT_JSON };
  const problems: SystemProblem[] = [];
  const tokens = own(value, 'tokens');
  if (tokens !== undefined && !isObject(tokens)) problems.push({ entry: 'tokens', message: 'tokens in system.json is not a list of token notes, so it was skipped.' });
  for (const key of LIST_KEYS) {
    const list = own(value, key);
    if (list !== undefined && !Array.isArray(list)) problems.push({ entry: key, message: `${key} in system.json is not a list, so it was skipped.` });
  }
  return { raw: value, problems, unreadable: null };
};

/** A list key's entries (an absent or wrong-typed key reads as empty; parseSystemJson named the problem). */
const listOf = (raw: JsonObject | null, key: string): JsonValue[] => {
  const value = raw === null ? undefined : own(raw, key);
  return Array.isArray(value) ? value : [];
};

// ---- state.json ----

/** `acme-shop` → `Acme shop`: the name of a system whose state.json is missing (§2.5). */
export const humaniseSystemId = (id: string): string => {
  const words = id.replace(/-+/g, ' ').trim();
  if (words === '') return 'Design system';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, SYSTEM_NAME_MAX);
};

const REVIEW_STATES: readonly ReviewState[] = ['not-reviewed', 'looks-good', 'needs-work'];
const isReviewState = (value: unknown): value is ReviewState => typeof value === 'string' && (REVIEW_STATES as readonly string[]).includes(value);
const isHex64 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const stringList = (value: unknown, max: number, itemMax: number): string[] | null =>
  Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string' && item.length <= itemMax) ? (value as string[]) : null;

/** The review note cap (state.json `review.<s>.note`, PATCH body). */
export const SYSTEM_REVIEW_NOTE_MAX = 2000;

const parseReview = (value: unknown): SystemState['review'] => {
  const review: SystemState['review'] = {};
  if (!isObject(value)) return review;
  for (const section of SYSTEM_SECTIONS) {
    const entry = own(value, section);
    if (!isObject(entry)) continue;
    const state = own(entry, 'state');
    const fingerprint = own(entry, 'fingerprint');
    const at = own(entry, 'at');
    if (!isReviewState(state) || state === 'not-reviewed' || !isHex64(fingerprint) || !isIso(at)) continue;
    const note = own(entry, 'note');
    review[section] = { state, fingerprint, at, ...(typeof note === 'string' && note.length <= SYSTEM_REVIEW_NOTE_MAX ? { note } : {}) };
  }
  return review;
};

const parseFingerprintMap = (value: unknown): Partial<Record<SystemSection, string>> | null => {
  if (!isObject(value)) return null;
  const out: Partial<Record<SystemSection, string>> = {};
  for (const section of SYSTEM_SECTIONS) {
    const hex = own(value, section);
    if (isHex64(hex)) out[section] = hex;
  }
  return out;
};

/** state.json's `sources`, validated (also the undo record of a re-sync, §6.3). */
/** The scan's forAgent list kept in `sources.code` (≤ 20 files, like scan.json's). */
export const SOURCES_FOR_AGENT_MAX = 20;

const forAgentList = (value: unknown): { path: string; why: string }[] | null => {
  if (!Array.isArray(value)) return null;
  const out: { path: string; why: string }[] = [];
  for (const item of value.slice(0, SOURCES_FOR_AGENT_MAX)) {
    if (!isObject(item)) continue;
    const file = own(item, 'path');
    const why = own(item, 'why');
    if (typeof file === 'string' && file !== '' && file.length <= 4096 && typeof why === 'string' && why.length <= 300) out.push({ path: file, why });
  }
  return out;
};

const CANDIDATE_MARKS: readonly CandidateMark[] = ['page', 'tokens', 'docs', 'theme', 'components', 'contract'];
/** A project-relative path as a location or a read list holds it: `/`-separated, never absolute or climbing. */
const isProjectRel = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 4096 && !hasControl(value) && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split('/').includes('..') && !value.includes('\\');

/** `sources.code.existing` (Phase 2.6 §2.3): a location, its marks and ≤ 20 paths per kind; null when unusable. */
const existingSource = (value: unknown): NonNullable<NonNullable<SystemState['sources']['code']>['existing']> | null => {
  if (!isObject(value)) return null;
  const location = own(value, 'location');
  if (!isProjectRel(location)) return null;
  const rawMarks = own(value, 'marks');
  // Known marks only, each once, in the order written.
  const marks = Array.isArray(rawMarks) ? rawMarks.filter((mark, index): mark is CandidateMark => CANDIDATE_MARKS.includes(mark as CandidateMark) && rawMarks.indexOf(mark) === index) : [];
  const read = own(value, 'read');
  const list = (key: string): string[] => {
    const raw = isObject(read) ? own(read, key) : undefined;
    return Array.isArray(raw) ? raw.filter(isProjectRel).slice(0, LOCATION_READ_LIST_MAX) : [];
  };
  return { location, marks, read: { page: list('page'), docs: list('docs'), components: list('components') } };
};

export const parseSources = (value: unknown): SystemState['sources'] => {
  const sources: SystemState['sources'] = { code: null, brand: null, description: null };
  if (!isObject(value)) return sources;
  const code = own(value, 'code');
  if (isObject(code)) {
    const directory = own(code, 'directory');
    const lastScan = own(code, 'lastScan');
    const scanned = stringList(own(code, 'scanned'), 10_000, 4096) ?? [];
    if (typeof directory === 'string' && directory !== '' && isIso(lastScan)) {
      const forAgent = forAgentList(own(code, 'forAgent'));
      // Phase 2.6 AD-9: the project a location belongs to, and the existing system it holds.
      const project = own(code, 'project');
      const existing = existingSource(own(code, 'existing'));
      sources.code = {
        directory,
        lastScan,
        partial: own(code, 'partial') === true,
        scanned,
        ...(forAgent !== null ? { forAgent } : {}),
        ...(isAbsPath(project) ? { project } : {}),
        ...(existing !== null ? { existing } : {}),
      };
    }
  }
  const brand = own(value, 'brand');
  if (isObject(brand)) sources.brand = { files: stringList(own(brand, 'files'), 1000, 300) ?? [] };
  const description = own(value, 'description');
  if (isObject(description)) {
    const text = own(description, 'text');
    const preset = own(description, 'preset');
    if (typeof text === 'string' && text.length <= 2000) sources.description = { text, preset: typeof preset === 'string' ? preset : null };
  }
  return sources;
};

/** state.json's `provenance`, validated (also the undo record of a re-sync, §6.3). */
export const parseProvenance = (value: unknown): SystemState['provenance'] => {
  const out: SystemState['provenance'] = {};
  if (!isObject(value)) return out;
  for (const name of Object.keys(value)) {
    if (!SYSTEM_TOKEN_NAME_PATTERN.test(name)) continue;
    const entry = own(value, name);
    if (!isObject(entry)) continue;
    const file = own(entry, 'file');
    const line = own(entry, 'line');
    const light = own(entry, 'light');
    const dark = own(entry, 'dark');
    if (typeof file !== 'string' || typeof line !== 'number' || !Number.isInteger(line)) continue;
    out[name] = { file, line, light: typeof light === 'string' ? light : null, dark: typeof dark === 'string' ? dark : null };
  }
  return out;
};

/**
 * An absolute folder path as state.json may hold it (§2.5): ≤ 4 096 characters, no control character,
 * POSIX or a win32 drive. A UNC path is never one: `validateScanFolder` refuses it at adoption, so a
 * state.json holding one is damaged or forged and reads as no home.
 */
/** An absolute POSIX or drive path; a UNC or device path (`\\x`, `//x`, either slash mix) never is. */
const isAbsPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 4096 &&
  !hasControl(value) &&
  !/^[\\/]{2}/.test(value) &&
  (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));

const parseHome = (value: unknown): SystemState['home'] | undefined => {
  if (!isObject(value)) return undefined;
  const kind = own(value, 'kind');
  if (kind === 'internal') return { kind: 'internal' };
  if (kind !== 'repo') return undefined;
  const directory = own(value, 'directory');
  const folder = own(value, 'folder');
  const livingPage = own(value, 'livingPage');
  const adoptedAt = own(value, 'adoptedAt');
  // The repo home's paths are validated here too (T12b): state.json is agent-reachable, and every
  // reader (filesDir, reveal, the snapshot) builds paths from these fields.
  if (!isAbsPath(directory) || typeof folder !== 'string' || !REPO_REL_PATTERN.test(folder)) return undefined;
  if (typeof livingPage !== 'string' || !REPO_REL_PATTERN.test(livingPage) || !livingPage.endsWith('.html') || !isIso(adoptedAt)) return undefined;
  return { kind: 'repo', directory, folder, livingPage, adoptedAt };
};

/**
 * state.json's `build` (§5.9, adoption writes it; Stop reads `appliedSeen`): the ticket the system was
 * started from, when it was adopted, the `applied` stamp acted on, and (rev 3) the ticket's project folder.
 * `approved` is T17's and kept when it is an object or null. Anything else drops the record (undefined).
 */
export const parseBuildState = (value: unknown): SystemState['build'] | undefined => {
  if (!isObject(value)) return undefined;
  const ticket = own(value, 'ticket');
  const adoptedAt = own(value, 'adoptedAt');
  const appliedSeen = own(value, 'appliedSeen');
  const projectDirectory = own(value, 'projectDirectory');
  const approved = own(value, 'approved');
  if (ticket !== null && (typeof ticket !== 'string' || !SYSTEM_BUILD_TICKET_PATTERN.test(ticket))) return undefined;
  if (!isIso(adoptedAt) || (appliedSeen !== null && !isIso(appliedSeen))) return undefined;
  // The project folder outlives the ticket (AD-28) and every home re-verification compares against it.
  if (projectDirectory !== undefined && projectDirectory !== null && !isAbsPath(projectDirectory)) return undefined;
  return {
    ticket,
    adoptedAt,
    appliedSeen,
    ...(projectDirectory === undefined ? {} : { projectDirectory }),
    // Safe: `approved` is service-written; T17 validates it in depth before reading it.
    ...(approved === null || isObject(approved) ? { approved: approved as NonNullable<SystemState['build']>['approved'] } : {}),
  };
};

/**
 * `<system>/.chamber/state.json` (schema `design-chamber/system-state@1`, §2.5). A missing or broken file
 * gives a provisional state (name from the id humanised, Draft, revision 0), written on the first service write.
 * Service-owned fields T12b and later add (`build`, `snapshot`, …) are kept when they are objects of the
 * right outline; their own tasks validate them in depth.
 */
export const parseSystemState = (raw: unknown, id: string, now: IsoDate): SystemState => {
  const provisional: SystemState = {
    v: 1,
    id,
    name: humaniseSystemId(id),
    created: now,
    updated: now,
    status: 'draft',
    sessionId: null,
    revision: { n: 0, treeHash: '', at: now },
    review: {},
    readyFingerprints: null,
    sources: { code: null, brand: null, description: null },
    provenance: {},
    handEditsSeq: 0,
  };
  if (!isObject(raw)) return provisional;
  const name = lineText(own(raw, 'name'), SYSTEM_NAME_MAX);
  const created = own(raw, 'created');
  const updated = own(raw, 'updated');
  const sessionId = own(raw, 'sessionId');
  const revision = own(raw, 'revision');
  const handEditsSeq = own(raw, 'handEditsSeq');
  const state: SystemState = {
    ...provisional,
    // The folder name is the id; a state.json naming another id is a copied folder and keeps this one.
    name: name ?? provisional.name,
    created: isIso(created) ? created : now,
    updated: isIso(updated) ? updated : isIso(created) ? created : now,
    status: own(raw, 'status') === 'ready' ? 'ready' : 'draft',
    sessionId: typeof sessionId === 'string' && sessionId !== '' && sessionId.length <= 128 ? sessionId : null,
    revision:
      isObject(revision) && typeof own(revision, 'n') === 'number' && Number.isInteger(own(revision, 'n')) && (own(revision, 'n') as number) >= 0
        ? {
            n: own(revision, 'n') as number,
            treeHash: isHex64(own(revision, 'treeHash')) ? (own(revision, 'treeHash') as string) : '',
            at: isIso(own(revision, 'at')) ? (own(revision, 'at') as string) : now,
          }
        : provisional.revision,
    review: parseReview(own(raw, 'review')),
    readyFingerprints: parseFingerprintMap(own(raw, 'readyFingerprints')),
    sources: parseSources(own(raw, 'sources')),
    provenance: parseProvenance(own(raw, 'provenance')),
    handEditsSeq: typeof handEditsSeq === 'number' && Number.isInteger(handEditsSeq) && handEditsSeq >= 0 ? handEditsSeq : 0,
  };
  const home = parseHome(own(raw, 'home'));
  if (home !== undefined) state.home = home;
  const snapshot = own(raw, 'snapshot');
  if (isObject(snapshot)) {
    const at = own(snapshot, 'at');
    const by = own(snapshot, 'by');
    const treeHash = own(snapshot, 'treeHash');
    if (isIso(at) && (by === 'agent' || by === 'user') && isHex64(treeHash)) state.snapshot = { at, by, treeHash, tampered: own(snapshot, 'tampered') === true };
  }
  const codeDrift = own(raw, 'codeDrift');
  if (isObject(codeDrift)) {
    const at = own(codeDrift, 'at');
    const mode = own(codeDrift, 'mode');
    const differ = own(codeDrift, 'differ');
    const names = stringList(own(codeDrift, 'names'), 200, 61);
    const unread = stringList(own(codeDrift, 'unread'), 200, 300);
    if (isIso(at) && (mode === 'fix' || mode === 'describe') && typeof differ === 'number' && Number.isInteger(differ) && differ >= 0 && names !== null) {
      state.codeDrift = { at, mode, differ, names, partial: own(codeDrift, 'partial') === true, ...(unread !== null ? { unread } : {}) };
    }
  }
  const landed = own(raw, 'landed');
  if (isObject(landed)) {
    const proposal = own(landed, 'proposal');
    const differ = stringList(own(landed, 'differ'), 20, 300);
    const unclaimed = stringList(own(landed, 'unclaimed'), 20, 300);
    if (typeof proposal === 'string' && proposal.length <= 40 && differ !== null && unclaimed !== null) {
      state.landed = { proposal, matches: own(landed, 'matches') === true, differ, unclaimed };
    }
  }
  const build = parseBuildState(own(raw, 'build'));
  if (build !== undefined) state.build = build;
  // Service-owned S8 records the detail does not read yet: kept as the service wrote them (objects
  // only), so a T1 write never drops them; their own tasks (T12b, T14) validate them in depth.
  const passThrough = ['buildProblem', 'repoProblem', 'livingPage'] as const;
  for (const key of passThrough) {
    const value = own(raw, key);
    // Safe: these keys are written only by the service, and nothing reads them before their tasks validate them.
    if (value === null || isObject(value)) (state as Record<string, unknown>)[key] = value;
  }
  return state;
};

// ---- coverage ----

const COVERAGE_PROBLEM = "coverage in system.json can't be read, so all four areas are shown.";

/** The covered areas (§2.11): absent → all four; invalid → all four with the problem sentence. */
export const coveredAreas = (raw: JsonObject | null): { areas: SystemArea[]; problem: string | null } => {
  const value = raw === null ? undefined : own(raw, 'coverage');
  if (value === undefined) return { areas: [...SYSTEM_AREAS], problem: null };
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > SYSTEM_AREAS.length ||
    !value.every((area) => typeof area === 'string' && (SYSTEM_AREAS as readonly string[]).includes(area)) ||
    new Set(value).size !== value.length
  ) {
    return { areas: [...SYSTEM_AREAS], problem: COVERAGE_PROBLEM };
  }
  const chosen = new Set(value as string[]);
  return { areas: SYSTEM_AREAS.filter((area) => chosen.has(area)), problem: null };
};

// ---- board layout hints (documentation/specs/system-board-layout-and-visual-check.md §A) ----

/** The closed set of board layouts; `card` is the default. */
export const BOARD_LAYOUTS: readonly BoardLayout[] = Object.freeze(['card', 'compact', 'full', 'table']);

export const isBoardLayout = (value: unknown): value is BoardLayout => typeof value === 'string' && (BOARD_LAYOUTS as readonly string[]).includes(value);

/** Which layouts each section takes; a section absent here (typography, layers, assets) takes none. */
export const LAYOUTS_OF_SECTION: Readonly<Partial<Record<SystemSection, readonly BoardLayout[]>>> = Object.freeze({
  components: BOARD_LAYOUTS,
  overview: BOARD_LAYOUTS,
  patterns: BOARD_LAYOUTS,
  brand: BOARD_LAYOUTS,
  colours: Object.freeze(['card', 'compact', 'table'] as const),
  spacing: Object.freeze(['card', 'compact', 'table'] as const),
  radius: Object.freeze(['card', 'compact', 'table'] as const),
  shadows: Object.freeze(['card', 'compact', 'table'] as const),
  sizes: Object.freeze(['card', 'compact', 'table'] as const),
});

/** Ignored hints as the detail carries them: the list is capped, the count is the true total. */
export type LayoutIgnoredSink = { ignored: SystemDetail['boardLayout']['ignored']; ignoredCount: number };

const noteIgnored = (sink: LayoutIgnoredSink, record: SystemDetail['boardLayout']['ignored'][number]): void => {
  sink.ignoredCount += 1;
  if (sink.ignored.length < SYSTEM_LAYOUT_PROBLEMS_MAX) sink.ignored.push(record);
};

/**
 * An ignored hint's value as text: a string cleaned to one line and clipped (the same cleaning
 * `cleanDetail` applies, kept here so this file imports nothing from checks.ts), else the JSON type
 * name. Never the raw value: it is agent text shown as data.
 */
const layoutValueText = (value: JsonValue): string => {
  if (typeof value !== 'string') return Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim();
  return flat.length <= BOARD_LAYOUT_TEXT_MAX ? flat : `${flat.slice(0, Math.max(0, BOARD_LAYOUT_TEXT_MAX - 1)).trimEnd()}…`;
};

/**
 * One entry's `layout` hint: absent or null → null (the section default applies); a value in
 * `BOARD_LAYOUTS` → it; anything else → null plus one ignored record. Never drops the entry, never
 * pushes to `problems`: the entry itself is fine, only the hint is ignored.
 */
export const readItemLayout = (value: JsonValue | undefined, entry: string, sink: LayoutIgnoredSink): BoardLayout | null => {
  if (value === undefined || value === null) return null;
  if (isBoardLayout(value)) return value;
  noteIgnored(sink, { entry, value: layoutValueText(value), reason: 'unknown' });
  return null;
};

/**
 * The top-level `layout` object of section defaults. Absent → {}; not an object → one ignored record;
 * each own key: an unknown section → `unknown`, a layout the section does not take → `not-here`, a
 * value that is no layout at all → `unknown`. Own keys only, so `__proto__` is an ordinary ignored key.
 */
export const readSectionLayouts = (raw: JsonObject | null, sink: LayoutIgnoredSink): Partial<Record<SystemSection, BoardLayout>> => {
  const out: Partial<Record<SystemSection, BoardLayout>> = {};
  const value = raw === null ? undefined : own(raw, 'layout');
  if (value === undefined) return out;
  if (!isObject(value)) {
    noteIgnored(sink, { entry: 'layout', value: layoutValueText(value), reason: 'unknown' });
    return out;
  }
  for (const key of Object.keys(value)) {
    const entryValue = own(value, key) ?? null;
    const alias = Object.hasOwn(SECTION_LAYOUT_ALIASES, key) ? SECTION_LAYOUT_ALIASES[key] : undefined;
    if (alias !== undefined) {
      if (!isBoardLayout(entryValue) || LAYOUTS_OF_SECTION[alias]?.includes(entryValue) !== true) {
        noteIgnored(sink, { entry: `layout.${key}`, value: layoutValueText(entryValue), reason: isBoardLayout(entryValue) ? 'not-here' : 'unknown' });
      } else if (own(value, alias) === undefined) {
        out[alias] = entryValue;
      }
      continue;
    }
    if (!isSystemSection(key)) {
      const shown = key.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, 40);
      noteIgnored(sink, { entry: `layout.${shown}`, value: layoutValueText(entryValue), reason: 'unknown' });
      continue;
    }
    const allowed = LAYOUTS_OF_SECTION[key];
    if (isBoardLayout(entryValue)) {
      if (allowed !== undefined && allowed.includes(entryValue)) out[key] = entryValue;
      else noteIgnored(sink, { entry: `layout.${key}`, value: entryValue, reason: 'not-here' });
    } else {
      noteIgnored(sink, { entry: `layout.${key}`, value: layoutValueText(entryValue), reason: 'unknown' });
    }
  }
  return out;
};

/** `notes` is another name for the `overview` section default (notes are listed under `notes[]`); an explicit `overview` wins. */
const SECTION_LAYOUT_ALIASES: Readonly<Record<string, SystemSection>> = Object.freeze({ notes: 'overview' });

const orList = (values: readonly string[]): string => (values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1] ?? ''}`);

/**
 * What the place an ignored hint was written in takes, for the check's detail (one short phrase):
 * `layout.typography` → "typography takes no layout", `components.table` → "takes card, compact, full or table".
 */
export const layoutPlaceTakes = (entry: string): string => {
  if (entry === 'layout') return 'layout must be an object of section defaults';
  if (entry.startsWith('layout.')) {
    const key = entry.slice('layout.'.length);
    const section = isSystemSection(key) ? key : Object.hasOwn(SECTION_LAYOUT_ALIASES, key) ? SECTION_LAYOUT_ALIASES[key] : undefined;
    if (section === undefined) return 'not a section that takes a layout';
    const allowed = LAYOUTS_OF_SECTION[section];
    return allowed === undefined ? `${key} takes no layout` : `takes ${orList(allowed)}`;
  }
  return `takes ${orList(BOARD_LAYOUTS)}`;
};

/** An entry's effective layout: its own valid hint, else the section's valid default, else `card`. */
export const effectiveLayout = (detail: SystemDetail, section: SystemSection, itemLayout: BoardLayout | null): BoardLayout =>
  itemLayout ?? detail.boardLayout.sections[section] ?? 'card';

// ---- the detail ----

/** What `buildSystemDetail` reads: one system's files as the store found them (§5.1 `SystemRecord`). */
export type SystemDetailSource = {
  id: string;
  /** The system folder (`_systems/<id>`), shown as the path. */
  dir: string;
  /** The content root the files were read from (§5.1): `dir` internal, `dir/snapshot` repo-backed. */
  filesDir?: string;
  state: SystemState;
  systemJson: string | null;
  tokensCss: string | null;
  /** Text files by contract-relative path (`OVERVIEW.md`, `notes/<id>.md`, …). */
  texts: Record<string, string>;
  /** Every file under the system's content set, contract-relative, with its size. */
  files: { rel: string; bytes: number }[];
  /** The content set's tree hash as the walk computed it (adoption records it, §5.9). */
  treeHash?: string;
  build: BuildJson | null;
  /**
   * sha256 of the raw bytes of content files, by contract-relative path (the edit stamps and the
   * fingerprints' file hashes). A file missing here is hashed from its text when the text is known.
   */
  hashes?: Record<string, string>;
  /** Content files over their read cap, so their text was not read (`tokens.css`, `system.json`, bodies). */
  tooLarge?: string[];
};

/** The token rules `buildSystemDetail` applies (§2.4); `token-edit.ts` provides the real ones (T3). */
export type SystemTokenRules = {
  isLight(ctx: TokenContext): boolean;
  isDark(ctx: TokenContext): boolean;
  classify(name: string, value: string): TokenSection;
  validate(section: TokenSection, field: TypeField | null, text: string): ValueCheck;
};

export const SYSTEM_TOKEN_RULES: SystemTokenRules = Object.freeze({
  isLight: (ctx: TokenContext) => isLightContext(ctx, 'system'),
  isDark: (ctx: TokenContext) => isDarkContext(ctx, 'system'),
  classify: classifyToken,
  validate: validateTokenValue,
});

const TOKEN_SECTIONS: readonly TokenSection[] = ['colours', 'typography', 'spacing', 'radius', 'shadows', 'layers', 'sizes', 'other'];
const isTokenSection = (value: unknown): value is TokenSection => typeof value === 'string' && (TOKEN_SECTIONS as readonly string[]).includes(value);
const COLOUR_GROUPS: readonly ColourGroup[] = ['brand', 'surface', 'text', 'border', 'status', 'data', 'other'];
const isColourGroup = (value: unknown): value is ColourGroup => typeof value === 'string' && (COLOUR_GROUPS as readonly string[]).includes(value);

/** Characters of a value kept for display; longer values are already invalid (`SYSTEM_TOKEN_VALUE_MAX`). */
const VALUE_SHOWN_MAX = 200;
const FORMULA_SENTENCE = 'This value is a formula. Ask the agent to change it.';
const UNREADABLE_VALUE = "This value can't be read.";
const TOKENS_CAP_SENTENCE = "Design systems hold up to 2 000 tokens. The rest weren't read.";

type TokenMeta = { section: TokenSection | null; group: ColourGroup | null; note: string; breakpoint: boolean | null };

const readTokenMeta = (raw: JsonObject | null, problems: SystemProblem[]): Map<string, TokenMeta> => {
  const out = new Map<string, TokenMeta>();
  const map = raw === null ? undefined : own(raw, 'tokens');
  if (!isObject(map)) return out;
  for (const name of Object.keys(map)) {
    const entry = `tokens.${name.slice(0, 64)}`;
    if (!SYSTEM_TOKEN_NAME_PATTERN.test(name)) {
      problems.push({ entry, message: "This isn't a token name design systems use." });
      continue;
    }
    const value = own(map, name);
    if (!isObject(value)) {
      problems.push({ entry, message: 'The notes for this token are not an object.' });
      continue;
    }
    const section = own(value, 'section');
    const group = own(value, 'group');
    const note = noteText(own(value, 'note'), SYSTEM_USAGE_NOTE_MAX);
    const breakpoint = own(value, 'breakpoint');
    if (section !== undefined && !isTokenSection(section)) problems.push({ entry, message: "Its section isn't one design systems use." });
    if (group !== undefined && !isColourGroup(group)) problems.push({ entry, message: "Its colour group isn't one design systems use." });
    if (note === null) problems.push({ entry, message: 'Its note is longer than 500 characters.' });
    out.set(name, {
      section: isTokenSection(section) ? section : null,
      group: isColourGroup(group) ? group : null,
      note: note ?? '',
      breakpoint: typeof breakpoint === 'boolean' ? breakpoint : null,
    });
  }
  return out;
};

const contextLabel = (ctx: TokenContext): string => (ctx.kind === 'root' ? ':root' : ctx.label);

const tokenValueOf = (css: string, declaration: Declaration, section: TokenSection, rules: SystemTokenRules): TokenValue => {
  const text = css.slice(declaration.from, declaration.to).slice(0, VALUE_SHOWN_MAX);
  if (declaration.important || declaration.comment || declaration.broken) return { text, editable: 'unreadable', problem: UNREADABLE_VALUE };
  const check = rules.validate(section, null, text);
  if (!check.ok) return { text, editable: 'unreadable', problem: check.sentence };
  return check.formula ? { text, editable: 'formula', problem: FORMULA_SENTENCE } : { text, editable: 'ok', problem: null };
};

const BREAKPOINT_NAME = /^--(bp|breakpoint|screen)-/;

const readTokens = (
  css: string | null,
  meta: Map<string, TokenMeta>,
  provenance: SystemState['provenance'],
  rules: SystemTokenRules,
  problems: SystemProblem[],
): SystemToken[] => {
  const all = css === null ? [] : scanTokens(css);
  const declarations = all.length > SYSTEM_TOKENS_MAX ? all.slice(0, SYSTEM_TOKENS_MAX) : all;
  if (all.length > SYSTEM_TOKENS_MAX) problems.push({ entry: 'tokens.css', message: TOKENS_CAP_SENTENCE });

  const byName = new Map<string, Declaration[]>();
  for (const declaration of declarations) {
    if (!SYSTEM_TOKEN_NAME_PATTERN.test(declaration.name)) continue;
    const list = byName.get(declaration.name);
    if (list === undefined) byName.set(declaration.name, [declaration]);
    else list.push(declaration);
  }

  const tokens: SystemToken[] = [];
  for (const [name, list] of byName) {
    const light = list.filter((one) => rules.isLight(one.context)).at(-1) ?? null;
    const dark = list.filter((one) => rules.isDark(one.context)).at(-1) ?? null;
    const alsoSet: string[] = [];
    for (const one of list) {
      if (one === light || one === dark || rules.isLight(one.context) || rules.isDark(one.context)) continue;
      const label = contextLabel(one.context);
      if (!alsoSet.includes(label) && alsoSet.length < ALSO_SET_MAX) alsoSet.push(label);
    }
    const entry = meta.get(name);
    const first = light ?? dark;
    // `css` is non-null here: declarations only come from a scanned file.
    const firstText = first === null || css === null ? '' : css.slice(first.from, first.to);
    const section = entry?.section ?? (first === null ? 'other' : rules.classify(name, firstText));
    const lightValue = light === null || css === null ? null : tokenValueOf(css, light, section, rules);
    const darkValue = dark === null || css === null ? null : tokenValueOf(css, dark, section, rules);
    tokens.push({
      name,
      section,
      group: section === 'colours' ? entry?.group ?? 'other' : null,
      light: lightValue,
      dark: darkValue,
      note: entry?.note ?? '',
      breakpoint: section === 'sizes' ? entry?.breakpoint ?? (BREAKPOINT_NAME.test(name) && /px$/.test((lightValue ?? darkValue)?.text ?? '')) : false,
      alsoSet,
      fromCode: Object.hasOwn(provenance, name),
      problem:
        lightValue === null && darkValue === null
          ? `No value for ${name} in tokens.css.`
          : lightValue === null
            ? 'Only a dark value is set.'
            : null,
    });
  }
  // Notes for names tokens.css does not define are kept and shown (§2.3).
  for (const [name, entry] of meta) {
    if (byName.has(name)) continue;
    tokens.push({
      name,
      section: entry.section ?? 'other',
      group: entry.section === 'colours' ? entry.group ?? 'other' : null,
      light: null,
      dark: null,
      note: entry.note,
      breakpoint: false,
      alsoSet: [],
      fromCode: Object.hasOwn(provenance, name),
      problem: `No value for ${name} in tokens.css.`,
    });
  }
  return tokens;
};

const entryLabel = (key: string, index: number, id: unknown): string =>
  typeof id === 'string' && id.length <= 40 ? `${key}.${id}` : `${key}[${index}]`;

const TYPE_FIELDS: readonly TypeField[] = ['family', 'size', 'weight', 'lineHeight', 'letterSpacing'];
const TYPE_CASES: readonly TypeStyle['case'][] = ['none', 'upper', 'lower', 'title'];

const readTypeStyles = (raw: JsonObject | null, rules: SystemTokenRules, problems: SystemProblem[]): TypeStyle[] => {
  const out: TypeStyle[] = [];
  const seen = new Set<string>();
  listOf(raw, 'type').forEach((value, index) => {
    if (!isObject(value)) return void problems.push({ entry: `type[${index}]`, message: 'This type style is not an object.' });
    const id = own(value, 'id');
    const entry = entryLabel('type', index, id);
    if (out.length >= SYSTEM_TYPE_STYLES_MAX) return void problems.push({ entry, message: 'Design systems hold up to 60 type styles.' });
    if (typeof id !== 'string' || !SYSTEM_ENTRY_ID_PATTERN.test(id) || seen.has(id)) return void problems.push({ entry, message: 'This type style needs its own id: lower-case letters, digits and dashes.' });
    const name = lineText(own(value, 'name'), 60);
    if (name === null) return void problems.push({ entry, message: 'This type style needs a name of 1 to 60 characters.' });
    const note = noteText(own(value, 'note'), SYSTEM_USAGE_NOTE_MAX);
    if (note === null) problems.push({ entry, message: 'Its note is longer than 500 characters.' });
    const style: TypeStyle = { id, name, family: '', size: '', weight: '', lineHeight: '', letterSpacing: '', case: 'none', note: note ?? '' };
    for (const field of TYPE_FIELDS) {
      const fieldValue = own(value, field);
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') continue;
      const text = typeof fieldValue === 'number' ? String(fieldValue) : fieldValue;
      if (typeof text !== 'string') {
        problems.push({ entry, message: `Its ${field} isn't a value design systems use.` });
        continue;
      }
      const check = rules.validate('typography', field, text);
      if (!check.ok) {
        problems.push({ entry, message: check.sentence });
        continue;
      }
      style[field] = text;
    }
    const letterCase = own(value, 'case');
    if (letterCase !== undefined && !(TYPE_CASES as readonly unknown[]).includes(letterCase)) problems.push({ entry, message: 'Its case must be none, upper, lower or title.' });
    else if (letterCase !== undefined) style.case = letterCase as TypeStyle['case'];
    seen.add(id);
    out.push(style);
  });
  return out;
};

const FONT_FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const LOGO_VARIANT_PATTERN = /^[a-z0-9][a-z0-9 -]{0,39}$/;
/** A file name inside one contract folder: the `safeAssetName` alphabet, no leading dot or dash. */
const SAFE_FILE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,79}$/;

const assetFile = (value: unknown, folder: string): string | null => {
  if (typeof value !== 'string' || !value.startsWith(`${folder}/`)) return null;
  const name = value.slice(folder.length + 1);
  return SAFE_FILE_PATTERN.test(name) && !name.includes('..') ? value : null;
};

const readFonts = (raw: JsonObject | null, files: ReadonlySet<string>, problems: SystemProblem[]): FontAsset[] => {
  const out: FontAsset[] = [];
  listOf(raw, 'fonts').forEach((value, index) => {
    const entry = `fonts[${index}]`;
    if (!isObject(value)) return void problems.push({ entry, message: 'This font is not an object.' });
    const file = assetFile(own(value, 'file'), 'assets/fonts');
    if (file === null) return void problems.push({ entry, message: 'A font file must be in assets/fonts/.' });
    if (!files.has(file)) return void problems.push({ entry, message: `${file} is missing.` });
    const family = own(value, 'family');
    if (typeof family !== 'string' || !FONT_FAMILY_PATTERN.test(family)) return void problems.push({ entry, message: 'This font needs a family name of letters, digits, spaces and dashes.' });
    const weight = own(value, 'weight') ?? 400;
    if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1 || weight > 1000) return void problems.push({ entry, message: 'Its weight must be a whole number from 1 to 1000.' });
    const style = own(value, 'style') ?? 'normal';
    if (style !== 'normal' && style !== 'italic') return void problems.push({ entry, message: 'Its style must be normal or italic.' });
    out.push({ file, family, weight, style });
  });
  return out;
};

const readLogos = (raw: JsonObject | null, files: ReadonlySet<string>, problems: SystemProblem[]): LogoAsset[] => {
  const out: LogoAsset[] = [];
  listOf(raw, 'logos').forEach((value, index) => {
    const entry = `logos[${index}]`;
    if (!isObject(value)) return void problems.push({ entry, message: 'This logo is not an object.' });
    const file = assetFile(own(value, 'file'), 'assets/logos');
    if (file === null) return void problems.push({ entry, message: 'A logo file must be in assets/logos/.' });
    if (!files.has(file)) return void problems.push({ entry, message: `${file} is missing.` });
    const variant = own(value, 'variant') ?? 'primary';
    if (typeof variant !== 'string' || !LOGO_VARIANT_PATTERN.test(variant)) return void problems.push({ entry, message: 'Its variant must be lower-case words, like primary or mark.' });
    const note = noteText(own(value, 'note'), SYSTEM_USAGE_NOTE_MAX);
    if (note === null) return void problems.push({ entry, message: 'Its note is longer than 500 characters.' });
    out.push({ file, variant, note });
  });
  return out;
};

const readSourceFiles = (raw: JsonObject | null, sizes: ReadonlyMap<string, number>, problems: SystemProblem[]): { file: string; bytes: number }[] => {
  const out: { file: string; bytes: number }[] = [];
  listOf(raw, 'sources').forEach((value, index) => {
    const entry = `sources[${index}]`;
    const file = isObject(value) ? assetFile(own(value, 'file'), 'sources') : null;
    if (file === null) return void problems.push({ entry, message: 'A source file must be in sources/.' });
    const bytes = sizes.get(file);
    if (bytes === undefined) return void problems.push({ entry, message: `${file} is missing.` });
    out.push({ file, bytes });
  });
  return out;
};

const shortList = (value: unknown, max: number, itemMax: number): string[] | null => {
  if (value === undefined || value === null) return [];
  return stringList(value, max, itemMax);
};

/**
 * An entry's `example`: absent or null → none; exactly `<folder>/<id>.html` and present → an example
 * (its remote refs are found while the board bundles it); anything else → none plus a problem on the
 * entry, which itself stays (components since T6, pattern and brand entries since system-builder-depth D4).
 */
const readExample = (
  value: JsonValue | undefined,
  folder: 'components' | 'patterns' | 'brand',
  id: string,
  files: ReadonlySet<string>,
  entry: string,
  problems: SystemProblem[],
): { remote: string[] } | null => {
  if (value === undefined || value === null) return null;
  const expected = `${folder}/${id}.html`;
  if (value !== expected) problems.push({ entry, message: `Its example must be ${expected}.` });
  else if (!files.has(expected)) problems.push({ entry, message: `${expected} is missing.` });
  else return { remote: [] };
  return null;
};

const readComponents = (
  raw: JsonObject | null,
  files: ReadonlySet<string>,
  defined: ReadonlySet<string>,
  problems: SystemProblem[],
  layoutSink: LayoutIgnoredSink,
): SystemComponent[] => {
  const out: SystemComponent[] = [];
  const seen = new Set<string>();
  listOf(raw, 'components').forEach((value, index) => {
    if (!isObject(value)) return void problems.push({ entry: `components[${index}]`, message: 'This component is not an object.' });
    const id = own(value, 'id');
    const entry = entryLabel('components', index, id);
    if (out.length >= SYSTEM_COMPONENTS_MAX) return void problems.push({ entry, message: 'Design systems hold up to 200 components.' });
    if (typeof id !== 'string' || !SYSTEM_ENTRY_ID_PATTERN.test(id) || seen.has(id)) return void problems.push({ entry, message: 'This component needs its own id: lower-case letters, digits and dashes.' });
    const name = lineText(own(value, 'name'), 60);
    if (name === null) return void problems.push({ entry, message: 'This component needs a name of 1 to 60 characters.' });
    const purpose = noteText(own(value, 'purpose'), SYSTEM_USAGE_NOTE_MAX);
    const note = noteText(own(value, 'note'), SYSTEM_USAGE_NOTE_MAX);
    const variants = shortList(own(value, 'variants'), 20, 40);
    const sizes = shortList(own(value, 'sizes'), SYSTEM_COMPONENT_SIZES_MAX, 40);
    const states = shortList(own(value, 'states'), 20, 40);
    const tokenNames = shortList(own(value, 'tokens'), 40, 61);
    const source = own(value, 'source');
    if (purpose === null || note === null) return void problems.push({ entry, message: 'Its purpose and note can each be up to 500 characters.' });
    if (variants === null || states === null) return void problems.push({ entry, message: 'Variants and states are lists of up to 20 short names.' });
    if (sizes === null) return void problems.push({ entry, message: 'Sizes is a list of up to 10 short names.' });
    if (tokenNames === null || !tokenNames.every((token) => SYSTEM_TOKEN_NAME_PATTERN.test(token))) return void problems.push({ entry, message: 'Its tokens must be a list of up to 40 token names.' });
    if (source !== undefined && source !== null && (typeof source !== 'string' || source.length > 300)) return void problems.push({ entry, message: 'Its source is text of up to 300 characters.' });
    const layout = readItemLayout(own(value, 'layout'), entry, layoutSink);
    const example = readExample(own(value, 'example'), 'components', id, files, entry, problems);
    seen.add(id);
    out.push({
      id,
      name,
      purpose,
      note,
      variants,
      sizes,
      states,
      tokens: tokenNames,
      source: typeof source === 'string' && source !== '' ? source : null,
      example,
      undefinedTokens: tokenNames.filter((token) => !defined.has(token)),
      layout,
    });
  });
  return out;
};

/** `20000` → `20 000`, as the sentences write numbers. */
const groupDigits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** A body file's text and problem: absent → missing; over the cap → the start is shown with the sentence. */
const bodyOf = (rel: string, texts: Readonly<Record<string, string>>, tooLarge: ReadonlySet<string>, max: number, required: boolean): { text: string | null; problem: string | null } => {
  if (tooLarge.has(rel)) return { text: null, problem: `${rel} is too large to show.` };
  if (!Object.hasOwn(texts, rel)) return { text: required ? '' : null, problem: required ? `${rel} is missing.` : null };
  const text = texts[rel] ?? '';
  if (text.includes('\u0000')) return { text: null, problem: `${rel} isn't a text file.` };
  if (text.length > max) return { text: text.slice(0, max), problem: `${rel} is longer than ${groupDigits(max)} characters. Only the start is shown.` };
  return { text, problem: null };
};

const readNotes = (raw: JsonObject | null, texts: Readonly<Record<string, string>>, tooLarge: ReadonlySet<string>, problems: SystemProblem[], layoutSink: LayoutIgnoredSink): SystemDetail['notes'] => {
  const out: SystemDetail['notes'] = [];
  const seen = new Set<string>();
  listOf(raw, 'notes').forEach((value, index) => {
    if (!isObject(value)) return void problems.push({ entry: `notes[${index}]`, message: 'This note is not an object.' });
    const id = own(value, 'id');
    const entry = entryLabel('notes', index, id);
    if (out.length >= SYSTEM_NOTES_MAX) return void problems.push({ entry, message: 'Design systems hold up to 50 notes.' });
    if (typeof id !== 'string' || !SYSTEM_ENTRY_ID_PATTERN.test(id) || seen.has(id)) return void problems.push({ entry, message: 'This note needs its own id: lower-case letters, digits and dashes.' });
    const title = lineText(own(value, 'title'), 80);
    if (title === null) return void problems.push({ entry, message: 'This note needs a title of 1 to 80 characters.' });
    const body = bodyOf(`notes/${id}.md`, texts, tooLarge, SYSTEM_NOTE_MAX, true);
    const layout = readItemLayout(own(value, 'layout'), entry, layoutSink);
    seen.add(id);
    out.push({ id, title, text: body.text ?? '', problem: body.problem, layout });
  });
  return out;
};

/** The closed kind lists (system-builder-depth §4.3 adds the second half of each). */
export const ENTRY_KINDS: Readonly<Record<'patterns' | 'brand', readonly string[]>> = Object.freeze({
  patterns: Object.freeze([
    'layout', 'do-dont', 'voice', 'other',
    'navigation', 'overlay', 'forms', 'data-display', 'feedback', 'states', 'page', 'responsive', 'motion', 'accessibility',
  ]),
  brand: Object.freeze(['marketing', 'imagery', 'logo-use', 'other', 'colour', 'social', 'email']),
});

const readEntryTexts = (
  key: 'patterns' | 'brand',
  raw: JsonObject | null,
  files: ReadonlySet<string>,
  texts: Readonly<Record<string, string>>,
  tooLarge: ReadonlySet<string>,
  problems: SystemProblem[],
  layoutSink: LayoutIgnoredSink,
): SystemEntryText[] => {
  const out: SystemEntryText[] = [];
  const seen = new Set<string>();
  const max = key === 'patterns' ? SYSTEM_PATTERNS_MAX : SYSTEM_BRAND_MAX;
  listOf(raw, key).forEach((value, index) => {
    if (!isObject(value)) return void problems.push({ entry: `${key}[${index}]`, message: 'This entry is not an object.' });
    const id = own(value, 'id');
    const entry = entryLabel(key, index, id);
    if (out.length >= max) return void problems.push({ entry, message: `Design systems hold up to ${max} entries here.` });
    if (typeof id !== 'string' || !SYSTEM_ENTRY_ID_PATTERN.test(id) || seen.has(id)) return void problems.push({ entry, message: 'This entry needs its own id: lower-case letters, digits and dashes.' });
    const kind = own(value, 'kind') ?? 'other';
    if (typeof kind !== 'string' || !ENTRY_KINDS[key].includes(kind)) return void problems.push({ entry, message: `Its kind must be one of ${ENTRY_KINDS[key].join(', ')}.` });
    const title = lineText(own(value, 'title'), 80);
    if (title === null) return void problems.push({ entry, message: 'This entry needs a title of 1 to 80 characters.' });
    const note = noteText(own(value, 'note'), SYSTEM_USAGE_NOTE_MAX);
    if (note === null) return void problems.push({ entry, message: 'Its note is longer than 500 characters.' });
    const body = bodyOf(`${key}/${id}.md`, texts, tooLarge, SYSTEM_NOTE_MAX, false);
    const layout = readItemLayout(own(value, 'layout'), entry, layoutSink);
    const example = readExample(own(value, 'example'), key, id, files, entry, problems);
    seen.add(id);
    out.push({ id, kind, title, note, text: body.text, problem: body.problem, layout, example });
  });
  return out;
};

// ---- depth, pairs, outOfScope (system-builder-depth §4.3) ----

const DEPTHS: readonly SystemDepth[] = ['tokens', 'core', 'full'];

/** `depth`: absent or null → null (no completeness check); a value off the list → null plus a problem. */
const readDepth = (raw: JsonObject | null, problems: SystemProblem[]): SystemDepth | null => {
  const value = raw === null ? undefined : own(raw, 'depth');
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && (DEPTHS as readonly string[]).includes(value)) return value as SystemDepth;
  problems.push({ entry: 'depth', message: 'depth must be tokens, core or full, so the completeness check is off.' });
  return null;
};

const PAIR_USES: readonly ColourPairUse[] = ['text', 'large', 'ui'];

/** `--accent-fg` → `--accent`, `--on-primary` → `--primary`: the ground an on-colour is meant for. */
const groundOf = (name: string): string | null => {
  const fg = /^--(.+)-fg$/.exec(name);
  if (fg !== null) return `--${fg[1] ?? ''}`;
  const on = /^--on-(.+)$/.exec(name);
  return on === null ? null : `--${on[1] ?? ''}`;
};

/**
 * `pairs`: declared pairs whose `fg` and `bg` are colour tokens of this system with a value, then the
 * automatic ones (§4.3: every `--x-fg` or `--on-x` colour whose `--x` is one, `use: text`, unless
 * declared). A bad pair is a problem on that pair only; past `SYSTEM_PAIRS_MAX` the declared rest are one
 * problem with the true count, and automatic pairs stop where the cap is reached.
 */
const readPairs = (raw: JsonObject | null, tokens: readonly SystemToken[], problems: SystemProblem[]): SystemColourPair[] => {
  const colours = new Set(tokens.filter((token) => token.section === 'colours' && (token.light !== null || token.dark !== null)).map((token) => token.name));
  const out: SystemColourPair[] = [];
  const declared = new Set<string>();
  const list = listOf(raw, 'pairs');
  list.forEach((value, index) => {
    const entry = `pairs[${index}]`;
    if (out.length >= SYSTEM_PAIRS_MAX) return;
    if (!isObject(value)) return void problems.push({ entry, message: 'This pair is not an object.' });
    const fg = own(value, 'fg');
    const bg = own(value, 'bg');
    if (typeof fg !== 'string' || typeof bg !== 'string' || !colours.has(fg) || !colours.has(bg)) {
      return void problems.push({ entry, message: 'Its fg and bg must be colour tokens this system sets.' });
    }
    const use = own(value, 'use') ?? 'text';
    if (typeof use !== 'string' || !(PAIR_USES as readonly string[]).includes(use)) return void problems.push({ entry, message: 'Its use must be text, large or ui.' });
    const note = noteText(own(value, 'note'), SYSTEM_USAGE_NOTE_MAX);
    if (note === null) return void problems.push({ entry, message: 'Its note is longer than 500 characters.' });
    const key = `${fg}\u0000${bg}`;
    if (declared.has(key)) return void problems.push({ entry, message: 'This pair is listed twice.' });
    declared.add(key);
    out.push({ fg, bg, use: use as ColourPairUse, note, auto: false });
  });
  if (list.length > SYSTEM_PAIRS_MAX) {
    problems.push({ entry: 'pairs', message: `Design systems hold up to ${SYSTEM_PAIRS_MAX} colour pairs. ${groupDigits(list.length - SYSTEM_PAIRS_MAX)} more weren't read.` });
  }
  for (const name of colours) {
    if (out.length >= SYSTEM_PAIRS_MAX) break;
    const ground = groundOf(name);
    if (ground === null || !colours.has(ground) || declared.has(`${name}\u0000${ground}`)) continue;
    out.push({ fg: name, bg: ground, use: 'text', note: '', auto: true });
  }
  return out;
};

/**
 * `outOfScope`: checklist topic ids the agent decided this system does not cover (the user's decision 4).
 * Known ids only, each once, in the order written; unknown ones are one problem naming up to three
 * (cleaned and clipped); past `SYSTEM_OUT_OF_SCOPE_MAX` the rest are one problem with the true count.
 */
const readOutOfScope = (raw: JsonObject | null, problems: SystemProblem[]): SystemTopicId[] => {
  const list = listOf(raw, 'outOfScope');
  const out: SystemTopicId[] = [];
  const unknown: string[] = [];
  let unknownCount = 0;
  for (const value of list.slice(0, SYSTEM_OUT_OF_SCOPE_MAX)) {
    if (isSystemTopicId(value)) {
      if (!out.includes(value)) out.push(value);
      continue;
    }
    unknownCount += 1;
    if (unknown.length < 3) unknown.push(`"${layoutValueText(value)}"`);
  }
  if (unknownCount > 0) {
    const more = unknownCount > unknown.length ? ` and ${unknownCount - unknown.length} more` : '';
    problems.push({ entry: 'outOfScope', message: `${unknown.join(', ')}${more} ${unknownCount === 1 ? "isn't a checklist topic" : "aren't checklist topics"}, so ${unknownCount === 1 ? 'it was' : 'they were'} skipped.` });
  }
  if (list.length > SYSTEM_OUT_OF_SCOPE_MAX) {
    problems.push({ entry: 'outOfScope', message: `outOfScope holds up to ${SYSTEM_OUT_OF_SCOPE_MAX} topic ids. ${groupDigits(list.length - SYSTEM_OUT_OF_SCOPE_MAX)} more weren't read.` });
  }
  return out;
};

const baseName = (directory: string): string => {
  const parts = directory.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? directory;
};

/** The repoProblem reasons (§5.10) as the page's sentence; the closed list, never free text. */
const REPO_PROBLEM_REASONS: Readonly<Record<NonNullable<SystemState['repoProblem']>['reason'], string>> = {
  missing: "It doesn't exist.",
  'not-a-folder': "It isn't a folder.",
  unreadable: "Design Chamber isn't allowed to open it.",
  'folder-missing': '', // named with the folder below
  'too-large': 'It holds more files than Design Chamber can read.',
  'being-changed': 'It changed while Design Chamber was reading it.',
};

/** One repo read problem as its sentence (§5.10 step 1): the page and the refusals of a read word it the same. */
export const repoProblemText = (reason: string, directory: string, folder: string): string => {
  const repo = baseName(directory);
  // state.json is agent-reachable: an unknown reason reads as the generic sentence, never as text.
  if (!Object.hasOwn(REPO_PROBLEM_REASONS, reason)) return `Design Chamber can't read ${repo}.`;
  if (reason === 'folder-missing') return `${repo} has no ${folder} folder yet.`;
  return `Design Chamber can't read ${repo}. ${REPO_PROBLEM_REASONS[reason as keyof typeof REPO_PROBLEM_REASONS]}`;
};

const repoProblemSentence = (state: SystemState, home: Extract<NonNullable<SystemState['home']>, { kind: 'repo' }>): string | null => {
  const problem = state.repoProblem;
  if (problem === undefined || problem === null) return null;
  return repoProblemText(problem.reason, home.directory, home.folder);
};

export const homeViewOf = (state: SystemState): SystemHomeView => {
  const home = state.home;
  if (home === undefined || home.kind === 'internal') return { kind: 'internal' };
  // The label is the folder's base name; the guest maps it to the host's listProjects name (§9.5),
  // which the service cannot call. Readability follows the last snapshot read's problem (§5.10).
  const problem = repoProblemSentence(state, home);
  return { kind: 'repo', directory: home.directory, label: baseName(home.directory), folder: home.folder, livingPage: home.livingPage, readable: problem === null, problem, lastRead: state.snapshot?.at ?? null };
};

/** §5.9's closed adoption reasons as the system page's one sentence (the check's wording, with the
 * value named where the spec names it: the other system, the living-page path). Null when none. */
export const buildProblemSentence = (state: SystemState): string | null => {
  const problem = state.buildProblem;
  if (problem === undefined || problem === null) return null;
  const repo =
    state.home?.kind === 'repo'
      ? baseName(state.home.directory)
      : state.build?.projectDirectory !== undefined && state.build.projectDirectory !== null
        ? baseName(state.build.projectDirectory)
        : 'your project';
  const value = typeof problem.value === 'string' ? problem.value.slice(0, BUILD_PROBLEM_VALUE_MAX) : '';
  switch (problem.reason) {
    case 'unreadable':
      return "BUILD.json isn't valid JSON.";
    case 'ticket-unknown':
      return 'This design system was started from a chat Design Chamber no longer knows. Start it again with /design-system.';
    case 'ticket-needed':
      return "A system that lives in a repo needs a build ticket. Start it with /design-system in the project's chat.";
    case 'repo-outside-project':
      return 'The repo must be the project this chat is in, or a folder inside it. To use a folder above it, such as the root of a monorepo, open a chat in that folder and run /design-system there.';
    case 'repo-overlap':
      return value === '' ? 'Another design system already uses this repo folder or living-page path.' : `${value} already uses this repo folder or living-page path.`;
    case 'living-page-exists':
      return `${value === '' ? 'The living-page path' : value} already exists in ${repo} and isn't this system's living page. Pick another path.`;
    case 'code-outside-project':
      return 'The code folder must be the project this chat is in, or a folder inside it.';
    case 'home-changed':
      return `${state.name} already has files in ${repo}, so its home can't change. Make a new system to move it.`;
    case 'ticket-changed':
      return 'BUILD.json names another build. Keep the ticket this system started with.';
    case 'applied-unknown-proposal':
      return `The agent says it applied a proposal you didn't approve here${value === '' ? '' : ` (${value})`}. Check ${repo}'s history.`;
    case 'existing-outside-project':
      return 'The existing system must be a folder inside the project this chat is in, so Design Chamber ignored it.';
    default:
      // A forged or damaged state.json: the reason is not in the closed list.
      return "BUILD.json can't be used. Ask the agent to fix it.";
  }
};

const buildViewOf = (build: BuildJson | null): BuildView | null =>
  build === null ? null : { mode: build.mode, dark: build.dark, calls: build.calls, access: build.access, round: build.round, applied: build.applied };

/** The sources line of a row and the detail. */
export const sourceLineOf = (state: SystemState): SourceLine => ({
  code:
    state.sources.code === null
      ? null
      : {
          directory: state.sources.code.directory,
          lastScan: state.sources.code.lastScan,
          partial: state.sources.code.partial,
          ...(state.sources.code.project !== undefined ? { project: state.sources.code.project } : {}),
          ...(state.sources.code.existing !== undefined ? { existing: { location: state.sources.code.existing.location } } : {}),
        },
  brand: state.sources.brand?.files.length ?? 0,
  description: state.sources.description !== null,
});

const NOT_REVIEWED = { state: 'not-reviewed' as const, note: null };

/** The one detail every reader sees (board, checks, routes, living page). */
export const buildSystemDetail = (source: SystemDetailSource, rules: SystemTokenRules = SYSTEM_TOKEN_RULES): SystemDetail => {
  const { state } = source;
  const tooLarge = new Set(source.tooLarge ?? []);
  const problems: SystemProblem[] = [];

  let raw: JsonObject | null = null;
  let unreadable: string | null = null;
  if (tooLarge.has('system.json')) unreadable = TOO_LARGE_JSON;
  else if (source.systemJson !== null) {
    const parsed = parseSystemJson(source.systemJson);
    raw = parsed.raw;
    unreadable = parsed.unreadable;
    problems.push(...parsed.problems);
  }

  const files = new Set(source.files.map((file) => file.rel));
  const sizes = new Map(source.files.map((file) => [file.rel, file.bytes]));
  if (tooLarge.has('tokens.css')) problems.push({ entry: 'tokens.css', message: 'tokens.css is larger than 1 MB, so its tokens were not read.' });
  const tokens = readTokens(tooLarge.has('tokens.css') ? null : source.tokensCss, readTokenMeta(raw, problems), state.provenance, rules, problems);
  const defined = new Set(tokens.filter((token) => token.light !== null || token.dark !== null).map((token) => token.name));
  const type = readTypeStyles(raw, rules, problems);
  const fonts = readFonts(raw, files, problems);
  const logos = readLogos(raw, files, problems);
  const sourceFiles = readSourceFiles(raw, sizes, problems);
  const layoutSink: LayoutIgnoredSink = { ignored: [], ignoredCount: 0 };
  const sectionLayouts = readSectionLayouts(raw, layoutSink);
  const components = readComponents(raw, files, defined, problems, layoutSink);
  const notes = readNotes(raw, source.texts, tooLarge, problems, layoutSink);
  const patterns = readEntryTexts('patterns', raw, files, source.texts, tooLarge, problems, layoutSink);
  const brand = readEntryTexts('brand', raw, files, source.texts, tooLarge, problems, layoutSink);
  const coverage = coveredAreas(raw);
  if (coverage.problem !== null) problems.push({ entry: 'coverage', message: coverage.problem });
  const depth = readDepth(raw, problems);
  const pairs = readPairs(raw, tokens, problems);
  const outOfScope = readOutOfScope(raw, problems);

  const overviewBody = bodyOf('OVERVIEW.md', source.texts, tooLarge, SYSTEM_OVERVIEW_MAX, false);
  const overview = overviewBody.text === null && overviewBody.problem === null ? null : { text: overviewBody.text ?? '', problem: overviewBody.problem };

  const hashOf = (rel: string, text: string | null): string | null => source.hashes?.[rel] ?? (text === null ? null : sha256Hex(text));
  const bodyStamps: Record<string, string> = {};
  for (const rel of Object.keys(source.texts)) {
    if (!/^(notes|patterns|brand)\//.test(rel)) continue;
    const hash = hashOf(rel, source.texts[rel] ?? null);
    if (hash !== null) bodyStamps[rel] = hash;
  }

  const home = homeViewOf(state);
  const empty =
    tokens.length === 0 &&
    type.length === 0 &&
    fonts.length === 0 &&
    logos.length === 0 &&
    sourceFiles.length === 0 &&
    components.length === 0 &&
    notes.length === 0 &&
    patterns.length === 0 &&
    brand.length === 0 &&
    (overview === null || overview.text.trim() === '');

  const review = Object.fromEntries(SYSTEM_SECTIONS.map((section) => [section, NOT_REVIEWED])) as SystemDetail['review'];
  const detail: SystemDetail = {
    id: source.id,
    name: state.name,
    path: source.dir,
    status: state.status,
    revision: state.revision.n,
    created: state.created,
    updated: state.updated,
    sessionId: state.sessionId,
    sources: sourceLineOf(state),
    review,
    changesToReview: false,
    overview,
    notes,
    tokens,
    type,
    fonts,
    logos,
    sourceFiles,
    components,
    problems,
    unreadable,
    stamps: {
      tokens: hashOf('tokens.css', source.tokensCss),
      systemJson: hashOf('system.json', source.systemJson),
      overview: Object.hasOwn(source.texts, 'OVERVIEW.md') ? hashOf('OVERVIEW.md', source.texts['OVERVIEW.md'] ?? null) : null,
      notes: bodyStamps,
    },
    usedBy: 0,
    isDefault: false,
    pinnedFor: [],
    empty,
    home,
    editable: home.kind === 'internal',
    build: buildViewOf(source.build),
    buildProblem: buildProblemSentence(state),
    coverage: coverage.areas,
    patterns,
    brand,
    snapshot: state.snapshot ? { at: state.snapshot.at, by: state.snapshot.by, tampered: state.snapshot.tampered, treeHash: state.snapshot.treeHash } : null,
    codeDrift: state.codeDrift ? { ...state.codeDrift, unread: state.codeDrift.unread ?? [] } : null,
    livingPage: home.kind === 'repo' ? { state: null, sentence: null } : null,
    proposal: null,
    landed: state.landed ? { ...state.landed, sentence: landedSentence(state.landed, home.kind === 'repo' ? home.label : 'your code') } : null,
    agentDrift: source.build?.drift ?? null,
    boardLayout: { sections: sectionLayouts, ignored: layoutSink.ignored, ignoredCount: layoutSink.ignoredCount },
    depth,
    pairs,
    outOfScope,
  };
  const derived = deriveReview(state, sectionFingerprints(detail, source.hashes ?? {}));
  detail.review = derived.review;
  detail.changesToReview = derived.changesToReview;
  return detail;
};

// ---- fingerprints and review ----

/** JSON with object keys sorted at every level, so equal content always hashes the same. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

const tokenFacts = (token: SystemToken): unknown => ({
  name: token.name,
  light: token.light?.text ?? null,
  dark: token.dark?.text ?? null,
  note: token.note,
  group: token.group,
  breakpoint: token.breakpoint,
});

/**
 * sha256 of a canonical JSON of each section's entries (§2.5, §2.11). `hashes` are the file hashes by
 * contract-relative path (fonts, logos, sources and component examples); a file without one counts by
 * its path only. Tokens are taken in name order, so moving a declaration in tokens.css changes nothing;
 * `other` tokens belong to Sizes, where they are shown.
 */
export const sectionFingerprints = (detail: SystemDetail, hashes: Readonly<Record<string, string>> = {}): Record<SystemSection, string> => {
  const fileHash = (rel: string): string | null => hashes[rel] ?? null;
  const tokensOf = (sections: readonly TokenSection[]): unknown[] =>
    detail.tokens
      .filter((token) => sections.includes(token.section))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(tokenFacts);
  const textHash = (text: string | null): string | null => (text === null ? null : sha256Hex(text));
  const logos = detail.logos.map((logo) => ({ ...logo, hash: fileHash(logo.file) }));
  // system-builder-depth §4.3: the new facts join only when present, so a system written before them
  // keeps every fingerprint (and its reviews). Automatic pairs come from tokens already counted, and
  // `depth` and `outOfScope` are about the checklist, not content: none of them joins.
  const declaredPairs = detail.pairs.filter((pair) => !pair.auto).map((pair) => ({ fg: pair.fg, bg: pair.bg, use: pair.use, note: pair.note }));
  const entryFacts = (folder: 'patterns' | 'brand', entry: SystemEntryText): unknown => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    note: entry.note,
    body: textHash(entry.text),
    ...(entry.example === null ? {} : { example: fileHash(`${folder}/${entry.id}.html`) }),
  });
  const facts: Record<SystemSection, unknown> = {
    overview: { overview: textHash(detail.overview?.text ?? null), notes: detail.notes.map((note) => ({ id: note.id, title: note.title, body: textHash(note.text) })) },
    colours: declaredPairs.length === 0 ? tokensOf(['colours']) : { tokens: tokensOf(['colours']), pairs: declaredPairs },
    typography: { tokens: tokensOf(['typography']), type: detail.type },
    spacing: tokensOf(['spacing']),
    radius: tokensOf(['radius']),
    shadows: tokensOf(['shadows']),
    layers: tokensOf(['layers']),
    sizes: tokensOf(['sizes', 'other']),
    components: detail.components.map((component) => ({
      id: component.id,
      name: component.name,
      purpose: component.purpose,
      note: component.note,
      variants: component.variants,
      states: component.states,
      tokens: component.tokens,
      source: component.source,
      example: component.example === null ? null : fileHash(`components/${component.id}.html`),
      ...(component.sizes.length === 0 ? {} : { sizes: component.sizes }),
    })),
    patterns: detail.patterns.map((entry) => entryFacts('patterns', entry)),
    brand: { entries: detail.brand.map((entry) => entryFacts('brand', entry)), logos },
    assets: {
      fonts: detail.fonts.map((font) => ({ ...font, hash: fileHash(font.file) })),
      sources: detail.sourceFiles.map((file) => ({ file: file.file, hash: fileHash(file.file) })),
    },
  };
  return Object.fromEntries(SYSTEM_SECTIONS.map((section) => [section, sha256Hex(canonical(facts[section]))])) as Record<SystemSection, string>;
};

/** A section shows its recorded review only while its fingerprint still matches (§2.5). */
export const deriveReview = (
  state: SystemState,
  fingerprints: Record<SystemSection, string>,
): { review: SystemDetail['review']; changesToReview: boolean } => {
  const review = {} as SystemDetail['review'];
  for (const section of SYSTEM_SECTIONS) {
    const recorded = state.review[section];
    review[section] =
      recorded !== undefined && recorded.fingerprint === fingerprints[section] ? { state: recorded.state, note: recorded.note ?? null } : { state: 'not-reviewed', note: null };
  }
  const ready = state.readyFingerprints;
  const changesToReview = state.status === 'ready' && ready !== null && SYSTEM_SECTIONS.some((section) => ready[section] !== fingerprints[section]);
  return { review, changesToReview };
};

// ---- names ----

/** Characters of a brand file name (§5.6). */
export const SAFE_ASSET_NAME_MAX = 80;

const DEVICE_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * A safe file name for a brand file (§5.6): base name only; NFKC; characters outside `[A-Za-z0-9._ -]`
 * become `-`; repeats collapsed; no leading dot or dash (no trailing dot or space either: Windows drops
 * them); ≤ 80 characters keeping the extension, lower-cased; a Windows device stem gets `-file`; a clash
 * with an existing name ignoring case gets `-2` … `-99`. Throws when all 99 are taken (the caller refuses).
 */
export const safeAssetName = (name: string, existing: readonly string[]): string => {
  const base = name.split(/[\\/]/).at(-1) ?? '';
  let clean = base
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._ -]/g, '-')
    .replace(/([._ -])\1+/g, '$1')
    .replace(/^[.\- ]+/, '')
    .replace(/[. ]+$/, '');
  const dot = clean.lastIndexOf('.');
  let stem = dot > 0 ? clean.slice(0, dot) : clean;
  let extension = dot > 0 ? clean.slice(dot + 1).toLowerCase() : '';
  if (extension.length > 10) {
    stem = clean;
    extension = '';
  }
  stem = stem.replace(/[. -]+$/, '');
  if (stem === '') stem = 'file';
  const deviceStem = stem.split('.')[0] ?? stem;
  if (DEVICE_STEM.test(deviceStem)) stem = `${stem}-file`;
  const suffix = extension === '' ? '' : `.${extension}`;
  const fit = (candidateStem: string, tail: string): string => `${candidateStem.slice(0, SAFE_ASSET_NAME_MAX - suffix.length - tail.length).replace(/[. -]+$/, '') || 'file'}${tail}${suffix}`;
  clean = fit(stem, '');
  const taken = new Set(existing.map((one) => one.toLowerCase()));
  if (!taken.has(clean.toLowerCase())) return clean;
  for (let n = 2; n <= 99; n += 1) {
    const candidate = fit(stem, `-${n}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error('safeAssetName: 99 files already share this name.');
};

/** An id the store may mint or read as a system (pattern, not reserved). */
/**
 * The re-sync stamp (§6.3): the system's tokens.css and system.json hashes when the scan's review was
 * made (`none` for an absent file). The page sends the one it read with the system's detail
 * (`detail.stamps`); the service refuses an apply when the files moved on since the review.
 */
export const resyncStampOf = (stamps: { tokens: string | null; systemJson: string | null }): string => `${stamps.tokens ?? 'none'}:${stamps.systemJson ?? 'none'}`;

/** A re-sync stamp's shape (two sha256 hex strings or `none`), checked at the route. */
export const RESYNC_STAMP_PATTERN = /^(?:[0-9a-f]{64}|none):(?:[0-9a-f]{64}|none)$/;

export const isUsableSystemId = (id: string): boolean => SYSTEM_ID_PATTERN.test(id) && !isReservedSystemId(id);

const PART_APPLIED: Readonly<Record<ProposalPartName, string>> = { 'system-files': 'the system files', 'token-fixes': 'the token fixes', docs: 'docs', 'living-page': 'the living page' };
const PART_FOUND: Readonly<Record<ProposalPartName, string>> = { 'system-files': 'system files', 'token-fixes': 'token fixes', docs: 'docs', 'living-page': 'living page' };
const andList = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * What landed vs what was approved (§5.14 step 6), in words: the files that differ, then the parts the
 * agent stamped that Design Chamber did not find. Null when everything matches.
 */
export const landedSentence = (landed: Pick<LandedView, 'differ' | 'unclaimed'>, repo: string): string | null => {
  const out: string[] = [];
  if (landed.differ.length > 0) {
    const count = landed.differ.length;
    out.push(`What landed in ${repo} differs from what you approved in ${count === 1 ? '1 file' : `${count} files`}: ${landed.differ.join(', ')}.`);
  }
  const parts = landed.unclaimed.filter((part): part is ProposalPartName => Object.hasOwn(PART_APPLIED, part));
  if (parts.length === 1) {
    const part = parts[0] as ProposalPartName;
    out.push(`The agent says it applied ${PART_APPLIED[part]}, but Design Chamber found no ${PART_FOUND[part]} in ${repo}.`);
  } else if (parts.length > 1) {
    out.push(`The agent says it applied ${andList(parts.map((part) => PART_APPLIED[part]))}, but Design Chamber found none of them in ${repo}.`);
  }
  return out.length === 0 ? null : out.join(' ');
};

/** A path in the system file contract (§5.10): `system.json`, `tokens.css`, `OVERVIEW.md`, `notes/<id>.md`, …. */
export const isSystemContractRel = (rel: string): boolean => {
  if (rel === 'system.json' || rel === 'tokens.css' || rel === 'OVERVIEW.md') return true;
  const entry = /^(notes|patterns|brand)\/([^/]+)\.md$/.exec(rel);
  if (entry !== null) return SYSTEM_ENTRY_ID_PATTERN.test(entry[2] ?? '');
  // Live examples: components, and pattern and brand entries (system-builder-depth D4).
  const example = /^(components|patterns|brand)\/([^/]+)\.html$/.exec(rel);
  if (example !== null) return SYSTEM_ENTRY_ID_PATTERN.test(example[2] ?? '');
  const asset = /^(assets\/fonts|assets\/logos|sources)\/([^/]+)$/.exec(rel);
  return asset !== null && SAFE_FILE_PATTERN.test(asset[2] ?? '') && !(asset[2] ?? '').includes('..');
};

/** `BUILD.json` (schema `design-chamber/system-build@1`, §2.13): ≤ `SYSTEM_BUILD_JSON_MAX_BYTES`, else unreadable. */
export type ParsedBuildJson = {
  build: BuildJson | null;
  raw: JsonObject | null;
  problems: SystemProblem[];
  unreadable: string | null;
  /**
   * Phase 2.6 §19 item 5: an `existing` hint whose shape was refused (absolute, `..`, wrong type),
   * as text clipped to `BUILD_PROBLEM_VALUE_MAX`. The build is still adopted; the service records it
   * as `existing-outside-project` so the system page says the hint was ignored.
   */
  existingRefused?: string;
};

/** The raw `existing` hint as text a problem can show: its folder when it has a string one, else the JSON. */
const refusedHintText = (raw: unknown): string => {
  const folder = isObject(raw) ? own(raw, 'folder') : raw;
  const text = typeof folder === 'string' ? folder : (JSON.stringify(raw) ?? String(raw));
  return text.slice(0, BUILD_PROBLEM_VALUE_MAX);
};

const BUILD_NOT_JSON = "BUILD.json isn't valid JSON.";
const BUILD_TOO_LARGE = 'BUILD.json is larger than 64 KB.';
const BUILD_PART_NAMES: readonly string[] = ['system-files', 'token-fixes', 'docs', 'living-page'];
const BUILD_DRIFT_KINDS: readonly string[] = ['tailwind-config', 'js-theme', 'scss', 'less', 'other'];
const BUILD_CALL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A part list (`applied.parts`, `applied.skipped`): the four names, each at most once; null when not a list of them. */
const buildParts = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > BUILD_PART_NAMES.length) return null;
  const out: string[] = [];
  for (const part of value) {
    if (typeof part !== 'string' || !BUILD_PART_NAMES.includes(part) || out.includes(part)) return null;
    out.push(part);
  }
  return out;
};

/**
 * `BUILD.json`, the agent's interview record and home request (§2.13). Tolerant like `parseSystemJson`:
 * a wrong optional field is dropped with a problem and its default kept; `home` (and a repo home's
 * paths) and `name` are required — without them there is nothing to adopt, so `build` is null and
 * `unreadable` says why. Unknown keys stay on `raw`. Every string is shown as text, never markup.
 */
export const parseBuildJson = (text: string): ParsedBuildJson => {
  // A cheap bound first: every UTF-16 unit is at most 3 UTF-8 bytes.
  if (text.length > SYSTEM_BUILD_JSON_MAX_BYTES || (text.length * 3 > SYSTEM_BUILD_JSON_MAX_BYTES && byteLength(text) > SYSTEM_BUILD_JSON_MAX_BYTES)) {
    return { build: null, raw: null, problems: [], unreadable: BUILD_TOO_LARGE };
  }
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch {
    return { build: null, raw: null, problems: [], unreadable: BUILD_NOT_JSON };
  }
  if (!isObject(value)) return { build: null, raw: null, problems: [], unreadable: BUILD_NOT_JSON };
  const problems: SystemProblem[] = [];
  const broken = (entry: string, message: string): null => {
    problems.push({ entry, message });
    return null;
  };

  const home = own(value, 'home');
  if (home !== 'internal' && home !== 'repo') {
    return { build: null, raw: value, problems: [{ entry: 'home', message: 'BUILD.json must say where the system lives: home is "internal" or "repo".' }], unreadable: BUILD_NOT_JSON };
  }
  const rawName = own(value, 'name');
  const name = typeof rawName === 'string' ? rawName.normalize('NFKC').trim() : '';
  if (name === '' || name.length > SYSTEM_NAME_MAX || hasControl(name)) {
    return { build: null, raw: value, problems: [{ entry: 'name', message: 'BUILD.json needs a system name of 1 to 60 characters.' }], unreadable: BUILD_NOT_JSON };
  }

  // The repo home's paths: absolute directory, repo-relative folder and living page (§2.13).
  let repo: BuildJson['repo'] = null;
  const rawRepo = own(value, 'repo');
  if (rawRepo !== undefined && rawRepo !== null) {
    if (!isObject(rawRepo)) {
      if (home === 'repo') return { build: null, raw: value, problems: [{ entry: 'repo', message: 'A repo home needs a repo object with directory, folder and livingPage.' }], unreadable: BUILD_NOT_JSON };
      broken('repo', 'repo in BUILD.json is not an object, so it was skipped.');
    } else {
      const directory = own(rawRepo, 'directory');
      const folder = own(rawRepo, 'folder');
      const livingPage = own(rawRepo, 'livingPage');
      const ok =
        isAbsPath(directory) &&
        typeof folder === 'string' && REPO_REL_PATTERN.test(folder) &&
        typeof livingPage === 'string' && REPO_REL_PATTERN.test(livingPage) && livingPage.endsWith('.html');
      if (!ok) {
        if (home === 'repo') return { build: null, raw: value, problems: [{ entry: 'repo', message: 'A repo home needs an absolute directory, a folder and a livingPage path inside the repo (ending .html).' }], unreadable: BUILD_NOT_JSON };
        broken('repo', 'The repo paths in BUILD.json are not usable, so they were skipped.');
      } else {
        // Safe: `ok` checked every field's type and shape.
        repo = { directory: directory as string, folder: folder as string, livingPage: livingPage as string };
      }
    }
  } else if (home === 'repo') {
    return { build: null, raw: value, problems: [{ entry: 'repo', message: 'A repo home needs a repo object with directory, folder and livingPage.' }], unreadable: BUILD_NOT_JSON };
  }

  let code: BuildJson['code'] = null;
  const rawCode = own(value, 'code');
  if (rawCode !== undefined && rawCode !== null) {
    const directory = isObject(rawCode) ? own(rawCode, 'directory') : undefined;
    if (isAbsPath(directory)) code = { directory };
    else broken('code', 'The code directory in BUILD.json is not an absolute path, so it was skipped.');
  }

  // Phase 2.6 AD-11: the existing system the agent found, a folder inside the project ("." = its root).
  let existing: { folder: string } | null = null;
  let existingRefused: string | null = null;
  const rawExisting = own(value, 'existing');
  if (rawExisting !== undefined && rawExisting !== null) {
    const folder = isObject(rawExisting) ? own(rawExisting, 'folder') : undefined;
    if (typeof folder === 'string' && (folder === '.' || REPO_REL_PATTERN.test(folder))) existing = { folder };
    else {
      existingRefused = refusedHintText(rawExisting);
      broken('existing', 'existing in BUILD.json needs a folder inside the project, like "design-system", so it was skipped.');
    }
  }

  let ticket: string | null = null;
  const rawTicket = own(value, 'ticket');
  if (rawTicket !== undefined && rawTicket !== null) {
    if (typeof rawTicket === 'string' && SYSTEM_BUILD_TICKET_PATTERN.test(rawTicket)) ticket = rawTicket;
    else broken('ticket', 'The ticket in BUILD.json is not a build ticket id, so it was skipped.');
  }

  const rawMode = own(value, 'mode');
  const mode = rawMode === 'fix' || rawMode === 'describe' || rawMode === 'none' ? rawMode : 'none';
  if (rawMode !== undefined && mode !== rawMode) broken('mode', 'mode in BUILD.json must be fix, describe or none.');
  const rawDark = own(value, 'dark');
  const dark = rawDark === true;
  if (rawDark !== undefined && typeof rawDark !== 'boolean') broken('dark', 'dark in BUILD.json must be true or false.');
  const rawAccess = own(value, 'access');
  const access = rawAccess === 'dev' || rawAccess === 'public' ? rawAccess : null;
  if (rawAccess !== undefined && rawAccess !== null && access !== rawAccess) broken('access', 'access in BUILD.json must be dev, public or null.');
  const rawRound = own(value, 'round');
  const round = rawRound === 1 || rawRound === 2 || rawRound === 'done' ? rawRound : 1;
  if (rawRound !== undefined && round !== rawRound) broken('round', 'round in BUILD.json must be 1, 2 or done.');

  const calls: BuildJson['calls'] = [];
  const rawCalls = own(value, 'calls');
  if (rawCalls !== undefined && rawCalls !== null) {
    if (!Array.isArray(rawCalls)) broken('calls', 'calls in BUILD.json is not a list, so it was skipped.');
    else {
      if (rawCalls.length > SYSTEM_BUILD_CALLS_MAX) problems.push({ entry: 'calls', message: `BUILD.json holds up to ${SYSTEM_BUILD_CALLS_MAX} calls; the rest weren't read.` });
      rawCalls.slice(0, SYSTEM_BUILD_CALLS_MAX).forEach((call, index) => {
        const entry = `calls[${index}]`;
        if (!isObject(call)) return void problems.push({ entry, message: 'This call is not an object.' });
        const topic = own(call, 'topic');
        const choice = own(call, 'choice');
        if (typeof topic !== 'string' || !BUILD_CALL_PATTERN.test(topic) || typeof choice !== 'string' || !BUILD_CALL_PATTERN.test(choice)) {
          return void problems.push({ entry, message: 'A call needs a topic and a choice: lower-case letters, digits and dashes.' });
        }
        const note = noteText(own(call, 'note'), SYSTEM_USAGE_NOTE_MAX);
        if (note === null) return void problems.push({ entry, message: 'Its note is longer than 500 characters.' });
        calls.push({ topic, choice, note });
      });
    }
  }

  let applied: BuildJson['applied'] = null;
  const rawApplied = own(value, 'applied');
  if (rawApplied !== undefined && rawApplied !== null) {
    const at = isObject(rawApplied) ? own(rawApplied, 'at') : undefined;
    const parts = isObject(rawApplied) ? buildParts(own(rawApplied, 'parts')) : null;
    const skipped = isObject(rawApplied) ? buildParts(own(rawApplied, 'skipped')) : null;
    if (isIso(at) && parts !== null && skipped !== null) applied = { at, parts, skipped };
    else broken('applied', 'applied in BUILD.json needs an ISO time and parts and skipped from system-files, token-fixes, docs, living-page.');
  }

  let proposal: string | null = null;
  const rawProposal = own(value, 'proposal');
  if (rawProposal !== undefined && rawProposal !== null) {
    if (typeof rawProposal === 'string' && SYSTEM_PROPOSAL_ID_PATTERN.test(rawProposal)) proposal = rawProposal;
    else broken('proposal', 'The proposal in BUILD.json is not a proposal id, so it was skipped.');
  }

  let drift: BuildJson['drift'] = null;
  const rawDrift = own(value, 'drift');
  if (rawDrift !== undefined && rawDrift !== null) {
    const differ = isObject(rawDrift) ? own(rawDrift, 'differ') : undefined;
    const rawKinds = isObject(rawDrift) ? own(rawDrift, 'kinds') : undefined;
    const note = isObject(rawDrift) ? noteText(own(rawDrift, 'note'), 300) : null;
    const kinds =
      Array.isArray(rawKinds) && rawKinds.length <= BUILD_DRIFT_KINDS.length && rawKinds.every((kind) => typeof kind === 'string' && BUILD_DRIFT_KINDS.includes(kind))
        ? [...new Set(rawKinds as string[])]
        : null;
    if (typeof differ === 'number' && Number.isInteger(differ) && differ >= 0 && differ <= 100_000 && kinds !== null && note !== null) {
      drift = { differ, kinds, note };
    } else {
      broken('drift', "drift in BUILD.json needs a differ count (0 to 100 000), kinds from tailwind-config, js-theme, scss, less, other, and a note up to 300 characters.");
    }
  }

  const build: BuildJson = { version: 1, ticket, name, home, repo, code, ...(existing !== null ? { existing } : {}), mode, dark, calls, access, round, applied, proposal, drift };
  return { build, raw: value, problems, unreadable: null, ...(existingRefused !== null ? { existingRefused } : {}) };
};

/**
 * `PROPOSAL.json` (schema `design-chamber/system-proposal@1`, §2.15): ≤ `SYSTEM_PROPOSAL_MAX_BYTES`, else unreadable.
 * `id` is the proposal's id whenever it passes its pattern, even when the rest is unreadable (so the
 * record can mark that id). `parts` is the view's shape (`patchOmitted` set, `bytes` null until the
 * service measures the `from` file). Any problem means the user would not see the whole diff, so the
 * service lists them and Approve stays off.
 */
export type ParsedProposal = {
  proposal: ProposalJson | null;
  id: string | null;
  parts: ProposalPart[];
  raw: JsonObject | null;
  problems: SystemProblem[];
  unreadable: string | null;
};

export const PROPOSAL_NOT_JSON = "PROPOSAL.json isn't valid JSON.";
export const PROPOSAL_TOO_LARGE = 'PROPOSAL.json is larger than 512 KB.';
export const PROPOSAL_NO_ID = 'PROPOSAL.json needs an id like p_k3m9q2x7, new for every proposal.';
export const PROPOSAL_TOO_MANY_FILES = `PROPOSAL.json lists more than ${SYSTEM_PROPOSAL_FILES_MAX} files. Ask the agent to split the change.`;
export const PROPOSAL_NO_PARTS = 'PROPOSAL.json needs a parts list.';
export const PATCH_OMITTED_SENTENCE = "The change is too long to show here; it's in the chat.";
const PROPOSAL_SUMMARY_MAX = 500;
const PROPOSAL_FILE_SUMMARY_MAX = 300;
const PROPOSAL_COUNT_MAX = 1_000_000;
const WAY_BACK_NAME_MAX = 100;
const WAY_BACK_TEXT_MAX = 300;
const WAY_BACK_KINDS: readonly string[] = ['commit', 'branch', 'stash', 'none'];
const FROM_PARTS: readonly string[] = ['system-files', 'docs'];

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= PROPOSAL_COUNT_MAX;

/**
 * Tolerant like `parseBuildJson`: an invalid file entry or field is dropped with a problem; without an
 * id, a parts list, or with more than 200 files there is nothing safe to show, so the file is
 * unreadable. `skipDirs` is discovery's list (passed in so this module stays pure and there is one list).
 */
export const parseProposal = (text: string, options: { skipDirs: ReadonlySet<string> }): ParsedProposal => {
  const fail = (unreadable: string, extra: Partial<ParsedProposal> = {}): ParsedProposal => ({ proposal: null, id: null, parts: [], raw: null, problems: [], unreadable, ...extra });
  if (text.length > SYSTEM_PROPOSAL_MAX_BYTES || (text.length * 3 > SYSTEM_PROPOSAL_MAX_BYTES && byteLength(text) > SYSTEM_PROPOSAL_MAX_BYTES)) return fail(PROPOSAL_TOO_LARGE);
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch {
    return fail(PROPOSAL_NOT_JSON);
  }
  if (!isObject(value)) return fail(PROPOSAL_NOT_JSON);
  const rawId = own(value, 'id');
  if (typeof rawId !== 'string' || !SYSTEM_PROPOSAL_ID_PATTERN.test(rawId)) return fail(PROPOSAL_NO_ID, { raw: value });
  const id = rawId;
  const rawParts = own(value, 'parts');
  if (!Array.isArray(rawParts)) return fail(PROPOSAL_NO_PARTS, { raw: value, id });
  let fileCount = 0;
  for (const part of rawParts) {
    const files = isObject(part) ? own(part, 'files') : undefined;
    if (Array.isArray(files)) fileCount += files.length;
  }
  if (fileCount > SYSTEM_PROPOSAL_FILES_MAX) return fail(PROPOSAL_TOO_MANY_FILES, { raw: value, id });

  const problems: SystemProblem[] = [];
  const broken = (entry: string, message: string): void => void problems.push({ entry, message });

  const rawVersion = own(value, 'version');
  if (rawVersion !== undefined && rawVersion !== 1) broken('version', 'version in PROPOSAL.json must be 1.');

  let supersedes: string | null = null;
  const rawSupersedes = own(value, 'supersedes');
  if (rawSupersedes !== undefined && rawSupersedes !== null) {
    if (typeof rawSupersedes === 'string' && SYSTEM_PROPOSAL_ID_PATTERN.test(rawSupersedes)) supersedes = rawSupersedes;
    else broken('supersedes', 'supersedes in PROPOSAL.json is not a proposal id, so it was skipped.');
  }

  const rawCreated = own(value, 'created');
  const created = isIso(rawCreated) ? rawCreated : new Date(0).toISOString();
  if (!isIso(rawCreated)) broken('created', 'created in PROPOSAL.json needs an ISO time.');

  const rawMode = own(value, 'mode');
  const mode = rawMode === 'fix' || rawMode === 'describe' || rawMode === 'none' ? rawMode : 'none';
  if (mode !== rawMode) broken('mode', 'mode in PROPOSAL.json must be fix, describe or none.');

  const summaryText = noteText(own(value, 'summary'), PROPOSAL_SUMMARY_MAX);
  const summary = summaryText ?? '';
  if (summaryText === null) broken('summary', `The summary in PROPOSAL.json must be text of up to ${PROPOSAL_SUMMARY_MAX} characters.`);

  let wayBack: ProposalJson['wayBack'] = { kind: 'none', name: '', text: '' };
  const rawWayBack = own(value, 'wayBack');
  if (rawWayBack !== undefined && rawWayBack !== null) {
    const kind = isObject(rawWayBack) ? own(rawWayBack, 'kind') : undefined;
    const name = isObject(rawWayBack) ? noteText(own(rawWayBack, 'name'), WAY_BACK_NAME_MAX) : null;
    const wayText = isObject(rawWayBack) ? noteText(own(rawWayBack, 'text'), WAY_BACK_TEXT_MAX) : null;
    if (typeof kind === 'string' && WAY_BACK_KINDS.includes(kind) && name !== null && wayText !== null) {
      wayBack = { kind: kind as ProposalJson['wayBack']['kind'], name, text: wayText };
    } else {
      broken('wayBack', 'wayBack in PROPOSAL.json needs a kind (commit, branch, stash or none), a name and a line of text.');
    }
  } else {
    broken('wayBack', 'PROPOSAL.json should say how to undo the change (wayBack).');
  }

  const rawAccess = own(value, 'access');
  const access = rawAccess === 'dev' || rawAccess === 'public' ? rawAccess : null;
  if (rawAccess !== undefined && rawAccess !== null && access !== rawAccess) broken('access', 'access in PROPOSAL.json must be dev, public or null.');

  // Patches: each ≤ SYSTEM_PROPOSAL_PATCH_MAX characters, all ≤ SYSTEM_PROPOSAL_PATCHES_MAX; one over
  // either cap is dropped and its file says so (that is not a problem: the patch is in the chat).
  let patchBudget = SYSTEM_PROPOSAL_PATCHES_MAX;
  const parts: ProposalJson['parts'] = [];
  const views: ProposalPart[] = [];
  rawParts.forEach((rawPart, partIndex) => {
    const partEntry = `parts[${partIndex}]`;
    if (!isObject(rawPart)) return broken(partEntry, 'This part is not an object.');
    const name = own(rawPart, 'name');
    if (typeof name !== 'string' || !BUILD_PART_NAMES.includes(name)) return broken(partEntry, 'A part is named system-files, token-fixes, docs or living-page.');
    const partName = name as ProposalPartName;
    if (parts.some((part) => part.name === partName)) return broken(partEntry, `${partName} appears more than once in PROPOSAL.json.`);
    const rawFiles = own(rawPart, 'files');
    if (!Array.isArray(rawFiles)) return broken(partEntry, `${partName} needs a files list.`);
    const files: ProposalFileEntry[] = [];
    const fileViews: ProposalFile[] = [];
    rawFiles.forEach((rawFile, fileIndex) => {
      const entry = `${partEntry}.files[${fileIndex}]`;
      if (!isObject(rawFile)) return broken(entry, 'This file is not an object.');
      const filePath = own(rawFile, 'path');
      if (typeof filePath !== 'string' || !REPO_PATH_PATTERN.test(filePath) || filePath.split('/').some((segment) => options.skipDirs.has(segment))) {
        return broken(entry, 'A file path must be relative to the repo, up to 8 folders deep, and not inside node_modules, .git, dist, build or other generated folders.');
      }
      const change = own(rawFile, 'change');
      if (change !== 'create' && change !== 'modify' && change !== 'delete') return broken(entry, `${filePath}: change must be create, modify or delete.`);
      const fileSummary = noteText(own(rawFile, 'summary'), PROPOSAL_FILE_SUMMARY_MAX);
      if (fileSummary === null) return broken(entry, `${filePath}: the summary must be text of up to ${PROPOSAL_FILE_SUMMARY_MAX} characters.`);
      const added = own(rawFile, 'added') ?? 0;
      const removed = own(rawFile, 'removed') ?? 0;
      if (!isCount(added) || !isCount(removed)) return broken(entry, `${filePath}: added and removed are whole numbers from 0 to 1 000 000.`);

      let patch: string | null = null;
      let patchOmitted = false;
      const rawPatch = own(rawFile, 'patch');
      if (rawPatch !== undefined && rawPatch !== null) {
        if (typeof rawPatch !== 'string') return broken(entry, `${filePath}: the patch must be text.`);
        if (partName === 'living-page') broken(entry, 'The living page is generated by Design Chamber, so it has no patch.');
        else if (rawPatch.length > SYSTEM_PROPOSAL_PATCH_MAX || rawPatch.length > patchBudget) patchOmitted = true;
        else {
          patch = rawPatch;
          patchBudget -= rawPatch.length;
        }
      }

      let from: string | null = null;
      const rawFrom = own(rawFile, 'from');
      if (rawFrom !== undefined && rawFrom !== null) {
        const rel = typeof rawFrom === 'string' && rawFrom.startsWith('proposal/') ? rawFrom.slice('proposal/'.length) : null;
        if (rel === null || !isSystemContractRel(rel)) return broken(entry, `${filePath}: from must name a system file under proposal/, like proposal/tokens.css.`);
        if (change !== 'create' || !FROM_PARTS.includes(partName)) return broken(entry, `${filePath}: only a new system file or doc can point at proposal/.`);
        from = rawFrom as string;
      }

      let usages: ProposalFileEntry['usages'] = null;
      const rawUsages = own(rawFile, 'usages');
      if (rawUsages !== undefined && rawUsages !== null) {
        const count = isObject(rawUsages) ? own(rawUsages, 'count') : undefined;
        const listed = isObject(rawUsages) ? own(rawUsages, 'listed') : undefined;
        if (!isCount(count) || typeof listed !== 'boolean') return broken(entry, `${filePath}: usages needs a count and listed (true or false).`);
        usages = { count, listed };
      }

      if (files.some((file) => file.path === filePath)) return broken(entry, `${filePath} is listed twice in ${partName}.`);
      files.push({ path: filePath, change, summary: fileSummary, added, removed, patch, from, usages });
      fileViews.push({ path: filePath, change, summary: fileSummary, added, removed, patch, patchOmitted, from, bytes: null, usages });
    });
    if (partName === 'living-page') {
      const usable = files.length === 1 && files[0]?.change !== 'delete';
      if (!usable) broken(partEntry, 'The living-page part holds exactly one file: a create or change of the living page.');
    }
    parts.push({ name: partName, files });
    views.push({ name: partName, files: fileViews });
  });

  const proposal: ProposalJson = { version: 1, id, supersedes, created, mode, summary, parts, wayBack, access };
  return { proposal, id, parts: views, raw: value, problems, unreadable: null };
};
