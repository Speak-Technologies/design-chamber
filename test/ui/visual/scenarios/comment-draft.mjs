// Visual scenario: words typed into a comment card are not lost to moving the wall. An empty card
// still closes on a pan or zoom; one with text stays through wheel pan, Ctrl+wheel (pinch on a
// trackpad), a mouse drag, Fit, a finger swipe, a pinch and a page scroll; a card closed anyway
// (Esc, another element, another pin) shows the text again; Cancel throws it away. The rules for
// what is kept are table-tested in test/ui/comment-drafts.test.ts.

export const run = async ({ PHONE, openPage, check, checkSoon, listReady, thumbsReady, wallReady }) => {
  const transformOf = (p) => p.guest(`return doc.querySelector('.dc-wall-world').style.transform`);
  const typed = (p, card = '.dc-composer') => p.guest(`return doc.querySelector('${card} textarea')?.value ?? null`);
  const home = (p) => p.rect('.dc-board[data-board="home@laptop"] .dc-frame');

  {
    const tag = 'page-1400-dark-comment-draft';
    const p = await openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: tag });
    console.log(tag);
    await listReady(p);
    await thumbsReady(p);
    await p.click('.dc-card[data-slug="coffee-subscription"] .dc-card-main');
    await wallReady(p, 6);
    await p.settle(900);
    const fit = async () => {
      await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
      await p.settle(500);
    };
    const open = async (fx = 0.2, fy = 0.22) => {
      const b = await home(p);
      await p.clickAt(b.x + b.w * fx, b.y + b.h * fy);
      await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment composer');
      await p.settle(200);
    };
    const gone = () => checkSoon(() => p.guest('return !doc.querySelector(".dc-composer")'), `${tag}: the card closed`);
    const wall = await p.rect('.dc-wall');
    // The top corner: the wall gets shorter from below when the ask bar takes the element's chip.
    const corner = [wall.x + wall.w - 20, wall.y + 20];
    const mouseDrag = async ([x, y], dx, dy) => {
      const send = (type, mx, my) => p.send('Input.dispatchMouseEvent', { type, x: mx, y: my, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
      await send('mousePressed', x, y);
      for (let i = 1; i <= 6; i += 1) await send('mouseMoved', x + (dx * i) / 6, y + (dy * i) / 6);
      await send('mouseReleased', x + dx, y + dy);
      await p.settle(250);
    };

    await fit();
    await open();
    await p.wheel(corner[0], corner[1], 0, 80);
    await gone();

    await fit();
    await open();
    await p.type('.dc-composer textarea', 'Make the headline shorter');
    const moves = [
      ['a wheel pan', () => p.wheel(corner[0], corner[1], 40, 90)],
      ['Ctrl+wheel zoom', () => p.wheel(corner[0], corner[1], 0, -80, { ctrl: true })],
      ['a mouse drag', () => mouseDrag(corner, -70, 50)],
      ['Fit', fit],
    ];
    for (const [what, move] of moves) {
      const before = await transformOf(p);
      await move();
      await p.settle(200);
      check((await transformOf(p)) !== before || what === 'Fit', `${tag}: ${what} moved the wall`);
      check((await typed(p)) === 'Make the headline shorter', `${tag}: ${what} keeps the card and its text`);
    }
    await p.shot(`${tag}-1-kept-while-moving`);

    // Esc closes the card; the same element shows the words again.
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await gone();
    await fit();
    await open();
    check((await typed(p)) === 'Make the headline shorter', `${tag}: after Esc the same element has the text again`);

    // Another element gets its own empty card; going back finds the text.
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await gone();
    await open(0.2, 0.9);
    check((await typed(p)) === '', `${tag}: another element starts empty`);
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await gone();
    await open();
    check((await typed(p)) === 'Make the headline shorter', `${tag}: the first element still has its text`);

    // Cancel is the user throwing it away.
    await p.click('.dc-composer .oc-sdk-btn', { text: 'Cancel' });
    await gone();
    await open();
    check((await typed(p)) === '', `${tag}: after Cancel the card is empty`);
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await gone();

    // A pin's thread: an unsaved edit stays through a pan and comes back after closing.
    await fit();
    const pinSelector = '.dc-board[data-board="home@laptop"] .dc-pin:not(.dc-temp-pin):not(.dc-pin-cluster)';
    await p.click(pinSelector);
    await p.waitFor('return !!doc.querySelector(".dc-thread")', 'the thread');
    const saved = await typed(p, '.dc-thread');
    await p.type('.dc-thread textarea', 'Rewritten but not saved');
    await p.wheel(corner[0], corner[1], 0, 60);
    check((await typed(p, '.dc-thread')) === 'Rewritten but not saved', `${tag}: a pan keeps an edited thread`);
    await p.click('.dc-thread [aria-label="Close comment"]');
    await fit();
    await p.click(pinSelector);
    await p.waitFor('return !!doc.querySelector(".dc-thread")', 'the thread again');
    check((await typed(p, '.dc-thread')) === 'Rewritten but not saved' && saved !== 'Rewritten but not saved', `${tag}: reopening the pin shows the unsaved edit`);
    check(await p.guest('const s = [...doc.querySelectorAll(".dc-thread button")].find((n) => n.textContent.trim() === "Save"); return !!s && !s.disabled'), `${tag}: Save is ready for it`);
    await p.shot(`${tag}-2-thread-draft`);
    await p.close();
  }

  const touchOn = (p) => async (type, points) => {
    await p.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) });
    await p.settle(30);
  };

  {
    const tag = 'phone-390-dark-comment-draft';
    const p = await openPage({ ...PHONE, surface: 'panel', theme: 'dark', label: tag });
    console.log(tag);
    await listReady(p);
    await thumbsReady(p);
    const touch = touchOn(p);
    await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
    await wallReady(p, 2);
    await p.settle(900);
    const wall = await p.rect('.dc-wall');
    // The strip above the first row is wall, clear of the card.
    const grip = [wall.x + 30, wall.y + 12];
    const board = await p.rect('.dc-board[data-state="ready"] .dc-frame');
    await touch('touchStart', [[board.x + board.w * 0.3, board.y + board.h * 0.2]]);
    await touch('touchEnd', []);
    await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment composer');
    await p.type('.dc-composer textarea', 'Typed with a thumb');
    await p.settle(300);

    let before = await transformOf(p);
    await touch('touchStart', [grip]);
    for (let i = 1; i <= 6; i += 1) await touch('touchMove', [[grip[0] + i * 12, grip[1]]]);
    await touch('touchEnd', []);
    await p.settle(250);
    check((await transformOf(p)) !== before && (await typed(p)) === 'Typed with a thumb', `${tag}: a finger swipe moves the wall and keeps the card`);

    before = await transformOf(p);
    const two = (d) => [[200 - d / 2, grip[1], 0], [200 + d / 2, grip[1], 1]];
    await touch('touchStart', [two(60)[0]]);
    await touch('touchStart', two(60));
    for (let i = 1; i <= 6; i += 1) await touch('touchMove', two(60 + i * 20));
    await touch('touchEnd', []);
    await p.settle(250);
    check((await transformOf(p)) !== before && (await typed(p)) === 'Typed with a thumb', `${tag}: a pinch zooms the wall and keeps the card`);
    await p.shot(`${tag}-1-kept-after-pinch`);
    await p.close();
  }

  {
    const tag = 'phone-390-light-page-comment-draft';
    const p = await openPage({ ...PHONE, surface: 'panel', theme: 'light', label: tag });
    console.log(tag);
    await listReady(p);
    await thumbsReady(p);
    const touch = touchOn(p);
    await p.click('.dc-row[data-slug="northwind-pricing"] .dc-row-main');
    await wallReady(p, 1);
    await p.settle(700);
    await p.guest(`[...doc.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Comment').dataset.draftTarget = 'comment'; return true`);
    await p.click('[data-draft-target="comment"]', { wait: 500 });
    const f = await p.rect('.dc-board .dc-frame');
    await touch('touchStart', [[f.x + 60, f.y + f.h * 0.12]]);
    await touch('touchEnd', []);
    await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment composer');
    await p.type('.dc-composer textarea', 'Page comment in progress');
    await p.settle(300);
    // Scroll the design with a finger on a part of the page the card does not cover.
    const card = await p.rect('.dc-composer');
    const frame = await p.rect('.dc-board .dc-frame');
    const below = card.y + card.h + 12;
    const from = below < frame.y + frame.h - 20 ? frame.y + frame.h - 10 : card.y - 12;
    await p.guest(`win.__draftScroll = 0; win.addEventListener('message', (e) => { const d = e.data; if (d && d.dc === 1 && d.type === 'scroll') win.__draftScroll = d.y; }); return true`);
    await touch('touchStart', [[frame.x + 30, from]]);
    for (let i = 1; i <= 8; i += 1) await touch('touchMove', [[frame.x + 30, from - i * 12]]);
    await touch('touchEnd', []);
    await p.settle(500);
    check((await p.guest('return win.__draftScroll')) > 0, `${tag}: the finger scrolled the page`);
    check((await typed(p)) === 'Page comment in progress', `${tag}: scrolling the page keeps the card and its text`);
    await p.shot(`${tag}-1-kept-after-scroll`);
    await p.close();
  }
};
