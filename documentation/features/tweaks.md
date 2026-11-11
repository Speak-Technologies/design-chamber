# Tweaks: saving knob values into tokens.css

**What it does:** The agent can offer a few knobs for a design (accent hue, density, type scale, corner radius). Each knob is tied to one variable in the design's `tokens.css`. The user moves the knobs, sees every screen change live, and **Save** writes only those values into `tokens.css`. No HTML is rewritten.

Why it exists: trying a warmer accent or tighter spacing should not need a chat round trip, and the saved value should live in the design's own tokens, so exports and the agent both see it.

Status: the service half is built (T5): reading each knob's value from `tokens.css` (`GET /designs/<slug>/tokens`) and saving values through the hand-edit pipeline. The Tweaks panel on the wall (U2), the live preview inside the frames (T9, T11b) and the check finding for a broken knob (T5b) are not built yet, so saving is reachable only through the service route for now.

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

## What the agent is told
The hand-edit record notes each changed knob's label with its old and new value (80 characters at most each). The agent hears about it in the user's next message, as for every hand edit.

## Data touched
- Reads `design.json` (`tweaks`) and `tokens.css`.
- Writes only `tokens.css`, plus the design's hand-edit record and its version, as every hand edit does.
