# Motion

Read this before you write duration or easing tokens, the motion pattern, or any example with a `transition` or `animation`. Motion in a product UI has three jobs: confirm an action (a press, a toggle), show where something came from or went (a sheet rising from the bottom edge), and keep the user oriented while a layout changes. Anything else is decoration. Leave it out of product screens and keep it for marketing, if anywhere.

## What the interview decided

- `calm` (the default): three durations, ease-out to enter, ease-in to leave, ease-in-out to move, and fades only under reduced motion. Use the values below.
- `keep`: record the code's own values. Map each to the nearest of the three names and put the code's original value in the note ("Code uses 180ms and 220ms; both map here").
- `none`: no motion tokens. Write the motion pattern with one line, "State changes are instant." The user's answer is their approval, so add `motion` to `outOfScope` in `system.json`. That one id clears both the motion tokens and the motion pattern.
- Not asked (the code had nothing to raise it): use `calm` and state it as an assumption in OVERVIEW.md.

## Tokens

| Token | Value | For |
|---|---|---|
| `--duration-fast` | 120ms | Hover, press, toggles, checkboxes, small fades, tooltips |
| `--duration-base` | 200ms | Menus, popovers, toasts, accordions, tabs |
| `--duration-slow` | 320ms | Modals, bottom sheets, slide-overs, full-screen panels |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Things entering or appearing |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Things moving or resizing while on screen |

- Motion is its own section in Foundations. Names starting `--duration-`, `--ease-` or `--motion-` go there when the value fits; set `section: "motion"` in `system.json` for any other name.
- A value is one time or one easing. A time is `ms` or `s`, from 0 to 10 s. An easing is `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(x1, y1, x2, y2)` with both x from 0 to 1, or `steps(n)` with n from 1 to 100 and an optional `, start` or `, end`.
- `cubic-bezier()` and `steps()` are valid only in the motion section. No shorthands such as `200ms ease-out` in one token.
- The section takes the layouts `card`, `compact` and `table`.
- The board draws a duration as a bar against the longest, and an easing as its curve, each with a demo chip that plays it on hover. A plain alias, `var(--x)`, previews what it leads to; other formulas get no preview.
- Exits are faster than entries, about two thirds of the time. A modal enters in `--duration-slow` and leaves in `--duration-base`.
- Nothing in product UI runs longer than 400ms. Larger distance earns a little more time; small parts never get the slow token.
- Durations never change in dark mode. Don't give these tokens dark values.

## Enter and exit by element

| Element | Enter | Exit | Notes |
|---|---|---|---|
| Tooltip | fade, fast, after a 400 to 600ms hover delay | fade, fast, no delay | Appears at once on keyboard focus |
| Popover, menu | fade plus scale 0.96 to 1 from the trigger side, base | fade, fast | Origin at the trigger |
| Modal | scrim fades, dialog fades and scales 0.98 to 1 or rises 8px, slow | fade, base | Focus moves in after the animation starts, not after it ends |
| Bottom sheet | slides up from below the screen edge, slow, ease-out | slides down, base, ease-in | Drag to dismiss follows the finger, no easing |
| Slide-over | slides in from its edge, slow | slides out, base | Content behind stays still |
| Toast | slides 8 to 16px from its edge plus fade, base | fade, fast | Never animates the rest of the page |
| Banner | height grows, base, pushing content down | collapses, base | Or no motion if it is there on load |
| Accordion, disclosure | height and chevron rotation, base | the same, fast | |
| Tabs | the indicator slides, base; content swaps with no motion | | |
| Button press | scale 0.98 or a darker fill, fast | | Never move the label |
| Skeleton | a soft pulse, 1.5 to 2s per cycle | | Stops under reduced motion |

## What never animates

- Text that changes inside a table, a list or a form while the user reads it.
- The focus ring. It appears and moves instantly.
- Layout on every keystroke, scroll position (no scroll hijacking), and anything that loops forever as decoration.
- Width, height, top or left for things that move across the screen. Animate `transform` and `opacity`. Colour changes on hover are fine.
- Data that loads. Show it in place; don't count numbers up in product UI.

## Reduced motion

When the user asks for reduced motion, movement becomes a fade or nothing:

- Slides, scales and parallax become a fade at `--duration-fast`, or an instant change.
- Skeleton pulses, auto-playing carousels and video backgrounds stop.
- Progress and spinners keep working, because they carry information. Slow a spinner down rather than stopping it.

tokens.css can't hold a `prefers-reduced-motion` block, so the rule lives in the CSS that animates. Every example with a `transition` or `animation` carries it:

```css
.menu { transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out); }
@media (prefers-reduced-motion: reduce) {
  .menu { transition: opacity var(--duration-fast) linear; transform: none; }
}
```

## Writing the motion pattern

- An entry in `patterns` with `id: "motion"`, `kind: "motion"`, a title, a note of one or two sentences, and the body in `patterns/motion.md`: the three durations and what uses each, the three curves, the enter and exit table cut to the elements this product has, the never list, and the reduced motion rule.
- Give it an example, `patterns/motion.html`, with `layout: "full"`. Draw each overlay's start and end side by side: a menu at 96 percent and faded, then at rest; a sheet below the frame edge, then up. Label each pair with its token names in plain text.
- Add a live demo of the main ones, marked for strips (below), with a readable resting state.

## Motion strips

On the wide light board the check starts a transition and takes four frames from start to end, then the end once more with reduced motion, side by side in `<entry>-motion@wide.png`.

- It does this for each demo chip in the Motion section, and for each element in a component, pattern or brand example that has `data-dc-motion`.
- The trigger is forced: the element's `data-dc-state` when it is `hover`, `focus`, `focus-visible` or `active`, else hover. So drive the movement with that real pseudo-class. A class toggled by script, or a keyframe that runs on load, isn't started: the strip is one frame and the check says nothing moved.
- The frame is the labelled element's resting box plus 24px. For anything that travels further, label the container and let its hover move the child: `<div class="track" data-dc-motion>` with `.track:hover .sheet { transform: none; }`.
- Read the frames: they should differ in even, sensible steps and end where the static end state shows. The check says when it still moves with reduced motion; fix that rule.
- Up to 24 strips, the section's chips first.

## How the check sees motion

- The `motion` topic of a full system wants a time and an easing in the motion section (a `--duration-*` and an `--ease-*` name also count). The `motion` pattern topic counts a pattern of kind `motion`.
- `system-motion-no-reduced` is a warning when a component, pattern or brand example declares `transition` or `animation` (in `<style>` or `style`, other than `none`) and holds no `prefers-reduced-motion` media query. A comment mentioning it doesn't count.

## Done for this area

Three durations, three easings, a `motion` pattern with an example, and a reduced motion rule in every example that moves.
