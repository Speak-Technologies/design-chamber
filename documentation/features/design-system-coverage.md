# Design system coverage: four areas

**What it is:** A design system's twelve sections are grouped under four areas, so a system can say what it covers and the board, the panel and the living page say plainly what it leaves out.

| Area | Sections |
|---|---|
| Foundations | Overview, Colours, Typography, Spacing, Radius, Shadows, Layers, Sizes |
| Components | Components |
| Patterns & voice | Patterns & voice |
| Brand & marketing | Brand & marketing (brand guidance and logos), Assets (font files and source files) |

## What the agent writes
In `system.json`, all optional:
- `coverage`: the areas the system covers, for example `["foundations", "components"]`. Left out, the system covers all four, so every system written before areas existed reads exactly as it did. A value Design Chamber can't read (not a list, empty, an unknown or repeated area) is listed as a problem, "coverage in system.json can't be read, so all four areas are shown.", and all four are shown.
- `patterns[]` (up to 100): `id`, `kind` (`layout`, `do-dont`, `voice` or `other`), `title` (1 to 80 characters), `note` (up to 500). An optional longer text goes in `patterns/<id>.md`.
- `brand[]` (up to 100): the same fields with kinds `marketing`, `imagery`, `logo-use` or `other`; longer text in `brand/<id>.md`.

An entry that breaks a rule is listed as a problem on its own; the rest still show. Body text is always shown as text, never as markup.

## What the user sees
- The specimen board groups its sections under the four area headings, in the order above.
- Patterns & voice and Brand & marketing show each entry as a card: title, kind, note and the body in paragraphs. Logos now show under Brand & marketing; Assets lists the font files and source files.
- A section in an area the system doesn't cover says **Not covered by this system.** Anything the agent wrote there anyway is still shown underneath; nothing is hidden.
- Uncovered sections can't be reviewed and don't count in Mark ready's "N sections weren't reviewed".

## Rules
- Each section has its own fingerprint, so a review holds until that section changes: Patterns & voice changes with its entries or their bodies; Brand & marketing with its entries, bodies and logos (including a logo file's bytes); Assets with the fonts and source files.
- Hand edits can change an entry's title, note and kind, and write its body file, only for an entry already listed in `system.json`. New entries are the agent's.
- A design that links a system gets the pattern and brand bodies in its copy as reference for the agent. They never go into a ZIP or single-file export, and source files are never copied at all.

## Where it lives in the code
`src/shared/system-json.ts` (`coveredAreas`, `AREA_OF_SECTION`, the entry readers, `sectionFingerprints`), `src/shared/system-board.ts` (entry keys `pattern:<id>`, `brand:<id>`, logos under Brand), `src/service/systems/specimen-html.ts` (the section renderers the board and the living page share), `src/service/systems/board-html.ts` (area headings, board chrome), `src/service/systems/edit-meta.ts` and `edits-file.ts` (hand edits), `src/service/systems/link.ts` (`planCopy`), `src/service/export.ts` (`exportIncludes`). Tests: `test/shared/system-json.test.ts`, `test/service/systems/specimen-html.test.ts` (with the board snapshot in `__snapshots__/`), `board-html.test.ts`, `edits.test.ts`, `link.test.ts`, `link-export.test.ts`, `store.test.ts`.
