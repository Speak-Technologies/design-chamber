// runtime.json (documentation/specs/phase-1-5-sdk-2-7.md §U3.3, §U3.4 7): the service records which
// program runs it, next to settings.json, so the OpenCode `design_check` tool can run the check CLI
// with it. Written on start, rewritten only when something changed, never a secret, never throws.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { composeService } from '../../../src/service/compose.ts';
import type { Logger } from '../../../src/service/context.ts';
import { buildRuntimeRecord, runtimeRecordPath, syncRuntimeRecord } from '../../../src/service/runtime-record.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

type Line = { level: string; event: string; fields?: Record<string, unknown> };
const captureLog = (): Logger & { lines: Line[] } => {
  const lines: Line[] = [];
  return {
    lines,
    info: (event, fields) => lines.push({ level: 'info', event, ...(fields ? { fields } : {}) }),
    warn: (event, fields) => lines.push({ level: 'warn', event, ...(fields ? { fields } : {}) }),
    error: (event, fields) => lines.push({ level: 'error', event, ...(fields ? { fields } : {}) }),
  };
};

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const fixedNow = (): Date => new Date('2026-11-10T09:00:00.000Z');

test('buildRuntimeRecord holds exactly v, execPath, electron, version and updated', () => {
  assert.deepEqual(buildRuntimeRecord({ execPath: '/opt/OpenChamber/openchamber', electron: true, version: '0.2.0', now: fixedNow }), {
    v: 1,
    execPath: '/opt/OpenChamber/openchamber',
    electron: true,
    version: '0.2.0',
    updated: '2026-11-10T09:00:00.000Z',
  });
});

test('writes runtime.json next to settings.json on start', async (t) => {
  const tmp = await useTmpRoot(t);
  const env = { DC_SETTINGS_PATH: tmp.at('cfg/settings.json') };
  const log = captureLog();
  const status = await syncRuntimeRecord({ log, version: '0.2.0', env, execPath: '/opt/OpenChamber/openchamber', electron: true, now: fixedNow });
  assert.equal(status, 'written');
  const file = tmp.at('cfg/runtime.json');
  assert.equal(runtimeRecordPath(env), file);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    v: 1,
    execPath: '/opt/OpenChamber/openchamber',
    electron: true,
    version: '0.2.0',
    updated: '2026-11-10T09:00:00.000Z',
  });
});

test('an identical record is not rewritten; a new execPath or version is', async (t) => {
  const tmp = await useTmpRoot(t);
  const env = { DC_SETTINGS_PATH: tmp.at('settings.json') };
  const log = captureLog();
  const base = { log, env, electron: true, now: fixedNow };
  assert.equal(await syncRuntimeRecord({ ...base, version: '0.2.0', execPath: '/opt/OpenChamber/openchamber' }), 'written');
  const file = tmp.at('runtime.json');
  const before = await stat(file);
  const later = (): Date => new Date('2026-11-11T09:00:00.000Z');
  assert.equal(await syncRuntimeRecord({ ...base, now: later, version: '0.2.0', execPath: '/opt/OpenChamber/openchamber' }), 'current');
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.match(await readFile(file, 'utf8'), /2026-11-10T09/, 'the old record stays as it was');
  assert.equal(await syncRuntimeRecord({ ...base, version: '0.2.1', execPath: '/opt/OpenChamber/openchamber' }), 'written');
  assert.equal(await syncRuntimeRecord({ ...base, version: '0.2.1', execPath: '/opt/Elsewhere/openchamber' }), 'written');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).execPath, '/opt/Elsewhere/openchamber');
});

test('a corrupt record is replaced', async (t) => {
  const tmp = await useTmpRoot(t);
  const env = { DC_SETTINGS_PATH: tmp.at('settings.json') };
  await tmp.write('runtime.json', '{ broken');
  assert.equal(await syncRuntimeRecord({ log: captureLog(), env, version: '0.2.0', execPath: '/opt/OpenChamber/openchamber', electron: true }), 'written');
  assert.equal(JSON.parse(await readFile(tmp.at('runtime.json'), 'utf8')).v, 1);
});

test('a write failure is logged as runtime-record.write-failed and never thrown', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('needs POSIX permissions and a non-root user');
    return;
  }
  const tmp = await useTmpRoot(t);
  const dir = tmp.at('locked');
  await mkdir(dir);
  await chmod(dir, 0o500);
  // The temp root's own cleanup may already have removed it (an empty folder needs no write bit).
  t.after(() => chmod(dir, 0o700).catch(() => undefined));
  const log = captureLog();
  const status = await syncRuntimeRecord({ log, env: { DC_SETTINGS_PATH: path.join(dir, 'settings.json') }, version: '0.2.0', execPath: '/opt/OpenChamber/openchamber', electron: true });
  assert.equal(status, 'failed');
  assert.ok(log.lines.some((line) => line.level === 'warn' && line.event === 'runtime-record.write-failed'));
});

test('a path the plugin would refuse anyway (a control character) is not written', async (t) => {
  const tmp = await useTmpRoot(t);
  const log = captureLog();
  const status = await syncRuntimeRecord({ log, env: { DC_SETTINGS_PATH: tmp.at('settings.json') }, version: '0.2.0', execPath: '/opt/Open\nChamber/openchamber', electron: true });
  assert.equal(status, 'failed');
  await assert.rejects(readFile(tmp.at('runtime.json'), 'utf8'));
});

test('the composed service writes the record with its own runtime and never the bearer token', async (t) => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  await mkdir(root, { recursive: true });
  const settingsPath = tmp.at('settings.json');
  await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
  const token = 'runtime-record-secret-token-5f2a';
  const service = await composeService({ token, log: captureLog(), packageRoot: REPO_ROOT, version: '0.0.0-test', env: { DC_SETTINGS_PATH: settingsPath }, homeDir: tmp.at('home') });
  await service.dispose();
  const text = await readFile(tmp.at('runtime.json'), 'utf8');
  assert.ok(!text.includes(token), 'runtime.json must never hold the service token');
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ['electron', 'execPath', 'updated', 'v', 'version']);
  assert.equal(parsed.execPath, process.execPath);
  assert.equal(parsed.version, '0.0.0-test');
  assert.equal(parsed.electron, process.versions.electron !== undefined);
});
