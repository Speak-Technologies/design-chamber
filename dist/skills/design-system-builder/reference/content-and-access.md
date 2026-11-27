# Content and accessibility

Read this before you write the voice and accessibility patterns. Both are rules people can follow, not values: write them as short, testable sentences with an example of right and wrong.

## Voice and tone

Record it as a pattern with `kind: "voice"`, body in `patterns/voice.md`. Every system has one, including core systems.

### Find the voice first

Read the product's own copy: buttons, empty states, errors, onboarding, the marketing site. Describe what is there in three to five traits, each with what it means and what it doesn't: "Plain: we say 'sign in', not 'authenticate'. Not casual: no slang, no exclamation marks in errors." If the copy is inconsistent, pick the voice the best screens use and say which screens you took it from.

### Tone shifts by moment

| Moment | Tone | Example |
|---|---|---|
| Success | Brief, quiet | "Invoice sent." |
| Error the user can fix | Calm, specific, what to do next | "That card was declined. Try another card or contact your bank." |
| Error on our side | Own it, say what is safe | "We couldn't save your changes. Your draft is kept on this device." |
| Destructive confirm | Plain about the result | "Delete this project? Its 12 files will be removed for everyone." |
| Empty, first use | Helpful, one next step | "No projects yet. Create one to get started." |
| Onboarding, marketing | Warmer, still plain | |

### Rules that hold everywhere

- Sentence case for every heading, button, label and menu item. Title Case only for proper names.
- Buttons and links say what happens, verb first: "Save changes", "Create invoice", "Delete file". Never "OK", "Submit", "Click here" or "Yes" alone. A dialog's buttons repeat its verb.
- Name things the same way everywhere. Keep a short glossary in the voice pattern: the one word for each concept and the words to avoid ("workspace, not team or org").
- Error messages: what happened, why if it helps, what to do. No error codes alone, no blame ("invalid input"), no apology padding.
- Second person ("your files"), active voice, present tense. Cut "please", "simply", "just" and "easily".
- No exclamation marks in product UI. Emoji only if the brand already uses them, and never in errors.
- Numbers: digits for every count ("3 files"). Thousands separators by locale. Units with a space ("12 MB", "5 min"). Ranges with "to" ("Mon to Fri").
- Dates: relative for the last week ("2 hours ago", "Yesterday"), absolute after that ("12 Mar 2026" or the locale's form), with the full date and time on hover or in a title. Times in the user's time zone.
- Truncation: an ellipsis at the end with the full text on hover or focus. Never truncate a number, a price or an error.
- Internal names (service names, table names, feature flags) never reach the UI.

## Accessibility

Record it as a pattern with `kind: "accessibility"`, body in `patterns/accessibility.md`. Write each rule so someone could check it on a screen.

### Contrast

- Body text 4.5:1 on its background. Large text (24px and up, or 18.66px bold) and UI parts (input borders, icons that carry meaning, focus rings, chart lines) 3:1.
- Declare the pairs in `system.json` `pairs` as `foundations.md` says. The check judges them in light and dark. A pair under its level is a `system-contrast-low` finding.
- Placeholder and disabled text are exempt by the standard, but keep placeholder text at 4.5:1 anyway when it carries a format hint.

### Focus

- Every interactive part shows a visible focus ring on keyboard focus (`:focus-visible`), drawn with `--focus-ring` at `--focus-ring-width` and `--focus-ring-offset`. It reaches 3:1 against the surface around it, on light and dark.
- Never remove the outline without a replacement. Never show the ring on mouse click only.
- Focus order follows reading order. Overlays move focus in and return it on close (see the overlay rules in `patterns.md`).

### Keyboard paths

| Component | Keys |
|---|---|
| Button, link | Tab to reach, Enter (and Space for buttons) to act |
| Checkbox, switch | Space toggles |
| Radio group | Tab into the group, arrows move and select |
| Tabs | Arrows move between tabs, Tab moves into the panel |
| Menu | Enter or Space opens, arrows move, Enter chooses, Esc closes and returns focus |
| Select, combobox | Arrows move, typing jumps, Enter chooses, Esc closes |
| Dialog, sheet | Tab cycles inside, Esc closes |
| Table with selection | Arrows move between rows, Space selects |
| Slider | Arrows step, Page Up and Page Down jump, Home and End to the limits |

Write the keys for each of this system's interactive components into that component's note or the accessibility pattern.

### Labels and names

- Every input has a visible label tied to it. Icon-only buttons have an accessible name (`aria-label`) and a tooltip with the same words.
- Images that carry meaning have alt text that says what they show; decorative images have `alt=""`.
- Status messages and toasts are announced (`role="status"`, or `role="alert"` for errors that need attention now).
- Headings in order, one `h1` per page, and landmarks for header, navigation, main and footer.
- Links are underlined in body text, or clearly marked by more than colour.

### Colour, motion and touch

- Never colour alone for meaning: status uses icon plus words; charts use labels or patterns as well as colour; links in text are underlined.
- Respect reduced motion as `motion.md` says.
- Targets at least 44 by 44px on phone, 24 by 24px on laptop, with space between them.
- Text can grow to 200 percent without content cut off. Use `rem` for type and avoid fixed heights on anything holding text.
- Content works from 320px wide without scrolling sideways, except tables and code, which scroll inside their own box.

### Forms

Errors are text, tied to the field, announced on submit, and the first field with an error gets focus or the error summary does. Required fields are marked in the label, not only with a red star. Time limits can be extended.

## Writing the two patterns

- `patterns/voice.md`: traits, the tone table cut to this product, the rules above that apply, the glossary, and five or more before and after pairs taken from the real product.
- `patterns/accessibility.md`: the target level (WCAG 2.2 AA unless the user says otherwise), contrast, focus, keyboard paths for this system's components, labels, colour, motion and touch rules, and the known gaps in the current code with a count and the files ("12 icon buttons in src/toolbar have no name").
- Both are text entries. The voice pattern may use `layout: "full"` when its tables are long.

## Done for this area

Core: the voice pattern. Full: the accessibility pattern too, plus pairs covering every text and UI colour on every surface it sits on.
