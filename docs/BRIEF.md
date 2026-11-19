# Design Chamber — product brief (source of truth for decisions)

Design Chamber is an OpenChamber extension: a Claude Design–style design canvas plus
Claude-artifacts–style HTML canvases, rendered **inside OpenChamber**, with designs written
as plain files by the user's own chat agent.

Owner decisions (2026-10-26). Anything not listed here is open — ask, don't guess.

## North star (owner endorsed 2026-11-19)
Design Chamber is growing from a design tool into a full artifact manager, with designs as the
first artifact type. Every artifact is a folder with a contract (`design.json`), rendered in the
same sandboxed viewer, versioned, checked, and steered by the same agent instructions. Design
systems, projects, and the ways out (export, present, handoff) all reuse those same primitives, so
the foundation does not change, it generalizes. The design canvas stays the heart of it, now one
view over a broader library. The whole lifecycle lives here: make it, systematize it, organize it
by project, review it, and ship it out, with the agent as the author and the user as the editor.

## Platform
- OpenChamber extension (SDK `apiVersion: 1`), source of OpenChamber at
  `~/Documents/GitHub/openchamber` (SDK: `packages/sdk/DOCUMENTATION.md`, `API.md`,
  `GUEST_SERVICES.md`, `examples/`). Target OpenChamber >= 2.7.0 (SDK 2.7.0, pinned).
- New repo. Reuse proven pieces from `~/Documents/GitHub/openchamber-design-canvas`
  (v0.3.0, MIT, same owner) where they help: Chrome discovery, wall pan/zoom math,
  design-system precedence, prompt rules, presets, gates. Do not inherit its
  external-Chrome-window + Vite-dev-server architecture.
- Rendering is **in-app**: rail `panel` = navigator, full-screen `page` = viewer/canvas.
  Designs render in sandboxed blob/srcdoc iframes fed by the extension's local `service`.
  Colours follow OpenChamber's active theme (host theme tokens / SDK UI kit).
- Must not declare `provides: ["browser"]` (would fight Design Canvas).

## Storage
- Default root `~/Documents/Designs`; user can change it (persisted setting); existing
  designs are not silently moved.
- One folder per item: `Designs/<slug>/` with `design.json`
  (`kind: "page" | "canvas"`; older `"artifact"` still reads as a page; title, created/updated, linked `sessionId`, viewports,
  screen list, comments), `index.html` (page) or `screens/*.html` (canvas), `assets/`,
  `DESIGN.md` + `tokens.css` (per-design design system), `.versions/` (snapshots).

## Creation / editing
- The chat agent writes the files. `/design <brief>` (canvas) and `/page <brief>` in any chat
  attach: the design rules, the target folder, the design.json contract.
- Extension watches the folder and refreshes live.
- Each design remembers its chat session: "Continue in chat" reopens it; comments and
  revisions go to that session (new chat if none / gone).
- Message action "Open as page": an assistant message with an HTML code block becomes a
  page in Designs and opens in the viewer.

## Views
- **List**: thumbnail grid of designs (rail + page), headless-Chrome PNG thumbnails cached on
  change; fallback to live mini-iframe when Chrome is missing.
- **Rail panel** for navigating pages and canvases.
- **Page**: one HTML page shown full screen like a browser tab, with its local images (fills
  the viewer; a viewport preset shows a fixed width without pan/zoom). Export: **ZIP** (html + assets, like Claude Desktop artifact download) and
  **single-file HTML** (assets inlined).
- **Design canvas**: an infinite wall with horizontal + vertical scroll/pan and zoom showing
  multiple screens × multiple viewports as artboards.
  - Edit / Play mode (Play = clickable prototype inside its artboard).
  - Pinned comments anchored to an element; the element's selector/snippet travels with the
    comment; "send comments" posts one revision request to the linked chat.
  - Version snapshots per agent turn; compare / restore.

## Design rules (agent instructions)
Precedence, highest first:
1. The user's words in chat.
2. The **active project's** design rules if any exist (DESIGN.md, design tokens/theme files,
   AGENTS.md / CLAUDE.md design sections, existing breakpoints/viewports) — always looked for
   first.
3. Chosen bundled style preset (if any).
4. Per-design `DESIGN.md` + `tokens.css` once confirmed.
5. Built-in anti-slop rules + design best practices.
- Instruction to **ask the user questions when unsure** (brief, with recommended defaults).
- Viewports: derive from the project first; ask which viewports to show when unsure.
  Defaults: Laptop 1280×800 and Phone 390×844.
- Bundled style presets pickable at creation.

## Owner decisions on spec questions (2026-10-26)
- Chips / "Open as page" open the compact viewer in the rail (extensions can't open their
  full-screen page from code); hint points to sidebar → Extension pages.
- No Google Fonts / CDNs in designs; fonts bundled in `assets/`, system fallbacks.
- Agent write permission: Settings shows a copyable `opencode.json` snippet; never edit the
  user's config.
- Exports (ZIP, single-file HTML) go to `~/Downloads` with a "Show in folder" toast.
- Delete moves a design to `<root>/.trash`.
- Comment pins work on pages as well as canvases.

## Owner decisions (2026-11-01)
- "Artifact" is renamed "Page" everywhere the user or an agent sees it.
- Agents find Design Chamber without a slash command: the service keeps a guide at
  `<root>/AGENTS.md` (never overwriting a file the user wrote or edited); Settings can install a
  `design-chamber` skill into OpenCode's global skills folder, only when the user clicks; Settings
  shows a copyable AGENTS.md snippet.
- A folder the agent fills with HTML before design.json keeps the agent's design.json values.
- Loose `.html` files in the designs folder are offered for import as pages; the original moves
  to `.trash`.
- Designs that load files from the internet show what was blocked, and sent comments include
  that list.

## Owner decisions (2026-11-10, Phase 1.5)
- Design Chamber ships its `design-chamber` skill, its instructions and an OpenCode plugin with the
  extension; they reach every agent OpenChamber runs while the extension is on. Settings no longer
  installs a skill.
- Writes outside the designs folder: Design Chamber's own settings folder (`settings.json`, and
  `runtime.json`, which records where OpenChamber's runtime is so the check tool can run it); and,
  only when the user clicks **Remove old copy**, deleting the skill copy an older version installed,
  if it is ours and unedited.
- The local service also starts when any chat's turn starts or ends, in any project, so that a
  version is saved after every agent turn on a linked design with no Design Chamber window open. It
  reads only which chat changed, never what was said.
- Designs show in the chat's Work Status and in agent replies; Open there opens the rail viewer (the
  full-screen page still cannot be opened from code).
- A design is linked only to the chat it was started from (its /design or /page card in that chat),
  never guessed from timing.

## Owner decisions (2026-11-11, Phase 2)
- The canvas screen list (`design.json` `screens[]`) is shared: Design Chamber writes it only for
  the user's own actions (reorder, duplicate, trash, keep a direction), saves a version first and
  refuses when the agent changed `design.json` since the wall loaded it. The agent stays free to
  rewrite the list; its later write wins.
- Variations on the wall are screens in the same canvas, marked by the agent as directions of one
  screen. The row shows Current, A, B, C at one viewport; "Keep this one" on the wall is the picker.
  DirectionPick in chat stays for separate-folder directions; the agent may still ask in chat and act
  on the answer itself.
- Saved page data (feature 19): one store per design, shared by all its screens and viewports on the
  rail and the page, capped at 1 MB per design, with a one-time notice when a design goes over.
- In Edit mode a click still opens the comment box as today, with the selection toolbar (Edit text,
  Comment, Ask agent) above the element; a double-click on text goes straight to editing.
- The agent is told about hand edits: the next message Design Chamber sends to the linked chat
  (comments, ask, fix) starts with a short list of what the user changed by hand since the last one.
  Nothing is sent on its own; the instructions also tell agents to re-read a file before editing it.
- On the rail, Tweaks opens as a non-modal bottom sheet (up to 50% of the rail height) so the wall stays
  visible for live preview; Reset/Save pinned in the footer; full-height fallback below about 560 px of
  rail height. Comments and Versions stay full-height. (Owner approved the mockup direction 2026-11-11.)
- On the rail, a direction row wraps to a 2×2 grid so Current, A, B and C are visible at once; the page
  keeps the single row. The row's "Show at" viewport switch is drawn on both surfaces. (Owner approved
  2026-11-11.)

## Owner decisions (2026-11-19, Phase 2.5)
- Design systems and project grouping live inside Design Chamber (not a separate extension).
- A new design picks its system: the project's pinned system, else the user's global default, else the
  agent asks which. A per-design explicit choice always wins.
- Components are tokens + styles + a component inventory with usage notes; no running project builds or
  real-component import in this phase.
- Designs group by project automatically AND by manual folders; a design may sit in several folders
  (folders behave like tags). Grouping never moves a design's folder on disk.
- Systems are created by extracting from a project's code (repo left unchanged), uploading brand
  files/fonts, and manual on-page editing; re-sync updates values but keeps notes/overview/fonts/assets.
- Extraction is split: Design Chamber parses CSS variables and token JSON it can read with certainty; the
  agent writes the overview, usage notes, components and anything unparseable.
- Rules order with a linked system: the user's words, then the design's system, then the project's files
  for whatever the system doesn't cover, then the preset only when no system is linked, then the built-in
  rules. The preset picker hides when a system is chosen. (Supersedes the Phase 0 precedence for designs
  with a linked system.)
- One system per design this phase (two systems' tokens clash by name).
- Each design keeps its own copy of the system (copy-on-link); when the system changes the design shows
  "Review update" and never updates by itself. The design's own token changes stay as overrides on top of
  a newer system, each with "Reset to system".

### Building systems like Claude (added 2026-11-19)
- A system lives either in the internal Design Chamber store or in the project repo with a generated
  living page, chosen per system (like Claude's "Repo + living page"). Copy-on-link feeds designs either way.
- A `/design-system` slash command plus a building skill (a different name, since the host drops a command
  whose name a skill already uses) run a Claude-style interview: where it lives, fix-vs-describe, coverage,
  dark mode, then the token calls (status colours, greys, typography, who can open the living page).
- "Fix tokens, then document": the agent reconciles the project's token code to the agreed system after a
  reviewed diff the user approves, in its normal coding role, then writes the docs and living page. The
  service stays read-only on project repos: it generates the living-page HTML and re-scans, but never writes
  the repo. The agent writes the repo (tokens and living page).
- Coverage spans four areas: Foundations, Components, Patterns & voice, Brand & marketing.
- The living page is one self-contained HTML file (no scripts, no remote refs) the agent commits to the repo;
  the skill advises placement and access (dev builds only vs public). Hosting and access are the repo's
  concern, not Design Chamber's.
- Folded into Phase 2.5 as one on-par release (not a separate phase).
- Describe-only with a repo + living-page home never modifies the app's existing code, but the agent still
  creates the new system files, docs and living page after the same reviewed-diff approval; the code keeps its
  values and the gap shows as an informational finding.
- Hand edits on a repo-backed system: the panel shows values and notes read-only ("lives in <repo>; change
  them there, or ask the agent here"). The ask bar and Needs work send the change to the system's chat (the
  agent proposes a diff); review, Mark ready, rename and delete stay Design Chamber actions. E1-E12 hold via
  the diff gate.
- A living-page refresh: the user's explicit "Ask the agent to update it" is the approval to commit the one
  regenerated file (the agent commits only it and says so). Any other repo write, and every token-code change,
  needs a fresh reviewed diff.
- Re-syncing a repo-backed system applies the whole read (new tokens and removals together), all or nothing;
  holding back part would leave Design Chamber showing values the repo no longer has.
- A new system first appears as a Draft after round one of the interview (so the chip resolves and round two
  has scan.json); the repo is not written until the diff is approved.
- The interview and diff ship as extension-rendered chat blocks (one SystemAsk block with a kind argument)
  with Approve/Decline buttons; the diff is read from a proposal file, approval is bound to the proposal id
  (no stale approvals), and a note alone is never approval (a typed reply always works).
- Living-page component examples are rendered to PNG by the headless-Chrome thumbnail pipeline and embedded
  as data:image, so no agent-written markup ever reaches the unsandboxed page.

## Process
- Public GitHub repo, MIT, default branch `master` with branch protection (PR + 1 approval + CI; owner-only bypass). (Updated 2026-10-27; was local-only.)
- Agents may folder-install into the user's running OpenChamber for smoke tests.
