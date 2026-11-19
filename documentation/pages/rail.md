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
