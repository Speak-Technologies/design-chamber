// The motion section of a design system (documentation/specs/system-builder-depth.md §4.6, §13 T10a):
// which tokens classify into it (by name, by `section` meta, and a Phase 1 `other` read as motion), the
// value shape it validates (a time or an easing, `cubic-bezier()` and `steps()` within their limits, and
// those functions refused in every other section), the board layouts it takes, the checklist's motion
// topic, and what the new section does to reviews and Ready systems made before it.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SYSTEM_MOTION_DURATION_MAX_MS, SYSTEM_MOTION_STEPS_MAX } from '../../src/shared/limits.ts';
import { missingTopics } from '../../src/shared/system-checklist.ts';
import {
  AREA_OF_SECTION,
  buildSystemDetail,
  deriveReview,
  LAYOUTS_OF_SECTION,
  parseSystemState,
  sectionFingerprints,
  SYSTEM_SECTIONS,
  SYSTEM_TOKEN_RULES,
  type SystemDetailSource,
  type SystemTokenRules,
} from '../../src/shared/system-json.ts';
import { classifyToken, motionValueKind, planTokenEdit, resolveTokenSection, validateTokenValue } from '../../src/shared/token-edit.ts';
import type { SystemDetail, SystemState } from '../../src/shared/types.ts';

const NOW = '2026-11-27T10:00:00.000Z';

const state = (overrides: Partial<SystemState> = {}): SystemState => ({ ...parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW), ...overrides });

const source = (lines: readonly string[], json: Record<string, unknown> = {}, overrides: Partial<SystemDetailSource> = {}): SystemDetailSource => ({
  id: 'acme',
  dir: '/designs/_systems/acme',
  state: state(),
  systemJson: JSON.stringify(json),
  tokensCss: `:root {\n${lines.map((line) => `  ${line}`).join('\n')}\n}\n`,
  texts: {},
  files: [],
  build: null,
  ...overrides,
});

const sectionOf = (detail: SystemDetail, name: string): string | undefined => detail.tokens.find((token) => token.name === name)?.section;

/** How a Phase 1 build read tokens: the same rules, with no motion section (motion names landed in `other`). */
const PHASE_ONE_RULES: SystemTokenRules = {
  ...SYSTEM_TOKEN_RULES,
  classify: (name, value) => {
    const section = classifyToken(name, value);
    return section === 'motion' ? 'other' : section;
  },
};

/** A Phase 1 system as the motion reference doc told the agent to write it: motion tokens with `section: "other"`. */
const PHASE_ONE_LINES = ['--space-4: 16px;', '--container-max: 1200px;', '--duration-fast: 120ms;', '--duration-slow: 320ms;', '--ease-out: ease-out;'];
const PHASE_ONE_JSON = { tokens: { '--duration-fast': { section: 'other', note: 'Hover and press.' }, '--ease-out': { section: 'other' } } };

describe('motion values (validateTokenValue)', () => {
  const cases: [string, boolean][] = [
    ['0ms', true],
    ['120ms', true],
    ['0.2s', true],
    ['.25s', true],
    [`${SYSTEM_MOTION_DURATION_MAX_MS}ms`, true],
    [`${SYSTEM_MOTION_DURATION_MAX_MS + 1}ms`, false],
    [`${SYSTEM_MOTION_DURATION_MAX_MS / 1000}s`, true],
    [`${SYSTEM_MOTION_DURATION_MAX_MS / 1000 + 0.001}s`, false],
    ['-1ms', false],
    ['120', false],
    ['120px', false],
    ['linear', true],
    ['ease', true],
    ['ease-in', true],
    ['ease-out', true],
    ['EASE-IN-OUT', true],
    ['ease-sideways', false],
    ['cubic-bezier(0.2, 0, 0, 1)', true],
    ['cubic-bezier(0.34, 1.56, 0.64, 1)', true],
    ['cubic-bezier(.4,0,.2,1)', true],
    ['cubic-bezier(1.2, 0, 0, 1)', false],
    ['cubic-bezier(0.2, 0, -0.1, 1)', false],
    ['cubic-bezier(0.2, 0, 0)', false],
    ['cubic-bezier(0.2, 0, 0, 1, 1)', false],
    ['cubic-bezier(a, 0, 0, 1)', false],
    ['steps(1)', true],
    ['steps(4, end)', true],
    ['steps(4, start)', true],
    [`steps(${SYSTEM_MOTION_STEPS_MAX})`, true],
    [`steps(${SYSTEM_MOTION_STEPS_MAX + 1})`, false],
    ['steps(0)', false],
    ['steps(2.5)', false],
    ['steps(4, middle)', false],
    ['var(--duration-base)', true],
    ['120ms ease-out', false],
    ['url(x)', false],
    ['200ms; color: red', false],
  ];
  for (const [value, ok] of cases) {
    test(`motion: ${value} → ${ok ? 'valid' : 'refused'}`, () => assert.equal(validateTokenValue('motion', null, value).ok, ok));
  }

  test('a refusal names the motion shape, without an em dash', () => {
    const answer = validateTokenValue('motion', null, 'fast');
    assert.ok(!answer.ok && /time/.test(answer.sentence) && /easing/.test(answer.sentence) && !answer.sentence.includes('—'));
  });

  test('cubic-bezier() and steps() pass in the motion section only', () => {
    for (const section of ['other', 'typography', 'sizes', 'colours'] as const) {
      assert.equal(validateTokenValue(section, null, 'cubic-bezier(0.2, 0, 0, 1)').ok, false, section);
      assert.equal(validateTokenValue(section, null, 'steps(4, end)').ok, false, section);
    }
    // A type field never takes them either.
    assert.equal(validateTokenValue('motion', 'family', 'cubic-bezier(0.2, 0, 0, 1)').ok, false);
  });

  test('a time and an easing tell themselves apart', () => {
    assert.equal(motionValueKind('200ms'), 'time');
    assert.equal(motionValueKind('ease-out'), 'easing');
    assert.equal(motionValueKind('steps(3)'), 'easing');
    assert.equal(motionValueKind('16px'), null);
  });
});

describe('motion classification', () => {
  const cases: [string, string, string][] = [
    ['--duration-fast', '120ms', 'motion'],
    ['--ease-out', 'ease-out', 'motion'],
    ['--ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)', 'motion'],
    ['--motion-enter', 'var(--ease-out)', 'motion'],
    ['--Duration-Base', '0.2s', 'motion'],
    // A motion name holding something else is classified as before.
    ['--motion-distance', '8px', 'other'],
    ['--motion-accent', '#2456d6', 'colours'],
    // A motion value under another name is not motion.
    ['--transition-fast', '120ms', 'other'],
  ];
  for (const [name, value, section] of cases) {
    test(`${name}: ${value} → ${section}`, () => assert.equal(classifyToken(name, value), section));
  }

  test('a recorded section wins, except a recorded other on a motion token', () => {
    assert.equal(resolveTokenSection(null, 'motion'), 'motion');
    assert.equal(resolveTokenSection('other', 'motion'), 'motion');
    assert.equal(resolveTokenSection('other', 'sizes'), 'other');
    assert.equal(resolveTokenSection('sizes', 'motion'), 'sizes');
    assert.equal(resolveTokenSection('motion', 'other'), 'motion');
  });

  test('an existing system with --duration-fast in other reads it under motion, and the Sizes section no longer lists it', () => {
    const before = buildSystemDetail(source(PHASE_ONE_LINES, PHASE_ONE_JSON), PHASE_ONE_RULES);
    assert.equal(sectionOf(before, '--duration-fast'), 'other');
    const detail = buildSystemDetail(source(PHASE_ONE_LINES, PHASE_ONE_JSON));
    for (const name of ['--duration-fast', '--duration-slow', '--ease-out']) assert.equal(sectionOf(detail, name), 'motion', name);
    assert.equal(sectionOf(detail, '--container-max'), 'sizes');
    // The note recorded with the token travels with it.
    assert.equal(detail.tokens.find((token) => token.name === '--duration-fast')?.note, 'Hover and press.');
    assert.deepEqual(detail.problems, []);
  });

  test('section: "motion" meta is a section system.json may record, on any name', () => {
    const detail = buildSystemDetail(source(['--enter: 240ms;'], { tokens: { '--enter': { section: 'motion' } } }));
    assert.equal(sectionOf(detail, '--enter'), 'motion');
    assert.deepEqual(detail.problems, []);
    assert.equal(detail.tokens[0]?.light?.editable, 'ok');
  });

  test('a motion token with a value that is not a time or an easing is shown unreadable with the motion shape', () => {
    const detail = buildSystemDetail(source(['--enter: fast;'], { tokens: { '--enter': { section: 'motion' } } }));
    assert.equal(detail.tokens[0]?.light?.editable, 'unreadable');
    assert.match(detail.tokens[0]?.light?.problem ?? '', /easing/);
  });

  test('the motion section is a foundation after shadows and takes card, compact and table', () => {
    assert.equal(AREA_OF_SECTION.motion, 'foundations');
    assert.equal(SYSTEM_SECTIONS.indexOf('motion'), SYSTEM_SECTIONS.indexOf('shadows') + 1);
    assert.deepEqual(LAYOUTS_OF_SECTION.motion, ['card', 'compact', 'table']);
    const detail = buildSystemDetail(source([], { layout: { motion: 'table' } }));
    assert.equal(detail.boardLayout.sections.motion, 'table');
    assert.equal(buildSystemDetail(source([], { layout: { motion: 'full' } })).boardLayout.ignored[0]?.reason, 'not-here');
  });
});

describe('hand edits of motion tokens', () => {
  const css = ':root {\n  --ease-out: ease-out;\n  --duration-fast: 120ms;\n}\n';

  test('an easing takes a cubic-bezier() even when system.json recorded other', () => {
    const plan = planTokenEdit(css, [{ kind: 'set', name: '--ease-out', mode: 'light', value: 'cubic-bezier(0.2, 0, 0, 1)' }], { contexts: 'system', sectionOf: () => 'other' });
    assert.ok('result' in plan);
    assert.match(plan.result, /--ease-out: cubic-bezier\(0\.2, 0, 0, 1\);/);
  });

  test('a duration refuses a value over the cap, naming the shape', () => {
    const plan = planTokenEdit(css, [{ kind: 'set', name: '--duration-fast', mode: 'light', value: '20s' }], { contexts: 'system' });
    assert.ok('refusal' in plan && /time/.test(plan.refusal));
  });
});

describe('the motion checklist topic', () => {
  const full = (lines: readonly string[], tokens: Record<string, unknown> = {}): SystemDetail =>
    buildSystemDetail(source(lines, { depth: 'full', tokens, patterns: [{ id: 'motion', kind: 'motion', title: 'Motion' }] }));
  const asks = (detail: SystemDetail): boolean => missingTopics(detail, 'foundations').includes('motion');

  test('one duration and one easing in the section satisfy it, under any name', () => {
    const meta = { '--enter': { section: 'motion' }, '--curve': { section: 'motion' } };
    assert.equal(asks(full(['--enter: 240ms;', '--curve: cubic-bezier(0.2, 0, 0, 1);'], meta)), false);
    // Two times and no easing, or two easings and no time, still miss it.
    assert.equal(asks(full(['--enter: 240ms;', '--curve: 120ms;'], meta)), true);
    assert.equal(asks(full(['--enter: ease-in;', '--curve: steps(4);'], meta)), true);
  });

  test('the Phase 1 name rule still counts, so no older system gains a gap', () => {
    assert.equal(asks(full(['--duration-fast: 120ms;', '--ease-out: ease-out;'])), false);
    assert.equal(asks(buildSystemDetail(source(PHASE_ONE_LINES, { ...PHASE_ONE_JSON, depth: 'full' }))), false);
    // A token whose value is a formula counts by its name, as before.
    assert.equal(asks(full(['--duration-fast: var(--d);', '--ease-out: var(--e);'])), false);
    assert.equal(asks(full(['--duration-fast: 120ms;'])), true);
  });
});

describe('reviews and Ready systems when the motion section appears', () => {
  test('the Sizes fingerprint of a system whose motion tokens lived in other changes once; every other section stays (open question 8)', () => {
    const old = sectionFingerprints(buildSystemDetail(source(PHASE_ONE_LINES, PHASE_ONE_JSON), PHASE_ONE_RULES));
    const now = sectionFingerprints(buildSystemDetail(source(PHASE_ONE_LINES, PHASE_ONE_JSON)));
    assert.deepEqual(
      SYSTEM_SECTIONS.filter((section) => section !== 'motion' && old[section] !== now[section]),
      ['sizes'],
    );
    // Once: reading again gives the same fingerprints.
    assert.deepEqual(sectionFingerprints(buildSystemDetail(source(PHASE_ONE_LINES, PHASE_ONE_JSON))), now);
    // A Sizes review recorded against the old fingerprint reads as not reviewed; the others keep theirs.
    const reviewed = state({
      review: {
        sizes: { state: 'looks-good', fingerprint: old.sizes, at: NOW },
        spacing: { state: 'looks-good', fingerprint: old.spacing, at: NOW },
      },
    });
    const { review } = deriveReview(reviewed, now);
    assert.equal(review.sizes.state, 'not-reviewed');
    assert.equal(review.spacing.state, 'looks-good');
  });

  test('a system with no motion tokens keeps every fingerprint, and a Ready one made before the section has nothing to review', () => {
    const lines = ['--space-4: 16px;', '--container-max: 1200px;'];
    const old = sectionFingerprints(buildSystemDetail(source(lines), PHASE_ONE_RULES));
    const now = sectionFingerprints(buildSystemDetail(source(lines)));
    const { motion: _motion, ...olderReady } = old;
    assert.equal(deriveReview(state({ status: 'ready', readyFingerprints: olderReady }), now).changesToReview, false);
    // The motion section itself starts not reviewed, so marking a draft Ready lists it.
    assert.equal(deriveReview(state(), now).review.motion.state, 'not-reviewed');
  });

  test('a Ready system made before the section, with motion tokens in other, shows its Sizes change to review (accepted)', () => {
    const old = sectionFingerprints(buildSystemDetail(source(PHASE_ONE_LINES, PHASE_ONE_JSON), PHASE_ONE_RULES));
    const now = sectionFingerprints(buildSystemDetail(source(PHASE_ONE_LINES, PHASE_ONE_JSON)));
    const { motion: _motion, ...olderReady } = old;
    assert.equal(deriveReview(state({ status: 'ready', readyFingerprints: olderReady }), now).changesToReview, true);
  });
});
