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

import { designChamberDataDir, RUNTIME_FILE } from '../shared/app-data.ts';
import {
  CHECK_TOOL_ERROR_TEXT_MAX,
  CHECK_TOOL_KILL_GRACE_MS,
  CHECK_TOOL_SCREENS_MAX,
  CHECK_TOOL_STDERR_MAX_BYTES,
  CHECK_TOOL_STDOUT_MAX_BYTES,
  CHECK_TOOL_TIMEOUT_MS,
  RUNTIME_PATH_MAX,
  SCREEN_ID_PATTERN,
  SLUG_PATTERN,
} from '../shared/limits.ts';
import { foldsCase, isStrictlyInside, type PathModule } from '../shared/path-compare.ts';

// ---- what the agent reads ----

export const TOOL_NAME = 'design_check';

export const NOT_A_DESIGN_SENTENCE = 'That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.';
const NOT_SCREENS_SENTENCE = 'Those are not screen ids. Use the ids listed in the design.json screens, such as home or pricing.';
const TOO_MANY_SCREENS_SENTENCE = `Check at most ${CHECK_TOOL_SCREENS_MAX} screens at a time, or leave screens out to check them all.`;
const NOT_STATIC_SENTENCE = 'static takes true or false.';
export const SETUP_SENTENCE = "Design Chamber hasn't set up its check tool yet. Open the Design Chamber panel once, then try again.";
export const LAUNCHER_SENTENCE = "The design_check tool can't run in this setup. Run the check command from the AGENTS.md file in the Designs folder instead.";
const CLI_MISSING_SENTENCE = "Design Chamber's check program is missing from its extension folder. Reinstall Design Chamber, then try again.";
const STOPPED_SENTENCE = 'The check was stopped before it finished, so no report was saved.';
const TIMEOUT_SENTENCE = 'The check took longer than 3 minutes and was stopped. Try one screen with screens: ["<id>"].';
const COULD_NOT_RUN = 'The check could not run: ';

/** runtime.json is a few hundred bytes; anything far bigger is not ours and is not read whole. */
const RECORD_TEXT_MAX_BYTES = 16 * 1024;

export const TOOL_DESCRIPTION =
  'Check a design in the Designs folder before you say it is done: renders every screen at its sizes offline, saves PNGs to look at, and lists what to fix.';

/** Plain JSON Schema (OpenCode takes no zod here). Extra keys are let through and ignored. */
export const TOOL_INPUT = {
  type: 'object',
  additionalProperties: true,
  required: ['design'],
  properties: {
    design: { type: 'string', description: 'The design folder name, such as pricing-page' },
    screens: { type: 'array', items: { type: 'string' }, description: 'Canvas only: check just these screen ids' },
    static: { type: 'boolean', description: 'Check the files only, without a browser' },
  },
} as const;

export type ToolAnswer = { content: string; metadata: { designChamber: { exit: 0 | 1 | 2 } } };

const answer = (content: string, exit: 0 | 1 | 2): ToolAnswer => ({ content, metadata: { designChamber: { exit } } });

// ---- 1. tool input ----

export type CheckInput = { design: string; screens: string[]; static: boolean };
export type ParsedInput = ({ ok: true } & CheckInput) | { ok: false; message: string };

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
  const value = input as { design?: unknown; screens?: unknown; static?: unknown };
  if (typeof value.design !== 'string' || !SLUG_PATTERN.test(value.design)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };

  const list = screenList(value.screens);
  if (list === null || !list.every((screen): screen is string => typeof screen === 'string' && SCREEN_ID_PATTERN.test(screen))) {
    return { ok: false, message: NOT_SCREENS_SENTENCE };
  }
  const screens = [...new Set(list)];
  if (screens.length > CHECK_TOOL_SCREENS_MAX) return { ok: false, message: TOO_MANY_SCREENS_SENTENCE };

  let staticOnly: boolean;
  if (value.static === undefined || value.static === null) staticOnly = false;
  else if (typeof value.static === 'boolean') staticOnly = value.static;
  else if (value.static === 'true' || value.static === 'false') staticOnly = value.static === 'true';
  else return { ok: false, message: NOT_STATIC_SENTENCE };

  return { ok: true, design: value.design, screens, static: staticOnly };
};

// ---- 2. the runtime record, checked against the install that runs OpenCode ----

/**
 * The OpenChamber install folder around OpenCode's own executable: everything before the last
 * `resources` segment followed by `opencode-cli` (folded where the platform folds case), as in
 * `/opt/OpenChamber/resources/opencode-cli/opencode` → `/opt/OpenChamber`. `null` for an OpenCode
 * installed on its own, a relative path, or a root that would be the filesystem root.
 */
export const installRootOf = (opencodeExecPath: string, p: PathModule, platform: NodeJS.Platform): string | null => {
  if (!p.isAbsolute(opencodeExecPath)) return null;
  const resolved = p.resolve(opencodeExecPath);
  const fsRoot = p.parse(resolved).root;
  const segments = resolved.slice(fsRoot.length).split(p.sep).filter((segment) => segment !== '');
  const fold = foldsCase(p, platform) ? (segment: string): string => segment.toLowerCase() : (segment: string): string => segment;
  // `opencode-cli` must be a folder (something follows it), and `resources` must not sit at the
  // filesystem root: an install root of `/` or `C:\` would contain every program on the machine.
  for (let index = segments.length - 3; index >= 1; index -= 1) {
    if (fold(segments[index] ?? '') === 'resources' && fold(segments[index + 1] ?? '') === 'opencode-cli') {
      return p.join(fsRoot, ...segments.slice(0, index));
    }
  }
  return null;
};

export type RuntimeCheck = {
  /** The parsed runtime.json, untrusted. */
  record: unknown;
  /** realpath of `record.execPath`, or `null` when it does not resolve. */
  realExecPath: string | null;
  /** realpath of `installRootOf(...)`, or `null` when there is none. */
  realInstallRoot: string | null;
  /** Whether `realExecPath` is a regular file. */
  isFile: boolean;
};

/** `record.execPath` when the record has the shape the service writes; `null` otherwise. Touches no disk. */
export const recordExecPath = (record: unknown, p: PathModule): string | null => {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return null;
  const { v, execPath } = record as { v?: unknown; execPath?: unknown };
  if (v !== 1 || typeof execPath !== 'string') return null;
  if (execPath.length === 0 || execPath.length > RUNTIME_PATH_MAX || /[\u0000-\u001f\u007f]/.test(execPath)) return null;
  return p.isAbsolute(execPath) ? execPath : null;
};

/** The OpenChamber binary's name on every platform: `openchamber`, `OpenChamber`, `OpenChamber.exe`. */
const isOpenChamberName = (file: string, p: PathModule): boolean => p.basename(file).toLowerCase().replace(/\.exe$/, '') === 'openchamber';

/**
 * Whether the recorded program may run: the OpenChamber binary (basename `openchamber`, any case,
 * `.exe` dropped) whose realpath is a regular file strictly inside the realpath of the install
 * that runs this OpenCode. Whatever runtime.json says, nothing else runs. Answers the realpath to spawn.
 */
export const validateRuntime = (check: RuntimeCheck, p: PathModule, platform: NodeJS.Platform): { ok: true; execPath: string } | { ok: false } => {
  const { realExecPath, realInstallRoot } = check;
  if (recordExecPath(check.record, p) === null) return { ok: false };
  if (realExecPath === null || realInstallRoot === null || !check.isFile) return { ok: false };
  if (!p.isAbsolute(realExecPath) || !p.isAbsolute(realInstallRoot)) return { ok: false };
  if (!isOpenChamberName(realExecPath, p)) return { ok: false };
  if (!isStrictlyInside(realInstallRoot, realExecPath, p, platform)) return { ok: false };
  return { ok: true, execPath: realExecPath };
};

/** Where the plugin reads runtime.json: the service's folder, ignoring OpenCode's XDG_CONFIG_HOME. */
export const runtimeRecordFile = (env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform, homeDir: string, p: PathModule): string =>
  p.join(designChamberDataDir({ platform, homeDir, appData: env.APPDATA, xdgConfigHome: undefined, join: p.join }), RUNTIME_FILE);

// ---- 4, 5. the child ----

export const buildChildArgs = (cliPath: string, input: CheckInput): string[] => [
  cliPath,
  'check',
  input.design,
  ...input.screens.flatMap((screen) => ['--screen', screen]),
  ...(input.static ? ['--static'] : []),
];

/**
 * A fresh environment for the CLI: the few variables it needs to find its settings, a browser and
 * a temp folder, plus `ELECTRON_RUN_AS_NODE=1`. OpenCode's own secrets (its server password, the
 * agent tool token, provider keys) never reach it. Windows names match in any case.
 */
const CHILD_ENV_KEYS: readonly string[] = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'windir',
];

export const childEnv = (env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): Record<string, string> => {
  const windows = platform === 'win32';
  const allowed = new Set(CHILD_ENV_KEYS.map((key) => (windows ? key.toUpperCase() : key)));
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    const name = windows ? key.toUpperCase() : key;
    if (typeof value !== 'string' || !allowed.has(name) || taken.has(name)) continue;
    taken.add(name);
    out[key] = value;
  }
  out.ELECTRON_RUN_AS_NODE = '1';
  return out;
};

// ---- 6. running it ----

/** The part of a Node `ChildProcess` the runner uses, so tests can hand in a fake. */
export type SpawnedChild = {
  stdout: { on(event: 'data', listener: (chunk: Uint8Array) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Uint8Array) => void): unknown } | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal: 'SIGTERM' | 'SIGKILL'): boolean;
};

export type SpawnOptions = { env: Record<string, string>; shell: false; windowsHide: true; stdio: ['ignore', 'pipe', 'pipe'] };

export type ToolDeps = {
  platform: NodeJS.Platform;
  /** The path flavour of `platform`. */
  path: PathModule;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  /** OpenCode's own `process.execPath`. */
  opencodeExecPath: string;
  /** `dist/cli/dc.mjs` beside this plugin in the same package. */
  cliPath: string;
  /** The file's text, `null` when it does not exist, `''` when it is larger than `maxBytes`. */
  readText(file: string, maxBytes: number): Promise<string | null>;
  /** The realpath, or `null` when it does not resolve. */
  realpath(file: string): Promise<string | null>;
  isFile(file: string): Promise<boolean>;
  spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedChild;
  timeoutMs?: number;
  killGraceMs?: number;
  stdoutMaxBytes?: number;
  stderrMaxBytes?: number;
};

export type ChildOutcome =
  | { kind: 'exit'; code: number | null; stdout: string; stderr: string; stdoutCut: boolean }
  | { kind: 'timeout' }
  | { kind: 'spawn-error'; code: string };

const errorCode = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unknown error';
};

/** Collects a stream up to `max` bytes, then keeps draining it (a full pipe would stall the child) and notes the cut. */
const collector = (max: number) => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  return {
    push(chunk: Uint8Array): void {
      if (size >= max) {
        cut = cut || chunk.byteLength > 0;
        return;
      }
      const room = max - size;
      const kept = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
      if (kept.byteLength < chunk.byteLength) cut = true;
      chunks.push(kept);
      size += kept.byteLength;
    },
    text(): string {
      const all = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(all);
    },
    get cut(): boolean {
      return cut;
    },
  };
};

const runChild = (deps: ToolDeps, execPath: string, args: readonly string[], env: Record<string, string>, signal: AbortSignal | undefined): Promise<ChildOutcome> =>
  new Promise<ChildOutcome>((resolve) => {
    let child: SpawnedChild;
    try {
      child = deps.spawn(execPath, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ kind: 'spawn-error', code: errorCode(error) });
      return;
    }
    const stdout = collector(deps.stdoutMaxBytes ?? CHECK_TOOL_STDOUT_MAX_BYTES);
    const stderr = collector(deps.stderrMaxBytes ?? CHECK_TOOL_STDERR_MAX_BYTES);
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const stop = (): void => {
      if (killTimer !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), deps.killGraceMs ?? CHECK_TOOL_KILL_GRACE_MS);
    };
    const onAbort = (): void => stop();
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, deps.timeoutMs ?? CHECK_TOOL_TIMEOUT_MS);
    const finish = (outcome: ChildOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      // An error after a spawn that never started (ENOENT, EACCES) is the only one that ends the run here.
      finish({ kind: 'spawn-error', code: errorCode(error) });
    });
    child.on('close', (code) => {
      finish(timedOut ? { kind: 'timeout' } : { kind: 'exit', code, stdout: stdout.text(), stderr: stderr.text(), stdoutCut: stdout.cut });
    });
  });

// ---- 7. the answer ----

export const toolResult = (outcome: ChildOutcome): ToolAnswer => {
  if (outcome.kind === 'timeout') return answer(TIMEOUT_SENTENCE, 2);
  if (outcome.kind === 'spawn-error') return answer(`Design Chamber could not start its check (${outcome.code}).`, 2);
  if (outcome.code === 0 || outcome.code === 1) {
    const note = outcome.stdoutCut ? `\n(The rest of the check output was cut at ${Math.round(CHECK_TOOL_STDOUT_MAX_BYTES / 1_048_576)} MB.)\n` : '';
    return answer(`${outcome.stdout}${note}`, outcome.code);
  }
  if (outcome.code === null) return answer(STOPPED_SENTENCE, 2);
  const sentence = outcome.stderr.trim().slice(0, CHECK_TOOL_ERROR_TEXT_MAX);
  return answer(`${COULD_NOT_RUN}${sentence === '' ? `it stopped with exit code ${outcome.code}.` : sentence}`, 2);
};

// ---- execute ----

const parseRecord = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

/** The whole `execute`, in the order of §U3.3. Never rejects. */
export const runDesignCheck = async (input: unknown, signal: AbortSignal | undefined, deps: ToolDeps): Promise<ToolAnswer> => {
  try {
    const parsed = parseToolInput(input);
    if (!parsed.ok) return answer(parsed.message, 2);
    const p = deps.path;

    let text: string | null;
    try {
      text = await deps.readText(runtimeRecordFile(deps.env, deps.platform, deps.homeDir, p), RECORD_TEXT_MAX_BYTES);
    } catch {
      return answer(LAUNCHER_SENTENCE, 2);
    }
    if (text === null) return answer(SETUP_SENTENCE, 2);

    const record = parseRecord(text);
    const opencode = (await deps.realpath(deps.opencodeExecPath)) ?? deps.opencodeExecPath;
    const installRoot = installRootOf(opencode, p, deps.platform);
    const candidate = recordExecPath(record, p);
    if (installRoot === null || candidate === null) return answer(LAUNCHER_SENTENCE, 2);
    const realExecPath = await deps.realpath(candidate);
    const check: RuntimeCheck = {
      record,
      realExecPath,
      realInstallRoot: await deps.realpath(installRoot),
      isFile: realExecPath === null ? false : await deps.isFile(realExecPath),
    };
    const runtime = validateRuntime(check, p, deps.platform);
    if (!runtime.ok) return answer(LAUNCHER_SENTENCE, 2);

    if (!(await deps.isFile(deps.cliPath))) return answer(CLI_MISSING_SENTENCE, 2);
    if (signal?.aborted) return answer(STOPPED_SENTENCE, 2);

    const outcome = await runChild(deps, runtime.execPath, buildChildArgs(deps.cliPath, parsed), childEnv(deps.env, deps.platform), signal);
    return toolResult(outcome);
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
