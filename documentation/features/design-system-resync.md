# Design system re-sync

How the local service brings a design system's token values up to date with the project code it was
made from. The user starts it from the system page (⋯ → Re-sync from code), looks at a review, ticks
what to take, and applies. This page describes the rules the service enforces and, at the end, the sheet the user sees. It covers systems kept in the Designs folder. A system kept in a project's repo has
its own re-sync, which reads the repo as a whole and is not built yet.

## The review
The page starts a code scan of the project folder with the system's id (the same bounded, read-only
scan that makes a system from code). When it is done, the scan answers a review of five lists, built
from what Design Chamber recorded about each token when it last read the code (its provenance):

| List | What is in it | Ticked at first |
|---|---|---|
| Changed | Tokens from the code whose value here is still the code's old value, and whose code value changed (old → new, light and dark) | yes |
| Conflicts | Tokens from the code that someone changed here, and whose code value also changed: "You changed this here. The code now says …" | no (Keep mine) |
| New | Tokens the code has that the system does not | yes |
| No longer in the code | Tokens from the code whose file was read this time and no longer sets them | no |
| New font or logo files | Files the scan found that the system does not have | no |

Tokens the agent or the user added (no provenance) are never in any list, so they can never be offered
for removal. When the scan hit its limits and did not read a file, the tokens recorded from that file are
not listed as removed. Nothing in any list means "Acme already matches shop." and there is nothing to apply.

## Apply
The page sends the scan id, the stamp it read with the system (the hashes of `tokens.css` and
`system.json`), and the ticked names and file paths. It never sends a value: every value comes from the
scan's memory in the service.

| Rule | What happens |
|---|---|
| Only what was reviewed | Every ticked name must be in its list as the service rebuilds the review now. Anything else (an agent's token to remove, a name from another list) refuses the whole apply. |
| Refused when changed | When the agent or another window changed `tokens.css` or `system.json` after the scan: "Acme changed after the scan, so nothing was changed. Scan again." Nothing is written and no version is taken. |
| This system, this folder | A scan made for another system answers "That scan was made for another design system. Scan again."; one that expired (10 minutes) "That scan is no longer available. Scan the folder again."; a Designs folder change "Your Designs folder changed. Nothing was changed." |
| Version first | Before anything is written the system is kept as a version "Before re-sync". It is always its own version. |
| Values only | Changed and "Use the code's" set the code's value; New adds the token in the modes the code has, with a section and colour group in `system.json`; a ticked removal takes the token out of both modes and its metadata. The overview, notes, token notes, other metadata, fonts and existing assets stay as they are. |
| New files | Ticked fonts and logos are read from the project (inside the scanned folder, never through a link), checked like an upload, copied into `assets/fonts/` or `assets/logos/` under a safe name, and listed in `system.json`. |
| What it remembers | The provenance of each applied token is updated, removed tokens lose theirs, and the source line becomes this scan ("Synced with shop just now"). Tokens left unticked keep their old record, so they are offered again next time. |
| Revision | The system's revision moves on, and the changed sections read Not reviewed (a re-sync is not the user's own hand edit). Designs keep their copies; they are offered the update. |
| Undo | The notice "Re-synced Acme: 5 changed, 2 added, 1 removed." offers Undo for 30 minutes. Undo puts back the exact old bytes of both files, moves copied files to the trash and restores the provenance and source line. If a file changed again since, Undo is refused and "Before re-sync" is the way back. A re-sync too large to undo here says "Restore 'Before re-sync' from Versions to undo." |

A re-sync adds nothing to the agent's hand-edit list. The page can offer **Ask the agent to update notes**
afterwards.

## Route
`POST /systems/:id/resync` behind the service token, with the system id checked before any path is built.
The body is `{ scanId, stamp, changes, add, remove, useCode, assets }`; a malformed body or nothing ticked
answers 400 before anything is read.

## The Re-sync sheet (what the user sees)
Code: `src/ui/systems/resync-sheet.ts` (the sheet), `src/ui/model/resync-model.ts` (the pure rules, tested in
`test/ui/resync-model.test.ts`), the menu entry in `src/ui/systems/system-page.ts`. Pictures:
`documentation/pages/img/resync-page-*`.

- **Where it starts.** ⋯ → **Re-sync from code** on the full-screen system page, only for a system kept in Design
  Chamber that has a code source. The rail never offers it. The entry is off, with a reason, while a version is
  being viewed or there are unsaved edits.
- **Scanning.** The sheet opens at once, reads the folder the system was made from and shows "Reading shop…" with
  Cancel. Closing the sheet cancels the scan. Nothing is written until Apply.
- **Review.** A fixed order: Changed, Conflicts, New, No longer in the code, New fonts and logos. Empty groups are
  left out. Changed rows show old → new with colour swatches (light and dark on two lines). Conflicts show
  "You changed this here. The code now says #4a5755." with **Keep mine** (the default) and **Use the code's**.
  Changed and New start ticked; removals and files start unticked. Each group has a Tick all / Untick all button,
  and long groups show 60 rows and then "Show N more". Agent tokens are never listed. A line says notes, overview,
  fonts and assets stay as they are, and a partial scan adds "Some files weren't scanned, so tokens from them aren't
  listed as removed."
- **Apply.** The footer says what Apply will do ("Apply saves 5 changed, 2 added, 1 removed."), or "Tick at least
  one change to apply." with Apply off. Apply is the filled primary; **Not now** closes without changing anything.
  On success the sheet closes and a notice (5 minutes on the page) says "Re-synced Acme: 5 changed, 2 added, 1
  removed." with **Undo** and **Ask the agent to update notes**. The agent request carries the id of the "Before
  re-sync" version so it can read what changed. A re-sync that can't be undone here says to restore "Before
  re-sync" from Versions.
- **When it stops.** Each stop has its own sentence and the ticks are kept when the failure is not about the scan:
  the system changed after the scan (**Scan again**), the folder can't be read (**Choose another folder…** with a
  path box), the Designs folder changed (sheet says so and closes on Close), anything else is shown as the service
  said it and Apply stays available. Nothing to apply says "Acme already matches shop." with no Apply.
- **Source line.** Under the system name: "In Design Chamber · Synced with shop 3 days ago".
- **Stamp.** The page reads the system once when the scan starts and sends its stamp with Apply; the service
  refuses the apply if the files moved on in between.
- **Repo systems.** A review of the other kind (`kind: 'repo'`) is handed to `options.repoReview`, the seam for the
  repo sheet. Until that exists the sheet tells the user to ask the agent.
