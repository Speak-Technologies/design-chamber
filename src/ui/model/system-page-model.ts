// What the design system page shows (Phase 2.5 U2, technical design §9.3): the areas and sections of the
// panel, the review controls of one section, the Mark ready notice, and which board entry a section scrolls to.
// Pure: no DOM, no host, no store.

import { AREA_OF_SECTION, SYSTEM_AREAS, SYSTEM_SECTIONS } from '../../shared/system-json.ts';
import { BOARD_ENTRY_PATTERN, entryKeyOf, parseEntryKey, sectionOfEntry } from '../../shared/system-board.ts';
import { sectionLabel } from '../../shared/agent/system-prompts.ts';
import type { ColourGroup, ReviewState, SystemArea, SystemDetail, SystemSection, SystemToken } from '../../shared/types.ts';
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

export const homeLine = (detail: Pick<SystemDetail, 'home' | 'sources' | 'usedBy'>, sourceText: string | null): string => {
  const parts = ['In Design Chamber'];
  if (sourceText) parts.push(sourceText);
  parts.push(detail.usedBy === 0 ? 'Not used yet' : `Used by ${plural(detail.usedBy, 'design')}`);
  return parts.join(' · ');
};

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
  }
};

/** "From tidepool-web", "From brand files", "From a description"; null when the system has no recorded source. */
export const sourceText = (sources: SystemDetail['sources'], folder: (path: string) => string): string | null => {
  if (sources.code) return `From ${folder(sources.code.directory)}`;
  if (sources.brand > 0) return 'From brand files';
  if (sources.description) return 'From a description';
  return null;
};
