# Patterns

Read this before you write `patterns` in `system.json`. A pattern says how components combine to solve one recurring problem, and when to pick one solution over another. Write down the choice the product made, and why, so the next screen makes the same one.

## The pattern entry

```json
{ "id": "navigation", "kind": "navigation", "title": "Navigation", "note": "Top bar on laptop, bottom bar on phone.", "example": "patterns/navigation.html", "layout": "full" }
```

- Kinds: `navigation`, `overlay`, `forms`, `data-display`, `feedback`, `states`, `page`, `responsive`, `motion`, `accessibility`, `voice`, `layout`, `do-dont`, `other`. Use the specific kind; the checklist counts by kind.
- The body goes in `patterns/<id>.md`: the rules, the decision, the exceptions. The `note` (up to 500 characters) is the summary shown on the card.
- The example is exactly `patterns/<id>.html` and follows the component example rules in `components.md`: a fragment, tokens only, no scripts, no remote files, labelled instances. Pattern examples are usually wide, so give them `layout: "full"`.

## Drawing a phone pattern

Draw a 390px phone inside the example: a frame `width: 390px; max-width: 100%; height: 640px; position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg)`. Everything inside uses `position: absolute` against the frame, never `fixed`. Show laptop and phone side by side when the pattern changes between them, a laptop frame first (about 720px wide, scaled down content is fine), then the phone, each with a plain text caption.

## Navigation

Pick by the number of top-level destinations and the depth of the app.

| Pattern | Use when | Don't use when | On phone |
|---|---|---|---|
| Top bar | 2 to 7 top destinations, shallow app, marketing sites | 8 or more destinations, or deep trees | Bottom bar for 3 to 5 destinations, else a menu button opening a sheet |
| Side rail | 8 or more destinations, deep or tool-heavy apps, frequent switching | Content-first apps with 3 sections | Bottom bar for the top 3 to 5, the rest in a "More" sheet |
| Tabs | 2 to 5 peer views of one thing, in one context | Moving between unrelated sections (that is navigation) | Scrollable tabs; never more than 5 visible |
| Bottom bar | 3 to 5 top destinations on phone, each used often | Laptop, or 2 or 6+ destinations | Itself; hidden on laptop |
| Breadcrumbs | 3 or more levels of hierarchy the user moves up through | Flat apps, or as the only navigation | Collapse to a back link with the parent's name |

Rules for all of them:
- The current location is marked with more than colour: weight, an indicator bar, or a filled icon, and `aria-current="page"`.
- Labels are one or two words. Icons alone only in a bottom bar where every icon also has its label.
- One primary navigation per screen. Tabs inside a page are fine; two bars competing are not.
- Bottom bar items are at least `--touch-min` tall and wide. The bar sits above the phone's home indicator (16 to 34px of safe area).

Label the example: `data-dc-variant="top-bar"`, `"side-rail"`, `"bottom-bar"` and so on, and `data-dc-state="selected"` on the current item.

## Overlays

| Overlay | Use for | Don't use for | Dismiss |
|---|---|---|---|
| Bottom sheet | Phone: choices, filters, share, short forms (up to about 4 fields) | Laptop; long forms; anything needing a confirm-then-continue flow | Swipe down, scrim tap, a close or Done button |
| Modal dialog | Laptop: a confirmation, a short focused task, a decision the user must make now | Phone forms (use a sheet or full screen); showing detail the user wants beside the list | Esc, a close button, Cancel; a scrim tap only when nothing is lost |
| Slide-over panel | Laptop: detail or edit of a list item, kept beside the list | Phone (becomes full screen); short confirms | Esc, close button; the list stays usable |
| Full screen | Phone: long tasks, multi-step forms, editors, anything with a keyboard up | Laptop, except editors | Back or close at top left, with a confirm when input would be lost |
| Popover, menu | Small choices near their trigger: actions, a date, a filter | More than about 10 items without search; forms | Esc, a click outside, choosing an item |
| Tooltip | A short label for an icon or a truncated value | Anything the user must read to proceed, or anything with a link | Pointer leaves, Esc, focus moves |

Focus rules: opening a modal, sheet or full-screen overlay moves focus to its first useful control (or its title), traps Tab inside, and on close returns focus to the trigger. Menus and popovers move focus in and close on Esc. Tooltips never take focus. Every overlay has a visible close path besides Esc. Stack at most one modal; a modal never opens another modal.

Sizes: modals sm 400px, md 560px, lg 800px wide, never above 90 percent of the viewport height (the body scrolls, the title and actions stay). Sheets rise to content height, at most 90 percent, with a drag handle and top corners `--radius-lg`. Slide-overs 400 to 560px.

Draw each overlay over a dimmed copy of its screen, with the scrim from `--scrim`, inside the frame.

## Cards and lists on phone

- A list row is at least 48px tall (56 to 72px with a second line), with a full-width hit area. Trailing chevrons only when the row navigates.
- Cards on phone run full width with 16px margins and stack; side-by-side cards start at `--bp-md`.
- A table becomes a card list on phone: one card per row, the row's key value as the title, two to four fields as label and value, actions in a menu.
- Swipe actions are a shortcut, never the only path: the same action is in the row's menu.

## Touch targets

Every interactive part is at least 44 by 44px on phone (`--touch-min`), with at least 8px between targets. A smaller drawing gets padding or a pseudo-element hit area. On laptop 32px controls are fine, with 24px as the floor for icon buttons.

## Forms

- Labels above fields, always visible. Placeholders show a format ("name@example.com"), never the label.
- One column. Pair fields only when they are read together (city and postcode).
- Mark optional fields "(optional)" rather than marking required ones, unless most are optional.
- Validate on blur and on submit, not on each keystroke. Clear an error as soon as the value is fixed.
- Errors sit under the field in `--danger` with an icon, say what to do ("Enter a date after today"), and are tied to the field with `aria-describedby`. On submit with errors, show a summary at the top that links to each field, and move focus to it.
- Submit button: one primary per form, labelled with the action ("Create account"). While submitting it shows loading and is disabled; the form keeps its values on failure.
- Help text under the label or under the field, in `--fg-muted`, at most two lines.

## Data display

- **Tables** for comparing many rows across the same columns. Sticky header, left-aligned text, right-aligned numbers with tabular figures, sort on the header with an arrow, row hover in `--surface-2`. Density: 40px rows default, 32px compact for tools. Over about 7 columns or on phone, switch to cards (above). Empty and loading states inside the table frame.
- **Lists** for one item per row with a few facts, read top to bottom. Group with sticky subheads when there are more than about 20.
- **Charts**: axis labels and units, a legend or direct labels, the data colours in order from `--data-1`, a visible value on hover or focus, and a table or summary text for screen readers. Gridlines in `--border`, never darker than the data. Bar charts start at zero. No 3D, no pie with more than 5 slices.

## Feedback

| Pattern | Use when | Lasts | Example |
|---|---|---|---|
| Toast | Something finished and needs no action | 4 to 6s, longer with an action; pauses on hover and focus | "Draft saved" with Undo |
| Banner | A page-level or app-level condition that persists | Until fixed or dismissed | "You're offline. Changes will sync." |
| Inline message | A problem or hint tied to one part of the page | While it applies | Under a form section |
| Dialog | The user must decide before going on | Until answered | "Delete 3 files? This can't be undone." |

- Toasts stack at the bottom on phone and bottom-left or top-right on laptop, at most 3. They use `role="status"`; errors that block use a banner or dialog, not a toast.
- Destructive dialogs name the thing and the result, with the danger button labelled with the verb ("Delete files"), never "OK".
- Prefer Undo over a confirm for actions that can be reversed.

## States

Every screen and every component that loads or holds data designs these states:

- **Empty**: what will be here, why it is empty, and the next action as a button. First-use empty differs from no-results empty ("No invoices match 'acme'. Clear the search.").
- **Loading**: a skeleton that matches the real layout (same rows, same heights) for waits over about 300ms; a spinner only inside a button or for a small area. No skeleton for under 300ms.
- **Error**: what failed in plain words, whether the user's data is safe, and a Retry. Keep everything that did load.
- **Partial**: some data loaded, some failed. Show what loaded and an inline message where the rest would be.
- **Skeleton** blocks use `--surface-2` with `--radius-sm`, and their pulse stops under reduced motion.

Label each in the example: `data-dc-state="empty"`, `"loading"`, `"error"`, `"partial"`.

## Page types and templates

List the page types the product has (`kind: "page"`): for example list, detail, settings, dashboard, editor, sign-in, onboarding. For each: the regions (header, navigation, main, aside), which pattern fills each, the container width from foundations, and the primary action's place. A small example sketch of the regions in grey blocks is enough for now.

## Responsive rules

One entry with `kind: "responsive"`: what changes at each breakpoint. Navigation (top bar to bottom bar), overlays (modal to sheet or full screen), tables to cards, columns from 12 to 8 to 4, side panels to stacked sections, hover-only affordances get a visible control on touch. Record the platforms answer here: laptop and phone, phone first, or laptop only.

## Done for this area

Core: a voice entry, plus the patterns the code already uses. Full: navigation, overlays, forms, feedback, states, data display (when the product shows tables or charts), accessibility, responsive and motion, each as its own kind, the visual ones with examples.
