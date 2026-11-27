// Motion specimens on the board and living page (documentation/specs/system-builder-depth.md §4.6,
// §13 T10b): durations as bars against the longest, easings as curves built from numbers, a demo that
// moves with the token and never under reduced motion, and no `<svg>` or demo on the living page.
// Also the icon grid's `currentColor` tint: an icon stays an `<img>`, so the tint is a filter.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import { parseMotionValue } from '../../../src/shared/token-edit.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { bundleDocument, type FileSource } from '../../../src/service/bundle.ts';
import { assembleBoardHtml, overlaySource } from '../../../src/service/systems/board-assemble.ts';
import { BOARD_ENTRY_FILE, buildBoardHtml } from '../../../src/service/systems/board-html.ts';
import { buildLivingPage, type LivingPageInput } from '../../../src/service/systems/living-html.ts';
import { livingPagesIdle } from '../../../src/service/systems/living-page.ts';
import { livingCssProblems, scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { easingPath, GROUND_TEXT, MOTION_ALIAS_DEPTH_MAX, paintsOnlyCurrentColor, renderSpecimenSection, resolveMotionValue } from '../../../src/service/systems/specimen-html.ts';
import { chromeOrSkip, testBrowserFlags } from '../../helpers/chrome-or-skip.ts';
import { setupRepo, SYSTEM_JSON } from './repo-fixture.ts';

const NOW = '2026-11-27T10:00:00.000Z';

const TOKENS = `:root {
  --duration-fast: 100ms;
  --duration-base: 200ms;
  --duration-slow: 0.8s;
  --duration-alias: var(--duration-base);
  --ease-out: ease-out;
  --ease-snap: cubic-bezier(0.2, 0, 0, 1);
  --ease-ticks: steps(4, end);
  --ease-broken: bounce;
}
@media (prefers-color-scheme: dark) {
  :root { --duration-slow: 1s; }
}
`;

const detailOf = (tokensCss = TOKENS, json: Record<string, unknown> = {}, files: readonly string[] = []): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify({ tokens: { '--ease-broken': { section: 'motion' } }, ...json }),
    tokensCss,
    texts: {},
    files: files.map((rel) => ({ rel, bytes: 1 })),
    build: null,
  });

const boardMotion = (detail = detailOf()): string => /<section class="dc-section" id="dc-section-motion"[\s\S]*?<\/section>/.exec(buildBoardHtml(detail, { scheme: 'light' }))?.[0] ?? '';

/** One token's card or row. */
const entry = (html: string, name: string): string => {
  const from = html.indexOf(`data-dc-entry="token:${name}"`);
  assert.ok(from > 0, name);
  const next = html.indexOf('data-dc-entry=', from + 10);
  return html.slice(from, next < 0 ? undefined : next);
};

const livingInput = (detail: SystemDetail): LivingPageInput => ({ revision: 1, generatedAt: NOW, coverage: detail.coverage, redact: [] });

const memorySource = (files: Record<string, string>): FileSource => ({
  root: '/memory',
  read: async (rel) => {
    if (!Object.hasOwn(files, rel)) return null;
    const bytes = Buffer.from(files[rel] ?? '', 'utf8');
    return { bytes, size: bytes.length, mtimeMs: 0 };
  },
  stat: async (rel) => (Object.hasOwn(files, rel) ? { size: Buffer.byteLength(files[rel] ?? ''), mtimeMs: 0 } : null),
});

// ---- the numbers ----

test('motion values read into numbers; keywords are their standard curves; anything else is nothing', () => {
  assert.deepEqual(parseMotionValue('200ms'), { kind: 'time', ms: 200 });
  assert.deepEqual(parseMotionValue('0.8s'), { kind: 'time', ms: 800 });
  assert.deepEqual(parseMotionValue('linear'), { kind: 'bezier', points: [0, 0, 1, 1] });
  assert.deepEqual(parseMotionValue('ease'), { kind: 'bezier', points: [0.25, 0.1, 0.25, 1] });
  assert.deepEqual(parseMotionValue('ease-in'), { kind: 'bezier', points: [0.42, 0, 1, 1] });
  assert.deepEqual(parseMotionValue('EASE-OUT'), { kind: 'bezier', points: [0, 0, 0.58, 1] });
  assert.deepEqual(parseMotionValue('ease-in-out'), { kind: 'bezier', points: [0.42, 0, 0.58, 1] });
  assert.deepEqual(parseMotionValue('cubic-bezier(0.2, 0, 0, 1)'), { kind: 'bezier', points: [0.2, 0, 0, 1] });
  assert.deepEqual(parseMotionValue('steps(4)'), { kind: 'steps', count: 4, at: 'end' });
  assert.deepEqual(parseMotionValue('steps(3, start)'), { kind: 'steps', count: 3, at: 'start' });
  for (const bad of ['bounce', '20', 'cubic-bezier(2, 0, 0, 1)', 'steps(101)', '11s', 'var(--duration-base)', 'toString']) assert.equal(parseMotionValue(bad), null, bad);
});

test('curve paths are fixed strings built from the numbers; steps are a staircase', () => {
  const path_ = (text: string): ReturnType<typeof easingPath> => {
    const value = parseMotionValue(text);
    assert.ok(value !== null && value.kind !== 'time', text);
    return easingPath(value);
  };
  assert.deepEqual(path_('ease-out'), { d: 'M0 100C0 100 58 0 100 0', top: 0, bottom: 100 });
  assert.deepEqual(path_('cubic-bezier(0.2, 0, 0, 1)'), { d: 'M0 100C20 100 0 0 100 0', top: 0, bottom: 100 });
  assert.equal(path_('steps(4, end)').d, 'M0 100H25V75H50V50H75V25H100V0');
  assert.equal(path_('steps(2, start)').d, 'M0 100V50H50V0H100');
  // An overshoot makes the box taller; a wild one is cut at the clamp.
  assert.deepEqual(path_('cubic-bezier(0.3, 1.6, 0.6, -0.4)'), { d: 'M0 100C30 -60 60 140 100 0', top: -60, bottom: 140 });
  assert.deepEqual(path_('cubic-bezier(0, 1000, 1, -1000)'), { d: 'M0 100C0 -100 100 200 100 0', top: -100, bottom: 200 });
});

// ---- the board ----

test('a duration is a bar against the longest duration, dark values included', () => {
  const html = boardMotion();
  assert.ok(entry(html, '--duration-fast').includes('class="dc-bar" style="width: 10%"'), entry(html, '--duration-fast'));
  assert.ok(entry(html, '--duration-base').includes('style="width: 20%"'));
  const slow = entry(html, '--duration-slow');
  assert.ok(slow.includes('style="width: 80%"') && slow.includes('style="width: 100%"'), 'the light value against the 1s dark one');
  assert.ok(slow.includes('class="dc-ground dc-dark"'));
  // All zero: no division by nothing.
  assert.ok(boardMotion(detailOf(':root { --duration-none: 0ms; }')).includes('style="width: 0%"'));
});

test('an easing is an inline curve; an invalid one is the hatched box', () => {
  const html = boardMotion();
  const out = entry(html, '--ease-out');
  assert.ok(out.includes('<svg class="dc-curve" xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 108 108" width="108" height="108" role="img" aria-label="Easing curve of --ease-out">'), out);
  assert.ok(out.includes('<path d="M0 100C0 100 58 0 100 0" fill="none" stroke="currentColor"'));
  assert.ok(entry(html, '--ease-snap').includes('d="M0 100C20 100 0 0 100 0"'));
  const broken = entry(html, '--ease-broken');
  assert.ok(broken.includes('dc-hatched') && broken.includes('Can&#39;t read this value'), broken);
  assert.ok(!broken.includes('<svg') && !broken.includes('dc-motion-demo'));
});

// ---- plain aliases ----

const NO_PREVIEW = 'A formula, so there&#39;s no preview.';
const aliasBoard = (css: string, json: Record<string, unknown> = {}): string => boardMotion(detailOf(css, { tokens: {}, ...json }));

test('a plain alias is previewed from what it resolves to: a bar, a curve and the demo, on the board and the living page', () => {
  const css = ':root { --duration-base: 200ms; --duration-slow: 400ms; --ease-curve: cubic-bezier(0.2, 0, 0, 1); --motion-enter: var(--duration-base); --ease-enter: VAR( --ease-curve ); }';
  const html = aliasBoard(css);
  const enter = entry(html, '--motion-enter');
  assert.ok(enter.includes('class="dc-bar" style="width: 50%"') && !enter.includes(NO_PREVIEW), enter);
  // The demo still names the alias, so the browser follows it too.
  assert.ok(enter.includes('class="dc-motion-chip" style="transition-duration: var(--motion-enter)"'));
  const ease = entry(html, '--ease-enter');
  assert.ok(ease.includes('d="M0 100C20 100 0 0 100 0"') && ease.includes('transition-timing-function: var(--ease-enter)'), ease);
  const detail = detailOf(css, { tokens: {} });
  const living = buildLivingPage(detail, livingInput(detail)).html;
  assert.ok(!living.includes(NO_PREVIEW));
  assert.equal(living.split('alt="Easing curve of --ease-enter"').length - 1, 1);
});

test('aliases are followed through four tokens and no further', () => {
  assert.equal(MOTION_ALIAS_DEPTH_MAX, 4);
  const chain = ':root { --duration-1: var(--duration-2); --duration-2: var(--duration-3); --duration-3: var(--duration-4); --duration-4: var(--duration-5); --duration-5: var(--duration-6); --duration-6: 300ms; }';
  const html = aliasBoard(chain);
  assert.ok(entry(html, '--duration-1').includes(NO_PREVIEW), 'five hops');
  assert.ok(entry(html, '--duration-2').includes('style="width: 100%"'), 'four hops');
  assert.ok(!entry(html, '--duration-2').includes(NO_PREVIEW));
});

test('a cycle, a missing or unusable target and anything more than var(--x) stay a formula', () => {
  const html = aliasBoard(`:root {
    --duration-a: var(--duration-b); --duration-b: var(--duration-a); --duration-self: var(--duration-self);
    --duration-gone: var(--duration-nowhere);
    --duration-colour: var(--brand); --brand: #1a73e8;
    --duration-fallback: var(--duration-ok, 100ms);
    --duration-calc: calc(var(--duration-ok) + 1ms);
    --duration-two: var(--duration-ok) var(--duration-ok);
    --duration-dark-only: var(--duration-night);
    --duration-ok: 100ms;
  }
  @media (prefers-color-scheme: dark) { :root { --duration-night: 100ms; } }`);
  for (const name of ['a', 'b', 'self', 'gone', 'colour', 'fallback', 'calc', 'two', 'dark-only']) {
    const card = entry(html, `--duration-${name}`);
    assert.ok(card.includes(NO_PREVIEW) && !card.includes('dc-motion-demo') && !card.includes('dc-bar'), `${name}: ${card}`);
  }
  assert.ok(entry(html, '--duration-ok').includes('style="width: 100%"'));
});

test('on the dark ground every hop takes the dark value, else the light one, as the system CSS does', () => {
  const detail = detailOf(
    `:root { --motion-a: var(--motion-b); --motion-b: var(--motion-c); --motion-c: 100ms; }
     @media (prefers-color-scheme: dark) { :root { --motion-a: var(--motion-b); --motion-c: 400ms; } }`,
    { tokens: {} },
  );
  const a = entry(boardMotion(detail), '--motion-a');
  const [light, dark] = a.split('class="dc-ground dc-dark"');
  assert.ok(light?.includes('width: 25%'), a);
  assert.ok(dark?.includes('width: 100%'), 'b has no dark value, but c does');
  const tokens = new Map(detail.tokens.map((token) => [token.name, token]));
  assert.deepEqual(resolveMotionValue(tokens, '--motion-b', 'var(--motion-c)', 'light'), { kind: 'time', ms: 100 });
  assert.deepEqual(resolveMotionValue(tokens, '--motion-b', 'var(--motion-c)', 'dark'), { kind: 'time', ms: 400 });
});

test('the demo moves with its token: a duration sets the time, an easing the curve; it takes focus', () => {
  const html = boardMotion();
  assert.ok(entry(html, '--duration-fast').includes('<div class="dc-motion-demo" tabindex="0" role="img" aria-label="Demo of --duration-fast"><div class="dc-motion-chip" style="transition-duration: var(--duration-fast)"></div></div>'));
  assert.ok(entry(html, '--ease-snap').includes('class="dc-motion-chip" style="transition-timing-function: var(--ease-snap)"'));
  assert.ok(html.includes('Hover or focus a track to play it. With reduced motion on, it stays still.'));
});

test('the board CSS plays the demo on hover and focus, stops it under reduced motion, and names no host variable', () => {
  const chrome = /<style>([\s\S]*?)<\/style>/.exec(buildBoardHtml(detailOf(), { scheme: 'light' }))?.[1] ?? '';
  assert.match(chrome, /\.dc-motion-demo:hover \.dc-motion-chip, \.dc-motion-demo:focus \.dc-motion-chip \{ left: calc\(100% - 18px\); \}/);
  assert.match(
    chrome,
    /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.dc-motion-chip \{ transition: none !important; \}\n {2}\.dc-motion-demo:hover \.dc-motion-chip, \.dc-motion-demo:focus \.dc-motion-chip \{ left: 2px; \}\n\}/,
  );
  const added = chrome.split('\n').filter((line) => /dc-motion|dc-curve|dc-icon/.test(line));
  assert.ok(added.length >= 8, added.join('\n'));
  for (const line of added) assert.ok(!line.includes('var('), line);
});

test('motion takes the table and compact layouts; without tokens it says so, with no hint', () => {
  const table = boardMotion(detailOf(TOKENS, { layout: { motion: 'table' } }));
  assert.ok(table.includes('role="table" aria-label="Motion"') && table.includes('<svg class="dc-curve"'));
  assert.ok(boardMotion(detailOf(TOKENS, { layout: { motion: 'compact' } })).includes('dc-grid dc-run-compact'));
  const empty = boardMotion(detailOf(':root {}', { tokens: {} }));
  assert.ok(empty.includes('No motion tokens yet.') && !empty.includes('dc-motion'));
});

test('a value that could close the markup never reaches the curve or the CSS', () => {
  const html = boardMotion(detailOf(':root { --ease-x: cubic-bezier(0,0,1,1)"><script>1</script>; --duration-x: 1s"onload="x; }', { tokens: { '--ease-x': { section: 'motion' }, '--duration-x': { section: 'motion' } } }));
  // Both tokens were read, and shown as unreadable.
  assert.ok(entry(html, '--ease-x').includes('dc-hatched'), html);
  assert.ok(html.includes('data-dc-entry="token:--duration-x"'));
  assert.ok(!html.includes('<script>') && !html.includes('onload="'), html);
  assert.ok(!html.includes('<svg') && !html.includes('dc-motion-demo'));
});

// ---- the living page ----

test('the living page has the bars and curves as pictures, no <svg>, no demo, and passes the allowlist', () => {
  const detail = detailOf();
  const { html } = buildLivingPage(detail, livingInput(detail));
  assert.deepEqual(scanLivingPage(html).reasons, []);
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  for (const line of css.split('\n')) assert.deepEqual(livingCssProblems(line), [], line);
  const body = html.slice(html.indexOf('<body>'));
  assert.ok(!/<svg|<script|dc-motion-demo|dc-motion-chip|dc-motion-hint|tabindex/.test(body));
  for (const width of ['10%', '20%', '80%', '100%']) assert.ok(css.includes(`{ width: ${width}; }`), width);
  const pictures = [...body.matchAll(/<img class="dc-curve dc-icon-current" src="data:image\/svg\+xml;base64,([^"]+)" alt="Easing curve of (--[a-z-]+)">/g)];
  assert.deepEqual(pictures.map((match) => match[2]), ['--ease-out', '--ease-snap', '--ease-ticks']);
  const svg = Buffer.from(pictures[0]?.[1] ?? '', 'base64').toString('utf8');
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.includes('d="M0 100C0 100 58 0 100 0"') && svg.includes('stroke="currentColor"'), svg);
});

// ---- currentColor icons ----

const wrap = (inner: string, root = ''): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${root}>${inner}</svg>`;

test('only an icon whose paint is all currentColor is tinted', () => {
  for (const yes of [
    wrap('<path d="M0 0"/>', 'fill="none" stroke="currentColor"'),
    wrap('<path fill="currentColor" fill-rule="evenodd" d="M0 0"/>'),
    wrap('<path style="fill: CurrentColor !important; stroke-width: 2" d="M0 0"/>'),
    wrap("<style>path { fill: currentColor; stroke: none }</style><path data-fill='#f00' d='M0 0'/>"),
    wrap('<!-- fill="#f00" --><path fill="currentColor" d="M0 0"/>'),
  ]) assert.equal(paintsOnlyCurrentColor(yes), true, yes);
  for (const no of [
    wrap('<path d="M0 0"/>'),
    wrap('<circle fill="#d9822b"/><circle fill="currentColor"/>'),
    wrap('<path fill="currentColor" stroke="red"/>'),
    wrap('<path fill="currentColor"/>', 'color="#2456d6"'),
    wrap('<style>circle { fill: #f00 }</style><path fill="currentColor"/>'),
    wrap('<path fill="url(#g)" stroke="currentColor"/>'),
    wrap('<image href="data:image/png;base64,AAAA"/><path fill="currentColor"/>'),
    wrap('<title>currentColor</title><path d="M0 0"/>'),
    wrap('<!-- fill="currentColor" --><path d="M0 0"/>'),
  ]) assert.equal(paintsOnlyCurrentColor(no), false, no);
  const started = Date.now();
  for (const hostile of ['<!--'.repeat(8000), `fill=${' '.repeat(32_000)}`, `fill:${' '.repeat(32_000)}`, 'fill="'.repeat(5000)]) paintsOnlyCurrentColor(hostile);
  assert.ok(Date.now() - started < 2000);
});

const ICONS: Record<string, string> = {
  'assets/icons/mono.svg': wrap('<rect width="24" height="24" fill="currentColor"/>'),
  'assets/icons/colour.svg': wrap('<rect width="24" height="24" fill="#d9822b"/><circle cx="2" cy="2" r="1" fill="currentColor"/>'),
};
const ICON_JSON = { icons: [{ file: 'assets/icons/mono.svg' }, { file: 'assets/icons/colour.svg' }] };
const iconDetail = (): SystemDetail => detailOf(':root {}', { tokens: {}, ...ICON_JSON }, Object.keys(ICONS));

test('the board marks a currentColor icon for the tint, still as an <img>; the filter matches the ground text colours', async () => {
  const { html } = await assembleBoardHtml(iconDetail(), memorySource(ICONS), 'dark');
  assert.equal(html.split('<img class="dc-icon dc-icon-current"').length - 1, 2, 'mono, light and dark');
  assert.equal(html.split('<img class="dc-icon" ').length - 1, 2, 'the coloured one is left as it is');
  assert.ok(html.includes('<div class="dc-grid dc-icons">'));
  assert.ok(html.includes('.dc-icons .dc-grounds { flex-direction: column; }'), 'the two grounds stack, so they fit the card');
  assert.deepEqual(GROUND_TEXT, { light: '#1d1d1f', dark: '#ececef' });
  assert.ok(html.includes(`.dc-ground { flex: 1; padding: 8px; border-radius: calc(var(--dc-board-radius, 8px) - 2px); background: #ffffff; color: ${GROUND_TEXT.light}; }`));
  // (29 + 29 + 31) / 3 / 255 and (236 + 236 + 239) / 3 / 255: black turned to each text colour.
  assert.ok(html.includes('.dc-ground .dc-icon-current { filter: invert(0.1163); }\n.dc-ground.dc-dark .dc-icon-current { filter: invert(0.9294); }'));
  const plain = renderSpecimenSection(iconDetail(), 'assets');
  assert.ok(!plain.includes('dc-icon-current'), 'nothing is tinted that the caller did not check');
});

test('the living page tints the same icons', async (t) => {
  const rig = await setupRepo(t);
  const json = JSON.parse(SYSTEM_JSON) as Record<string, unknown>;
  for (const [rel, text] of Object.entries(ICONS)) await rig.tmp.write(`shop/design-system/${rel}`, text);
  await rig.tmp.write('shop/design-system/system.json', `${JSON.stringify({ ...json, ...ICON_JSON })}\n`);
  const id = await rig.repoSystem();
  t.after(() => livingPagesIdle(rig.ctx));
  assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
  await livingPagesIdle(rig.ctx);
  const html = await readFile(path.join(await rig.systems.dir(id), '.chamber', 'living-page.html'), 'utf8');
  assert.deepEqual(scanLivingPage(html).reasons, []);
  const tinted = [...html.matchAll(/<img class="dc-icon dc-icon-current[^"]*" src="data:image\/svg\+xml;base64,([^"]+)"/g)];
  assert.equal(tinted.length, 2);
  assert.equal(Buffer.from(tinted[0]?.[1] ?? '', 'base64').toString('utf8'), ICONS['assets/icons/mono.svg']);
});

// ---- in Chrome ----

type Report = { pixels: Record<string, string>; chips: string[] };

// Appended to the board: each icon drawn with the filter Chrome computed for it, and each chip's transition.
const PROBE = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var pixels = {};
    document.querySelectorAll('img.dc-icon').forEach(function (img) {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 24;
      var context = canvas.getContext('2d');
      var filter = getComputedStyle(img).filter;
      context.filter = filter === 'none' ? 'none' : filter;
      context.drawImage(img, 0, 0, 24, 24);
      var entry = img.closest('[data-dc-entry]').getAttribute('data-dc-entry');
      var ground = img.closest('.dc-ground').classList.contains('dc-dark') ? 'dark' : 'light';
      pixels[entry + ' ' + ground] = Array.prototype.slice.call(context.getImageData(12, 12, 1, 1).data, 0, 3).join(',');
    });
    var chips = [];
    document.querySelectorAll('.dc-motion-chip').forEach(function (chip) { chips.push(getComputedStyle(chip).transitionDuration); });
    fetch('/result', { method: 'POST', body: JSON.stringify({ pixels: pixels, chips: chips }) });
  }, 500);
});
</script>`;

const inChrome = async (chrome: string, html: string, flags: readonly string[]): Promise<Report> => {
  let answer: (value: Report) => void = () => undefined;
  const result = new Promise<Report>((resolve) => (answer = resolve));
  const server = createServer((req, res) => {
    if (req.url === '/result' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        res.writeHead(204).end();
        answer(JSON.parse(body) as Report);
      });
      return;
    }
    res.writeHead(req.url === '/board.html' ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(req.url === '/board.html' ? html : '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-motion-'));
  const child = spawn(
    chrome,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--force-color-profile=srgb', ...testBrowserFlags(), ...flags, `--user-data-dir=${profile}`, '--window-size=1200,1400', `http://127.0.0.1:${port}/board.html`],
    { stdio: 'ignore' },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('motion specimens e2e: no report within 30 s')), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
};

/** Within two steps of each channel: the filter makes a neutral grey, the text colours are all but neutral. */
const near = (actual: string | undefined, hex: string, what: string): void => {
  const expected = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const got = (actual ?? '').split(',').map(Number);
  assert.ok(got.length === 3 && got.every((channel, index) => Math.abs(channel - (expected[index] ?? 0)) <= 3), `${what}: ${actual} against ${hex}`);
};

test('in Chrome: a currentColor icon takes the ground text colour in both board schemes, and demos stop under reduced motion', async (t) => {
  const chrome = chromeOrSkip(t);
  if (chrome === null) return;
  const detail = detailOf(TOKENS, ICON_JSON, Object.keys(ICONS));
  for (const scheme of ['light', 'dark'] as const) {
    const source = memorySource(ICONS);
    const { html } = await assembleBoardHtml(detail, source, scheme);
    const bundled = (await bundleDocument(overlaySource(source, html), BOARD_ENTRY_FILE, { mode: 'render' })).html.replace('</body>', () => `${PROBE}</body>`);
    const moving = await inChrome(chrome, bundled, []);
    near(moving.pixels['icon:0 light'], GROUND_TEXT.light, `${scheme} board, light ground`);
    near(moving.pixels['icon:0 dark'], GROUND_TEXT.dark, `${scheme} board, dark ground`);
    assert.equal(moving.pixels['icon:1 dark'], moving.pixels['icon:1 light'], 'a coloured icon keeps its colours');
    // fast, base, slow (light and dark), the alias of base, then the three easings.
    assert.deepEqual(moving.chips, ['0.1s', '0.2s', '0.8s', '1s', '0.2s', '0.6s', '0.6s', '0.6s'], scheme);
    if (scheme === 'dark') {
      const still = await inChrome(chrome, bundled, ['--force-prefers-reduced-motion']);
      assert.deepEqual(still.chips, Array.from({ length: 8 }, () => '0s'));
    }
  }
});
