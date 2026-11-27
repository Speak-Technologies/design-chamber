# Design Chamber: agent guide

## Product context
- an OpenChamber desktop-app extension that renders Claude-Design-style design canvases and full-screen HTML pages inside OpenChamber, from plain files the user's own chat agent writes to `~/Documents/Designs`
- Personas: **The OpenChamber user** (designer-developer who chats with an agent to produce designs and wants to see, comment on, version and export them without leaving OpenChamber) · **The chat agent** (the user's own agent in OpenChamber, the author of every design file)

<!-- team:start: rewritten by render-team.cjs on every run; edit .agents/team.json instead -->
## How we work
**Full process: `.agents/rules/claude-agent-protocol.md`: read it before your first task.**
(Claude Code loads it through `CLAUDE.md`; every other harness reads it explicitly.) The short version, which holds even if you read nothing else:

- **The main agent leads.** No project-manager agent: the session talking to the user plans,
  dispatches the specialists below, tracks their evidence and reports back. Prefer
  dispatching; a small, quick, single-discipline change with no risk surface may be done
  directly, after reading that specialist's file and following its rules and self-check.
- **Open permissions, user-gated actions.** Agents edit any file, run any command the task
  needs, and commit freely. They `git push`, open or merge PRs, deploy
  (publishing or releasing the extension (`npm publish`, tags, GitHub releases), `gh repo create`, `gh pr create` / `gh pr merge`, uninstalling or deleting any OpenChamber extension the agent did not install itself, deleting anything under `~/Documents/Designs` the agent did not create, `rm -rf` outside this repo, any edit to the OpenChamber source (`~/Documents/GitHub/openchamber`) or `~/Documents/GitHub/openchamber-design-canvas` (both read-only references)) or delete anything **only when the
  user has said so in this conversation**, and then without asking again. Not asked yet →
  finish, commit, offer the exact command. `.env` (if one is ever created; none is expected) may be read and updated;
  its values never reach a commit, a log or a report.
- **Stay in your lane.** Each agent focuses on what it owns (table below). A small adjacent
  edit the task needs is fine and is named in the report; anything larger goes to its owner.
- **Senior ladder before any code:** (1) does this need to exist? (2) already in this
  codebase, so reuse it; (3) does an installed dependency do it; (4) can it be one line;
  (5) only then the minimum that works, and **never** dropping error handling, graceful
  user-facing errors or any part of the user experience.
- **Evidence, not claims.** Gates are run and their output quoted. Unknown business rules are
  asked, never guessed.
- **Reports to the user:** Direct with technical summary depth, protocol §7 shape (outcome first, no preamble).

## Agent team
| Agent | Focus (owns) | Hands off to |
|---|---|---|
| **Main agent** (the session itself: no file) | Plans, dispatch, tracking, small direct changes; `AGENTS.md`, agent files, roadmaps; **shared root files**: `.agents/**` (incl. `team.json`; re-render after editing it), root `package.json` (with the extension manifest under `openchamber`), lockfile, `tsconfig.json`, `.gitignore`, the esbuild config (`scripts/build.mjs`), `scripts/pack.mjs`, `scripts/guest-check.mjs`, `.github/workflows/**`, `opencode.json`, `.claude/settings.json`; edited itself or assigned to one builder at a time | all agents |
| product-specialist | Requirement specs for features and flows (returned as a report; persisted to `documentation/specs/<feature>.md` on request); no code, no technical decisions | architect |
| architect | Technical designs and threat models; `documentation/specs/**`; keeps `docs/SPEC.md` current on the main agent's request; no production code | backend-developer, ui-ux-developer |
| backend-developer | All non-presentation code: `src/shared/**` (`types.ts`, `api.ts`, `limits.ts`, `bridge-protocol.ts`, `design-json.ts`, `agent/**`), `src/service/**` (`main.ts`, `http.ts`, `context.ts`, `routes/*.ts` and the lane modules), `src/guest/**` (host, service-client, changes, store, camera, frame-doc, `bridge/**`, anchoring, flows, `background-main.ts`, `globals.d.ts`), `src/cli/**`, `src/plugin/**`, `test/**` except `test/ui/**`; layout per `docs/SPEC.md` §12 | qa-tester |
| ui-ux-developer | Presentation: `src/ui/**` (`index.html`, `main.ts`, `styles.css`, `rail/**`, `page/**`, `wall/**`, `components/**`, `model/**`, `status/**`, `blocks/**`, `systems/**`: panel and page markup, styles, viewer chrome around the iframes) and `test/ui/**` (pure view-model tests and the visual harness scenarios); layout per `docs/SPEC.md` §12; carries the Design and Usability bars | qa-tester |
| qa-tester | Verification after M/L tasks, risk-surface changes and user-visible features; regression tests (`test/**`); 🟣 entries in `documentation/known-issues.md`; never fixes production code | main agent |
| browser-tester | Second QA step for changes the user sees: walks the changed flow in the visual harness or a folder-installed OpenChamber, always on a scratch designs root, rail 320 and 480 px and the full-screen page, dark and light, with screenshots | main agent |
| code-reviewer | Independent review of a diff, on the user's request; logs minor issues to `documentation/known-issues.md` | main agent |

Claude Code: agents live in `.claude/agents/*.md`, permissions in `.claude/settings.json`.
OpenCode: the same team in `.opencode/agents/*.md`, permissions in `opencode.json`; the main
agent is OpenCode's default `build` agent. When a convention changes, update both sets
together: same roster, same rules.
<!-- team:end -->

## Dev commands
- `npm run build`: runs `scripts/build.mjs` (esbuild) and writes `dist/panel/` (panel + page guest, IIFE), `dist/background/` (slash-command guest, IIFE), `dist/status/` and `dist/blocks/` (Work Status and chat-block frames), `dist/service/main.js` (Node ESM), `dist/cli/dc.mjs` (the agent's check command, Node ESM), `dist/plugin/` and `dist/skills/`. `dist/` is gitignored, so build before a folder install.
- `npm run typecheck`: `tsc --noEmit`, strict.
- `npm test`: `node --test --test-concurrency=1 "test/**/*.test.ts"` (Node ≥ 22.18 strips the types; one file: `node --test test/shared/design-json.test.ts`).
- `npm run check`: typecheck + build + test.
- `npm run guest-check`: the SDK's own package checker on the built manifest, HTML entries and service (run `npm run build` first); CI runs it after `npm run check`.
- `npm run pack`: release zip `design-chamber-<version>.zip` (run `npm run build` first; publishing it is user-gated).
- `node test/ui/visual/shoot.mjs <filter> --out <scratch folder>`: the visual harness (run `npm run build` first). It shows the built UI behind a mock host and the in-memory fake service, in headless Chrome, rail at 320 and 480 px and the page at 1400 px, dark and light; every `test/ui/visual/scenarios/*.mjs` runs, `<filter>` is a regex on the name. Not part of `npm test`. Always pass `--out`: the default writes into the tracked `documentation/pages/img/`. Chrome not at the usual path → set `DC_TEST_CHROME`.
- `node .agents/render.js`: re-render the agent team from `.agents/team.json` (the skill renderer, then the project fixes for em dashes and generic role and database wording), then run `node .agents/verify-team.cjs`. Only the `team:start` to `team:end` block of this file is regenerated; the rest is edited by hand.
- **Quality gates: `npm run typecheck` · `npm run build` · `npm test`: all three pass before any task is done; `npm run check` runs them together. No dev or watch command: there is no dev server by design (`docs/SPEC.md` §1); rebuild with `npm run build`.**

## Critical gotchas
- **Sources of truth:** `docs/BRIEF.md` (owner decisions; anything not listed there is open, so ask, don't guess; edit it only on the user's instruction) and `docs/SPEC.md` (the technical spec, the authority for architecture and lanes; changes go through the architect).
- **OpenChamber SDK `apiVersion: 1`, target OpenChamber >= 2.7.0 (SDK 2.8.1, pinned in `package.json`; raise `engines` only when a 2.8-only manifest key ships).** Reference docs: `node_modules/@openchamber/sdk/` (`API.md`, `GUEST_SERVICES.md`), or `~/Documents/GitHub/openchamber/packages/sdk/` when that checkout exists, read-only; verify an API there before using it.
- **Never declare `provides: ["browser"]`.** It would fight Design Canvas.
- **`openchamber-design-canvas` (v0.3.0, MIT, same owner) is a parts bin, not a base.** Reuse Chrome discovery, wall pan/zoom math, design-system precedence, prompt rules, presets and gates; do not inherit its external-Chrome-window + Vite-dev-server architecture. Read-only. Design Chamber is not that tool: rendering is in-app.
- **Agent-written HTML is untrusted.** It renders only in a sandboxed srcdoc/blob iframe with a CSP; never combine `allow-scripts` with `allow-same-origin`; `postMessage` source and origin are checked both ways; guests never see the bearer token or host bridge; agent HTML never goes into the host DOM.
- **The designs root is user data.** Default `~/Documents/Designs`, changeable (persisted setting); existing designs are never silently moved; every path is resolved and contained under the root before use. Tests and browser checks always run on a scratch root (`test/helpers/tmp-root.ts`, `DC_SETTINGS_PATH`, or a scratch folder applied in Settings and switched back afterwards), never on the real one.
- **Windows host.** Backslashes, drive letters and a case-insensitive filesystem make naive `startsWith` containment checks unsafe; use the one tested containment function (`resolveInside` in `src/service/paths.ts`, comparisons in `src/shared/path-compare.ts`).
- **Guests are IIFE bundles** (esbuild): no runtime ESM imports, no dev server.
- **No dev server, so a UI change is seen in the visual harness or a folder install.** The harness (`test/ui/visual/shoot.mjs`, Dev commands) runs the built UI on a fake service; folder-installing this extension into the user's running OpenChamber for smoke tests is allowed (`docs/BRIEF.md`; steps in `documentation/smoke/REPORT.md` and the browser-tester file).
- **`rules/**` (design-rules content: bundled presets and agent instructions) is written by a separate rules author**, not by this roster: read it, don't edit it unless the task is about it.
- **The WP0 interface files change only through the main agent**, who notifies every lane (`docs/SPEC.md` §14): `src/shared/{types,api,limits,bridge-protocol,design-json}.ts` and `src/service/{main,http,context}.ts`. Files two builders both touch (the panel/page entry `src/ui/main.ts`, shared types the UI imports) are sequenced by the main agent. The layout is `docs/SPEC.md` §12; if it and this file disagree, the spec wins.
- **Process:** GitHub repo `design-chamber` (public, MIT), default branch `master`, protected: no direct pushes. Work on a branch, open a PR (template in `.github/`); CI (Ubuntu, Windows, Fedora; `.github/workflows/ci.yml`) must pass and 1 approval is required; only the owner merges (bypass). Head branches auto-delete. macOS is not in CI: run `npm run check` on a Mac for macOS-affecting changes. Pushing a branch and opening a PR are still user-gated (protocol §6).
- **`.env` is not expected.** If one is ever created it may be read and updated; its values never reach a commit, a log or a report.

## Architecture
Authority: `docs/SPEC.md` (changes go through the architect); this section is a summary.
- Rail `panel` = navigator; full-screen `page` = viewer/canvas; both sandboxed-iframe guests of the OpenChamber extension host, fed by the extension's local Node `service` (loopback, bearer-authenticated).
- Storage: one folder per item, `Designs/<slug>/` with `design.json` (`kind: "page" | "canvas"`; old `"artifact"` reads as a page; title, created/updated, linked `sessionId`, viewports, screens, comments), `index.html` (page) or `screens/*.html` (canvas), `assets/`, `DESIGN.md` + `tokens.css`, `.versions/`.
- Design systems (Phase 2.5): a system lives in `Designs/_systems/<id>/` (internal) or in the project repo with a generated living page (repo-backed, the repo is the source of truth). Each design keeps its own copy in `<design>/system/` (copy-on-link) with overrides and "Reset to system". The service never writes a project repo; only the agent does, after the user approves a reviewed diff in the system's chat. `/design-system` + the `design-system-builder` skill build a system; designs group by project and manual folders (`docs/SPEC.md` §6.7 to §6.9).
- The chat agent writes the files; the service watches the folder and the UI refreshes live. `/design <brief>` (canvas) and `/page <brief>` attach the design rules, target folder and `design.json` contract to any chat.
- Agents without the slash command find Design Chamber through `<root>/AGENTS.md` (a guide the service keeps current, never over a user-edited file) and an optional `design-chamber` skill installed from Settings (spec: `documentation/specs/agent-guidance-and-pages.md`).
- Thumbnails: headless-Chrome PNGs cached on change; fallback to a live mini-iframe when Chrome is missing.
- Checks: the agent runs `dc check <slug>` through a launcher the service writes in `<root>/.chamber/bin/` (no token; renders every artboard offline in headless Chrome over a pipe, writes `.chamber/check.json` and PNGs); the viewer shows a Checks badge with "Ask the agent to fix" (`docs/SPEC.md` §9.9).
- Review loop: a build strip shows what the linked agent is doing, an ask bar under the wall sends the user's words (optionally about one element) to the linked chat, pins can be sent one at a time, and a restore offers Undo instead of a confirm (`docs/SPEC.md` §13.3).

## Business rules
Product decisions are in `docs/BRIEF.md`; anything not listed there is open: ask, never guess.

| Topic | Rule |
|---|---|
| Design-rules precedence (highest first) | 1 the user's words in chat · 2 the active project's design rules (DESIGN.md, token/theme files, AGENTS.md / CLAUDE.md design sections, existing breakpoints). A new design for a project uses the project by default: its own Ready design system if it has one, else its design files, components and screens; a per-project choice or the New dialog's pick overrides it, and the global default applies only when the project has neither · 3 chosen bundled style preset · 4 per-design `DESIGN.md` + `tokens.css` once confirmed · 5 built-in anti-slop rules |
| Default viewports | Laptop 1280×800, Phone 390×844; derive from the project first; ask when unsure |
| Page export | ZIP (html + assets) and single-file HTML (assets inlined) |
| Design canvas | infinite wall, pan/zoom, multiple screens × viewports as artboards; Edit/Play modes; element-anchored comment pins (selector/snippet travels with the comment); "send comments" = one revision request to the linked chat; version snapshot per agent turn, compare/restore |
| Linked chat | each design remembers its `sessionId`; "Continue in chat" reopens it; new chat if none/gone |

## UI
- **Design direction:** native fidelity. The extension must look like part of OpenChamber in the rail panel (320 to 480 px) and the full-screen page: host theme tokens and the `@openchamber/sdk/ui` kit, no palette or typeface of our own. Colours follow the active OpenChamber theme live.
- Tokens: the OpenChamber host theme tokens (`ready.theme.tokens`, applied as `--oc-*` CSS variables) and the `@openchamber/sdk/ui` kit look (`--oc-sdk-*`), spacing from `--dc-s1` to `--dc-s6` in `src/ui/styles.css`; never a raw hex or a one-off size (a design's own `tokens.css` is design content for the guest, not host chrome) · Colors: from the host theme · Type: from the host theme
- Core flows (each has a step budget): browse the designs list → open a page and export ZIP/HTML · open a design canvas wall → pan/zoom · add a comment pin → send it to chat · restore a version · change the designs folder
- Glossary (one term per concept): **design** = an item folder; **page** = a single HTML page design shown full screen (formerly "artifact"); **canvas** = a multi-screen design wall; **screen** = one page of a canvas; **viewport** = a device size; **artboard** = a screen at a viewport; **pin** = an element-anchored comment; **version** = a snapshot
- Copy: plain words, no em dash in any text a user or an agent reads (`test/copy-no-em-dash.test.ts` scans every string under `src/`)
- Controls from the `@openchamber/sdk/ui` kit; breakpoints are n/a in the web sense; verify at the rail-panel width (320 and 480 px) and the full-screen page, in light and dark
- Load the `frontend-design` skill before any UI work.
- Generic-looking or hard-to-use UI is a defect here: the Design bar and Usability bar in the
  UI developer's agent file apply to every screen, whoever builds it.

## Local service
- Loopback-only (127.0.0.1), bearer-authenticated; the host passes the port and token in `OPENCHAMBER_SERVICE_PORT` / `OPENCHAMBER_SERVICE_TOKEN`; routes are `docs/SPEC.md` §7, typed in `src/shared/api.ts`.
- Every path is contained under the designs root (`resolveInside` in `src/service/paths.ts`) before any read or write; every route checks the bearer token (`src/service/http.ts`).
- Mutations (writes, restores, exports, settings) are service routes called by the panel and page; guest iframes never get the token or a route.
- `DC_SETTINGS_PATH` points the service at another settings file (a test seam; the host never passes it), which is how a test or a local check gets its own designs root (`test/helpers/service-process.ts`).
- Deploy-type commands (publish, release, `gh repo create`, PRs, push) wait for the user's go-ahead.

## Documentation
Plain-English living docs in `documentation/` (protocol §4): `README.md` index +
`pages/<page>.md` + `features/<feature>.md` + `known-issues.md`. Updated by whoever makes the
change, confirmed by the main agent before any feature is Done; qa-tester verifies.
