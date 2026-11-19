# Projects and folders

**What it does:** Lets the user group their designs two ways in the list, without ever moving a design on disk.

1. **By project, automatically.** Every design remembers the project folder its chat was opened in (`projectDirectory` in design.json). The list groups designs by that folder. A design with no project, or one whose project is the designs folder itself, sits under **No project**.
2. **By folder, by hand.** The user makes folders (for example "Q4 launch") and puts designs in them. A design can sit in as many folders as the user likes, or in none.

Why it exists: a designs folder fills up fast. People want to see "everything for the shop app" or "what we're showing on Friday" without the agent having to file anything, and without designs moving around under the agent's feet.

## How grouping by project works
- The service answers the designs list with `projectFolders`: each distinct project folder of the listed designs (at most 100), and whether it still exists. Two spellings of the same folder (a trailing slash, either slash on Windows) count once.
- Whether a folder exists is checked at most once a minute per folder, so a big list stays fast. A project that was moved or deleted shows "Folder not found"; its designs stay listed.
- The project path comes from design.json, which the agent writes, so the service treats it carefully: a relative path is reported as not found without looking, and a network path (`\\server\share`) is never touched at all (it is shown as present, with no claim either way).

## How manual folders work
- **Where they live.** One small file, `<designs folder>/.chamber/folders.json`. It travels with the designs folder: copy or sync the designs folder and the folders come along. Nothing is written inside any design for this, and grouping never versions a design.
- **How a design is remembered.** By its folder name (slug) **and** the time it was made. Renaming a design's title changes neither, so it stays in its folders. If a design is deleted and a new one later gets the same folder name, the new one is **not** in the old design's folders.
- **Adding and removing are idempotent.** Adding a design that is already in a folder does nothing. Two windows adding the same design at the same moment end with one entry. A design name that doesn't exist is skipped quietly.
- **A design that goes away** (moved to the trash, or deleted by hand) leaves every folder the moment the service sees it go.
- **Names.** 1 to 40 characters, no line breaks or tabs. Two folders can't share a name, ignoring upper and lower case ("Launch" and "launch" clash). Up to 50 folders, and up to 2,000 designs per folder.
- **Deleting a folder** never deletes its designs. The folder just disappears from the list, and the notice says how many designs were in it. **Undo** works for an hour. After that the folder is gone for good. Undo is refused if another folder took the same name in the meantime.

## When the folders file is damaged
If `folders.json` can't be read (broken JSON, wrong shape, over 1 MB, or a link instead of a plain file), the list shows the projects only and says "Folders couldn't load. Try again." Nothing overwrites the file on its own. The first folder action the user takes (making a folder, adding a design) renames the broken file to `folders.damaged-<date and time>.json` beside it, so nothing is lost, and starts a fresh one.

## Changing the designs folder
Folders belong to the designs folder they were made in. Switching to another designs folder shows that folder's own folders (none, if it never had any). The old file stays where it was, untouched, and comes back when the user switches back.

## Service routes
All behind the service's token, all on `/folders` (technical design: `documentation/specs/phase-2-5-technical.md` §2.8, §3.3, §5.8):

| Route | What it does |
|---|---|
| `GET /folders` | The folders with the designs that are in them right now; `damaged: true` when the file can't be read |
| `POST /folders` | Make a folder (`{ name }`) |
| `PATCH /folders/:id` | Rename it |
| `DELETE /folders/:id` | Delete it (Undo for an hour); answers how many designs it held |
| `POST /folders/:id/undelete` | Undo a delete |
| `POST /folders/:id/designs` | `{ add, remove }`: up to 200 design names each |

Every change tells open windows to refresh their folder list (a `folders` change event).

**Pages that surface it:** the Library sidebar on the full-screen page and the **Show** select in the rail panel (see `pages/library.md` and `pages/rail.md` once the grouping UI lands).
