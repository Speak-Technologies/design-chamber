# Saved page data (designs that remember their state)

A design that saves ticks, toggles or filters with `localStorage` keeps them across reloads inside
Design Chamber, the way it would on a real website. The frame the design runs in is sandboxed and
has no real storage, so Design Chamber gives it a stand-in and keeps the data itself, in the design's
own folder. This page describes where the data lives, the rules the service follows, what the three
routes answer, and what the viewer shows about it (the menu entry, the confirm and the notices).

## Where it lives
- One store per design: `<design>/.chamber/page-state.json`. Every screen and viewport of a canvas,
  on the rail and on the full-screen page, shares it.
- The file is one line of JSON: `{ "v": 1, "updated": "<time>", "items": [["key", "value"], ...] }`.
  The data is a list of pairs, not an object, so the key order is kept and keys like `__proto__` are
  plain text.
- Nothing is created until a design actually saves something. Opening a design only reads.
- `.chamber/` belongs to Design Chamber. It is left out of versions, ZIP and single-file exports,
  thumbnails and check renders, and a version restore never touches it. When a design is deleted,
  its saved data goes to the trash with the folder.

## The rules
- **1 MB per design.** Keys and values together, counted in characters the way browsers count
  storage (an emoji counts as two). A save that would go over is refused whole: nothing of it is
  applied, and earlier data stays as it was. The answer says "This design tried to save more than
  1 MB of page data. The extra wasn't saved."
- **At most one disk write per second per design.** A design that saves on every animation frame
  still costs one write a second; the newest data always wins. The service answers a save before
  it reaches the disk, and writes everything still waiting when it shuts down.
- **Atomic writes.** The file is written to a temporary name and renamed, so a half-written file is
  never seen.
- **A removed design is never brought back.** If a design folder is deleted while a write is
  waiting, the write is dropped (or fails), and no folder is re-created.
- **A damaged file reads as no data.** Anything that is not exactly the format above (broken JSON,
  another version, a number where text should be, more than 1 MB of data, a file over 8 MB) reads as
  empty, and the next save replaces the file. Nothing else in the design is affected.
- **Links are refused.** If `.chamber` or `page-state.json` is a link (even one pointing inside the
  design), the data reads as empty and every save or clear is refused with "This design's .chamber
  folder or its page data file is a link or not a normal file, so Design Chamber won't save page data
  there." Data behind the link is never read or handed to the design.
- **Never logged.** The data can be personal (career notes, plans). Log lines carry only the design
  name and an error code, never a key, a value or the file's text. It is never sent to a chat.
- **Two windows, same design:** the last save wins.

## Clear saved page data
Clearing removes the file and empties the memory copy. A Clear never comes back: another window
that still holds unsaved changes from before the Clear has its next save refused ("Saved page data
was cleared in another window, so these changes were not saved."), and it drops those changes
instead of writing them back. Clearing twice is fine.

This works through a counter the service hands out with every answer (`gen`). A save carrying a
counter from before the latest Clear is refused. A counter from an earlier run of the service (after
a restart) is accepted, because the service cannot tell; the only case this misses is a Clear
followed by a restart within the other window's one-second save delay.

## The routes (local service)
All three need the service token, check the design name, and resolve every path inside the design
folder.

| Route | Does | Answers |
|---|---|---|
| `GET /designs/:slug/page-state` | Reads the data | `{ items, chars, gen }`, plus `damaged: true` when the file was unreadable |
| `PATCH /designs/:slug/page-state` | Saves changes: `{ gen, clear?, changes: [[key, value or null], ...] }` (`null` removes a key; at most 10 000 changes), or `{ gen, uploadId }` when the changes are too big for one request | `{ chars, gen }`; 409 when made before a Clear; 413 over 1 MB; 400 for a malformed request or a missing `gen` |
| `DELETE /designs/:slug/page-state` | Clears the data | `{ ok: true, gen }` |

When the disk refuses a write (a full drive, no permission), the memory copy is kept, the problem
is logged with its error code, and the next save answers with a sentence about the folder so the
viewer can show its notice. That next save also retries the write.

## Memory
The service keeps a design's data in memory once it is used, drops it after 10 idle minutes once it
is saved, and keeps at most 32 MB across all designs (the least recently used saved design goes
first). Unsaved data is never dropped.

## What the viewer shows
The rail and the full-screen page behave the same way, for pages and canvases alike.

- **What a frame is given.** A frame that shows the current design gets the saved data when it is
  made, and waits for it (two seconds at most). A frame that shows an old version, the old half of a
  Compare, a thumbnail or a check render starts empty and saves nothing, so an old version never
  touches the data of the current design. When one frame writes, the other frames of the same
  design, on every screen and size, pick the change up without reloading.
- **Clear saved page data** is in the ⋯ menu, just before **Rename** (so after **Copy path**). It is
  there only while the design has saved data, and it is off, with "Not while viewing a version"
  under it, while an old version is on show.
- **The confirm** reads "Clear saved page data for <design title>?", "Ticks, toggles and filters
  this design saved will be reset. This can't be undone.", with **Cancel** and a red **Clear**. Cancel
  does nothing. **Clear** shows progress, then closes the dialog, reloads every frame of the design
  with empty data and shows "Saved page data cleared." for five seconds. If the service can't do it,
  the dialog stays open and says "Couldn't clear the saved page data." followed by the reason; nothing
  is cleared and Clear can be pressed again.
- **Notices** appear above the design (a warning for the first two), stay ten seconds (longer while
  the pointer or keyboard focus is on them), and each shows once per time the design is opened:
  - "This design tried to save more than 1 MB of page data. The extra wasn't saved."
  - "Page data can't be saved right now." with "Changes last until you close this design." under
    it. This shows when the saved data couldn't be read as the design opened, or after three failed
    saves in a row. The design still works, but nothing it saves outlasts the view.
  - "Saved page data was cleared." when another window cleared the data; the frames reload with
    what is saved now, and this window's unsaved changes are dropped.
- **Known gap.** A frame that is still loading when another frame saves has the data from the moment
  it started loading; it does not hear that one change. It matches again the next time it loads.
