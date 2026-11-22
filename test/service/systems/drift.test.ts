// The code drift and scan.json (documentation/specs/phase-2-5-technical.md §5.12, §5.13, §7.4, AD-18):
// only CSS variables and token JSON are counted, the system's own repo folder and the designs root are
// left out, every sentence names that scope, `unread` holds at most 20 paths, BUILD.json's own drift
// is never added in, and scan.json keeps its caps and the 2 MiB bound.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { findingMessage } from '../../../src/shared/checks.ts';
import { SCAN_JSON_MAX_BYTES, SYSTEM_TOKENS_MAX } from '../../../src/shared/limits.ts';
import type { CheckFindingData } from '../../../src/shared/types.ts';
import { ApiError } from '../../../src/service/http.ts';
import { codeDrift, normaliseValue, recomputeDrift, runBuildScan, SCAN_JSON_SCHEMA, scanJsonOf, type ScanJson } from '../../../src/service/systems/drift.ts';
import type { ScanResult } from '../../../src/service/systems/extract.ts';
import { refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { guardSystemWrite, WRITE_OUTSIDE_ROOT_MESSAGE } from '../../../src/service/systems/store.ts';
import { setupRepo, type RepoRig } from './repo-fixture.ts';

const buildJson = (rig: RepoRig, over: Record<string, unknown> = {}): string =>
  `${JSON.stringify(
    {
      version: 1,
      ticket: null,
      name: 'Acme',
      home: 'repo',
      repo: { directory: rig.project, folder: 'design-system', livingPage: 'design-system/index.html' },
      code: { directory: rig.project },
      mode: 'fix',
      dark: true,
      calls: [],
      access: null,
      round: 'done',
      applied: null,
      proposal: null,
      drift: { differ: 7, kinds: ['tailwind-config'], note: 'The Tailwind theme sets seven colours its own way.' },
      ...over,
    },
    null,
    2,
  )}\n`;

/** A repo-home system read once, with BUILD.json (mode fix) and the project as its code folder. */
const builtSystem = async (rig: RepoRig, over: Record<string, unknown> = {}): Promise<string> => {
  const id = await rig.repoSystem();
  assert.equal((await refreshSnapshot(rig.ctx, id, { by: 'agent' })).kind, 'refreshed');
  await writeFile(path.join(await rig.systems.dir(id), 'BUILD.json'), buildJson(rig, over));
  await rig.systems.withLock(id, () =>
    rig.systems.updateStateLocked(id, (state) => ({ ...state, sources: { ...state.sources, code: { directory: rig.project, lastScan: '2026-11-20T09:00:00.000Z', partial: false, scanned: [] } } })),
  );
  return id;
};

const finding = (code: CheckFindingData['code'], params: CheckFindingData['params']): CheckFindingData => ({ code, file: null, screen: null, viewport: null, params });

test('values are compared trimmed with hex lower-cased', () => {
  assert.equal(normaliseValue('  #1A73E8 '), '#1a73e8');
  assert.equal(normaliseValue('rgb(0 0 0)'), 'rgb(0 0 0)');
  assert.equal(normaliseValue('1px solid #ABC'), '1px solid #abc');
});

test('a name counts only when the code sets it differently; missing names and one-sided modes are not counted', () => {
  const system = [
    { name: '--a', light: '#FFF', dark: '#000' },
    { name: '--b', light: '8px', dark: null },
    { name: '--c', light: '1px', dark: null },
    { name: '--d', light: 'red', dark: 'blue' },
    { name: '--e', light: null, dark: 'black' },
  ];
  const code = [
    { name: '--a', light: ' #fff', dark: null },
    { name: '--b', light: '9px', dark: '1px' },
    { name: '--d', light: 'red', dark: 'navy' },
    { name: '--e', light: 'white', dark: null },
    { name: '--z', light: 'only in code', dark: null },
  ];
  assert.deepEqual(codeDrift(system, code), { differ: 2, names: ['--b', '--d'] });

  const many = Array.from({ length: 25 }, (_, n) => ({ name: `--t${n}`, light: '1px', dark: null }));
  const counted = codeDrift(
    many,
    many.map((token) => ({ ...token, light: '2px' })),
  );
  assert.equal(counted.differ, 25);
  assert.equal(counted.names.length, 20, 'at most 20 names are kept');
});

test('the count leaves out the system folder and the designs root, lists unread files, and keeps the agent number apart', async (t) => {
  const rig = await setupRepo(t, { rootInsideProject: true });
  const id = await builtSystem(rig);
  // Outside the system folder, only --space-2 is set, and differently.
  await writeFile(rig.repo('src/theme.css'), ':root {\n  --space-2: 9px;\n}\n');
  // Inside the excluded folders, --brand-500 differs: it would count if either were read.
  await writeFile(rig.repo('design-system/extra.css'), ':root {\n  --brand-500: #000000;\n}\n');
  await mkdir(path.join(rig.root, 'other'), { recursive: true });
  await writeFile(path.join(rig.root, 'other', 'style.css'), ':root {\n  --brand-500: #ff0000;\n}\n');
  await writeFile(rig.repo('tailwind.config.js'), 'module.exports = { theme: {} };\n');

  await recomputeDrift(rig.ctx, id);
  const state = await rig.systems.readState(id);
  assert.equal(state.codeDrift?.mode, 'fix');
  assert.equal(state.codeDrift?.differ, 1);
  assert.deepEqual(state.codeDrift?.names, ['--space-2']);
  assert.deepEqual(state.codeDrift?.unread, ['tailwind.config.js']);
  // BUILD.json's drift stays the agent's own number.
  const source = await rig.systems.get(id);
  assert.equal(source.build?.drift?.differ, 7);
  assert.ok(rig.ctx.events.some((event) => event.kind === 'system' && event.system === id && event.systemChange === 'state'));

  // No fix or describe mode: nothing to count, and the stored count is cleared.
  await writeFile(path.join(await rig.systems.dir(id), 'BUILD.json'), buildJson(rig, { mode: 'none' }));
  await recomputeDrift(rig.ctx, id);
  assert.equal((await rig.systems.readState(id)).codeDrift ?? null, null);
});

test('unread holds at most 20 paths', async (t) => {
  const rig = await setupRepo(t);
  const id = await builtSystem(rig);
  for (let n = 0; n < 25; n += 1) await tmpWrite(rig, `apps/app${String(n).padStart(2, '0')}/tailwind.config.js`, 'module.exports = {};\n');
  await recomputeDrift(rig.ctx, id);
  const unread = (await rig.systems.readState(id)).codeDrift?.unread ?? [];
  assert.equal(unread.length, 20);
  assert.ok(unread.every((rel) => rel.endsWith('tailwind.config.js')));
});

const tmpWrite = async (rig: RepoRig, rel: string, text: string): Promise<void> => {
  await mkdir(path.dirname(rig.repo(rel)), { recursive: true });
  await writeFile(rig.repo(rel), text);
};

test('every drift sentence names its scope: CSS variables and token JSON', () => {
  assert.equal(
    findingMessage(finding('system-code-drift', { count: 3, system: 'Acme' })),
    'In CSS variables and token JSON, 3 tokens differ from Acme. Ask the agent to reconcile.',
  );
  assert.equal(
    findingMessage(finding('system-code-drift', { count: 3, system: 'Acme', unread: 1 })),
    "In CSS variables and token JSON, 3 tokens differ from Acme. Ask the agent to reconcile. Design Chamber can't read 1 token file, so differences there aren't counted.",
  );
  assert.equal(
    findingMessage(finding('system-code-differs', { count: 2, system: 'Acme', unread: 4 })),
    "In CSS variables and token JSON, 2 tokens still differ from what Acme describes. Design Chamber can't read 4 token files, so differences there aren't counted.",
  );
});

test('scan.json caps every list and drops tokens until it fits 2 MiB', () => {
  const token = (n: number, value: string): ScanResult['tokens'][number] => ({ name: `--t${n}`, light: value, dark: null, file: 'src/a.css', line: n + 1, section: 'colours', alsoIn: [] });
  const result: ScanResult = {
    directory: '/project',
    at: '2026-11-20T09:00:00.000Z',
    tokens: Array.from({ length: SYSTEM_TOKENS_MAX + 500 }, (_, n) => token(n, '#fff')),
    scanned: [],
    assets: [],
    summary: {
      directory: '/project',
      counts: { fonts: 0, logos: 0 } as unknown as ScanResult['summary']['counts'],
      files: Array.from({ length: 300 }, (_, n) => ({ path: `f${n}.css`, found: 1 })),
      skipped: Array.from({ length: 80 }, (_, n) => ({ path: `s${n}`, reason: 'Too large.' })),
      assets: [],
      forAgent: Array.from({ length: 30 }, (_, n) => ({ path: `a${n}/tailwind.config.js`, why: 'Tailwind config: the agent can read its theme.' })),
      refused: 0,
      partial: false,
      read: 0,
      missed: { pages: 0, components: 0, codeThemes: 0 },
    },
  };
  const capped = JSON.parse(scanJsonOf(result)) as ScanJson;
  assert.equal(capped.schema, SCAN_JSON_SCHEMA);
  assert.equal(capped.schema, 'design-chamber/system-scan@1');
  assert.equal(capped.files.length, 200);
  assert.equal(capped.forAgent.length, 20);
  assert.equal(capped.skipped.length, 50);
  assert.equal(capped.tokens.length, 2000);
  assert.equal(capped.partial, true, 'tokens past the cap make it partial');
  assert.deepEqual(Object.keys(capped.tokens[0] ?? {}), ['name', 'light', 'dark', 'file', 'line']);

  const big = { ...result, tokens: Array.from({ length: SYSTEM_TOKENS_MAX }, (_, n) => token(n, 'x'.repeat(2000))) };
  const text = scanJsonOf(big);
  assert.ok(Buffer.byteLength(text, 'utf8') <= SCAN_JSON_MAX_BYTES);
  const fitted = JSON.parse(text) as ScanJson;
  assert.ok(fitted.tokens.length > 0 && fitted.tokens.length < SYSTEM_TOKENS_MAX);
  assert.equal(fitted.partial, true);
});

test('the build scan writes .chamber/scan.json under the system, records the scan and counts the drift', async (t) => {
  const rig = await setupRepo(t);
  const id = await builtSystem(rig);
  await writeFile(rig.repo('src/theme.css'), ':root {\n  --space-2: 12px;\n  --only-here: 1px;\n}\n');
  await runBuildScan(rig.ctx, id, rig.project);

  const scanJson = JSON.parse(await readFile(path.join(await rig.systems.dir(id), '.chamber', 'scan.json'), 'utf8')) as ScanJson;
  assert.equal(scanJson.schema, 'design-chamber/system-scan@1');
  assert.ok(scanJson.tokens.some((token) => token.name === '--only-here' && token.file === 'src/theme.css'));
  assert.ok(!scanJson.tokens.some((token) => token.file.startsWith('design-system/')), 'the system folder is not scanned');
  const state = await rig.systems.readState(id);
  assert.equal(state.sources.code?.lastScan, scanJson.at);
  assert.ok(state.sources.code?.scanned.includes('src/theme.css'));
  assert.equal(state.codeDrift?.differ, 1);
  assert.deepEqual(state.codeDrift?.names, ['--space-2']);
});

test('a systems write outside the designs root is refused and logged with the system id only', async (t) => {
  const rig = await setupRepo(t);
  const errors: { event: string; data: unknown }[] = [];
  const log = { error: (event: string, data?: unknown) => void errors.push({ event, data }) };
  await assert.rejects(guardSystemWrite(rig.root, rig.repo('design-system/tokens.css'), 'acme', log), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'internal');
    assert.equal(error.message, WRITE_OUTSIDE_ROOT_MESSAGE);
    return true;
  });
  assert.deepEqual(errors, [{ event: 'systems.write-outside-root', data: { system: 'acme' } }]);
  await guardSystemWrite(rig.root, path.join(rig.root, '_systems', 'acme', 'state.json'), 'acme', log);
  assert.equal(errors.length, 1);
});
