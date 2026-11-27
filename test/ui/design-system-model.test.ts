import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesignSystemView, SystemPreviewResponse } from '../../src/shared/api.ts';
import type { SystemSummary } from '../../src/shared/types.ts';
import {
  agentSwitchOf,
  appliedNotice,
  bannerOf,
  changeOptions,
  chipOf,
  copyProblems,
  dismissKey,
  overridesHeading,
  parseDismissed,
  popoverOf,
  previewLine,
  resetBase,
  shouldRefetchSystem,
  updateHeading,
  updateIsQuiet,
  updateSections,
} from '../../src/ui/model/design-system-model.ts';

const linked = (over: Partial<DesignSystemView> = {}, status: { name?: string; linkState?: 'ok' | 'draft' | 'deleted' } = {}): DesignSystemView => ({
  status: { state: 'linked', id: 'acme', name: status.name ?? 'Acme', linkState: status.linkState ?? 'ok' },
  link: { v: 1, id: 'acme', name: 'Acme', revision: 7, treeHash: 't', at: '2026-11-01T10:00:00.000Z', by: 'user', before: null, fileCount: 12 },
  systemRevision: 7,
  updateAvailable: false,
  copy: { complete: true, missing: [], drift: [], invalid: false },
  overrides: [],
  ownTokens: 0,
  choiceProblem: null,
  stamp: 'copysha:tokenssha',
  ...over,
});
const bare = (state: 'none' | 'ask' | 'unset' | 'invalid' | 'project'): DesignSystemView => ({
  status: { state },
  link: null,
  systemRevision: null,
  updateAvailable: false,
  copy: { complete: true, missing: [], drift: [], invalid: false },
  overrides: [],
  ownTokens: 0,
  choiceProblem: null,
  stamp: ':',
});
const sys = (id: string, name: string, status: 'ready' | 'draft', revision = 3): SystemSummary => ({ id, name, status, revision }) as SystemSummary;
const preview = (over: Partial<SystemPreviewResponse> = {}): SystemPreviewResponse => ({
  fromRevision: 7,
  toRevision: 9,
  tokens: { changed: [{ name: '--a', from: '1', to: '2' }], added: ['--b'], removed: [], totals: { changed: 1, added: 1, removed: 0 } },
  components: { changed: ['Button'], added: [], removed: [], totals: { changed: 1, added: 0, removed: 0 } },
  overrides: [],
  ownTokens: 0,
  bytes: 10,
  stamp: 'copysha:tokenssha',
  ...over,
});

test('the chip names the system in each state', () => {
  assert.equal(chipOf(null), null);
  assert.equal(chipOf(linked())?.label, 'Acme');
  assert.equal(chipOf(linked({}, { linkState: 'deleted' }))?.label, 'Acme (deleted)');
  assert.equal(chipOf(linked({}, { linkState: 'draft' }))?.label, 'Acme (draft)');
  assert.equal(chipOf(bare('none'))?.label, 'No design system');
  assert.equal(chipOf(bare('unset'))?.label, 'No design system');
  assert.equal(chipOf(bare('ask'))?.label, 'Ask me in chat');
});

test('the chip tone: quiet, info for an update, warning for a damaged copy', () => {
  assert.equal(chipOf(linked())?.tone, 'neutral');
  assert.equal(chipOf(linked({ updateAvailable: true, systemRevision: 9 }))?.tone, 'info');
  assert.equal(chipOf(linked({ copy: { complete: false, missing: ['a'], drift: [], invalid: false } }))?.tone, 'warning');
  assert.equal(chipOf(linked({}, { linkState: 'deleted' }))?.tone, 'warning');
});

test('the chip title carries revision, update and override counts', () => {
  const title = chipOf(linked({ updateAvailable: true, systemRevision: 9, overrides: [{ name: '--x', value: '1', systemValue: '2' }] }))?.title;
  assert.equal(title, 'Acme, revision 7, an update is available, 1 override');
});

test('copy problems read as sentences', () => {
  assert.deepEqual(copyProblems(linked({ copy: { complete: false, missing: ['a', 'b'], drift: [], invalid: false } })), ['This design’s copy of Acme is missing 2 files.']);
  assert.deepEqual(copyProblems(linked({ copy: { complete: false, missing: [], drift: ['x'], invalid: false } })), ['1 file in this design’s copy of Acme was changed by hand.']);
  assert.deepEqual(copyProblems(linked({ copy: { complete: false, missing: [], drift: [], invalid: true } })), ['This design’s copy of Acme can’t be read.']);
  assert.deepEqual(copyProblems(bare('none')), []);
});

test('the popover offers Open system only for a Ready system, and the update only when one is waiting', () => {
  const ok = popoverOf(linked({ updateAvailable: true, systemRevision: 9 }));
  assert.equal(ok.openId, 'acme');
  assert.deepEqual(ok.update, { revision: 9 });
  assert.equal(popoverOf(linked({}, { linkState: 'deleted' })).openId, null);
  assert.equal(popoverOf(linked({}, { linkState: 'draft' })).update, null);
  assert.equal(popoverOf(bare('none')).openId, null);
  assert.equal(overridesHeading(1), '1 override in this design');
});

test('Change… lists Ready systems but the current one, then No design system', () => {
  const list = [sys('acme', 'Acme', 'ready'), sys('shop', 'Shop', 'ready', 5), sys('wip', 'Wip', 'draft')];
  assert.deepEqual(changeOptions(linked(), list).map((o) => o.id), ['shop', 'none']);
  assert.deepEqual(changeOptions(bare('none'), list).map((o) => o.id), ['acme', 'shop']);
  assert.equal(changeOptions(bare('ask'), list).at(-1)?.id, 'none');
});

test('a design that follows its project: the chip names the project, the popover says so', () => {
  const follows = bare('project');
  assert.deepEqual(chipOf(follows, 'shop'), { label: 'Follows the project', title: 'This design follows shop’s own design files.', tone: 'neutral' });
  assert.equal(chipOf(follows)?.title, 'This design follows its project’s own design files.');
  assert.deepEqual(popoverOf(follows, 'shop').lines, ['This design follows shop’s own design files, so it looks like the rest of the project. Pick a system to use one instead.']);
  assert.equal(popoverOf(follows, 'shop').openId, null);
});

test('Change… on a design that follows its project lists the project’s own system first, then the rest and No design system', () => {
  const own = { ...sys('shop-ui', 'Shop UI', 'ready', 2), unreadable: null, updated: '2026-11-20T10:00:00.000Z', home: { repo: 'shop', directory: '/work/shop' }, sources: { code: null, brand: 0, description: false } } as SystemSummary;
  const others = [sys('acme', 'Acme', 'ready'), sys('wip', 'Wip', 'draft')].map((row) => ({ ...row, unreadable: null, updated: '2026-11-20T10:00:00.000Z', home: 'internal' as const, sources: { code: null, brand: 0, description: false } }) as SystemSummary);
  const options = changeOptions(bare('project'), [...others, own], { directory: '/work/shop', foldsCase: false });
  assert.deepEqual(options.map((o) => [o.id, o.label]), [['shop-ui', 'Shop UI, this project’s'], ['acme', 'Acme'], ['none', 'No design system']]);
  // Without the project folder, nothing is marked and the order is the list's.
  assert.deepEqual(changeOptions(bare('project'), [...others, own]).map((o) => o.label), ['Acme', 'Shop UI', 'No design system']);
});

test('the preview line says what moves and what the design keeps', () => {
  const p = preview({ tokens: { changed: [], added: [], removed: [], totals: { changed: 12, added: 4, removed: 0 } }, ownTokens: 6 });
  assert.equal(previewLine(p, { none: false, fromName: null }), '12 tokens will change, 4 are new, this design’s own 6 stay as overrides.');
  assert.equal(previewLine(preview({ tokens: { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } } }), { none: false, fromName: null }), 'No tokens change.');
  assert.equal(previewLine(preview({ ownTokens: 2 }), { none: true, fromName: 'Acme' }), 'Acme’s tokens are removed from this design, and its own 2 stay.');
});

test('the banner shows for a newer revision until Not now covers it', () => {
  const view = linked({ updateAvailable: true, systemRevision: 9 });
  assert.deepEqual(bannerOf(view, null), { text: 'Acme was updated since this design copied it.', revision: 9 });
  assert.equal(bannerOf(view, 9), null);
  assert.equal(bannerOf(view, 10), null);
  assert.notEqual(bannerOf(view, 8), null);
  assert.equal(bannerOf(linked(), null), null);
  assert.equal(bannerOf(linked({ updateAvailable: true, systemRevision: 9 }, { linkState: 'draft' }), null), null);
  assert.equal(bannerOf(null, null), null);
});

test('the dismissed revision is stored under the design and read back strictly', () => {
  assert.equal(dismissKey('shop-home'), 'system-update:shop-home');
  assert.equal(parseDismissed(9), 9);
  assert.equal(parseDismissed('9'), null);
  assert.equal(parseDismissed(1.5), null);
  assert.equal(parseDismissed(undefined), null);
});

test('the update sheet leads with the version and leaves empty sections out', () => {
  assert.equal(updateHeading('Acme', preview()), 'Acme, revision 7 to 9');
  const sections = updateSections(preview());
  assert.deepEqual(sections.map((s) => s.id), ['changed', 'added', 'components']);
  assert.equal(sections[0]?.title, '1 token changed');
  assert.equal(sections[2]?.title, 'Components, 1 changed');
  const empty = preview({ tokens: { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } }, components: { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } } });
  assert.equal(updateIsQuiet(empty), true);
  assert.equal(updateIsQuiet(preview()), false);
});

test('long sections are cut with a count', () => {
  const names = Array.from({ length: 10 }, (_, n) => `--t${n}`);
  const section = updateSections(preview({ tokens: { changed: names.map((name) => ({ name, from: '1', to: '2' })), added: [], removed: [], totals: { changed: 10, added: 0, removed: 0 } } }))[0];
  assert.equal(section?.names.length, 6);
  assert.equal(section?.more, 4);
});

test('Reset to system uses the tokens.css half of the stamp', () => {
  assert.equal(resetBase(linked()), 'tokenssha');
  assert.equal(resetBase(linked({ stamp: 'copysha:' })), null);
  assert.equal(resetBase(linked({ stamp: 'nocolon' })), null);
});

test('the notice after a change says what happened and how to ask the agent', () => {
  assert.deepEqual(appliedNotice('updated', 'Acme', 7), { title: 'Updated to Acme revision 7.', ask: { purpose: 'system-update', label: 'Ask the agent to apply the changes' } });
  assert.equal(appliedNotice('switched', 'Shop', 2).title, 'Now using Shop.');
  assert.equal(appliedNotice('linked', 'Shop', 2).ask?.purpose, 'restyle');
  assert.equal(appliedNotice('removed', 'x', null).title, 'Removed the design system from this design.');
  assert.equal(appliedNotice('unchanged', 'x', null).ask, null);
});

test('only the agent switching an open design is announced', () => {
  const before = linked();
  const after = linked({ link: { ...linked().link!, id: 'shop', name: 'Shop', by: 'agent', before: 'v4', at: '2026-11-02T10:00:00.000Z' } }, { name: 'Shop' });
  assert.deepEqual(agentSwitchOf(before, after), { title: 'The agent switched this design to Shop.', undoTo: 'v4' });
  assert.equal(agentSwitchOf(null, after), null);
  assert.equal(agentSwitchOf(after, after), null);
  const own = linked({ link: { ...linked().link!, by: 'user', before: 'v4', at: '2026-11-02T10:00:00.000Z' } });
  assert.equal(agentSwitchOf(before, own), null);
  const noWayBack = linked({ link: { ...linked().link!, by: 'agent', before: null, at: '2026-11-02T10:00:00.000Z' } });
  assert.equal(agentSwitchOf(before, noWayBack), null);
});

test('system views are refetched for the design, a system change or a new root', () => {
  const batch = (events: Array<{ slug: string | null; kind: string }>, reset = false) => ({ reset, events });
  assert.equal(shouldRefetchSystem(batch([{ slug: 'a', kind: 'files' }]), 'a'), true);
  assert.equal(shouldRefetchSystem(batch([{ slug: 'b', kind: 'files' }]), 'a'), false);
  assert.equal(shouldRefetchSystem(batch([{ slug: null, kind: 'system' }]), 'a'), true);
  assert.equal(shouldRefetchSystem(batch([{ slug: 'a', kind: 'comments' }]), 'a'), false);
  assert.equal(shouldRefetchSystem(batch([], true), 'a'), true);
});
