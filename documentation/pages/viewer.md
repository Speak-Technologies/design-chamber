# Viewer: a design's system

Where a design shows which design system it uses, and how to change it or take an update. Same behaviour on the full-screen page and in the rail; only the layout differs.

## What's on it
- **The chip.** Full-screen: at the left end of the header status area, before Checks. Rail: in the second header row, between the Edit/Play controls and the zoom (the title row has no room at 320 px). It reads **Acme**, **Acme (deleted)**, **Acme (draft)**, **No design system** or **Ask me in chat**. It is quiet by default, blue when an update is waiting and amber when the design's copy is damaged. Its accessible name adds the revision, "an update is available", the override count and any copy problem.
- **The popover** (full-screen) or **full-height sheet** (rail), opened from the chip. It says "Using Acme, copied at revision 7.", and "Revision 9 is available." when one is. It lists the design's overrides, each with **Reset to system**. A damaged copy is named ("This design's copy of Acme is missing 2 files."). Buttons: **Review update** (filled only when an update is waiting), **Change…**, **Open system** (only for a Ready system).
- **Change…** lists the other Ready systems and **No design system**. Picking one shows a line such as "12 tokens will change, 4 are new, this design's own 6 stay as overrides." and the button becomes **Use Shop**. There is no confirm step: the design is saved as a version first, then a notice says "Now using Shop." with **Undo** and **Ask the agent to restyle**.
- **The update banner**, under the header: "Acme was updated since this design copied it." with **Review update** and **Not now**. **Not now** hides it for that revision only (remembered per design, key `system-update:<slug>`); a newer revision brings it back. It is hidden while an old version is on show.
- **The update sheet.** Opens with the version ("Acme, revision 7 to 9"), then what changes: tokens changed, new, removed, components, and the overrides that stay. One filled button, **Update this design**. Afterwards: "Updated to Acme revision 9." with **Undo** and **Ask the agent to apply the changes**.
- **The agent switch notice.** If the agent changes the system of the open design: "The agent switched this design to Shop." with **Undo**.

## States & edge cases
- A stale answer (the design changed while the sheet was open) says "This design changed since you opened this. Reload and try again." with a **Reload and try again.** link.
- Undo restores the version taken before the change and reloads the design.
- Nothing shows until the service has answered, so the header never flashes a wrong name.
- Text from a system (names, token names) is always set as text.

## Code
`src/ui/components/system-chip.ts`, `src/ui/wall/feature-system.ts`, pure rules in `src/ui/model/design-system-model.ts` (`test/ui/design-system-model.test.ts`). Screens: `test/ui/visual/scenarios/design-system-chip.mjs`.
