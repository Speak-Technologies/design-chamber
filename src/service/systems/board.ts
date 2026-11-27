// The specimen board (documentation/specs/phase-2-5-technical.md §5.7, AD-9): generated from the
// system's files, bundled like a design, shown in the standard sandboxed artboard frame.
//
// 1. The detail: the live one from the store, or a version's tree read through the same
//    `buildSystemDetail` (a repo-backed system's version holds `snapshot/…`, so its source is rooted there).
// 2. `assembleBoardHtml` (board-assemble.ts, shared with the visual check) bundles each component
//    example on its own, checks fonts and logos, and writes the document.
// 3. `bundleDocument` bundles it from an overlay source (the generated text at the virtual
//    `__board.html`, everything else from the system's files), in render mode (bridge placeholder),
//    contained against the system's files folder.
// 4. The result is cached by a key over the generator version, the system, the version, the scheme,
//    the generated text and the bytes the board points at; chunked like design renders; dropped on
//    `system` events for that system and on a root change.
//
// System screens (system-builder-depth §4.6, §13 T12a) share the cache and the sources: `renderScreen`
// bundles one listed `screens/<id>.html` as it is (a full document, render mode, contained against the
// same files folder), so the page shows it in the same sandboxed artboard frame as a design screen.
//
// Nothing here writes a file. Every read goes through a FileSource: the live one resolves each path
// with `resolveInside` (no escape, no link out), the version one reads only the version's own objects.

import { createHash } from 'node:crypto';
import path from 'node:path';

import type { RenderMeta } from '../../shared/api.ts';
import { RENDER_CHUNK_MAX_BYTES, SYSTEM_ENTRY_ID_PATTERN, SYSTEM_PROPOSAL_ID_PATTERN, SYSTEM_SCREEN_MAX, VERSION_ID_PATTERN } from '../../shared/limits.ts';
import { buildSystemDetail, screenMissingSentence, screenTooLongSentence, systemScreenFileOf } from '../../shared/system-json.ts';
import type { SystemDetail } from '../../shared/types.ts';
import { BundleTooLarge, RefBlocked, bundleDocument, createLiveFileSource, type BundleResult, type FileSource } from '../bundle.ts';
import type { ChangeHub, ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { splitChunks } from '../render-cache.ts';
import type { VersionsService } from '../versions.ts';
import { assembleBoardHtml, detailSourceFromTree, overlaySource, readProposalBoardSource } from './board-assemble.ts';
import { BOARD_ENTRY_FILE, BOARD_GENERATOR_VERSION } from './board-html.ts';
import { ensureSystemStore, type SystemStore } from './store.ts';
import { ensureSystemVersions } from './versions.ts';

// The assembly moved to board-assemble.ts (shared with the visual check); these stay importable here.
export { detailSourceFromTree, overlaySource } from './board-assemble.ts';

/** The board cache's share of memory (boards are few; design renders keep their own cache). */
const BOARD_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export const BOARD_TOO_LARGE_MESSAGE = "This design system's board is too large to show inside OpenChamber. Ask the agent to use smaller fonts, logos or examples.";
export const BOARD_STALE_MESSAGE = 'That board is no longer in the cache. Load the design system again.';
export const BOARD_NO_PROPOSAL_MESSAGE = "That proposal isn't the one waiting any more, so there's no preview to show.";
export const SCREEN_STALE_MESSAGE = 'That screen is no longer in the cache. Load the design system again.';
export const SCREEN_NOT_LISTED_MESSAGE = "That screen isn't listed in this design system.";
export const SCREEN_TOO_LARGE_MESSAGE = 'This screen is too large to show inside OpenChamber. Ask the agent to use smaller fonts or images.';
export const NOT_A_SCREEN_ID_MESSAGE = 'That is not a screen id.';

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

// ---- sources ----

/** A version source re-rooted at `prefix/` inside it (a repo-backed system's `snapshot/`). */
const prefixedSource = (inner: FileSource, prefix: string): FileSource => ({
  root: path.join(inner.root, prefix),
  read: (rel) => inner.read(`${prefix}/${rel}`),
  ...(inner.stat ? { stat: (rel: string) => inner.stat?.(`${prefix}/${rel}`) ?? Promise.resolve(null) } : {}),
});

// ---- the service ----

/** A cached document: the board, or one system screen (`kind`), so neither route serves the other's chunks. */
type CachedKind = 'board' | 'screen';
type BoardEntry = { key: string; id: string; kind: CachedKind; chunks: string[]; meta: RenderMeta; bytes: number };

export type ScreenRenderOptions = { screen: string; version?: string; proposal?: string; scheme: 'light' | 'dark' };

export type BoardService = {
  /** `proposal`: the preview board over `proposal/` (§5.14 step 4), only for the proposal waiting now. */
  render(id: string, options: { version?: string; proposal?: string; scheme: 'light' | 'dark' }): Promise<RenderMeta>;
  /**
   * One system screen (system-builder-depth T12a), live, at a version or in the proposal waiting now: the
   * screen must be listed in `screens` with no problem, and its file within `SYSTEM_SCREEN_MAX` characters.
   * `scheme` keys the render only; the screen's document is bundled as written.
   */
  renderScreen(id: string, options: ScreenRenderOptions): Promise<RenderMeta>;
  /**
   * One chunk of a cached board (or, with `kind` `screen`, a screen); `stale` when the key was dropped,
   * belongs to another system or is the other kind.
   */
  chunk(id: string, key: string, n: number, kind?: CachedKind): string;
};

export type BoardDeps = { systems: SystemStore; versions: VersionsService; hub: ChangeHub; onDispose: (fn: () => void) => void };

export const createBoardService = (deps: BoardDeps): BoardService => {
  const cache = new Map<string, BoardEntry>(); // insertion order = LRU order
  let total = 0;

  const drop = (key: string): void => {
    const entry = cache.get(key);
    if (entry === undefined) return;
    cache.delete(key);
    total -= entry.bytes;
  };
  const put = (entry: BoardEntry): void => {
    drop(entry.key);
    cache.set(entry.key, entry);
    total += entry.bytes;
    for (const key of [...cache.keys()]) {
      if (total <= BOARD_CACHE_MAX_BYTES) break;
      drop(key);
    }
  };

  deps.onDispose(
    deps.hub.subscribe((event) => {
      if (event.kind === 'root') {
        for (const key of [...cache.keys()]) drop(key);
        return;
      }
      if (event.kind !== 'system' || event.system === undefined) return;
      for (const [key, entry] of [...cache]) if (entry.id === event.system) drop(key);
    }),
  );

  /** The proposed system: `proposal/` read as a system folder, for the current PROPOSAL.json only; its sha keys the cache. */
  const readProposal = async (id: string, proposal: string): Promise<{ detail: SystemDetail; source: FileSource; sha: string }> => {
    if (!SYSTEM_PROPOSAL_ID_PATTERN.test(proposal)) throw new ApiError('bad-request', 'That is not a proposal id.');
    const found = await readProposalBoardSource(deps.systems, id);
    if (found === null || found.proposalId !== proposal) throw new ApiError('not-found', BOARD_NO_PROPOSAL_MESSAGE);
    return { detail: found.detail, source: found.source, sha: found.sha };
  };

  /** A cached entry by key (moved to the most recent end), or null. */
  const hit = (key: string): BoardEntry | null => {
    const cached = cache.get(key);
    if (cached === undefined) return null;
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  };

  /** The detail and the source its files come from, live or from a version. */
  const read = async (id: string, version: string | undefined): Promise<{ detail: SystemDetail; source: FileSource }> => {
    if (version === undefined) {
      const detail = await deps.systems.detail(id);
      return { detail, source: createLiveFileSource(await deps.systems.filesDir(id)) };
    }
    if (!VERSION_ID_PATTERN.test(version)) throw new ApiError('bad-request', 'That is not a version id.');
    const dir = await deps.systems.dir(id);
    const state = await deps.systems.readState(id);
    const tree = await deps.versions.readTree(id, version); // 404 when unknown
    const repo = state.home?.kind === 'repo';
    const source = repo ? prefixedSource(tree.source, 'snapshot') : tree.source;
    const rels = Object.keys(tree.entry.files)
      .filter((rel) => !repo || rel.startsWith('snapshot/'))
      .map((rel) => (repo ? rel.slice('snapshot/'.length) : rel));
    const detail = buildSystemDetail(await detailSourceFromTree({ id, dir, state, rels }, source));
    return { detail, source };
  };

  return {
    async render(id, options) {
      if (options.proposal !== undefined && options.version !== undefined) throw new ApiError('bad-request', 'Ask for a version or a proposal, not both.');
      const proposed = options.proposal !== undefined ? await readProposal(id, options.proposal) : null;
      const { detail, source } = proposed ?? (await read(id, options.version));

      // Examples bundled one by one, fonts and logos checked, the document written (shared with the check).
      const { html, components, patterns, brand, assetKeys } = await assembleBoardHtml(detail, source, options.scheme);
      const key = sha256(
        JSON.stringify({ g: BOARD_GENERATOR_VERSION, id, v: options.version ?? null, p: proposed === null ? null : [options.proposal, proposed.sha], s: options.scheme, html: sha256(html), assets: assetKeys.sort() }),
      );
      const cached = hit(key);
      if (cached !== null) return cached.meta;

      let result: BundleResult;
      try {
        result = await bundleDocument(overlaySource(source, html), BOARD_ENTRY_FILE, { mode: 'render' });
      } catch (error) {
        if (error instanceof BundleTooLarge) throw new ApiError('too-large', BOARD_TOO_LARGE_MESSAGE);
        throw error;
      }
      const chunks = splitChunks(result.html, RENDER_CHUNK_MAX_BYTES);
      const bytes = Buffer.byteLength(result.html, 'utf8');
      const meta: RenderMeta = {
        key,
        chunks: chunks.length,
        bytes,
        title: proposed === null ? `${detail.name}: specimen board` : `${detail.name}: proposed specimen board`,
        missing: result.missing,
        blocked: result.blocked,
        external: [...new Set([...result.external, ...[...components, ...patterns, ...brand].flatMap((entry) => entry.example?.remote ?? [])])],
        warnings: result.warnings,
      };
      put({ key, id, kind: 'board', chunks, meta, bytes });
      return meta;
    },

    async renderScreen(id, options) {
      // Checked here too (the route checks first): the id becomes a path below.
      if (!SYSTEM_ENTRY_ID_PATTERN.test(options.screen)) throw new ApiError('bad-request', NOT_A_SCREEN_ID_MESSAGE);
      if (options.proposal !== undefined && options.version !== undefined) throw new ApiError('bad-request', 'Ask for a version or a proposal, not both.');
      const proposed = options.proposal !== undefined ? await readProposal(id, options.proposal) : null;
      const { detail, source } = proposed ?? (await read(id, options.version));

      // Only a screen system.json lists, with a file the reader found within the cap.
      const listed = detail.screens.find((screen) => screen.id === options.screen);
      if (listed === undefined) throw new ApiError('not-found', SCREEN_NOT_LISTED_MESSAGE);
      if (listed.problem !== null) throw new ApiError(listed.problem === screenTooLongSentence(listed.id) ? 'too-large' : 'no-html', listed.problem);

      // The file, read once through the source (contained: no escape, no link out), checked against the
      // cap, then bundled from exactly those bytes. Its own references are classified by the bundler.
      const rel = systemScreenFileOf(listed.id);
      const file = await source.read(rel).catch((error: unknown) => {
        if (error instanceof RefBlocked) return null;
        throw error;
      });
      if (file === null) throw new ApiError('no-html', screenMissingSentence(listed.id));
      const text = file.bytes.toString('utf8');
      if (text.length > SYSTEM_SCREEN_MAX) throw new ApiError('too-large', screenTooLongSentence(listed.id));

      let result: BundleResult;
      try {
        result = await bundleDocument(overlaySource(source, text, rel), rel, { mode: 'render' });
      } catch (error) {
        if (error instanceof BundleTooLarge) throw new ApiError('too-large', SCREEN_TOO_LARGE_MESSAGE);
        throw error;
      }
      const key = sha256(
        JSON.stringify({ g: 'system-screen', id, screen: listed.id, v: options.version ?? null, p: proposed === null ? null : [options.proposal, proposed.sha], s: options.scheme, html: sha256(result.html) }),
      );
      const cached = hit(key);
      if (cached !== null) return cached.meta;

      const chunks = splitChunks(result.html, RENDER_CHUNK_MAX_BYTES);
      const bytes = Buffer.byteLength(result.html, 'utf8');
      const meta: RenderMeta = {
        key,
        chunks: chunks.length,
        bytes,
        title: proposed === null ? `${detail.name}: ${listed.title}` : `${detail.name}: ${listed.title} (proposed)`,
        missing: result.missing,
        blocked: result.blocked,
        external: result.external,
        warnings: result.warnings,
      };
      put({ key, id, kind: 'screen', chunks, meta, bytes });
      return meta;
    },

    chunk(id, key, n, kind = 'board') {
      const stale = kind === 'screen' ? SCREEN_STALE_MESSAGE : BOARD_STALE_MESSAGE;
      const entry = cache.get(key);
      if (entry === undefined || entry.id !== id || entry.kind !== kind) throw new ApiError('stale', stale);
      if (!Number.isInteger(n) || n < 0 || n >= entry.chunks.length) throw new ApiError('bad-request', `That chunk number is not part of this ${kind}.`);
      const chunk = entry.chunks[n];
      if (chunk === undefined) throw new ApiError('stale', stale);
      return chunk;
    },
  };
};

const instances = new WeakMap<ServiceContext, BoardService>();

/** The one board service of a composed service. */
export const ensureBoardService = (ctx: ServiceContext): BoardService => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createBoardService({ systems: ensureSystemStore(ctx), versions: ensureSystemVersions(ctx), hub: ctx.hub, onDispose: ctx.onDispose });
  instances.set(ctx, created);
  return created;
};

/** The T0 entry point (§5.7). */
export const renderBoard = (ctx: ServiceContext, id: string, options: { version?: string; proposal?: string; scheme: 'light' | 'dark' }): Promise<RenderMeta> =>
  ensureBoardService(ctx).render(id, options);
