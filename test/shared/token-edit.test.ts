// The token planner and value rules of a design system (documentation/specs/phase-2-5-technical.md
// §2.4, §6.1). Risk tests: every value written passes `validateTokenValue` (no value can leave its
// declaration: url(), expression(), `;`, `}`, `<`, `\`, `*`, a control character, an open quote or
// bracket); the planner sets, adds and removes any custom property in the light `:root` or the dark
// block and nothing else (every other byte stays, CRLF and a BOM included); the verify refuses any
// result that is not exactly the plan; the sections and contexts are the §2.4 ones.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TokenEdit } from '../../src/shared/api.ts';
import { SYSTEM_UNDO_TEXT_MAX } from '../../src/shared/limits.ts';
import {
  classifyToken,
  FORMULA_SENTENCE,
  isDarkContext,
  isLightContext,
  NOT_EXACT_SENTENCE,
  planTokenEdit,
  TOKEN_UNDO_SPLICES_MAX,
  UNREADABLE_VALUE_SENTENCE,
  validateTokenValue,
  verifyTokenEdit,
  type TokenEditPlan,
} from '../../src/shared/token-edit.ts';
import { scanTokenBlocks, scanTokens } from '../../src/shared/tokens-css.ts';

const SEED = ':root {\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n  }\n}\n';

const ACME = [
  ':root {',
  '  /* Colours */',
  '  --brand-500: #1a73e8;',
  '  --space-4: 16px;',
  '}',
  '.card {',
  '  --brand-500: red;',
  '}',
  '@media (prefers-color-scheme: dark) {',
  '  :root {',
  '    --brand-500: #8ab4f8;',
  '  }',
  '}',
  '',
].join('\n');

const plan = (css: string, edits: TokenEdit[]): TokenEditPlan => planTokenEdit(css, edits, { contexts: 'system' });

const resultOf = (css: string, edits: TokenEdit[]): string => {
  const planned = plan(css, edits);
  assert.ok('result' in planned, 'refusal' in planned ? planned.refusal : 'no result');
  assert.ok(verifyTokenEdit(css, planned.result, edits), 'the verify accepts the planned result');
  return planned.result;
};

const refusalOf = (css: string, edits: TokenEdit[]): string => {
  const planned = plan(css, edits);
  assert.ok('refusal' in planned, 'expected a refusal');
  return planned.refusal;
};

/** name → [light, dark] as the system reads them (§2.4). */
const valuesOf = (css: string): Record<string, [string | null, string | null]> => {
  const out: Record<string, [string | null, string | null]> = {};
  for (const declaration of scanTokens(css)) {
    const entry = (out[declaration.name] ??= [null, null]);
    const text = css.slice(declaration.from, declaration.to);
    if (isLightContext(declaration.context, 'system')) entry[0] = text;
    else if (isDarkContext(declaration.context, 'system')) entry[1] = text;
  }
  return out;
};

describe('validateTokenValue: rule 1 refuses every value that could leave its declaration', () => {
  const hostile = [
    'url(x.png)',
    'url("https://evil.example/a.png")',
    'image-set("a.png" 1x)',
    'expression(alert(1))',
    'attr(data-x)',
    'element(#x)',
    'red; } body { background: red',
    'red}',
    '#fff;',
    '</style><script>alert(1)</script>',
    'a\\62 c',
    'calc(2 * 4px)',
    'red\u0000',
    'red\nblue',
    '"unclosed',
    "'unclosed",
    'rgb(1 2 3',
    'rgb(1 2 3))',
    'red !important',
    'a: b',
    '',
    `#${'a'.repeat(100)}`,
  ];
  for (const value of hostile) {
    test(`refused in every section: ${JSON.stringify(value).slice(0, 40)}`, () => {
      for (const section of ['colours', 'typography', 'spacing', 'radius', 'shadows', 'layers', 'sizes', 'other'] as const) {
        assert.equal(validateTokenValue(section, null, value).ok, false, `${section}: ${value}`);
      }
      for (const field of ['family', 'size', 'weight', 'lineHeight', 'letterSpacing'] as const) {
        assert.equal(validateTokenValue('typography', field, value).ok, false, `${field}: ${value}`);
      }
    });
  }

  test('the refusal names the section shape, never the value', () => {
    const check = validateTokenValue('colours', null, 'url(evil)');
    assert.deepEqual(check, { ok: false, sentence: 'Use a colour, like #1a73e8, rgb(26 115 232) or a colour name.' });
    assert.deepEqual(validateTokenValue('spacing', null, 'lots'), { ok: false, sentence: 'Use a length, like 16px or 1rem.' });
    assert.deepEqual(validateTokenValue('typography', 'weight', '1001'), { ok: false, sentence: 'Use a weight from 1 to 1000, or normal or bold.' });
  });

  test('a formula is valid when rule 1 passes, and flagged', () => {
    assert.deepEqual(validateTokenValue('colours', null, 'var(--brand-500)'), { ok: true, formula: true });
    assert.deepEqual(validateTokenValue('spacing', null, 'calc(var(--space-1) + 2px)'), { ok: true, formula: true });
    assert.deepEqual(validateTokenValue('sizes', null, 'clamp(1rem, 2vw, 3rem)'), { ok: true, formula: true });
    assert.deepEqual(validateTokenValue('colours', null, 'color-mix(in srgb, red 50%, blue)'), { ok: true, formula: true });
    assert.deepEqual(validateTokenValue('typography', 'family', 'var(--font-sans)'), { ok: true, formula: true });
  });
});

describe('validateTokenValue: rule 2, per section', () => {
  const cases: [Parameters<typeof validateTokenValue>[0], Parameters<typeof validateTokenValue>[1], string, boolean][] = [
    ['colours', null, '#1a73e8', true],
    ['colours', null, '#1A7', true],
    ['colours', null, '#1a73e8cc', true],
    ['colours', null, '#1a73e', false],
    ['colours', null, 'rgb(26 115 232)', true],
    ['colours', null, 'rgba(26, 115, 232, 0.5)', true],
    ['colours', null, 'hsl(210deg 80% 50% / 0.4)', true],
    ['colours', null, 'oklch(62% 0.19 255)', true],
    ['colours', null, 'color(display-p3 1 0 none)', true],
    ['colours', null, 'color(bogus 1 0 0)', false],
    ['colours', null, 'rebeccapurple', true],
    ['colours', null, 'transparent', true],
    ['colours', null, 'currentColor', true],
    ['colours', null, 'notacolour', false],
    ['colours', null, '16px', false],
    ['spacing', null, '0', true],
    ['spacing', null, '1.5rem', true],
    ['spacing', null, '-4px', true],
    ['spacing', null, '12', false],
    ['spacing', null, '3cm', false],
    ['radius', null, '3cm', true],
    ['radius', null, '9999px', true],
    ['sizes', null, '1200px', true],
    ['sizes', null, '1.5', true],
    ['sizes', null, 'big', false],
    ['shadows', null, 'none', true],
    ['shadows', null, '0 1px 2px rgb(0 0 0 / 0.2)', true],
    ['shadows', null, 'inset 0 0 0 1px #ccc, 0 4px 8px 0 rgba(0, 0, 0, 0.1)', true],
    ['shadows', null, '#000 0 2px', true],
    ['shadows', null, '0 1px', true],
    ['shadows', null, '1px', false],
    ['shadows', null, '0 1px 2px red blue', false],
    ['layers', null, '10', true],
    ['layers', null, '-1', true],
    ['layers', null, 'auto', true],
    ['layers', null, '2147483648', false],
    ['layers', null, '1.5', false],
    ['typography', 'family', '"Inter", system-ui, sans-serif', true],
    ['typography', 'family', 'Helvetica Neue, Arial', true],
    ['typography', 'family', '"Inter", 12px', false],
    ['typography', 'size', '16px', true],
    ['typography', 'size', 'normal', true],
    ['typography', 'size', 'huge', false],
    ['typography', 'weight', '400', true],
    ['typography', 'weight', 'bold', true],
    ['typography', 'weight', '0', false],
    ['typography', 'lineHeight', '1.5', true],
    ['typography', 'lineHeight', '24px', true],
    ['typography', 'lineHeight', 'tall', false],
    ['typography', 'letterSpacing', '0.02em', true],
    ['typography', 'letterSpacing', '0', true],
    ['typography', null, 'anything plain', true],
    ['other', null, 'anything plain', true],
  ];
  for (const [section, field, value, ok] of cases) {
    test(`${section}${field === null ? '' : `.${field}`}: ${value} → ${ok ? 'valid' : 'refused'}`, () => {
      assert.equal(validateTokenValue(section, field, value).ok, ok);
    });
  }
});

describe('classifyToken: the section of a token without metadata', () => {
  const cases: [string, string, string][] = [
    ['--text-primary', '#111', 'colours'],
    ['--brand-500', 'oklch(62% 0.19 255)', 'colours'],
    ['--shadow-1', '0 1px 2px rgb(0 0 0 / 0.2)', 'shadows'],
    ['--elevation', 'none', 'other'],
    ['--radius-2', '8px', 'radius'],
    ['--rounded-full', '9999px', 'radius'],
    ['--z-modal', '100', 'layers'],
    ['--layer-toast', '30', 'layers'],
    ['--z-modal', 'auto', 'other'],
    ['--space-4', '16px', 'spacing'],
    ['--gutter', '1.5rem', 'spacing'],
    ['--font-sans', 'Inter, sans-serif', 'typography'],
    ['--fs-body', '16px', 'typography'],
    ['--leading-tight', '1.2', 'typography'],
    ['--bp-tablet', '768px', 'sizes'],
    ['--container-max', '1200px', 'sizes'],
    ['--motion-fast', '120ms', 'other'],
  ];
  for (const [name, value, section] of cases) {
    test(`${name}: ${value} → ${section}`, () => assert.equal(classifyToken(name, value), section));
  }
});

describe('contexts: the light and dark forms (§2.4)', () => {
  const contextsOf = (css: string, rules: 'system' | 'extraction'): string[] =>
    scanTokens(css).map((one) => (isLightContext(one.context, rules) ? 'light' : isDarkContext(one.context, rules) ? 'dark' : 'other'));

  test('a system file: only the top-level :root and :root directly in the dark media block', () => {
    const css = [
      ':root { --a: 1 }',
      '@media (prefers-color-scheme: dark) { :root { --a: 2 } }',
      '@media (prefers-color-scheme:dark) { :ROOT { --a: 3 } }',
      'html { --a: 4 }',
      '.dark { --a: 5 }',
      '@media (prefers-color-scheme: dark) { .card { --a: 6 } }',
      '@media screen and (prefers-color-scheme: dark) { :root { --a: 7 } }',
      '@supports (color: red) { @media (prefers-color-scheme: dark) { :root { --a: 8 } } }',
      ':root, html { --a: 9 }',
      '[data-theme="dark"] { --a: 10 }',
    ].join('\n');
    assert.deepEqual(contextsOf(css, 'system'), ['light', 'dark', 'dark', 'other', 'other', 'other', 'other', 'other', 'other', 'other']);
  });

  test('extraction reads the wider project forms', () => {
    const css = [
      ':root { --a: 1 }',
      'html { --a: 2 }',
      ':root, html { --a: 3 }',
      '.light { --a: 4 }',
      "[data-theme='light'] { --a: 5 }",
      '@theme { --a: 6 }',
      '.dark { --a: 7 }',
      ':root.dark { --a: 8 }',
      '[data-theme="dark"] { --a: 9 }',
      ':root[data-theme=dark] { --a: 10 }',
      '[data-mode="dark"] { --a: 11 }',
      '@media (prefers-color-scheme: dark) { html { --a: 12 } }',
      '.card { --a: 13 }',
      '@media print { :root { --a: 14 } }',
    ].join('\n');
    assert.deepEqual(contextsOf(css, 'extraction'), ['light', 'light', 'light', 'light', 'light', 'light', 'dark', 'dark', 'dark', 'dark', 'dark', 'dark', 'other', 'other']);
  });
});

describe('scanTokens: the additive fields (§2.4)', () => {
  test('start and end mark the name and the ending ; (or } / end of file)', () => {
    const css = ':root {\n  /* c */ --a: 1;\n  --b: 2\n}\n.x { --c: 3';
    const [a, b, c] = scanTokens(css);
    assert.ok(a !== undefined && b !== undefined && c !== undefined);
    assert.equal(css.slice(a.start, a.end + 1), '--a: 1;');
    assert.equal(css[b.end], '}');
    assert.equal(css.slice(b.start, b.start + 3), '--b');
    assert.equal(c.end, css.length);
  });

  test('atRules and selectors ride along without changing how a context compares', () => {
    const [declaration] = scanTokens('@media (prefers-color-scheme: dark) { :root { --a: 1 } }');
    assert.ok(declaration?.context.kind === 'other');
    assert.deepEqual(declaration.context, { kind: 'other', label: '@media (prefers-color-scheme: dark)' });
    assert.deepEqual([...(declaration.context.atRules ?? [])], ['@media (prefers-color-scheme: dark)']);
    assert.deepEqual([...(declaration.context.selectors ?? [])], [':root']);
    assert.deepEqual(JSON.parse(JSON.stringify(declaration.context)), { kind: 'other', label: '@media (prefers-color-scheme: dark)' });
  });

  test('scanTokenBlocks lists every block with its braces and an open tail', () => {
    const css = ':root { --a: 1 }\n@media (prefers-color-scheme: dark) { :root { --b: 2; } }';
    const blocks = scanTokenBlocks(css);
    assert.equal(blocks.length, 3);
    const root = blocks[0];
    assert.ok(root !== undefined);
    assert.equal(css[root.open], '{');
    assert.equal(css[root.close], '}');
    assert.equal(root.openTail, true, '--a: 1 ends at } without ;');
    const dark = blocks.find((one) => one.atRules.length === 1 && !one.atRule);
    assert.equal(dark?.openTail, false);
  });
});

describe('planTokenEdit: set, add and remove any token, light and dark', () => {
  test('add into the empty seed blocks: light and dark, with the block indentation', () => {
    const after = resultOf(SEED, [
      { kind: 'add', name: '--brand-500', mode: 'light', value: '#1a73e8' },
      { kind: 'add', name: '--brand-500', mode: 'dark', value: '#8ab4f8' },
      { kind: 'add', name: '--space-4', mode: 'light', value: '16px' },
    ]);
    assert.equal(after, ':root {\n  --brand-500: #1a73e8;\n  --space-4: 16px;\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand-500: #8ab4f8;\n  }\n}\n');
  });

  test('set replaces only the value of the last declaration in that mode; other contexts stay', () => {
    const after = resultOf(ACME, [
      { kind: 'set', name: '--brand-500', mode: 'light', value: '#0b57d0' },
      { kind: 'set', name: '--brand-500', mode: 'dark', value: 'rgb(138 180 248)' },
    ]);
    assert.equal(after, ACME.replace('--brand-500: #1a73e8;', '--brand-500: #0b57d0;').replace('--brand-500: #8ab4f8;', '--brand-500: rgb(138 180 248);'));
    assert.deepEqual(valuesOf(after)['--brand-500'], ['#0b57d0', 'rgb(138 180 248)']);
    assert.ok(after.includes('.card {\n  --brand-500: red;\n}'), 'the component declaration is untouched');
  });

  test('remove takes the whole line, in one mode or both; component styling stays', () => {
    const light = resultOf(ACME, [{ kind: 'remove', name: '--space-4', mode: 'light' }]);
    assert.equal(light, ACME.replace('  --space-4: 16px;\n', ''));
    const both = resultOf(ACME, [{ kind: 'remove', name: '--brand-500', mode: 'both' }]);
    assert.equal(both, ACME.replace('  --brand-500: #1a73e8;\n', '').replace('    --brand-500: #8ab4f8;\n', ''));
    assert.ok(both.includes('--brand-500: red;'));
    const dark = resultOf(ACME, [{ kind: 'remove', name: '--brand-500', mode: 'dark' }]);
    assert.deepEqual(valuesOf(dark)['--brand-500'], ['#1a73e8', null]);
  });

  test('remove and add in the same block in one plan', () => {
    const after = resultOf(ACME, [
      { kind: 'remove', name: '--space-4', mode: 'light' },
      { kind: 'add', name: '--space-8', mode: 'light', value: '32px' },
    ]);
    assert.equal(after, ACME.replace('  --space-4: 16px;\n', '  --space-8: 32px;\n'));
  });

  test('a missing block is appended at the end: :root, or the dark media block', () => {
    assert.equal(resultOf('', [{ kind: 'add', name: '--a', mode: 'light', value: '1px' }]), ':root {\n  --a: 1px;\n}\n');
    const css = ':root {\n  --a: 1px;\n}';
    assert.equal(
      resultOf(css, [{ kind: 'add', name: '--a', mode: 'dark', value: '2px' }]),
      `${css}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --a: 2px;\n  }\n}\n`,
    );
  });

  test('an unterminated last declaration gets its ; before the new one', () => {
    assert.equal(resultOf(':root {\n  --a: 1px\n}\n', [{ kind: 'add', name: '--b', mode: 'light', value: '2px' }]), ':root {\n  --a: 1px;\n  --b: 2px;\n}\n');
    assert.equal(resultOf(':root{--a:1}', [{ kind: 'add', name: '--b', mode: 'light', value: '2' }]), ':root{--a:1;\n  --b: 2;\n}');
  });

  test('CRLF line endings and a byte-order mark are kept (E5)', () => {
    const css = '﻿:root {\r\n  --a: 1px;\r\n  --b: 2px;\r\n}\r\n';
    assert.equal(resultOf(css, [{ kind: 'add', name: '--c', mode: 'light', value: '3px' }]), '﻿:root {\r\n  --a: 1px;\r\n  --b: 2px;\r\n  --c: 3px;\r\n}\r\n');
    assert.equal(resultOf(css, [{ kind: 'remove', name: '--a', mode: 'light' }]), '﻿:root {\r\n  --b: 2px;\r\n}\r\n');
    assert.equal(resultOf(css, [{ kind: 'set', name: '--b', mode: 'light', value: '4px' }]), '﻿:root {\r\n  --a: 1px;\r\n  --b: 4px;\r\n}\r\n');
  });

  test('comments, other rules and unrelated declarations keep every byte', () => {
    const css = '/* top */\n:root {\n  --a: 1px; /* keep */\n  color: red;\n}\n.x { --a: 9px }\n';
    const after = resultOf(css, [{ kind: 'set', name: '--a', mode: 'light', value: '2px' }]);
    assert.equal(after, css.replace('--a: 1px;', '--a: 2px;'));
  });
});

describe('planTokenEdit: refusals', () => {
  test('a set needs a plain, non-formula declaration in that mode', () => {
    assert.match(refusalOf(ACME, [{ kind: 'set', name: '--nope', mode: 'light', value: '1px' }]), /has no light value for --nope/);
    assert.match(refusalOf(ACME, [{ kind: 'set', name: '--space-4', mode: 'dark', value: '1px' }]), /has no dark value for --space-4/);
    assert.equal(refusalOf(':root { --a: var(--b); }', [{ kind: 'set', name: '--a', mode: 'light', value: '1px' }]), FORMULA_SENTENCE);
    assert.equal(refusalOf(':root { --a: 1px !important; }', [{ kind: 'set', name: '--a', mode: 'light', value: '2px' }]), UNREADABLE_VALUE_SENTENCE);
    assert.equal(refusalOf(':root { --a: 1px /* x */; }', [{ kind: 'set', name: '--a', mode: 'light', value: '2px' }]), UNREADABLE_VALUE_SENTENCE);
  });

  test('an add refuses a name that already has a value in that mode; a remove one that has none', () => {
    assert.match(refusalOf(ACME, [{ kind: 'add', name: '--brand-500', mode: 'light', value: '#000' }]), /already has a light value/);
    assert.match(refusalOf(ACME, [{ kind: 'remove', name: '--nope', mode: 'both' }]), /no --nope to remove/);
    assert.match(refusalOf(ACME, [{ kind: 'remove', name: '--space-4', mode: 'dark' }]), /no --space-4 to remove/);
  });

  test('two edits of one name and mode, an empty plan and a bad name are refused', () => {
    const doubled: TokenEdit[] = [
      { kind: 'set', name: '--space-4', mode: 'light', value: '1px' },
      { kind: 'remove', name: '--space-4', mode: 'both' },
    ];
    assert.match(refusalOf(ACME, doubled), /couldn't read that edit/);
    assert.match(refusalOf(ACME, []), /couldn't read that edit/);
    assert.match(refusalOf(ACME, [{ kind: 'add', name: '--a;b', mode: 'light', value: '1px' }]), /token name/);
    assert.match(refusalOf(ACME, [{ kind: 'add', name: 'color', mode: 'light', value: 'red' }]), /token name/);
  });

  test('hostile values never reach the plan; the value is checked for the token section', () => {
    for (const value of ['red; } body { x: y', 'url(evil.png)', '</style>', 'a\\b', '"open']) {
      assert.ok('refusal' in plan(ACME, [{ kind: 'set', name: '--brand-500', mode: 'light', value }]), value);
      assert.ok('refusal' in plan(ACME, [{ kind: 'add', name: '--new', mode: 'dark', value }]), value);
    }
    assert.match(refusalOf(ACME, [{ kind: 'set', name: '--brand-500', mode: 'light', value: '16px' }]), /Use a colour/);
    const asSpacing = planTokenEdit(ACME, [{ kind: 'set', name: '--brand-500', mode: 'light', value: '16px' }], { contexts: 'system', sectionOf: () => 'spacing' });
    assert.ok('result' in asSpacing, 'system.json section wins over the classifier');
  });

  test('an unclosed block of that mode is refused, never written into', () => {
    assert.equal(refusalOf(':root {\n  --a: 1px;\n', [{ kind: 'add', name: '--b', mode: 'light', value: '2px' }]), NOT_EXACT_SENTENCE);
  });
});

describe('verifyTokenEdit and undo', () => {
  const edits: TokenEdit[] = [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }];

  test('the exact planned result verifies; anything else does not', () => {
    const after = resultOf(ACME, edits);
    assert.equal(verifyTokenEdit(ACME, after, edits), true);
    assert.equal(verifyTokenEdit(ACME, `${after} `, edits), false, 'one extra byte');
    assert.equal(verifyTokenEdit(ACME, after.replace('#1a73e8', '#1a73e9'), edits), false, 'another value moved');
    assert.equal(verifyTokenEdit(ACME, ACME, edits), false, 'nothing applied');
    assert.equal(verifyTokenEdit(ACME, after, [{ kind: 'set', name: '--space-4', mode: 'light', value: '21px' }]), false);
  });

  test('the undo splices put back exactly the old bytes', () => {
    const planned = plan(ACME, [
      { kind: 'set', name: '--brand-500', mode: 'dark', value: '#000' },
      { kind: 'remove', name: '--space-4', mode: 'light' },
      { kind: 'add', name: '--z-top', mode: 'light', value: '10' },
    ]);
    assert.ok('result' in planned && planned.undo?.kind === 'splices');
    let text = ACME;
    const results: string[] = [];
    for (const splice of planned.undo.splices) {
      text = `${text.slice(0, splice.start)}${splice.inserted}${text.slice(splice.start + splice.removed.length)}`;
      results.push(text);
    }
    assert.equal(text, planned.result);
    for (const splice of [...planned.undo.splices].reverse()) {
      text = `${text.slice(0, splice.start)}${splice.removed}${text.slice(splice.start + splice.inserted.length)}`;
    }
    assert.equal(text, ACME);
  });

  test(`more than ${TOKEN_UNDO_SPLICES_MAX} far-apart runs are undone as the whole old text; over ${SYSTEM_UNDO_TEXT_MAX} characters not at all`, () => {
    const filler = `/* ${'x'.repeat(41_000)} */\n`;
    const many = Array.from({ length: TOKEN_UNDO_SPLICES_MAX + 2 }, (_, k) => `:root { --t-${k}: ${k}px; }\n${filler}`).join('');
    const sets: TokenEdit[] = Array.from({ length: TOKEN_UNDO_SPLICES_MAX + 2 }, (_, k) => ({ kind: 'set', name: `--t-${k}`, mode: 'light', value: `${k + 1}px` }));
    const big = plan(many, sets);
    assert.ok('result' in big);
    assert.equal(many.length > SYSTEM_UNDO_TEXT_MAX, true);
    assert.equal(big.undo, null, 'over the cap: the edit stands without an undo');
    const small = Array.from({ length: TOKEN_UNDO_SPLICES_MAX + 2 }, (_, k) => `:root { --t-${k}: ${k}px; }\n/* ${'y'.repeat(9_000)} */\n`).join('');
    const replaced = plan(small, sets);
    assert.ok('result' in replaced);
    assert.deepEqual(replaced.undo, { kind: 'replace', before: small });
  });
});
