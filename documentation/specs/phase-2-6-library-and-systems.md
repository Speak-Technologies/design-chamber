# Phase 2.6 · Library and systems: requirements spec

Product spec by the product specialist, 2026-11-22, branch `feat/phase-2-6` (from `master` at v0.4.0).
It says **what** each feature must do; the architect decides **how** (`docs/SPEC.md` stays the authority
for architecture and lanes). No schema, file name or component in this spec is binding unless it already
exists in the code.

Sources: the owner's seven asks (chat 2026-11-22, relayed by the main agent), `docs/BRIEF.md` (owner
decisions, including Phase 2.5's folders-as-tags, the extraction split, the system pick order and the
guide ownership rule), `docs/SPEC.md` §6.7 to §6.9, §9.19, §10.16, §11.8, §13,
`documentation/specs/phase-2-5-design-systems.md` (cited as **P25**), and the current code named in each
section. S numbers are local to this phase; P25's S1 to S8 and G1 stand as written unless this spec
records a supersession.

The owner's asks, in his words (paraphrased closely):

1. SpeakAppi and mychamba already have Claude-built design systems served at `<projecturl>/design-system`.
   The current "New design system > Start from > Project code" scan does not recognise them: mychamba
   found only 6 logo files; SpeakAppi found 79 colours, 1 type style, 2 shadows, 64 sizes, 12 logo files
   in 2 files (the sheet's "Files read (2)" disclosure). He wants a way to select an existing design
   location, and/or an "Existing design system" start option where the agent finds and reads the real
   system (page, docs, components), plus better UI guidance about what each start option does and what
   was found vs missed.
2. Adding a design to an existing folder: the flow only lets him type a NEW folder name and create it;
   there is no list of his existing folders/projects to pick from.
3. Better management of projects/folders: rename, delete, move designs between folders, create. Folders
   are tags, never disk moves; deleting a folder must never delete designs.
4. Better filtering, sorting and view: list or tiles, persisted; sensible sort options; filters that
   match how he browses (project/folder, kind, system).
5. Design systems more native to the library: a concrete, bounded set (system chip on design cards,
   filter by system, systems reachable where designs are, the new-design system pick per BRIEF).
6. The Settings button becomes a gear icon so it reads as settings.
7. Refresh the "lines for AGENTS.md" (the root guide, the copyable snippet, the skill text) so agents
   know about systems, folders, the new start options and the library views.

---

## 0. Phase overview

**Overview.** The library becomes a place the owner can actually run his design practice from: he can
start a system from the one his project already has, file designs into folders he picks (including when
he creates them), manage those folders safely, browse the library the way he thinks (tiles or list,
sorted, filtered by project, folder, kind and system), see and reach systems wherever designs are, and
trust that his agent knows all of this. Nothing about the foundations changes: designs stay folders on
disk, folders stay tags, systems stay Draft-then-reviewed, and the service never writes a project repo.

| # | Feature | Effort | Depends on | Section |
|---|---|---|---|---|
| S1 | Start from an existing design system (location pick, candidates, agent reads the real system) | L | P25 S2, S8 | §1 |
| S2 | Start options and scan results that explain themselves (found vs missed) | S | S1 | §2 |
| S3 | File designs into folders, including at creation | M | P25 G1 | §3 |
| S4 | Folder management: create, rename, delete with a safe confirm, move | M | P25 G1, S3 | §4 |
| S5 | Library views, sorting and filters (tiles/list persisted, sort, system filter) | M | S6 for the chip column | §5 |
| S6 | Systems in the library (chip on cards, used-by link, sidebar shortcut) | S | P25 S1, S5 | §6 |
| S7 | Settings reads as settings (gear icon) | S | none | §7 |
| S8 | Agent guidance refresh (guide, snippet, skills, instructions) | M | S1, S3, S4, S5 | §8 |

**Recommended build order.** S7 and S6 are small and independent; S5 and S6 settle together (the list
view draws the chip). S3 and S4 settle together (one folder picker shared by creation, add and move).
S1 is the largest piece and reuses the P25 scan; S2 rides on it. S8 comes last so the guidance describes
what actually shipped. S1's builder-skill lines and `rules/SYSTEM-QUESTIONS.md` are the rules author's
lane; the rest of S8 is the builders'.

### Grounding: what exists today (do not rebuild it)

Verified in the v0.4.0 code:

- **New design system sheet** (`src/ui/systems/new-system-sheet.ts`, `src/ui/model/new-system-model.ts`):
  Name; Start from = Project code / Brand files / A description (mixable checkboxes); Project select of
  OpenChamber's projects plus "Other folder…" (any absolute path); a bounded scan with a found sentence
  ("Found 79 colours, … in 2 files."), a "Files read (N)" disclosure, ticked fonts/logos, partial and
  skipped lines, a forAgent line; Agent works in; Make design system; a result view with Try again /
  Copy request when the agent request did not reach a chat.
- **The scan** (`src/service/systems/extract.ts`, `extract-rules.ts`): reads CSS custom properties and
  token JSON with certainty; Sass/Less, Tailwind config, `theme.(ts|js)` and design docs (DESIGN.md,
  `docs/design*.md`, `design/*.md`, styleguide.md, brand*.md) are listed **for the agent by name**;
  fonts in `fonts/` folders and images named logo/brand/wordmark are offered as assets. It does **not**
  read HTML pages, component files, or CSS-in-JS inside JS/TS files; those are invisible to it (not even
  named). Bounds: depth 8, 20 000 entries, 10 s, 200 candidates, 1 MB per file; skips `node_modules`,
  `.git`, `dist`, `build`, etc., secret files, symlinks out; read-only, realpath-validated, never the
  Designs root (`scan-folder.ts`).
- **New design dialog** (`src/ui/components/new-dialog.ts`, `src/ui/model/new-model.ts`): kind tabs,
  brief, the Design system field (pin → default → ask, "Pinned for shop" / "Your default" hints, preset
  hides with a system, "No design systems yet. Make one"), Agent works in, Start. **No folder field.**
- **Folders** (P25 G1; `src/ui/page/library-sidebar.ts`, `src/ui/components/folder-actions.ts`,
  `src/ui/model/list-model.ts`, `src/service/folders.ts`): page sidebar (All designs, Projects, No
  project, Folders with New folder, inline rename, delete with a 10 s Undo notice, drag a card onto a
  folder); rail Show select with the same groups plus a folder actions menu (Rename, Delete) when a
  folder is selected; the design menu's **Add to folder…** opens a dialog that **already lists every
  existing folder with ticks and counts**, plus "New folder…" inline creation; **Remove from <folder>**
  in a folder view. Registry `<root>/.chamber/folders.json`: ≤ 50 folders, ≤ 2 000 designs each, names
  ≤ 40 chars unique ignoring case, soft delete with Undo for 1 h, membership by slug + created.
- **Library** (`src/ui/page/library-view.ts`, `src/ui/rail/list-view.ts`): page = card grid (tiles only),
  search (title/slug), All/Canvases/Pages tabs with counts, sort Updated/Created/Title; rail = rows,
  search, Show select, tabs, always sorted by Updated. The selected scope persists per surface
  (`host.storage` `list-scope:<surface>`); sort, tab and search do not persist. Cards show the project
  line, kind badge, updated, and flags (System updated, open comments, linked chat). **No system name on
  a card, no system filter, no view toggle.**
- **Systems list** (`src/ui/systems/systems-list.ts`): Draft/Ready, home line, badges, used-by count,
  default/pinned marks; New design system + Build with the agent…; empty state with From code… / From
  brand files… / Describe…. The used-by count is text, not a link. The page toolbar has a "Design
  systems" button; the rail header an icon button; the page sidebar has no systems entry.
- **Settings** (`src/ui/components/settings-view.ts`): page toolbar button is the word "Settings" with a
  **sliders** glyph (`icons.ts` `settings`); the rail already uses an icon-only button with the same
  sliders glyph. There is no gear glyph today.
- **Agent guidance** (`src/shared/agent/guide.ts`, `skill-doc.ts`, `system-skill-doc.ts`,
  `instructions.ts`, `ownership.ts`): the root guide has a Design systems section (P25) but **no folders
  section and no library-views line**; the snippet and the design-chamber skill name systems briefly;
  the builder skill carries the interview and diff gate. The guide is refreshed only while its ownership
  marker says it is ours and unedited; a user-edited guide is never overwritten (BRIEF 2026-11-01).

### Conflicts surfaced (not silently resolved)

1. **Ask 2 vs the shipped code.** The Add to folder dialog already lists existing folders with ticks
   (v0.4.0). The owner reports a create-only flow. Either he used the sidebar's New folder row, a build
   without the list, or the folder list failed to load (the dialog then shows an error and hides
   creation). O1 asks which; the recommended default covers every reading by making the existing-folder
   pick first-class everywhere a design is filed, including at creation.
2. **G1's no-confirm delete.** P25 G1 chose "Delete folder has no confirm; the designs stay; Undo".
   The owner now asks for safer management; D1 proposes a confirm that names how many designs lose their
   last folder, keeping Undo. This supersedes G1's choice if the owner accepts D1.
3. **G1's agent role.** P25 G1: "Chat agent does not set folders in this phase." D11/O2 propose a bounded
   extension (tag existing folders on explicit request only).
4. **P25 S2 out of scope:** "Making a system from an existing design's DESIGN.md and tokens.css." The
   owner's ask is about a **project's** system, not a design's; that line stays out of scope. S1 is a new
   source (an existing system location in a project), not a reversal of it.
5. **The current Project code hint overpromises.** It says "Read a project's colours, type and
   components", but the scan reads no components; the agent writes them. S2 corrects the wording; this is
   part of why the owner could not tell what was found vs missed.

### Cross-cutting rules (unchanged foundations)

- **Folders are tags.** Grouping never moves a design's folder on disk; slugs, paths, linked chats and
  versions stay valid. Deleting a folder never deletes, trashes or moves a design.
- **The service never writes a project repo.** Discovery and reads are bounded and read-only; every
  service write resolves under the designs root. Repo writes happen only through the P25 S8 building
  flow, by the agent, after a reviewed diff the user approves (proposal-bound).
- **The extraction split stands (BRIEF).** Design Chamber parses CSS variables and token JSON it can read
  with certainty; the agent writes the overview, usage notes, components and anything unparseable.
- **Every new system starts as a Draft** and enters the same review, selection, copy-on-link and checks
  as any other system (P25 S1, S5, S7).
- **A new design's system pick stays per BRIEF:** the project's pinned system, else the global default,
  else the agent asks; an explicit choice always wins; one system per design; the preset picker hides
  when a system is chosen.
- **The root guide is never overwritten once user-edited** (ownership marker + hash). Refresh applies to
  unedited guides only; the copyable snippet is always available.
- **Chrome:** kit components and `--oc-*` host tokens only, one filled primary per view, every async
  action has a loading state and a user-facing sentence on failure, light and dark verified, rail usable
  at 320 to 480 px. Copy per §9.4: natural, human, no em dashes, glossary terms.

---

## 1. S1 · Start from an existing design system

### Overview
The owner's projects already have systems: a living page served at `<projecturl>/design-system`, docs,
components. Today's Project code scan reads CSS and token JSON only, so it returns raw values (SpeakAppi:
79 colours in 2 files) or almost nothing (mychamba: 6 logos) and never recognises the system itself. S1
adds a fourth start option, **Existing design system**: Design Chamber finds candidate system locations
in the project (read-only), the user picks one or types its folder, Design Chamber parses what it can
from that location, and the agent reads the real system (its page, docs and components) and writes the
rest. The result is a Draft like any other; the repo is never written by the service.

### User Stories
- As the user with a Claude-built system in my repo, I want Design Chamber to find it and read it, so
  that the system here matches what my team already ships.
- As the user, I want to point at the exact folder where the system lives, so that the read covers the
  right place instead of guessing across the whole repo.
- As the user, I want to see what was found in that location before anything is made, so that I can
  trust the result or point somewhere else.
- As the user, I want my repository left exactly as it was.
- As the chat agent, I want the request to name the system's page, docs and components, so that I build
  from what exists instead of inventing a parallel system.

### Decisions Made (proposed; see §9.1 for status)
| # | Decision | Rationale | Date |
|---|---|---|---|
| S1-1 | A fourth start option, "Existing design system", beside Project code / Brand files / A description; mixable like the others | Owner ask 1 ("and/or": both the location pick and the start option are in scope) | 2026-11-22 |
| S1-2 | Discovery lists candidate locations read-only: path + what marks it as a system + what was found there. Never file contents, never a write | BRIEF extraction split; the service stays read-only on repos | 2026-11-22 |
| S1-3 | The user picks a candidate or types a folder path inside the chosen project; the read narrows to that folder | Owner: "select an existing design location" | 2026-11-22 |
| S1-4 | The agent request names the found page, docs and component files as required reading, with the injection sentence and "write only in the system folder" | The agent authors from the real system; P25 S2's request shape, extended | 2026-11-22 |
| S1-5 | From the sheet, the result is an internal-home Draft (as From code today). A repo-backed home stays with /design-system, whose interview gains the existing-location start | Keeps the sheet flow simple; the diff gate stays the only repo-write path | 2026-11-22 |
| S1-6 | No network: the served URL is evidence the system exists, not a source. Design Chamber reads the local files behind it | Offline rule; P25 out of scope (remote sync) stands | 2026-11-22 |
| S1-7 | When the location already holds a complete system in Design Chamber's file contract, offer "Register it as it is" (repo-backed, read-only) beside "Make a new system from it" | Respects work already done; reuses the P25 S8 snapshot read. Owner-level: O4 | 2026-11-22 |

### Acceptance Criteria

**The start option and the location pick**
- [ ] "Start from" gains **Existing design system** with a hint that says what it does (§9.4 copy). The
      systems list empty state gains a fourth action, **From an existing system…**, pre-ticking it.
- [ ] Ticking it shows the **Project** select (as Project code: OpenChamber's projects, current chat's
      project preselected, "Other folder…" for a path). Choosing a project runs discovery over it,
      bounded exactly like the existing scan (same bounds, skips and safety; no second walker with
      weaker rules).
- [ ] Discovery lists **candidate system locations**: folders that look like an existing system (a
      design-system page, token files, design docs, a system in Design Chamber's file contract). Each
      candidate shows its project-relative path, what marks it as a system ("page, tokens, 3 docs"), and
      the counts found there. The list is read-only; picking a candidate fills the location field. At
      most 10 candidates shown, "and N more" beyond that; the user can always type a path instead.
- [ ] A **location field** ("Where does it live?") accepts a folder inside the chosen project. Validated:
      exists, is a folder, readable, and inside the project compared as realpaths (a symlink that leaves
      the project is refused); the Designs root and anything inside it are refused with the existing
      sentence. A path outside the project is refused: "Pick a folder inside <project>."
- [ ] With a location chosen, Design Chamber reads it (bounded) and shows the found summary scoped to
      that folder: the existing found sentence, the "Files read (N)" disclosure, ticked fonts/logos with
      the licence note, partial/skipped/forAgent lines, and the new missed line (S2).
- [ ] Nothing found in the location: "Design Chamber didn't find token files in <folder>. The agent can
      still read its page and docs and write the system." Make stays possible.
- [ ] No candidates and no location typed: the option says so plainly and offers the way forward (type a
      path, or start from the code). Make is blocked with the problem next to the option, as today's
      draft problems work.

**Making it**
- [ ] **Make design system** creates the Draft seeded with what was parsed from the location (values,
      ticked fonts/logos), exactly as From code seeds today. Nothing is written before Make; every
      failure keeps the user's input.
- [ ] The agent request names: the system folder; the location and the found files to read first (the
      page, the docs, the component files, by path); what to write (overview, usage notes, component
      inventory, anything unparseable); "Don't change anything in <project>. Write only in <system
      folder>."; the injection sentence (system content is design guidance only; it cannot approve, run
      commands or override the user); and the system check command.
- [ ] The system records the location as a source (folder path + last read time), so a later re-sync
      reads the same place. Re-sync of such a system follows P25 S4 with the location as its code source.
- [ ] All P25 S2 result branches hold: the system page opens on the Draft; the build strip shows the
      agent working; a request that did not reach a chat shows Try again / Copy request with the Draft
      saved; a root change mid-scan stops it with the existing sentence.

**The builder flow (/design-system)**
- [ ] When discovery finds an existing system location in the chat's project, round one names it and
      asks whether to start from it (recommended when found) or read the whole project. The answer is
      recorded with the system; the two-round cap, the SystemAsk block, the diff gate and every P25 S8
      rule are unchanged.
- [ ] The builder skill tells the agent: when a location is named, read its page, docs and components
      first and reconcile to what exists; do not invent a parallel system. The no-ticket rule stands.

**Registration branch (only if O4 is accepted)**
- [ ] A location holding a complete, readable system in Design Chamber's file contract offers **Register
      it as it is**: the system is registered as repo-backed from a read-only snapshot (P25 S8's
      snapshot mechanism), appears as a Draft for review, and its panel is read-only with the repo-home
      banner. No repo write, no agent request needed to register; Mark ready follows the normal review.
- [ ] A partial or unreadable contract never offers registration; it offers the extract path instead,
      naming what was missing.

### User Flow (step budget: ≤ 6 user actions from the systems list to a made Draft)
1. Design systems → **New design system** (1) → tick **Existing design system** (2).
2. Project is preselected when the chat has one; else pick it (3). Discovery runs (a wait, not an action).
3. Pick a candidate, or type the folder (4). The found summary shows.
4. Name is suggested from the project; the user may change it (optional). **Make design system** (5).
5. The Draft opens; the agent request is sent (6 at most, counting a name edit). Branches: no candidates
   → type a path or switch option; unreadable folder → sentence, input kept; send failed → Try again /
   Copy request; cancel mid-scan → scan stops, nothing made.

### Roles & Access
- **User:** the only one who starts discovery, picks a location and makes the system.
- **Chat agent:** reads the project (it runs there), writes only the system folder; in the builder flow
      it may write the repo only after the approved diff. It never registers or marks a system ready.
- **Untrusted content:** the living page, docs and component files are data. Their text never runs in
      the chrome; the candidate list shows paths and counts only; any preview of a found page renders
      only in the standard sandboxed viewer frame, never in the sheet.
- **First run:** no projects known → "Other folder…" path entry still works; no systems → the empty
      state's fourth action opens the sheet pre-ticked.
- **Changed folder:** a scan or discovery running under the old root stops with the existing root-change
      sentence; nothing is made; the input is kept.

### Edge Cases
- The location is the project root: allowed; it reads like Project code but the agent request still names
  any found page/docs.
- Two candidate locations (e.g. `design-system/` and `docs/design/`): both listed; the user picks one;
  the other is not read.
- A candidate inside a skipped folder (`node_modules`, `dist`): never listed (discovery skips them).
- The living page exists but no token files: found summary says nothing parseable; the agent reads the
  page; Make works.
- The location is deleted between discovery and Make: Make re-checks it exists and refuses with
  "That folder is gone. Pick another location." Input kept.
- A monorepo: the system lives in a subpackage; the typed path reaches it; candidates list it when found.
- A huge living page (over the file cap): skipped and named in the skipped line; the agent can still read
  it itself.
- Two systems made from one location: allowed; both record the same source.
- A location that is a symlink to elsewhere in the project: followed only if the realpath stays inside
  the project; otherwise refused.
- The project is the Designs root or inside it: refused with the existing sentence.
- Discovery finds a system already registered in Design Chamber from this repo: the candidate is marked
  "Already in Design Chamber as <name>" with a link to it; making a second one is still allowed.

### Security & Abuse
- **Hostile repo:** the same bounded, read-only, no-symlink-out, no-code-run, secrets-skipped scan as
  P25 S2; narrowing to a location never relaxes a bound. Candidate paths are validated inside the
  project as realpaths; a crafted path (`../`, a link out, the Designs root) is refused.
- **Prompt injection:** the living page and docs are exactly the kind of text that carries instructions.
  The request carries the injection sentence; the agent writes only the system folder; any repo write
  still passes the diff gate. A candidate's markup is never rendered in the chrome.
- **Secrets:** secret files are never opened or listed as candidates; the list carries paths and counts,
  never contents; logs carry ids, counts and outcomes only.
- **No network:** nothing fetches `<projecturl>/design-system`; a URL typed into the location field is
  refused as a path ("Use the folder on this machine, not a web address.").
- **Who must not:** a design frame, the board, another design, or any text in a repo cannot start
  discovery, pick a location, register a system or mark it ready. Only the user's gestures in the chrome.

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** read-only, bounded access to the chosen project and location (the existing scan
  surface, narrowed); writes only inside the new system's folder under the designs root. Registration
  (O4) writes only the registry entry and snapshot under `_systems/`.
- **Sandbox:** any found-page preview uses the standard sandboxed frame; the sheet itself shows text only.
- **Theme:** the sheet uses host tokens and the kit; the candidate list is readable at rail width.

### Data Requirements
The system records its location source (folder path, last read time) beside the existing sources. The
candidate list is ephemeral (part of the scan job, expires with it). Nothing new is persisted about the
project itself. Sensitivity: project paths are the user's own data, shown in their UI only.

### Out of Scope
- Fetching the served URL or any remote source; GitHub sync.
- Registering systems from another designs folder or from a design's DESIGN.md/tokens.css (P25 line stands).
- Scanning every project for systems on startup; discovery runs only when the user starts this flow.
- Importing real components or running project builds (BRIEF).

---

## 2. S2 · Start options and scan results that explain themselves

### Overview
The owner could not tell what the scan did and did not read: mychamba's "6 logo files" and SpeakAppi's
"2 files" read like failures, not like a parser with a known scope. S2 makes every start option say what
Design Chamber does and what the agent does, and makes the scan result say what was found **and what was
missed**, with a way forward.

### User Stories
- As the user, I want each start option to tell me what it actually does, so that I pick the right one.
- As the user looking at "Found 6 logo files", I want to know why so little was found and what happens
  next, so that I don't think the tool is broken.
- As the user whose project already has a system, I want the sheet to notice and offer the better path.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| S2-1 | Option hints state the split: Design Chamber reads CSS and token files it can parse; the agent reads the rest and writes the overview, notes and components | BRIEF extraction split; fixes the overpromising "components" hint | 2026-11-22 |
| S2-2 | The scan result adds a missed line naming the categories Design Chamber does not read (pages, components, themes written in code), beside the existing forAgent and skipped lines | Found vs missed, in the owner's words | 2026-11-22 |
| S2-3 | When discovery finds an existing system location while Project code is ticked, a dismissible nudge offers to switch to Existing design system with the location filled | The owner's exact situation; one click to the better path | 2026-11-22 |

### Acceptance Criteria
- [ ] Every start option's hint says what Design Chamber does and what the agent does (§9.4 copy). The
      Project code hint no longer claims to read components.
- [ ] A settled scan shows, in order: the found sentence (existing shape, zero counts omitted); the
      partial line when a bound was hit; the **missed line** ("Design Chamber reads CSS and token JSON.
      Pages, components and themes written in code are left for the agent."); the forAgent line when
      there are files listed for the agent (existing); the skipped line when files were skipped
      (existing); the "Files read (N)" disclosure (existing, per-file counts kept).
- [ ] When nothing was found, the existing nothing-found sentence stays and the missed line explains the
      likely reason; the way forward (the agent can still read it; or start from an existing system) is
      one click away when a candidate exists.
- [ ] The nudge (S2-3) appears once per sheet session, names the found folder, and offers **Start from
      it** (switches the tick to Existing design system, fills the location, keeps the name and other
      inputs) and a dismiss. Dismissing hides it for this sheet session; it never blocks Make.
- [ ] All guidance text is static copy plus counts and paths; no file contents appear in the sheet.
- [ ] The sheet stays usable at rail width; the added lines do not push Make off screen (the sheet
      scrolls as today).

### User Flow
1. Tick Project code → pick project → scan settles → found + missed + forAgent lines read together.
2. Branch: a candidate exists → nudge → Start from it → S1's flow with the location filled.
3. Branch: nothing found → missed line + agent way forward → Make still works.

### Roles & Access
- **User:** reads the guidance; the only one who switches options or makes the system.
- **Chat agent:** the forAgent list and the request tell it what to read; unchanged otherwise.
- **Untrusted content:** none rendered; counts and paths only.
- **First run / changed folder:** as P25 S2 (no projects → path entry; root change stops the scan).

### Edge Cases
- forAgent list empty: no forAgent line (existing rule).
- Everything skipped (a repo of huge bundles): found sentence absent, skipped line names the count,
  missed line still explains the scope; Make works.
- The nudge's candidate is deleted before the switch: the switch fills the location and S1's validation
  refuses it with the sentence; the user's inputs are kept.
- A scan that found only assets (mychamba's case): the found sentence names the logos; the missed line
  says why nothing else was read; the nudge appears when a system location exists.

### Security & Abuse
Guidance is static copy; the dynamic parts are counts and project-relative paths, shown as text. A
hostile repo cannot inject wording into the sheet through file names (names are truncated and shown as
text, never markup). No new read surface beyond S1's.

### Sandbox, Filesystem & Theme Impact
None beyond S1's; the sheet uses host tokens and the kit.

### Data Requirements
Nothing new persisted; the nudge's dismissed state lives for the sheet session only.

### Out of Scope
- A per-file explanation panel; teaching the parser new formats (the agent covers them).
- Explaining the scan's internals (bounds, walker) in the UI beyond the existing partial line.

---

## 3. S3 · File designs into folders, including at creation

### Overview
Today a design can only be filed after it exists, through the ⋯ menu's Add to folder… or a drag on the
page; the New dialog has no folder field at all. The owner reports a create-only flow (see §0 conflict 1
and O1). S3 makes picking an **existing** folder a first-class step: in the New dialog (both surfaces),
in a clearer Add to folder picker, and from an open design's viewer menu. Projects stay automatic (BRIEF,
G1); the picker says so instead of leaving the owner to wonder where they are.

### User Stories
- As the user starting a design for a project, I want to put it in the right folder as I create it, so
  that I don't have to file it afterwards.
- As the user with 20 folders, I want to pick from the ones I have (with a search), not type a new name.
- As the user, I want to understand why projects are not in the pick list, so that I know they group
  themselves.
- As the user looking at an open design, I want to file it without going back to the list.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| S3-1 | The New dialog gains an optional Folder field: pick any existing folders (several allowed), create one inline, or none | Owner ask 2; folders are tags, several per design (BRIEF) | 2026-11-22 |
| S3-2 | A filing failure never blocks the design's creation: the design is made; a notice names the folder that failed and offers Try again | The design is the primary outcome; tags are secondary | 2026-11-22 |
| S3-3 | Projects are shown as context in the picker, not pick targets: they group automatically by the chat the design was made in | BRIEF/G1: project grouping is automatic and never a disk move; changing a design's project stays out of scope | 2026-11-22 |
| S3-4 | Add to folder… also appears in the viewer's ⋯ menu (rail and page), using the same picker | File it where you are looking at it | 2026-11-22 |

### Acceptance Criteria

**The New dialog (rail and page)**
- [ ] An optional **Folder** field below the Design system field: a pick list of existing folders (name +
      design count), multi-select, with the design's future memberships stated ("Goes into Q4 launch and
      Explorations"); a **New folder…** inline creation with the existing name rules; and a default of
      no folder. At 320 px the field stays usable (the list may open as a sheet).
- [ ] The folder choice travels with the start request; the design appears in the chosen folders the
      moment it is created, on both surfaces and in the sidebar counts.
- [ ] If filing fails (a folder was deleted, the registry refused), the design is still created and the
      success toast is followed by a notice: "Couldn't add it to <folder>. <reason>" with **Try again**.
- [ ] The field is hidden only while the folder list is loading with nothing cached; a load failure shows
      the existing error sentence with Try again and never blocks Start (the design is made unfiled).
- [ ] /design and /page from chat are unchanged (no folder UI in chat); the agent's tagging rules are
      S8's.

**The Add to folder picker (existing dialog, improved)**
- [ ] The existing-folder list with ticks and counts stays the primary content (it already exists; this
      is a discoverability and polish requirement, not a rebuild). A search field appears when there are
      more than 8 folders; ticking applies at once as today; Done closes.
- [ ] A context line says what projects do (§9.4 copy): they group automatically and are not folders to
      pick.
- [ ] The picker is reachable from: the list row/card ⋯ menu (existing), the viewer ⋯ menu (new, S3-4),
      and a drag onto a sidebar folder (existing). The empty-folder state keeps its pointer to the menu.
- [ ] Inline creation keeps the existing rules (1 to 40 chars, unique ignoring case, 50-folder cap) and
      the "Create and add" behaviour.

### User Flow (step budgets)
- **New design into an existing folder: ≤ 4 actions.** New ▾ (1) → Canvas/Page (2) → tick folder(s) in
  the Folder field (3) → Start (4). With no folder pick: 3 actions, as today.
- **Add an existing design: ≤ 4 actions.** ⋯ (1) → Add to folder… (2) → tick (3) → Done (4); or one drag
  gesture on the page.
- Branches: no folders yet → the create field is first (existing copy); load failure → error + Try
  again; duplicate name → the existing sentence; folder deleted mid-dialog → the list refreshes.

### Roles & Access
- **User:** the only one who picks folders at creation and files designs through the chrome.
- **Chat agent:** does not file designs on its own; may tag on explicit request per S8/D11. Its designs
  still land in their project group automatically.
- **Untrusted content:** none; folder names and design titles are shown as text.
- **First run:** no folders → the New dialog's field offers creation; the picker shows the existing
  "No folders yet" state.
- **Changed folder:** the new root's folders show; the old root's stay with it (G1-4). A creation request
  naming folders from the old root files nothing and says so (S3-2's notice).

### Edge Cases
- A folder deleted while the New dialog is open: the list refreshes; the gone folder's tick disappears;
  Start files what still exists and reports the rest.
- Two windows start designs into the same folder at once: both land, membership once each (the write
  queue exists).
- The 50-folder cap reached: inline creation refuses with the existing sentence; picking existing
  folders still works.
- A design created with no folder and no project: it is in All designs and No project; nothing else.
- The registry is damaged: the existing recovery behaviour holds (reads empty with the damaged notice,
  renamed aside on the next user action); creation is never blocked by it.
- 2 000 designs in a folder: adding refuses with the service's sentence; the design is still created.

### Security & Abuse
Membership names designs that exist in this designs folder only (slug + created, as today); no path is
built from a folder name; names are capped and validated. A creation request carrying folder ids is
validated server-side against the current registry; unknown or deleted ids are skipped and reported,
never created. A hostile design title in a toast is text.

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** writes only to the existing folder registry under `<root>/.chamber/`, from user
  gestures; atomic, queued, as today. No design folder is touched by filing.
- **Sandbox:** none; the picker is chrome.
- **Theme:** kit components, host tokens, one filled primary per view (Start stays the primary; the
  picker's Done is the primary of its own sheet).

### Data Requirements
Folder membership (exists). The creation request carries the chosen folder ids (a contract change
through the main agent). Nothing else persisted.

### Out of Scope
- Picking a project for a design (changing `projectDirectory`); projects stay automatic.
- Bulk filing many designs at once (one line in §9.6).
- Folders for systems.

---

## 4. S4 · Folder management: create, rename, delete, move

### Overview
The owner asks for real management: rename, delete, move designs between folders, create. The pieces
exist scattered (sidebar inline rename, rail dialog rename, delete with Undo, add/remove); S4 makes them
a complete, consistent set on both surfaces, adds a one-action **Move**, and replaces the no-confirm
delete with a confirm that tells the truth about what deletion does: it untags, it never deletes designs.

### User Stories
- As the user, I want to rename, delete and create folders wherever I am (rail or page), with the same
  words and the same safety.
- As the user deleting a folder, I want to know how many designs lose their last folder before I commit,
  so that I can decide with the facts.
- As the user reorganising, I want to move a design from one folder to another in one action, with an
  Undo, so that I don't do remove-then-add by hand.
- As the user, I want to be certain that deleting a folder never deletes my designs.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| S4-1 | Delete is always untag-only, behind a confirm naming the folder's design count and how many of those are in no other folder; the 10 s Undo notice stays | Owner ask 3 + the main agent's safe default; supersedes G1's no-confirm choice (D1) | 2026-11-22 |
| S4-2 | Move = untag from the folder being viewed + tag the target, one user action, one Undo that restores both memberships; the design's other folders are untouched | Tag semantics; "move between folders" without disk moves | 2026-11-22 |
| S4-3 | The rail gains New folder… (the Show select's last entry opens the same name dialog); rename and delete already reach the rail | Parity without a sidebar at 320 px | 2026-11-22 |

### Acceptance Criteria

**Create**
- [ ] Page sidebar New folder (existing) and the picker's inline creation (existing) keep their rules.
      The rail's Show select gains a **New folder…** entry at the end; choosing it opens the name dialog
      (1 to 40 chars, unique ignoring case, cap 50) and never changes the selected scope. On success the
      folder appears in the select and the sidebar, with the existing toast.

**Rename**
- [ ] Inline rename in the page sidebar and the dialog from the rail keep working; membership, counts and
      the selected scope follow the folder's id, not its name. A renamed folder keeps its designs.

**Delete**
- [ ] **Delete folder** opens a confirm dialog: title "Delete <name>?"; body names the facts, computed
      from the live registry at confirm time: how many designs are in it, and how many of those are in
      no other folder ("6 designs are in Launch. 2 of them are in no other folder; they stay in All
      designs."). An empty folder: "Launch is empty. Deleting it changes nothing." A folder whose designs
      all keep other folders: "Its 6 designs all keep their other folders." The last line is always the
      promise: "Deleting a folder never deletes designs."
- [ ] Confirm label **Delete folder**, destructive. Cancel keeps everything. On confirm the folder is
      soft-deleted (existing registry behaviour) and the existing Undo notice offers **Undo** for 10 s
      (hover/focus pauses the clock); Undo restores the folder and its memberships.
- [ ] No design is deleted, trashed, moved or changed by a folder delete; counts and the list update at
      once; the view falls back to All designs while the folder is gone and returns with Undo (existing).
- [ ] The confirm's counts are re-checked on apply: if membership changed since the dialog opened, the
      notice reports what actually happened ("Deleted Launch. Its 7 designs are still in All designs.").

**Move**
- [ ] In a folder view, the design menu gains **Move to folder…** beside Add to folder… and Remove from
      <folder>. It opens a pick of the other folders (single target, name + count, search past 8) plus
      New folder…; picking a target applies the move at once.
- [ ] The move removes the design from the folder being viewed and adds it to the target as one action;
      the design's other folder memberships are untouched. A notice offers **Undo** (10 s, same pattern):
      "Moved Pricing to Q4 launch." Undo restores both memberships.
- [ ] Moving to the folder it is already in is refused quietly ("Pricing is already in Q4 launch.");
      a target deleted mid-dialog refreshes the list; a failed move changes nothing and says so.
- [ ] Remove from <folder> stays as today (with its existing toast).

**Parity**
- [ ] Every action exists on both surfaces with the same words; the rail uses dialogs where the page
      uses inline rows. The folder actions menu (rail) and the sidebar row menu (page) offer the same
      set: Rename, Delete folder, and New folder… reachable per S4-3.

### User Flow (step budgets)
- **Rename: ≤ 3 actions.** Menu (1) → Rename (2) → type + Enter (3).
- **Delete: ≤ 3 actions + Undo.** Menu (1) → Delete folder (2) → confirm (3); Undo is one more, optional.
- **Move: ≤ 3 actions + Undo.** Menu (1) → Move to folder… (2) → pick target (3).
- **Create: ≤ 3 actions.** New folder (1) → type (2) → Enter (3).
- Branches: duplicate name → sentence beside the field; cap reached → sentence; registry damaged →
  existing recovery notice, writes refused until it is resolved; concurrent edit → the write queue
  serialises, the notice reports the truth.

### Roles & Access
- **User:** the only one who creates, renames, deletes or moves through the chrome.
- **Chat agent:** never creates, renames or deletes folders; may tag/untag existing folders on explicit
      request only (S8/D11). A move asked of the agent is the same two tags, never a disk move.
- **Untrusted content:** folder names and design titles in confirms and toasts are text.
- **First run:** the Folders heading shows its empty hint (existing); New folder works with zero designs.
- **Changed folder:** the new root's folders show; the old root's registry stays with it; a delete in the
      new root never touches the old.

### Edge Cases
- Deleting the folder being viewed: scope falls back to All designs; Undo returns to it (existing).
- A design in the folder is deleted (to .trash) by the agent mid-confirm: the apply re-counts; the notice
  reports the actual number.
- Moving the last design out of a folder: the folder stays, now empty, with its empty state.
- A folder at the 2 000-design cap as a move target: refused with the service's sentence; the design
  stays where it was (the move changes nothing on refusal).
- Two windows delete and rename the same folder at once: the queue serialises; the second action reports
  the folder is gone or already renamed, never a silent overwrite.
- Undo after the 1 h soft-delete window: the existing expiry behaviour holds (the notice is long gone;
  the registry's restore window is the service's).
- A name that differs only by case from another folder: refused (existing rule, Windows-safe).

### Security & Abuse
- **The confirm must tell the truth:** counts come from the live registry, are re-checked on apply, and
  the notice reports what happened. A confirm that names designs must not be spoofable by a design title
  (titles are text, truncated).
- **Delete never builds a path from a folder name** and never touches a design folder, `.trash` or
  versions; it is a registry write only. This is a tested property, like the service's repo read-only rule.
- **Abuse:** a careless user deleting folders in bulk is bounded by the confirm + Undo per folder; a
  malicious design cannot trigger folder writes (chrome-only gestures); membership stays capped and
  validated server-side.
- **Sensitive data:** folder names are the user's own labels; nothing leaves the machine.

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** registry writes only (`<root>/.chamber/folders.json`), atomic and queued, from user
  gestures; no design folder is ever moved, renamed or deleted by these actions.
- **Sandbox:** none; all chrome.
- **Theme:** kit dialogs and notices, host tokens, one filled primary per view (the confirm's Delete is
  destructive, not the view's primary).

### Data Requirements
The existing registry (names, memberships, soft delete). No new persisted facts; the confirm's counts are
computed, never stored.

### Out of Scope
- Nested folders; folder colours or icons; bulk multi-select operations.
- Changing a design's project; moving folders between designs roots.
- Restoring folder membership for a design brought back from the trash by hand (P25 G1 line stands).

---

## 5. S5 · Library views, sorting and filters

### Overview
The owner browses by project, kind and system, and wants the library to look the way he thinks: tiles or
a list, his choice, remembered; sensible sorts; filters that compose. Today the page is tiles-only with
three sorts, the rail is rows-only always sorted by Updated, and there is no system filter. S5 adds the
view toggle (persisted), sort on both surfaces (persisted), and a System filter, composing with the
existing scope (project/folder), kind tabs and search.

### User Stories
- As the user with 80 designs, I want a compact list when I'm scanning and tiles when I'm judging looks,
  and I want my choice remembered.
- As the user, I want to sort by Updated, Created or Title on both surfaces, and have it stick.
- As the user working across three systems, I want to see only the designs using one system.
- As the user combining filters, I want the empty state to tell me which filters hid everything, and a
  way to clear them.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| S5-1 | View toggle Tiles / List on the page library; the choice persists per user across reloads and restarts; default Tiles (today's look) | Owner ask 4; a malformed stored value falls back to Tiles | 2026-11-22 |
| S5-2 | The rail keeps rows; no toggle (320 to 480 px is a list by nature) | Bounded; the owner's view ask is about the library he browses | 2026-11-22 |
| S5-3 | Sorts: Updated (newest first, default), Created (newest first), Title (A to Z); the rail gains the same control; sort persists per surface | "Sensible sort options"; today's three are sensible, the gap is the rail and persistence | 2026-11-22 |
| S5-4 | System filter: All systems (default) · each system by name · No system; designs whose copied system is gone count as No system; available on both surfaces | Owner ask 4/5; the data already exists on every design summary | 2026-11-22 |
| S5-5 | View and sort persist; search, kind tab and system filter are session-only (reset on reload); scope keeps its existing per-surface persistence | A remembered filter that hides designs reads as lost designs; view and sort are safe to remember | 2026-11-22 |

### Acceptance Criteria

**View**
- [ ] The page toolbar gains a **Tiles / List** toggle (segmented, kit). Tiles = today's card grid,
      unchanged. List = compact rows: small thumbnail (same fallbacks: pending kind icon, live mini-frame
      when Chrome is missing), title, kind, project line, system chip (S6), updated, the existing
      indicators (System updated, open comments, linked chat, Waiting for agent), and the same ⋯ menu
      and drag behaviour as cards.
- [ ] The choice persists per user (page surface) across reloads and restarts; a malformed or unknown
      stored value reads as Tiles. Switching views keeps the scope, filters, sort and the designs shown;
      live updates keep working in both views without losing scroll.
- [ ] The rail is unchanged in shape (rows); it gains sort and the system filter below.

**Sort**
- [ ] Both surfaces offer Updated / Created / Title with the same meanings and directions as today's
      page sort. The rail's list stops being hard-wired to Updated.
- [ ] Sort persists per surface; default Updated; a malformed stored value reads as Updated. Sort applies
      inside the current scope and filters; tab counts are unaffected by sort.

**Filters**
- [ ] A **System** filter on both surfaces: All systems · each system in the folder by name (a Draft
      system is marked Draft) · No system. It composes with the scope (sidebar / Show select), the kind
      tabs and search; the visible count and the tab counts follow the composition.
- [ ] Project/folder filtering stays the existing scope control (the owner's "project/folder" filter);
      no second control is added for it.
- [ ] The rail's filters area stays usable at 320 px: the System filter is a compact select beside or
      under Show; nothing overflows or truncates without a tooltip.
- [ ] The no-matches empty state names every active filter (scope, search word, kind tab, system) and
      offers **Clear filters**, which clears search, tab and system filter and keeps the scope. The
      existing no-designs and empty-folder states are unchanged.
- [ ] A system deleted while it is the active filter: the filter falls back to All systems and the select
      shows it; the list refreshes; no error.

### User Flow (step budgets)
- **Switch view: 1 action**, remembered. **Sort: 1 action**, remembered. **Filter by system: 1 action**.
- Browse: sidebar/Show picks the project or folder (existing) → kind tab → system filter → search; every
  step narrows the same list and the counts stay truthful.
- Branches: nothing matches → the named empty state + Clear filters; stored preference garbage →
  defaults; a filtered system goes away → silent fallback to All systems.

### Roles & Access
- **User:** the only one who sets views, sorts and filters; they are per-user chrome state.
- **Chat agent:** unaffected; its designs appear under whatever filters are active (live refresh keeps
  the filters). S8 tells it the library's views exist so it can point the user at them.
- **Untrusted content:** none; design titles and system names in rows are text.
- **First run:** no designs → the existing empty state; the toggle and sorts still work and persist;
  the System filter shows All systems and No system only.
- **Changed folder:** view and sort preferences stay (they are harmless across roots); the scope falls
  back per the existing rule; the System filter lists the new root's systems.

### Edge Cases
- 50 systems: the filter select scrolls; long names truncate with the full name in the tooltip.
- 500 designs in list view: rows stay responsive and counts correct; thumbnails lazy-load as today.
- A design whose system is a Draft (linked by the agent): it appears under that system's filter option
  (marked Draft) and its chip shows the Draft mark (S6).
- A design whose copied system was deleted: it counts as No system in the filter; its chip still names
  the gone system (S6), so the owner can tell it apart from a design that never had one.
- Switching view mid-drag: the drag ends cleanly (the card/row is replaced); no membership change happens
  from an interrupted drag.
- Two surfaces open at once: each keeps its own sort and scope; the page's view toggle does not affect
  the rail.
- Search + tab + system + scope all active and nothing matches: the empty state names all four.

### Security & Abuse
Stored preferences are small validated values (an enum for view, an enum for sort); anything else reads
as the default. Filters never reveal designs outside the selected scope; counts are computed from the
same list the user sees. No design data is stored in preferences. A hostile system name is text in the
select and the rows.

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** none; preferences live in the guest's host storage, as the scope already does.
- **Sandbox:** none; all chrome.
- **Theme:** kit components and host tokens; both views verified light and dark, page widths from narrow
  to wide, rail 320 to 480 px.

### Data Requirements
Two small persisted preferences (page view; sort per surface). Session-only filter state (tab, system).
Nothing else stored. Sensitivity: none (no design content in preferences).

### Out of Scope
- Sort direction toggles (Z to A, oldest first); grouping by system or project inside the list.
- Persisting search, tab or system filter across reloads (S5-5 explains why).
- Saved filter presets; a tiles view on the rail.

---

## 6. S6 · Systems in the library

### Overview
Systems live in their own list today; a design's card never says which system it uses, and the systems
list's used-by count is dead text. S6 weaves systems into the library with a bounded set: a system chip on
every design card and row, a used-by link that opens the library filtered by that system, a Design systems
entry in the page sidebar, and the New dialog's system pick exactly per BRIEF (already shipped; it stays).

### User Stories
- As the user scanning the library, I want to see which system each design uses, so that I can spot the
  odd one out.
- As the user looking at a system, I want to see the designs using it in one click, so that I can review
  them together.
- As the user in the library, I want systems reachable without hunting the toolbar, so that making and
  reviewing one is part of the same place.
- As the user starting a design, I want the system picked the way BRIEF says (pin, default, ask), so that
  I don't have to think about it unless I want to.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| S6-1 | Every card (tiles) and row (rail, page list) shows its linked system's name as a quiet chip; no system shows nothing; a gone system shows "<name> (deleted)" muted; a Draft system shows a Draft mark | The data exists (`DesignSummary.system`); identity beside the existing "System updated" flag | 2026-11-22 |
| S6-2 | The chip opens the system (page: system page; rail: compact system view); the click never opens the design | Systems reachable where designs are | 2026-11-22 |
| S6-3 | The systems list's used-by count becomes a link: "Used by 4 designs" opens the library with that system's filter set (S5) | Closes the loop system → designs; reuses S5's filter | 2026-11-22 |
| S6-4 | The page sidebar gains a Design systems row (count) below Folders, opening the systems list; the rail header icon and page toolbar button stay | One more reachable entry, no new surface | 2026-11-22 |
| S6-5 | The New dialog's system field is unchanged in rule (pin → default → ask, explicit wins, preset hides with a system); it sits above the new Folder field | BRIEF settled; S3 adds beside it, not over it | 2026-11-22 |

### Acceptance Criteria
- [ ] Cards and rows show the system chip when the design has a linked system: the name, quiet (muted,
      small), with the full name in the tooltip; a Draft system adds a Draft mark; a deleted system reads
      "<name> (deleted)". No system: no chip, no placeholder.
- [ ] Clicking the chip opens that system (page: the system page; rail: the compact system view) and does
      not open the design; keyboard focus and the accessible name distinguish the chip from the card's
      main button ("Open system Acme" vs the design's name).
- [ ] The existing "System updated" flag stays as the update signal; the chip is identity. Both can show
      at once; the row's accessible name includes both (existing pattern).
- [ ] The systems list row's used-by count is a link ("Used by 4 designs"); clicking it opens the library
      (same surface) with the System filter set to that system and the scope at All designs. A system
      used by 0 designs shows "Not used yet" as text (no link).
- [ ] The page sidebar's Design systems row shows the system count and opens the systems list; it is
      visually distinct from the filter rows (it navigates, it does not filter). The rail keeps its header
      icon; the page toolbar keeps its button.
- [ ] The New dialog's Design system field keeps every P25 S5 rule and hint ("Pinned for shop", "Your
      default", "Ask me in chat", "No design system", the empty line with Make one). The Folder field
      (S3) sits below it.
- [ ] Chips and links update live when a system is renamed, marked ready, updated or deleted (the change
      feed already carries system events).

### User Flow (step budgets)
- **Design → its system: 1 click** (the chip).
- **System → its designs: 1 click** (used-by), landing in the library already filtered.
- **Library → systems list: 1 click** (sidebar row, toolbar button or rail icon).
- Branches: a gone system's chip opens nothing and says "This system was deleted." on click (a toast);
  the design keeps its copy and keeps rendering.

### Roles & Access
- **User:** the only one who navigates via chips and links; navigation is chrome.
- **Chat agent:** unaffected; S8 tells it the library shows systems so it can point the user there.
- **Untrusted content:** a design frame cannot draw a chip, open a system or set a filter; chips are
      chrome reading summaries only. System names are text.
- **First run:** no systems → no chips, the sidebar row shows 0 and opens the empty systems list with
      its start actions; the filter shows All systems / No system.
- **Changed folder:** chips and counts follow the new root's systems; a design whose system is not in
      this root reads as gone (the existing summary state).

### Edge Cases
- A design linked to a Draft system (the agent linked it): chip shows the name + Draft; the filter lists
  that system marked Draft; opening it works (the system page shows its Draft state).
- A system renamed while the library is open: chips update live; the filter option's name updates; an
  active filter keeps following the system's id.
- A system deleted while filtered: S5's fallback applies; chips read "(deleted)".
- Long system names: truncate with the full name in the tooltip; the rail row keeps its title budget
      (the chip wraps or truncates, never pushes the title out at 320 px).
- A card with every flag at once (pending, system updated, comments, chat, chip): the meta line wraps or
      truncates gracefully; the accessible name lists them (existing pattern).

### Security & Abuse
Chips and links are chrome-only gestures reading existing summaries; no new route surface beyond what
the systems list and library already use. A design frame cannot trigger navigation or filter changes
(the guest bridge stays as it is). Names are text; a hostile system name cannot inject markup.

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** none new.
- **Sandbox:** none; chips are chrome.
- **Theme:** kit badges/chips and host tokens; the chip is quieter than the kind badge; light and dark.

### Data Requirements
Nothing new persisted; `DesignSummary.system` (id, name, revision, state, updateAvailable) already
carries everything the chip and filter need.

### Out of Scope
- A SystemCard chat block (the 4-block budget keeps one slot free; P25 line stands).
- System management (rename, delete, default, pins) from the library; that stays in the systems list and
  Settings.
- Showing a system's token values on a design card.

---

## 7. S7 · Settings reads as settings

### Overview
The Settings control wears a sliders glyph and, on the page, the word "Settings". The owner wants a gear
so it reads as settings at a glance. S7 swaps the glyph everywhere and makes the page control icon-only,
matching the rail.

### User Stories
- As the user, I want the settings button to look like settings (a gear), so that I find it without
  reading.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| S7-1 | A gear glyph replaces the sliders glyph everywhere settings appears; the page's text button becomes an icon-only gear button with the accessible name and tooltip "Settings"; the rail's icon button swaps its glyph | Owner ask 6; the rail already proves the icon-only pattern | 2026-11-22 |

### Acceptance Criteria
- [ ] The page library toolbar's Settings control is an icon-only gear button: accessible name
      "Settings", tooltip "Settings", kit default size, focus ring, same position (before New).
- [ ] The rail header's settings icon button uses the same gear glyph; its accessible name stays
      "Settings".
- [ ] No other settings entry changes; the Settings sheet's content is untouched. Any other surface
      drawing the settings glyph (today: none outside these two) uses the gear.
- [ ] Verified light and dark, at rail width and page width; the gear is legible at the kit's icon sizes.

### User Flow (step budget)
- **Open settings: 1 click**, as today. Branch: none new.

### Roles & Access
- **User:** unchanged. **Agent / untrusted content:** none involved. **First run / changed folder:**
  unchanged.

### Edge Cases
- The glyph is inline SVG (no load failure path). Screen readers hear "Settings" on both surfaces.
- Keyboard: the button keeps its tab order position (before New on the page; last in the rail header).

### Security & Abuse
None; a cosmetic chrome change with no new surface.

### Sandbox, Filesystem & Theme Impact
Theme only: the gear uses the host token colour like every kit icon; no raw hex.

### Data Requirements
None.

### Out of Scope
- Renaming or restructuring Settings; moving any setting.

---

## 8. S8 · Agent guidance refresh

### Overview
The root guide, the copyable snippet, the bundled design-chamber skill, the instructions note and the
builder skill must describe what shipped: systems (including the new start option and reading an existing
system), folders (tags, the agent's bounded role), and the library's views. The ownership rule is
untouched: a user-edited guide is never overwritten.

### User Stories
- As the user, I want my agent to know folders are tags and how to file a design when I ask, so that I
  can say "put this in Q4 launch" and it works.
- As the user, I want my agent to know a project may already have a system and to read it first, so that
  it builds from what exists.
- As the user, I want the copyable AGENTS.md lines to mention systems and folders, so that a project's
  agent gets the facts without the slash command.
- As the user who edited the root guide, I want my edits kept, so that Design Chamber never talks over
  me.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| S8-1 | The guide gains a Folders section, extends the Design systems section (existing systems, the new start option, the library's system filter), and adds a short Library line (views, sorts, filters) | Owner ask 7 | 2026-11-22 |
| S8-2 | The agent's folder role: tag or untag a design into **existing** folders only, only when the user explicitly asks; never create, rename or delete folders; never move files to organise | D11; extends G1's "agent does not set folders" by the smallest useful step (O2) | 2026-11-22 |
| S8-3 | Refresh applies only to unedited guides (ownership marker + hash); an edited guide keeps its text and the Settings status line says so; the snippet is always copyable with the new lines | BRIEF 2026-11-01, unchanged | 2026-11-22 |
| S8-4 | The builder skill gains the existing-location reading rule; round one's existing-location question wording lives in rules/SYSTEM-QUESTIONS.md (the rules author's lane) | S1's builder branch; one source for the copy | 2026-11-22 |

### Acceptance Criteria

**The root guide (`<root>/AGENTS.md`)**
- [ ] A **Folders** section says: the user groups designs into folders in the library; folders are tags, a
      design may sit in several, and grouping never moves a design's folder on disk; projects group
      designs automatically by the project they were made for; when the user asks you to put a design in
      a folder, add it to an existing folder by name (the registry the library uses); never create,
      rename or delete folders, and never move files to organise them (§9.4 copy).
- [ ] The **Design systems** section gains: a project may already have a design system (a page, docs,
      components); when the user points at one, read its page, docs and components first and build from
      what is there; Design Chamber reads the CSS and token files it can parse, the agent writes the
      overview, notes and components; the existing lines (write only when asked, never set status, the
      design's copy is read-only, /design-system, the repo rule) stay.
- [ ] A short **Library** line says the user browses designs as tiles or a list, sorts by Updated, Created
      or Title, and filters by project, folder, kind and system; point them at the library when they ask
      where a design is.
- [ ] The refreshed guide stays within its existing cap; the ownership marker and hash mechanism are
      unchanged; a guide the user edited is never overwritten (the status line in Settings says it is
      edited, as today).
- [ ] A changed designs root gets the refreshed guide in the new root; the old root keeps its retired
      guide (existing behaviour).

**The snippet and the skills**
- [ ] The copyable AGENTS.md snippet gains one or two lines naming systems and folders and pointing at
      the guide; it stays within its cap and remains copyable even when the guide is edited.
- [ ] The bundled design-chamber skill gains the same facts (folders and the agent's bounded role, the
      existing-system reading rule, the library's views) within its cap; the instructions note stays
      consistent with it.
- [ ] The builder skill gains: when an existing system location is named (by the interview or the user),
      read its page, docs and components first and reconcile to what exists; do not invent a parallel
      system. The no-ticket rule, the two-round cap and the diff gate are unchanged.
- [ ] rules/SYSTEM-QUESTIONS.md gains the round-one existing-location question wording (recommended
      default when a location is found); the rules author owns that file.
- [ ] All instruction text stays within its existing caps; the precedence text for designs with no system
      stays byte-identical (P25 S8-12 holds).

### User Flow
1. The user updates (or installs) the extension → the service refreshes an unedited guide in place →
   agents read the new lines on their next turn. No user action needed.
2. The user opens Settings → the guide status line shows "kept up to date" or "you edited this file" →
   Copy the snippet for a project's AGENTS.md.
3. Branches: edited guide → never overwritten, snippet still offered; root with a control character →
   refused loudly (existing); guide at cap → the builder throws rather than cut a path (existing).

### Roles & Access
- **User:** owns the guide's text once they edit it; copies the snippet; asks the agent to file designs.
- **Chat agent:** reads the guide/skill; tags existing folders only on explicit request; reads an existing
      system before building from it; never manages folders or writes a repo outside the diff gate.
- **Untrusted content:** the guide is an instruction surface; it carries no token, port or secret; a
      design frame cannot write it; repo text cannot approve anything (the injection sentence stands).
- **First run:** the guide is written on the first service start with the new content; no designs folder
      yet → the existing onboarding is unchanged.
- **Changed folder:** new root gets the refreshed guide; old root keeps the retired guide; an edited guide
      in either root is never overwritten.

### Edge Cases
- The user edited the guide before the update: their text stays; the Settings status says so; the snippet
      still carries the new facts.
- The user asks the agent to "make a folder called Q4": the agent says folders are made in the library
      (New folder) and offers to file the design once it exists; it does not create one (S8-2).
- The user asks the agent to file a design into a folder that does not exist: the agent says so and names
      the closest existing folders, or offers to file it once the user makes one; it never invents a
      folder.
- Two agents tag the same design at once: the registry's write queue serialises; membership ends up once.
- A folder name with control characters asked in chat: refused by the registry's rules; the agent reports
      the sentence.
- The guide's cap is reached by the new sections: the builder throws loudly (existing rule); the architect
      trims wording, never facts, to fit.

### Security & Abuse
- **Instruction surface:** the guide and skills steer agents; they carry no secrets, no bearer token, no
      port, no absolute path outside the designs root and the named project. The ownership hash prevents
      a silent replacement; a user-edited guide is the user's own instruction choice.
- **Agent folder writes** are bounded to the registry (tag/untag existing folders), never paths, never
      folder lifecycle; a prompt-injected "put every design in folder X" still only tags, and the user sees
      the counts change in the library (visible, undoable by untagging).
- **Existing-system reading** inherits S1's injection sentence and read-only bounds.
- **Audit:** folder membership changes are registry writes with the existing recovery behaviour; the
      guide's ownership record shows who wrote it last.

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** the guide file in the designs root (existing ownership rules); the snippet is text in
      the chrome; skills ship in the extension bundle. No project repo write.
- **Sandbox:** none; instruction text only.
- **Theme:** the Settings status line and snippet use host tokens (existing).

### Data Requirements
The guide text and its ownership record (exist). No new persisted facts; the skill and snippet are
generated text within their caps.

### Out of Scope
- Teaching agents new design rules (the rules author's lane beyond the one question wording).
- Agent-created folders; agent folder lifecycle management.
- Translating the guide (English only, as today).

---

## 9. Phase-level sections

### 9.1 DECISIONS (proposed defaults for what BRIEF leaves open)

Status: **proposed** = the safe default this spec recommends, pending owner sign-off (none blocks the
architect; the recommended default is what gets built unless the owner says otherwise); **settled** =
already an owner decision in BRIEF, restated so the spec is self-contained.

| # | Decision | Status | Rationale |
|---|---|---|---|
| D1 | Folder delete is untag-only, behind a confirm naming how many designs are in the folder and how many lose their last folder; the 10 s Undo stays; designs are never deleted, trashed or moved | proposed (supersedes P25 G1's no-confirm choice) | Owner ask 3; a confirm that tells the truth is safer than a silent untag, and Undo still covers mistakes |
| D2 | View preference (tiles/list) persists per user; sort persists per surface; search, kind tab and system filter are session-only | proposed | Owner ask 4 ("persisted"); remembered filters read as lost designs |
| D3 | Discovery candidates are a read-only list (paths + what was found); the service never writes a project; picking a candidate narrows the read | proposed (BRIEF's read-only rule applied) | Owner ask 1; the extraction split and the repo rule stand |
| D4 | The agent authors from an existing system behind the same Draft + review flow; a repo write only via the P25 S8 diff gate; the service never writes the repo | proposed (extends settled rules) | Owner ask 1; no new write path into a repo |
| D5 | A new design picks the project's pinned system, else the global default, else the agent asks; an explicit choice wins; one system per design | settled (BRIEF 2026-11-19) | Restated; S6-5 keeps it |
| D6 | The root AGENTS.md guide is never overwritten once user-edited; refresh applies to unedited guides; the snippet is always copyable | settled (BRIEF 2026-11-01) | Restated; S8-3 keeps it |
| D7 | Folders are tags; a design may sit in several; grouping never moves files on disk; "move" is untag + tag in one action with one Undo | settled (BRIEF) + proposed (the Move action) | Owner ask 3; tag semantics make Move safe |
| D8 | The gear glyph replaces the sliders everywhere; the page Settings control becomes icon-only with the name "Settings" | proposed | Owner ask 6 |
| D9 | The view toggle is page-only; the rail keeps rows | proposed | 320 to 480 px is a list by nature; bounded |
| D10 | The System filter lists current systems (Draft marked) plus No system; designs whose copied system is gone count as No system | proposed | Simple, truthful; the chip still names a gone system so nothing is hidden |
| D11 | The agent may tag/untag designs into existing folders only on explicit user request; never create, rename or delete folders; never move files | proposed (extends P25 G1's agent role; O2) | The smallest useful extension; folder lifecycle stays with the user |
| D12 | From the sheet, Existing design system makes an internal-home Draft; a repo-backed home stays with /design-system, which gains the existing-location start | proposed (O3) | Keeps the sheet flow simple; the diff gate stays the only repo-write path |
| D13 | A location holding a complete Design Chamber-contract system offers registration as a repo-backed read-only system beside the extract path | proposed (O4) | Respects existing work; reuses the snapshot read; no repo write |

### 9.2 Edge cases across features
- **Service restart mid-action** (filing at creation, a move, a delete, a scan): the action landed fully
  or not at all (registry writes are atomic; scans expire); the user sees the result on reload, and the
  Undo window is the service's, not the frame's.
- **Root change mid-flow:** a running scan/discovery stops with the existing sentence; creation under the
  old root's folder ids files nothing and says so; view/sort preferences stay; the scope falls back per
  the existing rule; the new root's guide is the refreshed one.
- **Windows:** folder and system names differing only by case are one name (existing rules); paths
  compared with the one containment function and `sameDirectory`; the location field accepts both slash
  styles; the gear and the views render identically.
- **Large libraries:** 500 designs, 50 folders, 50 systems: counts stay correct as designs arrive live;
  the list view stays responsive; the filter selects scroll; the sidebar scrolls (existing). The architect
  bounds whatever needs bounding; the requirement is truthful counts and no lost scroll.
- **Two windows / two surfaces:** the write queue serialises registry writes; each surface keeps its own
  scope and sort; the page's view toggle is its own; a delete in one shows in the other via the change
  feed; Undo offered in the window that acted.
- **The agent writes while the user browses:** live refresh keeps the active filters, sort, view and
  scroll; a new design appears under the filters that match it (a design created with no system appears
  under No system, not under a system filter).
- **First run (no designs folder yet):** the existing onboarding is unchanged; once the folder exists:
  empty library states, no chips, the System filter shows All systems / No system, the Folders heading
  shows its hint, the guide is written with the new content.
- **A changed designs folder:** everything per-root (designs, folders, systems, guide) follows the new
  root; preferences (view, sort) are harmless carry-overs; the old root's designs are offered by the
  existing "remain in your earlier folder" banner.
- **Damaged registry:** the existing recovery holds (reads empty with the damaged notice, renamed aside
  on the next user action); no action in this phase silently replaces it; creation and filing are never
  blocked by it (S3-2).
- **A system gone while designs use it:** chips read "(deleted)", the filter counts them as No system,
  designs keep rendering from their copies (P25 S5's recovery stands); nothing in this phase resurrects
  a deleted system.

### 9.3 Security & abuse summary
- **Who must not write a project repo:** the service (absolutely, every write resolves under the designs
  root), a design task's agent, any frame, and anything without the user's approving click or typed words
  in the system's chat. S1 adds no write path; registration (D13) writes only under `_systems/`.
- **Who must not manage folders:** a design frame, another design, repo text, or an agent acting without
  the user's explicit request. Folder lifecycle (create/rename/delete) is the user's alone, through the
  chrome. Agent tagging is bounded to existing folders and is visible in the library's counts.
- **Who must not see project contents:** the candidate list and scan summary carry paths and counts only;
  secret files are never opened; logs carry ids, counts and outcomes; nothing leaves the machine; no
  network fetch of a served page.
- **Abuse vectors and answers:** a hostile repo aiming at the agent (bounded read-only scan, injection
  sentence, diff gate for any repo write); a crafted location path (realpath containment inside the
  project, Designs root refused, symlinks out refused); prompt injection through a living page or docs
  (the request's injection sentence; the agent writes only the system folder); a forged folder operation
  (chrome-only gestures, server-side validation, caps); a delete confirm that lies (counts re-checked on
  apply, the notice reports the truth); stored-preference garbage (validated enums, defaults); a hostile
  name in a chip, toast or confirm (text, truncated, never markup).
- **Sensitive data:** project paths, folder names, system names and brand values are the user's own data,
  shown in their UI and their chats only. Preferences carry no design content. The guide carries no
  token, port or secret.
- **Audit trail:** folder writes go through the existing registry (soft delete, Undo, recovery); system
  creation and review keep P25's versions and proposal records; the guide's ownership record shows who
  wrote it last; a design's filing at creation is a registry write beside the design's own first version.

### 9.4 Copy guidance

Rules (apply to every new line, UI and agent-facing):
- Natural, human wording; short sentences; the user's own words for things (folder, system, design).
- **No em dashes.** Use commas, semicolons, parentheses or two sentences.
- Glossary, one term per concept: **design** (an item folder), **page** (one HTML page design),
  **canvas** (a multi-screen design wall), **screen** (one page of a canvas), **viewport** (a device
  size), **artboard** (a screen at a viewport), **pin** (an element-anchored comment), **version** (a
  snapshot), **system** (a design system), **folder** (a user tag that groups designs), **project** (the
  automatic group by the project a design was made for). Never call a folder a "directory" in the UI;
  never call a project a folder.
- Say what happens, not what the tool "leverages"; name the way forward in every error and empty state;
  counts are truthful and pluralised; a destructive confirm names the facts and the promise.
- Agent-facing text is imperative and plain; it states rules, not marketing; it never asks the agent to
  do what only the user may do.

Proposed lines (the architect and builders may tighten wording, not facts):

| Where | Line |
|---|---|
| Start option hint, Project code | "Design Chamber reads the CSS and token files it can parse. The agent reads the rest of the project and writes the overview, notes and components. The project isn't changed." |
| Start option hint, Existing design system | "Your project already has a system? Point at where it lives. Design Chamber reads its token files; the agent reads its page, docs and components." |
| Start option hint, Brand files | "Fonts, logos and brand documents you already have." (unchanged) |
| Start option hint, A description | "Say what it should look like, or start from a style preset." (unchanged) |
| Location field | Label "Where does it live?"; placeholder "design-system"; helper "A folder inside <project>. Design Chamber only reads it." |
| Candidates heading | "Looks like a design system"; each row "design-system · page, 24 colours, 3 docs" |
| No candidates | "No existing design system found in this project. Point at a folder yourself, or start from the code." |
| Missed line | "Design Chamber reads CSS and token JSON. Pages, components and themes written in code are left for the agent." |
| Nudge | "This project already has a design system in design-system/. Start from it instead?" · button "Start from it" |
| Nothing in the location | "Design Chamber didn't find token files in <folder>. The agent can still read its page and docs and write the system." |
| Location outside project | "Pick a folder inside <project>." |
| URL typed as location | "Use the folder on this machine, not a web address." |
| New dialog Folder field | Label "Folder"; helper "Optional. Pick where this design belongs; you can change it later."; none option "No folder"; stated result "Goes into Q4 launch and Explorations" |
| Filing failure after creation | "Couldn't add it to <folder>. <reason>" · "Try again" |
| Picker context line | "Projects group designs automatically. Folders are yours to fill." |
| Delete confirm | Title "Delete Launch?"; body "6 designs are in Launch. 2 of them are in no other folder; they stay in All designs. Deleting a folder never deletes designs."; confirm "Delete folder" |
| Delete confirm, empty | "Launch is empty. Deleting it changes nothing." |
| Delete confirm, all keep folders | "Its 6 designs all keep their other folders. Deleting a folder never deletes designs." |
| Move menu / dialog | "Move to folder…"; title "Move Pricing out of Launch"; pick label "Into which folder?" |
| Move notice | "Moved Pricing to Q4 launch." · "Undo" |
| Move, same folder | "Pricing is already in Q4 launch." |
| View toggle | "Tiles" / "List"; accessible names "View as tiles" / "View as list" |
| System filter | Label "System"; options "All systems", "<name>", "No system" |
| No matches with filters | "No designs in Launch match 'hero' with the Acme system." · "Clear filters" |
| Settings gear | Accessible name and tooltip "Settings" |
| Sidebar systems row | "Design systems" + count |
| Used-by link | "Used by 4 designs"; zero state "Not used yet" |
| Gone system chip | "Acme (deleted)"; on click "This system was deleted." |
| Guide, Folders section | "The user groups designs into folders in the library. Folders are tags: a design can sit in several, and grouping never moves a design's folder on disk. Projects group designs automatically by the project they were made for. When the user asks you to put a design in a folder, add it to an existing folder by name. Never create, rename or delete folders, and never move files to organise them." |
| Guide, systems addition | "A project may already have a design system: a page, docs, components. When the user points at one, read its page, docs and components first, and build from what is there. Design Chamber reads the CSS and token files it can parse; you write the overview, notes and components." |
| Guide, Library line | "The user browses designs as tiles or a list, sorts by Updated, Created or Title, and filters by project, folder, kind and system. Point them at the library when they ask where a design is." |
| Snippet addition | "Designs can be grouped into folders (tags, never disk moves) and use design systems. Read the guide for the rules." |

### 9.5 Step budgets (core flows, user actions; waits and reads are not actions)

| Flow | Budget | Notes |
|---|---|---|
| Start a system from an existing location (systems list → made Draft) | ≤ 6 | Project preselected when the chat has one; empty-state shortcut saves one |
| New design into an existing folder | ≤ 4 | New ▾ → kind → tick folder → Start; no pick = 3, as today |
| Add an existing design to a folder | ≤ 4, or 1 drag | ⋯ → Add to folder… → tick → Done |
| Move a design between folders | ≤ 3 + Undo | ⋯ → Move to folder… → pick target |
| Rename a folder | ≤ 3 | Menu → Rename → type + Enter |
| Delete a folder | ≤ 3 + Undo | Menu → Delete folder → confirm |
| Create a folder | ≤ 3 | New folder → type → Enter |
| Switch view / sort / system filter | 1 each | View and sort persist; filter is session-only |
| Design → its system (chip) | 1 | |
| System → its designs (used-by) | 1 | Lands filtered |
| Open Settings (gear) | 1 | |
| File an open design (viewer ⋯) | ≤ 4 | Same picker as the list |

The existing core flows (browse → open → export; wall → pan/zoom; pin → send; restore a version; change
the designs folder) keep their P25 budgets; nothing in this phase adds a step to them.

### 9.6 Out of scope (phase)
- Bulk multi-select operations on designs (file, move, delete many at once).
- Nested folders; folder colours or icons; folders for systems.
- Changing a design's project (`projectDirectory`); moving folders or systems between designs roots.
- Fetching a served URL, GitHub sync, any remote source; Figma or design-tool imports.
- Making a system from a design's DESIGN.md/tokens.css (P25 S2 line stands).
- Running project builds or importing real components (BRIEF).
- A fourth chat block (SystemCard); the budget keeps one slot free.
- Sort direction toggles; saved filter presets; persisting search/tab/system filter; a rail tiles view.
- Agent-created folders or agent folder lifecycle management.
- Switching a system's home after anything is applied (P25 line stands).

### 9.7 OPEN questions for the owner (recommended defaults; none blocks the architect)

1. **Which flow did you mean by "only lets me type a NEW folder name"?** The Add to folder dialog already
   lists your existing folders with ticks (v0.4.0); the sidebar's New folder row is create-only, and a
   failed folder load hides the list. **Recommended default:** treat it as a discoverability and
   creation-time gap: S3 adds the folder pick to the New dialog, keeps the existing-folder list as the
   picker's primary content, and adds the viewer entry; QA reproduces on your install to rule out a load
   failure. If you meant a different screen, name it and we will aim S3 there.
2. **May the agent tag designs into folders when you ask?** (P25 said the agent does not set folders.)
   **Recommended default:** yes, existing folders only, only on your explicit request ("put this in Q4
   launch"); never create, rename or delete folders, never move files (D11). The alternative is read-only
   knowledge: the agent knows folders exist and points you at the library for every filing.
3. **From the New design system sheet, should "Existing design system" also offer a repo-backed home?**
   **Recommended default:** the sheet makes an internal-home Draft (as From code today); a repo-backed
   system with a living page stays with /design-system, whose interview gains the existing-location start
   (D12). The alternative is a home choice in the sheet, which duplicates the interview's first question.
4. **When the location already holds a complete Design Chamber-contract system, register it as it is?**
   **Recommended default:** yes, offer "Register it as it is" (repo-backed, read-only snapshot, Draft for
   review) beside "Make a new system from it" (D13); it respects the work already done and writes nothing
   to the repo. The alternative is always re-extracting, which is simpler but throws away a ready system.

### 9.8 Handoff

Recommended next: the architect designs S1 (the scan's discovery branch, the location validation, the
request shape, the registration branch if O4 is accepted) together with S2's summary changes; S3/S4's
shared folder picker and the creation-request contract change go through the main agent (WP0 files);
S5/S6 settle together (the list view draws the chip); S7 is a one-glyph change any builder can take;
S8 last, with the rules author taking rules/SYSTEM-QUESTIONS.md. Complexity: S1 L, S2 S, S3 M, S4 M,
S5 M, S6 S, S7 S, S8 M. The four open questions go to the owner via the main agent; the recommended
defaults are what gets built unless he says otherwise.

Spec Complete → architect (technical design) | → main agent (4 questions for the user)
