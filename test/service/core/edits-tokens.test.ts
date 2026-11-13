// The tokens op and GET /tokens's reader through the real pipeline (Phase 2 technical design
// §4.2, §4.3; PS 09, E4, E5, E9). Risk tests: E5 (only the knob values change: a BOM, CRLF,
// comments, a media-query copy of the var and the agent's spelling of untouched values survive
// byte for byte), one write for every changed value, the last top-level :root wins, the stale
// and changed-knob refusals before any byte or version, only values a knob allows are written,
// the file-level refusals (link, size, encoding), design.json untouched (09-6), and undo putting
// back the exact prior bytes, also when the save had to be split into several runs.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, test, type TestContext } from 'node:test';

import type { EditResponse, TweakValue } from '../../../src/shared/api.ts';
import { TOKENS_CSS_MAX_BYTES } from '../../../src/shared/limits.ts';
import type { Tweak, VersionEntry } from '../../../src/shared/types.ts';
import { UNDO_REMOVED_MAX } from '../../../src/service/edits/file.ts';
import { createEditService, STALE_MESSAGES, type EditService } from '../../../src/service/edits/pipeline.ts';
import {
  TOKENS_CANT_WRITE_MESSAGE,
  TOKENS_LABEL,
  TOKENS_STALE_MESSAGE,
  TOKENS_UNCHANGED_DETAIL,
  TWEAK_VALUE_MESSAGE,
  TWEAKS_CHANGED_MESSAGE,
} from '../../../src/service/edits/ops-tokens.ts';
import { FILE_TOO_LARGE_MESSAGE, NOT_UTF8_MESSAGE } from '../../../src/service/edits/ops-text.ts';
import { ApiError } from '../../../src/service/http.ts';
import { LINK_SENTENCE } from '../../../src/service/paths.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { canvasDesign, pageDesign } from '../render/harness.ts';

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const START = Date.parse('2026-11-11T12:00:00.000Z');

type Rig = { tmp: TmpRoot; ctx: FakeContext; edits: EditService };

/** The real service: the shipped op map (the real tokens op), real versions and edits.json. */
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

const TWEAKS: Tweak[] = [
  { var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '' },
  { var: '--radius', label: 'Corner radius', kind: 'number', min: 0, max: 24, step: 2, unit: 'px' },
  {
    var: '--density',
    label: 'Density',
    kind: 'choice',
    options: [
      { label: 'Compact', value: '0.85' },
      { label: 'Comfortable', value: '1' },
      { label: 'Roomy', value: '1.2' },
    ],
  },
];

const designJsonOf = (base: Record<string, unknown>, tweaks: unknown): Record<string, unknown> => {
  const json = base['design.json'];
  assert.ok(typeof json === 'object' && json !== null);
  return { ...base, 'design.json': { ...json, designSystem: { confirmed: false }, tweaks } };
};

/** A page design with the knobs above and this tokens.css (null: none). */
const pageWith = async (rig: Rig, tokens: string | Uint8Array | null, tweaks: unknown = TWEAKS, slug = 'art'): Promise<void> => {
  const files = designJsonOf(pageDesign(tokens === null ? {} : { 'tokens.css': tokens }), tweaks);
  await rig.tmp.writeDesign(slug, files as Parameters<TmpRoot['writeDesign']>[1]);
};

const bytesOf = (tmp: TmpRoot, rel: string): Promise<Buffer> => readFile(tmp.at(rel));

const save = async (rig: Rig, values: TweakValue[], slug = 'art', base?: string): Promise<EditResponse> =>
  rig.edits.apply(slug, { op: 'tokens', base: base ?? sha256(await bytesOf(rig.tmp, `${slug}/tokens.css`)), values });

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

/** Refused before the version: tokens.css is byte for byte as it was, Versions is empty, no user event. */
const assertNothingWritten = async (rig: Rig, slug: string, original: Buffer | null): Promise<void> => {
  if (original !== null) assert.ok((await bytesOf(rig.tmp, `${slug}/tokens.css`)).equals(original), 'tokens.css is byte for byte as it was');
  assert.deepEqual(await versionsOf(rig.tmp, slug), [], 'no version was taken');
  assert.equal(rig.ctx.events.filter((event) => event.origin === 'user').length, 0, 'no user event');
};

// A Windows-saved tokens file: BOM, CRLF, comments, an agent spelling (8.0px), a dark copy of the hue.
const E5_TOKENS =
  '﻿/* Tokens for Acme */\r\n' +
  ':root {\r\n' +
  '  --accent-h: 210; /* brand */\r\n' +
  '  --radius:\t8px;\r\n' +
  '  --gap: 8.0px;\r\n' +
  '  --density: 1;\r\n' +
  '}\r\n' +
  '@media (prefers-color-scheme: dark) {\r\n' +
  '  :root { --accent-h: 200; }\r\n' +
  '}\r\n';

describe('E5: only the knob values change, in one write', () => {
  test('three knobs saved: every other byte survives, one undo step, and undo restores the exact bytes', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, E5_TOKENS);
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    const designJson = await bytesOf(rig.tmp, 'art/design.json');

    const answer = await save(rig, [
      { var: '--density', value: '1.2' },
      { var: '--accent-h', value: 250 },
      { var: '--radius', value: 10 },
    ]);

    const expected = Buffer.from(E5_TOKENS.replace('--accent-h: 210', '--accent-h: 250').replace('--radius:\t8px', '--radius:\t10px').replace('--density: 1;', '--density: 1.2;'), 'utf8');
    const written = await bytesOf(rig.tmp, 'art/tokens.css');
    assert.ok(written.equals(expected), `byte-exact: ${JSON.stringify(written.toString('utf8'))}`);
    assert.deepEqual([...written.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM is kept');
    assert.equal(answer.edit.label, TOKENS_LABEL);
    assert.equal(answer.edit.label, 'Tweaks saved to tokens.css');
    assert.equal(answer.edit.detail, undefined);
    assert.deepEqual(answer.edit.files, ['tokens.css']);
    assert.equal(answer.edit.undoable, true);
    assert.deepEqual(answer.stamps, { tokens: sha256(expected) });
    assert.equal(answer.version?.reason, 'user-edit', 'a version first');
    assert.ok((await bytesOf(rig.tmp, 'art/design.json')).equals(designJson), 'design.json untouched, designSystem.confirmed stays false (09-6)');

    const record = await rig.ctx.store.get('art');
    const file = await rig.edits.editsFile.read('art', record.path);
    const undo = file.undo.find((one) => one.id === answer.edit.id);
    assert.equal(undo?.steps.length, 1, 'one write, one undo step spanning every change');
    assert.equal(undo?.label, TOKENS_LABEL);
    const entry = file.ledger.at(-1);
    assert.ok(entry?.kind === 'tweaks');
    assert.deepEqual(entry.changes, [
      { label: 'Density', before: '1', after: '1.2' },
      { label: 'Accent hue', before: '210', after: '250' },
      { label: 'Corner radius', before: '8px', after: '10px' },
    ]);
    const userEvents = rig.ctx.events.filter((event) => event.origin === 'user');
    assert.deepEqual(userEvents.map((event) => [event.kind, event.files]), [['files', ['tokens.css']]]);

    await rig.edits.undo('art', answer.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/tokens.css')).equals(original), 'undo puts back exactly the bytes from before');
  });

  test('the last top-level :root declaration is edited; earlier ones and the media copy stay', async (t) => {
    const rig = await setup(t);
    const css = ':root { --accent-h: 100; }\n:root { --accent-h: 210; }\n@media (prefers-color-scheme: dark) { :root { --accent-h: 200; } }\n';
    await pageWith(rig, css);
    const tokens = await rig.edits.readTokens('art');
    assert.deepEqual(tokens.knobs[0], { var: '--accent-h', state: 'ok', value: 210, fileUnit: '', alsoSet: ['@media (prefers-color-scheme: dark)'] });
    await save(rig, [{ var: '--accent-h', value: 250 }]);
    assert.equal(await rig.tmp.read('art/tokens.css'), css.replace('210', '250'));
  });

  test('a value the file already holds is skipped, keeping the agent’s spelling', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8.0px; --accent-h: 210; }');
    const answer = await save(rig, [
      { var: '--radius', value: 8 },
      { var: '--accent-h', value: 211 },
    ]);
    assert.equal(await rig.tmp.read('art/tokens.css'), ':root { --radius: 8.0px; --accent-h: 211; }');
    const record = await rig.ctx.store.get('art');
    const entry = (await rig.edits.editsFile.read('art', record.path)).ledger.at(-1);
    assert.ok(entry?.kind === 'tweaks');
    assert.deepEqual(entry.changes, [{ label: 'Accent hue', before: '210', after: '211' }]);
    assert.ok(answer.edit.undoable);
  });

  test('every value already set: nothing is written and the notice says so', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; }');
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    const answer = await save(rig, [{ var: '--radius', value: 8 }]);
    assert.ok((await bytesOf(rig.tmp, 'art/tokens.css')).equals(original));
    assert.equal(answer.edit.detail, TOKENS_UNCHANGED_DETAIL);
    assert.deepEqual(answer.edit.files, []);
    assert.equal(answer.edit.undoable, false);
    assert.equal(rig.ctx.events.filter((event) => event.origin === 'user').length, 0);
  });

  test('numbers are written with the step decimals and the knob unit', async (t) => {
    const rig = await setup(t);
    const tweaks: Tweak[] = [{ var: '--scale', label: 'Type scale', kind: 'number', min: -2, max: 2, step: 0.05, unit: 'rem' }];
    await pageWith(rig, ':root { --scale: 1rem; }', tweaks);
    await save(rig, [{ var: '--scale', value: 1.2000000001 }]);
    assert.equal(await rig.tmp.read('art/tokens.css'), ':root { --scale: 1.2rem; }');
    await save(rig, [{ var: '--scale', value: -0.0001 }]);
    assert.equal(await rig.tmp.read('art/tokens.css'), ':root { --scale: 0rem; }');
  });

  test('a canvas design saves its tokens.css too', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('wall', designJsonOf(canvasDesign({ 'tokens.css': ':root{--radius:8px}' }), TWEAKS) as Parameters<TmpRoot['writeDesign']>[1]);
    await save(rig, [{ var: '--radius', value: 12 }], 'wall');
    assert.equal(await rig.tmp.read('wall/tokens.css'), ':root{--radius:12px}');
  });

  test('changes further apart than an undo record holds go out as runs that fit; undo restores the bytes', async (t) => {
    const rig = await setup(t);
    const filler = `  --pad: ${'1px '.repeat(Math.ceil(UNDO_REMOVED_MAX / 4) + 10)};\n`;
    const css = `:root {\n  --accent-h: 210;\n${filler}  --radius: 8px;\n}\n`;
    await pageWith(rig, css);
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    const answer = await save(rig, [
      { var: '--accent-h', value: 250 },
      { var: '--radius', value: 10 },
    ]);
    assert.equal(await rig.tmp.read('art/tokens.css'), css.replace('210', '250').replace('8px', '10px'));
    const record = await rig.ctx.store.get('art');
    const undo = (await rig.edits.editsFile.read('art', record.path)).undo.find((one) => one.id === answer.edit.id);
    assert.equal(undo?.steps.length, 2, 'the record reads back (each splice within the cap)');
    await rig.edits.undo('art', answer.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/tokens.css')).equals(original));
  });
});

describe('stale and changed knobs (§4.3 steps 1 and 2, §4.5)', () => {
  test('the stale sentence is the pipeline’s', () => {
    assert.equal(TOKENS_STALE_MESSAGE, STALE_MESSAGES.tokens);
  });

  test('a base that is not the file on disk is refused before the version', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; }');
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    await assert.rejects(save(rig, [{ var: '--radius', value: 10 }], 'art', sha256('older bytes')), rejectsWith('stale', TOKENS_STALE_MESSAGE));
    await assertNothingWritten(rig, 'art', original);
  });

  test('tokens.css removed since the panel read it is stale', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; }');
    const base = sha256(await bytesOf(rig.tmp, 'art/tokens.css'));
    await rm(rig.tmp.at('art/tokens.css'));
    await assert.rejects(save(rig, [{ var: '--radius', value: 10 }], 'art', base), rejectsWith('stale', TOKENS_STALE_MESSAGE));
    await assertNothingWritten(rig, 'art', null);
  });

  test('a var that is not a current knob (the agent removed it) is refused with the tweaks sentence', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; --gap: 4px; }');
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    await assert.rejects(save(rig, [{ var: '--radius', value: 10 }, { var: '--gap', value: 6 }]), rejectsWith('stale', TWEAKS_CHANGED_MESSAGE));
    await assertNothingWritten(rig, 'art', original);
  });

  test('a value of the other kind (the agent changed the knob kind) is refused with the tweaks sentence', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; --density: 1; }');
    await assert.rejects(save(rig, [{ var: '--radius', value: '10px' }]), rejectsWith('stale', TWEAKS_CHANGED_MESSAGE));
    await assert.rejects(save(rig, [{ var: '--density', value: 1 }]), rejectsWith('stale', TWEAKS_CHANGED_MESSAGE));
  });
});

describe('only values a knob allows are written (no CSS injection)', () => {
  test('a number outside the range, and a choice that is not an option, are bad requests', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; --density: 1; }');
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    for (const value of [-1, 25]) await assert.rejects(save(rig, [{ var: '--radius', value }]), rejectsWith('bad-request', TWEAK_VALUE_MESSAGE));
    for (const value of ['2', '1; } body { display: none', '1.2 ']) await assert.rejects(save(rig, [{ var: '--density', value }]), rejectsWith('bad-request', TWEAK_VALUE_MESSAGE));
    await assertNothingWritten(rig, 'art', original);
  });

  test('an option that would break the file on write is refused by the verify, nothing written', async (t) => {
    const rig = await setup(t);
    // `(` passes the option pattern but would open a bracket that swallows the next declaration.
    const tweaks: Tweak[] = [{ var: '--font', label: 'Font', kind: 'choice', options: [{ label: 'A', value: 'serif' }, { label: 'B', value: 'f(' }] }];
    await pageWith(rig, ':root { --font: serif; --r: 1px; }', tweaks);
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    await assert.rejects(save(rig, [{ var: '--font', value: 'f(' }]), rejectsWith('invalid', TOKENS_CANT_WRITE_MESSAGE));
    await assertNothingWritten(rig, 'art', original);
  });
});

describe('knobs that cannot be tuned in this file (§4.3 step 3)', () => {
  const cases: { name: string; css: string; value: TweakValue; sentence: string }[] = [
    { name: 'a formula', css: ':root { --radius: calc(4px * 2); }', value: { var: '--radius', value: 10 }, sentence: 'This value is a formula. Ask the agent to change it.' },
    { name: '!important', css: ':root { --radius: 8px !important; }', value: { var: '--radius', value: 10 }, sentence: 'This value is a formula. Ask the agent to change it.' },
    { name: 'a comment inside the value', css: ':root { --radius: 8px /* base */; }', value: { var: '--radius', value: 10 }, sentence: 'This value is a formula. Ask the agent to change it.' },
    { name: 'a missing var', css: ':root { --gap: 8px; }', value: { var: '--radius', value: 10 }, sentence: 'tokens.css has no --radius.' },
    { name: 'only set in a media query', css: '@media print { :root { --radius: 8px; } }', value: { var: '--radius', value: 10 }, sentence: 'tokens.css has no --radius.' },
    { name: 'another unit', css: ':root { --radius: 0.5rem; }', value: { var: '--radius', value: 10 }, sentence: 'tokens.css sets --radius in rem, but this tweak uses px. Ask the agent to fix it.' },
    { name: 'a choice set to a reference', css: ':root { --density: var(--d); }', value: { var: '--density', value: '1.2' }, sentence: 'This value is a formula. Ask the agent to change it.' },
  ];
  for (const { name, css, value, sentence } of cases) {
    test(`${name}: refused with its reason, nothing written`, async (t) => {
      const rig = await setup(t);
      await pageWith(rig, css);
      const original = await bytesOf(rig.tmp, 'art/tokens.css');
      await assert.rejects(save(rig, [value]), rejectsWith('invalid', sentence));
      await assertNothingWritten(rig, 'art', original);
    });
  }

  test('a choice set to another plain value is replaced by the chosen option', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --density: 0.9; }');
    assert.equal((await rig.edits.readTokens('art')).knobs[2]?.state, 'value');
    await save(rig, [{ var: '--density', value: '0.85' }]);
    assert.equal(await rig.tmp.read('art/tokens.css'), ':root { --density: 0.85; }');
  });
});

describe('file-level refusals (link, size, encoding)', () => {
  test('tokens.css that is a link inside the design is refused; its target is untouched', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; }');
    await rename(rig.tmp.at('art/tokens.css'), rig.tmp.at('art/real.css'));
    await symlink(rig.tmp.at('art/real.css'), rig.tmp.at('art/tokens.css'));
    const target = await bytesOf(rig.tmp, 'art/real.css');
    await assert.rejects(save(rig, [{ var: '--radius', value: 10 }], 'art', sha256(target)), rejectsWith('invalid', LINK_SENTENCE));
    assert.ok((await bytesOf(rig.tmp, 'art/real.css')).equals(target));
    await assertNothingWritten(rig, 'art', null);
  });

  test('tokens.css that links out of the Designs folder is refused too', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, null);
    const outside = await useTmpRoot(t, 'dc-outside-');
    await outside.write('tokens.css', ':root { --radius: 8px; }');
    await symlink(outside.at('tokens.css'), rig.tmp.at('art/tokens.css'));
    await assert.rejects(save(rig, [{ var: '--radius', value: 10 }], 'art', sha256(':root { --radius: 8px; }')), rejectsWith('invalid', LINK_SENTENCE));
    assert.equal(await outside.read('tokens.css'), ':root { --radius: 8px; }');
  });

  test(`a file over ${TOKENS_CSS_MAX_BYTES} bytes is refused as too large`, async (t) => {
    const rig = await setup(t);
    await pageWith(rig, `:root { --radius: 8px; }\n/*${'x'.repeat(TOKENS_CSS_MAX_BYTES)}*/`);
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    await assert.rejects(save(rig, [{ var: '--radius', value: 10 }]), rejectsWith('too-large', FILE_TOO_LARGE_MESSAGE));
    await assertNothingWritten(rig, 'art', original);
  });

  test('a file that is not plain UTF-8 is refused', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, Buffer.concat([Buffer.from('/* Caf'), Buffer.from([0xe9]), Buffer.from(' */ :root { --radius: 8px; }')]));
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    await assert.rejects(save(rig, [{ var: '--radius', value: 10 }]), rejectsWith('invalid', NOT_UTF8_MESSAGE));
    await assertNothingWritten(rig, 'art', original);
  });
});

describe('readTokens (GET /tokens)', () => {
  test('every knob’s state, the file hash, exists and editable', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, E5_TOKENS);
    const tokens = await rig.edits.readTokens('art');
    assert.deepEqual(tokens, {
      exists: true,
      editable: true,
      sha256: sha256(Buffer.from(E5_TOKENS, 'utf8')),
      knobs: [
        { var: '--accent-h', state: 'ok', value: 210, fileUnit: '', alsoSet: ['@media (prefers-color-scheme: dark)'] },
        { var: '--radius', state: 'ok', value: 8, fileUnit: 'px', alsoSet: [] },
        { var: '--density', state: 'ok', value: '1', fileUnit: null, alsoSet: [] },
      ],
    });
  });

  test('no tokens.css: not there, every knob no-file', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, null);
    const tokens = await rig.edits.readTokens('art');
    assert.equal(tokens.exists, false);
    assert.equal(tokens.editable, false);
    assert.equal(tokens.sha256, null);
    assert.deepEqual(tokens.knobs.map((knob) => knob.state), ['no-file', 'no-file', 'no-file']);
  });

  test('a link is there but not editable, and is not read', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; }');
    await rename(rig.tmp.at('art/tokens.css'), rig.tmp.at('art/real.css'));
    await symlink(rig.tmp.at('art/real.css'), rig.tmp.at('art/tokens.css'));
    const tokens = await rig.edits.readTokens('art');
    assert.deepEqual({ exists: tokens.exists, editable: tokens.editable, sha256: tokens.sha256 }, { exists: true, editable: false, sha256: null });
    assert.deepEqual(tokens.knobs.map((knob) => [knob.state, knob.value]), [['missing', null], ['missing', null], ['missing', null]]);
  });

  test('not UTF-8: there, hashed, not editable', async (t) => {
    const rig = await setup(t);
    const bytes = Buffer.concat([Buffer.from('/* Caf'), Buffer.from([0xe9]), Buffer.from(' */ :root { --radius: 8px; }')]);
    await pageWith(rig, bytes);
    const tokens = await rig.edits.readTokens('art');
    assert.deepEqual({ exists: tokens.exists, editable: tokens.editable, sha256: tokens.sha256 }, { exists: true, editable: false, sha256: sha256(bytes) });
  });

  test('a design with no knobs answers an empty list', async (t) => {
    const rig = await setup(t);
    await rig.tmp.writeDesign('plain', pageDesign({ 'tokens.css': ':root{}' }));
    assert.deepEqual((await rig.edits.readTokens('plain')).knobs, []);
  });
});

describe('undo of a tweaks save (E9)', () => {
  test('refused once the agent changed tokens.css again; the agent bytes stay', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root { --radius: 8px; }');
    const answer = await save(rig, [{ var: '--radius', value: 10 }]);
    await writeFile(rig.tmp.at('art/tokens.css'), ':root { --radius: 4px; }');
    await assert.rejects(rig.edits.undo('art', answer.edit.id), (error: unknown) => error instanceof ApiError && error.code === 'stale');
    assert.equal(await rig.tmp.read('art/tokens.css'), ':root { --radius: 4px; }');
  });

  test('two saves in a row undo back one at a time to the exact original', async (t) => {
    const rig = await setup(t);
    await pageWith(rig, ':root {\r\n  --radius: 8px;\r\n  --accent-h: 210;\r\n}\r\n');
    const original = await bytesOf(rig.tmp, 'art/tokens.css');
    const first = await save(rig, [{ var: '--radius', value: 12 }]);
    const second = await save(rig, [{ var: '--accent-h', value: 30 }, { var: '--radius', value: 0 }]);
    assert.equal(await rig.tmp.read('art/tokens.css'), ':root {\r\n  --radius: 0px;\r\n  --accent-h: 30;\r\n}\r\n');
    await rig.edits.undo('art', second.edit.id);
    assert.equal(await rig.tmp.read('art/tokens.css'), ':root {\r\n  --radius: 12px;\r\n  --accent-h: 210;\r\n}\r\n');
    await rig.edits.undo('art', first.edit.id);
    assert.ok((await bytesOf(rig.tmp, 'art/tokens.css')).equals(original));
  });
});
