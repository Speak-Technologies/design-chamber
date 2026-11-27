# The board and the check

Read this before your first check. It draws the board (Design Chamber's page of the system) offline, measures it and lists what to fix.

## The board

Examples are fragments. `<script>` doesn't run (inline handlers can; don't use them). Use `var(--token)` for every colour, so the dark ground works.

## Layout hints

Set an entry's `layout`, or section defaults in a top-level `layout` object: `{ "components": "compact", "notes": "full", "colours": "table" }` (`notes` means the overview section).

- `card` (default): most things.
- `compact`: small pieces without labels; short swatch lists.
- `full`: tables, navigation, toolbars, page headers, phone frames, side-by-side examples.
- `table`: long lists read row by row.

Components, overview, patterns and brand take all four. Colours, spacing, radius, shadows, motion and sizes take card, compact or table. Typography, layers and assets take none. Keep entries with the same layout together; they share a row.

## Running the check

- Tool: `design_check`, `{ "system": "<id>" }`, plus `"area": "foundations" | "components" | "patterns" | "brand"` or `"scheme": "light" | "dark" | "both"`.
- Else: Design Chamber's check command with `--system <id>`, plus `--area`, `--scheme`, `--static` (files only) or `--json`. Exit 0: no errors; 1: errors; 2: it couldn't run.
- `--area` pictures one area; file checks still cover everything.
- `--scheme` defaults to `both` with dark values, else `light`.

## Screens

After the board, a full check runs the design check on every screen at each viewport: contrast, overflow, text, alt text, labels, names. Findings name `screens/<id>.html`.

- With dark values each screen is drawn again in the dark scheme, named `<viewport>-dark`; `--scheme light` leaves those out.
- Up to 24 screen artboards per check, dark ones counted, light first.
- `--area` draws no screens; only a full check does.
- `--screen <id>` (repeatable; the tool takes `screens`) checks only those screens and skips the board. It can't be combined with `--area` or `--static`.
- A `page` screen with a phone viewport (a viewport at most 480px wide) also counts for `responsive`, a `marketing` screen for `marketing`.

## Reading the pictures

Pictures go in `.chamber/check/<run>/` in the system folder.

- Overviews, `components-overview@wide.png`: a whole area, 1526px (wide) or 1046px (narrow). Open first.
- Tiles, `components@wide-4.png`; findings name them.
- Dark, `components-overview@wide-dark.png`, `components@wide-dark-2.png`: not Brand, wide only.
- State pictures, `<component>-<state>@wide.png`: the state really forced. "(changes nothing)" marks one your CSS misses. Check each looks like its static copy (`components.md`).
- Motion strips, `<entry>-motion@wide.png`: see `motion.md`.
- Screens: `screen-<id>@<viewport>.png` and `screen-<id>@<viewport>-dark.png`, with `-2` and up for a page taller than its viewport.
- Compare sheets, `compare-<id>@<viewport>.png`: your screen left, real app right (`patterns.md`). Fix differences, or tell the user why they're meant.

Open every one before you say done. States and strips come from the wide light board, so `--screen` takes neither; states also need all areas or `components`.

## The loop

Write one area, check it with `--area`, open its pictures, fix, repeat. Before done: one full check with no errors, warnings fixed or explained in OVERVIEW.md; no coverage gap left beyond what the user agreed is `outOfScope`.

## Board comments

A message headed "Comments on the design system" is the user's change request: numbered, each naming a board entry such as `component:button`. Change only what the comments ask, reply per number, and never mark the system ready. A repo system still needs an approved diff. If an entry is gone, say so; don't guess. Never edit the comment file or copy comments into the repo.

## Token export

On the system page, ⋯ then Export tokens… saves `<id>-tokens.zip` with W3C design tokens JSON (`tokens.json`), `tokens.css` and, when the project uses Tailwind, a v4 `@theme` file (light values only). Mention it when the user wants the tokens elsewhere; only they can run it. Putting a file in the repo takes an approved diff.

## Completeness

Copy BUILD.json's `depth` into `system.json`: `"core"`, `"full"` or `"tokens"`. Without it there is no completeness, example or label check; contrast runs either way. A `tokens` system is asked only the foundations core topics, so set `coverage` to `["foundations"]`.

| Area | Core needs | Full adds |
|---|---|---|
| foundations | `surface`, `text`, `border`, `brand` (a colour in each group), `status` (3 status colours), `type-styles` (4 styles), `spacing` (4 tokens), `radius` (1 token), `pairs` (1 pair; automatic pairs count), `dark-values` (when any token has a dark value, every colour has one) | `state-colours`, `data-colours`, `type-styles` (6 styles), `control-sizes`, `breakpoints`, `elevation`, `layers`, `motion`, `icons` |
| components | `components` (1 component), `examples` (every component has one) | `focus-disabled` |
| patterns | `voice` | `navigation`, `overlays`, `forms`, `feedback`, `states`, `data-display`, `accessibility`, `responsive`, `motion` |
| brand | `logo` | `brand-colour`, `imagery`, `marketing` |

What counts, beyond plain counts:

- `state-colours`: a colour named `*-hover`, `*-active`, `*-selected` or `*-disabled`.
- `data-colours`: one `data` group colour, asked when the system draws data (a chart, table, graph or data-grid component, or a `data-display` pattern).
- `control-sizes`: a token named `--control-*` or `--touch-*`.
- `breakpoints`: a size token marked as one. `elevation`: a shadow token. `layers`: a layer token.
- `motion`: foundations want a time and an easing in the motion section (or `--duration-*` and `--ease-*` names), patterns a `motion` entry. `icons`: one listed icon.
- `focus-disabled`: every component listing `hover` also lists `disabled` and a state starting with `focus`.
- Pattern topics: a pattern of that kind (`overlays` is `overlay`); `data-display` only with data.
- `logo`: a logo file or a `logo-use` entry. `brand-colour`: a brand entry of kind `colour`; `imagery`: kind `imagery`; `marketing`: kind `marketing`, `social` or `email`.

Only covered areas are checked. An area's missing topics are one `system-coverage-gap` finding listing up to 8 ids: information at core, a warning at full.

### Out of scope

List topics that don't apply in `system.json` as `outOfScope: ["navigation", "data-display"]` (at most 40 entries). A listed topic stops counting in every area, so `motion` drops the tokens and the pattern. Only these 34 ids count; any other value is skipped with a `system-entry-invalid` problem:

`surface`, `text`, `border`, `brand`, `status`, `type-styles`, `spacing`, `radius`, `pairs`, `dark-values`, `state-colours`, `data-colours`, `control-sizes`, `breakpoints`, `elevation`, `layers`, `motion`, `components`, `examples`, `focus-disabled`, `voice`, `navigation`, `overlays`, `forms`, `feedback`, `states`, `data-display`, `accessibility`, `responsive`, `logo`, `brand-colour`, `imagery`, `marketing`, `icons`.

Ask the user before you add a topic, in one short question with the reason. An interview answer ruling it out (Motion: No motion) counts. Never add a topic just to clear a warning. Note it and why in OVERVIEW.md.

### Examples, labels and contrast

- `system-example-missing` (depth core or full, components covered): every component needs an example; at full, so does every pattern of kind `navigation`, `overlay`, `forms`, `data-display`, `feedback`, `states` or `page`. Information at core, a warning at full.
- `system-states-missing` (depth core or full): each name in a component's `variants`, `sizes` and `states` needs an example instance labelled `data-dc-variant`, `data-dc-size` or `data-dc-state` with it (any case).
- `system-contrast-low` (foundations covered, any depth): each pair is judged in light and dark. On the dark ground a token with no dark value is judged by its light value. Hex and `rgb()` pairs are judged from the files; others are measured, and flagged when more than 0.05 under.

## Findings and their usual fix

| Code | Means | Usual fix |
|---|---|---|
| `system-unreadable` | system.json isn't valid JSON, or is over 1 MB | Fix it; nothing else is read until then |
| `system-entry-invalid` | Entries couldn't be read, or a screen file or `source` is bad | Fix what the detail names |
| `system-value-invalid` | A token value doesn't fit its section | Use the shape given; no `url()` or `:`; easings only in motion |
| `system-token-cap` | Over 2 000 tokens | Remove some |
| `system-token-undefined` | A component names an undefined token | Define or rename |
| `system-font-missing` | A listed font file is missing or unusable | Add it to `assets/fonts/` or drop the entry |
| `system-example-remote` | An example loads files from the internet | Inline SVG, system fonts, no links |
| `system-example-missing` | An entry has no example (above) | Write the file and set `example` |
| `system-states-missing` | A listed name has no labelled instance | Label the instance, or drop the name |
| `system-state-unstyled` | A labelled state changes nothing when forced | Style the real pseudo-class (`components.md`) |
| `system-contrast-low` | A pair is under its level (above) | Change a token (or add its dark value), recheck |
| `system-motion-no-reduced` | An example moves with no reduced-motion rule | Add the `prefers-reduced-motion` block (`motion.md`) |
| `system-icons-mixed` | Note: icons differ in `viewBox` size or stroke width | Redraw to one grid and stroke |
| `system-compare-skipped` | Note: a compare sheet wasn't made | Wrong width: save one as wide as a viewport. Unreadable: a real PNG or JPEG. Limit (24) or time: `--screen` |
| `system-coverage-gap` | A covered area misses topics | Add them, or ask the user and list them in `outOfScope` |
| `system-coverage-empty` | A covered area is empty | Write it, or drop it from `coverage` |
| `system-overview-empty`, `-overview-long` | OVERVIEW.md is missing, or over 4 000 characters | Write it, or move detail into notes |
| `system-note-long` | A note over 20 000 characters | Split it |
| `system-layout-invalid` | A layout hint isn't known or taken there | See Layout hints |
| `system-board-overflow` | The board scrolls sideways | Find the wide entry in the overview and fix it |
| `system-board-preview-wide` | An example is wider than its card | Remove fixed widths and let it wrap, or use `layout: "full"` |
| `system-board-preview-outside` | Part of an example escapes its card | Frame absolute parts (`relative`, `overflow: hidden`); never `fixed` |
| `system-board-text-outside` | Text runs out of its card | Wrap or shorten it |
| `system-board-hint-small` | The entry needed the full width | Use `full` |
| `system-board-partial` | Not all was pictured (cap: 60 states, 24 strips) | Check one area at a time |
| `render-skipped` | Something wasn't drawn; other results are kept | Use `--area`, `--scheme dark` or `--screen` |
| `browser-missing` | No Chrome, Edge or Chromium | Tell the user |
| `system-build-invalid` | BUILD.json can't be used | Fix the field the sentence names |
| `system-proposal-invalid` | PROPOSAL.json can't be used | New file, new id |
| `system-living-missing`, `-stale`, `-failed`, `-changed`, `-unsafe`, `-reformatted` | The repo's living page is missing, behind or altered | Follow the living page steps in the skill; never edit the page |
| `system-living-secret` | The living page shows something shaped like a secret | Remove it from the system |
| `system-repo-unreadable`, `-snapshot-changed` | The repo folder can't be read, or its copy changed | Tell the user; they choose the folder or re-sync |
| `system-code-drift`, `-code-differs`, `-landed-differs` | The code and the system disagree, or what landed differs from the diff | Propose a reconcile diff; never write without approval |
