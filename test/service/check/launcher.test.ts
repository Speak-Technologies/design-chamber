import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { LAUNCHER_MARKER, buildLaunchers, createLauncherService, isOurLauncher, quoteCmd, quoteSh, syncLaunchers, type LauncherService } from '../../../src/service/check/launcher.ts';
import { createLogger } from '../../../src/service/context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const quiet = createLogger(() => undefined);
const logs: string[] = [];
const recording = createLogger((line) => logs.push(line));

test('sh quoting keeps spaces, ampersands, carets, percents and quotes literal', () => {
  assert.equal(quoteSh('/home/me/My Designs'), "'/home/me/My Designs'");
  assert.equal(quoteSh("/home/o'brien/a&b^c%d"), "'/home/o'\\''brien/a&b^c%d'");
  assert.equal(quoteSh('/a\nb'), null);
  assert.equal(quoteSh('/a\u0000b'), null);
});

test('cmd quoting doubles percents and refuses double quotes and control characters', () => {
  assert.equal(quoteCmd('C:\\Users\\Sam O\'Neil\\100%\\x'), '"C:\\Users\\Sam O\'Neil\\100%%\\x"');
  assert.equal(quoteCmd('C:\\a&b^c'), '"C:\\a&b^c"');
  assert.equal(quoteCmd('C:\\a"b'), null);
  assert.equal(quoteCmd('C:\\a\r\nb'), null);
});

test('launcher text matches the spec and carries the marker on line 2', () => {
  const { sh, cmd } = buildLaunchers({ execPath: '/opt/OpenChamber/openchamber', cliPath: '/ext/dist/cli/dc.mjs', root: '/home/u/Designs' });
  assert.equal(
    sh,
    `#!/bin/sh\n# ${LAUNCHER_MARKER}. Written by Design Chamber; rewritten when the extension starts.\nELECTRON_RUN_AS_NODE=1 exec '/opt/OpenChamber/openchamber' '/ext/dist/cli/dc.mjs' --root '/home/u/Designs' "$@"\n`,
  );
  assert.equal(
    buildLaunchers({ execPath: 'C:\\OC\\OpenChamber.exe', cliPath: 'C:\\ext\\dc.mjs', root: 'C:\\Designs' }).cmd,
    `@echo off\r\nrem ${LAUNCHER_MARKER}. Written by Design Chamber; rewritten when the extension starts.\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"C:\\OC\\OpenChamber.exe" "C:\\ext\\dc.mjs" --root "C:\\Designs" %*\r\n`,
  );
  assert.ok(sh && isOurLauncher(sh));
  assert.ok(cmd && isOurLauncher(cmd));
  assert.equal(isOurLauncher('#!/bin/sh\necho mine\n'), false);
  assert.equal(isOurLauncher(`${LAUNCHER_MARKER}\nsecond`), false, 'the marker counts on line 2 only');
});

test('a value that cannot be quoted gives no launcher for that shell', () => {
  const quoteTrouble = buildLaunchers({ execPath: '/bin/x', cliPath: '/x', root: '/home/u/say "hi"' });
  assert.ok(quoteTrouble.sh, 'sh can carry a double quote');
  assert.equal(quoteTrouble.cmd, null);
  const newline = buildLaunchers({ execPath: '/bin/x', cliPath: '/x', root: '/home/u/a\nb' });
  assert.equal(newline.sh, null);
  assert.equal(newline.cmd, null);
});

test('syncLaunchers writes both scripts, executable, and rewrites only when the bytes differ', async (t) => {
  const tmp = await useTmpRoot(t);
  const cli = await tmp.write('ext/dc.mjs', 'x');
  const root = path.join(tmp.root, 'Designs');
  await mkdir(root);
  const input = { execPath: process.execPath, cliPath: cli, root, log: quiet, platform: 'linux' as const };
  assert.equal(await syncLaunchers(input), 'written');
  const file = path.join(root, '.chamber', 'bin', 'dc');
  // Windows has no execute bit; the sh launcher is only run on POSIX systems.
  if (process.platform !== 'win32') assert.ok(((await stat(file)).mode & 0o111) !== 0, 'executable');
  assert.ok((await readFile(path.join(root, '.chamber', 'bin', 'dc.cmd'), 'utf8')).includes('\r\n'));
  const before = (await stat(file)).mtimeMs;
  assert.equal(await syncLaunchers(input), 'current');
  assert.equal((await stat(file)).mtimeMs, before, 'unchanged bytes are not rewritten');
  assert.equal(await syncLaunchers({ ...input, cliPath: cli, execPath: '/somewhere/else' }), 'written', 'a moved runtime rewrites');
});

test('a file without our marker is the user\'s and stays untouched', async (t) => {
  const tmp = await useTmpRoot(t);
  const cli = await tmp.write('ext/dc.mjs', 'x');
  const root = path.join(tmp.root, 'Designs');
  await tmp.write('Designs/.chamber/bin/dc', '#!/bin/sh\necho mine\n');
  const status = await syncLaunchers({ execPath: '/bin/x', cliPath: cli, root, log: quiet, platform: 'linux' });
  assert.equal(status, 'foreign');
  assert.equal(await tmp.read('Designs/.chamber/bin/dc'), '#!/bin/sh\necho mine\n');
  const service = createLauncherService({ log: quiet, execPath: '/bin/x', cliPath: cli, platform: 'linux' });
  assert.equal(await service.commandFor(root, 'a'), null, 'no command is promised for a launcher we do not own');
});

test('a symlinked .chamber/bin is refused and nothing is written through it', async (t) => {
  const tmp = await useTmpRoot(t);
  const cli = await tmp.write('ext/dc.mjs', 'x');
  const root = path.join(tmp.root, 'Designs');
  await mkdir(path.join(root, '.chamber'), { recursive: true });
  await mkdir(path.join(tmp.root, 'elsewhere'));
  await symlink(path.join(tmp.root, 'elsewhere'), path.join(root, '.chamber', 'bin'), 'dir');
  assert.equal(await syncLaunchers({ execPath: '/bin/x', cliPath: cli, root, log: recording, platform: 'linux' }), 'failed');
  await assert.rejects(stat(path.join(tmp.root, 'elsewhere', 'dc')));
});

test('a missing CLI bundle gives no launcher (dev checkout that was not built)', async (t) => {
  const tmp = await useTmpRoot(t);
  const root = path.join(tmp.root, 'Designs');
  await mkdir(root);
  assert.equal(await syncLaunchers({ execPath: '/bin/x', cliPath: path.join(tmp.root, 'nope.mjs'), root, log: quiet, platform: 'linux' }), 'unavailable');
  await assert.rejects(stat(path.join(root, '.chamber')));
});

test('the sh launcher really runs the CLI with the baked-in root, even with a space and a quote in the paths', { skip: process.platform === 'win32' }, async (t) => {
  const tmp = await useTmpRoot(t);
  const cli = await tmp.write("ext dir/o'brien.mjs", 'console.log(JSON.stringify({ args: process.argv.slice(2), electron: process.env.ELECTRON_RUN_AS_NODE ?? null }));');
  const root = path.join(tmp.root, "My 'Designs' & more");
  await mkdir(root);
  assert.equal(await syncLaunchers({ execPath: process.execPath, cliPath: cli, root, log: quiet, platform: 'linux' }), 'written');
  const out = execFileSync('sh', [path.join(root, '.chamber', 'bin', 'dc'), 'check', 'signup-flow', '--static'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { args: ['--root', root, 'check', 'signup-flow', '--static'], electron: '1' });
});

/** A launcher service whose syncs are counted; the CLI path does not exist, so nothing is written. */
const countingService = (platform: NodeJS.Platform): { service: LauncherService; syncs: () => number } => {
  let count = 0;
  const log = createLogger((line) => {
    if (line.includes('check.launcher-cli-missing')) count += 1;
  });
  return { service: createLauncherService({ log, execPath: '/bin/x', cliPath: path.join(path.sep, 'no-such-dir', 'dc.mjs'), platform }), syncs: () => count };
};

test('on macOS the launcher cache folds case: a re-cased root is the same root', async () => {
  const { service, syncs } = countingService('darwin');
  const first = service.ensure('/X/Designs');
  assert.equal(service.ensure('/x/designs'), first, 'the same memoised sync');
  assert.equal(await first, 'unavailable');
  assert.equal(syncs(), 1);
  service.forget('/x/designs');
  await service.ensure('/X/Designs');
  assert.equal(syncs(), 2, 'forget with other letter case dropped the entry, so the next ensure syncs again');
});

test('on Linux the launcher cache keeps case: two roots that differ only by case sync separately', async () => {
  const { service, syncs } = countingService('linux');
  const first = service.ensure('/X/Designs');
  const second = service.ensure('/x/designs');
  assert.notEqual(second, first);
  await Promise.all([first, second]);
  assert.equal(syncs(), 2);
  service.forget('/x/designs');
  assert.equal(service.ensure('/X/Designs'), first, 'forgetting the other case leaves this root memoised');
  assert.equal(syncs(), 2);
});

test('the service answers the exact command once the launcher is in place', async (t) => {
  const tmp = await useTmpRoot(t);
  const cli = await tmp.write('ext/dc.mjs', 'x');
  const root = path.join(tmp.root, 'Designs');
  await mkdir(root);
  const service = createLauncherService({ log: quiet, execPath: '/bin/x', cliPath: cli, platform: 'linux' });
  assert.equal(await service.commandFor(root, 'signup-flow'), `sh '${root}/.chamber/bin/dc' check signup-flow`);
  await writeFile(path.join(root, '.chamber', 'bin', 'dc'), '#!/bin/sh\n# design-chamber:launcher v1. old\nexit 1\n');
  assert.equal(await service.commandFor(root, 'a'), `sh '${root}/.chamber/bin/dc' check a`, 'memoised per root until forgotten');
  service.forget(root);
  assert.ok((await readFile(path.join(root, '.chamber', 'bin', 'dc'), 'utf8')).includes('exit 1'));
  await service.ensure(root);
  assert.ok((await readFile(path.join(root, '.chamber', 'bin', 'dc'), 'utf8')).includes('ELECTRON_RUN_AS_NODE'));
});
