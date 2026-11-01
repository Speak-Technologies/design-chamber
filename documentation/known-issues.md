# Design Chamber — Known Issues

Minor issues found in review and accepted for now. Each has a fix prompt: paste it to the
owning agent to fix it. **When an entry is fixed, delete it** in the same commit — this file
lists what is open, git history holds what was closed. Anything serious does not belong here;
it blocks the merge instead. Anything nobody can hit does not belong here either: an entry is
added only if it passes the 🟣 gate (who it reaches, seen or unseen, can it actually happen).

KI-2…KI-5 were fixed in the smoke fix round (2026-10-27); see `documentation/smoke/REPORT.md`.
KI-6 and KI-7 were fixed on 2026-11-01 (kind inferred on take-over; no em dashes in app copy).

### KI-8 — Platform test checklists still say /artifact and "Open as artifact"
🟣 Minor · found 2026-11-01 · `docs/testing/MACOS.md:64`, `docs/testing/FEDORA.md:60` · owner: main agent (docs)
**What:** the manual macOS and Fedora checklists (rows 13–15) tell the tester to type `/artifact a landing page`, use ⋯ → "Open as artifact" and check the "Artifact" viewer. The command is now `/page` and the message action is "Open as page" (`package.json` contributions).
**Who:** the owner (operator) running the manual platform pass, which `AGENTS.md` asks for on macOS-affecting changes · **Seen:** visible: `/artifact` is not a command, so row 13 cannot be followed as written
**Happens:** every manual macOS or Fedora run · common for that person · **Effect:** a confusing failed step, or a false FAIL recorded against a working build
**Why not fixed now:** outside this change's diff; the README (the user-facing doc) is already correct.
**Fix prompt:**
> In `docs/testing/MACOS.md` and `docs/testing/FEDORA.md`, rows 13–15: `/artifact a landing page` → `/page a landing page`; "Artifact viewer" → "Page viewer"; "Open as artifact" → "Open as page"; "the new artifact" → "the new page"; "Artifact Export ▾" → "Page Export ▾". Check `docs/testing/PLATFORMS.md` for the same words. Use no em dashes. Run `grep -n -i artifact docs/testing/*.md` (only references to Claude's own artifacts may remain) and `npm run check`.

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
