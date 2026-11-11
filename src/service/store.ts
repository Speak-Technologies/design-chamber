// The designs store (docs/SPEC.md §9.3, §6.1–§6.3): everything the service knows about the
// design folders under the root — listing, reading, creating, patching, trashing, comments —
// and the two-writer merge that keeps `design.json` (agent-written) and `.chamber/state.json`
// (service-owned truth) consistent.
//
// Merge rule (§6.3): service-owned fields (version, kind, created, brief, sessionId,
// projectDirectory, preset, entry, comments) live in state.json; design.json carries a
// mirror. Service writes go state.json first, then the mirror (agent fields, unknown keys
// and key order preserved; skipped when the bytes are equal → no watch loop). When the
// watcher reports a design.json change, `reconcile` re-reads both files and re-merges the
// mirror if any service-owned field drifted — an agent overwrite that dropped the comments
// is restored. A design.json that fails to parse is NEVER written over (WP0 deviation 8);
// a missing one is created on the first service-side mutation (§6.1).
//
// Take-over (§6.3 P1–P5, documentation/specs/agent-guidance-and-pages.md §3.2): an agent may
// write the HTML before design.json. Then state.json is seeded `provisional` from the files
// (P1), comments on it stay in state.json and no design.json is invented (P3), and when the
// agent's design.json parses its values are adopted instead of overwritten (P2). A rename or
// link claims the folder for the user and ends the provisional phase (P4). While nothing is
// written and nobody commented, the agent may still switch the kind (P5).
//
// All writes are tmp+rename (`writeFileAtomic`); every path from a slug goes through
// `resolveInside`; per-slug locks serialise read-modify-write cycles.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import type { CreateCommentBody, PatchCommentBody, PatchDesignBody } from '../shared/api.ts';
import {
  adoptAgentFields,
  applyServiceState,
  createDesignDocument,
  DESIGN_JSON_FILE,
  ENTRY_FILE,
  mergeServiceFields,
  normalizeDesign,
  normalizeKind,
  normalizeServiceState,
  parseDesignJsonText,
  screenFileOf,
  serializeJson,
  serviceFieldsDiffer,
  serviceStateOf,
  type ServiceWrite,
} from '../shared/design-json.ts';
import {
  BRIEF_MAX,
  COMMENTS_MAX,
  TITLE_MAX,
} from '../shared/limits.ts';
import type {
  Comment,
  DesignFiles,
  DesignJson,
  DesignKind,
  DesignSummary,
  DesignWarning,
  FileStatus,
  JsonObject,
  JsonValue,
  ServiceState,
  ThumbState,
} from '../shared/types.ts';
import { chipMarkerOf } from '../shared/agent/chip.ts';
import type { ChangeHub, DesignRecord, DesignStore, LinkIfUnlinkedOutcome, Logger, SettingsStore, ThumbnailService } from './context.ts';
import { ApiError } from './http.ts';
import { assertSlug, isSlug, replaceFileIfUnchanged, resolveInside, slugify, uniqueSlug, writeFileAtomic } from './paths.ts';
import { folderErrorSentence, isDesignFolder, isDirectory } from './root.ts';

/** `.chamber/state.json` — the service-owned truth (§6.3). */
const stateFileOf = (dir: string): string => path.join(dir, '.chamber', 'state.json');

/**
 * The screen list's stamp (Phase 2 §5.1): sha256 of the RAW `screens` value, not the normalised
 * one, so even an invalid entry the wall does not show counts as part of the list. A comment,
 * the title or `updated` changing does not move it.
 */
export const screensStampOf = (raw: JsonObject): string =>
  createHash('sha256').update(JSON.stringify(raw.screens ?? null), 'utf8').digest('hex');

/** Mirror writes retried (with a growing pause) after an agent write or a Windows file lock; then left to reconcile. */
const MIRROR_ATTEMPTS = 5;
const MIRROR_RETRY_MS = 25;

const fileStatus = async (file: string): Promise<FileStatus> => {
  try {
    const info = await stat(file);
    return { exists: info.isFile(), size: info.size, mtime: info.mtime.toISOString() };
  } catch {
    return { exists: false, size: 0, mtime: null };
  }
};

/** A design read from disk, including the raw file the mirror merge must preserve. */
type InternalRead = {
  record: DesignRecord;
  /** Parsed design.json object (`{}` when the file is missing), or null when unparseable. */
  raw: JsonObject | null;
  /** design.json text, or null when the file is missing. */
  designText: string | null;
  /** design.json normalised on its own, before state.json's fields go on top (what adoption reads). */
  agentDesign: DesignJson;
  /** False when state.json was missing or corrupt (state then comes from design.json). */
  stateFromDisk: boolean;
};

const timestampOf = (date: Date): string => {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
};

const mintCommentId = (existing: ReadonlySet<string>): string => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = `c_${randomBytes(6).toString('hex')}`;
    if (!existing.has(id)) return id;
  }
  // Unreachable in practice: 10 collisions in a 2^48 id space means a broken RNG.
  throw new ApiError('conflict', 'The comment could not be saved. Please try again.');
};

export type DesignStoreOptions = {
  settings: SettingsStore;
  log: Logger;
  /** When present, the store emits change events and subscribes for the §6.3 merge. */
  hub?: ChangeHub;
  /** WP2's cheap thumb state for list summaries; falls back to `unavailable` while unbuilt. */
  thumbnails?: Pick<ThumbnailService, 'peek'>;
  /** Test seam. */
  now?: () => Date;
};

/** The store plus `reconcile`, which the watcher path calls through the hub subscription. */
export type DesignStoreWithReconcile = DesignStore & { reconcile(slug: string): Promise<void> };

export const createDesignStore = (options: DesignStoreOptions): DesignStoreWithReconcile => {
  const { settings, log, hub } = options;
  const now = options.now ?? ((): Date => new Date());
  const hooks = new Set<(record: DesignRecord) => Promise<void>>();
  /** List summaries keyed by a cheap stat fingerprint (§9.3 "cached by mtimes"). */
  const summaryCache = new Map<string, { key: string; summary: DesignSummary }>();
  /** Per-slug write serialisation: no read-modify-write without a lock. */
  const locks = new Map<string, Promise<unknown>>();
  settings.onRootChange(() => summaryCache.clear());

  const withLock = async <T>(slug: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(slug) ?? Promise.resolve();
    // Assigned synchronously by the Promise constructor below, before the first await.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = prev.catch(() => undefined).then(() => gate);
    locks.set(slug, chain);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(slug) === chain) locks.delete(slug);
    }
  };

  /** Contained, existing design folder for a slug. Throws `bad-slug` or `not-found`. */
  const designDir = async (slug: string): Promise<string> => {
    assertSlug(slug);
    const root = settings.root();
    if (!(await isDirectory(root))) throw new ApiError('not-found', 'That design does not exist.');
    const dir = await resolveInside(root, [slug]);
    // A slug-named folder that is not a design (the user's own) is never read or written into.
    if (!(await isDirectory(dir)) || !(await isDesignFolder(dir))) throw new ApiError('not-found', 'That design does not exist.');
    return dir;
  };

  const readInternal = async (slug: string): Promise<InternalRead> => {
    const dir = await designDir(slug);
    const folderTime = (await stat(dir)).mtime.toISOString();

    const stateText = await readFile(stateFileOf(dir), 'utf8').catch(() => null);
    let state: ServiceState | null = null;
    if (stateText !== null) {
      try {
        state = normalizeServiceState(JSON.parse(stateText));
      } catch {
        state = null;
      }
      if (state === null) log.warn('store.state-unparseable', { slug, message: 'state.json is damaged; service fields are rebuilt from design.json.' });
    }

    const designText = await readFile(path.join(dir, DESIGN_JSON_FILE), 'utf8').catch(() => null);
    const entryStatus = await fileStatus(path.join(dir, ENTRY_FILE));
    // §6.1: a folder without design.json but with index.html is a page.
    const kind: DesignKind = state?.kind ?? (entryStatus.exists ? 'page' : 'canvas');
    const options = { fallbackTitle: slug, fallbackTime: folderTime };
    let parsed = parseDesignJsonText(designText ?? '{}', { ...options, kind });
    // No state yet: the agent's own valid kind beats the file-based guess, so a page whose
    // design.json lands before its index.html is adopted as a page, not turned into a canvas.
    const agentKind = state === null && designText !== null && parsed.raw !== null ? normalizeKind(parsed.raw.kind) : null;
    if (agentKind !== null && agentKind !== kind) parsed = parseDesignJsonText(designText ?? '{}', { ...options, kind: agentKind });
    const warnings: DesignWarning[] =
      designText === null
        ? [{ code: 'no-design-json', message: 'This design has no design.json yet. The agent may still be writing it.' }, ...parsed.warnings]
        : parsed.warnings;

    const finalState = state ?? serviceStateOf(parsed.design);
    const design = applyServiceState(parsed.design, finalState);
    // P2 adopts the agent's own reading of design.json: a provisional kind is only a guess from
    // the files, so it must not decide the kind of a design.json that lists screens but no kind.
    const agentDesign = state?.provisional === true && designText !== null && parsed.raw !== null ? normalizeDesign(parsed.raw, options).design : parsed.design;

    const files: DesignFiles = { screens: {} };
    if (design.kind === 'page') files.entry = entryStatus;
    for (const screen of design.screens) {
      // Containment per reference: screen files are resolved inside the design folder, so a
      // junction/symlink under the design cannot point the stat at foreign files.
      const file = await resolveInside(dir, screenFileOf(screen.id).split('/')).catch(() => null);
      files.screens[screen.id] = file === null ? { exists: false, size: 0, mtime: null } : await fileStatus(file);
    }
    const pending = design.kind === 'page' ? !entryStatus.exists : !Object.values(files.screens).some((entry) => entry.exists);

    // Phase 2 §5.1: the screen-list stamp and the design.json health the detail answer carries.
    const designJson: DesignRecord['designJson'] = designText === null ? 'missing' : parsed.raw === null ? 'invalid' : 'ok';
    const screensStamp = designText === null || parsed.raw === null ? null : screensStampOf(parsed.raw);

    return {
      record: { slug, path: dir, design, state: finalState, extra: parsed.extra, pending, files, warnings, screensStamp, designJson },
      raw: parsed.raw,
      designText,
      agentDesign,
      stateFromDisk: state !== null,
    };
  };

  /** The agent-owned base for a minimal design.json the service creates (§6.1). */
  const agentPartOf = (design: DesignJson, updated: string): JsonObject => ({
    title: design.title,
    updated,
    // Safe: Viewport/Screen/DesignSystemStatus are plain JSON records by construction.
    viewports: design.viewports as unknown as JsonValue[],
    ...(design.kind === 'canvas' ? { screens: design.screens as unknown as JsonValue[] } : {}),
    designSystem: { confirmed: design.designSystem.confirmed },
  });

  /**
   * state.json first, then the design.json mirror (§6.3). `write` carries the service's own
   * agent-field writes (a user rename, the `updated` bump); `null` means reconcile mode:
   * rewrite only when a service-owned field actually differs, and never normalise formatting
   * otherwise — that is what keeps the watcher loop closed.
   */
  const writeStateAndMirror = async (slug: string, read: InternalRead, state: ServiceState, write: ServiceWrite | null): Promise<void> => {
    await writeState(read.record.path, state);
    await writeMirror(slug, read, state, write);
  };

  /**
   * A design the user deleted outside the app (Finder, a script) while a reconcile or a mutation was in
   * flight must stay deleted: this may create `.chamber/`, never the design folder itself, or the delete
   * comes back as a folder holding only state.json. Gone = `not-found` (reconcile treats it as nothing to do).
   */
  const writeState = async (dir: string, state: ServiceState): Promise<void> => {
    // ENOENT means "gone" only when the design folder itself is missing. Windows also answers ENOENT
    // for a write under a `.chamber` that is a file, which is a broken design, not a deleted one.
    const goneOr = async (error: unknown): Promise<unknown> => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return error;
      const folderLeft = await stat(dir).then((s) => s.isDirectory(), () => false);
      return folderLeft ? error : new ApiError('not-found', 'That design does not exist.');
    };
    try {
      await mkdir(path.join(dir, '.chamber')); // not recursive: fails with ENOENT when the design folder is gone
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw await goneOr(error);
    }
    try {
      await writeFileAtomic(stateFileOf(dir), serializeJson(state as unknown as JsonValue), { createDirs: false }); // Safe: ServiceState is plain JSON.
    } catch (error) {
      throw await goneOr(error);
    }
  };

  /** The design.json half of `writeStateAndMirror` (state.json already written or unchanged). */
  const writeMirror = async (slug: string, read: InternalRead, state: ServiceState, write: ServiceWrite | null): Promise<void> => {
    const designPath = path.join(read.record.path, DESIGN_JSON_FILE);
    let text = read.designText;
    let raw = read.raw;
    // The agent may rewrite design.json at any moment: the mirror replaces the file only while
    // it still holds the text it was merged from; otherwise it re-merges from the fresh text.
    for (let attempt = 0; attempt < MIRROR_ATTEMPTS; attempt += 1) {
      let bytes: string;
      if (text === null) {
        // The file is missing: reconcile never invents one, and neither does a mutation on a
        // provisional design (P3: the agent's own design.json is on its way). Otherwise a
        // service-side mutation writes the minimal design.json (§6.1).
        if (write === null || state.provisional === true) return;
        bytes = serializeJson(mergeServiceFields(agentPartOf(read.record.design, write.updated ?? now().toISOString()), state, write));
      } else {
        if (raw === null) {
          // Unparseable: the agent may be mid-write. Never write over it (WP0 deviation 8);
          // state.json keeps the truth and the next watcher event retries.
          log.warn('store.design-json-unparseable', { slug, message: 'design.json is not valid JSON; the service left it alone.' });
          return;
        }
        if (write === null && !serviceFieldsDiffer(raw, state)) return;
        bytes = serializeJson(mergeServiceFields(raw, state, write ?? {}));
        if (bytes === text) return; // equal bytes → skip → no watch loop
      }
      if (await replaceFileIfUnchanged(designPath, text, bytes)) {
        if (write === null) log.info('store.design-json-remerged', { slug, message: 'Service-owned fields were restored into design.json.' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, MIRROR_RETRY_MS * (attempt + 1)));
      text = await readFile(designPath, 'utf8').catch(() => null);
      raw = text === null ? null : parseDesignJsonText(text, { kind: read.record.design.kind, fallbackTitle: slug, fallbackTime: read.record.design.created }).raw;
    }
    // Still changing: the agent's file stays as it is; state.json holds the truth and the
    // watcher's reconcile merges it once the agent is done.
    log.warn('store.design-json-busy', { slug, message: 'design.json kept changing or stayed locked; the mirror is merged on the next change.' });
  };

  const thumbOf = (slug: string): { state: ThumbState; key: string | null } => {
    try {
      return options.thumbnails?.peek(slug) ?? { state: 'unavailable', key: null };
    } catch {
      // WP2 not wired yet (main.ts placeholders throw): a missing thumb state is decorative,
      // the list must still answer.
      return { state: 'unavailable', key: null };
    }
  };

  const summaryOf = (record: DesignRecord): DesignSummary => ({
    slug: record.slug,
    kind: record.design.kind,
    title: record.design.title,
    created: record.design.created,
    updated: record.design.updated,
    pending: record.pending,
    screenCount: record.design.screens.length,
    viewports: record.design.viewports,
    sessionId: record.design.sessionId,
    projectDirectory: record.design.projectDirectory,
    openComments: record.design.comments.filter((comment) => comment.status === 'open').length,
    thumb: thumbOf(record.slug),
    warnings: record.warnings,
  });

  /** Cheap stat fingerprint deciding whether a cached summary is still valid. */
  const cacheKeyOf = async (dir: string): Promise<string> => {
    const parts: string[] = [];
    for (const relative of ['design.json', '.chamber/state.json', ENTRY_FILE, 'screens', 'assets', '.']) {
      const info = await stat(path.join(dir, relative)).catch(() => null);
      parts.push(info === null ? '-' : `${info.mtimeMs}:${info.size}`);
    }
    return parts.join('|');
  };

  const listCached = async (slug: string): Promise<DesignSummary> => {
    const dir = path.join(settings.root(), slug); // slug is pattern-validated above; stat only
    const key = await cacheKeyOf(dir);
    const cached = summaryCache.get(slug);
    if (cached !== undefined && cached.key === key) return { ...cached.summary, thumb: thumbOf(slug) };
    const read = await readInternal(slug);
    const summary = summaryOf(read.record);
    summaryCache.set(slug, { key, summary });
    return { ...summary, thumb: thumbOf(slug) };
  };

  const reconcile = async (slug: string): Promise<void> => {
    if (!isSlug(slug)) return;
    await withLock(slug, async () => {
      let read: InternalRead;
      try {
        read = await readInternal(slug);
      } catch (error) {
        // The folder vanished mid-event (deleted/trashed): nothing to merge.
        if (error instanceof ApiError && error.code === 'not-found') return;
        throw error;
      }
      const state = resolveState(slug, read, true);
      try {
        // state.json is rewritten only when it changes: two reconciles of an unchanged folder
        // write nothing at all.
        if (!read.stateFromDisk || state !== read.record.state) await writeState(read.record.path, state);
        await writeMirror(slug, withState(read, state), state, null);
      } catch (error) {
        // The folder was deleted after it was read: nothing to merge, and nothing is written back.
        if (error instanceof ApiError && error.code === 'not-found') return;
        throw error;
      }
    });
  };

  const withState = (read: InternalRead, state: ServiceState): InternalRead =>
    state === read.record.state ? read : { ...read, record: { ...read.record, state } };

  /**
   * The state the files on disk call for (§6.3, P1/P2/P5); `read.record.state` itself when
   * nothing changes. `kindSwitch` (P5) runs on reconcile only: a comment or rename made on a
   * page is built on that page.
   */
  const resolveState = (slug: string, read: InternalRead, kindSwitch: boolean): ServiceState => {
    const { record } = read;
    // The agent's design.json, when it exists and parses (`raw` is `{}` for a missing file).
    const raw = read.designText === null ? null : read.raw;
    if (!read.stateFromDisk) {
      // state.json missing or corrupt. With a usable design.json that is the only source: adopt
      // its service-owned fields (comments included). Without one (missing, or mid-write) the
      // state is guessed from the files and stays provisional until the agent's file lands (P1).
      const seeded = serviceStateOf(record.design);
      return raw === null ? { ...seeded, provisional: true } : seeded;
    }
    if (raw === null || (record.state.provisional !== true && !kindSwitch)) return record.state;
    const adopted = adoptAgentFields({ state: record.state, raw, normalized: read.agentDesign, pending: record.pending });
    if (adopted === null) return record.state;
    if (record.state.provisional === true) {
      log.info('store.design-adopted', { slug, message: "The agent's design.json replaced the values guessed from its files." });
    } else {
      log.info('store.kind-switched', { slug, message: `The agent changed this design to a ${adopted.kind} before writing any screen.` });
    }
    return adopted;
  };

  /** A design read for a user mutation: provisional state seeded or adopted first (P1, P2). */
  const readSettled = async (slug: string): Promise<InternalRead> => {
    const read = await readInternal(slug);
    return withState(read, resolveState(slug, read, false));
  };

  if (hub !== undefined) {
    hub.subscribe((event) => {
      const slug = event.slug;
      if (slug === null || (event.kind !== 'design' && event.kind !== 'added')) return;
      reconcile(slug).catch((error) => {
        log.warn('store.reconcile-failed', { slug, error: error instanceof Error ? error.message : String(error) });
      });
    });
  }

  const store: DesignStoreWithReconcile = {
    async dir(slug) {
      return designDir(slug);
    },

    async list(filter) {
      const root = settings.root();
      const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
        // A root that is not there yet lists as empty; one that refuses us (macOS privacy on
        // ~/Documents, a folder another user owns) says so instead of looking empty.
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES') throw new ApiError('bad-path', folderErrorSentence(error, root));
        return null;
      });
      if (entries === null) return [];
      const slugs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && isSlug(entry.name))
        .map((entry) => entry.name);
      const summaries: DesignSummary[] = [];
      for (const slug of slugs) {
        if (!(await isDesignFolder(path.join(root, slug)))) continue; // the user's own folder, not a design
        try {
          summaries.push(await listCached(slug));
        } catch (error) {
          // One broken folder must not blank the whole list (loud in the log, graceful on screen).
          log.warn('store.list-entry-failed', { slug, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const q = filter?.q?.trim().toLowerCase();
      return summaries
        .filter((summary) => (filter?.kind === undefined || summary.kind === filter.kind) && (q === undefined || q === '' || summary.title.toLowerCase().includes(q) || summary.slug.includes(q)))
        .sort((a, b) => (a.updated === b.updated ? a.slug.localeCompare(b.slug) : b.updated.localeCompare(a.updated)));
    },

    async get(slug) {
      const read = await readInternal(slug);
      return read.record;
    },

    async create(input) {
      const root = settings.root();
      try {
        await mkdir(root, { recursive: true });
      } catch (error) {
        throw new ApiError('bad-path', folderErrorSentence(error, root));
      }
      const brief = typeof input.brief === 'string' ? input.brief.slice(0, BRIEF_MAX) : '';
      const requestedTitle = typeof input.title === 'string' ? input.title.trim() : '';
      const title = (requestedTitle.length >= 1 ? requestedTitle : firstLineOf(brief) ?? 'Untitled design').slice(0, TITLE_MAX);

      // '\0create' can never be a slug, so no design's own lock serialises with creates.
      const record = await withLock('\0create', async () => {
        // One global create lock: slug allocation + mkdir must be atomic across concurrent
        // creates, or two titles folding to the same slug could race into one folder.
        const slug = await uniqueSlug(slugify(title), async (candidate) => isDirectory(path.join(root, candidate)));
        const dir = await resolveInside(root, [slug]);
        if (await isDirectory(dir)) throw new ApiError('conflict', 'A design with that name appeared while this one was being created.');
        await mkdir(dir, { recursive: true });
        const nowIso = now().toISOString();
        const { state, json } = createDesignDocument({
          kind: input.kind,
          title,
          brief,
          sessionId: input.sessionId ?? null,
          projectDirectory: input.projectDirectory ?? null,
          preset: input.preset ?? null,
          now: nowIso,
        });
        await writeFileAtomic(stateFileOf(dir), serializeJson(state as unknown as JsonValue)); // Safe: ServiceState is plain JSON.
        await writeFileAtomic(path.join(dir, DESIGN_JSON_FILE), serializeJson(json));
        if (input.kind === 'page' && typeof input.html === 'string') {
          await writeFileAtomic(path.join(dir, ENTRY_FILE), input.html);
        }
        return readInternal(slug);
      });

      // WP3 registers the RULES.md hook; a failing hook is logged and never undoes the create.
      for (const hook of [...hooks]) {
        try {
          await hook(record.record);
        } catch (error) {
          log.warn('store.create-hook-failed', { slug: record.record.slug, error: error instanceof Error ? error.message : String(error) });
        }
      }
      hub?.emit({ slug: record.record.slug, kind: 'added' });
      return record.record;
    },

    async patch(slug, patchBody: PatchDesignBody) {
      const nowIso = now().toISOString();
      const read = await withLock(slug, async () => {
        const current = await readSettled(slug);
        // P4: a rename or link claims a provisional folder for the user; from here on it is a
        // normal design and the minimal design.json is written as for any other.
        let state = finalOf(current.record.state);
        if (patchBody.sessionId !== undefined) state = { ...state, sessionId: patchBody.sessionId };
        if (patchBody.projectDirectory !== undefined) state = { ...state, projectDirectory: patchBody.projectDirectory };
        const write: ServiceWrite = { updated: nowIso };
        if (patchBody.title !== undefined) write.title = patchBody.title;
        await writeStateAndMirror(slug, current, state, write);
        return readInternal(slug);
      });
      hub?.emit({ slug, kind: 'design' });
      return read.record;
    },

    async linkIfUnlinked(slug, sessionId, marker) {
      const nowIso = now().toISOString();
      const outcome = await withLock(slug, async (): Promise<LinkIfUnlinkedOutcome> => {
        const current = await readSettled(slug);
        const { state } = current.record;
        if (state.sessionId !== null) return 'has-chat';
        if (chipMarkerOf(state.created) !== marker) return 'other-design';
        // As a PATCH of `sessionId` does, a link claims a provisional folder (P4).
        await writeStateAndMirror(slug, current, { ...finalOf(state), sessionId }, { updated: nowIso });
        return 'linked';
      });
      if (outcome === 'linked') hub?.emit({ slug, kind: 'design' });
      return outcome;
    },

    async trash(slug) {
      const trashedTo = await withLock(slug, async () => {
        const dir = await designDir(slug);
        const trashRoot = await resolveInside(settings.root(), ['.trash']);
        await mkdir(trashRoot, { recursive: true });
        const stamp = timestampOf(now());
        let target = path.join(trashRoot, `${slug}-${stamp}`);
        for (let suffix = 2; await exists(target); suffix += 1) target = path.join(trashRoot, `${slug}-${stamp}-${suffix}`);
        await rename(dir, target);
        summaryCache.delete(slug);
        return target;
      });
      hub?.emit({ slug, kind: 'removed' });
      return trashedTo;
    },

    async addComment(slug, input: CreateCommentBody) {
      const nowIso = now().toISOString();
      const result = await withLock(slug, async () => {
        const read = await readSettled(slug);
        const state = read.record.state;
        if (state.comments.length >= COMMENTS_MAX) {
          throw new ApiError('conflict', `This design already carries ${COMMENTS_MAX} comments. Resolve or delete some before adding more.`);
        }
        const comment: Comment = {
          id: mintCommentId(new Set(state.comments.map((entry) => entry.id))),
          screen: input.screen,
          viewport: input.viewport,
          anchor: input.anchor,
          body: input.body,
          status: 'open',
          created: nowIso,
          sentAt: null,
          sentVersion: null,
        };
        const next: ServiceState = { ...state, comments: [...state.comments, comment] };
        await writeStateAndMirror(slug, read, next, { updated: nowIso });
        return comment;
      });
      hub?.emit({ slug, kind: 'comments' });
      return result;
    },

    async updateComment(slug, id, patchBody: PatchCommentBody) {
      const nowIso = now().toISOString();
      const result = await withLock(slug, async () => {
        const read = await readSettled(slug);
        const state = read.record.state;
        const index = state.comments.findIndex((comment) => comment.id === id);
        if (index === -1) throw new ApiError('not-found', 'That comment does not exist.');
        const current = state.comments[index] as Comment; // Safe: findIndex answered a valid index.
        const updated: Comment = {
          ...current,
          ...(patchBody.body !== undefined ? { body: patchBody.body } : {}),
          ...(patchBody.status !== undefined ? { status: patchBody.status } : {}),
        };
        const comments = state.comments.map((comment, position) => (position === index ? updated : comment));
        await writeStateAndMirror(slug, read, { ...state, comments }, { updated: nowIso });
        return updated;
      });
      hub?.emit({ slug, kind: 'comments' });
      return result;
    },

    async deleteComment(slug, id) {
      const nowIso = now().toISOString();
      await withLock(slug, async () => {
        const read = await readSettled(slug);
        const state = read.record.state;
        const comments = state.comments.filter((comment) => comment.id !== id);
        if (comments.length === state.comments.length) throw new ApiError('not-found', 'That comment does not exist.');
        await writeStateAndMirror(slug, read, { ...state, comments }, { updated: nowIso });
      });
      hub?.emit({ slug, kind: 'comments' });
    },

    async markSent(slug, ids, version) {
      const nowIso = now().toISOString();
      const marked = await withLock(slug, async () => {
        const read = await readSettled(slug);
        const state = read.record.state;
        const wanted = new Set(ids);
        const found: Comment[] = [];
        const comments = state.comments.map((comment) => {
          if (!wanted.has(comment.id)) return comment;
          const sent: Comment = { ...comment, status: 'sent', sentAt: nowIso, sentVersion: version };
          found.push(sent);
          return sent;
        });
        if (found.length > 0) await writeStateAndMirror(slug, read, { ...state, comments }, { updated: nowIso });
        return found;
      });
      if (marked.length > 0) hub?.emit({ slug, kind: 'comments' });
      return marked;
    },

    onCreate(hook) {
      hooks.add(hook);
      return () => hooks.delete(hook);
    },

    // Phase 2 T4 fills these (the shared merge-and-retry loop, §5.1); until then every call
    // answers the same sentence as the edit route stubs, never a false success.
    async writeScreens() {
      throw new ApiError('internal', 'This part of Design Chamber (edits) is not built yet.');
    },
    async moveComments() {
      throw new ApiError('internal', 'This part of Design Chamber (edits) is not built yet.');
    },

    reconcile,
  };
  return store;
};

/** The state without the provisional flag (P4). */
const finalOf = (state: ServiceState): ServiceState => {
  if (state.provisional !== true) return state;
  const next: ServiceState = { ...state };
  delete next.provisional;
  return next;
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

/** First non-empty line of a brief, or null — the fallback title of a design created without one. */
const firstLineOf = (brief: string): string | null => {
  const line = brief
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line === undefined || line === '' ? null : line.slice(0, TITLE_MAX);
};
