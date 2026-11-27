// The SystemAsk block as data (documentation/specs/phase-2-5-technical.md §8.12): the answer text and
// marker line of every action, the marker read back, which buttons are on and why, and the limits.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GUEST_BLOCK_ANSWER_MAX } from '@openchamber/sdk';

import { parseSystemQuestions } from '../../src/shared/agent/system-questions.ts';
import type { ProposalFile, ProposalPart, ProposalPartName, ProposalView, SystemQuestionSet } from '../../src/shared/types.ts';
import {
  answeredView,
  SERVICE_DOWN,
  approveAnswer,
  approveView,
  askCopy,
  composeAnswer,
  defaultPicks,
  describeAnswer,
  describeOffered,
  droppedLine,
  fileRowText,
  listedFiles,
  markerLine,
  parseMarker,
  patchView,
  previewButtons,
  proposalStateSentence,
  proposalVerdict,
  resolveCalls,
  roundOneAnswer,
  roundOneBlock,
  roundOneQuestions,
  roundTwoAnswer,
  roundTwoRead,
  roundTwoSub,
  roundTwoVerdict,
  stopAnswer,
  ticketVerdict,
  undoWindow,
  unlistedUses,
  usesLine,
  withPick,
  type CurrentProposal,
} from '../../src/ui/model/system-ask-model.ts';
import { DESKTOP_DEVICE, type Device } from '../../src/ui/model/device-model.ts';

const set: SystemQuestionSet = parseSystemQuestions(readFileSync(new URL('../../rules/SYSTEM-QUESTIONS.md', import.meta.url), 'utf8'));
const TICKET = 'sb_abcdefghij12';
const ID = 'p_k3m9q2x7';

const file = (path: string, over: Partial<ProposalFile> = {}): ProposalFile => ({
  path,
  change: 'modify',
  summary: '',
  added: 12,
  removed: 3,
  patch: '@@ -1 +1 @@\n-a\n+b\n',
  patchOmitted: false,
  from: null,
  bytes: null,
  usages: null,
  ...over,
});

const part = (name: ProposalPartName, files: ProposalFile[] = [file(`${name}.css`)]): ProposalPart => ({ name, files });

const proposal = (over: { parts?: ProposalPart[]; problems?: string[]; mode?: 'fix' | 'describe' | 'none'; livingPage?: 'ready' | 'generating' | 'failed' | 'none'; repo?: boolean } = {}): CurrentProposal => ({
  state: 'current',
  sha16: '0123456789abcdef',
  preview: { board: true, livingPage: over.livingPage ?? 'ready', sentence: null },
  proposal: {
    id: 'p_k3m9q2x7',
    supersedes: null,
    created: '2026-11-20T10:00:00.000Z',
    mode: over.mode ?? 'fix',
    summary: 'Ten files.',
    parts: over.parts ?? [part('system-files'), part('token-fixes'), part('docs'), part('living-page')],
    wayBack: { kind: 'branch', name: 'design-system/acme', text: 'One commit on a new branch.' },
    access: 'dev',
    home: over.repo === false ? { kind: 'internal' } : { kind: 'repo', directory: '/x/shop', label: 'shop', folder: 'design-system', livingPage: 'design-system/index.html', readable: true, problem: null, lastRead: null },
    problems: over.problems ?? [],
  },
});

const all = (view: CurrentProposal): Set<ProposalPartName> => new Set(view.proposal.parts.map((p) => p.name));

// ---------------------------------------------------------------- round one

test('round one: the defaults are the recommended options and Go with these sends them with the marker', () => {
  const picks = defaultPicks(roundOneQuestions(set, true));
  assert.deepEqual(picks, { home: ['repo'], mode: ['fix'], coverage: ['foundations', 'components', 'patterns', 'brand'], depth: ['core'], dark: ['not-now'] });
  const text = roundOneAnswer(TICKET, set, picks, true, '');
  assert.equal(
    text,
    `Round one: Repo + living page; Fix tokens, then document; all four areas; Product core; dark mode not now.\n[SystemAsk ticket=${TICKET} round=1 home=repo mode=fix coverage=foundations,components,patterns,brand depth=core dark=not-now]`,
  );
});

test('round one: changed picks and a partial coverage', () => {
  let picks = defaultPicks(roundOneQuestions(set, true));
  const q = (topic: string) => set.roundOne.find((entry) => entry.topic === topic)!;
  picks = withPick(picks, q('home'), 'internal');
  picks = withPick(picks, q('mode'), 'describe');
  picks = withPick(picks, q('coverage'), 'components', false);
  picks = withPick(picks, q('coverage'), 'patterns', false);
  picks = withPick(picks, q('dark'), 'include');
  const text = roundOneAnswer(TICKET, set, picks, true, '');
  assert.match(text, /^Round one: In Design Chamber; Describe only, never change the app’s code|^Round one: In Design Chamber; Describe only/);
  assert.match(text, /Foundations, Brand & marketing; Product core; dark values included\./);
  assert.match(text, /\[SystemAsk ticket=sb_abcdefghij12 round=1 home=internal mode=describe coverage=foundations,brand depth=core dark=include\]$/);
});

test('round one: ticking in any order keeps the question order; an unknown option changes nothing', () => {
  const q = set.roundOne.find((entry) => entry.topic === 'coverage')!;
  let picks: Record<string, readonly string[]> = { coverage: [] };
  picks = withPick(picks, q, 'brand') as Record<string, readonly string[]>;
  picks = withPick(picks, q, 'foundations') as Record<string, readonly string[]>;
  assert.deepEqual(picks.coverage, ['foundations', 'brand']);
  assert.equal(withPick(picks, q, 'nope'), picks);
  const radio = set.roundOne.find((entry) => entry.topic === 'home')!;
  assert.deepEqual(withPick({ home: ['repo'] }, radio, 'internal').home, ['internal']);
});

test('round one: no area picked turns Go with these off, with the reason', () => {
  const questions = roundOneQuestions(set, true);
  assert.equal(roundOneBlock(questions, defaultPicks(questions)), null);
  assert.equal(roundOneBlock(questions, { ...defaultPicks(questions), coverage: [] }), 'Pick at least one area to cover.');
});

test('round one with no project: home and mode are hidden and answered as in Design Chamber, code untouched', () => {
  const questions = roundOneQuestions(set, false);
  assert.deepEqual(questions.map((entry) => entry.topic), ['coverage', 'depth', 'dark']);
  const text = roundOneAnswer(TICKET, set, defaultPicks(questions), false, '');
  assert.match(text, /^Round one: no project folder, so the system lives in Design Chamber; all four areas; Product core; dark mode not now\.\n/);
  assert.match(text, /home=internal mode=describe coverage=foundations,components,patterns,brand depth=core dark=not-now\]$/);
});

test('round one: the note goes in the same answer, before the marker', () => {
  const picks = defaultPicks(roundOneQuestions(set, true));
  const text = roundOneAnswer(TICKET, set, picks, true, '  Keep the greys\nas they are.  ');
  const lines = text.split('\n');
  assert.equal(lines.at(-2), 'as they are.');
  assert.equal(lines.at(-3), 'Note: Keep the greys');
  assert.ok(lines.at(-1)?.startsWith('[SystemAsk ticket='));
});

// ---------------------------------------------------------------- round two

const CALLS = [
  { topic: 'status-colours', why: 'Amber in 12 files, orange in 8.', proposed: 'One warning tone' },
  { topic: 'greys', why: 'The greys lean blue.', proposed: 'Brand-tinted' },
  { topic: 'typography', why: 'One face today.', proposed: 'One font' },
  { topic: 'access', why: 'The repo is public.', proposed: 'Dev builds only' },
];

test('round two: Go with these sends the recommended option of every call shown', () => {
  const { calls, dropped } = resolveCalls(CALLS, 0, set);
  assert.equal(dropped, 0);
  const picks = defaultPicks(calls.map((call) => call.question));
  const text = roundTwoAnswer('acme', calls, picks, '');
  assert.equal(
    text,
    'Round two: Status colours: Brand-tuned set; Greys: Brand-tinted greys; Typography: One font only; Who can open the living page: Dev builds only.\n[SystemAsk system=acme round=2 status-colours=brand-tuned greys=brand-tinted typography=one-font access=dev]',
  );
});

test('round two: Custom says so in the sentence and the user\'s note rides along', () => {
  const { calls } = resolveCalls(CALLS.slice(0, 1), 0, set);
  const question = calls[0]!.question;
  const picks = withPick(defaultPicks([question]), question, 'custom');
  const text = roundTwoAnswer('acme', calls, picks, 'Use our own red.');
  assert.match(text, /Status colours: Custom \(see my note\)\./);
  assert.match(text, /\nNote: Use our own red\.\n\[SystemAsk system=acme round=2 status-colours=custom\]$/);
});

test('round two: topics the question set does not have are dropped and counted with the unreadable ones', () => {
  const { calls, dropped } = resolveCalls([...CALLS.slice(0, 2), { topic: 'home', why: 'a', proposed: 'b' }, { topic: 'invented', why: 'a', proposed: 'b' }], 1, set);
  assert.deepEqual(calls.map((call) => call.question.topic), ['status-colours', 'greys']);
  assert.equal(dropped, 3);
  assert.equal(droppedLine(1), '1 question couldn’t be shown; answer it in the chat.');
  assert.equal(droppedLine(3), '3 questions couldn’t be shown; answer them in the chat.');
  assert.equal(droppedLine(0), null);
});

// ---------------------------------------------------------------- the diff: buttons

test('Approve: every enabled-and-why case', () => {
  const view = proposal();
  assert.deepEqual(approveView(view, all(view), ID), { enabled: true, label: 'Approve all 4 parts', reason: null });
  assert.deepEqual(approveView(view, new Set<ProposalPartName>(['system-files', 'docs', 'living-page']), ID), { enabled: true, label: 'Approve 3 of 4 parts', reason: null });
  assert.deepEqual(approveView(view, new Set(), ID), { enabled: false, label: 'Approve 0 of 4 parts', reason: 'Turn on at least one part to approve.' });
  assert.equal(approveView(view, all(view), ID, true).enabled, false, 'not while an answer is on its way');
  assert.equal(approveView(proposal({ problems: ['The patch does not apply.'] }), all(view), ID).enabled, false);
  assert.match(approveView(proposal({ problems: ['x'] }), all(view), ID).reason ?? '', /problems/);
  assert.equal(approveView(null, new Set(), ID).reason, 'Loading the proposal…');
  assert.equal(approveView(proposal({ parts: [part('docs')] }), new Set<ProposalPartName>(['docs']), ID).label, 'Approve');
  assert.equal(approveView(proposal({ parts: [] }), new Set(), ID).enabled, false);
});

test('Approve is off for a proposal that is not the one the card names, or whose sha cannot be quoted', () => {
  const view = proposal();
  const other = approveView(view, all(view), 'p_zzzzzzzz');
  assert.equal(other.enabled, false);
  assert.match(other.reason ?? '', /different proposal/);
  for (const sha16 of ['', '0123456789abcde', '0123456789abcdef0', '0123456789ABCDEF', '0123456789abcdeg', 'has space....ab']) {
    const bad = { ...view, sha16 };
    const approve = approveView(bad, all(bad), ID);
    assert.equal(approve.enabled, false, `sha16 ${JSON.stringify(sha16)} refused`);
    assert.match(approve.reason ?? '', /couldn’t check/);
  }
  assert.equal(approveView(view, all(view), ID).enabled, true, 'the same view with the right id and sha is on');
});

test('Approve is off, with the sentence, for every state but current', () => {
  const states: Array<[ProposalView, string]> = [
    [{ state: 'superseded', by: 'p_newer123' }, 'A newer proposal replaced this one.'],
    [{ state: 'rewritten' }, 'The files changed after this proposal was written. Ask the agent for a new one.'],
    [{ state: 'approved', at: '2026-11-20T10:00:00.000Z' }, 'This proposal was already approved.'],
    [{ state: 'declined', at: '2026-11-20T10:00:00.000Z' }, 'This proposal was already declined.'],
    [{ state: 'unknown' }, 'Design Chamber can’t find this proposal. It may have been cleared.'],
    [{ state: 'unreadable', sentence: 'proposal.json is not valid.' }, 'proposal.json is not valid.'],
  ];
  for (const [view, sentence] of states) {
    assert.equal(proposalStateSentence(view), sentence);
    const approve = approveView(view, new Set(['docs']), ID);
    assert.deepEqual([approve.enabled, approve.reason], [false, sentence]);
    assert.equal(describeOffered(view), false);
  }
  assert.equal(proposalStateSentence(proposal()), null);
});

test('a proposal that cannot be found after a ready view turns Approve off (the block swaps to unknown)', () => {
  const ready = proposal();
  assert.equal(approveView(ready, all(ready), ID).enabled, true);
  const gone: ProposalView = { state: 'unknown' };
  const approve = approveView(gone, all(ready), ID);
  assert.equal(approve.enabled, false);
  assert.equal(approve.reason, 'Design Chamber can’t find this proposal. It may have been cleared.');
});

test('Describe only instead is offered only for a fix-mode proposal', () => {
  assert.equal(describeOffered(proposal({ mode: 'fix' })), true);
  assert.equal(describeOffered(proposal({ mode: 'describe' })), false);
  assert.equal(describeOffered(null), false);
});

test('preview buttons: the living page needs a repo home and a ready preview; the sentence is the service\'s or ours', () => {
  assert.deepEqual(previewButtons(proposal()), { livingPage: { shown: true, enabled: true }, board: { shown: true, enabled: true }, sentence: null });
  assert.deepEqual(previewButtons(proposal({ livingPage: 'generating' })).livingPage, { shown: true, enabled: false });
  assert.equal(previewButtons(proposal({ livingPage: 'generating' })).sentence, 'Design Chamber is drawing the preview…');
  assert.equal(previewButtons(proposal({ livingPage: 'failed' })).sentence, 'The preview couldn’t be drawn.');
  assert.equal(previewButtons(proposal({ livingPage: 'none' })).livingPage.shown, false);
  assert.equal(previewButtons(proposal({ repo: false })).livingPage.shown, false);
});

test('file rows, patches and use rewrites', () => {
  assert.equal(fileRowText(file('src/tokens.css')), 'src/tokens.css · Change · +12 −3');
  assert.equal(fileRowText(file('a.md', { change: 'create', added: 4, removed: 0 })), 'a.md · Create · +4 −0');
  assert.equal(fileRowText(file('b.md', { change: 'delete' })), 'b.md · Delete · +12 −3');
  assert.deepEqual(patchView(file('a')), { kind: 'patch', text: '@@ -1 +1 @@\n-a\n+b\n' });
  assert.deepEqual(patchView(file('a', { change: 'create', patch: null })), { kind: 'sentence', text: 'Created from the proposal. See the preview.' });
  assert.match(patchView(file('a', { patch: null, patchOmitted: true })).text, /too long/);
  const rewrites = part('token-fixes', [file('t.css'), file('u1.tsx', { usages: { count: 100, listed: false } }), file('u2.tsx', { usages: { count: 114, listed: false } }), file('u3.tsx', { usages: { count: 3, listed: true } })]);
  assert.deepEqual(unlistedUses(rewrites), { uses: 214, files: 2 });
  assert.equal(usesLine({ uses: 214, files: 38 }), '214 uses in 38 files. Listed in the chat.');
  assert.deepEqual(listedFiles(rewrites).map((f) => f.path), ['t.css', 'u3.tsx']);
  assert.equal(unlistedUses(part('docs')), null);
});

// ---------------------------------------------------------------- the diff: answers

test('Approve all: the sentence and the marker name the proposal, its sha and every part', () => {
  const view = proposal();
  assert.equal(
    approveAnswer('acme', view, all(view)),
    'Approve proposal p_k3m9q2x7: system files, token fixes, docs, living page.\n[SystemAsk system=acme approve=p_k3m9q2x7 sha=0123456789abcdef parts=system-files,token-fixes,docs,living-page]',
  );
});

test('Approve some: the skipped part is named in both lines', () => {
  const view = proposal();
  assert.equal(
    approveAnswer('acme', view, new Set<ProposalPartName>(['system-files', 'docs', 'living-page'])),
    'Approve proposal p_k3m9q2x7: system files, docs, living page; not token fixes.\n[SystemAsk system=acme approve=p_k3m9q2x7 sha=0123456789abcdef parts=system-files,docs,living-page skipped=token-fixes]',
  );
});

test('Describe only and Stop answers', () => {
  assert.equal(describeAnswer('acme', 'p_k3m9q2x7'), 'Decline proposal p_k3m9q2x7. Describe only instead.\n[SystemAsk system=acme decline=p_k3m9q2x7 then=describe]');
  assert.equal(stopAnswer('acme', 'Acme', 'p_k3m9q2x7'), 'Stop building Acme. Design Chamber removed the draft.\n[SystemAsk system=acme decline=p_k3m9q2x7 then=stop]');
});

// ---------------------------------------------------------------- the marker read back

test('every answer parses back: marker fields and the answered sentence', () => {
  const view = proposal();
  const some = approveAnswer('acme', view, new Set<ProposalPartName>(['system-files', 'docs', 'living-page']));
  assert.deepEqual(parseMarker(some), { system: 'acme', approve: 'p_k3m9q2x7', sha: '0123456789abcdef', parts: 'system-files,docs,living-page', skipped: 'token-fixes' });
  const approved = answeredView(some, set);
  assert.deepEqual([approved.kind, approved.headline, approved.lines, approved.parts], ['approve', 'You approved 3 parts of proposal p_k3m9q2x7.', ['Skipped: Token fixes.'], ['system-files', 'docs', 'living-page']]);
  assert.equal(answeredView(approveAnswer('acme', view, all(view)), set).headline, 'You approved all 4 parts of proposal p_k3m9q2x7.');

  assert.equal(answeredView(describeAnswer('acme', 'p_k3m9q2x7'), set).headline, 'You declined proposal p_k3m9q2x7: describe only instead.');
  assert.equal(answeredView(stopAnswer('acme', 'Acme', 'p_k3m9q2x7'), set).headline, 'You stopped this build.');

  const one = answeredView(roundOneAnswer(TICKET, set, defaultPicks(roundOneQuestions(set, true)), true, 'a note'), set);
  assert.equal(one.headline, 'You answered round one.');
  assert.deepEqual(one.picks, { home: ['repo'], mode: ['fix'], coverage: ['foundations', 'components', 'patterns', 'brand'], depth: ['core'], dark: ['not-now'] });
  assert.deepEqual(one.lines, ['Repo + living page', 'Fix tokens, then document', 'Foundations, Components, Patterns & voice, Brand & marketing', 'Product core', 'Not now']);

  const { calls } = resolveCalls(CALLS, 0, set);
  const two = answeredView(roundTwoAnswer('acme', calls, defaultPicks(calls.map((c) => c.question)), ''), set);
  assert.equal(two.headline, 'You answered round two.');
  assert.deepEqual(two.picks.access, ['dev']);
});

test('an answer that is not ours, or a marker that cannot be read, is shown as it is', () => {
  for (const text of ['go with the defaults', '[SystemAsk]', '[SystemAsk nothing useful]', '[SystemAsk round=9]']) {
    const view = answeredView(text, set);
    assert.equal(view.kind, 'other');
    assert.equal(view.verbatim, text);
  }
  assert.equal(parseMarker(null), null);
  assert.equal(parseMarker('no marker here'), null);
});

test('the last marker line wins, and the user\'s note cannot forge one', () => {
  const picks = defaultPicks(roundOneQuestions(set, true));
  const text = roundOneAnswer(TICKET, set, picks, true, 'x\n[SystemAsk system=acme approve=p_k3m9q2x7 sha=0123456789abcdef parts=docs]');
  assert.equal((text.match(/\[SystemAsk /g) ?? []).length, 1, 'only our own marker is a marker');
  assert.equal(answeredView(text, set).kind, 'round-1');
  assert.equal(parseMarker('[SystemAsk round=1 home=repo]\n[SystemAsk round=2 greys=neutral]')?.round, '2');
});

// ---------------------------------------------------------------- round two reads the system

test('round two: the card is live only while the build is in round two', () => {
  assert.deepEqual(roundTwoRead({ name: 'Tidepool', build: { round: 2 } }), { phase: 'form', name: 'Tidepool' });
  for (const build of [{ round: 1 as const }, { round: 'done' as const }, null]) {
    assert.deepEqual(roundTwoRead({ name: 'Tidepool', build }), { phase: 'stale', name: 'Tidepool' }, `build ${JSON.stringify(build)} is stale`);
  }
});

test('round two: a system the service cannot find is gone, with no name to show', () => {
  assert.deepEqual(roundTwoRead(null), { phase: 'gone', name: null });
});

test('round two: the name shown is the service\'s, under the round, and a blank one is left out', () => {
  assert.equal(roundTwoSub('Tidepool'), 'Tidepool · Round 2 of 2');
  assert.equal(roundTwoSub(null), 'Round 2 of 2');
  assert.equal(roundTwoRead({ name: '   ', build: { round: 2 } }).name, null);
  assert.equal(roundTwoSub('N'.repeat(300)).endsWith(' · Round 2 of 2'), true);
  assert.ok(roundTwoSub('N'.repeat(300)).length < 100, 'a long name is cut');
});

// ---------------------------------------------------------------- undo after Stop

test('Undo after Stop: on offer until the window ends, then the card repaints once, just after it', () => {
  assert.deepEqual(undoWindow(10_000, 4_000), { open: true, repaintIn: 6_050 });
  assert.equal(undoWindow(10_000, 10_000).open, false, 'the window is shut at until');
  assert.equal(undoWindow(10_000, 12_000).open, false);
  assert.equal(undoWindow(Number.NaN, 0).open, false, 'a time that cannot be read offers no Undo');
});

// ---------------------------------------------------------------- limits

test('the longest possible answers stay within the host limit and keep their marker', () => {
  const huge = 'é'.repeat(GUEST_BLOCK_ANSWER_MAX * 2);
  const picks = defaultPicks(roundOneQuestions(set, true));
  const one = roundOneAnswer(TICKET, set, picks, true, huge);
  assert.ok(Array.from(one).length <= GUEST_BLOCK_ANSWER_MAX, `round one ${one.length}`);
  assert.ok(one.endsWith(']') && one.includes('[SystemAsk ticket='));
  const { calls } = resolveCalls(Object.keys(set.roundTwo).length ? set.roundTwo.map((q) => ({ topic: q.topic, why: 'w', proposed: 'p' })) : [], 0, set);
  const two = roundTwoAnswer('x'.repeat(63), calls, defaultPicks(calls.map((c) => c.question)), huge);
  assert.ok(Array.from(two).length <= GUEST_BLOCK_ANSWER_MAX, `round two ${two.length}`);
  assert.ok(two.endsWith(']'));
  const parts: ProposalPart[] = (['system-files', 'token-fixes', 'docs', 'living-page'] as const).map((name) => part(name));
  const big = proposal({ parts });
  const approve = approveAnswer('x'.repeat(63), big, all(big));
  assert.ok(approve.length <= GUEST_BLOCK_ANSWER_MAX);
  const stop = stopAnswer('x'.repeat(63), 'N'.repeat(500), 'p_k3m9q2x7zzzzzzz');
  assert.ok(stop.length <= GUEST_BLOCK_ANSWER_MAX);
  assert.ok(composeAnswer('s', '[SystemAsk a=b]', huge).length <= GUEST_BLOCK_ANSWER_MAX);
});

test('a marker leaves out any value that is not plain id text', () => {
  assert.equal(markerLine([['system', 'acme'], ['sha', 'has space'], ['x', 'a]b'], ['parts', 'a,b']]), '[SystemAsk system=acme parts=a,b]');
});

// ---------------------------------------------------------------- when to stop asking (review finding F4)

test('a ticket that expired or made its system is never asked about again', () => {
  assert.equal(ticketVerdict('waiting'), 'again');
  assert.equal(ticketVerdict('expired'), 'done');
  assert.equal(ticketVerdict('made'), 'done');
});

test('round two stops for a gone system or a finished build, and slows down while the round is not there', () => {
  assert.equal(roundTwoVerdict(null), 'done');
  assert.equal(roundTwoVerdict({ build: { round: 'done' } }), 'done');
  assert.equal(roundTwoVerdict({ build: { round: 2 } }), 'again');
  assert.equal(roundTwoVerdict({ build: { round: 1 } }), 'later');
  assert.equal(roundTwoVerdict({ build: null }), 'later');
});

test('a proposal that was answered, replaced or can’t be found is final', () => {
  const final: ProposalView[] = [{ state: 'approved', at: 'x' }, { state: 'declined', at: 'x' }, { state: 'superseded', by: null }, { state: 'unknown' }];
  for (const view of final) assert.equal(proposalVerdict(view), 'done', view.state);
  assert.equal(proposalVerdict({ state: 'rewritten' }), 'again');
  assert.equal(proposalVerdict({ state: 'unreadable', sentence: 'Half written.' }), 'again');
});

// ---------------------------------------------------------------- phone copy (native-extras §2.2)

const PHONE: Device = { form: 'phone', coarse: true, insets: { top: 0, right: 0, bottom: 34, left: 0 }, keyboard: 0 };

test('a desktop keeps its sentences; a phone never says "rail"', () => {
  const desktop = askCopy(DESKTOP_DEVICE, true);
  assert.equal(desktop.serviceDown, SERVICE_DOWN);
  assert.equal(desktop.previewOpened('board-preview'), 'The board is open in the rail.');
  assert.equal(desktop.previewNotHere, 'Open Design Chamber from the rail to see the preview.');
  for (const panel of [true, false]) {
    const phone = askCopy(PHONE, panel);
    for (const line of [phone.serviceDown, phone.previewOpened('board-preview'), phone.previewOpened('living-page-preview'), phone.previewNotHere, phone.previewFailed]) {
      assert.doesNotMatch(line, /rail/);
    }
    assert.match(phone.serviceDown, /on your computer/);
    assert.match(phone.previewNotHere, /More menu/);
  }
});
