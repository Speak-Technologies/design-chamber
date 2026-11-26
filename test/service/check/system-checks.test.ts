// Phase 2.5 T10 (documentation/specs/phase-2-5-technical.md §10): a design's token findings name its
// linked system, drift in the copy is found and overrides (tweaks included) are not, the system's own
// static findings, the CLI's --system target and arguments, the tool's `system` input, and the
// `GET /systems/:id/checks` route behind the token and the id gate.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { designSystemFindings, runStaticChecks, type DesignSystemInput } from '../../../src/service/check/static.ts';
import { exitCodeOf, formatSystemCheckText, parseArgs, systemFindingsOf } from '../../../src/service/check/report-text.ts';
import { cliSystemStore, runSystemCheck, writeSystemCheckReport } from '../../../src/service/check/system-run.ts';
import { CHECK_RUN_DEADLINE_MS, type RenderDeps } from '../../../src/service/check/render.ts';
import { systemCheckReport, systemFindings } from '../../../src/service/check/system-static.ts';
import { resolveSystemTarget } from '../../../src/service/check/target.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemChecksRoutes } from '../../../src/service/routes/system-checks.ts';
import { buildChildArgs, parseToolInput } from '../../../src/plugin/check-tool.ts';
import type { SystemChecksResponse } from '../../../src/shared/api.ts';
import { findingMessage, parseCheckReport } from '../../../src/shared/checks.ts';
import { buildSystemDetail, parseSystemState, type SystemDetailSource } from '../../../src/shared/system-json.ts';
import type { CheckFindingData, CopyRecord } from '../../../src/shared/types.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const GOOD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Home</title></head><body><p>Hi</p></body></html>';
const SYSTEM_TOKENS = ':root {\n  --brand: #0a5;\n  --ink: #111;\n  --space: 8px;\n}\n';
const AT = '2026-11-01T10:00:00.000Z';
const codesOf = (findings: readonly { code: string }[]): string[] => findings.map((finding) => finding.code).sort();

const designJson = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  kind: 'page',
  title: 'Demo',
  created: AT,
  updated: AT,
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
  screens: [],
  ...extra,
});

/** A Ready system "Acme" in the root and a design linked to it at revision 6, its copy as Design Chamber writes it. */
const linkedDesign = async (tmp: TmpRoot, files: Record<string, string> = {}, options: { status?: 'ready' | 'draft'; copyTokens?: string } = {}): Promise<string> => {
  await tmp.write('_systems/acme/tokens.css', SYSTEM_TOKENS);
  await tmp.write('_systems/acme/system.json', '{ "version": 1, "tokens": {} }\n');
  await tmp.write('_systems/acme/.chamber/state.json', { v: 1, id: 'acme', name: 'Acme', status: options.status ?? 'ready' });
  const copy = { 'tokens.css': SYSTEM_TOKENS, 'system.css': '@import "fonts.css";\n@import "tokens.css";\n', 'fonts.css': '' };
  const record: CopyRecord = {
    v: 1,
    id: 'acme',
    name: 'Acme old name',
    revision: 6,
    treeHash: sha('tree'),
    at: AT,
    by: 'user',
    before: null,
    files: Object.fromEntries(Object.entries(copy).map(([rel, text]) => [rel, sha(text)])),
  };
  return tmp.writeDesign('demo', {
    'design.json': designJson(),
    'index.html': GOOD,
    'system/tokens.css': options.copyTokens ?? copy['tokens.css'],
    'system/system.css': copy['system.css'],
    'system/fonts.css': copy['fonts.css'],
    'system/COPY.json': record,
    ...files,
  });
};

// ---- sentences ----

test('token sentences name the system when the finding carries it, and read as before without one', () => {
  const where = { file: 'screens/home.html', screen: null, viewport: null };
  assert.equal(
    findingMessage({ code: 'token-redefined', ...where, params: { count: 3, system: 'Acme' } }),
    "screens/home.html redefines 3 tokens from the design system Acme. Use the system's values, or ask the user to change the system.",
  );
  assert.equal(
    findingMessage({ code: 'token-hardcoded', ...where, params: { count: 7, system: 'Acme' } }),
    'screens/home.html has 7 hardcoded colours although the design system Acme defines colours. Use its tokens.',
  );
  assert.equal(findingMessage({ code: 'token-redefined', ...where, params: { count: 3 } }), 'screens/home.html redefines 3 tokens from tokens.css. Change them in tokens.css.');
  assert.equal(findingMessage({ code: 'token-hardcoded', ...where, params: { count: 7 } }), 'screens/home.html has 7 hardcoded colours although tokens.css defines colours.');
  const nowhere = { file: null, screen: null, viewport: null };
  assert.equal(
    findingMessage({ code: 'system-drift', ...nowhere, params: { system: 'Acme', count: 3, revision: 6 } }),
    "This design's copy of Acme was changed: 3 tokens differ from revision 6. Put them back, or keep them as this design's own overrides.",
  );
  assert.equal(
    findingMessage({ code: 'system-drift', ...nowhere, params: { system: 'Acme', count: 1, revision: 6, part: 'system-files' } }),
    "This design's copy of Acme was changed: 1 file differs from revision 6. Put them back, or keep the changes in this design's own tokens.css.",
  );
});

test('an older report (no system params, no new codes) reads and words exactly as before; unknown codes are dropped', () => {
  const report = parseCheckReport({
    version: 1,
    slug: 'demo',
    kind: 'page',
    createdAt: AT,
    tool: 'cli',
    static: { findings: [{ code: 'token-redefined', file: 'index.html', screen: null, viewport: null, params: { count: 2 }, detail: '--bg, --fg' }, { code: 'from-the-future', file: null, screen: null, viewport: null }] },
    render: null,
  });
  assert.ok(report !== null);
  assert.deepEqual(report.static.findings, [{ code: 'token-redefined', file: 'index.html', screen: null, viewport: null, params: { count: 2 }, detail: '--bg, --fg' }]);
  assert.equal(findingMessage(report.static.findings[0] as CheckFindingData), 'index.html redefines 2 tokens from tokens.css. Change them in tokens.css.');
});

// ---- the design against its copy (pure) ----

const record = (files: Record<string, string>): CopyRecord => ({ v: 1, id: 'acme', name: 'Acme', revision: 6, treeHash: sha('t'), at: AT, by: 'agent', before: null, files });
const baseInput = (over: Partial<DesignSystemInput>): DesignSystemInput => ({
  copy: { kind: 'absent' },
  linked: { state: 'unknown' },
  copyHashes: {},
  copyCss: null,
  originalCss: null,
  choice: null,
  ...over,
});

test('designSystemFindings: drift names tokens when the original is known, counts files when not; overrides are never drift', () => {
  const original = ':root { --a: 1px; --b: red; }';
  const changed = ':root { --a: 2px; --b: red; --c: 0; }';
  const files = { 'tokens.css': sha(original), 'system.css': sha('s') };
  const named = designSystemFindings(baseInput({ copy: { kind: 'ok', record: record(files) }, linked: { state: 'ready', name: 'Acme Now' }, copyHashes: { 'tokens.css': sha(changed), 'system.css': sha('s'), 'COPY.json': sha('c') }, copyCss: changed, originalCss: original }));
  assert.deepEqual(named, [{ code: 'system-drift', file: null, screen: null, viewport: null, params: { system: 'Acme Now', count: 2, revision: 6 }, detail: '--a, --c' }]);

  const unknown = designSystemFindings(baseInput({ copy: { kind: 'ok', record: record(files) }, copyHashes: { 'tokens.css': sha(changed), 'system.css': sha('s'), 'extra.css': sha('x') }, copyCss: changed }));
  assert.deepEqual(unknown.map((finding) => [finding.code, finding.params?.part, finding.params?.count, finding.params?.system, finding.detail]), [['system-drift', 'system-files', 2, 'Acme', 'extra.css, tokens.css']]);

  // An untouched copy: a design that overrides system tokens in its own tokens.css (a tweak does just that) has no drift.
  assert.deepEqual(designSystemFindings(baseInput({ copy: { kind: 'ok', record: record(files) }, copyHashes: { 'tokens.css': sha(original), 'system.css': sha('s') }, copyCss: original, originalCss: original })), []);
  // Only whitespace moved in tokens.css: the tokens are equal, so nothing to report.
  const spaced = ':root {\n  --a: 1px;\n  --b: red;\n}';
  assert.deepEqual(designSystemFindings(baseInput({ copy: { kind: 'ok', record: record(files) }, copyHashes: { 'tokens.css': sha(spaced), 'system.css': sha('s') }, copyCss: spaced, originalCss: original })), []);
});

test('designSystemFindings: missing files, an unreadable COPY.json and the agent choice', () => {
  const missing = designSystemFindings(baseInput({ copy: { kind: 'ok', record: record({ 'tokens.css': sha('t'), 'fonts.css': sha('f') }) }, copyHashes: { 'tokens.css': sha('t') } }));
  assert.deepEqual(missing.map((finding) => [finding.code, finding.params?.count, finding.detail]), [['system-copy-missing', 1, 'fonts.css']]);
  assert.deepEqual(codesOf(designSystemFindings(baseInput({ copy: { kind: 'invalid' } }))), ['system-copy-invalid']);
  const unknown = designSystemFindings(baseInput({ choice: { value: 'ghost', system: { state: 'unknown' } } }));
  assert.deepEqual(unknown, [{ code: 'system-choice', file: 'design.json', screen: null, viewport: null, params: { value: 'ghost', choice: 'unknown' } }]);
  assert.match(findingMessage(unknown[0] as CheckFindingData), /"ghost", which isn't a Ready system in this Designs folder\.$/);
  const draft = designSystemFindings(baseInput({ choice: { value: 'acme', system: { state: 'draft', name: 'Acme' } } }));
  assert.match(findingMessage(draft[0] as CheckFindingData), /"acme", which isn't ready yet\.$/);
  assert.deepEqual(designSystemFindings(baseInput({ choice: { value: 'acme', system: { state: 'ready', name: 'Acme' } } })), []);
  // Already linked to the system it asked for: no choice finding, whatever the system's state now.
  assert.deepEqual(designSystemFindings(baseInput({ copy: { kind: 'ok', record: record({}) }, linked: { state: 'draft', name: 'Acme' }, choice: { value: 'acme', system: { state: 'draft', name: 'Acme' } } })), []);
});

// ---- the design against its copy (files) ----

test('runStaticChecks: a linked design names its system in the token findings, and its own tweaks are overrides', async (t) => {
  const tmp = await useTmpRoot(t);
  const html = GOOD.replace('</head>', '<style>:root{--brand:#f00} p{color:#123;background:#456;border-color:#789}</style></head>');
  // The design's own tokens.css overrides --ink (what the Tweaks panel writes) and adds a token of its own.
  const dir = await linkedDesign(tmp, { 'index.html': html, 'tokens.css': ':root { --ink: #222; --mine: 4px; }\n' });
  const run = await runStaticChecks(dir, 10_000);
  const redefined = run.findings.find((finding) => finding.code === 'token-redefined');
  assert.deepEqual(redefined?.params, { count: 1, system: 'Acme' }, 'the current system name, not the one in COPY.json');
  assert.equal(redefined?.detail, '--brand');
  assert.deepEqual(run.findings.find((finding) => finding.code === 'token-hardcoded')?.params, { count: 3, system: 'Acme' });
  assert.ok(!codesOf(run.findings).some((code) => code.startsWith('system-')), codesOf(run.findings).join(','));
});

test('runStaticChecks: a token only the design defines is not blamed on the system; an unlinked design reads as before', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await linkedDesign(tmp, { 'index.html': GOOD.replace('</head>', '<style>:root{--mine:1px}</style></head>'), 'tokens.css': ':root { --mine: 4px; }\n' });
  assert.deepEqual((await runStaticChecks(dir, 10_000)).findings.find((finding) => finding.code === 'token-redefined')?.params, { count: 1 });
  const plain = await tmp.writeDesign('plain', { 'design.json': designJson(), 'index.html': GOOD.replace('</head>', '<style>:root{--bg:#000}</style></head>'), 'tokens.css': ':root{--bg:#fff}' });
  assert.deepEqual((await runStaticChecks(plain, 10_000)).findings, [{ code: 'token-redefined', file: 'index.html', screen: null, viewport: null, params: { count: 1 }, detail: '--bg' }]);
});

test('runStaticChecks: an edited copy is drift with the token names; a removed file is missing', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await linkedDesign(tmp, {}, { copyTokens: SYSTEM_TOKENS.replace('#0a5', '#f00').replace('8px', '10px') });
  const run = await runStaticChecks(dir, 10_000);
  const drift = run.findings.find((finding) => finding.code === 'system-drift');
  assert.deepEqual(drift?.params, { system: 'Acme', count: 2, revision: 6 });
  assert.equal(drift?.detail, '--brand, --space');

  const other = await useTmpRoot(t);
  const gone = await linkedDesign(other, {});
  await other.write('demo/system/fonts.css.removed', '');
  const { rm } = await import('node:fs/promises');
  await rm(other.at('demo/system/fonts.css'));
  const missing = await runStaticChecks(gone, 10_000);
  assert.deepEqual(missing.findings.filter((finding) => finding.code.startsWith('system-')).map((finding) => [finding.code, finding.detail]), [
    ['system-copy-missing', 'fonts.css'],
    ['system-drift', 'fonts.css.removed'],
  ]);
});

test('runStaticChecks: an unreadable COPY.json, a linked copy folder and an unknown choice', async (t) => {
  const tmp = await useTmpRoot(t);
  const broken = await tmp.writeDesign('broken', { 'design.json': designJson({ systemChoice: 'ghost' }), 'index.html': GOOD, 'system/COPY.json': '{ not json' });
  assert.deepEqual(codesOf((await runStaticChecks(broken, 10_000)).findings), ['system-choice', 'system-copy-invalid']);
  const linked = await tmp.writeDesign('linked', { 'design.json': designJson(), 'index.html': GOOD });
  await tmp.write('elsewhere/COPY.json', '{}');
  await symlink(tmp.at('elsewhere'), tmp.at('linked/system'), 'dir');
  assert.deepEqual(codesOf((await runStaticChecks(linked, 10_000)).findings), ['system-copy-invalid']);
  // A system folder reached through a link is not a system: the choice reads as unknown.
  await mkdir(tmp.at('_systems'), { recursive: true });
  await tmp.write('outside/real/.chamber/state.json', { name: 'Real', status: 'ready' });
  await symlink(tmp.at('outside/real'), tmp.at('_systems/real'), 'dir');
  const chooser = await tmp.writeDesign('chooser', { 'design.json': designJson({ systemChoice: 'real' }), 'index.html': GOOD });
  assert.deepEqual((await runStaticChecks(chooser, 10_000)).findings.map((finding) => finding.params?.choice), ['unknown']);
});

test('runStaticChecks: a draft system the agent chose', async (t) => {
  const tmp = await useTmpRoot(t);
  await linkedDesign(tmp, {}, { status: 'draft' });
  const chooser = await tmp.writeDesign('chooser', { 'design.json': designJson({ systemChoice: 'acme' }), 'index.html': GOOD });
  assert.deepEqual((await runStaticChecks(chooser, 10_000)).findings.map((finding) => [finding.code, finding.params?.choice]), [['system-choice', 'draft']]);
});

// ---- a system's own findings ----

const source = (over: Partial<SystemDetailSource>): SystemDetailSource => ({
  id: 'acme',
  dir: '/d/_systems/acme',
  state: { ...parseSystemState(null, 'acme', AT), name: 'Acme' },
  systemJson: '{ "version": 1, "tokens": {} }',
  tokensCss: SYSTEM_TOKENS,
  texts: { 'OVERVIEW.md': 'Calm and clear.' },
  files: [],
  build: null,
  ...over,
});
const findingsOf = (over: Partial<SystemDetailSource>): CheckFindingData[] => {
  const input = source(over);
  return systemFindings(input, buildSystemDetail(input));
};

test('systemFindings: a sound system has none; each problem has its code and severity', () => {
  assert.deepEqual(findingsOf({}), []);
  assert.deepEqual(codesOf(findingsOf({ systemJson: '{ nope' })), ['system-unreadable']);
  assert.deepEqual(codesOf(findingsOf({ texts: {} })), ['system-overview-empty']);
  assert.deepEqual(codesOf(findingsOf({ texts: { 'OVERVIEW.md': 'x'.repeat(4001) } })), ['system-overview-long']);
  const note = findingsOf({ systemJson: JSON.stringify({ version: 1, notes: [{ id: 'a', title: 'A' }] }), texts: { 'OVERVIEW.md': 'ok', 'notes/a.md': 'x'.repeat(20_001) }, files: [{ rel: 'notes/a.md', bytes: 20_001 }] });
  assert.deepEqual(note.map((finding) => [finding.code, finding.file]), [['system-note-long', 'notes/a.md']]);

  const font = findingsOf({ systemJson: JSON.stringify({ version: 1, fonts: [{ file: 'assets/fonts/Inter.woff2', family: 'Inter' }] }) });
  assert.deepEqual(font.map((finding) => [finding.code, finding.file]), [['system-font-missing', 'assets/fonts/Inter.woff2']]);
  assert.equal(findingMessage(font[0] as CheckFindingData), "assets/fonts/Inter.woff2 is listed as a font but is missing or can't be used.");

  const entries = findingsOf({ systemJson: JSON.stringify({ version: 1, components: [{ id: 'Bad Id' }, { id: 'card', name: 'Card', tokens: ['--brand', '--nope'] }] }) });
  assert.deepEqual(entries.map((finding) => [finding.code, finding.detail]), [['system-entry-invalid', 'components.Bad Id'], ['system-token-undefined', 'card: --nope']]);

  const values = findingsOf({ tokensCss: ':root { --brand: notacolour(1); --space: 8px; }' });
  assert.ok(values.some((finding) => finding.code === 'system-value-invalid' && finding.detail === '--brand'), JSON.stringify(values));
});

test('systemFindings: ignored layout hints are one warning with the true count and up to three names, whatever the coverage', () => {
  const json = JSON.stringify({
    version: 1,
    coverage: ['components'],
    layout: { typography: 'card', colours: 'full' },
    components: [
      { id: 'a', name: 'A', layout: 'wide' },
      { id: 'b', name: 'B', layout: 'huge' },
      { id: 'c', name: 'C', layout: 3 },
      { id: 'd', name: 'D', layout: 'full' },
    ],
  });
  const findings = findingsOf({ systemJson: json, texts: {} });
  const layout = findings.filter((finding) => finding.code === 'system-layout-invalid');
  assert.equal(layout.length, 1);
  assert.equal(layout[0]?.params?.count, 5, 'two section defaults and three entry hints');
  assert.equal(layout[0]?.params?.misplaced, 2, 'typography: card and colours: full are known layouts in the wrong place');
  // Each one says what its place takes, so the agent knows what to write instead.
  assert.equal(
    layout[0]?.detail,
    'layout.typography: card (typography takes no layout); layout.colours: full (takes card, compact or table); components.a: wide (takes card, compact, full or table)',
  );
  assert.equal(layout[0]?.file, 'system.json');
  assert.equal(
    findingMessage(layout[0] as CheckFindingData),
    "system.json asks for 5 board layouts it can't use (3 Design Chamber doesn't know, 2 in places that don't take them), so those entries use the default. Each one listed says what its place takes.",
  );
  // The entries themselves are fine: no system-entry-invalid for the hints.
  assert.ok(!findings.some((finding) => finding.code === 'system-entry-invalid'));
  // A sound hint raises nothing.
  assert.deepEqual(findingsOf({ systemJson: JSON.stringify({ version: 1, layout: { components: 'compact' }, components: [{ id: 'a', name: 'A', layout: 'full' }] }), texts: { 'OVERVIEW.md': 'ok' } }), []);
});

test('systemFindings respects coverage: an uncovered area raises nothing', () => {
  const uncovered = { systemJson: JSON.stringify({ version: 1, coverage: ['components'], components: [{ id: 'card', name: 'Card', tokens: ['--nope'] }] }), texts: {} };
  assert.deepEqual(codesOf(findingsOf(uncovered)), ['system-token-undefined'], 'no overview finding when Foundations is not covered');
  const noComponents = { systemJson: JSON.stringify({ version: 1, coverage: ['foundations'], components: [{ id: 'card', name: 'Card', tokens: ['--nope'] }] }) };
  assert.deepEqual(findingsOf(noComponents), []);
});

// ---- the CLI's target and arguments, the tool's input ----

test('resolveSystemTarget: only a real folder in <root>/_systems, by id', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/tokens.css', '');
  await tmp.write('outside/evil/tokens.css', '');
  await symlink(tmp.at('outside/evil'), tmp.at('_systems/evil'), 'dir');
  await tmp.write('_systems/file', 'x');
  const deps = { path, realpath, platform: process.platform, isRealDirectory: async (dir: string) => (await import('node:fs/promises')).lstat(dir).then((info) => info.isDirectory(), () => false) };
  const ok = await resolveSystemTarget({ id: 'acme', root: tmp.root }, deps);
  assert.deepEqual(ok, { ok: true, id: 'acme', dir: tmp.at('_systems/acme'), root: tmp.root });
  for (const id of ['evil', 'file', 'ghost', 'none', 'ask', '../acme', 'Acme', '_systems', '']) {
    const refused = await resolveSystemTarget({ id, root: tmp.root }, deps);
    assert.deepEqual(refused, { ok: false, message: `That is not a design system in ${tmp.root}.` }, id);
  }
});

test('parseArgs: --system checks a system, --static means files only; it does not mix with a design or screens', () => {
  assert.deepEqual(parseArgs(['check', '--system', 'acme']), { kind: 'check-system', root: null, system: 'acme', staticOnly: false, json: false });
  assert.deepEqual(parseArgs(['--root', '/d', 'check', '--system=acme', '--json', '--static']), { kind: 'check-system', root: '/d', system: 'acme', staticOnly: true, json: true });
  for (const args of [['check', '--system'], ['check', '--system', '../x'], ['check', 'demo', '--system', 'acme'], ['check', '--system', 'acme', '--screen', 'home'], ['check', '--system', 'a', '--system', 'b']]) {
    assert.equal(parseArgs(args).kind, 'error', args.join(' '));
  }
});

test('parseToolInput: system is an id, never with design or screens; the child gets --system', () => {
  assert.deepEqual(parseToolInput({ system: 'acme' }), { ok: true, system: 'acme', static: false });
  assert.deepEqual(parseToolInput({ system: 'acme', static: true }), { ok: true, system: 'acme', static: true });
  for (const input of [{ system: '../acme' }, { system: 'C:\\x' }, { system: 'none' }, { system: 7 }, { system: 'acme', design: 'demo' }, { system: 'acme', screens: ['home'] }]) {
    assert.equal(parseToolInput(input).ok, false, JSON.stringify(input));
  }
  assert.deepEqual(buildChildArgs('/x/dc.mjs', { system: 'acme', static: false }), ['/x/dc.mjs', 'check', '--system', 'acme']);
  assert.deepEqual(parseToolInput({ design: 'pricing' }), { ok: true, design: 'pricing', screens: [], static: false });
});

test('runSystemCheck with the CLI store reads the system, and the report lands in its .chamber', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/tokens.css', SYSTEM_TOKENS);
  await tmp.write('_systems/acme/system.json', '{ nope');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready' });
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const { report, detail } = await runSystemCheck(store, 'acme', { now: new Date(AT), tool: 'cli' });
    assert.equal(detail.name, 'Acme');
    assert.deepEqual(report, { version: 1, system: 'acme', createdAt: AT, tool: 'cli', static: { findings: [{ code: 'system-unreadable', file: null, screen: null, viewport: null }] }, render: null });
    const written = await writeSystemCheckReport(tmp.at('_systems/acme'), report);
    assert.equal(written, tmp.at('_systems/acme/.chamber/check.json'));
    assert.deepEqual(JSON.parse(await tmp.read('_systems/acme/.chamber/check.json')), report);
  } finally {
    await store.dispose();
  }
});

test('runSystemCheck with no browser: the render is unavailable with the note, the report is written, the exit follows the files', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/tokens.css', SYSTEM_TOKENS);
  await tmp.write('_systems/acme/system.json', '{ "version": 1, "tokens": {} }');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready' });
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const result = await runSystemCheck(store, 'acme', {
      now: new Date(AT),
      tool: 'cli',
      render: { browserPath: null, probeSource: '', platform: process.platform, isRoot: false },
    });
    assert.equal(result.report.render?.state, 'unavailable');
    assert.equal(result.report.render?.browser, null);
    assert.deepEqual(result.report.render?.findings.map((finding) => finding.code), ['browser-missing']);
    assert.deepEqual(result.report.render?.drawn, { from: 'system', proposal: null });
    assert.deepEqual(result.pngs, []);
    assert.equal(result.reportPath, tmp.at('_systems/acme/.chamber/check.json'));
    const text = formatSystemCheckText({ report: result.report, name: 'Acme', reportPath: result.reportPath });
    assert.match(text, /No Chrome, Edge or Chromium was found, so the board wasn't drawn\. Only the files were checked\./);
    // The exit follows the static findings: a warning only is 0.
    assert.equal(exitCodeOf(systemFindingsOf(result.report)), 0);
  } finally {
    await store.dispose();
  }
});

test('runSystemCheck: the run deadline starts at entry and reaches the render loop with the abort signal', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/tokens.css', SYSTEM_TOKENS);
  await tmp.write('_systems/acme/system.json', '{ "version": 1, "tokens": {} }');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready' });
  const store = cliSystemStore(tmp.root, { version: 1 });
  const entryAt = 1_800_000_000_000;
  // Every read of the clock moves it on, so anything after entry sees a later time than the run's first read.
  let reads = 0;
  t.mock.method(Date, 'now', () => entryAt + 1000 * reads++);
  const controller = new AbortController();
  let seen: RenderDeps | null = null;
  try {
    await runSystemCheck(store, 'acme', {
      now: new Date(AT),
      tool: 'cli',
      render: {
        browserPath: '/never-started',
        probeSource: '',
        platform: process.platform,
        isRoot: false,
        signal: controller.signal,
        renderLoop: (deps) => {
          seen = deps;
          return Promise.resolve({ artboards: [], findings: [], notRendered: deps.plan.length, stoppedBy: 'budget', unavailable: false });
        },
      },
    });
  } finally {
    await store.dispose();
  }
  assert.ok(seen !== null, 'the run called the render loop');
  const deps = seen as RenderDeps;
  assert.equal(deps.deadlineAt, entryAt + CHECK_RUN_DEADLINE_MS);
  assert.equal(deps.signal, controller.signal);
});

test('the board pictures block: the run folder once, an overview and the full-size pictures per area, the picture on each finding', () => {
  const run = '.chamber/check/r-20261126101500-a1b2c3';
  const tiles = (area: string, width: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({ png: `${run}/${area}@${width}${index === 0 ? '' : `-${index + 1}`}.png`, y: index * 900, height: 900 }));
  const report = systemCheckReport({
    id: 'acme',
    findings: [],
    now: new Date(AT),
    tool: 'cli',
    render: {
      state: 'done',
      browser: 'chrome',
      drawn: { from: 'system', proposal: null },
      widths: [],
      shots: [
        { width: 'wide', area: 'foundations', heightPx: 2700, overview: { png: `${run}/foundations-overview@wide.png`, scale: 0.5, coversPx: 2700 }, tiles: tiles('foundations', 'wide', 3) },
        // Over the budget: only some tiles, so each is named and the overview is pointed at.
        { width: 'wide', area: 'components', heightPx: 2700, overview: { png: `${run}/components-overview@wide.png`, scale: 0.4, coversPx: 2000 }, tiles: [tiles('components', 'wide', 3)[2] as { png: string; y: number; height: number }] },
        { width: 'narrow', area: 'foundations', heightPx: 400, overview: null, tiles: tiles('foundations', 'narrow', 1) },
      ],
      entryShots: [{ width: 'wide', entry: 'component:table', pngs: [`${run}/components@wide-3.png`] }],
      findings: [
        { code: 'system-board-preview-wide', file: 'components/table.html', screen: null, viewport: 'wide', params: { px: 1800, width: 1396 }, detail: 'component:table' },
        { code: 'system-board-text-outside', file: 'board.html', screen: null, viewport: 'narrow', params: { px: 4 }, detail: 'token:--brand' },
      ],
    },
  });
  const text = formatSystemCheckText({ report, name: 'Acme', reportPath: null, runDir: '/d/_systems/acme/.chamber/check/r-20261126101500-a1b2c3' });
  assert.ok(text.includes('Board pictures (light scheme) in /d/_systems/acme/.chamber/check/r-20261126101500-a1b2c3. Open them and look before you say you are done.'));
  assert.ok(text.includes('  Wide board 1526px:\n    Foundations, 2700px tall: overview foundations-overview@wide.png (50%); full size foundations@wide.png to foundations@wide-3.png\n'));
  assert.ok(text.includes('    Components, 2700px tall: overview components-overview@wide.png (40%, its first 2000px); full size components@wide-3.png (the rest of the area only in its overview)'));
  assert.ok(text.includes('  Narrow board 1046px:\n    Foundations, 400px tall: no overview; full size foundations@narrow.png'));
  // The folder is printed once; pictures are named inside it.
  assert.equal(text.split('/d/_systems/acme/.chamber/check/').length - 1, 1);
  // A finding about an entry names the full-size picture that shows it; one without a picture says nothing more.
  assert.match(text, /this example is 1800px wide but the board can give it 1396px, so it scrolls sideways in its card\. "component:table" Picture: components@wide-3\.png\./);
  assert.match(text, /text runs 4px outside its card\. "token:--brand"\n/);
});

// ---- the route ----

const TOKEN = 'system-checks-token-0123456789';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemChecksRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (url: string, token: string | null = TOKEN) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };
  return { tmp, call };
};

test('GET /systems/:id/checks: 401 without the token, 400 for a traversal or bad id, 404 for a missing system', async (t) => {
  const { call } = await serve(t);
  for (const token of [null, 'wrong-token']) assert.equal((await call('/systems/acme/checks', token)).status, 401);
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b', 'Acme', '_systems']) assert.equal((await call(`/systems/${hostile}/checks`)).status, 400, hostile);
  assert.equal((await call('/systems/ghost/checks')).status, 404);
});

test('GET /systems/:id/checks answers the findings with severity, sentence and counts, and writes nothing', async (t) => {
  const { tmp, call } = await serve(t);
  await tmp.write('_systems/acme/tokens.css', SYSTEM_TOKENS);
  await tmp.write('_systems/acme/system.json', JSON.stringify({ version: 1, components: [{ id: 'card', name: 'Card', tokens: ['--nope'] }] }));
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready' });
  const answer = await call('/systems/acme/checks');
  assert.equal(answer.status, 200);
  const body = answer.json as SystemChecksResponse;
  assert.deepEqual(body.findings.map((finding) => [finding.code, finding.severity]), [['system-overview-empty', 'warning'], ['system-token-undefined', 'warning']]);
  assert.equal(body.findings[1]?.message, "A component names a token the system doesn't define.");
  assert.deepEqual(body.counts, { errors: 0, warnings: 2, notes: 0 });
  assert.equal(await tmp.read('_systems/acme/.chamber/check.json').catch(() => null), null);
});
