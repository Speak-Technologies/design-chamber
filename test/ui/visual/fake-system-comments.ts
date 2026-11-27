// Visual harness only (system-builder-depth T21): board comments of a design system in memory, behind the five comment
// routes and the prompt's `comments` purpose. Every write sends the `comments` change, as the service does after its save.
// Harbor starts with three comments (one on a component, one on a token, one on an entry that's gone), the others with none.

import type {
  CreateSystemCommentBody,
  MarkSystemCommentsSentBody,
  MarkSystemCommentsSentResponse,
  OkResponse,
  PatchSystemCommentBody,
  SystemCommentResponse,
  SystemCommentsResponse,
  SystemPromptResponse,
} from '../../../src/shared/api.ts';
import { COMMENT_BODY_MAX } from '../../../src/shared/limits.ts';
import { isBoardEntryKey } from '../../../src/shared/system-board.ts';
import type { SystemComment } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

type Req = { params: Record<string, string> };

export type FakeSystemComments = {
  handlers: {
    'GET /systems/:id/comments': (req: Req) => SystemCommentsResponse;
    'POST /systems/:id/comments': (req: Req & { body: CreateSystemCommentBody }) => SystemCommentResponse;
    'PATCH /systems/:id/comments/:commentId': (req: Req & { body: PatchSystemCommentBody }) => SystemCommentResponse;
    'DELETE /systems/:id/comments/:commentId': (req: Req) => OkResponse;
    'POST /systems/:id/comments/mark-sent': (req: Req & { body: MarkSystemCommentsSentBody }) => MarkSystemCommentsSentResponse;
  };
  /** Adds `comments: { commentIds, omitted }` to a `comments` prompt, as the service does (every open one, or the named open ones). */
  prompt: (id: string, commentIds: string[] | undefined, answer: SystemPromptResponse) => SystemPromptResponse;
  hooks: {
    /** The system's comments from now on (`damaged`: the file reads as damaged), then a `comments` change. */
    seed: (id: string, comments: SystemComment[], damaged?: boolean) => void;
    /** `GET /systems/:id/comments` answers a failure until `false`. */
    failList: (fail: boolean) => void;
    /** Writes answer this sentence until `null`. */
    failWrites: (message: string | null) => void;
    /** The comments as stored now, for a scenario's checks. */
    current: (id: string) => SystemComment[];
    /** The ids every mark-sent was asked for, oldest first. */
    marked: () => string[][];
  };
};

const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const sample = (): Map<string, SystemComment[]> =>
  new Map([
    [
      'harbor',
      [
        { id: 'c_harbor01', entry: 'component:button', body: 'The primary button reads heavy next to the cards. Try the softer radius.', status: 'open', created: at(90), sentAt: null },
        { id: 'c_harbor02', entry: 'token:--brand', body: 'Brand blue fails contrast on the dark ground. Lift it a step.', status: 'open', created: at(60), sentAt: null },
        { id: 'c_harbor03', entry: 'component:legacy-tabs', body: 'Do we still need these tabs?', status: 'sent', created: at(40), sentAt: at(30) },
      ],
    ],
  ]);

export const createFakeSystemComments = (deps: { emitComments: (system: string) => void; exists: (id: string) => boolean }): FakeSystemComments => {
  const book = sample();
  const damaged = new Set<string>();
  let listFailing = false;
  let writeFailure: string | null = null;
  const marked: string[][] = [];
  let n = 100;

  const of = (id: string | undefined): SystemComment[] => {
    if (id === undefined || !deps.exists(id)) throw new ServiceError('not-found', 'That design system is no longer in your Designs folder.');
    return book.get(id) ?? [];
  };
  const write = (id: string, next: SystemComment[]): void => {
    if (writeFailure !== null) throw new ServiceError('internal', writeFailure);
    book.set(id, next);
    damaged.delete(id);
    deps.emitComments(id);
  };
  const find = (id: string, commentId: string | undefined): SystemComment => {
    const found = of(id).find((comment) => comment.id === commentId);
    if (!found) throw new ServiceError('not-found', 'That comment is gone.');
    return found;
  };
  const checkBody = (body: unknown): string => {
    if (typeof body !== 'string' || body.trim() === '' || body.length > COMMENT_BODY_MAX) throw new ServiceError('invalid', `A comment needs 1 to ${COMMENT_BODY_MAX} characters.`);
    return body.trim();
  };

  return {
    handlers: {
      'GET /systems/:id/comments': ({ params }) => {
        if (listFailing) throw new ServiceError('internal', 'The comments file couldn’t be read.');
        const comments = of(params.id);
        return params.id !== undefined && damaged.has(params.id) ? { comments, damaged: true } : { comments };
      },
      'POST /systems/:id/comments': ({ params, body }) => {
        const id = params.id ?? '';
        if (!isBoardEntryKey(body.entry)) throw new ServiceError('invalid', 'That isn’t an entry on the board.');
        n += 1;
        const comment: SystemComment = { id: `c_new${n}`, entry: body.entry, body: checkBody(body.body), status: 'open', created: new Date().toISOString(), sentAt: null };
        write(id, [...of(id), comment]);
        return { comment };
      },
      'PATCH /systems/:id/comments/:commentId': ({ params, body }) => {
        const id = params.id ?? '';
        const before = find(id, params.commentId);
        const next: SystemComment = { ...before, ...(body.body !== undefined ? { body: checkBody(body.body) } : {}), ...(body.status !== undefined ? { status: body.status } : {}) };
        write(id, of(id).map((comment) => (comment.id === next.id ? next : comment)));
        return { comment: next };
      },
      'DELETE /systems/:id/comments/:commentId': ({ params }) => {
        const id = params.id ?? '';
        find(id, params.commentId);
        write(id, of(id).filter((comment) => comment.id !== params.commentId));
        return { ok: true };
      },
      'POST /systems/:id/comments/mark-sent': ({ params, body }) => {
        const id = params.id ?? '';
        marked.push([...body.ids]);
        const now = new Date().toISOString();
        const next = of(id).map((comment) => (body.ids.includes(comment.id) && comment.status === 'open' ? { ...comment, status: 'sent' as const, sentAt: comment.sentAt ?? now } : comment));
        write(id, next);
        return { comments: next };
      },
    },
    prompt: (id, commentIds, answer) => {
      const open = of(id).filter((comment) => comment.status === 'open' && (commentIds === undefined || commentIds.includes(comment.id)));
      if (open.length === 0) throw new ServiceError('invalid', commentIds === undefined ? 'There are no open comments to send.' : 'None of those comments are open any more.');
      return { ...answer, text: `[Design Chamber] Comments on the board of ${id}:\n${open.map((comment) => `- ${comment.entry}: ${comment.body}`).join('\n')}`, comments: { commentIds: open.map((comment) => comment.id), omitted: [] } };
    },
    hooks: {
      seed: (id, comments, isDamaged = false) => {
        book.set(id, comments.map((comment) => ({ ...comment })));
        if (isDamaged) damaged.add(id);
        else damaged.delete(id);
        deps.emitComments(id);
      },
      failList: (fail) => {
        listFailing = fail;
      },
      failWrites: (message) => {
        writeFailure = message;
      },
      current: (id) => book.get(id) ?? [],
      marked: () => marked,
    },
  };
};

