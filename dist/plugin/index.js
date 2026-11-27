// src/shared/limits.ts
var SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
var SCREEN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
var PROJECT_DIRECTORY_MAX = 4096;
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
var USER_UNDO_TTL_MS = 30 * 6e4;
var SYSTEM_ID_PATTERN = SLUG_PATTERN;
var SYSTEM_ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
var SYSTEM_BYTES_MAX = 100 * 1024 * 1024;
var SYSTEM_FONT_MAX_BYTES = 5 * 1024 * 1024;
var SYSTEM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
var SYSTEM_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
var SCAN_TTL_MS = 10 * 6e4;
var FOLDER_UNDO_MS = 60 * 6e4;
var SYSTEM_BUILD_TTL_MS = 7 * 864e5;
var LIVING_PAGE_MAX_BYTES = 20 * 1024 * 1024;
var LIVING_PAGE_ASSET_MAX_BYTES = 4 * 1024 * 1024;
var SCAN_JSON_MAX_BYTES = 2 * 1024 * 1024;
var FILE_PAGE_COPY_MAX_BYTES = 50 * 1024 * 1024;

// src/shared/app-data.ts
var RUNTIME_FILE = "runtime.json";
var given = (value) => typeof value === "string" && value.trim() !== "";
var designChamberDataDir = ({ platform, homeDir, appData, xdgConfigHome, join }) => {
  if (platform === "win32") return join(given(appData) ? appData : join(homeDir, "AppData", "Roaming"), "Design Chamber");
  if (platform === "darwin") return join(homeDir, "Library", "Application Support", "Design Chamber");
  return join(given(xdgConfigHome) ? xdgConfigHome : join(homeDir, ".config"), "design-chamber");
};

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

// src/plugin/run-cli.ts
var RECORD_TEXT_MAX_BYTES = 16 * 1024;
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
var runChild = (deps, execPath, args, env, signal, timeoutMs = CHECK_TOOL_TIMEOUT_MS) => new Promise((resolve) => {
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
  }, deps.timeoutMs ?? timeoutMs);
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
var parseRecord = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
var resolveRuntime = async (deps) => {
  const p = deps.path;
  let text;
  try {
    text = await deps.readText(runtimeRecordFile(deps.env, deps.platform, deps.homeDir, p), RECORD_TEXT_MAX_BYTES);
  } catch {
    return { ok: false, reason: "launcher" };
  }
  if (text === null) return { ok: false, reason: "setup" };
  const record = parseRecord(text);
  const opencode = await deps.realpath(deps.opencodeExecPath) ?? deps.opencodeExecPath;
  const installRoot = installRootOf(opencode, p, deps.platform);
  const candidate = recordExecPath(record, p);
  if (installRoot === null || candidate === null) return { ok: false, reason: "launcher" };
  const realExecPath = await deps.realpath(candidate);
  const check = {
    record,
    realExecPath,
    realInstallRoot: await deps.realpath(installRoot),
    isFile: realExecPath === null ? false : await deps.isFile(realExecPath)
  };
  const runtime = validateRuntime(check, p, deps.platform);
  if (!runtime.ok) return { ok: false, reason: "launcher" };
  if (!await deps.isFile(deps.cliPath)) return { ok: false, reason: "cli-missing" };
  return { ok: true, execPath: runtime.execPath };
};

// src/plugin/check-tool.ts
var TOOL_NAME = "design_check";
var NOT_A_DESIGN_SENTENCE = "That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.";
var NOT_SCREENS_SENTENCE = "Those are not screen ids. Use the ids listed in the design.json screens, such as home or pricing.";
var TOO_MANY_SCREENS_SENTENCE = `Check at most ${CHECK_TOOL_SCREENS_MAX} screens at a time, or leave screens out to check them all.`;
var NOT_STATIC_SENTENCE = "static takes true or false.";
var NOT_A_SYSTEM_SENTENCE = "That is not a design system id. Use the name of a folder in the Designs folder's _systems folder, such as acme.";
var BOTH_SENTENCE = "Check a design or a design system, not both: give design or system.";
var NOT_SYSTEM_SCREENS_SENTENCE = "Those are not screen ids. Use the ids listed in the design system's system.json screens, such as home.";
var SYSTEM_SCREENS_AREA_SENTENCE = "screens can't be combined with area: screens checks only those screens and skips the board.";
var SYSTEM_SCREENS_STATIC_SENTENCE = "screens draws screens; leave out static, or leave out screens to check the files only.";
var NOT_AREA_SENTENCE = "area takes foundations, components, patterns or brand.";
var NOT_SCHEME_SENTENCE = "scheme takes light, dark or both.";
var DESIGN_AREA_SENTENCE = "area and scheme are for a design system: give system instead of design.";
var SETUP_SENTENCE = "Design Chamber hasn't set up its check tool yet. Open the Design Chamber panel once, then try again.";
var LAUNCHER_SENTENCE = "The design_check tool can't run in this setup. Run the check command from the AGENTS.md file in the Designs folder instead.";
var CLI_MISSING_SENTENCE = "Design Chamber's check program is missing from its extension folder. Reinstall Design Chamber, then try again.";
var STOPPED_SENTENCE = "The check was stopped before it finished, so no report was saved.";
var TIMEOUT_SENTENCE = 'The check took longer than 3 minutes and was stopped. Try one screen with screens: ["<id>"].';
var SYSTEM_TIMEOUT_SENTENCE = 'The check took longer than 3 minutes and was stopped. Check one area with area, or some screens with screens: ["<id>"], or the files only with static: true.';
var COULD_NOT_RUN = "The check could not run: ";
var TOOL_DESCRIPTION = "Check a design or a design system in the Designs folder before you say it is done: renders every screen at its sizes offline, saves PNGs to look at, and lists what to fix.";
var TOOL_INPUT = {
  type: "object",
  additionalProperties: true,
  // One of design or system (Phase 2.5 §10.2); parseToolInput enforces it.
  properties: {
    design: { type: "string", description: "The design folder name, such as pricing-page" },
    system: { type: "string", description: "Instead of design: a design system id, such as acme. Draws its board at two widths, then its screens at their viewports, and saves PNGs to look at, dark too when it has dark values" },
    area: { type: "string", enum: ["foundations", "components", "patterns", "brand"], description: "Design systems only: picture and measure just this area (the file checks still cover all of it)" },
    scheme: { type: "string", enum: ["light", "dark", "both"], description: "Design systems only: which schemes to draw (default both when it has dark values)" },
    screens: { type: "array", items: { type: "string" }, description: "Check just these screen ids: a canvas design's, or a design system's (then its board is skipped; not with area)" },
    static: { type: "boolean", description: "Check the files only, without a browser (designs and systems)" }
  }
};
var answer = (content, exit) => ({ content, metadata: { designChamber: { exit } } });
var AREAS = ["foundations", "components", "patterns", "brand"];
var SCHEMES = ["light", "dark", "both"];
var closedValue = (value, options) => {
  if (value === void 0 || value === null) return void 0;
  return typeof value === "string" && options.includes(value) ? value : false;
};
var staticValue = (value) => {
  if (value === void 0 || value === null) return false;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "false") return value === "true";
  return null;
};
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
  if (value.system !== void 0 && value.system !== null) {
    if (value.design !== void 0 && value.design !== null) return { ok: false, message: BOTH_SENTENCE };
    if (typeof value.system !== "string" || !SYSTEM_ID_PATTERN.test(value.system) || value.system === "none" || value.system === "ask") return { ok: false, message: NOT_A_SYSTEM_SENTENCE };
    const listed = screenList(value.screens);
    if (listed === null || !listed.every((screen) => typeof screen === "string" && SYSTEM_ENTRY_ID_PATTERN.test(screen))) {
      return { ok: false, message: NOT_SYSTEM_SCREENS_SENTENCE };
    }
    const screens2 = [...new Set(listed)];
    if (screens2.length > CHECK_TOOL_SCREENS_MAX) return { ok: false, message: TOO_MANY_SCREENS_SENTENCE };
    const systemStatic = staticValue(value.static);
    if (systemStatic === null) return { ok: false, message: NOT_STATIC_SENTENCE };
    const area = closedValue(value.area, AREAS);
    if (area === false) return { ok: false, message: NOT_AREA_SENTENCE };
    const scheme = closedValue(value.scheme, SCHEMES);
    if (scheme === false) return { ok: false, message: NOT_SCHEME_SENTENCE };
    if (screens2.length > 0 && area !== void 0) return { ok: false, message: SYSTEM_SCREENS_AREA_SENTENCE };
    if (screens2.length > 0 && systemStatic) return { ok: false, message: SYSTEM_SCREENS_STATIC_SENTENCE };
    return {
      ok: true,
      system: value.system,
      static: systemStatic,
      ...area !== void 0 ? { area } : {},
      ...scheme !== void 0 ? { scheme } : {},
      ...screens2.length > 0 ? { screens: screens2 } : {}
    };
  }
  if (value.area !== void 0 && value.area !== null || value.scheme !== void 0 && value.scheme !== null) return { ok: false, message: DESIGN_AREA_SENTENCE };
  if (typeof value.design !== "string" || !SLUG_PATTERN.test(value.design)) return { ok: false, message: NOT_A_DESIGN_SENTENCE };
  const list = screenList(value.screens);
  if (list === null || !list.every((screen) => typeof screen === "string" && SCREEN_ID_PATTERN.test(screen))) {
    return { ok: false, message: NOT_SCREENS_SENTENCE };
  }
  const screens = [...new Set(list)];
  if (screens.length > CHECK_TOOL_SCREENS_MAX) return { ok: false, message: TOO_MANY_SCREENS_SENTENCE };
  const staticOnly = staticValue(value.static);
  if (staticOnly === null) return { ok: false, message: NOT_STATIC_SENTENCE };
  return { ok: true, design: value.design, screens, static: staticOnly };
};
var buildChildArgs = (cliPath, input) => "system" in input ? [
  cliPath,
  "check",
  "--system",
  input.system,
  ...input.area !== void 0 ? ["--area", input.area] : [],
  ...input.scheme !== void 0 ? ["--scheme", input.scheme] : [],
  ...(input.screens ?? []).flatMap((screen) => ["--screen", screen]),
  ...input.static ? ["--static"] : []
] : [cliPath, "check", input.design, ...input.screens.flatMap((screen) => ["--screen", screen]), ...input.static ? ["--static"] : []];
var toolResult = (outcome, system = false) => {
  if (outcome.kind === "timeout") return answer(system ? SYSTEM_TIMEOUT_SENTENCE : TIMEOUT_SENTENCE, 2);
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
var runDesignCheck = async (input, signal, deps) => {
  try {
    const parsed = parseToolInput(input);
    if (!parsed.ok) return answer(parsed.message, 2);
    const runtime = await resolveRuntime(deps);
    if (!runtime.ok) return answer(runtime.reason === "setup" ? SETUP_SENTENCE : runtime.reason === "cli-missing" ? CLI_MISSING_SENTENCE : LAUNCHER_SENTENCE, 2);
    if (signal?.aborted) return answer(STOPPED_SENTENCE, 2);
    const outcome = await runChild(deps, runtime.execPath, buildChildArgs(deps.cliPath, parsed), childEnv(deps.env, deps.platform), signal);
    return toolResult(outcome, "system" in parsed);
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

// src/shared/agent/context.ts
var VIEWPORT_TABLET = Object.freeze({ id: "tablet", label: "Tablet", width: 768, height: 1024 });
var VIEWPORT_DESKTOP = Object.freeze({ id: "desktop", label: "Desktop", width: 1440, height: 900 });

// src/shared/agent/read-text.ts
var LIST_TEXT_MAX = 100;
var NOT_A_TEXT = `--text needs 1 to ${LIST_TEXT_MAX} characters on one line.`;

// src/plugin/read-tools.ts
var LIST_TOOL_NAME = "design_list";
var READ_TOOL_NAME = "design_read";
var READ_TOOL_TIMEOUT_MS = 2e4;
var LIST_TOOL_DESCRIPTION = "List the designs and design systems in the user's Designs folder, newest first, and say which one the user has open now.";
var READ_TOOL_DESCRIPTION = "Read one design's state: the user's open pins with the element each points at, what the user has open, hand edits waiting, the system it uses and the last check.";
var LIST_TOOL_INPUT = {
  type: "object",
  additionalProperties: true,
  properties: {
    project: { type: "string", description: "Only designs made for this project folder (its full path)" },
    kind: { type: "string", enum: ["page", "canvas"], description: "Only pages or only canvases" },
    text: { type: "string", description: "Only designs whose folder name or title contains this" }
  }
};
var READ_TOOL_INPUT = {
  type: "object",
  additionalProperties: true,
  properties: {
    design: { type: "string", description: "The design folder name, such as pricing-page" }
  },
  required: ["design"]
};
var NOT_A_DESIGN_SENTENCE2 = "That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.";
var NOT_A_PROJECT_SENTENCE = "project must be the full path of a project folder, such as /home/you/code/shop.";
var NOT_A_KIND_SENTENCE = "kind takes page or canvas.";
var NOT_A_TEXT_SENTENCE = `text must be 1 to ${LIST_TEXT_MAX} characters on one line.`;
var NOT_AN_OBJECT_SENTENCE = 'Give the tool its input as an object, such as { "project": "/home/you/code/shop" }, or no input at all.';
var SETUP_SENTENCE2 = "Design Chamber hasn't set up its tools yet. Open the Design Chamber panel once, then try again.";
var launcherSentence = (name, command) => `The ${name} tool can't run in this setup. Run ${command} with the launcher named in the AGENTS.md file in the Designs folder instead.`;
var CLI_MISSING_SENTENCE2 = "Design Chamber's program is missing from its extension folder. Reinstall Design Chamber, then try again.";
var STOPPED_SENTENCE2 = "The read was stopped before it finished.";
var TIMEOUT_SENTENCE2 = "Reading the Designs folder took longer than 20 seconds and was stopped. Try again, or narrow the list with project, kind or text.";
var COULD_NOT_READ = "Design Chamber couldn't read the Designs folder: ";
var CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
var answer2 = (content, exit) => ({ content, metadata: { designChamber: { exit } } });
var given2 = (value) => value !== void 0 && value !== null && value !== "";
var parseListInput = (input, isAbsolute) => {
  if (input === void 0 || input === null) return { ok: true, project: null, kind: null, text: null };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, message: NOT_AN_OBJECT_SENTENCE };
  const value = input;
  let project = null;
  if (given2(value.project)) {
    if (typeof value.project !== "string" || value.project.length > PROJECT_DIRECTORY_MAX || CONTROL.test(value.project) || !isAbsolute(value.project)) {
      return { ok: false, message: NOT_A_PROJECT_SENTENCE };
    }
    project = value.project;
  }
  let kind = null;
  if (given2(value.kind)) {
    if (value.kind !== "page" && value.kind !== "canvas") return { ok: false, message: NOT_A_KIND_SENTENCE };
    kind = value.kind;
  }
  let text = null;
  if (given2(value.text)) {
    if (typeof value.text !== "string" || value.text.trim() === "" || value.text.length > LIST_TEXT_MAX || CONTROL.test(value.text)) return { ok: false, message: NOT_A_TEXT_SENTENCE };
    text = value.text;
  }
  return { ok: true, project, kind, text };
};
var parseReadInput = (input) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, message: NOT_A_DESIGN_SENTENCE2 };
  const design = input.design;
  if (typeof design !== "string" || !SLUG_PATTERN.test(design)) return { ok: false, message: NOT_A_DESIGN_SENTENCE2 };
  return { ok: true, design };
};
var buildListArgs = (cliPath, input) => [
  cliPath,
  "list",
  ...input.project === null ? [] : [`--project=${input.project}`],
  ...input.kind === null ? [] : [`--kind=${input.kind}`],
  ...input.text === null ? [] : [`--text=${input.text}`]
];
var buildReadArgs = (cliPath, design) => [cliPath, "read", design];
var readToolResult = (outcome) => {
  if (outcome.kind === "timeout") return answer2(TIMEOUT_SENTENCE2, 2);
  if (outcome.kind === "spawn-error") return answer2(`Design Chamber could not start its program (${outcome.code}).`, 2);
  if (outcome.code === 0) {
    const note = outcome.stdoutCut ? `
(The rest of the answer was cut at ${Math.round(CHECK_TOOL_STDOUT_MAX_BYTES / 1048576)} MB.)
` : "";
    return answer2(`${outcome.stdout}${note}`, 0);
  }
  if (outcome.code === null) return answer2(STOPPED_SENTENCE2, 2);
  const sentence = outcome.stderr.trim().slice(0, CHECK_TOOL_ERROR_TEXT_MAX);
  return answer2(sentence === "" ? `${COULD_NOT_READ}it stopped with exit code ${outcome.code}.` : sentence, 2);
};
var runRead = async (run, signal, deps) => {
  const runtime = await resolveRuntime(deps);
  if (!runtime.ok) return answer2(runtime.reason === "setup" ? SETUP_SENTENCE2 : runtime.reason === "cli-missing" ? CLI_MISSING_SENTENCE2 : launcherSentence(run.name, run.command), 2);
  if (signal?.aborted) return answer2(STOPPED_SENTENCE2, 2);
  const outcome = await runChild(deps, runtime.execPath, run.args(deps.cliPath), childEnv(deps.env, deps.platform), signal, READ_TOOL_TIMEOUT_MS);
  return readToolResult(outcome);
};
var runDesignList = async (input, signal, deps) => {
  try {
    const parsed = parseListInput(input, deps.path.isAbsolute);
    if (!parsed.ok) return answer2(parsed.message, 2);
    return await runRead({ name: LIST_TOOL_NAME, command: "dc list", args: (cli) => buildListArgs(cli, parsed) }, signal, deps);
  } catch (error) {
    return answer2(`Design Chamber could not start its program (${errorCode(error)}).`, 2);
  }
};
var runDesignRead = async (input, signal, deps) => {
  try {
    const parsed = parseReadInput(input);
    if (!parsed.ok) return answer2(parsed.message, 2);
    return await runRead({ name: READ_TOOL_NAME, command: `dc read ${parsed.design}`, args: (cli) => buildReadArgs(cli, parsed.design) }, signal, deps);
  } catch (error) {
    return answer2(`Design Chamber could not start its program (${errorCode(error)}).`, 2);
  }
};
var tool = (name, description, input, run, deps) => ({
  name,
  description,
  // Seen directly in the tool list, as design_check is.
  options: { codemode: false },
  input,
  async execute(value, context) {
    let built;
    try {
      built = deps();
    } catch (error) {
      return answer2(`Design Chamber could not start its program (${errorCode(error)}).`, 2);
    }
    return run(value, context?.signal, built);
  }
});
var createDesignListTool = (deps) => tool(LIST_TOOL_NAME, LIST_TOOL_DESCRIPTION, LIST_TOOL_INPUT, runDesignList, deps);
var createDesignReadTool = (deps) => tool(READ_TOOL_NAME, READ_TOOL_DESCRIPTION, READ_TOOL_INPUT, runDesignRead, deps);

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
      tools.add(createDesignListTool(nodeDeps));
      tools.add(createDesignReadTool(nodeDeps));
    });
  }
};
export {
  index_default as default
};
