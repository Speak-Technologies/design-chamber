// Which design the CLI checks (documentation/specs/agent-render-and-check.md §4.7). The argument
// is a design folder name, or a path to a design folder. Either way the result must be a DIRECT
// child of the (realpath'd) designs root and a design folder: `..`, a link to elsewhere, a nested
// folder, the root itself, a UNC or drive path outside the root, a plain folder all end in the
// same refusal. Pure over an injected path flavour, realpath and design test.

import { SLUG_PATTERN } from '../../shared/limits.ts';
import { samePath, type PathModule } from '../paths.ts';

export type TargetDeps = {
  /** `path`, `path.win32` or `path.posix`. */
  path: PathModule & { dirname(p: string): string };
  realpath: (target: string) => Promise<string>;
  isDesignFolder: (dir: string) => Promise<boolean>;
  platform: NodeJS.Platform;
};

export type TargetResult = { ok: true; slug: string; dir: string; root: string } | { ok: false; message: string };

const refusal = (root: string): TargetResult => ({ ok: false, message: `That is not a design in ${root}.` });

export const resolveTarget = async (input: { arg: string; root: string; cwd: string }, deps: TargetDeps): Promise<TargetResult> => {
  const { arg, root, cwd } = input;
  if (arg.trim() === '' || arg.includes('\0')) return refusal(root);
  let realRoot: string;
  try {
    realRoot = await deps.realpath(deps.path.resolve(root));
  } catch {
    return { ok: false, message: `The designs folder ${root} does not exist.` };
  }
  // A bare name is a design in the root; anything with a separator or a drive is a path from here.
  const candidate = SLUG_PATTERN.test(arg) ? deps.path.join(realRoot, arg) : deps.path.resolve(cwd, arg);
  let real: string;
  try {
    real = await deps.realpath(candidate);
  } catch {
    return refusal(root);
  }
  const slug = deps.path.basename(real);
  if (!SLUG_PATTERN.test(slug)) return refusal(root);
  if (!samePath(deps.path.dirname(real), realRoot, deps.path, deps.platform)) return refusal(root);
  if (!(await deps.isDesignFolder(real))) return refusal(root);
  return { ok: true, slug, dir: real, root: realRoot };
};
