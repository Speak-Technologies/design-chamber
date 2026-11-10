// src/shared/app-data.ts
var RUNTIME_FILE = "runtime.json";
var given = (value) => typeof value === "string" && value.trim() !== "";
var designChamberDataDir = ({ platform, homeDir, appData, xdgConfigHome, join }) => {
  if (platform === "win32") return join(given(appData) ? appData : join(homeDir, "AppData", "Roaming"), "Design Chamber");
  if (platform === "darwin") return join(homeDir, "Library", "Application Support", "Design Chamber");
  return join(given(xdgConfigHome) ? xdgConfigHome : join(homeDir, ".config"), "design-chamber");
};

// src/shared/limits.ts
var SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
var SCREEN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
var SNAPSHOT_BYTES_MAX = 100 * 1024 * 1024;
var TURN_PROMOTE_AUTO_MS = 30 * 6e4;
var UPLOAD_TTL_MS = 10 * 6e4;
var OUTBOX_TTL_MS = 10 * 6e4;
var OPEN_REQUEST_TTL_MS = 2 * 6e4;
var RENDER_DOC_MAX_BYTES = 60 * 1024 * 1024;
var RENDER_CACHE_MAX_BYTES = 256 * 1024 * 1024;
var GUEST_RENDER_CACHE_MAX_BYTES = 64 * 1024 * 1024;
var LOOSE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
var ACTIVITY_WORKING_EXPIRY_MS = 30 * 6e4;
var CHECK_TOOL_TIMEOUT_MS = 18e4;
var CHECK_TOOL_KILL_GRACE_MS = 5e3;
var CHECK_TOOL_STDOUT_MAX_BYTES = 1048576;
var CHECK_TOOL_STDERR_MAX_BYTES = 65536;
var CHECK_TOOL_ERROR_TEXT_MAX = 2e3;
var CHECK_TOOL_SCREENS_MAX = 16;
var RUNTIME_PATH_MAX = 4096;
var STATUS_RECENT_MS = 7 * 864e5;

// src/shared/path-compare.ts
var foldsCase = (p, platform) => p.sep === "\\" || platform === "darwin";
var isEscaping = (relative, p) => relative === ".." || relative.startsWith(`..${p.sep}`) || p.isAbsolute(relative);
var relativeFolded = (from, to, p, platform) => {
  const left = p.resolve(from);
  const right = p.resolve(to);
  return foldsCase(p, platform) ? p.relative(left.toLowerCase(), right.toLowerCase()) : p.relative(left, right);
};
var isStrictlyInside = (base, target, p, platform) => {
  const relative = relativeFolded(base, target, p, platform);
  return relative !== "" && !isEscaping(relative, p);
};

// src/plugin/check-tool.ts
var TOOL_NAME = "design_check";
var NOT_A_DESIGN_SENTENCE = "That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.";
var NOT_SCREENS_SENTENCE = "Those are not screen ids. Use the ids listed in the design.json screens, such as home or pricing.";
var TOO_MANY_SCREENS_SENTENCE = `Check at most ${CHECK_TOOL_SCREENS_MAX} screens at a time, or leave screens out to check them all.`;
var NOT_STATIC_SENTENCE = "static takes true or false.";
var SETUP_SENTENCE = "Design Chamber hasn't set up its check tool yet. Open the Design Chamber panel once, then try again.";
var LAUNCHER_SENTENCE = "The design_check tool can't run in this setup. Run the check command from the AGENTS.md file in the Designs folder instead.";
var CLI_MISSING_SENTENCE = "Design Chamber's check program is missing from its extension folder. Reinstall Design Chamber, then try again.";
var STOPPED_SENTENCE = "The check was stopped before it finished, so no report was saved.";
var TIMEOUT_SENTENCE = 'The check took longer than 3 minutes and was stopped. Try one screen with screens: ["<id>"].';
var COULD_NOT_RUN = "The check could not run: ";
var RECORD_TEXT_MAX_BYTES = 16 * 1024;
var TOOL_DESCRIPTION = "Check a design in the Designs folder before you say it is done: renders every screen at its sizes offline, saves PNGs to look at, and lists what to fix.";
var TOOL_INPUT = {
  type: "object",
  additionalProperties: true,
  required: ["design"],
  properties: {
    design: { type: "string", description: "The design folder name, such as pricing-page" },
    screens: { type: "array", items: { type: "string" }, description: "Canvas only: check just these screen ids" },
    static: { type: "boolean", description: "Check the files only, without a browser" }
  }
};
var answer = (content, exit) => ({ content, metadata: { designChamber: { exit } } });
var screenList = (value) => {
  if (value === void 0 || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return text.split(",").map((part) => part.trim()).filter((part) => part !== "");
};
var parseToolInput = (input) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };
  const value = input;
  if (typeof value.design !== "string" || !SLUG_PATTERN.test(value.design)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };
  const list = screenList(value.screens);
  if (list === null || !list.every((screen) => typeof screen === "string" && SCREEN_ID_PATTERN.test(screen))) {
    return { ok: false, message: NOT_SCREENS_SENTENCE };
  }
  const screens = [...new Set(list)];
  if (screens.length > CHECK_TOOL_SCREENS_MAX) return { ok: false, message: TOO_MANY_SCREENS_SENTENCE };
  let staticOnly;
  if (value.static === void 0 || value.static === null) staticOnly = false;
  else if (typeof value.static === "boolean") staticOnly = value.static;
  else if (value.static === "true" || value.static === "false") staticOnly = value.static === "true";
  else return { ok: false, message: NOT_STATIC_SENTENCE };
  return { ok: true, design: value.design, screens, static: staticOnly };
};
var installRootOf = (opencodeExecPath, p, platform) => {
  if (!p.isAbsolute(opencodeExecPath)) return null;
  const resolved = p.resolve(opencodeExecPath);
  const fsRoot = p.parse(resolved).root;
  const segments = resolved.slice(fsRoot.length).split(p.sep).filter((segment) => segment !== "");
  const fold = foldsCase(p, platform) ? (segment) => segment.toLowerCase() : (segment) => segment;
  for (let index = segments.length - 3; index >= 1; index -= 1) {
    if (fold(segments[index] ?? "") === "resources" && fold(segments[index + 1] ?? "") === "opencode-cli") {
      return p.join(fsRoot, ...segments.slice(0, index));
    }
  }
  return null;
};
var recordExecPath = (record, p) => {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const { v, execPath } = record;
  if (v !== 1 || typeof execPath !== "string") return null;
  if (execPath.length === 0 || execPath.length > RUNTIME_PATH_MAX || /[\u0000-\u001f\u007f]/.test(execPath)) return null;
  return p.isAbsolute(execPath) ? execPath : null;
};
var isOpenChamberName = (file, p) => p.basename(file).toLowerCase().replace(/\.exe$/, "") === "openchamber";
var validateRuntime = (check, p, platform) => {
  const { realExecPath, realInstallRoot } = check;
  if (recordExecPath(check.record, p) === null) return { ok: false };
  if (realExecPath === null || realInstallRoot === null || !check.isFile) return { ok: false };
  if (!p.isAbsolute(realExecPath) || !p.isAbsolute(realInstallRoot)) return { ok: false };
  if (!isOpenChamberName(realExecPath, p)) return { ok: false };
  if (!isStrictlyInside(realInstallRoot, realExecPath, p, platform)) return { ok: false };
  return { ok: true, execPath: realExecPath };
};
var runtimeRecordFile = (env, platform, homeDir, p) => p.join(designChamberDataDir({ platform, homeDir, appData: env.APPDATA, xdgConfigHome: void 0, join: p.join }), RUNTIME_FILE);
var buildChildArgs = (cliPath, input) => [
  cliPath,
  "check",
  input.design,
  ...input.screens.flatMap((screen) => ["--screen", screen]),
  ...input.static ? ["--static"] : []
];
var CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "windir"
];
var childEnv = (env, platform) => {
  const windows = platform === "win32";
  const allowed = new Set(CHILD_ENV_KEYS.map((key) => windows ? key.toUpperCase() : key));
  const out = {};
  const taken = /* @__PURE__ */ new Set();
  for (const [key, value] of Object.entries(env)) {
    const name = windows ? key.toUpperCase() : key;
    if (typeof value !== "string" || !allowed.has(name) || taken.has(name)) continue;
    taken.add(name);
    out[key] = value;
  }
  out.ELECTRON_RUN_AS_NODE = "1";
  return out;
};
var errorCode = (error) => {
  const code = typeof error === "object" && error !== null ? error.code : void 0;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "unknown error";
};
var collector = (max) => {
  const chunks = [];
  let size = 0;
  let cut = false;
  return {
    push(chunk) {
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
    text() {
      const all = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(all);
    },
    get cut() {
      return cut;
    }
  };
};
var runChild = (deps, execPath, args, env, signal) => new Promise((resolve) => {
  let child;
  try {
    child = deps.spawn(execPath, args, { env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    resolve({ kind: "spawn-error", code: errorCode(error) });
    return;
  }
  const stdout = collector(deps.stdoutMaxBytes ?? CHECK_TOOL_STDOUT_MAX_BYTES);
  const stderr = collector(deps.stderrMaxBytes ?? CHECK_TOOL_STDERR_MAX_BYTES);
  let settled = false;
  let timedOut = false;
  let killTimer = null;
  const stop = () => {
    if (killTimer !== null) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), deps.killGraceMs ?? CHECK_TOOL_KILL_GRACE_MS);
  };
  const onAbort = () => stop();
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, deps.timeoutMs ?? CHECK_TOOL_TIMEOUT_MS);
  const finish = (outcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (killTimer !== null) clearTimeout(killTimer);
    signal?.removeEventListener("abort", onAbort);
    resolve(outcome);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  child.stdout?.on("data", (chunk) => stdout.push(chunk));
  child.stderr?.on("data", (chunk) => stderr.push(chunk));
  child.on("error", (error) => {
    finish({ kind: "spawn-error", code: errorCode(error) });
  });
  child.on("close", (code) => {
    finish(timedOut ? { kind: "timeout" } : { kind: "exit", code, stdout: stdout.text(), stderr: stderr.text(), stdoutCut: stdout.cut });
  });
});
var toolResult = (outcome) => {
  if (outcome.kind === "timeout") return answer(TIMEOUT_SENTENCE, 2);
  if (outcome.kind === "spawn-error") return answer(`Design Chamber could not start its check (${outcome.code}).`, 2);
  if (outcome.code === 0 || outcome.code === 1) {
    const note = outcome.stdoutCut ? `
(The rest of the check output was cut at ${Math.round(CHECK_TOOL_STDOUT_MAX_BYTES / 1048576)} MB.)
` : "";
    return answer(`${outcome.stdout}${note}`, outcome.code);
  }
  if (outcome.code === null) return answer(STOPPED_SENTENCE, 2);
  const raw = outcome.stderr.trim();
  const sentence = (raw.startsWith(COULD_NOT_RUN) ? raw.slice(COULD_NOT_RUN.length) : raw).slice(0, CHECK_TOOL_ERROR_TEXT_MAX);
  return answer(`${COULD_NOT_RUN}${sentence === "" ? `it stopped with exit code ${outcome.code}.` : sentence}`, 2);
};
var parseRecord = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
var runDesignCheck = async (input, signal, deps) => {
  try {
    const parsed = parseToolInput(input);
    if (!parsed.ok) return answer(parsed.message, 2);
    const p = deps.path;
    let text;
    try {
      text = await deps.readText(runtimeRecordFile(deps.env, deps.platform, deps.homeDir, p), RECORD_TEXT_MAX_BYTES);
    } catch {
      return answer(LAUNCHER_SENTENCE, 2);
    }
    if (text === null) return answer(SETUP_SENTENCE, 2);
    const record = parseRecord(text);
    const opencode = await deps.realpath(deps.opencodeExecPath) ?? deps.opencodeExecPath;
    const installRoot = installRootOf(opencode, p, deps.platform);
    const candidate = recordExecPath(record, p);
    if (installRoot === null || candidate === null) return answer(LAUNCHER_SENTENCE, 2);
    const realExecPath = await deps.realpath(candidate);
    const check = {
      record,
      realExecPath,
      realInstallRoot: await deps.realpath(installRoot),
      isFile: realExecPath === null ? false : await deps.isFile(realExecPath)
    };
    const runtime = validateRuntime(check, p, deps.platform);
    if (!runtime.ok) return answer(LAUNCHER_SENTENCE, 2);
    if (!await deps.isFile(deps.cliPath)) return answer(CLI_MISSING_SENTENCE, 2);
    if (signal?.aborted) return answer(STOPPED_SENTENCE, 2);
    const outcome = await runChild(deps, runtime.execPath, buildChildArgs(deps.cliPath, parsed), childEnv(deps.env, deps.platform), signal);
    return toolResult(outcome);
  } catch (error) {
    return answer(`Design Chamber could not start its check (${errorCode(error)}).`, 2);
  }
};
var createDesignCheckTool = (deps) => ({
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  // Seen directly in the tool list: an agent finishing a design should not have to search for it (§U3.3).
  options: { codemode: false },
  input: TOOL_INPUT,
  async execute(input, context) {
    let built;
    try {
      built = deps();
    } catch (error) {
      return answer(`Design Chamber could not start its check (${errorCode(error)}).`, 2);
    }
    return runDesignCheck(input, context?.signal, built);
  }
});

// src/plugin/index.ts
var builtin = (id) => {
  const get = process.getBuiltinModule;
  const module = typeof get === "function" ? get(id) : void 0;
  if (module === void 0 || module === null) throw Object.assign(new Error(`${id} is not available`), { code: "NO_BUILTIN" });
  return module;
};
var nodeDeps = () => {
  const fs = builtin("node:fs");
  const path = builtin("node:path");
  const os = builtin("node:os");
  const url = builtin("node:url");
  const childProcess = builtin("node:child_process");
  return {
    platform: process.platform,
    path,
    env: process.env,
    homeDir: os.homedir(),
    opencodeExecPath: process.execPath,
    // Ships in the same package as this file, so the CLI and the plugin are always one version.
    cliPath: url.fileURLToPath(new URL("../cli/dc.mjs", import.meta.url)),
    async readText(file, maxBytes) {
      let handle;
      try {
        handle = await fs.promises.open(file, "r");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      try {
        const buffer = new Uint8Array(maxBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
        return bytesRead > maxBytes ? "" : new TextDecoder().decode(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    },
    realpath: (file) => fs.promises.realpath(file).catch(() => null),
    isFile: (file) => fs.promises.stat(file).then((info) => info.isFile(), () => false),
    // A Node ChildProcess has every member SpawnedChild names; the cast narrows it to them.
    spawn: (command, args, options) => childProcess.spawn(command, [...args], options)
  };
};
var index_default = {
  id: "design-chamber",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add(createDesignCheckTool(nodeDeps));
    });
  }
};
export {
  index_default as default
};
