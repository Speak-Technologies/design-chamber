// effectiveSystemChoice (documentation/specs/phase-2-5-technical.md §2.9, RS S5-1): explicit → a pin for
// the project (never the designs root or a folder inside it) → the default → none-silent when the
// answer is ask but no Ready system exists in this root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { choiceSystemsOf, effectiveSystemChoice, PROJECT_CHOICE, projectSystemOf, type ChoiceSystem, type EffectiveChoiceInput } from '../../src/shared/systems.ts';
import type { SystemSummary } from '../../src/shared/types.ts';

/** A system no project owns (made from brand files only, or a folder outside every project here). */
const loose = (id: string, status: 'draft' | 'ready'): ChoiceSystem => ({ id, status, name: id, belongsTo: null, repo: false, updated: '2026-11-01T00:00:00.000Z' });

// The rules before Use the project (0.7.0): a project whose scan found nothing, so the default decides.
const base = (over: Partial<EffectiveChoiceInput> = {}): EffectiveChoiceInput => ({
  explicit: null,
  projectDirectory: '/work/shop',
  project: { state: 'scanned', found: false },
  designsRoot: '/home/me/Documents/Designs',
  settings: {},
  systems: [loose('acme', 'ready'), loose('shop', 'ready'), loose('wip', 'draft')],
  foldsCase: false,
  ...over,
});

test('nothing set: ask while a Ready system exists, none-silent when none does', () => {
  assert.deepEqual(effectiveSystemChoice(base()), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ systems: [loose('wip', 'draft')] })), { choice: 'none-silent' });
  assert.deepEqual(effectiveSystemChoice(base({ systems: [] })), { choice: 'none-silent' });
});

test('an explicit choice wins over a pin and the default', () => {
  const settings = { systemDefault: { choice: 'system' as const, id: 'acme', name: 'Acme' }, systemPins: [{ directory: '/work/shop', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'shop', settings })), { choice: 'system', id: 'shop', why: 'explicit' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'none', settings })), { choice: 'none', why: 'explicit' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'ask', settings })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'ask', systems: [] })), { choice: 'none-silent' });
});

test('an explicit Draft or unknown id falls through to the pin and the default', () => {
  const settings = { systemDefault: { choice: 'system' as const, id: 'acme', name: 'Acme' } };
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'wip', settings })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ explicit: 'gone', settings })), { choice: 'system', id: 'acme', why: 'default' });
});

test('a pin for the project decides: none, a Ready system, or the default', () => {
  const pin = (choice: 'none' | 'system' | 'follow-default', id?: string) => ({ systemPins: [{ directory: '/work/shop', choice, ...(id ? { id, name: id } : {}) }], systemDefault: { choice: 'system' as const, id: 'acme', name: 'Acme' } });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('none') })), { choice: 'none', why: 'pinned' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('system', 'shop') })), { choice: 'system', id: 'shop', why: 'pinned' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('follow-default') })), { choice: 'system', id: 'acme', why: 'default' });
  // A pin to a Draft or a deleted system acts as unset.
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('system', 'wip') })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: pin('system', 'gone') })), { choice: 'system', id: 'acme', why: 'default' });
});

test('pins compare folders as the OS does: slashes, trailing separator, case on folding disks', () => {
  const settings = { systemPins: [{ directory: 'C:\\Work\\Shop\\', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings, projectDirectory: 'c:/work/shop' })), { choice: 'none', why: 'pinned' });
  const posix = { systemPins: [{ directory: '/work/Shop', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings: posix, projectDirectory: '/work/shop' })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: posix, projectDirectory: '/work/shop', foldsCase: true })), { choice: 'none', why: 'pinned' });
});

test('the designs root, or a folder inside it, is never a pinned project', () => {
  const settings = { systemPins: [{ directory: '/home/me/Documents/Designs', choice: 'none' as const }, { directory: '/home/me/Documents/Designs/sub', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings, projectDirectory: '/home/me/Documents/Designs' })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ settings, projectDirectory: '/home/me/Documents/Designs/sub' })), { choice: 'ask' });
  // A sibling whose name only starts like the root is not inside it.
  const sibling = { systemPins: [{ directory: '/home/me/Documents/Designs-old', choice: 'none' as const }] };
  assert.deepEqual(effectiveSystemChoice(base({ settings: sibling, projectDirectory: '/home/me/Documents/Designs-old' })), { choice: 'none', why: 'pinned' });
});

test('the default: none, a Ready system, or ask when its system is a Draft or gone', () => {
  assert.deepEqual(effectiveSystemChoice(base({ settings: { systemDefault: { choice: 'none' } } })), { choice: 'none', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: { systemDefault: { choice: 'system', id: 'shop', name: 'Shop' } } })), { choice: 'system', id: 'shop', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ settings: { systemDefault: { choice: 'system', id: 'wip', name: 'WIP' } } })), { choice: 'ask' });
  assert.deepEqual(effectiveSystemChoice(base({ projectDirectory: null, settings: { systemDefault: { choice: 'system', id: 'gone', name: 'Gone' } } })), { choice: 'ask' });
});

// ---- Use the project (documentation/specs/use-the-project-and-native-agent.md §1.2 to §1.4) ----

const own = (over: Partial<ChoiceSystem> = {}): ChoiceSystem => ({ id: 'shop-ui', status: 'ready', name: 'Shop UI', belongsTo: '/work/shop', repo: true, updated: '2026-11-20T00:00:00.000Z', ...over });

test('§1.3 ranking table: explicit × pin × own system × found × default', () => {
  type Pin = 'no-pin' | 'none' | 'acme' | 'follow-default' | 'gone';
  type Default = 'ask' | 'none' | 'acme';
  type Project = 'unknown' | 'found' | 'empty' | 'unreadable' | 'no-project';
  const pinsOf = (pin: Pin): NonNullable<EffectiveChoiceInput['settings']['systemPins']> =>
    pin === 'no-pin' ? []
      : pin === 'none' || pin === 'follow-default' ? [{ directory: '/work/shop', choice: pin }]
        : [{ directory: '/work/shop', choice: 'system', id: pin, name: pin }];
  const settingsOf = (pin: Pin, fallback: Default): EffectiveChoiceInput['settings'] => ({
    systemPins: pinsOf(pin),
    ...(fallback === 'ask' ? {} : { systemDefault: fallback === 'none' ? { choice: 'none' } : { choice: 'system', id: 'acme', name: 'Acme' } }),
  });
  const projectOf = (value: Project): EffectiveChoiceInput['project'] =>
    value === 'unknown' ? null
      : value === 'found' ? { state: 'scanned', found: true }
        : value === 'empty' ? { state: 'scanned', found: false }
          : value === 'unreadable' ? { state: 'unreadable', found: false } : { state: 'no-project', found: false };

  const rows: Array<[string | null, Pin, boolean, Project, Default, unknown]> = [
    // Rung 2: the New dialog's pick beats everything below it.
    ['acme', 'none', true, 'found', 'none', { choice: 'system', id: 'acme', why: 'explicit' }],
    ['none', 'acme', true, 'found', 'acme', { choice: 'none', why: 'explicit' }],
    ['ask', 'acme', true, 'found', 'acme', { choice: 'ask' }],
    [PROJECT_CHOICE, 'acme', true, 'empty', 'acme', { choice: 'system', id: 'shop-ui', why: 'project' }],
    [PROJECT_CHOICE, 'acme', false, 'found', 'acme', { choice: 'project', why: 'explicit' }],
    [PROJECT_CHOICE, 'none', false, 'unreadable', 'acme', { choice: 'project', why: 'explicit' }],
    [PROJECT_CHOICE, 'none', false, 'unknown', 'none', { choice: 'project', why: 'explicit' }],
    // An explicit Use the project on a project with nothing of its own: the default decides.
    [PROJECT_CHOICE, 'no-pin', false, 'empty', 'acme', { choice: 'system', id: 'acme', why: 'default' }],
    // Rung 3: a pin beats the project's own system.
    [null, 'acme', true, 'found', 'none', { choice: 'system', id: 'acme', why: 'pinned' }],
    [null, 'none', true, 'found', 'acme', { choice: 'none', why: 'pinned' }],
    // Use my default skips the project.
    [null, 'follow-default', true, 'found', 'acme', { choice: 'system', id: 'acme', why: 'default' }],
    [null, 'follow-default', true, 'found', 'none', { choice: 'none', why: 'default' }],
    [null, 'follow-default', true, 'found', 'ask', { choice: 'ask' }],
    // Rung 4: no pin, or a pin to a system that is gone, is Use the project.
    [null, 'no-pin', true, 'found', 'acme', { choice: 'system', id: 'shop-ui', why: 'project' }],
    [null, 'no-pin', true, 'empty', 'acme', { choice: 'system', id: 'shop-ui', why: 'project' }],
    [null, 'gone', true, 'empty', 'acme', { choice: 'system', id: 'shop-ui', why: 'project' }],
    [null, 'no-pin', false, 'found', 'acme', { choice: 'project', why: 'default' }],
    [null, 'no-pin', false, 'unreadable', 'acme', { choice: 'project', why: 'default' }],
    [null, 'no-pin', false, 'unknown', 'acme', { choice: 'project', why: 'default' }],
    [null, 'gone', false, 'found', 'acme', { choice: 'project', why: 'default' }],
    // Rung 5: the scan found nothing, so the default decides exactly as in 0.7.0.
    [null, 'no-pin', false, 'empty', 'acme', { choice: 'system', id: 'acme', why: 'default' }],
    [null, 'no-pin', false, 'empty', 'none', { choice: 'none', why: 'default' }],
    [null, 'no-pin', false, 'empty', 'ask', { choice: 'ask' }],
    [null, 'gone', false, 'empty', 'acme', { choice: 'system', id: 'acme', why: 'default' }],
    // Discovery says the folder is not a project (a filesystem root): the default decides.
    [null, 'no-pin', true, 'no-project', 'acme', { choice: 'system', id: 'acme', why: 'default' }],
  ];
  for (const [explicit, pin, ownSystem, project, fallback, expected] of rows) {
    const actual = effectiveSystemChoice(base({
      explicit,
      project: projectOf(project),
      settings: settingsOf(pin, fallback),
      systems: [loose('acme', 'ready'), loose('wip', 'draft'), ...(ownSystem ? [own()] : [])],
    }));
    assert.deepEqual(actual, expected, `explicit ${String(explicit)} · pin ${pin} · own ${String(ownSystem)} · ${project} · default ${fallback}`);
  }
});

test('with no project, or a chat in the designs folder, Use the project never applies', () => {
  const settings = { systemDefault: { choice: 'system' as const, id: 'acme', name: 'Acme' } };
  const systems = [loose('acme', 'ready'), own({ belongsTo: '/home/me/Documents/Designs' })];
  const found = { state: 'scanned' as const, found: true };
  assert.deepEqual(effectiveSystemChoice(base({ projectDirectory: null, project: null, settings, systems })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ projectDirectory: '/home/me/Documents/Designs', project: found, settings, systems })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ projectDirectory: '/home/me/Documents/Designs/sub', project: found, settings, systems })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ projectDirectory: null, explicit: PROJECT_CHOICE, project: null, settings, systems })), { choice: 'system', id: 'acme', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ projectDirectory: null, project: null, systems: [loose('wip', 'draft')] })), { choice: 'none-silent' });
});

test('the project own system counts only when it is Ready', () => {
  const systems = [loose('acme', 'ready'), own({ status: 'draft' })];
  assert.deepEqual(effectiveSystemChoice(base({ project: { state: 'scanned', found: true }, systems })), { choice: 'project', why: 'default' });
  assert.deepEqual(effectiveSystemChoice(base({ project: { state: 'scanned', found: false }, systems })), { choice: 'ask' });
});

test('projectSystemOf: a repo inside the project and a project inside the repo both match; siblings never', () => {
  const sys = (id: string, belongsTo: string | null, over: Partial<ChoiceSystem> = {}): ChoiceSystem => own({ id, name: id, belongsTo, ...over });
  assert.deepEqual(projectSystemOf([sys('a', '/work/shop/web')], '/work/shop', false), { id: 'a', name: 'a' });
  assert.deepEqual(projectSystemOf([sys('a', '/work/shop')], '/work/shop/packages/app', false), { id: 'a', name: 'a' });
  assert.deepEqual(projectSystemOf([sys('a', '/work/shop/')], '/work/shop', false), { id: 'a', name: 'a' });
  assert.equal(projectSystemOf([sys('a', '/work/shop-other')], '/work/shop', false), null);
  assert.equal(projectSystemOf([sys('a', '/work/shop')], '/work/shop-other', false), null);
  assert.equal(projectSystemOf([sys('a', null)], '/work/shop', false), null);
  assert.equal(projectSystemOf([sys('a', '/work/shop', { status: 'draft' })], '/work/shop', false), null);
});

test('projectSystemOf compares as the OS does: win32 folds case and slashes, linux does not', () => {
  assert.deepEqual(projectSystemOf([own({ id: 'a', name: 'A', belongsTo: 'C:\\Repo' })], 'c:/repo/', true), { id: 'a', name: 'A' });
  assert.deepEqual(projectSystemOf([own({ id: 'a', name: 'A', belongsTo: 'C:\\Repo\\web' })], 'c:\\repo', true), { id: 'a', name: 'A' });
  assert.equal(projectSystemOf([own({ id: 'a', belongsTo: '/Repo' })], '/repo', false), null);
  assert.deepEqual(projectSystemOf([own({ id: 'a', name: 'A', belongsTo: '/Repo' })], '/repo', true), { id: 'a', name: 'A' });
});

test('projectSystemOf picks the deepest, then a repo home, then the newest, then the id', () => {
  const sys = (id: string, belongsTo: string, over: Partial<ChoiceSystem> = {}): ChoiceSystem => own({ id, name: id, belongsTo, ...over });
  // Deepest wins over newer and over a repo home, in either order.
  assert.equal(projectSystemOf([sys('top', '/work/shop', { updated: '2026-11-25T00:00:00.000Z' }), sys('deep', '/work/shop/web', { repo: false })], '/work/shop', false)?.id, 'deep');
  assert.equal(projectSystemOf([sys('deep', '/work/shop/web', { repo: false }), sys('top', '/work/shop')], '/work/shop', false)?.id, 'deep');
  // A project inside the repo: the closer ancestor wins.
  assert.equal(projectSystemOf([sys('far', '/work'), sys('near', '/work/shop')], '/work/shop/packages/app', false)?.id, 'near');
  // Same depth: a repo home over an internal one, even when older.
  assert.equal(projectSystemOf([sys('internal', '/work/shop', { repo: false, updated: '2026-11-26T00:00:00.000Z' }), sys('repo', '/work/shop')], '/work/shop', false)?.id, 'repo');
  // Same depth and home: the newest.
  assert.equal(projectSystemOf([sys('old', '/work/shop', { updated: '2026-11-01T00:00:00.000Z' }), sys('new', '/work/shop', { updated: '2026-11-02T00:00:00.000Z' })], '/work/shop', false)?.id, 'new');
  // A full tie: the id, whatever the input order.
  const tie = [sys('b', '/work/shop'), sys('a', '/work/shop')];
  assert.equal(projectSystemOf(tie, '/work/shop', false)?.id, 'a');
  assert.equal(projectSystemOf([...tie].reverse(), '/work/shop', false)?.id, 'a');
});

test('choiceSystemsOf: a repo home owns by its directory, else the recorded source; unreadable rows are dropped', () => {
  const row = (over: Partial<SystemSummary>): SystemSummary => ({
    id: 'x', name: 'X', status: 'ready', changesToReview: false, sources: { code: null, brand: 0, description: false }, created: '2026-11-01T00:00:00.000Z',
    swatches: [], usedBy: 0, isDefault: false, pinnedFor: [], updated: '2026-11-02T00:00:00.000Z', revision: 1, empty: false, unreadable: null,
    home: 'internal', building: false, sharedRepoWith: null, livingPage: null, proposalWaiting: false, depth: null, ...over,
  });
  const code = (directory: string, project?: string): SystemSummary['sources'] => ({ code: { directory, lastScan: '2026-11-01T00:00:00.000Z', partial: false, ...(project === undefined ? {} : { project }) }, brand: 0, description: false });
  assert.deepEqual(choiceSystemsOf([
    row({ id: 'repo', home: { repo: 'shop', directory: '/work/shop' }, sources: code('/elsewhere') }),
    row({ id: 'scanned', sources: code('/work/blog/src', '/work/blog') }),
    row({ id: 'folder', sources: code('/work/docs') }),
    row({ id: 'brand' }),
    row({ id: 'broken', unreadable: 'damaged' }),
  ]).map((one) => [one.id, one.belongsTo, one.repo]), [
    ['repo', '/work/shop', true],
    ['scanned', '/work/blog', false],
    ['folder', '/work/docs', false],
    ['brand', null, false],
  ]);
});
