// Copy-on-link (documentation/specs/phase-2-5-technical.md §5.4, §2.6, AD-5, AD-7) and the agent's
// recorded choice (§5.5, AD-6), against a real design store, real design history and a real system
// store in a temp designs root: the plan's contents, version first, stamps, the settled and Ready
// refusals, staging/swap/recovery, a restore bringing the link back, the agent's choice acted on once.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { ServiceContext } from '../../../src/service/context.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { createChoiceReconciler } from '../../../src/service/systems/choice.ts';
import {
  createLinkService,
  designSystemStamp,
  familiesIn,
  isCopyReference,
  LINK_FOLDER_LINK_MESSAGE,
  LINK_STALE_MESSAGE,
  LINK_SYSTEM_GONE_MESSAGE,
  linkBeingChangedMessage,
  linkDraftMessage,
  LinkRefusal,
  planCopy,
  recoverCopy,
  SYSTEM_CSS_TEXT,
  type LinkService,
} from '../../../src/service/systems/link.ts';
import { createSystemStore, type SystemStore } from '../../../src/service/systems/store.ts';
import { createVersionsService, type VersionsService } from '../../../src/service/versions.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

const TOKENS = ':root {\n  --brand-500: #1a73e8;\n  --font-sans: "Inter", system-ui, sans-serif;\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand-500: #8ab4f8;\n  }\n}\n';
const SYSTEM_JSON = `${JSON.stringify(
  {
    version: 1,
    tokens: { '--font-sans': { section: 'typography' } },
    type: [{ id: 'mono', name: 'Mono', family: '"Plex Mono", monospace', size: '14px' }],
    fonts: [
      { file: 'assets/fonts/inter-400.woff2', family: 'Inter', weight: 400, style: 'normal' },
      { file: 'assets/fonts/plex-mono.ttf', family: 'Plex Mono', weight: 400, style: 'italic' },
      { file: 'assets/fonts/unused.woff2', family: 'Unused Sans', weight: 700, style: 'normal' },
    ],
    logos: [{ file: 'assets/logos/acme.svg', variant: 'primary', note: '' }],
    components: [{ id: 'button', name: 'Button', example: 'components/button.html' }],
    notes: [{ id: 'history', title: 'History' }],
    sources: [{ file: 'sources/brand.pdf', note: 'Brand book.' }],
  },
  null,
  2,
)}\n`;
const PAGE = '<!doctype html><html><head><link rel="stylesheet" href="system/system.css"><link rel="stylesheet" href="tokens.css"></head><body><h1>Checkout</h1></body></html>';

type Rig = {
  tmp: TmpRoot;
  ctx: FakeContext & ServiceContext;
  systems: SystemStore;
  versions: VersionsService;
  link: LinkService;
  slug: string;
  id: string;
  stamp(): Promise<string>;
};

const writeSystem = async (tmp: TmpRoot, id: string): Promise<void> => {
  await tmp.write(`_systems/${id}/tokens.css`, TOKENS);
  await tmp.write(`_systems/${id}/system.json`, SYSTEM_JSON);
  await tmp.write(`_systems/${id}/OVERVIEW.md`, 'Acme in one paragraph.\n');
  await tmp.write(`_systems/${id}/notes/history.md`, 'Why the palette changed.\n');
  await tmp.write(`_systems/${id}/components/button.html`, '<button>Go</button>\n');
  await tmp.write(`_systems/${id}/assets/fonts/inter-400.woff2`, Buffer.from('wOF2-inter'));
  await tmp.write(`_systems/${id}/assets/fonts/plex-mono.ttf`, Buffer.from('ttf-plex'));
  await tmp.write(`_systems/${id}/assets/fonts/unused.woff2`, Buffer.from('wOF2-unused'));
  await tmp.write(`_systems/${id}/assets/logos/acme.svg`, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await tmp.write(`_systems/${id}/sources/brand.pdf`, '%PDF-1.4 brand');
};

const setup = async (t: TestContext): Promise<Rig> => {
  const tmp = await useTmpRoot(t);
  const fake = createFakeContext({ root: tmp.root });
  t.after(() => fake.dispose());
  const store = createDesignStore({ settings: fake.settings, log: fake.log, hub: fake.hub });
  const ctx = Object.assign(fake, { store });
  const systems = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, quietMs: 600_000, indexRefreshMs: 5 });
  t.after(() => systems.dispose());
  const versions = createVersionsService({ store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 600_000 });
  const link = createLinkService({ store, versions, systems, selfWrites: ctx.selfWrites, hub: ctx.hub, log: ctx.log, root: () => tmp.root });
  const { id } = await systems.create({ name: 'Acme' });
  await writeSystem(tmp, id);
  await systems.patch(id, { status: 'ready' });
  const created = await store.create({ kind: 'page', title: 'Checkout', html: PAGE });
  await tmp.write(`${created.slug}/tokens.css`, ':root {\n  --brand-500: tomato;\n  --own-gap: 3px;\n}\n');
  const slug = created.slug;
  return { tmp, ctx, systems, versions, link, slug, id, stamp: async () => (await link.view(slug)).stamp };
};

const listCopy = async (dir: string, prefix = ''): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listCopy(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
};

const rejectsWith = async (promise: Promise<unknown>, code: string, message: string): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
};

describe('planCopy (pure)', () => {
  test('copies tokens.css, the entry, used fonts only, every logo and the reference; never sources', async (t) => {
    const tmp = await useTmpRoot(t);
    await writeSystem(tmp, 'acme');
    const files = ['tokens.css', 'system.json', 'OVERVIEW.md', 'notes/history.md', 'components/button.html', 'assets/fonts/inter-400.woff2', 'assets/fonts/plex-mono.ttf', 'assets/fonts/unused.woff2', 'assets/logos/acme.svg', 'sources/brand.pdf', 'BUILD.json'];
    const detail = buildSystemDetail({
      id: 'acme',
      dir: tmp.at('_systems/acme'),
      state: parseSystemState(null, 'acme', '2026-11-20T10:00:00.000Z'),
      systemJson: SYSTEM_JSON,
      tokensCss: TOKENS,
      texts: {},
      files: files.map((rel) => ({ rel, bytes: 1 })),
      build: null,
    });
    const plan = planCopy(files, detail);
    const targets = plan.entries.map((entry) => entry.to).sort();
    assert.deepEqual(targets, ['OVERVIEW.md', 'components/button.html', 'fonts.css', 'fonts/inter-400.woff2', 'fonts/plex-mono.ttf', 'logos/acme.svg', 'notes/history.md', 'system.css', 'system.json', 'tokens.css']);
    const text = (to: string): string => {
      const entry = plan.entries.find((one) => one.to === to);
      assert.ok(entry !== undefined && 'text' in entry, to);
      return entry.text;
    };
    assert.equal(text('system.css'), SYSTEM_CSS_TEXT);
    assert.equal(SYSTEM_CSS_TEXT, '@import "fonts.css";\n@import "tokens.css";\n');
    const fontsCss = text('fonts.css');
    assert.match(fontsCss, /font-family: "Inter";\n  src: url\("fonts\/inter-400\.woff2"\) format\("woff2"\);\n  font-weight: 400;\n  font-style: normal;\n  font-display: swap;/);
    assert.match(fontsCss, /font-family: "Plex Mono";\n  src: url\("fonts\/plex-mono\.ttf"\) format\("truetype"\);\n  font-weight: 400;\n  font-style: italic;/);
    assert.doesNotMatch(fontsCss, /Unused|unused/);
    assert.equal(plan.entries.find((one) => one.to === 'tokens.css' && 'from' in one && one.from === 'tokens.css') !== undefined, true);
  });

  test('pattern and brand bodies travel as agent reference; other files in those folders do not (S8, §2.11)', () => {
    const files = ['patterns/voice.md', 'brand/hero.md', 'patterns/deep/x.md', 'brand/hero.png', 'patterns/voice.txt', 'sources/brand.pdf'];
    const plan = planCopy(files, { fonts: [], logos: [], icons: [], type: [], tokens: [] });
    assert.deepEqual(plan.entries.map((one) => one.to).sort(), ['brand/hero.md', 'fonts.css', 'patterns/voice.md', 'system.css', 'tokens.css']);
    for (const rel of ['patterns/voice.md', 'brand/hero.md']) assert.equal(isCopyReference(rel), true, rel);
  });

  test('a system without tokens.css still gets one (empty), so system.css always resolves', () => {
    const plan = planCopy([], { fonts: [], logos: [], icons: [], type: [], tokens: [] });
    assert.deepEqual(plan.entries.map((one) => one.to).sort(), ['fonts.css', 'system.css', 'tokens.css']);
  });

  test('familiesIn reads quoted and bare family names, ignoring case', () => {
    assert.deepEqual(familiesIn('"Plex Mono", \'Inter\' , system-ui,  SANS-SERIF'), ['plex mono', 'inter', 'system-ui', 'sans-serif']);
  });

  test('the agent reference and COPY.json are never export material', () => {
    for (const rel of ['OVERVIEW.md', 'system.json', 'notes/a.md', 'patterns/a.md', 'brand/a.md', 'components/a.html', 'COPY.json']) assert.equal(isCopyReference(rel), true, rel);
    for (const rel of ['tokens.css', 'fonts.css', 'system.css', 'fonts/a.woff2', 'logos/a.svg']) assert.equal(isCopyReference(rel), false, rel);
  });
});

describe('link, change, update', () => {
  test('a link takes a version first, stages, swaps and writes COPY.json last naming that version', async (t) => {
    const rig = await setup(t);
    const answer = await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    assert.equal(answer.notice, 'linked');
    assert.ok(answer.before !== null);
    assert.equal(answer.before.reason, 'system-change');
    assert.deepEqual(answer.status, { state: 'linked', id: rig.id, name: 'Acme', linkState: 'ok' });

    const copyDir = rig.tmp.at(`${rig.slug}/system`);
    assert.deepEqual(await listCopy(copyDir), ['COPY.json', 'OVERVIEW.md', 'components/button.html', 'fonts.css', 'fonts/inter-400.woff2', 'fonts/plex-mono.ttf', 'logos/acme.svg', 'notes/history.md', 'system.css', 'system.json', 'tokens.css']);
    assert.equal(await rig.tmp.read(`${rig.slug}/system/tokens.css`), TOKENS, 'tokens.css is a byte copy');
    const copy = JSON.parse(await rig.tmp.read(`${rig.slug}/system/COPY.json`));
    assert.equal(copy.v, 1);
    assert.equal(copy.id, rig.id);
    assert.equal(copy.by, 'user');
    assert.equal(copy.before, answer.before.id);
    const state = await rig.systems.readState(rig.id);
    assert.equal(copy.revision, state.revision.n);
    assert.equal(copy.treeHash, state.revision.treeHash);
    assert.equal(copy.files['tokens.css'], sha(TOKENS));
    assert.equal(Object.hasOwn(copy.files, 'COPY.json'), false);

    // The design's own tokens.css is untouched: its declaration stays an override.
    const view = await rig.link.view(rig.slug);
    assert.deepEqual(view.overrides, [{ name: '--brand-500', value: 'tomato', systemValue: '#1a73e8' }]);
    assert.equal(view.ownTokens, 1);
    assert.deepEqual(view.copy, { complete: true, missing: [], drift: [], invalid: false });
    assert.equal((await rig.ctx.store.get(rig.slug)).state.systemDecision, 'system');

    // No leftovers in .chamber; the change event is the user's, under system/.
    assert.deepEqual((await readdir(rig.tmp.at(`${rig.slug}/.chamber`))).filter((name) => name.startsWith('system-')), []);
    const event = rig.ctx.events.find((one) => one.slug === rig.slug && one.kind === 'files');
    assert.ok(event !== undefined);
    assert.equal(event.origin, 'user');
    assert.ok(event.files?.includes('system/COPY.json'));
    assert.equal(await rig.ctx.selfWrites.isEcho(rig.slug, 'system/tokens.css', rig.tmp.at(rig.slug)), true, 'the watcher sees it as our own write');
  });

  test('the same system and revision again answers unchanged without a version', async (t) => {
    const rig = await setup(t);
    await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    const count = (await rig.versions.list(rig.slug)).versions.length;
    const again = await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    assert.equal(again.notice, 'unchanged');
    assert.equal(again.before, null);
    assert.equal((await rig.versions.list(rig.slug)).versions.length, count);
  });

  test('a stale stamp is refused with nothing changed and no version taken', async (t) => {
    const rig = await setup(t);
    const stamp = await rig.stamp();
    await rig.tmp.write(`${rig.slug}/tokens.css`, ':root { --brand-500: teal; }\n');
    await rejectsWith(rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp, reason: 'system-change' }), 'stale', LINK_STALE_MESSAGE);
    assert.equal((await rig.versions.list(rig.slug)).versions.length, 0);
    assert.equal(await lstat(rig.tmp.at(`${rig.slug}/system`)).catch(() => null), null);
  });

  test('Draft, gone and being-changed systems are refused before any version', async (t) => {
    const rig = await setup(t);
    await rig.systems.patch(rig.id, { status: 'draft' });
    await rejectsWith(rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' }), 'invalid', linkDraftMessage('Acme'));
    await rejectsWith(rig.link.link(rig.slug, { to: 'nobody', by: 'user', stamp: await rig.stamp(), reason: 'system-change' }), 'invalid', LINK_SYSTEM_GONE_MESSAGE);
    await rig.systems.patch(rig.id, { status: 'ready' });
    // The agent just wrote into the system (a non-user change): not settled.
    rig.ctx.hub.emit({ slug: null, kind: 'system', system: rig.id, systemChange: 'files' });
    await assert.rejects(rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' }), (error: unknown) => {
      assert.ok(error instanceof LinkRefusal);
      assert.equal(error.code, 'conflict');
      assert.equal(error.reason, 'being-changed');
      assert.equal(error.message, linkBeingChangedMessage('Acme'));
      return true;
    });
    assert.equal((await rig.versions.list(rig.slug)).versions.length, 0);
  });

  test('a system path that is a link or a file is never replaced', async (t) => {
    const rig = await setup(t);
    const outside = await useTmpRoot(t);
    await outside.write('keep.txt', 'mine');
    await symlink(outside.root, rig.tmp.at(`${rig.slug}/system`), 'dir');
    await rejectsWith(rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' }), 'invalid', LINK_FOLDER_LINK_MESSAGE);
    assert.deepEqual(await readdir(outside.root), ['keep.txt']);
    await rm(rig.tmp.at(`${rig.slug}/system`));
    await rig.tmp.write(`${rig.slug}/system`, 'a file');
    await rejectsWith(rig.link.link(rig.slug, { to: 'none', by: 'user', stamp: await rig.stamp(), reason: 'system-change' }), 'invalid', LINK_FOLDER_LINK_MESSAGE);
  });

  test('update replaces only system/: overrides stay, the notice says updated, the version holds the old copy', async (t) => {
    const rig = await setup(t);
    await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    await rig.tmp.write(`_systems/${rig.id}/tokens.css`, TOKENS.replace('#1a73e8', '#0b57d0'));
    await rig.systems.settleRevision(rig.id);
    const revision = (await rig.systems.readState(rig.id)).revision.n;
    const preview = await rig.link.preview(rig.slug, rig.id);
    assert.deepEqual(preview.tokens.changed, [{ name: '--brand-500', from: '#1a73e8', to: '#0b57d0' }]);
    assert.deepEqual(preview.overrides, ['--brand-500']);
    assert.equal(preview.toRevision, revision);
    // A stale preview revision is refused.
    await rejectsWith(rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: preview.stamp, reason: 'system-update', toRevision: revision + 1 }), 'stale', LINK_STALE_MESSAGE);
    const updated = await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: preview.stamp, reason: 'system-update', toRevision: revision });
    assert.equal(updated.notice, 'updated');
    assert.equal(updated.before?.reason, 'system-update');
    assert.match(await rig.tmp.read(`${rig.slug}/system/tokens.css`), /#0b57d0/);
    assert.match(await rig.tmp.read(`${rig.slug}/tokens.css`), /tomato/, "the design's own override is still there");
  });

  test('removing the system takes a version and deletes system/; a restore brings the link back (Undo, AD-7)', async (t) => {
    const rig = await setup(t);
    await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    const linkedCopy = await rig.tmp.read(`${rig.slug}/system/COPY.json`);
    const removed = await rig.link.link(rig.slug, { to: 'none', by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    assert.equal(removed.notice, 'removed');
    assert.deepEqual(removed.status, { state: 'none' });
    assert.equal(await lstat(rig.tmp.at(`${rig.slug}/system`)).catch(() => null), null);
    assert.ok(removed.before !== null);

    await rig.versions.restore(rig.slug, removed.before.id);
    assert.equal(await rig.tmp.read(`${rig.slug}/system/COPY.json`), linkedCopy);
    const view = await rig.link.view(rig.slug);
    assert.deepEqual(view.status, { state: 'linked', id: rig.id, name: 'Acme', linkState: 'ok' });
    assert.equal(view.copy.complete, true);
  });

  test('none on a design without a copy only records the decision (no version)', async (t) => {
    const rig = await setup(t);
    const answer = await rig.link.link(rig.slug, { to: 'none', by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    assert.equal(answer.notice, 'unchanged');
    assert.deepEqual(answer.status, { state: 'none' });
    assert.equal((await rig.versions.list(rig.slug)).versions.length, 0);
  });

  test('at creation no version is taken and COPY.json says creation', async (t) => {
    const rig = await setup(t);
    const answer = await rig.link.link(rig.slug, { to: rig.id, by: 'creation', reason: 'system-change' });
    assert.equal(answer.before, null);
    assert.equal((await rig.versions.list(rig.slug)).versions.length, 0);
    const copy = JSON.parse(await rig.tmp.read(`${rig.slug}/system/COPY.json`));
    assert.equal(copy.by, 'creation');
    assert.equal(copy.before, null);
  });

  test('drift: a hand-changed copy file and a missing one show in the view', async (t) => {
    const rig = await setup(t);
    await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    await rig.tmp.write(`${rig.slug}/system/tokens.css`, TOKENS.replace('#1a73e8', '#000000'));
    await rm(rig.tmp.at(`${rig.slug}/system/logos/acme.svg`));
    const view = await rig.link.view(rig.slug);
    assert.deepEqual(view.copy, { complete: false, missing: ['logos/acme.svg'], drift: ['tokens.css'], invalid: false });
  });

  test('a COPY.json an agent broke reads as invalid', async (t) => {
    const rig = await setup(t);
    await rig.tmp.write(`${rig.slug}/system/COPY.json`, '{"v":1,"id":"../../x"}');
    const view = await rig.link.view(rig.slug);
    assert.deepEqual(view.status, { state: 'invalid' });
    assert.equal(view.copy.invalid, true);
    assert.equal(view.link, null);
  });
});

describe('staging, swap and recovery', () => {
  const makeCopy = async (rig: Rig): Promise<string> => {
    await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    return rig.tmp.read(`${rig.slug}/system/COPY.json`);
  };

  test('killed after the old copy moved aside and the new one was staged: recovery publishes the new copy', async (t) => {
    const rig = await setup(t);
    const record = await makeCopy(rig);
    const design = rig.tmp.at(rig.slug);
    // The state a crash between the two renames leaves: the staged copy complete, the old one aside.
    await cp(path.join(design, 'system'), path.join(design, '.chamber', 'system-incoming-aaaa'), { recursive: true });
    await rename(path.join(design, 'system'), path.join(design, '.chamber', 'system-replaced-aaaa'));
    await recoverCopy(design);
    assert.equal(await rig.tmp.read(`${rig.slug}/system/COPY.json`), record);
    assert.deepEqual((await readdir(path.join(design, '.chamber'))).filter((name) => name.startsWith('system-')), []);
  });

  test('killed before the staging was complete: recovery puts the old copy back and drops the half staging', async (t) => {
    const rig = await setup(t);
    const record = await makeCopy(rig);
    const design = rig.tmp.at(rig.slug);
    await mkdir(path.join(design, '.chamber', 'system-incoming-bbbb', 'fonts'), { recursive: true });
    await rig.tmp.write(`${rig.slug}/.chamber/system-incoming-bbbb/tokens.css`, 'half');
    await rename(path.join(design, 'system'), path.join(design, '.chamber', 'system-replaced-bbbb'));
    await recoverCopy(design);
    assert.equal(await rig.tmp.read(`${rig.slug}/system/COPY.json`), record);
    assert.deepEqual((await readdir(path.join(design, '.chamber'))).filter((name) => name.startsWith('system-')), []);
  });

  test('a staging whose COPY.json lists a file it lacks is not complete', async (t) => {
    const rig = await setup(t);
    await makeCopy(rig);
    const design = rig.tmp.at(rig.slug);
    await rename(path.join(design, 'system'), path.join(design, '.chamber', 'system-incoming-cccc'));
    await rm(path.join(design, '.chamber', 'system-incoming-cccc', 'fonts.css'));
    await recoverCopy(design);
    assert.equal(await lstat(path.join(design, 'system')).catch(() => null), null, 'neither copy is complete, so none is published');
    assert.deepEqual((await readdir(path.join(design, '.chamber'))).filter((name) => name.startsWith('system-')), []);
  });

  test('with system/ in place, leftovers are only removed', async (t) => {
    const rig = await setup(t);
    const record = await makeCopy(rig);
    await rig.tmp.write(`${rig.slug}/.chamber/system-replaced-dddd/tokens.css`, 'old');
    await rig.tmp.write(`${rig.slug}/.chamber/system-incoming-dddd/tokens.css`, 'new');
    await recoverCopy(rig.tmp.at(rig.slug));
    assert.equal(await rig.tmp.read(`${rig.slug}/system/COPY.json`), record);
    assert.deepEqual((await readdir(rig.tmp.at(`${rig.slug}/.chamber`))).filter((name) => name.startsWith('system-')), []);
  });

  test('an unlink whose cleanup failed stays removed: recovery deletes the leftover and never restores it', async (t) => {
    const rig = await setup(t);
    await makeCopy(rig);
    const design = rig.tmp.at(rig.slug);
    // The same rig, but the old copy can't be removed after the swap (a virus scanner holding a file).
    const stuck = createLinkService({
      store: rig.ctx.store,
      versions: rig.versions,
      systems: rig.systems,
      selfWrites: rig.ctx.selfWrites,
      hub: rig.ctx.hub,
      log: rig.ctx.log,
      root: () => rig.tmp.root,
      removeTree: () => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })),
    });
    const removed = await stuck.link(rig.slug, { to: 'none', by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    assert.equal(removed.notice, 'removed');
    assert.equal(await lstat(path.join(design, 'system')).catch(() => null), null);
    const leftovers = (await readdir(path.join(design, '.chamber'))).filter((name) => name.startsWith('system-'));
    assert.equal(leftovers.length, 1);
    assert.match(leftovers[0] ?? '', /^system-removed-[0-9a-f]{12}$/, 'an unlink leftover is named apart from a swap');

    await recoverCopy(design);
    assert.equal(await lstat(path.join(design, 'system')).catch(() => null), null, 'the removed system does not come back');
    assert.deepEqual((await readdir(path.join(design, '.chamber'))).filter((name) => name.startsWith('system-')), []);
    assert.deepEqual((await rig.link.view(rig.slug)).status, { state: 'none' });
  });

  test('at service start a removed copy with no system/ is deleted, not restored', async (t) => {
    const rig = await setup(t);
    await makeCopy(rig);
    const design = rig.tmp.at(rig.slug);
    await rename(path.join(design, 'system'), path.join(design, '.chamber', 'system-removed-ffff'));
    await rig.link.recoverAll();
    assert.equal(await lstat(path.join(design, 'system')).catch(() => null), null);
    assert.deepEqual((await readdir(path.join(design, '.chamber'))).filter((name) => name.startsWith('system-')), []);
  });

  test('a removed leftover never stands in for a replaced copy: an interrupted swap still restores the replaced one', async (t) => {
    const rig = await setup(t);
    const record = await makeCopy(rig);
    const design = rig.tmp.at(rig.slug);
    await cp(path.join(design, 'system'), path.join(design, '.chamber', 'system-removed-1111'), { recursive: true });
    await rig.tmp.write(`${rig.slug}/.chamber/system-removed-1111/COPY.json`, '{"stale":true}');
    await rename(path.join(design, 'system'), path.join(design, '.chamber', 'system-replaced-2222'));
    await recoverCopy(design);
    assert.equal(await rig.tmp.read(`${rig.slug}/system/COPY.json`), record);
    assert.deepEqual((await readdir(path.join(design, '.chamber'))).filter((name) => name.startsWith('system-')), []);
  });

  test('a link recovers leftovers first, then links', async (t) => {
    const rig = await setup(t);
    await rig.tmp.write(`${rig.slug}/.chamber/system-incoming-eeee/tokens.css`, 'half');
    const answer = await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: designSystemStamp(null, Buffer.from(await rig.tmp.read(`${rig.slug}/tokens.css`))), reason: 'system-change' });
    assert.equal(answer.notice, 'linked');
    assert.deepEqual((await readdir(rig.tmp.at(`${rig.slug}/.chamber`))).filter((name) => name.startsWith('system-')), []);
  });
});

describe('the agent recorded choice (§5.5)', () => {
  const writeChoice = async (rig: Rig, choice: string): Promise<void> => {
    const file = `${rig.slug}/design.json`;
    const json = JSON.parse(await rig.tmp.read(file));
    await rig.tmp.write(file, { ...json, systemChoice: choice });
  };

  test('a Ready id is linked by the agent once; the same value is never acted on twice', async (t) => {
    const rig = await setup(t);
    const reconciler = createChoiceReconciler({ ctx: rig.ctx, link: rig.link, retryMs: 5 });
    t.after(() => reconciler.stop());
    await writeChoice(rig, rig.id);
    await reconciler.reconcile(rig.slug);
    const copy = JSON.parse(await rig.tmp.read(`${rig.slug}/system/COPY.json`));
    assert.equal(copy.by, 'agent');
    const state = (await rig.ctx.store.get(rig.slug)).state;
    assert.equal(state.systemChoiceSeen, rig.id);
    assert.equal(state.systemDecision, 'system');
    const versions = (await rig.versions.list(rig.slug)).versions.length;
    // The agent event that carried the change (no origin) is not the user's.
    assert.ok(rig.ctx.events.some((one) => one.slug === rig.slug && one.kind === 'files' && one.origin === undefined));
    await reconciler.reconcile(rig.slug);
    await reconciler.reconcile(rig.slug);
    assert.equal((await rig.versions.list(rig.slug)).versions.length, versions);
  });

  test('an unknown or Draft id is a problem shown as a design warning, recorded as seen first', async (t) => {
    const rig = await setup(t);
    const reconciler = createChoiceReconciler({ ctx: rig.ctx, link: rig.link, retryMs: 5 });
    t.after(() => reconciler.stop());
    await writeChoice(rig, 'nobody');
    await reconciler.reconcile(rig.slug);
    let record = await rig.ctx.store.get(rig.slug);
    assert.deepEqual(record.state.systemChoiceProblem, { value: 'nobody', reason: 'unknown' });
    assert.equal(record.state.systemChoiceSeen, 'nobody');
    assert.ok(record.warnings.some((one) => one.code === 'invalid-system-choice' && one.message.includes('"nobody"')));
    await rig.systems.patch(rig.id, { status: 'draft' });
    await writeChoice(rig, rig.id);
    await reconciler.reconcile(rig.slug);
    record = await rig.ctx.store.get(rig.slug);
    assert.deepEqual(record.state.systemChoiceProblem, { value: rig.id, reason: 'draft' });
    assert.equal(await lstat(rig.tmp.at(`${rig.slug}/system`)).catch(() => null), null);
  });

  test('a choice problem reaches the guests: a comments event after the state write, none for a repeat', async (t) => {
    const rig = await setup(t);
    const reconciler = createChoiceReconciler({ ctx: rig.ctx, link: rig.link, retryMs: 5 });
    t.after(() => reconciler.stop());
    const stateFile = rig.tmp.at(`${rig.slug}/.chamber/state.json`);
    /** What state.json held at the moment each `comments` event for the design was emitted. */
    const seen: unknown[] = [];
    rig.ctx.hub.subscribe((event) => {
      if (event.slug !== rig.slug || event.kind !== 'comments') return;
      seen.push((JSON.parse(readFileSync(stateFile, 'utf8')) as { systemChoiceProblem?: unknown }).systemChoiceProblem);
    });
    await writeChoice(rig, 'nobody');
    await reconciler.reconcile(rig.slug);
    assert.deepEqual(seen, [{ value: 'nobody', reason: 'unknown' }]);
    await reconciler.reconcile(rig.slug);
    rig.ctx.hub.emit({ slug: rig.slug, kind: 'design' });
    await reconciler.idle();
    assert.equal(seen.length, 1);
    // The fix clears it, and that is announced too ("none" on an unlinked design).
    await writeChoice(rig, 'none');
    await reconciler.reconcile(rig.slug);
    assert.deepEqual(seen, [{ value: 'nobody', reason: 'unknown' }, undefined]);
  });

  test('"none" unlinks a linked design; on an unlinked one it only records the decision', async (t) => {
    const rig = await setup(t);
    const reconciler = createChoiceReconciler({ ctx: rig.ctx, link: rig.link, retryMs: 5 });
    t.after(() => reconciler.stop());
    await writeChoice(rig, 'none');
    await reconciler.reconcile(rig.slug);
    assert.equal((await rig.ctx.store.get(rig.slug)).state.systemDecision, 'none');
    assert.equal((await rig.versions.list(rig.slug)).versions.length, 0);
    await rig.link.link(rig.slug, { to: rig.id, by: 'user', stamp: await rig.stamp(), reason: 'system-change' });
    // The user's link took the agent's "none" as seen: it never undoes the user's choice.
    await reconciler.reconcile(rig.slug);
    assert.ok(await lstat(rig.tmp.at(`${rig.slug}/system`)).catch(() => null));
    await writeChoice(rig, rig.id);
    await reconciler.reconcile(rig.slug);
    await writeChoice(rig, 'none');
    await reconciler.reconcile(rig.slug);
    assert.equal(await lstat(rig.tmp.at(`${rig.slug}/system`)).catch(() => null), null);
  });

  test('being changed retries once after the quiet period, then stays a problem', async (t) => {
    const rig = await setup(t);
    const reconciler = createChoiceReconciler({ ctx: rig.ctx, link: rig.link, retryMs: 5 });
    t.after(() => reconciler.stop());
    rig.ctx.hub.emit({ slug: null, kind: 'system', system: rig.id, systemChange: 'files' });
    await writeChoice(rig, rig.id);
    await reconciler.reconcile(rig.slug);
    assert.deepEqual((await rig.ctx.store.get(rig.slug)).state.systemChoiceProblem, { value: rig.id, reason: 'being-changed' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await reconciler.idle();
    assert.deepEqual((await rig.ctx.store.get(rig.slug)).state.systemChoiceProblem, { value: rig.id, reason: 'being-changed' });
    assert.equal(await lstat(rig.tmp.at(`${rig.slug}/system`)).catch(() => null), null);
  });

  test('an unparseable design.json never triggers a link', async (t) => {
    const rig = await setup(t);
    const reconciler = createChoiceReconciler({ ctx: rig.ctx, link: rig.link, retryMs: 5 });
    t.after(() => reconciler.stop());
    await rig.tmp.write(`${rig.slug}/design.json`, `{"systemChoice": "${rig.id}", `);
    await reconciler.reconcile(rig.slug);
    assert.equal(await lstat(rig.tmp.at(`${rig.slug}/system`)).catch(() => null), null);
    assert.equal((await rig.ctx.store.get(rig.slug)).state.systemChoiceSeen, undefined);
  });
});
