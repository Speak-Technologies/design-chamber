# Agent discovery (without a slash command)

**What it does:** Lets any chat agent find out where designs go, how to lay them out and how to check them, even when the user never typed `/design` or `/page`. Four channels carry the same core rules:

1. **A short note in every agent's instructions** (OpenChamber 2.7 and later). Details: [Agent instructions](agent-instructions.md#the-note-in-every-chat).
2. **The `design-chamber` skill**, shipped inside the extension, with the full design rules.
3. **A guide file**, `AGENTS.md`, that Design Chamber keeps in the designs folder, for agents that run outside OpenChamber.
4. **A snippet** the user can paste into an `AGENTS.md`.

Why it exists: an agent asked for "a design canvas" in a plain chat had no Design Chamber instructions. It wrote one long HTML file, saved it loose in the designs folder (only folders count as designs), used Google Fonts (blocked offline) and wrote the HTML before `design.json`.

## What the agent reads
All of it is plain text, written without em dashes.

- **The note in its instructions.** OpenChamber stores it and adds it before every message, in every project, while the extension is on: the designs folder, one folder per design, "load the design-chamber skill first", page or canvas, check with the `design_check` tool (the launcher command if the agent doesn't have that tool), show finished work with a DesignCard block and ask between directions with DirectionPick, and that `/design` and `/page` exist. The user does nothing to turn it on.
- **The skill, `design-chamber`.** It ships in the extension (`dist/skills/design-chamber/SKILL.md`, with the style presets as `presets/<id>.md` beside it) and reaches every agent OpenChamber runs while the extension is on. Its description tells the agent to use it when the user asks for a design, mockup, wireframe, UI screen, landing page, prototype, HTML page or design canvas, or mentions the Designs folder, Design Chamber or a design studio. The body is a short workflow (one folder per design, the slug rule, page or canvas, `design.json` first and which keys the agent may change, never touch `.versions/` and the like, the preset list), then `rules/DESIGN-RULES.md` and `rules/QUESTIONS.md` word for word, then the same "Rendering constraints" and "Check your work" sections RULES.md has. It holds no folder path, because it is the same file for everyone: the folder comes from the note. The text is built at build time from `rules/**` by `buildBundledSkill` (`src/shared/agent/skill-doc.ts`); nobody edits the built file. It is never called `design` or `page`, because OpenChamber drops an extension command whose name a skill already uses.
- **The guide, `<designs folder>/AGENTS.md`.** OpenCode loads `AGENTS.md` by itself when a chat's project is the designs folder, and agents that list the folder see it. It is all an agent outside OpenChamber (a terminal CLI, an editor agent opened in the folder) gets. In order it says: this is the user's designs folder (set in Design Chamber settings, `~/Documents/Designs` by default) and designs saved elsewhere do not show; every design is its own folder `<root>/<slug>/`, never a loose file, with the slug rule (lower-case letters, digits and hyphens, starts with a letter or digit, at most 63 characters); what a **page** is (one `index.html`, shown full screen like a browser tab) and what a **canvas** is (a wall of screens shown at several device sizes side by side, like Claude Design), when to pick a canvas; write `design.json` first, then the HTML, then `tokens.css`, `DESIGN.md` and `assets/`, with a short `design.json` example for each kind and which keys the agent may change; work offline; relative paths only; a "Check your work" section that names the `design_check` tool first and, for an agent without it, the launcher command (the folder name goes where it says `<slug>`), or a read-through of the HTML when the launcher could not be written; never touch `.versions/`, `.chamber/`, `.thumb.png` or `.trash/`; a digest of at most 10 lines of the design rules (one line says to run the check before saying done); a pointer to `/design <brief>` or `/page <brief>`; and that editing the file stops Design Chamber from updating it. Folder paths use the operating system's separators.
- **The snippet** (Settings shows it with a Copy button):

  ```
  ## Designs (Design Chamber)
  When I ask for a design, mockup, page or canvas, save it in my designs folder: <root>
  Read <root>/AGENTS.md first and follow it. Each design is its own folder there, never a loose
  .html file. Write design.json first, then the HTML. Work offline: no CDNs, no Google Fonts.
  ```

Size caps: the note 4 096 characters (OpenChamber's limit; a very long folder path loses the launcher clause first), guide 8 000, snippet 1 000. A designs folder path so long that a text would pass its cap, or one with a control character in it, is refused rather than written or sent.

**Chats run through the Claude Code harness** inside OpenChamber get all of it too (checked live on 2026-11-10, Phase 1.5 spec §12.3 step 3.6): the note, the `design-chamber` skill, the chat blocks and the `design_check` tool, which shows up there as `mcp__openchamber__design_check`. They need nothing extra.

## The ownership rule (never overwrite the user's file)
The guide carries a marker with a hash of its own text on its first line (`<!-- design-chamber:guide v1 sha256:… -->`). Design Chamber only rewrites it while the marker is there and the hash still matches, meaning nobody changed it.

| What is on disk | Guide |
|---|---|
| Nothing | Written |
| Ours, up to date | Left as is |
| Ours, older text (different folder or wording) | Rewritten |
| Ours but edited, even one character or emptied | Left alone for good |
| No marker (the user's own file) | Left alone |
| A symlink, a folder or anything not a plain file | Left alone |

The final check and the write happen in one step, so an edit that lands while Design Chamber is writing is kept. Deleting the guide brings Design Chamber's version back at the next service start or the next new design. Editing it, even to empty it, stops all updates. On a drive that ignores letter case, a file called `agents.md` counts as the guide's name and, having no marker, is left alone. A change in Design Chamber's wording (like the `design_check` line) changes the hash, so an unedited guide is refreshed at the next start.

## The launcher the commands point at
The note, the guide and the chip quote a command that runs `<designs folder>/.chamber/bin/dc` (`dc.cmd` on Windows). The service writes both scripts when it starts (asking for the command is what writes them, once per folder), and again for a new designs folder; it rewrites one only when its bytes differ, never touches a file at that spot it did not write, and never runs it. If the extension's check tool is missing (a checkout that was not built) or the folder path cannot be quoted, no launcher is written and the texts leave the command out. Details: [Design checks](design-checks.md).

## When the guide is written
- When the service starts (once the folder watcher has its baseline), if the designs folder exists. Design Chamber never creates the designs folder just for the guide.
- When a new design folder appears (debounced 2 seconds), which also covers a designs folder created after start.
- When the user changes the designs folder in Settings: the guide in the old folder, if it is ours and unedited, is replaced by three lines saying where designs are saved now ("Design Chamber now saves designs in …"). It stays ours, so switching back restores the full guide. The new folder gets the full guide.
- `GET /settings` only reads: it reports the guide's state and never writes.

## The older skill copy (the one delete outside the designs folder)
Before the skill shipped inside the extension, Settings could install a copy at `<config>/opencode/skills/design-chamber/SKILL.md` (`<config>` is `XDG_CONFIG_HOME` when it is set to an absolute path, otherwise `~/.config`; on Windows `%USERPROFILE%\.config`). That copy has the same name as the built-in skill, so an agent could see two. Design Chamber no longer installs anything there.

- **Status:** `GET /settings` reports that copy's state (`agent.skill`): `not-installed`, `current` or `outdated` (ours and unedited, for this folder or an older one), `edited`, `foreign` (no Design Chamber marker, or a symlinked `design-chamber` folder or `SKILL.md`), or `unavailable` with a sentence. Reading never writes.
- **Removal, only on the user's click:** `DELETE /agent/skill` (the **Remove old copy** button in Settings) deletes that one file, and then its `design-chamber` folder if nothing else is in it. It deletes only when the file carries the marker older versions wrote in its frontmatter (`metadata: generator: design-chamber, sha256: "…"`) and the hash still matches, so the file is ours and nobody changed it. Whatever folder the user has now does not matter; the file's own marker decides.
- **Answers:** `{ skill }` with the fresh status (`not-installed` once it is gone, and also when nothing was there, so pressing twice is harmless). An edited copy: 409 "That copy has your own edits, so it stays. Delete it yourself if you don't need it." Someone else's skill, a symlink, a folder where the file should be or a file where the folder should be: 409 "That skill isn't one Design Chamber wrote, so it stays." A file the system won't let go of: 500 with a plain sentence ("Design Chamber isn't allowed to delete <path>. Delete it yourself if you don't need it.", or "<path> is in use by another program. Close it and try again.").
- **Safety:** the path is fixed; nothing in the request (body or query) is read. The leaf `design-chamber` folder and `SKILL.md` must not be symlinks; the file is opened without following a link and must be the very file that was checked, and the folder is checked again right before the delete, so a swap in between is refused. Symlinks above `skills/` (a `~/.config/opencode` that lives in a dotfiles repo) are the user's own setup and are followed. Only the leaf folder is ever removed, and only when empty (never a recursive delete). A copy over 64 kB cannot be verified and stays.
- **Duplicates:** copies in `~/.claude/skills/design-chamber/` and `~/.agents/skills/design-chamber/` are listed in the status so the user can tidy them, and are never written or deleted.

## Designs folder path rule
`PUT /settings` refuses a folder path containing a control character (a newline, a tab, NUL and the like) with "The folder path contains an invalid character.", because the path is written into the note and the guide. Whitespace at the very start or end (a pasted trailing newline, say) is trimmed first.

## Data touched
- Read and written: `<designs folder>/AGENTS.md` (contained under the designs folder).
- Sent to OpenChamber: the note, through the extension's instructions permission.
- Shipped, never written at run time: `dist/skills/design-chamber/` inside the extension.
- Read, and deleted only on the user's click when ours and unedited: `<config>/opencode/skills/design-chamber/SKILL.md`.
- Read only: `~/.claude/skills/design-chamber/SKILL.md`, `~/.agents/skills/design-chamber/SKILL.md`.
- Never: `opencode.json` or any other OpenCode or OpenChamber setting.

## Pages that surface it
Settings in the rail panel and the full-screen page: the "Help your agent find your designs" section, between "Earlier folders" and "Browser for thumbnails". See [Rail panel](../pages/rail-panel.md) for the Settings rows.
- **Guide:** one sentence for its state: "Design Chamber keeps a guide for agents at <path>." (current or about to be refreshed), "You edited <path>, so Design Chamber leaves it alone.", "<path> is your own file, so Design Chamber didn't add a guide.", "The guide is added once your designs folder exists.", or the reason writing it failed. Paths are shortened in the middle with the full path as a tooltip.
- **Agent skill:** says the skill is built in, and when an older copy is installed, where it is, with **Remove old copy** for an unedited copy of ours (no confirm: the file is Design Chamber's own and the built-in skill replaces it). An edited or someone else's copy is named with its path and left alone.
- **Snippet:** the `buildAgentsSnippet` lines for the current folder in a code block with **Copy**, and "Paste this into a project's AGENTS.md or your global ~/.config/opencode/AGENTS.md."
