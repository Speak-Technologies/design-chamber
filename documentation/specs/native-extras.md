# Native extras on OpenChamber 2.8 (technical design)

Status: design, 2026-11-27. Branch `feat/native-extras`, cut from `origin/master` at `710b36b` (SDK 2.8.1
pinned by PR #38). Owner choices (this conversation): all four features below, and the reversal of the "no
resident service" decision (`src/service/instructions.ts:10-14`, `documentation/specs/phase-1-5-sdk-2-7.md:486`).

Every SDK fact cites the installed `node_modules/@openchamber/sdk` **2.8.1** (`API.md`, `GUEST_SERVICES.md`,
`DOCUMENTATION.md`, `dist/*.d.ts`). The OpenChamber source is not on this machine, so host behaviour beyond those
docs is marked **verify on device**. Input reviews: the extension-rules review of master (2026-11-27, F1 to F6 and
"missed opportunities" 1 to 4) and the SDK extension skill.

| # | Feature | Manifest | New service route | Resident cost |
|---|---|---|---|---|
| 1 | Live tool target in the build strip and Work Status | none | none | none |
| 2 | Phone: page and panel open on the phone; blocks and Work Status say the right thing there | `panel.mobile`, `page.mobile` | none | none |
| 3 | "Open as page in Design Chamber" on Files rows | one `actions` entry | `POST /pages/from-file` | none |
| 4 | Sidebar marks on linked design chats | `marks`, `service.keepRunning`, `engines >=2.8.0` | none | yes, measured in §4.7 |

---

## 0. Ground truth

### 0.1 SDK 2.8.1 facts this rests on (verified this session)

| # | Fact | Evidence |
|---|---|---|
| N1 | Session records from `onSessions(projectId)` / `listSessions` carry optional `tool: { name, target } \| null`: the call running now, or the one that ended last while the agent thinks; `name` as OpenCode calls it (`read`, `edit`, `bash`); `target` is the file or folder the call names **relative to the session's `directory`, the bare name for one outside it**, or null; a shell command's text never appears; `null` whenever the session does not run; older hosts omit it | `API.md:232`; `dist/workspace.d.ts:62-65` |
| N2 | The frame's own `ready.session` (`SessionSnapshot`) has no `tool`; only session records do | `dist/workspace.d.ts` `SessionSnapshot` |
| N3 | Session events carry no `tool` | `dist/session-events.d.ts` (no match for `tool`) |
| N4 | `ready.device?: { formFactor: 'phone' \| 'tablet' \| 'desktop', pointer: 'coarse' \| 'fine', insets: {top,right,bottom,left}, keyboard }`, optional (older hosts and older SDKs leave it out); changes arrive as a new `ready` | `dist/contract.d.ts:180-193`; `DOCUMENTATION.md:103` |
| N5 | Blocks, Work Status sections and file editors mount on the phone with no opt-in; background actions and slash commands run there | `API.md:276,327,331`; `DOCUMENTATION.md:508` |
| N6 | `panel.mobile: true` makes the panel a tab of the phone's workspace drawer (id `plugin:<id>`), enables `openSurface` to it, chip taps, and open-mode actions; without it `openSurface` is `UNSUPPORTED` on the phone | `API.md:564`; `DOCUMENTATION.md:52,512,516` |
| N7 | `page: { entry, title, mobile: true }` lists the page in the phone's sessions list **More** menu, full screen with a back arrow; lay out for about 360 px and touch. Code still cannot open the page | `API.md:272`; `DOCUMENTATION.md:75,513` |
| N8 | `mobile` keys are dropped by older hosts (non-strict objects), so the package still installs | `DOCUMENTATION.md:530-532` |
| N9 | `actions[].where: "file"` puts the entry on Files rows (desktop menu, phone long press). There is **no file-name filter**: it shows on every row, folders included. The item is `GuestFileItem { kind: 'file', action, directory: string \| null, path, isDirectory }` | `dist/manifest.d.ts:50-66`; `dist/contract.d.ts:229-235`; `DOCUMENTATION.md:74,515` |
| N10 | Whether `GuestFileItem.path` is absolute or relative to `directory` is not documented | NOT FOUND: verify on device; §3 handles both |
| N11 | Background actions: a fresh hidden frame per click, 20 s deadline for load and run, up to 8 at once, no automatic retry | `API.md:337-341` |
| N12 | `contributes.marks: true` needs a service; adds the `marks` capability (own approval line). `setMark(target, mark \| null)`; `target` `{ sessionId }` (that row) among others; `mark { icon, tone: neutral\|info\|success\|warning\|error, text ≤ 200, url? }`; the app prefixes the extension name in the tooltip | `GUEST_SERVICES.md:220-238`; `API.md:577`; `dist/service-host.d.ts:11-14,97-108,233` |
| N13 | Marks live as long as the process; ≤ `SERVICE_MARKS_MAX` (200) held (`TOO_MANY_MARKS` 409), ≤ `SERVICE_MARK_RATE_MAX` (60) changes a minute (`TOO_MANY_EVENTS` 429); setting a mark to what it already is costs nothing and counts against neither limit | `GUEST_SERVICES.md:203,236`; `DOCUMENTATION.md:446-447` |
| N14 | A click on a mark opens our panel **in that row's session** (`url` ignored when a panel exists) | `GUEST_SERVICES.md:232`; `DOCUMENTATION.md:449` |
| N15 | `service.keepRunning: true` starts the service when OpenChamber starts or the extension is approved, holds it through idle stops, brings a stopped one back within 15 s, backs off a crash loop up to 5 min | `GUEST_SERVICES.md:244-246` |
| N16 | Marks ship in the first release after 2.7.0; an older host ignores the key and refuses the call, so declare an engines floor above 2.7.0 | `GUEST_SERVICES.md:240`; `DOCUMENTATION.md:475` |
| N17 | **Docs disagree on marks on the phone**: `GUEST_SERVICES.md:240` says mobile shows no marks; `DOCUMENTATION.md:471,506` says the phone draws them and a tap shows the text as a toast. Nothing here depends on which is true | verify on device |
| N18 | The phone spawns no services; the service runs on the connected server and the phone's frames reach it through `serviceRequest` | `GUEST_SERVICES.md:128-136` |

### 0.2 What already exists (reuse first)

| Need | Already here | Gap |
|---|---|---|
| Linked agent activity in the strip | `src/guest/build-activity.ts` (`watchBuildActivity` holds one `onSessions` subscription for the linked session, `reduceBuild`, `phaseOf`) | ignores `tool` |
| Strip and Work Status words | `src/ui/model/build-strip-model.ts` `buildView`, `pillText`; `src/ui/model/status-model.ts` `agentPart` | no tool words |
| Work Status rows | `src/service/status-designs.ts`, `routes/status.ts`, `StatusDesignRow` (`src/shared/api.ts:420`) | no `sessionId`, so the frame cannot match a row to a session record |
| "Open as page" | `open-as-page` action, `where: "message"`, assistant messages only, an HTML code block in the message text (`flows.ts:640-671`, `routes/chat.ts:697`) | **does not cover files at all** |
| Read one HTML file safely and make a page of it | `src/service/loose.ts` (O_NOFOLLOW reader, regular file, 20 MB cap, `looseTitleOf`, half-made design to `.trash`) | only for files directly in the designs root |
| Find a file's local references | `src/service/bundle.ts` `bundleDocument` + `createLiveFileSource` (contained by `resolveInside`) | not used for copies |
| Open a design in the rail from a frame | `flows.ts` `openInRail`, `POST /open-request` | phone copy |
| Service → host calls | `src/service/host-calls.ts` (`setInstructions` only, never throws) | no `setMark` |
| Design index in memory | `src/service/design-index.ts` (`all`, `bySession`, `ready`) | none |
| Check counts | `src/service/check/service.ts` `ensureChecksService(ctx).get(slug)` (static memo per slug, dropped on change) | none |
| Theme and size per frame | `applyHostReady` in `src/ui/app.ts`, `src/ui/status/main.ts`, `src/ui/blocks/main.ts` | no device handling |

### 0.3 Composes with the branches in flight

- **`feat/use-the-project`** (dc-use-project) adds `PUT /view` and a 60 s view heartbeat from the rail and page,
  two plugin tools, and edits `package.json` (tools), `src/shared/api.ts`, `src/shared/types.ts`,
  `src/service/compose.ts`, `src/service/instructions.ts`, `src/ui/rail/rail-app.ts`, `src/ui/page/page-app.ts`,
  `src/ui/components/settings-view.ts`, `src/ui/styles.css`. Our marks and quiet mode do not read `view.json`.
  With `keepRunning` the heartbeat no longer decides whether the service is up; it still says what is open.
  Its `design_list` / `design_read` tool names get words in §1.3.
- **`feat/system-builder-depth`** (dc-system-depth) edits `src/shared/limits.ts`, `src/shared/types.ts`,
  `src/shared/checks.ts`, `src/ui/model/system-page-model.ts`, `src/ui/styles.css` and the system check. Our
  marks count design checks only (`ensureChecksService`), not system checks.
- **Recommendation:** merge both before Wave 0 here. If either is still open, every Wave 0 edit to a shared file
  is additive (new keys at the end of a type or block) so the rebase is mechanical. §6 names each shared file.

---

## 1. Feature 1: live tool target

### 1.1 Manifest
None. `sessions` is already granted; `tool` is an optional field (N1), so no engines change for this feature.

### 1.2 Data flow
`OpenCode tool call → host session record { activity: 'running', tool } → onSessions push → readSessionTool
(validate) → build strip: reduceBuild 'session' input carries tool → buildView words → feature-build-strip paint
(throttled) · Work Status: status frame's own onSessions(project) → rows by sessionId → agentPart words`.

**Boundary reader** (new `src/guest/session-tool.ts`, backend lane, pure):

    type SessionTool = { name: string; target: string | null }
    readSessionTool(raw: unknown): SessionTool | null
      - not an object, or name not a string → null
      - name: trimmed, 1..SESSION_TOOL_NAME_MAX (128), /^[A-Za-z0-9_.:-]+$/ else null
      - target: string → strip control characters (C0, C1, U+2028/2029), trim; 1..SESSION_TOOL_TARGET_MAX (1024)
        else null; anything else → null

The host value is trusted to be shaped by its own schema (`dist/workspace-schemas.d.ts:118`), but the name comes
from OpenCode and the target from the agent's tool input, so both are treated as untrusted text.

**Build strip.** `BuildInput` `session` gains `tool: SessionTool | null`; `BuildTrack` gains `tool: SessionTool | null`.
`watchBuildActivity.onSnapshot` passes `readSessionTool(found.tool)`; the fallback path (no project, no grant)
passes `null`. Rules in `reduceBuild`:
- `tool` is kept only while `input.activity === 'running'`; any other activity clears it (N1 says the host does
  too; we do not rely on it).
- The no-change shortcut compares `tool` as well (name and target), or a new tool would be dropped.
- `phaseOf` is unchanged: the phase still comes from activity and files. `nextDeadline` is unchanged.

**Words** (new `src/ui/model/tool-model.ts`, ui lane, pure):

    describeTool(tool: SessionTool, design: { slug, entry: string | null, files: string[] } | null)
      → { kind: 'edit' | 'write' | 'read' | 'search' | 'run' | 'web' | 'plan' | 'helper' | 'check' | 'designs',
          full: string, short: string, path: string | null } | null

Name normalisation: case-fold; strip a leading `mcp__<server>__` (Claude Code harness MCP names, F34) and a
leading `<namespace>.` (Code Mode). Table (unknown names answer `null`, so the strip keeps today's "The agent is
working"; no tool jargon reaches the user):

| Names | kind | Full text (page) | Short text (rail pill, Work Status) |
|---|---|---|---|
| `edit`, `multiedit`, `patch`, `apply_patch`, `str_replace_based_edit_tool` | edit | `Editing <path>` | `Editing <name>` |
| `write` | write | `Writing <path>` | `Writing <name>` |
| `read` | read | `Reading <path>` | `Reading <name>` |
| `glob`, `grep`, `list`, `ls`, `codesearch` | search | `Looking through <path>` / `Searching the files` | same |
| `bash`, `shell` | run | `Running a command` (target never shown) | `Running a command` |
| `webfetch`, `websearch` | web | `Looking something up online` | same |
| `todowrite`, `todoread` | plan | `Planning the next steps` | `Planning` |
| `task` | helper | `A helper agent is working` | `Helper agent working` |
| `design_check` | check | `Checking the design` | `Checking` |
| `design_list`, `design_read` (use-project branch) | designs | `Reading your designs` | `Reading designs` |

`<path>` (pure `toolPath(target, design)`): when `target` is a bare name (no `/` or `\`) that equals the basename
of exactly one of the design's files (`entry`, every `screens[].file`, `tokens.css`, `DESIGN.md`), or a relative
path ending in `<slug>/<file>` or equal to `<file>`, show the design path (`screens/pricing.html`); otherwise show
the target as the host gave it. Then `middlePath(…, 48)` for full and the basename cut to 24 for short (the
existing `FULL_PATH_MAX` / `NAME_MAX` in `build-strip-model.ts`). Edit, write and read with a null target say
`Editing a file`, `Writing a file`, `Reading a file`.

**`buildView` changes**, phases `writing` and `working` only: when `track.tool` gives a description, `text` =
`full`, `pill` = `short`, `title` = the shown path; `detail` keeps today's line ("2 of 4 screens written",
"Last saved pricing.html 1 min ago", "Nothing saved in the last 2 minutes"). Other phases are untouched.
`announce` = `full` only for `edit` and `write` (a file the user cares about); for every other kind it is the
phase's own text ("The agent is working"), so the live region does not read out every file the agent opens.

**Paint throttle** (`src/ui/wall/feature-build-strip.ts`): a track change that differs from the painted one only
in `tool` repaints at most once per `TOOL_REPAINT_MS` (1 000, trailing). Phase changes paint at once. This keeps
the pill readable when the agent reads ten files a second.

**Work Status.** The service adds `sessionId: string | null` to each `StatusDesignRow` (from the index's
`DesignSummary.sessionId`; no new read). The status frame keeps the `id` of the project it finds in
`readProjects` (today it keeps only `directory`), and while it has a project holds one
`onSessions(projectId)` subscription; it keeps `Map<sessionId, SessionTool>` for records with
`activity === 'running'` and a valid `tool`, and repaints with the same 1 s throttle. `agentPart(row, tools)`:
for `agent` `writing` or `working`, a described tool for `row.sessionId` gives `short`; else today's words. No
project (F37), no grant, or an `onSessions` error: no map, today's behaviour. The subscription is dropped when the
project changes and on `pagehide`.

### 1.3 What the user sees

| State | Rail pill | Page strip | Work Status row |
|---|---|---|---|
| Linked agent edits a screen | `Editing pricing.html` | `Editing screens/pricing.html · 2 of 4 screens written` | `Pricing · Editing pricing.html · No issues` |
| Reads a project file | `Reading theme.css` | `Reading src/styles/theme.css · Last saved home.html 1 min ago` | `Pricing · Reading theme.css` |
| Runs a shell command | `Running a command` | `Running a command` | `Running a command` |
| Runs `design_check` | `Checking` | `Checking the design` | `Checking` |
| Unknown tool, or host without `tool` | `Agent is working` | `The agent is working` (today) | `Agent is working` (today) |
| Question, permission, failed, done, stalled, offline | unchanged | unchanged | unchanged |
| Chat with no project (F37) | today's file-based `Writing …` | same | same |

Copy rules: plain words, no em dash, sentence case, no tool names except through the table.

### 1.4 Failure behaviour
- `tool` absent (2.7 host, older field set): `readSessionTool(undefined)` → null → today's words. Test-held.
- `onSessions` rejects or the grant is withdrawn: the existing fallback (`useFallback`) for the strip; the status
  frame logs one warning and draws without tools.
- A target the reader rejects (too long, control characters only): the verb with "a file".
- A burst of snapshots: the 1 s throttle; no timer runs when nothing changes (the throttle timer is armed only by a
  pending tool-only change).

### 1.5 Threat model
- **Bearer token:** untouched; nothing new crosses to the service except the existing status query. `sessionId`
  in `StatusDesignRow` goes from the service to our own status frame only; the frame already sees every session
  id of the project through `onSessions`.
- **Containment:** the target is never a path we open, send to the service, or compare with the disk; it is only
  text. No route takes it.
- **Untrusted text:** tool name and target come from the model. They pass `readSessionTool` (pattern, length,
  control characters), then `middlePath`, then `textContent` only (strip, pill, status row, `title` attribute).
  A target that tries to read like an instruction ("ignore the user") is shown as a file name, nothing more.
- Design iframes: no change; they never see session data.

### 1.6 Tests
- `test/guest/session-tool.test.ts` (new): valid, missing, wrong types, name pattern, 128/129 chars, target with
  C0/C1/U+2028, 1024/1025, empty after trim. Mutation: widen the name pattern, a test goes red.
- `test/guest/build-activity.test.ts`: tool kept while running, cleared on idle/waiting/gone/none; a tool-only
  change is not swallowed by the no-change shortcut; `phaseOf` and `nextDeadline` unchanged by tool.
- `test/ui/tool-model.test.ts` (new): every table row, case and `mcp__x__` prefix, unknown → null, bare-name map
  to a screen, ambiguous basename (two screens named the same in different folders) → host target, `slug/` prefix
  strip, `bash` never shows a target.
- `test/ui/build-strip-model.test.ts`: writing and working with and without tool; `announce` only for edit/write.
- `test/ui/status-model.test.ts`: `agentPart` with a tool for the row's session, for another session, none.
- `test/service/core/status-designs.test.ts`: rows carry `sessionId`.
- Visual: `test/ui/visual/scenarios/build-strip.mjs` and `work-status.mjs` gain an "editing a screen" and a
  "reading a project file" state (fake host `onSessions` record with `tool`).

---

## 2. Feature 2: phone

### 2.1 Manifest

    contributes.panel: { …unchanged, "mobile": true }          (recommended, Open Question 1)
    contributes.page:  { "entry": "dist/panel/index.html", "title": "Design Chamber", "mobile": true }

`page.mobile` alone lists the page in the More menu (N7), which is what the user asked for. `panel.mobile` is what
makes every **Open** on the phone work: DesignCard, DirectionPick, SystemAsk previews, Work Status rows and
"Show all", the Files action of §3 and the mark tap of §4 all go through `openSurface('plugin:design-chamber')`,
which is `UNSUPPORTED` on the phone without it (N6). Both keys are dropped by older hosts (N8).

### 2.2 Data flow
`ready.device → deviceOf(context) → applyDevice(documentElement) (data attributes + CSS variables) → app.ts route
(phone page → compact layout) → view models take a Device argument for copy and actions`.

**Device model** (new `src/ui/model/device-model.ts`, pure):

    type Device = { form: 'phone' | 'tablet' | 'desktop'; coarse: boolean; insets: Insets; keyboard: number }
    deviceOf(context: HostReadyContext): Device       // missing or malformed device → desktop, fine, zero insets
    openHelp(device, panelOnPhone: boolean): { notHere: string; serviceDown: string; fullScreenHint: string | null; firstRunTip: { title, body } | null }

`panelOnPhone` is a build-time constant `__DC_PANEL_MOBILE__` set by `scripts/build.mjs` from the manifest (so the
copy matches what was shipped). Insets and keyboard are clamped to 0..400 px and rounded.

**Applying it** (new `src/ui/components/device.ts`): `applyDevice(device, root)` sets `data-dc-form`,
`data-dc-pointer` and CSS variables `--dc-inset-top/right/bottom/left`, `--dc-keyboard` (px). Called next to
every `applyHostReady` (`src/ui/app.ts`, `src/ui/status/main.ts`, `src/ui/blocks/main.ts`), on every `ready`, so
rotation and the on-screen keyboard follow.

**Routing** (`src/ui/app.ts`): `surface === 'page' && device.form === 'phone'` mounts the rail app
(`mountRail(appRoot, { variant: 'phone-page' })`) instead of the 1400 px page app, because the rail layout is
already built for 320 to 480 px. Tablet and desktop keep the page app. The choice is made once at mount; a phone
stays a phone. Place memory keeps its own key per surface (`place:page`), so the phone page and the desktop page
share it as today (instance storage).

**Compact layout on the phone** (rail app, panel tab and phone page alike):
- Live frame budget 2 on the phone (rail today 4, §8.4): `liveBudget(surface, device)` in
  `src/ui/model/wall-model.ts`; artboards past it show "Paused / Not loaded. Pan here to load it." as today.
- Touch on the wall (`src/ui/model/wall-input.ts`, `src/ui/wall/input-controller.ts`, math from
  `src/guest/camera.ts` `zoomTo`): two pointers pinch-zoom around their midpoint (pure `pinchStep(prev, next)`
  → `{ factor, at }`, factor clamped by the existing scale clamp); with a coarse pointer a press on a board in
  Edit mode that turns into a drag (`isDrag`) pans instead of being dropped; a tap stays a press (comment). Fine
  pointers behave exactly as today (test-held).
- Hit areas: under `[data-dc-pointer="coarse"]` buttons, menu rows, list rows and the ask bar's send reach a
  44 px minimum through `--dc-s*` spacing (no new sizes); styles in `src/ui/styles.css`, `blocks.css`,
  `status.css`.
- The ask bar dock, the comment composer and bottom sheets add `var(--dc-keyboard)` to their bottom padding and
  `var(--dc-inset-bottom)` on the phone page, so the on-screen keyboard never covers the text box.
- Hidden on the phone, because they act on the computer that runs OpenChamber, not on the phone: Reveal in
  folder, Export ZIP / Export HTML and Show in folder (they save into that computer's Downloads), Copy path.
  `src/ui/model/viewer-menu.ts` and the list's row menu take `device`. Settings stays, with one line under the
  folder field: "This folder is on the computer that runs OpenChamber."
- The footer hint and the first-run tip use `openHelp`: on the phone page no hint and no tip; on the phone panel
  tab the tip reads "Open Design Chamber full screen" / "In your chats list, open More and pick Design Chamber."
- Hover-only text: the Checks badge sentence and the row tooltip already have visible equivalents; nothing new.

**Blocks and Work Status on the phone** (no manifest key needed, N5):
- DesignCard (`src/ui/blocks/design-card.ts`): Open and Comment as today through `openInRail`. With
  `panelOnPhone` both work. Without it, Comment is hidden on the phone and `not-here` says the `openHelp`
  sentence.
- SystemAsk (`src/ui/blocks/system-ask-diff.ts:300-302`) and `SERVICE_DOWN`
  (`src/ui/model/system-ask-model.ts:416`) take their sentences from `openHelp`.
- Work Status (`src/ui/model/status-model.ts` `STATUS_COPY.notHere`, `src/ui/status/main.ts`): same.
- System page hint (`src/ui/model/system-page-model.ts:236`): on the phone, "To edit values, open Design
  Chamber on your computer." (the phone shows the compact system page, where values are read-only today).

### 2.3 What the user sees

| Where | Desktop (unchanged) | Phone, panel opted in | Phone, page only |
|---|---|---|---|
| DesignCard Open / Comment | opens the rail | opens the Design Chamber tab of the workspace drawer on that design (Comment starts in Edit with Comment on) | Open: toast "Open Design Chamber from the More menu in your chats list."; no Comment |
| Work Status Open, Show all | opens the rail | opens the drawer tab | toast as above |
| More menu → Design Chamber | n/a | full screen, compact layout, back arrow | same |
| Wall | mouse and trackpad | one finger pans, two fingers zoom, tap to comment in Edit, Play is the design's own touch | same |
| Viewer ⋯ menu | all entries | no Reveal, Export, Copy path | same |
| Files row long press | n/a | §3 | §3, then the More menu toast |
| Not-here (no directory yet) | "Open Design Chamber from the rail to see it." | "Design Chamber can't open here yet. Open it from the More menu in your chats list." | same |

### 2.4 Failure behaviour
- A host without `device` or with a malformed one: desktop. A host that ignores `mobile`: the page is not listed,
  blocks keep the phone copy only when `device` says phone.
- `openSurface` on the phone rejects `UNSUPPORTED` (panel not opted in, or the host refuses): `openInRail` already
  takes the open request back and answers `not-here`; the frame shows the `openHelp` sentence.
- Service unreachable from the phone (relay down, computer asleep): today's "isn't responding" states with
  **Try again**; `serviceDown` on the phone says "Design Chamber isn't responding on your computer. Try again in a
  moment." (it runs there, N18).
- Rotation or keyboard mid-render: a new `ready` reapplies device variables; no remount, no lost input.
- Theme switch mid-render: unchanged path (`applyHostReady` on every ready).

### 2.5 Threat model
- **Bearer token:** unchanged. Phone frames are the same guests with the same sandbox and grants; the token stays
  in the host (relay included) and the service.
- **Containment:** no new path input. Hiding Reveal and Export on the phone removes no check (the service checks
  stay as they are); it only stops actions that would run on another machine.
- **Untrusted HTML:** design frames are the same `ARTBOARD_SANDBOX` (`allow-scripts`, never `allow-same-origin`)
  with the same CSP and blob feed. Touch input in Play mode goes to the design frame as mouse input does today;
  Edit mode keeps `pointer-events: none` on the frame. Fewer live frames on the phone only lowers exposure.
- `ready.device` values are host-provided numbers; clamped before they reach CSS (no string goes into a style).

### 2.6 Tests
- `test/ui/device-model.test.ts` (new): absent, malformed, phone/tablet/desktop, coarse, clamps, `openHelp` for
  each of form × `panelOnPhone`.
- `test/ui/wall-input-model.test.ts`: `pinchStep`; coarse drag on a board pans; fine pointer unchanged (every
  existing case still passes).
- `test/ui/viewer-menu-model.test.ts`: phone hides Reveal, Export, Copy path; desktop unchanged.
- `test/ui/status-model.test.ts`, `test/ui/blocks-model.test.ts`, `test/ui/system-ask-model.test.ts`: phone copy.
- `test/manifest.test.ts`: `panel.mobile`, `page.mobile` present; the SDK checker passes (`npm run guest-check`).
- `test/copy-no-em-dash.test.ts` covers the new strings automatically.
- Visual: a phone run of the harness (`test/ui/visual/shoot.mjs`) at 390 × 844 with the fake host sending
  `device: { formFactor: 'phone', pointer: 'coarse', insets: { bottom: 34 }, keyboard: 0 }`: the phone page (list,
  a canvas, a page), a DesignCard and the Work Status section, dark and light. New scenario
  `test/ui/visual/scenarios/phone.mjs`.
- Live: a folder install on OpenChamber 2.8.1 opened on a phone or the hosted mobile web, Open from a DesignCard,
  More → Design Chamber, pinch on a canvas (verify on device; records N10 and N17 too).

---

## 3. Feature 3: "Open as page in Design Chamber" on Files rows

### 3.1 What exists
`open-as-page` covers **assistant messages** that hold an HTML code block (`where: "message"`, `roles:
["assistant"]`, `flows.runAction` ignores every other item kind). Nothing handles a file. This feature is a second
action with its own id; the message action is unchanged.

### 3.2 Manifest

    contributes.actions[1]: { "id": "open-file-as-page", "label": "Open as page in Design Chamber",
                              "icon": "palette", "where": "file", "mode": "background" }

30 of 40 label characters; 2 of 8 actions. Background mode, so it runs on the phone without `panel.mobile` (N9,
N11). The host shows it on every Files row (N9), so the handler answers rows it cannot use with a toast.

### 3.3 Data flow
`Files row → host GuestFileItem → hidden background frame onAction → flows.runAction (file branch: action id,
not a folder, .html/.htm) → POST /pages/from-file { path, directory } → service: resolve, refuse, read, dedupe,
copy html + local files under its folder, create page, leave open request → frame: openSurface(panel) → toast`.

**Frame** (`src/guest/flows.ts` `runAction`): for `item.kind === 'file' && item.action === 'open-file-as-page'`:
folder → toast "Pick an .html file to open it as a page."; a name not ending in `.html`/`.htm` (case-insensitive)
→ toast "Only .html and .htm files open as pages."; else the call, then `openSurface(PANEL_SURFACE_ID)` as the
message action does, then the toast (§3.4). Errors from the service reach the user as their sentence. No retry
(N11; the route is idempotent by §3.3 dedupe anyway).

**Route** `POST /pages/from-file` (in `src/service/routes/chat.ts`, beside `/pages/from-message`, so it shares the
open-request slot; logic in new `src/service/file-page.ts`; types in `src/shared/api.ts`):

    body     { path: string, directory: string | null }
    response { slug, title, reused: boolean, left: { outside: number, missing: number, other: number } }

1. `parseFromFileBody`: exactly those keys; `path` 1..`FILE_PAGE_PATH_MAX` (4 096), no NUL or control character;
   `directory` null or the same rules. Else 400 `bad-request`.
2. `resolveFileTarget(path, directory, p, platform)` (pure, `src/service/file-page.ts`, tested on posix and
   win32): an absolute `path` is used as given; a relative one needs an absolute `directory`, is joined, and must
   stay inside it (`isInsideOrEqual`). Refused: UNC and `\\?\` paths ("Copy the file to this computer first."),
   a relative path without a directory, a name without `.html`/`.htm` (422 `invalid`). Result normalised with
   `p.resolve`.
3. **Inside the designs root** (`isStrictlyInside(realRoot, realpath(target))`): the first segment is a design
   folder (`store.dir`) → no copy, leave the open request, answer `reused: true` with that design's title. A
   loose file directly in the root → 422 `invalid` "That file is in your Designs folder. Import it from Design
   Chamber's list." (the existing loose import, §9.8).
4. A per-path lock (in memory, case-folded where the platform folds) → 409 `conflict` "That file is being opened
   already." for a double click.
5. Read the entry with the loose reader, extracted from `src/service/loose.ts` as
   `readRegularFile(absPath, maxBytes)` (O_NOFOLLOW, `fstat` regular file, ≤ `LOOSE_IMPORT_MAX_BYTES` 20 MB,
   re-checked after the read). A link → 422 "That file is a link. Open the file it points to instead."
6. **Dedupe:** sha256 of the bytes. Among `designIndex.all()` pages (at most `FILE_PAGE_DEDUPE_SCAN_MAX` 50,
   newest first) whose service state holds `importedFrom.path` equal to the target (`samePath`) and
   `importedFrom.sha256` equal → `reused: true`, open request, no write. Same path, other bytes → a new copy
   (Open Question 3).
7. **Local files:** `bundleDocument(createLiveFileSource(folderOf(target)), basename, { mode: 'export' })` as a dry
   run; take `inputs` minus the entry. Keep a rel only when its extension is in the bundler's MIME table
   (images, fonts, css, js, media, json, html), it is not `index.html` (that name is the page's entry), and the
   running total stays ≤ `FILE_PAGE_COPY_MAX_BYTES` (50 MB) and ≤ `BUNDLE_REFS_MAX` files. Over the byte cap →
   413 `too-large` "This page uses more than 50 MB of files, so it can't be copied. Export it from your project
   instead." `left.outside` = `blocked` refs (escape the folder), `left.missing` = `missing`, `left.other` = refs
   dropped by type. External (https) refs stay in the HTML and show in the viewer's remote-files banner as today.
8. **Create:** `store.create({ kind: 'page', title: looseTitleOf(name, bytes), projectDirectory: directory,
   sessionId: null, importedFrom: { path, sha256, at } })`, then the entry bytes to `index.html` and each kept file
   to `resolveInside(designDir, rel.split('/'))` through `writeFileAtomic` (folders made inside the design
   only). The copy is byte for byte; nothing is decoded or rewritten. Any failure after create moves the half-made
   design to `.trash` (as `loose.ts` does) and answers the sentence. `sessionId` stays null: BRIEF 2026-11-10 links
   a design only to the chat its chip came from.
9. Leave the open request (`view`), so the rail opens it (§10.11). The store's `added` event refreshes every list.

### 3.4 What the user sees (toasts from the background frame)

| Case | Toast |
|---|---|
| Copied, rail opened | success "Saved “Pricing” as a page in Design Chamber." |
| Copied, some files left out | success, plus " 2 files it uses are outside its folder, so they weren't copied." (outside), " 1 file it uses is missing." (missing) |
| Copied, rail could not open | "Saved “Pricing” as a page. Open Design Chamber to see it." (phone without the panel: the `openHelp` sentence) |
| Same file, unchanged | info "“Pricing” is already in Design Chamber. Opening it." |
| A file of an existing design | info "That file is part of “Pricing”. Opening it." |
| Folder / not HTML | info as §3.3 |
| Link, too large, UNC, in the root, busy | error or info with the service sentence |
| Service down | error "Design Chamber isn't responding. Try again in a moment." |

In the viewer the page then shows its usual states: the missing/blocked badge and the remote-files banner when
something was left out, with **Ask the agent to fix it** for remote files.

### 3.5 Failure behaviour
- 20 s action deadline (N11): a 20 MB read and a 50 MB copy on a local disk fit; on a slow disk the host drops the
  frame and the service still finishes (the open request and the `added` event still land, the toast is lost).
  Handler budget stays under 15 s by the caps; a copy over `FILE_PAGE_COPY_BUDGET_MS` (12 s) stops, trashes the
  half-made design and answers 413 with the export sentence.
- Partial write (disk full, permission): the half-made design goes to `.trash`; nothing is left half-copied in the
  root; the toast says what failed.
- The source changes during the copy: the entry is read once (one snapshot of its bytes); an asset that vanished
  between the dry run and the copy counts as missing.
- Retry: the user clicks again. The dedupe makes a repeat after success open the copy instead of a duplicate.

### 3.6 Threat model
- **Who can call it:** the route sits behind the bearer check in `http.ts` like every route. Only our own frames
  have `serviceRequest`; the background frame calls it only from `onAction`, which the host fires only from a
  user's click on a Files row. Design iframes never get the token, a route or the host bridge; chat blocks never
  call this route (`flows.runAction` is wired only in `background-main.ts`). A model cannot trigger it.
- **What it reads:** this is the first route whose body names a file outside the designs root. It reads only an
  `.html`/`.htm` regular file the user picked (O_NOFOLLOW, no links, 20 MB), and the local files that HTML names,
  each through `createLiveFileSource(folder)` → `resolveInside(folder, …)`, so a reference (or a symlink inside
  the folder) that escapes the HTML's own folder is refused (`RefBlocked`) and never read. Only bundler MIME types
  are copied, so `<link href=".env">` copies nothing.
- **What it writes:** only inside a new design folder, every path through `resolveInside(designDir, …)` from
  bundler-validated rels; `writeFileAtomic`; never outside the root, never into the project.
- **Untrusted HTML:** the copied page is agent- or user-written HTML and renders only in the sandboxed artboard
  frame with the CSP and blob feed (unchanged). The title comes from `looseTitleOf` and is shown through
  `textContent`.
- **Windows:** drive letters, backslashes and case folding go through `resolveFileTarget` with `path.win32`, the
  shared `samePath` / `isInsideOrEqual`; UNC is refused.

### 3.7 Tests
- `test/service/core/file-page.test.ts` (new, tmp root via `test/helpers/tmp-root.ts`):
  `resolveFileTarget` posix and win32 (absolute, relative + directory, `..` escape, no directory, UNC, `\\?\`,
  drive letters, case), body parser, link refused, 20 MB cap, inside-root design → reused, loose in root → 422,
  dedupe same bytes, new bytes → new copy, assets copied byte for byte at the same rel, `../` ref counted outside
  and not read, symlinked asset escaping the folder not read, non-MIME ref not copied, `index.html` asset skipped,
  50 MB cap → 413 with no folder left, write failure → design in `.trash`, concurrent double call → 409.
  Mutation: drop the `RefBlocked` check in the copy step, the escape test goes red.
- `test/service/core/loose.test.ts`: still green after `readRegularFile` is extracted.
- `test/guest/flows.test.ts`: file branch (folder, non-HTML, success, reused, not-here), message branch unchanged.
- `test/shared/api.test.ts`: route count +1, owner tag.
- `test/manifest.test.ts`: the second action.
- Live: Files → right-click an `.html` in a project → the page opens in the rail.

---

## 4. Feature 4: sidebar marks on linked design chats

### 4.1 Manifest

    engines.openchamber: ">=2.8.0"
    contributes.marks: true
    contributes.service.keepRunning: true

The approval dialog gains "Show marks in the sidebar" (N12), so every user approves the update once. Users on
2.7.x stop getting updates (accepted by the owner). Bonus: with the service up from OpenChamber's start, the
instructions note is stored before the first message after install, which closes the gap accepted in §11.6.

### 4.2 Data flow
`designs on disk → watcher → hub → design index (+ check counts per linked design) → planMarks (pure) → diff with
what was applied → rate-limited setMark({ sessionId }, mark | null) → host draws the row mark → click opens our
panel in that session → rail list shows "This chat" first`.

**Module** new `src/service/session-marks.ts`, `createSessionMarks({ index, checks, activity, hostCalls, hub, log,
now })`, started in `compose.ts` after the watcher baseline, disposed on dispose.

    planMarks(designs: DesignSummary[], counts: Map<slug, { errors: number } | null>, max = SERVICE_MARKS_MAX)
      → Map<sessionId, ServiceMark>
      - group designs by non-null sessionId (subagent sessions are never linked, §10.5)
      - order sessions by their newest design's `updated`; keep the first `max`
      - per session: tone 'warning' when any design has counts.errors > 0 or openComments > 0, else 'neutral';
        icon 'palette'; text from markText()
    markText(titles, issues) → string ≤ SERVICE_MARK_TEXT_MAX (200)
      neutral, one design:   "Pricing"
      neutral, several:      "Pricing and 2 other designs"
      warning:               "Pricing: 1 check error, 3 comments not sent" (counts summed over the session's designs;
                             only the parts that are non-zero; "check errors", "comments" pluralised)
      titles: control characters stripped, one line, cut with "…" so the whole text fits

The host prefixes "Design Chamber: " (N12).

**Reconcile loop** (all in memory; nothing persisted, since marks die with the process, N13):
- `applied: Map<sessionId, string>` (the serialised mark last saved). `desired` from `planMarks`.
- Changes = sets where desired differs from applied, then removals (`null`) for applied sessions no longer
  desired. Sent through a token bucket of `MARKS_RATE_PER_MIN` (50, under the host's 60) so a cold start with 200
  linked chats takes about 4 minutes, newest chats first. A 429 pauses the bucket 60 s; a 409 `TOO_MANY_MARKS`
  (should not happen, `max` is the host cap) logs once and stops adding until a removal.
- Triggers: the index's refresh (after `added|removed|design|comments|files|root`), `checks` events, and
  `turn-finished` / `turn-failed` (through the activity tracker). Coalesced: one reconcile at most every
  `MARKS_DEBOUNCE_MS` (2 000), never two in flight.
- **Check counts, kept cheap:** only for linked designs; one `checks.get(slug)` at a time, each raced against
  `MARK_CHECK_READ_MS` (5 000; a loss keeps the last count, or no count). A design's count is recomputed only
  after it has been quiet `MARK_SETTLE_MS` (5 000) since its last `files`/`design`/`checks` event, and not while
  its session is `working` in the activity tracker (the turn's end triggers it), so the agent writing a screen
  does not re-run static checks on every save and the tone does not flicker mid-turn. Measured cold cost below.
- Removal: a design deleted, moved to another chat or the root changed → its session's mark is recomputed or
  removed. Extension paused or removed → the host drops marks with the process.
- Start: wait `index.ready(DESIGN_INDEX_TURN_WAIT_MS)`; then plan with neutral tones at once (no counts yet), then
  upgrade to warning as counts come in. Marks never show a stale warning from a previous run.

**`host-calls.ts`** gains `setMark(target, mark): Promise<'saved' | 'unavailable' | 'refused' | 'limited'>` beside
`setInstructions`, same rules: never throws, the token stays in the SDK client, only the error code is logged
(`HOST_UNAVAILABLE` → unavailable, `TOO_MANY_EVENTS`/`TOO_MANY_MARKS` → limited, anything else refused).
`refused` (for example `NOT_GRANTED` after an update the user has not approved yet) stops the loop until the next
service start, logged once.

**Where a click lands.** The host opens our panel in that row's session (N14). The rail cannot tell a mark click
from an icon click, so the rail list gains a **This chat** group at the top, shown when the frame's
`ready.session.id` has linked designs (from the store's list, `sessionId` match): up to 3 rows with the usual row
layout, "and N more" opens the list filtered to them. On the list only; a viewer that is open stays open. It also
helps the plain rail icon click. (`src/ui/rail/list-view.ts`, `src/ui/model/list-model.ts`.)

### 4.3 Quiet mode (the cost of staying up)
Before this feature the service stopped after ten idle minutes; now it runs for as long as OpenChamber does. Two
things become worth trimming, both in a new `src/service/pace.ts`:
- **Watcher backstop.** `WATCH_POLL_MS` (3 000) polls a rotating tenth of the designs. While no frame has asked for
  `GET /changes` for `QUIET_AFTER_MS` (10 minutes; a visible frame long-polls every 15 s), the poll runs every
  `WATCH_POLL_QUIET_MS` (60 000). `fs.watch` stays on, so changes still arrive at once; the backstop only bounds
  what a missed event costs (marks up to a minute late). The next `GET /changes` returns to 3 s and runs one
  `pollNow()` first. `src/service/watch.ts` gains `setPollMs(ms)`; `routes/changes.ts` calls `pace.touch()`.
- **Render cache.** `RENDER_CACHE_MAX_BYTES` is 256 MB of bundled documents held for chunked transfer. Entering
  quiet mode drops it (`render-cache.ts` `dropAll()`); a frame that opens later rebuilds what it shows. Static check
  memos stay (small, and marks need them).

Nothing else changes: no new timer while active, no polling of the host (marks are pushed, N13).

### 4.4 What the user sees

| State | Sidebar row of a linked chat |
|---|---|
| Linked, nothing waiting | palette mark, neutral; tooltip "Design Chamber: Pricing" |
| Check errors or comments not sent | palette mark, warning; "Design Chamber: Pricing: 1 check error, 3 comments not sent" |
| Several designs in one chat | one mark; "Pricing and 2 other designs", warning when any has issues |
| Comments sent, errors fixed | back to neutral within about 2 s of the change (5 s after the agent's last save) |
| Design deleted or moved to another chat | mark gone from the old row |
| More than 200 linked chats | the 200 with the newest designs |
| Click on the mark | the chat opens, Design Chamber's rail opens with **This chat** at the top |
| Extension paused, removed, OpenChamber 2.7 | no marks |

### 4.5 Failure behaviour
- No callback URL (tests, a 2.7 host that somehow runs it): `unavailable`, logged once, no loop.
- Host refuses (not granted, extension paused): `refused`, loop stops until restart.
- Rate limit: bucket pauses 60 s; desired state is recomputed when it resumes, so nothing stale is sent.
- Check read slow or failing: keep the last tone for that design; never warning from a failed read alone.
- Service crash: the host brings it back (N15); marks are set again from the files at start.
- Designs folder missing or changed: the index lists nothing for a missing root → every mark removed; a new root →
  marks for its linked designs.
- Malformed or huge `design.json`: the store's tolerant parser and caps apply before the index; a design the index
  cannot read has no `sessionId` and gets no mark.

### 4.6 Threat model
- **Bearer token:** `setMark` goes through `createServiceHost` with the service token, like `setInstructions`; the
  token never reaches a log (only codes), a file, a mark or a frame.
- **Containment:** marks read only the index and check service, which already contain every path under the root.
  No new route; no path in or out.
- **Untrusted text:** design titles and slugs are agent-written. They reach the host only as `text` (plain text,
  tooltip), through `markText`: control characters stripped, one line, ≤ 200, never `url` (we have a panel, so
  `url` is ignored anyway and we send none). Counts are numbers. The `sessionId` is the one the service already
  validated when linking (`SESSION_ID_MAX`, printable, §9.11).
- **Least privilege:** `marks` is its own approval line; we add no `sessionControl`, no `content`. The mark says
  only that a chat has a design and whether it needs attention.
- **Abuse:** an agent can make many designs and link them only through chips the user sent (§10.5), so it cannot
  flood marks beyond its own chats; the 200 cap and the rate bucket bound the rest.

### 4.7 Cost (measured 2026-11-27, this machine, Linux, Node of the dev setup)
`dist/service/main.js` on a scratch copy of the real Designs folder (17 entries, 125 MB, 14 designs), no frame
connected, today's 3 s poll:

| Measure | Value |
|---|---|
| Resident memory, idle after start | 100 to 114 MB RSS |
| CPU over 60 s idle | 5 ticks = 0.05 s per minute (about 0.08% of one core) |
| Open file descriptors | 23 |
| Cold static checks for all 14 designs, serial | 397 ms total, slowest 103 ms |
| RSS after that sweep | 188 MB (V8 keeps the high-water mark) |

So the price of `keepRunning` is mostly memory. CPU stays near zero; quiet mode cuts the backstop's wakeups from
20 a minute to 1. Marks add one small reconcile per design change and a few host calls a minute at most.

**Re-measured after the build** (2026-11-27, Node 26.13, built service with marks and quiet mode, a copy of the real
Designs folder: 14 designs, 107 MB, two linked chats; a stand-in host; one run):

| Measure | No view ever opened | After rendering all 164 documents (54.7 MB) |
|---|---|---|
| RSS before quiet mode | 111 to 114 MB | 214 MB (306 MB just after rendering) |
| RSS in quiet mode, over 160 s | 111 MB | 214 MB |
| CPU per minute, active then quiet | 0.05 s then 0.01 s | 0.05 s then 0.01 s |

Quiet mode does **not** lower resident memory straight away. Dropping the caches releases the documents for
collection, but an idle Node has no reason to collect, so RSS stayed where it was for as long as it was watched.
A collection forced in a separate run took the heap in use from 119 MB to 21 MB and RSS from 302 MB to 207 MB.
The service does not force one (decided 2026-11-27): the memory is reused by the next work that needs it.

### 4.8 Tests
- `test/service/core/session-marks.test.ts` (new): `planMarks` (grouping, order, cap, tones from errors and open
  comments, null counts), `markText` (one, several, warning parts, plural, control characters, 200 cap with a long
  title, never cut mid surrogate pair), reconcile diff (set, replace, remove, unchanged sends nothing), bucket (50
  a minute, 429 pause, refusal stops), settle and working deferral (fake clock), root change removes all, start
  sets neutral first. Mutation: drop the cap in `planMarks`, a test goes red.
- `test/service/core/host-calls.test.ts`: `setMark` result mapping with an injected client; no token in logs.
- `test/service/core/pace.test.ts` (new): quiet after 10 minutes without `/changes`, back to active with one
  `pollNow`, render cache dropped once.
- `test/service/core/watch.test.ts`: `setPollMs`.
- `test/ui/list-model.test.ts`: This chat group (none, one, three, more).
- `test/manifest.test.ts`: `marks`, `keepRunning`, engines; `npm run guest-check` with the 2.8.1 checker.
- Live: folder install on 2.8.1; a linked chat shows the mark; add a comment → warning; send it → neutral; click
  → rail with This chat.

---

## 5. Cross-cutting

### 5.1 Data changes
- `design.json`: none. Agents see no new key.
- `.chamber/state.json` (service-owned): optional `importedFrom: { path: string ≤ 4096, sha256: hex64, at: IsoDate }`
  (§3). Old states read as before; a malformed value is dropped by the state parser (verify the parser in
  `src/service/store.ts` keeps unknown-key tolerance and add the field to its reader).
- Settings: none. Cache layout: none. `.versions/`: none.
- `src/shared/api.ts`: `StatusDesignRow.sessionId`, `FromFileBody`, `FromFileResponse`, route
  `'POST /pages/from-file'` (owner WP3).
- `src/shared/limits.ts` (one appended block): `SESSION_TOOL_NAME_MAX` 128, `SESSION_TOOL_TARGET_MAX` 1024,
  `TOOL_REPAINT_MS` 1000, `FILE_PAGE_PATH_MAX` 4096, `FILE_PAGE_COPY_MAX_BYTES` 50 MB, `FILE_PAGE_COPY_BUDGET_MS`
  12 000, `FILE_PAGE_DEDUPE_SCAN_MAX` 50, `MARKS_RATE_PER_MIN` 50, `MARKS_DEBOUNCE_MS` 2000, `MARK_CHECK_READ_MS`
  5000, `MARK_SETTLE_MS` 5000, `QUIET_AFTER_MS` 600 000, `WATCH_POLL_QUIET_MS` 60 000. SDK limits
  (`SERVICE_MARKS_MAX`, `SERVICE_MARK_TEXT_MAX`) are imported, never copied (§9.15 rule).
- `src/service/context.ts`: `HostCalls.setMark`; `CreateDesignInput.importedFrom?` (service-internal, not on
  `CreateDesignBody`); `ServiceContext.pace` (`touch()`).
- `src/shared/types.ts`: `ServiceState.importedFrom?`.

### 5.2 Not building
- A live link from a page to the project file (instead of a copy): breaks "files on disk are the source of truth,
  one folder per item" and puts an outside path in the design contract.
- Rewriting `../` references so files above the HTML's folder can be copied: a source rewrite of user HTML for a
  rare layout; the viewer already reports what is missing.
- Single-file inlining (the export bundle) as the copy: the agent could no longer edit a page full of data URLs.
- Marks on `/design-system` chats: Open Question 5.
- Marks for agent activity (working, question): the host already marks sessions it knows are busy.
- An app-drawn `statusSection.source`: the frame stays (it opens the rail and sees its chat; review §Not
  recommended).
- A phone layout for the 1400 px page app: the compact layout is reused instead.
- Tool names beyond the table: unknown tools keep the generic sentence.
- A user setting to switch marks off: pausing the extension or the host's own row settings do it.

### 5.3 Security and threat model, summary per surface

| Surface | Authn / authz | Validation | Exposure | Abuse and mitigation |
|---|---|---|---|---|
| Session `tool` in strip and Work Status | host grant `sessions` (existing) | `readSessionTool`, `middlePath`, `textContent` | our frames only | model-written target shown as text only |
| `StatusDesignRow.sessionId` | bearer (existing route) | from the index | our status frame | none: ids already visible to the frame |
| `ready.device` | host | `deviceOf` clamps, defaults | none | numbers only reach CSS variables |
| `POST /pages/from-file` (new) | bearer in `http.ts`; called only by the background frame from a host `onAction` on a user's click; design iframes and blocks never | `parseFromFileBody`, `resolveFileTarget` (pure, posix + win32), O_NOFOLLOW reader, `resolveInside(folder)` for every asset, MIME allowlist, caps, per-path lock | reads one picked `.html` and its local files; writes only a new design folder | no model trigger; escapes and links refused; half-made design trashed |
| `setMark` (new host call) | service token through the SDK; `marks` grant | `markText`, closed tone and icon, no `url` | a design title and counts on the user's own sidebar | cap 200, bucket 50/min, chips-only linking |
| `keepRunning` | host | n/a | a resident process holding no secret but the token | crash loop backed off by the host; quiet mode trims wakeups and releases the render caches (RSS falls only at a later collection, §4.7) |

### 5.4 Edge cases (rule 3 walk)
- **Concurrency and races:** two background frames for the same file → per-path lock 409; two different files →
  independent (the store's create lock already serialises slug allocation). Marks reconcile never runs twice at
  once (one in flight, coalesced). A tool snapshot racing a link change: `generation` in `watchBuildActivity`
  already retires the old subscription. The status frame's `onSessions` from a previous project is dropped on
  project change by a sequence check (same pattern as `resolveSeq`).
- **Partial failure and retries:** file copy is all or nothing (trash on failure); a retry after success reuses
  the copy. `setMark` failures are retried by the next reconcile from desired state (idempotent, N13). No retry of
  a background action (host rule), the user clicks again.
- **Empty, error, loading:** strip and Work Status keep every existing state; This chat hides when empty; the file
  action answers every non-HTML row with a sentence.
- **Permission boundaries:** marks refused → loop stops, rest of the service unaffected. `sessions` withdrawn →
  tools vanish, file-based words remain. Phone without `panel.mobile` → copy says where to go.
- **Agent writes while the watcher fires:** marks wait `MARK_SETTLE_MS` and skip working sessions; a file copied
  by §3 that the agent is mid-writing in the project is read once, so the copy is one consistent snapshot of the
  entry (assets may be a moment newer; acceptable, it is an import).
- **Missing or changed designs folder:** marks removed or rebuilt (§4.5); the file action refuses targets inside
  the new root only by the realpath of the root at call time.
- **Theme switch mid-render:** unchanged (`applyHostReady` every ready); device variables reapplied on the same
  ready.
- **Malformed or huge design.json:** existing parser and caps; such a design has no link, no mark, and no tool
  path mapping (the strip falls back to the host target).
- **Headless Chrome missing:** checks counts still come from static checks (render part `unavailable`), so marks
  can still warn on static errors; thumbnails fall back as today.
- **Service restart:** marks re-set from files; the strip's feed resyncs on the new epoch; tool data is host-side
  and unaffected; an in-flight file copy is lost with its frame, its half-made folder is a provisional design the
  existing reconciler handles (verify: `store` `provisional` handling) or sits in the list as a page with no entry,
  "Waiting for agent".
- **Windows:** `resolveFileTarget` with `path.win32` (drive letters, backslashes, `C:` vs `c:`, UNC refused);
  `samePath` for the dedupe and the per-path lock key; the tool target from OpenCode may use backslashes on
  Windows: `toolPath` splits basenames on both separators.
- **Phone specifics:** the on-screen keyboard opens over the ask bar (`--dc-keyboard`); rotation mid-pinch ends the
  gesture (pointer cancel); a relay drop shows the existing not-responding state.

### 5.5 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A bare tool target matches a design file by name while the agent edits a project file of the same name | Low | Only a unique basename maps; worst case the strip names the design path for a moment |
| Tool words flicker during fast reads | Low | 1 s repaint throttle; announce only edits and writes |
| `GuestFileItem.path` turns out relative to something other than `directory` (N10) | Medium | `resolveFileTarget` handles absolute and directory-relative; live check in QA before merge |
| Phone docs disagree on marks and mark taps (N17) | Low | nothing depends on it; record what the device does |
| Resident memory (about 110 MB, more after heavy viewing) on low-memory machines | Medium | quiet mode drops the render caches (designs 256 MB cap, living pages and boards 64 MB each), which frees them for reuse but does not lower RSS until Node next collects (§4.7); the owner accepted the trade |
| `engines >=2.8.0` strands 2.7 users | Low | owner accepted; README and release notes say so |
| Marks cold start takes minutes with many linked chats | Low | newest first, 50 a minute |
| Static checks on many linked designs at start | Low | serial, 5 s cap each, measured 0.4 s for 14 designs |
| Rebase conflicts with use-the-project and system-builder-depth | Medium | merge them first; additive edits in shared files (§0.3) |

### 5.6 Sandbox and path safety
- **Sandbox flags and CSP:** unchanged everywhere. Design, board and living-page frames stay `ARTBOARD_SANDBOX`
  (`allow-scripts`, no `allow-same-origin`), blob feed, guest CSP (F2, F3). No new iframe surface: the phone page
  and panel are the same guest frames the host already sandboxes (F1).
- **Containment function:** `resolveInside` in `src/service/paths.ts` stays the one function for every path under
  the designs root and under a source folder. New pure `resolveFileTarget` only normalises the user's picked file
  (it is not a containment check; containment for reads is `resolveInside(folder, …)` in the live file source, for
  writes `resolveInside(designDir, …)`). Its tests: posix and win32 absolute, relative with and without
  directory, `..` escape from directory, NUL and control characters, UNC and `\\?\`, drive letter case, length cap.
- **What crosses postMessage:** nothing new between the page and design frames. Host to frame: `ready.device`
  (numbers, enums) and session `tool` (strings, validated). Frame to host: unchanged calls.
- **Theme tokens used by new UI:** This chat group and phone chrome use `--oc-fg`, `--oc-muted`, `--oc-border`,
  `--oc-hover`, `--oc-bg`, the status colours and the kit look; spacing `--dc-s1` to `--dc-s6`; device insets as
  `--dc-inset-*` / `--dc-keyboard` (layout only, no colour). Marks are drawn by the host from its theme (N12).

### 5.7 Data flow (one line each)
- Tool: OpenCode call → host session record → `onSessions` → `readSessionTool` → reducer / status map → words →
  throttled paint.
- Phone: `ready.device` → `deviceOf` → `applyDevice` + route + copy → `openSurface` to the drawer tab.
- Files: user click → `GuestFileItem` → background `runAction` → `POST /pages/from-file` → read, copy, create →
  open request → rail → toast.
- Marks: disk → watcher → hub → index + counts → `planMarks` → diff → bucket → `setMark` → host row → click → rail
  This chat.

---

## 6. Tasks

Waves run in order; tasks in one wave touch disjoint files and run in parallel. Builders in a wave run only their
narrow tests; the main agent runs the full gates after each wave, then QA. Shared root files and WP0 interface
files are the main agent's (AGENTS.md). Start after `feat/use-the-project` and `feat/system-builder-depth` merge
(§0.3).

### Wave 0

### T0a Interfaces and limits (Priority: High | Effort: S)
**Agent:** main agent (WP0 files) · **Depends on:** both in-flight branches merged · **Blocks:** every task
**Files:** `src/shared/api.ts`, `src/shared/limits.ts`, `src/shared/types.ts`, `src/service/context.ts`, `src/service/compose.ts` (stubs), `src/service/routes/chat.ts` (route stub), `test/shared/api.test.ts`
**Description:** Add the shapes of §5.1: `StatusDesignRow.sessionId`, `FromFileBody`/`FromFileResponse` and the
route key (owner `WP3`), the limits block, `ServiceState.importedFrom`, `HostCalls.setMark`,
`CreateDesignInput.importedFrom`, `ServiceContext.pace`. Stub `setMark` (`unavailable`) and `pace` (`touch` no-op)
in `compose.ts` so the build stays green, and register a stub for the route that answers 422 `invalid` "This
isn't ready yet." until T5 lands.
**Acceptance:** typecheck passes; api test counts the new route; no behaviour change.
**Docs:** none (no user-facing change).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · sandbox/CSP and path containment untouched

### T0b Manifest (Priority: High | Effort: S)
**Agent:** main agent (shared root file) · **Depends on:** T0a · **Blocks:** T7, QA
**Files:** `package.json`, `test/manifest.test.ts`, `scripts/build.mjs` (define `__DC_PANEL_MOBILE__` from the manifest)
**Description:** `engines >=2.8.0`, `panel.mobile` (per Open Question 1), `page.mobile`, the `open-file-as-page`
action, `marks: true`, `service.keepRunning: true`. Update `README.md` install notes (2.8.0 floor, resident service).
**Acceptance:** `npm run guest-check` says the package is ready; manifest test asserts each key.
**Docs:** `README.md`, `documentation/features/local-service.md` (resident service, quiet mode placeholder line).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` · `npm run guest-check` pass

### Wave 1 (backend, parallel)

### T1 Session tool reader and strip track (Priority: High | Effort: S)
**Agent:** backend-developer (sonnet) · **Depends on:** T0a · **Blocks:** U1, U2
**Files:** `src/guest/session-tool.ts` (new), `src/guest/build-activity.ts`, `test/guest/session-tool.test.ts` (new), `test/guest/build-activity.test.ts`
**Description:** §1.2 reader and the `tool` field on `BuildInput`/`BuildTrack`, cleared off `running`, included
in the no-change compare.
**Acceptance:** §1.6 guest tests; a mutation of the name pattern goes red; existing build-activity tests unchanged.
**Docs:** none (U1 documents the strip).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### T2 Work Status rows carry the session (Priority: High | Effort: S)
**Agent:** backend-developer (sonnet) · **Depends on:** T0a · **Blocks:** U2
**Files:** `src/service/status-designs.ts`, `src/service/routes/status.ts`, `src/guest/fake-services.ts`, `test/service/core/status-designs.test.ts`
**Description:** `sessionId` on each row from the index; the fake service returns it.
**Acceptance:** rows carry `sessionId` (null when unlinked); cold index still answers the empty list.
**Docs:** none (U2).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### T3a Quiet mode (Priority: High | Effort: M)
**Agent:** backend-developer (opus: resident service, filesystem watcher) · **Depends on:** T0a · **Blocks:** T3c
**Files:** `src/service/pace.ts` (new), `src/service/watch.ts`, `src/service/render-cache.ts`, `src/service/routes/changes.ts`, `test/service/core/pace.test.ts` (new), `test/service/core/watch.test.ts`
**Description:** §4.3: `createPace({ watcher, renders, now })` with `touch()`; `setPollMs`; `dropAll()`; the
changes route touches.
**Acceptance:** fake-clock tests for quiet entry, wake with one `pollNow`, cache dropped once; `fs.watch` never
stopped.
**Docs:** none (T3c).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### T3b Marks module and host call (Priority: High | Effort: M)
**Agent:** backend-developer (opus: host calls with the service token) · **Depends on:** T0a · **Blocks:** T3c
**Files:** `src/service/session-marks.ts` (new), `src/service/host-calls.ts`, `test/service/core/session-marks.test.ts` (new), `test/service/core/host-calls.test.ts`
**Description:** §4.2 `planMarks`, `markText`, reconcile, bucket, settle and working deferral; `setMark` in host
calls.
**Acceptance:** §4.8 service tests including the cap mutation; no token or title in any log line.
**Docs:** none (T3c).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### T5 Files action: service (Priority: High | Effort: L, split: T5a target + read, T5b copy + route)
**Agent:** backend-developer (opus: path handling outside the root, filesystem writes) · **Depends on:** T0a · **Blocks:** T6
**Files:** `src/service/file-page.ts` (new), `src/service/loose.ts` (extract `readRegularFile`), `src/service/store.ts` (`importedFrom` on create and in the state reader), `src/service/routes/chat.ts` (route), `test/service/core/file-page.test.ts` (new), `test/service/core/loose.test.ts`, `test/service/core/store.test.ts`
**Description:** §3.3 steps 1 to 9.
**Acceptance:** §3.7 service tests, posix and win32 cases; the escape mutation goes red; loose import unchanged.
**Docs:** `documentation/features/open-file-as-page.md` (new).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · path containment re-tested

### Wave 2

### T3c Wire marks and quiet mode (Priority: High | Effort: S)
**Agent:** backend-developer (opus) · **Depends on:** T3a, T3b · **Blocks:** QA
**Files:** `src/service/compose.ts`, `test/service/integration/compose.test.ts`
**Description:** Replace the T0a stubs; start marks after the watcher baseline; dispose both. Re-measure §4.7 on the
built service with a scratch root (`DC_SETTINGS_PATH`) and paste the numbers.
**Acceptance:** service starts with no callback URL and logs `unavailable` once; integration test green; measured
numbers in the report.
**Docs:** `documentation/features/local-service.md` (always on, quiet mode, cost), `documentation/features/sidebar-marks.md` (new).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### T6 Files action: background frame (Priority: High | Effort: S)
**Agent:** backend-developer (sonnet) · **Depends on:** T5, U0 (for `openHelp`) · **Blocks:** QA
**Files:** `src/guest/flows.ts`, `src/guest/fake-services.ts`, `test/guest/flows.test.ts`
**Description:** §3.3 frame branch and §3.4 toasts.
**Acceptance:** flows tests for each toast; message action untouched.
**Docs:** `documentation/features/open-file-as-page.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### U0 Device foundation (Priority: High | Effort: M)
**Agent:** ui-ux-developer (sonnet) · **Depends on:** T0a, T0b · **Blocks:** U2, U3, U4, U5, T6
**Files:** `src/ui/model/device-model.ts` (new), `src/ui/components/device.ts` (new), `src/ui/blocks/blocks.css`, `src/ui/status/status.css`, `test/ui/device-model.test.ts` (new), `test/ui/visual/fake-host.ts`, `test/ui/visual/shoot.mjs` (a 390 × 844 phone size)
**Description:** §2.2 `deviceOf`, `openHelp`, `applyDevice`; coarse hit areas in the block and status styles; the
fake host can send a device.
**Acceptance:** model tests; harness can shoot a phone size.
**Docs:** none (U3).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · colours from host tokens only

### U1 Tool words in the strip (Priority: High | Effort: S)
**Agent:** ui-ux-developer (sonnet) · **Depends on:** T1 · **Blocks:** U2
**Files:** `src/ui/model/tool-model.ts` (new), `src/ui/model/build-strip-model.ts`, `src/ui/wall/feature-build-strip.ts`, `test/ui/tool-model.test.ts` (new), `test/ui/build-strip-model.test.ts`, `test/ui/visual/scenarios/build-strip.mjs`
**Description:** §1.2 words, `buildView` changes, the 1 s throttle.
**Acceptance:** §1.6 UI tests; harness shots of "editing a screen" and "reading a project file", rail 320/480 and
page 1400, dark and light.
**Docs:** `documentation/pages/viewer.md` (build strip words).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### Wave 3 (UI, parallel, disjoint files)

### U2 Work Status: tools and phone copy (Priority: High | Effort: M)
**Agent:** ui-ux-developer (sonnet) · **Depends on:** T2, U0, U1 · **Blocks:** QA
**Files:** `src/ui/status/main.ts`, `src/ui/model/status-model.ts`, `test/ui/status-model.test.ts`, `test/ui/visual/scenarios/work-status.mjs`
**Description:** §1.2 status map and `agentPart`; `applyDevice`; `openHelp` copy.
**Acceptance:** tests; harness shots desktop and phone.
**Docs:** `documentation/features/work-status.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### U3 Phone shell: routing, compact layout, menus (Priority: High | Effort: M)
**Agent:** ui-ux-developer (opus: a new surface layout) · **Depends on:** U0 · **Blocks:** U6, QA
**Files:** `src/ui/app.ts`, `src/ui/rail/rail-app.ts`, `src/ui/wall/design-view.ts`, `src/ui/model/viewer-menu.ts`, `src/ui/model/wall-model.ts` (`liveBudget`), `src/ui/components/settings-view.ts` (one line), `src/ui/styles.css`, `test/ui/viewer-menu-model.test.ts`, `test/ui/visual/scenarios/phone.mjs` (new)
**Description:** §2.2 routing, budget, hidden actions, keyboard and inset padding, hint and tip copy (the tip lives
in `list-view.ts`; U3 passes the `openHelp` text in through `rail-app.ts` so U6 owns that file).
**Acceptance:** tests; phone harness: list, canvas, page, Settings, dark and light; desktop shots unchanged.
**Docs:** `documentation/pages/rail-panel.md`, `documentation/pages/full-screen-page.md`, `documentation/features/phone.md` (new).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · colours from host tokens only

### U4 Touch on the wall (Priority: Med | Effort: M)
**Agent:** ui-ux-developer (sonnet) · **Depends on:** U0 · **Blocks:** QA
**Files:** `src/ui/model/wall-input.ts`, `src/ui/wall/input-controller.ts`, `src/ui/wall/camera-controller.ts`, `test/ui/wall-input-model.test.ts`
**Description:** §2.2 pinch and coarse drag-to-pan; fine pointer unchanged.
**Acceptance:** pure tests; every existing wall test green.
**Docs:** `documentation/features/phone.md` (gestures line).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### U5 Blocks on the phone (Priority: High | Effort: S)
**Agent:** ui-ux-developer (sonnet) · **Depends on:** U0 · **Blocks:** QA
**Files:** `src/ui/blocks/main.ts`, `src/ui/blocks/design-card.ts`, `src/ui/blocks/system-ask-diff.ts`, `src/ui/model/system-ask-model.ts`, `src/ui/model/system-page-model.ts` (one sentence), `test/ui/blocks-model.test.ts`, `test/ui/system-ask-model.test.ts`, `test/ui/visual/scenarios/chat-blocks.mjs`
**Description:** §2.2 blocks: `applyDevice`, `openHelp` copy, Comment hidden only when the panel is not on the
phone. Also fixes review F5.
**Acceptance:** tests; phone and desktop harness shots of DesignCard and DirectionPick.
**Docs:** `documentation/features/chat-blocks.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### Wave 4

### U6 This chat group on the rail list (Priority: Med | Effort: S)
**Agent:** ui-ux-developer (sonnet) · **Depends on:** U3 · **Blocks:** QA
**Files:** `src/ui/rail/list-view.ts`, `src/ui/model/list-model.ts`, `test/ui/list-model.test.ts`, `test/ui/visual/scenarios/rail-filters.mjs`
**Description:** §4.2 "Where a click lands", plus the first-run tip text from U3.
**Acceptance:** list-model tests (none, one, three, more); harness shots rail 320/480, dark and light.
**Docs:** `documentation/pages/rail-panel.md`, `documentation/features/sidebar-marks.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### Wave 5

### Q1 QA (Priority: High)
**Agent:** qa-tester (strongest model: risk surfaces are path handling outside the root, the service token's host
calls and a resident process) · **Depends on:** all · then browser-tester (rail 320/480, page 1400, phone 390,
dark and light, scratch root) · then a folder-install smoke on OpenChamber 2.8.1 for N10, N17, the mark, the Files
action and the phone opener.
**Docs:** the architect folds this spec into `docs/SPEC.md` (§5, §7, §9, §13, §16) on the main agent's request.

---

## Open Questions (only the owner can answer)

1. **Panel on the phone too?** `page.mobile` alone gives the More menu page you asked for, but every **Open** in a
   chat card, Work Status, the Files action and a mark tap needs `panel.mobile` to land anywhere on the phone (N6).
   **Recommendation: yes, opt the panel in too.** It adds a Design Chamber tab to the phone's workspace drawer.
2. **The Files action shows on every row** (the host has no file-type filter, N9), folders included; other rows get
   a one-line toast. **Recommendation: keep the label "Open as page in Design Chamber"** as you chose.
3. **Clicking the same file again:** open the copy already made when the file is unchanged, or always make a new
   copy? **Recommendation: open the existing copy when unchanged, a new copy when the file changed.**
4. **Copy, not a live link:** the page is a snapshot of the file and the files next to it it uses; later edits in
   the project don't follow. **Recommendation: copy** (a live link would put a project path into the design and
   break "one folder per item").
5. **Marks on `/design-system` chats as well?** **Recommendation: not now**; design chats only, as you asked.
6. **What turns a mark to warning:** check **errors** (not warnings or notes) and comments the user added but has
   not sent yet. **Recommendation: as stated.**
7. **Show what the agent is doing outside the design** (for example "Reading src/styles/theme.css" while it builds
   from your project)? **Recommendation: yes**, it is the linked agent and the file is yours.

Architecture Complete → main agent (task breakdown) | → backend-developer (T1, T2, T3a, T3b, T5, then T3c, T6) / ui-ux-developer (U0, U1, then U2 to U5, then U6)

## Decisions (the user, 2026-11-27)
Binding for every task.
1. `panel.mobile` too: yes, so Open works on the phone.
2. The Files row label stays "Open as page in Design Chamber"; rows that aren't HTML get a one-line toast.
3. A second click on an unchanged file opens the existing copy; a changed file makes a new copy.
4. Copy, never a live link.
5. Marks on design chats only, not `/design-system` chats, for now.
6. A mark turns to warning on check errors (not warnings) or comments added but not sent.
7. The build strip also shows what the agent does outside the design ("Reading src/styles/theme.css").
8. QA for this work runs on Opus (medium), not Fable.
