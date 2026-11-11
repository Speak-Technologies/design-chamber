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

### KI-20 — Tweaks: Reset (or Discard) while an artboard is loading can leave the old preview on it
🟣 Minor · found 2026-11-11 · `src/ui/wall/frame-slot.ts:119` · owner: ui-ux-developer
**What:** a frame that starts loading while values are pending gets them in `BridgeInit.tokens`. If the preview is then cleared before that frame reports `ready`, the rAF-coalesced `set-tokens []` from `wall.setTokenPreview` can reach the frame before its bridge listens, and on `ready` the slot re-sends the preview only when it is non-empty (`if (now.length > 0)`). The frame keeps wearing the values the user just reset.
**Who:** end user tuning tweaks on a canvas · **Seen:** visible (one artboard shows the old accent or radius while the panel and the other artboards show the file's values)
**Happens:** the user moves a knob, pans so a new artboard loads (or the agent writes and frames reload), and presses Reset or Discard my tweaks within that frame's load time · rare · **Effect:** that artboard looks tuned until it next reloads; nothing is written, so a reload fixes it
**Why not fixed now:** the window is a frame's load time and nothing reaches the files
**Fix prompt:**
> In `src/ui/wall/frame-slot.ts`, on the bridge's `ready`, send the current preview whenever it differs from what this document was created with: keep the `tokens` array passed to `createFrameDocument` on the slot, and on `ready` send `set-tokens` with `slotTokens(options.slug)` if it is non-empty or if the init carried tokens (sending `vars: []` clears them, §4.4). Add a check to `test/ui/visual/scenarios/tweaks.mjs`: with a value pending, force one board to reload (an agent write through the fake backend), press Reset before it is ready (hold its render with a `delayMs` route), and read that frame's `documentElement.style` through the probe once it is ready: no `--accent-h` inline. Run `npm run check` and `node test/ui/visual/shoot.mjs tweaks --out /tmp/x`.
