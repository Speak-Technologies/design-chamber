# Projects and folders

**What it does:** Lets the user group their designs two ways in the list, without ever moving a design on disk.

1. **By project.** Every design remembers the project folder its chat was opened in (`projectDirectory` in design.json). That is its own project, and it never changes. The list groups designs by it. A design with no project, or one whose project is the designs folder itself, sits under **No project**. Since Phase 2.6 the user can also file a design under **other** projects by hand (see below).
2. **By folder, by hand.** The user makes folders (for example "Q4 launch") and puts designs in them. A design can sit in as many folders as the user likes, or in none.

Why it exists: a designs folder fills up fast. People want to see "everything for the shop app" or "what we're showing on Friday" without the agent having to file anything, and without designs moving around under the agent's feet.

## How grouping by project works
- The service answers the designs list with `projectFolders`: each distinct project folder of the listed designs (at most 100), and whether it still exists. Two spellings of the same folder (a trailing slash, either slash on Windows) count once.
- Whether a folder exists is checked at most once a minute per folder, so a big list stays fast. A project that was moved or deleted shows "Folder not found"; its designs stay listed.
- The project path comes from design.json, which the agent writes, so the service treats it carefully: a relative path is reported as not found without looking, and a network path (`\\server\share`) is never touched at all (it is shown as present, with no claim either way).

## Filing a design under another project (Phase 2.6)
- **Organisation only.** Filing a design under a project adds it to that project's group in the list, and that is all. The design's own project still decides its design rules (RULES.md), its pinned design system, the chip and the link. Nothing in the design changes and nothing moves on disk. A test checks that the code that decides rules, systems and pins can't even reach the folders code.
- **Where it lives.** In the same `folders.json` as the folders, in a `projects` list: each entry is a project folder path and the designs filed under it (by name and creation time, like folders). A project is matched by its path, the same way the list matches projects (either slash, a trailing slash, and upper and lower case when there is a drive letter).
- **Its own project is never written.** Filing a design under the project it was made for does nothing (it is already there). If a design somehow ends up in its own project as a hand-filed member, the next write drops that entry.
- **The path is only a label.** The service stores the path as text. It never opens, checks or creates that folder. A path that isn't absolute, contains control characters, or is the designs folder (or inside it) is refused with "That project folder can't be used."
- **Limits.** Up to 100 projects with hand-filed designs ("You can file designs under up to 100 projects."), and up to 2,000 hand-filed designs per project. A project with no hand-filed designs left disappears from the file on the next write.
- **Agents can't file under projects.** Only the user can, from the library.

## How manual folders work
- **Where they live.** One small file, `<designs folder>/.chamber/folders.json`. It travels with the designs folder: copy or sync the designs folder and the folders come along. Nothing is written inside any design for this, and grouping never versions a design.
- **How a design is remembered.** By its folder name (slug) **and** the time it was made. Renaming a design's title changes neither, so it stays in its folders. If a design is deleted and a new one later gets the same folder name, the new one is **not** in the old design's folders.
- **Adding and removing are idempotent.** Adding a design that is already in a folder does nothing. Two windows adding the same design at the same moment end with one entry. A design name that doesn't exist is skipped quietly.
- **A design that goes away** (moved to the trash, or deleted by hand) leaves every folder and project the moment the service sees it go.
- **Names.** 1 to 40 characters, no line breaks or tabs. Two folders can't share a name, ignoring upper and lower case ("Launch" and "launch" clash). Up to 50 folders, and up to 2,000 designs per folder.
- **Deleting a folder** never deletes its designs. The folder just disappears from the list. The answer says how many designs were in it and how many of those were in no other folder, both counted in the same write that deletes, so the notice is true even if something changed a moment before. **Undo** works for an hour. After that the folder is gone for good. Undo is refused if another folder took the same name in the meantime.
- **Size.** The file is capped at 1 MB. A change that would make it bigger is refused with "Folders are full. Take some designs out of folders, then try again." and nothing is written.

## Several changes at once, and Move
`POST /memberships` takes a list of changes (up to 64), each adding or removing designs for one folder or one project, and applies them in one write:
- **All or nothing** (`atomic: true`), used by **Move** and Move's **Undo**: if any change fails (a folder that's gone, a full folder, a project path that can't be used), nothing is written and the answer is that change's sentence.
- **Best effort** (the default), used by ticks in the picker and by **Try again** after a filing failure: every change answers on its own (`ok`, or `gone`, `full` or `invalid` with a sentence), and the ones that worked are kept. If every change failed, nothing is written at all.

## Filing at creation
The New dialog can pick folders and projects for the design it is about to make. The pick travels with the start request (`POST /chip` `filing`). The design is made first, then filed best effort, and the answer lists each target's result. A filing failure never stops the design: the dialog says "Couldn't add it to <folder>. <reason>" and offers **Try again**. A folder from a designs folder the user has since switched away from answers "That folder isn't there any more." `/design` and `/page` from chat never file anything.

## When the agent asks to file a design
The agent can't call the service, so it asks through the design's own `design.json`:

```json
"folderRequest": { "add": ["Q4 launch"], "remove": ["Old ideas"], "at": "2026-11-22T10:04:00Z" }
```

- The agent reads the folder names from `<designs folder>/.chamber/folders.json` (it may read that file, never write it).
- Design Chamber acts on each distinct request **once**: it remembers a fingerprint of the last request it acted on, so restarting, or the agent saving design.json again with the same request, does nothing. To ask again, the agent changes the request (a new `at` is enough). If the user later takes the design out of the folder, it stays out.
- Only **existing** folders, matched by name ignoring upper and lower case. Design Chamber never creates, renames or deletes a folder for the agent, and never touches projects. A name to add that matches no folder shows a warning on the design: "The agent asked to add this design to Q4, but there's no folder with that name." A name to remove that matches no folder is already true, so it is ignored.
- If `folders.json` is damaged, the request waits: the file is left exactly as it is (only the user's own folder action sets a damaged file aside). As soon as the folders file is written again (usually by that same user action), or the design changes, the waiting request is applied.
- A request the agent wrote while OpenChamber was closed is applied when Design Chamber starts, and one sitting in a designs folder the user switches to is applied after the switch. Both wait until Design Chamber has finished reading the folder.
- When a request's warning appears or clears, open screens refresh the design within a moment. The same goes for the warning about the agent's design system choice. (Design Chamber sends a `comments` change for the design, which nothing treats as a content change: it never makes a version.)
- An unreadable design.json, or a request with the wrong shape, does nothing (the second shows the warning "folderRequest must list folder names to add or remove; it was ignored.").

## When the folders file is damaged
If `folders.json` can't be read (broken JSON, wrong shape, a bad `projects` entry, over 1 MB, or a link instead of a plain file), the list shows the projects only and says "Folders couldn't load. Try again." Nothing overwrites the file on its own. The first folder action the user takes (making a folder, adding a design) renames the broken file to `folders.damaged-<date and time>.json` beside it, so nothing is lost, and starts a fresh one. An agent's filing request never does this.

## Older versions
A `folders.json` written by 0.4.0 (no `projects`) reads as it is, with no hand-filed projects. It isn't rewritten just by being read; the first change adds the `projects` list. Going back to 0.4.0 afterwards keeps every folder, but 0.4.0 drops the hand-filed projects on its next write.

## Changing the designs folder
Folders and hand-filed projects belong to the designs folder they were made in. Switching to another designs folder shows that folder's own (none, if it never had any). The old file stays where it was, untouched, and comes back when the user switches back.

## Service routes
All behind the service's token (technical design: `documentation/specs/phase-2-5-technical.md` §2.8, §3.3, §5.8 and `documentation/specs/phase-2-6-technical.md` §2.1, §3, §5.1 to §5.4):

| Route | What it does |
|---|---|
| `GET /folders` | The folders and the hand-filed projects with the designs that are in them right now; `damaged: true` when the file can't be read |
| `POST /folders` | Make a folder (`{ name }`) |
| `PATCH /folders/:id` | Rename it |
| `DELETE /folders/:id` | Delete it (Undo for an hour); answers how many designs it held (`designs`) and how many of those were in no other folder (`onlyHere`) |
| `POST /folders/:id/undelete` | Undo a delete |
| `POST /folders/:id/designs` | `{ add, remove }`: up to 200 design names each (drag and drop) |
| `POST /memberships` | Several folder and project changes in one write, all or nothing or best effort (up to 64 changes, 200 names per list, 400 names in all) |
| `POST /chip` | Also files the new design when `filing` (folder ids, project paths) is sent |

Every change tells open windows to refresh their folder list (a `folders` change event). A change that writes nothing sends no event.

**Pages that surface it:** the Library sidebar on the full-screen page and the **Show** select in the rail panel, the Add to folder and Move dialogs, and the New dialog (see `pages/library.md` and `pages/rail.md`).
