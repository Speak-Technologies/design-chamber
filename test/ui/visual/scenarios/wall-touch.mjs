// Visual scenario for touch on the wall (documentation/specs/native-extras.md §2.2), on a 390 x 844
// phone with real touch events: one finger pans a canvas, two pinch it (5 % to 400 %) around their
// midpoint, a tap comments in Edit mode while a drag or a pinch never does, a tap on a pin opens its
// thread, Play leaves the design its own touch, and on a page a finger scrolls the design. As in
// canvas-wheel.mjs, a design's scroll is read from the bridge's own `scroll` reports. A mouse is
// unchanged: canvas-wheel.mjs and the page walk in shoot.mjs cover it.

export const run = async ({ PHONE, openPage, check, checkSoon, listReady, thumbsReady, wallReady }) => {
  for (const theme of ['dark', 'light']) {
    const tag = `phone-390-${theme}-wall-touch`;
    const p = await openPage({ ...PHONE, surface: 'panel', theme, label: tag });
    console.log(tag);
    await listReady(p);
    await thumbsReady(p);
    await p.guest(`win.__touchObs = {}; win.addEventListener('message', (e) => { const d = e.data; if (d && d.dc === 1 && d.type === 'scroll' && typeof d.artboardId === 'string') win.__touchObs[d.artboardId] = d.y; }); return true`);
    const scrolled = (id) => p.guest(`return win.__touchObs[${JSON.stringify(id)}] ?? 0`);

    const touch = async (type, points) => {
      await p.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) });
      await p.settle(30);
    };
    const mix = (a, b, t) => a + (b - a) * t;
    const drag = async (from, to, steps = 8) => {
      await touch('touchStart', [from]);
      for (let i = 1; i <= steps; i += 1) await touch('touchMove', [[mix(from[0], to[0], i / steps), mix(from[1], to[1], i / steps)]]);
      await touch('touchEnd', []);
      await p.settle(200);
    };
    /** Two fingers on a horizontal line through `centre`, `d0` apart, ending `d1` apart. */
    const pinch = async ([cx, cy], d0, d1, steps = 8) => {
      const at = (d) => [[cx - d / 2, cy, 0], [cx + d / 2, cy, 1]];
      await touch('touchStart', [at(d0)[0]]);
      await touch('touchStart', at(d0));
      for (let i = 1; i <= steps; i += 1) await touch('touchMove', at(mix(d0, d1, i / steps)));
      await touch('touchEnd', []);
      await p.settle(200);
    };
    const tap = async (x, y) => {
      await touch('touchStart', [[x, y]]);
      await touch('touchEnd', []);
      await p.settle(400);
    };

    const transform = () => p.guest(`const t = doc.querySelector('.dc-wall-world').style.transform; const m = t.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([-\\d.]+)\\)/); return m ? { x: +m[1], y: +m[2], s: +m[3] } : null`);
    const wallBox = () => p.guest(`const r = doc.querySelector('.dc-wall').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
    const frameBox = (id) => p.guest(`const r = [...doc.querySelectorAll('.dc-board')].find((n) => n.dataset.board === ${JSON.stringify(id)})?.querySelector('.dc-frame')?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null`);
    const cardOpen = () => p.guest('return doc.querySelector(".dc-composer") ? "composer" : doc.querySelector(".dc-thread") ? "thread" : null');
    const same = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.s - b.s) < 1e-6;
    const fit = async () => {
      await p.click('.oc-sdk-btn', { text: 'Fit' });
      await p.settle(500);
    };
    /** The visible part of a board's frame, so a touch lands on it and inside the wall. */
    const onBoard = async (id) => {
      const wall = await wallBox();
      const f = await frameBox(id);
      const left = Math.max(f.x, wall.x);
      const top = Math.max(f.y, wall.y);
      const right = Math.min(f.x + f.w, wall.x + wall.w);
      const bottom = Math.min(f.y + f.h, wall.y + wall.h);
      return { x: left, y: top, w: right - left, h: bottom - top };
    };

    await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
    await wallReady(p, 2);
    await p.settle(700);
    const wall = await wallBox();
    const mid = [wall.x + wall.w / 2, wall.y + wall.h / 2];
    const id = await p.guest('return doc.querySelector(".dc-board[data-state=ready]").dataset.board');

    // One finger drags the wall: from a design in Edit mode as from empty wall.
    let b = await onBoard(id);
    let before = await transform();
    const start = [b.x + b.w / 2, b.y + b.h / 2];
    await drag(start, [start[0] + 40, start[1] + 60]);
    let after = await transform();
    check(Math.abs(after.x - before.x - 40) < 1 && Math.abs(after.y - before.y - 60) < 1 && after.s === before.s, `${tag}: one finger pans from a design by the finger's travel (${JSON.stringify({ before, after })})`);
    check((await cardOpen()) === null, `${tag}: a drag does not comment`);
    check((await scrolled(id)) === 0, `${tag}: a drag in Edit does not scroll the design`);

    // Two fingers: zoom around their midpoint.
    before = await transform();
    await pinch(mid, 80, 240);
    after = await transform();
    const factor = after.s / before.s;
    check(Math.abs(factor - 3) < 0.05, `${tag}: spreading two fingers zooms in by their spread (${before.s} -> ${after.s})`);
    const anchor = (t) => ({ x: (mid[0] - wall.x - t.x) / t.s, y: (mid[1] - wall.y - t.y) / t.s });
    check(Math.abs(anchor(after).x - anchor(before).x) * after.s < 2 && Math.abs(anchor(after).y - anchor(before).y) * after.s < 2, `${tag}: the point between the fingers stays put`);
    check((await cardOpen()) === null, `${tag}: a pinch does not comment`);
    await p.shot(`${tag}-1-zoomed-in`);
    for (let i = 0; i < 3; i += 1) await pinch(mid, 30, 330);
    check(Math.abs((await transform()).s - 4) < 1e-6, `${tag}: zoom stops at 400 %`);
    for (let i = 0; i < 4; i += 1) await pinch(mid, 330, 20);
    check(Math.abs((await transform()).s - 0.05) < 1e-6, `${tag}: zoom stops at 5 %`);

    // Lifting one of two fingers leaves the other panning, with no jump and no comment.
    await fit();
    b = await onBoard(id);
    const one = [b.x + b.w / 2 - 30, b.y + b.h / 2, 0];
    const two = [b.x + b.w / 2 + 30, b.y + b.h / 2, 1];
    await touch('touchStart', [one]);
    await touch('touchStart', [one, two]);
    await touch('touchEnd', [two]);
    before = await transform();
    // CDP names the fingers still down; the one left out is lifted.
    await touch('touchMove', [[one[0] + 25, one[1] + 15, 0]]);
    await touch('touchEnd', []);
    await p.settle(400);
    after = await transform();
    check((await cardOpen()) === null, `${tag}: lifting fingers one by one never comments`);
    check(after.s === before.s && Math.abs(after.x - before.x) <= 70 && Math.abs(after.y - before.y) <= 40, `${tag}: the remaining finger pans without a jump (${JSON.stringify({ before, after })})`);

    // A tap comments; a finger's wobble is still a tap. The wall is moved by hand first: an untouched one refits
    // when the selection adds a chip to the ask bar and the wall gets shorter.
    await fit();
    await drag([mid[0], mid[1]], [mid[0] + 20, mid[1]]);
    b = await onBoard(id);
    const spot = [b.x + b.w * 0.25, b.y + b.h * 0.2];
    before = await transform();
    await touch('touchStart', [spot]);
    await touch('touchMove', [[spot[0] + 6, spot[1] + 3]]);
    await touch('touchEnd', []);
    await checkSoon(async () => (await cardOpen()) === 'composer', `${tag}: a tap that wobbles 7 px opens the comment box`);
    check(same(await transform(), before), `${tag}: a tap does not move the wall`);
    await p.shot(`${tag}-2-tap-comment`);
    await p.key('Escape');
    await p.settle(200);

    // A tap on a pin opens its thread, not a new comment.
    await fit();
    const pin = await p.rect('.dc-pin:not(.dc-temp-pin):not(.dc-pin-cluster)');
    check(pin !== null, `${tag}: a pin is on the wall`);
    if (pin) {
      before = await transform();
      await tap(pin.x + pin.w / 2, pin.y + pin.h / 2);
      await checkSoon(async () => (await cardOpen()) === 'thread', `${tag}: a tap on a pin opens its thread`);
      check(same(await transform(), before), `${tag}: a tap on a pin does not move the wall`);
      await p.shot(`${tag}-3-pin-thread`);
      await p.key('Escape');
      await p.settle(200);

      // A swipe that happens to start on a pin still moves the wall, and opens nothing.
      await fit();
      await drag([mid[0], mid[1]], [mid[0] + 20, mid[1]]);
      const from = await p.rect('.dc-pin:not(.dc-temp-pin):not(.dc-pin-cluster)');
      before = await transform();
      await drag([from.x + from.w / 2, from.y + from.h / 2], [from.x + from.w / 2 + 30, from.y + from.h / 2 + 50]);
      after = await transform();
      check(Math.abs(after.x - before.x - 30) < 1 && Math.abs(after.y - before.y - 50) < 1, `${tag}: a swipe from a pin pans the wall (${JSON.stringify({ before, after })})`);
      check((await cardOpen()) === null, `${tag}: a swipe from a pin opens nothing`);
    }

    await p.close();

    // Play: the design takes the finger. A fresh tab, because headless Chrome stops delivering touches into frames in
    // a tab that has had two synthesized fingers (with or without this feature). The mouse wheel zooms in first, so
    // the screen under the finger is loaded and big enough to drag on.
    const playTag = `phone-390-${theme}-play-touch`;
    const r = await openPage({ ...PHONE, surface: 'panel', theme, label: playTag });
    console.log(playTag);
    await listReady(r);
    await thumbsReady(r);
    await r.guest(`win.__touchObs = {}; win.addEventListener('message', (e) => { const d = e.data; if (d && d.dc === 1 && d.type === 'scroll' && typeof d.artboardId === 'string') win.__touchObs[d.artboardId] = d.y; }); return true`);
    await r.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
    await wallReady(r, 2);
    await r.settle(700);
    await r.click('[role=tab]', { text: 'Play' });
    const home = '.dc-board[data-board="home@laptop"]';
    const aim = await r.rect(`${home} .dc-frame, ${home} .dc-placeholder`);
    await r.wheel(aim.x + aim.w / 2, aim.y + aim.h / 2, 0, -200, { ctrl: true });
    await r.waitFor(`return doc.querySelector('${home}').dataset.state === 'ready'`, 'the Home screen to load', 20000);
    await r.settle(900);
    const rTransform = () => r.guest(`return doc.querySelector('.dc-wall-world').style.transform`);
    const rScroll = () => r.guest(`return win.__touchObs['home@laptop'] ?? 0`);
    const f0 = await r.rect(`${home} .dc-frame`);
    const wallRect = await r.rect('.dc-wall');
    const x0 = Math.max(f0.x, wallRect.x) + 40;
    const top = Math.max(f0.y, wallRect.y);
    const bottom = Math.min(f0.y + f0.h, wallRect.y + wallRect.h);
    const rTouch = async (type, points) => {
      await r.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 0 })) });
      await r.settle(30);
    };
    const moved0 = await rTransform();
    const y0 = await rScroll();
    await rTouch('touchStart', [[x0, mix(top, bottom, 0.85)]]);
    for (let i = 1; i <= 8; i += 1) await rTouch('touchMove', [[x0, mix(top, bottom, 0.85 - (0.7 * i) / 8)]]);
    await rTouch('touchEnd', []);
    await checkSoon(async () => (await rScroll()) > y0, `${playTag}: in Play a finger scrolls the design`);
    check((await rTransform()) === moved0, `${playTag}: in Play a finger on a design leaves the wall alone`);
    await r.shot(`${playTag}-1-scrolled`);
    await r.close();

    // A page: the wall never moves; a finger scrolls the design in Edit as in Play.
    const pageTag = `phone-390-${theme}-page-touch`;
    const q = await openPage({ ...PHONE, surface: 'panel', theme, label: pageTag });
    console.log(pageTag);
    await listReady(q);
    await thumbsReady(q);
    await q.guest(`win.__touchObs = {}; win.addEventListener('message', (e) => { const d = e.data; if (d && d.dc === 1 && d.type === 'scroll') win.__touchObs.page = d.y; }); return true`);
    const pageY = () => q.guest('return win.__touchObs.page ?? 0');
    const qTouch = async (type, points) => {
      await q.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, tid = 0]) => ({ x, y, id: tid })) });
      await q.settle(30);
    };
    const qDrag = async (x, from, to) => {
      await qTouch('touchStart', [[x, from]]);
      for (let i = 1; i <= 8; i += 1) await qTouch('touchMove', [[x, mix(from, to, i / 8)]]);
      await qTouch('touchEnd', []);
      await q.settle(500);
    };
    await q.click('.dc-row[data-slug="northwind-pricing"] .dc-row-main');
    await wallReady(q, 1);
    await q.settle(700);
    // The rail opens a page in Play; the Comment button (not the Comments chip next to it) is its Edit mode.
    const commentMode = async () => {
      await q.guest(`[...doc.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Comment').dataset.touchTarget = 'comment'; return true`);
      await q.click('[data-touch-target="comment"]', { wait: 500 });
    };
    await commentMode();
    const f = await q.rect('.dc-board .dc-frame');
    const x = f.x + f.w / 2;
    await qDrag(x, f.y + f.h * 0.7, f.y + f.h * 0.4);
    const edit = await pageY();
    check(edit > 0, `${pageTag}: in Edit a finger drag scrolls the page (scrollY ${edit})`);
    check(!(await q.guest('return !!doc.querySelector(".dc-composer")')), `${pageTag}: that drag does not comment`);
    await qDrag(x, f.y + f.h * 0.4, f.y + f.h * 0.7);
    check((await pageY()) < edit, `${pageTag}: dragging down scrolls back up (scrollY ${edit} -> ${await pageY()})`);
    await qTouch('touchStart', [[x, f.y + f.h * 0.15]]);
    await qTouch('touchEnd', []);
    await checkSoon(() => q.guest('return !!doc.querySelector(".dc-composer")'), `${pageTag}: a tap on a page opens the comment box`);
    await q.shot(`${pageTag}-1-tap-comment`);
    await q.key('Escape');
    await commentMode();
    const play0 = await pageY();
    const g = await q.rect('.dc-board .dc-frame');
    await qDrag(x, g.y + g.h * 0.7, g.y + g.h * 0.3);
    check((await pageY()) > play0, `${pageTag}: in Play a finger scrolls the page (scrollY ${play0} -> ${await pageY()})`);
    // Two fingers on a page in Edit: no zoom, no scroll, no comment. Last, because of the synthesized two-finger limit above.
    await commentMode();
    const held = await pageY();
    const box = () => q.guest('return doc.querySelector(".dc-wall-world").style.transform');
    const box0 = await box();
    const h = await q.rect('.dc-board .dc-frame');
    const fingers = (d) => [[x - d / 2, h.y + h.h * 0.4, 0], [x + d / 2, h.y + h.h * 0.4, 1]];
    await qTouch('touchStart', [fingers(60)[0]]);
    await qTouch('touchStart', fingers(60));
    for (let i = 1; i <= 8; i += 1) await qTouch('touchMove', fingers(mix(60, 240, i / 8)));
    await qTouch('touchEnd', []);
    await q.settle(500);
    check((await box()) === box0 && (await pageY()) === held, `${pageTag}: two fingers neither zoom nor scroll a page`);
    check(!(await q.guest('return !!doc.querySelector(".dc-composer")')), `${pageTag}: two fingers do not comment`);
    await q.close();
  }
};
