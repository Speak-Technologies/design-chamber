import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { resolveTarget, type TargetDeps } from '../../../src/service/check/target.ts';
import { isDesignFolder } from '../../../src/service/root.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

/** A fake filesystem for one path flavour: `links` maps a path to what realpath answers for it. */
const fake = (flavour: typeof path.win32 | typeof path.posix, platform: NodeJS.Platform, existing: string[], designs: string[], links: Record<string, string> = {}): TargetDeps => {
  const key = (p: string): string => (platform === 'win32' ? p.toLowerCase() : p);
  const known = new Set(existing.map(key));
  return {
    path: flavour,
    platform,
    realpath: async (target) => {
      const resolved = flavour.resolve(target);
      const linked = links[resolved];
      if (linked !== undefined) return linked;
      if (!known.has(key(resolved))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return resolved;
    },
    isDesignFolder: async (dir) => designs.map(key).includes(key(dir)),
  };
};

const WIN_ROOT = 'C:\\Users\\Sam\\Documents\\designs';
const winDeps = (links: Record<string, string> = {}): TargetDeps =>
  fake(path.win32, 'win32', [WIN_ROOT, `${WIN_ROOT}\\demo`, `${WIN_ROOT}\\demo\\screens`, `${WIN_ROOT}\\notes`, 'C:\\other\\demo', '\\\\server\\x\\demo'], [`${WIN_ROOT}\\demo`, 'C:\\other\\demo', '\\\\server\\x\\demo'], links);

const win = (arg: string, links?: Record<string, string>) => resolveTarget({ arg, root: WIN_ROOT, cwd: 'C:\\work' }, winDeps(links));

test('win32: a name, a full path and a re-cased path all find the design', async () => {
  const byName = await win('demo');
  assert.ok(byName.ok);
  assert.equal(byName.slug, 'demo');
  assert.equal(byName.dir, `${WIN_ROOT}\\demo`);
  assert.ok((await win(`${WIN_ROOT}\\demo`)).ok);
  assert.ok((await win(`${WIN_ROOT}\\demo\\`)).ok);
  assert.ok((await win('c:\\users\\sam\\documents\\DESIGNS\\demo')).ok, 'Windows folds case');
  assert.ok((await resolveTarget({ arg: 'designs\\demo', root: WIN_ROOT, cwd: 'C:\\Users\\Sam\\Documents' }, winDeps())).ok, 'a path relative to the working folder');
});

test('win32: everything else is refused with the same sentence', async () => {
  const refused = `That is not a design in ${WIN_ROOT}.`;
  const cases: [string, string][] = [
    ['the root itself', WIN_ROOT],
    ['a nested folder', `${WIN_ROOT}\\demo\\screens`],
    ['a parent step out', `${WIN_ROOT}\\demo\\..\\..`],
    ['a step to a sibling folder', `${WIN_ROOT}\\..\\other\\demo`],
    ['another drive', 'D:\\demo'],
    ['a drive path outside', 'C:\\other\\demo'],
    ['a UNC path', '\\\\server\\x\\demo'],
    ['a folder that is not a design', `${WIN_ROOT}\\notes`],
    ['a missing design', 'ghost'],
    ['a name with a step', '..\\demo'],
    ['empty', ''],
  ];
  for (const [label, arg] of cases) {
    const result = await win(arg);
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.equal(result.message, refused, label);
  }
});

test('win32: a junction that points out of the root is refused', async () => {
  const result = await win('demo', { [`${WIN_ROOT}\\demo`]: 'C:\\other\\demo' });
  assert.equal(result.ok, false);
});

test('win32: a missing root says so', async () => {
  const result = await resolveTarget({ arg: 'demo', root: 'C:\\nope', cwd: 'C:\\work' }, fake(path.win32, 'win32', [], []));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.message, 'The designs folder C:\\nope does not exist.');
});

const POSIX_ROOT = '/home/u/Documents/Designs';
const posixDeps = (links: Record<string, string> = {}): TargetDeps =>
  fake(path.posix, 'linux', [POSIX_ROOT, `${POSIX_ROOT}/demo`, `${POSIX_ROOT}/Demo`, `${POSIX_ROOT}/demo/screens`, '/elsewhere/demo'], [`${POSIX_ROOT}/demo`, '/elsewhere/demo'], links);
const posix = (arg: string, links?: Record<string, string>) => resolveTarget({ arg, root: POSIX_ROOT, cwd: '/tmp' }, posixDeps(links));

test('posix: a name and a path; case matters; links and parents are refused', async () => {
  assert.ok((await posix('demo')).ok);
  assert.ok((await posix(`${POSIX_ROOT}/demo`)).ok);
  assert.equal((await posix(`${POSIX_ROOT}/Demo`)).ok, false, 'a name that is not a design folder name');
  assert.equal((await posix('/elsewhere/demo')).ok, false);
  assert.equal((await posix(`${POSIX_ROOT}/demo/..`)).ok, false);
  assert.equal((await posix(`${POSIX_ROOT}/demo/screens`)).ok, false);
  assert.equal((await posix('../../elsewhere/demo')).ok, false);
  assert.equal((await posix('demo', { [`${POSIX_ROOT}/demo`]: '/elsewhere/demo' })).ok, false, 'a link to another folder');
});

test('on disk: a name, a path from inside the design, a symlink out, a plain folder, a file', async (t) => {
  const tmp = await useTmpRoot(t);
  const deps: TargetDeps = { path, platform: process.platform, realpath, isDesignFolder };
  const root = tmp.at('root');
  await tmp.write('root/demo/design.json', { version: 1 });
  await tmp.write('root/demo/screens/a.html', '<p>x</p>');
  await mkdir(tmp.at('root/plain'));
  await tmp.write('outside/design.json', '{}');
  await symlink(tmp.at('outside'), tmp.at('root/linked'), 'dir');
  const run = (arg: string, cwd = root) => resolveTarget({ arg, root, cwd }, deps);
  const found = await run('demo');
  assert.ok(found.ok && found.dir === tmp.at('root/demo'));
  assert.ok((await run(tmp.at('root/demo'))).ok);
  assert.ok((await run('.', tmp.at('root/demo'))).ok, 'the working folder itself');
  assert.equal((await run('plain')).ok, false);
  assert.equal((await run('linked')).ok, false, 'a link to a folder outside the root');
  assert.equal((await run(tmp.at('outside'))).ok, false);
  assert.equal((await run('demo/screens')).ok, false);
  assert.equal((await run('demo/design.json')).ok, false);
  assert.equal((await run(root)).ok, false);
  assert.equal((await run('nothing')).ok, false);
});
