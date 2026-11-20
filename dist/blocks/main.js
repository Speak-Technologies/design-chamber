"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // <define:__DC_SYSTEM_QUESTIONS__>
  var define_DC_SYSTEM_QUESTIONS_default = { roundOne: [{ topic: "home", label: "Where should the design system live?", multiple: false, options: [{ choice: "repo", label: "Repo + living page", why: "The system and its living page ship with your repo, next to the code.", recommended: true }, { choice: "internal", label: "In Design Chamber", why: "Stays in the Designs folder. No page in the repo.", recommended: false }] }, { topic: "mode", label: "Should building it also fix the code, or only describe what should be?", multiple: false, options: [{ choice: "fix", label: "Fix tokens, then document", why: "I change the token definitions in your code after you approve a diff.", recommended: true }, { choice: "describe", label: "Describe only, never change the app's code", why: "The system documents the target and your code keeps its values. New system files are still created after you approve a diff.", recommended: false }] }, { topic: "coverage", label: "Which parts should it cover?", multiple: true, options: [{ choice: "foundations", label: "Foundations", why: "Colour, type, space, radius, shadows, layers and sizes.", recommended: true }, { choice: "components", label: "Components", why: "The components the code has, with when to use them.", recommended: true }, { choice: "patterns", label: "Patterns & voice", why: "Layout patterns and how the product speaks.", recommended: true }, { choice: "brand", label: "Brand & marketing", why: "Logos, brand guidance and marketing surfaces.", recommended: true }] }, { topic: "dark", label: "Dark mode as part of this?", multiple: false, options: [{ choice: "not-now", label: "Not now", why: "Light values only. Dark can be added later.", recommended: true }, { choice: "include", label: "Include dark values", why: "I derive a dark value for every colour, and round two asks how.", recommended: false }] }], roundTwo: [{ topic: "status-colours", label: "Status colours", multiple: false, options: [{ choice: "brand-tuned", label: "Brand-tuned set", why: "One warning, one danger, one success, tuned to your brand. The proposed values are shown with this call.", recommended: true }, { choice: "stock", label: "Keep the stock set", why: "The code keeps its current status colours. The system records them as they are.", recommended: false }, { choice: "custom", label: "Custom", why: "Say what you want in the note.", recommended: false }] }, { topic: "greys", label: "Greys", multiple: false, options: [{ choice: "brand-tinted", label: "Brand-tinted greys", why: "The neutral ramp leans a few degrees toward the brand hue.", recommended: true }, { choice: "neutral", label: "Keep neutral grey", why: "The current greys stay; only the colours change.", recommended: false }] }, { topic: "access", label: "Who can open the living page", multiple: false, options: [{ choice: "dev", label: "Dev builds only", why: "The page ships in the repo and is not published.", recommended: true }, { choice: "public", label: "Public", why: "GitHub Pages or a similar host. Fonts fall back unless you turn on Embed fonts.", recommended: false }] }, { topic: "typography", label: "Typography", multiple: false, options: [{ choice: "one-font", label: "One font only", why: "The same font everywhere, including marketing headings.", recommended: true }, { choice: "display", label: "Add a display font", why: "A second face for marketing headings. Specimens fall back where the face is missing.", recommended: false }] }, { topic: "dark-values", label: "Dark values", multiple: false, options: [{ choice: "derive", label: "Derive dark values from the light ones", why: "A dark value for every colour, computed from the light set. Consistent, and quick to review.", recommended: true }, { choice: "hand-tune", label: "Hand-tune them with me", why: "We go through the dark values together, one group at a time.", recommended: false }] }], closing: "Reply with changes, or say go to accept the defaults." };

  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

  // node_modules/@openchamber/sdk/dist/scrollbar-style.js
  var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
  var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
  function installGuestScrollbarActivity(doc) {
    const root2 = doc.documentElement;
    if (root2.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root2.setAttribute("data-oc-scrollbar-activity", "");
    const timers = /* @__PURE__ */ new WeakMap();
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root2 : event.target;
      if (!(target instanceof Element))
        return;
      if (!target.hasAttribute("data-oc-scrolling"))
        target.setAttribute("data-oc-scrolling", "");
      const pending = timers.get(target);
      if (pending !== void 0)
        clearTimeout(pending);
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        target.removeAttribute("data-oc-scrolling");
      }, 1e3));
    }, { capture: true, passive: true });
  }
  var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // node_modules/@openchamber/sdk/dist/shells.js
  var GUEST_SHELL_ID_MAX = 128;
  var GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

  // node_modules/@openchamber/sdk/dist/status-controls.js
  var GUEST_STATUS_CONTROLS_MAX = 4;
  var GUEST_STATUS_CONTROL_ID = /^[a-z][a-z0-9-]{0,39}$/;
  var GUEST_STATUS_CONTROL_LABEL_MAX = 60;
  var GUEST_STATUS_CONTROL_OPTIONS_MAX = 16;
  var GUEST_STATUS_CONTROL_VALUE_MAX = 80;
  var isControlObject = (value) => Object(value) === value && !Array.isArray(value);
  var hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
  var isLabel = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_LABEL_MAX;
  var isValue = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_VALUE_MAX;
  var isGuestStatusControls = (controls) => {
    if (!Array.isArray(controls) || controls.length > GUEST_STATUS_CONTROLS_MAX)
      return false;
    const ids = /* @__PURE__ */ new Set();
    for (const control of controls) {
      if (!isControlObject(control) || !GUEST_STATUS_CONTROL_ID.test(control.id) || !isLabel(control.label))
        return false;
      if (control.disabled !== void 0 && control.disabled !== true && control.disabled !== false)
        return false;
      if (ids.has(control.id))
        return false;
      ids.add(control.id);
      if (control.kind === "button") {
        if (!hasOnlyKeys(control, ["kind", "id", "label", "disabled"]))
          return false;
        continue;
      }
      if (control.kind !== "select" || !hasOnlyKeys(control, ["kind", "id", "label", "value", "options", "disabled"]))
        return false;
      if (!isValue(control.value) || !Array.isArray(control.options) || control.options.length < 1 || control.options.length > GUEST_STATUS_CONTROL_OPTIONS_MAX)
        return false;
      const values = /* @__PURE__ */ new Set();
      for (const option of control.options) {
        if (!isControlObject(option) || !hasOnlyKeys(option, ["value", "label"]) || !isValue(option.value) || !isLabel(option.label) || values.has(option.value))
          return false;
        values.add(option.value);
      }
      if (!values.has(control.value))
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/manifest.js
  var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
  var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
  var GUEST_BLOCK_ARGS_TEXT_MAX = 16e3;
  var GUEST_BLOCK_HEIGHT_MAX = 960;

  // node_modules/@openchamber/sdk/dist/session-events.js
  var GUEST_SESSION_EVENT_TYPES = [
    "turn-finished",
    "turn-failed",
    "permission-asked",
    "question-asked",
    "turn-started",
    "session-created",
    "session-archived",
    "session-deleted"
  ];
  var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
  var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);

  // node_modules/@openchamber/sdk/dist/service-host.js
  var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
  var MENTIONS_IDLE_MS = 10 * 6e4;

  // node_modules/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 2e7;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var fileEditorPayloadSize = (value) => "bytes" in value ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/popover.js
  var GUEST_POPOVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var GUEST_POPOVER_COORDINATE_MAX = 1e5;
  var GUEST_POPOVER_WIDTH_MIN = 160;
  var GUEST_POPOVER_WIDTH_MAX = 640;
  var GUEST_POPOVER_HEIGHT_MIN = 48;
  var GUEST_POPOVER_HEIGHT_MAX = 480;
  var GUEST_POPOVER_DATA_MAX = 16e3;
  var GUEST_POPOVER_DATA_DEPTH_MAX = 32;
  var GUEST_POPOVER_SIDES = ["left", "right", "top", "bottom"];
  var hasBoundedJsonTree = (value, depth = 0, budget = { remaining: GUEST_POPOVER_DATA_MAX }) => {
    if (--budget.remaining < 0 || depth >= GUEST_POPOVER_DATA_DEPTH_MAX)
      return false;
    if (value === null)
      return true;
    const children = Array.isArray(value) ? value : Object(value) === value ? Object.values(value) : [];
    for (const item of children) {
      if (!hasBoundedJsonTree(item, depth + 1, budget))
        return false;
    }
    return true;
  };
  var isFiniteJson = (value) => {
    if (value === null || value === true || value === false)
      return true;
    if (Array.isArray(value))
      return Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && value.every(isFiniteJson);
    if (Object(value) === value) {
      const prototype = Object.getPrototypeOf(value);
      return (prototype === null || prototype === Object.prototype) && Object.values(value).every(isFiniteJson);
    }
    return String(value) === value || Number.isFinite(value);
  };
  var isGuestPopoverRequest = (request) => {
    try {
      if (String(request.id) !== request.id || !GUEST_POPOVER_ID.test(request.id) || !Number.isFinite(request.anchor.x) || Math.abs(request.anchor.x) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.y) || Math.abs(request.anchor.y) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.width) || !Number.isFinite(request.anchor.height) || request.anchor.width <= 0 || request.anchor.height <= 0 || request.anchor.width > GUEST_POPOVER_COORDINATE_MAX || request.anchor.height > GUEST_POPOVER_COORDINATE_MAX || !Number.isInteger(request.width) || request.width < GUEST_POPOVER_WIDTH_MIN || request.width > GUEST_POPOVER_WIDTH_MAX || !Number.isInteger(request.height) || request.height < GUEST_POPOVER_HEIGHT_MIN || request.height > GUEST_POPOVER_HEIGHT_MAX || request.side !== void 0 && !GUEST_POPOVER_SIDES.includes(request.side) || request.focus !== void 0 && request.focus !== true && request.focus !== false || !hasBoundedJsonTree(request.data) || !isFiniteJson(request.data))
        return false;
      return JSON.stringify(request.data).length <= GUEST_POPOVER_DATA_MAX;
    } catch {
      return false;
    }
  };

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_BLOCK_ANSWER_MAX = 2e3;
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 96e4;
  var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "REQUEST_FAILED",
    "RESPONSE_TOO_LARGE",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED",
    "UNSUPPORTED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "shells",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "service-event",
    "status-control-event",
    "popover-closed",
    "file-open",
    "file-snapshot",
    "file-saved",
    "generate-late"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => "key" in event && "metaKey" in event && "ctrlKey" in event;
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  var HostRequestError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code");
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var deviceStorageScope = (options) => {
    if (options === void 0)
      return void 0;
    if (Object(options) !== options || Array.isArray(options) || options.scope !== void 0 && options.scope !== "instance" && options.scope !== "device") {
      throw new HostRequestError("HOST_REJECTED", 'Storage scope must be "instance" or "device".');
    }
    return options.scope === "device" ? "device" : void 0;
  };
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    const blockListeners = /* @__PURE__ */ new Set();
    const serviceEventListeners = /* @__PURE__ */ new Set();
    const statusControlListeners = /* @__PURE__ */ new Set();
    const popoverClosedListeners = /* @__PURE__ */ new Set();
    const lateGenerateListeners = /* @__PURE__ */ new Set();
    const unclaimedLateGenerate = [];
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = /* @__PURE__ */ new Set();
    const fileSavedListeners = /* @__PURE__ */ new Set();
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    const shellsListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    let popoverPointerActive = false;
    let popoverFocusActive = false;
    let popoverActivityReported = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const listenForLateGenerate = () => {
      if (disposed || target.parent === target || lateGenerateListeners.size === 0 || lastReady?.features?.lateGenerateResults !== true)
        return;
      post({ channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION, type: "generate-late-listen" });
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "shells") {
        const listener = shellsListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        if (message.payload.block)
          emit(blockListeners, message.payload.block);
        listenForLateGenerate();
        return;
      }
      if (message.type === "service-event") {
        emit(serviceEventListeners, message.payload);
        return;
      }
      if (message.type === "generate-late") {
        if (lateGenerateListeners.size === 0)
          unclaimedLateGenerate.push(message.payload);
        else
          emit(lateGenerateListeners, message.payload);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "status-control-event") {
        emit(statusControlListeners, message.payload);
        return;
      }
      if (message.type === "popover-closed") {
        emit(popoverClosedListeners, message.payload);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text) => answer({ error: (text.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const onPopoverEscape = (event) => {
      if (!isKeyEvent(event) || event.key !== "Escape" || lastReady?.surface !== "popover" || !lastReady.popover)
        return;
      event.preventDefault();
      void closePopover(lastReady.popover.id, "escape").catch(() => void 0);
    };
    const reportPopoverActivity = () => {
      const popover = lastReady?.surface === "popover" ? lastReady.popover : void 0;
      if (!popover)
        return;
      const active2 = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active2)
        return;
      popoverActivityReported = active2;
      void setPopoverAnchorActive(popover.id, active2).catch(() => void 0);
    };
    const onPopoverPointerOver = () => {
      if (lastReady?.surface !== "popover" || popoverPointerActive)
        return;
      popoverPointerActive = true;
      reportPopoverActivity();
    };
    const onPopoverPointerOut = (event) => {
      if (lastReady?.surface !== "popover" || event.relatedTarget !== null || !popoverPointerActive)
        return;
      popoverPointerActive = false;
      reportPopoverActivity();
    };
    const onPopoverFocus = () => {
      if (lastReady?.surface !== "popover" || popoverFocusActive)
        return;
      popoverFocusActive = true;
      reportPopoverActivity();
    };
    const onPopoverBlur = () => {
      if (lastReady?.surface !== "popover" || !popoverFocusActive)
        return;
      popoverFocusActive = false;
      reportPopoverActivity();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const subscribeShells = async (scope, listener) => {
      if (scope.kind === "session")
        requireIdentity(scope.sessionId);
      if (scope.kind === "project")
        requireIdentity(scope.projectId);
      const subscriptionId = nextId(ids);
      shellsListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "shells-subscribe", id: nextId(ids), payload: { subscriptionId, scope } });
      } catch (error) {
        shellsListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!shellsListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      if (payload.scope === "device" && lastReady?.features?.deviceStorage !== true) {
        throw new HostRequestError("UNSUPPORTED", "This host does not support device storage.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    const closePopover = (id, reason) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-close", id: nextId(ids), payload: reason ? { id, reason } : { id } });
    const setPopoverAnchorActive = (id, active2) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active: active2 } });
    target.addEventListener("keydown", onPopoverEscape, true);
    target.addEventListener("pointerover", onPopoverPointerOver);
    target.addEventListener("pointermove", onPopoverPointerOver);
    target.addEventListener("pointerout", onPopoverPointerOut);
    target.addEventListener("focus", onPopoverFocus);
    target.addEventListener("blur", onPopoverBlur);
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      onRunningShells: (scope, listener) => subscribeShells(scope, listener),
      readShellOutput: async (shellId, options2) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const cursor = options2?.cursor;
        if (cursor !== void 0 && (!Number.isInteger(cursor) || cursor < 0)) {
          throw new HostRequestError("HOST_REJECTED", "Shell output cursor must be a non-negative integer.");
        }
        const tailBytes = options2?.tailBytes;
        if (tailBytes !== void 0 && (!Number.isInteger(tailBytes) || tailBytes < 1 || tailBytes > GUEST_SHELL_OUTPUT_TAIL_MAX)) {
          throw new HostRequestError("HOST_REJECTED", `Shell output tailBytes must be an integer between 1 and ${GUEST_SHELL_OUTPUT_TAIL_MAX}.`);
        }
        const result = await send({ ...envelope, type: "shell-output", id: nextId(ids), payload: { shellId, cursor, tailBytes } });
        const output = result;
        if (!output || typeof output.output !== "string" || !Number.isFinite(output.cursor)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return shell output.");
        }
        return output;
      },
      stopShell: async (shellId) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const result = await send({ ...envelope, type: "shell-stop", id: nextId(ids), payload: { shellId } });
        if (result?.stopped !== true)
          throw new HostRequestError("HOST_REJECTED", "Host did not stop the shell.");
        return { stopped: true };
      },
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "get", key };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "set", key, value };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        delete: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "delete", key };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        keys: async (options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "keys" };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onBlock: (listener) => {
        blockListeners.add(listener);
        if (lastReady?.block)
          listener(lastReady.block);
        return () => {
          blockListeners.delete(listener);
        };
      },
      onServiceEvent: (listener) => {
        serviceEventListeners.add(listener);
        return () => {
          serviceEventListeners.delete(listener);
        };
      },
      onStatusControl: (listener) => {
        statusControlListeners.add(listener);
        return () => {
          statusControlListeners.delete(listener);
        };
      },
      onPopoverClosed: (listener) => {
        popoverClosedListeners.add(listener);
        return () => {
          popoverClosedListeners.delete(listener);
        };
      },
      setStatusControls: (controls) => {
        if (lastReady?.features?.statusControls !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support status controls."));
        }
        if (!isGuestStatusControls(controls)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Status controls must have unique bounded ids and valid selected options."));
        }
        return request({ ...envelope, type: "status-controls", id: nextId(ids), payload: { controls } });
      },
      openPopover: (payload) => {
        if (lastReady?.features?.popovers !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers."));
        }
        if (!isGuestPopoverRequest(payload)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Popover requests need bounded geometry and JSON data."));
        }
        return request({ ...envelope, type: "popover-open", id: nextId(ids), payload });
      },
      closePopover,
      setPopoverAnchorActive,
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      answerBlock: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "block-answer",
        id: nextId(ids),
        payload: { text: text.trim().slice(0, GUEST_BLOCK_ANSWER_MAX) }
      }),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      onLateGenerateResult: (listener) => {
        lateGenerateListeners.add(listener);
        for (const result of unclaimedLateGenerate.splice(0))
          emit([listener], result);
        listenForLateGenerate();
        return () => {
          lateGenerateListeners.delete(listener);
        };
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        for (const subscriptionId of shellsListeners.keys()) {
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        shellsListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("keydown", onPopoverEscape, true);
        target.removeEventListener("pointerover", onPopoverPointerOver);
        target.removeEventListener("pointermove", onPopoverPointerOver);
        target.removeEventListener("pointerout", onPopoverPointerOut);
        target.removeEventListener("focus", onPopoverFocus);
        target.removeEventListener("blur", onPopoverBlur);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
        blockListeners.clear();
        serviceEventListeners.clear();
        statusControlListeners.clear();
        popoverClosedListeners.clear();
        lateGenerateListeners.clear();
        unclaimedLateGenerate.length = 0;
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/service-providers.js
  var BROWSER_CONTROL_ACTIONS = [
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.type",
    "browser.select",
    "browser.scroll",
    "browser.back",
    "browser.forward",
    "browser.inspect",
    "browser.capture",
    "browser.resize",
    "browser.close"
  ];
  var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
  var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
  var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
  var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
  var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
  var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

  // node_modules/@openchamber/sdk/dist/service-surface.js
  var SURFACE_CONTROLLERS = ["none", "agent", "user"];
  var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

  // node_modules/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var SYNTAX_TOKEN_VARS = [
    ["--oc-syntax-keyword", "--syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "--syntax-string", "syntaxString"],
    ["--oc-syntax-number", "--syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "--syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "--syntax-type", "syntaxType"],
    ["--oc-syntax-comment", "--syntax-comment", "syntaxComment"],
    ["--oc-syntax-variable", "--syntax-variable", "syntaxVariable"],
    ["--oc-syntax-operator", "--syntax-operator", "syntaxOperator"]
  ];
  var applyHostTheme = (theme, root2) => {
    root2.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root2.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root2.style.setProperty(alias, value);
      root2.style.setProperty(hostName, value);
    }
    root2.style.setProperty("font-family", theme.tokens.font);
    root2.style.setProperty("font-size", "0.875rem");
    root2.style.setProperty("line-height", "1.45");
    root2.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx2, root2) => {
    applyHostTheme(ctx2.theme, root2);
    if (root2.dataset) {
      root2.dataset.ocSurface = ctx2.surface;
      root2.dataset.ocTheme = ctx2.theme.mode;
    }
  };

  // node_modules/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    "primary": "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    "radius": "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var controlRadius = `calc(${radius} - 2px)`;
  var smallRadius = `calc(${radius} - 4px)`;
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusFill = `background-image: linear-gradient(${hover}, ${hover});`;
  var field = (edge, width = "0.5px") => `box-shadow: inset 0 0 0 ${width} ${edge}, var(--oc-sdk-field-lift);`;
  var raised = "border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);";
  var litButton = "box-shadow: var(--oc-sdk-lit);";
  var darkLift = `inset 0 0.5px 0 0 ${mix(fg, 8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`;
  var THEME_VARS = `
:root {
  --oc-sdk-edge: ${mix(fg, 16)};
  --oc-sdk-field-bg: ${elevated};
  --oc-sdk-raised-bg: ${bg};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${mix(fg, 14)};
  --oc-sdk-field-bg: ${mix(bg, 50, elevated)};
  --oc-sdk-raised-bg: ${elevated};
  --oc-sdk-field-lift: ${darkLift};
  --oc-sdk-raised-lift: ${darkLift};
  --oc-sdk-lit: ${darkLift};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var UI_SIZE_CSS = `
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: 6px; height: 28px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: 4px; height: 24px; padding: 0 8px; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: 8px 10px; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 28px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: 14px; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: 2px; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; }
`;
  var GUEST_UI_LOOK_CSS = `${THEME_VARS}
.oc-sdk { color: ${fg}; font-family: ${font}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${focusFill} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { border-radius: ${controlRadius}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${smallRadius}; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; ${litButton} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; ${litButton} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; box-shadow: none; }

.oc-sdk-field-note { color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { border-radius: ${controlRadius}; background: var(--oc-sdk-field-bg); color: ${elevatedFg}; ${field("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${field(mix(fg, 26), "1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${field(v("status-error", "red"), "1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search-icon { color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { border-radius: ${smallRadius}; color: ${muted}; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-trigger { border-radius: ${controlRadius}; background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { color: ${muted}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${elevated}; background-clip: padding-box; color: ${elevatedFg}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option-check { color: ${fg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-hint { color: ${muted}; }
.oc-sdk-popup-empty { color: ${muted}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${border}; border-radius: 4px; color: ${fg}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(fg, 60, border)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusFill} }
.oc-sdk-check-desc { color: ${muted}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${muted}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${elevatedFg}; background: var(--oc-sdk-raised-bg); ${raised} }
.oc-sdk-tab-count { color: ${muted}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${mix(fg, 6)}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { font-family: ${mono}; color: ${muted}; }
.oc-sdk-row-sub { color: ${muted}; }
.oc-sdk-row-meta { color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${muted}; }

.oc-sdk-empty-body { color: ${muted}; }

.oc-sdk-spinner { color: ${muted}; }
.oc-sdk-spinner-ring { border-color: ${border}; border-top-color: ${primary}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${muted}; }

.oc-sdk-separator { color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${mix(border, 40)}; }

.oc-sdk-progress-label { color: ${muted}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${mix(fg, 6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${v("status-success", "currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${v("success-text", "inherit")}; }

.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
${UI_SIZE_CSS}
${GUEST_UI_LOOK_CSS}`;

  // node_modules/@openchamber/sdk/dist/ui/dom.js
  var STYLE_ID = "oc-sdk-ui-style";
  var ensureStyle = (css) => {
    const existing = document.getElementById(STYLE_ID);
    if (existing instanceof HTMLStyleElement) {
      if (existing.textContent !== css) {
        existing.textContent = css;
      }
      return;
    }
    installGuestScrollbarActivity(document);
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  };
  var el = (tag, className) => {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  };
  var button = (className) => {
    const node = el("button", className);
    node.type = "button";
    return node;
  };
  var setText = (node, text) => {
    const next = text ?? "";
    if (node.textContent !== next) {
      node.textContent = next;
    }
  };
  var setAttr = (node, name, value) => {
    if (value === void 0 || value === null || value === "") {
      node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) {
      node.setAttribute(name, value);
    }
  };

  // node_modules/@openchamber/sdk/dist/ui/button.js
  var ring = () => {
    const spinner = document.createElement("span");
    spinner.className = "oc-sdk-spinner-ring";
    spinner.setAttribute("aria-hidden", "true");
    return spinner;
  };
  var mountButton = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-btn");
    const spinner = ring();
    const label = document.createElement("span");
    node.append(label);
    root2.append(node);
    const paint = () => {
      node.dataset.variant = props.variant ?? "default";
      node.dataset.size = props.size ?? "default";
      node.disabled = Boolean(props.disabled) || Boolean(props.loading);
      node.dataset.loading = props.loading ? "true" : "false";
      node.setAttribute("aria-busy", props.loading ? "true" : "false");
      if (props.loading && spinner.parentNode !== node) {
        node.prepend(spinner);
      } else if (!props.loading && spinner.parentNode === node) {
        spinner.remove();
      }
      setText(label, props.label);
    };
    const onClick = () => {
      if (props.disabled || props.loading) {
        return;
      }
      props.onClick();
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/field.js
  var mountTextField = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const field2 = el("label", "oc-sdk oc-sdk-field");
    const caption = el("span", "oc-sdk-field-label");
    const input = props.multiline ? el("textarea", "oc-sdk-input") : el("input", "oc-sdk-input");
    const note2 = el("span", "oc-sdk-field-note");
    field2.append(caption, input, note2);
    root2.append(field2);
    const paint = () => {
      setText(caption, props.label);
      caption.hidden = !props.label;
      if (input instanceof HTMLInputElement) {
        input.type = props.password ? "password" : "text";
      } else {
        input.rows = props.rows ?? 3;
      }
      if (input.value !== props.value) {
        input.value = props.value;
      }
      input.disabled = Boolean(props.disabled);
      setAttr(input, "placeholder", props.placeholder);
      input.dataset.mono = props.mono ? "true" : "false";
      const invalid = Boolean(props.error);
      field2.dataset.invalid = invalid ? "true" : "false";
      input.setAttribute("aria-invalid", invalid ? "true" : "false");
      const text = props.error ?? props.helper ?? "";
      setText(note2, text);
      note2.hidden = text === "";
    };
    const onInput = () => {
      props.onChange(input.value);
    };
    input.addEventListener("input", onInput);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        input.removeEventListener("input", onInput);
        field2.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/icons.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICON_PATH = {
    search: "M18.031 16.617l4.283 4.282-1.415 1.415-4.282-4.283A8.96 8.96 0 0 1 11 20c-4.968 0-9-4.032-9-9s4.032-9 9-9 9 4.032 9 9a8.96 8.96 0 0 1-1.969 5.617zm-2.006-.742A6.977 6.977 0 0 0 18 11c0-3.868-3.133-7-7-7-3.868 0-7 3.132-7 7 0 3.867 3.132 7 7 7a6.977 6.977 0 0 0 4.875-1.975l.15-.15z",
    chevron: "M12 13.172l4.95-4.95 1.414 1.414L12 16 5.636 9.636 7.05 8.222z",
    check: "M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z",
    close: "M12 10.586l4.95-4.95 1.414 1.414-4.95 4.95 4.95 4.95-1.414 1.414-4.95-4.95-4.95 4.95-1.414-1.414 4.95-4.95-4.95-4.95L7.05 5.636z"
  };
  var icon = (name, size, className) => {
    const node = document.createElementNS(SVG_NS, "svg");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("width", String(size));
    node.setAttribute("height", String(size));
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("fill", "currentColor");
    if (className) {
      node.setAttribute("class", className);
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATH[name]);
    node.append(path);
    return node;
  };

  // node_modules/@openchamber/sdk/dist/ui/checkbox.js
  var mountToggle = (root2, initial, role) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-check");
    node.setAttribute("role", role);
    const control = el("span", role === "switch" ? "oc-sdk-check-thumb" : "oc-sdk-check-box");
    if (role === "checkbox") {
      control.append(icon("check", 12));
    }
    const text = el("span", "oc-sdk-check-text");
    const label = el("span", "oc-sdk-check-label");
    const description = el("span", "oc-sdk-check-desc");
    text.append(label, description);
    node.append(control, text);
    root2.append(node);
    const paint = () => {
      node.setAttribute("aria-checked", props.checked ? "true" : "false");
      node.disabled = Boolean(props.disabled);
      setText(label, props.label);
      setText(description, props.description);
      description.hidden = !props.description;
    };
    const onClick = () => {
      if (!props.disabled) {
        props.onChange(!props.checked);
      }
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };
  var mountSwitch = (root2, initial) => mountToggle(root2, initial, "switch");

  // node_modules/@openchamber/sdk/dist/ui/badge.js
  var applyTone = (node, tone2) => {
    setAttr(node, "data-tone", tone2 && tone2 !== "neutral" ? tone2 : null);
  };
  var mountBadge = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("span", "oc-sdk oc-sdk-badge");
    root2.append(node);
    const paint = () => {
      setText(node, props.label);
      applyTone(node, props.tone);
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/spinner.js
  var mountSpinner = (root2, initial = {}) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("span", "oc-sdk oc-sdk-spinner");
    node.setAttribute("role", "status");
    const ring2 = el("span", "oc-sdk-spinner-ring");
    ring2.setAttribute("aria-hidden", "true");
    const label = el("span");
    node.append(ring2, label);
    root2.append(node);
    const paint = () => {
      node.dataset.size = props.size ?? "default";
      setText(label, props.label);
      label.hidden = !props.label;
      node.setAttribute("aria-label", props.label ?? "Loading");
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/banner.js
  var mountBanner = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("div", "oc-sdk oc-sdk-banner");
    const text = el("div", "oc-sdk-banner-text");
    const title = el("div", "oc-sdk-banner-title");
    const body = el("div", "oc-sdk-banner-body");
    const slot = el("div", "oc-sdk-banner-action");
    text.append(title, body);
    node.append(text, slot);
    root2.append(node);
    let action = null;
    const paint = () => {
      node.dataset.tone = props.tone;
      node.setAttribute("role", props.tone === "error" || props.tone === "warning" ? "alert" : "status");
      setText(title, props.title);
      setText(body, props.body);
      body.hidden = !props.body;
      slot.hidden = !props.action;
      if (!props.action) {
        action?.dispose();
        action = null;
        return;
      }
      const next = { label: props.action.label, onClick: props.action.onClick };
      if (action) {
        action.update(next);
      } else {
        action = mountButton(slot, { ...next, variant: "outline", size: "xs" });
      }
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        action?.dispose();
        action = null;
        node.remove();
      }
    };
  };

  // src/guest/host.ts
  var createObservable = (initial, equals = Object.is) => {
    let value = initial;
    const listeners = /* @__PURE__ */ new Set();
    return {
      get: () => value,
      set: (next) => {
        if (equals(value, next)) return;
        value = next;
        for (const listener of [...listeners]) listener(next);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        listener(value);
        return () => listeners.delete(listener);
      }
    };
  };
  var sameSession = (a, b) => a === b || a !== null && b !== null && a.id === b.id && a.busy === b.busy && a.title === b.title;
  var createGuestHost = (client) => {
    const ready = createObservable(null);
    const session = createObservable(null, sameSession);
    const directory = createObservable(null);
    const item = createObservable(null);
    const lifecycle = /* @__PURE__ */ new Set();
    const readyWaiters = [];
    const unsubscribers = [
      client.onReady((context) => {
        ready.set(context);
        session.set(context.session);
        directory.set(context.directory);
        if (context.item !== null) item.set(context.item);
        for (const resolve of readyWaiters.splice(0)) resolve(context);
      }),
      client.onSession((next) => session.set(next)),
      client.onDirectory((next) => directory.set(next)),
      client.onItem((next) => item.set(next)),
      client.onSessionLifecycle((event) => {
        for (const listener of [...lifecycle]) listener(event);
      })
    ];
    return {
      client,
      ready,
      session,
      directory,
      item,
      onLifecycle: (listener) => {
        lifecycle.add(listener);
        return () => lifecycle.delete(listener);
      },
      whenReady: () => {
        const current = ready.get();
        return current ? Promise.resolve(current) : new Promise((resolve) => readyWaiters.push(resolve));
      },
      dispose: () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
        lifecycle.clear();
      }
    };
  };
  var shared = null;
  var getGuestHost = () => {
    shared ?? (shared = createGuestHost(connectHost()));
    return shared;
  };

  // src/shared/limits.ts
  var SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
  var SNAPSHOT_BYTES_MAX = 100 * 1024 * 1024;
  var TURN_PROMOTE_AUTO_MS = 30 * 6e4;
  var UPLOAD_TOTAL_MAX = 2e6;
  var UPLOAD_CHUNK_MAX_CHARS = 6e4;
  var UPLOAD_CHUNK_MAX_BYTES = 75e3;
  var UPLOAD_TTL_MS = 10 * 6e4;
  var OUTBOX_TTL_MS = 10 * 6e4;
  var OPEN_REQUEST_TTL_MS = 2 * 6e4;
  var RENDER_DOC_MAX_BYTES = 60 * 1024 * 1024;
  var RENDER_CACHE_MAX_BYTES = 256 * 1024 * 1024;
  var GUEST_RENDER_CACHE_MAX_BYTES = 64 * 1024 * 1024;
  var RENDER_CHUNK_CONCURRENCY = 3;
  var CHECK_RUN_BUDGET_MS = 9e4;
  var LOOSE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
  var ACTIVITY_WORKING_EXPIRY_MS = 30 * 6e4;
  var STATUS_RECENT_MS = 7 * 864e5;
  var THUMB_DATA_TEXT_MAX = 4194304;
  var THUMB_RETRY_DELAYS_MS = [2e3, 5e3, 1e4];
  var BLOCK_TITLE_MAX = 80;
  var BLOCK_SCREEN_TITLE_MAX = 40;
  var BLOCK_SCREENS_SHOWN = 6;
  var DIRECTION_QUESTION_MAX = 200;
  var DIRECTION_LABEL_MAX = 80;
  var DIRECTION_OPTIONS_MIN = 2;
  var DIRECTION_OPTIONS_MAX = 4;
  var USER_UNDO_TTL_MS = 30 * 6e4;
  var SYSTEM_ID_PATTERN = SLUG_PATTERN;
  var SYSTEM_BYTES_MAX = 100 * 1024 * 1024;
  var SYSTEM_FONT_MAX_BYTES = 5 * 1024 * 1024;
  var SYSTEM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
  var SYSTEM_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
  var BINARY_UPLOAD_TOTAL_MAX = 28e6;
  var SCAN_TTL_MS = 10 * 6e4;
  var FOLDER_UNDO_MS = 60 * 6e4;
  var SYSTEM_BUILD_TICKET_PATTERN = /^sb_[a-z0-9]{12}$/;
  var SYSTEM_BUILD_TTL_MS = 7 * 864e5;
  var LIVING_PAGE_MAX_BYTES = 20 * 1024 * 1024;
  var LIVING_PAGE_ASSET_MAX_BYTES = 4 * 1024 * 1024;
  var SCAN_JSON_MAX_BYTES = 2 * 1024 * 1024;
  var SYSTEM_PROPOSAL_ID_PATTERN = /^p_[a-z0-9]{8,16}$/;
  var SYSTEM_ASK_POLL_MS = 5e3;
  var SYSTEM_ASK_CALLS_MAX = 8;
  var SYSTEM_ASK_WHY_MAX = 300;
  var SYSTEM_ASK_PROPOSED_MAX = 200;

  // src/shared/agent/context.ts
  var VIEWPORT_TABLET = Object.freeze({ id: "tablet", label: "Tablet", width: 768, height: 1024 });
  var VIEWPORT_DESKTOP = Object.freeze({ id: "desktop", label: "Desktop", width: 1440, height: 900 });

  // src/shared/types.ts
  var CHIP_PROVIDER_ID = "design-chamber";

  // src/shared/api.ts
  var API_ERROR_STATUS = {
    unauthorized: 401,
    "bad-request": 400,
    "bad-path": 400,
    "bad-slug": 400,
    "not-found": 404,
    conflict: 409,
    stale: 409,
    "too-large": 413,
    "no-html": 422,
    invalid: 422,
    "read-only": 422,
    internal: 500
  };
  var isApiErrorCode = (value) => typeof value === "string" && Object.hasOwn(API_ERROR_STATUS, value);
  var ROUTE_OWNERS = {
    "GET /health": "WP0",
    "GET /settings": "WP1",
    "PUT /settings": "WP1",
    "GET /changes": "WP1",
    "GET /designs": "WP1",
    "POST /designs": "WP1",
    "GET /designs/:slug": "WP1",
    "PATCH /designs/:slug": "WP1",
    "DELETE /designs/:slug": "WP1",
    "POST /designs/:slug/comments": "WP1",
    "PATCH /designs/:slug/comments/:id": "WP1",
    "DELETE /designs/:slug/comments/:id": "WP1",
    "POST /designs/:slug/comments/mark-sent": "WP1",
    "POST /uploads": "WP1",
    "PUT /uploads/:id/:index": "WP1",
    "DELETE /uploads/:id": "WP1",
    "GET /outbox": "WP1",
    "PUT /outbox": "WP1",
    "DELETE /outbox": "WP1",
    "DELETE /agent/skill": "U2",
    "POST /loose/import": "WP1",
    "GET /designs/:slug/render": "WP2",
    "GET /designs/:slug/render/chunk": "WP2",
    "GET /designs/:slug/source": "WP2",
    "GET /designs/:slug/thumbnail": "WP2",
    "POST /designs/:slug/thumbnail/refresh": "WP2",
    "GET /designs/:slug/versions": "WP2",
    "POST /designs/:slug/versions": "WP2",
    "POST /versions/turn": "WP2",
    "GET /designs/:slug/versions/:vid/diff": "WP2",
    "POST /designs/:slug/versions/:vid/restore": "WP2",
    "POST /designs/:slug/export": "WP2",
    "POST /reveal": "WP2",
    "GET /designs/:slug/checks": "WP2",
    "POST /designs/:slug/checks/run": "WP2",
    "GET /presets": "WP3",
    "POST /chip": "WP3",
    "POST /designs/:slug/prompt": "WP3",
    "POST /pages/from-message": "WP3",
    "DELETE /open-request": "WP3",
    "POST /open-request": "WP3",
    "POST /session-events": "U4",
    "POST /mentions/search": "U6",
    "POST /mentions/resolve": "U6",
    "GET /status/designs": "U5",
    "POST /designs/:slug/edits": "P2",
    "POST /designs/:slug/edits/:id/undo": "P2",
    "GET /designs/:slug/tokens": "P2",
    "POST /designs/:slug/hand-edits/clear": "P2",
    "GET /designs/:slug/page-state": "P2",
    "PATCH /designs/:slug/page-state": "P2",
    "DELETE /designs/:slug/page-state": "P2",
    "GET /systems": "P25",
    "POST /systems": "P25",
    "GET /systems/:id": "P25",
    "PATCH /systems/:id": "P25",
    "DELETE /systems/:id": "P25",
    "POST /systems/:id/edits": "P25",
    "POST /systems/:id/edits/:eid/undo": "P25",
    "POST /systems/:id/hand-edits/clear": "P25",
    "POST /systems/:id/assets": "P25",
    "POST /systems/:id/assets/from-folder": "P25",
    "GET /systems/:id/board": "P25",
    "GET /systems/:id/board/chunk": "P25",
    "GET /systems/:id/versions": "P25",
    "GET /systems/:id/versions/:vid/diff": "P25",
    "POST /systems/:id/versions/:vid/restore": "P25",
    "POST /systems/:id/prompt": "P25",
    "GET /systems/:id/checks": "P25",
    "POST /system-scans": "P25",
    "GET /system-scans/:scanId": "P25",
    "DELETE /system-scans/:scanId": "P25",
    "POST /systems/:id/resync": "P25",
    "GET /designs/:slug/system": "P25",
    "GET /designs/:slug/system/preview": "P25",
    "POST /designs/:slug/system": "P25",
    "GET /folders": "P25",
    "POST /folders": "P25",
    "PATCH /folders/:folderId": "P25",
    "DELETE /folders/:folderId": "P25",
    "POST /folders/:folderId/undelete": "P25",
    "POST /folders/:folderId/designs": "P25",
    "POST /systems/chip": "P25",
    "GET /system-builds/:ticket": "P25",
    "GET /systems/:id/living-page": "P25",
    "GET /systems/:id/proposals/:proposalId": "P25",
    "GET /systems/:id/living-page/render": "P25",
    "GET /systems/:id/living-page/render/chunk": "P25",
    "POST /systems/:id/build/stop": "P25",
    "POST /system-stops/:undoId/undo": "P25"
  };
  var ROUTE_KEYS = Object.keys(ROUTE_OWNERS);
  var RAW_TEXT_ROUTES = /* @__PURE__ */ new Set([
    "GET /designs/:slug/render/chunk",
    "GET /systems/:id/board/chunk",
    "GET /systems/:id/living-page/render/chunk"
  ]);
  var splitRouteKey = (key) => {
    const space = key.indexOf(" ");
    return { method: key.slice(0, space), pattern: key.slice(space + 1) };
  };
  var routePath = (key, params) => {
    const values = params;
    return splitRouteKey(key).pattern.replace(/:([A-Za-z]+)/g, (_match, name) => {
      const value = values[name];
      if (value === void 0 || value === "") throw new Error(`Missing path parameter "${name}" for ${key}.`);
      return encodeURIComponent(value);
    });
  };

  // src/guest/service-client.ts
  var ServiceError = class extends Error {
    constructor(code, message, status = null) {
      super(message);
      __publicField(this, "code");
      /** HTTP status from the service; null when the request never got an answer. */
      __publicField(this, "status");
      this.name = "ServiceError";
      this.code = code;
      this.status = status;
    }
  };
  var isServiceError = (error, code) => error instanceof ServiceError && (code === void 0 || error.code === code);
  var HOST_MESSAGES = {
    NO_SERVICE: "The Design Chamber service is not running. Allow the local service in Settings \u2192 Extensions, then try again.",
    SERVICE_FAILED: "The Design Chamber service stopped unexpectedly. Try again; if it keeps failing, re-enable the extension.",
    HOST_TIMEOUT: "The Design Chamber service took too long to answer. Try again.",
    REQUEST_FAILED: "The Design Chamber service did not answer. Try again.",
    RESPONSE_TOO_LARGE: "The answer from the Design Chamber service was too large to load.",
    DISABLED: "Design Chamber is paused. Turn it back on in Settings \u2192 Extensions.",
    HOST_UNAVAILABLE: "OpenChamber is not reachable from this view. Reopen the panel."
  };
  var toServiceError = (error) => {
    if (error instanceof ServiceError) return error;
    if (error instanceof HostRequestError) return new ServiceError(error.code, HOST_MESSAGES[error.code] ?? error.message);
    return new ServiceError("REQUEST_FAILED", error instanceof Error && error.message ? error.message : "The Design Chamber service did not answer. Try again.");
  };
  var errorFromAnswer = (answer) => {
    try {
      const body = JSON.parse(answer.body);
      if (typeof body === "object" && body !== null && "error" in body && "message" in body) {
        const { error, message } = body;
        if (isApiErrorCode(error) && typeof message === "string" && message !== "") return new ServiceError(error, message, answer.status);
      }
    } catch {
    }
    return new ServiceError(answer.status === 401 ? "unauthorized" : "internal", `The Design Chamber service answered with an error (${answer.status}). Try again.`, answer.status);
  };
  var queryOf = (query) => {
    if (!query) return void 0;
    const out = {};
    for (const [name, value] of Object.entries(query)) if (value !== void 0) out[name] = value;
    return Object.keys(out).length > 0 ? out : void 0;
  };
  var utf8Length = (text) => {
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319 && index + 1 < text.length) {
        const next = text.charCodeAt(index + 1);
        if (next >= 56320 && next <= 57343) {
          bytes += 4;
          index += 1;
        } else bytes += 3;
      } else bytes += 3;
    }
    return bytes;
  };
  var BODY_OVERHEAD = '{"data":""}'.length;
  var escapedCost = (codePoint) => {
    const code = codePoint.charCodeAt(0);
    if (codePoint.length === 1 && code >= 32 && code < 127 && code !== 34 && code !== 92) return [1, 1];
    const escaped = JSON.stringify(codePoint).slice(1, -1);
    return [escaped.length, utf8Length(escaped)];
  };
  var splitUploadChunks = (text, maxChars = UPLOAD_CHUNK_MAX_CHARS, maxBytes = UPLOAD_CHUNK_MAX_BYTES) => {
    const chunks = [];
    let start = 0;
    let chars = 2;
    let bytes = BODY_OVERHEAD;
    let index = 0;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      const width = code >= 55296 && code <= 56319 && index + 1 < text.length && (text.charCodeAt(index + 1) & 64512) === 56320 ? 2 : 1;
      const [costChars, costBytes] = escapedCost(text.slice(index, index + width));
      if (index > start && (chars + costChars > maxChars || bytes + costBytes > maxBytes)) {
        chunks.push(text.slice(start, index));
        start = index;
        chars = 2;
        bytes = BODY_OVERHEAD;
      }
      chars += costChars;
      bytes += costBytes;
      index += width;
    }
    if (index > start) chunks.push(text.slice(start));
    return chunks;
  };
  var BASE64_CHUNK_BYTES = 44997;
  var BASE64_PIECE_BYTES = 8190;
  var base64Of = (bytes) => {
    let text = "";
    for (let at = 0; at < bytes.length; at += BASE64_PIECE_BYTES) {
      text += btoa(String.fromCharCode(...bytes.subarray(at, at + BASE64_PIECE_BYTES)));
    }
    return text;
  };
  var encodeBase64Chunks = (bytes, chunkBytes = BASE64_CHUNK_BYTES) => {
    const chunks = [];
    for (let at = 0; at < bytes.length; at += chunkBytes) chunks.push(base64Of(bytes.subarray(at, at + chunkBytes)));
    return chunks;
  };
  var mapLimit = async (items, limit, run) => {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await run(items[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  };
  var THUMB_CACHE_MAX = 200;
  var createServiceClient = (transport, options = {}) => {
    const renderCacheMax = options.renderCacheBytes ?? GUEST_RENDER_CACHE_MAX_BYTES;
    const renders = /* @__PURE__ */ new Map();
    let renderBytes = 0;
    const inflight = /* @__PURE__ */ new Map();
    const thumbs = /* @__PURE__ */ new Map();
    const call = async (key, ...args) => {
      const request = args[0] ?? {};
      const { method } = splitRouteKey(key);
      const path = routePath(key, request.params ?? {});
      const guestRequest = { method, path };
      const query = queryOf(request.query);
      if (query) guestRequest.query = query;
      if (request.body !== void 0) guestRequest.body = JSON.stringify(request.body);
      let answer;
      try {
        answer = await transport.serviceRequest(guestRequest);
      } catch (error) {
        throw toServiceError(error);
      }
      if (answer.status < 200 || answer.status >= 300) throw errorFromAnswer(answer);
      if (RAW_TEXT_ROUTES.has(key)) return answer.body;
      try {
        return JSON.parse(answer.body);
      } catch {
        throw new ServiceError("bad-response", "The Design Chamber service sent an answer that could not be read. Try again.", answer.status);
      }
    };
    const remember = (doc) => {
      if (renders.has(doc.meta.key)) return;
      renders.set(doc.meta.key, doc);
      renderBytes += doc.meta.bytes;
      for (const [key, old] of renders) {
        if (renderBytes <= renderCacheMax || renders.size <= 1) break;
        renders.delete(key);
        renderBytes -= old.meta.bytes;
      }
    };
    const fetchRender = async (slug, screen, version) => {
      const query = {};
      if (screen) query.screen = screen;
      if (version) query.version = version;
      const meta = await call("GET /designs/:slug/render", { params: { slug }, query });
      const cached = renders.get(meta.key);
      if (cached) {
        renders.delete(meta.key);
        renders.set(meta.key, cached);
        return cached;
      }
      const indexes = Array.from({ length: meta.chunks }, (_, n) => n);
      const parts = await mapLimit(
        indexes,
        RENDER_CHUNK_CONCURRENCY,
        (n) => call("GET /designs/:slug/render/chunk", { params: { slug }, query: { key: meta.key, n: String(n) } })
      );
      const doc = { meta, html: parts.join("") };
      remember(doc);
      return doc;
    };
    const loadRender = (slug, screen = null, version = null) => {
      const id = `${slug}\0${screen ?? ""}\0${version ?? ""}`;
      const running = inflight.get(id);
      if (running) return running;
      const task = (async () => {
        try {
          return await fetchRender(slug, screen, version);
        } catch (error) {
          if (isServiceError(error, "stale")) return fetchRender(slug, screen, version);
          throw error;
        }
      })().finally(() => inflight.delete(id));
      inflight.set(id, task);
      return task;
    };
    const fetchBoard = async (id, version, scheme) => {
      const query = { scheme };
      if (version) query.version = version;
      const meta = await call("GET /systems/:id/board", { params: { id }, query });
      const cached = renders.get(meta.key);
      if (cached) {
        renders.delete(meta.key);
        renders.set(meta.key, cached);
        return cached;
      }
      const indexes = Array.from({ length: meta.chunks }, (_, n) => n);
      const parts = await mapLimit(
        indexes,
        RENDER_CHUNK_CONCURRENCY,
        (n) => call("GET /systems/:id/board/chunk", { params: { id }, query: { key: meta.key, n: String(n) } })
      );
      const doc = { meta, html: parts.join("") };
      remember(doc);
      return doc;
    };
    const loadBoard = (id, version = null, scheme = "light") => {
      const key = `board\0${id}\0${version ?? ""}\0${scheme}`;
      const running = inflight.get(key);
      if (running) return running;
      const task = (async () => {
        try {
          return await fetchBoard(id, version, scheme);
        } catch (error) {
          if (isServiceError(error, "stale")) return fetchBoard(id, version, scheme);
          throw error;
        }
      })().finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    };
    const upload = async (text) => {
      if (text.length > UPLOAD_TOTAL_MAX) {
        throw new ServiceError("too-large", `This text is too long to send to Design Chamber (over ${UPLOAD_TOTAL_MAX.toLocaleString("en-US")} characters).`);
      }
      const { uploadId } = await call("POST /uploads", { body: { total: text.length } });
      const chunks = splitUploadChunks(text);
      for (const [index, data] of chunks.entries()) {
        await call("PUT /uploads/:id/:index", { params: { id: uploadId, index: String(index) }, body: { data } });
      }
      return uploadId;
    };
    const uploadBinary = async (file, onProgress) => {
      const chunks = encodeBase64Chunks(new Uint8Array(await file.arrayBuffer()));
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (total > BINARY_UPLOAD_TOTAL_MAX) {
        throw new ServiceError("too-large", "That file is larger than the 21 MB Design Chamber accepts.");
      }
      const { uploadId } = await call("POST /uploads", { body: { total, encoding: "base64" } });
      let sent = 0;
      try {
        for (const [index, data] of chunks.entries()) {
          await call("PUT /uploads/:id/:index", { params: { id: uploadId, index: String(index) }, body: { data } });
          sent += data.length;
          onProgress?.(total === 0 ? 1 : sent / total);
        }
      } catch (error) {
        await call("DELETE /uploads/:id", { params: { id: uploadId } }).catch(() => void 0);
        throw error;
      }
      return uploadId;
    };
    const thumbnail = async (slug, key = null) => {
      if (key) {
        const cached = thumbs.get(key);
        if (cached) return cached;
      }
      const answer = await call("GET /designs/:slug/thumbnail", { params: { slug } });
      if (answer.state === "ready" && answer.key && answer.png) {
        thumbs.set(answer.key, answer);
        const oldest = thumbs.keys().next();
        if (thumbs.size > THUMB_CACHE_MAX && !oldest.done) thumbs.delete(oldest.value);
      }
      return answer;
    };
    const getProposal = (systemId, proposalId) => call("GET /systems/:id/proposals/:proposalId", { params: { id: systemId, proposalId } });
    const stopBuild = (systemId, proposalId = null) => call("POST /systems/:id/build/stop", { params: { id: systemId }, body: { proposalId } });
    const undoStop = (undoId) => call("POST /system-stops/:undoId/undo", { params: { undoId }, body: {} });
    const loadLivingPage = (systemId) => call("GET /systems/:id/living-page", { params: { id: systemId } });
    return { call, loadRender, loadBoard, upload, uploadBinary, thumbnail, getProposal, stopBuild, undoStop, loadLivingPage };
  };

  // src/guest/flows.ts
  var PANEL_SURFACE_ID = `plugin:${CHIP_PROVIDER_ID}`;
  var isHostError = (error, code) => error instanceof HostRequestError && error.code === code;
  var openInRail = async (deps, slug, intent) => leaveAndOpen(deps, { slug, intent });
  var openSystemInRail = async (deps, system, target) => leaveAndOpen(deps, { system, target });
  var leaveAndOpen = async (deps, body) => {
    try {
      await deps.client.call("POST /open-request", { body });
    } catch (error) {
      if (isServiceError(error, "not-found")) return "gone";
      throw error;
    }
    try {
      await deps.host.openSurface(PANEL_SURFACE_ID);
      return "opened";
    } catch (error) {
      try {
        await deps.client.call("DELETE /open-request");
      } catch {
      }
      if (isHostError(error, "NO_DIRECTORY") || isHostError(error, "UNSUPPORTED")) return "not-here";
      throw error;
    }
  };

  // src/ui/model/block-args.ts
  var OPTION_LETTERS = ["A", "B", "C", "D"];
  var DEFAULT_QUESTION = "Which direction?";
  var clipText = (text, max) => {
    const flat = text.replace(/\s+/g, " ").trim();
    const chars = Array.from(flat);
    return chars.length <= max ? flat : `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}\u2026`;
  };
  var textArg = (value) => typeof value === "string" ? value : null;
  var slugOf = (value) => {
    const text = textArg(value)?.trim() ?? "";
    return SLUG_PATTERN.test(text) ? text : null;
  };
  var listOf = (value) => {
    const text = textArg(value);
    if (text === null) return null;
    return text.split("|").map((entry) => entry.trim()).filter((entry) => entry !== "");
  };
  var parseDirection = (args) => {
    const labels = listOf(args.options);
    const slugs = listOf(args.slugs);
    if (labels === null || slugs === null) return { ok: false, reason: "bad-options" };
    const count = labels.length;
    if (count < DIRECTION_OPTIONS_MIN || count > DIRECTION_OPTIONS_MAX || slugs.length !== count) return { ok: false, reason: "bad-options" };
    const options = [];
    for (const [index, label] of labels.entries()) {
      const slug = slugOf(slugs[index]);
      const letter = OPTION_LETTERS[index];
      if (slug === null || letter === void 0) return { ok: false, reason: "bad-options" };
      options.push({ letter, label: clipText(label, DIRECTION_LABEL_MAX), slug });
    }
    const question = clipText(textArg(args.question) ?? "", DIRECTION_QUESTION_MAX);
    return { ok: true, block: { name: "DirectionPick", question: question === "" ? DEFAULT_QUESTION : question, options } };
  };
  var BAD_ASK = { ok: false, reason: "bad-system-ask" };
  var argsFit = (args) => {
    try {
      return JSON.stringify(args).length <= GUEST_BLOCK_ARGS_TEXT_MAX;
    } catch {
      return false;
    }
  };
  var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var parseCalls = (value) => {
    const text = textArg(value);
    if (text === null || text.trim() === "") return null;
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    if (!Array.isArray(raw)) return null;
    const calls = [];
    let dropped = 0;
    for (const entry of raw) {
      const topic = isRecord(entry) ? textArg(entry.topic)?.trim() : void 0;
      if (!isRecord(entry) || topic === void 0 || topic === "" || calls.length >= SYSTEM_ASK_CALLS_MAX || calls.some((call) => call.topic === topic)) {
        dropped += 1;
        continue;
      }
      calls.push({
        topic,
        why: clipText(textArg(entry.why) ?? "", SYSTEM_ASK_WHY_MAX),
        proposed: clipText(textArg(entry.proposed) ?? "", SYSTEM_ASK_PROPOSED_MAX)
      });
    }
    return { calls, dropped };
  };
  var matching = (value, pattern) => {
    const text = textArg(value)?.trim() ?? "";
    return pattern.test(text) ? text : null;
  };
  var parseSystemAskArgs = (args) => {
    if (!argsFit(args)) return BAD_ASK;
    const kind = textArg(args.kind)?.trim();
    if (kind === "interview-1") {
      const ticket = matching(args.ticket, SYSTEM_BUILD_TICKET_PATTERN);
      return ticket === null ? BAD_ASK : { ok: true, block: { name: "SystemAsk", ask: { kind, ticket } } };
    }
    const systemId = matching(args.systemId, SYSTEM_ID_PATTERN);
    if (systemId === null) return BAD_ASK;
    if (kind === "interview-2") {
      const read = parseCalls(args.calls);
      return read === null ? BAD_ASK : { ok: true, block: { name: "SystemAsk", ask: { kind, systemId, calls: read.calls, dropped: read.dropped } } };
    }
    if (kind === "diff") {
      const proposalId = matching(args.proposalId, SYSTEM_PROPOSAL_ID_PATTERN);
      return proposalId === null ? BAD_ASK : { ok: true, block: { name: "SystemAsk", ask: { kind, systemId, proposalId } } };
    }
    return BAD_ASK;
  };
  var parseBlockArgs = (name, args) => {
    if (name === "DesignCard") {
      const slug = slugOf(args.slug);
      return slug === null ? { ok: false, reason: "bad-slug" } : { ok: true, block: { name: "DesignCard", slug } };
    }
    if (name === "DirectionPick") return parseDirection(args);
    if (name === "SystemAsk") return parseSystemAskArgs(args);
    return { ok: false, reason: "unknown-block" };
  };

  // src/ui/components/dom.ts
  var h = (tag, attrs = null, ...children) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === void 0 || value === false) continue;
        if (typeof value === "function") node.addEventListener(key.replace(/^on/, "").toLowerCase(), value);
        else if (key === "class") node.className = String(value);
        else node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    append(node, ...children);
    return node;
  };
  var append = (node, ...children) => {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
  };
  var errorText2 = (error) => error instanceof Error && error.message !== "" ? error.message : "Something unexpected happened. Try again.";

  // src/ui/components/icons.ts
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var ICONS = {
    back: ["M19 12H5", "m12 19-7-7 7-7"],
    plus: ["M5 12h14", "M12 5v14"],
    minus: ["M5 12h14"],
    more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
    chevron: ["m6 9 6 6 6-6"],
    close: ["M18 6 6 18", "m6 6 12 12"],
    check: ["M20 6 9 17l-5-5"],
    settings: ["M4 6h8", "M16 6h4", "M14 4v4", "M4 12h2", "M10 12h10", "M8 10v4", "M4 18h10", "M18 18h2", "M16 16v4"],
    comment: ["M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
    history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"],
    download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
    copy: ["M9 9h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
    external: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "m15 3 6 0 0 6", "M10 14 21 3"],
    cursor: ["M4 4l7.07 16.97 2.51-7.39 7.39-2.51L4 4z"],
    play: ["m7 4 13 8-13 8z"],
    fit: ["M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3"],
    sidebar: ["M4 5h16v14H4z", "M9 5v14"],
    folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
    canvas: ["M3 3h8v8H3z", "M13 3h8v5h-8z", "M13 10h8v11h-8z", "M3 13h8v8H3z"],
    page: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "m10 13-2 2 2 2", "m14 13 2 2-2 2"],
    trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
    pencil: ["M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z", "m14 6 4 4"],
    link: ["M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1", "M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"],
    chat: ["M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"],
    compare: ["M6 3v12", "M18 9v12", "M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M13 6h-2a3 3 0 0 0-3 3", "M11 18h2a3 3 0 0 0 3-3"],
    restore: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
    hand: ["M8 13V5a1.5 1.5 0 0 1 3 0v6", "M11 11V4a1.5 1.5 0 0 1 3 0v7", "M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.6L8 14"],
    eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
    reset: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
    alert: ["M12 3 2 20h20z", "M12 10v5", "M12 18h.01"],
    image: ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9h.01"],
    warning: ["M12 3 2 20h20z", "M12 10v4", "M12 17h.01"],
    send: ["M22 2 11 13", "M22 2l-7 20-4-9-9-4z"],
    pin: ["M12 21s-7-5.2-7-11a7 7 0 1 1 14 0c0 5.8-7 11-7 11z", "M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"],
    layers: ["m12 3 9 5-9 5-9-5z", "m3 13 9 5 9-5"],
    // A palette with its dabs: design systems.
    system: ["M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8.1-9-8.1z", "M7.5 11.5h.01", "M10 7.5h.01", "M15 7.5h.01"],
    // Three sliders with their knobs: the Tweaks button.
    tune: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M2 14h4", "M10 8h4", "M18 16h4"]
  };
  var icon2 = (name, size = 16) => {
    const svg = document.createElementNS(SVG_NS2, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("dc-icon");
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVG_NS2, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  };

  // src/ui/blocks/block-view.ts
  var notice = (options) => {
    const body = h("div", { class: "dcb-notice-body" }, h("p", { class: "dcb-notice-text" }, options.text), options.detail ? h("p", { class: "dcb-notice-detail" }, options.detail) : null);
    const el2 = h("div", { class: "dcb-block dcb-notice", role: "status" }, h("span", { class: "dcb-notice-icon" }, icon2(options.icon, 16)), body);
    if (options.action) {
      const slot = h("div", { class: "dcb-notice-action" });
      body.append(slot);
      mountButton(slot, { label: options.action.label, variant: "outline", size: "sm", onClick: options.action.onClick });
    }
    return el2;
  };

  // src/shared/checks.ts
  var num = (value, digits = 0) => value === void 0 ? "?" : digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
  var fileOf = (f) => f.file ?? "This design";
  var skippedSentence = (f) => {
    const count = Math.round(f.params?.count ?? 0);
    const what = `${count} ${count === 1 ? "artboard was" : "artboards were"} not rendered`;
    if (f.params?.reason === "budget") return `${what} (the run took longer than ${Math.round(CHECK_RUN_BUDGET_MS / 1e3)} seconds).`;
    if (f.params?.reason === "failures") return `${what} (the browser failed three times in a row).`;
    return `${what} (the limit is ${num(f.params?.max)} per run). Use --screen <id> to check the rest.`;
  };
  var systemNameOf = (f) => f.params?.system ?? "the design system";
  var repoNameOf = (f) => f.params?.repo ?? "the repo";
  var AREA_LABELS = {
    foundations: "Foundations",
    components: "Components",
    patterns: "Patterns & voice",
    brand: "Brand & marketing"
  };
  var SECRET_KIND_LABELS = {
    "aws-key": "an AWS key",
    "github-token": "a GitHub token",
    "openai-style-key": "an OpenAI-style key",
    "slack-token": "a Slack token",
    "google-key": "a Google key",
    "private-key": "a private key"
  };
  var LIVING_FAILED_REASONS = {
    "too-large": "it would be too large.",
    bundle: "a file couldn't be embedded.",
    unsafe: "it didn't pass the safety check.",
    "no-snapshot": "the repo hasn't been read yet.",
    secret: "it would show something shaped like a secret."
  };
  var BUILD_PROBLEM_SENTENCES = {
    unreadable: () => "BUILD.json isn't valid JSON.",
    "ticket-unknown": () => "This design system was started from a chat Design Chamber no longer knows. Start it again with /design-system.",
    "ticket-needed": () => "A system that lives in a repo needs a build ticket. Start it with /design-system in the project's chat.",
    "repo-outside-project": () => "The repo must be the project this chat is in, or a folder inside it. To use a folder above it, such as the root of a monorepo, open a chat in that folder and run /design-system there.",
    "repo-overlap": () => "Another design system already uses this repo folder or living-page path.",
    "living-page-exists": (f) => `The living-page path already exists in ${repoNameOf(f)} and isn't this system's living page. Pick another path.`,
    "code-outside-project": () => "The code folder must be the project this chat is in, or a folder inside it.",
    "home-changed": (f) => `${systemNameOf(f)} already has files in ${repoNameOf(f)}, so its home can't change. Make a new system to move it.`,
    "ticket-changed": () => "BUILD.json names another build. Keep the ticket this system started with.",
    "applied-unknown-proposal": (f) => `The agent says it applied a proposal you didn't approve here. Check ${repoNameOf(f)}'s history.`
  };
  var PROPOSAL_PROBLEM_SENTENCES = {
    "not-adopted": "the system has not been adopted from a build yet.",
    round: "the interview is not finished; a proposal needs round two or done.",
    "path-outside": "a system file lies outside the system folder.",
    "living-page-path": "the living-page file is not the build's living-page path.",
    "create-exists": "a file the proposal creates already exists in the repo. The proposal must change it, not create it.",
    "from-missing": "a proposed file is missing from proposal/.",
    "describe-change": "Describe only never changes the app's code.",
    "internal-parts": "an internal system's proposal can only hold token fixes.",
    "none-fixes": "a build with no code to fix cannot hold token fixes.",
    rewritten: "this proposal changed after it was shown. Ask the agent for a new one.",
    unreadable: "PROPOSAL.json isn't valid JSON.",
    // §5.14 step 4: problems of the preview generated from proposal/.
    "preview-too-large": "the living page it proposes would be too large.",
    "preview-unsafe": "the living page it proposes didn't pass the safety check.",
    "preview-secret": "the living page it proposes shows something shaped like a secret. Remove it before you approve."
  };
  var driftScope = (f, core) => {
    const base = `In CSS variables and token JSON, ${core}`;
    const unread = f.params?.unread ?? 0;
    if (unread <= 0) return base;
    return `${base} Design Chamber can't read ${num(unread)} token ${unread === 1 ? "file" : "files"}, so differences there aren't counted.`;
  };
  var RULES = {
    "overflow-x": { severity: "error", sentence: (f, where) => `${where}: the content is ${num(f.params?.px)}px wide, wider than the ${num(f.params?.width)}px viewport.` },
    "text-clipped": { severity: "warning", sentence: (_f, where) => `${where}: some text is cut off.` },
    "text-overlap": { severity: "warning", sentence: (_f, where) => `${where}: two pieces of text overlap.` },
    contrast: {
      severity: "error",
      sentence: (f, where) => `${where}: text contrast is ${num(f.params?.ratio, 1)}:1, below the ${num(f.params?.min, 1)}:1 that WCAG AA asks for.`
    },
    "img-alt": { severity: "error", sentence: (_f, where) => `${where}: an image has no alt text.` },
    "control-label": { severity: "error", sentence: (_f, where) => `${where}: a form field has no label.` },
    "button-name": { severity: "error", sentence: (_f, where) => `${where}: a button or link has no name.` },
    "screen-tall": { severity: "warning", sentence: (f, where) => `${where}: this screen is ${num(f.params?.ratio, 1)} viewports tall. Split it into several screens.` },
    "page-height": { severity: "info", sentence: (f, where) => `${where}: the page is ${num(f.params?.px)}px tall.` },
    "console-error": { severity: "error", sentence: (_f, where) => `${where}: a script error.` },
    "request-blocked": { severity: "error", sentence: (_f, where) => `${where}: a request to the internet was blocked.` },
    "dialog-opened": { severity: "info", sentence: (_f, where) => `${where}: the page opened an alert or confirm box.` },
    "render-failed": { severity: "error", sentence: (_f, where) => `${where} could not be rendered.` },
    "render-timeout": { severity: "warning", sentence: (_f, where) => `${where} took too long to render and was skipped.` },
    "render-skipped": { severity: "info", sentence: (f) => skippedSentence(f) },
    "browser-missing": { severity: "info", sentence: () => "No Chrome, Edge or Chromium was found, so nothing was rendered." },
    "design-json-missing": { severity: "error", sentence: () => "design.json is missing. Write it before the HTML." },
    "design-json-invalid": { severity: "error", sentence: () => "design.json is not valid JSON." },
    "design-json-field": { severity: "warning", sentence: (f) => `design.json: "${f.params?.field ?? "?"}" was ignored.` },
    "screen-file-missing": { severity: "error", sentence: (f) => `${fileOf(f)} is listed in design.json but does not exist.` },
    "screen-unlisted": { severity: "warning", sentence: (f) => `${fileOf(f)} is not in design.json screens, so the wall does not show it.` },
    "screen-per-viewport": {
      severity: "warning",
      sentence: (f) => `${fileOf(f)} looks like a device copy of "${f.params?.base ?? "?"}". Use one responsive file per screen.`
    },
    "entry-missing": { severity: "error", sentence: () => "index.html is missing." },
    "ref-missing": { severity: "error", sentence: (f) => `${fileOf(f)} links to a file that does not exist.` },
    "ref-outside": { severity: "error", sentence: (f) => `${fileOf(f)} links to a file outside the design folder.` },
    "remote-ref": { severity: "error", sentence: (f) => `${fileOf(f)} loads a file from the internet, which the viewer blocks.` },
    "module-import": { severity: "warning", sentence: (f) => `${fileOf(f)} imports another script file, which can't load here.` },
    "doc-doctype": { severity: "warning", sentence: (f) => `${fileOf(f)} does not start with <!doctype html>.` },
    "doc-lang": { severity: "warning", sentence: (f) => `${fileOf(f)} has no lang on <html>.` },
    "doc-viewport": { severity: "warning", sentence: (f) => `${fileOf(f)} has no viewport meta tag.` },
    "doc-title": { severity: "warning", sentence: (f) => `${fileOf(f)} has no <title>.` },
    "doc-charset": { severity: "info", sentence: (f) => `${fileOf(f)} does not declare its charset.` },
    "token-redefined": {
      severity: "warning",
      sentence: (f) => f.params?.system !== void 0 ? `${fileOf(f)} redefines ${num(f.params?.count)} tokens from the design system ${f.params.system}. Use the system's values, or ask the user to change the system.` : `${fileOf(f)} redefines ${num(f.params?.count)} tokens from tokens.css. Change them in tokens.css.`
    },
    "token-hardcoded": {
      severity: "info",
      sentence: (f) => f.params?.system !== void 0 ? `${fileOf(f)} has ${num(f.params?.count)} hardcoded colours although the design system ${f.params.system} defines colours. Use its tokens.` : `${fileOf(f)} has ${num(f.params?.count)} hardcoded colours although tokens.css defines colours.`
    },
    "tweak-broken": {
      severity: "warning",
      sentence: (f) => {
        const field2 = f.params?.field ?? "?";
        if (f.params?.tweak === "missing") return `design.json: the tweak for ${field2} names a variable tokens.css does not define.`;
        if (f.params?.tweak === "formula") return `design.json: the tweak for ${field2} points at a formula in tokens.css (calc() or var()), so it can't be tuned.`;
        if (f.params?.tweak === "unit") return `design.json: the tweak for ${field2} uses a different unit than tokens.css.`;
        return "design.json declares tweaks, but the design has no tokens.css.";
      }
    },
    "check-partial": { severity: "info", sentence: () => "Some files were not checked in time." },
    // Phase 2.5 §10.1: a design against its linked system.
    "system-drift": {
      severity: "warning",
      // `part: 'system-files'` when the tokens couldn't be compared (the system no longer holds the
      // copy's original tokens.css) or other copy files changed: the files are counted instead.
      sentence: (f) => f.params?.part === "system-files" ? `This design's copy of ${systemNameOf(f)} was changed: ${num(f.params?.count)} ${f.params?.count === 1 ? "file differs" : "files differ"} from revision ${num(f.params?.revision)}. Put them back, or keep the changes in this design's own tokens.css.` : `This design's copy of ${systemNameOf(f)} was changed: ${num(f.params?.count)} tokens differ from revision ${num(f.params?.revision)}. Put them back, or keep them as this design's own overrides.`
    },
    "system-copy-missing": {
      severity: "warning",
      sentence: (f) => `This design's copy of ${systemNameOf(f)} is missing ${num(f.params?.count)} files.`
    },
    "system-copy-invalid": {
      severity: "warning",
      sentence: () => "system/COPY.json can't be read, so Design Chamber can't tell which system this design uses."
    },
    "system-choice": {
      severity: "warning",
      sentence: (f) => f.params?.choice === "draft" ? `design.json asks for the design system "${f.params?.value ?? "?"}", which isn't ready yet.` : `design.json asks for the design system "${f.params?.value ?? "?"}", which isn't a Ready system in this Designs folder.`
    },
    // Phase 2.5 §10.3: checking a system.
    "system-unreadable": {
      severity: "error",
      sentence: () => "Design Chamber can't read this design system. system.json isn't valid JSON."
    },
    "system-entry-invalid": {
      severity: "warning",
      sentence: () => "system.json has entries Design Chamber can't read."
    },
    "system-value-invalid": {
      severity: "error",
      sentence: () => "tokens.css holds a value that isn't valid for its section."
    },
    "system-font-missing": {
      severity: "error",
      sentence: (f) => `${fileOf(f)} is listed as a font but is missing or can't be used.`
    },
    "system-overview-empty": { severity: "warning", sentence: () => "The system has no overview yet." },
    "system-overview-long": {
      severity: "warning",
      sentence: () => "Keep the overview under 4 000 characters. Move detail into a note."
    },
    "system-note-long": {
      severity: "warning",
      sentence: () => "A note is over 20 000 characters. Shorten it or split it."
    },
    "system-example-remote": {
      severity: "error",
      sentence: (f) => `${fileOf(f)} loads files from the internet, which the living page can't use.`
    },
    "system-token-undefined": {
      severity: "warning",
      sentence: () => "A component names a token the system doesn't define."
    },
    "system-token-cap": {
      severity: "warning",
      sentence: () => "Design systems hold up to 2 000 tokens. The rest weren't read."
    },
    // Phase 2.5 §10.4: the repo-backed system (S8, with the rev 3 wording).
    "system-living-missing": {
      severity: "warning",
      sentence: (f) => `${systemNameOf(f)} lives in ${repoNameOf(f)} but has no living page yet.`
    },
    "system-living-stale": {
      severity: "warning",
      sentence: (f) => `The living page was generated from revision ${num(f.params?.from)}; ${systemNameOf(f)} is at revision ${num(f.params?.revision)}.`
    },
    "system-living-changed": {
      severity: "warning",
      sentence: () => "The living page in the repo differs from the one Design Chamber generated."
    },
    "system-living-unsafe": {
      severity: "error",
      sentence: () => "The living page has markup Design Chamber didn't generate and can't check as safe."
    },
    "system-living-failed": {
      severity: "warning",
      sentence: (f) => `Design Chamber couldn't generate the living page: ${LIVING_FAILED_REASONS[f.params?.failed ?? "too-large"]}`
    },
    "system-repo-unreadable": {
      severity: "error",
      sentence: (f) => `Design Chamber can't read ${repoNameOf(f)}'s design system folder. Choose another folder on the system page.`
    },
    "system-snapshot-changed": {
      severity: "warning",
      sentence: (f) => `${systemNameOf(f)}'s snapshot was changed outside Design Chamber. Re-sync to read ${repoNameOf(f)} again.`
    },
    "system-code-drift": {
      severity: "warning",
      sentence: (f) => driftScope(f, `${num(f.params?.count)} tokens differ from ${systemNameOf(f)}. Ask the agent to reconcile.`)
    },
    "system-code-differs": {
      severity: "warning",
      sentence: (f) => driftScope(f, `${num(f.params?.count)} tokens still differ from what ${systemNameOf(f)} describes.`)
    },
    "system-build-invalid": {
      severity: "warning",
      sentence: (f) => {
        const reason = f.params?.build;
        const sentence = reason !== void 0 ? BUILD_PROBLEM_SENTENCES[reason](f) : "Ask the agent to fix it.";
        return `BUILD.json can't be used: ${sentence}`;
      }
    },
    "system-coverage-empty": {
      severity: "warning",
      sentence: (f) => `${systemNameOf(f)} covers ${AREA_LABELS[f.params?.area ?? "foundations"]} but has nothing there yet.`
    },
    // Phase 2.5 rev 3 (§10.4).
    "system-living-reformatted": {
      severity: "info",
      sentence: () => "The living page may have been reformatted since it was generated. Its values are current."
    },
    "system-living-secret": {
      // Error unless the page is dev-only; `severityOf` reads the validated `access` param.
      severity: "error",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        const label = SECRET_KIND_LABELS[f.params?.kind ?? "aws-key"];
        const what = count === 1 ? `something shaped like a secret (${label})` : `${num(count)} things shaped like secrets (${label})`;
        return `The living page shows ${what}. Remove ${count === 1 ? "it" : "them"} from the system.`;
      }
    },
    "system-landed-differs": {
      severity: "warning",
      sentence: (f) => f.params?.part !== void 0 ? `The agent says it applied ${f.params.part}, but Design Chamber found none in ${repoNameOf(f)}.` : `What landed in ${repoNameOf(f)} differs from the proposal you approved in ${num(f.params?.count)} files.`
    },
    "system-proposal-invalid": {
      severity: "warning",
      sentence: (f) => {
        const reason = f.params?.proposal;
        if (reason === void 0 || reason === "unreadable" && f.detail !== void 0) return "PROPOSAL.json can't be used. Ask the agent to fix it.";
        return `PROPOSAL.json can't be used: ${PROPOSAL_PROBLEM_SENTENCES[reason]}`;
      }
    }
  };
  var CHECK_CODES = Object.freeze(Object.keys(RULES));

  // src/ui/model/format.ts
  var SECOND = 1e3;
  var MINUTE = 60 * SECOND;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;
  var plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

  // src/ui/model/checks-model.ts
  var issueCount = (summary) => summary.counts.errors + summary.counts.warnings;
  var verified = (summary) => {
    const { state } = summary.render;
    return state === "fresh" || state === "unavailable" || state === "none" && !summary.browser;
  };
  var badgeOf = (summary, error, running) => {
    if (summary === null) {
      if (error !== null) return { label: "Checks", tone: "neutral", ariaLabel: "Checks: didn\u2019t load", count: 0 };
      return { label: "Checking", tone: "neutral", ariaLabel: "Checks: Checking", count: 0 };
    }
    if (running || summary.render.state === "running") return { label: "Checking", tone: "neutral", ariaLabel: "Checks: Checking the rendering", count: 0 };
    const issues = issueCount(summary);
    if (issues > 0) {
      const label = plural(issues, "issue");
      return { label, tone: summary.counts.errors > 0 ? "error" : "warning", ariaLabel: `Checks: ${label}`, count: issues };
    }
    if (verified(summary)) return { label: "No issues", tone: "success", ariaLabel: "Checks: No issues", count: 0 };
    return { label: "No issues", tone: "neutral", ariaLabel: `Checks: No issues in the files. ${renderStatement(summary)}`, count: 0 };
  };
  var renderStatement = (summary) => summary.render.state === "stale" ? "Rendering was checked before your latest changes." : "Rendering hasn\u2019t been checked yet.";

  // src/ui/model/block-view-model.ts
  var answerText = (option) => clipText(`${option.letter}: ${option.label} (${option.slug})`, GUEST_BLOCK_ANSWER_MAX);
  var ANSWER_PREFIX = /^([A-D]): /;
  var answeredOption = (answered, count) => {
    if (answered === null) return null;
    const letter = ANSWER_PREFIX.exec(answered)?.[1];
    const index = letter === void 0 ? -1 : OPTION_LETTERS.indexOf(letter);
    return index >= 0 && index < count ? index : "note";
  };
  var BASE64 = /^[A-Za-z0-9+/=]+$/;
  var thumbSrc = (answer) => {
    if (answer.state !== "ready") return null;
    const png = answer.png;
    if (typeof png !== "string" || png.length === 0 || png.length > THUMB_DATA_TEXT_MAX || !BASE64.test(png)) return null;
    return `data:image/png;base64,${png}`;
  };
  var NOTES = {
    "not-ready": "Preview not ready yet",
    "no-chrome": "No preview without Chrome",
    failed: "The preview couldn\u2019t be made",
    missing: "Not found",
    error: "The preview didn\u2019t load"
  };
  var note = (reason) => ({ state: "note", reason, text: NOTES[reason] });
  var previewOf = (result, attempt) => {
    if ("error" in result) return note(isServiceError(result.error, "not-found") ? "missing" : "error");
    const { answer } = result;
    switch (answer.state) {
      case "ready": {
        const src = thumbSrc(answer);
        return src === null ? note("failed") : { state: "image", src };
      }
      case "pending": {
        const delay = THUMB_RETRY_DELAYS_MS[attempt - 1];
        return delay === void 0 ? note("not-ready") : { state: "waiting", retryInMs: delay };
      }
      case "unavailable":
        return note("no-chrome");
      case "failed":
        return note("failed");
    }
  };
  var listLine = (lead, names) => {
    const shown = names.slice(0, BLOCK_SCREENS_SHOWN).map((name) => clipText(name, BLOCK_SCREEN_TITLE_MAX));
    const more = names.length - shown.length;
    return `${lead}: ${[...shown, ...more > 0 ? [`+${more} more`] : []].join(", ")}`;
  };
  var cardView = (detail, checks) => {
    const { design } = detail;
    const title = clipText(design.title, BLOCK_TITLE_MAX);
    const canvas = design.kind === "canvas";
    const detailLine = canvas ? design.screens.length === 0 ? "No screens yet" : listLine("Screens", design.screens.map((screen) => screen.title)) : listLine("Viewports", design.viewports.map((viewport) => viewport.label));
    return {
      title: title === "" ? detail.slug : title,
      kind: design.kind,
      kindLabel: canvas ? "Canvas" : "Page",
      detailLine,
      badge: checks === null ? null : badgeOf(checks, null, false)
    };
  };
  var pickerView = (state, options) => {
    const answered = state.phase === "answered";
    const tiles = options.map(
      (_, index) => ({
        pressed: answered && state.picked === index,
        disabled: state.phase !== "open",
        dimmed: answered && state.picked !== null && state.picked !== index,
        busy: state.phase === "sending" && state.sending === index
      })
    );
    const pickedLetter = state.picked === null ? void 0 : options[state.picked]?.letter;
    const caption = state.phase === "open" ? "Pick one, or answer with a note below." : state.phase === "sending" ? "Sending your choice\u2026" : pickedLetter === void 0 ? "You answered with a note." : `You picked ${pickedLetter}.`;
    return { caption, tiles };
  };

  // src/ui/blocks/block-data.ts
  var readCard = async (client, slug) => {
    const checks = client.call("GET /designs/:slug/checks", { params: { slug } }).then(
      (answer) => ({ counts: answer.counts, render: { state: answer.render.state }, canRun: answer.canRun, browser: answer.browser }),
      () => null
    );
    try {
      const detail = await client.call("GET /designs/:slug", { params: { slug } });
      return { state: "ready", detail, checks: await checks };
    } catch (error) {
      if (isServiceError(error, "not-found")) return { state: "gone" };
      return { state: "error", paused: isServiceError(error, "DISABLED") };
    }
  };
  var createPicker = (answer, options, onChange) => {
    let current = { phase: "open", picked: null, sending: null };
    const phase = () => current.phase;
    const set = (next) => {
      current = next;
      onChange(next);
    };
    return {
      state: () => current,
      pick: async (index) => {
        const option = options[index];
        if (current.phase !== "open" || option === void 0) return "ignored";
        const sent = answer(answerText(option));
        set({ phase: "sending", picked: null, sending: index });
        try {
          await sent;
        } catch (error) {
          if (phase() === "sending") set({ phase: "open", picked: null, sending: null });
          return { error };
        }
        if (phase() === "sending") set({ phase: "answered", picked: index, sending: null });
        return "sent";
      },
      restore: (answered) => {
        const marked = answeredOption(answered, options.length);
        if (marked === null) return;
        set({ phase: "answered", picked: marked === "note" ? null : marked, sending: null });
      }
    };
  };

  // src/ui/blocks/preview.ts
  var mountPreview = (options) => {
    const el2 = h("div", { class: "dcb-preview", "data-state": "loading", "aria-hidden": "true" });
    let disposed = false;
    let timer = null;
    const showSpinner = () => {
      el2.dataset.state = "loading";
      const spot = h("span", { class: "dcb-preview-spin" });
      el2.replaceChildren(spot);
      mountSpinner(spot, { size: "sm" });
    };
    const show = (view2) => {
      if (view2.state === "waiting") return;
      if (view2.state === "image") {
        const img = h("img", { alt: "", draggable: "false", decoding: "async", src: view2.src });
        img.addEventListener("load", () => void (el2.dataset.state = "ready"), { once: true });
        img.addEventListener("error", () => show({ state: "note", reason: "failed", text: "The preview couldn\u2019t be made" }), { once: true });
        el2.replaceChildren(img);
        options.onView?.(view2);
        return;
      }
      el2.dataset.state = view2.reason === "missing" ? "missing" : "note";
      const glyph = view2.reason === "missing" ? "alert" : options.kind ?? "image";
      el2.replaceChildren(h("span", { class: "dcb-preview-note" }, icon2(glyph, 20), h("span", { class: "dcb-preview-text" }, view2.text)));
      options.onView?.(view2);
    };
    const read = (attempt) => {
      timer = null;
      options.client.thumbnail(options.slug).then(
        (answer) => settle(previewOf({ answer }, attempt), attempt),
        (error) => settle(previewOf({ error }, attempt), attempt)
      );
    };
    const settle = (view2, attempt) => {
      if (disposed) return;
      if (view2.state === "waiting") {
        timer = setTimeout(() => read(attempt + 1), view2.retryInMs);
        return;
      }
      show(view2);
    };
    showSpinner();
    options.onView?.(null);
    read(1);
    return {
      el: el2,
      dispose: () => {
        disposed = true;
        if (timer !== null) clearTimeout(timer);
        el2.remove();
      }
    };
  };

  // src/ui/blocks/design-card.ts
  var TONES = { success: "success", warning: "warning", error: "error", neutral: "neutral" };
  var GONE_TEXT = "This design is no longer in your Designs folder.";
  var mountDesignCard = (root2, ctx2, slug) => {
    let disposed = false;
    let preview = null;
    let generation = 0;
    const clear = () => {
      preview?.dispose();
      preview = null;
      root2.replaceChildren();
    };
    const showGone = () => {
      clear();
      root2.append(notice({ icon: "folder", text: GONE_TEXT, detail: "It may have been renamed or moved to the trash." }));
    };
    const showError = (paused) => {
      clear();
      root2.append(
        notice(
          paused ? { icon: "alert", text: "Design Chamber is paused.", detail: "Turn it back on in Settings \u2192 Extensions, then try again.", action: { label: "Try again", onClick: load } } : { icon: "alert", text: "Design Chamber isn\u2019t responding.", detail: "It may still be starting.", action: { label: "Try again", onClick: load } }
        )
      );
    };
    const showLoading = () => {
      clear();
      const spot = h("span", { class: "dcb-preview-spin" });
      root2.append(
        h(
          "article",
          { class: "dcb-block dcb-card", "data-state": "loading", "aria-busy": "true", "aria-label": "Loading design" },
          h("div", { class: "dcb-preview", "data-state": "loading", "aria-hidden": "true" }, spot),
          h(
            "div",
            { class: "dcb-card-body", "aria-hidden": "true" },
            h("span", { class: "dcb-skel", "data-size": "title" }),
            h("span", { class: "dcb-skel", "data-size": "line" }),
            h("span", { class: "dcb-skel", "data-size": "badge" }),
            h("span", { class: "dcb-skel-actions" }, h("span", { class: "dcb-skel", "data-size": "button" }), h("span", { class: "dcb-skel", "data-size": "button" }))
          )
        )
      );
      mountSpinner(spot, { size: "sm" });
    };
    const showReady = (read) => {
      clear();
      const view2 = cardView(read.detail, read.checks);
      preview = mountPreview({ client: ctx2.client, slug, kind: view2.kind });
      const titleId = `dcb-title-${slug}`;
      const badgeSlot = h("span", { class: "dcb-checks" });
      if (view2.badge) {
        const visible = h("span", { "aria-hidden": "true", title: view2.badge.ariaLabel });
        badgeSlot.append(visible, h("span", { class: "dcb-sr" }, view2.badge.ariaLabel));
        mountBadge(visible, { label: view2.badge.label, tone: TONES[view2.badge.tone] });
      }
      const openSlot = h("span", { class: "dcb-action" });
      const commentSlot = h("span", { class: "dcb-action" });
      const article = h(
        "article",
        { class: "dcb-block dcb-card", "data-state": "ready", "aria-labelledby": titleId },
        preview.el,
        h(
          "div",
          { class: "dcb-card-body" },
          h("div", { class: "dcb-card-head" }, h("h2", { class: "dcb-card-title", id: titleId, title: read.detail.design.title }, view2.title), h("span", { class: "dcb-kind" }, view2.kindLabel)),
          h("p", { class: "dcb-card-line" }, view2.detailLine),
          view2.badge ? badgeSlot : null,
          h("div", { class: "dcb-actions" }, openSlot, commentSlot)
        )
      );
      root2.append(article);
      let busy = false;
      const buttons = { open: null, comment: null };
      const open = async (intent) => {
        if (busy || disposed) return;
        busy = true;
        const mine = intent === "view" ? buttons.open : buttons.comment;
        const other = intent === "view" ? buttons.comment : buttons.open;
        mine?.update({ loading: true });
        other?.update({ disabled: true });
        try {
          const outcome = await openInRail({ client: ctx2.client, host: ctx2.host }, slug, intent);
          if (outcome === "gone") {
            showGone();
            return;
          }
          if (outcome === "not-here") ctx2.toast("info", "Open Design Chamber from the rail to see it.");
        } catch (error) {
          ctx2.toast("error", `Couldn\u2019t open the design. ${errorText2(error)}`);
        } finally {
          busy = false;
          mine?.update({ loading: false });
          other?.update({ disabled: false });
        }
      };
      buttons.open = mountButton(openSlot, { label: "Open", variant: "default", size: "sm", onClick: () => void open("view") });
      buttons.comment = mountButton(commentSlot, { label: "Comment", variant: "outline", size: "sm", onClick: () => void open("comment") });
      openSlot.querySelector("button")?.setAttribute("data-emphasis", "primary");
      openSlot.querySelector("button")?.setAttribute("aria-describedby", titleId);
      commentSlot.querySelector("button")?.setAttribute("aria-describedby", titleId);
    };
    function load() {
      const mine = ++generation;
      showLoading();
      void readCard(ctx2.client, slug).then((read) => {
        if (disposed || mine !== generation) return;
        if (read.state === "ready") showReady(read);
        else if (read.state === "gone") showGone();
        else showError(read.paused);
      });
    }
    load();
    return {
      update: () => void 0,
      dispose: () => {
        disposed = true;
        clear();
      }
    };
  };

  // src/ui/blocks/direction-pick.ts
  var REFUSED_TEXT = "Couldn\u2019t send your choice. Type it in the chat instead.";
  var mountDirectionPick = (root2, ctx2, question, options, answered) => {
    const previews = [];
    const tiles = [];
    const questionId = "dcb-question";
    const group = h("div", { class: "dcb-tiles", role: "group", "aria-labelledby": questionId, "data-count": options.length });
    group.style.setProperty("--dcb-count", String(options.length));
    const caption = h("p", { class: "dcb-caption", role: "status", "aria-live": "polite" });
    let focusIndex = 0;
    const nameOf = (option, tile) => `${option.letter}: ${option.label}${tile.missing ? ". Not found in your Designs folder" : ""}`;
    const paint = (state) => {
      const view2 = pickerView(state, options);
      caption.textContent = view2.caption;
      view2.tiles.forEach((tileView, index) => {
        const tile = tiles[index];
        if (!tile) return;
        tile.el.setAttribute("aria-pressed", String(tileView.pressed));
        tile.el.setAttribute("aria-disabled", String(tileView.disabled));
        tile.el.toggleAttribute("data-dimmed", tileView.dimmed);
        tile.el.setAttribute("aria-busy", String(tileView.busy));
        tile.spin.hidden = !tileView.busy;
        tile.mark.hidden = !tileView.pressed;
      });
      if (state.phase === "answered" && state.picked !== null) focusIndex = state.picked;
      tiles.forEach((tile, index) => tile.el.tabIndex = index === focusIndex ? 0 : -1);
    };
    const picker = createPicker((text) => ctx2.host.answerBlock(text), options, paint);
    const onPick = (index) => {
      void picker.pick(index).then((outcome) => {
        if (typeof outcome === "object") ctx2.toast("error", REFUSED_TEXT);
      });
    };
    const moveFocus = (index) => {
      const count = tiles.length;
      focusIndex = (index % count + count) % count;
      tiles.forEach((tile, i) => tile.el.tabIndex = i === focusIndex ? 0 : -1);
      tiles[focusIndex]?.el.focus();
    };
    options.forEach((option, index) => {
      const spin = h("span", { class: "dcb-tile-spin", hidden: true });
      mountSpinner(spin, { size: "sm" });
      const mark = h("span", { class: "dcb-tile-mark", hidden: true }, icon2("check", 14));
      const el2 = h("button", { type: "button", class: "dcb-tile", title: `${option.label} (${option.slug})` });
      const tile = { el: el2, spin, mark, missing: false };
      const preview = mountPreview({
        client: ctx2.client,
        slug: option.slug,
        kind: null,
        onView: (view2) => {
          tile.missing = view2?.state === "note" && view2.reason === "missing";
          el2.setAttribute("aria-label", nameOf(option, tile));
        }
      });
      previews.push(preview);
      el2.append(
        h("span", { class: "dcb-tile-preview" }, preview.el, mark),
        h("span", { class: "dcb-tile-head" }, h("span", { class: "dcb-letter", "aria-hidden": "true" }, option.letter), h("span", { class: "dcb-tile-label" }, option.label), spin)
      );
      el2.addEventListener("click", () => onPick(index));
      el2.addEventListener("focus", () => focusIndex = index);
      tiles.push(tile);
      group.append(el2);
    });
    group.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (step !== void 0) {
        event.preventDefault();
        moveFocus(focusIndex + step);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        moveFocus(event.key === "Home" ? 0 : tiles.length - 1);
      }
    });
    root2.replaceChildren(h("section", { class: "dcb-block dcb-pick", "aria-labelledby": questionId }, h("h2", { class: "dcb-question", id: questionId }, question), group, caption));
    paint(picker.state());
    picker.restore(answered);
    return {
      update: (next) => picker.restore(next),
      dispose: () => {
        for (const preview of previews) preview.dispose();
        root2.replaceChildren();
      }
    };
  };

  // src/ui/model/system-ask-model.ts
  var defaultPicks = (questions) => Object.fromEntries(questions.map((question) => [question.topic, question.options.filter((option) => option.recommended).map((option) => option.choice)]));
  var withPick = (picks, question, choice, on = true) => {
    if (!question.options.some((option) => option.choice === choice)) return picks;
    if (!question.multiple) return { ...picks, [question.topic]: [choice] };
    const now = picks[question.topic] ?? [];
    const next = question.options.map((option) => option.choice).filter((id) => id === choice ? on : now.includes(id));
    return { ...picks, [question.topic]: next };
  };
  var optionLabel = (question, choice) => question.options.find((option) => option.choice === choice)?.label ?? choice;
  var picksOf = (picks, question) => picks[question.topic] ?? [];
  var NO_PROJECT_LINE = "No project folder is open in this chat, so the system will live in Design Chamber and your code stays untouched.";
  var PROJECT_TOPICS = ["home", "mode"];
  var NO_PROJECT_PICKS = { home: ["internal"], mode: ["describe"] };
  var roundOneQuestions = (set, hasProject) => hasProject ? [...set.roundOne] : set.roundOne.filter((question) => !PROJECT_TOPICS.includes(question.topic));
  var WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  var coverageText = (question, chosen) => {
    const total = question.options.length;
    if (chosen.length === total) return `all ${WORDS[total] ?? String(total)} areas`;
    return chosen.length === 0 ? "no areas" : chosen.map((choice) => optionLabel(question, choice)).join(", ");
  };
  var darkText = (question, chosen) => {
    const choice = chosen[0];
    if (choice === "not-now") return "dark mode not now";
    if (choice === "include") return "dark values included";
    return choice === void 0 ? "dark mode not chosen" : optionLabel(question, choice);
  };
  var roundOneBlock = (questions, picks) => {
    const coverage = questions.find((question) => question.topic === "coverage");
    return coverage && picksOf(picks, coverage).length === 0 ? "Pick at least one area to cover." : null;
  };
  var resolveCalls = (calls, dropped, set) => {
    const shown = [];
    let lost = dropped;
    for (const call of calls) {
      const question = set.roundTwo.find((entry) => entry.topic === call.topic);
      if (!question || shown.length >= SYSTEM_ASK_CALLS_MAX) lost += 1;
      else shown.push({ question, why: call.why, proposed: call.proposed });
    }
    return { calls: shown, dropped: lost };
  };
  var roundTwoRead = (detail) => {
    if (detail === null) return { phase: "gone", name: null };
    const name = detail.name.trim() === "" ? null : detail.name;
    return { phase: detail.build !== null && detail.build.round === 2 ? "form" : "stale", name };
  };
  var roundTwoSub = (name) => name === null ? "Round 2 of 2" : `${clipText(name, 60)} \xB7 Round 2 of 2`;
  var droppedLine = (count) => count <= 0 ? null : count === 1 ? "1 question couldn\u2019t be shown; answer it in the chat." : `${count} questions couldn\u2019t be shown; answer them in the chat.`;
  var isCustom = (picks, question) => picksOf(picks, question).includes("custom");
  var CUSTOM_LINE = "Say what you want in the note below.";
  var FIELD = /^[a-z0-9_,-]+$/;
  var markerLine = (fields) => `[SystemAsk ${fields.filter(([key, value]) => FIELD.test(key) && FIELD.test(value)).map(([key, value]) => `${key}=${value}`).join(" ")}]`;
  var cleanNote = (note2) => note2.replace(/\r\n?/g, "\n").replace(/\[SystemAsk/gi, "(SystemAsk").trim();
  var composeAnswer = (sentence, marker, note2 = "") => {
    const words = cleanNote(note2);
    const head = `${sentence}
`;
    const room = GUEST_BLOCK_ANSWER_MAX - head.length - marker.length - 1 - "Note: ".length - 1;
    const kept = words === "" || room <= 0 ? "" : Array.from(words).slice(0, room).join("");
    return `${head}${kept === "" ? "" : `Note: ${kept}
`}${marker}`;
  };
  var csv = (values) => values.join(",");
  var withHome = (picks, hasProject) => hasProject ? picks : { ...picks, ...NO_PROJECT_PICKS };
  var roundOneAnswer = (ticket, set, picksNow, hasProject, note2) => {
    const picks = withHome(picksNow, hasProject);
    const parts = [];
    const fields = [["ticket", ticket], ["round", "1"]];
    for (const question of set.roundOne) {
      const chosen = picksOf(picks, question);
      fields.push([question.topic, csv(chosen)]);
      if (question.topic === "coverage") parts.push(coverageText(question, chosen));
      else if (question.topic === "dark") parts.push(darkText(question, chosen));
      else if (hasProject || !PROJECT_TOPICS.includes(question.topic)) parts.push(chosen.map((choice) => optionLabel(question, choice)).join(", "));
    }
    const lead = hasProject ? "" : "no project folder, so the system lives in Design Chamber; ";
    return composeAnswer(`Round one: ${lead}${parts.filter((part) => part !== "").join("; ")}.`, markerLine(fields), note2);
  };
  var roundTwoAnswer = (systemId, calls, picks, note2) => {
    const fields = [["system", systemId], ["round", "2"]];
    const parts = calls.map(({ question }) => {
      const chosen = picksOf(picks, question);
      fields.push([question.topic, csv(chosen)]);
      const text = chosen.map((choice) => optionLabel(question, choice)).join(", ");
      return `${question.label}: ${text}${chosen.includes("custom") ? " (see my note)" : ""}`;
    });
    return composeAnswer(`Round two: ${parts.join("; ")}.`, markerLine(fields), note2);
  };
  var PART_LABELS = {
    "system-files": "System files",
    "token-fixes": "Token fixes",
    docs: "Docs",
    "living-page": "Living page"
  };
  var MODE_LABEL = { fix: "Fix tokens, then document", describe: "Describe only" };
  var isCurrent = (view2) => view2 !== null && view2.state === "current";
  var proposalStateSentence = (view2) => {
    switch (view2.state) {
      case "current":
        return null;
      case "superseded":
        return "A newer proposal replaced this one.";
      case "rewritten":
        return "The files changed after this proposal was written. Ask the agent for a new one.";
      case "approved":
        return "This proposal was already approved.";
      case "declined":
        return "This proposal was already declined.";
      case "unknown":
        return "Design Chamber can\u2019t find this proposal. It may have been cleared.";
      case "unreadable":
        return view2.sentence;
    }
  };
  var partCountText = (part) => `${part.files.length} ${part.files.length === 1 ? "file" : "files"}`;
  var partStat = (part) => {
    const added = part.files.reduce((sum, file) => sum + file.added, 0);
    const removed = part.files.reduce((sum, file) => sum + file.removed, 0);
    return `${partCountText(part)} \xB7 +${added} \u2212${removed}`;
  };
  var partLabel = (name) => name in PART_LABELS ? PART_LABELS[name] : name;
  var CHANGE_WORD = { create: "Create", modify: "Change", delete: "Delete" };
  var fileRowText = (file) => `${file.path} \xB7 ${CHANGE_WORD[file.change]} \xB7 +${file.added} \u2212${file.removed}`;
  var patchView = (file) => {
    if (file.patch !== null && file.patch !== "") return { kind: "patch", text: file.patch };
    if (file.patchOmitted) return { kind: "sentence", text: "This patch was too long to show here. The file is in the proposal folder." };
    if (file.change === "create") return { kind: "sentence", text: "Created from the proposal. See the preview." };
    return { kind: "sentence", text: file.summary === "" ? "No patch was provided for this file." : file.summary };
  };
  var unlistedUses = (part) => {
    const unlisted = part.files.filter((file) => file.usages !== null && !file.usages.listed);
    if (unlisted.length === 0) return null;
    return { uses: unlisted.reduce((sum, file) => sum + (file.usages?.count ?? 0), 0), files: unlisted.length };
  };
  var usesLine = (uses) => `${uses.uses} ${uses.uses === 1 ? "use" : "uses"} in ${uses.files} ${uses.files === 1 ? "file" : "files"}. Listed in the chat.`;
  var listedFiles = (part) => part.files.filter((file) => file.usages === null || file.usages.listed);
  var previewButtons = (view2) => {
    const { preview, proposal } = view2;
    const repo = proposal.home.kind === "repo";
    const page = preview.livingPage;
    return {
      livingPage: { shown: repo && page !== "none", enabled: page === "ready" },
      board: { shown: preview.board, enabled: preview.board },
      sentence: page === "generating" ? preview.sentence ?? "Design Chamber is drawing the preview\u2026" : page === "failed" ? preview.sentence ?? "The preview couldn\u2019t be drawn." : preview.sentence
    };
  };
  var selectedParts = (view2, on) => view2.proposal.parts.filter((part) => on.has(part.name)).map((part) => part.name);
  var SHA16 = /^[0-9a-f]{16}$/;
  var approveView = (view2, on, askedId, busy = false) => {
    if (view2 === null) return { enabled: false, label: "Approve", reason: LOADING_PROPOSAL };
    if (!isCurrent(view2)) return { enabled: false, label: "Approve", reason: proposalStateSentence(view2) };
    const total = view2.proposal.parts.length;
    const count = selectedParts(view2, on).length;
    const label = total <= 1 ? "Approve" : count === total ? `Approve all ${total} parts` : `Approve ${count} of ${total} parts`;
    if (view2.proposal.id !== askedId) return { enabled: false, label, reason: "Design Chamber showed a different proposal than this card names. Ask the agent for a new one." };
    if (!SHA16.test(view2.sha16)) return { enabled: false, label, reason: "Design Chamber couldn\u2019t check this proposal against its files. Ask the agent for a new one." };
    if (view2.proposal.problems.length > 0) return { enabled: false, label, reason: "This proposal has problems, so it can\u2019t be approved. Ask the agent to fix them." };
    if (total === 0) return { enabled: false, label, reason: "This proposal has nothing in it to approve." };
    if (count === 0) return { enabled: false, label, reason: "Turn on at least one part to approve." };
    return { enabled: !busy, label, reason: null };
  };
  var approveAnswer = (systemId, view2, on) => {
    const names = view2.proposal.parts.map((part) => part.name);
    const chosen = names.filter((name) => on.has(name));
    const skipped = names.filter((name) => !on.has(name));
    const lower = (list) => list.map((name) => partLabel(name).toLowerCase()).join(", ");
    const sentence = `Approve proposal ${view2.proposal.id}: ${lower(chosen)}${skipped.length > 0 ? `; not ${lower(skipped)}` : ""}.`;
    const fields = [["system", systemId], ["approve", view2.proposal.id], ["sha", view2.sha16], ["parts", csv(chosen)]];
    if (skipped.length > 0) fields.push(["skipped", csv(skipped)]);
    return composeAnswer(sentence, markerLine(fields));
  };
  var describeAnswer = (systemId, proposalId) => composeAnswer(`Decline proposal ${proposalId}. Describe only instead.`, markerLine([["system", systemId], ["decline", proposalId], ["then", "describe"]]));
  var stopAnswer = (systemId, name, proposalId) => composeAnswer(`Stop building ${clipText(name, 60)}. Design Chamber removed the draft.`, markerLine([["system", systemId], ["decline", proposalId], ["then", "stop"]]));
  var UNDO_SLACK_MS = 50;
  var undoWindow = (until, now) => Number.isFinite(until) && now < until ? { open: true, repaintIn: until - now + UNDO_SLACK_MS } : { open: false, repaintIn: 0 };
  var describeOffered = (view2) => isCurrent(view2) && view2.proposal.mode === "fix";
  var systemName = (detailName, systemId) => detailName !== null && detailName.trim() !== "" ? detailName : systemId;
  var diffTitle = (view2) => {
    const { home, mode } = view2.proposal;
    return {
      target: home.kind === "repo" ? `Proposed changes to ${home.label}` : "Proposed changes in Design Chamber",
      mode: mode === "none" ? null : MODE_LABEL[mode]
    };
  };
  var parseMarker = (text) => {
    if (text === null) return null;
    const found = [...text.matchAll(/\[SystemAsk ([^\]\n]*)\]/g)].at(-1);
    if (!found) return null;
    const fields = {};
    for (const entry of (found[1] ?? "").split(" ")) {
      const at = entry.indexOf("=");
      if (at <= 0) continue;
      const key = entry.slice(0, at);
      const value = entry.slice(at + 1);
      if (FIELD.test(key) && FIELD.test(value)) fields[key] = value;
    }
    return Object.keys(fields).length === 0 ? null : fields;
  };
  var PART_NAMES = Object.keys(PART_LABELS);
  var split = (value) => value === void 0 || value === "" ? [] : value.split(",");
  var answeredView = (answered, set) => {
    const fields = parseMarker(answered);
    const base = { kind: "other", headline: "You answered in the chat:", lines: [], verbatim: clipText(answered, 400), picks: {}, parts: [] };
    if (fields === null) return base;
    const approve = fields.approve;
    const decline = fields.decline;
    if (approve !== void 0) {
      const parts = split(fields.parts).filter((name) => PART_NAMES.includes(name));
      const skipped = split(fields.skipped).filter((name) => PART_NAMES.includes(name));
      const count = parts.length;
      return {
        ...base,
        kind: "approve",
        headline: skipped.length === 0 && count > 1 ? `You approved all ${count} parts of proposal ${approve}.` : `You approved ${count} ${count === 1 ? "part" : "parts"} of proposal ${approve}.`,
        lines: skipped.length === 0 ? [] : [`Skipped: ${skipped.map(partLabel).join(", ")}.`],
        verbatim: null,
        parts
      };
    }
    if (decline !== void 0) {
      return fields.then === "stop" ? { ...base, kind: "stop", headline: "You stopped this build.", verbatim: null } : { ...base, kind: "describe", headline: `You declined proposal ${decline}: describe only instead.`, verbatim: null };
    }
    if (fields.round === "1" || fields.round === "2") {
      const questions = fields.round === "1" ? set.roundOne : set.roundTwo;
      const picks = {};
      const lines = [];
      for (const question of questions) {
        if (fields[question.topic] === void 0) continue;
        const chosen = split(fields[question.topic]);
        picks[question.topic] = chosen;
        lines.push(chosen.map((choice) => optionLabel(question, choice)).join(", "));
      }
      return {
        ...base,
        kind: fields.round === "1" ? "round-1" : "round-2",
        headline: fields.round === "1" ? "You answered round one." : "You answered round two.",
        lines: lines.filter((line) => line !== ""),
        verbatim: null,
        picks
      };
    }
    return base;
  };
  var LOADING_PROPOSAL = "Loading the proposal\u2026";
  var SERVICE_DOWN = "Design Chamber isn\u2019t running. Open it from the rail, then try again.";
  var REFUSED_ANSWER = "Couldn\u2019t send your answer. Type it in the chat instead.";
  var HOST_CANNOT_TAKE = "Reply in the chat to answer.";
  var SYSTEM_GONE = "This design system is no longer in your Designs folder. Reply in the chat if the agent still needs something.";
  var OUT_OF_DATE = "This question is out of date. Reply in the chat if the agent still needs something.";
  var TICKET_EXPIRED = "This build has expired. Run /design-system again to start over.";

  // src/ui/blocks/system-ask-shared.ts
  var counter = 0;
  var uid = (prefix) => `${prefix}${counter += 1}`;
  var frame = (options) => {
    const titleId = uid("dcb-ask-title");
    const body = h("div", { class: "dcb-ask-body" });
    const foot = options.foot ? h("footer", { class: "dcb-ask-foot" }) : null;
    const el2 = h(
      "section",
      { class: "dcb-block dcb-ask", "aria-labelledby": titleId },
      h(
        "header",
        { class: "dcb-ask-head" },
        h("span", { class: "dcb-ask-icon" }, icon2(options.icon, 16)),
        h("div", { class: "dcb-ask-titles" }, h("h2", { class: "dcb-ask-title", id: titleId }, options.title), options.sub ? h("p", { class: "dcb-ask-sub" }, options.sub) : null),
        options.side ? h("span", { class: "dcb-ask-side" }, options.side) : null
      ),
      body,
      foot
    );
    return { el: el2, body, foot };
  };
  var sendAnswer = (ctx2, text) => ctx2.host.answerBlock(text).then(
    () => "sent",
    (error) => isHostError(error, "HOST_REJECTED") ? "host-rejected" : "refused"
  );
  var refusedLine = () => h("p", { class: "dcb-ask-problem", role: "alert" }, REFUSED_ANSWER);
  var cannotTake = (ctx2, text) => {
    const slot = h("span", { class: "dcb-ask-btn" });
    let handle = null;
    const status = h("p", { class: "dcb-ask-reason", role: "status" }, HOST_CANNOT_TAKE);
    handle = mountButton(slot, {
      label: "Copy my answer",
      variant: "outline",
      size: "sm",
      onClick: () => {
        ctx2.host.writeClipboard(text).then(
          () => ctx2.toast("success", "Copied. Paste it in the chat."),
          () => ctx2.toast("error", "Couldn\u2019t copy. Select the answer and copy it yourself.")
        );
      }
    });
    return { el: h("div", { class: "dcb-ask-cannot" }, status, slot), dispose: () => handle?.dispose() };
  };
  var startRefetch = (tick, ms) => {
    let busy = false;
    const run = () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      tick().catch((error) => console.warn("Design Chamber: refetch failed", error)).finally(() => {
        busy = false;
      });
    };
    const timer = setInterval(run, ms);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  };
  var primaryOf = (slot) => {
    const button2 = slot.querySelector("button");
    button2?.setAttribute("data-emphasis", "primary");
    return button2;
  };

  // src/ui/blocks/system-ask-diff.ts
  var UNDO_LINE = "Design Chamber brought the build back. Tell the agent to carry on.";
  var mountDiff = (root2, ctx2, ask, set, answered) => {
    let load = answered === null ? "loading" : "ready";
    let view2 = null;
    let viewKey = "";
    let name = null;
    let nameTried = false;
    let on = /* @__PURE__ */ new Set();
    let partsKnown = false;
    const open = /* @__PURE__ */ new Set();
    let declining = false;
    let busy = false;
    let refused = false;
    let stopError = null;
    let cannot = null;
    let answeredText = answered;
    let stoppedText = null;
    let undo = null;
    let undone = false;
    let undoing = false;
    let undoButton = null;
    let undoTimer = null;
    let owned = [];
    let footOwned = [];
    let footEl = null;
    let bodyEl = null;
    let stopRefetch = null;
    let disposed = false;
    const title = () => systemName(name, ask.systemId);
    const current = () => isCurrent(view2) ? view2 : null;
    const slotButton = (label, variant, onClick, state = {}) => {
      const slot = h("span", { class: "dcb-ask-btn" });
      const handle = mountButton(slot, { label, variant, size: "default", disabled: state.disabled === true, loading: state.loading === true, onClick });
      footOwned.push(handle);
      if (state.primary) primaryOf(slot);
      return slot;
    };
    const submit = (text) => {
      if (busy || cannot !== null || answeredText !== null) return;
      const sent = sendAnswer(ctx2, text);
      busy = true;
      refused = false;
      paintFoot();
      void sent.then((outcome) => {
        busy = false;
        if (outcome === "sent") {
          answeredText = text;
          stopRefetch?.();
          stopRefetch = null;
          renderAll();
        } else if (outcome === "host-rejected") {
          cannot = text;
          renderAll();
        } else {
          refused = true;
          paintFoot();
        }
      });
    };
    const stop = async (proposal) => {
      if (busy || cannot !== null || answeredText !== null) return;
      busy = true;
      stopError = null;
      refused = false;
      paintFoot();
      try {
        const result = await ctx2.client.stopBuild(ask.systemId, proposal.proposal.id);
        undo = { id: result.undoId, until: Date.parse(result.until) };
        scheduleUndoExpiry();
      } catch (error) {
        busy = false;
        stopError = isServiceError(error, "conflict") ? error.message : "Couldn\u2019t stop the build. Try again, or tell the agent in the chat.";
        paintFoot();
        return;
      }
      const text = stopAnswer(ask.systemId, title(), proposal.proposal.id);
      const outcome = await sendAnswer(ctx2, text);
      busy = false;
      stopRefetch?.();
      stopRefetch = null;
      if (outcome === "sent") answeredText = text;
      else stoppedText = text;
      renderAll();
    };
    const clearUndoTimer = () => {
      if (undoTimer !== null) clearTimeout(undoTimer);
      undoTimer = null;
    };
    const scheduleUndoExpiry = () => {
      clearUndoTimer();
      if (undo === null || undone) return;
      const offer = undoWindow(undo.until, Date.now());
      if (!offer.open) return;
      undoTimer = setTimeout(() => {
        undoTimer = null;
        renderAll();
      }, offer.repaintIn);
    };
    const undoStop = () => {
      const pending = undo;
      if (pending === null || undone || undoing) return;
      undoing = true;
      undoButton?.update({ disabled: true, loading: true });
      ctx2.client.undoStop(pending.id).then(
        () => {
          undoing = false;
          undone = true;
          clearUndoTimer();
          renderAll();
        },
        () => {
          undoing = false;
          undoButton?.update({ disabled: false, loading: false });
          ctx2.toast("error", "Couldn\u2019t bring the build back. It may have been too long.");
        }
      );
    };
    const paintFoot = () => {
      if (!footEl) return;
      for (const handle of footOwned) handle.dispose();
      footOwned = [];
      const proposal = current();
      const approve = approveView(view2, on, ask.proposalId, busy);
      const reason = proposal === null ? null : approve.reason;
      if (cannot !== null) {
        const fallback = cannotTake(ctx2, cannot);
        footOwned.push(fallback);
        footEl.replaceChildren(fallback.el);
        return;
      }
      const lines = [
        reason !== null && !declining ? h("p", { class: "dcb-ask-reason", role: "status" }, reason) : null,
        stopError !== null ? h("p", { class: "dcb-ask-problem", role: "alert" }, stopError) : null,
        refused ? refusedLine() : null
      ];
      const actions = declining && proposal !== null ? [
        describeOffered(proposal) ? slotButton("Describe only instead", "outline", () => submit(describeAnswer(ask.systemId, proposal.proposal.id)), { disabled: busy }) : null,
        slotButton("Stop", "destructive", () => void stop(proposal), { disabled: busy }),
        slotButton("Back", "outline", () => {
          declining = false;
          stopError = null;
          paintFoot();
          footEl?.querySelector("button")?.focus();
        }, { disabled: busy })
      ] : [
        slotButton("Decline", "outline", () => {
          declining = true;
          refused = false;
          paintFoot();
          footEl?.querySelector("button")?.focus();
        }, { disabled: proposal === null || busy }),
        slotButton(approve.label, "default", () => {
          const now = current();
          if (now !== null && approveView(now, on, ask.proposalId).enabled) submit(approveAnswer(ask.systemId, now, on));
        }, { disabled: !approve.enabled, loading: busy && !declining, primary: true })
      ];
      footEl.replaceChildren(...lines.filter((line) => line !== null), h("div", { class: "dcb-ask-actions" }, ...actions.filter((el2) => el2 !== null)));
    };
    const own = (handle) => {
      owned.push(handle);
      return handle;
    };
    const banner = (tone2, text, action) => {
      const slot = h("div", { class: "dcb-ask-banner" });
      own(mountBanner(slot, { tone: tone2, title: text, action }));
      return slot;
    };
    const partBlock = (proposal, index) => {
      const part = proposal.proposal.parts[index];
      if (!part) return h("div");
      const switchSlot = h("div", { class: "dcb-part-switch" });
      const handle = own(
        mountSwitch(switchSlot, {
          label: PART_LABELS[part.name],
          description: partStat(part),
          checked: on.has(part.name),
          disabled: cannot !== null,
          onChange: (checked) => {
            if (checked) on.add(part.name);
            else on.delete(part.name);
            handle.update({ checked });
            paintFoot();
          }
        })
      );
      const list = h("ul", { class: "dcb-files" });
      for (const file of listedFiles(part)) {
        const patchId = uid("dcb-patch");
        const patch = patchView(file);
        const panel = h("div", { class: "dcb-patch", id: patchId, hidden: !open.has(`${part.name}:${file.path}`) }, patch.kind === "patch" ? h("pre", { class: "dcb-patch-code", tabindex: 0 }, patch.text) : h("p", { class: "dcb-patch-note" }, patch.text));
        const button2 = h(
          "button",
          { type: "button", class: "dcb-file", "aria-expanded": String(!panel.hidden), "aria-controls": patchId },
          h("span", { class: "dcb-file-chev" }, icon2("chevron", 14)),
          h("span", { class: "dcb-file-text" }, fileRowText(file))
        );
        button2.addEventListener("click", () => {
          const key = `${part.name}:${file.path}`;
          if (open.has(key)) open.delete(key);
          else open.add(key);
          panel.hidden = !open.has(key);
          button2.setAttribute("aria-expanded", String(open.has(key)));
        });
        list.append(h("li", { class: "dcb-file-item" }, button2, panel));
      }
      const uses = unlistedUses(part);
      if (uses) list.append(h("li", { class: "dcb-uses" }, usesLine(uses)));
      return h("div", { class: "dcb-part" }, switchSlot, list.childElementCount > 0 ? list : null);
    };
    const previewRow = (proposal) => {
      const buttons = previewButtons(proposal);
      if (!buttons.livingPage.shown && !buttons.board.shown && buttons.sentence === null) return null;
      const row = h("div", { class: "dcb-preview-row" });
      const add = (label, which, enabled) => {
        const slot = h("span", { class: "dcb-ask-btn" });
        own(
          mountButton(slot, {
            label,
            variant: "outline",
            size: "sm",
            disabled: !enabled,
            onClick: () => {
              ctx2.openSystemPreview(ask.systemId, which).then(
                (outcome) => {
                  if (outcome === "opened") ctx2.toast("info", which === "living-page-preview" ? "The living page preview is open in the rail." : "The board is open in the rail.");
                  else if (outcome === "gone") ctx2.toast("error", "This design system is no longer in your Designs folder.");
                  else ctx2.toast("error", "Open Design Chamber from the rail to see the preview.");
                },
                () => ctx2.toast("error", "Couldn\u2019t open the preview. Open Design Chamber from the rail.")
              );
            }
          })
        );
        row.append(slot);
      };
      if (buttons.livingPage.shown) add("Preview living page", "living-page-preview", buttons.livingPage.enabled);
      if (buttons.board.shown) add("Open the board", "board-preview", buttons.board.enabled);
      return h("div", { class: "dcb-preview-wrap" }, row, buttons.sentence === null ? null : h("p", { class: "dcb-ask-fact", role: "status" }, buttons.sentence));
    };
    const proposalBody = (body, proposal) => {
      const { proposal: p } = proposal;
      const mode = diffTitle(proposal).mode;
      append(
        body,
        p.summary === "" ? null : h("p", { class: "dcb-ask-summary" }, p.summary),
        h("dl", { class: "dcb-meta" }, mode === null ? null : h("dt", null, "Mode"), mode === null ? null : h("dd", null, mode), h("dt", null, "Way back"), h("dd", null, p.wayBack.text))
      );
      if (p.problems.length > 0) {
        const list = h("ul", { class: "dcb-problems" }, ...p.problems.map((problem) => h("li", null, problem)));
        body.append(h("div", { class: "dcb-ask-banner" }, banner("warning", "This proposal has problems."), list));
      }
      body.append(h("div", { class: "dcb-parts" }, ...p.parts.map((_, index) => partBlock(proposal, index))));
      const previews = previewRow(proposal);
      if (previews) body.append(previews);
    };
    const answeredBody = (body, text) => {
      const done = answeredView(text, set);
      body.append(h("p", { class: "dcb-ask-done" }, icon2("check", 16), done.headline));
      if (done.verbatim !== null) body.append(h("p", { class: "dcb-ask-quote" }, done.verbatim));
      for (const line of done.lines) body.append(h("p", { class: "dcb-ask-fact" }, line));
      if (done.kind === "stop") undoBody(body);
    };
    const undoBody = (body) => {
      if (undone) {
        body.append(h("p", { class: "dcb-ask-fact", role: "status" }, UNDO_LINE));
        return;
      }
      if (undo === null || !undoWindow(undo.until, Date.now()).open) return;
      const slot = h("span", { class: "dcb-ask-btn" });
      undoButton = own(mountButton(slot, { label: "Undo", variant: "outline", size: "sm", disabled: undoing, loading: undoing, onClick: undoStop }));
      body.append(h("div", { class: "dcb-ask-actions" }, slot));
    };
    const stoppedBody = (body, text) => {
      body.append(h("p", { class: "dcb-ask-done" }, icon2("check", 16), "You stopped this build."));
      body.append(h("p", { class: "dcb-ask-fact" }, "Design Chamber removed the draft, but the chat did not take the message."));
      const fallback = cannotTake(ctx2, text);
      own(fallback);
      body.append(fallback.el);
      undoBody(body);
    };
    const loadingBody = (body) => {
      const row = h("p", { class: "dcb-ask-loading", role: "status" });
      const spin = h("span", { class: "dcb-ask-spin" });
      mountSpinner(spin, { size: "sm" });
      row.append(spin, LOADING_PROPOSAL);
      body.append(row);
    };
    const renderAll = () => {
      if (disposed) return;
      const scroll = bodyEl?.scrollTop ?? 0;
      for (const handle of owned) handle.dispose();
      for (const handle of footOwned) handle.dispose();
      owned = [];
      footOwned = [];
      undoButton = null;
      const proposal = current();
      const settled = answeredText !== null || stoppedText !== null;
      const head = proposal ? diffTitle(proposal) : { target: "Proposed changes", mode: null };
      const f = frame({
        icon: "layers",
        title: settled ? "Proposed changes" : head.target,
        sub: title(),
        side: ask.proposalId,
        foot: !settled && load === "ready" && proposal !== null
      });
      bodyEl = f.body;
      footEl = f.foot;
      if (answeredText !== null) answeredBody(f.body, answeredText);
      else if (stoppedText !== null) stoppedBody(f.body, stoppedText);
      else if (load === "loading") loadingBody(f.body);
      else if (load === "down") f.body.append(banner("warning", SERVICE_DOWN, { label: "Try again", onClick: () => void readProposal(true) }));
      else if (proposal) proposalBody(f.body, proposal);
      else if (view2 !== null) f.body.append(banner("info", proposalStateSentence(view2) ?? ""));
      root2.replaceChildren(f.el);
      f.body.scrollTop = scroll;
      paintFoot();
    };
    const readProposal = async (retry = false) => {
      if (answeredText !== null || stoppedText !== null || busy) return;
      if (retry && load === "down") {
        load = "loading";
        renderAll();
      }
      try {
        const [next, detail] = await Promise.all([
          ctx2.client.getProposal(ask.systemId, ask.proposalId),
          nameTried ? Promise.resolve(name) : ctx2.client.call("GET /systems/:id", { params: { id: ask.systemId } }).then((system) => system.name, () => null)
        ]);
        if (answeredText !== null || stoppedText !== null || busy || disposed) return;
        const key = JSON.stringify(next);
        const changedName = detail !== name;
        name = detail;
        nameTried = true;
        if (next.state === "current" && !partsKnown) {
          on = new Set(next.proposal.parts.map((part) => part.name));
          partsKnown = true;
        }
        if (load === "ready" && key === viewKey && !changedName) return;
        load = "ready";
        view2 = next;
        viewKey = key;
        renderAll();
      } catch (error) {
        if (isServiceError(error, "not-found")) {
          if (answeredText !== null || stoppedText !== null || busy || disposed) return;
          const gone = { state: "unknown" };
          const goneKey = JSON.stringify(gone);
          if (load === "ready" && viewKey === goneKey) return;
          load = "ready";
          view2 = gone;
          viewKey = goneKey;
          declining = false;
          stopError = null;
          renderAll();
          return;
        }
        if (load === "ready" && view2 !== null) return;
        if (!isServiceError(error)) console.warn("Design Chamber: reading the proposal failed", error);
        if (load === "down") return;
        load = "down";
        renderAll();
      }
    };
    renderAll();
    if (answered === null) {
      void readProposal();
      stopRefetch = startRefetch(() => readProposal(), SYSTEM_ASK_POLL_MS);
    }
    return {
      update: (next) => {
        if (next === null || next === answeredText) return;
        answeredText = next;
        cannot = null;
        stopRefetch?.();
        stopRefetch = null;
        renderAll();
      },
      dispose: () => {
        disposed = true;
        clearUndoTimer();
        stopRefetch?.();
        for (const handle of owned) handle.dispose();
        for (const handle of footOwned) handle.dispose();
        owned = [];
        footOwned = [];
        root2.replaceChildren();
      }
    };
  };

  // src/ui/blocks/system-ask-interview.ts
  var NOTHING_TO_ANSWER = "There is nothing to answer here. Reply in the chat.";
  var mountInterview = (root2, ctx2, ask, set, answered) => {
    const roundOne = ask.kind === "interview-1";
    const two = ask.kind === "interview-2" ? resolveCalls(ask.calls, ask.dropped, set) : null;
    const blockId = uid("dcb-i");
    let phase = "loading";
    let systemNameNow = null;
    let disposed = false;
    let hasProject = true;
    let picks = defaultPicks(roundOne ? set.roundOne : (two?.calls ?? []).map((call) => call.question));
    let note2 = "";
    let sending = false;
    let refused = false;
    let cannot = null;
    let answeredText = answered;
    let owned = [];
    let stopRefetch = null;
    let goHandle = null;
    let reasonEl = null;
    let refusedEl = null;
    let inputs = [];
    let customLines = [];
    let noteField = null;
    const shown = () => roundOne ? roundOneQuestions(set, hasProject) : (two?.calls ?? []).map((call) => call.question);
    const own = (handle) => {
      owned.push(handle);
      return handle;
    };
    const paint = () => {
      const reason = roundOne ? roundOneBlock(shown(), picks) : null;
      goHandle?.update({ disabled: reason !== null || sending, loading: sending });
      if (reasonEl) {
        reasonEl.textContent = reason ?? "";
        reasonEl.hidden = reason === null;
      }
      if (refusedEl) refusedEl.hidden = !refused;
      for (const input of inputs) input.disabled = sending || cannot !== null;
      noteField?.update({ disabled: sending || cannot !== null });
      for (const line of customLines) line.el.hidden = !isCustom(picks, line.question);
    };
    const questionBlock = (question, call) => {
      const labelId = uid(`${blockId}-q`);
      const group = h(
        "div",
        { class: "dcb-q", role: question.multiple ? "group" : "radiogroup", "aria-labelledby": labelId },
        h("p", { class: "dcb-q-label", id: labelId }, question.label)
      );
      if (call && (call.why !== "" || call.proposed !== "")) {
        group.append(
          h(
            "div",
            { class: "dcb-q-agent" },
            call.why === "" ? null : h("p", null, h("span", { class: "dcb-q-agent-k" }, "From the agent: "), call.why),
            call.proposed === "" ? null : h("p", null, h("span", { class: "dcb-q-agent-k" }, "Proposed: "), call.proposed)
          )
        );
      }
      const name = `${blockId}-${question.topic}`;
      for (const option of question.options) {
        const input = h("input", { class: "dcb-opt-input", type: question.multiple ? "checkbox" : "radio", name, value: option.choice });
        input.checked = (picks[question.topic] ?? []).includes(option.choice);
        input.addEventListener("change", () => {
          picks = withPick(picks, question, option.choice, question.multiple ? input.checked : true);
          paint();
        });
        inputs.push(input);
        group.append(
          h(
            "label",
            { class: "dcb-opt" },
            input,
            h(
              "span",
              { class: "dcb-opt-text" },
              h("span", { class: "dcb-opt-name", "data-recommended": option.recommended ? "" : null }, option.label, option.recommended ? h("span", { class: "dcb-sr" }, " (recommended)") : null),
              option.why === "" ? null : h("span", { class: "dcb-opt-why" }, option.why)
            )
          )
        );
      }
      if (question.options.some((option) => option.choice === "custom")) {
        const line = h("p", { class: "dcb-q-custom", role: "status" }, CUSTOM_LINE);
        customLines.push({ el: line, question });
        group.append(line);
      }
      return group;
    };
    const go = () => {
      const reason = roundOne ? roundOneBlock(shown(), picks) : null;
      if (sending || reason !== null || cannot !== null || answeredText !== null) return;
      const text = roundOne ? roundOneAnswer(ask.ticket, set, picks, hasProject, note2) : roundTwoAnswer(ask.systemId, two?.calls ?? [], picks, note2);
      const sent = sendAnswer(ctx2, text);
      sending = true;
      refused = false;
      paint();
      void sent.then((outcome) => {
        sending = false;
        if (outcome === "sent") {
          if (answeredText === null) answeredText = text;
          stopRefetch?.();
          stopRefetch = null;
          render();
        } else if (outcome === "host-rejected") {
          cannot = text;
          render();
        } else {
          refused = true;
          paint();
        }
      });
    };
    const formBody = (body, foot) => {
      inputs = [];
      customLines = [];
      const calls = two?.calls ?? [];
      const dropped = two ? droppedLine(two.dropped) : null;
      if (!roundOne && calls.length === 0) {
        body.append(h("p", { class: "dcb-ask-fact" }, dropped ?? NOTHING_TO_ANSWER));
        foot.remove();
        return;
      }
      if (dropped) body.append(h("p", { class: "dcb-ask-fact" }, icon2("alert", 14), dropped));
      if (roundOne && !hasProject) body.append(h("p", { class: "dcb-ask-fact" }, icon2("folder", 14), NO_PROJECT_LINE));
      if (roundOne) for (const question of shown()) body.append(questionBlock(question, null));
      else for (const call of calls) body.append(questionBlock(call.question, call));
      const noteSlot = h("div", { class: "dcb-ask-note" });
      body.append(noteSlot);
      noteField = own(
        mountTextField(noteSlot, {
          label: "Add a note (optional)",
          value: note2,
          multiline: true,
          rows: 2,
          placeholder: "Anything the agent should know",
          onChange: (value) => {
            note2 = value;
          }
        })
      );
      reasonEl = h("p", { class: "dcb-ask-reason", role: "status" });
      refusedEl = refusedLine();
      refusedEl.hidden = true;
      if (cannot !== null) {
        const fallback = cannotTake(ctx2, cannot);
        own(fallback);
        foot.append(fallback.el);
        return;
      }
      const slot = h("span", { class: "dcb-ask-btn" });
      goHandle = own(mountButton(slot, { label: "Go with these", variant: "default", size: "default", onClick: go }));
      primaryOf(slot);
      foot.append(reasonEl, refusedEl, h("div", { class: "dcb-ask-actions" }, slot));
    };
    const answeredBody = (body, text) => {
      const view2 = answeredView(text, set);
      body.append(h("p", { class: "dcb-ask-done" }, icon2("check", 16), view2.headline));
      if (view2.verbatim !== null) {
        body.append(h("p", { class: "dcb-ask-quote" }, view2.verbatim));
        return;
      }
      const list = h("dl", { class: "dcb-ask-picks" });
      const questions = view2.kind === "round-1" ? set.roundOne : set.roundTwo;
      for (const question of questions) {
        const chosen = view2.picks[question.topic];
        if (chosen === void 0) continue;
        const words = chosen.map((choice) => question.options.find((option) => option.choice === choice)?.label ?? choice).join(", ");
        list.append(h("dt", null, question.label), h("dd", null, words === "" ? "None" : words));
      }
      if (list.childElementCount > 0) body.append(list);
    };
    const phaseBody = (body) => {
      if (phase === "loading") {
        const row = h("p", { class: "dcb-ask-loading", role: "status" });
        const spin = h("span", { class: "dcb-ask-spin" });
        mountSpinner(spin, { size: "sm" });
        row.append(spin, "Loading the question\u2026");
        body.append(row);
        return;
      }
      const slot = h("div", { class: "dcb-ask-banner" });
      body.append(slot);
      if (phase === "down") {
        own(mountBanner(slot, { tone: "warning", title: SERVICE_DOWN, action: { label: "Try again", onClick: () => void read() } }));
      } else {
        own(mountBanner(slot, { tone: "info", title: phase === "expired" ? TICKET_EXPIRED : phase === "gone" ? SYSTEM_GONE : OUT_OF_DATE }));
      }
    };
    const render = () => {
      for (const handle of owned) handle.dispose();
      owned = [];
      goHandle = null;
      reasonEl = null;
      refusedEl = null;
      noteField = null;
      inputs = [];
      customLines = [];
      const open = answeredText === null && phase === "form";
      const f = frame({ icon: "system", title: roundOne ? "Before I read the code" : "A few calls from the code", sub: roundOne ? "Round 1 of 2" : roundTwoSub(systemNameNow), foot: open });
      if (answeredText !== null) answeredBody(f.body, answeredText);
      else if (phase === "form" && f.foot) formBody(f.body, f.foot);
      else phaseBody(f.body);
      root2.replaceChildren(f.el);
      paint();
    };
    const readTicket = async () => {
      if (!roundOne || answeredText !== null || sending) return;
      let next;
      let project = hasProject;
      try {
        const answer = await ctx2.client.call("GET /system-builds/:ticket", { params: { ticket: ask.ticket } });
        next = answer.state === "waiting" ? "form" : answer.state === "made" ? "stale" : "expired";
        if (answer.state === "waiting") project = answer.project !== null;
      } catch (error) {
        if (phase === "form") return;
        next = "down";
        if (!isServiceError(error)) console.warn("Design Chamber: reading the build ticket failed", error);
      }
      if (disposed || answeredText !== null || sending || next === phase && project === hasProject) return;
      phase = next;
      hasProject = project;
      render();
    };
    const readSystem = async () => {
      if (roundOne || answeredText !== null || sending) return;
      let next;
      let name = systemNameNow;
      try {
        const detail = await ctx2.client.call("GET /systems/:id", { params: { id: ask.systemId } });
        const result = roundTwoRead(detail);
        next = result.phase;
        name = result.name;
      } catch (error) {
        if (isServiceError(error, "not-found")) {
          next = roundTwoRead(null).phase;
          name = null;
        } else {
          if (phase !== "loading" && phase !== "down") return;
          next = "down";
          if (!isServiceError(error)) console.warn("Design Chamber: reading the system failed", error);
        }
      }
      if (disposed || answeredText !== null || sending || next === phase && name === systemNameNow) return;
      phase = next;
      systemNameNow = name;
      render();
    };
    const read = () => roundOne ? readTicket() : readSystem();
    render();
    if (answeredText === null) {
      void read();
      stopRefetch = startRefetch(read, SYSTEM_ASK_POLL_MS);
    }
    return {
      update: (next) => {
        if (next === null || next === answeredText) return;
        answeredText = next;
        stopRefetch?.();
        stopRefetch = null;
        render();
      },
      dispose: () => {
        disposed = true;
        stopRefetch?.();
        for (const handle of owned) handle.dispose();
        owned = [];
        root2.replaceChildren();
      }
    };
  };

  // src/ui/blocks/system-ask.ts
  var mountSystemAsk = (root2, ctx2, ask, set, answered) => ask.kind === "diff" ? mountDiff(root2, ctx2, ask, set, answered) : mountInterview(root2, ctx2, ask, set, answered);

  // src/ui/blocks/main.ts
  var root = document.querySelector("#root");
  if (!root) throw new Error("Design Chamber: #root is missing from blocks/index.html.");
  var blockRoot = root;
  var guestHost = getGuestHost();
  var serviceClient = createServiceClient(guestHost.client);
  var ctx = {
    client: serviceClient,
    host: guestHost.client,
    toast: (kind, message) => {
      guestHost.client.toast({ kind, message, dismiss: kind === "error" }).catch((error) => console.warn("Design Chamber: toast failed", error));
    },
    openSystemPreview: (systemId, which) => openSystemInRail({ client: serviceClient, host: guestHost.client }, systemId, which === "living-page-preview" ? "preview" : "board")
  };
  mountSpinner(document.createElement("div")).dispose();
  guestHost.ready.subscribe((context) => {
    if (!context) return;
    applyHostReady(context, document.documentElement);
    document.documentElement.lang = context.locale;
  });
  var lastHeight = -1;
  new ResizeObserver(() => {
    const height = Math.min(GUEST_BLOCK_HEIGHT_MAX, Math.ceil(blockRoot.getBoundingClientRect().height));
    if (height === lastHeight) return;
    lastHeight = height;
    guestHost.client.setHeight(height).catch((error) => console.warn("Design Chamber: setHeight failed", error));
  }).observe(blockRoot);
  var view = null;
  var drawn = null;
  var draw = (call) => {
    const parsed = parseBlockArgs(call.name, call.args);
    if (!parsed.ok) {
      if (parsed.reason === "unknown-block") {
        console.warn(`Design Chamber: no block named "${call.name}"`);
        blockRoot.replaceChildren();
        return null;
      }
      blockRoot.replaceChildren(
        parsed.reason === "bad-slug" ? notice({ icon: "alert", text: "This card doesn\u2019t point to a design." }) : parsed.reason === "bad-system-ask" ? notice({ icon: "alert", text: "This question couldn\u2019t be read. Answer in the chat instead." }) : notice({ icon: "alert", text: "This question has no options to pick from." })
      );
      return null;
    }
    const { block } = parsed;
    if (block.name === "DesignCard") return mountDesignCard(blockRoot, ctx, block.slug);
    if (block.name === "SystemAsk") return mountSystemAsk(blockRoot, ctx, block.ask, define_DC_SYSTEM_QUESTIONS_default, call.answered);
    return mountDirectionPick(blockRoot, ctx, block.question, block.options, call.answered);
  };
  guestHost.client.onBlock((call) => {
    const key = JSON.stringify([call.name, call.args]);
    if (key === drawn && view) {
      view.update(call.answered);
      return;
    }
    view?.dispose();
    drawn = key;
    view = draw(call);
  });
})();
