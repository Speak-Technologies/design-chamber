// The `design_check` OpenCode tool (documentation/specs/phase-1-5-sdk-2-7.md §U3.3, threat model §6).
//
// It runs inside OpenCode with the user's full access, so it decides very little and checks it all:
// the input is a bare design folder name (the CLI re-contains it under the designs root), the
// program it runs is the OpenChamber binary inside the install that runs this OpenCode (never
// whatever runtime.json says), the child gets an allowlisted environment, and its output is capped
// and time-limited. It never talks to the service and never sees its token.
//
// No Node import here, static or dynamic: built-ins arrive through `ToolDeps`, which index.ts fills
// from `process.getBuiltinModule` when the tool runs. Type-only imports are erased by esbuild.

import {
  CHECK_TOOL_ERROR_TEXT_MAX,
  CHECK_TOOL_SCREENS_MAX,
  CHECK_TOOL_STDOUT_MAX_BYTES,
  SCREEN_ID_PATTERN,
  SLUG_PATTERN,
  SYSTEM_ID_PATTERN,
} from '../shared/limits.ts';
import { childEnv, errorCode, resolveRuntime, runChild, type ChildOutcome, type ToolDeps } from './run-cli.ts';

// The spawn rules moved to run-cli.ts (shared with design_list and design_read); these names stay importable from here.
export {
  childEnv,
  installRootOf,
  recordExecPath,
  runtimeRecordFile,
  validateRuntime,
  type ChildOutcome,
  type RuntimeCheck,
  type SpawnedChild,
  type SpawnOptions,
  type ToolDeps,
} from './run-cli.ts';

// ---- what the agent reads ----

export const TOOL_NAME = 'design_check';

export const NOT_A_DESIGN_SENTENCE = 'That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.';
const NOT_SCREENS_SENTENCE = 'Those are not screen ids. Use the ids listed in the design.json screens, such as home or pricing.';
const TOO_MANY_SCREENS_SENTENCE = `Check at most ${CHECK_TOOL_SCREENS_MAX} screens at a time, or leave screens out to check them all.`;
const NOT_STATIC_SENTENCE = 'static takes true or false.';
export const NOT_A_SYSTEM_SENTENCE = 'That is not a design system id. Use the name of a folder in the Designs folder\'s _systems folder, such as acme.';
const BOTH_SENTENCE = 'Check a design or a design system, not both: give design or system.';
const SYSTEM_SCREENS_SENTENCE = 'A design system has no screens; leave screens out.';
const NOT_AREA_SENTENCE = 'area takes foundations, components, patterns or brand.';
const NOT_SCHEME_SENTENCE = 'scheme takes light, dark or both.';
const DESIGN_AREA_SENTENCE = 'area and scheme are for a design system: give system instead of design.';
export const SETUP_SENTENCE = "Design Chamber hasn't set up its check tool yet. Open the Design Chamber panel once, then try again.";
export const LAUNCHER_SENTENCE = "The design_check tool can't run in this setup. Run the check command from the AGENTS.md file in the Designs folder instead.";
const CLI_MISSING_SENTENCE = "Design Chamber's check program is missing from its extension folder. Reinstall Design Chamber, then try again.";
const STOPPED_SENTENCE = 'The check was stopped before it finished, so no report was saved.';
const TIMEOUT_SENTENCE = 'The check took longer than 3 minutes and was stopped. Try one screen with screens: ["<id>"].';
const SYSTEM_TIMEOUT_SENTENCE = 'The check took longer than 3 minutes and was stopped. Run it again with static: true to check the files only.';
const COULD_NOT_RUN = 'The check could not run: ';

export const TOOL_DESCRIPTION =
  'Check a design in the Designs folder before you say it is done: renders every screen at its sizes offline, saves PNGs to look at, and lists what to fix.';

/** Plain JSON Schema (OpenCode takes no zod here). Extra keys are let through and ignored. */
export const TOOL_INPUT = {
  type: 'object',
  additionalProperties: true,
  // One of design or system (Phase 2.5 §10.2); parseToolInput enforces it.
  properties: {
    design: { type: 'string', description: 'The design folder name, such as pricing-page' },
    system: { type: 'string', description: 'Instead of design: a design system id, such as acme. Draws its board at two widths and saves PNGs to look at, dark too when it has dark values' },
    area: { type: 'string', enum: ['foundations', 'components', 'patterns', 'brand'], description: 'Design systems only: picture and measure just this area (the file checks still cover all of it)' },
    scheme: { type: 'string', enum: ['light', 'dark', 'both'], description: 'Design systems only: which schemes to draw (default both when it has dark values)' },
    screens: { type: 'array', items: { type: 'string' }, description: 'Canvas only: check just these screen ids' },
    static: { type: 'boolean', description: 'Check the files only, without a browser (designs and systems)' },
  },
} as const;

export type ToolAnswer = { content: string; metadata: { designChamber: { exit: 0 | 1 | 2 } } };

const answer = (content: string, exit: 0 | 1 | 2): ToolAnswer => ({ content, metadata: { designChamber: { exit } } });

// ---- 1. tool input ----

export type DesignCheckInput = { design: string; screens: string[]; static: boolean };
/**
 * A design system: no screens; `static` checks the files only (Phase 2.5 §10.2, visual check §B.7);
 * `area` and `scheme` are present only when given (system-builder-depth D8).
 */
export type SystemCheckInput = { system: string; static: boolean; area?: 'foundations' | 'components' | 'patterns' | 'brand'; scheme?: 'light' | 'dark' | 'both' };

const AREAS: readonly NonNullable<SystemCheckInput['area']>[] = ['foundations', 'components', 'patterns', 'brand'];
const SCHEMES: readonly NonNullable<SystemCheckInput['scheme']>[] = ['light', 'dark', 'both'];

/** One of a closed list, absent, or `false` when it is something else (a forged value never reaches the CLI). */
const closedValue = <T extends string>(value: unknown, options: readonly T[]): T | undefined | false => {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : false;
};
export type CheckInput = DesignCheckInput | SystemCheckInput;
export type ParsedInput = ({ ok: true } & CheckInput) | { ok: false; message: string };

/** `static` as a boolean or its text; null when it is neither (absent reads as false). */
const staticValue = (value: unknown): boolean | null => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  return null;
};

/** Screens as an array, a stringified array or a comma-separated string (models send all three). */
const screenList = (value: unknown): unknown[] | null => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return text.split(',').map((part) => part.trim()).filter((part) => part !== '');
};

/**
 * The tool input, validated at the boundary. `design` must be a bare folder name (`SLUG_PATTERN`):
 * no path of any kind reaches the CLI. Screens are screen ids, at most `CHECK_TOOL_SCREENS_MAX`,
 * de-duplicated in order; `static` is a boolean or its text.
 */
export const parseToolInput = (input: unknown): ParsedInput => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };
  const value = input as { design?: unknown; system?: unknown; screens?: unknown; static?: unknown; area?: unknown; scheme?: unknown };
  if (value.system !== undefined && value.system !== null) {
    if (value.design !== undefined && value.design !== null) return { ok: false, message: BOTH_SENTENCE };
    if (typeof value.system !== 'string' || !SYSTEM_ID_PATTERN.test(value.system) || value.system === 'none' || value.system === 'ask') return { ok: false, message: NOT_A_SYSTEM_SENTENCE };
    const screens = screenList(value.screens);
    if (screens === null || screens.length > 0) return { ok: false, message: SYSTEM_SCREENS_SENTENCE };
    const systemStatic = staticValue(value.static);
    if (systemStatic === null) return { ok: false, message: NOT_STATIC_SENTENCE };
    const area = closedValue(value.area, AREAS);
    if (area === false) return { ok: false, message: NOT_AREA_SENTENCE };
    const scheme = closedValue(value.scheme, SCHEMES);
    if (scheme === false) return { ok: false, message: NOT_SCHEME_SENTENCE };
    return { ok: true, system: value.system, static: systemStatic, ...(area !== undefined ? { area } : {}), ...(scheme !== undefined ? { scheme } : {}) };
  }
  if ((value.area !== undefined && value.area !== null) || (value.scheme !== undefined && value.scheme !== null)) return { ok: false, message: DESIGN_AREA_SENTENCE };
  if (typeof value.design !== 'string' || !SLUG_PATTERN.test(value.design)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };

  const list = screenList(value.screens);
  if (list === null || !list.every((screen): screen is string => typeof screen === 'string' && SCREEN_ID_PATTERN.test(screen))) {
    return { ok: false, message: NOT_SCREENS_SENTENCE };
  }
  const screens = [...new Set(list)];
  if (screens.length > CHECK_TOOL_SCREENS_MAX) return { ok: false, message: TOO_MANY_SCREENS_SENTENCE };

  const staticOnly = staticValue(value.static);
  if (staticOnly === null) return { ok: false, message: NOT_STATIC_SENTENCE };

  return { ok: true, design: value.design, screens, static: staticOnly };
};

// ---- 2, 3. the runtime record and the program: run-cli.ts `resolveRuntime` ----
// ---- 4, 5. the child (its environment: run-cli.ts `childEnv`) ----

export const buildChildArgs = (cliPath: string, input: CheckInput): string[] =>
  'system' in input
    ? [
        cliPath,
        'check',
        '--system',
        input.system,
        ...(input.area !== undefined ? ['--area', input.area] : []),
        ...(input.scheme !== undefined ? ['--scheme', input.scheme] : []),
        ...(input.static ? ['--static'] : []),
      ]
    : [cliPath, 'check', input.design, ...input.screens.flatMap((screen) => ['--screen', screen]), ...(input.static ? ['--static'] : [])];

// ---- 6. running it: run-cli.ts `runChild` ----
// ---- 7. the answer ----

export const toolResult = (outcome: ChildOutcome, system = false): ToolAnswer => {
  if (outcome.kind === 'timeout') return answer(system ? SYSTEM_TIMEOUT_SENTENCE : TIMEOUT_SENTENCE, 2);
  if (outcome.kind === 'spawn-error') return answer(`Design Chamber could not start its check (${outcome.code}).`, 2);
  if (outcome.code === 0 || outcome.code === 1) {
    const note = outcome.stdoutCut ? `\n(The rest of the check output was cut at ${Math.round(CHECK_TOOL_STDOUT_MAX_BYTES / 1_048_576)} MB.)\n` : '';
    return answer(`${outcome.stdout}${note}`, outcome.code);
  }
  if (outcome.code === null) return answer(STOPPED_SENTENCE, 2);
  // The CLI's own crash path already starts with the same words; don't say them twice.
  const raw = outcome.stderr.trim();
  const sentence = (raw.startsWith(COULD_NOT_RUN) ? raw.slice(COULD_NOT_RUN.length) : raw).slice(0, CHECK_TOOL_ERROR_TEXT_MAX);
  return answer(`${COULD_NOT_RUN}${sentence === '' ? `it stopped with exit code ${outcome.code}.` : sentence}`, 2);
};

// ---- execute ----

/** The whole `execute`, in the order of §U3.3. Never rejects. */
export const runDesignCheck = async (input: unknown, signal: AbortSignal | undefined, deps: ToolDeps): Promise<ToolAnswer> => {
  try {
    const parsed = parseToolInput(input);
    if (!parsed.ok) return answer(parsed.message, 2);
    const runtime = await resolveRuntime(deps);
    if (!runtime.ok) return answer(runtime.reason === 'setup' ? SETUP_SENTENCE : runtime.reason === 'cli-missing' ? CLI_MISSING_SENTENCE : LAUNCHER_SENTENCE, 2);
    if (signal?.aborted) return answer(STOPPED_SENTENCE, 2);

    const outcome = await runChild(deps, runtime.execPath, buildChildArgs(deps.cliPath, parsed), childEnv(deps.env, deps.platform), signal);
    return toolResult(outcome, 'system' in parsed);
  } catch (error) {
    return answer(`Design Chamber could not start its check (${errorCode(error)}).`, 2);
  }
};

export type ToolContext = { signal?: AbortSignal; sessionID?: string };

export type DesignCheckTool = {
  name: string;
  description: string;
  options: { codemode: false };
  input: typeof TOOL_INPUT;
  execute(input: unknown, context: ToolContext | undefined): Promise<ToolAnswer>;
};

/** The tool OpenCode registers. `deps` is built per call, so a missing built-in only fails that call. */
export const createDesignCheckTool = (deps: () => ToolDeps): DesignCheckTool => ({
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  // Seen directly in the tool list: an agent finishing a design should not have to search for it (§U3.3).
  options: { codemode: false },
  input: TOOL_INPUT,
  async execute(input, context) {
    let built: ToolDeps;
    try {
      built = deps();
    } catch (error) {
      return answer(`Design Chamber could not start its check (${errorCode(error)}).`, 2);
    }
    return runDesignCheck(input, context?.signal, built);
  },
});
