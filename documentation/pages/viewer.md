# Viewer

## The build strip: what the agent is doing

A pill at the top of the wall while the linked agent works, on the full-screen page and in the rail. Its phases (working, writing, question, done and so on) are listed under [Full-screen page](full-screen-page.md). While the agent is working or writing, it also says what the current call is, if OpenChamber reports it (2.8 or newer).

| The agent | Rail | Full-screen page |
|---|---|---|
| edits or writes a screen | Editing pricing.html | Editing screens/pricing.html |
| reads a file, in the design or elsewhere in the project | Reading theme.css | Reading src/styles/theme.css |
| searches files | Looking through components | Looking through src/components |
| runs a shell command (the command is never shown) | Running a command | Running a command |
| looks something up on the web | Looking something up online | Looking something up online |
| plans | Planning | Planning the next steps |
| hands work to a helper agent | Helper agent working | A helper agent is working |
| runs the design check | Checking | Checking the design |
| lists or reads your designs | Reading designs | Reading your designs |
| does anything else, or OpenChamber doesn't say | Agent is working | The agent is working |

- With no file named, it says **Editing a file**, **Writing a file**, **Reading a file** or **Searching the files**.
- A file that belongs to the open design shows its place in the design (`screens/pricing.html`). Anything else shows as OpenChamber gives it: a path from the chat's folder, or just the name for a file outside it. Long paths are cut with "…"; the tooltip has the whole path. Characters that would reorder or break the line are removed from every file name first.
- The line after the words stays as before ("2 of 4 screens written", "Last saved home.html 1 min. ago").
- The words change at most once a second, so they stay readable while the agent opens many files. A new phase (a question, done, an error) shows at once.
- Screen readers hear edits and writes by name. Reads, searches and commands are not announced; they hear the phase ("The agent is working") and can read the words on screen.
- A chat with no project has no calls to show; the strip works from saved files alone.
- A design system's page shows the same strip, with the same words, while the agent works on the system.

Code: `src/ui/model/tool-model.ts` (words), `src/ui/model/build-strip-model.ts` (phases and the once-a-second rule), `src/ui/components/build-strip.ts`. Screens: `test/ui/visual/scenarios/build-strip.mjs`.

## A design's system

Where a design shows which design system it uses, and how to change it or take an update. Same behaviour on the full-screen page and in the rail; only the layout differs.

### What's on it
- **The chip.** Full-screen: at the left end of the header status area, before Checks. Rail: in the second header row, between the Edit/Play controls and the zoom (the title row has no room at 320 px). It reads **Acme**, **Acme (deleted)**, **Acme (draft)**, **Follows the project** (no system linked, the design follows its project's own design files; its title says which project), **No design system** or **Ask me in chat**. It is quiet by default, blue when an update is waiting and amber when the design's copy is damaged. Its accessible name adds the revision, "an update is available", the override count and any copy problem.
- **The popover** (full-screen) or **full-height sheet** (rail), opened from the chip. It says "Using Acme, copied at revision 7.", and "Revision 9 is available." when one is. It lists the design's overrides, each with **Reset to system**. A damaged copy is named ("This design's copy of Acme is missing 2 files."). Buttons: **Review update** (filled only when an update is waiting), **Change…**, **Open system** (only for a Ready system).
- **Change…** lists the other Ready systems and **No design system**. For a design that follows its project, the popover says "This design follows shop’s own design files, so it looks like the rest of the project. Pick a system to use one instead.", and when the project has gained a Ready system of its own since the design was made it is listed as "Shop UI, this project’s". Nothing links by itself. Picking one shows a line such as "12 tokens will change, 4 are new, this design's own 6 stay as overrides." and the button becomes **Use Shop**. There is no confirm step: the design is saved as a version first, then a notice says "Now using Shop." with **Undo** and **Ask the agent to restyle**.
- **The update banner**, under the header: "Acme was updated since this design copied it." with **Review update** and **Not now**. **Not now** hides it for that revision only (remembered per design, key `system-update:<slug>`); a newer revision brings it back. It is hidden while an old version is on show.
- **The update sheet.** Opens with the version ("Acme, revision 7 to 9"), then what changes: tokens changed, new, removed, components, and the overrides that stay. One filled button, **Update this design**. Afterwards: "Updated to Acme revision 9." with **Undo** and **Ask the agent to apply the changes**.
- **The agent switch notice.** If the agent changes the system of the open design: "The agent switched this design to Shop." with **Undo**.

### States & edge cases
- A stale answer (the design changed while the sheet was open) says "This design changed since you opened this. Reload and try again." with a **Reload and try again.** link.
- Undo restores the version taken before the change and reloads the design.
- Nothing shows until the service has answered, so the header never flashes a wrong name.
- Text from a system (names, token names) is always set as text.

### Code
`src/ui/components/system-chip.ts`, `src/ui/wall/feature-system.ts`, pure rules in `src/ui/model/design-system-model.ts` (`test/ui/design-system-model.test.ts`). Screens: `test/ui/visual/scenarios/design-system-chip.mjs`.
