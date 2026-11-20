# Design system re-sync

How the local service brings a design system's token values up to date with the project code it was
made from. The user starts it from the system page (⋯ → Re-sync from code), looks at a review, ticks
what to take, and applies. This page describes the rules the service enforces; the review sheet is
built separately. It covers systems kept in the Designs folder. A system kept in a project's repo has
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
