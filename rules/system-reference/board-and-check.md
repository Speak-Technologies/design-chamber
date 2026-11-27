# The board and the check

Read this before your first check, and whenever a finding is unclear. The board is the page Design Chamber draws from the system's files. The check draws that board offline, measures it, reads the files, and tells you what to fix.

## What the board shows

Four areas, in this order. Each section appears only when it has something in it.

| Area | Sections | How entries are drawn |
|---|---|---|
| Foundations | overview, colours, typography, spacing, radius, shadows, layers, sizes | Swatches by colour group on light and dark grounds, then the Pairs block; type rows in each style; bars for spacing and sizes; boxes for radius and shadows; a stacking diagram for layers. `other` tokens are text rows. |
| Components | components | A card per component: name, purpose, note, variants, sizes, states, tokens, and the live example on a light ground and, with dark values, a dark one |
| Patterns | patterns | A card per entry: title, kind, note, body, and the example when it has one |
| Brand | brand, assets | Brand entries like patterns; a card per logo file with its variant and note; font specimens |

Examples are fragments set into shadow roots. Their scripts never run, and the dark ground swaps in the dark token values. That is why examples must use `var(--token)` for every colour.

## Layout hints

Give an entry a `layout`, or set section defaults in a top-level `layout` object: `{ "components": "compact", "patterns": "full", "notes": "full", "colours": "table" }`. `notes` sets the overview section. `card` is the default.

| Layout | Use for | Sections that take it |
|---|---|---|
| `card` | Most entries | all with a layout |
| `compact` | Small pieces: buttons, badges, tags, avatars, switches; short swatch lists | components, overview, patterns, brand, colours, spacing, radius, shadows, sizes |
| `full` | Wide entries: tables, navigation, toolbars, page headers, phone frames, every pattern or brand example with two frames side by side | components, overview, patterns, brand |
| `table` | Long lists read row by row (name, preview, notes), such as 40 colours or 30 small components | components, overview, patterns, brand, colours, spacing, radius, shadows, sizes |

Typography, layers and assets take no layout. An unknown layout, or one a section doesn't take, is ignored with a `system-layout-invalid` warning. Entries with the same layout next to each other share a row, so keep them together in the list.

## Running the check

- With the tool: `design_check` with `{ "system": "<id>" }`. Add `"area": "foundations" | "components" | "patterns" | "brand"` to picture one area, and `"scheme": "light" | "dark" | "both"` to choose the grounds.
- Without the tool: the check command from Design Chamber's instructions with `--system <id>`, plus `--area <area>`, `--scheme <scheme>`, `--static` (files only, no browser, nothing written) or `--json`. Exit 0: no errors. Exit 1: errors found. Exit 2: the check couldn't run, and it says why.
- `--area` pictures and measures one area; the file checks still run on the whole system. `--scheme` defaults to both when any token has a dark value.

## Reading the pictures

The check saves pictures under the system's `.chamber/check/<run>/` and prints the folder and every name.

- Overviews, named like `components-overview@wide.png`: the whole area at 1526px (wide) and 1046px (narrow). Open these first to see the layout.
- Full-size tiles, named like `components@wide-4.png`. Each finding about one entry names its tile. Open it for detail.
- The dark pass, named like `components-overview@wide-dark.png`: Foundations, Components and Patterns on the dark scheme, at the wide width only.

Look at every overview before you say you are done, even with no findings. The check measures layout and contrast; only you can see that a hover state looks wrong.

## The loop

1. Write one area.
2. Check it with `--area`.
3. Open the overview, then each picture a finding names.
4. Fix, and check again.
5. Before you say done: one full check with no `--area`. No errors. Every warning fixed, or explained in OVERVIEW.md. The coverage gap list empty, or each remaining topic in `outOfScope` with the user's agreement.

## Completeness

Set `depth` in `system.json` to the interview's answer: `"core"`, `"full"` or `"tokens"`. Copy it from BUILD.json. Without `depth` there is no completeness check. A `tokens` system covers foundations only, so set `coverage` to `["foundations"]`.

| Area | Core needs | Full adds |
|---|---|---|
| foundations | `surface`, `text`, `border`, `brand` (1 colour each or more), `status` (3 or more), `type-styles` (4 or more), `spacing` (4 or more), `radius` (1 or more), `pairs` (1 or more; automatic pairs count), `dark-values` (every colour, only when any dark value exists) | `state-colours`, `data-colours` (when a chart or table component or a `data-display` pattern exists), `type-styles` (6 or more), `control-sizes`, `breakpoints` (a breakpoint size), `elevation` (a shadow), `layers`, `motion` (a `--duration-*` and an `--ease-*` token) |
| components | `components` (1 or more), `examples` (every component) | `focus-disabled` (a component listing hover also lists focus and disabled) |
| patterns | `voice` | `navigation`, `overlays`, `forms`, `feedback`, `states`, `data-display` (same condition as above), `accessibility`, `responsive`, `motion` |
| brand | `logo` (a logo file or a `logo-use` entry) | `brand-colour`, `imagery`, `marketing` |

Only covered areas are checked. A missing topic is listed in a `system-coverage-gap` finding for its area: information for a core system, a warning for a full one.

### Out of scope

Some topics don't apply: a product with no charts has no data display, a single-screen tool may have no navigation. List those topic ids in `system.json` as `outOfScope: ["navigation", "data-display"]`, using only ids from the table above. A topic listed there stops counting.

Ask the user before you add a topic to `outOfScope`, one short question naming the topics and why ("This app has one screen and no charts. Leave navigation and data display out of the system?"). An interview answer that rules a topic out counts as that agreement, such as Motion: No motion. Never add a topic just to clear a warning. Say in OVERVIEW.md what is out of scope and why.

## Findings and their usual fix

| Code | Means | Usual fix |
|---|---|---|
| `system-unreadable` | system.json isn't valid JSON, or is over 1 MB | Fix the JSON; nothing else is read until you do |
| `system-entry-invalid` | Some entries couldn't be read; the detail names each and why | Fix the named entry: id, kind, example path, list lengths, pair token names, `depth`, `outOfScope` ids |
| `system-value-invalid` | A token value doesn't fit its section | Use the shape the detail gives; no `cubic-bezier()`, `url()` or `:` in values |
| `system-token-cap` | Over 2 000 tokens | Remove unused tokens |
| `system-token-undefined` | A component names a token the system doesn't define | Define it, or fix the name in `tokens` |
| `system-font-missing` | A listed font file is missing or unusable | Add the file to `assets/fonts/` or remove the entry |
| `system-example-remote` | An example loads files from the internet | Inline the SVG, use system fonts, remove the link |
| `system-example-missing` | A component, or at full a pattern of a visual kind, has no example | Write `components/<id>.html` or `patterns/<id>.html` and set `example` |
| `system-states-missing` | A listed variant, size or state has no labelled instance | Add the instance with `data-dc-variant`, `data-dc-size` or `data-dc-state`, or drop the name from the list |
| `system-contrast-low` | A pair is under its level, in light or dark (the detail says which) | Change the darker or lighter token, then check the other pairs that use it |
| `system-coverage-gap` | A covered area misses checklist topics | Add them, or ask the user and list them in `outOfScope` |
| `system-coverage-empty` | An area is covered but has nothing in it | Write it, or drop it from `coverage` |
| `system-overview-empty`, `system-overview-long` | OVERVIEW.md is missing, or over 4 000 characters | Write it, or move detail into notes |
| `system-note-long` | A note is over 20 000 characters | Split it |
| `system-layout-invalid` | A layout hint isn't known, or isn't taken there | Use a layout from the table above |
| `system-board-overflow` | The board scrolls sideways | Find the wide entry in the overview; fix its example |
| `system-board-preview-wide` | An example is wider than its card | Remove fixed widths; let it wrap; or `layout: "full"` if it truly needs the room |
| `system-board-preview-outside` | Part of an example escapes its card | An absolute or `fixed` element: put it inside a relative frame with `overflow: hidden` |
| `system-board-text-outside` | Text runs out of its card | Long unbroken words or ids: wrap them, or shorten the text |
| `system-board-hint-small` | The entry needed the full width | Set its layout to `full` |
| `system-board-partial` | Some parts weren't pictured or measured | Check one area at a time with `--area` |
| `render-skipped` | A pass ran out of time (often the dark pass) | Check with `--area` or `--scheme dark` |
| `browser-missing` | No Chrome, Edge or Chromium was found | File checks still ran; say so to the user |
| `system-build-invalid` | BUILD.json can't be used | Fix the field the sentence names |
| `system-proposal-invalid` | PROPOSAL.json can't be used | Write a new proposal with a new id |
| `system-living-missing`, `-stale`, `-failed` | A repo system's living page is missing, behind, or couldn't be made | Follow the living page steps in the skill |
| `system-living-changed`, `-unsafe`, `-reformatted` | The page in the repo differs from the generated one | Copy the generated page again; never edit it |
| `system-living-secret` | The living page shows something shaped like a secret | Remove it from the system's text and examples |
| `system-repo-unreadable`, `system-snapshot-changed` | Design Chamber can't read the repo folder, or its copy changed | Tell the user; they choose the folder or re-sync |
| `system-code-drift`, `system-code-differs`, `system-landed-differs` | The code and the system disagree, or what landed differs from the approved diff | Propose a reconcile diff; never write without approval |
