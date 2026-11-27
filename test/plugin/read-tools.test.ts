// The `design_list` and `design_read` OpenCode tools (documentation/specs/use-the-project-and-native-agent.md
// §2.3): input refused before anything runs, the same program and environment rules as design_check,
// a 20 s timeout that kills the child, capped output, and the CLI's own sentence on exit 2.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { runDesignCheck } from '../../src/plugin/check-tool.ts';
import {
  buildListArgs,
  createDesignListTool,
  createDesignReadTool,
  LIST_TOOL_DESCRIPTION,
  LIST_TOOL_INPUT,
  parseListInput,
  parseReadInput,
  READ_TOOL_DESCRIPTION,
  READ_TOOL_TIMEOUT_MS,
  runDesignList,
  runDesignRead,
} from '../../src/plugin/read-tools.ts';
import type { SpawnedChild, ToolDeps } from '../../src/plugin/run-cli.ts';
import { useTmpRoot } from '../helpers/tmp-root.ts';

const posixAbs = path.posix.isAbsolute;
const winAbs = path.win32.isAbsolute;

describe('parseListInput', () => {
  test('nothing, an empty object and empty values mean the whole list', () => {
    const all = { ok: true, project: null, kind: null, text: null };
    assert.deepEqual(parseListInput(undefined, posixAbs), all);
    assert.deepEqual(parseListInput(null, posixAbs), all);
    assert.deepEqual(parseListInput({}, posixAbs), all);
    assert.deepEqual(parseListInput({ project: '', kind: null, text: '' }, posixAbs), all);
    assert.deepEqual(parseListInput({ project: '/home/u/shop', kind: 'canvas', text: 'hero', extra: 1 }, posixAbs), { ok: true, project: '/home/u/shop', kind: 'canvas', text: 'hero' });
  });

  test('refuses a relative, broken or huge project, an unknown kind and a long or multi-line text', () => {
    const bad: unknown[] = [
      'pricing',
      [],
      42,
      { project: 'shop' },
      { project: '../shop' },
      { project: '/home/u/sh\nop' },
      { project: '/home/\u0000x' },
      { project: `/${'a'.repeat(4096)}` },
      { project: 42 },
      { kind: 'artifact' },
      { kind: 'PAGE' },
      { text: 'a'.repeat(101) },
      { text: 'two\nlines' },
      { text: 'line\u2028sep' },
      { text: '   ' },
      { text: 7 },
    ];
    for (const input of bad) assert.equal(parseListInput(input, posixAbs).ok, false, JSON.stringify(input));
    assert.equal(parseListInput({ text: 'a'.repeat(100) }, posixAbs).ok, true);
  });

  test('a Windows project path is judged by Windows rules', () => {
    assert.equal(parseListInput({ project: 'C:\\Code\\Shop' }, winAbs).ok, true);
    assert.equal(parseListInput({ project: 'C:\\Code\\Shop' }, posixAbs).ok, false);
  });

  test('values ride with `=`, so a text that looks like an option stays a value', () => {
    assert.deepEqual(buildListArgs('/cli', { project: '/p', kind: 'page', text: '--root /etc' }), ['/cli', 'list', '--project=/p', '--kind=page', '--text=--root /etc']);
    assert.deepEqual(buildListArgs('/cli', { project: null, kind: null, text: null }), ['/cli', 'list']);
  });
});

describe('parseReadInput', () => {
  test('refuses anything that is not a bare design folder name', () => {
    for (const design of ['../x', '/abs/path', 'C:\\x', 'a/b', 'a\\b', '', ' pricing', 'Pricing', `a${'b'.repeat(63)}`, '..', '.', 'pricing\n', '-rf', 42, null, undefined]) {
      assert.equal(parseReadInput({ design }).ok, false, JSON.stringify(design));
    }
    for (const input of [null, undefined, 'pricing', []]) assert.equal(parseReadInput(input).ok, false);
    assert.deepEqual(parseReadInput({ design: 'pricing-page', other: true }), { ok: true, design: 'pricing-page' });
  });
});

test('the descriptions are short and plain', () => {
  for (const description of [LIST_TOOL_DESCRIPTION, READ_TOOL_DESCRIPTION]) {
    assert.ok(description.length > 0 && description.length <= 200, description);
    assert.ok(!description.includes('\u2014'));
  }
  assert.deepEqual(JSON.parse(JSON.stringify(LIST_TOOL_INPUT)), LIST_TOOL_INPUT);
});

// ---- with a fake spawn ----

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

/** An install on disk, as check-tool.test.ts builds it: OpenCode inside it, the OpenChamber binary, the record and the CLI. */
const useInstall = async (t: TestContext) => {
  const tmp = await useTmpRoot(t, 'dc-plugin-read-');
  const opencode = await tmp.write('inst/resources/opencode-cli/opencode', 'bin');
  const openchamber = await tmp.write('inst/openchamber', 'bin');
  const cliPath = await tmp.write('inst/resources/app/dist/cli/dc.mjs', '// cli');
  const home = tmp.at('home');
  const recordFile = path.join(home, '.config', 'design-chamber', 'runtime.json');
  const writeRecord = async (execPath: string): Promise<void> => {
    await mkdir(path.dirname(recordFile), { recursive: true });
    await writeFile(recordFile, JSON.stringify({ v: 1, execPath, electron: true }));
  };
  const calls: SpawnCall[] = [];
  let next: (child: FakeChild) => void = (child) => {
    queueMicrotask(() => child.emit('close', 0, null));
  };
  const deps = (over: Partial<ToolDeps> = {}): ToolDeps => ({
    platform: 'linux',
    path,
    env: { PATH: '/usr/bin', HOME: home, OPENCODE_SERVER_PASSWORD: 'hunter2', ANTHROPIC_API_KEY: 'sk-x', XDG_CONFIG_HOME: tmp.at('xdg'), DC_SETTINGS_PATH: '/elsewhere' },
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
    killGraceMs: 20,
    ...over,
  });
  return { tmp, openchamber, cliPath, home, writeRecord, calls, deps, onSpawn: (fn: (child: FakeChild) => void) => (next = fn) };
};

describe('runDesignList and runDesignRead', () => {
  test('bad input is refused before runtime.json is read or anything runs', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    let read = false;
    const deps = setup.deps({ readText: async () => ((read = true), null) });
    for (const result of [await runDesignRead({ design: '../etc' }, undefined, deps), await runDesignList({ project: 'relative' }, undefined, deps), await runDesignList({ kind: 'x' }, undefined, deps)]) {
      assert.equal(result.metadata.designChamber.exit, 2);
    }
    assert.equal(read, false);
    assert.equal(setup.calls.length, 0);
  });

  test('no runtime.json, or a program outside the install, runs nothing', async (t) => {
    const setup = await useInstall(t);
    const none = await runDesignList({}, undefined, setup.deps());
    assert.match(none.content, /hasn't set up its tools yet/);
    const evil = await setup.tmp.write('x/openchamber', '#!/bin/sh\necho pwned');
    await setup.writeRecord(evil);
    const refused = await runDesignRead({ design: 'pricing' }, undefined, setup.deps());
    assert.equal(refused.content, "The design_read tool can't run in this setup. Run dc read pricing with the launcher named in the AGENTS.md file in the Designs folder instead.");
    assert.ok(!refused.content.includes(evil));
    assert.equal(setup.calls.length, 0);
  });

  test('runs the OpenChamber binary with the same allowlisted environment as design_check, and answers stdout on exit 0', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('Designs folder: /d\n'));
        child.emit('close', 0, null);
      });
    });
    const listed = await runDesignList({ project: '/home/u/shop', text: 'hero' }, undefined, setup.deps());
    assert.deepEqual(listed, { content: 'Designs folder: /d\n', metadata: { designChamber: { exit: 0 } } });
    await runDesignRead({ design: 'pricing-page' }, undefined, setup.deps());
    await runDesignCheck({ design: 'pricing-page' }, undefined, setup.deps());
    const [list, read, check] = setup.calls;
    assert.ok(list && read && check);
    assert.equal(list.command, await realpath(setup.openchamber));
    assert.deepEqual(list.args, [setup.cliPath, 'list', '--project=/home/u/shop', '--text=hero']);
    assert.deepEqual(read.args, [setup.cliPath, 'read', 'pricing-page']);
    assert.deepEqual(list.env, { PATH: '/usr/bin', HOME: setup.home, ELECTRON_RUN_AS_NODE: '1' });
    assert.deepEqual(read.env, check.env, 'one allowlist for every tool');
    assert.deepEqual(list.env, check.env);
  });

  test('exit 2 answers the CLI sentence as it is', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('That is not a design in /home/u/Designs.\n'));
        child.emit('close', 2, null);
      });
    });
    assert.deepEqual(await runDesignRead({ design: 'ghost' }, undefined, setup.deps()), { content: 'That is not a design in /home/u/Designs.', metadata: { designChamber: { exit: 2 } } });
  });

  test('output past the cap is dropped and noted', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    setup.onSpawn((child) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('a'.repeat(8)));
        child.stdout.emit('data', Buffer.from('b'.repeat(8)));
        child.emit('close', 0, null);
      });
    });
    const result = await runDesignList({}, undefined, setup.deps({ stdoutMaxBytes: 10 }));
    assert.match(result.content, /^a{8}b{2}\n\(The rest of the answer was cut/);
  });

  test(`the child is killed after ${READ_TOOL_TIMEOUT_MS / 1000} s: SIGTERM, then SIGKILL, and the timeout sentence`, async (t) => {
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
    // The tool's own timeout, not design_check's 3 minutes: catch the delay it asks for, then fire it at once.
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, ms === READ_TOOL_TIMEOUT_MS ? 1 : ms);
    }) as typeof setTimeout);
    const result = await runDesignRead({ design: 'pricing' }, undefined, setup.deps());
    t.mock.restoreAll();
    assert.ok(delays.includes(20_000), `timeouts asked for: ${delays.join(', ')}`);
    assert.ok(spawned);
    assert.deepEqual((spawned as FakeChild).killed, ['SIGTERM', 'SIGKILL']);
    assert.equal(result.content, 'Reading the Designs folder took longer than 20 seconds and was stopped. Try again, or narrow the list with project, kind or text.');
    assert.equal(result.metadata.designChamber.exit, 2);
  });

  test('an abort before the start runs nothing; a spawn error is a sentence', async (t) => {
    const setup = await useInstall(t);
    await setup.writeRecord(setup.openchamber);
    const controller = new AbortController();
    controller.abort();
    assert.equal((await runDesignList({}, controller.signal, setup.deps())).metadata.designChamber.exit, 2);
    assert.equal(setup.calls.length, 0);
    setup.onSpawn((child) => queueMicrotask(() => child.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }))));
    assert.equal((await runDesignRead({ design: 'pricing' }, undefined, setup.deps())).content, 'Design Chamber could not start its program (ENOENT).');
  });

  test('execute never throws, even when the dependencies cannot be built', async () => {
    const broken = (): ToolDeps => {
      throw new Error('getBuiltinModule is missing');
    };
    for (const tool of [createDesignListTool(broken), createDesignReadTool(broken)]) {
      const result = await tool.execute({ design: 'pricing' }, {});
      assert.equal(result.metadata.designChamber.exit, 2);
      assert.match(result.content, /could not start its program/);
    }
  });
});
