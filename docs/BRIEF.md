# Design Chamber — product brief (source of truth for decisions)

Design Chamber is an OpenChamber extension: a Claude Design–style design canvas plus
Claude-artifacts–style HTML canvases, rendered **inside OpenChamber**, with designs written
as plain files by the user's own chat agent.

Owner decisions (2026-10-26). Anything not listed here is open — ask, don't guess.

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

## Process
- Public GitHub repo, MIT, default branch `master` with branch protection (PR + 1 approval + CI; owner-only bypass). (Updated 2026-10-27; was local-only.)
- Agents may folder-install into the user's running OpenChamber for smoke tests.
