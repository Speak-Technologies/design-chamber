---
name: design-chamber
description: "Use when the user asks for a design, mockup, wireframe, UI screen, landing page, prototype, HTML page or design canvas, or mentions the Designs folder, Design Chamber or a design studio. Explains where to save designs so Design Chamber shows them inside OpenChamber, and how to lay out pages and canvases."
---
# Designs for Design Chamber

Design Chamber shows the designs saved in the user's designs folder inside OpenChamber. Follow this skill whenever you make or change one.

- The designs folder is named in the Design Chamber note in your instructions. Without that note, ask the user where their designs folder is (the default is ~/Documents/Designs).
- Every design is its own folder in the designs folder, <slug>/, never a loose file. The slug uses lower-case letters, digits and hyphens, starts with a letter or digit and is at most 63 characters. Pick a new slug for a new design, and never edit another design's folder unless the user asks.
- A page is one index.html shown full screen. A canvas is a wall of screens, screens/<id>.html, each shown at several device sizes side by side. Make a canvas when the user says canvas or the work has several screens, steps or boards.
- Write design.json first, then the HTML, then tokens.css, DESIGN.md and assets/. design.json holds "version": 1, "kind" ("page" or "canvas"), "title", "updated", "viewports", and "screens" for a canvas. In an existing design.json change only title, updated, viewports, screens, designSystem and tweaks, and keep every other key as it is.
- Set "updated" (and "created", when you write a new design.json) to the real current time, not a made-up one like midnight. Write the title in plain words, with no em dashes.
- When a design is ready, show it in the chat with a DesignCard block. To let the user pick between directions you made as separate design folders, ask with DirectionPick. Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall. Write each in a fenced openui-lang code block whose first line is root = Stack([...]): root = Stack([DesignCard("<slug>")]) or root = Stack([DirectionPick("Which direction?", "Bold|Calm", "pricing-a|pricing-b")]). A root without Stack([...]) is not drawn. DirectionPick takes the question, then the option labels and the design folder names, each list split by | in the same order.
- Work offline and check your work before you say you are done: both are below.
- Never touch .versions/, .chamber/, .thumb.png or .trash/ in a design folder.
- Style presets are in presets/<id>.md next to this file. Use one when the user picks it, or offer two or three when nothing settles the look: minimal-saas (Minimal SaaS), editorial (Editorial).

## Design rules

<!-- BEGIN rules/DESIGN-RULES.md (verbatim) -->
(rules/DESIGN-RULES.md text appears here)
<!-- END rules/DESIGN-RULES.md -->

## Questions to ask

<!-- BEGIN rules/QUESTIONS.md (verbatim) -->
(rules/QUESTIONS.md text appears here)
<!-- END rules/QUESTIONS.md -->

## Rendering constraints

Design Chamber shows your files offline, inside a sandboxed frame. So:

- Everything works with no network: no CDN scripts, Google Fonts or other web fonts, remote images or analytics. Bundle fonts and images in `assets/` (fonts in `assets/fonts/` with `@font-face`, and end every font stack with a generic family).
- Remote files are blocked and listed back to you when the user sends comments.
- Reference local files statically with relative paths: `assets/hero.jpg` and `tokens.css` from index.html; `../assets/hero.jpg` and `../tokens.css` from `screens/*.html`. URLs built at runtime (`new Image().src = "assets/x.png"`), `fetch()` / XHR of local files and ES-module imports across files do not load.
- Small inline `<script>` interactions work (clicks, tabs, toggles). `localStorage` works and is kept per design (up to 1 MB), so saved ticks and filters survive a reload; `sessionStorage` lasts until the screen reloads. There is no `top.location`, `window.open`, cookie, IndexedDB or network call.
- Link between screens with `<a href="other-screen.html">` (a sibling file in `screens/`) or `data-dc-goto="<screenId>"`. Links to `#anchors` work; an external https link asks the user before it opens.
- Give meaningful elements stable hooks (`id`, `data-screen`, semantic class names): comments are pinned to elements by selector and travel with it.
- One responsive file per screen: the wall renders it at every viewport in design.json.

## Check your work

Check the design with the design_check tool after each change, before you say you are done. If you don't have that tool, look for the check command in the Designs folder's AGENTS.md and run it with the design's folder name. If there is none, read your HTML once more for overflow, contrast, alt text and labels.

The check renders every screen at every viewport in design.json, saves PNGs in the design's .chamber/check/ folder and lists what it found: files that don't load, content wider than the viewport, cut-off or overlapping text, low contrast, images without alt text, fields without labels, script errors. Fix every error, open the PNGs to see the result, and check again. If the check says no browser was found, it still checks the files; say in your reply that the design was not rendered.
