// WP1 — GET /settings, PUT /settings (docs/SPEC.md §7, §9.2; documentation/specs/agent-guidance-and-pages.md
// §3.3), and DELETE /agent/skill (documentation/specs/phase-1-5-sdk-2-7.md §U2.4).

import type { PreviousRoot, RemoveSkillResponse, SettingsResponse } from '../../shared/api.ts';
import { SETTINGS_PATH_MAX, SYSTEM_PINS_MAX } from '../../shared/limits.ts';
import { settingsSystemsView, type SettingsViewSystem } from '../../shared/systems.ts';
import type { SystemDefaultSetting, SystemPinSetting } from '../../shared/types.ts';
import type { AgentSetup } from '../agent-setup.ts';
import { resolveBrowser } from '../chrome.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { countDesigns, exampleDesignsFolder, isDirectory, resolveDownloadsDir } from '../root.ts';
import { normalizeSystemDefault, normalizeSystemPins } from '../settings.ts';
import { ensureSystemStore } from '../systems/store.ts';

const isBodyRecord = (body: unknown): body is Record<string, unknown> =>
  typeof body === 'object' && body !== null && !Array.isArray(body);

/**
 * The default and the pins resolved against this root's systems, plus the one-time notices (§3.4). When the
 * systems cannot be listed nothing is known to be gone, so every setting reads as fine rather than "deleted".
 */
const buildSystemsView = async (ctx: ServiceContext): Promise<SettingsResponse['systems']> => {
  const store = ensureSystemStore(ctx);
  const file = ctx.settings.read();
  let systems: SettingsViewSystem[];
  try {
    systems = (await store.list()).map(({ id, name, status, unreadable }) => ({ id, name, status, unreadable }));
  } catch (error) {
    ctx.log.warn('settings.systems-unlistable', { error: error instanceof Error ? error.message : String(error) });
    systems = [file.systemDefault, ...(file.systemPins ?? [])].flatMap((entry) =>
      entry?.choice === 'system' && entry.id !== undefined ? [{ id: entry.id, name: entry.name ?? entry.id, status: 'ready' as const, unreadable: null }] : [],
    );
  }
  return settingsSystemsView({ settings: file, systems, notices: store.takeNotices() });
};

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
    systems: await buildSystemsView(ctx),
  };
};

/** The keys `PUT /settings` takes; a body with none of them says what it could have changed. */
const SETTINGS_FIELDS = ['root', 'chromePath', 'systemDefault', 'systemPins'] as const;

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
 * The default system for new designs (§2.9). `null` resets it to ask. The store's own normaliser decides what a
 * valid choice is, so a body is refused here exactly when the file would have dropped it.
 */
const validateSystemDefault = (raw: unknown): SystemDefaultSetting | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const choice = normalizeSystemDefault(raw);
  if (choice === null) {
    throw new ApiError('bad-request', 'The default design system must be { "choice": "ask" }, { "choice": "none" } or { "choice": "system", "id": …, "name": … } naming a system by its id and name.');
  }
  return choice;
};

/**
 * The whole pin list (§2.9). `null` clears it. Nothing is dropped quietly: a pin the file would not keep (a relative
 * or control-character folder, a bad system id, a folder pinned twice) refuses the whole save, so the caller never
 * thinks a pin is stored when it is not. A pin naming a system that is gone is kept: Settings sends the existing
 * pins back with every change, and the pin comes back to life when that system does.
 */
const validateSystemPins = (raw: unknown): SystemPinSetting[] | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) throw new ApiError('bad-request', 'The project pins must be a list of { "directory", "choice" } entries.');
  if (raw.length > SYSTEM_PINS_MAX) throw new ApiError('bad-request', `You can pin at most ${SYSTEM_PINS_MAX} projects. Remove one first.`);
  const pins = normalizeSystemPins(raw);
  if (pins.length !== raw.length) {
    throw new ApiError('bad-request', 'Each project pin needs a full folder path, a choice of "default", "none" or "system", and a system id and name for "system". A folder can be pinned once.');
  }
  return pins;
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
    if (!SETTINGS_FIELDS.some((field) => field in record)) {
      throw new ApiError('bad-request', 'Say what to change: "root", "chromePath", "systemDefault" and/or "systemPins".');
    }
    // Every field is checked before any is saved, so a bad one never leaves a half-applied update.
    const root = validateRoot(record.root);
    const chromePath = validateChromePath(record.chromePath);
    const systemDefault = validateSystemDefault(record.systemDefault);
    const systemPins = validateSystemPins(record.systemPins);
    // The store validates the path itself (absolute, not a drive root, not inside the
    // extension, creatable — 400 bad-path), persists atomically and never moves files.
    await ctx.settings.update({
      ...(root !== undefined ? { root } : {}),
      ...(chromePath !== undefined ? { chromePath } : {}),
      ...(systemDefault !== undefined ? { systemDefault } : {}),
      ...(systemPins !== undefined ? { systemPins } : {}),
    });
    return buildSettingsResponse(ctx, agent);
  });

  // The user's click on "Remove old copy" in Settings. The request carries nothing the handler
  // reads: the target is the fixed skillTarget path, and it goes only when it is ours and unedited.
  router.on('DELETE /agent/skill', async (): Promise<RemoveSkillResponse> => ({ skill: await agent.removeOldSkill() }));
}
