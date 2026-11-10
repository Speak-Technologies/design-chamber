# Phase 1.5: adopt OpenChamber SDK 2.7

Eight items (U1 to U8), approved by the owner on 2026-11-10, that move Design Chamber from a
panel people have to open to the places they already look: the agent's own instructions and
tools, the chat's Work Status, the `@` menu and the chat reply. Authority: `docs/SPEC.md`
(architecture and lanes), `docs/BRIEF.md` (owner decisions), `AGENTS.md`. Format follows
`documentation/specs/phase-1-review-loop.md` and `agent-render-and-check.md`.

Status: built (2026-11-10) on `feat/phase-1-5`. The design below is kept as written; where the
code went another way, the list just below says so, and `docs/SPEC.md` describes the code.

## As built (2026-11-10)

Where the code departs from the plan below, checked against `feat/phase-1-5`:

- **One PR.** PR 1 (`feat/sdk-2-7`) and the six sibling branches were merged into `feat/phase-1-5`,
  which goes to `master` as one PR (owner's decision), not seven (§10).
- **Checks say whether a browser exists.** `ChecksResponse` and `ChecksSummary` gain `browser: boolean`.
  `canRun` means "a run can start now", which is also false while another design is being checked;
  `verified()` in `model/checks-model.ts` reads `!browser` for a never-checked design, so a check
  running elsewhere does not turn a badge green or read as "no browser" (§3.7, §U5.2).
- **Which folder is a project.** A chat started with no project still has a `directory`: OpenChamber
  keeps such chats in `~/.config/openchamber/chats/<date>/session-<uuid>`. So the status frame keeps the
  host's `directory` only when `listProjects` lists it (`projectDirectoryOf`, compared with
  `sameDirectory`), and `GET /status/designs` treats what it receives as the project; with a project, a
  design that names none is left out unless it is this chat's (§U5.3).
- **Work Status Check reasons.** Check is disabled with one of four sentences: nothing written yet, check
  state not read, no browser, another design being checked. `browser` tells the last two apart. The
  frame's timing limits (`STATUS_STARTING_GIVE_UP_MS`, `STATUS_INDEX_WAIT_MS`, `STATUS_CHECK_READ_MS`)
  moved into `src/shared/limits.ts` (§U5.2, §3.6).
- **DirectionPick layout.** Four options go two per row under 480 px, not 360 px; under 360 px every
  pick wraps two per row (§U8.1).
- **Keep your place** (§3.8) was built in PR 1.
- **Linking from session events.** Linking is no longer guest reconciliation only. The service reads the
  chips a chat carries from every session event (`src/service/session-links.ts`) and links a `/design`
  or `/page` stub to that chat while the design has no chat yet, never moving it from one chat to
  another. This is what links designs started in a chat with no project, which no guest's
  `onSessions(projectId)` lists, and it works with no Design Chamber window open. A per-design marker in
  the chip url (`#dc-created=`) gates the link, checked under the design's lock, so a chip from a deleted
  design cannot claim a new design with the same folder name (the rail's own reconciliation still can: KI-13). Still never linked by timing (§8, Q4).
- **`openInRail`** takes the open request back on any `openSurface` failure, then answers `not-here` for
  `NO_DIRECTORY` / `UNSUPPORTED` and rethrows the rest (§3.2).
- **Claude Code harness (§12.3 step 3.6, the §2 NOT FOUND row).** Sessions run through the Claude Code
  harness inside OpenChamber get the instructions note, the skill, the chat blocks and the
  `design_check` tool, which they see as `mcp__openchamber__design_check` (seen live).
- **Block syntax.** The host draws a block only from a fenced `openui-lang` block whose first line is
  `root = Stack([...])`; a bare `root = DesignCard("slug")` shows "This block could not be drawn". The
  instructions note spells the form out with an example for each block (§U2.2, §U7, §U8).
- **Threat model residual (§6).** The runtime check guarantees which binary the tool runs, not which
  script: `dist/cli/dc.mjs` sits in the extension folder, which the user can write, the same class as
  `dist/service/main.js`, which OpenChamber already runs from there.
- **KI-12, accepted.** The design index lags a new link by about 0.6 s, so a design linked at the very
  end of a turn gets no turn version from that turn's event; the quiet-period auto version holds the
  files (§U4).
- **BRIEF lines (§13.1, Q8)** were pasted with one correction: "A design that no chat is linked to is
  never linked automatically." became a line that matches the linking above.

---

## 0. Summary

| Item | What the user gets | Where it shows | Lane | Tier |
|---|---|---|---|---|
| U1 | Runs on OpenChamber 2.7, installs from its Git URL with one click, CI refuses a broken package | Settings → Extensions, README | main agent + fullstack | Opus high (seams), Sonnet high (CI, README) |
| U2 | Every agent knows the designs folder and the full design rules, with no `/design` and no Settings click | every chat (instructions), the agent's skill list | fullstack + ui-ux | Sonnet high, Opus high (skill clean-up) |
| U3 | The agent checks its own work with a real tool, `design_check`, that returns findings and PNG paths | the chat (tool call card) | fullstack | Opus high |
| U4 | A version after every agent turn on a linked design, with no Design Chamber window open | Versions drawer | fullstack | Opus high |
| U5 | "Pricing page · Writing pricing.html · 3 issues" in the chat's Work Status, with Check and Open | Work Status | fullstack + ui-ux | Sonnet high |
| U6 | `@pricing` attaches the design's folder, rules and open comments to a message | the composer's `@` menu | fullstack | Sonnet high |
| U7 | A design card in the agent's reply: preview, screens, check result, Open and Comment | chat reply | ui-ux | Opus high |
| U8 | "Which direction?" with A, B, C previews; a click is the answer | chat reply | ui-ux | Opus high |

Order: U1 (with the shared seams, §10.1) lands first as one PR to `master`. U2 to U8 then build in
six sibling branches that own disjoint files (§10.2).

---

## 1. Owner decisions recorded (not reopened here)

1. **Floor and pin.** `engines.openchamber` becomes `>=2.7.0`. `@openchamber/sdk` is pinned to exactly
   `2.7.0` (already installed on `feat/sdk-2-7`: `package.json` devDependencies, `package-lock.json`;
   `npm run typecheck` passes). The manifest keeps `apiVersion: 1`. (Note: the working tree's
   `package.json` was re-indented by `npm install`; `engines` still says `>=2.5.0` and is changed by U1.)
2. **Skill in the manifest.** `contributes.skills` is approved, although it reaches every agent while
   the extension is on. `docs/BRIEF.md` ("Writes outside the designs folder: only the user-clicked skill
   install") is updated by the main agent; this spec decides the fate of the Settings install button
   and the `<root>/AGENTS.md` guide (§U2.4).
3. **Never `provides: ["browser"]`.** Unchanged; `test/manifest.test.ts:38` keeps guarding it.
4. **Build tools.** Guests stay IIFE bundles from `scripts/build.mjs` (esbuild). npm, not bun. Nothing
   in this spec installs or requires bun, locally or in CI (U1.2 runs the SDK's check script under Node).
5. **User-gated stays user-gated.** Pushing branches, opening PRs, tagging, creating the `release`
   branch and publishing are the owner's (protocol §6). This spec only designs them.

---

## 2. SDK 2.7 grounding

`~/Documents/GitHub/openchamber` is NOT FOUND on this machine. Every fact below was verified in the
installed `node_modules/@openchamber/sdk` v2.7.0 (paths relative to it), in OpenChamber's own managed
plugin on this machine, or by running the binary. `NOT FOUND — verify` marks what no file settles; each
of those has a click-through step in §12.3.

| Fact | Where verified |
|---|---|
| SDK package is 2.7.0; bins `openchamber-guest-bundle`, `openchamber-guest-check` are `#!/usr/bin/env bun` TypeScript files | `package.json:3,29-32`, `scripts/check-guest.ts:1` |
| `check-guest.ts` refuses under plain Node (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), but bundled with our esbuild and run with Node it prints "Package is ready to add in Settings → Extensions." on this repo | ran both on 2026-11-10, Node v26.13.0 |
| `check-guest.ts` checks: manifest parse, every `.html` named anywhere in `contributes` and its relative `<script src>`, the service entry (built, no `@openchamber/sdk` import, reads `OPENCHAMBER_SERVICE_PORT`). It does **not** check `skills` or `opencodePlugin` folders | `scripts/check-guest.ts:14-41,55-57` |
| Install never compiles; git and zip installs land in `{dataDir}/extensions/{id}`; `opencodePlugin` folder must hold `index.js`/`server.js` or a `package.json` with `name` + `exports` (`invalid-opencode-plugin`) | `API.md:22-33,49` |
| Install link `openchamber://extensions/install?url=<encoded repo URL>`; `#tag` or `#branch` on the URL pins a channel; a raised `version` is the update signal; commit built files because installing never builds | 2.7 extension guide `…/skills/openchamber-extensions/SKILL.md:288-293` |
| `contributes` keys added since 2.5 that we use: `statusSection`, `sessionEvents`, `instructions: true`, `skills: string`, `opencodePlugin: string`, `mentions: { label }`, `blocks: GuestBlockContribution[]`, `tools` | `dist/manifest.d.ts:806-857`; `API.md:551,556,559` |
| `instructions`, `mentions`, `sessionEvents` need `contributes.service`; approving the package is the grant (no `capabilities` entry); `instructions` adds the `instructions` capability, `skills` adds `skills`, `opencodePlugin` adds `opencodePlugin` | `DOCUMENTATION.md:45,49,73`; extension guide `:100` |
| `GUEST_SESSION_EVENT_TYPES` = `turn-finished, turn-failed, permission-asked, question-asked, turn-started, session-created, session-archived, session-deleted`; `events` takes 1 to 8 distinct. (API.md:556 still says "1 to 4"; the code wins) | `dist/session-events.d.ts:24,47`; `GUEST_SERVICES.md:640-651` |
| Session events: `POST /session-events` with the service bearer, from every project, no window needed; parse with `readSessionEventRequest` (`null` → HTTP 400); answer exactly `{ ok: true }` (strict schema, extra keys = failed delivery); 10 s per delivery; one in flight, in order; at most once; a failure drops events for 30 s; the first event starts the service, 10 idle minutes stop it; `turn-finished` waits until nothing waits; a user-stopped turn emits nothing; isolated spaces not delivered | `dist/session-events.d.ts:27,31,203`; `GUEST_SERVICES.md:644-689`; `DOCUMENTATION.md:286-301` |
| Event body: `event.{id,type,at,session{id,parentId},project{directory},linked[]}`; `content` only with `content: true` (transcript grant) | `GUEST_SERVICES.md:659-678`; `dist/session-events.d.ts:180-202` |
| `createServiceHost({ env }).setInstructions(directory \| null, text)`, text ≤ `SERVICE_INSTRUCTIONS_MAX` (4096), empty removes it, stored on the server and read before every message; needs `OPENCHAMBER_HOST_CALLBACK_URL` | `dist/service-host.d.ts:19,261,279`; `GUEST_SERVICES.md:148,202`; `DOCUMENTATION.md:249-251` |
| Mentions: `POST /mentions/search` `{ query, directory }` → `{ items: [{ id, title, subtitle?, url? }] }`, ≤ 20 rows, title/subtitle/id ≤ 120/120/256, 2 s budget; `POST /mentions/resolve` `{ id }` → `{ text }` ≤ 16 000, 10 s budget; a row that cannot be read leaves no chip and says so; without `url` the chip reopens the extension; label ≤ 40 | `dist/service-host.d.ts:62-99`; `dist/manifest.d.ts:770-776`; `GUEST_SERVICES.md:225-229` |
| Mentions are read **when the user picks the row**, and the chip carries that text ("The text is as old as the pick"). The d.ts comment on `MENTIONS_RESOLVE_PATH` still says "when the message goes out"; the maintainers' design note wins and this spec designs for pick time (a deleted design fails at the pick, while the user can still act) | `DOCUMENTATION.md:257-259` ("Why a mention reads its row when picked"); discrepancy at `dist/service-host.d.ts:63` |
| Status section: object form `{ entry?, source?, title? (1–60), height? (24–320, default 120), defaultExpanded?, requiresProject? }`; a frame runs only while shown and expanded, same sandbox, session, theme, grants and service as a panel; `setHeight` 24–320. `source` (app-drawn): `GET` with `locale` and `directory` only (no session), clicks post `{ id, value? }`, ≤ 16 rows; a host that knows `source` ignores `entry` | `API.md:258,264-285`; `dist/status-view.d.ts:3-8,116-128` |
| In Work Status, `ready.theme.tokens.background` is the panel colour and `mutedSurface` swaps to the chat colour | `DOCUMENTATION.md:71` |
| `openSurface('plugin:<panel id>')` shows our rail panel, resolves when on screen, keeps an open one open, `NO_DIRECTORY` without a project, `UNSUPPORTED` where it cannot open; it never opens the full-screen page | `dist/host.d.ts:105-110`; `DOCUMENTATION.md:38`; `API.md:149,254`; already used at `src/guest/flows.ts:32,332,512` |
| Blocks: ≤ 4 (`GUEST_BLOCKS_MAX`), PascalCase name, description ≤ 120, ≤ 8 camelCase args, args text ≤ 16 000, height default 120, max 960, `answers: true` adds a note field and no Send button; `host.onBlock` gives `{ name, args: Record<string,string>, answered }`; `host.answerBlock(text)` only from a click, ≤ 2000, one per block; frame mounts once the block is finished and on screen, gets the panel's grants | `dist/manifest.d.ts:778-805`; `dist/contract.d.ts:76-83`; `dist/host.d.ts:59-65`; `API.md:307-309`; `DOCUMENTATION.md:43` |
| Guest pages run under a CSP: scripts, styles, images, fonts from the package or `data:`/`blob:` | `API.md:657` |
| OpenCode plugin: entry default-exports `{ id, setup }`, imports nothing (loaded with a bare `import()` where nothing is installed), tool input is plain JSON Schema, answers `{ content }` (no `output` without an output schema), registered through `ctx.tool.transform((tools) => tools.add({ name, description, input, options: { codemode: false }, execute(input, context) }))`; `context.sessionID`, `context.signal` exist | `DOCUMENTATION.md:44`; SDK example README `github.com/openchamber/openchamber/tree/main/packages/sdk/examples/opencode-plugin`; OpenChamber's own managed plugin `~/.config/openchamber/run/instances/10014/agent-tool/openchamber-agent-tool/index.js:15-18,42,82-104` |
| The plugin reaches only the OpenCode OpenChamber starts (`delivery: file`); in `restart`/`none` the user must press **Add to global config**; `remote` cannot load it; sessions in isolated spaces never get it | `DOCUMENTATION.md:263-280` |
| OpenCode here is a compiled Bun binary (`/opt/OpenChamber/resources/opencode-cli/opencode`, opencode v2.2.6, Bun 1.4.4); `process.getBuiltinModule('node:child_process')` works inside it; it can `spawnSync` OpenChamber's Electron binary with `ELECTRON_RUN_AS_NODE=1` and a stripped env and run `dist/cli/dc.mjs --version` (exit 0, `0.1.0`) | ran on 2026-11-10 |
| On Linux the bundled OpenCode sits at `<install>/resources/opencode-cli/opencode` and the service runs on `<install>/openchamber` (same install root `/opt/OpenChamber`) | `ps` on 2026-11-10: pids 10456 and 14160 |
| The same layout on macOS (`…/OpenChamber.app/Contents/Resources/opencode-cli/opencode`, binary `…/Contents/MacOS/OpenChamber`) and Windows (`…\OpenChamber\resources\opencode-cli\opencode.exe`, binary `…\OpenChamber\OpenChamber.exe`) | NOT FOUND — verify (§12.3 step 3.7, on a Mac and a Windows machine before release) |
| `codemode: false` makes the model see the tool directly; OpenChamber's own tools use `codemode: true`, which hides them behind a code-mode runtime the agent must search | SDK example README (opencode-plugin); `openchamber-agent-tool/index.js` (`options: { codemode: true }`) |
| Whether plugin tools, skills and instructions reach sessions run through the Claude Code harness inside OpenChamber | NOT FOUND — verify (§12.3 step 3.6) |
| Service env does not inherit the host's: only PATH, HOME, temp, locale and Windows system variables (so no `XDG_CONFIG_HOME`, no `DC_SETTINGS_PATH`) | `GUEST_SERVICES.md:28` |
| `OPENCHAMBER_SERVICE_DATA_DIR`: the extension's own folder, survives updates, deleted on removal | `GUEST_SERVICES.md:146` |
| A write inside the package folder reloads the extension | extension guide `:161` |

### 2.1 2.5 → 2.7 changes that touch existing code

None breaks the build: `npm run typecheck` passes on 2.7.0 (main agent). What changes behaviour:

| Change | Effect on us | Action |
|---|---|---|
| The host appends `GUEST_SCROLLBAR_SCRIPT` to every served guest HTML (`DOCUMENTATION.md:40`) | `src/ui/index.html` has no CSP meta, so it runs: scrollbars in the rail list, library and drawers hide at rest | Click-through §12.3 step 1.4 checks the wall and drawers still scroll and show a bar on hover |
| `theme.tokens` gains required `primaryText`, `successText`, `warningText`, `errorText`, `infoText` (`API.md:106-110`) | `applyHostReady` already writes them; `styles.css` already uses `--oc-*-text` | none |
| Identity beside `contributes` (`API.md:543`) | Old `panel.id/name/icon` "still works" | keep as is |
| `onSessions` records gained `links` and `agent` (`API.md:222-224`) | additive | none |
| `sessionControl.answers` refused by hosts ≤ 2.6.1 (`GUEST_SERVICES.md:209`) | not used | none |
| `test/manifest.test.ts:17` asserts `>=2.5.0` | fails once U1 changes engines | U1 updates it |

---

## 3. Shared pieces (built once, in the U1 seams commit)

These are used by several items. Building them in the base keeps the sibling branches disjoint.

### 3.1 Design index (`src/service/design-index.ts`, new, fullstack)

An in-memory list of `DesignSummary` kept current from the change hub, so mentions (2 s budget),
Work Status and session events answer from memory instead of stat-walking the root.

- `createDesignIndex({ store, hub, log }): DesignIndex`
  - `all(): readonly DesignSummary[]` last good list, newest `updated` first.
  - `get(slug): DesignSummary | null`.
  - `bySession(sessionId): readonly string[]` slugs whose `sessionId` equals it.
  - `ready(timeoutMs): Promise<boolean>` resolves `true` after the first load, `false` on timeout.
- Load: one `store.list()` at creation; afterwards a refresh 300 ms after any hub event of kind
  `added | removed | design | comments | files | root` (coalesced; never two lists in flight; a
  list that fails keeps the last good list and logs `design-index.refresh-failed`).
- `DesignSummary` gains `projectDirectory: string | null` (from the record, `src/shared/design-json.ts:380`),
  so Work Status can filter by project. WP0 change to `src/shared/types.ts:209`; both fakes
  (`src/guest/fake-services.ts`, `test/ui/visual/fake-backend.ts`) fill it in the same commit.
- `ServiceContext` gains `designIndex: DesignIndex` (WP0 change to `src/service/context.ts:157`).

### 3.2 Open requests that reach an open rail (extends `DELETE /open-request`)

Today `POST /pages/from-message` leaves an open request (`src/service/routes/chat.ts:462`) and the
rail takes it on mount and on `added` events (`src/guest/flows.ts:619-633`,
`src/ui/rail/rail-app.ts:65-69`). U5 and U7 need the same for an existing design, from a status
frame or a block frame.

- New route `POST /open-request` (registered in `src/service/routes/chat.ts`, which owns the
  existing in-memory request), body `OpenRequestBody = { slug: string; intent?: 'view' | 'comment' }`.
  Validates `slug` with `SLUG_PATTERN` (`src/shared/limits.ts:8`), resolves the design through
  `ctx.store` (containment; 404 `not-found` "That design is no longer in your Designs folder."),
  stores `{ request: { slug, intent, created }, at }` (replaces any older one, TTL `OPEN_REQUEST_TTL_MS`,
  `src/shared/limits.ts:121`), then `ctx.hub.emit({ slug, kind: 'open' })`. Answers `{ ok: true }`.
- `OpenRequest` (`src/shared/api.ts:313`) gains `intent: 'view' | 'comment'`; the existing writer
  sets `view`.
- `ChangeKind` (`src/shared/types.ts:195`) gains `'open'` and `'activity'` (§3.4). Guest store
  (`src/guest/store.ts:396`) treats both as no-ops for data.
- `flows.watchOpenRequests` takes the request on mount, on `added`, **and on `open`** events. The
  rail passes `intent` on: `openViewer(slug, { startIn: intent === 'comment' ? 'comment' : 'view' })`;
  `mountDesignView` gains `startIn?: 'view' | 'comment'` (`src/ui/wall/design-view.ts:97,198`):
  `comment` starts in Edit mode with the Comment control pressed. `view` keeps today's default
  (pages open in Play, canvases in Edit).
- The caller (status or block frame) does: `POST /open-request` → `host.openSurface(PANEL_SURFACE_ID)`
  (`src/guest/flows.ts:32`). It is one helper in `src/guest/flows.ts` (not pure: it calls the service
  and the host, both injected):
  `openInRail({ client, host }, slug, intent): Promise<'opened' | 'not-here' | 'gone'>`. 404 from the
  POST maps to `gone`. `NO_DIRECTORY` and `UNSUPPORTED` from `openSurface` map to `not-here`, and the
  helper then calls `DELETE /open-request` so a stale request cannot pop the design open the next
  time the user opens the rail for something else (a failure of that DELETE is ignored: the request
  expires after `OPEN_REQUEST_TTL_MS` anyway). Unit-tested with a fake client and host.

### 3.3 Host calls (`src/service/host-calls.ts`, new, fullstack)

Wraps `createServiceHost({ env: process.env })` (`dist/service-host.d.ts:279`) behind
`HostCalls = { setInstructions(text: string): Promise<'saved' | 'unavailable' | 'refused'> }`.
Without `OPENCHAMBER_HOST_CALLBACK_URL` (tests, an old host) it answers `unavailable` and logs once.
A `ServiceHostError` answers `refused` with its `code` logged (never the text). `ServiceContext`
gains `hostCalls`. The bearer it uses is the service token, which never leaves the service process.

### 3.4 Agent activity (`src/service/activity.ts`, seam stub, U4 fills)

`ActivityTracker = { record(e: { sessionId, type, at, directory }): void; of(sessionId): SessionActivity | null;
working(): readonly SessionActivity[] }` with
`SessionActivity = { sessionId; state: 'working' | 'done' | 'failed'; at: number; directory: string | null }`.
Stub: `record` no-op, `of` → `null`, `working` → `[]`. `ServiceContext` gains `activity`.

### 3.5 Route table additions (`src/shared/api.ts`, WP0, all in seams)

| Key | Query / body | Response | Owner branch |
|---|---|---|---|
| `POST /session-events` | body: the SDK `GuestSessionEventRequest` (validated with `readSessionEventRequest`) | `{ ok: true }` or `{ ok: false; error }` | U4 |
| `POST /mentions/search` | `{ query: string; directory: string \| null }` | `{ items: MentionsItem[] }` | U6 |
| `POST /mentions/resolve` | `{ id: string }` | `{ text: string }` | U6 |
| `GET /status/designs` | `directory?`, `session?` | `StatusDesignsResponse` (§U5.3) | U5 |
| `POST /open-request` | `OpenRequestBody` | `OkResponse` | seams (real) |
| `DELETE /agent/skill` | none | `{ skill: AgentSkillStatus }` | U2 (replaces `POST /agent/skill`) |

Seams registers a stub for every new key (each in its own route file, §10.1) so
`test/service/integration/compose.test.ts:43` (every `ROUTE_KEYS` entry registered) stays green.
Seams also removes `POST /agent/skill` from `ROUTE_KEYS` and everywhere it is served or faked (§10.1).
Every route goes through the existing router: the bearer check on every request
(`src/service/http.ts:44`, `bearerMatches`), the body cap, `ApiError` mapping.

### 3.6 New limits (`src/shared/limits.ts`, all added in seams)

Every number this spec introduces gets a named constant in `src/shared/limits.ts`, so no sibling
edits that file. SDK limits are imported from `@openchamber/sdk`, never copied.

| Constant | Value | Used by |
|---|---|---|
| `DESIGN_INDEX_REFRESH_MS` | 300 | design index refresh debounce (§3.1) |
| `DESIGN_INDEX_TURN_WAIT_MS` | 5 000 | U4 worker waits for the index before `bySession` |
| `MENTION_INDEX_WAIT_MS` | 1 500 | U6 search waits for a cold index |
| `MENTION_QUERY_MAX` | 200 | U6 query clip |
| `TURN_EVENT_QUEUE_MAX` | 64 | U4 pending work, oldest dropped |
| `ACTIVITY_SESSIONS_MAX` | 500 | U4 tracker size |
| `ACTIVITY_WORKING_EXPIRY_MS` | 30 × 60 000 | U4: a `working` entry with no event this long reads as unknown |
| `WRITING_WINDOW_MS` | 15 000 | moved here from `src/guest/build-activity.ts:20`, which re-exports it (its tests stay unchanged); U5 "Writing" |
| `CHECK_TOOL_TIMEOUT_MS` | 180 000 | U3 child timeout |
| `CHECK_TOOL_KILL_GRACE_MS` | 5 000 | U3 SIGTERM → SIGKILL |
| `CHECK_TOOL_STDOUT_MAX_BYTES` | 1 048 576 | U3 stdout cap |
| `CHECK_TOOL_STDERR_MAX_BYTES` | 65 536 | U3 stderr cap |
| `CHECK_TOOL_ERROR_TEXT_MAX` | 2 000 | U3 exit-2 sentence |
| `CHECK_TOOL_SCREENS_MAX` | 16 | U3 `screens` input |
| `RUNTIME_PATH_MAX` | 4 096 | U3 `runtime.json` `execPath` |
| `STATUS_ROWS_MAX` | 5 | U5 rows (and at most this many check reads per answer) |
| `STATUS_RECENT_MS` | 7 × 86 400 000 | U5 "updated in the last 7 days" |
| `STATUS_REFETCH_DEBOUNCE_MS` | 250 | U5 frame refetch |
| `THUMB_DATA_TEXT_MAX` | 4 194 304 | U7/U8 base64 text accepted into a `data:` URL |
| `THUMB_RETRY_DELAYS_MS` | [2 000, 5 000, 10 000] | U7/U8 pending thumbnail retries |
| `BLOCK_TITLE_MAX` | 80 | U7 card title clip |
| `BLOCK_SCREEN_TITLE_MAX` | 40 | U7 each screen title clip |
| `BLOCK_SCREENS_SHOWN` | 6 | U7 screens listed before "+N more" |
| `DIRECTION_QUESTION_MAX` | 200 | U8 question clip |
| `DIRECTION_LABEL_MAX` | 80 | U8 option label clip |
| `DIRECTION_OPTIONS_MIN` / `_MAX` | 2 / 4 | U8 valid option count |

Imported from the SDK, not redefined: `SERVICE_INSTRUCTIONS_MAX` (4 096), `MENTIONS_ITEMS_MAX` (20),
`MENTION_TITLE_MAX` (120), `MENTION_ID_MAX` (256), `MENTION_TEXT_MAX` (16 000), `GUEST_BLOCK_HEIGHT_MAX`
(960), `GUEST_BLOCK_ANSWER_MAX` (2 000), `GUEST_STATUS_SECTION_HEIGHT_MIN` / `_MAX` (24 / 320),
`GUEST_BLOCK_DESCRIPTION_MAX` (120), `GUEST_MENTIONS_LABEL_MAX` (40).

### 3.7 Shared helpers moved or widened in seams (no behaviour change)

- **`src/shared/path-compare.ts`** (new, pure, no runtime Node import; `PathModule` is a type-only import):
  `foldsCase`, `samePath`, `isInsideOrEqual`, `isStrictlyInside` move here from `src/service/paths.ts:48-82` (with the private helper between them)
  with the path module and platform as required parameters; `paths.ts` re-exports them with its current
  defaults, so `test/service/core/paths.test.ts` is unchanged. `sameDirectory` moves here from
  `src/guest/flows.ts:76-82`; `flows.ts` and `build-activity.ts:14` import it from the new file. The
  plugin (U3) and the status rows (U5) use these, so they bundle without `node:` imports.
- **`src/ui/model/build-strip-model.ts`**: the pill words become one exported pure function
  `pillText(phase: 'writing' | 'working' | 'failed' | 'done', file: string | null): string`, used by
  `buildView` itself (`Writing <name>`, `Agent is working`, `Agent stopped`, `Done`), so the status rows
  say exactly what the rail pill says.
- **`src/ui/model/checks-model.ts`**: `badgeOf`, `issueCount` and the internal `verified` take a narrower
  `ChecksSummary = { counts: ChecksResponse['counts']; render: { state: ChecksRenderState }; canRun: boolean }`
  (a `ChecksResponse` still fits), so a status row or a card can carry just that much.
- **`src/guest/host.ts`**: `HostLike` gains `'onBlock' | 'answerBlock' | 'setHeight'`; `src/guest/fake-services.ts`
  and the visual harness host (`test/ui/visual/fake-main.ts`, `fake-transport.ts`) implement them (a block
  call can be injected; `answerBlock` records the text and refuses without a pending click flag).

### 3.8 Keep your place across reloads (added 2026-11-10 at the owner's request; ui-ux)

The owner reported that after a few minutes Design Chamber sends them from the design they are viewing
back to the list. Cause: the panel and page frames reload whenever the extension updates (folder edits,
rebuilds, Git updates), and the rail starts on the list because nothing remembers what was open.

- **What is kept.** The open design's slug, in `host.storage` (instance scope, as `view:<slug>` and the
  first-run tip key are), under `place:panel` for the rail and `place:page` for the full-screen page, so a
  design opened in one never reopens in the other. A stored value is `{ slug }`; "was the viewer open"
  is the same fact (a slug is stored exactly while a design is open), so there is no second field.
  Going back to the list stores `null`. A deleted design (the viewer's "This design is gone", or
  `onRemoved`) goes back through the same path, so it clears too.
- **Restore.** On start the surface reads its key once, waits for the designs list, and reopens the design
  when the list still has it; its camera, hidden sizes and page view already restore from `view:<slug>`.
  A slug that is no longer in the list falls back to the list with no message and the key is cleared. The
  decision is made once. A stored value that is not `{ slug }` with a valid slug (`SLUG_PATTERN`) is ignored.
- **Who wins.** A pending open request (`openInRail`, `watchOpenRequests`) wins over the remembered design,
  and so does a design the user opens before the surface has finished starting: whichever opens first stops
  the restore, and becomes the remembered one.
- **Not kept.** Drawers, sheets, the New dialog, search and the tab. Only the design.
- **Code.** `src/ui/model/place-model.ts` (pure: `placeKey`, `storedPlace`, `readPlace`, `decideRestore`),
  `src/ui/components/place-memory.ts` (`keepPlace`, the wiring), called by `src/ui/rail/rail-app.ts` and
  `src/ui/page/page-app.ts`. Tests: `test/ui/place-memory.test.ts` (remember, clear on back, restore when
  present, ignore when gone, open request wins) and the `rail-place` visual scenario, which reloads the
  frame the way an extension update does. No service or API change.
- **Not an answer to the cause.** This hides the reload; it does not stop it. If the reloads themselves
  are too frequent, that is the host's (OpenChamber's) behaviour and a separate question.

---

## U1. Move to SDK 2.7

### U1.1 What the user sees

- Settings → Extensions shows Design Chamber v0.2.0 (at release), needing OpenChamber 2.7.0 or later.
  An older OpenChamber refuses the install with its own `host-too-old` message.
- After updating, OpenChamber asks once to approve the new permissions (instructions, skills, OpenCode
  plugin, session events). Until approved, the new features stay off and everything from Phase 1 works.
- README: an **Install in OpenChamber** link and a plain fallback ("Settings → Extensions → Add from
  Git, paste `https://github.com/<owner>/design-chamber#release`").

### U1.2 Technical design

**Manifest** (`package.json`, main agent). Unchanged keys stay. Added or changed:

```
engines.openchamber: ">=2.7.0"
contributes.statusSection: { entry: "dist/status/index.html", title: "Designs", height: 120, defaultExpanded: true, requiresProject: false }
contributes.sessionEvents: { events: ["turn-started", "turn-finished", "turn-failed"] }   (no content: identifiers only)
contributes.instructions: true
contributes.skills: "dist/skills"
contributes.opencodePlugin: "dist/plugin"
contributes.mentions: { label: "Designs" }
contributes.tools: [{ match: "design_check", name: "Design check", icon: "palette", title: "Design check · {input.design}", output: "text" }]
contributes.blocks: [
  { name: "DesignCard", description: "Card for a design you finished in the Designs folder: preview, screens, checks. slug: the design folder name", args: ["slug"], entry: "dist/blocks/index.html", height: 232 },
  { name: "DirectionPick", description: "Ask which of 2 to 4 design directions to keep. question; options and slugs: lists split by |, in the same order", args: ["question", "options", "slugs"], entry: "dist/blocks/index.html", height: 264, answers: true }
]
```

Description lengths measured: 108 and 111 characters (limit 120). Two blocks of four, so two stay free.
All new keys land in U1 so users approve once, not once per sibling release.

`defaultExpanded: true` is set on purpose (the host default is also true, `API.md:258`, but saying it
keeps the choice visible): a folded section is never seen, which defeats the reason for being in Work
Status; the frame costs nothing while idle (one long-poll, no timer), and a user who folds it keeps that
choice, since a saved expansion choice wins over the default. `requiresProject: false` because designs
live in the designs root, not in a project: a chat draft without a project still shows recent designs.

**Build** (`scripts/build.mjs`, main agent). New steps after (6):

- (7) **Plugin**: esbuild `src/plugin/index.ts` → `dist/plugin/index.js`, `format: 'esm'`, `bundle: true`,
  `platform: 'neutral'`, no externals. Then write `dist/plugin/package.json`
  `{ "name": "design-chamber-tools", "version": <package version>, "private": true, "type": "module", "exports": { ".": "./index.js" } }`
  (the shape of OpenChamber's own plugin, §2). The build **fails** if the output matches
  `/^\s*import[\s{*]|\bimport\s*\(|\brequire\s*\(/m` ("the plugin must import nothing"). The plugin
  source reaches Node built-ins only through `process.getBuiltinModule` (§U3.3).
- (8) **Status frame**: `src/ui/status/main.ts` → `dist/status/main.js` (browser IIFE options), copy
  `src/ui/status/index.html` and `src/ui/status/status.css`.
- (9) **Block frame**: `src/ui/blocks/main.ts` → `dist/blocks/main.js`, copy `index.html`, `blocks.css`.
- (10) **Skill**: `await import('../src/shared/agent/skill-doc.ts')` (Node ≥ 22.18 strips types for files
  outside `node_modules`; `tsconfig` has `erasableSyntaxOnly`), read `rules/DESIGN-RULES.md`,
  `rules/QUESTIONS.md` and `rules/presets/*.md`, write `dist/skills/design-chamber/SKILL.md` =
  `buildBundledSkill(...)` and copy presets to `dist/skills/design-chamber/presets/<id>.md`.
  Fails when the SKILL.md is missing its `name: design-chamber` frontmatter line.

The status and block frames get their own small CSS files so they never touch `src/ui/styles.css`
(which stays one file for the panel, `docs/SPEC.md` §12).

**Guest check in CI** (`scripts/guest-check.mjs`, new, main agent; npm script `guest-check`):
esbuild-bundle `node_modules/@openchamber/sdk/scripts/check-guest.ts` (`platform: 'node'`,
`format: 'esm'`, bundling `../dist/schemas.js` and zod) into the OS temp folder, run it with
`process.execPath` on the repo root, forward its exit code and output. Reason: the bin is a bun script
and Node refuses to strip types under `node_modules` (§2). This runs the SDK's own checker unchanged, so
nothing is re-implemented. `npm run check` stays typecheck + build + test; CI adds a step
`npm run guest-check` after `npm run check` in both jobs of `.github/workflows/ci.yml`.

Because `check-guest.ts` ignores `skills` and `opencodePlugin`, a new test `test/package-tree.test.ts`
(runs after the build inside `npm run check`) asserts: `dist/plugin/index.js` and its `package.json`
exist; the plugin has no import; `dist/skills/design-chamber/SKILL.md` exists with valid frontmatter;
`dist/status/index.html` and `dist/blocks/index.html` load built scripts.

**Distribution** (decision: a CI-built `release` branch, never `dist/` on `master`):

- `dist/` stays gitignored on every working branch, so parallel PRs never conflict on built files.
- New workflow `.github/workflows/release.yml`, triggered **only** by pushing a tag `v*` (the owner's act):
  1. checkout, Node 22.x, `npm ci`, `npm run check`, `npm run guest-check`;
  2. fail unless the tag equals `v` + `package.json` `version`;
  3. assemble the install tree = the `scripts/pack.mjs` INCLUDE list (`package.json`, `dist/`, `rules/`,
     `LICENSE`, `README.md`) in a temp folder;
  4. commit it on top of branch `release` (created as an orphan on the first run), message
     `Release v0.2.0 (from <sha>)`; tag that commit `release-v0.2.0`; push both with `GITHUB_TOKEN`
     (`permissions: contents: write` on this workflow only);
  5. `npm run pack` and attach `design-chamber-0.2.0.zip` to a GitHub Release for the tag.
- Install URLs: latest `https://github.com/<owner>/design-chamber#release`; pinned
  `…#release-v0.2.0`. README link: `openchamber://extensions/install?url=` + `encodeURIComponent` of the
  latest URL (`#` becomes `%23`).
- `release` must not be covered by the `master` protection rule (owner setting, §14 Q6).
- Folder installs for development keep working from the repo after `npm run build`.

**Version**: `0.1.0` → `0.2.0` in the last commit before the owner tags.

**Other U1 edits**: `test/manifest.test.ts` (engines, new keys, block name/description/arg limits via
`GUEST_BLOCK_*` constants, mention label ≤ `GUEST_MENTIONS_LABEL_MAX`, every new string free of em
dashes); README badge `≥ 2.7.0` and the install section.

### U1.3 Acceptance

1. `parseManifestJson(package.json)` ok; `engines.openchamber === '>=2.7.0'`; no `"provides"`.
2. `npm run check` and `npm run guest-check` pass on Ubuntu, Windows, Fedora in CI; guest-check prints
   "Package is ready to add in Settings → Extensions."
3. Deleting `dist/plugin/index.js` (or adding a static `import` to the plugin source) fails the build or
   `test/package-tree.test.ts` with a sentence naming the file.
4. `release.yml` is valid YAML, runs only on `v*` tags, refuses a tag that does not match the version
   (tested by reading the script step, no live run before the owner tags).
5. Every stub route answers without a 500 (compose test, plus one assertion each in §10.1's seam tests).
6. Folder-installed into OpenChamber 2.7.0, the approval dialog lists the new permissions and the Phase 1
   flows still work (§12.3 step 1).

---

## U2. Built-in skill and instructions

### U2.1 What the agent and the user get

- Every chat in OpenChamber (any project) starts with a short Design Chamber note in the agent's
  instructions: where the designs folder is, how a design is laid out, how to check it, which chat
  blocks exist. No slash command, no Settings click.
- The agent's skill list has `design-chamber`, with the full design rules (the same `rules/**` text
  `/design` attaches through RULES.md) and the presets as files beside it.
- Settings → Agents loses the **Install skill** button. If an older installed copy exists, Settings says
  so and offers **Remove old copy**.

### U2.2 Instructions text (`src/shared/agent/instructions.ts`, new, pure)

`buildInstructions({ root, platform, checkCommand }): string`, deterministic, no Node imports. Text
(the builder owns the exact wording; this is the content and tone, plain, no em dashes):

```
Design Chamber is on. It shows the designs saved in the user's designs folder: <root>
- When the user asks for a design, mockup, UI screen, landing page or prototype, save it there as its own folder, <root>/<slug>/. Load the design-chamber skill first: it has the rules and the design.json format.
- A page is one index.html. A canvas is several screens/<id>.html files listed in design.json.
- Before you say a design is done, check it with the design_check tool, or run <checkCommand> if you don't have that tool. Fix every error and look at the PNGs it saves.
- When a design is ready, show it with a DesignCard block. To let the user choose between directions you made, ask with DirectionPick.
- The user can type /design or /page to start a design with the project's rules attached.
```

Rules: `root` refused when it holds a control character (reuse `assertRoot` behaviour from
`src/shared/agent/guide.ts:27`); the result must be ≤ `SERVICE_INSTRUCTIONS_MAX` (import from
`@openchamber/sdk`, `dist/service-host.d.ts:19`). If a very long root pushes it over, the builder
drops the check-command clause ("…check it with the design_check tool."), then throws if still over.
`checkCommand` comes from the launcher (`launcher.commandFor(root, '<slug>')`,
`src/service/compose.ts:95`); `null` when the launcher is not in place drops that clause.

### U2.3 When instructions are set (`src/service/instructions.ts`, seam stub, U2 fills)

`startInstructions(ctx, { commandFor, ready })`: two triggers, both of which exist today.
(1) After the watcher baseline (`watcher.ready`, `src/service/compose.ts:89,103`), build the text for the
current root and call `ctx.hostCalls.setInstructions(text)` with directory `null`. (2) On every settings
root change (the settings root listener, `src/service/settings.ts:128`). `commandFor` is the launcher's
`commandFor` (`compose.ts:99`); the launcher writes its scripts before the guide sync, so by trigger (1)
it has answered. If it answers `null` (the scripts could not be written), the text goes without the
command clause, and the next root change tries again. Keep the last sent text in memory and skip an
identical call; on `unavailable` or `refused`, log and wait for the next trigger (no loop, no timer).
On dispose nothing is cleared: the host owns the text and drops it when the extension is disabled or
removed (verify, §12.3 step 2.5).

**First chat after install.** The host reads the stored text before every message (`DOCUMENTATION.md:251`),
but nothing stores it until the service first runs, and the service starts only on a request: the rail
or page opening, a Work Status frame, an `@` search, or a session event. The first `turn-started` starts it
during the user's first message, after that message's instructions were read. So the very first message
in the first chat after installing (or after the text was dropped by a disable) may go without the note;
the skill is there from the start (managed config), and from the second message on the note is too. The
text then survives service restarts, because the host keeps it. Accepted, not worked around: a
`keepRunning` service only to close this gap would cost a resident process for one message.

### U2.4 The bundled skill, the old installed copy, and the guide

**Bundled skill** (`src/shared/agent/skill-doc.ts`, new, pure; build step (10)):
`buildBundledSkill({ designRules, questions, presets: { id, title }[] }): string` =

```
---
name: design-chamber
description: <SKILL_DESCRIPTION from src/shared/agent/guide.ts:19>
---
# Designs for Design Chamber
<6 to 10 lines: the folder is in the Design Chamber note in your instructions; one folder per design;
 design.json first (the same contract text as buildSkillDoc, guide.ts:206-245, without paths);
 work offline; check with design_check; presets are in presets/<id>.md next to this file, list of ids>
## Design rules
<rules/DESIGN-RULES.md verbatim>
## Questions to ask
<rules/QUESTIONS.md verbatim>
```

No absolute path appears in it (it is static and shipped). The source of truth for rule text stays
`rules/**` (rules author); the build copies, nobody hand-edits `dist/skills`.

Reuse, not a second copy of RULES.md wording: `src/shared/agent/rules-doc.ts` today exports only
`buildRulesDoc` and `RulesDocFiles` (`:13,289`); U2 exports its context-free pieces and calls them from
`buildBundledSkill`: `verbatim(name, text)` (`:18`, the BEGIN/END wrapper around `DESIGN-RULES.md` and
`QUESTIONS.md`) and `renderingSection()` (`:256`, the offline rules). `checkSection(command)` (`:271`) today
quotes a shell command only; U2 widens it to `checkSection({ tool: 'design_check', command: string | null })`:
"Check it with the design_check tool after each change. If you don't have that tool, run: <command>" (or,
with no command, "…look for the check command in the Designs folder's AGENTS.md"), keeping the existing
paragraph on what the check finds. RULES.md (chip-created designs) and the bundled skill then say the same
thing; the RULES.md snapshots in `test/agent/__snapshots__/` are updated in the same branch. The sections
that need an `AgentContext` (folder paths, project rules, viewports) stay out of the skill.

**Old installed copy** (decision): the bundled skill has the same name, `design-chamber`, so an older
copy the user installed from Settings would give agents two skills of one name.

- Remove **Install skill** from Settings and the `POST /agent/skill` route (done in PR 1's seams, §10.1, so
  no sibling edits the shared test files; U2 then fills the Settings row and the `DELETE` handler).
- New `DELETE /agent/skill` (in `src/service/routes/settings.ts`, handler in `src/service/agent-setup.ts`):
  deletes `skillTarget(env, homeDir).file` (`src/service/agent-setup.ts:62`, fixed path, no request input)
  **only** when `ownedFileState` (`agent-setup.ts:47`) says `current` or `outdated` (ours and unedited),
  the leaf folder and file are not symlinks, then removes the `design-chamber` folder if it is now
  empty. `edited` → 409 `conflict` "That copy has your own edits, so it stays. Delete it yourself if you
  don't need it." `foreign` → 409 "That skill isn't one Design Chamber wrote, so it stays."
  `not-installed` → 200 with the status (idempotent).
- `AgentSkillStatus` (`src/shared/types.ts:248`) is reused as "the old copy's status"; `skillStatus()`
  stays read-only.
- This needs the user's click (keeps the spirit of BRIEF's "only when the user clicks"); §14 Q3 offers
  automatic removal instead.

**Guide `<root>/AGENTS.md`**: keep it (decision). It is the only thing an agent outside OpenChamber (a
terminal CLI, an editor agent opened in the Designs folder) reads, it is already built and ownership-safe,
and instructions cannot reach those agents. Update its check line to name `design_check` first and the
launcher second (`buildAgentGuide`, `src/shared/agent/guide.ts:105`; its `rulesDigest` line at `:94`).
The AGENTS.md snippet in Settings stays for the same reason.

### U2.5 Settings copy (ui-ux, `src/ui/components/settings-view.ts:235-260`)

The "OpenCode skill" field becomes **Agent skill**:

| State | Copy | Control |
|---|---|---|
| no old copy | "Built in. Agents in OpenChamber can use it while Design Chamber is on." | none |
| old copy, ours, unedited | "Built in. An older copy is also installed at <path>, so agents may see the skill twice." | **Remove old copy** (outline, xs; loading while busy) |
| old copy edited | "Built in. You edited the older copy at <path>, so Design Chamber leaves it alone. Delete it if you don't need it." | **Copy path** |
| old copy foreign | "Built in. Another design-chamber skill is installed at <path>." | **Copy path** |
| remove failed | kit error text under the row: the service's message | button stays |
| removed | toast success "Old copy removed." | row returns to the first state |

No confirm dialog: the file is ours, unedited, and rebuilt by the bundled skill (reversible in effect).
Tokens: existing `.dc-field`, `.dc-status-line`, `--oc-muted`, `--oc-error-text`.

### U2.6 Acceptance

1. `buildInstructions` for a 1 024-character root is ≤ 4 096 characters; with a newline in the root it throws.
2. With a fake `hostCalls`, starting the service sets the text once; a root change sets the new text once;
   the same text twice sends once; `unavailable` does not throw or loop.
3. `dist/skills/design-chamber/SKILL.md` has `name: design-chamber`, the SKILL_DESCRIPTION, the whole of
   `rules/DESIGN-RULES.md` and `rules/QUESTIONS.md`, no absolute path, and one `presets/<id>.md` per preset.
4. `DELETE /agent/skill`: unedited copy removed (file and empty folder); edited copy 409 and still there;
   symlinked leaf 409 and untouched; nothing at the path → 200; never touches `duplicates`.
5. The guide names `design_check` and still carries its ownership marker.
6. No em dash in any new string (`test/copy-no-em-dash.test.ts`).

---

## U3. Check as a real agent tool

### U3.1 What the agent and the user get

The agent calls `design_check` with a design's folder name. It renders every screen at its viewports
offline in headless Chrome (the existing check, `docs/SPEC.md` §9.9), saves PNGs under
`<design>/.chamber/check/`, writes `.chamber/check.json`, and answers with the same text `dc check`
prints today: the result line, the PNG paths to look at, the findings. The chat shows it as a tool card
titled "Design check · pricing" (manifest `tools` entry). The Checks badge in the viewer updates as it
does for the CLI.

### U3.2 Decisions

- **One tool, `design_check`.** The check already renders and returns image paths, so a separate
  `design_render` would be the same run with less output, and each tool's schema costs tokens in every
  session. §14 Q2 asks; adding it later is one more `tools.add` on the same runner.
- **The launcher stays.** The plugin reaches only the OpenCode OpenChamber starts (§2); agents outside it
  (Claude Code harness inside OpenChamber, to be verified; a terminal agent; an isolated space) still need
  `sh <root>/.chamber/bin/dc check <slug>`. The launcher code is unchanged
  (`src/service/check/launcher.ts`).
- **The plugin runs our CLI as a child process**, not the check engine in-process: the CDP pipe needs
  extra stdio fds (`src/service/check/cdp.ts:144-151`), which is proven under Node and unproven under Bun;
  a child also isolates a Chrome crash from OpenCode.
- **The plugin never talks to the service** and never sees its token.

### U3.3 Technical design

**Runtime record** (`src/service/runtime-record.ts`, seam stub, U3 fills). At service start the service
writes, atomically (`writeFileAtomic`, `src/service/paths.ts`), `runtime.json` in Design Chamber's own
app-data folder (the folder of `settings.json`, `src/service/settings.ts:35-47`):

```
{ "v": 1, "execPath": "<process.execPath>", "electron": <process.versions.electron !== undefined>, "version": "<package version>", "updated": "<iso>" }
```

It holds no secret. It is rewritten when `execPath` or `version` changed (one read, compare, write).
A failure logs `runtime-record.write-failed` and the service carries on (the tool then says so).

**App-data path, shared** (`src/shared/app-data.ts`, new, pure, no Node imports):
`designChamberDataDir({ platform, homeDir, appData, xdgConfigHome, join }): string`, the logic now
inside `settingsFilePath` (`src/service/settings.ts:35-51`: Windows `%APPDATA%\Design Chamber`, macOS
`~/Library/Application Support/Design Chamber`, Linux `<XDG_CONFIG_HOME or ~/.config>/design-chamber`),
taking a `join` function. `settingsFilePath` keeps its `DC_SETTINGS_PATH` test seam and calls it.
The real service never receives `XDG_CONFIG_HOME` or `DC_SETTINGS_PATH` (§2, `GUEST_SERVICES.md:28`),
so it always writes to `~/.config/design-chamber` on Linux. The plugin therefore passes
`xdgConfigHome: undefined` (it ignores OpenCode's own `XDG_CONFIG_HOME`) so both sides agree. Tests
live in a new `test/shared/app-data.test.ts` (U3 does not edit `test/service/core/settings.test.ts`, which
PR 1 changes): every platform's folder, and the pairing (service-side path with the service's env equals
plugin-side path with an env that sets `XDG_CONFIG_HOME`).

**Plugin** (`src/plugin/index.ts` → `dist/plugin/index.js`, fullstack). No static or dynamic import.
Built-ins come from `process.getBuiltinModule('node:child_process' | 'node:fs' | 'node:path' | 'node:os' | 'node:url')`
inside `execute` (verified under OpenCode's Bun, §2). May import pure modules that have no Node imports
(`src/shared/limits.ts`, `src/shared/app-data.ts`); esbuild inlines them.

```
export default {
  id: 'design-chamber',
  setup: async (ctx) => ctx.tool.transform((tools) => tools.add(designCheckTool)),
}

designCheckTool = {
  name: 'design_check',
  description: 'Check a design in the Designs folder before you say it is done: renders every screen at its sizes offline, saves PNGs to look at, and lists what to fix.',
  options: { codemode: false },
  input: { type: 'object', additionalProperties: true, required: ['design'], properties: {
    design:  { type: 'string', description: 'The design folder name, such as pricing-page' },
    screens: { type: 'array', items: { type: 'string' }, description: 'Canvas only: check just these screen ids' },
    static:  { type: 'boolean', description: 'Check the files only, without a browser' } } },
  execute(input, context) -> { content: string, metadata: { designChamber: { exit: 0|1|2 } } }
}
```

`execute`, in order (pure parts are exported and unit-tested: `parseToolInput`, `buildChildArgs`,
`childEnv`, `validateRuntime`, `toolResult`):

1. `parseToolInput(input)`: `design` must match `SLUG_PATTERN` (bare folder names only; paths are
   refused, which removes the cwd-relative branch of `resolveTarget` from this surface). `screens`: an
   array, or a comma-separated string (models stringify), each `SCREEN_ID_PATTERN`
   (`src/shared/limits.ts:14`), at most 16, de-duplicated. `static`: boolean, or `"true"`/`"false"`.
   Anything else → `{ content: "That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page." }` with exit 2.
2. Read `runtime.json` from `designChamberDataDir(...)` and check it against the OpenChamber install
   that runs this OpenCode. The record alone is never trusted: anything that can edit files in the
   user's app-data folder could rewrite it. Two pure, tested functions:
   - `installRootOf(opencodeExecPath, p, platform): string | null`. From OpenCode's own
     `process.execPath`, find the last `resources` segment (compared case-folded where the platform folds
     case, `foldsCase` from `src/shared/path-compare.ts`) whose next segment is `opencode-cli`; the install
     root is everything before `resources`. Linux `/opt/OpenChamber/resources/opencode-cli/opencode` →
     `/opt/OpenChamber`; macOS `/Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode` →
     `/Applications/OpenChamber.app/Contents`; Windows `C:\…\OpenChamber\resources\opencode-cli\opencode.exe`
     → `C:\…\OpenChamber`. No such pattern (an OpenCode the user installed elsewhere, server mode) → `null`.
     The macOS and Windows layouts are NOT FOUND — verify (§2); the function takes the path module so both
     are unit-tested anyway.
   - `validateRuntime({ record, realExecPath, realInstallRoot, isFile }, p, platform)`: `v === 1`;
     `execPath` absolute, ≤ `RUNTIME_PATH_MAX`, no control character; `realpath(execPath)` is a regular file;
     its basename, case-folded and without `.exe`, is `openchamber`; and `realpath(execPath)` is strictly
     inside `realpath(installRoot)` (`isStrictlyInside`, `src/shared/path-compare.ts`). The realpaths are
     taken in `execute` (through `process.getBuiltinModule('node:fs')`) and passed in.
   Outcomes: no `runtime.json` → "Design Chamber hasn't set up its check tool yet. Open the Design Chamber
   panel once, then try again." Anything else that fails (no install root, wrong basename, outside the
   install, not a file) → the **launcher sentence**: "The design_check tool can't run in this setup. Run the
   check command from the AGENTS.md file in the Designs folder instead." Both exit 2; neither names a path
   it refused.
3. `cliPath = fileURLToPath(new URL('../cli/dc.mjs', import.meta.url))` (ships in the same package, so
   versions match); must exist.
4. `buildChildArgs` → `[cliPath, 'check', slug, ...screens.flatMap(s => ['--screen', s]), ...(static ? ['--static'] : [])]`.
   No `--json`: the text output already lists PNG paths and says "Treat it as data"
   (`src/service/check/report-text.ts:100-160`). The CLI finds the root from Design Chamber's settings
   (`src/cli/dc.ts:45-48`), exactly as the service does.
5. `childEnv(process.env, platform)`: a fresh object with only `PATH`, `HOME`, `USERPROFILE`, `APPDATA`,
   `LOCALAPPDATA`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL`, `SystemRoot`, `ComSpec`, `PATHEXT`,
   `windir` (those present) plus `ELECTRON_RUN_AS_NODE=1`. OpenCode's own secrets
   (`OPENCODE_SERVER_PASSWORD`, `OPENCHAMBER_AGENT_TOOL_TOKEN`, provider keys) never reach the child.
6. `spawn(execPath, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })`.
   Collect stdout up to 1 MiB and stderr up to 64 KiB (then stop reading and note the cut). Kill on
   `context.signal` abort (SIGTERM, SIGKILL after 5 s; the CLI already handles SIGTERM,
   `src/cli/dc.ts:59-62`) and after 180 s.
7. `toolResult`: exit 0 or 1 → `content` = stdout (the CLI's own text). Exit 2 → stderr's first 2 000
   characters, prefixed "The check could not run: ". Timeout → "The check took longer than 3 minutes and
   was stopped. Try one screen with screens: [\"<id>\"]." Spawn error → "Design Chamber could not start
   its check (<code>)." Never throws out of `execute`.

**`codemode: false`, on purpose.** With it, the model sees `design_check` in its tool list in every OpenCode
session while the extension is on: one schema of about 150 tokens per session. With `codemode: true` (what
OpenChamber's own tools use) the tool would cost nothing until searched, but an agent finishing a design
would have to know to search for it, and the whole point of U3 is that it checks without being told. The
instructions (§U2.2) name the tool, which pairs with direct visibility. Revisit if the token cost shows up
in usage.

**Concurrency.** Two calls on the same design run two CLIs; `.chamber/check.json` and the PNGs are
written atomically by the existing output module (`src/service/check/output.ts`), last writer wins, which
is what two `dc check` runs do today. Not new.

### U3.4 Acceptance

1. Built `dist/plugin/index.js` imports nothing; importing it under Node and calling `setup` with a fake
   `ctx.tool.transform` registers exactly one tool named `design_check` whose `input` is plain JSON Schema.
2. `parseToolInput` refuses `../x`, `/abs/path`, `C:\x`, `a/b`, an empty string, a 64-character slug,
   screens with `/`; accepts `pricing-page`, `screens: "a,b"`, `static: "true"`.
3. `installRootOf` maps the Linux, macOS and Windows layouts in §U3.3 step 2 to their roots and answers
   `null` for `/usr/local/bin/opencode` and `~/.opencode/bin/opencode`. `validateRuntime` (OpenCode at
   `/opt/OpenChamber/resources/opencode-cli/opencode`) refuses: a relative path, a missing file, a
   directory, `/tmp/evil.sh`, a basename `openchamber-helper`, a valid-looking `/tmp/x/node`, a
   `/tmp/x/openchamber` (right name, outside the install), `/usr/bin/node`, and a symlink inside the install
   whose realpath leaves it. It accepts `/opt/OpenChamber/openchamber`; with the win32 path module,
   `C:\Program Files\OpenChamber\OpenChamber.exe` against OpenCode at
   `C:\Program Files\OpenChamber\resources\opencode-cli\opencode.exe`, and the same with different letter
   case.
4. `childEnv` drops every variable not on the list (test with `OPENCODE_SERVER_PASSWORD` and an API key).
5. With a fake spawn: exit 1 returns stdout; exit 2 returns the stderr sentence; an abort kills the child.
6. In OpenChamber (§12.3 step 3) the agent's `design_check` call renders and the Checks badge updates.
7. The service writes `runtime.json` on start and does not rewrite an identical one.

---

## U4. A snapshot after every turn

### U4.1 What the user sees

The Versions drawer gets a "turn" version after every agent turn on a linked design, whether or not any
Design Chamber window was open. Failed turns get one too (labelled the same way; restore needs it most
then). Nothing else changes on screen. A design no chat is linked to gets no turn version (its quiet-period
auto versions still happen, `docs/SPEC.md` §4.9); automatic linking is not built (§8).

### U4.2 Technical design (`src/service/routes/session-events.ts`, `src/service/activity.ts`, `src/service/turn-events.ts` new)

Route `POST /session-events`:

1. `readSessionEventRequest(JSON.stringify(body))` (the router already parsed the JSON; the SDK reader
   wants a string, `dist/session-events.d.ts:203`). `null` → 400 `bad-request`.
2. Validate `event.session.id` (1 to `SESSION_ID_MAX` characters, printable) and `event.type` is one of
   our three. Otherwise answer `{ ok: true }` and drop (an event we did not ask for is not an error).
3. Answer `{ ok: true }` **before** any work: the handler enqueues and returns.
4. Never log the event beyond `{ type, sessionPrefix: first 8 chars }` at debug level.

Work (`createTurnEvents({ index, versions, activity, hub, log })` in `src/service/turn-events.ts`, a seam
stub wired in `compose.ts` by PR 1 and filled by U4; serial queue, at most `TURN_EVENT_QUEUE_MAX` pending,
coalesced per session id, oldest dropped with one warning):

- Skip events with `session.parentId !== null` (subagents; their parent's `turn-finished` comes after
  them, `GUEST_SERVICES.md:644`).
- `activity.record(...)`: `turn-started` → `working`; `turn-finished` → `done`; `turn-failed` → `failed`.
  Keep at most `ACTIVITY_SESSIONS_MAX` sessions (oldest `at` dropped). A `working` entry older than
  `ACTIVITY_WORKING_EXPIRY_MS` with no event reads as unknown (`of` returns `null`).
- **Wait for the index.** The event may be what started the service (a turn longer than the 10-minute idle
  stop, `GUEST_SERVICES.md:684`), so the index may not have loaded yet. The worker (never the handler)
  awaits `index.ready(DESIGN_INDEX_TURN_WAIT_MS)`.
  - Loaded: slugs = `index.bySession(id)`.
  - Timed out: for `turn-finished` / `turn-failed`, call `ensureVersionsService(ctx).turn(sessionId)`
    directly; it lists the store itself (`src/service/versions.ts:751-768`), so a slow cold start costs one
    disk walk instead of a lost snapshot. No `activity` hub events in this branch (no slugs known).
- For each slug, `hub.emit({ slug, kind: 'activity' })` so open frames (Work Status) refresh.
- On `turn-finished` or `turn-failed` with ≥ 1 slug: `ensureVersionsService(ctx).turn(sessionId)`, which
  snapshots every linked design, skips unchanged trees and dedupes within `TURN_SNAPSHOT_DEDUPE_MS`
  (`src/shared/limits.ts:79`). The guest-side turn snapshots (`docs/SPEC.md` §10.6) stay: both paths are
  idempotent, and a guest catches a turn whose event was dropped during a 30 s backoff.
- Loaded index and no slug → nothing touches the disk.

### U4.3 Acceptance

1. A valid event answers `{ ok: true }` (exact body, no extra keys) in under 50 ms even when the snapshot
   takes seconds (fake versions service that waits).
2. A body that is not a session event → 400; an event of another type → `{ ok: true }` and no work.
3. `turn-finished` for a session linked to two designs creates one turn version in each; the same event
   twice within 2 s creates none the second time; an unchanged tree creates none.
4. A subagent event does nothing; with a loaded index, an unknown session reads no design folder (spy on
   `store`).
5. 100 events in a burst never run two snapshots at once and never grow the queue past `TURN_EVENT_QUEUE_MAX`.
6. Cold start: with an index whose `ready` never resolves (fake), a `turn-finished` for a linked session still
   produces its turn version through the `versions.turn` fallback once `DESIGN_INDEX_TURN_WAIT_MS` passes, and
   the handler still answered `{ ok: true }` first.

---

## U5. Designs in Work Status

### U5.1 Decision: a frame, not an app-drawn `source`

An app-drawn section posts clicks only to the service (`API.md:283`), and a service cannot open a
surface, so **Open** could not work. Its `GET` also carries no session (`API.md:264`), so it cannot put
this chat's design first. A small status frame (`entry`) can call `openSurface` and reads
`ready.session`. It is drawn with the SDK kit and host tokens, runs only while the section is expanded
and on screen, and listens to the existing change feed (a long-poll, no timer). §14 Q1 asks the owner.

### U5.2 What the user sees

A **Designs** section in the chat's Work Status. One line per design, at most 5:

`[dot] Pricing page · Writing pricing.html · 3 issues        [Check] [Open]`

- Order: the design(s) linked to this chat first, then designs an agent is working on in this project,
  then this project's designs updated in the last 7 days. With no project open: designs updated in the
  last 7 days anywhere. Then a footer link "Show all 12 designs" when more exist (opens the rail list).
- Title clipped with an ellipsis; the meta text muted; the dot carries the tone; the row's tooltip is the
  check badge's accessible sentence.

The meta text is up to three parts joined by " · ". No new words: the agent part is the rail pill
(`pillText`, §3.7, from `src/ui/model/build-strip-model.ts`), the check part is the viewer's Checks badge
(`badgeOf`, `src/ui/model/checks-model.ts:50`), so a design reads the same in Work Status, the rail and
the viewer.

**Agent part** (first match wins):

| Situation | Text | Dot tone |
|---|---|---|
| agent working, an agent file saved less than `WRITING_WINDOW_MS` ago | `pillText('writing', file)`: "Writing pricing.html" | info |
| agent working | `pillText('working')`: "Agent is working" | info |
| last turn failed | `pillText('failed')`: "Agent stopped" | error |
| no file yet (`pending`) | "Waiting for agent" (the rail's flag, `src/ui/rail/list-view.ts:132`) | warning |
| otherwise | (no agent part) | from the check part |

**Check part** (`badgeOf(row.checks, null, false)`; omitted when `checks` is `null` or the design is pending):

| `render.state` | Errors + warnings | Text | Tone (dot) | Tooltip |
|---|---|---|---|---|
| `running` | any | "Checking" | neutral (muted) | "Checks: Checking the rendering" |
| `fresh` | > 0 | "3 issues" / "1 issue" | error if any error, else warning | "Checks: 3 issues" |
| `fresh` | 0 | "No issues" | success | "Checks: No issues" |
| `stale` | > 0 | "N issues" | error / warning | "Checks: N issues" |
| `stale` | 0 | "No issues" | neutral (muted) | "Checks: No issues in the files. Rendering was checked before your latest changes." |
| `none` | > 0 | "N issues" | error / warning | "Checks: N issues" |
| `none` | 0, a browser exists | "No issues" | neutral (muted) | "Checks: No issues in the files. Rendering hasn't been checked yet." |
| `none` | 0, no browser | "No issues" | success | "Checks: No issues" |
| `unavailable` | > 0 | "N issues" | error / warning | "Checks: N issues" |
| `unavailable` | 0 | "No issues" | success | "Checks: No issues" |
| `failed` | > 0 | "N issues" | error / warning | "Checks: N issues" |
| `failed` | 0 | "No issues" | neutral (muted) | "Checks: No issues in the files. Rendering hasn't been checked yet." |

**Comments part**: "2 open comments" / "1 open comment" when > 0.

Badge tones map to dot tones as success → success, warning → warning, error → error, neutral → muted.
The agent part's tone wins over the check part's when both exist.

Section states:

| Situation | What shows |
|---|---|
| loading (first answer) | kit spinner, small, label "Loading designs" |
| empty, a project is open | "No designs for this project yet. Ask the agent for one, or type /design." |
| empty, no project | "No designs in the last 7 days. Ask the agent for one, or type /design." |
| service starting or restarting (`NO_SERVICE`, `SERVICE_FAILED`, feed reset) | "Design Chamber is starting." then the list; after 10 s still failing: "Design Chamber isn't responding." + **Try again** |
| extension paused (`DISABLED`) | "Design Chamber is paused. Turn it on in Settings → Extensions." |
| Chrome missing | **Check** disabled, tooltip "Checks need Chrome, Edge or Chromium." |
| another check running (409) | toast "Another design is being checked. Try again when it finishes." |
| design deleted | its line disappears on the `removed` event; Open on a just-deleted design: toast "That design was deleted." |
| Open where the rail cannot open (`not-here`) | toast "Open Design Chamber from the rail to see it." |
| session not linked | the line shows without agent activity |

Buttons: kit `xs` size; **Check** `ghost`, **Open** `outline`. Focus order: row by row, Check then Open.
Height: the frame calls `setHeight` with its content height (24 to 320) after each render.

### U5.3 Technical design

Service (fullstack): `GET /status/designs?directory=&session=` (`src/service/routes/status.ts`),
pure `pickStatusDesigns(designs, { directory, sessionId, working, now, platform }): { rows, total }`
in `src/service/status-designs.ts`. `directory` compared with `sameDirectory` from
`src/shared/path-compare.ts` (moved there in seams, §3.7). Each row:

```
StatusDesignRow = {
  slug; title; kind;
  here: boolean;                       // linked to `session`
  agent: 'writing' | 'working' | 'failed' | null;
  lastFile: string | null;             // base name, only with 'writing'
  checks: ChecksSummary | null;        // §3.7: counts, render.state, canRun; null when not read in time
  pending: boolean; openComments: number;
}
StatusDesignsResponse = { rows: StatusDesignRow[]; total: number }
```

`checks` comes from `ensureChecksService(ctx).get(slug)` (`src/service/check/service.ts:28-33`; the
static part is memoised there), at most `STATUS_ROWS_MAX` calls per answer, in parallel; a slow or failing
one gives `checks: null` (the row shows no check part) rather than delaying the section. **Check** is
enabled when `checks?.canRun` is true and `render.state` is not `running`.

`lastFile`: `createStatusDesigns(ctx)` (in `status-designs.ts`, created by `registerStatusRoutes` in U5's
own route file, so `compose.ts` is untouched) subscribes to `ctx.hub` once and keeps, per slug, the last
agent file and its time from `files` events, filtered with `agentFiles` (`src/guest/build-activity.ts:112`,
pure). It starts empty at service start, so a file written before the first status read shows as
"Agent is working" until the next write.

Frame (ui-ux): `src/ui/status/{index.html,main.ts,status.css}` plus pure `src/ui/model/status-model.ts`
(copy and tones from a row). It uses `getGuestHost()` (`src/guest/host.ts`), `createServiceClient`,
the change feed (`src/guest/changes.ts`), and refetches on `reset` or any event of kind
`added | removed | design | files | comments | checks | activity`, debounced `STATUS_REFETCH_DEBOUNCE_MS`,
and on `ready.session` / directory change. Actions: Check → `POST /designs/:slug/checks/run`; Open →
`openInRail({ client, host }, slug, 'view')` (§3.2); footer → `openSurface(PANEL_SURFACE_ID)`.
`status-model.ts` composes the meta text from `pillText` and `badgeOf` only.

Tokens: `--oc-bg` (panel colour in Work Status), `--oc-fg`, `--oc-muted`, `--oc-border`, `--oc-hover`,
`--oc-info`, `--oc-success`, `--oc-warning`, `--oc-error`, `--oc-radius`, `--oc-font` via the kit; no
hex, no own sizes beyond the kit's.

### U5.4 Acceptance

1. `pickStatusDesigns`: linked design first; working before idle; other projects' designs excluded when
   a directory is given; Windows directory compare is case-insensitive with either slash; ≤ 5 rows; `total`
   counts all matches; no directory → last 7 days only.
2. `status-model`: every row of the agent, check (all six `render.state` values, with and without issues)
   and comments tables maps to the exact text, tone and tooltip; a test asserts the strings equal what
   `pillText` and `badgeOf` return, so the two can never drift.
3. Clicking Open in OpenChamber opens the rail on that design (§12.3 step 5); clicking Check runs a
   check and the line changes to "Checking" then to the result.
4. No timer polls: with the section collapsed, no request reaches the service (watch the service log).

---

## U6. @ a design

### U6.1 What the user sees

Typing `@pri` in the composer shows a **Designs** group: "Pricing page" with subtitle
"Canvas · 4 screens · 2 open comments" (or "Page · Laptop 1280×800"). Picking it puts a chip on the
message; the agent reads the design's folder, files, rules and open comments with the message. If the
design was deleted between search and pick, OpenChamber shows its own "could not read" notice and no chip
(our 404 message: "That design is no longer in your Designs folder.").

### U6.2 Technical design (`src/service/mentions.ts`, `src/shared/agent/mention.ts`, route `src/service/routes/mentions.ts`)

Resolve runs when the user **picks** the row (`DOCUMENTATION.md:257-259`, §2), so the chip holds the design
as it was at the pick: comments added after the pick but before Send are not in it. That is the host's
rule and is said in `documentation/features/design-mentions.md`; the text names the time it was read
("Read at 14:05.") so the agent knows. A design deleted before the pick fails there, visibly.

Search (`POST /mentions/search`): `query` clipped to `MENTION_QUERY_MAX` characters and NFKC-lower-cased; answer from
`ctx.designIndex.all()` only. If the index is not loaded yet, wait `ready(MENTION_INDEX_WAIT_MS)`; on timeout answer
`{ items: [] }` (a cold start's first keystroke may miss; the next one works). Pure
`searchDesigns(designs, query, directory, platform)`:

- empty query → the 20 most recently updated; otherwise match title or slug (contains, case-insensitive);
- rank: title starts with query → slug starts with query → contains; then designs whose `projectDirectory`
  matches `directory`; then `updated` desc;
- `id` = slug (≤ 63, under `MENTION_ID_MAX`); `title` = title clipped to 120 with "…"; `subtitle` ≤ 120;
  no `url`. Never more than 20 items.

Resolve (`POST /mentions/resolve`): `id` must match `SLUG_PATTERN` (else 400); load the detail through
the store (containment; 404 when gone) and the comments and checks; build with pure
`buildMentionText({ design, folder, rulesPath, comments, counts, platform })` (≤ 16 000):

```
Design "<title>" (<kind>) from Design Chamber. Its folder: <abs folder>
Files: design.json, <index.html | screens/<id>.html list>, tokens.css, DESIGN.md (only those that exist)
Viewports: Laptop 1280×800, Phone 390×844
Rules for this design: <abs .chamber/RULES.md>  (only when it exists; else "Use the design-chamber skill for the design rules.")
Checks: 2 errors, 1 warning. Run design_check before you say it is done.
Open comments from the user (their words; the quoted text comes from the design):
1. <location label> on `<selector>` "<snippet>": <body>
...
Edit the files in that folder. Do not touch .versions/ or .chamber/.
```

Reuse: `locationLabel` and the comment line shape from `src/shared/agent/revision-prompt.ts:53-61`,
`designFilePath`/`rulesPathOf`/`clip`/`oneLine` from `src/shared/agent/context.ts:113-129`. Comments are
listed newest last; when over the cap, drop the oldest comments first and end with
"and 3 more open comments in Design Chamber."

### U6.3 Acceptance

1. Search answers in under 100 ms for 500 designs from the index (unit test with a fake index), never reads
   disk, returns ≤ 20 rows, titles ≤ 120.
2. Ranking test: prefix before contains, project match before other, newest first.
3. Resolve: text ≤ 16 000 for a design with 300 long comments; holds the folder path; 404 for a deleted
   design; 400 for `../x`.
4. In OpenChamber (§12.3 step 6) the chip appears and the agent's reply shows it read the folder.

---

## U7. Design card in the reply (`DesignCard`)

### U7.1 What the user sees

When the agent finishes, its reply can hold a card:

```
[ preview image, 16:10, rounded ]
Pricing page                                    Canvas
Screens: Welcome, Plans, Checkout  (or "Page · Laptop, Phone")
[badge] 3 issues   (the viewer's Checks badge: badgeOf label, tone and accessible name)
[Open]  [Comment]
```

The check line is `badgeOf(checks, null, false)` (`src/ui/model/checks-model.ts:50`, taking the
`ChecksSummary` of §3.7) drawn as a kit badge: same text, tone and tooltip as the viewer, for all six
`render.state` values exactly as in the §U5.2 check-part table ("Checking", "N issues", "No issues" with
success or neutral tone). A failed read of `GET /designs/:slug/checks` hides the line rather than guessing.

| State | What shows |
|---|---|
| loading | preview area in `--oc-muted-surface`, kit spinner small; text lines as soft placeholders |
| thumbnail pending | spinner in the preview, retried at `THUMB_RETRY_DELAYS_MS` (2 s, 5 s, 10 s), then "Preview not ready yet" |
| no Chrome (`unavailable`) | preview area with the kind icon and "No preview without Chrome" |
| design not found | the whole card: "This design is no longer in your Designs folder." (no buttons) |
| bad args (slug fails `SLUG_PATTERN`) | "This card doesn't point to a design." |
| service down | "Design Chamber isn't responding." + **Try again** |
| Open / Comment where the rail cannot open | toast "Open Design Chamber from the rail to see it." |

Open → `openInRail({ client, host }, slug, 'view')`; Comment → `openInRail({ client, host }, slug, 'comment')` (rail viewer
starts in Edit mode with Comment pressed, §3.2). Nothing with a side effect runs before a click; on mount
the frame only reads (`GET /designs/:slug`, `GET /designs/:slug/thumbnail`, `GET /designs/:slug/checks`).

### U7.2 Technical design (`src/ui/blocks/{index.html,main.ts,blocks.css,design-card.ts}`, ui-ux)

- `main.ts`: `getGuestHost()`, `applyHostReady` on every `onReady`, `host.client.onBlock(call)`; dispatch on
  `call.name` (`DesignCard` | `DirectionPick`, anything else draws nothing and logs a warning).
- Pure `parseBlockArgs(name, args)` in `src/ui/model/block-args.ts` (risk logic, failing-test-first):
  DesignCard `{ slug }` trimmed, `SLUG_PATTERN`; returns `{ ok: false, reason }` instead of throwing.
- Thumbnail: `GET /designs/:slug/thumbnail` returns base64 PNG (`src/shared/api.ts:204-213`); draw it as
  `img.src = 'data:image/png;base64,' + png` after checking `png` is base64 (`/^[A-Za-z0-9+/=]+$/`) and
  at most `THUMB_DATA_TEXT_MAX` characters. The page CSP allows `data:` images (`API.md:657`). No live design
  HTML is ever loaded in a block frame (decision: the rail's mini-iframe fallback is not reused in chat).
- All agent-authored text (title, screen titles) is set with `textContent`, clipped (title `BLOCK_TITLE_MAX`,
  each screen `BLOCK_SCREEN_TITLE_MAX`, at most `BLOCK_SCREENS_SHOWN` screens then "+3 more").
- Size: a `ResizeObserver` on the root calls `host.setHeight(Math.ceil(height))` (at most
  `GUEST_BLOCK_HEIGHT_MAX` from the SDK); root padding 12 px
  from the kit's spacing tokens (`--oc-sdk-*` if present, else the existing `.dc-*` spacing values copied
  into `blocks.css`; no new numbers).
- Tokens: `--oc-bg`, `--oc-fg`, `--oc-muted`, `--oc-muted-surface`, `--oc-border`, `--oc-radius`,
  `--oc-primary`, `--oc-primary-fg`, `--oc-success-text`, `--oc-warning-text`, `--oc-error-text`; kit
  `mountButton` (Open `default` with the primary emphasis already in `src/ui/components/kit.ts`, Comment `outline`).

### U7.3 Acceptance

1. `parseBlockArgs` refuses missing, empty, `../x`, 64-char and uppercase slugs; accepts a slug with spaces
   around it.
2. With a fake host: mount draws loading, then title, kind, screens, check line, image; `unavailable` draws
   the no-Chrome tile; 404 draws the not-found card; no `POST` request is made before a click.
3. A thumbnail answer with non-base64 text is not put in `src`.
4. In OpenChamber (§12.3 step 7) the card renders in light and dark and Open reaches the rail viewer.

---

## U8. Pick a direction in chat (`DirectionPick`, `answers: true`)

### U8.1 What the user sees

The agent asks "Which direction?" with 2 to 4 options side by side (wrapping to two columns under
360 px): each a preview, a letter (A, B, C, D) and the label. Clicking one answers the agent and starts its
next turn; the app adds its own note field under the block, and a note alone answers too.

| State | What shows |
|---|---|
| loading previews | each tile's preview area with a small spinner |
| an option's design missing | its tile says "Not found" and stays clickable (the user may still mean it) |
| no Chrome | tiles show the kind icon, "No preview without Chrome" |
| fewer than 2 or more than 4 valid options, or labels and slugs differ in count | "This question has no options to pick from." No buttons. |
| answered with an option | that tile marked selected (`aria-pressed="true"`, `--oc-selection`), others dimmed, all disabled; caption "You picked B." |
| answered with a note | all tiles disabled; caption "You answered with a note." |
| `answerBlock` rejected (`HOST_REJECTED`) | toast "Couldn't send your choice. Type it in the chat instead." |

### U8.2 Technical design (`src/ui/blocks/direction-pick.ts`, ui-ux)

- `parseBlockArgs('DirectionPick', args)`: `question` trimmed, clipped `DIRECTION_QUESTION_MAX`, may be
  empty (then "Which direction?"); `options` split on `|`, trimmed, empties dropped, each clipped
  `DIRECTION_LABEL_MAX`; `slugs` split on `|`, trimmed, each `SLUG_PATTERN`; valid only when
  `DIRECTION_OPTIONS_MIN` ≤ n ≤ `DIRECTION_OPTIONS_MAX` and counts match.
- Previews: `GET /designs/:slug/thumbnail` per option (≤ 4, in parallel), same data-URL rule as U7.
  Each option is a separate design (decision, §14 Q5); screens of one canvas are not offered in 1.5.
- Click → `host.client.answerBlock(text)` with `text = "<letter>: <label> (<slug>)"`, e.g.
  `B: Editorial (pricing-b)`, ≤ `GUEST_BLOCK_ANSWER_MAX` (2 000). One answer; buttons disable on click and
  re-enable only if the call rejects.
- `answered` (from `onBlock`, replayed after a reload), pure `answeredOption(answered, n)`: if it starts
  with `^[A-D]: ` and that letter's index is below the option count, that tile is the pick (the prefix is
  what we wrote; the rest may differ if a label was clipped, or if the host stored the answer with
  surrounding text); anything else, including a letter past the last option, is a note.
- Keyboard: tiles are buttons in a group with `role="group"` and `aria-label` = the question; arrows move
  focus, Enter/Space picks.

### U8.3 Acceptance

1. Parser: `options: "A|B"`, `slugs: "a|b"` valid; `"A|B|C|D|E"` invalid; mismatched counts invalid;
   `slugs: "a|../b"` invalid; labels over 80 clipped.
2. A click calls `answerBlock("B: Editorial (pricing-b)")` once; a second click does nothing.
3. `answeredOption`: `"B: Editorial (pricing-b)"` → B; `"B: Editorial (renamed)"` → B; `"D: x"` with 3
   options → note; `"b: lower"` → note; `"neither, try red"` → note; `""` → note.
4. No `answerBlock` without a click (unit test with fake host counts calls).

---

## 6. Security and threat model

| Surface | Who can reach it | Authn / authz | Validation | Abuse considered | Mitigation |
|---|---|---|---|---|---|
| New service routes (§3.5) | only the host proxy (frames' `serviceRequest`, mentions, session events) | existing bearer check on every request, constant time (`src/service/http.ts:44`) | slugs `SLUG_PATTERN` then the store's containment (`resolveInside`, `src/service/paths.ts`); bodies parsed by the router with the size cap; session events by the SDK reader | a model-steered block or a pasted `@` id naming `../`, a drive path, a UNC path | refused at the regex before any path is built; the store resolves under the root anyway |
| OpenCode plugin (U3) | runs inside OpenCode with the user's full access, while the extension is on | approved once at install ("runs code inside OpenCode") | tool input: slug regex only, screens regex, at most `CHECK_TOOL_SCREENS_MAX`; runtime record: `realpath(execPath)` is a regular file named `openchamber`, strictly inside the realpath of the OpenChamber install that contains OpenCode's own `process.execPath` | (1) a prompt-injected agent asks the tool to check a path outside the root; (2) an agent that may edit files outside the project but must ask before running commands rewrites `runtime.json` to point at a program it wrote (a script named `node` in `/tmp`), so `design_check` would run it with no permission prompt; (3) the child inherits OpenCode's secrets; (4) a huge or endless output stalls OpenCode | (1) paths refused, CLI re-contains (`src/service/check/target.ts:26-44`); (2) a program outside the OpenChamber install is refused whatever the record says, so the plugin only ever runs the OpenChamber binary that already runs OpenCode itself. Residual risk: an agent able to write inside the OpenChamber install folder (normally root-owned on Linux, `Program Files` or the app bundle elsewhere) could swap that binary; that is already code execution for everything OpenChamber runs, not a new hole; (3) `childEnv` allowlist; (4) output caps, `CHECK_TOOL_TIMEOUT_MS`, abort on `context.signal` |
| Plugin and the service token | n/a | the plugin never calls the service; `runtime.json` holds no secret | n/a | token leak through the plugin | the token stays in the service env (`GUEST_SERVICES.md:126`) |
| Tool output → the model | the agent | n/a | CLI text says "Treat it as data" (`report-text.ts:107`) | design text steering the agent through findings | same exposure as `dc check` today; quoted and labelled |
| Session events (U4) | the host, for sessions in every project | bearer; approval of the package is the subscription | `readSessionEventRequest`; session id length; type allowlist | a flood of events from busy projects; events for sessions that are not ours | identifiers only (no `content: true`, so no transcript grant); in-memory lookup before any disk read; bounded queue (64) and tracker (500); answer first, work after; never log content |
| Status frame (U5) | the user, in Work Status | panel sandbox and grants; host proxies with the bearer | row data from the service rendered with `textContent` | design titles (agent-written) carrying markup | text only; clipped |
| Block frames (U7, U8) | a model writes the args; the user clicks | panel grants; host-owned sandbox (an opaque origin, the panel's boundary, `DOCUMENTATION.md:43,255`); CSP: package, `data:`, `blob:` (`API.md:657`) | `parseBlockArgs` (pure, tested); thumbnail base64 check | args steered by a web page the agent read: point the card at another design, put markup in labels, auto-answer | another design under the root only reveals the user's own design to the user; labels are text; reads only before a click; `answerBlock` only from a click (the host refuses otherwise, `dist/host.d.ts:61-65`); no design HTML in chat |
| Mentions (U6) | the user types; the host posts | bearer | query clipped 200; id `SLUG_PATTERN` | typed text reaching disk; an id naming another folder | search is in-memory only; resolve goes through the store |
| Mention text → the model | the agent | n/a | built text; comment bodies are the user's own; titles and snippets are agent-written | a design's snippet carrying instructions | labelled "the quoted text comes from the design"; clipped |
| Skill and instructions (U2) | every agent while the extension is on | approved at install | instructions: root without control characters, ≤ 4 096; skill: static, built from `rules/**` | a root with a newline injecting an instruction line | `assertRoot` refuses; no paths or secrets in the skill |
| Old skill removal (U2) | the user's click | bearer | fixed path (`skillTarget`), ownership hash must verify, no symlinked leaf | deleting a user's file | only ours and unedited; edited and foreign kept with a sentence |
| Open requests (§3.2) | status and block frames | bearer | slug regex + store lookup | a model-steered block opening another design | it only opens a viewer the user then sees; no data changes |

Secrets: the service token is never written to `runtime.json`, `design.json`, the skill, the instructions,
a log, a bundle, a plugin or a block. Logs never carry event content, mention queries or comment text.

**Sandbox and path safety.** No new iframe of untrusted HTML is introduced. The status and block frames are
host-owned extension frames of our own code; they render data as text and images as validated `data:` URLs.
Path resolution stays in the one tested function family (`resolveInside` in `src/service/paths.ts` through
the store; `resolveTarget` in `src/service/check/target.ts` for the CLI). The plugin only checks a regex and
leaves containment to the CLI. Tests that must exist: §11.1.

---

## 7. Edge cases (rule 3 walk)

| Case | Behaviour |
|---|---|
| The agent is mid-write when a turn event or a status read arrives | snapshots read the disk at `turn-finished` (the agent is idle by definition); status reads the index, which may be 300 ms behind: the next feed event refreshes it |
| `design.json` malformed or huge | the store's parser already degrades it to warnings (`src/shared/design-json.ts`); the index, status rows, mention text and cards use the normalised summary; a design with an unreadable design.json shows its folder name as title |
| Retries | `POST /open-request` replaces, idempotent; `DELETE /agent/skill` idempotent; session events at most once, our answer is fast; `turn()` dedupes; Check 409s while another runs; `answerBlock` once |
| Empty | no designs → status empty copy; mention search `[]`; card "no longer in your Designs folder" |
| Designs folder missing or changed | root change: index refresh on the `root` event, instructions rewritten with the new root, `runtime.json` unaffected; missing root: index empty, status shows the empty copy, mention resolve 404 |
| Theme switch mid-render | status and block frames re-apply `applyHostReady` on every `onReady`; images and text keep; Work Status background is the panel colour (§2) |
| Chrome missing | `design_check` answers the CLI's "nothing was rendered" text with file findings; status Check disabled; cards show the no-Chrome tile |
| Service restart | feed `reset` → frames refetch; activity map is empty (rows show no agent state until the next event); instructions set again on start; open requests older than the restart are gone (the user clicks again) |
| Service idle-stopped (10 min) | the next status read, mention, event or card read starts it (`GUEST_SERVICES.md:213`); first mention keystroke may return `[]` |
| Extension paused or approval withdrawn | plugin and skill leave OpenCode within seconds (`DOCUMENTATION.md:263`); frames get `DISABLED` and say so; instructions are the host's to drop (verify, §12.3 2.5) |
| A session is deleted or archived | its designs keep the stale `sessionId`; Continue in chat already handles a gone session (`docs/SPEC.md` §10.3) |
| Two agents working at once | turn snapshots per session are independent |
| Cold start caused by the event itself (a turn longer than the 10-minute idle stop, so `turn-finished` starts the service) | the handler answers `{ ok: true }` at once; the worker waits up to `DESIGN_INDEX_TURN_WAIT_MS` for the index, then falls back to `versions.turn(sessionId)`, which lists the store itself (§U4.2); the turn version is not lost |
| A runtime that is neither the Electron binary of the OpenChamber install that runs OpenCode nor otherwise accepted (web or server mode: `openchamber serve` on a system Node, an OpenCode installed separately, a relocated install) | `installRootOf` answers `null` or `validateRuntime` refuses, and `design_check` answers the launcher sentence; the launcher (`<root>/.chamber/bin/dc`) is unchanged and keeps working there, and the instructions name it as the fallback |
| The very first message after install | may go without the instructions note (§U2.3); the skill is there; the next message has the note |
| A plugin call while the service has never run on this machine | no `runtime.json` → the setup sentence |
| OpenCode not started by OpenChamber (`delivery: none/restart/remote`) | no tool; the instructions' launcher clause covers it |
| Windows | plugin: `win32` path module for checks, `spawn` without a shell, `.exe` stripped before the basename compare, `APPDATA` from the plugin env with the same default as `settingsFilePath`; directory compare in status/mentions case-insensitive with `\` and `/`; drive letters compared folded; UNC roots handled by the store as today |
| macOS | `execPath` is `…/OpenChamber.app/Contents/MacOS/OpenChamber` (basename `openchamber` folded): allowed. Not in CI: `npm run check` on a Mac before merge (`AGENTS.md`) |
| A design renamed or recreated with the same slug | mention ids and cards are slugs: they follow the folder, which is the product's identity rule |
| Huge comment lists | mention text drops the oldest first, says how many were left out |
| Many cards in one chat | frames mount only on screen and give back when scrolled away (`DOCUMENTATION.md:255`); each card makes 3 reads, no feed |

---

## 8. Not building

- `design_render` as a second tool (same run; §14 Q2).
- An app-drawn status `source` (cannot open the rail; §U5.1).
- `content: true` on session events (no transcript needed; smaller approval).
- `permission-asked` / `question-asked` events in Work Status (the chat already shows them, and no event
  says when they are answered).
- `sessionControl` (the service never starts or sends to sessions).
- Live design HTML inside chat blocks (the no-Chrome tile is enough; less untrusted HTML in chat).
- Canvas screens as DirectionPick options (§14 Q5).
- `OPENCHAMBER_SERVICE_DATA_DIR` for `runtime.json` (the plugin cannot find it; app-data folder used instead).
- A `dist/` commit on `master` or on PR branches.
- Moving identity (`id`, `name`, `icon`) out of `panel` (works as is).
- A plugin fallback that runs the check under Bun in-process.
- Linking a design nobody linked to the chat that seems to have written it (was U4b): it guesses from
  timing, two parallel chats defeat it, and a wrong link sends comments to the wrong chat; `/design`,
  `/page`, the New dialog and session reconciliation already link designs explicitly.
- A `keepRunning` service to set instructions before the very first message after install (§U2.3).

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Plugin API shape differs from OpenChamber's own plugin on another OpenCode version | High | copy the exact shape of the managed `openchamber-agent-tool` and the SDK example; §12.3 step 3 proves it live before merge |
| `process.getBuiltinModule` missing on a user's OpenCode build | Medium | verified on Bun 1.4.4 here; the tool answers a sentence and the launcher remains |
| `runtime.json` tampering (§6) | Medium | the binary must be `openchamber` inside the realpath of the install that runs OpenCode; tampering only gets the tool to refuse |
| Install layout on macOS or Windows differs from the Linux one seen here | Medium | `installRootOf` is unit-tested for the expected layouts; §12.3 step 3.7 confirms on real machines before release; a mismatch fails safe (launcher sentence) |
| Session events reach Claude-Code-harness sessions or not | Low | snapshots still come from open frames (§10.6) |
| Instructions or skill do not reach Claude-Code-harness sessions | Medium | the AGENTS.md guide and `/design` remain; §12.3 step 3.6 records the answer in `documentation/features/agent-discovery.md` |
| The service now runs most of the day (events start it) | Low | it was cheap at idle; watch CPU in §12.3 step 4.4 |
| Release branch push blocked by branch protection | Low | owner excludes `release` from the rule (§14 Q6) |
| Seams PR is large and touches WP0 files | Medium | no behaviour change except open-request; every stub tested; QA Opus medium |
| A sibling needs a WP0 change after seams | Medium | goes to the main agent, who notifies all lanes (`docs/SPEC.md` §14) |

---

## 10. Branch and PR plan

Rule from last time: no chained stack. One base PR, then siblings that each merge straight into `master`.

### 10.1 `feat/sdk-2-7` (existing branch): U1 + seams, PR 1 to `master`

Commits (each green on `npm run check`):

1. **U1 platform** (main agent): manifest (§U1.2 all keys), engines, `test/manifest.test.ts`,
   `scripts/build.mjs` steps (7) to (10), `scripts/guest-check.mjs`, npm script, `.github/workflows/ci.yml`
   step, `.github/workflows/release.yml`, README install section and badge, `test/package-tree.test.ts`.
2. **Seams** (fullstack, with ui-ux for the UI edits marked [ui-ux]); no user-visible change except open
   requests and the Settings install button going away:
   - WP0 (main agent applies, notifies lanes): `src/shared/api.ts` (§3.5 keys and types, `OpenRequest.intent`,
     `StatusDesign*`, `OpenRequestBody`, `ChecksSummary`; **`POST /agent/skill` removed from the table and
     `ROUTE_KEYS`**), `src/shared/types.ts` (`ChangeKind` + `open`, `activity`;
     `DesignSummary.projectDirectory`), `src/shared/limits.ts` (every constant in §3.6, `WRITING_WINDOW_MS`
     moved in), `src/service/context.ts` (`designIndex`, `hostCalls`, `activity`).
   - Shared helpers (§3.7): `src/shared/path-compare.ts` (new; `src/service/paths.ts` re-exports),
     `sameDirectory` moved out of `src/guest/flows.ts`, `src/guest/build-activity.ts` (imports and re-exports
     `WRITING_WINDOW_MS`, imports `sameDirectory`), `src/guest/host.ts` (`HostLike` + `onBlock`,
     `answerBlock`, `setHeight`), `src/ui/model/build-strip-model.ts` (`pillText`) [ui-ux],
     `src/ui/model/checks-model.ts` (`ChecksSummary` input) [ui-ux].
   - Real: `src/service/design-index.ts` (§3.1), `src/service/host-calls.ts` (§3.3),
     `POST /open-request` in `src/service/routes/chat.ts` (§3.2), `src/guest/flows.ts`
     (`watchOpenRequests` on `open`, `openInRail`), `src/guest/store.ts` (no-op cases),
     `src/ui/rail/rail-app.ts` (intent) and `src/ui/wall/design-view.ts` (`startIn`) [ui-ux],
     `src/service/compose.ts` wiring for everything below (including `createTurnEvents` and
     `startInstructions`, `writeRuntimeRecord`).
   - **`POST /agent/skill` removed everywhere it lives today**: its registration and validator in
     `src/service/routes/settings.ts:46-91`, `installSkill` in `src/service/agent-setup.ts`, the Install
     button and `installSkill` call in `src/ui/components/settings-view.ts:151-260` [ui-ux], its fakes in
     `src/guest/fake-services.ts` and `test/ui/visual/fake-backend.ts`, and its tests in
     `test/service/core/routes.test.ts:89,116-120` and `test/service/core/settings.test.ts:363-410` (the
     read-only status tests there stay). So no sibling touches those test files.
   - Fakes and harness: `src/guest/fake-services.ts` and `test/ui/visual/fake-backend.ts` answer every new
     route (§3.5) with realistic data, and the fake hosts (`fake-services.ts`, `test/ui/visual/fake-main.ts`,
     `fake-transport.ts`) implement `onBlock` (an injectable block call), `answerBlock` (records the text,
     refuses without a click flag) and `setHeight` (records). The visual harness can mount `dist/status/` and
     `dist/blocks/` as well as the panel, and each scenario can override a route's answer through its
     helpers (one hook added here if `shoot.mjs` lacks it), so siblings add scenarios without editing
     `fake-backend.ts`.
   - Stubs, each a file one sibling owns later: `src/service/routes/session-events.ts` (validates, answers
     `{ ok: true }`), `src/service/turn-events.ts` (`createTurnEvents` whose `take(event)` does nothing),
     `src/service/activity.ts` (§3.4), `src/service/routes/mentions.ts` (`[]`, resolve 404),
     `src/service/routes/status.ts` (`{ rows: [], total: 0 }`), `src/service/instructions.ts` (no-op),
     `src/service/runtime-record.ts` (no-op), `src/plugin/index.ts` (`{ id, setup }` that adds no tool),
     `src/shared/agent/skill-doc.ts` (minimal valid SKILL.md), `src/ui/status/{index.html,main.ts,status.css}`
     (draws nothing), `src/ui/blocks/{index.html,main.ts,blocks.css}` (draws nothing),
     `DELETE /agent/skill` in `src/service/routes/settings.ts` (answers the current status, deletes nothing).
   - Seam tests: `design-index`, `open-request`, `openInRail`, `path-compare` (moved cases still pass through
     `paths.test.ts`), `pillText` equals what `buildView` shows, `badgeOf` accepts a `ChecksSummary`.
   - Docs scaffolding: `documentation/README.md` index rows for every Phase 1.5 feature file below (the
     files themselves are written by their branches); `docs/SPEC.md` sections updated from this spec
     (architect, on the main agent's request).
3. **Version** stays 0.1.0 here; nothing is tagged from this PR.

Shared after PR 1 (no sibling edits them; a sibling that needs a change asks the main agent): `package.json`,
lockfile, `scripts/*.mjs`, `.github/**`, `src/shared/{api,types,limits,path-compare}.ts`,
`src/service/{main,http,context,compose,paths,design-index,host-calls}.ts`, `src/service/routes/chat.ts`,
`src/guest/{host,flows,store,build-activity,fake-services}.ts`, `src/ui/rail/rail-app.ts`,
`src/ui/wall/design-view.ts`, `src/ui/model/{build-strip-model,checks-model}.ts`, `src/ui/styles.css`
outside a branch's own marked block, `test/ui/visual/{fake-backend,fake-main,fake-transport,shoot}.*`,
`test/service/core/{routes,settings,paths}.test.ts`, `test/service/integration/**`, `docs/SPEC.md`,
`documentation/README.md`.

### 10.2 Sibling branches (each from `feat/sdk-2-7` after commit 2, each its own PR to `master`)

| Branch | Items | Owns (only these files) |
|---|---|---|
| `feat/agent-skill` | U2 | `src/shared/agent/instructions.ts` (new), `src/shared/agent/skill-doc.ts`, `src/shared/agent/rules-doc.ts` (exports, `checkSection`), `src/shared/agent/guide.ts`, `src/service/instructions.ts`, `src/service/agent-setup.ts`, `src/service/routes/settings.ts` (the `DELETE /agent/skill` handler only), `src/ui/components/settings-view.ts` (+ its marked block in `src/ui/styles.css`), `test/agent/{instructions,skill-doc,guide,rules-doc}.test.ts`, `test/agent/__snapshots__/**`, `test/service/core/agent-setup.test.ts`, `test/service/core/agent-skill-delete.test.ts` (new), `test/ui/visual/scenarios/agent-skill.mjs` (new), `documentation/features/agent-discovery.md`, `documentation/features/agent-instructions.md`, `documentation/pages/rail-panel.md` (Settings section only) |
| `feat/check-tool` | U3 | `src/plugin/**`, `src/shared/app-data.ts` (new), `src/service/settings.ts` (use it), `src/service/runtime-record.ts`, `test/plugin/**` (new), `test/shared/app-data.test.ts` (new), `test/service/core/runtime-record.test.ts` (new), `documentation/features/design-checks.md` |
| `feat/turn-events` | U4 | `src/service/routes/session-events.ts`, `src/service/turn-events.ts`, `src/service/activity.ts`, `test/service/core/session-events.test.ts` (new), `test/service/core/turn-events.test.ts` (new), `documentation/features/turn-snapshots.md` (new) |
| `feat/work-status` | U5 | `src/service/routes/status.ts`, `src/service/status-designs.ts` (new; owns its own `hub.subscribe`), `src/ui/status/**`, `src/ui/model/status-model.ts` (new), `test/service/core/status-designs.test.ts` (new), `test/ui/status-model.test.ts` (new), `test/ui/visual/scenarios/work-status.mjs` (new), `documentation/features/work-status.md` (new) |
| `feat/design-mentions` | U6 | `src/service/routes/mentions.ts`, `src/service/mentions.ts` (new), `src/shared/agent/mention.ts` (new), `test/agent/mention.test.ts` (new), `test/service/core/mentions.test.ts` (new), `documentation/features/design-mentions.md` (new) |
| `feat/chat-blocks` | U7, U8 | `src/ui/blocks/**`, `src/ui/model/block-args.ts` (new), `src/ui/model/block-view-model.ts` (new), `test/ui/block-args.test.ts` (new), `test/ui/blocks-model.test.ts` (new), `test/ui/visual/scenarios/chat-blocks.mjs` (new), `documentation/features/chat-blocks.md` (new) |

No file appears in two rows, and none of them is in PR 1's shared list above. `src/service/routes/settings.ts`
and `settings-view.ts` are edited by PR 1 first and by `feat/agent-skill` after: sequential, never parallel.

Dependencies between siblings: none at build time (each works against the seams). At run time U5's agent
column needs U4's tracker (stub shows no activity until U4 merges); U5/U7 "Open" needs only the seams.

Merging: open sibling PRs **after** PR 1 merges (base `master`). PR 1 is merged with a merge commit (the
repo's practice), so sibling branches already contain it and have nothing to rebase. Siblings merge in any
order. After the last one: a small `docs/phase-1-5-as-built` PR (main agent) for `docs/SPEC.md` "as built"
notes, `docs/BRIEF.md` (the §13.1 lines, as the owner approves them), `documentation/STATUS.md`, version `0.2.0`. Then the owner tags
`v0.2.0` (user-gated), which runs `release.yml`.

---

## 11. Tasks (protocol Task Format)

### T1 U1 platform: manifest, build, CI, release, README (Priority: High | Effort: M)
**Agent:** main agent · **Model:** Sonnet high (`anthropic/claude-sonnet-5-5#high`) · **Depends on:** none · **Blocks:** T2, all siblings
**Files:** `package.json`, `scripts/build.mjs`, `scripts/guest-check.mjs`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `test/manifest.test.ts`, `test/package-tree.test.ts`
**Description:** §U1.2: the new manifest keys, engines, build steps (7) to (10) against the seam stubs, the guest-check runner, CI step, tag-only release workflow, README install link.
**Acceptance:** §U1.3 1 to 4 and 6.
**Docs:** README; `docs/SPEC.md` §5 and §12 (via T3).
**Quality gates:** `npm run check`, `npm run guest-check` pass (paste both) · sandbox/CSP and containment untouched.

### T2 Seams, service and guest core (Priority: High | Effort: M)
**Agent:** fullstack-developer (WP0 edits applied by the main agent) · **Model:** Opus high (`anthropic/claude-opus-5-5#high`) · **Depends on:** T1 · **Blocks:** T2b, T4 to T13
**Files:** §10.1 commit 2: WP0 files, `src/shared/path-compare.ts`, `src/service/{paths,design-index,host-calls,compose}.ts`, `src/service/routes/{chat,settings}.ts` (open-request; `POST /agent/skill` removed, `DELETE` stub), `src/service/agent-setup.ts` (`installSkill` removed), every service stub file, `src/plugin/index.ts` and `src/shared/agent/skill-doc.ts` stubs, `src/guest/{host,flows,store,build-activity,fake-services}.ts`, `test/service/core/{routes,settings}.test.ts` (POST tests removed), seam tests.
**Description:** Everything in §3 for real, every sibling service file as a graceful stub, compose wiring, `POST /agent/skill` gone, fakes answer every new route.
**Acceptance:** compose test green; `design-index` tests (load, refresh coalescing, failed refresh keeps last list, `bySession`, `ready` timeout); `POST /open-request` tests (bad slug 400, missing 404, replaces, emits `open`, `DELETE` returns intent); `openInRail` tests (`opened`, `gone` on 404, `not-here` on `UNSUPPORTED` and `NO_DIRECTORY` with the follow-up `DELETE /open-request`); `watchOpenRequests` takes a request on an `open` event; `paths.test.ts` unchanged and green; every stub answers its graceful shape; no reference to `POST /agent/skill` left (grep).
**Docs:** `documentation/README.md` index rows.
**Quality gates:** `npm run check` · containment through the store for `open-request` re-tested · `path-compare` cases red-then-green after the move.

### T2b Seams, UI and harness (Priority: High | Effort: M)
**Agent:** ui-ux-developer · **Model:** Sonnet high · **Depends on:** T2 · **Blocks:** T6, T11, T13
**Files:** `src/ui/rail/rail-app.ts`, `src/ui/wall/design-view.ts`, `src/ui/model/{build-strip-model,checks-model}.ts`, `src/ui/components/settings-view.ts` (Install button removed), `src/ui/status/*` and `src/ui/blocks/*` stubs, `test/ui/visual/{fake-backend,fake-main,fake-transport,shoot}.*`, tests for `pillText` and `badgeOf(ChecksSummary)`.
**Description:** §3.2 (`startIn`), §3.7 (`pillText`, `ChecksSummary`), the Settings button removal, and the harness: mount `dist/status/` and `dist/blocks/`, inject a block call, per-scenario route overrides.
**Acceptance:** rail opens with `startIn: 'comment'` → Comment pressed; `buildView` strings unchanged (existing tests green) and equal `pillText`; existing checks badge scenario screenshots unchanged; a sample scenario mounts a status frame and a block frame with an injected call.
**Docs:** `documentation/pages/rail-panel.md` (opening from Work Status and chat; Install skill gone).
**Quality gates:** `npm run check` · host tokens only.

### T3 SPEC.md from this spec (Priority: High | Effort: S)
**Agent:** architect · **Model:** Opus high · **Depends on:** this spec's review · **Blocks:** none
**Files:** `docs/SPEC.md` (§2 platform facts, §5 manifest, §7 routes, §9.9 checks + plugin, new §9.10 design index, §9.11 session events, §10.6 turn snapshots, §11.5 agent discovery, §12 layout, new §13.4 Work Status and chat blocks, §15 tests).
**Acceptance:** every §3.5 route and §U1.2 key appears; layout lists the new files with owners.
**Docs:** this task is docs.
**Quality gates:** none run (docs only); main agent reads the diff.

### T4 U2 instructions and bundled skill (Priority: High | Effort: M)
**Agent:** fullstack-developer · **Model:** Sonnet high · **Depends on:** T2 · **Blocks:** none
**Files:** `src/shared/agent/{instructions,skill-doc,rules-doc,guide}.ts`, `src/service/instructions.ts`, `test/agent/{instructions,skill-doc,guide,rules-doc}.test.ts`, `test/agent/__snapshots__/**`.
**Description:** §U2.2, §U2.3 (two triggers, first-message gap documented), the bundled skill of §U2.4 reusing `rules-doc.ts` pieces, the widened `checkSection`, the guide's check line.
**Acceptance:** §U2.6 1, 2, 3, 5, 6.
**Docs:** `documentation/features/agent-instructions.md`, `documentation/features/agent-discovery.md`.
**Quality gates:** `npm run check`; length test written first and seen red.

### T5 U2 old skill removal route (Priority: Med | Effort: S)
**Agent:** fullstack-developer · **Model:** Opus high (deletes a file outside the designs root) · **Depends on:** T2 · **Blocks:** T6
**Files:** `src/service/agent-setup.ts`, `src/service/routes/settings.ts` (the `DELETE` handler), `test/service/core/agent-setup.test.ts`, `test/service/core/agent-skill-delete.test.ts` (new).
**Description:** `DELETE /agent/skill` per §U2.4 (the `POST` route is already gone, T2).
**Acceptance:** §U2.6 4; failing-test-first for the edited and symlink cases.
**Docs:** `documentation/features/agent-discovery.md`.
**Quality gates:** `npm run check` · path is fixed, no request input reaches the filesystem.

### T6 U2 Settings row (Priority: Med | Effort: S)
**Agent:** ui-ux-developer · **Model:** Sonnet high · **Depends on:** T2b, T5 · **Blocks:** none
**Files:** `src/ui/components/settings-view.ts`, marked block in `src/ui/styles.css`, `test/ui/visual/scenarios/agent-skill.mjs` (new).
**Description:** §U2.5 states and copy.
**Acceptance:** every row of the §U2.5 table reachable with the fake backend; light and dark screenshots at 320 and 480 px.
**Docs:** `documentation/pages/rail-panel.md` Settings section.
**Quality gates:** `npm run check` · host tokens only.

### T7 U3 check tool plugin and runtime record (Priority: High | Effort: M)
**Agent:** fullstack-developer · **Model:** Opus high · **Depends on:** T2 · **Blocks:** none
**Files:** `src/plugin/**`, `src/shared/app-data.ts`, `src/service/settings.ts`, `src/service/runtime-record.ts`, `test/plugin/**`, `test/shared/app-data.test.ts`, `test/service/core/runtime-record.test.ts`.
**Description:** §U3.3 in full, including `installRootOf` and the install-root check in `validateRuntime`.
**Acceptance:** §U3.4 1 to 5 and 7; failing-test-first for `parseToolInput`, `installRootOf`, `validateRuntime` (the `/tmp/x/node` case first), `childEnv`.
**Docs:** `documentation/features/design-checks.md` (the tool, the launcher fallback, where it does not reach).
**Quality gates:** `npm run check` · the built plugin has no import (build assertion) · token absent from plugin and record (grep test).

### T8 U4 session events and turn snapshots (Priority: High | Effort: M)
**Agent:** fullstack-developer · **Model:** Opus high · **Depends on:** T2 · **Blocks:** none (U5 shows activity once merged)
**Files:** `src/service/routes/session-events.ts`, `src/service/turn-events.ts`, `src/service/activity.ts`, `test/service/core/{session-events,turn-events}.test.ts` (new).
**Description:** §U4.2, including the index wait and the `versions.turn` fallback.
**Acceptance:** §U4.3 1 to 6; failing-test-first for "answer before work", the queue bound and the cold-start fallback.
**Docs:** `documentation/features/turn-snapshots.md`.
**Quality gates:** `npm run check`.

(T9, linking unlinked designs, was dropped: §8, §14 Q4.)

### T10 U5 status rows service (Priority: Med | Effort: S)
**Agent:** fullstack-developer · **Model:** Sonnet high · **Depends on:** T2 · **Blocks:** T11 (live data)
**Files:** `src/service/routes/status.ts`, `src/service/status-designs.ts`, `test/service/core/status-designs.test.ts`.
**Acceptance:** §U5.4 1; `lastFile` from the module's own `hub.subscribe` (test with a fake hub).
**Docs:** `documentation/features/work-status.md` (service part).
**Quality gates:** `npm run check`.

### T11 U5 status frame (Priority: Med | Effort: M)
**Agent:** ui-ux-developer · **Model:** Sonnet high · **Depends on:** T2b (works against the stub; real rows after T10) · **Blocks:** none
**Files:** `src/ui/status/**`, `src/ui/model/status-model.ts`, `test/ui/status-model.test.ts`, `test/ui/visual/scenarios/work-status.mjs`.
**Acceptance:** §U5.4 2 to 4; every state in §U5.2 shown in the visual harness, light and dark.
**Docs:** `documentation/features/work-status.md`.
**Quality gates:** `npm run check` · host tokens only.

### T12 U6 mentions (Priority: Med | Effort: S)
**Agent:** fullstack-developer · **Model:** Sonnet high · **Depends on:** T2 · **Blocks:** none
**Files:** `src/service/routes/mentions.ts`, `src/service/mentions.ts`, `src/shared/agent/mention.ts`, `test/agent/mention.test.ts`, `test/service/core/mentions.test.ts`.
**Acceptance:** §U6.3 1 to 3.
**Docs:** `documentation/features/design-mentions.md`.
**Quality gates:** `npm run check`.

### T13 U7 + U8 chat blocks (Priority: Med | Effort: M)
**Agent:** ui-ux-developer · **Model:** Opus high (block frames take model-written args) · **Depends on:** T2b · **Blocks:** none
**Files:** `src/ui/blocks/**`, `src/ui/model/block-args.ts`, `src/ui/model/block-view-model.ts`, `test/ui/{block-args,blocks-model}.test.ts`, `test/ui/visual/scenarios/chat-blocks.mjs`.
**Acceptance:** §U7.3 1 to 3, §U8.3 1 to 4; failing-test-first for `parseBlockArgs`, `answeredOption` and the base64 check.
**Docs:** `documentation/features/chat-blocks.md`.
**Quality gates:** `npm run check` · no design HTML in block frames · tokens only.

### T14 QA per branch (Priority: High | Effort: S each)
**Agent:** qa-tester · **Model:** Opus medium (`anthropic/claude-opus-5-5#medium`) for PR 1 (T1, T2, T2b), `feat/check-tool`, `feat/turn-events`, `feat/chat-blocks`, and `feat/agent-skill` (it deletes a file outside the designs root); Sonnet high for `feat/work-status` and `feat/design-mentions` · **Depends on:** each implementation task · **Blocks:** that PR
**Acceptance:** the branch's acceptance list re-run, its §12.3 click-through steps done with screenshots, verdict line.

### T15 As-built docs and version (Priority: Med | Effort: S)
**Agent:** main agent · **Model:** Sonnet high · **Depends on:** every sibling merged · **Blocks:** the owner's tag
**Files:** `docs/SPEC.md` as-built notes, `docs/BRIEF.md` (owner-approved lines only), `documentation/STATUS.md`, `package.json` version `0.2.0`.

---

## 12. Test plan

### 12.1 Unit tests (risk logic first, red before green)

| Lane | Tests | Failing-test-first |
|---|---|---|
| seams | `design-index`, `open-request` route, `openInRail` (with the clearing `DELETE`), `watchOpenRequests` on `open`, `path-compare` after the move, `pillText` = `buildView`, `badgeOf(ChecksSummary)`, compose route table, no `POST /agent/skill` left | `open-request` slug and 404; `openInRail` not-here clears |
| U1 | manifest keys and limits, package tree, plugin has no import | plugin-import assertion |
| U2 | instructions length and control characters, two triggers only, skill content and reuse of `rules-doc` pieces, widened `checkSection` (RULES.md snapshots), guide line, `DELETE /agent/skill` states | length cap; edited and symlink refusal |
| U3 | `parseToolInput`, `installRootOf` (Linux, macOS, Windows layouts, `null` cases), `validateRuntime` (posix and win32 path modules, `/tmp/x/node`, symlink out of the install), `childEnv`, `buildChildArgs`, `toolResult` with a fake spawn, `setup` registers one tool, app-data pairing, runtime record write-once | all pure functions; `/tmp/x/node` first |
| U4 | answer-before-work, reader 400, type filter, subagent skip, queue bound, dedupe, cold-start fallback | answer timing, queue bound, cold start |
| U5 | `pickStatusDesigns` ordering and filtering (Windows dirs), `status-model` agent, check (six states) and comments tables equal `pillText`/`badgeOf`, `lastFile` from a fake hub | Windows directory compare |
| U6 | `searchDesigns` ranking and caps, `buildMentionText` cap, order and read time, resolve 400/404 | id regex, 16 000 cap |
| U7/U8 | `parseBlockArgs`, base64 check, `answeredOption` prefix matching, card check line equals `badgeOf`, no POST before click | arg parser, `answeredOption`, base64 |

Integration (`test/service/integration/`): composed service answers `POST /session-events`, `/mentions/*`,
`GET /status/designs`, `POST /open-request` with the bearer and refuses them without it (401).

### 12.2 Visual harness

`test/ui/visual/` scenarios for: Settings Agent skill row (4 states), status frame (each §U5.2 state),
DesignCard (loading, ready, no Chrome, not found), DirectionPick (3 options, answered, note, invalid).
Light and dark; status at 280 and 400 px; cards at 360 and 640 px.

### 12.3 Click-through in the user's OpenChamber 2.7.0

Setup: `npm run build` on the branch (OpenChamber reloads the folder install). Use a scratch designs
folder the agent created for testing, never an existing user design. Each step: light and dark, rail at
~320 px and ~480 px. Screenshots to `documentation/smoke/phase-1-5/`.

1. **U1.** 1.1 Settings → Extensions: Design Chamber shows, approval dialog lists instructions, skills,
   OpenCode plugin, session events (screenshot). 1.2 Approve. 1.3 Phase 1 smoke: open the rail, open a
   canvas, pan/zoom, add a pin, send it, restore a version. 1.4 Scrollbars: list, wall, drawers scroll and
   show a bar on hover. 1.5 `npm run guest-check` output pasted.
2. **U2.** 2.1 New chat, ask "Where do my designs go?" with no `/design`: the answer names the folder.
   2.2 Ask for a small landing page: the agent loads `design-chamber` (tool trace) and writes a folder with
   design.json first. 2.3 Settings → Agent skill row; with an old copy installed by the previous build,
   Remove old copy works and the row changes. 2.4 Change the designs folder in Settings: a new chat names the
   new folder. 2.5 Disable the extension: a new chat no longer has the note or the skill; enable again.
3. **U3.** 3.1 Settings → Plugins lists `design-chamber-tools` as active. 3.2 Ask the agent to check the
   page: it calls `design_check`, the tool card reads "Design check · <slug>", the reply lists PNGs and it
   opens one. 3.3 The viewer's Checks badge updates. 3.4 Rename Chrome path to something missing in Settings:
   the tool says nothing was rendered. 3.5 Ask it to check `../etc`: refused sentence. 3.6 In a session run
   through the Claude Code harness: record whether the tool, the skill and the instructions are there
   (answers the §2 NOT FOUND row; write it in `documentation/features/agent-discovery.md`). 3.7 Before
   release, on a Mac and on Windows: note OpenCode's `process.execPath` and the OpenChamber binary path,
   confirm `installRootOf` maps them and `design_check` runs (answers the §2 NOT FOUND row for those layouts).
   3.8 Edit `runtime.json` to point at `/tmp/x/node` (a copy of any binary): the tool answers the launcher
   sentence and runs nothing; restart the service to restore the record.
4. **U4.** 4.1 Close every Design Chamber view. 4.2 In the chat linked to a design, ask for a change.
   4.3 After the turn, open the Versions drawer: one new turn version. 4.4 Leave OpenChamber idle 15 min and
   note the service CPU in the system monitor. 4.5 A turn that changes nothing adds no version. 4.6 Start a
   turn that runs longer than 10 minutes with every Design Chamber view closed (the service idles out): after
   it ends, the turn version is there.
5. **U5.** 5.1 Work Status shows the Designs section with the linked design first. 5.2 While the agent
   writes: "Writing <file>", the same words as the rail pill. 5.3 Check → "Checking" → the result, the same
   text as the viewer's badge. 5.4 Open → the rail opens on the design. 5.5 Collapse the section: no
   `/status/designs` requests in the service log. 5.6 A project with no designs: the project empty copy; a chat
   with no project: the 7-day empty copy.
6. **U6.** 6.1 Type `@` and part of a title: the Designs group lists it with subtitle. 6.2 Pick it, send
   "what's open on this?": the reply quotes the open comments. 6.3 Delete a scratch design, then pick its
   stale row: OpenChamber's notice, no chip.
7. **U7.** 7.1 Ask the agent to finish with a DesignCard: preview, screens, checks. 7.2 Open → rail viewer;
   Comment → rail viewer with Comment pressed. 7.3 Theme switch while the card is on screen.
8. **U8.** 8.1 Have the agent make two scratch directions and ask with DirectionPick. 8.2 Click B: the next
   turn starts with "B: <label> (<slug>)". 8.3 Reload the chat: B stays marked. 8.4 A note alone answers.

---

## 13. Docs to update

| File | Change | Owner (branch) |
|---|---|---|
| `docs/SPEC.md` | §2, §5, §7, §9.9, new §9.10 to §9.11, §10.6, §11.5, §12, new §13.4, §15 | architect (PR 1), main agent as-built (T15) |
| `docs/BRIEF.md` | the §13.1 lines, as the owner approves them | main agent (T15) |
| `README.md` | install link, Git URL, badge, what shows where | main agent (PR 1) |
| `documentation/README.md` | index rows for the new feature files | PR 1 |
| `documentation/features/agent-discovery.md`, `agent-instructions.md` | instructions, bundled skill, Settings row, guide kept, Claude Code harness finding | `feat/agent-skill` |
| `documentation/features/design-checks.md` | `design_check` tool, launcher fallback, runtime record | `feat/check-tool` |
| `documentation/features/turn-snapshots.md` (new) | snapshots from session events, the cold-start fallback, why unlinked designs get none | `feat/turn-events` |
| `documentation/features/work-status.md` (new) | the section, its rows and states | `feat/work-status` |
| `documentation/features/design-mentions.md` (new) | `@` search and what the agent reads | `feat/design-mentions` |
| `documentation/features/chat-blocks.md` (new) | DesignCard and DirectionPick | `feat/chat-blocks` |
| `documentation/pages/rail-panel.md` | opening from Work Status and chat; Settings Agent skill row | PR 1 / `feat/agent-skill` |
| `documentation/STATUS.md` | Phase 1.5 status | T15 |

### 13.1 Proposed `docs/BRIEF.md` lines (for the main agent to paste once the owner approves)

Replace in **Platform**:

> Target OpenChamber >= 2.7.0 (SDK 2.7.0, pinned).

Replace the last line of **Owner decisions (2026-11-01)** ("Writes outside the designs folder: only the
user-clicked skill install, to that one file.") and add a dated block:

> ## Owner decisions (2026-11-10, Phase 1.5)
> - Design Chamber ships its `design-chamber` skill, its instructions and an OpenCode plugin with the
>   extension; they reach every agent OpenChamber runs while the extension is on. Settings no longer
>   installs a skill.
> - Writes outside the designs folder: Design Chamber's own settings folder (`settings.json`, and
>   `runtime.json`, which records where OpenChamber's runtime is so the check tool can run it); and,
>   only when the user clicks **Remove old copy**, deleting the skill copy an older version installed,
>   if it is ours and unedited.
> - The local service also starts when any chat's turn starts or ends, in any project, so that a
>   version is saved after every agent turn on a linked design with no Design Chamber window open. It
>   reads only which chat changed, never what was said.
> - Designs show in the chat's Work Status and in agent replies; Open there opens the rail viewer (the
>   full-screen page still cannot be opened from code).
> - A design that no chat is linked to is never linked automatically.

---

## 14. Questions for the user

**Answered by the owner on 2026-11-10: Q1, Q2, Q3, Q5, Q6 and Q7 take the recommended default.** Q4 was resolved by the main agent. Q8 is pending the owner's read of §13.1 and is applied in T15. `origin` is `Speak-Technologies/design-chamber`, so the install link uses that repo.

1. **Work Status drawn by our own frame instead of by the app.** An app-drawn section can't open Design
   Chamber when you click Open, and it doesn't know which chat you're in. **Default: our frame**, styled
   with OpenChamber's own controls and colours, quiet when collapsed.
2. **One agent tool instead of two.** `design_check` already renders and returns the screenshots, so
   `design_render` would repeat it and cost tokens in every chat. **Default: ship `design_check` only.**
3. **The old skill copy from Settings.** Agents may see two `design-chamber` skills until it's gone.
   **Default: Settings shows "Remove old copy" and removes it on your click** (only when it's ours and
   unedited). Alternative: remove it automatically on first start.
4. **Link designs an agent started without `/design`.** Resolved by the main agent on 2026-11-10: **no**.
   It would guess from timing, and a wrong guess sends comments to the wrong chat. Dropped (§8); listed here
   only so the decision is visible.
5. **What a DirectionPick option is.** **Default: each option is its own design folder** (pricing-a,
   pricing-b). Screens inside one canvas could come later.
6. **Release channel.** **Default:** tagging `v0.2.0` makes CI publish a `release` branch and a
   `release-v0.2.0` tag that people install from; `master` never holds built files. You'd exclude `release`
   from the branch protection rule. Canonical repo for the install link: **default
   `https://github.com/Speak-Technologies/design-chamber`** (it is `origin`).
7. **Keep `<root>/AGENTS.md`.** Instructions only reach agents inside OpenChamber. **Default: keep the guide**
   for agents run elsewhere, now pointing at `design_check` first.
8. **The BRIEF wording in §13.1.** **Default: paste it as written** once you've read it; it records the
   new outside-the-folder write and that the service now wakes on any chat's turn.

Architecture Complete → main agent (task breakdown) | → fullstack-developer, ui-ux-developer (T1–T15 per §11, T9 dropped, after PR 1 seams)
