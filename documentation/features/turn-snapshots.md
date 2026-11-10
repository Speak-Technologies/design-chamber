# Turn snapshots from session events

**What it does:** After every agent turn in a chat that a design is linked to, Design Chamber saves a "turn" version of that design, even when no Design Chamber window is open. The Versions drawer shows it like any other turn version. Failed turns get one too, because that is when a restore is most useful.

Why it exists: before OpenChamber 2.7, turn versions were only saved by an open rail or page that saw the turn end. A user who chatted with the agent and never opened Design Chamber had only the quiet-period auto versions to go back to.

## How it works
OpenChamber tells the Design Chamber service when a turn starts, finishes or fails, for chats in every project (`contributes.sessionEvents` in the manifest, identifiers only: Design Chamber never asks for or sees the messages). The first event starts the service if it is not running.

1. The service answers OpenChamber straight away (`{ ok: true }`), before doing anything with the event. A slow answer or an error would make OpenChamber pause all deliveries for 30 seconds.
2. A subagent's event (a chat started by another chat) is dropped. Its parent chat's own "turn finished" comes after it.
3. The service remembers what each chat's agent is doing (working, done, failed). Work Status uses this. A "working" chat that has been silent for 30 minutes reads as unknown, because a turn the user stops sends no event.
4. It looks the chat up in its in-memory list of designs. A chat no design is linked to stops here, without reading any design folder. This is the common case: most events come from chats that have nothing to do with designs.
5. For every design linked to the chat it tells open views to refresh, and after a finished or failed turn it saves a turn version of each of them.

## The cold-start case
If the agent worked for longer than 10 minutes, the service may have stopped for being idle, and the "turn finished" event is what starts it again. Its list of designs may not have loaded yet. The service waits up to 5 seconds for the list. If it is still not ready, it saves the turn versions anyway by reading the designs folder directly. The version is not lost; it costs one walk of the folder.

## No duplicates
The open rail or page still saves its own turn version when it sees a turn end (it catches turns whose event OpenChamber dropped during a pause). Both paths go through the same version service, which saves one version per chat per turn: a second request within 2 seconds is ignored, and a design whose files have not changed since its last version gets no new one. If a quiet-period auto version already holds the turn's files, it is relabelled as the turn version instead.

## Designs no chat is linked to
They get no turn versions; the quiet-period auto versions still happen. Design Chamber does not guess which chat wrote a design: linking is done when the design is created from a chat, or by the user.

## Limits and safety
- At most 64 chats wait for work at once. A newer event for a chat already waiting replaces it in place (a pending turn version is kept). When the queue is full the oldest waiting chat is dropped, with one warning in the service log per overflow.
- Turn versions are saved one at a time.
- The activity list keeps at most 500 chats; the one with the oldest event is dropped.
- Logs carry only the event type and the first 8 characters of the chat's id, never anything else from the event.
- The route is behind the service's bearer token like every other route. A body that is not a session event is refused with HTTP 400; an event of a type Design Chamber did not ask for, or with a chat id it would not keep (empty, over 128 characters, control characters), is answered `{ ok: true }` and ignored.

## Where it lives
- `src/service/routes/session-events.ts`: the route (reads the body with the SDK's `readSessionEventRequest`).
- `src/service/turn-events.ts`: the queue and the worker.
- `src/service/activity.ts`: what each chat's agent is doing.
- `src/service/versions.ts` `turn(sessionId)`: the snapshot itself, shared with `POST /versions/turn`.
- Spec: `documentation/specs/phase-1-5-sdk-2-7.md` §U4; `docs/SPEC.md` §9.11, §10.6.
