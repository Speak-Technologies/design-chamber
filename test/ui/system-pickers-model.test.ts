import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROJECT_CHOICE } from '../../src/shared/systems.ts';
import type { SystemChoiceView, SystemPinView, SystemSummary } from '../../src/shared/types.ts';
import { foldsCaseFor, systemFieldOf } from '../../src/ui/model/new-model.ts';
import {
  DEFAULT_NOTE,
  SYSTEMS_SECTION_TEXT,
  defaultFrom,
  defaultLabel,
  defaultOptions,
  defaultSentence,
  defaultValue,
  pinOptions,
  pinValue,
  pinsAfter,
  projectRows,
  type ProjectRowsContext,
} from '../../src/ui/model/settings-model.ts';
import { SYSTEM_UPDATED_LABEL, systemUpdated } from '../../src/ui/model/list-model.ts';

type Owner = { repo?: string; code?: string };

/** A system as `GET /systems` lists it; `owner` says which project it belongs to (a repo home, or a code scan). */
const sys = (id: string, name: string, status: 'ready' | 'draft', revision = 3, owner: Owner = {}): SystemSummary =>
  ({
    id,
    name,
    status,
    revision,
    unreadable: null,
    updated: '2026-11-20T10:00:00.000Z',
    home: owner.repo === undefined ? 'internal' : { repo: owner.repo.split('/').pop() ?? owner.repo, directory: owner.repo },
    sources: { code: owner.code === undefined ? null : { directory: owner.code, lastScan: '2026-11-20T10:00:00.000Z', partial: false }, brand: 0, description: false },
  }) as SystemSummary;

const LIST = [sys('acme', 'Acme', 'ready'), sys('shop', 'Shop', 'ready', 5), sys('wip', 'Wip', 'draft')];
const ROOT = '/home/you/Designs';
const ASK: SystemChoiceView = { choice: 'ask', state: 'ok', sentence: null };
const ctx = (systems: readonly SystemSummary[] | null = LIST, defaultView: SystemChoiceView = ASK): ProjectRowsContext => ({ systems, defaultView, foldsCase: false });

// ---------------------------------------------------------------- the New dialog

test('the New dialog field offers Ready systems, No design system and Ask me in chat when there is no project', () => {
  const view = systemFieldOf({ systems: LIST, settings: undefined, designsRoot: ROOT, projectDirectory: null }, null, false);
  assert.deepEqual(view.options.map((o) => o.id), ['acme', 'shop', 'none', 'ask']);
  assert.equal(view.value, 'ask');
  assert.equal(view.hint, null);
  assert.equal(view.showPreset, true);
  assert.equal(view.presetHint, null);
  assert.equal(view.empty, false);
});

test('with a project folder Use the project comes first and is preselected; it is what the dialog sends', () => {
  const view = systemFieldOf({ systems: LIST, settings: undefined, designsRoot: ROOT, projectDirectory: '/work/shop' }, null, false);
  assert.deepEqual(view.options.map((o) => o.id), [PROJECT_CHOICE, 'acme', 'shop', 'none', 'ask']);
  assert.equal(view.options[0]?.label, 'Use the project');
  assert.equal(view.value, PROJECT_CHOICE);
  assert.equal(view.hint, 'Reads shop’s design files first');
  assert.equal(view.showPreset, true);
  assert.equal(view.presetHint, 'Used only where the project’s files say nothing.');
  assert.equal(view.send, PROJECT_CHOICE);
});

test('Use the project is not offered for a folder inside the designs root', () => {
  const view = systemFieldOf({ systems: LIST, settings: undefined, designsRoot: ROOT, projectDirectory: `${ROOT}/scratch` }, null, false);
  assert.equal(view.options.some((o) => o.id === PROJECT_CHOICE), false);
  assert.equal(view.value, 'ask');
  assert.notEqual(view.send, PROJECT_CHOICE);
});

test('a project with its own Ready system preselects that system, says where it is from and hides the preset', () => {
  const systems = [...LIST, sys('shop-ui', 'Shop UI', 'ready', 2, { repo: '/work/shop' })];
  const view = systemFieldOf({ systems, settings: undefined, designsRoot: ROOT, projectDirectory: '/work/shop' }, null, false);
  assert.equal(view.value, 'shop-ui');
  assert.equal(view.hint, 'From shop');
  assert.equal(view.showPreset, false);
  assert.equal(view.send, 'shop-ui');
});

test('picking Use the project keeps it shown and sent, even when it resolves to the own system', () => {
  const systems = [...LIST, sys('shop-ui', 'Shop UI', 'ready', 2, { code: '/work/shop' })];
  const view = systemFieldOf({ systems, settings: undefined, designsRoot: ROOT, projectDirectory: '/work/shop' }, PROJECT_CHOICE, false);
  assert.equal(view.value, PROJECT_CHOICE);
  assert.equal(view.send, PROJECT_CHOICE);
  assert.equal(view.hint, 'From shop');
  assert.equal(view.showPreset, false);
});

test('it preselects the project pin, then the default, and says why; neither sends Use the project', () => {
  const settings = { default: { choice: 'system' as const, id: 'acme', name: 'Acme' }, pins: [{ directory: '/work/shop', choice: 'system' as const, id: 'shop', name: 'Shop' }] };
  const pinned = systemFieldOf({ systems: LIST, settings, designsRoot: ROOT, projectDirectory: '/work/shop' }, null, false);
  assert.equal(pinned.value, 'shop');
  assert.equal(pinned.hint, 'Pinned for shop');
  assert.equal(pinned.showPreset, false);
  assert.equal(pinned.send, 'shop');
  const followsDefault = systemFieldOf({ systems: LIST, settings: { ...settings, pins: [{ directory: '/work/blog', choice: 'follow-default' as const }] }, designsRoot: ROOT, projectDirectory: '/work/blog' }, null, false);
  assert.equal(followsDefault.value, 'acme');
  assert.equal(followsDefault.hint, 'Your default');
  assert.equal(followsDefault.send, 'acme');
  const noProject = systemFieldOf({ systems: LIST, settings, designsRoot: ROOT, projectDirectory: null }, null, false);
  assert.equal(noProject.value, 'acme');
  assert.equal(noProject.hint, 'Your default');
});

test('picking in the select wins and drops the hint; a system hides the preset', () => {
  const settings = { default: { choice: 'system' as const, id: 'acme', name: 'Acme' }, pins: [] };
  const mine = systemFieldOf({ systems: LIST, settings, designsRoot: ROOT, projectDirectory: '/work/shop' }, 'none', false);
  assert.equal(mine.value, 'none');
  assert.equal(mine.hint, null);
  assert.equal(mine.showPreset, true);
  assert.equal(mine.presetHint, null);
  assert.equal(mine.send, 'none');
});

test('with no Ready system the field gives way to a line and sends nothing, project or not', () => {
  for (const projectDirectory of [null, '/work/shop']) {
    const view = systemFieldOf({ systems: [sys('wip', 'Wip', 'draft')], settings: undefined, designsRoot: ROOT, projectDirectory }, null, false);
    assert.equal(view.empty, true);
    assert.equal(view.send, undefined);
    assert.equal(view.showPreset, true);
  }
});

test('Windows-looking roots fold case', () => {
  assert.equal(foldsCaseFor('C:\\Users\\you\\Designs', 'linux'), true);
  assert.equal(foldsCaseFor('/home/you/Designs', 'Linux x86_64'), false);
  assert.equal(foldsCaseFor('/Users/you/Designs', 'MacIntel'), true);
});

// ---------------------------------------------------------------- Settings

test('the section and default note say what the project choice does', () => {
  assert.equal(SYSTEMS_SECTION_TEXT, 'New designs follow their project’s own design system and files. Change it per project, or set what happens when a project has nothing.');
  assert.equal(DEFAULT_NOTE, 'Used when a design has no project, or its project has no design files.');
});

test('settings selects list Ready systems only, with Use the project first on a project row', () => {
  assert.deepEqual(defaultOptions(LIST).map((o) => o.label), ['Ask me each time', 'No design system', 'Acme', 'Shop']);
  assert.deepEqual(pinOptions(LIST).map((o) => o.label), ['Use the project', 'Use my default', 'No design system', 'Acme', 'Shop']);
  assert.deepEqual(pinOptions(LIST).map((o) => o.id), ['project', 'follow-default', 'none', 'system:acme', 'system:shop']);
});

test('the default round-trips and an unresolved one shows as Ask me each time', () => {
  const ok: SystemChoiceView = { choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null };
  assert.equal(defaultValue(ok), 'system:acme');
  assert.deepEqual(defaultFrom('system:acme', LIST), { choice: 'system', id: 'acme', name: 'Acme' });
  assert.deepEqual(defaultFrom('none', LIST), { choice: 'none' });
  assert.deepEqual(defaultFrom('system:wip', LIST), { choice: 'ask' });
  const gone: SystemChoiceView = { choice: 'system', id: 'old', name: 'Old', state: 'missing', sentence: 'Your default design system isn’t in this Designs folder.' };
  assert.equal(defaultValue(gone), 'ask');
  assert.equal(defaultSentence(gone), 'Your default design system isn’t in this Designs folder.');
  assert.equal(defaultSentence(ok), null);
  assert.equal(defaultLabel(ok), 'Acme');
  assert.equal(defaultLabel(gone), 'Ask me each time');
  assert.equal(defaultLabel({ choice: 'none', state: 'ok', sentence: null }), 'No design system');
});

test('pin values: none is Use the project, follow-default is Use my default, an unresolved system is Use the project', () => {
  const draft: SystemPinView = { directory: '/work/shop', choice: 'system', id: 'wip', name: 'Wip', state: 'draft', sentence: 'Wip is a draft.' };
  assert.equal(pinValue(null), 'project');
  assert.equal(pinValue(draft), 'project');
  assert.equal(pinValue({ directory: '/x', choice: 'none', state: 'ok', sentence: null }), 'none');
  assert.equal(pinValue({ directory: '/x', choice: 'follow-default', state: 'ok', sentence: null }), 'follow-default');
  assert.equal(pinValue({ directory: '/x', choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null }), 'system:acme');
});

test('row sentence, Use the project: the project has a Ready system', () => {
  const systems = [...LIST, sys('shop-ui', 'Shop UI', 'ready', 2, { repo: '/work/shop/web' })];
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [], ctx(systems));
  assert.equal(rows[0]?.value, 'project');
  assert.equal(rows[0]?.sentence, 'Uses Shop UI, this project’s design system.');
});

test('row sentence, Use the project: its system is a draft', () => {
  const systems = [...LIST, sys('shop-ui', 'Shop UI', 'draft', 1, { code: '/work/shop' })];
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [], ctx(systems));
  assert.equal(rows[0]?.sentence, 'Shop UI is a draft. Until it is Ready, designs follow the project’s files.');
});

test('row sentence, Use the project: no system of its own, with the default named in brackets', () => {
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [], ctx());
  assert.equal(rows[0]?.sentence, 'Follows the project’s design files. If it has none, uses your default (Ask me each time).');
  const harbor: SystemChoiceView = { choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null };
  assert.equal(projectRows([{ directory: '/work/shop', name: 'shop' }], [], ctx(LIST, harbor))[0]?.sentence, 'Follows the project’s design files. If it has none, uses your default (Acme).');
});

test('row sentence while the systems list is loading or failed: the follow sentence, no system named', () => {
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [], ctx(null));
  assert.equal(rows[0]?.sentence, 'Follows the project’s design files. If it has none, uses your default (Ask me each time).');
});

test('row sentence, a pinned system: names the project’s own system when it differs, else nothing', () => {
  const systems = [...LIST, sys('shop-ui', 'Shop UI', 'ready', 2, { repo: '/work/shop' })];
  const acme: SystemPinView = { directory: '/work/shop', choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null };
  assert.equal(projectRows([{ directory: '/work/shop', name: 'shop' }], [acme], ctx(systems))[0]?.sentence, 'This project has its own system, Shop UI. New designs use Acme because you picked it.');
  const own: SystemPinView = { ...acme, id: 'shop-ui', name: 'Shop UI' };
  assert.equal(projectRows([{ directory: '/work/shop', name: 'shop' }], [own], ctx(systems))[0]?.sentence, null);
  assert.equal(projectRows([{ directory: '/work/shop', name: 'shop' }], [acme], ctx())[0]?.sentence, null);
});

test('row sentence, a pinned system that is gone, a draft or unreadable: the service’s sentence, which falls to the project', () => {
  const draft: SystemPinView = { directory: '/work/shop', choice: 'system', id: 'wip', name: 'Wip', state: 'draft', sentence: 'Wip is a draft. Until it is Ready, this project uses the project’s own design files, or your default.' };
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [draft], ctx());
  assert.equal(rows[0]?.value, 'project');
  assert.equal(rows[0]?.sentence, draft.sentence);
  assert.match(rows[0]?.sentence ?? '', /uses the project/);
});

test('row sentence, Use my default and No design system: none', () => {
  const systems = [...LIST, sys('shop-ui', 'Shop UI', 'ready', 2, { repo: '/work/shop' })];
  for (const choice of ['follow-default', 'none'] as const) {
    const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [{ directory: '/work/shop', choice, state: 'ok', sentence: null }], ctx(systems));
    assert.equal(rows[0]?.sentence, null, choice);
  }
});

test('a pin whose project is not open still gets a row', () => {
  const pin: SystemPinView = { directory: '/work/old-site', choice: 'none', state: 'ok', sentence: null };
  const rows = projectRows([{ directory: '/work/shop', name: 'shop' }], [pin], ctx());
  assert.deepEqual(rows.map((r) => r.name), ['shop', 'old-site']);
});

test('changing one project sends the whole list: Use the project writes no pin, Use my default writes follow-default', () => {
  const other: SystemPinView = { directory: '/work/blog', choice: 'none', state: 'ok', sentence: null };
  const mine: SystemPinView = { directory: '/work/shop', choice: 'system', id: 'acme', name: 'Acme', state: 'ok', sentence: null };
  assert.deepEqual(pinsAfter([other, mine], '/work/shop', 'system:shop', LIST), [{ directory: '/work/blog', choice: 'none' }, { directory: '/work/shop', choice: 'system', id: 'shop', name: 'Shop' }]);
  assert.deepEqual(pinsAfter([other, mine], '/work/shop', 'project', LIST), [{ directory: '/work/blog', choice: 'none' }]);
  assert.deepEqual(pinsAfter([other, mine], '/work/shop', 'follow-default', LIST), [{ directory: '/work/blog', choice: 'none' }, { directory: '/work/shop', choice: 'follow-default' }]);
  assert.deepEqual(pinsAfter([other], '/work/shop', 'none', LIST), [{ directory: '/work/blog', choice: 'none' }, { directory: '/work/shop', choice: 'none' }]);
  assert.equal(pinsAfter([other, mine], '/work/shop', 'project', LIST).some((pin) => (pin.choice as string) === 'default'), false);
});

test('the list badge follows updateAvailable', () => {
  assert.equal(SYSTEM_UPDATED_LABEL, 'System updated');
  assert.equal(systemUpdated({ system: { id: 'a', name: 'A', revision: 2, state: 'ok', updateAvailable: true } }), true);
  assert.equal(systemUpdated({ system: { id: 'a', name: 'A', revision: 2, state: 'ok', updateAvailable: false } }), false);
  assert.equal(systemUpdated({}), false);
  assert.equal(systemUpdated({ system: null }), false);
});
