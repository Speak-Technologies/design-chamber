// The command an agent runs to check a design (documentation/specs/agent-render-and-check.md §5).
// Pure, no Node imports: the instruction builders (chip, RULES.md, guide, skill, prompts) all
// show the same string, built here from the launcher the service writes in
// `<root>/.chamber/bin/` (src/service/check/launcher.ts).

import { joinFolder } from './context.ts';

export type CheckCommandInput = {
  /** Absolute designs root. */
  root: string;
  /** A design folder name, or the literal `<slug>` in the guide and the skill. */
  slug: string;
  platform: NodeJS.Platform;
};

/** Where the launcher for `platform` sits: `dc` (sh) or `dc.cmd` (Windows). */
export const launcherPathOf = (root: string, platform: NodeJS.Platform): string => {
  if (platform !== 'win32') return `${root.replace(/\/+$/, '')}/.chamber/bin/dc`;
  // cmd.exe wants backslashes in a program path, whatever the root was typed with.
  return joinFolder(root.replace(/\//g, '\\'), '.chamber', 'bin', 'dc.cmd');
};

/** Single quotes for sh: the value is literal, each `'` is written `'\''`. */
export const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * POSIX: `sh '<root>/.chamber/bin/dc' check <slug>`. Windows: `"<root>\.chamber\bin\dc.cmd" check <slug>`
 * (the quoted form works in cmd.exe; PowerShell needs `&` in front, which the chip says).
 */
export const checkCommandFor = (input: CheckCommandInput): string => {
  const launcher = launcherPathOf(input.root, input.platform);
  return input.platform === 'win32' ? `"${launcher}" check ${input.slug}` : `sh ${shQuote(launcher)} check ${input.slug}`;
};
