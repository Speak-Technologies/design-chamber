# Screens and directions: reorder, duplicate, trash, keep one

**What it does:** Lets the user shape a canvas's screen list by hand: put screens in a new order, copy a screen, move a screen to the trash, and keep one of several directions the agent made for a screen. Each one is a hand edit, so it follows every rule in `edit-on-canvas.md`: a version first, refused when something changed, Undo for 30 minutes.

Why it exists: these are mechanical changes. Waiting a chat turn for "put Checkout before Pricing" is slow, and the agent may get the list wrong. The agent still owns the list: its next write of `design.json` wins.

Status: built end to end: the service side (T4), the wall's screen controls (U3: the screen menu, drag reorder, the "+ Screen" board) and the direction row with **Keep this one** (U4).

## On the wall (what the user sees)
Canvas only (a page has no screens). Same on the [full-screen page](../pages/full-screen-page.md) and in the [rail](../pages/rail-panel.md); drag is the one difference.

**The ⋯ menu.** Edit mode puts a ⋯ button at the end of the first label of every screen row (one per row, not per device size; "Actions for screen Pricing"). Play mode hides it. Entries, text only: **Duplicate**, **Move up**, **Move down**, **Move to trash**, a divider, **Try 3 directions…**. An entry that cannot run says why in a second, muted line inside the entry, so nobody has to guess:
- Move up on the first screen: "This is the first screen."; Move down on the last: "This is the last screen."
- Duplicate on a screen the agent has not written yet: "Nothing to copy until the agent writes this screen."
- An old version on show: every entry, "You're viewing an old version."
- No `design.json` yet, one that does not parse, or a `screens` value that is not a list: every entry, with the sentence from "Who owns the screen list" below.
- At 40 screens Duplicate is off, and Try 3 directions needs two free slots, so it is off at 39 as well. These two carry no line of their own: one sentence at the bottom of the menu says it once, "A canvas holds up to 40 screens."
- While the linked agent is working, a line at the top says "The agent is working on this design. It may write over your edit." (the same hint as the text editor).
A disabled entry that explains itself can still be reached with the arrow keys (so a keyboard or screen-reader user hears the reason); Enter, Space and a click do nothing and the menu stays open. Esc closes the menu and focus goes back to the ⋯ button.

**Move up / Move down** work everywhere, with the keyboard too. **Dragging** is the full-screen page only: press a screen's first label and move; a chip with the screen's name follows the pointer and a line between rows shows where it will land (nothing shows over its own place); letting go saves, **Esc** cancels and sends nothing. The wheel keeps panning during a drag. A click without movement is not a drag, so a double-click on the label still focuses the screen. While a request runs the ⋯ buttons are off and the row it is about shows a small spinner.

**After an action** a notice under the toolbar (a live region, so a screen reader hears it) says what happened with **Undo** for 10 seconds: "Moved Pricing to the end", "Duplicated Home", "Moved Pricing to trash". The wall re-lays out at once, and when the moved or copied row is outside the visible part the camera pans the least it takes to show it (zoom is not changed). Ctrl/⌘+Z undoes the last hand edit of the view, whether it was a text edit or a screen action (one slot for both, so one key press never undoes two). A refusal is an error notice that stays until dismissed ("Couldn’t move Checkout" and the service's sentence); a stale list refreshes the wall so the next try works.

**Comments on a screen that is gone** stay in the Comments drawer under "<id> · Screen removed" (muted, after the listed screens, one group per removed screen). They have no pin on the wall, so their row cannot "show" one; they can still be resolved or sent. Undo brings them back under the screen.

**"+ Screen".** In Edit mode, on a live design with room, a dashed board "+ Screen" sits after the last row. It is a button: click it and a small box asks "What should the new screen show?" with the line that says where the message goes ("Goes to the linked chat", "Goes to “<chat>”", "Starts a new chat"), **Cancel** and **Ask the agent** (the one filled button). Ctrl/⌘+Enter also sends; Esc cancels. Nothing is written by Design Chamber: it is the ask flow, one message to the linked chat that names the canvas and the screen it should follow ("Add a new screen to the canvas "Tidepool site" after "Checkout": <your words>. Write it as screens/<id>.html and add it to design.json. The canvas has room for 5 more screens."). An empty box is allowed (the agent chooses); the box counts the characters left once 200 remain ("180 left") and says "12 over" past the limit, where the button turns off. While it sends the words are read-only and the button spins; a failure puts "Couldn't send. <why> Your message is still here." under the box, keeps the words and turns the button back on. The board is hidden in Play mode, on an old version and at 40 screens. The new screen appears on the wall when the agent writes it. **Try 3 directions…** opens the same box ("What should the directions explore? (optional)") and sends the directions request; the direction row it produces is U4's.

## Directions on the wall (what the user sees)

When the agent marks screens as directions of another screen, the wall draws them as **one row** in that screen's place, so they can be compared side by side:

- **Header.** "Pricing · 3 directions" (the agent's marks, written or not), then **Show at** with a small select of the original's own device sizes, then the row's ⋯ menu (the same menu a normal row has: Duplicate, Move up, Move down, Move to trash, Try 3 directions…). Every board of the row is shown at that one size, whatever device sizes the design has; the choice is remembered for the design and read when the view opens. With only one size the select is not shown.
- **Boards.** **Current** first (the original screen, "Current · Laptop 1280×800"), then the agent's letters with their short names, "A · Bold", "B · Editorial", "C · Cards". A direction has no row of its own anywhere else: it is not in the screen menu's Move up and Move down, and a drag moves the original and takes its directions along.
- **Full-screen page:** one line, left to right. **Rail:** a 2×2 grid (Current and A over B and C; a fourth direction D starts a third line), so every direction is on screen at once after Fit. A phone size in the rail is narrow, so Fit zooms in and the labels may show only their ⋯.
- **Keep this one.** On the page each written board's label ends in an outline **Keep this one** button, Current included. On the rail the labels are too small for a button, so each board's ⋯ menu holds one entry, **Keep this one**. A direction the agent has not written yet shows the "isn't written yet" board, and its Keep is off with the reason inside the option ("Not written yet.") or in the button's name and tooltip. While a keep runs the pressed board's label spins and every other Keep and menu is off. An old version on show or Play mode hides the Keep buttons; the row keeps its layout.
- **Done.** The wall goes back to a normal row (Pricing at all its device sizes) and a notice reads "Kept B for Pricing. The others are in the trash." (or "Kept the current Pricing. The directions are in the trash.") with **Undo**. A refusal ("The screen list changed while you were working. Nothing was changed.") shows as an error notice titled "Couldn't keep direction A" and the wall refreshes to what is true now.
- **Try 3 directions…** (the row's menu) is off while the screen already has directions: "This screen already has directions. Keep one first."
- **Room.** The wall reserves space above each direction row for its header, and between the lines of the rail's grid, so the header and the labels do not sit on the row above. Zoomed far out (several rows of directions on a narrow rail) a header gives up Show at first and then hides until you zoom in.

Steps from the wall: see directions → Keep this one on the board (page) or ⋯ then Keep this one (rail) = **1 click on the page, 2 on the rail**; Undo is one more click on the notice. Screenshots come from `test/ui/visual/scenarios/directions.mjs` (`node test/ui/visual/shoot.mjs directions --out documentation/pages/img`).

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

## Where it lives (wall)
- `src/ui/model/screens-model.ts` and `menu-model.ts`: what the menu offers and why an entry is off, whether the board shows, orders, drop target, the box's room and counter, the pan that keeps a row in view (pure; `test/ui/screens-model.test.ts`, `test/ui/menu-model.test.ts`).
- `src/ui/wall/feature-screens.ts` (requests and notices), `reorder-controller.ts` (the drag), `board-set.ts` (the ⋯ button, the "+ Screen" board), `src/ui/components/ask-popover.ts` (the box), `kit.ts` (a menu row's `reason`, the menu's top and bottom notes), `feature-undo.ts` (the one undo slot).
- Screenshots: `test/ui/visual/scenarios/screens.mjs`.

## Where it lives (service)
- `src/shared/screen-ops.ts`: the pure list planning (listed entries, reorder, free copy ids, the copy entry, removal, describing a move) and the sentences.
- `src/service/edits/ops-screens.ts`: the four ops: reads, stamp and file checks, the steps.
- `src/service/store.ts`: `writeScreens` (the stamp-checked list write, sharing the design.json retry loop with the mirror) and `moveComments`.
- Tests: `test/shared/screen-ops.test.ts`, `test/service/core/edits-screens.test.ts`.
- Spec: `documentation/specs/phase-2-technical.md` §5.1, §5.2, §6.2; requirements `documentation/specs/phase-2-edit-on-canvas.md` §5, §6.
