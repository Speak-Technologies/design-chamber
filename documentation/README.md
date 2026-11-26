# Design Chamber — Product Documentation

Plain-English descriptions of every page and feature. Updated by whoever makes the change,
before any feature is marked Done. Accepted minor issues: [known-issues.md](known-issues.md). If code and these docs disagree, the code is right —
fix the doc and note what drifted.

## Pages
| Page | Route | One-liner |
|---|---|---|
| [Rail panel](pages/rail-panel.md) | the Design Chamber icon in OpenChamber's rail (`panel` surface) | The navigator in OpenChamber's rail: browse designs, compact viewer, settings. |
| [Full-screen page](pages/full-screen-page.md) | OpenChamber sidebar → Extension pages → Design Chamber (`page` surface) | The library, the canvas wall and the page viewer. |
| [Library: projects and folders](pages/library.md) | the page's designs list | The sidebar that groups designs by project and by your own folders (including designs you filed under a project by hand), drag to add, delete with Undo. Design systems sit in the library as tiles and rows, a Systems tab, a chip on every design and a sidebar section. |
| [Rail: projects and folders](pages/rail.md) | the rail's designs list | The Show select with the same groups (and New folder…), Add to folder, the Filters area (System, Sort, Titles or List view), the systems entry and folder actions. |
| [Design systems](pages/design-systems.md) | the page's Library toolbar and the rail's header → Design systems | The list of design systems (badges, states, row menu) and the New design system sheet: from code, brand files, a description or an existing system folder in a project (register it as it is, or make a new one from it). |
| [Viewer: a design's system](pages/viewer.md) | the chip in a design's header | The system chip, popover, update banner and sheet, Change…, Undo and the agent switch notice. |
| [Settings: Design systems](pages/settings.md) | Settings → Design systems, and the New design dialog | The default and per-project pins, and the dialog's Design system field. |

## Features
| Feature | One-liner | Pages involved |
|---|---|---|
| [The local service](features/local-service.md) | Designs folder and settings, folder names, containment, live change feed, pages and canvases (old "artifact" designs read as pages). | Rail panel, Full-screen page |
| [Rendering, versions, export, thumbnails](features/rendering-versions-export-thumbnails.md) | What the local service does: self-contained renders, snapshots, downloads, previews. | Rail panel, Full-screen page |
| [Agent instructions](features/agent-instructions.md) | The chip and RULES.md that steer the chat agent; revision requests; Open as page. | Rail panel, Full-screen page, chat |
| [Design checks](features/design-checks.md) | The `design_check` tool and the `dc check` command an agent runs before it says done: renders every screen offline, saves pictures, lists what to fix; the service's findings and routes. | Rail panel, Full-screen page, chat |
| [Agent discovery](features/agent-discovery.md) | How an agent finds the designs folder without a slash command: the note in its instructions, the built-in design-chamber skill, the AGENTS.md guide, the snippet; never overwrites the user's file. | Rail panel, Full-screen page (Settings) |
| [Turn snapshots](features/turn-snapshots.md) | A version after every agent turn on a linked design, from OpenChamber's session events, with no Design Chamber window open. | Full-screen page (Versions) |
| [Work Status](features/work-status.md) | Recent designs in the chat's Work Status: what the agent is writing, check results, Check and Open. | Work Status, Rail panel |
| [Design mentions](features/design-mentions.md) | `@` a design in the composer to give the agent its folder, rules and open comments. | Chat composer |
| [Chat blocks](features/chat-blocks.md) | A design card in the agent's reply, and a pick between design directions. | Chat, Rail panel |
| [Edit on the canvas](features/edit-on-canvas.md) | The rules every hand edit follows: only the user writes, a version first, refused when the file changed, smallest change, Undo, and what the agent is told. | Rail panel, Full-screen page |
| [Screens and directions](features/screens-and-directions.md) | Grow and shape a canvas: the "+ Screen" board, the screen menu (Duplicate, Move up/down, Move to trash), drag reorder, and direction rows with Keep this one. | Rail panel, Full-screen page |
| [Saved page data](features/saved-page-data.md) | Designs that remember ticks, toggles and filters (`localStorage`, 1 MB per design, shared by every screen): where it lives, what Clear does, the notices. | Rail panel, Full-screen page |
| [Projects and folders](features/projects-and-folders.md) | Group designs by project (automatic) and by hand-made folders (a design may sit in several); a registry in the designs folder, never a move on disk; delete with Undo; damaged-file recovery. | Full-screen page (Library), Rail panel |
| [Design systems](features/design-systems.md) | What a design system is, where it lives, how the New design system sheet makes one (create, add brand files, ask the agent, or start from an existing system folder), and what the list shows. | Full-screen page, Rail panel |
| [Design system brand files](features/design-system-brand-files.md) | Fonts, logos and source documents added to a design system by picking, dropping or naming a folder: accepted types checked by content, size limits, safe names, what system.json records. | Full-screen page (design systems) |
| [Design system hand edits](features/design-system-hand-edits.md) | Saving a token, metadata or text change to a design system by hand: what can change, the value check, version first, refused when changed, Undo, what the agent is told. | Full-screen page (design systems) |
| [Design system re-sync](features/design-system-resync.md) | Bringing a system's token values up to date with the code it was made from: the review lists, what Apply changes and keeps, stale and folder refusals, "Before re-sync" and Undo. | Full-screen page (design systems) |
| [Design system homes and adoption](features/design-system-homes.md) | Internal and repo-backed systems: how the agent's BUILD.json is checked and adopted (every refusal reason), when the home can still change, the applied stamp, the read-only refusals and Show in folder for a system. | Full-screen page (design systems) |
| [Design system proposals](features/design-system-proposals.md) | What the agent proposes before it changes a repo-backed system: PROPOSAL.json and its limits, the checks against the build, the preview, approval bound to the bytes shown, Stop, and the compare of what landed. | Full-screen page (design systems) |
| [Design system coverage](features/design-system-coverage.md) | The four areas a design system covers (Foundations, Components, Patterns & voice, Brand & marketing), the patterns and brand entries, where logos show, and what "Not covered by this system." means for the board and review. | Full-screen page (design systems) |
| [Tweaks](features/tweaks.md) | Knobs the agent declares in design.json, read from and saved into tokens.css: which declaration a knob uses, why one can't be tuned, what Save writes. | Rail panel, Full-screen page |
