import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LooseHtmlFile } from '../../src/shared/types.ts';
import { importOutcome, isDismissed, looseBanner, looseKey, parseDismissed, unlistedNote } from '../../src/ui/model/loose-model.ts';

const file = (name: string, bytes = 1200): LooseHtmlFile => ({ name, bytes, mtime: '2026-11-01T09:00:00.000Z' });

test('one loose file gets a direct import offer naming the file and where the original goes', () => {
  const banner = looseBanner({ files: [file('pricing-v2.html')], total: 1 }, null);
  assert.ok(banner && banner.mode === 'single');
  assert.equal(banner.title, '1 HTML file here isn’t a design yet.');
  assert.equal(banner.name, 'pricing-v2.html');
  assert.match(banner.body, /Import it as a page\? The original moves to \.trash in your designs folder\./);
});

test('several loose files list the first three names and how many more', () => {
  const files = ['a.html', 'b.html', 'c.html', 'd.html', 'e.htm'].map((name) => file(name));
  const banner = looseBanner({ files, total: 5 }, null);
  assert.ok(banner && banner.mode === 'many');
  assert.equal(banner.title, '5 HTML files here aren’t designs yet.');
  assert.equal(banner.body, 'a.html, b.html, c.html + 2 more');
  const two = looseBanner({ files: [file('x.html'), file('y.html')], total: 2 }, null);
  assert.equal(two?.body, 'x.html, y.html');
  // The service counted more files than it named (stat cap): the count still drives the copy.
  const capped = looseBanner({ files: [file('x.html')], total: 250 }, null);
  assert.equal(capped?.title, '250 HTML files here aren’t designs yet.');
  assert.equal(capped?.body, 'x.html + 249 more');
});

test('no files, or no list yet, means no banner', () => {
  assert.equal(looseBanner({ files: [], total: 0 }, null), null);
  assert.equal(looseBanner(null, null), null);
  assert.equal(looseBanner(undefined, []), null);
});

test('"Not now" hides exactly the dismissed set; any change brings the banner back', () => {
  const files = [file('b.html'), file('a.html')];
  const dismissed = looseKey(files);
  assert.deepEqual(dismissed, ['a.html', 'b.html'], 'stored sorted');
  assert.equal(looseBanner({ files, total: 2 }, dismissed), null);
  assert.equal(isDismissed([file('a.html'), file('b.html')], dismissed), true, 'order does not matter');
  assert.notEqual(looseBanner({ files: [...files, file('c.html')], total: 3 }, dismissed), null, 'a new file shows it again');
  assert.notEqual(looseBanner({ files: [file('a.html')], total: 1 }, dismissed), null, 'a removed file shows it again');
  assert.equal(isDismissed(files, null), false);
});

test('parseDismissed accepts only a list of strings from shared storage', () => {
  assert.deepEqual(parseDismissed(['b.html', 'a.html']), ['a.html', 'b.html']);
  assert.equal(parseDismissed(undefined), null);
  assert.equal(parseDismissed('a.html'), null);
  assert.equal(parseDismissed(['a.html', 3]), null);
  assert.deepEqual(parseDismissed([]), []);
});

test('importOutcome: success names the page; a failed move to .trash says the original stayed', () => {
  assert.deepEqual(importOutcome({ slug: 'pricing-v2', title: 'Pricing v2', originalMovedTo: 'C:\\D\\.trash\\pricing-v2-20261101090000.html' }), {
    kind: 'success',
    message: 'Imported “Pricing v2” as a page.',
  });
  const kept = importOutcome({ slug: 'pricing-v2', title: 'Pricing v2', originalMovedTo: null });
  assert.equal(kept.kind, 'info');
  assert.equal(kept.message, 'Imported. The original couldn’t be moved to .trash, so it’s still in your designs folder.');
});

test('unlistedNote only appears when the service counted more files than it listed', () => {
  assert.equal(unlistedNote({ files: [file('a.html')], total: 1 }), null);
  assert.match(unlistedNote({ files: [file('a.html')], total: 2 }) ?? '', /^1 more file isn’t listed/);
  assert.match(unlistedNote({ files: [file('a.html')], total: 30 }) ?? '', /^29 more files aren’t listed/);
});

test('banner copy has no em dashes', () => {
  const texts = [looseBanner({ files: [file('a.html')], total: 1 }, null), looseBanner({ files: [file('a.html'), file('b.html')], total: 2 }, null)].flatMap((b) => (b ? [b.title, b.body] : []));
  for (const text of texts) assert.doesNotMatch(text, /\u2014/, text);
});
