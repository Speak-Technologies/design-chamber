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

### KI-8 — The build strip says "Writing" when you save a design file yourself
🟣 Minor · found 2026-11-08 · `src/guest/build-activity.ts:190` · owner: fullstack-developer
**What:** with a linked chat that is idle and no turn seen in this frame, any file saved into the design (by the user in their editor, or another tool) shows "Writing screens/x.html" with the busy dot for 15 s. After a turn this frame watched, the same save is correctly silent, so the strip is inconsistent.
**Who:** end user · **Seen:** visible in UI, the pill over the wall
**Happens:** the user opens a design and hand-edits a screen in their editor while the chat is idle · edge case real users will hit · **Effect:** the strip says something is being written by the agent when the chat is idle; it clears after 15 s
**Why not fixed now:** cosmetic and short-lived; the spec defines "writing" from files alone
**Fix prompt:**
> In `src/guest/build-activity.ts` `phaseOf`, when the linked session is known (`activity` is not `none`/`gone`/`unknown`) and is `idle`, do not show `writing` (files still count toward the turn). Keep files-only mode unchanged. Add a test in `test/guest/build-activity.test.ts`: idle session, no turn seen, a file lands → `hidden`; files-only, a file lands → `writing`. Run `npm run check`.

### KI-9 — ZIP export silently leaves out a file it could not read
🟣 Minor · found 2026-11-08 · `src/service/export.ts:96` · owner: fullstack-developer
**What:** the ZIP source reads each file with `readFile(file).catch(() => null)`, and `null` means "vanished, skip it". Every read error is treated that way, not only a missing file, so a file that exists but cannot be read is dropped and the export still reports success. Older than phase 0b (master had the same catch).
**Who:** end user exporting a ZIP · **Seen:** silent until they open the archive and a file is missing
**Happens:** a file in the design is locked by another program on Windows (EBUSY) or has no read permission (EACCES) when Export ZIP is clicked · rare · **Effect:** the toast says the export worked; the ZIP lacks that asset, and the page breaks for whoever receives it
**Why not fixed now:** not introduced by 0b, and rare; logged so it is not lost
**Fix prompt:**
> In `src/service/export.ts` `writeZipExport`, the `read` of each ZIP source should answer `null` only when the file is gone (`ENOENT`, also from the `stat` above it); any other read error should fail the export with a plain sentence naming the file, for example "Design Chamber could not read assets/x.png. Close any program that has it open and export again." (map it to an `ApiError`, and make sure the tmp file is still removed, which `deliver` already does). Add a test in `test/service/render/export.test.ts`: on POSIX (skip on win32 and when running as root), `chmod 000` one asset, export ZIP, expect a rejection naming the file and an empty downloads folder; restore the mode in `t.after`. Mutation-check it by putting the blanket `.catch(() => null)` back. Run `npm run check`.

### KI-10 — Service temp files `<file>.<hex>.tmp` from a version restore are reported by the watcher as design files
🟣 Minor · found 2026-11-08 · `src/service/versions.ts` (`writeAtomic`), `src/service/watch.ts:241` · owner: fullstack-developer
**What:** a version restore writes each file through a temp name like `index.html.2bba59ef828e.tmp` (no leading dot), so the watcher's dot filter lets it through and the change feed reports it in a `files` event, e.g. `["design.json.ec0f4e9c44da.tmp","index.html","index.html.2bba59ef828e.tmp"]`.
**Who:** end user · **Seen:** silent in the service; the build strip hides it with a guest-side filter (any `*.tmp`, and a quiet window after a restore), other consumers of `files` events would see the names
**Happens:** every restore of a version · common · **Effect:** nothing visible today; any new reader of file events treats service temp files as design files
**Why not fixed now:** the guest filters it; `versions.ts` and `watch.ts` are being rewritten on other branches, so the fix waits for the merge
**Fix prompt:**
> In `src/service/watch.ts`, ignore `*.tmp` names that match the store's atomic-write pattern (`<name>.<12 hex>.tmp`) the same way dot-prefixed temp files are ignored, or have `writeAtomic` in `src/service/versions.ts` name its temp files with a leading dot. Add a test in `test/service/core/restore-not-agent-write.test.ts`: after `versions.restore`, no event's `files` list holds a `.tmp` name. Then the `.tmp` filter in `agentFiles` (`src/guest/build-activity.ts`) can stay as a harmless guard. Run `npm run check`.
