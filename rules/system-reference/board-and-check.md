# The board and the check

Read this before your first check, and whenever a finding is unclear. The board is the page Design Chamber draws from the system's files; the check draws it offline, measures it, reads the files and lists what to fix.

## What the board shows

Four areas, in this order. Each section appears only when it has something in it.

| Area | Sections | How entries are drawn |
|---|---|---|
| Foundations | overview, colours, typography, spacing, radius, shadows, layers, sizes | Swatches by group on light and dark, then the Pairs block; type rows; bars; radius and shadow boxes; a layer diagram; `other` tokens as text rows |
| Components | components | A card per component with its lists and the live example, on a light ground and, with dark values, a dark one |
| Patterns | patterns | A card per entry with its body and example |
| Brand | brand, assets | Brand entries like patterns; a card per logo file with its variant and note; font specimens |

Examples are fragments in shadow roots. Scripts never run, and the dark ground swaps in the dark token values, so examples use `var(--token)` for every colour.

## Layout hints

Give an entry a `layout`, or set section defaults in a top-level `layout` object: `{ "components": "compact", "patterns": "full", "notes": "full", "colours": "table" }`. `notes` sets the overview section. `card` is the default.

| Layout | Use for |
|---|---|
| `card` | Most entries |
| `compact` | Small pieces: buttons, badges, tags, avatars, switches; short swatch lists |
| `full` | Wide entries: tables, navigation, toolbars, page headers, phone frames, examples with two frames side by side |
| `table` | Long lists read row by row, such as 40 colours or 30 small components |

Components, overview, patterns and brand take all four. Colours, spacing, radius, shadows and sizes take card, compact or table. Typography, layers and assets take none. An unknown layout, or one a section doesn't take, is ignored with a `system-layout-invalid` warning. Entries with the same layout next to each other share a row, so keep them together in the list.

## Running the check

- With the tool: `design_check` with `{ "system": "<id>" }`. Add `"area": "foundations" | "components" | "patterns" | "brand"` to picture one area, and `"scheme": "light" | "dark" | "both"` to choose the grounds.
- Without the tool: the check command from Design Chamber's instructions with `--system <id>`, plus `--area`, `--scheme`, `--static` (files only, no browser) or `--json`. Exit 0: no errors; 1: errors found; 2: it couldn't run, and says why.
- `--area` pictures and measures one area; the file checks still run on the whole system.
- `--scheme` defaults to `both` when any token has a dark value, and to `light` when none does. `--scheme dark` draws the dark pass even with no dark values, showing the light values on a dark ground.

## Reading the pictures

Pictures go under the system's `.chamber/check/<run>/`; the check prints every name.

- Overviews, named like `components-overview@wide.png`: the whole area at 1526px (wide) and 1046px (narrow). Open these first to see the layout.
- Full-size tiles, named like `components@wide-4.png`. Each finding about one entry names its tile. Open it for detail.
- The dark pass: overviews named like `components-overview@wide-dark.png` and tiles named like `components@wide-dark-2.png`. Foundations, Components and Patterns on the dark scheme, at the wide width only.

Look at every overview before you say done, even with no findings: only you can see that a hover state looks wrong.

## The loop

1. Write one area.
2. Check it with `--area`.
3. Open the overview, then each picture a finding names.
4. Fix, and check again.
5. Before you say done: one full check, no `--area`. No errors; every warning fixed or explained in OVERVIEW.md; no coverage gap left, except topics the user agreed to put in `outOfScope`.

## Completeness

Copy `depth` from BUILD.json into `system.json`: `"core"`, `"full"` or `"tokens"`. Without it there is no completeness, example or label check; contrast runs either way. A `tokens` system is asked only the foundations core topics, so set `coverage` to `["foundations"]`.

| Area | Core needs | Full adds |
|---|---|---|
| foundations | `surface`, `text`, `border`, `brand` (a colour in each group), `status` (3 status colours), `type-styles` (4 styles), `spacing` (4 tokens), `radius` (1 token), `pairs` (1 pair; automatic pairs count), `dark-values` (when any token has a dark value, every colour has one) | `state-colours`, `data-colours`, `type-styles` (6 styles), `control-sizes`, `breakpoints`, `elevation`, `layers`, `motion` |
| components | `components` (1 component), `examples` (every component has one) | `focus-disabled` |
| patterns | `voice` | `navigation`, `overlays`, `forms`, `feedback`, `states`, `data-display`, `accessibility`, `responsive`, `motion` |
| brand | `logo` | `brand-colour`, `imagery`, `marketing` |

What counts, beyond plain counts:

- `state-colours`: a colour named `*-hover`, `*-active`, `*-selected` or `*-disabled`.
- `data-colours`: one colour in the `data` group, asked only when the system draws data (a component whose id or name contains chart, table, graph or data-grid, or a `data-display` pattern).
- `control-sizes`: a token named `--control-*` or `--touch-*`.
- `breakpoints`: a size token marked as a breakpoint. `elevation`: a shadow token. `layers`: a layer token.
- `motion`: in foundations, a `--duration-*` token and an `--ease-*` token; in patterns, a pattern of kind `motion`.
- `focus-disabled`: every component listing `hover` also lists `disabled` and a state starting with `focus` (`focus-visible` counts).
- Pattern topics: a pattern of the same kind (`overlays` is kind `overlay`); `data-display` only when the system draws data.
- `logo`: a logo file or a `logo-use` entry. `brand-colour`: a brand entry of kind `colour`; `imagery`: kind `imagery`; `marketing`: kind `marketing`, `social` or `email`.

Only covered areas are checked. An area's missing topics are one `system-coverage-gap` finding listing up to 8 ids: information at core, a warning at full.

### Out of scope

Some topics don't apply: no charts means no data display, a one-screen tool may have no navigation. List those ids in `system.json` as `outOfScope: ["navigation", "data-display"]` (at most 40 entries). A listed topic stops counting in every area it appears in, so `motion` drops both the tokens and the pattern. Only these 33 ids count; any other value is skipped with a `system-entry-invalid` problem:

`surface`, `text`, `border`, `brand`, `status`, `type-styles`, `spacing`, `radius`, `pairs`, `dark-values`, `state-colours`, `data-colours`, `control-sizes`, `breakpoints`, `elevation`, `layers`, `motion`, `components`, `examples`, `focus-disabled`, `voice`, `navigation`, `overlays`, `forms`, `feedback`, `states`, `data-display`, `accessibility`, `responsive`, `logo`, `brand-colour`, `imagery`, `marketing`.

Ask the user before you add a topic, in one short question with the reason ("This app has one screen and no charts. Leave navigation and data display out?"). An interview answer that rules a topic out, such as Motion: No motion, is that agreement. Never add a topic just to clear a warning. Say in OVERVIEW.md what is out of scope and why.

### Examples, labels and contrast

- `system-example-missing` (depth core or full, components covered): every component needs an example; at full, so does every pattern of kind `navigation`, `overlay`, `forms`, `data-display`, `feedback`, `states` or `page`. Information at core, a warning at full. The detail lists the files.
- `system-states-missing` (depth core or full): each name in a component's `variants`, `sizes` and `states` needs an instance in its example labelled `data-dc-variant`, `data-dc-size` or `data-dc-state` with that name (any case). One finding per list; the detail names the component and the names.
- `system-contrast-low` (foundations covered, any depth): each pair is judged in light and in dark, one finding per scheme. On the dark ground a token with no dark value is judged by its light value, so a pair can fail in both. Hex and `rgb()` pairs are judged from the files; others are measured on the board and flagged only when more than 0.05 under their level. Detail: `--fg-muted on --surface 3.9:1 (dark)`.

## Findings and their usual fix

| Code | Means | Usual fix |
|---|---|---|
| `system-unreadable` | system.json isn't valid JSON, or is over 1 MB | Fix it; nothing else is read until then |
| `system-entry-invalid` | Some entries couldn't be read; the detail names each | Fix the named entry: id, kind, example path, list lengths, pair names, `depth`, `outOfScope` |
| `system-value-invalid` | A token value doesn't fit its section | Use the shape given; no `cubic-bezier()`, `url()` or `:` |
| `system-token-cap` | Over 2 000 tokens | Remove unused tokens |
| `system-token-undefined` | A component names an undefined token | Define it, or fix the name |
| `system-font-missing` | A listed font file is missing or unusable | Add it to `assets/fonts/` or drop the entry |
| `system-example-remote` | An example loads files from the internet | Inline SVG, system fonts, no links |
| `system-example-missing` | An entry has no example (above) | Write the file the detail names and set `example` |
| `system-states-missing` | A listed name has no labelled instance (above) | Label the instance, or drop the name from the list |
| `system-contrast-low` | A pair is under its level (above) | Change one token (in dark, add the missing dark value), then recheck the pairs that use it |
| `system-coverage-gap` | A covered area misses topics | Add them, or ask the user and list them in `outOfScope` |
| `system-coverage-empty` | A covered area is empty | Write it, or drop it from `coverage` |
| `system-overview-empty`, `-overview-long` | OVERVIEW.md is missing, or over 4 000 characters | Write it, or move detail into notes |
| `system-note-long` | A note is over 20 000 characters | Split it |
| `system-layout-invalid` | A layout hint isn't known, or isn't taken there | Use a layout from the table above |
| `system-board-overflow` | The board scrolls sideways | Find the wide entry in the overview and fix it |
| `system-board-preview-wide` | An example is wider than its card | Remove fixed widths and let it wrap, or use `layout: "full"` |
| `system-board-preview-outside` | Part of an example escapes its card | Put absolute parts in a relative frame with `overflow: hidden`; never `fixed` |
| `system-board-text-outside` | Text runs out of its card | Wrap long words and ids, or shorten the text |
| `system-board-hint-small` | The entry needed the full width | Set its layout to `full` |
| `system-board-partial` | Some parts weren't pictured or measured | Check one area at a time |
| `render-skipped` | A pass ran out of time (often the dark pass); the light results are kept | Check with `--area`, or the dark pass alone with `--scheme dark` |
| `browser-missing` | No Chrome, Edge or Chromium | File checks still ran; tell the user |
| `system-build-invalid` | BUILD.json can't be used | Fix the field the sentence names |
| `system-proposal-invalid` | PROPOSAL.json can't be used | Write a new one with a new id |
| `system-living-missing`, `-stale`, `-failed`, `-changed`, `-unsafe`, `-reformatted` | A repo system's living page is missing, behind, unmade, or differs from the generated one | Follow the living page steps in the skill; never edit the page |
| `system-living-secret` | The living page shows something shaped like a secret | Remove it from the system |
| `system-repo-unreadable`, `system-snapshot-changed` | The repo folder can't be read, or its copy changed | Tell the user; they choose the folder or re-sync |
| `system-code-drift`, `-code-differs`, `-landed-differs` | The code and the system disagree, or what landed differs from the diff | Propose a reconcile diff; never write without approval |
