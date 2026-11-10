// The `design_check` OpenCode tool (documentation/specs/phase-1-5-sdk-2-7.md §U3.3, §U3.4, §6).
// The plugin runs inside OpenCode with the user's full access, so every piece that decides what
// runs is pure and tested here: the tool input (bare folder names only), the install root that
// runs this OpenCode, the runtime record (only the OpenChamber binary inside that install), the
// child's environment (an allowlist), the arguments and the answer.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildChildArgs,
  childEnv,
  createDesignCheckTool,
  installRootOf,
  LAUNCHER_SENTENCE,
  parseToolInput,
  runDesignCheck,
  SETUP_SENTENCE,
  toolResult,
  validateRuntime,
  type SpawnedChild,
  type ToolDeps,
} from '../../src/plugin/check-tool.ts';
import { CHECK_TOOL_ERROR_TEXT_MAX, CHECK_TOOL_SCREENS_MAX, RUNTIME_PATH_MAX } from '../../src/shared/limits.ts';
import { useTmpRoot } from '../helpers/tmp-root.ts';

const posix = path.posix;
const win32 = path.win32;

// ---- parseToolInput ----

describe('parseToolInput', () => {
  test('refuses anything that is not a bare design folder name', () => {
    const bad: unknown[] = ['../x', '/abs/path', 'C:\\x', 'a/b', 'a\\b', '', ' pricing', 'Pricing', `a${'b'.repeat(63)}`, '..', '.', 'pricing\n', 42, null, undefined];
    for (const design of bad) {
      const parsed = parseToolInput({ design });
      assert.equal(parsed.ok, false, `accepted design ${JSON.stringify(design)}`);
    }
    assert.equal(parseToolInput(null).ok, false);
    assert.equal(parseToolInput('pricing').ok, false);
    assert.equal(parseToolInput([]).ok, false);
  });

  test('a refused design answers the folder-name sentence and names no path', () => {
    const parsed = parseToolInput({ design: '../../etc' });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.message, 'That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.');
  });

  test('refuses screen ids with a slash, too many screens and a static that is not a yes or no', () => {
    assert.equal(parseToolInput({ design: 'pricing', screens: ['home/../x'] }).ok, false);
    assert.equal(parseToolInput({ design: 'pricing', screens: 'a,b/c' }).ok, false);
    assert.equal(parseToolInput({ design: 'pricing', screens: [1] }).ok, false);
    assert.equal(parseToolInput({ design: 'pricing', screens: {} }).ok, false);
    const many = Array.from({ length: CHECK_TOOL_SCREENS_MAX + 1 }, (_, index) => `s${index}`);
    assert.equal(parseToolInput({ design: 'pricing', screens: many }).ok, false);
    assert.equal(parseToolInput({ design: 'pricing', static: 'yes' }).ok, false);
    assert.equal(parseToolInput({ design: 'pricing', static: 1 }).ok, false);
  });

  test('accepts pricing-page, screens as a comma-separated string, and static as text', () => {
    assert.deepEqual(parseToolInput({ design: 'pricing-page' }), { ok: true, design: 'pricing-page', screens: [], static: false });
    assert.deepEqual(parseToolInput({ design: 'pricing', screens: 'a,b' }), { ok: true, design: 'pricing', screens: ['a', 'b'], static: false });
    assert.deepEqual(parseToolInput({ design: 'pricing', screens: ' a , b ,' }), { ok: true, design: 'pricing', screens: ['a', 'b'], static: false });
    assert.deepEqual(parseToolInput({ design: 'pricing', static: 'true' }), { ok: true, design: 'pricing', screens: [], static: true });
    assert.deepEqual(parseToolInput({ design: 'pricing', static: 'false' }), { ok: true, design: 'pricing', screens: [], static: false });
    assert.deepEqual(parseToolInput({ design: 'pricing', static: true, extra: 'ignored' }), { ok: true, design: 'pricing', screens: [], static: true });
  });

  test('screens: an array, a stringified array, de-duplicated; an empty list means every screen', () => {
    assert.deepEqual(parseToolInput({ design: 'p', screens: ['home', 'home', 'pricing'] }), { ok: true, design: 'p', screens: ['home', 'pricing'], static: false });
    assert.deepEqual(parseToolInput({ design: 'p', screens: '["home","pricing"]' }), { ok: true, design: 'p', screens: ['home', 'pricing'], static: false });
    assert.deepEqual(parseToolInput({ design: 'p', screens: [] }), { ok: true, design: 'p', screens: [], static: false });
    assert.deepEqual(parseToolInput({ design: 'p', screens: '' }), { ok: true, design: 'p', screens: [], static: false });
    assert.deepEqual(parseToolInput({ design: 'p', screens: null }), { ok: true, design: 'p', screens: [], static: false });
  });
});

// ---- installRootOf ----

describe('installRootOf', () => {
  test('Linux: /opt/OpenChamber/resources/opencode-cli/opencode → /opt/OpenChamber', () => {
    assert.equal(installRootOf('/opt/OpenChamber/resources/opencode-cli/opencode', posix, 'linux'), '/opt/OpenChamber');
  });

  test('macOS: the app bundle Contents folder (Resources folded)', () => {
    assert.equal(
      installRootOf('/Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode', posix, 'darwin'),
      '/Applications/OpenChamber.app/Contents',
    );
  });

  test('Windows: the install folder, with any letter case', () => {
    const exe = 'C:\\Users\\you\\AppData\\Local\\Programs\\OpenChamber\\resources\\opencode-cli\\opencode.exe';
    assert.equal(installRootOf(exe, win32, 'win32'), 'C:\\Users\\you\\AppData\\Local\\Programs\\OpenChamber');
    assert.equal(installRootOf('C:\\Program Files\\OpenChamber\\Resources\\OpenCode-CLI\\opencode.exe', win32, 'win32'), 'C:\\Program Files\\OpenChamber');
  });

  test('the last resources/opencode-cli pair wins', () => {
    assert.equal(installRootOf('/a/resources/opencode-cli/b/resources/opencode-cli/opencode', posix, 'linux'), '/a/resources/opencode-cli/b');
  });

  test('null for an OpenCode installed elsewhere, a relative path, or a pattern at the filesystem root', () => {
    assert.equal(installRootOf('/usr/local/bin/opencode', posix, 'linux'), null);
    assert.equal(installRootOf('/home/you/.opencode/bin/opencode', posix, 'linux'), null);
    assert.equal(installRootOf('resources/opencode-cli/opencode', posix, 'linux'), null);
    assert.equal(installRootOf('/resources/opencode-cli/opencode', posix, 'linux'), null, 'an install root of / would contain every file');
    assert.equal(installRootOf('C:\\resources\\opencode-cli\\opencode.exe', win32, 'win32'), null);
    assert.equal(installRootOf('/opt/OpenChamber/resources/opencode-cli', posix, 'linux'), null, 'opencode-cli must be a folder, not the file');
    // Linux does not fold case: a different folder.
    assert.equal(installRootOf('/opt/OpenChamber/Resources/opencode-cli/opencode', posix, 'linux'), null);
  });
});

// ---- validateRuntime ----

const LINUX_ROOT = '/opt/OpenChamber';
const record = (execPath: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  execPath,
  electron: true,
  version: '0.2.0',
  updated: '2026-11-10T00:00:00.000Z',
  ...over,
});

/** The realpath step done by `execute`, faked: every path is its own realpath unless mapped. */
const linuxCheck = (execPath: unknown, options: { real?: string | null; isFile?: boolean } = {}) => ({
  record: record(execPath),
  realExecPath: options.real === undefined ? (typeof execPath === 'string' ? execPath : null) : options.real,
  realInstallRoot: LINUX_ROOT,
  isFile: options.isFile ?? true,
});

describe('validateRuntime', () => {
  test('refuses a valid-looking /tmp/x/node', () => {
    assert.deepEqual(validateRuntime(linuxCheck('/tmp/x/node'), posix, 'linux'), { ok: false });
  });

  test('refuses /tmp/x/openchamber: the right name outside the install', () => {
    assert.deepEqual(validateRuntime(linuxCheck('/tmp/x/openchamber'), posix, 'linux'), { ok: false });
  });

  test('refuses /usr/bin/node, /tmp/evil.sh and a basename openchamber-helper inside the install', () => {
    assert.deepEqual(validateRuntime(linuxCheck('/usr/bin/node'), posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime(linuxCheck('/tmp/evil.sh'), posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime(linuxCheck('/opt/OpenChamber/openchamber-helper'), posix, 'linux'), { ok: false });
  });

  test('refuses a relative path, a missing file and a directory', () => {
    assert.deepEqual(validateRuntime(linuxCheck('openchamber', { real: '/opt/OpenChamber/openchamber' }), posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime(linuxCheck('/opt/OpenChamber/openchamber', { real: null }), posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime(linuxCheck('/opt/OpenChamber/openchamber', { isFile: false }), posix, 'linux'), { ok: false });
  });

  test('refuses a symlink inside the install whose realpath leaves it', () => {
    assert.deepEqual(validateRuntime(linuxCheck('/opt/OpenChamber/openchamber', { real: '/tmp/x/openchamber' }), posix, 'linux'), { ok: false });
  });

  test('refuses the install root itself and a missing install root', () => {
    assert.deepEqual(validateRuntime(linuxCheck('/opt/OpenChamber', { real: '/opt/OpenChamber' }), posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime({ ...linuxCheck('/opt/OpenChamber/openchamber'), realInstallRoot: null }, posix, 'linux'), { ok: false });
  });

  test('refuses a record of another shape: wrong v, a non-string, a control character, an overlong path', () => {
    const base = linuxCheck('/opt/OpenChamber/openchamber');
    assert.deepEqual(validateRuntime({ ...base, record: record('/opt/OpenChamber/openchamber', { v: 2 }) }, posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime({ ...base, record: null }, posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime({ ...base, record: [] }, posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime({ ...base, record: record(42) }, posix, 'linux'), { ok: false });
    assert.deepEqual(validateRuntime({ ...base, record: record('/opt/OpenChamber/open\nchamber') }, posix, 'linux'), { ok: false });
    const long = `/opt/OpenChamber/${'a/'.repeat(RUNTIME_PATH_MAX)}openchamber`;
    assert.deepEqual(validateRuntime({ ...base, record: record(long), realExecPath: long }, posix, 'linux'), { ok: false });
  });

  test('accepts /opt/OpenChamber/openchamber and answers its realpath', () => {
    assert.deepEqual(validateRuntime(linuxCheck('/opt/OpenChamber/openchamber'), posix, 'linux'), { ok: true, execPath: '/opt/OpenChamber/openchamber' });
  });

  test('accepts the macOS binary in Contents/MacOS', () => {
    const check = {
      record: record('/Applications/OpenChamber.app/Contents/MacOS/OpenChamber'),
      realExecPath: '/Applications/OpenChamber.app/Contents/MacOS/OpenChamber',
      realInstallRoot: '/Applications/OpenChamber.app/Contents',
      isFile: true,
    };
    assert.equal(validateRuntime(check, posix, 'darwin').ok, true);
  });

  test('Windows: accepts OpenChamber.exe in the install, in any letter case; refuses one outside', () => {
    const opencode = 'C:\\Program Files\\OpenChamber\\resources\\opencode-cli\\opencode.exe';
    const root = installRootOf(opencode, win32, 'win32');
    assert.equal(root, 'C:\\Program Files\\OpenChamber');
    const exe = 'C:\\Program Files\\OpenChamber\\OpenChamber.exe';
    assert.deepEqual(validateRuntime({ record: record(exe), realExecPath: exe, realInstallRoot: root, isFile: true }, win32, 'win32'), { ok: true, execPath: exe });
    const lower = 'c:\\program files\\openchamber\\openchamber.EXE';
    assert.equal(validateRuntime({ record: record(lower), realExecPath: lower, realInstallRoot: root, isFile: true }, win32, 'win32').ok, true);
    const outside = 'C:\\Users\\you\\Downloads\\OpenChamber.exe';
    assert.equal(validateRuntime({ record: record(outside), realExecPath: outside, realInstallRoot: root, isFile: true }, win32, 'win32').ok, false);
    const node = 'C:\\Program Files\\OpenChamber\\node.exe';
    assert.equal(validateRuntime({ record: record(node), realExecPath: node, realInstallRoot: root, isFile: true }, win32, 'win32').ok, false);
  });
});

// ---- childEnv ----

describe('childEnv', () => {
  test('keeps only the allowlist and sets ELECTRON_RUN_AS_NODE', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/you',
      LANG: 'en_GB.UTF-8',
      TMPDIR: '/tmp',
      OPENCODE_SERVER_PASSWORD: 'hunter2',
      OPENCHAMBER_AGENT_TOOL_TOKEN: 'tok',
      OPENCHAMBER_SERVICE_TOKEN: 'svc',
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      XDG_CONFIG_HOME: '/xdg',
      DC_SETTINGS_PATH: '/tmp/settings.json',
      NODE_OPTIONS: '--require /tmp/evil.js',
      ELECTRON_RUN_AS_NODE: '0',
      UNDEFINED_ONE: undefined,
    };
    assert.deepEqual(childEnv(env, 'linux'), { PATH: '/usr/bin', HOME: '/home/you', LANG: 'en_GB.UTF-8', TMPDIR: '/tmp', ELECTRON_RUN_AS_NODE: '1' });
  });

  test('Windows keys match in any case and keep their own spelling', () => {
    const env = { Path: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\you', APPDATA: 'C:\\R', ComSpec: 'cmd.exe', OPENAI_API_KEY: 'sk-x' };
    assert.deepEqual(childEnv(env, 'win32'), { Path: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\you', APPDATA: 'C:\\R', ComSpec: 'cmd.exe', ELECTRON_RUN_AS_NODE: '1' });
  });

  test('posix keys are exact: path is not PATH', () => {
    assert.deepEqual(childEnv({ path: '/x' }, 'linux'), { ELECTRON_RUN_AS_NODE: '1' });
  });
});

// ---- buildChildArgs and toolResult ----

describe('buildChildArgs', () => {
  test('cli, check, the slug, one --screen per id, --static last; never --json or --root', () => {
    assert.deepEqual(buildChildArgs('/x/dist/cli/dc.mjs', { design: 'pricing', screens: [], static: false }), ['/x/dist/cli/dc.mjs', 'check', 'pricing']);
    assert.deepEqual(buildChildArgs('/x/dc.mjs', { design: 'p', screens: ['home', 'faq'], static: true }), ['/x/dc.mjs', 'check', 'p', '--screen', 'home', '--screen', 'faq', '--static']);
  });
});

describe('toolResult', () => {
  test('exit 0 and 1 answer the CLI text as it is', () => {
    assert.deepEqual(toolResult({ kind: 'exit', code: 0, stdout: 'No errors.\n', stderr: '', stdoutCut: false }), { content: 'No errors.\n', metadata: { designChamber: { exit: 0 } } });
    assert.deepEqual(toolResult({ kind: 'exit', code: 1, stdout: '3 errors\n', stderr: 'noise', stdoutCut: false }), { content: '3 errors\n', metadata: { designChamber: { exit: 1 } } });
  });

  test('a cut stdout says so', () => {
    const result = toolResult({ kind: 'exit', code: 1, stdout: 'x', stderr: '', stdoutCut: true });
    assert.match(result.content, /^x\n.*cut/);
  });

  test('exit 2 answers the stderr sentence, clipped', () => {
    assert.deepEqual(toolResult({ kind: 'exit', code: 2, stdout: '', stderr: 'There is no design called pricing in the designs folder.\n', stdoutCut: false }), {
      content: 'The check could not run: There is no design called pricing in the designs folder.',
      metadata: { designChamber: { exit: 2 } },
    });
    const long = toolResult({ kind: 'exit', code: 2, stdout: '', stderr: 'e'.repeat(10_000), stdoutCut: false });
    assert.equal(long.content.length, 'The check could not run: '.length + CHECK_TOOL_ERROR_TEXT_MAX);
  });

  test('a crash, a kill, a timeout and a spawn error each get a sentence and exit 2', () => {
    assert.equal(toolResult({ kind: 'exit', code: 134, stdout: '', stderr: '', stdoutCut: false }).metadata.designChamber.exit, 2);
    assert.match(toolResult({ kind: 'exit', code: null, stdout: '', stderr: '', stdoutCut: false }).content, /stopped before it finished/);
    assert.equal(toolResult({ kind: 'timeout' }).content, 'The check took longer than 3 minutes and was stopped. Try one screen with screens: ["<id>"].');
    assert.equal(toolResult({ kind: 'spawn-error', code: 'EACCES' }).content, 'Design Chamber could not start its check (EACCES).');
    assert.equal(toolResult({ kind: 'spawn-error', code: 'EACCES' }).metadata.designChamber.exit, 2);
  });
});

// ---- runDesignCheck with a fake spawn ----

type FakeChild = SpawnedChild & EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; killed: string[] };

const fakeChild = (): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = [];
  child.kill = (signal) => {
    child.killed.push(signal);
    return true;
  };
  return child;
};

type SpawnCall = { command: string; args: readonly string[]; env: Record<string, string> };

/** An install on disk: `<tmp>/inst/resources/opencode-cli/opencode`, `<tmp>/inst/openchamber`, the record and the CLI. */
const useInstall = async (t: Parameters<typeof useTmpRoot>[0]) => {
  const tmp = await useTmpRoot(t, 'dc-plugin-');
  const install = tmp.at('inst');
  const opencode = await tmp.write('inst/resources/opencode-cli/opencode', 'bin');
  const openchamber = await tmp.write('inst/openchamber', 'bin');
  const cliPath = await tmp.write('inst/resources/app/dist/cli/dc.mjs', '// cli');
  const home = tmp.at('home');
  const recordFile = path.join(home, '.config', 'design-chamber', 'runtime.json');
  const writeRecord = async (execPath: string): Promise<void> => {
    await mkdir(path.dirname(recordFile), { recursive: true });
    await writeFile(recordFile, JSON.stringify(record(execPath)));
  };
  const calls: SpawnCall[] = [];
  let next: (child: FakeChild) => void = (child) => {
    queueMicrotask(() => child.emit('close', 0, null));
  };
  const deps = (over: Partial<ToolDeps> = {}): ToolDeps => ({
    platform: 'linux',
    path,
    env: { PATH: '/usr/bin', HOME: home, OPENCODE_SERVER_PASSWORD: 'hunter2', XDG_CONFIG_HOME: tmp.at('xdg') },
    homeDir: home,
    opencodeExecPath: opencode,
    cliPath,
    readText: async (file, maxBytes) => {
      try {
        const text = await readFile(file, 'utf8');
        return text.length > maxBytes ? '' : text;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    realpath: (file) => realpath(file).catch(() => null),
    isFile: (file) => stat(file).then((info) => info.isFile(), () => false),
    spawn: (command, args, options) => {
      calls.push({ command, args, env: options.env });
      const child = fakeChild();
      next(child);
      return child;
    },
    timeoutMs: 1000,
    killGraceMs: 50,
    ...over,
  });
  return { tmp, install, opencode, openchamber, cliPath, home, writeRecord, calls, deps, onSpawn: (fn: (child: FakeChild) => void) => (next = fn) };
};

describe('runDesignCheck', () => {
  test('no runtime.json → the setup sentence, nothing runs', async (t) => {
    const setup = await useInstall(t);
    const result = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps());
    assert.deepEqual(result, { content: SETUP_SENTENCE, metadata: { designChamber: { exit: 2 } } });
    assert.equal(setup.calls.length, 0);
  });

  test('a bad design name is refused before runtime.json is read', async (t) => {
    const setup = await useInstall(t);
    let read = false;
    const result = await runDesignCheck({ design: '../etc' }, undefined, setup.deps({ readText: async () => ((read = true), null) }));
    assert.equal(result.metadata.designChamber.exit, 2);
    assert.equal(read, false);
  });

  test('a record pointing at a program outside the install → the launcher sentence, nothing runs', async (t) => {
    const setup = await useInstall(t);
    for (const name of ['node', 'openchamber']) {
      const evil = await setup.tmp.write(`x/${name}`, '#!/bin/sh\necho pwned');
      await setup.writeRecord(evil);
      const result = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps());
      assert.deepEqual(result, { content: LAUNCHER_SENTENCE, metadata: { designChamber: { exit: 2 } } });
      assert.ok(!result.content.includes(evil), 'the refusal names no path');
    }
    assert.equal(setup.calls.length, 0);
  });

  test('a symlink inside the install that points outside it is refused', async (t) => {
    const setup = await useInstall(t);
    const outside = await setup.tmp.write('elsewhere/openchamber', 'bin');
    const link = path.join(setup.install, 'bin', 'openchamber');
    await mkdir(path.dirname(link), { recursive: true });
    try {
      await symlink(outside, link);
    } catch (error) {
      t.skip(`symlinks are not available here (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`);
      return;
    }
    await setup.writeRecord(link);
    assert.equal((await runDesignCheck({ design: 'pricing' }, undefined, setup.deps())).content, LAUNCHER_SENTENCE);
    assert.equal(setup.calls.length, 0);
  });

  test('an OpenCode outside an OpenChamber install → the launcher sentence', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    const own = await setup.tmp.write('usr/local/bin/opencode', 'bin');
    assert.equal((await runDesignCheck({ design: 'pricing' }, undefined, setup.deps({ opencodeExecPath: own }))).content, LAUNCHER_SENTENCE);
    assert.equal(setup.calls.length, 0);
  });

  test('a corrupt or oversized runtime.json → the launcher sentence', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    for (const text of ['{not json', '', '[]', '"x"']) {
      const result = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps({ readText: async () => text }));
      assert.equal(result.content, LAUNCHER_SENTENCE, `for ${JSON.stringify(text)}`);
    }
    const unreadable = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps({ readText: async () => Promise.reject(new Error('EACCES')) }));
    assert.equal(unreadable.content, LAUNCHER_SENTENCE);
    assert.equal(setup.calls.length, 0);
  });

  test('the OpenChamber binary in the install runs the CLI with an allowlisted env, and exit 1 answers stdout', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('pricing: 2 errors\n'));
        child.stdout.emit('data', Buffer.from('Look at .chamber/check/r1/home@laptop.png\n'));
        child.stderr.emit('data', Buffer.from('ignored'));
        child.emit('close', 1, null);
      });
    });
    const result = await runDesignCheck({ design: 'pricing', screens: 'home', static: 'false' }, undefined, setup.deps());
    assert.deepEqual(result, { content: 'pricing: 2 errors\nLook at .chamber/check/r1/home@laptop.png\n', metadata: { designChamber: { exit: 1 } } });
    assert.equal(setup.calls.length, 1);
    const [call] = setup.calls;
    assert.ok(call);
    assert.equal(call.command, await realpath(setup.openchamber));
    assert.deepEqual(call.args, [setup.cliPath, 'check', 'pricing', '--screen', 'home']);
    assert.deepEqual(call.env, { PATH: '/usr/bin', HOME: setup.home, ELECTRON_RUN_AS_NODE: '1' });
  });

  test('exit 2 answers the stderr sentence', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('There is no design called pricing.\n'));
        child.emit('close', 2, null);
      });
    });
    const result = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps());
    assert.equal(result.content, 'The check could not run: There is no design called pricing.');
    assert.equal(result.metadata.designChamber.exit, 2);
  });

  test('stdout past the cap is dropped and noted; the child keeps being drained', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('a'.repeat(8)));
        child.stdout.emit('data', Buffer.from('b'.repeat(8)));
        child.emit('close', 0, null);
      });
    });
    const result = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps({ stdoutMaxBytes: 10 }));
    assert.match(result.content, /^a{8}b{2}\n/);
    assert.match(result.content, /cut/);
  });

  test('an abort kills the child: SIGTERM, then SIGKILL after the grace period', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    let spawned: FakeChild | null = null;
    setup.onSpawn((child) => {
      spawned = child;
      child.kill = (signal) => {
        child.killed.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
        return true;
      };
    });
    const controller = new AbortController();
    const running = runDesignCheck({ design: 'pricing' }, controller.signal, setup.deps());
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const result = await running;
    assert.ok(spawned);
    assert.deepEqual((spawned as FakeChild).killed, ['SIGTERM', 'SIGKILL']);
    assert.equal(result.metadata.designChamber.exit, 2);
    // The abort, not the 1 s timeout, must be what stopped it: a timeout answers a different sentence.
    assert.match(result.content, /stopped before it finished/);
  });

  test('an abort before the start runs nothing', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    const controller = new AbortController();
    controller.abort();
    const result = await runDesignCheck({ design: 'pricing' }, controller.signal, setup.deps());
    assert.equal(result.metadata.designChamber.exit, 2);
    assert.equal(setup.calls.length, 0);
  });

  test('a child that runs too long is stopped with the timeout sentence', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      child.kill = (signal) => {
        child.killed.push(signal);
        queueMicrotask(() => child.emit('close', null, signal));
        return true;
      };
    });
    const result = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps({ timeoutMs: 20 }));
    assert.equal(result.content, 'The check took longer than 3 minutes and was stopped. Try one screen with screens: ["<id>"].');
  });

  test('a spawn error answers a sentence with its code, and a throwing spawn does not escape', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      queueMicrotask(() => child.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' })));
    });
    assert.equal((await runDesignCheck({ design: 'pricing' }, undefined, setup.deps())).content, 'Design Chamber could not start its check (ENOENT).');
    const throwing = await runDesignCheck(
      { design: 'pricing' },
      undefined,
      setup.deps({
        spawn: () => {
          throw Object.assign(new Error('bad'), { code: 'EPERM' });
        },
      }),
    );
    assert.equal(throwing.content, 'Design Chamber could not start its check (EPERM).');
  });

  test('a missing CLI answers a sentence instead of running', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    const result = await runDesignCheck({ design: 'pricing' }, undefined, setup.deps({ cliPath: path.join(setup.install, 'missing.mjs') }));
    assert.equal(result.metadata.designChamber.exit, 2);
    assert.match(result.content, /Reinstall Design Chamber/);
    assert.equal(setup.calls.length, 0);
  });
});

describe('createDesignCheckTool', () => {
  test('execute never throws, even when the dependencies cannot be built', async () => {
    const tool = createDesignCheckTool(() => {
      throw new Error('getBuiltinModule is missing');
    });
    const result = await tool.execute({ design: 'pricing' }, {});
    assert.equal(result.metadata.designChamber.exit, 2);
    assert.match(result.content, /could not start its check/);
  });
});
