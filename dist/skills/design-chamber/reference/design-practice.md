# Design best practices

Part of Design Chamber's design rules (rules/DESIGN-RULES.md §4).

## 4. Design best practices

**Hierarchy**: Build it by position, then size, weight, colour. One primary action per view. A squint test must still show what matters most.

**Type**: Modular scale (×1.2 or ×1.25), 6–8 sizes, all from `tokens.css`. Body 16px minimum on web, line-height ≈1.5; tighten display (≈1.05–1.2). Measure 45–75ch. 2–3 weights per family. Tabular numerals (`font-variant-numeric: tabular-nums`) for data, prices, timers. `text-wrap: balance` on headings, `pretty` on paragraphs.

**Spacing**: 4/8px scale tokens (`--space-1…`), 8 as the base rhythm; 4 only inside dense controls. Align everything to the grid. More space between groups than within them.

**Colour & contrast (WCAG AA)**: 4.5:1 body text, 3:1 large text (≥24px, or ≥19px bold) and UI edges/icons. 70–90% neutral; one accent on ~5–10% of a screen; semantic colours (success/warn/danger/info) only for meaning. Never encode meaning in colour alone. Define light AND dark via custom properties when the project or preset supports both; use `color-scheme`.

**Layout & grid**: Column grid per breakpoint (4 phone / 8 tablet / 12 desktop), fixed gutters. Content max-width ≈1200px; text max ≈68ch; backgrounds may bleed, text lines never. Prefer CSS Grid/flex with `gap`; avoid fixed pixel heights on content.

**Responsive**: Name breakpoints once (from the project, else sm 640 · md 768 · lg 1024 · xl 1280) and reuse them. Reflow, don't shrink: change columns, stacking and navigation per breakpoint. Design phone-first when phones are a target. Touch targets ≥44px. No horizontal scroll on normal content. Clamp fluid type (`clamp()`). A canvas artboard is a viewport: content taller than it scrolls inside; never grow the screen to fit.

**States**: Every data surface shows Loading (skeleton), Empty (what belongs here + next action), Error (what failed + retry), Populated, Edge (1 item, 500 items, very long string, missing field). Every control shows rest, hover, `:focus-visible`, active, disabled. Forms show untouched, invalid (on blur), submitting, success. Cover these on separate screens/artboards or in clearly labelled state variants.

**Accessibility**: Semantic elements first (`header nav main section article footer button a label`); ARIA only to fill gaps. One `<h1>`, headings in order. Every input has a `<label>`; placeholders are not labels. Icon-only buttons carry `aria-label`. Images have `alt` (empty for decorative). Visible `:focus-visible` ring on everything interactive. Full keyboard path. `prefers-reduced-motion` honoured. Set `lang`.

**Motion**: Animate only to explain change. UI transitions ≤300ms, ease-out; no bounce on functional elements. One orchestrated entrance beats scattered micro-effects. Always provide a `prefers-reduced-motion` fallback.

**Real content**: Write copy that says what happens: verbs on buttons, plain nouns on headings. Stress the layout with real extremes (a long name, a missing value, a big number). Never leave a placeholder that looks real.

**Character**: Commit to a direction (tone, one memorable move) and execute it with precision. Restraint and maximalism both work; timid blends do not. Vary light/dark, fonts and layout between designs unless a system says otherwise.
