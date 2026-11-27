// The `design_list` and `design_read` OpenCode tools (documentation/specs/use-the-project-and-native-agent.md
// §2.3): the design_check pattern. They run inside OpenCode with the user's full access, so they
// decide very little: the input is checked here before anything runs (a bare folder name, an
// absolute project path as text, a short line of text, a kind), and the `dc list` / `dc read`
// child does the reading under the designs root it resolves itself. The program, the environment,
// the caps and the timeout are run-cli.ts's, the same as design_check's. Read only; no service
// call and no token.
//
// No Node import here, static or dynamic: built-ins arrive through `ToolDeps` (index.ts).

import { CHECK_TOOL_ERROR_TEXT_MAX, CHECK_TOOL_STDOUT_MAX_BYTES, PROJECT_DIRECTORY_MAX, SLUG_PATTERN } from '../shared/limits.ts';
import { LIST_TEXT_MAX } from '../shared/agent/read-text.ts';
import { childEnv, errorCode, resolveRuntime, runChild, type ChildOutcome, type ToolDeps } from './run-cli.ts';
import type { ToolAnswer, ToolContext } from './check-tool.ts';

export const LIST_TOOL_NAME = 'design_list';
export const READ_TOOL_NAME = 'design_read';

/** Both tools only read a few small files: 20 s is far more than they take. */
export const READ_TOOL_TIMEOUT_MS = 20_000;

export const LIST_TOOL_DESCRIPTION =
  'List the designs and design systems in the user\'s Designs folder, newest first, and say which one the user has open now.';
export const READ_TOOL_DESCRIPTION =
  "Read one design's state: the user's open pins with the element each points at, what the user has open, hand edits waiting, the system it uses and the last check.";

/** Plain JSON Schema (OpenCode takes no zod here). Extra keys are let through and ignored. */
export const LIST_TOOL_INPUT = {
  type: 'object',
  additionalProperties: true,
  properties: {
    project: { type: 'string', description: 'Only designs made for this project folder (its full path)' },
    kind: { type: 'string', enum: ['page', 'canvas'], description: 'Only pages or only canvases' },
    text: { type: 'string', description: 'Only designs whose folder name or title contains this' },
  },
} as const;

export const READ_TOOL_INPUT = {
  type: 'object',
  additionalProperties: true,
  properties: {
    design: { type: 'string', description: 'The design folder name, such as pricing-page' },
  },
  required: ['design'],
} as const;

const NOT_A_DESIGN_SENTENCE = 'That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.';
const NOT_A_PROJECT_SENTENCE = 'project must be the full path of a project folder, such as /home/you/code/shop.';
const NOT_A_KIND_SENTENCE = 'kind takes page or canvas.';
const NOT_A_TEXT_SENTENCE = `text must be 1 to ${LIST_TEXT_MAX} characters on one line.`;
const NOT_AN_OBJECT_SENTENCE = 'Give the tool its input as an object, such as { "project": "/home/you/code/shop" }, or no input at all.';
const SETUP_SENTENCE = "Design Chamber hasn't set up its tools yet. Open the Design Chamber panel once, then try again.";
const launcherSentence = (name: string, command: string): string =>
  `The ${name} tool can't run in this setup. Run ${command} with the launcher named in the AGENTS.md file in the Designs folder instead.`;
const CLI_MISSING_SENTENCE = "Design Chamber's program is missing from its extension folder. Reinstall Design Chamber, then try again.";
const STOPPED_SENTENCE = 'The read was stopped before it finished.';
const TIMEOUT_SENTENCE = 'Reading the Designs folder took longer than 20 seconds and was stopped. Try again, or narrow the list with project, kind or text.';
const COULD_NOT_READ = "Design Chamber couldn't read the Designs folder: ";

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const answer = (content: string, exit: 0 | 2): ToolAnswer => ({ content, metadata: { designChamber: { exit } } });

// ---- 1. tool input ----

export type ListInput = { project: string | null; kind: 'page' | 'canvas' | null; text: string | null };
export type ParsedList = ({ ok: true } & ListInput) | { ok: false; message: string };
export type ParsedRead = { ok: true; design: string } | { ok: false; message: string };

/** Absent, null and '' all mean "not given" (models send all three for an optional field). */
const given = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/**
 * `design_list` input, validated before anything runs. `project` is an absolute path as text
 * (never opened here; the CLI compares it as text), `text` one short line, `kind` the enum.
 */
export const parseListInput = (input: unknown, isAbsolute: (text: string) => boolean): ParsedList => {
  if (input === undefined || input === null) return { ok: true, project: null, kind: null, text: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: NOT_AN_OBJECT_SENTENCE };
  const value = input as { project?: unknown; kind?: unknown; text?: unknown };
  let project: string | null = null;
  if (given(value.project)) {
    if (typeof value.project !== 'string' || value.project.length > PROJECT_DIRECTORY_MAX || CONTROL.test(value.project) || !isAbsolute(value.project)) {
      return { ok: false, message: NOT_A_PROJECT_SENTENCE };
    }
    project = value.project;
  }
  let kind: ListInput['kind'] = null;
  if (given(value.kind)) {
    if (value.kind !== 'page' && value.kind !== 'canvas') return { ok: false, message: NOT_A_KIND_SENTENCE };
    kind = value.kind;
  }
  let text: string | null = null;
  if (given(value.text)) {
    if (typeof value.text !== 'string' || value.text.trim() === '' || value.text.length > LIST_TEXT_MAX || CONTROL.test(value.text)) return { ok: false, message: NOT_A_TEXT_SENTENCE };
    text = value.text;
  }
  return { ok: true, project, kind, text };
};

/** `design_read` input: a bare design folder name (`SLUG_PATTERN`), as design_check takes it. */
export const parseReadInput = (input: unknown): ParsedRead => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };
  const design = (input as { design?: unknown }).design;
  if (typeof design !== 'string' || !SLUG_PATTERN.test(design)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };
  return { ok: true, design };
};

// ---- 4. the child's arguments ----

/** Values go with `=`, so a text that starts with `-` stays a value and can never become an option. */
export const buildListArgs = (cliPath: string, input: ListInput): string[] => [
  cliPath,
  'list',
  ...(input.project === null ? [] : [`--project=${input.project}`]),
  ...(input.kind === null ? [] : [`--kind=${input.kind}`]),
  ...(input.text === null ? [] : [`--text=${input.text}`]),
];

export const buildReadArgs = (cliPath: string, design: string): string[] => [cliPath, 'read', design];

// ---- 7. the answer ----

export const readToolResult = (outcome: ChildOutcome): ToolAnswer => {
  if (outcome.kind === 'timeout') return answer(TIMEOUT_SENTENCE, 2);
  if (outcome.kind === 'spawn-error') return answer(`Design Chamber could not start its program (${outcome.code}).`, 2);
  if (outcome.code === 0) {
    const note = outcome.stdoutCut ? `\n(The rest of the answer was cut at ${Math.round(CHECK_TOOL_STDOUT_MAX_BYTES / 1_048_576)} MB.)\n` : '';
    return answer(`${outcome.stdout}${note}`, 0);
  }
  if (outcome.code === null) return answer(STOPPED_SENTENCE, 2);
  // Exit 2 carries one plain sentence on stderr (the CLI's "That is not a design in ...", "does not exist").
  const sentence = outcome.stderr.trim().slice(0, CHECK_TOOL_ERROR_TEXT_MAX);
  return answer(sentence === '' ? `${COULD_NOT_READ}it stopped with exit code ${outcome.code}.` : sentence, 2);
};

// ---- execute ----

type Run = { name: string; command: string; args: (cliPath: string) => string[] };

const runRead = async (run: Run, signal: AbortSignal | undefined, deps: ToolDeps): Promise<ToolAnswer> => {
  const runtime = await resolveRuntime(deps);
  if (!runtime.ok) return answer(runtime.reason === 'setup' ? SETUP_SENTENCE : runtime.reason === 'cli-missing' ? CLI_MISSING_SENTENCE : launcherSentence(run.name, run.command), 2);
  if (signal?.aborted) return answer(STOPPED_SENTENCE, 2);
  const outcome = await runChild(deps, runtime.execPath, run.args(deps.cliPath), childEnv(deps.env, deps.platform), signal, READ_TOOL_TIMEOUT_MS);
  return readToolResult(outcome);
};

/** `design_list`'s whole `execute`. Never rejects. */
export const runDesignList = async (input: unknown, signal: AbortSignal | undefined, deps: ToolDeps): Promise<ToolAnswer> => {
  try {
    const parsed = parseListInput(input, deps.path.isAbsolute);
    if (!parsed.ok) return answer(parsed.message, 2);
    return await runRead({ name: LIST_TOOL_NAME, command: 'dc list', args: (cli) => buildListArgs(cli, parsed) }, signal, deps);
  } catch (error) {
    return answer(`Design Chamber could not start its program (${errorCode(error)}).`, 2);
  }
};

/** `design_read`'s whole `execute`. Never rejects. */
export const runDesignRead = async (input: unknown, signal: AbortSignal | undefined, deps: ToolDeps): Promise<ToolAnswer> => {
  try {
    const parsed = parseReadInput(input);
    if (!parsed.ok) return answer(parsed.message, 2);
    return await runRead({ name: READ_TOOL_NAME, command: `dc read ${parsed.design}`, args: (cli) => buildReadArgs(cli, parsed.design) }, signal, deps);
  } catch (error) {
    return answer(`Design Chamber could not start its program (${errorCode(error)}).`, 2);
  }
};

export type ReadTool = {
  name: string;
  description: string;
  options: { codemode: false };
  input: typeof LIST_TOOL_INPUT | typeof READ_TOOL_INPUT;
  execute(input: unknown, context: ToolContext | undefined): Promise<ToolAnswer>;
};

const tool = (name: string, description: string, input: ReadTool['input'], run: typeof runDesignList, deps: () => ToolDeps): ReadTool => ({
  name,
  description,
  // Seen directly in the tool list, as design_check is.
  options: { codemode: false },
  input,
  async execute(value, context) {
    let built: ToolDeps;
    try {
      built = deps();
    } catch (error) {
      return answer(`Design Chamber could not start its program (${errorCode(error)}).`, 2);
    }
    return run(value, context?.signal, built);
  },
});

/** The tools OpenCode registers. `deps` is built per call, so a missing built-in only fails that call. */
export const createDesignListTool = (deps: () => ToolDeps): ReadTool => tool(LIST_TOOL_NAME, LIST_TOOL_DESCRIPTION, LIST_TOOL_INPUT, runDesignList, deps);
export const createDesignReadTool = (deps: () => ToolDeps): ReadTool => tool(READ_TOOL_NAME, READ_TOOL_DESCRIPTION, READ_TOOL_INPUT, runDesignRead, deps);
