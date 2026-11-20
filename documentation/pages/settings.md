# Settings: Design systems

A section of the Settings sheet (rail) and Settings area (full-screen), between "Where designs live" and "Earlier folders".

## What's on it
- **Default for new designs.** One select: **Ask me each time**, **No design system**, or any Ready system. A system that was deleted or went back to draft shows as Ask me each time with a line saying why, until you pick again.
- **Projects.** One row per project OpenChamber has open (plus any project with a saved pin that is no longer open): the project name (the full path in its tooltip) and a select with **Use the default**, **No design system** and the Ready systems. A pin that no longer resolves acts as the default and shows its reason under the name.
- **Notices.** Sentences the service sends once, for example when a pinned system was deleted, appear as info banners at the top of the section and stay until the sheet is closed.

Saving is immediate. Each change sends the whole setting (`PUT /settings` with `systemDefault` or `systemPins`); focus returns to the select you used.

## The New design dialog
A **Design system** field is preselected the way the service decides: the project's pin, then your default, then Ask me in chat, with a short hint ("Pinned for shop", "Your default"). Its options are the Ready systems, **No design system** and **Ask me in chat**. While a system is chosen the **Style preset** field is hidden, because the system sets the style. With no Ready system the field is replaced by "No design systems yet." and a **Make one** link. The choice goes to the service as `system`.

## Code
`src/ui/components/settings-view.ts`, `src/ui/components/new-dialog.ts`, pure rules in `src/ui/model/settings-model.ts` and `new-model.ts` (`test/ui/system-pickers-model.test.ts`). Screens: `test/ui/visual/scenarios/design-system-settings.mjs`.
