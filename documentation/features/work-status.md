# Work Status

Status: Phase 1.5 (U5). The service half and the frame (UI half) are built.
Spec: `documentation/specs/phase-1-5-sdk-2-7.md` §U5.

## What it is

A **Designs** section in OpenChamber's Work Status for a chat. One line per design, at most 5:
the design's name, what its agent is doing, how its checks stand, with **Check** and **Open**
buttons. It lets someone who is chatting with an agent see "Pricing page · Writing pricing.html ·
3 issues" without opening Design Chamber.

## Which designs are listed (service)

`GET /status/designs?directory=<project folder>&session=<chat id>` answers up to 5 rows, plus a
`total` of every design that matched (for "Show all 12 designs"). Both query values are optional
and are only compared with what the service already knows; they are never used as file paths.

Order, first match wins:

1. The design linked to this chat (always listed, whatever its age or project).
2. Designs whose linked agent is working right now, in this project.
3. This project's designs updated in the last 7 days, newest first.

With no project open, the project test is dropped and designs from anywhere updated in the last
7 days are listed. With a project open, a design that names no project cannot be placed in it and
is left out (unless it is this chat's). Folder paths are compared the way the OS would: either
slash, no trailing slash, case-insensitive for Windows drive paths.

## What each row says (service)

| Field | Meaning |
|---|---|
| `here` | The design is linked to this chat. |
| `agent` | `writing` (agent working and a file saved in the last 15 s), `working`, `failed` (the last turn failed), or `null` (finished, unknown, or no linked chat). |
| `lastFile` | Base name of the last file the agent wrote; only with `writing`. |
| `checks` | Error, warning and note counts, the render state and whether a check can run. `null` when the design has nothing written yet, or the read took longer than 1.5 s or failed: the row then shows no check part. |
| `pending` | The agent has not written the design's first file yet. |
| `openComments` | Open comment count. |

`agent` needs the activity tracker (turn events, U4). Until that is merged, rows show no agent
state. `lastFile` is remembered in memory from the file-change feed (the agent's own files only:
not `design.json`, the service's folders or temp files; a version restore is not the agent) and
starts empty each time the service starts, so a file written before the first status read shows as
"working" until the next write.

## Speed and failure

The answer comes from memory: the design index for the list, the activity tracker for the agent,
and the checks service, whose static part is cached, for the counts (at most 5 reads, in parallel,
each under 1.5 s). A cold index is waited for 1.5 s. A missing index, a failing tracker or a slow
check read gives an empty list or a row without a check part. The route never answers with an
error because of them (the failure is logged as `status.designs-failed`).

## Where the code is

- `src/service/status-designs.ts`: `pickStatusDesigns` (pure), `agentStateOf` (pure),
  `createStatusDesigns` (the in-memory last-file listener and the answer).
- `src/service/routes/status.ts`: the route.
- `test/service/core/status-designs.test.ts`.

## The frame (UI half)

Our own small frame, not an app-drawn section, because only a frame can open the rail and know which
chat it sits in. OpenChamber runs it only while the chat's Work Status is shown and the **Designs**
section is expanded; the frame itself keeps nothing it cannot rebuild.

### What a line looks like

```
● Pricing page                                   Check  Open
  Writing pricing.html · 3 issues · 2 open comments
```

- A coloured dot, the design's name (clipped with an ellipsis; the full name is its tooltip), and under it
  the muted meta line. The dot is never the only signal: the meta line says the same in words.
- The words are not written here. The agent part is the rail pill's text (`pillText`), the check part is
  the Checks badge's label (`badgeOf`), so a design reads the same in Work Status, the rail and the
  viewer. `src/ui/model/status-model.ts` only picks which parts show, in what order, and the dot colour.
  A test asserts the strings equal what those two functions return.
- Dot colours: the agent part wins (working or writing is blue, stopped is red, "Waiting for agent" is
  amber); otherwise the check part decides (green only when the rendering is verified, red for errors,
  amber for warnings, grey when the rendering is unknown or running). A pulse on the blue dot marks live
  work and stops when the person asked for reduced motion.
- The row's tooltip is the Checks badge's accessible sentence, for example "Checks: No issues in the
  files. Rendering was checked before your latest changes."
- Rows beyond the service's five are summed into a footer link, "Show all 12 designs", which opens the
  rail's list.

### Buttons

- **Check** (ghost, small) runs the rendering check through `POST /designs/:slug/checks/run`. The line says
  "Checking" at once and the button shows progress; the result arrives with the `checks` change event.
  It is off, with the reason as its tooltip and read by screen readers, when there is nothing to check yet
  ("There is nothing to check until the agent writes the first file."), when the checks could not be read
  ("Checks aren't available for this design yet."), when no browser was found ("Checks need Chrome, Edge or
  Chromium."), or when another design is being checked ("Another design is being checked. Try again when it
  finishes."). A press that loses the race gets that last sentence as a toast.
- **Open** (outline, small) asks the service to open the design (`POST /open-request`) and then opens the
  Design Chamber rail, which takes the request. "That design was deleted." when the design is gone;
  "Open Design Chamber from the rail to see it." where the host cannot open the rail.
- Keyboard: Tab goes row by row, Check then Open, then the footer link. Each button's name includes the
  design ("Check Pricing page").

### States

| Situation | What shows |
|---|---|
| First answer pending | a small spinner with "Loading designs" |
| No designs, a project open | "No designs for this project yet. Ask the agent for one, or type /design." |
| No designs, no project | "No designs in the last 7 days. Ask the agent for one, or type /design." |
| Service not running (`NO_SERVICE`, `SERVICE_FAILED`) | "Design Chamber is starting." After 10 s still failing: "Design Chamber isn't responding." with **Try again** |
| Extension paused (`DISABLED`) | "Design Chamber is paused. Turn it on in Settings → Extensions." |
| Any other failed read | "Couldn't load your designs." plus the service's own sentence, with **Try again** |
| A refresh fails while rows are showing | the rows stay and the notice sits above them |

### When it reads

Once when it opens, then on the change feed (a long-poll the frame shares the rules of with the rail:
no timer polls anything): a `reset`, or an event of kind `added`, `removed`, `design`, `files`, `comments`,
`checks`, `activity` or `root`, debounced 250 ms. Also when the chat or the project folder changes, and
when the feed comes back after an outage. The only timer is a one-off 10 s deadline that turns "starting"
into "isn't responding". The frame passes the project folder exactly as the host gives it, and the chat id,
so this chat's design is listed first.

### Size and look

The frame reports its content height to the host (`setHeight`, from a `ResizeObserver`); the host clamps
it to 24 to 320 px and the section scrolls past that. Colours, type and radius come from the host theme
tokens and the SDK kit's classes, on the Work Status panel colour; a theme switch repaints live. Under
about 340 px wide the buttons stay on the title's row and the meta line takes the full width, so five
rows and the footer fit in 320 px at 280 px wide. Checked in the visual harness at 280 and 400 px, light
and dark (`test/ui/visual/scenarios/work-status.mjs`). "Starting", "isn't responding" and "paused" cannot be
produced there (they come from a host error, which a route override cannot send), so their words and
rules are pinned in `test/ui/status-model.test.ts` and they are not yet seen on screen.

### Where the code is

- `src/ui/status/main.ts`, `status.css`, `index.html`: the frame.
- `src/ui/model/status-model.ts`: row and section view models, the refetch rule.
- `test/ui/status-model.test.ts`, `test/ui/visual/scenarios/work-status.mjs`.
