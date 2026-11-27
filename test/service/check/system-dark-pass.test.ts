// The visual system check's builder-depth part (documentation/specs/system-builder-depth.md D8, §4.5,
// T7), without a browser: which passes a run draws and their budget shares, the probe's pair cells at
// the boundary, the measured pair verdicts, the dark pass deduped against the light wide one, `--area`,
// the flags and the tool input, and a run whose dark pass is cut by the budget.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BOARD_PAIR_CELLS_MAX,
  BOARD_PASSES,
  boardPassesOf,
  dedupeBoardFindings,
  findingsInArea,
  measuredPairFindings,
  passShare,
  sanitizeBoardProbe,
  type BoardProbe,
  type BoardProbePair,
} from '../../../src/service/check/board-analyze.ts';
import { staticLowPairs } from '../../../src/shared/pair-contrast.ts';
import { parseArgs } from '../../../src/service/check/report-text.ts';
import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { buildChildArgs, parseToolInput, TOOL_INPUT } from '../../../src/plugin/check-tool.ts';
import { findingMessage } from '../../../src/shared/checks.ts';
import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { CheckFindingData, SystemDetail } from '../../../src/shared/types.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const NOW = '2026-11-27T10:00:00.000Z';

const detailOf = (tokensCss: string, json: Record<string, unknown>): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(json),
    tokensCss,
    texts: {},
    files: [],
    build: null,
  });

const PROBE = { innerWidth: 1526, scrollWidth: 1526, scrollHeight: 3000, areas: [], items: [], truncated: false };
const cell = (key: string, fg: number[], bg: number[] = [255, 255, 255, 255], ground: number[] = [255, 255, 255, 255]): BoardProbePair => ({ key, fg, bg, ground });

describe('the passes a run draws', () => {
  test('both light widths, then the dark pass at the wide width, last', () => {
    assert.deepEqual(BOARD_PASSES.map((pass) => [pass.id, pass.width, pass.scheme]), [['wide', 1526, 'light'], ['narrow', 1046, 'light'], ['wide-dark', 1526, 'dark']]);
  });

  test('dark values on: three passes by default and with both; light drops the dark pass; dark draws only it', () => {
    assert.deepEqual(boardPassesOf(null, true).map((pass) => pass.id), ['wide', 'narrow', 'wide-dark']);
    assert.deepEqual(boardPassesOf('both', true).map((pass) => pass.id), ['wide', 'narrow', 'wide-dark']);
    assert.deepEqual(boardPassesOf('light', true).map((pass) => pass.id), ['wide', 'narrow']);
    assert.deepEqual(boardPassesOf('dark', true).map((pass) => pass.id), ['wide-dark']);
  });

  test('no dark values: no dark pass unless asked for by name', () => {
    assert.deepEqual(boardPassesOf(null, false).map((pass) => pass.id), ['wide', 'narrow']);
    assert.deepEqual(boardPassesOf('both', false).map((pass) => pass.id), ['wide', 'narrow']);
    assert.deepEqual(boardPassesOf('dark', false).map((pass) => pass.id), ['wide-dark']);
  });

  test('budget shares: half each for two widths, 0.4 / 0.3 / 0.3 with the dark pass, all of it alone', () => {
    const three = boardPassesOf(null, true);
    assert.deepEqual(three.map((pass) => passShare(three, pass)), [0.4, 0.3, 0.3]);
    const two = boardPassesOf('light', true);
    assert.deepEqual(two.map((pass) => passShare(two, pass)), [0.5, 0.5]);
    const one = boardPassesOf('dark', true);
    assert.deepEqual(one.map((pass) => passShare(one, pass)), [1]);
  });
});

describe('the probe boundary: pair cells', () => {
  test('good cells are kept; out-of-range, fractional or short colours and bad keys are dropped', () => {
    const probe = sanitizeBoardProbe({
      ...PROBE,
      pairs: [
        cell('0-light', [1, 2, 3, 255]),
        cell('1-dark', [256, 0, 0, 255]),
        cell('2-light', [-1, 0, 0, 255]),
        cell('3-light', [1.5, 0, 0, 255]),
        cell('4-light', [0, 0, 255]),
        cell('5-dusk', [0, 0, 0, 255]),
        cell('x-light', [0, 0, 0, 255]),
        { key: '6-light', fg: [0, 0, 0, 255], bg: 'red', ground: [0, 0, 0, 255] },
        'junk',
      ],
    });
    assert.deepEqual(probe?.pairs, [cell('0-light', [1, 2, 3, 255])]);
  });

  test('a list longer than the board can write is refused whole; at the cap it is read', () => {
    const many = (n: number) => Array.from({ length: n }, (_, k) => cell(`${k % 60}-light`, [0, 0, 0, 255]));
    assert.equal(BOARD_PAIR_CELLS_MAX, 120);
    assert.deepEqual(sanitizeBoardProbe({ ...PROBE, pairs: many(121) })?.pairs, []);
    assert.equal(sanitizeBoardProbe({ ...PROBE, pairs: many(120) })?.pairs?.length, 120);
  });

  test('an older probe without pairs, or pairs of the wrong type, reads as none; the layout part is unchanged', () => {
    assert.deepEqual(sanitizeBoardProbe(PROBE)?.pairs, []);
    assert.deepEqual(sanitizeBoardProbe({ ...PROBE, pairs: { 0: 1 } })?.pairs, []);
    assert.equal(sanitizeBoardProbe({ ...PROBE, pairs: 'x' })?.scrollHeight, 3000);
  });
});

describe('measured pair verdicts', () => {
  // --soft is oklch: Node can't read it, so only the measured path can judge it.
  const css = ':root {\n  --bg: #ffffff;\n  --soft: oklch(0.75 0 0);\n  --ink: #767676;\n  --faint: #777777;\n}\n';
  const detail = detailOf(css, { pairs: [{ fg: '--soft', bg: '--bg' }, { fg: '--ink', bg: '--bg' }, { fg: '--faint', bg: '--bg' }] });
  const judged = staticLowPairs(detail).judged;

  test('the static pass judges the hex pairs and leaves oklch to the browser', () => {
    assert.deepEqual([...judged].sort(), ['1-light', '2-light']);
    assert.deepEqual(staticLowPairs(detail).low.map((one) => one.pair.fg), ['--faint']);
  });

  test('an oklch pair under 4.5 is found by the measured path; the hex pair is not judged again (reported once)', () => {
    // oklch(0.75 0 0) paints about #adadad: 2.24:1 on white. #777777 measured would be 4.48 but it was judged statically.
    // The hex cells read back far lighter than their values (as a forged or odd paint would): still not judged again.
    const findings = measuredPairFindings([cell('0-light', [173, 173, 173, 255]), cell('1-light', [220, 220, 220, 255]), cell('2-light', [220, 220, 220, 255])], detail, judged);
    assert.deepEqual(findings.map((finding) => [finding.code, finding.params, finding.detail]), [['system-contrast-low', { count: 1, scheme: 'light' }, '--soft on --bg 2.24:1 (light)']]);
  });

  test('the same cell from a later pass counts once; a cell for a pair that is gone is ignored', () => {
    const findings = measuredPairFindings([cell('0-light', [173, 173, 173, 255]), cell('0-light', [173, 173, 173, 255]), cell('9-light', [200, 200, 200, 255])], detail, judged);
    assert.equal(findings[0]?.params?.count, 1);
  });

  test('the tolerance: 0.05 under the level is still a pass (canvas rounding), more is a finding', () => {
    // #787878 is 4.42:1 on white (more than 0.05 under); #777777 is 4.478:1 (within it).
    const one = detailOf(':root {\n  --bg: oklch(1 0 0);\n  --ink: oklch(0.5 0 0);\n}\n', { pairs: [{ fg: '--ink', bg: '--bg' }] });
    const none = staticLowPairs(one).judged;
    assert.equal(measuredPairFindings([cell('0-light', [119, 119, 119, 255])], one, none).length, 0);
    assert.equal(measuredPairFindings([cell('0-light', [120, 120, 120, 255])], one, none).length, 1);
  });

  test('a see-through background is composited over its ground, as painted; the dark scheme is its own finding', () => {
    const one = detailOf(':root {\n  --bg: oklch(1 0 0);\n  --ink: oklch(0.5 0 0);\n}\n', { pairs: [{ fg: '--ink', bg: '--bg' }] });
    const findings = measuredPairFindings([cell('0-dark', [60, 60, 60, 255], [255, 255, 255, 0], [24, 24, 27, 255])], one, new Set());
    assert.deepEqual(findings.map((finding) => finding.params), [{ count: 1, scheme: 'dark' }]);
    assert.equal(findingMessage(findings[0] as CheckFindingData), '1 colour pair is under its contrast level on the dark scheme.');
  });
});

describe('the dark pass beside the light ones', () => {
  test('a layout finding the light wide pass made is not repeated by the dark pass; one only the dark pass made stays', () => {
    const at = (viewport: string, code: CheckFindingData['code'], detail?: string): CheckFindingData => ({ code, file: 'board.html', screen: null, viewport, ...(detail === undefined ? {} : { detail }) });
    const kept = dedupeBoardFindings([
      at('wide', 'system-board-preview-wide', 'component:table'),
      at('wide-dark', 'system-board-preview-wide', 'component:table'),
      at('wide', 'system-board-overflow'),
      at('wide-dark', 'system-board-overflow'),
      at('narrow', 'system-board-overflow'),
      at('wide-dark', 'system-board-text-outside', 'component:badge'),
    ]);
    assert.deepEqual(kept.map((finding) => `${finding.viewport} ${finding.code} ${finding.detail ?? ''}`.trim()), [
      'wide system-board-preview-wide component:table',
      'wide system-board-overflow',
      'narrow system-board-overflow',
      'wide-dark system-board-text-outside component:badge',
    ]);
  });
});

describe('--area', () => {
  const probe: BoardProbe = {
    ...PROBE,
    areas: [
      { area: 'foundations', top: 0, height: 1000 },
      { area: 'components', top: 1000, height: 1000 },
    ],
    items: [],
  };
  const finding = (code: CheckFindingData['code'], detail?: string): CheckFindingData => ({ code, file: 'board.html', screen: null, viewport: 'wide', ...(detail === undefined ? {} : { detail }) });

  test('an entry finding is kept only for an entry inside the area; board-level ones always', () => {
    const withItems = {
      ...probe,
      items: [
        { entry: 'token:--brand', widened: false, box: { x: 0, y: 200, w: 100, h: 40 }, previews: [], textOut: 0 },
        { entry: 'component:table', widened: false, box: { x: 0, y: 1200, w: 100, h: 40 }, previews: [], textOut: 0 },
      ],
    };
    const all = [finding('system-board-text-outside', 'token:--brand'), finding('system-board-preview-wide', 'component:table'), finding('system-board-overflow')];
    assert.deepEqual(findingsInArea(all, withItems, 'components').map((one) => one.detail ?? one.code), ['component:table', 'system-board-overflow']);
    assert.deepEqual(findingsInArea(all, withItems, 'foundations').map((one) => one.detail ?? one.code), ['token:--brand', 'system-board-overflow']);
    assert.deepEqual(findingsInArea(all, withItems, 'brand').map((one) => one.detail ?? one.code), ['system-board-overflow']);
  });
});

describe('the flags', () => {
  test('--area and --scheme take their closed values with --system', () => {
    assert.deepEqual(parseArgs(['check', '--system', 'acme', '--area', 'components', '--scheme=dark']), { kind: 'check-system', root: null, system: 'acme', staticOnly: false, json: false, area: 'components', scheme: 'dark' });
    for (const area of ['foundations', 'components', 'patterns', 'brand']) assert.equal((parseArgs(['check', '--system', 'acme', `--area=${area}`]) as { area?: string }).area, area);
    for (const scheme of ['light', 'dark', 'both']) assert.equal((parseArgs(['check', '--system', 'acme', '--scheme', scheme]) as { scheme?: string }).scheme, scheme);
  });

  test('a bad value, a repeat, a missing value or use without --system is an error (the CLI exits 2)', () => {
    for (const args of [
      ['check', '--system', 'acme', '--area', 'colours'],
      ['check', '--system', 'acme', '--area'],
      ['check', '--system', 'acme', '--area=Components'],
      ['check', '--system', 'acme', '--area', 'brand', '--area', 'patterns'],
      ['check', '--system', 'acme', '--scheme', 'dim'],
      ['check', '--system', 'acme', '--scheme', '../x'],
      ['check', 'demo', '--area', 'components'],
      ['check', 'demo', '--scheme', 'dark'],
    ]) {
      assert.equal(parseArgs(args).kind, 'error', args.join(' '));
    }
  });

  test('the tool takes area and scheme for a system only, as closed enums, and passes them to the CLI', () => {
    assert.deepEqual(TOOL_INPUT.properties.area.enum, ['foundations', 'components', 'patterns', 'brand']);
    assert.deepEqual(TOOL_INPUT.properties.scheme.enum, ['light', 'dark', 'both']);
    const parsed = parseToolInput({ system: 'acme', area: 'patterns', scheme: 'light' });
    assert.deepEqual(parsed, { ok: true, system: 'acme', static: false, area: 'patterns', scheme: 'light' });
    assert.ok(parsed.ok);
    assert.deepEqual(buildChildArgs('/dc.mjs', parsed), ['/dc.mjs', 'check', '--system', 'acme', '--area', 'patterns', '--scheme', 'light']);
    assert.deepEqual(parseToolInput({ system: 'acme' }), { ok: true, system: 'acme', static: false });
    for (const input of [{ system: 'acme', area: 'colours' }, { system: 'acme', area: '--static' }, { system: 'acme', scheme: 'dim' }, { system: 'acme', scheme: ['dark'] }, { design: 'demo', area: 'components' }, { design: 'demo', scheme: 'dark' }]) {
      assert.equal(parseToolInput(input).ok, false, JSON.stringify(input));
    }
  });
});

describe('a run with dark values, without a browser in the loop', () => {
  const darkSystem = async (t: Parameters<typeof useTmpRoot>[0]) => {
    const tmp = await useTmpRoot(t);
    await tmp.write('_systems/acme/.chamber/state.json', { v: 1, id: 'acme', name: 'Acme', status: 'draft' });
    await tmp.write('_systems/acme/tokens.css', ':root {\n  --bg: #ffffff;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --bg: #111111; }\n}\n');
    await tmp.write('_systems/acme/system.json', JSON.stringify({ tokens: { '--bg': { group: 'surface' } } }));
    return tmp;
  };

  test('the dark pass is planned last with its own document; a budget cut skips it, says so, and keeps the light results', async (t) => {
    const tmp = await darkSystem(t);
    const seen: { plan: { file: string; viewport: string; scheme?: string }[]; documents: Record<string, string> } = { plan: [], documents: {} };
    const store = cliSystemStore(tmp.root, { version: 1 });
    try {
      const { report } = await runSystemCheck(store, 'acme', {
        now: new Date(NOW),
        tool: 'cli',
        render: {
          browserPath: '/no/browser/needed',
          probeSource: '',
          platform: process.platform,
          isRoot: false,
          renderLoop: async (deps) => {
            seen.plan = deps.plan.map((art) => ({ file: art.file, viewport: art.viewport.id, ...(art.scheme !== undefined ? { scheme: art.scheme } : {}) }));
            for (const art of deps.plan) {
              const loaded = await deps.loadDocument(art.file);
              if (loaded.ok) seen.documents[art.file] = loaded.html;
            }
            const ok = (viewport: string, width: number) => ({ screen: null, viewport, width, height: 900, docHeight: 2000, pngs: [], ok: true, ms: 1 });
            return { artboards: [ok('wide', 1526), ok('narrow', 1046)], findings: [], notRendered: 1, stoppedBy: 'budget', unavailable: false };
          },
        },
      });
      assert.deepEqual(seen.plan, [
        { file: 'board.html', viewport: 'wide' },
        { file: 'board.html', viewport: 'narrow' },
        { file: 'board-dark.html', viewport: 'wide-dark', scheme: 'dark' },
      ]);
      assert.match(seen.documents['board.html'] ?? '', /:root \{ color-scheme: light; \}/);
      assert.match(seen.documents['board-dark.html'] ?? '', /:root \{ color-scheme: dark; \}/);
      const render = report.render;
      assert.ok(render !== null);
      assert.equal(render.state, 'partial');
      assert.deepEqual(render.widths.map((width) => width.viewport), ['wide', 'narrow']);
      assert.deepEqual(render.schemes, ['light', 'dark']);
      const skipped = render.findings.filter((finding) => finding.code === 'render-skipped');
      assert.deepEqual(skipped.map((finding) => [finding.params, finding.detail]), [[{ count: 1, reason: 'budget' }, 'Wide board, dark']]);
      assert.equal(findingMessage(skipped[0] as CheckFindingData), '1 board pass was not drawn (the check ran out of time). Check again with --area <area> or --scheme dark.');
    } finally {
      await store.dispose();
    }
  });

  test('--scheme light plans the two light passes only; --area is recorded', async (t) => {
    const tmp = await darkSystem(t);
    let plan: string[] = [];
    const store = cliSystemStore(tmp.root, { version: 1 });
    try {
      const { report } = await runSystemCheck(store, 'acme', {
        now: new Date(NOW),
        tool: 'cli',
        render: {
          browserPath: '/no/browser/needed',
          probeSource: '',
          platform: process.platform,
          isRoot: false,
          scheme: 'light',
          area: 'components',
          renderLoop: async (deps) => {
            plan = deps.plan.map((art) => art.viewport.id);
            return { artboards: [], findings: [], notRendered: 0, stoppedBy: null, unavailable: false };
          },
        },
      });
      assert.deepEqual(plan, ['wide', 'narrow']);
      assert.deepEqual(report.render?.areas, ['components']);
      assert.deepEqual(report.render?.schemes, ['light']);
    } finally {
      await store.dispose();
    }
  });
});
