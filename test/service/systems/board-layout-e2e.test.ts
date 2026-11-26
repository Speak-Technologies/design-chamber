// E2E: the specimen board's Components layout in headless Chrome. The string checks in board-html.test.ts say the rules are
// present; this says they work. A system with a dark token value (so every example has a light and a dark ground) has two
// ordinary components and one whose example is wider than a column. At 1480 px the ordinary ones sit side by side in two
// columns, the wide one takes the whole board (the board script flags it), and no example is wider than its ground; at
// 1100 px (one column) nothing is wider than its ground either. Skipped (reported, never silent) when no browser is installed.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  ],
};

// Ordinary examples are about 280 px wide; the table's is 900 px inside a scrolling wrapper, as a real data table is.
const EXAMPLES: Record<string, string> = {
  buttons: '<div style="display:flex;gap:8px;white-space:nowrap;width:280px"><button>Save changes</button><button>Cancel</button></div>',
  chips: '<div style="display:flex;gap:8px;white-space:nowrap;width:280px"><span>EUR</span><span>GBP</span><span>USD</span></div>',
  table: '<div style="overflow:auto"><div style="width:900px;height:40px;background:#ccc">Wide table</div></div>',
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
const PROBE = `<script>
window.addEventListener('load', function () {
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
    var pre = document.createElement('pre');
    pre.id = 'report';
    pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  }, 300);
});
</script>`;

type CardReport = { id: string | null; wide: boolean; left: number; right: number; top: number; clipped: boolean; grounds: number; textOutside: boolean };

const dumpDom = (chrome: string, file: string, profile: string, width: number): Promise<string> =>
  new Promise((resolve, reject) => {
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
        '--virtual-time-budget=4000',
        '--timeout=15000',
        '--dump-dom',
        pathToFileURL(file).href,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let dom = '';
    child.stdout.on('data', (chunk: Buffer) => (dom += chunk.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('headless Chrome did not finish within 30 s'));
    }, 30_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(dom);
    });
  });

const layoutAt = async (chrome: string, width: number): Promise<CardReport[]> => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'dc-board-layout-'));
  try {
    const html = buildBoardHtml(detail(), { scheme: 'dark', examples: EXAMPLES }).replace('</body>', `${PROBE}</body>`);
    const file = path.join(work, 'board.html');
    await writeFile(file, html, 'utf8');
    const dom = await dumpDom(chrome, file, path.join(work, 'profile'), width);
    const match = /<pre id="report">([\s\S]*?)<\/pre>/.exec(dom);
    assert.ok(match, `no layout report at ${width}px`);
    const text = (match[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return JSON.parse(text) as CardReport[];
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
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
  assert.equal(full.length, 3);
  const [buttons, chips, table] = [byId(full, 'buttons'), byId(full, 'chips'), byId(full, 'table')];
  // Ordinary components are not widened and sit in two columns (the second card starts right of the first's right edge).
  assert.equal(buttons.wide, false, JSON.stringify(full));
  assert.equal(chips.wide, false, JSON.stringify(full));
  assert.ok(chips.left >= buttons.right, `two columns: ${JSON.stringify(full)}`);
  // The 900 px table does not fit a column, so its card takes the whole board and the table fits.
  assert.equal(table.wide, true, JSON.stringify(full));
  assert.ok(table.right - table.left > buttons.right - buttons.left, 'the wide card is wider than a column');
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
});
