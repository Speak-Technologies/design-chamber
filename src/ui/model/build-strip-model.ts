// What the build strip says (documentation/specs/phase-1-review-loop.md §2.3, §2.5): one view
// per phase, from a `BuildTrack` and the clock. Pure: no DOM, no host. The full-screen strip
// shows `text` and `detail`; the rail pill shows `pill`. `announce` is what the live region
// speaks: it changes only with the phase or the file, never as seconds or minutes tick.

import { QUIET_MS, phaseOf, type BuildPhase, type BuildTrack } from '../../guest/build-activity.ts';
import type { SessionTool } from '../../guest/session-tool.ts';
import { stripDisplayControls } from '../../shared/display-text.ts';
import { TOOL_REPAINT_MS } from '../../shared/limits.ts';
import { middlePath, plural, relativeTime } from './format.ts';
import { FULL_PATH_MAX, NAME_MAX, basename, describeTool, type ToolDesign } from './tool-model.ts';

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

/** A file name as it may be shown: no display controls, and null when nothing is left of it. */
const shownPath = (path: string | null): string | null => stripDisplayControls(path ?? '') || null;

/**
 * The rail pill's words for the four phases a Work Status row can show. `file` is the path (or just
 * the name) of the file being written, used by `writing` only. `buildView` takes its pill text from
 * here, so a status row says exactly what the rail pill says.
 */
export const pillText = (phase: 'writing' | 'working' | 'failed' | 'done', file: string | null): string => {
  switch (phase) {
    case 'writing': {
      const name = shownPath(file);
      return name ? `Writing ${middlePath(basename(name), NAME_MAX)}` : 'Writing';
    }
    case 'working':
      return 'Agent is working';
    case 'failed':
      return 'Agent stopped';
    case 'done':
      return 'Done';
  }
};

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

/**
 * While the agent works, the call it is making says more than the phase does. Only edits and writes are
 * announced: the live region must not read out every file the agent opens.
 */
const withTool = (shown: BuildView, track: BuildTrack, design: ToolDesign | null): BuildView => {
  const words = track.tool ? describeTool(track.tool, design) : null;
  if (!words) return shown;
  const said = words.kind === 'edit' || words.kind === 'write' ? words.full : shown.announce;
  return { ...shown, text: words.full, pill: words.short, title: words.path, announce: said };
};

/** `design` maps a tool's target to the open design's own paths; null shows the target as the host gave it. */
export const buildView = (track: BuildTrack, now: number, locale = 'en', design: ToolDesign | null = null): BuildView => {
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
      return view(phase, track, now, { text: 'The agent stopped with an error', pill: pillText('failed', null), tone: 'error', actions: ['open-chat', 'dismiss'] });
    case 'writing': {
      const path = shownPath(last?.path ?? null);
      return withTool(view(phase, track, now, {
        text: path ? `Writing ${middlePath(path, FULL_PATH_MAX)}` : 'The agent is writing',
        pill: pillText('writing', path),
        detail: track.isCanvas && track.screensTotal > 1 ? `${track.screensWritten} of ${track.screensTotal} screens written` : null,
        title: path,
        tone: 'info',
        elapsed: true,
      }), track, design);
    }
    case 'retrying':
      return view(phase, track, now, { text: 'The agent hit a problem and is retrying', pill: 'Agent is retrying', tone: 'warning', elapsed: true });
    case 'working': {
      const since = last?.at ?? track.turnStartedAt;
      let detail: string | null = null;
      if (since !== null && now - since >= QUIET_MS) detail = 'Nothing saved in the last 2 minutes';
      else if (last) {
        const when = relativeTime(new Date(last.at).toISOString(), now, locale);
        const path = shownPath(last.path);
        detail = path ? `Last saved ${middlePath(basename(path), NAME_MAX)} ${when}` : `Last saved ${when}`;
      }
      return withTool(view(phase, track, now, { text: 'The agent is working', pill: pillText('working', null), detail, tone: 'info', elapsed: true }), track, design);
    }
    case 'done': {
      const count = track.turnFiles.length;
      return view(phase, track, now, {
        text: count > 0 ? `Done. Updated ${plural(count, 'file')}` : 'Done. No files changed',
        pill: pillText('done', null),
        tone: 'success',
        actions: count > 0 ? [] : ['open-chat'],
      });
    }
    case 'stalled':
      return view(phase, track, now, { text: 'Nothing written yet. Check the chat for a question.', pill: 'Nothing written yet', tone: 'warning', actions: ['open-chat', 'dismiss'] });
  }
};

// ---- repaint rate ----

/** What of the tool is on screen, and since when. */
export type ToolHold = { phase: BuildPhase; tool: SessionTool | null; since: number };

const sameTool = (a: SessionTool | null, b: SessionTool | null): boolean => a?.name === b?.name && a?.target === b?.target;

/**
 * The track to paint at `now`. An agent can open ten files a second, so within one phase the tool changes at
 * most once per `TOOL_REPAINT_MS` and the words stay readable; everything else, a phase change included,
 * paints at once. `wait` is how long until the held-back tool may show; null when nothing is held back.
 */
export const paintTrack = (held: ToolHold | null, track: BuildTrack, now: number): { track: BuildTrack; held: ToolHold; wait: number | null } => {
  const phase = phaseOf(track, now);
  if (held && sameTool(held.tool, track.tool)) return { track, held: { ...held, phase }, wait: null };
  // A clock stepped back counts as time passed, so nothing is held for longer than the limit.
  if (held && held.phase === phase && now >= held.since && now - held.since < TOOL_REPAINT_MS) {
    return { track: { ...track, tool: held.tool }, held, wait: held.since + TOOL_REPAINT_MS - now };
  }
  return { track, held: { phase, tool: track.tool, since: now }, wait: null };
};
