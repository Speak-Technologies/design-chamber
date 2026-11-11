# Design Chamber — Product Documentation

Plain-English descriptions of every page and feature. Updated by whoever makes the change,
before any feature is marked Done. Accepted minor issues: [known-issues.md](known-issues.md). If code and these docs disagree, the code is right —
fix the doc and note what drifted.

## Pages
| Page | Route | One-liner |
|---|---|---|
| [Rail panel](pages/rail-panel.md) | the Design Chamber icon in OpenChamber's rail (`panel` surface) | The navigator in OpenChamber's rail: browse designs, compact viewer, settings. |
| [Full-screen page](pages/full-screen-page.md) | OpenChamber sidebar → Extension pages → Design Chamber (`page` surface) | The library, the canvas wall and the page viewer. |

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
| [Tweaks](features/tweaks.md) | Knobs the agent declares in design.json, read from and saved into tokens.css: which declaration a knob uses, why one can't be tuned, what Save writes. | Rail panel, Full-screen page |
