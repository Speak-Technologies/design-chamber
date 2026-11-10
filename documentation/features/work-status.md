# Work Status

Status: Phase 1.5 (U5). The service half is built; the frame (UI half) is not yet.
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

_To be written by the UI developer with the status frame (T11): what the section looks like, its
states (loading, empty, starting, paused, error), the buttons and their toasts, and how it was
checked at the Work Status width._
