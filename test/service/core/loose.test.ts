// Loose HTML in the designs root (documentation/specs/agent-guidance-and-pages.md §3.5, §9, §10,
// task A4): the bounded listing on GET /designs, the name rule, and POST /loose/import, which
// copies the file byte-for-byte into a new page and moves the original into .trash, never
// deleting anything and never reading through a link or a crafted name.

import assert from 'node:assert/strict';
import { mkdir, open, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { DesignListResponse, ImportLooseResponse } from '../../../src/shared/api.ts';
import { LOOSE_IMPORT_MAX_BYTES, LOOSE_LIST_MAX } from '../../../src/shared/limits.ts';
import { createLooseImporter, humaniseStem, isLooseHtmlName, listLooseHtml, looseTitleOf } from '../../../src/service/loose.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createCore, useServedCore, type Core } from './harness.ts';

const json = async <T>(answer: Response): Promise<T> => {
  const text = await answer.text();
  return JSON.parse(text) as T;
};

const errorOf = async (answer: Response): Promise<{ error: string; message: string }> => json(answer);

/** Make a symlink, or skip the test where the OS refuses (Windows without developer mode). */
const symlinkOrSkip = async (t: TestContext, target: string, at: string): Promise<boolean> => {
  try {
    await symlink(target, at, 'file');
    return true;
  } catch (error) {
    t.skip(`symlinks unavailable here: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
    return false;
  }
};

const designSlugs = async (root: string): Promise<string[]> =>
  (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();

const trashEntries = async (root: string): Promise<string[]> => (await readdir(path.join(root, '.trash')).catch(() => [])).sort();

const coreImporter = (core: Core, now?: () => Date) =>
  createLooseImporter({ settings: core.ctx.settings, store: core.store, log: core.ctx.log, ...(now ? { now } : {}) });

describe('the name rule', () => {
  test('accepts plain .html/.htm names in any case and refuses everything that could leave the root', () => {
    for (const name of ['x.html', 'x.HTML', 'pricing v2.htm', 'Ünïcode página.html', `${'a'.repeat(250)}.html`]) {
      assert.equal(isLooseHtmlName(name), true, name);
    }
    for (const name of [
      '../x.html',
      'a/b.html',
      'a\\b.html',
      '.x.html',
      'x.html\u0000',
      'x\u0000.html',
      'x\n.html',
      'x\u007f.html',
      `${'a'.repeat(251)}.html`, // 256 characters
      '',
      'x.html.txt',
      'x.htmlx',
      'AGENTS.md',
      'C:\\x.html',
      '/etc/x.html',
      42,
      null,
    ]) {
      assert.equal(isLooseHtmlName(name), false, JSON.stringify(name));
    }
  });

  test('titles: the <title> wins, else the humanised file stem', () => {
    assert.equal(humaniseStem('pricing-v2.html'), 'Pricing v2');
    assert.equal(humaniseStem('my_landing.page.HTM'), 'My landing page');
    assert.equal(humaniseStem('-.html'), '-');
    assert.equal(looseTitleOf('a.html', Buffer.from('<html><title> Launch &amp; plan </title></html>')), 'Launch & plan');
    assert.equal(looseTitleOf('launch-day.html', Buffer.from('<h1>No title tag</h1>')), 'Launch day');
    // A <title> beyond the scanned head does not count.
    const late = Buffer.concat([Buffer.alloc(70_000, 0x20), Buffer.from('<title>Too late</title>')]);
    assert.equal(looseTitleOf('late-title.html', late), 'Late title');
  });
});

describe('listLooseHtml', () => {
  test('lists only regular .html/.htm files: dot files, folders, symlinks, AGENTS.md and other files are left out', async (t) => {
    const core = await createCore(t);
    t.after(() => core.stop());
    await writeFile(path.join(core.root, 'one.html'), '<p>1</p>');
    await writeFile(path.join(core.root, 'two.HTM'), '<p>2</p>');
    await writeFile(path.join(core.root, '.hidden.html'), '<p>h</p>');
    await writeFile(path.join(core.root, 'AGENTS.md'), '# guide');
    await writeFile(path.join(core.root, 'notes.txt'), 'n');
    await mkdir(path.join(core.root, 'folder.html'));
    await core.tmp.write('outside.html', '<p>outside</p>');
    const linked = await symlink(core.tmp.at('outside.html'), path.join(core.root, 'linked.html'), 'file').then(
      () => true,
      () => false,
    );

    const list = await listLooseHtml(core.root);
    assert.deepEqual(list.files.map((file) => file.name).sort(), ['one.html', 'two.HTM']);
    assert.equal(list.total, 2, linked ? 'the symlink is not counted' : 'symlinks unavailable: not exercised');
    const one = list.files.find((file) => file.name === 'one.html');
    assert.equal(one?.bytes, 8);
    assert.ok(one !== undefined && !Number.isNaN(Date.parse(one.mtime)));
  });

  test('newest first, at most 20 names, total counts every one of 250 files', async (t) => {
    const core = await createCore(t);
    t.after(() => core.stop());
    const base = Date.now() / 1000 - 10_000;
    for (let index = 0; index < 250; index += 1) {
      const file = path.join(core.root, `file-${String(index).padStart(3, '0')}.html`);
      await writeFile(file, 'x');
      await utimes(file, base + index, base + index);
    }
    const list = await listLooseHtml(core.root);
    assert.equal(list.total, 250);
    assert.equal(list.files.length, LOOSE_LIST_MAX);
    const mtimes = list.files.map((file) => Date.parse(file.mtime));
    assert.deepEqual(mtimes, [...mtimes].sort((a, b) => b - a), 'newest first');
    // Only the first 200 names (by name) are stat'ed, so the newest listed is file-199.
    assert.equal(list.files[0]?.name, 'file-199.html');
  });

  test('a missing root lists nothing', async (t) => {
    const core = await createCore(t);
    t.after(() => core.stop());
    assert.deepEqual(await listLooseHtml(path.join(core.root, 'not-there')), { files: [], total: 0 });
  });

  test('GET /designs reports them next to the designs', async (t) => {
    const core = await useServedCore(t);
    await writeFile(path.join(core.root, 'stray.html'), '<p>stray</p>');
    const list = await json<DesignListResponse>(await core.request('/designs'));
    assert.equal(list.loose.total, 1);
    assert.equal(list.loose.files[0]?.name, 'stray.html');
    assert.deepEqual(list.designs, []);
  });
});

describe('POST /loose/import', () => {
  test('makes a page whose index.html is byte-identical, titled from <title>, and moves the original to .trash', async (t) => {
    const core = await useServedCore(t);
    // Not valid UTF-8 on purpose: a decode/encode round trip would change these bytes.
    const bytes = Buffer.concat([Buffer.from('<html><head><title>Pricing page</title></head><body>'), Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]), Buffer.from('</body></html>')]);
    await writeFile(path.join(core.root, 'pricing.html'), bytes);

    const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'pricing.html' } });
    assert.equal(answer.status, 200);
    const result = await json<ImportLooseResponse>(answer);
    assert.equal(result.title, 'Pricing page');
    assert.equal(result.slug, 'pricing-page');
    assert.deepEqual(await readFile(path.join(core.root, result.slug, 'index.html')), bytes);

    assert.ok(result.originalMovedTo !== null);
    assert.equal(path.dirname(result.originalMovedTo), path.join(core.root, '.trash'));
    assert.match(path.basename(result.originalMovedTo), /^pricing-\d{14}\.html$/);
    assert.deepEqual(await readFile(result.originalMovedTo), bytes, 'the original is kept, unchanged');
    await assert.rejects(readFile(path.join(core.root, 'pricing.html')), { code: 'ENOENT' });

    const list = await json<DesignListResponse>(await core.request('/designs'));
    assert.deepEqual(list.loose, { files: [], total: 0 });
    const page = list.designs.find((design) => design.slug === result.slug);
    assert.equal(page?.kind, 'page');

    // Imported once: the second click finds nothing.
    const again = await core.request('/loose/import', { method: 'POST', body: { name: 'pricing.html' } });
    assert.equal(again.status, 404);
    assert.deepEqual(await errorOf(again), { error: 'not-found', message: 'That file is no longer in your designs folder.' });
  });

  test('without a <title> the stem names the page; .HTM keeps its own extension in .trash; a taken trash name gets a suffix', async (t) => {
    const core = await createCore(t);
    t.after(() => core.stop());
    const fixed = new Date(2026, 10, 1, 12, 0, 0);
    await mkdir(path.join(core.root, '.trash'));
    await writeFile(path.join(core.root, '.trash', 'launch-day-20261101120000.HTM'), 'older');
    await writeFile(path.join(core.root, 'launch-day.HTM'), '<h1>Launch</h1>');

    const result = await coreImporter(core, () => fixed).importFile('launch-day.HTM');
    assert.equal(result.title, 'Launch day');
    assert.equal(result.originalMovedTo, path.join(core.root, '.trash', 'launch-day-20261101120000-2.HTM'));
    assert.equal(await readFile(path.join(core.root, '.trash', 'launch-day-20261101120000.HTM'), 'utf8'), 'older', 'never overwritten');
    assert.equal(await readFile(path.join(core.root, result.slug, 'index.html'), 'utf8'), '<h1>Launch</h1>');
  });

  test('names outside the rule are refused with 400 and nothing on disk changes', async (t) => {
    const core = await useServedCore(t);
    await core.tmp.write('outside.html', '<p>outside the root</p>');
    await writeFile(path.join(core.root, 'x.html'), '<p>x</p>'); // a real x.html, which only the exact name may reach
    const names: unknown[] = [
      '../outside.html',
      '..\\outside.html',
      'a/b.html',
      'a\\b.html',
      '.x.html',
      'x.html\u0000',
      `${'a'.repeat(251)}.html`,
      core.tmp.at('outside.html'),
      42,
      null,
    ];
    for (const name of names) {
      const answer = await core.request('/loose/import', { method: 'POST', body: { name } });
      assert.equal(answer.status, 400, JSON.stringify(name));
      assert.equal((await errorOf(answer)).error, 'bad-request');
    }
    const missing = await core.request('/loose/import', { method: 'POST', body: {} });
    assert.equal(missing.status, 400);
    const notObject = await core.request('/loose/import', { method: 'POST', body: ['x.html'] });
    assert.equal(notObject.status, 400);

    assert.equal(await readFile(core.tmp.at('outside.html'), 'utf8'), '<p>outside the root</p>');
    assert.deepEqual(await designSlugs(core.root), []);
    assert.deepEqual(await trashEntries(core.root), []);
  });

  test('upper-case extensions are accepted', async (t) => {
    const core = await useServedCore(t);
    await writeFile(path.join(core.root, 'shout.HTML'), '<p>hi</p>');
    const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'shout.HTML' } });
    assert.equal(answer.status, 200);
    const result = await json<ImportLooseResponse>(answer);
    assert.equal(result.title, 'Shout');
  });

  test('a name not in the root, a folder named x.html and a symlink named x.html are 404, and nothing is read or created', async (t) => {
    const core = await useServedCore(t);
    await core.tmp.write('outside.html', '<title>Secret</title>');
    await mkdir(path.join(core.root, 'folder.html'));

    // Percent-escapes are not decoded: that is a legal (absent) file name, not a step up.
    for (const name of ['nope.html', 'folder.html', '%2e%2e%2foutside.html']) {
      const answer = await core.request('/loose/import', { method: 'POST', body: { name } });
      assert.equal(answer.status, 404, name);
      assert.deepEqual(await errorOf(answer), { error: 'not-found', message: 'That file is no longer in your designs folder.' });
    }

    if (await symlinkOrSkip(t, core.tmp.at('outside.html'), path.join(core.root, 'linked.html'))) {
      const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'linked.html' } });
      assert.equal(answer.status, 404);
      assert.equal(await readFile(core.tmp.at('outside.html'), 'utf8'), '<title>Secret</title>');
      assert.ok((await readdir(core.root)).includes('linked.html'), 'the link itself is not moved');
    }
    assert.deepEqual(await designSlugs(core.root), ['folder.html'], 'no page was created');
    assert.deepEqual(await trashEntries(core.root), []);
  });

  test('a file removed before the click is 404', async (t) => {
    const core = await useServedCore(t);
    await writeFile(path.join(core.root, 'gone.html'), '<p>gone</p>');
    const before = await json<DesignListResponse>(await core.request('/designs'));
    assert.equal(before.loose.total, 1);
    await rm(path.join(core.root, 'gone.html'));
    const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'gone.html' } });
    assert.equal(answer.status, 404);
    assert.deepEqual(await designSlugs(core.root), []);
  });

  test('a second import of the same file while the first runs is 409; exactly one page is made', async (t) => {
    const core = await createCore(t);
    t.after(() => core.stop());
    await writeFile(path.join(core.root, 'twice.html'), '<title>Twice</title>');
    const importer = coreImporter(core);
    const results = await Promise.allSettled([importer.importFile('twice.html'), importer.importFile('twice.html')]);
    assert.equal(results[0]?.status, 'fulfilled');
    assert.equal(results[1]?.status, 'rejected');
    const reason = results[1]?.status === 'rejected' ? (results[1].reason as unknown) : null;
    assert.ok(reason instanceof ApiError);
    assert.equal(reason.code, 'conflict');
    assert.equal(reason.message, 'That file is being imported already.');
    assert.deepEqual(await designSlugs(core.root), ['twice']);
  });

  test('over 20 MB is 413 and nothing is created or moved', async (t) => {
    const core = await useServedCore(t);
    const big = path.join(core.root, 'huge.html');
    const handle = await open(big, 'w');
    await handle.truncate(LOOSE_IMPORT_MAX_BYTES + 1); // sparse: no 20 MB actually written
    await handle.close();
    const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'huge.html' } });
    assert.equal(answer.status, 413);
    assert.deepEqual(await errorOf(answer), {
      error: 'too-large',
      message: "That file is over 20 MB, so it can't be imported. Move it into a design folder by hand.",
    });
    assert.deepEqual(await designSlugs(core.root), []);
    assert.deepEqual(await trashEntries(core.root), []);
    assert.ok((await readdir(core.root)).includes('huge.html'));
  });

  test('when the copy fails the half-made page goes to .trash and the original is untouched', async (t) => {
    const core = await useServedCore(t);
    await writeFile(path.join(core.root, 'stuck.html'), '<title>Stuck</title>');
    // index.html already a folder: the final rename of the copy fails on every OS.
    const unhook = core.store.onCreate(async (record) => {
      await mkdir(path.join(record.path, 'index.html'));
    });
    t.after(unhook);

    const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'stuck.html' } });
    assert.equal(answer.status, 500);
    assert.deepEqual(await errorOf(answer), {
      error: 'internal',
      message: "Design Chamber couldn't copy stuck.html into a new page, so the original is still in your designs folder. Try again.",
    });
    assert.equal(await readFile(path.join(core.root, 'stuck.html'), 'utf8'), '<title>Stuck</title>');
    assert.deepEqual(await designSlugs(core.root), [], 'no half-made page left in the list');
    const trashed = await trashEntries(core.root);
    assert.equal(trashed.length, 1);
    assert.match(trashed[0] ?? '', /^stuck-\d{14}$/, 'the half-made page folder, not the original');
    assert.ok(core.logs.some((line) => line.event === 'loose.copy-failed'));
  });

  test('when the move to .trash fails the page is still made, originalMovedTo is null and both copies remain', async (t) => {
    const core = await useServedCore(t);
    await writeFile(path.join(core.root, '.trash'), 'a file where the trash folder should be');
    await writeFile(path.join(core.root, 'kept.html'), '<title>Kept</title>');

    const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'kept.html' } });
    assert.equal(answer.status, 200);
    const result = await json<ImportLooseResponse>(answer);
    assert.equal(result.originalMovedTo, null);
    assert.equal(await readFile(path.join(core.root, 'kept.html'), 'utf8'), '<title>Kept</title>');
    assert.equal(await readFile(path.join(core.root, result.slug, 'index.html'), 'utf8'), '<title>Kept</title>');
    assert.ok(core.logs.some((line) => line.event === 'loose.trash-failed'));
  });

  test('a .trash that is a symlink out of the root is never written through', async (t) => {
    const core = await useServedCore(t);
    const elsewhere = core.tmp.at('elsewhere');
    await mkdir(elsewhere);
    await writeFile(path.join(core.root, 'escape.html'), '<title>Escape</title>');
    try {
      await symlink(elsewhere, path.join(core.root, '.trash'), 'dir');
    } catch (error) {
      t.skip(`symlinks unavailable here: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
      return;
    }
    const result = await json<ImportLooseResponse>(await core.request('/loose/import', { method: 'POST', body: { name: 'escape.html' } }));
    assert.equal(result.originalMovedTo, null);
    assert.deepEqual(await readdir(elsewhere), []);
    assert.equal(await readFile(path.join(core.root, 'escape.html'), 'utf8'), '<title>Escape</title>');
  });

  test('a missing or wrong token is 401 and nothing is imported', async (t) => {
    const core = await useServedCore(t);
    await writeFile(path.join(core.root, 'locked.html'), '<p>locked</p>');
    for (const token of [null, 'wrong'] as const) {
      const answer = await core.request('/loose/import', { method: 'POST', body: { name: 'locked.html' }, token });
      assert.equal(answer.status, 401);
      assert.equal((await errorOf(answer)).error, 'unauthorized');
    }
    assert.ok((await readdir(core.root)).includes('locked.html'));
    assert.deepEqual(await designSlugs(core.root), []);
  });
});
