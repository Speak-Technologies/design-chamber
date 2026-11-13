// The text op through the real pipeline (Phase 2 technical design §3.4; PS 08, E2, E4 to E7, E9).
// Risk tests: E5 (every byte outside the edited run survives: CRLF, a BOM, comments, attribute
// quoting, indentation and untouched entities), E6 (typed markup stays text), the stale refusal,
// the file-level refusals (link inside the design as a leaf and as a folder, too large, not
// UTF-8), and undo putting back the exact prior bytes.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, test, type TestContext } from 'node:test';

import type { EditResponse, EditTarget } from '../../../src/shared/api.ts';
import { SOURCE_TEXT_MAX } from '../../../src/shared/limits.ts';
import { scanHtml } from '../../../src/shared/source-edit.ts';
import type { VersionEntry } from '../../../src/shared/types.ts';
import { BAD_EDIT_MESSAGE, createEditService, STALE_MESSAGES, type EditService } from '../../../src/service/edits/pipeline.ts';
import {
  BAD_CHARACTERS_MESSAGE,
  CANT_PLACE_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  NOT_UTF8_MESSAGE,
  TEXT_BAD_EDIT_MESSAGE,
  TEXT_STALE_MESSAGE,
} from '../../../src/service/edits/ops-text.ts';
import { ApiError } from '../../../src/service/http.ts';
import { LINK_SENTENCE } from '../../../src/service/paths.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { canvasDesign, pageDesign } from '../render/harness.ts';

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const START = Date.parse('2026-11-11T12:00:00.000Z');

type Rig = { tmp: TmpRoot; ctx: FakeContext; edits: EditService };

/** The real service: the shipped op map (the real text op), real versions and edits.json. */
const setup = async (t: TestContext): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 600_000, now: () => START });
  const edits = createEditService({
    store: ctx.store,
    versions,
    hub: ctx.hub,
    selfWrites: ctx.selfWrites,
    settings: ctx.settings,
    log: ctx.log,
    now: () => new Date(START),
    pause: async () => undefined,
  });
  return { tmp, ctx, edits };
};

const bytesOf = (tmp: TmpRoot, rel: string): Promise<Buffer> => readFile(tmp.at(rel));

type Ask = { tag?: string; id?: string | null; target?: string; sameIndex?: number; sameCount?: number; screen?: string | null; base?: string };

/** A text request as the page sends it: the probe's target and the editor's before/after. */
const textEdit = async (rig: Rig, slug: string, rel: string, before: string, after: string, ask: Ask = {}): Promise<EditResponse> => {
  const target: EditTarget = { tag: ask.tag ?? 'h1', id: ask.id ?? null, text: ask.target ?? before, sameIndex: ask.sameIndex ?? 0, sameCount: ask.sameCount ?? 1 };
  const base = ask.base ?? sha256(await bytesOf(rig.tmp, `${slug}/${rel}`));
  return rig.edits.apply(slug, { op: 'text', screen: ask.screen ?? null, base, target, before, after });
};

const versionsOf = async (tmp: TmpRoot, slug: string): Promise<VersionEntry[]> => {
  const text = await readFile(tmp.at(`${slug}/.versions/index.json`), 'utf8').catch(() => null);
  return text === null ? [] : (JSON.parse(text) as { versions: VersionEntry[] }).versions;
};

const rejectsWith = (code: string, message: string) => (error: unknown): boolean => {
  assert.ok(error instanceof ApiError, String(error));
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  return true;
};

/** Refused before the version: the file's bytes are as they were and Versions is empty. */
const assertNothingWritten = async (rig: Rig, slug: string, rel: string, original: Buffer): Promise<void> => {
  assert.ok((await bytesOf(rig.tmp, `${slug}/${rel}`)).equals(original), 'the file is byte for byte as it was');
  assert.deepEqual(await versionsOf(rig.tmp, slug), [], 'no version was taken');
  assert.equal(rig.ctx.events.filter((event) => event.origin === 'user').length, 0, 'no user event');
};

const pageWith = async (rig: Rig, html: string | Uint8Array, slug = 'art'): Promise<Buffer> => {
  await rig.tmp.writeDesign(slug, pageDesign({ 'index.html': html }));
  return bytesOf(rig.tmp, `${slug}/index.html`);
};

// A Windows-saved file: BOM, CRLF, a comment, mixed attribute quoting, indentation, entities.
const E5_FIXTURE =
  '﻿<!doctype html>\r\n' +
  '<html lang=en>\r\n' +
  '<head><title>Fish &amp; chips</title></head>\r\n' +
  '<body class="page"  data-x=\'1\'>\r\n' +
  '  <!-- the agent left this -->\r\n' +
  '  <h1 id="hero">\r\n' +
  '    Fish &amp; chips,\r\n' +
  '    every&nbsp;Friday &copy; 2026\r\n' +
  '  </h1>\r\n' +
  '  <p>Ship faster</p>\r\n' +
  '</body>\r\n' +
  '</html>\r\n';

describe('E5: only the edited run changes', () => {
  test('a word in an indented, multi-line, entity-laden element: every other byte survives, and undo restores the exact bytes', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, E5_FIXTURE);
    const before = 'Fish & chips, every Friday © 2026';
    // The frame's text is normalizeText(textContent), whose \s also folds the U+00A0; the editor keeps it.
    const answer = await textEdit(rig, 'art', 'index.html', before, 'Fish & chips, every Saturday © 2026', { id: 'hero', target: 'Fish & chips, every Friday © 2026' });

    const expected = Buffer.from(E5_FIXTURE.replace('every&nbsp;Friday', 'every&nbsp;Saturday'), 'utf8');
    const written = await bytesOf(rig.tmp, 'art/index.html');
    assert.ok(written.equals(expected), `byte-exact: ${JSON.stringify(written.toString('utf8'))}`);
    assert.deepEqual([...written.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM is kept');
    assert.equal(answer.edit.label, 'Text updated in Test artifact');
    assert.deepEqual(answer.edit.files, ['index.html']);
    assert.equal(answer.edit.undoable, true);
    assert.deepEqual(answer.stamps, { file: sha256(expected) });
    assert.equal(answer.edit.detail, undefined, 'a text edit has no second notice line');

    await rig.edits.undo('art', answer.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/index.html')).equals(original), 'undo puts back exactly the bytes from before');
  });

  test('an untouched &amp; keeps its spelling; a change next to it does not decode it', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, '<h1>Fish &amp; chips</h1>\n');
    await textEdit(rig, 'art', 'index.html', 'Fish & chips', 'Fish & peas');
    assert.equal(await rig.tmp.read('art/index.html'), '<h1>Fish &amp; peas</h1>\n');
  });

  test('a change in the middle of a run of whitespace-collapsed lines keeps the line breaks around it', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, '<p>\r\n\tOne\r\n\tTwo\r\n\tThree\r\n</p>\r\n');
    await textEdit(rig, 'art', 'index.html', 'One Two Three', 'One 2 Three', { tag: 'p' });
    assert.equal(await rig.tmp.read('art/index.html'), '<p>\r\n\tOne\r\n\t2\r\n\tThree\r\n</p>\r\n');
  });

  test('emoji and a non-breaking space round-trip; undo restores the bytes', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, '<h1>Ready \u{1F680} go</h1>');
    const answer = await textEdit(rig, 'art', 'index.html', 'Ready \u{1F680} go', 'Ready \u{1F6F8} go');
    assert.equal(await rig.tmp.read('art/index.html'), '<h1>Ready \u{1F6F8} go</h1>');
    await rig.edits.undo('art', answer.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/index.html')).equals(original));
  });

  test('empty text is allowed: the element stays with its whitespace, and undo brings the words back', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, '<p>\n  Ship faster\n</p>');
    const answer = await textEdit(rig, 'art', 'index.html', 'Ship faster', '', { tag: 'p' });
    assert.equal(await rig.tmp.read('art/index.html'), '<p>\n  \n</p>');
    await rig.edits.undo('art', answer.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/index.html')).equals(original));
  });
});

describe('E6: typed text stays text', () => {
  test('</p><script> is written escaped, adds no element, and undo restores the bytes', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, '<body><p>Ship faster</p></body>');
    const typed = 'Ship </p><script>alert(1)</script> & faster';
    const answer = await textEdit(rig, 'art', 'index.html', 'Ship faster', typed, { tag: 'p' });
    const written = await rig.tmp.read('art/index.html');
    assert.equal(written, '<body><p>Ship &lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; faster</p></body>');
    assert.deepEqual(scanHtml(written).elements.map((element) => element.tag), ['body', 'p'], 'no script element, no closed paragraph');
    await rig.edits.undo('art', answer.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/index.html')).equals(original));
  });
});

describe('the target file (§3.4 step 1) and the ledger', () => {
  test('a canvas screen: its file, "Text updated in <screen>", and the ledger names the screen', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('wall', canvasDesign());
    const answer = await textEdit(rig, 'wall', 'screens/home.html', 'home', 'Home, sweet', { screen: 'home' });
    assert.match(await rig.tmp.read('wall/screens/home.html'), /<h1>Home, sweet<\/h1>/);
    assert.match(await rig.tmp.read('wall/screens/checkout.html'), /<h1>checkout<\/h1>/, 'the other screen is untouched');
    assert.equal(answer.edit.label, 'Text updated in Home');
    assert.deepEqual(answer.edit.files, ['screens/home.html']);
    const file = JSON.parse(await rig.tmp.read('wall/.chamber/edits.json')) as { ledger: Record<string, unknown>[] };
    assert.deepEqual(file.ledger.map(({ kind, file: rel, screen, before, after }) => ({ kind, file: rel, screen, before, after })), [
      { kind: 'text', file: 'screens/home.html', screen: 'Home', before: 'home', after: 'Home, sweet' },
    ]);
  });

  test('a page edit records screen null and quotes clipped to 80 characters', async (t) => {
    const rig = await setup(t);
    const long = 'x'.repeat(200);
    await pageWith(rig, `<h1>${long}</h1>`);
    await textEdit(rig, 'art', 'index.html', long, 'short');
    const file = JSON.parse(await rig.tmp.read('art/.chamber/edits.json')) as { ledger: { screen: unknown; before: string; after: string }[] };
    assert.equal(file.ledger[0]?.screen, null);
    assert.equal(file.ledger[0]?.before.length, 80);
    assert.equal(file.ledger[0]?.after, 'short');
  });

  test('a screen that does not fit the design is a bad request: null on a canvas, an id on a page, an unlisted id', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('wall', canvasDesign());
    const home = await bytesOf(rig.tmp, 'wall/screens/home.html');
    for (const screen of [null, 'pricing']) {
      await assert.rejects(textEdit(rig, 'wall', 'screens/home.html', 'home', 'x', { screen }), rejectsWith('bad-request', TEXT_BAD_EDIT_MESSAGE));
    }
    await assertNothingWritten(rig, 'wall', 'screens/home.html', home);
    const page = await pageWith(rig, '<h1>hello</h1>');
    await assert.rejects(textEdit(rig, 'art', 'index.html', 'hello', 'x', { screen: 'home' }), rejectsWith('bad-request', TEXT_BAD_EDIT_MESSAGE));
    await assertNothingWritten(rig, 'art', 'index.html', page);
  });

  test('the op sentences are the pipeline sentences', () => {
    assert.equal(TEXT_STALE_MESSAGE, STALE_MESSAGES.text);
    assert.equal(TEXT_BAD_EDIT_MESSAGE, BAD_EDIT_MESSAGE);
  });
});

describe('E4: stale refusal', () => {
  test('a base hash that is not the file on disk is refused before the version, with the text stale sentence', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, '<h1>Ship faster</h1>');
    const read = sha256(original);
    await writeFile(rig.tmp.at('art/index.html'), '<h1>Ship faster</h1><!-- the agent -->');
    const now = await bytesOf(rig.tmp, 'art/index.html');
    await assert.rejects(textEdit(rig, 'art', 'index.html', 'Ship faster', 'Ship it', { base: read }), rejectsWith('stale', TEXT_STALE_MESSAGE));
    await assertNothingWritten(rig, 'art', 'index.html', now);
  });

  test('a screen file removed since the page read it is stale, not a disk error', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('wall', canvasDesign());
    const base = sha256(await bytesOf(rig.tmp, 'wall/screens/home.html'));
    await rm(rig.tmp.at('wall/screens/home.html'));
    await assert.rejects(textEdit(rig, 'wall', 'screens/home.html', 'home', 'x', { screen: 'home', base }), rejectsWith('stale', TEXT_STALE_MESSAGE));
    assert.deepEqual(await versionsOf(rig.tmp, 'wall'), []);
  });
});

describe('file-level refusals (§3.3 order: link, size, encoding)', () => {
  test('an entry file that is a link to another file inside the design is refused; its target is untouched', async (t) => {
    const rig = await setup(t);
    const other = await pageWith(rig, '<h1>Ship faster</h1>');
    await rename(rig.tmp.at('art/index.html'), rig.tmp.at('art/other.html'));
    await symlink(rig.tmp.at('art/other.html'), rig.tmp.at('art/index.html'));
    await assert.rejects(textEdit(rig, 'art', 'index.html', 'Ship faster', 'x'), rejectsWith('invalid', LINK_SENTENCE));
    await assertNothingWritten(rig, 'art', 'other.html', other);
  });

  test('a screens folder that is a link to another folder inside the design is refused', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('wall', canvasDesign());
    const home = await bytesOf(rig.tmp, 'wall/screens/home.html');
    await rename(rig.tmp.at('wall/screens'), rig.tmp.at('wall/real-screens'));
    await symlink(rig.tmp.at('wall/real-screens'), rig.tmp.at('wall/screens'));
    await assert.rejects(textEdit(rig, 'wall', 'screens/home.html', 'home', 'x', { screen: 'home' }), rejectsWith('invalid', LINK_SENTENCE));
    await assertNothingWritten(rig, 'wall', 'real-screens/home.html', home);
  });

  test('a screen file that links out of the Designs folder answers the link sentence too', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('wall', canvasDesign());
    const outside = await useTmpRoot(t, 'dc-outside-');
    await outside.write('home.html', '<h1>home</h1>');
    await rm(rig.tmp.at('wall/screens/home.html'));
    await symlink(outside.at('home.html'), rig.tmp.at('wall/screens/home.html'));
    await assert.rejects(textEdit(rig, 'wall', 'screens/home.html', 'home', 'x', { screen: 'home', base: sha256('<h1>home</h1>') }), rejectsWith('invalid', LINK_SENTENCE));
    assert.equal(await outside.read('home.html'), '<h1>home</h1>');
  });

  test(`a file over ${SOURCE_TEXT_MAX} characters is refused as too large`, async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, `<h1>Ship faster</h1>${'x'.repeat(SOURCE_TEXT_MAX)}`);
    await assert.rejects(textEdit(rig, 'art', 'index.html', 'Ship faster', 'x'), rejectsWith('too-large', FILE_TOO_LARGE_MESSAGE));
    await assertNothingWritten(rig, 'art', 'index.html', original);
  });

  test('a file that is not plain UTF-8 is refused', async (t) => {
    const rig = await setup(t);
    const latin1 = Buffer.concat([Buffer.from('<h1>Caf'), Buffer.from([0xe9]), Buffer.from('</h1><h2>Ship faster</h2>')]);
    const original = await pageWith(rig, latin1);
    await assert.rejects(textEdit(rig, 'art', 'index.html', 'Ship faster', 'x', { tag: 'h2' }), rejectsWith('invalid', NOT_UTF8_MESSAGE));
    await assertNothingWritten(rig, 'art', 'index.html', original);
  });
});

describe('E2: the source decides, and refuses rather than guesses', () => {
  const cases: { name: string; html: string; before: string; ask?: Ask }[] = [
    { name: 'text the page script made (not in the source)', html: '<h1>Loading</h1>', before: 'Loading', ask: { target: 'Welcome back' } },
    { name: 'formatting inside', html: '<p>Ship <b>faster</b></p>', before: 'Ship faster', ask: { tag: 'p' } },
    { name: 'two same leaves the frame counted differently', html: '<a>More</a><a>More</a>', before: 'More', ask: { tag: 'a', sameIndex: 0, sameCount: 3 } },
    { name: 'implied end tags', html: '<ul><li>One<li>Two</ul>', before: 'One', ask: { tag: 'li' } },
    { name: 'an unknown entity', html: '<h1>Caf&eacute;</h1>', before: 'Café' },
    { name: 'a Windows-1252 reference', html: '<h1>&#150; Ship</h1>', before: '– Ship' },
    { name: 'a before that is not the source text', html: '<h1>Ship faster</h1>', before: 'Ship fast', ask: { target: 'Ship faster' } },
    { name: 'text inside an svg', html: '<svg><text>Hi</text></svg>', before: 'Hi', ask: { tag: 'text' } },
    { name: 'a forged target id', html: '<h1 id="a">Ship</h1>', before: 'Ship', ask: { id: 'b' } },
  ];
  for (const { name, html, before, ask } of cases) {
    test(`${name}: 422 "can't find this text exactly", nothing written`, async (t) => {
      const rig = await setup(t);
      const original = await pageWith(rig, html);
      await assert.rejects(textEdit(rig, 'art', 'index.html', before, 'Changed', ask), rejectsWith('invalid', CANT_PLACE_MESSAGE));
      await assertNothingWritten(rig, 'art', 'index.html', original);
    });
  }

  test('two same leaves the frame counted the same: the clicked one (by index) is edited', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, '<a>More</a>\n<a>More</a>\n');
    await textEdit(rig, 'art', 'index.html', 'More', 'Less', { tag: 'a', sameIndex: 1, sameCount: 2 });
    assert.equal(await rig.tmp.read('art/index.html'), '<a>More</a>\n<a>Less</a>\n');
  });
});

describe('characters the editor cannot save (§3.4 step 3, T1 note 1)', () => {
  test('a line break or a control character is a 400 with its own sentence', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, '<h1>Ship faster</h1>');
    for (const after of ['Ship\nfaster', 'Ship\r\nfaster', 'Ship\u0000', 'Ship\u007f', 'Ship\u0085']) {
      await assert.rejects(textEdit(rig, 'art', 'index.html', 'Ship faster', after), rejectsWith('bad-request', BAD_CHARACTERS_MESSAGE), JSON.stringify(after));
    }
    await assertNothingWritten(rig, 'art', 'index.html', original);
  });

  test('un-normalised whitespace in after (a tab, ends, a double space) is refused, never rewritten: the page normalises', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, '<h1>Ship faster</h1>');
    for (const after of ['Ship\tfaster', ' Ship faster', 'Ship faster ', 'Ship  faster']) {
      await assert.rejects(textEdit(rig, 'art', 'index.html', 'Ship faster', after), rejectsWith('invalid', CANT_PLACE_MESSAGE), JSON.stringify(after));
    }
    await assertNothingWritten(rig, 'art', 'index.html', original);
  });
});

describe('undo of a text edit (E9)', () => {
  test('refused with the E9 sentence once the file changed again; the agent bytes stay', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, '<h1>Ship faster</h1>');
    const answer = await textEdit(rig, 'art', 'index.html', 'Ship faster', 'Ship it');
    await writeFile(rig.tmp.at('art/index.html'), '<h1>agent</h1>');
    await assert.rejects(rig.edits.undo('art', answer.edit.id), (error: unknown) => error instanceof ApiError && error.code === 'stale');
    assert.equal(await rig.tmp.read('art/index.html'), '<h1>agent</h1>');
  });

  test('two edits in a row undo back one at a time to the exact original', async (t) => {
    const rig = await setup(t);
    const original = await pageWith(rig, '<h1>A &amp; B</h1>\r\n<p>Ship faster</p>\r\n');
    const first = await textEdit(rig, 'art', 'index.html', 'A & B', 'A & C');
    const second = await textEdit(rig, 'art', 'index.html', 'Ship faster', 'Ship <now>', { tag: 'p' });
    assert.equal(await rig.tmp.read('art/index.html'), '<h1>A &amp; C</h1>\r\n<p>Ship &lt;now&gt;</p>\r\n');
    await rig.edits.undo('art', second.edit.id);
    await rig.edits.undo('art', first.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/index.html')).equals(original));
  });
});
