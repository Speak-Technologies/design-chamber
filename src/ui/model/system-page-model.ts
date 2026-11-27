// What the design system page shows (Phase 2.5 U2, technical design §9.3): the areas and sections of the
// panel, the review controls of one section, the Mark ready notice, and which board entry a section scrolls to.
// Pure: no DOM, no host, no store.

import { AREA_OF_SECTION, SYSTEM_AREAS, SYSTEM_SECTIONS } from '../../shared/system-json.ts';
import { BOARD_ENTRY_PATTERN, entryKeyOf, parseEntryKey, sectionOfEntry } from '../../shared/system-board.ts';
import { sectionLabel } from '../../shared/agent/system-prompts.ts';
import type { ColourGroup, ColourPairUse, ReviewState, SystemArea, SystemDepth, SystemDetail, SystemSection, SystemToken, SystemTopicId } from '../../shared/types.ts';
// Pure colour maths the board's Pairs block and the checks already share (no Node imports): one judge of a pair.
import { PAIR_LEVELS, pairSchemes, ratioText, staticPairRatio, type PairScheme } from '../../service/check/pair-contrast.ts';
import { plural } from './format.ts';

export const AREA_LABEL: Readonly<Record<SystemArea, string>> = Object.freeze({
  foundations: 'Foundations',
  components: 'Components',
  patterns: 'Patterns & voice',
  brand: 'Brand & marketing',
});

export const COLOUR_GROUP_LABEL: Readonly<Record<ColourGroup, string>> = Object.freeze({
  brand: 'Brand',
  surface: 'Surfaces',
  text: 'Text',
  border: 'Borders',
  status: 'Status',
  data: 'Data',
  other: 'Other',
});

export const REVIEW_LABEL: Readonly<Record<ReviewState, string>> = Object.freeze({
  'not-reviewed': 'Not reviewed',
  'looks-good': 'Looks good',
  'needs-work': 'Needs work',
});

export const NOT_COVERED = 'Not covered by this system.';

export type SectionRow = {
  section: SystemSection;
  label: string;
  /** "3 notes", "12 colours"; "Nothing yet" when the section has no entries. */
  count: string;
  covered: boolean;
  review: ReviewState;
  /** The row's accessible name: "Colours, 12 colours, Looks good". */
  ariaLabel: string;
};

export type AreaGroup = { area: SystemArea; label: string; meta: string; covered: boolean; rows: SectionRow[] };

export const tokensOf = (detail: SystemDetail, section: SystemSection): SystemToken[] =>
  detail.tokens.filter((token) => (token.section === 'other' ? 'sizes' : token.section) === section);

const COUNT_NOUN: Partial<Record<SystemSection, [string, string?]>> = {
  colours: ['colour'],
  spacing: ['value'],
  radius: ['value'],
  shadows: ['shadow'],
  layers: ['layer'],
  sizes: ['size'],
  components: ['component'],
  patterns: ['entry', 'entries'],
  brand: ['entry', 'entries'],
};

export const sectionCount = (detail: SystemDetail, section: SystemSection): number => {
  switch (section) {
    case 'overview':
      return (detail.overview?.text ? 1 : 0) + detail.notes.length;
    case 'typography':
      return detail.type.length;
    case 'components':
      return detail.components.length;
    case 'patterns':
      return detail.patterns.length;
    case 'brand':
      return detail.brand.length + detail.logos.length;
    case 'assets':
      return detail.fonts.length + detail.sourceFiles.length;
    default:
      return tokensOf(detail, section).length;
  }
};

export const countText = (detail: SystemDetail, section: SystemSection): string => {
  const count = sectionCount(detail, section);
  if (count === 0) return 'Nothing yet';
  if (section === 'overview') return plural(detail.notes.length + (detail.overview?.text ? 1 : 0), 'note');
  if (section === 'typography') return plural(count, 'style');
  if (section === 'assets') return plural(count, 'file');
  const noun = COUNT_NOUN[section] ?? ['entry', 'entries'];
  return count === 1 ? `1 ${noun[0]}` : `${count} ${noun[1] ?? `${noun[0]}s`}`;
};

export const isCovered = (detail: SystemDetail, section: SystemSection): boolean => detail.coverage.includes(AREA_OF_SECTION[section]);

export const sectionRow = (detail: SystemDetail, section: SystemSection): SectionRow => {
  const covered = isCovered(detail, section);
  const review = detail.review[section]?.state ?? 'not-reviewed';
  const count = covered ? countText(detail, section) : 'Not covered';
  return { section, label: sectionLabel(section), count, covered, review, ariaLabel: `${sectionLabel(section)}, ${count}${covered ? `, ${REVIEW_LABEL[review]}` : ''}` };
};

export const areaGroups = (detail: SystemDetail): AreaGroup[] =>
  SYSTEM_AREAS.map((area) => {
    const rows = SYSTEM_SECTIONS.filter((section) => AREA_OF_SECTION[section] === area).map((section) => sectionRow(detail, section));
    const covered = detail.coverage.includes(area);
    return { area, label: AREA_LABEL[area], covered, meta: covered ? plural(rows.length, 'section') : 'Not covered', rows };
  });

/** "4 of 12 reviewed" and the bar's width; only covered sections count. */
export const reviewProgress = (detail: SystemDetail): { text: string; done: number; total: number; percent: number } => {
  const covered = SYSTEM_SECTIONS.filter((section) => isCovered(detail, section));
  const done = covered.filter((section) => detail.review[section]?.state !== undefined && detail.review[section]?.state !== 'not-reviewed').length;
  const total = covered.length;
  return { text: `${done} of ${total} reviewed`, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
};

export const unreviewedSections = (detail: SystemDetail): SystemSection[] =>
  SYSTEM_SECTIONS.filter((section) => isCovered(detail, section) && (detail.review[section]?.state ?? 'not-reviewed') === 'not-reviewed');

// ---- Review controls: shown once, never both a state and its own button ----

export type ReviewFoot =
  | { kind: 'uncovered'; text: string }
  | { kind: 'ask'; text: string; actions: Array<'looks-good' | 'needs-work'> }
  | { kind: 'state'; state: Exclude<ReviewState, 'not-reviewed'>; text: string; actions: Array<'looks-good' | 'needs-work'> };

export const reviewFoot = (detail: SystemDetail, section: SystemSection): ReviewFoot => {
  if (!isCovered(detail, section)) return { kind: 'uncovered', text: NOT_COVERED };
  const state = detail.review[section]?.state ?? 'not-reviewed';
  if (state === 'looks-good') return { kind: 'state', state, text: 'Looks good', actions: ['needs-work'] };
  if (state === 'needs-work') return { kind: 'state', state, text: 'Needs work', actions: ['looks-good'] };
  return { kind: 'ask', text: `Does ${sectionLabel(section)} look right?`, actions: ['looks-good', 'needs-work'] };
};

export const REVIEW_BUTTON: Readonly<Record<'looks-good' | 'needs-work', string>> = Object.freeze({ 'looks-good': 'Looks good', 'needs-work': 'Needs work' });

// ---- Status and Mark ready ----

export type ReadyControl = { label: string; emphasis: 'primary' | 'none'; state: 'draft' | 'ready' };

/** Mark ready is the one filled primary while the system is a Draft; a Ready system has none. */
export const readyControl = (detail: Pick<SystemDetail, 'status'>): ReadyControl =>
  detail.status === 'draft' ? { label: 'Mark ready', emphasis: 'primary', state: 'draft' } : { label: 'Back to draft', emphasis: 'none', state: 'ready' };

export const readyNotice = (name: string, unreviewed: number): { title: string; body: string; action: string | null } =>
  unreviewed > 0
    ? { title: `${name} is ready.`, body: `${plural(unreviewed, 'section')} ${unreviewed === 1 ? 'wasn’t' : 'weren’t'} reviewed.`, action: unreviewed === 1 ? 'Review it' : `Review the ${unreviewed}` }
    : { title: `${name} is ready.`, body: '', action: null };

// ---- Board entries ----

/** The board entry a section scrolls to, or null when the section has none. */
export const firstEntryOf = (detail: SystemDetail, section: SystemSection): string | null => {
  const key = (kind: Parameters<typeof entryKeyOf>[0], id: string): string | null => {
    try {
      return entryKeyOf(kind, id);
    } catch {
      return null;
    }
  };
  switch (section) {
    case 'overview':
      return detail.overview?.text ? 'overview' : detail.notes[0] ? key('note', detail.notes[0].id) : null;
    case 'typography':
      return detail.type[0] ? key('type', detail.type[0].id) : detail.fonts.length > 0 ? key('font', '0') : null;
    case 'components':
      return detail.components[0] ? key('component', detail.components[0].id) : null;
    case 'patterns':
      return detail.patterns[0] ? key('pattern', detail.patterns[0].id) : null;
    case 'brand':
      return detail.brand[0] ? key('brand', detail.brand[0].id) : detail.logos.length > 0 ? key('logo', '0') : null;
    case 'assets':
      return detail.fonts.length > 0 ? key('font', '0') : null;
    default: {
      const first = tokensOf(detail, section)[0];
      return first ? key('token', first.name) : null;
    }
  }
};

/** The section a board click lands in (the frame's `entry` is advisory, so it is checked against the detail). */
export const sectionOfHit = (detail: SystemDetail, entry: string | undefined): SystemSection | null => {
  if (entry === undefined || !BOARD_ENTRY_PATTERN.test(entry)) return null;
  const parsed = parseEntryKey(entry);
  return parsed === null ? null : sectionOfEntry(parsed, detail);
};

/** The selector the frame resolves to scroll to and highlight an entry. */
export const entrySelector = (entry: string): string => `[data-dc-entry="${entry.replace(/["\\]/g, '\\$&')}"]`;

// ---- Header ----

// ---- Depth and scope (system-builder-depth D7, §4.3) ----

/** How complete the system means to be, in the interview's words. */
export const DEPTH_LABEL: Readonly<Record<SystemDepth, string>> = Object.freeze({
  tokens: 'Tokens only',
  core: 'Core system',
  full: 'Full system',
});

/** What each depth covers, as one sentence for the Overview. */
export const DEPTH_SENTENCE: Readonly<Record<SystemDepth, string>> = Object.freeze({
  tokens: 'Values and notes only. It has no components or patterns.',
  core: 'The foundations, the components your code has with every state, and the patterns those screens use.',
  full: 'A core system plus motion, navigation, overlays, forms, feedback and data display.',
});

/** The checklist topics in plain words; the record is closed, so a new topic id fails typecheck here. */
export const TOPIC_LABEL: Readonly<Record<SystemTopicId, string>> = Object.freeze({
  surface: 'Surface colours',
  text: 'Text colours',
  border: 'Border colours',
  brand: 'Brand colours',
  status: 'Status colours',
  'type-styles': 'Type styles',
  spacing: 'Spacing',
  radius: 'Corner radius',
  pairs: 'Colour pairs',
  'dark-values': 'Dark values',
  'state-colours': 'State colours',
  'data-colours': 'Data colours',
  'control-sizes': 'Control sizes',
  breakpoints: 'Breakpoints',
  elevation: 'Shadows',
  layers: 'Layers',
  motion: 'Motion',
  components: 'Components',
  examples: 'Live examples',
  'focus-disabled': 'Focus and disabled states',
  voice: 'Voice',
  navigation: 'Navigation',
  overlays: 'Overlays',
  forms: 'Forms',
  feedback: 'Feedback',
  states: 'Empty, loading and error states',
  'data-display': 'Data display',
  accessibility: 'Accessibility',
  responsive: 'Responsive behaviour',
  logo: 'Logo',
  'brand-colour': 'Brand colour',
  imagery: 'Imagery',
  marketing: 'Marketing',
});

/** Fields a detail from before system-builder-depth lacks; the service always sends them, tests and older fixtures may not. */
type ScopeFacts = Partial<Pick<SystemDetail, 'depth' | 'outOfScope'>>;

/** "Core system" and "3 topics left out"; nothing for a system with neither (an older one). */
export const scopeParts = (detail: ScopeFacts): string[] => {
  const parts: string[] = [];
  if (detail.depth) parts.push(DEPTH_LABEL[detail.depth]);
  const left = detail.outOfScope?.length ?? 0;
  if (left > 0) parts.push(`${plural(left, 'topic')} left out`);
  return parts;
};

/** "Left out on purpose: Motion, Marketing." for the tooltip; null when nothing was left out. */
export const leftOutText = (detail: ScopeFacts): string | null => {
  const topics = (detail.outOfScope ?? []).map((id) => TOPIC_LABEL[id] ?? id);
  return topics.length === 0 ? null : `Left out on purpose: ${topics.join(', ')}.`;
};

export type ScopeView = { depth: { label: string; sentence: string } | null; leftOut: string[] };

/** The Overview's scope block; null for a system that says neither (nothing to draw). */
export const scopeView = (detail: ScopeFacts): ScopeView | null => {
  const depth = detail.depth ? { label: DEPTH_LABEL[detail.depth], sentence: DEPTH_SENTENCE[detail.depth] } : null;
  const leftOut = (detail.outOfScope ?? []).map((id) => TOPIC_LABEL[id] ?? id);
  return depth === null && leftOut.length === 0 ? null : { depth, leftOut };
};

/**
 * "In Design Chamber · Core system · 3 topics left out · From a description · Used by 2 designs", or "Repo · shop · Core system · Used by 2 designs"
 * (the repo is the source). The depth comes right after where the system lives, so a narrow rail that cuts the line cuts the source first.
 */
export const homeLine = (detail: Pick<SystemDetail, 'home' | 'sources' | 'usedBy'> & ScopeFacts, sourceText: string | null): string => {
  const parts = detail.home.kind === 'repo' ? [`Repo · ${detail.home.label}`] : ['In Design Chamber'];
  parts.push(...scopeParts(detail));
  if (sourceText && detail.home.kind !== 'repo') parts.push(sourceText);
  parts.push(detail.usedBy === 0 ? 'Not used yet' : `Used by ${plural(detail.usedBy, 'design')}`);
  return parts.join(' · ');
};

/** The home line's tooltip: the repo's full path, or where an internal system is kept, then what was left out. */
export const homeTitle = (detail: Pick<SystemDetail, 'home'> & ScopeFacts): string => {
  const where = detail.home.kind === 'repo' ? detail.home.directory : 'Kept in your Designs folder';
  const left = leftOutText(detail);
  return left === null ? where : `${where}\n${left}`;
};

// ---- Kind labels of pattern and brand entries ----

/** The kinds in words; the same labels the board and the living page print. */
export const ENTRY_KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  layout: 'Layout',
  'do-dont': 'Do and don’t',
  voice: 'Voice',
  marketing: 'Marketing',
  imagery: 'Imagery',
  'logo-use': 'Logo use',
  other: 'Other',
  navigation: 'Navigation',
  overlay: 'Overlays',
  forms: 'Forms',
  'data-display': 'Data display',
  feedback: 'Feedback',
  states: 'Empty, loading and error',
  page: 'Page template',
  responsive: 'Responsive',
  motion: 'Motion',
  accessibility: 'Accessibility',
  colour: 'Brand colour',
  social: 'Social',
  email: 'Email',
});

/** A kind as the row prints it; a kind this build doesn't know (a newer service) reads as plain words, never a raw id. */
export const entryKindLabel = (kind: string): string => {
  const known = Object.hasOwn(ENTRY_KIND_LABEL, kind) ? ENTRY_KIND_LABEL[kind] : undefined;
  if (known !== undefined) return known;
  const words = kind.replace(/[-_]+/g, ' ').trim();
  return words === '' ? 'Other' : words.charAt(0).toUpperCase() + words.slice(1);
};

// ---- Colour pairs (system-builder-depth §4.4) ----

export const PAIR_MEASURED = 'Measured by the check';

const PAIR_USE_LABEL: Readonly<Record<ColourPairUse, string>> = Object.freeze({
  text: 'Body text',
  large: 'Large text',
  ui: 'Interface part',
});

export type PairGround = {
  scheme: PairScheme;
  label: 'Light' | 'Dark';
  /** The two values to draw the sample with (the dark ground takes dark values, falling back to light), or null. */
  fg: string | null;
  bg: string | null;
  /** "7.21:1", or "Measured by the check" when Node can't parse both values. */
  ratio: string;
  /** True when the ratio is known and under the level the use needs. */
  low: boolean;
  /** What a screen reader hears: "Light, 7.21:1" or "Dark, 2.90:1, under 4.5:1". */
  ariaLabel: string;
};

export type PairView = {
  /** Where the pair sits in `detail.pairs`: the board entry is `pair:<index>`. */
  index: number;
  name: string;
  /** "Body text, needs 4.5:1". */
  use: string;
  note: string;
  /** Found from the token names, not written down. */
  auto: boolean;
  grounds: PairGround[];
};

const valueOf = (token: SystemToken | undefined, scheme: PairScheme): string | null => {
  const value = scheme === 'dark' ? (token?.dark ?? token?.light ?? null) : (token?.light ?? null);
  return value === null || value.editable !== 'ok' ? null : value.text;
};

/** One row per pair, declared first then automatic, as the service lists them. Empty for a system without any (an older one). */
export const pairViews = (detail: Pick<SystemDetail, 'tokens'> & Partial<Pick<SystemDetail, 'pairs'>>): PairView[] => {
  const pairs = detail.pairs ?? [];
  if (pairs.length === 0) return [];
  const tokens = new Map(detail.tokens.map((token) => [token.name, token]));
  const schemes = pairSchemes(detail);
  return pairs.map((pair, index) => {
    const level = PAIR_LEVELS[pair.use];
    const grounds = schemes.map((scheme): PairGround => {
      const label = scheme === 'dark' ? 'Dark' : 'Light';
      const ratio = staticPairRatio(detail, pair, scheme);
      const low = ratio !== null && ratio < level;
      const text = ratio === null ? PAIR_MEASURED : ratioText(ratio);
      return {
        scheme,
        label,
        fg: valueOf(tokens.get(pair.fg), scheme),
        bg: valueOf(tokens.get(pair.bg), scheme),
        ratio: text,
        low,
        ariaLabel: `${label}, ${text}${low ? `, under ${level}:1` : ''}`,
      };
    });
    return {
      index,
      name: `${pair.fg} on ${pair.bg}`,
      use: `${PAIR_USE_LABEL[pair.use]}, needs ${PAIR_LEVELS[pair.use]}:1`,
      note: pair.note,
      auto: pair.auto,
      grounds,
    };
  });
};


export type LivingPill = { label: string; tone: 'success' | 'warning' | 'error' | 'info'; title: string };

/**
 * The repo-backed system's living-page state as one small pill (technical design §9.6 table, the rail's one line about it).
 * Null for an internal system or while the service hasn't judged the page. Actions for it live on the full-screen page.
 */
export const livingPagePill = (detail: Pick<SystemDetail, 'home' | 'livingPage'>): LivingPill | null => {
  if (detail.home.kind !== 'repo' || detail.livingPage === null || detail.livingPage.state === null) return null;
  const repo = detail.home.label;
  const title = detail.livingPage.sentence ?? '';
  switch (detail.livingPage.state) {
    case 'fresh':
      return { label: 'Living page up to date', tone: 'success', title };
    case 'out-of-date':
      return { label: 'Living page out of date', tone: 'warning', title };
    case 'missing':
      return { label: `Living page not in ${repo} yet`, tone: 'warning', title };
    case 'changed':
      return { label: `Living page changed in ${repo}`, tone: 'warning', title };
    case 'reformatted':
      return { label: 'Living page reformatted', tone: 'info', title };
    case 'unsafe':
      return { label: 'Living page can’t be checked as safe', tone: 'error', title };
    case 'unreadable':
      return { label: 'Living page can’t be read', tone: 'error', title };
  }
};

/** The line under the rail's buttons: where values are changed. Never an editor on the rail. */
export const railHint = (detail: Pick<SystemDetail, 'home' | 'name'>): string =>
  detail.home.kind === 'repo'
    ? `${detail.name} lives in ${detail.home.label}. Change the values there, or ask the agent here.`
    : 'To edit values, open Design Chamber full screen: sidebar, Extension pages, Design Chamber.';

/** The colour scheme the board is drawn in follows the host. */
export const boardScheme = (mode: 'light' | 'dark' | undefined): 'light' | 'dark' => (mode === 'dark' ? 'dark' : 'light');

/** Phone: which of the two views is on screen. */
export type PhoneView = 'board' | 'sections';

/** What the ask bar's chip says about a board entry: the token's name, the style's, the component's. */
export const entryLabel = (detail: SystemDetail, entry: string): { tag: string; text: string } => {
  const parsed = parseEntryKey(entry);
  if (parsed === null) return { tag: 'entry', text: '' };
  switch (parsed.kind) {
    case 'token':
      return { tag: 'token', text: parsed.key };
    case 'type':
      return { tag: 'type', text: detail.type.find((style) => style.id === parsed.key)?.name ?? parsed.key };
    case 'component':
      return { tag: 'component', text: detail.components.find((component) => component.id === parsed.key)?.name ?? parsed.key };
    case 'overview':
      return { tag: 'overview', text: 'Overview' };
    case 'note':
      return { tag: 'note', text: detail.notes.find((note) => note.id === parsed.key)?.title ?? parsed.key };
    case 'pattern':
      return { tag: 'pattern', text: detail.patterns.find((entry) => entry.id === parsed.key)?.title ?? parsed.key };
    case 'brand':
      return { tag: 'brand', text: detail.brand.find((entry) => entry.id === parsed.key)?.title ?? parsed.key };
    case 'font':
      return { tag: 'font', text: detail.fonts[Number(parsed.key)]?.family ?? 'Font' };
    case 'logo':
      return { tag: 'logo', text: detail.logos[Number(parsed.key)]?.variant ?? 'Logo' };
    case 'pair': {
      const pair = detail.pairs[Number(parsed.key)];
      return { tag: 'pair', text: pair === undefined ? 'Colour pair' : `${pair.fg} on ${pair.bg}` };
    }
  }
};

/** "From tidepool-web", "From brand files", "From a description"; null when the system has no recorded source. */
export const sourceText = (sources: SystemDetail['sources'], folder: (path: string) => string, ago?: (iso: string) => string): string | null => {
  if (sources.code) {
    const when = ago ? ago(sources.code.lastScan) : '';
    return when === '' ? `From ${folder(sources.code.directory)}` : `Synced with ${folder(sources.code.directory)} ${when}`;
  }
  if (sources.brand > 0) return 'From brand files';
  if (sources.description) return 'From a description';
  return null;
};
