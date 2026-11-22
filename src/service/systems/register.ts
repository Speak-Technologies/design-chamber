// "Register it as it is" (documentation/specs/phase-2-6-technical.md §5.9, AD-10): a folder inside a
// project that already holds a complete system in Design Chamber's file contract becomes a repo-backed
// Draft, read-only here, from the bytes the location scan already read.
//
// The user's click in Design Chamber's own control stands in for a build ticket (as P25's re-point
// does): no BUILD.json, no ticket, no agent request, and so no `state.build`. Every step re-checks
// rather than trusts: the scan must be a done location job of this root with a complete contract
// read (`registrationSource`); the location is resolved again inside the project (`recheckLocation`,
// realpaths, the designs root refused); the repo home passes P25's `verifyRepoHome` inside the create
// lock (overlap with another system, the designs root, skipped folders, a living page that isn't
// ours); and the snapshot lands from the job's memory, re-hashed (`refreshSnapshot` with `read`).
//
// Read-only on the repo: the only repo access here is `lstat` to find a free living-page path; every
// write goes through the system store under `_systems/<id>/`. A failure after the folder was made
// moves the half-made system to the trash, so nothing half-registered is left behind.

import { lstat } from 'node:fs/promises';
import path from 'node:path';

import type { CreateSystemResponse, RegisterSystemBody } from '../../shared/api.ts';
import { SCAN_ID_PATTERN } from '../../shared/limits.ts';
import { buildProblemSentence, parseSystemState } from '../../shared/system-json.ts';
import type { BuildProblemReason } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { ensureScanJobs, SCAN_GONE_MESSAGE } from './extract.ts';
import { verifyRepoHome } from './homes.ts';
import { pickInsideSentence, recheckLocation } from './scan-folder.ts';
import { refreshSnapshot } from './snapshot.ts';
import { checkSystemName, ensureSystemStore } from './store.ts';

const REGISTER_BODY_MESSAGE = 'Register a system with the scan of its folder and a name.';
const FOLDER_MOVED_MESSAGE = 'That folder changed since Design Chamber read it. Read the folder again.';
const REGISTER_FAILED_MESSAGE = "Design Chamber couldn't finish registering the system, so nothing was kept. Try again.";
const noLivingPageSpot = (rel: string): string =>
  `${rel} already has index.html and living-page.html, so Design Chamber has no place for its living page. Make a new system from it instead.`;

/** The two places a registered system's living page may go, in order (§5.9 step 3). */
const LIVING_PAGE_NAMES = ['index.html', 'living-page.html'] as const;

/** `POST /systems/register`: exactly `{ scanId, name }`; the name is checked by the store's rule. */
export const parseRegisterBody = (body: unknown): RegisterSystemBody => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError('bad-request', REGISTER_BODY_MESSAGE);
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'scanId' && key !== 'name')) throw new ApiError('bad-request', REGISTER_BODY_MESSAGE);
  if (typeof record.scanId !== 'string' || !SCAN_ID_PATTERN.test(record.scanId)) throw new ApiError('not-found', SCAN_GONE_MESSAGE);
  return { scanId: record.scanId, name: checkSystemName(record.name) };
};

/** The first living-page path in the folder with nothing there yet (an `lstat` of ENOENT; a case-folded match counts as there). */
export const freeLivingPage = async (projectReal: string, rel: string): Promise<string> => {
  for (const name of LIVING_PAGE_NAMES) {
    const candidate = `${rel}/${name}`;
    const free = await lstat(path.join(projectReal, ...candidate.split('/'))).then(
      () => false,
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    );
    if (free) return candidate;
  }
  throw new ApiError('conflict', noLivingPageSpot(rel));
};

/** P25's sentence for an overlap or a living page that isn't ours; any other refusal asks for a folder inside the project. */
const refusalOf = (problem: { reason: BuildProblemReason; value: string }, input: { id: string; name: string; project: string; rel: string; livingPage: string }): string => {
  if (problem.reason !== 'repo-overlap' && problem.reason !== 'living-page-exists') return pickInsideSentence(input.project);
  const state = {
    ...parseSystemState(null, input.id, new Date().toISOString()),
    name: input.name,
    home: { kind: 'repo' as const, directory: input.project, folder: input.rel, livingPage: input.livingPage, adoptedAt: new Date().toISOString() },
    buildProblem: problem,
  };
  return buildProblemSentence(state) ?? pickInsideSentence(input.project);
};

/** §5.9: register the location scan `scanId` as a repo-backed Draft named `name`. */
export const registerSystem = async (ctx: ServiceContext, input: RegisterSystemBody): Promise<CreateSystemResponse> => {
  const source = ensureScanJobs(ctx).registrationSource(input.scanId); // 404 gone; 409 running, other root, not a system folder
  const systems = ensureSystemStore(ctx);
  // Step 2: the folder as it is now, still inside the project and outside the designs root.
  const now = await recheckLocation(source.rel, source.project, ctx.settings.root());
  if (now.rel !== source.rel) throw new ApiError('conflict', FOLDER_MOVED_MESSAGE);
  // Step 3: where its living page will go.
  const livingPage = await freeLivingPage(source.project, source.rel);
  const repoHome = { directory: source.project, folder: source.rel, livingPage };

  // Steps 4 and 5: the repo home verified with the minted id inside the create lock, then the folder.
  const created = await systems.create({ name: input.name }, undefined, {
    repoHome,
    beforeMake: async (id) => {
      const verified = await verifyRepoHome(repoHome, source.project, { root: ctx.settings.root(), systems, id });
      if (verified.problem !== null) {
        ctx.log.info('systems.register-refused', { reason: verified.problem.reason });
        throw new ApiError('conflict', refusalOf(verified.problem, { id, name: input.name, project: source.project, rel: source.rel, livingPage }));
      }
    },
  });

  // The first snapshot from the scan's own read (by the user; no second read of the repo).
  try {
    await refreshSnapshot(ctx, created.id, { by: 'user', read: { read: source.read, root: source.root } });
  } catch (error) {
    await systems.trash(created.id).catch((trashError: unknown) =>
      ctx.log.error('systems.register-cleanup-failed', { system: created.id, error: trashError instanceof Error ? trashError.name : 'error' }),
    );
    ctx.log.warn('systems.register-failed', { system: created.id, error: error instanceof Error ? error.name : 'error' });
    if (error instanceof ApiError) throw error;
    throw new ApiError('internal', REGISTER_FAILED_MESSAGE);
  }
  ctx.log.info('systems.registered', { system: created.id, files: source.read.files.size, skipped: source.read.refused });
  return { id: created.id, system: await systems.detail(created.id) };
};
