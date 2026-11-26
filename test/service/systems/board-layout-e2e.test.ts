// E2E: the specimen board's Components layout in headless Chrome. The string checks in board-html.test.ts say the rules are
// present; this says they work. A system with a dark token value (so every example has a light and a dark ground) has two
// ordinary components and one whose example is wider than a column. At 1480 px the ordinary ones sit side by side in two
// columns, the wide one takes the whole board (the board script flags it), and no example is wider than its ground; at
// 1100 px (one column) nothing is wider than its ground either. Skipped (reported, never silent) when no browser is installed.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildBoardHtml } from '../../../src/service/systems/board-html.ts';
import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import { chromeOrSkip, testBrowserFlags } from '../../helpers/chrome-or-skip.ts';

const NOW = '2026-11-20T10:00:00.000Z';

const TOKENS_CSS = `:root { --brand: #1a73e8; --surface: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --brand: #8ab4f8; --surface: #121212; } }
`;

const SYSTEM_JSON = {
  tokens: { '--brand': { group: 'brand' }, '--surface': { group: 'surface' } },
  components: [
    { id: 'buttons', name: 'Buttons', purpose: 'Starts an action.', variants: ['primary', 'secondary'], example: 'components/buttons.html' },
    { id: 'chips', name: 'Chips', purpose: 'Tags a record.', variants: ['gray', 'blue'], example: 'components/chips.html' },
    { id: 'table', name: 'Table', purpose: 'Lists records in columns.', variants: ['plain'], example: 'components/table.html' },
    { id: 'late-image', name: 'Late image', purpose: 'Has an image that arrives after the first measure.', variants: ['plain'], example: 'components/late-image.html' },
    { id: 'late-style', name: 'Late style', purpose: 'Grows after the first measure.', variants: ['plain'], example: 'components/late-style.html' },
  ],
};

// Ordinary examples are about 280 px wide; the table's is 900 px inside a scrolling wrapper, as a real data table is.
const EXAMPLES: Record<string, string> = {
  buttons: '<div style="display:flex;gap:8px;white-space:nowrap;width:280px"><button>Save changes</button><button>Cancel</button></div>',
  chips: '<div style="display:flex;gap:8px;white-space:nowrap;width:280px"><span>EUR</span><span>GBP</span><span>USD</span></div>',
  table: '<div style="overflow:auto"><div style="width:900px;height:40px;background:#ccc">Wide table</div></div>',
  // An SVG image with no size of its own is 0 px wide until it loads, then 900 px: only a re-measure after `load` sees it.
  'late-image': `<div style="overflow:auto"><img alt="" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="40"><rect width="900" height="40" fill="#ccc"/></svg>')}"></div>`,
  // Narrow at first; the probe script (growLate) widens it to 900 px after the board's first pass, then sets a token on <html> the way
  // the host does (set-tokens writes custom properties on the document element's inline style).
  'late-style': '<div style="overflow:auto"><div class="grow" style="width:200px;height:40px;background:#ccc">Grows later</div></div>',
};

const detail = () =>
  buildSystemDetail({
    id: 'acme',
    dir: '/tmp/_systems/acme',
    state: { ...parseSystemState({}, 'acme', NOW), name: 'Acme' },
    systemJson: JSON.stringify(SYSTEM_JSON),
    tokensCss: TOKENS_CSS,
    texts: {},
    files: Object.keys(EXAMPLES).map((id) => ({ rel: `components/${id}.html`, bytes: 10 })),
    build: null,
  });

// Appended after the board's own script: it reports each card's box and whether any part of an example reaches past its ground.
const probe = (growLate: boolean): string => `<script>
window.addEventListener('load', function () {
  if (${growLate}) setTimeout(function () {
    var late = document.querySelector('[data-dc-example-host="late-style"]');
    var grow = late && late.shadowRoot && late.shadowRoot.querySelector('.grow');
    if (grow) grow.style.width = '900px';
    document.documentElement.style.setProperty('--dc-test-token', '1');
  }, 400);
  setTimeout(function () {
    var out = [];
    document.querySelectorAll('.dc-components > .dc-card').forEach(function (card) {
      var box = card.getBoundingClientRect();
      var clipped = false;
      card.querySelectorAll('[data-dc-example-host]').forEach(function (host) {
        var edge = host.getBoundingClientRect().right + 1;
        if (host.scrollWidth > host.clientWidth + 1) clipped = true;
        if (host.shadowRoot) host.shadowRoot.querySelectorAll('*').forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > edge) clipped = true;
        });
      });
      var grounds = card.querySelectorAll('.dc-ground').length;
      var cardRight = box.right + 1;
      var textOutside = false;
      card.querySelectorAll('.dc-note, strong').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.right > cardRight || r.bottom > box.bottom + 1) textOutside = true;
      });
      out.push({ id: card.getAttribute('data-dc-entry'), wide: card.classList.contains('dc-wide'), left: box.left, right: box.right, top: box.top, clipped: clipped, grounds: grounds, textOutside: textOutside });
    });
    fetch('/result', { method: 'POST', body: JSON.stringify(out) });
  }, 1000);
});
</script>`;

type CardReport = { id: string | null; wide: boolean; left: number; right: number; top: number; clipped: boolean; grounds: number; textOutside: boolean };

// Real time, not `--dump-dom` with a virtual-time budget: headless Chrome in virtual time never runs an animation frame after the
// page has gone idle, and the board re-measures in one. The page posts its report to this server, like test/e2e/bridge.test.ts.
const layoutAt = async (chrome: string, width: number, growLate = false): Promise<CardReport[]> => {
  const html = buildBoardHtml(detail(), { scheme: 'dark', examples: EXAMPLES }).replace('</body>', `${probe(growLate)}</body>`);
  let resolveResult: (value: CardReport[]) => void = () => undefined;
  const result = new Promise<CardReport[]>((resolve) => (resolveResult = resolve));
  const server: Server = createServer((req, res) => {
    if (req.url === '/board.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.url === '/result' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        res.writeHead(204);
        res.end();
        resolveResult(JSON.parse(body) as CardReport[]);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-board-layout-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      ...testBrowserFlags(),
      `--user-data-dir=${profile}`,
      `--window-size=${width},1400`,
      `http://127.0.0.1:${port}/board.html`,
    ],
    { stdio: 'ignore' },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`board layout e2e: no report within 30 s at ${width}px`)), 30_000);
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

const byId = (cards: readonly CardReport[], id: string): CardReport => {
  const card = cards.find((entry) => entry.id === `component:${id}`);
  assert.ok(card, `card ${id} missing: ${JSON.stringify(cards)}`);
  return card;
};

test('board components: content-sized columns, a wide example widens its card, nothing is clipped', { timeout: 120_000 }, async (t) => {
  const chrome = chromeOrSkip(t);
  if (!chrome) return;

  const full = await layoutAt(chrome, 1480);
  assert.equal(full.length, 5);
  const [buttons, chips, table] = [byId(full, 'buttons'), byId(full, 'chips'), byId(full, 'table')];
  // Ordinary components are not widened and sit in two columns (the second card starts right of the first's right edge).
  assert.equal(buttons.wide, false, JSON.stringify(full));
  assert.equal(chips.wide, false, JSON.stringify(full));
  assert.ok(chips.left >= buttons.right, `two columns: ${JSON.stringify(full)}`);
  // The 900 px table does not fit a column, so its card takes the whole board and the table fits.
  assert.equal(table.wide, true, JSON.stringify(full));
  assert.ok(table.right - table.left > buttons.right - buttons.left, 'the wide card is wider than a column');
  // Examples that grow after the first measure (an image that loads, a style change after load) are widened too.
  // Each in its own run, so one re-measure trigger cannot mask the other: the image alone, then a style change on <html> alone.
  assert.equal(byId(full, 'late-image').wide, true, `late image: ${JSON.stringify(full)}`);
  const grown = await layoutAt(chrome, 1480, true);
  assert.equal(byId(grown, 'late-style').wide, true, `late style: ${JSON.stringify(grown)}`);
  for (const card of grown) assert.equal(card.clipped, false, `clipped after the late growth: ${JSON.stringify(card)}`);
  for (const card of full) {
    assert.equal(card.clipped, false, `clipped at 1480: ${JSON.stringify(card)}`);
    assert.equal(card.textOutside, false, `text outside its card at 1480: ${JSON.stringify(card)}`);
    assert.equal(card.grounds, 2, 'a light and a dark ground');
  }

  // One column at 1100: a column as wide as the board holds the table, so still nothing is clipped.
  const narrow = await layoutAt(chrome, 1100);
  for (const card of narrow) {
    assert.equal(card.clipped, false, `clipped at 1100: ${JSON.stringify(card)}`);
    assert.equal(card.textOutside, false, `text outside its card at 1100: ${JSON.stringify(card)}`);
  }
  assert.ok(byId(narrow, 'chips').top > byId(narrow, 'buttons').top, 'one column at 1100');
  // A column as wide as the board holds every example, so no card is widened (a too-narrow column would flag the ordinary ones).
  assert.deepEqual(
    narrow.filter((card) => card.wide).map((card) => card.id),
    [],
    `no card is widened at 1100: ${JSON.stringify(narrow)}`,
  );
});
