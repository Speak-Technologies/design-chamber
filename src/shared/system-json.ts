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
// `sectionFingerprints`, `deriveReview` and `safeAssetName`. Still seams: T12b (`parseBuildJson`,
// `isSystemContractRel`) and T17 (`parseProposal`).
//
// Token values: which declaration is light or dark, a token's section and whether a value is
// valid are the token rules of `token-edit.ts` (T3). `buildSystemDetail` takes them as
// `SystemTokenRules` (defaulting to those functions), so the reader and its tests do not depend
// on the order the two tasks land in.

import { sha256Hex } from './agent/ownership.ts';
import {
  SYSTEM_BRAND_MAX,
  SYSTEM_COMPONENTS_MAX,
  SYSTEM_ENTRY_ID_PATTERN,
  SYSTEM_EXAMPLE_MAX,
  SYSTEM_ID_PATTERN,
  SYSTEM_JSON_MAX_BYTES,
  SYSTEM_NAME_MAX,
  SYSTEM_NOTE_MAX,
  SYSTEM_NOTES_MAX,
  SYSTEM_OVERVIEW_MAX,
  SYSTEM_PATTERNS_MAX,
  SYSTEM_TOKEN_NAME_PATTERN,
  SYSTEM_TOKENS_MAX,
  SYSTEM_TYPE_STYLES_MAX,
  SYSTEM_USAGE_NOTE_MAX,
} from './limits.ts';
import { classifyToken, isDarkContext, isLightContext, validateTokenValue, type TypeField, type ValueCheck } from './token-edit.ts';
import { ALSO_SET_MAX, scanTokens, type Declaration, type TokenContext } from './tokens-css.ts';
import type {
  BuildJson,
  BuildView,
  ColourGroup,
  FontAsset,
  IsoDate,
  JsonObject,
  JsonValue,
  LogoAsset,
  ProposalJson,
  ReviewState,
  SourceLine,
  SystemArea,
  SystemComponent,
  SystemDetail,
  SystemEntryText,
  SystemHomeView,
  SystemSection,
  SystemState,
  SystemToken,
  TokenSection,
  TokenValue,
  TypeStyle,
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
const LIST_KEYS = ['type', 'fonts', 'logos', 'components', 'notes', 'sources', 'patterns', 'brand'] as const;

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

const parseSources = (value: unknown): SystemState['sources'] => {
  const sources: SystemState['sources'] = { code: null, brand: null, description: null };
  if (!isObject(value)) return sources;
  const code = own(value, 'code');
  if (isObject(code)) {
    const directory = own(code, 'directory');
    const lastScan = own(code, 'lastScan');
    const scanned = stringList(own(code, 'scanned'), 10_000, 4096) ?? [];
    if (typeof directory === 'string' && directory !== '' && isIso(lastScan)) {
      sources.code = { directory, lastScan, partial: own(code, 'partial') === true, scanned };
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

const parseProvenance = (value: unknown): SystemState['provenance'] => {
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

const parseHome = (value: unknown): SystemState['home'] | undefined => {
  if (!isObject(value)) return undefined;
  const kind = own(value, 'kind');
  if (kind === 'internal') return { kind: 'internal' };
  if (kind !== 'repo') return undefined;
  const directory = own(value, 'directory');
  const folder = own(value, 'folder');
  const livingPage = own(value, 'livingPage');
  const adoptedAt = own(value, 'adoptedAt');
  if (typeof directory !== 'string' || typeof folder !== 'string' || typeof livingPage !== 'string' || !isIso(adoptedAt)) return undefined;
  return { kind: 'repo', directory, folder, livingPage, adoptedAt };
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
  // Service-owned S8 records the detail does not read yet: kept as the service wrote them (objects
  // only), so a T1 write never drops them; their own tasks (T12b, T14) validate them in depth.
  const passThrough = ['build', 'buildProblem', 'repoProblem', 'livingPage'] as const;
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

// ---- the detail ----

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

const readComponents = (
  raw: JsonObject | null,
  files: ReadonlySet<string>,
  defined: ReadonlySet<string>,
  problems: SystemProblem[],
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
    const states = shortList(own(value, 'states'), 20, 40);
    const tokenNames = shortList(own(value, 'tokens'), 40, 61);
    const source = own(value, 'source');
    if (purpose === null || note === null) return void problems.push({ entry, message: 'Its purpose and note can each be up to 500 characters.' });
    if (variants === null || states === null) return void problems.push({ entry, message: 'Variants and states are lists of up to 20 short names.' });
    if (tokenNames === null || !tokenNames.every((token) => SYSTEM_TOKEN_NAME_PATTERN.test(token))) return void problems.push({ entry, message: 'Its tokens must be a list of up to 40 token names.' });
    if (source !== undefined && source !== null && (typeof source !== 'string' || source.length > 300)) return void problems.push({ entry, message: 'Its source is text of up to 300 characters.' });
    const exampleValue = own(value, 'example');
    let example: SystemComponent['example'] = null;
    if (exampleValue !== undefined && exampleValue !== null) {
      const expected = `components/${id}.html`;
      if (exampleValue !== expected) problems.push({ entry, message: `Its example must be ${expected}.` });
      else if (!files.has(expected)) problems.push({ entry, message: `${expected} is missing.` });
      // The remote refs are found while the board bundles the example (T6).
      else example = { remote: [] };
    }
    seen.add(id);
    out.push({
      id,
      name,
      purpose,
      note,
      variants,
      states,
      tokens: tokenNames,
      source: typeof source === 'string' && source !== '' ? source : null,
      example,
      undefinedTokens: tokenNames.filter((token) => !defined.has(token)),
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

const readNotes = (raw: JsonObject | null, texts: Readonly<Record<string, string>>, tooLarge: ReadonlySet<string>, problems: SystemProblem[]): SystemDetail['notes'] => {
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
    seen.add(id);
    out.push({ id, title, text: body.text ?? '', problem: body.problem });
  });
  return out;
};

const ENTRY_KINDS: Readonly<Record<'patterns' | 'brand', readonly string[]>> = {
  patterns: ['layout', 'do-dont', 'voice', 'other'],
  brand: ['marketing', 'imagery', 'logo-use', 'other'],
};

const readEntryTexts = (
  key: 'patterns' | 'brand',
  raw: JsonObject | null,
  texts: Readonly<Record<string, string>>,
  tooLarge: ReadonlySet<string>,
  problems: SystemProblem[],
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
    seen.add(id);
    out.push({ id, kind, title, note, text: body.text, problem: body.problem });
  });
  return out;
};

const baseName = (directory: string): string => {
  const parts = directory.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? directory;
};

const homeViewOf = (state: SystemState): SystemHomeView => {
  const home = state.home;
  if (home === undefined || home.kind === 'internal') return { kind: 'internal' };
  // T12b refines readability and the listProjects label; until then the folder's base name.
  return { kind: 'repo', directory: home.directory, label: baseName(home.directory), folder: home.folder, livingPage: home.livingPage, readable: true, problem: null, lastRead: state.snapshot?.at ?? null };
};

const buildViewOf = (build: BuildJson | null): BuildView | null =>
  build === null ? null : { mode: build.mode, dark: build.dark, calls: build.calls, access: build.access, round: build.round, applied: build.applied };

/** The sources line of a row and the detail. */
export const sourceLineOf = (state: SystemState): SourceLine => ({
  code: state.sources.code === null ? null : { directory: state.sources.code.directory, lastScan: state.sources.code.lastScan, partial: state.sources.code.partial },
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
  const components = readComponents(raw, files, defined, problems);
  const notes = readNotes(raw, source.texts, tooLarge, problems);
  const patterns = readEntryTexts('patterns', raw, source.texts, tooLarge, problems);
  const brand = readEntryTexts('brand', raw, source.texts, tooLarge, problems);
  const coverage = coveredAreas(raw);
  if (coverage.problem !== null) problems.push({ entry: 'coverage', message: coverage.problem });

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
    // T12b turns `state.buildProblem` into its sentence.
    buildProblem: null,
    coverage: coverage.areas,
    patterns,
    brand,
    snapshot: state.snapshot ? { at: state.snapshot.at, by: state.snapshot.by, tampered: state.snapshot.tampered } : null,
    codeDrift: state.codeDrift ? { ...state.codeDrift, unread: state.codeDrift.unread ?? [] } : null,
    livingPage: home.kind === 'repo' ? { state: null, sentence: null } : null,
    proposal: null,
    landed: state.landed ? { ...state.landed, sentence: null } : null,
    agentDrift: source.build?.drift ?? null,
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
  const facts: Record<SystemSection, unknown> = {
    overview: { overview: textHash(detail.overview?.text ?? null), notes: detail.notes.map((note) => ({ id: note.id, title: note.title, body: textHash(note.text) })) },
    colours: tokensOf(['colours']),
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
    })),
    patterns: detail.patterns.map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.title, note: entry.note, body: textHash(entry.text) })),
    brand: { entries: detail.brand.map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.title, note: entry.note, body: textHash(entry.text) })), logos },
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
export const isUsableSystemId = (id: string): boolean => SYSTEM_ID_PATTERN.test(id) && !isReservedSystemId(id);

/** A path in the system file contract (§5.10): `system.json`, `tokens.css`, `OVERVIEW.md`, `notes/<id>.md`, …. */
export const isSystemContractRel = (rel: string): boolean => notBuilt();

/** `BUILD.json` (schema `design-chamber/system-build@1`, §2.13): ≤ `SYSTEM_BUILD_JSON_MAX_BYTES`, else unreadable. */
export type ParsedBuildJson = { build: BuildJson | null; raw: JsonObject | null; problems: SystemProblem[]; unreadable: string | null };

export const parseBuildJson = (text: string): ParsedBuildJson => notBuilt();

/** `PROPOSAL.json` (schema `design-chamber/system-proposal@1`, §2.15): ≤ `SYSTEM_PROPOSAL_MAX_BYTES`, else unreadable. */
export type ParsedProposal = { proposal: ProposalJson | null; problems: SystemProblem[]; unreadable: string | null };

export const parseProposal = (text: string): ParsedProposal => notBuilt();
