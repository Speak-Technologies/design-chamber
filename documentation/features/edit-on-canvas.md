# Edit on the canvas: the rules every hand edit follows

**What it does:** Lets the user change a design by hand inside Design Chamber (fix a word, save tweak values, reorder, duplicate or trash a screen, keep one of several directions) without asking the agent. Every hand edit goes through one pipeline in the local service, so the same rules hold for all of them.

Why it exists: a typo should not need a chat round trip, but the agent writes the same files, and the design's own scripts must never be able to write to disk. The rules below keep the user's edit, the agent's work and the user's machine safe at the same time.

Status: the pipeline, Undo, the hand-edit record and the four routes are built (T2b). The edits themselves are added one by one: text is built (T3, see "Editing text" below); screens and directions (T4) and tweaks (T5) follow. Until each lands, its request answers "This part of Design Chamber (edits) is not built yet." and nothing is written. The editor on the wall (U1) is not built yet, so text edits are reachable only through the service route for now.

## The rules (E1 to E12)
1. **Only the user starts a write.** A hand edit starts from a click or key press on Design Chamber's own controls. Nothing a design's page sends can start, change or aim a write: the design frame only says what was clicked.
2. **The source decides.** What is written comes from the design's file as it is on disk, never from what the page shows. If Design Chamber cannot find the clicked text in the file exactly, it refuses before writing anything.
3. **A version first.** Before the first byte changes, the design's files are saved as a version called "Before your edits". Quick edits in a row (within a minute, with nobody else writing in between) share one such version; Undo steps through the edits inside it. If the version cannot be saved, nothing is written and the user is told why.
4. **Refused when the file changed.** If the agent, another window or any program changed the file since the user's view of it, nothing is written: "This file changed while you were editing. Nothing was saved." The typed text stays. The check happens again at the very moment of the write, so an agent write that lands in between is never overwritten.
5. **Smallest change.** Only the edited part of a file changes. Line endings, comments, indentation and everything else stay byte for byte.
6. **Text stays text.** What the user types is written as text; it can never become markup or a script.
7. **Contained.** Only these files can be written: a page's `index.html`, a canvas's `screens/<id>.html`, `tokens.css` and the screen list in `design.json`. Never `assets/`, `DESIGN.md`, `.chamber/`, `.versions/` or anything outside the design. A file that is a link (even one pointing inside the design) is refused: "This file is a link, so Design Chamber can't edit it here. Ask the agent instead."
8. **Shows at once.** The service announces the change itself, marked as the user's, so every view refreshes within two seconds.
9. **Undo.** Each edit can be undone for 30 minutes (the last 10 per design). Undo puts back exactly the bytes from before. If the file changed again since, Undo refuses: "This file changed after your edit, so it can't be undone here. Restore the version 'Before your edits' from Versions." Undo records are kept on disk, so they survive a restart of the service. An edit can be undone once; a second try says "This edit can't be undone any more."
10. **Not the agent.** The build strip never shows a hand edit as the agent "Writing" a file, and it is not counted in "Done. Updated N files".
11. **Allowed while the agent works**, with a hint that the agent may write over the edit.
12. **Not while viewing an old version.** Edit controls are off with "You're viewing an old version."

## Edits that touch several files
Duplicating, trashing a screen and keeping a direction move or create files and change the screen list. Every check runs before the first change. If a later step fails, the steps already done are undone in reverse and the user reads "Something went wrong, so nothing was changed." (or the failing step's own sentence when the file or list had changed). If even that fails, the user is told which version holds everything as it was. Files are never overwritten by a move: a trashed screen goes to `<Designs>/.trash/<design>.<screen>-<time>.html`, and a name already taken moves on to `-2`, `-3` and so on.

## Editing text
The user changes the words of one element (a heading, a button, a paragraph) on a page or on one screen of a canvas. The service decides from the file, never from the page on screen:

1. **The right file.** A page edits its `index.html`; a canvas edits `screens/<id>.html` for a screen in its list. A request that names a screen on a page, no screen on a canvas, or a screen that is not in the list is refused as an edit Design Chamber couldn't read.
2. **The file as the user saw it.** The service reads the file again. If it is a link (the file itself, or the `screens` folder, even when it points inside the design), larger than 2,000,000 characters, or not plain UTF-8, the edit is refused with that file's sentence. If its bytes are not the ones the page read, the edit is refused as "This file changed while you were editing. Nothing was saved." A screen file deleted in the meantime counts as changed too.
3. **The right element, or none.** The element is found in the file by its tag, its id and its text. It must contain only text (no tags or comments inside), have its own closing tag, and be the only match, or one of several matches that the page counted the same way, so the clicked one can be picked by position. Text made by the page's script, formatting inside, text that appears more than once without a sure match, implied closing tags (`<li>One<li>Two`), an entity Design Chamber does not know, or text inside an SVG, a template or the head: all refused with "Design Chamber couldn't find this text in the file exactly. Nothing was saved." The words the editor started from must still be exactly the element's words in the file.
4. **Only the changed words.** The service works out the shortest run of characters that changed and replaces just that run in the file. Indentation, line breaks inside the element, CRLF line endings, a byte-order mark, comments, attribute quoting and entities the user did not touch (an `&amp;` stays `&amp;`) are left exactly as they were.
5. **Typed text is text.** `&`, `<` and `>` are written as `&amp;`, `&lt;` and `&gt;`, so typing `</p><script>` puts those characters on the page and never a tag. After the change the service reads the file again and checks the element still holds exactly the new words and nothing else moved; if not, nothing is written.
6. **What cannot be typed.** Line breaks and control characters are refused with "That text has characters that can't be saved." The editor shows text the way the page reads it, with runs of spaces, tabs and line breaks folded into one space and none at the ends, so the page sends the text folded the same way. A tab, a double space or a space at either end that reaches the service is refused rather than rewritten.
7. **Empty is fine.** Deleting all the words leaves the element in place, empty; Undo brings the words back.

The notice reads "Text updated in <screen title>" on a canvas, or "Text updated in <page title>" on a page. Undo puts the replaced run back, as long as the file is still exactly as the edit left it, and checks the result matches the file from before the edit byte for byte. The hand-edit record notes the file, the screen title (none on a page) and the old and new words, 80 characters of each at most.

## What the agent is told
Each hand edit adds one short structured entry to the design's hand-edit record (`.chamber/edits.json`). The next message the user sends about the design starts with a summary of those entries, so the agent re-reads the files before changing them; after it is sent, the entries are cleared. An undone edit that was not sent yet is simply removed; one that was already sent adds "Undid: …". The record holds only short quotes (80 characters at most) and fixed fields, never free text, so nothing written into the design folder can slip extra instructions into the user's message.

## Failures the user can see
Every refusal is one plain sentence: the design left the Designs folder, the file changed, the file is too large, not plain UTF-8, a link, another program is holding it ("Close it and try again"), the disk refused (the usual folder error sentences), or the version could not be saved first. Nothing is half-written: every file is replaced in one step.

## Limits and safety
- The routes are behind the service's bearer token, check the design name and its folder, and take no file paths: targets are named by screen id or fixed file names.
- Logs carry the event, the design, the kind of edit and the outcome; never typed text, file contents or tweak values.
- `.chamber/edits.json` is never versioned, exported or sent as a file. One that is damaged, too large or a link reads as empty; a link is never written through.

## Where it lives
- `src/service/edits/pipeline.ts`: the pipeline, request checks, the writable set, Undo, rollback.
- `src/service/edits/file.ts`: `.chamber/edits.json` (ledger, undo records, the per-design update queue).
- `src/service/edits/op-module.ts`: the interface each edit implements; `ops-text.ts`, `ops-screens.ts`, `ops-tokens.ts` the edits.
- `src/service/edits/trash.ts`: trash names for screen files.
- `src/service/routes/edits.ts`: `POST /designs/:slug/edits`, `POST /designs/:slug/edits/:id/undo`, `GET /designs/:slug/tokens`, `POST /designs/:slug/hand-edits/clear`.
- Spec: `documentation/specs/phase-2-technical.md` §2; requirements `documentation/specs/phase-2-edit-on-canvas.md` §2.
