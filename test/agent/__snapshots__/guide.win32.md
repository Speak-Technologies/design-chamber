<!-- design-chamber:guide v1 sha256:2dc7f35bfc93712fc79de512d119ba99fe7ec5a05d4369424b713cad2a3c3199 -->
# Designs folder (Design Chamber)

This folder, `C:\Users\you\Documents\Designs`, is the user's designs folder for Design Chamber, the design viewer inside OpenChamber. The user sets it in Design Chamber settings (the default is `~/Documents/Designs`). Designs saved anywhere else do not show up.

## One folder per design

- Every design is its own folder: `C:\Users\you\Documents\Designs\<slug>\`. Never save a design as a loose file in this folder.
- The slug uses lower-case letters, digits and hyphens, starts with a letter or digit, and is at most 63 characters (for example `pricing-page`).
- Pick a new slug for a new design. Never reuse or edit another design's folder unless the user asks you to.

## Page or canvas

- A **page** is one `index.html`, shown full screen like a browser tab.
- A **canvas** is a wall of screens, each one shown at several device sizes side by side, like Claude Design. Each screen is `screens/<id>.html`.
- Make a canvas when the user says canvas, or when the work has several screens, steps or boards.
- A very tall page made of board-like sections works better as a canvas with one screen per board.

## Write order

1. Create the design folder.
2. Write `design.json` first.
3. Then the HTML: `index.html` for a page, one `screens/<id>.html` per screen for a canvas.
4. Then `tokens.css`, `DESIGN.md` and anything in `assets/`.

design.json for a page:

```json
{
  "version": 1,
  "kind": "page",
  "title": "Pricing",
  "updated": "2026-11-01T10:00:00Z",
  "viewports": [{ "id": "laptop", "label": "Laptop", "width": 1280, "height": 800 }]
}
```

design.json for a canvas:

```json
{
  "version": 1,
  "kind": "canvas",
  "title": "Signup flow",
  "updated": "2026-11-01T10:00:00Z",
  "viewports": [
    { "id": "laptop", "label": "Laptop", "width": 1280, "height": 800 },
    { "id": "phone", "label": "Phone", "width": 390, "height": 844 }
  ],
  "screens": [
    { "id": "welcome", "title": "Welcome", "file": "screens/welcome.html" },
    { "id": "details", "title": "Your details", "file": "screens/details.html" }
  ]
}
```

Set `updated` to the current time whenever you change the design. When design.json already exists, change only `title`, `updated`, `viewports`, `screens` and `designSystem`, and keep every other key as it is.

## Works offline

- No CDNs, no Google Fonts or other web fonts, no remote images or scripts. The viewer blocks anything from the internet.
- Put fonts in `assets/fonts/` and load them with `@font-face`. End every font stack with a generic family such as `sans-serif`.

## Relative paths only

- From `index.html`: `assets/photo.png`, `tokens.css`.
- From `screens/`: `../assets/photo.png`, `../tokens.css`.
- No absolute paths, no `file://`, no drive letters.

## Leave these alone

Never touch `.versions/`, `.chamber/`, `.thumb.png` or `.trash/`. Design Chamber keeps versions, comments and thumbnails there.

## Design rules

When the user's message starts with `/design` or `/page`, follow the instructions attached to it and the design's `.chamber/RULES.md`. Without them, follow this file and these short rules:

- The user's words come first, then the project's own design rules (DESIGN.md, tokens, theme files), then these.
- No default purple-to-blue gradients, no stock centred hero with three equal cards, no box around every section.
- Pick a typeface on purpose, at most two families. Not Inter, Roboto or Arial by default.
- One spacing scale, one radius scale and one type scale, kept in `tokens.css`. No one-off values.
- Real copy from the brief: no lorem ipsum, no made-up stats, logos or testimonials.
- No emoji as icons. Use inline SVG.
- Contrast at least WCAG AA, a visible focus ring, a label on every input.
- One responsive file per screen, never a copy per device.
- Show loading, empty and error states wherever data appears.
- Everything opens offline.

When the user wants the full rules for a fresh design, suggest starting with `/design <brief>` for a canvas or `/page <brief>` for a page.

## About this file

Design Chamber wrote this file and keeps it up to date. If you edit it, Design Chamber stops updating it.
