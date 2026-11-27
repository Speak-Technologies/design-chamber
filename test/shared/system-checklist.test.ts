// The completeness checklist (documentation/specs/system-builder-depth.md §4.5, D7, the user's decision 4):
// the closed topics per area and depth, what counts as having each one, each threshold at its boundary,
// outOfScope, and no check without a depth.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { checklistTopics, CHECKLIST_MIN, drawsData, missingTopics, SYSTEM_TOPIC_IDS } from '../../src/shared/system-checklist.ts';
import { buildSystemDetail, parseSystemState } from '../../src/shared/system-json.ts';
import type { SystemArea, SystemDetail } from '../../src/shared/types.ts';

const NOW = '2026-11-27T10:00:00.000Z';

/** A system from tokens.css lines (inside :root) and system.json keys; real token rules. */
const system = (lines: readonly string[], json: Record<string, unknown> = {}, dark: readonly string[] = [], files: readonly string[] = []): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(json),
    tokensCss: `:root {\n${lines.map((line) => `  ${line}`).join('\n')}\n}\n${dark.length > 0 ? `@media (prefers-color-scheme: dark) {\n  :root { ${dark.join(' ')} }\n}\n` : ''}`,
    texts: {},
    files: files.map((rel) => ({ rel, bytes: 1 })),
    build: null,
  });

const group = (names: readonly string[], value: string, group: string): { lines: string[]; meta: Record<string, unknown> } => ({
  lines: names.map((name) => `${name}: ${value};`),
  meta: Object.fromEntries(names.map((name) => [name, { group }])),
});

/** A full system: every topic present. */
const FULL = (() => {
  const parts = [
    group(['--surface', '--surface-hover'], '#ffffff', 'surface'),
    group(['--fg'], '#111111', 'text'),
    group(['--line'], '#dddddd', 'border'),
    group(['--brand'], '#2456d6', 'brand'),
    group(['--ok', '--warn', '--bad'], '#118811', 'status'),
    group(['--chart-1'], '#8430ce', 'data'),
  ];
  const lines = [
    ...parts.flatMap((part) => part.lines),
    '--brand-fg: #ffffff;',
    '--space-1: 4px;',
    '--space-2: 8px;',
    '--space-3: 12px;',
    '--space-4: 16px;',
    '--radius-md: 6px;',
    '--shadow-1: 0 1px 2px rgb(0 0 0 / 0.2);',
    '--z-modal: 100;',
    '--control-md: 40px;',
    '--bp-tablet: 768px;',
    '--duration-fast: 120ms;',
    '--ease-out: ease-out;',
  ];
  const json = {
    depth: 'full',
    tokens: { ...Object.assign({}, ...parts.map((part) => part.meta)), '--brand-fg': { group: 'text' } },
    type: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id.toUpperCase(), size: '16px' })),
    components: [{ id: 'button', name: 'Button', states: ['hover', 'focus', 'disabled'], example: 'components/button.html' }, { id: 'table', name: 'Table', example: 'components/table.html' }],
    patterns: ['voice', 'navigation', 'overlay', 'forms', 'feedback', 'states', 'data-display', 'accessibility', 'responsive', 'motion'].map((kind) => ({ id: kind, kind, title: kind })),
    brand: [
      { id: 'colour', kind: 'colour', title: 'Colour' },
      { id: 'imagery', kind: 'imagery', title: 'Imagery' },
      { id: 'hero', kind: 'marketing', title: 'Hero' },
    ],
    logos: [{ file: 'assets/logos/mark.svg' }],
    icons: [{ file: 'assets/icons/add.svg' }],
  };
  return { lines, json, files: ['components/button.html', 'components/table.html', 'assets/logos/mark.svg', 'assets/icons/add.svg'] };
})();

const full = (over: Record<string, unknown> = {}, lines: readonly string[] = FULL.lines, dark: readonly string[] = []): SystemDetail => system(lines, { ...FULL.json, ...over }, dark, FULL.files);
const missing = (detail: SystemDetail): Record<SystemArea, string[]> => ({
  foundations: missingTopics(detail, 'foundations'),
  components: missingTopics(detail, 'components'),
  patterns: missingTopics(detail, 'patterns'),
  brand: missingTopics(detail, 'brand'),
});

describe('the checklist table', () => {
  test('core and full topics per area, in the table order; tokens asks the foundations core set only', () => {
    assert.deepEqual(checklistTopics('core', 'foundations'), ['surface', 'text', 'border', 'brand', 'status', 'type-styles', 'spacing', 'radius', 'pairs', 'dark-values']);
    assert.deepEqual(checklistTopics('full', 'foundations').slice(10), ['state-colours', 'data-colours', 'control-sizes', 'breakpoints', 'elevation', 'layers', 'motion', 'icons']);
    assert.deepEqual(checklistTopics('core', 'components'), ['components', 'examples']);
    assert.deepEqual(checklistTopics('full', 'components'), ['components', 'examples', 'focus-disabled']);
    assert.deepEqual(checklistTopics('core', 'patterns'), ['voice']);
    assert.deepEqual(checklistTopics('full', 'patterns'), ['voice', 'navigation', 'overlays', 'forms', 'feedback', 'states', 'data-display', 'accessibility', 'responsive', 'motion']);
    assert.deepEqual(checklistTopics('core', 'brand'), ['logo']);
    assert.deepEqual(checklistTopics('full', 'brand'), ['logo', 'brand-colour', 'imagery', 'marketing']);
    assert.deepEqual(checklistTopics('tokens', 'foundations'), checklistTopics('core', 'foundations'));
    for (const area of ['components', 'patterns', 'brand'] as const) assert.deepEqual(checklistTopics('tokens', area), []);
  });

  test('every topic the table names is in the closed id list', () => {
    for (const depth of ['core', 'full'] as const) for (const area of ['foundations', 'components', 'patterns', 'brand'] as const) for (const topic of checklistTopics(depth, area)) assert.ok(SYSTEM_TOPIC_IDS.includes(topic), topic);
  });
});

describe('missingTopics', () => {
  test('no depth: nothing is ever missing, even in an empty system', () => {
    assert.deepEqual(missing(system([], {})), { foundations: [], components: [], patterns: [], brand: [] });
  });

  test('an empty core system misses every core topic (dark-values not asked without dark values)', () => {
    assert.deepEqual(missing(system([], { depth: 'core' })), {
      foundations: ['surface', 'text', 'border', 'brand', 'status', 'type-styles', 'spacing', 'radius', 'pairs'],
      components: ['components'],
      patterns: ['voice'],
      brand: ['logo'],
    });
  });

  test('a full system with every topic misses nothing', () => {
    assert.deepEqual(missing(full()), { foundations: [], components: [], patterns: [], brand: [] });
  });

  test('outOfScope topics stop counting, in every area they appear', () => {
    const detail = system([], { depth: 'full', outOfScope: ['motion', 'logo', 'voice', 'navigation'] });
    assert.ok(!missing(detail).foundations.includes('motion'));
    assert.ok(!missing(detail).patterns.includes('motion'));
    assert.ok(!missing(detail).patterns.includes('voice'));
    assert.ok(!missing(detail).patterns.includes('navigation'));
    assert.deepEqual(missing(detail).brand, ['brand-colour', 'imagery', 'marketing']);
  });

  test('thresholds at their boundary: status 3, type styles 4 (core) and 6 (full), spacing 4', () => {
    assert.deepEqual(CHECKLIST_MIN, { status: 3, typeStylesCore: 4, typeStylesFull: 6, spacing: 4 });
    const statusLines = (n: number) => FULL.lines.filter((line) => !/^--(ok|warn|bad):/.test(line)).concat(['--ok: #118811;', '--warn: #aa7700;', '--bad: #aa1111;'].slice(0, n));
    assert.ok(missing(full({}, statusLines(2))).foundations.includes('status'));
    assert.ok(!missing(full({}, statusLines(3))).foundations.includes('status'));
    const types = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `t${k}`, name: `T${k}`, size: '16px' }));
    assert.ok(missing(full({ type: types(5) })).foundations.includes('type-styles'));
    assert.ok(!missing(full({ type: types(6) })).foundations.includes('type-styles'));
    assert.ok(missing(full({ depth: 'core', type: types(3) })).foundations.includes('type-styles'));
    assert.ok(!missing(full({ depth: 'core', type: types(4) })).foundations.includes('type-styles'));
    const spacing = (n: number) => FULL.lines.filter((line) => !line.startsWith('--space-')).concat(['--space-1: 4px;', '--space-2: 8px;', '--space-3: 12px;', '--space-4: 16px;'].slice(0, n));
    assert.ok(missing(full({}, spacing(3))).foundations.includes('spacing'));
    assert.ok(!missing(full({}, spacing(4))).foundations.includes('spacing'));
  });

  test('dark values: asked only when any dark value exists, then of every colour', () => {
    assert.ok(!missing(full()).foundations.includes('dark-values'));
    assert.ok(missing(full({}, FULL.lines, ['--surface: #111111;'])).foundations.includes('dark-values'));
    const everyColour = FULL.lines.filter((line) => /#[0-9a-f]{6};$/.test(line)).map((line) => line.replace(/#[0-9a-f]{6}/, '#222222'));
    assert.ok(!missing(full({}, FULL.lines, everyColour)).foundations.includes('dark-values'));
  });

  test('state colours by suffix: -hover, -active, -selected, -disabled', () => {
    const without = FULL.lines.filter((line) => !line.startsWith('--surface-hover'));
    assert.ok(missing(full({}, without)).foundations.includes('state-colours'));
    for (const suffix of ['hover', 'active', 'selected', 'disabled']) {
      const lines = [...without, `--row-${suffix}: #eeeeee;`];
      assert.ok(!missing(full({}, lines)).foundations.includes('state-colours'), suffix);
    }
    assert.ok(missing(full({}, [...without, '--hovered: #eeeeee;'])).foundations.includes('state-colours'));
  });

  test('data colours and data display are asked only when a chart or table component or a data-display pattern exists', () => {
    const noData = full({ components: [{ id: 'button', name: 'Button', states: ['hover', 'focus', 'disabled'], example: 'components/button.html' }], patterns: FULL.json.patterns.filter((entry) => entry.kind !== 'data-display') }, FULL.lines.filter((line) => !line.startsWith('--chart-1')));
    assert.equal(drawsData(noData), false);
    assert.ok(!missing(noData).foundations.includes('data-colours'));
    assert.ok(!missing(noData).patterns.includes('data-display'));
    const table = full({ patterns: FULL.json.patterns.filter((entry) => entry.kind !== 'data-display') }, FULL.lines.filter((line) => !line.startsWith('--chart-1')));
    assert.equal(drawsData(table), true);
    assert.ok(missing(table).foundations.includes('data-colours'));
    assert.ok(missing(table).patterns.includes('data-display'));
  });

  test('control sizes, breakpoints, elevation, layers and motion tokens', () => {
    const drop = (prefix: string): string[] => missing(full({}, FULL.lines.filter((line) => !line.startsWith(prefix)))).foundations;
    assert.deepEqual(drop('--control-'), ['control-sizes']);
    assert.deepEqual(drop('--bp-'), ['breakpoints']);
    assert.deepEqual(drop('--shadow-'), ['elevation']);
    assert.deepEqual(drop('--z-'), ['layers']);
    assert.deepEqual(drop('--duration-'), ['motion']);
    assert.deepEqual(drop('--ease-'), ['motion']);
    assert.ok(!missing(full({}, [...FULL.lines.filter((line) => !line.startsWith('--control-')), '--touch-min: 44px;'])).foundations.includes('control-sizes'));
  });

  test('icons: asked of a full system\'s foundations only, satisfied by one listed icon, and stopped by outOfScope', () => {
    assert.equal(SYSTEM_TOPIC_IDS.length, 34);
    assert.deepEqual(missing(full({ icons: [] })).foundations, ['icons']);
    assert.deepEqual(missing(full({ icons: [], outOfScope: ['icons'] })).foundations, []);
    assert.ok(!missing(full({ icons: [], depth: 'core' })).foundations.includes('icons'));
    assert.deepEqual(full({ outOfScope: ['icons'] }).outOfScope, ['icons']);
  });

  test('components: at least one, every one with an example, and hover implies focus and disabled at full', () => {
    assert.deepEqual(missing(full({ components: [{ id: 'button', name: 'Button', example: 'components/button.html' }, { id: 'chip', name: 'Chip' }] })).components, ['examples']);
    assert.deepEqual(missing(full({ components: [{ id: 'button', name: 'Button', states: ['Hover', 'Focus-visible'], example: 'components/button.html' }] })).components, ['focus-disabled']);
    assert.deepEqual(missing(full({ depth: 'core', components: [{ id: 'button', name: 'Button', states: ['hover'], example: 'components/button.html' }] })).components, []);
  });

  test('patterns are counted by kind; brand: a logo or a logo-use entry, then colour, imagery, marketing (social and email count)', () => {
    assert.deepEqual(missing(full({ patterns: [{ id: 'nav', kind: 'voice', title: 'Called nav but a voice entry' }] })).patterns, ['navigation', 'overlays', 'forms', 'feedback', 'states', 'data-display', 'accessibility', 'responsive', 'motion']);
    assert.deepEqual(missing(full({ logos: [], brand: [{ id: 'use', kind: 'logo-use', title: 'Use' }, { id: 'c', kind: 'colour', title: 'C' }, { id: 'i', kind: 'imagery', title: 'I' }, { id: 'e', kind: 'email', title: 'E' }] })).brand, []);
    assert.deepEqual(missing(full({ logos: [], brand: [] })).brand, ['logo', 'brand-colour', 'imagery', 'marketing']);
  });
});
