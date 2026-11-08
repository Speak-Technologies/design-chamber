import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import { randomBytes } from 'node:crypto';

import { crc32, crc32Portable, writeZipFile, ZipError, type ZipSource } from '../../../src/service/zip.ts';
import { readZip } from './zip-reader.ts';

const entry = (name: string, data: Uint8Array): ZipSource => ({ name, read: async () => Buffer.from(data) });

/** Write the sources with `writeZipFile` into a tmp folder (removed after the test) and answer the file's path. */
const zipFile = async (t: TestContext, sources: readonly ZipSource[], options?: Parameters<typeof writeZipFile>[2]): Promise<string> => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'dc-zip-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const target = path.join(work, 'out.zip');
  await writeZipFile(target, sources, options);
  return target;
};

/** Convenience for the round-trip tests: the archive's bytes. */
const zipBytes = async (t: TestContext, sources: readonly ZipSource[]): Promise<Buffer> => readFile(await zipFile(t, sources));

describe('zip writer', () => {
  test('crc32 matches the published check value for "123456789"', () => {
    // The canonical CRC-32/ISO-HDLC check value.
    assert.equal(crc32(Buffer.from('123456789', 'utf8')) >>> 0, 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)) >>> 0, 0);
  });

  test('round-trips text and binary entries through the reader (deflate + store, CRC verified)', async (t) => {
    const text = Buffer.from('<!doctype html><h1>hello ✓</h1>'.repeat(50), 'utf8'); // compressible → deflate
    const binary = randomBytes(5000); // incompressible → store
    const zip = await zipBytes(t, [
      entry('design/index.html', text),
      entry('design/assets/noise.bin', binary),
      entry('design/empty.txt', Buffer.alloc(0)),
    ]);
    const entries = readZip(zip);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['design/index.html', 'design/assets/noise.bin', 'design/empty.txt'],
    );
    assert.ok(entries[0]?.data.equals(text));
    assert.ok(entries[1]?.data.equals(binary));
    assert.equal(entries[2]?.data.length, 0);
    // Both methods must appear: the compressible file deflated, the random one stored.
    assert.equal(entries[0]?.method, 8);
    assert.equal(entries[1]?.method, 0);
  });

  test('UTF-8 names survive the round trip (flag bit 11)', async (t) => {
    const zip = await zipBytes(t, [entry('design/日本語 ✓.txt', Buffer.from('x', 'utf8'))]);
    assert.equal(readZip(zip)[0]?.name, 'design/日本語 ✓.txt');
  });

  test('duplicate and empty names are refused', async (t) => {
    await assert.rejects(zipFile(t, [entry('a.txt', Buffer.alloc(1)), entry('a.txt', Buffer.alloc(1))]), ZipError);
    await assert.rejects(zipFile(t, [entry('', Buffer.alloc(1))]), ZipError);
  });

  test('an empty archive is a valid ZIP with zero entries', async (t) => {
    assert.equal(readZip(await zipBytes(t, [])).length, 0);
  });

  test('a file that vanished (read answers null) is skipped, not an error', async (t) => {
    const zip = readZip(await zipBytes(t, [{ name: 'gone.txt', read: async () => null }, entry('kept.txt', Buffer.from('k'))]));
    assert.deepEqual(zip.map((e) => e.name), ['kept.txt']);
  });

  test('the target is never overwritten (open with wx)', async (t) => {
    const target = await zipFile(t, [entry('a.txt', Buffer.from('first'))]);
    await assert.rejects(writeZipFile(target, [entry('a.txt', Buffer.from('second'))]), { code: 'EEXIST' });
    assert.equal(readZip(await readFile(target))[0]?.data.toString('utf8'), 'first');
  });

  test('crc32 (native when available) equals the portable table on the check value, 1 MiB of noise, and a running value across slices', () => {
    assert.equal(crc32Portable(Buffer.from('123456789', 'utf8')), 0xcbf43926);
    assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926);
    const noise = randomBytes(1024 * 1024);
    assert.equal(crc32(noise), crc32Portable(noise));
    // A running value: slices joined equal the whole, for both implementations.
    const cut = 300_001;
    const whole = crc32Portable(noise);
    assert.equal(crc32Portable(noise.subarray(cut), crc32Portable(noise.subarray(0, cut))), whole);
    assert.equal(crc32(noise.subarray(cut), crc32(noise.subarray(0, cut))), whole);
  });

  test('already-compressed extensions are stored without a deflate attempt; the same bytes under .txt are deflated', async (t) => {
    const squashable = Buffer.alloc(64 * 1024, 7); // deflate would shrink this a lot
    const zip = readZip(await zipBytes(t, [entry('a.PNG', squashable), entry('b.woff2', squashable), entry('c.txt', squashable)]));
    assert.deepEqual(zip.map((e) => e.method), [0, 0, 8]);
    assert.ok(zip.every((e) => e.data.equals(squashable)));
  });

  test('an entry over the size cap throws a ZipError naming the file; the partial file is the caller\'s to remove', async (t) => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'dc-zip-cap-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const target = path.join(work, 'big.zip');
    await assert.rejects(
      writeZipFile(target, [entry('d/ok.txt', Buffer.from('fine')), entry('d/huge.bin', Buffer.alloc(100))], { maxEntryBytes: 50 }),
      (error: unknown) => error instanceof ZipError && error.message.includes('d/huge.bin') && error.message.includes('too large to put in a ZIP'),
    );
    // The writer closed its handle, so the caller (export.ts) can remove the partial file.
    await rm(target, { force: true });
    assert.deepEqual(await readdir(work), []);
  });

  // System-reader proof (SPEC §14 WP2: "ZIP opens with system unzip"): PowerShell's
  // Expand-Archive on Windows; Info-ZIP `unzip` on Linux/macOS, else `tar -xf` (bsdtar —
  // macOS's tar — reads zip; GNU tar does not, so a machine with neither skips with a reason).
  test('the too-large sentence uses the entry\'s label (the design-relative path) when it has one', async (t) => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'dc-zip-label-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    await assert.rejects(
      writeZipFile(path.join(work, 'a.zip'), [{ name: 'design/assets/x.bin', label: 'assets/x.bin', read: async () => Buffer.alloc(100) }], { maxEntryBytes: 50 }),
      (error: unknown) => error instanceof ZipError && error.message.startsWith('assets/x.bin is over') && !error.message.includes('design/'),
    );
  });

  test('the system extractor opens the archive with identical contents', async (t) => {
    const text = '<!doctype html><h1>system unzip ✓</h1>';
    const zipPath = await zipFile(t, [
      entry('design/index.html', Buffer.from(text, 'utf8')),
      entry('design/assets/notes.txt', Buffer.from('nested folder entry', 'utf8')),
    ]);
    const work = path.dirname(zipPath);
    const outDir = path.join(work, 'out');

    let result: { status: number | null; stderr: string };
    if (process.platform === 'win32') {
      const ps = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`],
        { encoding: 'utf8', timeout: 60_000 },
      );
      result = { status: ps.status, stderr: ps.stderr ?? '' };
      if (ps.status !== 0) return t.skip(`Expand-Archive unavailable on this machine: ${ps.stderr?.slice(0, 200)}`);
    } else {
      await mkdir(outDir, { recursive: true });
      const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', outDir], { encoding: 'utf8', timeout: 60_000 });
      if (unzip.error === undefined) {
        result = { status: unzip.status, stderr: unzip.stderr ?? '' };
      } else {
        const tar = spawnSync('tar', ['-xf', zipPath, '-C', outDir], { encoding: 'utf8', timeout: 60_000 });
        result = { status: tar.status, stderr: tar.stderr ?? '' };
        if (tar.status !== 0) return t.skip(`No system unzip reader available (no unzip; tar cannot read zip): ${tar.stderr?.slice(0, 200)}`);
      }
    }
    assert.equal(result.status, 0, result.stderr);
    const extractDir = outDir;
    const extracted = await readFile(path.join(extractDir, 'design', 'index.html'), 'utf8');
    assert.equal(extracted, text);
    const nested = await readFile(path.join(extractDir, 'design', 'assets', 'notes.txt'), 'utf8');
    assert.equal(nested, 'nested folder entry');
  });
});
