// `.chamber/edits.json` (Phase 2 technical design §2.1, §7.1, AD-5, AD-7): validated shapes only,
// one writer per design through the update queue, a file that always reads back.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { EDITS_FILE_MAX_BYTES, HAND_EDITS_LEDGER_MAX, USER_UNDO_KEEP, USER_UNDO_TTL_MS } from '../../../src/shared/limits.ts';
import type { HandEdit } from '../../../src/shared/types.ts';
import {
  appendEdit,
  applyUndone,
  clearLedger,
  createEditsFile,
  emptyEditsFile,
  parseEditsFile,
  parseHandEdit,
  parseUndoStep,
  serializeEditsFile,
  type EditsFile,
  type NewEdit,
  type UndoStep,
} from '../../../src/service/edits/file.ts';
import { ApiError } from '../../../src/service/http.ts';
import { LINK_SENTENCE } from '../../../src/service/paths.ts';
import type { Logger } from '../../../src/service/context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const AT = '2026-11-11T12:00:00.000Z';
const NOW = Date.parse(AT);

const splice = (removed = 'Ship faster'): UndoStep => ({ kind: 'splice', file: 'screens/home.html', start: 10, inserted: 14, removed, afterSha: SHA_A, beforeSha: SHA_B });

const newEdit = (n: number, overrides: Partial<NewEdit> = {}): NewEdit => ({
  editId: `e_${String(n).padStart(8, '0')}`,
  at: AT,
  label: `Text updated in Home ${n}`,
  body: { kind: 'text', file: 'screens/home.html', screen: 'Home', before: 'Ship faster', after: `Ship it ${n}` },
  steps: [splice()],
  ...overrides,
});

type LogLine = { level: string; event: string; fields: unknown };
const captureLog = (): { log: Logger; lines: LogLine[] } => {
  const lines: LogLine[] = [];
  const push = (level: string) => (event: string, fields?: unknown) => void lines.push({ level, event, fields });
  return { log: { info: push('info'), warn: push('warn'), error: push('error') }, lines };
};

describe('parseHandEdit: structured, validated fields only (AD-7)', () => {
  test('every kind validates; quotes are one-lined and clipped to 80', () => {
    const base = { seq: 1, at: AT, editId: 'e_abcdefgh' };
    const text = parseHandEdit({ ...base, kind: 'text', file: 'index.html', screen: null, before: 'line one\nline two', after: 'x'.repeat(200) });
    assert.ok(text && text.kind === 'text');
    assert.equal(text.before, 'line one line two');
    assert.equal(text.after.length, 80);
    for (const entry of [
      { kind: 'tweaks', changes: [{ label: 'Accent hue', before: '210', after: '250' }] },
      { kind: 'reorder', moved: 'Checkout', above: null },
      { kind: 'reorder-many', order: ['Home', 'Checkout'] },
      { kind: 'duplicate', screen: 'Home', copy: 'Home copy', file: 'screens/home-copy.html' },
      { kind: 'trash', screen: 'Pricing', file: 'screens/pricing.html' },
      { kind: 'keep', screen: 'Home', letter: 'B', name: 'Editorial' },
      { kind: 'keep', screen: 'Home', letter: null, name: null },
      { kind: 'undo', of: 'Text updated in Home' },
    ]) {
      assert.ok(parseHandEdit({ ...base, ...entry }), entry.kind);
    }
  });

  test('a tampered entry is dropped: paths outside the writable set, bad ids, bad letters, unknown kinds', () => {
    const base = { seq: 1, at: AT, editId: 'e_abcdefgh', kind: 'text', screen: null, before: 'a', after: 'b' };
    for (const file of ['../x.html', '/etc/passwd', 'assets/logo.png', '.chamber/state.json', 'DESIGN.md', 'screens/../index.html', 'C:\\x.html']) {
      assert.equal(parseHandEdit({ ...base, file }), null, file);
    }
    assert.equal(parseHandEdit({ ...base, file: 'index.html', editId: 'nope' }), null);
    assert.equal(parseHandEdit({ ...base, file: 'index.html', seq: 0 }), null);
    assert.equal(parseHandEdit({ ...base, file: 'index.html', at: 'yesterday' }), null);
    assert.equal(parseHandEdit({ seq: 1, at: AT, editId: 'e_abcdefgh', kind: 'keep', screen: 'Home', letter: 'E', name: null }), null);
    assert.equal(parseHandEdit({ seq: 1, at: AT, editId: 'e_abcdefgh', kind: 'shell', command: 'rm -rf' }), null);
  });
});

describe('parseUndoStep: an undo can only name this design editable files and its own trash', () => {
  test('valid shapes pass', () => {
    assert.ok(parseUndoStep(splice(), 'demo'));
    assert.ok(parseUndoStep({ kind: 'move', from: 'screens/pricing.html', to: '.trash/demo.pricing-20261111120000.html', sha: SHA_A }, 'demo'));
    assert.ok(parseUndoStep({ kind: 'move', from: 'screens/pricing.html', to: '.trash/demo.pricing-20261111120000-2.html', sha: SHA_A }, 'demo'));
    assert.ok(parseUndoStep({ kind: 'move', from: 'screens/home-b.html', to: 'screens/home.html', sha: SHA_A }, 'demo'));
    assert.ok(parseUndoStep({ kind: 'create', file: 'screens/home-copy.html', sha: SHA_A }, 'demo'));
    assert.ok(parseUndoStep({ kind: 'screens', before: [{ id: 'home' }], afterStamp: SHA_A }, 'demo'));
    assert.ok(parseUndoStep({ kind: 'comments', moves: [{ id: 'c_abcd', from: 'home-b', to: 'home' }] }, 'demo'));
  });

  test('another design trash entry, a path step out, or a non-screen create is refused', () => {
    for (const to of ['.trash/other.pricing-20261111120000.html', '.trash/../x.html', '../x.html', '/tmp/x.html', '.trash/demo-20261111120000/index.html', '.versions/index.json']) {
      assert.equal(parseUndoStep({ kind: 'move', from: 'screens/pricing.html', to, sha: SHA_A }, 'demo'), null, to);
    }
    assert.equal(parseUndoStep({ kind: 'move', from: '.trash/demo.pricing-20261111120000.html', to: 'screens/x.html', sha: SHA_A }, 'demo'), null, 'a trash entry is never a forward source');
    assert.equal(parseUndoStep({ kind: 'create', file: 'index.html', sha: SHA_A }, 'demo'), null);
    assert.equal(parseUndoStep({ kind: 'splice', file: 'assets/a.css', start: 0, inserted: 0, removed: '', afterSha: SHA_A, beforeSha: SHA_B }, 'demo'), null);
    assert.equal(parseUndoStep({ ...splice(), start: -1 }, 'demo'), null);
    assert.equal(parseUndoStep({ kind: 'screens', before: 'not a list', afterStamp: SHA_A }, 'demo'), null);
    assert.equal(parseUndoStep({ kind: 'comments', moves: [{ id: 'x', from: 'home', to: 'b' }] }, 'demo'), null);
  });
});

describe('parseEditsFile', () => {
  test('keeps what validates, counts what it dropped, never lets seq fall below a handed-out entry', () => {
    const good = parseHandEdit({ seq: 4, at: AT, editId: 'e_abcdefgh', kind: 'undo', of: 'x' });
    const { file, damaged } = parseEditsFile(
      {
        v: 1,
        seq: 2,
        ledger: [good, { seq: 3, kind: 'bogus' }, { ...good, seq: 4 }],
        dropped: 0,
        undo: [{ id: 'e_abcdefgh', at: AT, label: 'L', ledgerSeq: 4, steps: [splice()] }, { id: 'e_abcdefgh', at: AT, label: 'dup', ledgerSeq: null, steps: [splice()] }, { id: 'bad' }],
      },
      'demo',
    );
    assert.equal(file.seq, 4);
    assert.equal(file.ledger.length, 1);
    assert.equal(file.undo.length, 1);
    assert.equal(damaged, 4, 'the bogus entry, the repeated seq, the duplicate id, the bad record');
  });

  test('a wrong version or a non-object reads as empty', () => {
    assert.deepEqual(parseEditsFile({ v: 2 }, 'demo').file, emptyEditsFile());
    assert.deepEqual(parseEditsFile([1, 2], 'demo').file, emptyEditsFile());
  });
});

describe('pure updates', () => {
  test('appendEdit hands out monotonic seqs, caps the ledger (dropped counts the rest) and the undo list', () => {
    let file = emptyEditsFile();
    for (let n = 1; n <= HAND_EDITS_LEDGER_MAX + 5; n += 1) file = appendEdit(file, newEdit(n), NOW);
    assert.equal(file.seq, HAND_EDITS_LEDGER_MAX + 5);
    assert.equal(file.ledger.length, HAND_EDITS_LEDGER_MAX);
    assert.equal(file.ledger[0]?.seq, 6);
    assert.equal(file.dropped, 5);
    assert.equal(file.undo.length, USER_UNDO_KEEP);
    assert.equal(file.undo.at(-1)?.ledgerSeq, file.seq);
  });

  test('an undo record older than the TTL is pruned on the next append', () => {
    let file = appendEdit(emptyEditsFile(), newEdit(1), NOW);
    file = appendEdit(file, newEdit(2, { at: new Date(NOW + USER_UNDO_TTL_MS + 1).toISOString() }), NOW + USER_UNDO_TTL_MS + 1);
    assert.deepEqual(file.undo.map((record) => record.id), ['e_00000002']);
  });

  test('a ledger body that does not validate adds no entry, and the undo record says so', () => {
    const body = { kind: 'text', file: '../../etc/passwd', screen: null, before: 'a', after: 'b' } as unknown as NewEdit['body']; // Safe: a module bug, on purpose
    const file = appendEdit(emptyEditsFile(), newEdit(1, { body }), NOW);
    assert.deepEqual(file.ledger, []);
    assert.equal(file.seq, 0);
    assert.equal(file.undo[0]?.ledgerSeq, null);
  });

  test('undo removes an unsent entry, but appends an "undo" entry once the edit was sent', () => {
    const one = appendEdit(emptyEditsFile(), newEdit(1), NOW);
    const record = one.undo[0];
    assert.ok(record);
    const unsent = applyUndone(one, record, AT, NOW);
    assert.deepEqual(unsent.ledger, []);
    assert.deepEqual(unsent.undo, []);

    const sent = clearLedger(one, 1);
    const after = applyUndone(sent, record, AT, NOW);
    assert.deepEqual(
      after.ledger.map((entry: HandEdit) => [entry.seq, entry.kind]),
      [[2, 'undo']],
    );
  });

  test('clear removes entries up to upTo, is idempotent, refuses a position never handed out, resets dropped', () => {
    let file = emptyEditsFile();
    for (let n = 1; n <= HAND_EDITS_LEDGER_MAX + 2; n += 1) file = appendEdit(file, newEdit(n), NOW);
    const cleared = clearLedger(file, 10);
    assert.equal(cleared.ledger[0]?.seq, 11);
    assert.equal(cleared.dropped, 0);
    assert.equal(clearLedger(cleared, 10), cleared, 'idempotent');
    assert.throws(() => clearLedger(file, file.seq + 1), (error: unknown) => error instanceof ApiError && error.code === 'bad-request');
    assert.throws(() => clearLedger(file, 0), (error: unknown) => error instanceof ApiError && error.code === 'bad-request');
  });

  test('the written file always fits the read cap: oldest undo records go first', () => {
    let file: EditsFile = emptyEditsFile();
    for (let n = 1; n <= USER_UNDO_KEEP; n += 1) file = appendEdit(file, newEdit(n, { steps: [splice('é'.repeat(39_000))] }), NOW);
    const { text, file: written } = serializeEditsFile(file);
    assert.ok(Buffer.byteLength(text) <= EDITS_FILE_MAX_BYTES);
    assert.ok(written.undo.length < USER_UNDO_KEEP);
    assert.equal(written.undo.at(-1)?.id, `e_${String(USER_UNDO_KEEP).padStart(8, '0')}`, 'the newest record is kept');
    assert.equal(written.ledger.length, USER_UNDO_KEEP, 'the ledger is never cut to fit');
  });
});

const designFolder = async (t: TestContext): Promise<{ dir: string; root: string }> => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'design.json': { version: 1, kind: 'page', title: 'Demo' } });
  return { dir, root: tmp.root };
};

describe('createEditsFile: the per-slug queue', () => {
  test('read: absent, too large and not JSON all read as empty (logged without content)', async (t) => {
    const { dir } = await designFolder(t);
    const { log, lines } = captureLog();
    const edits = createEditsFile({ log });
    assert.deepEqual(await edits.read('demo', dir), emptyEditsFile());
    await mkdir(path.join(dir, '.chamber'), { recursive: true });
    await writeFile(path.join(dir, '.chamber', 'edits.json'), '{ secret text not json');
    assert.deepEqual(await edits.read('demo', dir), emptyEditsFile());
    await writeFile(path.join(dir, '.chamber', 'edits.json'), ' '.repeat(EDITS_FILE_MAX_BYTES + 1));
    assert.deepEqual(await edits.read('demo', dir), emptyEditsFile());
    assert.equal(lines.filter((line) => line.event === 'edits.file-unreadable').length, 2);
    assert.doesNotMatch(JSON.stringify(lines), /secret text/);
  });

  test('update writes atomically and the next read sees it; the next write replaces a damaged file', async (t) => {
    const { dir } = await designFolder(t);
    const edits = createEditsFile({ log: captureLog().log });
    await mkdir(path.join(dir, '.chamber'));
    await writeFile(path.join(dir, '.chamber', 'edits.json'), 'garbage');
    const written = await edits.update('demo', dir, (file) => appendEdit(file, newEdit(1), NOW));
    assert.equal(written.seq, 1);
    assert.deepEqual(await edits.read('demo', dir), written);
    assert.equal(JSON.parse(await readFile(path.join(dir, '.chamber', 'edits.json'), 'utf8')).v, 1);
  });

  test('a .chamber link reads as empty and every write refuses, writing nothing through it', async (t) => {
    const { dir } = await designFolder(t);
    const elsewhere = path.join(dir, 'assets');
    await mkdir(elsewhere);
    await symlink(elsewhere, path.join(dir, '.chamber'), 'junction');
    const { log, lines } = captureLog();
    const edits = createEditsFile({ log });
    assert.deepEqual(await edits.read('demo', dir), emptyEditsFile());
    await assert.rejects(
      edits.update('demo', dir, (file) => appendEdit(file, newEdit(1), NOW)),
      (error: unknown) => error instanceof ApiError && error.message === LINK_SENTENCE,
    );
    await assert.rejects(stat(path.join(elsewhere, 'edits.json')), { code: 'ENOENT' });
    assert.ok(lines.some((line) => line.event === 'edits.file-link'));
  });

  test('an edits.json that is itself a link is refused the same way', async (t) => {
    const { dir } = await designFolder(t);
    await mkdir(path.join(dir, '.chamber'));
    await writeFile(path.join(dir, 'index.html'), '<h1>keep me</h1>');
    await symlink(path.join(dir, 'index.html'), path.join(dir, '.chamber', 'edits.json'));
    const edits = createEditsFile({ log: captureLog().log });
    await assert.rejects(edits.update('demo', dir, (file) => appendEdit(file, newEdit(1), NOW)), { message: LINK_SENTENCE });
    assert.equal(await readFile(path.join(dir, 'index.html'), 'utf8'), '<h1>keep me</h1>');
  });

  test('a design folder removed meanwhile is never re-created', async (t) => {
    const { dir } = await designFolder(t);
    await rm(dir, { recursive: true });
    const edits = createEditsFile({ log: captureLog().log });
    await assert.rejects(edits.update('demo', dir, (file) => appendEdit(file, newEdit(1), NOW)), { code: 'not-found' });
    await assert.rejects(stat(dir), { code: 'ENOENT' });
  });

  // The CRITICAL race (§17): a clear and an edit's append started together. Each re-reads inside
  // the queue, so neither writes over the other, in either order.
  for (const order of ['append first', 'clear first'] as const) {
    test(`concurrent clear + append (${order}) keeps the new undo record, the new entry, and the cleared entries cleared`, async (t) => {
      const { dir } = await designFolder(t);
      const edits = createEditsFile({ log: captureLog().log });
      await edits.update('demo', dir, (file) => appendEdit(appendEdit(file, newEdit(1), NOW), newEdit(2), NOW));
      const append = (): Promise<EditsFile> => edits.update('demo', dir, (file) => appendEdit(file, newEdit(3), NOW));
      const clear = (): Promise<EditsFile> => edits.update('demo', dir, (file) => clearLedger(file, 2));
      await Promise.all(order === 'append first' ? [append(), clear()] : [clear(), append()]);
      const file = await edits.read('demo', dir);
      assert.deepEqual(file.ledger.map((entry) => entry.seq), [3], 'entries 1 and 2 stay cleared, entry 3 is there');
      assert.deepEqual(file.undo.map((record) => record.id), ['e_00000001', 'e_00000002', 'e_00000003'], 'every undo record survives');
    });
  }

  test('a failed mutate leaves the file and does not block the queue', async (t) => {
    const { dir } = await designFolder(t);
    const edits = createEditsFile({ log: captureLog().log });
    await edits.update('demo', dir, (file) => appendEdit(file, newEdit(1), NOW));
    await assert.rejects(edits.update('demo', dir, (file) => clearLedger(file, 99)), { code: 'bad-request' });
    const after = await edits.update('demo', dir, (file) => appendEdit(file, newEdit(2), NOW));
    assert.equal(after.seq, 2);
  });
});
