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

An **internal** system lives there only. A **repo-backed** system is read from a project's repo (made with the `/design-system` command in chat); its rows say **Repo · shop**. The sheet in this feature makes internal systems only.

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

## What the list shows
Each row: name, **Draft** or **Ready**, where it lives, at most two badges by priority (**Being built**, **Changes to review**, **Default**, **Pinned for shop**, the living page's state), anything beyond two folded into "+N", a shared-repo line, what it was made from, who uses it and when it changed. Draft means no design can start from it yet; Ready means it can. The priority and folding rules are pure and tested (`src/ui/model/systems-model.ts`, `test/ui/systems-list-model.test.ts`).

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
`src/ui/systems/` (the list, the sheet, the one seam for opening a system), `src/ui/model/systems-model.ts` and `new-system-model.ts` (pure), `src/ui/components/systems-store.ts` (the list, kept fresh by the change feed), `src/guest/make-system.ts` (create, upload, ask), `src/guest/service-client.ts` (`uploadBinary`). Tests: `test/ui/systems-list-model.test.ts`, `test/ui/new-system-model.test.ts`, `test/guest/make-system.test.ts`, `test/guest/binary-upload.test.ts`; the screens: `test/ui/visual/scenarios/design-systems-list.mjs`.
