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
const layoutAt = (chrome: string, width: number, growLate = false): Promise<CardReport[]> =>
  reportAt<CardReport[]>(chrome, width, buildBoardHtml(detail(), { scheme: 'dark', examples: EXAMPLES }).replace('</body>', `${probe(growLate)}</body>`));

/** Opens `html` in headless Chrome at `width` and answers what its own script posts to /result. */
const reportAt = async <T,>(chrome: string, width: number, html: string): Promise<T> => {
  let resolveResult: (value: T) => void = () => undefined;
  const result = new Promise<T>((resolve) => (resolveResult = resolve));
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
        resolveResult(JSON.parse(body) as T);
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

// ---- the layout hints: compact, full and table runs (documentation/specs/system-board-layout-and-visual-check.md §A.3, §A.4) ----

const LAYOUT_JSON = {
  tokens: { '--brand': { group: 'brand' }, '--surface': { group: 'surface' }, '--ink': { group: 'brand' } },
  layout: { colours: 'table' },
  components: [
    ...['pill-a', 'pill-b', 'pill-c', 'pill-d'].map((id) => ({ id, name: `Pill ${id.slice(-1)}`, purpose: 'Marks a state.', layout: 'compact', example: `components/${id}.html` })),
    { id: 'nav', name: 'Navigation', purpose: 'Moves between pages.', layout: 'full', example: 'components/nav.html' },
    { id: 'hero', name: 'Page header', purpose: 'Opens a page.', layout: 'full', example: 'components/hero.html' },
    { id: 'row-a', name: 'Row A', purpose: 'A short row.', note: 'Use for one value.', layout: 'table', example: 'components/row-a.html' },
    { id: 'row-wide', name: 'Wide row', purpose: 'A row with a wide example.', note: 'Scrolls in its own box.', layout: 'table', example: 'components/row-wide.html' },
    { id: 'row-c', name: 'Row C', purpose: 'Another short row.', note: 'Use for two values.', layout: 'table', example: 'components/row-c.html' },
    { id: 'card-last', name: 'Card last', purpose: 'Back to the default.', example: 'components/card-last.html' },
  ],
};

const LAYOUT_EXAMPLES: Record<string, string> = {
  'pill-a': '<span style="display:inline-block;padding:2px 8px;border-radius:99px;background:#ddd">New</span>',
  'pill-b': '<span style="display:inline-block;padding:2px 8px;border-radius:99px;background:#ddd">Open</span>',
  'pill-c': '<span style="display:inline-block;padding:2px 8px;border-radius:99px;background:#ddd">Done</span>',
  'pill-d': '<span style="display:inline-block;padding:2px 8px;border-radius:99px;background:#ddd">Late</span>',
  nav: '<nav style="display:flex;gap:24px;width:900px;white-space:nowrap"><a>Home</a><a>Orders</a><a>Customers</a><a>Reports</a></nav>',
  hero: '<header style="width:400px"><h1 style="margin:0">Orders</h1></header>',
  'row-a': '<button>One</button>',
  // Wider than the preview column of a table at 1480 (about 800 px) but scrolling inside its own box, as a real data table does.
  'row-wide': '<div style="overflow:auto"><div style="width:1200px;height:40px;background:#ccc">Wide table row</div></div>',
  'row-c': '<button>Two</button>',
  'card-last': '<button>Last</button>',
};

const layoutDetail = () =>
  buildSystemDetail({
    id: 'acme',
    dir: '/tmp/_systems/acme',
    state: { ...parseSystemState({}, 'acme', NOW), name: 'Acme' },
    systemJson: JSON.stringify(LAYOUT_JSON),
    tokensCss: ':root { --brand: #1a73e8; --surface: #ffffff; --ink: #1d1d1f; }\n@media (prefers-color-scheme: dark) { :root { --brand: #8ab4f8; --surface: #121212; --ink: #ececef; } }\n',
    texts: {},
    files: Object.keys(LAYOUT_EXAMPLES).map((id) => ({ rel: `components/${id}.html`, bytes: 10 })),
    build: null,
  });

type Box = { left: number; right: number; top: number; bottom: number };
type EntryReport = {
  id: string;
  run: string;
  wide: boolean;
  box: Box;
  clipped: boolean;
  textOutside: boolean;
  cells: Record<string, Box>;
};
type LayoutReport = { section: number; entries: EntryReport[]; heads: Record<string, Box>[] };

// Reports every board entry: the run it sits in, its box, its table cells, and whether an example or its text reaches past it.
const LAYOUT_PROBE = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var rect = function (el) { var r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    var cellsOf = function (row) {
      var cells = {};
      row.querySelectorAll(':scope > .dc-tcell').forEach(function (cell, index) {
        var name = (cell.className.match(/dc-tcell-(\\w+)/) || [null, String(index)])[1];
        cells[name] = rect(cell);
      });
      return cells;
    };
    var entries = [];
    document.querySelectorAll('[data-dc-entry]').forEach(function (el) {
      var box = el.getBoundingClientRect();
      var clipped = false;
      el.querySelectorAll('[data-dc-example-host]').forEach(function (host) {
        var edge = host.getBoundingClientRect().right + 1;
        if (host.scrollWidth > host.clientWidth + 1) clipped = true;
        if (host.shadowRoot) host.shadowRoot.querySelectorAll('*').forEach(function (inner) {
          var r = inner.getBoundingClientRect();
          if (r.width > 0 && r.right > edge) clipped = true;
        });
      });
      var textOutside = false;
      el.querySelectorAll('.dc-note, .dc-name, strong').forEach(function (t) {
        var r = t.getBoundingClientRect();
        if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1)) textOutside = true;
      });
      var run = el.parentElement ? el.parentElement.className : '';
      entries.push({ id: el.getAttribute('data-dc-entry'), run: run, wide: el.classList.contains('dc-wide'), box: rect(el), clipped: clipped, textOutside: textOutside, cells: cellsOf(el) });
    });
    var heads = [];
    document.querySelectorAll('.dc-thead').forEach(function (head) { heads.push(cellsOf(head)); });
    var section = document.querySelector('.dc-section');
    fetch('/result', { method: 'POST', body: JSON.stringify({ section: section ? section.getBoundingClientRect().width : 0, entries: entries, heads: heads }) });
  }, 1000);
});
</script>`;

const layoutReportAt = (chrome: string, width: number): Promise<LayoutReport> =>
  reportAt<LayoutReport>(chrome, width, buildBoardHtml(layoutDetail(), { scheme: 'dark', examples: LAYOUT_EXAMPLES }).replace('</body>', `${LAYOUT_PROBE}</body>`));

const entryOf = (report: LayoutReport, id: string): EntryReport => {
  const entry = report.entries.find((candidate) => candidate.id === id);
  assert.ok(entry, `entry ${id} missing: ${JSON.stringify(report.entries.map((e) => e.id))}`);
  return entry;
};

const near = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`);

test('board layouts in Chrome: compact packs small pieces, full spans the section, table rows align and stack when narrow', { timeout: 120_000 }, async (t) => {
  const chrome = chromeOrSkip(t);
  if (!chrome) return;

  const wide = await layoutReportAt(chrome, 1480);
  const pills = ['pill-a', 'pill-b', 'pill-c', 'pill-d'].map((id) => entryOf(wide, `component:${id}`));
  const [nav, hero] = [entryOf(wide, 'component:nav'), entryOf(wide, 'component:hero')];
  const rows = ['row-a', 'row-wide', 'row-c'].map((id) => entryOf(wide, `component:${id}`));
  const [rowA, rowWide, rowC] = rows as [EntryReport, EntryReport, EntryReport];
  const last = entryOf(wide, 'component:card-last');

  // The agent's order is kept: compact, then full, then table, then the card run.
  assert.ok(pills.every((pill) => pill.run.includes('dc-run-compact')), JSON.stringify(pills.map((p) => p.run)));
  assert.ok(nav.run.includes('dc-run-full') && hero.run.includes('dc-run-full'));
  assert.ok(rows.every((row) => row.run.includes('dc-run-table')));
  assert.ok(last.run.includes('dc-run-card'));
  const bottom = (entries: readonly EntryReport[]): number => Math.max(...entries.map((e) => e.box.bottom));
  assert.ok(bottom(pills) <= nav.box.top && hero.box.bottom <= rowA.box.top && rowC.box.bottom <= last.box.top, 'runs in the agent order, top to bottom');

  // Compact: 280 px columns, so the four pills sit side by side in one band (at least three columns), none widened.
  assert.ok(new Set(pills.map((pill) => Math.round(pill.box.left))).size >= 3, `compact columns: ${JSON.stringify(pills.map((p) => p.box))}`);
  for (const pill of pills) {
    assert.equal(pill.wide, false, pill.id);
    assert.ok(pill.box.right - pill.box.left < 400, `${pill.id} is a compact card, not a full one`);
  }

  // Full: one card per row, each as wide as the section, the 900 px navigation fits without widening anything.
  for (const card of [nav, hero]) {
    near(card.box.right - card.box.left, wide.section, `${card.id} spans the section`);
    near(card.box.left, nav.box.left, `${card.id} starts at the section edge`);
  }
  assert.ok(hero.box.top >= nav.box.bottom, 'full cards stack, one per row');

  // Table: the three columns line up across rows and with the header (subgrid).
  const head = wide.heads[0];
  assert.ok(head, 'the components table has a header row');
  for (const row of [rowA, rowC]) {
    assert.equal(row.wide, false, row.id);
    for (const cell of ['name', 'preview', 'notes']) {
      const box = row.cells[cell];
      assert.ok(box, `${row.id} has a ${cell} cell`);
      near(box.left, rowA.cells[cell]?.left ?? NaN, `${row.id} ${cell} column`);
    }
  }
  near(Object.values(head)[1]?.left ?? NaN, rowA.cells.preview?.left ?? NaN, 'the Preview header sits over the preview cells');
  // The wide row's example does not fit the preview column: the row is widened, name and notes side by side on top and the preview
  // under them across the whole row.
  assert.equal(rowWide.wide, true, JSON.stringify(rowWide));
  const [name, notes, preview] = [rowWide.cells.name, rowWide.cells.notes, rowWide.cells.preview];
  assert.ok(name && notes && preview, JSON.stringify(rowWide.cells));
  near(name.top, notes.top, 'name and notes on one line');
  assert.ok(notes.left > name.left, 'notes to the right of the name');
  assert.ok(preview.top >= Math.max(name.bottom, notes.bottom) - 1, 'the preview under them');
  near(preview.left, rowWide.box.left, 'the preview starts at the row edge');
  assert.ok(preview.right - preview.left > (rowA.cells.preview?.right ?? 0) - (rowA.cells.preview?.left ?? 0), 'wider than the preview column');

  // Token tables: the colours section default puts every colour in a row with a sample, token and note cell, aligned.
  const colours = wide.entries.filter((entry) => entry.id.startsWith('token:'));
  assert.equal(colours.length, 3, JSON.stringify(wide.entries.map((e) => e.id)));
  assert.ok(colours.every((entry) => entry.run.includes('dc-run-table')));
  for (const entry of colours) assert.equal(Object.keys(entry.cells).length, 3, `${entry.id}: ${JSON.stringify(entry.cells)}`);

  for (const entry of wide.entries) {
    assert.equal(entry.clipped, false, `clipped at 1480: ${JSON.stringify(entry)}`);
    assert.equal(entry.textOutside, false, `text outside its entry at 1480: ${JSON.stringify(entry)}`);
  }

  // Under 760 px of section width the table cells stack: each cell starts at the row edge, one under the other; still nothing clipped.
  const narrow = await layoutReportAt(chrome, 700);
  assert.ok(narrow.section < 760, `section ${narrow.section}`);
  for (const id of ['component:row-a', 'component:row-wide', 'component:row-c']) {
    const row = entryOf(narrow, id);
    const cells = [row.cells.name, row.cells.preview, row.cells.notes];
    assert.ok(cells.every((cell) => cell !== undefined), `${id}: ${JSON.stringify(row.cells)}`);
    for (const cell of cells) near(cell?.left ?? NaN, row.box.left, `${id} stacked cell`);
    assert.ok((cells[1]?.top ?? 0) >= (cells[0]?.bottom ?? Infinity) - 1 && (cells[2]?.top ?? 0) >= (cells[1]?.bottom ?? Infinity) - 1, `${id} cells one under the other`);
  }
  // The 900 px navigation and the 1200 px row are wider than this whole board, so they are the previews that scroll, inside their own
  // ground (and the probe sees them, so the check below can fail).
  const widerThanBoard = new Set(['component:nav', 'component:row-wide']);
  for (const id of widerThanBoard) assert.equal(entryOf(narrow, id).clipped, true, `${id}: a preview wider than the board scrolls in its ground`);
  for (const entry of narrow.entries) {
    if (!widerThanBoard.has(entry.id)) assert.equal(entry.clipped, false, `clipped at 700: ${JSON.stringify(entry)}`);
    assert.equal(entry.textOutside, false, `text outside its entry at 700: ${JSON.stringify(entry)}`);
  }
});
