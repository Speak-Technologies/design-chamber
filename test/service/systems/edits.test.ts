// A design system's hand edits (documentation/specs/phase-2-5-technical.md §5.3, §6.1, §6.2, AD-4)
// against a real system store and real system history in a temp designs root, through the Phase 2
// user-edit rules E1 to E12 read with "system": a version first (E3), stale refusal (E4), the
// smallest change (E5), text stays text (E6), containment and the writable set (E7), user events
// and the echo filter (E8, E10), undo of exact bytes (E9), rollback of a failed multi-step save,
// one ledger entry per changed thing, the user's own sections staying reviewed, and the
// repo-backed refusal seam (AD-20).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { SystemEditRequest, TokenEdit } from '../../../src/shared/api.ts';
import { ApiError } from '../../../src/service/http.ts';
import { LINK_SENTENCE } from '../../../src/service/paths.ts';
import { createSystemEditService, parseSystemEditRequest, systemStaleMessage, type SystemEditService } from '../../../src/service/systems/edits.ts';
import { parseSystemEditsFile } from '../../../src/service/systems/edits-file.ts';
import { createSystemStore, type SystemStore } from '../../../src/service/systems/store.ts';
import { systemVersionTarget } from '../../../src/service/systems/versions.ts';
import { createVersionsService, type UserEditSteps, type VersionsService } from '../../../src/service/versions.ts';
import { systemSelfWritesKey } from '../../../src/service/watch.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

const TOKENS = ':root {\n  --brand-500: #1a73e8;\n  --space-4: 16px;\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand-500: #8ab4f8;\n  }\n}\n';
const SYSTEM_JSON = `${JSON.stringify(
  {
    version: 1,
    tokens: { '--brand-500': { section: 'colours', group: 'brand', note: 'Primary actions.' } },
    type: [{ id: 'body', name: 'Body', family: 'Inter', size: '16px' }],
    notes: [{ id: 'history', title: 'History' }],
    agentKey: { kept: true },
  },
  null,
  2,
)}\n`;

type Rig = {
  tmp: TmpRoot;
  ctx: FakeContext;
  systems: SystemStore;
  versions: VersionsService;
  edits: SystemEditService;
  id: string;
  file(rel: string): Promise<string>;
};

const setup = async (t: TestContext, options: { versions?: (real: VersionsService) => Pick<VersionsService, 'userEdit'> } = {}): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const systems = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, quietMs: 600_000, indexRefreshMs: 5 });
  t.after(() => systems.dispose());
  const versions = createVersionsService({ target: systemVersionTarget(systems, ctx.hub), hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 600_000 });
  const edits = createSystemEditService({
    systems,
    versions: options.versions?.(versions) ?? versions,
    hub: ctx.hub,
    selfWrites: ctx.selfWrites,
    settings: ctx.settings,
    log: ctx.log,
    pause: async () => undefined,
  });
  const { id } = await systems.create({ name: 'Acme' });
  await tmp.write(`_systems/${id}/tokens.css`, TOKENS);
  await tmp.write(`_systems/${id}/system.json`, SYSTEM_JSON);
  await tmp.write(`_systems/${id}/notes/history.md`, 'Why the palette changed.\n');
  return { tmp, ctx, systems, versions, edits, id, file: (rel) => tmp.read(`_systems/${id}/${rel}`) };
};

const stamps = async (rig: Rig) => ({
  tokens: sha(await rig.file('tokens.css')),
  systemJson: sha(await rig.file('system.json')),
});

const save = async (rig: Rig, body: Omit<Extract<SystemEditRequest, { op: 'save' }>, 'op' | 'stamps'> & { stamps?: Extract<SystemEditRequest, { op: 'save' }>['stamps'] }) =>
  rig.edits.apply(rig.id, parseSystemEditRequest({ op: 'save', stamps: body.stamps ?? (await stamps(rig)), ...body }));

const rejectsWith = async (promise: Promise<unknown>, code: string, message?: string | RegExp): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, String(error));
    assert.equal(error.code, code, error.message);
    if (typeof message === 'string') assert.equal(error.message, message);
    else if (message instanceof RegExp) assert.match(error.message, message);
    return true;
  });
};

const versionCount = async (rig: Rig): Promise<number> => (await rig.versions.list(rig.id)).versions.length;

const editsFileOf = async (rig: Rig) => parseSystemEditsFile(JSON.parse(await rig.file('.chamber/edits.json')) as unknown).file;

describe('parseSystemEditRequest (the boundary)', () => {
  test('only known keys, typed; stamps required for each part', () => {
    const request = parseSystemEditRequest({
      op: 'save',
      stamps: { tokens: 'a'.repeat(64), systemJson: null, texts: { 'OVERVIEW.md': null }, extra: 1 },
      tokens: [{ kind: 'set', name: '--a', mode: 'light', value: '1px', extra: true }],
      meta: [{ at: ['tokens', '--a', 'note'], value: 'x' }],
      texts: [{ file: 'OVERVIEW.md', text: 'Hello' }],
      junk: 'dropped',
    });
    assert.deepEqual(request, {
      op: 'save',
      stamps: { tokens: 'a'.repeat(64), systemJson: null, texts: { 'OVERVIEW.md': null } },
      tokens: [{ kind: 'set', name: '--a', mode: 'light', value: '1px' }],
      meta: [{ at: ['tokens', '--a', 'note'], value: 'x' }],
      texts: [{ file: 'OVERVIEW.md', text: 'Hello' }],
    });
  });

  test('malformed and hostile bodies are 400 before anything reads a file', () => {
    const hostile: unknown[] = [
      null,
      [],
      { op: 'save' },
      { op: 'save', stamps: {} },
      { op: 'save', stamps: {}, tokens: [{ kind: 'set', name: '--a', mode: 'light', value: '1px' }] },
      { op: 'save', stamps: { tokens: 'nothex' }, tokens: [{ kind: 'set', name: '--a', mode: 'light', value: '1px' }] },
      { op: 'save', stamps: { tokens: null }, tokens: [{ kind: 'set', name: '../a', mode: 'light', value: '1px' }] },
      { op: 'save', stamps: { tokens: null }, tokens: [{ kind: 'set', name: '--a', mode: 'sepia', value: '1px' }] },
      { op: 'save', stamps: { tokens: null }, tokens: [{ kind: 'drop', name: '--a', mode: 'light' }] },
      { op: 'save', stamps: { tokens: null }, tokens: [{ kind: 'set', name: '--a', mode: 'light', value: 'x'.repeat(101) }] },
      { op: 'save', stamps: { systemJson: null }, meta: [{ at: ['__proto__', 'x', 'note'], value: 'x' }] },
      { op: 'save', stamps: { systemJson: null }, meta: [{ at: ['tokens', '--a', 'polluted'], value: 'x' }] },
      { op: 'save', stamps: { systemJson: null }, meta: [{ at: ['fonts', '../../etc/passwd', 'family'], value: 'x' }] },
      { op: 'save', stamps: { texts: { '../x.md': null } }, texts: [{ file: '../x.md', text: 'x' }] },
      { op: 'save', stamps: { texts: { 'notes/../../x.md': null } }, texts: [{ file: 'notes/../../x.md', text: 'x' }] },
      { op: 'save', stamps: { texts: { 'tokens.css': null } }, texts: [{ file: 'tokens.css', text: 'x' }] },
      { op: 'save', stamps: { texts: { '.chamber/state.json': null } }, texts: [{ file: '.chamber/state.json', text: 'x' }] },
      { op: 'save', stamps: { texts: {} }, texts: [{ file: 'OVERVIEW.md', text: 'x' }] },
      { op: 'save', stamps: { tokens: null }, tokens: Array.from({ length: 201 }, (_, k) => ({ kind: 'remove', name: `--t${k}`, mode: 'light' })) },
    ];
    for (const body of hostile) assert.throws(() => parseSystemEditRequest(body), (error: unknown) => error instanceof ApiError && error.code === 'bad-request', JSON.stringify(body));
  });
});

describe('a save', () => {
  test('E3 + E5: a version holding the old files first, then only the edited bytes change', async (t) => {
    const rig = await setup(t);
    const before = await versionCount(rig);
    const answer = await save(rig, { tokens: [{ kind: 'set', name: '--brand-500', mode: 'light', value: '#0b57d0' }] });
    assert.equal(await rig.file('tokens.css'), TOKENS.replace('#1a73e8', '#0b57d0'));
    assert.equal(await versionCount(rig), before + 1);
    assert.equal(answer.version?.reason, 'user-edit', 'a "Before your edits" version');
    assert.equal(answer.coalesced, false);
    assert.deepEqual(answer.edit.files, ['tokens.css']);
    assert.equal(answer.edit.label, 'Saved to Acme');
    assert.equal(answer.edit.undoable, true);
    assert.equal(answer.stamps.tokens, sha(await rig.file('tokens.css')));
    // The version holds the bytes from before.
    const { source } = await rig.versions.readTree(rig.id, answer.version?.id ?? '');
    const old = await source.read('tokens.css');
    assert.equal(old?.bytes.toString('utf8'), TOKENS);
  });

  test('E3: a quick second save shares the version (coalesced)', async (t) => {
    const rig = await setup(t);
    await save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }] });
    const count = await versionCount(rig);
    const second = await save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '24px' }] });
    assert.equal(second.coalesced, true);
    assert.equal(second.version, null);
    assert.equal(await versionCount(rig), count);
  });

  test('E3: a refused version writes nothing', async (t) => {
    const rig = await setup(t, {
      versions: () => ({
        userEdit: async <P, R>(_id: string, _reason: 'user-edit' | 'keep-direction', steps: UserEditSteps<P, R>) => {
          await steps.precheck();
          throw new ApiError('invalid', "Couldn't save a version first, so nothing was changed.");
        },
      }),
    });
    await rejectsWith(save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }] }), 'invalid', /version first/);
    assert.equal(await rig.file('tokens.css'), TOKENS);
  });

  test('E4: a stamp that moved on refuses before any version or write; the sentence names the system', async (t) => {
    const rig = await setup(t);
    const old = await stamps(rig);
    await rig.tmp.write(`_systems/${rig.id}/tokens.css`, TOKENS.replace('16px', '18px'));
    const count = await versionCount(rig);
    await rejectsWith(save(rig, { stamps: old, tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }] }), 'stale', systemStaleMessage('Acme'));
    assert.equal(await rig.file('tokens.css'), TOKENS.replace('16px', '18px'));
    assert.equal(await versionCount(rig), count);
    // An absent file's stamp is null; a file that appeared meanwhile is stale too.
    await rejectsWith(save(rig, { stamps: { texts: { 'OVERVIEW.md': null } }, texts: [{ file: 'OVERVIEW.md', text: 'Mine' }] }).then(async () => {
      await rig.tmp.write(`_systems/${rig.id}/OVERVIEW.md`, 'Theirs');
      return save(rig, { stamps: { texts: { 'OVERVIEW.md': null } }, texts: [{ file: 'OVERVIEW.md', text: 'Mine again' }] });
    }), 'stale');
  });

  test('add and remove in light and dark, metadata with unknown keys kept, one ledger entry per changed thing', async (t) => {
    const rig = await setup(t);
    const answer = await save(rig, {
      tokens: [
        { kind: 'add', name: '--surface', mode: 'light', value: '#ffffff' },
        { kind: 'add', name: '--surface', mode: 'dark', value: '#111111' },
        { kind: 'remove', name: '--space-4', mode: 'both' },
      ],
      meta: [
        { at: ['tokens', '--surface', 'group'], value: 'surface' },
        { at: ['tokens', '--space-4'], value: null },
        { at: ['type', 'body', 'weight'], value: '500' },
      ],
    });
    assert.deepEqual(answer.edit.files, ['system.json', 'tokens.css']);
    const css = await rig.file('tokens.css');
    assert.equal(css, ':root {\n  --brand-500: #1a73e8;\n  --surface: #ffffff;\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand-500: #8ab4f8;\n    --surface: #111111;\n  }\n}\n');
    const json = JSON.parse(await rig.file('system.json')) as Record<string, unknown>;
    assert.deepEqual(json.agentKey, { kept: true }, 'unknown keys kept');
    assert.deepEqual((json.tokens as Record<string, unknown>)['--surface'], { group: 'surface' });
    assert.equal((json.type as { weight?: string }[])[0]?.weight, '500');
    const kinds = (await editsFileOf(rig)).ledger.map((entry) => [entry.kind, 'name' in entry ? entry.name : 'what' in entry ? entry.what : '']);
    assert.deepEqual(kinds, [
      ['system-meta', 'the colour group of --surface'],
      ['system-meta', 'the notes of --space-4'],
      ['system-meta', 'the weight of type style body'],
      ['system-token-add', '--surface'],
      ['system-token-remove', '--space-4'],
    ]);
    const detail = await rig.systems.detail(rig.id);
    assert.deepEqual(detail.tokens.find((token) => token.name === '--surface')?.dark?.text, '#111111');
    assert.equal(detail.tokens.some((token) => token.name === '--space-4'), false);
  });

  test('a meta edit of a component keeps the agent\'s layout hint and the section defaults', async (t) => {
    const rig = await setup(t);
    await rig.tmp.write(
      `_systems/${rig.id}/system.json`,
      `${JSON.stringify({ version: 1, layout: { components: 'compact' }, components: [{ id: 'button', name: 'Button', note: 'Old.', layout: 'full' }] }, null, 2)}\n`,
    );
    await save(rig, { meta: [{ at: ['components', 'button', 'note'], value: 'New guidance.' }] });
    const json = JSON.parse(await rig.file('system.json')) as { layout: unknown; components: { note: string; layout: string }[] };
    assert.equal(json.components[0]?.note, 'New guidance.');
    assert.equal(json.components[0]?.layout, 'full', 'the entry hint survives the user\'s note edit');
    assert.deepEqual(json.layout, { components: 'compact' }, 'the section defaults survive too');
  });

  test('a remove-only save says so in the notice', async (t) => {
    const rig = await setup(t);
    const answer = await save(rig, { tokens: [{ kind: 'remove', name: '--space-4', mode: 'both' }] });
    assert.equal(answer.edit.label, 'Removed --space-4 from Acme. Designs that copied Acme keep it.');
  });

  test('E6: texts are written as text; the overview may be created, a body only for a listed entry', async (t) => {
    const rig = await setup(t);
    const hostile = '</p><script>alert(1)</script> & <b>';
    await save(rig, { stamps: { texts: { 'OVERVIEW.md': null } }, texts: [{ file: 'OVERVIEW.md', text: hostile }] });
    assert.equal(await rig.file('OVERVIEW.md'), hostile);
    const history = sha(await rig.file('notes/history.md'));
    await save(rig, { stamps: { texts: { 'notes/history.md': history } }, texts: [{ file: 'notes/history.md', text: 'New body.' }] });
    assert.equal(await rig.file('notes/history.md'), 'New body.');
    await rejectsWith(save(rig, { stamps: { texts: { 'notes/ghost.md': null } }, texts: [{ file: 'notes/ghost.md', text: 'x' }] }), 'stale');
    await assert.rejects(readFile(rig.tmp.at(`_systems/${rig.id}/notes/ghost.md`)));
    await rejectsWith(
      save(rig, { stamps: { texts: { 'OVERVIEW.md': sha(hostile) } }, texts: [{ file: 'OVERVIEW.md', text: 'x'.repeat(4001) }] }),
      'invalid',
      'Keep the overview under 4 000 characters. Move detail into a note.',
    );
  });

  test('invalid values and refused plans are 422 with the sentence; nothing written, no version', async (t) => {
    const rig = await setup(t);
    const count = await versionCount(rig);
    await rejectsWith(save(rig, { tokens: [{ kind: 'set', name: '--brand-500', mode: 'light', value: 'url(evil.png)' }] }), 'invalid', /Use a colour/);
    await rejectsWith(save(rig, { tokens: [{ kind: 'add', name: '--brand-500', mode: 'light', value: '#000' }] }), 'invalid', /already has a light value/);
    await rejectsWith(save(rig, { meta: [{ at: ['tokens', '--brand-500', 'note'], value: 'x'.repeat(501) }] }), 'invalid', /500 characters/);
    await rejectsWith(save(rig, { meta: [{ at: ['type', 'ghost', 'name'], value: 'Ghost' }] }), 'stale');
    assert.equal(await rig.file('tokens.css'), TOKENS);
    assert.equal(await rig.file('system.json'), SYSTEM_JSON);
    assert.equal(await versionCount(rig), count);
  });

  test('E7: a linked tokens.css is refused and its target never written', async (t) => {
    const rig = await setup(t);
    const outside = rig.tmp.at('outside.css');
    await writeFile(outside, TOKENS);
    await rm(rig.tmp.at(`_systems/${rig.id}/tokens.css`));
    try {
      await symlink(outside, rig.tmp.at(`_systems/${rig.id}/tokens.css`));
    } catch {
      t.skip('symlinks need privileges on this machine');
      return;
    }
    await rejectsWith(save(rig, { stamps: { tokens: sha(TOKENS) }, tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '1px' }] }), 'invalid', LINK_SENTENCE);
    assert.equal(await readFile(outside, 'utf8'), TOKENS);
  });

  test('E8 + E10: one user event for the files; the watcher sees the writes as echoes', async (t) => {
    const rig = await setup(t);
    const from = rig.ctx.events.length;
    await save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }], meta: [{ at: ['tokens', '--space-4', 'note'], value: 'Card gaps.' }] });
    const files = rig.ctx.events.slice(from).filter((event) => event.kind === 'system' && event.systemChange === 'files');
    assert.deepEqual(files.map((event) => [event.files, event.origin]), [[['system.json', 'tokens.css'], 'user']]);
    const dir = rig.tmp.at(`_systems/${rig.id}`);
    assert.equal(await rig.ctx.selfWrites.isEcho(systemSelfWritesKey(rig.id), 'tokens.css', dir), true);
    assert.equal(await rig.ctx.selfWrites.isEcho(systemSelfWritesKey(rig.id), 'system.json', dir), true);
  });

  test('a failed second step rolls the first back; the stale sentence answers and nothing is left changed', async (t) => {
    let sneak: (() => Promise<void>) | null = null;
    const rig = await setup(t, {
      versions: (real) => ({
        // The agent writes system.json between the plan and the writes: the tokens.css write lands, system.json's CAS fails.
        userEdit: <P, R>(id: string, reason: 'user-edit' | 'keep-direction', steps: UserEditSteps<P, R>) =>
          real.userEdit(id, reason, {
            ...steps,
            apply: async (plan, tree, version) => {
              await sneak?.();
              return steps.apply(plan, tree, version);
            },
          }),
      }),
    });
    const agent = SYSTEM_JSON.replace('Primary actions.', 'Agent wrote this.');
    sneak = () => rig.tmp.write(`_systems/${rig.id}/system.json`, agent).then(() => undefined);
    await rejectsWith(
      save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }], meta: [{ at: ['tokens', '--space-4', 'note'], value: 'x' }] }),
      'stale',
      systemStaleMessage('Acme'),
    );
    assert.equal(await rig.file('tokens.css'), TOKENS, 'the first write was rolled back');
    assert.equal(await rig.file('system.json'), agent, "the agent's write stands");
  });
});

describe('undo (E9)', () => {
  test('puts back exactly the bytes from before, through the same chain, and drops the unsent ledger entries', async (t) => {
    const rig = await setup(t);
    const answer = await save(rig, {
      tokens: [
        { kind: 'set', name: '--brand-500', mode: 'dark', value: '#000000' },
        { kind: 'add', name: '--z-top', mode: 'light', value: '10' },
      ],
      meta: [{ at: ['tokens', '--z-top', 'section'], value: 'layers' }],
      stamps: { ...(await stamps(rig)), texts: { 'OVERVIEW.md': null } },
      texts: [{ file: 'OVERVIEW.md', text: 'Calm.' }],
    });
    assert.equal(answer.edit.undoable, true);
    const undone = await rig.edits.undo(rig.id, answer.edit.id);
    assert.deepEqual(undone.files, ['OVERVIEW.md', 'system.json', 'tokens.css']);
    assert.equal(await rig.file('tokens.css'), TOKENS);
    assert.equal(await rig.file('system.json'), SYSTEM_JSON);
    await assert.rejects(readFile(rig.tmp.at(`_systems/${rig.id}/OVERVIEW.md`)), 'the created overview went to the trash');
    const trash = await readdir(rig.tmp.at('.trash'));
    assert.equal(trash.filter((name) => name.startsWith(`system.${rig.id}.OVERVIEW-`) && name.endsWith('.md')).length, 1);
    assert.deepEqual((await editsFileOf(rig)).ledger, []);
    await rejectsWith(rig.edits.undo(rig.id, answer.edit.id), 'not-found', "This edit can't be undone any more.");
  });

  test('refused when the file changed after the edit; nothing is touched', async (t) => {
    const rig = await setup(t);
    const answer = await save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }] });
    const agent = TOKENS.replace('16px', '99px');
    await rig.tmp.write(`_systems/${rig.id}/tokens.css`, agent);
    await rejectsWith(rig.edits.undo(rig.id, answer.edit.id), 'stale', /can't be undone here/);
    assert.equal(await rig.file('tokens.css'), agent);
  });

  test('after the ledger went to the chat, an undo adds an "Undid" entry instead', async (t) => {
    const rig = await setup(t);
    const answer = await save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }] });
    const { seq } = await editsFileOf(rig);
    await rig.edits.clearHandEdits(rig.id, seq);
    assert.deepEqual((await editsFileOf(rig)).ledger, []);
    await rig.edits.undo(rig.id, answer.edit.id);
    const ledger = (await editsFileOf(rig)).ledger;
    assert.deepEqual(ledger.map((entry) => [entry.kind, 'of' in entry ? entry.of : '']), [['undo', 'Saved to Acme']]);
    await rejectsWith(rig.edits.clearHandEdits(rig.id, 999), 'bad-request');
  });

  test('a tampered undo record naming a file outside the writable set is dropped, never run', async (t) => {
    const rig = await setup(t);
    const answer = await save(rig, { tokens: [{ kind: 'set', name: '--space-4', mode: 'light', value: '20px' }] });
    const raw = JSON.parse(await rig.file('.chamber/edits.json')) as { undo: { steps: { file: string }[] }[] };
    const record = raw.undo[0];
    assert.ok(record !== undefined && record.steps[0] !== undefined);
    record.steps[0].file = '../../outside.css';
    await rig.tmp.write(`_systems/${rig.id}/.chamber/edits.json`, raw);
    await rejectsWith(rig.edits.undo(rig.id, answer.edit.id), 'not-found');
  });
});

describe('patterns and brand entries (S8, §2.11)', () => {
  const withEntries = async (rig: Rig): Promise<void> => {
    const json = JSON.parse(SYSTEM_JSON) as Record<string, unknown>;
    json.patterns = [{ id: 'voice', kind: 'voice', title: 'Voice', note: 'Plain.' }];
    json.brand = [{ id: 'hero', kind: 'marketing', title: 'Heroes' }];
    await rig.tmp.write(`_systems/${rig.id}/system.json`, `${JSON.stringify(json, null, 2)}\n`);
  };

  test('title, note and kind of a pattern or brand entry change through meta; a kind off its list is refused', async (t) => {
    const rig = await setup(t);
    await withEntries(rig);
    const answer = await save(rig, {
      meta: [
        { at: ['patterns', 'voice', 'title'], value: 'Voice and tone' },
        { at: ['patterns', 'voice', 'kind'], value: 'do-dont' },
        { at: ['brand', 'hero', 'note'], value: 'One photo.' },
      ],
    });
    const json = JSON.parse(await rig.file('system.json')) as { patterns: unknown[]; brand: unknown[]; agentKey: unknown };
    assert.deepEqual(json.patterns, [{ id: 'voice', kind: 'do-dont', title: 'Voice and tone', note: 'Plain.' }]);
    assert.deepEqual(json.brand, [{ id: 'hero', kind: 'marketing', title: 'Heroes', note: 'One photo.' }]);
    assert.deepEqual(json.agentKey, { kept: true });
    assert.equal(answer.edit.undoable, true);
    const detail = await rig.systems.detail(rig.id);
    assert.equal(detail.patterns[0]?.title, 'Voice and tone');
    await rejectsWith(save(rig, { meta: [{ at: ['brand', 'hero', 'kind'], value: 'voice' }] }), 'invalid', /Choose a kind: marketing, imagery, logo-use, other/);
  });

  test('a body file is created for a listed entry and undone to the trash; never for an unlisted one', async (t) => {
    const rig = await setup(t);
    await withEntries(rig);
    const hostile = '</p><script>alert(1)</script>';
    const answer = await save(rig, { stamps: { texts: { 'patterns/voice.md': null, 'brand/hero.md': null } }, texts: [{ file: 'patterns/voice.md', text: hostile }, { file: 'brand/hero.md', text: 'Daylight.' }] });
    assert.equal(await rig.file('patterns/voice.md'), hostile);
    assert.equal(await rig.file('brand/hero.md'), 'Daylight.');
    assert.equal((await rig.systems.detail(rig.id)).patterns[0]?.text, hostile);
    await rejectsWith(save(rig, { stamps: { texts: { 'brand/ghost.md': null } }, texts: [{ file: 'brand/ghost.md', text: 'x' }] }), 'stale');
    await assert.rejects(readFile(rig.tmp.at(`_systems/${rig.id}/brand/ghost.md`)));
    await rig.edits.undo(rig.id, answer.edit.id);
    await assert.rejects(readFile(rig.tmp.at(`_systems/${rig.id}/patterns/voice.md`)));
    await assert.rejects(readFile(rig.tmp.at(`_systems/${rig.id}/brand/hero.md`)));
  });
});

describe('review and revision', () => {
  test("the user's own save keeps the section reviewed; the agent's change does not", async (t) => {
    const rig = await setup(t);
    await rig.systems.patch(rig.id, { review: { section: 'colours', state: 'looks-good' } });
    assert.equal((await rig.systems.detail(rig.id)).review.colours.state, 'looks-good');
    const revision = (await rig.systems.detail(rig.id)).revision;
    await save(rig, { tokens: [{ kind: 'set', name: '--brand-500', mode: 'light', value: '#0b57d0' }] });
    const after = await rig.systems.detail(rig.id);
    assert.equal(after.review.colours.state, 'looks-good');
    assert.equal(after.revision, revision + 1, 'the revision settled at once');
    await rig.tmp.write(`_systems/${rig.id}/tokens.css`, (await rig.file('tokens.css')).replace('#0b57d0', '#ff0000'));
    assert.equal((await rig.systems.detail(rig.id)).review.colours.state, 'not-reviewed');
  });
});

describe('the read-only seam (AD-20)', () => {
  test('a repo-backed system refuses an edit and an undo before any read, version or write', async (t) => {
    const rig = await setup(t);
    const file = `_systems/${rig.id}/.chamber/state.json`;
    const state = JSON.parse(await rig.tmp.read(file)) as Record<string, unknown>;
    await rig.tmp.write(file, { ...state, home: { kind: 'repo', directory: path.join(rig.tmp.root, 'shop'), folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: new Date().toISOString() } });
    const edit: TokenEdit = { kind: 'set', name: '--space-4', mode: 'light', value: '20px' };
    await rejectsWith(save(rig, { stamps: { tokens: sha(TOKENS) }, tokens: [edit] }), 'read-only', 'Acme lives in shop. Change the values there, or ask the agent here.');
    await rejectsWith(rig.edits.undo(rig.id, 'e_0123456789abcdef0123'), 'read-only');
    assert.equal(await rig.file('tokens.css'), TOKENS);
  });
});
