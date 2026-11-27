// The board's assembly (documentation/specs/system-board-layout-and-visual-check.md §B.2): the
// detail and files become the board document, shared by the system page's board service and the
// visual check. Pure of the service context (no ServiceContext import), so the CLI bundles it.
//
// Nothing here writes a file. Every read goes through a FileSource: the live one resolves each path
// with `resolveInside` (no escape, no link out), the proposal one is rooted at `proposal/`.

import path from 'node:path';

import { SYSTEM_JSON_MAX_BYTES, SYSTEM_NOTE_MAX, SYSTEM_OVERVIEW_MAX, TOKENS_CSS_MAX_BYTES } from '../../shared/limits.ts';
import { buildSystemDetail, type SystemDetailSource } from '../../shared/system-json.ts';
import type { SystemComponent, SystemDetail, SystemEntryText, SystemState } from '../../shared/types.ts';
import { BundleMissingEntry, BundleTooLarge, bundleDocument, createLiveFileSource, type FileSource, type SourceFile } from '../bundle.ts';
import { checkAsset } from './assets.ts';
import { BOARD_ENTRY_FILE, buildBoardHtml } from './board-html.ts';
import { exampleFileOf, exampleKeyOf, type ExampleKind } from './specimen-html.ts';
import { listFiles, proposalDirOf, readProposalFile, readProposalsRecord, sha256Of } from './proposal-record.ts';
import type { SystemStore } from './store.ts';

const BYTES_PER_CHAR_MAX = 4;
/** Top-level names that are never system content (store.ts `NOT_CONTENT`). */
const NOT_CONTENT = new Set(['BUILD.json', 'PROPOSAL.json', 'proposal', 'snapshot']);

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

/** A version's (or proposal's) files read into the detail source `buildSystemDetail` takes, with the store's caps. */
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

const bundleOrThrow = async (source: FileSource, rel: string, mode: 'render' | 'export') => {
  try {
    return await bundleDocument(source, rel, { mode });
  } catch (error) {
    if (error instanceof BundleTooLarge) return null;
    if (error instanceof BundleMissingEntry) return null;
    throw error;
  }
};

/**
 * The board document for one detail and file source: each live example bundled on its own (relative to
 * its folder, export mode, so its remote refs are reported per entry): components', and since
 * system-builder-depth D4 pattern and brand entries', exactly alike. Fonts and logos are checked with
 * `checkAsset` before the board names them, then `buildBoardHtml`. `assetKeys` are the `file:sha256`
 * parts the board cache keys on. `components`, `patterns` and `brand` carry the remote refs found.
 */
export const assembleBoardHtml = async (
  detail: SystemDetail,
  source: FileSource,
  scheme: 'light' | 'dark',
  options: { eager?: boolean } = {},
): Promise<{ html: string; components: SystemComponent[]; patterns: SystemEntryText[]; brand: SystemEntryText[]; assetKeys: string[] }> => {
  const examples: Record<string, string> = {};
  const assetKeys: string[] = [];
  const withExample = async <T extends { id: string; example: { remote: string[] } | null }>(kind: ExampleKind, entry: T): Promise<T> => {
    if (entry.example === null) return entry;
    const bundled = await bundleOrThrow(source, exampleFileOf(kind, entry.id), 'export');
    if (bundled === null) return entry;
    examples[exampleKeyOf(kind, entry.id)] = bundled.html;
    return { ...entry, example: { remote: bundled.external } };
  };
  const components = await Promise.all(detail.components.map((component) => withExample('component', component)));
  const patterns = await Promise.all(detail.patterns.map((entry) => withExample('pattern', entry)));
  const brand = await Promise.all(detail.brand.map((entry) => withExample('brand', entry)));

  const unusable = new Set<string>();
  for (const { file, kind } of [...detail.fonts.map((font) => ({ file: font.file, kind: 'font' as const })), ...detail.logos.map((logo) => ({ file: logo.file, kind: 'logo' as const }))]) {
    const bytes = await source.read(file).catch(() => null);
    if (bytes === null || !checkAsset(path.posix.basename(file), kind, bytes.bytes).ok) unusable.add(file);
    else assetKeys.push(`${file}:${sha256Of(bytes.bytes)}`);
  }

  const html = buildBoardHtml({ ...detail, components, patterns, brand }, { scheme, examples, unusable, ...(options.eager === true ? { eager: true } : {}) });
  return { html, components, patterns, brand, assetKeys };
};

/**
 * The waiting proposal's board source (D10): `proposal/` read as a system folder for the current
 * PROPOSAL.json, or null when there is none (internal home, no file, no readable id, no `proposal/`
 * folder, or a proposal already approved, declined or superseded). The board service turns null into
 * its not-found; the check draws the live board instead. `proposalDirOf` keeps its containment.
 */
export const readProposalBoardSource = async (
  store: Pick<SystemStore, 'dir' | 'readState'>,
  id: string,
): Promise<{ detail: SystemDetail; source: FileSource; proposalId: string; sha: string } | null> => {
  const dir = await store.dir(id);
  const state = await store.readState(id);
  if (state.home?.kind !== 'repo') return null;
  const file = await readProposalFile(dir);
  if (file.kind === 'absent') return null;
  const proposalId = file.parsed.id;
  if (proposalId === null) return null;
  const record = await readProposalsRecord(dir);
  const seen = record?.seen.find((entry) => entry.id === proposalId) ?? null;
  if (seen !== null && (seen.state === 'approved' || seen.state === 'declined' || seen.state === 'superseded')) return null;
  const proposalDir = await proposalDirOf(dir);
  if (proposalDir === null) return null;
  const source = createLiveFileSource(proposalDir);
  const rels = await listFiles(proposalDir);
  const detail = buildSystemDetail(await detailSourceFromTree({ id, dir, state, rels }, source));
  return { detail, source, proposalId, sha: sha256Of(`${file.fileSha256}\n${rels.sort().join('\n')}`) };
};