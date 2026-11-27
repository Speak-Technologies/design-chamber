// WP2 — POST /designs/:slug/export, POST /reveal (docs/SPEC.md §7, §4.3, §9.5).
// System builder depth T19: GET and POST /systems/:id/export (token export).

import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { ExportBody, ExportResponse, OkResponse, SystemExportOptionsResponse, SystemExportResponse } from '../../shared/api.ts';
import { exportReadme, hasExportableTokens, leftOutValues, toDesignTokensJson, toTailwindTheme, toTokensCss, type RenamedToken } from '../../shared/token-export.ts';
import type { SystemDetail, SystemState, TokenExportFormat } from '../../shared/types.ts';
import { ApiError, type Router } from '../http.ts';
import type { ServiceContext } from '../context.ts';
import { createExportService, type ExportService, type SystemExportFile } from '../export.ts';
import { createRevealRegistry, createRevealService, type RevealService } from '../reveal.ts';
import { TAILWIND_CONFIG } from '../systems/extract-rules.ts';
import { ensureSystemStore } from '../systems/store.ts';

type ExportLane = { exports: ExportService; reveal: RevealService };

// One registry per context: /reveal accepts exactly the paths THIS service's /export issued.
const lanes = new WeakMap<ServiceContext, ExportLane>();

const laneOf = (ctx: ServiceContext): ExportLane => {
  const existing = lanes.get(ctx);
  if (existing) return existing;
  const registry = createRevealRegistry();
  const lane: ExportLane = {
    exports: createExportService({ store: ctx.store, settings: ctx.settings, log: ctx.log, issue: registry.issue }),
    reveal: createRevealService({ store: ctx.store, log: ctx.log, registry, systems: ensureSystemStore(ctx) }),
  };
  lanes.set(ctx, lane);
  return lane;
};

/**
 * Registers:
 * - 'POST /designs/:slug/export'
 * - 'POST /reveal'
 * The export body is validated at the boundary; reveal refuses every path the service did not
 * issue itself and that is not a design folder. Its system form derives the path from the system.
 */
export function registerExportRoutes(router: Router, ctx: ServiceContext): void {
  const lane = laneOf(ctx);
  registerSystemExportRoutes(router, ctx);

  router.on('POST /designs/:slug/export', async ({ params, body }): Promise<ExportResponse> => {
    const input = (body ?? {}) as Partial<ExportBody>;
    if (input.format !== 'zip' && input.format !== 'html') throw new ApiError('bad-request', 'The export format must be "zip" or "html".');
    if (input.screen !== undefined && typeof input.screen !== 'string') throw new ApiError('bad-request', 'That is not a screen id.');
    return lane.exports.export(params.slug, { format: input.format, ...(typeof input.screen === 'string' ? { screen: input.screen } : {}) });
  });

  router.on('POST /reveal', async ({ body }): Promise<OkResponse> => {
    // Safe: untrusted JSON, every field is checked below before use.
    const input = (body ?? {}) as { path?: unknown; system?: unknown; target?: unknown };
    // Phase 2.5 §3.5: the system form takes no path; the service derives it from the system's state.
    if (input.system !== undefined) {
      if (input.path !== undefined) throw new ApiError('bad-request', 'Reveal takes a path or a design system, not both.');
      await lane.reveal.revealSystem(input.system, input.target);
      return { ok: true };
    }
    if (typeof input.path !== 'string') throw new ApiError('bad-path', 'That is not a path Design Chamber can open.');
    await lane.reveal.reveal(input.path);
    return { ok: true };
  });
}

// ---- system-builder-depth Phase 3 (§13 T19): token export ----

export const TAILWIND_NOT_USED = "This project doesn't use Tailwind, so there's no Tailwind file to export.";
export const NO_TOKENS_TO_EXPORT = 'This design system has no tokens to export yet.';
const BAD_EXPORT_BODY = 'The export takes a list of formats: "dtcg", "css" or "tailwind", each once.';

const ALL_FORMATS: readonly TokenExportFormat[] = ['dtcg', 'css', 'tailwind'];
const TAILWIND_CONFIG_NAMES: readonly string[] = ['js', 'cjs', 'mjs', 'ts'].map((ext) => `tailwind.config.${ext}`);

const isFile = async (file: string): Promise<boolean> => (await stat(file).catch(() => null))?.isFile() === true;

/**
 * Whether the system's project uses Tailwind, without reading a project file: a `tailwind.config.*` at the
 * root of the code source (a `stat`), one the last scan listed for the agent, or BUILD.json's drift kinds.
 */
export const usesTailwind = async (state: SystemState, detail: Pick<SystemDetail, 'agentDrift'>): Promise<boolean> => {
  if (detail.agentDrift?.kinds.includes('tailwind-config') === true) return true;
  const code = state.sources.code;
  if (code === null) return false;
  if (code.forAgent?.some((file) => TAILWIND_CONFIG.test(file.path.split(/[\\/]/).at(-1) ?? '')) === true) return true;
  // The folder the scan read, and the project when that folder is a location inside one.
  for (const folder of [code.directory, code.project]) {
    if (folder === undefined || !path.isAbsolute(folder) || folder.includes('\u0000')) continue;
    for (const name of TAILWIND_CONFIG_NAMES) {
      if (await isFile(path.join(folder, name))) return true;
    }
  }
  return false;
};

/** The closed body `{ formats? }`: the formats asked for in a fixed order, or null for "all of them". */
export const parseSystemExportBody = (body: unknown): TokenExportFormat[] | null => {
  const refuse = (): ApiError => new ApiError('bad-request', BAD_EXPORT_BODY);
  if (body === undefined) return null;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw refuse();
  if (Object.keys(body).some((key) => key !== 'formats')) throw refuse();
  // Safe: untrusted JSON; the one allowed key is checked below.
  const { formats } = body as { formats?: unknown };
  if (formats === undefined) return null;
  if (!Array.isArray(formats) || formats.length === 0 || new Set(formats).size !== formats.length) throw refuse();
  if (!formats.every((format) => (ALL_FORMATS as readonly unknown[]).includes(format))) throw refuse();
  return ALL_FORMATS.filter((format) => formats.includes(format));
};

/** The ZIP's files for the chosen formats, with README.txt when a name was changed or a value left out. */
export const tokenExportFiles = (detail: Pick<SystemDetail, 'tokens'>, formats: readonly TokenExportFormat[]): { files: SystemExportFile[]; renamed: number } => {
  const files: SystemExportFile[] = [];
  let renamed: RenamedToken[] = [];
  if (formats.includes('dtcg')) {
    const json = toDesignTokensJson(detail);
    renamed = json.renamed;
    files.push({ name: 'tokens.json', text: json.text });
  }
  if (formats.includes('css')) files.push({ name: 'tokens.css', text: toTokensCss(detail) });
  if (formats.includes('tailwind')) files.push({ name: 'tailwind-theme.css', text: toTailwindTheme(detail) });
  const readme = exportReadme(renamed, leftOutValues(detail));
  if (readme !== null) files.push({ name: 'README.txt', text: readme });
  return { files, renamed: renamed.length };
};

/**
 * Registers (called from `registerExportRoutes`, so the write goes through this file's reveal registry):
 * - 'GET /systems/:id/export'
 * - 'POST /systems/:id/export'
 * The id goes through the system store (pattern, real folder, containment); tokens are read from
 * `filesDir`, so a repo-backed system exports its snapshot. Nothing is written in a project folder.
 */
export function registerSystemExportRoutes(router: Router, ctx: ServiceContext): void {
  /** What the system is and which formats it can export; throws the store's 400 or 404 for a bad id. */
  const read = async (id: string): Promise<{ detail: SystemDetail; formats: TokenExportFormat[] }> => {
    const systems = ensureSystemStore(ctx);
    const detail = await systems.detail(id);
    const tailwind = await usesTailwind(await systems.readState(id), detail);
    return { detail, formats: ALL_FORMATS.filter((format) => format !== 'tailwind' || tailwind) };
  };

  router.on('GET /systems/:id/export', async ({ params }): Promise<SystemExportOptionsResponse> => ({ formats: (await read(params.id)).formats }));

  router.on('POST /systems/:id/export', async ({ params, body }): Promise<SystemExportResponse> => {
    const asked = parseSystemExportBody(body);
    const { detail, formats: offered } = await read(params.id);
    const formats = asked ?? offered;
    if (formats.some((format) => !offered.includes(format))) throw new ApiError('invalid', TAILWIND_NOT_USED);
    if (detail.unreadable !== null) throw new ApiError('invalid', detail.unreadable);
    if (!hasExportableTokens(detail)) throw new ApiError('invalid', NO_TOKENS_TO_EXPORT);
    const { files, renamed } = tokenExportFiles(detail, formats);
    const written = await laneOf(ctx).exports.systemTokens(detail.id, files);
    return { ...written, formats, renamed };
  });
}

// ---- end system-builder-depth Phase 3 ----
