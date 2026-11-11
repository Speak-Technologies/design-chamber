// Pure bridge helpers over a fake DOM: selector generation, anchor capture/resolution, links,
// and (Phase 2) the init reader, the storage stand-in over a fake window and the edit probe.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { elementText, normalizeText, openingTag, resolveAnchor, tagOfSnippet } from '../../src/guest/bridge/anchor.ts';
import { editProbeOf } from '../../src/guest/bridge/edit-probe.ts';
import { readInit } from '../../src/guest/bridge/init.ts';
import { classifyGoto, classifyLink } from '../../src/guest/bridge/links.ts';
import { buildSelector, cssString } from '../../src/guest/bridge/selector.ts';
import { installStorage, readStorageInit, splitStorageBatches, type StorageBatch } from '../../src/guest/bridge/storage-shim.ts';
import { parseFrameMessage, type StorageInit } from '../../src/shared/bridge-protocol.ts';
import { ANCHOR_HTML_MAX, ANCHOR_TEXT_MAX, BRIDGE_TAG_MAX, EDIT_PROBE_ID_MAX, PAGE_STATE_CHANGES_MAX, PAGE_STATE_MAX_CHARS, TEXT_EDIT_MAX } from '../../src/shared/limits.ts';
import { fakeDocument, h, type FakeDocument, type FakeElement } from './fake-dom.ts';

const uniqueFor = (doc: FakeDocument, element: FakeElement): string => {
  const selector = buildSelector(element, doc);
  const found = doc.querySelectorAll(selector);
  assert.equal(found.length, 1, `"${selector}" should match exactly one element`);
  assert.equal(found[0], element, `"${selector}" should match the element itself`);
  return selector;
};

// ---- selector.ts ----

test('selector: unique id wins; a duplicated id is not used', () => {
  const title = h('h1', { id: 'hero-title' }, 'Hi');
  const doc = fakeDocument(h('body', {}, h('main', {}, title)));
  assert.equal(uniqueFor(doc, title), '#hero-title');

  const a = h('p', { id: 'dup' }, 'a');
  const b = h('p', { id: 'dup' }, 'b');
  const twice = fakeDocument(h('body', {}, a, b));
  const selector = uniqueFor(twice, b);
  assert.ok(!selector.includes('#dup'), selector);
});

test('selector: data-testid / data-screen / data-dc-id when unique', () => {
  const plan = h('div', { 'data-testid': 'plan-regular', class: 'card' }, 'Regular');
  const doc = fakeDocument(h('body', {}, h('div', { 'data-testid': 'plan-taster', class: 'card' }, 'Taster'), plan));
  assert.equal(uniqueFor(doc, plan), '[data-testid="plan-regular"]');
  const odd = h('div', { 'data-dc-id': 'say "hi"' });
  assert.equal(uniqueFor(fakeDocument(h('body', {}, odd)), odd), '[data-dc-id="say \\"hi\\""]');
  assert.equal(cssString('a\\b"c\nd'), 'a\\\\b\\"c\\a d');
});

test('selector: stable classes kept, state classes dropped, nth-of-type for same-tag siblings', () => {
  const second = h('li', { class: 'item is-active js-toggle active hover-x focus-ring plan' }, 'Two');
  const list = h('ul', { class: 'plans' }, h('li', { class: 'item plan' }, 'One'), second, h('li', { class: 'item plan' }, 'Three'));
  const doc = fakeDocument(h('body', {}, h('main', {}, list)));
  const selector = uniqueFor(doc, second);
  assert.match(selector, /li\.item\.plan:nth-of-type\(2\)$/);
  for (const unstable of ['is-active', 'js-toggle', '.active', 'hover-x', 'focus-ring']) assert.ok(!selector.includes(unstable), `${unstable} in ${selector}`);
});

test('selector: anchors at a unique ancestor id; chain capped at 6 levels', () => {
  const target = h('span', {}, 'deep');
  const doc = fakeDocument(h('body', {}, h('section', {}, h('div', {}, h('span', {}, 'other'))), h('section', { id: 'pricing' }, h('div', {}, target))));
  assert.equal(uniqueFor(doc, target), '#pricing > div > span');

  // Nine identical nested divs: no unique path within 6 levels → best effort, ≤ 6 segments.
  const leaf = h('b', {}, 'leaf');
  let node: FakeElement = leaf;
  for (let i = 0; i < 9; i += 1) node = h('div', {}, node);
  let twin: FakeElement = h('b', {}, 'leaf');
  for (let i = 0; i < 9; i += 1) twin = h('div', {}, twin);
  const deep = fakeDocument(h('body', {}, node, twin));
  const chain = buildSelector(leaf, deep);
  assert.ok(chain.split(' > ').length <= 6, chain);
  assert.equal(buildSelector(h('body'), deep), 'body');
});

test('selector: ids and classes that are not plain identifiers are escaped or skipped', () => {
  const odd = h('div', { id: '1 two', class: 'md:p-4 card' }, 'x');
  const doc = fakeDocument(h('body', {}, odd));
  assert.equal(uniqueFor(doc, odd), '[id="1 two"]');
  const noId = h('p', { class: 'md:p-4 lead' }, 'x');
  const doc2 = fakeDocument(h('body', {}, h('p', {}, 'y'), noId));
  const selector = uniqueFor(doc2, noId);
  assert.ok(!selector.includes('md:p-4') && selector.includes('.lead'), selector);
});

// ---- anchor.ts ----

test('anchor: text is normalised and capped; opening tag escaped and capped', () => {
  const el = h('h1', { class: 'hero-title', title: 'a "quote" & more' }, '  Ship\n   faster  ', h('em', {}, 'today'));
  assert.equal(elementText(el), 'Ship faster today');
  assert.equal(openingTag(el), '<h1 class="hero-title" title="a &quot;quote&quot; &amp; more">');
  assert.equal(elementText(h('p', {}, 'x'.repeat(500))).length, ANCHOR_TEXT_MAX);
  const long = openingTag(h('div', { class: 'c'.repeat(400) }));
  assert.equal(long.length, ANCHOR_HTML_MAX);
  assert.ok(long.endsWith('…>'));
  assert.equal(tagOfSnippet('<H1 class="x">'), 'h1');
  assert.equal(tagOfSnippet('garbage'), null);
  assert.equal(normalizeText(' a \t b '), 'a b');
});

test('anchor: exact when the stored selector still matches an element with the stored tag', () => {
  const h1 = h('h1', { class: 'title' }, 'Ship faster with fewer meetings');
  const doc = fakeDocument(h('body', {}, h('main', {}, h1)));
  const query = { selector: buildSelector(h1, doc), text: elementText(h1), html: openingTag(h1) };
  const match = resolveAnchor(doc, query);
  assert.deepEqual([match.found, match.exact, match.element], [true, true, h1]);
});

test('anchor: after an edit the text fallback re-matches (exact:false); short text detaches', () => {
  const before = h('h2', { class: 'lead' }, 'Fresh roasts, every other Monday');
  const doc = fakeDocument(h('body', {}, h('main', {}, h('section', {}, before))));
  const stored = { selector: buildSelector(before, doc), text: elementText(before), html: openingTag(before) };

  // The agent restructured the page: new wrapper, new class, text extended.
  const after = h('h2', { class: 'headline' }, 'Fresh roasts, every other Monday — now weekly too');
  const edited = fakeDocument(h('body', {}, h('header', {}, h('div', {}, after)), h('main', {})));
  const moved = resolveAnchor(edited, stored);
  assert.deepEqual([moved.found, moved.exact, moved.element], [true, false, after]);

  // Same selector now hits a different tag → not exact; falls back to text.
  const p = h('p', {}, 'unrelated');
  const sameSelector = fakeDocument(h('body', {}, h('main', {}, h('section', {}, p))));
  assert.equal(resolveAnchor(sameSelector, { selector: 'main > section > *', text: 'nothing like it at all', html: '<h2>' }).found, false);

  // Text shorter than 12 chars never re-matches → detached.
  const short = { selector: 'main > h3.gone', text: 'Pricing', html: '<h3>' };
  const docShort = fakeDocument(h('body', {}, h('h3', {}, 'Pricing')));
  assert.deepEqual(resolveAnchor(docShort, short), { found: false, exact: false, element: null });
});

test('anchor: innermost text match wins; invalid stored selectors do not throw', () => {
  const inner = h('div', { class: 'inner' }, 'Twelve chars or more here');
  const outer = h('div', { class: 'outer' }, inner);
  const doc = fakeDocument(h('body', {}, outer));
  const match = resolveAnchor(doc, { selector: 'div::bogus((', text: 'Twelve chars or more', html: '<div>' });
  assert.equal(match.element, inner);
  assert.equal(match.exact, false);
});

// ---- links.ts ----

test('links: fragments, screens, externals and blocked schemes', () => {
  const file = 'screens/home.html';
  assert.deepEqual(classifyLink('#plans', file), { kind: 'fragment', id: 'plans' });
  assert.deepEqual(classifyLink('#', file), { kind: 'fragment', id: '' });
  assert.deepEqual(classifyLink('pricing.html#plans', file), { kind: 'navigate', href: 'screens/pricing.html', hash: '#plans' });
  assert.deepEqual(classifyLink('./pricing.html?x=1', file), { kind: 'navigate', href: 'screens/pricing.html', hash: '' });
  assert.deepEqual(classifyLink('../index.html', file), { kind: 'navigate', href: 'index.html', hash: '' });
  assert.deepEqual(classifyLink('../../../../etc/x.html', file), { kind: 'navigate', href: 'etc/x.html', hash: '' });
  assert.deepEqual(classifyLink('home.html#top', file), { kind: 'fragment', id: 'top' });
  assert.equal(classifyLink('home.html', file).kind, 'blocked');
  assert.deepEqual(classifyLink('https://example.com/a?b=1', file), { kind: 'external', url: 'https://example.com/a?b=1' });
  assert.deepEqual(classifyLink('//example.com/x', file), { kind: 'external', url: 'https://example.com/x' });
  for (const href of ['javascript:alert(1)', 'mailto:a@b.c', 'data:text/html,hi', 'file:///C:/x.html', '', 'assets/logo.png', 'blob:https://x/y']) {
    assert.equal(classifyLink(href, file).kind, 'blocked', href);
  }
  assert.deepEqual(classifyGoto('checkout'), { kind: 'navigate', href: 'screens/checkout.html', hash: '' });
  assert.equal(classifyGoto('../evil').kind, 'blocked');
});

// ---- init.ts: window.__DC as the bridge reads it (Phase 2 §10.4) ----

const BASE_INIT = { artboardId: 'home@laptop', file: 'screens/home.html', mode: 'edit', scroll: { x: 0, y: 0 }, nonce: 'n0nce' };

test('init: tokens and storage pass when well formed; the rest of the init is unchanged', () => {
  const tokens = [{ name: '--accent-h', value: '210' }];
  const storage = { persist: true, items: [['theme', 'dark']] };
  assert.deepEqual(readInit({ ...BASE_INIT, tokens, storage }), { ...BASE_INIT, tokens, storage });
  assert.deepEqual(readInit(BASE_INIT), BASE_INIT);
  assert.equal(readInit({ ...BASE_INIT, nonce: '' }), null);
  assert.equal(readInit({ ...BASE_INIT, mode: 'admin' }), null);
  // Fields the bridge does not know are not carried along.
  assert.deepEqual(readInit({ ...BASE_INIT, extra: 'x' }), BASE_INIT);
});

test('init: malformed tokens mean no preview; malformed storage means empty and unsaved', () => {
  const badTokens: unknown[] = [
    'all',
    [{ name: 'accent', value: '1' }],
    [{ name: '--accent', value: '1; color: red' }],
    [{ name: '--accent', value: '</style>' }],
    [{ name: '--accent', value: "it's" }],
    Array.from({ length: 13 }, (_, i) => ({ name: `--v${i}`, value: '1' })),
  ];
  for (const tokens of badTokens) {
    const init = readInit({ ...BASE_INIT, tokens });
    assert.ok(init, JSON.stringify(tokens));
    assert.equal(init.tokens, undefined, JSON.stringify(tokens));
  }
  const badStorage: unknown[] = [
    'x',
    null,
    { persist: 'yes', items: [] },
    { persist: true },
    { persist: true, items: {} },
    { persist: true, items: [['k']] },
    { persist: true, items: [['k', 'v', 'w']] },
    { persist: true, items: [['k', null]] },
    { persist: true, items: [['k', 1]] },
    { persist: true, items: [[1, 'v']] },
    { persist: true, items: [['k', 'v'.repeat(PAGE_STATE_MAX_CHARS)]] },
  ];
  for (const storage of badStorage) {
    const init = readInit({ ...BASE_INIT, storage });
    assert.ok(init, JSON.stringify(storage)?.slice(0, 80));
    assert.equal(init.storage, undefined, JSON.stringify(storage)?.slice(0, 80));
  }
});

test('storage init: first of a duplicated key wins; exactly the cap fits; more than 10 000 keys seed', () => {
  assert.deepEqual(readStorageInit({ persist: false, items: [['a', '1'], ['a', '2'], ['b', '3']] }), { persist: false, items: [['a', '1'], ['b', '3']] });
  assert.ok(readStorageInit({ persist: true, items: [['k', 'v'.repeat(PAGE_STATE_MAX_CHARS - 1)]] }));
  assert.equal(readStorageInit({ persist: true, items: [['k', 'v'.repeat(PAGE_STATE_MAX_CHARS)]] }), undefined);
  const many = Array.from({ length: 20_000 }, (_, i): [string, string] => [`k${i}`, '1']);
  assert.equal(readStorageInit({ persist: true, items: many })?.items.length, 20_000);
});

// ---- storage-shim.ts over a fake window ----

type FakeStorageWindow = {
  localStorage?: unknown;
  sessionStorage?: unknown;
  queueMicrotask: (task: () => void) => void;
  DOMException: typeof DOMException;
  /** Runs the queued "end of task" callbacks. */
  endTask: () => void;
  posted: StorageBatch[];
};

const fakeWindow = (): FakeStorageWindow => {
  const queue: (() => void)[] = [];
  return {
    queueMicrotask: (task) => queue.push(task),
    DOMException,
    endTask: () => {
      while (queue.length > 0) queue.shift()?.();
    },
    posted: [],
  };
};

/** The installed stand-in, typed as the browser's Storage (it is one in every way a design can see). */
const install = (init: StorageInit | undefined): { win: FakeStorageWindow; local: Storage; session: Storage; shim: ReturnType<typeof installStorage> } => {
  const win = fakeWindow();
  const shim = installStorage(win, init, (batch) => win.posted.push(batch));
  // Safe: installStorage defined both properties as Storage stand-ins just above.
  return { win, local: win.localStorage as Storage, session: win.sessionStorage as Storage, shim };
};

test('storage: defined on the window, configurable, enumerable, not writable', () => {
  const { win } = install(undefined);
  for (const name of ['localStorage', 'sessionStorage']) {
    const descriptor = Object.getOwnPropertyDescriptor(win, name);
    assert.ok(descriptor, name);
    assert.deepEqual([descriptor.configurable, descriptor.enumerable, descriptor.writable], [true, true, false], name);
  }
  assert.equal(Object.prototype.toString.call(win.localStorage), '[object Storage]');
});

test('storage: getItem/setItem/removeItem/clear/length/key behave like the browser for strings', () => {
  const { local } = install({ persist: false, items: [['theme', 'dark'], ['count', '3']] });
  assert.equal(local.length, 2);
  assert.equal(local.getItem('theme'), 'dark');
  assert.equal(local.getItem('missing'), null);
  assert.deepEqual([local.key(0), local.key(1), local.key(2), local.key(-1)], ['theme', 'count', null, null]);
  local.setItem('count', '4');
  assert.deepEqual([local.length, local.key(1), local.getItem('count')], [2, 'count', '4']);
  // Not strings: stored as String() of key and value.
  local.setItem('n', 42 as unknown as string);
  local.setItem(null as unknown as string, undefined as unknown as string);
  assert.equal(local.getItem('n'), '42');
  assert.equal(local.getItem('null'), 'undefined');
  assert.equal(local.key(1.9 as number), 'count');
  local.removeItem('theme');
  local.removeItem('not-there');
  assert.deepEqual([local.length, local.key(0)], [3, 'count']);
  local.clear();
  assert.deepEqual([local.length, local.key(0), local.getItem('count')], [0, null, null]);
  assert.throws(() => (local.setItem as (key: string) => void)('only-key'), TypeError);
  assert.throws(() => (local.getItem as () => string | null)(), TypeError);
  assert.throws(() => local.setItem(Symbol('s') as unknown as string, 'v'), TypeError);
});

test('storage: named properties through the proxy traps; method names are never shadowed', () => {
  const { local } = install({ persist: false, items: [['theme', 'dark']] });
  const named = local as unknown as Record<string, unknown>;
  assert.equal(named.theme, 'dark');
  named.mode = 1;
  assert.equal(local.getItem('mode'), '1');
  assert.ok('theme' in local);
  assert.ok(!('nope' in local));
  assert.ok('getItem' in local && 'length' in local);
  assert.deepEqual(Object.keys(local), ['theme', 'mode']);
  assert.deepEqual(Object.entries(local), [['theme', 'dark'], ['mode', '1']]);
  assert.equal(JSON.stringify(local), '{"theme":"dark","mode":"1"}');
  assert.ok(Object.hasOwn(local, 'theme'));
  assert.equal(delete named.theme, true);
  assert.equal(local.getItem('theme'), null);

  // An item called like a method is stored, readable with getItem, and hides nothing.
  local.setItem('getItem', 'x');
  local.setItem('length', 'y');
  assert.equal(typeof local.getItem, 'function');
  assert.equal(local.length, 3);
  assert.equal(local.getItem('getItem'), 'x');
  assert.ok(!Object.keys(local).includes('getItem'), 'an item hidden by a method is not an own key');
  delete named.getItem;
  assert.equal(local.getItem('getItem'), 'x', 'delete of a method name does not remove the item');
  assert.throws(() => Object.preventExtensions(local), TypeError);
  assert.equal(local.length, 3);
});

test('storage: past the cap the write throws QuotaExceededError and changes nothing', () => {
  const { local, session, win } = install({ persist: true, items: [['big', 'x'.repeat(PAGE_STATE_MAX_CHARS - 13)]] });
  local.setItem('k', '12345678'); // (cap − 10) + 9: the cap − 1
  const over = (): void => local.setItem('k2', 'xy');
  assert.throws(over, (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError');
  assert.equal(local.getItem('k2'), null);
  assert.equal(local.length, 2);
  assert.throws(() => ((local as unknown as Record<string, unknown>).k3 = 'xyz'), (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError');
  // Replacing a value counts the difference only; exactly the cap fits.
  local.setItem('big', 'x'.repeat(PAGE_STATE_MAX_CHARS - 15));
  local.setItem('k2', 'z');
  assert.equal(local.getItem('k2'), 'z');
  win.endTask();
  assert.deepEqual(win.posted.map((batch) => batch.changes.map(([key]) => key)), [['k', 'big', 'k2']]);
  // sessionStorage has its own cap.
  assert.throws(() => session.setItem('s', 'x'.repeat(PAGE_STATE_MAX_CHARS)), (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError');
  session.setItem('s', 'x'.repeat(PAGE_STATE_MAX_CHARS - 1));
});

test('storage: writes leave once per task, last value per key, clear only on the first batch', () => {
  const { local, win } = install({ persist: true, items: [['old', '1']] });
  for (let i = 0; i < 20_000; i += 1) local.setItem('tick', String(i));
  local.setItem('a', '1');
  local.removeItem('old');
  local.setItem('same', 'v');
  local.setItem('same', 'v');
  assert.deepEqual(win.posted, [], 'nothing leaves before the task ends');
  win.endTask();
  assert.deepEqual(win.posted, [{ clear: false, changes: [['tick', '19999'], ['a', '1'], ['old', null], ['same', 'v']] }]);

  // A clear drops what was queued before it in the same task.
  win.posted.length = 0;
  local.setItem('x', '1');
  local.clear();
  local.setItem('y', '2');
  win.endTask();
  assert.deepEqual(win.posted, [{ clear: true, changes: [['y', '2']] }]);

  // No-ops do not post.
  win.posted.length = 0;
  local.setItem('y', '2');
  local.removeItem('never-set');
  win.endTask();
  assert.deepEqual(win.posted, []);
});

test('storage: 20 000 keys in one loop all arrive, split at both caps, clear only on the first', () => {
  const { local, win } = install({ persist: true, items: [['seed', 's']] });
  local.clear();
  for (let i = 0; i < 20_000; i += 1) local.setItem(`k${i}`, '1');
  win.endTask();
  assert.equal(win.posted.length, 2);
  assert.deepEqual(win.posted.map((batch) => [batch.clear, batch.changes.length]), [[true, PAGE_STATE_CHANGES_MAX], [false, 20_000 - PAGE_STATE_CHANGES_MAX]]);
  assert.deepEqual(new Set(win.posted.flatMap((batch) => batch.changes.map(([key]) => key))).size, 20_000);
  for (const batch of win.posted) assert.notEqual(parseFrameMessage({ dc: 1, artboardId: 'a@b', nonce: 'n', type: 'storage-batch', ...batch }), null);

  // Over the character cap in one task: a removal plus a value that fills the cap.
  win.posted.length = 0;
  local.clear();
  win.endTask();
  win.posted.length = 0;
  local.setItem('k1', 'x');
  win.endTask();
  win.posted.length = 0;
  local.removeItem('k1');
  local.setItem('k2', 'x'.repeat(PAGE_STATE_MAX_CHARS - 2));
  win.endTask();
  assert.deepEqual(win.posted.map((batch) => batch.changes.map(([key]) => key)), [['k1'], ['k2']]);
  for (const batch of win.posted) assert.notEqual(parseFrameMessage({ dc: 1, artboardId: 'a@b', nonce: 'n', type: 'storage-batch', ...batch }), null);
});

test('storage: split batches, pure', () => {
  const limits = { changes: 2, chars: 10 };
  assert.deepEqual(splitStorageBatches(false, [], limits), []);
  assert.deepEqual(splitStorageBatches(true, [], limits), [{ clear: true, changes: [] }]);
  assert.deepEqual(
    splitStorageBatches(true, [['a', '1'], ['b', '2'], ['c', '3']], limits),
    [{ clear: true, changes: [['a', '1'], ['b', '2']] }, { clear: false, changes: [['c', '3']] }],
  );
  // 4 + 5 + 1 = 10 is exactly the cap; 4 + 7 = 11 is over it, so the second change starts a batch.
  assert.deepEqual(
    splitStorageBatches(false, [['ab', 'cd'], ['efg', 'hi'], ['j', null]], { changes: 10, chars: 10 }),
    [{ clear: false, changes: [['ab', 'cd'], ['efg', 'hi'], ['j', null]] }],
  );
  assert.deepEqual(
    splitStorageBatches(false, [['ab', 'cd'], ['efg', 'hijk'], ['k', null]], { changes: 10, chars: 10 }),
    [{ clear: false, changes: [['ab', 'cd']] }, { clear: false, changes: [['efg', 'hijk'], ['k', null]] }],
  );
  // Exactly the cap fits in one batch.
  assert.deepEqual(splitStorageBatches(false, [['abcde', 'fghij']], { changes: 1, chars: 10 }).length, 1);
});

test('storage: unsaved without a valid init; sessionStorage never posts; sync never posts back', () => {
  const unsaved = install(undefined);
  unsaved.local.setItem('a', '1');
  unsaved.session.setItem('s', '1');
  unsaved.win.endTask();
  assert.deepEqual(unsaved.win.posted, []);
  assert.equal(unsaved.local.getItem('a'), '1');

  const notPersisted = install({ persist: false, items: [['a', '1']] });
  notPersisted.local.setItem('b', '2');
  notPersisted.win.endTask();
  assert.deepEqual(notPersisted.win.posted, []);

  const live = install({ persist: true, items: [['a', '1'], ['b', '2']] });
  live.session.setItem('s', '1');
  live.shim.sync(false, [['b', null], ['c', '3']]);
  live.win.endTask();
  assert.deepEqual(live.win.posted, []);
  assert.deepEqual([live.local.getItem('b'), live.local.getItem('c'), live.local.length], [null, '3', 2]);
  assert.equal(live.session.getItem('c'), null, 'sync reaches localStorage only');
  live.shim.sync(true, [['d', '4']]);
  assert.deepEqual(Object.keys(live.local), ['d']);
  // The cap counter follows a sync.
  live.shim.sync(true, [['big', 'x'.repeat(PAGE_STATE_MAX_CHARS - 3)]]);
  assert.throws(() => live.local.setItem('z', 'z'), (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError');
  live.shim.sync(false, [['big', null]]);
  live.local.setItem('z', 'z');
  live.win.endTask();
  assert.deepEqual(live.win.posted, [{ clear: false, changes: [['z', 'z']] }]);
});

test('storage: a real microtask ends the batch; a write after it is a new batch', async () => {
  const posted: StorageBatch[] = [];
  const win: { localStorage?: unknown } = {};
  installStorage(win, { persist: true, items: [] }, (batch) => posted.push(batch));
  // Safe: installStorage defined the property just above.
  const local = win.localStorage as Storage;
  local.setItem('a', '1');
  local.setItem('a', '2');
  await Promise.resolve();
  await Promise.resolve();
  local.setItem('b', '3');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(posted, [{ clear: false, changes: [['a', '2']] }, { clear: false, changes: [['b', '3']] }]);
});

// ---- edit-probe.ts ----

test('edit probe: a unique leaf is counted once; same-text leaves are counted in document order', () => {
  const title = h('h1', { class: 'hero' }, '  Ship   faster ');
  const first = h('li', {}, 'Same');
  const second = h('li', {}, 'Same');
  const withId = h('li', { id: 'x' }, 'Same');
  const doc = fakeDocument(h('body', {}, title, h('ul', {}, first, h('li', {}, 'Other'), second, withId, h('li', {}, h('b', {}, 'Same')))));
  assert.deepEqual(editProbeOf(title, doc), { tag: 'h1', id: null, leaf: true, text: 'Ship faster', truncated: false, sameIndex: 0, sameCount: 1 });
  assert.deepEqual(editProbeOf(second, doc), { tag: 'li', id: null, leaf: true, text: 'Same', truncated: false, sameIndex: 1, sameCount: 2 });
  assert.deepEqual(editProbeOf(withId, doc), { tag: 'li', id: 'x', leaf: true, text: 'Same', truncated: false, sameIndex: 0, sameCount: 1 });
});

test('edit probe: not a leaf, foreign content and the overlay are left out of the count', () => {
  const parent = h('p', {}, 'Hello ', h('em', {}, 'world'));
  const inSvg = h('text', {}, 'Label text');
  const plain = h('text', {}, 'Label text');
  const overlayTwin = h('div', { 'data-dc-overlay': '' });
  const empty = h('div', {});
  const doc = fakeDocument(h('body', {}, parent, h('svg', {}, inSvg), h('math', {}, h('text', {}, 'Label text')), h('template', {}, h('text', {}, 'Label text')), plain, overlayTwin, empty));
  assert.deepEqual(editProbeOf(parent, doc), { tag: 'p', id: null, leaf: false, text: 'Hello world', truncated: false, sameIndex: 0, sameCount: 0 });
  assert.deepEqual(editProbeOf(plain, doc), { tag: 'text', id: null, leaf: true, text: 'Label text', truncated: false, sameIndex: 0, sameCount: 1 });
  assert.deepEqual(pickCounts(editProbeOf(inSvg, doc)), { sameIndex: 0, sameCount: 0 });
  assert.deepEqual(pickCounts(editProbeOf(empty, doc)), { sameIndex: 0, sameCount: 1 }, 'the overlay is never a twin');
  assert.equal(editProbeOf(overlayTwin, doc), null);
});

test('edit probe: long text is truncated to TEXT_EDIT_MAX + 1; the scan cap means not counted', () => {
  const long = h('p', {}, 'x'.repeat(TEXT_EDIT_MAX + 50));
  const doc = fakeDocument(h('body', {}, long));
  const probe = editProbeOf(long, doc);
  assert.equal(probe?.text.length, TEXT_EDIT_MAX + 1);
  assert.equal(probe?.truncated, true);
  const exact = h('p', {}, 'y'.repeat(TEXT_EDIT_MAX));
  assert.deepEqual(pickCounts(editProbeOf(exact, fakeDocument(h('body', {}, exact)))), { sameIndex: 0, sameCount: 1 });
  assert.equal(editProbeOf(exact, fakeDocument(h('body', {}, exact)))?.truncated, false);

  const items = Array.from({ length: 6 }, () => h('li', {}, 'Same'));
  const list = fakeDocument(h('body', {}, h('ul', {}, ...items)));
  assert.deepEqual(pickCounts(editProbeOf(items[4] ?? h('li'), list, 6)), { sameIndex: 4, sameCount: 6 });
  assert.deepEqual(pickCounts(editProbeOf(items[4] ?? h('li'), list, 5)), { sameIndex: 0, sameCount: 0 });
});

test('edit probe: an id the answer cannot carry gives no probe, so the source is never matched by the wrong id', () => {
  const longId = h('p', { id: 'i'.repeat(EDIT_PROBE_ID_MAX + 1) }, 'Hi');
  const emptyId = h('p', { id: '' }, 'Hi');
  const okId = h('p', { id: 'i'.repeat(EDIT_PROBE_ID_MAX) }, 'Hi');
  const doc = fakeDocument(h('body', {}, longId, emptyId, okId, h('p', {}, 'Hi')));
  assert.equal(editProbeOf(longId, doc), null);
  assert.equal(editProbeOf(emptyId, doc), null);
  assert.equal(editProbeOf(okId, doc)?.id?.length, EDIT_PROBE_ID_MAX);
  const longTag = h(`x-${'t'.repeat(BRIDGE_TAG_MAX)}`, {}, 'Hi');
  assert.equal(editProbeOf(longTag, fakeDocument(h('body', {}, longTag))), null);
  // The answer always passes the protocol's own validator.
  const answer = { dc: 1, artboardId: 'a@b', nonce: 'n', type: 'edit-probe-result', x: 1, y: 1 };
  for (const element of [okId, h('p', {}, 'x'.repeat(TEXT_EDIT_MAX + 9))]) {
    const probe = editProbeOf(element, fakeDocument(h('body', {}, element)));
    assert.notEqual(parseFrameMessage({ ...answer, probe: probe && { ...probe, dir: 'ltr', rect: { x: 0, y: 0, w: 1, h: 1 } } }), null);
  }
});

const pickCounts = (probe: { sameIndex: number; sameCount: number } | null): { sameIndex: number; sameCount: number } | null =>
  probe && { sameIndex: probe.sameIndex, sameCount: probe.sameCount };
