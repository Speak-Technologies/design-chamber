// Proposals (documentation/specs/phase-2-5-technical.md §5.14, §2.15, AD-26, AD-27, AD-30, T17): the quiet
// settle, the record (a new id supersedes, the same id with other bytes is rewritten, an unreadable file),
// the step 3 checks, the preview from `proposal/` and its problems, the approval a stamp claims (bound to
// the id and the bytes shown), Stop's decline, a home change, and what landed against what was approved.

import assert from 'node:assert/strict';
import { realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { PROPOSAL_NO_PARTS, PROPOSAL_NOT_JSON, parseProposal } from '../../../src/shared/system-json.ts';
import type { BuildJson, SystemState } from '../../../src/shared/types.ts';
import { SKIP_DIRS } from '../../../src/service/discovery.ts';
import { ensureBuildTickets } from '../../../src/service/systems/builds.ts';
import { createHomes, type Homes } from '../../../src/service/systems/homes.ts';
import { livingPagesIdle, readRecord, regenerateLivingPage } from '../../../src/service/systems/living-page.ts';
import { readProposalProblem, readProposalsRecord, type ProposalsRecord, type SeenProposal } from '../../../src/service/systems/proposal-record.ts';
import {
  checkProposal,
  createProposals,
  PROPOSAL_DESCRIBE_SENTENCE,
  PROPOSAL_INTERNAL_SENTENCE,
  PROPOSAL_NONE_FIXES_SENTENCE,
  PROPOSAL_NOT_ADOPTED_SENTENCE,
  PROPOSAL_REWRITTEN_SENTENCE,
  PROPOSAL_ROUND_SENTENCE,
  type Proposals,
  type ProposalsDeps,
} from '../../../src/service/systems/proposals.ts';
import { refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { fingerprintTree, proposalJson, setupRepo, type RepoRig } from './repo-fixture.ts';

// Built from parts so no file in the repo holds a whole key shape.
const AWS_KEY = `${'AKIA'}${'QWERTYUI'}${'23456789'}`;
const P1 = 'p_aaaa1111';
const P2 = 'p_bbbb2222';
const PALETTE = { path: 'design-system/notes/palette.md', change: 'create', summary: 'Why the blue.', added: 2, removed: 0, from: 'proposal/notes/palette.md' };

type Rig = RepoRig & {
  proposals: Proposals;
  homes: Homes;
  id: string;
  dir: string;
  repoReal: string;
  /** BUILD.json as an adopted build writes it; `state.build` is set as adoption would. */
  build(over?: Record<string, unknown>): Promise<void>;
  /** The agent's stamp: BUILD.json with `applied` and `proposal`, then homes' step 4 and what follows. */
  stamp(proposal: string | null, parts: string[], at: string): Promise<SystemState>;
  proposal(value: unknown): Promise<void>;
  file(rel: string, text: string): Promise<void>;
  record(): Promise<ProposalsRecord | null>;
  entry(proposalId: string): Promise<SeenProposal | undefined>;
  settle(): Promise<void>;
};

const setup = async (t: TestContext, seams: Partial<Pick<ProposalsDeps, 'quietMs' | 'regeneratePreview' | 'readPreview'>> = {}): Promise<Rig> => {
  const rig = await setupRepo(t);
  const { ctx, systems } = rig;
  const repoReal = await realpath(rig.project);
  const proposals = createProposals({
    systems,
    hub: ctx.hub,
    log: ctx.log,
    root: () => rig.root,
    quietMs: seams.quietMs ?? 600_000,
    regeneratePreview: seams.regeneratePreview ?? ((id) => regenerateLivingPage(ctx, id, { source: 'proposal' })),
    readPreview: seams.readPreview ?? (async (dir) => (await readRecord(dir))?.preview ?? null),
  });
  t.after(async () => {
    proposals.stop();
    await proposals.idle();
    await livingPagesIdle(ctx);
  });
  const homes = createHomes({
    systems,
    tickets: ensureBuildTickets(ctx),
    settings: ctx.settings,
    hub: ctx.hub,
    log: ctx.log,
    snapshots: { refresh: async (id, options) => void (await refreshSnapshot(ctx, id, options)) },
    proposals,
  });
  t.after(() => homes.stop());
  const id = await rig.repoSystem('Acme', { directory: repoReal });
  const dir = await systems.dir(id);
  const inSystem = (rel: string): string => path.relative(rig.tmp.root, path.join(dir, ...rel.split('/')));
  const buildBody = (over: Record<string, unknown>): Record<string, unknown> => ({
    version: 1,
    ticket: null,
    name: 'Acme',
    home: 'repo',
    repo: { directory: repoReal, folder: 'design-system', livingPage: 'design-system/index.html' },
    code: null,
    mode: 'fix',
    dark: true,
    calls: [],
    access: null,
    round: 'done',
    applied: null,
    proposal: null,
    drift: null,
    ...over,
  });
  const out: Rig = {
    ...rig,
    proposals,
    homes,
    id,
    dir,
    repoReal,
    async build(over = {}) {
      await writeFile(path.join(dir, 'BUILD.json'), `${JSON.stringify(buildBody(over), null, 2)}\n`);
      await systems.withLock(id, () =>
        systems.updateStateLocked(id, (state) =>
          state.build !== undefined ? null : { ...state, build: { ticket: null, adoptedAt: '2026-11-20T09:00:00.000Z', appliedSeen: null, projectDirectory: repoReal } },
        ),
      );
    },
    async stamp(proposal, parts, at) {
      await writeFile(path.join(dir, 'BUILD.json'), `${JSON.stringify(buildBody({ applied: { at, parts, skipped: [] }, proposal }), null, 2)}\n`);
      await homes.reconcile(id);
      await homes.idle();
      await livingPagesIdle(ctx);
      return systems.readState(id);
    },
    async proposal(value) {
      await rig.tmp.write(inSystem('PROPOSAL.json'), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    },
    async file(rel, text) {
      await rig.tmp.write(inSystem(`proposal/${rel}`), text);
    },
    record: () => readProposalsRecord(dir),
    async entry(proposalId) {
      return (await readProposalsRecord(dir))?.seen.find((item) => item.id === proposalId);
    },
    async settle() {
      await proposals.settle(id);
      await proposals.idle();
      await livingPagesIdle(ctx);
    },
  };
  return out;
};

const until = async (check: () => Promise<boolean>): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('timed out waiting');
};

const palette = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => proposalJson(id, { parts: [{ name: 'system-files', files: [PALETTE] }], ...over });

// ---- settle and record ----

test('settle waits for quiet on PROPOSAL.json or proposal/, then records the id and the bytes', async (t) => {
  const rig = await setup(t, { quietMs: 60 });
  await rig.build();
  const files = (names: string[]) => rig.ctx.hub.emit({ slug: null, kind: 'system', system: rig.id, systemChange: 'files', files: names });
  // Not a proposal path: nothing is scheduled. (The system's own `added` settle finds no file and writes nothing.)
  files(['tokens.css']);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await rig.proposals.idle();
  assert.equal(await rig.record(), null);
  await rig.proposal(palette(P1));
  await rig.file('notes/palette.md', 'A darker blue.\n');
  files(['tokens.css']);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(await rig.record(), null, 'a change elsewhere never reads PROPOSAL.json');
  // The agent writes several files; each event restarts the wait.
  files(['PROPOSAL.json']);
  await new Promise((resolve) => setTimeout(resolve, 30));
  files(['proposal/notes/palette.md']);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await rig.record(), null, 'nothing is read before the quiet period');
  await until(async () => (await rig.record())?.current === P1);
  await rig.proposals.idle();
  const entry = await rig.entry(P1);
  assert.equal(entry?.state, 'current');
  assert.match(entry?.sha256 ?? '', /^[0-9a-f]{64}$/);
  assert.notEqual(entry?.sha256, entry?.fileSha256, 'the sha covers proposal/ too');
  assert.deepEqual(entry?.problems, []);
});

test('a new id supersedes the current one, and the view says by which', async (t) => {
  const rig = await setup(t);
  await rig.build();
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  await rig.proposal(palette(P2, { supersedes: P1 }));
  await rig.settle();
  const record = await rig.record();
  assert.equal(record?.current, P2);
  assert.deepEqual([(await rig.entry(P1))?.state, (await rig.entry(P1))?.by], ['superseded', P2]);
  assert.deepEqual(await rig.proposals.view(rig.id, P1), { state: 'superseded', by: P2 });
  assert.equal((await rig.proposals.view(rig.id, P2)).state, 'current');
  assert.deepEqual(await rig.proposals.view(rig.id, 'p_cccc3333'), { state: 'unknown' });
  // The file removed: no current proposal, the last one superseded by nothing.
  await rm(path.join(rig.dir, 'PROPOSAL.json'));
  await rig.settle();
  assert.equal((await rig.record())?.current, null);
  assert.deepEqual(await rig.proposals.view(rig.id, P2), { state: 'superseded', by: null });
});

test('the same id with other bytes is rewritten for good: in PROPOSAL.json or in proposal/', async (t) => {
  const rig = await setup(t);
  await rig.build();
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  // Before the settle catches up, the view already answers as it will.
  await rig.proposal(palette(P1, { summary: 'Something else entirely.' }));
  assert.deepEqual(await rig.proposals.view(rig.id, P1), { state: 'rewritten' });
  await rig.settle();
  const entry = await rig.entry(P1);
  assert.deepEqual([entry?.state, entry?.reasons, entry?.problems], ['rewritten', ['rewritten'], [PROPOSAL_REWRITTEN_SENTENCE]]);
  // Put back exactly as first shown: still never approvable again.
  await rig.proposal(palette(P1));
  await rig.settle();
  assert.equal((await rig.entry(P1))?.state, 'rewritten');
  assert.deepEqual(await readProposalProblem(rig.dir), { reason: 'rewritten', sentence: null });

  await rig.proposal(palette(P2));
  await rig.settle();
  assert.equal((await rig.entry(P2))?.state, 'current');
  await rig.file('notes/palette.md', 'A different blue.\n');
  await rig.settle();
  assert.equal((await rig.entry(P2))?.state, 'rewritten', 'a changed proposal/ file is other bytes');
});

test('an unreadable PROPOSAL.json: no id is recorded with its sentence; an id without parts is an unreadable entry', async (t) => {
  const rig = await setup(t);
  await rig.build();
  await rig.proposal('{ not json');
  await rig.settle();
  assert.deepEqual([(await rig.record())?.current, (await rig.record())?.unreadable], [null, PROPOSAL_NOT_JSON]);
  assert.deepEqual(await readProposalProblem(rig.dir), { reason: 'unreadable', sentence: PROPOSAL_NOT_JSON });

  await rig.proposal(proposalJson(P1, { parts: 'all of them' }));
  await rig.settle();
  const entry = await rig.entry(P1);
  assert.deepEqual([entry?.state, entry?.sentence], ['unreadable', PROPOSAL_NO_PARTS]);
  assert.deepEqual(await rig.proposals.view(rig.id, P1), { state: 'unreadable', sentence: PROPOSAL_NO_PARTS });
  // An unreadable proposal is never approved.
  const state = await rig.stamp(P1, ['system-files'], '2026-11-20T11:00:00.000Z');
  assert.equal(state.buildProblem?.reason, 'applied-unknown-proposal');
  assert.equal(state.build?.approved ?? null, null);
});

// ---- step 3 ----

const parsed = (value: Record<string, unknown>) => parseProposal(JSON.stringify(value), { skipDirs: SKIP_DIRS });
const BUILD = { round: 'done' } as unknown as BuildJson;

test('step 3: a create of an existing repo file, a path outside the folder, the living-page path, a missing from', async (t) => {
  const rig = await setup(t);
  const state = await rig.systems.readState(rig.id);
  const adopted: SystemState = { ...state, build: { ticket: null, adoptedAt: '2026-11-20T09:00:00.000Z', appliedSeen: null } };
  const problems = await checkProposal({
    state: adopted,
    build: BUILD,
    proposalDir: null,
    parsed: parsed(
      proposalJson(P1, {
        parts: [
          { name: 'system-files', files: [{ ...PALETTE, path: 'design-system/tokens.css' }, { path: 'src/theme.css', change: 'modify', summary: 'x', added: 1, removed: 1 }] },
          { name: 'living-page', files: [{ path: 'docs/index.html', change: 'create', summary: 'x', added: 1, removed: 0 }] },
        ],
      }),
    ),
  });
  assert.deepEqual(
    problems.map((problem) => problem.sentence),
    [
      'design-system/tokens.css already exists in shop. The proposal must change it, not create it.',
      'proposal/notes/palette.md is missing. The agent writes it before it asks.',
      'src/theme.css is outside design-system, the system\'s folder.',
      "docs/index.html isn't the living page this build named (design-system/index.html).",
    ],
  );
  assert.deepEqual(problems.map((problem) => problem.reason), ['create-exists', 'from-missing', 'path-outside', 'living-page-path']);
});

test('step 3: describe mode never changes the app; an internal home holds only token fixes; none mode has none', async (t) => {
  const rig = await setup(t);
  const state = await rig.systems.readState(rig.id);
  const adopted: SystemState = { ...state, build: { ticket: null, adoptedAt: '2026-11-20T09:00:00.000Z', appliedSeen: null } };
  const fix = { name: 'token-fixes', files: [{ path: 'src/theme.css', change: 'modify', summary: 'x', added: 1, removed: 1 }] };
  const describe = await checkProposal({ state: adopted, build: BUILD, proposalDir: null, parsed: parsed(proposalJson(P1, { mode: 'describe', parts: [fix] })) });
  assert.deepEqual(describe.map((problem) => problem.sentence), [PROPOSAL_DESCRIBE_SENTENCE]);
  // A modify inside the system's folder is the system, not the app.
  const inside = await checkProposal({ state: adopted, build: BUILD, proposalDir: null, parsed: parsed(proposalJson(P1, { mode: 'describe' })) });
  assert.deepEqual(inside, []);

  const internal: SystemState = { ...adopted, home: { kind: 'internal' } };
  const sysFiles = await checkProposal({ state: internal, build: BUILD, proposalDir: null, parsed: parsed(proposalJson(P1)) });
  assert.deepEqual(sysFiles.map((problem) => problem.sentence), [PROPOSAL_INTERNAL_SENTENCE]);
  assert.deepEqual(await checkProposal({ state: internal, build: BUILD, proposalDir: null, parsed: parsed(proposalJson(P1, { parts: [fix] })) }), []);
  const describeInternal = await checkProposal({ state: internal, build: BUILD, proposalDir: null, parsed: parsed(proposalJson(P1, { mode: 'describe', parts: [fix] })) });
  assert.deepEqual(describeInternal.map((problem) => problem.reason), ['describe-change']);

  const none = await checkProposal({ state: internal, build: BUILD, proposalDir: null, parsed: parsed(proposalJson(P1, { mode: 'none', parts: [fix] })) });
  assert.deepEqual(none.map((problem) => problem.sentence), [PROPOSAL_NONE_FIXES_SENTENCE]);
});

test('step 3: the build must be adopted and past round one; problems reach the view and the check', async (t) => {
  const rig = await setup(t);
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  let view = await rig.proposals.view(rig.id, P1);
  assert.equal(view.state, 'current');
  assert.deepEqual(view.state === 'current' ? view.proposal.problems : null, [PROPOSAL_NOT_ADOPTED_SENTENCE]);
  assert.deepEqual(await readProposalProblem(rig.dir), { reason: 'not-adopted', sentence: PROPOSAL_NOT_ADOPTED_SENTENCE });

  // Adopted, still in round one: the same bytes are checked again.
  await rig.build({ round: 1 });
  await rig.settle();
  view = await rig.proposals.view(rig.id, P1);
  assert.deepEqual(view.state === 'current' ? view.proposal.problems : null, [PROPOSAL_ROUND_SENTENCE]);
  await rig.build({ round: 2 });
  await rig.settle();
  view = await rig.proposals.view(rig.id, P1);
  assert.deepEqual(view.state === 'current' ? view.proposal.problems : null, []);
  assert.equal(await readProposalProblem(rig.dir), null);
  // The view lists a from file's size, never its bytes.
  const files = view.state === 'current' ? view.proposal.parts[0]?.files : [];
  assert.equal(files?.[0]?.bytes, Buffer.byteLength('A darker blue.\n'));
});

// ---- step 4: the preview ----

test('the preview is generated from proposal/; a secret shape in it disables Approve, whatever access says', async (t) => {
  const rig = await setup(t);
  await rig.build();
  assert.equal((await refreshSnapshot(rig.ctx, rig.id, { by: 'agent' })).kind, 'refreshed');
  await livingPagesIdle(rig.ctx);
  await rig.file('tokens.css', ':root {\n  --brand-500: #0b57d0;\n}\n');
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  let view = await rig.proposals.view(rig.id, P1);
  assert.equal(view.state, 'current');
  if (view.state !== 'current') return;
  assert.deepEqual(view.preview, { board: true, livingPage: 'ready', sentence: null });
  assert.deepEqual(view.proposal.problems, []);
  assert.equal((await rig.entry(P1))?.previewSha256, (await readRecord(rig.dir))?.preview?.sha256);

  await rig.build({ access: 'public' });
  // A note the proposed system.json lists, so the page shows it.
  await rig.file('system.json', `${JSON.stringify({ version: 1, notes: [{ id: 'palette', title: 'Palette' }] }, null, 2)}\n`);
  await rig.file('notes/palette.md', `A darker blue. ${AWS_KEY}\n`);
  await rig.proposal(palette(P2));
  await rig.settle();
  view = await rig.proposals.view(rig.id, P2);
  assert.equal(view.state, 'current');
  if (view.state !== 'current') return;
  const sentence = 'The living page it proposes shows something shaped like a secret. Remove it before you approve.';
  assert.deepEqual(view.preview, { board: true, livingPage: 'failed', sentence });
  assert.deepEqual(view.proposal.problems, [sentence]);
  assert.deepEqual(await readProposalProblem(rig.dir), { reason: 'preview-secret', sentence });
  assert.equal((await rig.entry(P2))?.previewSha256, null, 'a secret preview is never written');
});

test('an unsafe or too-large preview disables Approve with its sentence; the build checks are kept beside it', async (t) => {
  let problem: 'unsafe' | 'too-large' = 'unsafe';
  let drawn: { proposal: string; sha256: string | null; problem: 'unsafe' | 'too-large' | null } | null = null;
  let regenerated = 0;
  const rig = await setup(t, {
    regeneratePreview: async () => {
      regenerated += 1;
      const current = (await readProposalsRecord(rig.dir))?.current ?? '';
      drawn = { proposal: current, sha256: null, problem };
    },
    readPreview: async () => drawn,
  });
  await rig.build({ round: 1 });
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  let view = await rig.proposals.view(rig.id, P1);
  assert.deepEqual(view.state === 'current' ? view.proposal.problems : null, [PROPOSAL_ROUND_SENTENCE, "The living page it proposes didn't pass the safety check."]);
  assert.equal(view.state === 'current' ? view.preview.livingPage : null, 'failed');

  problem = 'too-large';
  await rig.proposal(palette(P2));
  await rig.settle();
  view = await rig.proposals.view(rig.id, P2);
  assert.deepEqual(view.state === 'current' ? view.proposal.problems : null, [PROPOSAL_ROUND_SENTENCE, 'The living page it proposes would be too large to show. Ask the agent to trim it.']);
  // Settling the same bytes again keeps the preview problem (the build checks are re-run beside it).
  await rig.build({ round: 'done' });
  await rig.settle();
  view = await rig.proposals.view(rig.id, P2);
  assert.deepEqual(view.state === 'current' ? view.proposal.problems : null, ['The living page it proposes would be too large to show. Ask the agent to trim it.']);
  assert.equal(regenerated, 3);
});

test('an internal home has no preview and no proposal/ in its hash', async (t) => {
  const rig = await setup(t);
  await rig.systems.withLock(rig.id, () => rig.systems.updateStateLocked(rig.id, (state) => ({ ...state, home: { kind: 'internal' } })));
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(proposalJson(P1, { parts: [{ name: 'token-fixes', files: [{ path: 'src/theme.css', change: 'modify', summary: 'x', added: 1, removed: 1 }] }] }));
  await rig.settle();
  const entry = await rig.entry(P1);
  assert.equal(entry?.sha256, entry?.fileSha256);
  const view = await rig.proposals.view(rig.id, P1);
  assert.deepEqual(view.state === 'current' ? view.preview : null, { board: false, livingPage: 'none', sentence: null });
});

// ---- step 5: the approval a stamp claims ----

test('a stamp naming the current proposal with the bytes shown approves it; the same stamp again stays approved', async (t) => {
  const rig = await setup(t);
  await rig.build();
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  const sha = (await rig.entry(P1))?.sha256;
  await rig.tmp.write('shop/design-system/notes/palette.md', 'A darker blue.\n');
  let state = await rig.stamp(P1, ['system-files'], '2026-11-20T11:00:00.000Z');
  assert.equal(state.buildProblem ?? null, null);
  assert.deepEqual(state.build?.approved, { proposal: P1, sha256: sha, parts: ['system-files'] });
  assert.equal((await rig.entry(P1))?.state, 'approved');
  const view = await rig.proposals.view(rig.id, P1);
  assert.equal(view.state, 'approved');
  assert.deepEqual(state.landed, { proposal: P1, matches: true, differ: [], unclaimed: [] });

  state = await rig.stamp(P1, ['system-files'], '2026-11-20T12:00:00.000Z');
  assert.equal(state.buildProblem ?? null, null);
  assert.equal(state.build?.approved?.proposal, P1);
});

test('any other stamp is applied-unknown-proposal, and the snapshot is still read', async (t) => {
  const rig = await setup(t);
  await rig.build();
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  const sentence = (state: SystemState) => state.buildProblem?.reason;

  // An id never recorded.
  let state = await rig.stamp('p_zzzz9999', ['system-files'], '2026-11-20T11:00:00.000Z');
  assert.equal(sentence(state), 'applied-unknown-proposal');
  assert.equal(state.build?.approved ?? null, null);
  assert.notEqual(state.snapshot ?? null, null, 'the repo is what it is');
  // No proposal named at all.
  state = await rig.stamp(null, ['system-files'], '2026-11-20T11:01:00.000Z');
  assert.equal(sentence(state), 'applied-unknown-proposal');
  // Changed after it was shown, before the quiet wait caught it: a rewrite, never an approval.
  await rig.proposal(palette(P1, { summary: 'Changed after it was shown.' }));
  state = await rig.stamp(P1, ['system-files'], '2026-11-20T11:02:00.000Z');
  assert.equal(sentence(state), 'applied-unknown-proposal');
  assert.equal((await rig.entry(P1))?.state, 'rewritten');
  // A proposal/ file changed the same way.
  await rig.proposal(palette(P2));
  await rig.settle();
  await rig.file('notes/palette.md', 'Swapped after it was shown.\n');
  state = await rig.stamp(P2, ['system-files'], '2026-11-20T11:03:00.000Z');
  assert.equal(sentence(state), 'applied-unknown-proposal');
  assert.equal((await rig.entry(P2))?.state, 'rewritten');
  // A superseded one.
  await rig.proposal(palette('p_cccc3333'));
  await rig.settle();
  await rig.proposal(palette('p_dddd4444'));
  await rig.settle();
  state = await rig.stamp('p_cccc3333', ['system-files'], '2026-11-20T11:04:00.000Z');
  assert.equal(sentence(state), 'applied-unknown-proposal');
  // The current one clears the problem.
  state = await rig.stamp('p_dddd4444', ['system-files'], '2026-11-20T11:05:00.000Z');
  assert.equal(state.buildProblem ?? null, null);
  assert.equal(state.build?.approved?.proposal, 'p_dddd4444');
});

test('Stop declines the named current proposal only; a home change supersedes it', async (t) => {
  const rig = await setup(t);
  await rig.build();
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1));
  await rig.settle();
  await rig.systems.withLock(rig.id, () => rig.proposals.declineLocked(rig.id, P2));
  assert.equal((await rig.entry(P1))?.state, 'current', 'another id is left alone');
  await rig.systems.withLock(rig.id, () => rig.proposals.declineLocked(rig.id, P1));
  assert.equal((await rig.entry(P1))?.state, 'declined');
  assert.equal((await rig.proposals.view(rig.id, P1)).state, 'declined');
  assert.equal((await rig.stamp(P1, ['system-files'], '2026-11-20T11:00:00.000Z')).buildProblem?.reason, 'applied-unknown-proposal');

  await rig.proposal(palette(P2));
  await rig.settle();
  await rig.proposals.supersede(rig.id);
  assert.deepEqual(await rig.proposals.view(rig.id, P2), { state: 'superseded', by: null });
});

// ---- step 6: what landed ----

test('landed: equal (line endings ignored), differing, and parts claimed with nothing found', async (t) => {
  const rig = await setup(t);
  await rig.build();
  await rig.file('notes/palette.md', 'Line one.\nLine two.\n');
  const withDocs = (id: string) =>
    palette(id, { parts: [{ name: 'system-files', files: [PALETTE] }, { name: 'docs', files: [{ path: 'docs/palette.md', change: 'create', summary: 'x', added: 1, removed: 0 }] }] });

  // CRLF in the repo, LF in proposal/: the same file.
  await rig.proposal(withDocs(P1));
  await rig.settle();
  await rig.tmp.write('shop/design-system/notes/palette.md', 'Line one.\r\nLine two.\r\n');
  let state = await rig.stamp(P1, ['system-files'], '2026-11-20T11:00:00.000Z');
  assert.deepEqual(state.landed, { proposal: P1, matches: true, differ: [], unclaimed: [] });

  // What landed differs, and docs were claimed but nothing of them is in the repo.
  await rig.proposal(withDocs(P2));
  await rig.settle();
  await rig.tmp.write('shop/design-system/notes/palette.md', 'Line one.\nSomething else.\n');
  // The committed living page is gone too, so the living-page part is claimed with nothing found.
  await rm(rig.repo('design-system/index.html'));
  state = await rig.stamp(P2, ['system-files', 'docs', 'living-page'], '2026-11-20T12:00:00.000Z');
  assert.deepEqual(state.landed, { proposal: P2, matches: false, differ: ['notes/palette.md'], unclaimed: ['docs', 'living-page'] });
  const detail = await rig.systems.get(rig.id);
  assert.equal(detail.state.landed?.matches, false);

  // The agent fixes it and stamps the same approval again: what landed now matches.
  await rig.tmp.write('shop/design-system/notes/palette.md', 'Line one.\nLine two.\n');
  await rig.tmp.write('shop/docs/palette.md', 'The palette.\n');
  state = await rig.stamp(P2, ['system-files', 'docs'], '2026-11-20T13:00:00.000Z');
  assert.deepEqual(state.landed, { proposal: P2, matches: true, differ: [], unclaimed: [] });
});

test('nothing here writes the repo', async (t) => {
  const rig = await setup(t);
  const before = await fingerprintTree(rig.project);
  await rig.build();
  await rig.file('notes/palette.md', 'A darker blue.\n');
  await rig.proposal(palette(P1, { parts: [{ name: 'system-files', files: [PALETTE, { ...PALETTE, path: 'design-system/tokens.css', from: null, change: 'modify' }] }] }));
  await rig.settle();
  await rig.proposals.view(rig.id, P1);
  await rig.stamp(P1, ['system-files', 'docs', 'living-page', 'token-fixes'], '2026-11-20T11:00:00.000Z');
  await rig.proposals.compareLanded(rig.id);
  assert.deepEqual(await fingerprintTree(rig.project), before);
});
