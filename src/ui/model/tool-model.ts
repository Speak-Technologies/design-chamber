// Plain words for the call the linked agent is making (documentation/specs/native-extras.md §1.2). The tool
// name and its target come from the model: a name outside the table says nothing (the strip keeps its own
// words), and a target is only ever shown, cleaned of display controls before it is matched or cut. It is
// never opened or compared with the disk. Pure.

import type { SessionTool } from '../../guest/session-tool.ts';
import { stripDisplayControls } from '../../shared/display-text.ts';
import type { DesignJson } from '../../shared/types.ts';
import { middlePath } from './format.ts';

/** The full path fits what a toolbar line can hold; the pill and Work Status get room for the name only. */
export const FULL_PATH_MAX = 48;
export const NAME_MAX = 24;

/** The last part of a path, on either separator (a Windows host may give backslashes). */
export const basename = (path: string): string => path.split(/[\\/]+/).filter((part) => part !== '').at(-1) ?? path;

/** The open design, as far as a target needs it: its folder name and the files it knows. */
export type ToolDesign = { slug: string; entry: string | null; files: string[] };

export const toolDesignOf = (slug: string, design: Pick<DesignJson, 'entry' | 'screens'>): ToolDesign => ({
  slug,
  entry: design.entry,
  files: [...design.screens.map((screen) => screen.file), 'tokens.css', 'DESIGN.md'],
});

export type ToolKind = 'edit' | 'write' | 'read' | 'search' | 'run' | 'web' | 'plan' | 'helper' | 'check' | 'designs';

export type ToolWords = {
  kind: ToolKind;
  /** The full-screen strip. */
  full: string;
  /** The rail pill and a Work Status row. */
  short: string;
  /** The whole shown path, for a tooltip; null when the words name no file. */
  path: string | null;
};

/** A `Map`, so a tool called `constructor` is just unknown. */
const KINDS: ReadonlyMap<string, ToolKind> = new Map<string, ToolKind>([
  ['edit', 'edit'],
  ['multiedit', 'edit'],
  ['patch', 'edit'],
  ['apply_patch', 'edit'],
  ['str_replace_based_edit_tool', 'edit'],
  ['write', 'write'],
  ['read', 'read'],
  ['glob', 'search'],
  ['grep', 'search'],
  ['list', 'search'],
  ['ls', 'search'],
  ['codesearch', 'search'],
  ['bash', 'run'],
  ['shell', 'run'],
  ['webfetch', 'web'],
  ['websearch', 'web'],
  ['todowrite', 'plan'],
  ['todoread', 'plan'],
  ['task', 'helper'],
  ['design_check', 'check'],
  ['design_list', 'designs'],
  ['design_read', 'designs'],
]);

/** Kinds that name a file: the verb, and what to say when there is no name. */
const WITH_PATH: Partial<Record<ToolKind, { verb: string; none: string }>> = {
  edit: { verb: 'Editing', none: 'Editing a file' },
  write: { verb: 'Writing', none: 'Writing a file' },
  read: { verb: 'Reading', none: 'Reading a file' },
  search: { verb: 'Looking through', none: 'Searching the files' },
};

/** The rest never show a target: a shell command's least of all. */
const FIXED: Readonly<Record<'run' | 'web' | 'plan' | 'helper' | 'check' | 'designs', readonly [full: string, short: string]>> = {
  run: ['Running a command', 'Running a command'],
  web: ['Looking something up online', 'Looking something up online'],
  plan: ['Planning the next steps', 'Planning'],
  helper: ['A helper agent is working', 'Helper agent working'],
  check: ['Checking the design', 'Checking'],
  designs: ['Reading your designs', 'Reading designs'],
};

/** Case-folded, without a Claude Code `mcp__<server>__` or a Code Mode `<namespace>.` in front. */
const toolName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^mcp__.+?__/, '')
    .replace(/^(?:[^.]+\.)+(?=.)/, '');

/**
 * The target as shown: a design file's own path when it clearly is one (a bare name that exactly one design
 * file has, the file's path, or a path through the design's folder), else the target as the host gave it.
 * `null` when there is nothing to name.
 */
export const toolPath = (target: string | null, design: ToolDesign | null): string | null => {
  const shown = stripDisplayControls(target ?? '').trim();
  if (shown === '' || shown === '.' || shown === './') return null;
  if (design === null) return shown;
  const files = [...new Set(design.entry === null ? design.files : [design.entry, ...design.files])];
  const slashed = shown.replaceAll('\\', '/');
  if (!slashed.includes('/')) {
    const named = files.filter((file) => basename(file) === slashed);
    return named.length === 1 ? (named[0] ?? shown) : shown;
  }
  return files.find((file) => slashed === file || slashed === `${design.slug}/${file}` || slashed.endsWith(`/${design.slug}/${file}`)) ?? shown;
};

/** `null` for a tool the table doesn't know. */
export const describeTool = (tool: SessionTool, design: ToolDesign | null): ToolWords | null => {
  const kind = KINDS.get(toolName(tool.name));
  if (kind === undefined) return null;
  const naming = WITH_PATH[kind];
  if (naming === undefined) {
    // Every kind is in exactly one of the two tables, so this one is in FIXED.
    const [full, short] = FIXED[kind as keyof typeof FIXED];
    return { kind, full, short, path: null };
  }
  const path = toolPath(tool.target, design);
  if (path === null) return { kind, full: naming.none, short: naming.none, path: null };
  return { kind, full: `${naming.verb} ${middlePath(path, FULL_PATH_MAX)}`, short: `${naming.verb} ${middlePath(basename(path), NAME_MAX)}`, path };
};
