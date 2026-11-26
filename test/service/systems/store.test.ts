// The system store (documentation/specs/phase-2-5-technical.md §5.1, §2.1, §2.5, AD-1, AD-13):
// `_systems` is never a design, names and ids are compared ignoring case, `none` and `ask` are
// reserved, the 50-system cap, unreadable and empty systems, review derivation, delete clearing
// settings, the revision counter and link refusals.

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { ApiError } from '../../../src/service/http.ts';
import { countDesigns } from '../../../src/service/root.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { createSystemStore, mintSystemId, swatchesOf, SYSTEM_GONE_MESSAGE, SYSTEM_OVER_LIMIT_MESSAGE, SYSTEMS_CAP_MESSAGE, type SystemStore } from '../../../src/service/systems/store.ts';
import type { SystemTokenRules } from '../../../src/shared/system-json.ts';
import type { SettingsFile } from '../../../src/shared/types.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

/** T3's token rules are not needed here: light = top-level :root, colours by `#`, every value valid. */
const RULES: SystemTokenRules = {
  isLight: (ctx) => ctx.kind === 'root',
  isDark: (ctx) => ctx.kind === 'other' && ctx.label === '@media (prefers-color-scheme: dark)',
  classify: (_name, value) => (value.startsWith('#') ? 'colours' : 'spacing'),
  validate: () => ({ ok: true, formula: false }),
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Rig = { tmp: TmpRoot; ctx: FakeContext; store: SystemStore };

const setup = async (t: TestContext, options: { settings?: Partial<SettingsFile>; quietMs?: number } = {}): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, ...(options.settings ? { settings: options.settings } : {}) });
  const store = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, quietMs: options.quietMs ?? 600_000, indexRefreshMs: 5, rules: RULES });
  t.after(() => store.dispose());
  return { tmp, ctx, store };
};

const rejectsWith = async (promise: Promise<unknown>, code: string, message?: string | RegExp): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, String(error));
    assert.equal(error.code, code);
    if (typeof message === 'string') assert.equal(error.message, message);
    else if (message instanceof RegExp) assert.match(error.message, message);
    return true;
  });
};

describe('creating a system', () => {
  test('writes the seed files and state, revision 1, an internal home, and emits added', async (t) => {
    const { tmp, ctx, store } = await setup(t);
    const { id, system } = await store.create({ name: 'Acme', description: { text: 'Calm and plain.', preset: null } });
    assert.equal(id, 'acme');
    assert.deepEqual((await readdir(tmp.at('_systems/acme'))).sort(), ['.chamber', 'system.json', 'tokens.css']);
    const state = JSON.parse(await tmp.read('_systems/acme/.chamber/state.json')) as Record<string, unknown>;
    assert.equal(state.name, 'Acme');
    assert.equal((state.revision as { n: number }).n, 1);
    assert.deepEqual(state.home, { kind: 'internal' });
    assert.deepEqual((state.sources as Record<string, unknown>).description, { text: 'Calm and plain.', preset: null });
    assert.equal(system.status, 'draft');
    assert.equal(system.empty, true);
    assert.equal(system.sources.description, true);
    assert.ok(ctx.events.some((event) => event.kind === 'system' && event.system === 'acme' && event.systemChange === 'added' && event.slug === null));
  });

  test('creates the designs folder and _systems on first run', async (t) => {
    const { tmp, store } = await setup(t);
    await rm(tmp.root, { recursive: true, force: true });
    await store.create({ name: 'First' });
    assert.deepEqual(await readdir(tmp.at('_systems')), ['first']);
  });

  test('a scan-based create without the scan’s seed is refused and writes nothing', async (t) => {
    const { tmp, store } = await setup(t);
    await rejectsWith(store.create({ name: 'Acme', code: { scanId: 'sc_abcdefghijklmnop', assets: [] } }), 'bad-request', 'That scan is no longer available. Scan the folder again.');
    assert.equal(await readdir(tmp.at('_systems')).catch(() => null), null);
  });
});

describe('_systems is never a design', () => {
  test('the design list, the design count and the design store never see it', async (t) => {
    const { tmp, ctx, store } = await setup(t);
    await store.create({ name: 'Acme' });
    await tmp.writeDesign('shop', { 'index.html': '<h1>x</h1>' });
    const designs = createDesignStore({ settings: ctx.settings, log: ctx.log });
    assert.deepEqual((await designs.list()).map((design) => design.slug), ['shop']);
    assert.equal(await countDesigns(tmp.root), 1);
    await rejectsWith(designs.get('_systems'), 'bad-slug');
  });
});

describe('names and ids', () => {
  test('names are unique ignoring case and width (NFKC), with the existing name in the sentence', async (t) => {
    const { store } = await setup(t);
    await store.create({ name: 'Acme' });
    await rejectsWith(store.create({ name: 'ACME' }), 'conflict', 'You already have a system called Acme.');
    await rejectsWith(store.create({ name: 'ＡＣＭＥ' }), 'conflict', 'You already have a system called Acme.');
  });

  test('empty, control characters and over 60 characters are refused with the sentence', async (t) => {
    const { store } = await setup(t);
    await rejectsWith(store.create({ name: '   ' }), 'bad-request', 'Give the design system a name.');
    await rejectsWith(store.create({ name: 'a\nb' }), 'bad-request', "A design system name can't hold line breaks or control characters.");
    await rejectsWith(store.create({ name: 'x'.repeat(61) }), 'bad-request', 'A design system name can be up to 60 characters.');
  });

  test('ids compare ignoring case with every entry in _systems (a folder Acme blocks acme)', async (t) => {
    const { tmp, store } = await setup(t);
    await mkdir(tmp.at('_systems/Acme'), { recursive: true });
    const { id } = await store.create({ name: 'acme' });
    assert.equal(id, 'acme-2');
  });

  test('none and ask are never minted; a hand-made none folder lists with the reason', async (t) => {
    const { tmp, store } = await setup(t);
    assert.equal((await store.create({ name: 'None' })).id, 'none-2');
    assert.equal((await store.create({ name: 'Ask' })).id, 'ask-2');
    await mkdir(tmp.at('_systems/none'));
    const row = (await store.list()).find((one) => one.id === 'none');
    assert.match(row?.unreadable ?? '', /named none, which Design Chamber keeps for itself/);
  });

  test('mintSystemId: a name with no Latin letter or digit becomes system', () => {
    assert.equal(mintSystemId('日本', new Set()), 'system');
    assert.equal(mintSystemId('日本', new Set(['system'])), 'system-2');
  });
});

describe('the 50-system cap', () => {
  test('the 51st create is refused; a 51st folder on disk lists with the over-limit sentence', async (t) => {
    const { tmp, store } = await setup(t);
    for (let i = 1; i <= 50; i += 1) await mkdir(tmp.at(`_systems/s-${String(i).padStart(2, '0')}`), { recursive: true });
    await rejectsWith(store.create({ name: 'One more' }), 'conflict', SYSTEMS_CAP_MESSAGE);
    await mkdir(tmp.at('_systems/s-51'));
    const rows = await store.list();
    assert.equal(rows.length, 51);
    assert.deepEqual(rows.filter((row) => row.unreadable === SYSTEM_OVER_LIMIT_MESSAGE).map((row) => row.id), ['s-51']);
  });
});

describe('states', () => {
  test('a hand-made folder with no files is an empty Draft named from its id', async (t) => {
    const { tmp, store } = await setup(t);
    await mkdir(tmp.at('_systems/brand-kit'), { recursive: true });
    const [row] = await store.list();
    assert.equal(row?.name, 'Brand kit');
    assert.equal(row?.status, 'draft');
    assert.equal(row?.empty, true);
    assert.equal(row?.unreadable, null);
    assert.equal(row?.revision, 0);
  });

  test('an unreadable system.json is the whole-system sentence; tokens.css still shows', async (t) => {
    const { tmp, store } = await setup(t);
    await tmp.write('_systems/acme/system.json', '{oops');
    await tmp.write('_systems/acme/tokens.css', ':root { --brand: #123456; }');
    const [row] = await store.list();
    assert.equal(row?.unreadable, "Design Chamber can't read this design system. system.json isn't valid JSON.");
    const detail = await store.detail('acme');
    assert.equal(detail.tokens[0]?.light?.text, '#123456');
  });

  test('a system.json over 1 MiB is not read into the detail', async (t) => {
    const { tmp, store } = await setup(t);
    await tmp.write('_systems/acme/system.json', `{"pad":"${'x'.repeat(1_100_000)}"}`);
    assert.equal((await store.detail('acme')).unreadable, "Design Chamber can't read this design system. system.json is larger than 1 MB.");
  });

  test('a damaged state.json reads as provisional and the list still answers', async (t) => {
    const { tmp, store } = await setup(t);
    await tmp.write('_systems/acme/.chamber/state.json', '{broken');
    const [row] = await store.list();
    assert.equal(row?.name, 'Acme');
    assert.equal(row?.status, 'draft');
  });
});

describe('links and containment', () => {
  test('a linked system folder or a linked _systems is not a system', async (t) => {
    const { tmp, store } = await setup(t);
    const outside = await useTmpRoot(t, 'dc-outside-');
    await mkdir(tmp.at('_systems'), { recursive: true });
    await symlink(outside.root, tmp.at('_systems/evil'), 'dir');
    assert.deepEqual(await store.list(), []);
    await rejectsWith(store.detail('evil'), 'not-found', SYSTEM_GONE_MESSAGE);
    await rm(tmp.at('_systems'), { recursive: true });
    await mkdir(outside.at('acme'), { recursive: true });
    await symlink(outside.root, tmp.at('_systems'), 'dir');
    assert.deepEqual(await store.list(), []);
    await assert.rejects(store.detail('acme'));
  });

  test('a designs root that is itself a link (macOS /var, a linked Documents) works end to end', async (t) => {
    const real = await useTmpRoot(t, 'dc-real-root-');
    const holder = await useTmpRoot(t, 'dc-link-holder-');
    const linkedRoot = holder.at('Designs');
    await symlink(real.root, linkedRoot, 'dir');
    const ctx = createFakeContext({ root: linkedRoot });
    const store = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, quietMs: 600_000, indexRefreshMs: 5, rules: RULES });
    t.after(() => store.dispose());
    await store.create({ name: 'Acme' });
    await rejectsWith(store.create({ name: 'ACME' }), 'conflict', 'You already have a system called Acme.');
    assert.deepEqual((await store.list()).map((row) => [row.id, row.name]), [['acme', 'Acme']]);
    await store.patch('acme', { name: 'Acme Brand' });
    assert.equal((await store.detail('acme')).name, 'Acme Brand');
    const { trashedTo } = await store.trash('acme');
    assert.equal(path.dirname(trashedTo), real.at('.trash'));
  });

  test('an id that is not the pattern is refused before any path is built', async (t) => {
    const { store } = await setup(t);
    for (const id of ['../x', 'Acme', '.chamber', 'a/b', '']) await rejectsWith(store.dir(id), 'bad-slug');
  });

  test('a missing system answers the gone sentence', async (t) => {
    const { store } = await setup(t);
    await rejectsWith(store.detail('nope'), 'not-found', SYSTEM_GONE_MESSAGE);
    await rejectsWith(store.patch('nope', { status: 'ready' }), 'not-found', SYSTEM_GONE_MESSAGE);
    await rejectsWith(store.trash('nope'), 'not-found', SYSTEM_GONE_MESSAGE);
  });
});

describe('patch: rename, review, ready, chat', () => {
  const css = ':root {\n  --brand: #111111;\n  --gap: 8px;\n}\n';

  test('rename keeps the id and refuses a name another system has (ignoring case)', async (t) => {
    const { store } = await setup(t);
    await store.create({ name: 'Acme' });
    await store.create({ name: 'Shop' });
    const renamed = await store.patch('acme', { name: 'Acme Brand' });
    assert.equal(renamed.system.id, 'acme');
    assert.equal(renamed.system.name, 'Acme Brand');
    await rejectsWith(store.patch('acme', { name: 'shop' }), 'conflict', 'You already have a system called Shop.');
    assert.equal((await store.patch('acme', { name: 'ACME BRAND' })).system.name, 'ACME BRAND');
  });

  test('a review holds until the agent changes that section; Mark ready counts unreviewed sections', async (t) => {
    const { tmp, ctx, store } = await setup(t);
    await store.create({ name: 'Acme' });
    await writeFile(tmp.at('_systems/acme/tokens.css'), css);
    await store.patch('acme', { review: { section: 'colours', state: 'looks-good' } });
    await store.patch('acme', { review: { section: 'spacing', state: 'needs-work', note: 'Tighter.' } });
    let detail = await store.detail('acme');
    assert.deepEqual(detail.review.colours, { state: 'looks-good', note: null });
    assert.deepEqual(detail.review.spacing, { state: 'needs-work', note: 'Tighter.' });
    assert.ok(ctx.events.some((event) => event.kind === 'system' && event.systemChange === 'state'));

    const ready = await store.patch('acme', { status: 'ready' });
    assert.equal(ready.system.status, 'ready');
    assert.deepEqual(ready.readyNote, { unreviewed: 11 });
    assert.equal(ready.system.changesToReview, false);

    // The agent changes the colours: that review is gone and the Ready system has changes to review.
    await writeFile(tmp.at('_systems/acme/tokens.css'), css.replace('#111111', '#222222'));
    detail = await store.detail('acme');
    assert.equal(detail.review.colours.state, 'not-reviewed');
    assert.equal(detail.review.spacing.state, 'needs-work');
    assert.equal(detail.changesToReview, true);

    const draft = await store.patch('acme', { status: 'draft' });
    assert.equal(draft.system.changesToReview, false);
    assert.equal(JSON.parse(await tmp.read('_systems/acme/.chamber/state.json')).readyFingerprints, null);

    await store.patch('acme', { review: { section: 'spacing', state: 'not-reviewed' } });
    assert.equal((await store.detail('acme')).review.spacing.state, 'not-reviewed');
  });

  test('an uncovered section has nothing to review', async (t) => {
    const { tmp, store } = await setup(t);
    await store.create({ name: 'Acme' });
    await writeFile(tmp.at('_systems/acme/system.json'), JSON.stringify({ coverage: ['foundations'] }));
    await rejectsWith(store.patch('acme', { review: { section: 'brand', state: 'looks-good' } }), 'invalid');
    const ready = await store.patch('acme', { status: 'ready' });
    assert.deepEqual(ready.readyNote, { unreviewed: 8 });
  });

  test('the linked chat is set and cleared; a repo living-page switch is refused for an internal home', async (t) => {
    const { store } = await setup(t);
    await store.create({ name: 'Acme' });
    assert.equal((await store.detail('acme')).sessionId, null);
    await store.patch('acme', { sessionId: 'ses_123' });
    assert.equal((await store.detail('acme')).sessionId, 'ses_123');
    await store.patch('acme', { sessionId: null });
    assert.equal((await store.detail('acme')).sessionId, null);
    await rejectsWith(store.patch('acme', { livingPage: { embedFonts: true } }), 'invalid');
  });
});

describe('delete', () => {
  test('moves the folder to .trash/system.<id>-<stamp>, clears the default and the pins naming it, once', async (t) => {
    const { tmp, ctx, store } = await setup(t, {
      settings: {
        systemDefault: { choice: 'system', id: 'acme', name: 'Acme' },
        systemPins: [
          { directory: '/abs/shop', choice: 'system', id: 'acme', name: 'Acme' },
          { directory: '/abs/blog', choice: 'none' },
          { directory: '/abs/docs', choice: 'system', id: 'other', name: 'Other' },
        ],
      },
    });
    await store.create({ name: 'Acme' });
    const answer = await store.trash('acme');
    assert.match(path.basename(answer.trashedTo), /^system\.acme-\d{14}$/);
    assert.equal(path.dirname(answer.trashedTo), tmp.at('.trash'));
    assert.deepEqual(answer.clearedSettings, { default: true, pins: 1 });
    assert.equal(answer.repoUntouched, undefined);
    assert.equal(ctx.settings.read().systemDefault, undefined);
    assert.deepEqual(ctx.settings.read().systemPins?.map((pin) => pin.directory), ['/abs/blog', '/abs/docs']);
    assert.deepEqual(store.takeNotices(), ['Acme was deleted, so it is no longer your default.', 'Acme was deleted, so it is no longer pinned for shop.']);
    assert.deepEqual(store.takeNotices(), []);
    assert.ok(ctx.events.some((event) => event.kind === 'system' && event.system === 'acme' && event.systemChange === 'removed'));
    await rejectsWith(store.detail('acme'), 'not-found', SYSTEM_GONE_MESSAGE);
    assert.deepEqual(await readdir(answer.trashedTo).then((names) => names.sort()), ['.chamber', 'system.json', 'tokens.css']);
  });

  test('a delete with nothing naming it leaves the settings alone', async (t) => {
    const { ctx, store } = await setup(t, { settings: { systemDefault: { choice: 'none' } } });
    await store.create({ name: 'Acme' });
    const answer = await store.trash('acme');
    assert.deepEqual(answer.clearedSettings, { default: false, pins: 0 });
    assert.deepEqual(ctx.settings.read().systemDefault, { choice: 'none' });
    assert.deepEqual(store.takeNotices(), []);
  });

  test('two deletes in the same second get distinct trash names', async (t) => {
    const { store } = await setup(t);
    await store.create({ name: 'Acme' });
    const first = await store.trash('acme');
    await store.create({ name: 'Acme' });
    const second = await store.trash('acme');
    assert.notEqual(first.trashedTo, second.trashedTo);
  });
});

describe('revision (AD-13)', () => {
  test('an agent change bumps the revision after the quiet period; no change, no bump', async (t) => {
    const { tmp, ctx, store } = await setup(t, { quietMs: 30 });
    await store.create({ name: 'Acme' });
    await writeFile(tmp.at('_systems/acme/tokens.css'), ':root { --brand: #123456; }\n');
    ctx.hub.emit({ slug: null, kind: 'system', system: 'acme', systemChange: 'files', files: ['tokens.css'] });
    await sleep(150);
    assert.equal((await store.detail('acme')).revision, 2);
    ctx.hub.emit({ slug: null, kind: 'system', system: 'acme', systemChange: 'files', files: ['tokens.css'] });
    await sleep(150);
    assert.equal((await store.detail('acme')).revision, 2);
  });

  test("the user's own writes are settled by their caller, not by the quiet timer", async (t) => {
    const { tmp, ctx, store } = await setup(t, { quietMs: 30 });
    await store.create({ name: 'Acme' });
    await sleep(60); // past any timer the creation itself could have started
    await writeFile(tmp.at('_systems/acme/tokens.css'), ':root { --brand: #654321; }\n');
    ctx.hub.emit({ slug: null, kind: 'system', system: 'acme', systemChange: 'files', files: ['tokens.css'], origin: 'user' });
    await sleep(120);
    assert.equal((await store.detail('acme')).revision, 1);
    await store.settleRevision('acme');
    assert.equal((await store.detail('acme')).revision, 2);
  });

  test('a layout-only edit is a new revision but keeps the reviews (layout is outside the section fingerprints)', async (t) => {
    const { tmp, store } = await setup(t);
    await store.create({ name: 'Acme' });
    const json = (layout: Record<string, unknown>) =>
      JSON.stringify({ version: 1, ...layout, components: [{ id: 'button', name: 'Button', purpose: 'Starts an action.', ...('item' in layout ? { layout: layout.item } : {}) }] });
    await tmp.write('_systems/acme/system.json', json({}));
    await store.settleRevision('acme');
    await store.patch('acme', { review: { section: 'components', state: 'looks-good' } });
    await store.patch('acme', { status: 'ready' });
    const before = await store.detail('acme');
    assert.equal(before.review.components.state, 'looks-good');

    // Only hints change: an entry's own layout and a section default.
    await tmp.write('_systems/acme/system.json', JSON.stringify({ ...JSON.parse(json({ item: 'compact' })), layout: { components: 'table' } }));
    await store.settleRevision('acme');
    const after = await store.detail('acme');
    assert.equal(after.revision, before.revision + 1, 'system.json is in the content set, so the revision moves');
    assert.equal(after.components[0]?.layout, 'compact');
    assert.equal(after.boardLayout.sections.components, 'table');
    assert.equal(after.review.components.state, 'looks-good', 'the review holds');
    assert.equal(after.changesToReview, false, 'a Ready system has nothing new to review');
  });

  test('files outside the content set (records, staging, service folders) never bump it', async (t) => {
    const { tmp, store } = await setup(t);
    await store.create({ name: 'Acme' });
    await tmp.write('_systems/acme/BUILD.json', '{}');
    await tmp.write('_systems/acme/PROPOSAL.json', '{}');
    await tmp.write('_systems/acme/proposal/tokens.css', ':root{}');
    await tmp.write('_systems/acme/.versions/index.json', '{}');
    await store.settleRevision('acme');
    assert.equal((await store.detail('acme')).revision, 1);
    await tmp.write('_systems/acme/notes/history.md', 'Why.');
    await store.settleRevision('acme');
    assert.equal((await store.detail('acme')).revision, 2);
  });

  test('a hand-made system gets revision 1 and a state.json once it settles', async (t) => {
    const { tmp, store } = await setup(t);
    await tmp.write('_systems/kit/tokens.css', ':root { --a: 1px; }');
    await store.settleRevision('kit');
    const state = JSON.parse(await readFile(tmp.at('_systems/kit/.chamber/state.json'), 'utf8')) as { revision: { n: number }; name: string };
    assert.equal(state.revision.n, 1);
    assert.equal(state.name, 'Kit');
  });
});

describe('the systems index', () => {
  test('follows system events', async (t) => {
    const { store } = await setup(t);
    await sleep(30);
    assert.deepEqual(store.index(), []);
    await store.create({ name: 'Acme' });
    await sleep(60);
    assert.deepEqual(store.index().map((row) => row.id), ['acme']);
    await store.trash('acme');
    await sleep(60);
    assert.deepEqual(store.index(), []);
  });

  test('isDefault and pinnedFor come from the settings', async (t) => {
    const { store } = await setup(t, {
      settings: { systemDefault: { choice: 'system', id: 'acme', name: 'Acme' }, systemPins: [{ directory: '/abs/shop', choice: 'system', id: 'acme', name: 'Acme' }] },
    });
    await store.create({ name: 'Acme' });
    const [row] = await store.list();
    assert.equal(row?.isDefault, true);
    assert.deepEqual(row?.pinnedFor, ['/abs/shop']);
  });
});

describe('Phase 2.6 AD-14: swatches and created for the library tile', () => {
  const colour = (text: string, group: 'brand' | 'surface' | null = null, section: 'colours' | 'spacing' = 'colours') => ({ section, group, light: { text, editable: 'ok' as const, problem: null } });

  test('swatchesOf: light colour values, brand first, valid colours only, each once, at most six', () => {
    assert.deepEqual(
      swatchesOf([
        colour('#ffffff', 'surface'),
        colour('#1a73e8', 'brand'),
        colour('8px', null, 'spacing'),
        colour('var(--brand-500)'),
        colour('url(javascript:alert(1))'),
        colour('#ffffff', 'surface'),
        colour('red; background: url(x)'),
        colour('rgb(10 20 30)'),
        colour('#000', 'brand'),
        { section: 'colours' as const, group: null, light: null },
        colour('#111111'),
        colour('#222222'),
        colour('#333333'),
      ]),
      ['#1a73e8', '#000', '#ffffff', 'rgb(10 20 30)', '#111111', '#222222'],
    );
    assert.deepEqual(swatchesOf([]), []);
  });
});
