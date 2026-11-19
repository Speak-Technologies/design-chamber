# Library: projects and folders

**Route:** OpenChamber sidebar → Extension pages → Design Chamber (`page` surface), the designs list before a design is opened · **Access:** every OpenChamber user
**Purpose:** Find a design among many. The library groups the same list two ways, and neither moves anything on disk: **projects** (automatic, from the project folder each design was made for) and **folders** (your own labels; one design can be in several). The rest of the library (cards, search, tabs, sort, New, Settings) is described in the [full-screen page](full-screen-page.md). The rail has the same groups in one select: see [Rail: projects and folders](rail.md). How the folders are stored is in [Projects and folders](../features/projects-and-folders.md).

Screenshots come from `test/ui/visual/scenarios/projects-folders.mjs` (the real UI with the in-memory fake service), in `documentation/pages/img/folders-page-<width>-<theme>-*.png`.

## The sidebar

[1400 light](img/folders-page-1400-light-1-library.png) · [1400 dark](img/folders-page-1400-dark-1-library.png)

- **All designs** (count), then **Projects**: one row per project folder that has designs (name, count, the full path as a tooltip), then **No project** (only when there are some), then **Folders** with **New folder** and one row per folder (name, count).
- The selected row filters the grid and says so three ways: a bar and bold text on the row, `aria-current` for screen readers, and the page title ("Designs / shop"). Search, the tabs and sort work inside it, and the tab counts follow it. Cards show their project under the title, except inside that project.
- A project is named by OpenChamber's project list, else by the folder's name. Two projects with the same name show their parent folder too ("app · work", "app · personal"). A project folder that no longer exists still groups its designs, with a warning mark and "Folder not found" in the tooltip. Designs made from a chat opened in the Designs folder itself count as No project.
- The sidebar button in the toolbar opens and closes it. Under 900 px of page width it starts closed and floats over the grid when open ([800 px, open](img/folders-page-800-light-2-open.png)); choosing a row or pressing Escape closes it, and Escape returns focus to the button.

## Folders

- **New folder** opens a name field in the sidebar ([error](img/folders-page-1400-light-3-new-folder-error.png)). A name is 1 to 40 characters, with no line breaks or tabs, and unique ignoring case; at most 50 folders. The fix shows under the field and the text stays: "Give the folder a name.", "Keep the folder name to 40 characters or fewer.", "You already have a folder called Q4 launch.". Enter saves, Escape cancels.
- **Add a design:** drag a card onto a folder row (the row outlines as a drop target), or open the card's ⋯ menu → **Add to folder…** ([dialog](img/folders-page-1400-light-4-add-to-folder.png)): a ticked list (ticking adds or removes at once) and **New folder…** ("Create and add"). Drag is not the only way, so nothing needs a pointer drag. A toast says what happened, including "already in Q4 launch".
- **Inside a folder** the card menu also offers **Remove from Q4 launch** ([menu](img/folders-page-1400-dark-5-folder-menu.png)); the design stays in All designs and in its project.
- **Rename** is inline from the row's ⋯ menu. **Delete folder** asks nothing: a notice reads "Deleted folder Launch. Its 6 designs are still in All designs." with **Undo** for 10 seconds ([notice](img/folders-page-1400-light-7-deleted-undo.png)); the clock stops while the pointer or focus is on it. While the folder is gone the view shows All designs, and Undo brings the folder and the view back.
- An empty folder says "No designs in Scratch yet. Drag designs here, or use Add to folder in a design’s menu." with **Show all designs** ([empty](img/folders-page-1400-light-6-empty-folder.png)).
- Deleting a design removes it from its folders at once.

## States

- **Loading:** two skeleton rows under Folders; the project rows and the grid load with the designs.
- **Empty:** first run shows All designs (0) and an empty Folders heading with a hint and **New folder**.
- **Error:** if the folder list can't be read, the sidebar keeps the projects and says "Folders couldn’t load. Try again." with **Try again** ([sidebar](img/folders-page-1400-dark-fail-1-sidebar.png)); designs still list. Failed saves keep what was typed and show the service's sentence next to the field.
- **No matches:** "No designs in shop match “hero”." with **Clear filters**.

## Remembered view

The chosen row is remembered on this surface (`list-scope:page` in `host.storage`). A stored value that is unknown, or names a project or folder that is gone, reads as All designs.
