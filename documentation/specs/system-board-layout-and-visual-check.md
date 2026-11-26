# System board layout hints and the visual system check (technical design)

Status: built (main-agent decisions on the Open Questions: no `wide`; visual findings stay off the system page's
Checks badge; the waiting proposal's board is drawn; a layout-only edit is a new revision; the living page follows
the hints; widths 1526 and 1046). Deviations found while building are marked **Built** below. One PR on `feat/system-board-layout-and-visual-check` (stacked on `12b4b8d`, which put
board components in 600px-min content-sized columns and added the board script that widens a card whose
preview is too wide). Two user-approved features:

- **A. Layout hints.** The system-building agent says, per section and per entry, how the specimen board
  lays an entry out. Design Chamber still owns the board; the agent picks from a closed set.
- **B. Visual system check.** `dc check --system <id>` (and `design_check { "system": id }`, which runs the
  same CLI) draws the board in headless Chrome the way the system page shows it, saves PNGs, and adds
  measured findings. The service route stays static.

Authorities: `docs/SPEC.md` §6.7 (system contract), §9.9 (checks); `documentation/specs/phase-2-5-technical.md`
§5.7 (board), §5.11 (living page), §10 (system checks); `documentation/specs/agent-render-and-check.md` (the
render engine). Everything below was verified against the code on this branch; file paths are real unless
marked **new file**.

---

## 0. Decisions in one place

| # | Decision | Why |
|---|---|---|
| D1 | Values: `card` (default), `compact`, `full`, `table`. No `wide`. | The board's component flow is CSS multi-column (12b4b8d, approved so short cards are not stretched to a tall neighbour). Multi-column can span one column or all of them, never two. Below a ~2 300px window the board has at most two component columns, so "wide (two columns)" would draw exactly like `full`. Two names for one look is noise for the agent. See Open Question 1. |
| D2 | Item key `layout` on `components[]`, `notes[]`, `patterns[]`, `brand[]`; section defaults in a top-level `layout` object keyed by section. | One word for one idea. Items carry their own; sections give the default. Token sections have no per-token hint (2 000 tokens; one hint per section is enough). |
| D3 | Unknown or misplaced value → ignored, entry falls back, one static warning `system-layout-invalid`. Never "entry couldn't be read". | The entry itself is fine; only the hint is ignored. Keeps the panel's "N entries couldn't be read" honest. |
| D4 | Layout is presentation: **not** part of section fingerprints. | A layout change must not reset the user's "Looks good" reviews. |
| D5 | Agent order is kept. Neighbouring entries with the same effective layout form one **run**; each run is one container. | The agent controls order and grouping; Design Chamber never reorders. |
| D6 | The living page honours hints in this PR. | It shares `renderSpecimenSection`; diverging board and page would confuse users. No false drift (§A.6). |
| D7 | The visual check renders at two board widths: **wide 1526px** and **narrow 1046px**, light scheme. | The full-screen board frame is `window − 360px side panel − 2×16px margin − 2px border` (`src/ui/styles.css` `.dc-syspg-panel`, `.dc-sys-board`). 1526 = a 1920px window (two component columns); 1046 = a 1440px window (one column). The rail (300 to 460px) is a glance and is not checked. |
| D8 | **Revised after QA.** Per area and width: one **overview** (the whole area scaled to about 4 000px tall, 0.2 to 0.5, stitched from per-band strips the browser draws at that scale) and full-size 900px **tiles** paid from a pixel budget (`SYSTEM_CHECK_TILE_PIXELS_MAX` 100 MP per run, half per width), bands with a finding first; ≤ 120 PNGs. Was: ≤ 4 tiles per area, ≤ 32 per run, which left two thirds of nexus unpictured. | The agent sees the whole board as the user does (overview for layout, tiles for detail); output stays bounded with an honest note. |
| D9 | `GET /systems/:id/checks` and the `checks` chat prompt stay static. | Drawing a board costs 5 to 40s of headless Chrome per call; the route runs on every system page load. The agent gets the visual findings from the CLI, which the fix prompt already tells it to run. Open Question 2. |
| D10 | When a repo-backed system has a current proposal waiting, the check draws the **proposed** board; otherwise the live board (`filesDir`: the internal folder or the snapshot). | During a repo build the snapshot is empty until the user approves; the proposal is what the agent is about to ask the user to approve. Open Question 3. |
| D11 | Reuse the design check's engine: `renderArtboards` (browser, CSP, Fetch interception, timeouts, restarts) gains one optional `inspect` hook; the run-folder/PNG/cleanup code in `engine.ts` is extracted once and shared. | No second browser driver, no copied run-folder code. |

---

## A. Layout hints

### A.1 Data changes (`system.json`, schema unchanged: `design-chamber/system@1`)

Additive and optional; old systems read exactly as before (absent everywhere = today's board).

```jsonc
{
  "layout": { "components": "compact", "patterns": "table", "colours": "table" },   // section defaults
  "components": [
    { "id": "button", "name": "Button", "example": "components/button.html" },          // compact (section)
    { "id": "table",  "name": "Data table", "example": "components/table.html", "layout": "full" },
    { "id": "modal",  "name": "Modal", "example": "components/modal.html", "layout": "card" }
  ],
  "notes":    [{ "id": "grid", "title": "Grid", "layout": "full" }],
  "patterns": [{ "id": "empty", "kind": "do-dont", "title": "Empty states", "layout": "card" }],
  "brand":    [{ "id": "press", "kind": "marketing", "title": "Press", "layout": "full" }]
}
```

Which values each place takes (`LAYOUTS_OF_SECTION`, exported from `src/shared/system-json.ts`):

| Where | Section default (`layout.<section>`) | Per entry (`layout`) |
|---|---|---|
| `components` | card, compact, full, table | `components[i].layout`: same four |
| `overview` (applies to `notes`; the overview text itself is always full width) | card, compact, full, table | `notes[i].layout`: same four |
| `patterns` | card, compact, full, table | `patterns[i].layout`: same four |
| `brand` (applies to brand entries; logos keep today's cards) | card, compact, full, table | `brand[i].layout`: same four |
| `colours`, `spacing`, `radius`, `shadows`, `sizes` | card, compact, table | none |
| `typography`, `layers`, `assets` | none (fixed rows / diagram / list) | none |

Effective layout of an entry = its own valid `layout` ?? the section's valid default ?? `card`.

**Types** (`src/shared/types.ts`, a WP0 file: the main agent applies or authorises it and notifies lanes):

- `export type BoardLayout = 'card' | 'compact' | 'full' | 'table';`
- `SystemComponent.layout: BoardLayout | null` (null = not set on the entry).
- `SystemEntryText.layout: BoardLayout | null`.
- `SystemDetail.notes[number].layout: BoardLayout | null`.
- `SystemDetail.boardLayout: { sections: Partial<Record<SystemSection, BoardLayout>>; ignored: { entry: string; value: string; reason: 'unknown' | 'not-here' }[]; ignoredCount: number }`
  (`entry` like `components.table`, `layout.typography`, `layout`; `value` is the agent's text, one line,
  clipped to `BOARD_LAYOUT_TEXT_MAX`; `ignored` capped at `SYSTEM_LAYOUT_PROBLEMS_MAX`, `ignoredCount` is the
  true total).
- `CheckCode` gains the seven codes of §B.6; `CheckParams` gains `layout?: BoardLayout`.

**Limits** (`src/shared/limits.ts`, WP0): `BOARD_LAYOUT_TEXT_MAX = 16`, `SYSTEM_LAYOUT_PROBLEMS_MAX = 20`.

### A.2 Parsing (`src/shared/system-json.ts`)

New pure helpers, same tolerant style as the readers there (own properties only, never throws):

- `BOARD_LAYOUTS: readonly BoardLayout[]`, `LAYOUTS_OF_SECTION: Readonly<Partial<Record<SystemSection, readonly BoardLayout[]>>>`,
  `isBoardLayout(value): value is BoardLayout`.
- `readItemLayout(value: JsonValue | undefined, entry: string, ignored): BoardLayout | null`: absent or
  `null` → null; a string in `BOARD_LAYOUTS` → it; anything else (wrong type, unknown word, over 16 chars,
  control characters) → null plus one `ignored` record (`reason: 'unknown'`, `value` = the string cleaned to
  one line and clipped, or the JSON type name such as `number` for a non-string).
- `readSectionLayouts(raw, ignored)`: `layout` absent → `{}`; not an object → `{ entry: 'layout', reason: 'unknown' }`;
  for each own key: not a `SystemSection` → `layout.<key clipped to 40>` unknown; a section with no layouts
  (typography, layers, assets) or a value outside that section's list → `not-here`; a value not a layout at
  all → `unknown`.
- `readComponents`, `readNotes`, `readEntryTexts` set `layout` from `readItemLayout`. A bad hint never drops
  the entry and never pushes to `problems`.
- `buildSystemDetail` fills `detail.boardLayout`.
- `effectiveLayout(detail, section, itemLayout): BoardLayout` (pure, exported; the renderers use it).
- **`sectionFingerprints` is not changed**: its fact lists are explicit field lists, so `layout` stays out.
  A test pins this (§T).

Edits from the panel (`src/service/systems/edit-meta.ts`) keep unknown keys already, so a user's hand edit of
a component note keeps the agent's `layout`. No change there; a test pins it.

### A.3 Rendering: runs (`src/service/systems/specimen-html.ts`)

One helper splits a list into runs of consecutive entries with the same effective layout, in the agent's
order. Each run is one container; class names are ours (never the system's), every text stays escaped as
today.

| Layout | Components | Notes / patterns / brand entries | Token sections |
|---|---|---|---|
| card | `<div class="dc-grid dc-components dc-run-card">`, cards as today | `<div class="dc-grid dc-text-grid">` as today | `<div class="dc-grid">` as today |
| compact | `<div class="dc-grid dc-components dc-run-compact">` | `<div class="dc-grid dc-text-grid dc-run-compact">` | `<div class="dc-grid dc-run-compact">` |
| full | `<div class="dc-run-full">`, one card per row | same | not allowed |
| table | `<div class="dc-run-table" role="table" aria-label="…">`, a header row then one row per entry | same | same |

Table markup (divs with ARIA roles, so the living page allowlist, hit-testing and the board script all work):

- Header: `<div class="dc-thead" role="row">` with `role="columnheader"` cells.
  Components: Name · Preview · Notes. Text entries: Title · Guidance · Note. Tokens: Sample · Token · Note.
- Row: `<div class="dc-trow" role="row" data-dc-entry="…">` (the entry attribute moves from the card to the
  row, so click-to-select, scroll-to and highlight keep working), cells `<div class="dc-tcell dc-tcell-<name|preview|notes>" role="cell">`.
- Component rows put the example part (`options.example`) in the preview cell; name, purpose in the name cell;
  note, variants, states, tokens, source in the notes cell. Token rows put the existing grounds/visual in the
  sample cell, `tokenText` pieces in the token and note cells. Colour groups keep their `<h3>` headings; runs
  are formed inside each group.

Widen targets: every component card in a card or compact run and every component table row also carries the
class `dc-fit` (a class, not a `data-` attribute: the living page allowlist has no `data-*` beyond the two
marks it strips). Text entries and token entries carry no `dc-fit` (no live preview to measure).

### A.4 Board CSS and script (`src/service/systems/board-html.ts`, presentation, same builder)

Bump `BOARD_GENERATOR_VERSION` to 5 (cached boards are re-made; the base branch's grounds and re-measure fix took 4). Colours, type and radius come only from the
board variables the page sends from the host theme (`--dc-board-bg`, `--dc-board-card`, `--dc-board-fg`,
`--dc-board-muted`, `--dc-board-border`, `--dc-board-radius`, `--dc-board-font`, with the existing
`FALLBACKS`); no new colour or typeface.

Rules (the builder writes the CSS; these are the acceptance points):

1. `dc-run-card` keeps 12b4b8d exactly (column-width 600px, `break-inside: avoid`, `.dc-wide` spans all).
2. `dc-run-compact` inside components: same column flow with `column-width: 280px`, card padding 12px.
   Token and text compact grids: `minmax(120px, 1fr)` and `minmax(200px, 1fr)`; token swatches 32px tall.
3. `dc-run-full`: one column, 16px gap, cards full width.
4. `dc-run-table`: CSS grid, three columns `minmax(160px, 1fr) minmax(0, 3fr) minmax(160px, 1.2fr)`; rows
   use `grid-template-columns: subgrid` so cells align; 1px `--dc-board-border` row rules; header text in
   `--dc-board-muted`. Under 760px of section width (a container query on `.dc-section`,
   `container-type: inline-size`) rows stack their cells.
5. A widened table row (`.dc-trow.dc-wide`) leaves the subgrid: name and notes cells side by side on top, the
   preview cell under them spanning the row.
6. Light and dark grounds stack (`flex-direction: column`) in every run, so each preview gets the whole
   width. (Built: the base fix 64c0687 stacked them everywhere and that decision was kept over an earlier
   "side by side in an unwidened card-run card".)
6a. Neighbouring runs stand 16px apart (`margin-top` on a run that follows a run or a loose card, and on a
   loose card that follows a run): a column flow drops its last card's bottom margin, so two runs touched.
   The living page carries the same rule. The first `.dc-body` in a table cell drops its top margin so a
   text table's guidance starts level with its title.
7. Cards in every component run keep `overflow: hidden` and `.dc-example { overflow-x: auto }` (12b4b8d).

Board script (`BOARD_SCRIPT`), changed:

- Measures `.dc-fit` elements (was `.dc-components > .dc-card`) with the same `wider()` rule.
- Runs `widen()` at script time, again on `window` `load` (images inside examples finish loading after the
  script ran), after `document.fonts.ready` (a late font changes widths), when `<html>`'s inline style
  changes (the host sets tokens there), and on resize, coalesced into one animation frame (built on the base
  branch, 22c5621).

### A.5 Agent-facing docs

All under the skill cap: the built skill is 17 393 of `SYSTEM_SKILL_TEXT_MAX` 24 000 characters today; the
additions below are about 1 400. The existing length test guards it.

- `src/shared/agent/system-rules.ts` `systemContractSection()` (feeds both RULES.md and the builder skill),
  one bullet after the `components` bullet, in this spirit (final words by the builder, plain, no em dashes):
  "Board layout: give a component, note, pattern or brand entry a `layout`, or set a section default in a
  top-level `layout` object such as `{ "components": "compact", "colours": "table" }`. `card` is the default.
  Use `compact` for small pieces such as buttons, badges, pills and avatars; `full` for wide ones such as
  tables, navigation, toolbars and page headers; `table` for long lists read row by row (name, preview,
  notes). Colours, spacing, radius, shadows and sizes take card, compact or table; typography, layers and
  assets take none. Unknown values are ignored with a warning. Entries with the same layout next to each
  other share a row of cards, so keep them together."
- Same function, the `components` bullet gains: "Examples must fit their card: no fixed widths wider than
  the card, no `100vw`, no `position: fixed`."
- `checkLines()` (RULES.md) and `checks()` in `src/shared/agent/system-skill-doc.ts`: "The check draws the
  board at two widths and saves pictures under the system's `.chamber/check/` folder; the output lists them.
  Look at them, then fix what it lists: change the example or the entry's layout."
- `src/shared/agent/system-prompts.ts`: the make prompt's last line and `buildSystemChecksPrompt`'s tail say
  the check saves board pictures to look at. Fit is still enforced by `fitOrThrow`/`maxChars`.
- `src/plugin/check-tool.ts`: `TOOL_INPUT.properties.system.description` loses "(files only)" and says it
  draws the board; `static` says it skips the browser for designs and systems.
- `src/service/check/report-text.ts` `USAGE`: `--system` line says it draws the board and saves PNGs under
  `<system>/.chamber/check/`; `--static` applies to both.

### A.6 The living page (`src/service/systems/living-html.ts`)

It renders through `renderSpecimenSection`, so it gets runs and table markup with no extra code. Add the
matching rules to `FRAME_CSS` (fixed greys as the rest of that block; plain grid, no `url(`, no escapes, so
`livingCssProblems` passes): component card runs keep today's `minmax(320px, 1fr)` grid, compact
`minmax(200px, 1fr)`, full one column, table rows as §A.4 rule 4 with `@media (max-width: 720px)` stacking
instead of a container query. No board script there: examples are PNG `<img>`s with `max-width: 100%`, so a
wide one scales down and is never clipped.

Drift consequences, checked against `committedStateOf` (`src/service/systems/living-page.ts:213`):
- A committed page is judged by its own mark's hash, not by regenerating it, so this generator change does not
  turn existing committed pages into `changed`. They stay `fresh` until the system's revision moves.
- A layout-only edit changes `system.json`, bumps the revision (tree hash), so the committed page reads
  `out-of-date` and the staged page is regenerated, like any other system edit. Linked designs see "a newer
  system exists" the same way (Risks, Open Question 4).
- `stripEntryMarks` already strips `data-dc-entry` from table rows; no other `data-*` is added.

---

## B. Visual system check

### B.1 Data flow (one line)

Agent runs `dc check --system <id>` (or the tool, which spawns the same CLI) → `resolveSystemTarget` contains
`_systems/<id>` → static findings as today → the board is assembled from the same detail and files the page
uses (or the waiting proposal's) → headless Chrome over a pipe draws it at 1526px and 1046px under the guest
CSP, offline → the probe measures in an isolated world → Node verdicts → PNG tiles and `check.json` under
`<system>/.chamber/` → text/JSON on stdout listing findings and PNG paths.

### B.2 Board source (shared by the page and the check)

**New file** `src/service/systems/board-assemble.ts` (no `ServiceContext` import, so the CLI bundles it):

- `assembleBoardHtml(detail: SystemDetail, source: FileSource, scheme): Promise<{ html: string; components: SystemComponent[]; assetKeys: string[] }>`:
  the body of `createBoardService().render` that bundles each example on its own (`components/<id>.html`,
  export mode), checks fonts and logos with `checkAsset`, and calls `buildBoardHtml`. Moved, not copied.
- `overlaySource` moves here; `board.ts` re-exports it (`living-page.ts` and others keep their import).
- `readProposalBoardSource(store, id): Promise<{ detail; source; proposalId } | null>`: the proposal read of
  `board.ts` `readProposal`, without the `ApiError` (null when no current proposal or no `proposal/` folder;
  `proposalDirOf` keeps its containment). `board.ts` calls it and throws its `not-found` on null.

`board.ts` keeps caching, chunking and `ApiError` mapping; its behaviour does not change (existing
`board-routes.test.ts` stays green).

The check bundles the board document with `bundleDocument(overlaySource(source, html), BOARD_ENTRY_FILE, { mode: 'export' })`
(no bridge placeholder, as the design check does). Layout is identical to the page; only the theme differs:
fallback light colours and `system-ui` instead of the host font (Risks).

### B.3 Render pipeline

`src/service/check/render.ts`, extended, not forked:

- `RenderDeps.inspect?: (page: InspectPage, art: PlannedArtboard) => Promise<InspectResult | null>`.
  Absent → today's design behaviour, byte for byte. Present → after `SETTLE_EXPRESSION`, `renderOne` hands
  the page to `inspect` instead of the design probe and slicing, then adds the usual console, dialog and
  blocked-request findings.
- `InspectPage` = `{ evaluate(expression, { awaitPromise }): Promise<unknown>` (isolated world, `returnByValue`,
  8s timeout), `scrollTo(y)` (scroll then two frames), `capture(clip: { y, height }): Promise<Buffer>` (PNG,
  `clip` in document coordinates, `scale: 1`), `save(label, part, parts, bytes): Promise<string>` }. Every
  method calls the existing `guard()` after its await, so a timed-out artboard is abandoned as today.
- `InspectResult` = `{ findings: CheckFindingData[]; docHeight: number; pngs: string[] }`. `null` →
  `render-failed` "The page could not be measured." as today.
- `savePng` gains an optional `label` that replaces `artboard.screen` in `pngStem` (the area id), so names are
  `components@wide.png`, `components@wide-2.png`; `pngNames` keeps them unique case-insensitively.

`src/service/check/engine.ts`: extract the render-run plumbing (`ensureChamberDir`, work dir via
`thumbWorkParent`/`removeStaleWorkDirs`, `newRunId`, `createRunDir`, writing PNGs, dropping orphans, removing
an empty run folder, `cleanupRuns`, `CheckInterrupted` on abort, removing the work dir) into one exported
helper used by `runCheck` and the system run. `engine.test.ts` stays green unchanged.

`src/service/check/output.ts`: `ensureNormalFolder`'s refusal names the owner ("This design's" / "This design
system's"); everything else is reused as is (`createRunDir`, `writePng`, `pngRelOf`, `cleanupRuns`).

The plan for one system run (`src/service/check/system-run.ts`, `runSystemCheck(store, id, { now, tool, render? })`):

1. Static findings exactly as today (`systemFindings` + `s8Findings`, now with `system-layout-invalid`).
2. `render` absent (the route, `--static`) → `report.render = null`. Done.
3. Pick the source (D10): `readProposalBoardSource` when the home is a repo and a current proposal exists,
   else `store.detail(id)` + `createLiveFileSource(await store.filesDir(id))`.
4. `browserPath === null` → `render = { state: 'unavailable', …, findings: [browser-missing] }`, no PNGs.
5. `assembleBoardHtml(detail, source, 'light')`, then bundle. `BundleTooLarge` → one `render-failed`
   (`file: 'board.html'`, detail `over 60 MB`), no browser started.
6. `renderArtboards` with a plan of one artboard per width (`file: 'board.html'`, `screen: null`, viewport =
   the width entry), `loadDocument` answering the one bundled document, `knownExternal` = every example's
   remote refs (already reported by `system-example-remote`), `artboardTimeoutMs = SYSTEM_CHECK_BOARD_TIMEOUT_MS`,
   `runBudgetMs = SYSTEM_CHECK_RENDER_BUDGET_MS`, and `inspect` = §B.4.
7. Findings from both widths go through `dedupeBoardFindings` (§B.6), then `capPerCode` with
   `SYSTEM_BOARD_FINDINGS_PER_CODE`, then the overall `CHECK_FINDINGS_MAX`.
8. Write the report (`writeSystemCheckReport`, atomic, last) and clean old runs.

Limits (`src/shared/limits.ts`, WP0):

| Constant | Value | Bounds |
|---|---|---|
| `SYSTEM_CHECK_BOARD_WIDTHS` | `[{ id: 'wide', label: 'Wide board', width: 1526, height: 900 }, { id: 'narrow', label: 'Narrow board', width: 1046, height: 900 }]` | widths drawn (D7) |
| `SYSTEM_CHECK_TILE_PIXELS_MAX` (built; replaced `SYSTEM_CHECK_TILES_PER_AREA` 4) | 100 000 000 | full-size pixels per run, half per width |
| `SYSTEM_CHECK_PNGS_MAX` (built; was 32) | 120 | overviews and tiles, half per width |
| `SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX` / `_SCALE_MIN` / `_SCALE_MAX` (built) | 4 000 / 0.2 / 0.5 | overview size |
| `SYSTEM_CHECK_ENTRY_TILES_MAX` (built) | 2 | tiles taken first per entry with a finding |
| `SYSTEM_CHECK_OPTIONAL_TILES_TIME_SHARE` (built) | 0.6 | after this share of a width's time, only strips and finding tiles |
| `SYSTEM_CHECK_BOARD_TIMEOUT_MS` | 45 000 | one width |
| `SYSTEM_CHECK_RENDER_BUDGET_MS` | 110 000 | whole render; the tool kills at 180 000 |
| `SYSTEM_BOARD_ITEMS_MEASURED_MAX` | 1 000 | entries the probe measures |
| `SYSTEM_BOARD_TEXT_NODES_PER_ITEM` | 50 | text nodes per entry |
| `SYSTEM_BOARD_PREVIEW_ELEMENTS_MAX` | 400 | elements per preview |
| `SYSTEM_BOARD_FINDINGS_PER_CODE` | 20 | per board code |

### B.4 The board probe and the tiles

**New file** `src/guest/probe/board.ts`, `collectBoard(options)`, re-exported from `src/guest/probe/probe.ts`
so the existing `__dcProbe` bundle (`scripts/build.mjs` step 1b, embedded as `__DC_PROBE__`) carries it: no
build change. It runs in the `dc-probe` isolated world, reads geometry, writes nothing, returns plain data:

```ts
type BoardProbe = {
  innerWidth: number; scrollWidth: number; scrollHeight: number;
  areas: { area: string; top: number; height: number }[];          // from [data-dc-area], ≤ 4
  items: {
    entry: string;                                                   // data-dc-entry, '' when absent
    widened: boolean;                                                // has the dc-wide class
    box: { x: number; y: number; w: number; h: number };             // document coordinates
    previews: { w: number; scrollW: number; contentRight: number;   // per [data-dc-example-host], ≤ 2
                outLeft: number; outTop: number; outBottom: number }[];
    textOut: number;                                                 // light-DOM text beyond the entry box, px ≥ 0
  }[];
  truncated: boolean;
};
```

- Items are `[data-dc-entry]` elements in document order, up to `SYSTEM_BOARD_ITEMS_MEASURED_MAX`.
- A preview's `contentRight` is the furthest right edge of any element in its open shadow root minus the
  host's left edge (the board script's `wider()` rule, written once more in TypeScript because the probe
  cannot call page script). `out*` are how far any shadow element reaches past the **entry's** box on that
  side (≥ 0). Elements with no box, under 1px in both directions, `display: none`, `visibility: hidden` or
  hidden with the clip patterns are skipped, using the probe's existing `visuallyHidden` helper
  (`src/guest/probe/probe.ts:284`, module-private today: export it, unchanged).
- `textOut` scans the entry's own text nodes (not shadow content) with `Range.getClientRects`, like
  `textLines`, and takes the furthest any line reaches past the entry's box.

The probe runs after settle (fonts, two frames, 400ms), so after the board script's last `widen()`.
**Built differently:** forced layout lays out the entries of a `content-visibility: auto` section but leaves
the section itself at its 480px placeholder and unpainted, so on a real system (nexus) the Components area
measured 571px and its first tile was blank. The check therefore builds the board with
`BoardHtmlOptions.eager` (`.dc-section { content-visibility: visible; }` after the chrome CSS); the page keeps
`auto`. The e2e puts Components below the fold and asserts a full first tile and no blank tile.

`textOut` measures the whole text node first; only when that reaches past the box are the node's words
(runs of non-space characters, at most 400 per node, past which the whole figure stands) measured one by
one. A `pre-wrap` line that wraps at a space leaves the space hanging past the line, which in a table row's
last cell (no right padding) read as 1 to 2px of text outside.

**New file** `src/service/check/board-analyze.ts` (pure): `sanitizeBoardProbe(value): BoardProbe | null`
(types, finite numbers within ±1e7, strings clipped, arrays capped; anything else → null) and
`analyzeBoard(probe, ctx): CheckFindingData[]`, where `ctx = { width: BoardWidth; widest: boolean; layoutOf(entry): BoardLayout; fileOf(entry): string }`.
`fileOf` answers `components/<id>.html` for a component entry and `board.html` otherwise; `layoutOf` comes
from the detail through `effectiveLayout`. Entry keys are kept only when `isBoardEntryKey` passes.

**Built (revised after QA):** `planBoardPictures` (`src/service/check/board-pictures.ts`, pure) cuts each shown
area into 900px bands, gives every band an overview strip (until the overview's reach) and a full-size tile
while the width's pixel and PNG budgets last, taking the bands that show an entry with a finding first (at
most `SYSTEM_CHECK_ENTRY_TILES_MAX` per entry). The inspect hook scrolls once per band, captures the strip
(`clip.scale`) and the tile, and `stitchPngs` (`src/service/check/png-stitch.ts`: 8-bit RGB/RGBA, bounded,
zlib only) stacks the strips into `<area>-overview@<width>.png`. After 60% of a width's time only strips and
finding tiles are still taken. The report gains `shots[].{heightPx, overview, tiles}` and `entryShots`;
the CLI text prints the run folder once and appends "Picture: …" to each entry finding. Partial notes are
one per kind (`params.pictured`: `tiles`, `overview`, `entries`). The text below is the original plan.

Tiles (`inspect` after the probe): for each area the Node side considers shown (covered, or holding entries;
an uncovered empty area only says "Not covered"), tiles start at the area's top and step 900px, at most 4. For
each: `scrollTo(tileTop)`, `capture({ y: tileTop, height: min(900, areaBottom − tileTop) })`, `save(area, n, parts)`.
An area taller than 3 600px gives one `system-board-partial` note with `params.area`.

### B.5 Report (`<system>/.chamber/check.json`)

`SystemCheckReport` in `src/service/check/system-static.ts` (not a WP0 file) gains a render part; `version`
stays 1 (no reader parses this file today; the field is additive):

```ts
render: {
  state: RenderCheckState;                      // done | partial | unavailable | failed
  browser: CheckBrowser | null;
  drawn: { from: 'system' | 'proposal'; proposal: string | null };
  widths: ArtboardCheck[];                      // screen null, viewport 'wide' | 'narrow', pngs in area order
  shots: { width: 'wide' | 'narrow'; area: SystemArea; pngs: string[] }[];
  findings: CheckFindingData[];
} | null
```

PNGs: `<system>/.chamber/check/r-<yyyymmddhhmmss>-<6 hex>/<area>@<width>[-n].png`, system-relative in the
report. Old run folders not named by the new report and older than 2 min are removed (`cleanupRuns`).

CLI text (`formatSystemCheckText`): after the findings, a block

```
Board pictures (light scheme). Open them and look before you say you are done:
  Wide board 1526px: <abs>/components@wide.png, <abs>/components@wide-2.png, …
  Narrow board 1046px: …
```

or, without a browser: "No Chrome, Edge or Chromium was found, so the board wasn't drawn. Only the files were
checked." When the proposal was drawn: "Drew the proposed board (proposal p_…)". `--json` adds `pngs` (absolute)
and `render`. Exit codes unchanged: any error → 1, otherwise 0; 2 when the check could not run.

`whereOf` for the board codes uses the two width entries as viewports, so a sentence starts
"components/table.html @ Wide board 1526×900".

### B.6 Findings

Severity and sentence come only from the closed table in `src/shared/checks.ts`; params are numbers or
enums; entry keys and ids go in `detail` (cleaned, ≤ `CHECK_DETAIL_MAX`, shown as data).

| Code | Severity | Raised when (per width) | Params | Sentence (final wording by the builder, same meaning) |
|---|---|---|---|---|
| `system-layout-invalid` | warning (static) | `boardLayout.ignoredCount > 0`; raised whatever the coverage | count, misplaced | Built: tells unknown words from known layouts in a place that doesn't take them ("… it can't use (2 Design Chamber doesn't know, 1 in places that don't take them) …"); detail: up to 3 `entry: value (what the place takes)`. `layout.notes` is read as the notes default (an explicit `overview` wins; KI-32). |
| `system-board-overflow` | warning | `scrollWidth > innerWidth + 1` | px, width | "{where}: the board is {px}px wide, wider than the {width}px it has, so it scrolls sideways." |
| `system-board-preview-wide` | warning | `max(scrollW, contentRight) > w + 1` for a preview | px, width | "{where}: this example is {px}px wide but the board can give it {width}px, so it scrolls sideways in its card." |
| `system-board-preview-outside` | warning | `max(outLeft, outTop, outBottom) > 1` | px | "{where}: part of this example sits {px}px outside its card, so it's cut off or covers other entries." |
| `system-board-text-outside` | warning | `textOut > 1` | px | "{where}: text runs {px}px outside its card." |
| `system-board-hint-small` | info | at the **wide** width only: `widened` and effective layout is card, compact or table, and (built) the entry's preview is not still too wide (`preview-wide` would say the example must shrink) | layout | "{where}: this entry is set to {layout} but needed the full width. Set its layout to full." |
| `system-board-partial` | info | an area over 4 tiles (`area`, `max` = 3600), or `truncated` (`max` = 1000) | area?, max | "Only the first {max}px of {Area} were pictured at {width}px; all of it was measured." / "Only the first {max} entries were measured." |

Reused as they are: `browser-missing` (info), `render-failed`, `render-timeout`, `console-error`,
`request-blocked`, `dialog-opened`, with `file: 'board.html'` (the generated board). The seven board-codes
except `system-layout-invalid` join `ARTBOARD_CODES`. `parseParams` accepts `layout` only from `BOARD_LAYOUTS`.

`dedupeBoardFindings` (pure): for one `(code, entry)` keep the finding of the widest width that raised it (it
fails even with the most room); a finding raised only at narrow is kept at narrow. Board-level codes
(`system-board-overflow`, `system-board-partial`, render codes) are kept per width.

### B.7 The tool and the route

- `design_check` never calls the service: `runDesignCheck` spawns `dist/cli/dc.mjs check --system <id>`
  (`src/plugin/check-tool.ts:195`). So the tool gets the visual check with no route change. `parseToolInput`
  returns `{ system, static }` for a system (today `static` is accepted and ignored); `buildChildArgs` adds
  `--static` when true. `CHECK_TOOL_TIMEOUT_MS` (180s) covers static + assembly + browser start (20s) + the
  110s render budget. The system timeout sentence says "Run it again with static: true to check the files
  only." instead of the screens hint.
- `GET /systems/:id/checks` (`src/service/routes/system-checks.ts`) and the `checks` purpose in
  `src/service/routes/system-chat.ts` call `runSystemCheck` without `render`: unchanged cost, unchanged
  answers apart from the new static code. Route security is unchanged (router bearer check, store containment).
- `parseArgs`: `check-system` carries `staticOnly`; `--static` now means "files only" for systems too.
- `src/cli/dc.ts` `checkSystem`: SIGINT/SIGTERM abort controller as for designs, `resolveBrowser` from settings,
  `probeSource: __DC_PROBE__`, `isRoot`, `platform`; `CheckInterrupted` / `CheckOutputError` → exit 2 with
  their sentence.

---

## Failure & Recovery

| Step | Fails how | What the agent or user sees | Way back |
|---|---|---|---|
| Layout parse | Unknown / misplaced value | Entry drawn with its fallback; `system-layout-invalid` warning naming up to 3 | Agent fixes the value; check again |
| Board assembly | An example missing or over the cap | That card says "This example couldn't be shown." (as today) | Agent fixes the example |
| Board bundle | Over 60 MB | `render-failed` on board.html "over 60 MB"; static findings still listed; exit 1 | Smaller fonts, logos or examples |
| Browser | None found | `browser-missing` note + "the board wasn't drawn" line; exit from static findings | Install Chrome/Edge or set it in Settings |
| Browser | Can't be driven | `render-failed` "This browser build can't be driven. Set another browser in Settings." | Settings → browser |
| One width | Timeout (45s) | `render-timeout` for that width; the other width still runs; state `partial` | Agent simplifies examples; or `static: true` |
| Probe | Answer fails the sanitizer | `render-failed` "The page could not be measured." at that width | Re-run; report a bug if it repeats |
| Output | `.chamber` or `.chamber/check` is a link or a file | Exit 2: "This design system's .chamber entry is not a normal folder, so Design Chamber cannot save the check there. Remove it and run the check again." | Remove it |
| Interrupt | Ctrl-C, tool timeout, service shutdown | Exit 2 "The check was interrupted, so no report was saved."; run folder removed; previous report kept | Run again |
| System | Unreadable system.json | Static `system-unreadable`; board draws its one sentence; no measured findings | Agent fixes system.json |
| Repo system | No snapshot yet and no proposal | Board drawn empty; static `system-living-missing` etc. as today | Agent writes a proposal or the user approves |
| Living page | Generated page fails the allowlist after the CSS change | Cannot happen silently: `addCss` drops any refused rule and `living-safe.test.ts` asserts the page passes | Fix the rule in the same PR |

---

## Not Building

- `wide` (two-column span): equal to `full` at every width the page reaches today (D1, Open Question 1).
- Per-token, per-type-style, per-font and per-logo hints: one hint per token section is enough; logos are few.
- A layout control in the panel for the user: the brief makes this agent-controlled.
- Rendering in `GET /systems/:id/checks` or showing visual findings on the page's Checks badge (D9, Open Question 2).
- A rail-width (300 to 460px) render and a dark-scheme render: colours don't change layout; the rail is a glance.
- Checks inside the examples (contrast, text clipped inside the example's own boxes): the design check covers
  full designs; examples are fragments the board shows in isolation.
- Image diffs between runs or a stored baseline.
- A second probe bundle or build define: `collectBoard` rides in the existing `__dcProbe` bundle.

---

## Security & Threat Model

**Surfaces touched:** untrusted agent HTML in headless Chrome (new: the whole board document, examples
inside); filesystem writes under the designs root (new: PNGs and the report under `_systems/<id>/.chamber/`);
agent-written `system.json` (new keys); the living page document (new markup and CSS). No new service route,
iframe, postMessage type, or token use.

**Authn/authz.** The CLI and the tool hold no token and call no route (unchanged). The two system routes keep
the router's bearer check and the store's id pattern + `resolveInside` containment; they gain no input.

**Untrusted HTML in headless Chrome.** The board document carries agent text (escaped by the generators, as
today) and examples (escaped into inert `<template>`s; the board script attaches them to open shadow roots
through `innerHTML`, which never runs `<script>`). Inline event handlers in example markup (`<img onerror>`)
can run; this is the same exposure the in-app board frame has, and it is contained the same way:
- Served from `https://design.invalid/<n>/board.html` through `Fetch` interception with `CHECK_CSP`
  (`sandbox allow-scripts`, `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, data:/blob: only);
  every other request is failed by the client; the browser runs with `OFFLINE_NETWORK_ARGS` (no DNS, dead
  proxy), `--remote-debugging-pipe` (no port), a throwaway profile, downloads denied, the storage stand-in.
- The probe runs in the `dc-probe` isolated world, so page script cannot replace its functions. Page script
  can still move the DOM it measures (for example forge a `dc-wide` class). That only misleads the agent about
  its own example; every number is re-checked by `sanitizeBoardProbe`, every verdict is a Node function, every
  string reaching a sentence is a code, enum or number, and entry keys must pass `isBoardEntryKey`.
- A hostile example that loops forever is cut at 45s per width, the run at 110s, the tool at 180s; the browser
  is closed in `finally`.

**Path safety.** The system folder comes only from `resolveSystemTarget` (direct grandchild of the realpath'd
root, real folder, id pattern, reserved ids refused). Every write goes through `output.ts`: `.chamber` and
`.chamber/check` must be real folders (`lstat`, no link), each path through `resolveInside`, PNG names from
`pngStem`/`pngNames` (safe alphabet, case-insensitively unique for Windows and macOS), the report via
`writeFileAtomic` last. The proposal source is `proposalDirOf` (existing containment). The repo is never read
for drawing; a repo-backed system is drawn from its snapshot or `proposal/` under `_systems/<id>/`.

**Bounded output.** ≤ 32 PNGs, each ≤ 1526×900 at scale 1; one run folder kept (older ones removed after 2
min); report ≤ `CHECK_FINDINGS_MAX` findings with clipped details; the probe answer is capped
(`SYSTEM_BOARD_ITEMS_MEASURED_MAX`, per-preview and per-entry caps) and size-checked by the sanitizer.

**Data exposure.** PNGs can picture anything the system shows, including text the living-page secret scan
would refuse. They stay in `.chamber/`, which versions, copy-on-link (`docs/SPEC.md` §6.8), export and the
living page never include, and they never leave the machine. The CLI prints absolute paths that contain the
user's home folder to the agent, as the design check already does.

**system.json.** New values are a closed set; anything else is ignored. Echoed values are cleaned to one line
and clipped to 16 characters before reaching `detail`. Keys are read with `Object.hasOwn` only, so
`__proto__`/`constructor` are ordinary ignored keys.

**Living page.** Only class names and ARIA roles change in markup (`role` and `class` are on the allowlist;
the table uses divs, so the `table`/`td` attribute rules are untouched); new CSS passes `livingCssProblems`;
`scanLivingPage` must accept a page with all four layouts (test).

## Sandbox & Path Safety

- **Sandbox/CSP:** headless page under `CHECK_CSP` (unchanged, `src/service/check/render.ts:20`), served via
  `Fetch.fulfillRequest`; the in-app board frame is untouched (frame-slot sandbox, no `allow-same-origin`).
- **Containment functions:** `resolveSystemTarget` (`src/service/check/target.ts:35`), `resolveInside` /
  `resolvePlainTarget` (`src/service/paths.ts`), `ensureNormalFolder` / `createRunDir` / `writePng`
  (`src/service/check/output.ts`). No new path logic. Tests to add: a system whose `.chamber/check` is a
  link is refused with exit 2 and nothing is written outside; PNG names are unique case-insensitively for
  area/width stems; the report path stays `<system>/.chamber/check.json` (existing tests cover the rest).

---

## Edge cases

- **Agent writing while the check runs.** The detail and files are read once; a torn read (new system.json,
  old example) draws a mixed board and the next run is right. Two runs at once get separate run folders; the
  last report wins; `cleanupRuns` leaves young folders alone.
- **Partial writes.** A half-written example bundles as what is on disk; a half-written system.json is
  `system-unreadable` and the board draws its one sentence.
- **Retries.** A run is idempotent: new run id, report replaced atomically.
- **Empty system.** Board draws "nothing in it yet"; areas are tiny; no measured findings.
- **Designs folder missing or moved.** Existing CLI refusal, exit 2. Changing the root in Settings mid-run does
  not affect the CLI (it resolved `--root` at start).
- **Theme switch mid-render (in app).** Unchanged: the page reloads the board on a scheme change; the new CSS
  uses only the `--dc-board-*` variables. The check always draws light.
- **Malformed or huge system.json.** Over 1 MiB → unreadable as today. Thousands of bad layout values → capped
  list, true count.
- **Chrome missing.** Static findings, `browser-missing` note, the "board wasn't drawn" line, no PNGs.
- **Service restart.** The CLI does not use the service; the route is static and stateless.
- **Windows.** Launcher `dc.cmd` unchanged; work dir in `%TEMP%` (`thumbWorkParent`); `pngNames` avoids
  case collisions; printed paths use backslashes.
- **Late fonts or images.** Board script re-runs `widen()` on `load` and `fonts.ready`; the probe measures
  after both.
- **Very tall areas.** Pictured to 3 600px, measured in full, one `system-board-partial` note.
- **Proposal superseded during the run.** The drawn proposal id is recorded in `render.drawn`; the next run
  draws the new one.
- **`position: fixed` or `100vw` in an example.** Escapes or overflows its card: `preview-outside` or
  `preview-wide`. The agent docs name both.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Forced layout under `content-visibility: auto` not measured for off-screen sections | Medium | Happened (section heights and tiles); resolved by drawing the check's board with every section laid out (`eager`), e2e-tested |
| `Page.captureScreenshot` `clip` semantics differ between Chrome versions | Medium | e2e asserts each PNG's height equals the clip height and is not blank; fallback: capture the viewport without `clip` |
| Check uses `system-ui`, the app uses the host font: widths differ by a few px | Low | 1px thresholds; findings are about tens of px; documented in the CLI text ("light scheme") |
| Layout-only edits bump the revision, so linked designs and the living page say "newer" | Low | Same as any system.json edit; Open Question 4 |
| `subgrid` / container queries unsupported in an old user browser opening the living page | Low | Living page uses `@media`; subgrid is in all evergreen browsers since 2023; without it rows still read in order |
| Render time on big systems exceeds the tool's 180s | Low | 110s render budget; per-width timeout; `static: true` escape named in the timeout sentence |
| Skill text over 24 000 characters | Low | ~1 400 added to 17 393; existing length test |

---

## Test plan (`node:test`; risk logic test-first)

1. `test/shared/system-json.test.ts`: item and section layouts read; absent → null; unknown word, number,
   over 16 chars, control characters → ignored with `unknown` and a cleaned value; `full` on colours and any
   value on typography → `not-here`; `layout` not an object; `__proto__` key ignored; cap 20 with true count;
   effective layout precedence; **fingerprints equal before and after a layout-only change**; a bad hint never
   adds to `problems` nor drops the entry.
2. `test/service/systems/edits.test.ts`: a meta edit of a component keeps its `layout`.
3. `test/service/systems/specimen-html.test.ts`: runs keep agent order (`compact, compact, full, compact` →
   three runs); table rows carry `data-dc-entry` and roles; escaping in table cells; colour groups form runs
   inside each group; `dc-fit` only on component cards/rows.
4. `test/service/systems/board-html.test.ts`: generator version 5; the script selects `.dc-fit` and re-measures
   on `load`, `fonts.ready` and `<html>` style; `eager` only in the check's board. `board-layout-e2e.test.ts`
   (real Chrome): compact, full and table runs, the table stacking under 760px, gaps between runs, and the probe's
   hanging-space case.
5. `test/service/systems/living-html.test.ts` + `living-safe.test.ts`: a page with all four layouts in every
   section that takes them passes `scanLivingPage`; every FRAME_CSS line passes `livingCssProblems`; no
   `data-` attribute survives.
6. **New** `test/service/check/board-analyze.test.ts`: each code at the 1px boundary (1 → none, 2 → finding);
   `hint-small` only at wide; dedupe keeps the widest width; per-code cap 20; sanitizer rejects NaN,
   Infinity, wrong types, oversize arrays, entry keys off `BOARD_ENTRY_PATTERN`; changing one threshold value
   turns a test red (protocol rule 11).
7. `test/service/check/system-checks.test.ts`: `system-layout-invalid` count and detail; raised in an uncovered area.
8. `test/shared/checks.test.ts`: the new codes, severities, sentences; `parseParams` keeps `layout` only from
   the enum; board codes use the width labels in `whereOf`.
9. `test/service/check/engine.test.ts` (unchanged, green) and a render-hook test with the fake CDP
   (`test/service/systems/fake-cdp.ts`): `inspect` result used, abandon on timeout, `label` in PNG names.
10. `test/service/check/output.test.ts`: the system wording; a linked `.chamber/check` in a system is refused.
11. **New** `test/service/check/system-board.e2e.test.ts` (`chromeOrSkip`, `probeSource` helpers): a fixture
    system with (a) a 1 800px table example → `preview-wide`, reported once at wide; (b) an example with
    `position: fixed` → `preview-outside`; (c) the same as (b) as the last component of a 5 000px board →
    still found; (d) compact button → nothing; (e) a compact example 700px wide → `hint-small` at wide;
    (f) an example with an `http://` image → no network (request blocked, no duplicate of the static remote
    finding). PNG names `foundations@wide.png` …, count ≤ caps, each 1526 or 1046 wide and ≤ 900 tall.
12. `test/cli/dc-system.test.ts`: `--static` → no PNGs and `render: null`; no browser (bad `chromePath`, empty
    PATH) → the note line and exit from static findings; text lists "Board pictures"; `--json` has `pngs`;
    interrupted → no report.
13. `test/plugin/check-tool.test.ts`: `{ system, static: true }` → `--static`; without → no flag; the new
    descriptions and timeout sentence.
14. Agent docs: RULES.md and skill snapshots updated (`test/service/systems/__snapshots__` where they live);
    the skill length test passes; a test asserts the contract names all four values and the token-section list.

Gates: `npm run typecheck`, `npm run build`, `npm test` (`npm run check`), outputs pasted.

---

## Docs to update (same PR)

- `docs/SPEC.md` §6.7 (system.json `layout`) and the Phase 2.5 checks bullet (visual system check, route
  static): done in this commit.
- `documentation/specs/phase-2-5-technical.md` §10.2: one line pointing here (the system check now draws the
  board unless `--static`): done in this commit.
- `documentation/features/design-checks.md`: the system check draws the board, what the pictures are, the new
  findings in plain English.
- `documentation/features/design-systems.md` and `documentation/pages/design-systems.md`: the board follows the
  agent's layout hints; what each layout looks like; the living page follows them too.
- `documentation/README.md`: no spec index there today; no change unless the main agent adds one.

---

## Task list (one builder: fullstack-developer)

WP0 files first, through the main agent (it edits them or authorises the builder, then tells every lane):

1. `src/shared/types.ts`: `BoardLayout`; `layout` on `SystemComponent`, `SystemEntryText`, notes;
   `SystemDetail.boardLayout`; seven `CheckCode`s; `CheckParams.layout`.
2. `src/shared/limits.ts`: the constants of §A.1 and §B.3.

Then, in order (each step with its tests from §T):

3. `src/shared/system-json.ts`: §A.2. Tests 1.
4. `src/shared/checks.ts`: rules, sentences, `ARTBOARD_CODES`, `parseParams`. Test 8.
5. `src/service/check/system-static.ts`: `system-layout-invalid`; `SystemCheckReport.render`. Test 7.
6. `src/service/systems/specimen-html.ts`: runs and the four layouts (§A.3). Test 3.
7. `src/service/systems/board-html.ts`: CSS rules 1 to 7, the script changes, version 4 (§A.4). Test 4.
8. `src/service/systems/living-html.ts`: FRAME_CSS (§A.6). Test 5.
9. **New** `src/service/systems/board-assemble.ts`; `src/service/systems/board.ts` uses it (§B.2). Existing
   board route tests green.
10. **New** `src/guest/probe/board.ts`; re-export from `src/guest/probe/probe.ts` (§B.4).
11. **New** `src/service/check/board-analyze.ts` (§B.4, §B.6). Test 6.
12. `src/service/check/render.ts` (`inspect`, `savePng` label), `src/service/check/engine.ts` (shared run
    helper), `src/service/check/output.ts` (wording) (§B.3). Tests 9, 10.
13. `src/service/check/system-run.ts`: the plan of §B.3. `src/service/check/report-text.ts`: `parseArgs`,
    `USAGE`, text and JSON output (§B.5). `src/cli/dc.ts`: `checkSystem` (§B.7). Tests 11, 12.
14. `src/plugin/check-tool.ts` (§B.7). Test 13.
15. `src/shared/agent/system-rules.ts`, `src/shared/agent/system-skill-doc.ts`,
    `src/shared/agent/system-prompts.ts` (§A.5). Test 14.
16. Docs of the list above, then the gates.

Acceptance: every §T test exists and passes; on `_systems/nexus` (read-only, copy it into a temp designs root
first, never touch the real one) `dc check --system nexus` writes ≤ 32 PNGs and its findings point at real
problems (by the time this was built, nexus's `navigation.html` already contained its sidebar in a stage, so
nothing is reported there; a planted `100vw` strip and a `position: fixed` element were reported); the system page shows
the same board as before for a system with no hints; light and dark host themes still colour the board.

---

## Open Questions (each with a recommendation)

1. **`wide` value.** Recommendation: leave it out (D1). If you want it anyway, the components flow must move
   from CSS columns to a grid with container queries, and short cards get blank space under them again (what
   12b4b8d removed).
2. **Visual findings on the system page.** Recommendation: not in this PR; the route stays static (D9). A
   later step could show the last CLI run's board findings on the Checks badge while the system's revision is
   unchanged.
3. **Drawing the waiting proposal.** Recommendation: yes, in this PR (D10). During a repo build it is the only
   board worth looking at. Say no and the check draws only the snapshot.
4. **Layout-only edits count as a new revision.** Recommendation: accept. Linked designs then offer "a newer
   system exists" and a repo's living page reads out of date after a hint change, like any other edit.
   Excluding `layout` from the revision hash would need a special case in the tree hash.
5. **Living page follows the hints in this PR.** Recommendation: yes (D6). No committed page is flagged by the
   generator change itself.
6. **Board widths 1526px and 1046px.** Recommendation: keep (D7): a 1920px and a 1440px window with the side
   panel open.

Architecture Complete → main agent (task breakdown) | → fullstack-developer (all steps above, including the board CSS)
