// Making a design system from the New design system sheet (Phase 2.5 U1, technical design §9.1 `makeSystem`):
// create the Draft, add the brand files one at a time, then ask the chat agent to write the rest. Only the
// creation can fail the whole thing (the sheet keeps its input and says why); once the system exists every
// later problem is a line in the result (a refused file, "Couldn't ask the agent") and the system stays a
// Draft with what was gathered. Repo-backed systems are made here only by "Register it as it is"
// (Phase 2.6 AD-10: a folder already in Design Chamber's format, read-only); `/design-system` builds the rest.

import type { AttachIssueRequest } from '@openchamber/sdk';

import type { Chip } from '../shared/types.ts';
import { sameDirectory } from '../shared/path-compare.ts';
import type { AssetsFromFolderResponse, CreateSystemBody } from '../shared/api.ts';
import type { GuestHost } from './host.ts';
import { isHostError } from './flows.ts';
import { toServiceError, type ServiceClient } from './service-client.ts';

export type MakeDestination = 'new-chat' | 'current-chat';

export type BrandUpload = { file: Blob; name: string; kind: 'font' | 'logo' | 'source' };

export type MakeSystemInput = {
  name: string;
  /** A finished scan and the project files ticked to copy in. `directory` picks the chat's project. */
  code: { scanId: string; assets: string[]; directory: string } | null;
  description: { text: string; preset: string | null } | null;
  /** Files read in the sheet and a folder the service reads from; both optional. */
  brand: { files: BrandUpload[]; folder: string | null } | null;
  destination: MakeDestination;
};

/** Where the work is, for the sheet's progress line. */
export type MakeStep =
  | { phase: 'creating' }
  | { phase: 'files'; done: number; total: number; name: string }
  | { phase: 'folder' }
  | { phase: 'asking' };

/** `sent` and `composed` and `new-session` reached a chat; `not-sent` did not (`reason` says why, `text` is the request to copy when there is one). */
export type AskOutcome = { outcome: 'sent' | 'composed' | 'new-session' | 'not-sent'; sessionId: string | null; reason: string | null; text: string | null };

export type MakeSystemResult = {
  id: string;
  name: string;
  files: { added: string[]; refused: Array<{ name: string; reason: string }> };
  agent: AskOutcome;
};

export type AskToMakeInput = { id: string; destination: MakeDestination; directory: string | null };

/** "Register it as it is" (Phase 2.6 AD-10): the done location scan of a complete system folder, and its name. */
export type RegisterSystemInput = { scanId: string; name: string };

export type MakeSystem = {
  make(input: MakeSystemInput, onStep?: (step: MakeStep) => void): Promise<MakeSystemResult>;
  /** The delivery step on its own: "Try again" after a request that didn't reach a chat. Never throws. */
  askToMake(input: AskToMakeInput): Promise<AskOutcome>;
  /**
   * One call, no agent request, no chat: the system is registered read-only from what the scan read.
   * Rejects with the service's sentence when it can't be (nothing is made then; the sheet keeps its input).
   */
  register(input: RegisterSystemInput): Promise<{ id: string; name: string }>;
};

export const MAKE_MESSAGES = {
  noProject: 'Open a project first, then try again.',
  noChat: 'No chat is open right now. Choose New chat, or open one first.',
  notSent: 'The request didn’t reach a chat.',
} as const;

/** Our chip as the SDK's attach request; its `data` is the chip's own (`{ system: id }`). */
const attachOf = (chip: Chip): AttachIssueRequest => ({ providerId: chip.providerId, id: chip.id, title: chip.title, url: chip.url, text: chip.text, data: { ...chip.data } });

const reasonOf = (error: unknown): string => {
  const text = toServiceError(error).message;
  return text.endsWith('.') || text.endsWith('?') || text.endsWith('!') ? text : `${text}.`;
};

export const createMakeSystem = ({ host, client }: { host: GuestHost; client: ServiceClient }): MakeSystem => {
  const api = host.client;

  const projectIdFor = async (directory: string | null): Promise<string | undefined> => {
    if (!directory) return undefined;
    try {
      const { projects } = await api.listProjects();
      return projects.find((project) => sameDirectory(project.directory, directory))?.id;
    } catch {
      // Without the project list a new chat falls back to the current project.
      return undefined;
    }
  };

  const askToMake = async ({ id, destination, directory }: AskToMakeInput): Promise<AskOutcome> => {
    const notSent = (reason: string, text: string | null = null): AskOutcome => ({ outcome: 'not-sent', sessionId: null, reason, text });
    let prompt: { text: string; chip: Chip };
    try {
      prompt = await client.call('POST /systems/:id/prompt', { params: { id }, body: { purpose: 'make' } });
    } catch (error) {
      return notSent(reasonOf(error));
    }
    try {
      if (destination === 'new-chat') {
        // The scanned project's chat when the host knows it, else the current project (technical design §9.1).
        const projectId = (await projectIdFor(directory)) ?? (await projectIdFor(host.directory.get()));
        if (!projectId && !host.directory.get()) return notSent(MAKE_MESSAGES.noProject, prompt.text);
        const started = await api.startSession({ ...attachOf(prompt.chip), text: prompt.text, navigation: 'open', ...(projectId ? { projectId } : {}) });
        if (started.sessionId === null) return notSent(MAKE_MESSAGES.notSent, prompt.text);
        await linkSession(id, started.sessionId);
        return { outcome: 'new-session', sessionId: started.sessionId, reason: null, text: null };
      }
      const session = host.session.get();
      if (!session) return notSent(MAKE_MESSAGES.noChat, prompt.text);
      await api.attach(attachOf(prompt.chip));
      await api.compose({ text: prompt.text, mode: 'append' });
      await linkSession(id, session.id);
      return { outcome: 'composed', sessionId: session.id, reason: null, text: null };
    } catch (error) {
      if (isHostError(error, 'NO_SESSION')) return notSent(MAKE_MESSAGES.noChat, prompt.text);
      return notSent(reasonOf(error), prompt.text);
    }
  };

  /** The system remembers its chat. A failure here only costs "Continue in chat" later, never the request already sent. */
  const linkSession = async (id: string, sessionId: string): Promise<void> => {
    try {
      await client.call('PATCH /systems/:id', { params: { id }, body: { sessionId } });
    } catch (error) {
      console.warn('Design Chamber: the new design system could not be linked to its chat', error);
    }
  };

  const make: MakeSystem['make'] = async (input, onStep = () => undefined) => {
    onStep({ phase: 'creating' });
    const body: CreateSystemBody = { name: input.name };
    if (input.code) body.code = { scanId: input.code.scanId, assets: input.code.assets };
    if (input.description) body.description = input.description;
    if (input.brand) body.brand = true;
    // A failure here rejects: nothing was made, and the sheet keeps what the user typed.
    const created = await client.call('POST /systems', { body });
    const { id } = created;
    const name = created.system.name;

    const files: MakeSystemResult['files'] = { added: [], refused: [] };
    if (input.brand) {
      const total = input.brand.files.length;
      for (const [index, upload] of input.brand.files.entries()) {
        onStep({ phase: 'files', done: index, total, name: upload.name });
        try {
          const uploadId = await client.uploadBinary(upload.file);
          const added = await client.call('POST /systems/:id/assets', { params: { id }, body: { uploadId, name: upload.name, kind: upload.kind } });
          files.added.push(added.asset.file);
        } catch (error) {
          files.refused.push({ name: upload.name, reason: reasonOf(error) });
        }
      }
      if (input.brand.folder) {
        onStep({ phase: 'folder' });
        try {
          const answer: AssetsFromFolderResponse = await client.call('POST /systems/:id/assets/from-folder', { params: { id }, body: { directory: input.brand.folder } });
          files.added.push(...answer.added.map((entry) => entry.file));
          files.refused.push(...answer.refused.map((entry) => ({ name: entry.name, reason: entry.reason })));
        } catch (error) {
          files.refused.push({ name: input.brand.folder, reason: reasonOf(error) });
        }
      }
    }

    onStep({ phase: 'asking' });
    const agent = await askToMake({ id, destination: input.destination, directory: input.code?.directory ?? null });
    return { id, name, files, agent };
  };

  const register: MakeSystem['register'] = async ({ scanId, name }) => {
    const created = await client.call('POST /systems/register', { body: { scanId, name } });
    return { id: created.id, name: created.system.name };
  };

  return { make, askToMake, register };
};
