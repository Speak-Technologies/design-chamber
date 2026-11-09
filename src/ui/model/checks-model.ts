// The Checks badge and its panel, as data (documentation/specs/agent-render-and-check.md §9).
// Pure: no DOM, no host calls. Every finding sentence comes from the service (which takes it from
// `src/shared/checks.ts`); this file only decides what to count, group and say around them.

import type { ChecksResponse } from '../../shared/api.ts';
import { sortFindings } from '../../shared/checks.ts';
import type { CheckFinding } from '../../shared/types.ts';
import { plural, relativeTime } from './format.ts';

export type BadgeTone = 'success' | 'warning' | 'error' | 'neutral';

export type BadgeView = {
  /** Visible text: `Checking`, `No issues`, `1 issue`, `3 issues` or `Checks`. */
  label: string;
  tone: BadgeTone;
  /** What a screen reader and the tooltip say. Never the colour alone. */
  ariaLabel: string;
  /** Errors plus warnings. The rail shows this number alone, with the words in the accessible name. */
  count: number;
};

/** Errors and warnings, the number the badge shows. Notes never count. */
export const issueCount = (response: ChecksResponse): number => response.counts.errors + response.counts.warnings;

/**
 * Whether the render findings in the response are counted. The service counts them when the files
 * are unchanged since the render (`fresh`), and also for a render that could not run or failed as
 * long as its keys still match; for those two states the counts are the tiebreaker.
 */
export const rendersCounted = (response: ChecksResponse): boolean => {
  const { state, findings } = response.render;
  if (state === 'fresh') return true;
  if (state !== 'unavailable' && state !== 'failed') return false;
  if (findings.length === 0) return true;
  const all = [...response.static.findings, ...findings];
  const count = (severity: CheckFinding['severity']): number => all.filter((finding) => finding.severity === severity).length;
  return count('error') === response.counts.errors && count('warning') === response.counts.warnings && count('info') === response.counts.notes;
};

/**
 * A pass is green only when nothing more can be learned about the design: the rendering was
 * checked on the current files, no browser exists to check it with, or there is none to try.
 * Otherwise "No issues" would say more than we know, so it stays neutral and the label says what is missing.
 */
const verified = (response: ChecksResponse): boolean => {
  const { state } = response.render;
  return state === 'fresh' || state === 'unavailable' || (state === 'none' && !response.canRun);
};

export const badgeOf = (response: ChecksResponse | null, error: string | null, running: boolean): BadgeView => {
  if (response === null) {
    if (error !== null) return { label: 'Checks', tone: 'neutral', ariaLabel: 'Checks: didn’t load', count: 0 };
    return { label: 'Checking', tone: 'neutral', ariaLabel: 'Checks: Checking', count: 0 };
  }
  if (running || response.render.state === 'running') return { label: 'Checking', tone: 'neutral', ariaLabel: 'Checks: Checking the rendering', count: 0 };
  const issues = issueCount(response);
  if (issues > 0) {
    const label = plural(issues, 'issue');
    return { label, tone: response.counts.errors > 0 ? 'error' : 'warning', ariaLabel: `Checks: ${label}`, count: issues };
  }
  if (verified(response)) return { label: 'No issues', tone: 'success', ariaLabel: 'Checks: No issues', count: 0 };
  // Files are fine, rendering is not known: say so where the colour cannot.
  return { label: 'No issues', tone: 'neutral', ariaLabel: `Checks: No issues in the files. ${renderStatement(response)}`, count: 0 };
};

/** The state of the rendering check without the time, for the badge's description. */
const renderStatement = (response: ChecksResponse): string =>
  response.render.state === 'stale' ? 'Rendering was checked before your latest changes.' : 'Rendering hasn’t been checked yet.';

// ---- the rendering line ----

export type RenderLine = { text: string; tone: 'ok' | 'busy' | 'warn' | 'muted' };

/** One sentence about the rendering check, exact copy per the spec. */
export const renderLineOf = (response: ChecksResponse, nowMs: number, locale: string): RenderLine => {
  const { state, at, artboards } = response.render;
  switch (state) {
    case 'none':
      return { text: 'Rendering hasn’t been checked yet.', tone: 'muted' };
    case 'running':
      return { text: 'Checking the rendering…', tone: 'busy' };
    case 'stale':
      return { text: 'Rendering was checked before your latest changes.', tone: 'warn' };
    case 'unavailable':
      return { text: 'No Chrome, Edge or Chromium was found, so only the files were checked.', tone: 'muted' };
    case 'failed':
      return { text: 'The last rendering check failed.', tone: 'warn' };
    case 'fresh': {
      if (artboards === 0) return { text: 'There was nothing to render yet.', tone: 'muted' };
      const when = at === null ? '' : relativeTime(at, nowMs, locale);
      return { text: `Rendered ${plural(artboards, 'artboard')}${when === '' ? '' : ` ${when}`}.`, tone: 'ok' };
    }
  }
};

// ---- groups ----

export type CheckGroup = {
  id: 'errors' | 'warnings' | 'notes' | 'earlier';
  title: string;
  /** Heading colour: the severity, or `muted` for findings from before the latest changes. */
  tone: 'error' | 'warning' | 'info' | 'muted';
  items: CheckFinding[];
  /** Shown closed until opened: notes and old findings are not what the person came to fix. */
  collapsed: boolean;
};

const GROUP_TITLES = {
  errors: 'Needs fixing',
  warnings: 'Worth a look',
  notes: 'Notes',
  stale: 'From before your latest changes',
  running: 'From the last rendering check',
} as const;

/** "No browser was found" is already the rendering line; it is not a finding to read twice. */
const isRenderLineFinding = (finding: CheckFinding): boolean => finding.code === 'browser-missing';

export const groupsOf = (response: ChecksResponse): CheckGroup[] => {
  const counted = rendersCounted(response);
  const render = response.render.findings;
  const current = sortFindings([...response.static.findings, ...(counted ? render.filter((finding) => !isRenderLineFinding(finding)) : [])]);
  const groups: CheckGroup[] = [];
  const add = (group: Omit<CheckGroup, 'items'>, items: CheckFinding[]): void => {
    if (items.length > 0) groups.push({ ...group, items });
  };
  add({ id: 'errors', title: GROUP_TITLES.errors, tone: 'error', collapsed: false }, current.filter((finding) => finding.severity === 'error'));
  add({ id: 'warnings', title: GROUP_TITLES.warnings, tone: 'warning', collapsed: false }, current.filter((finding) => finding.severity === 'warning'));
  add({ id: 'notes', title: GROUP_TITLES.notes, tone: 'info', collapsed: true }, current.filter((finding) => finding.severity === 'info'));
  if (!counted) {
    const title = response.render.state === 'running' ? GROUP_TITLES.running : GROUP_TITLES.stale;
    add({ id: 'earlier', title, tone: 'muted', collapsed: true }, sortFindings(render));
  }
  return groups;
};

// ---- the whole panel ----

export type PanelView = {
  phase: 'loading' | 'error' | 'ready';
  /** Set in the `error` phase, and when a refresh failed while an older answer is still shown. */
  error: { title: string; message: string } | null;
  summary: string;
  groups: CheckGroup[];
  renderLine: RenderLine | null;
  /** What to do when the files are clean but the rendering is not known: a sentence, or null. */
  nextStep: string | null;
  ask: { disabled: boolean };
  /** Which button is the filled one: the next step. Fixing when there is something to fix, otherwise checking the rendering. */
  primary: 'ask' | 'run' | null;
  run: { visible: boolean; label: string; busy: boolean };
};

const summaryOf = (response: ChecksResponse): string => {
  const { errors, warnings } = response.counts;
  // The notes the person can open, so the number matches the list.
  const notes = response.counts.notes - (rendersCounted(response) ? response.render.findings.filter(isRenderLineFinding).length : 0);
  const parts: string[] = [];
  if (errors > 0) parts.push(plural(errors, 'error'));
  if (warnings > 0) parts.push(plural(warnings, 'warning'));
  const head = parts.length > 0 ? parts.join(', ') : 'No errors or warnings';
  return notes > 0 ? `${head}. ${plural(notes, 'note')}.` : `${head}.`;
};

export const panelOf = (response: ChecksResponse | null, error: string | null, running: boolean, nowMs: number, locale: string): PanelView => {
  if (response === null) {
    return {
      phase: error === null ? 'loading' : 'error',
      error: error === null ? null : { title: 'Checks didn’t load', message: error },
      summary: '',
      groups: [],
      renderLine: null,
      nextStep: null,
      ask: { disabled: true },
      primary: null,
      run: { visible: false, label: 'Check rendering', busy: false },
    };
  }
  const busy = running || response.render.state === 'running';
  const groups = groupsOf(response);
  const rendering = response.render.state;
  return {
    phase: 'ready',
    error: error === null ? null : { title: 'Checks didn’t refresh', message: error },
    summary: summaryOf(response),
    groups,
    // The person pressed the button before the service has said "running": the line already says so.
    renderLine: busy ? { text: 'Checking the rendering…', tone: 'busy' } : renderLineOf(response, nowMs, locale),
    nextStep: groups.length === 0 && response.canRun && !busy && (rendering === 'none' || rendering === 'stale') ? 'Check rendering to look at every screen at its size.' : null,
    ask: { disabled: issueCount(response) === 0 },
    primary: issueCount(response) > 0 ? 'ask' : response.canRun && !busy ? 'run' : null,
    run: { visible: response.canRun || busy, label: response.render.state === 'none' || busy ? 'Check rendering' : 'Check again', busy },
  };
};

/** What a screen reader hears when a rendering check ends. */
export const runResultOf = (response: ChecksResponse): string => {
  const { state } = response.render;
  if (state === 'unavailable') return 'No browser was found, so the rendering was not checked.';
  if (state === 'failed') return 'The rendering check failed.';
  const issues = issueCount(response);
  return `Rendering check finished. ${issues === 0 ? 'No issues.' : `${plural(issues, 'issue')}.`}`;
};

// ---- live updates ----

const REFRESH_KINDS: ReadonlySet<string> = new Set(['files', 'design', 'checks', 'added']);

/** Whether a change batch can change this design's checks: its own files, design.json or check results, a new design, a root change, or a reset. */
export const shouldRefetch = (batch: { reset: boolean; events: ReadonlyArray<{ slug: string | null; kind: string }> }, slug: string): boolean =>
  batch.reset || batch.events.some((event) => (event.slug === slug && REFRESH_KINDS.has(event.kind)) || event.kind === 'root');
