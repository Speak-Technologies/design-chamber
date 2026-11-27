// The pure half of the Code scan (documentation/specs/phase-2-5-technical.md §7.1 to §7.3): which
// project files are candidates, what each one says with certainty (CSS custom properties in a light
// or dark context, DTCG and Style Dictionary token JSON, @font-face rules), the seed files a new
// system is made from (§7.2), and the re-sync review (§7.3). No filesystem here: `extract.ts`
// walks, reads and keeps the jobs.
//
// Every value kept passes rule 1 of §2.4 (`validateTokenValue` with the `other` section: the
// preview alphabet, balanced quotes and brackets, colour and formula functions only), so no value
// a project holds can break out of a declaration when it is written into a system's tokens.css.

import path from 'node:path';

import type { CodeResyncReview } from '../../shared/api.ts';
import { SYSTEM_TOKEN_NAME_PATTERN, SYSTEM_TOKENS_MAX } from '../../shared/limits.ts';
import { classifyToken, isDarkContext, isLightContext, validateTokenValue } from '../../shared/token-edit.ts';
import { scanFontFaces, scanTokens, type Declaration } from '../../shared/tokens-css.ts';
import type { ColourGroup, SystemDetail, SystemState, TokenSection } from '../../shared/types.ts';
import { designDocWhy } from '../discovery.ts';

// ---- which files ----

const baseOf = (rel: string): string => (rel.split('/').at(-1) ?? rel).toLowerCase();
const dirsOf = (rel: string): string[] => rel.toLowerCase().split('/').slice(0, -1);
const extOf = (rel: string): string => {
  const base = baseOf(rel);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
};

/**
 * Files that may hold keys or passwords (§7.1). They are never opened, whatever else their name
 * says (`.env.theme.css` is a secret file, not a stylesheet).
 */
export const isSecretName = (rel: string): boolean => {
  const base = baseOf(rel);
  if (base === '.env' || base.startsWith('.env.') || base === '.npmrc' || base === '.netrc') return true;
  if (base.startsWith('id_rsa') || base.startsWith('id_ed25519')) return true;
  return ['pem', 'key', 'p12', 'pfx', 'crt', 'cer', 'keystore'].includes(extOf(rel));
};

/** Token JSON (§7.1): `*tokens*.json` (so `design-tokens*.json` too) and any JSON under a `tokens` folder. */
export const isTokenJsonFile = (rel: string): boolean => extOf(rel) === 'json' && (baseOf(rel).includes('tokens') || dirsOf(rel).includes('tokens'));

export const isCssFile = (rel: string): boolean => extOf(rel) === 'css';

/** Sass and Less: read only to say whether they hold variables the agent should look at. */
export const isPreprocessorFile = (rel: string): boolean => ['scss', 'sass', 'less'].includes(extOf(rel));

export const FONT_EXTENSIONS: readonly string[] = ['woff2', 'woff', 'ttf', 'otf'];
const LOGO_EXTENSIONS: readonly string[] = ['svg', 'png', 'jpg', 'jpeg', 'webp'];

/** A logo by its name and type (§7.1); its size is checked from `stat` only. */
export const isLogoCandidate = (rel: string): boolean => LOGO_EXTENSIONS.includes(extOf(rel)) && /logo|brand|wordmark|logomark/i.test(baseOf(rel));

/** A font file in a `fonts` folder (§7.1), offered even when no @font-face names it. */
export const isFontFolderFile = (rel: string): boolean => FONT_EXTENSIONS.includes(extOf(rel)) && dirsOf(rel).includes('fonts');

export const TAILWIND_CONFIG = /^tailwind\.config\.(js|cjs|mjs|ts)$/;

/**
 * Whether a CSS file imports Tailwind v4 (`@import "tailwindcss"` or a part of it, as `tailwindcss/theme.css`),
 * outside comments. An unclosed comment runs to the end, which also keeps this linear on any input.
 */
export const importsTailwind = (css: string): boolean =>
  css.includes('tailwindcss') &&
  /(?:^|[;}])\s*@import\s+(?:url\(\s*)?(["'])tailwindcss(?:\/[^"'\s]*)?\1/i.test(css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' '));

/** Files listed for the agent by name alone (§7.1): paths and a reason, never contents. */
export const forAgentByName = (rel: string): string | null => {
  const base = baseOf(rel);
  if (TAILWIND_CONFIG.test(base)) return 'Tailwind config: the agent can read its theme.';
  if (/^theme\.(ts|js)$/.test(base)) return 'Theme written in code: the agent can read it.';
  const doc = designDocWhy(rel);
  return doc === null ? null : `${doc.charAt(0).toUpperCase()}${doc.slice(1)}: the agent can read it.`;
};

/** A Sass or Less file worth the agent's time: `$name:` / `@name:` variables or custom properties. */
export const preprocessorHasVariables = (text: string): boolean => /^\s*[$@][A-Za-z_][\w-]*\s*:/m.test(text) || /--[A-Za-z_][\w-]*\s*:/.test(text);

// ---- what a file says ----

/** One token as one file states it; `hint` is the section a token JSON `$type` suggests. */
export type ExtractedToken = { name: string; light: string | null; dark: string | null; line: number; hint: TokenSection | null };

/** A font named by an `@font-face` rule, its file resolved inside the project (lexically; the caller checks it exists). */
export type ExtractedFace = { path: string; family: string; weight: number; style: 'normal' | 'italic' };

export type FileExtraction = {
  tokens: ExtractedToken[];
  /** Declarations in a light or dark context whose name or value Design Chamber can't use (no value text kept). */
  refused: number;
  /** Token JSON with object values (typography, shadow groups): listed for the agent. */
  composite: boolean;
  /** Token JSON that is not JSON. */
  unreadable: boolean;
  faces: ExtractedFace[];
};

const emptyExtraction = (): FileExtraction => ({ tokens: [], refused: 0, composite: false, unreadable: false, faces: [] });

/** Rule 1 of §2.4 only: what any section may hold, or a motion value (its easings call `cubic-bezier(` and `steps(`). */
const usableValue = (value: string): boolean => validateTokenValue('other', null, value).ok || validateTokenValue('motion', null, value).ok;

const lineAt = (text: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 0x0a) line += 1;
  return line;
};

const FONT_FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

const weightOf = (text: string | null): number => {
  const first = (text ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (first === 'bold') return 700;
  const number = Number(first);
  return Number.isInteger(number) && number >= 1 && number <= 1000 ? number : 400;
};

/**
 * A `url(…)` of an `@font-face` resolved against the CSS file, as a project-relative path; null when
 * it is absolute, remote, a data URL, leaves the project, or is not a font type a system takes.
 */
export const resolveFontUrl = (cssFile: string, url: string): string | null => {
  const bare = url.split(/[?#]/)[0] ?? '';
  if (bare === '' || bare.includes('\\') || bare.includes('\u0000') || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.includes('\u0000')) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(cssFile), decoded));
  if (joined === '..' || joined.startsWith('../') || path.posix.isAbsolute(joined) || joined === '.') return null;
  return FONT_EXTENSIONS.includes(extOf(joined)) ? joined : null;
};

/** §7.1 "Read with certainty", CSS: the light and dark custom properties and the `@font-face` rules of one file. */
export const extractFromCss = (text: string, file: string): FileExtraction => {
  const out = emptyExtraction();
  const byName = new Map<string, { light: Declaration | null; dark: Declaration | null; first: number }>();
  for (const declaration of scanTokens(text)) {
    const light = isLightContext(declaration.context, 'extraction');
    const dark = !light && isDarkContext(declaration.context, 'extraction');
    if (!light && !dark) continue; // component styling, not a token
    const value = text.slice(declaration.from, declaration.to);
    if (!SYSTEM_TOKEN_NAME_PATTERN.test(declaration.name) || declaration.broken || !usableValue(value)) {
      out.refused += 1;
      continue;
    }
    const entry = byName.get(declaration.name) ?? { light: null, dark: null, first: declaration.start };
    if (light) entry.light = declaration; // the last one in the file is the one a browser applies
    else entry.dark = declaration;
    byName.set(declaration.name, entry);
  }
  for (const [name, entry] of [...byName].sort((a, b) => a[1].first - b[1].first)) {
    const at = entry.light ?? entry.dark;
    out.tokens.push({
      name,
      light: entry.light === null ? null : text.slice(entry.light.from, entry.light.to),
      dark: entry.dark === null ? null : text.slice(entry.dark.from, entry.dark.to),
      line: at === null ? 1 : lineAt(text, at.start),
      hint: null,
    });
  }
  for (const face of scanFontFaces(text)) {
    const resolved = face.urls.map((url) => resolveFontUrl(file, url)).find((one) => one !== null);
    if (resolved === undefined || resolved === null) continue;
    const family = (face.family ?? '').trim();
    const style = /italic|oblique/i.test(face.style ?? '') ? 'italic' : 'normal';
    out.faces.push({ path: resolved, family: FONT_FAMILY_PATTERN.test(family) ? family : '', weight: weightOf(face.weight), style });
  }
  return out;
};

/** Folder levels a token JSON is read down to (§7.1). */
export const TOKEN_JSON_DEPTH_MAX = 8;

/** DTCG `$type` → the section it suggests; other types are classified by name and value. */
const SECTION_OF_TYPE: Readonly<Record<string, TokenSection>> = {
  color: 'colours',
  fontfamily: 'typography',
  fontweight: 'typography',
  shadow: 'shadows',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const nameOfPath = (parts: readonly string[]): string => `--${parts.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

/** `{color.brand.500}` → `var(--color-brand-500)` (a formula). */
const withReferences = (value: string): string => value.replace(/\{([^{}]+)\}/g, (_match, ref: string) => `var(${nameOfPath(ref.split('.'))})`);

/**
 * §7.1 "Read with certainty", token JSON: DTCG (`$value`) and Style Dictionary (`value`) leaves with a
 * string or number value, named `--` + the path joined by `-`; objects as values are composite (for
 * the agent). Every value is a light value: token JSON has no colour scheme context.
 */
export const extractFromTokenJson = (text: string, _file: string): FileExtraction => {
  const out = emptyExtraction();
  let root: unknown;
  try {
    root = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    out.unreadable = true;
    return out;
  }
  let cursor = 0;
  const lineOf = (key: string): number => {
    // Best effort: the leaf's key after the previous leaf (JSON keeps no positions).
    const at = text.indexOf(JSON.stringify(key), cursor);
    if (at < 0) return 1;
    cursor = at + 1;
    return lineAt(text, at);
  };
  const seen = new Set<string>();
  const visit = (node: unknown, parts: string[], depth: number, inheritedType: string | null): void => {
    if (depth > TOKEN_JSON_DEPTH_MAX || !isRecord(node)) return;
    const type = typeof node.$type === 'string' ? node.$type : inheritedType;
    const key = Object.hasOwn(node, '$value') ? '$value' : Object.hasOwn(node, 'value') && parts.length > 0 ? 'value' : null;
    if (key !== null) {
      const raw = node[key];
      if (typeof raw === 'object' && raw !== null) {
        out.composite = true;
        return;
      }
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        out.refused += 1;
        return;
      }
      const name = nameOfPath(parts);
      const value = typeof raw === 'number' ? String(raw) : withReferences(raw.trim());
      if (!SYSTEM_TOKEN_NAME_PATTERN.test(name) || !Number.isFinite(typeof raw === 'number' ? raw : 0) || !usableValue(value)) {
        out.refused += 1;
        return;
      }
      if (seen.has(name)) return; // two paths that name the same token: the first stands
      seen.add(name);
      out.tokens.push({ name, light: value, dark: null, line: lineOf(parts.at(-1) ?? ''), hint: SECTION_OF_TYPE[(type ?? '').toLowerCase()] ?? null });
      return;
    }
    for (const child of Object.keys(node)) {
      if (child.startsWith('$')) continue; // $description, $extensions, …
      visit(node[child], [...parts, child], depth + 1, type);
    }
  };
  visit(root, [], 0, null);
  return out;
};

// ---- merging the files ----

/** A token as the scan keeps it in memory: the first file (by priority) that sets each mode wins. */
export type ScannedToken = {
  name: string;
  light: string | null;
  dark: string | null;
  /** The file and line of the value kept (the light one when there is one). */
  file: string;
  line: number;
  section: TokenSection;
  /** Later files that set a different value ("Also set in <file>"), ≤ 3. */
  alsoIn: string[];
};

const ALSO_IN_MAX = 3;

/**
 * Merge the files' tokens in priority order (token JSON, then CSS shallowest first): the first value
 * of each mode stands; a later different one only adds "Also set in". Capped at `SYSTEM_TOKENS_MAX`.
 */
export const mergeTokens = (perFile: readonly { file: string; tokens: readonly ExtractedToken[] }[]): { tokens: ScannedToken[]; capped: boolean } => {
  const byName = new Map<string, ScannedToken & { hint: TokenSection | null }>();
  let capped = false;
  for (const { file, tokens } of perFile) {
    for (const token of tokens) {
      const existing = byName.get(token.name);
      if (existing === undefined) {
        if (byName.size >= SYSTEM_TOKENS_MAX) {
          capped = true;
          continue;
        }
        byName.set(token.name, { name: token.name, light: token.light, dark: token.dark, file, line: token.line, section: 'other', alsoIn: [], hint: token.hint });
        continue;
      }
      let differs = false;
      if (token.light !== null) {
        if (existing.light === null) existing.light = token.light;
        else if (existing.light !== token.light) differs = true;
      }
      if (token.dark !== null) {
        if (existing.dark === null) existing.dark = token.dark;
        else if (existing.dark !== token.dark) differs = true;
      }
      if (differs && file !== existing.file && !existing.alsoIn.includes(file) && existing.alsoIn.length < ALSO_IN_MAX) existing.alsoIn.push(file);
    }
  }
  const tokens = [...byName.values()].map(({ hint, ...token }) => ({ ...token, section: hint ?? classifyToken(token.name, token.light ?? token.dark ?? '') }));
  return { tokens, capped };
};

// ---- seeds (§7.2) ----

export const SECTION_ORDER: readonly TokenSection[] = ['colours', 'typography', 'spacing', 'radius', 'shadows', 'layers', 'sizes', 'other'];

const SECTION_HEADINGS: Readonly<Record<TokenSection, string>> = {
  colours: 'Colours',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Radius',
  shadows: 'Shadows',
  motion: 'Motion',
  layers: 'Layers',
  sizes: 'Sizes',
  other: 'Other tokens',
};

/** §7.2 colour groups from name hints, in this order; null leaves the group to default (`other`). */
export const colourGroupOf = (name: string): ColourGroup | null => {
  const lower = name.toLowerCase();
  if (/brand|primary|accent/.test(lower)) return 'brand';
  if (/bg|surface|background|card/.test(lower)) return 'surface';
  if (/text|fg|foreground|ink/.test(lower)) return 'text';
  if (/border|stroke|outline|ring/.test(lower)) return 'border';
  if (/success|warning|error|danger|info/.test(lower)) return 'status';
  if (/chart|data|series/.test(lower)) return 'data';
  return null;
};

export type SeedToken = { name: string; light: string | null; dark: string | null; section: TokenSection };

const EMPTY_TOKENS_CSS = ':root {\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n  }\n}\n';

const block = (tokens: readonly SeedToken[], mode: 'light' | 'dark', indent: string): string => {
  const lines: string[] = [];
  for (const section of SECTION_ORDER) {
    const inSection = tokens.filter((token) => token.section === section && token[mode] !== null);
    if (inSection.length === 0) continue;
    if (lines.length > 0) lines.push('');
    lines.push(`${indent}/* ${SECTION_HEADINGS[section]} */`);
    for (const token of inSection) lines.push(`${indent}${token.name}: ${token[mode] ?? ''};`);
  }
  return lines.map((line) => `${line}\n`).join('');
};

/**
 * The new system's tokens.css (§2.4 structure, §7.2): light `:root` grouped by section with comments,
 * then the dark media block. Every value has passed rule 1, and the result is rescanned: anything
 * that would not read back as exactly these declarations throws instead of being written.
 */
export const seedTokensCss = (tokens: readonly SeedToken[]): string => {
  const light = block(tokens, 'light', '  ');
  const dark = block(tokens, 'dark', '    ');
  const css = `:root {\n${light}}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n${dark}  }\n}\n`;
  const expected = tokens.flatMap((token) => [
    ...(token.light === null ? [] : [{ name: token.name, mode: 'light' as const, value: token.light }]),
    ...(token.dark === null ? [] : [{ name: token.name, mode: 'dark' as const, value: token.dark }]),
  ]);
  const read = scanTokens(css);
  const exact =
    read.length === expected.length &&
    read.every((declaration) => {
      const mode = isLightContext(declaration.context, 'system') ? 'light' : isDarkContext(declaration.context, 'system') ? 'dark' : null;
      const value = css.slice(declaration.from, declaration.to);
      return mode !== null && !declaration.broken && !declaration.comment && !declaration.important && expected.some((one) => one.name === declaration.name && one.mode === mode && one.value === value);
    });
  if (!exact) throw new Error('extract: the seed tokens.css does not read back as the scanned values.');
  return tokens.length === 0 ? EMPTY_TOKENS_CSS : css;
};

/** system.json's `tokens` metadata, `fonts` and `logos` for a new system (§2.3, §7.2). */
export const seedSystemJson = (
  tokens: readonly SeedToken[],
  fonts: readonly { file: string; family: string; weight: number; style: 'normal' | 'italic' }[],
  logos: readonly { file: string; variant: string }[],
): string => {
  const meta: Record<string, { section: TokenSection; group?: ColourGroup }> = {};
  for (const token of tokens) {
    const group = token.section === 'colours' ? colourGroupOf(token.name) : null;
    meta[token.name] = group === null ? { section: token.section } : { section: token.section, group };
  }
  return `${JSON.stringify({ version: 1, tokens: meta, ...(fonts.length > 0 ? { fonts } : {}), ...(logos.length > 0 ? { logos } : {}) }, null, 2)}\n`;
};

/** A bundled preset's `:root` custom properties (§7.2), from the fenced CSS blocks of its markdown. */
export const presetRootTokens = (markdown: string): SeedToken[] => {
  const out: SeedToken[] = [];
  const seen = new Set<string>();
  for (const fence of markdown.matchAll(/```css\s*\n([\s\S]*?)```/g)) {
    const css = fence[1] ?? '';
    for (const declaration of scanTokens(css)) {
      if (declaration.context.kind !== 'root' || !SYSTEM_TOKEN_NAME_PATTERN.test(declaration.name) || declaration.broken) continue;
      const value = css.slice(declaration.from, declaration.to);
      if (!usableValue(value) || seen.has(declaration.name)) continue;
      seen.add(declaration.name);
      out.push({ name: declaration.name, light: value, dark: null, section: classifyToken(declaration.name, value) });
    }
  }
  return out;
};

// ---- the re-sync review (§7.3) ----

export type ScanForReview = {
  tokens: readonly Pick<ScannedToken, 'name' | 'light' | 'dark'>[];
  /** Files the scan read (project-relative). */
  scanned: readonly string[];
  assets: readonly { path: string; kind: 'font' | 'logo' }[];
  partial: boolean;
};

/**
 * Pure (§7.3): what changed in the code since the system was made from it. Only tokens with code
 * provenance can be Changed, Conflicts or No longer in the code; a token whose file was not read
 * this time is never listed as removed. A mode the code added or dropped is not a change of value
 * and is not listed (the review compares values).
 */
export const resyncReview = (
  detail: Pick<SystemDetail, 'tokens' | 'fonts' | 'logos'>,
  provenance: SystemState['provenance'],
  scan: ScanForReview,
): CodeResyncReview => {
  const scanned = new Map(scan.tokens.map((token) => [token.name, token]));
  const system = new Map(detail.tokens.map((token) => [token.name, token]));
  const read = new Set(scan.scanned);
  const review: CodeResyncReview = { kind: 'code', changed: [], conflicts: [], added: [], removed: [], assets: [], partial: scan.partial };
  for (const name of Object.keys(provenance).sort()) {
    const recorded = provenance[name];
    if (recorded === undefined) continue;
    const code = scanned.get(name);
    if (code === undefined) {
      if (read.has(recorded.file)) review.removed.push(name);
      continue;
    }
    const mine = system.get(name);
    for (const mode of ['light', 'dark'] as const) {
      const was = recorded[mode];
      const now = code[mode];
      if (was === null || now === null || was === now) continue;
      const here = mine?.[mode]?.text ?? null;
      if (here === was) review.changed.push({ name, mode, from: was, to: now });
      else review.conflicts.push({ name, mode, mine: here ?? '', code: now });
    }
  }
  for (const token of scan.tokens) if (!system.has(token.name)) review.added.push(token.name);
  const have = new Set([...detail.fonts, ...detail.logos].map((asset) => baseOf(asset.file)));
  for (const asset of scan.assets) if (!have.has(baseOf(asset.path))) review.assets.push({ path: asset.path, kind: asset.kind });
  return review;
};
