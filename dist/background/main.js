"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

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
    const root = doc.documentElement;
    if (root.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root.setAttribute("data-oc-scrollbar-activity", "");
    const timers = /* @__PURE__ */ new WeakMap();
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root : event.target;
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
  var isGuestMessageItem = (item) => item !== null && item.kind === "message";
  var isGuestAttachItem = (item) => item !== null && (item.kind === void 0 || item.kind === "issue" || item.kind === "pull");
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
      const active = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active)
        return;
      popoverActivityReported = active;
      void setPopoverAnchorActive(popover.id, active).catch(() => void 0);
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
    const setPopoverAnchorActive = (id, active) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active } });
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
  var TURN_SNAPSHOT_DEDUPE_MS = 2e3;
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
  var LOOSE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
  var ACTIVITY_WORKING_EXPIRY_MS = 30 * 6e4;
  var STATUS_RECENT_MS = 7 * 864e5;

  // src/shared/agent/context.ts
  var VIEWPORT_TABLET = Object.freeze({ id: "tablet", label: "Tablet", width: 768, height: 1024 });
  var VIEWPORT_DESKTOP = Object.freeze({ id: "desktop", label: "Desktop", width: 1440, height: 900 });

  // src/shared/agent/html-extract.ts
  var parseOpen = (line) => {
    const match = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) return null;
    const [, indent = "", marker = "", rest = ""] = match;
    if (marker.startsWith("`") && rest.includes("`")) return null;
    return { indent: indent.length, char: marker.charAt(0), length: marker.length, info: (rest.trim().split(/\s+/)[0] ?? "").toLowerCase() };
  };
  var closes = (line, fence) => {
    const trimmed = line.trim();
    return trimmed.length >= fence.length && [...trimmed].every((char) => char === fence.char);
  };
  var fencedBlocks = (text) => {
    const blocks = [];
    let open = null;
    let lines = [];
    for (const line of text.split(/\r?\n/)) {
      if (open === null) {
        open = parseOpen(line);
        lines = [];
      } else if (closes(line, open)) {
        blocks.push({ info: open.info, content: lines.join("\n") });
        open = null;
      } else {
        lines.push(line.replace(new RegExp(`^[ \\t]{0,${open.indent}}`), ""));
      }
    }
    if (open !== null) blocks.push({ info: open.info, content: lines.join("\n") });
    return blocks;
  };
  var looksLikeHtmlDocument = (content) => /^\s*<!doctype\s+html/i.test(content) || /<(html|body)[\s>]/i.test(content);
  var extractHtml = (text) => {
    let best = null;
    for (const block of fencedBlocks(text)) {
      const content = block.content.replace(/^\s*\n/, "").trimEnd();
      if (content.trim() === "") continue;
      if (block.info !== "html" && block.info !== "htm" && !looksLikeHtmlDocument(content)) continue;
      if (best === null || content.length > best.length) best = content;
    }
    return best;
  };

  // src/shared/types.ts
  var CHIP_PROVIDER_ID = "design-chamber";

  // src/shared/path-compare.ts
  var sameDirectory = (a, b) => {
    const norm = (value) => value.replace(/\\/g, "/").replace(/\/+$/, "");
    const left = norm(a);
    const right = norm(b);
    const windows = /^[A-Za-z]:\//.test(left) || /^[A-Za-z]:\//.test(right);
    return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
  };

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
    "GET /status/designs": "U5"
  };
  var ROUTE_KEYS = Object.keys(ROUTE_OWNERS);
  var RAW_TEXT_ROUTES = /* @__PURE__ */ new Set(["GET /designs/:slug/render/chunk"]);
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
    return { call, loadRender, upload, thumbnail };
  };

  // src/guest/flows.ts
  var PANEL_SURFACE_ID = `plugin:${CHIP_PROVIDER_ID}`;
  var OPEN_AS_PAGE_ACTION = "open-as-page";
  var CHIP_ID_PREFIX = "design:";
  var MESSAGES = {
    noProject: "Open a project first, then try again.",
    busy: "The agent is busy, so your revision is waiting in the composer.",
    busyAsk: "The agent is busy, so your message is waiting in the composer.",
    noHtml: "No HTML code block in this message",
    startFailed: "Couldn't start a chat for this design. It is in your Designs list; try Continue in chat.",
    sendFailed: "The revision didn't reach the chat. Your comments are still open; try again.",
    nothingToSend: "There are no open comments to send.",
    unknownCommand: "Design Chamber knows /design and /page only.",
    noSessionSelected: "Open a chat first, then try again.",
    markFailed: "Sent, but the comments could not be marked as sent. Resolve them by hand so they are not sent again.",
    savedPage: (title) => `Saved as page \u201C${title}\u201D.`,
    savedPageClosed: (title) => `Saved as page \u201C${title}\u201D. Open Design Chamber to see it.`
  };
  var FlowError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code");
      this.name = "FlowError";
      this.code = code;
    }
  };
  var isHostError = (error, code) => error instanceof HostRequestError && error.code === code;
  var toAttachRequest = (chip) => ({
    providerId: chip.providerId,
    id: chip.id,
    title: chip.title,
    url: chip.url,
    text: chip.text,
    data: { slug: chip.data.slug, kind: chip.data.kind }
  });
  var planReconciliation = (snapshot, designs) => {
    if (snapshot.state !== "ready") return [];
    const known = new Set(snapshot.sessions.map((session) => session.id));
    const newest = /* @__PURE__ */ new Map();
    for (const session of snapshot.sessions) {
      for (const item of session.items) {
        if (!item.id.startsWith(CHIP_ID_PREFIX)) continue;
        const slug = item.id.slice(CHIP_ID_PREFIX.length);
        const best = newest.get(slug);
        if (!best || session.updatedAt > best.updatedAt) newest.set(slug, { id: session.id, updatedAt: session.updatedAt });
      }
    }
    const patches = [];
    for (const design of designs) {
      const best = newest.get(design.slug);
      if (!best || best.id === design.sessionId) continue;
      if (design.sessionId === null || !known.has(design.sessionId)) patches.push({ slug: design.slug, sessionId: best.id });
    }
    return patches;
  };
  var finishedTurns = (previous, snapshot) => {
    if (snapshot.state !== "ready") return [];
    return snapshot.sessions.filter((session) => session.activity === "idle" && ["running", "retrying", "waiting-permission", "waiting-question"].includes(previous.get(session.id) ?? "")).map((session) => session.id);
  };
  var takesOpenRequest = (batch) => batch.reset || batch.events.some((event) => event.kind === "added" || event.kind === "open");
  var createFlows = ({ host: host2, client, now = Date.now }) => {
    const api = host2.client;
    const lastTurn = /* @__PURE__ */ new Map();
    let delivering = false;
    const toast = async (kind, message) => {
      try {
        await api.toast({ kind, message });
      } catch {
      }
    };
    const latestVersion = async (slug) => {
      try {
        const { versions } = await client.call("GET /designs/:slug/versions", { params: { slug } });
        return versions.reduce((max, version) => max === null || version.n > max ? version.n : max, null);
      } catch {
        return null;
      }
    };
    const markSent = async (slug, ids, version) => {
      if (ids.length === 0) return true;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await client.call("POST /designs/:slug/comments/mark-sent", { params: { slug }, body: { ids, version } });
          return true;
        } catch {
        }
      }
      return false;
    };
    const projectIdFor = async (directory) => {
      if (!directory) return void 0;
      try {
        const { projects } = await api.listProjects();
        return projects.find((project) => sameDirectory(project.directory, directory))?.id;
      } catch {
        return void 0;
      }
    };
    const promptSelected = async (session, text, busyMessage) => {
      const composeBusy = async () => {
        await api.compose({ text, mode: "append" });
        await toast("info", busyMessage);
        return "composed";
      };
      if (session.busy) return composeBusy();
      let result;
      try {
        result = await api.prompt({ text, send: true });
      } catch (error) {
        if (!isHostError(error, "SESSION_BUSY")) throw error;
        return composeBusy();
      }
      if (result.sent === "sent") return "sent";
      throw new FlowError("send-failed", MESSAGES.sendFailed);
    };
    const startLinkedSession = async (slug, chip, text, projectDirectory) => {
      const projectId = await projectIdFor(projectDirectory) ?? await projectIdFor(host2.directory.get());
      if (!projectId && !host2.directory.get()) throw new FlowError("no-project", MESSAGES.noProject);
      const request = { ...toAttachRequest(chip), text, navigation: "open", ...projectId ? { projectId } : {} };
      const result = await api.startSession(request);
      if (result.sessionId === null) throw new FlowError("start-failed", MESSAGES.startFailed);
      await client.call("PATCH /designs/:slug", { params: { slug }, body: { sessionId: result.sessionId } });
      return result;
    };
    const deliver = async (slug, prompt, design, version, busyMessage) => {
      const selected = host2.session.get();
      if (design.sessionId && selected?.id === design.sessionId) {
        return { outcome: await promptSelected(selected, prompt.text, busyMessage), sessionId: selected.id };
      }
      if (design.sessionId) {
        await client.call("PUT /outbox", {
          body: { sessionId: design.sessionId, slug, text: prompt.text, commentIds: prompt.commentIds, version }
        });
        try {
          await api.openSurface(PANEL_SURFACE_ID);
        } catch {
        }
        try {
          await api.openSession(design.sessionId);
          return { outcome: "outbox", sessionId: design.sessionId };
        } catch (error) {
          if (!isHostError(error, "NO_SESSION")) throw error;
          await client.call("DELETE /outbox");
        }
      }
      const result = await startLinkedSession(slug, prompt.chip, prompt.text, design.projectDirectory);
      if (result.sent !== "sent") throw new FlowError("send-failed", MESSAGES.sendFailed);
      return { outcome: "new-session", sessionId: result.sessionId };
    };
    const flows2 = {
      resolveSlashCommand: async ({ command, args }) => {
        const kind = command === "design" ? "canvas" : command === "page" ? "page" : null;
        if (!kind) throw new FlowError("unknown-command", MESSAGES.unknownCommand);
        const ready = host2.ready.get();
        try {
          const { chip } = await client.call("POST /chip", {
            body: { kind, brief: args.trim(), projectDirectory: ready?.directory ?? null, sessionId: ready?.session?.id ?? null }
          });
          return toAttachRequest(chip);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : String(error));
        }
      },
      newDesign: async ({ kind, brief, preset = null, destination }) => {
        const ready = host2.ready.get();
        const directory = host2.directory.get();
        const text = brief.trim();
        if (destination === "new-chat") {
          if (!directory) throw new FlowError("no-project", MESSAGES.noProject);
          const { slug: slug2, chip: chip2 } = await client.call("POST /chip", { body: { kind, brief: text, preset, projectDirectory: directory, sessionId: null } });
          const result = await api.startSession({ ...toAttachRequest(chip2), text: text || "Let's start this design.", navigation: "open" });
          if (result.sessionId === null) throw new FlowError("start-failed", MESSAGES.startFailed);
          await client.call("PATCH /designs/:slug", { params: { slug: slug2 }, body: { sessionId: result.sessionId } });
          return { slug: slug2, sessionId: result.sessionId };
        }
        const session = host2.session.get();
        const { slug, chip } = await client.call("POST /chip", {
          body: { kind, brief: text, preset, projectDirectory: directory, sessionId: session?.id ?? null }
        });
        await api.attach(toAttachRequest(chip));
        if (text) await api.compose({ text, mode: "append" });
        if (ready?.surface === "page") await api.close();
        return { slug, sessionId: session?.id ?? null };
      },
      continueInChat: async (slug) => {
        const { design } = await client.call("GET /designs/:slug", { params: { slug } });
        if (design.sessionId) {
          try {
            await api.openSession(design.sessionId);
            return { outcome: "opened", sessionId: design.sessionId };
          } catch (error) {
            if (!isHostError(error, "NO_SESSION")) throw error;
          }
        }
        const { text, chip } = await client.call("POST /designs/:slug/prompt", { params: { slug }, body: { purpose: "continue" } });
        const result = await startLinkedSession(slug, chip, text, design.projectDirectory);
        return { outcome: "new-session", sessionId: result.sessionId };
      },
      sendComments: async (slug, commentIds, anchorStates) => {
        const body = { purpose: "revision" };
        if (commentIds) body.commentIds = commentIds;
        if (anchorStates && Object.keys(anchorStates).length > 0) body.anchorStates = { ...anchorStates };
        const prompt = await client.call("POST /designs/:slug/prompt", { params: { slug }, body });
        if (prompt.commentIds.length === 0) return { outcome: "nothing", sessionId: null, commentIds: [], omitted: prompt.omitted };
        const { design } = await client.call("GET /designs/:slug", { params: { slug } });
        const version = await latestVersion(slug);
        const delivery = await deliver(slug, prompt, design, version, MESSAGES.busy);
        const marked = delivery.outcome === "outbox" ? true : await markSent(slug, prompt.commentIds, version);
        return {
          outcome: delivery.outcome,
          sessionId: delivery.sessionId,
          commentIds: prompt.commentIds,
          omitted: prompt.omitted,
          ...marked ? {} : { markFailed: true }
        };
      },
      ask: async (slug, input) => {
        const body = { purpose: "ask", text: input.text };
        if (input.element) body.element = input.element;
        const prompt = await client.call("POST /designs/:slug/prompt", { params: { slug }, body });
        const { design } = await client.call("GET /designs/:slug", { params: { slug } });
        return deliver(slug, prompt, design, null, MESSAGES.busyAsk);
      },
      askAgent: async (slug, purpose) => {
        const prompt = await client.call("POST /designs/:slug/prompt", { params: { slug }, body: { purpose } });
        const { design } = await client.call("GET /designs/:slug", { params: { slug } });
        return deliver(slug, prompt, design, null, MESSAGES.busyAsk);
      },
      deliverOutbox: async (session = host2.session.get()) => {
        if (!session || delivering) return "none";
        delivering = true;
        try {
          const { outbox } = await client.call("GET /outbox");
          if (!outbox || outbox.sessionId !== session.id || !isFresh(outbox, now())) return "none";
          const taken = (await client.call("DELETE /outbox")).outbox;
          if (!taken) return "none";
          if (taken.sessionId !== session.id) {
            const { created: _created, ...rest } = taken;
            await client.call("PUT /outbox", { body: rest });
            return "none";
          }
          const outcome = await promptSelected(session, taken.text, taken.commentIds.length === 0 ? MESSAGES.busyAsk : MESSAGES.busy);
          if (!await markSent(taken.slug, taken.commentIds, taken.version)) await toast("info", MESSAGES.markFailed);
          return outcome === "sent" ? "delivered" : "composed";
        } finally {
          delivering = false;
        }
      },
      reconcile: async (snapshot, designs) => {
        const patches = planReconciliation(snapshot, designs);
        const done = [];
        for (const patch of patches) {
          try {
            await client.call("PATCH /designs/:slug", { params: { slug: patch.slug }, body: { sessionId: patch.sessionId } });
            done.push(patch);
          } catch {
          }
        }
        return done;
      },
      snapshotTurn: async (sessionId) => {
        const at = now();
        const last = lastTurn.get(sessionId);
        if (last !== void 0 && at - last < TURN_SNAPSHOT_DEDUPE_MS) return;
        lastTurn.set(sessionId, at);
        await client.call("POST /versions/turn", { body: { sessionId } });
      },
      openAsPage: async (item, options = {}) => {
        if (extractHtml(item.text) === null) {
          await toast("info", MESSAGES.noHtml);
          return null;
        }
        try {
          const uploadId = await client.upload(item.text);
          const body = { uploadId, sessionId: item.sessionId, sessionTitle: item.sessionTitle, messageId: item.messageId, directory: item.directory };
          return await client.call("POST /pages/from-message", { body: options.open ? { ...body, open: true } : body });
        } catch (error) {
          if (isServiceError(error, "no-html")) {
            await toast("info", MESSAGES.noHtml);
            return null;
          }
          throw error;
        }
      },
      runAction: async (item) => {
        if (!isGuestMessageItem(item) || item.action !== OPEN_AS_PAGE_ACTION) return;
        const created = await flows2.openAsPage(item, { open: true });
        if (!created) return;
        let opened = true;
        try {
          await api.openSurface(PANEL_SURFACE_ID);
        } catch {
          opened = false;
        }
        await toast("success", opened ? MESSAGES.savedPage(created.title) : MESSAGES.savedPageClosed(created.title));
      },
      handleItem: async (item) => {
        if (isGuestAttachItem(item)) {
          if (item.providerId !== CHIP_PROVIDER_ID) return null;
          const data = item.data;
          const slug = typeof data === "object" && data !== null && !Array.isArray(data) ? data.slug : void 0;
          return typeof slug === "string" && SLUG_PATTERN.test(slug) ? { kind: "open-design", slug } : null;
        }
        if (isGuestMessageItem(item) && item.action === OPEN_AS_PAGE_ACTION) {
          const created = await flows2.openAsPage(item);
          return created ? { kind: "open-design", slug: created.slug } : null;
        }
        return null;
      },
      watchTurns: () => {
        const working = /* @__PURE__ */ new Set();
        return host2.onLifecycle((event) => {
          if (event.phase === "started") {
            working.add(event.sessionId);
            return;
          }
          const ended = working.delete(event.sessionId);
          if (event.phase !== "completed" || !ended) return;
          flows2.snapshotTurn(event.sessionId).catch(() => {
          });
        });
      },
      watchOutbox: () => host2.session.subscribe((session) => {
        if (!session) return;
        flows2.deliverOutbox(session).catch(async (error) => {
          await toast("error", error instanceof Error && error.message ? error.message : MESSAGES.sendFailed);
        });
      }),
      watchSessions: (designs) => {
        let unsubscribe = null;
        let generation = 0;
        const subscribe = async (directory) => {
          generation += 1;
          const mine = generation;
          unsubscribe?.();
          unsubscribe = null;
          const projectId = await projectIdFor(directory);
          if (!projectId || mine !== generation) return;
          const activity = /* @__PURE__ */ new Map();
          const stop = await api.onSessions(projectId, (snapshot) => {
            void flows2.reconcile(snapshot, designs());
            const linked = new Set(designs().map((design) => design.sessionId));
            for (const sessionId of finishedTurns(activity, snapshot)) {
              if (!linked.has(sessionId)) continue;
              flows2.snapshotTurn(sessionId).catch(() => {
              });
            }
            if (snapshot.state === "ready") for (const session of snapshot.sessions) activity.set(session.id, session.activity);
          });
          if (mine !== generation) stop();
          else unsubscribe = stop;
        };
        const unwatch = host2.directory.subscribe((directory) => {
          subscribe(directory).catch(() => {
          });
        });
        return () => {
          generation += 1;
          unwatch();
          unsubscribe?.();
        };
      },
      watchItems: (open, onError) => {
        const seenMessages = /* @__PURE__ */ new Set();
        let lastKey = null;
        return host2.item.subscribe((item) => {
          if (!item) {
            lastKey = null;
            return;
          }
          const key = isGuestMessageItem(item) ? `message:${item.sessionId}:${item.messageId}` : isGuestAttachItem(item) ? `chip:${item.providerId}:${item.id}` : null;
          if (!key || key === lastKey || seenMessages.has(key)) return;
          lastKey = key;
          if (isGuestMessageItem(item)) seenMessages.add(key);
          flows2.handleItem(item).then(
            (target) => {
              if (target) open(target);
            },
            (error) => onError?.(error)
          );
        });
      },
      watchOpenRequests: (subscribe, open) => {
        let stopped = false;
        const take = () => {
          client.call("DELETE /open-request").then(
            ({ request }) => {
              if (request && !stopped && SLUG_PATTERN.test(request.slug)) {
                open({ kind: "open-design", slug: request.slug, intent: request.intent === "comment" ? "comment" : "view" });
              }
            },
            () => {
            }
          );
        };
        take();
        const unsubscribe = subscribe((batch) => {
          if (takesOpenRequest(batch)) take();
        });
        return () => {
          stopped = true;
          unsubscribe();
        };
      }
    };
    return flows2;
  };
  var isFresh = (outbox, at) => {
    const created = Date.parse(outbox.created);
    return Number.isNaN(created) || at - created < OUTBOX_TTL_MS;
  };

  // src/guest/background-main.ts
  var READY_WAIT_MS = 2e3;
  var host = getGuestHost();
  var flows = createFlows({ host, client: createServiceClient(host.client) });
  host.client.onResolve(async (request) => {
    await Promise.race([host.whenReady(), new Promise((resolve) => setTimeout(resolve, READY_WAIT_MS))]);
    return flows.resolveSlashCommand(request);
  });
  host.client.onAction((item) => flows.runAction(item));
})();
