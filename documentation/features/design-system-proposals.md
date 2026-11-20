# Design system proposals

**What it is:** Before the agent changes a repo-backed system (or an internal system's token fixes in the app's code), it writes a proposal: `PROPOSAL.json` in the system's folder, plus any new files under `proposal/`. Design Chamber reads it, checks it against the build, draws a preview, and shows the user what would change. The agent applies it in the repo only after the user approves it in chat. Afterwards Design Chamber compares what landed against what was approved. Spec: `documentation/specs/phase-2-5-technical.md` §2.15, §5.14, AD-26, AD-27, AD-30.

## What the agent writes
`PROPOSAL.json` (at most 512 KB): an `id` (`p_` plus 8 to 16 lower-case letters or digits, a new one for every change), `supersedes`, `created`, `mode` (`fix`, `describe` or `none`), a `summary`, the `parts` (`system-files`, `token-fixes`, `docs`, `living-page`), each with its files, `wayBack` (how to undo it) and `access`. Each file has a repo-relative `path`, a `change` (create, modify or delete), a summary, the added and removed line counts, and optionally a `patch` or, for a new system file or doc, `from: "proposal/<file>"`.

`parseProposal` (`src/shared/system-json.ts`) is tolerant. Only these make the whole file unreadable: not JSON, over 512 KB, no valid id, no parts list, or more than 200 files in all. A bad field or file entry is skipped with its own sentence. A patch over 20 000 characters, or past the 400 000 character budget for all patches, is dropped and the file says "The change is too long to show here; it's in the chat." The living page never carries a patch, because Design Chamber generates it.

## What the service does with it
1. **Waits for quiet.** Any change to `PROPOSAL.json` or `proposal/**` restarts an 8 second wait, because the agent writes several files. Each system is also settled once at service start.
2. **Records it** in `<system>/.chamber/proposals.json` (the last 20 ids). The hash covers `PROPOSAL.json`'s bytes and, for a repo home, every file in `proposal/`.
   - A new id makes the previous one *superseded*.
   - The same id with other bytes is *rewritten*, for good, even if the bytes are put back: "This proposal changed after it was shown. Ask the agent for a new one."
   - A file the parser can't use is *unreadable*, with the parser's sentence.
3. **Checks it against the build.** Each problem is listed on the proposal and disables Approve. None of them stops the rest:
   - the build is adopted and past round one;
   - system files sit inside the system's folder;
   - the living page is the path the build named;
   - a *create* of a file that already exists in the repo is a problem (only an `lstat`);
   - every `from` file exists in `proposal/`;
   - describe mode never modifies or deletes the app's code;
   - an internal home holds only token fixes;
   - `mode: none` holds no token fixes.
4. **Draws the preview** (repo home with a `proposal/` folder): the living page from `proposal/` (`.chamber/living-page-preview.html`, with a "Preview of proposal …" band and no mark), and the board over `proposal/` (`GET /systems/:id/board?proposal=<id>`). A preview that is too large, fails the safety check, or shows something shaped like a secret is a proposal problem. A secret blocks Approve whatever `access` says, and that page is never written.

## Approval (AD-27)
The agent writes `applied` and `proposal` in BUILD.json once it has applied the change. When the stamp is new, the service approves only if the named id is the current one and `PROPOSAL.json` and `proposal/` still hash to the bytes that were shown. The service then marks the entry approved and records `state.build.approved { proposal, sha256, parts }`. Anything else (an unknown id, no id, a superseded, declined, unreadable or rewritten one) sets `applied-unknown-proposal`: "The agent says it applied a proposal you didn't approve here (p_…). Check shop's history." The snapshot is read either way, because the repo is what it is. Stamping the same approved proposal again (the agent fixing what landed) stays approved.

**Stop** on a running build declines the current proposal before the system goes to the trash, so Undo brings the record back with it. A home change supersedes the current proposal, because it was written for the old home.

## What landed
After the snapshot refresh that follows an approval, `compareLanded` checks two things:
- **Differences.** Each `system-files` entry with `from` is compared with the snapshot's copy, line endings ignored. Any difference goes in `state.landed.differ`, 20 at most: "What landed in shop differs from what you approved in 2 files: tokens.css, OVERVIEW.md."
- **Unclaimed parts.** A stamped part with nothing to show for it goes in `unclaimed`: "The agent says it applied docs, but Design Chamber found no docs in shop." Nothing to show means no file of that part in the repo, no living page at its path, or, for token fixes, a drift count that didn't go down.

Design Chamber always shows what landed, never what was claimed. The system check reports it as `system-landed-differs`. It reports a bad current proposal as `system-proposal-invalid`, with the parser's or the check's sentence.

## Routes
- `GET /systems/:id/proposals/:proposalId`: the proposal as the panel shows it. It answers from the record and the parsed file only. A `proposalId` that fails its pattern is 400; an id never recorded answers `{ state: "unknown" }`. The current one carries its parts, problems and preview state (`generating`, `ready`, `failed`).
- `GET /systems/:id/living-page/render?which=staged|preview&scheme=light|dark`: the staged page or the preview, read from `.chamber/` only, never the repo. It answers 404 "There's no living page to show yet." when there is none.
- `GET /systems/:id/living-page/render/chunk?key=&n=`: the render in pieces. A key that was dropped, or that belongs to another system, is stale.

## The repo stays untouched
The service writes only `.chamber/proposals.json`, the preview page and `state.json`, all under the Designs folder. Repo paths are only `lstat`ed through the repo's real path. `test/service/systems/repo-readonly.test.ts` fingerprints the repo around a whole proposal (settle, preview, the routes, the approval and the landed compare).

## Where it lives in the code
- `src/service/systems/proposals.ts`: settle, record, the step 3 checks, approval, decline, supersede, `compareLanded`, `startProposals`.
- `src/service/systems/proposal-record.ts`: the record, the bounded `PROPOSAL.json` read, the `proposal/` helpers, and `readProposalProblem` for the check.
- `src/shared/system-json.ts`: `parseProposal`, `landedSentence`.
- `src/service/systems/living-page.ts`: the preview generation, `renderLivingPage`, `livingPageChunk`.
- `src/service/systems/board.ts`: the preview board.
- `src/service/systems/homes.ts`: the stamp calls `approveLocked`.
- `src/service/systems/builds.ts`: Stop declines.
- `src/service/routes/system-build.ts`: the routes.

Tests: `test/shared/proposal-json.test.ts`, `test/service/systems/proposals.test.ts`, `test/service/systems/proposals-routes.test.ts`, `test/service/systems/repo-readonly.test.ts`, `test/service/check/system-s8.test.ts`.

## Not in this version
The proposal block in the panel (showing a proposal, Approve and Decline) is the UI lane's work.
