# Sidebar marks on design chats

**What it does:** every chat that has a design gets a small palette mark on its row in
OpenChamber's sidebar, so the user can see which chats made designs and which of them still want
attention, without opening Design Chamber.

Needs OpenChamber 2.8.0 or later. The approval dialog shows its own line, "Show marks in the
sidebar".

## What the user sees

| The chat's designs | Mark | Tooltip |
|---|---|---|
| One design, nothing waiting | neutral | Design Chamber: Pricing |
| Check errors, or comments added and not sent | warning | Design Chamber: Pricing: 1 check error, 3 comments not sent |
| Several designs in one chat | one mark, warning when any of them has either | Design Chamber: Pricing and 2 other designs |

- OpenChamber adds "Design Chamber: " to the tooltip. The title is the newest design's.
- Check **warnings** and notes do not turn a mark to warning. Only errors and unsent comments do.
- The counts are added up over all the chat's designs. A long title is cut so the whole tooltip
  fits in 200 characters.
- Clicking a mark opens Design Chamber's panel in that chat.
- Design system chats (`/design-system`) get no mark.
- With more than 200 design chats, the 200 with the newest designs are marked.

## When it changes
- A comment added or sent, a design added, deleted, renamed or moved to another chat, or the
  designs folder changed: about 2 seconds. When reading the designs list takes longer than that
  (a large or slow folder), the marks follow about 2 seconds after the list has been read.
- Check errors: a design's checks are read again only after it has been quiet for 5 seconds and
  its chat is not working, so a mark does not flicker while the agent is writing. The turn's end
  triggers the read.
- At most 50 mark changes go out a minute, newest chats first, and only marks that differ are
  sent. After a fresh start with 200 design chats, the last ones appear after about 4 minutes.

## Rules and edge cases
- Marks are not saved anywhere. They last as long as the local service runs, and a restart sets
  them again from the files. Pausing or removing the extension removes them.
- A check that cannot be read within 5 seconds keeps the design's last count. A mark never turns
  to warning because a read failed.
- If OpenChamber refuses (the update is not approved yet, or the extension is paused), no more
  marks are sent until the service starts again. If it says it is being asked too often, sending
  waits a minute. If it does not answer, the next change tries again.
- Without a way to reach OpenChamber, the service logs that once and works as usual.
- Design titles are written by the agent. They reach OpenChamber only as plain tooltip text, on
  one line and without characters that reorder text. A mark carries no link, and logs carry no
  titles.

## Data
Reads the service's list of designs (title, linked chat, unsent comments) and each linked
design's check errors. Writes nothing to disk; the only output is the mark sent to OpenChamber
for a chat.

## Where it lives
`src/service/session-marks.ts`, `setMark` in `src/service/host-calls.ts`, wired in
`src/service/compose.ts`. Tests: `test/service/core/session-marks.test.ts`,
`test/service/core/host-calls.test.ts`, `test/service/integration/compose.test.ts`.
