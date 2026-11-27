# Foundations

Read this before you write `tokens.css`, token notes or icons: what to decide, good defaults, and how to write each part. The project's own values come first: when the code already has a value, keep it unless the user chose to fix it.

## How tokens are written

- Light values go in one top-level `:root` block. Dark values go in `:root` inside exactly `@media (prefers-color-scheme: dark)`. No other selectors. Group with comments: `/* Colours */`, `/* Type */`, `/* Space */`.
- A value is at most 100 characters, with no `url(`, `;`, `:`, `*`, braces, angle brackets or backslash. Functions allowed: `rgb`, `hsl`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`, `color-mix`, `var`, `calc`, `min`, `max`, `clamp`, plus `cubic-bezier` and `steps` in motion tokens only.
- `var()`, `calc()`, `clamp()` and `color-mix()` are formulas: the board shows them but the user can't edit them by hand. Write colours as literal hex or `rgb()`. Then the board prints each pair's contrast without a browser. `oklch()` works too, but only the visual check can measure it.
- Each token's entry in `system.json` `tokens` takes `section`, `group` (colours only), `note` (up to 500 characters) and `breakpoint` (sizes only). The note says what the token is for and what it is not for: "Primary actions and links. Never for large fills."
- Names the classifier misses land in `other`. Set `section` yourself for `--control-*`, `--touch-min`, `--icon-*` and `--measure`.

## Colour

### Role vocabulary

These are the preset names. Use them unless the code already has its own.

| Token | Group | For |
|---|---|---|
| `--bg` | surface | The page behind everything |
| `--surface` | surface | Cards, panels, inputs |
| `--surface-2` | surface | Raised or nested areas, table headers, hover rows |
| `--scrim` | surface | The dimmed layer behind modals and sheets, with alpha |
| `--fg` | text | Body text and headings |
| `--fg-muted` | text | Secondary text, placeholders, captions |
| `--border` | border | Dividers and card edges |
| `--border-strong` | border | Input outlines and anything that must be seen (3:1) |
| `--focus-ring` | border | The keyboard focus outline |
| `--accent` | brand | Primary actions, links, selected state |
| `--accent-fg` | brand | Text and icons on `--accent` |
| `--success`, `--warning`, `--danger`, `--info` | status | Status text and icons |
| `--danger-fg` and the other `-fg` | status | Text on a filled status colour |
| `--danger-surface` and the other `-surface` | status | Tinted backgrounds for banners and inline messages |
| `--data-1` to `--data-8` | data | Chart series, in order |

On-colours (`--accent-fg`, `--danger-fg`) go in the same group as their base so they sit next to it on the board.

### Brand colour and product colour

The brand palette is for marketing. The product needs one accent that marks what you can act on. When the interview chose `split`, name marketing colours `--brand-*` (group brand, note "Marketing only") and keep `--accent` for the app. When it chose `one`, `--accent` is the brand colour and there are no `--brand-*` tokens. Either way the accent must pass 4.5:1 as link text on `--bg`. If the brand colour can't, darken it for `--accent` and keep the true brand value as `--brand-primary`. See `brand.md`.

### Neutrals

Build every surface, text and border colour from one grey ramp of 10 to 12 steps. Brand-tinted greys lean toward the brand hue with very low chroma (oklch chroma 0.005 to 0.02). Write the role tokens as literal values taken from the ramp, not as `var(--grey-700)`, so they stay editable and checkable. Keep the ramp itself (`--grey-50` to `--grey-950`, group other) only when the code uses it directly.

### Status

- Success, warning, danger, info: one value each, tuned to the accent.
- Never colour alone. Every status message pairs its colour with an icon and words ("Payment failed", not a red border).
- Yellow and amber fail as text on white. Use a dark amber for `--warning` text and a pale `--warning-surface` behind it.
- Danger is not the accent. If the brand is red, move danger toward crimson or use a different lightness, and say so in both notes.

### Interactive state colours

Name them by suffix, so the check finds them: `--accent-hover`, `--accent-active` (pressed), `--surface-hover`, `--surface-selected`, `--fg-disabled`, `--surface-disabled`. Hover moves lightness 4 to 8 percent, pressed moves twice that, both in the same direction. Selected uses a tint of the accent, not the accent fill. Disabled is quieter but legible (3:1 or more), without opacity on text.

### Data colours

- At least 6 categorical colours, `--data-1` first (the check asks for one when the system shows data; 6 makes a usable chart). Order them by how often a series appears, so two-series charts use the two most distinct.
- Vary lightness as well as hue, so the set still works for red-green colour blindness and in greyscale. Neighbours in the order must differ in lightness by at least 10 points (oklch L).
- Give every data colour a dark value and check it against `--surface` in dark.
- Add a sequential ramp (`--data-seq-1` to `-5`) only when the code draws heatmaps or choropleths.

### Pairs

A pair says what text or part is meant to sit on what. List pairs in `system.json` `pairs` (up to 60): `{ "fg": "--fg-muted", "bg": "--surface", "use": "text", "note": "Captions on cards" }`. `use` sets the level: `text` 4.5:1, `large` 3:1 (24px and up, or 18.66px bold), `ui` 3:1 (input borders, icons, focus rings). `--x-fg` and `--on-x` pair with `--x` automatically; don't list those. Declare at least: `--fg` and `--fg-muted` on `--bg`, `--surface` and `--surface-2`; `--accent` on `--bg` as text; `--border-strong` and `--focus-ring` on `--bg` and `--surface` as ui; each status colour on `--bg` and on its own `-surface`. Both names must be colour tokens of this system with a value.

### Dark mode

- Once any token has a dark value, every colour needs one. On the dark ground the check judges a colour with no dark value by its light value, so its pairs can fail there too.
- Surfaces lighten as they rise: `--bg` darkest (around #111 to #16181b), `--surface` a step up, `--surface-2` another. Avoid pure black unless the brand asks for it.
- Text is off-white (#e8e8ea range), muted text no darker than 60 percent lightness.
- Accents and status colours get lighter and slightly less saturated. Re-check every pair; never just invert the ramp.
- On dark, elevation comes from the lighter surface plus a border.

## Typography

- 6 to 8 styles in `system.json` `type`, each with `id`, `name`, `family`, `size`, `weight`, `lineHeight`, `letterSpacing`, `case` (none, upper, lower or title) and a `note` that says where it is used. A typical set: `display`, `h1`, `h2`, `h3`, `body`, `small`, `label`, `code`. The `note` is the usage map: "Page titles. One per screen." and "Form labels and table headers. Never for body copy."
- Scale: ratio 1.2 for dense product UI, 1.25 for general apps, 1.333 for marketing. Body 16px (15px for dense tools). Body text never below 14px, captions never below 12px.
- Line height: body 1.5, small text 1.4, headings 1.1 to 1.3. Tighten large display type to -0.01em or -0.02em; open uppercase labels to 0.04em to 0.08em.
- Fluid only for display and h1: `clamp(2rem, 1.4rem + 2.5vw, 3.5rem)`. UI text stays fixed.
- Tokens: `--font-display`, `--font-body`, `--font-mono` (always with a fallback stack), sizes `--text-xs` to `--text-3xl`, and `--measure: 68ch` (section typography) for the longest readable line.
- Font files go in `assets/fonts/` and are listed in `fonts` with `family`, `weight` and `style`. List each weight you use.

## Spacing

- A 4px base. Steps `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 24px, `--space-6` 32px, `--space-7` 48px, `--space-8` 64px, `--space-9` 80px.
- Usage, written in the notes: 4 to 8 inside controls, 8 to 12 between related items, 16 to 24 between groups, 32 to 48 between sections, 64 to 80 between page bands on marketing pages.
- Core systems need at least 4 steps. When the interview chose `snap`, map each off-scale value to its nearest step and list every move in the diff.

## Sizing

| Token | Default | Dense tools |
|---|---|---|
| `--control-sm` | 32px | 28px |
| `--control-md` | 40px | 32px |
| `--control-lg` | 48px | 40px |
| `--touch-min` | 44px | 44px |
| `--icon-sm`, `--icon-md`, `--icon-lg` | 16, 20, 24px | 14, 16, 20px |
| `--border-width`, `--border-width-strong` | 1px, 2px | 1px, 2px |
| `--focus-ring-width`, `--focus-ring-offset` | 2px, 2px | 2px, 1px |

Set `section: "sizes"` on each. `--touch-min` applies on phone even when a control looks smaller: pad the hit area, not the drawing.

## Radius

- 3 or 4 steps: `--radius-sm` 4px (checkboxes, tags), `--radius-md` 8px (buttons, inputs), `--radius-lg` 12px (cards, dialogs), `--radius-full` 9999px (pills, avatars, switches).
- Smaller parts get smaller radii. A 12px radius on a 24px chip looks like a pill by accident.
- Nested corners: inner radius = outer radius minus the padding between them, never more. A 12px card with 8px padding holds 4px corners.
- Bottom sheets round the top corners only.

## Elevation and layers

- Four levels, each tied to a surface and a layer, written in each shadow's note: 0 flat (page, inline content), 1 `--shadow-1` (cards that lift on hover, sticky headers), 2 `--shadow-2` (menus, popovers), 3 `--shadow-3` (modals, sheets, toasts).
- Prefer a border at level 1. Dark shadows take more opacity, or `none`.
- Layers, with gaps: `--z-base` 0, `--z-dropdown` 100, `--z-sticky` 200, `--z-overlay` 300, `--z-modal` 400, `--z-toast` 500, `--z-tooltip` 600.

## Grid and breakpoints

- Use the code's breakpoints when it has them. Otherwise: `--bp-sm` 640px, `--bp-md` 768px, `--bp-lg` 1024px, `--bp-xl` 1280px. `--bp-*` names are marked as breakpoints automatically; set `breakpoint: true` on any other name.
- Columns: 4 on phone, 8 from `--bp-md`, 12 from `--bp-lg`. Gutters 16px, then 24px. Page margins 16px on phone, 24px on tablet, 32px or more on laptop.
- Containers: `--container-md` 768px for reading, `--container-lg` 1200px for app content, `--container-xl` 1440px for marketing bands.
- Write the grid as `notes/grid.md` (listed in `notes`): columns, gutters and margins per breakpoint, and what collapses first.

## Icons

Use the set the code already has. Draw or add icons only for what the product shows, and never download a set.

- One SVG per icon in `assets/icons/`, up to 150, listed in `system.json` `icons`: `{ "file": "assets/icons/search.svg", "name": "Search", "note": "Search fields and the search button." }`. `name` (up to 60) defaults to the file name.
- File names are lower-case words with dashes, named for what the icon shows (`trash`), not one use of it (`delete-invoice`).
- One grid and one stroke: the same `viewBox` (usually `0 0 24 24`) and `stroke-width` (1.5 or 2) in every file, outline or filled, not mixed. Differences raise `system-icons-mixed`.
- Paint with `currentColor`, so the product can colour an inlined icon. No scripts, links or embedded images. Keep each file under 32 KB, or it isn't drawn.
- Sizes are the `--icon-*` tokens; the board shows the first four, or 24px with none. Design Chamber draws icon files only as `<img>`, where `currentColor` comes out black, also on the dark ground.
- In component examples, copy the icon in as inline SVG so it takes the text colour.
- Icons show under Assets, reviewed with Brand.

## Motion

Write duration and easing tokens as `motion.md` says.

## Done for this area

Core: at least one surface, text, border and brand colour; 3 or more status colours; 4 or more type styles; 4 or more spacing steps; a radius; at least one pair; a dark value for every colour if dark is on. Full adds state colours, data colours (when charts or tables exist), 6 or more type styles, control sizes, a breakpoint, a shadow, layers, motion tokens and an icon.
