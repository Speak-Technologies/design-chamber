# Phase 2 · Edit on the canvas: requirements spec

Product spec by the product specialist, 2026-11-11, branch `feat/phase-2`. It covers the whole phase, with a
section per feature. It says **what** each feature must do; the architect decides **how** (`docs/SPEC.md`
stays the authority for architecture and lanes).

Sources: the owner's review (`~/Documents/Designs/design-chamber-review`, roadmap "Phase 2 · edit on the
canvas" and "Where to start" #1, read as data), `docs/BRIEF.md`, `docs/SPEC.md` §6.2 to §6.4, §8.3, §9.5,
§9.9, §10, §13, `documentation/STATUS.md`, `documentation/features/chat-blocks.md`, and the code named in
each section. The roadmap's architectural direction (the page owns edits and the frame only reports
clicks; a service route patches the source in place, saves a version first and refuses when the agent
changed the file; tweaks write `tokens.css` only; page data lives in `.chamber/page-state.json`) is owner
direction and is treated as a given.

---

## 0. Phase overview

**Overview.** Phase 2 turns the wall from a gallery into a canvas: the user fixes text in place, tunes
the design's tokens with sliders, adds, orders, copies and removes screens, keeps one of several
directions, and pages that save ticks and filters keep them across reloads. One small check bug is fixed
first because it sends agents after problems that are not there.

| # | Feature | Effort | Depends on | Section |
|---|---|---|---|---|
| C1 | False "text overlap" warnings in the design check | S | none | §1 |
| 07 | Edit authority and patch route (rules every user edit follows) | L, spec first | none | §2 |
| 08 | Edit text in place, selection toolbar | M | 07 | §3 |
| 09 | Tweaks panel | M | follows the 07 user-edit rules, needs no HTML patching | §4 |
| 10 | Screen management | M | 07 (shared screen list, Q1 decided) | §5 |
| 11 | Variations you can pick from (canvas half) | M | 07, 10 (Q2 decided) | §6 |
| 19 | Pages that remember their state | M, spec first | none (Q3 decided) | §7 |

**Recommended build order.**
1. **C1** at once (S, no dependency, the review's "start here").
2. In parallel: the architect designs **07** and **19** (both spec first); a builder does **09**, whose
   writes follow the user-edit rules in §2.3 but need no HTML patcher.
3. **10** once Q1 is answered (it settles who may write the screen list, which 11 also needs).
4. **08** once 07's design is built.
5. **11** last (needs 07's write path and 10's screen-list rules).

**Cross-cutting.** Every write a user makes by hand (08, 09, 10, 11) follows the user-edit rules in
§2.3: saved only from a click or key press in Design Chamber's own controls, a version first, refused
when the file changed since the user's view of it, the smallest possible change, Undo, and the build
strip does not read the user's own write as the agent's. 19 is not a user edit of design files: it never
touches the design's files or versions. The agent is told about hand edits (Q5, decided): the next
message to the linked chat starts with a short list of what changed by hand since the last one; nothing
is sent on its own.

**Two wording clarifications confirmed by the main agent (2026-11-11), matching the architect's
defaults (technical design §19):**
- The screen-list stale rule (10-4) reads "the agent changed `design.json`" as "the agent changed the
  screen list or a screen file this action touches". A change to the title, `updated`, viewports or
  comments does not refuse a screen action (else adding a comment would block a reorder until reload).
  This matches §5's own acceptance criteria ("The screen list changed while you were working").
- One new disabled-reason sentence for text the scanner can't place with certainty (implied end tags,
  unknown entities): "Design Chamber can't find this text in the file exactly. Ask the agent to change
  it." Added to §3 above; it follows E2's "refuse rather than guess".

**Contract changes the phase brings** (each goes through the main agent: they touch the WP0 interface
files, `docs/SPEC.md` §14): `design.json` gains tweak knobs (09) and direction marks (11); who writes
`screens[]` changes (10, Q1); versions gain user-edit reasons; the agent instructions and `rules/**`
need new text (09 knobs, 11 directions, 19 "saved page data now works", and "re-read a file before you
edit it"). `rules/DESIGN-RULES.md:99` and `src/shared/agent/rules-doc.ts:266` currently tell agents not
to assume localStorage, which 19 reverses; that text is the rules author's to change.

---

## 1. C1 · False "text overlap" warnings in the design check

### Overview
`dc check`, `design_check` and the Checks badge report "two pieces of text overlap" where nothing
overlaps (10 false warnings on the review page). Agents chase them and a clean design shows issues. Fix
what counts as an overlap, and stop judging text nobody can see.

### User Stories
- As the user, I want the Checks badge to say "No issues" on a design that looks right, so that I trust
  it when it does show something.
- As the chat agent, I want every overlap warning to be real, so that I do not rewrite good layout.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| C1-1 | Overlap is judged on the boxes text actually paints, line by line, not one box around all of an element's text | A wrapped inline element's one big box covers text it never touches (verified: `probe.ts:38-55` unions every text node into one box) | 2026-11-11 |
| C1-2 | A text and text inside one of its own descendants (or ancestors) never count as an overlap, whatever their geometry | `<code>`, `<b>`, `<a>` inside a paragraph sit in its flow by definition; today only geometric containment is skipped (`analyze.ts:158-166`) | 2026-11-11 |
| C1-3 | Visually hidden text (screen-reader-only patterns) is left out of every *visual* text verdict: overlap, clipped text and contrast | Nobody sees it, so none of the three can be a visual defect; a `sr-only` header has `overflow:hidden` on a 1 px box, which also trips the clipped-text rule (`probe.ts:88-92`) | 2026-11-11 |
| C1-4 | Accessibility checks that are not visual (missing alt, labels, button names) are unchanged | They are about meaning, and hidden text can be the fix for them | 2026-11-11 |

### Acceptance Criteria
- [ ] Inline `code`, `b`, `strong`, `em`, `a`, `span` with padding, background or border inside a
      paragraph, list item or table cell give no overlap warning.
- [ ] An inline element that wraps over two or more lines gives no overlap warning against its own
      paragraph text or against siblings on the same lines that do not paint over it.
- [ ] Text hidden with the usual screen-reader-only patterns (a 1×1 px box with `overflow:hidden`;
      `clip: rect(0 0 0 0)` or `clip-path: inset(50%)`; fully outside a clipping ancestor; `opacity: 0`)
      gives no overlap, clipped-text or contrast finding.
- [ ] Real overlaps are still found: an absolutely positioned caption over a heading, two grid or flex
      items pulled onto each other by negative margins, and text over sibling text through `transform`.
      Each gives one warning naming one of the two elements.
- [ ] The 30% share rule (`OVERLAP_MIN_SHARE`), the fixed/sticky exemption and the per-code cap keep
      working as today (existing tests in `test/service/check/color-analyze.test.ts:107-116` still pass).
- [ ] A copy of the review page's HTML kept as a test fixture in the repo (never read from the user's
      Designs folder) gives 0 overlap warnings in a real render; a fixture with one planted overlap gives
      exactly 1.
- [ ] Tests for each case above can fail: removing the ancestor rule or the hidden-text rule turns a test
      red (mutation-checked).
- [ ] The CLI, the `design_check` tool and the Checks badge agree (same engine, no change to messages).

### User Flow
1. The agent (or the user via **Check rendering**) runs a check on a design.
2. Each artboard renders; text boxes are measured per painted line; hidden text is dropped from visual
   verdicts.
3. Real overlaps appear as today ("<where>: two pieces of text overlap."); false ones do not.
4. Failure branches are unchanged: no browser, timeouts and skipped artboards report as today.

### Roles & Access
- **User:** sees fewer, truer warnings in the badge, popover, rail sheet, Work Status and DesignCard.
- **Chat agent:** gets fewer false findings from `dc check` and `design_check`; nothing to learn.
- **Untrusted design:** its scripts still cannot see or change the probe (isolated world, §9.9); a
  design that hides text to dodge contrast gains nothing the user would see (hidden text is unseen).
- **First run / changed folder:** no effect.

### Edge Cases
- Text inside a hidden ancestor that is still laid out (`visibility: hidden` child shown with
  `visibility: visible`): judged as visible, because it paints.
- `aria-hidden="true"` text that is visible on screen: still judged (it paints).
- Text clipped by a scroll container (a table that scrolls sideways): judged only where it paints.
- A line box of zero width (a trailing space): ignored, as today's under-1 px rule.
- Ruby text, `<sup>`/`<sub>` that sit above or below the line: inside their parent, so no warning.
- A design with more than the measured text cap (`CHECK_TEXT_ELEMENTS_MAX`): behaviour as today.
- A check report written before the fix still shows its old findings until the next run (stale ones are
  already not counted, §9.9).

### Security & Abuse
- No new data crosses a boundary; the probe answer is still sanitised (`sanitizeProbe`) and any new
  field it reports must be checked for shape and size the same way.
- A design could try to hide a real problem by marking text visually hidden; that text is then not seen
  by the user either, so nothing they see is wrongly passed.

### Sandbox, Filesystem & Theme Impact
None: the check still renders offline in its own sandboxed browser; no new writes.

### Data Requirements
The probe may need to report, per text, its per-line boxes and whether it is visually hidden, and which
texts are ancestors of which. All derived from the render, never stored beyond `check.json`.

### Out of Scope
- New check codes or new wording.
- Judging overlap of text with images or icons.

---

## 2. 07 · Edit authority and patch route

### Overview
The rules every hand edit follows, and the one way a hand edit reaches a design's files: the user acts
in Design Chamber's own controls, the page decides what is written, the service saves a version, then
changes only the edited part of the source in place, and refuses when the file changed since the user's
view of it. Features 08 and 11 write through it; 09 and 10 follow the same rules.

### User Stories
- As the user, I want a quick fix I make by hand to land in the real file and survive a reload, so that I
  do not need a chat round trip for a typo.
- As the user, I want every hand edit to be undoable and saved in Versions first, so that I can try
  things without fear.
- As the user, I want my edit refused, with my words kept, when the agent changed the same file a moment
  ago, so that neither of us silently loses work.
- As the chat agent, I want the rest of the file left exactly as I wrote it, so that my next edit still
  applies and diffs stay small.
- As the owner, I want nothing a design's own scripts do to be able to write to disk, so that untrusted
  HTML stays harmless.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| 07-1 | The page owns every edit; the frame only reports what was clicked (owner direction) | A design's scripts share the bridge's realm and can forge its messages (review "Two walls", `bridge.ts:1-9`) | 2026-11-11 |
| 07-2 | A service route patches the source in place, saves a version first, refuses on a changed file (owner direction) | The bundled render has no source positions; the source is the only place a write can go | 2026-11-11 |
| 07-3 | What is written, and where, is decided from the source file the page read from the service, never from the frame's DOM | The DOM is the design's to change; the source is the file the agent wrote | 2026-11-11 |
| 07-4 | No confirm before a hand edit; Undo instead | Usability bar: a confirm on a reversible action is a defect (`docs/SPEC.md` §13.2 P4 precedent) | 2026-11-11 |
| 07-5 | Hand edits are allowed while the linked agent is working, with a hint; the stale refusal protects both | Blocking would make the user wait on a long turn; the refusal already prevents clobbering | 2026-11-11 |
| 07-6 | Hand edits are refused while viewing an old version or comparing | Same rule as the ask bar (§10.9); a version is read-only | 2026-11-11 |
| 07-7 | Writable files: a page's entry HTML, a canvas's `screens/<id>.html`, `tokens.css` (09) and `design.json`'s screen list (10, 11). Never `assets/**`, `DESIGN.md`, `.chamber/**`, `.versions/**`, or anything outside the design folder | Least authority for what Phase 2 needs | 2026-11-11 |

### Acceptance Criteria (the user-edit rules, E1 to E12)
- [ ] **E1 Only a user gesture writes.** A write starts only from a click or key press on Design
      Chamber's own controls (toolbar, editor box, menus, panels). No message from a design frame, in any
      order or volume, starts, changes or redirects a write. Tested by replaying forged frame messages and
      seeing no write.
- [ ] **E2 Source decides.** The page locates the edit in the source it fetched from the service; the
      frame's report only names the clicked element. When the page cannot locate that element's text in
      the source with certainty, the edit is refused before any write (08 gives the sentences).
- [ ] **E3 Version first.** Before any hand edit writes, the design's current files are kept as a version
      (reason label "Before your edits"), unless the newest version already holds exactly these files.
      A burst of quick hand edits (within 60 s, with no other writer in between) shares one "Before your
      edits" version holding the state before the burst; the intermediate states are reached by Undo
      (E9), not as separate Versions entries. If that version cannot be saved (over the caps, a damaged
      history from a newer build), nothing is written and the user sees "Couldn't save a version first,
      so nothing was changed. <reason>".
- [ ] **E4 Stale refusal.** When the target file changed on disk since the page read it (agent, another
      Design Chamber window, any program), nothing is written. The user sees "This file changed while you
      were editing. Nothing was saved." with **Reload and try again**; whatever they typed stays in the
      editor until they cancel.
- [ ] **E5 Smallest change.** Only the edited part changes. Every other byte of the file is identical
      after the write: indentation, line endings (CRLF kept on Windows files), comments, attribute order
      and quoting, entity spelling of untouched text, a byte-order mark if present. Tested on fixtures
      with CRLF, a BOM, comments and entities.
- [ ] **E6 Text stays text.** Characters the user types are written as text: `<`, `>` and `&` can never
      become markup, a closing tag or a script. Tested with `</p><script>` as input.
- [ ] **E7 Contained.** Every target is resolved inside the design folder with the one containment
      function (§9.1); a symlinked target that leads out is refused; only the files in 07-7 are writable.
- [ ] **E8 Shows at once.** After a successful write, every artboard showing that file (all its
      viewports, the rail and the page if both are open) shows the change within 2 s, keeping the camera
      and each artboard's scroll.
- [ ] **E9 Undo.** A transient notice (S7, 10 s, paused on hover or focus) names what changed (for
      example "Text updated in Home") with **Undo**. Undo puts back exactly the bytes from before the edit,
      through the same rules (E3 to E5): if the file changed again since, Undo is refused with "This
      file changed after your edit, so it can't be undone here. Restore the version 'Before your edits'
      from Versions." Ctrl/⌘+Z in the viewer, outside any text field, does the same for the latest hand
      edit of this session (one slot: after an undo it does nothing until a new edit is made).
- [ ] **E10 Not the agent.** The build strip never shows a hand edit as "Writing <file>", and the
      "Done. Updated N files" message never counts it (same idea as the restore quiet window).
- [ ] **E11 Allowed while the agent works**, with a one-line hint while the linked agent is working on
      this design: "The agent is working on this design. It may write over your edit."
- [ ] **E12 Refused while viewing a version or comparing** (controls disabled with the reason "You're
      viewing an old version.").
- [ ] Every route behind this is bearer-checked, slug- and path-validated like every route (§7), and
      answers a sentence for every failure (not found, too large, not UTF-8, stale, contained, busy).
- [ ] Two hand edits at once (rail and page, or two quick edits) never interleave: the second either
      lands after the first or is refused as stale; never a mixed file.

### User Flow
1. The user acts on an element or a control (08 double-click, 10 menu, 11 Keep this one).
2. The page reads the target from the source; if it cannot place the edit, it refuses with a sentence
   and offers **Ask agent** (stop).
3. The user confirms the edit (Enter, Save, a menu click).
4. Version first; on failure: sentence, nothing written (stop).
5. Stale check; on change: refusal, input kept, **Reload and try again** (stop).
6. The write lands; artboards update; the notice with **Undo** shows.
7. Undo (optional) puts the old bytes back, or explains why it cannot.

### Roles & Access
- **User:** the only author of hand edits; edits on both surfaces where the feature appears.
- **Chat agent:** keeps writing files freely; its next write after a hand edit wins (Q5 covers whether
  it is told). Its in-flight write makes the user's edit stale, never the other way round silently.
- **Untrusted design:** can only choose what is under the user's click (it is its own content). Cannot
  trigger, alter or aim a write, cannot see the token, cannot learn other designs' files.
- **First run, no designs folder:** no design is open, nothing to edit.
- **Changed designs folder:** an edit in flight when the root changes is refused ("That design is no
  longer in your Designs folder.") and the typed text stays until cancelled.

### Edge Cases
- File deleted by the agent mid-edit: refused as gone, text kept.
- File over the source size cap (`/source` 2 000 000 chars): editing refused, "This file is too large
  to edit here. Ask the agent instead."
- A file that is not valid UTF-8: refused, same sentence family.
- Disk full or permission denied: the version may exist, the write fails with a sentence from the
  folder error table (`folderErrorSentence`), nothing half-written (atomic replace).
- Windows lock (another program has the file open): retried within the handler budget, then "Another
  program is using this file. Close it and try again."
- Many quick edits: each saves a version unless the newest one already matches (E3). With the 100-version
  cap, a long run of hand edits pushes old versions out (see Open Questions).
- Version pruning never removes the "Before your edits" version that an Undo on screen still points to,
  while that notice is up.
- The service restarts between edit and Undo: Undo still works while the notice is up if the file is
  unchanged; otherwise the refusal sentence.
- A pinned comment on edited text: the pin stays on the element (the selector still matches); its quote
  keeps the words from when it was made.

### Security & Abuse
- **Who must not write:** a design's scripts, a forged frame message, another design, anything outside
  the design folder. Only the user through Design Chamber's chrome.
- **Abuse vectors:** a design forging `hit` reports to steer an edit to another element (mitigated: the
  editor shows the source text the page found, so the user sees what they are changing; the frame cannot
  change what is typed); a design flooding messages (ignored for writes, E1); markup injection through
  typed text (E6); path tricks (E7); a symlinked screen file (E7); racing the agent (E4).
- **Sensitive data:** the user's typed text and the design files; nothing is logged beyond the file name
  and outcome; no text in logs.
- **Audit trail:** hand edits leave a "Before your edits" version (one per burst, E3), so the Versions
  drawer shows the state before each burst of hand changes; Undo steps back through the burst itself.

### Sandbox, Filesystem & Theme Impact
- **Sandbox/CSP:** unchanged. Frames stay `allow-scripts` only, never `allow-same-origin`. The editor
  the user types into is page-owned chrome, not inside the frame.
- **Loopback service:** new write route(s), bearer-checked, slug-validated, contained; body within the
  64 000-char request cap.
- **Filesystem writes under the designs root:** in-place replacement of the files in 07-7 only, atomic,
  compare-and-swap against what the page read; a version first.
- **Untrusted HTML:** the source is parsed only to place an edit; no part of it runs in the page.
- **Theme:** the editor, toolbar and notices use host tokens and the kit only.

### Data Requirements
- Per write: design, target file, what the page read (to detect a change), the edit, and who (always
  "user"). Kept only as the version before the write and the Undo notice's memory; nothing new on disk.
- Versions gain user-edit reasons with plain labels ("Before your edits", 11 adds "Before keeping a
  direction").

### Out of Scope
- Moving, resizing or aligning elements; a properties panel; layers.
- Editing attributes (alt, href, placeholder), images or styles in the HTML.
- Undo beyond the latest hand edit of the session (Versions covers older ones).

---

## 3. 08 · Edit text in place

### Overview
Double-click text on an artboard to change it right there. A small toolbar over the selected element
offers **Edit text**, **Comment** and **Ask agent**.

### User Stories
- As the user, I want to fix a typo or a headline on the wall in two seconds, so that I do not send the
  agent a message for it.
- As the user, I want one place over the element to choose between editing, commenting and asking, so
  that I do not have to remember which mode does what.
- As a keyboard user, I want to reach and use the toolbar and editor without a mouse.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| 08-1 | Text edit works on canvases and pages, in Edit mode (canvas) and Comment mode (page), on the full-screen page and in the rail viewer | Pins already work on both kinds (BRIEF 2026-10-26); same wall component | 2026-11-11 |
| 08-2 | Only an element whose text in the source is plain text (no child elements inside) is editable in Phase 2 | Keeps E5/E6 provable; formatted runs go to the agent | 2026-11-11 |
| 08-3 | The editor shows the text at a readable size whatever the wall zoom | The wall opens at about 26%; editing 4 px text is not possible | 2026-11-11 |
| 08-4 | Enter saves, Esc cancels, line breaks are not allowed (pasted line breaks become spaces) | Plain text in HTML collapses line breaks; a `<br>` would be markup | 2026-11-11 |
| 08-5 | Play mode never edits; double-click there belongs to the design | Play is the design's own interaction | 2026-11-11 |
| 08-6 | Click behaviour: a click keeps opening the comment box as today, with the toolbar above it; double-click on text goes straight to editing (Q4, owner accepted 2026-11-11) | Keeps the comment flow's step budget | 2026-11-11 |

### Acceptance Criteria
- [ ] In Edit mode (canvas) or Comment mode (page), a click on an element shows the selection toolbar
      over it (placement per Q4), with **Edit text**, **Comment** and **Ask agent**, kept inside the
      viewer, flipped below the element near the top edge.
- [ ] Double-click on editable text opens the editor directly with the source text selected.
- [ ] **Edit text** is disabled with a readable reason when the element is not editable:
      "This text is made by the page's script. Ask the agent to change it." (text not found in the
      source) · "This has formatting inside. Ask the agent to change it." (child elements) ·
      "This text appears more than once and the exact one can't be found. Ask the agent to change it." ·
      "Design Chamber can't find this text in the file exactly. Ask the agent to change it." (the scanner
      can't place it with certainty: implied end tags, unknown entities) ·
      "You're viewing an old version." · "This file is too large to edit here."
- [ ] **Comment** opens today's comment composer on the element (Phase 1 behaviour unchanged).
- [ ] **Ask agent** puts the element in the ask bar's chip (S4) and moves focus to the ask bar.
- [ ] The editor starts with the text **from the source** (decoded for reading), not from the frame.
- [ ] Enter (not during IME composition) saves through the 07 rules; Esc or clicking away with no change
      closes; clicking away **with** a change keeps the editor open and shows "Press Enter to save or Esc
      to discard." (no silent loss, no silent save).
- [ ] Saving shows a loading state on the editor; on success the notice "Text updated in <screen or
      page title>" with **Undo** (E9); on any refusal the 07 sentence, the typed text kept.
- [ ] Empty text is allowed (the element stays, empty); Undo brings it back.
- [ ] Untouched characters keep their source form (an `&amp;` the user did not touch stays `&amp;`).
- [ ] All artboards of the edited file show the new text (E8); a pin on that element stays put.
- [ ] Keyboard: with an element selected, Tab reaches the toolbar; Enter on **Edit text** opens the
      editor; Esc closes toolbar or editor and returns focus to the wall. The toolbar has a name ("Actions
      for <tag> '<first 40 chars>'").
- [ ] Light and dark, rail at 320 px and the page at 1400 px: toolbar and editor fit and read.

### User Flow
1. Edit mode (or the page's Comment mode) on.
2. Double-click a heading → editor opens with its source text selected.
3. Type, Enter → saved, notice with Undo.
4. Branches: not editable → toolbar shows the reason and **Ask agent**; stale → refusal, **Reload and
   try again**, text kept; version cannot be saved → refusal, nothing written; viewing a version →
   disabled; Play mode → double-click goes to the design.
5. Single click → toolbar (+ comment box per Q4) → Comment / Ask agent as today.

### Roles & Access
- **User:** edits on both surfaces; the rail viewer gets the same toolbar.
- **Chat agent:** sees the changed file next time it reads it (Q5 for being told).
- **Untrusted design:** reports which element was clicked; can make its text uneditable (script-made
  text) but cannot make anything else be written.
- **First run / changed folder:** as 07.

### Edge Cases
- Text split across lines in the source (indentation inside the element): shown as one line, saved
  without changing the surrounding whitespace.
- The same words in two elements (two "Learn more" buttons): the clicked one is edited when it can be
  told apart; else the "appears more than once" reason.
- Text inside `<template>`, SVG `<text>`, `<title>`, a `<button value>` or an attribute: not editable in
  Phase 2 (reason: "Ask the agent to change it.").
- Text that a script rewrote after load (a counter, a date): the source text differs, so "made by the
  page's script".
- The element moved or vanished between click and save (the agent rewrote the file): stale refusal.
- Very long text: editor grows to a cap and scrolls; over 5 000 characters refused with "That's too
  long to edit here. Ask the agent instead."
- Right-to-left text: the editor follows the element's direction.
- Wall zoomed far out or in: toolbar and editor keep their own size (08-3).

### Security & Abuse
- Typed text is text (E6); the frame never sees the editor; the source, not the DOM, decides the target
  (E2). A design that keeps changing its DOM to confuse the toolbar can at worst make **Edit text**
  unavailable.
- Toolbar and editor render agent text only as text (no markup), like the ask bar chip.

### Sandbox, Filesystem & Theme Impact
As 07; no frame change beyond reporting double-clicks in Edit mode.

### Data Requirements
Shown: the element's tag and short text in the toolbar name; the source text in the editor. Stored:
nothing new beyond 07's version.

### Out of Scope
- Rich text (bold, links) and editing across several elements at once.
- Spell check suggestions, find and replace.

---

## 4. 09 · Tweaks panel

### Overview
The agent declares a few knobs in `design.json`, each tied to a variable in `tokens.css` (accent hue,
density, type scale, radius). The user drags sliders and sees every artboard change live; **Save**
writes only those values into `tokens.css`. No HTML is rewritten.

### User Stories
- As the user, I want to try a warmer accent or tighter spacing with a slider and see it on every screen
  at once, so that I can judge it without asking the agent.
- As the user, I want my tweak saved into the design's own tokens, so that exports and the agent both
  get it.
- As the chat agent, I want a simple way to offer the user knobs, and to hear when one of mine is
  broken.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| 09-1 | Two knob kinds: a number slider (min, max, step, unit) and a choice among 2 to 6 named values | Covers hue, density, scale and radius; anything more is the agent's job | 2026-11-11 |
| 09-2 | At most 12 knobs per design; each names one variable defined in `tokens.css` `:root` | A panel, not a properties editor | 2026-11-11 |
| 09-3 | Preview never writes; only **Save** writes, through the 07 rules (version "Before your edits", stale refusal, smallest change, Undo) | Owner direction plus the user-edit rules | 2026-11-11 |
| 09-4 | Preview updates artboards without reloading them, keeping scroll and Play state | The review: full reloads block smooth tweak previews | 2026-11-11 |
| 09-5 | Unsaved tweaks are never lost silently: closing the panel keeps them pending; leaving the design asks Save / Discard / Keep editing | Usability floor: input is not lost | 2026-11-11 |
| 09-6 | Saving tweaks does not by itself mark the design system confirmed | Confirming is the user's word in chat (precedence rule 4) | 2026-11-11 |
| 09-7 | The static check reports knobs that point at a missing variable or a value that is not a plain number/choice | The agent otherwise never learns its knob is broken | 2026-11-11 |

### Acceptance Criteria
- [ ] A **Tweaks** button shows in the viewer (page toolbar and rail compact actions) when the design
      declares at least one valid knob; it opens a panel (page: side panel; rail: a non-modal bottom
      sheet up to 50% of the rail height, so the wall stays visible above for live preview; Reset/Save
      pinned in the footer; falls back to full-height below about 560 px of rail height. Comments and
      Versions stay full-height).
- [ ] With no knobs, the ⋯ menu has **Ask for tweaks**, which puts "Add tweaks for this design (accent
      hue, density, type scale, radius)." in the ask bar for the user to send or edit.
- [ ] Each knob shows its label, current value with unit, and a slider (or a segmented choice); arrow
      keys step, Page Up/Down step ×10, Home/End go to the ends; each control has an accessible name and
      value.
- [ ] Moving a knob updates every live artboard of the design within 100 ms of the input, without a
      reload; scroll, Play state and the camera stay.
- [ ] A dot on the Tweaks button and "Unsaved" in the panel while any value differs from the file.
- [ ] **Save** (filled primary in the panel) writes only the knob variables' values in `tokens.css`;
      every other byte of the file is unchanged (E5). Notice "Tweaks saved to tokens.css" with **Undo**.
- [ ] **Reset** returns every knob to the file's values and clears the preview (no write).
- [ ] A knob whose variable is missing shows disabled with "tokens.css has no --name."; one whose value
      is a formula or reference (`calc()`, `var()`) shows disabled with "This value is a formula. Ask the
      agent to change it."; the other knobs keep working.
- [ ] When `tokens.css` changes on disk while values are unsaved: "tokens.css changed since you started.
      Your values are still shown." with **Apply to the new file** (writes only the knob values onto the
      new file, through the 07 rules) and **Discard my tweaks**.
- [ ] Leaving the design or closing the viewer with unsaved tweaks: "Save your tweaks?" with **Save**,
      **Discard**, **Keep editing**.
- [ ] While viewing a version or comparing, the panel is read-only with "You're viewing an old version."
- [ ] Exports, thumbnails and checks reflect only saved `tokens.css` (the preview is never exported).
- [ ] `dc check` / `design_check` report a broken knob as a finding naming it.
- [ ] The agent instructions describe how to declare knobs (rules author), with one example.

### User Flow
1. Agent adds knobs to `design.json`; the Tweaks button appears live (watcher).
2. User opens Tweaks, drags "Accent hue"; every screen shifts colour live.
3. Save → version first → `tokens.css` updated → notice with Undo.
4. Branches: no knobs → **Ask for tweaks**; broken knob → disabled with reason; file changed → Apply to
   the new file / Discard; save refused → sentence, values kept; service down → "Couldn't save your
   tweaks. <message> Your values are still here."

### Roles & Access
- **User:** previews and saves; both surfaces.
- **Chat agent:** declares knobs, owns their definitions; may change `tokens.css` any time (makes the
  user's unsaved tweaks stale, never overwritten silently).
- **Untrusted design:** receives preview values; cannot write tokens or knob definitions; a design that
  ignores variables simply does not react.
- **First run:** nothing to tweak. **Changed folder (or the design deleted):** the panel closes with "That
  design is no longer in your Designs folder. Your unsaved values were:" followed by each knob's value,
  so they can be copied; nothing is written.

### Edge Cases
- A design with no `tokens.css`: knobs show disabled with "This design has no tokens.css."
- `tokens.css` defines the variable twice (`:root` and a media query): the `:root` one is the knob's;
  others untouched; the panel says "Also set for <condition>; only the default changes."
- Screens that do not link `tokens.css`: they do not change; the panel cannot fix that.
- Knob min > max, step ≤ 0, a default outside range, duplicate variables, more than 12 knobs: invalid
  knobs dropped with a design.json warning (never fatal, §6.2 rule), valid ones kept.
- A value in the file outside the knob's range: shown, slider clamps only when moved.
- Units: the file's unit is kept (`8px` stays px); a knob unit that differs from the file's is a broken
  knob.
- Two windows tweaking the same design: the second Save is stale.
- Agent writes `tokens.css` during a drag: preview stays on top of the new file until the user chooses.

### Security & Abuse
- Knob definitions come from agent-written `design.json`: labels and units shown as text only, lengths
  clipped, numbers bounded; a variable name must be a CSS custom property name, nothing else.
- Values written to `tokens.css` are only the numbers or named choices the knob allows, so a knob cannot
  inject CSS.
- No data leaves the machine.

### Sandbox, Filesystem & Theme Impact
- **Sandbox:** preview values reach the frame as data; no new frame capability.
- **Filesystem:** `tokens.css` only, through the 07 rules.
- **Theme:** the panel uses host tokens; the design's tokens are design content.

### Data Requirements
Knobs in `design.json` (agent-owned): label, variable, kind, range or choices, unit. No user data
stored beyond the saved `tokens.css` and its version.

### Out of Scope
- Colour pickers, free text values, knobs that rewrite HTML or classes.
- Per-screen or per-viewport knob values.
- Saving named tweak presets.

---

## 5. 10 · Screen management

### Overview
Grow and shape a canvas without chat for the mechanical parts: a "+ Screen" ghost board asks the agent
for a new screen; the user drags screens into order, duplicates one, or moves one to the trash.

### User Stories
- As the user, I want to put Checkout before Pricing by dragging, so that the wall reads in flow order.
- As the user, I want to copy a screen to try a change on the copy, and to throw away a screen I do not
  want, with Undo.
- As the user, I want to ask for a new screen from the wall itself, so that the request lands where the
  agent will build it.
- As the chat agent, I want the screen list I find on my next read to be the truth, and not to have my
  own screen list writes silently undone.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| 10-1 | "+ Screen" sends a request to the linked chat (the ask flow); Design Chamber writes no screen file for it | The agent writes every design file; an empty board would be a blank, broken screen | 2026-11-11 |
| 10-2 | Duplicate, reorder and Move to trash are done by Design Chamber itself, through the 07 rules | Mechanical, instant, undoable; no reason to wait on a turn | 2026-11-11 |
| 10-3 | Move to trash saves a version first, moves the file to the designs folder's trash, and shows Undo; no confirm | Same rule as design delete (BRIEF) and the Usability bar | 2026-11-11 |
| 10-4 | The screen list is shared: Design Chamber writes `screens[]` only for the user's actions, version first, stale refusal; the agent stays free to rewrite it and its later write wins (Q1, owner accepted 2026-11-11) | `docs/SPEC.md` §6.3 made it agent-owned; the owner chose the shared list over app-side order | 2026-11-11 |
| 10-5 | Canvas only; pages have no screens | Kind rule | 2026-11-11 |
| 10-6 | Menu actions on both surfaces; drag reorder on the full-screen page only (keyboard Move up/down everywhere) | Labels in the rail's fit-all view are too small to drag | 2026-11-11 |

### Acceptance Criteria
- [ ] A ghost board "+ Screen" sits after the last screen row (Edit mode, live design, under 40 screens).
      Hidden in Play mode, while viewing a version, and at 40 screens (then the last label menu says
      "A canvas holds up to 40 screens.").
- [ ] Clicking it opens a small box "What should the new screen show?" with **Ask the agent** (and
      Esc to cancel). Sending goes to the linked chat through the ask flow (§10.9 outcomes and toasts);
      the request names the canvas and the screen it should follow. The text is kept on failure.
- [ ] Each screen label has a ⋯ menu: **Duplicate**, **Move up**, **Move down**, **Move to trash**, and
      **Try 3 directions…** (11). Move up is disabled on the first screen, Move down on the last.
- [ ] Dragging a screen label on the full-screen page shows where it will land; dropping saves the new
      order; Esc during a drag cancels. The wall re-lays out at once; the camera keeps the moved screen in
      view.
- [ ] **Duplicate** makes a copy of the screen file next to it with a free id (`<id>-copy`,
      `<id>-copy-2`…), title "<Title> copy", same viewports, inserted right after the original; notice
      "Duplicated <Title>" with **Undo** (removes the copy). Comments stay on the original.
- [ ] **Move to trash** takes the screen off the wall, saves a version first, moves its file to the
      designs folder's trash, and shows "Moved <Title> to trash" with **Undo** (puts file and list entry
      back where they were). Its open comments stay in Comments under the screen with "Screen removed".
- [ ] Every change follows E3 to E12: a version first, stale refusal ("The screen list changed while
      you were working. Nothing was changed." then the wall refreshes), smallest change to `design.json`
      (only the screen list changes, other fields and unknown keys intact), Undo.
- [ ] Moving the last screen to trash is allowed; the wall shows its empty state plus "+ Screen".
- [ ] Links between screens (`screens/pricing.html`) keep working after reorder and duplicate (ids and
      files of existing screens never change).
- [ ] Keyboard: label menus reachable by Tab; Move up/down work without drag; every action announces
      its result in the live region.

### User Flow
1. Canvas open in Edit mode.
2. Reorder: drag "Checkout" above "Pricing" → order saved → notice.
3. Duplicate: ⋯ → Duplicate → copy appears after → notice with Undo.
4. Trash: ⋯ → Move to trash → board leaves → notice with Undo.
5. New: "+ Screen" → describe → Ask the agent → the build strip shows the agent working; the new board
   appears when it writes the file and list entry.
6. Branches: stale → refusal and refresh; version cannot be saved → nothing changed; no linked chat →
   "Starts a new chat" target line as the ask bar; service down → sentence, nothing changed.

### Roles & Access
- **User:** all actions; drag on the page only.
- **Chat agent:** still writes screens and the list; per Q1 its later write of the list wins; Q5 covers
  being told about the user's changes.
- **Untrusted design:** no role; it cannot trigger screen actions.
- **First run / changed folder:** none / an action on a design that left the root is refused with the
  gone sentence.

### Edge Cases
- The agent rewrites `design.json` from its own memory and brings back a trashed screen: the board
  shows "screens/x.html not written yet" (the file is in the trash); this is why Q5 matters.
- Duplicating a screen whose file does not exist yet: Duplicate disabled ("Nothing to copy until the
  agent writes this screen.").
- A screen id that would exceed the id pattern (`^[a-z0-9][a-z0-9-]{0,40}$`) when suffixed: a shorter
  free id is chosen.
- A `design.json` that does not parse: every screen action disabled with "design.json can't be read
  right now. Ask the agent to fix it."
- A provisional design (no `design.json` yet, §6.3 P3): screen actions disabled until it lands.
- Drag while the agent adds a screen: the drop is refused as stale; the new screen shows.
- Undo after the agent changed the list: refused with the E9 sentence.
- Trash name clash in `.trash`: a unique name, never an overwrite.

### Security & Abuse
- Only the user's clicks act; the frame has no part.
- Screen ids, titles and files come from `design.json` (untrusted): shown as text, validated by the
  existing rules before any file operation; the file moved or copied is always `screens/<id>.html`
  resolved inside the design.
- Trash is a move, never a hard delete (BRIEF).

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** copy within `screens/`, move into `<root>/.trash`, `design.json` screen list; all
  contained, atomic, versioned first.
- **Sandbox, theme:** none new; ghost board and menus in host tokens.

### Data Requirements
The screen list (order, ids, titles, files, viewports) in `design.json`; trashed screen files in the
designs folder's trash. Versions hold the before-state.

### Out of Scope
- Renaming a screen or editing its description from the wall.
- Moving screens between canvases; reordering viewports (columns).
- Emptying the trash.

---

## 6. 11 · Variations you can pick from (canvas half)

### Overview
"Try 3 directions" on a screen asks the agent for three takes on it, shown side by side in one row. On
any of them, "Keep this one" makes it the screen and moves the rest to the trash, with a version saved
first. The chat half shipped in Phase 1.5 as the DirectionPick block (verified: `src/ui/blocks/`,
`documentation/features/chat-blocks.md`); it is reused, not rebuilt.

### User Stories
- As the user, I want to see three directions for one screen next to each other at the same size, so
  that I compare them fairly.
- As the user, I want one click to keep a direction and clear the others, with Undo, so that the wall
  does not fill with leftovers.
- As the chat agent, I want a clear way to mark screens as directions of another screen, so that the
  wall groups them.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| 11-1 | "Try 3 directions…" sends a request to the linked chat (ask flow); the agent writes the direction screens | The agent writes design files | 2026-11-11 |
| 11-2 | Canvas only | Page directions are separate design folders, already picked with DirectionPick (Phase 1.5 Q5) | 2026-11-11 |
| 11-3 | Keep this one goes through the 07 rules with its own version label "Before keeping a direction" and Undo | Owner direction ("with a version saved first") | 2026-11-11 |
| 11-4 | 2 to 4 directions per screen, like DirectionPick | One rule for both halves | 2026-11-11 |
| 11-5 | Directions are screens in the same canvas, marked by the agent as directions of one screen; the row shows Current, A, B, C at one viewport; Keep this one on the wall is the picker; DirectionPick stays for folder directions and the agent may still ask in chat and act on the answer itself (Q2, owner accepted 2026-11-11) | One canvas row needs screens; folder directions keep the Phase 1.5 block | 2026-11-11 |

### Acceptance Criteria (with the Q2 default)
- [ ] The screen ⋯ menu has **Try 3 directions…**: a box "What should the directions explore?
      (optional)" with **Ask the agent**; it goes to the linked chat through the ask flow, naming the
      screen. Disabled while that screen already has directions ("This screen already has directions.
      Keep one first.").
- [ ] Screens the agent marks as directions of a screen show in one row on the page: the current screen
      first (labelled "Current"), then A, B, C (D) with the agent's short name, all at one viewport (the
      first of the screen's viewports, with a "Show at" viewport switch on the row, drawn on both
      surfaces). On the rail the row wraps to a 2×2 grid so all directions are visible at once. The row
      label reads "<Title> · 3 directions".
- [ ] A direction not written yet shows the "not written yet" board; **Keep this one** is disabled on it.
- [ ] Each written board in the row, Current included, has **Keep this one**.
- [ ] Keep this one on B: version first ("Before keeping a direction"); B's content becomes the screen
      in the original's place with the original's id, title and links; Current, A and C go to the trash;
      the direction marks are cleared; the wall shows a normal row again; notice "Kept B for <Title>. The
      others are in the trash." with **Undo** (puts every file and the list back).
- [ ] Keep on **Current** keeps the original and trashes all directions.
- [ ] Open comments on trashed directions stay in Comments with "Screen removed"; comments on the kept
      direction move to the kept screen.
- [ ] Every Keep follows E3 to E12 (stale refusal when the agent changed any of those files or the
      list, smallest change, contained).
- [ ] When the agent asks in chat with DirectionPick, the user can answer there and the agent acts on
      the answer itself; the wall's Keep this one also works without any chat block (Q2).

### User Flow
1. ⋯ on "Home" → Try 3 directions… → optional note → Ask the agent.
2. The agent writes `home-a`, `home-b`, `home-c` and marks them as directions of Home; the row appears
   as they land (build strip shows progress).
3. User compares, clicks **Keep this one** on B → notice with Undo.
4. Branches: fewer than 2 written → row shows what exists, Keep available on written ones; stale →
   refusal and refresh; version cannot be saved → nothing changed; agent never answers → the build
   strip's stalled message; no linked chat → new chat as the ask bar.

### Roles & Access
- **User:** asks, compares, keeps; the rail shows the row and **Keep this one** in each board's menu.
- **Chat agent:** writes the directions and marks them; may also ask with DirectionPick.
- **Untrusted design:** none.
- **First run / changed folder:** none / gone sentence.

### Edge Cases
- The agent marks a direction of a screen that does not exist: shown as a normal screen with a
  design.json warning.
- A direction marked for two screens, or a mark cycle: ignored with a warning.
- Directions over the 40-screen cap: the agent cannot add them (existing cap); the request text says
  how many screens are free.
- The user keeps a direction while the agent still writes C: stale refusal.
- Links from other screens to `screens/home-b.html`: after Keep they point to a trashed file; the
  board shows the existing "Not a screen of this design" toast in Play mode (agent fixes on request).
- Comments on the original when Current is not kept: they stay with the screen id, which now shows B's
  content; pins re-anchor or show detached as today.

### Security & Abuse
- Marks come from agent-written `design.json`, validated; nothing executes.
- Keep moves files only within the design and into the trash, contained, versioned first.

### Sandbox, Filesystem & Theme Impact
- **Filesystem:** replaces one screen file with another's content, moves the others to the trash,
  updates the list; atomic and versioned first.
- **Sandbox, theme:** none new.

### Data Requirements
Direction marks in `design.json` (which screen a direction belongs to, its letter and short name).

### Out of Scope
- "Keep this one" for directions that are separate design folders.
- Mixing parts of two directions.
- DirectionPick tiles that point at canvas screens (unless Q2 says otherwise).

---

## 7. 19 · Pages that remember their state

### Overview
Designs that save ticks, toggles and filters with `localStorage` keep them across reloads inside Design
Chamber. Today the sandboxed frame (no `allow-same-origin`) makes storage throw. The frame gets a
stand-in storage whose data the service keeps in the design's `.chamber/page-state.json`, capped, never
exported, never versioned. "Clear saved page data" resets it.

### User Stories
- As the user, I want the checklist I ticked in a design to still be ticked tomorrow, so that the design
  is useful as a working page.
- As the user, I want to reset a design's saved state in one place, so that I can start fresh.
- As the user, I want my saved page data to stay private: not exported, not in versions, not sent to a
  chat.
- As the chat agent, I want normal `localStorage` code to just work, so that I do not need a special API.

### Decisions Made
| # | Decision | Rationale | Date |
|---|---|---|---|
| 19-1 | Data kept in `.chamber/page-state.json`, capped, never exported or versioned (owner direction) | Service-owned folder, already excluded from versions and exports (§6.1, §6.4) | 2026-11-11 |
| 19-2 | The frame keeps its sandbox: `allow-scripts` only, never `allow-same-origin` | Hard project rule | 2026-11-11 |
| 19-3 | Only the live design in the viewer reads and saves data. Versions, compare, thumbnails, checks and live list previews run with empty, unsaved storage | Old versions may use other keys; previews and checks must be repeatable | 2026-11-11 |
| 19-4 | `sessionStorage` gets an in-memory stand-in for the frame's life, never saved | Scripts that touch it should not throw | 2026-11-11 |
| 19-5 | Clear saved page data asks first | It is not versioned, so it cannot be undone | 2026-11-11 |
| 19-6 | Saved data survives agent edits and version restores; it goes with the folder on delete (to trash) and on export it is left out | Like a real site's storage; restore never touches `.chamber/` (§6.4) | 2026-11-11 |
| 19-7 | One store per design, shared by all its screens, viewports and both surfaces; capped at 1 MB per design with a one-time notice when a design goes over (Q3, owner accepted 2026-11-11) | The owner chose the recommended scope and cap | 2026-11-11 |

### Acceptance Criteria (with the Q3 default)
- [ ] In a design that saves a checkbox state to `localStorage` and reads it on load, ticking a box and
      reloading the viewer (or closing and reopening Design Chamber) shows it ticked.
- [ ] Reading, writing, removing, clearing, `length` and `key(n)` behave like the browser's
      `localStorage` for string values; no script error where the browser would throw none.
- [ ] Every screen and viewport of one design sees the same data, on the rail and the page; a write in
      one artboard is seen by the others on their next read (no live `storage` events in Phase 2).
- [ ] A write is on disk within 1 s, and the latest write before the viewer closes or hides is not lost.
- [ ] Past the cap, the write fails the way a full browser storage fails (the design's own error
      handling runs), earlier data is untouched, and the viewer shows once per session "This design
      tried to save more than 1 MB of page data. The extra wasn't saved."
- [ ] When the service cannot save (stopped, disk error), the page keeps working with what it has, and
      the viewer shows once "Page data can't be saved right now. Changes last until you close this
      design."
- [ ] The viewer ⋯ menu (rail and page) has **Clear saved page data**, enabled only when the design has
      saved data. It asks "Clear saved page data for <title>?" / "Ticks, toggles and filters this design
      saved will be reset. This can't be undone." with **Clear** (destructive) and **Cancel**; after
      Clear, the artboards reload empty and "Saved page data cleared." shows.
- [ ] Saved data is never in ZIP or single-file exports, never in a version, never in a revision, ask,
      fix or mention text, never in thumbnails or check renders, never logged.
- [ ] Viewing an old version or comparing: the design runs with empty storage and nothing it writes is
      kept; the live data is untouched.
- [ ] A missing, unreadable or malformed `page-state.json` reads as no saved data; the next save
      replaces it; nothing else in the design is affected.
- [ ] The design rules and instructions say saved page data now works in Design Chamber (rules author),
      replacing the "no localStorage assumptions" line.
- [ ] First use: once the `sam-fde-career-path` checklists save to `localStorage` (they do not today,
      verified: no `localStorage` in its `index.html`), their ticks survive a reload.

### User Flow
1. The user opens a design with a checklist and ticks three items.
2. Reload → still ticked.
3. ⋯ → Clear saved page data → confirm → empty again.
4. Branches: cap hit → one notice, extra not saved; service down → one notice, page still works; old
   version → empty, nothing saved; design deleted → data goes to the trash with the folder.

### Roles & Access
- **User:** owns the data; can clear it.
- **Chat agent:** writes design code that uses `localStorage`; never receives the data from Design
  Chamber. (It can read files on disk with its own tools; the instructions say `.chamber/` is
  Design Chamber's, which is a convention, not a barrier.)
- **Untrusted design:** reads and writes only its own design's data, only while running live in the
  viewer; cannot name, reach or guess another design's data; cannot exceed the cap; never sees the
  token.
- **First run:** no data exists; nothing created until a design writes.
- **Changed designs folder:** data stays with each design folder; designs in the old root keep theirs.

### Edge Cases
- Two windows of the same design writing the same key: last write wins.
- A design writing on every animation frame: saves are coalesced, at most about one disk write per
  second per design.
- Very many keys or a huge single value: counted against the cap (keys and values together).
- Non-string values: stored as strings, as the browser does.
- An imported or "Open as page" design: starts empty.
- A duplicated screen (10) shares the design's data.
- Renaming the design's title: data unaffected (folder unchanged).
- The design is deleted and a new one takes the same folder name: the old data went to the trash with
  the old folder; the new one starts empty.
- Restore a version: data untouched (a version from before the design used storage simply ignores it).
- IndexedDB, cookies and Cache Storage: still unavailable (out of scope).

### Security & Abuse
- **Who must not see it:** other designs, any chat, exports, versions, logs, thumbnails, the check
  output. It can hold personal notes (career plans), so it is personal data.
- **Abuse vectors:** a design filling the disk (cap, coalesced writes); a design trying to read another
  design's data by naming its slug (the page, not the frame, decides which design a frame belongs to);
  write storms slowing the service (coalescing, bounded request sizes); a hand-edited or hostile
  `page-state.json` (validated, size-limited, treated as empty when wrong, only ever handed back as
  strings to its own design).
- The stand-in runs inside the untrusted frame by design: it holds only that design's data and nothing
  else.

### Sandbox, Filesystem & Theme Impact
- **Sandbox/CSP:** no `allow-same-origin`, no new frame permission; the frame gains a storage stand-in
  in its own realm (spiked in Chromium; the architect confirms it in OpenChamber's Electron and on
  Windows and macOS).
- **Loopback service:** new read, write and clear route(s), bearer-checked, slug-validated, bounded.
- **Filesystem:** one file per design in `.chamber/`, atomic writes, capped; nothing outside the
  design folder.
- **Theme:** the notices and confirm use host tokens.

### Data Requirements
Per design: the key/value strings the design saved, and when last written. Personal, local only, not
versioned, not exported, deleted with the folder (to trash) or by Clear.

### Out of Scope
- IndexedDB, cookies, Cache Storage.
- Live `storage` events between open frames.
- Showing or editing the saved data in the UI.
- Saved data in exports ("export with my data").

---

## 8. Phase-level sections

### Edge cases across features
- Two hand edits from different features on one design at once (a text edit and a screen reorder):
  each follows its own stale rule; neither half-writes.
- A turn snapshot taken after a turn during which the user also edited by hand holds both; the version
  before the user's edit still exists separately.
- The rail and the page open on the same design: every hand edit refreshes both.

### Security & Abuse summary
- Writes come only from the user's gestures in Design Chamber's own UI; the frame reports, never
  commands (07 E1).
- Every new route: bearer, slug and containment checks, bounded bodies, sentence errors.
- Untrusted inputs: frame messages, `design.json` knobs and direction marks, source HTML,
  `page-state.json`. Each is validated where it enters.
- Personal data: only 19's saved page data; it never leaves the design's `.chamber/`.

### Out of Scope (phase)
- Drag, resize, align, properties panel, layers (Claude Design parity beyond text).
- Streaming agent edits into live boards.
- Folding auto-saves in the versions list (review finding, separate item).

### Questions for the user — answered 2026-11-11

The owner accepted all five recommended defaults in one round (recorded in the decision rows
08-6, 10-4, 11-5, 19-7 above, and in Q5 below). The questions as asked:

**Q5 decision (owner accepted):** the agent IS told about hand edits. The next message Design
Chamber sends to the linked chat (comments, ask, fix) starts with a short list of what the user
changed by hand since the last one, for example "You changed the Home headline, moved Checkout
above Pricing, saved tweaks: accent hue 210 to 250". Nothing is sent on its own, and the
instructions also tell agents to re-read a file before editing it.
1. **Who may change a canvas's screen list (10, 11)?** `docs/SPEC.md` §6.3 says the agent owns
   `screens[]`, but reorder, duplicate, trash and Keep this one must change it. **Recommended: make the
   list shared. Design Chamber writes it only for your actions, saves a version first, and refuses if
   the agent changed `design.json` since the wall loaded it; the agent stays free to rewrite it, and its
   later write wins.** Alternative: keep the order in Design Chamber's own state and let the agent's list
   be only which screens exist (two sources of truth, harder for the agent to follow).
2. **What is a set of directions on the wall (11)?** Phase 1.5 decided DirectionPick options are separate
   design folders. A row on one canvas needs them to be screens. **Recommended: directions are screens
   in the same canvas that the agent marks as directions of one screen; the row shows Current, A, B, C at
   one viewport; Keep this one on the wall is the picker; DirectionPick stays for folder directions and
   the agent may still ask in chat and act on the answer itself.** Alternative: also teach DirectionPick
   to point at canvas screens (more work, and per-screen previews do not exist yet).
3. **Saved page data: scope and size (19).** **Recommended: one store per design, shared by all its
   screens and viewports on the rail and the page, capped at 1 MB per design, with a one-time notice when
   a design goes over.** Alternatives: one store per screen; a smaller (256 KB) or larger (5 MB, the
   browser's usual) cap.
4. **What a click does in Edit mode once the toolbar exists (08).** Today a click opens the comment box.
   **Recommended: a click still opens the comment box, with the toolbar (Edit text, Comment, Ask agent)
   above the element; double-click on text goes straight to editing.** This keeps commenting at today's
   step count. Alternative: a click shows only the toolbar and Comment is one more click.
5. **Should the agent be told about your hand edits (08, 09, 10, 11)?** If not, an agent working from
   memory can write over them. **Recommended: yes. The next message Design Chamber sends to the linked
   chat (comments, ask, fix) starts with a short list of what you changed by hand since the last one,
   for example "You changed the Home headline, moved Checkout above Pricing, saved tweaks: accent hue 210
   to 250". Nothing is sent on its own, and the instructions also tell agents to re-read a file before
   editing it.** Alternative: rely on the re-read instruction alone.

### Open Questions (for the architect unless noted)
- **Version noise from hand edits (07 E3). RESOLVED 2026-11-11: coalescing accepted.** A burst of hand
  edits within 60 s (no other writer in between) shares one "Before your edits" version holding the state
  before the burst; intermediate states are reached by Undo, not as separate Versions entries. Nothing is
  lost (the pre-burst state is always versioned, Undo steps back through the burst). Recorded in E3/E9.
- **Locating text in the source (07 E2, 08).** How certain "the exact one" must be (duplicate text,
  whitespace, entities) is the architect's call; the user-facing rule is: refuse rather than guess.
- **Storage stand-in on every platform (19).** The spike ran in Chromium; confirm in OpenChamber's
  Electron on Linux, Windows and macOS before building.
- **Preview without reload (09-4).** How tweak values reach a live frame without a reload, and what
  happens to artboards unloaded by the frame budget (§8.4) when they come back.
- **Knob and direction contract (09, 11).** Field names and validation in `design.json` and the
  matching instruction text (architect with the rules author; WP0 change through the main agent).
- **Copy for the hand-edit list (Q5)** if the owner says yes: wording and cap inside the 16 000-char
  revision limit (§11.4).

### Handoff
Recommended next: relay the five questions; meanwhile dispatch **C1** (fullstack-developer, S) and have
the architect design **07** and **19**. Complexity: phase **L** (07 L; 08, 09, 10, 11, 19 M; C1 S).

### Final self-check
- [x] Every ambiguity asked (5) or listed under Open Questions.
- [x] Each feature has edge cases and a security and abuse pass.
- [x] All roles per feature, including first run and a changed designs folder.
- [x] Acceptance criteria are testable.
- [x] No schemas, component names or technology choices; owner direction quoted as given.
