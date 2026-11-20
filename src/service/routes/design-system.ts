// A design's design system (documentation/specs/phase-2-5-technical.md §3.2, §5.4, AD-5, AD-7):
// what it shows, a preview of a change or an update, and the change itself (version first; the
// Undo is a restore of `before`). The router checks the bearer token and the slug pattern first;
// every folder comes from the store (`resolveInside`), and no body carries a path.

import type { DesignSystemActionBody, DesignSystemActionResponse, DesignSystemView, SystemPreviewResponse } from '../../shared/api.ts';
import { SHA256_PATTERN, SYSTEM_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { readCopyRecord } from '../store.ts';
import { ensureLinkService, LINK_NO_COPY_MESSAGE } from '../systems/link.ts';

const BAD_BODY = "Design Chamber couldn't read that change. Nothing was changed.";

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `sha256:sha256`, as `GET /designs/:slug/system` answers it (each half `SHA256_PATTERN`). */
const isStamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const [copy, tokens, extra] = value.split(':');
  return extra === undefined && copy !== undefined && tokens !== undefined && SHA256_PATTERN.test(copy) && SHA256_PATTERN.test(tokens);
};

export const parseDesignSystemAction = (body: unknown): DesignSystemActionBody => {
  if (!isRec(body) || !isStamp(body.stamp)) throw new ApiError('bad-request', BAD_BODY);
  if (body.action === 'set') {
    const { to } = body;
    if (typeof to !== 'string' || (to !== 'none' && !SYSTEM_ID_PATTERN.test(to))) throw new ApiError('bad-request', BAD_BODY);
    return { action: 'set', to, stamp: body.stamp };
  }
  if (body.action === 'update') {
    const { toRevision } = body;
    if (typeof toRevision !== 'number' || !Number.isSafeInteger(toRevision) || toRevision < 1) throw new ApiError('bad-request', BAD_BODY);
    return { action: 'update', toRevision, stamp: body.stamp };
  }
  throw new ApiError('bad-request', BAD_BODY);
};

/**
 * Registers:
 * - 'GET /designs/:slug/system'
 * - 'GET /designs/:slug/system/preview'
 * - 'POST /designs/:slug/system'
 */
export function registerDesignSystemRoutes(router: Router, ctx: ServiceContext): void {
  router.on('GET /designs/:slug/system', async ({ params }): Promise<DesignSystemView> => ensureLinkService(ctx).view(params.slug));

  router.on('GET /designs/:slug/system/preview', async ({ params, query }): Promise<SystemPreviewResponse> => {
    const to = query.get('to');
    if (to === null) throw new ApiError('bad-request', 'Say which design system to preview: an id or "none".');
    return ensureLinkService(ctx).preview(params.slug, to);
  });

  router.on('POST /designs/:slug/system', async ({ params, body }): Promise<DesignSystemActionResponse> => {
    const action = parseDesignSystemAction(body);
    const link = ensureLinkService(ctx);
    if (action.action === 'set') return link.link(params.slug, { to: action.to, by: 'user', stamp: action.stamp, reason: 'system-change' });
    // An update keeps the system the copy names; the stamp (checked on the chain) catches a copy changed meanwhile.
    const copy = await readCopyRecord(await ctx.store.dir(params.slug));
    if (copy.kind !== 'ok') throw new ApiError('invalid', LINK_NO_COPY_MESSAGE);
    return link.link(params.slug, { to: copy.record.id, by: 'user', stamp: action.stamp, reason: 'system-update', toRevision: action.toRevision });
  });
}
