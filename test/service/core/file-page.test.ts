// "Open as page in Design Chamber" on a Files row (documentation/specs/native-extras.md §3.3 to
// §3.7, task T5): the body parser, the pure target resolver on posix and win32, the bundler's dry
// run, the copy into a new design, and the importer end to end on a scratch root with a real
// store. Risk surface: a path from the request names a file outside the designs root, and the
// route writes a new design under it. Nothing here touches a real Designs folder.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { DesignSummary } from '../../../src/shared/types.ts';
import { FILE_PAGE_COPY_MAX_BYTES, FILE_PAGE_PATH_MAX, LOOSE_IMPORT_MAX_BYTES } from '../../../src/shared/limits.ts';
import type { DesignStore } from '../../../src/service/context.ts';
import {
  copyIntoDesign,
  CopyStopped,
  createFilePageImporter,
  FILE_PAGE_BUSY,
  FILE_PAGE_COPY_FAILED,
  FILE_PAGE_COPY_TOO_LARGE,
  FILE_PAGE_ENTRY_TOO_LARGE,
  FILE_PAGE_IN_ROOT,
  FILE_PAGE_IN_ROOT_OTHER,
  FILE_PAGE_LINK,
  FILE_PAGE_MISSING,
  FILE_PAGE_NETWORK,
  FILE_PAGE_NOT_FILE,
  FILE_PAGE_NOT_HTML,
  FILE_PAGE_OUTSIDE,
  FILE_PAGE_TOO_SLOW,
  FILE_PAGE_WHERE,
  parseFromFileBody,
  planAssets,
  resolveFileTarget,
  skipReasonOf,
} from '../../../src/service/file-page.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createCore, type Core } from './harness.ts';

// ---- helpers ----

const isApiError = (code: string, message?: string) => (error: unknown): boolean => {
  assert.ok(error instanceof ApiError, `expected an ApiError, got ${String(error)}`);
  assert.equal(error.code, code, error.message);
  if (message !== undefined) assert.equal(error.message, message);
  return true;
};

const designSlugs = async (root: string): Promise<string[]> =>
  (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();

const trashEntries = async (root: string): Promise<string[]> => (await readdir(path.join(root, '.trash')).catch(() => [])).sort();

/** Every file under `dir`, `/`-separated, sorted. */
const filesUnder = async (dir: string, prefix = ''): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await filesUnder(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
};

/** Make a symlink, or skip the test where the OS refuses (Windows without developer mode). */
const linkOrSkip = async (t: TestContext, target: string, at: string, type: 'file' | 'dir' = 'file'): Promise<boolean> => {
  try {
    await mkdir(path.dirname(at), { recursive: true });
    await symlink(target, at, type === 'dir' ? 'junction' : 'file');
    return true;
  } catch (error) {
    t.skip(`symlinks unavailable here: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
    return false;
  }
};

/** A sparse file of `bytes` (instant, nothing written): over-the-cap cases without filling the disk. */
const sparse = async (file: string, bytes: number): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '');
  await truncate(file, bytes);
};

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x01]);
const AT = new Date('2026-11-27T10:00:00.000Z');

type Env = {
  core: Core;
  project: string;
  outside: string;
  importer: ReturnType<typeof createFilePageImporter>;
  /** Re-read the store into the fake design index (what the real index does on `added`). */
  refreshIndex(): Promise<void>;
  /** A second importer on the same root: a service restart (no in-process memory of copies). */
  restart(): ReturnType<typeof createFilePageImporter>;
};

type EnvOptions = { clock?: () => number; store?: (base: Core['store']) => Pick<DesignStore, 'create' | 'trash' | 'get' | 'dir'> };

const setup = async (t: TestContext, options: EnvOptions = {}): Promise<Env> => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const project = core.tmp.at('project');
  const outside = core.tmp.at('outside');
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  let summaries: readonly DesignSummary[] = [];
  const make = () =>
    createFilePageImporter({
      settings: core.ctx.settings,
      store: options.store?.(core.store) ?? core.store,
      designIndex: { all: () => summaries, ready: async () => true },
      log: core.ctx.log,
      ...(options.clock ? { clock: options.clock } : {}),
      now: () => AT,
    });
  return {
    core,
    project,
    outside,
    importer: make(),
    refreshIndex: async () => {
      summaries = await core.store.list();
    },
    restart: make,
  };
};

const readState = async (designDir: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path.join(designDir, '.chamber', 'state.json'), 'utf8')) as Record<string, unknown>;

// ---- step 1: the body ----

describe('parseFromFileBody', () => {
  test('accepts exactly { path, directory } with path text and directory text or null', () => {
    assert.deepEqual(parseFromFileBody({ path: '/p/a.html', directory: null }), { path: '/p/a.html', directory: null });
    assert.deepEqual(parseFromFileBody({ path: 'a.html', directory: '/p' }), { path: 'a.html', directory: '/p' });
    const longest = `/${'a'.repeat(FILE_PAGE_PATH_MAX - 6)}.html`;
    assert.equal(longest.length, FILE_PAGE_PATH_MAX);
    assert.equal(parseFromFileBody({ path: longest, directory: null }).path, longest);
  });

  test('anything else is 400 bad-request: wrong shape, extra or missing keys, empty, too long, control characters', () => {
    const tooLong = `/${'a'.repeat(FILE_PAGE_PATH_MAX - 5)}.html`;
    for (const body of [
      null,
      'a.html',
      ['a.html'],
      7,
      {},
      { path: '/p/a.html' },
      { directory: null },
      { path: '/p/a.html', directory: null, open: true },
      { path: '', directory: null },
      { path: tooLong, directory: null },
      { path: '/p/a\u0000.html', directory: null },
      { path: '/p/a\n.html', directory: null },
      { path: '/p/a\u001b.html', directory: null },
      { path: '/p/a\u007f.html', directory: null },
      { path: 5, directory: null },
      { path: '/p/a.html', directory: '' },
      { path: '/p/a.html', directory: 7 },
      { path: '/p/a.html', directory: '/p\u0000' },
      { path: '/p/a.html', directory: tooLong },
    ]) {
      assert.throws(() => parseFromFileBody(body), isApiError('bad-request'), JSON.stringify(body));
    }
  });
});

// ---- step 2: the target (pure, posix and win32) ----

describe('resolveFileTarget on posix', () => {
  const resolve = (file: string, directory: string | null = null, platform: NodeJS.Platform = 'linux') => resolveFileTarget(file, directory, path.posix, platform);

  test('an absolute path is used as given, normalised; a relative one is joined to its folder', () => {
    assert.deepEqual(resolve('/home/me/p/a.html'), { target: '/home/me/p/a.html', directory: null, name: 'a.html' });
    assert.deepEqual(resolve('/home/me/p/./x/../a.HTM', '/home/me/p/'), { target: '/home/me/p/a.HTM', directory: '/home/me/p', name: 'a.HTM' });
    assert.deepEqual(resolve('src/page.html', '/home/me/p'), { target: '/home/me/p/src/page.html', directory: '/home/me/p', name: 'page.html' });
    assert.equal(resolve('/elsewhere/a.html', '/home/me/p').target, '/elsewhere/a.html', 'an absolute path does not need to be under the folder');
  });

  test('a relative path that leaves its folder is refused, a sibling with the same prefix included', () => {
    for (const file of ['../../etc/x.html', '../x.html', 'src/../../p2/a.html', '..']) {
      assert.throws(() => resolve(file, '/home/me/p'), isApiError('invalid', FILE_PAGE_OUTSIDE), file);
    }
  });

  test('case: Linux keeps it (../P is another folder), macOS folds it', () => {
    assert.throws(() => resolve('../P/a.html', '/home/me/p'), isApiError('invalid', FILE_PAGE_OUTSIDE));
    assert.equal(resolve('../P/a.html', '/Users/me/p', 'darwin').target, '/Users/me/P/a.html');
  });

  test('a relative path without a folder, or a folder that is not absolute, is refused', () => {
    assert.throws(() => resolve('a.html'), isApiError('invalid', FILE_PAGE_WHERE));
    assert.throws(() => resolve('C:\\Users\\me\\a.html'), isApiError('invalid', FILE_PAGE_WHERE), 'a Windows path is relative on posix');
    assert.throws(() => resolve('a.html', 'relative/dir'), isApiError('bad-path'));
  });

  test('network and device paths are refused in the path and in the folder', () => {
    for (const [file, directory] of [
      ['\\\\server\\share\\a.html', null],
      ['//server/share/a.html', null],
      ['\\\\?\\C:\\p\\a.html', null],
      ['\\\\.\\pipe\\a.html', null],
      ['/p/a.html', '//server/share'],
      ['a.html', '\\\\server\\share'],
    ] as const) {
      assert.throws(() => resolve(file, directory), isApiError('invalid', FILE_PAGE_NETWORK), `${file} in ${String(directory)}`);
    }
  });

  test('only .html and .htm names, in any case', () => {
    assert.equal(resolve('/p/a.HtMl').name, 'a.HtMl');
    for (const file of ['/p/a.txt', '/p/a.html.txt', '/p/a.htmlx', '/p/', '/p/html', '/']) {
      assert.throws(() => resolve(file), isApiError('invalid', FILE_PAGE_NOT_HTML), file);
    }
  });
});

describe('resolveFileTarget on win32', () => {
  const resolve = (file: string, directory: string | null = null) => resolveFileTarget(file, directory, path.win32, 'win32');

  test('drive paths in either slash are used as given; relative ones join the folder', () => {
    assert.equal(resolve('C:\\Users\\me\\p\\a.html').target, 'C:\\Users\\me\\p\\a.html');
    assert.equal(resolve('C:/Users/me/p/a.html').target, 'C:\\Users\\me\\p\\a.html');
    assert.equal(resolve('D:\\x\\a.html', 'C:\\p').target, 'D:\\x\\a.html', 'another drive, absolute, as given');
    assert.deepEqual(resolve('src\\a.html', 'C:\\Users\\me\\p'), { target: 'C:\\Users\\me\\p\\src\\a.html', directory: 'C:\\Users\\me\\p', name: 'a.html' });
    assert.equal(resolve('src/a.html', 'c:/users/me/p').target, 'c:\\users\\me\\p\\src\\a.html');
  });

  test('drive letter and folder case fold: ..\\P\\a.html under C:\\Users\\me\\p stays inside', () => {
    assert.equal(resolve('..\\P\\a.html', 'C:\\Users\\me\\p').target, 'C:\\Users\\me\\P\\a.html');
    assert.equal(resolve('a.html', 'c:\\USERS\\me\\p').target, 'c:\\USERS\\me\\p\\a.html');
  });

  test('a walk out of the folder, in either slash, is refused', () => {
    for (const file of ['..\\..\\Windows\\x.html', '../../Windows/x.html', 'src\\..\\..\\p2\\a.html']) {
      assert.throws(() => resolve(file, 'C:\\Users\\me'), isApiError('invalid', FILE_PAGE_OUTSIDE), file);
    }
  });

  test('drive-relative and rooted-without-drive forms are refused: they resolve against the service, not the project', () => {
    assert.throws(() => resolve('C:a.html', 'C:\\p'), isApiError('invalid', FILE_PAGE_WHERE));
    assert.throws(() => resolve('\\a.html', 'C:\\p'), isApiError('invalid', FILE_PAGE_WHERE));
    assert.throws(() => resolve('/a.html', 'C:\\p'), isApiError('invalid', FILE_PAGE_WHERE));
    assert.throws(() => resolve('a.html', 'C:'), isApiError('bad-path'));
    assert.throws(() => resolve('a.html', '\\p'), isApiError('bad-path'));
    assert.throws(() => resolve('a.html', 'p\\q'), isApiError('bad-path'));
    assert.throws(() => resolve('a.html'), isApiError('invalid', FILE_PAGE_WHERE));
  });

  test('UNC, long-path and device prefixes are refused', () => {
    for (const file of ['\\\\server\\share\\a.html', '//server/share/a.html', '\\\\?\\C:\\p\\a.html', '\\\\?\\UNC\\server\\share\\a.html', '\\\\.\\pipe\\a.html']) {
      assert.throws(() => resolve(file), isApiError('invalid', FILE_PAGE_NETWORK), file);
    }
    assert.throws(() => resolve('a.html', '\\\\server\\share\\p'), isApiError('invalid', FILE_PAGE_NETWORK));
  });

  test('names: .html/.htm in any case only', () => {
    assert.equal(resolve('C:\\p\\a.HTM').name, 'a.HTM');
    assert.throws(() => resolve('C:\\p\\a.exe'), isApiError('invalid', FILE_PAGE_NOT_HTML));
    assert.throws(() => resolve('C:\\p\\'), isApiError('invalid', FILE_PAGE_NOT_HTML));
  });
});

// ---- step 7: which local files are copied ----

describe('skipReasonOf', () => {
  test('bundler MIME types are copied; other types, the entry name and service paths are not', () => {
    for (const rel of ['img/a.png', 'a.css', 'fonts/x.woff2', 'app.js', 'data.json', 'frames/inner.html', 'sub/index.html', 'tokens.css', 'systems/x.png']) {
      assert.equal(skipReasonOf(rel), null, rel);
    }
    for (const rel of ['data.bin', 'notes.md', '.env', 'secrets.yaml', 'a.exe']) assert.equal(skipReasonOf(rel), 'type', rel);
    for (const rel of ['index.html', 'INDEX.HTML', 'design.json', 'Design.JSON', '.chamber/state.json', '.versions/a.json', 'img/.hidden.png', 'system/COPY.json', 'System/tokens.css']) {
      assert.equal(skipReasonOf(rel), 'reserved', rel);
    }
  });
});

describe('planAssets (the bundler dry run)', () => {
  test('a link inside the folder that points out of it is counted outside and never planned', async (t) => {
    const env = await setup(t);
    await writeFile(path.join(env.outside, 'secret.png'), PNG);
    await writeFile(path.join(env.project, 'ok.png'), PNG);
    if (!(await linkOrSkip(t, path.join(env.outside, 'secret.png'), path.join(env.project, 'assets', 'evil.png')))) return;
    if (!(await linkOrSkip(t, env.outside, path.join(env.project, 'out'), 'dir'))) return;
    const entry = Buffer.from('<img src="assets/evil.png"><img src="out/secret.png"><img src="ok.png">');
    const plan = await planAssets(env.project, 'page.html', entry, { overTime: () => false, caseFolds: false });
    assert.deepEqual(plan.keep.map((file) => file.rel), ['ok.png']);
    assert.deepEqual(plan.left, { outside: 2, missing: 0, other: 0 });
  });

  test('a sheet pulled in many times stops at the byte cap instead of growing the scan without end', async (t) => {
    const env = await setup(t);
    await writeFile(path.join(env.project, 'a.css'), 'x'.repeat(1024 * 1024));
    const entry = Buffer.from('<link rel="stylesheet" href="a.css">'.repeat(60));
    await assert.rejects(planAssets(env.project, 'page.html', entry, { overTime: () => false, caseFolds: false }), (error) => error instanceof CopyStopped && error.why === 'size');
  });
});

describe('copyIntoDesign (the copy step)', () => {
  test('re-contains every source: a file swapped for a link out after the scan, a folder link out and a crafted ../ are never read', async (t) => {
    const env = await setup(t);
    const design = env.core.tmp.at('designs/new-page');
    await mkdir(design, { recursive: true });
    await writeFile(path.join(env.outside, 'secret.png'), PNG);
    await writeFile(path.join(env.project, 'ok.png'), PNG);
    if (!(await linkOrSkip(t, path.join(env.outside, 'secret.png'), path.join(env.project, 'a.png')))) return;
    if (!(await linkOrSkip(t, env.outside, path.join(env.project, 'sub'), 'dir'))) return;
    const plan = {
      keep: [
        { rel: 'a.png', size: PNG.byteLength },
        { rel: 'sub/secret.png', size: PNG.byteLength },
        { rel: '../outside/secret.png', size: PNG.byteLength },
        { rel: 'ok.png', size: PNG.byteLength },
      ],
      left: { outside: 0, missing: 0, other: 0 },
    };
    const left = await copyIntoDesign(design, env.project, plan, Buffer.from('<p>entry</p>'), () => false);
    assert.deepEqual(left, { outside: 3, missing: 0, other: 0 });
    assert.deepEqual(await filesUnder(design), ['index.html', 'ok.png'], 'nothing from outside the folder was written');
  });

  test('a file that grew past the cap since the scan stops the copy', async (t) => {
    const env = await setup(t);
    const design = env.core.tmp.at('designs/new-page');
    await mkdir(design, { recursive: true });
    await sparse(path.join(env.project, 'big.png'), FILE_PAGE_COPY_MAX_BYTES + 1);
    await assert.rejects(
      copyIntoDesign(design, env.project, { keep: [{ rel: 'big.png', size: 1 }], left: { outside: 0, missing: 0, other: 0 } }, Buffer.from('x'), () => false),
      (error) => error instanceof CopyStopped && error.why === 'size',
    );
    assert.deepEqual(await filesUnder(design), [], 'the entry is written last, so nothing is there');
  });

  test('a file that vanished since the scan counts as missing', async (t) => {
    const env = await setup(t);
    const design = env.core.tmp.at('designs/new-page');
    await mkdir(design, { recursive: true });
    const left = await copyIntoDesign(design, env.project, { keep: [{ rel: 'gone.png', size: 3 }], left: { outside: 0, missing: 1, other: 0 } }, Buffer.from('x'), () => false);
    assert.deepEqual(left, { outside: 0, missing: 2, other: 0 });
  });
});

// ---- the importer end to end ----

describe('open a project file as a page', () => {
  test('copies the HTML byte for byte and every local file it uses at the same place, byte for byte', async (t) => {
    const env = await setup(t);
    const entry = Buffer.concat([
      Buffer.from('\ufeff<!doctype html><html><head><title>Pricing</title><link rel="stylesheet" href="css/site.css"><script src="app.js"></script></head><body>'),
      Buffer.from('<img src="img/logo.png"><img src="/img/root.png"><iframe src="frames/inner.html"></iframe><img src="https://example.com/x.png"><!-- '),
      Buffer.from([0xff, 0xfe, 0x80]), // not UTF-8: must survive untouched
      Buffer.from(' --></body></html>'),
    ]);
    const files: Record<string, Buffer> = {
      'css/site.css': Buffer.from('@import "parts/base.css"; body{background:url(../img/bg.png)} @font-face{font-family:a;src:url("../fonts/a.woff2")}'),
      'css/parts/base.css': Buffer.from('h1{color:red}'),
      'app.js': Buffer.from('console.log("hi")'),
      'img/logo.png': PNG,
      'img/root.png': Buffer.concat([PNG, Buffer.from([1])]),
      'img/bg.png': Buffer.concat([PNG, Buffer.from([2])]),
      'fonts/a.woff2': Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff]),
      'frames/inner.html': Buffer.from('<img src="pic.png">'),
      'frames/pic.png': Buffer.concat([PNG, Buffer.from([3])]),
    };
    await writeFile(path.join(env.project, 'page.html'), entry);
    for (const [rel, bytes] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(env.project, rel)), { recursive: true });
      await writeFile(path.join(env.project, rel), bytes);
    }

    const answer = await env.importer.open({ path: path.join(env.project, 'page.html'), directory: env.project });
    assert.deepEqual(answer, { slug: 'pricing', title: 'Pricing', reused: false, left: { outside: 0, missing: 0, other: 0 } });

    const design = path.join(env.core.root, 'pricing');
    assert.deepEqual(await readFile(path.join(design, 'index.html')), entry, 'the entry is byte-identical, BOM and bad bytes included');
    for (const [rel, bytes] of Object.entries(files)) assert.deepEqual(await readFile(path.join(design, ...rel.split('/'))), bytes, rel);
    assert.deepEqual(
      (await filesUnder(design)).filter((rel) => !rel.startsWith('.chamber/') && rel !== 'design.json'),
      ['app.js', 'css/parts/base.css', 'css/site.css', 'fonts/a.woff2', 'frames/inner.html', 'frames/pic.png', 'img/bg.png', 'img/logo.png', 'img/root.png', 'index.html'],
    );

    const state = await readState(design);
    assert.deepEqual(state.importedFrom, { path: path.join(env.project, 'page.html'), sha256: sha256Of(entry), at: AT.toISOString() });
    assert.equal(state.sessionId, null, 'linked to no chat (BRIEF 2026-11-10)');
    assert.equal(state.projectDirectory, env.project);
    const designJson = JSON.parse(await readFile(path.join(design, 'design.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(Object.hasOwn(designJson, 'importedFrom'), false, 'importedFrom stays in state.json');
    assert.equal(designJson.kind, 'page');
    const record = await env.core.store.get('pricing');
    assert.equal(record.pending, false);
    assert.equal(record.state.importedFrom?.sha256, sha256Of(entry));
    // The project was only read.
    assert.deepEqual(await readFile(path.join(env.project, 'page.html')), entry);
  });

  test('a relative path joins its folder; without a <title> the file name titles the page; no folder means no project', async (t) => {
    const env = await setup(t);
    await mkdir(path.join(env.project, 'site'), { recursive: true });
    await writeFile(path.join(env.project, 'site', 'launch-day.htm'), '<h1>Hi</h1>');
    const relative = await env.importer.open({ path: 'site/launch-day.htm', directory: env.project });
    assert.equal(relative.title, 'Launch day');
    assert.equal((await env.core.store.get(relative.slug)).state.projectDirectory, env.project);

    await writeFile(path.join(env.project, 'other.html'), '<h1>Other</h1>');
    const absolute = await env.importer.open({ path: path.join(env.project, 'other.html'), directory: null });
    assert.equal((await env.core.store.get(absolute.slug)).state.projectDirectory, null);
  });

  test('what is left out is counted, never read out of the folder, and never planted in the design', async (t) => {
    const env = await setup(t);
    await writeFile(path.join(env.outside, 'secret.png'), PNG);
    await writeFile(path.join(env.outside, 'secret2.png'), PNG);
    if (!(await linkOrSkip(t, path.join(env.outside, 'secret2.png'), path.join(env.project, 'assets', 'evil.png')))) return;
    await writeFile(path.join(env.project, '.env'), 'TOKEN=do-not-copy');
    await writeFile(path.join(env.project, 'data.bin'), 'bin');
    await writeFile(path.join(env.project, 'index.html'), '<p>the project index</p>');
    await mkdir(path.join(env.project, '.chamber'), { recursive: true });
    await writeFile(path.join(env.project, '.chamber', 'state.json'), '{"version":1,"evil":true}');
    await writeFile(path.join(env.project, 'design.json'), '{"evil":true}');
    await mkdir(path.join(env.project, 'system'), { recursive: true });
    await writeFile(path.join(env.project, 'system', 'COPY.json'), '{"evil":true}');
    await writeFile(path.join(env.project, 'ok.png'), PNG);
    const entry = Buffer.from(
      [
        '<title>Left out</title>',
        '<img src="../outside/secret.png">', // outside: the classifier refuses it
        '<img src="assets/evil.png">', // outside: a link out of the folder
        '<img src="gone.png">', // missing
        '<link rel="icon" href=".env">', // other: not a copied type
        '<img src="data.bin">', // other
        '<iframe src="index.html"></iframe>', // other: the page's own entry name
        '<link rel="preload" href=".chamber/state.json">', // other: service state
        '<link rel="preload" href="design.json">', // other
        '<link rel="preload" href="system/COPY.json">', // other
        '<img src="ok.png">',
      ].join(''),
    );
    await writeFile(path.join(env.project, 'page.html'), entry);

    const answer = await env.importer.open({ path: path.join(env.project, 'page.html'), directory: env.project });
    assert.deepEqual(answer.left, { outside: 2, missing: 1, other: 6 });
    const design = path.join(env.core.root, answer.slug);
    const copied = await filesUnder(design);
    assert.deepEqual(
      copied.filter((rel) => !rel.startsWith('.chamber/') && rel !== 'design.json'),
      ['index.html', 'ok.png'],
    );
    assert.deepEqual(await readFile(path.join(design, 'index.html')), entry, 'the project index.html did not replace the entry');
    const state = await readState(design);
    assert.equal(state.evil, undefined, "the project's .chamber/state.json was not copied over the service's");
    assert.ok(state.importedFrom !== undefined);
    const designJson = JSON.parse(await readFile(path.join(design, 'design.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(designJson.evil, undefined);
    for (const rel of copied) assert.ok(!(await readFile(path.join(design, ...rel.split('/')), 'utf8')).includes('do-not-copy'), rel);
  });

  test('the same file unchanged opens the copy already made; changed bytes make a new copy; the newest copy is found', async (t) => {
    const env = await setup(t);
    const file = path.join(env.project, 'page.html');
    await writeFile(file, '<title>Pricing</title><p>one</p>');
    const first = await env.importer.open({ path: file, directory: env.project });
    assert.equal(first.reused, false);

    const again = await env.importer.open({ path: file, directory: env.project });
    assert.deepEqual(again, { slug: first.slug, title: 'Pricing', reused: true, left: { outside: 0, missing: 0, other: 0 } });
    assert.deepEqual(await designSlugs(env.core.root), [first.slug]);

    await writeFile(file, '<title>Pricing</title><p>two</p>');
    const changed = await env.importer.open({ path: file, directory: env.project });
    assert.equal(changed.reused, false);
    assert.notEqual(changed.slug, first.slug);
    assert.equal((await env.importer.open({ path: file, directory: env.project })).slug, changed.slug);
    assert.equal((await designSlugs(env.core.root)).length, 2);

    // The same bytes under another name are another file.
    await writeFile(path.join(env.project, 'copy.html'), '<title>Pricing</title><p>two</p>');
    assert.equal((await env.importer.open({ path: path.join(env.project, 'copy.html'), directory: env.project })).reused, false);
  });

  test('after a restart the copy is found through the design index', async (t) => {
    const env = await setup(t);
    const file = path.join(env.project, 'page.html');
    await writeFile(file, '<title>Pricing</title>');
    const first = await env.importer.open({ path: file, directory: env.project });
    await env.refreshIndex();
    const restarted = env.restart();
    const again = await restarted.open({ path: file, directory: null });
    assert.equal(again.reused, true);
    assert.equal(again.slug, first.slug);
  });

  test('a file of an existing design opens that design; a loose file in the root and any other file under it are refused', async (t) => {
    const env = await setup(t);
    const record = await env.core.store.create({ kind: 'page', title: 'Checkout', brief: '', html: '<p>checkout</p>' });

    const inDesign = await env.importer.open({ path: path.join(record.path, 'index.html'), directory: null });
    assert.deepEqual(inDesign, { slug: record.slug, title: 'Checkout', reused: true, left: { outside: 0, missing: 0, other: 0 } });

    await writeFile(path.join(env.core.root, 'stray.html'), '<p>stray</p>');
    await assert.rejects(env.importer.open({ path: path.join(env.core.root, 'stray.html'), directory: null }), isApiError('invalid', FILE_PAGE_IN_ROOT));

    await mkdir(path.join(env.core.root, 'my-stuff'), { recursive: true });
    await writeFile(path.join(env.core.root, 'my-stuff', 'page.html'), '<p>mine</p>');
    await assert.rejects(env.importer.open({ path: path.join(env.core.root, 'my-stuff', 'page.html'), directory: null }), isApiError('invalid', FILE_PAGE_IN_ROOT_OTHER));
    await mkdir(path.join(env.core.root, '.trash', 'old-1'), { recursive: true });
    await writeFile(path.join(env.core.root, '.trash', 'old-1', 'index.html'), '<p>old</p>');
    await assert.rejects(env.importer.open({ path: path.join(env.core.root, '.trash', 'old-1', 'index.html'), directory: null }), isApiError('invalid', FILE_PAGE_IN_ROOT_OTHER));

    // A project link to a design file is the design's file too (realpath), and is opened, not copied.
    if (await linkOrSkip(t, path.join(record.path, 'index.html'), path.join(env.project, 'linked.html'))) {
      assert.equal((await env.importer.open({ path: path.join(env.project, 'linked.html'), directory: env.project })).slug, record.slug);
    }
    assert.deepEqual(await designSlugs(env.core.root), [record.slug, 'my-stuff'].sort(), 'nothing was copied');
  });

  test('a link, a folder, a missing file and a network path are refused and nothing is made', async (t) => {
    const env = await setup(t);
    await writeFile(path.join(env.outside, 'x.html'), '<p>x</p>');
    await mkdir(path.join(env.project, 'folder.html'), { recursive: true });
    await assert.rejects(env.importer.open({ path: path.join(env.project, 'folder.html'), directory: null }), isApiError('invalid', FILE_PAGE_NOT_FILE));
    await assert.rejects(env.importer.open({ path: path.join(env.project, 'nope.html'), directory: null }), isApiError('not-found', FILE_PAGE_MISSING));
    await assert.rejects(env.importer.open({ path: '\\\\server\\share\\a.html', directory: null }), isApiError('invalid', FILE_PAGE_NETWORK));
    await assert.rejects(env.importer.open({ path: '../outside/x.html', directory: env.project }), isApiError('invalid', FILE_PAGE_OUTSIDE));
    await assert.rejects(env.importer.open({ path: path.join(env.project, 'a.txt'), directory: null }), isApiError('invalid', FILE_PAGE_NOT_HTML));
    if (await linkOrSkip(t, path.join(env.outside, 'x.html'), path.join(env.project, 'alias.html'))) {
      await assert.rejects(env.importer.open({ path: path.join(env.project, 'alias.html'), directory: null }), isApiError('invalid', FILE_PAGE_LINK));
    }
    assert.deepEqual(await designSlugs(env.core.root), []);
    assert.deepEqual(await trashEntries(env.core.root), []);
  });

  test(`an entry over ${LOOSE_IMPORT_MAX_BYTES / (1024 * 1024)} MB is 413 and nothing is made`, async (t) => {
    const env = await setup(t);
    await sparse(path.join(env.project, 'huge.html'), LOOSE_IMPORT_MAX_BYTES + 1);
    await assert.rejects(env.importer.open({ path: path.join(env.project, 'huge.html'), directory: null }), isApiError('too-large', FILE_PAGE_ENTRY_TOO_LARGE));
    assert.deepEqual(await designSlugs(env.core.root), []);
  });

  test(`local files over ${FILE_PAGE_COPY_MAX_BYTES / (1024 * 1024)} MB are 413 with no folder left, an image or a sheet`, async (t) => {
    const env = await setup(t);
    await sparse(path.join(env.project, 'big.png'), FILE_PAGE_COPY_MAX_BYTES + 1);
    await sparse(path.join(env.project, 'big.css'), FILE_PAGE_COPY_MAX_BYTES + 1);
    await sparse(path.join(env.project, 'a.png'), 30 * 1024 * 1024);
    await sparse(path.join(env.project, 'b.png'), 30 * 1024 * 1024);
    for (const [name, html] of [
      ['image.html', '<img src="big.png">'],
      ['sheet.html', '<link rel="stylesheet" href="big.css">'],
      ['sum.html', '<img src="a.png"><img src="b.png">'],
    ] as const) {
      await writeFile(path.join(env.project, name), html);
      await assert.rejects(env.importer.open({ path: path.join(env.project, name), directory: null }), isApiError('too-large', FILE_PAGE_COPY_TOO_LARGE), name);
    }
    assert.deepEqual(await designSlugs(env.core.root), []);
    assert.deepEqual(await trashEntries(env.core.root), [], 'refused before anything was made');
  });

  test('over the time budget during the scan: 413 and nothing is made', async (t) => {
    let calls = 0;
    const env = await setup(t, { clock: () => (calls++ === 0 ? 0 : 13_000) });
    await writeFile(path.join(env.project, 'page.html'), '<img src="a.png">');
    await assert.rejects(env.importer.open({ path: path.join(env.project, 'page.html'), directory: null }), isApiError('too-large', FILE_PAGE_TOO_SLOW));
    assert.deepEqual(await designSlugs(env.core.root), []);
    assert.deepEqual(await trashEntries(env.core.root), []);
  });

  test('over the time budget during the copy: 413, and the half-made page goes to .trash', async (t) => {
    let late = false;
    const env = await setup(t, {
      clock: () => (late ? 20_000 : 0),
      store: (base) => ({
        dir: base.dir,
        get: base.get,
        trash: base.trash,
        create: async (input) => {
          const record = await base.create(input);
          late = true; // the copy starts after the budget has run out
          return record;
        },
      }),
    });
    await writeFile(path.join(env.project, 'a.png'), PNG);
    await writeFile(path.join(env.project, 'page.html'), '<img src="a.png">');
    await assert.rejects(env.importer.open({ path: path.join(env.project, 'page.html'), directory: null }), isApiError('too-large', FILE_PAGE_TOO_SLOW));
    assert.deepEqual(await designSlugs(env.core.root), [], 'no half-made design is left in the list');
    assert.equal((await trashEntries(env.core.root)).length, 1);
    assert.deepEqual(await readFile(path.join(env.project, 'a.png')), PNG, 'the project was only read');
  });

  test('a write that fails moves the half-made page to .trash and says so', async (t) => {
    const env = await setup(t, {
      store: (base) => ({
        dir: base.dir,
        get: base.get,
        trash: base.trash,
        create: async (input) => {
          const record = await base.create(input);
          await writeFile(path.join(record.path, 'assets'), 'a file where the copy needs a folder');
          return record;
        },
      }),
    });
    await mkdir(path.join(env.project, 'assets'), { recursive: true });
    await writeFile(path.join(env.project, 'assets', 'a.png'), PNG);
    await writeFile(path.join(env.project, 'page.html'), '<img src="assets/a.png">');
    await assert.rejects(env.importer.open({ path: path.join(env.project, 'page.html'), directory: null }), isApiError('internal', FILE_PAGE_COPY_FAILED));
    assert.deepEqual(await designSlugs(env.core.root), []);
    assert.equal((await trashEntries(env.core.root)).length, 1);
    assert.ok(env.core.logs.some((line) => line.event === 'file-page.copy-failed'));
  });

  test('a second click while the first is copying is 409; exactly one page is made', async (t) => {
    const env = await setup(t);
    await writeFile(path.join(env.project, 'page.html'), '<title>Once</title>');
    const body = { path: path.join(env.project, 'page.html'), directory: env.project };
    const [a, b] = await Promise.allSettled([env.importer.open(body), env.importer.open(body)]);
    assert.equal(a.status, 'fulfilled');
    assert.equal(b.status, 'rejected');
    if (b.status === 'rejected') isApiError('conflict', FILE_PAGE_BUSY)(b.reason);
    assert.deepEqual(await designSlugs(env.core.root), ['once']);
    // The lock is released: the next click opens the copy.
    assert.equal((await env.importer.open(body)).reused, true);
  });
});
