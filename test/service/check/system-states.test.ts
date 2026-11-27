// Forced state pictures (system-builder-depth T16) without a browser: the verdict on computed styles, the
// probe's boundary, the findings and their sentences, the pass over a fake InspectPage (cleared before the
// next element, tight clips, the 60 cap and the deadline), the board hook's gating (wide light pass only,
// components only), forceState and computedStyle over a fake CDP session, and the text the agent reads.

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { sanitizeStateProbe, stateFindings, stateStyled, type BoardStateProbe, type BoardStateTarget } from '../../../src/service/check/board-analyze.ts';
import type { CdpEvent, CdpSession } from '../../../src/service/check/cdp.ts';
import { CdpError } from '../../../src/service/check/cdp.ts';
import { CHECK_CSP, renderArtboards, STATE_STYLE_PROPERTIES, type ElementPath, type InspectPage, type PlannedArtboard } from '../../../src/service/check/render.ts';
import { formatSystemCheckText } from '../../../src/service/check/report-text.ts';
import { cliSystemStore, pictureStates, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { systemCheckReport } from '../../../src/service/check/system-static.ts';
import { findingMessage, parseFindingData } from '../../../src/shared/checks.ts';
import { SYSTEM_STATE_SHOTS_MAX } from '../../../src/shared/limits.ts';
import type { ArtboardCheck } from '../../../src/shared/types.ts';
import { pngOfSize } from '../systems/fake-cdp.ts';
import { CAPTION_BAND, decodePng, encodePng, SIDE_BY_SIDE_GAP } from '../../../src/service/check/png-stitch.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const REST: Record<string, string> = {
  color: 'rgb(17, 17, 17)',
  'background-color': 'rgb(238, 238, 238)',
  'background-image': 'none',
  'border-top-color': 'rgb(136, 136, 136)',
  'border-right-color': 'rgb(136, 136, 136)',
  'border-bottom-color': 'rgb(136, 136, 136)',
  'border-left-color': 'rgb(136, 136, 136)',
  'border-top-style': 'solid',
  'border-top-width': '1px',
  'box-shadow': 'none',
  'outline-color': 'rgb(17, 17, 17)',
  'outline-style': 'none',
  'outline-width': '3px',
  'outline-offset': '0px',
  transform: 'none',
};

// ---- the verdict ----

test('a state is styled when anything a person would see changes, and not when only an unpainted outline or border does', () => {
  assert.equal(stateStyled(REST, REST), false, 'nothing changed');
  assert.equal(stateStyled(REST, { ...REST, 'background-color': 'rgb(51, 51, 51)' }), true, 'a :hover background');
  assert.equal(stateStyled(REST, { ...REST, color: 'rgb(204, 0, 0)' }), true, 'a :focus-visible colour change alone counts');
  assert.equal(stateStyled(REST, { ...REST, 'box-shadow': 'rgb(0, 0, 255) 0px 0px 0px 3px' }), true, 'a ring drawn with box-shadow');
  assert.equal(stateStyled(REST, { ...REST, transform: 'matrix(1, 0, 0, 1, 0, -2)' }), true, 'a lift');
  assert.equal(stateStyled(REST, { ...REST, 'outline-style': 'solid' }), true, 'an outline that appears');
  // Outline colour follows currentColor even with no outline: invisible, so it doesn't count.
  assert.equal(stateStyled(REST, { ...REST, 'outline-color': 'rgb(204, 0, 0)', 'outline-offset': '2px' }), false, 'an unpainted outline');
  assert.equal(stateStyled(REST, { ...REST, 'outline-style': 'solid', 'outline-width': '0px' }), false, 'a zero-width outline');
  const borderless = { ...REST, 'border-top-style': 'none' };
  assert.equal(stateStyled(borderless, { ...borderless, 'border-top-color': 'rgb(204, 0, 0)' }), false, 'an unpainted border');
  assert.equal(stateStyled(REST, { ...REST, 'border-top-color': 'rgb(204, 0, 0)' }), true, 'a painted border colour');
});

// ---- the boundary ----

const target = (over: Partial<BoardStateTarget> = {}): BoardStateTarget => ({ entry: 'component:button', state: 'hover', host: 0, element: 1, twin: false, variant: '', box: { x: 100, y: 2000, w: 80, h: 32 }, ...over });

test('the probe state list is checked: component entries, the closed states, integer indexes, a finite box; a forged long list is refused', () => {
  const clean = sanitizeStateProbe(
    {
      states: [
        target(),
        { ...target(), entry: 'pattern:nav' },
        { ...target(), entry: 'component:Bad Key' },
        { ...target(), state: 'visited' },
        { ...target(), host: -1 },
        { ...target(), element: 1.5 },
        { ...target(), box: { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 1 } },
        { ...target(), state: 'focus-visible', twin: 'yes' },
      ],
      truncated: true,
    },
    SYSTEM_STATE_SHOTS_MAX,
  );
  assert.deepEqual(clean.states, [target(), target({ state: 'focus-visible', twin: false })]);
  assert.equal(clean.truncated, true);
  assert.deepEqual(sanitizeStateProbe({ states: Array.from({ length: SYSTEM_STATE_SHOTS_MAX + 1 }, () => target()) }, SYSTEM_STATE_SHOTS_MAX), { states: [], truncated: false });
  assert.deepEqual(sanitizeStateProbe(null, SYSTEM_STATE_SHOTS_MAX), { states: [], truncated: false });
  assert.deepEqual(sanitizeStateProbe({ states: 'x' }, SYSTEM_STATE_SHOTS_MAX), { states: [], truncated: false });
});

// ---- findings and sentences ----

test('one system-state-unstyled per component, naming the component and its unstyled states; the sentences read plainly', () => {
  const findings = stateFindings(
    [
      { entry: 'component:button', state: 'hover', png: 'a.png', styled: false },
      { entry: 'component:button', state: 'focus-visible', png: 'b.png', styled: false },
      { entry: 'component:button', state: 'active', png: 'c.png', styled: true },
      { entry: 'component:chip', state: 'hover', png: null, styled: false },
      { entry: 'component:tab', state: 'hover', png: 'd.png', styled: true },
    ],
    'wide',
  );
  assert.deepEqual(findings, [
    { code: 'system-state-unstyled', file: 'components/button.html', screen: null, viewport: 'wide', params: { count: 2 }, detail: 'button: hover, focus-visible' },
    { code: 'system-state-unstyled', file: 'components/chip.html', screen: null, viewport: 'wide', params: { count: 1 }, detail: 'chip: hover' },
  ]);
  assert.equal(findingMessage(findings[1] ?? findings[0] ?? assert.fail()), "The example labels a state its CSS doesn't style: forced on the element, it changes nothing you can see. Style it, or remove the label.");
  assert.match(findingMessage(findings[0] ?? assert.fail()), /labels 2 states its CSS doesn't style/);
  for (const finding of findings) assert.ok(!findingMessage(finding).includes('—'), 'no em dash');

  // The partial note for states survives the report parser and reads by count.
  const partial = parseFindingData({ code: 'system-board-partial', file: 'board.html', screen: null, viewport: 'wide', params: { pictured: 'states', count: 60, max: 60 } });
  assert.equal(partial?.params?.pictured, 'states');
  assert.match(findingMessage(partial ?? assert.fail()), /Only the first 60 labelled states were forced and pictured; the others were not checked\./);
  assert.match(findingMessage({ ...(partial ?? assert.fail()), params: { pictured: 'states', count: 0, max: 60 } }), /ran out of time/);
});

// ---- the pass over a fake InspectPage ----

type Call = { method: string; path?: string; states?: readonly string[]; clip?: object; label?: string };

const keyOf = (path: ElementPath): string => path.map((step) => `${step.selector}#${step.index}`).join(' > ');

/** A page whose forced styles come from `styled` (element index → the style while forced); `gone` elements are not found. */
const fakeStatePage = (calls: Call[], options: { styled?: Set<number>; gone?: Set<number>; failCapture?: number } = {}) => {
  const forced = new Map<string, readonly string[]>();
  let captures = 0;
  return {
    computedStyle: async (path: ElementPath) => {
      calls.push({ method: 'computedStyle', path: keyOf(path) });
      const element = path[1]?.index ?? -1;
      if (options.gone?.has(element)) return null;
      const on = (forced.get(keyOf(path)) ?? []).length > 0;
      return on && options.styled?.has(element) ? { ...REST, 'background-color': 'rgb(51, 51, 51)' } : { ...REST };
    },
    forceState: async (path: ElementPath, states: readonly string[]) => {
      calls.push({ method: 'forceState', path: keyOf(path), states });
      if (options.gone?.has(path[1]?.index ?? -1)) return false;
      forced.set(keyOf(path), states);
      return true;
    },
    scrollTo: async () => undefined,
    capture: async (clip: { y: number; height: number; x?: number; width?: number }) => {
      calls.push({ method: 'capture', clip });
      captures += 1;
      if (options.failCapture === captures) throw new CdpError('Page.captureScreenshot', 'broken');
      return pngOfSize(clip.width ?? 1526, clip.height);
    },
    save: async (label: string) => {
      calls.push({ method: 'save', label });
      return `.chamber/check/r-test/${label}@wide.png`;
    },
    forced,
  };
};

test('each state is forced, read, pictured tight and cleared before the next element; the unstyled one is named', async () => {
  const calls: Call[] = [];
  const page = fakeStatePage(calls, { styled: new Set([1]) });
  const probe: BoardStateProbe = { states: [target({ element: 1 }), target({ entry: 'component:chip', host: 1, element: 4, box: { x: 5, y: 300, w: 60, h: 24 } })], truncated: false };
  const pass = await pictureStates(page, probe, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY });

  assert.deepEqual(pass.results, [
    { entry: 'component:button', state: 'hover', png: '.chamber/check/r-test/button-hover@wide.png', styled: true },
    { entry: 'component:chip', state: 'hover', png: '.chamber/check/r-test/chip-hover@wide.png', styled: false, hint: 'rest' },
  ]);
  assert.deepEqual(pass.pngs, ['.chamber/check/r-test/button-hover@wide.png', '.chamber/check/r-test/chip-hover@wide.png']);
  assert.deepEqual(pass.findings.map((finding) => [finding.code, finding.detail]), [['system-state-unstyled', 'chip: hover (no resting copy beside it to force the state on)']]);
  // The element path: the host among the example hosts, then the element in its shadow root.
  assert.equal(calls[0]?.path, '[data-dc-example-host]#0 > *#1');
  // The order for each element: style off, force, style on, picture, clear; then the next element.
  assert.deepEqual(
    calls.map((call) => call.method + (call.states === undefined ? '' : `[${call.states.join(',')}]`)),
    ['computedStyle', 'capture', 'forceState[hover]', 'computedStyle', 'capture', 'save', 'forceState[]', 'computedStyle', 'capture', 'forceState[hover]', 'computedStyle', 'capture', 'save', 'forceState[]'],
  );
  assert.ok([...page.forced.values()].every((states) => states.length === 0), 'nothing is left forced');
  // Tight clips with a 16px margin, kept inside the board's width and the page's top.
  assert.deepEqual(calls.filter((call) => call.method === 'capture').map((call) => call.clip), [
    { x: 84, y: 1984, width: 112, height: 64 },
    { x: 84, y: 1984, width: 112, height: 64 },
    { x: 0, y: 284, width: 81, height: 56 },
    { x: 0, y: 284, width: 81, height: 56 },
  ]);
});

test('an element gone since the probe is skipped; a failed picture still clears the state', async () => {
  const calls: Call[] = [];
  const pass = await pictureStates(fakeStatePage(calls, { gone: new Set([1]) }), { states: [target({ element: 1 })], truncated: false }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY });
  assert.deepEqual(pass, { results: [], pngs: [], findings: [] });
  assert.deepEqual(calls.map((call) => call.method), ['computedStyle'], 'never forced');

  const failing: Call[] = [];
  // The forced picture fails (the second capture): the state is still cleared.
  const page = fakeStatePage(failing, { failCapture: 2 });
  await assert.rejects(pictureStates(page, { states: [target()], truncated: false }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY }), CdpError);
  assert.deepEqual(failing.at(-1), { method: 'forceState', path: '[data-dc-example-host]#0 > *#1', states: [] });
});

test('past the cap or the deadline the rest are left out, with one system-board-partial note', async () => {
  const truncated = await pictureStates(fakeStatePage([]), { states: [target()], truncated: true }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY });
  assert.equal(truncated.results.length, 1);
  assert.deepEqual(truncated.findings.filter((finding) => finding.code === 'system-board-partial'), [
    { code: 'system-board-partial', file: 'board.html', screen: null, viewport: 'wide', params: { pictured: 'states', count: 1, max: SYSTEM_STATE_SHOTS_MAX } },
  ]);

  let now = 0;
  const late = await pictureStates(fakeStatePage([]), { states: [target(), target({ element: 2 }), target({ element: 3 })], truncated: false }, { viewportWidth: 1526, deadline: 2, clock: () => now++ });
  assert.equal(late.results.length, 2);
  assert.equal(late.findings.filter((finding) => finding.code === 'system-board-partial').length, 1);

  const all = await pictureStates(fakeStatePage([]), { states: [target()], truncated: false }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY });
  assert.equal(all.findings.filter((finding) => finding.code === 'system-board-partial').length, 0);
});

// ---- the board hook: which passes run it ----

const boardProbeValue = { innerWidth: 1526, scrollWidth: 1526, scrollHeight: 900, areas: [{ area: 'components', top: 0, height: 900 }], items: [], truncated: false, pairs: [] };
const statesProbeValue = { states: [target()], truncated: false };

const hookedSystem = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/tokens.css', ':root {\n  --brand: #0a5;\n  --ink: #111;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --ink: #eee;\n  }\n}\n');
  await tmp.write('_systems/acme/system.json', JSON.stringify({ version: 1, components: [{ id: 'button', name: 'Button', example: 'components/button.html' }] }));
  await tmp.write('_systems/acme/components/button.html', '<button data-dc-state="hover">Save</button>');
  await tmp.write('_systems/acme/OVERVIEW.md', 'Calm.');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready' });
  const store = cliSystemStore(tmp.root, { version: 1 });
  t.after(() => store.dispose());
  return store;
};

/** Runs the real inspect for every planned pass with a fake page, recording which pass asked for the states. */
const runHooked = async (store: Awaited<ReturnType<typeof hookedSystem>>, over: { area?: 'components' | 'patterns' | null; scheme?: 'light' | 'dark' | 'both' | null }) => {
  const asked: string[] = [];
  const result = await runSystemCheck(store, 'acme', {
    now: new Date('2026-11-27T10:00:00.000Z'),
    tool: 'cli',
    render: {
      browserPath: '/never-started',
      probeSource: '',
      platform: process.platform,
      isRoot: false,
      ...over,
      renderLoop: async (deps) => {
        const inspect = deps.inspect;
        assert.ok(inspect !== undefined);
        const artboards: ArtboardCheck[] = [];
        const findings = [];
        for (const art of deps.plan) {
          const page: InspectPage = {
            evaluate: async (expression) => {
              if (expression.includes('collectStates')) {
                asked.push(art.viewport.id);
                assert.match(expression, new RegExp(`collectStates\\(${SYSTEM_STATE_SHOTS_MAX}\\)$`));
                return statesProbeValue;
              }
              return boardProbeValue;
            },
            scrollTo: async () => undefined,
            capture: async (clip) => pngOfSize(clip.width ?? art.viewport.width, clip.height),
            save: (label, part, parts, bytes) => deps.savePng(art, part, parts, bytes, label),
            forceState: async () => true,
            computedStyle: async () => ({ ...REST }),
            animationFrames: async () => null,
          };
          const done = await inspect(page, art);
          assert.ok(done !== null);
          findings.push(...done.findings);
          artboards.push({ screen: null, viewport: art.viewport.id, width: art.viewport.width, height: art.viewport.height, docHeight: 900, pngs: done.pngs, ok: true, ms: 1 });
        }
        return { artboards, findings, notRendered: 0, stoppedBy: null, unavailable: false };
      },
    },
  });
  return { asked, result };
};

test('the state pass runs on the wide light board only: not narrow, not the dark pass, and only for --area components', async (t) => {
  const store = await hookedSystem(t);
  const both = await runHooked(store, { scheme: 'both' });
  assert.deepEqual(both.asked, ['wide']);
  const render = both.result.report.render;
  assert.ok(render !== null);
  assert.deepEqual(render.widths.map((width) => width.viewport), ['wide', 'narrow', 'wide-dark']);
  assert.equal(render.states?.length, 1);
  assert.match(render.states?.[0]?.png ?? '', /button-hover@wide\.png$/);
  assert.equal(render.findings.filter((finding) => finding.code === 'system-state-unstyled').length, 1, 'said once, from the wide pass');
  assert.ok(render.widths.find((width) => width.viewport === 'wide')?.pngs.includes(render.states?.[0]?.png ?? ''), 'the picture is kept with its pass');

  assert.deepEqual((await runHooked(store, { area: 'components' })).asked, ['wide']);
  const patterns = await runHooked(store, { area: 'patterns' });
  assert.deepEqual(patterns.asked, []);
  assert.equal(patterns.result.report.render?.states, undefined);
  assert.deepEqual((await runHooked(store, { scheme: 'dark' })).asked, []);
});

// ---- forceState and computedStyle over CDP ----

type Sent = { method: string; params: Record<string, unknown> };

/** The CDP conversation render.ts holds, plus the DOM and CSS domains: the host is node 10, its shadow root 20, the element 30. */
const domSession = (sent: Sent[]): CdpSession => {
  const listeners = new Map<string, Set<(event: CdpEvent) => void>>();
  const emit = (event: CdpEvent): void => {
    for (const listener of [...(listeners.get(event.method) ?? [])]) listener(event);
  };
  return {
    exited: false,
    on(method, listener) {
      let set = listeners.get(method);
      if (set === undefined) listeners.set(method, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
    onExit: () => () => undefined,
    close: async () => undefined,
    async send<T>(method: string, params: object = {}): Promise<T> {
      const p = params as Record<string, unknown>;
      sent.push({ method, params: p });
      const reply = (value: object): T => value as T;
      switch (method) {
        case 'Target.createTarget':
          return reply({ targetId: 't1' });
        case 'Target.attachToTarget':
          return reply({ sessionId: 's1' });
        case 'Page.navigate':
          setImmediate(() => emit({ method: 'Fetch.requestPaused', sessionId: 's1', params: { requestId: 'r1', request: { url: p.url } } }));
          return reply({ frameId: 'f1' });
        case 'Fetch.fulfillRequest':
          setImmediate(() => emit({ method: 'Page.loadEventFired', sessionId: 's1', params: {} }));
          return reply({});
        case 'Page.createIsolatedWorld':
          return reply({ executionContextId: 7 });
        case 'Runtime.evaluate':
          return reply({ result: { value: true } });
        case 'DOM.getDocument':
          return reply({ root: { nodeId: 1 } });
        case 'DOM.querySelectorAll':
          if (p.nodeId === 1) return reply({ nodeIds: [10, 11] });
          if (p.nodeId === 20) return reply({ nodeIds: [29, 30] });
          throw new CdpError(method, 'Could not find node with given id');
        case 'DOM.describeNode':
          return reply({ node: { shadowRoots: p.nodeId === 10 ? [{ backendNodeId: 200 }] : [] } });
        case 'DOM.pushNodesByBackendIdsToFrontend':
          return reply({ nodeIds: [20] });
        case 'CSS.getComputedStyleForNode':
          return reply({ computedStyle: [{ name: 'color', value: 'rgb(1, 2, 3)' }, { name: 'width', value: '80px' }, { name: 'box-shadow', value: 'x'.repeat(1000) }] });
        default:
          return reply({});
      }
    },
  };
};

test('forceState and computedStyle reach into the shadow root over CDP, send no page script, and leave the page as it was', async () => {
  const sent: Sent[] = [];
  const ART: PlannedArtboard = { file: 'board.html', screen: null, viewport: { id: 'wide', label: 'Wide board', width: 1526, height: 900 } };
  const path: ElementPath = [{ selector: '[data-dc-example-host]', index: 0 }, { selector: '*', index: 1 }];
  const seen: { style: Record<string, string> | null; forced: boolean; cleared: boolean; missing: boolean; noShadow: boolean } = { style: null, forced: false, cleared: false, missing: true, noShadow: true };
  let mark = 0;
  const outcome = await renderArtboards({
    openBrowser: async () => domSession(sent),
    plan: [ART],
    kind: 'page',
    loadDocument: async () => ({ ok: true, html: '<p>board</p>' }),
    probeSource: '',
    knownExternal: new Set(),
    savePng: async () => 'x.png',
    inspect: async (page) => {
      mark = sent.length;
      seen.style = await page.computedStyle(path);
      seen.forced = await page.forceState(path, ['hover']);
      seen.cleared = await page.forceState(path, []);
      seen.missing = await page.forceState([{ selector: '[data-dc-example-host]', index: 5 }, { selector: '*', index: 0 }], ['hover']);
      seen.noShadow = await page.forceState([{ selector: '[data-dc-example-host]', index: 1 }, { selector: '*', index: 0 }], ['hover']);
      return { findings: [], docHeight: 900, pngs: [] };
    },
  });
  assert.equal(outcome.artboards[0]?.ok, true, JSON.stringify(outcome.findings));
  assert.deepEqual(seen.style, { color: 'rgb(1, 2, 3)', 'box-shadow': 'x'.repeat(400) }, 'only the compared properties, clipped');
  assert.equal(seen.forced, true);
  assert.equal(seen.cleared, true);
  assert.equal(seen.missing, false, 'no such host');
  assert.equal(seen.noShadow, false, 'a host with no shadow root');
  assert.ok(STATE_STYLE_PROPERTIES.includes('outline-style'));

  const during = sent.slice(mark);
  const methods = during.map((entry) => entry.method);
  assert.deepEqual(methods.slice(0, 4), ['DOM.enable', 'CSS.enable', 'Animation.enable', 'DOM.getDocument']);
  assert.deepEqual(during.find((entry) => entry.method === 'DOM.getDocument')?.params, { depth: 0, pierce: true });
  assert.deepEqual(during.filter((entry) => entry.method === 'CSS.forcePseudoState').map((entry) => entry.params), [
    { nodeId: 30, forcedPseudoClasses: ['hover'] },
    { nodeId: 30, forcedPseudoClasses: [] },
  ]);
  // Fast animations while forced, back to normal and every domain off before the artboard ends.
  assert.deepEqual(during.filter((entry) => entry.method === 'Animation.setPlaybackRate').map((entry) => entry.params.playbackRate), [1000, 1]);
  assert.deepEqual(methods.slice(-4), ['Animation.setPlaybackRate', 'Animation.disable', 'CSS.disable', 'DOM.disable']);
  // The only evaluations are the frame waits in the isolated world; no page script, no attribute or DOM write.
  for (const entry of during.filter((one) => one.method === 'Runtime.evaluate')) {
    assert.equal(entry.params.contextId, 7);
    assert.match(String(entry.params.expression), /^\(async \(\) => \{ await new Promise\(\(resolve\) => requestAnimationFrame/);
  }
  assert.ok(!methods.some((method) => /^DOM\.(set|remove|move|insert)|^CSS\.(set|add|create)|^Runtime\.(callFunctionOn|compileScript)/.test(method)), methods.join(', '));
  // The served document's CSP is the guest frame's, unchanged.
  const fulfilled = sent.find((entry) => entry.method === 'Fetch.fulfillRequest');
  assert.deepEqual((fulfilled?.params.responseHeaders as { name: string; value: string }[]).find((header) => header.name === 'content-security-policy')?.value, CHECK_CSP);
  assert.match(CHECK_CSP, /^sandbox allow-scripts;/);
  assert.ok(!CHECK_CSP.includes('allow-same-origin'));
});

// ---- the text the agent reads ----

test('the text names the state pictures, marks the ones that change nothing, and puts the picture on the finding', () => {
  const finding = { code: 'system-state-unstyled' as const, file: 'components/chip.html', screen: null, viewport: 'wide', params: { count: 1 }, detail: 'chip: hover' };
  const report = systemCheckReport({
    id: 'acme',
    findings: [],
    now: new Date('2026-11-27T10:00:00.000Z'),
    tool: 'cli',
    render: {
      state: 'done',
      browser: 'chrome',
      drawn: { from: 'system', proposal: null },
      widths: [{ screen: null, viewport: 'wide', width: 1526, height: 900, docHeight: 900, pngs: [], ok: true, ms: 1 }],
      shots: [],
      entryShots: [],
      findings: [finding],
      states: [
        { entry: 'component:button', state: 'hover', png: '.chamber/check/r-1/button-hover@wide.png', styled: true },
        { entry: 'component:chip', state: 'hover', png: '.chamber/check/r-1/chip-hover@wide.png', styled: false },
      ],
    },
  });
  const text = formatSystemCheckText({ report, name: 'Acme', reportPath: '/x/check.json' });
  assert.match(text, /forced on the element, it changes nothing you can see\. Style it, or remove the label\. "chip: hover" Picture: chip-hover@wide\.png\./);
  assert.match(text, /State pictures \(wide board\): each labelled hover, focus or active state, the element at rest on the left and forced on the right:\n {2}button-hover@wide\.png {2}button, hover\n {2}chip-hover@wide\.png {2}chip, hover: changes nothing/);
  assert.ok(!text.includes('—'));
});

// ---- hints: the likely cause of an unstyled state ----

test('an unstyled state says why when the check can tell: no resting copy, or focus styled as :focus-visible only', async () => {
  const forcedNow = new Map<number, readonly string[]>();
  const calls: string[] = [];
  // Element 1: labelled focus, only :focus-visible styled. Element 2: labelled hover, nothing styled, no twin. Element 3: the same with a twin.
  const page = {
    computedStyle: async (path: ElementPath) => {
      const element = path[1]?.index ?? -1;
      const states = forcedNow.get(element) ?? [];
      calls.push(`style ${element} [${states.join(',')}]`);
      return element === 1 && states.includes('focus-visible') ? { ...REST, 'outline-style': 'solid' } : { ...REST };
    },
    forceState: async (path: ElementPath, states: readonly string[]) => {
      forcedNow.set(path[1]?.index ?? -1, states);
      calls.push(`force ${path[1]?.index ?? -1} [${states.join(',')}]`);
      return true;
    },
    scrollTo: async () => undefined,
    capture: async (clip: { width?: number; height: number }) => pngOfSize(clip.width ?? 10, clip.height),
    save: async (label: string) => `${label}@wide.png`,
  };
  const pass = await pictureStates(
    page,
    { states: [target({ state: 'focus', element: 1, twin: true }), target({ entry: 'component:chip', element: 2, twin: false }), target({ entry: 'component:tab', element: 3, twin: true })], truncated: false },
    { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY },
  );
  assert.deepEqual(pass.results.map((result) => [result.entry, result.state, result.styled, result.hint]), [
    ['component:button', 'focus', false, 'focus-visible'],
    ['component:chip', 'hover', false, 'rest'],
    ['component:tab', 'hover', false, undefined],
  ]);
  // The extra :focus-visible try happens after the picture and is cleared too; nothing is left forced.
  assert.deepEqual(calls.slice(0, 7), ['style 1 []', 'force 1 [focus]', 'style 1 [focus]', 'force 1 []', 'force 1 [focus-visible]', 'style 1 [focus-visible]', 'force 1 []']);
  assert.ok([...forcedNow.values()].every((states) => states.length === 0));

  assert.deepEqual(pass.findings.map((finding) => [finding.detail, finding.params]), [
    ['button: focus (labelled focus but its CSS styles :focus-visible)', { count: 1, hint: 'focus-visible' }],
    ['chip: hover (no resting copy beside it to force the state on)', { count: 1, hint: 'rest' }],
    ['tab: hover', { count: 1 }],
  ]);
  const [focus, rest, plain] = pass.findings.map((finding) => findingMessage(finding));
  assert.match(focus ?? '', /It is labelled focus but its CSS styles :focus-visible: label it focus-visible, or style :focus too\.$/);
  assert.match(rest ?? '', /There is no resting copy beside the labelled one to force the state on: add one labelled data-dc-state="rest" with the same variant and size\.$/);
  assert.ok(!/resting copy|:focus-visible:/.test(plain ?? ''), plain);

  // Both causes in one component: both sentences, each state with its own words.
  const both = stateFindings(
    [
      { entry: 'component:button', state: 'focus', png: null, styled: false, hint: 'focus-visible' },
      { entry: 'component:button', state: 'hover', png: null, styled: false, hint: 'rest' },
    ],
    'wide',
  )[0];
  assert.equal(both?.params?.hint, 'both');
  assert.match(findingMessage(both ?? assert.fail()), /no resting copy.*labelled focus/);
  assert.equal(parseFindingData({ ...both, params: { count: 2, hint: 'forged' } })?.params?.hint, undefined, 'a forged hint never reaches a sentence');
});

// ---- the picture: rest beside forced, captioned, named with the variant ----

test('a state picture is the element at rest beside it forced, captioned, and named with the component and variant', async () => {
  const saved: { label: string; bytes: Buffer }[] = [];
  let shot = 0;
  const page = {
    computedStyle: async () => ({ ...REST }),
    forceState: async () => true,
    scrollTo: async () => undefined,
    // The rest picture white, the forced one black, so each side is told apart.
    capture: async (clip: { width?: number; height: number }) => {
      shot += 1;
      const value = shot % 2 === 1 ? 0xff : 0x00;
      return encodePng({ width: clip.width ?? 1, height: clip.height, channels: 3, rows: Array.from({ length: clip.height }, () => Buffer.alloc((clip.width ?? 1) * 3, value)) });
    },
    save: async (label: string, _part: number, _parts: number, bytes: Buffer) => {
      saved.push({ label, bytes });
      return `${label}@wide.png`;
    },
  };
  const pass = await pictureStates(page, { states: [target({ variant: 'primary', twin: true })], truncated: false }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY });
  assert.equal(saved[0]?.label, 'button-primary-hover');
  assert.equal(pass.results[0]?.variant, 'primary');
  const picture = decodePng(saved[0]?.bytes ?? assert.fail());
  assert.equal(picture.width, 112 * 2 + SIDE_BY_SIDE_GAP);
  assert.equal(picture.height, 64 + CAPTION_BAND);
  const at = (x: number, y: number): number => picture.rows[y]?.[x * picture.channels] ?? -1;
  assert.equal(at(50, CAPTION_BAND + 30), 0xff, 'rest on the left');
  assert.equal(at(112 + SIDE_BY_SIDE_GAP + 50, CAPTION_BAND + 30), 0x00, 'forced on the right');
  const ink = (from: number, to: number): number => {
    let n = 0;
    for (let y = 0; y < CAPTION_BAND; y += 1) for (let x = from; x < to; x += 1) if ((picture.rows[y]?.[x * picture.channels] ?? 255) < 0x80) n += 1;
    return n;
  };
  assert.ok(ink(0, 112) > 20 && ink(112 + SIDE_BY_SIDE_GAP, picture.width) > 20, 'both sides captioned');

  // A variant that isn't a plain short name is left out of the name.
  assert.equal(sanitizeStateProbe({ states: [{ ...target(), variant: '../x' }, { ...target(), variant: 'Primary Large' }] }, SYSTEM_STATE_SHOTS_MAX).states.map((one) => one.variant).join('|'), '|primary-large');
});
