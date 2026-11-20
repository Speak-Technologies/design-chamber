// Phase 2.5 T16 (documentation/specs/phase-2-5-technical.md §10.4): the S8 findings of a design system.
// Each code with its sentence and severity, a secret's severity by access, drift against the code
// (fix and describe, unread token files) apart from a design's overrides, coverage, what landed, and
// `runSystemCheck` reading the committed living page in the repo itself.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { cliSystemStore, readS8Facts, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { s8Findings, type S8Facts } from '../../../src/service/check/system-static.ts';
import { LIVING_UNSAFE_SENTENCE } from '../../../src/service/systems/living-page.ts';
import { findingMessage, severityOf, withMessage } from '../../../src/shared/checks.ts';
import { buildSystemDetail, parseSystemState, type SystemDetailSource } from '../../../src/shared/system-json.ts';
import type { CheckFindingData, SystemState } from '../../../src/shared/types.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const AT = '2026-11-01T10:00:00.000Z';
const TOKENS = ':root {\n  --brand: #0a5;\n}\n';
// Built from parts so no file in the repo holds a whole key shape.
const AWS_KEY = `${'AKIA'}${'QWERTYUI'}${'23456789'}`;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const repoHome = (directory = '/work/shop'): NonNullable<SystemState['home']> => ({ kind: 'repo', directory, folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: AT });

const source = (state: Partial<SystemState> = {}, over: Partial<SystemDetailSource> = {}): SystemDetailSource => {
  const base = parseSystemState(null, 'acme', AT);
  return {
    id: 'acme',
    dir: '/d/_systems/acme',
    state: { ...base, name: 'Acme', revision: { n: 7, treeHash: sha('t'), at: AT }, ...state },
    systemJson: '{ "version": 1, "tokens": {} }',
    tokensCss: TOKENS,
    texts: { 'OVERVIEW.md': 'Calm and clear.' },
    files: [],
    build: null,
    ...over,
  };
};

const FRESH: S8Facts = { living: { committed: { state: 'fresh', revision: 7, sentence: '', reasons: [] }, secrets: [], staged: { problem: null, secrets: [] } }, proposal: null };
const run = (input: SystemDetailSource, facts: S8Facts = FRESH): CheckFindingData[] => s8Findings(input, buildSystemDetail(input), facts);
const said = (findings: readonly CheckFindingData[]): [string, string, string][] => findings.map((finding) => [finding.code, severityOf(finding.code, finding.params), findingMessage(finding)]);
const living = (committed: NonNullable<S8Facts['living']>['committed'], more: Partial<NonNullable<S8Facts['living']>> = {}): S8Facts => ({ living: { committed, secrets: [], staged: null, ...more }, proposal: null });

test('s8Findings: an internal system and a sound repo-backed one have none', () => {
  assert.deepEqual(run(source(), { living: null, proposal: null }), []);
  assert.deepEqual(run(source({ home: repoHome() })), []);
});

test('s8Findings: each living-page state has its code, severity and sentence', () => {
  const home = { home: repoHome() };
  assert.deepEqual(said(run(source(home), living({ state: 'missing', revision: null, sentence: '', reasons: [] }))), [['system-living-missing', 'warning', 'Acme lives in shop but has no living page yet.']]);
  const stale = run(source(home), living({ state: 'out-of-date', revision: 5, sentence: '', reasons: [] }));
  assert.deepEqual(said(stale), [['system-living-stale', 'warning', 'The living page was generated from revision 5; Acme is at revision 7.']]);
  assert.deepEqual(said(run(source(home), living({ state: 'changed', revision: 5, sentence: '', reasons: [] }))), [['system-living-changed', 'warning', 'The living page in the repo differs from the one Design Chamber generated.']]);
  const reformatted = said(run(source(home), living({ state: 'reformatted', revision: 7, sentence: '', reasons: [] })));
  assert.deepEqual(reformatted.map(([code, severity]) => [code, severity]), [['system-living-reformatted', 'info']]);
  assert.match(reformatted[0]?.[2] ?? '', /reformatted since it was generated\. Its values are current\./);

  const unsafe = run(source(home), living({ state: 'unsafe', revision: 7, sentence: LIVING_UNSAFE_SENTENCE, reasons: ['a script', 'a remote image', 'an event handler', 'a frame'] }));
  assert.deepEqual(said(unsafe), [['system-living-unsafe', 'error', "The living page has markup Design Chamber didn't generate and can't check as safe."]]);
  assert.equal(unsafe[0]?.detail, 'a script, a remote image, an event handler');
  const link = run(source(home), living({ state: 'unreadable', revision: null, sentence: "Design Chamber can't read the living page: it's a link.", reasons: [] }));
  assert.deepEqual(link.map((finding) => [finding.code, finding.detail]), [['system-living-unsafe', "it's a link"]]);
});

test('s8Findings: the repo, the snapshot, BUILD.json and a failed generation', () => {
  const repo = run(source({ home: repoHome(), repoProblem: { reason: 'missing', at: AT } }), living(null));
  assert.deepEqual(said(repo).map(([code, severity, sentence]) => [code, severity, sentence.startsWith("Design Chamber can't read shop's design system folder.")]), [['system-repo-unreadable', 'error', true]]);
  assert.deepEqual(codesOf(run(source({ home: repoHome() }), { living: null, proposal: null })), ['system-repo-unreadable']);

  const tampered = run(source({ home: repoHome(), snapshot: { at: AT, by: 'agent', treeHash: sha('x'), tampered: true } }));
  assert.deepEqual(said(tampered), [['system-snapshot-changed', 'warning', "Acme's snapshot was changed outside Design Chamber. Re-sync to read shop again."]]);

  const build = run(source({ buildProblem: { reason: 'unreadable', value: '' } }), { living: null, proposal: null });
  assert.deepEqual(build.map((finding) => [finding.code, finding.file, finding.params?.build]), [['system-build-invalid', 'BUILD.json', 'unreadable']]);
  assert.match(findingMessage(build[0] as CheckFindingData), /^BUILD\.json can't be used: /);

  for (const [failed, words] of [['too-large', 'it would be too large'], ['secret', 'it would show something shaped like a secret']] as const) {
    const out = run(source({ home: repoHome() }), { ...FRESH, living: { ...FRESH.living!, staged: { problem: failed, secrets: [] } } });
    assert.deepEqual(out.map((finding) => [finding.code, severityOf(finding.code, finding.params)]), [['system-living-failed', 'warning']]);
    assert.ok(findingMessage(out[0] as CheckFindingData).includes(words), findingMessage(out[0] as CheckFindingData));
  }
});

test('s8Findings: a secret shape is an error unless the page is dev-only; the value never travels', () => {
  const committedHit = { ...FRESH, living: { ...FRESH.living!, secrets: [{ kind: 'aws-key' as const }] } };
  for (const [access, severity] of [[null, 'error'], ['public', 'error'], ['dev', 'warning']] as const) {
    const input = source({ home: repoHome() }, { build: access === null ? null : ({ access } as SystemDetailSource['build']) });
    const out = run(input, committedHit);
    assert.deepEqual(out.map((finding) => [finding.code, severityOf(finding.code, finding.params), finding.params?.kind, finding.params?.count]), [['system-living-secret', severity, 'aws-key', 1]]);
    assert.match(findingMessage(out[0] as CheckFindingData), /shaped like a secret \(an AWS key\)/);
    assert.ok(!JSON.stringify(out).includes(AWS_KEY));
  }
  // A dev page staged with the shape names where it is, never the value.
  const staged = run(source({ home: repoHome() }, { build: { access: 'dev' } as SystemDetailSource['build'] }), { ...FRESH, living: { ...FRESH.living!, staged: { problem: null, secrets: [{ kind: 'aws-key', where: 'note:history' }] } } });
  assert.deepEqual(staged.map((finding) => [finding.code, finding.detail, withMessage(finding).severity]), [['system-living-secret', 'note:history', 'warning']]);
  // A public page kept out of staging for the shape is the failed generation, not a second finding.
  const blocked = run(source({ home: repoHome() }), { ...FRESH, living: { ...FRESH.living!, staged: { problem: 'secret', secrets: [{ kind: 'aws-key', where: 'note:history' }] } } });
  assert.deepEqual(codesOf(blocked), ['system-living-failed']);
});

test('s8Findings: drift against the code is fix or describe, counts unread token files, and needs a difference', () => {
  const drift = (mode: 'fix' | 'describe', differ: number, unread: string[] = []): SystemState['codeDrift'] => ({ at: AT, mode, differ, names: ['--brand', '--ink', '--space', '--radius'], partial: false, unread });
  const fix = run(source({ codeDrift: drift('fix', 3) }), { living: null, proposal: null });
  assert.deepEqual(fix.map((finding) => [finding.code, finding.params?.count, finding.params?.unread, finding.detail]), [['system-code-drift', 3, undefined, '--brand, --ink, --space']]);
  assert.match(findingMessage(fix[0] as CheckFindingData), /3 tokens differ/);
  const describe = run(source({ codeDrift: drift('describe', 12, ['tailwind.config.js', 'theme.ts']) }), { living: null, proposal: null });
  assert.deepEqual(describe.map((finding) => [finding.code, severityOf(finding.code, finding.params), finding.params?.count, finding.params?.unread]), [['system-code-differs', 'warning', 12, 2]]);
  assert.match(findingMessage(describe[0] as CheckFindingData), /can't read 2 token files/);
  assert.deepEqual(run(source({ codeDrift: drift('fix', 0) }), { living: null, proposal: null }), [], 'no difference, no finding');
});

test('s8Findings: an area the system covers but leaves empty; absent coverage raises nothing', () => {
  const covered = run(source({}, { systemJson: JSON.stringify({ version: 1, coverage: ['foundations', 'patterns'] }) }), { living: null, proposal: null });
  assert.deepEqual(said(covered), [['system-coverage-empty', 'warning', 'Acme covers Patterns & voice but has nothing there yet.']]);
  assert.deepEqual(run(source(), { living: null, proposal: null }), [], 'coverage not named: no finding');
  assert.deepEqual(run(source({}, { systemJson: '{ nope' }), { living: null, proposal: null }), [], 'an unreadable system.json is its own finding');
});

test('s8Findings: what landed differs from the approval, and a proposal that can not be used', () => {
  const landed = { proposal: 'p-1', matches: false, differ: ['design-system/tokens.css', 'design-system/a.md'], unclaimed: ['docs', 'not-a-part'] };
  const out = run(source({ home: repoHome(), landed }));
  assert.deepEqual(out.map((finding) => [finding.code, finding.params?.count, finding.params?.part]), [['system-landed-differs', 2, undefined], ['system-landed-differs', undefined, 'docs']]);
  assert.deepEqual(out.map((finding) => findingMessage(finding)), ['What landed in shop differs from the proposal you approved in 2 files.', "The agent says it applied docs, but Design Chamber found none in shop."]);
  assert.deepEqual(run(source({ home: repoHome(), landed: { ...landed, matches: true } })), []);

  const proposal = run(source({ home: repoHome() }), { ...FRESH, proposal: { reason: 'path-outside', sentence: null } });
  assert.deepEqual(proposal.map((finding) => [finding.code, finding.file, severityOf(finding.code, finding.params)]), [['system-proposal-invalid', 'PROPOSAL.json', 'warning']]);
  assert.match(findingMessage(proposal[0] as CheckFindingData), /^PROPOSAL\.json can't be used: /);
});

const codesOf = (findings: readonly { code: string }[]): string[] => findings.map((finding) => finding.code).sort();

// ---- reading the committed page ----

const repoSystem = async (t: Parameters<typeof useTmpRoot>[0]) => {
  const tmp = await useTmpRoot(t);
  const project = tmp.at('shop');
  await mkdir(path.join(project, 'design-system'), { recursive: true });
  await tmp.write('_systems/acme/snapshot/tokens.css', TOKENS);
  await tmp.write('_systems/acme/snapshot/system.json', '{ "version": 1, "tokens": {} }\n');
  await tmp.write('_systems/acme/snapshot/OVERVIEW.md', 'Calm.');
  await tmp.write('_systems/acme/.chamber/state.json', { v: 1, id: 'acme', name: 'Acme', status: 'ready', home: { kind: 'repo', directory: project, folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: AT } });
  const store = cliSystemStore(tmp.root, { version: 1 });
  t.after(() => store.dispose());
  return { tmp, project, store, page: path.join(project, 'design-system', 'index.html') };
};

test('runSystemCheck reads the committed page itself: missing, a hand-edited unsafe page, a link, a secret', async (t) => {
  const { tmp, project, store, page } = await repoSystem(t);
  const codes = async (): Promise<string[]> => codesOf((await runSystemCheck(store, 'acme', { now: new Date(AT), tool: 'cli' })).report.static.findings);

  assert.ok((await codes()).includes('system-living-missing'));
  await writeFile(page, '<!doctype html><html><body><script>alert(1)</script></body></html>');
  const unsafe = (await runSystemCheck(store, 'acme', { now: new Date(AT), tool: 'cli' })).report.static.findings.filter((finding) => finding.code === 'system-living-unsafe');
  assert.equal(unsafe.length, 1);
  assert.equal(withMessage(unsafe[0] as CheckFindingData).severity, 'error');

  await writeFile(tmp.at('elsewhere.html'), '<!doctype html><p>Hi</p>');
  await rm(page);
  await symlink(tmp.at('elsewhere.html'), page);
  const linked = await readS8Facts(store, 'acme', await store.get('acme'));
  assert.equal(linked.living?.committed?.state, 'unreadable');
  assert.ok((await codes()).includes('system-living-unsafe'));

  await rm(page);
  await writeFile(page, `<!doctype html><html><body><p>Our key ${AWS_KEY}</p></body></html>`);
  const facts = await readS8Facts(store, 'acme', await store.get('acme'));
  assert.deepEqual(facts.living?.secrets, [{ kind: 'aws-key' }]);
  const report = (await runSystemCheck(store, 'acme', { now: new Date(AT), tool: 'cli' })).report;
  assert.ok(codesOf(report.static.findings).includes('system-living-secret'));
  assert.ok(!JSON.stringify(report).includes(AWS_KEY));

  await rm(project, { recursive: true });
  assert.deepEqual(await codes(), ['system-repo-unreadable']);
});
