// Every numeric limit and identifier pattern of Design Chamber, in one place.
// Sources: docs/SPEC.md (section in brackets) and the OpenChamber host facts F1–F23 (§2).
// Service, guest and tests import these; never repeat a literal elsewhere.

// ---- Identifiers [§6.1, §6.2] ----

/** A design folder name under the root. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** `slugify(title)` output length before uniqueness suffixes [§9.1]. */
export const SLUG_BASE_MAX = 48;
/** Fallback slug base when a title folds to nothing [§9.1]. */
export const SLUG_FALLBACK = 'design';
/** A canvas screen id; its file is `screens/<id>.html`. */
export const SCREEN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
/**
 * A viewport id (`laptop`, `phone`). Not fixed by the spec; WP0 accepts the
 * same shape as a screen id plus upper case and `_`, so agent ids like
 * `Desktop_XL` survive (SPEC §14 "WP0 deviations").
 */
export const VIEWPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
/** A comment id as the service mints it (`c_8f3k2`). */
export const COMMENT_ID_PATTERN = /^c_[a-z0-9]{4,24}$/;
/** A version id (`v12`). */
export const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}$/;
/** A bundled preset id (`minimal-saas`), from `rules/presets/<id>.md`. */
export const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;
/** An upload id as the service mints it. */
export const UPLOAD_ID_PATTERN = /^u_[A-Za-z0-9_-]{8,40}$/;
/** A lowercase hex sha256 (render keys, tree hashes, object names). */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// ---- design.json fields [§6.2] ----

export const DESIGN_JSON_VERSION = 1;
export const STATE_JSON_VERSION = 1;
export const VERSION_INDEX_VERSION = 1;
export const SETTINGS_FILE_VERSION = 1;
export const TITLE_MIN = 1;
export const TITLE_MAX = 120;
export const BRIEF_MAX = 2000;
export const VIEWPORTS_MIN = 1;
export const VIEWPORTS_MAX = 8;
export const VIEWPORT_LABEL_MAX = 40;
export const VIEWPORT_WIDTH_MIN = 200;
export const VIEWPORT_WIDTH_MAX = 3840;
export const VIEWPORT_HEIGHT_MIN = 200;
export const VIEWPORT_HEIGHT_MAX = 4320;
export const SCREENS_MAX = 40;
export const SCREEN_DESCRIPTION_MAX = 500;
/** Characters of a session id or project directory kept in design.json. */
export const SESSION_ID_MAX = 128;
export const PROJECT_DIRECTORY_MAX = 4096;

// ---- Comments [§6.2] ----

export const COMMENT_BODY_MIN = 1;
export const COMMENT_BODY_MAX = 2000;
export const ANCHOR_TEXT_MAX = 120;
/** Opening tag snippet of the anchored element. */
export const ANCHOR_HTML_MAX = 200;
/** Not in the spec; bounds a generated selector (6 levels × classes). */
export const ANCHOR_SELECTOR_MAX = 1000;
/** Comments kept per design. Not in the spec; bounds design.json and the revision prompt input. */
export const COMMENTS_MAX = 500;
/** Text-fallback anchor match needs at least this many stored characters [§8.3]. */
export const ANCHOR_TEXT_MATCH_MIN = 12;
/** Selector generation walks at most this many ancestor levels [§8.3]. */
export const SELECTOR_DEPTH_MAX = 6;

// ---- Versions [§6.4, §4.9] ----

export const SNAPSHOT_FILES_MAX = 1000;
export const SNAPSHOT_BYTES_MAX = 100 * 1024 * 1024;
export const VERSIONS_KEEP = 100;
export const VERSION_LABEL_MAX = 120;
/** Auto snapshot after this much quiet following content changes. */
export const VERSION_QUIET_MS = 8000;
/** Turn-snapshot requests for one session within this window collapse into one [§10.6]. */
export const TURN_SNAPSHOT_DEDUPE_MS = 2000;
/** A turn snapshot that finds its files already in an `auto` version this recent relabels it as the turn's. */
export const TURN_PROMOTE_AUTO_MS = 30 * 60_000;

// ---- Settings [§6.5, §9.2] ----

export const PREVIOUS_ROOTS_MAX = 10;
export const SETTINGS_PATH_MAX = 4096;

// ---- Host transport, F7/F8 [§7] ----

/** `serviceRequest` body string, in characters (F7). */
export const HOST_REQUEST_BODY_MAX_CHARS = 64_000;
/** Whole `serviceRequest` JSON the host accepts (F7); the service caps request bodies at this. */
export const SERVICE_REQUEST_BODY_MAX_BYTES = 80_000;
/** `serviceRequest` query value, in characters (F7). */
export const HOST_QUERY_VALUE_MAX = 2000;
/** The host reads at most this many UTF-8 bytes of an answer (F8). */
export const HOST_RESPONSE_MAX_BYTES = 8_000_000;
/** The service never answers more than this (headroom under F8). */
export const SERVICE_RESPONSE_MAX_BYTES = 7_500_000;
/** The host gives up on a service request after this (F8). */
export const HOST_REQUEST_TIMEOUT_MS = 20_000;
/** Every service handler answers within this; longer work becomes a polled job [§7]. */
export const HANDLER_BUDGET_MS = 15_000;

// ---- Uploads (guest → service large text) [§7, §8.2] ----

export const UPLOAD_TOTAL_MAX = 2_000_000;
/** One `PUT /uploads/:id/:index` `data` value, measured after `JSON.stringify`. */
export const UPLOAD_CHUNK_MAX_CHARS = 60_000;
/** One upload chunk body in UTF-8 bytes, so the whole host JSON stays under F7. */
export const UPLOAD_CHUNK_MAX_BYTES = 75_000;
export const UPLOAD_TTL_MS = 10 * 60_000;
export const UPLOADS_OPEN_MAX = 8;
/** `POST /designs` inline `html` above this must go through an upload. */
export const CREATE_INLINE_HTML_MAX = 60_000;

// ---- Outbox [§7, §10.4] ----

export const OUTBOX_TTL_MS = 10 * 60_000;
/** How long "Open as page" waits for the rail to take its open request. */
export const OPEN_REQUEST_TTL_MS = 2 * 60_000;

// ---- Changes / watcher [§4.8, §9.4] ----

export const CHANGES_WAIT_MAX_MS = 15_000;
export const CHANGES_RING_SIZE = 500;
export const WATCH_DEBOUNCE_MS = 250;
export const WATCH_POLL_MS = 3000;
/** Guest long-poll backoff on errors [§8.2]. */
export const CHANGES_BACKOFF_MIN_MS = 1000;
export const CHANGES_BACKOFF_MAX_MS = 10_000;

// ---- Rendering [§4.1, §9.5] ----

/** `GET /render/chunk` raw text chunk, in UTF-8 bytes. */
export const RENDER_CHUNK_MAX_BYTES = 6_000_000;
/** A bundled document larger than this is refused with `too-large`. */
export const RENDER_DOC_MAX_BYTES = 60 * 1024 * 1024;
/** Service render cache (LRU). */
export const RENDER_CACHE_MAX_BYTES = 256 * 1024 * 1024;
/** Guest render-doc cache (LRU of strings) [§8.4]. */
export const GUEST_RENDER_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** Parallel chunk fetches per render [§8.2]. */
export const RENDER_CHUNK_CONCURRENCY = 3;
export const BUNDLE_REFS_MAX = 500;
export const BUNDLE_CSS_DEPTH_MAX = 8;
/** `GET /designs/:slug/source` text, in characters. */
export const SOURCE_TEXT_MAX = 2_000_000;

// ---- Thumbnails [§4.4, §9.5] ----

export const THUMB_WIDTH = 320;
export const THUMB_TIMEOUT_MS = 20_000;
export const THUMB_DEBOUNCE_MS = 2000;
export const THUMB_CONCURRENCY = 1;

// ---- Design checks (documentation/specs/agent-render-and-check.md) ----

/** Artboards rendered per run; the rest are counted as skipped. */
export const CHECK_ARTBOARDS_MAX = 24;
/** PNG slices per artboard (one per viewport height, from the top). */
export const CHECK_SLICES_MAX = 4;
export const CHECK_ARTBOARD_TIMEOUT_MS = 12_000;
export const CHECK_RUN_BUDGET_MS = 90_000;
export const CHECK_STATIC_BUDGET_MS = 10_000;
/** Findings kept per report. */
export const CHECK_FINDINGS_MAX = 200;
export const CHECK_FINDINGS_PER_CODE = 5;
/** Findings the CLI prints before "and N more". */
export const CHECK_TEXT_SHOWN = 30;
export const CHECK_PROMPT_FINDINGS_MAX = 40;
export const CHECK_DETAIL_MAX = 200;
export const CHECK_SELECTOR_MAX = 300;
/** A `check.json` larger than this is ignored. */
export const CHECK_FILE_MAX_BYTES = 2_000_000;
/** A superseded run folder survives this long, so a concurrent run keeps its PNGs. */
export const CHECK_RUN_KEEP_MS = 120_000;
export const CHECK_TEXT_ELEMENTS_MAX = 2000;
/** `docHeight / viewport height` at or above this is a `screen-tall` warning. */
export const CHECK_TALL_RATIO = 6;
/** Hardcoded colours in one file before a `token-hardcoded` note. */
export const CHECK_TOKEN_LITERALS_MIN = 3;

// ---- Guest frames and wall [§8.2, §8.4] ----

export const PAGE_LIVE_FRAMES_MAX = 12;
export const RAIL_LIVE_FRAMES_MAX = 4;
/** Artboards beyond the viewport by more than this fraction of it may unload. */
export const FRAME_UNLOAD_MARGIN = 0.5;
export const CAMERA_SCALE_MIN = 0.05;
export const CAMERA_SCALE_MAX = 4;
export const CAMERA_PAN_MAX = 1e6;
/** `scale *= exp(-deltaY * WHEEL_ZOOM_RATE)`. */
export const WHEEL_ZOOM_RATE = 0.005;
export const WALL_GAP = 96;
export const ARTBOARD_LABEL_HEIGHT = 28;
/** Viewport id of a page's Full-width view; comments made there record it as `Comment.viewport`. */
export const PAGE_FILL_VIEWPORT_ID = 'fill';

// ---- Bridge [§8.3] ----

/** `size` reports are throttled to one per this many ms. */
export const BRIDGE_SIZE_THROTTLE_MS = 100;
/** Anchors per `resolve-anchors` / `anchors` message. */
export const BRIDGE_ANCHORS_MAX = COMMENTS_MAX;
export const BRIDGE_TITLE_MAX = 200;
export const BRIDGE_URL_MAX = 2000;
export const BRIDGE_TAG_MAX = 64;
export const BRIDGE_ARTBOARD_ID_MAX = 100;
export const BRIDGE_NONCE_MAX = 64;
/** Coordinates and sizes outside ±this are rejected as malformed. */
export const BRIDGE_COORD_MAX = 1e7;

// ---- Chat / agent instructions [§10, §11], host caps F13/F15 ----

/** Host cap on chip text, prompt and compose text. */
export const HOST_TEXT_MAX = 16_000;
/** Host cap on `JSON.stringify(chip.data)`. */
export const HOST_ATTACH_DATA_MAX = 16_000;
export const HOST_ATTACH_ID_MAX = 128;
export const HOST_ATTACH_TITLE_MAX = 200;
export const HOST_ATTACH_URL_MAX = 2000;
/** `writeClipboard` text cap; Copy HTML is offered only up to this. */
export const HOST_CLIPBOARD_MAX = 32_000;
/** Host cap on a toast message. */
export const HOST_TOAST_MAX = 500;
/** `GuestMessageItem.text` cap (F17). */
export const HOST_MESSAGE_TEXT_MAX = 200_000;
/** Chip core text target and hard cap asserted in tests [§11]. */
export const CHIP_TEXT_TARGET = 5000;
export const CHIP_TEXT_HARD_MAX = 15_000;
/** Revision prompt cap [§11.4]. */
export const REVISION_TEXT_MAX = HOST_TEXT_MAX;
/** What a user may type in the ask bar. The service adds the folder, rules path and element lines, which must still fit `HOST_TEXT_MAX`. */
export const ASK_TEXT_MAX = 12_000;
/** Project sources listed in the chip core [§11.3]. */
export const CHIP_PROJECT_PATHS_MAX = 6;
/** Chip build budget, discovery included [§10.1]. */
export const CHIP_BUILD_BUDGET_MS = 3000;
/** Remote URLs listed in a revision or offline prompt, each at most this many characters. */
export const PROMPT_EXTERNAL_MAX = 20;
export const PROMPT_EXTERNAL_URL_MAX = 200;
/** Time budget for rendering screens to collect their remote URLs. */
export const PROMPT_EXTERNAL_SCAN_MS = 5000;

// ---- Agent discovery: guide, skill, snippet ----

export const GUIDE_TEXT_MAX = 8000;
export const SKILL_TEXT_MAX = 6000;
export const SKILL_DESCRIPTION_MAX = 1024;
export const AGENTS_SNIPPET_MAX = 1000;

// ---- Loose html files in the root ----

/** Names returned by `GET /designs` `loose.files`. */
export const LOOSE_LIST_MAX = 20;
/** Root html entries `stat`ed per listing; the rest are only counted. */
export const LOOSE_SCAN_MAX = 200;
export const LOOSE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
/** Bytes read from a loose file to find its `<title>`. */
export const LOOSE_TITLE_SCAN_BYTES = 65_536;

// ---- Project-rules discovery [§11.1] ----

export const DISCOVERY_DEPTH_MAX = 4;
export const DISCOVERY_ENTRIES_MAX = 3000;
export const DISCOVERY_TIME_MAX_MS = 1500;
export const DISCOVERY_SOURCES_MAX = 20;
/** CSS `@media` widths turned into viewport suggestions. */
export const DISCOVERY_BREAKPOINTS_MAX = 4;
/** Custom properties in one `:root{}` block that make a CSS file a token source. */
export const DISCOVERY_ROOT_VARS_MIN = 5;

// ---- Phase 1.5: SDK 2.7 (documentation/specs/phase-1-5-sdk-2-7.md §3.6) ----
// SDK limits (SERVICE_INSTRUCTIONS_MAX, MENTIONS_ITEMS_MAX, GUEST_BLOCK_*, ...) are imported from
// `@openchamber/sdk` where they are used, never copied here: this file stays import-free so the
// OpenCode plugin can inline it.

/** The design index refreshes this long after a change event (coalesced) [§3.1]. */
export const DESIGN_INDEX_REFRESH_MS = 300;
/** A turn event waits this long for a cold design index before falling back to a store walk [U4]. */
export const DESIGN_INDEX_TURN_WAIT_MS = 5000;
/** A mention search waits this long for a cold design index [U6]. */
export const MENTION_INDEX_WAIT_MS = 1500;
/** Characters of an `@` query kept [U6]. */
export const MENTION_QUERY_MAX = 200;
/** Turn events waiting for work; the oldest is dropped past this [U4]. */
export const TURN_EVENT_QUEUE_MAX = 64;
/** Sessions the activity tracker remembers [U4]. */
export const ACTIVITY_SESSIONS_MAX = 500;
/** A `working` session with no event this long reads as unknown [U4]. */
export const ACTIVITY_WORKING_EXPIRY_MS = 30 * 60_000;
/** A file landed less than this long ago: the agent is writing right now (build strip, Work Status). */
export const WRITING_WINDOW_MS = 15_000;
/** The `design_check` tool stops its child after this long [U3]. */
export const CHECK_TOOL_TIMEOUT_MS = 180_000;
/** SIGTERM, then SIGKILL after this long [U3]. */
export const CHECK_TOOL_KILL_GRACE_MS = 5000;
export const CHECK_TOOL_STDOUT_MAX_BYTES = 1_048_576;
export const CHECK_TOOL_STDERR_MAX_BYTES = 65_536;
/** Characters of the "could not run" sentence the tool answers with [U3]. */
export const CHECK_TOOL_ERROR_TEXT_MAX = 2000;
/** Screen ids one `design_check` call may name [U3]. */
export const CHECK_TOOL_SCREENS_MAX = 16;
/** Characters of `runtime.json` `execPath` [U3]. */
export const RUNTIME_PATH_MAX = 4096;
/** Rows in the Work Status section, and the most check reads per answer [U5]. */
export const STATUS_ROWS_MAX = 5;
/** Without a project, Work Status lists designs updated this recently [U5]. */
export const STATUS_RECENT_MS = 7 * 86_400_000;
/** The status frame refetches this long after the last change event [U5]. */
export const STATUS_REFETCH_DEBOUNCE_MS = 250;
/** How long the service may stay unreachable before "starting" becomes "isn’t responding" [U5]. */
export const STATUS_STARTING_GIVE_UP_MS = 10_000;
/** A cold design index is waited for this long; then Work Status answers an empty list, not an error [U5]. */
export const STATUS_INDEX_WAIT_MS = 1500;
/** One design's check state is read for this long; a slower read leaves that row without a check part [U5]. */
export const STATUS_CHECK_READ_MS = 1500;
/** Base64 text accepted into a thumbnail `data:` URL in a chat block [U7, U8]. */
export const THUMB_DATA_TEXT_MAX = 4_194_304;
/** A pending thumbnail in a chat block is asked again after these delays [U7, U8]. */
export const THUMB_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10_000];
export const BLOCK_TITLE_MAX = 80;
export const BLOCK_SCREEN_TITLE_MAX = 40;
/** Screens a design card lists before "+N more" [U7]. */
export const BLOCK_SCREENS_SHOWN = 6;
export const DIRECTION_QUESTION_MAX = 200;
export const DIRECTION_LABEL_MAX = 80;
/** Options a direction pick needs, and allows [U8]. */
export const DIRECTION_OPTIONS_MIN = 2;
export const DIRECTION_OPTIONS_MAX = 4;

// ---- Phase 2: edit on the canvas (documentation/specs/phase-2-technical.md §10.3) ----

/** A hand-edit id as the service mints it (`e_…`), kept in `.chamber/edits.json`. */
export const EDIT_ID_PATTERN = /^e_[a-z0-9]{8,24}$/;
/** Characters of element text one hand edit may replace [§3.4]. */
export const TEXT_EDIT_MAX = 5000;
/** Characters of an element id the edit probe reports [§3.1]. */
export const EDIT_PROBE_ID_MAX = 200;
/** Elements the edit probe scans for same-text candidates before it stops counting [§3.1]. */
export const EDIT_PROBE_SCAN_MAX = 5000;
/** Hand edits within this window, with no other writer between, share one "Before your edits" version [§2.4]. */
export const USER_EDIT_COALESCE_MS = 60_000;
/** Undo records kept per design [§2.1]. */
export const USER_UNDO_KEEP = 10;
/** An undo record older than this is gone [§2.1]. */
export const USER_UNDO_TTL_MS = 30 * 60_000;
/** How long the edit notice with Undo stays [§2.7]. */
export const USER_EDIT_NOTICE_MS = 10_000;
/** Self-write entries remembered (least recently recorded dropped first) [§2.6]. */
export const SELF_WRITES_MAX = 1024;
/** `.chamber/edits.json` larger than this reads as empty [§2.1]. */
export const EDITS_FILE_MAX_BYTES = 262_144;
/** Hand-edit ledger entries kept; the rest are counted in `dropped` [§7.1]. */
export const HAND_EDITS_LEDGER_MAX = 30;
/** Characters of a quoted before/after/title in a ledger entry [§2.1]. */
export const HAND_EDIT_QUOTE_MAX = 80;
/** Characters of one rendered ledger line [§7.2]. */
export const HAND_EDIT_LINE_MAX = 240;
/** Characters of the whole hand-edit block in a message [§7.2]. */
export const HAND_EDITS_BLOCK_MAX = 1500;

/** Tweaks knobs per design [§4.1]. */
export const TWEAKS_MAX = 12;
export const TWEAK_LABEL_MAX = 40;
/** A CSS custom property name a knob may name. */
export const TWEAK_VAR_PATTERN = /^--[A-Za-z0-9_-]{1,64}$/;
/** A number knob's unit: lower-case letters or %, possibly empty. */
export const TWEAK_UNIT_PATTERN = /^[a-z%]{0,6}$/;
/** Absolute bound of a number knob's min and max. */
export const TWEAK_NUMBER_ABS_MAX = 1_000_000;
export const TWEAK_CHOICES_MIN = 2;
export const TWEAK_CHOICES_MAX = 6;
export const TWEAK_CHOICE_LABEL_MAX = 30;
/** A choice value: plain text that cannot break out of a CSS declaration (no `; { } < > \ *`). */
export const TWEAK_CHOICE_VALUE_PATTERN = /^[A-Za-z0-9 #%.,()+\-'"/]{1,80}$/;
/** A live preview value: the same plain shape, up to 100 characters (plus balanced quotes, §4.2). */
export const TOKEN_PREVIEW_VALUE_PATTERN = /^[A-Za-z0-9 #%.,()+\-'"/]{1,100}$/;
/** `tokens.css` larger than this is not editable [§4.2]. */
export const TOKENS_CSS_MAX_BYTES = 1_000_000;
/** Characters of a direction mark's name [§6.1]. */
export const DIRECTION_NAME_MAX = 40;

/** Saved page data per design, in UTF-16 code units of keys plus values (owner 19-7). */
export const PAGE_STATE_MAX_CHARS = 1_048_576;
/** `.chamber/page-state.json` larger than this reads as empty (room for JSON escaping) [§8.1]. */
export const PAGE_STATE_FILE_MAX_BYTES = 8_388_608;
/** Changes in one PATCH or one storage batch [§8.2, §8.3]. */
export const PAGE_STATE_CHANGES_MAX = 10_000;
/** At most one disk write per design per this many ms [§8.2]. */
export const PAGE_STATE_WRITE_MIN_MS = 1000;
/** At most one PATCH per surface per this many ms [§8.4]. */
export const PAGE_STATE_FLUSH_MS = 1000;
/** Characters of keys plus values in one storage batch (= PAGE_STATE_MAX_CHARS) [§8.3]. */
export const PAGE_STATE_BATCH_MAX_CHARS = PAGE_STATE_MAX_CHARS;
/** In-memory page-state cache across designs (least recently used dropped after a flush) [§8.2]. */
export const PAGE_STATE_CACHE_MAX_BYTES = 33_554_432;
