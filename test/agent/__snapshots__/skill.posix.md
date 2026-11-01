---
name: design-chamber
description: "Use when the user asks for a design, mockup, wireframe, UI screen, landing page, prototype, HTML page or design canvas, or mentions the Designs folder, Design Chamber or a design studio. Explains where to save designs so Design Chamber shows them inside OpenChamber, and how to lay out pages and canvases."
metadata:
  generator: design-chamber
  version: "1"
  sha256: "1463c0c2827c6758cb0a36904ba9af9462dc9596c9993104b7fe84b12a48749b"
---

# Designs for Design Chamber

The user's designs folder is `/home/you/Documents/Designs`. Design Chamber shows what is saved there inside OpenChamber.

Read `/home/you/Documents/Designs/AGENTS.md` first and follow it. If it is missing, follow these points:

- Every design is its own folder, `/home/you/Documents/Designs/<slug>/`, never a loose file. The slug uses lower-case letters, digits and hyphens, starts with a letter or digit and is at most 63 characters. Use a new slug, and never edit another design's folder unless the user asks.
- A page is one `index.html` shown full screen. A canvas is a wall of screens (`screens/<id>.html`) shown at several device sizes side by side. Make a canvas when the user says canvas or the work has several screens or boards. A very tall page of board-like sections fits better as a canvas.
- Write `design.json` first, then the HTML, then `tokens.css`, `DESIGN.md` and `assets/`. design.json holds `"version": 1`, `"kind"` (`"page"` or `"canvas"`), `"title"`, `"updated"`, `"viewports"`, and `"screens"` for a canvas. In an existing design.json change only `title`, `updated`, `viewports`, `screens` and `designSystem`.
- Work offline: no CDNs, no Google Fonts or other web fonts, no remote images or scripts. Fonts go in `assets/fonts/` with `@font-face`, and every font stack ends with a generic family.
- Relative paths only: `assets/x.png`, and `../tokens.css` from `screens/`.
- Never touch `.versions/`, `.chamber/`, `.thumb.png` or `.trash/`.

If the user wants a fresh design with the full rules, suggest `/design <brief>` for a canvas or `/page <brief>` for a page.
