---
name: design-chamber
description: "Use when the user asks for a design, mockup, wireframe, UI screen, landing page, prototype or design canvas, wants something to look like their app, or mentions Design Chamber, the Designs folder, a design system or their pins. Covers where designs go, following the project, and design_list, design_read and design_check."
---
# Designs for Design Chamber

Design Chamber shows the user's designs inside OpenChamber. Follow this skill whenever you make or change one.

## What you can do

- design_list: the designs and design systems, newest first, and which design the user has open. Filter by project, kind or text.
- design_read: one design's open pins (with the element each points at), what the user has open in it, hand edits waiting, its system and the last check.
- design_check: render a design, save PNGs and list what to fix.
- /design and /page start a design with the rules attached. To build a design system with the user, use /design-system or the design-system-builder skill.
- When the user says "this", "the selected one" or "my comments", call design_read first. Without these tools, read the comments in design.json and .chamber/check.json yourself; never change either.

## How to work

- The Design Chamber note in your instructions names the designs folder. Without it, ask the user (the default is ~/Documents/Designs).
- Every design is its own folder, <slug>/ (lower-case letters, digits and hyphens, starting with a letter or digit, at most 63 characters), never a loose file. Use a new slug for a new design; never edit another design's folder unless the user asks.
- A page is one index.html shown full screen. A canvas is a wall of screens, screens/<id>.html, each at several device sizes. Make a canvas when the user says canvas or the work has several screens, steps or boards.
- Write design.json first, then the HTML, then tokens.css, DESIGN.md and assets/. design.json holds "version": 1, "kind" ("page" or "canvas"), "title", "updated", "viewports", and "screens" for a canvas. In an existing design.json change only title, updated, viewports, screens, designSystem, tweaks and folderRequest, and keep every other key as it is.
- Set "updated" (and "created" for a new design.json) to the real current time. Write the title in plain words, with no em dashes.
- A new design for a project follows the project: its own design system if Design Chamber has one, else its design files, components and screens. Read them before you draw.
- When the user points at a design system a project already has (a page, docs, components), read those first and build from what is there.
- When a design is ready, show it with a DesignCard block. To let the user pick between directions you made as separate design folders, ask with DirectionPick. Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall. Write each in a fenced openui-lang code block whose first line is root = Stack([...]): root = Stack([DesignCard("<slug>")]) or root = Stack([DirectionPick("Which direction?", "Bold|Calm", "pricing-a|pricing-b")]).
- Never touch .versions/, .chamber/, .thumb.png or .trash/ in a design folder.
- Design systems live in _systems/<id>/. Write there only when the user or Design Chamber asks you to make or change a system; never set its status. A design's copy of its system is its system/ folder: read it, never change it.
- A design task never writes a project's repo; a system's repo changes only from its own chat, after the user approves a diff.
- Folders are the user's tags in the library; nothing moves on disk. Only when the user asks, add a design to an existing folder with design.json "folderRequest": { "add": ["<name>"], "at": "<now>" } (or "remove"). The names are in .chamber/folders.json in the designs folder: read it, never write it. Never create, rename or delete folders.
- Style presets are in presets/<id>.md next to this file. Use one when the user picks it, or offer two or three when nothing settles the look: minimal-saas (Minimal SaaS), editorial (Editorial).

## Design rules

<!-- BEGIN rules/DESIGN-RULES.md, §4 in reference/design-practice.md (verbatim) -->
(rules/DESIGN-RULES.md text appears here)

## 4. Design best practices

In reference/design-practice.md next to this file: hierarchy, type, spacing, colour and contrast, layout, responsive, states, accessibility, motion, real content and character. Read it before your first screen.

## 5. File & technical rules

(the rest appears here)
<!-- END rules/DESIGN-RULES.md, §4 in reference/design-practice.md -->

## Questions to ask

Before a new design, read reference/questions.md next to this file: when to ask, how, and a first-reply template. In short:

- Read the brief, the project and the design folder first. Never ask what the files already answer.
- When a missing answer would change the design, ask once: 3 to 6 numbered questions in one message, each with a bold recommended default, then wait. Go ahead with an "Assumptions" list when the user said go, for a small edit, or when the project already settles it.
- Always settle the viewports: from the project, else recommend Laptop 1280×800 and Phone 390×844, and record them in design.json.
- When the look is open, offer two or three named directions in the same message and recommend one.

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
