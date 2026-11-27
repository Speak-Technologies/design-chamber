// The token export formatters (documentation/specs/system-builder-depth.md §13 T19): golden output for
// tokens.json (W3C design tokens 2025.10), tokens.css and the Tailwind `@theme` block, what gets a
// `$type`, renamed and left-out names, and hostile names, values and notes in every format.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSystemDetail, parseSystemState } from '../../src/shared/system-json.ts';
import { scanTokens } from '../../src/shared/tokens-css.ts';
import {
  exportReadme,
  hasExportableTokens,
  isSelfContained,
  leftOutValues,
  toDesignTokensJson,
  toTailwindTheme,
  toTokensCss,
  type TokenExportSource,
} from '../../src/shared/token-export.ts';
import type { SystemToken, TokenSection } from '../../src/shared/types.ts';

const CSS = `:root {
  --brand: #1A73E8;
  --Brand: oklch(70% 0.1 250);
  --brand-soft: rgb(26 115 232 / 50%);
  --text: black;
  --link: rebeccapurple;
  --font-sans: "Inter", system-ui, sans-serif;
  --font-weight-bold: 700;
  --font-size-body: 1rem;
  --leading: 1.5;
  --space-2: 8px;
  --space-0: 0;
  --space-half: 50%;
  --space-4: calc(var(--space-2) + 8px);
  --radius-m: 0.5rem;
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.2), inset 0 0 0 1px #fff;
  --duration-fast: 150ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-steps: steps(4, end);
  --z-modal: 10;
  --bad: url(x.png);
}

@media (prefers-color-scheme: dark) {
  :root {
    --brand: #8ab4f8;
    --night: hsl(210deg 50% 20%);
  }
}
`;

const SYSTEM_JSON = JSON.stringify({
  version: 1,
  tokens: { '--brand': { group: 'brand', note: 'The main blue.' }, '--Brand': { group: 'brand' }, '--brand-soft': { group: 'brand' }, '--text': { group: 'text' } },
});

/** The detail the routes pass in, read by the real reader. */
const detailOf = (tokensCss: string, systemJson: string | null = SYSTEM_JSON) =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    filesDir: '/designs/_systems/acme',
    state: parseSystemState(null, 'acme', '2026-11-27T10:00:00.000Z'),
    systemJson,
    tokensCss,
    texts: {},
    files: [],
    treeHash: 'x',
    build: null,
  });

const srgb = (components: number[], extra: object = {}) => ({ colorSpace: 'srgb', components, ...extra });
const px = (value: number) => ({ value, unit: 'px' });
const BLUE = [0.101961, 0.45098, 0.909804];

const GOLDEN_JSON = {
  colours: {
    brand: {
      brand: { $type: 'color', $value: srgb(BLUE, { hex: '#1a73e8' }), $description: 'The main blue.' },
      'Brand-2': { $type: 'color', $value: { colorSpace: 'oklch', components: [0.7, 0.1, 250] } },
      'brand-soft': { $type: 'color', $value: srgb(BLUE, { alpha: 0.5 }) },
    },
    text: { text: { $type: 'color', $value: srgb([0, 0, 0], { hex: '#000000' }) } },
    other: { link: { $value: 'rebeccapurple' } },
  },
  typography: {
    'font-sans': { $type: 'fontFamily', $value: ['Inter', 'system-ui', 'sans-serif'] },
    'font-weight-bold': { $type: 'fontWeight', $value: 700 },
    'font-size-body': { $type: 'dimension', $value: { value: 1, unit: 'rem' } },
    leading: { $value: '1.5' },
  },
  spacing: {
    'space-2': { $type: 'dimension', $value: px(8) },
    'space-0': { $type: 'dimension', $value: px(0) },
    'space-half': { $value: '50%' },
  },
  radius: { 'radius-m': { $type: 'dimension', $value: { value: 0.5, unit: 'rem' } } },
  shadows: {
    'shadow-1': {
      $type: 'shadow',
      $value: [
        { color: srgb([0, 0, 0], { alpha: 0.2 }), offsetX: px(0), offsetY: px(1), blur: px(2), spread: px(0) },
        { color: srgb([1, 1, 1], { hex: '#ffffff' }), offsetX: px(0), offsetY: px(0), blur: px(0), spread: px(1), inset: true },
      ],
    },
  },
  motion: {
    'duration-fast': { $type: 'duration', $value: { value: 150, unit: 'ms' } },
    'ease-out': { $type: 'cubicBezier', $value: [0.2, 0, 0, 1] },
    'ease-steps': { $value: 'steps(4, end)' },
  },
  layers: { 'z-modal': { $value: '10' } },
  other: { 'space-4': { $value: 'calc(var(--space-2) + 8px)' } },
  dark: {
    colours: {
      brand: { brand: { $type: 'color', $value: srgb([0.541176, 0.705882, 0.972549], { hex: '#8ab4f8' }), $description: 'The main blue.' } },
      other: { night: { $type: 'color', $value: { colorSpace: 'hsl', components: [210, 50, 20] } } },
    },
  },
};

const LIGHT_LINES = `  --brand: #1A73E8;
  --Brand: oklch(70% 0.1 250);
  --brand-soft: rgb(26 115 232 / 50%);
  --text: black;
  --link: rebeccapurple;
  --font-sans: "Inter", system-ui, sans-serif;
  --font-weight-bold: 700;
  --font-size-body: 1rem;
  --leading: 1.5;
  --space-2: 8px;
  --space-0: 0;
  --space-half: 50%;
  --space-4: calc(var(--space-2) + 8px);
  --radius-m: 0.5rem;
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.2), inset 0 0 0 1px #fff;
  --duration-fast: 150ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-steps: steps(4, end);
  --z-modal: 10;
`;

const GOLDEN_CSS = `/* Design tokens exported from Design Chamber. */
:root {
${LIGHT_LINES}}

@media (prefers-color-scheme: dark) {
  :root {
    --brand: #8ab4f8;
    --night: hsl(210deg 50% 20%);
  }
}
`;

const GOLDEN_TAILWIND = `/* Design tokens exported from Design Chamber, for Tailwind CSS v4. */
/* Light values only. The CSS export holds the dark ones. */
@theme {
${LIGHT_LINES}}
`;

const GOLDEN_README = `Renamed in tokens.json
These names differ only by capitals from another one in the same group, so they got a number:
  --Brand is colours.brand.Brand-2

Left out
Design Chamber couldn't read these values, so no file holds them:
  --bad (light)
`;

test('golden: tokens.json groups by section and colour group, types what parses, and keeps dark under "dark"', () => {
  const { text, renamed } = toDesignTokensJson(detailOf(CSS));
  assert.equal(text, `${JSON.stringify(GOLDEN_JSON, null, 2)}\n`);
  assert.deepEqual(renamed, [{ name: '--Brand', path: 'colours.brand.Brand-2' }]);
});

test('golden: tokens.css is regenerated from checked values, light then the dark media block', () => {
  assert.equal(toTokensCss(detailOf(CSS)), GOLDEN_CSS);
});

test('golden: the Tailwind file is one v4 @theme block of the light values', () => {
  assert.equal(toTailwindTheme(detailOf(CSS)), GOLDEN_TAILWIND);
});

test('golden: README.txt lists renamed and left-out names; nothing to say gives no README', () => {
  const detail = detailOf(CSS);
  assert.equal(exportReadme(toDesignTokensJson(detail).renamed, leftOutValues(detail)), GOLDEN_README);
  assert.equal(exportReadme([], []), null);
});

test('a suffixed name never takes a name another token already has', () => {
  const css = ':root { --a: 1px; --A: 2px; --a-2: 3px; --A-2: 4px; }';
  const { text, renamed } = toDesignTokensJson(detailOf(css, null));
  assert.deepEqual(Object.keys((JSON.parse(text) as { other: object }).other), ['a', 'A-3', 'a-2', 'A-2-2']);
  assert.deepEqual(renamed.map((one) => one.path), ['other.A-3', 'other.A-2-2']);
});

test('a formula is exported as text with no $type and never worked out', () => {
  const detail = detailOf(':root { --gap: calc(2px + 2px); --tint: color-mix(in srgb, red, blue); --alias: var(--gap); --font-sans: "Inter", var(--alias); }', null);
  const json = JSON.parse(toDesignTokensJson(detail).text) as Record<string, Record<string, object>>;
  const entries = Object.values(json).flatMap((group) => Object.values(group).flatMap((one) => ('$value' in one ? [one] : Object.values(one))));
  assert.equal(entries.length, 4);
  assert.ok(entries.every((entry) => !('$type' in (entry as object))));
  assert.match(toTokensCss(detail), /--gap: calc\(2px \+ 2px\);/);
});

/** A token as a dishonest detail would give it: marked fine whatever it holds. */
const lying = (name: string, text: string, section: TokenSection = 'other', note = ''): SystemToken => ({
  name,
  section,
  group: section === 'colours' ? 'brand' : null,
  light: { text, editable: 'ok', problem: null },
  dark: { text, editable: 'ok', problem: null },
  note,
  breakpoint: false,
  alsoSet: [],
  fromCode: false,
  problem: null,
});

const HOSTILE_VALUES = [
  'red; } body { color: red',
  'red} .x{',
  '{ a.b }',
  '{colours.brand}',
  'url(https://evil.test/x)',
  'URL(x)',
  'url("x")',
  'image-set("x" 1x)',
  'expression(alert(1))',
  'red /* open',
  'a\\',
  'a\\22 b',
  'line\nbreak',
  '</style><script>alert(1)</script>',
  '@import "x"',
  'red !important',
  `"x' y" '`, // even quote counts, but the last quote is never closed
  'rgb(0 0 0 / ")"', // balanced by count, but the bracket stays open for CSS
  '"(" )',
  'a:b',
  'x * y',
  'u+'.repeat(60),
  '',
];

test('hostile values are in no file, in light or dark, in any section', () => {
  const sections: TokenSection[] = ['colours', 'typography', 'spacing', 'radius', 'shadows', 'motion', 'layers', 'sizes', 'other'];
  for (const section of sections) {
    const source: TokenExportSource = { tokens: [...HOSTILE_VALUES.map((value, index) => lying(`--h${index}`, value, section)), lying('--safe', '#000', 'colours')] };
    for (const [format, text] of [['css', toTokensCss(source)], ['tailwind', toTailwindTheme(source)]] as const) {
      const names = scanTokens(text).map((one) => one.name);
      assert.deepEqual(names, format === 'css' ? ['--safe', '--safe'] : ['--safe'], `${format} ${section}`);
    }
    const json = JSON.parse(toDesignTokensJson(source).text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json), ['colours', 'dark'], section);
    assert.equal(leftOutValues(source).length, HOSTILE_VALUES.length * 2, section);
  }
});

test('the quote and bracket balance follows CSS, not a count', () => {
  for (const bad of [`"x' y" '`, 'rgb(0 0 0 / ")"', '"(" )', ') (', 'a !b', "'"]) assert.equal(isSelfContained(bad), false, bad);
  for (const good of ['"a)b"', '"it\'s"', 'rgb(0 0 0)', '"!"', '"Wow!", serif']) assert.equal(isSelfContained(good), true, good);
});

test('hostile names never reach a file, and object keys such as __proto__ are plain tokens', () => {
  const bad = ['--a: red; }', '--a{b', '--a.b', '--$x', 'a', '--', '--a b', '--a\n--b', '--é', `--${'a'.repeat(61)}`, '--a*/'];
  const odd = ['--__proto__', '--constructor', '--toString', '--hasOwnProperty'];
  const source: TokenExportSource = { tokens: [...bad, ...odd].map((name) => lying(name, '1px', 'spacing')) };
  assert.deepEqual(scanTokens(toTokensCss(source)).map((one) => one.name), [...odd, ...odd]);
  assert.deepEqual(scanTokens(toTailwindTheme(source)).map((one) => one.name), odd);
  const json = JSON.parse(toDesignTokensJson(source).text) as { spacing: object; dark: { spacing: object } };
  assert.deepEqual(Object.keys(json.spacing), ['__proto__', 'constructor', 'toString', 'hasOwnProperty']);
  assert.deepEqual(Object.keys(json.dark.spacing), Object.keys(json.spacing));
  assert.deepEqual(leftOutValues(source), []);
  assert.equal(({} as { $value?: unknown }).$value, undefined, 'Object.prototype is untouched');
});

test('a hostile note stays one JSON string and is in no CSS file', () => {
  const note = '*/ } body { }\n{colours.brand} "$value": 1, \\';
  const source: TokenExportSource = { tokens: [lying('--a', '1px', 'spacing', note)] };
  const json = JSON.parse(toDesignTokensJson(source).text) as { spacing: { a: { $description: string; $value: object } } };
  assert.equal(json.spacing.a.$description, note);
  assert.deepEqual(json.spacing.a.$value, { value: 1, unit: 'px' });
  assert.ok(!toTokensCss(source).includes('body'));
  assert.ok(!toTailwindTheme(source).includes('body'));
});

test('an unreadable value is left out even when its text would pass, and a system with nothing readable has nothing to export', () => {
  const important: SystemToken = { ...lying('--a', '1px'), light: { text: '1px', editable: 'unreadable', problem: 'x' }, dark: null };
  assert.equal(hasExportableTokens({ tokens: [important] }), false);
  assert.deepEqual(leftOutValues({ tokens: [important] }), [{ name: '--a', mode: 'light' }]);
  assert.equal(hasExportableTokens(detailOf(':root { --a: 1px !important; }', null)), false);
  assert.equal(hasExportableTokens(detailOf('', null)), false);
});

test('only values the format can say exactly get a $type', () => {
  const typed = (section: TokenSection, value: string, name = '--t'): unknown => {
    const json = JSON.parse(toDesignTokensJson({ tokens: [{ ...lying(name, value, section), dark: null }] }).text) as Record<string, Record<string, unknown>>;
    const group = json[section] ?? {};
    const entry = (section === 'colours' ? (group.brand as Record<string, unknown>) : group)[name.slice(2)];
    return (entry as { $type?: string }).$type ?? (entry as { $value: unknown }).$value;
  };
  for (const [section, value] of [['colours', 'currentcolor'], ['colours', 'color(srgb 1.5 0 0)'], ['colours', 'rgb(0deg 0 0)'], ['spacing', '2em'], ['spacing', '10vh'], ['shadows', 'none'], ['shadows', '0 1px 2px'], ['shadows', '0 1em 2px #000'], ['layers', 'auto'], ['typography', 'bold'], ['sizes', '12']] as const) {
    assert.equal(typed(section, value), value, `${section} ${value}`);
  }
  assert.equal(typed('colours', 'transparent'), 'color');
  assert.equal(typed('colours', 'color(display-p3 1 0 0 / 0.5)'), 'color');
  assert.equal(typed('typography', 'Georgia', '--font-heading'), 'fontFamily');
  assert.equal(typed('typography', 'normal', '--font-weight'), 'fontWeight');
});
