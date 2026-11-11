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

### KI-14 — Checks: the overlap verdict slows down sharply on long, wrapping text
🟣 Minor · found 2026-11-11 · `src/service/check/analyze.ts:241` (`linesOverlap`) · owner: fullstack-developer
**What:** since C1 the overlap verdict compares every line box of one text with every line box of every other text, with no cheap test first. The work grows with texts² × lines², and it runs synchronously in the service (`render.ts:244`). Measured on synthetic probe answers with no overlaps: 2000 texts × 1 line 30 ms, × 10 lines 0.9 s, × 30 lines 7.6 s, 1000 texts × 100 lines 21 s, per artboard.
**Who:** end user who runs Check rendering on a very long page · **Seen:** visible: the rail and page wait on the service while the artboard is analysed
**Happens:** a long document-style design near the 2000-text cap whose paragraphs wrap over many lines (worse at the phone viewport) · rare · **Effect:** the check takes seconds longer per artboard and other Design Chamber requests stall meanwhile
**Why not fixed now:** ordinary designs (a few hundred texts, a few lines each) stay in the low milliseconds
**Fix prompt:**
> In `src/service/check/analyze.ts` `overlapFindings`, skip a pair before `linesOverlap` when the two merged `rect`s do not intersect (the union always holds every line box, so this never drops a real overlap); optionally sort the boxes by `rect.y` and stop the inner loop once `b.rect.y` passes `a.rect.y + a.rect.h`. Add a unit test in `test/service/check/overlap.test.ts` that builds 2000 non-overlapping texts × 30 line boxes and asserts `analyzeProbe` finishes under 500 ms, plus a test that a real line-pair overlap inside intersecting rects is still found. Mutation-check by removing the pre-test (the timing test goes red). Run `npm run check`.
