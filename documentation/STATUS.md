# Project status, 2026-11-10

## State
- **Phase 1.5 (OpenChamber SDK 2.7) is built on `feat/phase-1-5`**: PR 1 (`feat/sdk-2-7`) plus the six
  sibling branches, merged into one branch that goes to `master` as one PR (owner's decision).
- One fix is still landing on `feat/sdk-2-7` and is merged in later: a per-design marker in the chip that
  gates linking from session events, so a chip from a deleted design cannot claim a new design with the
  same folder name (`documentation/specs/phase-1-5-sdk-2-7.md`, "As built").
- `npm run check` on `feat/phase-1-5`: see "Verification done".
- Version is still `0.1.0` in `package.json`; it becomes `0.2.0` before the owner tags the release.
- Needs OpenChamber 2.7.0 or later.

## What's built
Everything from v0.1 (rail navigator, full-screen page, pages with ZIP and single-file HTML export,
the canvas wall with pins, comments, versions, `/design`, `/page`, Open as page, design rules and
presets, thumbnails, theme-following UI), Phase 0 and Phase 1 (design checks and `dc check`, the build
strip, the ask bar, Send this, restore with Undo), and Phase 1.5:

| Feature | Where the user sees it | Doc |
|---|---|---|
| Instructions note and built-in `design-chamber` skill, no Settings install | every chat; Settings Agent skill row (Remove old copy) | [Agent discovery](features/agent-discovery.md), [Agent instructions](features/agent-instructions.md) |
| `design_check` agent tool (OpenCode plugin), launcher kept as fallback | the chat's tool card | [Design checks](features/design-checks.md) |
| A version after every agent turn with no window open, from session events | Versions drawer | [Turn snapshots](features/turn-snapshots.md) |
| Linking a `/design` or `/page` design to its chat from session events, with or without a project | Continue in chat, comments | `docs/SPEC.md` §10.5 |
| Designs section in Work Status, with Check and Open | the chat's Work Status | [Work Status](features/work-status.md) |
| `@` a design in the composer | the composer | [Design mentions](features/design-mentions.md) |
| DesignCard and DirectionPick chat blocks | agent replies | [Chat blocks](features/chat-blocks.md) |
| Keep your place across reloads | rail panel and page | `docs/SPEC.md` §10.12 |
| Install from the Git URL through a CI-built `release` branch | Settings → Extensions, README | `README.md` |

## Verification done
- Per-branch QA for every sibling and for PR 1; QA drift fixed (`browser` on checks, which folder is a
  project, Work Status Check reasons).
- Live in OpenChamber 2.7.0 on Linux: chats run through the Claude Code harness get the note, the skill,
  the blocks and `design_check` (as `mcp__openchamber__design_check`); blocks draw only from
  `root = Stack([...])` in an `openui-lang` fence; chats with no project live in
  `~/.config/openchamber/chats/<date>/session-<uuid>`.
- Accepted minor issues: `documentation/known-issues.md` (KI-12: a design linked at the very end of a
  turn misses that turn's event snapshot).

## Waiting on you
1. **The Phase 1.5 PR** from `feat/phase-1-5` to `master`, once the linking marker fix is merged in
   (pushing and opening the PR wait for your go-ahead).
2. **Release:** version `0.2.0`, then you tag `v0.2.0`, which runs `release.yml`. Exclude the `release`
   branch from the `master` protection rule first, or the workflow's push is refused.
3. **macOS and Windows:** `design_check` install layouts are covered by tests but not yet seen on a real
   machine (`docs/SPEC.md` F33); check before the release. macOS is not in CI: run `npm run check` on the
   Mac.
4. **Hand tests:** `docs/testing/FEDORA.md` and `docs/testing/MACOS.md`.
