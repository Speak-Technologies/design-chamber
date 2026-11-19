# Design system hand edits

How the local service saves a change the user makes to a design system by hand: a token value, a
new token, a removed token, a note or other metadata in `system.json`, the overview, or the body
of a note, pattern or brand entry. The system page's editing panel calls it (the screens are built
separately; this page describes the rules the service enforces). It is the same machinery as a
hand edit on a design ([Edit on the canvas](edit-on-canvas.md)), read with "system" in place of
"design".

## What one Save can change
- **Tokens in `tokens.css`.** Set a value, add a token, or remove one, in light mode (the top-level
  `:root { … }`), dark mode (`:root` inside `@media (prefers-color-scheme: dark)`), or both for a
  removal. Declarations anywhere else (a `.card { --brand-500: red }`, an `@media print` block) are
  component styling: they are shown as "Also set in …" and never touched.
  - A set changes only the value of the last declaration in that mode. A value that is a formula
    (`var(…)`, `calc(…)` and friends), carries `!important` or a comment, or can't be read is not
    editable here ("This value is a formula. Ask the agent to change it.").
  - An add goes at the end of the last light or dark block, indented like the token above it, with
    the file's own line endings. When the file has no such block, one is added at the end.
  - A removal takes the whole line. A block left empty stays.
  - Every byte not being changed stays as it was: comments, order, CRLF line endings, a byte-order
    mark. The service rescans the result before writing and refuses anything that is not exactly
    the planned change ("Design Chamber couldn't write these values exactly. Nothing was saved.").
- **Metadata in `system.json`.** A token's note, colour group, section or breakpoint flag (or all its
  notes, when the token is removed); a type style's font family, size, weight, line height, letter
  spacing, case, note or name; a component's note or purpose; a font's family, weight or style; a
  logo's variant or note; a pattern's or brand entry's title, note or kind. Keys the service does
  not know are kept. A type style, component, font, logo or entry that is no longer in the file
  makes the Save stale.
- **Texts.** `OVERVIEW.md` (1 to 4 000 characters; it may be created), and the body of a note,
  pattern or brand entry that `system.json` lists (up to 20 000 characters). What the user types
  is written as text, never as markup.

Up to 200 token edits, 200 metadata changes and 10 texts go in one Save.

## Values
Every value Design Chamber writes into a system, and every value it shows, passes one check:
at most 100 characters, no `; { } < > \ : *`, no control character, quotes and brackets balanced,
and only colour and formula functions (`rgb hsl lab oklch color color-mix var calc min max clamp`
and their relatives), so `url(…)`, `expression(…)` and `attr(…)` are refused. Then each section
wants its own shape: a colour, a length, a shadow, a whole number for layers, font names for a
family. The refusal says what shape to use ("Use a colour, like #1a73e8, rgb(26 115 232) or a
colour name."). A token's section comes from its note in `system.json`, else from its name and value.

## The rules every Save follows
| Rule | What happens |
|---|---|
| Version first | Before anything is written, the system's files are kept as a version "Before your edits". Quick saves in a row share one version. If the version can't be saved, nothing is written. |
| Refused when changed | Each file is sent with the stamp the page read. When the agent or another window changed it since: "Acme changed while you were editing. Nothing was saved." Nothing is written and no version is taken. |
| Contained | Only `tokens.css`, `system.json`, `OVERVIEW.md` and entry bodies can be written, inside the system's own folder. A file that is a link is refused and its target is never written. |
| All or nothing | A Save that writes several files and fails part way puts the earlier files back. |
| Not the agent | The writes are announced as the user's, so the build strip never shows them as the agent writing, and the revision moves on at once. |
| Undo | The notice "Saved to Acme" (or "Removed --x from Acme. Designs that copied Acme keep it.") offers Undo for 30 minutes (the last 10 edits). Undo puts back exactly the old bytes; a file created by the Save goes to the trash. If a file changed again since, Undo is refused and the version "Before your edits" is the way back. A Save too large to undo here says "Restore 'Before your edits' from Versions to undo." |
| Reviews kept | A section the user had marked Looks good stays so after their own Save. A change by the agent still sends it back to Not reviewed. |

## What the agent is told
Each Save adds one line per changed thing to the system's hand-edit list (`.chamber/edits.json`,
never versioned): "Changed --brand-500 (light) in tokens.css: '#1a73e8' to '#0b57d0'", "Added
--surface to tokens.css", "Changed the note of --brand-500 in system.json", "Edited notes/history.md".
The list rides along on the next message to the system's chat and is cleared once delivered. An Undo
before then removes the lines; after, it adds "Undid: Saved to Acme".

## Systems kept in a project repo
A system that lives in a project's repo is read-only here: a Save or an Undo answers "Acme lives in
shop. Change the values there, or ask the agent here." before anything is read or written.

## Routes
`POST /systems/:id/edits`, `POST /systems/:id/edits/:eid/undo` and `POST /systems/:id/hand-edits/clear`,
each behind the service token, with the system id checked before any path is built. Re-sync
(`POST /systems/:id/resync`) is a separate flow and is not built yet.
