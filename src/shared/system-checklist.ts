// The completeness checklist of a design system (documentation/specs/system-builder-depth.md §4.5, D7).
// Pure: no Node imports. A closed list of topic ids keyed by `system.json` `depth`; the check names
// missing ids only, never agent text. `outOfScope` (system.json) lists ids the agent decided the system
// does not cover, and those stop counting (the user's decision 4, 2026-11-27).
//
// `rules/system-reference/board-and-check.md` copies the table below for the agent; the two say the same.

import { motionValueKind } from './token-edit.ts';
import type { SystemArea, SystemDepth, SystemDetail, SystemToken, SystemTopicId } from './types.ts';

/** Every checklist topic id, the closed list `outOfScope` and the gap finding's detail draw from. */
export const SYSTEM_TOPIC_IDS: readonly SystemTopicId[] = Object.freeze([
  'surface', 'text', 'border', 'brand', 'status', 'type-styles', 'spacing', 'radius', 'pairs', 'dark-values',
  'state-colours', 'data-colours', 'control-sizes', 'breakpoints', 'elevation', 'layers', 'motion',
  'components', 'examples', 'focus-disabled',
  'voice', 'navigation', 'overlays', 'forms', 'feedback', 'states', 'data-display', 'accessibility', 'responsive',
  'logo', 'brand-colour', 'imagery', 'marketing',
  // system-builder-depth Phase 2 (T11): a full system's foundations ask for at least one icon.
  'icons',
] as const);

const TOPIC_SET: ReadonlySet<string> = new Set(SYSTEM_TOPIC_IDS);

export const isSystemTopicId = (value: unknown): value is SystemTopicId => typeof value === 'string' && TOPIC_SET.has(value);

/** The thresholds the table names; a test changes each by one and watches it fail. */
export const CHECKLIST_MIN = Object.freeze({ status: 3, typeStylesCore: 4, typeStylesFull: 6, spacing: 4 });

/** The topics each area asks of a depth, in the table's order (`tokens` asks the foundations core set only). */
const TOPICS: Readonly<Record<SystemArea, { core: readonly SystemTopicId[]; full: readonly SystemTopicId[] }>> = Object.freeze({
  foundations: {
    core: ['surface', 'text', 'border', 'brand', 'status', 'type-styles', 'spacing', 'radius', 'pairs', 'dark-values'],
    full: ['state-colours', 'data-colours', 'control-sizes', 'breakpoints', 'elevation', 'layers', 'motion', 'icons'],
  },
  components: { core: ['components', 'examples'], full: ['focus-disabled'] },
  patterns: { core: ['voice'], full: ['navigation', 'overlays', 'forms', 'feedback', 'states', 'data-display', 'accessibility', 'responsive', 'motion'] },
  brand: { core: ['logo'], full: ['brand-colour', 'imagery', 'marketing'] },
});

/** The topics one area asks of one depth. */
export const checklistTopics = (depth: SystemDepth, area: SystemArea): readonly SystemTopicId[] => {
  if (depth === 'tokens') return area === 'foundations' ? TOPICS.foundations.core : [];
  return depth === 'core' ? TOPICS[area].core : [...TOPICS[area].core, ...TOPICS[area].full];
};

// ---- what counts as having a topic ----

/** Interactive state colours, found by suffix (`--accent-hover`, `--row-selected`). */
const STATE_COLOUR = /-(hover|active|selected|disabled)$/;
/** Control heights and touch targets (`--control-md`, `--touch-min`). */
const CONTROL_SIZE = /^--(control|touch)(-|$)/;
/** A component that draws data: a chart or a table. */
const DATA_COMPONENT = /chart|table|graph|data-?grid/i;
/** Pattern kinds that are a topic of the same name (the overlay kind is the overlays topic). */
const PATTERN_KIND_TOPIC: Readonly<Partial<Record<SystemTopicId, string>>> = Object.freeze({
  voice: 'voice',
  navigation: 'navigation',
  overlays: 'overlay',
  forms: 'forms',
  feedback: 'feedback',
  states: 'states',
  'data-display': 'data-display',
  accessibility: 'accessibility',
  responsive: 'responsive',
});

const hasValue = (token: SystemToken): boolean => token.light !== null || token.dark !== null;
const colours = (detail: SystemDetail): SystemToken[] => detail.tokens.filter((token) => token.section === 'colours' && hasValue(token));
const inGroup = (detail: SystemDetail, group: SystemToken['group']): number => colours(detail).filter((token) => (token.group ?? 'other') === group).length;
const tokensIn = (detail: SystemDetail, section: SystemToken['section']): SystemToken[] => detail.tokens.filter((token) => token.section === section && hasValue(token));
const named = (detail: SystemDetail, pattern: RegExp): boolean => detail.tokens.some((token) => hasValue(token) && pattern.test(token.name));
/** A token in the motion section whose value is a time, or an easing (system-builder-depth T10a). */
const motionOfKind = (detail: SystemDetail, kind: 'time' | 'easing'): boolean =>
  tokensIn(detail, 'motion').some((token) => [token.light, token.dark].some((value) => value !== null && value.editable === 'ok' && motionValueKind(value.text) === kind));

/** A chart or table component, or a data-display pattern: then data colours and data display are asked. */
export const drawsData = (detail: SystemDetail): boolean =>
  detail.components.some((component) => DATA_COMPONENT.test(component.id) || DATA_COMPONENT.test(component.name)) || detail.patterns.some((entry) => entry.kind === 'data-display');

const hasPatternKind = (detail: SystemDetail, kind: string): boolean => detail.patterns.some((entry) => entry.kind === kind);

/**
 * The widest viewport that counts as a phone for the `responsive` topic (system-builder-depth T12b): the
 * default Phone is 390 px, and the rules' phone frames are 390; 480 takes the larger phones too.
 */
export const PHONE_VIEWPORT_MAX_WIDTH = 480;

/** A system screen of kind `page` drawn at a phone viewport (its own sizes, else the system's): it shows the layout responds. */
const hasPhonePageScreen = (detail: SystemDetail): boolean =>
  detail.screens.some((screen) => screen.kind === 'page' && (screen.viewports ?? detail.viewports).some((viewport) => viewport.width <= PHONE_VIEWPORT_MAX_WIDTH));
const hasBrandKind = (detail: SystemDetail, ...kinds: string[]): boolean => detail.brand.some((entry) => kinds.includes(entry.kind));

/** Whether the system has a topic, for one area (`motion` means tokens in foundations and an entry in patterns). */
const hasTopic = (detail: SystemDetail, area: SystemArea, topic: SystemTopicId, depth: SystemDepth): boolean => {
  if (area === 'patterns') {
    if (topic === 'motion') return hasPatternKind(detail, 'motion');
    if (topic === 'data-display' && !drawsData(detail)) return true;
    if (topic === 'responsive' && hasPhonePageScreen(detail)) return true;
    const kind = PATTERN_KIND_TOPIC[topic];
    return kind === undefined ? true : hasPatternKind(detail, kind);
  }
  switch (topic) {
    case 'surface':
    case 'text':
    case 'border':
    case 'brand':
      return inGroup(detail, topic) >= 1;
    case 'status':
      return inGroup(detail, 'status') >= CHECKLIST_MIN.status;
    case 'type-styles':
      return detail.type.length >= (depth === 'full' ? CHECKLIST_MIN.typeStylesFull : CHECKLIST_MIN.typeStylesCore);
    case 'spacing':
      return tokensIn(detail, 'spacing').length >= CHECKLIST_MIN.spacing;
    case 'radius':
      return tokensIn(detail, 'radius').length >= 1;
    case 'pairs':
      return detail.pairs.length >= 1;
    case 'dark-values': {
      const all = colours(detail);
      // Asked only when the system has any dark value; then every colour needs one.
      return !detail.tokens.some((token) => token.dark !== null) || all.every((token) => token.dark !== null);
    }
    case 'state-colours':
      return colours(detail).some((token) => STATE_COLOUR.test(token.name));
    case 'data-colours':
      return !drawsData(detail) || inGroup(detail, 'data') >= 1;
    case 'control-sizes':
      return named(detail, CONTROL_SIZE);
    case 'breakpoints':
      return detail.tokens.some((token) => token.breakpoint && hasValue(token));
    case 'elevation':
      return tokensIn(detail, 'shadows').length >= 1;
    case 'layers':
      return tokensIn(detail, 'layers').length >= 1;
    case 'motion':
      // The Phase 1 name rule still counts, so no older system gains a gap; else one time and one easing in the section.
      return (named(detail, /^--duration-/) && named(detail, /^--ease-/)) || (motionOfKind(detail, 'time') && motionOfKind(detail, 'easing'));
    case 'icons':
      return detail.icons.length >= 1;
    case 'components':
      return detail.components.length >= 1;
    case 'examples':
      return detail.components.every((component) => component.example !== null);
    case 'focus-disabled':
      return detail.components.every((component) => {
        const states = component.states.map((state) => state.toLowerCase());
        return !states.includes('hover') || (states.some((state) => state.startsWith('focus')) && states.includes('disabled'));
      });
    case 'logo':
      return detail.logos.length >= 1 || hasBrandKind(detail, 'logo-use');
    case 'brand-colour':
      return hasBrandKind(detail, 'colour');
    case 'imagery':
      return hasBrandKind(detail, 'imagery');
    case 'marketing':
      // A marketing screen counts too (system-builder-depth T12b): a whole page, a social card or an email.
      return hasBrandKind(detail, 'marketing', 'social', 'email') || detail.screens.some((screen) => screen.kind === 'marketing');
    default:
      return true;
  }
};

/**
 * The topics one covered area is missing for the system's depth, in the table's order, without those
 * the agent listed in `outOfScope`. Empty when the system sets no depth.
 */
export const missingTopics = (detail: SystemDetail, area: SystemArea): SystemTopicId[] => {
  const depth = detail.depth;
  if (depth === null) return [];
  const skipped = new Set(detail.outOfScope);
  return checklistTopics(depth, area).filter((topic) => !skipped.has(topic) && !hasTopic(detail, area, topic, depth));
};
