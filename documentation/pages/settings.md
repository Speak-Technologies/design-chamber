# Settings: Design systems

A section of the Settings sheet (rail) and Settings area (full-screen), between "Where designs live" and "Earlier folders".

The line under the heading: "New designs follow their project’s own design system and files. Change it per project, or set what happens when a project has nothing."

## What's on it
- **Default for new designs.** One select: **Ask me each time**, **No design system**, or any Ready system. The note under it always reads "Used when a design has no project, or its project has no design files." A system that went back to draft, or is not in the current Designs folder, shows as Ask me each time with a line saying why (for example "Your default design system isn’t in this Designs folder."), until you pick again or switch back.
- **Projects.** One row per project OpenChamber has open (plus any project with a saved pin that is no longer open): the project name (the full path in its tooltip) and a select with, in this order, **Use the project** (the default; nothing is stored), **Use my default**, **No design system** and the Ready systems. A sentence under the name says what new designs in that project will use:

| Row value | Situation | Sentence |
|---|---|---|
| Use the project | the project has its own Ready system | Uses Shop UI, this project’s design system. |
| Use the project | its own system is a draft | Shop UI is a draft. Until it is Ready, designs follow the project’s files. |
| Use the project | no system of its own | Follows the project’s design files. If it has none, uses your default (Ask me each time). The brackets name your default. |
| a system | the project also has its own | This project has its own system, Shop UI. New designs use Acme because you picked it. |
| a system | gone, a draft or unreadable | The reason, then "this project uses the project’s own design files, or your default". The select shows Use the project, because that is what applies. |
| Use my default or No design system | | none |

  "The project’s own system" is a Ready system made from the project's code or kept in its repo (registered or built there), including a repo inside the project or a project opened in a package of the repo. With two, the one closest to the project wins, then a repo one, then the newest.
- **Notices.** Sentences the service sends once, for example when a pinned system was deleted, appear as info banners at the top of the section and stay until the sheet is closed.

Saving is immediate. Each change sends the whole setting (`PUT /settings` with `systemDefault` or `systemPins`); focus returns to the select you used. A saved change also re-reads the design systems list, so the Default and Pinned badges in the library and the systems list follow right away. If the save fails, nothing reloads and the error shows under the section.

## How the service handles it
- **What it takes.** `systemDefault` is one of `{ choice: "ask" }`, `{ choice: "none" }` or `{ choice: "system", id, name }`. `systemPins` is the whole pin list, up to 50 projects, each `{ directory, choice: "follow-default" | "none" | "system" }` (with `id` and `name` for `system`). A project with no pin uses the project. An old `"default"` pin in the file is read as no pin (Use the project) and left out on the next save; `PUT /settings` refuses one with "Pick Use the project, Use my default, No design system or a design system." `null` clears either one, the same as asking each time or having no pins.
- **After a folder switch.** The default and pins are global and keep the saved system, so nothing is cleared when you switch the Designs folder: they read as `missing` there and work again when you switch back. Deleting a system is different: it clears the default and pins that named it and sends a one-time notice.
- **What it refuses.** Any other shape answers 400 with a plain sentence, and nothing is saved, not even a valid field sent in the same request. A pin that points at a system that no longer exists is not refused: Settings sends the old pins back with every change, and the pin works again if the system comes back.
- **What it answers.** Both `GET /settings` and `PUT /settings` return a `systems` part: the default and each pin with a `state` (`ok`, `draft`, or `missing` for a system that is not in this Designs folder or whose folder can't be read) and, when it isn't ok, the sentence the sheet shows. The one-time notices ride along once and are then gone.
- **No restart.** The change is live as soon as it is saved: the project instructions follow the pins (and a project with its own Ready system and no pin gets that system's line), and new designs, chats and the "Ask me" recommendation read the new default on their next request.
- **Drift guard.** The visual test harness has a fake backend for this sheet. `test/service/core/settings-contract.test.ts` sends the same requests to the fake and to the real route and fails if their answers differ.

## The New design dialog
A **Design system** field is preselected the way the service decides: the project's pin, then Use the project, then your default, then Ask me in chat. Its options are **Use the project** (first, and only when the dialog has a project folder outside the Designs folder), the Ready systems, **No design system** and **Ask me in chat**. Hints: "From shop" when the project's own system is preselected, "Reads shop’s design files first" for Use the project, "Pinned for shop" and "Your default" as before. The dialog has no project scan, so with no own system it preselects Use the project; the service then scans, and if the project has no design files your default applies. While a system is chosen the **Style preset** field is hidden, because the system sets the style; under Use the project it shows with the hint "Used only where the project’s files say nothing." With no Ready system the field is replaced by "No design systems yet." and a **Make one** link, and nothing is sent: the service follows the project by itself. The choice goes to the service as `system` (`"@project"` for Use the project).

A design made this way and following its project shows **Follows the project** in the viewer's system chip ([Viewer](viewer.md)).

## Code
Service: `src/service/routes/settings.ts` (validation and the answer), `src/service/settings.ts` (the store), `src/shared/systems.ts` (`effectiveSystemChoice`, `projectSystemOf`, `settingsSystemsView`, the states and sentences). UI: `src/ui/components/settings-view.ts`, `src/ui/components/new-dialog.ts`, pure rules in `src/ui/model/settings-model.ts` and `new-model.ts` (`test/ui/system-pickers-model.test.ts`). Screens: `test/ui/visual/scenarios/design-system-settings.mjs`.

## Settings: Your agent
A section of the same sheet, after "Earlier folders" and before "Browser for thumbnails". It replaces the older "Help your agent find your designs" section. The line under the heading is "Agents in OpenChamber know Design Chamber while it is on. Nothing to set up."

### What's on it
- **Built in.** Static text: "Design rules, the design-chamber skill, and the design_check, design_list and design_read tools." It names what ships with the extension and does not claim OpenCode has loaded them; a guest can't see that. OpenChamber's own Extensions screen says when the tools can't load.
- **In every chat.** Whether OpenChamber kept the short note about Design Chamber that goes with every chat. A badge and a sentence, so colour is never the only signal:

| State | Badge | Sentence |
|---|---|---|
| `saved` | Sent | Every chat gets a short note about Design Chamber. |
| `pending` | Pending | Sent from the next message. |
| `not-saved` | Not saved (warning) | OpenChamber didn’t save it. It is sent again when Design Chamber restarts. |

  The value comes from `agent.instructions` in `GET /settings` and `PUT /settings`, read fresh each time, so opening Settings again shows the current state.
- **Older copy.** Only when a skill file installed by an earlier version is on disk (or the service can't look, or another copy of the skill would load twice). It says where the copy is and what that means. Our own unedited copy has **Remove old copy** (`DELETE /agent/skill`); an edited copy or someone else's is left alone and offers **Copy path**. When the copy is removed the row disappears, a toast and a screen reader announcement say "Old copy removed.", and focus moves to the Built in row above it. With no old copy there is no row.
- **Using an agent outside OpenChamber?** A collapsed disclosure (a native `<details>`: Enter or Space opens it from the keyboard). Inside: the guide row (what Design Chamber does with `<root>/AGENTS.md`) and the **Lines for AGENTS.md** with a **Copy** button, the same text as before. It stays open or closed as the person left it while the sheet repaints (Copy repaints it).

### States
Loading shows "Loading settings…" for the whole sheet; a failed load shows the "Settings didn’t load" banner with **Try again**. A failed old-copy removal shows the service's sentence under the row and keeps the button usable, with focus kept on it.

### Code
UI: `src/ui/components/settings-view.ts`, pure rules in `src/ui/model/settings-model.ts` (`instructionsRow`, `skillRow`, the section text), tests in `test/ui/settings-wall-model.test.ts`. Screens: `test/ui/visual/scenarios/agent-section.mjs` (the section, the three In every chat states, the disclosure) and `agent-skill.mjs` (every Older copy state). The harness fake answers `instructions: 'saved'` and has a hook, `setInstructions`, for the other two states; `test/service/core/settings-contract.test.ts` keeps the fake's shape equal to the real service's.

