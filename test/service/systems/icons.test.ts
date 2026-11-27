// Icons (documentation/specs/system-builder-depth.md §4.6, §13 T11, §16): SVG files in assets/icons/
// listed in `icons`. `checkAsset` doesn't look inside an SVG, so an icon is only ever drawn as `<img>`:
// the first tests prove no icon's markup reaches the board, the check's bundle or the living page.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { areaEmpty, scanIcon, systemFindings } from '../../../src/service/check/system-static.ts';
import { bundleDocument, type FileSource } from '../../../src/service/bundle.ts';
import { exportIncludes } from '../../../src/service/export.ts';
import { checkAsset, FOLDER_OF_KIND } from '../../../src/service/systems/assets.ts';
import { assembleBoardHtml, overlaySource } from '../../../src/service/systems/board-assemble.ts';
import { BOARD_ENTRY_FILE } from '../../../src/service/systems/board-html.ts';
import { isCopyReference, planCopy } from '../../../src/service/systems/link.ts';
import { livingPagesIdle, parseLivingRecord } from '../../../src/service/systems/living-page.ts';
import { scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { readRepoSystem } from '../../../src/service/systems/repo-read.ts';
import { refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { ICON_DRAWN_MAX_BYTES, ICON_SIZES_SHOWN, iconCopies, renderSpecimenSection } from '../../../src/service/systems/specimen-html.ts';
import { sha256Hex } from '../../../src/shared/agent/ownership.ts';
import { findingMessage, severityOf } from '../../../src/shared/checks.ts';
import { SYSTEM_FILES_MAX, SYSTEM_ICONS_MAX } from '../../../src/shared/limits.ts';
import { isBoardEntryKey, parseEntryKey, sectionOfEntry } from '../../../src/shared/system-board.ts';
import { buildSystemDetail, isSystemContractRel, parseSystemState, sectionFingerprints, SYSTEM_SECTIONS } from '../../../src/shared/system-json.ts';
import type { SettingsFile, SystemDetail } from '../../../src/shared/types.ts';
import { createTmpRoot, useTmpRoot } from '../../helpers/tmp-root.ts';
import { setupRepo, SYSTEM_JSON } from './repo-fixture.ts';

const NOW = '2026-11-27T10:00:00.000Z';

/** An icon whose markup would be seen at once if it were ever put in a document as markup. */
const HOSTILE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-mark="ICONMARK"><script>ICONSCRIPT()</script><path onload="ICONLOAD()" d="M0 0h24"/></svg>';
const icon = (viewBox = '0 0 24 24', stroke = '2'): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path stroke-width="${stroke}" d="M0 0h8"/></svg>`;

const listed = (...names: string[]): { file: string; name: string }[] => names.map((name) => ({ file: `assets/icons/${name}.svg`, name }));
const filesOf = (...names: string[]): string[] => names.map((name) => `assets/icons/${name}.svg`);

const detailOf = (json: Record<string, unknown>, files: readonly string[] = [], tokensCss = ':root {\n}\n', hashes?: Record<string, string>): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(json),
    tokensCss,
    texts: {},
    files: files.map((rel) => ({ rel, bytes: 1 })),
    build: null,
    ...(hashes === undefined ? {} : { hashes }),
  });

const memorySource = (files: Record<string, string>): FileSource => ({
  root: '/memory',
  read: async (rel) => {
    if (!Object.hasOwn(files, rel)) return null;
    const bytes = Buffer.from(files[rel] ?? '', 'utf8');
    return { bytes, size: bytes.length, mtimeMs: 0 };
  },
  stat: async (rel) => (Object.hasOwn(files, rel) ? { size: Buffer.byteLength(files[rel] ?? ''), mtimeMs: 0 } : null),
});

const assetsSection = (detail: SystemDetail): string => renderSpecimenSection(detail, 'assets');
const count = (text: string, piece: string): number => text.split(piece).length - 1;

// ---- safety: an icon is only ever an <img> ----

test('an icon file never reaches the board as markup: only <img>, bundled to a data: URL, in render and export', async () => {
  const detail = detailOf({ icons: listed('hostile') }, filesOf('hostile'));
  const source = memorySource({ 'assets/icons/hostile.svg': HOSTILE_ICON });
  const { html } = await assembleBoardHtml(detail, source, 'light');
  assert.ok(html.includes('<img class="dc-icon"'));
  assert.ok(html.includes('src="assets/icons/hostile.svg"'));
  for (const mode of ['render', 'export'] as const) {
    const bundled = (await bundleDocument(overlaySource(source, html), BOARD_ENTRY_FILE, { mode })).html;
    for (const mark of ['ICONMARK', 'ICONSCRIPT', 'ICONLOAD']) assert.ok(!bundled.includes(mark), `${mode}: ${mark}`);
    const section = /<section class="dc-section" id="dc-section-assets"[\s\S]*?<\/section>/.exec(bundled)?.[0] ?? '';
    assert.ok(!/<svg/i.test(section), `${mode}: no inline svg`);
    // Light and dark, each a picture of the file's own bytes.
    const url = `src="data:image/svg+xml;base64,${Buffer.from(HOSTILE_ICON).toString('base64')}"`;
    assert.equal(count(section, url), 2, mode);
    assert.equal(count(section, '<img'), 2, mode);
  }
});

test('the living page embeds icons as pictures only, and leaves out one that is not an SVG or too large, saying so', async (t) => {
  const rig = await setupRepo(t);
  const json = JSON.parse(SYSTEM_JSON) as Record<string, unknown>;
  await rig.tmp.write('shop/design-system/assets/icons/hostile.svg', HOSTILE_ICON);
  await rig.tmp.write('shop/design-system/assets/icons/huge.svg', `<svg xmlns="http://www.w3.org/2000/svg"><desc>${'x'.repeat(ICON_DRAWN_MAX_BYTES)}</desc></svg>`);
  await rig.tmp.write('shop/design-system/system.json', `${JSON.stringify({ ...json, icons: listed('hostile', 'huge') })}\n`);
  const id = await rig.repoSystem();
  t.after(() => livingPagesIdle(rig.ctx));
  assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
  await livingPagesIdle(rig.ctx);
  const chamber = path.join(await rig.systems.dir(id), '.chamber');
  const html = await readFile(path.join(chamber, 'living-page.html'), 'utf8');
  assert.deepEqual(scanLivingPage(html).reasons, []);
  for (const mark of ['ICONMARK', 'ICONSCRIPT', 'ICONLOAD']) assert.ok(!html.includes(mark), mark);
  assert.equal(count(html, `data:image/svg+xml;base64,${Buffer.from(HOSTILE_ICON).toString('base64')}`), 2);
  assert.ok(html.includes('This icon file can&#39;t be drawn.'));
  const record = parseLivingRecord(await readFile(path.join(chamber, 'living-page.json'), 'utf8'));
  assert.deepEqual(record?.omitted.filter((item) => item.what === 'icon'), [{ what: 'icon', name: 'huge.svg', reason: 'too-large' }]);
});

test('a file that is not an SVG, or one over the drawn size, is never named in an <img>; the cap is exact', async () => {
  const sized = (bytes: number): string => {
    const [head, tail] = ['<svg xmlns="http://www.w3.org/2000/svg"><desc>', '</desc></svg>'];
    return `${head}${'x'.repeat(bytes - head.length - tail.length)}${tail}`;
  };
  const detail = detailOf({ icons: listed('page', 'at', 'over') }, filesOf('page', 'at', 'over'));
  const source = memorySource({ 'assets/icons/page.svg': '<html><script>1</script></html>', 'assets/icons/at.svg': sized(ICON_DRAWN_MAX_BYTES), 'assets/icons/over.svg': sized(ICON_DRAWN_MAX_BYTES + 1) });
  const { html } = await assembleBoardHtml(detail, source, 'light');
  assert.ok(html.includes('src="assets/icons/at.svg"'));
  assert.ok(!html.includes('src="assets/icons/over.svg"'));
  assert.ok(!html.includes('src="assets/icons/page.svg"'));
  assert.equal(count(html, 'This icon file can&#39;t be drawn.'), 2);
});

// ---- the grid ----

test('each icon draws at each --icon-* size on light and dark; stroke and colour tokens are not sizes', () => {
  const tokens = ':root {\n  --icon-sm: 16px;\n  --icon-md: 20px;\n  --icon-stroke: 1.5px;\n  --icon-muted: #777777;\n  --icon-bad: url(x);\n}\n';
  const detail = detailOf({ icons: [{ file: 'assets/icons/add.svg', name: 'Add <b>', note: 'For "new".' }] }, filesOf('add'), tokens);
  const html = assetsSection(detail);
  assert.equal(count(html, '<img'), 4);
  assert.equal(count(html, 'width: var(--icon-sm)'), 2);
  assert.equal(count(html, 'height: var(--icon-md)'), 2);
  assert.ok(!html.includes('var(--icon-stroke)') && !html.includes('var(--icon-muted)') && !html.includes('var(--icon-bad)'));
  assert.ok(html.includes('class="dc-ground dc-light"') && html.includes('class="dc-ground dc-dark"'));
  assert.ok(html.includes('Shown at --icon-sm, --icon-md.'));
  assert.ok(html.includes('alt="Add &lt;b&gt;"') && !html.includes('Add <b>'));
  assert.ok(html.includes('data-dc-entry="icon:0"'));
  assert.equal(iconCopies(detail), 4);
});

test('without size tokens an icon draws once at 24px per ground; past four sizes the rest are named as left out', () => {
  const none = detailOf({ icons: listed('add') }, filesOf('add'));
  const html = assetsSection(none);
  assert.equal(count(html, '<img'), 2);
  assert.equal(count(html, 'width: 24px'), 2);
  assert.equal(iconCopies(none), 2);

  const many = detailOf({ icons: listed('add') }, filesOf('add'), `:root {\n${[1, 2, 3, 4, 5].map((n) => `  --icon-${n}: ${n * 4}px;`).join('\n')}\n}\n`);
  assert.equal(ICON_SIZES_SHOWN, 4);
  assert.equal(count(assetsSection(many), '<img'), 8);
  assert.ok(assetsSection(many).includes('Shown at the first 4 of 5 icon sizes'));
  assert.equal(iconCopies(many), 8);
});

test('a system without icons keeps its Assets section as it was', () => {
  const html = assetsSection(detailOf({}));
  assert.ok(!html.includes('Icons') && !html.includes('<img'));
});

// ---- the reader ----

test('icons read from system.json: a missing name is the file name; bad entries are problems on that entry only', () => {
  const detail = detailOf(
    {
      icons: [
        { file: 'assets/icons/arrow-left.svg' },
        { file: 'assets/icons/add.svg', name: 'Add', note: 'New things.' },
        { file: 'assets/icons/add.svg', name: 'Again' },
        { file: 'assets/icons/gone.svg' },
        { file: 'assets/icons/photo.png' },
        { file: 'assets/logos/mark.svg' },
        { file: 'assets/icons/../logos/mark.svg' },
        { file: 'assets/icons\\add.svg' },
        { file: 'assets/icons/named.svg', name: 'x'.repeat(61) },
        'assets/icons/add.svg',
      ],
    },
    [...filesOf('arrow-left', 'add', 'named'), 'assets/icons/photo.png', 'assets/logos/mark.svg'],
  );
  assert.deepEqual(detail.icons, [
    { file: 'assets/icons/arrow-left.svg', name: 'arrow-left', note: '' },
    { file: 'assets/icons/add.svg', name: 'Add', note: 'New things.' },
  ]);
  assert.deepEqual(detail.problems.map((problem) => problem.entry), [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `icons[${n}]`));
  assert.equal(detail.problems[0]?.message, 'This icon is listed twice.');
  assert.equal(detail.problems[2]?.message, 'An icon file must be an SVG in assets/icons/.');
  assert.equal(detail.empty, false);
  assert.equal(detailOf({ icons: 'add' }).problems[0]?.entry, 'icons');
  assert.deepEqual(detailOf({}).icons, []);
});

test(`icons past ${SYSTEM_ICONS_MAX} are one problem with the true count`, () => {
  const names = Array.from({ length: SYSTEM_ICONS_MAX + 7 }, (_, n) => `i${n}`);
  assert.equal(SYSTEM_ICONS_MAX, 150);
  const detail = detailOf({ icons: listed(...names) }, filesOf(...names));
  assert.equal(detail.icons.length, 150);
  assert.deepEqual(detail.problems, [{ entry: 'icons', message: "Design systems hold up to 150 icons. 7 more weren't read." }]);
  assert.deepEqual(detailOf({ icons: listed(...names.slice(0, 150)) }, filesOf(...names)).problems, []);
});

test('icons are reviewed with the logos: a changed icon changes only the brand fingerprint', () => {
  const json = { icons: listed('add') };
  const before = detailOf(json, filesOf('add'), ':root {\n}\n');
  const a = sectionFingerprints(before, { 'assets/icons/add.svg': 'a'.repeat(64) });
  const b = sectionFingerprints(before, { 'assets/icons/add.svg': 'b'.repeat(64) });
  assert.deepEqual(SYSTEM_SECTIONS.filter((section) => a[section] !== b[section]), ['brand']);
  const renamed = sectionFingerprints(detailOf({ icons: [{ file: 'assets/icons/add.svg', name: 'Plus' }] }, filesOf('add')), { 'assets/icons/add.svg': 'a'.repeat(64) });
  assert.deepEqual(SYSTEM_SECTIONS.filter((section) => a[section] !== renamed[section]), ['brand']);
  // A system without icons keeps the brand fingerprint it had before icons existed.
  assert.equal(sectionFingerprints(detailOf({})).brand, sha256Hex('{"entries":[],"logos":[]}'));
});

test('an icon is a board entry, drawn in Assets', () => {
  const detail = detailOf({ icons: listed('add') }, filesOf('add'));
  assert.ok(isBoardEntryKey('icon:0'));
  assert.ok(!isBoardEntryKey('icon:add'));
  const key = parseEntryKey('icon:0');
  assert.deepEqual(key, { kind: 'icon', key: '0' });
  assert.equal(sectionOfEntry({ kind: 'icon', key: '0' }, detail), 'assets');
  assert.equal(sectionOfEntry({ kind: 'icon', key: '1' }, detail), null);
});

// ---- files: kinds, caps, snapshot, copy, export ----

test('assets/icons/ takes SVG only, by name and by content, and is part of the contract', () => {
  const svg = Buffer.from(icon(), 'utf8');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.deepEqual(FOLDER_OF_KIND.icon, ['assets', 'icons']);
  assert.deepEqual(checkAsset('add.svg', 'icon', svg), { ok: true, group: 'image', kind: 'icon' });
  assert.deepEqual(checkAsset('add.png', 'icon', png), { ok: false, reason: "add.png isn't an SVG icon." });
  assert.deepEqual(checkAsset('add.svg', 'icon', png), { ok: false, reason: "add.svg isn't a real SVG file." });
  assert.ok(isSystemContractRel('assets/icons/add.svg'));
  for (const rel of ['assets/icons/add.png', 'assets/icons/sub/add.svg', 'assets/icons/../add.svg', 'assets/icons/.add.svg']) assert.ok(!isSystemContractRel(rel), rel);
});

test(`a repo system with ${SYSTEM_FILES_MAX} files is read whole and one more is refused; a bad icon is skipped with its reason`, async (t) => {
  const tmp = await createTmpRoot('dc-icons-');
  t.after(() => tmp.cleanup());
  const folder = path.join(tmp.root, 'design-system', 'assets', 'icons');
  await mkdir(folder, { recursive: true });
  assert.equal(SYSTEM_FILES_MAX, 400);
  for (let n = 0; n < SYSTEM_FILES_MAX - 1; n += 1) await writeFile(path.join(folder, `i${n}.svg`), icon());
  await writeFile(path.join(folder, 'bad.svg'), 'not an svg');
  const input = { directory: tmp.root, folder: 'design-system', livingPage: 'design-system/index.html' };
  const full = await readRepoSystem(input);
  assert.equal(full.kind, 'read');
  if (full.kind !== 'read') return;
  assert.equal(full.files.size, 399);
  assert.deepEqual(full.skipped, [{ path: 'assets/icons/bad.svg', reason: "bad.svg isn't a real SVG file." }]);

  await writeFile(path.join(folder, 'one-more.svg'), icon());
  assert.deepEqual(await readRepoSystem(input), { kind: 'problem', reason: 'too-large' });
});

test('a copy carries the listed icons only, as files a page uses, and a ZIP keeps the ones it references', () => {
  const files = [...filesOf('add', 'unlisted'), 'system.json'];
  const detail = detailOf({ icons: listed('add') }, files);
  const plan = planCopy(files, detail);
  assert.deepEqual(plan.entries.filter((entry) => entry.to.startsWith('icons/')), [{ to: 'icons/add.svg', from: 'assets/icons/add.svg' }]);
  assert.equal(isCopyReference('icons/add.svg'), false);
  assert.equal(exportIncludes('system/icons/add.svg', new Set(['system/icons/add.svg'])), true);
  assert.equal(exportIncludes('system/icons/add.svg', null), true);
  assert.equal(exportIncludes('system/icons/other.svg', new Set(['system/icons/add.svg'])), false);
});

// ---- system-icons-mixed ----

const findingsOf = (icons: Record<string, string>, json: Record<string, unknown> = {}) => {
  const names = Object.keys(icons);
  const detail = detailOf({ icons: listed(...names), ...json }, filesOf(...names));
  const texts = Object.fromEntries(names.map((name) => [`assets/icons/${name}.svg`, icons[name] ?? '']));
  return systemFindings({ texts: {}, icons: texts }, detail).filter((finding) => finding.code === 'system-icons-mixed');
};

test('system-icons-mixed: one viewBox size and one stroke width is a set; a second of either is a note', () => {
  assert.deepEqual(findingsOf({ a: icon(), b: icon('2 2 24 24', '2.0') }), [], 'the same size from another origin, 2 and 2.0');
  const box = findingsOf({ a: icon(), b: icon('0 0 16 16') });
  assert.deepEqual(box, [{ code: 'system-icons-mixed', file: 'system.json', screen: null, viewport: null, detail: 'viewBox 24x24, 16x16' }]);
  assert.equal(findingsOf({ a: icon(), b: icon('0 0 24 24', '1.5') })[0]?.detail, 'stroke-width 2, 1.5');
  assert.equal(findingsOf({ a: icon(), b: '<svg viewBox="0 0 24 24"><path style="stroke-width: 1px"/></svg>' })[0]?.detail, 'stroke-width 2, 1');
  assert.deepEqual(findingsOf({ a: icon(), filled: '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>' }), [], 'a filled icon has no stroke');
  const [first] = box;
  assert.ok(first !== undefined);
  assert.equal(severityOf(first.code, first.params), 'info');
  assert.equal(findingMessage(first), 'The icons mix viewBox sizes or stroke widths, so they may not look like one set.');
  assert.deepEqual(findingsOf({ a: icon(), b: icon('0 0 16 16') }, { coverage: ['components'] }), [], 'an uncovered area says nothing');
});

test('the icon scan reads the root viewBox, skips comments and other attributes, and stays quick on hostile text', () => {
  assert.deepEqual(scanIcon('<?xml version="1.0"?><!-- <svg viewBox="0 0 1 1" stroke-width="9"> --><svg viewBox="0,0,32,32" data-stroke-width="7" stroke-width=".5"><symbol viewBox="0 0 8 8"/></svg>'), { viewBox: '32x32', strokes: [0.5] });
  assert.deepEqual(scanIcon('<svg viewBox="a b c d" stroke-width="var(--w)">'), { viewBox: null, strokes: [] });
  assert.deepEqual(scanIcon('<svg'), { viewBox: null, strokes: [] });
  const started = Date.now();
  for (const hostile of ['<svg '.repeat(6500), '<!--'.repeat(8000), `<svg stroke-width=${' '.repeat(32_000)}`, `stroke-width${' '.repeat(32_000)}`]) scanIcon(hostile);
  assert.ok(Date.now() - started < 2000);
});

test('the check reads each listed icon from the system folder; icons alone fill the brand area', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/system.json', { version: 1, icons: listed('a', 'b') });
  await tmp.write('_systems/acme/tokens.css', ':root {\n}\n');
  await tmp.write('_systems/acme/assets/icons/a.svg', icon());
  await tmp.write('_systems/acme/assets/icons/b.svg', icon('0 0 16 16'));
  const run = await runSystemCheck(cliSystemStore(tmp.root, { version: 1 } as SettingsFile), 'acme', { now: new Date(NOW), tool: 'cli' });
  assert.equal(run.report.static.findings.find((finding) => finding.code === 'system-icons-mixed')?.detail, 'viewBox 24x24, 16x16');
  assert.equal(areaEmpty(run.detail, 'brand'), false);
  assert.equal(areaEmpty(detailOf({}), 'brand'), true);
});
