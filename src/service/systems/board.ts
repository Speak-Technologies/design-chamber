// The specimen board (documentation/specs/phase-2-5-technical.md §5.7, AD-9): generated from the
// system's files, bundled like a design, shown in the standard sandboxed artboard frame.
//
// 1. The detail: the live one from the store, or a version's tree read through the same
//    `buildSystemDetail` (a repo-backed system's version holds `snapshot/…`, so its source is rooted there).
// 2. Each component example is bundled on its own (relative to `components/`), so its remote refs are
//    reported per component; fonts and logos are checked with `checkAsset` before the board names them.
// 3. `buildBoardHtml` (pure) writes the document; `bundleDocument` bundles it from an overlay source
//    (the generated text at the virtual `__board.html`, everything else from the system's files), in
//    render mode (bridge placeholder), contained against the system's files folder.
// 4. The result is cached by a key over the generator version, the system, the version, the scheme,
//    the generated text and the bytes the board points at; chunked like design renders; dropped on
//    `system` events for that system and on a root change.
//
// Nothing here writes a file. Every read goes through a FileSource: the live one resolves each path
// with `resolveInside` (no escape, no link out), the version one reads only the version's own objects.

import { createHash } from 'node:crypto';
import path from 'node:path';

import type { RenderMeta } from '../../shared/api.ts';
import { RENDER_CHUNK_MAX_BYTES, SYSTEM_JSON_MAX_BYTES, SYSTEM_PROPOSAL_ID_PATTERN, SYSTEM_NOTE_MAX, SYSTEM_OVERVIEW_MAX, TOKENS_CSS_MAX_BYTES, VERSION_ID_PATTERN } from '../../shared/limits.ts';
import { buildSystemDetail, type SystemDetailSource } from '../../shared/system-json.ts';
import type { SystemDetail, SystemState } from '../../shared/types.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, createLiveFileSource, type BundleResult, type FileSource, type SourceFile } from '../bundle.ts';
import type { ChangeHub, ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { splitChunks } from '../render-cache.ts';
import type { VersionsService } from '../versions.ts';
import { checkAsset } from './assets.ts';
import { BOARD_ENTRY_FILE, BOARD_GENERATOR_VERSION, buildBoardHtml } from './board-html.ts';
import { listFiles, proposalDirOf, readProposalFile, sha256Of } from './proposal-record.ts';
import { ensureSystemStore, type SystemStore } from './store.ts';
import { ensureSystemVersions } from './versions.ts';

/** The board cache's share of memory (boards are few; design renders keep their own cache). */
const BOARD_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const BYTES_PER_CHAR_MAX = 4;
/** Top-level names that are never system content (store.ts `NOT_CONTENT`). */
const NOT_CONTENT = new Set(['BUILD.json', 'PROPOSAL.json', 'proposal', 'snapshot']);

export const BOARD_TOO_LARGE_MESSAGE = "This design system's board is too large to show inside OpenChamber. Ask the agent to use smaller fonts, logos or examples.";
export const BOARD_STALE_MESSAGE = 'That board is no longer in the cache. Load the design system again.';
export const BOARD_NO_PROPOSAL_MESSAGE = "That proposal isn't the one waiting any more, so there's no preview to show.";

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

// ---- sources ----

/** A version source re-rooted at `prefix/` inside it (a repo-backed system's `snapshot/`). */
const prefixedSource = (inner: FileSource, prefix: string): FileSource => ({
  root: path.join(inner.root, prefix),
  read: (rel) => inner.read(`${prefix}/${rel}`),
  ...(inner.stat ? { stat: (rel: string) => inner.stat?.(`${prefix}/${rel}`) ?? Promise.resolve(null) } : {}),
});

/** A generated document at the virtual entry (the board's, or the living page's); every other path from `base`. */
export const overlaySource = (base: FileSource, html: string, entryFile: string = BOARD_ENTRY_FILE): FileSource => {
  const bytes = Buffer.from(html, 'utf8');
  const entry: SourceFile = { bytes, size: bytes.length, mtimeMs: 0 };
  return {
    root: base.root,
    read: (rel) => (rel === entryFile ? Promise.resolve(entry) : base.read(rel)),
    stat: (rel) => (rel === entryFile ? Promise.resolve({ size: entry.size, mtimeMs: 0 }) : base.stat?.(rel) ?? Promise.resolve(null)),
  };
};

const isContentRel = (rel: string): boolean => {
  const parts = rel.split('/');
  return !parts.some((part) => part.startsWith('.')) && !NOT_CONTENT.has(parts[0] ?? '');
};

/** A version's files read into the detail source `buildSystemDetail` takes, with the store's caps. */
export const detailSourceFromTree = async (
  input: { id: string; dir: string; state: SystemState; rels: readonly string[] },
  source: FileSource,
): Promise<SystemDetailSource> => {
  const rels = input.rels.filter(isContentRel);
  const files: { rel: string; bytes: number }[] = [];
  for (const rel of rels) {
    const info = (await source.stat?.(rel)) ?? null;
    files.push({ rel, bytes: info?.size ?? 0 });
  }
  const tooLarge: string[] = [];
  const readText = async (rel: string, max: number): Promise<string | null> => {
    if (!rels.includes(rel)) return null;
    const file = await source.read(rel);
    if (file === null) return null;
    if (file.bytes.length > max) {
      tooLarge.push(rel);
      return null;
    }
    return file.bytes.toString('utf8');
  };
  const systemJson = await readText('system.json', SYSTEM_JSON_MAX_BYTES);
  const tokensCss = await readText('tokens.css', TOKENS_CSS_MAX_BYTES);
  const texts: Record<string, string> = {};
  const overview = await readText('OVERVIEW.md', SYSTEM_OVERVIEW_MAX * BYTES_PER_CHAR_MAX);
  if (overview !== null) texts['OVERVIEW.md'] = overview;
  for (const rel of rels) {
    if (!/^(notes|patterns|brand)\/[^/]+\.md$/.test(rel)) continue;
    const body = await readText(rel, SYSTEM_NOTE_MAX * BYTES_PER_CHAR_MAX);
    if (body !== null) texts[rel] = body;
  }
  return { id: input.id, dir: input.dir, state: input.state, systemJson, tokensCss, texts, files, build: null, tooLarge };
};

// ---- the service ----

type BoardEntry = { key: string; id: string; chunks: string[]; meta: RenderMeta; bytes: number };

export type BoardService = {
  /** `proposal`: the preview board over `proposal/` (§5.14 step 4), only for the proposal waiting now. */
  render(id: string, options: { version?: string; proposal?: string; scheme: 'light' | 'dark' }): Promise<RenderMeta>;
  /** One chunk of a cached board; `stale` when the key was dropped or belongs to another system. */
  chunk(id: string, key: string, n: number): string;
};

export type BoardDeps = { systems: SystemStore; versions: VersionsService; hub: ChangeHub; onDispose: (fn: () => void) => void };

const bundleOrThrow = async (source: FileSource, rel: string, mode: 'render' | 'export') => {
  try {
    return await bundleDocument(source, rel, { mode });
  } catch (error) {
    if (error instanceof BundleTooLarge) return null;
    if (error instanceof BundleMissingEntry) return null;
    throw error;
  }
};

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
    const dir = await deps.systems.dir(id);
    const state = await deps.systems.readState(id);
    const file = state.home?.kind === 'repo' ? await readProposalFile(dir) : null;
    const proposalDir = file !== null && file.kind !== 'absent' && file.parsed.id === proposal ? await proposalDirOf(dir) : null;
    if (file === null || file.kind === 'absent' || proposalDir === null) throw new ApiError('not-found', BOARD_NO_PROPOSAL_MESSAGE);
    const source = createLiveFileSource(proposalDir);
    const rels = await listFiles(proposalDir);
    const detail = buildSystemDetail(await detailSourceFromTree({ id, dir, state, rels }, source));
    return { detail, source, sha: sha256Of(`${file.fileSha256}\n${rels.sort().join('\n')}`) };
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

      // Examples, one by one, relative to components/ (their remote refs per component).
      const examples: Record<string, string> = {};
      const keyParts: string[] = [];
      const components = await Promise.all(
        detail.components.map(async (component) => {
          if (component.example === null) return component;
          const bundled = await bundleOrThrow(source, `components/${component.id}.html`, 'export');
          if (bundled === null) return component;
          examples[component.id] = bundled.html;
          return { ...component, example: { remote: bundled.external } };
        }),
      );

      // Fonts and logos: checked by content before the board names them.
      const unusable = new Set<string>();
      for (const { file, kind } of [...detail.fonts.map((font) => ({ file: font.file, kind: 'font' as const })), ...detail.logos.map((logo) => ({ file: logo.file, kind: 'logo' as const }))]) {
        const bytes = await source.read(file).catch(() => null);
        if (bytes === null || !checkAsset(path.posix.basename(file), kind, bytes.bytes).ok) unusable.add(file);
        else keyParts.push(`${file}:${sha256(bytes.bytes)}`);
      }

      const html = buildBoardHtml({ ...detail, components }, { scheme: options.scheme, examples, unusable });
      const key = sha256(
        JSON.stringify({ g: BOARD_GENERATOR_VERSION, id, v: options.version ?? null, p: proposed === null ? null : [options.proposal, proposed.sha], s: options.scheme, html: sha256(html), assets: keyParts.sort() }),
      );
      const cached = cache.get(key);
      if (cached !== undefined) {
        cache.delete(key);
        cache.set(key, cached);
        return cached.meta;
      }

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
        external: [...new Set([...result.external, ...components.flatMap((component) => component.example?.remote ?? [])])],
        warnings: result.warnings,
      };
      put({ key, id, chunks, meta, bytes });
      return meta;
    },

    chunk(id, key, n) {
      const entry = cache.get(key);
      if (entry === undefined || entry.id !== id) throw new ApiError('stale', BOARD_STALE_MESSAGE);
      if (!Number.isInteger(n) || n < 0 || n >= entry.chunks.length) throw new ApiError('bad-request', 'That chunk number is not part of this board.');
      const chunk = entry.chunks[n];
      if (chunk === undefined) throw new ApiError('stale', BOARD_STALE_MESSAGE);
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
