# Screens and directions: reorder, duplicate, trash, keep one

**What it does:** Lets the user shape a canvas's screen list by hand: put screens in a new order, copy a screen, move a screen to the trash, and keep one of several directions the agent made for a screen. Each one is a hand edit, so it follows every rule in `edit-on-canvas.md`: a version first, refused when something changed, Undo for 30 minutes.

Why it exists: these are mechanical changes. Waiting a chat turn for "put Checkout before Pricing" is slow, and the agent may get the list wrong. The agent still owns the list: its next write of `design.json` wins.

Status: the service side is built (T4). The menus, drag, the "+ Screen" ghost board and the direction row on the wall (U3, U4) are not built yet, so these edits are reachable only through the service route for now.

## Who owns the screen list
- The list (`screens` in `design.json`) belongs to the agent. Design Chamber writes it only when the user acts, and never copies it into its own state file, so nothing restores an old list over the agent's.
- Design Chamber changes only the list. Every other field, key order and unknown key stays. Entries the wall does not show (a bad id, a wrong file, a second entry with the same id) stay where they were, and every key on an entry travels with it, direction marks included.
- Comments are always merged back in on the same write. If the agent rewrote `design.json` without them, a screen action puts them back.
- A canvas with no `design.json` yet (the agent is still writing) is refused: "This design has no design.json yet, so its screens can't be changed here." A `design.json` that does not parse: "design.json can't be read right now. Ask the agent to fix it." A `screens` value that is not a list: "The screen list in design.json can't be read. Ask the agent to fix it." A page has no screens to change.

## Refused when the list changed
Every action carries a stamp of the list as the wall showed it (a hash of the raw `screens` value, so even entries the wall hides count). If the agent changed the list meanwhile, nothing is changed: "The screen list changed while you were working. Nothing was changed." The stamp is checked again at the moment of the write. If the agent rewrote another part of `design.json` but left the list alone, the action is applied to the agent's new file instead. If `design.json` keeps changing or stays locked through five tries, the answer is "Another program is using this file. Close it and try again." and nothing is written.

Screen files are checked the same way: the size and time the wall showed must still match. A screen the wall showed as not written yet must still be missing. A screen file that is a link is refused with the link sentence.

## The four actions
**Reorder.** The new order must name every listed screen once. Only the listed entries move; everything else keeps its place. Asking for the order it already has is refused ("The screens are already in that order, so nothing was changed."). The notice says what moved: "Moved Checkout above Pricing", "Moved Checkout to the end", or "Screens reordered" when several moved. Links between screens keep working because no id or file changes.

**Duplicate.** Copies the screen's file byte for byte to a free id right after the original: `<id>-copy`, then `<id>-copy-2`, `-3` and so on. Free means no listed screen, no entry in the list and no file in `screens/` uses it. A long id is shortened so the copy still fits the 41-character id rule. The copy's title is "<Title> copy", it keeps the original's viewports and description, and it carries no direction mark. A copy is never written over an existing file. A canvas holds up to 40 screens; the 41st is refused with "A canvas holds up to 40 screens." Comments stay on the original. Notice: "Duplicated Home". Undo moves the copy to the trash (never a hard delete) and puts the list back.

**Move to trash.** Moves the screen's file to `<Designs>/.trash/<design>.<screen>-<time>.html` (a taken name moves on to `-2`, `-3`) and takes the entry off the list. Any other entry with the same id goes too, so a hidden duplicate cannot come back as the screen. A screen not written yet only leaves the list. The last screen may go. Comments are not touched; they show under the screen with "Screen removed". Notice: "Moved Pricing to trash". Undo moves the file back (only if nothing took its name) and puts the list back.

**Keep this one (directions).** The agent marks screens as directions of another screen (`"direction": { "of": "home", "letter": "B", "name": "Editorial" }`). Keeping one:
1. saves a version called "Before keeping a direction" first, always its own version, never shared with earlier quick edits;
2. moves every other direction's file to the trash;
3. when a direction is kept (not Current), moves the original's file to the trash and moves the kept direction's file into the original's place, unchanged, so the screen keeps its id, title, place in the list and the links other screens make to it;
4. removes the directions from the list (the marks go with them);
5. moves the comments on the kept direction to the original screen. Comments on the other directions stay with their screen ("Screen removed"); comments already on the original stay on it.

Every file of the group is checked first: a direction written since the wall loaded is refused as a changed list, and a direction not written yet cannot be kept ("This direction isn't written yet, so it can't be kept."). Notice: "Kept B for Home" with "The others are in the trash.", or "Kept the current Home" with "The directions are in the trash." Undo puts every file back, the list back, and moves back exactly the comments the keep moved, even after a restart of the service.

## When a step fails half way
Duplicate, trash and keep touch several files. All checks run before the first change. If a later step fails (the list write gave up, the disk refused), the steps already done are undone in reverse, and the user reads that step's own sentence when the list or a file had changed, or "Something went wrong, so nothing was changed." If even the undo fails, the user is told to restore the version taken first.

## What the agent is told
Each action adds one entry to the hand-edit record: the move (or the new order), the copy and its file, the trashed screen and its file, or the kept direction's letter and name. Titles are quoted as one line, 80 characters at most.

## Where it lives
- `src/shared/screen-ops.ts`: the pure list planning (listed entries, reorder, free copy ids, the copy entry, removal, describing a move) and the sentences.
- `src/service/edits/ops-screens.ts`: the four ops: reads, stamp and file checks, the steps.
- `src/service/store.ts`: `writeScreens` (the stamp-checked list write, sharing the design.json retry loop with the mirror) and `moveComments`.
- Tests: `test/shared/screen-ops.test.ts`, `test/service/core/edits-screens.test.ts`.
- Spec: `documentation/specs/phase-2-technical.md` §5.1, §5.2, §6.2; requirements `documentation/specs/phase-2-edit-on-canvas.md` §5, §6.
