# Open a project file as a page

Right-click an `.html` or `.htm` file in OpenChamber's Files list (a long press on the phone) and pick
**Open as page in Design Chamber**. Design Chamber copies the file into a new page design and opens it
in the rail. It is always a copy: later edits to the project file don't follow it, and the page never
points back into the project. This page describes what the user is told, what gets copied, what is
left out and why, when a click opens a copy that already exists, and every refusal.

## Where it shows
- OpenChamber puts the entry on every Files row, folders included; it has no file-type filter. A row
  that isn't an `.html` or `.htm` file answers with one line ("Only .html and .htm files open as
  pages." or, for a folder, "Pick an .html file to open it as a page.") and nothing else happens.
- It runs as a background action, so it works on the phone too.
- Only a click on a Files row can start it. A design, a chat block or a model can't.

## What the user sees
Every click ends in one toast. There is no automatic retry: click again.

| What happened | Toast |
|---|---|
| Copied, rail opened | Saved “Pricing” as a page in Design Chamber. |
| Copied, rail couldn't open | Saved “Pricing” as a page. Open Design Chamber to see it. |
| Already there (same file unchanged, or a file of a design) | “Pricing” is already in Design Chamber. Opening it. |
| Already there, rail couldn't open | “Pricing” is already in Design Chamber. Open Design Chamber to see it. |
| A folder row | Pick an .html file to open it as a page. |
| Another file type | Only .html and .htm files open as pages. |
| The service refused | Its own sentence (see Refusals below). |
| The service didn't answer | Design Chamber isn’t responding. Try again in a moment. (On a phone: “…isn’t responding on your computer…”) |
| The service isn't allowed or the extension is paused | The same advice the rail shows (allow the service, or turn the extension back on). |

When local files were left out, the success or "already there" toast adds a sentence for each reason,
with the count:
- "2 files it uses are outside its folder, so they weren’t copied."
- "1 file it uses is missing."
- "1 file it uses can’t be copied into a page, so it was left out."

On a phone whose build has no Design Chamber tab, "Open Design Chamber to see it." becomes "Open Design
Chamber from the More menu in your chats list." A long title is cut to 80 characters so the counts
still fit in the toast.

## What gets copied
- **The HTML, byte for byte**, as the new page's `index.html`. Nothing in it is decoded, rewritten or
  cleaned: a BOM, odd bytes and remote links all stay as they were.
- **The local files it uses from its own folder**, at the same place inside the design, byte for
  byte: stylesheets (and the sheets and images they `@import` or `url()`), scripts, images, fonts,
  audio and video, JSON, and pages it embeds in an `<iframe>` (with their own files). These are the
  references the viewer already follows when it renders a design.
- Only these types are copied: images (png, jpg, gif, webp, avif, svg, ico), fonts (woff, woff2, ttf,
  otf), media (mp4, webm, mp3, wav), css, js, mjs, json, html, htm and txt. So a reference like
  `<link href=".env">` copies nothing.
- The title comes from the file's `<title>`, else from its name (`launch-day.htm` becomes "Launch day").
- The page is filed under the project the Files list belongs to (its folder becomes the design's
  project). It is linked to no chat: only a chip links a design to a chat.
- The page appears only when the copy is complete: the files go in first and `index.html` last.
- The copy is Design Chamber's own write, not the agent's: the build strip never shows "Writing"
  for it. Each copied file is recorded before it is written, so the folder watcher drops its echo,
  and the new design's `added` events (the store's, and the watcher's when it first sees a folder
  whose state says it was copied) are marked as Design Chamber's. A new folder that holds only
  copied files is Design Chamber's too. A large file is matched by its content (a sha256), not its
  size or time, so an agent that later rewrites a copied file, even with the same size, still shows
  as writing.

## What is left out (and counted)
The answer counts what wasn't copied, so the toast can say so (see What the user sees). In the viewer
the page then shows its usual badges.
- **Outside its folder:** a reference that climbs out of the HTML file's folder (`../shared/logo.png`),
  a link inside the folder that points out of it, an absolute drive path, a `file:` URL. These are
  never read. Copying them would need rewriting the HTML, which Design Chamber doesn't do.
- **Missing:** a file the HTML names that isn't there (or vanished, or became a link, while copying).
- **Other:** a type that is never copied (see above), and names that belong to Design Chamber inside a
  design: `index.html` at the top (that name is the page itself), `design.json`, anything under
  `system/`, and any file or folder whose name starts with a dot (`.chamber`, `.versions`, `.env`).
  This is what stops a project file from planting service state in the new design.
- **Remote files** (`https://…`) stay in the HTML. The viewer blocks them as it does for any design and
  offers **Ask the agent to fix it**.

## Clicking the same file again
- **Unchanged file:** the click opens the copy already made instead of making another. "Unchanged"
  means the same path and the same bytes (a sha256 of the file). Design Chamber remembers where a page
  came from in the design's `.chamber/state.json` (`importedFrom: { path, sha256, at }`); it never
  goes into `design.json`, so agents don't see it.
- **Changed file:** a new copy. The older copy stays as it was.
- Design Chamber looks through the newest 50 pages for a match. A copy older than that, or one whose
  folder was renamed outside the app, gets a fresh copy.
- A file that is already part of a design in your Designs folder opens that design, with no copy.

## Refusals
Each answers a plain sentence the toast shows as is. Nothing is created in any of these cases.

| Case | Status | Sentence |
|---|---|---|
| Not `.html` / `.htm` | 422 | Only .html and .htm files open as pages. |
| A folder, or not a regular file | 422 | Pick an .html file to open it as a page. |
| A network or device path (`\\server\share`, `\\?\`) | 422 | That file is on a network drive. Copy the file to this computer first. |
| A relative path with no folder, or a Windows path without a drive | 422 | Design Chamber couldn't tell which folder that file is in. Open it from the project's Files list again. |
| A relative path that climbs out of its folder | 422 | That file is outside the project folder, so Design Chamber won't open it. |
| The file is a link | 422 | That file is a link. Open the file it points to instead. |
| A loose file directly in the Designs folder | 422 | That file is in your Designs folder. Import it from Design Chamber's list. |
| Any other file under the Designs folder that isn't part of a design (`.trash`, your own folder) | 422 | That file is in your Designs folder but isn't part of a design, so it can't be opened as a page. |
| The file is gone | 404 | That file isn't there any more. |
| No permission to read it | 500 | Design Chamber isn't allowed to read that file. Check its permissions, then try again. |
| The HTML is over 20 MB | 413 | That file is over 20 MB, so it can't be opened as a page. |
| The files it uses add up to over 50 MB | 413 | This page uses more than 50 MB of files, so it can't be copied. Export it from your project instead. |
| The copy runs over 12 seconds | 413 | Copying this page took too long, so it was stopped. Export it from your project instead. |
| The same file is being opened already (a double click) | 409 | That file is being opened already. |
| The body isn't `{ path, directory }` | 400 | (a sentence naming the bad field) |

## When the copy fails part way
- If a write fails (disk full, no permission, a clash) or the copy runs over its size or time limit
  after the page was made, the half-made page goes to `.trash` like any deleted design. The project is
  only ever read, so nothing there changes. The sentence says what went wrong ("There isn't enough disk
  space to copy that page.", "Design Chamber isn't allowed to write to your Designs folder.").
- If OpenChamber stops waiting for the action (it allows 20 seconds), the service still finishes: the
  page appears and the rail opens it, but the toast is lost.

## Safety rules
- The route sits behind the service's bearer token like every route.
- The path from the Files row may be absolute or relative to its folder; both are accepted (the
  OpenChamber docs don't say which it sends). Windows paths are handled with Windows rules: drive
  letters, either slash, and case-insensitive folder names.
- The picked file is opened without following a link. Every file it uses is resolved inside the HTML
  file's own folder (`resolveInside`), once when the page is scanned and again just before it is
  read, so a link swapped in meanwhile is refused.
- Every write goes inside the new design folder only, through `resolveInside` and an atomic write.
- The copied page is untrusted HTML like any design: it renders only in the sandboxed artboard frame.
- Log lines carry the design name and counts, never the file's path or contents.

## Where it lives in the code
The click and the toasts: `runAction` in `src/guest/flows.ts`, wired in
`src/guest/background-main.ts` (tests: `test/guest/flows.test.ts`). The service:
`src/service/file-page.ts` (body, target, scan, copy), `POST /pages/from-file` in
`src/service/routes/chat.ts` (leaves the open request for the rail), `readRegularFile` in
`src/service/loose.ts` (shared with the loose-file import), `importedFrom` in `src/service/store.ts`.
Tests: `test/service/core/file-page.test.ts`, `test/agent/chat-routes.test.ts`.
