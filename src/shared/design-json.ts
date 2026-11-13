// The design.json contract (docs/SPEC.md §6.2–§6.4): pure parse, normalise and merge.
//
// design.json is written by the user's chat agent, so it is untrusted input. Reading is
// tolerant: invalid agent fields are dropped with a `DesignWarning`, never fatal; unknown
// top-level keys are preserved (`extra`). Writing never re-serialises the normalised view —
// `mergeServiceFields` patches only the service-owned keys into the agent's raw object, so
// whatever the agent wrote (even fields this version cannot read) survives a service write.

import {
  ANCHOR_HTML_MAX,
  ANCHOR_SELECTOR_MAX,
  ANCHOR_TEXT_MAX,
  BRIDGE_COORD_MAX,
  BRIEF_MAX,
  COMMENT_BODY_MAX,
  COMMENT_ID_PATTERN,
  COMMENTS_MAX,
  DESIGN_JSON_VERSION,
  DIRECTION_NAME_MAX,
  PRESET_ID_PATTERN,
  PROJECT_DIRECTORY_MAX,
  SCREEN_DESCRIPTION_MAX,
  SCREEN_ID_PATTERN,
  SCREENS_MAX,
  SESSION_ID_MAX,
  STATE_JSON_VERSION,
  TITLE_MAX,
  TWEAK_CHOICE_LABEL_MAX,
  TWEAK_CHOICE_VALUE_PATTERN,
  TWEAK_CHOICES_MAX,
  TWEAK_CHOICES_MIN,
  TWEAK_LABEL_MAX,
  TWEAK_NUMBER_ABS_MAX,
  TWEAK_UNIT_PATTERN,
  TWEAK_VAR_PATTERN,
  TWEAKS_MAX,
  VIEWPORT_HEIGHT_MAX,
  VIEWPORT_HEIGHT_MIN,
  VIEWPORT_ID_PATTERN,
  VIEWPORT_LABEL_MAX,
  VIEWPORT_WIDTH_MAX,
  VIEWPORT_WIDTH_MIN,
  VIEWPORTS_MAX,
} from './limits.ts';
import { isBalancedQuotes } from './tokens-css.ts';
import type {
  AgentOwnedField,
  Comment,
  CommentAnchor,
  CommentStatus,
  DesignJson,
  DesignKind,
  DesignSystemStatus,
  DesignWarning,
  DirectionLetter,
  DirectionMark,
  IsoDate,
  JsonObject,
  JsonValue,
  Rect,
  RelPoint,
  Screen,
  ServiceOwnedField,
  ServiceState,
  Tweak,
  TweakChoice,
  TweakNumber,
  Viewport,
} from './types.ts';

export const DESIGN_SCHEMA = 'design-chamber/design@1';
/** The page entry file; the agent may not change it. */
export const ENTRY_FILE = 'index.html';
export const DESIGN_JSON_FILE = 'design.json';

export const VIEWPORT_LAPTOP: Readonly<Viewport> = Object.freeze({ id: 'laptop', label: 'Laptop', width: 1280, height: 800 });
export const VIEWPORT_PHONE: Readonly<Viewport> = Object.freeze({ id: 'phone', label: 'Phone', width: 390, height: 844 });

/** Canvas: Laptop + Phone. Page: Laptop (BRIEF defaults, SPEC §6.2). Fresh copies. */
export const defaultViewports = (kind: DesignKind): Viewport[] =>
  kind === 'canvas' ? [{ ...VIEWPORT_LAPTOP }, { ...VIEWPORT_PHONE }] : [{ ...VIEWPORT_LAPTOP }];

export const SERVICE_OWNED_FIELDS: readonly ServiceOwnedField[] = [
  'version', 'kind', 'created', 'brief', 'sessionId', 'projectDirectory', 'preset', 'entry', 'comments',
];
export const AGENT_OWNED_FIELDS: readonly AgentOwnedField[] = ['title', 'updated', 'viewports', 'screens', 'designSystem', 'tweaks'];

/** Canonical key order for files the service creates. */
const CANONICAL_ORDER: readonly (keyof DesignJson)[] = [
  'version', 'kind', 'title', 'created', 'updated', 'brief', 'sessionId', 'projectDirectory', 'preset', 'entry',
  'viewports', 'screens', 'designSystem', 'tweaks', 'comments',
];
const KNOWN_FIELDS: ReadonlySet<string> = new Set<string>(CANONICAL_ORDER);
const COMMENT_STATUSES: readonly CommentStatus[] = ['open', 'sent', 'resolved'];

/** The canvas screen file for a screen id. */
export const screenFileOf = (screenId: string): string => `screens/${screenId}.html`;

// ---- small guards ----

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const has = (record: Rec, key: string): boolean => Object.hasOwn(record, key);
const isFiniteNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= BRIDGE_COORD_MAX;
const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
/**
 * The one place the old kind name lives: `"artifact"` (written before pages were renamed)
 * reads as `"page"`. Anything else that is not a kind is `null`. The writer always writes `"page"`.
 */
export const normalizeKind = (value: unknown): DesignKind | null => {
  if (value === 'page' || value === 'canvas') return value;
  if (value === 'artifact') return 'page';
  return null;
};

/** An ISO-8601-looking timestamp that `Date.parse` accepts. */
export const isIsoDate = (value: unknown): value is IsoDate =>
  typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));

const nonEmpty = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
};

class Warnings {
  readonly list: DesignWarning[] = [];
  add(code: string, field: string | undefined, message: string): void {
    this.list.push(field === undefined ? { code, message } : { code, field, message });
  }
}

// ---- element parsers (exported: routes validate request bodies with them) ----

const parseRect = (value: unknown): Rect | null =>
  isRec(value) && isFiniteNum(value.x) && isFiniteNum(value.y) && isFiniteNum(value.w) && isFiniteNum(value.h) && value.w >= 0 && value.h >= 0
    ? { x: value.x, y: value.y, w: value.w, h: value.h }
    : null;

const parseRelPoint = (value: unknown): RelPoint | null =>
  isRec(value) && isFiniteNum(value.x) && isFiniteNum(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1
    ? { x: value.x, y: value.y }
    : null;

export const parseCommentAnchor = (value: unknown): CommentAnchor | null => {
  if (!isRec(value)) return null;
  const { selector, text, html } = value;
  if (typeof selector !== 'string' || selector.length < 1 || selector.length > ANCHOR_SELECTOR_MAX) return null;
  if (typeof text !== 'string' || text.length > ANCHOR_TEXT_MAX) return null;
  if (typeof html !== 'string' || html.length > ANCHOR_HTML_MAX) return null;
  const rect = parseRect(value.rect);
  const point = parseRelPoint(value.point);
  if (!rect || !point) return null;
  return { selector, text, html, rect, point };
};

export const parseComment = (value: unknown): Comment | null => {
  if (!isRec(value)) return null;
  const { id, screen, viewport, body, status, created } = value;
  if (typeof id !== 'string' || !COMMENT_ID_PATTERN.test(id)) return null;
  if (screen !== null && (typeof screen !== 'string' || !SCREEN_ID_PATTERN.test(screen))) return null;
  if (typeof viewport !== 'string' || !VIEWPORT_ID_PATTERN.test(viewport)) return null;
  if (typeof body !== 'string' || body.trim().length < 1 || body.length > COMMENT_BODY_MAX) return null;
  if (!COMMENT_STATUSES.includes(status as CommentStatus)) return null;
  if (!isIsoDate(created)) return null;
  const anchor = parseCommentAnchor(value.anchor);
  if (!anchor) return null;
  const sentAt = value.sentAt === undefined || value.sentAt === null ? null : isIsoDate(value.sentAt) ? value.sentAt : undefined;
  const sentVersion =
    value.sentVersion === undefined || value.sentVersion === null ? null : isIntIn(value.sentVersion, 1, Number.MAX_SAFE_INTEGER) ? value.sentVersion : undefined;
  if (sentAt === undefined || sentVersion === undefined) return null;
  return { id, screen, viewport, anchor, body, status: status as CommentStatus, created, sentAt, sentVersion };
};

const parseViewport = (value: unknown, index: number, warnings: Warnings): Viewport | null => {
  const field = `viewports[${index}]`;
  if (!isRec(value) || typeof value.id !== 'string' || !VIEWPORT_ID_PATTERN.test(value.id)) {
    warnings.add('invalid-viewport', field, `Viewport ${index + 1} has no valid id (letters, digits, - or _), so it is not shown.`);
    return null;
  }
  const { id } = value;
  if (!isIntIn(value.width, VIEWPORT_WIDTH_MIN, VIEWPORT_WIDTH_MAX) || !isIntIn(value.height, VIEWPORT_HEIGHT_MIN, VIEWPORT_HEIGHT_MAX)) {
    warnings.add(
      'invalid-viewport',
      field,
      `Viewport "${id}" needs a whole-number width ${VIEWPORT_WIDTH_MIN}–${VIEWPORT_WIDTH_MAX} and height ${VIEWPORT_HEIGHT_MIN}–${VIEWPORT_HEIGHT_MAX}, so it is not shown.`,
    );
    return null;
  }
  let label = nonEmpty(value.label, VIEWPORT_LABEL_MAX);
  if (label === null) {
    if (has(value, 'label')) warnings.add('invalid-viewport-label', `${field}.label`, `Viewport "${id}" has an unusable label; its id is shown instead.`);
    label = id;
  }
  return { id, label, width: value.width, height: value.height };
};

const normalizeFilePath = (value: string): string => value.replace(/\\/g, '/').replace(/^(\.\/)+/, '');

const parseScreen = (value: unknown, index: number, viewportIds: ReadonlySet<string>, warnings: Warnings): Screen | null => {
  const field = `screens[${index}]`;
  if (!isRec(value) || typeof value.id !== 'string' || !SCREEN_ID_PATTERN.test(value.id)) {
    warnings.add('invalid-screen', field, `Screen ${index + 1} has no valid id (lower-case letters, digits and -), so it is not shown.`);
    return null;
  }
  const { id } = value;
  const file = screenFileOf(id);
  if (has(value, 'file') && (typeof value.file !== 'string' || normalizeFilePath(value.file) !== file)) {
    warnings.add('invalid-screen-file', `${field}.file`, `Screen "${id}" must live in ${file}, so it is not shown.`);
    return null;
  }
  let title = nonEmpty(value.title, TITLE_MAX);
  if (title === null) {
    if (has(value, 'title')) warnings.add('invalid-screen-title', `${field}.title`, `Screen "${id}" has an unusable title; its id is shown instead.`);
    title = id;
  }
  const screen: Screen = { id, title, file };
  if (has(value, 'viewports')) {
    if (!Array.isArray(value.viewports)) {
      warnings.add('invalid-screen-viewports', `${field}.viewports`, `Screen "${id}" lists its viewports wrongly, so it shows at every viewport.`);
    } else {
      const known = value.viewports.filter((v): v is string => typeof v === 'string' && viewportIds.has(v));
      const unique = [...new Set(known)];
      if (unique.length !== value.viewports.length) {
        warnings.add('unknown-screen-viewport', `${field}.viewports`, `Screen "${id}" names viewports this design does not have; those are skipped.`);
      }
      if (unique.length > 0) screen.viewports = unique;
    }
  }
  if (has(value, 'description')) {
    if (typeof value.description === 'string' && value.description.length <= SCREEN_DESCRIPTION_MAX) {
      screen.description = value.description;
    } else {
      warnings.add('invalid-screen-description', `${field}.description`, `Screen "${id}" has a description over ${SCREEN_DESCRIPTION_MAX} characters; it is not shown.`);
    }
  }
  if (has(value, 'direction')) {
    const mark = parseDirectionMark(value.direction, id);
    if (mark === null) {
      warnings.add('invalid-direction', `${field}.direction`, `Screen "${id}" has a direction mark Design Chamber can't read, so it shows as a normal screen.`);
    } else {
      screen.direction = mark;
    }
  }
  return screen;
};

// ---- Direction marks (Phase 2 §6.1) ----

const DIRECTION_LETTERS: readonly DirectionLetter[] = ['A', 'B', 'C', 'D'];

/** The mark's own shape: `of` a screen id (never itself), a letter A to D, a name 1..40. */
const parseDirectionMark = (value: unknown, ownId: string): DirectionMark | null => {
  if (!isRec(value)) return null;
  if (typeof value.of !== 'string' || !SCREEN_ID_PATTERN.test(value.of) || value.of === ownId) return null;
  if (!DIRECTION_LETTERS.includes(value.letter as DirectionLetter)) return null;
  const name = nonEmpty(value.name, DIRECTION_NAME_MAX);
  if (name === null) return null;
  // Safe: membership in DIRECTION_LETTERS was checked just above.
  return { of: value.of, letter: value.letter as DirectionLetter, name };
};

/**
 * The list-wide mark rules, after the screens are parsed: `of` must be a listed screen, must
 * carry no direction key of its own as written (which makes cycles and chains impossible
 * without a graph walk), and each letter is used once per group, first in list order winning.
 * A broken mark is dropped and the screen shows as a normal row.
 */
const validateDirections = (rawById: ReadonlyMap<string, { entry: Rec; index: number }>, screens: Screen[], warnings: Warnings): void => {
  const listed = new Set(screens.map((screen) => screen.id));
  const letters = new Map<string, Map<DirectionLetter, string>>();
  for (const screen of screens) {
    const mark = screen.direction;
    if (mark === undefined) continue;
    const raw = rawById.get(screen.id);
    const field = raw === undefined ? 'screens.direction' : `screens[${raw.index}].direction`;
    const drop = (code: string, message: string): void => {
      warnings.add(code, field, message);
      delete screen.direction;
    };
    if (!listed.has(mark.of)) {
      drop('direction-orphan', `Screen "${screen.id}" is marked as a direction of "${mark.of}", which is not a screen here, so it shows as a normal screen.`);
      continue;
    }
    const ofRaw = rawById.get(mark.of);
    if (ofRaw !== undefined && has(ofRaw.entry, 'direction')) {
      drop('direction-chain', `Screen "${screen.id}" is marked as a direction of "${mark.of}", which is itself a direction, so it shows as a normal screen.`);
      continue;
    }
    const taken = letters.get(mark.of);
    const owner = taken?.get(mark.letter);
    if (owner !== undefined) {
      drop('direction-letter-taken', `Screen "${screen.id}" uses direction letter ${mark.letter}, which "${owner}" already has, so it shows as a normal screen.`);
      continue;
    }
    if (taken === undefined) letters.set(mark.of, new Map([[mark.letter, screen.id]]));
    else taken.set(mark.letter, screen.id);
  }
};

/**
 * The direction groups of a normalised screen list: one per root screen with at least one
 * valid member, members in letter order (Phase 2 §6.1). Roots are not members of their group.
 */
export const directionGroups = (screens: readonly Screen[]): { of: string; members: Screen[] }[] => {
  const groups = new Map<string, Screen[]>();
  for (const screen of screens) {
    if (screen.direction === undefined) continue;
    const members = groups.get(screen.direction.of);
    if (members === undefined) groups.set(screen.direction.of, [screen]);
    else members.push(screen);
  }
  return [...groups.entries()].map(([of, members]) => ({
    of,
    members: [...members].sort((a, b) => (a.direction?.letter ?? '').localeCompare(b.direction?.letter ?? '')),
  }));
};

const parseViewports = (raw: Rec, kind: DesignKind, warnings: Warnings): Viewport[] => {
  if (!has(raw, 'viewports')) return defaultViewports(kind);
  if (!Array.isArray(raw.viewports)) {
    warnings.add('invalid-viewports', 'viewports', 'The viewport list is not a list, so the default viewports are used.');
    return defaultViewports(kind);
  }
  const result: Viewport[] = [];
  const seen = new Set<string>();
  raw.viewports.forEach((entry, index) => {
    const viewport = parseViewport(entry, index, warnings);
    if (!viewport) return;
    if (seen.has(viewport.id)) {
      warnings.add('duplicate-viewport', `viewports[${index}]`, `Viewport "${viewport.id}" is listed twice; only the first is shown.`);
      return;
    }
    seen.add(viewport.id);
    result.push(viewport);
  });
  if (result.length > VIEWPORTS_MAX) {
    warnings.add('too-many-viewports', 'viewports', `Only the first ${VIEWPORTS_MAX} viewports are shown.`);
    result.length = VIEWPORTS_MAX;
  }
  if (result.length === 0) {
    warnings.add('no-valid-viewports', 'viewports', 'No usable viewport is listed, so the default viewports are used.');
    return defaultViewports(kind);
  }
  return result;
};

const parseScreens = (raw: Rec, kind: DesignKind, viewports: Viewport[], warnings: Warnings): Screen[] => {
  if (!has(raw, 'screens')) return [];
  if (kind === 'page') {
    if (Array.isArray(raw.screens) && raw.screens.length > 0) {
      warnings.add('screens-ignored', 'screens', 'This design is a page, so its screen list is ignored (it shows index.html).');
    }
    return [];
  }
  if (!Array.isArray(raw.screens)) {
    warnings.add('invalid-screens', 'screens', 'The screen list is not a list, so no screens are shown.');
    return [];
  }
  const viewportIds = new Set(viewports.map((v) => v.id));
  const result: Screen[] = [];
  const seen = new Set<string>();
  /** The raw entry each listed screen came from, for the direction rules ("as written", §6.1). */
  const rawById = new Map<string, { entry: Rec; index: number }>();
  raw.screens.forEach((entry, index) => {
    const screen = parseScreen(entry, index, viewportIds, warnings);
    if (!screen) return;
    if (seen.has(screen.id)) {
      warnings.add('duplicate-screen', `screens[${index}]`, `Screen "${screen.id}" is listed twice; only the first is shown.`);
      return;
    }
    seen.add(screen.id);
    result.push(screen);
    // Safe: parseScreen answered a screen, so this entry is a record with a valid id.
    rawById.set(screen.id, { entry: entry as Rec, index });
  });
  if (result.length > SCREENS_MAX) {
    warnings.add('too-many-screens', 'screens', `Only the first ${SCREENS_MAX} screens are shown.`);
    result.length = SCREENS_MAX;
  }
  validateDirections(rawById, result, warnings);
  return result;
};

// ---- Tweaks knobs (Phase 2 §4.1; agent values are untrusted, dropped with a warning, never fatal) ----

const CHOICE_REASON = 'a choice needs 2 to 6 options with distinct plain values';

const invalidTweak = (warnings: Warnings, index: number, reason: string): null => {
  warnings.add('invalid-tweak', `tweaks[${index}]`, `Tweak ${index + 1} in design.json is not usable (${reason}), so it is not shown.`);
  return null;
};

const parseTweakNumber = (value: Rec, index: number, warnings: Warnings, base: { var: string; label: string }): TweakNumber | null => {
  const { min, max, step } = value;
  if (
    !isFiniteNum(min) || !isFiniteNum(max) ||
    Math.abs(min) > TWEAK_NUMBER_ABS_MAX || Math.abs(max) > TWEAK_NUMBER_ABS_MAX ||
    min >= max
  ) {
    return invalidTweak(warnings, index, 'min must be below max');
  }
  // At most 4 decimals: the string form of a positive number shows them (an exponent means more).
  if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0 || step > max - min || !/^\d+(\.\d{1,4})?$/.test(String(step))) {
    return invalidTweak(warnings, index, 'step must be above 0 and fit the range');
  }
  const unit = value.unit === undefined ? '' : value.unit;
  if (typeof unit !== 'string' || !TWEAK_UNIT_PATTERN.test(unit)) {
    return invalidTweak(warnings, index, 'the unit must be letters or %');
  }
  return { ...base, kind: 'number', min, max, step, unit };
};

const parseTweakChoice = (value: Rec, index: number, warnings: Warnings, base: { var: string; label: string }): TweakChoice | null => {
  if (!Array.isArray(value.options) || value.options.length < TWEAK_CHOICES_MIN || value.options.length > TWEAK_CHOICES_MAX) {
    return invalidTweak(warnings, index, CHOICE_REASON);
  }
  const options: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const option of value.options) {
    if (!isRec(option)) return invalidTweak(warnings, index, CHOICE_REASON);
    const label = nonEmpty(option.label, TWEAK_CHOICE_LABEL_MAX);
    if (
      label === null ||
      typeof option.value !== 'string' ||
      !TWEAK_CHOICE_VALUE_PATTERN.test(option.value) ||
      !isBalancedQuotes(option.value) ||
      seen.has(option.value)
    ) {
      return invalidTweak(warnings, index, CHOICE_REASON);
    }
    seen.add(option.value);
    options.push({ label, value: option.value });
  }
  return { ...base, kind: 'choice', options };
};

const parseTweak = (value: unknown, index: number, warnings: Warnings): Tweak | null => {
  if (!isRec(value) || typeof value.var !== 'string' || !TWEAK_VAR_PATTERN.test(value.var)) {
    return invalidTweak(warnings, index, 'it needs a var like --accent');
  }
  const label = nonEmpty(value.label, TWEAK_LABEL_MAX);
  if (label === null) return invalidTweak(warnings, index, `its label must be 1 to ${TWEAK_LABEL_MAX} characters`);
  const base = { var: value.var, label };
  if (value.kind === 'number') return parseTweakNumber(value, index, warnings, base);
  if (value.kind === 'choice') return parseTweakChoice(value, index, warnings, base);
  return invalidTweak(warnings, index, 'its kind must be "number" or "choice"');
};

/** The knob list: invalid knobs dropped one by one, duplicate vars keep the first, at most `TWEAKS_MAX`. */
const parseTweaks = (raw: Rec, warnings: Warnings): Tweak[] => {
  if (!has(raw, 'tweaks')) return [];
  if (!Array.isArray(raw.tweaks)) {
    warnings.add('invalid-tweaks', 'tweaks', 'The tweak list is not a list, so no tweaks are shown.');
    return [];
  }
  const result: Tweak[] = [];
  const seen = new Set<string>();
  raw.tweaks.forEach((entry, index) => {
    const tweak = parseTweak(entry, index, warnings);
    if (tweak === null) return;
    if (seen.has(tweak.var)) {
      warnings.add('duplicate-tweak', `tweaks[${index}]`, `Two tweaks use ${tweak.var}; only the first is shown.`);
      return;
    }
    seen.add(tweak.var);
    result.push(tweak);
  });
  if (result.length > TWEAKS_MAX) {
    warnings.add('too-many-tweaks', 'tweaks', `Only the first ${TWEAKS_MAX} tweaks are shown.`);
    result.length = TWEAKS_MAX;
  }
  return result;
};

const parseComments = (raw: Rec, warnings: Warnings): Comment[] => {
  if (!has(raw, 'comments')) return [];
  if (!Array.isArray(raw.comments)) {
    warnings.add('invalid-comments', 'comments', 'The comment list is not a list, so no comments are shown.');
    return [];
  }
  const result: Comment[] = [];
  const seen = new Set<string>();
  raw.comments.forEach((entry, index) => {
    const comment = parseComment(entry);
    if (!comment || seen.has(comment.id)) {
      warnings.add('invalid-comment', `comments[${index}]`, `Comment ${index + 1} is damaged or repeated, so it is not shown.`);
      return;
    }
    seen.add(comment.id);
    result.push(comment);
  });
  if (result.length > COMMENTS_MAX) {
    warnings.add('too-many-comments', 'comments', `Only the first ${COMMENTS_MAX} comments are shown.`);
    result.length = COMMENTS_MAX;
  }
  return result;
};

const optionalString = (raw: Rec, key: string, max: number, warnings: Warnings, label: string): string | null => {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.length >= 1 && value.length <= max) return value;
  warnings.add(`invalid-${key}`, key, `The ${label} in design.json is not usable and is ignored.`);
  return null;
};

// ---- normalise ----

export type NormalizeOptions = {
  /** Authoritative kind (from `.chamber/state.json`, or the service's file-based guess). Without it, design.json's kind is used, else inferred. */
  kind?: DesignKind;
  /** Title when design.json has none (the service passes the slug). */
  fallbackTitle: string;
  /** Timestamp when `created`/`updated` are missing (the service passes the folder mtime). */
  fallbackTime: IsoDate;
};

export type NormalizedDesign = {
  design: DesignJson;
  /** Unknown top-level keys, verbatim. */
  extra: JsonObject;
  warnings: DesignWarning[];
};

/** The normalised view of an already-parsed design.json value. Never throws. */
export const normalizeDesign = (raw: unknown, options: NormalizeOptions): NormalizedDesign => {
  const warnings = new Warnings();
  const record: Rec = isRec(raw) ? raw : {};
  if (!isRec(raw)) warnings.add('invalid-design-json', undefined, 'design.json is not a JSON object, so defaults are shown.');

  if (has(record, 'version') && record.version !== DESIGN_JSON_VERSION) {
    warnings.add('unsupported-version', 'version', `design.json says version ${String(record.version)}; this Design Chamber reads version ${DESIGN_JSON_VERSION} and shows what it can.`);
  }

  let kind: DesignKind;
  const recordKind = normalizeKind(record.kind);
  if (options.kind) {
    kind = options.kind;
  } else if (recordKind !== null) {
    kind = recordKind;
  } else {
    kind = Array.isArray(record.screens) && record.screens.length > 0 ? 'canvas' : 'page';
    warnings.add('invalid-kind', 'kind', `design.json does not say whether this is a page or a canvas; it is shown as a ${kind}.`);
  }

  let title = nonEmpty(record.title, TITLE_MAX);
  if (title === null) {
    if (has(record, 'title')) warnings.add('invalid-title', 'title', `The title must be 1–${TITLE_MAX} characters; "${options.fallbackTitle}" is shown instead.`);
    title = options.fallbackTitle;
  }

  const time = (key: 'created' | 'updated'): IsoDate => {
    const value = record[key];
    if (isIsoDate(value)) return value;
    if (value !== undefined) warnings.add(`invalid-${key}`, key, `The ${key} time in design.json is not an ISO date and is ignored.`);
    return options.fallbackTime;
  };

  let brief = '';
  if (typeof record.brief === 'string') {
    brief = record.brief.length > BRIEF_MAX ? record.brief.slice(0, BRIEF_MAX) : record.brief;
    if (record.brief.length > BRIEF_MAX) warnings.add('brief-truncated', 'brief', `The brief is over ${BRIEF_MAX} characters; the rest is not shown.`);
  } else if (record.brief !== undefined && record.brief !== null) {
    warnings.add('invalid-brief', 'brief', 'The brief in design.json is not text and is ignored.');
  }

  const sessionId = optionalString(record, 'sessionId', SESSION_ID_MAX, warnings, 'linked chat id');
  const projectDirectory = optionalString(record, 'projectDirectory', PROJECT_DIRECTORY_MAX, warnings, 'project folder');
  let preset = optionalString(record, 'preset', 60, warnings, 'preset');
  if (preset !== null && !PRESET_ID_PATTERN.test(preset)) {
    warnings.add('invalid-preset', 'preset', 'The preset in design.json is not a preset id and is ignored.');
    preset = null;
  }

  let entry: string | null = null;
  if (kind === 'page') {
    entry = ENTRY_FILE;
    if (has(record, 'entry') && record.entry !== ENTRY_FILE) {
      warnings.add('invalid-entry', 'entry', `A page always shows ${ENTRY_FILE}; the entry in design.json is ignored.`);
    }
  }

  const viewports = parseViewports(record, kind, warnings);
  const screens = parseScreens(record, kind, viewports, warnings);

  let designSystem: DesignSystemStatus = { confirmed: false };
  if (has(record, 'designSystem')) {
    const value = record.designSystem;
    if (isRec(value) && typeof value.confirmed === 'boolean') designSystem = { confirmed: value.confirmed };
    else warnings.add('invalid-design-system', 'designSystem', 'designSystem must be { "confirmed": true | false }; it is treated as not confirmed.');
  }

  const tweaks = parseTweaks(record, warnings);
  const comments = parseComments(record, warnings);

  const extra: JsonObject = Object.fromEntries(
    // Safe: `record` came from JSON.parse (or is {}), so every value is JSON.
    Object.entries(record).filter(([key]) => !KNOWN_FIELDS.has(key)) as [string, JsonValue][],
  );

  return {
    design: {
      version: 1,
      kind,
      title,
      created: time('created'),
      updated: time('updated'),
      brief,
      sessionId,
      projectDirectory,
      preset,
      entry,
      viewports,
      screens,
      designSystem,
      tweaks,
      comments,
    },
    extra,
    warnings: warnings.list,
  };
};

export type ParsedDesignFile = NormalizedDesign & {
  /** The parsed object, or `null` when the text was not a JSON object (the agent may be mid-write: never write over it). */
  raw: JsonObject | null;
};

/** Parse design.json text. Invalid JSON yields defaults, `raw: null` and an `invalid-json` warning. */
export const parseDesignJsonText = (text: string, options: NormalizeOptions): ParsedDesignFile => {
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    const fallback = normalizeDesign({}, options);
    return { ...fallback, raw: null, warnings: [{ code: 'invalid-json', message: 'design.json is not valid JSON yet, so defaults are shown until the agent fixes it.' }, ...fallback.warnings] };
  }
  const normalized = normalizeDesign(value, options);
  // Safe: JSON.parse output that is a non-array object is a JsonObject.
  return { ...normalized, raw: isRec(value) ? (value as JsonObject) : null };
};

// ---- .chamber/state.json [§6.3] ----

/** Read state.json content. `null` when it is unusable (the store then rebuilds state from design.json). */
export const normalizeServiceState = (raw: unknown): ServiceState | null => {
  if (!isRec(raw) || raw.version !== STATE_JSON_VERSION || !isIsoDate(raw.created)) return null;
  const kind = normalizeKind(raw.kind);
  if (kind === null) return null;
  const check = new Warnings();
  const brief = typeof raw.brief === 'string' ? raw.brief.slice(0, BRIEF_MAX) : '';
  const sessionId = optionalString(raw, 'sessionId', SESSION_ID_MAX, check, '');
  const projectDirectory = optionalString(raw, 'projectDirectory', PROJECT_DIRECTORY_MAX, check, '');
  const presetValue = optionalString(raw, 'preset', 60, check, '');
  const preset = presetValue !== null && PRESET_ID_PATTERN.test(presetValue) ? presetValue : null;
  const comments = parseComments(raw, check);
  const state: ServiceState = {
    version: 1,
    kind,
    created: raw.created,
    brief,
    sessionId,
    projectDirectory,
    preset,
    entry: kind === 'page' ? ENTRY_FILE : null,
    comments,
  };
  // Only a literal `true` marks a provisional seed; any other value means final.
  if (raw.provisional === true) state.provisional = true;
  return state;
};

/** The service-owned fields of a normalised design (used to seed state.json for a folder that had none). */
export const serviceStateOf = (design: DesignJson): ServiceState => ({
  version: 1,
  kind: design.kind,
  created: design.created,
  brief: design.brief,
  sessionId: design.sessionId,
  projectDirectory: design.projectDirectory,
  preset: design.preset,
  entry: design.kind === 'page' ? ENTRY_FILE : null,
  comments: design.comments,
});

export type AdoptInput = {
  /** state.json as read (it may carry `provisional: true`). */
  state: ServiceState;
  /** design.json as parsed. Only call this with a file that parsed to an object. */
  raw: JsonObject;
  /** The normalised view of `raw`. For a provisional state its kind is design.json's own (given, else inferred from `screens`); otherwise the state's. */
  normalized: DesignJson;
  /** No entry or screen file written yet (`DesignRecord.pending`). */
  pending: boolean;
};

/**
 * The state the agent's design.json calls for, or `null` to keep `state` (§6.3 P2, P5).
 *
 * P2 (adoption): a provisional state was seeded from files before design.json landed. Now that
 * it parses, the agent's values win: kind (`normalizeKind(raw.kind)`, else the normalised kind),
 * created, brief, sessionId, projectDirectory and preset from the normalised design (so an invalid
 * agent value becomes the normalised one), comments = state's plus design.json's whose id state
 * does not hold (state wins a clash). The flag is dropped.
 *
 * P5 (kind switch): a final state adopts design.json's valid kind only while nothing is written
 * yet and nobody has commented; otherwise state wins as before.
 */
export const adoptAgentFields = ({ state, raw, normalized, pending }: AdoptInput): ServiceState | null => {
  const agentKind = normalizeKind(raw.kind);
  if (state.provisional === true) {
    const kind = agentKind ?? normalized.kind;
    const known = new Set(state.comments.map((comment) => comment.id));
    const comments = [...state.comments, ...normalized.comments.filter((comment) => !known.has(comment.id))].slice(0, COMMENTS_MAX);
    return {
      version: 1,
      kind,
      created: normalized.created,
      brief: normalized.brief,
      sessionId: normalized.sessionId,
      projectDirectory: normalized.projectDirectory,
      preset: normalized.preset,
      entry: kind === 'page' ? ENTRY_FILE : null,
      comments,
    };
  }
  if (pending && state.comments.length === 0 && agentKind !== null && agentKind !== state.kind) {
    return { ...state, kind: agentKind, entry: agentKind === 'page' ? ENTRY_FILE : null };
  }
  return null;
};

/** The view the service answers: design.json's agent fields with state.json's service fields on top. */
export const applyServiceState = (design: DesignJson, state: ServiceState): DesignJson => ({
  ...design,
  version: 1,
  kind: state.kind,
  created: state.created,
  brief: state.brief,
  sessionId: state.sessionId,
  projectDirectory: state.projectDirectory,
  preset: state.preset,
  entry: state.kind === 'page' ? ENTRY_FILE : null,
  comments: state.comments,
});

const stateValue = (state: ServiceState, key: ServiceOwnedField): JsonValue | undefined => {
  if (key === 'entry') return state.kind === 'page' ? ENTRY_FILE : undefined;
  // Safe: every ServiceState field is plain JSON (strings, nulls, numbers, Comment objects).
  return state[key] as unknown as JsonValue;
};

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** design.json's mirror of a service-owned field; `kind` goes through the alias so an old `"artifact"` matches `"page"`. */
const rawValue = (raw: JsonObject, key: ServiceOwnedField): unknown => {
  if (!has(raw, key)) return undefined;
  if (key === 'kind') return normalizeKind(raw.kind) ?? raw.kind;
  return raw[key];
};

/**
 * True when design.json's mirror of any service-owned field differs from state.json (§6.3 merge trigger).
 * The old `"artifact"` alias alone is not a difference, so it never triggers a write (it is rewritten
 * as `"page"` on the next real service write).
 */
export const serviceFieldsDiffer = (raw: JsonObject, state: ServiceState): boolean =>
  SERVICE_OWNED_FIELDS.some((key) => !sameJson(rawValue(raw, key), stateValue(state, key)));

/**
 * Agent-owned values the service itself writes: a user rename, the `updated` bump on service
 * writes, and the screen list for the user's screen actions (Phase 2 §5.1; the agent's later
 * write of the list still wins).
 */
export type ServiceWrite = { title?: string; updated?: IsoDate; screens?: JsonValue[] };

/**
 * design.json with state.json's service-owned fields merged into the agent's raw object.
 * Key order and every other key (agent fields, unknown keys, even invalid values) are kept;
 * missing service keys are appended. Never call it with a file that failed to parse.
 */
export const mergeServiceFields = (raw: JsonObject, state: ServiceState, write: ServiceWrite = {}): JsonObject => {
  const replacements = new Map<string, JsonValue | undefined>();
  for (const key of SERVICE_OWNED_FIELDS) replacements.set(key, stateValue(state, key));
  if (write.title !== undefined) replacements.set('title', write.title);
  if (write.updated !== undefined) replacements.set('updated', write.updated);
  if (write.screens !== undefined) replacements.set('screens', write.screens);

  const entries: [string, JsonValue][] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!replacements.has(key)) {
      entries.push([key, value]);
      continue;
    }
    const next = replacements.get(key);
    replacements.delete(key);
    if (next !== undefined) entries.push([key, next]);
  }
  for (const key of CANONICAL_ORDER) {
    if (!replacements.has(key)) continue;
    const next = replacements.get(key);
    if (next !== undefined) entries.push([key, next]);
  }
  return Object.fromEntries(entries);
};

/** The exact bytes the service writes for a JSON file (stable, so equal content means equal bytes). */
export const serializeJson = (value: JsonValue): string => `${JSON.stringify(value, null, 2)}\n`;

export type NewDesignInput = {
  kind: DesignKind;
  title: string;
  brief: string;
  sessionId: string | null;
  projectDirectory: string | null;
  preset: string | null;
  now: IsoDate;
};

/** state.json and design.json content for a design the service creates (§9.3). */
export const createDesignDocument = (input: NewDesignInput): { state: ServiceState; json: JsonObject } => {
  const state: ServiceState = {
    version: 1,
    kind: input.kind,
    created: input.now,
    brief: input.brief.slice(0, BRIEF_MAX),
    sessionId: input.sessionId,
    projectDirectory: input.projectDirectory,
    preset: input.preset,
    entry: input.kind === 'page' ? ENTRY_FILE : null,
    comments: [],
  };
  const agentPart: JsonObject = {
    title: input.title,
    updated: input.now,
    viewports: defaultViewports(input.kind),
    ...(input.kind === 'canvas' ? { screens: [] } : {}),
    designSystem: { confirmed: false },
  };
  return { state, json: orderCanonically(mergeServiceFields(agentPart, state)) };
};

const orderCanonically = (value: JsonObject): JsonObject =>
  Object.fromEntries(CANONICAL_ORDER.filter((key) => has(value, key)).map((key) => [key, value[key] as JsonValue]));

/** design.json as stored in a version snapshot: comments removed (§6.4). */
export const stripForVersion = (raw: JsonObject): JsonObject =>
  Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'comments'));
