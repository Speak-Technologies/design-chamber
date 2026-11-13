// tokens.css, the pure half (documentation/specs/phase-2-technical.md §4.2, §4.3; PS 09).
// Risk tests: which declaration a knob edits (the last top-level :root one, the one a browser
// applies), what makes a value not editable (a formula, !important, a comment inside it, a
// broken string), the tolerant scanner's block rules (strings, url(), brackets), the number
// format, and the byte-exact splice with the verify that refuses a value that would shift or
// swallow what follows.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TweakState } from '../../src/shared/api.ts';
import type { Tweak, TweakChoice, TweakNumber } from '../../src/shared/types.ts';
import {
  ALSO_SET_MAX,
  formatTweakNumber,
  isBalancedQuotes,
  readKnobs,
  readTweakValues,
  scanTokens,
  spliceTokens,
  TOKEN_CONTEXT_MAX,
  tweakNumberText,
  tweakStateSentence,
  verifyTokenWrite,
  type TokenChange,
} from '../../src/shared/tokens-css.ts';

const radius: TweakNumber = { var: '--radius', label: 'Corner radius', kind: 'number', min: 0, max: 24, step: 2, unit: 'px' };
const hue: TweakNumber = { var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '' };
const density: TweakChoice = {
  var: '--density',
  label: 'Density',
  kind: 'choice',
  options: [
    { label: 'Compact', value: '0.85' },
    { label: 'Comfortable', value: '1' },
    { label: 'Roomy', value: '1.2' },
  ],
};

const one = (css: string | null, tweak: Tweak): TweakState => {
  const [state] = readTweakValues(css, [tweak]);
  assert.ok(state);
  return state;
};

/** The value text of the declaration the knob edits. */
const editedText = (css: string, tweak: Tweak): string | null => readKnobs(css, [tweak])[0]?.text ?? null;

describe('scanTokens: declarations and their contexts', () => {
  test('a :root declaration: its name, value range and root context', () => {
    const css = ':root {\n  --radius:   8px  ;\n}\n';
    const [declaration] = scanTokens(css);
    assert.ok(declaration);
    assert.equal(declaration.name, '--radius');
    assert.equal(css.slice(declaration.from, declaration.to), '8px');
    assert.deepEqual(declaration.context, { kind: 'root' });
    assert.equal(declaration.important, false);
    assert.equal(declaration.comment, false);
    assert.equal(declaration.broken, false);
  });

  test('ordinary properties are not reported; the last declaration may end at } with no ;', () => {
    const css = ':root { color: red; --a: 1; margin: 0 auto; --b: 2 }';
    assert.deepEqual(
      scanTokens(css).map((d) => [d.name, css.slice(d.from, d.to)]),
      [
        ['--a', '1'],
        ['--b', '2'],
      ],
    );
  });

  test('the selector must be exactly :root at the top level (whitespace and comments aside)', () => {
    const contexts = (css: string): string[] => scanTokens(css).map((d) => (d.context.kind === 'root' ? 'root' : d.context.label));
    assert.deepEqual(contexts(' /* x */ :root /* y */ { --a: 1 }'), ['root']);
    assert.deepEqual(contexts(':root, html { --a: 1 }'), [':root, html']);
    assert.deepEqual(contexts('html { --a: 1 }'), ['html']);
    assert.deepEqual(contexts('@layer base { :root { --a: 1 } }'), ['@layer base']);
    assert.deepEqual(contexts('@media (prefers-color-scheme: dark) { :root { --a: 1 } }'), ['@media (prefers-color-scheme: dark)']);
    assert.deepEqual(contexts('@supports (color: red) { @media print { :root { --a: 1 } } }'), ['@supports (color: red) @media print']);
    assert.deepEqual(contexts(':root { .card { --a: 1 } }'), [':root .card'], 'a rule nested in :root is not the default');
    assert.deepEqual(contexts('[data-theme="dark"] { --a: 1 }'), ['[data-theme="dark"]']);
  });

  test('a top-level ; does not end a rule selector (a browser drops "foo; :root" as one bad selector)', () => {
    const [declaration] = scanTokens('foo; :root { --a: 1 }');
    assert.deepEqual(declaration?.context, { kind: 'other', label: 'foo; :root' });
    // An at-statement does end at its ;.
    assert.deepEqual(scanTokens('@import "x.css"; :root { --a: 1 }')[0]?.context, { kind: 'root' });
  });

  test(`a context label is clipped to ${TOKEN_CONTEXT_MAX} characters`, () => {
    const label = scanTokens(`.${'x'.repeat(100)} { --a: 1 }`)[0]?.context;
    assert.ok(label?.kind === 'other');
    assert.equal(label.label.length, TOKEN_CONTEXT_MAX);
    assert.ok(label.label.endsWith('…'));
  });

  test('strings, url() and brackets hold ; and } without ending the declaration', () => {
    const css = ':root { --font: "a;b}" , \'c}\'; --img: url(x;y}.png); --grid: [a;b] (c;d); --r: 8px; }';
    assert.deepEqual(
      scanTokens(css).map((d) => [d.name, css.slice(d.from, d.to), d.broken]),
      [
        ['--font', '"a;b}" , \'c}\'', false],
        ['--img', 'url(x;y}.png)', false],
        ['--grid', '[a;b] (c;d)', false],
        ['--r', '8px', false],
      ],
    );
  });

  test('a custom property value may hold a {} block', () => {
    const css = ':root { --mixin: { color: red; }; --r: 8px; }';
    assert.deepEqual(
      scanTokens(css).map((d) => [d.name, css.slice(d.from, d.to)]),
      [
        ['--mixin', '{ color: red; }'],
        ['--r', '8px'],
      ],
    );
  });

  test('an unclosed ( swallows the rest of the file, as in a browser', () => {
    const css = ':root { --a: foo( ; --r: 8px; }\n.b { --c: 1 }';
    const declarations = scanTokens(css);
    assert.equal(declarations.length, 1);
    assert.equal(declarations[0]?.name, '--a');
    assert.equal(declarations[0]?.broken, true);
    assert.equal(one(css, radius).state, 'missing');
  });

  test('an unterminated string ends at the line break and marks the declaration broken', () => {
    const css = ':root {\n  --font: "Inter;\n  --r: 8px;\n}';
    const [font] = scanTokens(css);
    assert.equal(font?.broken, true);
  });

  test('a BOM, CRLF and tabs are whitespace', () => {
    const css = '\uFEFF:root\r\n{\r\n\t--r:\t8px\t;\r\n}\r\n';
    const [declaration] = scanTokens(css);
    assert.deepEqual(declaration?.context, { kind: 'root' });
    assert.equal(css.slice(declaration?.from, declaration?.to), '8px');
  });

  test('a declaration outside any block is ignored', () => {
    assert.deepEqual(scanTokens('--a: 1;'), []);
  });
});

describe('readTweakValues: the last top-level :root wins, everything else is reported', () => {
  test('two top-level :root rules: the last one is the knob’s', () => {
    const css = ':root { --radius: 4px; }\n:root { --radius: 8px; }\n';
    assert.deepEqual(one(css, radius), { var: '--radius', state: 'ok', value: 8, fileUnit: 'px', alsoSet: [] });
    assert.equal(readKnobs(css, [radius])[0]?.declaration?.from, css.lastIndexOf('8px'));
  });

  test('two declarations in one :root rule: the last one', () => {
    const css = ':root { --radius: 4px; --radius: 12px; }';
    assert.equal(one(css, radius).value, 12);
  });

  test('a later :root inside a media query does not win the edit; it is listed in alsoSet', () => {
    const css = ':root { --radius: 8px; }\n@media (prefers-color-scheme: dark) { :root { --radius: 6px; } }\n[data-theme=dark] { --radius: 2px }';
    assert.deepEqual(one(css, radius), { var: '--radius', state: 'ok', value: 8, fileUnit: 'px', alsoSet: ['@media (prefers-color-scheme: dark)', '[data-theme=dark]'] });
  });

  test(`alsoSet holds distinct contexts, at most ${ALSO_SET_MAX}`, () => {
    const css = ':root { --r: 1px } .a { --r: 1px } .a { --r: 2px } .b { --r: 1px } .c { --r: 1px } .d { --r: 1px }';
    assert.deepEqual(one(css, { ...radius, var: '--r' }).alsoSet, ['.a', '.b', '.c']);
  });

  test('set only in other contexts: missing, with where it is set', () => {
    const css = '@media print { :root { --radius: 8px } }';
    assert.deepEqual(one(css, radius), { var: '--radius', state: 'missing', value: null, fileUnit: null, alsoSet: ['@media print'] });
  });

  test('no file and no declaration', () => {
    assert.equal(one(null, radius).state, 'no-file');
    assert.equal(one(':root { --other: 1 }', radius).state, 'missing');
    assert.equal(one('', radius).state, 'missing');
  });

  test('a formula: calc(), var(), any function in a number knob, !important, a comment inside the value', () => {
    for (const value of ['calc(4px * 2)', 'var(--base)', 'max(4px, 1vw)', '8px !important', '8px ! /* x */ IMPORTANT', '8px /* base */', '/* base */ 8px', '8/* x */px', '"8px']) {
      assert.equal(one(`:root { --radius: ${value}; --z: 1 }`, radius).state, 'formula', value);
    }
  });

  test('a comment after the declaration is not inside the value', () => {
    assert.equal(one(':root { --radius: 8px; /* base */ }', radius).state, 'ok');
    assert.equal(one(':root {\n  /* base */\n  --radius: 8px;\n}', radius).state, 'ok');
  });

  test('a number knob: units are kept and compared, plain numbers only', () => {
    assert.deepEqual(one(':root { --radius: 0.5rem }', radius), { var: '--radius', state: 'unit', value: 0.5, fileUnit: 'rem', alsoSet: [] });
    assert.deepEqual(one(':root { --radius: 8 }', radius), { var: '--radius', state: 'unit', value: 8, fileUnit: '', alsoSet: [] });
    assert.deepEqual(one(':root { --accent-h: 210 }', hue), { var: '--accent-h', state: 'ok', value: 210, fileUnit: '', alsoSet: [] });
    assert.deepEqual(one(':root { --accent-h: -.5 }', hue).value, -0.5);
    assert.equal(one(':root { --radius: 8.px }', radius).value, 8);
    for (const value of ['auto', '#fff', '8 px', '1e3px', '8PX', '+8px', '']) assert.equal(one(`:root { --radius: ${value} }`, radius).state, 'formula', value);
  });

  test('a choice knob: an option is ok, another plain value is "value", anything else a formula', () => {
    assert.deepEqual(one(':root { --density: 1.2 }', density), { var: '--density', state: 'ok', value: '1.2', fileUnit: null, alsoSet: [] });
    assert.deepEqual(one(':root { --density: 0.9 }', density), { var: '--density', state: 'value', value: '0.9', fileUnit: null, alsoSet: [] });
    assert.equal(one(':root { --density: var(--d) }', density).state, 'formula');
    assert.equal(one(':root { --density: url(x.png) }', density).state, 'formula');
    assert.equal(one(':root { --density: a*b }', density).state, 'formula');
    const fonts: TweakChoice = { ...density, var: '--font', options: [{ label: 'A', value: '"Inter", sans-serif' }, { label: 'B', value: 'rgb(1, 2, 3)' }] };
    assert.equal(one(':root { --font: rgb(1, 2, 3) }', fonts).state, 'ok', 'an option the agent declared is ok even when it is a function');
    assert.equal(one(':root { --font: Georgia, serif }', fonts).state, 'value');
  });

  test('every knob is read independently', () => {
    const states = readTweakValues(':root { --radius: calc(1px); --accent-h: 210; }', [radius, hue, density]).map((state) => state.state);
    assert.deepEqual(states, ['formula', 'ok', 'missing']);
  });
});

describe('tweakStateSentence', () => {
  test('the panel and refusal sentences (§4.2)', () => {
    assert.equal(tweakStateSentence(one(':root{--radius:8px}', radius), radius), null);
    assert.equal(tweakStateSentence(one(':root{--density:2}', density), density), null);
    assert.equal(tweakStateSentence(one(':root{}', radius), radius), 'tokens.css has no --radius.');
    assert.equal(tweakStateSentence(one(':root{--radius:calc(1px)}', radius), radius), 'This value is a formula. Ask the agent to change it.');
    assert.equal(tweakStateSentence(one(':root{--radius:1rem}', radius), radius), 'tokens.css sets --radius in rem, but this tweak uses px. Ask the agent to fix it.');
    assert.equal(tweakStateSentence(one(':root{--radius:1}', radius), radius), 'tokens.css sets --radius without a unit, but this tweak uses px. Ask the agent to fix it.');
    assert.equal(tweakStateSentence(one(':root{--accent-h:1deg}', hue), hue), 'tokens.css sets --accent-h in deg, but this tweak uses no unit. Ask the agent to fix it.');
    assert.equal(tweakStateSentence(one(null, radius), radius), 'This design has no tokens.css.');
  });
});

describe('formatTweakNumber', () => {
  test('rounded to the step decimals, trailing zeros trimmed, no exponent, -0 as 0', () => {
    assert.equal(formatTweakNumber(210, 1), '210');
    assert.equal(formatTweakNumber(8, 2), '8');
    assert.equal(formatTweakNumber(0.85, 0.05), '0.85');
    assert.equal(formatTweakNumber(0.1 + 0.2, 0.1), '0.3');
    assert.equal(formatTweakNumber(1.23456, 0.001), '1.235');
    assert.equal(formatTweakNumber(1.5, 0.25), '1.5');
    assert.equal(formatTweakNumber(209.6, 1), '210');
    assert.equal(formatTweakNumber(1_000_000, 1), '1000000');
    assert.equal(formatTweakNumber(-0.0001, 1), '0');
    assert.equal(formatTweakNumber(-0.0001, 0.01), '0');
    assert.equal(formatTweakNumber(-12.5, 0.5), '-12.5');
    assert.equal(formatTweakNumber(0.00004, 0.0001), '0');
  });

  test('with the unit', () => {
    assert.equal(tweakNumberText(10, radius), '10px');
    assert.equal(tweakNumberText(250, hue), '250');
  });
});

describe('spliceTokens and verifyTokenWrite: only the values change', () => {
  const css = '\uFEFF/* tokens */\r\n:root {\r\n  --radius: 8px; /* base */\r\n  --gap:\t12px;\r\n  --accent-h: 210;\r\n}\r\n@media (prefers-color-scheme: dark) { :root { --accent-h: 200; } }\r\n';
  const changesOf = (pairs: [Tweak, string][]): TokenChange[] =>
    pairs.map(([tweak, text]) => {
      const read = readKnobs(css, [tweak])[0];
      assert.ok(read?.declaration);
      return { from: read.declaration.from, to: read.declaration.to, text };
    });

  test('two values in one splice spanning both; every other byte is the original', () => {
    const changes = changesOf([
      [hue, '250'],
      [radius, '10px'],
    ]);
    const splices = spliceTokens(css, changes, 40_000);
    assert.equal(splices.length, 1);
    const [splice] = splices;
    assert.ok(splice);
    const expected = css.replace('--radius: 8px', '--radius: 10px').replace('--accent-h: 210', '--accent-h: 250');
    assert.equal(splice.result, expected);
    assert.equal(splice.removed, '8px; /* base */\r\n  --gap:\t12px;\r\n  --accent-h: 210');
    assert.ok(verifyTokenWrite(css, splice.result, changes));
    // The undo the op records: put `removed` back over `inserted`.
    const undone = splice.result.slice(0, splice.start) + splice.removed + splice.result.slice(splice.start + splice.inserted.length);
    assert.equal(undone, css);
    assert.equal(editedText(splice.result, hue), '250');
    assert.equal(editedText(splice.result, radius), '10px');
  });

  test('a run longer than the cap is split into runs that fit, each in the text the previous left', () => {
    const changes = changesOf([
      [radius, '10px'],
      [hue, '250'],
    ]);
    const splices = spliceTokens(css, changes, 10);
    assert.equal(splices.length, 2);
    for (const splice of splices) assert.ok(splice.removed.length <= 10);
    assert.equal(splices[1]?.result, css.replace('8px', '10px').replace(': 210', ': 250'));
    // Undo newest first restores the original exactly.
    let text = splices.at(-1)?.result ?? '';
    for (const splice of [...splices].reverse()) text = text.slice(0, splice.start) + splice.removed + text.slice(splice.start + splice.inserted.length);
    assert.equal(text, css);
  });

  test('the verify refuses a value that opens a string, a bracket or a comment', () => {
    for (const bad of ["'1", '1(', '1 /* x', '1 [', '"']) {
      const changes = changesOf([[radius, bad]]);
      const [splice] = spliceTokens(css, changes, 40_000);
      assert.ok(splice);
      assert.equal(verifyTokenWrite(css, splice.result, changes), false, bad);
    }
  });

  test('the verify refuses a write that moved or changed anything else', () => {
    const changes = changesOf([[radius, '10px']]);
    const good = css.replace('8px', '10px');
    assert.ok(verifyTokenWrite(css, good, changes));
    assert.equal(verifyTokenWrite(css, good.replace('12px', '13px'), changes), false, 'another value changed');
    assert.equal(verifyTokenWrite(css, good.replace('--gap:\t', '--gap: '), changes), false, 'whitespace before another value moved it');
    assert.equal(verifyTokenWrite(css, good.replace(': 200', ': 201'), changes), false, 'the media value changed');
    assert.equal(verifyTokenWrite(css, good.replace('--gap', '--gaps'), changes), false, 'a name changed');
    assert.equal(verifyTokenWrite(css, css.replace('8px', '10px !important'), [{ ...changes[0], text: '10px !important' } as TokenChange]), false, 'now important');
  });
});

describe('isBalancedQuotes', () => {
  test('even counts of each quote', () => {
    assert.equal(isBalancedQuotes('"Inter", sans-serif'), true);
    assert.equal(isBalancedQuotes("'a' \"b\""), true);
    assert.equal(isBalancedQuotes('"a'), false);
    assert.equal(isBalancedQuotes("it's"), false);
  });
});
