# Design Chamber — Known Issues

Minor issues found in review and accepted for now. Each has a fix prompt: paste it to the
owning agent to fix it. **When an entry is fixed, delete it** in the same commit — this file
lists what is open, git history holds what was closed. Anything serious does not belong here;
it blocks the merge instead. Anything nobody can hit does not belong here either: an entry is
added only if it passes the 🟣 gate (who it reaches, seen or unseen, can it actually happen).

KI-2…KI-5 were fixed in the smoke fix round (2026-10-27); see `documentation/smoke/REPORT.md`.

### KI-6 — HTML first, then a design.json with screens but no "kind": shown as a page for good
🟣 Minor · found 2026-11-01 · `src/service/store.ts:185`, `src/shared/design-json.ts:522` · owner: fullstack-developer
**What:** when the provisional state (seeded as a page from `index.html`) adopts the agent's design.json and that file has `screens` but no `kind`, adoption takes `normalized.kind`, which `readInternal` already forced to the state's guessed `page`. The spec (§3.2 P2) says "else the inferred kind from `normalizeDesign`", which would be `canvas` (screens present). The same design.json written before `index.html` becomes a canvas, so the outcome depends on write order, the class of bug A2 fixed. Adding `"kind": "canvas"` later does not help: `index.html` exists, so the P5 switch is closed.
**Who:** end user · **Seen:** visible in UI: a page with the "its screen list is ignored" warning instead of the canvas the agent described
**Happens:** an agent without the slash command or guide writes `index.html`, then a design.json listing screens but omitting `kind` · rare · **Effect:** the screens never show; the user has to recreate the design
**Why not fixed now:** rare (every instruction channel says to set `kind`); the main incident (kind given) is fixed and covered by Q1.
**Fix prompt:**
> In `src/service/store.ts` `readInternal`, when the state on disk is provisional and design.json parses, normalise design.json for `agentDesign` without forcing `kind` (let `normalizeDesign` infer it from `raw.kind` or `screens`), so `adoptAgentFields` gets the agent's own inference (spec documentation/specs/agent-guidance-and-pages.md §3.2 P2). Keep the forced kind for `record.design` of a final state. Add to `test/service/core/design-json-race.test.ts`: index.html, reconcile (provisional), then design.json `{ title, screens: [{ id: 'home', title: 'Home', file: 'screens/home.html' }] }` with no kind, reconcile → kind `canvas`, one screen, no `screens-ignored` warning. Show the test red before the fix. Run `npm run check`.

### KI-7 — Em dashes left in user-facing sentences, one of them in the HTML-first flow
🟣 Minor · found 2026-11-01 · `src/service/store.ts:192` · owner: fullstack-developer (service, guest strings), ui-ux-developer (`src/ui` strings)
**What:** the owner's copy rule is no em dashes in app text. New strings in this branch follow it, but older user-visible sentences still use them. The most visible: "This design has no design.json yet — the agent may still write it." (`store.ts:192`), now shown on every design whose agent writes HTML first. Others: `src/guest/flows.ts:38` "Agent is busy — revision placed in the composer", `flows.ts:45`, `src/ui/model/versions-model.ts:51` "Viewing vN — read only", `src/ui/wall/wall.ts:673` and `src/ui/wall/design-view.ts:188` (tooltips), and ApiError sentences in `src/service/{paths,settings,uploads,render-cache,store,versions,reveal,root}.ts` and `src/service/routes/uploads.ts`.
**Who:** end user · **Seen:** visible in UI (warnings, toasts, banners, tooltips, error sentences)
**Happens:** common: the no-design-json warning appears for every HTML-first design · **Effect:** copy reads machine-written, against the owner's rule
**Why not fixed now:** copy-only, outside this branch's changed strings.
**Fix prompt:**
> Replace the em dash in every user-visible string (not code comments) with a full stop, comma, colon or semicolon so each reads as natural sentences. Find them with `grep -rn "—" src --include=*.ts | grep -vE "^\S+:\s*(//|\*|/\*)"` and skip `src/guest/fake-services.ts` sample content only if it never ships to users. Update any test asserting the old text. Run `npm run check`.

<!-- entry format:
### KI-1 — short title
🟣 Minor · found YYYY-MM-DD · `path/file.ext:line` · owner: agent-name
**What:** the issue, one or two sentences
**Who:** end user / admin / operator · **Seen:** visible in UI / silent — what it affects
**Happens:** the real action that triggers it · common / edge case / rare · **Effect:** what the person experiences
**Why not fixed now:** reason
**Fix prompt:**
> self-contained prompt for the owning agent: what to change, the test to add, the gates to run
-->
