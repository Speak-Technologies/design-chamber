// `system-motion-no-reduced` (documentation/specs/system-builder-depth.md §4.6, §13 T10a): a component,
// pattern or brand example that declares `transition` or `animation` without a `prefers-reduced-motion`
// media query. Boundaries: a reduce block clears it, a comment holding the words does not; one finding
// with the count and up to three files; uncovered areas are not judged; the run reads the bundled example,
// so a linked stylesheet's rule counts.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { MOTION_PROPERTIES, movesWithoutReducedMotion, systemFindings } from '../../../src/service/check/system-static.ts';
import { findingMessage, severityOf } from '../../../src/shared/checks.ts';
import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { CheckFindingData, SystemDetail } from '../../../src/shared/types.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const NOW = '2026-11-27T10:00:00.000Z';

const detailOf = (json: Record<string, unknown>): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(json),
    tokensCss: ':root {\n  --duration-fast: 120ms;\n}\n',
    texts: {},
    files: [],
    build: null,
  });

const motionOf = (findings: readonly CheckFindingData[]): CheckFindingData[] => findings.filter((finding) => finding.code === 'system-motion-no-reduced');

const MOVES = '<style>.menu { transition: opacity var(--duration-fast) ease-out; }</style><div class="menu">Menu</div>';
const REDUCE = '@media (prefers-reduced-motion: reduce) { .menu { transition: none; } }';

describe('movesWithoutReducedMotion', () => {
  test('a transition with no reduced-motion rule moves; a reduce block clears it', () => {
    assert.equal(movesWithoutReducedMotion(MOVES), true);
    assert.equal(movesWithoutReducedMotion(MOVES.replace('</style>', `${REDUCE}</style>`)), false);
    // The no-preference form (motion added only when wanted) is a reduced-motion rule too.
    assert.equal(movesWithoutReducedMotion('<style>@media (prefers-reduced-motion: no-preference) { .a { animation: spin 1s; } }</style>'), false);
    assert.equal(movesWithoutReducedMotion('<style>@media screen and (prefers-reduced-motion:reduce){.a{x:y}} .a { animation: spin 1s; }</style>'), false);
  });

  test('a comment holding the words does not clear it, in CSS or in HTML', () => {
    assert.equal(movesWithoutReducedMotion(MOVES.replace('</style>', `/* ${REDUCE} */</style>`)), true);
    assert.equal(movesWithoutReducedMotion(`${MOVES}<!-- <style>${REDUCE}</style> -->`), true);
    // Nor does the text of the page or a script.
    assert.equal(movesWithoutReducedMotion(`${MOVES}<p>We honour @media (prefers-reduced-motion: reduce).</p>`), true);
    assert.equal(movesWithoutReducedMotion(`${MOVES}<script>matchMedia('@media (prefers-reduced-motion: reduce)')</script>`), true);
  });

  test('each matched property, its longhands, a vendor form and a style attribute count as motion', () => {
    assert.deepEqual(MOTION_PROPERTIES, ['transition', 'animation']);
    for (const css of ['transition: transform 200ms', 'animation: spin 1s linear infinite', 'transition-duration: 200ms', 'animation-name: pulse', '-webkit-transition: opacity 1s']) {
      assert.equal(movesWithoutReducedMotion(`<style>.a { ${css}; }</style>`), true, css);
    }
    assert.equal(movesWithoutReducedMotion('<button style="transition: background 120ms">Go</button>'), true);
  });

  test('what does not move: none, custom properties, other properties, text, comments and scripts', () => {
    for (const html of [
      '<style>.a { transition: none; animation: NONE; }</style>',
      '<style>:root { --transition-fast: 120ms; } .a { view-transition-name: card; }</style>',
      '<style>.a { color: red; } .transition:hover { color: blue; }</style>',
      '<p>transition: opacity 1s</p>',
      '<style>/* .a { transition: opacity 1s; } */</style>',
      '<!-- <style>.a { transition: opacity 1s; }</style> -->',
      "<script>el.style.transition = 'x'; const css = '.a{animation: spin 1s}';</script>",
      '<div title="animation: spin 1s">Hi</div>',
    ]) {
      assert.equal(movesWithoutReducedMotion(html), false, html);
    }
  });

  test('a linked stylesheet the bundler inlined with media keeps its reduced-motion rule', () => {
    assert.equal(movesWithoutReducedMotion(`${MOVES}<style media="(prefers-reduced-motion: reduce)">.menu { transition: none; }</style>`), false);
    assert.equal(movesWithoutReducedMotion(`${MOVES}<style media="print">.menu { transition: none; }</style>`), true);
  });

  test('an unclosed comment, tag or style ends the scan without hanging', () => {
    assert.equal(movesWithoutReducedMotion('<style>.a { transition: opacity 1s; } /* open'), true);
    assert.equal(movesWithoutReducedMotion('<style>.a { animation: x 1s; }'), true);
    assert.equal(movesWithoutReducedMotion('<!-- open <style>.a { animation: x 1s; }</style>'), false);
    const started = Date.now();
    movesWithoutReducedMotion('<style'.repeat(200_000));
    movesWithoutReducedMotion(`<style>${'/*'.repeat(200_000)}`);
    movesWithoutReducedMotion(`<style>${'@media '.repeat(100_000)}</style>`);
    assert.ok(Date.now() - started < 3000);
  });
});

describe('system-motion-no-reduced in systemFindings', () => {
  const json = {
    components: [
      { id: 'menu', name: 'Menu', example: 'components/menu.html' },
      { id: 'card', name: 'Card', example: 'components/card.html' },
      { id: 'still', name: 'Still', example: 'components/still.html' },
    ],
    patterns: [{ id: 'sheet', kind: 'overlay', title: 'Sheet', example: 'patterns/sheet.html' }],
    brand: [
      { id: 'hero', kind: 'marketing', title: 'Hero', example: 'brand/hero.html' },
      { id: 'calm', kind: 'marketing', title: 'Calm', example: 'brand/calm.html' },
    ],
  };
  const texts = {
    'components/menu.html': MOVES,
    'components/card.html': MOVES,
    'components/still.html': '<p>Still</p>',
    'patterns/sheet.html': MOVES,
    'brand/hero.html': MOVES,
    'brand/calm.html': MOVES.replace('</style>', `${REDUCE}</style>`),
  };

  test('one warning with the count and up to three files, across components, patterns and brand', () => {
    const found = motionOf(systemFindings({ texts: {}, bundled: texts }, detailOf(json)));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.file, 'components/menu.html');
    assert.equal(found[0]?.params?.count, 4);
    assert.equal(found[0]?.detail, 'components/menu.html, components/card.html, patterns/sheet.html');
    assert.equal(severityOf('system-motion-no-reduced'), 'warning');
    const finding = found[0];
    assert.ok(finding !== undefined);
    assert.equal(findingMessage(finding), '4 examples move but have no prefers-reduced-motion rule.');
  });

  test('an area the system does not cover is not judged', () => {
    const found = motionOf(systemFindings({ texts: {}, bundled: texts }, detailOf({ ...json, coverage: ['foundations', 'brand'] })));
    assert.equal(found[0]?.params?.count, 1);
    assert.equal(found[0]?.file, 'brand/hero.html');
    assert.deepEqual(motionOf(systemFindings({ texts: {}, bundled: texts }, detailOf({ ...json, coverage: ['foundations'] }))), []);
  });

  test('every example clear, or no text read, raises nothing; the file as written is read when no bundle is given', () => {
    assert.deepEqual(motionOf(systemFindings({ texts: {}, bundled: { 'brand/calm.html': texts['brand/calm.html'] } }, detailOf(json))), []);
    assert.deepEqual(motionOf(systemFindings({ texts: {} }, detailOf(json))), []);
    assert.equal(motionOf(systemFindings({ texts: {}, examples: { 'components/menu.html': MOVES } }, detailOf(json)))[0]?.params?.count, 1);
    // The bundled text wins over the file as written.
    assert.deepEqual(motionOf(systemFindings({ texts: {}, examples: { 'components/menu.html': MOVES }, bundled: { 'components/menu.html': texts['brand/calm.html'] } }, detailOf(json))), []);
  });
});

describe('system-motion-no-reduced in a run', () => {
  test('the run reads each example bundled, so a linked stylesheet with the rule clears it', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('_systems/acme/.chamber/state.json', { v: 1, id: 'acme', name: 'Acme', status: 'draft' });
    await tmp.write('_systems/acme/tokens.css', ':root {\n  --duration-fast: 120ms;\n}\n');
    await tmp.write(
      '_systems/acme/system.json',
      JSON.stringify({
        components: [
          { id: 'menu', name: 'Menu', example: 'components/menu.html' },
          { id: 'tabs', name: 'Tabs', example: 'components/tabs.html' },
        ],
        patterns: [{ id: 'sheet', kind: 'overlay', title: 'Sheet', example: 'patterns/sheet.html' }],
      }),
    );
    await tmp.write('_systems/acme/components/motion.css', `${REDUCE}\n`);
    await tmp.write('_systems/acme/components/menu.html', `<link rel="stylesheet" href="motion.css">${MOVES}`);
    await tmp.write('_systems/acme/components/tabs.html', MOVES);
    await tmp.write('_systems/acme/patterns/sheet.html', MOVES);
    const { report } = await runSystemCheck(cliSystemStore(tmp.root, { version: 1 }), 'acme', { now: new Date(NOW), tool: 'cli' });
    const found = motionOf(report.static.findings);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.params?.count, 2);
    assert.equal(found[0]?.detail, 'components/tabs.html, patterns/sheet.html');
  });
});
