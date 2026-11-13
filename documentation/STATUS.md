# Project status, 2026-11-12

## State
- **Phase 1.5 (OpenChamber SDK 2.7) is merged to `master`** (PR #17). Version `0.2.0`; needs OpenChamber
  2.7.0 or later.
- **Phase 2 ("edit on the canvas") is built on `feat/phase-2`**, going to `master` as one PR (owner's
  decision). It turns the wall from a gallery into a canvas: edit text in place, tune tokens with
  sliders, manage screens, keep one of several directions, and keep page state across reloads.
- `npm run check` on `feat/phase-2`: about 2,400 tests, 0 fail, 2 platform skips, 0 todo.
- The Phase 2 PR carries the whole phase; the Opus code review and its merge-confidence score are
  posted on the PR. Merging is owner-only.

## What's built
Everything from v0.1 (rail navigator, full-screen page, pages with ZIP and single-file HTML export, the
canvas wall with pins, comments, versions, `/design`, `/page`, Open as page, design rules and presets,
thumbnails, theme-following UI), Phase 0 and Phase 1 (design checks and `dc check`, the build strip, the
ask bar, Send this, restore with Undo), Phase 1.5 (instructions note and built-in skill, `design_check`
tool, turn snapshots, session linking, Work Status, `@` mentions, DesignCard/DirectionPick blocks,
keep-your-place, Git-URL install), and Phase 2:

| Feature | Where the user sees it | Doc |
|---|---|---|
| Edit text in place: selection toolbar (Edit text / Comment / Ask agent) + inline editor, Undo | the wall and the page viewer | [Edit on the canvas](features/edit-on-canvas.md) |
| Tweaks panel: live preview, Save to tokens.css; page dock, rail bottom sheet | the wall and the page viewer | [Tweaks](features/tweaks.md) |
| Screen management: "+ Screen" board, screen menu (Duplicate, Move, Trash), drag reorder | the wall and the page viewer | [Screens and directions](features/screens-and-directions.md) |
| Direction rows: Current + A/B/C, Keep this one (page row, rail 2×2 grid) | the wall and the page viewer | [Screens and directions](features/screens-and-directions.md) |
| Saved page data: `localStorage` stand-in (1 MB per design), Clear saved page data | the wall and the page viewer | [Saved page data](features/saved-page-data.md) |
| Hand edits listed in the next message to the linked chat | the chat | [Agent instructions](features/agent-instructions.md) |
| Check fixes: false text-overlap warnings, broken-knob finding, empty storage in check renders | the Checks badge, `dc check`, `design_check` | [Design checks](features/design-checks.md) |

## Verification done
- Incremental QA, all PASS after fixes: C1 false-overlap fix (3 rounds), Q1 edit authority + text edit
  (E1–E12, the E1 frame-replay risk test), Q2 tweaks, Q3 screens + directions, Q4 saved page data
  (including the Clear race fixes), Q5 whole-phase integration.
- Live click-through (Sonnet, Playwright on OpenChamber's web UI, real extension + service + iframes):
  text edit + Undo, the live tweak repaint (artboards repaint without a reload, tokens.css untouched
  until Save), rail bottom sheet, screen duplicate/trash/drag, direction rows + Keep this one, and page
  data persistence + Clear. The Electron window itself and a real dark theme were not driven; the
  headless visual scenarios cover rail 320/480 + page 1400 in light and dark.
- Risk surfaces: the artboard sandbox is unchanged (`allow-scripts`, never `allow-same-origin`); the
  bearer token never reaches a frame, bundle or log; every new route is bearer-checked and contained;
  typed text stays text; hand edits are version-first, compare-and-swap, and undoable.
- Accepted minor issues: `documentation/known-issues.md` (KI-17 off-canvas parked text still gets a
  contrast warning; KI-18 a quick second edit can briefly show the user's own write as the agent's;
  KI-19 inline SVG text gets the "made by the page's script" reason).

## Waiting on you
1. **The Phase 2 PR** from `feat/phase-2` to `master`: review the Opus code review and merge (owner-only).
2. **Release:** bump the version and tag it to run `release.yml`. Exclude the `release` branch from the
   `master` protection rule first, or the workflow's push is refused.
3. **macOS and Windows:** the storage stand-in is confirmed on Linux Chromium; confirm it in OpenChamber's
   Electron on Windows and macOS (`docs/SPEC.md` §8.8). macOS is not in CI: run `npm run check` on the Mac.
4. **Hand tests:** `docs/testing/FEDORA.md` and `docs/testing/MACOS.md`.