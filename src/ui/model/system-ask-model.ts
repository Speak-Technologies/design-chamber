// The SystemAsk chat block as data (documentation/specs/phase-2-5-technical.md §8.12): which
// questions each round shows, the answer text and marker line every action sends, what a replayed
// answer says, and which buttons of a proposal are on and why. Pure: no DOM, no host or service
// calls. The question set is a parameter because the build bakes it into the blocks bundle
// (`__DC_SYSTEM_QUESTIONS__`), which tests do not have.
//
// Answers are built only from state the block has already drawn and loaded, so a click can send
// them at once: the host takes an answer only inside the user's activation, which lapses in seconds.

import { GUEST_BLOCK_ANSWER_MAX } from '@openchamber/sdk';

import { SYSTEM_ASK_CALLS_MAX } from '../../shared/limits.ts';
import type { ProposalFile, ProposalPart, ProposalPartName, ProposalView, SystemQuestion, SystemQuestionSet } from '../../shared/types.ts';
import { clipText, type SystemAskCall } from './block-args.ts';

// ---------------------------------------------------------------- picks

/** topic → the chosen option ids (one for a radio group, any number for a checkbox group). */
export type Picks = Readonly<Record<string, readonly string[]>>;

/** The recommended option of every question: what "Go with these" sends untouched. */
export const defaultPicks = (questions: readonly SystemQuestion[]): Picks =>
  Object.fromEntries(questions.map((question) => [question.topic, question.options.filter((option) => option.recommended).map((option) => option.choice)]));

/** One option chosen (radio) or ticked/unticked (checkbox). An id the question does not have changes nothing. */
export const withPick = (picks: Picks, question: SystemQuestion, choice: string, on = true): Picks => {
  if (!question.options.some((option) => option.choice === choice)) return picks;
  if (!question.multiple) return { ...picks, [question.topic]: [choice] };
  const now = picks[question.topic] ?? [];
  // Keep the order the question lists them in, whatever order the user ticked them.
  const next = question.options.map((option) => option.choice).filter((id) => (id === choice ? on : now.includes(id)));
  return { ...picks, [question.topic]: next };
};

const optionLabel = (question: SystemQuestion, choice: string): string => question.options.find((option) => option.choice === choice)?.label ?? choice;

const picksOf = (picks: Picks, question: SystemQuestion): readonly string[] => picks[question.topic] ?? [];

// ---------------------------------------------------------------- round one

export const NO_PROJECT_LINE = 'No project folder is open in this chat, so the system will live in Design Chamber and your code stays untouched.';

/** Asked only when the chat has a project folder: without one the answer is already known. */
const PROJECT_TOPICS: readonly string[] = ['home', 'mode'];
/** What a chat with no project folder answers for the two hidden questions. */
const NO_PROJECT_PICKS: Picks = { home: ['internal'], mode: ['describe'] };

export const roundOneQuestions = (set: SystemQuestionSet, hasProject: boolean): SystemQuestion[] =>
  hasProject ? [...set.roundOne] : set.roundOne.filter((question) => !PROJECT_TOPICS.includes(question.topic));

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const coverageText = (question: SystemQuestion, chosen: readonly string[]): string => {
  const total = question.options.length;
  if (chosen.length === total) return `all ${WORDS[total] ?? String(total)} areas`;
  return chosen.length === 0 ? 'no areas' : chosen.map((choice) => optionLabel(question, choice)).join(', ');
};

const darkText = (question: SystemQuestion, chosen: readonly string[]): string => {
  const choice = chosen[0];
  if (choice === 'not-now') return 'dark mode not now';
  if (choice === 'include') return 'dark values included';
  return choice === undefined ? 'dark mode not chosen' : optionLabel(question, choice);
};

/** Why "Go with these" is off, or null. Round one needs at least one area to cover. */
export const roundOneBlock = (questions: readonly SystemQuestion[], picks: Picks): string | null => {
  const coverage = questions.find((question) => question.topic === 'coverage');
  return coverage && picksOf(picks, coverage).length === 0 ? 'Pick at least one area to cover.' : null;
};

// ---------------------------------------------------------------- round two

export type RoundTwoCall = { question: SystemQuestion; why: string; proposed: string };

/**
 * The calls the baked question set can show. A call whose topic is not a round-two topic is dropped,
 * and counted with the ones `parseSystemAskArgs` already could not read.
 */
export const resolveCalls = (calls: readonly SystemAskCall[], dropped: number, set: SystemQuestionSet): { calls: RoundTwoCall[]; dropped: number } => {
  const shown: RoundTwoCall[] = [];
  let lost = dropped;
  for (const call of calls) {
    const question = set.roundTwo.find((entry) => entry.topic === call.topic);
    if (!question || shown.length >= SYSTEM_ASK_CALLS_MAX) lost += 1;
    else shown.push({ question, why: call.why, proposed: call.proposed });
  }
  return { calls: shown, dropped: lost };
};

export const droppedLine = (count: number): string | null =>
  count <= 0 ? null : count === 1 ? '1 question couldn’t be shown; answer it in the chat.' : `${count} questions couldn’t be shown; answer them in the chat.`;

/** Custom has no fixed text: the user says it in the note. */
export const isCustom = (picks: Picks, question: SystemQuestion): boolean => picksOf(picks, question).includes('custom');

export const CUSTOM_LINE = 'Say what you want in the note below.';

// ---------------------------------------------------------------- the answer text

const FIELD = /^[a-z0-9_,-]+$/;

/** `[SystemAsk a=b c=d,e]`: the line the skill parses. A value that is not plain id text is left out. */
export const markerLine = (fields: ReadonlyArray<readonly [string, string]>): string =>
  `[SystemAsk ${fields.filter(([key, value]) => FIELD.test(key) && FIELD.test(value)).map(([key, value]) => `${key}=${value}`).join(' ')}]`;

/** The user's own words go in as text; a copy of our marker in them can't pass for a second one. */
const cleanNote = (note: string): string => note.replace(/\r\n?/g, '\n').replace(/\[SystemAsk/gi, '(SystemAsk').trim();

/**
 * One sentence, the user's note when there is one, then the marker line, within the host's answer
 * limit. Only the note is ever cut.
 */
export const composeAnswer = (sentence: string, marker: string, note = ''): string => {
  const words = cleanNote(note);
  const head = `${sentence}\n`;
  const room = GUEST_BLOCK_ANSWER_MAX - head.length - marker.length - 1 - 'Note: '.length - 1;
  const kept = words === '' || room <= 0 ? '' : Array.from(words).slice(0, room).join('');
  return `${head}${kept === '' ? '' : `Note: ${kept}\n`}${marker}`;
};

const csv = (values: readonly string[]): string => values.join(',');

const withHome = (picks: Picks, hasProject: boolean): Picks => (hasProject ? picks : { ...picks, ...NO_PROJECT_PICKS });

export const roundOneAnswer = (ticket: string, set: SystemQuestionSet, picksNow: Picks, hasProject: boolean, note: string): string => {
  const picks = withHome(picksNow, hasProject);
  const parts: string[] = [];
  const fields: Array<[string, string]> = [['ticket', ticket], ['round', '1']];
  for (const question of set.roundOne) {
    const chosen = picksOf(picks, question);
    fields.push([question.topic, csv(chosen)]);
    if (question.topic === 'coverage') parts.push(coverageText(question, chosen));
    else if (question.topic === 'dark') parts.push(darkText(question, chosen));
    else if (hasProject || !PROJECT_TOPICS.includes(question.topic)) parts.push(chosen.map((choice) => optionLabel(question, choice)).join(', '));
  }
  const lead = hasProject ? '' : 'no project folder, so the system lives in Design Chamber; ';
  return composeAnswer(`Round one: ${lead}${parts.filter((part) => part !== '').join('; ')}.`, markerLine(fields), note);
};

export const roundTwoAnswer = (systemId: string, calls: readonly RoundTwoCall[], picks: Picks, note: string): string => {
  const fields: Array<[string, string]> = [['system', systemId], ['round', '2']];
  const parts = calls.map(({ question }) => {
    const chosen = picksOf(picks, question);
    fields.push([question.topic, csv(chosen)]);
    const text = chosen.map((choice) => optionLabel(question, choice)).join(', ');
    return `${question.label}: ${text}${chosen.includes('custom') ? ' (see my note)' : ''}`;
  });
  return composeAnswer(`Round two: ${parts.join('; ')}.`, markerLine(fields), note);
};

// ---------------------------------------------------------------- the diff

export const PART_LABELS: Record<ProposalPartName, string> = {
  'system-files': 'System files',
  'token-fixes': 'Token fixes',
  docs: 'Docs',
  'living-page': 'Living page',
};

export const MODE_LABEL: Record<'fix' | 'describe', string> = { fix: 'Fix tokens, then document', describe: 'Describe only' };

export type CurrentProposal = Extract<ProposalView, { state: 'current' }>;

export const isCurrent = (view: ProposalView | null): view is CurrentProposal => view !== null && view.state === 'current';

/** The sentence a proposal that can no longer be approved says; null for the current one. */
export const proposalStateSentence = (view: ProposalView): string | null => {
  switch (view.state) {
    case 'current':
      return null;
    case 'superseded':
      return 'A newer proposal replaced this one.';
    case 'rewritten':
      return 'The files changed after this proposal was written. Ask the agent for a new one.';
    case 'approved':
      return 'This proposal was already approved.';
    case 'declined':
      return 'This proposal was already declined.';
    case 'unknown':
      return 'Design Chamber can’t find this proposal. It may have been cleared.';
    case 'unreadable':
      return view.sentence;
  }
};

export const partCountText = (part: ProposalPart): string => `${part.files.length} ${part.files.length === 1 ? 'file' : 'files'}`;

/** What a part's switch says under its name: how many files, and how many lines they add and remove. */
export const partStat = (part: ProposalPart): string => {
  const added = part.files.reduce((sum, file) => sum + file.added, 0);
  const removed = part.files.reduce((sum, file) => sum + file.removed, 0);
  return `${partCountText(part)} · +${added} −${removed}`;
};

/** The words a part's switch announces: its name, and that it is part of the approval. */
export const partLabel = (name: string): string => (name in PART_LABELS ? PART_LABELS[name as ProposalPartName] : name);

const CHANGE_WORD: Record<ProposalFile['change'], string> = { create: 'Create', modify: 'Change', delete: 'Delete' };

export const fileRowText = (file: ProposalFile): string => `${file.path} · ${CHANGE_WORD[file.change]} · +${file.added} −${file.removed}`;

/** What opening a file row shows: its patch (text), or the one sentence that says why there is none. */
export type PatchView = { kind: 'patch'; text: string } | { kind: 'sentence'; text: string };

export const patchView = (file: ProposalFile): PatchView => {
  if (file.patch !== null && file.patch !== '') return { kind: 'patch', text: file.patch };
  if (file.patchOmitted) return { kind: 'sentence', text: 'This patch was too long to show here. The file is in the proposal folder.' };
  if (file.change === 'create') return { kind: 'sentence', text: 'Created from the proposal. See the preview.' };
  return { kind: 'sentence', text: file.summary === '' ? 'No patch was provided for this file.' : file.summary };
};

/** Files that only count their rewritten uses, without listing them, are one line: "214 uses in 38 files". */
export const unlistedUses = (part: ProposalPart): { uses: number; files: number } | null => {
  const unlisted = part.files.filter((file) => file.usages !== null && !file.usages.listed);
  if (unlisted.length === 0) return null;
  return { uses: unlisted.reduce((sum, file) => sum + (file.usages?.count ?? 0), 0), files: unlisted.length };
};

export const usesLine = (uses: { uses: number; files: number }): string =>
  `${uses.uses} ${uses.uses === 1 ? 'use' : 'uses'} in ${uses.files} ${uses.files === 1 ? 'file' : 'files'}. Listed in the chat.`;

/** The files a part lists one by one: the unlisted use rewrites are summarised instead. */
export const listedFiles = (part: ProposalPart): ProposalFile[] => part.files.filter((file) => file.usages === null || file.usages.listed);

export type PreviewButtons = {
  livingPage: { shown: boolean; enabled: boolean };
  board: { shown: boolean; enabled: boolean };
  /** The service's sentence about the preview, or ours when it gave none. */
  sentence: string | null;
};

export const previewButtons = (view: CurrentProposal): PreviewButtons => {
  const { preview, proposal } = view;
  const repo = proposal.home.kind === 'repo';
  const page = preview.livingPage;
  return {
    livingPage: { shown: repo && page !== 'none', enabled: page === 'ready' },
    board: { shown: preview.board, enabled: preview.board },
    sentence:
      page === 'generating' ? (preview.sentence ?? 'Design Chamber is drawing the preview…') : page === 'failed' ? (preview.sentence ?? 'The preview couldn’t be drawn.') : preview.sentence,
  };
};

export const selectedParts = (view: CurrentProposal, on: ReadonlySet<ProposalPartName>): ProposalPartName[] =>
  view.proposal.parts.filter((part) => on.has(part.name)).map((part) => part.name);

export type ApproveView = { enabled: boolean; label: string; reason: string | null };

/**
 * The Approve button: its words, and when it is off, why. Only a current proposal with no problem and
 * at least one part switched on can be approved, and not while an answer is already on its way.
 */
export const approveView = (view: ProposalView | null, on: ReadonlySet<ProposalPartName>, busy = false): ApproveView => {
  if (view === null) return { enabled: false, label: 'Approve', reason: LOADING_PROPOSAL };
  if (!isCurrent(view)) return { enabled: false, label: 'Approve', reason: proposalStateSentence(view) };
  const total = view.proposal.parts.length;
  const count = selectedParts(view, on).length;
  const label = total <= 1 ? 'Approve' : count === total ? `Approve all ${total} parts` : `Approve ${count} of ${total} parts`;
  if (view.proposal.problems.length > 0) return { enabled: false, label, reason: 'This proposal has problems, so it can’t be approved. Ask the agent to fix them.' };
  if (total === 0) return { enabled: false, label, reason: 'This proposal has nothing in it to approve.' };
  if (count === 0) return { enabled: false, label, reason: 'Turn on at least one part to approve.' };
  return { enabled: !busy, label, reason: null };
};

export const approveAnswer = (systemId: string, view: CurrentProposal, on: ReadonlySet<ProposalPartName>): string => {
  const names = view.proposal.parts.map((part) => part.name);
  const chosen = names.filter((name) => on.has(name));
  const skipped = names.filter((name) => !on.has(name));
  const lower = (list: readonly string[]): string => list.map((name) => partLabel(name).toLowerCase()).join(', ');
  const sentence = `Approve proposal ${view.proposal.id}: ${lower(chosen)}${skipped.length > 0 ? `; not ${lower(skipped)}` : ''}.`;
  const fields: Array<[string, string]> = [['system', systemId], ['approve', view.proposal.id], ['sha', view.sha16], ['parts', csv(chosen)]];
  if (skipped.length > 0) fields.push(['skipped', csv(skipped)]);
  return composeAnswer(sentence, markerLine(fields));
};

export const describeAnswer = (systemId: string, proposalId: string): string =>
  composeAnswer(`Decline proposal ${proposalId}. Describe only instead.`, markerLine([['system', systemId], ['decline', proposalId], ['then', 'describe']]));

export const stopAnswer = (systemId: string, name: string, proposalId: string): string =>
  composeAnswer(`Stop building ${clipText(name, 60)}. Design Chamber removed the draft.`, markerLine([['system', systemId], ['decline', proposalId], ['then', 'stop']]));

/** "Describe only instead" is offered only when the proposal is the fix-mode one. */
export const describeOffered = (view: ProposalView | null): boolean => isCurrent(view) && view.proposal.mode === 'fix';

/** A system's name for the answer: the service's, else its id. */
export const systemName = (detailName: string | null, systemId: string): string => (detailName !== null && detailName.trim() !== '' ? detailName : systemId);

export const diffTitle = (view: CurrentProposal): { target: string; mode: string | null } => {
  const { home, mode } = view.proposal;
  return {
    target: home.kind === 'repo' ? `Proposed changes to ${home.label}` : 'Proposed changes in Design Chamber',
    mode: mode === 'none' ? null : MODE_LABEL[mode],
  };
};

// ---------------------------------------------------------------- what a replayed answer says

/** `[SystemAsk k=v …]` as fields, from the last such line of an answer; null when there is none. */
export const parseMarker = (text: string | null): Record<string, string> | null => {
  if (text === null) return null;
  const found = [...text.matchAll(/\[SystemAsk ([^\]\n]*)\]/g)].at(-1);
  if (!found) return null;
  const fields: Record<string, string> = {};
  for (const entry of (found[1] ?? '').split(' ')) {
    const at = entry.indexOf('=');
    if (at <= 0) continue;
    const key = entry.slice(0, at);
    const value = entry.slice(at + 1);
    if (FIELD.test(key) && FIELD.test(value)) fields[key] = value;
  }
  return Object.keys(fields).length === 0 ? null : fields;
};

export type AnsweredKind = 'round-1' | 'round-2' | 'approve' | 'describe' | 'stop' | 'other';

export type AnsweredView = {
  kind: AnsweredKind;
  headline: string;
  /** The picks of a round, as the option labels, or what was skipped. */
  lines: string[];
  /** For an answer that is not ours (a typed note answered the block): its words. */
  verbatim: string | null;
  /** The ids marked in the form (a round), for the read-only view. */
  picks: Picks;
  /** The parts approved, for the read-only diff. */
  parts: ProposalPartName[];
};

const PART_NAMES: readonly string[] = Object.keys(PART_LABELS);
const split = (value: string | undefined): string[] => (value === undefined || value === '' ? [] : value.split(','));

export const answeredView = (answered: string, set: SystemQuestionSet): AnsweredView => {
  const fields = parseMarker(answered);
  const base: AnsweredView = { kind: 'other', headline: 'You answered in the chat:', lines: [], verbatim: clipText(answered, 400), picks: {}, parts: [] };
  if (fields === null) return base;
  const approve = fields.approve;
  const decline = fields.decline;
  if (approve !== undefined) {
    const parts = split(fields.parts).filter((name): name is ProposalPartName => PART_NAMES.includes(name));
    const skipped = split(fields.skipped).filter((name) => PART_NAMES.includes(name));
    const count = parts.length;
    return {
      ...base,
      kind: 'approve',
      headline: skipped.length === 0 && count > 1 ? `You approved all ${count} parts of proposal ${approve}.` : `You approved ${count} ${count === 1 ? 'part' : 'parts'} of proposal ${approve}.`,
      lines: skipped.length === 0 ? [] : [`Skipped: ${skipped.map(partLabel).join(', ')}.`],
      verbatim: null,
      parts,
    };
  }
  if (decline !== undefined) {
    return fields.then === 'stop'
      ? { ...base, kind: 'stop', headline: 'You stopped this build.', verbatim: null }
      : { ...base, kind: 'describe', headline: `You declined proposal ${decline}: describe only instead.`, verbatim: null };
  }
  if (fields.round === '1' || fields.round === '2') {
    const questions = fields.round === '1' ? set.roundOne : set.roundTwo;
    const picks: Record<string, string[]> = {};
    const lines: string[] = [];
    for (const question of questions) {
      if (fields[question.topic] === undefined) continue;
      const chosen = split(fields[question.topic]);
      picks[question.topic] = chosen;
      lines.push(chosen.map((choice) => optionLabel(question, choice)).join(', '));
    }
    return {
      ...base,
      kind: fields.round === '1' ? 'round-1' : 'round-2',
      headline: fields.round === '1' ? 'You answered round one.' : 'You answered round two.',
      lines: lines.filter((line) => line !== ''),
      verbatim: null,
      picks,
    };
  }
  return base;
};

// ---------------------------------------------------------------- sentences

export const LOADING_PROPOSAL = 'Loading the proposal…';
export const SERVICE_DOWN = 'Design Chamber isn’t running. Open it from the rail, then try again.';
export const BAD_BLOCK = 'This question couldn’t be read. Answer in the chat instead.';
export const REFUSED_ANSWER = 'Couldn’t send your answer. Type it in the chat instead.';
export const HOST_CANNOT_TAKE = 'Reply in the chat to answer.';
export const OUT_OF_DATE = 'This question is out of date. Reply in the chat if the agent still needs something.';
export const TICKET_EXPIRED = 'This build has expired. Run /design-system again to start over.';
