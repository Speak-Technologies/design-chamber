// Phase 2.5 systems routes (documentation/specs/phase-2-5-technical.md §3.1, §3.5): list, get,
// create, patch and delete a design system. The router has already checked the bearer token and
// refused encoded separators in `:id`; every body is validated here before the store sees it,
// and the store resolves the id through `systems.dir(id)` (pattern, containment, no links).
// No body carries a path. `GET /systems/:id/living-page` stays T14's (the living page).

import type {
  CreateSystemBody,
  CreateSystemResponse,
  DeleteSystemResponse,
  PatchSystemBody,
  PatchSystemResponse,
  RouteKey,
  SystemListResponse,
} from '../../shared/api.ts';
import { PRESET_ID_PATTERN, SCAN_ID_PATTERN, SESSION_ID_MAX, SYSTEMS_MAX } from '../../shared/limits.ts';
import { isSystemSection, SYSTEM_REVIEW_NOTE_MAX } from '../../shared/system-json.ts';
import type { ReviewState, SystemDetail } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';
import { ensureSystemStore } from '../systems/store.ts';

/** Characters of a description a new system is made from (§3.1). */
const DESCRIPTION_MAX = 2000;
/** Brand file paths a create may name (the ticked project files of a scan). */
const CREATE_ASSETS_MAX = 200;

const isBodyRecord = (body: unknown): body is Record<string, unknown> => typeof body === 'object' && body !== null && !Array.isArray(body);

const REVIEW_STATES: readonly ReviewState[] = ['not-reviewed', 'looks-good', 'needs-work'];

/** `POST /systems`: the name is checked by the store (one rule for create and rename). */
export const validateCreateSystem = (body: unknown): CreateSystemBody => {
  if (!isBodyRecord(body)) throw new ApiError('bad-request', 'The new design system request must be a JSON object.');
  const out: CreateSystemBody = { name: typeof body.name === 'string' ? body.name : '' };
  if (body.code !== undefined) {
    const code = body.code;
    if (
      !isBodyRecord(code) ||
      typeof code.scanId !== 'string' ||
      !SCAN_ID_PATTERN.test(code.scanId) ||
      !Array.isArray(code.assets) ||
      code.assets.length > CREATE_ASSETS_MAX ||
      !code.assets.every((asset) => typeof asset === 'string' && asset.length <= 4096 && !asset.includes('\u0000'))
    ) {
      throw new ApiError('bad-request', 'The code part of the request must name a scan and the files to copy.');
    }
    out.code = { scanId: code.scanId, assets: code.assets as string[] };
  }
  if (body.description !== undefined) {
    const description = body.description;
    if (!isBodyRecord(description) || typeof description.text !== 'string' || description.text.length > DESCRIPTION_MAX) {
      throw new ApiError('bad-request', `The description must be text of at most ${DESCRIPTION_MAX} characters.`);
    }
    const preset = description.preset ?? null;
    if (preset !== null && (typeof preset !== 'string' || !PRESET_ID_PATTERN.test(preset))) throw new ApiError('bad-request', 'That is not a style preset id.');
    out.description = { text: description.text, preset };
  }
  if (body.brand !== undefined) {
    if (body.brand !== true) throw new ApiError('bad-request', 'brand must be true when brand files will follow.');
    out.brand = true;
  }
  return out;
};

/** `PATCH /systems/:id`: exactly one of the five changes. */
export const validatePatchSystem = (body: unknown): PatchSystemBody => {
  if (!isBodyRecord(body)) throw new ApiError('bad-request', 'The change must be a JSON object.');
  const keys = Object.keys(body);
  if (keys.length !== 1) throw new ApiError('bad-request', 'Change one thing at a time: name, status, review, sessionId or livingPage.');
  if ('name' in body) {
    if (typeof body.name !== 'string') throw new ApiError('bad-request', 'Give the design system a name.');
    return { name: body.name };
  }
  if ('status' in body) {
    if (body.status !== 'draft' && body.status !== 'ready') throw new ApiError('bad-request', 'A design system is either a draft or ready.');
    return { status: body.status };
  }
  if ('review' in body) {
    const review = body.review;
    if (!isBodyRecord(review) || !isSystemSection(review.section)) throw new ApiError('bad-request', "That isn't a section of a design system.");
    if (typeof review.state !== 'string' || !(REVIEW_STATES as readonly string[]).includes(review.state)) {
      throw new ApiError('bad-request', 'A review is looks-good, needs-work or not-reviewed.');
    }
    if (review.note !== undefined && (typeof review.note !== 'string' || review.note.length > SYSTEM_REVIEW_NOTE_MAX)) {
      throw new ApiError('bad-request', `A review note can be up to ${SYSTEM_REVIEW_NOTE_MAX} characters.`);
    }
    return { review: { section: review.section, state: review.state as ReviewState, ...(review.note !== undefined ? { note: review.note as string } : {}) } };
  }
  if ('sessionId' in body) {
    const sessionId = body.sessionId;
    if (sessionId !== null && (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > SESSION_ID_MAX)) throw new ApiError('bad-request', 'That is not a chat session id.');
    return { sessionId };
  }
  if ('livingPage' in body) {
    const livingPage = body.livingPage;
    if (!isBodyRecord(livingPage) || typeof livingPage.embedFonts !== 'boolean' || Object.keys(livingPage).length !== 1) {
      throw new ApiError('bad-request', 'livingPage takes { embedFonts: true or false }.');
    }
    return { livingPage: { embedFonts: livingPage.embedFonts } };
  }
  throw new ApiError('bad-request', 'Say what to change: name, status, review, sessionId or livingPage.');
};

/** Routes T14 fills (the living page); they answer "not built yet" until then. */
const LATER: readonly RouteKey[] = ['GET /systems/:id/living-page'];

/**
 * Registers:
 * - 'GET /systems'
 * - 'POST /systems'
 * - 'GET /systems/:id'
 * - 'PATCH /systems/:id'
 * - 'DELETE /systems/:id'
 * - 'GET /systems/:id/living-page' (T14; not built yet)
 *
 * The store is reached on the first request, never at registration.
 */
export function registerSystemsRoutes(router: Router, ctx: ServiceContext): void {
  router.on('GET /systems', async (): Promise<SystemListResponse> => {
    const systems = await ensureSystemStore(ctx).list();
    return { systems, total: systems.length, max: SYSTEMS_MAX };
  });

  router.on('POST /systems', async ({ body }): Promise<CreateSystemResponse> => ensureSystemStore(ctx).create(validateCreateSystem(body)));

  router.on('GET /systems/:id', async ({ params }): Promise<SystemDetail> => ensureSystemStore(ctx).detail(params.id));

  router.on('PATCH /systems/:id', async ({ params, body }): Promise<PatchSystemResponse> => ensureSystemStore(ctx).patch(params.id, validatePatchSystem(body)));

  router.on('DELETE /systems/:id', async ({ params }): Promise<DeleteSystemResponse> => ensureSystemStore(ctx).trash(params.id));

  registerNotBuilt(router, LATER);
}
