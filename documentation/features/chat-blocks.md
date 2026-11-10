# Chat blocks (a design card and a direction pick in the agent's reply)

When the agent finishes a design, or wants the user to choose between a few, it can put a small
Design Chamber block straight into its reply. There are two. Both are drawn by Design Chamber's own
frame inside the chat, look like the rest of OpenChamber in light and dark, and never load the
design's HTML there: the preview is the same picture the rail shows.

Spec: `documentation/specs/phase-1-5-sdk-2-7.md` §U7, §U8 (also `docs/SPEC.md` §13.4). Code:
`src/ui/blocks/` (frame), `src/ui/model/block-args.ts` and `block-view-model.ts` (rules, tested).

## DesignCard

The agent writes `DesignCard` with one argument, `slug`: the design's folder name.

| What shows | When |
|---|---|
| Preview, title, Canvas or Page, the screens (`Screens: Home, Pricing, Checkout`, at most six, then `+N more`) or the viewports of a page (`Viewports: Laptop, Phone`), the Checks badge, **Open** and **Comment** | the design is there |
| Grey bars where the words and buttons will be, a small spinner in the preview | while it loads |
| A spinner in the preview, asked again after 2, 5 and 10 seconds, then "Preview not ready yet" | the picture is still being made |
| The kind's icon and "No preview without Chrome" | no Chrome, Edge or Chromium on this computer |
| "This design is no longer in your Designs folder." (no buttons) | the folder is gone, or was renamed |
| "This card doesn't point to a design." | the agent wrote something that is not a design folder name |
| "Design Chamber isn't responding." with **Try again** ("Design Chamber is paused." when the extension is turned off) | the local service did not answer |

The Checks badge is the viewer's own: the same words, colour and description ("3 issues",
"No issues", "Checking"), so a design reads the same in the chat, the rail and the viewer. If the
checks cannot be read the badge is left out rather than guessed.

**Open** opens the rail panel on the design. **Comment** does the same with the viewer already in
Edit mode and Comment pressed. Where the rail cannot open (a chat with no project), a toast says
"Open Design Chamber from the rail to see it." If the design was deleted in the meantime, the card
turns into the "no longer in your Designs folder" sentence.

## DirectionPick

The agent writes `DirectionPick` with `question`, `options` and `slugs`. `options` and `slugs` are
lists split by `|`, in the same order: each option is its own design folder (pricing-a, pricing-b).
2 to 4 options; anything else, or lists of different lengths, shows "This question has no options
to pick from." with no buttons. An empty question reads "Which direction?".

The tiles sit side by side, each with its preview, its letter (A to D) and its label. Under 360 px
they wrap to two a row, and four options go two a row under 480 px so the previews stay big enough
to judge.

- **A click is the answer.** It hands the agent `B: Editorial (pricing-b)` and starts its next turn.
  The tile is marked (a check, the selection colour), the others fade, and the caption says
  "You picked B." One answer per block: a second click does nothing.
- **A note answers too.** OpenChamber adds its own note field under the block. A note on its own
  leaves no tile marked and the caption says "You answered with a note."
- **After a reload** the answer comes back from OpenChamber and the same tile is marked. Only the
  `B: ` at the start is compared, so a label that was shortened still marks its tile.
- A tile whose design is gone says "Not found" and can still be picked (the user may still mean it).
- If OpenChamber refuses the answer, a toast says "Couldn't send your choice. Type it in the chat
  instead." and the tiles can be clicked again.
- Keyboard: Tab reaches the group (named by the question), the arrow keys, Home and End move
  between tiles, Enter or Space picks. An answered question stays readable and reachable.

## Rules it enforces

- **The arguments are not trusted.** A model writes them, and a web page the agent read could steer
  that model. Slugs must be design folder names (lowercase letters, digits and dashes, no `..`,
  slashes or drive letters); labels and the question are plain text, clipped (labels 80
  characters, the question 200, titles 80, screen names 40). Nothing is drawn or read before that.
- **Only reads until a click.** On screen a card reads the design, its checks and its picture;
  a pick reads each option's picture. Opening the rail and answering the agent happen only from
  the user's click, and OpenChamber itself refuses an answer that did not come from one.
- **No design HTML in the chat.** Previews are the service's PNGs, accepted only as base64 text
  of a bounded size and shown as an image.
- **As tall as it needs.** The frame tells OpenChamber its height (up to 960 px), so nothing
  scrolls inside a block.

## Data touched

Reads only: `GET /designs/:slug`, `GET /designs/:slug/checks`, `GET /designs/:slug/thumbnail`.
On a click: `POST /open-request` then the rail opens (and `DELETE /open-request` when it cannot);
`answerBlock` for a pick. Nothing is written to the design.

## Checked

`test/ui/block-args.test.ts`, `test/ui/blocks-model.test.ts`, and the visual scenario
`test/ui/visual/scenarios/chat-blocks.mjs` (every state above at 360 and 640 px, light and dark,
plus a theme switch). Checked live in OpenChamber 2.7.0 on 2026-11-10: both cards draw from `root = Stack([...])`, Open and
Comment open the rail, a tile pick answers the agent, and a note alone answers and survives a reload.
