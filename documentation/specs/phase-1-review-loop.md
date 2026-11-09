# Phase 1: the review loop (build strip, ask bar, send one pin, findability)

Items 03 to 06 approved 2026-11-08: three parallel branches and PRs on `chore/phase-1-seams`
(§0), itself on `refactor/wall-controllers` (`phase-0-foundations.md` §0c). Authority:
`docs/SPEC.md` (§8, §10, §13), `docs/BRIEF.md`, `AGENTS.md`.

**SDK grounding.** `~/Documents/GitHub/openchamber` is NOT FOUND on this machine. Every SDK fact
below was verified in the installed copy, `node_modules/@openchamber/sdk` v2.5.2
(`API.md`, `DOCUMENTATION.md`, `dist/*.d.ts`, `dist/host.js`):

| Fact | Where verified |
|---|---|
| `onSessions(projectId, listener)` pushes `GuestSessionRecord` with `activity: 'unknown' \| 'idle' \| 'running' \| 'retrying' \| 'waiting-permission' \| 'waiting-question'` and `outcome: 'completed' \| 'failed' \| null` | `API.md:211,220`, `dist/workspace.d.ts:15,37-39` |
| `waiting-question` = "the agent put a form to the user and is waiting on the answer"; question contents are not exposed | `API.md:220` |
| Max 32 workspace subscriptions per frame; observers are shared per query | `DOCUMENTATION.md:38` |
| The sidebar's Extension pages menu is the only page opener; `openSurface` does not open it | `API.md:248` |
| Host toasts offer only Copy and OK buttons and "never call back into the extension" | `API.md:295-299` |
| `host.storage` instance scope: JSON, `undefined` for a missing key | `API.md:238-244` |
| `prompt({ send: false })` replace-composes; `compose({ text, mode: 'append' })` appends | `DOCUMENTATION.md:65`, used in `src/guest/flows.ts:318` |
| Kit `oc-sdk-btn[data-variant="default"]` is a 10 % primary tint, not a filled button | `dist/ui/style.js:220` |

## Questions for the user

Work proceeds on the recommended default; say so if any is wrong.

1. **Busy chat and the composer.** When the linked chat is busy, comments today go into its
   composer with `prompt({ send: false })`, which *replaces* whatever the user was typing there.
   The ask bar would do the same. **Default: switch both to append** (`compose` mode `append`),
   so a draft in the chat composer is never wiped.
2. **"Send this" on comments already sent.** **Default: open comments only.** A sent comment has
   reached the chat once; there is no UI today to reopen a sent comment, and none is added.
3. **Ask bar in the rail viewer too.** **Default: yes**, one line under the wall; it is the only
   way to attach an element from the rail.
4. **Is an ask recorded anywhere besides the chat?** **Default: no**; nothing goes to `design.json`.
5. **Ask while viewing an old version.** **Default: disabled**, "Go back to the current design
   to ask the agent." The agent edits current files, so a question about v3 would mislead.
6. **Undo window after a restore.** **Default: 10 seconds**, paused while pointer or focus is on it.

## 0. Cross-branch prep (`chore/phase-1-seams`, on `refactor/wall-controllers`, before dispatch)

`documentation/specs/phase-0-foundations.md` §0c freezes `WallOptions`/`WallHandle`, does not
split `design-view.ts`, and only *names* Phase 1 seams. So the shared, conflict-prone parts
below go in one prep branch with no behaviour change: the main agent does items 1 and 5 (WP0,
service, harness) and a ui-ux-developer does 2 to 4 plus the seams in §1. Phase 0 item 0a also
edits `src/shared/api.ts`; the main agent sequences the two edits.

1. **WP0 edits** (listed in §6), with the minimal compile fixes in the same commit so the base
   stays green: `restoreNow` in `src/service/versions.ts:425-477` returns
   `before: toSummary(restorePoint ?? latest)` and both fakes (`src/guest/fake-services.ts:554`,
   `test/ui/visual/fake-backend.ts:517`) fill `before`. `parsePromptBody` still refuses `ask`
   until the ask branch lands.
2. **Primary button emphasis** in `src/ui/components/kit.ts`: `BtnOptions.emphasis?: 'primary'`
   writes `data-emphasis="primary"` on the `oc-sdk-btn`. CSS beside the "Pressed toggles" rule
   (`styles.css:196`): `background: var(--oc-primary); color: var(--oc-primary-fg);
   border-color: var(--oc-primary)`; hover `color-mix(in srgb, var(--oc-primary) 88%,
   var(--oc-fg))`, active 80 %; `:focus-visible` `box-shadow: 0 0 0 2px var(--oc-bg), 0 0 0 4px
   color-mix(in srgb, var(--oc-primary) 55%, transparent)` (plain `--dc-ring` vanishes on a
   filled primary); spinner uses `currentColor`; disabled keeps the kit's opacity. No consumer
   yet, so no behaviour change.
3. **CSS blocks**: `scripts/build.mjs:60` copies `src/ui/styles.css` verbatim and
   `index.html` links that one file, so separate CSS files would mean editing two shared root
   files for no gain. Seed three empty blocks at the end of `styles.css`, each a begin and an
   end comment (`/* ===== Phase 1: build strip (feat/build-strip) ===== */` …
   `/* ===== end build strip ===== */`, then ask bar, then findability), one blank line apart,
   so each branch's insertions land in a separate hunk. Each branch writes only inside its
   block, its `prefers-reduced-motion` overrides included.
4. **Feature mount stubs** (seam S9): three files that each export a no-op mount, already
   called from the design view, so no branch edits the design view's composition:
   `src/ui/wall/feature-build-strip.ts`, `src/ui/wall/feature-ask-bar.ts`,
   `src/ui/wall/feature-findability.ts`.
5. **Visual harness seeds** (all three branches touch these files otherwise):
   - `test/ui/visual/host.html`: answer `listProjects` with one project at `ready.directory`;
     keep `onSessions` subscriptions and add `window.__host.setActivity(sessionId, activity,
     outcome)` pushing a sessions snapshot (wire shapes: `workspace-read`,
     `workspace-subscribe` and the `workspace` push in `node_modules/@openchamber/sdk/dist/host.js`
     around lines 114 and 378-401; read them, do not guess); answer `prompt` with
     `{ sent: 'sent' }`, record `prompt`, `compose`, `open-session` payloads in `__host`, and
     `__host.failNext = 'prompt'` fails one; seed storage `tip:full-screen` as dismissed unless
     the URL has `?tip=1`, so existing rail screenshots stay unchanged.
   - `test/ui/visual/shoot.mjs`: import and `plan.push` three scenario modules
     `test/ui/visual/scenarios/{build-strip,ask-bar,findability}.mjs`, each exporting an empty
     `run(helpers)` for now. Each branch fills only its own module.

## 1. Seams (built in `chore/phase-1-seams`)

Placed in the modules Phase 0 §0c creates. Wall-side seams (S4 to S6) are added to
`WallOptions`/`WallHandle` in the prep branch as inert stubs (an option nobody passes, a
`markRecent` that only stores, an `onSelection` that never fires), so the feature branches only
fill bodies in `board-set.ts` (S5) and `popover-layer.ts` (S4, S6) and never edit `wall.ts`.
S5 replaces Phase 0's suggested `setBuildStatus`; S6 is Phase 0's `onSendComment`. The ask bar
needs no `coveredBottom` inset: it is a layout row (S3), so the wall's own resize handling refits.

| # | Seam | Shape | Used by |
|---|---|---|---|
| S1 | **Header status slot** (full-screen toolbar) | `toolbar.statusSlot: HTMLElement`, placed where `dc-spacer` sits today (`design-view.ts:392,401`), `flex: 1 1 auto; min-width: 0`, empty by default | build strip |
| S2 | **Stage overlay** | `stage.overlay: HTMLElement`, absolute over the wall inside `.dc-stage`, `pointer-events: none` (children opt in), above the wall, below sheets and popovers | build strip (rail pill) |
| S3 | **Bottom dock** | `stage.bottomDock: HTMLElement`, a layout row under the stage in the wall column (not under the comments dock); the stage shrinks, the wall's resize handling refits | ask bar |
| S4 | **Wall selection events** | `WallHandle.onSelection(listener: (event: WallSelectionEvent) => void): () => void` and `clearSelection(): void` (types §3.4). Ask branch fills them in `popover-layer.ts`: `selected` in `openComposer` (today `wall.ts:724`), `commented` after `createComment` resolves (`:741-747`), `cleared` from `close()` when a composer was open | ask bar |
| S5 | **Recent board highlight** | `WallHandle.markRecent(sources: ReadonlySet<string \| null> \| null): void`: build branch fills it in `board-set.ts`, setting `data-recent="true"` on every board of those sources, clearing the rest; `null` clears | build strip |
| S6 | **Thread send action** | `WallOptions.onSendComment?: (id: string, body: string) => Promise<void>`, passed by `popover-layer.openThread` to `createThread` as `onSend` | send one pin |
| S7 | **Transient notices** | `notices.setTransient(id: 'export' \| 'restore', node: HTMLElement \| null, ttlMs?: number)`: generalises the `exported` timer (`design-view.ts:93,247-249,480-483`) inside the existing `aria-live` notices region; pauses the timer while the node has hover or focus | findability (undo) |
| S8 | **Compact header actions + menu** | `toolbar.compactActions: HTMLElement` between the title and ⋯ on row one (`design-view.ts:380`); `menu.entries()` defined in one place so findability can drop Versions and Comments | findability |
| S9 | **View context for feature mounts** | `type ViewContext = { slug; surface: 'panel' \| 'page'; isPage: boolean; detail(): DesignDetailResponse; onDetail(listener): () => void; viewing(): { id: string; compare: boolean } \| null; onViewing(listener): () => void; wall: WallHandle; slots: { statusSlot; overlay; bottomDock; compactActions }; actions: ActionContext; scope: Scope }`. Each `feature-*.ts` exports `mount(ctx: ViewContext): () => void`, called once after the wall is built; the returned disposer runs with the view | all three |
| S10 | **Versions restore callback** | the versions controller takes `onRestore(version: { id: string; n: number }): Promise<void>` instead of calling `confirmRestoreVersion` itself (`versions-drawer.ts:82`, `design-view.ts:493-494`) | findability |

## 2. Branch `feat/build-strip` (item 03)

### 2.1 Behaviour

After `/design`, `/page`, "Send comments to chat", "Continue in chat" or an ask, the view shows
what the linked agent is doing, from two sources the frame already has:
**file events** for this design (change feed, `src/guest/changes.ts`) and **the linked
session's activity** (`onSessions` for the design's project). Boards already fill in as files
land (`store.ts:423-431`); new: the latest board gets a short highlight and a strip says what is
going on. No local "just sent" signal (Not building): the session goes `running` within a second.

### 2.2 Inputs and filtering

- **Agent files**: from `files` events for this slug, keep paths that do not start with
  `.versions/`, `.chamber/` or `.trash/` and are not `design.json`. A `files` event with no
  `files` list (a restore emits one, `versions.ts:466`) is ignored: the writer is unknown.
  An `added` event for this slug counts as "the agent started writing" with no file name.
- **Session**: `design.sessionId` and `design.projectDirectory` from the detail. Project id via
  `listProjects()` and `sameDirectory` (exported from `flows.ts:75`), falling back to the
  frame's current directory, the same order as `startLinkedSession` (`flows.ts:276`). Then
  `onSessions(projectId)`; the record with `id === design.sessionId` gives `activity` and
  `outcome`; a `ready` snapshot without it → `gone`; no project, a rejected `listProjects` or
  `onSessions` (grant withdrawn), or `sessionId === null` → `none`. When `none` and the linked
  session is the selected one, `host.session.busy` → `running`, else `idle`. Re-subscribe when
  `sessionId` or `projectDirectory` changes.
- **Pending**: `DesignDetailResponse.pending` (nothing written yet) and `design.created`.
- **Feed status**: `feed.onStatus` (`changes.ts:131`).

### 2.3 Phases, timeouts, copy

Constants live in `src/guest/build-activity.ts` (exported, not in `limits.ts`: only this module
and its tests read them):
`WRITING_WINDOW_MS = 15_000`, `QUIET_MS = 120_000`, `DONE_LINGER_MS = 8_000`,
`PENDING_STALL_MS = 180_000`, `FEED_DOWN_MS = 5_000`, `RECENT_MS = 6_000`.

"Working" means activity `running` or `retrying`. A **turn** starts when activity moves from
anything else to working or `waiting-*`; turn files reset then. `Done` and `Failed` only appear
for a turn this frame saw start (mounting on an idle chat shows nothing, matching the
`watchTurns` rule at `flows.ts:481-484`).

Precedence, first match wins:

| Phase | When | Full-screen text (S1) | Rail pill (S2) | Tone | Action |
|---|---|---|---|---|---|
| `offline` | feed `retrying` for ≥ `FEED_DOWN_MS` and the strip was not `hidden` | Reconnecting to the local service | Reconnecting | warning | none |
| `question` | activity `waiting-question` | The agent is asking you something in the chat | Agent has a question | warning | **Open chat** |
| `permission` | activity `waiting-permission` | The agent needs your OK in the chat | Agent needs your OK | warning | **Open chat** |
| `failed` | turn seen, activity `idle`, outcome `failed`, not dismissed | The agent stopped with an error | Agent stopped | error | **Open chat**, Dismiss |
| `writing` | last agent file < `WRITING_WINDOW_MS` ago | Writing `screens/pricing.html` · 2 of 4 screens written | Writing pricing.html | info | none |
| `retrying` | activity `retrying` | The agent hit a problem and is retrying | Agent is retrying | warning | none |
| `working` | activity `running` | The agent is working (plus "Last saved pricing.html 1 min ago" when a file landed this turn, or "Nothing saved in the last 2 minutes" after `QUIET_MS`) | Agent is working | info | none |
| `done` | turn seen, activity `idle`, outcome not `failed`, < `DONE_LINGER_MS` since idle | Done. Updated 3 files / Done. No files changed | Done | success | **Open chat** only when no files changed |
| `stalled` | `pending` and not working and ≥ `PENDING_STALL_MS` since `created`, not dismissed | Nothing written yet. Check the chat for a question. | Nothing written yet | warning | **Open chat**, Dismiss |
| `hidden` | otherwise | (strip removed) | (pill removed) | | |

Notes:
- Without session knowledge (`none`/`gone`), only `offline`, `writing`, `stalled` and `hidden`
  can occur: the strip never claims "Done" from silence.
- Elapsed time (`0:42`, `12:05`) follows the text in `working`/`retrying`/`writing`, from turn
  start; it is `aria-hidden` and not part of the announcement.
- "2 of 4 screens written": canvas only, from `files.screens[*].exists` in the detail; hidden
  when the design has one screen or is a page.
- File names: full relative path on the full-screen strip, basename in the pill; both cut with
  `middlePath` (`src/ui/model/format.ts:58`, reuse), full path in `title`.
- **Open chat** calls `continueInChat(slug)` (`actions.ts:36`). On the full-screen page this
  closes the page (F12); that is the expected host behaviour.
- Dismiss hides `failed`/`stalled` until the next turn starts or a new agent file lands.

### 2.4 Recent board highlight

On every agent-file batch, map paths to sources with `affectedSources(design, files)`
(`store.ts:76`, reuse). A set of screen ids → `wall.markRecent(set)` (S5); `'all'` (tokens.css,
assets) or a page design → no highlight. Cleared after `RECENT_MS` or by the next batch.
CSS (build-strip block): `.dc-board[data-recent='true']` gets
`box-shadow: 0 0 0 2px color-mix(in srgb, var(--oc-primary) 60%, transparent)` fading to
transparent over `RECENT_MS`; reduced motion: no fade, the ring is removed when the attribute
clears. Never hides the board's own focus ring (`--dc-ring`): the focus rule wins by order.

### 2.5 Types and signatures

`src/guest/build-activity.ts` (new, fullstack-developer):
```ts
export type LinkedActivity = GuestSessionActivity | 'gone' | 'none';
export type BuildInput =
  | { kind: 'files'; at: number; files: string[]; created: boolean } // already filtered
  | { kind: 'session'; at: number; activity: LinkedActivity; outcome: 'completed' | 'failed' | null }
  | { kind: 'detail'; at: number; pending: boolean; created: number; screensWritten: number; screensTotal: number; isCanvas: boolean }
  | { kind: 'feed'; at: number; state: FeedStatus['state'] }
  | { kind: 'dismiss'; at: number };
export type BuildTrack = {
  activity: LinkedActivity; outcome: 'completed' | 'failed' | null;
  turnStartedAt: number | null; turnSeen: boolean; idleAt: number | null;
  turnFiles: string[];               // distinct, capped at 50
  lastFile: { path: string | null; at: number } | null;
  pending: boolean; createdAt: number; screensWritten: number; screensTotal: number; isCanvas: boolean;
  feedDownSince: number | null; dismissedAt: number | null; visible: boolean;
};
export type BuildPhase = 'hidden' | 'offline' | 'question' | 'permission' | 'failed' | 'writing' | 'retrying' | 'working' | 'done' | 'stalled';
export const initialTrack: (now: number) => BuildTrack;
export const agentFiles: (files: readonly string[]) => string[];
export const reduceBuild: (track: BuildTrack, input: BuildInput) => BuildTrack;   // pure
export const phaseOf: (track: BuildTrack, now: number) => BuildPhase;            // pure, §2.3 table
export const nextDeadline: (track: BuildTrack, now: number) => number | null;    // when phaseOf can change by time alone
export type BuildActivity = { get(): BuildTrack; subscribe(listener: (track: BuildTrack) => void): () => void; dismiss(): void; dispose(): void };
export const watchBuildActivity: (deps: { host: GuestHost; feed: ChangeFeed; slug: string; detail: () => DesignDetailResponse | null; onDetail: (l: () => void) => () => void; now?: () => number }) => BuildActivity;
```
`visible` is whether the strip was showing (for the `offline` rule). The watcher owns the one
`onSessions` subscription and a single `setTimeout` to `nextDeadline`; it emits on every input
and at each deadline. No `setInterval` while `hidden`.

`src/ui/model/build-strip-model.ts` (new, ui-ux-developer):
```ts
export type BuildView = { phase: BuildPhase; text: string; pill: string; detail: string | null; elapsed: string | null;
  tone: 'info' | 'success' | 'warning' | 'error'; actions: ('open-chat' | 'dismiss')[]; announce: string | null };
export const buildView: (track: BuildTrack, now: number) => BuildView;
export const formatElapsed: (ms: number) => string;   // "0:42", "12:05", "1:02:03"
```
`announce` equals `text` without the elapsed part and changes only when the phase or the file
changes, so the live region speaks once per change, not every second.

`src/ui/components/build-strip.ts` (new, ui-ux): `mountBuildStrip(host: HTMLElement, options: { compact: boolean; onOpenChat(): void; onDismiss(): void }): { update(view: BuildView): void; dispose(): void }`.
`src/ui/wall/feature-build-strip.ts`: creates the watcher, the strip in S1 (page) or S2
(panel), a 1 s repaint only while the phase shows an elapsed time and the document is visible,
and drives `wall.markRecent`.

### 2.6 Layout and states

- **Full-screen**: in S1, one 28 px line after the mode controls: 8 px dot, text (`--oc-fg`,
  `0.8125rem`), detail (`--oc-muted`) and elapsed (`--oc-muted`, `--oc-mono`), actions as `btn`
  `xs` ghost. Ellipsis; under ~900 px toolbar width the detail drops first. Never wraps the toolbar.
- **Rail 320/480**: S2 pill, top centre of the stage, `--dc-s2` inset, 26 px tall,
  `max-width: calc(100% - 16px)`, `var(--oc-elevated)` on `var(--oc-border)`, radius
  `var(--dc-r-lg)`, shadow `var(--oc-sdk-float)`, text `--oc-elevated-fg`; Open chat as an
  icon button (`chat`), plus `close` only in `failed`/`stalled`. Never shifts the wall.
- **Dot**: info `var(--oc-primary)` with a slow pulse (none under reduced motion), success
  `var(--oc-success)`, warning `var(--oc-warning)`, error `var(--oc-error)`; tone is also in
  the words.
- **States**: idle/empty = removed, no reserved space; loading = n/a; error = `failed`;
  offline service = `offline`. Light and dark from the same tokens.

### 2.7 Accessibility

Strip root: `role="status" aria-live="polite" aria-atomic="true"`, holding the `announce` text
plus an `aria-hidden` elapsed span. All phases polite (the host alerts for questions itself).
Actions are real buttons in DOM order where S1 sits (toolbar groups, strip actions, right
group); the pill's buttons come before the wall surface in Tab order.

### 2.8 Edge cases

- **No linked session**: files-only; a `/design` chip never sent shows `stalled` after 3 min of
  `pending`, which is true: nothing is happening.
- **Session deleted** (`gone`): files-only; reconciliation (`flows.ts:92`) may relink, the
  detail changes, the watcher re-subscribes. Another project: found via `projectDirectory`.
- **Writes while the watcher fires**: the service coalesces; the reducer is order-insensitive
  within a batch (set of files, latest `at`).
- **Service restart**: feed `reset` keeps the track (session state is the host's), clears
  `lastFile` timing so no stale "Writing"; the detail refresh re-feeds `pending`.
- **User restore**: its `files` event has no list, so no "Writing".
- **32-subscription cap**: one more per frame, shared by the host with `watchSessions` for the
  same project. `onSessions` rejection → `none`, one `console.warn` at the boundary.
- **Hidden frame**: the feed pauses; the 1 s repaint stops on `document.hidden`. Theme switch:
  tokens only. Version viewing: the strip stays (it describes the agent).
- **Windows paths**: `sameDirectory` compares drive-letter paths case-insensitively.

### 2.9 Tests

- `test/guest/build-activity.test.ts`: every §2.3 row and the precedence; turn start resets
  files; `done` lingers 8 s; `failed` sticks until dismissed or next turn; no `done`/`failed`
  without a seen start or in files-only mode; `stalled` at exactly 180 s; `offline` only after
  5 s and only if visible; `agentFiles` (`.versions/x`, `.chamber/RULES.md`, `design.json` out,
  `assets/a.png` in); list-less `files` ignored; `nextDeadline` per timed rule; wiring with
  `createFakeHost` (`fake-services.ts:720`, `emitSessions`): found, `gone`, no project,
  re-subscribe on `sessionId` change, dispose. Change one timeout, watch a test go red.
- `test/ui/build-strip-model.test.ts`: copy per phase, full and pill; basename and middle cut;
  `formatElapsed`; `announce` stable across ticks within a phase; "2 of 4" only on canvases.

### 2.10 Visual harness (`test/ui/visual`)

`host.html` support is seeded (§0.5). `fake-main.ts`: `__dcFake.writeFile(slug, path)` emits
`files` with that path. `scenarios/build-strip.mjs`: page 1400 dark and rail 320 light:
working, writing (highlighted board), question, done, failed, stalled (`created` 4 min ago).

### 2.11 Assignment

Two agents in parallel on disjoint files against §2.5: **fullstack-developer** owns
`build-activity.ts` and its test; **ui-ux-developer** the model, view, `feature-build-strip.ts`,
CSS block, model test, scenario, `fake-main.ts` hook, docs. One developer only:
fullstack-developer (the risk is the session wiring), reading the ui-ux agent file first.

## 3. Branch `feat/ask-bar-send-pin` (items 04 and 05)

### 3.1 Ask bar behaviour

A prompt docked under the wall (S3) on the full-screen wall, the page viewer and the rail
viewer. Text goes to the linked chat by the comments' delivery path (`flows.ts:356-386`):
directly to the selected linked chat, via the outbox to a linked chat not selected, or into a
new linked chat when there is none or it is gone (BRIEF).

**Element chip.** In Edit (wall) or Comment (page) mode, clicking an element opens the comment
composer; that click is the selection (S4 `selected`) and the bar shows a chip for it. A new
selection replaces it; adding the comment (`commented`, same key) removes it, the element got a
comment instead; cancelling the composer keeps it; ×, Esc in the bar, a successful send, Play
mode or viewing a version remove it. Clicking into the bar does not close the composer (the
wall's `pointerdown` is on its surface only, `wall.ts:970`).

**Keyboard.** Enter and Ctrl/⌘+Enter send; Shift+Enter adds a line; nothing special during IME
composition (`isComposing`). Esc removes the chip, else focuses the wall; `stopPropagation`.
**Sending** is disabled when blank, sending, over the limit or viewing a version (Q5). Success
clears text and chip; failure keeps both, shows the error, refocuses the textarea.

### 3.2 Ask prompt (service)

`POST /designs/:slug/prompt` with `{ purpose: 'ask', text, element? }`. The service builds the
message so the folder, rules path and chip come from disk like every other purpose
(`chat.ts:355-392`).

`src/shared/agent/ask-prompt.ts` (new):
```ts
export type AskPromptInput = { title: string; kind: DesignKind; folder: string; screens: readonly Screen[]; viewports: readonly Viewport[];
  text: string; element: { screen: string | null; viewport: string; anchor: CommentAnchor } | null; maxChars?: number };
export class AskTooLongError extends Error { readonly over: number }
export const buildAskPrompt: (input: AskPromptInput) => { text: string }; // throws AskTooLongError; the route maps it to ApiError('invalid')
```
Shape (reuses `clip`, `codeSpan`, `rulesPathOf` from `context.ts` and the `location` and
viewport-label logic of `revision-prompt.ts:52-64`; export those two helpers rather than copy
them):
```
[Design Chamber] Request about the canvas "Coffee shop". Folder: <folder>. Rules: <rules path>
About this element: Screen "Pricing" (screens/pricing.html) @ Laptop 1280×800
   element: `main > section.plans > button`
   text: "Start free trial"  html: `<button class="cta">`
<the user's words, verbatim, every line kept>
Change only what this asks; keep everything else. Update design.json "updated".
```
Without an element, the "About this element" lines are absent. Element text and html come from
an agent-written page, so they stay in code spans and quotes like the revision prompt.

Length: user text ≤ `ASK_TEXT_MAX` (12 000, new in `limits.ts`). Whole message ≤
`HOST_TEXT_MAX` (16 000): if over, drop `html`, then shorten element `text` to 40, then drop the
element block; the user's words are never cut. Still over (a pathological folder path) →
`ApiError('invalid', "Your message is N characters too long for the chat. Shorten it and send again.")`.

Route (`src/service/routes/chat.ts`): `parsePromptBody` accepts `ask`; `text` must be a string
of 1..`ASK_TEXT_MAX` after trimming (`bad-request` if missing or not a string, `invalid` with
the over-by count if too long). `element` optional; validated by the comments route's element
check, exported from `src/service/routes/comments.ts` (today inside `validateCreate`, line 28)
as `parseElement(value): Omit<CreateCommentBody, 'body'>`, plus: `screen` is `null` or one of
the design's screen ids, `viewport` is a design viewport id or `PAGE_FILL_VIEWPORT_ID`; anything
else `bad-request`. Returns `{ text, commentIds: [], omitted: [], chip }`. `collectExternal` is
not run for asks (no blocked-URL footer; the banner already offers its own request).

### 3.3 Flows (`src/guest/flows.ts`)

- Extract steps 1 to 3 of `sendComments` (`flows.ts:356-386`) into a private `deliver(slug,
  prompt, design, version, busyMessage)` → `{ outcome: 'sent' | 'composed' | 'outbox' |
  'new-session'; sessionId }`; `sendComments` keeps its behaviour and tests.
- Busy path of `promptSelected` (`flows.ts:257`, `:265`): `compose({ text, mode: 'append' })`
  instead of `prompt({ send: false })` (Q1). New `MESSAGES.busyAsk`: "The agent is busy, so
  your message is waiting in the composer." New member:
```ts
export type AskInput = { text: string; element?: AskElement | null };
export type AskOutcome = 'sent' | 'composed' | 'outbox' | 'new-session';
export type AskResult = { outcome: AskOutcome; sessionId: string | null };
ask(slug: string, input: AskInput): Promise<AskResult>;
```
The outbox carries `commentIds: []`; `deliverOutbox` already handles an empty list (`markSent`
returns early, `flows.ts:230`). Errors: `FlowError`/`ServiceError` as today; nothing is marked.

### 3.4 Selection type (seam S4)

```ts
export type AskElement = Omit<CreateCommentBody, 'body'>;           // src/shared/api.ts (WP0)
export type WallSelection = { key: string; element: AskElement; tag: string; where: string };
export type WallSelectionEvent =
  | { type: 'selected'; selection: WallSelection }
  | { type: 'commented'; key: string }
  | { type: 'cleared' };
```
`key` is `${artboardId}:${anchor.selector}`; `where` is the composer's own location label
("Pricing · Laptop", or the page view name). The anchor comes from `anchorFromHit`
(`anchoring.ts:90`) with the bridge's already-capped fields.

### 3.5 Ask bar UI

Files: `src/ui/model/ask-bar-model.ts` (pure), `src/ui/components/ask-bar.ts` (view),
`src/ui/wall/feature-ask-bar.ts` (mount into S3, subscribe to S4, call `flows.ask`).

```ts
export type AskKey = { key: string; shift: boolean; ctrl: boolean; meta: boolean; composing: boolean };
export const askKeyAction: (key: AskKey, state: { hasChip: boolean }) => 'send' | 'newline' | 'clear-chip' | 'leave' | null;
export const askSendState: (input: { text: string; sending: boolean; viewingVersion: boolean }) => { enabled: boolean; reason: string | null; counter: string | null };
export const chipLabel: (selection: WallSelection) => { tag: string; text: string; where: string };
export const askPlaceholder: (link: 'linked' | 'none') => string;
export const askTarget: (link: { sessionId: string | null; selectedId: string | null; selectedTitle: string | null }) => string;
export const askResultText: (outcome: AskOutcome) => string;
```

Layout:
- **Full-screen**: a row under the stage (`var(--oc-bg)`, top hairline `var(--dc-hair)`,
  padding `--dc-s3`) holding a centred box, `max-width: 760px`, `var(--oc-elevated)` on
  `var(--oc-border)`, radius `var(--dc-r-lg)`: chip (when set), textarea (kit classes as in
  `comment-ui.ts:30`, 1 row growing to 6, then scrolls), foot row with the target line
  (`--oc-muted`, `0.75rem`) and **Send** (`btn` `sm`, icon `send`, `emphasis: 'primary'`).
- **Rail 320/480**: same box full width, padding `--dc-s2`, textarea grows to 4 rows; the
  target line moves into `aria-describedby` and `title`; Send keeps its label.
- **Chip**: `var(--oc-muted-surface)` pill, radius `var(--dc-r)`: tag in `--oc-mono`, element
  text quoted and cut to 40, `where` in `--oc-muted`, a `close` icon button "Remove the
  attached element". Text only via `textContent` (`h()`), never HTML.
- **Counter**: from 10 000 characters, `--oc-muted`; `--oc-error-text` over 12 000.

Copy:
| Where | Text |
|---|---|
| Placeholder, linked | Ask the agent to change something |
| Placeholder, no chat | Ask the agent. This starts a new chat. |
| Target, selected linked chat | Goes to “<chat title>” |
| Target, linked not selected | Goes to the linked chat |
| Target, none | Starts a new chat |
| Viewing a version | Go back to the current design to ask the agent. |
| Over the limit | That's N characters over the limit. Shorten it to send. |
| Sent | Sent to the chat. |
| Composed | The agent is busy, so your message is waiting in the composer. |
| Outbox (rail only; the page closes) | Opening the linked chat to send it. |
| New chat | Started a new chat with your message. |
| Failed | Couldn't send. <service or flow message> Your message is still here. |
| Textarea label | Message to the agent |
| Send button | Send |

States: idle; sending (button loading, textarea `readonly`, not disabled, so focus and text
stay); success (status line 4 s); error (`role="alert"` line until the next edit); offline
service (the send fails with the service-client message; text kept); empty (Send disabled).

Accessibility: Tab order is wall → chip remove → textarea → Send. The status line is
`role="status" aria-live="polite"`; errors use `role="alert"`. The textarea has
`aria-describedby` = target line + key hint ("Enter sends, Shift+Enter adds a line").

### 3.6 Send one pin (item 05)

Shared helper `src/ui/components/send-comments.ts` (new), moving the result reporting out of
`comments-drawer.ts:50-70`:
```ts
export const sendComments: (slug: string, ids: string[], anchorStates: Record<string, AnchorState>) => Promise<void>; // throws a user-facing Error
export const isSending: (id: string) => boolean;
```
Module-level single flight per comment id, so the drawer row and the popover cannot both send
the same comment. Toast copy unchanged from today; for one comment: "Comment 3 sent to the
chat." / "Started a new chat with comment 3."

- **Thread popover** (`src/ui/wall/comment-ui.ts:113`, via S6): for an `open` comment and not
  read-only, a **Send this** button (`btn` outline `sm`, icon `send`) in `.dc-pop-actions`
  before Save. If the body was edited, Send this saves first (`onSave`), then sends. Uses the
  existing `guard` for loading and inline error; the popover closes on success.
- **Drawer row** (`comments-drawer.ts:72-98`): an `iconBtn` `send` `sm` labelled "Send comment
  N to chat", only on `open` rows, beside the resolve toggle; loading via `aria-busy` and
  disabled while sending. On error a toast (rows have no error slot), the comment stays open.
- `anchorStates` is filtered to the sent ids before the call.
- The footer **Send N comments to chat** gets `emphasis: 'primary'` here (this branch already
  rewrites that code; the findability branch does not touch `comments-drawer.ts`).

### 3.7 Edge cases

- **No or deleted session**: `deliver` step 3 starts a linked chat (`flows.ts:274`); no
  project → "Open a project first, then try again." under the bar, text kept.
- **Service restarting / design deleted while typing**: the service-client or `not-found`
  message under the bar, text kept. No automatic retry: an ask is not idempotent.
- **Outbox overwritten**: a second send before the rail delivers the first replaces the one
  outbox slot (window: `openSession` to the rail's `onSession`, under a second). Comments
  survive (never marked sent); an ask text would be lost. Accepted, in Risks.
- **Very long text / 16 k cap**: §3.2; the builder guarantees the cap, a test asserts the
  worst case; pasted line breaks are kept.
- **Element from a design frame**: produced by the bridge in the sandbox, validated by
  `frame-channel`, re-validated by the service with `parseCommentAnchor` (`design-json.ts:131`).
- **Page surface + outbox**: `openSession` closes the page after the text was handed over.

### 3.8 Tests

- `test/agent/ask-prompt.test.ts`: with and without element; page and canvas location; `fill`
  label; user text verbatim (backticks, quotes, newlines); ladder steps; worst case (12 000
  text, 1 000 selector, long Windows folder) ≤ 16 000; over → error with the count.
- `test/agent/chat-routes.test.ts`: `ask` ok with `commentIds: []` and no external scan;
  missing or blank text 400; too long 422 with count; bad screen, viewport or anchor 400.
- `test/guest/flows.test.ts`: `ask` per outcome (selected; busy → append + toast; outbox with
  `commentIds: []`; `NO_SESSION` → `DELETE /outbox` + new chat + PATCH; no session); failure
  marks nothing; one-id `sendComments`; comments' busy path now appends.
- `test/ui/ask-bar-model.test.ts`: `askKeyAction` matrix (Enter, Shift+Enter, Ctrl/⌘+Enter, Esc
  with and without chip, composing); `askSendState` (blank, sending, viewing, limit, counter);
  placeholders, targets, results, `chipLabel`. `comments-versions-model.test.ts`: one-send copy.

### 3.9 Visual harness

`host.html` prompt support is seeded (§0.5). `fake-backend.ts` and `fake-services.ts`: `POST
/designs/:slug/prompt` handles `ask`. `scenarios/ask-bar.mjs`, page 1400 dark and rail 320
light: empty bar, chip, counter, sending, sent, error with text kept, viewing a version
(disabled), popover **Send this**, drawer row send.

### 3.10 Assignment

**fullstack-developer**: `ask-prompt.ts`, `chat.ts`, `comments.ts` export, `flows.ts`, fakes,
agent and guest tests. **ui-ux-developer**: `ask-bar-model.ts`, `ask-bar.ts`,
`feature-ask-bar.ts`, `send-comments.ts`, `comment-ui.ts`, `comments-drawer.ts`, CSS block, UI
tests, the scenario, docs. The UI calls `flows.ask` with the §3.3 signature from day one. One
developer only: fullstack-developer, because the flow refactor and the route are the risk.

## 4. Branch `feat/findability` (item 06)

ui-ux-developer only (all files are `src/ui/**` and `test/ui/**`; the WP0 and service part was
done in §0).

### 4.1 (a) First-run tip in the rail

At the top of the rail list (R1), under the header and above search, until dismissed. Kit
banner (`banner()`, `kit.ts:195`), tone `info`: title "Open Design Chamber full screen", body
"In the sidebar, open Extension pages and pick Design Chamber. Canvases get the whole window
there.", action "Got it" (focus then moves to the search field).

Persistence: `host.storage` `tip:full-screen` = `{ dismissed: true, at: <iso> }`, instance
scope, like `view:<slug>` (`design-view.ts:96`) and `loose-dismissed` (SPEC §13.1). A failed
read resolves `undefined` (`guest.ts:56`) and shows the tip; a failed write hides it for this
session. Not on the full-screen page, in the viewer, or over the list's error state. The
viewer's footer hint (`design-view.ts:35,649`) stays. Pure: `shouldShowTip(stored: unknown)` in
`src/ui/model/findability-model.ts` (only `{ dismissed: true }` hides it).

### 4.2 (b) Comments chip in the rail viewer header

Row one of the compact toolbar becomes: back · title · **Comments chip** · **Versions** · ⋯
(through S8).
- Comments chip: `btn` `xs` outline, icon `comment`, label = open count (icon only at 0),
  `aria-label` "Comments, 3 open" / "Comments", `aria-pressed` while its sheet is open.
- Versions: `iconBtn` `history` `sm`, label "Versions". The ⋯ menu drops both entries
  (`design-view.ts:283-284`). At 320 px the title keeps at least 120 px and ellipsises.
- "Send comments to chat" stays in the Comments sheet footer as its primary action. Pure:
  `commentsChip(count: number): { label: string; aria: string }`.

### 4.3 (c) One filled primary per view

`emphasis: 'primary'` (seeded in §0) on exactly one action per view:
| View | Primary | File (branch) |
|---|---|---|
| Comments drawer/sheet | Send N comments to chat | `comments-drawer.ts` (**ask-bar branch**) |
| New dialog | Start canvas / Start page | `src/ui/components/new-dialog.ts:96` |
| Settings | Apply folder | `src/ui/components/settings-view.ts:210` |
| Wall / page viewer | the ask bar's Send | `ask-bar.ts` (**ask-bar branch**) |
"Continue in chat" in the full-screen toolbar stays `variant: 'default'` (tinted): the ask bar
is the main action there. List and library "New" stay tinted. Disabled primaries keep the kit's
disabled look, so "Apply folder" disabled reads as unavailable.

### 4.4 (d) Restore with Undo instead of a confirm

`confirmRestoreVersion` (`versions-drawer.ts:29-45`) is removed with its only copy helper
`restoreConfirmBody` (`versions-model.ts:54`) and its test. Through S10 the design view
implements `onRestore` once for the drawer rows and the "Viewing v3" bar:

1. The pressed Restore shows loading; every other Restore in the view is disabled.
2. `store.restoreVersion(slug, id)` → `{ restorePoint, restored, before }`, then
   `store.refreshOpenDesign()` and leave version viewing (as `onRestored` does today).
3. Transient notice (S7), success, 10 s, paused on hover/focus: "Restored v3" with body "Your
   previous state is saved as v8." (restore point made) or "Your previous state is v7 in
   Versions." (`restorePoint: null`), action **Undo**. If `before.treeHash ===
   restored.treeHash`: "v3 matches the current design" / "Nothing changed.", no Undo, 5 s.
4. **Undo** → loading → `store.restoreVersion(slug, before.id)` → "Back to v8" / "v3 is still in
   Versions.", 5 s, no Undo of the Undo; focus back to the wall.
5. Restore failure: host error toast "Couldn't restore v3. <message> Nothing was changed."
   (today's sentence, `versions-drawer.ts:38`). Undo failure: error notice "Couldn't undo" /
   "<message> Your earlier state is saved as v8 in Versions." with **Try again**, until
   dismissed or the view closes.

Why `before` (WP0): `restorePoint` is `null` when the files already matched the newest version
(`versions.ts:440-444`); then the pre-restore state is that newest version. The service knows
which one; the guest would have to guess from a list that may change underneath it.

Pure in `findability-model.ts`: `restoreNotice(result: RestoreVersionResponse): { title; body; undoTo: { id: string; n: number } | null }` and `undoneNotice(...)`.

### 4.5 Layout, states, accessibility

- Tip: kit banner; at 320 "Got it" wraps under the text (`styles.css:94`). Chip and Versions:
  26 px controls, focus ring `--dc-ring`. All colours from tokens, light and dark.
- Undo notice: in the existing `aria-live="polite"` notices region (`design-view.ts:407`), so
  it is announced; Undo is a real button right after the toolbar in Tab order.
- Offline service: restore and undo take their error paths; the tip still works.

### 4.6 Edge cases

- Restore while the agent writes: the restore point holds what was on disk; Undo brings it back.
  Agent writes after the restore, then Undo: the service saves them as another restore point
  first (it does whenever the tree changed), so nothing is lost.
- Two quick restores: the second waits (buttons disabled); its notice replaces the first. View
  closed within 10 s: the notice goes; "Before restore" stays in Versions.
- Tip storage holding garbage (`"yes"`, `[]`): shown again; "Got it" overwrites it.

### 4.7 Tests

- `test/ui/findability-model.test.ts`: `shouldShowTip` (undefined, null, garbage, dismissed);
  `commentsChip` (0, 1, 12); `restoreNotice` (restore point present, null restore point,
  identical trees); `undoneNotice`.
- `test/service/render/versions-restore.test.ts` (in §0's commit): `before` is the restore point
  when dirty and the newest version when clean.
- `scenarios/findability.mjs` (tip via `?tip=1`, §0.5): rail 320 dark and 480 light with the
  tip; viewer header chip (0 and 3); restored notice with Undo (page 1400 light, rail 320 dark);
  undo error; New dialog and Settings with the filled primary in both themes.

## 5. Documentation (each branch updates its own lines)

| Branch | Files |
|---|---|
| build-strip | `documentation/pages/full-screen-page.md` (toolbar status, board highlight), `documentation/pages/rail-panel.md` (R2 pill) |
| ask-bar-send-pin | both pages (ask bar; Send this in popover and drawer); `documentation/features/agent-instructions.md` (the ask message shape) |
| findability | `rail-panel.md` (tip, R2 header, ⋯ menu), `full-screen-page.md` and `documentation/features/rendering-versions-export-thumbnails.md` (restore with Undo) |
Screenshots go to `documentation/pages/img/` with the existing naming (`rail-320-dark-…`).

## 6. WP0 interface edits (main agent, §0)

| File | Change |
|---|---|
| `src/shared/api.ts` | `PromptBody.purpose` adds `'ask'`; `PromptBody.text?: string`; `PromptBody.element?: AskElement`; new `export type AskElement = Omit<CreateCommentBody, 'body'>`; `RestoreVersionResponse` adds `before: VersionSummary` (the version holding the state from just before the restore). Additive; old clients ignore `before`. |
| `src/shared/limits.ts` | `ASK_TEXT_MAX = 12_000` with a comment tying it to `HOST_TEXT_MAX`. |
| `types.ts`, `bridge-protocol.ts`, `design-json.ts`, `src/service/{main,http,context}.ts` | none. No change to `design.json`, storage layout or `.versions/`; nothing to migrate. |

## 7. Security and threat model

- **Service surface**: no new route. `POST /designs/:slug/prompt` gains a purpose behind the
  existing bearer check (`http.ts`) and slug containment (`ctx.store.get`, SPEC §9.1). No new
  path is resolved; `ask` writes nothing beyond the existing contained `RULES.md` refresh.
- **Validation**: `text` type and length; `element` via the exported comments parser plus screen
  and viewport membership; anchors re-checked by `parseCommentAnchor`; restore `vid` already
  matches `VERSION_ID_PATTERN` (`versions.ts:426`).
- **Untrusted HTML**: no new iframe. Anchor text and html from agent-written pages reach the chip
  only via `textContent` and the prompt only in quotes and code spans, as data.
- **postMessage**: unchanged; selection data is the bridge `hit` already validated by
  `frame-channel.ts`; S4 is page-internal.
- **Host**: activity is read only; no new capability (`sessions`, `prompt` declared). The bearer
  token never reaches a frame, log, prompt or storage. Storage gains only `tip:full-screen`.
- **Abuse**: a hostile design cannot send an ask (needs a click or key in our frame, outside the
  sandbox) or read it; element text is capped by bridge and service; a flood of files only
  changes the strip's file name, `turnFiles` capped at 50.

## 8. Sandbox and path safety

No change to iframe `sandbox` flags, CSP or the blob/srcdoc feed. No new path resolution: the
one containment function (`src/service/paths.ts`, SPEC §9.1) and its tests are untouched.
`agentFiles` is a display filter, not a security check.

## 9. Data flow

Agent writes `screens/x.html` → service watcher → `GET /changes` batch → store bumps the
render revision (board reloads) and the build watcher marks `writing` and the recent board ·
host `onSessions` → watcher phase → strip · user types in the ask bar (chip from S4) →
`POST /prompt {ask}` → `deliver` → selected chat, outbox + rail, or new linked chat · "Send
this" → `sendComments(slug, [id])` → same path → mark-sent · Restore → `POST restore` → notice
with Undo → `POST restore {before.id}`.

## 10. Failure and recovery

| Call | Fails how | User sees | Way back |
|---|---|---|---|
| `listProjects` / `onSessions` | reject, no project | strip in files-only mode | automatic on next detail or directory change |
| `GET /changes` | service down | `offline` strip after 5 s (if it was showing) | feed backoff 1 to 10 s, `reset` on return |
| `POST /prompt {ask}` | 4xx/5xx/timeout | error under the bar, text and chip kept | edit and send again |
| `prompt` / `startSession` | host error | same | same |
| `mark-sent` after "Send this" | retried once, then `markFailed` toast | "Sent, but the comments could not be marked as sent…" (existing copy) | resolve by hand |
| restore | 4xx/5xx | error toast, nothing changed | press Restore again |
| undo | 4xx/5xx | error notice with Try again | Try again, or Versions |
| `storage.set(tip)` | rejects | tip hides for this session, returns next mount | none needed |

## 11. Not building

- A local "just sent" signal to the strip: couples two branches; activity arrives in a second.
- The agent's question text in the strip: the SDK does not expose it (`API.md:220`).
- An in-guest toast system: the notices region already announces and holds buttons.
- A keyboard shortcut to focus the ask bar: Tab reaches it; add on demand.
- Ask history or drafts saved per design: not asked for (Q4).
- Separate CSS files (§0.3); a Work Status panel version of the strip (another surface).

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A seam is missing and a feature branch edits `design-view.ts` or `wall.ts` anyway, so the three PRs conflict | High | S1 to S10 are the prep branch's acceptance criteria; feature branches touch only their `feature-*.ts`, CSS block, scenario and the files named in their section |
| Outbox slot overwritten by a second send within a second loses an ask text | Low | Documented; a follow-up could queue outboxes |
| Session activity flicker (running/idle) makes the strip blink | Med | `done` linger, phase change only on reducer input, announcements per phase |
| `compose` append changes today's busy behaviour for comments | Low | Q1; covered by flow tests |
| Filled primary contrast in a third-party theme | Low | Uses the theme's own `primary`/`primaryForeground` pair, which the host already pairs |
| `before` missing from an older service build talking to a newer UI | Low | Same package ships both; `before` absent → Undo hidden (guard in `restoreNotice`) |

## 13. Acceptance criteria and gates (all branches)

- **Build strip**: every §2.3 phase reachable in tests and screenshotted (page 1400, rail 320,
  light and dark); the written board highlights then clears; one announcement per change.
- **Ask bar**: Enter sends, Shift+Enter adds a line, Esc removes the chip; a failed send keeps
  text and chip; the element arrives with screen, viewport, selector and text; new chat when
  none or gone; message ≤ 16 000 characters.
- **Send one pin**: one open comment is sent alone and shows Sent; the batch sends the rest.
- **Findability**: tip until "Got it"; rail header Comments chip with count and Versions; one
  filled primary per §4.3 view; restore without a dialog, Undo brings back the earlier state.
- No em dash in any `src/` string (`test/copy-no-em-dash.test.ts`). `npm run check` passes with
  output pasted in each PR; the branch's `shoot.mjs` scenario runs and its images are committed.
