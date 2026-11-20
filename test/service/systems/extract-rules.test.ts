// The pure half of the Code scan (documentation/specs/phase-2-5-technical.md §7.1 to §7.3): every
// extraction rule (CSS light and dark contexts, token JSON shapes, @font-face), which files are
// candidates and which are secret, the merge by file priority, the seeds of a new system (§7.2) and
// the re-sync review (§7.3).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  colourGroupOf,
  extractFromCss,
  extractFromTokenJson,
  forAgentByName,
  isCssFile,
  isFontFolderFile,
  isLogoCandidate,
  isPreprocessorFile,
  isSecretName,
  isTokenJsonFile,
  mergeTokens,
  preprocessorHasVariables,
  presetRootTokens,
  resolveFontUrl,
  resyncReview,
  seedSystemJson,
  seedTokensCss,
  type ExtractedToken,
} from '../../../src/service/systems/extract-rules.ts';
import { SYSTEM_TOKENS_MAX } from '../../../src/shared/limits.ts';
import { isDarkContext, isLightContext } from '../../../src/shared/token-edit.ts';
import { scanFontFaces, scanTokens } from '../../../src/shared/tokens-css.ts';
import type { SystemDetail, SystemToken } from '../../../src/shared/types.ts';

const pick = (tokens: readonly ExtractedToken[], name: string): ExtractedToken | undefined => tokens.find((token) => token.name === name);

describe('extractFromCss: light and dark contexts (§2.4 extraction forms)', () => {
  test('every light form', () => {
    const css = [
      ':root { --a: #111111; }',
      'html { --b: 4px; }',
      ':host { --c: 1rem; }',
      '.light { --d: red; }',
      '[data-theme="light"] { --e: blue; }',
      "[data-theme='light'] { --f: green; }",
      ':root, html { --g: 2px; }',
      '@theme { --h: oklch(0.6 0.1 200); }',
    ].join('\n');
    const { tokens, refused } = extractFromCss(css, 'src/theme.css');
    assert.equal(refused, 0);
    assert.deepEqual(
      tokens.map((token) => [token.name, token.light, token.dark]),
      [
        ['--a', '#111111', null],
        ['--b', '4px', null],
        ['--c', '1rem', null],
        ['--d', 'red', null],
        ['--e', 'blue', null],
        ['--f', 'green', null],
        ['--g', '2px', null],
        ['--h', 'oklch(0.6 0.1 200)', null],
      ],
    );
  });

  test('every dark form, paired with the light value of the same name', () => {
    const css = [
      ':root { --bg: #ffffff; --fg: #000000; --a: 1px; --b: 1px; --c: 1px; --d: 1px; --e: 1px; --f: 1px; }',
      '@media (prefers-color-scheme: dark) { :root { --bg: #000000; } html { --fg: #ffffff; } }',
      '.dark { --a: 2px; }',
      ':root.dark { --b: 2px; }',
      'html.dark { --c: 2px; }',
      '[data-theme="dark"] { --d: 2px; }',
      ':root[data-theme=dark] { --e: 2px; }',
      '[data-mode="dark"] { --f: 2px; }',
    ].join('\n');
    const { tokens } = extractFromCss(css, 'theme.css');
    for (const name of ['--a', '--b', '--c', '--d', '--e', '--f']) assert.deepEqual([pick(tokens, name)?.light, pick(tokens, name)?.dark], ['1px', '2px'], name);
    assert.deepEqual([pick(tokens, '--bg')?.light, pick(tokens, '--bg')?.dark], ['#ffffff', '#000000']);
    assert.deepEqual([pick(tokens, '--fg')?.light, pick(tokens, '--fg')?.dark], ['#000000', '#ffffff']);
  });

  test('component styling and other media are not tokens; the last value in a context wins; lines are 1-based', () => {
    const css = ':root {\n  --brand: #111111;\n}\n.button { --brand: #222222; --pad: 3px; }\n@media (min-width: 600px) { :root { --brand: #333333; } }\n:root {\n  --brand: #444444;\n}\n';
    const { tokens, refused } = extractFromCss(css, 'a.css');
    assert.equal(refused, 0);
    assert.deepEqual(tokens, [{ name: '--brand', light: '#444444', dark: null, line: 7, hint: null }]);
  });

  test('values and names Design Chamber cannot use are refused (counted, no value kept)', () => {
    const css = `:root { --ok: 1px; --img: url(x.png); --bad: expression(alert(1)); --${'x'.repeat(61)}: 1px; --broken: "abc
; --semi: a\\;b; }`;
    const { tokens, refused } = extractFromCss(css, 'a.css');
    assert.deepEqual(tokens.map((token) => token.name), ['--ok']);
    assert.ok(refused >= 3, `refused ${refused}`);
    assert.ok(!JSON.stringify(tokens).includes('url('));
  });

  test('!important and a trailing comment do not spoil the value itself', () => {
    const { tokens } = extractFromCss(':root { --a: #fff !important; --b: 4px /* base */; }', 'a.css');
    assert.deepEqual(tokens.map((token) => [token.name, token.light]), [['--a', '#fff'], ['--b', '4px']]);
  });
});

describe('@font-face (scanFontFaces and the extraction)', () => {
  test('scanFontFaces reads family, weight, style and every src url, never one inside a comment or string', () => {
    const css = `/* @font-face { font-family: Ghost; src: url(ghost.woff2); } */
@font-face {
  font-family: "Inter Display";
  font-weight: 100 900;
  font-style: italic;
  src: url("../fonts/inter.woff2?v=2#x") format("woff2"), url(../fonts/inter.woff) format('woff');
}
.x { content: "@font-face { font-family: Nope }"; }
@media print { @font-face { font-family: Mono; src: url('mono.ttf'); } }`;
    const faces = scanFontFaces(css);
    assert.deepEqual(
      faces.map(({ family, weight, style, urls }) => ({ family, weight, style, urls })),
      [
        { family: 'Inter Display', weight: '100 900', style: 'italic', urls: ['../fonts/inter.woff2?v=2#x', '../fonts/inter.woff'] },
        { family: 'Mono', weight: null, style: null, urls: ['mono.ttf'] },
      ],
    );
  });

  test('resolveFontUrl keeps relative font paths inside the project and refuses the rest', () => {
    assert.equal(resolveFontUrl('src/styles/app.css', '../fonts/inter.woff2?v=2'), 'src/fonts/inter.woff2');
    assert.equal(resolveFontUrl('app.css', './fonts/My%20Font.ttf'), 'fonts/My Font.ttf');
    for (const url of ['../../escape.woff2', '/abs/a.woff2', 'https://cdn.example/a.woff2', '//cdn/a.woff2', 'data:font/woff2;base64,AAAA', 'C:/x.woff2', 'a\\b.woff2', 'fonts/a.svg', 'fonts/%ZZ.woff2', '..%2F..%2Fx.woff2']) {
      assert.equal(resolveFontUrl('src/app.css', url), null, url);
    }
  });

  test('extractFromCss turns a face into a font candidate (first usable url, weight and style mapped)', () => {
    const css = '@font-face { font-family: Inter; font-weight: bold; src: url(https://x/a.woff2), url(fonts/Inter-Bold.woff2); }\n@font-face { font-family: "<script>"; src: url(fonts/odd.otf); }';
    const { faces } = extractFromCss(css, 'web/app.css');
    assert.deepEqual(faces, [
      { path: 'web/fonts/Inter-Bold.woff2', family: 'Inter', weight: 700, style: 'normal' },
      { path: 'web/fonts/odd.otf', family: '', weight: 400, style: 'normal' },
    ]);
  });
});

describe('extractFromTokenJson: DTCG and Style Dictionary', () => {
  test('DTCG: nested paths, $type inherited from groups, references become var(), numbers kept', () => {
    const json = JSON.stringify(
      {
        color: { $type: 'color', $description: 'Brand', brand: { 500: { $value: '#1A73E8' } }, link: { $value: '{color.brand.500}' } },
        space: { md: { $value: '16px', $type: 'dimension' } },
        z: { modal: { $value: 100 } },
        'Font Family': { body: { $type: 'fontFamily', $value: 'Inter, sans-serif' } },
      },
      null,
      2,
    );
    const { tokens, composite, refused, unreadable } = extractFromTokenJson(json, 'tokens.json');
    assert.equal(unreadable, false);
    assert.equal(composite, false);
    assert.equal(refused, 0);
    assert.deepEqual(
      tokens.map((token) => [token.name, token.light, token.dark, token.hint]),
      [
        ['--color-brand-500', '#1A73E8', null, 'colours'],
        ['--color-link', 'var(--color-brand-500)', null, 'colours'],
        ['--space-md', '16px', null, null],
        ['--z-modal', '100', null, null],
        ['--font-family-body', 'Inter, sans-serif', null, 'typography'],
      ],
    );
    assert.ok(tokens.every((token) => token.line > 1), 'lines point into the file');
  });

  test('Style Dictionary `value`; composite values flag the file for the agent; bad values refused', () => {
    const json = JSON.stringify({
      color: { primary: { value: '#ff0000' }, bg: { value: 'url(evil.png)' } },
      typography: { heading: { $value: { fontFamily: 'Inter', fontSize: '32px' } } },
      flag: { value: true },
    });
    const { tokens, composite, refused } = extractFromTokenJson(json, 'design-tokens.json');
    assert.deepEqual(tokens.map((token) => [token.name, token.light]), [['--color-primary', '#ff0000']]);
    assert.equal(composite, true);
    assert.equal(refused, 2);
  });

  test('not JSON is unreadable; nesting beyond depth 8 is not read', () => {
    assert.equal(extractFromTokenJson('{ nope', 't.json').unreadable, true);
    let deep: Record<string, unknown> = { $value: '1px' };
    for (let index = 0; index < 10; index += 1) deep = { [`l${index}`]: deep };
    assert.deepEqual(extractFromTokenJson(JSON.stringify(deep), 't.json').tokens, []);
    let shallow: Record<string, unknown> = { $value: '1px' };
    for (let index = 0; index < 7; index += 1) shallow = { [`l${index}`]: shallow };
    assert.equal(extractFromTokenJson(JSON.stringify(shallow), 't.json').tokens.length, 1);
  });
});

describe('which files', () => {
  test('secret names are recognised whatever else the name says', () => {
    for (const rel of ['.env', 'app/.env.local', '.env.theme.css', 'certs/server.pem', 'a.key', 'b.P12', 'c.pfx', 'd.crt', 'e.cer', '.ssh/id_rsa', 'id_rsa.pub', 'id_ed25519', '.npmrc', '.netrc', 'release.keystore']) {
      assert.equal(isSecretName(rel), true, rel);
    }
    for (const rel of ['env.css', 'tokens.json', 'keys.md', 'monkey.css', 'src/theme.css']) assert.equal(isSecretName(rel), false, rel);
  });

  test('candidates by name', () => {
    assert.equal(isTokenJsonFile('tokens.json'), true);
    assert.equal(isTokenJsonFile('src/design-tokens.dark.json'), true);
    assert.equal(isTokenJsonFile('tokens/color/base.json'), true);
    assert.equal(isTokenJsonFile('package.json'), false);
    assert.equal(isCssFile('a/b.CSS'), true);
    assert.equal(isPreprocessorFile('a.scss'), true);
    assert.equal(isPreprocessorFile('a.less'), true);
    assert.equal(isLogoCandidate('public/Logo-dark.svg'), true);
    assert.equal(isLogoCandidate('img/brand-mark.png'), true);
    assert.equal(isLogoCandidate('img/hero.png'), false);
    assert.equal(isLogoCandidate('logo.gif'), false);
    assert.equal(isFontFolderFile('public/fonts/Inter.woff2'), true);
    assert.equal(isFontFolderFile('public/Inter.woff2'), false);
    assert.match(forAgentByName('tailwind.config.ts') ?? '', /^Tailwind config/);
    assert.match(forAgentByName('src/theme.ts') ?? '', /^Theme written in code/);
    assert.match(forAgentByName('docs/DESIGN.md') ?? '', /^Design document/);
    assert.equal(forAgentByName('src/app.ts'), null);
    assert.equal(preprocessorHasVariables('$brand: #fff;\n.a { color: $brand; }'), true);
    assert.equal(preprocessorHasVariables('@gap: 4px;'), true);
    assert.equal(preprocessorHasVariables('.a { color: red; }\n@media (min-width: 4px) {}'), false);
  });
});

describe('mergeTokens: first file by priority wins per mode', () => {
  test('a later file fills a missing mode and adds "Also set in" when it differs', () => {
    const { tokens, capped } = mergeTokens([
      { file: 'tokens.json', tokens: [{ name: '--brand', light: '#111111', dark: null, line: 3, hint: 'colours' }] },
      { file: 'theme.css', tokens: [{ name: '--brand', light: '#222222', dark: '#eeeeee', line: 9, hint: null }, { name: '--gap', light: '8px', dark: null, line: 2, hint: null }] },
      { file: 'other.css', tokens: [{ name: '--brand', light: '#111111', dark: null, line: 1, hint: null }] },
    ]);
    assert.equal(capped, false);
    assert.deepEqual(tokens, [
      { name: '--brand', light: '#111111', dark: '#eeeeee', file: 'tokens.json', line: 3, section: 'colours', alsoIn: ['theme.css'] },
      { name: '--gap', light: '8px', dark: null, file: 'theme.css', line: 2, section: 'spacing', alsoIn: [] },
    ]);
  });

  test('capped at SYSTEM_TOKENS_MAX names', () => {
    const many = Array.from({ length: SYSTEM_TOKENS_MAX + 5 }, (_value, index): ExtractedToken => ({ name: `--t${index}`, light: '1px', dark: null, line: 1, hint: null }));
    const { tokens, capped } = mergeTokens([{ file: 'a.css', tokens: many }]);
    assert.equal(tokens.length, SYSTEM_TOKENS_MAX);
    assert.equal(capped, true);
  });
});

describe('seeds (§7.2)', () => {
  test('tokens.css: light :root grouped by section with comments, then the dark block; it reads back exactly', () => {
    const css = seedTokensCss([
      { name: '--gap', light: '8px', dark: null, section: 'spacing' },
      { name: '--brand', light: '#1a73e8', dark: '#8ab4f8', section: 'colours' },
      { name: '--odd', light: 'var(--brand)', dark: null, section: 'other' },
    ]);
    assert.equal(
      css,
      ':root {\n  /* Colours */\n  --brand: #1a73e8;\n\n  /* Spacing */\n  --gap: 8px;\n\n  /* Other tokens */\n  --odd: var(--brand);\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    /* Colours */\n    --brand: #8ab4f8;\n  }\n}\n',
    );
    const read = scanTokens(css);
    assert.deepEqual(read.filter((one) => isLightContext(one.context, 'system')).map((one) => one.name), ['--brand', '--gap', '--odd']);
    assert.deepEqual(read.filter((one) => isDarkContext(one.context, 'system')).map((one) => one.name), ['--brand']);
  });

  test('tokens.css refuses a value that would not read back (defence behind rule 1)', () => {
    assert.throws(() => seedTokensCss([{ name: '--x', light: 'red; } body { color: red', dark: null, section: 'other' }]));
  });

  test('no tokens gives the empty structure', () => {
    assert.equal(seedTokensCss([]), ':root {\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n  }\n}\n');
  });

  test('system.json: section for every token, colour groups from name hints, fonts and logos', () => {
    assert.deepEqual(
      ['--brand-500', '--surface-bg', '--text-muted', '--ring', '--danger', '--chart-1', '--sky'].map(colourGroupOf),
      ['brand', 'surface', 'text', 'border', 'status', 'data', null],
    );
    const json = JSON.parse(
      seedSystemJson(
        [
          { name: '--primary', light: '#000000', dark: null, section: 'colours' },
          { name: '--sky', light: '#0000ff', dark: null, section: 'colours' },
          { name: '--gap', light: '8px', dark: null, section: 'spacing' },
        ],
        [{ file: 'assets/fonts/Inter.woff2', family: 'Inter', weight: 400, style: 'normal' }],
        [],
      ),
    ) as Record<string, unknown>;
    assert.deepEqual(json, {
      version: 1,
      tokens: { '--primary': { section: 'colours', group: 'brand' }, '--sky': { section: 'colours' }, '--gap': { section: 'spacing' } },
      fonts: [{ file: 'assets/fonts/Inter.woff2', family: 'Inter', weight: 400, style: 'normal' }],
    });
  });

  test('a bundled preset gives its :root custom properties', async () => {
    const text = await readFile(path.resolve(import.meta.dirname, '../../../rules/presets/minimal-saas.md'), 'utf8');
    const tokens = presetRootTokens(text);
    assert.ok(tokens.length > 3, `${tokens.length} tokens`);
    assert.ok(tokens.every((token) => token.name.startsWith('--') && token.light !== null && token.dark === null));
    assert.deepEqual(presetRootTokens('# No css here\n'), []);
    assert.deepEqual(presetRootTokens('```css\n:root { --a: url(x); --b: 2px; }\n.x { --c: 1px; }\n```\n').map((token) => token.name), ['--b']);
  });
});

describe('resyncReview (§7.3)', () => {
  const token = (name: string, light: string | null, dark: string | null = null): SystemToken => ({
    name,
    section: 'colours',
    group: 'other',
    light: light === null ? null : { text: light, editable: 'ok', problem: null },
    dark: dark === null ? null : { text: dark, editable: 'ok', problem: null },
    note: '',
    breakpoint: false,
    alsoSet: [],
    fromCode: true,
    problem: null,
  });
  const detail = (tokens: SystemToken[]): Pick<SystemDetail, 'tokens' | 'fonts' | 'logos'> => ({
    tokens,
    fonts: [{ file: 'assets/fonts/Inter.woff2', family: 'Inter', weight: 400, style: 'normal' }],
    logos: [],
  });

  test('changed, conflicts, new, gone, and new asset files', () => {
    const review = resyncReview(
      detail([token('--same', '#111111'), token('--moved', '#222222', '#333333'), token('--mine', '#999999'), token('--gone', '#444444'), token('--agent', '#555555')]),
      {
        '--same': { file: 'a.css', line: 1, light: '#111111', dark: null },
        '--moved': { file: 'a.css', line: 2, light: '#222222', dark: '#333333' },
        '--mine': { file: 'a.css', line: 3, light: '#000000', dark: null },
        '--gone': { file: 'a.css', line: 4, light: '#444444', dark: null },
      },
      {
        tokens: [
          { name: '--same', light: '#111111', dark: null },
          { name: '--moved', light: '#aaaaaa', dark: '#bbbbbb' },
          { name: '--mine', light: '#cccccc', dark: null },
          { name: '--new', light: '1px', dark: null },
        ],
        scanned: ['a.css'],
        assets: [
          { path: 'fonts/Inter.woff2', kind: 'font' },
          { path: 'img/logo.svg', kind: 'logo' },
        ],
        partial: false,
      },
    );
    assert.deepEqual(review, {
      kind: 'code',
      changed: [
        { name: '--moved', mode: 'light', from: '#222222', to: '#aaaaaa' },
        { name: '--moved', mode: 'dark', from: '#333333', to: '#bbbbbb' },
      ],
      conflicts: [{ name: '--mine', mode: 'light', mine: '#999999', code: '#cccccc' }],
      added: ['--new'],
      removed: ['--gone'],
      assets: [{ path: 'img/logo.svg', kind: 'logo' }],
      partial: false,
    });
  });

  test('a token whose file was not read is never listed as removed; agent tokens never are', () => {
    const review = resyncReview(
      detail([token('--far', '#111111'), token('--agent', '#222222')]),
      { '--far': { file: 'deep/far.css', line: 1, light: '#111111', dark: null } },
      { tokens: [], scanned: ['a.css'], assets: [], partial: true },
    );
    assert.deepEqual(review.removed, []);
    assert.equal(review.partial, true);
  });
});
