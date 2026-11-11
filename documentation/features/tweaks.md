# Tweaks: saving knob values into tokens.css

**What it does:** The agent can offer a few knobs for a design (accent hue, density, type scale, corner radius). Each knob is tied to one variable in the design's `tokens.css`. The user moves the knobs, sees every screen change live, and **Save** writes only those values into `tokens.css`. No HTML is rewritten.

Why it exists: trying a warmer accent or tighter spacing should not need a chat round trip, and the saved value should live in the design's own tokens, so exports and the agent both see it.

Status: built. The service half (T5: reading each knob from `tokens.css`, saving through the hand-edit pipeline), the live preview in the frames, the panel on the wall and in the rail (U2) and the check finding for a broken knob (T5b, see [Design checks](design-checks.md)) are all in.

## Knobs (written by the agent in design.json)
A design lists its knobs under `tweaks` in `design.json`. There are two kinds:
- **number**: a slider with `min`, `max`, `step` and an optional `unit` (`px`, `rem`, `%`, or none).
- **choice**: 2 to 6 named values, such as Compact `0.85`, Comfortable `1`, Roomy `1.2`.

At most 12 knobs. A knob that does not follow the rules (no `--name`, min not below max, a step that does not fit, a choice value with `;`, `{`, `}`, `<`, `>`, `\` or `*`, or with an odd number of quotes) is dropped with a design.json warning; the others still work.

## Which value a knob reads and changes
A CSS variable can be set in several places. The knob always uses **the last declaration in a top-level `:root { … }` rule**, which is the one the browser applies by default. Declarations anywhere else (inside `@media (prefers-color-scheme: dark)`, `[data-theme=dark]`, `@layer`, a `:root, html` rule or a rule nested inside `:root`) are left alone; the panel lists up to three of those places as "Also set for <place>; only the default changes."

Design Chamber reads `tokens.css` the way a browser does: comments, quoted strings, `url(…)` and brackets are skipped over, so a `;` or `}` inside them does not end a declaration.

Each knob is in one of these states:

| State | When | What the panel says |
|---|---|---|
| ok | a number in the knob's unit, or one of the choice's values | the value |
| another value | a choice knob whose file value is plain text but not one of its options | "tokens.css sets another value: <value>"; choosing an option replaces it |
| missing | no top-level `:root` declaration of the variable | "tokens.css has no --name." |
| formula | `calc()`, `var()` or any other function (unless it is one of the choice's own options), `!important`, a comment inside the value, a broken string, or anything that is not a plain number for a number knob | "This value is a formula. Ask the agent to change it." |
| unit | a number in another unit (`0.5rem` for a `px` knob) | "tokens.css sets --name in rem, but this tweak uses px. Ask the agent to fix it." |
| no file | the design has no `tokens.css` | "This design has no tokens.css." |

The file as a whole cannot be edited here when it is a link (even one pointing inside the design), larger than 1,000,000 bytes, or not plain UTF-8. The panel then turns every knob off with "tokens.css can't be edited here. Ask the agent instead."

## Saving
Save follows every rule in [Edit on the canvas](edit-on-canvas.md): a version "Before your edits" first, refused when the file changed, the smallest change, and Undo.
1. **Only current knobs.** Every value must belong to a knob that is still in design.json, of the same kind. If the agent removed or changed a knob meanwhile: "The tweaks in design.json changed while you were working. Nothing was saved."
2. **Only allowed values.** A number must be inside the knob's range; a choice must be one of its option values. Nothing else is ever written, so a knob cannot slip other CSS into the file. Anything else is refused: "That value isn't one this tweak allows. Nothing was saved."
3. **The file as the user saw it.** If `tokens.css` changed (or was deleted) since the panel read it: "tokens.css changed since you started. Your values are still shown." The check runs again at the very moment of the write.
4. **Each knob still editable.** A knob that is now missing, a formula or in another unit is refused with its sentence from the table above.
5. **Only the values change.** Numbers are written with the step's decimals and the knob's unit (`1.2rem`, `250`), with no trailing zeros. A value the file already holds is skipped, so `8.0px` stays spelled that way. Only the value text of each changed declaration is replaced; whitespace, comments, other declarations, the media-query copies, CRLF line endings and a byte-order mark stay byte for byte. Afterwards the file is read again; if anything other than those values moved, nothing is written: "Design Chamber couldn't write these values into tokens.css exactly. Nothing was saved."
6. **One write.** All changed values go into the file in one write, so one Undo brings them all back. (Only when the changed declarations are more than 40,000 characters apart is the save split into a few writes, still undone together.)
7. **design.json is not touched.** Saving tweaks never marks the design system as confirmed; that stays the user's word in chat.

The notice reads "Tweaks saved to tokens.css" with Undo. If every value was already in the file, nothing is written and the notice adds "tokens.css already had these values." Undo puts back exactly the bytes from before, as long as `tokens.css` is still as the save left it.

## The panel: what the user sees
Opening the panel is one click on **Tweaks** (the toolbar on the full-screen page, the header icon in the rail). The button only exists when the design lists at least one valid knob; with none, the ⋯ menu offers **Ask for tweaks**, which puts "Add tweaks for this design (accent hue, density, type scale, radius)." in the ask bar and sends nothing.

- **Where:** a 360 px panel beside the wall on the full-screen page; a non-modal bottom sheet of at most half the rail in the rail, with the wall live above it (full height when the rail is shorter than 560 px when it opens). Opening it closes Comments or Versions and the other way round.
- **Rows:** the knob's label, its value with the unit, and a slider (arrow keys one step, Page Up/Down ten steps, Home/End the ends) or a segmented choice. A knob that cannot be tuned is dimmed with its reason from the table above; one whose variable is also set in a media query or theme rule says so and adds that the preview shows the value everywhere while a save changes only the default.
- **Preview:** moving a knob changes every open artboard within a frame, without reloading it: scroll position, Play state and camera stay. Artboards that are off screen pick the values up when they load. Exports, thumbnails and checks never see the preview.
- **Unsaved:** a dot on the button, "Unsaved" next to the title, **Save** (the one filled button on screen; the ask bar's **Send** drops to an outline while the panel is open) and **Reset** on. With nothing to save both are off and the foot says "Nothing to save yet." Values survive closing the panel and a reload of the extension frame (kept in the host's storage).
- **Save:** progress on the button while it writes, then the notice "Tweaks saved to tokens.css" with **Undo**. A refused save keeps every value and says why under them ("Couldn't save your tweaks. <why> Your values are still here."). **Reset** goes back to the file's values and writes nothing.
- **When tokens.css cannot be read:** "Couldn't read tokens.css. <why>" with **Try again**; every knob and both buttons are off; values left unsaved are kept and shown.
- **When the agent rewrites tokens.css under your values:** "tokens.css changed since you started. Your values are still shown." with **Apply to the new file** and **Discard my tweaks**. The preview stays on top of the new file; Save is off until you choose. Knobs that no longer exist in the new file are named and left out of Apply.
- **Leaving with unsaved values** (back, another design): "Save your tweaks?" with **Keep editing** (also Esc), **Discard** and **Save**; a failed save keeps the dialog open with the sentence.
- **An old version on show:** the panel is read only with "You're viewing an old version." and nothing previews.
- **The agent is working:** the foot says "The agent is working on this design. It may write over your edit."
- **The design is gone:** "That design is no longer in your Designs folder. Your unsaved values were:" with one selectable line per knob; nothing is written.

Screenshots: `test/ui/visual/scenarios/tweaks.mjs`.

## What the agent is told
The hand-edit record notes each changed knob's label with its old and new value (80 characters at most each). The agent hears about it in the user's next message, as for every hand edit.

## Data touched
- Reads `design.json` (`tweaks`) and `tokens.css`.
- Writes only `tokens.css`, plus the design's hand-edit record and its version, as every hand edit does.
