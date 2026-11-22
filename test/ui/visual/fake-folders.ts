// Visual harness only: an in-memory folders registry (Phase 2.5 G1) behind the `/folders` routes, with hooks so a
// scenario can seed folders, make the list fail to load, and play another window changing a folder. The real rules
// (names, caps, soft delete, pruning) are the service's (test/service/folders*.test.ts); this behaves the same way
// for the list.
//
// Phase 2.6 F2 (marked below): manual project members, the POST /memberships batch (atomic or best effort) and
// chip filing, with the service's sentences. The real validation lives in src/service/folders.ts (F1).

import type { ChipFiling, CreateFolderBody, DeleteFolderResponse, FolderDesignsBody, FolderListResponse, FolderResponse, FolderView, MembershipChange, MembershipResult, MembershipsResponse, PatchFolderBody, ProjectMembersView } from '../../../src/shared/api.ts';
import { FOLDER_DESIGNS_MAX, FOLDER_NAME_MAX, FOLDERS_MAX, PROJECT_ENTRIES_MAX } from '../../../src/shared/limits.ts';
import { sameDirectory } from '../../../src/shared/path-compare.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

type Rec = FolderView & { deleted: boolean };
type ProjectRec = { directory: string; slugs: string[] };
type Req = { params: Record<string, string> };

const FOLDER_GONE = "That folder isn't there any more.";
const FOLDER_DESIGNS_FULL = `A folder can hold up to ${FOLDER_DESIGNS_MAX.toLocaleString('en-US')} designs.`;
const PROJECT_UNUSABLE = "That project folder can't be used.";
const PROJECTS_FULL = `You can file designs under up to ${PROJECT_ENTRIES_MAX} projects.`;

export type FakeFolders = {
  handlers: {
    'GET /folders': () => FolderListResponse;
    'POST /folders': (req: { body: CreateFolderBody }) => FolderResponse;
    'PATCH /folders/:folderId': (req: Req & { body: PatchFolderBody }) => FolderResponse;
    'DELETE /folders/:folderId': (req: Req) => DeleteFolderResponse;
    'POST /folders/:folderId/undelete': (req: Req) => FolderResponse;
    'POST /folders/:folderId/designs': (req: Req & { body: FolderDesignsBody }) => FolderResponse;
    /** F2: one queued batch for folders and projects; atomic throws the first failure, best effort answers per target. */
    'POST /memberships': (req: { body: { changes: MembershipChange[]; atomic?: boolean } }) => MembershipsResponse;
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
    /** F2: seed a project's manual members (no event). */
    seedProject: (directory: string, slugs: string[]) => void;
    /** F2: the manual members of a project now. */
    projectMembers: (directory: string) => string[];
    /** F2: another window deleted a folder (the filing "gone" case). */
    deleteElsewhere: (id: string) => void;
    /** F2: tell the frame the registry changed (after seeding, which is silent). */
    changed: () => void;
    /** F2: the next POST /memberships fails once with this message (Move's refusal, a tick's failure). */
    failNextMemberships: (message: string) => void;
    /** F2: the next chip filing fails every target once with this message (the notice + Try again). */
    failNextFiling: (message: string) => void;
  };
  /** F2: file a freshly made design (POST /chip's filing); best effort, one result per target. */
  fileDesign: (slug: string, filing: ChipFiling | undefined) => { results: MembershipResult[] } | undefined;
};

const view = (rec: Rec): FolderView => ({ id: rec.id, name: rec.name, created: rec.created, slugs: [...rec.slugs] });

export const createFakeFolders = (deps: { emit: (slug: string | null, kind: ChangeEvent['kind']) => void; exists: (slug: string) => boolean }): FakeFolders => {
  const recs: Rec[] = [];
  const projects: ProjectRec[] = [];
  let failing = false;
  let membershipsFailure: string | null = null;
  let filingFailure: string | null = null;
  let n = 0;
  const live = (): Rec[] => recs.filter((rec) => !rec.deleted);
  const liveProjects = (): ProjectMembersView[] => projects.map((entry) => ({ directory: entry.directory, slugs: entry.slugs.filter((slug) => deps.exists(slug)) }));
  const find = (id: string | undefined): Rec => {
    const rec = recs.find((entry) => entry.id === id && !entry.deleted);
    if (!rec) throw new ServiceError('not-found', FOLDER_GONE);
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

  // ---- F2: the batch, in memory (set semantics; the service's sentences) ----

  type Outcome = { result: MembershipResult; apply: () => void };
  const planChange = (change: MembershipChange): Outcome => {
    const add = (change.add ?? []).filter((slug) => deps.exists(slug));
    const remove = change.remove ?? [];
    if (change.target.kind === 'folder') {
      const target = change.target;
      const rec = recs.find((entry) => entry.id === target.id && !entry.deleted);
      if (!rec) return { result: { target, ok: false, code: 'gone', message: FOLDER_GONE }, apply: () => undefined };
      const next = [...rec.slugs.filter((slug) => !remove.includes(slug)), ...add.filter((slug) => !rec.slugs.includes(slug))];
      if (next.length > FOLDER_DESIGNS_MAX) return { result: { target, ok: false, code: 'full', message: FOLDER_DESIGNS_FULL }, apply: () => undefined };
      return { result: { target, ok: true }, apply: () => void (rec.slugs = next) };
    }
    const target = change.target;
    const directory = target.directory;
    if (typeof directory !== 'string' || directory.trim() === '') return { result: { target, ok: false, code: 'invalid', message: PROJECT_UNUSABLE }, apply: () => undefined };
    let entry = projects.find((candidate) => sameDirectory(candidate.directory, directory));
    if (!entry && add.length > 0) {
      if (projects.length >= PROJECT_ENTRIES_MAX) return { result: { target, ok: false, code: 'full', message: PROJECTS_FULL }, apply: () => undefined };
      const created: ProjectRec = { directory, slugs: [] };
      return {
        result: { target, ok: true },
        apply: () => {
          created.slugs = [...created.slugs.filter((slug) => !remove.includes(slug)), ...add.filter((slug) => !created.slugs.includes(slug))];
          if (created.slugs.length > 0) projects.push(created);
        },
      };
    }
    if (!entry) return { result: { target, ok: true }, apply: () => undefined };
    const found = entry;
    const next = [...found.slugs.filter((slug) => !remove.includes(slug)), ...add.filter((slug) => !found.slugs.includes(slug))];
    if (next.length > FOLDER_DESIGNS_MAX) return { result: { target, ok: false, code: 'full', message: FOLDER_DESIGNS_FULL }, apply: () => undefined };
    return {
      result: { target, ok: true },
      apply: () => {
        found.slugs = next;
        if (found.slugs.length === 0) projects.splice(projects.indexOf(found), 1);
      },
    };
  };

  const runBatch = (changes: MembershipChange[], atomic: boolean): { results: MembershipResult[]; changed: boolean } => {
    const outcomes = changes.map(planChange);
    const firstBad = outcomes.find((outcome) => !outcome.result.ok);
    if (atomic && firstBad && !firstBad.result.ok) {
      const code = firstBad.result.code;
      throw new ServiceError(code === 'gone' ? 'not-found' : code === 'full' ? 'conflict' : 'bad-request', firstBad.result.message);
    }
    let changed = false;
    for (const outcome of outcomes) {
      if (!outcome.result.ok) continue;
      outcome.apply();
      changed = true;
    }
    return { results: outcomes.map((outcome) => outcome.result), changed };
  };

  const listNow = (): FolderListResponse => ({
    folders: live().map((rec) => view({ ...rec, slugs: rec.slugs.filter((slug) => deps.exists(slug)) })),
    projects: liveProjects(),
  });

  return {
    handlers: {
      'GET /folders': () => {
        if (failing) throw new ServiceError('internal', 'The folders list could not be read.');
        return listNow();
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
        const liveSlugs = rec.slugs.filter((slug) => deps.exists(slug));
        const elsewhere = new Set(live().filter((other) => other.id !== rec.id).flatMap((other) => other.slugs));
        const onlyHere = liveSlugs.filter((slug) => !elsewhere.has(slug)).length;
        rec.deleted = true;
        deps.emit(null, 'folders');
        return { ok: true, designs: liveSlugs.length, onlyHere };
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
      // F2: the membership batch.
      'POST /memberships': ({ body }) => {
        if (membershipsFailure !== null) {
          const message = membershipsFailure;
          membershipsFailure = null;
          throw new ServiceError('internal', message);
        }
        const { results, changed } = runBatch(body.changes, body.atomic === true);
        if (changed) deps.emit(null, 'folders');
        return { results, list: listNow() };
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
      // F2 hooks.
      seedProject: (directory, slugs) => {
        const entry = projects.find((candidate) => sameDirectory(candidate.directory, directory));
        if (entry) entry.slugs = [...slugs];
        else projects.push({ directory, slugs: [...slugs] });
      },
      projectMembers: (directory) => [...(projects.find((candidate) => sameDirectory(candidate.directory, directory))?.slugs ?? [])],
      deleteElsewhere: (id) => {
        const rec = find(id);
        rec.deleted = true;
        deps.emit(null, 'folders');
      },
      changed: () => deps.emit(null, 'folders'),
      failNextMemberships: (message) => {
        membershipsFailure = message;
      },
      failNextFiling: (message) => {
        filingFailure = message;
      },
    },
    // F2: chip filing, best effort; a forced failure answers one failed result per target.
    fileDesign: (slug, filing) => {
      if (filing === undefined) return undefined;
      const changes: MembershipChange[] = [
        ...(filing.folders ?? []).map((id): MembershipChange => ({ target: { kind: 'folder', id }, add: [slug] })),
        ...(filing.projects ?? []).map((directory): MembershipChange => ({ target: { kind: 'project', directory }, add: [slug] })),
      ];
      if (filingFailure !== null) {
        const message = filingFailure;
        filingFailure = null;
        return { results: changes.map((change) => ({ target: change.target, ok: false, code: 'invalid', message })) };
      }
      const { results, changed } = runBatch(changes, false);
      if (changed) deps.emit(null, 'folders');
      return { results };
    },
  };
};
