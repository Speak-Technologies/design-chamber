# Design system homes and adoption

**What it is:** A system the agent builds from `/design-system` in chat has a **home**: **internal** (it lives in the Designs folder only) or **repo** (its files live in a project's repo, and Design Chamber only reads them). The agent says which in `_systems/<id>/BUILD.json`; Design Chamber checks the request and, if it holds, **adopts** the system. Spec: `documentation/specs/phase-2-5-technical.md` §2.13, §5.9, AD-14, AD-15, AD-20, AD-28, AD-33.

## The rule that never bends
Design Chamber never writes into a repo. The agent writes the repo files; the service reads them, checks them and records what it saw in the system's hidden `.chamber/state.json`.

## How a system is adopted
1. `/design-system` issues a **build ticket** (`sb_` + 12 characters) that remembers the chat's project folder.
2. The agent writes `BUILD.json`: the name, the home, for a repo home `repo: { directory, folder, livingPage }`, the ticket, and optionally the code folder it read.
3. The service sees the file change and checks it, in this order. The first failure stops adoption and shows one sentence on the system's page, with **Ask the agent to fix it**:

| Reason | When |
|---|---|
| `unreadable` | BUILD.json is not JSON, is over 64 KB, lacks a name or home, or a repo path has `..`, a dot segment, a backslash, a UNC or relative directory. |
| `ticket-unknown` | A repo home names a ticket that is not open (unknown, expired or already used). |
| `ticket-needed` | A repo home with no ticket, or a ticket from a chat with no project folder. |
| `repo-outside-project` | The repo is not the project folder or inside it (a monorepo root above the project gets its own sentence: open a chat there instead); the system folder is under a skipped folder such as `node_modules`; a link leads out of the repo; the Designs folder is the repo, inside the system folder, or around it. |
| `repo-overlap` | Another repo-backed system already uses this folder, a folder inside or around it, or the same living page (case folded where the disk folds case). The sentence names the other system. |
| `living-page-exists` | A file is already at the living-page path and it is not this system's own generated page (no `dc-living-page` mark naming this system, or a link). The user's file is never taken. |
| `code-outside-project` | The code folder is outside the ticket's project. |

4. Adopted: the home is stored with the repo's real path, the ticket is consumed, the project folder is kept in the build record (it outlives the ticket), the system is a Draft linked to the chat, and a code folder the agent named is scanned. An internal home needs no ticket. A name already taken (ignoring case) becomes "Name 2" and the list says so.

## After adoption
- **Until the first applied stamp** (`applied` in BUILD.json, written when the agent has put files in the repo) the agent may change the folder, the living page, the code folder, or go back to internal. Each change is checked again against the stored project folder. A change that fails leaves the last good home in place.
- **From the first stamp on** the home is fixed. A different home is `home-changed` ("Acme already has files in shop, so its home can't change. Make a new system to move it."). A different ticket is `ticket-changed`. A different name is ignored.
- **The stamp is acted on once.** The newest stamp seen is recorded in `state.json`, so a restart or a second write of the same stamp does nothing. A repo system's snapshot is refreshed and the approval the stamp claims is checked; an internal system with a code folder is scanned again.

## Read-only in Design Chamber (AD-20)
A repo-backed system cannot be changed here. Hand edits and their Undo, adding brand files (by upload or from a folder) and restoring a version all answer 422 `read-only` with "Acme lives in shop. Change the values there, or ask the agent here." The refusal comes before any version, upload or write. A dropped upload is discarded, not kept for a retry.

## Show in folder
`POST /reveal { system, target }` opens a system's place on disk. `target` is `folder` (the system's folder in Designs), `repo` (the system folder inside the repo) or `living-page`. The service works out the path from the stored home; the request can't carry a path (`{ system, path }` together is refused). A stored path that would leave the repo is refused, a missing one answers 404, and an internal system has no repo target.

## Where it lives in the code
`src/service/systems/homes.ts` (`verifyRepoHome`, the adopt and follow rules, `startHomes`), `src/shared/system-json.ts` (`parseBuildJson`, the sentences), `src/shared/systems.ts` (`repoHomeShapeProblem`, pure), `src/service/systems/living-safe.ts` (`readLivingPageMark`), `src/service/systems/store.ts` (`refuseReadOnly`, a repo system's content from its snapshot), `src/service/reveal.ts` (`revealSystem`). Tests: `test/service/systems/homes.test.ts` (adoption reasons, follow rules, the stamp, the repo left unchanged), `test/shared/build-json.test.ts`, `test/service/render/reveal.test.ts`, and the read-only cases in `assets-routes.test.ts`, `versions.test.ts` and `edits.test.ts`.

## Not in this version
A home change drops the staged living pages and supersedes the current proposal. A new stamp checks the approval it claims ([Proposals](design-system-proposals.md)).
