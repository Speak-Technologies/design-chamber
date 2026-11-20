// Visual harness only: an in-memory folders registry (Phase 2.5 G1) behind the `/folders` routes, with hooks so a
// scenario can seed folders, make the list fail to load, and play another window changing a folder. The real rules
// (names, caps, soft delete, pruning) are the service's (test/service/folders*.test.ts); this behaves the same way
// for the list.

import type { CreateFolderBody, DeleteFolderResponse, FolderDesignsBody, FolderListResponse, FolderResponse, FolderView, PatchFolderBody } from '../../../src/shared/api.ts';
import { FOLDER_NAME_MAX, FOLDERS_MAX } from '../../../src/shared/limits.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

type Rec = FolderView & { deleted: boolean };
type Req = { params: Record<string, string> };

export type FakeFolders = {
  handlers: {
    'GET /folders': () => FolderListResponse;
    'POST /folders': (req: { body: CreateFolderBody }) => FolderResponse;
    'PATCH /folders/:folderId': (req: Req & { body: PatchFolderBody }) => FolderResponse;
    'DELETE /folders/:folderId': (req: Req) => DeleteFolderResponse;
    'POST /folders/:folderId/undelete': (req: Req) => FolderResponse;
    'POST /folders/:folderId/designs': (req: Req & { body: FolderDesignsBody }) => FolderResponse;
  };
  hooks: {
    /** Add a folder with these members (no event). Returns its id. */
    seed: (name: string, slugs: string[]) => string;
    /** The next `GET /folders` answers a failure once per call until `false`. */
    failLoads: (fail: boolean) => void;
    /** The members of a folder now. */
    members: (id: string) => string[];
    /** Another window added a design to a folder: a `folders` event says so. */
    addElsewhere: (id: string, slug: string) => void;
  };
};

const view = (rec: Rec): FolderView => ({ id: rec.id, name: rec.name, created: rec.created, slugs: [...rec.slugs] });

export const createFakeFolders = (deps: { emit: (slug: string | null, kind: ChangeEvent['kind']) => void; exists: (slug: string) => boolean }): FakeFolders => {
  const recs: Rec[] = [];
  let failing = false;
  let n = 0;
  const live = (): Rec[] => recs.filter((rec) => !rec.deleted);
  const find = (id: string | undefined): Rec => {
    const rec = recs.find((entry) => entry.id === id && !entry.deleted);
    if (!rec) throw new ServiceError('not-found', "That folder isn't there any more.");
    return rec;
  };
  const checkName = (raw: string, ignore: string | null): string => {
    const name = raw.normalize('NFKC').trim();
    if (name === '') throw new ServiceError('bad-request', 'Give the folder a name.');
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) throw new ServiceError('bad-request', "A folder name can't contain line breaks or tabs.");
    if (name.length > FOLDER_NAME_MAX) throw new ServiceError('bad-request', `Keep the folder name to ${FOLDER_NAME_MAX} characters or fewer.`);
    const taken = live().find((rec) => rec.id !== ignore && rec.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new ServiceError('conflict', `You already have a folder called ${taken.name}.`);
    return name;
  };
  const make = (name: string, slugs: string[]): Rec => {
    n += 1;
    const rec: Rec = { id: `f_${String(n).padStart(10, '0')}`, name, created: new Date().toISOString(), slugs, deleted: false };
    recs.push(rec);
    return rec;
  };

  return {
    handlers: {
      'GET /folders': () => {
        if (failing) throw new ServiceError('internal', 'The folders list could not be read.');
        return { folders: live().map((rec) => view({ ...rec, slugs: rec.slugs.filter((slug) => deps.exists(slug)) })) };
      },
      'POST /folders': ({ body }) => {
        const name = checkName(body.name, null);
        if (live().length >= FOLDERS_MAX) throw new ServiceError('conflict', `You can have up to ${FOLDERS_MAX} folders.`);
        const rec = make(name, []);
        deps.emit(null, 'folders');
        return { folder: view(rec) };
      },
      'PATCH /folders/:folderId': ({ params, body }) => {
        const rec = find(params.folderId);
        rec.name = checkName(body.name, rec.id);
        deps.emit(null, 'folders');
        return { folder: view(rec) };
      },
      'DELETE /folders/:folderId': ({ params }) => {
        const rec = find(params.folderId);
        rec.deleted = true;
        deps.emit(null, 'folders');
        return { ok: true, designs: rec.slugs.filter((slug) => deps.exists(slug)).length };
      },
      'POST /folders/:folderId/undelete': ({ params }) => {
        const rec = recs.find((entry) => entry.id === params.folderId && entry.deleted);
        if (!rec) throw new ServiceError('not-found', "That folder can't be brought back any more.");
        rec.deleted = false;
        deps.emit(null, 'folders');
        return { folder: view(rec) };
      },
      'POST /folders/:folderId/designs': ({ params, body }) => {
        const rec = find(params.folderId);
        const next = rec.slugs.filter((slug) => !(body.remove ?? []).includes(slug));
        for (const slug of body.add ?? []) if (deps.exists(slug) && !next.includes(slug)) next.push(slug);
        rec.slugs = next;
        deps.emit(null, 'folders');
        return { folder: view(rec) };
      },
    },
    hooks: {
      seed: (name, slugs) => make(name, slugs).id,
      failLoads: (fail) => {
        failing = fail;
      },
      members: (id) => [...(recs.find((rec) => rec.id === id)?.slugs ?? [])],
      addElsewhere: (id, slug) => {
        const rec = find(id);
        if (!rec.slugs.includes(slug)) rec.slugs.push(slug);
        deps.emit(null, 'folders');
      },
    },
  };
};
