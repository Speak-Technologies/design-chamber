// Visual scenario for the comment card's place on the wall (rail 320 px, a 390 px phone, the 1400 px
// page; dark and light): the selection toolbar never covers the card or its buttons, also on a
// second pick when the ask bar's chip has made the wall shorter; a card with text in it follows its
// element as the wall moves and waits at the nearest edge when the element is out of view; Cancel
// and Add comment are pressed where they are on screen. The placement itself is table-tested in
// test/ui/card-place-model.test.ts.

const BUTTON = (label) => `[...doc.querySelectorAll('.dc-composer button')].find((n) => n.textContent.trim() === ${JSON.stringify(label)})`;

export const run = async ({ PHONE, openPage, check, checkSoon, listReady, thumbsReady, wallReady }) => {
  for (const theme of ['dark', 'light']) {
    for (const size of [
      { name: 'rail-320', width: 320, height: 780, surface: 'panel' },
      { name: 'phone-390', ...PHONE, surface: 'panel', touch: true },
      { name: 'page-1400', width: 1400, height: 900, surface: 'page' },
    ]) {
      const tag = `${size.name}-${theme}-card-follow`;
      const p = await openPage({ ...size, theme, label: tag });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.click(size.surface === 'page' ? '.dc-card[data-slug="coffee-subscription"] .dc-card-main' : '.dc-row[data-slug="coffee-subscription"] .dc-row-main');
      await wallReady(p, 2);
      await p.settle(900);

      const box = (code) => p.guest(`const n = ${code}; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
      const wallBox = () => box(`doc.querySelector('.dc-wall')`);
      const card = () => box(`doc.querySelector('.dc-composer')`);
      const toolbar = () => p.guest(`const t = doc.querySelector('.dc-seltoolbar'); if (!t || getComputedStyle(t).visibility === 'hidden') return null; const r = t.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
      const plus = () => box(`doc.querySelector('.dc-temp-pin')`);
      const home = () => box(`doc.querySelector('.dc-board[data-board="home@laptop"] .dc-frame')`);
      const apart = (a, b) => a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1 || a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1;
      const onWall = (a, w) => a.x >= w.x - 1 && a.y >= w.y - 1 && a.x + a.w <= w.x + w.w + 1 && a.y + a.h <= w.y + w.h + 1;
      /** Whether a press in the middle of the card's button would land on that button. */
      /** The card and its toolbar as the one block they travel as: what touches an edge of the wall. */
      const pair = async () => {
        const [c, t] = [await card(), await toolbar()];
        if (t === null) return c;
        const [x, y] = [Math.min(c.x, t.x), Math.min(c.y, t.y)];
        return { x, y, w: Math.max(c.x + c.w, t.x + t.w) - x, h: Math.max(c.y + c.h, t.y + t.h) - y };
      };
      const reachable = (label) => p.guest(`const b = ${BUTTON(label)}; const r = b.getBoundingClientRect(); const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b === hit || b.contains(hit)`);

      // Home is paused in a narrow wall until it is near the middle.
      const bring = async () => {
        if (size.surface === 'page') return;
        const w = await wallBox();
        const h = await box(`doc.querySelector('.dc-board[data-board="home@laptop"]')`);
        await p.wheel(h.x + h.w / 2, h.y + h.h / 2, 0, h.y + h.h / 2 - (w.y + w.h / 2));
        await p.waitFor(`return doc.querySelector('.dc-board[data-board="home@laptop"]')?.dataset.state === 'ready'`, 'Home to load', 20000);
        await p.settle(500);
      };
      const pick = async () => {
        const h = await home();
        await p.clickAt(h.x + h.w * 0.2, h.y + h.h * 0.22);
        await p.waitFor('return !!doc.querySelector(".dc-composer") && !!doc.querySelector(".dc-seltoolbar")', 'the card and the toolbar');
        await p.settle(900);
      };
      const clear = async (when) => {
        const [c, t, w] = [await card(), await toolbar(), await wallBox()];
        check(onWall(c, w), `${tag}: ${when}, the card is on the wall (${JSON.stringify({ c, w })})`);
        check(t === null || (apart(t, c) && onWall(t, w)), `${tag}: ${when}, the toolbar does not cover the card (${JSON.stringify({ t, c })})`);
        check((await reachable('Cancel')) && (await reachable('Add comment')), `${tag}: ${when}, Cancel and Add comment can be pressed`);
      };

      await bring();
      await pick();
      await clear('on the first pick');
      await p.shot(`${tag}-1-first-pick`);
      await p.click('.dc-composer .oc-sdk-btn', { text: 'Cancel' });
      await checkSoon(() => p.guest('return !doc.querySelector(".dc-composer")'), `${tag}: Cancel closes the card`);

      // Second pick: the ask bar already holds the chip, so the wall is shorter. This is where the toolbar covered the buttons.
      await pick();
      await clear('on a second pick');
      check((await toolbar()) !== null, `${tag}: there is room for the toolbar too`);
      await p.shot(`${tag}-2-second-pick`);

      // With words in it, the card follows its element.
      await p.type('.dc-composer textarea', 'Keep me with the headline');
      await p.settle(300);
      const move = async (dx, dy) => {
        const w = await wallBox();
        // The strip along the top of the wall is clear of boards' controls; the wheel pans from anywhere on it.
        await p.wheel(w.x + w.w - 6, w.y + 6, -dx, -dy);
        await p.settle(400);
      };
      // A sideways step keeps the element's height on the wall, so the card's side of it stays the same: it must shift by
      // exactly the same amount unless it is already against a side edge.
      const [w1, c0, a0, p0, bar0] = [await wallBox(), await card(), await plus(), await pair(), await toolbar()];
      const step = p0.x + p0.w + 24 < w1.x + w1.w - 8 ? 24 : p0.x - 24 > w1.x + 8 ? -24 : 0;
      await move(step, -12);
      const [c1, a1, p1, bar1] = [await card(), await plus(), await pair(), await toolbar()];
      check(Math.abs(a1.x - a0.x - step) < 1.5 && Math.abs(a1.y - a0.y + 12) < 1.5, `${tag}: the wall moved the element (${JSON.stringify({ a0, a1, step })})`);
      check(bar0 !== null && bar1 !== null && apart(bar1, c1), `${tag}: the toolbar stays with a half-written card, clear of it`);
      const againstSide = Math.abs(p1.x - (w1.x + 8)) < 2 || Math.abs(p1.x + p1.w - (w1.x + w1.w - 8)) < 2;
      const againstTopOrFoot = Math.abs(p1.y - (w1.y + 8)) < 2 || Math.abs(p1.y + p1.h - (w1.y + w1.h - 8)) < 2;
      check(Math.abs(c1.x - c0.x - (a1.x - a0.x)) < 1.5 || againstSide, `${tag}: the card moved across with it (${JSON.stringify({ c0, c1 })})`);
      check(Math.abs(c1.y - c0.y - (a1.y - a0.y)) < 1.5 || againstTopOrFoot, `${tag}: the card moved down or up with it, or waits at an edge (${JSON.stringify({ c0, c1, p1 })})`);
      check(onWall(p1, w1), `${tag}: and stays on the wall`);

      for (const [side, dx, dy] of [
        ['the top', 0, -3000],
        ['the bottom', 0, 6000],
        ['the left', -6000, -3000],
        ['the right', 12000, 0],
      ]) {
        await move(dx, dy);
        const [c, w, a] = [await pair(), await wallBox(), await plus()];
        const gone = side === 'the top' ? a.y + a.h < w.y : side === 'the bottom' ? a.y > w.y + w.h : side === 'the left' ? a.x + a.w < w.x : a.x > w.x + w.w;
        const atEdge =
          side === 'the top' ? Math.abs(c.y - (w.y + 8)) < 2 : side === 'the bottom' ? Math.abs(c.y + c.h - (w.y + w.h - 8)) < 2 : side === 'the left' ? Math.abs(c.x - (w.x + 8)) < 2 : Math.abs(c.x + c.w - (w.x + w.w - 8)) < 2;
        check(gone && atEdge && onWall(c, w), `${tag}: with the element off ${side} the card waits at that edge (${JSON.stringify({ gone, c, w, a })})`);
        await clear(`with the element off ${side}`);
        if (side === 'the right') await p.shot(`${tag}-3-element-off-right`);
      }
      check((await p.guest('return doc.querySelector(".dc-composer textarea").value')) === 'Keep me with the headline', `${tag}: the words are still there`);

      if (size.touch) {
        const touch = async (type, points) => {
          await p.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 0 })) });
          await p.settle(30);
        };
        await p.click('.oc-sdk-btn', { text: 'Fit', wait: 500 });
        const [w, before, from] = [await wallBox(), await card(), await plus()];
        check((await toolbar()) !== null, `${tag}: the toolbar is there before the swipe`);
        const grip = [w.x + 20, w.y + 8];
        await touch('touchStart', [grip]);
        for (let i = 1; i <= 6; i += 1) await touch('touchMove', [[grip[0] + i * 10, grip[1]]]);
        await touch('touchEnd', []);
        await p.settle(400);
        const [after, to] = [await card(), await plus()];
        check((await toolbar()) !== null, `${tag}: and after it`);
        check(to.x > from.x && (after.x > before.x || Math.abs(after.x + after.w - (w.x + w.w - 8)) < 2), `${tag}: a finger swipe takes the card with the element (${JSON.stringify({ before, after, from, to })})`);
      }

      // Back in view, Cancel pressed where it is.
      await p.click('.oc-sdk-btn', { text: 'Fit', wait: 700 });
      await clear('after Fit');
      await p.click('.dc-composer .oc-sdk-btn', { text: 'Cancel' });
      await checkSoon(() => p.guest('return !doc.querySelector(".dc-composer")'), `${tag}: Cancel closes it`);

      // A pin's thread follows too.
      await p.click('.dc-pin:not(.dc-temp-pin):not(.dc-pin-cluster)');
      await p.waitFor('return !!doc.querySelector(".dc-thread")', 'the thread');
      await p.type('.dc-thread textarea', 'Edited and still open');
      await p.settle(300);
      await move(-12000, 0);
      const [t1, w2] = [await box(`doc.querySelector('.dc-thread')`), await wallBox()];
      check(Math.abs(t1.x - (w2.x + 8)) < 2 && onWall(t1, w2), `${tag}: a thread waits at the edge its pin left by (${JSON.stringify({ t1, w2 })})`);
      await p.close();
    }
  }
};
