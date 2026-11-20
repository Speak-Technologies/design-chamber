// Sending a message about one design system to its chat (Phase 2.5 U2): the ask bar, "Needs work" and
// "Continue in chat". The service writes the message and its chip (`POST /systems/:id/prompt`); this file
// puts it where the user is looking: the linked chat when it is the selected one, the linked chat through
// the outbox when it is another (the rail delivers after `openSession`), a new linked chat otherwise.

import type { AttachIssueRequest } from '@openchamber/sdk';

import type { SystemPromptBody } from '../../shared/api.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import type { Chip } from '../../shared/types.ts';
import { isHostError, PANEL_SURFACE_ID, type AskOutcome } from '../../guest/flows.ts';
import { client, guestHost } from '../guest.ts';

const attachOf = (chip: Chip): AttachIssueRequest => ({ providerId: chip.providerId, id: chip.id, title: chip.title, url: chip.url, text: chip.text, data: { ...chip.data } });

export const NO_PROJECT_SENTENCE = 'Open a project first, then try again.';
export const NOT_SENT_SENTENCE = 'The message didn’t reach a chat.';

export type SystemChat = { sessionId: string | null };

const projectIdFor = async (directory: string | null): Promise<string | undefined> => {
  if (!directory) return undefined;
  try {
    const { projects } = await guestHost.client.listProjects();
    return projects.find((project) => sameDirectory(project.directory, directory))?.id;
  } catch {
    return undefined;
  }
};

const linkSession = async (id: string, sessionId: string): Promise<void> => {
  try {
    await client.call('PATCH /systems/:id', { params: { id }, body: { sessionId } });
  } catch (error) {
    console.warn('Design Chamber: the design system could not be linked to its chat', error);
  }
};

/**
 * Deliver `body` about system `id`. Resolves with how it went; rejects with a sentence the ask bar shows
 * under the box (the user's words stay in it).
 */
export const sendSystemMessage = async (id: string, chat: SystemChat, body: SystemPromptBody): Promise<AskOutcome> => {
  const api = guestHost.client;
  const prompt = await client.call('POST /systems/:id/prompt', { params: { id }, body });
  const selected = guestHost.session.get();
  let outcome: AskOutcome;

  if (chat.sessionId && selected?.id === chat.sessionId) {
    try {
      if (selected.busy) {
        await api.compose({ text: prompt.text, mode: 'append' });
        outcome = 'composed';
      } else {
        const result = await api.prompt({ text: prompt.text, send: true });
        if (result.sent !== 'sent') throw new Error(NOT_SENT_SENTENCE);
        outcome = 'sent';
      }
    } catch (error) {
      if (!isHostError(error, 'SESSION_BUSY')) throw error;
      await api.compose({ text: prompt.text, mode: 'append' });
      outcome = 'composed';
    }
  } else {
    let delivered: AskOutcome | null = null;
    if (chat.sessionId) {
      await client.call('PUT /outbox', { body: { sessionId: chat.sessionId, slug: id, system: id, text: prompt.text, commentIds: [], version: null } });
      try {
        await api.openSurface(PANEL_SURFACE_ID);
      } catch {
        // The rail may already be open or unavailable here; openSession still selects the chat.
      }
      try {
        await api.openSession(chat.sessionId);
        delivered = 'outbox';
      } catch (error) {
        if (!isHostError(error, 'NO_SESSION')) throw error;
        await client.call('DELETE /outbox');
      }
    }
    if (delivered === null) {
      const projectId = (await projectIdFor(guestHost.directory.get())) ?? undefined;
      if (!projectId && !guestHost.directory.get()) throw new Error(NO_PROJECT_SENTENCE);
      const started = await api.startSession({ ...attachOf(prompt.chip), text: prompt.text, navigation: 'open', ...(projectId ? { projectId } : {}) });
      if (started.sessionId === null || started.sent !== 'sent') throw new Error(NOT_SENT_SENTENCE);
      await linkSession(id, started.sessionId);
      delivered = 'new-session';
    }
    outcome = delivered;
  }

  if (prompt.handEdits) {
    try {
      await client.call('POST /systems/:id/hand-edits/clear', { params: { id }, body: { upTo: prompt.handEdits.upTo } });
    } catch (error) {
      console.warn('Design Chamber: the hand-edit ledger could not be cleared after the message was delivered', error);
    }
  }
  return outcome;
};
