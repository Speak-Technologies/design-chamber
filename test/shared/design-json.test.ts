import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  adoptAgentFields,
  applyServiceState,
  createDesignDocument,
  directionGroups,
  mergeServiceFields,
  normalizeDesign,
  normalizeKind,
  normalizeServiceState,
  parseComment,
  parseDesignJsonText,
  serializeJson,
  serviceFieldsDiffer,
  serviceStateOf,
  stripForVersion,
  VIEWPORT_LAPTOP,
  VIEWPORT_PHONE,
  type NormalizeOptions,
} from '../../src/shared/design-json.ts';
import { COMMENTS_MAX } from '../../src/shared/limits.ts';
import type { JsonObject, ServiceState } from '../../src/shared/types.ts';

const OPTS: NormalizeOptions = { fallbackTitle: 'my-slug', fallbackTime: '2026-01-01T00:00:00.000Z' };
const T0 = '2026-10-26T18:00:00.000Z';
const T1 = '2026-10-26T18:20:00.000Z';

const comment = (id: string, extra: Partial<Record<string, unknown>> = {}): JsonObject => ({
  id,
  screen: 'home',
  viewport: 'laptop',
  anchor: { selector: 'main > h1', text: 'Ship faster', html: '<h1 class="hero">', rect: { x: 120, y: 340, w: 600, h: 64 }, point: { x: 0.12, y: 0.5 } },
  body: 'Make this shorter',
  status: 'open',
  created: T0,
  sentAt: null,
  sentVersion: null,
  ...(extra as JsonObject),
});

const validCanvas = (): JsonObject => ({
  version: 1,
  kind: 'canvas',
  title: 'Checkout redesign',
  created: T0,
  updated: T1,
  brief: 'A calmer checkout',
  sessionId: 'ses_abc',
  projectDirectory: 'C:\\Users\\me\\shop',
  preset: 'minimal-saas',
  viewports: [
    { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
    { id: 'phone', label: 'Phone', width: 390, height: 844 },
  ],
  screens: [
    { id: 'home', title: 'Home', file: 'screens/home.html', viewports: ['laptop', 'phone'], description: 'Landing' },
    { id: 'checkout', title: 'Checkout', file: 'screens/checkout.html' },
  ],
  designSystem: { confirmed: true },
  comments: [comment('c_8f3k2')],
});

const codes = (warnings: { code: string }[]): string[] => warnings.map((w) => w.code);

describe('normalizeDesign — valid input', () => {
  test('a complete canvas reads back unchanged with no warnings', () => {
    const { design, extra, warnings } = normalizeDesign(validCanvas(), OPTS);
    assert.deepEqual(warnings, []);
    assert.deepEqual(extra, {});
    assert.equal(design.kind, 'canvas');
    assert.equal(design.title, 'Checkout redesign');
    assert.equal(design.created, T0);
    assert.equal(design.updated, T1);
    assert.equal(design.entry, null);
    assert.equal(design.sessionId, 'ses_abc');
    assert.equal(design.projectDirectory, 'C:\\Users\\me\\shop');
    assert.equal(design.preset, 'minimal-saas');
    assert.deepEqual(design.viewports.map((v) => v.id), ['laptop', 'phone']);
    assert.deepEqual(design.screens, [
      { id: 'home', title: 'Home', file: 'screens/home.html', viewports: ['laptop', 'phone'], description: 'Landing' },
      { id: 'checkout', title: 'Checkout', file: 'screens/checkout.html' },
    ]);
    assert.deepEqual(design.designSystem, { confirmed: true });
    assert.equal(design.comments.length, 1);
    assert.equal(design.comments[0]?.body, 'Make this shorter');
  });

  test('a page gets entry index.html and the Laptop default viewport', () => {
    const { design, warnings } = normalizeDesign({ kind: 'page', title: 'Pricing' }, OPTS);
    assert.deepEqual(warnings, []);
    assert.equal(design.entry, 'index.html');
    assert.deepEqual(design.viewports, [VIEWPORT_LAPTOP]);
    assert.deepEqual(design.screens, []);
    assert.equal(design.created, OPTS.fallbackTime);
  });

  test('a canvas without viewports gets Laptop + Phone', () => {
    const { design } = normalizeDesign({ kind: 'canvas', title: 'X' }, OPTS);
    assert.deepEqual(design.viewports, [VIEWPORT_LAPTOP, VIEWPORT_PHONE]);
  });

  test('screen file paths are normalised (backslashes, leading ./) and default from the id', () => {
    const raw = { kind: 'canvas', title: 'X', screens: [{ id: 'a', file: '.\\screens\\a.html' }, { id: 'b' }] };
    const { design, warnings } = normalizeDesign(raw, OPTS);
    assert.deepEqual(warnings, []);
    assert.deepEqual(design.screens.map((s) => [s.file, s.title]), [['screens/a.html', 'a'], ['screens/b.html', 'b']]);
  });
});

describe('normalizeDesign — unknown keys are kept', () => {
  test('top-level unknown keys travel in extra, verbatim', () => {
    const raw = { ...validCanvas(), $schema: 'design-chamber/design@1', notes: { nested: [1, 2, { deep: true }] }, tags: ['a'] };
    const { extra, warnings } = normalizeDesign(raw, OPTS);
    assert.deepEqual(warnings, []);
    assert.deepEqual(extra, { $schema: 'design-chamber/design@1', notes: { nested: [1, 2, { deep: true }] }, tags: ['a'] });
  });

  test('a "__proto__" key from JSON stays an own data key and does not touch prototypes', () => {
    const parsed = parseDesignJsonText('{"kind":"page","title":"X","__proto__":{"polluted":true}}', OPTS);
    assert.equal(Object.hasOwn(parsed.extra, '__proto__'), true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.getPrototypeOf(parsed.extra), Object.prototype);
  });
});

describe('normalizeDesign — invalid fields are dropped with warnings, never fatal', () => {
  test('bad viewports are dropped one by one; duplicates keep the first', () => {
    const raw = {
      kind: 'canvas',
      title: 'X',
      viewports: [
        { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
        { id: 'tiny', width: 100, height: 800 },
        { id: 'huge', width: 1280, height: 5000 },
        { id: 'frac', width: 1280.5, height: 800 },
        { id: 'bad id!', width: 1280, height: 800 },
        { id: 'laptop', width: 1440, height: 900 },
        'nope',
        { id: 'tablet', width: 834, height: 1194 },
      ],
    };
    const { design, warnings } = normalizeDesign(raw, OPTS);
    assert.deepEqual(design.viewports, [
      { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
      { id: 'tablet', label: 'tablet', width: 834, height: 1194 },
    ]);
    assert.deepEqual(codes(warnings), ['invalid-viewport', 'invalid-viewport', 'invalid-viewport', 'invalid-viewport', 'duplicate-viewport', 'invalid-viewport']);
    assert.equal(warnings[0]?.field, 'viewports[1]');
    assert.ok(warnings.every((w) => w.message.length > 0));
  });

  test('viewport bounds are inclusive: 200×200 and 3840×4320 are valid', () => {
    const raw = { kind: 'page', title: 'X', viewports: [{ id: 'min', width: 200, height: 200 }, { id: 'max', width: 3840, height: 4320 }] };
    const { design, warnings } = normalizeDesign(raw, OPTS);
    assert.deepEqual(warnings, []);
    assert.deepEqual(design.viewports.map((v) => v.id), ['min', 'max']);
  });

  test('more than 8 viewports keeps the first 8', () => {
    const viewports = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, width: 400 + i, height: 800 }));
    const { design, warnings } = normalizeDesign({ kind: 'canvas', title: 'X', viewports }, OPTS);
    assert.equal(design.viewports.length, 8);
    assert.deepEqual(codes(warnings), ['too-many-viewports']);
  });

  test('an empty or all-invalid viewport list falls back to the defaults with a warning', () => {
    for (const viewports of [[], [{ id: 'x', width: 1, height: 1 }], 'laptop']) {
      const { design, warnings } = normalizeDesign({ kind: 'canvas', title: 'X', viewports }, OPTS);
      assert.deepEqual(design.viewports, [VIEWPORT_LAPTOP, VIEWPORT_PHONE]);
      assert.ok(warnings.length > 0, `expected a warning for ${JSON.stringify(viewports)}`);
    }
  });

  test('screens with a wrong file, a bad id or a duplicate id are dropped; unknown viewport refs are filtered', () => {
    const raw = {
      kind: 'canvas',
      title: 'X',
      screens: [
        { id: 'home', file: 'screens/home.html', viewports: ['laptop', 'watch'] },
        { id: 'escape', file: '../outside.html' },
        { id: 'other', file: 'screens/not-other.html' },
        { id: 'Bad_Id' },
        { id: 'home', title: 'Again' },
        { id: 'only-ghost', viewports: ['ghost'] },
        { id: 'long', description: 'x'.repeat(501) },
      ],
    };
    const { design, warnings } = normalizeDesign(raw, OPTS);
    assert.deepEqual(design.screens.map((s) => s.id), ['home', 'only-ghost', 'long']);
    assert.deepEqual(design.screens[0]?.viewports, ['laptop']);
    assert.equal(design.screens[1]?.viewports, undefined, 'all refs unknown → shows at every viewport');
    assert.equal(design.screens[2]?.description, undefined);
    assert.deepEqual(codes(warnings), [
      'unknown-screen-viewport',
      'invalid-screen-file',
      'invalid-screen-file',
      'invalid-screen',
      'duplicate-screen',
      'unknown-screen-viewport',
      'invalid-screen-description',
    ]);
  });

  test('more than 40 screens keeps the first 40', () => {
    const screens = Array.from({ length: 45 }, (_, i) => ({ id: `s${i}` }));
    const { design, warnings } = normalizeDesign({ kind: 'canvas', title: 'X', screens }, OPTS);
    assert.equal(design.screens.length, 40);
    assert.deepEqual(codes(warnings), ['too-many-screens']);
  });

  test('a page ignores a screen list, and its entry cannot be changed', () => {
    const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', entry: '../evil.html', screens: [{ id: 'a' }] }, OPTS);
    assert.equal(design.entry, 'index.html');
    assert.deepEqual(design.screens, []);
    assert.deepEqual(codes(warnings).sort(), ['invalid-entry', 'screens-ignored']);
  });

  test('scalar fields: bad title, dates, ids, preset and designSystem fall back with warnings', () => {
    const raw = {
      kind: 'canvas',
      title: '   ',
      created: 'yesterday',
      updated: 42,
      brief: 7,
      sessionId: '',
      projectDirectory: { path: 'x' },
      preset: 'Not A Preset',
      designSystem: { confirmed: 'yes' },
    };
    const { design, warnings } = normalizeDesign(raw, OPTS);
    assert.equal(design.title, 'my-slug');
    assert.equal(design.created, OPTS.fallbackTime);
    assert.equal(design.updated, OPTS.fallbackTime);
    assert.equal(design.brief, '');
    assert.equal(design.sessionId, null);
    assert.equal(design.projectDirectory, null);
    assert.equal(design.preset, null);
    assert.deepEqual(design.designSystem, { confirmed: false });
    assert.deepEqual(codes(warnings).sort(), [
      'invalid-brief',
      'invalid-created',
      'invalid-design-system',
      'invalid-preset',
      'invalid-projectDirectory',
      'invalid-sessionId',
      'invalid-title',
      'invalid-updated',
    ]);
  });

  test('a title over 120 characters is dropped; one of exactly 120 is kept', () => {
    assert.equal(normalizeDesign({ kind: 'page', title: 'x'.repeat(120) }, OPTS).design.title.length, 120);
    const long = normalizeDesign({ kind: 'page', title: 'x'.repeat(121) }, OPTS);
    assert.equal(long.design.title, 'my-slug');
    assert.deepEqual(codes(long.warnings), ['invalid-title']);
  });

  test('a brief over 2000 characters is truncated with a warning', () => {
    const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', brief: 'b'.repeat(2500) }, OPTS);
    assert.equal(design.brief.length, 2000);
    assert.deepEqual(codes(warnings), ['brief-truncated']);
  });

  test('damaged and duplicate comments are dropped', () => {
    const raw = {
      kind: 'canvas',
      title: 'X',
      comments: [comment('c_aaaa1'), comment('c_aaaa1'), comment('nope'), comment('c_bbbb2', { body: '' }), comment('c_cccc3', { status: 'archived' })],
    };
    const { design, warnings } = normalizeDesign(raw, OPTS);
    assert.deepEqual(design.comments.map((c) => c.id), ['c_aaaa1']);
    assert.deepEqual(codes(warnings), ['invalid-comment', 'invalid-comment', 'invalid-comment', 'invalid-comment']);
  });

  test('missing or invalid kind is inferred from screens, and an authoritative kind wins', () => {
    const inferred = normalizeDesign({ title: 'X', screens: [{ id: 'a' }] }, OPTS);
    assert.equal(inferred.design.kind, 'canvas');
    assert.deepEqual(codes(inferred.warnings), ['invalid-kind']);
    assert.equal(normalizeDesign({ title: 'X', kind: 'poster' }, OPTS).design.kind, 'page');
    const forced = normalizeDesign({ kind: 'page', title: 'X', screens: [{ id: 'a' }] }, { ...OPTS, kind: 'canvas' });
    assert.equal(forced.design.kind, 'canvas');
    assert.deepEqual(forced.design.screens.map((s) => s.id), ['a']);
  });

  test('a future version warns but still reads', () => {
    const { design, warnings } = normalizeDesign({ ...validCanvas(), version: 2 }, OPTS);
    assert.equal(design.title, 'Checkout redesign');
    assert.deepEqual(codes(warnings), ['unsupported-version']);
  });

  test('non-object JSON and broken JSON give defaults, never throw', () => {
    for (const text of ['[1,2]', '"x"', 'null', '{"kind":', '']) {
      const parsed = parseDesignJsonText(text, OPTS);
      assert.equal(parsed.raw, null, text);
      assert.equal(parsed.design.title, 'my-slug');
      assert.ok(parsed.warnings.length > 0);
    }
    assert.equal(parseDesignJsonText('{"kind":', OPTS).warnings[0]?.code, 'invalid-json');
  });

  test('a UTF-8 BOM is tolerated', () => {
    const parsed = parseDesignJsonText(`\uFEFF${JSON.stringify({ kind: 'page', title: 'Bom' })}`, OPTS);
    assert.equal(parsed.design.title, 'Bom');
    assert.notEqual(parsed.raw, null);
  });
});

describe('parseComment', () => {
  test('accepts a valid comment and tolerates missing sentAt/sentVersion', () => {
    const { sentAt: _a, sentVersion: _b, ...rest } = comment('c_abcd1');
    const parsed = parseComment(rest);
    assert.equal(parsed?.sentAt, null);
    assert.equal(parsed?.sentVersion, null);
  });

  test('rejects out-of-range anchors and bodies', () => {
    const anchor = (patch: JsonObject): JsonObject => ({ ...(comment('c_abcd1').anchor as JsonObject), ...patch });
    assert.equal(parseComment(comment('c_abcd1', { anchor: anchor({ point: { x: 1.5, y: 0 } }) })), null);
    assert.equal(parseComment(comment('c_abcd1', { anchor: anchor({ text: 't'.repeat(121) }) })), null);
    assert.equal(parseComment(comment('c_abcd1', { anchor: anchor({ html: 'h'.repeat(201) }) })), null);
    assert.equal(parseComment(comment('c_abcd1', { anchor: anchor({ rect: { x: 0, y: 0, w: -1, h: 1 } }) })), null);
    assert.equal(parseComment(comment('c_abcd1', { body: 'b'.repeat(2001) })), null);
    assert.equal(parseComment(comment('c_abcd1', { sentVersion: 0 })), null);
    assert.notEqual(parseComment(comment('c_abcd1', { body: 'b'.repeat(2000), screen: null })), null);
  });
});

describe('service-owned fields (state.json authority, §6.3)', () => {
  const state: ServiceState = {
    version: 1,
    kind: 'canvas',
    created: T0,
    brief: 'brief',
    sessionId: 'ses_1',
    projectDirectory: null,
    preset: null,
    entry: null,
    comments: [],
  };

  test('mergeServiceFields restores service fields and keeps agent fields, unknown keys and key order', () => {
    const agentWrite: JsonObject = {
      title: 'Agent title',
      $custom: { keep: true },
      kind: 'page',
      updated: T1,
      viewports: 'broken but the agent’s',
      sessionId: 'ses_forged',
    };
    const merged = mergeServiceFields(agentWrite, state);
    assert.deepEqual(Object.keys(merged), ['title', '$custom', 'kind', 'updated', 'viewports', 'sessionId', 'version', 'created', 'brief', 'projectDirectory', 'preset', 'comments']);
    assert.equal(merged.kind, 'canvas');
    assert.equal(merged.sessionId, 'ses_1');
    assert.equal(merged.title, 'Agent title');
    assert.equal(merged.viewports, 'broken but the agent’s');
    assert.deepEqual(merged.$custom, { keep: true });
    assert.equal(Object.hasOwn(merged, 'entry'), false, 'a canvas has no entry');
  });

  test('an agent overwrite that lost the comments is detected and re-merged', () => {
    const withComments: ServiceState = { ...state, comments: [parseComment(comment('c_keep1')) ?? assert.fail('fixture')] };
    const agentWrite: JsonObject = { ...(createDesignDocument({ ...withComments, title: 'T', now: T0 }).json) };
    delete agentWrite.comments;
    assert.equal(serviceFieldsDiffer(agentWrite, withComments), true);
    const merged = mergeServiceFields(agentWrite, withComments);
    assert.equal(serviceFieldsDiffer(merged, withComments), false);
    assert.equal((merged.comments as JsonObject[])[0]?.id, 'c_keep1');
  });

  test('a merge of an already merged file is byte-identical (no watch loop)', () => {
    const once = serializeJson(mergeServiceFields({ title: 'X', extra: 1 }, state));
    const twice = serializeJson(mergeServiceFields(JSON.parse(once) as JsonObject, state));
    assert.equal(twice, once);
  });

  test('service writes may set title and updated', () => {
    const merged = mergeServiceFields({ title: 'Old', updated: T0 }, state, { title: 'Renamed', updated: T1 });
    assert.equal(merged.title, 'Renamed');
    assert.equal(merged.updated, T1);
  });

  test('createDesignDocument writes canonical order and reads back cleanly', () => {
    const page = createDesignDocument({ kind: 'page', title: 'Pricing', brief: 'b', sessionId: null, projectDirectory: null, preset: null, now: T0 });
    assert.deepEqual(Object.keys(page.json), ['version', 'kind', 'title', 'created', 'updated', 'brief', 'sessionId', 'projectDirectory', 'preset', 'entry', 'viewports', 'designSystem', 'comments']);
    const reread = normalizeDesign(page.json, OPTS);
    assert.deepEqual(reread.warnings, []);
    assert.equal(reread.design.entry, 'index.html');
    const canvas = createDesignDocument({ kind: 'canvas', title: 'Wall', brief: '', sessionId: 's', projectDirectory: 'C:\\p', preset: 'editorial', now: T0 });
    assert.deepEqual(canvas.json.screens, []);
    assert.equal(Object.hasOwn(canvas.json, 'entry'), false);
    assert.deepEqual(serviceStateOf(normalizeDesign(canvas.json, OPTS).design), canvas.state);
  });

  test('normalizeServiceState accepts a valid state and rejects a damaged one', () => {
    assert.deepEqual(normalizeServiceState(state), state);
    assert.equal(normalizeServiceState({ ...state, version: 2 }), null);
    assert.equal(normalizeServiceState({ ...state, kind: 'x' }), null);
    assert.equal(normalizeServiceState({ ...state, created: 'nope' }), null);
    assert.equal(normalizeServiceState('{}'), null);
  });

  test('applyServiceState overlays state onto the agent view', () => {
    const { design } = normalizeDesign({ ...validCanvas(), sessionId: 'ses_forged', comments: [] }, OPTS);
    const view = applyServiceState(design, state);
    assert.equal(view.sessionId, 'ses_1');
    assert.equal(view.title, 'Checkout redesign');
    assert.deepEqual(view.comments, []);
  });

  test('stripForVersion removes comments only', () => {
    assert.deepEqual(stripForVersion({ title: 'X', comments: [], other: 1 }), { title: 'X', other: 1 });
  });
});

describe('the old "artifact" kind reads as page (alias, no rewrite on its own)', () => {
  const pageState: ServiceState = {
    version: 1,
    kind: 'page',
    created: T0,
    brief: 'b',
    sessionId: null,
    projectDirectory: null,
    preset: null,
    entry: 'index.html',
    comments: [],
  };

  test('normalizeKind maps artifact to page and refuses anything else', () => {
    assert.equal(normalizeKind('page'), 'page');
    assert.equal(normalizeKind('canvas'), 'canvas');
    assert.equal(normalizeKind('artifact'), 'page');
    for (const value of ['Page', 'ARTIFACT', '', 'x', null, undefined, 1, ['page'], { kind: 'page' }]) assert.equal(normalizeKind(value), null, String(value));
  });

  test('design.json with "kind": "artifact" reads as a page with no warning', () => {
    const { design, warnings } = normalizeDesign({ kind: 'artifact', title: 'Old one' }, OPTS);
    assert.deepEqual(warnings, []);
    assert.equal(design.kind, 'page');
    assert.equal(design.entry, 'index.html');
    assert.deepEqual(design.viewports, [VIEWPORT_LAPTOP]);
  });

  test('state.json with "kind": "artifact" reads as a page', () => {
    const state = normalizeServiceState({ ...pageState, kind: 'artifact', entry: 'index.html' });
    assert.equal(state?.kind, 'page');
    assert.equal(state?.entry, 'index.html');
  });

  test('"artifact" in design.json against a "page" state is not a difference; a real difference still is', () => {
    const raw = mergeServiceFields({ title: 'X' }, pageState);
    assert.equal(serviceFieldsDiffer({ ...raw, kind: 'artifact' }, pageState), false);
    assert.equal(serviceFieldsDiffer({ ...raw, kind: 'canvas' }, pageState), true);
    assert.equal(serviceFieldsDiffer({ ...raw, kind: 'nonsense' }, pageState), true);
    assert.equal(serviceFieldsDiffer({ ...raw, kind: 'artifact' }, { ...pageState, kind: 'canvas', entry: null }), true);
  });

  test('the next real service write rewrites "artifact" as "page"', () => {
    const merged = mergeServiceFields({ kind: 'artifact', title: 'X' }, pageState, { title: 'Renamed' });
    assert.equal(merged.kind, 'page');
  });
});

describe('provisional state (service-owned, never mirrored)', () => {
  const base: ServiceState = {
    version: 1,
    kind: 'page',
    created: T0,
    brief: '',
    sessionId: null,
    projectDirectory: null,
    preset: null,
    entry: 'index.html',
    comments: [],
  };

  test('"provisional": true survives normalizeServiceState; any other value is dropped', () => {
    assert.equal(normalizeServiceState({ ...base, provisional: true })?.provisional, true);
    for (const value of ['yes', 1, 'true', false, null, {}]) {
      const state = normalizeServiceState({ ...base, provisional: value });
      assert.notEqual(state, null);
      assert.equal(Object.hasOwn(state ?? {}, 'provisional'), false, String(value));
    }
    assert.equal(Object.hasOwn(normalizeServiceState(base) ?? {}, 'provisional'), false);
  });

  test('mergeServiceFields never writes provisional, and it is never a merge trigger', () => {
    const provisional: ServiceState = { ...base, provisional: true };
    const merged = mergeServiceFields({ title: 'X' }, provisional);
    assert.equal(Object.hasOwn(merged, 'provisional'), false);
    assert.equal(serviceFieldsDiffer(merged, provisional), false);
    assert.equal(serviceFieldsDiffer(merged, base), false);
    const { design } = normalizeDesign(merged, OPTS);
    assert.equal(Object.hasOwn(applyServiceState(design, provisional), 'provisional'), false);
  });
});

describe('adoptAgentFields (take-over without clobbering, §6.3 P2 and P5)', () => {
  const seed: ServiceState = {
    version: 1,
    kind: 'page',
    created: '2026-11-01T09:00:00.000Z',
    brief: '',
    sessionId: null,
    projectDirectory: null,
    preset: null,
    entry: 'index.html',
    comments: [],
  };
  const provisional: ServiceState = { ...seed, provisional: true };
  // What the store passes: the agent's file normalised with the state's kind as authority.
  const adopt = (state: ServiceState, raw: JsonObject, pending = false): ServiceState | null =>
    adoptAgentFields({ state, raw, normalized: normalizeDesign(raw, { ...OPTS, kind: state.kind }).design, pending });

  test('P2: a provisional state takes the agent\'s kind, created, brief, session, project and preset, and drops the flag', () => {
    const raw: JsonObject = { kind: 'canvas', created: T0, brief: 'A calmer checkout', sessionId: 'ses_abc', projectDirectory: '/home/me/shop', preset: 'minimal-saas' };
    const adopted = adopt(provisional, raw);
    assert.deepEqual(adopted, {
      version: 1,
      kind: 'canvas',
      created: T0,
      brief: 'A calmer checkout',
      sessionId: 'ses_abc',
      projectDirectory: '/home/me/shop',
      preset: 'minimal-saas',
      entry: null,
      comments: [],
    });
    assert.equal(Object.hasOwn(adopted ?? {}, 'provisional'), false);
    // The merge that follows only adds missing keys: the agent's values are already the state's.
    const merged = mergeServiceFields(raw, adopted ?? provisional);
    for (const key of ['kind', 'created', 'brief', 'sessionId', 'projectDirectory', 'preset'] as const) assert.equal(merged[key], raw[key], key);
  });

  test('P2: "artifact" adopts as page; a missing or unknown kind keeps the normalised (file-based) kind', () => {
    assert.equal(adopt(provisional, { kind: 'artifact' })?.kind, 'page');
    assert.equal(adopt({ ...provisional, kind: 'canvas', entry: null }, { brief: 'x' })?.kind, 'canvas');
    const unknown = adopt(provisional, { kind: 'poster' });
    assert.equal(unknown?.kind, 'page');
    assert.equal(unknown?.entry, 'index.html');
  });

  test('P2: invalid agent values become the normalised ones', () => {
    const adopted = adopt(provisional, { kind: 'page', sessionId: 42, created: 'yesterday', brief: ['x'], preset: 'Not A Preset' });
    assert.equal(adopted?.sessionId, null);
    assert.equal(adopted?.created, OPTS.fallbackTime);
    assert.equal(adopted?.brief, '');
    assert.equal(adopted?.preset, null);
  });

  test('P2: comments are state\'s plus the agent file\'s new ids; state wins an id clash', () => {
    const mine = parseComment(comment('c_shared', { body: 'Mine' }));
    const ownOnly = parseComment(comment('c_state1'));
    assert.ok(mine && ownOnly);
    const state: ServiceState = { ...provisional, comments: [ownOnly, mine] };
    const adopted = adopt(state, { kind: 'page', comments: [comment('c_shared', { body: 'Agent copy' }), comment('c_agent1')] });
    assert.deepEqual(adopted?.comments.map((entry) => [entry.id, entry.body]), [
      ['c_state1', 'Make this shorter'],
      ['c_shared', 'Mine'],
      ['c_agent1', 'Make this shorter'],
    ]);
  });

  test(`P2: the merged comment list is capped at ${COMMENTS_MAX}, state's first`, () => {
    const full = Array.from({ length: COMMENTS_MAX }, (_unused, index) => parseComment(comment(`c_s${String(index).padStart(4, '0')}`)));
    const stateComments = full.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const adopted = adopt({ ...provisional, comments: stateComments }, { kind: 'page', comments: [comment('c_extra')] });
    assert.equal(adopted?.comments.length, COMMENTS_MAX);
    assert.equal(adopted?.comments.some((entry) => entry.id === 'c_extra'), false);
  });

  test('P5: a final, pending, uncommented design adopts a new valid kind; entry follows', () => {
    const switched = adopt(seed, { kind: 'canvas' }, true);
    assert.equal(switched?.kind, 'canvas');
    assert.equal(switched?.entry, null);
    assert.equal(Object.hasOwn(switched ?? {}, 'provisional'), false);
    const back = adopt({ ...seed, kind: 'canvas', entry: null }, { kind: 'page' }, true);
    assert.equal(back?.entry, 'index.html');
  });

  test('P5: otherwise state wins (written files, comments, same kind, an alias or an unknown kind)', () => {
    const pin = parseComment(comment('c_pin1'));
    assert.ok(pin);
    assert.equal(adopt(seed, { kind: 'canvas' }, false), null, 'not pending');
    assert.equal(adopt({ ...seed, comments: [pin] }, { kind: 'canvas' }, true), null, 'has a comment');
    assert.equal(adopt(seed, { kind: 'page' }, true), null, 'same kind');
    assert.equal(adopt(seed, { kind: 'artifact' }, true), null, 'the alias is the same kind');
    assert.equal(adopt(seed, { kind: 'poster' }, true), null, 'unknown kind');
    assert.equal(adopt(seed, { brief: 'only a brief change' }, true), null, 'no kind');
  });
});

// ---- Phase 2: tweaks knobs (§4.1) ----

const numberKnob = (over: Record<string, unknown> = {}): JsonObject =>
  ({ var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '', ...over } as JsonObject);

const choiceKnob = (over: Record<string, unknown> = {}): JsonObject =>
  ({
    var: '--density',
    label: 'Density',
    kind: 'choice',
    options: [
      { label: 'Compact', value: '0.85' },
      { label: 'Comfortable', value: '1' },
    ],
    ...over,
  } as JsonObject);

describe('normalizeDesign — tweaks (Phase 2 §4.1)', () => {
  test('valid number and choice knobs read back; absent tweaks read as []', () => {
    const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob(), choiceKnob()] }, OPTS);
    assert.deepEqual(warnings, []);
    assert.deepEqual(design.tweaks, [
      { var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '' },
      {
        var: '--density',
        label: 'Density',
        kind: 'choice',
        options: [
          { label: 'Compact', value: '0.85' },
          { label: 'Comfortable', value: '1' },
        ],
      },
    ]);
    assert.deepEqual(normalizeDesign({ kind: 'page', title: 'X' }, OPTS).design.tweaks, []);
  });

  test('a tweaks value that is not a list warns and shows none', () => {
    for (const tweaks of ['nope', 42, { var: '--x' }]) {
      const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks }, OPTS);
      assert.deepEqual(design.tweaks, []);
      assert.deepEqual(codes(warnings), ['invalid-tweaks']);
      assert.equal(warnings[0]?.message, 'The tweak list is not a list, so no tweaks are shown.');
    }
  });

  test('a broken var, label or kind drops the knob with its reason', () => {
    const cases: [JsonObject, string][] = [
      [numberKnob({ var: 'accent-h' }), 'it needs a var like --accent'],
      [numberKnob({ var: '--accent hue' }), 'it needs a var like --accent'],
      [numberKnob({ var: `--${'x'.repeat(65)}` }), 'it needs a var like --accent'],
      [numberKnob({ var: '--x; color:red' }), 'it needs a var like --accent'],
      [numberKnob({ label: '   ' }), 'its label must be 1 to 40 characters'],
      [numberKnob({ label: 'x'.repeat(41) }), 'its label must be 1 to 40 characters'],
      [numberKnob({ kind: 'slider' }), 'its kind must be "number" or "choice"'],
    ];
    for (const [knob, reason] of cases) {
      const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [knob] }, OPTS);
      assert.deepEqual(design.tweaks, [], JSON.stringify(knob));
      assert.deepEqual(codes(warnings), ['invalid-tweak']);
      assert.equal(warnings[0]?.field, 'tweaks[0]');
      assert.ok(warnings[0]?.message.includes(reason), warnings[0]?.message);
      assert.ok(warnings[0]?.message.startsWith('Tweak 1 in design.json is not usable ('), warnings[0]?.message);
    }
    // A non-object entry is dropped the same way.
    assert.deepEqual(codes(normalizeDesign({ kind: 'page', title: 'X', tweaks: ['nope'] }, OPTS).warnings), ['invalid-tweak']);
  });

  test('number bounds: min below max, finite, within the absolute cap', () => {
    const cases: JsonObject[] = [
      numberKnob({ min: 360, max: 0 }),
      numberKnob({ min: 10, max: 10 }),
      numberKnob({ min: Number.NaN, max: 360 }),
      numberKnob({ min: 0, max: Number.POSITIVE_INFINITY }),
      numberKnob({ min: -1_000_001, max: 360 }),
      numberKnob({ min: 0, max: 1_000_001 }),
      numberKnob({ min: '0', max: 360 }),
    ];
    for (const knob of cases) {
      const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [knob] }, OPTS);
      assert.deepEqual(design.tweaks, [], JSON.stringify(knob));
      assert.deepEqual(codes(warnings), ['invalid-tweak']);
      assert.ok(warnings[0]?.message.includes('min must be below max'), warnings[0]?.message);
    }
    // The bounds themselves are inclusive.
    const edge = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob({ min: -1_000_000, max: 1_000_000, step: 2_000_000 })] }, OPTS);
    assert.deepEqual(edge.warnings, []);
    assert.equal(edge.design.tweaks.length, 1);
  });

  test('step: above 0, fits the range, at most 4 decimals', () => {
    const cases: JsonObject[] = [
      numberKnob({ step: 0 }),
      numberKnob({ step: -1 }),
      numberKnob({ step: 361 }),
      numberKnob({ step: 0.00001 }),
      numberKnob({ step: Number.NaN }),
      numberKnob({ step: '1' }),
    ];
    for (const knob of cases) {
      const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [knob] }, OPTS);
      assert.deepEqual(design.tweaks, [], JSON.stringify(knob));
      assert.ok(warnings[0]?.message.includes('step must be above 0 and fit the range'), warnings[0]?.message);
    }
    for (const step of [1, 0.5, 0.0001, 360]) {
      const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob({ step })] }, OPTS);
      assert.deepEqual(warnings, [], String(step));
      assert.equal((design.tweaks[0] as { step: number }).step, step);
    }
  });

  test('unit: letters or %, up to 6; absent means empty', () => {
    for (const unit of ['PX', 'px!', 'remremrem', 8]) {
      const { warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob({ unit })] }, OPTS);
      assert.deepEqual(codes(warnings), ['invalid-tweak'], String(unit));
      assert.ok(warnings[0]?.message.includes('the unit must be letters or %'));
    }
    const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob({ unit: 'px' }), numberKnob({ var: '--r2' })] }, OPTS);
    assert.deepEqual(warnings, []);
    assert.equal((design.tweaks[0] as { unit: string }).unit, 'px');
    assert.equal((design.tweaks[1] as { unit: string }).unit, '');
  });

  test('choice options: 2 to 6, plain distinct values, balanced quotes, labels 1..30', () => {
    const opt = (label: string, value: string): JsonObject => ({ label, value });
    const cases: JsonObject[] = [
      choiceKnob({ options: [opt('One', '1')] }),
      choiceKnob({ options: Array.from({ length: 7 }, (_, i) => opt(`O${i}`, String(i))) }),
      choiceKnob({ options: [opt('A', '1'), opt('B', '1')] }),
      choiceKnob({ options: [opt('A', '1; color: red'), opt('B', '2')] }),
      choiceKnob({ options: [opt('A', '{x}'), opt('B', '2')] }),
      choiceKnob({ options: [opt('A', '<b>'), opt('B', '2')] }),
      choiceKnob({ options: [opt('A', 'a\\b'), opt('B', '2')] }),
      choiceKnob({ options: [opt('A', 'a*b'), opt('B', '2')] }),
      choiceKnob({ options: [opt('A', "it's"), opt('B', '2')] }),
      choiceKnob({ options: [opt('A', 'say "hi'), opt('B', '2')] }),
      choiceKnob({ options: [opt('x'.repeat(31), '1'), opt('B', '2')] }),
      choiceKnob({ options: [opt('  ', '1'), opt('B', '2')] }),
      choiceKnob({ options: [opt('A', 'x'.repeat(81)), opt('B', '2')] }),
      choiceKnob({ options: ['nope', opt('B', '2')] }),
      choiceKnob({ options: 'nope' }),
    ];
    for (const knob of cases) {
      const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [knob] }, OPTS);
      assert.deepEqual(design.tweaks, [], JSON.stringify(knob));
      assert.deepEqual(codes(warnings), ['invalid-tweak']);
      assert.ok(warnings[0]?.message.includes('a choice needs 2 to 6 options with distinct plain values'), warnings[0]?.message);
    }
    // Six options with balanced quotes and the allowed punctuation parse.
    const six = choiceKnob({ options: Array.from({ length: 6 }, (_, i) => opt(`Option ${i}`, `value-${i} "#%.,()+/"`)) });
    const ok = normalizeDesign({ kind: 'page', title: 'X', tweaks: [six] }, OPTS);
    assert.deepEqual(ok.warnings, []);
    assert.equal((ok.design.tweaks[0] as { options: unknown[] }).options.length, 6);
  });

  test('duplicate vars keep the first; the 13th knob is dropped; unknown knob keys are ignored', () => {
    const dup = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob(), numberKnob({ label: 'Other hue', min: 1, max: 2 })] }, OPTS);
    assert.deepEqual(codes(dup.warnings), ['duplicate-tweak']);
    assert.equal(dup.warnings[0]?.message, 'Two tweaks use --accent-h; only the first is shown.');
    assert.equal(dup.design.tweaks.length, 1);
    assert.equal(dup.design.tweaks[0]?.label, 'Accent hue');

    const thirteen = Array.from({ length: 13 }, (_, i) => numberKnob({ var: `--v${i}`, label: `V${i}` }));
    const many = normalizeDesign({ kind: 'page', title: 'X', tweaks: thirteen }, OPTS);
    assert.deepEqual(codes(many.warnings), ['too-many-tweaks']);
    assert.equal(many.warnings[0]?.message, 'Only the first 12 tweaks are shown.');
    assert.equal(many.design.tweaks.length, 12);
    assert.equal(many.design.tweaks[11]?.var, '--v11');

    // A `default` or `description` inside a knob is ignored silently: the file's value is the value.
    const extra = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob({ default: 210, description: 'The accent' })] }, OPTS);
    assert.deepEqual(extra.warnings, []);
    assert.deepEqual(extra.design.tweaks[0], { var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '' });
  });

  test('invalid knobs are dropped one by one; the valid ones stay, in order', () => {
    const { design, warnings } = normalizeDesign(
      { kind: 'page', title: 'X', tweaks: [numberKnob({ var: 'bad' }), choiceKnob(), numberKnob({ var: '--radius', label: 'Radius', unit: 'px' })] },
      OPTS,
    );
    assert.deepEqual(codes(warnings), ['invalid-tweak']);
    assert.deepEqual(design.tweaks.map((t) => t.var), ['--density', '--radius']);
  });
});

// ---- Phase 2: direction marks (§6.1) ----

const marked = (id: string, of: string, letter: string, name: string): JsonObject =>
  ({ id, title: id, file: `screens/${id}.html`, direction: { of, letter, name } });

describe('normalizeDesign — direction marks (Phase 2 §6.1)', () => {
  test('a valid mark reads back on the screen entry', () => {
    const raw = { kind: 'canvas', title: 'X', screens: [{ id: 'home', title: 'Home' }, marked('home-b', 'home', 'B', 'Editorial')] };
    const { design, warnings } = normalizeDesign(raw, OPTS);
    assert.deepEqual(warnings, []);
    assert.deepEqual(design.screens[1]?.direction, { of: 'home', letter: 'B', name: 'Editorial' });
    assert.equal(design.screens[0]?.direction, undefined);
  });

  test('a broken mark is dropped and the screen shows as a normal row', () => {
    const cases: JsonObject[] = [
      { id: 'home-b', direction: 'B' },
      { id: 'home-b', direction: { of: 'Home', letter: 'B', name: 'X' } },
      { id: 'home-b', direction: { of: 'home-b', letter: 'B', name: 'X' } },
      { id: 'home-b', direction: { of: 'home', letter: 'E', name: 'X' } },
      { id: 'home-b', direction: { of: 'home', letter: 'B', name: '  ' } },
      { id: 'home-b', direction: { of: 'home', letter: 'B', name: 'x'.repeat(41) } },
      { id: 'home-b', direction: { of: 'home', letter: 'B' } },
    ];
    for (const entry of cases) {
      const { design, warnings } = normalizeDesign({ kind: 'canvas', title: 'X', screens: [{ id: 'home' }, entry] }, OPTS);
      assert.equal(design.screens.length, 2, JSON.stringify(entry));
      assert.equal(design.screens[1]?.direction, undefined, JSON.stringify(entry));
      assert.deepEqual(codes(warnings), ['invalid-direction']);
      assert.equal(warnings[0]?.field, 'screens[1].direction');
      assert.equal(warnings[0]?.message, 'Screen "home-b" has a direction mark Design Chamber can\'t read, so it shows as a normal screen.');
    }
  });

  test('an orphan mark (of is not a listed screen) is dropped with a warning', () => {
    const { design, warnings } = normalizeDesign({ kind: 'canvas', title: 'X', screens: [{ id: 'home' }, marked('home-b', 'gone', 'B', 'X')] }, OPTS);
    assert.equal(design.screens[1]?.direction, undefined);
    assert.deepEqual(codes(warnings), ['direction-orphan']);
    assert.equal(warnings[0]?.message, 'Screen "home-b" is marked as a direction of "gone", which is not a screen here, so it shows as a normal screen.');
  });

  test('a chain (of carries a direction key as written) is dropped; cycles fail both marks', () => {
    const chain = normalizeDesign(
      { kind: 'canvas', title: 'X', screens: [{ id: 'home' }, marked('home-b', 'home', 'B', 'X'), marked('home-c', 'home-b', 'C', 'Y')] },
      OPTS,
    );
    assert.deepEqual(chain.design.screens.map((s) => s.direction?.of), [undefined, 'home', undefined]);
    assert.deepEqual(codes(chain.warnings), ['direction-chain']);
    assert.equal(chain.warnings[0]?.message, 'Screen "home-c" is marked as a direction of "home-b", which is itself a direction, so it shows as a normal screen.');

    // a → b and b → a: both marks fail the chain rule, no graph walk needed.
    const cycle = normalizeDesign(
      { kind: 'canvas', title: 'X', screens: [marked('a', 'b', 'A', 'X'), marked('b', 'a', 'B', 'Y')] },
      OPTS,
    );
    assert.deepEqual(cycle.design.screens.map((s) => s.direction), [undefined, undefined]);
    assert.deepEqual(codes(cycle.warnings), ['direction-chain', 'direction-chain']);

    // "As written": even an INVALID direction key on the root makes a mark pointing at it a chain.
    const invalidRoot = normalizeDesign(
      { kind: 'canvas', title: 'X', screens: [{ id: 'home', direction: 'broken' }, marked('home-b', 'home', 'B', 'X')] },
      OPTS,
    );
    assert.deepEqual(codes(invalidRoot.warnings), ['invalid-direction', 'direction-chain']);
    assert.equal(invalidRoot.design.screens[1]?.direction, undefined);
  });

  test('a letter is used once per group: the first in list order wins', () => {
    const { design, warnings } = normalizeDesign(
      { kind: 'canvas', title: 'X', screens: [{ id: 'home' }, marked('home-b', 'home', 'B', 'First'), marked('home-c', 'home', 'B', 'Second'), marked('home-d', 'home', 'C', 'Third')] },
      OPTS,
    );
    assert.deepEqual(design.screens.map((s) => s.direction?.letter), [undefined, 'B', undefined, 'C']);
    assert.deepEqual(codes(warnings), ['direction-letter-taken']);
    assert.equal(warnings[0]?.message, 'Screen "home-c" uses direction letter B, which "home-b" already has, so it shows as a normal screen.');
    // The same letter in another group is fine.
    const other = normalizeDesign(
      { kind: 'canvas', title: 'X', screens: [{ id: 'home' }, { id: 'pricing' }, marked('home-b', 'home', 'B', 'X'), marked('pricing-b', 'pricing', 'B', 'Y')] },
      OPTS,
    );
    assert.deepEqual(other.warnings, []);
  });

  test('a page ignores marks with its screen list', () => {
    const { design, warnings } = normalizeDesign({ kind: 'page', title: 'X', screens: [marked('home-b', 'home', 'B', 'X')] }, OPTS);
    assert.deepEqual(design.screens, []);
    assert.deepEqual(codes(warnings), ['screens-ignored']);
  });
});

describe('directionGroups (Phase 2 §6.1)', () => {
  test('groups hold their members in letter order; roots are not members; empty groups do not exist', () => {
    const { design } = normalizeDesign(
      {
        kind: 'canvas',
        title: 'X',
        screens: [
          { id: 'home' },
          marked('home-c', 'home', 'C', 'Bold'),
          marked('home-a', 'home', 'A', 'Calm'),
          { id: 'pricing' },
          marked('pricing-b', 'pricing', 'B', 'Editorial'),
          marked('orphan', 'gone', 'A', 'Lost'),
        ],
      },
      OPTS,
    );
    const groups = directionGroups(design.screens);
    assert.deepEqual(groups.map((g) => g.of), ['home', 'pricing']);
    assert.deepEqual(groups[0]?.members.map((s) => s.id), ['home-a', 'home-c']);
    assert.deepEqual(groups[1]?.members.map((s) => s.id), ['pricing-b']);
    assert.equal(groups.some((g) => g.members.some((s) => s.id === 'home' || s.id === 'orphan')), false);
    assert.deepEqual(directionGroups([{ id: 'home', title: 'Home', file: 'screens/home.html' }]), []);
  });
});

describe('Phase 2 contract compatibility', () => {
  test('an old design.json (no tweaks, no marks) normalises exactly as before, plus tweaks: []', () => {
    const { design, extra, warnings } = normalizeDesign(validCanvas(), OPTS);
    assert.deepEqual(warnings, []);
    assert.deepEqual(extra, {});
    assert.deepEqual(design.tweaks, []);
    assert.deepEqual(design.screens, [
      { id: 'home', title: 'Home', file: 'screens/home.html', viewports: ['laptop', 'phone'], description: 'Landing' },
      { id: 'checkout', title: 'Checkout', file: 'screens/checkout.html' },
    ]);
    // The rest of the shape is untouched.
    assert.equal(design.title, 'Checkout redesign');
    assert.equal(design.kind, 'canvas');
    assert.equal(design.comments.length, 1);
  });

  test('tweaks is a known field: it never travels in extra, and created files have no tweaks key', () => {
    const { extra } = normalizeDesign({ kind: 'page', title: 'X', tweaks: [numberKnob()] }, OPTS);
    assert.equal(Object.hasOwn(extra, 'tweaks'), false);
    const created = createDesignDocument({ kind: 'canvas', title: 'Wall', brief: '', sessionId: null, projectDirectory: null, preset: null, now: T0 });
    assert.equal(Object.hasOwn(created.json, 'tweaks'), false);
    assert.deepEqual(normalizeDesign(created.json, OPTS).design.tweaks, []);
  });

  test('ServiceWrite.screens writes the list in place, keeping every other key (Phase 2 §5.1)', () => {
    const state: ServiceState = {
      version: 1,
      kind: 'canvas',
      created: T0,
      brief: '',
      sessionId: null,
      projectDirectory: null,
      preset: null,
      entry: null,
      comments: [],
    };
    const raw: JsonObject = { title: 'X', viewports: [], screens: [{ id: 'a' }], designSystem: { confirmed: false }, $custom: 1 };
    const next = [{ id: 'b' }, { id: 'a' }];
    const merged = mergeServiceFields(raw, state, { screens: next, updated: T1 });
    assert.deepEqual(merged.screens, next);
    assert.deepEqual(Object.keys(merged), ['title', 'viewports', 'screens', 'designSystem', '$custom', 'version', 'kind', 'created', 'updated', 'brief', 'sessionId', 'projectDirectory', 'preset', 'comments']);
    assert.equal(merged.updated, T1);
    assert.deepEqual(merged.$custom, 1);
    // Absent screens key: canonical position (after viewports, before comments).
    const absent = mergeServiceFields({ title: 'X', viewports: [] }, state, { screens: next });
    assert.deepEqual(Object.keys(absent), ['title', 'viewports', 'version', 'kind', 'created', 'brief', 'sessionId', 'projectDirectory', 'preset', 'screens', 'comments']);
    // Without a screens write, the agent's list stays verbatim.
    const untouched = mergeServiceFields(raw, state, { updated: T1 });
    assert.deepEqual(untouched.screens, [{ id: 'a' }]);
  });
});
