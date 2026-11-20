// A project repo holding a design system folder, and a designs root beside it (or inside it), for
// the repo-backed system tests (documentation/specs/phase-2-5-technical.md §5.10, §5.12, §7.4): the
// snapshot, the repo re-sync, the code drift and the read-only proof.

import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestContext } from 'node:test';

import type { ServiceContext } from '../../../src/service/context.ts';
import { ensureSystemStore, type SystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { createTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

export const TOKENS = ':root {\n  --brand-500: #1a73e8;\n  --space-2: 8px;\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand-500: #8ab4f8;\n  }\n}\n';

export const SYSTEM_JSON = `${JSON.stringify(
  {
    version: 1,
    logos: [{ file: 'assets/logos/acme.svg', variant: 'primary', note: '' }],
    components: [{ id: 'button', name: 'Button', example: 'components/button.html' }],
    notes: [{ id: 'history', title: 'History' }],
  },
  null,
  2,
)}\n`;

/** The repo's system folder: contract files, plus files the snapshot must never hold. */
export const REPO_FILES: Record<string, string> = {
  'package.json': '{"name":"shop"}\n',
  'src/theme.css': ':root {\n  --brand-500: #1A73E8 ;\n  --space-2: 8px;\n}\n',
  'design-system/tokens.css': TOKENS,
  'design-system/system.json': SYSTEM_JSON,
  'design-system/OVERVIEW.md': 'Acme in one paragraph.\n',
  'design-system/notes/history.md': 'Why the palette changed.\n',
  'design-system/components/button.html': '<button>Go</button>\n',
  'design-system/assets/logos/acme.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  // Not contract paths: counted as ignored, never copied.
  'design-system/README.md': '# The design system\n',
  'design-system/extra.css': ':root {\n  --brand-500: #000000;\n}\n',
  'design-system/notes/deep/nested.md': 'Too deep for the contract.\n',
  // A contract path whose name looks like a secret: listed in skipped, never opened.
  'design-system/sources/deploy.pem': '-----BEGIN PRIVATE KEY-----\nnot a real key\n-----END PRIVATE KEY-----\n',
  // The committed living page: the service's own output, skipped without a word.
  'design-system/index.html': '<!doctype html><title>Acme</title>\n',
};

export type RepoRig = {
  tmp: TmpRoot;
  base: string;
  project: string;
  root: string;
  ctx: FakeContext & ServiceContext;
  systems: SystemStore;
  /** A repo path relative to the project, `/`-separated. */
  repo(rel: string): string;
  /** A system made by the user, then given a repo home on `project` (as an adoption would). */
  repoSystem(name?: string, home?: { directory?: string; folder?: string; livingPage?: string }): Promise<string>;
};

export const setupRepo = async (t: TestContext, options: { rootInsideProject?: boolean } = {}): Promise<RepoRig> => {
  const tmp = await createTmpRoot('dc-repo-');
  const base = tmp.root;
  const project = path.join(base, 'shop');
  for (const [rel, text] of Object.entries(REPO_FILES)) await tmp.write(`shop/${rel}`, text);
  const root = options.rootInsideProject === true ? path.join(project, 'Designs') : path.join(base, 'Designs');
  await mkdir(root, { recursive: true });
  const ctx = createFakeContext({ root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } }) as FakeContext & ServiceContext;
  t.after(() => ctx.dispose());
  const systems = ensureSystemStore(ctx);
  const rig: RepoRig = {
    tmp,
    base,
    project,
    root,
    ctx,
    systems,
    repo: (rel) => path.join(project, ...rel.split('/')),
    async repoSystem(name = 'Acme', home = {}) {
      const { id } = await systems.create({ name });
      await systems.withLock(id, () =>
        systems.updateStateLocked(id, (state) => ({
          ...state,
          home: {
            kind: 'repo',
            directory: home.directory ?? project,
            folder: home.folder ?? 'design-system',
            livingPage: home.livingPage ?? 'design-system/index.html',
            adoptedAt: '2026-11-20T09:00:00.000Z',
          },
        })),
      );
      return id;
    },
  };
  // Added last: node:test runs `after` hooks in order, so every service is stopped before this.
  t.after(() => tmp.cleanup());
  return rig;
};

/**
 * Every entry under `dir`: a file's bytes, mode and mtime, a folder's mode and mtime, a link's
 * target text. Compared before and after a step, it proves the step left the tree exactly as it was.
 */
export const fingerprintTree = async (dir: string, skip: (rel: string) => boolean = () => false): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const walk = async (rel: string): Promise<void> => {
    const abs = rel === '' ? dir : path.join(dir, ...rel.split('/'));
    const entries = (await readdir(abs, { withFileTypes: true })).map((entry) => entry.name).sort();
    out[`${rel}/`] = `listing:${entries.join('|')}`;
    for (const name of entries) {
      const child = rel === '' ? name : `${rel}/${name}`;
      if (skip(child)) continue;
      const info = await lstat(path.join(dir, ...child.split('/')));
      const meta = `mode:${info.mode.toString(8)} mtime:${info.mtimeMs} size:${info.size}`;
      if (info.isSymbolicLink()) out[child] = `link ${meta}`;
      else if (info.isDirectory()) {
        out[child] = `dir ${meta}`;
        await walk(child);
      } else out[child] = `file ${meta} sha:${createHash('sha256').update(await readFile(path.join(dir, ...child.split('/')))).digest('hex')}`;
    }
  };
  await walk('');
  return out;
};
