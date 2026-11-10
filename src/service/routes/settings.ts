// WP1 — GET /settings, PUT /settings (docs/SPEC.md §7, §9.2; documentation/specs/agent-guidance-and-pages.md
// §3.3), and DELETE /agent/skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4).

import type { PreviousRoot, RemoveSkillResponse, SettingsResponse } from '../../shared/api.ts';
import { SETTINGS_PATH_MAX } from '../../shared/limits.ts';
import type { AgentSetup } from '../agent-setup.ts';
import { resolveBrowser } from '../chrome.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { countDesigns, exampleDesignsFolder, isDirectory, resolveDownloadsDir } from '../root.ts';

const isBodyRecord = (body: unknown): body is Record<string, unknown> =>
  typeof body === 'object' && body !== null && !Array.isArray(body);

/** Assemble the §7 settings answer from the store (previousRoots carry live counts). Guide and skill state are read, never written, here. */
const buildSettingsResponse = async (ctx: ServiceContext, agent: AgentSetup): Promise<SettingsResponse> => {
  const file = ctx.settings.read();
  const root = ctx.settings.root();
  const previousRoots: PreviousRoot[] = [];
  for (const entry of file.previousRoots ?? []) {
    const exists = await isDirectory(entry);
    previousRoots.push({ path: entry, exists, designCount: exists ? await countDesigns(entry) : 0 });
  }
  return {
    root,
    defaultRoot: ctx.settings.defaultRoot(),
    previousRoots,
    rootExists: await isDirectory(root),
    // The browser thumbnails will use: the user's setting when that file exists, else a detected install.
    chrome: resolveBrowser(file),
    downloadsDir: await resolveDownloadsDir(root, file.downloadsDir),
    // A guide write queued by a root change (PUT just before) lands first, so the answer is current.
    agent: { guide: await agent.idle().then(() => agent.guideStatus(root)), skill: await agent.skillStatus() },
  };
};

const validateRoot = (raw: unknown): string | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.trim() === '' || raw.includes('\0') || raw.length > SETTINGS_PATH_MAX) {
    throw new ApiError('bad-path', `The designs folder must be a full folder path (for example ${exampleDesignsFolder()}).`);
  }
  return raw;
};

const validateChromePath = (raw: unknown): string | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.trim() === '' || raw.includes('\0') || raw.length > SETTINGS_PATH_MAX) {
    throw new ApiError('bad-path', 'The browser path must be the full path to the browser executable.');
  }
  return raw;
};

/**
 * Registers:
 * - 'GET /settings'
 * - 'PUT /settings'
 * - 'DELETE /agent/skill'
 */
export function registerSettingsRoutes(router: Router, ctx: ServiceContext, agent: AgentSetup): void {
  router.on('GET /settings', async (): Promise<SettingsResponse> => buildSettingsResponse(ctx, agent));

  router.on('PUT /settings', async ({ body }): Promise<SettingsResponse> => {
    if (body !== undefined && !isBodyRecord(body)) throw new ApiError('bad-request', 'The settings update must be a JSON object.');
    const record = body ?? {};
    if (!('root' in record) && !('chromePath' in record)) {
      throw new ApiError('bad-request', 'Say what to change: "root" and/or "chromePath".');
    }
    const root = validateRoot(record.root);
    const chromePath = validateChromePath(record.chromePath);
    // The store validates the path itself (absolute, not a drive root, not inside the
    // extension, creatable — 400 bad-path), persists atomically and never moves files.
    await ctx.settings.update({
      ...(root !== undefined ? { root } : {}),
      ...(chromePath !== undefined ? { chromePath } : {}),
    });
    return buildSettingsResponse(ctx, agent);
  });

  // The user's click on "Remove old copy" in Settings. The request carries nothing the handler
  // reads: the target is the fixed skillTarget path, and it goes only when it is ours and unedited.
  router.on('DELETE /agent/skill', async (): Promise<RemoveSkillResponse> => ({ skill: await agent.removeOldSkill() }));
}
