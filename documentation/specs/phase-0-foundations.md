# Phase 0: make the base safe to build on

Technical spec by the architect, 2026-11-08, against `master` @ `0afcb34`. Three independent work
items, each on its own branch and each readable on its own. No route is added. One WP0 file
changes (`src/shared/api.ts`, one optional field, item 0a), and only the main agent makes that change.

| Item | Branch | Owner | Risk surface |
|---|---|---|---|
| 0a Version history safety | `fix/versions-index-safety` | fullstack-developer | filesystem writes under the designs root |
| 0b Export and watcher performance | `perf/export-and-watch` | fullstack-developer | filesystem writes (Downloads), watcher |
| 0c Wall split, no behaviour change | `refactor/wall-controllers` | ui-ux-developer (`src/ui/**`, `test/ui/**` lane) | none new (sandbox untouched) |

The three touch different files. 0a and 0b both edit docs in `documentation/features/`, but in
different sections, so the second merge rebases cleanly.

## Questions for the user (work proceeds on the default unless you say otherwise)

1. **How long is a damaged version list kept, and the notice shown?** When `.versions/index.json`
   is damaged, 0a keeps the damaged copy (and every file it mentions) and the Versions drawer
   shows a notice. **Default: 30 days.** After that the copy is deleted automatically, the notice
   goes away, and files that only the damaged copy referenced can be cleaned up.
2. **How quickly must a missed change show up on a OneDrive or network folder?** Today the poll
   re-checks every design every 3 s even while live watching works. 0b checks one tenth of the
   designs per tick while watching is healthy. **Default: a change the live watcher dropped
   shows within 30 s** (it still shows within 3 s when the watcher reports it, which is the
   normal case, and within 3 s on folders where watching is off).

## Rules that hold for all three items

- Gates: `npm run check` (typecheck, build, test) passes, output pasted in the report.
- Failing test first for every behaviour change. For risk-surface logic, flip one condition, watch
  the test go red, flip it back, and say so in the report (protocol §2, rule 11).
- No new dependency. No change to `src/shared/{types,limits,bridge-protocol,design-json}.ts` or
  `src/service/{main,http,context}.ts`. New constants live in the module that uses them.
- Copy has no em dashes (`test/copy-no-em-dash.test.ts` enforces this for `src/`).
- Commit on the branch; pushing and opening the PR wait for the user (protocol §6).

---

## 0a. Version history safety (`fix/versions-index-safety`, fullstack-developer)

### Problem (verified)
- `src/service/versions.ts:171-191` `readIndex`: unparseable JSON, a wrong top-level shape, or a
  **single** entry failing `isEntry` makes the whole index read as empty (the comment at `:188`
  says so). A read error other than "missing" (Windows `EBUSY`/`EPERM` from OneDrive or an
  antivirus, `EISDIR`, `EIO`) is also swallowed as "missing" (`:172` `.catch(() => null)`).
- `snapshotNow` then writes a one-entry index (`:412`) and runs `collectGarbage` **after every
  snapshot** (`:413`, defined `:214-231`), which deletes every object the new index does not
  reference. One torn write, a stray agent edit, or a stricter future schema wipes the whole history.
- Nothing else on disk maps paths to objects: **no tree manifests are stored anywhere.** The
  index's `files` maps are the only record, so lost objects cannot be rebuilt.
- `restoreNow` (`:446-455`) merges service fields into the restored `design.json` only when
  `.chamber/state.json` reads. When it does not (missing on an agent-made design, or damaged),
  the snapshot's `design.json` is written as stored, which has **no comments**. The store then
  rebuilds its state from that file (store.ts `resolveState`, `:359-366`), so the comments are gone.

### Design decisions
1. **A damaged index is set aside, never overwritten.** Its bytes move to
   `.versions/index.damaged-<stamp>-<kind>.json` before any write replaces `index.json`.
2. **Invalid entries are dropped one by one.** Valid entries stay in the list.
3. **One backup generation**: every index write also writes `.versions/index.bak.json` (same
   bytes, written second). An unreadable `index.json` is recovered from it automatically. This is
   the recovery path, instead of per-version tree manifests (see Not Building).
4. **GC never frees an object that any kept file mentions.** GC protects every sha256 found in
   the live index, `index.bak.json` and every `index.damaged-*` file (a plain regex scan, so a
   truncated file still protects what it names). If any of those files cannot be read, GC skips
   that run. This gives the same guarantee as "no GC while unhealthy", but history does not leak forever.
5. **Read errors other than ENOENT are errors**, not "empty".
6. **Reads outside the per-slug chain never write.** `list`, `diff` and `readTree` only read
   and report. Only chained mutations (`snapshotNow`, `restoreNow`) set aside, write or collect.
7. **An index from a newer Design Chamber** (`version` greater than 1) is left alone. Snapshots and restores
   for that design are refused with a sentence, and the list reports it.
8. **Restore keeps the live comments**, using the store's resolved state (state.json when valid,
   otherwise rebuilt from the live design.json). When that cannot be done safely, it refuses:
   the version's design.json does not parse, state.json is not valid, and live comments exist.
   The refusal comes before anything is written. Why keep and not refuse outright: restore stays
   available in the common case (an agent-made design that has no state.json yet), and §6.4
   already promises that restore never touches comments.
9. **`.versions` is contained.** Every read and write under `.versions` resolves its folder with
   `resolveInside(designDir, ['.versions'])` (`src/service/paths.ts:113`), so a `.versions`
   symlink that points outside the design is refused. This hardens the surface we are already
   changing. Today `path.join` is used.

### Data Changes (`Designs/<slug>/.versions/`)
| File | New? | Content | Written by |
|---|---|---|---|
| `index.json` | existing | unchanged schema `{version:1,next,versions}` | `commitIndex` |
| `index.bak.json` | new | byte copy of the last committed `index.json` | `commitIndex`, after `index.json` |
| `index.damaged-<YYYYMMDDTHHMMSSZ>-<rand4>-<kind>.json` | new | the damaged `index.json` bytes (renamed aside), or for `kind=reset` from a missing index, `{"orphans":["<sha256>",…]}` | `commitIndex` |

`kind` ∈ `entries` (some entries dropped), `recovered` (rebuilt from the backup), `reset` (no
usable backup). The name uses only `[0-9A-Za-z.-]`, which is safe on Windows. At most 5 damaged
files are kept (newest by stamp), each for `DAMAGED_KEEP_MS` = 30 days (Q1). Both pruned inside
GC. Backward-readable: old designs have no `.bak` or damaged files and read exactly as before.
`isTracked` already excludes `.versions/**`, so none of these files ever enter a snapshot or an export.

### Module layout and signatures
**New `src/service/versions-index.ts`** (pure, no I/O, fully unit-tested):
- `isEntry` and `isFileMap` move here unchanged from versions.ts (`:148-169`).
- `type IndexParse = { kind: 'ok'; index: VersionIndex; dropped: number } | { kind: 'unsupported'; version: number } | { kind: 'unreadable' }`
- `parseIndexText(text: string): IndexParse`. Strips a BOM. The top level must be an object with
  integer `version` and array `versions`. `version > VERSION_INDEX_VERSION` gives `unsupported`.
  `version !== 1` otherwise, or a bad shape, gives `unreadable`. Entries are filtered with
  `isEntry` and `dropped` is the count removed. `next` = valid integer `next` raised to at least
  `max(n)+1` of the kept entries (today a bad `next` is recomputed; keep that).
- `hashesMentioned(text: string): Set<string>`: every `/[0-9a-f]{64}/g` match.
- `highestVersionNumber(text: string): number`: max `N` over `/"id"\s*:\s*"v([1-9][0-9]{0,8})"/g`, 0 if none.
- `type DamageKind = 'entries' | 'recovered' | 'reset'`
- `damagedFileName(now: Date, kind: DamageKind, rand: string): string` and
  `parseDamagedFileName(name: string): { at: number; kind: DamageKind } | null`.
- `historyStateOf(health: IndexHealth, damaged: readonly { at: number; kind: DamageKind }[]): VersionHistoryState | null`.
  Precedence: `unsupported`; then a current read that is not `ok` (`repaired`/`recovered`/`reset`);
  then the newest damaged file (`entries`→`repaired`, `recovered`→`recovered`, `reset`→`reset`);
  else `null`.
- Constants: `INDEX_READ_MAX_BYTES = 64 MiB` (100 versions × 1 000 files is about 12 MB),
  `DAMAGED_KEEP_MAX = 5`, `DAMAGED_KEEP_MS = 30 days`.

**`src/service/versions.ts`** changes:
- `type IndexHealth = 'ok' | 'repaired' | 'recovered' | 'reset' | 'unsupported'`
- `type LoadedIndex = { index: VersionIndex; health: IndexHealth; setAside: DamageKind | null; orphans: string[] | null; damaged: { name: string; at: number; kind: DamageKind }[] }`
- `loadIndex(designDir): Promise<LoadedIndex>` replaces `readIndex`. Read-only. Steps:
  1. `versionsDir = await resolveInside(designDir, ['.versions'])`. A missing folder is fine
     (resolveInside handles non-existent leaves). An escape throws `ApiError('bad-path', …)`
     and nothing is read.
  2. `stat(index.json)`. If it is ENOENT, go to step 5. Any other error throws `ApiError('internal', READ_FAILED)`.
     If the size is over `INDEX_READ_MAX_BYTES`, treat it as unreadable without reading it (step 4).
  3. Read and `parseIndexText`. `ok` with `dropped === 0` gives `health ok`. `ok` with `dropped > 0`
     gives `health repaired, setAside 'entries'` and logs `versions.index-entries-dropped
     {design, dropped}`. `unsupported` gives `health unsupported` (nothing else is read).
  4. Unreadable: read and parse `index.bak.json`. Usable (`ok`) gives `health recovered, setAside
     'recovered'`, index = backup with `next = max(bak.next, highestVersionNumber(damagedText)+1)`.
     A backup that is `unsupported` gives `unsupported`. If the backup is missing or unreadable:
     `health reset, setAside 'reset'`, empty index with `next = max(1, highestVersionNumber(damagedText)+1)`.
     Ids never repeat old ones (comments record `sentInVersion` numbers).
  5. `index.json` missing: a usable backup gives `recovered` (setAside `'recovered'`, nothing to
     move, a note is written instead). Otherwise, if any object exists under `objects/`:
     `health reset, setAside 'reset', orphans = [every object hash]`. Otherwise `health ok`, empty (a new design).
  6. `damaged` = a `readdir(versionsDir)` filtered through `parseDamagedFileName` (empty if the
     folder is missing).
- `commitIndex(designDir, loaded: LoadedIndex, index: VersionIndex): Promise<void>`. **Chain
  only**, and every index write goes through it (the new-entry path at `:412` and the turn-promotion path at `:385`):
  1. `health === 'unsupported'` throws `ApiError('invalid', UNSUPPORTED)`.
  2. If `setAside !== null`: when `index.json` exists, `rename` it to the damaged name. On
     `EPERM`/`EBUSY`/`EACCES` (Windows), fall back to reading its bytes and writing them atomically
     to the damaged name. When it does not exist, write the note (`{"orphans":[…]}` or `{}`) atomically.
     If both paths fail, throw `ApiError('internal', SET_ASIDE_FAILED)` and **write nothing else**.
     Then set `loaded.setAside = null`, so a second commit in the same operation does not repeat it.
  3. Write `index.json` atomically (existing `writeAtomic`), then `index.bak.json` with the same
     bytes. If the backup write fails, log `versions.backup-failed` and continue (not fatal).
- `collectGarbage(designDir, index, log, now)` gains the protected set. Before deleting:
  read `index.bak.json` (ENOENT is fine) and every damaged file younger than `DAMAGED_KEEP_MS`
  and among the newest `DAMAGED_KEEP_MAX`, each capped at `INDEX_READ_MAX_BYTES`. Protected =
  referenced ∪ `hashesMentioned` of each. **Any read error other than ENOENT, or an over-cap
  file, skips this whole GC run** (log `versions.gc-skipped`). Then delete expired or excess
  damaged files, then unreferenced objects as today. `now` comes from a new optional
  `VersionsDeps.now?: () => number` (test seam; default `Date.now`).
- `snapshotNow`: `loadIndex`, then on `unsupported` throw (the auto timer path logs
  `versions.unsupported` once per slug per process; keep a `Set`). Everything else is unchanged
  except `commitIndex` and the guarded GC.
- `restoreNow`, in this order, **with no design file written before step 4**:
  1. `loadIndex`. `unsupported` throws. Then `findEntry`, and check that every object exists (unchanged).
  2. `record = await store.get(slug)`. `liveState = record.state`. Confirm while implementing
     that this is the resolved state (state.json, or rebuilt from the live design.json when
     state.json is missing or corrupt, store.ts `:93-95`, `:359-366`). If it is not, use
     `serviceStateOf(record.design)` (design-json.ts `:484`). `stateOnDisk = (await readState(designDir)) !== null`.
  3. Prepare the design.json bytes in memory. If the version's bytes parse as an object, use
     `mergeServiceFields(parsed, liveState)` **always**, not only when state.json reads.
     If they do not parse: when `stateOnDisk`, write them as stored (state.json keeps the comments
     and the store re-mirrors them; this is today's behaviour). Otherwise, if
     `liveState.comments.length > 0`, throw `ApiError('invalid', RESTORE_WOULD_DROP_COMMENTS)`.
     Otherwise write them as stored.
  4. Restore point, writes and deletes, then the `restored` snapshot (unchanged).
- `list(slug)`: `loadIndex` (read-only). `unsupported` gives `versions: []`. Otherwise as today.
  Add `history: historyStateOf(health, damaged)` to the response only when it is not null.

**Sentences** (shown by the drawer as the service `message`):
- `READ_FAILED`: "Design Chamber could not read this design's version history right now. Try again in a moment."
- `UNSUPPORTED`: "This design's version history was saved by a newer version of Design Chamber. Update the extension to save or restore versions here."
- `SET_ASIDE_FAILED`: "Design Chamber could not set the damaged version list aside, so it saved nothing. Try again in a moment."
- `RESTORE_WOULD_DROP_COMMENTS`: "This version's design.json is damaged, so restoring it would lose your comments. Nothing was changed."

### Service Routes
No new route. `GET /designs/:slug/versions` gains one optional field. Bearer check (http.ts) and
slug validation and containment (`store.dir`) are unchanged. `POST /designs/:slug/versions`,
`POST /versions/turn` and `POST …/restore` can now answer 422 `invalid` (unsupported, or
comments at risk) or 500 `internal` (read or set-aside failure), always with the sentences above.

**WP0 change, made by the main agent before the developer starts** (`src/shared/api.ts:215`):
`export type VersionHistoryState = 'repaired' | 'recovered' | 'reset' | 'unsupported';` and
`VersionListResponse = { versions; currentTreeHash; dirty; history?: VersionHistoryState }`.
This is additive: clients that ignore it keep working, and `test/ui/visual/fake-backend.ts` and
`src/guest/fake-services.ts` need no change.

### Frontend (small adjacent edit in the ui lane, named in the report)
- `src/ui/model/versions-model.ts`: add `historyNotice(state: VersionHistoryState): { tone: BannerTone; title: string; body: string }`.
  - `repaired`, `warning`: "Some versions could not be read" / "They are hidden from this list. Their saved files are kept in this design's .versions folder."
  - `recovered`, `warning`: "Version list restored from its backup" / "The list was damaged and has been rebuilt. The newest version may be missing."
  - `reset`, `warning`: "Older versions could not be recovered" / "The version list was damaged and had no usable backup. New versions are saved as usual, and the old files are kept in this design's .versions folder."
  - `unsupported`, `info`: "Saved by a newer Design Chamber" / "Update the extension to see, save or restore versions of this design."
- `src/ui/components/versions-drawer.ts` (render around `:126-139`): when `state.data.history`
  is set, prepend `banner(historyNotice(...))` (the existing kit helper, `kit.ts:195`) above the list.
  When it is `unsupported`, do not render "Save a version now" or the "No versions yet" empty state.
  No new CSS. The banner uses the kit's own `--oc-*` tone tokens, nothing local.

### Failure & Recovery
| Failure | What the user sees | Way back |
|---|---|---|
| index.json unreadable, backup good | drawer notice "restored from its backup"; at most the newest version missing | automatic; damaged copy kept 30 days |
| index.json unreadable, no backup | notice "could not be recovered"; new versions continue | old files kept in `.versions` for 30 days |
| some entries invalid | those versions hidden, notice "could not be read" | the rest stay restorable |
| EBUSY/EIO reading the index | drawer error banner with READ_FAILED and "Try again" (existing) | retry; nothing was written |
| set-aside fails (Windows lock) | snapshot or restore error with SET_ASIDE_FAILED; auto snapshot just logs | the next snapshot retries |
| newer index version | info notice, no Save button | update the extension |
| restore would drop comments | restore confirm dialog shows "Couldn't restore. … Nothing was changed." (existing wrapper, versions-drawer `:38`) | ask the agent to fix the version's file, or restore another version |

### Not Building
- Per-version tree manifests (`.versions/trees/<hash>.json`): they would duplicate the index,
  need their own GC, and the backup plus set-aside already covers torn and edited indexes.
- A "dismiss notice" or "delete damaged copy" route: a mutation for a rare case. Expiry (Q1) handles it.
- A UI to recover individual dropped entries: their bytes are kept, which is enough for a human or a later tool.
- Duplicate-id detection in the index: not observed, and `findEntry` takes the first.

### Security & Threat Model
- The actor is the user's own agent (or a sync tool) writing anything into `.versions/`.
  `index.json`, the backup and the damaged files are untrusted input. They are parsed by
  `parseIndexText`/`isEntry` (paths must be safe and tracked, objects must be sha256), as today,
  for every source including the backup.
- `hashesMentioned` output is used **only** to protect from deletion, never to read or write.
  A file listing every hash can only stop cleanup, which the agent could do anyway by writing files.
- Damaged names are built by the service (stamp, random, fixed kind), never from input. All new
  writes go under the contained `versionsDir` (decision 9).
- No secrets are involved. Log lines carry the design path and counts, never file contents.
- No iframe or postMessage change.

### Sandbox & Path Safety
Sandbox: N/A, no frame touched. Containment: `resolveInside(designDir, ['.versions'])` is the one
function (paths.ts `:113`, already tested). New tests: a `.versions` symlink to a folder outside
gets snapshot and restore refused, and nothing is created outside (skip on win32 when symlink
creation is not allowed). Existing tampered-index test `versions.test.ts:346` must still pass
(the tampered entry is now dropped, so restore answers `not-found`).

### Data Flow
Agent or sync tool damages `index.json` → `list` reports `history` (read-only) → drawer banner →
next chained snapshot: `loadIndex` → set aside (rename) → write `index.json` + `.bak` → guarded GC
(protects bak + damaged mentions) → `versions` hub event → drawer refresh.

### Edge Cases
- **Concurrency:** `list` racing a chained commit can see `index.json` missing between the rename
  and the write. Step 5 then reads the backup, which is still current, so the list is right. Two
  mutations of one slug never interleave (existing chain).
- **Crash points:** after the rename and before the write, the next load finds index missing and
  a backup present, so it recovers. After the index write and before the backup write, the backup
  is one generation old and the index is fine. During an object write nothing changes (the objects
  are content-addressed tmp+rename files).
- **Retries:** set-aside runs once per damage. After a commit the next load is `ok`. Repeated failed commits leave the damaged file in place and try again.
- **Empty:** a new design with no index and no objects is `ok` and empty, with no notice.
- **Huge or malformed:** an over-cap index is set aside by rename without being read. A malformed design.json in a version is covered by restore step 3.
- **Missing or changed root:** `store.dir` throws `not-found` (unchanged). A root switch clears the timers (unchanged).
- **Windows:** rename refused falls back to copy. Stamp names have no `:`. Lowercase-hex regexes work on case-insensitive filesystems.
- **Service restart:** no in-memory health state. Everything is derived from disk on each call.
- Theme switch and Chrome missing: N/A.

### Tests (failing first; mutation-check the starred ones)
- New `test/service/render/versions-index.test.ts`: `parseIndexText` cases (valid, one bad entry
  of 3 kept 2 and `dropped` 1, garbage, truncated JSON, BOM, `version:2`, versions not an array,
  bad `next`); `hashesMentioned` and `highestVersionNumber` on truncated text; damaged-name round
  trip, no `:`, sorts by time; `historyStateOf` precedence.
- `test/service/render/versions.test.ts`, new cases:
  - ★ 5 versions, truncate `index.json` to half: the next snapshot keeps every old object; the damaged file holds the original bytes; `list` shows 6 versions and `history: 'recovered'`.
  - ★ one invalid entry: `list` (before any write) shows the other 4 and `history: 'repaired'`; after a snapshot the dropped entry's unique objects still exist.
  - ★ no backup plus garbage: `reset`, the new id is higher than any old id, old objects kept.
  - missing index plus objects: `reset` with an orphans note, objects kept.
  - ★ `version: 2`: `create` rejects `invalid`, `index.json` unchanged byte for byte, `history: 'unsupported'`.
  - `index.json` replaced by a directory (portable non-ENOENT read error): `list` and `create` reject, nothing written.
  - ★ retention: with `now` advanced past 30 days, the damaged file is removed and its only-referenced objects are collected; before that they survive pruning past 100.
  - symlinked `.versions` refused (skip on win32).
- `test/service/render/versions-restore.test.ts`:
  - ★ state.json deleted, live design.json has 2 comments: after restore both comments are still in design.json and in `store.get`.
  - version design.json unparseable, no state.json, comments present: rejected `invalid`, every design file unchanged, no restore-point created.
- `test/ui/comments-versions-model.test.ts`: `historyNotice` for each state.

### Docs
- `documentation/features/rendering-versions-export-thumbnails.md` "Versions": replace the bullet
  "an entry … makes the list unreadable" with the drop-one rule, and add the backup, set-aside,
  30-day keep, the newer-version refusal and the restore comment rule.
- `documentation/pages/full-screen-page.md` and `rail-panel.md` Versions drawer: the notice states.
- SPEC delta for the main agent: §6.4 (backup, damaged files, GC protection, newer-version
  refusal) and §7 (`history?` on the list route).

### Risks
| Risk | Severity | Mitigation |
|---|---|---|
| Damaged files pin large objects for 30 days | Low | cap 5 files, expiry, documented |
| Index write cost doubles (backup) | Low | index is about 200 KB typically, 12 MB worst |
| `store.get` state is not the resolved one | Medium | step 2 says verify, with a fallback named; the ★ restore test catches it |

### Acceptance
1. No index damage (corrupt, partial, missing, or a read error) ever causes an object to be deleted while any kept file mentions it.
2. Valid entries survive a partially invalid index.
3. The drawer shows the right notice for each state, and Save is hidden for `unsupported`.
4. Restore never drops live comments. When it would have to, it refuses before writing.
5. `npm run check` passes. Starred tests were seen red against the old code.

---

## 0b. Export and watcher performance (`perf/export-and-watch`, fullstack-developer)

### Problem (verified)
- `src/service/zip.ts:35-39` JS byte-loop CRC-32 and `:74` `deflateRawSync(level 9)` run on the
  service's only thread. `src/service/export.ts:82-93` reads every file into memory first, and
  `createZip` concatenates the whole archive (`:125`). A large design stalls change long-polls,
  the watcher, thumbnails and every other request for seconds.
- `src/service/watch.ts:278-291` `pollTick` fingerprints every design every 3 s even while the
  live watcher is healthy.
- `watch.ts:49-68` `takeFingerprint` records only the `assets/` folder mtime, plus bare presence
  (`'present'`) for other top-level entries. On folders where watching is off, an in-place edit of
  `assets/img/a.png`, a file added in a nested folder, or an edit to a top-level `styles.css`
  goes unnoticed.

### Runtime facts (for `zlib.crc32`)
The OpenChamber SDK sources are not on this machine (the path is NOT FOUND), so this rests on
`docs/testing/PLATFORMS.md:10-20`, measured and cited there. The desktop host runs the service with
its Electron binary as Node **24.22**. The headless server needs Node **≥ 24.14**. CI uses
`22.x` (`.github/workflows/ci.yml:31`) and tests need ≥ 22.18. `zlib.crc32` exists from
Node 22.2 / 20.15, and `@types/node` 22.20 declares it (`zlib.d.ts:303`). **Fallback:** the
existing table implementation, renamed `crc32Portable`, is selected once at module load when
`typeof zlib.crc32 !== 'function'` (for example a developer running the host under Bun).

### Design: ZIP
**`src/service/zip.ts`**, rewritten around one writer. Header byte layout, flags, the UTF-8 bit,
version fields, DOS time and zip64 refusals stay exactly as today.
- `export const crc32 = (data: Uint8Array, previous?: number): number`: native when available,
  else `crc32Portable(data, previous)` (the existing loop, extended to take a running value).
  Keep the export, because `test/service/render/zip-reader.ts:6` imports it.
- `export type ZipSource = { name: string; read: () => Promise<Buffer | null> }` (`null` means the file vanished and is skipped).
- `export const writeZipFile = (target: string, sources: readonly ZipSource[], options?: { now?: Date }): Promise<{ bytes: number; entries: number }>`
  - Opens `target` with `open(target, 'wx')` and keeps a running `position`. Writes are positional
    with `FileHandle.write`, so nothing but the current entry is held in memory.
  - Per source: `read()`. Refuse when the file is over `ZIP_ENTRY_MAX_BYTES` = 512 MiB, by
    throwing a `ZipError` that names the file. Compute the CRC in 8 MiB slices with
    `await new Promise(setImmediate)` between slices, so even the portable fallback yields.
    Compress with **async** `zlib.deflateRaw` (libuv threadpool, `promisify`) at level 6, except
    for already-compressed extensions (`png jpg jpeg gif webp avif woff woff2 mp4 webm mp3 zip gz br`),
    which are stored without trying. Store when deflate is not smaller (as today). Then write the
    local header, name and payload, and push the 46-byte central record.
  - Then write the central directory and EOCD, close, and return `{ bytes: position, entries }`.
    On any error close the handle and rethrow (the caller removes the tmp file).
  - Duplicate or empty names, and zip64 needs, throw `ZipError` as today, before that entry is written.
- `createZip` is **removed** (its only production caller was export.ts). Port `zip.test.ts` to
  `writeZipFile` on a tmp file plus `readZip(await readFile(...))`. Same assertions. The
  "random one stored" case keeps a `.bin` name, so choose-smaller still decides.

**`src/service/export.ts`**:
- `buildZip` becomes `writeZipExport(slug, record, tmpPath)`: `listTracked` minus design.json. If
  that is empty, throw `no-html` before opening anything. Sources read
  `path.join(record.path, ...rel.split('/'))` (rels come from `listTracked`, which skips symlinks
  and dot trees, unchanged). A result with `entries === 0` (everything vanished) removes the tmp
  file and throws `no-html`.
- The ZIP is written to `${target}.<rand>.tmp` in the destination folder and renamed on success.
  The `writeAtomic` contract is unchanged, and the response `bytes` is the written size.
- **Name reservation:** `createExportService` keeps `reserved: Set<string>` of in-flight targets
  (key lowercased on win32 and darwin). `uniqueTarget` skips names that exist or are reserved.
  The name is released in `finally`. This closes the race where two concurrent exports pick the
  same name, which streaming makes longer.
- `ZipError` maps to `ApiError('too-large', <its sentence>)`. EPERM/EACCES map to `bad-path` (existing, `:131-134`).
- The single-file HTML path is untouched (`buildHtml`, `writeAtomic`, 60 MB bundle cap).
- `ZipError` sentences: "This export is too large for a ZIP file." and "<rel> is over 512 MB, which is too large to put in a ZIP. Move it out of the design folder and try again."

### Design: watcher (`src/service/watch.ts`)
1. **Rotating sweep while the live watcher is healthy.** I recommend this over the brief's "root
   listing only". The code itself records that Windows recursive watching and OneDrive drop or
   merge events while the watcher stays alive (`watch.ts:214-216`, and `flushSlug` exists to repair
   that), and a deaf-but-alive watcher on a network root sends no error. A pure skip would leave
   those users with designs that never refresh. So:
   - `healthy = watcher !== null && !pollOnly`.
   - Every tick runs `scanRoot()` as today. If healthy, fingerprint only the next
     `ceil(knownSlugs.size / sweepTicks)` slugs from a cursor over the **sorted** slug list
     (wrapping). Otherwise fingerprint all of them, as today.
   - `SWEEP_TICKS = 10` (module constant; about 30 s per full pass, see Q2). New
     `WatcherOptions.sweepTicks?: number` test seam.
   - Pure and exported: `sweepSlice(sorted: readonly string[], cursor: number, count: number): { slice: string[]; next: number }`.
   - When the watcher dies, `watcher` becomes null and the next tick is a full sweep. Fingerprints
     that a `flushSlug` refreshed are current. Stale ones report the missed changes, which is the
     point. Duplicate `files` events are harmless (refetch is idempotent).
2. **Capped recursive fingerprint.** In `takeFingerprint`, the fixed top files and `screens/*.html`
   are fingerprinted first and always (screens ≤ 40). Then:
   - top-level non-dot **files** that are not already keyed get `mtime:size` instead of `'present'`;
   - each top-level non-dot **directory** except `screens` (`assets` first, then alphabetical)
     is walked depth-first with names **sorted** per folder (readdir order differs by platform, and an
     unsorted walk would move the cap boundary and invent changes). Dot names and symlinks
     (`Dirent.isSymbolicLink()`) are skipped. Depth ≤ 6. One shared budget of
     `FINGERPRINT_ENTRIES_MAX = 256` entries. Files get key `<dir>/<rel>` → `mtime:size`, folders
     get `<dir>/<rel>/` → `dir`. When the budget runs out, add `<dir>/…` → `truncated` and stop.
     The existing `assets/` → `mtime:dir` key stays.
   - Export `takeFingerprint(dir, budget = FINGERPRINT_ENTRIES_MAX)` for tests.
   - Emitted `files` keys become real paths (`assets/img/a.png`). Consumers already handle any
     path: `affectedSources` (src/guest/store.ts:76) maps non-screen files to "reload all".
3. **Test seams on `Watcher`:** `pollNow(): Promise<void>` runs one `pollTick` (deterministic,
   no timers). `WatcherOptions.fingerprint?: (dir: string) => Promise<Fingerprint>` defaults to
   `takeFingerprint` and lets a test count calls per slug.

**Routes and frontend:** none changed. `POST /designs/:slug/export` keeps its body, response,
auth and slug containment; `destinationDir` is unchanged; the toast already shows the service sentence.

### Failure & Recovery
| Failure | User sees | Way back |
|---|---|---|
| file over 512 MB | export error toast with the file named | move the file, export again |
| zip64 needed | "too large for a ZIP file" | single-file HTML, or remove assets |
| Downloads refused (macOS privacy) | existing `bad-path` sentence | existing fallback text |
| tmp write fails mid-archive | `internal` error; tmp removed, name released | retry |
| watcher deaf on OneDrive | change appears within about 30 s instead of 3 s | automatic |

### Not Building
- Per-entry streaming with header back-patching (for single files over 512 MB): no design needs it yet.
- Worker threads: async zlib already runs off the main thread, and the CRC slices yield.
- A background export job with polling: 100 MB at level 6 with media stored fits the 15 s handler budget.
- Moving `src/guest/fake-services.ts`: not part of 0b (see 0c).

### Security & Threat Model
- Export reads only `listTracked` paths (symlinks skipped, dot trees skipped) inside the
  contained design folder (unchanged). The archive names are `<slug>/<rel>`, where `rel` comes from a
  directory walk, never from a request. `isSafeRel`-style names cannot contain `..` because
  `readdir` never returns it.
- Writes land only in the existing destination folder, with service-built names. `open(…, 'wx')` refuses to follow an existing tmp name.
- The fingerprint walk skips symlinks, so a link to `/` cannot make the poll walk the disk, and
  the 256-entry budget bounds the cost an agent can force.
- No secrets, no frames.

**Sandbox & Path Safety:** sandbox N/A. No new path input; the design folder is contained by
`store.get` as before; reservation keys are lowercased for case-insensitive Windows and macOS.

### Data Flow
Click Export ZIP → `POST /export` → `store.get` → `listTracked` → per file: read → CRC
(sliced) → async deflate → positional write to tmp → central dir → rename → `issue(path)` →
toast with "Show in folder".

### Edge Cases
- **Agent writing during export:** each file is read once, and its CRC and payload come from the
  same bytes, so the archive is consistent (a file may be from just before or after the write, as today).
- **Concurrent exports of one design:** reservation gives `x.zip` and `x (2).zip`. An export
  during a snapshot: both only read design files.
- **Service restart mid-export:** a stray `*.tmp` is left in Downloads (as today with `writeAtomic`). Noted, not fixed.
- **Empty design:** `no-html` before any file is opened.
- **Root switch mid-sweep:** `onRootChange` clears fingerprints, and the cursor resets to 0.
- **Huge assets tree:** the budget gives at most 256 extra stats per fingerprinted design per tick.
- **Windows:** positional writes are fine. Keys use `/`. Sorting uses the default string order
  (stable, locale-free).
- Theme, Chrome, design.json: N/A.

### Tests
- `test/service/render/zip.test.ts`: ported to `writeZipFile` (round trip, UTF-8, duplicates,
  empty archive, system extractor). New: `crc32` equals `crc32Portable` on the check value
  `0xcbf43926`, on random 1 MiB, and with a running `previous` across slices; a `.png` entry is
  stored without a deflate attempt; an entry over the cap (inject a small cap through an options
  seam `maxEntryBytes`) throws `ZipError` and the caller's tmp file is gone.
- `test/service/render/export.test.ts`: existing 5 tests pass unchanged. New: two concurrent
  `export('art', zip)` calls give distinct names, both valid. ★ Event-loop responsiveness: during
  an export of a design with 24 MB of mixed compressible and incompressible files,
  `perf_hooks.monitorEventLoopDelay` max is under 500 ms (it must fail against the old
  `createZip`; if it proves flaky on CI, make it a manual measurement in the PR. Do not raise the threshold silently).
- `test/service/core/watch.test.ts` (use `env.watcher.ready` before creating folders, the
  b3044df fix; drive polls with `pollNow()`; use `waitForEvent` with 6000 ms timeouts; no fixed sleeps):
  - `sweepSlice` wrap-around and an empty list.
  - ★ healthy watcher (a scripted impl that stays alive and silent), 20 designs, `sweepTicks: 10`:
    after 10 `pollNow()` calls each design is fingerprinted exactly once (`fingerprint` seam counts).
  - ★ healthy but silent watcher: an in-place edit is reported by a later sweep (proves the deaf-watcher fallback).
  - watcher errors (scripted `emit('error')`): the next `pollNow()` fingerprints every design.
  - ★ poll-only (`deadWatch`): an in-place rewrite of `assets/img/a.png` (same size, new mtime via
    `utimes`) emits `files` with `assets/img/a.png`, and an edit to `styles.css` emits `files`.
  - cap: 300 files in `assets/` gives exactly 256 walk entries plus the `truncated` marker,
    identical across two calls (sorted order).
  - Existing poll and loose tests stay green.

### Docs
- `documentation/features/local-service.md` (watch section, around lines 60-66): rotating sweep,
  the 30 s worst case, and nested files on poll-only folders.
- `documentation/features/rendering-versions-export-thumbnails.md` "Export": the 512 MB per-file
  limit and that the ZIP is written as it goes (the service stays responsive).
- SPEC delta for the main agent: §9.4 (sweep, capped fingerprint) and §9.5 `zip.ts` (async deflate
  level 6, native CRC with fallback, stored media, positional writer, `createZip` removed).

### Risks
| Risk | Severity | Mitigation |
|---|---|---|
| Deaf watcher latency 3 s → 30 s | Low | Q2; normal path unaffected |
| Level 6 archives about 1-3 % larger | Low | accepted for 2-3× speed |
| Responsiveness test flaky on Fedora container | Medium | threshold rule above |

### Acceptance
1. A ZIP export never blocks the event loop for more than about 100 ms per 8 MiB slice. Memory
   peaks at the largest single file, not the design.
2. Exported archives open in the system extractor with identical contents. All existing export and zip tests pass.
3. With a healthy watcher the poll fingerprints ~1/10 of the designs per tick. With none, or poll-only, it fingerprints all.
4. Nested asset and top-level file edits are detected on poll-only folders within one poll tick.
5. `npm run check` passes.

---

## 0c. Wall split, no behaviour change (`refactor/wall-controllers`, ui-ux-developer)

### Problem (verified)
`src/ui/wall/wall.ts` is 1 202 lines: one `createWall` closure (`:132-1202`) holding 22
mutable variables (`:134-159`, plus `settleTimer :207`, `downAt :968`, `pageSized :1046`) and all
input, hover, pin, popover, loading and camera logic. Its pure math already lives in
`src/ui/model/wall-model.ts` (214 lines) and `src/guest/camera.ts`. The input decisions (keys,
wheel, pointer gestures, hit matching) have no direct tests. The only consumer is
`src/ui/wall/design-view.ts:20,106` (`createWall`, `WallHandle`).

### Design
**Public API frozen:** `WallOptions`, `WallHandle` (`wall.ts:52-102`) and every DOM class,
attribute and ARIA string stay byte-identical. `styles.css` is untouched.

**Modules** (all in `src/ui/wall/`; no file over ~400 lines; dependencies point one way, with
callbacks passed in where today's code calls "up"):

| File | Owns (variables moved from the closure) | Exposes |
|---|---|---|
| `wall-context.ts` (new) | `detail`, `mode`, `hidden`, `pageView`, `version`, `compare`, `showPins`, `disposed`; DOM roots `surface/world/labels/overlay`; `options`, `pageMode`, `liveBudget` | `WallContext` type with getters `readOnly()`, `frameMode()`, `comments()`, `numbers()`, `commentsOf(art)`, `screens()`, `fileOf()`, `size()`, `local(event)`, `pinSize()` |
| `camera-controller.ts` (new) | `camera`, `userMoved`, `surfaceSize`, `settleTimer`, `pageSized`, ResizeObserver | `get()`, `set(next, user)`, `apply()`, `fitView()`, `fit()`, `layoutPage()`, `zoomAtCentre(f)`, `zoomReset()`, `coveredInsets()`, `dispose()` |
| `board-set.ts` (new) | `boards`, `layout`, `syncQueued`; `Board`/`Artboard` types; make, size, paint label and placeholder, load, live sync, compare slots, rebuild layout | `values()`, `get(id)`, `rebuild()`, `load(board)`, `reset(board)`, `queueSync()`, `paintLabel(board)`, `dispose()` |
| `pin-layer.ts` (new) | `pinScale`; pin and cluster DOM per board | `paint(board)`, `paintAll()` |
| `popover-layer.ts` (new) | `popover` | `openThread(board, id)`, `openComposer(board, el, point)`, `close()`, `current()`, `placeCard(...)` |
| `hit-controller.ts` (new) | `pointer`, `hoverTimer`, `lastHitAt`, `pendingHit`, `hoveredBoard` | `requestHit`, `onHit`, `scheduleHover`, `clearHover`, `setPointer`, `dispose()` |
| `frame-messages.ts` (new) | none | `handleFrameMessage(board, message)` (today `:798-845`) |
| `input-controller.ts` (new) | `panning`, `spaceDown`, `panTool`, `downAt`; keyboard, wheel, pointer and label-dblclick listeners | `shortcut(key, shift)`, listeners on `ctx.scope` |
| `wall.ts` (slimmed, ≤ 300 lines) | the scope and wiring order | `createWall` and the unchanged `WallHandle` |

Wiring order in `createWall`: context → camera → popovers → pins → hit → boards (given an
`onFrameMessage` callback that forwards to `frame-messages`, which receives `hit`, `boards.load`,
`camera` and `input.shortcut` after they exist) → input → initial `rebuild`/`apply`. Late binding
uses one callback slot, never a circular import. `comment-ui.ts` and `frame-slot.ts` are reused unchanged.

**Pure extraction, new `src/ui/model/wall-input.ts`** (no DOM; exact semantics of today's code):
- `wallKeyAction({ key, code, shift, pageMode }) → WallKeyAction | null` with the union
  `zoom{factor}` | `zoom-reset` | `fit` | `pan{dx,dy}` | `toggle-pan-tool` | `space-down` | `escape`,
  covering `:908-930` and `:859-875` (note: Shift+0/1 matched by `code`, `+`/`=`/`-`/`_`
  by `key`, `h` case-insensitive, arrows use `nudgeStep(shift)`).
- `pageKeyAction({ key, shift, frameHeight }) → { type:'scroll-by', dx, dy } | { type:'scroll-to', x, y } | { type:'escape' } | null` (`:885-906`; screenful = `max(40, round(h*0.9))`; End = `scroll-by 1e7`).
- `wheelRoute({ pageMode, ctrlOrMeta, mode, readOnly, overReadyBoard, spaceDown, panTool }) → 'zoom' | 'scroll-frame' | 'pan' | 'none'` (`:938-966`).
- `frameWheelRoute({ pageMode, ctrl, mode, readOnly }) → same union` (`:824-836`).
- `pointerDownAction({ pageMode, button, spaceDown, panTool, onBoard, mode, readOnly }) → 'pan' | 'press' | 'ignore'` (`:970-991`; keep today's order: `wantsPan` is computed, then non-0/1 buttons are ignored).
- `DRAG_THRESHOLD_PX = 4` and `isDrag(from, to)` (`:1001,1004`).
- `hitMatches(pending, boardId, x, y)` (`:764`) and `frameModeOf(mode, readOnly)` (`:801,1101`).

### Phase 1 seams (named now, nothing built)
| Phase 1 feature | Seam in this split |
|---|---|
| Live build strip | `board-set.paintLabel(board)` is the one place that renders artboard status (`labelStatus`). Phase 1 adds `WallHandle.setBuildStatus` routed there; `reload(sources)` already exists. |
| Docked ask bar | `camera-controller.coveredInsets(): { right, bottom }`. Today it wraps `options.coveredRight` with `bottom: 0`. Phase 1 adds `WallOptions.coveredBottom`, and fit and page layout already read the insets. |
| Per-pin "Send this" | `popover-layer.openThread` builds the thread card via `comment-ui.createThread`. Phase 1 adds one action and a `WallOptions.onSendComment(id)` callback. |
| Checks badge | Per artboard: the same `paintLabel` status slot. Per design: `design-view.ts` toolbar (outside the wall). |
| New shortcuts (focus ask bar) | `wallKeyAction` union plus `input-controller.shortcut`. |

### `src/guest/fake-services.ts`: stays put in this branch
It is not imported by the wall or by the visual harness (`shoot.mjs` bundles
`test/ui/visual/fake-main.ts` with its own `fake-backend.ts`). Its importers are
`test/guest/{service-client,flows,changes-store}.test.ts` and
`test/service/integration/slash-command-e2e.test.ts`, all in the fullstack lane, and moving it
edits `docs/SPEC.md` §8.2 and `docs/GUEST-API.md:196`. It is review item m4. Recommend a separate
small fullstack chore after Phase 0 merges (move to `test/helpers/fake-services.ts`, update the 4
importers, the copy-test skip list `test/copy-no-em-dash.test.ts:14` and the 2 docs).

**Routes, data, tokens:** none changed; every class and `--oc-*` use moves with its code.
**Failure & Recovery:** behaviour is identical; a regression is caught by the shoot checks or the
screenshot diff before merge; revert path is one logical commit per module move.

### Not Building
- Any Phase 1 feature or option. Seams are only named.
- A state library or event bus: plain objects and callbacks are enough.
- Splitting `design-view.ts` (716 lines): not asked, and it is the next consumer to change in Phase 1.

### Security & Threat Model
Unchanged boundary. Frames are still created by `frame-slot.ts` with the same sandbox and feed.
`frame-messages.ts` receives only `FrameToPageMessage` values already validated by the bridge
channel (unchanged). Nothing new crosses postMessage. No token in the guest (unchanged).

### Sandbox & Path Safety
`frame-slot.ts` is untouched, so its sandbox flags and srcdoc/blob feed are byte-identical. Verify with
`git diff master -- src/ui/wall/frame-slot.ts` (empty). No paths.

### Data Flow
Unchanged: design-view → `createWall` → board-set → frame-slot (sandboxed) → bridge messages →
frame-messages → hit, pins, popovers → `options.create/update/deleteComment` → service.

### Edge Cases
The refactor must preserve these exactly (each has a line reference above): Space held in a frame
(key-down only, ignored), a drag over 4 px turns a press into a pan (wall) or nothing (page), a
popover closes on frame scroll, the hover throttle of 40 ms, dispose cancelling the rAF, the settle
timer and the focus timeouts (`:1178,1186` guarded by `disposed`), `refit` with `userMoved`, a
theme switch (CSS variables only, no JS), and the compact rail (`options.compact`: pin size 18, live budget 4).

### Tests and verification
- New `test/ui/wall-input-model.test.ts`: table-driven over every function in `wall-input.ts`,
  covering both presentations, edit, play and read-only, Space and the pan tool, and each button.
  ★ Mutation check: flip `readOnly` in `wheelRoute` and swap the `wantsPan` order, and watch each go red.
- **Before and after screenshots.** On `master`: `npm run build && node test/ui/visual/shoot.mjs --out /tmp/dc-shots-before`.
  On the branch: the same with `--out /tmp/dc-shots-after`. **Always pass `--out`**, because the default overwrites
  `documentation/pages/img`. Both runs exit 0 (shoot's own checks cover the composer, pins, clusters
  and the thread popover, `shoot.mjs:341-382`). Compare sha256 per file. Open every differing
  pair side by side and list each in the report with its cause (only non-determinism such as
  relative times is acceptable).
- Existing `test/ui/*.test.ts` stay green.

### Docs
None user-facing. Update the header comment of `wall.ts` to point at the module table. The SPEC
delta for the main agent is §12 (the `src/ui/wall/**` file list).

### Risks
| Risk | Severity | Mitigation |
|---|---|---|
| Subtle input-order change (pan vs press) | Medium | pure functions mirror the line refs; mutation-checked tests; shoot run |
| Late-binding wiring leaves a callback unset | Low | typed slot that throws when unset at dev time; covered by the shoot run |
| Merge conflict with Phase 1 work started early | Low | Phase 1 waits for 0c to merge |

### Acceptance
1. `WallOptions`/`WallHandle` unchanged. `design-view.ts` and `frame-slot.ts` have zero diff, and `styles.css` has zero diff.
2. `wall.ts` ≤ 300 lines. No new module over ~400 lines. No circular imports.
3. `wall-input.ts` is covered by tests that fail when a condition is flipped.
4. Shoot runs exit 0 before and after, and the screenshot diff is explained file by file.
5. `npm run check` passes.

---

## SPEC.md deltas (the main agent applies these after each merge)
- §6.4: `index.bak.json`, the `index.damaged-*` files with 30-day and 5-file keep, GC protection, drop-one-entry, newer-version refusal, and restore keeping live comments.
- §7: `history?: 'repaired' | 'recovered' | 'reset' | 'unsupported'` on `GET /designs/:slug/versions`.
- §9.4: rotating sweep while healthy, the capped sorted fingerprint, top-level files by `mtime:size`.
- §9.5: the `zip.ts` positional writer, async deflate level 6, native CRC with fallback, stored media types, the 512 MB entry cap, and export name reservation.
- §12: the new `src/ui/wall/*` and `src/ui/model/wall-input.ts` files, and `src/service/versions-index.ts`.

Architecture Complete → main agent (apply the `api.ts` WP0 field, then dispatch) → fullstack-developer (0a, 0b in parallel), ui-ux-developer (0c in parallel)
