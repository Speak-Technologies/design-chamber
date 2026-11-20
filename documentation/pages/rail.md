# Rail: projects and folders

**Route:** the Design Chamber icon in OpenChamber's rail (`panel` surface), the designs list · **Access:** every OpenChamber user
**Purpose:** The same two groupings as the [library](library.md) (projects from the project folder each design was made for, and your own folders), in one select, because the rail has no room for a sidebar. The rest of the rail is in the [rail panel](rail-panel.md). Nothing here moves a design on disk.

Screenshots: `documentation/pages/img/folders-rail-<width>-<theme>-*.png`, from `test/ui/visual/scenarios/projects-folders.mjs`.

## Show

[320 dark, open](img/folders-rail-320-dark-2-show-open.png) · [480 light](img/folders-rail-480-light-3-project.png)

- One **Show** select sits between the search and the tabs. Its entries: **All designs**, each project (name, count), **No project** (only when there are some), then each folder as "Folder · Launch" (count). Its accessible name reads "Show: shop".
- The tabs and their counts, the search and the empty states work inside the choice. Each row shows its project under the kind line, except inside that project.
- The choice is remembered on this surface (`list-scope:panel` in `host.storage`); an unknown value, or a project or folder that is gone, reads as All designs.

## Folders in the rail

- A row's ⋯ menu gains **Add to folder…** ([empty start](img/folders-rail-320-dark-4-add-first-folder.png) · [after creating](img/folders-rail-320-dark-5-added.png)): a ticked list, ticking adds or removes at once, and a name field with **Create and add** (also the only field when there are no folders yet). Inside a folder the menu also offers **Remove from <folder>**.
- In a folder view a **Folder actions** button appears next to the select ([folder view](img/folders-rail-320-dark-6-folder.png)): **Rename folder** (a small dialog, the text kept on an error) and **Delete folder** (no confirm; a notice with **Undo** for 10 seconds, [notice](img/folders-rail-480-light-7-deleted-undo.png)). There is nothing to drag onto in the rail, so an empty folder says "Use Add to folder in a design’s menu."
- Name rules and sentences are the library's: 1 to 40 characters, no line breaks or tabs, unique ignoring case, at most 50 folders.

## States

- **Loading:** skeleton rows as before; a remembered folder view shows them until the folders arrive.
- **Error:** "Folders couldn’t load. Try again." with **Try again** under the select ([320 light](img/folders-rail-320-light-fail-1-note.png)); projects and designs still work.

# Rail: a design system

**Route:** the rail's **Design systems** button, then a system's row (`panel` surface) · **Access:** every OpenChamber user
**Purpose:** Read a system, review its sections, mark it ready and talk to the agent about it without leaving the rail. Editing values is not here: the rail is too narrow for it, so it says where to go. The full page is in [design systems](design-systems.md); the list is in the same page.

Screenshots: `documentation/pages/img/rail-system-<width>-<theme>-*.png`, from `test/ui/visual/scenarios/design-system-rail.mjs`.

## What the rail shows

[320 light, a section](img/rail-system-320-light-section.png) · [480 dark, a draft](img/rail-system-480-dark-draft.png)

- **Header:** back to the list, the name, a **Draft** or **Ready** badge and a ⋯ menu (Rename, Continue in chat, Versions). Under the name a home line says where the system lives ("In Design Chamber · From brand files · Used by 2 designs") and a repo-backed system reads "Repo · shop · Used by 4 designs".
- **Board:** the system drawn read only at a rail height, with the **ask bar** under it. Choosing a section scrolls the board to it.
- **Sections:** the same four areas as the page (Foundations, Components, Patterns & voice, Brand & marketing) with counts and review marks, in an accordion. There is no value editor, no unsaved bar and no inline editing in the rail.
- **Foot, under the section list:** **Looks good** and **Needs work** for the chosen section (Needs work opens a note and sends it to the agent), then **Mark ready** (or **Back to draft**) and **Continue in chat**, then one line: "To edit values, open Design Chamber full screen: sidebar, Extension pages, Design Chamber." A section the system doesn’t cover says "Not covered" and has no review buttons; the two buttons and the line stay.

## A system read from a repo

[320 dark](img/rail-system-320-dark-repo.png)

- The home line names the repo and its tooltip is the folder. The header carries one small **living page** pill: "Living page up to date", "Living page out of date", "Living page not in shop yet", "Living page changed in shop", "Living page reformatted", "Living page can’t be checked as safe" or "Living page can’t be read". The pill is only a label here; re-syncing and the living page actions are on the full-screen page.
- The line under the buttons changes to "Tidepool lives in tidepool-web. Change the values there, or ask the agent here."
- An internal system, or one the service hasn’t judged yet, shows no pill.

## States

- **Loading:** "Loading the board…" on the board and "Loading the design system…" in the sections. Never a blank frame.
- **Error:** "The design system didn’t load" with the reason and **Try again** ([320 dark](img/rail-system-320-dark-error.png)).
- **Gone:** "<name> is gone. Its folder was moved or deleted. Check the trash in the Designs folder." with **Back to design systems** ([320 dark](img/rail-system-320-dark-gone.png)). Unsaved values from the full page are not kept in the rail because it has none.
- **Narrow rail:** nothing scrolls sideways at 320 px; buttons wrap, and the badge and pill fold under the name.

## Code

`src/ui/systems/system-page.ts` (the page and the rail share it; `compact` is the `panel` surface), `src/ui/model/system-page-model.ts` (`homeLine`, `homeTitle`, `livingPagePill`, `railHint`, `readyControl`), tests in `test/ui/system-page-model.test.ts`.
