// What the build strip says (documentation/specs/phase-1-review-loop.md §2.3, §2.5): one view
// per phase, from a `BuildTrack` and the clock. Pure: no DOM, no host. The full-screen strip
// shows `text` and `detail`; the rail pill shows `pill`. `announce` is what the live region
// speaks: it changes only with the phase or the file, never as seconds or minutes tick.

import { QUIET_MS, phaseOf, type BuildPhase, type BuildTrack } from '../../guest/build-activity.ts';
import { middlePath, plural, relativeTime } from './format.ts';

export type BuildAction = 'open-chat' | 'dismiss';
export type BuildTone = 'info' | 'success' | 'warning' | 'error';

export type BuildView = {
  phase: BuildPhase;
  /** Full-screen strip text. */
  text: string;
  /** Rail pill text. */
  pill: string;
  /** Secondary line after the text; the strip drops it first when short of room. */
  detail: string | null;
  /** "0:42" while the agent works, from the turn start; shown after the text, not announced. */
  elapsed: string | null;
  /** The whole file path, for a tooltip, when the text names a file. */
  title: string | null;
  tone: BuildTone;
  actions: BuildAction[];
  announce: string | null;
};

const SECOND = 1000;

/** "0:42", "12:05", "1:02:03". Whole seconds, never negative. */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
};

const basename = (path: string): string => path.split('/').filter((part) => part !== '').at(-1) ?? path;

/** The full path fits what a toolbar line can hold; the pill gets room for the basename only. */
const FULL_PATH_MAX = 48;
const NAME_MAX = 24;

const HIDDEN: BuildView = { phase: 'hidden', text: '', pill: '', detail: null, elapsed: null, title: null, tone: 'info', actions: [], announce: null };

type Copy = { text: string; pill: string; tone: BuildTone; actions?: BuildAction[]; detail?: string | null; title?: string | null; elapsed?: boolean };

const view = (phase: BuildPhase, track: BuildTrack, now: number, copy: Copy): BuildView => ({
  phase,
  text: copy.text,
  pill: copy.pill,
  detail: copy.detail ?? null,
  elapsed: copy.elapsed && track.turnStartedAt !== null ? formatElapsed(now - track.turnStartedAt) : null,
  title: copy.title ?? null,
  tone: copy.tone,
  actions: copy.actions ?? [],
  announce: copy.text,
});

export const buildView = (track: BuildTrack, now: number, locale = 'en'): BuildView => {
  const phase = phaseOf(track, now);
  const last = track.lastFile;
  switch (phase) {
    case 'hidden':
      return HIDDEN;
    case 'offline':
      return view(phase, track, now, { text: 'Reconnecting to the local service', pill: 'Reconnecting', tone: 'warning' });
    case 'question':
      return view(phase, track, now, { text: 'The agent is asking you something in the chat', pill: 'Agent has a question', tone: 'warning', actions: ['open-chat'] });
    case 'permission':
      return view(phase, track, now, { text: 'The agent needs your OK in the chat', pill: 'Agent needs your OK', tone: 'warning', actions: ['open-chat'] });
    case 'failed':
      return view(phase, track, now, { text: 'The agent stopped with an error', pill: 'Agent stopped', tone: 'error', actions: ['open-chat', 'dismiss'] });
    case 'writing': {
      const path = last?.path ?? null;
      return view(phase, track, now, {
        text: path ? `Writing ${middlePath(path, FULL_PATH_MAX)}` : 'The agent is writing',
        pill: path ? `Writing ${middlePath(basename(path), NAME_MAX)}` : 'Writing',
        detail: track.isCanvas && track.screensTotal > 1 ? `${track.screensWritten} of ${track.screensTotal} screens written` : null,
        title: path,
        tone: 'info',
        elapsed: true,
      });
    }
    case 'retrying':
      return view(phase, track, now, { text: 'The agent hit a problem and is retrying', pill: 'Agent is retrying', tone: 'warning', elapsed: true });
    case 'working': {
      const since = last?.at ?? track.turnStartedAt;
      let detail: string | null = null;
      if (since !== null && now - since >= QUIET_MS) detail = 'Nothing saved in the last 2 minutes';
      else if (last) {
        const when = relativeTime(new Date(last.at).toISOString(), now, locale);
        detail = last.path ? `Last saved ${middlePath(basename(last.path), NAME_MAX)} ${when}` : `Last saved ${when}`;
      }
      return view(phase, track, now, { text: 'The agent is working', pill: 'Agent is working', detail, tone: 'info', elapsed: true });
    }
    case 'done': {
      const count = track.turnFiles.length;
      return view(phase, track, now, {
        text: count > 0 ? `Done. Updated ${plural(count, 'file')}` : 'Done. No files changed',
        pill: 'Done',
        tone: 'success',
        actions: count > 0 ? [] : ['open-chat'],
      });
    }
    case 'stalled':
      return view(phase, track, now, { text: 'Nothing written yet. Check the chat for a question.', pill: 'Nothing written yet', tone: 'warning', actions: ['open-chat', 'dismiss'] });
  }
};
