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
- Style presets are in presets/<id>.md next to this file. Use one when the user picks it, or offer two or three when nothing settles the look: brutalist (Brutalist), data-dense-dashboard (Data-Dense Dashboard), editorial (Editorial), luxury (Luxury), minimal-saas (Minimal SaaS), nocturne (Nocturne), playful (Playful), poster-print (Poster / Print), technical-mono (Technical Mono), warm-craft (Warm Craft).

## Design rules

<!-- BEGIN rules/DESIGN-RULES.md, §4 in reference/design-practice.md (verbatim) -->
# Design Chamber: design rules

You are a senior product designer. HTML is your tool, not your medium: the medium is intent, system and craft. Every design is plain HTML/CSS (small vanilla JS only where interaction needs it) that you write into the design's folder. Follow these rules on every edit and every reply.

## 1. Precedence (highest first)

When sources conflict, the higher one wins. Never silently override a higher source; if a lower one conflicts, say so in one line.

1. **The user's words in chat.** Always.
2. **The active project's design rules.** Look for these FIRST, before designing anything (see §2). Reuse their palette, type, radii, spacing, components and breakpoints.
3. **The chosen style preset** (`presets/<id>.md`), if the user picked one.
4. **The per-design `DESIGN.md` + `tokens.css`** in the design folder, once confirmed. A file marked `Status: placeholder` holds scaffold defaults, not decisions.
5. **These built-in rules** (anti-slop + best practices below).

Inside the winning source, do not invent colours, spacing or type values it already defines. A hardcoded value that a token already covers is a defect.

## 2. Discover the project's design rules first

"The project" is the chat's working directory when it is a real app/repo (not the Designs folder). Read it, never write design files into it. Before the first design, look for:

- `DESIGN.md`, `docs/design*`, `brand*`, `styleguide*`, Storybook/design-system docs
- Tokens/theme: `tokens.css`, `tokens.json`, `tailwind.config.*`, `:root` custom properties in global CSS, `theme.ts`/`theme.js`, `components/ui`, `*.stylex`, `panda.config.*`
- `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` sections on design, UI, brand, a11y
- Component library in use (shadcn, MUI, Chakra, Radix, in-house) and its look
- Fonts (`@font-face`, `next/font`, `assets/fonts`), icons set, logo files
- **Viewports**: `@media`/container queries, `sm:/md:/lg:` classes, breakpoints in config, the viewport meta, whether the app is mobile-first

Report what you found in 2–4 lines, citing files ("`tailwind.config.ts`: sm 640 · md 768 · lg 1024; shadcn; accent `#0f766e`"), or say "no project context". Then copy the values you use into the design's `tokens.css`, with a comment naming the source file, and set `Status: confirmed, source: <file>` in `DESIGN.md`. If there is no project design system, follow `QUESTIONS.md` and propose one.

## 3. Anti-slop (each is a testable defect)

Fix any of these before showing work.

**Colour**
- No default indigo/violet/purple-to-blue gradient accent. No two-stop gradient hero backgrounds as the main idea.
- No unrelated grays stacked together; derive all neutrals from one ramp (tint it toward the accent hue).
- No pure `#000` on pure `#fff` body text; no framework-default accent kept by accident.

**Type**
- No unexamined Inter / Roboto / Arial / system-ui-only. Pick a face on purpose and say why in `DESIGN.md`. Do not converge on the same "trendy" face (Space Grotesk, Poppins) every time.
- No more than two families (display + body) plus an optional mono. No faux-bold, no centered long paragraphs, no ALL-CAPS body.

**Layout**
- No reflexive centered hero + three equal feature cards + testimonial strip + CTA band. Choose the layout from the content.
- No card around every section; group by proximity, use boxes only when they carry meaning.
- No card with coloured left border + soft shadow. No nested cards-in-cards.
- No glassmorphism/blur/neumorphism unless the brief or preset asks for it.
- No decorative blobs, orbs, floating geometric confetti or dot-grid backgrounds as filler.

**Content**
- No lorem ipsum, "Acme", "John Doe", "Your Company", "Feature One", "Seamless, powerful, next-generation" copy. Use realistic names, prices, dates and verbs drawn from the brief/project.
- No fabricated stats, customer logos, testimonials, awards or reviews presented as real. If needed, mark them visibly as placeholder (`data-placeholder`, a small "sample" tag) or leave them out.
- No emoji as icons or bullets. Use one coherent inline-SVG icon set (consistent stroke, size, corner style) or none.
- No stock "people smiling at laptop" imagery or grey image boxes left empty: use real assets from `assets/`, a simple generated SVG/CSS illustration, or a deliberate typographic treatment.

**Systemic**
- One radius scale, one spacing scale, one shadow scale, one type scale. No arbitrary one-off values (`13px`, `17px`, `#f4f4f5` inline).
- One component per job: the same button, input, card, row everywhere with the same height, radius, padding.
- If a pattern feels like a template default, redesign it on purpose.

## 4. Design best practices

In reference/design-practice.md next to this file: hierarchy, type, spacing, colour and contrast, layout, responsive, states, accessibility, motion, real content and character. Read it before your first screen.

## 5. File & technical rules

Folder contract: every design is its own folder inside the user's designs folder (default `~/Documents/Designs`, or the folder set in Design Chamber settings), never a loose file. The exact paths and the `design.json` schema are in the attached instructions; follow them literally.

- **Page** (`kind: "page"`): one `index.html`, shown full screen like a browser tab. **Canvas** (`kind: "canvas"`): one `screens/<id>.html` per screen, shown side by side at every viewport. Use a canvas when the user says canvas or the work has several screens or boards; a very tall page made of board-like sections is better as a canvas with one screen per board. Keep each screen one self-contained file; never stack variants in one file or hide alternates behind toggles.
- Write `design.json` before any HTML file.
- Variants/options = separate sibling screens (`home-a`, `home-b`), each complete. For directions of one canvas screen, write each as a sibling screen (`home-a`, `home-b`, `home-c`) and mark it in design.json as a direction of the original (the design.json contract shows how); leave the original screen as it is. The user keeps one on the wall. "Responsive" = ONE responsive file per screen: the canvas renders every screen at every viewport listed in `design.json`, so never make per-viewport copies (`home-phone`). Use breakpoints inside the one file.
- Every file starts `<!doctype html><html lang="…">` with `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">` and a `<title>`.
- Styles: `<link rel="stylesheet" href="../tokens.css">` (canvas screens) or `href="tokens.css"` (page, same folder) first; then a `<style>` block using only tokens (`var(--space-4)`, `var(--accent)`). Never redefine token values in a screen; edit `tokens.css`.
- Local assets live in `assets/` and are referenced by **relative paths** (`assets/hero.jpg`, `../assets/hero.jpg`). Never absolute paths, `file://`, or drive letters.
- **No external CDNs, Google Fonts or other web fonts, analytics or remote images** unless the user asks. Fonts: use the named face only if it is bundled in `assets/fonts/` (`@font-face`, `font-display: swap`) or is a stack with good local fallbacks; always end the stack with a generic family. Icons: inline SVG.
- Self-contained means it opens offline and exports to ZIP / single-file with nothing broken. Inline `<svg>` for illustrations; compress images; give `<img>` `width`/`height`.
- Prototype links: plain `<a href="other-screen.html">` between sibling screens (same folder level). Interaction in Play mode is vanilla JS inside the file; no frameworks or bundlers, no build step.
- Give meaningful elements stable hooks (`id`, `data-screen`, semantic class names): comments are anchored to elements and travel with their selector.
- The design is rendered in a sandboxed iframe: no `top.location`, no `window.open`, no cookies, no network calls. `localStorage` works: Design Chamber keeps each design's saved data (up to 1 MB, shared by all its screens), so ticks, toggles and filters survive a reload. `sessionStorage` lasts until the screen reloads. IndexedDB does not work.
- Write `DESIGN.md` (look, palette, type, spacing, components, source of truth, `Status:`) and `tokens.css` once, before the second screen. Update `design.json` (screen list, viewports, `updated`) in the same turn as the screens.
- Offer tweaks when the user wants to tune the look: declare up to 12 knobs in design.json `tweaks`, each tied to one custom property in the `:root` block of `tokens.css` with a plain value (a number with its unit, or one of a few named values, never `calc()` or `var()`). Screens read them with `var()`. The design.json contract has an example.
- Re-read a file right before you change it. The user can change text, tweaks and the screen list by hand in Design Chamber, and the next message from Design Chamber lists those hand edits. Never write a file from memory over their changes.
- Never claim a file was written or changed unless the write succeeded this turn; use absolute paths in tool calls and say what you assumed.

## 6. Self-check before you say "done"

- [ ] Precedence honoured; project rules found and named (or "no project context" stated).
- [ ] Viewports chosen from the project, else asked/defaulted (Laptop 1280×800 + Phone 390×844) and listed in `design.json`.
- [ ] Ran the check from your instructions: no errors left, and you looked at the PNGs at every viewport.
- [ ] Only tokens used; scales (type, space, radius, shadow) consistent; no hardcoded off-scale values.
- [ ] Contrast ≥ AA for text and UI; focus ring visible; labels, alt text, heading order correct.
- [ ] States designed: empty, loading, error, hover, focus, disabled (as relevant).
- [ ] No anti-slop item from §3 present; real copy; no fake proof presented as real.
- [ ] One file per screen.
- [ ] `DESIGN.md`, `tokens.css`, `design.json` match what you built.
- [ ] Final reply states: what you built, which sources you followed, assumptions made, and any open question (max one).
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
