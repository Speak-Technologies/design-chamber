"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // <define:__DC_SYSTEM_QUESTIONS__>
  var define_DC_SYSTEM_QUESTIONS_default = { roundOne: [{ topic: "home", label: "Where should the design system live?", multiple: false, options: [{ choice: "repo", label: "Repo + living page", why: "The system and its living page ship with your repo, next to the code.", recommended: true }, { choice: "internal", label: "In Design Chamber", why: "Stays in the Designs folder. No page in the repo.", recommended: false }] }, { topic: "mode", label: "Should building it also fix the code, or only describe what should be?", multiple: false, options: [{ choice: "fix", label: "Fix tokens, then document", why: "I change the token definitions in your code after you approve a diff.", recommended: true }, { choice: "describe", label: "Describe only, never change the app's code", why: "The system documents the target and your code keeps its values. New system files are still created after you approve a diff.", recommended: false }] }, { topic: "coverage", label: "Which parts should it cover?", multiple: true, options: [{ choice: "foundations", label: "Foundations", why: "Colour, type, space, radius, shadows, layers and sizes.", recommended: true }, { choice: "components", label: "Components", why: "The components the code has, with when to use them.", recommended: true }, { choice: "patterns", label: "Patterns & voice", why: "Layout patterns and how the product speaks.", recommended: true }, { choice: "brand", label: "Brand & marketing", why: "Logos, brand guidance and marketing surfaces.", recommended: true }] }, { topic: "depth", label: "How complete should it be?", multiple: false, options: [{ choice: "core", label: "Product core", why: "Foundations, your components with every state, and the patterns your screens use.", recommended: true }, { choice: "full", label: "Full system", why: "Core plus motion, navigation, overlays, forms, feedback, data display and page templates.", recommended: false }, { choice: "tokens", label: "Tokens only", why: "Values and notes only.", recommended: false }] }, { topic: "dark", label: "Dark mode as part of this?", multiple: false, options: [{ choice: "not-now", label: "Not now", why: "Light values only. Dark can be added later.", recommended: true }, { choice: "include", label: "Include dark values", why: "I derive a dark value for every colour, and round two asks how.", recommended: false }] }], roundTwo: [{ topic: "status-colours", label: "Status colours", multiple: false, options: [{ choice: "brand-tuned", label: "Brand-tuned set", why: "One warning, one danger, one success, tuned to your brand. The proposed values are shown with this call.", recommended: true }, { choice: "stock", label: "Keep the stock set", why: "The code keeps its current status colours. The system records them as they are.", recommended: false }, { choice: "custom", label: "Custom", why: "Say what you want in the note.", recommended: false }] }, { topic: "greys", label: "Greys", multiple: false, options: [{ choice: "brand-tinted", label: "Brand-tinted greys", why: "The neutral ramp leans a few degrees toward the brand hue.", recommended: true }, { choice: "neutral", label: "Keep neutral grey", why: "The current greys stay; only the colours change.", recommended: false }] }, { topic: "access", label: "Who can open the living page", multiple: false, options: [{ choice: "dev", label: "Dev builds only", why: "The page ships in the repo and is not published.", recommended: true }, { choice: "public", label: "Public", why: "GitHub Pages or a similar host. Fonts fall back unless you turn on Embed fonts.", recommended: false }] }, { topic: "typography", label: "Typography", multiple: false, options: [{ choice: "one-font", label: "One font only", why: "The same font everywhere, including marketing headings.", recommended: true }, { choice: "display", label: "Add a display font", why: "A second face for marketing headings. Specimens fall back where the face is missing.", recommended: false }] }, { topic: "dark-values", label: "Dark values", multiple: false, options: [{ choice: "derive", label: "Derive dark values from the light ones", why: "A dark value for every colour, computed from the light set. Consistent, and quick to review.", recommended: true }, { choice: "hand-tune", label: "Hand-tune them with me", why: "We go through the dark values together, one group at a time.", recommended: false }] }, { topic: "platforms", label: "Platforms", multiple: false, options: [{ choice: "laptop-phone", label: "Laptop and phone", why: "Both, at the code's breakpoints.", recommended: true }, { choice: "phone-first", label: "Phone first", why: "Wider screens add columns.", recommended: false }, { choice: "laptop", label: "Laptop only", why: "No phone layouts.", recommended: false }, { choice: "custom", label: "Custom", why: "Say which in the note.", recommended: false }] }, { topic: "navigation", label: "Navigation", multiple: false, options: [{ choice: "keep", label: "Keep the code's pattern", why: "Plus a phone version if it lacks one.", recommended: true }, { choice: "top-bottom", label: "Top bar, bottom bar on phone", why: "Up to 7 destinations on top, 3 to 5 at the bottom.", recommended: false }, { choice: "rail-bottom", label: "Side rail, bottom bar on phone", why: "For 8+ destinations or a deep app.", recommended: false }, { choice: "custom", label: "Custom", why: "Say what in the note.", recommended: false }] }, { topic: "overlays", label: "Overlays", multiple: false, options: [{ choice: "sheet", label: "Sheets on phone, modals on laptop", why: "Short tasks rise from the bottom on phone.", recommended: true }, { choice: "modal", label: "Modals everywhere", why: "Centred at every width.", recommended: false }, { choice: "keep", label: "Keep the code's", why: "Recorded as is.", recommended: false }] }, { topic: "motion", label: "Motion", multiple: false, options: [{ choice: "calm", label: "A calm set", why: "Three durations, ease-out in, ease-in out, fades under reduced motion.", recommended: true }, { choice: "keep", label: "Keep the code's values", why: "Recorded as is.", recommended: false }, { choice: "none", label: "No motion", why: "Changes are instant.", recommended: false }] }, { topic: "scales", label: "Spacing and radius", multiple: false, options: [{ choice: "snap", label: "Snap to one scale", why: "Values move to the nearest step, listed in the diff.", recommended: true }, { choice: "keep", label: "Keep every value", why: "Recorded as is.", recommended: false }] }, { topic: "brand-colour", label: "Brand colour", multiple: false, options: [{ choice: "split", label: "Brand palette for marketing, one product accent", why: "The app keeps one accent for actions.", recommended: true }, { choice: "one", label: "One colour everywhere", why: "One accent in the app and marketing.", recommended: false }] }], closing: "Reply with changes, or say go to accept the defaults." };

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

  // node_modules/@openchamber/sdk/dist/microphone.js
  var GUEST_MICROPHONE_SAMPLE_RATE_MIN = 8e3;
  var GUEST_MICROPHONE_SAMPLE_RATE_MAX = 192e3;
  var GUEST_MICROPHONE_OPEN_TIMEOUT_MS = 12e4;
  var createSampleQueue = (capacity) => {
    const chunks = [];
    let offset = 0;
    let queued = 0;
    return {
      push: (samples) => {
        chunks.push(samples);
        queued += samples.length;
        while (queued - offset > capacity && chunks.length > 1) {
          const dropped = chunks.shift();
          queued -= dropped?.length ?? 0;
          offset = 0;
        }
      },
      pull: (out) => {
        let written = 0;
        while (written < out.length && chunks.length > 0) {
          const head = chunks[0];
          const count = Math.min(out.length - written, head.length - offset);
          out.set(head.subarray(offset, offset + count), written);
          written += count;
          offset += count;
          if (offset >= head.length) {
            chunks.shift();
            queued -= head.length;
            offset = 0;
          }
        }
        out.fill(0, written);
      },
      clear: () => {
        chunks.length = 0;
        offset = 0;
        queued = 0;
      },
      get size() {
        return queued - offset;
      }
    };
  };

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
  var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
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

  // node_modules/@openchamber/sdk/dist/navigation.js
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_WALKTHROUGH_BASE_MAX = 255;
  var guestNavigationCalls = (request, nextId2, refuse) => ({
    openCommit: (sha) => isGuestCommitSha(sha) ? request({ channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION, type: "open-commit", id: nextId2(), payload: { sha } }) : refuse("Commit id must be 7 to 64 hex characters."),
    openWalkthrough: ({ base }) => {
      const trimmed = base.trim();
      if (!trimmed || trimmed.length > GUEST_WALKTHROUGH_BASE_MAX)
        return refuse(`Base must contain 1 to ${GUEST_WALKTHROUGH_BASE_MAX} characters.`);
      return request({ channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION, type: "open-walkthrough", id: nextId2(), payload: { base: trimmed } });
    }
  });

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_BLOCK_ANSWER_MAX = 2e3;
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
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
    "generate-late",
    "microphone-audio",
    "microphone-ended"
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
    let microphone = null;
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
      if (message.type === "microphone-audio") {
        microphone?.queue.push(message.payload.samples);
        return;
      }
      if (message.type === "microphone-ended") {
        const open = microphone;
        if (!open)
          return;
        microphone = null;
        open.release();
        emit(open.endedListeners, message.payload.reason);
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
    const postMicrophoneClose = () => {
      if (!disposed && target.parent !== target)
        post({ ...envelope, type: "microphone-close", id: nextId(ids) });
    };
    const openMicrophone = async () => {
      if (microphone)
        throw new HostRequestError("HOST_REJECTED", "The microphone is already open in this frame.");
      if (lastReady?.features?.microphone !== true) {
        throw new HostRequestError("UNSUPPORTED", "This OpenChamber cannot share the microphone with extensions.");
      }
      const AudioContextCtor = globalThis.AudioContext;
      if (typeof AudioContextCtor !== "function")
        throw new HostRequestError("UNSUPPORTED", "This frame has no Web Audio.");
      const context = new AudioContextCtor();
      if (context.sampleRate < GUEST_MICROPHONE_SAMPLE_RATE_MIN || context.sampleRate > GUEST_MICROPHONE_SAMPLE_RATE_MAX) {
        void context.close().catch(() => void 0);
        throw new HostRequestError("UNSUPPORTED", `Audio at ${context.sampleRate} Hz is not supported.`);
      }
      const resumed = context.state === "suspended" ? context.resume().catch(() => void 0) : void 0;
      const queue = createSampleQueue(Math.round(context.sampleRate / 4));
      const processor = context.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event) => queue.pull(event.outputBuffer.getChannelData(0));
      const destination = context.createMediaStreamDestination();
      processor.connect(destination);
      const endedListeners = /* @__PURE__ */ new Set();
      const open = {
        queue,
        endedListeners,
        release: () => {
          processor.onaudioprocess = null;
          processor.disconnect();
          queue.clear();
          for (const track of destination.stream.getTracks())
            track.stop();
          void context.close().catch(() => void 0);
        }
      };
      microphone = open;
      try {
        const result = await send({ ...envelope, type: "microphone-open", id: nextId(ids), payload: { sampleRate: context.sampleRate } }, GUEST_MICROPHONE_OPEN_TIMEOUT_MS);
        if (!result || !("opened" in result) || result.opened !== true) {
          throw new HostRequestError("HOST_REJECTED", "Host did not open the microphone.");
        }
        await resumed;
        if (microphone !== open)
          throw new HostRequestError("DISCONNECTED", "The microphone closed while it was opening.");
      } catch (error) {
        if (microphone === open)
          microphone = null;
        open.release();
        postMicrophoneClose();
        throw error;
      }
      return {
        stream: destination.stream,
        close: () => {
          if (microphone !== open)
            return;
          microphone = null;
          open.release();
          postMicrophoneClose();
        },
        onEnded: (listener) => {
          endedListeners.add(listener);
          return () => {
            endedListeners.delete(listener);
          };
        }
      };
    };
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
      ...guestNavigationCalls(request, () => nextId(ids), (message) => Promise.reject(new HostRequestError("HOST_REJECTED", message))),
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
      openMicrophone,
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
        if (microphone) {
          postMicrophoneClose();
          microphone.release();
          microphone = null;
        }
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
    root2.style.setProperty("font-size", theme.tokens.fontSize ?? "0.875rem");
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
  var len = (px2) => `calc(${px2}rem / 14)`;
  var UI_SIZE_CSS = `
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${len(8)}; height: ${len(32)}; padding: 0 ${len(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${len(4)}; height: ${len(24)}; padding: 0 ${len(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${len(14)}; height: ${len(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${len(32)}; padding: 0 ${len(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${len(8)} ${len(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${len(34)}; padding-right: ${len(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${len(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${len(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${len(24)}; height: ${len(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${len(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${len(2)}; min-width: ${len(160)}; max-width: calc(100vw - ${len(16)}); max-height: min(${len(320)}, calc(100vh - ${len(16)})); overflow: auto; padding: ${len(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${len(2)} ${len(2)} ${len(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${len(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${len(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${len(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${len(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${len(14)}; height: ${len(14)}; margin-top: ${len(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${len(36)}; height: ${len(20)}; --oc-sdk-thumb-travel: ${len(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${len(2)}; left: ${len(2)}; width: ${len(16)}; height: ${len(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${len(2)}; padding: ${len(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${len(1)} ${len(6)}; font-size: ${len(11)}; font-weight: 500; line-height: ${len(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${len(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${len(16)} ${len(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${len(4)}; padding: ${len(40)} ${len(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${len(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${len(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${len(16)}; height: ${len(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${len(12)}; height: ${len(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${len(12)}; padding: ${len(8)} ${len(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${len(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${len(8)}; width: 100%; margin: ${len(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${len(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${len(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${len(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${len(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${len(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${len(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${len(36)}; height: ${len(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${len(44)}; }
  .oc-sdk-check { min-height: ${len(36)}; padding: ${len(8)} 0; }
}
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
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
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
    node.style.width = len(size);
    node.style.height = len(size);
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
        const current2 = ready.get();
        return current2 ? Promise.resolve(current2) : new Promise((resolve) => readyWaiters.push(resolve));
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
  var VIEWPORT_WIDTH_MIN = 200;
  var VIEWPORT_WIDTH_MAX = 3840;
  var VIEWPORT_HEIGHT_MIN = 200;
  var VIEWPORT_HEIGHT_MAX = 4320;
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
  var TEXT_EDIT_MAX = 5e3;
  var USER_UNDO_TTL_MS = 30 * 6e4;
  var TOKEN_PREVIEW_VALUE_PATTERN = /^[A-Za-z0-9 #%.,()+\-'"/]{1,100}$/;
  var SYSTEM_ID_PATTERN = SLUG_PATTERN;
  var SYSTEM_TOKEN_VALUE_MAX = 100;
  var SYSTEM_BYTES_MAX = 100 * 1024 * 1024;
  var SYSTEM_FONT_MAX_BYTES = 5 * 1024 * 1024;
  var SYSTEM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
  var SYSTEM_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
  var BINARY_UPLOAD_TOTAL_MAX = 28e6;
  var SCAN_TTL_MS = 10 * 6e4;
  var FOLDER_UNDO_MS = 60 * 6e4;
  var SYSTEM_BUILD_TICKET_PATTERN = /^sb_[a-z0-9]{12}$/;
  var SYSTEM_BUILD_TTL_MS = 7 * 864e5;
  var SYSTEM_MOTION_DURATION_MAX_MS = 1e4;
  var SYSTEM_MOTION_STEPS_MAX = 100;
  var LIVING_PAGE_MAX_BYTES = 20 * 1024 * 1024;
  var LIVING_PAGE_ASSET_MAX_BYTES = 4 * 1024 * 1024;
  var SCAN_JSON_MAX_BYTES = 2 * 1024 * 1024;
  var SYSTEM_PROPOSAL_ID_PATTERN = /^p_[a-z0-9]{8,16}$/;
  var SYSTEM_PROPOSAL_FILES_MAX = 200;
  var SYSTEM_ASK_POLL_MS = 5e3;
  var SYSTEM_ASK_CALLS_MAX = 8;
  var SYSTEM_ASK_WHY_MAX = 300;
  var SYSTEM_ASK_PROPOSED_MAX = 200;
  var FILE_PAGE_COPY_MAX_BYTES = 50 * 1024 * 1024;

  // src/shared/agent/context.ts
  var VIEWPORT_TABLET = Object.freeze({ id: "tablet", label: "Tablet", width: 768, height: 1024 });
  var VIEWPORT_DESKTOP = Object.freeze({ id: "desktop", label: "Desktop", width: 1440, height: 900 });

  // src/shared/types.ts
  var CHIP_PROVIDER_ID = "design-chamber";

  // src/ui/model/device-model.ts
  var PX_MAX = 400;
  var NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
  var DESKTOP_DEVICE = { form: "desktop", coarse: false, insets: NO_INSETS, keyboard: 0 };
  var record = (value) => typeof value === "object" && value !== null ? value : {};
  var px = (value) => typeof value === "number" && Number.isFinite(value) ? Math.min(PX_MAX, Math.max(0, Math.round(value))) : 0;
  var deviceOf = (context) => {
    const raw = record(context.device);
    const { formFactor, pointer } = raw;
    if (formFactor !== "phone" && formFactor !== "tablet" && formFactor !== "desktop") return DESKTOP_DEVICE;
    if (pointer !== "coarse" && pointer !== "fine") return DESKTOP_DEVICE;
    const insets = record(raw.insets);
    return {
      form: formFactor,
      coarse: pointer === "coarse",
      insets: { top: px(insets.top), right: px(insets.right), bottom: px(insets.bottom), left: px(insets.left) },
      keyboard: px(raw.keyboard)
    };
  };
  var TIP_TITLE = "Open Design Chamber full screen";
  var openHelp = (device2, panelOnPhone) => {
    if (device2.form !== "phone") {
      return {
        notHere: "Open Design Chamber from the rail to see it.",
        serviceDown: "Design Chamber isn\u2019t responding.",
        fullScreenHint: "Full screen: sidebar \u2192 Extension pages \u2192 Design Chamber",
        firstRunTip: { title: TIP_TITLE, body: "In the sidebar, open Extension pages and pick Design Chamber. Canvases get the whole window there." }
      };
    }
    const serviceDown = "Design Chamber isn\u2019t responding on your computer. Try again in a moment.";
    if (!panelOnPhone) return { notHere: "Open Design Chamber from the More menu in your chats list.", serviceDown, fullScreenHint: null, firstRunTip: null };
    return {
      notHere: "Design Chamber can\u2019t open here yet. Open it from the More menu in your chats list.",
      serviceDown,
      fullScreenHint: "Full screen: chats list \u2192 More \u2192 Design Chamber",
      firstRunTip: { title: TIP_TITLE, body: "In your chats list, open More and pick Design Chamber." }
    };
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
    "POST /pages/from-file": "WP3",
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
    "POST /system-stops/:undoId/undo": "P25",
    "POST /memberships": "P26",
    "POST /systems/register": "P26",
    "PUT /view": "UP",
    // system-builder-depth Phase 2 (§13 T12a)
    "GET /systems/:id/screens/render": "SBD",
    "GET /systems/:id/screens/render/chunk": "SBD",
    // system-builder-depth Phase 3 (§13 T19, T20)
    "GET /systems/:id/export": "SBD3",
    "POST /systems/:id/export": "SBD3",
    "GET /systems/:id/comments": "SBD3",
    "POST /systems/:id/comments": "SBD3",
    "PATCH /systems/:id/comments/:commentId": "SBD3",
    "DELETE /systems/:id/comments/:commentId": "SBD3",
    "POST /systems/:id/comments/mark-sent": "SBD3"
  };
  var ROUTE_KEYS = Object.keys(ROUTE_OWNERS);
  var RAW_TEXT_ROUTES = /* @__PURE__ */ new Set([
    "GET /designs/:slug/render/chunk",
    "GET /systems/:id/board/chunk",
    "GET /systems/:id/living-page/render/chunk",
    // system-builder-depth Phase 2 (§13 T12a)
    "GET /systems/:id/screens/render/chunk"
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
    const fetchSystemScreen = async (id, screen, options2) => {
      const query = { screen, scheme: options2.scheme ?? "light" };
      if (options2.version) query.version = options2.version;
      if (options2.proposal) query.proposal = options2.proposal;
      const meta = await call("GET /systems/:id/screens/render", { params: { id }, query });
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
        (n) => call("GET /systems/:id/screens/render/chunk", { params: { id }, query: { key: meta.key, n: String(n) } })
      );
      const doc = { meta, html: parts.join("") };
      remember(doc);
      return doc;
    };
    const systemScreen = (id, screen, options2 = {}) => {
      const key = `screen\0${id}\0${screen}\0${options2.version ?? ""}\0${options2.proposal ?? ""}\0${options2.scheme ?? "light"}`;
      const running = inflight.get(key);
      if (running) return running;
      const task = (async () => {
        try {
          return await fetchSystemScreen(id, screen, options2);
        } catch (error) {
          if (isServiceError(error, "stale")) return fetchSystemScreen(id, screen, options2);
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
    const systemExportFormats = (systemId) => call("GET /systems/:id/export", { params: { id: systemId } });
    const exportSystemTokens = (systemId, formats) => call("POST /systems/:id/export", { params: { id: systemId }, body: formats === void 0 ? {} : { formats } });
    const systemComments = {
      list: (systemId) => call("GET /systems/:id/comments", { params: { id: systemId } }),
      add: (systemId, body) => call("POST /systems/:id/comments", { params: { id: systemId }, body }),
      update: (systemId, commentId, patch) => call("PATCH /systems/:id/comments/:commentId", { params: { id: systemId, commentId }, body: patch }),
      remove: (systemId, commentId) => call("DELETE /systems/:id/comments/:commentId", { params: { id: systemId, commentId } }),
      markSent: (systemId, ids) => call("POST /systems/:id/comments/mark-sent", { params: { id: systemId }, body: { ids } })
    };
    return { call, loadRender, loadBoard, systemScreen, upload, uploadBinary, thumbnail, getProposal, stopBuild, undoStop, loadLivingPage, systemExportFormats, exportSystemTokens, systemComments };
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

  // src/shared/tokens-css.ts
  var isBalancedQuotes = (value) => {
    let single = 0;
    let double = 0;
    for (const char of value) {
      if (char === "'") single += 1;
      else if (char === '"') double += 1;
    }
    return single % 2 === 0 && double % 2 === 0;
  };

  // src/shared/source-edit.ts
  var NAMED_REFS = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\xA0",
    copy: "\xA9",
    reg: "\xAE",
    // The mdash value is decode data (the character &mdash; names), not copy; written as a code
    // point so the KI-7 copy guard, which reads every string literal, stays unbroken.
    trade: "\u2122",
    hellip: "\u2026",
    mdash: String.fromCharCode(8212),
    ndash: "\u2013",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201C",
    rdquo: "\u201D",
    laquo: "\xAB",
    raquo: "\xBB",
    bull: "\u2022",
    middot: "\xB7",
    times: "\xD7",
    divide: "\xF7",
    deg: "\xB0",
    plusmn: "\xB1",
    euro: "\u20AC",
    pound: "\xA3",
    yen: "\xA5",
    cent: "\xA2",
    sect: "\xA7",
    para: "\xB6",
    shy: "\xAD"
  };

  // src/ui/components/device.ts
  var current = DESKTOP_DEVICE;
  var applyDevice = (device2, root2) => {
    current = device2;
    root2.dataset.dcForm = device2.form;
    root2.dataset.dcPointer = device2.coarse ? "coarse" : "fine";
    root2.dataset.dcKeyboard = device2.keyboard > 0 ? "up" : "down";
    for (const side of ["top", "right", "bottom", "left"]) root2.style.setProperty(`--dc-inset-${side}`, `${device2.insets[side]}px`);
    root2.style.setProperty("--dc-keyboard", `${device2.keyboard}px`);
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
    // A cog: the Settings control on both surfaces (Phase 2.6 L1a replaces the sliders glyph).
    gear: ["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
    // The library's view toggle: four squares, and three lines with leading dots.
    tiles: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"],
    list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
    lock: ["M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z", "M8 11V8a4 4 0 0 1 8 0v3"],
    info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 11v5", "M12 8h.01"],
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
    // A branch: a design system that lives in a project's repo.
    repo: ["M6 3v12", "M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M18 9a9 9 0 0 1-9 9"],
    // A right chevron: a heading that opens a list.
    "chevron-right": ["m9 6 6 6-6 6"],
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

  // src/shared/design-json.ts
  var VIEWPORT_LAPTOP = Object.freeze({ id: "laptop", label: "Laptop", width: 1280, height: 800 });
  var VIEWPORT_PHONE = Object.freeze({ id: "phone", label: "Phone", width: 390, height: 844 });
  var CANONICAL_ORDER = [
    "version",
    "kind",
    "title",
    "created",
    "updated",
    "brief",
    "sessionId",
    "projectDirectory",
    "preset",
    "entry",
    "viewports",
    "screens",
    "designSystem",
    "tweaks",
    "systemChoice",
    "folderRequest",
    "comments"
  ];
  var KNOWN_FIELDS = new Set(CANONICAL_ORDER);

  // src/shared/token-edit.ts
  var PLAIN_SHAPE = "Use a plain CSS value of up to 100 characters, without ; { } < > \\ : or *, and without url().";
  var SECTION_SHAPES = {
    colours: "Use a colour, like #1a73e8, rgb(26 115 232) or a colour name.",
    spacing: "Use a length, like 16px or 1rem.",
    radius: "Use a length, like 8px or 0.5rem.",
    sizes: "Use a size, like 1200px or 40rem, or a plain number.",
    shadows: "Use a shadow, like 0 1px 2px rgb(0 0 0 / 0.2), or none.",
    layers: "Use a whole number, like 10, or auto.",
    typography: PLAIN_SHAPE,
    motion: "Use a time, like 200ms or 0.2s, or an easing, like ease-out, cubic-bezier(0.2, 0, 0, 1) or steps(4, end).",
    other: PLAIN_SHAPE
  };
  var FIELD_SHAPES = {
    family: 'Use font names separated by commas, like "Inter", sans-serif.',
    size: "Use a size, like 16px or 1rem, or normal.",
    weight: "Use a weight from 1 to 1000, or normal or bold.",
    lineHeight: "Use a number like 1.5, a length, or normal.",
    letterSpacing: "Use a length, like 0.02em, or normal."
  };
  var ALLOWED_FUNCTIONS = /* @__PURE__ */ new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "var", "calc", "min", "max", "clamp"]);
  var FORMULA_PATTERN = /(?:^|[^A-Za-z0-9-])(?:var|calc|min|max|clamp|color-mix)\(/i;
  var MOTION_FUNCTIONS = /* @__PURE__ */ new Set(["cubic-bezier", "steps"]);
  var passesRuleOne = (text, extra) => {
    if (text.length < 1 || text.length > SYSTEM_TOKEN_VALUE_MAX || !TOKEN_PREVIEW_VALUE_PATTERN.test(text) || !isBalancedQuotes(text)) return false;
    let depth = 0;
    for (const char of text) {
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth < 0) return false;
      }
    }
    if (depth !== 0) return false;
    for (const match of text.matchAll(/([A-Za-z-][A-Za-z0-9-]*)?\(/g)) {
      const name = match[1];
      if (name !== void 0 && !ALLOWED_FUNCTIONS.has(name.toLowerCase()) && extra?.has(name.toLowerCase()) !== true) return false;
    }
    return true;
  };
  var NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
  var NUMBER_PATTERN = new RegExp(`^${NUMBER}$`);
  var SPACING_UNITS = ["px", "rem", "em", "%", "vw", "vh", "vmin", "vmax", "svh", "dvh", "lvh", "ch", "ex"];
  var ALL_LENGTH_UNITS = [
    ...SPACING_UNITS,
    "cm",
    "mm",
    "q",
    "in",
    "pt",
    "pc",
    "lh",
    "rlh",
    "cap",
    "ic",
    "rex",
    "rch",
    "ric",
    "rcap",
    "vi",
    "vb",
    "svw",
    "svi",
    "svb",
    "lvw",
    "lvi",
    "lvb",
    "dvw",
    "dvi",
    "dvb",
    "cqw",
    "cqh",
    "cqi",
    "cqb",
    "cqmin",
    "cqmax"
  ];
  var lengthPattern = (units) => new RegExp(`^(?:[+-]?0|${NUMBER}(?:${units.join("|")}))$`, "i");
  var SPACING_LENGTH = lengthPattern(SPACING_UNITS);
  var ANY_LENGTH = lengthPattern(ALL_LENGTH_UNITS);
  var INTEGER = /^[+-]?\d+$/;
  var NAMED_COLOURS = new Set(
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor".split(" ")
  );
  var HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var COLOUR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/i;
  var COLOUR_SPACES = /* @__PURE__ */ new Set(["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65"]);
  var COLOUR_ARGUMENT = new RegExp(`^(?:${NUMBER}(?:%|deg|rad|grad|turn)?|none)$`, "i");
  var isColour = (text) => {
    if (HEX_COLOUR.test(text) || NAMED_COLOURS.has(text.toLowerCase())) return true;
    const match = COLOUR_FUNCTION.exec(text);
    if (match === null) return false;
    const name = (match[1] ?? "").toLowerCase();
    const args = (match[2] ?? "").trim().split(/[\s,/]+/).filter((part) => part !== "");
    if (name === "color") {
      const space = args.shift();
      if (space === void 0 || !COLOUR_SPACES.has(space.toLowerCase())) return false;
    }
    return args.length >= 3 && args.length <= 4 && args.every((arg) => COLOUR_ARGUMENT.test(arg));
  };
  var splitTop = (text, separator) => {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current2 = "";
    for (const char of text) {
      if (quote !== null) {
        if (char === quote) quote = null;
        current2 += char;
      } else if (char === '"' || char === "'") {
        quote = char;
        current2 += char;
      } else if (char === "(") {
        depth += 1;
        current2 += char;
      } else if (char === ")") {
        depth -= 1;
        current2 += char;
      } else if (depth === 0 && separator.test(char)) {
        if (current2.trim() !== "") parts.push(current2.trim());
        current2 = "";
      } else current2 += char;
    }
    if (current2.trim() !== "") parts.push(current2.trim());
    return parts;
  };
  var isShadow = (text, needsPair) => {
    if (text.toLowerCase() === "none") return !needsPair;
    const layers = splitTop(text, /,/);
    if (layers.length === 0) return false;
    return layers.every((layer) => {
      let lengths = 0;
      let colours = 0;
      let insets = 0;
      for (const part of splitTop(layer, /\s/)) {
        if (part.toLowerCase() === "inset") insets += 1;
        else if (ANY_LENGTH.test(part)) lengths += 1;
        else if (isColour(part)) colours += 1;
        else return false;
      }
      return lengths >= 2 && lengths <= 4 && colours <= 1 && insets <= 1;
    });
  };
  var isLayer = (text) => {
    if (text.toLowerCase() === "auto") return true;
    if (!INTEGER.test(text)) return false;
    const value = Number(text);
    return value >= -2147483647 && value <= 2147483647;
  };
  var TIME = new RegExp(`^(${NUMBER})(ms|s)$`, "i");
  var EASING_KEYWORDS = /* @__PURE__ */ new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
  var CUBIC_BEZIER = new RegExp(`^cubic-bezier\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)$`, "i");
  var STEPS = /^steps\(\s*(\d{1,4})\s*(?:,\s*(start|end)\s*)?\)$/i;
  var isTime = (text) => {
    const match = TIME.exec(text);
    if (match === null) return false;
    const ms = Number(match[1]) * ((match[2] ?? "").toLowerCase() === "s" ? 1e3 : 1);
    return Number.isFinite(ms) && ms >= 0 && ms <= SYSTEM_MOTION_DURATION_MAX_MS;
  };
  var isEasing = (text) => {
    if (EASING_KEYWORDS.has(text.toLowerCase())) return true;
    const bezier = CUBIC_BEZIER.exec(text);
    if (bezier !== null) {
      const [x1, y1, x2, y2] = bezier.slice(1, 5).map(Number);
      if (x1 === void 0 || y1 === void 0 || x2 === void 0 || y2 === void 0) return false;
      return [x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1;
    }
    const steps = STEPS.exec(text);
    if (steps === null) return false;
    const count = Number(steps[1]);
    return count >= 1 && count <= SYSTEM_MOTION_STEPS_MAX;
  };
  var isMotionValue = (text) => isTime(text) || isEasing(text);
  var EASING_CURVES = Object.freeze({
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1]
  });
  var MOTION_NAME = /^--(?:duration|ease|motion)-/i;
  var FAMILY_NAME = /^(?:"[^"]+"|'[^']+'|[A-Za-z-][A-Za-z0-9-]*(?: +[A-Za-z-][A-Za-z0-9-]*)*)$/;
  var fieldValid = (field2, text) => {
    const lower = text.toLowerCase();
    switch (field2) {
      case "family": {
        const names = text.split(",").map((name) => name.trim());
        return names.length > 0 && names.every((name) => FAMILY_NAME.test(name));
      }
      case "size":
      case "letterSpacing":
        return lower === "normal" || ANY_LENGTH.test(text);
      case "weight": {
        if (lower === "normal" || lower === "bold" || lower === "lighter" || lower === "bolder") return true;
        if (!NUMBER_PATTERN.test(text)) return false;
        const weight = Number(text);
        return weight >= 1 && weight <= 1e3;
      }
      case "lineHeight":
        return lower === "normal" || NUMBER_PATTERN.test(text) && Number(text) >= 0 || ANY_LENGTH.test(text);
    }
  };
  var sectionValid = (section, text) => {
    switch (section) {
      case "colours":
        return isColour(text);
      case "spacing":
        return SPACING_LENGTH.test(text);
      case "radius":
        return ANY_LENGTH.test(text);
      case "sizes":
        return SPACING_LENGTH.test(text) || NUMBER_PATTERN.test(text);
      case "shadows":
        return isShadow(text, false);
      case "layers":
        return isLayer(text);
      case "motion":
        return isMotionValue(text);
      case "typography":
      case "other":
        return true;
    }
  };
  var validateTokenValue = (section, field2, text) => {
    const shape = field2 === null ? SECTION_SHAPES[section] : FIELD_SHAPES[field2];
    if (!passesRuleOne(text, field2 === null && section === "motion" ? MOTION_FUNCTIONS : void 0)) return { ok: false, sentence: shape };
    if (FORMULA_PATTERN.test(text)) return { ok: true, formula: true };
    const valid = field2 === null ? sectionValid(section, text) : fieldValid(field2, text);
    return valid ? { ok: true, formula: false } : { ok: false, sentence: shape };
  };
  var classifyToken = (name, value) => {
    const text = value.trim();
    const lower = name.toLowerCase();
    if (MOTION_NAME.test(name) && (text === "" || FORMULA_PATTERN.test(text) || isMotionValue(text))) return "motion";
    if (isColour(text)) return "colours";
    if (isShadow(text, true)) return "shadows";
    if (/radius|rounded/.test(lower)) return "radius";
    if (/(^--z-|z-?index|layer|stack)/.test(lower) && INTEGER.test(text)) return "layers";
    if (/space|spacing|gap|gutter|pad|margin|inset/.test(lower) && SPACING_LENGTH.test(text)) return "spacing";
    if (/font|family|text-|leading|line-height|tracking|letter|weight|^--fs-/.test(lower)) return "typography";
    if (/size|width|height|breakpoint|^--bp-|screen|container/.test(lower) && ANY_LENGTH.test(text)) return "sizes";
    return "other";
  };
  var DARK_MEDIA = "@media(prefers-color-scheme:dark)";
  var normaliseAtRule = (prelude) => prelude.toLowerCase().replace(/\s*([():,])\s*/g, "$1").replace(/\s+/g, " ").trim();
  var normaliseSelector = (selector) => selector.toLowerCase().replace(/\s+/g, " ").replace(/\[\s*([a-z0-9_-]+)\s*=\s*(["']?)([a-z0-9_-]+)\2\s*\]/g, "[$1=$3]").trim();
  var selectorList = (prelude) => prelude.split(",").map(normaliseSelector);
  var LIGHT_EXTRACTION = /* @__PURE__ */ new Set([":root", "html", ":host", ".light", "[data-theme=light]"]);
  var DARK_TOP_EXTRACTION = /* @__PURE__ */ new Set([".dark", ":root.dark", "html.dark", "[data-theme=dark]", ":root[data-theme=dark]", "[data-mode=dark]"]);
  var partsOf = (ctx2) => ctx2.kind === "root" ? { atRules: [], selectors: [":root"] } : { atRules: ctx2.atRules ?? [], selectors: ctx2.selectors ?? [] };
  var isLightParts = (atRules, selectors, rules) => {
    const [selector] = selectors;
    if (atRules.length === 0 && selectors.length === 1 && selector !== void 0) {
      const list = selectorList(selector);
      return rules === "system" ? list.length === 1 && list[0] === ":root" : list.every((one) => LIGHT_EXTRACTION.has(one));
    }
    const [atRule] = atRules;
    return rules === "extraction" && atRules.length === 1 && selectors.length === 0 && atRule !== void 0 && normaliseAtRule(atRule) === "@theme";
  };
  var isDarkParts = (atRules, selectors, rules) => {
    const [selector] = selectors;
    const [atRule] = atRules;
    if (selectors.length !== 1 || selector === void 0) return false;
    const list = selectorList(selector);
    if (atRules.length === 1 && atRule !== void 0 && normaliseAtRule(atRule) === DARK_MEDIA) {
      return rules === "system" ? list.length === 1 && list[0] === ":root" : list.every((one) => one === ":root" || one === "html");
    }
    return rules === "extraction" && atRules.length === 0 && list.every((one) => DARK_TOP_EXTRACTION.has(one));
  };
  var isLightContext = (ctx2, rules) => {
    if (ctx2.kind === "root") return true;
    const { atRules, selectors } = partsOf(ctx2);
    return isLightParts(atRules, selectors, rules);
  };
  var isDarkContext = (ctx2, rules) => {
    if (ctx2.kind === "root") return false;
    const { atRules, selectors } = partsOf(ctx2);
    return isDarkParts(atRules, selectors, rules);
  };
  var TOKEN_UNDO_REMOVED_MAX = TEXT_EDIT_MAX * 8;

  // src/shared/system-checklist.ts
  var SYSTEM_TOPIC_IDS = Object.freeze([
    "surface",
    "text",
    "border",
    "brand",
    "status",
    "type-styles",
    "spacing",
    "radius",
    "pairs",
    "dark-values",
    "state-colours",
    "data-colours",
    "control-sizes",
    "breakpoints",
    "elevation",
    "layers",
    "motion",
    "components",
    "examples",
    "focus-disabled",
    "voice",
    "navigation",
    "overlays",
    "forms",
    "feedback",
    "states",
    "data-display",
    "accessibility",
    "responsive",
    "logo",
    "brand-colour",
    "imagery",
    "marketing",
    // system-builder-depth Phase 2 (T11): a full system's foundations ask for at least one icon.
    "icons"
  ]);
  var TOPIC_SET = new Set(SYSTEM_TOPIC_IDS);
  var CHECKLIST_MIN = Object.freeze({ status: 3, typeStylesCore: 4, typeStylesFull: 6, spacing: 4 });
  var TOPICS = Object.freeze({
    foundations: {
      core: ["surface", "text", "border", "brand", "status", "type-styles", "spacing", "radius", "pairs", "dark-values"],
      full: ["state-colours", "data-colours", "control-sizes", "breakpoints", "elevation", "layers", "motion", "icons"]
    },
    components: { core: ["components", "examples"], full: ["focus-disabled"] },
    patterns: { core: ["voice"], full: ["navigation", "overlays", "forms", "feedback", "states", "data-display", "accessibility", "responsive", "motion"] },
    brand: { core: ["logo"], full: ["brand-colour", "imagery", "marketing"] }
  });
  var PATTERN_KIND_TOPIC = Object.freeze({
    voice: "voice",
    navigation: "navigation",
    overlays: "overlay",
    forms: "forms",
    feedback: "feedback",
    states: "states",
    "data-display": "data-display",
    accessibility: "accessibility",
    responsive: "responsive"
  });

  // src/shared/system-json.ts
  var AREA_OF_SECTION = Object.freeze({
    overview: "foundations",
    colours: "foundations",
    typography: "foundations",
    spacing: "foundations",
    radius: "foundations",
    shadows: "foundations",
    // system-builder-depth Phase 2 (§13 T10a): after shadows, in board order.
    motion: "foundations",
    layers: "foundations",
    sizes: "foundations",
    components: "components",
    patterns: "patterns",
    brand: "brand",
    assets: "brand"
  });
  var SYSTEM_AREAS = Object.freeze(["foundations", "components", "patterns", "brand"]);
  var SYSTEM_SECTIONS = Object.freeze(Object.keys(AREA_OF_SECTION));
  var RESERVED_SYSTEM_IDS = Object.freeze(["none", "ask"]);
  var SYSTEM_UNREADABLE_PREFIX = "Design Chamber can't read this design system.";
  var NOT_JSON = `${SYSTEM_UNREADABLE_PREFIX} system.json isn't valid JSON.`;
  var TOO_LARGE_JSON = `${SYSTEM_UNREADABLE_PREFIX} system.json is larger than 1 MB.`;
  var BOARD_LAYOUTS = Object.freeze(["card", "compact", "full", "table"]);
  var LAYOUTS_OF_SECTION = Object.freeze({
    components: BOARD_LAYOUTS,
    overview: BOARD_LAYOUTS,
    patterns: BOARD_LAYOUTS,
    brand: BOARD_LAYOUTS,
    colours: Object.freeze(["card", "compact", "table"]),
    spacing: Object.freeze(["card", "compact", "table"]),
    radius: Object.freeze(["card", "compact", "table"]),
    shadows: Object.freeze(["card", "compact", "table"]),
    // system-builder-depth Phase 2 (§13 T10a).
    motion: Object.freeze(["card", "compact", "table"]),
    sizes: Object.freeze(["card", "compact", "table"])
  });
  var SECTION_LAYOUT_ALIASES = Object.freeze({ notes: "overview" });
  var SYSTEM_TOKEN_RULES = Object.freeze({
    isLight: (ctx2) => isLightContext(ctx2, "system"),
    isDark: (ctx2) => isDarkContext(ctx2, "system"),
    classify: classifyToken,
    validate: validateTokenValue
  });
  var ENTRY_KINDS = Object.freeze({
    patterns: Object.freeze([
      "layout",
      "do-dont",
      "voice",
      "other",
      "navigation",
      "overlay",
      "forms",
      "data-display",
      "feedback",
      "states",
      "page",
      "responsive",
      "motion",
      "accessibility"
    ]),
    brand: Object.freeze(["marketing", "imagery", "logo-use", "other", "colour", "social", "email"])
  });
  var VIEWPORT_SENTENCE = `Each viewport needs an id (letters, digits, - or _), and a whole-number width from ${VIEWPORT_WIDTH_MIN} to ${VIEWPORT_WIDTH_MAX} and height from ${VIEWPORT_HEIGHT_MIN} to ${VIEWPORT_HEIGHT_MAX}.`;
  var BUILD_PLATFORMS = Object.freeze(["laptop-phone", "phone-first", "laptop", "custom"]);
  var PROPOSAL_TOO_MANY_FILES = `PROPOSAL.json lists more than ${SYSTEM_PROPOSAL_FILES_MAX} files. Ask the agent to split the change.`;

  // src/shared/checks.ts
  var num = (value, digits = 0) => value === void 0 ? "?" : digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
  var fileOf = (f) => f.file ?? "This design";
  var skippedSentence = (f) => {
    const count = Math.round(f.params?.count ?? 0);
    if (f.file === "board.html") {
      const passes = count === 1 ? "1 board pass was" : `${count} board passes were`;
      if (f.params?.reason === "failures") return `${passes} not drawn (the browser failed three times in a row).`;
      return `${passes} not drawn (the check ran out of time). Check again with --area <area> or --scheme dark.`;
    }
    if (f.file !== null && f.file.startsWith("screens/")) {
      const screens = count === 1 ? "1 screen artboard was" : `${count} screen artboards were`;
      const why = f.params?.reason === "failures" ? "the browser failed three times in a row" : f.params?.reason === "budget" ? "the check ran out of time" : `the limit is ${num(f.params?.max)} per check`;
      return `${screens} not drawn (${why}). Use --screen <id> to check the rest.`;
    }
    const what = `${count} ${count === 1 ? "artboard was" : "artboards were"} not rendered`;
    if (f.params?.reason === "budget") return `${what} (the run took longer than ${Math.round(CHECK_RUN_BUDGET_MS / 1e3)} seconds).`;
    if (f.params?.reason === "failures") return `${what} (the browser failed three times in a row).`;
    return `${what} (the limit is ${num(f.params?.max)} per run). Use --screen <id> to check the rest.`;
  };
  var systemNameOf = (f) => f.params?.system ?? "the design system";
  var repoNameOf = (f) => f.params?.repo ?? "the repo";
  var DEPTH_LABELS = { tokens: "tokens only", core: "product core", full: "full" };
  var LISTED_SINGULAR = { variants: "variant", sizes: "size", states: "state" };
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
    "applied-unknown-proposal": (f) => `The agent says it applied a proposal you didn't approve here. Check ${repoNameOf(f)}'s history.`,
    "existing-outside-project": () => "The existing system folder is outside the project it was found in; it was ignored."
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
    },
    // Board layout hints and the visual system check (documentation/specs/system-board-layout-and-visual-check.md §B.6).
    "system-layout-invalid": {
      severity: "warning",
      sentence: (f) => {
        const count = Math.round(f.params?.count ?? 0);
        const misplaced = Math.min(count, Math.round(f.params?.misplaced ?? 0));
        const tail = "so those entries use the default. Each one listed says what its place takes.";
        if (misplaced === 0) return `system.json asks for ${num(count)} board layouts Design Chamber doesn't know, ${tail}`;
        if (misplaced === count) return `system.json asks for ${num(count)} board layouts in places that don't take them, ${tail}`;
        return `system.json asks for ${num(count)} board layouts it can't use (${num(count - misplaced)} Design Chamber doesn't know, ${num(misplaced)} in places that don't take them), ${tail}`;
      }
    },
    "system-board-overflow": {
      severity: "warning",
      sentence: (f, where) => `${where}: the board is ${num(f.params?.px)}px wide, wider than the ${num(f.params?.width)}px it has, so it scrolls sideways.`
    },
    "system-board-preview-wide": {
      severity: "warning",
      sentence: (f, where) => `${where}: this example is ${num(f.params?.px)}px wide but the board can give it ${num(f.params?.width)}px, so it scrolls sideways in its card.`
    },
    "system-board-preview-outside": {
      severity: "warning",
      sentence: (f, where) => `${where}: part of this example sits ${num(f.params?.px)}px outside its card, so it's cut off or covers other entries.`
    },
    "system-board-text-outside": {
      severity: "warning",
      sentence: (f, where) => `${where}: text runs ${num(f.params?.px)}px outside its card.`
    },
    "system-board-hint-small": {
      severity: "info",
      sentence: (f, where) => `${where}: this entry is set to ${f.params?.layout ?? "card"} but needed the full width. Set its layout to full.`
    },
    // system-builder-depth §4.5: what the files say about completeness, labels and contrast.
    "system-example-missing": {
      // Info for a core system, a warning for a full one: `severityOf` reads the validated `depth` param.
      severity: "info",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        return count === 1 ? "1 entry has no live example yet, so the board shows only its words." : `${num(count)} entries have no live example yet, so the board shows only their words.`;
      }
    },
    "system-states-missing": {
      severity: "warning",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        const listed = f.params?.listed ?? "states";
        const what = count === 1 ? `1 ${LISTED_SINGULAR[listed]} listed in system.json has` : `${num(count)} ${listed} listed in system.json have`;
        return `${what} no labelled instance in ${count === 1 ? "its" : "their"} example. Label each one with data-dc-${LISTED_SINGULAR[listed]}.`;
      }
    },
    "system-contrast-low": {
      severity: "warning",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        const scheme = f.params?.scheme === "dark" ? "dark" : "light";
        return count === 1 ? `1 colour pair is under its contrast level on the ${scheme} scheme.` : `${num(count)} colour pairs are under their contrast level on the ${scheme} scheme.`;
      }
    },
    "system-coverage-gap": {
      // Info for a core system, a warning for a full one, as `system-example-missing`.
      severity: "info",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        return `${AREA_LABELS[f.params?.area ?? "foundations"]} is missing ${count === 1 ? "1 thing" : `${num(count)} things`} a ${DEPTH_LABELS[f.params?.depth ?? "core"]} system covers.`;
      }
    },
    // ---- system-builder-depth Phase 2, Wave 0 (§13 T10a, T11): nothing raises these yet ----
    "system-motion-no-reduced": {
      severity: "warning",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        return count === 1 ? "1 example moves but has no prefers-reduced-motion rule." : `${num(count)} examples move but have no prefers-reduced-motion rule.`;
      }
    },
    "system-icons-mixed": {
      severity: "info",
      sentence: () => "The icons mix viewBox sizes or stroke widths, so they may not look like one set."
    },
    // ---- end system-builder-depth Phase 2 ----
    // ---- system-builder-depth Phase 3 (§13 T16): `count` is the states in this example that changed nothing ----
    "system-state-unstyled": {
      severity: "warning",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        const base = count === 1 ? "The example labels a state its CSS doesn't style: forced on the element, it changes nothing you can see. Style it, or remove the label." : `The example labels ${num(count)} states its CSS doesn't style: forced on the element, they change nothing you can see. Style them, or remove the labels.`;
        const hint = f.params?.hint;
        const rest = hint === "rest" || hint === "both" ? ' There is no resting copy beside the labelled one to force the state on: add one labelled data-dc-state="rest" with the same variant and size.' : "";
        const focus = hint === "focus-visible" || hint === "both" ? " It is labelled focus but its CSS styles :focus-visible: label it focus-visible, or style :focus too." : "";
        return `${base}${rest}${focus}`;
      }
    },
    // T18: `px` = the source's width when no viewport matches; `reason` limit or budget with `count` (and `max`); neither = unreadable.
    "system-compare-skipped": {
      severity: "info",
      sentence: (f) => {
        const count = Math.max(1, Math.round(f.params?.count ?? 1));
        const sheets = count === 1 ? "1 compare sheet was" : `${num(count)} compare sheets were`;
        if (f.params?.reason === "limit") return `${sheets} not made (the limit is ${num(f.params.max)} per check). Use --screen <id> to compare the rest.`;
        if (f.params?.reason === "budget" || f.params?.reason === "failures") return `${sheets} not made (the check ran out of time). Use --screen <id> to compare the rest.`;
        if (f.params?.px !== void 0) return `The source picture is ${num(f.params.px)} px wide; no viewport of this screen matches. Save a screenshot as wide as one of its viewports.`;
        return "The source picture can't be read as a PNG or JPEG, so no compare sheet was made.";
      }
    },
    // ---- end system-builder-depth Phase 3 ----
    "system-board-partial": {
      severity: "info",
      sentence: (f) => {
        const count = Math.round(f.params?.count ?? 0);
        const areas = count === 1 ? "1 area" : `${num(count)} areas`;
        const its = count === 1 ? "its" : "their";
        switch (f.params?.pictured) {
          case "entries":
            return `Only the first ${num(f.params?.max)} entries were measured.`;
          case "motion":
            if (count === 0) return "No motion strip was taken: the check ran out of time for them.";
            return count === 1 ? "Only the first motion strip was taken; the other moving elements were not pictured." : `Only the first ${num(count)} motion strips were taken; the other moving elements were not pictured.`;
          case "states":
            if (count === 0) return "No labelled state was forced and pictured: the check ran out of time for them.";
            return count === 1 ? "Only the first labelled state was forced and pictured; the others were not checked." : `Only the first ${num(count)} labelled states were forced and pictured; the others were not checked.`;
          case "gap":
            return `${count === 1 ? "Part of 1 area is" : `Parts of ${areas} are`} in no picture (the picture limit for one check); the parts are listed. All of the board was measured, so the findings cover them.`;
          case "no-overview":
            return `${areas} ${count === 1 ? "has" : "have"} no overview picture (it couldn't be made); ${its} full-size pictures show all of ${count === 1 ? "it" : "them"}.`;
          case "overview":
            return `The overview of ${areas} stops early; ${its} full-size pictures show the rest, and all of the board was measured.`;
          default:
            return `${areas} ${count === 1 ? "has" : "have"} full-size pictures for only part of ${its} length (the picture limit for one check); ${its} overview shows the rest, and all of the board was measured.`;
        }
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
  var commentOffered = (device2, panelOnPhone) => device2.form !== "phone" || panelOnPhone;
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
    let current2 = { phase: "open", picked: null, sending: null };
    const phase = () => current2.phase;
    const set = (next) => {
      current2 = next;
      onChange(next);
    };
    return {
      state: () => current2,
      pick: async (index) => {
        const option = options[index];
        if (current2.phase !== "open" || option === void 0) return "ignored";
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
      const device2 = ctx2.device();
      const down = device2.form === "phone" ? { text: openHelp(device2, ctx2.panelOnPhone).serviceDown } : { text: "Design Chamber isn\u2019t responding.", detail: "It may still be starting." };
      root2.append(
        notice(
          paused ? { icon: "alert", text: "Design Chamber is paused.", detail: "Turn it back on in Settings \u2192 Extensions, then try again.", action: { label: "Try again", onClick: load } } : { icon: "alert", ...down, action: { label: "Try again", onClick: load } }
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
      const commentSlot = commentOffered(ctx2.device(), ctx2.panelOnPhone) ? h("span", { class: "dcb-action" }) : null;
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
          if (outcome === "not-here") ctx2.toast("info", openHelp(ctx2.device(), ctx2.panelOnPhone).notHere);
        } catch (error) {
          ctx2.toast("error", `Couldn\u2019t open the design. ${errorText2(error)}`);
        } finally {
          busy = false;
          mine?.update({ loading: false });
          other?.update({ disabled: false });
        }
      };
      buttons.open = mountButton(openSlot, { label: "Open", variant: "default", size: "sm", onClick: () => void open("view") });
      if (commentSlot) buttons.comment = mountButton(commentSlot, { label: "Comment", variant: "outline", size: "sm", onClick: () => void open("comment") });
      openSlot.querySelector("button")?.setAttribute("data-emphasis", "primary");
      openSlot.querySelector("button")?.setAttribute("aria-describedby", titleId);
      commentSlot?.querySelector("button")?.setAttribute("aria-describedby", titleId);
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
  var roundTwoVerdict = (detail) => {
    if (detail === null || detail.build?.round === "done") return "done";
    return detail.build?.round === 2 ? "again" : "later";
  };
  var ticketVerdict = (state) => state === "waiting" ? "again" : "done";
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
  var proposalVerdict = (view2) => view2.state === "approved" || view2.state === "declined" || view2.state === "superseded" || view2.state === "unknown" ? "done" : "again";
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
  var askCopy = (device2, panelOnPhone) => {
    const phone = device2.form === "phone";
    const help = openHelp(device2, panelOnPhone);
    const where = phone ? "Design Chamber" : "the rail";
    return {
      serviceDown: phone ? help.serviceDown : SERVICE_DOWN,
      previewOpened: (which) => which === "living-page-preview" ? `The living page preview is open in ${where}.` : `The board is open in ${where}.`,
      previewNotHere: phone ? help.notHere : "Open Design Chamber from the rail to see the preview.",
      previewFailed: phone ? `Couldn\u2019t open the preview. ${help.notHere}` : "Couldn\u2019t open the preview. Open Design Chamber from the rail."
    };
  };

  // src/ui/model/ask-poll.ts
  var ASK_POLL_BACKOFF_MAX_MS = 6e4;
  var startAskPoll = (read, ms, visible) => {
    let delay = ms;
    let timer;
    let busy = false;
    let over = false;
    const stop = () => {
      over = true;
      clearTimeout(timer);
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!over) timer = setTimeout(tick, delay);
    };
    const run = () => {
      if (over || busy) return;
      busy = true;
      clearTimeout(timer);
      read().catch((error) => {
        console.warn("Design Chamber: refetch failed", error);
        return "later";
      }).then((verdict) => {
        busy = false;
        if (verdict === "done") {
          stop();
          return;
        }
        delay = verdict === "later" ? Math.min(delay * 2, ASK_POLL_BACKOFF_MAX_MS) : ms;
        schedule();
      });
    };
    const tick = () => {
      if (visible()) run();
      else schedule();
    };
    run();
    return {
      now: () => {
        if (visible()) run();
      },
      stop
    };
  };

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
  var startRefetch = (read, ms) => {
    const poll = startAskPoll(read, ms, () => document.visibilityState !== "hidden");
    window.addEventListener("focus", poll.now);
    document.addEventListener("visibilitychange", poll.now);
    return {
      now: poll.now,
      stop: () => {
        poll.stop();
        window.removeEventListener("focus", poll.now);
        document.removeEventListener("visibilitychange", poll.now);
      }
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
    let poll = null;
    let disposed = false;
    const title = () => systemName(name, ask.systemId);
    const copy = () => askCopy(ctx2.device(), ctx2.panelOnPhone);
    const current2 = () => isCurrent(view2) ? view2 : null;
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
          poll?.stop();
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
      poll?.stop();
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
      const proposal = current2();
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
          const now = current2();
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
                  if (outcome === "opened") ctx2.toast("info", copy().previewOpened(which));
                  else if (outcome === "gone") ctx2.toast("error", "This design system is no longer in your Designs folder.");
                  else ctx2.toast("error", copy().previewNotHere);
                },
                () => ctx2.toast("error", copy().previewFailed)
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
      const proposal = current2();
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
      else if (load === "down") f.body.append(banner("warning", copy().serviceDown, { label: "Try again", onClick: retry }));
      else if (proposal) proposalBody(f.body, proposal);
      else if (view2 !== null) f.body.append(banner("info", proposalStateSentence(view2) ?? ""));
      root2.replaceChildren(f.el);
      f.body.scrollTop = scroll;
      paintFoot();
    };
    const retry = () => {
      if (load === "down") {
        load = "loading";
        renderAll();
      }
      poll?.now();
    };
    const readProposal = async () => {
      if (answeredText !== null || stoppedText !== null || busy) return "again";
      try {
        const [next, detail] = await Promise.all([
          ctx2.client.getProposal(ask.systemId, ask.proposalId),
          nameTried ? Promise.resolve(name) : ctx2.client.call("GET /systems/:id", { params: { id: ask.systemId } }).then((system) => system.name, () => null)
        ]);
        if (answeredText !== null || stoppedText !== null || busy || disposed) return "again";
        const key = JSON.stringify(next);
        const changedName = detail !== name;
        name = detail;
        nameTried = true;
        if (next.state === "current" && !partsKnown) {
          on = new Set(next.proposal.parts.map((part) => part.name));
          partsKnown = true;
        }
        const verdict = proposalVerdict(next);
        if (load === "ready" && key === viewKey && !changedName) return verdict;
        load = "ready";
        view2 = next;
        viewKey = key;
        renderAll();
        return verdict;
      } catch (error) {
        if (isServiceError(error, "not-found")) {
          if (answeredText !== null || stoppedText !== null || busy || disposed) return "again";
          const gone = { state: "unknown" };
          const goneKey = JSON.stringify(gone);
          if (load === "ready" && viewKey === goneKey) return "done";
          load = "ready";
          view2 = gone;
          viewKey = goneKey;
          declining = false;
          stopError = null;
          renderAll();
          return "done";
        }
        if (load === "ready" && view2 !== null) return "later";
        if (!isServiceError(error)) console.warn("Design Chamber: reading the proposal failed", error);
        if (load === "down") return "later";
        load = "down";
        renderAll();
        return "later";
      }
    };
    renderAll();
    if (answered === null) poll = startRefetch(readProposal, SYSTEM_ASK_POLL_MS);
    return {
      update: (next) => {
        if (next === null || next === answeredText) return;
        answeredText = next;
        cannot = null;
        poll?.stop();
        renderAll();
      },
      dispose: () => {
        disposed = true;
        clearUndoTimer();
        poll?.stop();
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
    let poll = null;
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
          poll?.stop();
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
        own(mountBanner(slot, { tone: "warning", title: askCopy(ctx2.device(), ctx2.panelOnPhone).serviceDown, action: { label: "Try again", onClick: () => poll?.now() } }));
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
      if (!roundOne || answeredText !== null || sending) return "again";
      let next;
      let verdict = "later";
      let project = hasProject;
      try {
        const answer = await ctx2.client.call("GET /system-builds/:ticket", { params: { ticket: ask.ticket } });
        next = answer.state === "waiting" ? "form" : answer.state === "made" ? "stale" : "expired";
        verdict = ticketVerdict(answer.state);
        if (answer.state === "waiting") project = answer.project !== null;
      } catch (error) {
        if (phase === "form") return "later";
        next = "down";
        if (!isServiceError(error)) console.warn("Design Chamber: reading the build ticket failed", error);
      }
      if (disposed || answeredText !== null || sending) return "again";
      if (next === phase && project === hasProject) return verdict;
      phase = next;
      hasProject = project;
      render();
      return verdict;
    };
    const readSystem = async () => {
      if (roundOne || answeredText !== null || sending) return "again";
      let next;
      let verdict = "later";
      let name = systemNameNow;
      try {
        const detail = await ctx2.client.call("GET /systems/:id", { params: { id: ask.systemId } });
        const result = roundTwoRead(detail);
        next = result.phase;
        name = result.name;
        verdict = roundTwoVerdict(detail);
      } catch (error) {
        if (isServiceError(error, "not-found")) {
          next = roundTwoRead(null).phase;
          name = null;
          verdict = roundTwoVerdict(null);
        } else {
          if (phase !== "loading" && phase !== "down") return "later";
          next = "down";
          if (!isServiceError(error)) console.warn("Design Chamber: reading the system failed", error);
        }
      }
      if (disposed || answeredText !== null || sending) return "again";
      if (next === phase && name === systemNameNow) return verdict;
      phase = next;
      systemNameNow = name;
      render();
      return verdict;
    };
    const read = () => roundOne ? readTicket() : readSystem();
    render();
    if (answeredText === null) poll = startRefetch(read, SYSTEM_ASK_POLL_MS);
    return {
      update: (next) => {
        if (next === null || next === answeredText) return;
        answeredText = next;
        poll?.stop();
        render();
      },
      dispose: () => {
        disposed = true;
        poll?.stop();
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
  var device = DESKTOP_DEVICE;
  var ctx = {
    client: serviceClient,
    host: guestHost.client,
    toast: (kind, message) => {
      guestHost.client.toast({ kind, message, dismiss: kind === "error" }).catch((error) => console.warn("Design Chamber: toast failed", error));
    },
    openSystemPreview: (systemId, which) => openSystemInRail({ client: serviceClient, host: guestHost.client }, systemId, which === "living-page-preview" ? "preview" : "board"),
    device: () => device,
    panelOnPhone: true
  };
  mountSpinner(document.createElement("div")).dispose();
  guestHost.ready.subscribe((context) => {
    if (!context) return;
    applyHostReady(context, document.documentElement);
    device = deviceOf(context);
    applyDevice(device, document.documentElement);
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
