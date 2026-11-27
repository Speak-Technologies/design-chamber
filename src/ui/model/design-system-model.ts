// View-model of a design's system in the viewer (Phase 2.5 U4): the chip in the header, its popover,
// the quiet "was updated" banner, the update sheet and the notices after a change. Pure: no DOM, no host
// calls. The service has already done the comparing (`GET /designs/:slug/system`, `.../system/preview`);
// this only chooses the words and which controls make sense.

import type { DesignSystemActionResponse, DesignSystemView, Override, SystemPreviewResponse } from '../../shared/api.ts';
import { choiceSystemsOf, projectSystemOf } from '../../shared/systems.ts';
import type { SystemSummary } from '../../shared/types.ts';
import { plural } from './format.ts';

// ---------------------------------------------------------------- the chip

export type ChipTone = 'neutral' | 'info' | 'warning';

export type ChipView = {
  /** Beside the glyph on the full-screen page. */
  label: string;
  /** The whole sentence: tooltip and accessible name (the rail shows the glyph and nothing else). */
  title: string;
  tone: ChipTone;
};

/** The copy's own problems, one sentence each. Empty when the copy is whole. */
export const copyProblems = (view: DesignSystemView): string[] => {
  if (view.status.state !== 'linked') return [];
  const name = view.status.name;
  if (view.copy.invalid) return [`This design’s copy of ${name} can’t be read.`];
  const out: string[] = [];
  if (view.copy.missing.length > 0) out.push(`This design’s copy of ${name} is missing ${plural(view.copy.missing.length, 'file')}.`);
  if (view.copy.drift.length > 0) out.push(`${plural(view.copy.drift.length, 'file')} in this design’s copy of ${name} ${view.copy.drift.length === 1 ? 'was' : 'were'} changed by hand.`);
  return out;
};

const revisionOf = (view: DesignSystemView): number | null => view.link?.revision ?? null;

/** "shop’s own design files", or "its project’s own design files" when the design names no project. */
const projectFiles = (projectName: string | null): string => (projectName === null ? 'its project’s own design files' : `${projectName}’s own design files`);

/**
 * Null while the answer has not arrived, so the header shows nothing rather than a guess. `projectName` is the
 * folder name of the design's project (design.json `projectDirectory`), for the "Follows the project" title.
 */
export const chipOf = (view: DesignSystemView | null, projectName: string | null = null): ChipView | null => {
  if (view === null) return null;
  const { status } = view;
  switch (status.state) {
    case 'linked': {
      if (status.linkState === 'deleted') return { label: `${status.name} (deleted)`, title: `${status.name} was deleted. This design keeps its copy.`, tone: 'warning' };
      if (status.linkState === 'draft') return { label: `${status.name} (draft)`, title: `${status.name} is a draft again. This design keeps its copy.`, tone: 'warning' };
      const revision = revisionOf(view);
      const parts = [revision === null ? status.name : `${status.name}, revision ${revision}`];
      if (view.updateAvailable) parts.push('an update is available');
      if (view.overrides.length > 0) parts.push(plural(view.overrides.length, 'override'));
      const problems = copyProblems(view);
      parts.push(...problems.map((sentence) => sentence.replace(/\.$/, '')));
      const tone: ChipTone = problems.length > 0 ? 'warning' : view.updateAvailable ? 'info' : 'neutral';
      return { label: status.name, title: parts.join(', '), tone };
    }
    case 'invalid':
      return { label: 'Design system', title: 'This design’s system record can’t be read.', tone: 'warning' };
    case 'ask':
      return { label: 'Ask me in chat', title: 'The agent will ask which design system to use.', tone: 'neutral' };
    case 'project':
      return { label: 'Follows the project', title: `This design follows ${projectFiles(projectName)}.`, tone: 'neutral' };
    case 'none':
    case 'unset':
      return { label: 'No design system', title: 'This design has no design system.', tone: 'neutral' };
  }
};

// ---------------------------------------------------------------- the popover

export type PopoverView = {
  /** One or two lines under the title. */
  lines: string[];
  /** Copy problems, each a warning line. */
  problems: string[];
  overrides: Override[];
  /** Open system is offered only while there is a system page to open. */
  openId: string | null;
  /** The newest revision when the design's copy is behind, else null. */
  update: { revision: number } | null;
};

export const popoverOf = (view: DesignSystemView, projectName: string | null = null): PopoverView => {
  const { status } = view;
  const lines: string[] = [];
  let openId: string | null = null;
  let update: PopoverView['update'] = null;
  if (status.state === 'linked') {
    const revision = revisionOf(view);
    if (status.linkState === 'ok') openId = status.id;
    if (status.linkState === 'deleted') lines.push(`${status.name} was deleted. This design keeps its own copy of it.`);
    else if (status.linkState === 'draft') lines.push(`${status.name} is a draft again. This design keeps the copy it made${revision === null ? '' : ` at revision ${revision}`}.`);
    else lines.push(revision === null ? `Using ${status.name}.` : `Using ${status.name}, copied at revision ${revision}.`);
    if (status.linkState === 'ok' && view.updateAvailable && view.systemRevision !== null) {
      update = { revision: view.systemRevision };
      lines.push(`Revision ${view.systemRevision} is available.`);
    }
  } else if (status.state === 'invalid') lines.push('This design’s system record can’t be read, so Design Chamber can’t tell which system it uses.');
  else if (status.state === 'ask') lines.push('The agent will ask which design system to use when it works on this design.');
  else if (status.state === 'project') lines.push(`This design follows ${projectFiles(projectName)}, so it looks like the rest of the project. Pick a system to use one instead.`);
  else lines.push('This design styles itself. Pick a system to give it shared colors, type and components.');
  return { lines, problems: copyProblems(view), overrides: view.overrides, openId, update };
};

/** How many overrides the popover lists before it sends the rest to the update sheet. */
export const POPOVER_OVERRIDES_MAX = 4;

/** `"4 overrides"` / `"1 override"`, for the heading of the list. */
export const overridesHeading = (count: number): string => `${plural(count, 'override')} in this design`;

// ---------------------------------------------------------------- Change…

export type ChangeOption = { id: string; label: string; hint: string | null };

/** The id the "No design system" choice goes by in `GET .../system/preview?to=` and the action body. */
export const NO_SYSTEM = 'none';

/**
 * What the Change… list offers: every Ready system but the one in use, and "No design system" unless that is
 * already the state. Drafts are not offered (the service refuses them). A design that follows its project lists the
 * project's own Ready system first, as "Shop UI, this project’s" (one that appeared after the design was made);
 * picking it is the same switch as any other, so nothing links by itself.
 */
export const changeOptions = (view: DesignSystemView, systems: readonly SystemSummary[], project: { directory: string; foldsCase: boolean } | null = null): ChangeOption[] => {
  const currentId = view.status.state === 'linked' ? view.status.id : null;
  const own = view.status.state === 'project' && project !== null ? projectSystemOf(choiceSystemsOf(systems), project.directory, project.foldsCase) : null;
  const ready = systems
    .filter((system) => system.status === 'ready' && system.id !== currentId)
    .map((system) => ({ id: system.id, label: system.id === own?.id ? `${system.name}, this project’s` : system.name, hint: `Revision ${system.revision}` }));
  const ordered = own === null ? ready : [...ready.filter((option) => option.id === own.id), ...ready.filter((option) => option.id !== own.id)];
  const none = view.status.state === 'none' || view.status.state === 'unset' ? [] : [{ id: NO_SYSTEM, label: 'No design system', hint: null }];
  return [...ordered, ...none];
};

/** Why the Change… list is empty. */
export const NO_OTHER_SYSTEMS = 'There are no other design systems to switch to yet.';

/**
 * The line under a chosen option: what moves and what the design keeps. The totals come from the service.
 * "12 tokens will change, 4 are new, this design's own 6 stay as overrides."
 */
export const previewLine = (preview: SystemPreviewResponse, to: { none: boolean; fromName: string | null }): string => {
  const { changed, added, removed } = preview.tokens.totals;
  const own = preview.ownTokens;
  const keeps = own === 0 ? null : `this design’s own ${own} stay${own === 1 ? 's' : ''} as ${own === 1 ? 'an override' : 'overrides'}`;
  if (to.none) return `${to.fromName ?? 'The system'}’s tokens are removed from this design${own === 0 ? '' : `, and its own ${own} stay`}.`;
  const parts: string[] = [];
  if (changed > 0) parts.push(`${plural(changed, 'token')} will change`);
  if (added > 0) parts.push(changed > 0 ? `${added} ${added === 1 ? 'is' : 'are'} new` : `${plural(added, 'token')} ${added === 1 ? 'is' : 'are'} new`);
  if (removed > 0) parts.push(parts.length > 0 ? `${removed} ${removed === 1 ? 'is' : 'are'} removed` : `${plural(removed, 'token')} ${removed === 1 ? 'is' : 'are'} removed`);
  if (parts.length === 0) parts.push('No tokens change');
  if (keeps) parts.push(keeps);
  return `${parts.join(', ')}.`;
};

// ---------------------------------------------------------------- the quiet banner

/** The `host.storage` key that remembers the revision "Not now" was pressed for. */
export const dismissKey = (slug: string): string => `system-update:${slug}`;

export const parseDismissed = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

export type BannerView = { text: string; revision: number };

/**
 * The one-line banner: only for a Ready system whose revision is newer than the copy's, and only until the person
 * says "Not now" for that revision (the next revision brings it back).
 */
export const bannerOf = (view: DesignSystemView | null, dismissed: number | null): BannerView | null => {
  if (view === null || view.status.state !== 'linked' || view.status.linkState !== 'ok' || !view.updateAvailable || view.systemRevision === null) return null;
  if (dismissed !== null && dismissed >= view.systemRevision) return null;
  return { text: `${view.status.name} was updated since this design copied it.`, revision: view.systemRevision };
};

// ---------------------------------------------------------------- the update sheet

/** How many names a section lists before "and N more". */
export const SECTION_SHOW = 6;

export type UpdateSection = { id: 'changed' | 'added' | 'removed' | 'components'; title: string; names: string[]; more: number };

const clip = (names: readonly string[]): { names: string[]; more: number } => ({ names: names.slice(0, SECTION_SHOW), more: Math.max(0, names.length - SECTION_SHOW) });

/** The sheet's sections, version first. A section with nothing in it is left out. */
export const updateSections = (preview: SystemPreviewResponse): UpdateSection[] => {
  const out: UpdateSection[] = [];
  const changed = preview.tokens.changed.map((token) => token.name);
  if (changed.length > 0) out.push({ id: 'changed', title: `${plural(preview.tokens.totals.changed, 'token')} changed`, ...clip(changed) });
  if (preview.tokens.added.length > 0) out.push({ id: 'added', title: `${plural(preview.tokens.totals.added, 'new token')}`, ...clip(preview.tokens.added) });
  if (preview.tokens.removed.length > 0) out.push({ id: 'removed', title: `${plural(preview.tokens.totals.removed, 'token')} removed`, ...clip(preview.tokens.removed) });
  const parts = [...preview.components.changed, ...preview.components.added, ...preview.components.removed];
  if (parts.length > 0) {
    const bits: string[] = [];
    if (preview.components.totals.changed > 0) bits.push(`${preview.components.totals.changed} changed`);
    if (preview.components.totals.added > 0) bits.push(`${preview.components.totals.added} new`);
    if (preview.components.totals.removed > 0) bits.push(`${preview.components.totals.removed} removed`);
    out.push({ id: 'components', title: `Components, ${bits.join(', ')}`, ...clip(parts) });
  }
  return out;
};

/** The sheet's heading line: "Acme revision 7 to revision 9". */
export const updateHeading = (name: string, preview: SystemPreviewResponse): string =>
  preview.fromRevision !== null && preview.toRevision !== null ? `${name}, revision ${preview.fromRevision} to ${preview.toRevision}` : name;

/** Nothing in the tokens or components moves: the update still brings the copy to the new revision. */
export const updateIsQuiet = (preview: SystemPreviewResponse): boolean => updateSections(preview).length === 0;

/** The `base` of a `token-reset` edit: the tokens.css half of the view's stamp (`<COPY.json sha>:<tokens.css sha>`). */
export const resetBase = (view: DesignSystemView): string | null => {
  const at = view.stamp.indexOf(':');
  const base = at < 0 ? '' : view.stamp.slice(at + 1);
  return base === '' ? null : base;
};

export const STALE_HINT = 'Something changed while this was open.';

// ---------------------------------------------------------------- notices after an action

export type AskPurpose = 'restyle' | 'system-update';

export type AppliedNotice = { title: string; ask: { purpose: AskPurpose; label: string } | null };

/**
 * The success notice for a link action. `name` and `revision` describe the system now in use (from the choice
 * the person made, or the preview that was on show), so the sentence never depends on a second request.
 */
export const appliedNotice = (notice: DesignSystemActionResponse['notice'], name: string, revision: number | null): AppliedNotice => {
  switch (notice) {
    case 'updated':
      return { title: revision === null ? `Updated ${name}.` : `Updated to ${name} revision ${revision}.`, ask: { purpose: 'system-update', label: 'Ask the agent to apply the changes' } };
    case 'removed':
      return { title: 'Removed the design system from this design.', ask: { purpose: 'restyle', label: 'Ask the agent to restyle' } };
    case 'linked':
    case 'switched':
      return { title: `Now using ${name}.`, ask: { purpose: 'restyle', label: 'Ask the agent to restyle' } };
    case 'unchanged':
      return { title: 'Nothing changed.', ask: null };
  }
};

/** Change batches that can change a design's system: its own files and record, a system's files, or a new root. */
const SYSTEM_REFRESH_KINDS: ReadonlySet<string> = new Set(['files', 'design', 'versions', 'added']);

export const shouldRefetchSystem = (batch: { reset: boolean; events: ReadonlyArray<{ slug: string | null; kind: string }> }, slug: string): boolean =>
  batch.reset || batch.events.some((event) => (event.slug === slug && SYSTEM_REFRESH_KINDS.has(event.kind)) || event.kind === 'system' || event.kind === 'root');

// ---------------------------------------------------------------- the agent switched it

export type AgentSwitch = { title: string; undoTo: string };

/**
 * The agent recorded another system and Design Chamber switched the design while it was open: "The agent switched
 * this design to Shop." with Undo (the version taken first). Nothing for the first answer, for the person's own
 * changes (those say their own notice) or when there is no version to go back to.
 */
export const agentSwitchOf = (before: DesignSystemView | null, after: DesignSystemView): AgentSwitch | null => {
  if (before === null || after.status.state !== 'linked' || after.link === null) return null;
  if (after.link.by !== 'agent' || after.link.before === null) return null;
  if (before.link !== null && before.link.at === after.link.at) return null;
  return { title: `The agent switched this design to ${after.status.name}.`, undoTo: after.link.before };
};

/** Name and revision of the system a preview would switch to, for the notice after it applies. */
export const targetRevision = (preview: SystemPreviewResponse | null): number | null => preview?.toRevision ?? null;
