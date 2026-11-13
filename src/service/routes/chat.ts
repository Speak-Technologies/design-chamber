// WP3 — POST /chip, POST /designs/:slug/prompt, POST /pages/from-message, POST and DELETE /open-request
// (docs/SPEC.md §7, §10, §11; documentation/specs/phase-1-5-sdk-2-7.md §3.2),
// and the `onCreate` hook that writes `<design>/.chamber/RULES.md`. Revision and offline prompts
// list the remote URLs the viewer blocks, taken from the bundler's static scan of the design's
// files on disk; a design frame never supplies them (documentation/specs/agent-guidance-and-pages.md §3.6).

import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { AskTooLongError, buildAskPrompt } from '../../shared/agent/ask-prompt.ts';
import { buildChip, titleFromBrief } from '../../shared/agent/chip.ts';
import { clip, noProject, type AgentContext, type AgentPreset, type ProjectRules } from '../../shared/agent/context.ts';
import { buildHandEditsBlock, type HandEditsBlock } from '../../shared/agent/hand-edits.ts';
import { derivePageTitle, extractHtml } from '../../shared/agent/html-extract.ts';
import { buildChecksPrompt, buildContinuePrompt, buildOfflinePrompt, buildRevisionPrompt, type ExternalList } from '../../shared/agent/revision-prompt.ts';
import { buildRulesDoc } from '../../shared/agent/rules-doc.ts';
import { normalizeExternalUrl, sortFindings } from '../../shared/checks.ts';
import type { AskElement, ChipResponse, FromMessageResponse, OkResponse, OpenIntent, OpenRequest, OpenRequestResponse, PromptBody, PromptResponse, RenderMeta, RenderQuery } from '../../shared/api.ts';
import {
  ASK_TEXT_MAX,
  BRIEF_MAX,
  COMMENT_ID_PATTERN,
  COMMENTS_MAX,
  DISCOVERY_TIME_MAX_MS,
  OPEN_REQUEST_TTL_MS,
  PAGE_FILL_VIEWPORT_ID,
  PRESET_ID_PATTERN,
  PROJECT_DIRECTORY_MAX,
  PROMPT_EXTERNAL_MAX,
  PROMPT_EXTERNAL_SCAN_MS,
  PROMPT_EXTERNAL_URL_MAX,
  REVISION_TEXT_MAX,
  SESSION_ID_MAX,
  SLUG_PATTERN,
  UPLOAD_ID_PATTERN,
} from '../../shared/limits.ts';
import type { AnchorState, Comment, DesignKind } from '../../shared/types.ts';
import type { DesignRecord, ServiceContext } from '../context.ts';
import { ensureChecksService } from '../check/service.ts';
import { ensureLauncherService } from '../check/launcher.ts';
import { discoverProjectRules, withDeadline } from '../discovery.ts';
import { ensureEditService } from '../edits/pipeline.ts';
import { ApiError, type Router } from '../http.ts';
import { foldsCase } from '../paths.ts';
import { parseElement } from './comments.ts';
import { readPreset, readRulesDocs } from './presets.ts';

// ---- request validation (every body here is untrusted) ----

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

const bodyOf = (body: unknown, what: string): Rec => {
  if (!isRec(body)) throw new ApiError('bad-request', `Send ${what} as a JSON object.`);
  return body;
};

const optionalText = (record: Rec, key: string, max: number, label: string): string | null => {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new ApiError('bad-request', `The ${label} must be text of at most ${max} characters.`);
  return value;
};

/** An absolute project folder, or `null`. Relative paths and NUL are refused; nothing is touched here. */
export const projectDirectoryOf = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > PROJECT_DIRECTORY_MAX) throw new ApiError('bad-request', `The project folder must be text of at most ${PROJECT_DIRECTORY_MAX} characters.`);
  if (value.trim() === '') return null;
  if (value.includes('\0') || !path.isAbsolute(value)) throw new ApiError('bad-path', 'The project folder must be an absolute path.');
  return value;
};

const parseChipBody = (body: unknown): { kind: DesignKind; brief: string; preset: string | null; projectDirectory: string | null } => {
  const record = bodyOf(body, 'the new design');
  const { kind } = record;
  if (kind !== 'canvas' && kind !== 'page') throw new ApiError('bad-request', 'Say whether the design is a "canvas" or a "page".');
  const brief = (optionalText(record, 'brief', Number.MAX_SAFE_INTEGER, 'brief') ?? '').trim();
  if (brief.length > BRIEF_MAX) {
    throw new ApiError('invalid', `The brief is ${brief.length} characters; Design Chamber keeps ${BRIEF_MAX}. Shorten it, or send the extra detail in the chat after the command.`);
  }
  const preset = optionalText(record, 'preset', 60, 'style preset');
  if (preset !== null && !PRESET_ID_PATTERN.test(preset)) throw new ApiError('bad-request', 'That is not a style preset id.');
  // `sessionId` is accepted but deliberately not stored: the user may never send the chip (§10.1).
  optionalText(record, 'sessionId', SESSION_ID_MAX, 'chat id');
  return { kind, brief, preset, projectDirectory: projectDirectoryOf(record.projectDirectory) };
};

const ANCHOR_STATES: ReadonlySet<unknown> = new Set<AnchorState>(['exact', 'moved', 'detached']);

/** `{ [commentId]: AnchorState }` from the page; absent = no flags. */
const parseAnchorStates = (value: unknown): Record<string, AnchorState> => {
  if (value === undefined || value === null) return {};
  const entries = isRec(value) ? Object.entries(value) : null;
  if (entries === null || entries.length > COMMENTS_MAX || !entries.every(([id, state]) => COMMENT_ID_PATTERN.test(id) && ANCHOR_STATES.has(state))) {
    throw new ApiError('bad-request', 'The pin states are not valid.');
  }
  // Safe: every value was just checked against ANCHOR_STATES.
  return Object.fromEntries(entries) as Record<string, AnchorState>;
};

type PromptInput = {
  purpose: PromptBody['purpose'];
  commentIds: string[] | null;
  anchorStates: Record<string, AnchorState>;
  /** Ask only: the user's words, trimmed (1 to `ASK_TEXT_MAX`). */
  text: string;
  /** Ask only: the attached element before it is checked against the design. */
  element: AskElement | null;
};

const parsePromptBody = (body: unknown): PromptInput => {
  const record = bodyOf(body, 'the prompt request');
  const { purpose, commentIds } = record;
  if (purpose !== 'revision' && purpose !== 'continue' && purpose !== 'offline' && purpose !== 'checks' && purpose !== 'ask') {
    throw new ApiError('bad-request', 'The prompt purpose must be "revision", "continue", "offline", "checks" or "ask".');
  }
  if (purpose === 'ask') {
    if (typeof record.text !== 'string' || record.text.trim() === '') throw new ApiError('bad-request', 'Write what you want the agent to do.');
    const text = record.text.trim();
    if (text.length > ASK_TEXT_MAX) {
      throw new ApiError('invalid', `Your message is ${text.length - ASK_TEXT_MAX} characters over the limit of ${ASK_TEXT_MAX}. Shorten it and send again.`);
    }
    const element = record.element === undefined || record.element === null ? null : parseElement(record.element);
    return { purpose, commentIds: null, anchorStates: {}, text, element };
  }
  const anchorStates = parseAnchorStates(record.anchorStates);
  const base: Omit<PromptInput, 'commentIds'> = { purpose, anchorStates, text: '', element: null };
  if (commentIds === undefined) return { ...base, commentIds: null };
  const ids = Array.isArray(commentIds) ? commentIds.filter((id): id is string => typeof id === 'string' && COMMENT_ID_PATTERN.test(id)) : [];
  if (!Array.isArray(commentIds) || commentIds.length > COMMENTS_MAX || ids.length !== commentIds.length) throw new ApiError('bad-request', 'The comment list is not valid.');
  return { ...base, commentIds: ids };
};

const parseFromMessageBody = (body: unknown): { uploadId: string; sessionId: string; sessionTitle: string; directory: string | null; open: boolean } => {
  const record = bodyOf(body, 'the message');
  const { uploadId, sessionId, sessionTitle, messageId } = record;
  if (typeof uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(uploadId)) throw new ApiError('bad-request', 'The message upload id is not valid.');
  if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > SESSION_ID_MAX) throw new ApiError('bad-request', 'The chat id is not valid.');
  if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 256) throw new ApiError('bad-request', 'The message id is not valid.');
  if (typeof sessionTitle !== 'string' || sessionTitle.length > 1000) throw new ApiError('bad-request', 'The chat title is not valid.');
  if (record.open !== undefined && typeof record.open !== 'boolean') throw new ApiError('bad-request', 'open must be true or false.');
  return { uploadId, sessionId, sessionTitle, directory: projectDirectoryOf(record.directory), open: record.open === true };
};

/**
 * `POST /open-request` body. The slug is checked against `SLUG_PATTERN` here, before any path is
 * built from it; the store then resolves it under the root (containment) and says whether it exists.
 */
export const parseOpenRequestBody = (body: unknown): { slug: string; intent: OpenIntent } => {
  const record = bodyOf(body, 'the open request');
  const { slug, intent } = record;
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) throw new ApiError('bad-slug', 'That is not a design folder name.');
  if (intent !== undefined && intent !== 'view' && intent !== 'comment') throw new ApiError('bad-request', 'The intent must be "view" or "comment".');
  return { slug, intent: intent ?? 'view' };
};

// ---- RULES.md on disk ----

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let tmpCounter = 0;

/**
 * Write `<folder>/.chamber/RULES.md` atomically (tmp + rename), skipping the write when the bytes
 * are unchanged. `folder` must already be a contained design folder (`store.dir` / a record's
 * `path`). The agent writes into the design folder too, so a `.chamber` that is a link or a
 * plain file is refused rather than followed out of the folder.
 */
export const writeRulesFile = async (folder: string, text: string): Promise<void> => {
  const dir = path.join(folder, '.chamber');
  const info = await lstat(dir).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info !== null && (info.isSymbolicLink() || !info.isDirectory())) {
    throw new ApiError('internal', 'This design\'s .chamber entry is not a normal folder, so Design Chamber cannot write the agent instructions there. Remove it and try again.');
  }
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, 'RULES.md');
  if ((await readFile(target, 'utf8').catch(() => null)) === text) return;
  tmpCounter += 1;
  const tmp = `${target}.${process.pid}.${tmpCounter}.tmp`;
  await writeFile(tmp, text, 'utf8');
  try {
    // Windows refuses to rename over a file another process has open for a moment (an agent reading it).
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(tmp, target);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
        await sleep(40 * attempt);
      }
    }
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
};

const isFile = (file: string): Promise<boolean> => stat(file).then((info) => info.isFile(), () => false);

// ---- instruction assembly ----

const DISCOVERY_CACHE_MS = 15_000;
const DISCOVERY_CACHE_MAX = 8;
/** The scan's own cap plus a second of slack, inside the chip's 3 s build budget. */
const DISCOVERY_DEADLINE_MS = DISCOVERY_TIME_MAX_MS + 1000;

/**
 * The discovery cache key for a project folder: folded on case-insensitive filesystems (Windows,
 * macOS, per `foldsCase`), so `/Users/me/App` and `/users/me/app` share one scan; exact on Linux.
 */
export const discoveryKeyOf = (directory: string, platform: NodeJS.Platform = process.platform): string =>
  foldsCase(platform === 'win32' ? path.win32 : path.posix, platform) ? directory.toLowerCase() : directory;

type Instructions = {
  /** The agent context and RULES.md text for a design, from disk. Throws when `rules/` is unreadable. */
  prepare(record: DesignRecord): Promise<{ context: AgentContext; text: string }>;
  discover(directory: string | null): Promise<ProjectRules>;
};

const createInstructions = (ctx: ServiceContext): Instructions => {
  // One scan serves the chip route and the `onCreate` hook it triggers.
  const scans = new Map<string, { at: number; result: Promise<ProjectRules> }>();

  const discover = (directory: string | null): Promise<ProjectRules> => {
    if (directory === null) return Promise.resolve(noProject('no project folder was given'));
    const key = discoveryKeyOf(directory);
    const cached = scans.get(key);
    if (cached && Date.now() - cached.at < DISCOVERY_CACHE_MS) return cached.result;
    const result = withDeadline(
      discoverProjectRules(directory, { designsRoot: ctx.settings.root() }),
      DISCOVERY_DEADLINE_MS,
      { ...noProject('the folder did not answer in time', directory), state: 'unreadable' as const },
    );
    scans.delete(key);
    scans.set(key, { at: Date.now(), result });
    for (const oldest of scans.keys()) {
      if (scans.size <= DISCOVERY_CACHE_MAX) break;
      scans.delete(oldest);
    }
    return result;
  };

  const loadPreset = async (id: string | null): Promise<AgentPreset | null> => {
    if (id === null) return null;
    const found = await readPreset(ctx.packageRoot, id);
    if (found === null) ctx.log.warn('agent.preset-missing', { preset: id });
    return found === null ? null : { id: found.preset.id, name: found.preset.name, text: found.text };
  };

  return {
    discover,
    async prepare(record) {
      const { design } = record;
      const [files, preset, project, hasDesignMd, hasTokensCss, checkCommand] = await Promise.all([
        readRulesDocs(ctx.packageRoot),
        loadPreset(design.preset),
        discover(design.projectDirectory),
        isFile(path.join(record.path, 'DESIGN.md')),
        isFile(path.join(record.path, 'tokens.css')),
        ensureLauncherService(ctx).commandFor(ctx.settings.root(), record.slug),
      ]);
      const context: AgentContext = {
        title: design.title,
        kind: design.kind,
        folder: record.path,
        designsRoot: ctx.settings.root(),
        brief: design.brief,
        project,
        preset,
        viewports: design.viewports,
        screenIds: design.screens.map((screen) => screen.id),
        pending: record.pending,
        designSystem: { confirmed: design.designSystem.confirmed, hasDesignMd, hasTokensCss },
        checkCommand,
      };
      return { context, text: buildRulesDoc(context, files) };
    },
  };
};

// ---- remote URLs the viewer blocks ----

// Lives in shared/checks.ts so the check CLI does not import routes; re-exported for the existing callers.
export { normalizeExternalUrl };

/** Dedupe, keep the first `PROMPT_EXTERNAL_MAX` (each cut to `PROMPT_EXTERNAL_URL_MAX`), count the rest. */
export const capExternal = (raw: Iterable<string>): ExternalList => {
  const seen = new Set<string>();
  const urls: string[] = [];
  let more = 0;
  for (const entry of raw) {
    const href = normalizeExternalUrl(entry);
    if (href === null || seen.has(href)) continue;
    seen.add(href);
    if (urls.length < PROMPT_EXTERNAL_MAX) urls.push(clip(href, PROMPT_EXTERNAL_URL_MAX));
    else more += 1;
  }
  return { urls, more };
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The remote URLs a design's own files load, from the render bundler (`RenderMeta.external`).
 * A page renders its entry; a canvas each screen whose file exists, one at a time, until
 * `PROMPT_EXTERNAL_SCAN_MS` is spent. A screen that fails to render is skipped and logged: the
 * list is advice for the agent, so a partial list is better than no request at all.
 */
export const collectExternal = async (ctx: Pick<ServiceContext, 'renders' | 'log'>, record: DesignRecord): Promise<ExternalList> => {
  const { design, files } = record;
  const targets: RenderQuery[] =
    design.kind === 'page'
      ? files.entry?.exists === true
        ? [{}]
        : []
      : design.screens.filter((screen) => files.screens[screen.id]?.exists === true).map((screen) => ({ screen: screen.id }));
  const started = Date.now();
  const found: string[] = [];
  for (const [index, query] of targets.entries()) {
    const remaining = PROMPT_EXTERNAL_SCAN_MS - (Date.now() - started);
    let meta: RenderMeta | null = null;
    if (remaining > 0) {
      try {
        meta = await withDeadline<RenderMeta | null>(ctx.renders.render(record.slug, query), remaining, null);
      } catch (error) {
        ctx.log.warn('agent.external-scan-skipped', { slug: record.slug, screen: query.screen ?? null, error: errorText(error) });
        continue;
      }
    }
    if (meta === null) {
      ctx.log.warn('agent.external-scan-timeout', { slug: record.slug, unscanned: targets.length - index });
      break;
    }
    found.push(...meta.external);
  }
  return capExternal(found);
};

const selectComments = (all: readonly Comment[], ids: readonly string[] | null): Comment[] => {
  const picked = ids === null ? all.filter((comment) => comment.status === 'open') : all.filter((comment) => ids.includes(comment.id));
  if (picked.length === 0) throw new ApiError('invalid', ids === null ? 'There are no open comments to send.' : 'None of those comments exist any more.');
  return picked;
};

// ---- the hand-edit block (Phase 2 §7.3) ----

/** The block goes first, then a blank line, then the message; the budget leaves room for both. */
const BLOCK_SEPARATOR = '\n\n';
const budgetFor = (block: HandEditsBlock | null): number => REVISION_TEXT_MAX - (block === null ? 0 : block.text.length + BLOCK_SEPARATOR.length);
const withBlock = (block: HandEditsBlock | null, text: string): string => (block === null ? text : block.text + BLOCK_SEPARATOR + text);
const handEditsOf = (block: HandEditsBlock | null): PromptResponse['handEdits'] => (block === null ? null : { upTo: block.upTo, count: block.count });

/**
 * Registers:
 * - 'POST /chip'
 * - 'POST /designs/:slug/prompt'
 * - 'POST /pages/from-message'
 * - 'POST /open-request'
 * - 'DELETE /open-request'
 * and hooks design creation so every new design gets its `.chamber/RULES.md`.
 * Design folders come from `ctx.store` (slug pattern + containment, §9.1); the only path this
 * module adds is the fixed `.chamber/RULES.md`. The project folder is read-only input to discovery.
 */
export function registerChatRoutes(router: Router, ctx: ServiceContext): void {
  const instructions = createInstructions(ctx);
  // One slot, taken exactly once: a newer request ("Open as page", a Work Status row, a chat block)
  // replaces an untaken older one.
  let openRequest: { request: OpenRequest; at: number } | null = null;
  const leaveOpenRequest = (slug: string, intent: OpenIntent): void => {
    openRequest = { request: { slug, intent, created: new Date().toISOString() }, at: Date.now() };
  };

  try {
    ctx.onDispose(
      ctx.store.onCreate(async (record) => {
        const { text } = await instructions.prepare(record);
        await writeRulesFile(record.path, text);
      }),
    );
  } catch (error) {
    // Until the integration pass wires the real store (SPEC §14) its methods answer "not built yet".
    ctx.log.warn('agent.rules-hook-unavailable', { error: error instanceof Error ? error.message : String(error) });
  }

  router.on('POST /chip', async ({ body }): Promise<ChipResponse> => {
    const input = parseChipBody(body);
    if (input.preset !== null && (await readPreset(ctx.packageRoot, input.preset)) === null) {
      throw new ApiError('bad-request', 'That style preset is not available. Pick another or start without one.');
    }
    await instructions.discover(input.projectDirectory);
    const record = await ctx.store.create({
      kind: input.kind,
      title: titleFromBrief(input.brief, input.kind),
      brief: input.brief,
      preset: input.preset,
      projectDirectory: input.projectDirectory,
    });
    // The chip makes RULES.md mandatory reading, so a failure to write it is a failure of the chip.
    const { context, text } = await instructions.prepare(record);
    await writeRulesFile(record.path, text);
    return { slug: record.slug, chip: buildChip(context, { slug: record.slug, mode: 'new', folderUrl: pathToFileURL(record.path).href, created: record.state.created }) };
  });

  router.on('POST /designs/:slug/prompt', async ({ params, body }): Promise<PromptResponse> => {
    const input = parsePromptBody(body);
    const record = await ctx.store.get(params.slug);
    const { context, text: rulesText } = await instructions.prepare(record);
    try {
      await writeRulesFile(record.path, rulesText);
    } catch (error) {
      // A refresh that fails (a file lock) leaves the earlier RULES.md in place; the message can still go out.
      ctx.log.warn('agent.rules-refresh-failed', { slug: record.slug, error: error instanceof Error ? error.message : String(error) });
    }
    const chip = buildChip(context, { slug: record.slug, mode: 'continue', folderUrl: pathToFileURL(record.path).href, created: record.state.created });
    const { design } = record;

    if (input.purpose === 'continue') {
      const openComments = design.comments.filter((comment) => comment.status === 'open').length;
      // No hand-edit block on a resume: nothing is asked, so nothing is cleared (§7.3).
      return { text: buildContinuePrompt({ title: design.title, kind: design.kind, folder: record.path, openComments }), commentIds: [], omitted: [], chip, handEdits: null };
    }

    // The user's hand edits since the last message ride along on every other purpose (§7.3).
    // A read only: the edits file is replaced atomically, and a damaged one reads as empty.
    const edits = await ensureEditService(ctx).editsFile.read(record.slug, record.path);
    const block = buildHandEditsBlock(edits.ledger, edits.dropped);
    const compactBlock = (): HandEditsBlock | null => buildHandEditsBlock(edits.ledger, edits.dropped, { compact: true });

    if (input.purpose === 'offline') {
      const external = await collectExternal(ctx, record);
      if (external.urls.length === 0) throw new ApiError('invalid', "This design doesn't load anything from the internet.");
      const text = buildOfflinePrompt({ title: design.title, kind: design.kind, folder: record.path, external, maxChars: budgetFor(block) });
      return { text: withBlock(block, text), commentIds: [], omitted: [], chip, handEdits: handEditsOf(block) };
    }

    if (input.purpose === 'ask') {
      const { element } = input;
      if (element !== null) {
        if (element.screen !== null && !design.screens.some((screen) => screen.id === element.screen)) {
          throw new ApiError('bad-request', 'That element is on a screen this design does not have.');
        }
        if (element.viewport !== PAGE_FILL_VIEWPORT_ID && !design.viewports.some((viewport) => viewport.id === element.viewport)) {
          throw new ApiError('bad-request', 'That element was picked at a viewport this design does not have.');
        }
      }
      // The words are never cut: the element detail goes first (the builder's ladder), then the
      // block shrinks to its compact form, then the block goes and the ledger stays for next time.
      const attempts: (HandEditsBlock | null)[] = block === null ? [null] : [block, compactBlock(), null];
      let over = 0;
      for (const use of attempts) {
        try {
          const { text } = buildAskPrompt({ title: design.title, kind: design.kind, folder: record.path, screens: design.screens, viewports: design.viewports, text: input.text, element, maxChars: budgetFor(use) });
          return { text: withBlock(use, text), commentIds: [], omitted: [], chip, handEdits: handEditsOf(use) };
        } catch (error) {
          if (!(error instanceof AskTooLongError)) throw error;
          over = error.over;
        }
      }
      throw new ApiError('invalid', `Your message is ${over} characters too long for the chat. Shorten it and send again.`);
    }
    if (input.purpose === 'checks') {
      // The findings the Checks badge counts, errors and warnings only: findings about files that changed since a render are not asked for.
      const checks = await ensureChecksService(ctx).forPrompt(record.slug);
      const counted = checks.findings.filter((finding) => finding.severity !== 'info');
      if (counted.length === 0) throw new ApiError('invalid', 'There is nothing to fix.');
      const base = {
        title: design.title,
        kind: design.kind,
        folder: record.path,
        findings: sortFindings(counted),
        renderStale: checks.renderStale,
        checkCommand: context.checkCommand,
      };
      let prompt = buildChecksPrompt({ ...base, maxChars: budgetFor(block) });
      let used = block;
      if (block !== null && prompt.omitted > 0) {
        // Findings had to go: give them the room back with the compact block, once.
        used = compactBlock();
        prompt = buildChecksPrompt({ ...base, maxChars: budgetFor(used) });
      }
      return { text: withBlock(used, prompt.text), commentIds: [], omitted: [], chip, handEdits: handEditsOf(used) };
    }

    // Validate the comment choice before spending time on the scan.
    const comments = selectComments(design.comments, input.commentIds);
    const base = {
      title: design.title,
      kind: design.kind,
      folder: record.path,
      screens: design.screens,
      viewports: design.viewports,
      comments,
      anchorStates: input.anchorStates,
      external: await collectExternal(ctx, record),
    };
    let prompt = buildRevisionPrompt({ ...base, maxChars: budgetFor(block) });
    let used = block;
    if (block !== null && prompt.level >= 2) {
      // Anchor text had to be shortened: try once more with the compact block before comments go.
      used = compactBlock();
      prompt = buildRevisionPrompt({ ...base, maxChars: budgetFor(used) });
    }
    return { text: withBlock(used, prompt.text), commentIds: prompt.commentIds, omitted: prompt.omitted, chip, handEdits: handEditsOf(used) };
  });

  router.on('POST /pages/from-message', async ({ body }): Promise<FromMessageResponse> => {
    const input = parseFromMessageBody(body);
    const messageText = ctx.uploads.take(input.uploadId);
    const html = extractHtml(messageText);
    if (html === null) throw new ApiError('no-html', 'This message has no HTML code block to open as a page.');
    const record = await ctx.store.create({
      kind: 'page',
      title: derivePageTitle(messageText, html, input.sessionTitle),
      brief: '',
      preset: null,
      projectDirectory: input.directory,
      sessionId: input.sessionId,
      html,
    });
    // The background action opens the rail next; the rail takes this on mount or on `added`.
    if (input.open) leaveOpenRequest(record.slug, 'view');
    return { slug: record.slug, title: record.design.title };
  });

  // A Work Status row or a chat block: open an existing design in the rail. The `open` event
  // reaches a rail that is already up; one opened next takes the request on mount.
  router.on('POST /open-request', async ({ body }): Promise<OkResponse> => {
    const { slug, intent } = parseOpenRequestBody(body);
    try {
      await ctx.store.dir(slug);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not-found') throw new ApiError('not-found', 'That design is no longer in your Designs folder.');
      throw error;
    }
    leaveOpenRequest(slug, intent);
    ctx.hub.emit({ slug, kind: 'open' });
    return { ok: true };
  });

  router.on('DELETE /open-request', (): OpenRequestResponse => {
    const taken = openRequest !== null && Date.now() - openRequest.at <= OPEN_REQUEST_TTL_MS ? openRequest.request : null;
    openRequest = null;
    return { request: taken };
  });
}
