// What the rail and the page report as "open" (use-the-project spec §2.4): the picture of the wall the
// service gets (model/view-report-model.ts), and the quiet failure of a report. The timing and the body
// caps are guest/view-report.ts's tests; the wiring is checked in the visual harness (scenarios/view-report.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { viewBodyOf } from '../../src/guest/view-report.ts';
import { quietSender, viewStateOf, type WallViewFacts } from '../../src/ui/model/view-report-model.ts';

const anchor = (selector: string, text: string) => ({ selector, text, html: '<h1 class="secret">', rect: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 0.5, y: 0.5 } });

const canvas = (over: Partial<WallViewFacts> = {}): WallViewFacts => ({
  slug: 'coffee-subscription',
  isPage: false,
  mode: 'edit',
  pageView: 'fill',
  screenIds: ['home', 'pricing'],
  viewportIds: ['laptop', 'phone'],
  focus: null,
  selection: null,
  ...over,
});

const page = (over: Partial<WallViewFacts> = {}): WallViewFacts => canvas({ isPage: true, screenIds: [], viewportIds: ['laptop'], mode: 'play', ...over });

test('a canvas with nothing focused reports the design and its mode, no screen', () => {
  assert.deepEqual(viewStateOf(canvas()), { slug: 'coffee-subscription', screen: null, viewport: null, mode: 'edit', selection: null });
});

test('a canvas with one screen reports that screen', () => {
  assert.equal(viewStateOf(canvas({ screenIds: ['home'] })).screen, 'home');
  assert.equal(viewStateOf(canvas({ screenIds: ['home'] })).viewport, null);
});

test('the focused artboard is the screen and viewport in view', () => {
  const state = viewStateOf(canvas({ focus: { screen: 'pricing', viewport: 'phone' } }));
  assert.equal(state.screen, 'pricing');
  assert.equal(state.viewport, 'phone');
});

test('a selected element names its own screen and viewport, over the focus', () => {
  const state = viewStateOf(canvas({ focus: { screen: 'home', viewport: 'laptop' }, selection: { screen: 'pricing', viewport: 'phone', anchor: anchor('main > h1', 'Pick a plan') } }));
  assert.deepEqual(state, { slug: 'coffee-subscription', screen: 'pricing', viewport: 'phone', mode: 'edit', selection: { selector: 'main > h1', text: 'Pick a plan' } });
});

test('only the selector and the text of the element leave the panel', () => {
  const state = viewStateOf(canvas({ selection: { screen: 'home', viewport: 'laptop', anchor: anchor('main > h1', 'Pick a plan') } }));
  assert.deepEqual(Object.keys(state.selection ?? {}).sort(), ['selector', 'text']);
  assert.ok(!JSON.stringify(viewBodyOf('page', state)).includes('secret'), 'the opening tag is not in the body');
});

test('a screen the agent removed is never reported, so the service never refuses the report', () => {
  assert.equal(viewStateOf(canvas({ focus: { screen: 'gone', viewport: 'phone' } })).screen, null);
  assert.equal(viewStateOf(canvas({ focus: { screen: 'home', viewport: 'tablet' } })).viewport, null, 'nor a viewport it removed');
  const selected = viewStateOf(canvas({ selection: { screen: 'gone', viewport: 'phone', anchor: anchor('p', 'x') } }));
  assert.equal(selected.selection, null);
  assert.equal(selected.screen, null);
});

test('Play mode has no selection', () => {
  const state = viewStateOf(canvas({ mode: 'play', selection: { screen: 'home', viewport: 'laptop', anchor: anchor('p', 'x') } }));
  assert.equal(state.mode, 'play');
  assert.equal(state.selection, null);
});

test('a page reports its view (Full width or a device size) and no screen', () => {
  assert.deepEqual(viewStateOf(page()), { slug: 'coffee-subscription', screen: null, viewport: 'fill', mode: 'play', selection: null });
  assert.equal(viewStateOf(page({ pageView: 'laptop' })).viewport, 'laptop');
});

test('a page view the design no longer has falls back to Full width', () => {
  assert.equal(viewStateOf(page({ pageView: 'tablet' })).viewport, 'fill');
});

test('a page selection has no screen to check and goes through', () => {
  const state = viewStateOf(page({ mode: 'edit', selection: { screen: null, viewport: 'laptop', anchor: anchor('h1', 'Hello') } }));
  assert.deepEqual(state.selection, { selector: 'h1', text: 'Hello' });
  assert.equal(state.screen, null);
});

test('quietSender: a failing report is logged once, resolves, and the next one is still tried', async () => {
  const sent: number[] = [];
  const warnings: string[] = [];
  const send = quietSender(
    (body: number) => {
      sent.push(body);
      return Promise.reject(new Error('Design Chamber is not running'));
    },
    (message) => warnings.push(message),
  );
  await send(1);
  await send(2);
  await send(3);
  assert.deepEqual(sent, [1, 2, 3]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /not running/);
});

test('quietSender: a report that works logs nothing', async () => {
  const warnings: string[] = [];
  await quietSender(() => Promise.resolve({ ok: true }), (message) => warnings.push(message))(1);
  assert.deepEqual(warnings, []);
});
