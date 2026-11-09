# Agent discovery (without a slash command)

**What it does:** Lets any chat agent find out where designs go and how to lay them out, even when the user never typed `/design` or `/page`. Three channels carry the same core rules: a guide file Design Chamber keeps in the designs folder, an optional OpenCode skill the user installs from Settings, and a short snippet the user can paste into an `AGENTS.md`.

Why it exists: an agent asked for "a design canvas" in a plain chat had no Design Chamber instructions. It wrote one long HTML file, saved it loose in the designs folder (only folders count as designs), used Google Fonts (blocked offline) and wrote the HTML before `design.json`.

## What the agent reads
All three are plain text, written without em dashes, and built from the designs folder path.

- **The guide, `<designs folder>/AGENTS.md`.** OpenCode loads `AGENTS.md` by itself when a chat's project is the designs folder, and agents that list the folder see it. In order it says: this is the user's designs folder (set in Design Chamber settings, `~/Documents/Designs` by default) and designs saved elsewhere do not show; every design is its own folder `<root>/<slug>/`, never a loose file, with the slug rule (lower-case letters, digits and hyphens, starts with a letter or digit, at most 63 characters); what a **page** is (one `index.html`, shown full screen like a browser tab) and what a **canvas** is (a wall of screens shown at several device sizes side by side, like Claude Design), when to pick a canvas (the user says canvas, or there are several screens, steps or boards; a very tall page of board-like sections fits better as a canvas); write `design.json` first, then the HTML, then `tokens.css`, `DESIGN.md` and `assets/`, with a short `design.json` example for each kind and which keys the agent may change; work offline (no CDNs, no Google Fonts or other web fonts, fonts in `assets/fonts/`); relative paths only; never touch `.versions/`, `.chamber/`, `.thumb.png` or `.trash/`; a "Check your work" section with the check command (the folder name goes where the guide says `<slug>`; left out when the launcher could not be written), a digest of at most 10 lines of the design rules (one line says to run the check before saying done, or to read the HTML again when there is no command), and a pointer to `/design <brief>` or `/page <brief>` for the full rules; and that editing the file stops Design Chamber from updating it. Folder paths use the operating system's separators.
- **The skill, `design-chamber`.** Its description tells OpenCode to use it when the user asks for a design, mockup, wireframe, UI screen, landing page, prototype, HTML page or design canvas, or mentions the Designs folder, Design Chamber or a design studio. The body names the designs folder, says to read the guide first, and repeats the guide's main points in short form (including one bullet to run the check command before saying done, when there is one) so it still works if the guide was deleted or edited. It is never called `design` or `page`, because OpenChamber drops an extension command whose name a skill already uses.
- **The snippet** (Settings shows it with a Copy button):

  ```
  ## Designs (Design Chamber)
  When I ask for a design, mockup, page or canvas, save it in my designs folder: <root>
  Read <root>/AGENTS.md first and follow it. Each design is its own folder there, never a loose
  .html file. Write design.json first, then the HTML. Work offline: no CDNs, no Google Fonts.
  ```

Size caps: guide 8 000 characters, skill 6 000, skill description 1 024, snippet 1 000. A designs folder path so long that a text would pass its cap, or one with a control character in it, is refused rather than written.

## The ownership rule (never overwrite the user's file)
Both files Design Chamber writes for agents carry a marker with a hash of their own text: the guide on its first line (`<!-- design-chamber:guide v1 sha256:… -->`), the skill in its frontmatter (`metadata: generator: design-chamber, sha256: "…"`). Design Chamber only rewrites a file that has its marker and whose hash still matches, meaning nobody changed it.

| What is on disk | Guide | Skill |
|---|---|---|
| Nothing | Written | "Install skill" offered |
| Ours, up to date | Left as is | "Installed" |
| Ours, older text (different folder or wording) | Rewritten | "Update skill" offered (never automatic) |
| Ours but edited, even one character or emptied | Left alone for good | "Replace skill…" offered, only after the user confirms |
| No marker (the user's own file) | Left alone | Left alone, no button |
| A symlink, a folder or anything not a plain file | Left alone | Left alone, no button |

The final check and the write happen in one step, so an edit that lands while Design Chamber is writing is kept. Deleting the guide brings Design Chamber's version back at the next service start or the next new design. Editing it, even to empty it, stops all updates. On a drive that ignores letter case, a file called `agents.md` counts as the guide's name and, having no marker, is left alone.

## The launcher the commands point at
The guide, the skill and the chip quote a command that runs `<designs folder>/.chamber/bin/dc` (`dc.cmd` on Windows). The service writes both scripts when it starts (asking for the command is what writes them, once per folder), and again for a new designs folder; it rewrites one only when its bytes differ, never touches a file at that spot it did not write, and never runs it. If the extension's check tool is missing (a checkout that was not built) or the folder path cannot be quoted, no launcher is written and the text says to read the HTML again. Details: [Design checks](design-checks.md).

## When the guide is written
- When the service starts (once the folder watcher has its baseline), if the designs folder exists. Design Chamber never creates the designs folder just for the guide.
- When a new design folder appears (debounced 2 seconds), which also covers a designs folder created after start.
- When the user changes the designs folder in Settings: the guide in the old folder, if it is ours and unedited, is replaced by three lines saying where designs are saved now ("Design Chamber now saves designs in …"). It stays ours, so switching back restores the full guide. The new folder gets the full guide.
- `GET /settings` only reads: it reports the guide's state and never writes.

## The skill (the one write outside the designs folder)
- **Where:** `<config>/opencode/skills/design-chamber/SKILL.md`, where `<config>` is `XDG_CONFIG_HOME` when it is set to an absolute path, otherwise `~/.config` (on Windows `%USERPROFILE%\.config`). This is the one place OpenCode reads global skills from on every system. Design Chamber writes only there.
- **Only on a click:** the service writes it only from `POST /agent/skill`, which only Settings' Install, Update or Replace button calls. Nothing installs it on start, on a folder change or from a slash command. A designs folder change turns it "outdated" and Settings offers Update.
- **No path from the request:** the route takes one optional `replaceEdited` (true or false); every other key is ignored and any other value for it is refused with 400.
- **Symlinks:** if `~/.config/opencode` is a link into a dotfiles repo (common), the install follows it and Settings shows the real path before and after. A link at `design-chamber/` itself, or at `SKILL.md`, counts as someone else's and is never written through.
- **Duplicates:** OpenCode needs skill names to be unique, so Design Chamber never writes copies to `~/.claude/skills` or `~/.agents/skills`. If a `design-chamber` skill already sits in one of those, Settings lists it so the user can remove one copy. A folder that is only a link to OpenCode's own skills folder is not counted as a copy.
- **Answers:** `{ skill }` with the fresh state; 409 with "You changed this skill. Replace it with Design Chamber's version?" for an edited skill (unless `replaceEdited` is true); 409 with "A different skill called design-chamber is already at <path>, so Design Chamber left it alone." for someone else's; 500 with a plain sentence (for example "Design Chamber is not allowed to write to …") when the folder cannot be written.
- There is no uninstall button: the user deletes the `design-chamber` folder.

## Designs folder path rule
`PUT /settings` refuses a folder path containing a control character (a newline, a tab, NUL and the like) with "The folder path contains an invalid character.", because the path is written into the guide and the skill. Whitespace at the very start or end (a pasted trailing newline, say) is trimmed first.

## Data touched
- Read and written: `<designs folder>/AGENTS.md` (contained under the designs folder), `<config>/opencode/skills/design-chamber/SKILL.md` (only on the user's click).
- Read only: `~/.claude/skills/design-chamber/SKILL.md`, `~/.agents/skills/design-chamber/SKILL.md`.
- Never: `opencode.json` or any other OpenCode or OpenChamber setting.

## Pages that surface it
Settings in the rail panel and the full-screen page: the "Help your agent find your designs" section, between "Earlier folders" and "Browser for thumbnails".
- **Guide:** one sentence for its state: "Design Chamber keeps a guide for agents at <path>." (current or about to be refreshed), "You edited <path>, so Design Chamber leaves it alone.", "<path> is your own file, so Design Chamber didn't add a guide.", "The guide is added once your designs folder exists.", or the reason writing it failed. Paths are shortened in the middle with the full path as a tooltip.
- **Skill:** **Install skill** ("Adds a design-chamber skill to OpenCode at <path>, so any chat knows where designs go."), **Update skill** ("Your designs folder changed since you installed it."), an **Installed** badge with the path, **Replace skill…** for an edited skill, which asks in place ("Replace your edited skill with Design Chamber's version?", **Replace skill** / **Keep mine**) before sending `replaceEdited: true`, or text only for someone else's skill or when it can't be installed. The button spins while the request runs; a failure shows the service's sentence under it and Settings re-reads the status. Each extra copy gets a **Duplicate** line: "Another copy is at <path>. OpenCode needs one copy, so remove the other."
- **Snippet:** the `buildAgentsSnippet` lines for the current folder in a code block with **Copy**, and "Paste this into a project's AGENTS.md or your global ~/.config/opencode/AGENTS.md."
