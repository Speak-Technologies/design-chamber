import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PAGE_FILL_VIEWPORT_ID } from '../../src/shared/limits.ts';
import type { Comment, Viewport } from '../../src/shared/types.ts';
import { PAGE_GUTTER, PAGE_GUTTER_COMPACT, pageCamera, pageComments, pageViewOptions, remoteBannerHidden, remoteNotice, resolvePageView, shortUrl } from '../../src/ui/model/wall-model.ts';

const LAPTOP: Viewport = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE: Viewport = { id: 'phone', label: 'Phone', width: 390, height: 844 };

const comment = (id: string, screen: string | null, viewport: string): Comment => ({
  id,
  screen,
  viewport,
  anchor: { selector: 'main', text: '', html: '<main>', rect: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 0.5, y: 0.5 } },
  body: 'Change this',
  status: 'open',
  created: '2026-11-01T00:00:00.000Z',
  sentAt: null,
  sentVersion: null,
});

test('pageCamera: Full width is scale 1 and the frame is the whole stage', () => {
  const { camera, frameW, frameH } = pageCamera({ stageW: 1100, stageH: 760, frameW: null, gutter: PAGE_GUTTER });
  assert.deepEqual(camera, { x: 0, y: 0, scale: 1 });
  assert.equal(frameW, 1100);
  assert.equal(frameH, 760);
});

test('pageCamera: a 1280 viewport in a 900 px stage shrinks to fit between the gutters', () => {
  const { camera, frameW, frameH } = pageCamera({ stageW: 900, stageH: 700, frameW: 1280, gutter: 24 });
  const scale = (900 - 48) / 1280;
  assert.equal(camera.scale, scale);
  assert.equal(frameW, 1280);
  // Centred: the gutter on both sides.
  assert.ok(Math.abs(camera.x - 24) < 1e-9);
  assert.equal(camera.y, 24);
  // The frame runs from the gutter to the stage's bottom edge, in frame px.
  assert.equal(frameH, Math.round((700 - 24) / scale));
  assert.ok(Math.abs(camera.y + frameH * scale - 700) <= scale);
});

test('pageCamera: a viewport narrower than the stage is never enlarged and sits centred', () => {
  const { camera, frameH } = pageCamera({ stageW: 1400, stageH: 800, frameW: 390, gutter: PAGE_GUTTER });
  assert.equal(camera.scale, 1);
  assert.equal(camera.x, (1400 - 390) / 2);
  assert.equal(camera.y, PAGE_GUTTER);
  assert.equal(frameH, 800 - PAGE_GUTTER);
});

test('pageCamera: the rail gutter is smaller and a tiny stage still gives a positive frame', () => {
  const rail = pageCamera({ stageW: 320, stageH: 500, frameW: 1280, gutter: PAGE_GUTTER_COMPACT });
  assert.equal(rail.camera.scale, (320 - 32) / 1280);
  const tiny = pageCamera({ stageW: 10, stageH: 10, frameW: 1280, gutter: PAGE_GUTTER });
  assert.ok(tiny.camera.scale > 0);
  assert.ok(tiny.frameH >= 1);
});

test('pageComments: every page comment shows in every view, canvas-screen comments never do', () => {
  const all = [comment('a', null, PAGE_FILL_VIEWPORT_ID), comment('b', null, 'laptop'), comment('c', null, 'phone'), comment('d', 'home', 'laptop')];
  assert.deepEqual(
    pageComments(all).map((entry) => entry.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(pageComments([]), []);
});

test('resolvePageView: Full width by default, a stored viewport while it exists', () => {
  assert.equal(resolvePageView(undefined, [LAPTOP, PHONE]), PAGE_FILL_VIEWPORT_ID);
  assert.equal(resolvePageView('phone', [LAPTOP, PHONE]), 'phone');
  assert.equal(resolvePageView(PAGE_FILL_VIEWPORT_ID, [LAPTOP]), PAGE_FILL_VIEWPORT_ID);
  assert.equal(resolvePageView('tablet', [LAPTOP, PHONE]), PAGE_FILL_VIEWPORT_ID, 'a removed viewport falls back');
  assert.equal(resolvePageView(42, [LAPTOP]), PAGE_FILL_VIEWPORT_ID);
});

test('pageViewOptions: Full width first, then each viewport with its size', () => {
  assert.deepEqual(pageViewOptions([LAPTOP, PHONE]), [
    { id: PAGE_FILL_VIEWPORT_ID, label: 'Full width' },
    { id: 'laptop', label: 'Laptop · 1280×800' },
    { id: 'phone', label: 'Phone · 390×844' },
  ]);
});

test('remoteNotice: up to five URLs and a count of the rest', () => {
  const urls = Array.from({ length: 8 }, (_, index) => `https://cdn.example.com/lib-${index}.js`);
  const many = remoteNotice(urls, 'page');
  assert.equal(many.title, 'This page loads 8 files from the internet');
  assert.equal(many.urls.length, 5);
  assert.equal(many.more, 3);
  const one = remoteNotice(['https://fonts.googleapis.com/css2?family=Inter'], 'canvas');
  assert.equal(one.title, 'This design loads 1 file from the internet');
  assert.equal(one.more, 0);
  assert.ok(!`${many.title}${one.title}`.includes('—'));
});

test('remoteBannerHidden: stays hidden for the URLs the user saw, shows again for a new one', () => {
  const fonts = 'https://fonts.googleapis.com/css2?family=Inter';
  const tailwind = 'https://cdn.tailwindcss.com';
  const chart = 'https://cdn.example.com/chart.js';
  assert.equal(remoteBannerHidden([fonts], null), false, 'never hidden: shows');
  assert.equal(remoteBannerHidden([fonts, tailwind], [fonts, tailwind]), true, 'same list: hidden');
  assert.equal(remoteBannerHidden([tailwind, fonts], [fonts, tailwind]), true, 'order does not matter');
  assert.equal(remoteBannerHidden([fonts], [fonts, tailwind]), true, 'one fixed: still hidden');
  assert.equal(remoteBannerHidden([fonts, chart], [fonts, tailwind]), false, 'a new URL: shows again');
  assert.equal(remoteBannerHidden([chart], [fonts]), false, 'a different list: shows again');
});

test('shortUrl: host and path, cut in the middle when long', () => {
  assert.equal(shortUrl('https://fonts.googleapis.com/css2?family=Inter'), 'fonts.googleapis.com/css2');
  assert.equal(shortUrl('https://cdn.tailwindcss.com'), 'cdn.tailwindcss.com');
  const long = shortUrl(`https://cdn.example.com/${'a'.repeat(80)}/end.js`, 40);
  assert.equal(long.length, 40);
  assert.ok(long.startsWith('cdn.example.com/'));
  assert.ok(long.endsWith('end.js'));
  assert.ok(long.includes('…'));
  assert.equal(shortUrl('not a url'), 'not a url');
});
