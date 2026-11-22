// View-model of the shared folder picker (Phase 2.6 F2, technical design §6.1): the rows it lists,
// the search rule, and the sentence that says where a new design goes. Pure: no DOM, no host calls.
// Projects are pick targets too (owner answer §9.9): the union of the host's projects, the derived
// groups and the registry's manual members, matched by `sameDirectory`. Nothing here moves a file.

import type { MembershipTarget, ProjectMembersView } from '../../shared/api.ts';
import { FILING_PROJECTS_MAX, MEMBERSHIP_CHANGES_MAX } from '../../shared/limits.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import type { DesignSummary } from '../../shared/types.ts';
import { folderName } from './format.ts';
import { projectGroups, projectOf, type FolderLite, type ProjectInfo } from './list-model.ts';

export type TargetKey = `folder:${string}` | `project:${string}`;

export type PickRow = {
  key: TargetKey;
  kind: 'folder' | 'project';
  label: string;
  /** The full name or path, for the tooltip. */
  title: string;
  count: number;
  checked: boolean;
  locked: boolean;
  lockedReason: string | null;
};

export type PickerDesign = { slug: string; projectDirectory: string | null };

export type PickerInput = {
  folders: readonly FolderLite[];
  projectMembers: readonly ProjectMembersView[];
  hostProjects: readonly ProjectInfo[];
  designs: readonly DesignSummary[];
  designsRoot: string;
  /** The design being filed; null in the New dialog (it does not exist yet). */
  design: PickerDesign | null;
  /** New dialog: the project the chat works in. Its row is ticked and locked. */
  derivedProject: string | null;
  /** Move: the target the design is leaving, left out of the list. */
  exclude?: TargetKey;
};

export const keyOfTarget = (target: MembershipTarget): TargetKey =>
  target.kind === 'folder' ? `folder:${target.id}` : `project:${target.directory}`;

export const targetOfKey = (key: TargetKey): MembershipTarget =>
  key.startsWith('folder:') ? { kind: 'folder', id: key.slice('folder:'.length) } : { kind: 'project', directory: key.slice('project:'.length) };

/** The search field appears once the list is longer than this (owner answer: search past 8). */
export const SEARCH_AFTER = 8;
export const showSearch = (total: number): boolean => total > SEARCH_AFTER;

export const filterRows = (rows: readonly PickRow[], query: string): PickRow[] => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter((row) => row.label.toLowerCase().includes(needle));
};

const baseName = folderName;
const parentName = (directory: string): string => {
  const parts = directory.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter((part) => part !== '');
  return parts[parts.length - 2] ?? '';
};

/**
 * Every folder and project the picker offers. Projects: the derived groups, the registry's manual
 * members and the host's project list, merged by `sameDirectory` (the derived spelling wins, as the
 * sidebar's groups use it); a project at or inside the designs root is left out. Counts are the live
 * derived and manual members together. The design's own project is ticked and locked; in the New
 * dialog the chat's project is. Folders sort by name, projects by label.
 */
export const pickerTargets = (input: PickerInput): { folders: PickRow[]; projects: PickRow[]; total: number } => {
  const { folders, projectMembers, hostProjects, designs, designsRoot, design, derivedProject, exclude } = input;
  const live = new Set(designs.map((entry) => entry.slug));
  const groups = projectGroups(designs, hostProjects, designsRoot, undefined);
  const derivedOfDesign = design === null ? null : projectOf(design, designsRoot);

  // The union, first spelling and label winning; derived groups already carry the host name or base name.
  const union: Array<{ directory: string; label: string }> = groups.map((group) => ({ directory: group.directory, label: group.label }));
  const addDirectory = (directory: string): void => {
    if (directory.trim() === '') return;
    if (projectOf({ projectDirectory: directory }, designsRoot) === null) return;
    if (union.some((entry) => sameDirectory(entry.directory, directory))) return;
    const named = hostProjects.find((project) => sameDirectory(project.directory, directory))?.name.trim();
    union.push({ directory, label: named && named !== '' ? named : baseName(directory) });
  };
  for (const entry of projectMembers) addDirectory(entry.directory);
  for (const project of hostProjects) addDirectory(project.directory);
  if (design === null && derivedProject !== null) addDirectory(derivedProject);

  // Two projects with the same label tell apart by their parent folder, as projectGroups does.
  const seen = new Map<string, number>();
  for (const entry of union) seen.set(entry.label.toLowerCase(), (seen.get(entry.label.toLowerCase()) ?? 0) + 1);
  const projects: PickRow[] = union
    .map((entry) => {
      const parent = parentName(entry.directory);
      const label = (seen.get(entry.label.toLowerCase()) ?? 0) > 1 && parent !== '' ? `${entry.label} · ${parent}` : entry.label;
      const manual = projectMembers.find((member) => sameDirectory(member.directory, entry.directory));
      const members = new Set<string>();
      for (const candidate of designs) {
        const directory = projectOf(candidate, designsRoot);
        if (directory !== null && sameDirectory(directory, entry.directory)) members.add(candidate.slug);
      }
      for (const slug of manual?.slugs ?? []) if (live.has(slug)) members.add(slug);
      const locked =
        design !== null
          ? derivedOfDesign !== null && sameDirectory(entry.directory, derivedOfDesign)
          : derivedProject !== null && projectOf({ projectDirectory: derivedProject }, designsRoot) !== null && sameDirectory(entry.directory, derivedProject);
      const checked = locked || (design !== null && (manual?.slugs.includes(design.slug) ?? false));
      return {
        key: `project:${entry.directory}` as TargetKey,
        kind: 'project' as const,
        label,
        title: entry.directory,
        count: members.size,
        checked,
        locked,
        lockedReason: locked ? (design !== null ? 'Made for this project' : 'This design is made for it') : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  const folderRows: PickRow[] = [...folders]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((folder) => ({
      key: `folder:${folder.id}` as TargetKey,
      kind: 'folder' as const,
      label: folder.name,
      title: folder.name,
      count: new Set(folder.slugs.filter((slug) => live.has(slug))).size,
      checked: design !== null && folder.slugs.includes(design.slug),
      locked: false,
      lockedReason: null,
    }));

  const keep = (row: PickRow): boolean => row.key !== exclude;
  const shownProjects = projects.filter(keep);
  const shownFolders = folderRows.filter(keep);
  return { folders: shownFolders, projects: shownProjects, total: shownFolders.length + shownProjects.length };
};

/** "Goes into Q4 launch and Explorations"; three or more name the first two and count the rest. */
export const statedResult = (selected: readonly PickRow[]): string | null => {
  const names = selected.map((row) => row.label);
  if (names.length === 0) return null;
  if (names.length === 1) return `Goes into ${names[0]}`;
  if (names.length === 2) return `Goes into ${names[0]} and ${names[1]}`;
  return `Goes into ${names[0]}, ${names[1]} and ${names.length - 2} more`;
};

/** The New dialog's line under the picker: the picks, the automatic project, and that it can change. */
export const goesLine = (selected: readonly PickRow[], derivedLabel: string | null): string | null => {
  const stated = statedResult(selected);
  if (stated === null && derivedLabel === null) return null;
  const parts: string[] = [];
  if (stated !== null) parts.push(`${stated}.`);
  if (derivedLabel !== null) parts.push(`It also lands in ${derivedLabel} on its own.`);
  parts.push('You can change this later.');
  return parts.join(' ');
};

/** The chip filing body from the picked keys (locked rows never reach here). Undefined when nothing is picked. */
export const filingOf = (selected: readonly TargetKey[]): { folders?: string[]; projects?: string[] } | undefined => {
  const folders: string[] = [];
  const projects: string[] = [];
  for (const key of selected) {
    const target = targetOfKey(key);
    if (target.kind === 'folder') folders.push(target.id);
    else projects.push(target.directory);
  }
  if (folders.length === 0 && projects.length === 0) return undefined;
  return { ...(folders.length > 0 ? { folders } : {}), ...(projects.length > 0 ? { projects } : {}) };
};

/** The filing caps, checked before Start so the fix shows in the dialog, not as a failed creation. */
export const filingProblem = (selected: readonly TargetKey[]): string | null => {
  const filing = filingOf(selected);
  if (filing === undefined) return null;
  const folders = filing.folders?.length ?? 0;
  const projects = filing.projects?.length ?? 0;
  if (projects > FILING_PROJECTS_MAX) return `A new design can go under up to ${FILING_PROJECTS_MAX} projects. Untick a few.`;
  if (folders + projects > MEMBERSHIP_CHANGES_MAX) return `Pick up to ${MEMBERSHIP_CHANGES_MAX} folders and projects together.`;
  return null;
};
