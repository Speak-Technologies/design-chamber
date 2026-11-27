// BUILD.json and the pure half of a repo home (documentation/specs/phase-2-5-technical.md §2.13, §5.9):
// parseBuildJson's required fields and tolerant optionals, the path shapes it refuses (`..`, dot
// segments, UNC, relative), repoHomeShapeProblem's closed reasons, and the living-page mark reader.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseSystemQuestions } from '../../src/shared/agent/system-questions.ts';
import { BUILD_PLATFORMS, buildProblemSentence, parseBuildJson, parseSystemState } from '../../src/shared/system-json.ts';
import { repoHomeShapeProblem, type OtherRepoHome, type RepoHomeRequest } from '../../src/shared/systems.ts';
import type { BuildProblemReason } from '../../src/shared/types.ts';
import { readLivingPageMark } from '../../src/service/systems/living-safe.ts';

const TICKET = 'sb_0123456789ab';
const repoBuild = (repo: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, ticket: TICKET, name: 'Acme', home: 'repo', repo, ...extra });
const REPO = { directory: '/home/you/shop', folder: 'design-system', livingPage: 'design-system/index.html' };

describe('parseBuildJson', () => {
  test('a full repo record parses; unknown keys stay on raw', () => {
    const parsed = parseBuildJson(
      repoBuild(REPO, {
        code: { directory: '/home/you/shop/src' },
        mode: 'fix',
        dark: true,
        access: 'dev',
        round: 'done',
        calls: [{ topic: 'radius', choice: 'soft', note: 'rounder buttons' }],
        applied: { at: '2026-11-20T10:00:00.000Z', parts: ['system-files', 'living-page'], skipped: [] },
        future: 1,
      }),
    );
    assert.equal(parsed.unreadable, null);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(parsed.build?.repo, REPO);
    assert.equal(parsed.build?.ticket, TICKET);
    assert.deepEqual(parsed.build?.code, { directory: '/home/you/shop/src' });
    assert.deepEqual(parsed.build?.applied, { at: '2026-11-20T10:00:00.000Z', parts: ['system-files', 'living-page'], skipped: [] });
    assert.equal(parsed.raw?.future, 1);
  });

  test('an internal record needs only a name and a home', () => {
    const parsed = parseBuildJson('\uFEFF{"home":"internal","name":"  Acme  "}');
    assert.equal(parsed.unreadable, null);
    assert.equal(parsed.build?.name, 'Acme');
    assert.equal(parsed.build?.repo, null);
    assert.equal(parsed.build?.ticket, null);
  });

  test('not JSON, not an object, no home, no name or too large is unreadable', () => {
    for (const text of ['{', '[]', '"x"', '{"name":"Acme"}', '{"home":"cloud","name":"Acme"}', '{"home":"internal"}', '{"home":"internal","name":""}', `{"home":"internal","name":"${'a'.repeat(61)}"}`]) {
      const parsed = parseBuildJson(text);
      assert.equal(parsed.build, null, text);
      assert.notEqual(parsed.unreadable, null, text);
    }
    assert.equal(parseBuildJson(`{"home":"internal","name":"Acme","pad":"${'x'.repeat(70_000)}"}`).unreadable, 'BUILD.json is larger than 64 KB.');
  });

  test('a repo home refuses traversal, dot and badly shaped paths, UNC and relative directories', () => {
    const hostile: Record<string, unknown>[] = [
      { ...REPO, folder: '../outside' },
      { ...REPO, folder: 'design-system/../../x' },
      { ...REPO, folder: '.git/ds' },
      { ...REPO, folder: 'ds/.hidden' },
      { ...REPO, folder: '/abs/ds' },
      { ...REPO, folder: 'ds\\win' },
      { ...REPO, folder: 'a/b/c/d/e/f' },
      { ...REPO, livingPage: '../index.html' },
      { ...REPO, livingPage: 'design-system/index.htm' },
      { ...REPO, livingPage: 'design-system/.page.html' },
      { ...REPO, directory: 'shop' },
      { ...REPO, directory: './shop' },
      { ...REPO, directory: '\\\\server\\share\\shop' },
      { ...REPO, directory: '//server/share/shop' },
      { ...REPO, directory: 'C:shop' },
      { ...REPO, directory: 42 },
      { directory: '/home/you/shop' },
    ];
    for (const repo of hostile) {
      const parsed = parseBuildJson(repoBuild(repo));
      assert.equal(parsed.build, null, JSON.stringify(repo));
      assert.notEqual(parsed.unreadable, null, JSON.stringify(repo));
    }
    assert.equal(parseBuildJson('{"home":"repo","name":"Acme"}').build, null, 'a repo home without repo');
  });

  test('a wrong optional field is dropped with a problem, the default kept', () => {
    const parsed = parseBuildJson(
      JSON.stringify({ home: 'internal', name: 'Acme', ticket: 'nope', code: { directory: 'src' }, mode: 'loud', dark: 'yes', round: 3, applied: { at: 'soon' }, proposal: '../x', repo: 'shop' }),
    );
    assert.equal(parsed.unreadable, null);
    const build = parsed.build;
    assert.ok(build !== null);
    assert.equal(build.ticket, null);
    assert.equal(build.code, null);
    assert.equal(build.mode, 'none');
    assert.equal(build.dark, false);
    assert.equal(build.round, 1);
    assert.equal(build.applied, null);
    assert.equal(build.proposal, null);
    assert.equal(build.repo, null);
    assert.deepEqual(parsed.problems.map((problem) => problem.entry).sort(), ['applied', 'code', 'dark', 'mode', 'proposal', 'repo', 'round', 'ticket']);
  });
});

describe('repoHomeShapeProblem', () => {
  const SKIP = new Set(['node_modules', 'dist', 'build']);
  const base = { repoReal: '/home/you/shop', projectDirectory: '/home/you/shop', designsRoot: '/home/you/Documents/Designs', others: [] as OtherRepoHome[], foldsCase: false, skipDirs: SKIP };
  const check = (request: Partial<RepoHomeRequest>, context: Partial<typeof base> = {}): { reason: BuildProblemReason; value: string } | null =>
    repoHomeShapeProblem({ ...REPO, ...request }, { ...base, ...context });

  test('a repo equal to the project or inside it passes', () => {
    assert.equal(check({}), null);
    assert.equal(check({ directory: '/home/you/shop/packages/web' }, { repoReal: '/home/you/shop/packages/web' }), null);
  });

  test('a repo outside the project, or above it (a monorepo root), is repo-outside-project', () => {
    assert.equal(check({ directory: '/home/you/other' }, { repoReal: '/home/you/other' })?.reason, 'repo-outside-project');
    assert.equal(check({ directory: '/home/you' }, { repoReal: '/home/you', projectDirectory: '/home/you/shop/packages/web' })?.reason, 'repo-outside-project');
    assert.equal(check({}, { repoReal: '/home/you/shopping' })?.reason, 'repo-outside-project', 'a name prefix is not inside');
  });

  test('a SKIP_DIRS segment in the folder or the living page is refused, any case', () => {
    assert.deepEqual(check({ folder: 'node_modules/ds' }), { reason: 'repo-outside-project', value: 'node_modules' });
    assert.equal(check({ livingPage: 'Dist/index.html' })?.reason, 'repo-outside-project');
  });

  test('dot segments and traversal never reach the containment checks', () => {
    for (const folder of ['..', '../x', '.git', 'a/./b', 'a//b']) assert.equal(check({ folder })?.reason, 'unreadable', folder);
    assert.equal(check({ livingPage: 'design-system/index.txt' })?.reason, 'unreadable');
  });

  test('the designs root is never the system folder, inside it or around it', () => {
    const inRepo = { designsRoot: '/home/you/shop/Designs' };
    assert.equal(check({ folder: 'Designs' }, inRepo)?.reason, 'repo-outside-project', 'the folder is the designs root');
    assert.equal(check({ folder: 'Designs/acme', livingPage: 'ds/index.html' }, inRepo)?.reason, 'repo-outside-project', 'the folder is inside it');
    assert.equal(check({ folder: 'design-system' }, { designsRoot: '/home/you/shop/design-system/Designs' })?.reason, 'repo-outside-project', 'the folder contains it');
    assert.equal(check({ folder: 'design-system' }, inRepo), null, 'a sibling folder is fine');
  });

  test('another system overlapping the folder, or sharing the living page, is repo-overlap naming it', () => {
    const other = (folder: string, livingPage: string): OtherRepoHome => ({ id: 'brand', name: 'Brand', directory: '/home/you/shop', folder, livingPage });
    assert.deepEqual(check({}, { others: [other('design-system', 'brand.html')] }), { reason: 'repo-overlap', value: 'Brand' });
    assert.equal(check({}, { others: [other('design-system/inner', 'brand.html')] })?.reason, 'repo-overlap', 'inside ours');
    assert.equal(check({ folder: 'design-system/acme', livingPage: 'acme.html' }, { others: [other('design-system', 'b.html')] })?.reason, 'repo-overlap', 'around ours');
    assert.equal(check({ folder: 'acme', livingPage: 'pages/ds.html' }, { others: [other('brand', 'pages/ds.html')] })?.reason, 'repo-overlap', 'the same living page');
    assert.equal(check({ folder: 'acme', livingPage: 'acme.html' }, { others: [other('brand', 'brand.html')] }), null);
  });

  test('a living-page clash that differs only in case counts where the filesystem folds case', () => {
    const others = [{ id: 'brand', name: 'Brand', directory: '/home/you/shop', folder: 'brand', livingPage: 'Pages/DS.html' }];
    assert.equal(check({ folder: 'acme', livingPage: 'pages/ds.html' }, { others, foldsCase: true })?.reason, 'repo-overlap');
    assert.equal(check({ folder: 'acme', livingPage: 'pages/ds.html' }, { others, foldsCase: false }), null);
    assert.equal(check({ folder: 'BRAND' }, { others, foldsCase: true })?.reason, 'repo-overlap', 'a folder clash folds too');
  });
});

describe('readLivingPageMark', () => {
  const HASH = 'a'.repeat(64);
  const content = `design-chamber/living-page@1 system=acme revision=7 generated=2026-11-20T10:00:00.000Z hash=${HASH}`;
  test('reads the mark from the head, either quote style', () => {
    assert.deepEqual(readLivingPageMark(`<html><head><meta name="dc-living-page" content="${content}"></head></html>`), { system: 'acme', revision: 7, generated: '2026-11-20T10:00:00.000Z', hash: HASH });
    assert.equal(readLivingPageMark(`<meta content='${content}' name='dc-living-page'>`)?.system, 'acme');
  });
  test('no mark, another name or a wrong shape is null', () => {
    assert.equal(readLivingPageMark('<html><head><title>Ours</title></head></html>'), null);
    assert.equal(readLivingPageMark(`<meta name="description" content="${content}">`), null);
    assert.equal(readLivingPageMark(`<meta name="dc-living-page" content="${content.replace('system=acme', 'system=../x')}">`), null);
    assert.equal(readLivingPageMark(`<meta name="dc-living-page" content="${content.replace(HASH, 'zz')}">`), null);
    assert.equal(readLivingPageMark(`<meta name="dc-living-page" content="${content.replace('2026-11-20T10:00:00.000Z', 'later')}">`), null);
  });
});

describe('buildProblemSentence', () => {
  test('repo-outside-project carries the monorepo sentence; home-changed names the system and the repo', () => {
    const state = parseSystemState({ v: 1, name: 'Acme', buildProblem: { reason: 'repo-outside-project', value: '/x' } }, 'acme', '2026-11-20T10:00:00.000Z');
    assert.equal(
      buildProblemSentence(state),
      'The repo must be the project this chat is in, or a folder inside it. To use a folder above it, such as the root of a monorepo, open a chat in that folder and run /design-system there.',
    );
    const changed = { ...state, buildProblem: { reason: 'home-changed' as const, value: '' }, home: { kind: 'repo' as const, directory: '/home/you/shop', folder: 'ds', livingPage: 'ds/index.html', adoptedAt: '2026-11-20T10:00:00.000Z' } };
    assert.equal(buildProblemSentence(changed), "Acme already has files in shop, so its home can't change. Make a new system to move it.");
  });
});

describe('system-builder-depth T3: BUILD.json depth and platforms', () => {
  const internal = (extra: Record<string, unknown>): string => JSON.stringify({ version: 1, name: 'Acme', home: 'internal', ...extra });

  test('the platforms ids BUILD.json accepts are the interview\'s own, and depth is the round-one depth choices', () => {
    const set = parseSystemQuestions(readFileSync(path.resolve(import.meta.dirname, '../../rules/SYSTEM-QUESTIONS.md'), 'utf8'));
    const choices = (round: typeof set.roundOne, topic: string): string[] => (round.find((question) => question.topic === topic)?.options ?? []).map((option) => option.choice);
    assert.deepEqual([...choices(set.roundTwo, 'platforms')].sort(), [...BUILD_PLATFORMS].sort());
    assert.deepEqual([...choices(set.roundOne, 'depth')].sort(), ['core', 'full', 'tokens']);
  });

  test('each depth and a platforms list read as written', () => {
    for (const depth of ['tokens', 'core', 'full']) {
      const parsed = parseBuildJson(internal({ depth, platforms: ['laptop-phone'] }));
      assert.deepEqual(parsed.problems, [], depth);
      assert.equal(parsed.build?.depth, depth);
      assert.deepEqual(parsed.build?.platforms, ['laptop-phone']);
    }
    assert.deepEqual(parseBuildJson(internal({ platforms: ['phone-first', 'custom'] })).build?.platforms, ['phone-first', 'custom']);
  });

  test('absent or null: no key on the build, no problem (an older record reads exactly as before)', () => {
    for (const extra of [{}, { depth: null, platforms: null }]) {
      const parsed = parseBuildJson(internal(extra));
      assert.deepEqual(parsed.problems, []);
      assert.ok(parsed.build !== null && !Object.hasOwn(parsed.build, 'depth') && !Object.hasOwn(parsed.build, 'platforms'));
    }
  });

  test('depth "huge" is a problem on depth only, and the build is still adopted', () => {
    const parsed = parseBuildJson(internal({ depth: 'huge', mode: 'fix', dark: true }));
    assert.equal(parsed.unreadable, null);
    assert.notEqual(parsed.build, null);
    assert.deepEqual(parsed.problems, [{ entry: 'depth', message: 'depth in BUILD.json must be tokens, core or full.' }]);
    assert.ok(!Object.hasOwn(parsed.build ?? {}, 'depth'));
    assert.equal(parsed.build?.mode, 'fix', 'the other fields stand');
    assert.equal(parsed.build?.dark, true);
    for (const depth of [1, 'Core', ['core'], '']) assert.deepEqual(parseBuildJson(internal({ depth })).problems.map((p) => p.entry), ['depth'], JSON.stringify(depth));
  });

  test('platforms off the closed set, repeated, over 4 or not a list is a problem on platforms only', () => {
    for (const platforms of [['tablet'], ['laptop', 'laptop'], ['laptop-phone', 'phone-first', 'laptop', 'custom', 'laptop'], 'laptop', [1], { 0: 'laptop' }]) {
      const parsed = parseBuildJson(internal({ platforms }));
      assert.notEqual(parsed.build, null, JSON.stringify(platforms));
      assert.deepEqual(parsed.problems.map((p) => p.entry), ['platforms'], JSON.stringify(platforms));
      assert.ok(!Object.hasOwn(parsed.build ?? {}, 'platforms'));
    }
    assert.deepEqual(parseBuildJson(internal({ platforms: [] })).build?.platforms, []);
  });

  test('a __proto__ key is ignored, never read as depth', () => {
    const parsed = parseBuildJson('{"version":1,"name":"Acme","home":"internal","__proto__":{"depth":"full"}}');
    assert.deepEqual(parsed.problems, []);
    assert.ok(!Object.hasOwn(parsed.build ?? {}, 'depth'));
    assert.equal(parsed.build?.depth, undefined);
  });
});

describe('Phase 2.6 AD-11: BUILD.json existing and its problem', () => {
  test('existing is a folder inside the project ("." is its root); a wrong shape is skipped with a problem', () => {
    assert.deepEqual(parseBuildJson(repoBuild(REPO, { existing: { folder: 'design-system' } })).build?.existing, { folder: 'design-system' });
    assert.deepEqual(parseBuildJson(repoBuild(REPO, { existing: { folder: '.' } })).build?.existing, { folder: '.' });
    const absent = parseBuildJson(repoBuild(REPO)).build;
    assert.ok(absent !== null && !('existing' in absent), 'an older record has no existing key at all');
    assert.ok(!('existing' in (parseBuildJson(repoBuild(REPO, { existing: null })).build ?? {})));
    for (const folder of ['../outside', '/abs/path', 'a/../b', 'C:\\x', '', 'a b', 42]) {
      const parsed = parseBuildJson(repoBuild(REPO, { existing: { folder } }));
      assert.notEqual(parsed.build, null, JSON.stringify(folder));
      assert.ok(!('existing' in (parsed.build ?? {})), JSON.stringify(folder));
      assert.deepEqual(parsed.problems.map((one) => one.entry), ['existing'], JSON.stringify(folder));
      // §19 item 5: the refused hint travels on, as text, so the service can say it was ignored.
      assert.equal(parsed.existingRefused, typeof folder === 'string' ? folder : JSON.stringify({ folder }), JSON.stringify(folder));
    }
    assert.equal(parseBuildJson(repoBuild(REPO, { existing: 'design-system' })).existingRefused, 'design-system');
    assert.equal(parseBuildJson(repoBuild(REPO, { existing: [1] })).existingRefused, '[1]');
    assert.equal(parseBuildJson(repoBuild(REPO, { existing: { folder: `/${'x'.repeat(200)}` } })).existingRefused?.length, 80);
    assert.ok(!('existingRefused' in parseBuildJson(repoBuild(REPO, { existing: { folder: 'design-system' } }))), 'an accepted hint is not refused');
    assert.ok(!('existingRefused' in parseBuildJson(repoBuild(REPO))));
  });

  test('existing-outside-project has its own sentence', () => {
    const state = parseSystemState({ v: 1, name: 'Acme', buildProblem: { reason: 'existing-outside-project', value: 'linked' } }, 'acme', '2026-11-20T10:00:00.000Z');
    assert.equal(buildProblemSentence(state), 'The existing system must be a folder inside the project this chat is in, so Design Chamber ignored it.');
  });
});
