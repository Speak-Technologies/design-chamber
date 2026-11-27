// The service half of the composer's `@` menu (documentation/specs/phase-1-5-sdk-2-7.md §U6).
//
// Search answers from the in-memory design index and never touches the disk, so it fits the host's
// 2 second budget. Resolve runs once, when the user picks a row: it reads that one design through
// the store (which validates the slug and contains the folder under the designs root), looks at
// three fixed file names inside it, and builds the text the agent reads. Nothing here writes.

import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { MENTIONS_ITEMS_MAX, MENTION_ID_MAX, MENTION_TEXT_MAX, MENTION_TITLE_MAX } from '@openchamber/sdk';

import type { MentionsResolveResponse, MentionsSearchResponse } from '../shared/api.ts';
import { buildMentionText, searchDesigns, type CheckCounts } from '../shared/agent/mention.ts';
import { MENTION_INDEX_WAIT_MS, SLUG_PATTERN } from '../shared/limits.ts';
import { ensureChecksService, type ChecksService } from './check/service.ts';
import type { ServiceContext } from './context.ts';
import { ApiError } from './http.ts';

/** What the host shows when the design was removed between the search and the pick. */
const GONE = 'That design is no longer in your Designs folder.';

/** A plain file (not a link) with this fixed name exists in the folder. A link is not followed: it could point anywhere. */
const hasFile = async (folder: string, ...parts: string[]): Promise<boolean> => {
  try {
    return (await lstat(path.join(folder, ...parts))).isFile();
  } catch {
    return false;
  }
};

/** Designs matching what the user typed after `@`, from memory. A cold index answers nothing; the next keystroke asks again. */
export const searchMentions = async (ctx: ServiceContext, input: { query: string; directory: string | null }): Promise<MentionsSearchResponse> => {
  if (!(await ctx.designIndex.ready(MENTION_INDEX_WAIT_MS))) return { items: [] };
  return { items: searchDesigns(ctx.designIndex.all(), input.query, input.directory, { maxItems: MENTIONS_ITEMS_MAX, maxTitle: MENTION_TITLE_MAX }) };
};

/**
 * How long resolve waits for the check counts. The host gives resolve `MENTIONS_RESOLVE_TIMEOUT_MS`
 * (10 s) and drops the pick past it, while a cold static check on a large canvas may take
 * `CHECK_STATIC_BUDGET_MS` (also 10 s). Late counts are left out; the check keeps running and is
 * memoised, so the next pick of that design has them.
 */
export const MENTION_CHECKS_WAIT_MS = 1500;

export type ResolveDeps = {
  now?: () => Date;
  /** The checks service; the context's own by default. Tests pass a slow one. */
  checks?: Pick<ChecksService, 'get'>;
};

/** The check counts, or `null` when the check cannot be read: the mention is still useful without them. */
const checkCounts = async (ctx: ServiceContext, checks: Pick<ChecksService, 'get'>, slug: string): Promise<CheckCounts | null> => {
  try {
    return (await checks.get(slug)).counts;
  } catch (error) {
    ctx.log.warn('mentions.checks-unreadable', { slug, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

/** The counts if they come within `MENTION_CHECKS_WAIT_MS`, otherwise `null`. `counts` never rejects (`checkCounts` catches), so a late answer is simply dropped. */
const countsInTime = async (ctx: ServiceContext, slug: string, counts: Promise<CheckCounts | null>): Promise<CheckCounts | null> => {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), MENTION_CHECKS_WAIT_MS);
  });
  try {
    const answer = await Promise.race([counts, late]);
    if (answer !== 'late') return answer;
    ctx.log.info('mentions.checks-late', { slug, waitedMs: MENTION_CHECKS_WAIT_MS });
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The text for one picked design. `id` must be a design folder name; anything else is a 400, and a
 * design that is gone is a 404 with the sentence the host shows. The check counts get
 * `MENTION_CHECKS_WAIT_MS`, so the answer comes well inside the host's resolve budget.
 */
export const resolveMention = async (ctx: ServiceContext, id: string, deps: ResolveDeps = {}): Promise<MentionsResolveResponse> => {
  const now = deps.now ?? (() => new Date());
  if (id.length > MENTION_ID_MAX || !SLUG_PATTERN.test(id)) throw new ApiError('bad-request', 'That is not a design folder name.');
  let record;
  try {
    record = await ctx.store.get(id);
  } catch (error) {
    // `bad-path`: the folder is a link that leaves the designs root. For the user that design is not in their folder.
    if (error instanceof ApiError && (error.code === 'not-found' || error.code === 'bad-slug' || error.code === 'bad-path')) throw new ApiError('not-found', GONE);
    throw error;
  }
  const [counts, hasTokensCss, hasDesignMd, hasRules] = await Promise.all([
    countsInTime(ctx, id, checkCounts(ctx, deps.checks ?? ensureChecksService(ctx), id)),
    hasFile(record.path, 'tokens.css'),
    hasFile(record.path, 'DESIGN.md'),
    hasFile(record.path, '.chamber', 'RULES.md'),
  ]);
  const { text } = buildMentionText({
    design: record.design,
    folder: record.path,
    files: record.files,
    hasTokensCss,
    hasDesignMd,
    hasRules,
    counts,
    readAt: now(),
    maxChars: MENTION_TEXT_MAX,
  });
  return { text };
};
