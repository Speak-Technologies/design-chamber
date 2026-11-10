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
  var createGuestHost = (client2) => {
    const ready = createObservable(null);
    const session = createObservable(null, sameSession);
    const directory = createObservable(null);
    const item = createObservable(null);
    const lifecycle = /* @__PURE__ */ new Set();
    const readyWaiters = [];
    const unsubscribers = [
      client2.onReady((context) => {
        ready.set(context);
        session.set(context.session);
        directory.set(context.directory);
        if (context.item !== null) item.set(context.item);
        for (const resolve of readyWaiters.splice(0)) resolve(context);
      }),
      client2.onSession((next) => session.set(next)),
      client2.onDirectory((next) => directory.set(next)),
      client2.onItem((next) => item.set(next)),
      client2.onSessionLifecycle((event) => {
        for (const listener of [...lifecycle]) listener(event);
      })
    ];
    return {
      client: client2,
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

  // src/shared/limits.ts
  var SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
  var BRIEF_MAX = 2e3;
  var COMMENT_BODY_MAX = 2e3;
  var ANCHOR_TEXT_MAX = 120;
  var ANCHOR_HTML_MAX = 200;
  var ANCHOR_SELECTOR_MAX = 1e3;
  var COMMENTS_MAX = 500;
  var SNAPSHOT_BYTES_MAX = 100 * 1024 * 1024;
  var TURN_SNAPSHOT_DEDUPE_MS = 2e3;
  var TURN_PROMOTE_AUTO_MS = 30 * 6e4;
  var SETTINGS_PATH_MAX = 4096;
  var UPLOAD_TOTAL_MAX = 2e6;
  var UPLOAD_CHUNK_MAX_CHARS = 6e4;
  var UPLOAD_CHUNK_MAX_BYTES = 75e3;
  var UPLOAD_TTL_MS = 10 * 6e4;
  var OUTBOX_TTL_MS = 10 * 6e4;
  var OPEN_REQUEST_TTL_MS = 2 * 6e4;
  var CHANGES_WAIT_MAX_MS = 15e3;
  var CHANGES_BACKOFF_MIN_MS = 1e3;
  var CHANGES_BACKOFF_MAX_MS = 1e4;
  var RENDER_DOC_MAX_BYTES = 60 * 1024 * 1024;
  var RENDER_CACHE_MAX_BYTES = 256 * 1024 * 1024;
  var GUEST_RENDER_CACHE_MAX_BYTES = 64 * 1024 * 1024;
  var RENDER_CHUNK_CONCURRENCY = 3;
  var CHECK_RUN_BUDGET_MS = 9e4;
  var PAGE_LIVE_FRAMES_MAX = 12;
  var RAIL_LIVE_FRAMES_MAX = 4;
  var FRAME_UNLOAD_MARGIN = 0.5;
  var CAMERA_SCALE_MIN = 0.05;
  var CAMERA_SCALE_MAX = 4;
  var CAMERA_PAN_MAX = 1e6;
  var WHEEL_ZOOM_RATE = 5e-3;
  var WALL_GAP = 96;
  var ARTBOARD_LABEL_HEIGHT = 28;
  var PAGE_FILL_VIEWPORT_ID = "fill";
  var BRIDGE_ANCHORS_MAX = COMMENTS_MAX;
  var BRIDGE_TITLE_MAX = 200;
  var BRIDGE_URL_MAX = 2e3;
  var BRIDGE_TAG_MAX = 64;
  var BRIDGE_ARTBOARD_ID_MAX = 100;
  var BRIDGE_NONCE_MAX = 64;
  var BRIDGE_COORD_MAX = 1e7;
  var HOST_CLIPBOARD_MAX = 32e3;
  var ASK_TEXT_MAX = 12e3;
  var AGENTS_SNIPPET_MAX = 1e3;
  var LOOSE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
  var ACTIVITY_WORKING_EXPIRY_MS = 30 * 6e4;
  var WRITING_WINDOW_MS = 15e3;
  var STATUS_RECENT_MS = 7 * 864e5;

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
  var applyHostTheme = (theme, root) => {
    root.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root.style.setProperty(alias, value);
      root.style.setProperty(hostName, value);
    }
    root.style.setProperty("font-family", theme.tokens.font);
    root.style.setProperty("font-size", "0.875rem");
    root.style.setProperty("line-height", "1.45");
    root.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root) => {
    applyHostTheme(ctx.theme, root);
    if (root.dataset) {
      root.dataset.ocSurface = ctx.surface;
      root.dataset.ocTheme = ctx.theme.mode;
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
  var clearNode = (node) => {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  };
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
  var onOutsideClick = (node, handler) => {
    const listener = (event) => {
      if (event.target instanceof Node && node.contains(event.target)) {
        return;
      }
      handler();
    };
    document.addEventListener("pointerdown", listener, true);
    return () => {
      document.removeEventListener("pointerdown", listener, true);
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/button.js
  var ring = () => {
    const spinner = document.createElement("span");
    spinner.className = "oc-sdk-spinner-ring";
    spinner.setAttribute("aria-hidden", "true");
    return spinner;
  };
  var mountButton = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-btn");
    const spinner = ring();
    const label = document.createElement("span");
    node.append(label);
    root.append(node);
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
  var mountTextField = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const field2 = el("label", "oc-sdk oc-sdk-field");
    const caption = el("span", "oc-sdk-field-label");
    const input = props.multiline ? el("textarea", "oc-sdk-input") : el("input", "oc-sdk-input");
    const note = el("span", "oc-sdk-field-note");
    field2.append(caption, input, note);
    root.append(field2);
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
      setText(note, text);
      note.hidden = text === "";
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

  // node_modules/@openchamber/sdk/dist/ui/search.js
  var mountSearchField = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const wrap = el("div", "oc-sdk oc-sdk-search");
    const input = el("input", "oc-sdk-input");
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("role", "searchbox");
    const clear = button("oc-sdk-search-clear");
    clear.append(icon("close", 14));
    clear.tabIndex = -1;
    wrap.append(icon("search", 16, "oc-sdk-search-icon"), input, clear);
    root.append(wrap);
    const paint = () => {
      const placeholder = props.placeholder ?? "Search";
      setAttr(input, "placeholder", placeholder);
      input.setAttribute("aria-label", props.label ?? placeholder);
      clear.setAttribute("aria-label", "Clear search");
      if (input.value !== props.value) {
        input.value = props.value;
      }
      wrap.dataset.active = props.value.trim() === "" ? "false" : "true";
    };
    const clearValue = () => {
      if (props.value !== "") {
        props.onChange("");
      }
      input.focus();
    };
    const onInput = () => {
      props.onChange(input.value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape" && input.value !== "") {
        event.preventDefault();
        clearValue();
      }
    };
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeyDown);
    clear.addEventListener("click", clearValue);
    paint();
    if (props.autofocus) {
      input.focus();
    }
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKeyDown);
        clear.removeEventListener("click", clearValue);
        wrap.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/navigation.js
  var navigationKey = (event, axis = "vertical") => {
    const [next, previous] = axis === "vertical" ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
    if (event.key === next || event.ctrlKey && event.key.toLowerCase() === "n")
      return "next";
    if (event.key === previous || event.ctrlKey && event.key.toLowerCase() === "p")
      return "previous";
    if (event.key === "Home")
      return "first";
    if (event.key === "End")
      return "last";
    return null;
  };
  var moveListSelection = (items, currentId, key) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) {
      return null;
    }
    const first = enabled[0];
    const last = enabled[enabled.length - 1];
    if (key === "first" || !first || !last) {
      return first?.id ?? null;
    }
    if (key === "last") {
      return last.id;
    }
    const index = enabled.findIndex((item) => item.id === currentId);
    if (index === -1) {
      return key === "next" ? first.id : last.id;
    }
    const target = enabled[Math.min(enabled.length - 1, Math.max(0, index + (key === "next" ? 1 : -1)))];
    return target?.id ?? null;
  };

  // node_modules/@openchamber/sdk/dist/ui/option.js
  var optionId = (uid2, id) => `${uid2}-${id ?? ""}`;
  var createOption = (uid2, role, spec, on) => {
    const node = button("oc-sdk-option");
    node.id = optionId(uid2, spec.id);
    node.setAttribute("role", role);
    node.tabIndex = -1;
    node.disabled = Boolean(spec.disabled);
    if (role === "option") {
      node.setAttribute("aria-selected", spec.selected ? "true" : "false");
    }
    node.dataset.destructive = spec.destructive ? "true" : "false";
    const label = el("span", "oc-sdk-option-label");
    label.textContent = spec.label;
    node.append(label);
    if (spec.hint) {
      const hint = el("span", "oc-sdk-option-hint");
      hint.textContent = spec.hint;
      node.append(hint);
    }
    if (role === "option") {
      node.dataset.mark = "check";
      const check = el("span", "oc-sdk-option-check");
      check.append(icon("check", 14));
      node.append(check);
    }
    node.addEventListener("pointerenter", on.hover);
    node.addEventListener("click", on.pick);
    return node;
  };
  var highlightOption = (container, focusOwner, uid2, id) => {
    const target = optionId(uid2, id);
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && child.classList.contains("oc-sdk-option")) {
        child.dataset.active = child.id === target ? "true" : "false";
      }
    }
    setAttr(focusOwner, "aria-activedescendant", id ? target : null);
    container.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  };

  // node_modules/@openchamber/sdk/dist/ui/popup.js
  var placePopup = (popup, trigger) => {
    const rect = trigger.getBoundingClientRect();
    popup.style.minWidth = `${Math.round(rect.width)}px`;
    popup.style.left = `${Math.round(rect.left)}px`;
    popup.style.top = `${Math.round(rect.bottom + 4)}px`;
    const height = popup.offsetHeight;
    const roomBelow = window.innerHeight - rect.bottom - 8;
    if (height > roomBelow && rect.top - 8 > roomBelow) {
      popup.style.top = `${Math.max(8, Math.round(rect.top - 4 - height))}px`;
    }
    const overflow = rect.left + popup.offsetWidth - window.innerWidth + 8;
    if (overflow > 0) {
      popup.style.left = `${Math.max(8, Math.round(rect.left - overflow))}px`;
    }
  };
  var openPopup = (host2, trigger, popup, close) => {
    host2.append(popup);
    placePopup(popup, trigger);
    const stopOutside = onOutsideClick(host2, close);
    const onResize = () => {
      close();
    };
    const onScroll = (event) => {
      if (event.target instanceof Node && popup.contains(event.target)) {
        return;
      }
      close();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      stopOutside();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      popup.remove();
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/select.js
  var filterSelectOptions = (options, query) => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [...options];
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle) || option.id.toLowerCase().includes(needle));
  };
  var selectCount = 0;
  var mountSelect = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const uid2 = `oc-sdk-select-${selectCount += 1}`;
    const wrap = el("div", "oc-sdk oc-sdk-select");
    const caption = el("span", "oc-sdk-field-label");
    caption.id = `${uid2}-label`;
    const trigger = button("oc-sdk-trigger");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-labelledby", caption.id);
    const value = el("span", "oc-sdk-trigger-value");
    trigger.append(value, icon("chevron", 14, "oc-sdk-trigger-chevron"));
    wrap.append(caption, trigger);
    root.append(wrap);
    let query = "";
    let activeId = null;
    let closePopup = null;
    const popup = el("div", "oc-sdk oc-sdk-popup");
    const searchSlot = el("div", "oc-sdk-popup-search");
    const search = el("input", "oc-sdk-input");
    search.type = "text";
    search.autocomplete = "off";
    searchSlot.append(search);
    const listbox = el("div");
    listbox.setAttribute("role", "listbox");
    listbox.tabIndex = -1;
    popup.append(listbox);
    const visible = () => filterSelectOptions(props.options, props.searchable ? query : "");
    const focusOwner = () => props.searchable ? search : listbox;
    const setActive = (id) => {
      activeId = id;
      highlightOption(listbox, focusOwner(), uid2, id);
    };
    const paintOptions = () => {
      clearNode(listbox);
      const options = visible();
      if (options.length === 0) {
        const empty = el("div", "oc-sdk-popup-empty");
        empty.textContent = "No matches";
        listbox.append(empty);
      }
      for (const option of options) {
        listbox.append(createOption(uid2, "option", { ...option, selected: option.id === props.value }, {
          hover: () => setActive(option.id),
          pick: () => pick(option.id)
        }));
      }
      setActive(options.some((option) => option.id === activeId) ? activeId : options[0]?.id ?? null);
    };
    const close = () => {
      const dispose = closePopup;
      closePopup = null;
      dispose?.();
      query = "";
      search.value = "";
      trigger.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      if (closePopup || props.disabled) {
        return;
      }
      activeId = props.value;
      search.placeholder = props.searchPlaceholder ?? "Search";
      if (props.searchable)
        popup.prepend(searchSlot);
      else
        searchSlot.remove();
      paintOptions();
      closePopup = openPopup(wrap, trigger, popup, close);
      trigger.setAttribute("aria-expanded", "true");
      focusOwner().focus();
    };
    const pick = (id) => {
      close();
      trigger.focus();
      if (id !== props.value)
        props.onChange(id);
    };
    const onTriggerClick = () => {
      if (closePopup)
        close();
      else
        open();
    };
    const onTriggerKey = (event) => {
      if (!closePopup && navigationKey(event)) {
        event.preventDefault();
        open();
      }
    };
    const onPopupKey = (event) => {
      const step = navigationKey(event);
      if (step) {
        event.preventDefault();
        setActive(moveListSelection(visible(), activeId, step));
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeId)
          pick(activeId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
        trigger.focus();
      } else if (props.searchable && event.target !== search && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        search.focus();
      }
    };
    const onSearchInput = () => {
      query = search.value;
      paintOptions();
    };
    const onFocusOut = (event) => {
      if (closePopup && !(event.relatedTarget instanceof Node && wrap.contains(event.relatedTarget)))
        close();
    };
    const paint = () => {
      setText(caption, props.label);
      caption.hidden = !props.label;
      const current = props.options.find((option) => option.id === props.value);
      setText(value, current?.label ?? props.placeholder ?? "Select");
      value.dataset.empty = current ? "false" : "true";
      trigger.disabled = Boolean(props.disabled);
      if (closePopup)
        paintOptions();
    };
    trigger.addEventListener("click", onTriggerClick);
    trigger.addEventListener("keydown", onTriggerKey);
    popup.addEventListener("keydown", onPopupKey);
    search.addEventListener("input", onSearchInput);
    wrap.addEventListener("focusout", onFocusOut);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        close();
        trigger.removeEventListener("click", onTriggerClick);
        trigger.removeEventListener("keydown", onTriggerKey);
        popup.removeEventListener("keydown", onPopupKey);
        search.removeEventListener("input", onSearchInput);
        wrap.removeEventListener("focusout", onFocusOut);
        wrap.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/tabs.js
  var mountTabs = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const track = el("div", "oc-sdk oc-sdk-tabs");
    track.setAttribute("role", "tablist");
    root.append(track);
    const paint = () => {
      clearNode(track);
      track.dataset.track = props.trackBackground ? "true" : "false";
      for (const item of props.items) {
        const tab = button("oc-sdk-tab");
        tab.setAttribute("role", "tab");
        const active2 = item.id === props.activeId;
        tab.setAttribute("aria-selected", active2 ? "true" : "false");
        tab.tabIndex = active2 ? 0 : -1;
        tab.dataset.id = item.id;
        const label = el("span");
        label.textContent = item.label;
        tab.append(label);
        if (item.count !== void 0) {
          const count = el("span", "oc-sdk-tab-count");
          count.textContent = String(item.count);
          tab.append(count);
        }
        tab.addEventListener("click", () => {
          if (item.id !== props.activeId)
            props.onChange(item.id);
        });
        track.append(tab);
      }
    };
    const onKeyDown = (event) => {
      const step = navigationKey(event, "horizontal");
      if (!step) {
        return;
      }
      const next = moveListSelection(props.items, props.activeId, step);
      if (next && next !== props.activeId) {
        event.preventDefault();
        props.onChange(next);
        const tab = track.querySelector(`[data-id="${CSS.escape(next)}"]`);
        if (tab instanceof HTMLElement)
          tab.focus();
      }
    };
    track.addEventListener("keydown", onKeyDown);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        track.removeEventListener("keydown", onKeyDown);
        track.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/badge.js
  var applyTone = (node, tone2) => {
    setAttr(node, "data-tone", tone2 && tone2 !== "neutral" ? tone2 : null);
  };
  var mountBadge = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("span", "oc-sdk oc-sdk-badge");
    root.append(node);
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

  // node_modules/@openchamber/sdk/dist/ui/empty.js
  var mountEmpty = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const shell = el("div", "oc-sdk oc-sdk-empty");
    const title = el("h2", "oc-sdk-empty-title");
    const body = el("p", "oc-sdk-empty-body");
    const slot = el("div", "oc-sdk-empty-action");
    shell.append(title, body, slot);
    root.append(shell);
    let action = null;
    const paint = () => {
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
        action = mountButton(slot, { ...next, variant: "outline", size: "sm" });
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
        shell.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/spinner.js
  var mountSpinner = (root, initial = {}) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("span", "oc-sdk oc-sdk-spinner");
    node.setAttribute("role", "status");
    const ring2 = el("span", "oc-sdk-spinner-ring");
    ring2.setAttribute("aria-hidden", "true");
    const label = el("span");
    node.append(ring2, label);
    root.append(node);
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
  var mountBanner = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("div", "oc-sdk oc-sdk-banner");
    const text = el("div", "oc-sdk-banner-text");
    const title = el("div", "oc-sdk-banner-title");
    const body = el("div", "oc-sdk-banner-body");
    const slot = el("div", "oc-sdk-banner-action");
    text.append(title, body);
    node.append(text, slot);
    root.append(node);
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

  // src/guest/changes.ts
  var documentVisibility = () => {
    if (typeof document === "undefined") return null;
    return {
      hidden: () => document.hidden,
      onChange: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      }
    };
  };
  var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var nextBackoff = (current) => Math.min(CHANGES_BACKOFF_MAX_MS, Math.max(CHANGES_BACKOFF_MIN_MS, current * 2));
  var createChangeFeed = (client2, options = {}) => {
    const wait = Math.min(options.waitMs ?? CHANGES_WAIT_MAX_MS, CHANGES_WAIT_MAX_MS);
    const sleep = options.sleep ?? defaultSleep;
    const visibility = options.visibility === void 0 ? documentVisibility() : options.visibility;
    const listeners = /* @__PURE__ */ new Set();
    const statusListeners = /* @__PURE__ */ new Set();
    let since = 0;
    let epoch = "";
    let generation = 0;
    let running = false;
    let status = { state: "stopped", error: null, retryInMs: null };
    let wakeVisible = null;
    let unwatchVisibility = null;
    const setStatus = (next) => {
      status = next;
      for (const listener of [...statusListeners]) listener(next);
    };
    const whenVisible = () => new Promise((resolve) => {
      if (!visibility || !visibility.hidden()) return resolve();
      wakeVisible = resolve;
    });
    const loop = async (mine) => {
      let backoff = CHANGES_BACKOFF_MIN_MS;
      while (running && mine === generation) {
        if (visibility?.hidden()) {
          setStatus({ state: "paused", error: null, retryInMs: null });
          await whenVisible();
          continue;
        }
        try {
          const answer = await client2.call("GET /changes", { query: { since: String(since), epoch, wait: String(wait) } });
          if (!running || mine !== generation) return;
          backoff = CHANGES_BACKOFF_MIN_MS;
          if (status.state !== "live") setStatus({ state: "live", error: null, retryInMs: null });
          const batch = { reset: answer.reset, events: answer.events, epoch: answer.epoch, seq: answer.seq };
          since = answer.seq;
          epoch = answer.epoch;
          if (batch.reset || batch.events.length > 0) for (const listener of [...listeners]) listener(batch);
        } catch (error) {
          if (!running || mine !== generation) return;
          setStatus({ state: "retrying", error: toServiceError(error), retryInMs: backoff });
          await sleep(backoff);
          backoff = nextBackoff(backoff);
        }
      }
    };
    return {
      start: () => {
        if (running) return;
        running = true;
        generation += 1;
        setStatus({ state: "connecting", error: null, retryInMs: null });
        unwatchVisibility = visibility?.onChange(() => {
          if (!visibility.hidden() && wakeVisible) {
            const wake = wakeVisible;
            wakeVisible = null;
            wake();
          }
        }) ?? null;
        void loop(generation);
      },
      stop: () => {
        if (!running) return;
        running = false;
        generation += 1;
        unwatchVisibility?.();
        unwatchVisibility = null;
        const wake = wakeVisible;
        wakeVisible = null;
        wake?.();
        setStatus({ state: "stopped", error: null, retryInMs: null });
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onStatus: (listener) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
      status: () => status
    };
  };

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
  var createFlows = ({ host: host2, client: client2, now = Date.now }) => {
    const api = host2.client;
    const lastTurn = /* @__PURE__ */ new Map();
    let delivering = false;
    const toast2 = async (kind, message) => {
      try {
        await api.toast({ kind, message });
      } catch {
      }
    };
    const latestVersion = async (slug) => {
      try {
        const { versions } = await client2.call("GET /designs/:slug/versions", { params: { slug } });
        return versions.reduce((max, version) => max === null || version.n > max ? version.n : max, null);
      } catch {
        return null;
      }
    };
    const markSent = async (slug, ids, version) => {
      if (ids.length === 0) return true;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await client2.call("POST /designs/:slug/comments/mark-sent", { params: { slug }, body: { ids, version } });
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
        await toast2("info", busyMessage);
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
      await client2.call("PATCH /designs/:slug", { params: { slug }, body: { sessionId: result.sessionId } });
      return result;
    };
    const deliver = async (slug, prompt, design, version, busyMessage) => {
      const selected = host2.session.get();
      if (design.sessionId && selected?.id === design.sessionId) {
        return { outcome: await promptSelected(selected, prompt.text, busyMessage), sessionId: selected.id };
      }
      if (design.sessionId) {
        await client2.call("PUT /outbox", {
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
          await client2.call("DELETE /outbox");
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
          const { chip } = await client2.call("POST /chip", {
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
          const { slug: slug2, chip: chip2 } = await client2.call("POST /chip", { body: { kind, brief: text, preset, projectDirectory: directory, sessionId: null } });
          const result = await api.startSession({ ...toAttachRequest(chip2), text: text || "Let's start this design.", navigation: "open" });
          if (result.sessionId === null) throw new FlowError("start-failed", MESSAGES.startFailed);
          await client2.call("PATCH /designs/:slug", { params: { slug: slug2 }, body: { sessionId: result.sessionId } });
          return { slug: slug2, sessionId: result.sessionId };
        }
        const session = host2.session.get();
        const { slug, chip } = await client2.call("POST /chip", {
          body: { kind, brief: text, preset, projectDirectory: directory, sessionId: session?.id ?? null }
        });
        await api.attach(toAttachRequest(chip));
        if (text) await api.compose({ text, mode: "append" });
        if (ready?.surface === "page") await api.close();
        return { slug, sessionId: session?.id ?? null };
      },
      continueInChat: async (slug) => {
        const { design } = await client2.call("GET /designs/:slug", { params: { slug } });
        if (design.sessionId) {
          try {
            await api.openSession(design.sessionId);
            return { outcome: "opened", sessionId: design.sessionId };
          } catch (error) {
            if (!isHostError(error, "NO_SESSION")) throw error;
          }
        }
        const { text, chip } = await client2.call("POST /designs/:slug/prompt", { params: { slug }, body: { purpose: "continue" } });
        const result = await startLinkedSession(slug, chip, text, design.projectDirectory);
        return { outcome: "new-session", sessionId: result.sessionId };
      },
      sendComments: async (slug, commentIds, anchorStates) => {
        const body = { purpose: "revision" };
        if (commentIds) body.commentIds = commentIds;
        if (anchorStates && Object.keys(anchorStates).length > 0) body.anchorStates = { ...anchorStates };
        const prompt = await client2.call("POST /designs/:slug/prompt", { params: { slug }, body });
        if (prompt.commentIds.length === 0) return { outcome: "nothing", sessionId: null, commentIds: [], omitted: prompt.omitted };
        const { design } = await client2.call("GET /designs/:slug", { params: { slug } });
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
        const prompt = await client2.call("POST /designs/:slug/prompt", { params: { slug }, body });
        const { design } = await client2.call("GET /designs/:slug", { params: { slug } });
        return deliver(slug, prompt, design, null, MESSAGES.busyAsk);
      },
      askAgent: async (slug, purpose) => {
        const prompt = await client2.call("POST /designs/:slug/prompt", { params: { slug }, body: { purpose } });
        const { design } = await client2.call("GET /designs/:slug", { params: { slug } });
        return deliver(slug, prompt, design, null, MESSAGES.busyAsk);
      },
      deliverOutbox: async (session = host2.session.get()) => {
        if (!session || delivering) return "none";
        delivering = true;
        try {
          const { outbox } = await client2.call("GET /outbox");
          if (!outbox || outbox.sessionId !== session.id || !isFresh(outbox, now())) return "none";
          const taken = (await client2.call("DELETE /outbox")).outbox;
          if (!taken) return "none";
          if (taken.sessionId !== session.id) {
            const { created: _created, ...rest } = taken;
            await client2.call("PUT /outbox", { body: rest });
            return "none";
          }
          const outcome = await promptSelected(session, taken.text, taken.commentIds.length === 0 ? MESSAGES.busyAsk : MESSAGES.busy);
          if (!await markSent(taken.slug, taken.commentIds, taken.version)) await toast2("info", MESSAGES.markFailed);
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
            await client2.call("PATCH /designs/:slug", { params: { slug: patch.slug }, body: { sessionId: patch.sessionId } });
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
        await client2.call("POST /versions/turn", { body: { sessionId } });
      },
      openAsPage: async (item, options = {}) => {
        if (extractHtml(item.text) === null) {
          await toast2("info", MESSAGES.noHtml);
          return null;
        }
        try {
          const uploadId = await client2.upload(item.text);
          const body = { uploadId, sessionId: item.sessionId, sessionTitle: item.sessionTitle, messageId: item.messageId, directory: item.directory };
          return await client2.call("POST /pages/from-message", { body: options.open ? { ...body, open: true } : body });
        } catch (error) {
          if (isServiceError(error, "no-html")) {
            await toast2("info", MESSAGES.noHtml);
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
        await toast2("success", opened ? MESSAGES.savedPage(created.title) : MESSAGES.savedPageClosed(created.title));
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
          await toast2("error", error instanceof Error && error.message ? error.message : MESSAGES.sendFailed);
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
          client2.call("DELETE /open-request").then(
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

  // src/guest/store.ts
  var renderSourceKey = (slug, screen) => `${slug}|${screen ?? ""}`;
  var idle = () => ({ status: "idle", data: null, error: null });
  var initialState = () => ({
    service: { state: "unknown", version: null, error: null },
    settings: idle(),
    designs: idle(),
    presets: idle(),
    open: null,
    versions: null,
    thumbs: {},
    renderRevs: {}
  });
  var affectedSources = (design, files) => {
    const screens = /* @__PURE__ */ new Set();
    for (const file of files) {
      if (file === "design.json") continue;
      if (design.kind === "canvas") {
        const screen = design.screens.find((entry) => entry.file === file);
        if (screen) {
          screens.add(screen.id);
          continue;
        }
      }
      return "all";
    }
    return [...screens];
  };
  var createStore = ({ client: client2 }) => {
    let state = initialState();
    let lastQuery = {};
    const listeners = /* @__PURE__ */ new Set();
    const set = (patch) => {
      const previous = state;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(state, previous);
    };
    const load = async (read, write, request) => {
      const before = read();
      write({ status: "loading", data: before?.data ?? null, error: null });
      const ticket = read();
      try {
        const data = await request();
        if (read() !== ticket) return;
        write({ status: "ready", data, error: null });
      } catch (error) {
        if (read() !== ticket) return;
        write({ status: "error", data: before?.data ?? null, error: toServiceError(error) });
      }
    };
    const mutate = async (run) => {
      try {
        return await run();
      } catch (error) {
        throw toServiceError(error);
      }
    };
    const bumpRevs = (slug, sources) => {
      const renderRevs = { ...state.renderRevs };
      for (const source of sources) {
        const key = renderSourceKey(slug, source);
        renderRevs[key] = (renderRevs[key] ?? 0) + 1;
      }
      set({ renderRevs });
    };
    const sourcesOf = (design) => design.kind === "page" ? [null] : design.screens.map((screen) => screen.id);
    const replaceComment = (slug, comment) => {
      const open = state.open;
      if (!open || open.slug !== slug || !open.data) return;
      const comments = open.data.design.comments.some((entry) => entry.id === comment.id) ? open.data.design.comments.map((entry) => entry.id === comment.id ? comment : entry) : [...open.data.design.comments, comment];
      set({ open: { ...open, data: { ...open.data, design: { ...open.data.design, comments } } } });
    };
    const store2 = {
      getState: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      checkHealth: async () => {
        try {
          const health = await client2.call("GET /health");
          set({ service: { state: "ready", version: health.version, error: null } });
        } catch (error) {
          set({ service: { state: "error", version: null, error: toServiceError(error) } });
        }
      },
      loadSettings: () => load(
        () => state.settings,
        (settings) => set({ settings }),
        () => client2.call("GET /settings")
      ),
      updateSettings: (body) => mutate(async () => {
        const settings = await client2.call("PUT /settings", { body });
        set({ settings: { status: "ready", data: settings, error: null } });
        return settings;
      }),
      loadPresets: () => load(
        () => state.presets,
        (presets) => set({ presets }),
        () => client2.call("GET /presets")
      ),
      refreshDesigns: (query) => {
        if (query) lastQuery = query;
        const current = {};
        if (lastQuery.q) current.q = lastQuery.q;
        if (lastQuery.kind) current.kind = lastQuery.kind;
        return load(
          () => state.designs,
          (designs) => set({ designs }),
          () => client2.call("GET /designs", { query: current })
        );
      },
      openDesign: async (slug) => {
        const keep = state.open?.slug === slug ? state.open.data : null;
        set({ open: { slug, status: "loading", data: keep, error: null }, versions: state.versions?.slug === slug ? state.versions : null });
        await store2.refreshOpenDesign();
      },
      closeDesign: () => set({ open: null, versions: null }),
      refreshOpenDesign: async () => {
        const open = state.open;
        if (!open) return;
        const slug = open.slug;
        await load(
          () => state.open?.slug === slug ? state.open : null,
          (slot) => {
            if (state.open?.slug === slug) set({ open: { ...slot, slug } });
          },
          () => client2.call("GET /designs/:slug", { params: { slug } })
        );
      },
      renameDesign: (slug, title) => store2.patchDesign(slug, { title }),
      patchDesign: (slug, body) => mutate(async () => {
        const { design } = await client2.call("PATCH /designs/:slug", { params: { slug }, body });
        const open = state.open;
        if (open?.slug === slug && open.data) set({ open: { ...open, data: { ...open.data, design } } });
        const list = state.designs.data;
        if (list) {
          const designs = list.designs.map(
            (entry) => entry.slug === slug ? { ...entry, title: design.title, sessionId: design.sessionId, updated: design.updated } : entry
          );
          set({ designs: { ...state.designs, data: { ...list, designs } } });
        }
        return design;
      }),
      deleteDesign: (slug) => mutate(async () => {
        const { trashedTo } = await client2.call("DELETE /designs/:slug", { params: { slug } });
        const list = state.designs.data;
        if (list) set({ designs: { ...state.designs, data: { ...list, designs: list.designs.filter((entry) => entry.slug !== slug) } } });
        if (state.open?.slug === slug) set({ open: null, versions: null });
        return trashedTo;
      }),
      addComment: (slug, body) => mutate(async () => {
        const { comment } = await client2.call("POST /designs/:slug/comments", { params: { slug }, body });
        replaceComment(slug, comment);
        return comment;
      }),
      updateComment: (slug, id, patch) => mutate(async () => {
        const { comment } = await client2.call("PATCH /designs/:slug/comments/:id", { params: { slug, id }, body: patch });
        replaceComment(slug, comment);
        return comment;
      }),
      deleteComment: (slug, id) => mutate(async () => {
        await client2.call("DELETE /designs/:slug/comments/:id", { params: { slug, id } });
        const open = state.open;
        if (open?.slug === slug && open.data) {
          const comments = open.data.design.comments.filter((entry) => entry.id !== id);
          set({ open: { ...open, data: { ...open.data, design: { ...open.data.design, comments } } } });
        }
      }),
      loadVersions: async (slug) => {
        if (state.versions?.slug !== slug) set({ versions: { slug, status: "idle", data: null, error: null } });
        await load(
          () => state.versions?.slug === slug ? state.versions : null,
          (slot) => {
            if (state.versions?.slug === slug) set({ versions: { ...slot, slug } });
          },
          () => client2.call("GET /designs/:slug/versions", { params: { slug } })
        );
      },
      snapshotVersion: (slug, label) => mutate(async () => {
        const body = { reason: "manual" };
        if (label) body.label = label;
        const { created } = await client2.call("POST /designs/:slug/versions", { params: { slug }, body });
        if (state.versions?.slug === slug) void store2.loadVersions(slug);
        return created;
      }),
      restoreVersion: (slug, versionId) => mutate(async () => {
        const answer = await client2.call("POST /designs/:slug/versions/:vid/restore", { params: { slug, vid: versionId } });
        if (state.versions?.slug === slug) void store2.loadVersions(slug);
        if (state.open?.slug === slug && state.open.data) bumpRevs(slug, sourcesOf(state.open.data.design));
        return answer;
      }),
      diffVersion: (slug, versionId, against) => mutate(
        () => client2.call("GET /designs/:slug/versions/:vid/diff", { params: { slug, vid: versionId }, query: against ? { against } : {} })
      ),
      loadRender: (slug, screen, version = null) => mutate(() => client2.loadRender(slug, screen, version)),
      loadThumbnail: async (slug) => {
        const summary = state.designs.data?.designs.find((entry) => entry.slug === slug);
        try {
          const thumb = await client2.thumbnail(slug, summary?.thumb.key ?? null);
          set({ thumbs: { ...state.thumbs, [slug]: thumb } });
          return thumb;
        } catch {
          return null;
        }
      },
      loadSource: (slug, screen = null) => mutate(() => client2.call("GET /designs/:slug/source", { params: { slug }, query: screen ? { screen } : {} })),
      exportDesign: (slug, body) => mutate(() => client2.call("POST /designs/:slug/export", { params: { slug }, body })),
      reveal: (path) => mutate(async () => {
        await client2.call("POST /reveal", { body: { path } });
      }),
      applyChanges: async (batch) => {
        const tasks = [];
        const openSlug = state.open?.slug ?? null;
        const openDesign = state.open?.data?.design ?? null;
        if (batch.reset) {
          tasks.push(store2.refreshDesigns(), store2.loadSettings());
          if (openSlug) {
            tasks.push(store2.refreshOpenDesign());
            if (openDesign) bumpRevs(openSlug, sourcesOf(openDesign));
          }
          if (state.versions) tasks.push(store2.loadVersions(state.versions.slug));
          await Promise.all(tasks);
          return;
        }
        let list = false;
        let detail = false;
        let recreated = false;
        let versions = false;
        let settings = false;
        const thumbs = /* @__PURE__ */ new Set();
        const revs = /* @__PURE__ */ new Map();
        for (const event of batch.events) {
          switch (event.kind) {
            case "root":
              settings = true;
              list = true;
              break;
            case "loose":
              list = true;
              break;
            case "added":
              list = true;
              if (event.slug === openSlug) {
                detail = true;
                recreated = true;
              }
              break;
            case "removed":
            case "design":
              list = true;
              if (event.slug === openSlug) detail = true;
              break;
            case "comments":
              list = true;
              if (event.slug === openSlug) detail = true;
              break;
            case "files":
              list = true;
              if (event.slug && event.slug === openSlug && openDesign) {
                detail = true;
                const touched = affectedSources(openDesign, event.files ?? []);
                const known = revs.get(event.slug);
                if (touched === "all" || known === "all") revs.set(event.slug, "all");
                else revs.set(event.slug, /* @__PURE__ */ new Set([...known ?? [], ...touched]));
              }
              break;
            case "thumb":
              if (event.slug) thumbs.add(event.slug);
              break;
            case "versions":
              if (event.slug && state.versions?.slug === event.slug) versions = true;
              break;
            case "open":
            case "activity":
              break;
          }
        }
        for (const [slug, touched] of revs) {
          if (!openDesign) break;
          const sources = touched === "all" ? sourcesOf(openDesign) : [...touched];
          if (sources.length > 0) bumpRevs(slug, sources);
        }
        if (list) tasks.push(store2.refreshDesigns());
        if (settings) tasks.push(store2.loadSettings());
        if (detail && recreated && openSlug) {
          tasks.push(
            store2.refreshOpenDesign().then(() => {
              const design = state.open?.slug === openSlug ? state.open.data?.design : null;
              if (design) bumpRevs(openSlug, sourcesOf(design));
            })
          );
        } else if (detail) tasks.push(store2.refreshOpenDesign());
        if (versions && state.versions) tasks.push(store2.loadVersions(state.versions.slug));
        for (const slug of thumbs) tasks.push(store2.loadThumbnail(slug));
        await Promise.all(tasks);
      },
      connect: (feed2) => {
        const unsubscribe = feed2.subscribe((batch) => void store2.applyChanges(batch));
        feed2.start();
        return () => {
          unsubscribe();
          feed2.stop();
        };
      }
    };
    return store2;
  };

  // src/ui/guest.ts
  var guestHost;
  var client;
  var store;
  var flows;
  var feed;
  var startGuest = (nextHost, nextClient) => {
    guestHost = nextHost;
    client = nextClient;
    store = createStore({ client });
    flows = createFlows({ host: guestHost, client });
    feed = createChangeFeed(client);
    store.connect(feed);
  };
  var swallow = (what) => (error) => {
    console.warn(`Design Chamber: ${what} failed`, error);
  };
  var host = {
    snapshot: () => guestHost.ready.get(),
    session: () => guestHost.session.get(),
    /** Every ready snapshot (theme switches included), starting with the current one. */
    onReady: (listener) => guestHost.ready.subscribe((context) => {
      if (context) listener(context);
    }),
    toast: (request) => guestHost.client.toast(request).catch(swallow("toast")),
    openUrl: (url) => guestHost.client.openUrl(url).catch(swallow("openUrl")),
    writeClipboard: (text) => guestHost.client.writeClipboard(text).then(
      () => true,
      (error) => {
        swallow("writeClipboard")(error);
        return false;
      }
    ),
    storage: {
      get: (key) => guestHost.client.storage.get(key).catch(() => void 0),
      set: (key, value) => (
        // Safe: callers pass plain JSON; the host rejects anything else and the error is swallowed.
        guestHost.client.storage.set(key, value).catch(swallow("storage.set"))
      )
    }
  };
  var askAgent = async (slug, purpose) => (await flows.askAgent(slug, purpose)).outcome;
  var askSelfContained = (slug) => askAgent(slug, "offline");

  // src/ui/model/new-model.ts
  var DESTINATIONS = [
    { id: "new-chat", label: "New chat", hint: "Starts a chat in this project." },
    { id: "current-chat", label: "Current chat", hint: "Attaches the design to the chat you have open." }
  ];
  var kindHint = (kind) => kind === "canvas" ? "A wall of screens at several device sizes, with comments and versions." : "One HTML page shown full screen, with comments and versions. Export it as a ZIP or a single file.";
  var startLabel = (kind) => kind === "canvas" ? "Start canvas" : "Start page";
  var validateBrief = (brief) => brief.length > BRIEF_MAX ? `Keep the brief under ${BRIEF_MAX} characters.` : null;
  var briefPlaceholder = (kind) => kind === "canvas" ? "e.g. A pricing page for a coffee subscription, laptop and phone" : "e.g. A single-page invoice template I can print";
  var presetOptions = (presets) => [
    { id: "", label: "None, let the agent suggest one" },
    ...presets.map((preset) => ({ id: preset.id, label: preset.name, hint: preset.bestFor }))
  ];

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
  var replace = (node, ...children) => {
    node.replaceChildren();
    append(node, ...children);
  };
  var createScope = () => {
    const disposers = [];
    const scope = {
      add: (dispose) => {
        disposers.push(dispose);
        return dispose;
      },
      own: (handle) => {
        disposers.push(() => handle.dispose());
        return handle;
      },
      listen: (target, type, listener, options) => {
        const typed = listener;
        target.addEventListener(type, typed, options);
        disposers.push(() => target.removeEventListener(type, typed, options));
      },
      dispose: () => {
        while (disposers.length > 0) disposers.pop()?.();
      }
    };
    return scope;
  };
  var errorText2 = (error) => error instanceof Error && error.message !== "" ? error.message : "Something unexpected happened. Try again.";
  var debounce = (fn, ms) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };
  var uid = 0;
  var nextId2 = (prefix) => `${prefix}-${uid += 1}`;

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
    layers: ["m12 3 9 5-9 5-9-5z", "m3 13 9 5 9-5"]
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

  // src/ui/components/kit.ts
  var btn = (options) => {
    const state = { ...options };
    const el2 = h("button", { type: "button", class: "oc-sdk oc-sdk-btn", "data-variant": options.variant ?? "outline", "data-size": options.size ?? "sm" });
    if (options.emphasis) el2.dataset.emphasis = options.emphasis;
    const label = h("span", { class: "dc-btn-label" });
    const ring2 = h("span", { class: "oc-sdk-spinner-ring", "aria-hidden": "true" });
    let glyph = options.icon ? icon2(options.icon, 14) : null;
    let glyphName = options.icon;
    const paint = () => {
      if (state.icon !== glyphName) {
        const next = state.icon ? icon2(state.icon, 14) : null;
        if (glyph && next) glyph.replaceWith(next);
        else if (glyph) glyph.remove();
        else if (next) label.before(next);
        glyph = next;
        glyphName = state.icon;
      }
      label.textContent = state.label;
      el2.disabled = Boolean(state.disabled) || Boolean(state.loading);
      el2.dataset.loading = state.loading ? "true" : "false";
      el2.setAttribute("aria-busy", state.loading ? "true" : "false");
      if (state.pressed !== void 0) el2.setAttribute("aria-pressed", String(state.pressed));
      if (state.title) el2.title = state.title;
      else el2.removeAttribute("title");
      ring2.hidden = !state.loading;
    };
    append(el2, ring2, glyph, label, options.chevron ? icon2("chevron", 14) : null);
    el2.addEventListener("click", (event) => {
      if (!state.disabled && !state.loading) state.onClick(event);
    });
    paint();
    return {
      el: el2,
      set: (next) => {
        Object.assign(state, next);
        paint();
      }
    };
  };
  var iconBtn = (options) => {
    const el2 = h("button", { type: "button", class: "oc-sdk dc-iconbtn", "data-size": options.size ?? "md", "aria-label": options.label, title: options.label, disabled: options.disabled });
    if (options.pressed !== void 0) el2.setAttribute("aria-pressed", String(options.pressed));
    el2.append(icon2(options.icon, options.size === "sm" ? 14 : 16));
    el2.addEventListener("click", options.onClick);
    return el2;
  };
  var actionsOf = (items) => items.filter((item) => "id" in item);
  var openMenuClose = null;
  var openMenu = (anchor, items, onSelect) => {
    openMenuClose?.();
    const uid2 = nextId2("dc-menu");
    const popup = h("div", { class: "oc-sdk oc-sdk-popup dc-popup", role: "menu", tabindex: "-1", "aria-label": anchor.getAttribute("aria-label") ?? void 0 });
    let activeId = null;
    const rows = /* @__PURE__ */ new Map();
    const setActive = (id) => {
      activeId = id;
      for (const [rowId, row2] of rows) row2.dataset.active = rowId === id ? "true" : "false";
      const row = id ? rows.get(id) : void 0;
      if (row) {
        popup.setAttribute("aria-activedescendant", row.id);
        row.scrollIntoView({ block: "nearest" });
      } else popup.removeAttribute("aria-activedescendant");
    };
    let closed = false;
    const close = (restoreFocus = true) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("blur", onDismiss);
      popup.remove();
      anchor.setAttribute("aria-expanded", "false");
      if (openMenuClose === close) openMenuClose = null;
      if (restoreFocus) anchor.focus();
    };
    const onDismiss = () => close(false);
    const onOutside = (event) => {
      if (event.target instanceof Node && (popup.contains(event.target) || anchor.contains(event.target))) return;
      close(false);
    };
    const pick = (id) => {
      close();
      onSelect(id);
    };
    for (const item of items) {
      if (!("id" in item)) {
        popup.append(h("div", { class: "oc-sdk-separator", "data-labeled": "false" }));
        continue;
      }
      const row = h(
        "button",
        { type: "button", role: "menuitem", tabindex: "-1", id: `${uid2}-${item.id}`, class: "oc-sdk-option", "data-destructive": item.destructive ? "true" : "false", disabled: item.disabled },
        h("span", { class: "oc-sdk-option-label" }, item.label),
        item.hint ? h("span", { class: "oc-sdk-option-hint" }, item.hint) : null
      );
      row.addEventListener("pointerenter", () => setActive(item.id));
      row.addEventListener("click", () => pick(item.id));
      rows.set(item.id, row);
      popup.append(row);
    }
    popup.addEventListener("keydown", (event) => {
      const step = navigationKey(event);
      if (step) {
        event.preventDefault();
        setActive(moveListSelection(actionsOf(items), activeId, step));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (activeId) pick(activeId);
      } else if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        close();
      }
    });
    document.body.append(popup);
    const rect = anchor.getBoundingClientRect();
    popup.style.minWidth = `${Math.max(176, Math.round(rect.width))}px`;
    popup.style.left = `${Math.round(rect.left)}px`;
    popup.style.top = `${Math.round(rect.bottom + 4)}px`;
    const height = popup.offsetHeight;
    const below = window.innerHeight - rect.bottom - 8;
    if (height > below && rect.top - 8 > below) popup.style.top = `${Math.max(8, Math.round(rect.top - 4 - height))}px`;
    const overflow = rect.left + popup.offsetWidth - window.innerWidth + 8;
    if (overflow > 0) popup.style.left = `${Math.max(8, Math.round(rect.left - overflow))}px`;
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "true");
    openMenuClose = close;
    setActive(actionsOf(items).find((item) => !item.disabled)?.id ?? null);
    popup.focus();
    return close;
  };
  var attachMenu = (trigger, items, onSelect) => {
    let close = null;
    trigger.addEventListener("click", () => {
      if (trigger.getAttribute("aria-expanded") === "true") {
        close?.();
        close = null;
        return;
      }
      close = openMenu(trigger, items(), onSelect);
    });
  };
  var banner = (props) => {
    const wrap = h("div", { class: "dc-banner" });
    mountBanner(wrap, props);
    return wrap;
  };
  var bannerWithActions = (tone2, title, body, actions) => {
    const holder = h("div");
    mountBanner(holder, { tone: tone2, title, body: " " });
    const bodyEl = holder.querySelector(".oc-sdk-banner-body");
    if (bodyEl) {
      replace(bodyEl, ...body);
      bodyEl.hidden = body.length === 0;
    }
    const slot = holder.querySelector(".oc-sdk-banner-action");
    if (slot) {
      slot.hidden = false;
      slot.replaceChildren(h("div", { class: "dc-row-actions" }, ...actions));
    }
    return [...holder.childNodes].filter((node) => node instanceof HTMLElement);
  };
  var loadingRow = (label) => {
    const wrap = h("div", { class: "dc-loading" });
    mountSpinner(wrap, { label });
    return wrap;
  };
  var modalStack = [];
  var modalKeysInstalled = false;
  var installModalKeys = () => {
    if (modalKeysInstalled) return;
    modalKeysInstalled = true;
    document.addEventListener("keydown", (event) => {
      const top = modalStack[modalStack.length - 1];
      if (!top || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        top.dismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(top.panel.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active2 = document.activeElement;
      if (!(active2 instanceof Node) || !top.panel.contains(active2)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active2 === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active2 === last) {
        event.preventDefault();
        first.focus();
      }
    });
  };
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var openSheet = (host2, options) => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const titleId = nextId2("dc-sheet-title");
    const modal = options.variant !== "dock";
    const title = h("h2", { class: "dc-sheet-title", id: titleId }, options.title);
    const close = h("button", { type: "button", class: "oc-sdk dc-iconbtn", "aria-label": `Close ${options.title.toLowerCase()}`, title: "Close" }, icon2("close", 16));
    const body = h("div", { class: "dc-sheet-body" });
    const foot = h("div", { class: "dc-sheet-foot" });
    const panel = h(
      "section",
      { class: "dc-sheet-panel", role: modal ? "dialog" : "region", "aria-modal": modal ? "true" : null, "aria-labelledby": titleId, tabindex: "-1" },
      h("header", { class: "dc-sheet-head" }, h("div", { class: "dc-sheet-heading" }, title, options.subtitle ? h("p", { class: "dc-sheet-sub" }, options.subtitle) : null), close),
      body,
      foot
    );
    const scrim = modal && options.variant !== "full" ? h("div", { class: "dc-sheet-scrim" }) : null;
    const el2 = h("div", { class: "dc-sheet", "data-variant": options.variant }, scrim, panel);
    const scope = createScope();
    let closed = false;
    const dismiss = () => {
      if (closed) return;
      closed = true;
      scope.dispose();
      el2.remove();
      options.onClose?.();
      if (modal) returnFocus?.focus();
    };
    close.addEventListener("click", dismiss);
    scrim?.addEventListener("pointerdown", dismiss);
    if (!modal) {
      panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          dismiss();
        }
      });
    } else {
      const entry = { panel, dismiss };
      modalStack.push(entry);
      scope.add(() => modalStack.splice(modalStack.indexOf(entry), 1));
      installModalKeys();
    }
    host2.append(el2);
    queueMicrotask(() => {
      const first = body.querySelector("input,textarea,select,button");
      (first ?? panel).focus({ preventScroll: true });
    });
    return { el: el2, body, foot, setTitle: (next) => void (title.textContent = next), close: dismiss };
  };
  var confirmDialog = (host2, options) => {
    const sheet = openSheet(host2, { title: options.title, variant: "dialog" });
    const failure = h("p", { class: "dc-form-error", role: "alert", hidden: true });
    sheet.body.append(h("div", { class: "dc-confirm-body" }, options.body), failure);
    const cancel = btn({ label: "Cancel", variant: "ghost", onClick: () => sheet.close() });
    const confirm = btn({
      label: options.confirmLabel,
      variant: options.destructive ? "destructive" : "default",
      onClick: () => {
        confirm.set({ loading: true });
        cancel.set({ disabled: true });
        failure.hidden = true;
        options.onConfirm().then(
          () => sheet.close(),
          (error) => {
            failure.textContent = errorText2(error);
            failure.hidden = false;
            confirm.set({ loading: false });
            cancel.set({ disabled: false });
          }
        );
      }
    });
    sheet.foot.append(cancel.el, confirm.el);
  };
  var POPOVER_WIDTH = 420;
  var POPOVER_MARGIN = 8;
  var openPopoverClose = null;
  var openPopover = (host2, anchor, options) => {
    openPopoverClose?.();
    const titleId = nextId2("dc-pop-title");
    const body = h("div", { class: "dc-pop-body" });
    const foot = h("div", { class: "dc-pop-foot" });
    const closeButton = h("button", { type: "button", class: "oc-sdk dc-iconbtn", "aria-label": `Close ${options.title.toLowerCase()}`, title: "Close" }, icon2("close", 16));
    const el2 = h(
      "section",
      { class: "dc-pop", role: "dialog", "aria-labelledby": titleId, tabindex: "-1" },
      h("header", { class: "dc-pop-head" }, h("h2", { class: "dc-pop-title", id: titleId }, options.title), closeButton),
      body,
      foot
    );
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * POPOVER_MARGIN);
      const left = Math.min(Math.max(POPOVER_MARGIN, rect.right - width), window.innerWidth - POPOVER_MARGIN - width);
      const top = Math.round(rect.bottom + 4);
      el2.style.width = `${width}px`;
      el2.style.left = `${Math.round(left)}px`;
      el2.style.top = `${top}px`;
      el2.style.maxHeight = `${Math.max(160, Math.min(window.innerHeight * 0.6, window.innerHeight - top - POPOVER_MARGIN))}px`;
    };
    let closed = false;
    const close = (restoreFocus = true) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      el2.remove();
      anchor.setAttribute("aria-expanded", "false");
      if (openPopoverClose === closeSelf) openPopoverClose = null;
      options.onClose?.();
      if (restoreFocus) anchor.focus();
    };
    const closeSelf = () => close(false);
    const onOutside = (event) => {
      if (event.target instanceof Node && (el2.contains(event.target) || anchor.contains(event.target))) return;
      close(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(el2.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active2 = document.activeElement;
      if (!(active2 instanceof Node) || !el2.contains(active2)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active2 === first || active2 === el2)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active2 === last) {
        event.preventDefault();
        first.focus();
      }
    };
    closeButton.addEventListener("click", () => close());
    host2.append(el2);
    place();
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    anchor.setAttribute("aria-haspopup", "dialog");
    anchor.setAttribute("aria-expanded", "true");
    openPopoverClose = closeSelf;
    return { el: el2, body, foot, close };
  };

  // src/ui/components/actions.ts
  var designMenu = (options) => [
    ...options.includeOpen ? [{ id: "open", label: "Open" }] : [],
    { id: "continue", label: "Continue in chat" },
    { id: "reveal", label: "Reveal in folder" },
    { id: "rename", label: "Rename" },
    { separator: true },
    { id: "delete", label: "Delete\u2026", destructive: true }
  ];
  var toast = (kind, message, copy) => {
    void host.toast(copy ? { kind, message, copy: { text: copy }, dismiss: true } : { kind, message, dismiss: kind === "error" });
  };
  var continueInChat = async (slug) => {
    try {
      await flows.continueInChat(slug);
    } catch (error) {
      toast("error", `Couldn\u2019t open the chat. ${errorText2(error)}`);
    }
  };
  var reveal = async (path) => {
    try {
      await store.reveal(path);
    } catch (error) {
      toast("error", `Couldn\u2019t open the folder. ${errorText2(error)}`);
    }
  };
  var folderOf = async (slug) => (await client.call("GET /designs/:slug", { params: { slug } })).path;
  var revealDesign = async (slug) => {
    try {
      await reveal(await folderOf(slug));
    } catch (error) {
      toast("error", `Couldn\u2019t find that folder. ${errorText2(error)}`);
    }
  };
  var copyPath = async (slug) => {
    try {
      const path = await folderOf(slug);
      if (await host.writeClipboard(path)) toast("success", "Folder path copied.");
      else toast("error", "Couldn\u2019t reach the clipboard. The path is in this notification, so copy it from there.", path);
    } catch (error) {
      toast("error", `Couldn\u2019t read the folder path. ${errorText2(error)}`);
    }
  };
  var copyHtml = async (slug, screen) => {
    try {
      const source = await store.loadSource(slug, screen ?? null);
      if (source.text.length > HOST_CLIPBOARD_MAX) {
        toast("info", "This page is too large to copy as text. Use Copy path, or Export HTML.");
        return;
      }
      if (await host.writeClipboard(source.text)) toast("success", "HTML copied.");
      else toast("error", "Couldn\u2019t reach the clipboard. Try Export HTML instead.");
    } catch (error) {
      toast("error", `Couldn\u2019t read the HTML. ${errorText2(error)}`);
    }
  };
  var exportDesign = async (slug, format, screen) => {
    try {
      const result = await store.exportDesign(slug, screen ? { format, screen } : { format });
      toast("success", `Saved to ${result.path}`, result.path);
      return { path: result.path, format };
    } catch (error) {
      toast("error", `Couldn\u2019t export. ${errorText2(error)}`);
      return null;
    }
  };
  var renameDesign = async (slug, title) => {
    const next = title.trim();
    if (next === "") throw new Error("A design needs a name.");
    if (next.length > 120) throw new Error("Keep the name under 120 characters.");
    await store.renameDesign(slug, next);
  };
  var confirmDelete = (context, design) => {
    confirmDialog(context.host, {
      title: "Delete this design?",
      body: h("p", null, `\u201C${design.title}\u201D moves to the .trash folder inside your Designs folder. Nothing is erased, and you can move it back by hand.`),
      confirmLabel: "Move to trash",
      destructive: true,
      onConfirm: async () => {
        try {
          await store.deleteDesign(design.slug);
        } catch (error) {
          throw new Error(`Couldn\u2019t move it to the trash. ${errorText2(error)}`);
        }
        context.onRemoved(design.slug);
        toast("success", `\u201C${design.title}\u201D moved to the trash.`);
      }
    });
  };
  var renameDialog = (hostEl, design) => {
    const sheet = openSheet(hostEl, { title: "Rename design", variant: "dialog" });
    let value = design.title;
    const field2 = mountTextField(sheet.body, { label: "Name", value, onChange: (next) => void (value = next), helper: "Shown in the list and on the wall. The folder name stays the same." });
    const submit = btn({ label: "Save name", variant: "default", onClick: () => void save() });
    const cancel = btn({ label: "Cancel", variant: "ghost", onClick: () => sheet.close() });
    const save = async () => {
      submit.set({ loading: true });
      cancel.set({ disabled: true });
      try {
        await renameDesign(design.slug, value);
        sheet.close();
      } catch (error) {
        field2.update({ error: errorText2(error) });
        submit.set({ loading: false });
        cancel.set({ disabled: false });
      }
    };
    sheet.body.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        void save();
      }
    });
    sheet.foot.append(cancel.el, submit.el);
    queueMicrotask(() => sheet.body.querySelector("input")?.select());
  };
  var runDesignAction = (id, design, context) => {
    switch (id) {
      case "open":
        context.onOpen(design.slug);
        return;
      case "continue":
        void continueInChat(design.slug);
        return;
      case "reveal":
        void revealDesign(design.slug);
        return;
      case "rename":
        renameDialog(context.host, design);
        return;
      case "delete":
        confirmDelete(context, design);
        return;
    }
  };

  // src/ui/components/new-dialog.ts
  var openNewDialog = (hostEl, options) => {
    let unsubscribe = () => {
    };
    const sheet = openSheet(hostEl, { title: "New design", variant: "dialog", subtitle: "Your chat agent writes the files; they appear here as it works.", onClose: () => unsubscribe() });
    let kind = options.kind;
    let brief = "";
    let preset = "";
    let destination = "new-chat";
    const kindHost = h("div", { class: "dc-field" }, h("span", { class: "oc-sdk-field-label" }, "Type"));
    const kindTabs = mountTabs(kindHost, {
      items: [
        { id: "canvas", label: "Canvas" },
        { id: "page", label: "Page" }
      ],
      activeId: kind,
      trackBackground: true,
      onChange: (id) => {
        kind = id === "page" ? "page" : "canvas";
        kindTabs.update({ activeId: kind });
        kindNote.textContent = kindHint(kind);
        briefField.update({ placeholder: briefPlaceholder(kind) });
        submit.set({ label: startLabel(kind) });
      }
    });
    const kindNote = h("p", { class: "oc-sdk-field-note" }, kindHint(kind));
    kindHost.append(kindNote);
    const briefHost = h("div");
    const briefField = mountTextField(briefHost, {
      label: "What should it be?",
      value: brief,
      multiline: true,
      rows: 4,
      placeholder: briefPlaceholder(kind),
      helper: "Optional. Leave it empty and the agent will ask.",
      onChange: (next) => {
        brief = next;
        briefField.update({ error: validateBrief(next) ?? void 0 });
      }
    });
    const presetHost = h("div", { class: "dc-field" });
    const presetSelect = mountSelect(presetHost, { label: "Style preset", value: "", options: presetOptions([]), disabled: true, onChange: (id) => void (preset = id) });
    const presetNote = h("p", { class: "oc-sdk-field-note", hidden: true });
    presetHost.append(presetNote);
    const paintPresets = () => {
      const state = store.getState().presets;
      if (state.status === "ready" && state.data) presetSelect.update({ options: presetOptions(state.data.presets), disabled: false, value: preset });
      if (state.status === "error") {
        presetNote.textContent = "Style presets didn\u2019t load, so the agent will choose the style. You can still start.";
        presetNote.hidden = false;
      }
    };
    unsubscribe = store.subscribe(paintPresets);
    void store.loadPresets();
    paintPresets();
    const destHost = h("div", { class: "dc-field" }, h("span", { class: "oc-sdk-field-label" }, "Where should the agent work?"));
    const destTabs = mountTabs(destHost, {
      items: DESTINATIONS.map(({ id, label }) => ({ id, label })),
      activeId: destination,
      trackBackground: true,
      onChange: (id) => {
        destination = id === "current-chat" ? "current-chat" : "new-chat";
        destTabs.update({ activeId: destination });
        paintDest();
      }
    });
    const destHint = h("p", { class: "oc-sdk-field-note" });
    destHost.append(destHint);
    const paintDest = () => {
      const base = DESTINATIONS.find((entry) => entry.id === destination)?.hint ?? "";
      const noSession = destination === "current-chat" && host.session() === null;
      destHint.textContent = noSession ? "No chat is open right now. Choose New chat, or open one first." : base;
    };
    paintDest();
    const failure = h("p", { class: "dc-form-error", role: "alert", hidden: true });
    const cancel = btn({ label: "Cancel", variant: "ghost", onClick: () => sheet.close() });
    const submit = btn({
      label: startLabel(kind),
      variant: "default",
      emphasis: "primary",
      onClick: () => {
        const problem = validateBrief(brief);
        if (problem !== null) {
          briefField.update({ error: problem });
          return;
        }
        failure.hidden = true;
        submit.set({ loading: true });
        cancel.set({ disabled: true });
        flows.newDesign({ kind, brief, preset: preset === "" ? null : preset, destination }).then(
          ({ slug }) => {
            toast("success", "Design started. It shows up in your list while the agent works.");
            sheet.close();
            options.onCreated(slug);
          },
          (error) => {
            failure.textContent = errorText2(error);
            failure.hidden = false;
            submit.set({ loading: false });
            cancel.set({ disabled: false });
          }
        );
      }
    });
    sheet.body.append(kindHost, briefHost, presetHost, destHost, failure);
    sheet.foot.append(cancel.el, submit.el);
  };

  // src/ui/model/place-model.ts
  var placeKey = (surface) => `place:${surface}`;
  var storedPlace = (slug) => ({ slug });
  var readPlace = (stored) => {
    if (typeof stored !== "object" || stored === null || !("slug" in stored)) return null;
    return typeof stored.slug === "string" && SLUG_PATTERN.test(stored.slug) ? stored.slug : null;
  };
  var decideRestore = ({ stored, designs, alreadyOpen }) => {
    if (alreadyOpen) return { action: "skip" };
    const slug = readPlace(stored);
    if (slug === null) return { action: "skip" };
    if (designs === null) return { action: "wait" };
    return designs.some((design) => design.slug === slug) ? { action: "open", slug } : { action: "drop" };
  };

  // src/ui/components/place-memory.ts
  var keepPlace = ({ surface, isOpen, open }) => {
    const key = placeKey(surface);
    let stored;
    let loaded = false;
    let settled2 = false;
    let unsubscribe = () => void 0;
    const settle = () => {
      settled2 = true;
      unsubscribe();
    };
    const evaluate = () => {
      if (settled2 || !loaded) return;
      const decision = decideRestore({ stored, designs: store.getState().designs.data?.designs ?? null, alreadyOpen: isOpen() });
      if (decision.action === "wait") return;
      settle();
      if (decision.action === "open") open(decision.slug);
      else if (decision.action === "drop") void host.storage.set(key, null);
    };
    unsubscribe = store.subscribe(evaluate);
    void host.storage.get(key).then((value) => {
      stored = value;
      loaded = true;
      evaluate();
    });
    return {
      remember: (slug) => {
        settle();
        void host.storage.set(key, storedPlace(slug));
      },
      clear: () => {
        settle();
        void host.storage.set(key, null);
      }
    };
  };

  // src/shared/agent/ownership.ts
  var OWNERSHIP_PLACEHOLDER = "0".repeat(64);
  var K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);

  // src/shared/agent/guide.ts
  var GUIDE_FILE = "AGENTS.md";
  var CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
  var assertRoot = (root, label = "designs folder") => {
    if (typeof root !== "string" || root.trim() === "") throw new Error(`The ${label} path is empty.`);
    if (CONTROL_CHARACTER.test(root)) throw new Error(`The ${label} path contains a control character.`);
  };
  var capped = (text, max, what) => {
    if (text.length > max) throw new Error(`The ${what} would be ${text.length} characters, over the ${max} limit: the designs folder path is too long.`);
    return text;
  };
  var separatorOf = (anyPath) => /^[A-Za-z]:[\\/]|^\\\\/.test(anyPath) || anyPath.includes("\\") && !anyPath.includes("/") ? "\\" : "/";
  var joinWith = (sep, root, ...parts) => {
    const base = root.endsWith("/") || root.endsWith("\\") ? root.slice(0, -1) : root;
    return [base, ...parts].join(sep);
  };
  var buildAgentsSnippet = (root) => {
    assertRoot(root);
    const guide = joinWith(separatorOf(root), root, GUIDE_FILE);
    const text = [
      "## Designs (Design Chamber)",
      `When I ask for a design, mockup, page or canvas, save it in my designs folder: ${root}`,
      `Read ${guide} first and follow it. Each design is its own folder there, never a loose`,
      ".html file. Write design.json first, then the HTML. Work offline: no CDNs, no Google Fonts."
    ].join("\n");
    return capped(text, AGENTS_SNIPPET_MAX, "AGENTS.md snippet");
  };

  // src/ui/model/format.ts
  var SECOND = 1e3;
  var MINUTE = 60 * SECOND;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;
  var relativeTime = (iso, nowMs, locale) => {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "";
    const diff = nowMs - then;
    if (diff < 45 * SECOND) return "just now";
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MINUTE)), "minute");
    if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), "hour");
    if (diff < 14 * DAY) return rtf.format(-Math.round(diff / DAY), "day");
    return new Date(then).toLocaleDateString(locale, { month: "short", day: "numeric", year: diff > 300 * DAY ? "numeric" : void 0 });
  };
  var viewportSize = (viewport) => `${viewport.width}\xD7${viewport.height}`;
  var viewportLabel = (viewport) => `${viewport.label} ${viewportSize(viewport)}`;
  var artboardLabel = (screenTitle, viewport) => {
    const detail = `${viewport.label} \xB7 ${viewportSize(viewport)}`;
    return { name: screenTitle, detail, full: `${screenTitle} \xB7 ${detail}` };
  };
  var zoomPercent = (scale) => `${Math.round(scale * 100)}%`;
  var fileSize = (bytes, locale) => {
    const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    const [value, unit] = safe < 1e3 ? [safe, "byte"] : safe < 1e6 ? [safe / 1e3, "kilobyte"] : [safe / 1e6, "megabyte"];
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: unit === "byte" ? "long" : "short", maximumFractionDigits: value < 10 && unit !== "byte" ? 1 : 0 }).format(value);
  };
  var plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  var middlePath = (path, max = 48) => {
    if (path.length <= max) return path;
    const sep = path.includes("\\") ? "\\" : "/";
    const parts = path.split(/[\\/]+/);
    if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    const head = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? path;
    const build = (tail2) => `${head}${sep}\u2026${sep}${tail2.join(sep)}`;
    const tail = [last];
    for (let index = parts.length - 2; index > 0; index -= 1) {
      const next = [parts[index] ?? "", ...tail];
      if (build(next).length > max) break;
      tail.unshift(parts[index] ?? "");
    }
    const short = build(tail);
    if (parts.length > 2 && short.length <= max) return short;
    return last.length + 2 <= max ? `\u2026${sep}${last}` : `${last.slice(0, Math.max(1, max - 1))}\u2026`;
  };

  // src/ui/model/settings-model.ts
  var WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;
  var UNC = /^\\\\[^\\]+\\[^\\]+/;
  var isAbsolutePath = (path) => path.startsWith("/") || path.startsWith("~/") || WINDOWS_ABSOLUTE.test(path) || UNC.test(path);
  var isFilesystemRoot = (path) => path === "/" || /^[A-Za-z]:[\\/]?$/.test(path);
  var looksWindows = (path) => WINDOWS_ABSOLUTE.test(path) || path.startsWith("\\\\");
  var stripTrailing = (path) => {
    const stripped = path.replace(/[\\/]+$/, "");
    return stripped === "" || /^[A-Za-z]:$/.test(stripped) ? path : stripped;
  };
  var isSameRootInput = (input, currentRoot) => {
    const a = stripTrailing(input.trim());
    const b = stripTrailing(currentRoot.trim());
    if (looksWindows(a) || looksWindows(b)) return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
    return a === b;
  };
  var validateRootInput = (input) => {
    const value = input.trim();
    if (value === "") return "Enter the full path of a folder, or choose \u201CUse default\u201D.";
    if (value.length > SETTINGS_PATH_MAX) return "That path is too long.";
    if (/[\u0000-\u001f\u007f]/.test(value)) return "That path contains a character folders can\u2019t have.";
    if (!isAbsolutePath(value)) return "Use the full path, starting with a drive letter (C:\\\u2026) or \u201C/\u201D.";
    if (isFilesystemRoot(value)) return "Choose a folder inside the drive, not the drive itself.";
    return null;
  };
  var permissionSnippet = (root) => {
    const glob = `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/**`;
    return JSON.stringify({ permission: { external_directory: { [glob]: "allow" } } }, null, 2);
  };
  var designCountLabel = (count) => count === 1 ? "1 design" : `${count} designs`;
  var browserStatus = (path, source) => {
    if (path === null || source === "none") {
      return { tone: "neutral", title: "Live previews", detail: "No Chrome, Edge or Chromium found, so thumbnails are live previews. Install one or set its path for image thumbnails." };
    }
    return { tone: "success", title: source === "setting" ? "Using your chosen browser" : "Detected automatically", detail: path };
  };
  var withPath = (before, path, after) => ({ before, path, after });
  var plain = (text) => ({ before: text, path: null, after: "" });
  var guideSentence = (guide) => {
    switch (guide.state) {
      case "current":
      case "outdated":
        return withPath("Design Chamber keeps a guide for agents at ", guide.path, ".");
      case "edited":
        return withPath("You edited ", guide.path, ", so Design Chamber leaves it alone.");
      case "foreign":
        return withPath("", guide.path, " is your own file, so Design Chamber didn\u2019t add a guide.");
      case "missing":
        return withPath("Design Chamber adds a guide for agents at ", guide.path, " the next time it starts.");
      case "no-root":
        return plain("The guide is added once your designs folder exists.");
      case "failed":
        return plain(guide.message ?? "Design Chamber couldn\u2019t write its guide for agents. Check that you can write to your designs folder.");
    }
  };
  var skillRow = (skill) => {
    switch (skill.state) {
      case "not-installed":
        return { sentence: plain("Built in. Agents in OpenChamber can use it while Design Chamber is on."), control: null };
      case "current":
      case "outdated":
        return { sentence: withPath("Built in. An older copy is also installed at ", skill.path, ", so agents may see the skill twice."), control: "remove-old-copy" };
      case "edited":
        return { sentence: withPath("Built in. You edited the older copy at ", skill.path, ", so Design Chamber leaves it alone. Delete it if you don\u2019t need it."), control: "copy-path" };
      case "foreign":
        return { sentence: withPath("Built in. Another design-chamber skill is installed at ", skill.path, "."), control: "copy-path" };
      case "unavailable":
        return { sentence: plain(`Built in. ${skill.message ?? "Design Chamber can\u2019t look for an older copy on this computer."}`), control: null };
    }
  };
  var duplicateSentences = (skill) => skill.duplicates.map((path) => withPath("Another copy is at ", path, ". OpenCode needs one copy, so remove the other."));

  // src/ui/components/settings-view.ts
  var ACK_MS = 2e3;
  var sentence = (parts, inline = false) => {
    const path = parts.path === null ? null : h("code", { class: "dc-path", title: parts.path }, middlePath(parts.path));
    return inline ? h("span", { class: "dc-muted dc-status-detail" }, parts.before, path, parts.after) : h("p", { class: "dc-settings-p" }, parts.before, path, parts.after);
  };
  var agentsSnippetFor = (root) => {
    try {
      return buildAgentsSnippet(root);
    } catch {
      return null;
    }
  };
  var section = (title, description, ...children) => h("section", { class: "dc-settings-section" }, h("h3", { class: "dc-settings-h" }, title), h("p", { class: "dc-settings-p" }, description), ...children);
  var mountSettings = (container) => {
    const scope = createScope();
    const body = h("div", { class: "dc-settings" });
    const live = h("p", { class: "dc-sr-only", role: "status", "aria-live": "polite" });
    container.append(body, live);
    let version = "";
    void client.call("GET /health").then(
      (health) => {
        version = health.version;
        paint();
      },
      () => void 0
    );
    let rootDraft = null;
    let rootError = null;
    let chromeDraft = null;
    let chromeError = null;
    let rootBusy = false;
    let rootSaved = false;
    let chromeBusy = false;
    let skillError = null;
    let skillBusy = false;
    let skillFocus = null;
    const copied = { permissions: false, agents: false, skill: false };
    const timers = /* @__PURE__ */ new Set();
    const later = (fn, ms) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    };
    const applyRoot = async (value, current) => {
      if (value !== null) {
        if (isSameRootInput(value, current.root)) return;
        rootError = validateRootInput(value);
        if (rootError !== null) return paint();
      } else if (current.root === current.defaultRoot) return;
      rootBusy = true;
      rootError = null;
      paint();
      try {
        await store.updateSettings({ root: value === null ? null : value.trim() });
        rootDraft = null;
        rootSaved = true;
        later(() => {
          rootSaved = false;
          paint();
        }, ACK_MS);
        await store.refreshDesigns();
        toast("success", "Designs folder changed. Designs in the earlier folder stay where they were.");
      } catch (error) {
        rootError = errorText2(error);
      } finally {
        rootBusy = false;
        paint();
      }
    };
    const switchBack = async (path) => {
      try {
        await store.updateSettings({ root: path });
        await store.refreshDesigns();
        toast("success", "Switched back to that folder.");
      } catch (error) {
        toast("error", `Couldn\u2019t switch back. ${errorText2(error)}`);
      }
    };
    const applyChrome = async (value) => {
      chromeBusy = true;
      chromeError = null;
      paint();
      try {
        const next = await store.updateSettings({ chromePath: value === null ? null : value.trim() });
        if (value !== null && next.chrome.source !== "setting") chromeError = "That file isn\u2019t a browser Design Chamber can use. Check the path and try again.";
        else {
          chromeDraft = null;
          toast("success", value === null ? "Using the detected browser." : "That browser works. Thumbnails will use it.");
        }
      } catch (error) {
        chromeError = errorText2(error);
      } finally {
        chromeBusy = false;
        paint();
      }
    };
    const copySnippet = async (snippet, which) => {
      if (await host.writeClipboard(snippet)) {
        copied[which] = true;
        paint();
        later(() => {
          copied[which] = false;
          paint();
        }, ACK_MS);
      } else toast("error", "Couldn\u2019t reach the clipboard. Select the text and copy it by hand.");
    };
    const removeOldCopy = async () => {
      if (skillBusy) return;
      skillBusy = true;
      skillError = null;
      live.textContent = "";
      paint();
      try {
        await client.call("DELETE /agent/skill");
        live.textContent = "Old copy removed.";
        toast("success", "Old copy removed.");
        await store.loadSettings();
        skillFocus = "row";
      } catch (error) {
        skillError = errorText2(error);
        skillFocus = "action";
      } finally {
        skillBusy = false;
        paint();
      }
    };
    const paint = () => {
      const state = store.getState().settings;
      body.replaceChildren();
      if (state.status === "idle" || state.status === "loading" && !state.data) {
        body.append(loadingRow("Loading settings\u2026"));
        return;
      }
      if (!state.data) {
        body.append(banner({ tone: "error", title: "Settings didn\u2019t load", body: state.error?.message ?? "The local service didn\u2019t answer.", action: { label: "Try again", onClick: () => void store.loadSettings() } }));
        return;
      }
      const settings = state.data;
      const folderHost = h("div");
      const draft = rootDraft ?? settings.root;
      const unchanged = (value) => isSameRootInput(value, settings.root);
      const folderField = mountTextField(folderHost, {
        label: "Designs folder",
        value: draft,
        mono: true,
        disabled: rootBusy,
        error: rootError ?? void 0,
        helper: settings.rootExists ? "Existing designs aren\u2019t moved when you change this." : "This folder doesn\u2019t exist yet. It is created when you apply.",
        onChange: (next) => {
          rootDraft = next;
          if (rootError !== null) {
            rootError = null;
            folderField.update({ error: void 0 });
          }
          rootSaved = false;
          apply.set(applyState(next));
        }
      });
      const applyState = (value) => ({
        label: rootSaved ? "Saved" : "Apply folder",
        icon: rootSaved ? "check" : void 0,
        disabled: rootBusy || unchanged(value),
        title: !rootSaved && unchanged(value) ? "Change the path above to apply it." : void 0
      });
      const apply = btn({ variant: "default", emphasis: "primary", loading: rootBusy, ...applyState(draft), onClick: () => void applyRoot(rootDraft ?? settings.root, settings) });
      const reset = btn({ label: "Use default", variant: "ghost", disabled: rootBusy || settings.root === settings.defaultRoot, title: settings.defaultRoot, onClick: () => void applyRoot(null, settings) });
      folderHost.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          void applyRoot(rootDraft ?? settings.root, settings);
        }
      });
      const folder = section("Where designs live", "Your chat agent writes each design as its own folder here.", folderHost, h("div", { class: "dc-row-actions" }, apply.el, reset.el));
      let previous = null;
      if (settings.previousRoots.length > 0) {
        const rows = settings.previousRoots.map((root) => {
          const switchButton = btn({ label: "Switch back", variant: "outline", size: "xs", disabled: !root.exists, title: root.exists ? void 0 : "This folder no longer exists.", onClick: () => void switchBack(root.path) });
          return h(
            "li",
            { class: "dc-prev" },
            h("div", { class: "dc-prev-text" }, h("code", { class: "dc-path", title: root.path }, middlePath(root.path)), h("span", { class: "dc-muted" }, root.exists ? `${designCountLabel(root.designCount)} remain here` : "Folder not found")),
            switchButton.el
          );
        });
        previous = section("Earlier folders", "Designs in these folders were left in place. Switch back to see them again.", h("ul", { class: "dc-prev-list" }, ...rows));
      }
      const guide = h("div", { class: "dc-field" }, h("span", { class: "oc-sdk-field-label" }, "Guide in your designs folder"), sentence(guideSentence(settings.agent.guide)));
      const row = skillRow(settings.agent.skill);
      const skill = h("div", { class: "dc-field", role: "group", "aria-label": "Agent skill", tabindex: "-1", "data-skill-row": "" }, h("span", { class: "oc-sdk-field-label" }, "Agent skill"), sentence(row.sentence));
      if (row.control === "remove-old-copy") {
        const remove2 = btn({ label: "Remove old copy", variant: "outline", size: "xs", loading: skillBusy, onClick: () => void removeOldCopy() });
        remove2.el.dataset.skillAction = "";
        skill.append(h("div", { class: "dc-row-actions" }, remove2.el));
      } else if (row.control === "copy-path") {
        const skillPath = settings.agent.skill.path;
        const copyPath3 = btn({ label: copied.skill ? "Copied" : "Copy path", variant: "outline", size: "xs", icon: copied.skill ? "check" : "copy", onClick: () => void copySnippet(skillPath, "skill") });
        copyPath3.el.setAttribute("aria-label", copied.skill ? "Copied the path of the older copy" : "Copy the path of the older copy");
        skill.append(h("div", { class: "dc-row-actions" }, copyPath3.el));
      }
      if (skillError !== null) skill.append(h("p", { class: "dc-form-error", role: "alert" }, skillError));
      for (const duplicate of duplicateSentences(settings.agent.skill)) {
        const badge = h("span");
        mountBadge(badge, { label: "Duplicate", tone: "warning" });
        skill.append(h("div", { class: "dc-status-line" }, badge, sentence(duplicate, true)));
      }
      const agentsSnippet = agentsSnippetFor(settings.root);
      let snippetBlock = null;
      if (agentsSnippet !== null) {
        const copyAgents = btn({ label: copied.agents ? "Copied" : "Copy", variant: "outline", size: "sm", icon: copied.agents ? "check" : "copy", onClick: () => void copySnippet(agentsSnippet, "agents") });
        copyAgents.el.setAttribute("aria-label", copied.agents ? "Copied the AGENTS.md lines" : "Copy the AGENTS.md lines");
        snippetBlock = h(
          "div",
          { class: "dc-field" },
          h("span", { class: "oc-sdk-field-label" }, "Lines for AGENTS.md"),
          h("p", { class: "dc-settings-p" }, "Paste this into a project\u2019s AGENTS.md or your global ~/.config/opencode/AGENTS.md."),
          h("pre", { class: "dc-code", "data-wrap": "true", tabindex: "0", "aria-label": "AGENTS.md lines" }, agentsSnippet),
          h("div", { class: "dc-row-actions" }, copyAgents.el)
        );
      }
      const agents = section("Help your agent find your designs", "Chats that don\u2019t start with /design or /page can still find your designs folder through these.", guide, skill, snippetBlock);
      const status = browserStatus(settings.chrome.path, settings.chrome.source);
      const statusBadge = h("span");
      mountBadge(statusBadge, { label: status.title, tone: status.tone });
      const chromeHost = h("div");
      const chromeField = mountTextField(chromeHost, {
        label: "Use a different browser",
        value: chromeDraft ?? "",
        mono: true,
        placeholder: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        disabled: chromeBusy,
        error: chromeError ?? void 0,
        helper: "Optional. Chrome, Edge or Chromium; used only to take thumbnails.",
        onChange: (next) => {
          chromeDraft = next;
          if (chromeError !== null) {
            chromeError = null;
            chromeField.update({ error: void 0 });
          }
        }
      });
      const test = btn({ label: "Test and save", variant: "outline", loading: chromeBusy, onClick: () => {
        if ((chromeDraft ?? "").trim() === "") {
          chromeError = "Enter the path of a browser to test.";
          return paint();
        }
        void applyChrome(chromeDraft);
      } });
      const detected = btn({ label: "Use detected", variant: "ghost", disabled: chromeBusy || settings.chrome.source !== "setting", onClick: () => void applyChrome(null) });
      const browser = section(
        "Browser for thumbnails",
        "A headless browser takes the previews. Without one, thumbnails fall back to live previews.",
        h("div", { class: "dc-status-line" }, statusBadge, h("span", { class: "dc-muted dc-status-detail" }, status.detail)),
        chromeHost,
        h("div", { class: "dc-row-actions" }, test.el, detected.el)
      );
      const snippet = permissionSnippet(settings.root);
      const copy = btn({ label: copied.permissions ? "Copied" : "Copy", variant: "outline", size: "sm", icon: copied.permissions ? "check" : "copy", onClick: () => void copySnippet(snippet, "permissions") });
      copy.el.setAttribute("aria-label", copied.permissions ? "Copied the opencode.json snippet" : "Copy the opencode.json snippet");
      const permissions = section(
        "Let your agent write here",
        "OpenCode asks before your agent writes outside the project. To allow your Designs folder once, add this to opencode.json. Design Chamber never edits that file.",
        h("pre", { class: "dc-code", tabindex: "0", "aria-label": "opencode.json snippet" }, snippet),
        h("div", { class: "dc-row-actions" }, copy.el)
      );
      append(body, folder, previous, agents, browser, permissions, h("p", { class: "dc-settings-foot" }, version ? `Design Chamber ${version.startsWith("v") ? version : `v${version}`}` : "Design Chamber"));
      if (skillFocus !== null) {
        body.querySelector(skillFocus === "action" ? "[data-skill-action]" : "[data-skill-row]")?.focus();
        skillFocus = null;
      }
    };
    let seen = "";
    scope.add(
      store.subscribe(() => {
        const state = store.getState().settings;
        const signature = `${state.status}:${state.data ? JSON.stringify(state.data) : ""}:${state.error?.message ?? ""}`;
        if (signature === seen) return;
        seen = signature;
        paint();
      })
    );
    void store.loadSettings();
    paint();
    return {
      dispose: () => {
        scope.dispose();
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        body.remove();
        live.remove();
      }
    };
  };

  // src/ui/model/comments-model.ts
  var COMMENT_FILTERS = [
    { id: "open", label: "Open" },
    { id: "sent", label: "Sent" },
    { id: "resolved", label: "Resolved" }
  ];
  var statusLabel = (status) => status === "open" ? "Open" : status === "sent" ? "Sent to chat" : "Resolved";
  var pinNumbers = (comments) => {
    const ordered = comments.map((comment, index) => ({ comment, index })).sort((a, b) => Date.parse(a.comment.created) - Date.parse(b.comment.created) || a.index - b.index);
    const numbers = /* @__PURE__ */ new Map();
    ordered.forEach(({ comment }, position) => numbers.set(comment.id, position + 1));
    return numbers;
  };
  var groupComments = (comments, screens, pageTitle) => {
    const groups = [];
    const known = /* @__PURE__ */ new Set();
    const onPage = comments.filter((comment) => comment.screen === null);
    if (onPage.length > 0) groups.push({ key: "page", title: pageTitle, comments: onPage });
    for (const screen of screens) {
      known.add(screen.id);
      const mine = comments.filter((comment) => comment.screen === screen.id);
      if (mine.length > 0) groups.push({ key: screen.id, title: screen.title, comments: mine });
    }
    const orphans = comments.filter((comment) => comment.screen !== null && !known.has(comment.screen));
    if (orphans.length > 0) groups.push({ key: "__missing", title: "Screens that no longer exist", comments: orphans });
    return groups;
  };
  var countByStatus = (comments) => ({
    open: comments.filter((comment) => comment.status === "open").length,
    sent: comments.filter((comment) => comment.status === "sent").length,
    resolved: comments.filter((comment) => comment.status === "resolved").length
  });
  var viewportOf = (viewports, id) => {
    const viewport = viewports.find((candidate) => candidate.id === id);
    if (viewport) return viewportLabel(viewport);
    return id === PAGE_FILL_VIEWPORT_ID ? "Full width" : id;
  };
  var sendState = (comments, linked) => {
    const open = comments.filter((comment) => comment.status === "open").length;
    if (open === 0) return { enabled: false, label: "Send comments to chat", reason: "Add a comment first, or reopen a resolved one." };
    const noun = open === 1 ? "comment" : "comments";
    return { enabled: true, label: `Send ${open} ${noun} to chat`, reason: linked ? null : "No chat is linked yet, so a new chat will start." };
  };
  var pinGlyph = (comment, number) => comment.status === "resolved" ? "\u2713" : String(number);
  var pinAriaLabel = (comment, number) => {
    const body = comment.body.length > 60 ? `${comment.body.slice(0, 57)}\u2026` : comment.body;
    return `Comment ${number}: ${body} (${statusLabel(comment.status).toLowerCase()})`;
  };
  var sendResultCopy = (result, pinNumber) => {
    const sent = result.commentIds.length;
    if (result.outcome === "nothing") return { kind: "info", message: "There are no open comments to send." };
    if (result.markFailed) return { kind: "info", message: MESSAGES.markFailed };
    if (result.omitted.length > 0) return { kind: "info", message: `${sent} of ${sent + result.omitted.length} comments sent. Send again for the rest.` };
    const named = sent === 1 && pinNumber !== null;
    if (result.outcome === "new-session") return { kind: "success", message: `Started a new chat with ${named ? `comment ${pinNumber}` : plural(sent, "comment")}.` };
    if (result.outcome === "composed") return null;
    return { kind: "success", message: named ? `Comment ${pinNumber} sent to the chat.` : `${plural(sent, "comment")} sent to the chat.` };
  };
  var sendThisProblem = (comment) => {
    if (comment === void 0) return "That comment is gone, so there is nothing to send.";
    if (comment.status === "sent") return "That comment was already sent to the chat.";
    if (comment.status === "resolved") return "That comment is resolved, so it was not sent. Reopen it first.";
    return null;
  };

  // src/ui/model/listeners.ts
  var createListeners = () => {
    const set = /* @__PURE__ */ new Set();
    return {
      add: (listener) => {
        set.add(listener);
        return () => void set.delete(listener);
      },
      emit: (...args) => {
        for (const listener of [...set]) {
          try {
            listener(...args);
          } catch (error) {
            console.error("A listener failed.", error);
          }
        }
      },
      size: () => set.size
    };
  };

  // src/ui/components/send-comments.ts
  var inFlight = /* @__PURE__ */ new Set();
  var changes = createListeners();
  var isSending = (id) => inFlight.has(id);
  var onSendingChange = changes.add;
  var sendComments = async (slug, ids, anchorStates) => {
    const busy = ids.find((id) => inFlight.has(id));
    if (busy !== void 0) throw new Error(ids.length === 1 ? "That comment is already on its way to the chat." : "One of these comments is already on its way. Try again in a moment.");
    const states = Object.fromEntries(Object.entries(anchorStates).filter(([id]) => ids.includes(id)));
    for (const id of ids) inFlight.add(id);
    changes.emit();
    try {
      const result = await flows.sendComments(slug, ids, states);
      await store.refreshOpenDesign().catch(() => void 0);
      const open = store.getState().open;
      const numbers = open?.slug === slug && open.data ? pinNumbers(open.data.design.comments) : null;
      const copy = sendResultCopy(result, ids.length === 1 ? numbers?.get(ids[0] ?? "") ?? null : null);
      if (copy) toast(copy.kind, copy.message);
    } finally {
      for (const id of ids) inFlight.delete(id);
      changes.emit();
    }
  };
  var sendOneComment = async (slug, id, body, anchorStates) => {
    const open = store.getState().open;
    const comments = open?.slug === slug ? open.data?.design.comments : void 0;
    const current = comments?.find((comment) => comment.id === id);
    if (comments !== void 0) {
      const problem = sendThisProblem(current);
      if (problem !== null) throw new Error(problem);
    }
    if (current !== void 0 && body.trim() !== current.body.trim()) await store.updateComment(slug, id, { body });
    await sendComments(slug, [id], anchorStates);
  };

  // src/ui/components/comments-drawer.ts
  var MENTION = "Switch to Edit and click anything on the wall to pin a comment to it.";
  var mountComments = (options) => {
    const scope = createScope();
    const el2 = h("div", { class: "dc-comments" });
    let filter = "open";
    let sending = false;
    let sendError = null;
    let filterTouched = false;
    const detail = () => {
      const open = store.getState().open;
      return open?.slug === options.slug ? open : null;
    };
    const updateStatus = async (comment, status) => {
      try {
        await store.updateComment(options.slug, comment.id, { status });
      } catch (error) {
        toast("error", `Couldn\u2019t update that comment. ${errorText2(error)}`);
      }
    };
    const send = async (ids) => {
      sending = true;
      sendError = null;
      paint();
      try {
        await sendComments(options.slug, ids, options.anchorStates());
      } catch (error) {
        sendError = `Couldn\u2019t send. ${errorText2(error)} Your comments are still here.`;
      } finally {
        sending = false;
        paint();
      }
    };
    const sendOne = async (comment) => {
      try {
        await sendComments(options.slug, [comment.id], options.anchorStates());
      } catch (error) {
        toast("error", `Couldn\u2019t send that comment. ${errorText2(error)} It is still open.`);
      }
    };
    const item = (comment, number, detachedHere, design) => {
      const resolved = comment.status === "resolved";
      const toggle = iconBtn({
        icon: resolved ? "restore" : "check",
        label: resolved ? `Reopen comment ${number}` : `Mark comment ${number} resolved`,
        size: "sm",
        onClick: (event) => {
          event.stopPropagation();
          void updateStatus(comment, resolved ? "open" : "resolved");
        }
      });
      const sendNow = comment.status !== "open" ? null : iconBtn({
        icon: "send",
        label: `Send comment ${number} to chat`,
        size: "sm",
        disabled: isSending(comment.id),
        onClick: (event) => {
          event.stopPropagation();
          void sendOne(comment);
        }
      });
      if (sendNow && isSending(comment.id)) sendNow.setAttribute("aria-busy", "true");
      const main = h(
        "button",
        { type: "button", class: "dc-comment-main", "aria-label": `Show comment ${number} on the wall` },
        h("span", { class: "dc-pin-badge", "data-status": comment.status, "aria-hidden": "true" }, resolved ? "\u2713" : String(number)),
        h(
          "span",
          { class: "dc-comment-text" },
          h("span", { class: "dc-comment-where" }, viewportOf(design.viewports, comment.viewport)),
          h("span", { class: "dc-comment-body" }, comment.body),
          h("span", { class: "dc-comment-el" }, h("code", { class: "dc-chip-code" }, comment.anchor.selector.split(" > ").slice(-1)[0] ?? comment.anchor.selector), comment.anchor.text ? ` \u201C${comment.anchor.text.slice(0, 48)}${comment.anchor.text.length > 48 ? "\u2026" : ""}\u201D` : ""),
          detachedHere ? h("span", { class: "dc-comment-note" }, "Element not found in the current file") : null
        )
      );
      main.addEventListener("click", () => options.onLocate(comment.id));
      return h("li", { class: "dc-comment", "data-detached": detachedHere ? "true" : "false" }, main, sendNow, toggle);
    };
    const paint = () => {
      const state = detail();
      const previousScroll = el2.querySelector(".dc-comments-list")?.scrollTop ?? 0;
      el2.replaceChildren();
      if (!state || state.status === "idle" || state.status === "loading" && !state.data) {
        el2.append(loadingRow("Loading comments\u2026"));
        return;
      }
      if (!state.data) {
        el2.append(banner({ tone: "error", title: "Comments didn\u2019t load", body: state.error?.message ?? "The local service didn\u2019t answer.", action: { label: "Try again", onClick: () => void store.refreshOpenDesign() } }));
        return;
      }
      const { design } = state.data;
      const counts = countByStatus(design.comments);
      if (!filterTouched && counts.open === 0 && design.comments.length > 0) filter = counts.sent > 0 ? "sent" : "resolved";
      const numbers = pinNumbers(design.comments);
      const missing = options.detached();
      const tabsHost = h("div", { class: "dc-comments-tabs" });
      mountTabs(tabsHost, {
        items: COMMENT_FILTERS.map(({ id, label }) => ({ id, label, count: counts[id] })),
        activeId: filter,
        trackBackground: true,
        onChange: (id) => {
          filter = COMMENT_FILTERS.find((entry) => entry.id === id)?.id ?? "open";
          filterTouched = true;
          paint();
        }
      });
      const shown = design.comments.filter((comment) => comment.status === filter);
      const list = h("div", { class: "dc-comments-list" });
      if (design.comments.length === 0) {
        list.append(h("div", { class: "dc-empty" }, h("p", { class: "dc-empty-title" }, "No comments yet"), h("p", { class: "dc-empty-body" }, MENTION)));
      } else if (shown.length === 0) {
        list.append(h("div", { class: "dc-empty" }, h("p", { class: "dc-empty-title" }, `No ${statusLabel(filter).toLowerCase()} comments`), h("p", { class: "dc-empty-body" }, filter === "open" ? "Everything has been sent or resolved." : "Nothing here yet.")));
      } else {
        const lost = shown.filter((comment) => missing.has(comment.id));
        const placed = shown.filter((comment) => !missing.has(comment.id));
        for (const group of groupComments(placed, design.screens, design.title)) {
          list.append(
            h("section", { class: "dc-comment-group" }, h("h3", { class: "dc-group-title" }, group.title, h("span", { class: "dc-muted" }, String(group.comments.length))), h("ul", { class: "dc-comment-items" }, ...group.comments.map((comment) => item(comment, numbers.get(comment.id) ?? 0, false, design))))
          );
        }
        if (lost.length > 0) {
          list.append(
            h("section", { class: "dc-comment-group" }, h("h3", { class: "dc-group-title" }, "Detached", h("span", { class: "dc-muted" }, String(lost.length))), h("p", { class: "dc-group-note" }, "These elements are gone from the current files. They are still sent, with their old selector."), h("ul", { class: "dc-comment-items" }, ...lost.map((comment) => item(comment, numbers.get(comment.id) ?? 0, true, design))))
          );
        }
      }
      const state2 = sendState(design.comments, design.sessionId !== null);
      const submit = btn({
        label: state2.label,
        variant: "default",
        size: "default",
        emphasis: "primary",
        loading: sending,
        disabled: !state2.enabled,
        onClick: () => void send(
          design.comments.filter((comment) => comment.status === "open").map((comment) => comment.id)
        )
      });
      submit.el.classList.add("dc-block");
      const foot = h("div", { class: "dc-comments-foot" }, sendError ? h("p", { class: "dc-form-error", role: "alert" }, sendError) : null, submit.el, state2.reason ? h("p", { class: "dc-foot-note" }, state2.reason) : null);
      el2.append(tabsHost, list, foot);
      list.scrollTop = previousScroll;
    };
    scope.add(store.subscribe(paint));
    scope.add(onSendingChange(paint));
    paint();
    return {
      el: el2,
      refresh: paint,
      dispose: () => {
        scope.dispose();
        el2.remove();
      }
    };
  };

  // src/ui/model/holdable-timer.ts
  var createHoldableTimer = (ttlMs, onExpire) => {
    const causes = /* @__PURE__ */ new Set();
    let remaining = ttlMs;
    let startedAt = 0;
    let timer;
    let live = false;
    const run = () => {
      startedAt = Date.now();
      timer = setTimeout(() => {
        timer = void 0;
        if (live) {
          live = false;
          onExpire();
        }
      }, remaining);
    };
    const pause = () => {
      if (timer === void 0) return;
      clearTimeout(timer);
      timer = void 0;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    return {
      start: () => {
        clearTimeout(timer);
        timer = void 0;
        remaining = ttlMs;
        live = true;
        if (causes.size === 0) run();
      },
      setHeld: (cause, held) => {
        const before = causes.size;
        if (held) causes.add(cause);
        else causes.delete(cause);
        if (!live) return;
        if (before === 0 && causes.size > 0) pause();
        else if (before > 0 && causes.size === 0) run();
      },
      cancel: () => {
        live = false;
        clearTimeout(timer);
        timer = void 0;
      }
    };
  };

  // src/ui/components/notices.ts
  var TRANSIENT_ORDER = ["export", "restore"];
  var createNotices = () => {
    const el2 = h("div", { class: "dc-notices", "aria-live": "polite" });
    let statics = [];
    const transients = /* @__PURE__ */ new Map();
    const drop = (id) => {
      const current = transients.get(id);
      if (!current) return;
      current.timer?.cancel();
      current.node.remove();
      transients.delete(id);
    };
    const nextAfter = (id) => {
      for (const later of TRANSIENT_ORDER.slice(TRANSIENT_ORDER.indexOf(id) + 1)) {
        const found = transients.get(later);
        if (found) return found.node;
      }
      return null;
    };
    const firstTransient = () => {
      for (const id of TRANSIENT_ORDER) {
        const found = transients.get(id);
        if (found) return found.node;
      }
      return null;
    };
    return {
      el: el2,
      setStatic: (nodes) => {
        for (const node of statics) node.remove();
        statics = [...nodes];
        const before = firstTransient();
        for (const node of statics) el2.insertBefore(node, before);
      },
      setTransient: (id, node, ttlMs) => {
        drop(id);
        if (!node) return;
        let timer = null;
        if (ttlMs !== void 0) {
          timer = createHoldableTimer(ttlMs, () => drop(id));
          node.addEventListener("pointerenter", () => timer?.setHeld("hover", true));
          node.addEventListener("pointerleave", () => timer?.setHeld("hover", false));
          node.addEventListener("focusin", () => timer?.setHeld("focus", true));
          node.addEventListener("focusout", () => timer?.setHeld("focus", false));
        }
        transients.set(id, { node, timer });
        el2.insertBefore(node, nextAfter(id));
        timer?.start();
      },
      dispose: () => {
        for (const id of [...transients.keys()]) drop(id);
      }
    };
  };

  // src/ui/model/findability-model.ts
  var TIP_KEY = "tip:full-screen";
  var RESTORE_NOTICE_MS = 1e4;
  var SHORT_NOTICE_MS = 5e3;
  var shouldShowTip = (stored) => !(typeof stored === "object" && stored !== null && "dismissed" in stored && stored.dismissed === true);
  var dismissedTip = (now) => ({ dismissed: true, at: now.toISOString() });
  var commentsChip = (count) => count > 0 ? { label: String(count), aria: `Comments, ${count} open` } : { label: "", aria: "Comments" };
  var restoreNotice = (result, requested) => {
    const before = result.before;
    if (!before) return { title: `Restored v${requested.n}`, body: "Your previous state is saved in Versions.", undoTo: null };
    if (before.treeHash === result.restored.treeHash) return { title: `v${requested.n} matches the current design`, body: "Nothing changed.", undoTo: null };
    const undoTo = { id: before.id, n: before.n };
    return {
      title: `Restored v${requested.n}`,
      body: result.restorePoint ? `Your previous state is saved as v${result.restorePoint.n}.` : `Your previous state is v${before.n} in Versions.`,
      undoTo
    };
  };
  var undoneNotice = (to, undoneFrom) => ({
    title: `Back to v${to.n}`,
    body: `v${undoneFrom.n} is still in Versions.`
  });
  var undoFailedNotice = (message, to) => ({
    title: "Couldn\u2019t undo",
    body: `${message} Your earlier state is saved as v${to.n} in Versions.`
  });
  var restoreFailedMessage = (n, message) => `Couldn\u2019t restore v${n}. ${message} Nothing was changed.`;

  // src/ui/model/restore-core.ts
  var createRestoreCore = (deps) => {
    const { view: view2 } = deps;
    let busy = null;
    let disposed = false;
    const setBusy = (next) => {
      busy = next;
      if (!disposed) view2.busy(next);
    };
    const run = async (id) => {
      const result = await deps.restore(id);
      await deps.refresh().catch(() => void 0);
      return result;
    };
    const undo = async (to, from) => {
      if (busy !== null || disposed) return;
      setBusy(to.id);
      try {
        await run(to.id);
      } catch (error) {
        setBusy(null);
        if (!disposed) view2.undoFailed(to, from, undoFailedNotice(deps.describe(error), to));
        return;
      }
      setBusy(null);
      if (disposed) return;
      view2.reloaded();
      view2.undone(undoneNotice(to, from), SHORT_NOTICE_MS);
    };
    const restore = async (version) => {
      if (busy !== null || disposed) return;
      setBusy(version.id);
      let result;
      try {
        result = await run(version.id);
      } catch (error) {
        setBusy(null);
        if (!disposed) view2.restoreFailed(version, restoreFailedMessage(version.n, deps.describe(error)));
        return;
      }
      setBusy(null);
      if (disposed) return;
      view2.reloaded();
      const notice = restoreNotice(result, version);
      view2.restored(version, notice, notice.undoTo ? RESTORE_NOTICE_MS : SHORT_NOTICE_MS);
    };
    return {
      restore,
      undo,
      busyId: () => busy,
      dispose: () => {
        disposed = true;
      }
    };
  };

  // src/ui/components/restore-flow.ts
  var createRestoreFlow = (options) => {
    const { slug, notices } = options;
    let noticeButtons = [];
    const showNotice = (tone2, title, body, buttons, ttlMs) => {
      noticeButtons = buttons;
      if (buttons.length === 0) {
        notices.setTransient("restore", banner({ tone: tone2, title, body }), ttlMs);
        return;
      }
      const wrap = h("div", { class: "dc-banner dc-restore-notice", "data-actions": "stack" });
      wrap.append(...bannerWithActions(tone2, title, [body], buttons.map((button2) => button2.el)));
      notices.setTransient("restore", wrap, ttlMs);
    };
    const keepFocus = () => {
      const active2 = document.activeElement;
      if (!active2 || active2 === document.body) options.focusWall();
    };
    const core = createRestoreCore({
      restore: (id) => store.restoreVersion(slug, id),
      refresh: () => store.refreshOpenDesign(),
      describe: errorText2,
      view: {
        busy: (id) => {
          for (const button2 of noticeButtons) button2.set({ disabled: id !== null, title: id !== null ? "Another restore is running." : void 0 });
          options.onBusy();
        },
        restoreFailed: (version, message) => {
          toast("error", message);
          options.onFailed(version);
        },
        reloaded: () => options.onRestored(),
        restored: (version, notice, ttlMs) => {
          const undoTo = notice.undoTo;
          if (!undoTo) {
            showNotice("success", notice.title, notice.body, [], ttlMs);
          } else {
            const undoButton = btn({ label: "Undo", variant: "outline", size: "xs", onClick: () => {
              if (core.busyId() !== null) return;
              undoButton.set({ loading: true });
              void core.undo(undoTo, version);
            } });
            showNotice("success", notice.title, notice.body, [undoButton], ttlMs);
          }
          keepFocus();
        },
        undone: (notice, ttlMs) => {
          showNotice("success", notice.title, notice.body, [], ttlMs);
          options.focusWall();
        },
        undoFailed: (to, from, notice) => {
          const again = btn({ label: "Try again", variant: "outline", size: "xs", onClick: () => {
            if (core.busyId() !== null) return;
            again.set({ loading: true });
            void core.undo(to, from);
          } });
          const dismiss = btn({ label: "Dismiss", variant: "ghost", size: "xs", onClick: () => {
            noticeButtons = [];
            notices.setTransient("restore", null);
            options.focusWall();
          } });
          showNotice("error", notice.title, notice.body, [again, dismiss]);
          again.el.focus();
        }
      }
    });
    return { restore: core.restore, busyId: core.busyId, dispose: core.dispose };
  };

  // src/ui/model/versions-model.ts
  var reasonLabel = (reason) => {
    switch (reason) {
      case "auto":
        return "Auto-saved";
      case "turn":
        return "After agent turn";
      case "manual":
        return "Saved manually";
      case "restore-point":
        return "Before restore";
      case "restored":
        return "Restored";
    }
  };
  var versionRows = (versions, dirty) => {
    const ordered = [...versions].sort((a, b) => b.n - a.n);
    return ordered.map((version, index) => ({
      id: version.id,
      n: version.n,
      created: version.created,
      title: `v${version.n}`,
      reason: reasonLabel(version.reason),
      fileCount: version.fileCount,
      current: index === 0 && !dirty,
      label: version.label ?? null
    }));
  };
  var changeLabel = (change) => change === "added" ? "Added" : change === "removed" ? "Removed" : "Changed";
  var viewingBanner = (versionNumber, compare) => compare ? `Comparing v${versionNumber} with the current design` : `Viewing v${versionNumber} (read only)`;
  var historyNotice = (state) => {
    switch (state) {
      case "repaired":
        return { tone: "warning", title: "Some versions could not be read", body: "They are hidden from this list. Their saved files are kept in this design\u2019s .versions folder." };
      case "recovered":
        return { tone: "warning", title: "Version list restored from its backup", body: "The list was damaged and has been rebuilt. The newest version may be missing." };
      case "reset":
        return { tone: "warning", title: "Older versions could not be recovered", body: "The version list was damaged and had no usable backup. New versions are saved as usual, and the old files are kept in this design\u2019s .versions folder." };
      case "unsupported":
        return { tone: "info", title: "Saved by a newer Design Chamber", body: "Update the extension to see, save or restore versions of this design." };
    }
  };

  // src/ui/components/versions-drawer.ts
  var mountVersions = (options) => {
    const scope = createScope();
    const el2 = h("div", { class: "dc-versions" });
    let snapshotBusy = false;
    let diff = null;
    let diffToken = 0;
    const loadDiff = async (id) => {
      diffToken += 1;
      const mine = diffToken;
      diff = { id, state: "loading", files: [], error: null };
      paint();
      try {
        const answer = await store.diffVersion(options.slug, id, "current");
        if (mine === diffToken) diff = { id, state: "ready", files: answer.files, error: null };
      } catch (error) {
        if (mine === diffToken) diff = { id, state: "error", files: [], error: errorText2(error) };
      }
      paint();
    };
    const snapshot = async () => {
      snapshotBusy = true;
      paint();
      try {
        const created = await store.snapshotVersion(options.slug);
        toast("info", created ? `Saved as v${created.n}.` : "Nothing has changed since the last version.");
      } catch (error) {
        toast("error", `Couldn\u2019t save a version. ${errorText2(error)}`);
      } finally {
        snapshotBusy = false;
        paint();
      }
    };
    const restore = (row) => void options.onRestore({ id: row.id, n: row.n });
    const restoreButton = (row, restoring) => {
      const button2 = btn({ label: "Restore", variant: "ghost", size: "xs", loading: restoring === row.id, disabled: restoring !== null && restoring !== row.id, onClick: () => restore(row) });
      button2.el.dataset.restore = row.id;
      return button2.el;
    };
    const rowEl = (row, viewing) => {
      const active2 = viewing?.id === row.id;
      const restoring = options.restoring();
      const badge = h("span");
      if (row.current) mountBadge(badge, { label: "Current", tone: "success" });
      const actions = h(
        "div",
        { class: "dc-version-actions" },
        btn({ label: active2 && !viewing?.compare ? "Viewing" : "View", variant: "outline", size: "xs", pressed: active2 && !viewing?.compare, onClick: () => {
          options.onView(row.id);
          void loadDiff(row.id);
        } }).el,
        btn({ label: active2 && viewing?.compare ? "Comparing" : "Compare", variant: "outline", size: "xs", icon: "compare", pressed: active2 && viewing?.compare, onClick: () => {
          options.onCompare(row.id);
          void loadDiff(row.id);
        } }).el,
        row.current ? null : restoreButton(row, restoring)
      );
      const changed = active2 && diff && diff.id === row.id ? diff.state === "loading" ? loadingRow("Comparing files\u2026") : diff.state === "error" ? h("p", { class: "dc-form-error" }, `Couldn\u2019t compare. ${diff.error ?? ""}`) : h(
        "ul",
        { class: "dc-diff", "aria-label": `Files changed since v${row.n}` },
        ...diff.files.length === 0 ? [h("li", { class: "dc-muted" }, "Identical to the current design.")] : diff.files.map((file) => h("li", null, h("span", { class: "dc-diff-kind", "data-change": file.change }, changeLabel(file.change)), h("code", { class: "dc-path" }, file.path)))
      ) : null;
      return h(
        "li",
        { class: "dc-version", "data-active": active2 ? "true" : "false" },
        h("div", { class: "dc-version-head" }, h("span", { class: "dc-version-n" }, row.title), badge, h("span", { class: "dc-muted dc-version-when" }, relativeTime(row.created, Date.now(), host.snapshot()?.locale ?? "en"))),
        h("p", { class: "dc-version-reason" }, row.label ?? row.reason, h("span", { class: "dc-muted" }, ` \xB7 ${row.fileCount} files`)),
        actions,
        changed
      );
    };
    const paint = () => {
      const versions = store.getState().versions;
      const state = versions?.slug === options.slug ? versions : null;
      el2.replaceChildren();
      if (!state || state.status === "idle" || state.status === "loading" && !state.data) {
        el2.append(loadingRow("Loading versions\u2026"));
        return;
      }
      if (!state.data) {
        el2.append(banner({ tone: "error", title: "Versions didn\u2019t load", body: state.error?.message ?? "The local service didn\u2019t answer.", action: { label: "Try again", onClick: () => void store.loadVersions(options.slug) } }));
        return;
      }
      const { history } = state.data;
      const notice = history ? banner(historyNotice(history)) : null;
      if (notice && history === "unsupported") {
        el2.append(notice);
        return;
      }
      const { dirty } = state.data;
      const rows = versionRows(state.data.versions, dirty);
      const viewing = options.viewing();
      const save = btn({ label: "Save a version now", variant: dirty ? "default" : "outline", icon: "history", loading: snapshotBusy, onClick: () => void snapshot() });
      const dirtyRow = dirty ? h("li", { class: "dc-version dc-version-dirty" }, h("div", { class: "dc-version-head" }, h("span", { class: "dc-version-n" }, "Unsaved changes"), h("span", { class: "dc-muted" }, "Now")), h("p", { class: "dc-version-reason" }, "The files changed since the last version. Versions are also saved after each agent turn.")) : null;
      const back = viewing ? btn({ label: "Back to current", variant: "outline", icon: "back", onClick: () => options.onBackToCurrent() }) : null;
      const list = rows.length === 0 && !dirty ? h("div", { class: "dc-empty" }, h("p", { class: "dc-empty-title" }, "No versions yet"), h("p", { class: "dc-empty-body" }, "A version is saved after each agent turn. You can also save one now.")) : h("ul", { class: "dc-version-list" }, dirtyRow, ...rows.map((row) => rowEl(row, viewing)));
      el2.append(...notice ? [notice] : [], h("div", { class: "dc-versions-bar" }, back?.el ?? null, save.el), list);
    };
    scope.add(store.subscribe(paint));
    paint();
    return {
      el: el2,
      refresh: paint,
      focusRestore: (id) => el2.querySelector(`[data-restore="${CSS.escape(id)}"]`)?.focus(),
      dispose: () => {
        scope.dispose();
        el2.remove();
      }
    };
  };

  // src/ui/model/ask-bar-model.ts
  var ASK_COUNTER_FROM = 1e4;
  var CHIP_TEXT_MAX = 40;
  var CHAT_TITLE_MAX = 40;
  var askKeyAction = (press, state) => {
    if (press.composing) return null;
    if (press.key === "Enter") return press.shift ? "newline" : "send";
    if (press.key === "Escape") return state.hasChip ? "clear-chip" : "leave";
    return null;
  };
  var VIEWING = "Go back to the current design to ask the agent.";
  var askSendState = (input) => {
    const length = input.text.trim().length;
    const counter = length >= ASK_COUNTER_FROM ? `${length.toLocaleString()} / ${ASK_TEXT_MAX.toLocaleString()}` : null;
    if (input.viewingVersion) return { enabled: false, reason: VIEWING, counter };
    if (length > ASK_TEXT_MAX) {
      const over = length - ASK_TEXT_MAX;
      return { enabled: false, reason: `That's ${over.toLocaleString()} ${over === 1 ? "character" : "characters"} over the limit. Shorten it to send.`, counter };
    }
    return { enabled: length > 0 && !input.sending, reason: null, counter };
  };
  var oneLine2 = (text) => text.replace(/\s+/g, " ").trim();
  var clip2 = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}\u2026`;
  var chipLabel = (selection2) => {
    const text = oneLine2(selection2.element.anchor.text);
    return { tag: `<${selection2.tag}>`, text: text === "" ? "" : `\u201C${clip2(text, CHIP_TEXT_MAX)}\u201D`, where: selection2.where };
  };
  var askPlaceholder = (link) => link === "linked" ? "Ask the agent to change something" : "Ask the agent. This starts a new chat.";
  var askTarget = (link) => {
    if (link.sessionId === null) return "Starts a new chat";
    const title = oneLine2(link.selectedTitle ?? "");
    if (link.selectedId === link.sessionId && title !== "") return `Goes to \u201C${clip2(title, CHAT_TITLE_MAX)}\u201D`;
    return "Goes to the linked chat";
  };
  var askResultText = (outcome) => {
    switch (outcome) {
      case "sent":
        return "Sent to the chat.";
      case "composed":
        return MESSAGES.busyAsk;
      case "outbox":
        return "Opening the linked chat to send it.";
      case "new-session":
        return "Started a new chat with your message.";
    }
  };
  var askRequestToast = (outcome) => {
    if (outcome === "composed") return null;
    if (outcome === "new-session") return "Started a new chat with the request.";
    return askResultText(outcome);
  };
  var askFailureText = (reason) => `Couldn't send. ${reason.trim()} Your message is still here.`;

  // src/ui/model/viewer-menu.ts
  var reveal2 = { id: "reveal", label: "Reveal in folder" };
  var copyPath2 = { id: "path", label: "Copy path" };
  var rename = { id: "rename", label: "Rename" };
  var remove = { id: "delete", label: "Delete\u2026", destructive: true };
  var baseEntries = () => [reveal2, copyPath2, rename, { separator: true }, remove];
  var viewerMenuEntries = (input) => {
    if (input.compact) {
      return [
        { id: "chat", label: "Continue in chat" },
        { separator: true },
        { id: "zip", label: "Export ZIP" },
        { id: "html", label: input.isPage ? "Export single-file HTML" : "Export screen as HTML\u2026" },
        ...input.isPage ? [{ id: "copy-html", label: "Copy HTML", disabled: input.copyHtmlTooLarge, hint: input.copyHtmlTooLarge ? "too large" : void 0 }] : [],
        copyPath2,
        reveal2,
        rename,
        { separator: true },
        remove
      ];
    }
    return input.isPage ? baseEntries() : [{ id: "zip", label: "Export ZIP" }, { id: "html", label: "Export screen as HTML\u2026" }, { separator: true }, ...baseEntries()];
  };

  // src/ui/model/wall-model.ts
  var screenToFrame = (camera, board, screen) => ({
    x: (screen.x - camera.x) / camera.scale - board.x,
    y: (screen.y - camera.y) / camera.scale - board.y
  });
  var frameToScreen = (camera, board, frame) => ({
    x: camera.x + (board.x + frame.x) * camera.scale,
    y: camera.y + (board.y + frame.y) * camera.scale
  });
  var contains = (board, world) => world.x >= board.x && world.y >= board.y && world.x <= board.x + board.w && world.y <= board.y + board.h;
  var screenToWorld = (camera, screen) => ({
    x: (screen.x - camera.x) / camera.scale,
    y: (screen.y - camera.y) / camera.scale
  });
  var boardAt = (camera, boards, screen) => {
    const world = screenToWorld(camera, screen);
    for (let index = boards.length - 1; index >= 0; index -= 1) {
      const board = boards[index];
      if (board && contains(board.rect, world)) return board;
    }
    return null;
  };
  var pinFramePoint = (rect, point, scroll) => ({
    x: rect.x + rect.w * point.x - scroll.x,
    y: rect.y + rect.h * point.y - scroll.y
  });
  var liveBoards = (boards, camera, surface, budget, margin) => {
    const left = -surface.w * margin;
    const top = -surface.h * margin;
    const right = surface.w * (1 + margin);
    const bottom = surface.h * (1 + margin);
    const centre = { x: surface.w / 2, y: surface.h / 2 };
    const visible = boards.map((board) => {
      const sx = camera.x + board.rect.x * camera.scale;
      const sy = camera.y + board.rect.y * camera.scale;
      const sw = board.rect.w * camera.scale;
      const sh = board.rect.h * camera.scale;
      const on = sx + sw >= left && sx <= right && sy + sh >= top && sy <= bottom;
      const distance = Math.hypot(sx + sw / 2 - centre.x, sy + sh / 2 - centre.y);
      return { board, on, distance };
    }).filter((entry) => entry.on).sort((a, b) => a.distance - b.distance);
    return visible.slice(0, Math.max(1, budget)).map((entry) => entry.board);
  };
  var PAGE_GUTTER = 24;
  var PAGE_GUTTER_COMPACT = 16;
  var PAGE_MIN_SCALE = 0.05;
  var pageCamera = (input) => {
    const stageW = Math.max(1, Math.round(input.stageW));
    const stageH = Math.max(1, Math.round(input.stageH));
    if (input.frameW === null) return { camera: { x: 0, y: 0, scale: 1 }, frameW: stageW, frameH: stageH };
    const frameW = Math.max(1, input.frameW);
    const scale = Math.max(PAGE_MIN_SCALE, Math.min(1, (stageW - 2 * input.gutter) / frameW));
    return {
      camera: { x: (stageW - frameW * scale) / 2, y: input.gutter, scale },
      frameW,
      frameH: Math.max(1, Math.round((stageH - input.gutter) / scale))
    };
  };
  var pageComments = (comments) => comments.filter((comment) => comment.screen === null);
  var resolvePageView = (stored, viewports) => typeof stored === "string" && (stored === PAGE_FILL_VIEWPORT_ID || viewports.some((viewport) => viewport.id === stored)) ? stored : PAGE_FILL_VIEWPORT_ID;
  var pageViewOptions = (viewports) => [
    { id: PAGE_FILL_VIEWPORT_ID, label: "Full width" },
    ...viewports.map((viewport) => ({ id: viewport.id, label: `${viewport.label} \xB7 ${viewport.width}\xD7${viewport.height}` }))
  ];
  var shortUrl = (url, max = 48) => {
    let text = url;
    try {
      const parsed = new URL(url);
      text = `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
    }
    if (text.length <= max) return text;
    const head = Math.ceil((max - 1) * 0.6);
    return `${text.slice(0, head)}\u2026${text.slice(text.length - (max - 1 - head))}`;
  };
  var remoteNotice = (urls, kind, shown = 5) => {
    const count = urls.length;
    const what = kind === "page" ? "page" : "design";
    return {
      title: `This ${what} loads ${count === 1 ? "1 file" : `${count} files`} from the internet`,
      urls: urls.slice(0, shown),
      more: Math.max(0, count - shown)
    };
  };
  var remoteBannerHidden = (urls, hiddenWith) => {
    if (hiddenWith === null) return false;
    const seen = new Set(hiddenWith);
    return urls.every((url) => seen.has(url));
  };
  var nudgeStep = (shift) => shift ? 240 : 60;
  var PIN_FAN_SCALE = 1;
  var clusterPins = (pins, scale, size) => {
    const groups = [];
    const reach = size / Math.max(scale, 1e-6);
    for (const pin of pins) {
      const near = groups.find((group) => Math.hypot(group.x - pin.x, group.y - pin.y) < reach);
      if (near) near.ids.push(pin.id);
      else groups.push({ ids: [pin.id], x: pin.x, y: pin.y });
    }
    return groups;
  };
  var fanOut = (group, scale, size, gap = 4) => group.ids.map((id, index) => ({ id, x: group.x + index * (size + gap) / Math.max(scale, 1e-6), y: group.y }));
  var separatingScale = (spots, scale, size) => {
    let closest = Infinity;
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        const a = spots[i];
        const b = spots[j];
        if (a && b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    const needed = closest > 0 && Number.isFinite(closest) ? size * 1.5 / closest : PIN_FAN_SCALE;
    return Math.min(PIN_FAN_SCALE, Math.max(scale * 2, needed));
  };
  var LABEL_TAIL_MAX = 260;
  var labelWidth = (rect, nextX, scale, spacing = 12) => {
    const own = rect.w * scale;
    const room = nextX === null ? LABEL_TAIL_MAX : (nextX - rect.x) * scale - spacing;
    return Math.max(own, room);
  };

  // src/ui/components/ask-bar.ts
  var STATUS_MS = 4e3;
  var MAX_ROWS = { panel: 4, page: 6 };
  var keyOf = (event) => ({
    key: event.key,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    // keyCode 229 is how older engines report a key swallowed by an IME.
    composing: event.isComposing || event.keyCode === 229
  });
  var createAskBar = (options) => {
    const ids = { target: nextId2("dc-ask-target"), hint: nextId2("dc-ask-hint") };
    let selection2 = null;
    let link = { sessionId: null, selectedId: null, selectedTitle: null };
    let viewing = false;
    let sending = false;
    let statusTimer;
    const area = h("textarea", {
      class: "oc-sdk oc-sdk-input dc-ask-input",
      rows: 1,
      "aria-label": "Message to the agent",
      "aria-describedby": `${ids.target} ${ids.hint}`,
      spellcheck: true
    });
    const chipTag = h("code", { class: "dc-chip-code" });
    const chipText = h("span", { class: "dc-ask-chip-text" });
    const chipWhere = h("span", { class: "dc-ask-chip-where" });
    const removeChip = iconBtn({ icon: "close", label: "Remove the attached element", size: "sm", onClick: () => clearChip() });
    const chip = h("div", { class: "dc-ask-chip", role: "group", "aria-label": "Attached element", hidden: true }, chipTag, chipText, chipWhere, removeChip);
    const failure = h("p", { class: "dc-form-error dc-ask-msg", role: "alert", hidden: true });
    const status = h("span", { class: "dc-ask-status", role: "status", "aria-live": "polite" });
    const target = h("span", { class: "dc-ask-target", id: ids.target });
    const counter = h("span", { class: "dc-ask-counter" });
    const send = btn({ label: "Send", variant: "default", size: "sm", icon: "send", emphasis: "primary", onClick: () => void submit() });
    const hint = h("span", { class: "dc-ask-sr", id: ids.hint }, "Enter sends, Shift+Enter adds a line.");
    const el2 = h(
      "form",
      { class: "dc-ask", "data-surface": options.surface, "aria-label": "Ask the agent", novalidate: true },
      h("div", { class: "dc-ask-box" }, chip, area, failure, h("div", { class: "dc-ask-foot" }, target, status, counter, send.el), hint)
    );
    el2.addEventListener("submit", (event) => event.preventDefault());
    const fit = () => {
      area.style.height = "";
      if (!area.isConnected || area.value === "") return;
      const style = getComputedStyle(area);
      const sum = (...values) => values.reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
      const borders = sum(style.borderTopWidth, style.borderBottomWidth);
      const chrome = borders + sum(style.paddingTop, style.paddingBottom);
      const line = Number.parseFloat(style.lineHeight);
      const limit = Number.isFinite(line) ? line * MAX_ROWS[options.surface] + chrome : Number.POSITIVE_INFINITY;
      area.style.height = `${Math.min(area.scrollHeight + borders, limit)}px`;
    };
    const paint = () => {
      const state = askSendState({ text: area.value, sending, viewingVersion: viewing });
      area.placeholder = askPlaceholder(link.sessionId === null ? "none" : "linked");
      area.readOnly = sending;
      area.disabled = viewing;
      el2.setAttribute("aria-busy", String(sending));
      send.set({ disabled: !state.enabled, loading: sending });
      const line = state.reason ?? askTarget(link);
      target.textContent = line;
      target.title = line;
      target.dataset.reason = state.reason === null ? "none" : viewing ? "viewing" : "limit";
      area.title = line;
      const confirmed = status.textContent !== "" && state.reason === null;
      target.hidden = confirmed;
      status.hidden = !confirmed;
      counter.textContent = state.counter ?? "";
      counter.hidden = state.counter === null || state.reason !== null;
      if (selection2) {
        const label = chipLabel(selection2);
        chipTag.textContent = label.tag;
        chipText.textContent = label.text;
        chipText.hidden = label.text === "";
        chipWhere.textContent = label.where;
      }
      chip.hidden = selection2 === null;
      removeChip.disabled = sending;
    };
    const showStatus = (text) => {
      clearTimeout(statusTimer);
      status.textContent = text;
      paint();
      if (text !== "") statusTimer = setTimeout(() => showStatus(""), STATUS_MS);
    };
    const showFailure = (text) => {
      failure.hidden = text === null;
      failure.textContent = text ?? "";
    };
    const clearChip = () => {
      if (selection2 === null) return;
      selection2 = null;
      paint();
      options.onChipRemoved();
    };
    const submit = async () => {
      if (sending || !askSendState({ text: area.value, sending, viewingVersion: viewing }).enabled) return;
      const text = area.value.trim();
      const sent = selection2;
      sending = true;
      showFailure(null);
      showStatus("");
      paint();
      try {
        const outcome = await options.onSend(text, sent);
        sending = false;
        area.value = "";
        fit();
        const pickedAnother = selection2 !== null && selection2.key !== sent?.key;
        if (!pickedAnother) selection2 = null;
        paint();
        if (sent !== null && !pickedAnother) options.onChipRemoved();
        showStatus(askResultText(outcome));
      } catch (error) {
        sending = false;
        paint();
        showFailure(askFailureText(errorText2(error)));
        area.focus();
      }
    };
    area.addEventListener("input", () => {
      showFailure(null);
      showStatus("");
      fit();
      paint();
    });
    area.addEventListener("keydown", (event) => {
      const action = askKeyAction(keyOf(event), { hasChip: selection2 !== null });
      if (action === "send") {
        event.preventDefault();
        void submit();
      } else if (action === "clear-chip") {
        event.preventDefault();
        event.stopPropagation();
        clearChip();
      } else if (action === "leave") {
        event.preventDefault();
        event.stopPropagation();
        options.onLeave();
      }
    });
    paint();
    fit();
    return {
      el: el2,
      setSelection: (next) => {
        selection2 = next;
        paint();
      },
      selection: () => selection2,
      setLink: (next) => {
        link = next;
        paint();
      },
      setViewing: (next) => {
        viewing = next;
        paint();
      },
      dispose: () => {
        clearTimeout(statusTimer);
        el2.remove();
      }
    };
  };

  // src/ui/wall/feature-ask-bar.ts
  var mount = (ctx) => {
    const bar = createAskBar({
      surface: ctx.surface,
      onSend: async (text, selection2) => (await flows.ask(ctx.slug, { text, element: selection2?.element ?? null })).outcome,
      onChipRemoved: () => ctx.wall.clearSelection(),
      onLeave: () => ctx.wall.focus()
    });
    const syncLink = () => {
      const session = guestHost.session.get();
      bar.setLink({ sessionId: ctx.detail().design.sessionId, selectedId: session?.id ?? null, selectedTitle: session?.title ?? null });
    };
    const syncViewing = () => {
      const viewing = ctx.viewing() !== null;
      bar.setViewing(viewing);
      if (viewing && bar.selection() !== null) {
        bar.setSelection(null);
        ctx.wall.clearSelection();
      }
    };
    const offSelection = ctx.wall.onSelection((event) => {
      if (event.type === "selected") bar.setSelection(event.selection);
      else if (event.type === "commented" && bar.selection()?.key === event.key) bar.setSelection(null);
    });
    const modeEl = ctx.wall.el.matches("[data-mode]") ? ctx.wall.el : ctx.wall.el.querySelector("[data-mode]");
    const modeWatch = new MutationObserver(() => {
      if (modeEl?.dataset.mode === "play" && bar.selection() !== null) {
        bar.setSelection(null);
        ctx.wall.clearSelection();
      }
    });
    if (modeEl) modeWatch.observe(modeEl, { attributes: true, attributeFilter: ["data-mode"] });
    const offDetail = ctx.onDetail(syncLink);
    const offSession = guestHost.session.subscribe(syncLink);
    const offViewing = ctx.onViewing(syncViewing);
    syncLink();
    syncViewing();
    ctx.slots.bottomDock.append(bar.el);
    return () => {
      offSelection();
      modeWatch.disconnect();
      offDetail();
      offSession();
      offViewing();
      bar.dispose();
    };
  };

  // src/shared/build-activity.ts
  var RESTORE_QUIET_MS = 3e3;
  var SERVICE_FOLDERS = [".versions/", ".chamber/", ".trash/"];
  var agentFiles = (files) => [
    ...new Set(files.filter((file) => file !== "design.json" && !file.endsWith(".tmp") && !SERVICE_FOLDERS.some((folder) => file.startsWith(folder))))
  ];

  // src/guest/build-activity.ts
  var QUIET_MS = 12e4;
  var DONE_LINGER_MS = 8e3;
  var PENDING_STALL_MS = 18e4;
  var FEED_DOWN_MS = 5e3;
  var RECENT_MS = 6e3;
  var UNKNOWN_HOLD_MS = 3e4;
  var TURN_FILES_MAX = 50;
  var initialTrack = (now) => ({
    activity: "none",
    outcome: null,
    turnStartedAt: null,
    turnSeen: false,
    idleAt: null,
    turnFiles: [],
    lastFile: null,
    pending: false,
    createdAt: now,
    screensWritten: 0,
    screensTotal: 0,
    isCanvas: false,
    feedDownSince: null,
    dismissedAt: null,
    unknownSince: null,
    restoredAt: null,
    visible: false
  });
  var batchAgentFiles = (events, slug) => {
    const files = [];
    let created = false;
    let restored = false;
    for (const event of events) {
      if (event.slug !== slug) continue;
      if (event.kind === "added") created = true;
      else if (event.kind === "files") {
        if (event.files) files.push(...event.files);
        else restored = true;
      }
    }
    return { files: restored ? [] : agentFiles(files), created, restored };
  };
  var inRestoreQuiet = (track, now) => track.restoredAt !== null && now - track.restoredAt < RESTORE_QUIET_MS;
  var isWorking = (activity) => activity === "running" || activity === "retrying";
  var isActive = (activity) => isWorking(activity) || activity === "waiting-permission" || activity === "waiting-question";
  var isLinkLost = (activity) => activity === "none" || activity === "gone";
  var turnOver = (track) => track.turnSeen && track.activity === "idle";
  var showsWriting = (track) => track.lastFile !== null && !turnOver(track) && track.activity !== "idle";
  var mergeFiles = (known, more) => [.../* @__PURE__ */ new Set([...known, ...more])].slice(0, TURN_FILES_MAX);
  var reduceBuild = (track, input) => {
    switch (input.kind) {
      case "files": {
        if (input.files.length === 0 && !input.created) return track;
        if (inRestoreQuiet(track, input.at)) return track;
        const path = [...input.files].sort().at(-1) ?? null;
        return { ...track, lastFile: { path, at: input.at }, turnFiles: mergeFiles(track.turnFiles, input.files), pending: false, dismissedAt: null };
      }
      case "session": {
        if (input.activity === "unknown") {
          return track.unknownSince !== null ? track : { ...track, unknownSince: input.at };
        }
        const held = track.unknownSince !== null;
        if (track.activity === input.activity && track.outcome === input.outcome) return held ? { ...track, unknownSince: null } : track;
        let next = { ...track, activity: input.activity, outcome: input.outcome, unknownSince: null };
        const wasActive = isActive(track.activity);
        const nowActive = isActive(input.activity);
        if (!wasActive && nowActive) {
          return { ...next, turnSeen: true, turnStartedAt: input.at, turnFiles: [], lastFile: null, idleAt: null, dismissedAt: null };
        }
        if (isLinkLost(input.activity)) {
          next = { ...next, turnSeen: false, turnStartedAt: null, idleAt: null };
        } else if (input.activity === "idle" && track.activity !== "idle") {
          next = { ...next, idleAt: next.turnSeen ? next.idleAt ?? input.at : null };
        }
        return next;
      }
      case "detail": {
        if (track.pending === input.pending && track.createdAt === input.created && track.screensWritten === input.screensWritten && track.screensTotal === input.screensTotal && track.isCanvas === input.isCanvas) {
          return track;
        }
        return { ...track, pending: input.pending, createdAt: input.created, screensWritten: input.screensWritten, screensTotal: input.screensTotal, isCanvas: input.isCanvas };
      }
      case "feed": {
        if (input.state === "retrying") {
          if (track.feedDownSince !== null) return track;
          const visible = phaseOf({ ...track, feedDownSince: null }, input.at) !== "hidden";
          return { ...track, feedDownSince: input.at, visible };
        }
        return track.feedDownSince === null ? track : { ...track, feedDownSince: null, visible: false };
      }
      case "dismiss":
        return track.dismissedAt === input.at ? track : { ...track, dismissedAt: input.at };
      case "reset":
        return track.lastFile === null ? track : { ...track, lastFile: null };
      case "restore": {
        const echoed = track.lastFile !== null && input.at - track.lastFile.at < RESTORE_QUIET_MS;
        return { ...track, restoredAt: input.at, lastFile: echoed ? null : track.lastFile };
      }
    }
  };
  var settled = (track, now) => track.unknownSince !== null && now - track.unknownSince >= UNKNOWN_HOLD_MS ? { ...track, activity: "unknown" } : track;
  var phaseOf = (held, now) => {
    const track = settled(held, now);
    const dismissed = track.dismissedAt !== null;
    if (track.feedDownSince !== null && track.visible && now - track.feedDownSince >= FEED_DOWN_MS) return "offline";
    if (track.activity === "waiting-question") return "question";
    if (track.activity === "waiting-permission") return "permission";
    if (turnOver(track) && track.outcome === "failed" && !dismissed) return "failed";
    if (track.lastFile && showsWriting(track) && now - track.lastFile.at < WRITING_WINDOW_MS) return "writing";
    if (track.activity === "retrying") return "retrying";
    if (track.activity === "running") return "working";
    if (turnOver(track) && track.outcome !== "failed" && track.idleAt !== null && now - track.idleAt < DONE_LINGER_MS) return "done";
    if (track.pending && !isActive(track.activity) && !dismissed && now - track.createdAt >= PENDING_STALL_MS) return "stalled";
    return "hidden";
  };
  var nextDeadline = (held, now) => {
    const track = settled(held, now);
    const at = [];
    if (held.unknownSince !== null) at.push(held.unknownSince + UNKNOWN_HOLD_MS);
    if (track.feedDownSince !== null && track.visible) at.push(track.feedDownSince + FEED_DOWN_MS);
    if (track.lastFile && showsWriting(track)) at.push(track.lastFile.at + WRITING_WINDOW_MS);
    if (isWorking(track.activity)) {
      const since = track.lastFile?.at ?? track.turnStartedAt;
      if (since !== null) at.push(since + QUIET_MS);
    }
    if (turnOver(track) && track.outcome !== "failed" && track.idleAt !== null) at.push(track.idleAt + DONE_LINGER_MS);
    if (track.pending && !isActive(track.activity) && track.dismissedAt === null) at.push(track.createdAt + PENDING_STALL_MS);
    const upcoming = at.filter((time) => time > now);
    return upcoming.length > 0 ? Math.min(...upcoming) : null;
  };
  var watchBuildActivity = (deps) => {
    const { host: host2, feed: feed2, slug } = deps;
    const now = deps.now ?? Date.now;
    const listeners = /* @__PURE__ */ new Set();
    let track = initialTrack(now());
    let disposed = false;
    let timer = null;
    let link = { sessionId: null, projectDirectory: null };
    let linkKey = null;
    let generation = 0;
    let stopSessions = null;
    let fallback = false;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (disposed) return;
      const current = now();
      const deadline = nextDeadline(track, current);
      if (deadline === null) return;
      timer = setTimeout(() => {
        timer = null;
        notify();
        schedule();
      }, Math.max(0, deadline - current));
    };
    const notify = () => {
      for (const listener of [...listeners]) listener(track);
    };
    const apply = (input) => {
      if (disposed) return;
      const next = reduceBuild(track, input);
      if (next === track) return;
      track = next;
      schedule();
      notify();
    };
    const applySession = (activity, outcome = null) => apply({ kind: "session", at: now(), activity, outcome });
    const applyFallback = () => {
      const selected = host2.session.get();
      if (link.sessionId !== null && selected?.id === link.sessionId) applySession(selected.busy ? "running" : "idle");
      else applySession("none");
    };
    const useFallback = () => {
      fallback = true;
      applyFallback();
    };
    const onSnapshot = (snapshot, sessionId) => {
      if (snapshot.state === "loading") return;
      if (snapshot.state === "error") {
        useFallback();
        return;
      }
      fallback = false;
      const found = snapshot.sessions.find((session) => session.id === sessionId);
      if (found) applySession(found.activity, found.outcome);
      else applySession("gone");
    };
    const subscribeSessions = async (mine, sessionId, projectDirectory) => {
      try {
        const { projects } = await host2.client.listProjects();
        if (mine !== generation) return;
        const frameDirectory = host2.directory.get();
        const project = (projectDirectory ? projects.find((entry) => sameDirectory(entry.directory, projectDirectory)) : void 0) ?? (frameDirectory ? projects.find((entry) => sameDirectory(entry.directory, frameDirectory)) : void 0);
        if (!project) {
          useFallback();
          return;
        }
        const stop = await host2.client.onSessions(project.id, (snapshot) => {
          if (mine === generation) onSnapshot(snapshot, sessionId);
        });
        if (mine !== generation) stop();
        else stopSessions = stop;
      } catch (error) {
        if (mine !== generation) return;
        console.warn("Design Chamber: the build strip cannot read chat activity", error);
        useFallback();
      }
    };
    const relink = () => {
      const design = deps.detail()?.design;
      if (!design) return;
      const key = JSON.stringify([design.sessionId, design.projectDirectory, host2.directory.get()]);
      if (key === linkKey) return;
      linkKey = key;
      generation += 1;
      stopSessions?.();
      stopSessions = null;
      link = { sessionId: design.sessionId, projectDirectory: design.projectDirectory };
      fallback = false;
      if (design.sessionId === null) {
        applySession("none");
        return;
      }
      void subscribeSessions(generation, design.sessionId, design.projectDirectory);
    };
    const syncDetail = () => {
      const detail = deps.detail();
      if (!detail) return;
      const { design } = detail;
      const created = Date.parse(design.created);
      apply({
        kind: "detail",
        at: now(),
        pending: detail.pending,
        created: Number.isFinite(created) ? created : track.createdAt,
        screensTotal: design.screens.length,
        screensWritten: design.screens.filter((screen) => detail.files.screens[screen.id]?.exists === true).length,
        isCanvas: design.kind === "canvas"
      });
      relink();
    };
    const unsubscribers = [
      deps.onDetail(syncDetail),
      feed2.subscribe((batch) => {
        if (batch.reset) apply({ kind: "reset", at: now() });
        const { files, created, restored } = batchAgentFiles(batch.events, slug);
        if (restored) apply({ kind: "restore", at: now() });
        if (files.length > 0 || created) apply({ kind: "files", at: now(), files, created });
      }),
      feed2.onStatus((status) => apply({ kind: "feed", at: now(), state: status.state })),
      host2.session.subscribe(() => {
        if (fallback) applyFallback();
      }),
      host2.directory.subscribe(relink)
    ];
    apply({ kind: "feed", at: now(), state: feed2.status().state });
    syncDetail();
    return {
      get: () => track,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dismiss: () => apply({ kind: "dismiss", at: now() }),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        generation += 1;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        for (const unsubscribe of unsubscribers) unsubscribe();
        stopSessions?.();
        stopSessions = null;
        listeners.clear();
      }
    };
  };

  // src/ui/components/build-strip.ts
  var mountBuildStrip = (host2, options) => {
    const dot = h("span", { class: "dc-build-dot", "aria-hidden": "true" });
    const text = h("span", { class: "dc-build-text" });
    const elapsed = h("span", { class: "dc-build-elapsed", "aria-hidden": "true", hidden: true });
    const live = h("span", { class: "dc-build-live", role: "status", "aria-live": "polite", "aria-atomic": "true" }, dot, text, elapsed);
    const detail = h("span", { class: "dc-build-detail", hidden: true });
    const openChat = options.compact ? iconBtn({ icon: "chat", label: "Open chat", size: "sm", onClick: () => options.onOpenChat() }) : btn({ label: "Open chat", icon: "chat", variant: "ghost", size: "xs", onClick: () => options.onOpenChat() }).el;
    const dismiss = options.compact ? iconBtn({ icon: "close", label: "Dismiss", size: "sm", onClick: () => options.onDismiss() }) : btn({ label: "Dismiss", variant: "ghost", size: "xs", onClick: () => options.onDismiss() }).el;
    const actions = h("span", { class: "dc-build-actions", hidden: true }, openChat, dismiss);
    const root = h("div", { class: "dc-build", "data-phase": "hidden", "data-compact": String(options.compact) }, live, detail, actions);
    host2.append(root);
    let announced = null;
    return {
      update: (view2) => {
        root.dataset.phase = view2.phase;
        root.dataset.tone = view2.tone;
        if (view2.announce !== announced) {
          text.textContent = view2.announce === null ? "" : options.compact ? view2.pill : view2.text;
          announced = view2.announce;
        }
        text.title = view2.announce === null ? "" : view2.title ?? view2.text;
        elapsed.textContent = view2.elapsed ?? "";
        elapsed.hidden = view2.elapsed === null;
        detail.textContent = options.compact ? "" : view2.detail ?? "";
        detail.hidden = options.compact || view2.detail === null;
        openChat.hidden = !view2.actions.includes("open-chat");
        dismiss.hidden = !view2.actions.includes("dismiss");
        actions.hidden = view2.actions.length === 0;
      },
      dispose: () => root.remove()
    };
  };

  // src/ui/model/build-strip-model.ts
  var SECOND2 = 1e3;
  var formatElapsed = (ms) => {
    const total = Math.max(0, Math.floor(ms / SECOND2));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
  };
  var basename = (path) => path.split("/").filter((part) => part !== "").at(-1) ?? path;
  var FULL_PATH_MAX = 48;
  var NAME_MAX = 24;
  var pillText = (phase, file) => {
    switch (phase) {
      case "writing":
        return file ? `Writing ${middlePath(basename(file), NAME_MAX)}` : "Writing";
      case "working":
        return "Agent is working";
      case "failed":
        return "Agent stopped";
      case "done":
        return "Done";
    }
  };
  var HIDDEN = { phase: "hidden", text: "", pill: "", detail: null, elapsed: null, title: null, tone: "info", actions: [], announce: null };
  var view = (phase, track, now, copy) => ({
    phase,
    text: copy.text,
    pill: copy.pill,
    detail: copy.detail ?? null,
    elapsed: copy.elapsed && track.turnStartedAt !== null ? formatElapsed(now - track.turnStartedAt) : null,
    title: copy.title ?? null,
    tone: copy.tone,
    actions: copy.actions ?? [],
    announce: copy.text
  });
  var buildView = (track, now, locale = "en") => {
    const phase = phaseOf(track, now);
    const last = track.lastFile;
    switch (phase) {
      case "hidden":
        return HIDDEN;
      case "offline":
        return view(phase, track, now, { text: "Reconnecting to the local service", pill: "Reconnecting", tone: "warning" });
      case "question":
        return view(phase, track, now, { text: "The agent is asking you something in the chat", pill: "Agent has a question", tone: "warning", actions: ["open-chat"] });
      case "permission":
        return view(phase, track, now, { text: "The agent needs your OK in the chat", pill: "Agent needs your OK", tone: "warning", actions: ["open-chat"] });
      case "failed":
        return view(phase, track, now, { text: "The agent stopped with an error", pill: pillText("failed", null), tone: "error", actions: ["open-chat", "dismiss"] });
      case "writing": {
        const path = last?.path ?? null;
        return view(phase, track, now, {
          text: path ? `Writing ${middlePath(path, FULL_PATH_MAX)}` : "The agent is writing",
          pill: pillText("writing", path),
          detail: track.isCanvas && track.screensTotal > 1 ? `${track.screensWritten} of ${track.screensTotal} screens written` : null,
          title: path,
          tone: "info",
          elapsed: true
        });
      }
      case "retrying":
        return view(phase, track, now, { text: "The agent hit a problem and is retrying", pill: "Agent is retrying", tone: "warning", elapsed: true });
      case "working": {
        const since = last?.at ?? track.turnStartedAt;
        let detail = null;
        if (since !== null && now - since >= QUIET_MS) detail = "Nothing saved in the last 2 minutes";
        else if (last) {
          const when = relativeTime(new Date(last.at).toISOString(), now, locale);
          detail = last.path ? `Last saved ${middlePath(basename(last.path), NAME_MAX)} ${when}` : `Last saved ${when}`;
        }
        return view(phase, track, now, { text: "The agent is working", pill: pillText("working", null), detail, tone: "info", elapsed: true });
      }
      case "done": {
        const count = track.turnFiles.length;
        return view(phase, track, now, {
          text: count > 0 ? `Done. Updated ${plural(count, "file")}` : "Done. No files changed",
          pill: pillText("done", null),
          tone: "success",
          actions: count > 0 ? [] : ["open-chat"]
        });
      }
      case "stalled":
        return view(phase, track, now, { text: "Nothing written yet. Check the chat for a question.", pill: "Nothing written yet", tone: "warning", actions: ["open-chat", "dismiss"] });
    }
  };

  // src/ui/wall/feature-build-strip.ts
  var REPAINT_MS = 1e3;
  var sameSet = (a, b) => a === b || a !== null && b !== null && a.size === b.size && [...a].every((value) => b.has(value));
  var mount2 = (ctx) => {
    const compact = ctx.surface === "panel";
    ctx.slots.overlay.parentElement?.prepend(ctx.slots.overlay);
    const watcher = watchBuildActivity({ host: guestHost, feed, slug: ctx.slug, detail: ctx.detail, onDetail: ctx.onDetail });
    const strip = mountBuildStrip(ctx.slots.overlay, {
      compact,
      onOpenChat: () => void continueInChat(ctx.slug),
      onDismiss: () => {
        watcher.dismiss();
        ctx.wall.focus();
      }
    });
    let tick = null;
    const render = () => {
      const view2 = buildView(watcher.get(), Date.now(), host.snapshot()?.locale ?? "en");
      strip.update(view2);
      const wantsTick = view2.elapsed !== null && !document.hidden;
      if (wantsTick && tick === null) tick = setInterval(render, REPAINT_MS);
      else if (!wantsTick && tick !== null) {
        clearInterval(tick);
        tick = null;
      }
    };
    const unwatch = watcher.subscribe(render);
    const onVisibility = () => render();
    document.addEventListener("visibilitychange", onVisibility);
    render();
    let recentFiles = [];
    let recentTimer = null;
    let lit = null;
    const setLit = (next, restart = false) => {
      if (!restart && sameSet(lit, next)) return;
      lit = next;
      ctx.wall.markRecent(next);
    };
    const clearRecent = () => {
      if (recentTimer !== null) clearTimeout(recentTimer);
      recentTimer = null;
      recentFiles = [];
      setLit(null);
    };
    const sourcesOf = () => {
      const touched = affectedSources(ctx.detail().design, recentFiles);
      return touched === "all" || touched.length === 0 ? null : new Set(touched);
    };
    const unfeed = feed.subscribe((batch) => {
      const { files, restored } = batchAgentFiles(batch.events, ctx.slug);
      if (restored) clearRecent();
      if (files.length === 0 || inRestoreQuiet(watcher.get(), Date.now())) return;
      if (recentTimer !== null) clearTimeout(recentTimer);
      recentFiles = files;
      setLit(sourcesOf(), true);
      recentTimer = setTimeout(clearRecent, RECENT_MS);
    });
    const undetail = ctx.onDetail(() => {
      if (recentFiles.length > 0) setLit(sourcesOf());
    });
    return () => {
      unfeed();
      undetail();
      unwatch();
      document.removeEventListener("visibilitychange", onVisibility);
      if (tick !== null) clearInterval(tick);
      clearRecent();
      strip.dispose();
      watcher.dispose();
    };
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
    "token-redefined": { severity: "warning", sentence: (f) => `${fileOf(f)} redefines ${num(f.params?.count)} tokens from tokens.css. Change them in tokens.css.` },
    "token-hardcoded": {
      severity: "info",
      sentence: (f) => `${fileOf(f)} has ${num(f.params?.count)} hardcoded colours although tokens.css defines colours.`
    },
    "check-partial": { severity: "info", sentence: () => "Some files were not checked in time." }
  };
  var CHECK_CODES = Object.freeze(Object.keys(RULES));
  var SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
  var sortFindings = (findings) => findings.map((finding, index) => ({ finding, index })).sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.index - b.index).map((entry) => entry.finding);

  // src/ui/model/checks-model.ts
  var issueCount = (summary) => summary.counts.errors + summary.counts.warnings;
  var rendersCounted = (response) => {
    const { state, findings } = response.render;
    if (state === "fresh") return true;
    if (state !== "unavailable" && state !== "failed") return false;
    if (findings.length === 0) return true;
    const all = [...response.static.findings, ...findings];
    const count = (severity) => all.filter((finding) => finding.severity === severity).length;
    return count("error") === response.counts.errors && count("warning") === response.counts.warnings && count("info") === response.counts.notes;
  };
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
  var renderLineOf = (response, nowMs, locale) => {
    const { state, at, artboards } = response.render;
    switch (state) {
      case "none":
        return { text: "Rendering hasn\u2019t been checked yet.", tone: "muted" };
      case "running":
        return { text: "Checking the rendering\u2026", tone: "busy" };
      case "stale":
        return { text: "Rendering was checked before your latest changes.", tone: "warn" };
      case "unavailable":
        return { text: "No Chrome, Edge or Chromium was found, so only the files were checked.", tone: "muted" };
      case "failed":
        return { text: "The last rendering check failed.", tone: "warn" };
      case "fresh": {
        if (artboards === 0) return { text: "There was nothing to render yet.", tone: "muted" };
        const when = at === null ? "" : relativeTime(at, nowMs, locale);
        return { text: `Rendered ${plural(artboards, "artboard")}${when === "" ? "" : ` ${when}`}.`, tone: "ok" };
      }
    }
  };
  var GROUP_TITLES = {
    errors: "Needs fixing",
    warnings: "Worth a look",
    notes: "Notes",
    stale: "From before your latest changes",
    running: "From the last rendering check"
  };
  var isRenderLineFinding = (finding) => finding.code === "browser-missing";
  var groupsOf = (response) => {
    const counted = rendersCounted(response);
    const render = response.render.findings;
    const current = sortFindings([...response.static.findings, ...counted ? render.filter((finding) => !isRenderLineFinding(finding)) : []]);
    const groups = [];
    const add = (group, items) => {
      if (items.length > 0) groups.push({ ...group, items });
    };
    add({ id: "errors", title: GROUP_TITLES.errors, tone: "error", collapsed: false }, current.filter((finding) => finding.severity === "error"));
    add({ id: "warnings", title: GROUP_TITLES.warnings, tone: "warning", collapsed: false }, current.filter((finding) => finding.severity === "warning"));
    add({ id: "notes", title: GROUP_TITLES.notes, tone: "info", collapsed: true }, current.filter((finding) => finding.severity === "info"));
    if (!counted) {
      const title = response.render.state === "running" ? GROUP_TITLES.running : GROUP_TITLES.stale;
      add({ id: "earlier", title, tone: "muted", collapsed: true }, sortFindings(render));
    }
    return groups;
  };
  var summaryOf = (response) => {
    const { errors, warnings } = response.counts;
    const notes = response.counts.notes - (rendersCounted(response) ? response.render.findings.filter(isRenderLineFinding).length : 0);
    const parts = [];
    if (errors > 0) parts.push(plural(errors, "error"));
    if (warnings > 0) parts.push(plural(warnings, "warning"));
    const head = parts.length > 0 ? parts.join(", ") : "No errors or warnings";
    return notes > 0 ? `${head}. ${plural(notes, "note")}.` : `${head}.`;
  };
  var panelOf = (response, error, running, nowMs, locale) => {
    if (response === null) {
      return {
        phase: error === null ? "loading" : "error",
        error: error === null ? null : { title: "Checks didn\u2019t load", message: error },
        summary: "",
        groups: [],
        renderLine: null,
        nextStep: null,
        ask: { disabled: true },
        primary: null,
        run: { visible: false, label: "Check rendering", busy: false }
      };
    }
    const busy = running || response.render.state === "running";
    const groups = groupsOf(response);
    const rendering = response.render.state;
    return {
      phase: "ready",
      error: error === null ? null : { title: "Checks didn\u2019t refresh", message: error },
      summary: summaryOf(response),
      groups,
      // The person pressed the button before the service has said "running": the line already says so.
      renderLine: busy ? { text: "Checking the rendering\u2026", tone: "busy" } : renderLineOf(response, nowMs, locale),
      nextStep: groups.length === 0 && response.canRun && !busy && (rendering === "none" || rendering === "stale") ? "Check rendering to look at every screen at its size." : null,
      ask: { disabled: issueCount(response) === 0 },
      primary: issueCount(response) > 0 ? "ask" : response.canRun && !busy ? "run" : null,
      run: { visible: response.canRun || busy, label: response.render.state === "none" || busy ? "Check rendering" : "Check again", busy }
    };
  };
  var runResultOf = (response) => {
    const { state } = response.render;
    if (state === "unavailable") return "No browser was found, so the rendering was not checked.";
    if (state === "failed") return "The rendering check failed.";
    const issues = issueCount(response);
    return `Rendering check finished. ${issues === 0 ? "No issues." : `${plural(issues, "issue")}.`}`;
  };
  var REFRESH_KINDS = /* @__PURE__ */ new Set(["files", "design", "checks", "added"]);
  var shouldRefetch = (batch, slug) => batch.reset || batch.events.some((event) => event.slug === slug && REFRESH_KINDS.has(event.kind) || event.kind === "root");

  // src/ui/components/checks-badge.ts
  var REFETCH_MS = 600;
  var RUNNING_POLL_MS = 4e3;
  var syncChildren = (parent, wanted) => {
    wanted.forEach((node, index) => {
      if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
    });
    while (parent.children.length > wanted.length) parent.lastElementChild?.remove();
  };
  var setPrimary = (button2, primary2) => {
    if (primary2) {
      button2.dataset.emphasis = "primary";
      button2.dataset.variant = "default";
    } else {
      delete button2.dataset.emphasis;
      button2.dataset.variant = "outline";
    }
  };
  var buildPanel = (actions) => {
    const opened = /* @__PURE__ */ new Set();
    const nodes = /* @__PURE__ */ new Map();
    const summary = h("p", { class: "dc-checks-summary", id: nextId2("dc-checks-summary") });
    const renderLine = h("p", { class: "dc-checks-render" });
    const notice = h("div", { class: "dc-checks-notice" });
    const groups = h("div", { class: "dc-checks-groups" });
    const body = h("div", { class: "dc-checks-panel", tabindex: "-1" }, summary, renderLine, notice, groups);
    const ask = btn({ label: "Ask the agent to fix", variant: "default", size: "sm", icon: "send", emphasis: "primary", onClick: actions.ask });
    const run = btn({ label: "Check rendering", variant: "outline", size: "sm", onClick: actions.run });
    ask.el.setAttribute("aria-describedby", summary.id);
    const foot = h("div", { class: "dc-checks-actions" }, ask.el, run.el);
    const next = h("p", { class: "dc-checks-next" });
    const skeleton = h("div", { class: "dc-checks-skeleton", "aria-hidden": "true" }, h("span", { class: "dc-checks-skel", "data-w": "short" }), h("span", { class: "dc-checks-skel" }), h("span", { class: "dc-checks-skel" }), h("span", { class: "dc-checks-skel", "data-w": "mid" }));
    let noticeKey = "";
    const row = (finding) => h(
      "li",
      { class: "dc-checks-item", "data-severity": finding.severity },
      h("p", { class: "dc-checks-msg" }, finding.message),
      // Design text: shown as text in a code element, whole value on hover, never parsed.
      finding.detail ? h("code", { class: "dc-path dc-checks-code", title: finding.detail }, finding.detail) : null,
      finding.selector ? h("code", { class: "dc-path dc-checks-code", "data-kind": "selector", title: finding.selector }, finding.selector) : null
    );
    const createGroup = (entry) => {
      const list = h("ul", { class: "dc-checks-list" });
      if (!entry.collapsed) {
        const title2 = h("h3", { class: "dc-checks-group-title" });
        return { el: h("section", { class: "dc-checks-group" }, title2, list), title: title2, list, collapsed: false, signature: "" };
      }
      const title = h("summary", { class: "dc-checks-group-title" });
      const details = h("details", { class: "dc-checks-group" }, title, list);
      details.open = opened.has(entry.id);
      details.addEventListener("toggle", () => void (details.open ? opened.add(entry.id) : opened.delete(entry.id)));
      return { el: details, title, list, collapsed: true, signature: "" };
    };
    const groupNode = (entry) => {
      let node = nodes.get(entry.id);
      if (!node || node.collapsed !== entry.collapsed) {
        node = createGroup(entry);
        nodes.set(entry.id, node);
      }
      node.el.dataset.tone = entry.tone;
      node.title.textContent = `${entry.title} \xB7 ${entry.items.length}`;
      const signature = JSON.stringify(entry.items.map((item) => [item.message, item.detail, item.selector]));
      if (signature !== node.signature) {
        node.list.replaceChildren(...entry.items.map(row));
        node.signature = signature;
      }
      return node.el;
    };
    return {
      body,
      foot,
      update: (view2) => {
        const hadFocus = document.activeElement;
        body.setAttribute("aria-busy", view2.phase === "loading" ? "true" : "false");
        summary.textContent = view2.summary;
        summary.hidden = view2.summary === "";
        renderLine.hidden = view2.renderLine === null;
        renderLine.textContent = view2.renderLine?.text ?? "";
        renderLine.dataset.tone = view2.renderLine?.tone ?? "muted";
        const wantedKey = view2.error ? `${view2.error.title}
${view2.error.message}` : "";
        if (wantedKey !== noticeKey) {
          noticeKey = wantedKey;
          notice.replaceChildren();
          if (view2.error) notice.append(banner({ tone: "error", title: view2.error.title, body: view2.error.message, action: { label: "Try again", onClick: actions.retry } }));
        }
        const wanted = [];
        if (view2.phase === "loading") wanted.push(skeleton);
        else if (view2.phase === "ready") {
          if (view2.nextStep) {
            next.textContent = view2.nextStep;
            wanted.push(next);
          }
          const shown = view2.groups.map(groupNode);
          wanted.push(...shown);
          for (const id of [...nodes.keys()]) if (!view2.groups.some((entry) => entry.id === id)) nodes.delete(id);
        } else nodes.clear();
        syncChildren(groups, wanted);
        foot.hidden = view2.phase !== "ready";
        ask.set({ disabled: view2.ask.disabled, title: view2.ask.disabled ? "Nothing to fix" : void 0 });
        run.el.hidden = !view2.run.visible;
        run.set({ label: view2.run.label, loading: view2.run.busy });
        setPrimary(ask.el, view2.primary === "ask");
        setPrimary(run.el, view2.primary === "run");
        if (hadFocus === ask.el && ask.el.disabled || hadFocus === run.el && (run.el.disabled || run.el.hidden)) body.focus({ preventScroll: true });
      },
      focusFirst: () => {
        const target = !ask.el.disabled ? ask.el : !run.el.hidden && !run.el.disabled ? run.el : null;
        target?.focus({ preventScroll: true });
        return target !== null;
      }
    };
  };
  var mountChecksBadge = (options) => {
    const { slug } = options;
    const compact = options.surface === "panel";
    const scope = createScope();
    let response = null;
    let error = null;
    let requested = false;
    let jobStarted = false;
    let wasBusy = false;
    let disposed = false;
    let token = 0;
    let pollTimer;
    const glyph = h("span", { class: "dc-checks-glyph", "aria-hidden": "true" });
    const ring2 = h("span", { class: "oc-sdk-spinner-ring dc-checks-ring", "aria-hidden": "true" });
    const label = h("span", { class: "dc-checks-label" }, "Checking");
    const button2 = h("button", { type: "button", class: "oc-sdk oc-sdk-badge dc-checks-badge", "data-compact": compact ? "true" : "false", "aria-haspopup": "dialog", "aria-expanded": "false" }, glyph, ring2, label);
    const live = h("span", { class: "dc-sr-only", role: "status", "aria-live": "polite" });
    let lastAnnounced = "";
    const el2 = h("div", { class: "dc-checks", "data-surface": options.surface }, button2, live);
    const busy = () => requested || response?.render.state === "running";
    let panel = null;
    let closeSurface = null;
    const view2 = () => panelOf(response, error, busy(), Date.now(), host.snapshot()?.locale ?? "en");
    const paint = () => {
      const next = badgeOf(response, error, busy());
      label.textContent = compact ? next.count > 0 ? String(next.count) : "" : next.label;
      label.hidden = compact && next.count === 0;
      if (next.tone === "neutral") button2.removeAttribute("data-tone");
      else button2.dataset.tone = next.tone;
      button2.setAttribute("aria-label", next.ariaLabel);
      button2.title = next.ariaLabel;
      const checking = next.label === "Checking";
      button2.setAttribute("aria-busy", checking ? "true" : "false");
      ring2.hidden = !checking;
      glyph.replaceChildren();
      if (!checking) {
        const clean = next.label === "No issues";
        const mark = next.tone === "success" || compact && clean ? icon2("check", 12) : next.tone === "error" || next.tone === "warning" || compact && next.label === "Checks" ? icon2("alert", 12) : null;
        if (mark) glyph.append(mark);
      }
      glyph.hidden = glyph.childElementCount === 0;
      panel?.update(view2());
    };
    const announce = (text) => {
      if (text === lastAnnounced) return;
      lastAnnounced = text;
      live.textContent = text;
    };
    const poll = () => {
      clearTimeout(pollTimer);
      if (disposed || !busy()) return;
      pollTimer = setTimeout(() => void load(), RUNNING_POLL_MS);
    };
    const load = async () => {
      token += 1;
      const mine = token;
      try {
        const answer = await client.call("GET /designs/:slug/checks", { params: { slug } });
        if (disposed || mine !== token) return;
        response = answer;
        error = null;
        if (requested && jobStarted && answer.render.state !== "running") {
          requested = false;
          jobStarted = false;
        }
      } catch (failure) {
        if (disposed || mine !== token) return;
        error = errorText2(failure);
        if (requested && jobStarted) {
          requested = false;
          jobStarted = false;
        }
      }
      const nowBusy = busy();
      if (wasBusy && !nowBusy && response && error === null) announce(runResultOf(response));
      wasBusy = nowBusy;
      paint();
      poll();
    };
    const refetchSoon = debounce(() => {
      if (!disposed) void load();
    }, REFETCH_MS);
    scope.add(
      feed.subscribe((batch) => {
        if (shouldRefetch(batch, slug)) refetchSoon();
      })
    );
    scope.add(() => clearTimeout(pollTimer));
    let asking = false;
    const askToFix = async () => {
      if (asking) return;
      asking = true;
      try {
        const said = askRequestToast(await askAgent(slug, "checks"));
        if (said !== null) toast("success", said);
        closeSurface?.(false);
      } catch (failure) {
        toast("error", `Couldn\u2019t ask the agent. ${errorText2(failure)}`);
        if (isServiceError(failure, "invalid")) void load();
      } finally {
        asking = false;
      }
    };
    const checkRendering = async () => {
      if (busy()) return;
      requested = true;
      jobStarted = false;
      wasBusy = true;
      paint();
      announce("Checking the rendering\u2026");
      try {
        await client.call("POST /designs/:slug/checks/run", { params: { slug }, body: {} });
        jobStarted = true;
      } catch (failure) {
        requested = false;
        wasBusy = false;
        lastAnnounced = "";
        live.textContent = "";
        toast("error", `Couldn\u2019t check the rendering. ${errorText2(failure)}`);
        paint();
        void load();
        return;
      }
      await load();
    };
    const open = () => {
      if (closeSurface) return;
      const handle = buildPanel({ ask: () => void askToFix(), run: () => void checkRendering(), retry: () => void load() });
      let popoverEl = null;
      const release = () => {
        closeSurface = null;
        panel = null;
        button2.setAttribute("aria-expanded", "false");
      };
      if (compact) {
        const sheet = openSheet(options.host, { title: "Checks", variant: "full", onClose: release });
        sheet.body.append(handle.body);
        sheet.foot.append(handle.foot);
        closeSurface = () => sheet.close();
      } else {
        const popover = openPopover(options.host, button2, { title: "Checks", onClose: release });
        popover.body.append(handle.body);
        popover.foot.append(handle.foot);
        closeSurface = (restoreFocus) => popover.close(restoreFocus);
        popoverEl = popover.el;
      }
      panel = handle;
      button2.setAttribute("aria-expanded", "true");
      paint();
      queueMicrotask(() => void (handle.focusFirst() || popoverEl?.focus({ preventScroll: true })));
      void load();
    };
    button2.addEventListener("click", () => {
      if (closeSurface) closeSurface();
      else open();
    });
    paint();
    void load();
    return {
      el: el2,
      setHidden: (next) => {
        el2.hidden = next;
        if (next) closeSurface?.(false);
      },
      dispose: () => {
        disposed = true;
        closeSurface?.(false);
        scope.dispose();
        el2.remove();
      }
    };
  };

  // src/ui/wall/feature-checks.ts
  var mount3 = (ctx) => {
    const badge = mountChecksBadge({ slug: ctx.slug, surface: ctx.surface, host: ctx.actions.host });
    (ctx.surface === "page" ? ctx.slots.statusSlot : ctx.slots.compactActions).append(badge.el);
    const syncViewing = () => badge.setHidden(ctx.viewing() !== null);
    syncViewing();
    const unwatch = ctx.onViewing(syncViewing);
    return () => {
      unwatch();
      badge.dispose();
    };
  };

  // src/ui/wall/feature-findability.ts
  var mount4 = (ctx) => {
    if (ctx.surface !== "panel") return () => void 0;
    const chip = btn({ label: "", icon: "comment", variant: "outline", size: "xs", pressed: false, onClick: () => ctx.drawers.toggle("comments") });
    chip.el.classList.add("dc-comments-chip");
    const versions = iconBtn({ icon: "history", label: "Versions", size: "sm", pressed: false, onClick: () => ctx.drawers.toggle("versions") });
    versions.classList.add("dc-versions-btn");
    const paint = () => {
      const open = ctx.detail().design.comments.filter((comment) => comment.status === "open").length;
      const { label, aria } = commentsChip(open);
      chip.set({ label, title: aria, pressed: ctx.drawers.active() === "comments" });
      chip.el.setAttribute("aria-label", aria);
      chip.el.dataset.count = open > 0 ? "some" : "none";
      versions.setAttribute("aria-pressed", String(ctx.drawers.active() === "versions"));
    };
    ctx.slots.compactActions.append(chip.el, versions);
    paint();
    const stops = [ctx.onDetail(paint), ctx.drawers.onChange(paint)];
    return () => {
      for (const stop of stops) stop();
      chip.el.remove();
      versions.remove();
    };
  };

  // src/guest/anchoring.ts
  var clamp01 = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  var pinPoint = (rect, relative) => ({
    x: rect.x + clamp01(relative.x) * rect.w,
    y: rect.y + clamp01(relative.y) * rect.h
  });
  var commentsForArtboard = (comments, screen, viewport) => comments.filter((comment) => comment.screen === screen && comment.viewport === viewport);
  var anchorQueriesOf = (comments) => comments.map((comment) => ({ id: comment.id, selector: comment.anchor.selector, text: comment.anchor.text, html: comment.anchor.html }));
  var stateOf = (result) => {
    if (!result) return "pending";
    if (!result.found || !result.rect) return "detached";
    return result.exact ? "exact" : "moved";
  };
  var placePins = (comments, results) => {
    const byId = new Map((results ?? []).map((result) => [result.id, result]));
    return comments.map((comment) => {
      const result = byId.get(comment.id);
      const state = stateOf(result);
      const rect = (state === "exact" || state === "moved") && result?.rect ? result.rect : comment.anchor.rect;
      return { commentId: comment.id, state, rect, point: pinPoint(rect, comment.anchor.point) };
    });
  };
  var anchorStatesOf = (placements) => {
    const states = {};
    for (const placement of placements) {
      if (placement.state !== "pending") states[placement.commentId] = placement.state;
    }
    return states;
  };
  var docToFrame = (point, scroll) => ({ x: point.x - scroll.x, y: point.y - scroll.y });
  var isInFrameView = (point, scroll, frameSize) => {
    const inFrame = docToFrame(point, scroll);
    return inFrame.x >= 0 && inFrame.y >= 0 && inFrame.x <= frameSize.width && inFrame.y <= frameSize.height;
  };
  var anchorFromHit = (hit, click, scroll) => {
    const docX = click.x + scroll.x;
    const docY = click.y + scroll.y;
    return {
      selector: hit.selector,
      text: hit.text,
      html: hit.html,
      rect: hit.rect,
      point: {
        x: hit.rect.w > 0 ? clamp01((docX - hit.rect.x) / hit.rect.w) : 0.5,
        y: hit.rect.h > 0 ? clamp01((docY - hit.rect.y) / hit.rect.h) : 0.5
      }
    };
  };
  var trackPins = (channel, initial = []) => {
    let comments = initial;
    let results = null;
    let scroll = { x: 0, y: 0 };
    let askedIds = "";
    let ready = false;
    const listeners = /* @__PURE__ */ new Set();
    const emit = () => {
      const placements = placePins(comments, results);
      for (const listener of [...listeners]) listener(placements, scroll);
    };
    const ask = () => {
      if (!ready) return;
      askedIds = comments.map((comment) => comment.id).join(",");
      if (comments.length === 0) {
        results = [];
        emit();
        return;
      }
      channel.send({ type: "resolve-anchors", anchors: anchorQueriesOf(comments) });
    };
    const unsubscribe = channel.subscribe((message) => {
      switch (message.type) {
        case "ready":
          ready = true;
          ask();
          return;
        case "size":
          ready = true;
          ask();
          return;
        case "scroll":
          scroll = { x: message.x, y: message.y };
          emit();
          return;
        case "anchors":
          if (message.results.map((result) => result.id).join(",") !== askedIds) return;
          results = message.results;
          emit();
          return;
        default:
          return;
      }
    });
    return {
      setComments: (next) => {
        const sameAnchors = next.map((comment) => comment.id).join(",") === comments.map((comment) => comment.id).join(",");
        comments = next;
        if (sameAnchors) {
          emit();
          return;
        }
        results = null;
        emit();
        ask();
      },
      placements: () => placePins(comments, results),
      scroll: () => scroll,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => {
        listeners.clear();
        unsubscribe();
      }
    };
  };

  // src/shared/bridge-protocol.ts
  var BRIDGE_PROTOCOL_VERSION = 1;
  var BRIDGE_PLACEHOLDER = "<!--dc-bridge-->";
  var BRIDGE_KEYS = ["Escape", " ", "+", "=", "-", "0", "1"];
  var artboardIdOf = (screen, viewport) => `${screen ?? "page"}@${viewport}`;
  var isRec = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var isStr = (value, max) => typeof value === "string" && value.length <= max;
  var isId = (value, max) => isStr(value, max) && value.length > 0;
  var isNum = (value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= BRIDGE_COORD_MAX;
  var isSize = (value) => isNum(value) && value >= 0;
  var isBool = (value) => typeof value === "boolean";
  var isRect = (value) => isRec(value) && isNum(value.x) && isNum(value.y) && isSize(value.w) && isSize(value.h);
  var isKey = (value) => BRIDGE_KEYS.includes(value);
  var isList = (value, max, item) => Array.isArray(value) && value.length <= max && value.every(item);
  var isAnchorResult = (value) => isRec(value) && isId(value.id, BRIDGE_ARTBOARD_ID_MAX) && isBool(value.found) && isBool(value.exact) && (value.rect === null || isRect(value.rect));
  var isHitElement = (value) => isRec(value) && isStr(value.selector, ANCHOR_SELECTOR_MAX) && isStr(value.text, ANCHOR_TEXT_MAX) && isStr(value.html, ANCHOR_HTML_MAX) && isRect(value.rect) && isId(value.tag, BRIDGE_TAG_MAX);
  var hasEnvelope = (value) => value.dc === BRIDGE_PROTOCOL_VERSION && isId(value.artboardId, BRIDGE_ARTBOARD_ID_MAX) && isId(value.nonce, BRIDGE_NONCE_MAX);
  var FRAME_TO_PAGE = {
    ready: (m) => isSize(m.docWidth) && isSize(m.docHeight) && isStr(m.title, BRIDGE_TITLE_MAX),
    size: (m) => isSize(m.docWidth) && isSize(m.docHeight),
    scroll: (m) => isNum(m.x) && isNum(m.y),
    hit: (m) => isNum(m.x) && isNum(m.y) && (m.element === null || isHitElement(m.element)),
    anchors: (m) => isList(m.results, BRIDGE_ANCHORS_MAX, isAnchorResult),
    navigate: (m) => isId(m.href, BRIDGE_URL_MAX) && isStr(m.hash, BRIDGE_URL_MAX) && (m.hash === "" || m.hash.startsWith("#")),
    "open-external": (m) => isId(m.url, BRIDGE_URL_MAX) && /^https?:\/\//i.test(m.url),
    wheel: (m) => isNum(m.deltaX) && isNum(m.deltaY) && isNum(m.x) && isNum(m.y) && isBool(m.ctrl),
    key: (m) => isKey(m.key) && isBool(m.ctrl) && isBool(m.meta) && isBool(m.shift)
  };
  var parseWith = (table, data) => {
    if (!isRec(data) || !hasEnvelope(data) || typeof data.type !== "string") return null;
    if (!Object.hasOwn(table, data.type)) return null;
    const check = table[data.type];
    return check !== void 0 && check(data) ? data : null;
  };
  var parseFrameMessage = (data) => parseWith(FRAME_TO_PAGE, data);

  // src/guest/camera.ts
  var DEFAULT_CAMERA = Object.freeze({ x: 0, y: 0, scale: 1 });
  var FIT_PADDING = 48;
  var FIT_MIN_WIDTH = 240;
  var clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  var clampScale = (scale) => Number.isFinite(scale) ? clamp(scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX) : DEFAULT_CAMERA.scale;
  var clampCamera = (camera) => ({
    x: Number.isFinite(camera.x) ? clamp(camera.x, -CAMERA_PAN_MAX, CAMERA_PAN_MAX) : 0,
    y: Number.isFinite(camera.y) ? clamp(camera.y, -CAMERA_PAN_MAX, CAMERA_PAN_MAX) : 0,
    scale: clampScale(camera.scale)
  });
  var screenToWorld2 = (camera, point) => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale
  });
  var zoomAt = (camera, scale, point) => {
    const next = clampScale(scale);
    const world = screenToWorld2(camera, point);
    return clampCamera({ x: point.x - world.x * next, y: point.y - world.y * next, scale: next });
  };
  var wheelZoom = (camera, deltaY, point) => Number.isFinite(deltaY) ? zoomAt(camera, camera.scale * Math.exp(-deltaY * WHEEL_ZOOM_RATE), point) : camera;
  var panBy = (camera, dx, dy) => Number.isFinite(dx) && Number.isFinite(dy) ? clampCamera({ ...camera, x: camera.x + dx, y: camera.y + dy }) : camera;
  var unionBoxes = (boxes) => {
    if (boxes.length === 0) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const box of boxes) {
      left = Math.min(left, box.x);
      top = Math.min(top, box.y);
      right = Math.max(right, box.x + box.width);
      bottom = Math.max(bottom, box.y + box.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  var fitBox = (box, viewport, options = {}) => {
    const padding = options.padding ?? FIT_PADDING;
    const maxScale = options.maxScale ?? 1;
    const availableWidth = Math.max(1, viewport.width - padding * 2);
    const availableHeight = Math.max(1, viewport.height - padding * 2);
    const fit = Math.min(availableWidth / Math.max(1, box.width), availableHeight / Math.max(1, box.height));
    const scale = clampScale(Math.min(maxScale, fit));
    return clampCamera({
      x: viewport.width / 2 - (box.x + box.width / 2) * scale,
      y: viewport.height / 2 - (box.y + box.height / 2) * scale,
      scale
    });
  };
  var fitArea = (wall, coveredRight, minWidth = FIT_MIN_WIDTH) => {
    const visible = wall.width - Math.max(0, coveredRight);
    const width = visible >= minWidth ? visible : wall.width;
    return { width, height: wall.height, padding: width < 480 ? 24 : 56 };
  };
  var focusArtboard = (artboard, viewport, options) => fitBox(artboardBox(artboard), viewport, options);
  var artboardBox = (artboard) => ({
    x: artboard.label.x,
    y: artboard.label.y,
    width: artboard.frame.width,
    height: artboard.label.height + artboard.frame.height
  });
  var layoutWall = (screens, viewports, options = {}) => {
    const gap = options.gap ?? WALL_GAP;
    const labelHeight = options.labelHeight ?? ARTBOARD_LABEL_HEIGHT;
    const columnX = [];
    let x = 0;
    for (const viewport of viewports) {
      columnX.push(x);
      x += viewport.width + gap;
    }
    const artboards = [];
    let y = 0;
    let row = 0;
    for (const screen of screens) {
      const shown = new Set(screen.viewports ?? viewports.map((viewport) => viewport.id));
      const cells = viewports.map((viewport, col) => ({ viewport, col })).filter(({ viewport }) => shown.has(viewport.id));
      if (cells.length === 0) continue;
      const rowHeight = Math.max(...cells.map(({ viewport }) => viewport.height));
      for (const { viewport, col } of cells) {
        const left = columnX[col] ?? 0;
        artboards.push({
          id: artboardIdOf(screen.id, viewport.id),
          screen: screen.id,
          screenTitle: screen.title,
          viewport,
          row,
          col,
          label: { x: left, y, width: viewport.width, height: labelHeight },
          frame: { x: left, y: y + labelHeight, width: viewport.width, height: viewport.height }
        });
      }
      y += labelHeight + rowHeight + gap;
      row += 1;
    }
    return { artboards, bounds: unionBoxes(artboards.map(artboardBox)) };
  };

  // src/guest/frame-channel.ts
  var acceptFrameMessage = (event, expectedSource, identity) => {
    if (expectedSource === null || expectedSource === void 0 || event.source !== expectedSource) return null;
    const message = parseFrameMessage(event.data);
    if (!message || message.artboardId !== identity.artboardId || message.nonce !== identity.nonce) return null;
    return message;
  };
  var createFrameChannel = (options) => {
    const identity = { artboardId: options.artboardId, nonce: options.nonce };
    const target = options.window ?? window;
    const listeners = /* @__PURE__ */ new Set();
    let disposed = false;
    const onMessage = (event) => {
      const message = acceptFrameMessage(event, options.frame.contentWindow, identity);
      if (!message) return;
      if (message.type === "ready") send({ type: "init-ack" });
      for (const listener of [...listeners]) listener(message);
    };
    const send = (body) => {
      if (disposed) return;
      options.frame.contentWindow?.postMessage({ ...body, dc: BRIDGE_PROTOCOL_VERSION, ...identity }, "*");
    };
    target.addEventListener("message", onMessage);
    return {
      identity,
      send,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => {
        disposed = true;
        listeners.clear();
        target.removeEventListener("message", onMessage);
      }
    };
  };

  // src/guest/frame-doc.ts
  var ARTBOARD_SANDBOX = "allow-scripts";
  var bundledBridge = () => true ? '"use strict";(()=>{var k=/^[a-z0-9][a-z0-9-]{0,40}$/;var f=1;var U=["Escape"," ","+","=","-","0","1"];var G=t=>typeof t=="object"&&t!==null&&!Array.isArray(t),x=(t,e)=>typeof t=="string"&&t.length<=e,y=(t,e)=>x(t,e)&&t.length>0,u=t=>typeof t=="number"&&Number.isFinite(t)&&Math.abs(t)<=1e7;var nt=t=>t==="edit"||t==="play";var rt=(t,e,r)=>Array.isArray(t)&&t.length<=e&&t.every(r),st=t=>G(t)&&y(t.id,100)&&x(t.selector,1e3)&&x(t.text,120)&&x(t.html,200);var ct=t=>t.dc===f&&y(t.artboardId,100)&&y(t.nonce,64),lt={"init-ack":()=>!0,"set-mode":t=>nt(t.mode),"hit-test":t=>u(t.x)&&u(t.y),"resolve-anchors":t=>rt(t.anchors,500,st),"scroll-by":t=>u(t.dx)&&u(t.dy),"scroll-to":t=>u(t.x)&&u(t.y),highlight:t=>t.selector===null||x(t.selector,1e3)};var _t=(t,e)=>{if(!G(e)||!ct(e)||typeof e.type!="string"||!Object.hasOwn(t,e.type))return null;let r=t[e.type];return r!==void 0&&r(e)?e:null};var K=t=>_t(lt,t);var Et=["data-testid","data-screen","data-dc-id"],at=/^(is-|has-|js-|active|hover|focus)/,Y=/^-?[A-Za-z_][A-Za-z0-9_-]*$/,pt=3,A=t=>t.tagName===t.tagName.toUpperCase()?t.tagName.toLowerCase():t.tagName,v=t=>t.replace(/\\\\/g,"\\\\\\\\").replace(/"/g,\'\\\\"\').replace(/\\n/g,"\\\\a ").replace(/\\r/g,"\\\\d ").replace(/\\f/g,"\\\\c "),F=t=>t===""?null:Y.test(t)?`#${t}`:`[id="${v(t)}"]`,Tt=(t,e)=>{try{return t.querySelectorAll(e)}catch{return null}},R=(t,e,r)=>{let n=Tt(t,e);return n!==null&&n.length===1&&n[0]===r},dt=t=>{let e=[];for(let r=0;r<t.classList.length&&e.length<pt;r+=1){let n=t.classList[r];n!==void 0&&Y.test(n)&&!at.test(n)&&e.push(n)}return e},At=t=>{let e=t.parentElement;if(!e)return null;let r=0,n=0;for(let c=0;c<e.children.length;c+=1){let i=e.children[c];!i||i.tagName!==t.tagName||(n+=1,i===t&&(r=n))}return n>1?r:null},ut=t=>{let e=A(t);if(e==="html"||e==="body")return e;let r=dt(t).map(c=>`.${c}`).join(""),n=At(t);return`${e}${r}${n===null?"":`:nth-of-type(${n})`}`},X=t=>{let e=[...t];for(;e.join(" > ").length>1e3&&e.length>1;)e.shift();return e.join(" > ").slice(0,1e3)},V=(t,e)=>{let r=A(t);if(r==="html"||r==="body"||r==="head")return r;let n=F(t.id);if(n&&R(e,n,t))return n;for(let a of Et){let T=t.getAttribute(a);if(T===null||T==="")continue;let l=`[${a}="${v(T)}"]`;if(R(e,l,t))return l}let c=[],i=t;for(let a=0;i&&a<6;a+=1){c.unshift(ut(i));let T=c.join(" > ");if(R(e,T,t))return X(c);let l=i.parentElement;if(!l)break;let E=F(l.id);if(E&&R(e,E,l)){let p=[E,...c];if(R(e,p.join(" > "),t))return X(p)}i=l}return X(c)};var St=5e3,Rt=/^[A-Za-z][A-Za-z0-9-]*$/,L=t=>t.replace(/\\s+/g," ").trim(),z=t=>L(t.textContent??"").slice(0,120),Mt=t=>t.replace(/&/g,"&amp;").replace(/"/g,"&quot;"),Q=t=>{let e=`<${A(t)}`;for(let r=0;r<t.attributes.length;r+=1){let n=t.attributes[r];n&&(e+=n.value===""?` ${n.name}`:` ${n.name}="${Mt(n.value)}"`)}return e+=">",e.length<=200?e:`${e.slice(0,198)}\\u2026>`},gt=t=>{let e=/^<([A-Za-z][A-Za-z0-9:-]*)/.exec(t.trim());return e?.[1]?e[1].toLowerCase():null},W=(t,e)=>e===null||A(t).toLowerCase()===e,$=(t,e)=>{try{return t.querySelectorAll(e)}catch{return[]}},Z=(t,e)=>{let r={found:!1,exact:!1,element:null},n=gt(e.html);if(e.selector!==""){let l=$(t,e.selector);for(let E=0;E<l.length;E+=1){let p=l[E];if(p&&W(p,n))return{found:!0,exact:!0,element:p}}}let c=L(e.text);if(c.length<12)return r;let i=$(t,n!==null&&Rt.test(n)?n:"*"),a=null,T=1/0;for(let l=0;l<i.length&&l<St;l+=1){let E=i[l];if(!E||!W(E,n))continue;let p=L(E.textContent??"");p.startsWith(c)&&p.length<=T&&(a=E,T=p.length)}return a?{found:!0,exact:!1,element:a}:r};var j="https://design.invalid",D=t=>{try{return decodeURIComponent(t)}catch{return t}},q=(t,e)=>{let r=t.trim();if(r==="")return{kind:"blocked",reason:"empty link"};if(r.startsWith("#"))return{kind:"fragment",id:D(r.slice(1))};let n;try{n=new URL(r,`${j}/${e}`)}catch{return{kind:"blocked",reason:"malformed link"}}if(n.origin===j){let c=D(n.pathname.replace(/^\\/+/,""));return c===e||c===""?n.hash?{kind:"fragment",id:D(n.hash.slice(1))}:{kind:"blocked",reason:"same page"}:/\\.html?$/i.test(c)?c.length>2e3||n.hash.length>2e3?{kind:"blocked",reason:"link too long"}:{kind:"navigate",href:c,hash:n.hash}:{kind:"blocked",reason:"not a page of this design"}}return(n.protocol==="https:"||n.protocol==="http:")&&n.href.length<=2e3?{kind:"external",url:n.href}:{kind:"blocked",reason:`${n.protocol} links do not open from a design`}},J=t=>k.test(t)?{kind:"navigate",href:`screens/${t}.html`,hash:""}:{kind:"blocked",reason:"unknown screen id"};var It=16,Ot=5,mt=300,yt=t=>{if(typeof t!="object"||t===null)return null;let e=t,r=e.scroll;return typeof e.artboardId=="string"&&e.artboardId.length>0&&e.artboardId.length<=100&&typeof e.nonce=="string"&&e.nonce.length>0&&e.nonce.length<=64&&typeof e.file=="string"&&(e.mode==="edit"||e.mode==="play")&&typeof r=="object"&&r!==null&&Number.isFinite(r.x)&&Number.isFinite(r.y)?e:null},Nt=t=>t instanceof Element?!!t.closest(\'input, textarea, select, [contenteditable=""], [contenteditable="true"]\'):!1,Ct=t=>{let e=t.mode,r=!1,n=window.parent;if(n===window)return;let c=o=>{n.postMessage({...o,dc:f,artboardId:t.artboardId,nonce:t.nonce},"*")},i=()=>{let o=document.documentElement,s=document.body;return{docWidth:Math.max(o.scrollWidth,s?s.scrollWidth:0),docHeight:Math.max(o.scrollHeight,s?s.scrollHeight:0)}},a=o=>{let s=o.getBoundingClientRect();return{x:s.left+window.scrollX,y:s.top+window.scrollY,w:Math.max(0,s.width),h:Math.max(0,s.height)}},T=o=>({selector:V(o,document),text:z(o),html:Q(o),rect:a(o),tag:A(o).slice(0,64)||"element"}),l=null,E=o=>{let s=null;if(o)try{s=document.querySelector(o)}catch{s=null}if(!s){l?.remove(),l=null;return}l||(l=document.createElement("div"),l.setAttribute("data-dc-overlay",""),l.setAttribute("aria-hidden","true"));let _=a(s);l.setAttribute("style",`position:absolute;left:${_.x}px;top:${_.y}px;width:${_.w}px;height:${_.h}px;outline:2px solid Highlight;outline-offset:1px;pointer-events:none;z-index:2147483647;margin:0;padding:0;border:0;background:transparent;`),l.isConnected||document.documentElement.append(l)},p=o=>{switch(o.type){case"init-ack":r=!0;return;case"set-mode":e=o.mode;return;case"hit-test":{let s=document.elementFromPoint(o.x,o.y),_=s&&s!==document.documentElement&&s!==document.body&&!s.hasAttribute("data-dc-overlay");c({type:"hit",x:o.x,y:o.y,element:_?T(s):null});return}case"resolve-anchors":{let s=o.anchors.map(_=>{let d=Z(document,_);return{id:_.id,found:d.found,exact:d.exact,rect:d.element?a(d.element):null}});c({type:"anchors",results:s});return}case"scroll-by":window.scrollBy(o.dx,o.dy);return;case"scroll-to":window.scrollTo(o.x,o.y);return;case"highlight":E(o.selector);return}};window.addEventListener("message",o=>{if(o.source!==n)return;let s=K(o.data);!s||s.artboardId!==t.artboardId||s.nonce!==t.nonce||p(s)});let H=()=>c({type:"ready",...i(),title:document.title.slice(0,200)}),O=null,b="",M=()=>{O===null&&(O=setTimeout(()=>{O=null;let o=i(),s=`${o.docWidth}x${o.docHeight}`;s!==b&&(b=s,c({type:"size",...o}))},100))},m=!1;window.addEventListener("scroll",()=>{m||(m=!0,requestAnimationFrame(()=>{m=!1,c({type:"scroll",x:window.scrollX,y:window.scrollY})}))},{passive:!0});let B=()=>{(t.scroll.x!==0||t.scroll.y!==0)&&window.scrollTo(t.scroll.x,t.scroll.y),H();let o=0,s=setInterval(()=>{o+=1,r||o>Ot?clearInterval(s):H()},mt);if(typeof ResizeObserver=="function"){let _=new ResizeObserver(M);_.observe(document.documentElement),document.body&&_.observe(document.body)}typeof MutationObserver=="function"&&new MutationObserver(M).observe(document.documentElement,{childList:!0,subtree:!0,attributes:!0,characterData:!0}),M()};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",B,{once:!0}):B(),window.addEventListener("load",()=>{(t.scroll.x!==0||t.scroll.y!==0)&&window.scrollTo(t.scroll.x,t.scroll.y),M()});let P=o=>{switch(o.kind){case"fragment":{if(o.id===""){window.scrollTo(0,0);return}(document.getElementById(o.id)??document.getElementsByName(o.id)[0]??null)?.scrollIntoView();return}case"navigate":c({type:"navigate",href:o.href,hash:o.hash});return;case"external":c({type:"open-external",url:o.url});return;case"blocked":return}};document.addEventListener("click",o=>{let _=(o.target instanceof Element?o.target:null)?.closest("a[href], area[href], [data-dc-goto]")??null;if(!_)return;o.preventDefault();let d=_.getAttribute("data-dc-goto");if(d!==null){P(J(d));return}P(q(_.getAttribute("href")??"",t.file))},!0),document.addEventListener("submit",o=>o.preventDefault(),!0),window.addEventListener("wheel",o=>{let s=o.ctrlKey||o.metaKey;if(!s&&e!=="edit")return;o.preventDefault();let _=o.deltaMode===1?It:o.deltaMode===2?window.innerHeight:1;c({type:"wheel",deltaX:o.deltaX*_,deltaY:o.deltaY*_,x:o.clientX,y:o.clientY,ctrl:s})},{passive:!1,capture:!0}),window.addEventListener("keydown",o=>{Nt(o.target)||U.includes(o.key)&&c({type:"key",key:o.key,ctrl:o.ctrlKey,meta:o.metaKey,shift:o.shiftKey})},!0)},tt=yt(window.__DC);tt&&Ct(tt);})();\n' : "";
  var newNonce = () => {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  var bridgeInitOf = (init) => ({
    artboardId: init.artboardId,
    file: init.file,
    mode: init.mode,
    scroll: init.scroll ?? { x: 0, y: 0 },
    nonce: init.nonce ?? newNonce()
  });
  var scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  var bridgeScriptTag = (init, bridge) => {
    if (/<\/script/i.test(bridge)) throw new Error('Design Chamber: the bridge script contains "<\/script" and cannot be injected.');
    return `<script data-dc-bridge>window.__DC=${scriptJson(init)};
${bridge}
<\/script>`;
  };
  var HEAD_OPEN = /<head(?=[\s>/])[^>]*>/i;
  var HTML_OPEN = /<html(?=[\s>/])[^>]*>/i;
  var BODY_OPEN = /<body(?=[\s>/])/i;
  var DOCTYPE = /^\s*<!doctype[^>]*>/i;
  var injectBridge = (html, init, bridge) => {
    const tag = bridgeScriptTag(init, bridge);
    const placeholder = html.indexOf(BRIDGE_PLACEHOLDER);
    if (placeholder !== -1) return `${html.slice(0, placeholder)}${tag}${html.slice(placeholder + BRIDGE_PLACEHOLDER.length)}`;
    const head = HEAD_OPEN.exec(html);
    const body = BODY_OPEN.exec(html);
    if (head && (!body || head.index < body.index)) {
      const at2 = head.index + head[0].length;
      return `${html.slice(0, at2)}${tag}${html.slice(at2)}`;
    }
    const htmlOpen = HTML_OPEN.exec(html);
    if (htmlOpen && (!body || htmlOpen.index < body.index)) {
      const at2 = htmlOpen.index + htmlOpen[0].length;
      return `${html.slice(0, at2)}<head>${tag}</head>${html.slice(at2)}`;
    }
    const doctype = DOCTYPE.exec(html);
    const at = doctype ? doctype[0].length : 0;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  };
  var createFrameDocument = (html, init, bridge = bundledBridge()) => {
    const bridgeInit = bridgeInitOf(init);
    const blob = new Blob([injectBridge(html, bridgeInit, bridge)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    let revoked = false;
    return {
      url,
      init: bridgeInit,
      revoke: () => {
        if (revoked) return;
        revoked = true;
        URL.revokeObjectURL(url);
      }
    };
  };

  // src/ui/wall/frame-slot.ts
  var createFrameSlot = (options) => {
    const iframe = h("iframe", {
      class: "dc-frame",
      sandbox: ARTBOARD_SANDBOX,
      title: options.title,
      tabindex: "-1",
      referrerpolicy: "no-referrer",
      allow: ""
    });
    let state = "idle";
    let meta = null;
    let error = null;
    let doc = null;
    let current = null;
    let token = 0;
    const listeners = /* @__PURE__ */ new Set();
    const setState = (next) => {
      state = next;
      options.onState(next);
    };
    const drop = () => {
      current?.dispose();
      current = null;
      doc?.revoke();
      doc = null;
      iframe.removeAttribute("src");
    };
    const channel = {
      get identity() {
        return current?.identity ?? { artboardId: options.artboardId, nonce: "" };
      },
      send: (body) => current?.send(body),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => listeners.clear()
    };
    return {
      iframe,
      state: () => state,
      meta: () => meta,
      error: () => error,
      channel,
      load: async (screenId, version, file) => {
        token += 1;
        const mine = token;
        error = null;
        setState("loading");
        try {
          const rendered = await client.loadRender(options.slug, screenId, version);
          if (mine !== token) return;
          meta = rendered.meta;
          drop();
          doc = createFrameDocument(rendered.html, { artboardId: options.artboardId, file, mode: options.mode(), scroll: options.scroll() });
          const next = createFrameChannel({ artboardId: options.artboardId, nonce: doc.init.nonce, frame: iframe });
          next.subscribe((message) => {
            if (message.type === "ready" && state === "loading") setState("ready");
            for (const listener of [...listeners]) listener(message);
          });
          current = next;
          iframe.src = doc.url;
        } catch (failure) {
          if (mine !== token) return;
          meta = null;
          error = failure instanceof Error && failure.message !== "" ? failure.message : "This could not be loaded.";
          setState(isServiceError(failure, "no-html") || isServiceError(failure, "not-found") ? "missing" : "error");
        }
      },
      post: (message) => current?.send(message),
      unload: () => {
        token += 1;
        drop();
        meta = null;
        setState("idle");
      },
      dispose: () => {
        token += 1;
        drop();
        listeners.clear();
        iframe.remove();
      }
    };
  };

  // src/ui/wall/board-set.ts
  var toRect = (box) => ({ x: box.x, y: box.y, w: box.width, h: box.height });
  var createBoardSet = (ctx, deps) => {
    const { options, pageMode } = ctx;
    const { camera, pins, popovers } = deps;
    const boards = /* @__PURE__ */ new Map();
    let layout = { boards: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
    let syncQueued = false;
    let recent = null;
    const values = () => boards.values();
    const placeLabel = (board) => {
      if (pageMode) {
        board.label.hidden = true;
        return;
      }
      const current = camera.get();
      const { rect } = board.art;
      const x = current.x + rect.x * current.scale;
      const y = current.y + rect.y * current.scale;
      const width = rect.w * current.scale;
      const next = layout.boards.reduce((nearest, other) => other.rect.x > rect.x && (nearest === null || other.rect.x < nearest) ? other.rect.x : nearest, null);
      board.label.style.transform = `translate(${x}px, ${y - 26}px)`;
      board.label.style.width = `${Math.max(0, Math.min(labelWidth(rect, next, current.scale), Math.max(width, ctx.surfaceSize.w - x - 8)))}px`;
      board.label.hidden = width < 32 || board.art.cell.row > 0 && (ARTBOARD_LABEL_HEIGHT + WALL_GAP) * current.scale < 24;
    };
    const paintPlaceholder = (board) => {
      const state = board.main.state();
      const file = ctx.fileOf(board.screenId);
      board.placeholder.replaceChildren();
      board.placeholder.dataset.state = board.live ? state : "idle";
      const inner = h("div", { class: "dc-placeholder-inner" });
      if (!board.live || state === "idle") {
        if (!board.live) append(inner, icon2("layers", 20), h("p", { class: "dc-placeholder-title" }, "Paused"), h("p", { class: "dc-placeholder-sub" }, "Off screen. Pan here to load it."));
        else mountSpinner(inner, { label: "Loading\u2026" });
      } else if (state === "loading") {
        mountSpinner(inner, { label: `Loading ${board.art.screen?.title ?? "page"}\u2026` });
      } else if (state === "missing") {
        append(
          inner,
          icon2("layers", 20),
          h("p", { class: "dc-placeholder-title" }, `${file} isn\u2019t written yet`),
          h("p", { class: "dc-placeholder-sub" }, "It appears here the moment your agent saves it.")
        );
      } else if (state === "error") {
        const retry = btn({ label: "Try again", variant: "outline", size: "sm", onClick: () => void load(board) });
        append(inner, icon2("warning", 20), h("p", { class: "dc-placeholder-title" }, "This didn\u2019t load"), h("p", { class: "dc-placeholder-sub" }, board.main.error() ?? ""), retry.el);
      }
      board.placeholder.append(inner);
      board.root.dataset.state = board.live ? state : "idle";
    };
    const paintRecent = (board) => {
      if (recent !== null && recent.has(board.art.screen?.id ?? null)) board.root.dataset.recent = "true";
      else delete board.root.dataset.recent;
    };
    const paintLabel = (board) => {
      paintRecent(board);
      const { art } = board;
      const name = art.screen ? `${art.screen.title} \xB7 ${viewportLabel(art.viewport)}` : viewportLabel(art.viewport);
      const navigated = board.screenId !== (art.screen?.id ?? null);
      const shown = navigated ? ctx.screens().find((s) => s.id === board.screenId)?.title ?? board.screenId ?? "" : art.screen?.title ?? ctx.detail.design.title;
      const text = artboardLabel(shown, art.viewport);
      board.labelText.replaceChildren(h("span", { class: "dc-label-name" }, text.name), h("span", { class: "dc-label-sep", "aria-hidden": "true" }, "\xB7"), h("span", { class: "dc-label-dims" }, text.detail));
      board.labelText.title = text.full;
      board.labelStatus.replaceChildren();
      const state = board.main.state();
      if (state === "loading" && board.live) append(board.labelStatus, h("span", { class: "dc-status dc-status-spin", role: "status", "aria-label": "Loading" }));
      if (state === "missing") append(board.labelStatus, h("span", { class: "dc-status", "data-tone": "warning" }, "Not written yet"));
      if (state === "error") append(board.labelStatus, h("span", { class: "dc-status", "data-tone": "error" }, "Didn\u2019t load"));
      const meta = board.main.meta();
      const problems = meta ? [...meta.blocked, ...meta.missing] : [];
      if (problems.length > 0) {
        append(
          board.labelStatus,
          h("span", { class: "dc-status", "data-tone": "warning", title: `Blocked or missing:
${problems.join("\n")}`, tabindex: "0", role: "img", "aria-label": `${problems.length} references blocked or missing: ${problems.join(", ")}` }, `${problems.length} blocked`)
        );
      }
      if (meta && meta.external.length > 0) {
        append(board.labelStatus, h("span", { class: "dc-status", "data-tone": "warning", title: `Remote files are blocked inside designs:
${meta.external.join("\n")}`, tabindex: "0", role: "img", "aria-label": `${meta.external.length} remote files blocked` }, `${meta.external.length} remote`));
      }
      if (board.screenId !== (art.screen?.id ?? null)) {
        append(
          board.labelStatus,
          iconBtn({ icon: "reset", label: `Reset ${name} to its first screen`, size: "sm", onClick: () => reset(board) })
        );
      }
      if (ctx.version !== null) append(board.labelStatus, h("span", { class: "dc-status", "data-tone": "info" }, ctx.compare ? `v${ctx.version.slice(1)} | current` : ctx.version));
    };
    const paint = (board) => {
      paintPlaceholder(board);
      paintLabel(board);
    };
    const sizeBoard = (board) => {
      const { rect } = board.art;
      board.root.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
      board.root.style.width = `${rect.w}px`;
      board.root.style.height = `${rect.h}px`;
      for (const slot of [board.main, board.compare]) {
        if (!slot) continue;
        slot.iframe.style.width = `${rect.w}px`;
        slot.iframe.style.height = `${rect.h}px`;
      }
      placeLabel(board);
    };
    const makeBoard = (art) => {
      const labelText = h("span", { class: "dc-label-text" });
      const labelStatus = h("span", { class: "dc-label-status" });
      const label = h("div", { class: "dc-label" }, labelText, labelStatus);
      const placeholder = h("div", { class: "dc-placeholder" });
      const hoverTag = h("span", { class: "dc-hover-tag" });
      const hover2 = h("div", { class: "dc-hover", hidden: true }, hoverTag);
      const selected = h("div", { class: "dc-selected", hidden: true });
      const overlayLayer = h("div", { class: "dc-board-overlay" }, hover2, selected);
      const root = h("div", { class: "dc-board", "data-board": art.id });
      let self = null;
      const main = createFrameSlot({
        slug: options.slug,
        artboardId: art.id,
        title: art.viewport.id === PAGE_FILL_VIEWPORT_ID && pageMode ? `${ctx.detail.design.title}, full width` : `${art.screen?.title ?? ctx.detail.design.title} at ${viewportLabel(art.viewport)}`,
        mode: () => ctx.frameMode(),
        scroll: () => self?.scroll ?? { x: 0, y: 0 },
        onState: () => {
          if (self && !ctx.disposed) {
            paint(self);
            options.onStatus();
          }
        }
      });
      const tracker = trackPins(main.channel, ctx.commentsOf(art));
      const board = {
        art,
        root,
        placeholder,
        overlay: overlayLayer,
        hover: hover2,
        hoverTag,
        selected,
        label,
        labelText,
        labelStatus,
        main,
        compare: null,
        screenId: art.screen?.id ?? null,
        scroll: { x: 0, y: 0 },
        tracker,
        placements: [],
        pins: /* @__PURE__ */ new Map(),
        clusters: [],
        live: false
      };
      self = board;
      tracker.subscribe((placements, scroll) => {
        board.placements = placements;
        board.scroll = scroll;
        pins.paint(board);
        options.onStatus();
      });
      main.channel.subscribe((message) => {
        if (!ctx.disposed) deps.onFrameMessage(board, message);
      });
      root.append(board.main.iframe, placeholder, overlayLayer);
      ctx.world.append(root);
      ctx.labels.append(label);
      sizeBoard(board);
      return board;
    };
    const ensureCompare = (board) => {
      if (board.compare) return board.compare;
      const slot = createFrameSlot({
        slug: options.slug,
        artboardId: board.art.id,
        title: `${board.art.screen?.title ?? ctx.detail.design.title} (saved version)`,
        mode: () => "play",
        scroll: () => board.scroll,
        onState: () => paint(board)
      });
      slot.iframe.classList.add("dc-frame-compare");
      board.compare = slot;
      board.root.insertBefore(slot.iframe, board.placeholder);
      sizeBoard(board);
      return slot;
    };
    const dropCompare = (board) => {
      board.compare?.dispose();
      board.compare = null;
    };
    const disposeBoard = (board) => {
      board.tracker.dispose();
      board.main.dispose();
      board.compare?.dispose();
      board.root.remove();
      board.label.remove();
    };
    const pageLayout = () => {
      const geometry = camera.pageGeometry();
      const chosen = ctx.pageViewport();
      const viewport = chosen ?? { id: PAGE_FILL_VIEWPORT_ID, label: "Full width", width: geometry.frameW, height: geometry.frameH };
      const frame = { x: 0, y: 0, width: geometry.frameW, height: geometry.frameH };
      const cell = { id: artboardIdOf(null, viewport.id), screen: null, screenTitle: ctx.detail.design.title, viewport, row: 0, col: 0, frame, label: { x: 0, y: 0, width: frame.width, height: 0 } };
      return { boards: [{ id: cell.id, screen: null, viewport, rect: toRect(frame), cell }], bounds: toRect(frame) };
    };
    const rebuild = () => {
      const { design } = ctx.detail;
      if (pageMode) layout = pageLayout();
      else {
        const visible = design.viewports.filter((viewport) => !ctx.hidden.has(viewport.id));
        const rows = design.kind === "page" ? [{ id: null, title: design.title }] : design.screens.map((screen) => ({ id: screen.id, title: screen.title, ...screen.viewports ? { viewports: screen.viewports } : {} }));
        const wall = layoutWall(rows, visible);
        layout = {
          boards: wall.artboards.map((cell) => ({
            id: cell.id,
            screen: cell.screen === null ? null : design.screens.find((screen) => screen.id === cell.screen) ?? null,
            viewport: cell.viewport,
            rect: toRect(cell.frame),
            cell
          })),
          bounds: wall.bounds ? toRect(wall.bounds) : { x: 0, y: 0, w: 0, h: 0 }
        };
      }
      const keep = new Set(layout.boards.map((art) => art.id));
      for (const [id, board] of boards) {
        if (!keep.has(id)) {
          if (popovers.current()?.board === board) popovers.close();
          disposeBoard(board);
          boards.delete(id);
        }
      }
      for (const art of layout.boards) {
        const existing = boards.get(art.id);
        if (existing) {
          const resized = existing.art.rect.w !== art.rect.w || existing.art.rect.h !== art.rect.h;
          existing.art = art;
          sizeBoard(existing);
          if (resized && !pageMode) void load(existing);
        } else boards.set(art.id, makeBoard(art));
      }
      for (const board of boards.values()) paint(board);
    };
    async function load(board) {
      if (!board.live) return;
      const file = ctx.fileOf(board.screenId);
      board.tracker.setComments(board.screenId === (board.art.screen?.id ?? null) ? ctx.commentsOf(board.art) : []);
      paint(board);
      const tasks = [board.main.load(board.screenId, ctx.compare ? null : ctx.version, file)];
      if (ctx.compare && ctx.version !== null) tasks.push(ensureCompare(board).load(board.screenId, ctx.version, file));
      else dropCompare(board);
      board.root.dataset.compare = ctx.compare && ctx.version !== null ? "true" : "false";
      await Promise.all(tasks);
      paint(board);
    }
    const syncLive = () => {
      syncQueued = false;
      if (ctx.disposed || ctx.surfaceSize.w === 0) return;
      const live = new Set(liveBoards([...boards.values()].map((board) => ({ id: board.art.id, rect: board.art.rect })), camera.get(), ctx.surfaceSize, ctx.liveBudget, FRAME_UNLOAD_MARGIN).map((entry) => entry.id));
      for (const board of boards.values()) {
        const shouldLive = live.has(board.art.id);
        if (shouldLive && !board.live) {
          board.live = true;
          paint(board);
          if (board.main.state() === "idle") void load(board);
        } else if (!shouldLive && board.live) {
          board.live = false;
          board.main.unload();
          board.compare?.unload();
          board.placements = [];
          paint(board);
        }
      }
    };
    const reset = (board) => {
      board.screenId = board.art.screen?.id ?? null;
      board.scroll = { x: 0, y: 0 };
      void load(board);
    };
    return {
      values,
      at: (point) => boardAt(camera.get(), [...boards.values()].map((entry) => ({ rect: entry.art.rect, board: entry })), point)?.board ?? null,
      get: (id) => boards.get(id),
      first: () => boards.values().next().value,
      forComment: (comment) => layout.boards.map((art) => boards.get(art.id)).find((candidate) => candidate && candidate.art.screen?.id === (comment.screen ?? void 0) && candidate.art.viewport.id === comment.viewport) ?? [...boards.values()].find((candidate) => comment.screen === null && candidate.art.viewport.id === comment.viewport),
      bounds: () => layout.bounds,
      rebuild,
      load,
      reset,
      paint,
      paintLabel,
      placeLabels: () => {
        for (const board of boards.values()) placeLabel(board);
      },
      markRecent: (sources) => {
        recent = sources;
        for (const board of boards.values()) {
          const wasLit = board.root.dataset.recent === "true";
          paintRecent(board);
          if (wasLit && board.root.dataset.recent === "true") {
            delete board.root.dataset.recent;
            void board.root.offsetWidth;
            board.root.dataset.recent = "true";
          }
        }
      },
      recent: () => recent,
      queueSync: () => {
        if (syncQueued) return;
        syncQueued = true;
        requestAnimationFrame(syncLive);
      },
      dispose: () => {
        for (const board of boards.values()) disposeBoard(board);
        boards.clear();
      }
    };
  };

  // src/ui/wall/camera-controller.ts
  var SETTLE_MS = 400;
  var PAGE_RELAYOUT_MS = 100;
  var createCameraController = (ctx, hooks) => {
    const { options, pageMode } = ctx;
    let camera = options.initialCamera ?? { ...DEFAULT_CAMERA };
    let userMoved = options.initialCamera !== null;
    let settleTimer;
    const pageGutter = options.compact ? PAGE_GUTTER_COMPACT : PAGE_GUTTER;
    const coveredInsets = () => ({ right: options.coveredRight?.() ?? 0, bottom: 0 });
    const pageGeometry = () => {
      const insets = coveredInsets();
      return pageCamera({ stageW: ctx.surfaceSize.w - insets.right, stageH: ctx.surfaceSize.h - insets.bottom, frameW: ctx.pageViewport()?.width ?? null, gutter: pageGutter });
    };
    const apply = () => {
      const { surface } = ctx;
      ctx.world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
      surface.style.setProperty("--dc-inv", String(1 / camera.scale));
      surface.style.setProperty("--dc-scale", String(camera.scale));
      surface.style.setProperty("--dc-grid", `${Math.max(8, 24 * camera.scale)}px`);
      surface.style.setProperty("--dc-grid-x", `${camera.x}px`);
      surface.style.setProperty("--dc-grid-y", `${camera.y}px`);
      surface.dataset.dense = camera.scale < 0.3 ? "true" : "false";
      hooks().placeLabels();
      hooks().scaleChanged(camera.scale);
      options.onScale(camera.scale);
      clearTimeout(settleTimer);
      if (!pageMode) settleTimer = setTimeout(() => options.onCameraSettled(camera), SETTLE_MS);
      hooks().queueSync();
    };
    const set = (next, user) => {
      camera = next;
      if (user) {
        userMoved = true;
        hooks().closePopover();
        hooks().clearHover();
      }
      apply();
    };
    const fitView = () => {
      if (pageMode) return pageGeometry().camera;
      const bounds = hooks().bounds();
      const insets = coveredInsets();
      const area = fitArea({ width: ctx.surfaceSize.w, height: ctx.surfaceSize.h - insets.bottom }, insets.right);
      const padding = options.compact ? 16 : area.padding;
      return bounds.w > 0 && bounds.h > 0 ? fitBox({ x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h }, area, { padding }) : { ...DEFAULT_CAMERA };
    };
    const layoutPage = () => {
      hooks().rebuildLayout();
      camera = fitView();
      apply();
    };
    const centre = () => ({ x: ctx.surfaceSize.w / 2, y: ctx.surfaceSize.h / 2 });
    let pageSized = false;
    const layoutPageSoon = debounce(() => {
      if (!ctx.disposed) layoutPage();
    }, PAGE_RELAYOUT_MS);
    const observer = new ResizeObserver(() => {
      const rect = ctx.surfaceRect();
      ctx.surfaceSize = { w: Math.round(rect.width), h: Math.round(rect.height) };
      if (ctx.surfaceSize.w === 0 || ctx.surfaceSize.h === 0) return;
      if (pageMode) {
        if (pageSized) layoutPageSoon();
        else {
          pageSized = true;
          layoutPage();
        }
        return;
      }
      if (!userMoved) camera = fitView();
      apply();
    });
    observer.observe(ctx.surface);
    ctx.scope.add(() => observer.disconnect());
    return {
      get: () => camera,
      set,
      apply,
      fitView,
      quietFit: () => {
        if (userMoved) return false;
        camera = fitView();
        return true;
      },
      fit: () => {
        userMoved = false;
        hooks().closePopover();
        camera = fitView();
        apply();
      },
      layoutPage,
      zoomAtCentre: (factor) => set(zoomAt(camera, camera.scale * factor, centre()), true),
      zoomReset: () => set(zoomAt(camera, 1, centre()), true),
      focusBoard: (board) => set(focusArtboard(board.art.cell, ctx.size(), { padding: options.compact ? 12 : 64 }), true),
      coveredInsets,
      pageGeometry,
      dispose: () => clearTimeout(settleTimer)
    };
  };

  // src/ui/model/wall-input.ts
  var ZOOM_KEY_FACTOR = 1.25;
  var shortcutAction = (input) => {
    const { key, shift } = input;
    if (key === "Escape") return { type: "escape" };
    if (input.pageMode) return null;
    if (key === "+" || key === "=") return { type: "zoom", factor: ZOOM_KEY_FACTOR };
    if (key === "-" || key === "_") return { type: "zoom", factor: 1 / ZOOM_KEY_FACTOR };
    if (key === "0" && shift) return { type: "zoom-reset" };
    if (key === "1" && shift) return { type: "fit" };
    if (key === " ") return { type: "space-down" };
    return null;
  };
  var wallKeyAction = (input) => {
    const { key, code, shift } = input;
    if (input.pageMode) return shortcutAction(input);
    const step = nudgeStep(shift);
    if (code === "Digit0" && shift) return { type: "zoom-reset" };
    if (code === "Digit1" && shift) return { type: "fit" };
    if (key === "ArrowLeft") return { type: "pan", dx: step, dy: 0 };
    if (key === "ArrowRight") return { type: "pan", dx: -step, dy: 0 };
    if (key === "ArrowUp") return { type: "pan", dx: 0, dy: step };
    if (key === "ArrowDown") return { type: "pan", dx: 0, dy: -step };
    if (key.toLowerCase() === "h") return { type: "toggle-pan-tool" };
    if (key === " " || key === "+" || key === "=" || key === "-" || key === "Escape") return shortcutAction(input);
    return null;
  };
  var pageKeyAction = (input) => {
    const step = nudgeStep(input.shift);
    const screenful = Math.max(40, Math.round(input.frameHeight * 0.9));
    switch (input.key) {
      case "Escape":
        return { type: "escape" };
      case "ArrowUp":
        return { type: "scroll-by", dx: 0, dy: -step };
      case "ArrowDown":
        return { type: "scroll-by", dx: 0, dy: step };
      case "ArrowLeft":
        return { type: "scroll-by", dx: -step, dy: 0 };
      case "ArrowRight":
        return { type: "scroll-by", dx: step, dy: 0 };
      case "PageUp":
        return { type: "scroll-by", dx: 0, dy: -screenful };
      case "PageDown":
        return { type: "scroll-by", dx: 0, dy: screenful };
      case "Home":
        return { type: "scroll-to", x: 0, y: 0 };
      case "End":
        return { type: "scroll-by", dx: 0, dy: 1e7 };
      default:
        return null;
    }
  };
  var wheelRoute = (input) => {
    if (input.pageMode) return !input.ctrlOrMeta && input.overReadyBoard ? "scroll-frame" : "none";
    if (input.ctrlOrMeta) return "zoom";
    if (input.mode === "edit" && !input.readOnly && input.overReadyBoard && !input.spaceDown && !input.panTool) return "scroll-frame";
    return "pan";
  };
  var frameWheelRoute = (input) => {
    const scrolls = input.mode === "edit" && !input.readOnly;
    if (input.pageMode) return !input.ctrl && scrolls ? "scroll-frame" : "none";
    if (input.ctrl) return "zoom";
    return scrolls ? "scroll-frame" : "pan";
  };
  var pointerDownAction = (input) => {
    if (input.pageMode) {
      if (input.button !== 0) return "ignore";
      return input.onBoard && input.mode === "edit" && !input.readOnly ? "press" : "dismiss";
    }
    const wantsPan = input.button === 1 || input.spaceDown || input.panTool || !input.onBoard || input.mode === "play" || input.readOnly;
    if (input.button !== 0 && input.button !== 1) return "ignore";
    return wantsPan ? "pan" : "press";
  };
  var DRAG_THRESHOLD_PX = 4;
  var isDrag = (from, to) => Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD_PX;
  var hitMatches = (pending, board, x, y) => pending !== null && pending.board === board && pending.frame.x === x && pending.frame.y === y;
  var frameModeOf = (mode, readOnly) => readOnly ? "play" : mode;

  // src/ui/wall/frame-messages.ts
  var createFrameMessageHandler = (ctx, deps) => {
    const { camera, hit, popovers } = deps;
    const { options } = ctx;
    return (board, message) => {
      switch (message.type) {
        case "ready":
          board.main.post({ type: "set-mode", mode: ctx.frameMode() });
          return;
        case "scroll":
          if (popovers.current()?.board === board) popovers.close();
          return;
        case "hit":
          hit.onHit(board, message);
          return;
        case "navigate": {
          const target = ctx.screens().find((candidate) => candidate.file === message.href);
          if (!target) {
            options.onNotice("That link doesn\u2019t lead to a screen of this design.");
            return;
          }
          board.screenId = target.id;
          board.scroll = { x: 0, y: 0 };
          void deps.load(board);
          return;
        }
        case "open-external":
          options.onExternal(message.url);
          return;
        case "wheel": {
          const route = frameWheelRoute({ pageMode: ctx.pageMode, ctrl: message.ctrl, mode: ctx.mode, readOnly: ctx.readOnly() });
          if (route === "scroll-frame") board.main.post({ type: "scroll-by", dx: message.deltaX, dy: message.deltaY });
          else if (route === "zoom") camera.set(wheelZoom(camera.get(), message.deltaY, frameToScreen(camera.get(), board.art.rect, { x: message.x, y: message.y })), true);
          else if (route === "pan") camera.set(panBy(camera.get(), -message.deltaX, -message.deltaY), true);
          return;
        }
        case "key":
          if (message.key !== " ") deps.shortcut(message.key, message.shift);
          return;
        default:
          return;
      }
    };
  };

  // src/ui/wall/comment-ui.ts
  var isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
  var submitKey = () => isMac() ? "\u2318\u21B5" : "Ctrl+\u21B5";
  var validateBody = (body) => {
    if (body.trim() === "") return "Write what should change, then add the comment.";
    if (body.length > COMMENT_BODY_MAX) return `Keep a comment under ${COMMENT_BODY_MAX} characters.`;
    return null;
  };
  var textarea = (label, value, placeholder) => {
    const area = h("textarea", { class: "oc-sdk oc-sdk-input dc-textarea", rows: 3, "aria-label": label, placeholder });
    area.value = value;
    return area;
  };
  var createComposer = (options) => {
    const area = textarea("Comment", "", "What should change here?");
    const failure = h("p", { class: "dc-form-error", role: "alert", hidden: true });
    const cancel = btn({ label: "Cancel", variant: "ghost", size: "sm", onClick: () => options.onCancel() });
    const submit = btn({
      label: "Add comment",
      variant: "default",
      size: "sm",
      onClick: () => void send()
    });
    const send = async () => {
      const problem = validateBody(area.value);
      failure.hidden = problem === null;
      if (problem !== null) {
        failure.textContent = problem;
        area.focus();
        return;
      }
      submit.set({ loading: true });
      cancel.set({ disabled: true });
      area.disabled = true;
      try {
        await options.onSubmit(area.value.trim());
      } catch (error) {
        failure.textContent = errorText2(error);
        failure.hidden = false;
        submit.set({ loading: false });
        cancel.set({ disabled: false });
        area.disabled = false;
        area.focus();
      }
    };
    area.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void send();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        options.onCancel();
      }
    });
    const el2 = h(
      "div",
      { class: "dc-pop dc-composer", role: "dialog", "aria-label": "New comment" },
      h("div", { class: "dc-pop-head" }, h("span", { class: "dc-pop-title" }, "Comment on"), h("code", { class: "dc-chip-code" }, `<${options.tag}>`)),
      options.snippet ? h("p", { class: "dc-pop-snippet" }, `\u201C${options.snippet}\u201D`) : null,
      area,
      failure,
      h("div", { class: "dc-pop-foot" }, h("span", { class: "dc-pop-hint" }, `${submitKey()} to add`), h("span", { class: "dc-pop-actions" }, cancel.el, submit.el))
    );
    return { el: el2, focus: () => area.focus(), hasDraft: () => area.value.trim() !== "" };
  };
  var ANCHOR_NOTE = {
    exact: null,
    unknown: null,
    moved: "The element moved; the pin follows it by its text.",
    detached: "This element is not in the current file. The pin stays where it was."
  };
  var createThread = (options) => {
    const { comment } = options;
    const area = textarea("Comment text", comment.body, "");
    area.disabled = options.readOnly;
    const failure = h("p", { class: "dc-form-error", role: "alert", hidden: true });
    const badgeHost = h("span");
    let status = comment.status;
    const paintBadge = () => {
      badgeHost.replaceChildren();
      mountBadge(badgeHost, { label: statusLabel(status), tone: status === "open" ? "primary" : status === "sent" ? "info" : "neutral" });
    };
    paintBadge();
    const guard = async (button2, action) => {
      button2.set({ loading: true });
      failure.hidden = true;
      try {
        await action();
      } catch (error) {
        failure.textContent = errorText2(error);
        failure.hidden = false;
        button2.set({ loading: false });
      }
    };
    const save = btn({
      label: "Save",
      variant: "default",
      size: "sm",
      disabled: true,
      onClick: () => {
        const problem = validateBody(area.value);
        if (problem !== null) {
          failure.textContent = problem;
          failure.hidden = false;
          return;
        }
        void guard(save, () => options.onSave(area.value.trim()));
      }
    });
    area.addEventListener("input", () => save.set({ disabled: area.value.trim() === comment.body.trim() }));
    area.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        options.onClose();
      }
    });
    const sendOne = options.onSend;
    let sendThis = null;
    if (sendOne) {
      const button2 = btn({
        label: "Send this",
        variant: "outline",
        size: "sm",
        icon: "send",
        title: "Send only this comment to the chat",
        onClick: () => {
          const problem = validateBody(area.value);
          if (problem !== null) {
            failure.textContent = problem;
            failure.hidden = false;
            return;
          }
          void guard(button2, () => sendOne(area.value.trim()));
        }
      });
      button2.el.hidden = status !== "open";
      sendThis = button2;
    }
    const toggle = btn({
      label: status === "resolved" ? "Reopen" : "Resolve",
      variant: "outline",
      size: "sm",
      icon: status === "resolved" ? "restore" : "check",
      onClick: () => void guard(toggle, () => options.onStatus(status === "resolved" ? "open" : "resolved"))
    });
    let armed = false;
    let armTimer;
    const remove2 = btn({
      label: "Delete",
      variant: "ghost",
      size: "sm",
      icon: "trash",
      onClick: () => {
        if (!armed) {
          armed = true;
          remove2.set({ label: "Delete comment?" });
          remove2.el.dataset.variant = "destructive";
          armTimer = setTimeout(() => {
            armed = false;
            remove2.set({ label: "Delete" });
            remove2.el.dataset.variant = "ghost";
          }, 4e3);
          return;
        }
        clearTimeout(armTimer);
        void guard(remove2, () => options.onDelete());
      }
    });
    const close = iconBtn({ icon: "close", label: "Close comment", size: "sm", onClick: () => options.onClose() });
    const note = ANCHOR_NOTE[options.anchorState];
    const el2 = h(
      "div",
      { class: "dc-pop dc-thread", role: "dialog", "aria-label": `Comment ${options.number}` },
      h("div", { class: "dc-pop-head" }, h("span", { class: "dc-pin-badge", "aria-hidden": "true" }, String(options.number)), badgeHost, h("span", { class: "dc-pop-where" }, options.where), close),
      h("p", { class: "dc-pop-snippet" }, h("code", { class: "dc-chip-code" }, comment.anchor.selector.split(" > ").slice(-1)[0] ?? comment.anchor.selector)),
      note ? h("p", { class: "dc-pop-note" }, note) : null,
      area,
      failure,
      options.readOnly ? null : h("div", { class: "dc-pop-foot" }, remove2.el, h("span", { class: "dc-pop-actions" }, toggle.el, sendThis?.el, save.el))
    );
    const setStatus = (next) => {
      status = next;
      paintBadge();
      toggle.set({ label: status === "resolved" ? "Reopen" : "Resolve", icon: status === "resolved" ? "restore" : "check" });
      if (sendThis) sendThis.el.hidden = status !== "open";
    };
    return { el: el2, focus: () => area.focus(), setStatus };
  };

  // src/ui/wall/popover-layer.ts
  var pinState = (board, comment) => {
    const placement = board.placements.find((entry) => entry.commentId === comment.id);
    if (!placement) return { point: pinFramePoint(comment.anchor.rect, comment.anchor.point, board.scroll), anchorState: "unknown" };
    return { point: docToFrame(placement.point, board.scroll), anchorState: placement.state === "pending" ? "unknown" : placement.state };
  };
  var rectToBox = (board, el2, rect) => {
    el2.style.left = `${rect.x - board.scroll.x}px`;
    el2.style.top = `${rect.y - board.scroll.y}px`;
    el2.style.width = `${rect.w}px`;
    el2.style.height = `${rect.h}px`;
  };
  var createPopoverLayer = (ctx, camera, deps) => {
    const { options } = ctx;
    let popover = null;
    const close = () => {
      if (!popover) return;
      const current = popover;
      popover = null;
      current.card.el.remove();
      current.board.selected.hidden = true;
      for (const pin of current.board.pins.values()) pin.removeAttribute("aria-expanded");
      document.querySelector(".dc-temp-pin")?.remove();
      if (current.commentId === null) deps.emitSelection({ type: "cleared" });
    };
    const placeCard = (card, anchorScreen, below) => {
      ctx.overlay.append(card);
      const { w, h: surfaceHeight } = ctx.surfaceSize;
      const width = Math.min(card.offsetWidth, w - 16);
      const height = card.offsetHeight;
      let left = anchorScreen.x;
      let top = anchorScreen.y + below + 10;
      if (left + width > w - 8) left = w - width - 8;
      if (top + height > surfaceHeight - 8) top = Math.max(8, anchorScreen.y - height - 10);
      card.style.left = `${Math.max(8, left)}px`;
      card.style.top = `${Math.max(8, top)}px`;
    };
    const pageWhere = (comment) => comment.viewport === PAGE_FILL_VIEWPORT_ID ? "Made at full width" : `Made at ${ctx.detail.design.viewports.find((viewport) => viewport.id === comment.viewport)?.label ?? comment.viewport} size`;
    const open = (board, card, commentId) => {
      popover = { card, board, commentId };
    };
    const openThread = (board, commentId) => {
      const comment = ctx.comments().find((candidate) => candidate.id === commentId);
      if (!comment) return;
      close();
      const number = ctx.numbers().get(commentId) ?? 0;
      const { point, anchorState } = pinState(board, comment);
      const sendComment = options.onSendComment;
      const card = createThread({
        comment,
        number,
        where: ctx.pageMode ? pageWhere(comment) : `${board.art.screen?.title ?? "Page"} \xB7 ${board.art.viewport.label}`,
        anchorState,
        readOnly: ctx.readOnly(),
        onSave: async (body) => {
          await options.updateComment(commentId, { body });
          close();
        },
        // Seam S6: the card shows "Send this" only when the view passed a sender.
        onSend: sendComment ? async (body) => {
          await sendComment(commentId, body);
          close();
        } : void 0,
        onStatus: async (status) => {
          await options.updateComment(commentId, { status });
          close();
        },
        onDelete: async () => {
          await options.deleteComment(commentId);
          close();
        },
        onClose: () => close()
      });
      open(board, card, commentId);
      const screenPoint = frameToScreen(camera.get(), board.art.rect, point);
      placeCard(card.el, { x: screenPoint.x + 14, y: screenPoint.y - 10 }, 0);
      board.pins.get(commentId)?.setAttribute("aria-expanded", "true");
      card.focus();
    };
    const openComposer = (board, element, framePoint) => {
      close();
      const anchor = anchorFromHit(element, framePoint, board.scroll);
      const { point } = anchor;
      rectToBox(board, board.selected, element.rect);
      board.selected.hidden = false;
      board.hover.hidden = true;
      const temp = h("span", { class: "dc-pin dc-temp-pin", "aria-hidden": "true" }, "+");
      const pinAt = pinFramePoint(element.rect, point, board.scroll);
      temp.style.left = `${pinAt.x}px`;
      temp.style.top = `${pinAt.y}px`;
      board.overlay.append(temp);
      const key = `${board.art.id}:${anchor.selector}`;
      const target = { screen: board.art.screen?.id ?? null, viewport: board.art.viewport.id };
      const where = ctx.pageMode ? viewportOf(ctx.detail.design.viewports, target.viewport) : `${board.art.screen?.title ?? "Page"} \xB7 ${board.art.viewport.label}`;
      const card = createComposer({
        tag: element.tag,
        snippet: element.text.length > 80 ? `${element.text.slice(0, 77)}\u2026` : element.text,
        onCancel: () => close(),
        onSubmit: async (body) => {
          await options.createComment({ ...target, anchor, body });
          deps.emitSelection({ type: "commented", key });
          close();
        }
      });
      open(board, card, null);
      deps.emitSelection({ type: "selected", selection: { key, element: { ...target, anchor }, tag: element.tag, where } });
      const base = frameToScreen(camera.get(), board.art.rect, { x: element.rect.x - board.scroll.x, y: element.rect.y - board.scroll.y });
      placeCard(card.el, base, element.rect.h * camera.get().scale);
      card.focus();
    };
    const clearSelection = () => {
      if (popover?.commentId === null && popover.card.hasDraft?.() !== true) close();
    };
    const refresh = () => {
      if (popover?.commentId == null) return;
      const id = popover.commentId;
      const comment = ctx.comments().find((candidate) => candidate.id === id);
      if (comment) popover.card.setStatus?.(comment.status);
    };
    return { openThread, openComposer, close, current: () => popover, placeCard, clearSelection, refresh };
  };

  // src/ui/wall/hit-controller.ts
  var HOVER_MIN_INTERVAL = 40;
  var createHitController = (ctx, deps) => {
    const { camera, popovers, boards } = deps;
    let pointer = null;
    let hoverTimer = 0;
    let lastHitAt = 0;
    let pendingHit = null;
    let hoveredBoard = null;
    const requestHit = (board, frame, purpose) => {
      if (board.main.state() !== "ready") return;
      pendingHit = { board, frame, purpose };
      board.main.post({ type: "hit-test", x: frame.x, y: frame.y });
    };
    const onHit = (board, message) => {
      const request = pendingHit;
      if (!request || !hitMatches(request, board, message.x, message.y)) return;
      if (request.purpose === "click") {
        pendingHit = null;
        if (message.element) popovers.openComposer(board, message.element, request.frame);
        else ctx.options.onNotice("There is no element there to comment on.");
        return;
      }
      if (hoveredBoard !== board || popovers.current()) return;
      if (!message.element) {
        board.hover.hidden = true;
        return;
      }
      rectToBox(board, board.hover, message.element.rect);
      board.hoverTag.textContent = message.element.tag;
      board.hover.hidden = false;
    };
    const clearHover = () => {
      for (const board of boards().values()) board.hover.hidden = true;
      hoveredBoard = null;
    };
    const scheduleHover = () => {
      if (hoverTimer) return;
      hoverTimer = requestAnimationFrame(() => {
        hoverTimer = 0;
        if (!pointer || ctx.mode !== "edit" || ctx.readOnly() || popovers.current() || deps.isPanning()) return;
        const now = performance.now();
        if (now - lastHitAt < HOVER_MIN_INTERVAL) return scheduleHover();
        lastHitAt = now;
        const board = boards().at(pointer);
        if (hoveredBoard && hoveredBoard !== board) hoveredBoard.hover.hidden = true;
        hoveredBoard = board;
        if (board) requestHit(board, screenToFrame(camera.get(), board.art.rect, pointer), "hover");
      });
    };
    return {
      requestHit,
      onHit,
      scheduleHover,
      clearHover,
      setPointer: (point) => {
        pointer = point;
      },
      dispose: () => cancelAnimationFrame(hoverTimer)
    };
  };

  // src/ui/wall/input-controller.ts
  var createInputController = (ctx, deps) => {
    const { camera, boards, popovers, hit } = deps;
    const { surface, scope, pageMode } = ctx;
    let panning = null;
    let spaceDown = false;
    let panTool = false;
    let downAt = null;
    const setTool = () => {
      surface.dataset.tool = spaceDown || panTool ? "pan" : "none";
    };
    const run = (action) => {
      switch (action.type) {
        case "escape":
          if (!popovers.current()) return false;
          popovers.close();
          return true;
        case "zoom":
          camera.zoomAtCentre(action.factor);
          return true;
        case "zoom-reset":
          camera.zoomReset();
          return true;
        case "fit":
          camera.fit();
          return true;
        case "pan":
          camera.set(panBy(camera.get(), action.dx, action.dy), true);
          return true;
        case "toggle-pan-tool":
          panTool = !panTool;
          setTool();
          return true;
        case "space-down":
          spaceDown = true;
          return true;
      }
    };
    const shortcut = (key, shift) => {
      const action = shortcutAction({ key, shift, pageMode });
      if (!action) return false;
      const used = run(action);
      if (used && action.type !== "escape") setTool();
      return used;
    };
    const readyPageBoard = () => {
      if (!pageMode) return null;
      const board = boards.first();
      return board && board.main.state() === "ready" ? board : null;
    };
    const pageKey = (event) => {
      const board = readyPageBoard();
      const action = pageKeyAction({ key: event.key, shift: event.shiftKey, frameHeight: board?.art.rect.h ?? 0 });
      if (!action) return false;
      if (action.type === "escape") return shortcut("Escape", false);
      if (!board) return false;
      board.main.post(action.type === "scroll-by" ? { type: "scroll-by", dx: action.dx, dy: action.dy } : { type: "scroll-to", x: action.x, y: action.y });
      return true;
    };
    scope.listen(surface, "keydown", (event) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (pageMode) {
        if (pageKey(event)) event.preventDefault();
        return;
      }
      const action = wallKeyAction({ key: event.key, code: event.code, shift: event.shiftKey, pageMode });
      if (!action) return;
      const handled = run(action);
      if (handled && (action.type === "space-down" || action.type === "zoom")) setTool();
      if (handled) event.preventDefault();
    });
    scope.listen(surface, "keyup", (event) => {
      if (event.key === " ") {
        spaceDown = false;
        surface.dataset.tool = panTool ? "pan" : "none";
      }
    });
    scope.listen(
      surface,
      "wheel",
      (event) => {
        const at = ctx.local(event);
        const board = boards.at(at);
        const route = wheelRoute({
          pageMode,
          ctrlOrMeta: event.ctrlKey || event.metaKey,
          mode: ctx.mode,
          readOnly: ctx.readOnly(),
          overReadyBoard: board !== null && board.main.state() === "ready",
          spaceDown,
          panTool
        });
        event.preventDefault();
        if (route === "zoom") camera.set(wheelZoom(camera.get(), event.deltaY, at), true);
        else if (route === "scroll-frame") board?.main.post({ type: "scroll-by", dx: event.deltaX, dy: event.deltaY });
        else if (route === "pan") camera.set(panBy(camera.get(), -event.deltaX, -event.deltaY), true);
      },
      { passive: false }
    );
    scope.listen(surface, "pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest(".dc-pop, .dc-label, .dc-pin")) return;
      surface.focus({ preventScroll: true });
      const at = ctx.local(event);
      const board = boards.at(at);
      const action = pointerDownAction({ pageMode, button: event.button, spaceDown, panTool, onBoard: board !== null, mode: ctx.mode, readOnly: ctx.readOnly() });
      if (action === "ignore") return;
      if (popovers.current()) popovers.close();
      if (action === "pan") {
        panning = { id: event.pointerId, last: at };
        surface.setPointerCapture(event.pointerId);
        surface.dataset.panning = "true";
        event.preventDefault();
      } else downAt = action === "press" ? { point: at, board } : null;
    });
    scope.listen(surface, "pointermove", (event) => {
      const at = ctx.local(event);
      hit.setPointer(at);
      if (panning && panning.id === event.pointerId) {
        camera.set(panBy(camera.get(), at.x - panning.last.x, at.y - panning.last.y), true);
        panning.last = at;
        return;
      }
      if (downAt && isDrag(downAt.point, at)) {
        if (pageMode) {
          downAt = null;
        } else {
          panning = { id: event.pointerId, last: downAt.point };
          downAt = null;
          surface.setPointerCapture(event.pointerId);
          surface.dataset.panning = "true";
          hit.clearHover();
          return;
        }
      }
      hit.scheduleHover();
    });
    const endPointer = (event) => {
      if (panning && panning.id === event.pointerId) {
        panning = null;
        delete surface.dataset.panning;
        return;
      }
      const press = downAt;
      downAt = null;
      if (press && press.board && event.type === "pointerup" && ctx.mode === "edit" && !ctx.readOnly()) {
        hit.requestHit(press.board, screenToFrame(camera.get(), press.board.art.rect, press.point), "click");
      }
    };
    scope.listen(surface, "pointerup", endPointer);
    scope.listen(surface, "pointercancel", endPointer);
    scope.listen(surface, "pointerleave", () => {
      hit.setPointer(null);
      hit.clearHover();
    });
    scope.listen(ctx.labels, "dblclick", (event) => {
      const target = event.target instanceof Element ? event.target.closest(".dc-label") : null;
      if (!target) return;
      for (const board of boards.values()) {
        if (board.label === target) camera.focusBoard(board);
      }
    });
    return { shortcut, isPanning: () => panning !== null };
  };

  // src/ui/wall/pin-layer.ts
  var placePin = (el2, at) => {
    el2.style.left = `${at.x}px`;
    el2.style.top = `${at.y}px`;
  };
  var createPinLayer = (ctx, camera, popovers, boards) => {
    let pinScale = camera.get().scale;
    const openCluster = (board, spots, anchor) => {
      const current = camera.get();
      const target = separatingScale(spots, current.scale, ctx.pinSize());
      camera.set(zoomAt(current, target, frameToScreen(current, board.art.rect, anchor)), true);
    };
    const paint = (board) => {
      const scale = camera.get().scale;
      const show = !ctx.readOnly() && (ctx.mode === "edit" || ctx.showPins);
      board.overlay.dataset.pins = show ? "shown" : "hidden";
      const nums = ctx.numbers();
      const mine = ctx.commentsOf(board.art).sort((a, b) => (nums.get(a.id) ?? 0) - (nums.get(b.id) ?? 0));
      const keep = new Set(mine.map((comment) => comment.id));
      for (const [id, pin] of board.pins) {
        if (!keep.has(id)) {
          pin.remove();
          board.pins.delete(id);
        }
      }
      for (const cluster of board.clusters) cluster.remove();
      board.clusters = [];
      const frameSize = { width: board.art.rect.w, height: board.art.rect.h };
      const spots = [];
      for (const comment of mine) {
        let pin = board.pins.get(comment.id);
        if (!pin) {
          const created = h("button", { type: "button", class: "dc-pin" });
          created.addEventListener("pointerdown", (event) => event.stopPropagation());
          created.addEventListener("click", (event) => {
            event.stopPropagation();
            popovers.openThread(board, comment.id);
          });
          board.overlay.append(created);
          board.pins.set(comment.id, created);
          pin = created;
        }
        const number = nums.get(comment.id) ?? 0;
        const { point, anchorState } = pinState(board, comment);
        pin.textContent = pinGlyph(comment, number);
        pin.dataset.status = comment.status;
        pin.dataset.detached = anchorState === "detached" ? "true" : "false";
        pin.setAttribute("aria-label", `${pinAriaLabel(comment, number)}${anchorState === "detached" ? ", element not found" : ""}`);
        const inView = isInFrameView({ x: point.x + board.scroll.x, y: point.y + board.scroll.y }, board.scroll, frameSize);
        pin.hidden = !inView;
        pin.tabIndex = show ? 0 : -1;
        placePin(pin, point);
        if (inView) spots.push({ id: comment.id, x: point.x, y: point.y });
      }
      for (const group of clusterPins(spots, scale, ctx.pinSize())) {
        if (group.ids.length === 1) continue;
        const members = spots.filter((spot) => group.ids.includes(spot.id));
        if (scale >= PIN_FAN_SCALE || ctx.pageMode) {
          for (const spot of fanOut(group, scale, ctx.pinSize())) {
            const pin = board.pins.get(spot.id);
            if (pin) placePin(pin, spot);
          }
          continue;
        }
        for (const id of group.ids) {
          const pin = board.pins.get(id);
          if (pin) pin.hidden = true;
        }
        const labels = group.ids.map((id) => nums.get(id) ?? 0).join(", ");
        const statuses = new Set(group.ids.map((id) => ctx.comments().find((comment) => comment.id === id)?.status));
        const cluster = h(
          "button",
          {
            type: "button",
            class: "dc-pin dc-pin-cluster",
            "data-status": statuses.has("open") ? "open" : statuses.has("sent") ? "sent" : "resolved",
            "aria-label": `${group.ids.length} comments here (${labels}). Zoom in to see them.`,
            title: `Comments ${labels}. Click to zoom in`
          },
          String(group.ids.length)
        );
        cluster.tabIndex = show ? 0 : -1;
        cluster.addEventListener("pointerdown", (event) => event.stopPropagation());
        cluster.addEventListener("click", (event) => {
          event.stopPropagation();
          openCluster(board, members, group);
        });
        placePin(cluster, group);
        board.overlay.append(cluster);
        board.clusters.push(cluster);
      }
    };
    return {
      paint,
      paintAll: () => {
        for (const board of boards().values()) {
          board.tracker.setComments(board.screenId === (board.art.screen?.id ?? null) ? ctx.commentsOf(board.art) : []);
          paint(board);
        }
      },
      scaleChanged: (scale) => {
        if (scale === pinScale) return;
        pinScale = scale;
        for (const board of boards().values()) paint(board);
      }
    };
  };

  // src/ui/wall/wall-context.ts
  var createWallContext = (options, initialDetail) => {
    const pageMode = options.presentation === "page";
    const mode = "edit";
    const world = h("div", { class: "dc-wall-world" });
    const labels = h("div", { class: "dc-wall-labels" });
    const overlay = h("div", { class: "dc-wall-overlay" });
    const surface = h(
      "div",
      {
        class: "dc-wall",
        tabindex: "0",
        role: "application",
        "aria-roledescription": pageMode ? "page preview" : "canvas wall",
        "aria-label": pageMode ? "Page preview. Arrow keys, Page Up and Page Down scroll the page." : "Design wall. Arrow keys pan, plus and minus zoom, Shift+1 fits everything. Hold Space and drag to pan.",
        "data-mode": mode,
        "data-presentation": options.presentation
      },
      world,
      labels,
      overlay
    );
    const ctx = {
      options,
      pageMode,
      liveBudget: options.compact ? RAIL_LIVE_FRAMES_MAX : PAGE_LIVE_FRAMES_MAX,
      scope: createScope(),
      surface,
      world,
      labels,
      overlay,
      detail: initialDetail,
      mode,
      hidden: /* @__PURE__ */ new Set(),
      pageView: options.initialPageView ?? PAGE_FILL_VIEWPORT_ID,
      version: null,
      compare: false,
      showPins: true,
      disposed: false,
      surfaceSize: { w: 0, h: 0 },
      readOnly: () => ctx.version !== null,
      frameMode: () => frameModeOf(ctx.mode, ctx.readOnly()),
      comments: () => ctx.detail.design.comments,
      numbers: () => pinNumbers(ctx.comments()),
      // A page shows every comment in every view: the bridge re-finds each element in the current layout.
      commentsOf: (art) => pageMode ? pageComments(ctx.comments()) : commentsForArtboard(ctx.comments(), art.screen?.id ?? null, art.viewport.id),
      screens: () => ctx.detail.design.screens,
      fileOf: (screenId) => screenId === null ? ctx.detail.design.entry ?? "index.html" : ctx.screens().find((s) => s.id === screenId)?.file ?? `screens/${screenId}.html`,
      pageViewport: () => ctx.pageView === PAGE_FILL_VIEWPORT_ID ? null : ctx.detail.design.viewports.find((viewport) => viewport.id === ctx.pageView) ?? null,
      size: () => ({ width: ctx.surfaceSize.w, height: ctx.surfaceSize.h }),
      surfaceRect: () => surface.getBoundingClientRect(),
      local: (event) => {
        const rect = ctx.surfaceRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      },
      pinSize: () => options.compact ? 18 : 24
    };
    return ctx;
  };
  var late = (name) => {
    let bound = null;
    const get = () => {
      if (!bound) throw new Error(`The wall used ${name} before it was wired up.`);
      return bound.value;
    };
    return Object.assign(get, {
      bind: (value) => {
        bound = { value };
      }
    });
  };

  // src/ui/wall/wall.ts
  var createWall = (options, initialDetail) => {
    const ctx = createWallContext(options, initialDetail);
    const { pageMode, surface } = ctx;
    const hooks = late("the camera hooks");
    const boardLookup = late("the board set");
    const input = late("the input controller");
    const frameMessage = late("the frame message handler");
    const camera = createCameraController(ctx, hooks);
    const selection2 = createListeners();
    const popovers = createPopoverLayer(ctx, camera, { emitSelection: selection2.emit });
    const pins = createPinLayer(ctx, camera, popovers, boardLookup);
    const hit = createHitController(ctx, { camera, popovers, boards: boardLookup, isPanning: () => input().isPanning() });
    const boards = createBoardSet(ctx, { camera, pins, popovers, onFrameMessage: (board, message) => frameMessage()(board, message) });
    boardLookup.bind(boards);
    hooks.bind({
      closePopover: popovers.close,
      clearHover: hit.clearHover,
      bounds: boards.bounds,
      rebuildLayout: boards.rebuild,
      placeLabels: boards.placeLabels,
      scaleChanged: pins.scaleChanged,
      queueSync: boards.queueSync
    });
    const inputController = createInputController(ctx, { camera, boards, popovers, hit });
    input.bind(inputController);
    frameMessage.bind(createFrameMessageHandler(ctx, { camera, hit, popovers, load: boards.load, shortcut: inputController.shortcut }));
    boards.rebuild();
    camera.apply();
    return {
      el: surface,
      setDetail: (next) => {
        const structureChanged = JSON.stringify(next.design.screens) !== JSON.stringify(ctx.detail.design.screens) || JSON.stringify(next.design.viewports) !== JSON.stringify(ctx.detail.design.viewports) || next.design.kind !== ctx.detail.design.kind;
        ctx.detail = next;
        if (structureChanged) {
          boards.rebuild();
          if (ctx.surfaceSize.w > 0) camera.quietFit();
          camera.apply();
        }
        pins.paintAll();
        for (const board of boards.values()) boards.paintLabel(board);
        popovers.refresh();
      },
      setMode: (next) => {
        if (next === ctx.mode) return;
        ctx.mode = next;
        surface.dataset.mode = ctx.mode;
        popovers.close();
        hit.clearHover();
        for (const board of boards.values()) {
          if (ctx.mode === "edit" && board.screenId !== (board.art.screen?.id ?? null)) boards.reset(board);
          board.main.post({ type: "set-mode", mode: ctx.frameMode() });
          pins.paint(board);
        }
      },
      setHiddenViewports: (ids) => {
        if (pageMode) return;
        ctx.hidden = new Set(ids);
        boards.rebuild();
        camera.quietFit();
        camera.apply();
      },
      setVersion: (next, nextCompare) => {
        ctx.version = next;
        ctx.compare = nextCompare && next !== null;
        surface.dataset.readonly = ctx.readOnly() ? "true" : "false";
        popovers.close();
        for (const board of boards.values()) {
          board.screenId = board.art.screen?.id ?? null;
          board.scroll = { x: 0, y: 0 };
          if (board.live) void boards.load(board);
          pins.paint(board);
        }
      },
      setPageView: (id) => {
        if (!pageMode || id === ctx.pageView) return;
        ctx.pageView = id;
        popovers.close();
        hit.clearHover();
        if (ctx.surfaceSize.w > 0) camera.layoutPage();
      },
      externalRefs: () => [...new Set([...boards.values()].flatMap((board) => board.main.meta()?.external ?? []))],
      detachedIds: () => {
        const ids = /* @__PURE__ */ new Set();
        for (const board of boards.values()) if (board.live) {
          for (const placement of board.placements) if (placement.state === "detached") ids.add(placement.commentId);
        }
        return ids;
      },
      anchorStates: () => anchorStatesOf([...boards.values()].filter((board) => board.live).flatMap((board) => board.placements)),
      setShowPins: (show) => {
        ctx.showPins = show;
        for (const board of boards.values()) pins.paint(board);
      },
      reload: (sources) => {
        for (const board of boards.values()) {
          const state = board.main.state();
          const affected = sources === void 0 || sources.has(board.art.screen?.id ?? null) || state === "missing" || state === "error";
          if (affected && board.live) void boards.load(board);
        }
      },
      zoomStep: (factor) => {
        if (!pageMode) camera.zoomAtCentre(factor);
      },
      zoomReset: () => {
        if (!pageMode) camera.zoomReset();
      },
      fit: () => {
        if (!pageMode) camera.fit();
        else if (ctx.surfaceSize.w > 0) camera.layoutPage();
      },
      refit: () => {
        if (ctx.surfaceSize.w === 0) return;
        if (pageMode) camera.layoutPage();
        else if (camera.quietFit()) camera.apply();
      },
      getCamera: () => camera.get(),
      focusComment: (id) => {
        const comment = ctx.comments().find((candidate) => candidate.id === id);
        if (!comment) return;
        if (pageMode) {
          const page = boards.first();
          if (!page) return;
          const placement = page.placements.find((entry) => entry.commentId === id);
          if (placement && page.main.state() === "ready") page.main.post({ type: "scroll-to", x: page.scroll.x, y: Math.max(0, placement.point.y - page.art.rect.h / 3) });
          setTimeout(() => {
            if (!ctx.disposed && boards.get(page.art.id) === page) popovers.openThread(page, id);
          }, 200);
          return;
        }
        const board = boards.forComment(comment);
        if (!board) return;
        camera.focusBoard(board);
        setTimeout(() => {
          if (!ctx.disposed) popovers.openThread(board, id);
        }, 120);
      },
      focus: () => surface.focus({ preventScroll: true }),
      onSelection: selection2.add,
      clearSelection: () => popovers.clearSelection(),
      markRecent: (sources) => boards.markRecent(sources),
      dispose: () => {
        ctx.disposed = true;
        popovers.close();
        camera.dispose();
        hit.dispose();
        ctx.scope.dispose();
        boards.dispose();
        surface.remove();
      }
    };
  };

  // src/ui/wall/design-view.ts
  var FULL_SCREEN_HINT = "Full screen: sidebar \u2192 Extension pages \u2192 Design Chamber";
  var EXPORT_NOTICE_MS = 15e3;
  var hiddenRemote = /* @__PURE__ */ new Map();
  var isRecord = (value) => typeof value === "object" && value !== null;
  var readPrefs = (raw) => {
    if (!isRecord(raw)) return { hidden: [], camera: null, pageView: null };
    const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((entry) => typeof entry === "string") : [];
    const camera = isRecord(raw.camera) && typeof raw.camera.x === "number" && typeof raw.camera.y === "number" && typeof raw.camera.scale === "number" ? { x: raw.camera.x, y: raw.camera.y, scale: raw.camera.scale } : null;
    return { hidden, camera, pageView: raw.pageView };
  };
  var mountDesignView = (options) => {
    const { slug } = options;
    const compact = options.surface === "panel";
    const scope = createScope();
    const el2 = h("div", { class: "dc-design", "data-surface": options.surface });
    let disposed = false;
    let built = null;
    let building = false;
    let wantComment = options.startIn === "comment";
    const stateOf2 = () => {
      const open = store.getState().open;
      return open?.slug === slug ? open : null;
    };
    const backButton = (label) => btn({ label, variant: "ghost", icon: "back", onClick: options.onBack }).el;
    const showMessage = (...children) => {
      el2.replaceChildren(h("div", { class: "dc-design-state" }, h("div", { class: "dc-state-bar" }, backButton(compact ? "Designs" : "Library")), h("div", { class: "dc-state-body" }, ...children)));
    };
    const build = async (first) => {
      building = true;
      const prefs = readPrefs(await host.storage.get(`view:${slug}`));
      building = false;
      if (disposed) return;
      const bscope = createScope();
      let data = first;
      const design = () => data.design;
      const isPage = first.design.kind === "page";
      let mode = isPage && !wantComment ? "play" : "edit";
      let hidden = new Set(prefs.hidden.filter((id) => first.design.viewports.some((viewport) => viewport.id === id)));
      if (hidden.size >= first.design.viewports.length) hidden = /* @__PURE__ */ new Set();
      let pageView = resolvePageView(prefs.pageView, first.design.viewports);
      let showPins = false;
      let viewing = null;
      let drawer = null;
      const detailListeners = createListeners();
      const viewingListeners = createListeners();
      const drawerListeners = createListeners();
      let htmlChars = null;
      const savePrefs = debounce((camera) => {
        void host.storage.set(`view:${slug}`, { hidden: [...hidden], camera, pageView });
      }, 500);
      const zoomLabel = btn({ label: "100%", variant: "ghost", size: "xs", title: "Reset zoom to 100%", onClick: () => wall.zoomReset() });
      zoomLabel.el.classList.add("dc-zoom-label");
      const stage = h("div", { class: "dc-stage" });
      const slots = {
        statusSlot: h("div", { class: "dc-status-slot" }),
        overlay: h("div", { class: "dc-stage-overlay" }),
        bottomDock: h("div", { class: "dc-bottom-dock" }),
        compactActions: h("div", { class: "dc-compact-actions" })
      };
      let dockEl = null;
      const wall = createWall(
        {
          slug,
          compact,
          presentation: isPage ? "page" : "wall",
          initialPageView: pageView,
          coveredRight: () => dockEl && !dockEl.hidden && getComputedStyle(dockEl).position === "absolute" ? dockEl.offsetWidth : 0,
          initialCamera: isPage ? null : prefs.camera,
          onScale: (next) => zoomLabel.set({ label: zoomPercent(next) }),
          onCameraSettled: (camera) => savePrefs(camera),
          createComment: async (body) => {
            await store.addComment(slug, body);
          },
          updateComment: async (id, patch) => {
            await store.updateComment(slug, id, patch);
          },
          deleteComment: async (id) => {
            await store.deleteComment(slug, id);
          },
          // Seam S6: "Send this" on a thread card (checks the comment is still open, saves an edited text, sends it alone).
          onSendComment: (id, body) => sendOneComment(slug, id, body, wall.anchorStates()),
          onExternal: (url) => confirmDialog(options.actions.host, {
            title: "Open this link in your browser?",
            body: h("p", null, h("code", { class: "dc-path" }, url)),
            confirmLabel: "Open in browser",
            onConfirm: async () => {
              await host.openUrl(url);
            }
          }),
          onNotice: (message) => toast("info", message),
          onStatus: () => {
            paintNotices();
            if (drawer?.kind === "comments") drawer.handle.refresh();
          }
        },
        first
      );
      stage.append(wall.el, slots.overlay);
      wall.setMode(mode);
      wall.setShowPins(showPins);
      if (!isPage) wall.setHiddenViewports([...hidden]);
      const zoomOut = iconBtn({ icon: "minus", label: "Zoom out", size: "sm", onClick: () => wall.zoomStep(1 / 1.25) });
      const zoomIn = iconBtn({ icon: "plus", label: "Zoom in", size: "sm", onClick: () => wall.zoomStep(1.25) });
      const fit = btn({ label: "Fit", variant: "ghost", size: "xs", icon: "fit", title: "Fit everything on screen (Shift+1)", onClick: () => wall.fit() });
      const zoomGroup = h("div", { class: "dc-group", role: "group", "aria-label": "Zoom" }, zoomOut, zoomLabel.el, zoomIn, fit.el);
      const modeHost = h("div", { class: "dc-mode" });
      const modeTabs = mountTabs(modeHost, {
        items: [
          { id: "edit", label: "Edit" },
          { id: "play", label: "Play" }
        ],
        activeId: mode,
        trackBackground: true,
        onChange: (id) => setMode(id === "play" ? "play" : "edit")
      });
      modeHost.title = "Edit: click an element to comment. Play: use the design like a prototype.";
      bscope.add(() => modeTabs.dispose());
      const pinsToggle = btn({ label: "Pins", variant: "ghost", size: "xs", icon: "comment", pressed: showPins, title: "Show comment pins while playing", onClick: () => {
        showPins = !showPins;
        pinsToggle.set({ pressed: showPins });
        wall.setShowPins(showPins);
      } });
      pinsToggle.el.hidden = mode !== "play" || isPage;
      const commentMode = btn({ label: "Comment", variant: "outline", size: "sm", icon: "cursor", pressed: false, title: "Click an element to pin a comment to it", onClick: () => setMode(mode === "edit" ? "play" : "edit") });
      const setMode = (next) => {
        if (viewing) return;
        mode = next;
        wall.setMode(next);
        modeTabs.update({ activeId: next });
        commentMode.set({ pressed: next === "edit" });
        pinsToggle.el.hidden = next !== "play" || isPage;
      };
      const chipHost = h("div", { class: "dc-chips", role: "group", "aria-label": "Device sizes shown" });
      const paintChips = () => {
        chipHost.replaceChildren();
        for (const viewport of design().viewports) {
          const on = !hidden.has(viewport.id);
          const chip = btn({
            label: viewport.label,
            variant: "outline",
            size: "xs",
            pressed: on,
            title: `${viewportLabel(viewport)}. ${on ? "Click to hide" : "Click to show"}`,
            onClick: () => {
              const next = new Set(hidden);
              if (on) {
                if (design().viewports.length - next.size <= 1) {
                  toast("info", "Keep at least one device size visible.");
                  return;
                }
                next.add(viewport.id);
              } else next.delete(viewport.id);
              hidden = next;
              wall.setHiddenViewports([...hidden]);
              savePrefs(wall.getCamera());
              paintChips();
            }
          });
          chip.el.dataset.chip = on ? "on" : "off";
          chipHost.append(chip.el, h("span", { class: "dc-chip-size" }, viewportSize(viewport)));
        }
      };
      const viewportHost = h("div", { class: "dc-viewport-select", title: "Full width fills the viewer. A device size shows the page at that width." });
      const showPageView = (id) => {
        pageView = id;
        wall.setPageView(id);
        viewportSelect.update({ value: id });
      };
      const viewportSelect = mountSelect(viewportHost, {
        label: "View",
        value: pageView,
        options: pageViewOptions(first.design.viewports),
        onChange: (id) => {
          showPageView(id);
          savePrefs(null);
        }
      });
      bscope.add(() => viewportSelect.dispose());
      const paintViewportOptions = () => {
        viewportSelect.update({ options: pageViewOptions(design().viewports), value: pageView });
      };
      const commentsButton = btn({ label: "Comments", variant: "outline", size: "sm", icon: "comment", onClick: () => toggleDrawer("comments") });
      const versionsButton = btn({ label: "Versions", variant: "outline", size: "sm", icon: "history", onClick: () => toggleDrawer("versions") });
      const chatButton = btn({ label: "Continue in chat", variant: "default", size: "sm", icon: "chat", onClick: () => void continueInChat(slug) });
      const exportMenu = btn({ label: "Export", variant: "outline", size: "sm", icon: "download", chevron: true, onClick: () => void 0 });
      const copyMenu = btn({ label: "Copy", variant: "outline", size: "sm", icon: "copy", chevron: true, onClick: () => void 0 });
      const moreButton = iconBtn({ icon: "more", label: "More actions", onClick: () => void 0 });
      const doExport = async (format, screen) => {
        const done = await exportDesign(slug, format, screen);
        if (!done) return;
        const { path } = done;
        notices.setTransient("export", banner({ tone: "success", title: "Export saved", body: path, action: { label: "Show in folder", onClick: () => void reveal(path) } }), EXPORT_NOTICE_MS);
      };
      const pickScreenThenExport = (anchor) => {
        const screens = design().screens;
        if (screens.length <= 1) {
          void doExport("html", screens[0]?.id);
          return;
        }
        openMenu(anchor, screens.map((screen) => ({ id: screen.id, label: screen.title })), (id) => void doExport("html", id));
      };
      const ref = () => ({ slug, title: design().title, kind: design().kind, sessionId: design().sessionId });
      const rename2 = () => renameDialog(options.actions.host, ref());
      const moreEntries = () => viewerMenuEntries({ compact, isPage, copyHtmlTooLarge: htmlChars !== null && htmlChars > HOST_CLIPBOARD_MAX });
      const onMore = (id) => {
        switch (id) {
          case "chat":
            void continueInChat(slug);
            return;
          case "zip":
            void doExport("zip");
            return;
          case "html":
            if (isPage) void doExport("html");
            else pickScreenThenExport(moreButton);
            return;
          case "copy-html":
            void copyHtml(slug);
            return;
          case "path":
            void copyPath(slug);
            return;
          case "reveal":
            void revealDesign(slug);
            return;
          case "rename":
            rename2();
            return;
          case "delete":
            confirmDelete(options.actions, ref());
            return;
        }
      };
      attachMenu(moreButton, moreEntries, onMore);
      attachMenu(
        exportMenu.el,
        () => [
          { id: "zip", label: "Download ZIP", hint: "HTML + assets" },
          { id: "html", label: "Download single-file HTML", hint: "assets inlined" }
        ],
        (id) => void doExport(id === "zip" ? "zip" : "html")
      );
      attachMenu(
        copyMenu.el,
        () => {
          const tooBig = htmlChars !== null && htmlChars > HOST_CLIPBOARD_MAX;
          return [
            { id: "html", label: "Copy HTML", disabled: tooBig, hint: tooBig ? "too large to copy" : void 0 },
            { id: "path", label: "Copy path" }
          ];
        },
        (id) => void (id === "html" ? copyHtml(slug) : copyPath(slug))
      );
      const titleInput = h("input", { class: "dc-title-input", type: "text", "aria-label": "Design name", spellcheck: "false", maxlength: "120" });
      titleInput.value = first.design.title;
      const commitTitle = async () => {
        const next = titleInput.value.trim();
        if (next === design().title) return;
        try {
          await renameDesign(slug, next);
        } catch (error) {
          toast("error", `Couldn\u2019t rename. ${errorText2(error)}`);
          titleInput.value = design().title;
        }
      };
      titleInput.addEventListener("blur", () => void commitTitle());
      titleInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") titleInput.blur();
        else if (event.key === "Escape") {
          titleInput.value = design().title;
          titleInput.blur();
        }
      });
      const titleText = h("h1", { class: "dc-title-text", title: first.design.title }, first.design.title);
      const back = btn({ label: compact ? "Designs" : "Library", variant: "ghost", size: "sm", icon: "back", onClick: options.onBack });
      let toolbar;
      if (compact) {
        toolbar = h(
          "header",
          { class: "dc-toolbar dc-toolbar-compact" },
          h("div", { class: "dc-toolbar-row" }, iconBtn({ icon: "back", label: "Back to designs", onClick: options.onBack }), titleText, slots.compactActions, moreButton),
          // A page never pans or zooms, so its second row has no zoom group.
          isPage ? h("div", { class: "dc-toolbar-row dc-toolbar-tools" }, viewportHost, commentMode.el) : h("div", { class: "dc-toolbar-row dc-toolbar-tools" }, modeHost, h("span", { class: "dc-spacer" }), zoomGroup)
        );
      } else if (isPage) {
        toolbar = h(
          "header",
          { class: "dc-toolbar" },
          h("div", { class: "dc-toolbar-group" }, back.el, titleInput),
          h("div", { class: "dc-toolbar-group" }, viewportHost, commentMode.el),
          slots.statusSlot,
          h("div", { class: "dc-toolbar-group" }, commentsButton.el, versionsButton.el, exportMenu.el, copyMenu.el, chatButton.el, moreButton)
        );
      } else {
        toolbar = h(
          "header",
          { class: "dc-toolbar" },
          h("div", { class: "dc-toolbar-group" }, back.el, titleInput),
          h("div", { class: "dc-toolbar-group" }, modeHost, pinsToggle.el, chipHost, zoomGroup),
          slots.statusSlot,
          h("div", { class: "dc-toolbar-group" }, commentsButton.el, versionsButton.el, chatButton.el, moreButton)
        );
      }
      const notices = createNotices();
      let asking = false;
      let askButton = null;
      const setAsking = (busy) => {
        asking = busy;
        askButton?.set({ loading: busy });
      };
      const askOffline = async () => {
        if (asking) return;
        setAsking(true);
        try {
          const said = askRequestToast(await askSelfContained(slug));
          if (said !== null) toast("success", said);
        } catch (error) {
          toast("error", `Couldn\u2019t ask the agent. ${errorText2(error)}`);
        } finally {
          setAsking(false);
        }
      };
      const remoteBanner = (urls) => {
        const notice = remoteNotice(urls, isPage ? "page" : "canvas");
        askButton = btn({ label: "Ask the agent to fix it", variant: "outline", size: "xs", loading: asking, onClick: () => void askOffline() });
        const hide = btn({ label: "Hide", variant: "ghost", size: "xs", title: "Hide until another file is blocked", onClick: () => hideRemote(urls) });
        const list = h(
          "ul",
          { class: "dc-remote-list" },
          ...notice.urls.map((url) => h("li", null, h("code", { class: "dc-path", title: url }, shortUrl(url)))),
          notice.more > 0 ? h("li", { class: "dc-remote-more" }, `+ ${notice.more} more`) : null
        );
        const wrap = h("div", { class: "dc-banner dc-remote", "data-actions": "stack" });
        wrap.append(...bannerWithActions("warning", notice.title, ["They\u2019re blocked here because designs run offline:", list], [askButton.el, hide.el]));
        return wrap;
      };
      const hideRemote = (urls) => {
        hiddenRemote.set(slug, [...urls]);
        paintNotices();
        wall.focus();
      };
      const paintCommentsNote = (blocked) => {
        if (drawer?.kind !== "comments") return;
        const foot = drawer.sheet.foot;
        const note = foot.querySelector(".dc-foot-note");
        if (!blocked) note?.remove();
        else if (!note) foot.append(h("p", { class: "dc-foot-note" }, "The blocked files are listed in the request too."));
      };
      let noticesKey = "";
      const paintNotices = () => {
        const remote = wall.externalRefs();
        paintCommentsNote(remote.length > 0);
        const showRemote = remote.length > 0 && !viewing && !remoteBannerHidden(remote, hiddenRemote.get(slug) ?? null);
        const key = JSON.stringify([viewing, showRemote ? remote : [], restoreFlow.busyId()]);
        if (key === noticesKey) return;
        noticesKey = key;
        askButton = null;
        notices.setStatic([...viewing ? [versionsRow(viewing)] : [], ...showRemote ? [remoteBanner(remote)] : []]);
      };
      const versionsRow = (current) => {
        const number = Number(current.id.slice(1));
        const compareBtn = btn({ label: current.compare ? `View v${number} only` : "Compare with current", variant: "outline", size: "xs", icon: "compare", onClick: () => viewVersion(current.id, !current.compare) });
        const restoring = restoreFlow.busyId();
        const restoreBtn = btn({ label: "Restore", variant: "outline", size: "xs", loading: restoring === current.id, disabled: restoring !== null && restoring !== current.id, onClick: () => void restoreVersion({ id: current.id, n: number }) });
        restoreBtn.el.dataset.restore = current.id;
        const backBtn = btn({ label: "Back to current", variant: "default", size: "xs", onClick: () => leaveVersion() });
        const listBtn = compact ? btn({ label: "Versions", variant: "ghost", size: "xs", onClick: () => toggleDrawer("versions") }) : null;
        return h("div", { class: "dc-viewing", role: "status" }, icon_(), h("span", { class: "dc-viewing-text" }, viewingBanner(number, current.compare)), h("span", { class: "dc-viewing-actions" }, compareBtn.el, restoreBtn.el, listBtn?.el ?? null, backBtn.el));
      };
      const icon_ = () => h("span", { class: "dc-viewing-dot", "aria-hidden": "true" });
      const restoreFlow = createRestoreFlow({
        slug,
        notices,
        onRestored: () => {
          if (viewing) leaveVersion();
          if (compact && drawer?.kind === "versions") closeDrawer();
        },
        onBusy: () => {
          (drawer?.kind === "versions" ? drawer.handle : null)?.refresh();
          paintNotices();
        },
        focusWall: () => wall.focus(),
        // A failed restore repainted the button that had focus. In the rail the open Versions sheet is modal,
        // so focus goes back to that sheet's button, never to the wall behind it.
        onFailed: (version) => {
          if (drawer?.kind === "versions") drawer.handle.focusRestore(version.id);
          else el2.querySelector(`.dc-viewing [data-restore="${CSS.escape(version.id)}"]`)?.focus();
        }
      });
      const restoreVersion = restoreFlow.restore;
      const viewVersion = (id, compare) => {
        viewing = { id, compare };
        wall.setVersion(id, compare);
        modeTabs.update({ activeId: "play" });
        modeHost.dataset.disabled = "true";
        commentMode.el.disabled = true;
        paintNotices();
        (drawer?.kind === "versions" ? drawer.handle : null)?.refresh();
        viewingListeners.emit();
      };
      const leaveVersion = () => {
        viewing = null;
        wall.setVersion(null, false);
        modeTabs.update({ activeId: mode });
        delete modeHost.dataset.disabled;
        commentMode.el.disabled = false;
        paintNotices();
        (drawer?.kind === "versions" ? drawer.handle : null)?.refresh();
        viewingListeners.emit();
      };
      const dock = h("aside", { class: "dc-dock", hidden: true });
      dockEl = dock;
      const closeDrawer = () => {
        const current = drawer;
        drawer = null;
        current?.handle.dispose();
        current?.sheet.close();
        commentsButton.set({ pressed: false });
        versionsButton.set({ pressed: false });
        dock.hidden = true;
        wall.refit();
        drawerListeners.emit();
      };
      const toggleDrawer = (kind) => {
        if (drawer?.kind === kind) {
          closeDrawer();
          return;
        }
        if (drawer) {
          const previous = drawer;
          drawer = null;
          previous.handle.dispose();
          previous.sheet.close();
        }
        const title = kind === "comments" ? "Comments" : "Versions";
        const sheet = openSheet(compact ? options.actions.host : dock, {
          title,
          variant: compact ? "full" : "dock",
          onClose: () => {
            if (drawer?.sheet === sheet) {
              drawer.handle.dispose();
              drawer = null;
              commentsButton.set({ pressed: false });
              versionsButton.set({ pressed: false });
              dock.hidden = true;
              wall.refit();
              drawerListeners.emit();
            }
          }
        });
        let handle;
        if (kind === "comments") {
          handle = mountComments({
            slug,
            detached: () => wall.detachedIds(),
            anchorStates: () => wall.anchorStates(),
            onLocate: (id) => {
              if (compact) closeDrawer();
              if (viewing) leaveVersion();
              if (isPage && mode !== "edit") setMode("edit");
              wall.focusComment(id);
            }
          });
          sheet.body.append(handle.el);
          void store.refreshOpenDesign();
        } else {
          handle = mountVersions({
            slug,
            viewing: () => viewing,
            onView: (id) => {
              viewVersion(id, false);
              if (compact) closeDrawer();
            },
            onCompare: (id) => {
              viewVersion(id, true);
              if (compact) closeDrawer();
            },
            onBackToCurrent: () => leaveVersion(),
            restoring: restoreFlow.busyId,
            onRestore: restoreVersion
          });
          sheet.body.append(handle.el);
          void store.loadVersions(slug);
        }
        drawer = { kind, sheet, handle };
        paintCommentsNote(wall.externalRefs().length > 0);
        dock.hidden = false;
        wall.refit();
        commentsButton.set({ pressed: kind === "comments" });
        versionsButton.set({ pressed: kind === "versions" });
        drawerListeners.emit();
      };
      const openCount = () => design().comments.filter((comment) => comment.status === "open").length;
      const refreshHtmlSize = () => {
        if (!isPage) return;
        void store.loadSource(slug).then(
          (source) => void (htmlChars = source.text.length),
          () => void (htmlChars = null)
        );
      };
      const refreshHtmlSizeSoon = debounce(refreshHtmlSize, 600);
      const apply = (next) => {
        data = next;
        wall.setDetail(next);
        if (document.activeElement !== titleInput) titleInput.value = next.design.title;
        titleText.textContent = next.design.title;
        titleText.title = next.design.title;
        const count = openCount();
        commentsButton.set({ label: count > 0 ? `Comments \xB7 ${count}` : "Comments" });
        paintChips();
        paintViewportOptions();
        paintNotices();
        if (isPage && resolvePageView(pageView, next.design.viewports) !== pageView) showPageView(PAGE_FILL_VIEWPORT_ID);
        detailListeners.emit();
      };
      let revs = store.getState().renderRevs;
      bscope.add(
        store.subscribe((state) => {
          if (state.renderRevs === revs) return;
          const previous = revs;
          revs = state.renderRevs;
          const sources = isPage ? [null] : design().screens.map((screen) => screen.id);
          const changed = new Set(sources.filter((source) => revs[renderSourceKey(slug, source)] !== previous[renderSourceKey(slug, source)]));
          if (changed.size === 0) return;
          wall.reload(changed);
          refreshHtmlSizeSoon();
        })
      );
      const main = h("div", { class: "dc-design-main" }, h("div", { class: "dc-wall-col" }, stage, slots.bottomDock), dock);
      replace(el2, toolbar, notices.el, main, compact ? h("footer", { class: "dc-hint" }, FULL_SCREEN_HINT) : null);
      apply(first);
      refreshHtmlSize();
      if (isPage) {
        commentMode.set({ pressed: mode === "edit" });
        paintViewportOptions();
      }
      wall.fit();
      queueMicrotask(() => wall.focus());
      const viewContext = {
        slug,
        surface: options.surface,
        isPage,
        detail: () => data,
        onDetail: detailListeners.add,
        viewing: () => viewing,
        onViewing: viewingListeners.add,
        wall,
        slots,
        drawers: { toggle: toggleDrawer, active: () => drawer?.kind ?? null, onChange: drawerListeners.add },
        notices,
        actions: options.actions,
        scope: bscope
      };
      const mountFeature = (name, mount5) => {
        try {
          const unmount = mount5(viewContext);
          return () => {
            try {
              unmount();
            } catch (error) {
              console.error(`design chamber: ${name} unmount failed`, error);
            }
          };
        } catch (error) {
          console.error(`design chamber: ${name} mount failed`, error);
          return () => void 0;
        }
      };
      const unmounts = [
        mountFeature("build strip", mount2),
        mountFeature("ask bar", mount),
        mountFeature("findability", mount4),
        mountFeature("checks badge", mount3)
      ];
      built = {
        apply,
        startComment: () => setMode("edit"),
        dispose: () => {
          for (const unmount of [...unmounts].reverse()) unmount();
          restoreFlow.dispose();
          closeDrawer();
          notices.dispose();
          bscope.dispose();
          wall.dispose();
        }
      };
    };
    let lastApplied = null;
    const update = () => {
      if (disposed) return;
      const state = stateOf2();
      if (built) {
        if (state?.data) {
          if (state.data !== lastApplied) {
            lastApplied = state.data;
            built.apply(state.data);
          }
        } else if (!state || state.status === "error" && isServiceError(state.error, "not-found")) {
          built.dispose();
          built = null;
          lastApplied = null;
          showMessage(h("p", { class: "dc-empty-title" }, "This design is gone"), h("p", { class: "dc-empty-body" }, "Its folder was moved or deleted. Pick another design from the list."));
        }
        return;
      }
      if (building) return;
      if (!state || state.status === "idle" || state.status === "loading" && !state.data) {
        showMessage(loadingRow("Opening design\u2026"));
        return;
      }
      if (state.data) {
        void build(state.data);
        return;
      }
      showMessage(banner({ tone: "error", title: "This design didn\u2019t open", body: state.error?.message ?? "The local service didn\u2019t answer.", action: { label: "Try again", onClick: () => void store.openDesign(slug) } }));
    };
    scope.add(store.subscribe(update));
    void store.openDesign(slug);
    update();
    return {
      el: el2,
      startComment: () => {
        if (built) built.startComment();
        else wantComment = true;
      },
      dispose: () => {
        disposed = true;
        scope.dispose();
        built?.dispose();
        if (store.getState().open?.slug === slug) store.closeDesign();
        el2.remove();
      }
    };
  };

  // src/ui/model/loose-model.ts
  var LOOSE_DISMISSED_KEY = "loose-dismissed";
  var LOOSE_BANNER_NAMES = 3;
  var looseKey = (files) => files.map((file) => file.name).sort();
  var isDismissed = (files, dismissed) => {
    if (dismissed === null) return false;
    const current = looseKey(files);
    return current.length === dismissed.length && current.every((name, index) => name === dismissed[index]);
  };
  var parseDismissed = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value].sort() : null;
  var looseBanner = (loose, dismissed) => {
    if (!loose || loose.total <= 0) return null;
    if (isDismissed(loose.files, dismissed)) return null;
    const first = loose.files[0];
    if (loose.total === 1 && first) {
      return { mode: "single", title: "1 HTML file here isn\u2019t a design yet.", name: first.name, body: "Import it as a page? The original moves to .trash in your designs folder." };
    }
    const names = loose.files.slice(0, LOOSE_BANNER_NAMES).map((file) => file.name);
    const more = loose.total - names.length;
    const listed = names.join(", ");
    const body = more > 0 ? listed === "" ? `${loose.total} files` : `${listed} + ${more} more` : listed;
    return { mode: "many", title: `${loose.total} HTML files here aren\u2019t designs yet.`, body };
  };
  var importOutcome = (result) => result.originalMovedTo === null ? { kind: "info", message: "Imported. The original couldn\u2019t be moved to .trash, so it\u2019s still in your designs folder." } : { kind: "success", message: `Imported \u201C${result.title}\u201D as a page.` };
  var unlistedNote = (loose) => {
    const hidden = loose.total - loose.files.length;
    if (hidden <= 0) return null;
    return hidden === 1 ? "1 more file isn\u2019t listed here. Import these first and it shows up." : `${hidden} more files aren\u2019t listed here. Import these first and they show up.`;
  };

  // src/ui/components/loose-banner.ts
  var importLoose = (name) => client.call("POST /loose/import", { body: { name } });
  var mountLooseBanner = (options) => {
    const el2 = h("div", { class: "dc-banner", "data-actions": "stack", hidden: true });
    let loose = null;
    let dismissed;
    let busy = false;
    let imported = null;
    let disposed = false;
    const openImported = (slug) => {
      imported = null;
      paint();
      options.onOpen(slug);
    };
    const paint = () => {
      if (disposed) return;
      const hadFocus = document.activeElement instanceof Node && el2.contains(document.activeElement);
      render();
      options.onPaint?.();
      if (hadFocus && !el2.hidden) el2.querySelector("button:not([disabled])")?.focus();
    };
    const render = () => {
      if (imported) {
        const done = imported;
        const open = btn({ label: "Open", variant: "outline", size: "xs", onClick: () => openImported(done.slug) });
        const close = btn({ label: "Dismiss", variant: "ghost", size: "xs", onClick: () => {
          imported = null;
          paint();
        } });
        el2.replaceChildren(...bannerWithActions(done.tone, done.message, [], [open.el, close.el]));
        el2.hidden = false;
        return;
      }
      const model = dismissed === void 0 ? null : looseBanner(loose, dismissed);
      if (!model) {
        el2.replaceChildren();
        el2.hidden = true;
        return;
      }
      const notNow = btn({ label: "Not now", variant: "ghost", size: "xs", onClick: () => dismiss() });
      if (model.mode === "single") {
        const name = model.name;
        const action = btn({ label: "Import as page", variant: "outline", size: "xs", loading: busy, onClick: () => void importOne(name) });
        el2.replaceChildren(...bannerWithActions("info", model.title, [h("code", { class: "dc-chip-code" }, name), ` ${model.body}`], [action.el, notNow.el]));
      } else {
        const review = btn({ label: "Review", variant: "outline", size: "xs", onClick: () => openReview() });
        el2.replaceChildren(...bannerWithActions("info", model.title, [model.body], [review.el, notNow.el]));
      }
      el2.hidden = false;
    };
    const dismiss = () => {
      if (!loose) return;
      dismissed = looseKey(loose.files);
      void host.storage.set(LOOSE_DISMISSED_KEY, dismissed);
      paint();
    };
    const importOne = async (name) => {
      if (busy) return;
      busy = true;
      paint();
      try {
        const result = await importLoose(name);
        const outcome = importOutcome(result);
        imported = { ...result, tone: outcome.kind, message: outcome.message };
      } catch (error) {
        toast("error", `Couldn\u2019t import ${name}. ${errorText2(error)}`);
      } finally {
        busy = false;
        paint();
        void store.refreshDesigns();
      }
    };
    const openReview = () => {
      if (!loose) return;
      const snapshot = loose;
      const sheet = openSheet(options.sheetHost, {
        title: "HTML files in your designs folder",
        subtitle: "Each one you import becomes a page. The original moves to .trash in your designs folder.",
        variant: "dialog"
      });
      const locale = host.snapshot()?.locale ?? "en";
      const row = (file) => {
        const detail = h("span", { class: "dc-muted" }, `${fileSize(file.bytes, locale)} \xB7 ${relativeTime(file.mtime, Date.now(), locale)}`);
        const failure = h("p", { class: "dc-form-error", role: "alert", hidden: true });
        const text = h("div", { class: "dc-prev-text" }, h("code", { class: "dc-path", title: file.name }, file.name), detail, failure);
        const item = h("li", { class: "dc-prev" }, text);
        const action = btn({ label: "Import", variant: "outline", size: "xs", onClick: () => {
          action.set({ loading: true });
          failure.hidden = true;
          importLoose(file.name).then(
            (result) => {
              const outcome = importOutcome(result);
              detail.textContent = result.originalMovedTo === null ? outcome.message : `Imported as \u201C${result.title}\u201D.`;
              const open = btn({ label: "Open", variant: "outline", size: "xs", onClick: () => {
                sheet.close();
                options.onOpen(result.slug);
              } });
              action.el.replaceWith(open.el);
              open.el.focus();
              void store.refreshDesigns();
            },
            (error) => {
              failure.textContent = errorText2(error);
              failure.hidden = false;
              action.set({ loading: false });
            }
          );
        } });
        action.el.setAttribute("aria-label", `Import ${file.name} as a page`);
        item.append(action.el);
        return item;
      };
      const note = unlistedNote(snapshot);
      append(sheet.body, h("ul", { class: "dc-prev-list", "aria-label": "HTML files" }, ...snapshot.files.map(row)), note ? h("p", { class: "dc-muted" }, note) : null);
      sheet.foot.append(btn({ label: "Done", variant: "ghost", onClick: () => sheet.close() }).el);
    };
    void host.storage.get(LOOSE_DISMISSED_KEY).then((value) => {
      dismissed = parseDismissed(value);
      paint();
    });
    return {
      el: el2,
      update: (next) => {
        if (JSON.stringify(next) === JSON.stringify(loose)) return;
        loose = next;
        paint();
      },
      dispose: () => {
        disposed = true;
        el2.remove();
      }
    };
  };

  // src/ui/components/thumb.ts
  var LIVE_MAX = 6;
  var liveActive = 0;
  var liveWaiting = [];
  var acquireLive = (start) => {
    const release = () => {
      liveActive -= 1;
      liveWaiting.shift()?.();
    };
    const begin = () => {
      liveActive += 1;
      start();
    };
    if (liveActive < LIVE_MAX) begin();
    else liveWaiting.push(begin);
    return () => {
      const queued = liveWaiting.indexOf(begin);
      if (queued >= 0) liveWaiting.splice(queued, 1);
      else release();
    };
  };
  var modeOf = (summary) => summary.pending ? "pending" : summary.thumb.state === "ready" ? "image" : "live";
  var mountThumb = (summary, aspect = "rail") => {
    let current = summary;
    const el2 = h("div", { class: "dc-thumb", "data-aspect": aspect, "data-state": "loading", "aria-hidden": "true" });
    let disposed = false;
    let teardown = null;
    let sizeObserver = null;
    let observer = null;
    let token = 0;
    const clear = () => {
      teardown?.();
      teardown = null;
      sizeObserver?.disconnect();
      sizeObserver = null;
      observer?.disconnect();
      observer = null;
      el2.replaceChildren();
    };
    const showPending = () => {
      el2.dataset.state = "pending";
      el2.append(icon2(current.kind === "canvas" ? "canvas" : "page", aspect === "card" ? 28 : 18));
    };
    const showImage = () => {
      el2.dataset.state = "loading";
      const mine = token;
      const key = current.thumb.key;
      client.thumbnail(current.slug, key).then(
        (answer) => {
          if (disposed || mine !== token) return;
          if (answer.state === "ready" && answer.png) {
            const img = h("img", { alt: "", draggable: "false", src: `data:image/png;base64,${answer.png}` });
            img.addEventListener("load", () => void (el2.dataset.state = "ready"), { once: true });
            el2.append(img);
          } else showLive();
        },
        () => {
          if (!disposed && mine === token) showLive();
        }
      );
    };
    const showLive = () => {
      clear();
      el2.dataset.state = "loading";
      const mine = token;
      const place = () => {
        let doc = null;
        let release = null;
        const start = () => {
          const vp = current.viewports[0] ?? { width: 1280, height: 800, id: "laptop", label: "Laptop" };
          client.loadRender(current.slug, null, null).then(
            ({ html }) => {
              if (disposed || mine !== token) return;
              doc = createFrameDocument(html, { artboardId: "thumb", file: current.kind === "page" ? "index.html" : "thumb", mode: "play" });
              const frame = h("iframe", { class: "dc-thumb-frame", sandbox: "", tabindex: "-1", title: "", src: doc.url, loading: "eager" });
              frame.style.width = `${vp.width}px`;
              frame.style.height = `${vp.height}px`;
              const fit = () => {
                const scale = el2.clientWidth / vp.width;
                if (scale > 0) frame.style.transform = `scale(${scale})`;
              };
              fit();
              sizeObserver = new ResizeObserver(fit);
              sizeObserver.observe(el2);
              frame.addEventListener("load", () => void (el2.dataset.state = "ready"), { once: true });
              el2.append(frame);
            },
            () => {
              if (!disposed && mine === token) el2.dataset.state = "error";
            }
          );
        };
        release = acquireLive(start);
        teardown = () => {
          release?.();
          doc?.revoke();
          el2.replaceChildren();
        };
      };
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          observer = null;
          place();
        }
      });
      observer.observe(el2);
    };
    const render = () => {
      token += 1;
      clear();
      const mode = modeOf(current);
      if (mode === "pending") showPending();
      else if (mode === "image") showImage();
      else showLive();
    };
    render();
    return {
      el: el2,
      update: (next) => {
        const changed = modeOf(next) !== modeOf(current) || next.thumb.key !== current.thumb.key || next.slug !== current.slug;
        current = next;
        if (changed) render();
      },
      dispose: () => {
        disposed = true;
        clear();
        el2.remove();
      }
    };
  };

  // src/ui/model/list-model.ts
  var LIST_TABS = [
    { id: "all", label: "All" },
    { id: "canvas", label: "Canvases" },
    { id: "page", label: "Pages" }
  ];
  var LIST_SORTS = [
    { id: "updated", label: "Updated" },
    { id: "created", label: "Created" },
    { id: "title", label: "Title" }
  ];
  var kindLabel = (kind) => kind === "canvas" ? "Canvas" : "Page";
  var matchesQuery = (design, query) => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return true;
    return design.title.toLowerCase().includes(needle) || design.slug.toLowerCase().includes(needle);
  };
  var matchesTab = (design, tab) => tab === "all" || design.kind === tab;
  var filterDesigns = (designs, query, tab) => designs.filter((design) => matchesTab(design, tab) && matchesQuery(design, query));
  var tabCounts = (designs, query) => {
    const searched = designs.filter((design) => matchesQuery(design, query));
    return {
      all: searched.length,
      canvas: searched.filter((design) => design.kind === "canvas").length,
      page: searched.filter((design) => design.kind === "page").length
    };
  };
  var sortDesigns = (designs, sort) => {
    const copy = [...designs];
    if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title, void 0, { sensitivity: "base" }));
    const key = sort === "created" ? "created" : "updated";
    return copy.sort((a, b) => Date.parse(b[key]) - Date.parse(a[key]));
  };
  var kindSummary = (design) => {
    if (design.kind === "page") return "Page";
    return `Canvas \xB7 ${plural(design.screenCount, "screen")}`;
  };
  var emptyKind = (all, shown) => {
    if (shown.length > 0) return "none";
    return all.length === 0 ? "no-designs" : "no-matches";
  };
  var rowAriaLabel = (design) => {
    const parts = [design.title, kindSummary(design)];
    if (design.pending) parts.push("waiting for the agent");
    if (design.openComments > 0) parts.push(plural(design.openComments, "open comment"));
    return parts.join(", ");
  };

  // src/ui/page/library-view.ts
  var SKELETON_CARDS = 8;
  var mountLibrary = (options) => {
    const scope = createScope();
    let query = "";
    let tab = "all";
    let sort = "updated";
    const thumbs = /* @__PURE__ */ new Map();
    const el2 = h("div", { class: "dc-library" });
    const newButton = btn({ label: "New", variant: "default", size: "default", icon: "plus", chevron: true, onClick: () => void 0 });
    attachMenu(
      newButton.el,
      () => [
        { id: "canvas", label: "Canvas\u2026", hint: "several screens" },
        { id: "page", label: "Page\u2026", hint: "one HTML page" }
      ],
      (id) => options.onNew(id === "page" ? "page" : "canvas")
    );
    const settingsButton = btn({ label: "Settings", variant: "ghost", size: "default", icon: "settings", onClick: () => options.onSettings() });
    const searchHost = h("div", { class: "dc-search" });
    const search = mountSearchField(searchHost, { value: "", placeholder: "Search designs", label: "Search designs", onChange: (value) => {
      query = value;
      search.update({ value });
      paintGrid();
    } });
    const tabsHost = h("div", { class: "dc-tabs" });
    const tabsHandle = mountTabs(tabsHost, { items: LIST_TABS.map(({ id, label }) => ({ id, label })), activeId: tab, trackBackground: true, onChange: (id) => {
      tab = LIST_TABS.find((entry) => entry.id === id)?.id ?? "all";
      tabsHandle.update({ activeId: tab });
      paintGrid();
    } });
    const sortHost = h("div", { class: "dc-sort", title: "Sort designs" }, h("span", { class: "dc-sort-label" }, "Sort"));
    const sortSelect = mountSelect(sortHost, { value: sort, options: LIST_SORTS.map(({ id, label }) => ({ id, label })), onChange: (id) => {
      sort = LIST_SORTS.find((entry) => entry.id === id)?.id ?? "updated";
      sortSelect.update({ value: sort });
      paintGrid();
    } });
    const toolbar = h(
      "header",
      { class: "dc-library-bar" },
      h("h1", { class: "dc-page-title" }, "Designs"),
      h("div", { class: "dc-library-controls" }, searchHost, tabsHost, sortHost),
      h("span", { class: "dc-spacer" }),
      settingsButton.el,
      newButton.el
    );
    const notices = h("div", { class: "dc-library-notices" });
    const syncNotices = () => {
      notices.hidden = ![...notices.children].some((child) => child instanceof HTMLElement && !child.hidden);
    };
    const looseBanner2 = mountLooseBanner({ sheetHost: options.actions.host, onOpen: options.onOpen, onPaint: syncNotices });
    notices.append(looseBanner2.el);
    const grid = h("ul", { class: "dc-grid", role: "list", "aria-label": "Designs" });
    const scroller = h("div", { class: "dc-library-scroll" }, notices, grid);
    el2.append(toolbar, scroller);
    const switchBack = async (path) => {
      try {
        await store.updateSettings({ root: path });
        await store.refreshDesigns();
      } catch (error) {
        toast("error", `Couldn\u2019t switch back. ${error instanceof Error ? error.message : ""}`);
      }
    };
    const card = (design) => {
      let thumb = thumbs.get(design.slug);
      if (thumb) thumb.update(design);
      else {
        thumb = mountThumb(design, "card");
        thumbs.set(design.slug, thumb);
      }
      const kindBadge = h("span");
      mountBadge(kindBadge, { label: kindLabel(design.kind), tone: "neutral" });
      const locale = host.snapshot()?.locale ?? "en";
      const indicators = h("span", { class: "dc-card-flags" });
      if (design.openComments > 0) indicators.append(h("span", { class: "dc-flag", title: plural(design.openComments, "open comment") }, icon2("pin", 12), String(design.openComments)));
      if (design.sessionId) indicators.append(h("span", { class: "dc-flag dc-flag-icon", title: "Linked to a chat", role: "img", "aria-label": "Linked to a chat" }, icon2("chat", 12)));
      const main = h(
        "button",
        { type: "button", class: "dc-card-main", "aria-label": rowAriaLabel(design) },
        h("span", { class: "dc-card-thumb" }, thumb.el, design.pending ? h("span", { class: "dc-card-overlay" }, h("span", { class: "dc-flag", "data-tone": "warning" }, "Waiting for agent")) : null),
        h("span", { class: "dc-card-body" }, h("span", { class: "dc-card-title" }, design.title), h("span", { class: "dc-card-meta" }, kindBadge, h("span", { class: "dc-muted" }, relativeTime(design.updated, Date.now(), locale)), indicators))
      );
      main.addEventListener("click", () => options.onOpen(design.slug));
      const more = iconBtn({ icon: "more", label: `Actions for ${design.title}`, size: "sm", onClick: () => void 0 });
      more.classList.add("dc-card-more");
      const ref = { slug: design.slug, title: design.title, kind: design.kind, sessionId: design.sessionId };
      attachMenu(more, () => designMenu({ includeOpen: true }), (id) => runDesignAction(id, ref, options.actions));
      return h("li", { class: "dc-card", "data-slug": design.slug, "data-pending": design.pending ? "true" : "false" }, main, more);
    };
    const skeletons = () => Array.from({ length: SKELETON_CARDS }, () => h("li", { class: "dc-card dc-card-skeleton", "aria-hidden": "true" }, h("span", { class: "dc-skel dc-skel-card" }), h("span", { class: "dc-skel dc-skel-line" }), h("span", { class: "dc-skel dc-skel-line dc-skel-short" })));
    const message = (...children) => h("li", { class: "dc-grid-message" }, ...children);
    const paintNotices = () => {
      for (const child of [...notices.children]) if (child !== looseBanner2.el) child.remove();
      const state = store.getState();
      if (state.designs.status === "error" && state.designs.data) {
        const wrap = h("div", { class: "dc-banner" });
        mountBanner(wrap, { tone: "warning", title: "Couldn\u2019t refresh the list", body: state.designs.error?.message ?? "", action: { label: "Try again", onClick: () => void store.refreshDesigns() } });
        looseBanner2.el.before(wrap);
      }
      const first = state.settings.data?.previousRoots.find((root) => root.exists && root.designCount > 0);
      if (first) {
        const wrap = h("div", { class: "dc-banner" });
        mountBanner(wrap, { tone: "info", title: `${designCountLabel(first.designCount)} remain in your earlier folder`, body: middlePath(first.path), action: { label: "Switch back", onClick: () => void switchBack(first.path) } });
        wrap.title = first.path;
        looseBanner2.el.before(wrap);
      }
      looseBanner2.update(state.designs.data?.loose ?? null);
      syncNotices();
    };
    const paintGrid = () => {
      const previousScroll = scroller.scrollTop;
      const state = store.getState().designs;
      grid.replaceChildren();
      paintNotices();
      if ((state.status === "idle" || state.status === "loading") && !state.data) {
        grid.append(...skeletons());
        return;
      }
      if (!state.data) {
        const wrap = h("div");
        mountBanner(wrap, { tone: "error", title: "Your designs didn\u2019t load", body: state.error?.message ?? "The local service didn\u2019t answer. Allow it in Settings \u2192 Extensions, then try again.", action: { label: "Try again", onClick: () => void store.refreshDesigns() } });
        grid.append(message(wrap));
        return;
      }
      const all = state.data.designs;
      const shown = sortDesigns(filterDesigns(all, query, tab), sort);
      const counts = tabCounts(all, query);
      tabsHandle.update({ items: LIST_TABS.map(({ id, label }) => ({ id, label, count: counts[id] })) });
      const kind = emptyKind(all, shown);
      if (kind === "no-designs") {
        const wrap = h("div");
        mountEmpty(wrap, { title: "No designs yet", body: "Type /design or /page in any chat and describe what you want. Your agent writes the files and they show up here the moment they are saved.", action: { label: "New canvas", onClick: () => options.onNew("canvas") } });
        grid.append(message(wrap));
      } else if (kind === "no-matches") {
        const wrap = h("div");
        mountEmpty(wrap, { title: query.trim() !== "" ? `No designs match \u201C${query.trim()}\u201D` : "Nothing in this tab yet", body: "Try another word, or look in All.", action: { label: "Clear filters", onClick: () => {
          query = "";
          tab = "all";
          search.update({ value: "" });
          tabsHandle.update({ activeId: "all" });
          paintGrid();
        } } });
        grid.append(message(wrap));
      } else grid.append(...shown.map(card));
      const live = new Set(all.map((design) => design.slug));
      for (const [slug, handle] of thumbs) {
        if (!live.has(slug)) {
          handle.dispose();
          thumbs.delete(slug);
        }
      }
      scroller.scrollTop = previousScroll;
    };
    let signature = "";
    scope.add(
      store.subscribe(() => {
        const state = store.getState();
        const next = `${state.designs.status}:${JSON.stringify(state.designs.data?.designs ?? null)}:${JSON.stringify(state.designs.data?.loose ?? null)}:${state.designs.error?.message ?? ""}:${JSON.stringify(state.settings.data?.previousRoots ?? null)}`;
        if (next === signature) return;
        signature = next;
        paintGrid();
      })
    );
    const minute = setInterval(paintGrid, 6e4);
    scope.add(() => clearInterval(minute));
    void store.refreshDesigns();
    void store.loadSettings();
    paintGrid();
    return {
      el: el2,
      focusCard: (slug) => {
        grid.querySelector(`[data-slug="${CSS.escape(slug)}"] .dc-card-main`)?.focus();
      },
      dispose: () => {
        scope.dispose();
        looseBanner2.dispose();
        for (const handle of thumbs.values()) handle.dispose();
        thumbs.clear();
        search.dispose();
        tabsHandle.dispose();
        sortSelect.dispose();
        el2.remove();
      }
    };
  };

  // src/ui/page/page-app.ts
  var mountPage = (root) => {
    const app = h("div", { class: "dc-app", "data-surface": "page" });
    root.replaceChildren(app);
    let open = null;
    const closeDesign = () => {
      const slug = open?.slug;
      open?.handle.dispose();
      open = null;
      library.el.hidden = false;
      place.clear();
      if (slug) library.focusCard(slug);
    };
    const openDesign = (slug) => {
      if (open?.slug === slug) return;
      open?.handle.dispose();
      const handle = mountDesignView({ slug, surface: "page", actions, onBack: closeDesign });
      open = { slug, handle };
      place.remember(slug);
      library.el.hidden = true;
      app.append(handle.el);
    };
    const place = keepPlace({ surface: "page", isOpen: () => open !== null, open: openDesign });
    const actions = {
      host: app,
      onOpen: openDesign,
      onRemoved: (slug) => {
        if (open?.slug === slug) closeDesign();
      }
    };
    const openSettings = () => {
      let settings = null;
      const sheet = openSheet(app, { title: "Settings", variant: "side", onClose: () => settings?.dispose() });
      settings = mountSettings(sheet.body);
    };
    const library = mountLibrary({
      actions,
      onOpen: openDesign,
      onSettings: openSettings,
      onNew: (kind) => openNewDialog(app, { kind, onCreated: openDesign })
    });
    app.append(library.el);
    flows.watchItems(
      (target) => openDesign(target.slug),
      (error) => toast("error", `Couldn\u2019t open that design. ${errorText2(error)}`)
    );
  };

  // src/ui/rail/list-view.ts
  var SKELETON_ROWS = 4;
  var mountListView = (options) => {
    const scope = createScope();
    let query = "";
    let tab = "all";
    const thumbs = /* @__PURE__ */ new Map();
    const el2 = h("div", { class: "dc-list-view" });
    const newButton = btn({ label: "New", variant: "default", size: "sm", icon: "plus", chevron: true, onClick: () => void 0 });
    attachMenu(
      newButton.el,
      () => [
        { id: "canvas", label: "Canvas\u2026", hint: "several screens" },
        { id: "page", label: "Page\u2026", hint: "one HTML page" }
      ],
      (id) => options.onNew(id === "page" ? "page" : "canvas")
    );
    const settingsButton = iconBtn({ icon: "settings", label: "Settings", onClick: () => options.onSettings() });
    const head = h("header", { class: "dc-rail-head" }, h("h1", { class: "dc-rail-title" }, "Designs"), h("span", { class: "dc-spacer" }), newButton.el, settingsButton);
    const searchHost = h("div", { class: "dc-search" });
    const search = mountSearchField(searchHost, { value: "", placeholder: "Search designs", label: "Search designs", onChange: (value) => {
      query = value;
      search.update({ value });
      paintList();
    } });
    const tabsHost = h("div", { class: "dc-tabs" });
    const tabsHandle = mountTabs(tabsHost, { items: LIST_TABS.map(({ id, label }) => ({ id, label })), activeId: tab, trackBackground: true, onChange: (id) => {
      tab = LIST_TABS.find((entry) => entry.id === id)?.id ?? "all";
      tabsHandle.update({ activeId: tab });
      paintList();
    } });
    const filters = h("div", { class: "dc-rail-filters" }, searchHost, tabsHost);
    const tipHost = h("div", { class: "dc-rail-tip", hidden: true });
    let tipWanted = null;
    let tipHidden = false;
    const paintTip = () => {
      const state = store.getState().designs;
      const failed = state.status === "error" && !state.data;
      const show = tipWanted === true && !tipHidden && !failed;
      tipHost.hidden = !show;
      if (!show) {
        tipHost.replaceChildren();
        return;
      }
      if (tipHost.firstElementChild) return;
      mountBanner(tipHost, {
        tone: "info",
        title: "Open Design Chamber full screen",
        body: "In the sidebar, open Extension pages and pick Design Chamber. Canvases get the whole window there.",
        action: { label: "Got it", onClick: dismissTip }
      });
    };
    const dismissTip = () => {
      tipHidden = true;
      paintTip();
      searchHost.querySelector("input")?.focus();
      void host.storage.set(TIP_KEY, dismissedTip(/* @__PURE__ */ new Date()));
    };
    void host.storage.get(TIP_KEY).then((stored) => {
      tipWanted = shouldShowTip(stored);
      paintTip();
    });
    const notices = h("div", { class: "dc-rail-notices" });
    const syncNotices = () => {
      notices.hidden = ![...notices.children].some((child) => child instanceof HTMLElement && !child.hidden);
    };
    const looseBanner2 = mountLooseBanner({ sheetHost: options.actions.host, onOpen: options.onOpen, onPaint: syncNotices });
    notices.append(looseBanner2.el);
    const list = h("ul", { class: "dc-rows", role: "list", "aria-label": "Designs" });
    const scroller = h("div", { class: "dc-rail-scroll" }, notices, list);
    el2.append(head, tipHost, filters, scroller);
    const switchBack = async (path) => {
      try {
        await store.updateSettings({ root: path });
        await store.refreshDesigns();
      } catch (error) {
        toast("error", `Couldn\u2019t switch back. ${error instanceof Error ? error.message : ""}`);
      }
    };
    const rowFor = (design) => {
      let thumb = thumbs.get(design.slug);
      if (thumb) thumb.update(design);
      else {
        thumb = mountThumb(design, "rail");
        thumbs.set(design.slug, thumb);
      }
      const locale = host.snapshot()?.locale ?? "en";
      const meta = h("span", { class: "dc-row-meta" }, `${kindSummary(design)} \xB7 ${relativeTime(design.updated, Date.now(), locale)}`);
      const flags = h("span", { class: "dc-row-flags" });
      if (design.pending) flags.append(h("span", { class: "dc-flag", "data-tone": "warning" }, "Waiting for agent"));
      if (design.openComments > 0) flags.append(h("span", { class: "dc-flag", title: plural(design.openComments, "open comment") }, icon2("pin", 12), String(design.openComments)));
      if (design.sessionId) flags.append(h("span", { class: "dc-flag dc-flag-icon", title: "Linked to a chat", role: "img", "aria-label": "Linked to a chat" }, icon2("chat", 12)));
      const main = h("button", { type: "button", class: "dc-row-main", "aria-label": rowAriaLabel(design) }, thumb.el, h("span", { class: "dc-row-text" }, h("span", { class: "dc-row-title" }, design.title), meta, flags.childElementCount > 0 ? flags : null));
      main.addEventListener("click", () => options.onOpen(design.slug));
      const more = iconBtn({ icon: "more", label: `Actions for ${design.title}`, size: "sm", onClick: () => void 0 });
      const ref = { slug: design.slug, title: design.title, kind: design.kind, sessionId: design.sessionId };
      attachMenu(more, () => designMenu({ includeOpen: true }), (id) => runDesignAction(id, ref, options.actions));
      return h("li", { class: "dc-row", "data-pending": design.pending ? "true" : "false", "data-slug": design.slug }, main, more);
    };
    const skeleton = () => Array.from({ length: SKELETON_ROWS }, () => h("li", { class: "dc-row dc-row-skeleton", "aria-hidden": "true" }, h("span", { class: "dc-skel dc-skel-thumb" }), h("span", { class: "dc-skel-lines" }, h("span", { class: "dc-skel dc-skel-line" }), h("span", { class: "dc-skel dc-skel-line dc-skel-short" }))));
    const paintNotices = () => {
      for (const child of [...notices.children]) if (child !== looseBanner2.el) child.remove();
      const state = store.getState();
      if (state.designs.status === "error" && state.designs.data) {
        const wrap = h("div", { class: "dc-banner" });
        mountBanner(wrap, { tone: "warning", title: "Couldn\u2019t refresh the list", body: state.designs.error?.message ?? "", action: { label: "Try again", onClick: () => void store.refreshDesigns() } });
        looseBanner2.el.before(wrap);
      }
      const holders = state.settings.data?.previousRoots.filter((root) => root.exists && root.designCount > 0) ?? [];
      const first = holders[0];
      if (first) {
        const wrap = h("div", { class: "dc-banner" });
        mountBanner(wrap, { tone: "info", title: `${designCountLabel(first.designCount)} remain in your earlier folder`, body: middlePath(first.path), action: { label: "Switch back", onClick: () => void switchBack(first.path) } });
        wrap.title = first.path;
        looseBanner2.el.before(wrap);
      }
      looseBanner2.update(state.designs.data?.loose ?? null);
      syncNotices();
    };
    const paintList = () => {
      const state = store.getState().designs;
      list.replaceChildren();
      for (const handle of [...thumbs.values()]) handle.el.remove();
      paintNotices();
      paintTip();
      if ((state.status === "idle" || state.status === "loading") && !state.data) {
        list.append(...skeleton());
        return;
      }
      if (!state.data) {
        const wrap = h("div", { class: "dc-banner dc-banner-block" });
        mountBanner(wrap, { tone: "error", title: "Your designs didn\u2019t load", body: state.error?.message ?? "The local service didn\u2019t answer. Allow it in Settings \u2192 Extensions, then try again.", action: { label: "Try again", onClick: () => void store.refreshDesigns() } });
        list.append(h("li", { class: "dc-list-message" }, wrap));
        return;
      }
      const all = state.data.designs;
      const shown = sortDesigns(filterDesigns(all, query, tab), "updated");
      tabsHandle.update({ items: LIST_TABS.map(({ id, label }) => ({ id, label, count: tabCounts(all, query)[id] })) });
      const kind = emptyKind(all, shown);
      if (kind === "no-designs") {
        const wrap = h("div");
        mountEmpty(wrap, { title: "No designs yet", body: "Type /design or /page in any chat and describe what you want. Your agent writes the files and they show up here.", action: { label: "New canvas", onClick: () => options.onNew("canvas") } });
        list.append(h("li", { class: "dc-list-message" }, wrap));
      } else if (kind === "no-matches") {
        const wrap = h("div");
        mountEmpty(wrap, { title: query.trim() !== "" ? `No designs match \u201C${query.trim()}\u201D` : "Nothing in this tab yet", body: "Try another word, or look in All.", action: { label: "Clear filters", onClick: () => {
          query = "";
          tab = "all";
          search.update({ value: "" });
          tabsHandle.update({ activeId: "all" });
          paintList();
        } } });
        list.append(h("li", { class: "dc-list-message" }, wrap));
      } else {
        list.append(...shown.map(rowFor));
      }
      const live = new Set(all.map((design) => design.slug));
      for (const [slug, handle] of thumbs) {
        if (!live.has(slug)) {
          handle.dispose();
          thumbs.delete(slug);
        }
      }
    };
    let signature = "";
    scope.add(
      store.subscribe(() => {
        const state = store.getState();
        const next = `${state.designs.status}:${JSON.stringify(state.designs.data?.designs ?? null)}:${JSON.stringify(state.designs.data?.loose ?? null)}:${state.designs.error?.message ?? ""}:${JSON.stringify(state.settings.data?.previousRoots ?? null)}`;
        if (next === signature) return;
        signature = next;
        paintList();
      })
    );
    const minute = setInterval(paintList, 6e4);
    scope.add(() => clearInterval(minute));
    void store.refreshDesigns();
    void store.loadSettings();
    paintList();
    return {
      el: el2,
      focusRow: (slug) => {
        list.querySelector(`[data-slug="${CSS.escape(slug)}"] .dc-row-main`)?.focus();
      },
      dispose: () => {
        scope.dispose();
        looseBanner2.dispose();
        for (const handle of thumbs.values()) handle.dispose();
        thumbs.clear();
        search.dispose();
        tabsHandle.dispose();
        el2.remove();
      }
    };
  };

  // src/ui/rail/rail-app.ts
  var mountRail = (root) => {
    const app = h("div", { class: "dc-app", "data-surface": "panel" });
    root.replaceChildren(app);
    let viewer = null;
    const closeViewer = () => {
      const slug = viewer?.slug;
      viewer?.handle.dispose();
      viewer = null;
      list.el.hidden = false;
      place.clear();
      if (slug) list.focusRow(slug);
    };
    const openViewer = (slug, options = {}) => {
      if (viewer?.slug === slug) {
        if (options.startIn === "comment") viewer.handle.startComment();
        return;
      }
      viewer?.handle.dispose();
      const handle = mountDesignView({ slug, surface: "panel", actions, onBack: closeViewer, startIn: options.startIn });
      viewer = { slug, handle };
      place.remember(slug);
      list.el.hidden = true;
      app.append(handle.el);
    };
    const place = keepPlace({ surface: "panel", isOpen: () => viewer !== null, open: (slug) => openViewer(slug) });
    const actions = {
      host: app,
      onOpen: openViewer,
      onRemoved: (slug) => {
        if (viewer?.slug === slug) closeViewer();
      }
    };
    const openSettings = () => {
      let settings = null;
      const sheet = openSheet(app, { title: "Settings", variant: "full", onClose: () => settings?.dispose() });
      settings = mountSettings(sheet.body);
    };
    const list = mountListView({
      actions,
      onOpen: openViewer,
      onSettings: openSettings,
      onNew: (kind) => openNewDialog(app, { kind, onCreated: openViewer })
    });
    app.append(list.el);
    flows.watchItems(
      (target) => openViewer(target.slug),
      (error) => toast("error", `Couldn\u2019t open that design. ${errorText2(error)}`)
    );
    flows.watchOpenRequests((listener) => feed.subscribe(listener), (target) => openViewer(target.slug, { startIn: target.intent }));
  };

  // src/ui/app.ts
  var startApp = (guestHost3, client2) => {
    const root = document.querySelector("#root");
    if (!root) throw new Error("Design Chamber: #root is missing from index.html.");
    const appRoot = root;
    startGuest(guestHost3, client2);
    mountSpinner(document.createElement("div")).dispose();
    let mounted = false;
    host.onReady((context) => {
      if (context.surface === "background") return;
      applyHostReady(context, document.documentElement);
      document.documentElement.lang = context.locale;
      if (mounted) return;
      mounted = true;
      if (context.surface === "page") mountPage(appRoot);
      else {
        mountRail(appRoot);
        flows.watchOutbox();
      }
      flows.watchTurns();
      flows.watchSessions(() => (store.getState().designs.data?.designs ?? []).map(({ slug, sessionId }) => ({ slug, sessionId })));
    });
  };

  // src/ui/main.ts
  var guestHost2 = getGuestHost();
  startApp(guestHost2, createServiceClient(guestHost2.client));
})();
