// The builder-depth static checks (documentation/specs/system-builder-depth.md §4.5, T6): the contrast
// maths against known WCAG values, pairs at their level's boundary, the example label scan and its
// bounds, example and label findings by depth, the coverage gap, and that the Checks badge and "Ask the
// agent to fix" carry the new findings through the existing report path.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { contrastRatio, parseCssColor } from '../../../src/shared/color.ts';
import { MEASURED_PAIR_TOLERANCE, PAIR_LEVELS, pairKey, ratioText, staticLowPairs, staticPairRatio } from '../../../src/shared/pair-contrast.ts';
import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { scanExampleLabels, systemFindings } from '../../../src/service/check/system-static.ts';
import { findingMessage, parseFindingData, severityOf, withMessage } from '../../../src/shared/checks.ts';
import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { CheckFindingData, SystemArea, SystemDetail } from '../../../src/shared/types.ts';
import { formatSystemCheckText } from '../../../src/service/check/report-text.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const NOW = '2026-11-27T10:00:00.000Z';

const detailOf = (tokensCss: string, json: Record<string, unknown>, files: readonly string[] = []): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(json),
    tokensCss,
    texts: {},
    files: files.map((rel) => ({ rel, bytes: 1 })),
    build: null,
  });

const ratio = (fg: string, bg: string): number => {
  const a = parseCssColor(fg);
  const b = parseCssColor(bg);
  assert.ok(a !== null && b !== null);
  return contrastRatio(a, [b]);
};

const ofCode = (findings: readonly CheckFindingData[], code: CheckFindingData['code']): CheckFindingData[] => findings.filter((finding) => finding.code === code);

describe('contrast maths (WCAG 2)', () => {
  test('known ratios', () => {
    assert.equal(ratio('#000000', '#ffffff'), 21);
    assert.equal(ratio('#ffffff', '#ffffff'), 1);
    assert.equal(ratioText(ratio('#767676', '#ffffff')), '4.54:1');
    assert.equal(ratioText(ratio('#777777', '#ffffff')), '4.47:1');
    assert.equal(ratioText(ratio('#595959', '#ffffff')), '7.00:1');
    assert.equal(ratioText(ratio('#949494', '#ffffff')), '3.03:1');
    // Order doesn't matter: the lighter colour is always on top of the fraction.
    assert.equal(ratio('#ffffff', '#767676'), ratio('#767676', '#ffffff'));
  });

  test('ratios are written rounded down, so a failing pair never reads as passing', () => {
    assert.equal(ratioText(4.4999), '4.49:1');
    assert.equal(ratioText(4.5), '4.50:1');
    assert.equal(ratioText(21), '21.00:1');
  });

  test('levels: body text 4.5, large text and UI parts 3; the measured tolerance is 0.05', () => {
    assert.deepEqual(PAIR_LEVELS, { text: 4.5, large: 3, ui: 3 });
    assert.equal(MEASURED_PAIR_TOLERANCE, 0.05);
  });

  test('static ratios: light values, dark values with light where a token has none; oklch, var() and a see-through ground are left to the browser', () => {
    const css = ':root {\n  --bg: #ffffff;\n  --fg: #767676;\n  --soft: oklch(0.7 0.1 250);\n  --glass: rgb(255 255 255 / 0.5);\n  --mix: var(--fg);\n}\n@media (prefers-color-scheme: dark) {\n  :root { --bg: #000000; }\n}\n';
    const detail = detailOf(css, {});
    assert.equal(ratioText(staticPairRatio(detail, { fg: '--fg', bg: '--bg' }, 'light') ?? 0), '4.54:1');
    assert.equal(ratioText(staticPairRatio(detail, { fg: '--fg', bg: '--bg' }, 'dark') ?? 0), ratioText(ratio('#767676', '#000000')));
    assert.equal(staticPairRatio(detail, { fg: '--soft', bg: '--bg' }, 'light'), null);
    assert.equal(staticPairRatio(detail, { fg: '--fg', bg: '--glass' }, 'light'), null);
    assert.equal(staticPairRatio(detail, { fg: '--mix', bg: '--bg' }, 'light'), null);
  });
});

describe('system-contrast-low', () => {
  const pairSystem = (fg: string, use: 'text' | 'large' | 'ui', dark = '') =>
    detailOf(`:root {\n  --bg: #ffffff;\n  --fg: ${fg};\n}\n${dark === '' ? '' : `@media (prefers-color-scheme: dark) {\n  :root { --bg: #000000; --fg: ${dark}; }\n}\n`}`, { pairs: [{ fg: '--fg', bg: '--bg', use }] });

  test('body text at the 4.5 boundary: 4.4998:1 is a finding, 4.5002:1 is not', () => {
    assert.ok(ratio('#617d6e', '#ffffff') < 4.5 && ratio('#617d6e', '#ffffff') > 4.499);
    assert.ok(ratio('#877364', '#ffffff') >= 4.5 && ratio('#877364', '#ffffff') < 4.501);
    const under = systemFindings({ texts: {} }, pairSystem('#617d6e', 'text'));
    assert.deepEqual(ofCode(under, 'system-contrast-low').map((finding) => [finding.params, finding.detail]), [[{ count: 1, scheme: 'light' }, '--fg on --bg 4.49:1 (light)']]);
    assert.deepEqual(ofCode(systemFindings({ texts: {} }, pairSystem('#877364', 'text')), 'system-contrast-low'), []);
  });

  test('large text and UI parts at the 3 boundary', () => {
    for (const use of ['large', 'ui'] as const) {
      assert.equal(ofCode(systemFindings({ texts: {} }, pairSystem('#789d8c', use)), 'system-contrast-low').length, 1, use);
      assert.equal(ofCode(systemFindings({ texts: {} }, pairSystem('#a78f94', use)), 'system-contrast-low').length, 0, use);
    }
  });

  test('each scheme is its own finding; the dark one says dark', () => {
    const findings = ofCode(systemFindings({ texts: {} }, pairSystem('#617d6e', 'text', '#202020')), 'system-contrast-low');
    assert.deepEqual(findings.map((finding) => finding.params?.scheme), ['light', 'dark']);
    assert.match(findings[1]?.detail ?? '', /^--fg on --bg 1\.\d\d:1 \(dark\)$/);
    assert.equal(findingMessage(findings[1] as CheckFindingData), '1 colour pair is under its contrast level on the dark scheme.');
  });

  test('automatic pairs are judged too; the judged set names each pair and scheme Node could read', () => {
    const detail = detailOf(':root {\n  --accent: #2456d6;\n  --accent-fg: #6688ff;\n  --soft: oklch(0.7 0.1 250);\n  --on-soft: #000;\n}\n', {});
    const { low, judged } = staticLowPairs(detail);
    assert.deepEqual(low.map((one) => [one.pair.fg, one.pair.auto]), [['--accent-fg', true]]);
    assert.deepEqual([...judged], [pairKey(0, 'light')]);
  });

  test('not raised when Colours is not covered', () => {
    const detail = { ...pairSystem('#617d6e', 'text'), coverage: ['components' as const] };
    assert.deepEqual(ofCode(systemFindings({ texts: {} }, detail), 'system-contrast-low'), []);
  });
});

describe('example labels', () => {
  test('the scan reads the three attributes in any quoting, trimmed and lower-cased', () => {
    const labels = scanExampleLabels(`<button data-dc-variant="Primary" data-dc-size='lg'>a</button><b data-dc-state=hover></b><i DATA-DC-STATE = " Focus ">x</i>`);
    assert.deepEqual([...labels.variants], ['primary']);
    assert.deepEqual([...labels.sizes], ['lg']);
    assert.deepEqual([...labels.states], ['hover', 'focus']);
  });

  test('bounds: at most 500 labels read, values over 40 characters skipped', () => {
    const many = Array.from({ length: 600 }, (_, n) => `<b data-dc-state="s${n}"></b>`).join('');
    const read = scanExampleLabels(many).states;
    assert.equal(read.size, 500);
    assert.ok(read.has('s499') && !read.has('s500'));
    assert.equal(scanExampleLabels(`<b data-dc-state="${'x'.repeat(41)}"></b>`).states.size, 0);
    assert.equal(scanExampleLabels(`<b data-dc-state="${'x'.repeat(40)}"></b>`).states.size, 1);
  });

  const button = (states: string[], sizes: string[] = []) => ({
    depth: 'core',
    components: [{ id: 'button', name: 'Button', variants: ['primary'], sizes, states, example: 'components/button.html' }],
  });
  const LABELLED = '<button data-dc-variant="primary" data-dc-state="hover">a</button><button data-dc-state="disabled" data-dc-size="sm">b</button>';
  const run = (json: Record<string, unknown>, html: string | null = LABELLED) =>
    systemFindings({ texts: {}, ...(html === null ? {} : { examples: { 'components/button.html': html } }) }, detailOf(':root {}', json, ['components/button.html']));

  test('every listed name labelled: no finding; one state missing: one finding naming it', () => {
    assert.deepEqual(ofCode(run(button(['hover', 'disabled'], ['sm'])), 'system-states-missing'), []);
    const one = ofCode(run(button(['hover', 'disabled', 'Focus'])), 'system-states-missing');
    assert.deepEqual(one.map((finding) => [finding.params, finding.detail]), [[{ count: 1, listed: 'states' }, 'button: Focus']]);
    assert.equal(findingMessage(one[0] as CheckFindingData), '1 state listed in system.json has no labelled instance in its example. Label each one with data-dc-state.');
    assert.equal(severityOf('system-states-missing', one[0]?.params), 'warning');
  });

  test('variants, sizes and states are separate findings', () => {
    const findings = ofCode(run({ ...button(['loading'], ['lg']), components: [{ ...button([]).components[0], variants: ['ghost'], sizes: ['lg'], states: ['loading'] }] }), 'system-states-missing');
    assert.deepEqual(findings.map((finding) => finding.params?.listed), ['variants', 'sizes', 'states']);
  });

  test('not judged without a depth, without the example text, or when Components is not covered', () => {
    const { depth: _depth, ...noDepth } = button(['focus']);
    assert.deepEqual(ofCode(run(noDepth), 'system-states-missing'), []);
    assert.deepEqual(ofCode(run(button(['focus']), null), 'system-states-missing'), []);
    assert.deepEqual(ofCode(run({ ...button(['focus']), coverage: ['foundations'] }), 'system-states-missing'), []);
  });
});

describe('system-example-missing', () => {
  const json = (depth: string | undefined) => ({
    ...(depth === undefined ? {} : { depth }),
    components: [{ id: 'button', name: 'Button', example: 'components/button.html' }, { id: 'chip', name: 'Chip' }],
    patterns: [{ id: 'nav', kind: 'navigation', title: 'Nav' }, { id: 'voice', kind: 'voice', title: 'Voice' }],
  });
  const findingsAt = (depth: string | undefined) => ofCode(systemFindings({ texts: {} }, detailOf(':root {}', json(depth), ['components/button.html'])), 'system-example-missing');

  test('core: info, components only; full: a warning that adds patterns of a visual kind', () => {
    const core = findingsAt('core');
    assert.deepEqual(core.map((finding) => [finding.params, finding.detail]), [[{ count: 1, depth: 'core' }, 'components/chip.html']]);
    assert.equal(severityOf('system-example-missing', core[0]?.params), 'info');
    const full = findingsAt('full');
    assert.deepEqual(full.map((finding) => [finding.params, finding.detail]), [[{ count: 2, depth: 'full' }, 'components/chip.html, patterns/nav.html']]);
    assert.equal(severityOf('system-example-missing', full[0]?.params), 'warning');
    assert.equal(findingMessage(full[0] as CheckFindingData), '2 entries have no live example yet, so the board shows only their words.');
  });

  test('no depth, or tokens: not raised', () => {
    assert.deepEqual(findingsAt(undefined), []);
    assert.deepEqual(findingsAt('tokens'), []);
  });
});

describe('system-coverage-gap', () => {
  const gaps = (json: Record<string, unknown>) => ofCode(systemFindings({ texts: {} }, detailOf(':root {}', json)), 'system-coverage-gap');

  test('no depth: no gap check, whatever is missing', () => {
    assert.deepEqual(gaps({}), []);
  });

  test('one finding per covered area, detail only closed topic ids, info at core and warning at full', () => {
    const core = gaps({ depth: 'core', coverage: ['foundations', 'brand'] });
    assert.deepEqual(core.map((finding) => finding.params?.area), ['foundations', 'brand']);
    assert.equal(core[0]?.detail, 'surface, text, border, brand, status, type-styles, spacing, radius');
    assert.equal(core[0]?.params?.count, 9);
    assert.equal(severityOf('system-coverage-gap', core[0]?.params), 'info');
    assert.equal(findingMessage(core[0] as CheckFindingData), 'Foundations is missing 9 things a product core system covers.');
    const full = gaps({ depth: 'full', coverage: ['brand'] });
    assert.equal(severityOf('system-coverage-gap', full[0]?.params), 'warning');
    assert.equal(findingMessage(full[0] as CheckFindingData), 'Brand & marketing is missing 4 things a full system covers.');
  });

  test('outOfScope ids stop counting; an area with nothing left raises nothing', () => {
    assert.deepEqual(gaps({ depth: 'core', coverage: ['brand'], outOfScope: ['logo'] }), []);
    assert.equal(gaps({ depth: 'full', coverage: ['brand'], outOfScope: ['logo', 'imagery'] })[0]?.detail, 'brand-colour, marketing');
  });

  test('a tokens system is asked the foundations core set only', () => {
    assert.deepEqual(gaps({ depth: 'tokens' }).map((finding) => finding.params?.area), ['foundations']);
  });

  test('agent text never reaches the detail: an unknown outOfScope id is an entry problem, not a gap', () => {
    const findings = systemFindings({ texts: {} }, detailOf(':root {}', { depth: 'core', coverage: ['brand'], outOfScope: ['<b>logo</b>'] }));
    assert.equal(ofCode(findings, 'system-coverage-gap')[0]?.detail, 'logo');
    assert.equal(ofCode(findings, 'system-entry-invalid')[0]?.detail, 'outOfScope');
  });
});

describe('the report path the Checks badge and "Ask the agent to fix" read', () => {
  test('stored findings keep their new params through the untrusted parser, and forged ones are dropped', () => {
    const parsed = parseFindingData({ code: 'system-coverage-gap', file: 'system.json', screen: null, viewport: null, params: { area: 'brand', count: 2, depth: 'full', scheme: 'dark', listed: 'sizes' }, detail: 'imagery, marketing' });
    assert.deepEqual(parsed?.params, { count: 2, area: 'brand', depth: 'full', scheme: 'dark', listed: 'sizes' });
    const forged = parseFindingData({ code: 'system-coverage-gap', file: null, screen: null, viewport: null, params: { depth: 'huge', scheme: 'dim', listed: 'colours' } });
    assert.equal(forged?.params, undefined);
    assert.equal(withMessage(parsed as CheckFindingData).severity, 'warning');
  });

  test('a run on a real system folder reads the example text and reports every new code', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('_systems/acme/.chamber/state.json', { v: 1, id: 'acme', name: 'Acme', status: 'draft' });
    await tmp.write('_systems/acme/tokens.css', ':root {\n  --bg: #ffffff;\n  --fg: #617d6e;\n}\n');
    await tmp.write(
      '_systems/acme/system.json',
      JSON.stringify({
        depth: 'full',
        tokens: { '--bg': { group: 'surface' }, '--fg': { group: 'text' } },
        pairs: [{ fg: '--fg', bg: '--bg' }],
        components: [{ id: 'button', name: 'Button', states: ['hover', 'disabled'], example: 'components/button.html' }],
        patterns: [{ id: 'nav', kind: 'navigation', title: 'Nav' }],
      }),
    );
    await tmp.write('_systems/acme/components/button.html', '<button data-dc-state="hover">Go</button>');
    const { report } = await runSystemCheck(cliSystemStore(tmp.root, { version: 1 }), 'acme', { now: new Date(NOW), tool: 'cli' });
    const codes = report.static.findings.map((finding) => finding.code);
    for (const code of ['system-example-missing', 'system-states-missing', 'system-contrast-low', 'system-coverage-gap'] as const) assert.ok(codes.includes(code), code);
    assert.equal(ofCode(report.static.findings, 'system-states-missing')[0]?.detail, 'button: disabled');
    // What the badge counts and the ask sends: warnings at full, with their sentences.
    const shown = report.static.findings.map((finding) => withMessage(finding)).filter((finding) => finding.severity !== 'info');
    assert.ok(shown.some((finding) => finding.message.startsWith('1 state listed in system.json')));
  });
});

describe('automatic pairs on a system made before builder depth (the main agent ruling, 2026-11-27)', () => {
  // --accent-fg on --accent is 1.5:1: an automatic pair under its level.
  const CSS = ':root {\n  --accent: #2456d6;\n  --accent-fg: #3a6ae0;\n  --bg: #ffffff;\n  --faint: #777777;\n}\n';
  const contrast = (json: Record<string, unknown>) => ofCode(systemFindings({ texts: {} }, detailOf(CSS, json)), 'system-contrast-low');

  test('no depth and only automatic pairs low: a note, never a new warning', () => {
    const findings = contrast({});
    assert.deepEqual(findings.map((finding) => finding.params), [{ count: 1, scheme: 'light', pairs: 'auto' }]);
    assert.equal(severityOf('system-contrast-low', findings[0]?.params), 'info');
  });

  test('a pair the agent wrote keeps its warning, alone or beside automatic ones, and so does any pair once depth is set', () => {
    const written = contrast({ pairs: [{ fg: '--faint', bg: '--bg' }] });
    assert.deepEqual(written.map((finding) => [finding.params, severityOf('system-contrast-low', finding.params)]), [[{ count: 2, scheme: 'light' }, 'warning']]);
    const withDepth = contrast({ depth: 'core' });
    assert.deepEqual(withDepth.map((finding) => severityOf('system-contrast-low', finding.params)), ['warning']);
  });

  test('the auto marker survives the stored report, and nothing else turns it on', () => {
    assert.deepEqual(parseFindingData({ code: 'system-contrast-low', file: 'tokens.css', screen: null, viewport: null, params: { count: 1, scheme: 'light', pairs: 'auto' } })?.params, { count: 1, scheme: 'light', pairs: 'auto' });
    assert.equal(parseFindingData({ code: 'system-contrast-low', file: 'tokens.css', screen: null, viewport: null, params: { pairs: 'all' } })?.params, undefined);
  });
});

describe('KI-39: remote refs in examples, on the file checks', () => {
  test('a component, a pattern and a brand example with a remote image give one system-example-remote each, without a browser', async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('_systems/acme/.chamber/state.json', { v: 1, id: 'acme', name: 'Acme', status: 'draft' });
    await tmp.write('_systems/acme/tokens.css', ':root {\n  --bg: #ffffff;\n}\n');
    await tmp.write(
      '_systems/acme/system.json',
      JSON.stringify({
        components: [{ id: 'card', name: 'Card', example: 'components/card.html' }, { id: 'plain', name: 'Plain', example: 'components/plain.html' }],
        patterns: [{ id: 'nav', kind: 'navigation', title: 'Nav', example: 'patterns/nav.html' }],
        brand: [{ id: 'hero', kind: 'marketing', title: 'Hero', example: 'brand/hero.html' }],
      }),
    );
    await tmp.write('_systems/acme/components/card.html', '<img alt="" src="https://example.com/x.png">');
    await tmp.write('_systems/acme/components/plain.html', '<p>Local only.</p>');
    await tmp.write('_systems/acme/patterns/nav.html', '<nav><img alt="" src="https://example.com/x.png"></nav>');
    await tmp.write('_systems/acme/brand/hero.html', '<section><img alt="" src="https://example.com/x.png"></section>');
    const store = cliSystemStore(tmp.root, { version: 1 });
    try {
      const { report } = await runSystemCheck(store, 'acme', { now: new Date(NOW), tool: 'cli' });
      const remote = ofCode(report.static.findings, 'system-example-remote');
      assert.deepEqual(remote.map((finding) => [finding.file, finding.detail]), [
        ['components/card.html', 'https://example.com/x.png'],
        ['patterns/nav.html', 'https://example.com/x.png'],
        ['brand/hero.html', 'https://example.com/x.png'],
      ]);
      assert.equal(severityOf('system-example-remote'), 'error');
    } finally {
      await store.dispose();
    }
  });
});

describe('--area brand --scheme dark', () => {
  test('the empty pictures line says why: the dark pass does not picture Brand', () => {
    const render = { state: 'done' as const, browser: 'chrome' as const, drawn: { from: 'system' as const, proposal: null }, widths: [], shots: [], entryShots: [], findings: [] };
    const text = (areas: SystemArea[], schemes: ('light' | 'dark')[]) =>
      formatSystemCheckText({ report: { version: 1, system: 'acme', createdAt: NOW, tool: 'cli', static: { findings: [] }, render: { ...render, areas, schemes } }, name: 'Acme', reportPath: null });
    assert.match(text(['brand'], ['dark']), /No board pictures were saved: the dark pass pictures Foundations, Components and Patterns & voice, not Brand & marketing\. Check Brand with --scheme light\./);
    assert.match(text(['components'], ['dark']), /No board pictures were saved\.\n/);
  });
});
