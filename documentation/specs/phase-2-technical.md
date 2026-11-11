# Phase 2 · Edit on the canvas: technical design

Architect, 2026-11-11, branch `feat/phase-2`. Status: **revised after review** (second architect: APPROVE
WITH FIXES; every should-fix, nit and FYI answered in place, product decisions on coalescing, single-slot
Ctrl/⌘+Z and Clear folded in), then **updated after the owner's mockup approval** (rail Tweaks as a bottom
sheet, rail direction rows as a 2×2 grid, and the mockup review's spec-level findings: the disabled reason inside
the menu option, text-only menus, the app-wide contrast step, one dominant primary, the missing state boards,
feature 19 on canvases), ready for the main agent's task breakdown. Requirements input: `documentation/specs/phase-2-edit-on-canvas.md`
("PS" below, with its section and rule numbers: E1 to E12, 08-1 to 08-6, 09-1 to 09-7, 10-1 to 10-6, 11-1 to
11-5, 19-1 to 19-7, Q5). Owner decisions: `docs/BRIEF.md` "Owner decisions (2026-11-11, Phase 2)". Until the
`docs/SPEC.md` update in §15 lands, `docs/SPEC.md` stays the authority; where this design changes it, §15
names the paragraph.

Scope: features 07, 08, 09, 10, 11 (canvas half) and 19, the cross-cutting edit machinery, the Q5 hand-edit
ledger, the WP0 contract changes, the agent instruction text, the SPEC update plan and the work packages.
C1 is being built in parallel (`src/service/check/analyze.ts`, `src/guest/probe/probe.ts`, test fixtures);
nothing here edits those files, and the one check-engine change (§4.7, `tweak-broken`) lands after C1.

---

## 0. Decisions this design makes

| # | Decision | Why (senior ladder) |
|---|---|---|
| AD-1 | **One write route**, `POST /designs/:slug/edits`, with an `op` union (`text`, `tokens`, `reorder`, `duplicate`, `trash-screen`, `keep-direction`), and one pipeline in `src/service/edits/` that every hand edit runs through. Undo is `POST /designs/:slug/edits/:id/undo`. | One place enforces E3 to E10 for all four features; a route per feature would repeat the version, stale, echo, undo and ledger steps four times. |
| AD-2 | **The service computes the bytes it writes.** The page sends what the user saw (the file's sha256, a locator, the text the editor started with, the new text); the service re-locates in the same bytes (equal hash, so the same answer), escapes, splices and re-verifies the result. The page runs the same pure locator only to fill the editor and the disabled reasons. | E2 holds (the source decides, never the DOM) and E6 is enforced at the write itself, so a page bug cannot inject markup. Sending offsets would make the page's arithmetic part of the trust boundary. |
| AD-3 | **Serialization reuses what exists.** Every hand edit runs inside the versions service's per-slug chain (`chained` in `src/service/versions.ts`), extended with `userEdit`; screen-list writes also take the store's per-slug lock (`withLock` in `src/service/store.ts`). Against the agent (who takes no lock) every write is a compare-and-swap at the rename: `replaceFileIfHashUnchanged`, the bytes generalisation of `replaceFileIfUnchanged` (`src/service/paths.ts:254`). | No new lock system. Snapshots, restores and hand edits of one design already serialize on that chain; the CAS primitive is the one the design.json two-writer merge already trusts. |
| AD-4 | **Version coalescing** (product decision, PS E3 resolved): the "Before your edits" snapshot is skipped when the design's tracked tree is exactly the tree this service's previous hand edit left (computed from what that edit wrote, never re-read from disk, §2.4), and that edit was less than `USER_EDIT_COALESCE_MS` (60 s) ago. Otherwise a snapshot is taken (and the existing tree-hash dedupe still applies). One burst of hand edits shares one version holding the pre-burst state; the states inside the burst are reached by Undo, not as Versions entries. | A burst of ten text fixes costs one "Before your edits" version plus the quiet-period auto version after it, instead of ten; nothing from before the burst, and nothing any other writer left, is ever missing from Versions. |
| AD-5 | **Undo is a recorded reverse operation**, not a version restore: splices with the removed bytes, the previous `screens` value, and file moves, each guarded by the sha256 of what this edit left. Kept in `.chamber/edits.json`, so it survives a service restart. | Exact bytes (E9), no restore-point noise in Versions, works with coalescing (the state between two coalesced edits is in no version). |
| AD-6 | **The service announces its own writes** with `origin: "user"` on the change event (carried through `ChangeHub.emit`, `src/service/changes.ts`), and the watcher drops the echo of a file whose current bytes equal the last bytes the service itself wrote there (`self-writes.ts`; no time limit, the entry lives until the watcher sees other bytes). | E10 without a time-only heuristic: the restore quiet window (`RESTORE_QUIET_MS`) would also hide an agent write that lands inside it, and any TTL is beaten by Windows' doubled rename events and the slow poll backstop; a hash compare is neither. |
| AD-7 | **Hand-edit ledger** = structured entries in `.chamber/edits.json`, rendered to text only when `POST /designs/:slug/prompt` builds a message; the guest clears entries up to `upTo` once the message reached the chat. | Stored free text would let anything that writes the design folder inject lines into the user's prompt; structured, validated fields cannot. |
| AD-8 | **Stale tokens:** text and tokens use the sha256 of the bytes the page read (`GET /source`, `GET /tokens`); screen actions use `screensStamp` = sha256 of the raw `screens` value in design.json, plus each touched screen file's size and mtime from the detail the wall shows. | "The agent changed design.json" is read as "changed the screen list": a comment the user added, the title or `updated` must not refuse a reorder. File stamps match what the wall renders (render keys are built from size and mtime too). |
| AD-9 | **Tweak preview** is a new page-to-frame message `set-tokens`, applied by the bridge as inline custom properties on `<html>`; the same values ride in `window.__DC` for frames that load later. | No reload (09-4), unloaded artboards (§8.4 budget) come back with the preview, and nothing new can flow from the frame. |
| AD-10 | **Direction marks live on screen entries** (`screens[i].direction`), not in a separate list. | They share the screen list's stamp, ownership and validation pass; a second list could disagree with the first. |
| AD-11 | **Saved page data:** the bridge installs a `localStorage` / `sessionStorage` stand-in before any design script, seeded synchronously from `window.__DC.storage`. Writes leave the frame once per task (microtask batch); the page keeps the design's map, coalesces to at most one `PATCH` per second and pushes changes to its other frames; the service coalesces to at most one disk write per second. | `localStorage` is synchronous, so the data must already be in the frame; batching per task loses nothing when a frame is removed (no reliance on `pagehide`). Verified in Chrome 157 (§1). |
| AD-12 | **Check renders get the same stand-in with empty, unsaved storage** (CDP `Page.addScriptToEvaluateOnNewDocument`); thumbnails stay plain `file://` (native storage in a throwaway profile is already empty). | 19-3 "checks run with empty, unsaved storage"; without it a design that now legitimately uses `localStorage` fails the check with a `console-error` the viewer never shows. |
| AD-13 | **design.json writes reuse the store's merge and serializer** (`mergeServiceFields` + `serializeJson`): the formatting normalises exactly as a comment add does today; every other key's value and every unknown key stays. Byte-exact preservation (E5) is for HTML and `tokens.css`. | Same writer for all service writes of design.json; PS §5 asks for "other fields and unknown keys intact", which this meets. |

---

## 1. Facts verified this session

| Fact | Evidence |
|---|---|
| A stand-in defined with `Object.defineProperty(window, 'localStorage', { value, configurable: true })` replaces the throwing accessor in a `sandbox="allow-scripts"` blob frame nested in a page served with OpenChamber's guest CSP + `sandbox allow-scripts`; bare `localStorage`, `window.`, `self.` and `globalThis.localStorage` all reach it; `'localStorage' in window` is true; native access threw `SecurityError` first; the own descriptor was `{ configurable: true, get }` on the window object (none on `Window.prototype`); `sessionStorage` the same; `indexedDB.open` still throws `SecurityError`. | Spike `/tmp/dc-spike-storage/run.mjs` (harness after `test/e2e/bridge.test.ts`), Google Chrome 157.0.8103.50, Linux, 2026-11-11. Not committed (spikes are not part of this deliverable); the builder re-proves it in `test/e2e/bridge.test.ts` (§17). |
| Delivery of a `postMessage` from an iframe's `pagehide` while the page removes that iframe: **not verified** (the headless dump never showed the message). | Same spike. AD-11 is designed so it is not needed. |
| In Edit mode the artboard `<iframe>` has `pointer-events:none` and the page asks `hit-test` on hover and click. So a double-click is seen by the page, not the frame. | `docs/SPEC.md` §8.3; `src/ui/wall/hit-controller.ts:47-60`; `src/ui/wall/input-controller.ts:204` (label `dblclick` already handled on the page). |
| `GET /source` decodes with `Buffer.toString('utf8')`, which keeps a BOM as U+FEFF and turns invalid bytes into U+FFFD. | `src/service/routes/render.ts:43-57` |
| `replaceFileIfUnchanged` compares decoded strings and renames synchronously. | `src/service/paths.ts:254-284` |
| The versions service serialises snapshot and restore per slug (`chained`); `snapshotNow` takes `keep` and `required`; dedupe by tree hash. | `src/service/versions.ts:479-602` |
| Version reasons are only checked as strings when the index is read, so new reasons do not make an older build drop entries; `reasonLabel` is an exhaustive switch. | `src/service/versions-index.ts:56`; `src/ui/model/versions-model.ts:8-21` |
| The watcher emits `design` for design.json and `files` for the rest after a 250 ms debounce; it skips every dot path except `.chamber/check.json`. | `src/service/watch.ts:317-344`, header comment |
| A `files` event with no `files` list is a restore; build activity and Work Status treat listed files inside `RESTORE_QUIET_MS` (3 s) after it as its echo. | `src/shared/build-activity.ts:1-16`; `src/service/status-designs.ts:119-143`; `src/guest/build-activity.ts:111-130` |
| `tokens.css`, `assets/**` or `index.html` changes reload every artboard; a screen file reloads its row. | `src/guest/store.ts:71-90` |
| The live mini-frame thumbnail builds a frame document with `createFrameDocument(..., { artboardId: 'thumb', mode: 'play' })`. | `src/ui/components/thumb.ts:94` |
| The rendering section that tells agents not to assume `localStorage` is generated in `rules-doc.ts` (`renderingSection`, shared with the bundled skill) and the rule also sits in `rules/DESIGN-RULES.md:99`; three snapshot files hold it. | `src/shared/agent/rules-doc.ts:258-270`; `rules/DESIGN-RULES.md:99`; `test/agent/__snapshots__/{rules.check-command,rules.canvas-project-preset,skill.bundled}.md` |
| The check render test currently asserts that `localStorage` throws (`console-error`). | `test/service/check/render.e2e.test.ts:100-112` |
| The kit has no slider; Edit/Play uses `mountTabs`; `confirmDialog` has one confirm and Cancel; the icon set has `pencil`, `comment`, `chat`, `plus`, `more`, `copy`, `trash`, `layers`, `check`, `reset`, `chevron`, no sliders glyph. | `node_modules/@openchamber/sdk/dist/ui/`; `src/ui/wall/design-view.ts:192`; `src/ui/components/kit.ts:348`; `src/ui/components/icons.ts` |
| Transient notices have ids `export` and `restore` only. | `src/ui/components/notices.ts:10` |
| Check `params.field` accepts `--accent-h` (`/^[A-Za-z0-9_.[\]-]{1,80}$/`). | `src/shared/checks.ts:193` |
| `ChangeHub.emit` takes only `{ slug, kind, files? }` and rebuilds the event, so any other field is dropped today. | `src/service/changes.ts:39-41`; interface `src/service/context.ts:125` |
| `resolveInside` answers the **realpath** of the target (deepest existing ancestor), so an `lstat` on its answer never sees a link. | `src/service/paths.ts:90-133` |
| The design.json mirror gives up after `MIRROR_ATTEMPTS` (5) lost races with only `log.warn('store.design-json-busy')` and returns normally. | `src/service/store.ts:75`, `:274-304` |
| `snapshotNow({ required: true })` throws `ApiError('invalid')` worded for restore when over the caps, `ApiError('invalid', UNSUPPORTED)` for a newer build's index, and `ApiError('conflict')` when the snapshot stays torn after two attempts. | `src/service/versions.ts:147`, `:473-477`, `:520-559` |
| `computeTree` hashes design.json as `serializeJson(stripForVersion(parsed))` (verbatim when unparseable); `treeOf` caches on a size+mtime fingerprint and otherwise re-hashes every tracked file. | `src/service/versions.ts:119-139`, `:491-505` |
| The live mini-frame thumbnail uses `sandbox: ''`: no script runs in it at all. | `src/ui/components/thumb.ts:94-95` |
| The router caps a request at `SERVICE_REQUEST_BODY_MAX_BYTES` (80 000 UTF-8 bytes); uploads split so each chunk is ≤ 60 000 JSON-escaped chars and ≤ 75 000 bytes. | `src/shared/limits.ts:91-93`, `:107-111`; `src/guest/service-client.ts:145-178` |
| The owned-field lists agents read omit `tweaks`: the chip step 7, the guide's design.json paragraph, the bundled skill's workflow line. | `src/shared/agent/chip.ts:118`; `src/shared/agent/guide.ts:158-159`; `src/shared/agent/skill-doc.ts:35` |
| The guide at `<root>/AGENTS.md` is rewritten whenever its expected text changes and the file on disk is still ours and unedited (`outdated` → replace); no version marker is involved. `buildSkillDoc` (`guide.ts:212-245`) only classifies an old installed skill copy for removal. | `src/service/agent-setup.ts:304-336`, `:374-400`; `src/shared/agent/ownership.ts:16` |
| `DrawerKind` is `'comments' \| 'versions'` in the view context. | `src/ui/wall/view-context.ts:24` |
| `test/shared/api.test.ts` asserts 44 routes. | `test/shared/api.test.ts:8` |

---

## 2. The edit machinery (feature 07)

### 2.1 Data changes

**New file `<design>/.chamber/edits.json`** (service-owned; never versioned, exported, sent or mirrored,
because `.chamber/**` is excluded by `isTracked` and the export, §6.1, §6.4). Schema `design-chamber/edits@1`:

```jsonc
{
  "v": 1,
  "seq": 18,                       // last ledger seq handed out (monotonic per design, survives clears)
  "ledger": [ HandEdit, … ],       // oldest first, ≤ HAND_EDITS_LEDGER_MAX (30); `dropped` counts the rest
  "dropped": 0,
  "undo": [ UndoRecord, … ]        // newest last, ≤ USER_UNDO_KEEP (10), each ≤ USER_UNDO_TTL_MS (30 min) old
}
```

- Path: `resolvePlainTarget(dir, ['.chamber', 'edits.json'], { allowAbsent: true })` (§2.3; refuses a
  `.chamber` folder or an `edits.json` that is a link, judged on the lexical path), then
  `writeFileAtomic(…, { createDirs: false })` after the same `.chamber` folder check `store.writeState` does
  (a non-recursive `mkdir`, so a deleted design is never re-created).
- Read: regular file, ≤ `EDITS_FILE_MAX_BYTES` (256 KiB), JSON, then `parseEditsFile` (pure, in
  `src/service/edits/file.ts`) keeps only entries that validate (below); anything else reads as an empty
  file (`log.warn('edits.file-unreadable', { slug })`, never the content). The next write replaces it. A
  link answers as an empty file and every write refuses (logged `edits.file-link`).
- **One writer per design: the edits-file queue.** `createEditsFile({ log, now })` in
  `src/service/edits/file.ts` exposes `read(slug, dir)` (no queue: the file is replaced atomically, a read
  sees a whole old or new file) and `update(slug, dir, mutate: (file: EditsFile) => EditsFile)`, a per-slug
  promise chain (the `chained` pattern of `src/service/versions.ts:481-490`, its own map). **Every
  read-modify-write of edits.json goes through `update`**, which re-reads the file inside the queue, so no
  caller ever writes a copy it read earlier: the pipeline's append of an UndoRecord and HandEdit (inside
  `userEdit`'s apply), undo's removal of its record and ledger entry, the expiry prune, and
  `POST /hand-edits/clear`. Lock order is always versions chain → edits queue, never the reverse (the clear
  route takes only the queue), so the two cannot deadlock, and a clear never waits behind a snapshot.

`HandEdit` (types.ts, §8.1), structured so the prompt text is built from validated fields at prompt time:

```jsonc
{ "seq": 17, "at": "ISO", "editId": "e_…", "kind": "text",
  "file": "screens/home.html", "screen": "Home", "before": "Ship faster", "after": "Ship it faster" }
{ "kind": "tweaks", "changes": [ { "label": "Accent hue", "before": "210", "after": "250" } ] }
{ "kind": "reorder", "moved": "Checkout", "above": "Pricing" }        // single move; `above` null = to the end
{ "kind": "reorder-many", "order": ["Home", "Checkout", "Pricing"] }  // several moves at once (≤ 40 titles)
{ "kind": "duplicate", "screen": "Home", "copy": "Home copy", "file": "screens/home-copy.html" }
{ "kind": "trash", "screen": "Pricing", "file": "screens/pricing.html" }
{ "kind": "keep", "screen": "Home", "letter": "B", "name": "Editorial" }   // letter null = kept Current
{ "kind": "undo", "of": "Text updated in Home" }
```

Field rules (`parseHandEdit`): titles, labels and names one line, ≤ `HAND_EDIT_QUOTE_MAX` (80) after
`oneLine` and clipping; `before`/`after` the same; `file` matches `index.html`, `tokens.css`, `design.json` or
`screens/<SCREEN_ID_PATTERN>.html`; `letter` A to D or null; `seq` a positive integer; `editId`
`EDIT_ID_PATTERN`.

`UndoRecord` (service-only type, `src/service/edits/file.ts`):

```jsonc
{ "id": "e_…", "at": "ISO", "label": "Text updated in Home", "ledgerSeq": 17,
  "steps": [ UndoStep, … ] }       // applied in reverse order on undo
// UndoStep:
{ "kind": "splice", "file": "screens/home.html", "start": 1234, "inserted": 14, "removed": "Ship faster",
  "afterSha": "<sha256 of the file this edit left>", "beforeSha": "<sha256 before>" }
{ "kind": "screens", "before": <the raw screens JSON value>, "afterStamp": "<screensStamp after>" }
{ "kind": "move", "from": "screens/pricing.html", "to": ".trash/<name>.html", "sha": "<sha256 of the moved bytes>" }
{ "kind": "create", "file": "screens/home-copy.html", "sha": "<sha256>" }
{ "kind": "comments", "moves": [ { "id": "c_…", "from": "home-b", "to": "home" } ] }
```

`start` and `inserted` are UTF-16 offsets in the decoded text (the same unit the splice was made in, §3.4);
`removed` is the raw source text that was replaced (≤ `TEXT_EDIT_MAX` × 8 chars, so entity-heavy text still
fits). `to` paths of `move` steps are root-relative only for the trash (`.trash/…`), design-relative
otherwise; `parseEditsFile` accepts only these shapes: design-relative `index.html`, `tokens.css`,
`screens/<id>.html`; root-relative `.trash/<slug>.<screenId>-<yyyymmddhhmmss>[-n].html` whose `<slug>` is this
design's own slug. Every path is resolved with `resolvePlainTarget` (§2.3) again at undo time.

**Version reasons** (types.ts): `'user-edit'` (label "Before your edits", plural: one version per burst,
AD-4) and `'keep-direction'` ("Before keeping a direction"). No `label` field is used for them; `reasonLabel` maps them. Old designs have neither;
an older build lists them with the raw reason text (cosmetic, §14).

**No other new files.** The coalescing state and the self-write registry are memory only (§2.4, §2.6).

### 2.2 Service routes

All four routes are registered in a new `src/service/routes/edits.ts` (`registerEditRoutes(router, ctx)`),
behind the router's constant-time bearer check (`src/service/http.ts`), with the router's 80 kB body cap.
Every handler first resolves the design with `ctx.store.get(slug)` / `ctx.store.dir(slug)`, which runs
`assertSlug` (regex) and `resolveInside(root, [slug])` plus `isDesignFolder` (containment), and answers
`not-found` with "That design is no longer in your Designs folder." (the PS 07 sentence, replacing the
store's "That design does not exist." for these routes only, so the user reads the same words everywhere
an edit is refused). No route takes a path: targets are named by screen id, op name or fixed file name.

| Method & path | Request | Response | Notes |
|---|---|---|---|
| `POST /designs/:slug/edits` | `EditRequest` (§10.2): one op | `EditResponse { edit: { id, label, files, undoable }, version: VersionSummary \| null, coalesced: boolean, stamps: { file?, tokens?, screens? }, created?: { id, title } }` | 400 malformed op · 404 gone · 409 `stale` (per-op sentence, §2.8) · 409 `conflict` (Windows lock) · 413 `too-large` · 422 `invalid` (cannot place, not UTF-8, version first failed, design.json unreadable) · 500 `internal` (disk, `folderErrorSentence`) |
| `POST /designs/:slug/edits/:id/undo` | `{}` (anything else 400) | `UndoEditResponse { files, stamps, version }` | `:id` must match `EDIT_ID_PATTERN` (400); unknown or expired → 404 "This edit can't be undone any more."; stale → 409 with the E9 sentence |
| `GET /designs/:slug/tokens` | — | `TokensResponse` (§4.2) | read only |
| `POST /designs/:slug/hand-edits/clear` | `{ upTo: number }` (positive integer ≤ current `seq`) | `{ ok: true }` | removes ledger entries with `seq ≤ upTo` through `editsFile.update` (§2.1); idempotent |

`GET /designs/:slug/source` gains `sha256` (of the raw bytes), `utf8` (`Buffer.from(text, 'utf8')` equals
the bytes) and `link` (`isPlainTarget(designDir, segments)` from §2.3 is false: the file or a folder on its
way is a link, so the page disables **Edit text** before the user types, §3.3); existing callers ignore all
three. `GET /designs/:slug` gains `screensStamp: string | null` and
`designJson: 'ok' | 'missing' | 'invalid'` (§5.2).

### 2.3 Writable set (07-7) and containment (E7)

`writableTarget(record, op)` (pure, `src/service/edits/pipeline.ts`) maps an op to design-relative paths and
refuses anything else:

| Op | May write | May move into `<root>/.trash` |
|---|---|---|
| `text` | the page's `index.html`, or `screens/<id>.html` for a screen id in the normalised list | no |
| `tokens` | `tokens.css` | no |
| `reorder` | `design.json` (`screens` key only) | no |
| `duplicate` | a new `screens/<freeId>.html`, `design.json` | no |
| `trash-screen` | `design.json` | `screens/<id>.html` |
| `keep-direction` | `screens/<of>.html` (by rename), `design.json`, comments in state.json | the group's other screen files |

Each path is split on `/` and resolved with **`resolvePlainTarget(base, segments, { allowAbsent })`**, new
in `src/service/paths.ts` beside `resolveInside` (over the same `ContainmentDeps` plus an optional `lstat`
dep, so it is tested with fake `realpath`/`lstat` and both path flavours; the comparison is the existing
`samePath`, `src/service/paths.ts:53`, with the same case rule `resolveInside` uses):

```
resolvePlainTarget(base, segments, { allowAbsent }):
  real    = resolveInside(base, segments)            // containment; answers the realpath (§1), links out refused
  lexical = path.resolve(base, ...segments)          // what the name says, no link followed
  if !samePath(real, lexical, p, platform)           // case rule of foldsCase, as resolveInside
      → throw ApiError('invalid', LINK_SENTENCE)      // the leaf or any folder on the way is a link or junction
  info = lstat(lexical)                              // ENOENT → allowed only when allowAbsent (a create, a move destination)
  if info exists and !info.isFile() → throw ApiError('invalid', LINK_SENTENCE)   // a folder, FIFO or device is not editable
  return lexical
isPlainTarget(base, segments) = resolvePlainTarget(…) succeeded, as a boolean (for GET /source's `link`)
```

`LINK_SENTENCE` = "This file is a link, so Design Chamber can't edit it here. Ask the agent instead." The
comparison is what catches a link **inside** the design (`screens/home.html → ../index.html`, or a `screens`
folder that is a link): `resolveInside` alone accepts those, because their realpath stays inside, and an
`lstat` of its answer would see the link's target, a regular file. A link is refused even when it points
inside the design, because a rename would replace the link, not its target. `base` is the design's
`record.path` (already a realpath, so a design folder reached through the root's own realpath compares
equal). The same function guards `.chamber/`, `edits.json` (§2.1) and `page-state.json` (§8.1). Tests
(`test/service/core/paths.test.ts`, failing first): a leaf link inside the design → refused; a link parent
folder inside the design → refused; a link out → refused by `resolveInside`; a regular file → its lexical
path; an absent leaf with and without `allowAbsent`; win32 flavour with a realpath differing only in case →
accepted, differing by a junction → refused; a directory at the leaf → refused. The trash folder is
`resolveInside(settings.root(), ['.trash'])`,
created with `mkdir` (recursive) only there, as `store.trash` does. `assets/**`, `DESIGN.md`, `.chamber/**`
(except the service's own files), `.versions/**` and anything outside the design are unreachable because no
op names them.

### 2.4 The pipeline

`createEditService({ store, versions, hub, selfWrites, settings, log, now })` in
`src/service/edits/pipeline.ts`, reached through `ensureEditService(ctx)` (the WeakMap pattern of
`ensureVersionsService`, `src/service/versions.ts:812-819`). It takes `ops?: OpModules` (default: the real
map below), so the pipeline is tested with a fake op before any real op exists.

**Op modules (one interface, one file per feature).** The pipeline dispatches on `request.op` through a fixed
map built in `pipeline.ts`: `text → ops-text.ts`, `tokens → ops-tokens.ts`, `reorder | duplicate |
trash-screen | keep-direction → ops-screens.ts`. Each module exports one `OpModule` (types in
`src/service/edits/op-module.ts`, new, created with the pipeline):

```ts
type OpInput<R> = { slug: string; record: DesignRecord; dir: string; request: R; store: DesignStore;
                    trashDir: () => Promise<string>; now: () => Date };
type PlannedStep =                                     // executed by the pipeline, never by the module
  | { kind: 'write';   rel: string; expectSha: string; bytes: Uint8Array; undo: UndoStep }
  | { kind: 'create';  rel: string; bytes: Uint8Array; undo: UndoStep }
  | { kind: 'move';    from: Place; to: Place; expect: { sha: string } | FileStamp; undo: UndoStep }  // Place = design-relative or `.trash/…`
  | { kind: 'screens'; expectStamp: string; mutate: (raw: JsonValue | undefined) => JsonValue[]; undo: (afterStamp: string) => UndoStep }
  | { kind: 'comments'; moves: { from: string; to: string }[]; undo: (moved: { id: string; from: string; to: string }[]) => UndoStep };
type HandEditBody = DistributiveOmit<HandEdit, keyof HandEditBase>;   // the pipeline adds seq, at, editId
type OpPlan = { label: string; detail?: string; steps: PlannedStep[]; ledger: HandEditBody; created?: { id: string; title: string } };
type OpModule<R extends EditRequest = EditRequest> = { plan(input: OpInput<R>): Promise<OpPlan> };  // reads, stale checks, verifies; writes nothing
// ops-tokens.ts also exports readTokens(record, dir): Promise<TokensResponse> for GET /tokens.
```

T2b creates all three op files as **stubs** against this interface (`plan` and `readTokens` throw
`ApiError('internal', 'This part of Design Chamber (edits) is not built yet.')`), already wired in the map and
in `GET /tokens`; T3, T4 and T5 each replace only their own file (§16), so no two tasks edit the dispatch.

```
apply(slug, request):
  validate request shape (op table, §10.2)           → 400 on anything else
  record = store.get(slug)                           → 404 gone
  return versions.userEdit(slug, reasonOf(op), {     // per-slug chain (AD-3)
    precheck: async () => {                          // before any version is taken
      plan = ops[request.op].plan({ … })              // reads every target through resolvePlainTarget (≤ caps),
                                                     // stale check against the request's stamps, plans, verifies (§3.4)
                                                     // → 413 / 422 / link sentence / 409 stale; nothing written, no version
      return plan
    },
    apply: async (plan, preTree) => {                // after the version; preTree = the tree userEdit read (below)
      written = []                                   // [rel, bytes | null] for every tracked file this edit left
      for each step in order:
        selfWrites.record(slug, rel, sha256(bytes) | null) right before its rename (§2.6; writeScreens and
          moveComments call the pipeline's beforeRename hook for design.json, §5.1)
        execute (CAS per file against the hash read in precheck, §2.5; moves and creates by moveNoReplace, §2.5)
        push [rel, bytes | null] to written
      on a failure, roll back the steps done (§2.9)
      hub.emit({ slug, kind: 'files', files, origin: 'user' })  and/or  hub.emit({ slug, kind: 'design', origin: 'user' })
      editsFile.update(slug, dir, f => appendUndoAndLedger(f, record, entry), prune by count and age)   // §2.1 queue
        (a failure here is logged; the edit stands and the answer says undoable: false, so the notice has no Undo)
      return { response: EditResponse, written }
    },
  })
```

Undo (`undo(slug, id)`) runs through the same `userEdit` with reason `user-edit` (so it is coalesced or versioned
like any hand edit): precheck = read the record (`editsFile.read`) and check its guards (hashes, stamps, absent
destinations), apply = the reverse steps, then `editsFile.update` removes the record and updates the ledger
(§7.1). A second undo of the same id, queued behind the first in the chain, finds no record → 404.

`versions.userEdit(slug, reason, { precheck, apply })` is the one new method on `VersionsService`
(`src/service/versions.ts`), running inside `chained(slug, …)`:

```
userEdit(slug, reason, { precheck, apply }):
  plan = precheck()                                           // throws: nothing written, no version
  tree = treeOf(slug, dir)                                    // preTree: the tree this edit starts from
  last = coalesce.get(slug)                                   // memory: { afterTree, at }
  if reason == 'user-edit' and last and now - last.at ≤ USER_EDIT_COALESCE_MS and last.afterTree == tree.treeHash:
      version = null; coalesced = true                        // AD-4
  else:
      try version = snapshotNow(slug, reason, { required: true }) ?? newest entry   // null = deduped: newest holds these files
      catch SnapshotRefusedError e → map e.refusal to its §2.8 row (422, or 409 stale for 'torn'); nothing written
      (any other error propagates: 500 with the folder sentence)
  { response, written } = apply(plan, tree)                   // a CAS loss here throws stale: the version stays (it holds the current files, harmless)
  treeCache.delete(slug)
  if reason == 'user-edit':
      coalesce.set(slug, { afterTree: treeHashOf(swap(tree.files, written)), at: now })
  else coalesce.delete(slug)                                  // keep-direction: the next hand edit takes its own version
  return { version, coalesced, response }

swap(files, written):  copy of files; for each [rel, bytes] in written with isTracked(rel):
  bytes == null → delete rel; else files[rel] = trackedHashOf(rel, bytes)
```

- **`afterTree` is never re-read from disk.** It is the pre-apply tree with only the hashes of what this edit
  wrote swapped in, so an agent write that lands between the apply and the next edit (to any file, target or
  not) makes the next edit's tree differ from `afterTree`, and that edit takes its own "Before your edits"
  version, which holds the agent's state. Two pure helpers are exported from `src/service/versions.ts` and
  used by `computeTree` itself, so the formulas cannot drift: `trackedHashOf(rel, bytes)` (design.json through
  `parseJsonObject` + `stripForVersion` + `serializeJson`, verbatim when unparseable; every other file its
  sha256) and `treeHashOf(files)` (the `rel\0hash\n` lines in `computeTree`'s order). A write by another program
  to a non-target file between `treeOf` and the apply is missing from `afterTree` too, so it also forces a
  version (safe side).
- **Typed snapshot refusals.** `snapshotNow` throws `SnapshotRefusedError extends ApiError` (exported from
  `src/service/versions.ts`) with `refusal: 'too-large' | 'unsupported' | 'unreadable' | 'torn'`: `too-large`
  at the caps (`:536-543`), `unsupported` from `readableIndex` (`:475`), `unreadable` for the index read and
  link-out refusals taken before any object is written (`:527-529`), `torn` after the two attempts (`:559`).
  Code and message stay exactly as today (`invalid` / `conflict` and the restore wording), so the restore
  route and its tests are unchanged; only `userEdit` reads `refusal`.
- `keep-direction` never coalesces (its own reason, always a version or the dedupe) and clears `coalesce`.
- The quiet-period auto snapshot still runs after a hand edit (the user event schedules it,
  `src/service/versions.ts:710-722`), so Versions gets an "Auto-saved" state after the burst. The coalesce
  check compares trees, so the auto version does not break a burst.
- A restore, an agent write or another program changes the tree, so the next hand edit takes a new
  "Before your edits" version. Service restart forgets `coalesce`: the next edit takes a version (safe side).
- Inside a burst, each edit still has its own undo record (§2.1, up to `USER_UNDO_KEEP`), so Undo steps back
  through the burst; Versions holds the state before it (product decision, PS E3/E9).
- **Pruning** (100 versions) needs no new rule: Undo does not use versions (AD-5), and a "Before your edits"
  version is pruned only after 100 newer versions, which coalescing makes impossible inside one notice's 10 s.
  The E9 refusal sentence points at Versions; if that version has since been pruned, Versions still holds
  every later state.

### 2.5 Compare-and-swap against the agent (E4) and two windows

New in `src/service/paths.ts`, beside `replaceFileIfUnchanged`:

`replaceFileIfHashUnchanged(file, expectedSha: string | null, data: Uint8Array): Promise<'replaced' | 'changed' | 'busy'>`
- write a dot-first temp in the same folder (`atomicTempPath`); then **synchronously** read the current bytes
  (`readFileSync`; ENOENT = `null`), compare their sha256 with `expectedSha`, and `renameSync` only on a match;
  `changed` on a mismatch (temp removed); `busy` when Windows answers EPERM/EBUSY/EACCES to the read or the
  rename (temp removed). Any other error is thrown.
- The edit pipeline retries `busy` 3 times with 40/80/120 ms pauses, re-checking the hash each time, then
  answers 409 `conflict` "Another program is using this file. Close it and try again."
- `expectedSha` is always the hash the service itself just read inside the chain, which the request's stamp
  was compared with, so the agent's write between the stamp check and the rename is caught; the remaining
  window is the synchronous compare-and-rename itself (same residual as the design.json merge, §14).

**Creates and moves never overwrite: `moveNoReplace(from, to): Promise<'moved' | 'exists' | 'busy'>`**, new
in `src/service/paths.ts`. A check-then-`rename` is not enough: `rename` replaces an existing destination on
POSIX and through libuv on Windows, so a file that appears between the check and the rename would be lost.
- First an `lstat` that the source still has the recorded size and mtime (and, for undo, the recorded
  sha256); else `stale`.
- Then `link(from, to)` (a hard link: atomic, fails with `EEXIST` when `to` exists → `'exists'`, answered as
  `stale`), then `unlink(from)`. When the `unlink` fails (a Windows lock: EPERM/EBUSY/EACCES), the new link
  is removed again (`unlink(to)`) and the answer is `'busy'` (the pipeline's retry, then the conflict
  sentence); the file is never left at both names.
- **Fallback** when the filesystem has no hard links (`link` answers `EPERM`, `ENOTSUP`, `ENOSYS` or
  `EXDEV`, e.g. FAT/exFAT drives, some network shares, a trash on another volume): `lstat(to)` must be
  ENOENT, then `renameWithRetry(from, to)` (which already rides out Windows locks). The residual race (a file appearing in that
  microsecond window) is the same as today's design.json merge (§14).
- A **create** (duplicate) writes a dot-first temp in the destination folder and publishes it with
  `moveNoReplace(temp, dest)`; `'exists'` removes the temp and answers stale.
- Hard links keep the inode, so the moved file keeps its mtime and the wall's file stamps match what it
  rendered. Tests in `test/service/core/paths.test.ts`: destination appears before the call → `exists`,
  nothing overwritten; source locked for unlink (fake `unlink`) → `busy` with only the source left; `link`
  answering `ENOTSUP` → fallback path.

Two hand edits at once (rail and page, or two quick clicks): both enter the per-slug chain; the second sees
the first's result, its stamp no longer matches, and it is refused as stale (or, for the same window, it
carries the stamp the first answer returned, §2.10). Never a mixed file.

### 2.6 Telling the user's writes from the agent's (E10)

New `src/service/self-writes.ts`, `createSelfWrites()` (no clock: nothing expires by time):
- `record(slug, rel, sha256 | null, size | null)`: remembers the **last** bytes the service itself left at
  `rel` (`null` = removed or moved away); one entry per `(slug, rel)`, a later record replaces it; at most
  `SELF_WRITES_MAX` (1 024) entries, least recently recorded dropped first. Files over `SOURCE_TEXT_MAX`
  bytes are never recorded (no edit writes them).
- `isEcho(slug, rel, dir): Promise<boolean>`: true when an entry exists and the file **now** matches it:
  absent for `null`; for a hash, first the size from `stat` (a different size is not an echo, no read), then
  the sha256 of the current bytes. The entry is **not consumed** and has **no time limit**, so Windows
  reporting one rename as two events in separate debounce flushes, and the OneDrive/network poll backstop
  seeing the change ~30 s later, both still read as the echo.
- `forget(slug, rel)`: called by the watcher when `isEcho` answered false for that file: the file has moved
  past the service's write, so a later write by anyone that happens to restore the user's bytes is shown
  (without this, agent writes B, then A again, the second would be hidden and the wall would keep B).
- `forgetDesign(slug)` on `removed`, and `clear()` on a root change.

`src/service/watch.ts` `flushSlug` (`:317-344`) filters its batch (the listed files plus the fingerprint
additions) through `selfWrites.isEcho` before emitting: a `design.json` that is an echo emits no `design`
event; listed files that are echoes are dropped from the `files` event (no event when none remain). An agent
writing exactly the bytes the user's edit left changes nothing on screen, so hiding that event loses nothing.
The pipeline emits the user's own events directly after the write (no 250 ms debounce, so E8's 2 s holds with
room), with `origin: "user"`.

**`origin` through the hub (WP0).** `ChangeHub.emit` gains `origin?: 'user'` in its input
(`src/service/context.ts:125`), and `createChangeHub` copies it into the event it builds
(`src/service/changes.ts:39-41`, `...(input.origin ? { origin: input.origin } : {})`), so the ring, every
in-process listener and `GET /changes` carry it. Tests: `test/service/core/changes.test.ts` (an emitted
`origin: 'user'` is in `waitFor`'s events and in a subscriber's event; an event without it has no `origin`
key), `test/service/core/routes.test.ts` (`GET /changes` answers the field).

Consumers of `origin`:
- `src/guest/build-activity.ts` `batchAgentFiles` ignores events with `origin: "user"` (no "Writing …", not
  counted in "Done. Updated N files"); the store still reloads the affected artboards (`affectedSources`).
- `src/service/status-designs.ts` `lastFile` ignores them.
- Render cache, thumbnails, static-check memo, design index and the auto snapshot react as to any event
  (they must: the files changed).
- The store's design.json reconcile subscriber runs on the user `design` event and finds nothing to merge.

`ServiceContext` gains `selfWrites` (WP0, §10.6) because the watcher (built in `compose.ts`) and the edit
service (built through `ensureEditService`) must share one registry.

### 2.7 Frontend (shared by 08 to 11)

- **Guest store** (`src/guest/store.ts`, a sequenced shared file) gains `applyEdit(slug, request)`,
  `undoEdit(slug, id)`, `loadTokens(slug)`, `clearHandEdits(slug, upTo)`; each maps errors to
  `ServiceError { code, message }` like `mutate` does. After `applyEdit` it bumps nothing itself: the user
  events from the service drive reloads, so the rail and the page refresh the same way.
- **Edit notice** (S7): `notices.setTransient('edit', node, 10_000)`; `TransientId` gains `'edit'`,
  `'tweaks'` and `'page-data'` (`src/ui/components/notices.ts:10`, order after `restore`). The node is the
  existing restore notice pattern (`components/restore-flow.ts`): title (the edit's `label`), optional
  second line, **Undo** (outline xs). Undo loading → "Undone" (5 s, no undo of the undo) or the refusal
  sentence as an error notice with no retry (the refusal is final) until dismissed.
- **Ctrl/⌘+Z, one slot** (product decision, PS E9): `wallKeyAction` (`src/ui/model/wall-input.ts`) gains
  `undo-edit` for `z` with Ctrl or Meta, without Shift, when focus is not in an input, textarea or
  contenteditable. The view keeps a single **undo slot**, `editId | null`, through a pure reducer
  `nextUndoSlot(slot, event)` in the same file: a successful hand edit made by this view mount sets it to that
  edit's id (replacing the previous one); `undo-edit` with a slot sends that undo and empties the slot
  whatever the answer; Undo pressed on that edit's notice empties it too; an edit made on the other surface
  never sets it. With an empty slot, Ctrl/⌘+Z does nothing (no beep, no notice) until a new edit is made: it
  never reaches further back. Model test in `test/ui/wall-input-model.test.ts`: edit → slot set; Ctrl+Z →
  undo sent, slot empty; Ctrl+Z again → no action; two edits then Ctrl+Z twice → only the second is undone;
  notice Undo then Ctrl+Z → no action; a refused undo still empties the slot.
- **Agent-working hint (E11)**: one muted line "The agent is working on this design. It may write over your
  edit." shown in the text editor, the Tweaks panel footer and at the top of the screen label menu while the
  build strip's phase (from `watchBuildActivity`) is `working`, `writing` or `retrying`. Colour
  `--dc-warning-text` (the stepped token, §4.6.2), size of the kit's small text. Placement per surface: the text
  editor's first line (§3.5); the Tweaks footer, above Reset/Save (§4.6, the rail sheet's pinned footer); the
  screen row menu's `lead` line (§5.4). The state boards draw each placement on rail and page.
- **Viewing a version (E12)**: every control that writes is disabled with the reason "You're viewing an old
  version." (`ctx.viewing() !== null`), in both surfaces.

### 2.8 Failure and recovery (all hand edits)

| Failure | Status | Sentence the user sees | Input kept | Way back |
|---|---|---|---|---|
| Design left the root, or was deleted | 404 | That design is no longer in your Designs folder. | yes (editor, tweak values listed, §4.4) | Open it from its folder again |
| Text file changed since read | 409 `stale` | This file changed while you were editing. Nothing was saved. | yes | **Reload and try again** (§3.5) |
| Screen list changed | 409 `stale` | The screen list changed while you were working. Nothing was changed. | n/a | the wall refreshes; act again |
| tokens.css changed | 409 `stale` | tokens.css changed since you started. Your values are still shown. | yes | **Apply to the new file** / **Discard my tweaks** |
| A tweak definition changed | 409 `stale` | The tweaks in design.json changed while you were working. Nothing was saved. | yes | panel reloads its knobs, values kept where the knob still exists |
| Undo after a later change | 409 `stale` | This file changed after your edit, so it can't be undone here. Restore the version 'Before your edits' from Versions. | n/a | Versions drawer |
| Undo record gone (30 min, pruned, file damaged) | 404 | This edit can't be undone any more. | n/a | Versions drawer |
| Version first failed: over the snapshot caps (`refusal: 'too-large'`) | 422 | Couldn't save a version first, so nothing was changed. This design is too large to keep a version (more than 1,000 files or 100 MB). | yes | remove files, or ask the agent |
| Version first failed: newer build's history (`'unsupported'`) | 422 | Couldn't save a version first, so nothing was changed. This design's versions were saved by a newer Design Chamber. | yes | update the extension |
| Version first failed: history unreadable (`'unreadable'`) | 422 | Couldn't save a version first, so nothing was changed. Design Chamber could not read this design's version history right now. | yes | try again |
| Version first failed: the design kept changing while it was saved (`'torn'`, the agent is writing) | 409 `stale` | the op's own stale sentence from the rows above (text: "This file changed while you were editing. Nothing was saved."; screens, tokens, tweaks likewise) | yes | the same way back as that stale row |
| design.json kept changing or stayed locked through `writeScreens`' 5 attempts | 409 `conflict` | Another program is using this file. Close it and try again. | n/a | retry; a multi-step op is rolled back first (§2.9) |
| File over `SOURCE_TEXT_MAX` (2 000 000 chars) | 413 | This file is too large to edit here. Ask the agent instead. | yes | **Ask agent** |
| Element text over `TEXT_EDIT_MAX` (5 000) | 413 | That's too long to edit here. Ask the agent instead. | yes | **Ask agent** |
| Not valid UTF-8 | 422 | This file isn't plain UTF-8 text, so it can't be edited here. Ask the agent instead. | yes | **Ask agent** |
| Target is a symlink | 422 | This file is a link, so Design Chamber can't edit it here. Ask the agent instead. | yes | **Ask agent** |
| Service could not place or verify the edit | 422 | Design Chamber couldn't find this text in the file exactly. Nothing was saved. | yes | **Ask agent** |
| design.json does not parse | 422 | design.json can't be read right now. Ask the agent to fix it. | n/a | Ask the agent |
| No design.json yet (provisional) | 422 | This design has no design.json yet, so its screens can't be changed here. | n/a | wait for the agent |
| Windows lock after retries | 409 `conflict` | Another program is using this file. Close it and try again. | yes | close the program, retry |
| Disk full, permission, read-only | 500 | the `folderErrorSentence` for the code (`src/service/root.ts`) | yes | free space / fix permissions |
| Multi-step op failed half way and rolled back | 500 (or the step's own 409) | Something went wrong, so nothing was changed. (When the failing step was a 409 `stale` or `conflict`, its own sentence instead, since nothing changed.) | n/a | try again |
| Multi-step op failed and the rollback failed too | 500 | Something went wrong part way. The version '<Before your edits \| Before keeping a direction>' holds everything as it was; restore it from Versions. | n/a | Versions drawer |
| Service not reachable / host timeout | (host) | Couldn't save your change. <message> Your text is still here. | yes | retry |

Every 409/413/422 is answered before any byte of a design file is written (the version may already exist,
which is harmless). Logs carry the event name, slug, op and outcome code; never typed text, file content,
knob values or comment bodies.

### 2.9 Multi-step operations and partial failure

`duplicate`, `trash-screen` and `keep-direction` touch several files. The pipeline:
1. checks every precondition first (stamps, sources exist with the recorded size and mtime, destinations
   absent, trash names free, design.json parses and the stamp matches);
2. applies the steps in a fixed order, recording each done step in memory;
3. on a failure, undoes the done steps in reverse (each a rename or the previous `screens` value), then
   answers "Something went wrong, so nothing was changed." (or the failing step's own sentence when it was a
   409 `stale`/`conflict`, such as `writeScreens` giving up after its 5th attempt, §5.1);
4. if a rollback step fails too, it stops, logs `edits.rollback-failed` (slug, op, step kind), and answers
   the "Something went wrong part way" sentence. The version taken first holds the whole prior state.

A service killed between steps leaves the same partial state with no message; the version is the recovery
(§14). No journal is built (§13).

### 2.10 Idempotency and retries

- No hand edit is retried automatically: a write is not idempotent once the stamp moved. The guest's
  `call()` timeout (host 20 s) surfaces as the "Couldn't save your change" sentence; a retry by the user
  carries the old stamp, so a write that did land the first time is refused as stale instead of applied twice.
- Undo is single-shot: the record is removed in the same chain step that applies it.
- `EditResponse.stamps` returns the new `screensStamp`, file hash or tokens hash, and the UI uses it for the
  next action on the same view at once, so Move down pressed twice does not wait for the detail refetch.
- `hand-edits/clear` is idempotent (`seq ≤ upTo`).

### 2.11 Security and threat model (07)

- **Who can start a write:** only a click or key press on Design Chamber's own controls (E1). Every call to
  `store.applyEdit` / `undoEdit` sits in a host-chrome event handler (toolbar, editor key handler, menus,
  panel buttons, notices). `frame-messages.ts` never calls them: frame messages can only change which element
  a later user gesture is about (the probe), never start, change or aim a write. Test: replay every frame
  message type, forged and valid, through `createFrameMessageHandler` with a fake store; assert zero edit calls.
- **Who decides what is written:** the service, from the file bytes (AD-2). The frame's data (tag, id, text,
  index) is a locator; the request also carries `before`, the text the editor showed, which came from the
  source, and the service refuses unless its own location gives exactly that text.
- **Token:** unchanged; the page never sees it; requests go through `serviceRequest`.
- **Abuse vectors:** forged probe to aim the edit at another element with the same text (mitigated: only
  elements whose source text equals the clicked text are candidates; the editor shows the source text; worst
  case another identical-text element changes, residual §14); write storms (single flight per control; each
  write needs a user gesture); markup injection (escaped at the write, verified by re-scan, E6); path tricks
  (no paths in requests; §2.3); symlinked targets (refused); racing the agent (CAS, §2.5); a tampered
  `edits.json` (validated shapes and patterns; it can only move files between this design and its own trash
  entries, which anything able to write that file can already do directly); prompt injection through the
  ledger (structured fields, rendered with quotes as data, §7).
- **Data exposure:** typed text and file contents never logged; `edits.json` holds short quotes of edited
  text (≤ 80 chars) for the ledger, stays in `.chamber/`, goes to the chat only inside the next message the
  user sends (owner Q5).

### 2.12 Not building (07)

- A journal for crash-safe multi-file ops: the version taken first is the recovery; the window is a crash
  between two renames.
- Locking the agent out while the user edits (07-5): CAS covers it.
- A redo stack, or Undo beyond the latest edit (PS out of scope).
- A per-op route set: AD-1.
- Byte-exact design.json writes: AD-13.

---

## 3. Edit text in place (feature 08)

### 3.1 What crosses the frame boundary

New page → frame message `edit-probe { x, y }` (frame px, the click point the page already holds). The
bridge answers `edit-probe-result { x, y, probe: EditProbe | null }`:

```ts
EditProbe = {
  tag: string;            // lower-case tag name, ≤ BRIDGE_TAG_MAX
  id: string | null;      // the element's id attribute, ≤ EDIT_PROBE_ID_MAX (200), else null
  leaf: boolean;          // childElementCount === 0
  text: string;           // normalizeText(textContent), ≤ TEXT_EDIT_MAX + 1 chars
  truncated: boolean;     // the text was longer than TEXT_EDIT_MAX
  sameIndex: number;      // index of this element among `same` below, in document order
  sameCount: number;      // how many elements are `same`; 0 = not counted (scan cap reached)
  dir: 'ltr' | 'rtl';     // getComputedStyle(element).direction
  rect: Rect;             // document px, as `hit`
}
```

`same` = elements from `document.getElementsByTagName(tag)` that are leaves, have the same id (or both
none), the same `normalizeText(textContent)` (`src/guest/bridge/anchor.ts:27`), are not the highlight
overlay and are not inside `svg`, `math` or `template` content; the scan stops after `EDIT_PROBE_SCAN_MAX`
(5 000) elements (then `sameCount: 0`). The probe is computed by a pure `editProbeOf(element, root)` in a new
`src/guest/bridge/edit-probe.ts` over the minimal `AnchorElement` interface, so it is unit-tested without a
browser. Validation in `bridge-protocol.ts` (§8.4). Both sides are untrusted towards each other in the usual
way: the page accepts the answer only from `event.source === contentWindow` with the document's nonce and
artboard id (`src/guest/frame-channel.ts`), and the answer is advisory.

The page sends `edit-probe` when a click or double-click selects an element in Edit mode (canvas) or
Comment mode (page), in parallel with fetching the source; the toolbar's **Edit text** shows a spinner until
both answer (typically < 200 ms) and stays disabled on any failure with the matching reason.

### 3.2 The source scanner and locator (`src/shared/source-edit.ts`, new, pure)

Used by the page (to fill the editor and the reasons) and the service (to write). No HTML library; a tolerant
tokenizer in the style of `bundle.ts`:

- `scanHtml(text) → ScanTree`: elements with `tag` (lower-cased), `startTag: [from, to)`, `inner: [from, to)`,
  `endTag: [from, to) | null`, `attrs` (only `id`, raw value and decoded value), `parent`, `childElements`,
  `hasComment` (a comment, CDATA or processing instruction inside `inner`), `foreign` (inside `svg` or `math`),
  `inert` (inside `template`, `noscript`, `head`, or itself one of the raw text elements below).
  Handles doctype, comments (`<!-- … -->`, unterminated → to the end), quoted attribute values containing
  `>`, void elements (`area base br col embed hr img input link meta source track wbr`), raw text elements
  (`script style textarea title xmp iframe noembed noframes plaintext noscript`: content is skipped to the
  matching end tag, case-insensitive), a stray end tag (ignored), and an end tag that closes an outer element
  (pops to it). It does **not** implement the HTML insertion modes; instead, an element is a candidate only
  when its end tag is explicit and matches (implied end tags, such as `<li>One<li>Two`, make it uneditable
  with the "can't find this text exactly" reason).
- **Self-closing:** a `/>` closes the element only inside `svg` or `math` (foreign content) or on a void
  element; on any other HTML element (`<div/>`, `<p/>`) it is ignored, as browsers ignore it, so the element
  stays open and, lacking a matching explicit end tag where the scanner expects one, is not a candidate.
- **Comments:** a comment (or CDATA, processing instruction) inside an element's `inner` sets `hasComment`,
  and `decodeText` never includes a comment's text. A comment changes the source text without changing the
  DOM text, so such an element is reason `formatted` (it has something inside besides the words), never
  `not-in-source`.
- `decodeText(raw, from, to) → { text, map }`: decodes character references with the per-character raw offset
  map. Decoded: `&#NN;`, `&#xHH;` (valid code points only; 0 and surrogates are U+FFFD, as browsers do; the
  range `&#128;` to `&#159;` (`&#x80;` to `&#x9F;`), which browsers map to Windows-1252 characters, makes the
  text **undecodable** rather than guessing the table) and
  the named set `amp lt gt quot apos nbsp copy reg trade hellip mdash ndash lsquo rsquo ldquo rdquo laquo
  raquo bull middot times divide deg plusmn euro pound yen cent sect para shy` (with `;`). An `&` followed by an
  ASCII letter or `#` that is not one of these, or a reference without its `;`, makes the text **undecodable**
  (the element is not a candidate); an `&` followed by anything else is a literal `&`.
- `editorTextOf(decoded) → { text, map }`: runs of ASCII whitespace (`[\t\n\f\r ]+`) collapse to one space and
  the ends are trimmed of **ASCII whitespace only** (never `String.prototype.trim()`, which also strips U+00A0
  and the other Unicode spaces); U+00A0 and other Unicode spaces stay as they are, so a non-breaking space
  survives an edit. `map` gives each editor character its decoded range. `normalizeText` comparisons with the
  DOM text (below) keep their existing behaviour; only the editor text and the splice use this rule.
- `locateTextTarget(scan, target: EditTarget) → { element } | { reason }`:

```
if !target.leaf                                         → reason 'formatted'
if target.truncated                                     → reason 'too-long'
same(e) := e.tag == target.tag and !e.foreign and !e.inert
           and (target.id == null ? e has no id : decoded id == target.id)
           and decodable(e.inner) and normalizeText(decoded(e.inner)) == target.text
matches = elements with same(e)                          // document order
if matches is empty                                      → reason 'not-in-source'
leaves  = matches with no childElements, no comment, an explicit end tag
if leaves is empty: reason = (any match has child elements or a comment) ? 'formatted' : 'unclear'
if leaves.length == 1                                    → that element           (certain: one source element)
if target.sameCount > 0 and leaves.length == target.sameCount
                                                         → leaves[target.sameIndex]  (same count, same order)
else                                                     → reason 'ambiguous'
```

Why this is "certain enough": a single source candidate is certain (every DOM copy with that text came from it
or from a script); with several, the frame and the source must agree on how many there are before the
document-order index is trusted, so a script that added or removed a same-text element refuses instead of
guessing. Residual: a script that reorders same-text siblings without changing their number (§14).

The DOM text and the source text are compared with the same `normalizeText` (`\s` collapse), so text-transform,
whitespace layout and entities do not cause false "made by the page's script" reasons.

### 3.3 Disabled reasons (page side, `src/ui/model/edit-text-model.ts`)

| Code | Sentence (on the toolbar, under **Edit text**) |
|---|---|
| `not-in-source` | This text is made by the page's script. Ask the agent to change it. |
| `formatted` | This has formatting inside. Ask the agent to change it. |
| `ambiguous` | This text appears more than once and the exact one can't be found. Ask the agent to change it. |
| `viewing` | You're viewing an old version. |
| `file-too-large` | This file is too large to edit here. |
| `too-long` | That's too long to edit here. Ask the agent instead. |
| `not-utf8` | This file isn't plain UTF-8 text, so it can't be edited here. Ask the agent instead. |
| `unclear` | Design Chamber can't find this text in the file exactly. Ask the agent to change it. |
| `inert` (svg, template, title, attribute text) | Ask the agent to change it. |
| `no-file` (screen not written yet) | Nothing to edit until the agent writes this screen. |
| `link` (`SourceResponse.link`, §2.2) | This file is a link, so Design Chamber can't edit it here. Ask the agent instead. |
| `loading-failed` (source or probe failed) | Couldn't read this file. <message> |

Order of evaluation: `viewing`, `no-file`, `link`, `file-too-large`, `not-utf8`, then the locator's reason.
So a linked file is refused before the user types, not at Save; the service still refuses it at the write
(§2.3) whatever the page said.
`unclear` is new copy beyond PS §3 (implied end tags, an unknown entity); flagged in the report for product
review, not an open question.

### 3.4 The write (`src/service/edits/ops-text.ts`)

Request `{ op: 'text', screen, base, target, before, after }`:
1. `screen` null on a page, a listed screen id on a canvas (else 400); file per `resolveEntryFile` (as
   `/source`, `src/service/routes/render.ts:47`).
2. Read bytes; `utf8` round-trip check (422); length ≤ `SOURCE_TEXT_MAX` (413); `sha256(bytes) == base` else
   409 stale.
3. `before`, `after`: strings ≤ `TEXT_EDIT_MAX`, no line breaks (the page turns pasted breaks into spaces), no
   control characters other than tab (400 "That text has characters that can't be saved.").
4. `scanHtml(text)`, `locateTextTarget` with `target` → must give an element (else 422 "couldn't find this
   text in the file exactly", never the page's reason: the page already checked, so a refusal here means a
   forged or buggy request) whose `editorTextOf(decodeText(inner)).text === before` (else 422).
5. Plan the smallest splice: common prefix `p` and suffix `s` of `before` and `after` (UTF-16 code units, then
   moved off a surrogate pair middle); the changed editor range `[p, before.length - s)` maps through the
   editor map and the decode map to a raw range `[rawFrom, rawTo)` of the source. When the editor range is
   empty (pure insertion), `rawFrom = rawTo` = the raw position after the editor character `p - 1` (or the
   start of the trimmed text, or, for an element whose text is empty or only whitespace, the end of its leading
   whitespace). The replacement is `escapeText(after.slice(p, after.length - s))`: `&` → `&amp;`, `<` →
   `&lt;`, `>` → `&gt;`; nothing else changes (U+00A0, quotes and every other character are written as UTF-8).
6. Verify: scan the new text; the element at the same start tag offset must still be a leaf with an explicit
   end tag, and `editorTextOf(decodeText(inner)).text === after`; the bytes before `rawFrom` and after `rawTo`
   are unchanged (string slices compared). Else 422 and nothing is written.
7. Encode the new text as UTF-8 (the BOM is the U+FEFF character, so it is kept; CRLF lines outside the range are
   untouched) and write with `replaceFileIfHashUnchanged(file, base, bytes)`.
8. Undo step `splice { file, start: rawFrom, inserted: replacement.length, removed: raw.slice(rawFrom, rawTo),
   afterSha, beforeSha: base }`; ledger `{ kind: 'text', file, screen: <screen title | null>, before: clip(80),
   after: clip(80) }`; label "Text updated in <screen title or page title>".

Undo of a splice: the current file's hash must equal `afterSha` (else stale, the E9 sentence); the service
replaces `[start, start + inserted)` with `removed`, checks the result hashes to `beforeSha` (else 422 "This
edit can't be undone any more."), and writes with the same CAS.

Empty text (`after === ""`) is allowed: the element stays with its leading and trailing whitespace. Untouched
entities keep their spelling because they lie outside `[rawFrom, rawTo)` (PS 08 "an `&amp;` the user did not
touch stays `&amp;`").

### 3.5 Frontend (08)

New wall pieces (ui-ux lane), wired by a feature mount `src/ui/wall/feature-edit-text.ts` and fed by the
wall's selection seam:

- **Click** (Edit mode on a canvas, Comment mode on a page): as today, `hit-controller` opens the composer
  (`popovers.openComposer`, unchanged, 08-6); in addition the **selection toolbar** appears above the
  element's box (screen coordinates, flipped below when the box is within 48 px of the viewer's top edge,
  clamped inside the stage). Purpose `'click'` also sends `edit-probe` and starts the source fetch.
- **Double-click** on an element: `input-controller.ts` listens for `dblclick` on the surface over a live
  board (not labels, which keep "focus artboard"), asks `hit-test` with a new purpose `'edit'`; on the answer
  it closes the composer the first click opened **only when its textarea is empty** (a typed draft is kept in
  the popover layer's draft memory, keyed by the selection key, and restored if the user picks **Comment**
  again on that element in this view), then opens the editor directly when the probe and source allow it;
  otherwise the toolbar shows with **Edit text** disabled and its reason. Play mode ignores both (08-5).
- **Selection toolbar** (`src/ui/wall/selection-toolbar.ts`): `role="toolbar"`, `aria-label` "Actions for
  <tag> '<first 40 chars>'"; three kit buttons size `xs` with icons: **Edit text** (`pencil`), **Comment**
  (`comment`), **Ask agent** (`chat`); arrow keys move between them (roving tabindex), Tab from the wall's
  selected element enters it, Esc closes toolbar and composer and returns focus to the wall surface. A disabled
  **Edit text** is `aria-disabled="true"` (still focusable) and its reason is a muted line under the toolbar,
  linked by `aria-describedby`. **Comment** focuses the composer's textarea (opening it when it was closed).
  **Ask agent** calls `askBar.setSelection(selection)` and a new `askBar.focus()`
  (`src/ui/components/ask-bar.ts`) and closes the composer when empty. Same on rail and page; in the rail the
  three buttons keep their labels (they fit 264 px at `xs`); under 300 px of stage width they become
  icon-only with the labels as `aria-label` and tooltip.
- **Text editor** (`src/ui/wall/text-editor.ts`): host chrome over the element, never inside the frame.
  Card styled like the composer card (`--oc-elevated`, `--oc-elevated-fg`, `--oc-sdk-float`,
  `--oc-sdk-float-edge`, radius `--dc-r-lg`); a `textarea` with the editor text selected, font
  `var(--oc-font)` at the kit's body size whatever the wall zoom (08-3), `dir` from the probe, width
  `clamp(260 px, element screen width, 480 px)` on the page and `min(stage width − 16 px, max(240 px, element
  width))` in the rail, auto-grow to 8 lines then scroll; muted hint "Enter to save · Esc to cancel"; **Save**
  with the composer's Add style; focus ring `--dc-ring`.
  - Keys: Enter (not during IME composition, same `composing` test as the ask bar) saves; Shift+Enter does
    nothing (no line breaks, 08-4); Esc cancels; paste replaces `\r\n|\r|\n` with a space before insertion.
  - Click away (pointer down outside the card): unchanged text → close; changed → stay open, show "Press Enter
    to save or Esc to discard." in `--dc-warning-text` (§4.6.2) under the textarea, replacing the key hint
    until the next keystroke, and move focus back to the textarea.
  - Saving: textarea `readonly`, Save shows the kit spinner, `aria-busy="true"`; success → editor and
    toolbar close, notice "Text updated in <title>" with **Undo**; refusal → the §2.8 sentence in
    `--oc-error-text` under the textarea, text kept; stale → the sentence plus **Reload and try again**
    (outline xs).
  - **Reload and try again**: refetch the source, probe again at the same point, re-run the locator; when the
    element is still there the editor keeps the user's text and adopts the new `base` and `before` (and, if the
    file's text of that element changed, shows "The file now says: “<new text>”" muted above the textarea);
    when it is gone, the reason sentence replaces the hint and **Ask agent** appears in the card (the typed
    text goes into the ask bar's textarea with the element chip).
  - Character counter: hidden under 4 500 characters; from 4 500 a muted "4 812 / 5 000" at the right of the
    hint line (`aria-live="polite"`, announced at 4 500 and 5 000 only); over 5 000 Save is disabled and the
    counter reads "5 000 characters at most" in `--oc-error-text`. Text past the limit is kept, never cut.
  - Agent-working hint (§2.7) as the first line of the card.
- **Source cache** (`src/guest/source-cache.ts`, new, fullstack): `GET /source` answers per (slug, screen),
  dropped on any `files` event naming that file, on `design` events, on `reset` and when the view closes; at
  most 4 entries per view (LRU), so a 2 MB page is fetched once per selection burst.

States per surface:

| State | Page (1400 px) | Rail (320 to 480 px) |
|---|---|---|
| Edit mode off / Play | no toolbar, double-click is the design's | same |
| Element selected, checking | toolbar, Edit text spinner, Comment and Ask agent ready, composer open | same, composer full width of the card area |
| Editable | Edit text enabled | same |
| Not editable | Edit text aria-disabled + reason line | same; reason line wraps to 2 lines max, then "…" with the full text in the tooltip |
| Editing | editor over the element, toolbar hidden | editor card full width minus 16 px, pinned under the element's top edge |
| Saving | readonly + spinner | same |
| Click away with changes | editor stays, "Press Enter to save or Esc to discard." line, focus back in the textarea | same |
| Near / over the limit | counter from 4 500; over 5 000 Save disabled, error counter | same; the counter wraps under the hint below 300 px |
| Agent working | hint as the card's first line, editing still allowed | same |
| Refused | sentence, text kept, Reload and try again for stale | same |
| Stale, element gone after reload | reason sentence in place of the hint, **Ask agent** in the card | same |
| Saved | notice with Undo for 10 s, artboards reload in place | same |
| Viewing a version | toolbar shows only Comment disabled and Edit text disabled "You're viewing an old version." (the composer does not open, as today) | same |

### 3.6 Edge cases (08)

- Source text split over lines with indentation: shown as one line; the splice only touches the changed run,
  so indentation and line endings stay.
- Two "Learn more" buttons: `sameCount` 2, two source leaves → the clicked one by index; a script-made third
  → counts differ → `ambiguous`.
- Text in `<template>`, SVG `<text>`, `<title>`, `<option>` inside a `<select>` (the hit returns the select) or
  attribute values: `inert` or `formatted` reason.
- Script rewrote the text after load: `not-in-source`.
- The agent rewrote the file between click and Enter: the hash differs → stale.
- Right-to-left: the editor's `dir` follows the probe; the splice is logical order.
- Zoomed out to 5 % or in to 400 %: toolbar and editor are screen-space host chrome, their own size.
- Theme switch while editing: the card uses `--oc-*` variables, so it repaints live; the text stays.
- The pinned comment on the edited element: selector unchanged, the pin resolves `exact` after the reload; its
  quote keeps the old words (PS 07).
- The frame reloads while the editor is open (an agent write elsewhere in the file): the editor stays (it is
  host chrome); the next Enter is stale, with the reload path.
- Service restart between Save and Undo: the undo record is on disk; Undo works while the file is unchanged.

### 3.7 Security, sandbox (08)

No sandbox or CSP change; `edit-probe` reads only what `hit` already reads plus a count. The toolbar and editor
render agent text with `textContent` only (the toolbar name, the "file now says" line). The frame never sees
the editor or what is typed.

### 3.8 Not building (08)

Rich text, attributes, images, multi-element edits, spell suggestions (PS out of scope); a full HTML5 parser
(the explicit-end-tag rule refuses the cases where a tolerant scan could differ from the browser); a full named
entity table (2 000+ names for a rare case; unknown names refuse instead).

---

## 4. Tweaks panel (feature 09)

### 4.1 Data changes: the knob contract in design.json (agent-owned)

```jsonc
"tweaks": [
  { "var": "--accent-h", "label": "Accent hue", "kind": "number", "min": 0, "max": 360, "step": 1, "unit": "" },
  { "var": "--radius",   "label": "Corner radius", "kind": "number", "min": 0, "max": 24, "step": 2, "unit": "px" },
  { "var": "--density",  "label": "Density", "kind": "choice",
    "options": [ { "label": "Compact", "value": "0.85" }, { "label": "Comfortable", "value": "1" }, { "label": "Roomy", "value": "1.2" } ] }
]
```

Validation (`parseTweaks` in `src/shared/design-json.ts`, run by `normalizeDesign` for both kinds; agent
values are untrusted; drop with a warning, never fatal, §6.2):

| Field | Rule | Warning when broken (`code`: sentence) |
|---|---|---|
| `tweaks` | an array; absent = `[]` | `invalid-tweaks`: The tweak list is not a list, so no tweaks are shown. |
| `var` | `TWEAK_VAR_PATTERN` `^--[A-Za-z0-9_-]{1,64}$` | `invalid-tweak`: Tweak N in design.json is not usable (it needs a var like --accent), so it is not shown. |
| `label` | 1..`TWEAK_LABEL_MAX` (40) after trim | …(its label must be 1 to 40 characters)… |
| `kind` | `"number"` or `"choice"` | …(its kind must be "number" or "choice")… |
| number `min`, `max` | finite, \|x\| ≤ `TWEAK_NUMBER_ABS_MAX` (1e6), `min < max` | …(min must be below max)… |
| number `step` | finite, `0 < step ≤ max − min`, at most 4 decimals | …(step must be above 0 and fit the range)… |
| number `unit` | `TWEAK_UNIT_PATTERN` `^[a-z%]{0,6}$`; absent = `""` | …(the unit must be letters or %)… |
| choice `options` | 2..6 (`TWEAK_CHOICES_MIN`/`_MAX`), labels 1..30, values `TWEAK_CHOICE_VALUE_PATTERN` `^[A-Za-z0-9 #%.,()+\-'"/]{1,80}$` (no `;`, `{`, `}`, `<`, `>`, `\`, `*`), values unique | …(a choice needs 2 to 6 options with distinct plain values)… |
| duplicate `var` | first kept | `duplicate-tweak`: Two tweaks use --x; only the first is shown. |
| more than 12 | first 12 kept | `too-many-tweaks`: Only the first 12 tweaks are shown. |

Unknown keys inside a knob (a `default`, a `description`) are ignored silently: the file's value is the value
(PS 09 Reset), so there is no default to validate. `DesignJson` gains `tweaks: Tweak[]`; `AgentOwnedField`
gains `'tweaks'`; `KNOWN_FIELDS` / `CANONICAL_ORDER` gain `'tweaks'` after `designSystem` (a created
design.json has no `tweaks` key). Old designs have none and read as `[]`.

### 4.2 Reading values from tokens.css (`src/shared/tokens-css.ts`, new, pure)

- `scanTokens(css) → Declaration[]`: a tolerant CSS scanner (comments, strings, `url(…)`, nested braces);
  for each custom-property declaration: `name`, `valueRaw: [from, to)` (the value text between the colon's
  following whitespace and the trailing whitespace before `;`, `}` or `!important`), `important`, and its
  context: `root` (a top-level rule whose selector list is exactly `:root`, ignoring whitespace and comments)
  or `other` with the at-rule prelude chain (`@media (prefers-color-scheme: dark)`, clipped to 60 chars) or
  the selector.
- `readTweakValues(css | null, tweaks) → TweakState[]`; for each knob, the **last** top-level `:root`
  declaration of its var (the one that wins the cascade) is the knob's:

| `state` | When | Panel text |
|---|---|---|
| `ok` | number: value matches `^-?(\d+\.?\d*\|\.\d+)([a-z%]*)$` and its unit equals the knob's; choice: any plain value | value shown |
| `value` | choice only: a plain value that is not one of the options | "tokens.css sets another value: <v>" (no option pressed; choosing one replaces it) |
| `missing` | no top-level `:root` declaration of the var | tokens.css has no --name. |
| `formula` | the value holds `(` (number knob), `var(`, `calc(` or any other function, `!important`, or a comment anywhere inside the value range (`--r: 8px /* base */;`: a splice of `valueRaw` would keep or eat the comment, so it is not editable) | This value is a formula. Ask the agent to change it. |
| `unit` | number with a unit different from the knob's | tokens.css sets --name in rem, but this tweak uses px. Ask the agent to fix it. |
| `no-file` | no tokens.css | This design has no tokens.css. |

`alsoSet: string[]` lists the contexts of the var's other declarations (preludes or selectors, at most 3),
shown as "Also set for <context>; only the default changes."

The scanner's `valueRaw` stops at the first `/*` outside a string, so a trailing comment is outside the
range; a comment that starts inside the value text (before its last non-space character) is what makes the
row `formula`. Choice values (and preview values) must also have **balanced quotes**: an even count of `'`
and of `"` (`isBalancedQuotes`, pure, in `tokens-css.ts`), checked in `parseTweaks` (an unbalanced option makes
the knob invalid with the choice warning) and in the `set-tokens` validator; an unbalanced quote would open a
string that swallows the declarations after it.

`GET /designs/:slug/tokens` answers `TokensResponse` (§8.2); tokens.css is
read through `resolvePlainTarget(dir, ['tokens.css'], { allowAbsent: true })` (a link answers `exists: true, editable: false`),
≤ `TOKENS_CSS_MAX_BYTES` (1 000 000), UTF-8 round-trip. A file that fails any of these answers
`editable: false` and the panel disables every knob with "tokens.css can't be edited here. Ask the agent
instead." (`TokensResponse = { exists, editable, sha256, knobs }`; `sha256` null when the file is missing.)

### 4.3 Saving (`op: 'tokens'`, `src/service/edits/ops-tokens.ts`)

Request `{ op: 'tokens', base, values: [{ var, value }] }` (≤ 12 entries, each var once):
1. Re-read design.json's current `tweaks` (normalised); every `var` in `values` must be a current knob (else 409
   stale "The tweaks in design.json changed while you were working. Nothing was saved."). Number values must be
   finite and within `[min, max]` (else 400); choice values must equal one of the knob's option values (else
   400).
2. Read tokens.css bytes; hash equals `base` (else 409 stale "tokens.css changed since you started…").
3. For each value, its knob must be `ok` or `value` in the current file (else 422 with that knob's reason).
4. Format: numbers with the knob's step decimals (`formatTweakNumber(value, step)`: round to the step's decimal
   places, no exponent, `-0` → `0`, trailing zeros trimmed) then the unit; choices verbatim. Values equal to
   the file's current value are skipped. The splice replaces exactly `valueRaw`; whitespace, comments, other
   declarations, the `!important` absence and line endings stay.
5. Verify with `scanTokens` on the result: every changed declaration reads back the new value; the byte count of
   untouched ranges is unchanged. CAS write. Undo: one `splice` step per changed declaration (applied
   back-to-front), on the file hash. Label "Tweaks saved to tokens.css"; ledger `{ kind: 'tweaks', changes:
   [{ label, before, after }] }`.
6. Saving tweaks never touches `designSystem.confirmed` (09-6).

### 4.4 Live preview (no reload, 09-4)

- Page → frame `set-tokens { vars: [{ name, value }] }` (≤ 12; `name` `TWEAK_VAR_PATTERN`; `value` ≤ 100
  chars matching `TOKEN_PREVIEW_VALUE_PATTERN` `^[A-Za-z0-9 #%.,()+\-'"/]{1,100}$`). The bridge sets each with
  `document.documentElement.style.setProperty(name, value)` and removes, with `removeProperty`, any name it set
  earlier that is not in the new list; `vars: []` clears the preview. Inline style on `<html>` beats every
  normal `:root` declaration, media queries included; an `!important` declaration in tokens.css would not be
  beaten, which is why `!important` reads as `formula` (no knob for it).
- The preview is therefore **stronger than the save** for a knob whose var is also set elsewhere (`alsoSet`
  non-empty: a `@media (prefers-color-scheme: dark)` block, a `[data-theme=dark]` rule): the inline value
  wins there too, while Save changes only the top-level `:root` declaration. Such a row shows, under the
  "Also set for…" line, the muted note "The preview shows this value everywhere; saved, it applies only where
  tokens.css doesn't set it again." Not building a context-exact preview: it would need per-rule injection
  into the design's stylesheet, a far larger surface for a rare case.
- `BridgeInit.tokens?: TokenVar[]` carries the current preview for a frame that loads or reloads (budget
  unload §8.4, an agent write, a Play navigation); the bridge applies it before the first paint (it runs first
  in `<head>`), and the page also re-sends `set-tokens` on that board's `ready` (covers the order of a reload
  racing a slider move).
- The Tweaks controller (`src/guest/tweaks.ts`, new, fullstack) holds per open design: the knob states from
  `GET /tokens`, the file's `sha256`, the pending values, and exposes `preview(): TokenVar[]`. The wall gets
  `WallHandle.setTokenPreview(vars)` (new; posts to every live board's main frame, rAF-coalesced so a drag sends
  at most one message per frame; boards showing a version or the compare half never get it).
- Pending values are mirrored to `host.storage` key `tweaks:<slug>` as `{ sha256, values, at }` on every change
  (debounced 300 ms; 64 KiB per value, F21, far above 12 knobs). On opening the design, a stored entry whose
  knobs still exist restores the pending state (dot and "Unsaved"), so a frame the host closed (which cannot be
  intercepted) loses nothing. Save, Reset and Discard delete the key.
- Exports, thumbnails and checks read files only: they never see the preview.

### 4.5 Stale tokens.css while values are unsaved

On a `files` event naming `tokens.css` (from anyone) or a `design` event, the controller refetches
`GET /tokens`. If the hash differs from the one the pending values were made on, the panel shows the warning
banner "tokens.css changed since you started. Your values are still shown." with **Apply to the new file**
(sends `op: 'tokens'` with the new hash and the pending values; knobs that are no longer `ok` are listed and left
out) and **Discard my tweaks**. The preview stays on top of the new file until the user chooses (PS edge case).
A user-origin event from this same view's own save does not raise the banner (the controller adopts
`EditResponse.stamps.tokens` first).

### 4.6 Frontend (09)

Theme tokens: panel `--oc-bg`, `--oc-fg`, `--oc-border`; labels `--oc-fg`, values `--oc-mono` in `--oc-muted`
with tabular numerals; range input `accent-color: var(--oc-primary)`, track `--oc-border`, focus `--dc-ring`;
disabled rows `--oc-muted`; dot `--oc-warning`; the "Unsaved" badge text `--dc-warning-text` (the stepped
token, §4.6.2); banners kit `mountBanner` (`warning`, `info`). New icon `tune`
(three sliders) added to `src/ui/components/icons.ts` in the same inline-SVG style.

| Where | Page (full screen) | Rail |
|---|---|---|
| Entry | toolbar button **Tweaks** (`tune` icon + label) between Comments and Versions, `aria-pressed` while open; a 6 px dot when unsaved (`aria-label` "Tweaks, unsaved changes") | compact action icon button (`tune`) in S8 before Versions, same dot and label |
| Shown when | the design has ≥ 1 valid knob | same |
| No knobs | ⋯ menu **Ask for tweaks** → ask bar text "Add tweaks for this design (accent hue, density, type scale, radius)." focused, not sent | same |
| Panel | right drawer 360 px; `DrawerKind` gains `'tweaks'`; opening it closes Comments or Versions like today | **non-modal bottom sheet**, at most 50% of the rail height, the wall visible and live above it (owner decision, PS §4); full-height below about 560 px of rail height; opening it closes Comments or Versions like today, which stay full-height (§4.6.1) |
| Rows | label · value with unit · native `input type=range` (min, max, step; `aria-valuetext` "210" or "8 px") or a `mountTabs` segmented choice | same, full width |
| Keys | arrows step, Page Up/Down step × 10, Home/End ends (native range behaviour; the controller clamps and rounds to step) | same |
| Footer | **Reset** (ghost), **Save** (filled primary, `btn({ emphasis: 'primary' })`), agent-working hint | same, pinned in the sheet's footer (`SheetHandle.foot`) while the rows scroll in its body |
| One primary | while the panel is open, the ask bar's **Send** drops to the outline look so Save is the one filled primary on screen (polish, review #10); it stays enabled and keeps its keyboard path; back to filled when the panel closes | same |

States: loading ("Reading tokens.css" `loadingRow`) · **load failed** (`GET /tokens` failed: service down,
host timeout, a 500; the `loadingRow` is replaced by "Couldn't read tokens.css. <message>" in
`--oc-error-text` with **Try again** (outline xs, refetches, back to loading); every knob row and Save/Reset
disabled; pending values restored from `host.storage` are kept (not previewed, never deleted) until a load
succeeds; the entry button and its dot stay; a later `files`/`design` event retries on its own) · ready · unsaved (badge "Unsaved", dot) · saving (Save
spinner, rows disabled) · saved (notice "Tweaks saved to tokens.css" with **Undo**, `TransientId 'tweaks'`) ·
save refused (sentence under the footer in `--oc-error-text`, values kept) · service down ("Couldn't save your
tweaks. <message> Your values are still here.") · stale (banner, §4.5) · broken knob (row disabled with its
reason) · no tokens.css (every row disabled, banner "This design has no tokens.css.") · viewing a version
(rows and buttons disabled, banner "You're viewing an old version.") · design gone (banner "That design is no
longer in your Designs folder. Your unsaved values were:" followed by one line per knob `Label: value`,
selectable text, nothing written).

Leaving with unsaved values (back to the library, the rail's back, opening another design, closing the viewer):
a dialog built with `openSheet(host, { variant: 'dialog' })` (`confirmDialog` has only two buttons): title
"Save your tweaks?", body "Your tweak values aren't saved to tokens.css yet.", **Save** (filled primary),
**Discard**, **Keep editing** (Esc). Save failing keeps the dialog open with the sentence. Closing only the
panel keeps values pending (dot stays). Model: `src/ui/model/tweaks-model.ts` (row view, labels, dirty, leave
decision), pure.

#### 4.6.1 The rail bottom sheet (owner decision, PS §4; U2)

Today the rail opens Comments and Versions with `openSheet(options.actions.host, { variant: 'full' })`
(`src/ui/wall/design-view.ts:570`), which is modal (`role="dialog"`, Tab trapped, `kit.ts:286-330`) and covers
the whole rail (`.dc-sheet { position: absolute; inset: 0 }`, `src/ui/styles.css:245`). That would hide the
preview, so Tweaks gets a new variant instead of a new component:

- **Kit** (`src/ui/components/kit.ts`, U2): `SheetVariant` (`:232`) gains `'bottom'`. It is **non-modal** like
  `'dock'`: `role="region"`, no `aria-modal`, no scrim, not on `modalStack`, so Tab is not trapped and the wall
  stays usable. Esc closes it when focus is inside the sheet (the existing non-modal keydown path, `kit.ts`
  `if (!modal)`); in addition the Tweaks feature closes it on Esc pressed on the wall surface when no popover,
  composer or editor is open (the wall's own Esc handling runs first; the feature only acts on an unhandled
  Esc). Focus moves into the sheet on open (existing microtask) and back to the Tweaks button on close.
  `SheetHandle` gains nothing.
- **Styles** (`src/ui/styles.css`, U2's block): `.dc-sheet[data-variant='bottom']` is `inset: auto 0 0 0`
  (pinned to the bottom of the rail host, so the area above receives pointer events), panel
  `max-height: var(--dc-sheet-max)`, where the feature sets `--dc-sheet-max` to half the host's
  `clientHeight` in px on open and from a ResizeObserver on the host (a percentage of an auto-height wrapper
  does not resolve), `border-top: 1px solid var(--oc-border)`,
  `box-shadow: var(--oc-sdk-float)`, radius `var(--dc-r-lg) var(--dc-r-lg) 0 0`, background `--oc-bg`. The
  body scrolls (`.dc-sheet-body` already does); the head and the foot (Reset, Save, agent-working hint) stay
  pinned. The header is the sheet's own: title "Tweaks", the unsaved badge, the close button (no drag
  handle; the height is content-sized up to the cap).
- **Fallback**: at open, `host.clientHeight < 560` → the rail uses `'full'` as today (modal, full height). The
  variant is chosen at open only; resizing the rail while the sheet is open keeps the variant (the 50% cap
  still holds, the body scrolls). Model: `tweaksSheetVariant(hostHeight)` in `tweaks-model.ts` (pure, tested
  at 559, 560 and 900).
- **The wall above stays live**: pan, zoom, Fit, the selection toolbar and pins keep working in the visible
  part. Fit uses the visible stage: the wall's covered insets gain a bottom value. `CameraController`'s
  `coveredInsets` answers `bottom: 0` today (`src/ui/wall/camera-controller.ts:64`); `WallOptions` gains
  `coveredBottom?: () => number` next to `coveredRight` (`src/ui/wall/wall-types.ts:26`), and design-view passes
  the bottom sheet's `offsetHeight` while it is open (0 otherwise). Open, close and a sheet resize
  (ResizeObserver on the panel) call `wall.refit()`, which refits only when the user has not moved the camera,
  as for the dock today.
- **Unchanged**: the unsaved dot on the S8 Tweaks button, the "Unsaved" badge, the leave-with-unsaved dialog
  (still `variant: 'dialog'`, modal, over everything), the drawer exclusivity (`toggleDrawer`; Tweaks closes
  Comments or Versions and back). Comments and Versions keep `'full'` on the rail.
- **Visual scenarios** (`scenarios/tweaks.mjs`): rail 320 × 900 and 480 × 900 (bottom sheet, wall visible,
  Fit inside the visible part), rail 320 × 540 (full-height fallback), each in light and dark, with the states
  ready, unsaved, saving, save refused, stale banner, load failed, and the leave dialog over the bottom sheet.

#### 4.6.2 Tone text contrast, app-wide (review #9; U1 lands it, every later task uses it)

The host's `--oc-warning-text` and `--oc-success-text` on a 10% tone tint (the kit banner background, our
notices and badges) measure about 4.4:1 in the light theme, under AA for small text; stepping the text 20 to 30%
toward `--oc-fg` gives about 5:1 and keeps the hue. The defect is already in Phase 1 chrome (`.dc-banner` via
the kit banner title, the restore notice, the versions "Unsaved changes" row, checks render tone
`styles.css:2301-2304`, diff kinds `:1644-1650`), so the fix is one app-wide pass, not Phase 2 only:

- `.dc-app` (`src/ui/styles.css:14`) gains `--dc-warning-text: color-mix(in srgb, var(--oc-warning-text) 75%,
  var(--oc-fg))` and `--dc-success-text` the same way (`--oc-error-text` too only if it measures under 4.5:1 on
  its tint; U1 measures light and dark and records the ratios in its report).
- Every `color: var(--oc-warning-text)` / `var(--oc-success-text)` in `styles.css` that sits on a tint or the
  plain background becomes the `--dc-` token; kit banners inside `.dc-app` get it by overriding the kit's
  `--oc-sdk-tone-text` (the variable the banner title reads) per tone, with the tone selector verified in
  `node_modules/@openchamber/sdk/dist/ui/banner.js`.
- Theme switch: both tokens are `color-mix` of live host variables, so they follow the theme with no script.
- Phase 2 text that this design names `--oc-warning-text` (the agent-working hint §2.7, the click-away line
  §3.5) uses `--dc-warning-text`; error lines keep `--oc-error-text` unless U1's measurement says otherwise. The pass sits in U1's own marked block plus in-place edits of the listed rules; U1 names every
  changed rule in its report. Visual check: the existing Phase 1 scenarios plus U1's, light and dark.

### 4.7 The broken-knob check finding (09-7; lands after C1)

New `CheckCode` `'tweak-broken'` (warning) and `CheckParams.tweak?: 'missing' | 'formula' | 'unit' | 'no-tokens'`,
`params.field` = the var name. Sentences in `src/shared/checks.ts` (closed table):
- missing: `design.json: the tweak for ${field} names a variable tokens.css does not define.`
- formula: `design.json: the tweak for ${field} points at a formula in tokens.css (calc() or var()), so it can't be tuned.`
- unit: `design.json: the tweak for ${field} uses a different unit than tokens.css.`
- no-tokens: `design.json declares tweaks, but the design has no tokens.css.`
`src/service/check/static.ts` runs `readTweakValues` on the tokens it already reads (`:211`) and emits one
finding per broken knob (the per-code cap of 5 applies). Invalid knob definitions already surface as
`design-json-field` findings from the design.json warnings. The CLI, `design_check` and the badge share the
engine, so all three report it.

### 4.8 Edge cases (09)

`:root` plus a media query: the top-level `:root` is edited, the panel shows "Also set for…". Two top-level
`:root` declarations: the last one (the effective one) is edited. Screens that do not link tokens.css do not
react (nothing to do). A file value outside the knob's range: shown, the slider thumb clamps visually, the
value is written only when moved. Two windows: the second Save is stale. The agent rewrites tokens.css during a
drag: banner. The agent removes a knob while values are pending: the stale refusal on Save, the knob row
disappears, the others stay pending. Theme switch: panel repaints; the design's own colours are design content.
A page design: same panel (tokens.css sits beside `index.html`).

---

## 5. Screen management (feature 10)

### 5.1 Ownership of `screens[]` (owner decision 10-4) and how it fits §6.3

- `screens` stays an **agent field read from design.json only**; it is never copied into state.json, and the
  mirror merge (`serviceFieldsDiffer`, `mergeServiceFields`) never compares or restores it. So the agent's
  next write of the list wins, by construction.
- The service writes `screens` only from a user action, as an agent-field write in the same family as a user
  rename (`ServiceWrite.title`): `ServiceWrite` gains `screens?: JsonValue[]`, which `mergeServiceFields`
  places in the key's existing position (or in canonical order when absent), together with `updated: now`.
- New store method `writeScreens(slug, expectStamp, mutate, hooks?)` (`DesignStore`, WP0 interface): under
  the store's per-slug lock, read design.json; refuse when it is missing (provisional, "This design has no
  design.json yet…") or does not parse ("design.json can't be read right now. Ask the agent to fix it.");
  compute `screensStampOf(raw)`; mismatch → stale; `next = mutate(raw.screens)`; state.json is not written
  (no service field changes), only design.json, via `replaceFileIfUnchanged`, re-reading on a lost race up to
  `MIRROR_ATTEMPTS` (5) and re-checking the stamp each time (a changed stamp is stale, an unchanged one
  re-applies). **Unlike the background mirror (`store.ts:302-304`, which only logs `design-json-busy` and
  returns), a user write that loses the 5th attempt throws `ApiError('conflict', 'Another program is using
  this file. Close it and try again.')`**, so a reorder never answers success while nothing was written; a
  multi-step op rolls back on it (§2.9). It shares the merge-and-retry loop with the mirror (one loop, a
  `onGiveUp: 'log' | 'throw'` choice), not a copy.
- `hooks.beforeRename(bytes: Uint8Array)` is called with the exact bytes right before each rename attempt
  (the pipeline records the self-write there, §2.6, so the echo is known before the watcher can see the file;
  a lost attempt is followed by a new call with the new bytes). It answers `{ stamp, bytes }`: the new
  `screensStamp` and the bytes written, from which the pipeline computes the tracked hash for `afterTree`
  (§2.4). Comments, `kind` and every service field go through the normal merge, so a screen write can never
  drop a comment.
- `moveComments(slug, moves, hooks?)` takes the same hook and answers `{ moved, bytes }` (`bytes` the
  design.json mirror it wrote, or `null` when the mirror was skipped); its state.json write is under
  `.chamber/`, untracked and unwatched, so it needs no self-write entry.
- `screensStampOf(raw)` = sha256 of `JSON.stringify(raw.screens ?? null)` (raw value, not normalised, so even an
  invalid entry the wall does not show counts as part of the list). `DesignRecord` and `GET /designs/:slug`
  carry it as `screensStamp` (`null` when design.json is missing or unparseable), plus `designJson: 'ok' |
  'missing' | 'invalid'`.
- P1 to P5 are unchanged: screen actions are refused on a provisional design (no design.json), so they never
  create one; a final design always has one.

### 5.2 Ops (`src/service/edits/ops-screens.ts`, pure planning in `src/shared/screen-ops.ts`)

- **Reorder** `{ op: 'reorder', screens: stamp, order: string[] }`: `order` must be exactly the normalised
  screen ids, each once (400 otherwise). `reorderRaw(rawScreens, order)` permutes the raw entries that carry a
  valid listed id and leaves every other raw entry (invalid, dropped by the normaliser) at its index; entries
  are moved verbatim (direction marks and unknown keys travel with them). Undo step `screens { before, afterStamp }`.
  Ledger: `describeMove(before, after)` gives `{ moved, above }` when exactly one entry moved, else the new title
  order. Notice "Moved Checkout above Pricing" (or "Moved Checkout to the end", or "Screens reordered").
- **Duplicate** `{ op: 'duplicate', screens: stamp, id, file: FileStamp }`: the source file must exist with the
  given size and mtime (else stale; a screen not written yet is refused in the UI first, "Nothing to copy until
  the agent writes this screen."). `freeCopyId(id, taken)` with `taken` = listed ids ∪ every `screens/*.html`
  name on disk: `<id>-copy`, then `<id>-copy-2`, `-3`, …; when the candidate would break `SCREEN_ID_PATTERN`
  (over 41 chars), the base is cut so `<base>-copy[-n]` fits and trailing `-` are trimmed. Steps: read the source
  bytes; write them to a dot-first temp in `screens/`; publish it as `screens/<newId>.html` with
  `moveNoReplace` (§2.5: a hard link fails if the name appeared; never overwrites); then `writeScreens` inserting, right after the original,
  a clone of the original's raw entry with `id`, `file` and `title` replaced and `direction` removed: title
  `<Title> copy` (cut so it stays ≤ `TITLE_MAX`); `viewports` and `description` kept. Undo steps: `create`
  (the copy goes to `.trash`, never a hard delete) and `screens`. Comments stay on the original. Notice
  "Duplicated Home" with Undo; `created: { id, title }` in the answer so the camera can bring the copy into view.
- **Move to trash** `{ op: 'trash-screen', screens: stamp, id, file: FileStamp | null }`: when the file exists it
  is moved with `moveNoReplace` to `<root>/.trash/<slug>.<id>-<yyyymmddhhmmss>[-n].html` (the dot cannot occur in a slug or a
  screen id, so the name never clashes with a trashed design folder `<slug>-<stamp>/` or a loose original
  `<stem>-<stamp>.html` from another slug; for a trash destination `'exists'` means "try the next `-n`", up to
  `-99`, then 409 `conflict`; never overwrites); then `writeScreens`
  removing the entry. Undo: `move` back (destination must still be absent) and `screens`. The last screen may
  go: the wall shows its empty state plus "+ Screen". Comments are not touched; the Comments drawer groups
  comments whose `screen` is not in the list under "<id> · Screen removed". Notice "Moved Pricing to trash".
- **+ Screen** (10-1) writes nothing: it is the ask flow (`flows.ask(slug, { text })`) with the text from
  `newScreenAsk({ title, after: <last screen title>, free: 40 − count, note })` in
  `src/shared/agent/screen-asks.ts` (pure):
  `Add a new screen to the canvas "<title>" after "<last title>": <note>. Write it as screens/<id>.html and add it to design.json. The canvas has room for <free> more screens.`
  (one line per clause; quotes from design.json are one-lined with `"` turned into `'`). `<note>` is the user's
  words, verbatim, ≤ `ASK_TEXT_MAX` minus the preface (the box counts it down).

The 40-screen cap (`SCREENS_MAX`): Duplicate is disabled at 40 ("A canvas holds up to 40 screens."), and the
service refuses a duplicate that would make 41 (422 with the same sentence).

### 5.3 Layout additions (`src/guest/camera.ts`, fullstack)

`layoutWall` gains an optional `ghost?: { width, height }` row (after the last row, in the first column): a
`WallArtboard`-like cell with `kind: 'ghost'` (no frame), 240 px tall, the first viewport's width. The direction
row is §6.3. Existing callers pass nothing and get today's layout.

### 5.4 Frontend (10)

Tokens: menus are the kit menu (`openMenu`/`attachMenu` in `kit.ts`); ghost board border `1px dashed
var(--oc-border)`, background transparent over `--oc-muted-surface`, text and icon `--oc-muted`, hover
`--oc-hover`, focus `--dc-ring`; drop indicator 2 px `--oc-primary`; drag ghost `--oc-elevated` with
`--oc-sdk-float`.

- **Row menu**: a `more` icon button (`aria-label` "Actions for screen Home") at the right end of the row's
  first label (one per row, not per viewport). Entries, **text only** (the kit `MenuEntry` has no icon slot, and
  none is added; review #6): **Duplicate**, **Move up**, **Move down**, **Move to trash**, separator, **Try 3
  directions…** (§6). Disabled reasons: Move up on the first row "This is the first screen.", Move down on the
  last "This is the last screen.", Duplicate on a missing file "Nothing to copy until the agent writes this
  screen.", every entry on a provisional or unreadable design.json with that sentence, every entry while viewing
  a version. Hidden in Play mode. Same on rail and page; rail menus open as the kit menu anchored to the button.
- **Where a reason shows (review #1)**: inside the disabled option, as a second muted line under its label, never
  as a note under another row. Kit change (U3, `src/ui/components/kit.ts`): `MenuEntry`'s action variant
  (`kit.ts:82`) gains `reason?: string`. `openMenu` renders a row that has a `reason` as `aria-disabled="true"`
  instead of the native `disabled` (so arrow keys still reach it and a screen reader reads it), with the reason
  in a `<span class="dc-menu-reason">` (id `${uid}-${id}-reason`, `--oc-muted`, the kit's small text, wraps,
  no ellipsis) that the row names through `aria-describedby`; Enter, Space and click on it do nothing and keep
  the menu open. Mechanics: the SDK's `moveListSelection` skips items with `disabled` (`navigation.js`), so the
  kit passes it `{ id, disabled: disabled && !reason }` per entry, and `pick` returns early for any entry whose
  `disabled` is true; the initial active row stays the first enabled one. `disabled` without `reason` behaves as today (native disabled, skipped). The row with a reason
  is a two-line block: `.oc-sdk-option` gets `flex-wrap: wrap` for that row only (`data-reason="true"`), the
  reason taking the full width. Existing callers pass no `reason`, so every current menu is unchanged.
- **Menu notes** (U3, same kit change): `openMenu` and `attachMenu` take an optional last argument
  `notes?: { lead?: string; foot?: string }`, drawn as muted, non-interactive lines (`role="presentation"` rows,
  `.dc-menu-note`) at the top and bottom of the popup, referenced from the popup's `aria-describedby`. `lead`
  carries the agent-working hint (§2.7). `foot` is used for one sentence only: "A canvas holds up to 40
  screens." when the cap disables Duplicate (40 screens) or Try 3 directions (fewer than 2 free); those two
  entries are then disabled without their own `reason` text and point their `aria-describedby` at the foot
  line, so the cap is said once per menu.
- **Ghost board "+ Screen"** (page and rail): after the last row, Edit mode, live design, under 40 screens; a
  button filling the ghost cell, label "+ Screen", `plus` icon. Click → `openPopover` (`kit.ts:397`) with
  "What should the new screen show?" (`textarea`, 3 rows), the ask bar's target line ("Goes to the linked chat"
  / "Goes to “<chat>”" / "Starts a new chat"), **Ask the agent** (filled primary), Esc cancels. Sending:
  readonly + spinner; success → popover closes, toast per `askRequestToast(outcome)`
  (`src/ui/model/ask-bar-model.ts`); failure → "Couldn't send. <message> Your message is still here." (text
  kept, **Ask the agent** enabled again). The textarea counts down from the room left after the preface
  (`ASK_TEXT_MAX` minus `newScreenAsk`'s fixed text): hidden until 200 characters remain, then a muted "180
  left"; at 0 the button is disabled and the counter turns `--oc-error-text`. At 40 screens the ghost is hidden
  and every row menu carries the cap foot note above.
- **State boards (U3 visual scenarios)**: row menu with a reason inside an option, the cap foot note, the
  agent-working lead; the ghost board idle, popover open, sending, failed (text kept); drag with the drop
  indicator (page); each on rail 320/480 and page 1400, light and dark.
- **Drag reorder** (page only, 10-6): pointer down on a row's first label in Edit mode, then `isDrag`
  (`wall-input.ts`) → a drag ghost of the label follows the pointer; the drop indicator sits between rows; Esc
  cancels (nothing sent); drop → reorder op with the new order; the wall re-lays out at once from the answer's
  detail, and if the moved row ends outside the visible stage the camera pans the minimum to show it (no zoom
  change). While the request runs, labels are not draggable. The label double-click "focus artboard" still
  works (a click without drag movement is not a drag).
- **Keyboard**: Tab reaches each row's menu button; **Move up/Move down** do the same op; every result is
  spoken through the notices live region ("Moved Checkout above Pricing.").
- **Comments drawer**: group "<id> · Screen removed" (muted, after the listed screens); its pins are not drawn.
- Models: `src/ui/model/screens-model.ts` (menu entries with disabled reasons, notice and announcement text,
  drop target from pointer y), pure.

### 5.5 Edge cases (10)

The agent rewrites design.json from memory and brings a trashed screen back: the board shows "screens/x.html
not written yet" (the file is in the trash); the ledger tells the agent next time (§7). Drag while the agent adds
a screen: the stamp changed → stale, the wall refreshes, the new screen shows. Undo after the agent changed the
list: the screens step's `afterStamp` differs → the E9 refusal. Trash name clash: `-n` suffix. Windows: the
rename into `.trash` may meet a lock → `renameWithRetry`, then the conflict sentence; a case-insensitive disk is
safe because screen ids and slugs are lower case. Links between screens keep working after reorder and duplicate
(ids and files of existing screens never change). A `screens` value that is not an array: the design.json reads
with an `invalid-screens` warning, the stamp still hashes it, and reorder/duplicate/trash are refused with "The
screen list in design.json can't be read. Ask the agent to fix it." Root change mid-request: 404 gone.

---

## 6. Variations, canvas half (feature 11)

### 6.1 Data changes: direction marks (agent-owned, on screen entries)

```jsonc
{ "id": "home-b", "title": "Home, editorial", "file": "screens/home-b.html",
  "direction": { "of": "home", "letter": "B", "name": "Editorial" } }
```

Validation (`src/shared/design-json.ts`, after the screen list is parsed):

| Rule | Broken → mark dropped, screen shown as a normal row, warning |
|---|---|
| `direction` is an object with `of` (`SCREEN_ID_PATTERN`, ≠ own id), `letter` one of `A B C D`, `name` 1..`DIRECTION_NAME_MAX` (40) | `invalid-direction`: Screen "x" has a direction mark Design Chamber can't read, so it shows as a normal screen. |
| `of` is a listed screen | `direction-orphan`: Screen "x" is marked as a direction of "y", which is not a screen here, so it shows as a normal screen. |
| `of` carries no `direction` key of its own (as written) | `direction-chain`: Screen "x" is marked as a direction of "y", which is itself a direction, so it shows as a normal screen. |
| letter unique within the group (first in list order wins) | `direction-letter-taken`: Screen "x" uses direction letter B, which "z" already has, so it shows as a normal screen. |

The chain rule makes cycles (a → b, b → a) and chains impossible without a graph walk: both marks fail. A
screen marked "for two screens" cannot be written (one `of` field); a duplicated id is already dropped by
`duplicate-screen`. Four letters cap a group at 4 directions (`DIRECTION_OPTIONS_MAX`). The normalised `Screen`
gains `direction?: DirectionMark`. `directionGroups(screens)` (pure, `src/shared/screen-ops.ts`) answers the
groups `{ of, members: Screen[] (letter order) }` for screens with ≥ 1 valid member.

### 6.2 Keep this one (`op: 'keep-direction'`)

Request `{ op: 'keep-direction', screens: stamp, of, keep, files: { [id]: FileStamp | null } }` where `keep` is
`of` (keep Current) or a member, and `files` names `of` and every member with what the wall shows.

Preconditions (all before any write): stamp matches; `of` is a group root now; `files` lists exactly the group;
every file matches its stamp (a direction that got written since the wall loaded is stale; one still not written
has `null` and must still be absent); `keep`'s file exists; trash names free.

Steps (version first with reason `keep-direction`, never coalesced):
1. Each member other than `keep` whose file exists → `move` to `.trash/<slug>.<memberId>-<stamp>[-n].html`.
2. When `keep` ≠ `of`: `screens/<of>.html` (if it exists) → `move` to the trash; then `screens/<keep>.html` →
   `move` to `screens/<of>.html` (every move here is `moveNoReplace`, §2.5, so B's bytes land unchanged in the original's place, keeping its id,
   title, list position and the links other screens make to `screens/<of>.html`).
3. `writeScreens`: remove every member entry; the `of` entry stays as it is (it carries no mark).
4. When `keep` ≠ `of`: new store method `moveComments(slug, [{ from: keep, to: of }])` (under the store lock,
   through the normal state.json + mirror write) moves the comments whose `screen` is `keep` to `of`, recorded
   per id for undo. Comments on trashed members stay with their ids (shown "Screen removed"); comments on `of`
   stay on `of` (they now point at B's content and re-anchor or show detached, PS 11 edge case).
5. Undo record: the moves, the screens step and the comments step, applied in reverse. Notice "Kept B for Home.
   The others are in the trash." (or "Kept the current Home. The directions are in the trash.") with Undo.
   Ledger `{ kind: 'keep', screen, letter, name }`.

Undo checks, before any change: the screens stamp equals `afterStamp`; `screens/<of>.html` hashes to what was
moved there; every trash file still exists and hashes to its recorded sha; every move destination is absent
(checked first for a clear refusal; the moves themselves are `moveNoReplace`, so a destination that appears
later is still never overwritten).

### 6.3 Layout and frontend (11)

`layoutWall` (camera.ts) takes rows as a union: a screen row (today) or a **direction row** `{ group: { of,
members }, viewport }`: cells Current then members in letter order, each at the chosen viewport. How the cells
flow is a layout option, so one pure function serves both surfaces (owner decision, PS §6):

- `LayoutOptions` (`camera.ts:150`) gains `directionColumns?: number` (default: unlimited). The page passes
  nothing: **one row**, left to right (Current, A, B, C/D), as before. The rail passes `2`: the group is a
  **2×2 grid** (Current, A on the first line; B, C on the second; a fourth member D starts a third line,
  left-aligned; 2 cells make one line, 3 cells leave the second line's right cell empty). Cell width is the
  chosen viewport's width, line height = label + that viewport's height, `gap` between lines and cells as
  between screen rows. All cells of one group keep `row` = the group's row index; a new `WallArtboard.line`
  (0-based, 0 on every screen row) and `col` (0..columns−1) place them, so the row header, Keep and pins
  address cells as before. The y cursor advances by the group's total height.
- `board-set.ts` (`rebuild`, `:296-310`, U4) builds the row list with `directionGroups` and passes
  `directionColumns: options.compact ? 2 : undefined` (`WallOptions.compact`, `wall-types.ts:20`, true on the
  rail). Fit already uses `layout.bounds`, so the whole grid fits the rail stage.
- T11c owns the `camera.ts` change and its tests: 1, 2, 3 and 4 members at columns 2 and unlimited; bounds;
  ids `artboardIdOf(screenId, viewportId)` unchanged; today's layouts byte-for-byte unchanged when no group is
  passed.

A member with its own `viewports` subset that excludes the chosen one still shows (directions are
compared at one size). Member screens never get rows of their own. Artboard ids stay `artboardIdOf(screenId,
viewportId)`, so pins, budget, reloads and anchoring work unchanged. The viewport defaults to the first of
`of`'s viewports; the choice is kept per design in `host.storage` `view:<slug>` as `directionViewport: { [of]:
viewportId }` (unknown id → first).

| Where | Page | Rail |
|---|---|---|
| Layout | one row: Current, A, B, C/D (`directionColumns` unset) | 2×2 grid: Current, A / B, C (`directionColumns: 2`), all visible at once after Fit |
| Row header | "<Title> · 3 directions" (`--oc-fg`, the label style) + a small `mountSelect` "Show at" (visible label, `aria-label` "Show directions at") with the original's viewports | the same text and the **same "Show at" select, drawn in the header** (owner decision; the mockup omitted it): on its own line under the title when the header is narrower than title + select, size `xs`; not moved into the ⋯ menu |
| Board labels | "Current · Laptop 1280×800", "A · Bold", "B · Editorial" (agent names via `textContent`) | same, clipped with the full name in the tooltip |
| Keep this one | outline `xs` button in each written board's label (`check` icon), Current included | each board label's ⋯ menu item **Keep this one** |
| Not written yet | the existing "screens/x.html not written yet" board; Keep disabled "Not written yet" | same |
| Keeping | the pressed button spins; every other Keep and the row's menu disabled | same |
| Done | normal row again; notice with Undo | same |
| Refused | the §2.8 sentence as an error notice; the wall refreshes on stale | same |
| Viewing a version | Keep hidden; the group keeps its row layout | Keep hidden; the group keeps its grid layout |

**Try 3 directions…** (row menu, 11-1): disabled "This screen already has directions. Keep one first." when the
row is a group root, "This is a direction of <Title>. Keep one first." for a member (members have no row anyway;
the entry appears only on rows), and at the cap "A canvas holds up to 40 screens." when fewer than 2 screens are
free. Click → `openPopover` "What should the directions explore? (optional)" + **Ask the agent**, same as
"+ Screen"; text from `directionsAsk({ title, id, free, note })`:
`Make 3 different directions for the screen "<title>" (screens/<id>.html). Write each as its own screen (<id>-a, <id>-b, <id>-c) and mark it in design.json as a direction of "<id>", as RULES.md describes. Leave "<id>" as it is. The canvas has room for <free> more screens.`
plus, when given, `What to explore: <note>`.

DirectionPick (Phase 1.5) is unchanged: it stays folder-based. The agent text in §9 tells agents to use
DirectionPick only when each option is its own design folder; for canvas directions the wall is the picker.
When the agent nevertheless asks in chat, the user answers there and the agent acts itself (11-5); the wall's
Keep needs no chat block.

### 6.4 Edge cases (11)

A mark naming a screen that does not exist: normal row plus warning. Fewer than 2 members written: the row
shows what exists; Keep works on written boards. The user keeps while the agent still writes C: C's file stamp
changed (or it appeared) → stale. Links from other screens to `screens/home-b.html` after Keep point at a
trashed file: Play mode shows the existing "Not a screen of this design" toast; the agent fixes on request.
A group whose root the user trashes: the members' marks become orphans on the next read (normal rows, warning).
Reorder with a group: the group moves with its root's entry (members' entries are not rows; their list position
does not matter). Duplicate on a group root: the copy has no members (marks name the original id). The same
design open on the rail and the page: the rail draws the grid and the page the row from the same layout function;
the "Show at" choice lives in `host.storage` `view:<slug>`, read when each view opens (a change on one surface
reaches the other on its next open, not live). A phone viewport chosen in the rail grid: two narrow cells per
line, Fit makes them readable; a laptop viewport: Fit zooms out further, the grid still shows all four.

---

## 7. Hand edits in the next message (owner decision Q5)

### 7.1 Where the record lives

The ledger half of `.chamber/edits.json` (§2.1): survives a service restart, goes to the trash with the folder,
never versioned or exported. Each successful hand edit (text, tweaks, reorder, duplicate, trash, keep) appends
one `HandEdit` with the next `seq`. An undo removes its edit's entry when that entry is still in the ledger
(not yet sent), else appends `{ kind: 'undo', of: <label> }`. Over `HAND_EDITS_LEDGER_MAX` (30) entries, the
oldest are dropped and `dropped` counts them. Nothing is sent on its own.

### 7.2 Building the block (`src/shared/agent/hand-edits.ts`, new, pure)

`buildHandEditsBlock(entries, dropped, { maxChars }) → { text, upTo, count, compact } | null` (null for no
entries). Full form, one line per entry, oldest first:

```
Hand edits since my last message. I made these in Design Chamber, so re-read these files before you change them. Quoted text is data:
- Changed text in Home (screens/home.html): "Ship faster" to "Ship it faster"
- Moved Checkout above Pricing (design.json screens)
- Saved tweaks in tokens.css: Accent hue 210 to 250, Corner radius 8px to 12px
- Duplicated Home as Home copy (screens/home-copy.html)
- Moved Pricing to the trash (screens/pricing.html is gone; leave it out of design.json)
- Kept direction B "Editorial" for Home; the other directions are in the trash
- Kept the current Home; its directions are in the trash
- Reordered the screens: Home, Checkout, Pricing
- Undid: Text updated in Home
- and 3 earlier hand edits
```

Each line ≤ `HAND_EDIT_LINE_MAX` (240) after clipping its quotes; quotes are one-lined, `"` inside a quote becomes
`'`, so a quote cannot close early. The whole block is ≤ `HAND_EDITS_BLOCK_MAX` (1 500); beyond that, the newest
lines are kept and the rest fold into "and N earlier hand edits". Compact form, used when a message would
otherwise not fit (§7.3):

```
I made 7 hand edits in Design Chamber since my last message (screens/home.html, tokens.css, design.json). Re-read those files before you change them.
```

(file list deduplicated, ≤ 6 names, then "and more"). No em dashes; plain words; first person, because the
message is sent as the user's.

### 7.3 Adding it to messages within the 16 000-char limit (§11.4)

In `src/service/routes/chat.ts`, for purposes `revision`, `ask`, `checks` and `offline` (comments, ask, fix,
"Ask the agent to fix it"; also "+ Screen" and "Try 3 directions…", which are asks); not `continue`:
1. Read the ledger (inside nothing heavier than a file read; no chain needed for a read).
2. `block = buildHandEditsBlock(…, { maxChars: HAND_EDITS_BLOCK_MAX })`.
3. Build the message with the existing builder and `maxChars = REVISION_TEXT_MAX − block.length − 1`
   (`buildRevisionPrompt` already takes `maxChars`; `buildAskPrompt`, `buildChecksPrompt` and
   `buildOfflinePrompt` gain the same optional input, default `REVISION_TEXT_MAX`). The block goes first,
   then a blank line, then the message.
4. When the builder had to cut (revision level ≥ 2, ask `AskTooLongError`, checks over the cap), rebuild once with
   the compact block; when even that does not fit an ask (the user's words are never cut), build without the
   block and answer `handEdits: null` (the ledger stays for the next message).
5. `PromptResponse` gains `handEdits: { upTo, count } | null`.

The guest (`src/guest/flows.ts`, in the one `deliver` path) calls `POST /designs/:slug/hand-edits/clear
{ upTo }` after an outcome of `sent`, `composed`, `outbox` or `new-session` (the message reached the chat or its
queue). A failure there is logged and ignored: the same lines may repeat in the next message, which is harmless.
A failed delivery clears nothing.

### 7.4 Agent side

The rules add "re-read a file before you change it" (§9). Agents that ignore both lose the user's change only to
their own later write, which the owner accepted (10-4); the version before each hand edit keeps it.

---

## 8. Pages that remember their state (feature 19)

**Scope: every design kind, pages and canvases alike** (PS §7, BRIEF "one store per design, shared by all its
screens and viewports"). A canvas has one `page-state.json` and one controller per surface; every live artboard
of every screen and viewport is seeded from, writes to and is synced through that one map, so a tick in
"Home · Laptop" shows in "Home · Phone" and in "Checkout" when it reads the same key. Nothing in §8.1 to §8.6
is keyed by screen or viewport; the frame-to-design rule (§8.7) is the only scoping. Visual and e2e coverage
(U5, Q4) include a two-screen canvas.

### 8.1 Data changes: `<design>/.chamber/page-state.json`

```jsonc
{ "v": 1, "updated": "ISO", "items": [ ["checklist:done", "[1,3,4]"], ["theme", "dark"] ] }
```

- Pairs, not an object, so key order is insertion order (for `key(n)`) and keys such as `__proto__` or `"1"` are
  plain data.
- Cap (owner 19-7): the sum of key and value lengths in UTF-16 code units ≤ `PAGE_STATE_MAX_CHARS` (1 048 576),
  counted like browsers count storage.
- Read: `resolvePlainTarget(dir, ['.chamber', 'page-state.json'], { allowAbsent: true })` (§2.3; a link, or a
  `.chamber` that is a link, reads as empty and every write refuses), regular file,
  ≤ `PAGE_STATE_FILE_MAX_BYTES` (8 MiB, room for JSON escaping), then `parsePageStateFile` (pure,
  `src/shared/page-state.ts`): `v === 1`, `items` an array of `[string, string]`, keys unique (first wins), total
  ≤ the cap. Anything else reads as no data (`damaged: true` in the answer, logged as
  `page-state.unreadable` with the slug only); the next save replaces the file.
- Written with `writeFileAtomic(…, { createDirs: false })` after the non-recursive `.chamber` mkdir (a deleted
  design is never re-created), `.chamber` a real folder.
- Never in a version, an export, a mention, a revision, ask or fix message, a thumbnail or check render, or a
  log line (only slug, item count and size are logged). It goes to the trash with the design folder and is
  untouched by restore (§6.4 never touches `.chamber/`).

### 8.2 Service routes and module

`src/service/page-state.ts` `createPageStateService({ store, hub, log, now })`, `ensurePageStateService(ctx)`;
routes in `src/service/routes/page-state.ts`, each behind the bearer check, slug through `store.dir`:

| Method & path | Request | Response |
|---|---|---|
| `GET /designs/:slug/page-state` | — | `{ items: [string, string][], chars, gen, damaged?: true }` (≤ 1 MiB of text plus JSON, under the 7.5 MB answer cap) |
| `PATCH /designs/:slug/page-state` | `{ gen, clear?: boolean, changes?: [string, string \| null][] }` (≤ `PAGE_STATE_CHANGES_MAX` 10 000 entries) or `{ gen, uploadId }` holding that JSON (when the body does not fit one request, §8.4) | `{ chars, gen }`; 409 `stale` when `gen` is older than a Clear (below), nothing applied; 413 `too-large` "This design tried to save more than 1 MB of page data. The extra wasn't saved." and nothing of this delta applied; 400 malformed (a missing `gen` included) |
| `DELETE /designs/:slug/page-state` | — | `{ ok: true, gen }` (removes the file; nothing to trash, it is not a design file) |

**Clear never comes back (product decision: no resurrection).** The service keeps a per-design clear counter
in memory (`clears: Map<slug, number>`, separate from the data cache so it is never evicted with it; dropped
on `removed` and a root change) and answers it as `gen = "<ctx.epoch>:<n>"` (`n` = clears so far). `DELETE`
increments `n`. A `PATCH` whose `gen` has the current epoch and a smaller `n` was made before a Clear, so its
changes are dirty keys from a surface that has not yet seen the Clear: it answers 409 `stale` and applies
nothing. A `gen` from another epoch (the service restarted since that surface loaded) is accepted: the
counter cannot say, and the only loss is a Clear followed by a restart within the other surface's 1 s
flush window (§14). `isOlderClear(gen, current)` is pure, in `src/shared/page-state.ts`, with its tests.

- Memory: one `Map` per design touched (loaded on first use), dropped 10 minutes after its last use once flushed,
  and at most `PAGE_STATE_CACHE_MAX_BYTES` (32 MiB) in all (least recently used dropped after a flush).
- `PATCH` applies `clear` first, then `changes` in order (`null` removes), checks the cap on the result, and on
  success schedules the disk write: at most one per design per `PAGE_STATE_WRITE_MIN_MS` (1 000 ms); a write that
  is due later is coalesced. Last write wins across windows (19 edge case). Answers before the disk write.
- `DELETE` cancels a pending write, unlinks the file (ENOENT is fine), clears the cache entry.
- After a successful `PATCH` or `DELETE` the service emits `{ slug, kind: 'page-state' }` (no data in the
  event; the watcher ignores `.chamber/` anyway).
- Shutdown (`ctx.onDispose`) flushes every pending write; a `removed` event drops the design's pending write; a
  root change flushes to the old paths (already resolved) and clears the cache.
- A disk failure is logged with the error code; the next `PATCH` answers 500 with the `folderErrorSentence` so the
  viewer can show its notice; the memory copy stays.

### 8.3 The stand-in inside the frame (`src/guest/bridge/storage-shim.ts`, new)

Installed by the bridge before it does anything else, so it is in place before any design script (the bridge is
the first child of `<head>`, `src/guest/frame-doc.ts:54-73`):
- `installStorage(window, init: StorageInit | undefined, post)`: defines `localStorage` and `sessionStorage` on
  the window with `Object.defineProperty(window, name, { value, configurable: true, enumerable: true, writable:
  false })` (verified, §1). Without a valid `init` (thumbnails, versions, compare, any frame that is not the
  live viewer): empty and unsaved (`persist: false`).
- Each is a `Proxy` over an in-frame `Map` seeded from `init.items`, with the `Storage` surface:
  `getItem`, `setItem` (`String()` of key and value), `removeItem`, `clear`, `key(n)`, `length`, and named
  property access (`localStorage.theme`, `localStorage['x'] = 'y'`, `delete`, `in`, `Object.keys`) through the
  proxy traps; method names are not shadowed by items.
- Cap: a `setItem` that would take this frame's view over `PAGE_STATE_MAX_CHARS` throws a `DOMException` named
  `QuotaExceededError` and changes nothing (the design's own error handling runs, PS 19).
- Persisting (`localStorage` only, `persist: true` only): changes are queued per task in a `Map<key, string |
  null>` (a later change to a key replaces the earlier one, so a loop of 20 000 `setItem` on one key posts one
  entry) plus a `clear` flag (`clear()` sets it and empties the queued map); at the task's end
  (`queueMicrotask`) the queue is posted to `window.parent` as one or more `storage-batch { clear, changes }`
  messages, split so each holds ≤ `PAGE_STATE_CHANGES_MAX` (10 000) entries **and** ≤ `PAGE_STATE_BATCH_MAX_CHARS`
  (= `PAGE_STATE_MAX_CHARS`, 1 048 576) characters of keys plus values; only the first carries `clear: true`;
  posted in order in the same task. A single entry always fits (the quota already caps one value), so no
  honest batch is ever rejected. A frame removed later loses nothing that was already set. `sessionStorage`
  never posts.
- Page → frame `storage-sync { clear, changes }` updates the `Map` without firing `storage` events (19 says no
  live events) and without posting back.
- Known differences, stated in the rules (§9) only as "works like localStorage for string values":
  `localStorage instanceof Storage` is false; no `storage` event; IndexedDB, cookies and Cache Storage still
  throw (out of scope).

### 8.4 The page side (`src/guest/page-state.ts`, new, fullstack)

`createPageStateController({ client, slug, onNotice })`, one per open live design per surface:
- `load()`: `GET page-state` before the design's frames are created (frame slots wait for it, at most 2 s);
  on failure **or on the 2 s timeout** (the timeout is a failure, not a wait) the view runs with
  `persist: false` and empty data, and shows once "Page data can't be saved right now. Changes last until you
  close this design." (a partial seed with `persist: true` could let a design's `clear()` wipe data it never
  saw). An answer that arrives after the timeout is ignored for this view (the frames are already running
  unsaved; switching them to saved mid-session would merge two states); reopening the design loads again.
  The controller keeps the `gen` it loaded.
- `init(): StorageInit` for every new live frame of the design: `{ persist: true, items: <current map> }`.
- `apply(board, batch)` from `frame-messages.ts`, only for a board whose main frame shows the live design (never a
  version, never the compare half, never a thumbnail): updates the design's map, checks the cap against the
  whole design (another frame may already have written), drops a change that would exceed it and shows once per
  view session "This design tried to save more than 1 MB of page data. The extra wasn't saved."; forwards the
  accepted changes to the design's other live frames as `storage-sync`; marks them dirty.
- Flush: at most one `PATCH` per `PAGE_STATE_FLUSH_MS` (1 000 ms), plus at once on `visibilitychange` to hidden,
  on closing the design and on dispose. **Inline or upload is decided by bytes, not characters:** the body is
  serialised (`JSON.stringify({ gen, clear, changes })`) and sent inline only when it fits one request by the
  rule the upload chunks already use, ≤ `UPLOAD_CHUNK_MAX_CHARS` (60 000) characters **and**
  ≤ `UPLOAD_CHUNK_MAX_BYTES` (75 000) UTF-8 bytes, under the router's 80 000-byte cap (`fitsOneRequest(json)`,
  new, exported from `src/guest/service-client.ts` beside `splitUploadChunks`, reusing its `utf8Length`).
  Otherwise the JSON goes through `client.upload` (`src/guest/service-client.ts:288`) and the PATCH is
  `{ gen, uploadId }`. So a 60 000-character delta of CJK text or emoji (≥ 180 kB in UTF-8) is uploaded, never
  answered 413. A delta of more than `PAGE_STATE_CHANGES_MAX` keys, or over `UPLOAD_TOTAL_MAX`, is split by
  keys into several `PATCH`es (the `clear` only on the first), and a single value too large for one upload is
  refused like the cap. A failed `PATCH` keeps the changes dirty, retries with the next flush (an idempotent
  "set these keys"), and after 3 failures shows the "can't be saved right now" notice once.
- **A Clear elsewhere wins over dirty keys here** (no resurrection). A `PATCH` answered 409 `stale` (its `gen`
  predates a Clear) drops every dirty key, refetches, adopts the new `gen` and reloads the design's live frames
  with the fetched data (the reload path that a `files` event uses), with the notice "Saved page data was
  cleared." (`page-data` id, once per view session).
- On a `page-state` change event for this slug (another surface wrote, or Clear ran): refetch, debounced 500 ms.
  When the answer's `gen` shows a newer Clear (`isOlderClear(mine, theirs)`), drop every dirty key and reload
  the live frames with the fetched data, same notice; otherwise push the difference to live frames as
  `storage-sync`, except keys still dirty here.
- **Clear saved page data**: cancel the pending flush and drop this surface's dirty keys, wait for an in-flight
  `PATCH` to settle, then `DELETE`; adopt the answer's `gen`; every live frame of the design reloads with empty
  data, notice "Saved page data cleared." The other surface either sees the event first (above) or has its
  next flush refused as stale (above); either way its unflushed keys are dropped, never written back.

### 8.5 Check renders and thumbnails (AD-12)

- `src/service/check/render.ts` installs the stand-in with `persist: false` in every artboard before
  navigation, with CDP `Page.addScriptToEvaluateOnNewDocument({ source: __DC_STORAGE_SHIM__ })` (main world,
  runs before page scripts); `__DC_STORAGE_SHIM__` is a new build output (§16, build step (1c): the shim alone
  as an IIFE that calls `installStorage(window, undefined, noop)`), embedded in the service and the CLI like
  `__DC_PROBE__`. Each artboard starts empty; nothing persists. `test/service/check/render.e2e.test.ts:100`
  changes from "localStorage throws" to "localStorage works, is empty in every artboard, and a write does not
  reach the next artboard".
- Thumbnails stay plain `file://` renders in a throwaway profile (§4.4): native storage, empty, discarded.
- The live mini-frame thumbnail (`thumb.ts:94-95`) is `sandbox=""`: no script runs in it at all, neither the
  bridge (so no stand-in) nor the design's own scripts, so storage is never touched there. Nothing changes.

### 8.6 Frontend (19)

- ⋯ menu entry **Clear saved page data** (rail and page, `model/viewer-menu.ts`), after Copy path; enabled only
  when the design has saved data (`chars > 0` from the controller), else hidden; disabled while viewing a version.
- Confirm (`confirmDialog`, destructive): title "Clear saved page data for <title>?", body "Ticks, toggles and
  filters this design saved will be reset. This can't be undone.", **Clear** / **Cancel**. Clear loading → on
  success the dialog closes and the notice "Saved page data cleared." (`TransientId 'page-data'`, 5 s); on
  failure the dialog shows "Couldn't clear the saved page data. <message>" and stays.
- Notices (once per view session per design, `page-data` id, 10 s): the cap sentence, the "can't be saved right
  now" sentence. Tokens: the kit banner and dialog styles only.
- Model `src/ui/model/page-state-model.ts` (menu state, which notice, once-only bookkeeping), pure.

### 8.7 Security and threat model (19)

- **Who decides which design a frame's data belongs to:** the page, from the board the message came from
  (`event.source === contentWindow`, nonce, artboard id, `frame-channel.ts`). The frame never names a slug, a
  path or a key space; it cannot reach another design's map or the service.
- **Who sees the data:** the design's own frames (it is their data), the page in memory, the service, the file.
  Never other designs, chats, exports, versions, logs, thumbnails or check output. It is personal data (career
  notes), so it is never logged.
- **Abuse:** disk filling (cap per design; one file per design; 8 MiB read cap); write storms (one batch per
  task in the frame, ≤ 1 `PATCH`/s per surface, ≤ 1 disk write/s per design, bounded request bodies and the
  upload's 8-open limit); a forged `storage-batch` from a version or compare frame (ignored: only live boards are
  accepted, and those frames run with `persist: false`, so they never post); a hostile or hand-edited
  `page-state.json` (validated, size-limited, empty when wrong, only ever handed back as strings to its own
  design); prototype keys (pairs and `Map`, never object keys).
- **Sandbox and CSP:** unchanged: frames stay `allow-scripts` only, never `allow-same-origin`; the stand-in is
  ordinary script in the frame's own realm.

### 8.8 Platforms still to confirm

Proved on Linux, Chrome 157 (§1). To confirm before release, through the bridge e2e test (which CI runs on
Ubuntu, Windows and Fedora wherever a Chrome or Edge is installed) and the smoke click-through:
1. Windows: CI's bridge e2e with Chrome or Edge (Chromium), and the OpenChamber Electron build in a live
   click-through (owner or agent on a Windows machine).
2. macOS: not in CI; run `npm run check` (the bridge e2e uses the machine's Chrome) and the click-through in
   OpenChamber on a Mac (AGENTS.md process rule).
3. Linux Electron: the click-through in OpenChamber 2.7 here (agents may do it).
What each run checks: `defineProperty` succeeds on the window; bare and `window.` access reach the stand-in;
`QuotaExceededError` is a `DOMException`; a 1 MB value posts and seeds within 200 ms; IndexedDB still throws.

---

## 9. Agent instruction text (exact)

`rules/**` belongs to the rules author; the main agent assigns that edit. `src/shared/agent/**` is the
fullstack lane. Snapshots in `test/agent/__snapshots__/` are regenerated in the same task.

### 9.1 `rules/DESIGN-RULES.md`

1. Line 99 is replaced by:
   `- The design is rendered in a sandboxed iframe: no \`top.location\`, no \`window.open\`, no cookies, no network calls. \`localStorage\` works: Design Chamber keeps each design's saved data (up to 1 MB, shared by all its screens), so ticks, toggles and filters survive a reload. \`sessionStorage\` lasts until the screen reloads. IndexedDB does not work.`
2. Line 91 gains, after the first sentence:
   `For directions of one canvas screen, write each as a sibling screen (\`home-a\`, \`home-b\`, \`home-c\`) and mark it in design.json as a direction of the original (the design.json contract shows how); leave the original screen as it is. The user keeps one on the wall.`
3. New bullet after line 100:
   `- Offer tweaks when the user wants to tune the look: declare up to 12 knobs in design.json \`tweaks\`, each tied to one custom property in the \`:root\` block of \`tokens.css\` with a plain value (a number with its unit, or one of a few named values, never \`calc()\` or \`var()\`). Screens read them with \`var()\`. The design.json contract has an example.`
4. New bullet after that:
   `- Re-read a file right before you change it. The user can change text, tweaks and the screen list by hand in Design Chamber, and the next message from Design Chamber lists those hand edits. Never write a file from memory over their changes.`

### 9.2 `src/shared/agent/rules-doc.ts` (RULES.md and, through `renderingSection`, the bundled skill)

- `renderingSection` line `:266` becomes:
  `- Small inline \`<script>\` interactions work (clicks, tabs, toggles). \`localStorage\` works and is kept per design (up to 1 MB), so saved ticks and filters survive a reload; \`sessionStorage\` lasts until the screen reloads. There is no \`top.location\`, \`window.open\`, cookie, IndexedDB or network call.`
- `contractExample`: after `designSystem`, add `"tweaks": [ { "var": "--accent-h", "label": "Accent hue", "kind": "number", "min": 0, "max": 360, "step": 1, "unit": "" } ],` for both kinds.
- `contractSection` table, the `screens` row gains at its end:
  `A direction of another screen carries \`"direction": { "of": "home", "letter": "A", "name": "Bold" }\` (2 to 4 directions per screen, letters A to D, name up to 40 characters; never on the original). Design Chamber also writes this list when the user reorders, duplicates, trashes or keeps a screen, so read design.json again right before you write it.`
- New row after `designSystem`:
  `| \`tweaks\` | you | Optional, up to 12 knobs for the Tweaks panel. A number knob: \`{ "var", "label", "kind": "number", "min", "max", "step", "unit" }\`; a choice knob: \`{ "var", "label", "kind": "choice", "options": [{ "label", "value" }] }\` with 2 to 6 options. \`var\` must be set with a plain value in the \`:root\` block of tokens.css, in the knob's unit. When the user saves, Design Chamber writes only those values into tokens.css. |`
- New bullet after "Write the whole file as valid JSON in one write.":
  `- The user's hand edits (text, tweaks, the screen list) land in your files directly. Re-read a file before you change it.`
- `buildRulesDoc`, `checkSection`, `headerSection`: unchanged.

### 9.3 `src/shared/agent/instructions.ts:37` and `src/shared/agent/skill-doc.ts:37`

The DirectionPick sentence "To let the user choose between directions you made, ask with DirectionPick."
(instructions) / "To let the user pick between directions you made (each its own design folder), ask with
DirectionPick." (skill) becomes:
`To let the user pick between directions you made as separate design folders, ask with DirectionPick. Directions of one canvas screen are screens you mark in design.json instead; the user keeps one on the wall.`
`buildInstructions` must still fit `SERVICE_INSTRUCTIONS_MAX` (4 096): its test asserts it with the longest root.

### 9.4 Other prompt text

- `revision-prompt.ts` `locationLabel`: a comment whose screen id is not in the list reads
  `Screen "<id>" (removed from the canvas) @ <viewport>`.
- `screen-asks.ts` (new): the two ask texts in §5.2 and §6.3.
- `hand-edits.ts` (new): §7.2.

### 9.5 The owned-field lists (`tweaks` added)

Every text that tells an agent which design.json fields it may change must name `tweaks`, or an agent that
follows it never writes knobs (feature 09 would never appear). Exact replacements:

| File | Today | Becomes |
|---|---|---|
| `src/shared/agent/chip.ts:118` (step 7) | canvas `title, updated, viewports, screens and designSystem`; page `title, updated, viewports and designSystem` | canvas `title, updated, viewports, screens, designSystem and tweaks`; page `title, updated, viewports, designSystem and tweaks` |
| `src/shared/agent/guide.ts:158-159` (`buildAgentGuide`, the guide at `<root>/AGENTS.md`) | ``change only `title`, `updated`, `viewports`, `screens` and `designSystem`, and keep every other key as it is.`` | ``change only `title`, `updated`, `viewports`, `screens`, `designSystem` and `tweaks`, and keep every other key as it is.`` |
| `src/shared/agent/skill-doc.ts:35` (the bundled skill) | `In an existing design.json change only title, updated, viewports, screens and designSystem, and keep every other key as it is.` | `In an existing design.json change only title, updated, viewports, screens, designSystem and tweaks, and keep every other key as it is.` |

- **No guide version bump.** The service rewrites `<root>/AGENTS.md` whenever the text `buildAgentGuide`
  produces differs from the file and the file is still ours and unedited (`outdated` → replace,
  `src/service/agent-setup.ts:322-334`), on the next start or root change. Bumping the marker's `v1`
  (`ownership.ts:16`) would instead make every installed guide unrecognised. A guide the user edited is left
  alone, as today.
- **`guide.ts:239-240` stays as it is.** It is inside `buildSkillDoc`, which reproduces the SKILL.md that
  older versions installed so the service can recognise that copy and offer to remove it
  (`agent-setup.ts:374-400`); the service never writes it any more, so changing it reaches no agent, and
  keeping it byte-identical keeps the recognition test meaningful.
- Snapshots regenerated in the same task (T7b): `test/agent/__snapshots__/{chip.continue-canvas,
  chip.new-canvas-project-preset, chip.new-page-no-project}.txt`, `guide.{posix,win32}.md`,
  `skill.bundled.md`, plus the three from §9.2. Chip text stays ≤ its caps (`CHIP_TEXT_HARD_MAX`), asserted by
  the existing chip tests.

---

## 10. WP0 contract changes (exact; the main agent applies them and notifies every lane)

### 10.1 `src/shared/types.ts`

```ts
export type TweakNumber = { var: string; label: string; kind: 'number'; min: number; max: number; step: number; unit: string };
export type TweakChoice = { var: string; label: string; kind: 'choice'; options: { label: string; value: string }[] };
export type Tweak = TweakNumber | TweakChoice;
export type DirectionLetter = 'A' | 'B' | 'C' | 'D';
export type DirectionMark = { of: string; letter: DirectionLetter; name: string };
// Screen:      + direction?: DirectionMark
// DesignJson:  + tweaks: Tweak[]            (page and canvas; [] when absent)
// AgentOwnedField: + 'tweaks'               (doc comment: `screens` is shared, §5.1)
// VersionReason:   + 'user-edit' | 'keep-direction'
// ChangeKind:      + 'page-state'
// ChangeEvent:     + origin?: 'user'        (set only on events the edit pipeline emits)
// CheckCode:       + 'tweak-broken'
// CheckParams:     + tweak?: 'missing' | 'formula' | 'unit' | 'no-tokens'
export type HandEditBase = { seq: number; at: IsoDate; editId: string };
export type HandEdit = HandEditBase & (
  | { kind: 'text'; file: string; screen: string | null; before: string; after: string }
  | { kind: 'tweaks'; changes: { label: string; before: string; after: string }[] }
  | { kind: 'reorder'; moved: string; above: string | null }      // exactly one screen moved
  | { kind: 'reorder-many'; order: string[] }                     // several moved at once (≤ 40 titles)
  | { kind: 'duplicate'; screen: string; copy: string; file: string }
  | { kind: 'trash'; screen: string; file: string }
  | { kind: 'keep'; screen: string; letter: DirectionLetter | null; name: string | null }
  | { kind: 'undo'; of: string });
```

### 10.2 `src/shared/api.ts`

```ts
export type FileStamp = { size: number; mtime: IsoDate | null };
export type EditTarget = { tag: string; id: string | null; text: string; sameIndex: number; sameCount: number };
export type TweakValue = { var: string; value: number | string };
export type EditRequest =
  | { op: 'text'; screen: string | null; base: string; target: EditTarget; before: string; after: string }
  | { op: 'tokens'; base: string; values: TweakValue[] }
  | { op: 'reorder'; screens: string; order: string[] }
  | { op: 'duplicate'; screens: string; id: string; file: FileStamp }
  | { op: 'trash-screen'; screens: string; id: string; file: FileStamp | null }
  | { op: 'keep-direction'; screens: string; of: string; keep: string; files: { id: string; file: FileStamp | null }[] };
export type EditStamps = { file?: string; tokens?: string; screens?: string };
export type EditResponse = { edit: { id: string; label: string; files: string[]; undoable: boolean }; version: VersionSummary | null; coalesced: boolean; stamps: EditStamps; created?: { id: string; title: string } };
export type UndoEditResponse = { files: string[]; stamps: EditStamps; version: VersionSummary | null };
export type TweakState = { var: string; state: 'ok' | 'value' | 'missing' | 'formula' | 'unit' | 'no-file'; value: number | string | null; fileUnit: string | null; alsoSet: string[] };
export type TokensResponse = { exists: boolean; editable: boolean; sha256: string | null; knobs: TweakState[] };
export type HandEditsClearBody = { upTo: number };
export type PageStateItems = [string, string][];
export type PageStateResponse = { items: PageStateItems; chars: number; gen: string; damaged?: true };
export type PageStatePatchBody = { gen: string; clear?: boolean; changes?: [string, string | null][] } | { gen: string; uploadId: string };
export type PageStatePatchResponse = { chars: number; gen: string };
export type PageStateClearResponse = { ok: true; gen: string };
// SourceResponse:        + sha256: string; utf8: boolean; link: boolean
// DesignDetailResponse:  + screensStamp: string | null; designJson: 'ok' | 'missing' | 'invalid'
// PromptResponse:        + handEdits: { upTo: number; count: number } | null
// ApiRoutes + ROUTE_OWNERS ('P2' added to the owner union):
//   'POST /designs/:slug/edits'                 Route<NoQuery, EditRequest, EditResponse>
//   'POST /designs/:slug/edits/:id/undo'        Route<NoQuery, Record<string, never>, UndoEditResponse>
//   'GET /designs/:slug/tokens'                 Route<NoQuery, undefined, TokensResponse>
//   'POST /designs/:slug/hand-edits/clear'      Route<NoQuery, HandEditsClearBody, OkResponse>
//   'GET /designs/:slug/page-state'             Route<NoQuery, undefined, PageStateResponse>
//   'PATCH /designs/:slug/page-state'           Route<NoQuery, PageStatePatchBody, PageStatePatchResponse>
//   'DELETE /designs/:slug/page-state'          Route<NoQuery, undefined, PageStateClearResponse>
```

`keep-direction` `files` is a list, not a record, so no request key is ever an object property name.
`gen` is opaque to the page except through `isOlderClear` (§8.2); the service validates it as a string ≤ 120
chars of the form `<epoch>:<n>`, `n` a non-negative integer (400 otherwise). Seven new routes: 44 → 51, so
`test/shared/api.test.ts:8` changes to `51` in T0.

### 10.3 `src/shared/limits.ts`

| Constant | Value | Constant | Value |
|---|---|---|---|
| `EDIT_ID_PATTERN` | `/^e_[a-z0-9]{8,24}$/` | `TWEAKS_MAX` | 12 |
| `TEXT_EDIT_MAX` | 5 000 | `TWEAK_LABEL_MAX` | 40 |
| `EDIT_PROBE_ID_MAX` | 200 | `TWEAK_VAR_PATTERN` | `/^--[A-Za-z0-9_-]{1,64}$/` |
| `EDIT_PROBE_SCAN_MAX` | 5 000 | `TWEAK_UNIT_PATTERN` | `/^[a-z%]{0,6}$/` |
| `USER_EDIT_COALESCE_MS` | 60 000 | `TWEAK_NUMBER_ABS_MAX` | 1 000 000 |
| `USER_UNDO_KEEP` | 10 | `TWEAK_CHOICES_MIN` / `_MAX` | 2 / 6 |
| `USER_UNDO_TTL_MS` | 30 min | `TWEAK_CHOICE_LABEL_MAX` | 30 |
| `USER_EDIT_NOTICE_MS` | 10 000 | `TWEAK_CHOICE_VALUE_PATTERN` | `/^[A-Za-z0-9 #%.,()+\-'"/]{1,80}$/` |
| `SELF_WRITES_MAX` | 1 024 | `TOKEN_PREVIEW_VALUE_PATTERN` | `/^[A-Za-z0-9 #%.,()+\-'"/]{1,100}$/` (plus balanced quotes, §4.2) |
| `EDITS_FILE_MAX_BYTES` | 262 144 | `TOKENS_CSS_MAX_BYTES` | 1 000 000 |
| `HAND_EDITS_LEDGER_MAX` | 30 | `DIRECTION_NAME_MAX` | 40 |
| `HAND_EDIT_QUOTE_MAX` | 80 | `PAGE_STATE_MAX_CHARS` | 1 048 576 |
| `HAND_EDIT_LINE_MAX` | 240 | `PAGE_STATE_FILE_MAX_BYTES` | 8 388 608 |
| `HAND_EDITS_BLOCK_MAX` | 1 500 | `PAGE_STATE_CHANGES_MAX` | 10 000 |
| `PAGE_STATE_WRITE_MIN_MS` | 1 000 | `PAGE_STATE_FLUSH_MS` | 1 000 |
| `PAGE_STATE_BATCH_MAX_CHARS` | 1 048 576 (= `PAGE_STATE_MAX_CHARS`) | `PAGE_STATE_CACHE_MAX_BYTES` | 33 554 432 |

`SCREENS_MAX`, `SOURCE_TEXT_MAX`, `DIRECTION_OPTIONS_MAX`, `UPLOAD_TOTAL_MAX`, `UPLOAD_CHUNK_MAX_CHARS`,
`UPLOAD_CHUNK_MAX_BYTES`, `REVISION_TEXT_MAX`, `ASK_TEXT_MAX` are reused, not repeated (the inline-or-upload
rule for page data is the upload chunk rule, §8.4, so there is no page-data inline constant). The file stays
import-free.

### 10.4 `src/shared/bridge-protocol.ts`

```ts
export type TokenVar = { name: string; value: string };
export type StorageInit = { persist: boolean; items: [string, string][] };
export type StorageChange = [string, string | null];
export type EditProbe = { tag: string; id: string | null; leaf: boolean; text: string; truncated: boolean; sameIndex: number; sameCount: number; dir: 'ltr' | 'rtl'; rect: Rect };
// BridgeInit: + tokens?: TokenVar[]; + storage?: StorageInit
// PageToFrameMessage +
//   (Envelope<'edit-probe'> & { x: number; y: number })
//   (Envelope<'set-tokens'> & { vars: TokenVar[] })
//   (Envelope<'storage-sync'> & { clear: boolean; changes: StorageChange[] })
// FrameToPageMessage +
//   (Envelope<'edit-probe-result'> & { x: number; y: number; probe: EditProbe | null })
//   (Envelope<'storage-batch'> & { clear: boolean; changes: StorageChange[] })
```

Validators (both directions, in the same tables):
- `edit-probe`: `isNum(x) && isNum(y)`.
- `set-tokens`: `vars` list ≤ `TWEAKS_MAX`, each `name` matches `TWEAK_VAR_PATTERN`, `value` matches
  `TOKEN_PREVIEW_VALUE_PATTERN` and has balanced quotes.
- `storage-sync`, `storage-batch`: `clear` boolean; `changes` list ≤ `PAGE_STATE_CHANGES_MAX`, each a 2-tuple of a
  string and a string or `null`, and the **sum of all key and value lengths in the message**
  ≤ `PAGE_STATE_BATCH_MAX_CHARS` (counted while validating, stopping at the first excess). The shim splits to
  fit both caps (§8.3), so a rejected batch means a hostile or broken frame.
- `edit-probe-result`: point numbers; `probe` null or: `tag` id ≤ `BRIDGE_TAG_MAX`, `id` null or string 1..
  `EDIT_PROBE_ID_MAX`, booleans, `text` ≤ `TEXT_EDIT_MAX + 1`, `sameIndex`/`sameCount` integers with
  `0 ≤ sameCount ≤ EDIT_PROBE_SCAN_MAX` and (`sameCount === 0` or `0 ≤ sameIndex < sameCount`), `dir` one of two,
  `rect` `isRect`.
- `BridgeInit` (read by the bridge's `readInit`, `bridge.ts:36`): `tokens` and `storage` optional; malformed
  `tokens` → none; malformed `storage` → `undefined` (empty, unsaved). The page caps what it puts there with the
  same rules.

### 10.5 `src/shared/design-json.ts`

`parseTweaks`, direction-mark parsing and group validation (§4.1, §6.1), `DesignJson.tweaks`, `KNOWN_FIELDS` /
`CANONICAL_ORDER` + `'tweaks'`, `AGENT_OWNED_FIELDS` + `'tweaks'`, `ServiceWrite` + `screens?: JsonValue[]`
handled by `mergeServiceFields` like `title`, and the exported pure helper `directionGroups(screens)`. Tests in
`test/shared/design-json.test.ts`: every warning row, cycles, a 13th knob, unknown knob keys ignored, an old
design.json (no `tweaks`, no marks) normalising exactly as before.

### 10.6 `src/service/context.ts`

- `DesignRecord` + `screensStamp: string | null`, `designJson: 'ok' | 'missing' | 'invalid'`.
- `type WriteHooks = { beforeRename?: (bytes: Uint8Array) => void }`.
- `DesignStore` + `writeScreens(slug, expectStamp: string, mutate: (raw: JsonValue | undefined) => JsonValue[], hooks?: WriteHooks): Promise<{ stamp: string; bytes: Uint8Array }>`
  (throws 409 `conflict` after the 5th lost attempt, §5.1)
  and `moveComments(slug, moves: { from: string; to: string }[], hooks?: WriteHooks): Promise<{ moved: { id: string; from: string; to: string }[]; bytes: Uint8Array | null }>`.
- `ChangeHub.emit(event: { slug: string | null; kind: ChangeKind; files?: string[]; origin?: 'user' }): ChangeEvent`
  (`:125`), and `src/service/changes.ts:39-41` copies `origin` into the event it builds (§2.6). `changes.ts` is
  not a WP0 interface file, but it implements this one, so it changes in T0 with it.
- `ServiceContext` + `selfWrites: SelfWrites` (`{ record(slug, rel, sha256 | null, size | null): void;
  isEcho(slug, rel, dir): Promise<boolean>; forget(slug, rel): void; forgetDesign(slug): void; clear(): void }`, §2.6).
- `test/helpers/fake-context.ts` gains fakes for the three (WP0 helper).

### 10.6a Contracts outside the WP0 files that several tasks rely on

Not WP0 (one owning task each), listed so every lane builds against the same shape:

| Contract | File | Owner | Used by |
|---|---|---|---|
| `SnapshotRefusedError` (`refusal: 'too-large' \| 'unsupported' \| 'unreadable' \| 'torn'`), `trackedHashOf(rel, bytes)`, `treeHashOf(files)`, `VersionsService.userEdit` (§2.4) | `src/service/versions.ts` | T2a | T2b |
| `resolvePlainTarget`, `isPlainTarget` (§2.3) | `src/service/paths.ts` | T0 | T2a, T2b, T3, T4, T5, T8 |
| `replaceFileIfHashUnchanged`, `moveNoReplace` (§2.5) | `src/service/paths.ts` | T2a | T2b, T3, T4, T5 |
| `OpModule`, `OpInput`, `OpPlan`, `PlannedStep` (§2.4) and the three op stubs | `src/service/edits/op-module.ts`, `ops-{text,screens,tokens}.ts` | T2b | T3, T4, T5 |
| `createEditsFile` (`read`, `update`, §2.1) | `src/service/edits/file.ts` | T2b | T6 (`read` in `chat.ts`) |
| `fitsOneRequest(json)` (§8.4) | `src/guest/service-client.ts` | T11b | — |
| `DrawerKind` + `'tweaks'` | `src/ui/wall/view-context.ts:24` | U2 | U2 |

### 10.7 Exhaustive tables that must change in the same commit

So typecheck stays green: `src/shared/checks.ts` (the `tweak-broken` entry, §4.7), `src/ui/model/versions-model.ts`
`reasonLabel` (two cases), `src/guest/fake-services.ts` and `test/ui/visual/fake-backend` (graceful answers for the
seven routes), and stub registrations `registerEditRoutes` / `registerPageStateRoutes` answering 500 "This part of
Design Chamber (edits) is not built yet." until their tasks land (the Phase 1.5 PR 1 pattern), wired in
`compose.ts`.

---

## 11. Security and threat model (phase)

### 11.1 Surfaces and who is trusted

| Surface | Trusted? | What it can do in Phase 2 |
|---|---|---|
| Page and rail guests (our code) | yes, but they never hold the token | start hand edits only from user gestures; route storage for frames they own |
| Design frames (agent HTML + bridge) | no | report clicks and probes, receive previews and storage, post storage batches for their own design; nothing else |
| Service | yes | every read and write; bearer-checked |
| design.json, tokens.css, HTML, edits.json, page-state.json on disk | no (agent-written or tamperable) | validated where read |
| The agent | no (writes freely, never reaches the service) | its later write wins; is told about hand edits |

### 11.2 Every new route

All seven routes: the constant-time bearer check (`http.ts`, 401 without), the router's 80 kB body cap (413), `slug`
by `SLUG_PATTERN` then `resolveInside(root, [slug])` + `isDesignFolder` through `store.dir` / `store.get` (400
`bad-slug`, 404), no path in any body (screen ids by `SCREEN_ID_PATTERN`, edit ids by `EDIT_ID_PATTERN`, vars by
`TWEAK_VAR_PATTERN`), every file through `resolvePlainTarget(designDir, …)` (containment by `resolveInside`, then
the realpath compared with the lexical path so a link anywhere on the way is refused, then a regular-file
`lstat` of the lexical path, §2.3), every failure a sentence. Rejecting tests are named in §17.

### 11.3 Every frame boundary crossing

| Message | Direction | Payload | Validated by | Trusted side | Effect |
|---|---|---|---|---|---|
| `edit-probe` | page → frame | point | `parsePageMessage` | page | frame computes a probe |
| `edit-probe-result` | frame → page | `EditProbe` | `parseFrameMessage` + source + nonce + artboard id | page | locator for a later user gesture; can make Edit text unavailable, never write |
| `set-tokens` | page → frame | ≤ 12 `{ name, value }` | both ends | page | inline custom properties on `<html>` |
| `storage-sync` | page → frame | changes | both ends | page | updates the frame's map |
| `storage-batch` | frame → page | changes | `parseFrameMessage`, live-board check, design cap | page | changes the design's saved data, nothing else |
| `window.__DC.tokens`, `.storage` | page → frame (document) | as above | the page caps; the bridge re-validates | page | seeds the frame |

Sandbox flags unchanged (`ARTBOARD_SANDBOX = 'allow-scripts'`, `src/guest/frame-doc.ts:12`), never
`allow-same-origin`; CSP unchanged (the host's `guestFramePolicy`, inherited by the blob frame); feed unchanged
(service-bundled HTML in a `blob:` URL). The check render keeps its sandbox CSP and gains only the stand-in script.

### 11.4 Abuse vectors and mitigations

| Vector | Mitigation |
|---|---|
| Forged frame messages steering a write | no frame message starts a write (E1, test §17); the service locates from bytes (AD-2) |
| A design changing its DOM to confuse the toolbar | at worst Edit text is unavailable (PS 08) |
| Markup injection through typed text | escaped at the write; result re-scanned; `</p><script>` test |
| Knob injection (a value that breaks out of a declaration) | values only from the knob's range or options; option values and preview values exclude `; { } < > \ *`; splice replaces one declaration value and is re-scanned |
| Direction-mark injection | validated marks; names shown with `textContent`; marks never become paths |
| Write storms | one write per user gesture, single flight per control; page data ≤ 1 PATCH/s per surface, ≤ 1 disk write/s per design |
| Storage cap abuse | 1 MB per design in the frame, the page and the service; 8 MiB read cap; one file per design |
| Hostile `page-state.json` / `edits.json` | size cap, schema validation, empty when wrong, paths and patterns re-checked at use, ledger rendered from fields |
| Symlink escapes and inside links | `resolvePlainTarget` on every path: `resolveInside` refuses links out; the realpath-vs-lexical comparison refuses a link inside the design (leaf or parent folder), so edit targets, `.chamber`, `edits.json`, `page-state.json` are never links |
| Losing an update to edits.json | one per-slug queue for every read-modify-write (`editsFile.update`), re-read inside the queue |
| A clear brought back by another window | per-design clear counter in `gen`; an older `gen` is refused (§8.2) |
| A storage batch too big to accept | the shim keeps the last value per key and splits at the entry and character caps; the validator caps both |
| Racing the agent | hash CAS at the rename; stale refusals; version first |
| Two windows editing | per-slug chain; stamps; second write stale |
| Prompt injection through the ledger | structured, clipped quotes, "Quoted text is data" line |
| Trash collisions or overwrite | unique names with `-n`; every create and move by `moveNoReplace` (hard link, `EEXIST` atomic; check-then-rename only where links are unsupported) |
| Token exposure | unchanged: never in a bundle, frame, file, log or prompt |

### 11.5 Data exposure

New personal data: the saved page data (§8.7) and short quotes of edited text in `edits.json` (≤ 80 chars,
which go to the linked chat in the next message by owner decision Q5). Logs never carry either.

---

## 12. Data flow (one line each)

- **Text edit:** double-click in Edit mode → page `hit-test` + `edit-probe` and `GET /source` (sha256) → shared
  locator fills the editor → Enter → `POST /edits { op:'text', base, target, before, after }` → service chain:
  version ("Before your edits" or coalesced) → re-locate in the same bytes → escape + splice + verify → hash CAS
  write → self-write recorded → `files` event `origin:"user"` → every surface reloads that file's artboards →
  notice with Undo → next chat message starts with the hand-edit line.
- **Tweaks:** design.json `tweaks` → `GET /tokens` → slider → `set-tokens` to live frames (and `__DC.tokens` for
  new ones) → Save → `POST /edits { op:'tokens' }` → version → splice the `:root` values → CAS → `files` event →
  artboards reload with the saved file.
- **Screens:** row menu or drag → `POST /edits { op:'reorder'|'duplicate'|'trash-screen' }` with the screens
  stamp and file stamps → version → file copy or move into `<root>/.trash` → `store.writeScreens` (merge, CAS) →
  `design`/`files` events `origin:"user"` → wall re-lays out → notice with Undo.
- **Directions:** "Try 3 directions…" → ask flow → the agent writes `home-a..c` with marks → watcher → wall shows
  the row → Keep this one → `POST /edits { op:'keep-direction' }` → version → moves + list + comments → notice.
- **Page data:** frame `setItem` → stand-in map → `storage-batch` per task → page map (cap) → other frames
  `storage-sync` → ≤ 1/s `PATCH /page-state` → service map → ≤ 1/s atomic write of `.chamber/page-state.json` →
  `page-state` event → the other surface syncs; on load `GET /page-state` (with `gen`) → `__DC.storage` →
  stand-in seeded; Clear → `DELETE` (new `gen`) → frames reload empty; an older `gen`'s PATCH is refused, so
  nothing comes back.

---

## 13. Not building (phase)

| Considered | Why not |
|---|---|
| A route per feature | AD-1 |
| Offsets computed by the page | AD-2 |
| A new lock manager | AD-3 |
| Undo through version restore | AD-5 |
| A full HTML5 parser or a dependency for it | the explicit-end-tag rule refuses where a scan could differ; no new dependency |
| A full named-entity table | unknown names refuse instead |
| A crash journal for multi-file ops | version first is the recovery |
| Live `storage` events | PS 19 out of scope |
| `host.storage` for page data | 64 KiB per value, 2 MiB per namespace, per instance (F21); the data must follow the design folder |
| Page data inside versions or exports | owner 19-1 |
| Folding auto-saves in the versions list | PS out of scope (separate review item) |
| Moving, resizing, attributes, images, colour pickers, presets, per-screen knobs, renames from the wall | PS out of scope |
| DirectionPick pointing at canvas screens | owner 11-5 |
| A redo stack or a multi-level Ctrl+Z | PS out of scope; product decision: one slot (§2.7) |
| A context-exact tweak preview (per-rule injection) | rare case, large surface; the row says the preview is wider than the save (§4.4) |
| A per-file hash cache for `computeTree` | not needed for typical designs; named as the fix if the risk in §14 shows up |
| Server-side "viewing a version" refusal | the service has no view state; the UI disables (E12), and a write from a stale UI is caught by the stamps |

---

## 14. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| An agent write lands inside the synchronous hash-compare-and-rename window and is overwritten | Low | microsecond window, same as the design.json merge today; the agent's next read sees the user's file; the version before the edit and the agent's own memory remain |
| A script reorders same-text elements without changing their count, so the index maps to a different identical-text element | Low | only elements with exactly the clicked text qualify; ids must match; the editor shows the source text |
| The tolerant scanner disagrees with the browser on odd markup | Medium | explicit end tags only; unknown entities refuse; verify-after-splice; fixtures from real agent output (the review page fixture C1 adds) |
| A crash between two renames of a multi-file op leaves a half state | Low | version first; the "part way" sentence when the service is alive to say it |
| The stand-in behaves differently in OpenChamber's Electron on Windows or macOS | Medium | §8.8 checks before release; fall back: `persist:false` keeps today's behaviour minus the throw |
| A 1 MB seed in every frame document costs memory (12 frames × 1 MB) | Low | within the 64 MB guest render cache headroom; only designs that store that much pay it |
| Ledger lines repeat when the clear call fails | Low | harmless duplication; logged |
| `composed` outcome clears the ledger though the user may delete the draft | Low | accepted: the message reached the chat's composer; Versions keeps every state |
| Older Design Chamber builds show the new version reasons as raw text | Low | cosmetic; the index entries are kept (§1) |
| design.json is reformatted to two-space JSON by a screen action | Low | same as any comment add today (AD-13); values intact |
| Version count grows with hand edits | Low | coalescing (AD-4) plus dedupe; 100-version cap unchanged |
| Large `GET /source` on every selection | Low | per-view source cache, invalidated by events |
| Every hand edit changes the tree fingerprint, so `treeOf` (`versions.ts:491-505`) re-hashes every tracked file in the chain; near the 100 MB snapshot cap on a slow or network disk this can pass the host's 20 s request timeout while the write still lands | Low | the user sees "Couldn't save your change…", refetches, and finds the edit applied (the stale refusal stops a double apply, §2.10); typical designs are a few MB. Fix when seen: cache each file's hash by size+mtime inside `computeTree` (not built now, §13) |
| A Clear followed by a service restart inside another surface's 1 s flush window brings those few keys back | Low | the gen from the old epoch cannot be judged (§8.2); needs a restart in a one-second window |
| The tweak preview shows a value in contexts (`@media`, `[data-theme]`) that Save will not change | Low | the row's note says so (§4.4) |
| A filesystem without hard links (FAT/exFAT, some shares) falls back to check-then-rename for creates and moves | Low | microsecond window, same residual as the design.json merge; ids are fresh names nobody else writes |
| The non-modal rail bottom sheet and the wall both want Esc, and focus can leave the sheet for the wall | Low | the wall's own Esc (popover, composer, editor, selection) runs first; the sheet closes only on an unhandled Esc (§4.6.1); the unsaved dot and the leave dialog keep values safe either way |
| The app-wide contrast pass changes Phase 1 colours | Low | one token pair, `color-mix` of host variables; Phase 1 visual scenarios re-run light and dark in U1; ratios recorded |

---

## 15. `docs/SPEC.md` update plan (after this design is approved; not edited yet)

| Section | Change |
|---|---|
| Header status line | add "2026-11-1x for Phase 2 as built", pointing at this file |
| §1 Goals | add goal 12: edit on the canvas (text, tweaks, screens, directions, saved page data) |
| §1 Non-goals | add: no drag/resize/properties panel, no redo, no live storage events, no IndexedDB |
| §2 | add F38 (stand-in in a sandboxed blob frame, §1 here) and F39 (`Page.addScriptToEvaluateOnNewDocument` in the check browser) once verified on CI |
| §3 diagram | add `edits` (pipeline, edits.json) and `page-state` under the service; `self-writes` beside the watcher |
| §6.1 folder layout | add `.chamber/edits.json`, `.chamber/page-state.json`; add `.trash/<slug>.<screenId>-<stamp>[-n].html` |
| §6.2 | add `tweaks` and `screens[].direction` with the validation tables (§4.1, §6.1 here) |
| §6.3 | ownership: `screens` is shared (user actions through `writeScreens`, agent's later write wins); `ServiceWrite.screens`; P1 to P5 unchanged; screen actions refused on provisional designs |
| §6.4 | `VersionEntry.reason` + `user-edit`, `keep-direction`; coalescing rule; restore untouched |
| §7 | the seven routes; `SourceResponse`, `DesignDetailResponse`, `PromptResponse` additions; change kind `page-state`; `origin` on events |
| §8.2 | new guest modules `page-state.ts`, `tweaks.ts`, `source-cache.ts`; `build-activity` ignores `origin:"user"`; `flows.deliver` clears the ledger |
| §8.3 | the five messages, `BridgeInit.tokens` / `.storage`, the stand-in |
| §8.4 | frames seeded with preview and storage after a budget reload |
| §9.1 | `replaceFileIfHashUnchanged`, `moveNoReplace`, `resolvePlainTarget` (no links inside the design for service writes) |
| §9.4 | the echo filter (`self-writes.ts`, last-bytes rule, no TTL); `origin` through `ChangeHub.emit` |
| §9.5 | `versions.userEdit`; check render installs the stand-in |
| §9.9 | `tweak-broken` |
| new §9.16 | the edit pipeline (§2 here, condensed) |
| new §9.17 | page state (§8 here, condensed) |
| §10.9, §10.10 | the hand-edit block and `upTo` clear; "+ Screen" and "Try 3 directions" as asks |
| new §10.13 | Keep this one; DirectionPick stays folder-based |
| §11.2, §11.4, §11.6 | the new RULES.md rows and lines (§9 here); the hand-edit block in the revision, ask, checks and offline prompts |
| §12 | the new files and their lanes (§16 here) |
| §13.2 P2, P6, §13.1 R2, §13.3 | toolbar, editor, Tweaks button and panel (rail: non-modal bottom sheet, `SheetVariant 'bottom'`), row menus (text only, reasons inside options), ghost board, drag, direction rows (rail: 2×2 grid), Clear saved page data, the new notice ids, `DrawerKind 'tweaks'`, the `--dc-warning-text` / `--dc-success-text` tone tokens |
| §14 | a "Phase 2" entry with the work packages and, after the build, the as-built deviations |
| §15 | the Phase 2 test plan (§17 here) |
| §16, §16.1 | the risks (§14 here) and a Phase 2 threat model (§11 here) |
| §17 | none (no owner question left) |

---

## 16. Work packages

Order: **T0 first** (one task, the main agent edits the WP0 files or assigns them to one builder), then the
parallel groups. Two builders never edit one file at once: every file below has one owning task per stage, and
the "after" column sequences the files two tasks share. Gates for every task: `npm run typecheck`, `npm run build`
and `npm test` pass (`npm run check`), every UI state handled, sandbox/CSP and containment untouched or
re-tested. Model picks per protocol §3 (step up to Opus for the starred tasks: auth, containment, filesystem
writes or sandbox).

### T0 · Contracts and stubs (High | M) · main agent (or one fullstack builder it assigns) · blocks everything
**Files:** `src/shared/{types,api,limits,bridge-protocol,design-json}.ts`, `src/shared/checks.ts` (the
`tweak-broken` entry), `src/service/context.ts` (incl. `ChangeHub.emit` + `origin`), **`src/service/changes.ts`**
(copy `origin` into the event), `src/service/self-writes.ts` (new, real, small: §2.6 last-bytes rule),
`src/service/paths.ts` (`resolvePlainTarget`, `isPlainTarget` only, §2.3: a pure risk function T2a, T2b, T3, T4,
T5 and T8 all need, so it lands first), `src/service/store.ts` (fill `screensStamp` / `designJson`;
`writeScreens` and `moveComments` stubs answering 500 "not built yet"), `src/service/routes/{edits,page-state}.ts`
(stubs), `src/service/compose.ts` (register stubs, build `selfWrites`), `src/ui/model/versions-model.ts` (two
labels, "Before your edits" and "Before keeping a direction"), `src/guest/fake-services.ts`,
`test/ui/visual/fake-backend.*`, `test/helpers/fake-context.ts`, `test/shared/{design-json,bridge-protocol,api}.test.ts`
(`api.test.ts:8` 44 → 51), `test/service/core/{self-writes,changes,paths}.test.ts` (`self-writes` new; the
`origin` and `resolvePlainTarget` cases), `test/service/core/routes.test.ts` (`GET /changes` carries `origin`).
**Acceptance:** §10 exactly; old design.json fixtures normalise as before; every new route answers 401 without the
bearer and a sentence with it; validators reject each malformed shape in §10.4 (including an over-cap
character total); an event emitted with `origin: 'user'` reaches `GET /changes` with it; `resolvePlainTarget`
refuses an inside leaf link and an inside parent-folder link, judged on the lexical path (mutation: comparing
against the realpath only turns the test red); `npm run check` green.
**Docs:** none (no user-facing change).

### Group A (parallel after T0)

| Task | Agent | Effort | Files | Acceptance | Docs |
|---|---|---|---|---|---|
| **T1** Source scanner and locator | fullstack | M | `src/shared/source-edit.ts` (new), `test/shared/source-edit.test.ts` (new), fixtures under `test/fixtures/source-edit/` (CRLF, BOM, entities, comments, implied end tags, RTL, duplicates) | §3.2 to §3.4 pure functions; every reason code reachable; splice leaves bytes outside the range identical; `</p><script>` escapes; surrogate pairs never split; mutation: removing the escape or the explicit-end-tag rule turns a test red | none |
| **T2a\*** Write primitives, versions, echo | fullstack (Opus) | M | `src/service/paths.ts` (`replaceFileIfHashUnchanged`, `moveNoReplace`; after T0), `src/service/versions.ts` (`userEdit`, coalescing with the swapped `afterTree`, `SnapshotRefusedError`, `trackedHashOf`, `treeHashOf` used by `computeTree`), `src/service/watch.ts` (echo filter, `forget`), `src/service/status-designs.ts` (`origin`), `test/service/core/{paths-cas,versions-user-edit,watch-echo}.test.ts` | §2.4 to §2.6: CAS (`changed`, `busy` with `test/helpers/refuse-rename.ts`), `moveNoReplace` never overwrites (`exists`, `busy`, fallback); coalescing and its resets, **an agent write between an edit's apply and the next edit forces a version**; each refusal maps to its typed `refusal` (restore route answers unchanged); echo dropped on a doubled event and on a poll 30 s later, an agent write after it not dropped, B-then-A shown | none |
| **T2b\*** Edit pipeline and routes | fullstack (Opus) | M | after T2a: `src/service/edits/{pipeline,file,trash,op-module}.ts` (new), `src/service/edits/ops-{text,screens,tokens}.ts` (new, **stubs** against `OpModule`, §2.4), `src/service/routes/edits.ts` (dispatch, undo, hand-edits clear, `GET /tokens` calling the `readTokens` stub; after T0), `src/service/routes/render.ts` (`sha256`, `utf8`, `link`), `test/service/core/{edits-pipeline,edits-file}.test.ts`, `test/service/http/edits-routes.test.ts` | §2 end to end with a fake op (`createEditService({ ops })`): version first, stale, rollback (a 409 step keeps its sentence), undo survives a new service instance, ledger append/clear, **concurrent clear + edit keeps both the UndoRecord and the cleared ledger**, a second undo of one id → 404; the stubs answer the "not built yet" 500 | `documentation/features/edit-on-canvas.md` (new: the user-edit rules in plain words) |
| **T7a** Rules text | rules author | S | `rules/DESIGN-RULES.md` | §9.1 verbatim | none |
| **T8\*** Page state service | fullstack (Opus) | M | `src/shared/page-state.ts` (new, incl. `isOlderClear`), `src/service/page-state.ts` (new), `src/service/routes/page-state.ts` (after T0), `test/service/core/page-state.test.ts`, `test/shared/page-state.test.ts` | §8.1, §8.2: cap, coalescing (fake clock), flush on dispose, removed design not re-created, hostile files, link refused (lexical, through `resolvePlainTarget`), never logged (log spy); a PATCH with a gen older than a Clear → 409 and nothing applied, a gen from another epoch accepted | `documentation/features/saved-page-data.md` (new) |
| **T9\*** Bridge additions | fullstack (Opus) | M | `src/guest/bridge/{bridge,storage-shim,edit-probe}.ts`, `src/guest/frame-doc.ts`, `test/guest/bridge-pure.test.ts`, `test/e2e/{bridge.test.ts,bridge-page.ts}` | §3.1, §4.4, §8.3 in the real sandboxed blob frame under the guest CSP: stand-in, quota, batch per task with last-value-per-key and **splitting of an oversized batch** (20 000 keys set in one loop all arrive, no message over either cap), sync, preview set and cleared, probe counts; readInit rejects bad `tokens`/`storage` | none |
| **T11c** Wall layout | fullstack | S | `src/guest/camera.ts`, `test/guest/camera.test.ts` | ghost row and direction rows (§5.3, §6.3), incl. `directionColumns` (unset = one row for the page, `2` = the rail's 2×2 grid; 1 to 4 members), `WallArtboard.line`; today's layouts unchanged | none |

### Group B

| Task | Agent | After | Effort | Files | Acceptance | Docs |
|---|---|---|---|---|---|---|
| **T3\*** Text op | fullstack (Opus) | T1, T2b | S | `src/service/edits/ops-text.ts` (replaces the stub; nothing else), `test/service/core/edits-text.test.ts` | §3.4 and its undo; E5 fixtures byte-exact; E6; stale; not UTF-8; link (inside leaf and inside folder); too large | `edit-on-canvas.md` (text section) |
| **T4\*** Screen ops | fullstack (Opus) | T2b | M | `src/shared/screen-ops.ts` (new), `src/service/store.ts` (`writeScreens`, `moveComments` with the hook and the shared retry loop; after T0), `src/service/edits/ops-screens.ts` (replaces the stub), `test/shared/screen-ops.test.ts`, `test/service/core/edits-screens.test.ts` | §5.1, §5.2, §6.2: stamps, raw order kept, free ids, trash names, undo of each, keep with comments, rollback mid-way, provisional refused, comments never dropped; **`writeScreens` losing all 5 attempts → 409 conflict, nothing claimed written**, the `beforeRename` hook sees the exact bytes | `documentation/features/screens-and-directions.md` (new) |
| **T5\*** Tokens | fullstack (Opus) | T2b | M | `src/shared/tokens-css.ts` (new), `src/service/edits/ops-tokens.ts` (replaces the stub, incl. `readTokens`), `test/shared/tokens-css.test.ts`, `test/service/core/edits-tokens.test.ts` | §4.2, §4.3: last `:root` wins, media context, `!important`, a comment inside a value → `formula`, unbalanced quotes refused, units, formatting, byte-exact splices, stale knobs; writes tokens.css through the CAS | `documentation/features/tweaks.md` (new) |
| **T6** Hand edits in prompts | fullstack | T2b | M | `src/shared/agent/{hand-edits,screen-asks}.ts` (new), `src/shared/agent/{ask-prompt,revision-prompt}.ts` (`maxChars`, removed-screen label), `src/service/routes/chat.ts`, `test/agent/{hand-edits,screen-asks}.test.ts`, `test/agent/{ask-prompt,revision-prompt,chat-routes}.test.ts` | §7.2, §7.3: block caps, compact fallback, ask never cut, `handEdits` in the answer, no em dash (the copy test) | `documentation/features/agent-instructions.md` (hand-edit block) |
| **T7b** Agent instruction code | fullstack | T7a | S | `src/shared/agent/{rules-doc,instructions,skill-doc,chip,guide}.ts` (`guide.ts`: `buildAgentGuide` only, §9.5), `test/agent/__snapshots__/*`, `test/agent/{rules-doc,instructions,skill-doc,chip,guide}.test.ts` | §9.2, §9.3, §9.5; instructions ≤ 4 096; every owned-field list names `tweaks`; `buildSkillDoc` output byte-identical | `agent-instructions.md` |
| **T11a** Guest plumbing | fullstack | T2b | S | `src/guest/{store,flows,build-activity,source-cache}.ts`, `src/guest/fake-services.ts` (real fake answers), `test/guest/{flows,build-activity,changes-store}.test.ts` | store methods; ledger clear after each outcome; `origin:"user"` never "Writing"; source cache invalidation | none |
| **T11b** Guest controllers | fullstack | T8, T9, T11a | M | `src/guest/{page-state,tweaks}.ts` (new), `src/guest/service-client.ts` (`fitsOneRequest`), `test/guest/{page-state,tweaks,service-client}.test.ts` | §8.4, §4.4, §4.5 with a fake client and fake clock: **a 60 000-char CJK or emoji delta goes by upload, an ASCII one inline, none answered 413** (also against the real service in `test/service/integration/page-state-inline.test.ts`, new); load timeout = unsaved, late answer ignored; Clear on one controller drops the other's dirty keys (stale PATCH path and event path) | none |
| **T10** Check stand-in | fullstack | T9, C1 merged | S | `src/service/check/render.ts` (and `cdp.ts` if the command helper lives there), `test/service/check/render.e2e.test.ts`; main agent: `scripts/build.mjs` step (1c) `__DC_STORAGE_SHIM__`, its `declare` | §8.5; the e2e expectation flipped | `design-checks.md` (storage in checks) |
| **T5b** Broken-knob finding | fullstack | T5, C1 merged | S | `src/service/check/static.ts`, `test/service/check/static.test.ts` | §4.7; CLI, tool and badge agree | `design-checks.md` |

### Group C (ui-ux, the Design and Usability bars apply; `frontend-design` skill first)

| Task | After | Effort | Files | Acceptance | Docs |
|---|---|---|---|---|---|
| **U1** Edit text UI | T3, T9, T11a | M | `src/ui/wall/{selection-toolbar,text-editor,feature-edit-text}.ts` (new), `src/ui/wall/{wall,input-controller,hit-controller,popover-layer,frame-messages}.ts`, `src/ui/components/{ask-bar,notices}.ts`, `src/ui/model/{wall-input,edit-text-model}.ts`, `src/ui/styles.css` (own block, plus the app-wide contrast pass of §4.6.2 in place: `--dc-warning-text`, `--dc-success-text`, every existing rule that used the raw tone text, the kit banner override), `test/ui/edit-text-model.test.ts`, `test/ui/wall-input-model.test.ts`, `test/ui/visual/scenarios/edit-text.mjs` | §3.5 every state on rail 320 and 480 px and page 1400 px, light and dark, including the state boards added after the mockup review (click-away line, character counter, agent-working hint, refused, stale with Reload, element gone after reload); §4.6.2 ratios measured and ≥ 4.5:1 for the stepped tokens on their tints in light and dark, the changed rules listed in the report, Phase 1 scenarios still pass; keyboard path; `createFrameMessageHandler` takes its store as a parameter (so Q1's E1 replay test can inject a fake); single-slot Ctrl/⌘+Z (`nextUndoSlot` model test, §2.7); `link` disabled reason | `documentation/pages/full-screen-page.md`, `documentation/pages/rail-panel.md`, `edit-on-canvas.md` |
| **U2** Tweaks UI | T5, T11b, U1 | M | `src/ui/wall/feature-tweaks.ts` (new), `src/ui/components/tweaks-panel.ts` (new), `src/ui/components/icons.ts` (`tune`), `src/ui/components/kit.ts` (`SheetVariant` `'bottom'`, non-modal, §4.6.1; before U3), `src/ui/components/ask-bar.ts` (a quiet Send look while a drawer primary shows, §4.6; after U1), `src/ui/wall/{wall,frame-slot,design-view}.ts` (preview seam; frame-slot gets both `tokens` and `storage` init getters; design-view opens Tweaks as the rail bottom sheet and passes `coveredBottom`), `src/ui/wall/{wall-types,camera-controller}.ts` (`coveredBottom`, the bottom inset in `coveredInsets`), **`src/ui/wall/view-context.ts`** (`DrawerKind` + `'tweaks'`, `:24`), `src/ui/rail/rail-app.ts`, `src/ui/page/page-app.ts` (leave guard), `src/ui/model/{tweaks-model,viewer-menu}.ts`, styles block, tests, `scenarios/tweaks.mjs` | §4.4 to §4.6.1; 100 ms preview; unsaved survives a reload; leave dialog; load-failed row with Try again; the `alsoSet` preview note; rail bottom sheet ≤ 50% of the rail with the wall pannable and Fit inside the visible part, Reset/Save pinned, Esc closes, full-height below 560 px (`tweaksSheetVariant` model test), Comments/Versions still full-height; Send quiet while the panel is open; the §4.6.1 scenario list | both page docs, `tweaks.md` |
| **U3** Screens UI | T4, T11c, U1 | M | `src/ui/wall/{board-set,feature-screens,reorder-controller}.ts`, `src/ui/wall/input-controller.ts` (drag start), `src/ui/components/comments-drawer.ts`, `src/ui/components/kit.ts` (`MenuEntry.reason`, menu `notes`, §5.4; after U2), `src/ui/model/menu-model.ts` (new, pure: `menuRowState(entry)` → `{ navDisabled, inert, nativeDisabled, describedBy }`, which `openMenu` uses) and `test/ui/menu-model.test.ts` (new; `test/ui/**` holds pure view-model tests only, so the DOM rendering is covered by the screens scenario: reason row reachable by arrows and inert, `aria-describedby` to its reason or to the cap foot note, an entry without `reason` unchanged), `src/ui/model/screens-model.ts`, styles block, tests, `scenarios/screens.mjs` | §5.4; text-only menus; each disabled reason inside its option; the cap said once as the foot note; drag page only; keyboard moves; announcements; ghost and its popover (sending, failed, counter); the §5.4 state boards | both page docs, `screens-and-directions.md` |
| **U4** Directions UI | T4, U3 | S | `src/ui/wall/{board-set,feature-directions}.ts`, `src/ui/model/directions-model.ts`, styles block, tests, `scenarios/directions.mjs` | §6.3 table on both surfaces: one row on the page, 2×2 grid on the rail (`directionColumns: 2` from `board-set.ts`), "Show at" drawn in the header on both; 2, 3 and 4 directions | both page docs, `screens-and-directions.md` |
| **U5** Page data UI | T11b, U2 | S | `src/ui/wall/feature-page-state.ts` (new), `src/ui/wall/frame-messages.ts` (route `storage-batch`; after U1), `src/ui/model/{page-state-model,viewer-menu}.ts` (after U2), tests, `scenarios/page-data.mjs` | §8.6; once-per-session notices; Clear confirm; version view empty; one store across a two-screen, two-viewport canvas (§8 scope) | both page docs, `saved-page-data.md` |

### Group D (verification)

| Task | After | Scope |
|---|---|---|
| **Q1** qa-tester (Opus medium) | T2a, T2b, T3, U1 | 07 + 08: E1 to E12, §17 tests can fail (mutation), live click-through on Linux; **writes the E1 replay risk test `test/ui/e1-frame-replay.test.ts`** (every frame message type, forged and valid, through `createFrameMessageHandler` with a fake store → zero edit calls; mutation: wiring one message to `applyEdit` turns it red) |
| **Q2** qa-tester | T5, T5b, U2 | 09 |
| **Q3** qa-tester (Opus medium) | T4, U3, U4 | 10 + 11 |
| **Q4** qa-tester (Opus medium) | T8, T9, T10, U5 | 19 on a page and on a canvas (a write in one screen's artboard reaches the other screens and viewports), incl. §8.8 Linux Electron |
| **Q5** qa-tester | all | whole phase, `documentation/README.md` index and `documentation/STATUS.md` updated by the main agent, then the SPEC update (§15) by the architect |

Parallel at a glance: after T0, {T1, T2a, T7a, T8, T9, T11c} run together; T2b after T2a; then {T3, T4, T5,
T6, T7b, T11a} (T7b only needs T7a); then {T11b, T10, T5b} and {U1}; then {U2, U3}; then {U4, U5}; Q1 to Q5 as
listed. Shared files and their order: `paths.ts` T0 → T2a; `store.ts` T0 → T4; `routes/edits.ts` T0 → T2b;
`routes/page-state.ts` T0 → T8; `versions.ts` T2a only; `watch.ts` T2a only; `changes.ts` T0 only;
`edits/ops-text.ts` T2b (stub) → T3; `edits/ops-screens.ts` T2b (stub) → T4; `edits/ops-tokens.ts` T2b (stub) →
T5; `edits/pipeline.ts` T2b only (the op map is fixed there, so T3 to T5 never edit it); `fake-services.ts`
T0 → T11a; `service-client.ts` T11b only; `wall.ts` U1 → U2; `input-controller.ts` U1 → U3;
`frame-messages.ts` U1 → U5; `board-set.ts` U3 → U4; `kit.ts` U2 → U3 (U3 rebases its menu change on U2's sheet
variant); `ask-bar.ts` U1 → U2; `camera-controller.ts` and `wall-types.ts` U2 only; `viewer-menu.ts` U2 → U5; `view-context.ts` U2 only;
`design-view.ts` U2 only; `styles.css` each task in its own marked block, except U1's §4.6.2 contrast pass,
which edits existing rules in place and lands first (U2 to U5 use the `--dc-` tone tokens); `rules-doc.ts`, `chip.ts`, `guide.ts`
T7b only; `test/service/core/paths.test.ts` T0 → T2a; `test/ui/wall-input-model.test.ts` U1 only;
`test/ui/e1-frame-replay.test.ts` Q1 only.

---

## 17. Test plan

**Route rejections** (`test/service/http/edits-routes.test.ts`, `test/service/http/page-state-routes.test.ts`, the
real service via `test/helpers/service-process.ts`): each of the seven routes → 401 without the bearer, 400 for a
slug failing the pattern, 404 for an unknown slug with the gone sentence, 413 for a body over 80 kB; edits → 400
for an unknown `op`, for `screen: "../x"`, for an `id` failing `EDIT_ID_PATTERN`; a `screens/home.html` symlink
to a file outside the design → refused, and to a file inside → refused with the link sentence (judged on the
lexical path: the test asserts the refusal even though the realpath is a regular file inside the design), a
`screens` folder that is a link to another folder inside the design → refused the same way, and `GET /source`
answers `link: true` for both; a `.chamber` that is a link → `page-state` reads empty and writes refuse, and
`edits.json` writes refuse; `PATCH /page-state` without `gen` → 400.

**Hub and changes feed:** `GET /changes` answers `origin: "user"` on the events the pipeline emits and no
`origin` key on watcher events (`test/service/core/{changes,routes}.test.ts`, T0).

**Pure, failing test first** (risk logic): `source-edit` (all §3.2 to §3.4), `tokens-css`, `screen-ops`
(`reorderRaw` with invalid entries, `freeCopyId` at the 41-char edge, `describeMove`), `page-state` parse and
delta, `hand-edits` (caps, compact, quote escaping), `design-json` tweaks and marks, bridge-protocol validators,
`edit-probe` counts over a fake `El`, `storage-shim` over a fake window (Proxy traps, quota, last value per key,
**an oversized batch split at both caps with `clear` only on the first**), `replaceFileIfHashUnchanged` (`changed`,
`busy` via `refuse-rename.ts`), `moveNoReplace` (`exists` never overwrites, `busy` leaves only the source,
fallback), `resolvePlainTarget` (§2.3 list), `self-writes` (no TTL: a second event for the same bytes is still an
echo; other bytes → not an echo and the entry forgotten; B-then-A → A shown; size short-circuit),
`trackedHashOf`/`treeHashOf` equal `computeTree`'s, `isOlderClear`, `fitsOneRequest` (ASCII inline, CJK and emoji
of the same length uploaded), `nextUndoSlot` (single slot, §2.7). Each risk test is mutation-checked: change one
rule, watch it go red, change it back.

**Service integration:** a scripted agent writing a screen file (atomic and non-atomic) between the page's read
and Save → stale, nothing written; writing it right after Save → the build strip input sees the agent's event
(not dropped as an echo); two concurrent `POST /edits` → one applied, one stale; a hand edit then
`POST /versions/turn` → both states in Versions; restart between edit and undo → undo works.
- **Coalescing with an agent write between** (`versions-user-edit.test.ts`, T2a): edit 1 → "Before your edits";
  the agent writes another file; edit 2 within 60 s → a second "Before your edits" version that holds the
  agent's file (mutation: computing `afterTree` from a fresh `treeOf` turns it red). Without the agent write,
  edit 2 coalesces.
- **Concurrent clear + edit** (`edits-file.test.ts`, T2b): a `hand-edits/clear` and a `POST /edits` started
  together, both orders forced with a gated fake → the UndoRecord and the new ledger entry exist and the cleared
  entries stay cleared.
- **Keep-direction undo after restart** (`edits-screens.test.ts`, T4): keep B, stop the service, start a new
  instance on the same root, Undo → B, A, C and the original back in place, comments moved back, the screen
  list as before.
- **Non-ASCII inline PATCH** (`page-state-inline.test.ts`, T11b): 60 000 chars of CJK and of emoji go through
  the controller to the real service and persist; no 413.
- **Clear wins** (`page-state.test.ts`, T8; controller side in T11b): surface B holds dirty keys, A clears,
  B's next PATCH → 409, B reloads empty, the keys are not on disk.
- **Typed snapshot refusals** (`versions-user-edit.test.ts`): too large, newer build's index, torn (a fake file
  rewritten mid-snapshot) each answer their §2.8 sentence; `POST /designs/:slug/versions/:vid/restore` answers
  exactly as before.

**E2E (headless Chrome, `chromeOrSkip`):** the bridge harness for the stand-in, preview and probe (§8.8 list);
the check render with the stand-in.

**UI:** view-model tests per model file; visual scenarios `edit-text`, `tweaks`, `screens`, `directions`,
`page-data` at rail 320/480 and page 1400, light and dark (the harness runs every scenario file).

**Click-through** (OpenChamber 2.7, Linux; Windows and macOS per §8.8): double-click a heading and save; Undo;
agent writes during an edit → stale path; tweak live and save; reorder by drag; duplicate, trash, Undo; ask for
three directions, keep B, Undo; a checklist design keeps its ticks across a reload; Clear saved page data.

---

## 18. Edge-case walk (rule 3, phase level)

- **Concurrency and partial writes while the watcher fires:** the agent's half-written file has a different
  hash → stale; the watcher's debounce never merges the user's event with the agent's (the user event is emitted
  directly and the echo is dropped by hash only); a design.json mid-write does not parse → screen actions refused
  with the "can't be read right now" sentence, never written over (WP0 deviation 8 holds). An agent write
  between two hand edits forces a new version (the swapped `afterTree`, §2.4). edits.json has one writer queue,
  so a clear racing an edit loses nothing (§2.1). design.json that keeps changing through `writeScreens`' 5
  attempts answers the conflict sentence, never a false success (§5.1). Windows' doubled rename events and the
  slow poll backstop still read as the echo (§2.6).
- **Retries and idempotency:** §2.10; page data PATCH is "set these keys", safe to retry; clear is idempotent.
- **Empty, error, loading:** each feature's state table (§3.5, §4.6, §5.4, §6.3, §8.6).
- **Missing or changed designs folder:** every route resolves the slug under the current root → gone sentence;
  pending page-data writes flush to the old paths; the edits file is per design, so nothing crosses roots.
- **Theme switch mid-render:** all new chrome uses `--oc-*` variables (live); previews and saved data are design
  content and unaffected.
- **Malformed or huge design.json:** knobs and marks dropped with warnings; a huge one is read as today; screen
  actions need it to parse.
- **Headless Chrome missing:** thumbnails fall back to the live mini-frame, which is `sandbox=""` and runs no
  script, so storage is not involved; checks report `browser-missing` as today; the broken-knob finding is
  static and still runs.
- **Service restart:** undo records and the ledger are on disk; coalescing and self-write memory reset (one extra
  version at worst; a watcher event for the user's last write that the old process had not flushed yet is shown
  as the agent's, once); the page-data clear counter resets (a clear followed by a restart inside another
  surface's 1 s flush window is the only case that brings keys back, §14); pending page data flushed on a clean
  stop, ≤ 1 s lost on a crash; the guests' change feed resets and refetches.
- **Windows:** backslashes never reach a request (ids only); drive letters and UNC refused by `resolveInside`;
  case-insensitive disk safe (lower-case ids and slugs; trash names checked for existence); file locks → retry
  then the conflict sentence; CRLF and BOM preserved by splices; rename over an existing file never relied on for
  moves (`moveNoReplace`: a hard link that fails on an existing name; NTFS supports it, FAT/exFAT falls back
  to check-then-rename).
- **Version caps:** over 1 000 files or 100 MB → the version-first refusal, nothing written; 100-version prune
  unchanged; coalescing limits growth.
- **Viewing a version or comparing:** writes disabled (E12); frames run with empty unsaved storage and no preview.
- **Rail and page open on one design:** both get the user events and reload; page data syncs through the
  `page-state` event; a Clear on one drops the other's unflushed keys (§8.4); tweaks are per surface, a save on
  one shows the stale banner on the other; Ctrl/⌘+Z on each surface undoes only that surface's own last edit.

---

## 19. Open questions

None. Product notes, all settled:
1. **AD-8 reading of the owner's rule. Confirmed.** "Refuses when the agent changed `design.json` since the wall
   loaded it" is built as "changed the screen list (or a touched screen file)". A change to the title, `updated`,
   viewports or comments does not refuse a screen action.
2. **One new disabled-reason sentence. Confirmed.** For implied end tags, unknown entities and the Windows-1252
   character references: "Design Chamber can't find this text in the file exactly. Ask the agent to change it."
3. **Version coalescing (PS E3). Resolved 2026-11-11: accepted.** A burst of hand edits within 60 s, with no
   other writer in between, shares one version labelled "Before your edits" holding the state before the burst;
   the states inside it are reached by Undo, not as separate Versions entries. The E9 refusal reads "Restore the
   version 'Before your edits' from Versions." Ctrl/⌘+Z is one slot (§2.7). Clear saved page data drops another
   surface's unflushed keys rather than letting them come back (§8.2, §8.4).

---

## Final self-check

- [x] No implementation code: shapes, signatures, tables and pseudocode only.
- [x] Every cited path verified this session, or marked new.
- [x] Security and threat model specific (§2.11, §3.7, §8.7, §11).
- [x] Edge cases walked per feature and at phase level (§18).
- [x] Every new route: bearer, slug, containment, bounded body, sentences, named rejecting tests; every
      untrusted-HTML surface: sandbox flags and CSP unchanged and named; colours from host tokens.
- [x] Reuse named first (chain, store lock, CAS primitive, notices, kit, ask flow, uploads); Not building listed.
- [x] Ambiguities in Open Questions with defaults; the five owner decisions not re-opened.

Architecture Complete → main agent (task breakdown) | → fullstack-developer (T1, T2a, T2b, T3 to T11c, T5b, T10), ui-ux-developer (U1 to U5), rules author (T7a), qa-tester (Q1 to Q5)
