// The one door for sending comments to the chat from the UI: the drawer's batch button and row
// buttons and the thread card's "Send this" all come through here. It reports the result as a
// toast and keeps a single flight per comment id, so two buttons can never send the same comment.

import type { AnchorState } from '../../shared/types.ts';
import { flows, store } from '../guest.ts';
import { pinNumbers, sendResultCopy, sendThisProblem } from '../model/comments-model.ts';
import { createListeners } from '../model/listeners.ts';
import { toast } from './actions.ts';

const inFlight = new Set<string>();
const changes = createListeners();

/** A send that includes this comment is under way. */
export const isSending = (id: string): boolean => inFlight.has(id);

/** Called when a send starts or ends, so a button that shows the state can repaint. */
export const onSendingChange = changes.add;

/**
 * Send these comments to the design's linked chat and tell the user how it went. Throws what the
 * flow or service said (a sentence for `errorText`) when it could not send; nothing is marked sent
 * then, so the caller keeps the comments and can offer to try again.
 */
export const sendComments = async (slug: string, ids: string[], anchorStates: Record<string, AnchorState>): Promise<void> => {
  const busy = ids.find((id) => inFlight.has(id));
  if (busy !== undefined) throw new Error(ids.length === 1 ? 'That comment is already on its way to the chat.' : 'One of these comments is already on its way. Try again in a moment.');
  const states = Object.fromEntries(Object.entries(anchorStates).filter(([id]) => ids.includes(id)));
  for (const id of ids) inFlight.add(id);
  changes.emit();
  try {
    const result = await flows.sendComments(slug, ids, states);
    // The change feed brings the new statuses anyway; a failed refresh must not read as a failed send.
    await store.refreshOpenDesign().catch(() => undefined);
    const open = store.getState().open;
    const numbers = open?.slug === slug && open.data ? pinNumbers(open.data.design.comments) : null;
    const copy = sendResultCopy(result, ids.length === 1 ? (numbers?.get(ids[0] ?? '') ?? null) : null);
    if (copy) toast(copy.kind, copy.message);
  } finally {
    for (const id of ids) inFlight.delete(id);
    changes.emit();
  }
};

/**
 * "Send this" on a thread card: send one open comment, saving an edited text first. The card can be
 * older than the comment (it was sent from the list meanwhile) and the service would send a named
 * comment whatever its status, so the current status is checked here, before anything is saved.
 */
export const sendOneComment = async (slug: string, id: string, body: string, anchorStates: Record<string, AnchorState>): Promise<void> => {
  const open = store.getState().open;
  const comments = open?.slug === slug ? open.data?.design.comments : undefined;
  const current = comments?.find((comment) => comment.id === id);
  if (comments !== undefined) {
    const problem = sendThisProblem(current);
    if (problem !== null) throw new Error(problem);
  }
  if (current !== undefined && body.trim() !== current.body.trim()) await store.updateComment(slug, id, { body });
  await sendComments(slug, [id], anchorStates);
};
