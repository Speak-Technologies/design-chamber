# Phase 2.5 design systems — independent review (Opus 5.5 medium, 2026-11-19)

Scope: the requirements spec (`phase-2-5-design-systems.md`), the technical design
(`phase-2-5-technical.md`, AD-1..AD-24) and the mockups (`~/Documents/Designs/phase-2-5-system-ui`).
Review only; no files were changed by the reviewer. Owner decisions are treated as settled.

## Verdict

**Not ready to build yet.** It is close. The core architecture is sound and grounded in the code:
two homes behind one `filesDir` resolver; the service stays read-only on repos with a guard and a
fixture test; build tickets tie every repo read to the folder the command ran in; the living page is
built from an allowlist and checked by a scan. The claims spot-checked against `src/` hold, except the
skill text cap (T-6 below).

What must change before T0:
1. Add the chat-block decision (Approve/Decline) to both specs, with a spike.
2. Fix four places where the requirements spec contradicts the settled owner decisions.
3. Close three flow gaps: a declined diff in a repo home, the folder being fixed too early, and the
   living page not existing when the user approves the diff.
4. Harden the living-page sanitiser.
5. Redraw the interview and diff screens as real blocks, because the current approval bar cannot be built.

Everything else can be fixed during the build.

## Target 1 — the specs

### Contradictions with the owner decisions
- 🟠 RS `:1115-1120` — the repo re-sync sheet still has "New (ticked), No longer in the code (unticked,
  tick to remove)", contradicting the confirmed all-or-nothing decision (Q-S8-1). Technical §7.4:1503 says
  it replaces this line, but the requirements file was never edited. A builder reading the requirements
  would build ticks.
- 🟠 RS `:1010-1013` and `:932-934` — the Draft "appears… while Design Chamber scans the repo" after the
  diff is applied. The confirmed decision (Q-S8-2) is that the Draft appears after round one. Line 932
  should say "until round one is answered".
- 🟠 RS `:956`, technical §8.9:1711, mockup `build-interview` — the round-one label is "Describe only,
  never touch the repo". Round-2 answer 1 says describe-only still creates new files in the repo. A user
  who picks "never touch the repo" then gets a diff that writes to the repo. The technical wording is
  right; the requirements and the mockup are not.
- 🟡 RS `:1008` "(Q2 settles…)", `:1105-1107` "(Q1 settles whether…)" — placeholders for resolved
  questions. Replace with the resolved rule.
- 🟡 RS `:1462` (SDK "NOT FOUND, verify"), `:1467-1480` (open questions the technical spec now answers, a
  renumbering note that is done), `:1482-1484` and `:1501` (handoff still says "relay the 3 round-2
  questions") — stale text. Mark resolved and point to the technical sections.
- 🟡 RS `:946` "A system chip appears in the chat when the system is created" — technical §9.6 does this
  differently: the build chip resolves to the system when the rail polls the ticket. The requirements line
  should say that.
- 🔵 Cross-references fixed and correct (RS §10 citations at 1010, 1438, 2341; "§20 lists" at 6).

### Flow gaps (edge cases, failure and recovery)
- 🟠 AD-15 / §5.9 step 3 vs RS `:999-1000` — **the repo folder is fixed too early.** `BUILD.json` (folder
  and living-page path) is adopted after round one and any later change is refused as `home-changed`. The
  requirements say the user can change the folder "in the interview or the diff". So "put it in
  `docs/system`" at the diff ends in a permanent build problem. Fix: keep `repo.folder` and `livingPage`
  editable until the first `applied` stamp, re-running `verifyRepoHome` on each change.
- 🟠 RS `:1092-1097`, technical §8.8 item 5 — **a declined diff in a repo home has no valid way forward.**
  "Continue describe-only" still needs new files in the repo (a fresh diff); the skill text "set mode
  describe and continue" can be read as "write the new files without asking again" (a repo write after a
  decline). If the user wants nothing in the repo, the home would have to become internal, which AD-15
  forbids, so the Draft stays "Being built in chat" forever. Fix: describe-only after a decline means a
  new, new-files-only diff; allow the home to change while nothing has been applied; or "Stop" deletes the
  never-applied Draft, with Undo.
- 🟠 RS `:1076-1077` vs technical §8.8 item 5/7 and `forApplied` — **the user approves a living page that
  doesn't exist yet.** The requirements say the diff shows the generated page "so the user can judge it";
  the technical design generates it only after the files land, from the snapshot; the mockup shows
  `index.html` "generated from revision 1, 412 KB" inside the diff. Pick one: (a) generate a preview from
  the agent's proposed files before approval, or (b) list the page as "generated after the files land" and
  preview before the commit. Either way add an in-app preview: render the staged page in the standard
  sandboxed viewer frame (script-free, so safe; Claude shows its living page). Today the only action is
  "Reveal".
- 🟠 §2.14 self-hash, §5.11 `state()` — **Windows line endings mark a fresh page as Changed.** The
  self-hash is over raw bytes; with `core.autocrlf=true` (Windows default) a checkout rewrites LF to CRLF
  and the state flips to Changed for good. Formatters/pre-commit hooks do the same. Fix: hash content with
  line endings normalised; when the revision is current but only the hash differs, say "may have been
  reformatted" instead of the warning wording.
- 🟠 §7.4 Undo vs Q-S8-1 / AD-20 — **Undo after a repo re-sync breaks all-or-nothing.** Restoring "Before
  re-sync" into `snapshot/` makes Design Chamber show values the repo no longer has (the second authority
  the owner ruled out). Fix: no Undo for a repo re-sync ("Not now" before Apply is the choice), or Undo
  leaves a "behind shop" banner.
- 🟠 §5.12 drift vs the reference flow — **drift detection can't see Tailwind projects (the reference
  case).** `codeDrift` compares same-name CSS custom properties only, so Tailwind stock-palette usage never
  counts; "the code no longer matches" never fires and the describe-only finding reads 0 when the code
  differs. Fix: say in the UI and finding what is compared ("CSS variables and token JSON only"), or let
  the agent report drift in `BUILD.json`.
- 🟠 Requirements and technical, fix mode — **"fix tokens" scope is undefined.** Not said whether fix mode
  changes only token definitions (CSS variables, token JSON, Tailwind theme config) or also rewrites usages
  ("214 uses in 38 files"). This sets the diff size and whether it fits a chat block. Recommend:
  definitions by default; usage rewrites only when listed per file in the diff, large rewrites summarised
  as counts per file.
- 🟡 §8.8 item 7 — "wait until `living-page.json` has `forApplied`" has no time limit. Wait up to ~30 s,
  else end the turn with "ask me to commit the living page" (the "Ask the agent to update it" path).
- 🟡 §5.9 step 4 — if the agent never stamps `applied`, nothing is read and the system stays "Being built".
  State that the user's Re-sync works on a repo home with no snapshot, as recovery.
- 🟡 Skill text — the builder skill is listed to every agent with a broad description. A coding agent asked
  to "document our design system" outside the flow will start the interview, write `BUILD.json` with no
  ticket, and hit `ticket-needed`. Add: "No ticket file → ask the user to run /design-system."
- 🔵 Ticket binding — a chat opened in `apps/web` of a monorepo can't use the monorepo root. Make the
  refusal sentence explain what to do.
- 🔵 Name collision — a user-installed skill called `design-system` would silently hide our command (the
  host only warns in the console). Add a troubleshooting line.

### Feasibility against the code
- 🟠 §8.8 / §2.12 "≤ `SKILL_TEXT_MAX`, asserted by test" — **the cap is the wrong constant.**
  `SKILL_TEXT_MAX = 6000` (`limits.ts:249`) is only for the old Settings-installed skill (`guide.ts:250`).
  The bundled skill has no cap: `skill-doc.ts` has none, and `dist/skills/design-chamber/SKILL.md` is
  22,884 bytes today. The builder skill inlines `SYSTEM-QUESTIONS.md`, the whole file contract and 11
  sections, so 6,000 characters will very likely fail T15. The SP-3 fallback ("append to the
  design-chamber skill under the same cap") has the same problem. Define a new `SYSTEM_SKILL_TEXT_MAX`,
  around 24,000.
- 🔵 §1 facts verified: `host-calls.ts:36` sends `setInstructions(null, text)`, `context.ts:201` takes text
  only; `flows.ts:414-427` maps design/page else `unknown-command`; `package.json` has 2 commands and
  `skills: "dist/skills"`; `bundle.ts:1-16` leaves external refs and scripts as written; discovery caps
  4/3000/1500 at `limits.ts:265-267`, `SKIP_DIRS` private (`discovery.ts:68`); `build.mjs:32,153-157` writes
  one skill and asserts its name; `ChipData = { slug, kind }` at `types.ts:431`.
- 🟡 §18 — T12, T13, T14 are each sized L; the protocol says "L — split it". T12 (tickets, adoption, flows,
  reveal, read-only refusals) splits into tickets+command and adoption+refusals.
- 🟡 §18 S8 shared-file order — the chain puts T8 after T14 although they share no files; T8 only follows
  T12 (`session-links.ts`). As written the core instructions work (S6) waits on the living page for nothing.
- 🔵 T0 — the manifest command lands in T0 but its flows branch in T12; in between `/design-system` shows in
  the composer and throws `unknown-command`. Fine on a branch; worth knowing for smoke tests.

### Security and threat model
- 🟠 §5.11 `staticExample`/`staticCss`, `scanLivingPage` — **the sanitiser can be fooled by a parser
  mismatch.** It uses the bundler's "deliberately tolerant" tokenizer (`bundle.ts:14`), not the browser's
  HTML parser, and keeps `style` and inline `svg`. Inside SVG, `<style>` is not raw text in the browser, so
  this agent-written (injection-steerable) example gets through:
  `<svg><style><img src=x onerror=…></style></svg>`. The tokenizer reads the `img` as CSS text and
  re-serialises it unchanged; the scanner (same tokenizer) answers "safe"; the browser builds a real `img`
  with `onerror` on a page served outside any sandbox — XSS on the org's Pages domain. Fixes: (1)
  `staticCss` refuses any `<` and output always escapes text; (2) no `style` inside `svg`; (3) the scanner
  becomes an allowlist (exactly what the generator can produce), not a denylist; (4) the headless-Chrome
  e2e runs hostile fixtures too. Senior-ladder alternative: render component examples to PNGs with the
  existing headless-Chrome thumbnail pipeline and embed them as `data:image` — then no agent markup ever
  reaches an unsandboxed page and the allowlist work goes away.
- 🟠 §11.6 secrets — secrets are only avoided by file name (`.env*`, keys). An agent can copy a key from
  config into `notes/*.md` or an example, and a public living page publishes it. Fix: a pure check for
  high-confidence secret shapes (`AKIA…`, `ghp_…`, `sk-…`, PEM headers) over the generated page; a finding,
  and refuse to stage when `access: "public"`.
- 🟡 Font licences — a caution plus a footer only. Safer default: embed fonts only when `access` is `dev`;
  public pages use the fallback unless the user opts in. The mockup's living page lacks the footer line
  §11.6 requires ("Fonts are embedded; check their licences before publishing."; 0 matches for "licen").
- 🔵 Good — ticket binding against injected scan redirection, refusal to overwrite an unmarked living-page
  path, `redactLocalPaths`, the path-free reveal form, and the fixture test that the repo is unchanged
  (with Windows CI) are solid. Add a case where the agent stamps `applied` with `parts` it never wrote.

### Claude parity
- 🟠 The living page can't be viewed in the app (Claude shows it) — see the preview fix.
- 🟠 The interview isn't interactive (Claude uses option widgets) — the new block decision, below.
- 🔵 The system's name is never asked; have the skill derive it from the project and state it as an assumption.
- 🔵 If the user turns dark mode on, no round-two call covers it (derive dark values or hand-tune them).
- 🔵 Otherwise rounds one and two match the reference.

## B. New decision: interview and diff as chat blocks (in neither spec yet)

Facts from the installed SDK (`DOCUMENTATION.md:43`, `:309`, `dist/manifest.js`):
- Blocks per extension: 4 (2 used today: DesignCard, DirectionPick).
- Arguments: 8, 16,000 characters in total, written by the model, untrusted.
- Answer: ≤ 2,000 characters, one per block, refused without a user click. A note on its own also counts as an answer.
- Height: ≤ 960 px.

Findings:
- 🔴 No spec text exists. Add RS decision S8-13, technical AD-25, the manifest `contributes.blocks` entries
  (main agent, T0), new tasks (service read route; UI blocks in `src/ui/blocks/`), and spike SP-4. SP-4
  covers: the `answerBlock` round trip, a multi-question form, internal scroll under 960 px, what a
  note-only answer means, hosts that can't take an answer, and a block inside a session started by "Build
  with the agent…".
- 🟠 Block budget — two new blocks use up the cap of 4, leaving no room for a SystemCard later. Recommend
  ONE `SystemAsk` block with a `kind` argument (interview-1, interview-2, diff).
- 🟠 The diff doesn't fit in arguments (a real diff is far over 16,000 characters). Recommend: the agent
  writes the proposal to a file (`_systems/<id>/PROPOSAL.json` with the file list, change summary per file,
  patch text up to a cap, the way back, and a hash). The block gets `systemId` and `proposalId`, reads the
  file through a new service route, and shows it. The full diff stays in the agent's text; the block is
  where the decision is made, not where the reading happens. This works because the Draft exists after
  round one (Q-S8-2). Round one has no system yet, so that block takes `ticket`.
- 🟠 Stale approvals — a user can scroll up and click Approve on an old diff card after a newer diff
  replaced it. Bind the approval to the proposal: the answer text is "Approve proposal p_… (parts: …)"; the
  skill refuses an approval for a superseded proposal id.
- 🟠 Meaning of each answer — the skill must spell out: a block Approve answer, or the user's typed words,
  is approval. A note alone is NEVER approval (it counts as "changes requested"). Decline offers "Describe
  only instead" or "Stop" as buttons on the same block (one answer per block). Partial approval needs a
  toggle per part, using the `applied.parts` names. A typed reply always stays valid as the fallback.
- 🟡 Who owns the wording — round-one questions are fixed text owned by the rules author
  (`SYSTEM-QUESTIONS.md`). If the block hard-codes them, the same copy lives in two places. Feed the block
  from the build (as the skill inlines the file), or pass the labels as arguments.
- 🟡 Host instructions — the block description goes to every agent. Scope it ("only in a
  design-system-builder chat"), or other coding agents will use it for ordinary diffs.
- 🔵 Gate still a chat approval — the host's user-activation rule makes a block approval stronger than a
  typed "go" (injected text can't click). State this in §11.6.

## Target 2 — the mockups (`phase-2-5-system-ui`)

What works: host chrome is clean of raw colours (the px font sizes in `ui.css` are all Tidepool content:
`.tp-amount`, `.logo-word`, `.voice-quote`). Light and dark both read as OpenChamber. One primary per view
(Mark ready on Draft, none on Ready, Approve on the diff). The read-only repo panel, the living-page card
and the "Your ask becomes a diff" caption follow the spec closely. The living page is distinctive, branded,
no scripts.

Findings:
- 🔴 `build-diff`, `build-diff-describe` (both viewports) — the fixed approval bar above the composer can't
  be built. A block is a frame inside the reply and can't pin itself over the host composer. Redraw as a
  block: summary header, files collapsible one by one with +/− counts, a sticky footer INSIDE the frame
  with Decline, Approve and per-part toggles, and an answered state ("You approved 3 files · proposal p_…").
  On phone, check the footer stays reachable inside a 960 px frame.
- 🟠 `build-interview`, `-2` — static cards; the alternatives are muted captions ("or In Design Chamber",
  "Keep the stock set"), not choices you can pick. Redraw with option controls (radios, coverage
  checkboxes), a "Go with these" button, the host's note field, and an answered state. "Custom" is missing
  from the status-colour options. "R1/R2" in mono is cryptic (the subtitle already says "Round 1 of 2").
- 🟠 `build-diff`, `build-diff-describe` — they show `index.html` "generated from revision 1, 412 KB" inside
  the diff, conflicting with §8.8 (the living-page gap). The describe-only `system.json` shows `home`,
  `repo`, `revision`, `colours` — by the contract those belong in `BUILD.json` or `state.json` (AD-2,
  §2.13), and values in `tokens.css`. The describe-only diff also leaves out `tokens.css` and `OVERVIEW.md`.
  A skill author copying this would write the wrong contract.
- 🟠 All phone system pages — touch targets: section rows and area heads are 34 px (`ui.css:2494-2497`);
  chips and tabs ~28 px. DESIGN.md claims 44 px, but that only holds for the primary buttons.
- 🟠 `system-page-*@phone` — the specimen board shrinks to a ~120 px strip that cuts off mid-sentence; the
  phone view is effectively panel only. Add a Board / Sections switch (`.oc-segmented`) so the board can be
  judged on a phone.
- 🟡 All system pages — the panel says "4 of 11 reviewed" and has no Assets section. The technical spec has
  12 sections, with Assets under Brand & marketing. The phone tab says "Brand" where the glossary term is
  "Brand & marketing".
- 🟡 Accordion — areas with one section (Components, Patterns & voice) expand into a duplicate child row
  with the same name. Select directly, no child row.
- 🟡 Review footer — the state label "✓ Looks good" sits next to a "Looks good" button, and "Looks good ·
  reviewed 2 hours ago" repeats it above. When the section already looks good, show the state once and
  offer only Needs work.
- 🟡 Board — review states drawn inside the sandboxed board mean the board regenerates on every review
  click. Keep review state in the panel only.
- 🟡 Content — round 2 says "Inter appears in 176 places"; the diff says "Seravek carries the product".
  "Iowan Old Style" is an Apple system font with no file to embed (should trigger the "No font file for…"
  state). A Tailwind stock-palette finding is then fixed with `--tp-*` CSS variables. Make the story
  consistent (it is the reference flow).
- 🟡 `living-page` — "The values below are the ones the code uses" is false in describe-only; the copy must
  change with the mode. The licence footer line is missing.
- 🔵 `system-page-dark` — "Review the 2" on the Ready notice is a good addition; add it to the requirements.

### Screens not drawn: specified well enough?
- Clear enough to build from text: systems list rows, the New design system sheet, the empty list, the
  loading skeleton, the unreadable system, the service-down state, the versions drawer (exact sentences and
  actions; kit states).
- Too risky to leave undrawn: the systems list at 360 px with every badge at once (Default, Pinned, Changes
  to review, the home line, Being built, the shared-repo notice); the build chip's rail states (waiting /
  made / expired); the repo re-sync sheet without ticks; the living-page card in Missing, Changed, Unsafe
  and "couldn't generate"; how banners stack when several apply (repo can't be read, tampered snapshot,
  drift, build problem) — no order is specified, a spec gap.

## What to change, in order

### Spec changes (before T0)
1. Requirements (product specialist): fix the four contradictions (re-sync ticks, Draft timing, the
   describe-only label, the Q placeholders); clear the stale open questions and handoff; add S8-13
   (blocks), the folder-editable-until-applied rule, the declined-diff outcome in a repo home, the
   living-page preview, and the order banners stack in.
2. Technical (architect): AD-25 and the block flow (one `SystemAsk` block, proposal file and route, binding
   approval to the proposal, answer meanings, SP-4); `repo.folder`/`livingPage` editable until `applied`;
   the decline path and changing home before anything is applied; the living-page preview (generate before
   approval, or after with a preview, rendered in the sandboxed frame); hash over normalised line endings;
   no Undo on a repo re-sync (or a "behind" banner); harden the sanitiser (no `<` in CSS, no `style` in
   `svg`, an allowlist scanner, hostile fixtures in Chrome e2e) or switch to PNG examples; the secret-shape
   scan on the page; `SYSTEM_SKILL_TEXT_MAX` in place of `SKILL_TEXT_MAX`; the fix-mode scope and drift
   honest about Tailwind; the bounded wait for `forApplied`; Re-sync as recovery while "Being built"; split
   T12 and unchain T8 from T14.
3. Rules author (R1): use the label "Describe only, never change the app's code" (already right in the
   technical spec) and add the no-ticket line to the skill text.

### Design changes (ui-ux, after the spec lines above)
1. Redraw the interview (rounds 1 and 2) and the diff (fix and describe) as `SystemAsk` blocks:
   interactive, a footer inside the frame, toggles per part, answered states, phone versions.
2. Fix the diff contents to the real contract (`BUILD.json` vs `system.json`; `tokens.css` and `OVERVIEW.md`
   present; the living page shown as "generated after the files land" or as a preview, whichever the spec
   picks).
3. Phone: 44 px targets, the Board / Sections switch, "Brand & marketing" spelled out.
4. Add the Assets section (12 sections). Remove the duplicate single-section rows and the duplicated review
   state.
5. Make the story consistent (one font story, a Tailwind-based fix). Make the living-page copy depend on the
   mode, and add the licence footer.
6. Draw: the systems list at 360 px with every badge, the build-chip rail states, the repo re-sync sheet,
   the living-page card in every state, banner stacking, and a living-page preview.

### Can wait until the build
The 🟡 and 🔵 items not listed above: monorepo refusal wording, the troubleshooting line for a hidden
command, the name assumption, dark-mode calls, and the block description wording.
