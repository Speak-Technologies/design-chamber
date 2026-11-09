# Design Chamber instructions for "Pricing page for a coffee subscription"

This file is part of your instructions for this design. Read all of it before you design, and follow it on every later message about this design, not only the first.

- Design: "Pricing page for a coffee subscription" (canvas: a canvas is an infinite wall of screens, each shown at every viewport side by side, like Claude Design)
- Folder (write ONLY inside it): C:\Users\you\Documents\Designs\pricing-page
- Designs folder: C:\Users\you\Documents\Designs. The user set it in Design Chamber settings (the default is ~/Documents/Designs). Every design is its own folder in there. Never save designs anywhere else, and never as a loose file.
- Files:
  - design.json: C:\Users\you\Documents\Designs\pricing-page\design.json
  - one file per screen: C:\Users\you\Documents\Designs\pricing-page\screens\<id>.html
  - tokens.css: C:\Users\you\Documents\Designs\pricing-page\tokens.css
  - DESIGN.md: C:\Users\you\Documents\Designs\pricing-page\DESIGN.md
  - assets/: C:\Users\you\Documents\Designs\pricing-page\assets
  - Never touch: .versions/ (snapshots), .chamber/ (this file; the extension rewrites it), .thumb.png (thumbnail cache).
- Brief (the user's words):
  > A pricing page for a coffee subscription. Three plans, mobile first.
- Project folder: none open in this chat.
- Your file tools may ask permission to write in your designs folder, because it is outside the project. That is expected; the user can allow it.

## Do this, in this order

1. Read this whole file. Read it again at the start of every new request about this design: it may have been refreshed.
2. Look for the active project's design rules FIRST (Precedence, layer 2). Tell the user what you found in 2–4 lines, citing files, or say "no project context".
3. Settle the viewports (Viewports).
4. If anything material is unclear, ask before you build: one message, then wait (Ask when unsure). Skip the questions only if the user said "go" or the request is a small edit.
5. Build only inside the folder above. Write design.json first, then the HTML. Write DESIGN.md and tokens.css before the second screen. Update design.json in the same turn as the files it describes.
6. Before you say you are done, run the check in "Check your work" and fix every error. Your reply states what you built, which sources you followed, your assumptions, and at most one open question.

## Precedence

Highest first. A higher layer always wins. Never silently override one; if a lower layer conflicts with a higher one, say so in one line. Inside the winning layer, do not invent colours, spacing or type values it already defines.

### Layer 1: the user's words in chat

Always first. Never ask the user to repeat something they already said in this chat.

### Layer 2: the active project's design rules (look for these FIRST)

No project folder is open in this chat (none). Ask the user whether an existing codebase or brand should be followed before you invent a look; if they say there is none, this layer is empty.

### Layer 3: style preset, none chosen

The user did not pick a preset. If layers 1–2 do not settle the look, propose 2–3 distinct named directions yourself in your questions (Ask when unsure, §5) instead of defaulting to one.

### Layer 4: this design's own DESIGN.md + tokens.css, once confirmed

Status: not written yet. Write DESIGN.md and tokens.css once, before the second screen, from layers 1–3; set `designSystem.confirmed` to true in design.json when the user accepts them.

### Layer 5: the built-in rules

The "Design rules" and "Ask when unsure" sections below: anti-slop, best practices, file rules and the self-check. They apply when nothing above settles a question.

## Viewports

Settle the viewports before you design: every screen is rendered at every viewport you list in design.json.

1. Derive them from the project first. Design Chamber found no breakpoints in the project (or no project is open).
2. If the project or brief makes it clear (a desktop-only admin console, a mobile app), use that and state it as an assumption; no question needed.
3. Otherwise ask which viewports to show, recommending the defaults **Laptop 1280×800 + Phone 390×844**. Add Tablet 768×1024 when the layout changes there, Desktop 1440×900 for wide dashboards, 1080×1080 for social posts, 794×1123 for A4 print. Never assume desktop-only for a product people use on phones.
4. Record the agreed viewports in design.json `viewports` (1–8 items; width 200–3840, height 200–4320).

design.json lists now: Laptop 1280×800, Phone 390×844 (the extension's defaults until you change them).

## design.json contract

Schema `design-chamber/design@1`. The extension and you both write this file, so the keys are split by owner. Example (canvas):

```json
{
  "version": 1,
  "kind": "canvas",
  "title": "Checkout redesign",
  "created": "2026-10-26T18:00:00.000Z",
  "updated": "2026-10-26T18:20:00.000Z",
  "brief": "…",
  "sessionId": null,
  "projectDirectory": null,
  "preset": null,
  "viewports": [
    { "id": "laptop", "label": "Laptop", "width": 1280, "height": 800 },
    { "id": "phone", "label": "Phone", "width": 390, "height": 844 }
  ],
  "screens": [
    { "id": "home", "title": "Home", "file": "screens/home.html", "viewports": ["laptop", "phone"], "description": "Landing page" }
  ],
  "designSystem": { "confirmed": false },
  "comments": []
}
```

| Key | Owner | Rule |
|---|---|---|
| `version` | extension | Always `1`. |
| `kind` | extension | `"page"` (one index.html shown full screen) or `"canvas"` (a wall of screens). Fixed once you have written the first screen or index.html; before that you may switch it, as long as the design has no comments yet. |
| `title` | you | 1–120 characters. The user may rename it. |
| `created` | extension | Never change. |
| `updated` | you | ISO-8601 UTC time. Set it on every change you make to the design. |
| `brief` | extension | The user's brief. Never change. |
| `sessionId`, `projectDirectory`, `preset` | extension | Links to the chat, the project and the preset. Never change. |
| `entry` | extension | Page only: always `"index.html"`. |
| `viewports` | you | 1–8 items `{ id, label, width, height }`; `id` letters, digits, `-`, `_`. |
| `screens` | you | Canvas only, 0–40, in the order they appear on the wall: `{ id, title, file, viewports?, description? }`. `id` is lower-case letters, digits and `-`; `file` is exactly `screens/<id>.html`; `viewports` is an optional subset of the viewport ids (default: all); `description` ≤ 500 characters. |
| `designSystem` | you | `{ "confirmed": false }`; set `true` once the user confirms DESIGN.md and tokens.css. |
| `comments` | extension | The user's pinned comments. Never edit. |

- Keep every key you do not own, including keys you do not recognise, exactly as it is. The extension puts its keys back if you change them.
- Write design.json before any HTML file, so the extension takes your title, kind and viewports from the start.
- Write the whole file as valid JSON in one write. A half-written file shows as an error until you fix it.
- Update `screens` / `viewports` / `updated` in the same turn you write the files they describe. A listed screen whose file is missing shows as "not written yet".

## Design rules

The built-in design rules, exactly as shipped (layer 5):

<!-- BEGIN rules/DESIGN-RULES.md (verbatim) -->
(design rules)
<!-- END rules/DESIGN-RULES.md -->

## Ask when unsure

The question protocol, exactly as shipped:

<!-- BEGIN rules/QUESTIONS.md (verbatim) -->
(questions)
<!-- END rules/QUESTIONS.md -->

## Rendering constraints

Design Chamber shows your files offline, inside a sandboxed frame. So:

- Everything works with no network: no CDN scripts, Google Fonts or other web fonts, remote images or analytics. Bundle fonts and images in `assets/` (fonts in `assets/fonts/` with `@font-face`, and end every font stack with a generic family).
- Remote files are blocked and listed back to you when the user sends comments.
- Reference local files statically with relative paths: `assets/hero.jpg` and `tokens.css` from index.html; `../assets/hero.jpg` and `../tokens.css` from `screens/*.html`. URLs built at runtime (`new Image().src = "assets/x.png"`), `fetch()` / XHR of local files and ES-module imports across files do not load.
- Small inline `<script>` interactions work (clicks, tabs, toggles). There is no `top.location`, `window.open`, cookie/localStorage assumption or network call.
- Link between screens with `<a href="other-screen.html">` (a sibling file in `screens/`) or `data-dc-goto="<screenId>"`. Links to `#anchors` work; an external https link asks the user before it opens.
- Give meaningful elements stable hooks (`id`, `data-screen`, semantic class names): comments are pinned to elements by selector and travel with it.
- One responsive file per screen: the wall renders it at every viewport in design.json.

## Check your work

Run this after each change, before you say you are done:

    sh '/home/you/Documents/Designs/.chamber/bin/dc' check pricing-page

It renders every screen at every viewport in design.json, saves PNGs under .chamber/check/ and lists what it found: files that don't load, content wider than the viewport, cut-off or overlapping text, low contrast, images without alt text, fields without labels, script errors. Fix every error, open the PNGs to see the result, and run it again. Exit code 0 means no errors. If it says no browser was found, it still checks the files; say in your reply that the design was not rendered.
