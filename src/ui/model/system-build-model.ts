// View-model of the build chip on the rail and of "Build with the agent…" (Phase 2.5 U7, technical design §9.6). Pure:
// no DOM, no host calls. The chip's states come from the answers of `GET /system-builds/:ticket`, a failed poll
// and, once a system is made, one look at whether that system is still there. Every sentence is pinned by a test.

import type { SystemBuildTicketResponse } from '../../shared/api.ts';
import type { BuildSystemResult } from '../../guest/flows.ts';
import { BRIEF_MAX } from '../../shared/limits.ts';
import { isServiceDownCode, type RowTone } from './systems-model.ts';

/** A poll that fails this many times in a row stops, and the chip says so (§9.6). */
export const BUILD_POLL_FAILURES_MAX = 3;

/** What the chip is called until the system has a name. */
export const BUILD_CHIP_TITLE = 'New design system';

export type MadeProbe = 'checking' | 'present' | 'gone' | 'unknown';

/** Where the chip is. `failures` counts failed polls in a row (it resets with any answer). */
export type BuildChipModel =
  | { phase: 'loading'; failures: number }
  | { phase: 'waiting'; project: string | null; failures: number }
  | { phase: 'made'; id: string; name: string; probe: MadeProbe }
  | { phase: 'expired' }
  | { phase: 'service-down'; message: string }
  | { phase: 'failed'; message: string };

export const startBuildChip = (): BuildChipModel => ({ phase: 'loading', failures: 0 });

/** An answer of the ticket route. A system that is made stays made: a late `waiting` never takes it back. */
export const afterAnswer = (model: BuildChipModel, answer: SystemBuildTicketResponse): BuildChipModel => {
  if (model.phase === 'made' || model.phase === 'expired') return model;
  if (answer.state === 'waiting') return { phase: 'waiting', project: answer.project?.label ?? null, failures: 0 };
  if (answer.state === 'made') return { phase: 'made', id: answer.id, name: answer.name, probe: 'checking' };
  return { phase: 'expired' };
};

/** A poll that failed: the service not answering is its own state at once; anything else gets three tries. */
export const afterFailure = (model: BuildChipModel, error: { code: string; message: string }): BuildChipModel => {
  if (model.phase === 'made' || model.phase === 'expired') return model;
  if (isServiceDownCode(error.code)) return { phase: 'service-down', message: error.message };
  const failures = (model.phase === 'loading' || model.phase === 'waiting' ? model.failures : 0) + 1;
  if (failures >= BUILD_POLL_FAILURES_MAX) return { phase: 'failed', message: error.message };
  return model.phase === 'waiting' ? { ...model, failures } : { phase: 'loading', failures };
};

/** The look at the made system: still there, gone (the build was stopped), or could not be decided. */
export const afterProbe = (model: BuildChipModel, probe: Exclude<MadeProbe, 'checking'>): BuildChipModel => (model.phase === 'made' ? { ...model, probe } : model);

/** Whether the next tick should ask the service again. */
export const keepsPolling = (model: BuildChipModel): boolean => model.phase === 'loading' || model.phase === 'waiting';

export type ChipActionId = 'continue-chat' | 'open-system' | 'try-again';
export type ChipAction = { id: ChipActionId; label: string; primary: boolean };

export type ChipViewState = 'loading' | 'waiting' | 'opening' | 'made' | 'stopped' | 'expired' | 'service-down' | 'failed';

export type ChipView = {
  state: ChipViewState;
  title: string;
  tone: RowTone;
  /** The label of the spinner while something is being checked. */
  spinner: string | null;
  body: string | null;
  /** A muted line under the body. */
  note: string | null;
  /** A failure drawn with the kit's error banner. */
  problem: { title: string; body: string } | null;
  actions: ChipAction[];
};

const CONTINUE: ChipAction = { id: 'continue-chat', label: 'Continue in chat', primary: true };
const TRY_AGAIN: ChipAction = { id: 'try-again', label: 'Try again', primary: true };

export const WAITING_BODY = 'The agent is interviewing you in chat. The design system shows here once it’s started.';
export const STOPPED_BODY = 'This build was stopped. Its draft is in the Designs folder’s trash.';
export const EXPIRED_BODY = 'This build was started more than a week ago. Run /design-system again.';

export const chipView = (model: BuildChipModel): ChipView => {
  const base = { title: BUILD_CHIP_TITLE, tone: 'neutral' as RowTone, spinner: null, body: null, note: null, problem: null, actions: [] as ChipAction[] };
  switch (model.phase) {
    case 'loading':
      return { ...base, state: 'loading', spinner: 'Checking the build…' };
    case 'waiting':
      return { ...base, state: 'waiting', tone: 'info', body: WAITING_BODY, note: model.project === null ? null : `Project: ${model.project}`, actions: [CONTINUE] };
    case 'made':
      if (model.probe === 'checking' || model.probe === 'present') return { ...base, state: 'opening', title: model.name, tone: 'info', spinner: `Opening ${model.name}…` };
      if (model.probe === 'gone') return { ...base, state: 'stopped', tone: 'warning', body: STOPPED_BODY, actions: [CONTINUE] };
      return {
        ...base,
        state: 'made',
        title: model.name,
        tone: 'info',
        body: `${model.name} was started, but Design Chamber couldn’t open it just now.`,
        actions: [
          { id: 'open-system', label: 'Open system', primary: true },
          { ...CONTINUE, primary: false },
        ],
      };
    case 'expired':
      return { ...base, state: 'expired', body: EXPIRED_BODY };
    case 'service-down':
      return { ...base, state: 'service-down', tone: 'error', problem: { title: 'Design Chamber isn’t running', body: model.message }, actions: [TRY_AGAIN] };
    case 'failed':
      return { ...base, state: 'failed', tone: 'error', problem: { title: 'Couldn’t check the build', body: model.message }, actions: [TRY_AGAIN] };
  }
};

// ---------------------------------------------------------------- Build with the agent…

export type BuildDestination = 'current-chat' | 'new-chat';

export const BUILD_DESTINATION_LABEL: Record<BuildDestination, string> = { 'current-chat': 'This chat', 'new-chat': 'New chat' };

export type BuildSetup = {
  /** The tabs, in order. A new chat needs a project folder, so it is not offered without one. */
  offered: Array<{ id: BuildDestination; label: string }>;
  initial: BuildDestination;
};

export const buildSetup = (context: { hasSession: boolean; hasProject: boolean }): BuildSetup => ({
  offered: [
    { id: 'current-chat', label: BUILD_DESTINATION_LABEL['current-chat'] },
    ...(context.hasProject ? [{ id: 'new-chat' as const, label: BUILD_DESTINATION_LABEL['new-chat'] }] : []),
  ],
  initial: context.hasSession || !context.hasProject ? 'current-chat' : 'new-chat',
});

/** The line under the tabs: what the choice does, or why Start cannot work yet. */
export const destinationHint = (destination: BuildDestination, context: { hasSession: boolean }): { text: string; blocked: boolean } => {
  if (destination === 'current-chat') {
    return context.hasSession ? { text: 'The agent interviews you in the chat you have open.', blocked: false } : { text: 'No chat is open right now. Open one first.', blocked: true };
  }
  return { text: 'Starts a chat in this project.', blocked: false };
};

export const briefProblem = (brief: string): string | null => (brief.length > BRIEF_MAX ? `Keep it under ${BRIEF_MAX} characters.` : null);

/** The toast once the request reached a chat. */
export const startedText = (result: Exclude<BuildSystemResult, { outcome: 'not-sent' }>): string => {
  switch (result.outcome) {
    case 'sent':
      return 'Asked the agent to build a design system. Answer its questions in the chat.';
    case 'composed':
      return 'The agent is busy, so the request is waiting in the chat composer.';
    case 'new-session':
      return 'Started a chat for the agent. Answer its questions there.';
  }
};

export const NOT_SENT_TITLE = 'Couldn’t ask the agent';
export const NOT_SENT_BODY = 'The request didn’t reach a chat. Your words are still here.';
