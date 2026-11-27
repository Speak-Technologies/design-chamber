// The design system's chat prompts (documentation/specs/phase-2-5-technical.md §3.1, §3.5, §8.5,
// §8.10, T15): POST /systems/:id/prompt serves make, ask, review, resync-notes, checks, continue,
// living-page, reconcile and build-continue, and refreshes `<system>/.chamber/RULES.md` on every
// call (§8.4). The router checks the bearer token first; the id is checked and contained by the
// system store (`SYSTEM_ID_PATTERN`, `resolveInside`, no link). No body carries a path: the names,
// notes and versions a message cites are read from the system's own files and history.
//
// The living-page branch regenerates the staged page first and refuses when it has a problem; the
// reconcile branch recounts the code drift first (§5.12). Their refusals (an internal home, no
// drift) work either way. Every message rides the system's hand-edit block when its ledger has
// entries (§8.5), shrunk to its compact form or left for the next message when it would not fit.

import { pathToFileURL } from 'node:url';

import { buildHandEditsBlock, type HandEditsBlock } from '../../shared/agent/hand-edits.ts';
import { joinFolder } from '../../shared/agent/context.ts';
import {
  buildSystemAskPrompt,
  buildSystemBuildContinuePrompt,
  buildSystemChecksPrompt,
  buildSystemChip,
  buildSystemContinuePrompt,
  buildSystemLivingPagePrompt,
  buildSystemMakePrompt,
  buildSystemReconcilePrompt,
  buildSystemResyncNotesPrompt,
  buildSystemReviewPrompt,
  SystemPromptTooLongError,
  withSystemHandEdits,
  type SystemPromptSystem,
} from '../../shared/agent/system-prompts.ts';
import { buildSystemRules } from '../../shared/agent/system-rules.ts';
import type { SystemPromptBody, SystemPromptResponse } from '../../shared/api.ts';
import { sortFindings, withMessage } from '../../shared/checks.ts';
import { ASK_TEXT_MAX, HOST_TEXT_MAX, VERSION_ID_PATTERN } from '../../shared/limits.ts';
import { componentDiff, tokenDiff } from '../../shared/system-copy.ts';
import { parseEntryKey, sectionOfEntry } from '../../shared/system-board.ts';
import { buildSystemDetail, isSystemSection } from '../../shared/system-json.ts';
import type { SystemSection } from '../../shared/types.ts';
import { ensureLauncherService } from '../check/launcher.ts';
import { runSystemCheck } from '../check/system-run.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { recomputeDrift } from '../systems/drift.ts';
import { ensureSystemEditService } from '../systems/edits.ts';
import { livingPageState, regenerateLivingPage } from '../systems/living-page.ts';
import { ensureSystemStore } from '../systems/store.ts';
import { ensureSystemVersions } from '../systems/versions.ts';
import { writeRulesFile } from './chat.ts';
import { SYSTEM_COMMENTS_NOT_READY } from './system-comments.ts';
import { findSystemReferenceDir } from './presets.ts';

const PURPOSES: readonly SystemPromptBody['purpose'][] = ['make', 'ask', 'review', 'resync-notes', 'checks', 'continue', 'living-page', 'reconcile', 'build-continue'];

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

type PromptInput = {
  purpose: SystemPromptBody['purpose'];
  /** Ask only: the user's words, trimmed (1 to ASK_TEXT_MAX). */
  text: string;
  /** Ask only: the board entry, pattern-checked here and checked against the detail in the handler. */
  entry: string | null;
  /** Review only: the section marked needs-work. */
  section: SystemSection | null;
  /** Resync-notes only: the version to compare against. */
  before: string | null;
};

/** `POST /systems/:id/prompt` body. Every field is untrusted. */
export const parseSystemPromptBody = (body: unknown): PromptInput => {
  if (!isRec(body)) throw new ApiError('bad-request', 'Send the prompt request as a JSON object.');
  const { purpose } = body;
  // system-builder-depth Phase 3, Wave 0 (§13 T20): the comments message is T20's; until then it isn't ready.
  if (purpose === 'comments') throw new ApiError('internal', SYSTEM_COMMENTS_NOT_READY);
  if (typeof purpose !== 'string' || !PURPOSES.includes(purpose as SystemPromptBody['purpose'])) {
    throw new ApiError('bad-request', 'The prompt purpose must be "make", "ask", "review", "resync-notes", "checks", "continue", "living-page", "reconcile" or "build-continue".');
  }
  const base: PromptInput = { purpose: purpose as SystemPromptBody['purpose'], text: '', entry: null, section: null, before: null };
  if (purpose === 'ask') {
    if (typeof body.text !== 'string' || body.text.trim() === '') throw new ApiError('bad-request', 'Write what you want the agent to do.');
    const text = body.text.trim();
    if (text.length > ASK_TEXT_MAX) {
      throw new ApiError('invalid', `Your message is ${text.length - ASK_TEXT_MAX} characters over the limit of ${ASK_TEXT_MAX}. Shorten it and send again.`);
    }
    const entry = body.entry === undefined || body.entry === null ? null : body.entry;
    if (entry !== null && (typeof entry !== 'string' || !parseEntryKey(entry))) throw new ApiError('bad-request', 'That is not a board entry.');
    return { ...base, text, entry: entry as string | null };
  }
  if (purpose === 'review') {
    if (typeof body.section !== 'string' || !isSystemSection(body.section)) throw new ApiError('bad-request', "That isn't a section of a design system.");
    return { ...base, section: body.section };
  }
  if (purpose === 'resync-notes') {
    if (typeof body.before !== 'string' || !VERSION_ID_PATTERN.test(body.before)) throw new ApiError('bad-request', 'Say which version to compare against.');
    return { ...base, before: body.before };
  }
  return base;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Registers:
 * - 'POST /systems/:id/prompt'
 */
export function registerSystemChatRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /systems/:id/prompt', async ({ params, body }): Promise<SystemPromptResponse> => {
    const input = parseSystemPromptBody(body);
    const systems = ensureSystemStore(ctx);
    const id = params.id;
    const source = await systems.get(id);
    const state = source.state;
    const detail = buildSystemDetail(source);
    const system: SystemPromptSystem = {
      id,
      name: state.name,
      folder: source.dir,
      repo: state.home?.kind === 'repo' ? { directory: state.home.directory, folder: state.home.folder, livingPage: state.home.livingPage } : null,
    };

    // The system's RULES.md is refreshed on every prompt (§8.4); a failed refresh leaves the
    // earlier copy in place and the message still goes out, as for a design.
    const checkCommand = await ensureLauncherService(ctx).commandFor(ctx.settings.root(), `--system ${id}`);
    const referenceDir = await findSystemReferenceDir(ctx.packageRoot);
    const rulesText = buildSystemRules({
      id,
      name: state.name,
      folder: source.dir,
      projectDirectory: state.build?.projectDirectory ?? state.sources.code?.project ?? state.sources.code?.directory ?? null,
      home: state.home?.kind === 'repo' ? { kind: 'repo', directory: state.home.directory, folder: state.home.folder } : { kind: 'internal' },
      checkCommand,
      referenceDir,
    });
    try {
      await writeRulesFile(source.dir, rulesText, 'system');
    } catch (error) {
      ctx.log.warn('systems.rules-refresh-failed', { id, error: errorText(error) });
    }

    // The hand-edit block rides along on every system message (§8.5); the ledger is read only.
    const edits = await ensureSystemEditService(ctx).editsFile.read(id, source.dir);
    const block = buildHandEditsBlock(edits.ledger, edits.dropped);
    const compactBlock = (): HandEditsBlock | null => buildHandEditsBlock(edits.ledger, edits.dropped, { compact: true });
    const chip = buildSystemChip(system, { folderUrl: pathToFileURL(source.dir).href, created: state.created });

    /** Build with the block, then the compact block, then none; the ledger stays for next time. */
    const deliver = (build: (maxChars: number) => string, tooLong: (over: number) => string): SystemPromptResponse => {
      const attempts: (HandEditsBlock | null)[] = block === null ? [null] : [block, compactBlock(), null];
      let over = 0;
      for (const use of attempts) {
        try {
          const text = build(HOST_TEXT_MAX - (use === null ? 0 : use.text.length + 2));
          return { text: withSystemHandEdits(use?.text ?? null, text), chip, handEdits: use === null ? null : { upTo: use.upTo, count: use.count } };
        } catch (error) {
          if (!(error instanceof SystemPromptTooLongError)) throw error;
          over = error.over;
        }
      }
      throw new ApiError('invalid', tooLong(over));
    };
    const messageTooLong = (over: number): string => `The message is ${over} characters too long for the chat. Shorten the request and send again.`;

    if (input.purpose === 'make') {
      // Phase 2.6 AD-9: a system made from a location names its project (not the location) and what to read first.
      const existing = state.sources.code?.existing;
      return deliver(
        (maxChars) =>
          buildSystemMakePrompt({
            system,
            projectDirectory: state.sources.code?.project ?? state.sources.code?.directory ?? state.build?.projectDirectory ?? null,
            existing: existing === undefined ? null : { location: existing.location, page: existing.read.page, docs: existing.read.docs, components: existing.read.components },
            scanned: state.sources.code?.scanned ?? [],
            forAgent: state.sources.code?.forAgent ?? [],
            brandFiles: (state.sources.brand?.files ?? []).map((file) => joinFolder(source.dir, file)),
            description: state.sources.description?.text ?? null,
            preset: state.sources.description?.preset ?? null,
            checkCommand,
            referenceDir,
            maxChars,
          }),
        messageTooLong,
      );
    }

    if (input.purpose === 'ask') {
      if (input.entry !== null) {
        const key = parseEntryKey(input.entry);
        if (key === null || sectionOfEntry(key, detail) === null) throw new ApiError('bad-request', 'That entry is not in this design system.');
      }
      return deliver(
        (maxChars) => buildSystemAskPrompt({ system, text: input.text, entry: input.entry, section: null, maxChars }),
        (over) => `Your message is ${over} characters too long for the chat. Shorten it and send again.`,
      );
    }

    if (input.purpose === 'review') {
      // Safe: parseSystemPromptBody checked the section; the review record is the stored one.
      const section = input.section as SystemSection;
      const review = detail.review[section];
      if (review.state !== 'needs-work') throw new ApiError('invalid', "That section isn't marked as needing work.");
      return deliver((maxChars) => buildSystemReviewPrompt({ system, section, note: review.note ?? '', maxChars }), messageTooLong);
    }

    if (input.purpose === 'resync-notes') {
      // Safe: parseSystemPromptBody checked the version id.
      const before = input.before as string;
      const { source: old } = await ensureSystemVersions(ctx).readTree(id, before);
      const oldCss = await old.read('tokens.css');
      const oldJson = await old.read('system.json');
      const tokens = tokenDiff(oldCss === null ? null : oldCss.bytes.toString('utf8'), source.tokensCss);
      const components = componentDiff(oldJson === null ? null : oldJson.bytes.toString('utf8'), source.systemJson);
      return deliver(
        (maxChars) =>
          buildSystemResyncNotesPrompt({
            system,
            before,
            tokens: { added: tokens.added, changed: tokens.changed.map((change) => change.name) },
            components: { added: components.added, changed: components.changed },
            maxChars,
          }),
        messageTooLong,
      );
    }

    if (input.purpose === 'checks') {
      const { report } = await runSystemCheck(systems, id, { now: new Date(), tool: 'service' });
      const counted = sortFindings(report.static.findings.map((finding) => withMessage(finding)).filter((finding) => finding.severity !== 'info'));
      if (counted.length === 0) throw new ApiError('invalid', 'There is nothing to fix.');
      return deliver(
        (maxChars) =>
          buildSystemChecksPrompt({
            system,
            findings: counted.map((finding) => ({ message: finding.message, ...(finding.detail !== undefined && finding.detail !== '' ? { detail: finding.detail } : {}) })),
            checkCommand,
            maxChars,
          }).text,
        messageTooLong,
      );
    }

    if (input.purpose === 'continue') {
      return deliver(() => buildSystemContinuePrompt(system), messageTooLong);
    }

    if (input.purpose === 'living-page') {
      if (state.home?.kind !== 'repo') throw new ApiError('invalid', 'Only a design system kept in a project repo has a living page.');
      const home = state.home;
      const stagedFile = joinFolder(source.dir, '.chamber', 'living-page.html');
      // The staged problem codes (§2.14) as the user reads them (§9.6's living-page card).
      const reasonOf = (problem: string): string =>
        problem === 'too-large'
          ? 'It would be too large'
          : problem === 'bundle'
            ? "A file couldn't be embedded"
            : problem === 'unsafe'
              ? "It didn't pass the safety check"
              : problem === 'secret'
                ? 'It would show something shaped like a secret'
                : problem === 'no-snapshot'
                  ? "The repo folder hasn't been read yet"
                  : problem;
      const ready = async (): Promise<{ revision: number }> => {
        const view = await livingPageState(ctx, id);
        if (view.home !== 'repo' || view.staged === null || view.staged.problem !== null) {
          const reason = view.home === 'repo' ? reasonOf(view.staged?.problem ?? "It hasn't been generated yet") : 'The system no longer lives in a repo';
          throw new ApiError('invalid', `Design Chamber couldn't generate the living page. ${reason}.`);
        }
        return { revision: view.staged.revision };
      };
      // Regenerate first (§8.10), then refuse unless the staged page has no problem.
      await regenerateLivingPage(ctx, id, { source: 'snapshot' });
      const staged = await ready();
      return deliver(
        (maxChars) => buildSystemLivingPagePrompt({ system: { ...system, repo: { directory: home.directory, folder: home.folder, livingPage: home.livingPage } }, stagedFile, revision: staged.revision, maxChars }),
        messageTooLong,
      );
    }

    if (input.purpose === 'reconcile') {
      // Drift is recomputed first (§5.12), then both numbers are cited, each labelled.
      await recomputeDrift(ctx, id);
      const fresh = buildSystemDetail(await systems.get(id));
      const code = fresh.codeDrift;
      const agent = fresh.agentDrift;
      if ((code?.differ ?? 0) === 0 && (agent?.differ ?? 0) === 0) throw new ApiError('invalid', 'There is nothing to reconcile.');
      const mode = code?.mode ?? (fresh.build?.mode === 'describe' ? 'describe' : 'fix');
      return deliver((maxChars) => buildSystemReconcilePrompt({ system, mode, code, agent, maxChars }), messageTooLong);
    }

    // build-continue: a chat build with a problem, or one still under way (§3.5).
    if (state.build == null && state.buildProblem == null) throw new ApiError('invalid', "This system wasn't started from a chat build, so there is no build to pick up.");
    return deliver((maxChars) => buildSystemBuildContinuePrompt({ system, problem: detail.buildProblem, maxChars }), messageTooLong);
  });
}
