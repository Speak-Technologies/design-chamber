# Design Chamber — Known Issues

Minor issues found in review and accepted for now. Each has a fix prompt: paste it to the
owning agent to fix it. **When an entry is fixed, delete it** in the same commit — this file
lists what is open, git history holds what was closed. Anything serious does not belong here;
it blocks the merge instead. Anything nobody can hit does not belong here either: an entry is
added only if it passes the 🟣 gate (who it reaches, seen or unseen, can it actually happen).

KI-2…KI-5 were fixed in the smoke fix round (2026-10-27); see `documentation/smoke/REPORT.md`.
KI-6 and KI-7 were fixed on 2026-11-01 (kind inferred on take-over; no em dashes in app copy).


<!-- entry format:
### KI-1 — short title
🟣 Minor · found YYYY-MM-DD · `path/file.ext:line` · owner: agent-name
**What:** the issue, one or two sentences
**Who:** end user / admin / operator · **Seen:** visible in UI / silent — what it affects
**Happens:** the real action that triggers it · common / edge case / rare · **Effect:** what the person experiences
**Why not fixed now:** reason
**Fix prompt:**
> self-contained prompt for the owning agent: what to change, the test to add, the gates to run
-->

### KI-9 — ZIP export silently leaves out a file it could not read
🟣 Minor · found 2026-11-08 · `src/service/export.ts:96` · owner: fullstack-developer
**What:** the ZIP source reads each file with `readFile(file).catch(() => null)`, and `null` means "vanished, skip it". Every read error is treated that way, not only a missing file, so a file that exists but cannot be read is dropped and the export still reports success. Older than phase 0b (master had the same catch).
**Who:** end user exporting a ZIP · **Seen:** silent until they open the archive and a file is missing
**Happens:** a file in the design is locked by another program on Windows (EBUSY) or has no read permission (EACCES) when Export ZIP is clicked · rare · **Effect:** the toast says the export worked; the ZIP lacks that asset, and the page breaks for whoever receives it
**Why not fixed now:** not introduced by 0b, and rare; logged so it is not lost
**Fix prompt:**
> In `src/service/export.ts` `writeZipExport`, the `read` of each ZIP source should answer `null` only when the file is gone (`ENOENT`, also from the `stat` above it); any other read error should fail the export with a plain sentence naming the file, for example "Design Chamber could not read assets/x.png. Close any program that has it open and export again." (map it to an `ApiError`, and make sure the tmp file is still removed, which `deliver` already does). Add a test in `test/service/render/export.test.ts`: on POSIX (skip on win32 and when running as root), `chmod 000` one asset, export ZIP, expect a rejection naming the file and an empty downloads folder; restore the mode in `t.after`. Mutation-check it by putting the blanket `.catch(() => null)` back. Run `npm run check`.

### KI-11 — Checks: a focused group disclosure loses focus when a group above it goes away
🟣 Minor · found 2026-11-08 · `src/ui/components/checks-badge.ts:40` · owner: ui-ux-developer
**What:** `syncChildren` puts each wanted node in place with `insertBefore` before it removes stale children. When a group above a collapsed one disappears (for example "Needs fixing" empties after the agent fixes the errors), the Notes or "From before your latest changes" `<details>` is moved, and moving a focused node blurs it. Proven in Chrome: with groups `[errors, warnings, notes]` and focus on the Notes summary, syncing to `[warnings, notes]` left `document.activeElement` on `BODY`.
**Who:** keyboard and screen-reader users of the Checks popover or sheet · **Seen:** visible (focus ring gone, screen reader loses its place)
**Happens:** the findings are open with focus on a collapsed group, and a refresh removes a group above it · rare · **Effect:** focus drops out of the dialog; the next Tab brings it back to the first control
**Why not fixed now:** the common refresh paths (a check running, files changing with the same groups) keep focus; this only happens when a whole group above the focused one disappears.
**Fix prompt:**
> In `src/ui/components/checks-badge.ts`, change `syncChildren` to first remove every child of `parent` that is not in `wanted`, then insert the wanted nodes that are out of place. That way a node that keeps its relative order is never moved. Add a visual assertion to `test/ui/visual/scenarios/checks.mjs`: focus the Notes summary on a design whose errors group then empties (add a fake-checks hook that clears the static errors and emits `checks`), and check that focus is still on that summary. Run `npm run check` and `node test/ui/visual/shoot.mjs checks --out /tmp/x`.

### KI-12 — Turn events: a design linked in the last moment of a turn gets no turn version from the event
🟣 Minor · found 2026-11-10 · `src/service/turn-events.ts:111` · owner: fullstack-developer
**What:** with a loaded index, the worker trusts `index.bySession(id)`. The index refreshes `WATCH_DEBOUNCE_MS` + `DESIGN_INDEX_REFRESH_MS` (about 0.6 s, plus the list) after a `design.json` change, so a design whose `sessionId` was written moments before `turn-finished` arrives is not yet in it, and the event takes no snapshot. Reproduced on the composed service: a `turn-finished` posted right after `store.create({ sessionId })` gave 0 turn versions; the same event after the index caught up (305 ms) gave 1.
**Who:** end user restoring from the Versions drawer · **Seen:** visible there: the turn that created or linked the design has no "After agent turn" version (a quiet-period "Auto-saved" one follows)
**Happens:** the agent creates or links a design as its very last action and the turn ends within about a second, with no Design Chamber window open · rare · **Effect:** one turn version missing; the auto version still holds the files, so nothing is lost
**Why not fixed now:** rare, covered by the quiet-period auto version, and only for the turn that first links the design.
**Fix prompt:**
> In `src/service/design-index.ts`, add `settled(timeoutMs): Promise<void>` that resolves once no refresh is scheduled or in flight (or the timeout passes). In `src/service/turn-events.ts` `handle`, for `turn-finished`/`turn-failed` with a loaded index, `await index.settled(...)` (bounded by a new `limits.ts` constant, about 1 500 ms, through the main agent since `limits.ts` is a WP0 file) before `bySession`. Keep the "no disk read for an unknown session" rule: `settled` only waits for a refresh already triggered by a change. Add a test in `test/service/integration/turn-events-composed.test.ts`: remove the index wait before the post and expect one turn version. Mutation-check by skipping the `settled` call. Run `npm run check`.

### KI-13 — Rail reconciliation can link a new design to an old chat that carried a deleted design's chip
🟣 Minor · found 2026-11-10 · `src/guest/flows.ts:87` (`planReconciliation`) · owner: fullstack-developer
**What:** reconciliation matches a chat to a design by the chip id `design:<slug>` alone. A chip stays on its chat for good and a deleted design's slug is free again, so an old chat still carrying `design:tea` counts as the chat of a new, unrelated `tea`. The service-side linker (`src/service/session-links.ts`) checks the design's created-time marker since `c8f3c26`; the rail path does not. Present since the initial commit (`d3f31fe`).
**Who:** end user working in a project · **Seen:** visible: Continue in chat, Send comments and the ask bar go to the old chat
**Happens:** the user deletes a design, makes a new one with the same title from another chat in the same project, and the rail or page gets a sessions snapshot before the new chat's first message lands (or while the old chat is newer by `updatedAt`) · edge case · **Effect:** the new design is linked to the old chat and stays there, because a link to a chat that still exists is never repaired
**Why not fixed now:** not introduced by the session-links change, and the trigger is an edge case; logged so the rail path gets the same check as the service
**Fix prompt:**
> In `src/shared/agent/chip.ts` `buildChip`, add the design's marker to the chip data: `data: { slug, kind, created: chipMarkerOf(input.created) }` (the host passes `data` back in `GuestSessionsSnapshot` `sessions[].items[].data`). In `src/guest/flows.ts` `planReconciliation`, pass each design's `created` in `DesignLink`, read `item.data.created` (a string from untrusted data: check its type) and count a chat for a design only when the marker equals `chipMarkerOf(design.created)`; an item with no marker counts for nothing, as in `session-links.ts`. Keep the "never move a link to a chat that still exists" rule. Add a test in `test/guest/` with two sessions in one snapshot: an old chat carrying `design:tea` with the old design's marker, a new one with the new marker, and the new `tea` stub; expect the link to the new chat only. Run `npm run check`.

### KI-17 — Checks: text parked where no scrolling reaches still gets a contrast warning
🟣 Minor · found 2026-11-11 · `src/guest/probe/probe.ts:185` (`clippingOf`), `:284` (`visuallyHidden`) · owner: fullstack-developer
**What:** a box scrolls only towards its bottom and right edges (its end edges in right-to-left or `column-reverse` layouts), but `clippingOf` marks an `auto`/`scroll` axis as scrolling whenever there is content past its far edge, so text sticking out of the start edge (above or to the left) counts as reachable. The page has the same gap: the root never cuts, so the off-screen idiom `position:absolute; left:-9999px` is never hidden. Proven in Chrome: a skip link with `top:-60px` inside a scrolling list, and a body-level link at `left:-9999px`, both get `hidden: false` and a contrast finding. The probe before 9d250e5 gave the same result, so this is not a regression of the C1 rounds.
**Who:** end user reading the Checks badge (and the agent it asks to fix things) · **Seen:** visible: a contrast warning for text nobody can see
**Happens:** a design hides a skip link or label by moving it off screen with a negative offset instead of the 1×1 `sr-only` pattern, and gives it a low-contrast colour · edge case · **Effect:** a false contrast warning; "Ask the agent to fix" sends it to the chat
**Why not fixed now:** older than C1, and it needs low-contrast text in the off-screen idiom; the usual `sr-only` pattern is already hidden.
**Fix prompt:**
> In `src/guest/probe/probe.ts`, treat overflow past a box's scroll-start edge as unreachable: in `paintedText`, before spreading `reach` over a scroll box, cut lines that lie wholly before the box's start edge on the scrolling axis (top and left in a left-to-right, top-to-bottom box; use the computed `direction` and `flex-direction: *-reverse` to find the start edge). Do the same for the document: text whose lines all sit at negative document coordinates (`x + w <= 0` or `y + h <= 0`) is hidden. Keep "scrolling never hides text" for content past the end edge. Add real-Chrome cases to `test/service/check/overlap-scroll-qa3.e2e.test.ts`: the skip link above a scrolling list and the `left:-9999px` link get no contrast finding, while a `column-reverse` chat's older messages still do. Mutation-check by removing the start-edge cut. Run `npm run check`.

### KI-18 — Build strip: a quick second hand edit or Undo can show the user's own writes as the agent's
🟣 Minor · found 2026-11-11 · `src/service/edits/pipeline.ts:341` (`casWrite` records before the rename), `src/service/watch.ts:336-337` (`dropEchoes` forgets on a miss) · owner: fullstack-developer
**What:** `casWrite` records the new bytes in the self-write registry before `replaceFileIfHashUnchanged` renames them in. If the watcher's flush for the previous hand edit runs `isEcho` inside that record→rename gap, the file still holds the previous edit's bytes, so `isEcho` answers false and the watcher calls `forget`. The previous edit's event is then emitted without `origin`, and when the new rename lands its event is not an echo either (the entry is gone). Reproduced against `createSelfWrites` directly: both `isEcho` calls answer false. The gap is widened by the busy-retry pauses when Windows holds the file just after a rename.
**Who:** end user · **Seen:** visible: the build strip shows "Writing index.html" and counts the file in "Done. Updated N files" for their own edit, against E10
**Happens:** a hand edit and then, within the 250 ms debounce plus the flush, a second write to the same file: most likely Enter then Ctrl/⌘+Z right away, or a rail and a page edit at once · rare · **Effect:** a brief, wrong "the agent is writing" signal; nothing is written wrongly
**Why not fixed now:** cosmetic and timing-bound; the backend QA flagged the gap and the UI side is otherwise correct
**Fix prompt:**
> In `src/service/self-writes.ts`, keep the previous entry for a `(slug, rel)` while a newer write is pending: let `record` hold a small list (the last settled bytes plus the pending ones) and have `isEcho` answer true when the file matches any of them; `casWrite` (`src/service/edits/pipeline.ts:340`) marks the pending entry settled after `replaced` and drops it on `changed`/`conflict` instead of calling `forget` on the whole key. The watcher's `forget` on a miss must not drop a pending entry. Add a test in `test/service/core/self-writes.test.ts`: record A, file A, record B (pending), `isEcho` true (A), then file B, `isEcho` true; and one in `test/service/core/watch-echo.test.ts` with a flush between record and rename. Mutation-check by restoring the old `forget`. Run `npm run check`.

### KI-19 — Edit text: SVG text and other inert text gets the "made by the page's script" reason
🟣 Minor · found 2026-11-11 · `src/shared/source-edit.ts:496` (inert and foreign elements skipped), `src/ui/model/edit-text-model.ts:15` (no `inert` reason) · owner: fullstack-developer
**What:** the technical design (§3.3, §3.6) gives text in SVG `<text>`, `<template>`, `<title>` and similar its own `inert` reason, "Ask the agent to change it.". The locator skips foreign and inert elements, so nothing matches and the toolbar says `not-in-source`: "This text is made by the page's script. Ask the agent to change it."
**Who:** end user · **Seen:** visible: a wrong reason under **Edit text**
**Happens:** double-click a label inside an inline SVG (a chart axis, a logo wordmark) in Edit mode · edge case · **Effect:** the sentence blames a script that does not exist; the way forward (ask the agent) is still right
**Why not fixed now:** the way forward is the same; copy-level
**Fix prompt:**
> In `src/shared/source-edit.ts` `locateTextTarget`, remember when a candidate with the right tag and text was skipped only because it is `foreign` or `inert`, and answer `{ reason: 'inert' }` when no other match exists. Add `'inert'` to `EditReason` and `REASON_TEXT` in `src/ui/model/edit-text-model.ts` with the §3.3 sentence "Ask the agent to change it." and to `ASK_AGENT_REASONS`. Tests: `test/shared/source-edit.test.ts` (SVG `<text>Q3</text>` and `<template><p>x</p></template>` answer `inert`, a script-made text still `not-in-source`) and `test/ui/edit-text-model.test.ts` (the sentence). Run `npm run check`.


### KI-20 — Restore: the letter-case rule follows the OS, not the drive the designs folder is on
🟣 Minor · found 2026-11-13 · `src/service/versions.ts:767` (`foldsCase()` from `process.platform`) · owner: fullstack-developer
**What:** `relsToRemoveOnRestore` folds case when the OS is Windows or macOS, not when the designs folder's drive ignores case. On Linux with the designs folder on an exFAT, NTFS or FAT drive (case-insensitive), a restore writes `assets/Logo.png` over the current `assets/logo.png` (the same file there) and then deletes `assets/logo.png`, which removes the file it just restored. The opposite case (a case-sensitive APFS volume on macOS) leaves an extra re-cased file behind instead of removing it.
**Who:** end user on Linux whose designs folder is on a USB or shared Windows drive · **Seen:** visible: an image or stylesheet is missing from the design after a restore
**Happens:** the agent re-saved an asset under a name that differs only in letter case since the version, then the user restores that version · rare · **Effect:** a broken image in the restored design; restoring the same version again puts it back (nothing is lost from the version store)
**Why not fixed now:** older than this diff (before 859c051 the delete never folded case on any OS) and needs an unusual drive setup
**Fix prompt:**
> In `src/service/versions.ts` restore, decide `caseFolds` from the design folder itself rather than `foldsCase()`: probe once per restore (for example `stat` the design folder path with its last segment's letter case swapped and compare `ino`/`dev` with the real folder, falling back to `foldsCase()` when the name has no letters or the probe errors). Pass that to `relsToRemoveOnRestore`. Make the probe a small named function in `src/service/paths.ts` with an injectable `stat` so it is unit-testable on Linux (fake a case-insensitive answer). Add a versions test using the fake that proves the re-cased file survives a restore on a "case-insensitive" Linux folder; mutation-check by forcing the probe to `false`. Run `npm run check`.

### KI-27 — The sheet's incomplete-contract line can say a file is missing when it is there
🟣 Minor · found 2026-11-22 · `src/ui/model/new-system-model.ts:252` (`contractProblemLine`), `src/service/systems/extract.ts:388` (`contractVerdict`) · owner: ui-ux-developer
**What:** the service answers the gap `tokens.css` both when the file is absent and when it is present but holds no custom property, and `system.json` when the read lost the file between the walk and the read. The sheet maps every gap to "<name> is missing" inside "This folder has a system.json but …", so a folder whose tokens.css has no token values reads "tokens.css is missing" while the file sits there, and the rare race reads "This folder has a system.json but system.json is missing".
**Who:** end user starting a system from an existing folder · **Seen:** visible: a wrong clause in the line above Make
**Happens:** the chosen folder holds system.json and a tokens.css with no custom properties (only plain rules or comments), or the file is deleted mid-scan · edge case · **Effect:** the sentence contradicts what the user sees in their folder; the way forward (Make a new system from it) is still right
**Why not fixed now:** copy-level, the action it offers is correct, and the common gap (tokens.css truly absent) reads true
**Fix prompt:**
> In `src/ui/model/new-system-model.ts` `contractProblemLine`, word the file clauses so they cover both gaps: `tokens.css` → "tokens.css is missing or holds no token values", `system.json` → "system.json is missing or can't be read" (keep the standalone sentences like "system.json can't be read" as they are, and keep the project-root line). Update the pinned sentences in `test/ui/new-system-model.test.ts` ("an incomplete contract says what is missing and offers Make instead") and the visual assertion in `test/ui/visual/scenarios/existing-system.mjs` (the style-guide read). If the service should name the two gaps apart instead, that is a `CONTRACT_MISSING` widening in `src/service/systems/extract.ts` through the main agent (WP0-adjacent); the model-only wording fix needs no contract change. Run `npm run check` and `node test/ui/visual/shoot.mjs existing-system --out /tmp/x`.

### KI-28 — The sheet: typing a new location after a read leaves Register acting on the old folder
🟣 Minor · found 2026-11-22 · `src/ui/systems/new-system-sheet.ts:464` (the location field's `onChange`), `:147` (`registering`) · owner: ui-ux-developer
**What:** editing "Where does it live?" after a completed location scan updates the field text but never invalidates the read: `location` stays `done` with the old path and contract, so the footer keeps "Register design system" (or Make) and submits the old scan while the field shows a different folder. The read column still names the old folder ("In design-system/"), which is the only clue. The project-code path has the same shape, but Register is new and acts on a repo folder as it is.
**Who:** end user registering or making a system from an existing folder · **Seen:** visible: the field and the action disagree; the read column names the folder that will actually be used
**Happens:** read a folder, change the path in the field, press the footer button without pressing Read this folder again · edge case · **Effect:** the system is registered (or made) from the previously read folder, not the typed one; recoverable (delete the system), and Register writes nothing to the repo
**Why not fixed now:** the read column shows what will happen, the service re-validates the scanned folder, and nothing is lost; the fix is a small state rule
**Fix prompt:**
> In `src/ui/systems/new-system-sheet.ts`, when the location field's `onChange` text (trimmed) differs from a `done` or `failed` `location.path`, reset `location` to `{ state: 'idle' }` (keep the typed text and the candidate tick sync), cancel any running location scan only when the text diverges from its path, and reset `choice` to 'make'; then `paintExisting()` so the footer, the read column and `draftProblems` ("Pick where the system lives, or type its folder.") follow the field. Keep every refusal's sentence and typed input (a failed scan's message stays until the text changes). Add a visual step to `test/ui/visual/scenarios/existing-system.mjs`: after the complete read, type a different path and check the primary reads "Make design system", the register choice is gone and the read column says the folder has not been read; press Read this folder and check the register choice returns for the new path. Run `npm run check` and `node test/ui/visual/shoot.mjs existing-system --out /tmp/x`.
