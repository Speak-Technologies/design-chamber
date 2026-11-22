# Design systems

**What it is:** A design system is its own item in the Designs folder: colours, type, spacing, corner radii, shadows, layers, sizes, components, notes on how to use each, and brand files. The user reviews it, marks it Ready, and from then on designs can start from it. Plain files, so the chat agent can read and write them.

Pieces, each with its own page:
- This page: what a system is, how one is made from the New design system sheet, and what the list shows.
- [Brand files](design-system-brand-files.md): fonts, logos and documents, and the rules the service holds them to.
- [Hand edits](design-system-hand-edits.md): changing a value or a note by hand.
- [Re-sync](design-system-resync.md): bringing token values up to date with the code a system was read from.
- [Homes and adoption](design-system-homes.md): internal and repo-backed systems, how the agent's BUILD.json is checked, and why a repo system is read-only here.
- [Proposals](design-system-proposals.md): what the agent proposes before it changes a repo, the checks and preview, the approval it stamps, and what landed.
- [The list and the sheet on screen](../pages/design-systems.md).

## Where a system lives
`<Designs folder>/_systems/<id>/`: `system.json` (the structured part), tokens, the overview and notes, `assets/` and `sources/`, and a hidden `.chamber/` for what Design Chamber itself records (review state, revision, where values came from). The list never shows a system among the designs, counts it as one, or offers it in Work Status.

An **internal** system lives there only. A **repo-backed** system is read from a project's repo (made with the `/design-system` command in chat, or registered from the sheet as it is, see below); its rows say **Repo · shop**. Everything else the sheet makes is internal.

## Making one (the New design system sheet)
Steps from the list to a system with an agent working on it:

1. **New design system** (or **From code…**, **From brand files…**, **Describe…** on the empty list): 1 step.
2. Name it and tick what to start from: 1 to 3 steps.
3. Fill each ticked source: choose a project (the scan starts by itself), drop or choose files, or type a description.
4. **Make design system**: 1 step. Everything that can be wrong is said then, beside the field.

What happens on **Make design system**, in order:

1. `POST /systems` creates the Draft with what was gathered: the code scan's values the service is sure of and the ticked font and logo files, the description and preset, and a note that brand files follow. Nothing was written before this. If it fails, the sheet keeps everything and says why.
2. Each brand file is read in the sheet and sent as base64 pieces (`POST /uploads` with `encoding: "base64"`, at most 60 000 characters a piece, one file at a time), then recorded with `POST /systems/:id/assets`. A folder goes through `POST /systems/:id/assets/from-folder`. A file the service refuses (a renamed file whose contents don't match its type, a clash with the limits) is kept in the result and never stops the rest.
3. `POST /systems/:id/prompt` with `purpose: "make"` returns the request for the agent and the chip that names the system. The request tells the agent the system's folder, what to write (overview, usage notes, component inventory, anything Design Chamber couldn't parse), the sources, and to change nothing in the project.
4. Delivery: **New chat** starts a chat in the project that was scanned (else the current project) with the chip attached; **Current chat** attaches the chip and puts the request in the composer. The system remembers the chat (`PATCH /systems/:id` with `sessionId`); a failure to remember it never undoes a request that was already sent.

If step 3 or 4 fails the system still exists as a Draft with what was gathered, and the result offers **Try again** (steps 3 and 4 only: no second system, no second upload) and **Copy request**.

## The code scan the sheet starts
`POST /system-scans { directory }` starts a bounded, read-only scan; the sheet polls `GET /system-scans/:scanId` about twice a second and stops it with `DELETE` on **Cancel scan**, on choosing another folder and when the sheet closes. Only counts and paths travel to the sheet: the values stay in the service until the system is made from that scan. The project is only read. Secret files and anything a link leads out of the project are never opened.

<!-- Phase 2.6 E1 (service facts). E2 adds the sheet's screens and copy for this in its own section. -->
## Starting from an existing system (Phase 2.6)
Many projects already have a design system: a page at `/design-system`, docs, components, token files. Design Chamber can find it, read what it can parse from it, and point the agent at the rest. It never fetches a web address and never writes the project.

**What every scan now says.** A scan's summary counts the files it actually opened (`read`, which is what "Files read (N)" shows, not only the files that held values) and what it saw but never parses (`missed`: pages, component files and themes written in code). Design Chamber reads CSS and token JSON; the rest is left for the agent.

**Finding candidates.** A scan of a whole project also lists up to 10 folders that look like an existing system (`candidates`, with "and N more" past that). It works from the scan's own file list and token counts only: no second walk, no extra file opened, so `node_modules`, build output, dot folders, links and secret files are never considered. A folder qualifies when it holds Design Chamber's file contract (`system.json` and `tokens.css`), a design-system page (`app/design-system/page.tsx`, `public/design-system/index.html`, `src/pages/design-system.tsx`), when it is named like one (`design-system`, `style-guide`, `ui-kit`), when it holds `DESIGN.md` or `design-system*.md`, or when it has docs and token files together. A lone token file or a lone brand note does not. Each candidate carries its path, what marks it (contract, page, tokens, docs, components, theme), counts, whether it is strong enough for the sheet's nudge (contract, page or a system-named folder), and the system already made from it ("Already in Design Chamber as Speak UI"). Only a folder with `system.json` is ever marked as the contract.

**Reading one folder.** `POST /system-scans { directory, location }` scans only that folder. The location may be relative to the project or a full path, with either slash. It is refused before anything is touched when it looks like a web address ("Use the folder on this machine, not a web address.") or a network share from a local project; then it must exist, be a folder, not be the Designs folder or inside it, and lie inside the project compared as real paths, so a link inside the project that leads out is refused ("Pick a folder inside shop."). The answer's `location` lists the page, docs and component files found there (at most 20 of each) and, when the folder holds `system.json`, whether the contract is complete or what is missing. A complete one is read whole into the scan's memory, exactly as a snapshot is read, ready for registering.

**Make a new system from it.** `POST /systems` with that scan makes an internal Draft as from code. The folder is checked again first ("That folder is gone. Pick another location." if it went). The system records the folder as its code source, so a later re-sync reads the same place, plus the project and the files found there. The request to the agent names the project (not the folder) in "Don't change anything in…", says to start from the system in that folder, lists the files to read first and says to reconcile to what is there rather than invent a parallel system. When the request is too long the file lists shrink first (20, then 5, then none). A re-sync that moves the code source outside the project turns it into a plain code source.

**Register it as it is.** `POST /systems/register { scanId, name }` takes a done location scan whose folder holds a complete contract. It makes a repo-backed Draft that is read-only here, with its first snapshot from the scan's own read (re-hashed, never read again) and recorded as the user's. There is no ticket, no BUILD.json, no build record and no request to the agent. The living page goes to `index.html` in that folder, or `living-page.html` when `index.html` is taken; with both taken it is refused. P25's repo-home checks run inside the create step (another system in the same folder is named in the refusal), the name must be free, and a failure after the folder was made moves it to the trash so nothing half-registered stays. A registered system is not "being built"; Stop and "pick up the build" are refused because there was no chat build; re-sync, the living-page request and delete work as for any repo-backed system.

**The builder flow.** In a `/design-system` chat the agent may record the system it started from in BUILD.json as `"existing": { "folder": "design-system" }` (`"."` for the project root). On adoption it must be a folder inside the chat's project; otherwise it is ignored and the system page says "The existing system must be a folder inside the project this chat is in, so Design Chamber ignored it." The build is adopted either way. The adoption scan fills in the files found there and lists the candidates in `.chamber/scan.json` for round two.

## What the list shows
Each summary also carries when the system was made and up to six of its light colour values (brand colours first, each a valid colour, never a `var()` reference) for the library's tiles; they are system content, painted only after the guest checks them again. Each row: name, **Draft** or **Ready**, where it lives, at most two badges by priority (**Being built**, **Changes to review**, **Default**, **Pinned for shop**, the living page's state), anything beyond two folded into "+N", a shared-repo line, what it was made from, who uses it and when it changed. Draft means no design can start from it yet; Ready means it can. The priority and folding rules are pure and tested (`src/ui/model/systems-model.ts`, `test/ui/systems-list-model.test.ts`).

**Make default** writes the default into settings (`PUT /settings` with `systemDefault`); only a Ready system can be the default, and **Remove as default** goes back to asking each time. **Delete…** moves the system to the Designs folder's trash, clears the default and pins that named it, and says so. Designs that already use it keep their copy.

## Rules the screens hold
- Nothing is written before **Make design system**; input is kept on every failure.
- One filled button per view. A description or a preset is enough to make one from a description; a code source needs a finished scan; a brand source needs a file or a folder.
- Names: 1 to 60 characters, no line breaks or tabs, unique ignoring case.
- Files by picking or dropping work inside the sandboxed frame (spike SP-1); **Add from a folder…** is the way for a folder.
- Text from a system, a scan or a file name is always shown as text, never as markup.

## Using a system from a design
A design shows its system as a chip in the viewer, with an update banner, a review sheet, Change… and Undo ([Viewer: a design's system](../pages/viewer.md)). Rows and cards in the designs list carry a **System updated** badge when the system has a newer revision than the design's copy. Defaults and project pins live in Settings, and the New design dialog preselects from them ([Settings: Design systems](../pages/settings.md)). Code: `src/ui/components/system-chip.ts`, `src/ui/model/design-system-model.ts`.

## Asking in chat (the SystemAsk block)
A `/design-system` chat asks its questions in place, as one chat block with three views (spec §8.12). It sits in the chat's reply and answers the chat with one message.

- **Round one, "Before I read the code" (Round 1 of 2).** Where the system lives, whether to fix the code or only describe it, which parts to cover (checkboxes), and dark mode. The recommended answer is bold and already picked. **Go with these** sends the picks. With no project folder open in the chat, home and mode are hidden and a line says the system will live in Design Chamber and the code stays untouched.
- **Round two, "A few calls from the code" (Round 2 of 2).** Only the calls the agent found, each with its fixed options and "From the agent:" lines for why and what it proposes. Picking **Custom** points to the note. A call the block can't show is counted in a line ("1 question couldn't be shown; answer it in the chat.").
- **The diff.** The header names the system (read from the service, never from the block's text). Each part (System files, Token fixes, Docs, Living page) has a switch, on by default, with its file count. Files open to their patch as plain text; unlisted use rewrites are summed up ("214 uses in 38 files. Listed in the chat."). **Preview living page** and **Open the board** open Design Chamber in the rail. **Approve** reads "Approve all 4 parts" or "Approve 3 of 4 parts" and is off, with the reason, when no part is on or the proposal has problems. **Decline** swaps the footer to **Describe only instead** (fix mode only), **Stop** and **Back**. Stop removes the draft first and then tells the chat; **Undo** brings it back for a few minutes. A 409 shows its own sentence and sends nothing.
- **Both rounds have their own note box.** A note alone never counts as approval.
- **Read-only states.** Superseded, rewritten, unknown, unreadable and expired proposals or tickets show a sentence and no buttons. An answered block shows what was picked. If the host won't take the answer, the choices stay and **Copy my answer** appears; any other refusal says "Couldn't send your answer. Type it in the chat instead." and keeps the form.
- **Fresh.** The block rereads on window focus and every 5 seconds while it is visible and unanswered.

Code: `src/ui/blocks/system-ask*.ts`, `src/ui/model/system-ask-model.ts` (pure) and `parseSystemAskArgs` in `src/ui/model/block-args.ts`. Visual check: `test/ui/visual/scenarios/system-ask.mjs`.

## Not in this version
**Continue in chat** and **Pin to project…** in the row menu, and building a repo-backed system from the list.

## Where it lives in the code
`src/ui/systems/` (the list, the sheet, the one seam for opening a system), `src/ui/model/systems-model.ts` and `new-system-model.ts` (pure), `src/ui/components/systems-store.ts` (the list, kept fresh by the change feed), `src/guest/make-system.ts` (create, upload, ask, register), `src/guest/service-client.ts` (`uploadBinary`). Existing systems: `src/service/systems/candidates.ts` (discovery, pure), `scan-folder.ts` (`validateLocation`), `extract.ts` (location scans, the contract verdict), `register.ts` and `routes/system-register.ts`; tests `test/service/systems/{candidates,scan-folder,location-scan,register}.test.ts` and the read-only proof in `repo-readonly.test.ts`. Tests: `test/ui/systems-list-model.test.ts`, `test/ui/new-system-model.test.ts`, `test/guest/make-system.test.ts`, `test/guest/binary-upload.test.ts`; the screens: `test/ui/visual/scenarios/design-systems-list.mjs`.
