// The reads behind `dc list` and `dc read` (documentation/specs/use-the-project-and-native-agent.md
// §2.3, §2.4, "Sandbox and path safety"): every design path contained under the root, links never
// followed, view.json re-checked, check pictures only when they are plain files in `.chamber/check/`,
// and nothing written (the hand-edit ledger stays as it was). Always a scratch root.

import assert from 'node:assert/strict';
import { readFile, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { designFolderOf, listDesigns, openRoot, parseViewFile, readOneDesign } from '../../src/service/agent-read.ts';
import { formatListText, formatReadText } from '../../src/shared/agent/read-text.ts';
import { useTmpRoot, type TmpRoot } from '../helpers/tmp-root.ts';

const NOW = new Date('2026-11-27T10:05:00.000Z');
const SETTINGS = { version: 1 } as const;

const design = (title: string, extra: Record<string, unknown> = {}): object => ({
  version: 1,
  kind: 'canvas',
  title,
  created: '2026-11-01T10:00:00.000Z',
  updated: '2026-11-27T10:00:00.000Z',
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
  screens: [{ id: 'home', title: 'Home', file: 'screens/home.html' }],
  designSystem: { confirmed: false },
  ...extra,
});

const pin = (id: string, status: 'open' | 'sent' | 'resolved', body: string): object => ({
  id,
  screen: 'home',
  viewport: 'laptop',
  anchor: { selector: '.hero .cta', text: 'Start now', html: '<a class="cta">', rect: { x: 1, y: 2, w: 3, h: 4 }, point: { x: 0.5, y: 0.5 } },
  body,
  status,
  created: '2026-11-27T09:00:00.000Z',
  sentAt: status === 'open' ? null : '2026-11-27T09:30:00.000Z',
  sentVersion: status === 'open' ? null : 1,
});

const stateJson = (comments: object[], extra: Record<string, unknown> = {}): object => ({
  version: 1,
  kind: 'canvas',
  created: '2026-11-01T10:00:00.000Z',
  brief: '',
  sessionId: null,
  projectDirectory: '/home/u/code/shop',
  preset: null,
  entry: null,
  comments,
  ...extra,
});

const view = (slug: string, extra: Record<string, unknown> = {}): object => ({
  v: 1,
  at: new Date(NOW.getTime() - 30_000).toISOString(),
  surface: 'page',
  slug,
  title: 'Old title',
  screen: 'home',
  viewport: 'laptop',
  mode: 'edit',
  selection: { selector: 'main > .hero h1', text: 'Fresh coffee, weekly' },
  ...extra,
});

const setup = async (t: TestContext): Promise<{ tmp: TmpRoot; root: string; dataDir: string }> => {
  const tmp = await useTmpRoot(t, 'dc-agent-read-');
  const root = tmp.at('designs');
  await tmp.writeDesign('designs/pricing-page', { 'design.json': design('Pricing'), 'screens/home.html': '<!doctype html><h1>Hi</h1>' });
  return { tmp, root, dataDir: tmp.at('data') };
};

const canSymlink = async (t: TestContext, tmp: TmpRoot): Promise<boolean> => {
  try {
    await symlink(tmp.at('nowhere'), tmp.at('probe-link'));
    await rm(tmp.at('probe-link'));
    return true;
  } catch {
    t.skip('this machine cannot create symlinks');
    return false;
  }
};

const read = (root: string, dataDir: string, slug: string) => readOneDesign({ root, settings: SETTINGS, dataDir, now: NOW, slug });
const list = (root: string, dataDir: string, filter: { project?: string; kind?: 'page' | 'canvas'; text?: string } = {}) =>
  listDesigns({ root, settings: SETTINGS, dataDir, now: NOW, project: filter.project ?? null, kind: filter.kind ?? null, text: filter.text ?? null });

test('a traversal, a drive letter, a nested path or a missing design is refused, and the answer names no other folder', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  await tmp.write('outside/design.json', design('Secret'));
  await tmp.write('designs/plain/readme.txt', 'not a design');
  // A real design folder one level down: only the folder-name rule keeps a nested path out.
  await tmp.write('designs/pricing-page/nested/design.json', design('Nested'));
  for (const slug of ['../outside', 'C:\\x', 'a/b', '..', 'pricing-page/screens', 'pricing-page/nested', 'ghost', 'plain', tmp.at('outside')]) {
    const result = await read(root, dataDir, slug);
    assert.deepEqual(result, { ok: false, message: `That is not a design in ${root}.` }, slug);
  }
  const rootFolder = await openRoot(root);
  assert.equal(await designFolderOf(rootFolder, '../outside'), null);
});

test('a missing designs folder is a plain sentence, not a crash', async (t) => {
  const { tmp, dataDir } = await setup(t);
  await assert.rejects(read(tmp.at('nope'), dataDir, 'pricing-page'), /The designs folder .*nope does not exist\./);
  await assert.rejects(list(tmp.at('nope'), dataDir), /does not exist\./);
});

test('a design folder that is a link to outside the root is not listed and not read', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  if (!(await canSymlink(t, tmp))) return;
  await tmp.writeDesign('outside', { 'design.json': design('Secret outside') });
  await symlink(tmp.at('outside'), path.join(root, 'linked'), 'dir');
  // A link pointing inside the root is refused too: a design folder is that folder itself.
  await symlink(path.join(root, 'pricing-page'), path.join(root, 'alias'), 'dir');
  const listed = await list(root, dataDir);
  assert.deepEqual(listed.rows.map((row) => row.slug), ['pricing-page']);
  assert.ok(!formatListText(listed).includes('Secret'));
  assert.equal((await read(root, dataDir, 'linked')).ok, false);
  assert.equal((await read(root, dataDir, 'alias')).ok, false);
});

test('a design.json or state.json that is a link is never read through', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  if (!(await canSymlink(t, tmp))) return;
  await tmp.write('secret.json', design('Secret title', { comments: [pin('c_aaaa1111', 'open', 'secret pin')] }));
  await tmp.writeDesign('designs/linked-json', { 'screens/home.html': '<h1>x</h1>' });
  await symlink(tmp.at('secret.json'), path.join(root, 'linked-json', 'design.json'));
  await tmp.write('designs/linked-json/.chamber/.keep', '');
  await symlink(tmp.at('secret.json'), path.join(root, 'linked-json', '.chamber', 'state.json'));
  const result = await read(root, dataDir, 'linked-json');
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.answer.title, 'linked-json');
  assert.equal(result.answer.readable, false);
  const text = formatReadText(result.answer);
  assert.ok(!text.includes('Secret') && !text.includes('secret pin'), text);
});

test('pins come from state.json (the service truth), open first; a done pin is only counted', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  await tmp.write('designs/pricing-page/.chamber/state.json', stateJson([pin('c_aaaa0001', 'resolved', 'done one'), pin('c_aaaa0002', 'sent', 'sent one'), pin('c_aaaa0003', 'open', 'Make this button less shouty')]));
  const result = await read(root, dataDir, 'pricing-page');
  assert.ok(result.ok);
  if (!result.ok) return;
  const text = formatReadText(result.answer);
  assert.match(text, /Pins: 1 open, 1 sent and not done, 1 done\n {2}Open:\n {2}1\. Screen "Home" \(screens\/home\.html\) @ Laptop 1280×800\n {5}element: `\.hero \.cta`/);
  assert.match(text, /→ Make this button less shouty\n {2}Sent and not done yet:\n {2}2\./);
  assert.ok(!text.includes('done one'));
  assert.match(text, /, a canvas for \/home\/u\/code\/shop\./);
});

test('dc read leaves the hand-edit ledger exactly as it was, and counts it', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  const ledger = {
    v: 1,
    seq: 3,
    dropped: 1,
    undo: [],
    ledger: [
      { seq: 2, at: '2026-11-27T09:40:00.000Z', editId: 'e_abcdefgh01', kind: 'text', file: 'screens/home.html', screen: 'Home', before: 'Hi', after: 'Hello' },
      { seq: 3, at: '2026-11-27T09:41:00.000Z', editId: 'e_abcdefgh02', kind: 'tweaks', changes: [{ label: 'Accent', before: '#000', after: '#111' }] },
    ],
  };
  const file = await tmp.write('designs/pricing-page/.chamber/edits.json', ledger);
  const before = { text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs };
  const result = await read(root, dataDir, 'pricing-page');
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.answer.handEdits, { count: 3, kinds: ['text on Home', 'tweaks'] });
  assert.equal(await readFile(file, 'utf8'), before.text);
  assert.equal((await stat(file)).mtimeMs, before.mtime);
});

test('view.json: a fresh report names the design, screen, viewport and selection; a viewport the design lacks is dropped', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  await tmp.write('data/view.json', view('pricing-page'));
  const one = await read(root, dataDir, 'pricing-page');
  assert.ok(one.ok);
  if (!one.ok) return;
  assert.match(formatReadText(one.answer), /Open now: screen "Home" at Laptop 1280×800, on the full-screen page, just now; selected element `main > \.hero h1` "Fresh coffee, weekly"/);
  const listed = await list(root, dataDir);
  assert.match(formatListText(listed), /Open now: "Pricing" \(pricing-page\), screen "Home" at Laptop 1280×800, on the full-screen page, just now/);

  await tmp.write('data/view.json', view('pricing-page', { viewport: 'tv', screen: 'nope' }));
  const dropped = await read(root, dataDir, 'pricing-page');
  assert.ok(dropped.ok && dropped.answer.open.state === 'here');
  if (!dropped.ok || dropped.answer.open.state !== 'here') return;
  assert.equal(dropped.answer.open.view.viewport, null);
  assert.equal(dropped.answer.open.view.screen, null);
});

test('view.json naming a path, a gone design, or older than 3 minutes reads as nothing open', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  for (const bad of [view('../../etc'), view('..'), view('ghost'), view('pricing-page', { at: new Date(NOW.getTime() - 181_000).toISOString() }), { ...view('pricing-page'), v: 2 }]) {
    await tmp.write('data/view.json', bad);
    const listed = await list(root, dataDir);
    assert.equal(listed.open, null, JSON.stringify(bad));
    const one = await read(root, dataDir, 'pricing-page');
    assert.ok(one.ok && one.answer.open.state === 'none', JSON.stringify(bad));
  }
  await tmp.write('data/view.json', { ...view('pricing-page'), padding: 'x'.repeat(17 * 1024) });
  assert.equal((await list(root, dataDir)).open, null, 'a view.json over 16 KiB is not read, even a valid one');
  assert.equal(parseViewFile({ ...view('pricing-page'), slug: 'a/b' }, NOW.getTime()), null);
});

test('view.json that is a link is not read', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  if (!(await canSymlink(t, tmp))) return;
  await tmp.write('elsewhere.json', view('pricing-page'));
  await tmp.write('data/.keep', '');
  await symlink(tmp.at('elsewhere.json'), path.join(dataDir, 'view.json'));
  assert.equal((await list(root, dataDir)).open, null);
});

const report = (pngs: string[]): object => ({
  version: 1,
  slug: 'pricing-page',
  kind: 'canvas',
  createdAt: '2026-11-27T09:58:00.000Z',
  tool: 'cli',
  static: { findings: [] },
  render: {
    state: 'done',
    browser: 'chrome',
    keys: { design: 'a'.repeat(64), entries: {} },
    artboards: [{ screen: 'home', viewport: 'laptop', width: 1280, height: 800, docHeight: 900, ms: 10, ok: true, pngs }],
    skipped: 0,
    findings: [{ code: 'overflow-x', file: 'screens/home.html', screen: 'home', viewport: 'laptop', params: { px: 900, width: 390 } }],
  },
});

test('the last check: counts, stale after a change, and only PNGs that are plain files inside .chamber/check/', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  const run = 'r-20261127095800-abcdef';
  await tmp.write(`designs/pricing-page/.chamber/check/${run}/home-laptop.png`, 'png');
  await tmp.write('designs/pricing-page/.chamber/check.json', report([`.chamber/check/${run}/home-laptop.png`, `.chamber/check/${run}/gone.png`, '../../outside.png', `.chamber/check/../../x.png`]));
  const result = await read(root, dataDir, 'pricing-page');
  assert.ok(result.ok);
  if (!result.ok || result.answer.check.state !== 'report') return assert.fail('expected a report');
  assert.deepEqual(result.answer.check.pngs, [path.join(root, 'pricing-page', '.chamber', 'check', run, 'home-laptop.png')]);
  assert.equal(result.answer.check.stale, true, 'design.json no longer hashes to the key the check saw');
  assert.equal(result.answer.check.counts.errors + result.answer.check.counts.warnings > 0, true);
  assert.match(formatReadText(result.answer), /\(before your latest changes\)/);
});

test('a check PNG that is a link is not printed', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  if (!(await canSymlink(t, tmp))) return;
  const run = 'r-20261127095800-abcdef';
  await tmp.write('outside.png', 'png');
  await tmp.write(`designs/pricing-page/.chamber/check/${run}/real.png`, 'png');
  await symlink(tmp.at('outside.png'), path.join(root, 'pricing-page', '.chamber', 'check', run, 'linked.png'));
  await tmp.write('designs/pricing-page/.chamber/check.json', report([`.chamber/check/${run}/linked.png`, `.chamber/check/${run}/real.png`]));
  const result = await read(root, dataDir, 'pricing-page');
  assert.ok(result.ok && result.answer.check.state === 'report');
  if (!result.ok || result.answer.check.state !== 'report') return;
  assert.deepEqual(result.answer.check.pngs.map((png) => path.basename(png)), ['real.png']);
});

test('dc list: newest first, filters by project, kind and text, and lists a damaged design by its folder name', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  await tmp.writeDesign('designs/landing', { 'design.json': design('Landing page', { kind: 'page', updated: '2026-11-27T11:00:00.000Z', projectDirectory: '/home/u/code/site' }), 'index.html': '<h1>x</h1>' });
  await tmp.write('designs/pricing-page/.chamber/state.json', stateJson([pin('c_aaaa0003', 'open', 'x')], { systemDecision: 'ask' }));
  await tmp.writeDesign('designs/broken', { 'design.json': '{ "title": "half', 'index.html': '<h1>x</h1>' });
  await tmp.write('designs/_systems/readme.txt', 'not a design');
  await tmp.write('designs/.trash/old/design.json', design('Trashed'));

  const all = await list(root, dataDir);
  // The damaged one sorts by its folder time (it has no readable `updated`); the others by theirs.
  assert.deepEqual(all.rows.filter((row) => row.readable).map((row) => row.slug), ['landing', 'pricing-page']);
  assert.deepEqual(all.rows.map((row) => row.slug).sort(), ['broken', 'landing', 'pricing-page']);
  const text = formatListText(all);
  assert.match(text, /- pricing-page · canvas · "Pricing" · project shop · updated [^·]+ · 1 open pin · asks which system/);
  assert.match(text, /- broken · design\.json can't be read right now/);
  assert.ok(!text.includes('Trashed'));

  assert.deepEqual((await list(root, dataDir, { project: '/home/u/code/shop/' })).rows.map((row) => row.slug), ['pricing-page']);
  assert.deepEqual((await list(root, dataDir, { kind: 'page' })).rows.map((row) => row.slug), ['landing']);
  assert.deepEqual((await list(root, dataDir, { text: 'LANDING' })).rows.map((row) => row.slug), ['landing']);
  assert.deepEqual((await list(root, dataDir, { text: 'brok' })).rows.map((row) => row.slug), ['broken']);
  const none = await list(root, dataDir, { text: 'zzz' });
  assert.match(formatListText(none), /No designs match\./);
});

test('dc list names the design systems with their state, and never lists _systems as a design', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  for (const [id, name, status] of [['acme', 'Acme', 'ready'], ['beta', 'Beta', 'draft']] as const) {
    await tmp.write(`designs/_systems/${id}/tokens.css`, ':root {\n  --brand: #0a5;\n}\n');
    await tmp.write(`designs/_systems/${id}/system.json`, '{}\n');
    await tmp.write(`designs/_systems/${id}/.chamber/state.json`, { name, status });
  }
  const listed = await list(root, dataDir);
  assert.deepEqual(listed.rows.map((row) => row.slug), ['pricing-page']);
  assert.deepEqual(listed.systems?.map((system) => [system.id, system.status, system.project]).sort(), [['acme', 'ready', null], ['beta', 'draft', null]]);
  assert.match(formatListText(listed), /Design systems: (acme "Acme" \(Ready\), beta "Beta" \(Draft\)|beta "Beta" \(Draft\), acme "Acme" \(Ready\))\n$/);
});

test('a design made to follow its project says so in the list and in the read', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  await tmp.write('designs/pricing-page/.chamber/state.json', stateJson([], { systemDecision: 'project' }));
  assert.match(formatListText(await list(root, dataDir)), /- pricing-page · canvas · "Pricing" · project shop · updated [^·]+ · follows the project\n/);
  const one = await read(root, dataDir, 'pricing-page');
  assert.ok(one.ok);
  if (!one.ok) return;
  assert.match(formatReadText(one.answer), /\nSystem: follows the project's own design files\n/);
});

test('dc read lists the design files of the project a design follows, and says when the folder cannot be read', async (t) => {
  const { tmp, root, dataDir } = await setup(t);
  const project = tmp.at('code/shop');
  await tmp.write('code/shop/DESIGN.md', '# Shop design\n');
  await tmp.write('code/shop/src/styles/tokens.css', ':root { --brand: #0a5; --ink: #111; --paper: #fff; --line: #ddd; --muted: #666; }\n');
  await tmp.write('code/shop/src/components/Button.tsx', 'export const Button = () => null;\n');
  await tmp.write('designs/pricing-page/.chamber/state.json', stateJson([], { systemDecision: 'project', projectDirectory: project }));
  const one = await read(root, dataDir, 'pricing-page');
  assert.ok(one.ok);
  if (!one.ok) return;
  assert.equal(one.answer.system.state, 'project');
  const text = formatReadText(one.answer);
  assert.match(text, new RegExp(`\\nSystem: follows the project's own design files\\n {2}Read these first, in ${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \`DESIGN\\.md\`, \`src/styles/tokens\\.css\``));
  assert.match(text, /\n {2}Its components in `src\/components`\. Copy their structure and states into this design; don't import or run them\.\n/);

  // The project folder is gone: the agent is told to look itself, and nothing is invented.
  await tmp.write('designs/pricing-page/.chamber/state.json', stateJson([], { systemDecision: 'project', projectDirectory: tmp.at('code/gone') }));
  const gone = await read(root, dataDir, 'pricing-page');
  assert.ok(gone.ok);
  if (!gone.ok) return;
  assert.match(formatReadText(gone.answer), /\n {2}Design Chamber couldn't read .*code\/gone just now\. Look at the project's design files yourself before you draw\.\n/);

  // A design with no project folder: the follow line alone.
  await tmp.write('designs/pricing-page/.chamber/state.json', stateJson([], { systemDecision: 'project', projectDirectory: null }));
  const bare = await read(root, dataDir, 'pricing-page');
  assert.ok(bare.ok);
  if (!bare.ok) return;
  assert.match(formatReadText(bare.answer), /\nSystem: follows the project's own design files\nOpen now:/);
});

test('an empty designs folder says so', async (t) => {
  const tmp = await useTmpRoot(t, 'dc-agent-read-empty-');
  await tmp.write('designs/.keep', '');
  assert.match(formatListText(await list(tmp.at('designs'), tmp.at('data'))), /There are no designs in .*designs yet\.\nDesign systems: none yet\./);
});
