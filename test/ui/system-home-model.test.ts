import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RepoResyncReview } from '../../src/shared/types.ts';
import {
  BANNER_MAX,
  driftLines,
  landedLine,
  readOnlyLine,
  repoHeaderLine,
  repoReviewModel,
  systemBanners,
  withoutRepeatedActions,
  type BannerSpec,
  type HomeDetail,
} from '../../src/ui/model/system-home-model.ts';

const NOW = Date.parse('2026-11-20T10:00:00.000Z');
const OPTIONS = { now: NOW, locale: 'en' };

const repoHome = (patch: Record<string, unknown> = {}): HomeDetail['home'] =>
  ({ kind: 'repo', directory: '/work/shop', label: 'shop', folder: 'design-system', livingPage: 'design-system/index.html', readable: true, problem: null, lastRead: '2026-11-17T10:00:00.000Z', ...patch }) as HomeDetail['home'];

const detail = (patch: Partial<HomeDetail> = {}): HomeDetail => ({
  name: 'Acme',
  home: repoHome(),
  unreadable: null,
  buildProblem: null,
  snapshot: null,
  landed: null,
  livingPage: null,
  changesToReview: false,
  codeDrift: null,
  agentDrift: null,
  build: null,
  ...patch,
});

const ids = (banners: BannerSpec[]): string[] => banners.map((banner) => banner.id);

// Every banner at once, so a pair test can switch two on and the rest off.
const ALL: Record<string, Partial<HomeDetail>> = {
  unreadable: { unreadable: 'system.json is not valid JSON.' },
  repoProblem: { home: repoHome({ readable: false, problem: 'shop has no design-system folder yet.' }) },
  tampered: { snapshot: { at: '2026-11-17T10:00:00.000Z', by: 'agent', tampered: true, treeHash: 'a'.repeat(64) } as never },
  buildProblem: { buildProblem: 'Acme already has files in design-system, so its home can’t change.' },
  landed: { landed: { proposal: 'p_k3m9q2x7', matches: false, differ: ['tokens.css'], unclaimed: [], sentence: 'tokens.css in shop doesn’t match proposal p_k3m9q2x7.' } },
  living: { livingPage: { state: 'unsafe', sentence: 'x' } },
  changes: { changesToReview: true },
};
const ORDER = ['unreadable', 'repoProblem', 'tampered', 'buildProblem', 'landed', 'living', 'changes'];

test('banners come out highest first, one at a time', () => {
  for (const id of ORDER) {
    const result = systemBanners(detail(ALL[id]), OPTIONS);
    assert.deepEqual(ids([...result.shown, ...result.more]), [id]);
  }
});

test('every pair keeps the order and shows at most two with the rest folded', () => {
  for (let a = 0; a < ORDER.length; a += 1) {
    for (let b = a + 1; b < ORDER.length; b += 1) {
      const result = systemBanners(detail({ ...ALL[ORDER[a] as string], ...ALL[ORDER[b] as string] }), OPTIONS);
      assert.deepEqual(ids(result.shown), [ORDER[a], ORDER[b]], `${ORDER[a]} + ${ORDER[b]}`);
      assert.deepEqual(result.more, []);
    }
  }
});

test('three or more fold the rest under +N more and none is dropped', () => {
  const all = detail(Object.assign({}, ...ORDER.map((id) => ALL[id])));
  const result = systemBanners(all, OPTIONS);
  assert.equal(BANNER_MAX, 2);
  assert.deepEqual(ids(result.shown), ['unreadable', 'repoProblem']);
  assert.deepEqual(ids(result.more), ['tampered', 'buildProblem', 'landed', 'living', 'changes']);
  assert.equal(result.moreLabel, '+5 more');
  const three = systemBanners(detail({ ...ALL.tampered, ...ALL.buildProblem, ...ALL.landed }), OPTIONS);
  assert.equal(three.moreLabel, '+1 more');
});

test('no banners when nothing is wrong', () => {
  const result = systemBanners(detail(), OPTIONS);
  assert.deepEqual(result.shown, []);
  assert.deepEqual(result.more, []);
  assert.equal(result.moreLabel, null);
});

test('a banner that matches nothing in the closed list is not made up', () => {
  assert.deepEqual(ids(systemBanners(detail({ landed: { proposal: 'p_1', matches: true, differ: [], unclaimed: [], sentence: null } }), OPTIONS).shown), []);
});

test('the repo that can’t be read says how old the last scan is and offers another folder', () => {
  const [banner] = systemBanners(detail(ALL.repoProblem), OPTIONS).shown as [BannerSpec];
  assert.equal(banner.tone, 'error');
  assert.equal(banner.title, 'The repo can’t be read.');
  assert.match(banner.body, /Showing the last scan from 3 days ago\./);
  assert.match(banner.body, /Re-sync and the living-page actions are off until it reads again\./);
  assert.equal(banner.action?.label, 'Choose another folder…');
  assert.equal(banner.action?.id, 'choose-folder');
  const never = systemBanners(detail({ home: repoHome({ readable: false, problem: 'It is gone.', lastRead: null }) }), OPTIONS).shown[0] as BannerSpec;
  assert.doesNotMatch(never.body, /Showing the last scan/);
});

test('a tampered snapshot offers Re-sync', () => {
  const [banner] = systemBanners(detail(ALL.tampered), OPTIONS).shown as [BannerSpec];
  assert.equal(banner.tone, 'warning');
  assert.equal(banner.title, 'Acme’s snapshot was changed outside Design Chamber.');
  assert.equal(banner.body, 'Re-sync to read shop again.');
  assert.equal(banner.action?.label, 'Re-sync');
});

test('the build problem, landed and living-page banners carry their one action', () => {
  const build = systemBanners(detail(ALL.buildProblem), OPTIONS).shown[0] as BannerSpec;
  assert.equal(build.title, 'The build has a problem.');
  assert.equal(build.action?.label, 'Ask the agent to fix it');
  assert.equal(build.action?.id, 'build-continue');
  const landed = systemBanners(detail(ALL.landed), OPTIONS).shown[0] as BannerSpec;
  assert.equal(landed.title, 'What landed differs from what you approved.');
  assert.equal(landed.body, 'tokens.css in shop doesn’t match proposal p_k3m9q2x7.');
  assert.equal(landed.action?.label, 'Ask the agent about it');
  const living = systemBanners(detail(ALL.living), OPTIONS).shown[0] as BannerSpec;
  assert.equal(living.tone, 'error');
  assert.equal(living.action?.label, 'Ask the agent to update it');
});

test('a secret on the page is an error, or a warning when the page is for developers only', () => {
  const secret = { kind: 'aws-key', where: 'brand/press' };
  const pub = systemBanners(detail({ build: { mode: 'none', dark: false, calls: [], access: 'public', round: 'done', applied: null } }), { ...OPTIONS, secrets: [secret] }).shown[0] as BannerSpec;
  assert.equal(pub.tone, 'error');
  assert.match(pub.title, /something shaped like a secret/);
  const dev = systemBanners(detail({ build: { mode: 'none', dark: false, calls: [], access: 'dev', round: 'done', applied: null } }), { ...OPTIONS, secrets: [secret] }).shown[0] as BannerSpec;
  assert.equal(dev.tone, 'warning');
  assert.match(dev.body, /an AWS key in brand\/press/);
});

test('changes to review is an info banner', () => {
  const banner = systemBanners(detail(ALL.changes), OPTIONS).shown[0] as BannerSpec;
  assert.equal(banner.tone, 'info');
  assert.equal(banner.action, null);
});

test('two banners that share one action show one button', () => {
  const make = (id: string): BannerSpec => ({ id: id as never, tone: 'warning', title: id, body: '', action: { id: 'resync', label: 'Re-sync' } });
  const [first, second] = withoutRepeatedActions([make('a'), make('b')]) as [BannerSpec, BannerSpec];
  assert.equal(first.action?.id, 'resync');
  assert.equal(second.action, null);
});

test('an internal system never shows the repo banners', () => {
  const result = systemBanners(detail({ home: { kind: 'internal' }, ...ALL.tampered, ...ALL.buildProblem }), OPTIONS);
  assert.deepEqual(ids(result.shown), ['buildProblem']);
});

test('the read-only line is the panel’s first line for a repo and never a banner', () => {
  const line = readOnlyLine(detail());
  assert.deepEqual(line, { lead: 'Acme lives in shop.', rest: 'Change the values there, or ask the agent here.' });
  assert.equal(readOnlyLine(detail({ home: { kind: 'internal' } })), null);
  const result = systemBanners(detail(Object.assign({}, ...ORDER.map((id) => ALL[id]))), OPTIONS);
  assert.ok(![...result.shown, ...result.more].some((banner) => (banner.id as string) === 'readonly'));
});

test('the repo header reads Repo · name · folder with the full path as its tooltip', () => {
  assert.deepEqual(repoHeaderLine(detail()), { text: 'Repo · shop · design-system/', title: '/work/shop' });
  assert.equal(repoHeaderLine(detail({ home: { kind: 'internal' } })), null);
});

// ---- drift

test('fix-mode drift names what was compared', () => {
  const lines = driftLines(detail({ codeDrift: { at: '2026-11-19T10:00:00.000Z', mode: 'fix', differ: 3, names: [], partial: false, unread: [] } }));
  assert.equal(lines.sentence, 'In CSS variables and token JSON, 3 tokens differ from Acme.');
  assert.equal(lines.unread, null);
  assert.equal(lines.agent, null);
  assert.equal(lines.canReconcile, true);
});

test('describe-mode drift reads "still differ"', () => {
  const lines = driftLines(detail({ codeDrift: { at: '2026-11-19T10:00:00.000Z', mode: 'describe', differ: 12, names: [], partial: false, unread: [] } }));
  assert.equal(lines.sentence, 'In CSS variables and token JSON, 12 tokens still differ from what Acme describes.');
});

test('unread token files follow, three names then "and N more"', () => {
  const one = driftLines(detail({ codeDrift: { at: '2026-11-19T10:00:00.000Z', mode: 'fix', differ: 1, names: [], partial: false, unread: ['tailwind.config.ts'] } }));
  assert.equal(one.sentence, 'In CSS variables and token JSON, 1 token differs from Acme.');
  assert.equal(one.unread, 'Design Chamber can’t read tailwind.config.ts, so differences there aren’t counted.');
  const five = driftLines(detail({ codeDrift: { at: '2026-11-19T10:00:00.000Z', mode: 'fix', differ: 2, names: [], partial: false, unread: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'] } }));
  assert.equal(five.unread, 'Design Chamber can’t read a.ts, b.ts, c.ts and 2 more, so differences there aren’t counted.');
});

test('a zero count with unread files never says it matches', () => {
  const lines = driftLines(detail({ codeDrift: { at: '2026-11-19T10:00:00.000Z', mode: 'fix', differ: 0, names: [], partial: false, unread: ['tailwind.config.ts'] } }));
  assert.equal(lines.sentence, 'No differences in CSS variables or token JSON. Design Chamber can’t check tailwind.config.ts.');
  assert.equal(lines.unread, null);
  assert.equal(lines.canReconcile, false);
  assert.ok(!/matches/i.test(lines.sentence ?? ''));
});

test('a clean zero says nothing', () => {
  const lines = driftLines(detail({ codeDrift: { at: '2026-11-19T10:00:00.000Z', mode: 'fix', differ: 0, names: [], partial: false, unread: [] } }));
  assert.equal(lines.sentence, null);
  assert.equal(lines.canReconcile, false);
});

test('the agent’s own count is its own line, labelled, and also opens the button', () => {
  const lines = driftLines(detail({ agentDrift: { differ: 4, kinds: ['tailwind', 'components'], note: 'Class names still use the old scale.' } }));
  assert.equal(lines.sentence, null);
  assert.equal(lines.agent, 'The agent reports: “Class names still use the old scale.” (4 differences in tailwind, components; Design Chamber can’t count these).');
  assert.equal(lines.canReconcile, true);
  const bare = driftLines(detail({ agentDrift: { differ: 1, kinds: [], note: '' } }));
  assert.equal(bare.agent, 'The agent reports 1 difference that Design Chamber can’t count.');
});

test('no drift data gives no lines', () => {
  assert.deepEqual(driftLines(detail()), { sentence: null, unread: null, agent: null, canReconcile: false });
});

// ---- landed

test('the landed line carries the service sentence and one action', () => {
  const line = landedLine(detail(ALL.landed));
  assert.equal(line?.sentence, 'tokens.css in shop doesn’t match proposal p_k3m9q2x7.');
  assert.equal(line?.action, 'Ask the agent about it');
  assert.equal(landedLine(detail()), null);
  assert.equal(landedLine(detail({ landed: { proposal: 'p', matches: true, differ: [], unclaimed: [], sentence: null } })), null);
});

// ---- the repo re-sync sheet

const review = (patch: Partial<RepoResyncReview> = {}): RepoResyncReview => ({
  kind: 'repo',
  directory: '/work/shop',
  directoryChanged: false,
  folderFound: true,
  tokens: { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } },
  files: { changed: [], added: [], removed: [] },
  livingPageFound: true,
  refused: 0,
  skipped: [],
  ...patch,
});

test('the sheet is titled for what it does and says how to go back', () => {
  const model = repoReviewModel(review(), { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: true });
  assert.equal(model.title, 'Re-sync Acme from shop');
  assert.equal(model.intro, 'Design Chamber will show shop as it is now. To go back, change shop and re-sync.');
  assert.equal(repoReviewModel(review(), { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: false }).title, 'Read Acme from shop');
});

test('nothing changed says the repo matches and offers Close only', () => {
  const model = repoReviewModel(review(), { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: true });
  assert.equal(model.nothingChanged, true);
  assert.equal(model.matches, 'shop matches what Design Chamber shows.');
  assert.deepEqual(model.sections, []);
});

test('changed, new, removed, files and skipped are plain lists with counts and no ticks', () => {
  const model = repoReviewModel(
    review({
      tokens: {
        changed: [
          { name: '--brand', mode: 'light', from: '#111', to: '#222' },
          { name: '--brand', mode: 'dark', from: '#333', to: '#444' },
        ],
        added: ['--accent'],
        removed: ['--danger', '--space-6'],
        totals: { changed: 2, added: 1, removed: 2 },
      },
      files: { changed: ['OVERVIEW.md'], added: ['notes/voice.md'], removed: [] },
      skipped: [{ path: 'big.json', reason: 'It is over the size limit.' }],
    }),
    { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: true },
  );
  assert.deepEqual(model.sections.map((section) => [section.id, section.title, section.count]), [
    ['changed', 'Changed', 2],
    ['added', 'New in shop', 1],
    ['removed', 'No longer in shop', 2],
    ['files', 'Other files changed', 2],
    ['skipped', 'Skipped', 1],
  ]);
  assert.deepEqual(model.sections[0]?.rows[0], { name: '--brand', tag: 'Light', from: '#111', to: '#222', note: null });
  assert.equal(model.sections[0]?.rows[1]?.tag, 'Dark');
  assert.deepEqual(model.sections[3]?.rows.map((row) => [row.name, row.tag]), [['OVERVIEW.md', 'Changed'], ['notes/voice.md', 'New']]);
  assert.deepEqual(model.sections[4]?.rows[0], { name: 'big.json', tag: null, from: null, to: null, note: 'It is over the size limit.' });
  assert.equal(JSON.stringify(model).includes('checked'), false);
  assert.equal(model.nothingChanged, false);
});

test('a long list says how many more there are than it shows', () => {
  const model = repoReviewModel(
    review({ tokens: { changed: [], added: ['--a', '--b'], removed: [], totals: { changed: 0, added: 7, removed: 0 } } }),
    { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: true },
  );
  assert.equal(model.sections[0]?.count, 7);
  assert.equal(model.sections[0]?.more, 5);
});

test('a moved folder is said, and it is a change even when no values moved', () => {
  const model = repoReviewModel(review({ directory: '/work/shop-v2', directoryChanged: true }), { systemName: 'Acme', repo: 'shop-v2', folder: 'design-system', hasSnapshot: true });
  assert.equal(model.repoint, 'Acme will read from /work/shop-v2 from now on.');
  assert.equal(model.nothingChanged, false);
});

test('a folder without the design-system folder blocks Apply and says why', () => {
  const model = repoReviewModel(review({ folderFound: false }), { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: true });
  assert.equal(model.blocked, 'shop has no design-system folder yet.');
});

test('refused files are one plain line', () => {
  const model = repoReviewModel(review({ refused: 2 }), { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: true });
  assert.equal(model.refused, '2 files aren’t a type design systems use, so they were left out.');
});

test('no sheet copy uses an em dash', () => {
  const model = repoReviewModel(review({ directoryChanged: true, refused: 1 }), { systemName: 'Acme', repo: 'shop', folder: 'design-system', hasSnapshot: true });
  assert.ok(!JSON.stringify(model).includes('—'));
});
