# Design system builder depth (technical design)

Status: **Phases 1, 2 and 3 built** (2026-11-27). Phase 1: `29c2e33` to `36eec25` on `feat/system-builder-depth`,
cut from `master` at 0.7.0 `e89d866`; §16 records it. Phase 2: `4451ad8` to `27ff325` on `feat/system-phase-2`;
§17 records it. Phase 3: `3ab22b7` to `7fccb2e` on `feat/system-phase-3`; §18 records it. §19 says what the builder
covers now and what it still doesn't. The owner's ask, in their words: "keen to know how we can make this the best most full design
system creator possible where our agent can actually see everything in this app and do everything as well as
claude artifacts and design."

Authorities: `docs/SPEC.md` §6.7 to §6.9 (system contract, copy-on-link, folders) and §9.9 (checks);
`documentation/specs/system-board-layout-and-visual-check.md` (the board check this extends);
`documentation/specs/phase-2-5-technical.md` (§5.7 board, §5.11 living page, §8.8 skill, §8.9 interview).
Every path below was read on this branch unless marked **new file** or **verify**.

The architecture does not change: the agent writes files, the service watches, renders and checks, the
service never writes a project repo, and agent HTML renders only in sandboxed frames or the offline check
browser.

---

## 0. Decisions in one place

| # | Decision | Why |
|---|---|---|
| D1 | The extra depth goes into **reference docs** shipped beside the skill (`reference/<topic>.md`), not into the skill or the prompts. The skill gains a short checklist that names which doc to read before writing each area. | The builder skill is 18 575 of 24 000 characters today. A full checklist with decision tables is 40 000+ characters. Reference docs are read on demand, the way `presets/<id>.md` already ship beside the `design-chamber` skill. |
| D2 | One new round-one question (`depth`) and six round-two calls (`platforms`, `navigation`, `overlays`, `motion`, `scales`, `brand-colour`). Round two stays "asked only when the code raises it", ≤ 8 calls per block. | Round one is about intent and must stay short; everything the code can answer is a round-two call or an assumption. Keeps the "two rounds, never a third" rule. |
| D3 | `system.json` stays `design-chamber/system@1`. Every addition is an optional key or a new value in a closed list. | Old systems read exactly as before; the tolerant readers keep unknown keys. |
| D4 | Patterns and brand entries may carry a **live example** (`patterns/<id>.html`, `brand/<id>.html`) drawn exactly like a component example. | Navigation, sheets, toasts, empty states and hero sections become visible on the board and in the check pictures without a new rendering path. |
| D5 | Component examples label each variant, size and state instance with `data-dc-variant`, `data-dc-size`, `data-dc-state`. The check counts them against the lists in `system.json`. | Turns "states: hover, focus, disabled" from names into a verified matrix the agent and the user can see. Static, so it works without Chrome. |
| D6 | Contrast is checked on declared colour **pairs** (plus automatic `--x-fg` on `--x` pairs): statically in Node when both values parse, otherwise measured in the check browser. | Pairs say what is meant to sit on what; checking every text colour on every surface would be noise. |
| D7 | Completeness is a closed checklist keyed by `system.json` `depth` (`tokens`, `core`, `full`). One `system-coverage-gap` finding per covered area lists the missing topic ids. | The agent gets a closed loop ("what is still missing") with no free text from Design Chamber's side. |
| D8 | The visual check gains a **dark pass** (wide width only, when any dark value exists) and `--area` / `--scheme` flags. | The agent currently never sees its dark values. Flags make the fix loop fast (one area in seconds, not the whole board). |
| D9 | Responsive patterns and page templates (Phase 2) are **system screens**: full documents in `_systems/<id>/screens/<id>.html`, rendered at the system's viewports by the existing design check engine with the full design probe. | A card in a shadow root cannot answer a media query. Screens reuse the design check (contrast, overflow, labels, alt, names) and the canvas wall, so nothing new is invented for "see it at phone width". |
| D10 | Motion and icons become foundation sections in Phase 2, not Phase 1. | They need WP0 type changes (`SystemSection`), new fingerprints, panel rows and living-page work. Phase 1 covers motion as tokens in `other` plus a pattern entry, so nothing is lost meanwhile. |

---

## 1. What the agent is told today (audit)

### 1.1 Sources

| Source | What it carries | Size |
|---|---|---|
| `rules/SYSTEM-QUESTIONS.md` | Two rounds. Round one: `existing` (conditional), `home`, `mode`, `coverage` (foundations, components, patterns, brand), `dark`. Round two: `status-colours`, `greys`, `access`, `typography`, `dark-values`. Inlined verbatim into the skill; parsed by `src/shared/agent/system-questions.ts` (closed topic lists `ROUND_ONE_TOPICS`, `ROUND_TWO_TOPICS`). | 4 772 chars |
| `src/shared/agent/system-skill-doc.ts` | The builder protocol: when it applies, existing systems, the SystemAsk block, the interview, BUILD.json, the file contract, the reviewed diff, the repo steps, access, the never list, the check. | skill 18 575 / `SYSTEM_SKILL_TEXT_MAX` 24 000 (measured from the 0.7.0 build) |
| `src/shared/agent/system-rules.ts` `systemContractSection()` | The file contract (shared by RULES.md and the skill): tokens.css shape, system.json keys, sections and colour groups, token caps, components shape, board layout hints, notes/patterns/brand, coverage, assets, ids. | ~3 000 chars |
| `src/shared/agent/system-prompts.ts` | Make, ask, review, resync, checks, living page, reconcile, build-continue, restyle, update, the build chip, the ticket file. Each fits `HOST_TEXT_MAX` 16 000 or `CHIP_TEXT_HARD_MAX` 15 000. | n/a |
| `rules/DESIGN-RULES.md` | Design rules for designs (not systems): anti-slop, type, spacing, contrast, grid, responsive, states, accessibility, motion, content. Not attached to a system build. | 13 022 chars |
| `rules/presets/*.md` | Ten presets sharing one token vocabulary (`--bg --surface --fg --accent --success … --radius-* --space-* --shadow-1`). No motion, breakpoint or icon lines. | ~1 600 each |
| Board generators (`src/service/systems/board-html.ts`, `specimen-html.ts`, `board-assemble.ts`) | Four areas, twelve sections; swatch, bar, radius box, shadow box, layer diagram, type rows, font rows, component cards with live examples in shadow roots, text cards for notes/patterns/brand, logo cards; layout runs card/compact/full/table. `BOARD_GENERATOR_VERSION` 6. | n/a |
| Living page (`living-html.ts`, `living-page.ts`, `living-examples.ts`) | Same sections through `renderSpecimenSection`; examples as PNGs at 720px ×2. `LIVING_PAGE_GENERATOR_VERSION` 4, `LIVING_EXAMPLE_GENERATOR_VERSION` 2. | n/a |
| System check (`src/service/check/system-static.ts`, `system-run.ts`, `board-analyze.ts`, `board-pictures.ts`) | Static: unreadable, token cap, font missing, entry invalid, layout invalid, value invalid, overview empty/long, note long, example remote, token undefined, coverage empty, build/proposal/living/repo/drift codes. Visual: board at 1526 and 1046px, light only; overflow, preview wide, preview outside, text outside, hint small, partial; overview PNG per area plus full-size tiles. | n/a |

### 1.2 Coverage today, area by area

Depth: **Deep** (contract, board, check), **Medium** (contract and board, no check), **Thin** (a slot exists, no guidance), **Name only** (a word in a list), **None**.

| Area | What exists | Depth |
|---|---|---|
| Colour roles | Groups brand, surface, text, border, status, data, other; light and dark values; swatches per group. No role vocabulary, no interactive state colours (hover, pressed, selected), no on-colour pairs. | Medium |
| Brand vs product colour | One `brand` group. Nothing separates marketing palette from the product accent. | Thin |
| Neutrals | `greys` call (brand-tinted or neutral). | Medium |
| Status and semantic | `status` group, `status-colours` call. No info colour rule, no "never colour alone" rule in the system. | Medium |
| Data viz palette | `data` group only. | Thin |
| Dark mode | Dark values in the `@media` block, derive or hand-tune; board grounds light and dark. The check never draws dark. | Medium |
| Contrast | DESIGN-RULES only. No system check. | None |
| Typography | Type styles (family, size, weight, line height, tracking, case), fonts, type tokens; specimen rows. One-font or display-font call. No usage map (which style for what), no fluid sizes. | Medium |
| Spacing | Tokens with bars. No scale rule for systems. | Thin |
| Sizing | `sizes` section with bars; control heights not named. | Thin |
| Radius | Tokens with boxes. No rule by component size or nesting. | Thin |
| Elevation and shadow | Shadow boxes, z-index diagram. No elevation levels, no dark elevation rule. | Thin |
| Borders | Border colour group only; widths land in `sizes` or `other`. | Name only |
| Grid and breakpoints | `breakpoint` flag on size tokens. No columns, gutters, containers. | Thin |
| Iconography | Nothing (DESIGN-RULES says inline SVG). | None |
| Imagery and illustration | Brand kind `imagery`, text only. | Name only |
| Motion | Nothing; motion tokens fall into `other`. | None |
| Components | `id, name, purpose, note, variants, states, tokens, source, example, layout`; live example per component; undefined tokens checked. | Medium |
| Variants, sizes, states | `variants` and `states` as name lists; no sizes; nothing checks that the example shows them. | Name only |
| Navigation types | Pattern kind `layout`, free text. | None |
| Mobile patterns (sheets, modals, slide-overs, touch targets) | Nothing in systems. | None |
| Forms and validation | Nothing in systems. | None |
| Data display (tables, lists, charts) | `data` colours only. | Thin |
| Feedback (toasts, banners, dialogs) | Nothing. | None |
| Empty, loading, error, skeleton | DESIGN-RULES for designs; nothing in systems. | None |
| Content and voice | Pattern kind `voice`, text. | Medium |
| Accessibility | Nothing in systems. | None |
| Logo use | Logo files with variant and note; brand kind `logo-use`. | Medium |
| Marketing (hero, landing, social, email) | Brand kind `marketing`, text only. | Thin |
| Layout templates and page types | Pattern kind `layout`, text only. | Thin |
| Responsive rules | `breakpoint` flag. | Thin |
| Tokens export | `tokens.css`, the living page for repo homes. | Thin |

### 1.3 What the agent can see today

- **Pictures:** the board at two widths, light scheme, an overview per area plus full-size tiles, under
  `.chamber/check/<run>/`. The CLI lists them and each entry finding names its picture.
- **Measured:** layout only (board overflow, example too wide, example outside its card, text outside, layout
  hint too small).
- **Not seen:** dark values, contrast, whether listed states exist, anything at phone width, motion, icons,
  the real app it came from.
- **Feedback from the user:** section reviews ("needs work" with a note), Ask about an entry or a section,
  Checks badge with "Ask the agent to fix" (static findings only).

---

## 2. Gap analysis

Each row says how the interview asks, where it lands on disk, how the board shows it, how `dc check --system`
verifies it, and the phase. "Ref" names the reference doc that carries the full guidance (§4.1).

| Gap | Interview | Files | Board | Check | Phase |
|---|---|---|---|---|---|
| Colour roles and pairs | none (derived) | `system.json` `pairs[]`; token `note` says the role | **Pairs** sub-block under Colours: "Aa" on the pair, ratio printed | `system-contrast-low` static (hex, rgb) and measured (any colour) in light and dark | 1 |
| Interactive state colours | none | tokens in groups (`--accent-hover`, `--surface-selected`); Ref foundations | swatches | gap topic `state-colours` (full) | 1 |
| Brand vs product colour | R2 `brand-colour` | brand group for marketing, `--accent` family for product; `brand/colour.md` (kind `colour`) | swatches; brand entry with an example | gap topic `brand-colour` (brand area, full) | 1 |
| Data viz palette | none | `data` group; Ref foundations (ordered, colour-blind safe, ≥ 6) | swatches | gap topic `data-colours` when a chart or table component exists | 1 |
| Dark mode | R1 `dark`, R2 `dark-values` (exist) | dark `:root` block | grounds; **dark pass pictures** | dark pass; contrast in dark; gap topic `dark-values` lists colours with no dark value when dark is on | 1 |
| Typography usage | R2 `typography` (exists) | type style `note` says where it is used; Ref foundations | type rows | gap topic `type-styles` (≥ 4 core, ≥ 6 full) | 1 |
| Spacing and radius scale | R2 `scales` (fix mode only) | tokens; off-scale values listed in the diff | bars, boxes | gap topics `spacing` (≥ 4), `radius` (≥ 1) | 1 |
| Sizing (control heights, touch targets) | none | `sizes` tokens (`--control-sm/md/lg`, `--touch-min`) | bars | gap topic `control-sizes` (full) | 1 |
| Elevation and borders | none | shadows, layers, sizes (`--border-width`); Ref foundations | boxes, diagram | gap topics `elevation`, `layers` (full) | 1 |
| Grid and breakpoints | R2 `platforms` | size tokens with `breakpoint: true`; note `notes/grid.md` | bars | gap topic `breakpoints` (full) | 1 |
| Motion | R2 `motion` | P1: tokens `--duration-*`, `--ease-*` (section `other`) and `patterns/motion.md` (kind `motion`). P2: section `motion` | P1: text rows. P2: easing curve drawn as SVG, a demo chip per token | gap topic `motion` (full); P2 `system-motion-no-reduced` | 1, 2 |
| Iconography | none (derived from code) | P2: `assets/icons/*.svg`, `icons[]` | P2: icon grid at each size token | P2: `system-icons-mixed` (viewBox, stroke width) | 2 |
| Imagery and illustration | none | brand kind `imagery` with an example | brand example | gap topic `imagery` (brand, full) | 1 |
| Components: variants, sizes, states | none | `components[].sizes`; `data-dc-*` labels in the example; Ref components | the example as written (agent lays out a labelled matrix) | `system-states-missing`, `system-example-missing` | 1 |
| Component state rendering for real `:hover` / `:focus-visible` | none | none | none | P3: forced pseudo-state pictures | 3 |
| Navigation types | R2 `navigation` | `patterns/navigation.md` + `.html` (kind `navigation`) | pattern example | gap topic `navigation` | 1 |
| Mobile overlays and cards | R2 `overlays` | `patterns/overlays.md` + `.html` (kind `overlay`), phone frame in the example | pattern example in a 390px frame | gap topic `overlays`; P2 as screens at phone viewport | 1, 2 |
| Forms and validation | none | kind `forms` + example | pattern example | gap topic `forms` | 1 |
| Data display | none | kind `data-display` + example | pattern example | gap topic `data-display` | 1 |
| Feedback | none | kind `feedback` + example (toast, banner, dialog) | pattern example | gap topic `feedback` | 1 |
| Empty, loading, error, skeleton | none | kind `states` + example | pattern example | gap topic `states`; P2 state screens | 1, 2 |
| Content and voice | none (exists as kind) | kind `voice` | text card | gap topic `voice` (core) | 1 |
| Accessibility rules | none | kind `accessibility` | text card | gap topic `accessibility`; contrast (above) | 1 |
| Logo use | none | logos + kind `logo-use` | logo cards | gap topic `logo` (brand) | 1 |
| Marketing: hero, landing, social, email | none | brand kinds `marketing`, `social`, `email` with examples; P2 screens kind `marketing` | brand example; P2 screens | gap topic `marketing` (brand, full) | 1, 2 |
| Page templates and page types | none | kind `page` (P1 text + small example); P2 screens kind `page` | P2 Screens view | P2 full design probe per screen per viewport | 1, 2 |
| Responsive rules | R2 `platforms` | kind `responsive`; P2 screens | P2 screens at every viewport | gap topic `responsive`; P2 overflow at phone | 1, 2 |
| Tokens export | none | P3: service-generated `tokens.json` (DTCG) and CSS in an export ZIP | n/a | n/a | 3 |
| Compare with the source project | none | `sources/screens/*.png` (agent or user supplied) | n/a | P3 compare sheet | 3 |

---

## 3. Agent sight and agency

### 3.1 How the agent sees everything

1. **The board, both schemes.** Today's two light passes plus a dark pass at 1526px (D8) for Foundations,
   Components and Patterns, only when the system has a dark value. Pictures named
   `<area>-overview@wide-dark.png`, `<area>@wide-dark[-n].png`.
2. **Every specimen.** Pattern and brand examples ride the component example pipeline (D4), so the overview
   and tiles picture them and the board probe measures them (preview wide, outside, text outside).
3. **Every state.** Labelled instances (D5) are counted statically. Phase 3 adds forced pseudo-states: for
   each element the agent marks with `data-dc-interactive`, the check uses CDP `CSS.forcePseudoState` and
   pictures it in its real `:hover`, `:focus-visible` and `:active` styles.
4. **Every viewport.** Phase 2 system screens render at the system's viewports (`system.json` `viewports`,
   default from the `platforms` answer: Laptop 1280×800 and Phone 390×844) through `renderArtboards` with the
   **design** probe, so the agent gets contrast, overflow, clipped text, labels, alt and names per screen,
   exactly as for a design.
5. **Motion.** Phase 2 draws each easing as a curve and each duration as a bar (static sight). Phase 3 takes a
   four-frame filmstrip of each `[data-dc-motion]` element (CDP `Animation` domain, paused and seeked).

### 3.2 How it compares against the source project

- **Values (today):** code drift (`drift.ts`) counts CSS variables and token JSON; the agent reports the rest
  in BUILD.json `drift`. Unchanged.
- **Inventory (Phase 1):** the reference doc `components.md` tells the agent to list every component the code
  has (with `source`), and `system-coverage-gap` lists components it named in `scan.json` candidates but did
  not document. **verify**: whether `scan.json` holds component candidates today; if not, this part is the
  agent's own count, written into BUILD.json `inventory: { found, documented }` (closed numbers).
- **Look (Phase 3):** the agent or the user drops pictures of the real app into `sources/screens/<id>.png`
  (sources stay agent-only, never copied or published). A screen that names `source: "sources/screens/<id>.png"`
  gets a side-by-side compare sheet in the check (`png-stitch.ts` gains horizontal stitching). The service
  never runs or opens the user's app.

### 3.3 How it iterates

The skill's "Check your work" section becomes a loop (≈ 400 characters):

1. Write one area. 2. `dc check --system <id> --area <area>` (or the tool with `{ system, area }`).
3. Open the overview, then the picture each finding names. 4. Fix, check again. 5. Before saying done: one
full check with no `--area`, no errors, every warning fixed or explained in OVERVIEW.md, and the coverage gap
list empty or each gap named as out of scope in OVERVIEW.md.

Findings stay closed-code sentences; all agent text in them is data in `detail`.

---

## 4. Design

### 4.1 Reference docs (Phase 1, rules + build)

**New folder** `rules/system-reference/` (rules author's content; plain markdown, no em dashes):

| File | Holds (outline the rules author fills) |
|---|---|
| `foundations.md` | Role vocabulary (`--bg --surface --surface-2 --fg --fg-muted --border --accent --accent-fg --accent-hover --focus-ring --success --warning --danger --info`, the preset names, so presets and systems agree); brand palette vs product colour; neutrals from one ramp; status set with icons, never colour alone; data palette (≥ 6, ordered, colour-blind safe, checked in dark); interactive state colours; pairs and their `use` levels; dark mode (surfaces lighten with elevation, desaturate brand, never invert blindly); type scale (6 to 8 styles, a usage map in each style's note, fluid display sizes with `clamp()`); spacing scale (4/8, named steps); sizing (control heights sm/md/lg, `--touch-min` 44px); radius by size (small controls smaller, nested radius = outer minus padding); elevation levels mapped to surfaces and layers; border widths; grid and breakpoints (columns, gutters, container max widths per breakpoint). |
| `motion.md` | Durations (fast ≈ 100 to 150ms, base ≈ 200 to 250ms, slow ≈ 300 to 400ms), easing (ease-out for enter, ease-in for exit, ease-in-out for move), enter and exit patterns per overlay type, what never animates, reduced motion (movement becomes a fade or nothing), how to write `--duration-*` and `--ease-*` tokens, and (Phase 2) the `motion` section. |
| `components.md` | The inventory step (list what the code has, with `source`); the example contract: one labelled matrix per component, rows by variant, columns by state, a size row; `data-dc-variant`, `data-dc-size`, `data-dc-state` on each instance; states every interactive component shows (rest, hover, focus, active, disabled, plus loading, error, selected where they apply); fit rules (no fixed widths wider than the card, no `100vw`, no `position: fixed`, overlays drawn inside a relative frame); `note` as when to use and when not to. |
| `patterns.md` | **Navigation:** top bar (≤ 7 destinations, laptop), side rail (8+ destinations or deep apps), tabs (2 to 5 peers in one context), bottom nav (3 to 5 top destinations on phone), breadcrumbs (3+ levels of hierarchy); what each becomes at phone width. **Overlays:** bottom sheet (phone choices, filters, short forms), centred modal (laptop confirmation, short focused task), slide-over panel (laptop detail or edit beside the list), full-screen (phone long tasks), popover and menu (small choices near the trigger); dismissal and focus rules for each. **Cards and lists** on phone; touch targets. **Forms:** labels above, validation on blur, error text under the field, submit states. **Data display:** tables (when, density, sticky header, phone fallback to cards), lists, charts (axis, legend, the data palette). **Feedback:** toast (transient, no action needed), banner (persistent, page level), inline message, dialog (needs a decision). **States:** empty (what goes here and the next action), loading (skeleton that matches the layout), error (what failed and retry), partial. **Page types and templates; responsive rules.** How to draw a phone pattern inside a card: a 390px frame with `position: relative; overflow: hidden`. |
| `content-and-access.md` | Voice and tone, button verbs, error message shape, numbers and dates; accessibility rules a system records (contrast levels, focus ring token, keyboard paths per component, reduced motion, labels). |
| `brand.md` | Logo use (clear space, minimum size, on light and dark, misuse), brand colour vs product colour, imagery and illustration style, hero and landing patterns, social and email (sizes, safe areas, fonts that fall back in email). |
| `board-and-check.md` | The layout hint table in full, the check flags, how to read the pictures, what each finding means and its usual fix, the coverage checklist per depth (the same table as §4.5). |

**Build** (`scripts/build-skill.mjs`, main agent's shared file, assigned to backend-developer for this task):
copy each `rules/system-reference/*.md` to `dist/skills/design-system-builder/reference/`, refusing a file over
`SYSTEM_REFERENCE_DOC_MAX` (12 000 chars) or a total over `SYSTEM_REFERENCE_TOTAL_MAX` (80 000), a name off
`^[a-z0-9-]{1,40}\.md$`, or a file containing an em dash (one sentence each, the build fails). The host loads
`dist/skills` as a whole (`package.json` `openchamber.contributes.skills`), so the folder ships with the skill
exactly as `presets/` ships with `design-chamber`.

**Pointing at them.** `buildSystemSkillBody(input)` gains `referenceDir: string | null`:
- the built SKILL.md passes `null` and says "in the reference folder next to this file";
- the ticket file (`routes/system-build.ts` `rulesFor`) and RULES.md (`SystemRulesInput.referenceDir`) pass
  the absolute folder `path.join(ctx.packageRoot, 'dist', 'skills', 'design-system-builder', 'reference')`,
  the same root the launcher uses for `dist/cli/dc.mjs` (`src/service/check/launcher.ts:165`). When the folder
  does not exist (a broken install) the line is left out; nothing else changes. No file is written under the
  designs root.

### 4.2 Interview (Phase 1, rules + parser)

`ROUND_ONE_TOPICS` gains `depth`; `ROUND_TWO_TOPICS` gains `platforms`, `navigation`, `overlays`, `motion`,
`scales`, `brand-colour` (`src/shared/agent/system-questions.ts`). The block bakes them with no UI change (the
model in `src/ui/model/system-ask-model.ts` is generic over the set; verified). Draft wording for the rules
author (ids are binding, wording is theirs):

- **Round one** `### How complete should it be? {#depth}`: **Product core** `{#core}` (foundations, the
  components your code has with every state, and the patterns those screens use) · Full system `{#full}`
  (adds motion, icons, navigation, overlays, forms, feedback, data display, page templates and, when covered,
  brand) · Tokens only `{#tokens}` (values and notes, no components or patterns).
- **Round two**, each raised only by a finding:
  - `{#platforms}` (no viewport meta, no breakpoints, or both phone and laptop code paths): **Laptop and
    phone** `{#laptop-phone}` · Phone first `{#phone-first}` · Laptop only `{#laptop}` · Custom `{#custom}`.
  - `{#navigation}` (two nav patterns, or none for phone): **Keep the code's pattern** `{#keep}` · Top bar,
    bottom bar on phone `{#top-bottom}` · Side rail, bottom bar on phone `{#rail-bottom}` · Custom.
  - `{#overlays}` (modals used on phone, or mixed): **Sheets on phone, modals on laptop** `{#sheet}` · Modals
    everywhere `{#modal}` · Keep the code's `{#keep}`.
  - `{#motion}` (transitions in the code with mixed values, or none): **A calm set** `{#calm}` (three
    durations, ease-out in, ease-in out, fades under reduced motion) · Keep the code's values `{#keep}` · No
    motion `{#none}`.
  - `{#scales}` (fix mode only, off-scale spacing or radius values): **Snap to one scale** `{#snap}` (each
    value maps to the nearest step, listed in the diff) · Keep every value `{#keep}`.
  - `{#brand-colour}` (brand area covered and the brand colour is also the product accent): **Brand palette
    for marketing, one product accent** `{#split}` · One colour everywhere `{#one}`.

BUILD.json gains `depth: "tokens" | "core" | "full"` (optional; absent reads as before) and `platforms:
string[]` (≤ 4, the choice ids). `readBuildJson` in `src/shared/system-json.ts` validates both as closed sets;
a wrong value is a BUILD.json problem on that field only, never a refused build. The skill tells the agent to
copy `depth` into `system.json` (the check reads system.json only, so internal and registered systems work).

Marker line examples in the skill gain `depth=core` and `navigation=keep`; the `interview-2` topic list in the
SystemAsk sentence names the new topics.

### 4.3 Contract additions (Phase 1, `system.json`, schema unchanged)

| Key | Shape | Rules |
|---|---|---|
| `depth` | `"tokens" \| "core" \| "full"` | Absent: no gap check. Anything else: ignored with a `system-entry-invalid` problem on `depth`. |
| `components[].sizes` | ≤ 10 short names (as `variants`) | Same reader as `variants`/`states` (`shortList`). |
| `patterns[].kind` | adds `navigation, overlay, forms, data-display, feedback, states, page, responsive, motion, accessibility` to `layout, do-dont, voice, other` | `ENTRY_KINDS` in `system-json.ts:981`. `KIND_LABELS` in `specimen-html.ts:453` gains their labels. |
| `brand[].kind` | adds `colour, social, email` to `marketing, imagery, logo-use, other` | Same. |
| `patterns[].example`, `brand[].example` | exactly `patterns/<id>.html` / `brand/<id>.html` | As `components[].example` (`system-json.ts:922`): another value is an entry problem; the file follows the component example caps (`SYSTEM_EXAMPLE_MAX`). |
| `pairs` | ≤ `SYSTEM_PAIRS_MAX` (60) `{ fg, bg, use: "text" \| "large" \| "ui", note? }` | `fg`/`bg` must be colour token names of this system; unknown names are an entry problem. Auto pairs: every colour token `--x-fg` or `--on-x` whose `--x` exists, `use: "text"`, unless already declared. |
| Example labels | `data-dc-variant`, `data-dc-size`, `data-dc-state` attributes inside `components/<id>.html` (and pattern examples) | Values are matched case-insensitively against the entry's lists. Unlabelled examples are fine for `depth: core` components with no `states`. |

Types (`src/shared/types.ts`, WP0, main agent): `SystemComponent.sizes: string[]`; `SystemEntryText.example:
{ remote: string[] } | null`; `SystemDetail.depth: 'tokens' | 'core' | 'full' | null`; `SystemDetail.pairs:
{ fg: string; bg: string; use: 'text' | 'large' | 'ui'; note: string; auto: boolean }[]`;
`BoardEntryKind` (`src/shared/system-board.ts:14`) gains `pair`. Limits (`src/shared/limits.ts`, WP0):
`SYSTEM_PAIRS_MAX = 60`, `SYSTEM_REFERENCE_DOC_MAX = 12_000`, `SYSTEM_REFERENCE_TOTAL_MAX = 80_000`,
`SYSTEM_GAP_TOPICS_SHOWN = 8`.

Fingerprints (`sectionFingerprints`, `system-json.ts` near line 1278): pattern and brand entries add
`example: fileHash('<folder>/<id>.html')` as components do; `pairs` join the colours fingerprint; `sizes` join
the component fact list; `depth` joins no fingerprint (it is about the checklist, not content). A changed
example resets that section's review, as a changed component example does today.

The contract text (`systemContractSection`) gains three short bullets (pairs; example labels and sizes; the
new kinds with "examples allowed"), each pointing at a reference doc for detail. Budget in §5.

### 4.4 Board and living page (Phase 1)

- `board-assemble.ts` bundles pattern and brand examples one by one exactly as component examples (export
  mode, `remote` collected, failures say "This example couldn't be shown.").
- `specimen-html.ts`: `entryTextCard` and `entryTextRow` take the `example` callback and draw the example
  part above the body; those cards and rows carry `dc-fit` so the board script widens them like component
  cards. The callback signature generalises from `SystemComponent` to `{ kind, id }`.
- **Pairs block** under Colours, after the groups: `<h3>Pairs</h3>`, one cell per pair (`data-dc-entry=
  "pair:<n>"`, `data-dc-pair`), "Aa Text" in `fg` on `bg`, light and dark grounds stacked, the ratio printed
  when Node can parse both values (`parseCssColor` and `contrastRatio` from `src/service/check/color.ts`),
  else "Measured by the check". Takes the colours section layout (card, compact, table).
- Board CSS uses only the `--dc-board-*` variables; no new colour or typeface. `BOARD_GENERATOR_VERSION` 6 → 7.
- Living page: same sections through `renderSpecimenSection`; pattern and brand examples become PNGs through
  `living-examples.ts`. **verify** the example cache key: if it is derived from the component id alone, it
  must gain the entry kind (a pattern and a component may share an id); then
  `LIVING_EXAMPLE_GENERATOR_VERSION` 2 → 3, otherwise it stays 2. `LIVING_PAGE_GENERATOR_VERSION` 4 → 5. New
  CSS passes `livingCssProblems`; `data-dc-pair` is stripped like `data-dc-entry` (`stripEntryMarks`).

### 4.5 System check (Phase 1)

**Static** (`src/service/check/system-static.ts`, codes in `src/shared/checks.ts`):

| Code | Severity | Raised when | Params / detail |
|---|---|---|---|
| `system-example-missing` | info (core), warning (full) | a component (or a pattern of an example-bearing kind at `full`) has no example | count; detail up to 3 ids |
| `system-states-missing` | warning | an entry lists a variant, size or state with no instance labelled `data-dc-<kind>="<name>"` in its example | count, `part` (`variants`/`sizes`/`states`); detail `id: name, name` up to 3 |
| `system-contrast-low` | warning | a pair whose both values parse is under its level (text 4.5, large 3, ui 3), per scheme | count, `scheme`; detail `--fg on --bg 3.1:1 (dark)` up to 3 |
| `system-coverage-gap` | info (core), warning (full) | `depth` set and a covered area misses checklist topics | `area`, count; detail up to `SYSTEM_GAP_TOPICS_SHOWN` topic ids from a closed list |

Example labels are found by a bounded attribute scan of the example text (no DOM, no script): attributes
`data-dc-(variant|size|state)="…"`, values ≤ 40 chars, ≤ 500 per file. **verify** whether
`src/shared/agent/html-extract.ts` already has a tokenizer to reuse before writing one.

The checklist (pure, `src/shared/system-checklist.ts`, **new file**; the reference doc copies it):

| Area | `core` topics | `full` adds |
|---|---|---|
| foundations | `surface`, `text`, `border`, `brand` (≥ 1 colour each), `status` (≥ 3), `type-styles` (≥ 4), `spacing` (≥ 4), `radius` (≥ 1), `pairs` (≥ 1, auto counts), `dark-values` (every colour, only when any dark value exists) | `state-colours`, `data-colours` (when a chart/table component or a `data-display` pattern exists), `type-styles` (≥ 6), `control-sizes`, `breakpoints` (≥ 1 breakpoint size), `elevation` (≥ 1 shadow), `layers`, `motion` (≥ 1 `--duration-*` and ≥ 1 `--ease-*`) |
| components | `components` (≥ 1), `examples` (every component) | `focus-disabled` (a component listing `hover` also lists `focus` and `disabled`) |
| patterns | `voice` | `navigation`, `overlays`, `forms`, `feedback`, `states`, `data-display` (same condition as above), `accessibility`, `responsive`, `motion` |
| brand | `logo` (a logo or a `logo-use` entry) | `brand-colour`, `imagery`, `marketing` |

Topic ids are a closed enum; the sentence says "{Area} is missing {count} things a {depth} system covers" and
the detail lists ids. No agent text reaches the sentence.

**Visual** (`src/service/check/system-run.ts`, `board-analyze.ts`, `src/guest/probe/board.ts`):

- **Dark pass.** When any token has a dark value and `--scheme` is not `light`, after the two light widths
  the board is assembled with scheme `dark` and drawn at the wide width, Foundations, Components and Patterns
  only. Pixel budget shares change from half per width to 0.4 / 0.3 / 0.3 when the dark pass runs; it runs
  last and is cut by the existing render budget (`render-skipped`, reason `budget`) rather than raising it.
  Layout findings from the dark pass are deduped against the light wide pass (same code and entry → one).
- **Pairs measured.** The probe collects `[data-dc-pair]` cells: computed `color` and `background-color`
  converted to sRGB bytes through a detached 1×1 canvas (never attached to the DOM), ≤ `SYSTEM_PAIRS_MAX`
  per pass. `sanitizeBoardProbe` checks the new array (0..255 integers, capped length). Node computes the
  ratio; a pair already judged statically is skipped, so a finding appears once.
- **Flags.** `--area <foundations|components|patterns|brand>` pictures and measures only that area (the
  board document stays whole, so layout is identical); `--scheme <light|dark|both>` (default both when dark
  values exist). Static findings always run in full. `design_check` gains `area` and `scheme` (closed enums,
  `src/plugin/check-tool.ts` `TOOL_INPUT`, `buildChildArgs`). The report records `render.areas` and
  `render.schemes`.

### 4.6 Phase 2 design

**Motion section.** `SystemSection` and `TokenSection` gain `motion` (area foundations, after `shadows`);
`AREA_OF_SECTION`, `SYSTEM_SECTIONS`, the panel's section list and `LAYOUTS_OF_SECTION` (card, compact, table)
follow. Tokens classify into `motion` by `section` meta or names `--duration-*`, `--ease-*`, `--motion-*`
(extract rules). Values pass `validateTokenValue` with a new shape: a time (`ms`/`s`) or an easing
(`cubic-bezier(…)` with four numbers, `linear`, `ease*`, `steps(n)`). Specimen: a duration bar scaled to the
longest duration; an easing curve as an inline SVG path computed in Node from the four numbers (keywords map
to their curves); a demo chip that moves on hover with the token, and does not under reduced motion. Static
check `system-motion-no-reduced` (warning): an example with `transition` or `animation` and no
`prefers-reduced-motion` rule. A Ready system stays Ready when the new section appears: a section key absent
from `readyFingerprints` is not judged (**verify** the readiness code honours this; add a test either way).

**Icons.** `assets/icons/*.svg` listed in `icons: [{ file, name, note }]` (≤ `SYSTEM_ICONS_MAX` 150). Read as
`checkAsset` kind `icon` (the logo SVG rules: no script, no event attributes, no external refs). Drawn as
`<img>` (no script can run) in a grid at each `--icon-*` size token, on light and dark. Static check
`system-icons-mixed` (info): different `viewBox` sizes or `stroke-width` values across the set. Copy-on-link
copies icons to `<design>/system/icons/`. `SYSTEM_FILES_MAX` 200 → 400 so a full set fits (**open question 6**).

**System screens.** `screens/<id>.html`: full documents that link `../tokens.css` (and `../system.css`-style
font CSS generated as for a copy), listed in `system.json` `screens: [{ id, title, kind: "page" | "pattern" |
"state" | "marketing", source? }]` (≤ 24) plus top-level `viewports` (the design.json shape; default Laptop
1280×800 and Phone 390×844, or the `platforms` answer). Cap per file `SYSTEM_SCREEN_MAX` 60 000 chars.
- In app: the system page gains a **Screens** view that reuses the canvas wall and the artboard frame. Route
  **new** `GET /systems/:id/screens/:screen/render?viewport=` and its chunk route, mirroring the design render
  routes: router bearer check, `SYSTEM_ID_PATTERN` and `SYSTEM_ENTRY_ID_PATTERN` on the params, the file from
  `store.filesDir(id)` through `resolveInside`, `bundleDocument` in render mode, the same frame sandbox (no
  `allow-same-origin`) and CSP as design artboards.
- In the check: `runSystemCheck` plans one artboard per screen per viewport after the board passes and calls
  `renderArtboards` **without** `inspect`, so the design probe and `analyze.ts` run unchanged; findings carry
  `file: 'screens/<id>.html'`. Shares `CHECK_ARTBOARDS_MAX` (24) and a new screen budget
  `SYSTEM_CHECK_SCREENS_BUDGET_MS` 60 000; `--screen <id>` limits the run. The tool's 180s kill stays; the
  board render budget and screen budget together fit under it (110 + 60 is over, so the screen pass gets what
  the board left, capped at 60s, and says `render-skipped` `budget` for the rest with "Use --screen <id>").
- Living page: each screen as a PNG per viewport (living-examples pipeline at the viewport width).
  `LIVING_PAGE_GENERATOR_VERSION` +1; `BOARD_GENERATOR_VERSION` +1 (the board lists screens as a link row to
  the Screens view; it does not embed them).
- Snapshot and copy: `repo-read.ts` `textCapOf` gains `screens/` (screen cap) and `kindOf` gains
  `assets/icons/` (icon). Copy-on-link `REFERENCE_PATTERN` (`link.ts:91`) gains `screens/[^/]+\.html` and
  `(patterns|brand)/[^/]+\.html` (Phase 1 for the latter).

### 4.7 Phase 3 outline (designed when started)

Forced pseudo-state pictures (`CSS.forcePseudoState` on `[data-dc-interactive]` inside example shadow roots,
pierced DOM); motion filmstrips (`Animation` domain, four frames per `[data-dc-motion]`); compare sheets
against `sources/screens/*.png` (horizontal stitch); tokens export (service-generated `tokens.json` in the
W3C design tokens format plus `tokens.css` in a system export ZIP, never written to a repo; the agent may
propose copying it in through the reviewed diff); pins on the board (an Ask with an element anchor, reusing
the design pin model).

---

## 5. Size budget

| Text | Today | Phase 1 change | Target |
|---|---|---|---|
| Builder skill (`SYSTEM_SKILL_TEXT_MAX` 24 000) | 18 575 | interview +2 000 (1 + 6 questions, short "why" lines); contract +600; depth checklist and reference pointer +900; iterate loop +400; topic list and markers +150 | ≤ 22 700 (1 300 headroom) |
| Ticket file (skill + `SYSTEM_BUILD_HEADER_MAX` 1 000) | skill + header | absolute reference path (≤ 300) inside the body | fits (`fitOrThrow`) |
| RULES.md | ~4 000 | +600 contract, +1 line reference folder | no cap of its own today; stays under 8 000 |
| Make prompt (`HOST_TEXT_MAX` 16 000) | fits | +1 line "Read the reference docs in <folder> for each area." | `fitOrThrow`, existing fallbacks |
| Reference docs | none | 7 files | ≤ 12 000 each, ≤ 80 000 total |

If the skill passes 22 700 while building, move out in this order and nothing else: (1) the board layout
bullet's long explanation becomes one line pointing at `board-and-check.md` in the **skill only**
(`systemContractSection({ layoutDetail: 'pointer' | 'full' })`, RULES.md keeps `full`); (2) the four marker
line examples become two. The approval, decline, repo and never rules never move out of the skill. A test
asserts the built skill ≤ 22 700 so headroom is visible, plus the existing hard cap test.

---

## 6. Generator versions, snapshot and versions

| Item | Phase 1 | Phase 2 |
|---|---|---|
| `BOARD_GENERATOR_VERSION` | 6 → 7 (pattern and brand examples, pairs) | 7 → 8 (motion, icons, screens row) |
| `LIVING_PAGE_GENERATOR_VERSION` | 4 → 5 | 5 → 6 |
| `LIVING_EXAMPLE_GENERATOR_VERSION` | 2, or 3 if the cache key gains the entry kind (§4.4 verify) | +1 if screen pictures share the cache |
| Committed living pages | judged by their own mark hash (`committedStateOf`), so the bump does not turn them `changed`; they go `out-of-date` only when the revision moves | same |
| Snapshot (`repo-read.ts`) | `patterns/*.html`, `brand/*.html` read with the example cap (today they would get the note cap) | `screens/`, `assets/icons/` |
| `SNAPSHOT.json` | lists new files with no change | same |
| Versions (`.versions/`) | tree hash covers the new files through the store's content walk (`store.ts:479`, depth ok for `patterns/x.html`) | `assets/icons/x` is depth 2 like fonts; ok |
| Copy-on-link | `REFERENCE_PATTERN` gains pattern and brand `.html` | screens as reference; icons as used files |
| Revision | adding labels, pairs or examples is an ordinary system edit: revision bumps, linked designs see "a newer system exists" | same |
| Backward reading | older Design Chamber builds treat a new pattern or brand kind as an entry problem and skip that entry; a downgrade shows "N entries couldn't be read" (known issue, documented) | older builds ignore `motion` tokens' section meta (they land in `other`) |

---

## 7. Failure & Recovery

| Step | Fails how | What the agent or user sees | Way back |
|---|---|---|---|
| Build | A reference doc over its cap, a bad name, an em dash | Build fails with one sentence naming the file | Rules author trims it |
| Reference folder missing at runtime | Broken install | The pointer line is left out; the skill still works | Reinstall |
| Interview | A new topic id in the markdown the parser does not know | Build fails (`"x" is not a round two question the SystemAsk block knows.`) | Land the parser change with the markdown (one commit) |
| BUILD.json | `depth` or `platforms` wrong | BUILD.json problem on that field; build adopted | Agent fixes it |
| system.json | A bad kind, example path, pair name or size list | That entry is a problem ("couldn't be read"), others draw | Agent fixes the entry |
| Example bundle | A pattern example missing or too big | "This example couldn't be shown." on the card | Agent fixes the example |
| Label scan | Over 500 labels or a value over 40 chars | Extra labels ignored; count is what was read | n/a |
| Contrast | A value Node cannot parse | Board says "Measured by the check"; the visual pass measures it; without Chrome it stays unjudged and the CLI says so in its note | Install Chrome or use hex/rgb |
| Dark pass | Out of time | `render-skipped` `budget` for the dark pass; light results kept | `--area` or `--scheme dark` |
| `--area` / `--scheme` | Unknown value | Exit 2 with the usage line | Correct the flag |
| Screens route (P2) | Unknown screen, bad viewport | 404 / 400 with a plain sentence; the Screens view shows "That screen isn't in this system any more." | Reload |
| Screens check (P2) | Over 24 artboards or out of time | `render-skipped` with "Use --screen <id> to check the rest." | `--screen` |

---

## 8. Not Building

- New coverage areas beyond the four (foundations, components, patterns, brand): the new topics are kinds and
  sections inside them, so the board, panel and coverage stay as they are.
- A free-text completeness score: the checklist is closed topics, never a grade.
- Injected captions inside example shadow roots: they would change the agent's layout; the agent labels its
  own matrix.
- A companion canvas design for patterns: considered; drifts from the system because copies are frozen (§6.8)
  and needs a design-level link. System screens do the same job inside the system.
- Running or screenshotting the user's app from the service: outside the service's lane and the loopback
  model.
- Third-party icon set downloads: offline rule; the agent copies the project's own icons or draws them.
- Tailwind preset export: Phase 3 decides formats (open question 3).
- Rail-width check renders: unchanged from the board check spec (a glance surface).

---

## 9. Security & Threat Model

**Roles.** The user (panel and page, through the service with the bearer token), the chat agent (files, the
CLI and the tool, no token), the service. No role gains a capability.

**Surfaces touched.**
- *Reference docs.* Our content, read-only, inside the package. The path comes from `ctx.packageRoot`, never
  from a request or a file. The service writes nothing for them.
- *New `system.json` keys and BUILD.json fields.* Closed enums and capped lists, read with `Object.hasOwn`
  only (`__proto__` is an ignored key), echoed values clipped and cleaned to one line before any `detail`.
- *Pattern and brand examples.* Exactly the component example path: escaped into inert `<template>`s,
  attached to open shadow roots by the board script, inside the board's sandboxed artboard frame (no
  `allow-same-origin`, the frame CSP) and, in the check, under `CHECK_CSP` (`sandbox allow-scripts`,
  `default-src 'none'`, `connect-src 'none'`) over `Fetch` interception, offline, pipe-only CDP. Inline event
  handlers can run there, as for component examples today; nothing reaches the host DOM.
- *Pairs specimen.* Our markup; token names pass `SYSTEM_TOKEN_NAME_PATTERN`, values pass
  `validateTokenValue` before entering CSS, as every swatch does.
- *Probe additions.* Isolated world; a detached canvas (no DOM writes); every number re-checked by
  `sanitizeBoardProbe`; verdicts in Node; sentences from the closed code table.
- *Check flags and tool input.* Closed enums; `--screen` passes `SYSTEM_ENTRY_ID_PATTERN`.
- *Screens (Phase 2).* New routes behind the router's bearer check; ids pattern-checked; the file resolved
  through `store.filesDir(id)` and `resolveInside`; rendered in the same sandboxed artboard frame as design
  screens; the guest never receives the token, the bridge or a route. Untrusted full documents get the same
  treatment as design screens, which is the most-tested path in the product.
- *Icons (Phase 2).* `checkAsset` checks the file is an SVG (it does not inspect its content); drawn only as `<img>`, so script inside an SVG never runs (§16).

**Data exposure.** Pictures stay under `.chamber/` (never versioned, copied, exported or published), as
today. `sources/screens/*.png` (Phase 3) are agent reference, never copied or published; the living page's
secret scan is unchanged.

**Injection.** Reference docs are ours. Agent-written text in examples, notes and screens remains design
guidance only (`SYSTEM_INJECTION_SENTENCE`); none of it can approve a diff.

**Secrets.** No token in any new text, file or picture. The absolute reference path contains the user's home
folder, as the launcher path already does.

## 10. Sandbox & Path Safety

- Frames: board and screens use the existing artboard frame slot (`src/guest/frame-doc.ts`, sandbox without
  `allow-same-origin`, CSP, srcdoc feed). No new frame type.
- Check browser: `CHECK_CSP` (`src/service/check/render.ts`), unchanged.
- Containment: `resolveSystemTarget` (`src/service/check/target.ts`) for the CLI; `resolveInside`
  (`src/service/paths.ts`) for every file read in assembly, the screens route and output; `proposalDirOf` for a
  waiting proposal. No new path logic. Tests: a screen id with `..`, a backslash, a drive letter or a
  differently cased duplicate is refused; a `screens` entry pointing outside `screens/` is an entry problem;
  `--area` and `--screen` values off their patterns exit 2 before any read.

---

## 11. Edge cases

- **Agent writing while the check runs:** detail and files read once; a torn read draws a mixed board; the
  next run is right. Labels and pairs are read from the same snapshot of files as the board.
- **Partial writes:** a half-written example scans fewer labels (a `states-missing` that clears on the next
  run); a half-written system.json is `system-unreadable`.
- **Retries:** a run is idempotent (new run id, report replaced atomically).
- **Empty system:** no gap check without `depth`; with `depth`, every topic is listed (capped), which is the
  point.
- **Designs folder missing or changed:** CLI refuses with exit 2 as today; the screens route answers 404
  after a root change (store resolves against the new root).
- **Theme switch mid-render (app):** the board reloads on a scheme change as today; the pairs block reads its
  colours from the system's own tokens, not the host's.
- **Huge or malformed system.json:** over 1 MiB unreadable; 10 000 pairs → capped at 60 with one entry problem
  stating the cap.
- **Headless Chrome missing:** static checks (labels, static contrast, gaps) still run; the CLI says which
  pairs were not judged; thumbnails unaffected.
- **Service restart:** CLI does not use the service; the screens route is stateless over the render cache.
- **Windows:** reference path printed with backslashes; screen ids are lower-case by pattern, so case
  collisions cannot happen; PNG names through `pngNames`.
- **A system marked Ready when new checks appear:** findings show on the next check; Ready is untouched
  (only the user changes it).
- **Repo home with a waiting proposal:** the check draws the proposal (existing D10); labels, pairs and gaps
  are read from `proposal/` the same way.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Skill over 24 000 | Medium | §5 budget, 22 700 soft test, fixed move-out order |
| Gap checklist nags small systems | Medium | Info at `core`, warning only at `full`; absent `depth` means no check; the agent can name out-of-scope topics in OVERVIEW.md (open question 4) |
| Dark pass makes the check slow | Medium | Wide width only, three areas, runs last, cut by the existing budget; `--scheme light` |
| Label convention ignored by agents | Medium | Reference doc, skill bullet, `states-missing` finding with the picture |
| Canvas colour readback differs from paint (wide gamut) | Low | Canvas is sRGB; ratios are about sRGB contrast anyway; 0.05 tolerance before a finding |
| Older builds skip new kinds | Low | Documented known issue; additive only |
| Screens route widens the attack surface | Medium (P2) | Mirrors the design render routes and their tests one for one |
| `SYSTEM_FILES_MAX` raise increases snapshot work | Low (P2) | Snapshot reads are already bounded per file and per run |

---

## 13. Tasks

Owners: **rules** (the rules author, `rules/**`), backend-developer, ui-ux-developer. WP0 files
(`src/shared/types.ts`, `src/shared/limits.ts`) are applied or authorised by the main agent, who tells every
lane. `scripts/build-skill.mjs` is a main-agent file assigned to backend-developer for T3 only.

### Phase 1 (built; T1 to T9 done, see §16)

Parallel groups: **A** = T1, T2, T4 at once. **B** = T3 after T2's ids are fixed (T2 and T3 land in one
commit). **C** = T5 and T6 at once, after T4. **D** = T7 after T5 and T6. **E** = T8 after T4. T9 last.

### T1 Reference docs (Priority: High | Effort: L; split per file if needed)
**Agent:** rules · **Depends on:** none · **Blocks:** T3 (file names)
**Files:** **new** `rules/system-reference/{foundations,motion,components,patterns,content-and-access,brand,board-and-check}.md`, `rules/README.md`
**Description:** Write the seven docs to the outlines in §4.1, plain words, decision tables for navigation and overlays, the example label convention, the checklist table of §4.5.
**Acceptance:** each ≤ 12 000 chars, total ≤ 80 000; no em dash; every rule testable or concrete (numbers, when to use, when not to); `patterns.md` covers top bar, side rail, tabs, bottom nav, breadcrumbs, bottom sheet, modal, slide-over, full screen, popover, cards, touch targets, forms, tables, lists, charts, toasts, banners, dialogs, empty, loading, error, skeleton; `board-and-check.md` lists every system check code with its usual fix.
**Docs:** `rules/README.md` names the folder.
**Quality gates:** `npm run build` (T3's step checks the caps) · `npm test`

### T2 Interview questions (Priority: High | Effort: S)
**Agent:** rules · **Depends on:** none · **Blocks:** T3
**Files:** `rules/SYSTEM-QUESTIONS.md`
**Description:** Add `depth` to round one and `platforms`, `navigation`, `overlays`, `motion`, `scales`, `brand-colour` to round two, ids as in §4.2, each with the finding that raises it.
**Acceptance:** parses with T3's topic lists; exactly one bold option per single-choice question; total file growth ≤ 2 000 chars; no em dash.
**Docs:** none beyond T9.
**Quality gates:** `npm run build` · `npm test`

### T3 Parser, BUILD.json, skill and pointers (Priority: High | Effort: M)
**Agent:** backend-developer · **Depends on:** T2 (ids), T1 (file names, may be stubs) · **Blocks:** T9
**Files:** `src/shared/agent/system-questions.ts`, `src/shared/agent/system-skill-doc.ts`, `src/shared/agent/system-rules.ts`, `src/shared/agent/system-prompts.ts` (make prompt line), `src/shared/system-json.ts` (`readBuildJson`), `src/service/routes/system-build.ts`, the RULES.md writer (**verify** its caller in `src/service/systems/`), `scripts/build-skill.mjs`, tests under `test/shared/agent/`, `test/scripts/` (**verify** the build-skill test path)
**Description:** Topic lists; `depth` and `platforms` in BUILD.json; `referenceDir` in the skill body and RULES.md; the depth checklist, iterate loop and new topics in the skill; the build copies and caps reference docs.
**Acceptance:** built skill ≤ 22 700 (new test) and ≤ 24 000 (existing); the ticket file names the absolute reference folder; RULES.md does too; a missing folder leaves the line out; a reference doc over its cap, a bad name or an em dash fails the build with one sentence (tests with fixture inputs); an unknown topic still fails the build; BUILD.json with `depth: "huge"` gives a field problem and is still adopted.
**Docs:** `documentation/features/design-systems.md` (the interview), `documentation/features/agent-instructions.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · sandbox/CSP and path containment untouched

### T4 Contract additions (Priority: High | Effort: M)
**Agent:** backend-developer (types and limits through the main agent) · **Depends on:** none · **Blocks:** T5, T6, T8
**Files:** `src/shared/types.ts`, `src/shared/limits.ts`, `src/shared/system-board.ts`, `src/shared/system-json.ts`, `test/shared/system-json.test.ts`
**Description:** `depth`, `components[].sizes`, new pattern and brand kinds, `example` on pattern and brand entries, `pairs` with auto pairs, fingerprints, `pair` entry kind.
**Acceptance:** an old system reads byte-for-byte the same detail plus empty new fields (snapshot test); each bad value is an entry problem on that entry only; auto pairs found for `--accent-fg`/`--accent` and `--on-primary`/`--primary`; a pattern example change changes the patterns fingerprint, a `depth` change changes none; `__proto__` keys ignored; caps with true counts.
**Docs:** `docs/SPEC.md` §6.7 (main agent asks the architect to fold it in when built).
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### T5 Board and living page (Priority: High | Effort: M)
**Agent:** backend-developer · **Depends on:** T4 · **Blocks:** T7 · **Parallel with:** T6
**Files:** `src/service/systems/board-assemble.ts`, `specimen-html.ts`, `board-html.ts`, `living-html.ts`, `living-examples.ts`, `living-safe.ts` (only if a rule needs it), `repo-read.ts`, `link.ts`, tests in `test/service/systems/`
**Description:** Pattern and brand examples on the board and living page; the Pairs block; generator versions; snapshot cap for example `.html`; copy-on-link reference pattern.
**Acceptance:** a pattern example draws in a `dc-fit` card and table row; escaping in every new cell; pairs show the ratio for hex/rgb and "Measured by the check" otherwise; the living page with every new piece passes `scanLivingPage` and `livingCssProblems`; `data-dc-pair` stripped; `BOARD_GENERATOR_VERSION` 7, `LIVING_PAGE_GENERATOR_VERSION` 5, example cache version per §4.4; only `--dc-board-*` variables in new CSS.
**Docs:** `documentation/features/design-systems.md`, `documentation/pages/design-systems.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · board e2e green · untrusted example path unchanged

### T6 Static checks (Priority: High | Effort: M)
**Agent:** backend-developer · **Depends on:** T4 · **Blocks:** T7 · **Parallel with:** T5
**Files:** `src/shared/checks.ts`, **new** `src/shared/system-checklist.ts`, `src/service/check/system-static.ts`, `test/shared/checks.test.ts`, **new** `test/shared/system-checklist.test.ts`, `test/service/check/system-checks.test.ts`
**Description:** `system-example-missing`, `system-states-missing`, `system-contrast-low` (static), `system-coverage-gap`, the label scan and the checklist.
**Acceptance:** each code at its boundary (4.49:1 → finding, 4.5:1 → none; one label missing → finding); severities change with `depth`; gap detail only closed ids; no gap check without `depth`; a threshold changed by one makes a test fail (protocol rule 11); the Checks badge and "Ask the agent to fix" carry the new findings with no UI change.
**Docs:** `documentation/features/design-checks.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass

### T7 Visual check: dark pass, measured pairs, flags (Priority: High | Effort: M)
**Agent:** backend-developer (Opus: probe and check browser) · **Depends on:** T5, T6
**Files:** `src/service/check/system-run.ts`, `board-analyze.ts`, `board-pictures.ts`, `report-text.ts`, `src/guest/probe/board.ts`, `src/cli/dc.ts`, `src/plugin/check-tool.ts`, tests in `test/service/check/`, `test/cli/`, `test/plugin/`
**Description:** The dark pass, the pairs probe and verdicts, `--area` and `--scheme`, tool input.
**Acceptance:** a system with dark values gets `*@wide-dark*` pictures for three areas; without dark values no dark pass; budget cut gives `render-skipped` and keeps light results; an `oklch()` pair under 4.5 is found only by the measured path; a hex pair is reported once; `--area components` pictures only Components and still lists all static findings; bad flag values exit 2; sanitizer rejects out-of-range bytes and over-long arrays.
**Docs:** `documentation/features/design-checks.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · `CHECK_CSP` and containment untouched (named tests)

### T8 Panel shows the new fields (Priority: Med | Effort: S)
**Agent:** ui-ux-developer · **Depends on:** T4
**Files:** `src/ui/systems/**` (**verify** the component detail and pattern list files), `test/ui/**`
**Description:** Component sizes in the detail beside variants and states; new pattern and brand kind labels; pairs listed under Colours; the depth shown on the system's summary line.
**Acceptance:** rail 320 and 480 px and the page, light and dark, in the visual harness; host theme tokens only; copy without em dashes.
**Docs:** `documentation/pages/design-systems.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · every UI state handled

### T9 Docs and SPEC fold-in (Priority: Med | Effort: S)
**Agent:** main agent with the architect · **Depends on:** T3 to T8
**Files:** `docs/SPEC.md` §6.7, §9.9; `documentation/features/{design-systems,design-checks,agent-instructions}.md`; `documentation/known-issues.md` (older builds skip new kinds)
**Acceptance:** every user-visible change described; qa-tester verifies.
**Docs:** as listed.
**Quality gates:** `npm test` (copy scan)

### Phase 2 (built; see §17. Revised 2026-11-27 against what Phase 1 shipped)

Read §16 first: it lists what Phase 1 built and the corrections to §4.6 these tasks rely on. Every file below
was checked on the branch at `36eec25` unless marked **verify**. WP0 files (`src/shared/types.ts`, `src/shared/limits.ts`,
`src/shared/api.ts`) go through the main agent, who applies or authorises each change and tells every lane.

**Waves.**
- **Wave 0 (main agent, one commit):** the WP0 changes of T10, T11 and T12 together (type unions, limits, the
  two new routes' request and response types), so the three backend tasks start from one base.
- **Wave 1 (parallel):** T10a motion contract and checks · T11 icons · T12a screens contract and route. They
  share `src/shared/system-json.ts` and `src/service/systems/specimen-html.ts`: T10a and T11 each touch a
  separate function there; T12a touches `system-json.ts` only. The main agent sequences their merges in
  that order (T10a, T11, T12a) and runs the full gates after the wave.
- **Wave 2 (parallel):** T10b motion specimens on the board and living page (after T10a and T11, because both
  bump the generator versions; T10b does the single bump for the wave) · T12b screens in the system check
  (after T12a) · T14r rules: screens, motion and icons in the reference docs (after T10a, T11, T12a fix the ids).
- **Wave 3 (parallel):** T13 Screens view on the system page (after T12a) · T10c panel rows for motion and
  icons (after T10a, T11) · T14 living page screens (after T12a, T10b).
- **Wave 4:** T15d docs and SPEC fold-in, then qa-tester, then browser-tester for T10c and T13.

### T10a Motion section: contract, classification and checks (Priority: High | Effort: M)
**Agent:** backend-developer (Opus: readiness logic) · **Depends on:** Wave 0 · **Blocks:** T10b, T10c, T14r
**Files:** `src/shared/types.ts` (Wave 0: `SystemSection` and `TokenSection` gain `motion`; `CheckCode` gains `system-motion-no-reduced`), `src/shared/system-json.ts` (`AREA_OF_SECTION` motion → foundations, after `shadows`; `LAYOUTS_OF_SECTION.motion` = card, compact, table; `TOKEN_SECTIONS`; `sectionFingerprints`; `deriveReview`), `src/shared/token-edit.ts` (`classifyToken`, `validateTokenValue` shape for motion), `src/shared/system-checklist.ts` (`motion` topic reads the section), `src/shared/checks.ts`, `src/service/check/system-static.ts`, `src/service/systems/edits.ts` and `src/shared/agent/system-prompts.ts` (their `Record<SystemSection, …>` maps), tests in `test/shared/` and `test/service/check/`
**Description:** Tokens named `--duration-*`, `--ease-*`, `--motion-*`, or with `section: "motion"` meta, classify into the new section. Values validate as a time (`ms`/`s`, 0 to 10 000 ms) or an easing (`cubic-bezier(` four numbers `)`, `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `steps(<1..100>[, start|end])`). The static `system-motion-no-reduced` (warning, components or patterns covered) is raised when a component, pattern or brand example's text declares `transition` or `animation` and holds no `prefers-reduced-motion` media query; one finding, count and up to 3 files.
**Acceptance:**
- An existing system with `--duration-fast` in `other` reads it under `motion`; the Sizes section no longer lists it.
- `deriveReview`: a section absent from `readyFingerprints` is not counted in `changesToReview` (today it would be: `ready[section] !== fingerprints[section]` with `undefined`), so a Ready system made before T10a shows no "changes to review" from the new section alone. Test fails without the change.
- Sizes review of a system whose motion tokens lived in `other` resets once (its fingerprint changes); documented in the feature doc, pinned by a test, accepted (open question 8).
- The `motion` checklist topic is satisfied by ≥ 1 duration and ≥ 1 easing token in the section; the old name rule still counts, so no Phase 1 system gains a gap.
- Every exhaustive `Record<SystemSection, …>` compiles with a `motion` entry (typecheck is the test).
- `system-motion-no-reduced` at its boundary (a `@media (prefers-reduced-motion: reduce)` block clears it; a comment holding the words does not). Changing the matched property list makes a test fail.
**Docs:** `documentation/features/design-systems.md`, `documentation/features/design-checks.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · sandbox/CSP and path containment untouched

### T10b Motion specimens, board and living page (Priority: High | Effort: M)
**Agent:** backend-developer · **Depends on:** T10a, T11 · **Blocks:** T14
**Files:** `src/service/systems/specimen-html.ts` (`partsOf` gains `motion`), `src/service/systems/board-html.ts` (`BOARD_GENERATOR_VERSION` 7 → 8, one bump for T10b and T11), `src/service/systems/living-html.ts` (its section `Record`, `FRAME_CSS`; `LIVING_PAGE_GENERATOR_VERSION` 5 → 6), `src/shared/limits.ts` (Wave 0), tests in `test/service/systems/`
**Description:** A duration draws as a bar scaled to the longest duration; an easing as an inline SVG path computed in Node from its four numbers (keywords map to their standard curves, `steps()` to a staircase); a demo chip moves with the token on hover inside the board frame, with a reduced-motion rule that stops it. All values re-checked with `validateTokenValue` before they enter CSS or the path, numbers clamped, SVG built from numbers only.
**Acceptance:** curves for `ease-out` and `cubic-bezier(0.2, 0, 0, 1)` match fixed path strings; an invalid easing draws the hatched "Can't read this value" box; the living page shows bars and curves without the chip (no hover there) and passes `scanLivingPage` and `livingCssProblems`; board CSS uses only `--dc-board-*` variables.
**Docs:** `documentation/pages/design-systems.md` (board section; coordinate with the UI agent's in-flight edit of that file, see §16).
**Quality gates:** as T10a

### T10c Panel rows for motion and icons (Priority: Med | Effort: S)
**Agent:** ui-ux-developer · **Depends on:** T10a, T11
**Files:** `src/ui/model/system-page-model.ts`, `src/ui/systems/section-panel.ts`, `src/ui/systems/system-page.ts`, `test/ui/system-depth-model.test.ts`, `test/ui/visual/fake-systems.ts`, `test/ui/visual/scenarios/design-system-depth.mjs`
**Description:** The section list shows Motion under Foundations with its tokens (hand-editable when the value is plain, like other tokens); Icons are listed under Assets with name and file. Labels from the section label map, host theme tokens only.
**Acceptance:** rail 320 and 480 px and the page 1400 px, dark and light, in the visual harness; empty state "No motion tokens yet." / "No icons yet."; keyboard reachable; no em dash.
**Docs:** `documentation/pages/design-systems.md`.
**Quality gates:** as T10a · every UI state handled

### T11 Icons (Priority: Med | Effort: M)
**Agent:** backend-developer · **Depends on:** Wave 0 · **Blocks:** T10b, T10c · **Parallel with:** T10a, T12a
**Files:** `src/shared/limits.ts` (Wave 0: `SYSTEM_FILES_MAX` 200 → 400, **new** `SYSTEM_ICONS_MAX` 150), `src/shared/types.ts` (Wave 0: `SystemDetail.icons: { file; name; note }[]`, `BoardEntryKind` `icon`), `src/shared/system-board.ts` (entry pattern `icon:\d{1,3}`), `src/shared/system-json.ts` (`icons` list key, reader), `src/shared/system-checklist.ts` (new topic `icons`, full, foundations: ≥ 1 icon), `src/service/systems/assets.ts` (`AssetKind` gains `icon`: SVG only, `assets/icons/`), `src/service/systems/specimen-html.ts` (`assetUrl` takes `icons`; an icon grid in the Assets section), `src/service/systems/link.ts` (`planCopy` copies listed icons to `system/icons/`), `src/service/systems/repo-read.ts` (`kindOf` → `icon`), `src/ui/model/new-system-model.ts` (the cap sentence reads the constant, no change expected: verify), `src/service/check/system-static.ts`, `src/shared/checks.ts`, tests
**Description:** Icons are SVG files under `assets/icons/`, listed in `system.json` `icons`. Drawn only as `<img>` (an SVG loaded as an image runs no script), at each `--icon-*` size token, on light and dark grounds. Static `system-icons-mixed` (info) when the set's `viewBox` sizes or `stroke-width` values differ, read by a bounded attribute scan of each file (no DOM).
**Acceptance:** a non-SVG under `assets/icons/` is refused by `checkAsset` with its sentence; icons draw as `<img>` (a test asserts no inline `<svg>` from an icon file ever reaches the board); `icons` over 150 is one problem with the true count; 400 files fit and 401 are refused in `assets.ts` and `repo-read.ts`; copies carry only listed icons; `icons` joins `SYSTEM_TOPIC_IDS` (34 ids) and `outOfScope` accepts it; `system-icons-mixed` at its boundary.
**Docs:** `documentation/features/design-systems.md`, `documentation/features/design-checks.md`.
**Quality gates:** as T10a

### T12a System screens: contract, board service and route (Priority: High | Effort: L)
**Agent:** backend-developer (Opus: new route on a risk surface) · **Depends on:** Wave 0 · **Blocks:** T12b, T13, T14
**Files:** `src/shared/types.ts` (Wave 0: `SystemScreen = { id; title; kind: 'page' | 'pattern' | 'state' | 'marketing'; viewports: Viewport[] | null; problem }`, `SystemDetail.screens`, `SystemDetail.viewports`), `src/shared/api.ts` (Wave 0: `GET /systems/:id/screens/render`, `GET /systems/:id/screens/render/chunk`), `src/shared/limits.ts` (Wave 0: `SYSTEM_SCREENS_MAX` 24, `SYSTEM_SCREEN_MAX` 60 000 characters), `src/shared/system-json.ts` (readers; screens fold into the fingerprint of the area their kind belongs to: page, pattern, state → patterns; marketing → brand), `src/service/systems/board.ts` (`renderScreen(id, { screen, version?, proposal? })` beside `render`, same cache, sources and `system` event drop), **new** `src/service/routes/system-screens.ts` (registered where `registerSystemBoardRoutes` is), `src/service/systems/repo-read.ts` (`textCapOf` gains `screens/`), `src/service/systems/link.ts` (`REFERENCE_PATTERN` gains `screens/[^/]+\.html`), `src/service/systems/store.ts` (content walk already reaches depth 1; verify), `src/guest/service-client.ts` (`systemScreen(id, screen, options)` mirroring the board call at `service-client.ts:346`), tests in `test/service/systems/` (route tests beside `board-routes.test.ts`)
**Description:** `system.json` `screens: [{ id, title, kind, viewports? }]` with files `screens/<id>.html` (full documents linking `../tokens.css`; fonts by their own `@font-face` to `../assets/fonts/…`), and top-level `viewports` in the design.json shape (default Laptop 1280×800 and Phone 390×844). A screen's own `viewports` replaces the system's, which is how social and email templates get fixed sizes (decision 5: for example 1200×630 and 600×1200). The route renders one screen like a design screen: per screen, not per viewport (the frame sets the width, as `GET /designs/:slug/render` does).
**Acceptance:**
- Router bearer check (an unauthenticated call is refused, test); `:id` through the store (pattern, containment, no links); `screen` must pass `SYSTEM_ENTRY_ID_PATTERN` and be listed in `screens`; `..`, a backslash, a drive letter, an encoded separator and an upper-case id are refused before any read (tests).
- `bundleDocument` in render mode against the system's files folder (`store.filesDir(id)`, or the version or proposal source as the board does); a screen linking outside the folder gets the bundler's existing refusal.
- A screen over 60 000 characters or a 25th screen is an entry problem; a missing file is "screens/<id>.html is missing.".
- The answer is `RenderMeta`; chunks keyed like board chunks; one system's screen is never readable through another id.
- Copy-on-link carries screens as agent reference; the snapshot reads them with the screen cap.
**Docs:** `documentation/features/design-systems.md`; `docs/SPEC.md` §7 route table (T15d).
**Quality gates:** as T10a · route security tests named in the report

### T12b Screens in the system check (Priority: High | Effort: M)
**Agent:** backend-developer (Opus: check browser) · **Depends on:** T12a
**Files:** `src/service/check/system-run.ts`, `src/service/check/report-text.ts` (`parseArgs`: `--screen` allowed with `--system`; today line 102 refuses it), `src/cli/dc.ts`, `src/plugin/check-tool.ts` (`screens` for a system), `src/shared/limits.ts` (Wave 0: `SYSTEM_CHECK_SCREENS_BUDGET_MS`), `src/shared/system-checklist.ts` (`responsive` also satisfied by a screen of kind page with a phone viewport; `marketing` by a marketing screen), tests in `test/service/check/`, `test/cli/`, `test/plugin/`
**Description:** After the board passes, plan one artboard per screen per viewport and call `renderArtboards` without `inspect`, so the design probe and `analyze.ts` run as for a design (contrast, overflow, clipped text, labels, alt, names); findings carry `file: 'screens/<id>.html'`. `--screen <id>` (repeatable) checks only those screens and skips the board passes.
**Acceptance:**
- Budget: with screens present the board passes keep 70 s and screens get 40 s of the 110 s `SYSTEM_CHECK_RENDER_BUDGET_MS`, so the tool's 180 s kill is never reached; artboards left out give `render-skipped` with "Use --screen <id> to check the rest."; ≤ `CHECK_ARTBOARDS_MAX` (24) screen artboards.
- A phone screen wider than 390 px raises the design overflow finding with `file: 'screens/<id>.html'`.
- Screen PNGs go to the same run folder as `screen-<id>@<viewport>.png` through `pngNames` (case-insensitively unique).
- `--screen` with an id not in the system exits 2 before drawing; `--screen` with `--area` is refused with one sentence.
- No screens → the run is byte-for-byte today's (existing tests unchanged).
**Docs:** `documentation/features/design-checks.md`.
**Quality gates:** as T10a · `CHECK_CSP` and containment untouched (named tests)

### T13 Screens view on the system page (Priority: High | Effort: M)
**Agent:** ui-ux-developer (Opus: new view) · **Depends on:** T12a
**Files:** `src/ui/systems/system-page.ts`, **new** `src/ui/systems/system-screens.ts`, `src/ui/model/system-page-model.ts`, `src/ui/wall/frame-slot.ts` and `src/ui/wall/camera-controller.ts` (reused, not changed), `test/ui/**` (a model test and a visual scenario with fake screens)
**Description:** A Screens tab beside the board shows every screen at each of its viewports on a pannable, zoomable wall. Build it from `createFrameSlot` (the sandboxed artboard frame, no `allow-same-origin`) and the camera controller's pan and zoom; do not reuse `createWall`, which is bound to `DesignDetailResponse`, comments and edits.
**Acceptance:** loading, empty ("No screens yet. Ask the agent to add page templates."), error with Try again, and a screen that fails to render; the tab is hidden for a system with no screens and no `screens` key; reloads on a `system` event and a scheme change; rail 320 and 480 px show a list that opens the page; host theme tokens only; keyboard pan and zoom as on a canvas; browser-tester pass.
**Docs:** `documentation/pages/design-systems.md`.
**Quality gates:** as T10a · every UI state handled

### T14 Living page screens (Priority: Med | Effort: M)
**Agent:** backend-developer · **Depends on:** T12a, T10b
**Files:** `src/service/systems/living-examples.ts` (the shot takes a width and height: today the key's input list holds the constant `LIVING_EXAMPLE_WIDTH` and the height is fixed, so the key must be built from the actual width and height; component shots keep 720 and their keys, so `LIVING_EXAMPLE_GENERATOR_VERSION` stays 2), `src/service/systems/living-html.ts`, `src/service/systems/living-page.ts`, tests
**Description:** Each screen becomes one PNG per viewport on the living page, under its area (patterns or brand by kind), with its title and viewport label. Width is the viewport width at scale 1 (a 1280 px screen at 2× would pass the picture cap).
**Acceptance:** a two-screen system with two viewports yields four pictures; a screen that fails gives the existing "This example couldn't be shown." line; the page passes `scanLivingPage` and the secret scan; `LIVING_PAGE_GENERATOR_VERSION` 6 → 7.
**Docs:** `documentation/features/design-systems.md`.
**Quality gates:** as T10a

### T14r Reference docs and interview for Phase 2 (Priority: Med | Effort: S)
**Agent:** rules · **Depends on:** T10a, T11, T12a (ids) · **Parallel with:** T10b, T12b
**Files:** `rules/system-reference/{motion,foundations,patterns,brand,board-and-check}.md`, and if the skill needs a line, `src/shared/agent/system-rules.ts` `systemContractSection` (backend-developer, under the 22 700 soft budget)
**Description:** Motion as a section with value shapes; icons (folder, list, sizes, one stroke and grid); screens (when a pattern belongs in a screen, the viewports rule, marketing sizes for social and email, fonts by `@font-face`); the checklist table gains `icons`; every new code with its usual fix.
**Acceptance:** caps hold (each ≤ 12 000, total ≤ 80 000); no em dash; the build passes; the skill stays ≤ 22 700.
**Docs:** none beyond the docs themselves.
**Quality gates:** `npm run build` · `npm test`

### T15d Phase 2 docs and SPEC fold-in (Priority: Med | Effort: S)
**Agent:** main agent with the architect · **Depends on:** Waves 1 to 3
**Files:** `docs/SPEC.md` §6.7, §7, §9.19, §14; `documentation/features/{design-systems,design-checks}.md`; `documentation/pages/design-systems.md`; `documentation/known-issues.md` (extend KI-38 to the `motion` section and icons on older builds)
**Acceptance:** every user-visible change described; qa-tester verifies; copy scan passes.

### Phase 3 (built; see §18. Revised 2026-11-27 against what Phase 2 shipped)

Read §17 first. Task ids continue after Phase 2's T15d, so the outline's "T15 to T19" are T16 to T22 here.
Every file was checked on `feat/system-phase-2` at `27ff325` unless marked **verify**. WP0 files go through the
main agent as before.

**Waves.**
- **Wave 0 (main agent, one commit):** WP0 for all of Phase 3: `CheckCode` gains `system-state-unstyled`;
  `SystemScreen.source: string | null`; the token-export and board-comment route types in `api.ts`; limits
  `SYSTEM_STATE_SHOTS_MAX` (60), `SYSTEM_MOTION_FRAMES` (4), `SYSTEM_MOTION_SHOTS_MAX` (24),
  `SYSTEM_COMPARE_SHEETS_MAX` (24), `SYSTEM_COMMENTS_MAX` (200), `SYSTEM_COMMENTS_FILE_MAX_BYTES` (1 MiB).
- **Wave 1 (parallel):** T16 state pictures · T18 compare sheets · T19 token export · T20 board comments
  (service). T16 and T18 both edit `src/service/check/system-run.ts`: T16 owns the board pass hook, T18 the
  screen pass; the main agent merges T16 first.
- **Wave 2 (parallel):** T17 motion frames (after T16: it reuses T16's CDP helper) · T21 pins on the board (UI,
  after T20) · T19u export menu (UI, after T19) · T22r rules for Phase 3 (after T16 to T20 fix the ids).
- **Wave 3:** T22 docs and SPEC fold-in, then qa-tester, then browser-tester for T19u and T21.

### T16 Hover, focus and active pictures (Priority: High | Effort: M)
**Agent:** backend-developer (Opus: check browser) · **Depends on:** Wave 0 · **Blocks:** T17
**Files:** `src/service/check/render.ts` (`InspectPage` gains `forceState(selectorPath, states)` and `computedStyle(selectorPath)`, both over CDP `DOM.getDocument { pierce: true }`, `DOM.querySelector` and `CSS.forcePseudoState`, each through `guard()`), `src/guest/probe/board.ts` (collects instances labelled `data-dc-state` of `hover`, `focus`, `focus-visible`, `active` inside example shadow roots, ≤ `SYSTEM_STATE_SHOTS_MAX`), `src/service/check/board-analyze.ts` (sanitiser for the new list), `src/service/check/system-run.ts` (the wide light pass only), `src/shared/checks.ts`, `src/service/check/report-text.ts`, tests in `test/service/check/` (fake CDP `test/service/systems/fake-cdp.ts`, and one e2e)
**Description:** Phase 1's labels already say which instance shows which state. For each labelled interactive instance the check forces that pseudo-class on the element the agent marked, takes a tight picture of it (`<component>-<state>@wide.png`), and compares its computed `color`, `background-color`, `border-color`, `box-shadow`, `outline` and `transform` with the forced state off. No difference raises `system-state-unstyled` (warning): the example labels a state its CSS doesn't style. `focus` and `focus-visible` with no visible change in `outline` or `box-shadow` also raise it, since a focus state must be seen.
**Acceptance:** a button whose `:hover` changes the background yields a picture and no finding; one with no `:hover` rule yields the finding with the component and state in `detail`; a `:focus-visible` with only a colour change still counts as styled, one with `outline: none` and nothing else does not; forced state is cleared before the next element; ≤ 60 pictures, then one `system-board-partial` note; `--area` other than components skips it; the dark pass doesn't repeat it; nothing new is sent to the page (the probe stays in the isolated world; CDP commands run from Node).
**Docs:** `documentation/features/design-checks.md`.
**Quality gates:** `npm run typecheck` · `npm run build` · `npm test` pass · `CHECK_CSP` and containment untouched (named tests)

### T17 Motion frames (Priority: Med | Effort: M)
**Agent:** backend-developer (Opus) · **Depends on:** T16
**Files:** `src/service/check/render.ts` (`InspectPage.animationFrames(selectorPath, trigger, frames)` over CDP `Animation.enable`, `Animation.setPlaybackRate { playbackRate: 0 }` and `Animation.seekAnimations`), `src/service/check/png-stitch.ts` (a side-by-side stitch beside `stitchPngs`, same bounds), `src/guest/probe/board.ts` (elements labelled `data-dc-motion` in examples, plus the Motion section's demo chips), `src/service/check/system-run.ts`, `src/service/check/report-text.ts`, tests
**Description:** For each motion demo chip and each example element the agent labels `data-dc-motion` (with `data-dc-state` naming its trigger, else hover), the check starts the transition with the forced state from T16, pauses every animation, seeks to 0, 1/3, 2/3 and the end, captures each frame and stitches them side by side into `<entry>-motion@wide.png`. With reduced motion emulated (`Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce`) it takes the end frame once more; if movement (`transform` or position) still runs under reduced motion, it raises nothing new but the picture shows it, and `system-motion-no-reduced` stays the static rule.
**Acceptance:** a 200 ms ease-out chip yields four frames whose chip positions increase; an element with no transition yields one frame and a note in the text; ≤ `SYSTEM_MOTION_SHOTS_MAX` strips; stitched width within `PNG_STITCH_SIDE_MAX`; the run's budget and the tool's 180 s still hold (strips are taken only after the board's tiles, and skipped first under time pressure).
**Docs:** `documentation/features/design-checks.md`.
**Quality gates:** as T16

### T18 Compare screens against the real app (Priority: Med | Effort: M)
**Agent:** backend-developer · **Depends on:** Wave 0
**Files:** `src/shared/system-json.ts` (`readScreens`: optional `source`, exactly `sources/screens/<name>.png` with a safe name, the file present and passing `checkAsset` as a PNG), `src/service/check/png-stitch.ts` (side-by-side stitch, shared with T17; whoever lands second reuses it), `src/service/check/system-run.ts` (the screen pass), `src/service/check/report-text.ts`, tests
**Description:** The agent or the user saves a screenshot of the real app into `sources/screens/` (sources are agent reference only, never copied, exported or published, `docs/SPEC.md` §6.8) and names it as a screen's `source`. After a screen's light artboard at a viewport whose width matches the picture's width (±2 px), the check writes `compare-<id>@<viewport>.png`: the drawn screen on the left, the source on the right, each scaled to the same height. The service never opens, runs or screenshots the app.
**Acceptance:** a source of another width gets one note ("The source picture is 1440 px wide; no viewport of this screen matches."); a missing or non-PNG source is an entry problem and the screen still draws; ≤ `SYSTEM_COMPARE_SHEETS_MAX` sheets; a `source` outside `sources/screens/` (`..`, backslash, drive letter, absolute) is refused by the reader (tests); copy-on-link and the living page never carry it.
**Docs:** `documentation/features/design-systems.md`, `documentation/features/design-checks.md`.
**Quality gates:** as T16 · path containment re-tested

### T19 Token export (Priority: High | Effort: M)
**Agent:** backend-developer (Opus: a new filesystem write) · **Depends on:** Wave 0 · **Blocks:** T19u
**Files:** **new** `src/shared/token-export.ts` (pure: `toDesignTokensJson(detail)`, `toTokensCss(detail)`, `toTailwindTheme(detail)`), `src/service/export.ts` (a system form beside the design one, same destination rules: `settings.downloadsDir ?? Downloads`, else `<root>/.exports`), `src/service/routes/export.ts` (`POST /systems/:id/export`, registered with the reveal registry so `POST /reveal` takes its path), `src/shared/api.ts` (Wave 0), tests in `test/shared/` and `test/service/`
**Description:** One ZIP, `<system id>-tokens.zip`, holding `tokens.json` in the W3C design tokens format (groups by section and colour group; `$type` color, dimension, fontFamily, fontWeight, duration, cubicBezier, shadow where the value parses, else `$type` omitted and the value kept as text; dark values under a `dark` group; `$description` from the token note), `tokens.css` (the system's light `:root` and dark media block, regenerated from validated values, not a byte copy), and, only when the project uses Tailwind, `tailwind-theme.css` (an `@theme` block). "Uses Tailwind" means the system's code source holds `tailwind.config.*` at its root (a `stat`, never a read), the last scan listed a Tailwind config for the agent, or BUILD.json `drift.kinds` names `tailwind-config`. The service never writes a project repo; the agent may propose copying a file in through the reviewed diff.
**Acceptance:** bearer check and the system id through the store; the body is a closed set (`{ formats?: ['dtcg', 'css', 'tailwind'] }`), Tailwind refused with a plain sentence when the project doesn't use it; a formula value is exported as text with no `$type`, never evaluated; a value with `url(` is impossible (re-validated); names that would collide after the DTCG path mapping are suffixed, listed in a `README.txt` in the ZIP; written atomically, the path issued to reveal; works for repo-backed systems from the snapshot (`filesDir`); golden-file tests for all three outputs.
**Docs:** `documentation/features/design-systems.md`; `docs/SPEC.md` §7 (T22).
**Quality gates:** as T16 · the write path and reveal registry named in tests

### T19u Export menu on the system page (Priority: Med | Effort: S)
**Agent:** ui-ux-developer · **Depends on:** T19
**Files:** `src/ui/systems/system-page.ts` (the ⋯ menu), `src/ui/model/system-page-model.ts`, `src/guest/service-client.ts` (the export call, backend-developer adds it in T19), `test/ui/**`
**Description:** "Export tokens…" in the system's ⋯ menu: a small sheet with W3C JSON and CSS checked, Tailwind shown only when the service says the project uses it, then Export, then the same "Saved to Downloads. Show in folder" toast designs use.
**Acceptance:** loading, success, failure with the service's sentence, disabled while exporting; rail and page, light and dark; host theme tokens; no em dash.
**Docs:** `documentation/pages/design-systems.md`, `documentation/pages/rail.md`.
**Quality gates:** as T16 · every UI state handled

### T20 Board comments: storage, routes and the send (Priority: High | Effort: M)
**Agent:** backend-developer (Opus: new routes and a service-owned file) · **Depends on:** Wave 0 · **Blocks:** T21
**Files:** **new** `src/service/systems/comments.ts`, **new** `src/service/routes/system-comments.ts`, `src/shared/api.ts` and `src/shared/types.ts` (Wave 0: `SystemComment = { id, entry: string, body, status: 'open' | 'sent' | 'resolved', created, sentAt }`), `src/shared/agent/system-prompts.ts` (`buildSystemCommentsPrompt`, the `buildSystemAskPrompt` shape over several entries, `fitOrThrow` with the same count-to-fit loop as the checks prompt), `src/service/routes/system-chat.ts` (purpose `comments`), tests
**Description:** A comment is anchored to a board entry key (`isBoardEntryKey`: token, type, font, logo, icon, component, note, pattern, brand, pair, screen once KI-42 lands), not to a selector, so it survives re-generation. Stored in `_systems/<id>/.chamber/comments.json` (service-owned, atomic writes, one queue per system, ≤ `SYSTEM_COMMENTS_MAX`, ≤ 1 MiB, a damaged file renamed aside on the next write as folders do). "Send comments" turns every open comment into one message to the system's linked chat and marks them sent. An entry that no longer exists keeps its comment, shown as "on an entry that's gone".
**Acceptance:** bearer check, id through the store, entry keys validated before any write, body 1 to `COMMENT_BODY_MAX` characters, unknown fields refused; the agent never writes the file (RULES.md says so; `.chamber/` is already off-limits to it); a repo-backed system's comments stay in Design Chamber; the send for a repo-backed system carries the reviewed-diff gate (`repoGate`); retrying a send after a failure does not mark twice (ids); not in versions, copies, exports or the living page.
**Docs:** `documentation/features/design-systems.md`.
**Quality gates:** as T16 · route security tests named

### T21 Pins on the board (Priority: High | Effort: M)
**Agent:** ui-ux-developer (Opus: new flow) · **Depends on:** T20
**Files:** `src/ui/systems/system-board.ts` (a comment mode over the existing hit-test), **new** `src/ui/systems/board-pins.ts` (reuse the look and keyboard model of `src/ui/wall/pin-layer.ts` and `comment-ui.ts`; not the wall itself), `src/ui/model/system-page-model.ts`, `test/ui/**`
**Description:** A Comment toggle on the board: clicking an entry places a pin on it (the board script already reports entry boxes), a small editor takes the text, pins list in the panel, and **Send comments (N)** sends them. In the rail, pins show and can be added; the list sits under the board.
**Acceptance:** loading, empty, error, sending, sent; pins follow their entry after a board reload and a scheme change; a pin on a gone entry is listed, not drawn; keyboard: Tab to pins, Enter to open, Escape to close; rail 320 and 480 px and the page, light and dark; browser-tester pass.
**Docs:** `documentation/pages/design-systems.md`, `documentation/pages/rail.md`.
**Quality gates:** as T16 · every UI state handled

### T22r Rules for Phase 3 (Priority: Med | Effort: S)
**Agent:** rules · **Depends on:** T16 to T20 (ids)
**Files:** `rules/system-reference/{components,motion,board-and-check,patterns}.md`
**Description:** Label interactive instances so the state pictures work and style every labelled state; label motion with `data-dc-motion`; save real-app screenshots to `sources/screens/` and name them as `source`; each new finding with its usual fix. The skill has about 100 characters of room, so nothing new goes in the skill.
**Acceptance:** caps and the em-dash check pass at build; the skill length test stays under 22 700.
**Quality gates:** `npm run build` · `npm test`

### T22 Phase 3 docs and SPEC fold-in (Priority: Med | Effort: S)
**Agent:** main agent with the architect · **Depends on:** Waves 1 and 2
**Files:** `docs/SPEC.md` §6.7, §7, §9.19, §14; `documentation/features/*`; `documentation/pages/*`; `documentation/known-issues.md`
**Acceptance:** every user-visible change described; qa-tester verifies; copy scan passes.

---

## 14. Test plan summary

Unit tests listed per task; the risk-surface ones: `sanitizeBoardProbe` new arrays, the screens route's
bearer and containment tests, `checkAsset` icon refusals, the label scan bounds, the reference build caps.
End to end (`chromeOrSkip`): a fixture system with a dark `oklch` pair under AA, a pattern example in a phone
frame, a component missing its `disabled` instance; the run must report each once and picture each.

---

## 15. Open Questions (only the owner can answer)

1. **Default depth.** Should the recommended answer be Product core or Full system? Recommendation: Product
   core, so a first build finishes in one sitting; Full is one click away.
2. **Responsive patterns and templates.** Screens inside the system (`_systems/<id>/screens/`) or a companion
   canvas design? Recommendation: inside the system (D9).
3. **Tokens export formats** for Phase 3. Recommendation: W3C design tokens JSON plus CSS first; Tailwind
   later if you use it.
4. **How hard the completeness check pushes.** Warning at Full and info at Product core, or info always?
   Recommendation: warning at Full only, and a gap named as out of scope in OVERVIEW.md stops counting.
5. **Marketing surfaces.** Should social and email templates be screens with fixed sizes (for example 1200×630,
   600px email) in Phase 2? Recommendation: yes, as screens of kind `marketing` with their own viewports.
6. **Icon sets and the file cap.** Raise the per-system file cap from 200 to 400 so a full icon set fits?
   Recommendation: yes, with icons capped at 150.
7. **Check time.** The dark pass adds roughly a third to a full check. Default on when dark values exist?
   Recommendation: yes; `--scheme light` and `--area` keep the fix loop quick.

8. **Sizes review after the motion section (Phase 2).** Moving `--duration-*` and `--ease-*` tokens out of
   `other` changes the Sizes fingerprint of systems that had them, so that one section shows "not reviewed"
   once after the update. Accept it, or keep a compatibility fingerprint? Recommendation: accept it; a second
   fingerprint path for one section is more risk than one re-review. **Resolved:** accepted and built that way (T10a, `c291dcb`).

9. **Tailwind export flavour (Phase 3).** Export a Tailwind v4 `@theme` CSS block, or a v3 `theme.extend` JS
   preset? Recommendation: v4 `@theme` only, because it is plain CSS the service writes from validated values
   with no JavaScript, and v3 projects can paste the variables into `extend` themselves.
10. **Board comments for repo-backed systems (Phase 3).** Keep them in Design Chamber only, never in the repo?
    Recommendation: yes; they are review notes for the chat, like a design's comments.

---

## 16. Phase 1 as built (2026-11-27)

Commits on `feat/system-builder-depth`: rules `29c2e33`, `fbcc579`, `0512514`; T4 to T7 `d589496` to `b05acfb`;
T8 `89532d9`; follow-up `582d976`; T3 `36eec25`; T9 (this fold-in). `docs/SPEC.md` §6.7 and §9.19 carry the
shipped contract and checks; §14 "System builder depth, Phase 1" lists the deviations in short.

**Shipped as designed:** reference docs and their build caps (§4.1); `depth` plus six round-two calls (§4.2);
`depth`, `pairs` with automatic pairs, `components[].sizes`, the new kinds, pattern and brand examples, example
labels (§4.3); the Pairs block, examples on the board and living page, `BOARD_GENERATOR_VERSION` 7,
`LIVING_PAGE_GENERATOR_VERSION` 5 (§4.4); the four static codes, the dark pass, measured pairs, `--area` and
`--scheme` on the CLI and the tool (§4.5).

**Where the build differs:**

| Design said | Built | Why it matters for later work |
|---|---|---|
| `buildSystemSkillBody` takes `referenceDir: string \| null` | `reference: 'beside' \| { folder } \| null`; RULES.md and the make prompt take `referenceDir`; the folder comes from `findSystemReferenceDir(ctx.packageRoot)` in `src/service/routes/presets.ts` | New pointers use the same function |
| `system-states-missing` with `params.part` | `params.listed` (`variants \| sizes \| states`); component examples only | Pattern examples carry no label check; a later task may add it |
| A gap is "named as out of scope in OVERVIEW.md" | `system.json` `outOfScope`: 33 closed topic ids (`SYSTEM_TOPIC_IDS`), ≤ 40, unknown ids one problem; the agent asks the user first | New topics (T11 `icons`) extend the closed list |
| Example checks at any depth | `system-example-missing` and `system-states-missing` only at `core` and `full` with components covered; pair contrast at any depth | |
| Contrast maths in `src/service/check/color.ts` | `src/shared/color.ts` and `src/shared/pair-contrast.ts` (`MEASURED_PAIR_TOLERANCE` 0.05), so the panel shows the same ratios | UI can import them |
| Example cache maybe +1 | `LIVING_EXAMPLE_GENERATOR_VERSION` stayed 2 (key is content) | T14 keeps that rule |
| `BUILD.json` `platforms` free | closed `BUILD_PLATFORMS`: `laptop-phone phone-first laptop custom`, each once | |
| Skill target ≤ 22 700 | ≈ 22 600; the board layout rule moved out first (`layoutDetail: 'pointer'`) as §5 planned | Phase 2 has about 100 characters of skill room: new guidance goes in reference docs |
| `SystemSummary` unchanged | `SystemSummary.depth` added for the list rows | |

**Corrections to §4.6 found while revising Phase 2** (the tasks in §13 already use these):
- `checkAsset` does not inspect SVG content for script or external refs. Safety for icons comes from drawing them
  only as `<img>`, as logos are; T11 does not add an SVG sanitiser, and its acceptance asserts no icon is inlined.
- Design screens render per screen, not per viewport (`GET /designs/:slug/render?screen=`); the system screens
  route does the same (`GET /systems/:id/screens/render?screen=`), and the frame sets the width.
- `deriveReview` counts a section missing from `readyFingerprints` as changed, so a new section would show
  "changes to review" on every Ready system; T10a changes that.
- The 110 s render budget plus browser start leaves no room for a separate 60 s screen budget under the tool's
  180 s kill; T12b splits the 110 s instead (70 board, 40 screens).
- The canvas wall (`createWall`) is bound to `DesignDetailResponse`; T13 builds the Screens view from
  `createFrameSlot` and the camera controller instead.
- Screens get no review section of their own: they fold into the patterns or brand fingerprint by kind.

**Open after Phase 1:** the UI agent's systems-list depth work (`src/ui/**`, `test/ui/**` and an uncommitted
edit to `documentation/pages/design-systems.md`) is in flight and was not part of T9; KI-38 records the older
builds' behaviour.

---

## 17. Phase 2 as built (2026-11-27)

Commits on `feat/system-phase-2` (it contains `master` with Phase 1): Wave 0 `4451ad8`; T10a `c291dcb`; T11
`6b54c09`; T10b `91569db` (with the `currentColor` icon filter); plain motion aliases `1336446`; T12a `dd3a5bc`;
T12b `c01c969`, `a240d4b`; T14r `8cb02ec`, `f96df3a`; T10c `222537f`; T13 `186f07f`; T14 `27ff325`; T15d (this
fold-in). `docs/SPEC.md` §6.7, §7, §9.19 and §14 carry what shipped.

**Shipped as designed:** the Motion section with time and easing values, bars, curves and demo chips; the
`deriveReview` fix for sections added after Ready; icons drawn only as `<img>` with the 400 file cap, the 150 icon
cap and the `icons` topic; screens with their own fixed viewports, the route, the check with the design probe,
the Screens view, screens on the living page; `system-motion-no-reduced` and `system-icons-mixed`.

**Where the build differs:**

| Design said | Built |
|---|---|
| The rail list opens the page for the full wall | The SDK has no `openSurface` for an extension's own full-screen page, so the rail lists the screens and shows one screen at a time; the page shows the whole wall |
| (not stated) | Screens don't preview pending value edits; the board does |
| Living page screens per viewport (scale not fixed) | At the viewport's size, scale 1, light only; `LIVING_PAGE_GENERATOR_VERSION` stays 6 (T10b's bump covered the wave), example cache stays 2 (a screen's key adds width, scale and height) |
| `responsive` met by "a phone viewport" | A `page` screen with a viewport at most 480 px wide (`PHONE_VIEWPORT_MAX_WIDTH`) |
| Budget split 70 / 40 | As designed, and `--screen` alone skips the board and gets the whole 110 s |
| (not stated) | No route serves a single icon file; the panel reads icon pictures from the board's data URLs |
| Board lists screens as a link row to the Screens view (§4.6) | Not built: KI-42, with a fix prompt |
| Motion aliases not designed | A plain `var(--x)` with no fallback previews through up to four hops |
| Icons on light and dark | Plus a filter so a `currentColor`-only icon takes the ground's text colour; files over 32 KB aren't drawn |
| Screens check in light | Also dark (`<viewport>-dark`) when the system has dark values; a finding names only its own screen's sizes (`a240d4b`) |

**Corrections to the Phase 3 outline found while revising it** (the tasks above already use them):
- Phase 1's `data-dc-state` labels already mark which instance shows which state, so hover and focus pictures
  force the state on those instances rather than on a new `data-dc-interactive` mark.
- `InspectPage` has no raw CDP access (`evaluate`, `scrollTo`, `capture`, `save`); T16 adds two guarded methods
  rather than handing CDP to the hook.
- `stitchPngs` stacks vertically only; frames and compare sheets need a side-by-side stitch.
- Design comments anchor to selectors and live in `design.json`; board comments anchor to entry keys and live in
  `.chamber/`, so the wall's pin layer is reused for its look, not its model.
- Exports already have a destination and reveal registry (`src/service/export.ts`); token export reuses them.
- Tailwind detection needs no project read: a `stat`, the last scan's list, or the agent's BUILD.json drift kind.

## 18. Phase 3 as built (2026-11-27)

Commits on `feat/system-phase-3`: Wave 0 `3ab22b7`; T19 `b80c155`, `1d91143`; T20 `9389b67`, `3149d3e`; T16
`2178351`; T19u `3f8945a`; T18 `96a51c8`; T17 `9825022`; T21 `30cbc06`; T22r `7fccb2e`; the backend follow-up
`846f561` (hints on `system-state-unstyled`, examples first in the motion cap); T22 `1e2e4a9`. The hints are in
the table below. `docs/SPEC.md` §6.7, §7, §9.19 and §14 carry what shipped.

**Shipped as designed:** forced hover, focus, focus-visible and active pictures with `system-state-unstyled`;
motion strips; compare sheets from `sources/screens/`; the token ZIP (W3C design tokens 2025.10, regenerated
CSS, Tailwind v4 `@theme` only when the project uses Tailwind, decision 9) to the export folder with Show in
folder; board comments in `.chamber/` for every home (decision 10) with five routes, the `comments` prompt and
pins on the board in the rail and the page.

**Where the build differs:**

| Design said | Built |
|---|---|
| `POST /systems/:id/export` | Also `GET /systems/:id/export`, which answers the formats a system offers, so the sheet shows Tailwind only when it applies |
| Tailwind found by a config stat, the last scan's list or BUILD.json drift | A fourth way: a CSS file the scan read with `@import "tailwindcss"`, recorded as `sources.code.tailwind` |
| PNG sources | PNG or JPEG; a JPEG (or a PNG Node can't decode) is decoded by the check browser, offline, from a data URL |
| Compare sides scaled to one height | Full size and top-aligned, the shorter side padded, ≤ 20 megapixels |
| Four motion frames | Four, plus a fifth at the end under `prefers-reduced-motion: reduce` |
| WP0 as listed | Plus `'states'` and `'motion'` in `CheckParams.pictured`, `system-compare-skipped`, `'comments'` in `SystemChangeKind`, `sources.code.tailwind` |
| Comments marked sent after the send | Marked when handed over: sent, appended to a busy chat's box, or queued in the outbox (KI-43) |
| States forced on the labelled instance | On its rest twin (same variant and size) when the example has one, so an `is-hover` copy can't hide a missing `:hover` |
| `system-state-unstyled` names the component and its states | Also `params.hint` when the check can tell why: `rest` (no rest twin, so the state was forced on the labelled copy), `focus-visible` (labelled focus but only `:focus-visible` is styled) or `both`; the sentence adds the matching fix |
| (not stated) `PATCH` comment status open, sent or resolved | Open or resolved only; sent is set by mark-sent alone, so a sent comment always has its `sentAt` |

---

## 19. Where the builder stands after three phases

**What it covers now.** The interview asks how complete a system should be and raises platforms,
navigation, overlays, motion, scales and brand colour only when the code does. Seven reference docs carry the
depth the skill can't. A system holds:
- colour groups with pairs whose contrast is checked in light and dark;
- type, spacing, sizing, radius, elevation, layers, breakpoints, a Motion section and an icon set;
- components whose variants, sizes and states are labelled, counted, and forced and pictured in their real
  hover, focus and active styles;
- ten pattern kinds and three new brand kinds with live examples;
- page, pattern, state and marketing screens at the system's or their own fixed sizes;
- a completeness checklist of 34 topics, with `outOfScope` for what the user agreed to leave out.

The agent sees the board at two widths and in dark, every screen at every viewport with the design checks,
state pictures, motion strips and side-by-side comparisons with the real app, and fixes one area at a time with
`--area`, `--scheme` and `--screen`. The user reviews on the board, pins comments to entries and sends them to
the chat, and exports tokens as W3C JSON, CSS and, when used, Tailwind.

**What it still doesn't cover, most valuable first:**
1. **Accessibility inside component and pattern examples.** The board check measures layout, pair contrast and
   forced states. It never runs the contrast, label, name or alt checks inside an example, and nothing checks
   keyboard order or focus traps in overlays. Screens get those checks; examples don't.
2. **Capturing the real app.** Comparison needs a screenshot someone saved into `sources/screens/`, and the
   sheet is side by side with no measured difference. Design Chamber never opens the app.
3. **States and motion beyond components.** Labels are counted and states forced on component examples only.
   Pattern examples and screens (a menu open, a sheet half up, a form in error) aren't state-checked.
4. **Comments on screens.** Pins sit on board entries only; a screen can't take a pin.
5. **The board doesn't point to screens** (KI-42), so templates are easy to miss there.
6. **More export targets.** No Style Dictionary platforms, Figma variables, iOS or Android, and no Tailwind v3
   preset. Getting tokens back into the project is still the agent's reviewed diff.
7. **Comment delivery** reads Sent before the agent has the message in two cases (KI-43).
8. **Data display beyond colours.** Charts and tables are patterns the agent writes; there is no chart specimen,
   and "draws data" is guessed from names.
9. **Voice and content are words only.** Nothing checks button verbs, error message shape or reading level.
10. **Smaller gaps.** The living page draws screens in light only; the rail shows one screen at a time; screens
    don't preview pending value edits; the dark pass runs at the wide width only; rail widths are never checked.

---

Architecture Complete → main agent (task breakdown) | → main agent (relay §19 to the user)

## Decisions (the user, 2026-11-27)
These answer the open questions above and are binding for every task.
1. Default depth: recommend the core set, and the interview asks whether the user wants the full system instead.
2. Responsive patterns and page templates live as screens inside the system folder.
3. Token export (Phase 3): W3C design tokens JSON plus CSS first; Tailwind only when the project uses it.
4. Completeness check: warnings only for full systems; a gap the agent marks out of scope stops counting.
5. Social and email templates: fixed-size screens in Phase 2.
6. System file limit 200 to 400, icons capped at 150.
7. The dark pass is on by default whenever a system has dark values.
8. Scope: all three phases are built in this run, one PR per phase, each merged before the next starts.

## Decisions for Phase 3 (the main agent, 2026-11-27)
9. Tailwind export: a v4 `@theme` CSS block only, written from checked values.
10. Board comments on repo-backed systems stay in Design Chamber, never in the repo, the same as a design's comments.
