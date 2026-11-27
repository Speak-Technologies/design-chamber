# Components

Read this before you write `components` in `system.json` or any `components/<id>.html`. A component entry is a promise to the people who build with the system: this is the part, these are its variants, sizes and states, here is what it looks like in each, and here is when not to use it.

## 1. Take the inventory first

- List every component the code has before you document any. Look in component folders, the design-system folder if one exists, exported components, and class names that repeat across screens (`.btn`, `.card`, `.badge`).
- Record where each lives in `source`, as a path inside the project ("src/components/Button.tsx"). It is shown as text only.
- Merge near-duplicates. Two buttons that differ only by padding are one component with two sizes. Say what you merged in the note.
- Product core documents what the code has. Don't invent components for a core system. For a full system, add the ones the patterns need (a sheet, a toast, an empty state) and start their note with "Not in the code yet."
- One-off parts used on a single screen are not components. Leave them out.

## 2. The entry

```json
{
  "id": "button",
  "name": "Button",
  "purpose": "Starts an action on this screen.",
  "note": "Use primary once per view, for the main action. Use a link, not a button, to go to another page.",
  "variants": ["primary", "secondary", "ghost", "danger"],
  "sizes": ["sm", "md", "lg"],
  "states": ["rest", "hover", "focus", "active", "disabled", "loading"],
  "tokens": ["--accent", "--accent-fg", "--accent-hover", "--radius-md", "--control-md", "--focus-ring"],
  "source": "src/components/Button.tsx",
  "example": "components/button.html",
  "layout": "compact"
}
```

- `purpose` is one sentence. `note` is usage guidance: when to use it, when not to, and what to use instead. Both are up to 500 characters.
- `variants` and `states` take up to 20 short names each, `sizes` up to 10. `tokens` names up to 40 tokens this system defines. An undefined name is a finding.
- `example` is exactly `components/<id>.html`.
- `layout`: `compact` for small parts (buttons, badges, tags, avatars, switches), `full` for wide ones (tables, navigation bars, toolbars, page headers), `card` for the rest.

## 3. Names to use

- Variants: `primary`, `secondary`, `ghost`, `danger`, `link`; for containers `outline`, `filled`, `elevated`.
- Sizes: `sm`, `md`, `lg`. Add `xs` or `xl` only when the code has them.
- States: `rest`, `hover`, `focus`, `active` (pressed), `disabled`, `loading`, `error`, `selected`, `checked`, `indeterminate`, `open`, `read-only`.

## 4. What each common component needs

| Component | Variants | Sizes | States |
|---|---|---|---|
| Button | primary, secondary, ghost, danger | sm, md, lg | rest, hover, focus, active, disabled, loading |
| Icon button | ghost, secondary | sm, md, lg | rest, hover, focus, active, disabled |
| Link | inline, standalone | | rest, hover, focus, visited where it matters |
| Text input, textarea | | sm, md, lg | rest, hover, focus, disabled, read-only, error |
| Select | | sm, md, lg | rest, hover, focus, open, disabled, error |
| Checkbox | | | rest, hover, focus, checked, indeterminate, disabled, error |
| Radio | | | rest, hover, focus, checked, disabled |
| Switch | | sm, md | rest, focus, checked, disabled |
| Tag, badge | neutral, accent and each status | sm, md | rest, and removable tags: hover, focus |
| Avatar | image, initials, icon | sm, md, lg | rest |
| Card | outline, filled, elevated | | rest, and clickable cards: hover, focus, selected |
| Tabs | line, pill | sm, md | rest, hover, focus, selected, disabled |
| Menu | | | open, item hover, item focus, item disabled, item selected |
| Tooltip | | | open |
| Table | | compact, default | header, row hover, row selected, sorted, empty |
| Dialog, sheet | | sm, md, lg | open, with a scrim |
| Toast, banner, inline message | info, success, warning, danger | | rest, with action, dismissible |
| Progress, spinner | bar, circle | sm, md | determinate, indeterminate |

Any component that lists `hover` also lists `disabled` and a focus state (`focus` or `focus-visible`). A full system's check looks for that. For a link, list `disabled` too and draw it as plain text, which is how a link with no destination should look.

## 5. The example contract

One example per component, showing every variant, size and state you listed as a labelled matrix: rows by variant, columns by state, and one more row for sizes. Label each instance so the check can count it:

- `data-dc-variant="<name>"`, `data-dc-size="<name>"` and `data-dc-state="<name>"` on the element that shows it. One element may carry all three.
- Every name in `variants`, `sizes` and `states` needs at least one labelled instance. Values match without regard to case. For a core or full system, a name with no instance is a `system-states-missing` finding, one per list.
- Add a small visible text label to each row and column (in `--fg-muted`, `--text-xs`), so people reading the board know what they see. The check reads the attributes, not the text.

```html
<style>
  :host { display: block; font: var(--text-sm)/1.4 var(--font-body); color: var(--fg); }
  .grid { display: grid; grid-template-columns: auto repeat(4, max-content); gap: var(--space-3) var(--space-4); align-items: center; }
  .head { color: var(--fg-muted); font-size: var(--text-xs); }
  .btn { height: var(--control-md); padding: 0 var(--space-4); border: 0; border-radius: var(--radius-md); font: inherit; font-weight: 600; }
  .btn.primary { background: var(--accent); color: var(--accent-fg); }
  .btn.primary:hover, .btn.primary.is-hover { background: var(--accent-hover); }
  .btn:focus-visible, .btn.is-focus { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: var(--focus-ring-offset); }
  .btn:disabled { background: var(--surface-disabled); color: var(--fg-disabled); }
  .btn.sm { height: var(--control-sm); } .btn.lg { height: var(--control-lg); }
</style>
<div class="grid">
  <span></span><span class="head">Rest</span><span class="head">Hover</span><span class="head">Focus</span><span class="head">Disabled</span>
  <span class="head">Primary</span>
  <button class="btn primary" data-dc-variant="primary" data-dc-state="rest">Save</button>
  <button class="btn primary is-hover" data-dc-variant="primary" data-dc-state="hover">Save</button>
  <button class="btn primary is-focus" data-dc-variant="primary" data-dc-state="focus">Save</button>
  <button class="btn primary" disabled data-dc-variant="primary" data-dc-state="disabled">Save</button>
</div>
<div class="grid">
  <span class="head">Sizes</span>
  <button class="btn primary sm" data-dc-size="sm">Save</button>
  <button class="btn primary" data-dc-size="md">Save</button>
  <button class="btn primary lg" data-dc-size="lg">Save</button>
</div>
```

This is cut short: the real example has a row for each of the four variants and a Loading column, because the entry lists them.

### Drawing states that need a pointer

Hover, focus and pressed can't happen in a picture. Write each such rule twice in one selector, the real pseudo-class and a class (`:hover, .is-hover`), and put the class on the labelled instance. The example then shows the state and still behaves for real. Disabled uses the real `disabled` attribute (or `aria-disabled="true"` on non-form parts). Loading shows a static spinner and keeps the label width so the button doesn't jump. Error shows the error border and the message under the field, as the form pattern says.

## 6. How examples are drawn

- The example is a fragment, not a document: no `<html>`, `<head>` or `<body>`. It is set into a shadow root inside the board, so its `<style>` only applies inside it and `:host` styles the box around it.
- Scripts never run. Interactive behaviour must be shown as states, not built.
- It is drawn twice when the system has dark values: once on a light ground with the light tokens, once on a dark ground with the dark tokens. Use `var(--token)` for every colour, size and font, and never write your own `prefers-color-scheme` rule. A hardcoded colour shows up wrong on one of the two grounds.
- Nothing loads from the internet. Draw icons as inline SVG with `stroke="currentColor"`. Fonts come from the system's own `fonts`. Images are inline SVG or left out.
- Up to 20 000 characters per file.

## 7. Fitting the card

- No fixed width wider than the card. Use `max-width: 100%`, `flex-wrap: wrap` and grids with `max-content` columns that can wrap.
- No `100vw`, no `100vh`, no `position: fixed`. An overlay (menu, dialog, toast) is drawn inside a frame with `position: relative; overflow: hidden` and a fixed height, and the overlay inside uses `position: absolute`.
- Matrices wider than about 600px take `layout: "full"`. The board also widens a card whose example doesn't fit, but say it with the layout so it is deliberate.
- When the check reports `system-board-preview-wide` or `system-board-preview-outside`, the picture it names shows the part that escapes. Fix the example's width, not the layout, unless the part really needs the full width.

## 8. Done for this area

Core: every component the code has, each with an example that labels every variant, size and state it lists. Full adds focus and disabled on every component that lists hover, and the components the patterns need. While you work, check this area alone: the check tool with `{ "system": "<id>", "area": "components" }`, or the check command with `--area components`.
