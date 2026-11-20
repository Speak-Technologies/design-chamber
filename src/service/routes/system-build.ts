// Phase 2.5 S8 routes (documentation/specs/phase-2-5-technical.md §3.5, §5.9, §8.7, AD-16, AD-29):
// the /design-system chip and its build ticket, the ticket's state, Stop and its Undo. The proposal
// read and the living-page render (T17) still answer "not built yet".
//
// The router checks the bearer token first. Every parameter is checked against its pattern here,
// before any path is built; the ticket files live under `<root>/.chamber/system-builds/` (builds.ts,
// contained) and a system folder is reached only through the system store (`dir(id)`, contained).
// The project folder in the chip body is read-only input: validated as a scan folder and recorded in
// the ticket, never written.

import { pathToFileURL } from 'node:url';

import { buildSystemBuildChip, buildSystemTicketHeader, buildSystemTicketRules } from '../../shared/agent/system-prompts.ts';
import { systemContractSection } from '../../shared/agent/system-rules.ts';
import { buildSystemSkillBody } from '../../shared/agent/system-skill-doc.ts';
import type { RouteKey, StopBuildResponse, SystemBuildTicketResponse, SystemChipResponse, UndoStopResponse } from '../../shared/api.ts';
import { BRIEF_MAX, SESSION_ID_MAX, SYSTEM_PROPOSAL_ID_PATTERN, SYSTEM_STOP_UNDO_PATTERN, SYSTEMS_MAX } from '../../shared/limits.ts';
import { isReservedSystemId } from '../../shared/system-json.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { ensureBuildTickets, NOT_AN_UNDO_MESSAGE } from '../systems/builds.ts';
import { registerNotBuilt } from '../systems/not-built.ts';
import { validateScanFolder } from '../systems/scan-folder.ts';
import { ensureSystemStore, SYSTEMS_CAP_MESSAGE } from '../systems/store.ts';
import { projectDirectoryOf } from './chat.ts';
import { readSystemQuestions } from './presets.ts';

/** T17's routes, still stubs. */
const NOT_BUILT_KEYS: readonly RouteKey[] = [
  'GET /systems/:id/proposals/:proposalId',
  'GET /systems/:id/living-page/render',
  'GET /systems/:id/living-page/render/chunk',
];

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `POST /systems/chip` body (brief rules as `POST /chip`'s). Every field is untrusted. */
export const parseSystemChipBody = (body: unknown): { brief: string; projectDirectory: string | null; sessionId: string | null } => {
  if (!isRec(body)) throw new ApiError('bad-request', 'Send the design system request as a JSON object.');
  const { brief, sessionId } = body;
  if (brief !== undefined && brief !== null && typeof brief !== 'string') throw new ApiError('bad-request', 'The brief must be text.');
  const words = (typeof brief === 'string' ? brief : '').trim();
  if (words.length > BRIEF_MAX) {
    throw new ApiError('invalid', `The brief is ${words.length} characters; Design Chamber keeps ${BRIEF_MAX}. Shorten it, or send the extra detail in the chat after the command.`);
  }
  if (sessionId !== undefined && sessionId !== null && (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > SESSION_ID_MAX || /[\u0000-\u001f\u007f]/.test(sessionId))) {
    throw new ApiError('bad-request', `The chat id must be text of at most ${SESSION_ID_MAX} characters.`);
  }
  return { brief: words, projectDirectory: projectDirectoryOf(body.projectDirectory), sessionId: typeof sessionId === 'string' ? sessionId : null };
};

/** `POST /systems/:id/build/stop` body: `{ proposalId: id | null }`. */
const parseStopBody = (body: unknown): { proposalId: string | null } => {
  if (!isRec(body)) throw new ApiError('bad-request', 'Send the stop request as a JSON object.');
  const { proposalId } = body;
  if (proposalId === undefined || proposalId === null) return { proposalId: null };
  if (typeof proposalId !== 'string' || !SYSTEM_PROPOSAL_ID_PATTERN.test(proposalId)) throw new ApiError('bad-request', 'That is not a proposal id.');
  return { proposalId };
};

/**
 * Registers:
 * - 'POST /systems/chip'
 * - 'GET /system-builds/:ticket'
 * - 'POST /systems/:id/build/stop'
 * - 'POST /system-stops/:undoId/undo'
 * - 'GET /systems/:id/proposals/:proposalId' (T17, not built)
 * - 'GET /systems/:id/living-page/render' (T17, not built)
 * - 'GET /systems/:id/living-page/render/chunk' (T17, not built)
 */
export function registerSystemBuildRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /systems/chip', async ({ body }): Promise<SystemChipResponse> => {
    const input = parseSystemChipBody(body);
    // The cap first, so the user is not interviewed for a system that can't be made.
    const rows = await ensureSystemStore(ctx).list();
    if (rows.filter((row) => !isReservedSystemId(row.id)).length >= SYSTEMS_MAX) throw new ApiError('conflict', SYSTEMS_CAP_MESSAGE);
    const root = ctx.settings.root();
    // A chat in the designs folder, or with no usable project, builds an internal system (§2.12): no error.
    const projectDirectory = input.projectDirectory === null ? null : await validateScanFolder(input.projectDirectory, root).catch(() => null);
    const skillBody = buildSystemSkillBody({ systemQuestions: await readSystemQuestions(ctx.packageRoot), contract: systemContractSection() });
    const { ticket, rulesFile } = await ensureBuildTickets(ctx).issue({
      projectDirectory,
      sessionId: input.sessionId,
      rulesFor: (issued) => buildSystemTicketRules(buildSystemTicketHeader({ ticket: issued.ticket, root, projectDirectory: issued.projectDirectory }), skillBody),
    });
    const chip = buildSystemBuildChip({
      ticket: ticket.ticket,
      brief: input.brief,
      projectDirectory: ticket.projectDirectory,
      rulesFile,
      rulesUrl: pathToFileURL(rulesFile).href,
      created: ticket.created,
    });
    return { ticket: ticket.ticket, chip };
  });

  router.on('GET /system-builds/:ticket', ({ params }): Promise<SystemBuildTicketResponse> => ensureBuildTickets(ctx).get(params.ticket));

  router.on('POST /systems/:id/build/stop', ({ params, body }): Promise<StopBuildResponse> => {
    const input = parseStopBody(body);
    // The id is checked by the store's `dir(id)` (pattern, containment, a real folder) before anything moves.
    return ensureBuildTickets(ctx).stop(params.id, input);
  });

  router.on('POST /system-stops/:undoId/undo', ({ params }): Promise<UndoStopResponse> => {
    if (!SYSTEM_STOP_UNDO_PATTERN.test(params.undoId)) throw new ApiError('bad-request', NOT_AN_UNDO_MESSAGE);
    return ensureBuildTickets(ctx).undoStop(params.undoId);
  });

  registerNotBuilt(router, NOT_BUILT_KEYS);
}
